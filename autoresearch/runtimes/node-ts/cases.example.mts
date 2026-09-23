/**
 * Example cases module. Copy it to `perf/cases.mts` and replace the workloads.
 *
 * Mirror the workloads of the repo's existing benchmarks: they encode what the maintainers
 * consider representative. Use seeded data only, so both revisions process identical inputs
 * and the guard can hash the results. `lib` is the module namespace of the configured entry.
 *
 * Two rules decide how good the instrument is:
 *
 * - Keep a timed body between roughly 5 and 50 ms. A body of hundreds of milliseconds contains a
 *   collection almost by construction, which no estimator can filter out.
 * - Let a case own its inputs through `setup`/`teardown`. Inputs of every case held alive for the
 *   whole run exist twice, once per revision, and make every later collection slower on both sides.
 */
import { type PerfCase, rng } from "./harness.mts";

export function buildCases(lib: any): Array<PerfCase> {
  const cases: Array<PerfCase> = [];

  /** Hot success path: many small calls on realistic data. Small inputs can stay in the closure. */
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

  /**
   * Large inputs live only while this case runs. A workload that mutates its input has to rebuild
   * it, either in `setup` for every repetition of the body or inside `run` itself.
   */
  {
    let documents: Array<unknown> = [];
    cases.push({
      name: "query-large",
      setup: () => {
        documents = FIXTURES.map((f) => lib.parse(f));
      },
      teardown: () => {
        documents = [];
      },
      run: () => {
        for (const d of documents) (d as any).query(".item");
      },
      collect: () => documents.map((d) => (d as any).query(".item").length),
    });
  }

  /** Construction: setup cost matters for cold starts. `alloc` feeds mem.mts. */
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

/** Replace with the real fixtures: generated deterministically, or read from `perf/fixtures/`. */
const FIXTURES: Array<string> = [];
