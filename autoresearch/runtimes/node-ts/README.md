# node-ts runtime

In-process A/B harness for JavaScript and TypeScript libraries on Node.js (tested with Node 24 and `tsx`).

## Files

| File | Purpose |
|---|---|
| `harness.mts` | Shared helpers: config, `git archive` materialisation, case loading, seeded `rng`, `fnv1a`, `timeNs` |
| `ab.mts` | Paired timing of two revisions, both load orders, median of paired ratios |
| `guard.mts` | Characterisation guard over the cases' `collect()` samples |
| `jitter.mts` | Machine-readiness probe. Run before calibrating and before every confirmation run |
| `solo.mts` | One case, one revision, its own process. Confirms a suspicious per-case delta |
| `mem.mts` | Retained bytes per instance, for cases that define `alloc()` |
| `profile.mts` | In-process CPU profile of the cases, aggregated per function |
| `cases.example.mts` | Case module skeleton |
| `perf.config.example.json` | Config skeleton |

## Setup

1. Copy the folder into the target repo, for example to `perf/`. It must be **inside** the repo: Node resolves dependencies by walking up from the importing file, so trees unpacked elsewhere cannot see `node_modules`.
2. Make sure `tsx` is available (`pnpm add -D tsx` if the repo lacks it). It loads TypeScript sources directly, so neither side gets a compiled vs source advantage.
3. Create `perf/perf.config.json` from the example:
   - `entry`: the module the cases import, relative to the repo root. Usually the package's source entry (`packages/lib/src/index.ts`), not its build output.
   - `src`: the paths archived per revision. Include every directory the entry imports by relative path. Workspace packages imported **by name** resolve through `node_modules` to the working tree, not to the archived revision. Add them to `src` and import them by path, or accept that they are shared between sides.
   - `cases`: the cases module (default `perf/cases.mts`).
4. Write `perf/cases.mts` from `cases.example.mts`. Mirror the workloads of the repo's existing benchmarks and use seeded data only.
5. Exclude scratch paths from git without touching tracked files:
   ```sh
   printf '.perf-trees/\n.perf-prof/\n' >> "$(git rev-parse --git-common-dir)/info/exclude"
   ```
   Commit the harness itself (`perf/*.mts`, `perf.config.json`, `guard-expected.json`) together with the guard, before the first experiment.

## Commands

Run through the repo's package manager so the local `tsx` is used, for example `pnpm exec tsx`.

```sh
pnpm exec tsx perf/jitter.mts                   # is the machine quiet enough to measure?
pnpm exec tsx perf/guard.mts --update           # once, before the first experiment
pnpm exec tsx perf/guard.mts                    # before every experiment commit
pnpm exec tsx perf/ab.mts main main             # noise control (discard the first, cold run)
pnpm exec tsx perf/ab.mts                       # HEAD vs working tree
pnpm exec tsx perf/ab.mts HEAD~1 HEAD           # previous commit vs current commit
pnpm exec tsx --expose-gc perf/solo.mts main query-large    # confirm one case, one revision
pnpm exec tsx perf/mem.mts main HEAD            # bytes per instance, cases with alloc()
pnpm exec tsx perf/profile.mts                  # all cases, 4 s
pnpm exec tsx perf/profile.mts fail-case --seconds 2 --top 15 --deps
```

Every script also takes `--entry`, `--src` (repeatable) and `--cases` to override the config. `ab.mts` takes `--iters` (25), `--warmup` (3), `--target-ms` (1.5 per timed iteration) and `--repeats` (1 child per load order).

Tune `--iters` and `--repeats` in step 4, against this machine and the session's time budget: one A/B run must fit about 2.5 times the experiment budget. Under the paired-ratio estimator, more iterations in one child buy more than more children, because every extra iteration is another paired sample while another child only repeats the whole measurement.

## Reading the output

Per case, `ab.mts` prints the minimum ms of one body for A and B, the delta, the band and the speed-up.

- **delta** is the median of the per-iteration ratios: A and B run back to back inside one iteration, so they share the machine state and the pairing survives. Negative means B is faster.
- **A and B in ms** are per-side minima. They are the best estimate of each side's true cost, but their quotient is not the delta, because the two minima come from different moments.
- **band** is the interquartile range of the per-iteration deltas. `?` means the band contains 0%: the iterations disagree about the direction, so report no effect whatever the median says. `~` means the band is wide against its own median, which is what an in-process artefact or a too-short case looks like. Both markers ask for a `solo.mts` run; neither is a reason to discard on its own.
- **TOTAL** weights each case by its time, **GEOMEAN** weights every case equally. Gate on both. When they disagree, one big case is paying for several small ones (or the reverse), and the per-case lines say which.

`mem.mts` prints bytes retained per instance. Identical code gives a delta of exactly 0.0, so any non-zero delta is real.

## Traps

- **Hidden classes.** On V8, an accessor (getter/setter) as an own property of instances or of hot internal objects can move those objects out of fast-properties mode. Code that never touches the property then slows down: in one campaign, parse paths regressed by 57% to 142%. The inverse is a large win: moving the last per-instance accessor to the prototype made unrelated parse paths 12 to 58% faster. Prefer data properties on instances, and put accessors on shared prototypes.
- **Leaf paths are allocation-bound.** When one call takes about 15 ns, a shared frozen object instead of a fresh one per call gave 15%. Look for object literals, closures and spreads created on every call.
- **Line numbers in profiles** can show as `:1` when the TypeScript loader transforms files without line-preserving source maps. Rely on function and file names.
- **Error construction** often dominates failure paths (stack capture). Changing it usually changes `error.stack`, which is observable: treat it as a decision item, not as an experiment.
- **Case size is part of the instrument.** Keep a timed body between roughly 5 and 50 ms. A body of hundreds of milliseconds contains a collection almost by construction, so no estimator filters it out, and a body under 1 ms is dominated by jitter (its band will be enormous, which the output shows).
- **Let a case own its inputs.** Build them in `setup`, drop them in `teardown`. Inputs of every case held alive for a whole run exist twice, once per revision, and make every later collection slower on both sides. A workload that mutates its input has to rebuild it in `setup` or inside `run`.
- **Forced collection hides part of the cost.** The children run with `--expose-gc` and collect before every timed body, which stops one side from paying for the other side's garbage. It also means a change that allocates more garbage looks cheaper here than in production, so measure such changes with `mem.mts` as well.
- **Two revisions, one process.** Both revisions share the heap, and shared code sees their objects as polymorphic. A per-case delta on code that neither revision touched is not a result until `solo.mts` agrees with it: one campaign measured +21% paired against -3% standalone on such a case. The cases module is loaded once per side (a `?slot=` query on the import), which removes one source of this, not the artefact itself.
- **ESM only.** Keep the harness as `.mts`. `import.meta.dirname` is undefined under CommonJS, and the failure looks like an unrelated path error.
- **Module names.** Do not name a module like a sibling directory: `dataset.ts` next to `dataset/` resolves to the directory.
