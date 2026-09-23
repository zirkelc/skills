# Runtimes

Each folder implements the autoresearch harness for one runtime. Pick the most specific folder that fits the target repo, copy it into the repo (for example to `perf/`), and adapt the documented extension points.

| Folder | Use for | Pairing |
|---|---|---|
| `node-ts/` | JavaScript and TypeScript libraries on Node.js | In-process: both revisions loaded as separate module instances, both load orders |

There is one folder, because there has been one ecosystem. For anything else, write a folder against the contract below and keep it: a harness that has run a campaign is worth shipping, one that has not is a guess with a table of contents.

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

- **In-process pairing is possible** when the runtime can load the same code twice under separate identities: JavaScript module instances (by file path), JVM class loaders, .NET AssemblyLoadContext. It is not practical for Python (module names are global per interpreter, native extensions cannot load twice) or for compiled languages.
- **Out-of-process pairing** covers everything else, and keeps every rule of the method except the load orders. Unpack each revision into its own directory, build it once per directory, then run the two benchmark commands alternately (A,B on even iterations, B,A on odd ones) so both sides of an iteration share the machine state. Keep the estimator: median of the per-iteration ratios for the delta, per-side minima for the absolute numbers, the two markers, both summaries. Expect a worse noise floor than in-process pairing and calibrate accordingly.
- **Language-native benchmark frameworks** (Rust criterion, Go `testing.B`, JMH, pytest-benchmark) are good case runners. Wrap them so each run prints one line per case with a duration, and parse that. Their own "compare with saved baseline" features compare two standalone runs, which is not paired, so do not use them for the decision. For Go, `benchstat` over interleaved runs is an acceptable alternative.
- **Per-case lifecycle and the guard** are not optional in a new runtime: without `setup`/`teardown` the inputs of every case stay alive on both sides, and without a guard the campaign has no evidence that anything it kept is behaviour-preserving.
- **Case lifecycle.** Cases need optional `setup`/`teardown` so large inputs exist only while their case runs; every harness script has to call them. Inputs of all cases alive at once exist twice, once per revision, and make every collection slower on both sides.
- **Resolution leaks** are the main correctness risk of any harness: the materialised tree may still import code from the working tree (workspace packages resolved by name, installed editable packages, shared build caches). Always run the canary test from `SKILL.md` step 3 on a new setup.
