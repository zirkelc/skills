/**
 * Example cases module. Copy it to `perf/cases.mts` and replace the workloads.
 *
 * Mirror the workloads of the repo's existing benchmarks: they encode what the maintainers
 * consider representative. Use seeded data only, so both revisions process identical inputs
 * and the guard can hash the results. `lib` is the module namespace of the configured entry.
 */
import { type PerfCase, rng } from "./harness.mts";

export function buildCases(lib: any): Array<PerfCase> {
  const cases: Array<PerfCase> = [];

  /** Hot success path: many small calls on realistic data. */
  {
    const rand = rng(1);
    const data = Array.from({ length: 1_000 }, () => ({ id: Math.floor(rand() * 1_000_000), name: `item-${rand()}` }));
    const parser = lib.createParser({ strict: true });
    cases.push({
      name: "parse-success",
      run: () => {
        for (const d of data) parser.parse(d);
      },
      collect: () => data.slice(0, 20).map((d) => parser.parse(d)),
    });
  }

  /** Failure path: errors are often far more expensive than successes. */
  {
    const bad: Array<unknown> = [null, 42, { id: "x" }, [], { name: 1 }];
    const parser = lib.createParser({ strict: true });
    const attempt = (d: unknown) => {
      try {
        return { ok: true, value: parser.parse(d) };
      } catch (error) {
        return { ok: false, error };
      }
    };
    cases.push({
      name: "parse-failure",
      run: () => {
        for (let i = 0; i < 200; i++) attempt(bad[i % bad.length]);
      },
      collect: () => bad.map(attempt),
    });
  }

  /** Construction: setup cost matters for cold starts and serverless. `alloc` feeds mem.mts. */
  {
    cases.push({
      name: "construct",
      run: () => {
        for (let i = 0; i < 100; i++) lib.createParser({ strict: true });
      },
      collect: () => typeof lib.createParser({ strict: true }).parse,
      alloc: () => lib.createParser({ strict: true }),
    });
  }

  return cases;
}
