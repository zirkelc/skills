/**
 * Scaling scan: times each input shape at size n and at 4n, against one revision.
 *
 *   node perf/scan.mts [rev=WORKTREE] [--factor 4] [--reps 3]
 *
 * Linear work costs about `factor` times more at `factor` times the input. A ratio well above that
 * marks a superlinear path, which the A/B suite cannot see: on the input sizes a benchmark uses,
 * a quadratic resolver is invisible, and on long input it costs five to seventeen times. Profile
 * every shape the scan flags and look for mid-array `splice`, `shift`, `unshift` or `indexOf`
 * inside a loop over the same array.
 *
 * The cases module exports `buildScan(lib)` for this: shapes that take a size and return an input.
 */
import { pathToFileURL } from "node:url";
import * as path from "node:path";
import { WORKTREE, loadConfig, materialise, timeNs } from "./harness.mts";

/** One input shape, parameterised by size. */
export interface ScanShape {
  name: string;
  /** Builds an input of roughly `n` units (characters, elements, nodes: whatever the domain uses). */
  input: (n: number) => unknown;
  /** Runs the library over one input. */
  run: (input: unknown) => void;
  /** Base size. The scan also measures `n * factor`. */
  n?: number;
}

const HARNESS_DIR = import.meta.dirname;
const { config, positionals, values } = loadConfig(HARNESS_DIR, process.argv.slice(2), {
  factor: { type: "string" },
  reps: { type: "string" },
});
const FACTOR = Number(values.factor ?? 4);
const REPS = Number(values.reps ?? 3);
const rev = positionals[0] ?? WORKTREE;

const lib = await import(pathToFileURL(materialise(config, rev, "scan")).href);
const casesModule = await import(pathToFileURL(path.join(config.root, config.cases)).href);
if (typeof casesModule.buildScan !== "function") {
  throw new Error(`${config.cases} must export buildScan(lib) to run a scaling scan.`);
}
const shapes: Array<ScanShape> = casesModule.buildScan(lib);

const best = (fn: () => void) => {
  let min = Number.POSITIVE_INFINITY;
  for (let r = 0; r < REPS; r++) min = Math.min(min, timeNs(fn));
  return min / 1_000_000;
};

console.log(`scaling scan @ ${rev} (n against ${FACTOR}n, min of ${REPS})`);
console.log(`${"shape".padEnd(28)}${"n".padStart(9)}${`${FACTOR}n`.padStart(11)}${"ratio".padStart(9)}`);
for (const shape of shapes) {
  const n = shape.n ?? 10_000;
  const small = shape.input(n);
  const large = shape.input(n * FACTOR);
  shape.run(small);
  shape.run(large);
  const tSmall = best(() => shape.run(small));
  const tLarge = best(() => shape.run(large));
  const ratio = tLarge / tSmall;
  /** Well above the factor means superlinear. Some slack, because constants move small inputs. */
  const flag = ratio > FACTOR * 1.6 ? "  <- superlinear" : "";
  console.log(
    `${shape.name.padEnd(28)}${tSmall.toFixed(2).padStart(9)}${tLarge.toFixed(2).padStart(11)}${ratio.toFixed(2).padStart(9)}${flag}`
  );
}
