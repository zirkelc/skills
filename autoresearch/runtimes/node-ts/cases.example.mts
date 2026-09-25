/**
 * Example cases module. Copy it to `perf/cases.mts` and replace the workloads.
 *
 * Mirror the workloads of the repo's existing benchmarks: they encode what the maintainers
 * consider representative. Use seeded data only, so both revisions process identical inputs
 * and the guard can hash the results. `lib` is the module namespace of the configured entry.
 *
 * Four rules decide how good the instrument is. `ab.mts --sizes` checks the first one before you
 * calibrate, and `ab.mts` warns about the third one while it runs.
 *
 * - Keep a timed body between roughly 5 and 50 ms. A body of hundreds of milliseconds contains a
 *   collection almost by construction, which no estimator can filter out.
 * - Let a case own its inputs through `setup`/`teardown`. Inputs of every case held alive for the
 *   whole run exist twice, once per revision, and make every later collection slower on both sides.
 * - Never let a case accumulate state across calls. Listeners on a long-lived object, a cache or a
 *   registry that grows per call make every iteration slower than the last, and the harness cannot
 *   see it: the reported milliseconds are a minimum and the delta is a paired ratio, so both hide a
 *   drift that hits both sides. One campaign spent its first profile finding 67% of a case's time in
 *   a duplicate check walking a listener list the case itself had grown.
 * - An async body must run a fixed batch per call, and its promise must cover all of the work.
 */
import { type PerfCase, rng } from "./harness.mts";
/**
 * Large read-only inputs belong in a module of their own. The cases module is loaded once per
 * revision, so anything at its top level exists twice in the child process, while a separate module
 * without the `?slot=` query is shared. Inputs that a case builds (parsed documents, instances)
 * belong in `setup` instead, whatever their size. Never build anything from the library under test
 * in a shared module: both revisions would measure objects built by one of them.
 */
import { FIXTURES } from "./fixtures.mts";

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

  /**
   * Async workload. The batch is fixed, so the microtask overhead is a constant on both sides
   * instead of a term that moves with whatever the change did to the number of awaits. The promise
   * has to cover all of the work: a body that starts something and resolves before it finishes
   * times the scheduling and looks very fast.
   *
   * Anything the workload would normally reach over the network or the disk is replaced by an
   * in-process double, or the measurement is of the machine's IO and not of the library.
   */
  {
    const requests = Array.from({ length: 200 }, (_, i) => ({ url: `https://example.test/item/${i}` }));
    cases.push({
      name: "resolve-batch",
      run: async () => {
        for (const r of requests) await lib.resolve(r, { transport: lib.nullTransport });
      },
      collect: async () => (await lib.resolve(requests[0], { transport: lib.nullTransport })).status,
    });
  }

  return cases;
}

/**
 * Optional: named checks for `differential.mts`, for inputs that are not strings. This is where a
 * change that stops copying something is caught, and the aliasing has to be exercised in both
 * directions, because a shared structure usually shows up in only one of them.
 */
export function buildDifferential(lib: any) {
  return {
    fixed: ["", "a", "a\r\nb", "  padded  "],
    random: (rand: () => number) => String(Math.floor(rand() * 1e9)),
    describe: (input: string) => lib.parse(input),
    scenarios: {
      "derived-then-mutate-source": () => {
        const source = { headers: { a: "1" } };
        const derived = lib.derive(source);
        source.headers.a = "2";
        return { derived: lib.describe(derived), source: source.headers };
      },
      "derived-then-mutate-derived": () => {
        const source = { headers: { a: "1" } };
        const derived = lib.derive(source);
        lib.setHeader(derived, "a", "3");
        return { derived: lib.describe(derived), source: source.headers };
      },
    },
  };
}
