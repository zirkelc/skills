# Runtimes

Each folder implements the autoresearch harness for one runtime. Pick the most specific folder that fits the target repo, copy it into the repo (for example to `perf/`), and adapt the documented extension points.

| Folder | Use for | Pairing |
|---|---|---|
| `node-ts/` | JavaScript and TypeScript libraries on Node.js | In-process: both revisions loaded as separate module instances, both load orders |
| `generic/` | Anything with a benchmark command: Rust, Go, C/C++, Python, JVM, Node CLIs | Out-of-process: built revisions run alternately (A,B then B,A) |

If no folder fits well, start with `generic/`. It is less sensitive than in-process pairing (process start-up and separate heaps add noise), so calibrate its noise floor with care. Add a dedicated runtime folder when you use the skill on a new ecosystem more than once.

## Contract for a runtime folder

A runtime folder must provide these capabilities. The method in `SKILL.md` depends on each of them.

1. **A/B timing of two revisions.** Takes two git revisions, the second one defaulting to the working tree. Materialises each committed revision with `git archive` into its own directory (one per side, so a revision compared with itself gives two real copies). Times the same deterministic cases on both sides in alternation, swapping the order on every iteration. Discards warm-up iterations. Reports per case the absolute times (per-side minima), the delta as the **median of the per-iteration ratios**, and the dispersion of those ratios; then two summaries, time-weighted and equally weighted. Where the runtime allows two copies in one process, it measures in-process and cancels load-order bias by running both orders.
2. **Characterisation guard.** Runs the cases' behaviour samples against the working tree, hashes them, and compares with recorded expectations. `--update` records expectations once, before the first experiment. Any difference exits non-zero.
3. **Profiler helper.** Profiles the cases against the working tree and prints self and total time per function, without frames from dependencies or the runtime's loader.
4. **Example cases.** One case definition, with seeded data, feeds both the A/B harness and the guard.
5. **A machine-readiness probe.** Times one pure CPU loop repeatedly and reports how far the median sits above the minimum, so a campaign does not calibrate against someone else's build.
6. **Standalone timing of one case against one revision**, in its own process, to confirm a per-case delta that the paired harness reports on untouched code.
7. **Optional: other metrics.** For example retained memory per instance, when maintainers value it.
8. **A README** with setup, commands, extension points and runtime-specific traps.

## Notes for new runtimes

- **In-process pairing is possible** when the runtime can load the same code twice under separate identities: JavaScript module instances (by file path), JVM class loaders, .NET AssemblyLoadContext. It is not practical for Python (module names are global per interpreter, native extensions cannot load twice) or for compiled languages; use the out-of-process pattern of `generic/`.
- **Language-native benchmark frameworks** (Rust criterion, Go `testing.B`, JMH, pytest-benchmark) are good case runners. Wrap them so each run prints `{"case": ..., "ns": ...}` lines and use `generic/ab_cmd.py --format json`. Their own "compare with saved baseline" features compare two standalone runs, which is not paired. For Go, `benchstat` on interleaved runs is an acceptable alternative.
- **Case lifecycle.** Cases need optional `setup`/`teardown` so large inputs exist only while their case runs; every harness script has to call them. Inputs of all cases alive at once exist twice, once per revision, and make every collection slower on both sides.
- **Resolution leaks** are the main correctness risk of any harness: the materialised tree may still import code from the working tree (workspace packages resolved by name, installed editable packages, shared build caches). Always run the canary test from `SKILL.md` step 3 on a new setup.
