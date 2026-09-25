/**
 * Isolation check: the current implementation of one function against a candidate, before the
 * candidate costs an experiment.
 *
 *   node perf/micro.mjs
 *
 * Copy it, replace the two implementations and the inputs, run it, throw it away. It is not part of
 * the harness and nothing depends on it.
 *
 * **It may reject a candidate. It may never keep one.** A micro-benchmark cannot see the three
 * effects that the paired harness exists for: allocation and collection pressure, hidden classes and
 * call-site polymorphism, and inlining at the real call site. So reject only on a large margin (call
 * it 2x), and when the candidate's value is one of those three (it removes an allocation, it makes a
 * call site monomorphic, it lets a caller inline), this cannot see the win at all: spend the
 * experiment. One campaign rejected five candidates here for the price of five short scripts, and
 * one of the five explained why an experiment it had already spent had failed.
 *
 * **One process per variant, always.** The obvious shape of this script, two functions called from
 * one timing loop, is the same mistake as two revisions in one process: after both have passed
 * through that call site it is polymorphic, which removes inlining from whichever candidate depended
 * on it. Measured on this file's own example, the shared-site version reported +1.8%, -11.4% and
 * -14.4% over three rounds of one run, and swapping the order changed the answer; one process per
 * variant reports -10% every time. A filter that returns a different sign depending on the order of
 * its arguments is worse than no filter.
 *
 * Two more traps, both of which a campaign hit:
 *
 * 1. **Dead code.** V8 removes work whose result nothing uses, and the failure is not a suspicious
 *    number, it is an attractive one: `new AbortController()` measured 0.02 ms for 80 000
 *    constructions. Write every result into `sink`, and keep `sink` a fixed size: growing an array
 *    to 100 000 entries inside the timed loop adds its own cost to both sides and pulls the ratio
 *    toward zero, which makes the filter pass candidates it should stop.
 * 2. **Unrealistic inputs.** Regex against loop flips with string length, and a character test flips
 *    with where in the string the interesting character sits. Use the lengths and the shapes the
 *    library really sees, taken from the repo's fixtures or its tests.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const VARIANTS = {
  current: (s) => !s.includes("\n") && !s.includes("\r"),
  candidate: (s) => !/[\n\r]/.test(s),
};

/** Realistic inputs: the values this function is actually called with, not "abc". */
const inputs = [
  "text/plain; charset=utf-8",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  "gzip, deflate, br",
  "a".repeat(400),
];

/** Fixed-size sink: keeps results reachable without allocating inside the measurement. */
const sink = new Array(1024).fill(null);

function time(fn) {
  for (let r = 0; r < 3; r++) for (const input of inputs) sink[r & 1023] = fn(input);
  let min = Number.POSITIVE_INFINITY;
  for (let r = 0; r < 20; r++) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < 100_000; i++) sink[i & 1023] = fn(inputs[i & 3]);
    min = Math.min(min, Number(process.hrtime.bigint() - start) / 1_000_000);
  }
  return min;
}

const variant = process.argv[2];
if (variant) {
  console.log(time(VARIANTS[variant]));
} else {
  /** Equivalence first. A faster function that answers differently is not a candidate. */
  for (const input of inputs) {
    if (VARIANTS.current(input) !== VARIANTS.candidate(input)) throw new Error(`differs on ${JSON.stringify(input)}`);
  }
  /**
   * For a character test, prove equivalence over every code unit rather than over examples: the
   * whole domain is 65 536 values and the check costs milliseconds. Put each one at the start, in
   * the middle and at the end of a longer string. In a one-character string the first character is
   * also the last, so a candidate that only ever checks position 0 passes a 65 536-value proof, and
   * position 0 is exactly what a header validator is asked about.
   */
  for (let code = 0; code < 65_536; code++) {
    const c = String.fromCharCode(code);
    for (const s of [`${c}tail`, `head${c}tail`, `head${c}`]) {
      if (VARIANTS.current(s) !== VARIANTS.candidate(s)) throw new Error(`differs on code unit ${code} in ${JSON.stringify(s)}`);
    }
  }

  const self = fileURLToPath(import.meta.url);
  const run = (name) => Number(spawnSync(process.execPath, [self, name], { encoding: "utf8" }).stdout.trim());
  const deltas = [];
  for (let pair = 0; pair < 3; pair++) {
    /** Alternate which variant starts, so a machine that drifts does not decide the answer. */
    const first = pair % 2 === 0;
    const a = first ? run("current") : undefined;
    const b = run("candidate");
    const current = first ? a : run("current");
    deltas.push((b / current - 1) * 100);
    console.log(`pair ${pair + 1}: current ${current.toFixed(2)} ms, candidate ${b.toFixed(2)} ms, ${deltas[pair].toFixed(1)}%`);
  }
  deltas.sort((x, y) => x - y);
  console.log(`median ${deltas[1].toFixed(1)}%  (reject the candidate only on a large margin)`);
}
