/**
 * Paired A/B timing of two git revisions.
 *
 *   node --import tsx perf/ab.mts [revA=HEAD] [revB=WORKTREE] [--iters 25] [--repeats 1] [--only case,case]
 *   node --import tsx perf/ab.mts --sizes [rev=WORKTREE]
 *
 * Both revisions are imported into one process and timed in strict alternation. A and B run back to
 * back inside one iteration, so they share the same machine state: the delta is the median of their
 * per-iteration ratios, which keeps the pairing that makes this method work. The absolute
 * milliseconds are the per-side minima. Module instances carry a stable load-order bias, so every
 * measurement runs in child processes for both load orders, combined with a geometric mean.
 * Negative delta = revB is faster.
 *
 * `--only` limits the run to the cases a change targets. That is how a per-case decision is made:
 * the same wall-clock time buys many more paired iterations, and the other cases' heap is gone. Its
 * numbers may only be compared with a control run made the same way, never with a full-suite band.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { type PerfCase, WORKTREE, cpuProbe, loadCases, loadConfig, materialise, timeNs } from "./harness.mts";

interface Row {
  name: string;
  /** Minimum ns per case body for the module loaded first. */
  first: number;
  /** Minimum ns per case body for the module loaded second. */
  second: number;
  /** Median over iterations of (second / first), each pair timed back to back. */
  ratio: number;
  /** Ratio at the 25th and 75th percentile: how stable this case's delta is. */
  p25: number;
  p75: number;
}

/** A body outside this range makes the instrument worse. Checked here and by `--sizes`. */
const MIN_BODY_MS = 1;
const MAX_BODY_MS = 50;

const HARNESS_DIR = import.meta.dirname;
const { config, positionals, values } = loadConfig(HARNESS_DIR, process.argv.slice(2), {
  iters: { type: "string" },
  warmup: { type: "string" },
  "target-ms": { type: "string" },
  repeats: { type: "string" },
  sizes: { type: "boolean" },
  child: { type: "boolean" },
});

/** Tune ITERS and REPEATS in step 4, against this machine and the session's time budget. */
const ITERS = Number(values.iters ?? 25);
const WARMUP = Number(values.warmup ?? 3);
const TARGET_NS = Number(values["target-ms"] ?? 1.5) * 1_000_000;
const REPEATS = Number(values.repeats ?? 1);

/** Children are spawned with `--expose-gc`; a missing flag degrades to a no-op. */
const gc: () => void = (globalThis as { gc?: () => void }).gc ?? (() => {});

function quantile(sorted: Array<number>, q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function median(xs: Array<number>): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return quantile(sorted, 0.5);
}

/**
 * How much slower a side ran at the end of its run than at the start. A case that accumulates state
 * (listeners on a long-lived object, a cache, a registry) gets slower every iteration, and nothing
 * else in this harness can see it: the reported milliseconds are a minimum, so they report the
 * cleanest early iteration, and the delta is a paired ratio, so a drift that hits both sides cancels
 * exactly. A rise here is a hint, not a verdict: with few iterations each quarter is a handful of
 * samples, and a machine that got busier during the run raises it as well, which is why the message
 * names both causes and the run's own after-probe answers the second one.
 */
function driftPct(times: Array<number>): number {
  const quarter = Math.floor(times.length / 4);
  if (quarter < 2) return 0;
  return (median(times.slice(-quarter)) / median(times.slice(0, quarter)) - 1) * 100;
}

/** Clean cases measured 0 to 3% here, a case that grew a shared list measured 26%. */
const DRIFT_WARN_PCT = 12;

