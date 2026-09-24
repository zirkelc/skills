/**
 * CPU profile of the cases against the working tree, aggregated per function.
 *
 *   node --import tsx perf/profile.mts [case,case,...] [--seconds 4] [--top 30]
 *
 * Profiles in-process through the inspector, writes the raw profile to `.perf-prof/` in the
 * repo root (open it in Chrome DevTools if needed), and prints self and total time per
 * function. Frames from `node_modules` and Node internals are dropped: loader frames are an
 * artefact of running through a TypeScript loader.
 */
import * as fs from "node:fs";
import { Session } from "node:inspector/promises";
import * as path from "node:path";
import { WORKTREE, loadCases, loadConfig, materialise } from "./harness.mts";

const HARNESS_DIR = import.meta.dirname;
const { config, positionals, values } = loadConfig(HARNESS_DIR, process.argv.slice(2), {
  seconds: { type: "string" },
  top: { type: "string" },
  deps: { type: "boolean" },
  callers: { type: "string" },
  lines: { type: "string" },
});
/** Dependency frames matter when the library hands its hot loops to them (parser, selector engine). */
const DEPS = Boolean(values.deps);
const SECONDS = Number(values.seconds ?? 4);
const TOP = Number(values.top ?? 30);

const all = await loadCases(config, materialise(config, WORKTREE, "profile"));
const only = positionals[0]?.split(",");
const selected = only ? all.filter((c) => only.includes(c.name)) : all;
if (selected.length === 0) throw new Error(`No case matches. Known: ${all.map((c) => c.name).join(", ")}`);

for (const c of selected) c.setup?.();
/** Warm up before sampling so the profile shows optimized code, not the interpreter. */
for (const c of selected) for (let i = 0; i < 10; i++) c.run();

const session = new Session();
session.connect();
await session.post("Profiler.enable");
await session.post("Profiler.setSamplingInterval", { interval: 100 });
await session.post("Profiler.start");
const start = Date.now();
while (Date.now() - start < SECONDS * 1_000) {
  for (const c of selected) c.run();
}
const { profile } = (await session.post("Profiler.stop")) as { profile: any };
session.disconnect();
for (const c of selected) c.teardown?.();

const outDir = path.join(config.root, ".perf-prof");
fs.mkdirSync(outDir, { recursive: true });
const outFile = path.join(outDir, `profile-${Date.now()}.cpuprofile`);
fs.writeFileSync(outFile, JSON.stringify(profile));

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number };
  children?: Array<number>;
}
const nodes: Array<ProfileNode> = profile.nodes;
const byId = new Map<number, ProfileNode>(nodes.map((n) => [n.id, n]));
const parent = new Map<number, number>();
for (const n of nodes) for (const c of n.children ?? []) parent.set(c, n.id);

const selfTime = new Map<number, number>();
const samples: Array<number> = profile.samples;
const deltas: Array<number> = profile.timeDeltas;
for (let i = 0; i < samples.length; i++) selfTime.set(samples[i], (selfTime.get(samples[i]) ?? 0) + (deltas[i] ?? 0));

const totalTime = new Map<number, number>();
for (const [id, t] of selfTime) {
  let cur: number | undefined = id;
  while (cur !== undefined) {
    totalTime.set(cur, (totalTime.get(cur) ?? 0) + t);
    cur = parent.get(cur);
  }
}

const rootUrl = `file://${config.root}/`;

/**
 * Trees live under `node_modules/.perf-trees`, so that prefix has to go before anything decides
 * whether a frame belongs to a dependency. Every consumer uses this, not just the label: counting
 * raw URLs reported 86% of samples as dependencies on a workload whose real share was about 35%.
 */
