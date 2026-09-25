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
 * Two traps, both of which a campaign hit:
 *
 * 1. **Dead code.** V8 removes work whose result nothing uses, and the failure is not a suspicious
 *    number, it is an attractive one: `new AbortController()` measured 0.02 ms for 80 000
 *    constructions. Write every result into `sink`.
 * 2. **Unrealistic inputs.** Regex against loop flips with string length, and character tests flip
 *    with where in the string the interesting character sits. Use the lengths and the shapes the
 *    library really sees, taken from the repo's fixtures or its tests.
 */

/** Keeps results reachable, so nothing is optimized away. Read at the end so it cannot be dropped. */
const sink = [];

const current = (s) => !s.includes("\n") && !s.includes("\r");
const candidate = (s) => !/[\n\r]/.test(s);

/** Realistic inputs: the values this function is actually called with, not "abc". */
const inputs = [
  "text/plain; charset=utf-8",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
  "gzip, deflate, br",
  "a".repeat(400),
];

/** Equivalence first. A faster function that answers differently is not a candidate. */
for (const input of inputs) {
  if (current(input) !== candidate(input)) throw new Error(`differs on ${JSON.stringify(input)}`);
}
/**
 * For a character test, prove equivalence over every code unit rather than over examples: the whole
 * domain is 65 536 values and the check costs milliseconds.
 */
for (let code = 0; code < 65_536; code++) {
  const s = String.fromCharCode(code);
  if (current(s) !== candidate(s)) throw new Error(`differs on code unit ${code}`);
}

function best(fn, repeats = 20) {
  /** Warm up, so the first timed round does not measure the interpreter. */
  for (let r = 0; r < 3; r++) for (const input of inputs) sink.push(fn(input));
  let min = Number.POSITIVE_INFINITY;
  for (let r = 0; r < repeats; r++) {
    const start = process.hrtime.bigint();
    for (let i = 0; i < 100_000; i++) sink.push(fn(inputs[i & 3]));
    min = Math.min(min, Number(process.hrtime.bigint() - start) / 1_000_000);
    sink.length = 0;
  }
  return min;
}

/** Three rounds, alternating, so a machine that drifts does not decide the answer. */
for (let round = 0; round < 3; round++) {
  const a = best(current);
  const b = best(candidate);
  console.log(`round ${round + 1}: current ${a.toFixed(2)} ms, candidate ${b.toFixed(2)} ms, ${((b / a - 1) * 100).toFixed(1)}%`);
}
console.log(`sink ${sink.length}`);