/** Runs inside a child process: times the two entries loaded in the given order. */
async function measure(entryFirst: string, entrySecond: string): Promise<Array<Row>> {
  const casesFirst = await loadCases(config, entryFirst, "first");
  const casesSecond = await loadCases(config, entrySecond, "second");
  const rows: Array<Row> = [];

  for (let i = 0; i < casesFirst.length; i++) {
    const a: PerfCase = casesFirst[i];
    const b: PerfCase = casesSecond[i];
    if (a.name !== b.name) throw new Error(`Case order differs: ${a.name} vs ${b.name}`);
    a.setup?.();
    b.setup?.();

    /** JIT warm-up on the raw bodies, then size each timed run to about TARGET_NS. Slow bodies
     * are already long enough after a few probes, so stop early instead of running ten of them. */
    let probe = Number.POSITIVE_INFINITY;
    for (let w = 0; w < 10 && !(w >= 3 && probe > 20_000_000); w++) {
      probe = Math.min(probe, await timeNs(a.run));
      await b.run();
    }
    const reps = Math.max(1, Math.round(TARGET_NS / probe));
    const runA = async () => {
      for (let r = 0; r < reps; r++) await a.run();
    };
    const runB = async () => {
      for (let r = 0; r < reps; r++) await b.run();
    };

    for (let w = 0; w < WARMUP; w++) {
      await runA();
      await runB();
    }

    /** A collection triggered by one side's garbage must not land in the other side's timing, so
     * collect before every timed body. Never inside one. */
    const timeA = () => (gc(), timeNs(runA));
    const timeB = () => (gc(), timeNs(runB));

    let minA = Number.POSITIVE_INFINITY;
    let minB = Number.POSITIVE_INFINITY;
    const ratios: Array<number> = [];
    const timesA: Array<number> = [];
    const timesB: Array<number> = [];
    for (let iter = 0; iter < ITERS; iter++) {
      let tA: number;
      let tB: number;
      if (iter % 2 === 0) {
        tA = await timeA();
        tB = await timeB();
      } else {
        tB = await timeB();
        tA = await timeA();
      }
      minA = Math.min(minA, tA);
      minB = Math.min(minB, tB);
      timesA.push(tA);
      timesB.push(tB);
      ratios.push(tB / tA);
    }
    ratios.sort((x, y) => x - y);
    /** Above 50 ms a body contains a collection, below 1 ms it is dominated by jitter. Say so once,
     * while the fixtures are still cheap to change. */
    const bodyMs = minA / reps / 1_000_000;
    /** Tagged so the parent can deduplicate by case and kind: each child measures a slightly
     * different body time, so the text alone would name the same case once per child. */
    if (bodyMs > MAX_BODY_MS || bodyMs < MIN_BODY_MS) {
      console.error(`perf-warning\t${a.name}\tsize\truns ${bodyMs.toFixed(2)} ms per body, outside the ${MIN_BODY_MS} to ${MAX_BODY_MS} ms range`);
    }
    const drift = Math.max(driftPct(timesA), driftPct(timesB));
    if (drift > DRIFT_WARN_PCT) {
      console.error(
        `perf-warning\t${a.name}\tdrift\tran ${drift.toFixed(0)}% slower at the end of the run than at the start: the case accumulates state across calls, or the machine got busier during the run`
      );
    }
    a.teardown?.();
    b.teardown?.();
    rows.push({
      name: a.name,
      first: minA / reps,
      second: minB / reps,
      ratio: quantile(ratios, 0.5),
      p25: quantile(ratios, 0.25),
      p75: quantile(ratios, 0.75),
    });
  }
  return rows;
}

const seenWarnings = new Set<string>();