function withoutTreePrefix(url: string): string {
  const inTree = url.match(/node_modules\/\.perf-trees\/[^/]+\//);
  return inTree ? url.slice(url.indexOf(inTree[0]) + inTree[0].length) : url;
}

function isDependency(url: string): boolean {
  return withoutTreePrefix(url).includes("node_modules/");
}

function label(n: ProfileNode): string | null {
  const { url, functionName, lineNumber } = n.callFrame;
  const classified = withoutTreePrefix(url);
  if (url.startsWith("node:") || (classified.includes("node_modules/") && !DEPS)) return null;
  if (!url && (!functionName || ["(program)", "(idle)", "(root)"].includes(functionName))) return null;
  const file = classified.includes("node_modules/")
    ? classified.slice(classified.lastIndexOf("node_modules/") + "node_modules/".length)
    : classified.startsWith(rootUrl)
      ? classified.slice(rootUrl.length)
      : classified.replace(/^file:\/\//, "");
  return `${functionName || "(anonymous)"} ${file}${file ? `:${lineNumber + 1}` : ""}`;
}

const aggSelf = new Map<string, number>();
const aggTotal = new Map<string, number>();
for (const n of nodes) {
  const l = label(n);
  if (!l) continue;
  aggSelf.set(l, (aggSelf.get(l) ?? 0) + (selfTime.get(n.id) ?? 0));
  /** Recursive frames would count twice in total time; keep the largest per label. */
  aggTotal.set(l, Math.max(aggTotal.get(l) ?? 0, totalTime.get(n.id) ?? 0));
}

const grand = [...selfTime.values()].reduce((a, b) => a + b, 0);
function print(title: string, m: Map<string, number>): void {
  console.log(`\n== ${title} ==`);
  for (const [l, t] of [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP)) {
    console.log(`${((t / grand) * 100).toFixed(1).padStart(6)}%  ${(t / 1_000).toFixed(1).padStart(8)}ms  ${l}`);
  }
}
console.log(`profiled ${selected.map((c) => c.name).join(", ")} for ${SECONDS}s -> ${path.relative(config.root, outFile)}`);

/** A library that hands its hot loops to a dependency spends most of its time in frames that are
 * hidden by default, so say how much is hidden instead of letting it be found by luck. */
if (!DEPS) {
  let depTime = 0;
  for (const n of nodes) {
    if (isDependency(n.callFrame.url)) depTime += selfTime.get(n.id) ?? 0;
  }
  const share = (depTime / grand) * 100;
  if (share >= 1) console.log(`dependencies: ${share.toFixed(0)}% of samples are hidden, re-run with --deps to see them`);
}

print("self time", aggSelf);
print("total time", aggTotal);

/**
 * The top-function view finds a hot function and says nothing about which of its callers or which
 * of its statements to change, which is the actual decision. These two views answer that.
 */
const focus = (values.callers ?? values.lines) as string | undefined;
if (focus) {
  const matches = (n: ProfileNode) => n.callFrame.functionName === focus;
  if (values.callers) {
    const byCaller = new Map<string, number>();
    for (const n of nodes.filter(matches)) {
      const up = parent.get(n.id);
      const caller = up === undefined ? "(root)" : (label(byId.get(up)!) ?? byId.get(up)!.callFrame.functionName);
      byCaller.set(caller, (byCaller.get(caller) ?? 0) + (selfTime.get(n.id) ?? 0));
    }
    print(`self time of ${focus} by caller`, byCaller);
  }
  if (values.lines) {
    const byLine = new Map<string, number>();
    for (const n of nodes.filter(matches)) {
      for (const tick of (n as any).positionTicks ?? []) {
        const key = `${label(n) ?? focus} line ${tick.line}`;
        byLine.set(key, (byLine.get(key) ?? 0) + tick.ticks);
      }
    }
    if (byLine.size === 0) {
      console.log(`\nno line ticks for ${focus}: is the name spelled as it appears above?`);
    } else {
      /** Ticks are counts, not microseconds: print them as counts and as a share of this
       * function's own ticks, or every line reads as 0.0 ms and the ranking says nothing. */
      const total = [...byLine.values()].reduce((a, b) => a + b, 0);
      console.log(`\n== ticks of ${focus} by line (${total} ticks total) ==`);
      for (const [key, ticks] of [...byLine.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP)) {
        console.log(`${((ticks / total) * 100).toFixed(1).padStart(6)}%  ${String(ticks).padStart(8)} ticks  ${key}`);
      }
    }
  }
}
