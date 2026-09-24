/**
 * Machine-readiness probe. Run it before you calibrate and before every confirmation run.
 *
 *   node --import tsx perf/jitter.mts [--repeats 40]
 *
 * Times the same pure CPU loop many times and reports the spread. The loop cannot become faster
 * than its true cost, so the spread is what the machine adds: other load, frequency changes, or a
 * scheduler that moves the process between cores of different speed (Apple silicon, big.LITTLE).
 * When p50 sits far above the minimum, the two sides of an A/B run sample different machine states
 * and per-case deltas become unusable.
 *
 * The probe decides, not the load average: the average lags by design and says nothing about which
 * core the process gets. Exit code 1 means "too busy", so this can gate a script.
 */
import * as os from "node:os";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { repeats: { type: "string" }, max: { type: "string" }, wait: { type: "string" } },
});
const REPEATS = Number(values.repeats ?? 40);
/** Measure below this spread. 5% still runs, but its numbers were not usable in practice. */
const MAX = Number(values.max ?? 2);
/** Minutes to keep probing for a quiet machine before giving up. */
const WAIT_MINUTES = values.wait === undefined ? 0 : Number(values.wait || 10);

function probe(): { min: number; p50: number; max: number; spread: number } {
  const times: Array<number> = [];
  for (let r = 0; r < REPEATS; r++) {
    const start = process.hrtime.bigint();
    let x = 0;
    for (let i = 0; i < 20_000_000; i++) x = (x + i * 7) % 1_000_003;
    times.push(Number(process.hrtime.bigint() - start) / 1_000_000);
  }
  times.sort((a, b) => a - b);
  const min = times[0];
  const p50 = times[times.length >> 1];
  return { min, p50, max: times[times.length - 1], spread: (p50 / min - 1) * 100 };
}

const deadline = Date.now() + WAIT_MINUTES * 60_000;
let result = probe();
while (result.spread > MAX && Date.now() < deadline) {
  console.log(`busy: p50 ${result.spread.toFixed(1)}% above min, waiting for <= ${MAX}%`);
  result = probe();
}

const [load1] = os.loadavg();
console.log(`cores ${os.cpus().length}, load average (1 min) ${load1.toFixed(2)}`);
console.log(`cpu loop: min ${result.min.toFixed(1)} ms, p50 ${result.p50.toFixed(1)} ms, max ${result.max.toFixed(1)} ms`);
console.log(`p50 is ${result.spread.toFixed(1)}% above min (threshold ${MAX}%)`);

if (result.spread > MAX) {
  console.log("BUSY: do not measure now. Wait, or say what is running.");
  process.exit(1);
}
console.log("OK: quiet enough to measure.");