function child(entryFirst: string, entrySecond: string): Array<Row> {
  const self = fileURLToPath(import.meta.url);
  const passthrough = ["--iters", String(ITERS), "--warmup", String(WARMUP), "--target-ms", String(TARGET_NS / 1_000_000)];
  const res = spawnSync(
    process.execPath,
    [
      ...process.execArgv,
      "--expose-gc",
      self,
      "--child",
      ...passthrough,
      "--entry",
      config.entry,
      "--cases",
      config.cases,
      ...(config.only ? ["--only", config.only.join(",")] : []),
      ...config.src.flatMap((s) => ["--src", s]),
      entryFirst,
      entrySecond,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }
  );
  if (res.status !== 0) throw new Error(`child failed:\n${res.stderr}`);
  /** Children warn about unusable case sizes and about drift; every child repeats the same warning,
   * so print each distinct case and kind once rather than four times. */
  for (const line of (res.stderr ?? "").split("\n").filter(Boolean)) {
    const tagged = line.startsWith("perf-warning\t");
    const [, name, kind, text] = tagged ? line.split("\t") : [];
    const key = tagged ? `${name}\t${kind}` : line;
    if (seenWarnings.has(key)) continue;
    seenWarnings.add(key);
    console.error(tagged ? `warning: case "${name}" ${text}` : line);
  }
  const lines = res.stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1]);
}

/** Combines repeated children of the same load order: minima for the absolute numbers, geometric
 * mean for the ratios, widest band for the dispersion. */
function combine(runs: Array<Array<Row>>): Array<Row> {
  const geo = (xs: Array<number>) => Math.exp(xs.reduce((sum, x) => sum + Math.log(x), 0) / xs.length);
  return runs[0].map((row, i) => ({
    name: row.name,
    first: Math.min(...runs.map((r) => r[i].first)),
    second: Math.min(...runs.map((r) => r[i].second)),
    ratio: geo(runs.map((r) => r[i].ratio)),
    p25: Math.min(...runs.map((r) => r[i].p25)),
    p75: Math.max(...runs.map((r) => r[i].p75)),
  }));
}

/**
 * Times every body once against one revision and reports the ones outside the usable range. Run it
 * after writing the cases and before the first calibration run: the same check inside a measurement
 * only reports a bad fixture once calibration has already been spent on it.
 */
async function reportSizes(rev: string): Promise<void> {
  const cases = await loadCases(config, materialise(config, rev, "sizes"));
  console.log(`case body sizes @ ${rev} (usable range ${MIN_BODY_MS} to ${MAX_BODY_MS} ms)`);
  let bad = 0;
  for (const c of cases) {
    c.setup?.();
    for (let w = 0; w < 3; w++) await c.run();
    let min = Number.POSITIVE_INFINITY;
    for (let r = 0; r < 3; r++) min = Math.min(min, await timeNs(c.run));
    c.teardown?.();
    const bodyMs = min / 1_000_000;
    const verdict = bodyMs > MAX_BODY_MS ? "  too long: split it or shrink the input" : bodyMs < MIN_BODY_MS ? "  too short: raise the input or batch it" : "";
    if (verdict) bad++;
    console.log(`${c.name.padEnd(26)}${bodyMs.toFixed(2).padStart(9)} ms${verdict}`);
  }
  console.log(bad === 0 ? "all case bodies are in range" : `${bad} case(s) outside the range: fix them before calibrating`);
}

