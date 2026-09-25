/**
 * Standalone timing of one case, one revision per process.
 *
 *   node --import tsx --expose-gc perf/solo.mts <rev|WORKTREE> <case> [--iters 25]
 *   node --import tsx --expose-gc perf/solo.mts <revA> <revB> <case> [--pairs 4]
 *
 * The A/B harness loads two revisions into one process, which is what makes it precise, but the
 * library's own objects are then polymorphic in shared code. That can produce a stable, repeatable
 * delta on a case whose code neither revision changed, and it can inflate a real one: one campaign
 * measured the same change at -69% paired, -54% focused and -32% standalone, each step removing
 * another part of the co-residency effect.
 *
 * So this is two things. The first form confirms a suspicious per-case row. The second form
 * alternates whole processes A, B, A, B and prints the delta of each pair: that is the number a PR
 * reports, because it is the one a maintainer reproduces.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WORKTREE, loadCases, loadConfig, materialise, timeNs } from "./harness.mts";

const HARNESS_DIR = import.meta.dirname;
const { config, positionals, values } = loadConfig(HARNESS_DIR, process.argv.slice(2), {
  iters: { type: "string" },
  pairs: { type: "string" },
  child: { type: "boolean" },
});
const ITERS = Number(values.iters ?? 25);
const PAIRS = Number(values.pairs ?? 4);

const gc: () => void = (globalThis as { gc?: () => void }).gc ?? (() => {});

/** Minimum ms of one body, for one revision, in this process. */
async function measure(rev: string, name: string): Promise<number> {
  const cases = await loadCases(config, materialise(config, rev, "solo"), "solo");
  const perfCase = cases.find((c) => c.name === name);
  if (!perfCase) throw new Error(`No case ${name}. Known: ${cases.map((c) => c.name).join(", ")}`);

  perfCase.setup?.();
  for (let w = 0; w < 5; w++) await perfCase.run();

  let min = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ITERS; i++) {
    gc();
    min = Math.min(min, await timeNs(perfCase.run));
  }
  perfCase.teardown?.();
  return min / 1_000_000;
}

function childMeasure(rev: string, name: string): number {
  const self = fileURLToPath(import.meta.url);
  const res = spawnSync(
    process.execPath,
    [
      ...process.execArgv,
      "--expose-gc",
      self,
      "--child",
      "--iters",
      String(ITERS),
      "--entry",
      config.entry,
      "--cases",
      config.cases,
      ...config.src.flatMap((s) => ["--src", s]),
      rev,
      name,
    ],
    { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }
  );
  if (res.status !== 0) throw new Error(`child failed:\n${res.stderr}`);
  const lines = res.stdout.trim().split("\n");
  return Number(lines[lines.length - 1]);
}

if (values.child) {
  console.log(await measure(positionals[0], positionals[1]));
} else if (positionals.length >= 3) {
  const [revA, revB, name] = positionals;
  /** Materialise both trees here, so no child pays for a copy inside its own measurement. Without
   * this the first pair reported a 22% difference between two identical revisions. */
  materialise(config, revA, "solo");
  materialise(config, revB, "solo");
  console.log(`${name}: ${revA} vs ${revB}, ${PAIRS} alternating process pairs, min ms of ${ITERS} iterations each`);
  console.log(`${"pair".padEnd(6)}${"A".padStart(10)}${"B".padStart(10)}${"delta".padStart(9)}`);
  const deltas: Array<number> = [];
  for (let p = 0; p < PAIRS; p++) {
    /** Alternate which revision starts, so a machine that drifts through the sequence does not
     * hand the same side the better half of it. */
    let a: number;
    let b: number;
    if (p % 2 === 0) {
      a = childMeasure(revA, name);
      b = childMeasure(revB, name);
    } else {
      b = childMeasure(revB, name);
      a = childMeasure(revA, name);
    }
    const delta = (b / a - 1) * 100;
    deltas.push(delta);
    console.log(`${String(p + 1).padEnd(6)}${a.toFixed(3).padStart(10)}${b.toFixed(3).padStart(10)}${`${delta.toFixed(2)}%`.padStart(9)}`);
  }
  deltas.sort((x, y) => x - y);
  const mid = deltas.length % 2 ? deltas[deltas.length >> 1] : (deltas[deltas.length / 2 - 1] + deltas[deltas.length / 2]) / 2;
  console.log(`median ${mid.toFixed(2)}%, range ${deltas[0].toFixed(2)}% to ${deltas[deltas.length - 1].toFixed(2)}%`);
  console.log("(this is the number to report: one revision per process, nothing shared)");
} else {
  const rev = positionals[0] ?? WORKTREE;
  const name = positionals[1];
  if (!name) throw new Error("Usage: solo.mts <rev|WORKTREE> <case>   or   solo.mts <revA> <revB> <case> --pairs 4");
  const min = await measure(rev, name);
  console.log(`${name} @ ${rev}: min ${min.toFixed(2)} ms of ${ITERS} iterations`);
}