if (values.child) {
  const rows = await measure(positionals[0], positionals[1]);
  console.log(JSON.stringify(rows));
} else if (values.sizes) {
  await reportSizes(positionals[0] ?? WORKTREE);
} else {
  const revA = positionals[0] ?? "HEAD";
  const revB = positionals[1] ?? WORKTREE;
  const entryA = materialise(config, revA, "a");
  const entryB = materialise(config, revB, "b");

  /** orderAB: A loaded first. orderBA: B loaded first. */
  const orderAB = combine(Array.from({ length: REPEATS }, () => child(entryA, entryB)));
  const orderBA = combine(Array.from({ length: REPEATS }, () => child(entryB, entryA)));

  const ms = (ns: number) => (ns / 1_000_000).toFixed(4).padStart(10);
  const pct = (ratio: number) => `${((ratio - 1) * 100).toFixed(2).padStart(7)}%`;
  const speedup = (ratio: number) => `${(1 / ratio).toFixed(2).padStart(6)}x`;

  const scope = config.only ? `only ${config.only.join(",")}; ` : "";
  console.log(
    `A = ${revA}, B = ${revB} (${scope}min ms of ${ITERS} iters; delta = median of paired ratios; ${REPEATS} children x 2 load orders)`
  );
  /** Widths match the data rows exactly: a header that is one character wider reads as a bug in
   * the numbers. Every printed line ends at the same column. */
  console.log(`${"case".padEnd(26)}${"A".padStart(10)}${"B".padStart(10)}${"delta".padStart(9)}${"band".padStart(17)}${"speed".padStart(7)}`);

  let sumA = 0;
  let sumB = 0;
  let logSum = 0;
  for (let i = 0; i < orderAB.length; i++) {
    const ab = orderAB[i];
    const ba = orderBA[i];
    /** orderAB measured B/A, orderBA measured A/B: the geometric mean cancels the load-order bias. */
    const ratio = Math.sqrt(ab.ratio / ba.ratio);
    /** Widest interquartile band of the two orders, expressed as a delta range. */
    const lo = (Math.min(ab.p25, 1 / ba.p75) - 1) * 100;
    const hi = (Math.max(ab.p75, 1 / ba.p25) - 1) * 100;
    /**
     * Two markers, two different questions, both about this run and not about the change. `?`: the
     * band contains 0%, so the iterations disagree about the direction and this run does not
     * confirm the row. `~`: the band is wide against the size of the median, which is the signature
     * of an in-process artefact or of a case too short to time. Both are hints to confirm (second
     * run, or `solo.mts`), never a reason to discard on their own.
     */
    const straddles = lo < 0 && hi > 0;
    const medianPct = (ratio - 1) * 100;
    /** `?` wins when both apply: a band around zero is wide against its own median almost by
     * definition, so printing both would mark nearly every noise row. `~` alone is the signal that
     * matters: a median that looks confident carried by iterations that do not agree. */
    const wide = !straddles && hi - lo > 2 * Math.abs(medianPct);
    const marker = straddles ? "?" : wide ? "~" : " ";
    logSum += Math.log(ratio);
    const a = (ab.first + ba.second) / 2;
    sumA += a;
    sumB += a * ratio;
    const band = `${lo >= 0 ? "+" : ""}${lo.toFixed(1)}..${hi >= 0 ? "+" : ""}${hi.toFixed(1)}%${marker}`;
    console.log(`${ab.name.padEnd(26)}${ms(a)}${ms(a * ratio)} ${pct(ratio)}${band.padStart(17)}${speedup(ratio)}`);
  }

  /** TOTAL weights each case by its time, GEOMEAN weights every case equally. Gate on both: a
   * disagreement means the effect is concentrated in one case and needs a per-case look. */
  const totalRatio = sumB / sumA;
  const geo = Math.exp(logSum / orderAB.length);
  console.log(`${"TOTAL".padEnd(26)}${ms(sumA)}${ms(sumA * totalRatio)} ${pct(totalRatio)}${"".padStart(17)}${speedup(totalRatio)}`);
  console.log(`${"GEOMEAN".padEnd(46)} ${pct(geo)}${"".padStart(17)}${speedup(geo)}`);
  console.log(
    `(band = interquartile range of per-iteration deltas; "?" = this run does not confirm the direction; "~" = band wide against its median; either: confirm with a second run or solo.mts)`
  );

  /**
   * A run is only valid if the machine was quiet for all of it, and that cannot be known before it
   * has finished. The probe before the run (`jitter.mts`, or `quiet.sh`) and this one after it
   * bracket the measurement. Neither certifies it: a burst that starts and ends inside the run
   * passes both, which is what the identical-code control and the bands are for.
   */
  const after = cpuProbe(12);
  console.log(
    after.spread > 2
      ? `machine after the run: BUSY, p50 ${after.spread.toFixed(1)}% above min. Treat this run as invalid and repeat it.`
      : `machine after the run: quiet, p50 ${after.spread.toFixed(1)}% above min.`
  );
}
