# node-ts runtime

In-process A/B harness for JavaScript and TypeScript libraries on Node.js.

Node 24 runs the `.mts` files directly (it strips the types), so the harness itself needs no loader and the target repo's manifest can stay untouched, which matters when you are about to send that repo a PR. The library under test decides whether that is enough: plain JavaScript sources, or TypeScript that Node can strip, run as they are. Sources that rely on a loader's resolution (TypeScript files imported through `.js` specifiers, path aliases, custom conditions) still need `tsx`, so run every command through `pnpm exec tsx` instead. Check once with `node perf/guard.mts` before adding a dependency.

## Files

| File | Purpose |
|---|---|
| `harness.mts` | Shared helpers: config, `git archive` materialisation, case loading, seeded `rng`, `fnv1a`, `timeNs` |
| `ab.mts` | Paired timing of two revisions, both load orders, median of paired ratios |
| `guard.mts` | Characterisation guard over the cases' `collect()` samples |
| `jitter.mts` | Machine-readiness probe, with a wait mode. Run before calibrating and before every run |
| `scan.mts` | Scaling scan: each input shape at n and 4n, to find superlinear paths |
| `differential.mts` | Compares two revisions over generated and edge-case inputs, beyond the guard |
| `selftest.mts` | Builds a synthetic monorepo in a temp directory and checks the tree logic. Run it after changing `harness.mts` |
| `solo.mts` | One case, one revision per process. Confirms a suspicious row, and produces the number a PR reports |
| `mem.mts` | Retained bytes per instance, for cases that define `alloc()` |
| `profile.mts` | In-process CPU profile of the cases, aggregated per function or per area |
| `quiet.sh` | Waits for a quiet machine, then runs a harness command |
| `micro.example.mjs` | Throwaway isolation check: one function, current against candidate, before it costs an experiment |
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
5. Check the case bodies before you calibrate: `node perf/ab.mts --sizes` times each one and names the ones outside the usable range. It costs seconds, and a fixture found to be wrong during calibration costs the calibration.
6. Trees go to `node_modules/.perf-trees/` automatically, where every tool already ignores them. Only `.perf-prof/` needs an exclude entry:
   ```sh
   printf '.perf-prof/\n' >> "$(git rev-parse --git-common-dir)/info/exclude"
   ```
   That hides it from git and from nothing else, so check whether the repo's formatter, linter or type checker reaches `perf/` itself, and add their ignore entries in the harness commit. Commit the harness (`perf/*.mts`, `perf.config.json`, `guard-expected.json`) with the guard, before the first experiment.

## Generated builds and monorepos

Extra config keys, all optional, for repos where the sources are not what users load:

| key | purpose |
|---|---|
| `build` | Command run in each tree after unpacking. Set it whenever the shipped artifact is generated, especially when it is gitignored. The working tree is then materialised and built too, keyed by the content of its sources, so no side can measure a stale artifact. |
| `buildWorkspaces` | Command run per workspace, in the root manifest's order, for builds where a package needs its dependencies built first. |
| `copyDependents` | Regular expression over the root `node_modules`, as an addition to the automatic closure below. |
| `entryModules` | Map of alias to specifier. The harness writes a `perf-entry.mjs` per tree that re-exports them, so the cases get one `lib` whose parts all come from one revision. The alias `*` re-exports flat, so cases need no shim. A specifier starting with `.` or `/` is a path inside the tree, anything else is a package name. |
| `entrySource` | Raw source for that entry, when aliases are not expressive enough. |
| `verifyResolve` | Package names whose resolution must stay inside the tree. Checked at materialisation, before any measurement. |

Three things happen automatically, because getting them wrong puts one revision on both sides of the comparison and produces numbers that look ordinary:

- **Manifests travel with the sources.** The `package.json` of every directory above a source path is materialised too. Without them the tree has no `"type": "module"` and no `exports`, so ESM sources load as CommonJS and resolution behaves unlike the real package.
- **Workspace packages are linked** into the tree's own `node_modules`, so packages that import each other by name resolve within the tree.
- **Dependents are copied by dependency closure.** Starting from `entryModules`, any package that depends on a workspace package, or on a package that must be copied, is copied in with `dereference: true`. A regex cannot be trusted here: one campaign's pattern missed a package two levels down, and the leak was silent because a build happened to lie on disk. `copyDependents` remains for what the closure cannot see.

`verifyResolve` checks from the tree root **and** from inside every copied dependent, which is where a missing copy shows up. Only workspace packages, the copied set and the names you list have to resolve inside the tree: a shared dependency that never reaches your code is meant to resolve to the root, and reporting those made a real monorepo unusable (twenty reports, none of them real). Paths are compared after `realpath`, because a repo reached through a symlink otherwise makes every import look like an escape. The tree key includes the config that shapes a tree, so changing `build`, `copyDependents` or `entryModules` builds a new tree instead of reusing the old one.

## Commands

Run through the repo's package manager so the local `tsx` is used, for example `pnpm exec tsx`.

```sh
node perf/jitter.mts                            # is the machine quiet enough to measure?  (no loader needed)
node perf/jitter.mts --wait 10                  # wait up to 10 min for a quiet machine, then exit 0
node perf/jitter.mts --max 5 --wait 60          # shared machine: record the threshold in the plan
sh perf/quiet.sh pnpm exec tsx perf/ab.mts HEAD~1 HEAD   # wait for quiet, then measure
node perf/ab.mts --sizes                        # are the case bodies usable? run before calibrating
node perf/scan.mts                              # scaling scan: n against 4n per input shape
node perf/differential.mts main WORKTREE        # behaviour on inputs the guard does not cover
pnpm exec tsx perf/guard.mts --update           # once, before the first experiment
pnpm exec tsx perf/guard.mts                    # before every experiment commit
pnpm exec tsx perf/guard.mts main --update      # add cases mid-campaign, recorded against the base
pnpm exec tsx perf/ab.mts main main             # noise control (discard the first, cold run)
pnpm exec tsx perf/ab.mts                       # HEAD vs working tree
pnpm exec tsx perf/ab.mts HEAD~1 HEAD           # previous commit vs current commit
pnpm exec tsx perf/ab.mts HEAD~1 HEAD --only cookies --iters 150   # decide one targeted case
pnpm exec tsx --expose-gc perf/solo.mts main query-large    # confirm one case, one revision
pnpm exec tsx perf/solo.mts main HEAD query-large --pairs 4  # the number a PR reports
pnpm exec tsx perf/mem.mts main HEAD            # bytes per instance, cases with alloc()
pnpm exec tsx perf/profile.mts                  # all cases, 4 s
pnpm exec tsx perf/profile.mts fail-case --seconds 2 --top 15 --deps
pnpm exec tsx perf/profile.mts --by-area        # how much of this profile is my instrument?
pnpm exec tsx perf/profile.mts --callers resolveAll   # who calls the hot function
pnpm exec tsx perf/profile.mts --lines resolveAll     # which statements inside it are hot
pnpm exec tsx perf/profile.mts --lines src/parse.js:120   # the same, for an anonymous function
node perf/micro.mjs                             # candidate against current, one function, no experiment spent
```

Every script also takes `--entry`, `--src` (repeatable), `--cases` and `--only` to override the config. `ab.mts` takes `--iters` (25), `--warmup` (3), `--target-ms` (1.5 per timed iteration) and `--repeats` (1 child per load order).

### Three levels of measurement, three jobs

| Command | Answers | Use it for |
|---|---|---|
| `ab.mts` (full suite) | Did anything else move? | The two summaries, and a regression in a case the change did not target |
| `ab.mts --only <case>` | Did the targeted case move? | Every per-case keep and discard. Same time buys far more paired iterations, and the other cases' heap is gone |
| `solo.mts A B <case> --pairs 4` | What will a maintainer measure? | The number a PR reports |

They give different answers on purpose, and each step removes another part of the co-residency effect: one change measured -69% paired on the full suite, -54% focused and -32% standalone. A focused number may only be compared with a focused control, never with a full-suite band, because the precision comes partly from the other cases being absent.

Tune `--iters` and `--repeats` in step 4, against this machine and the session's time budget: one A/B run must fit about 2.5 times the experiment budget. Under the paired-ratio estimator, more iterations in one child buy more than more children, because every extra iteration is another paired sample while another child only repeats the whole measurement. **On a shared machine this reverses.** A run is only data if the machine was quiet for all of it, so a long run is more likely to catch a burst and be thrown away: one campaign found 60-iteration runs overlapping bursts far more often than 25-iteration runs. Keep the runs short enough to fit between bursts and buy precision with `--only` instead.

## Reading the output

Per case, `ab.mts` prints the minimum ms of one body for A and B, the delta, the band and the speed-up.

- **delta** is the median of the per-iteration ratios: A and B run back to back inside one iteration, so they share the machine state and the pairing survives. Negative means B is faster.
- **A and B in ms** are per-side minima. They are the best estimate of each side's true cost, but their quotient is not the delta, because the two minima come from different moments.
- **band** is the interquartile range of the per-iteration deltas. Both markers describe this run, not the change. `?` means the band contains 0%: the iterations disagree about the direction, so this run does not confirm the row. `~` means the band is wide against its own median, which is what an in-process artefact or a too-short case looks like. `?` wins when both would apply, because a band around zero is wide against its own median almost by definition; `~` alone is the interesting shape, a confident-looking median that the iterations do not support. Confirm a marked row with the second run the method already requires, or with `solo.mts`. Treat a row as no effect only when both runs mark it; a row marked once and clean once is a noisy case, not a dead one. Neither marker is a reason to discard on its own.
- **TOTAL** weights each case by its time, **GEOMEAN** weights every case equally. Gate on both. When they disagree, one big case is paying for several small ones (or the reverse), and the per-case lines say which.
- **machine after the run** is a short probe once the children have finished. A run is only valid if the machine was quiet for all of it, and that cannot be known before it ends. It does not certify the run either: a burst that starts and ends inside it passes both this and the probe before. Treat a BUSY verdict as an invalid run, log it, and repeat it.
- **warnings** name a case and what is wrong with it: a body outside the usable range, or a side that ran materially slower at the end of the run than at the start. The second means the case accumulates state across calls, or the machine got busier while it ran.

`mem.mts` prints bytes retained per instance. Identical code gives a delta of exactly 0.0, so any non-zero delta is real.

## Traps

- **Hidden classes.** On V8, an accessor (getter/setter) as an own property of instances or of hot internal objects can move those objects out of fast-properties mode. Code that never touches the property then slows down: in one campaign, parse paths regressed by 57% to 142%. The inverse is a large win: moving the last per-instance accessor to the prototype made unrelated parse paths 12 to 58% faster. Prefer data properties on instances, and put accessors on shared prototypes.
- **Leaf paths are allocation-bound.** When one call takes about 15 ns, a shared frozen object instead of a fresh one per call gave 15%. Look for object literals, closures and spreads created on every call.
- **Line numbers in profiles** can show as `:1` when the TypeScript loader transforms files without line-preserving source maps. Rely on function and file names, and for `--lines` prefer Node's own type stripping, which keeps the lines.
- **Inlined functions break line-level attribution.** Self time above total time for a frame means V8 inlined it into its caller, and an inlined function can also vanish from the profile completely. The line view inside such a function is not evidence: one campaign spent an experiment on a statement a profile called hot. Confirm with `--callers`, or accept the function-level number.
- **Error construction** often dominates failure paths (stack capture). Changing it usually changes `error.stack`, which is observable: treat it as a decision item, not as an experiment.
- **Case size is part of the instrument.** Keep a timed body between roughly 5 and 50 ms. A body of hundreds of milliseconds contains a collection almost by construction, so no estimator filters it out, and a body under 1 ms is dominated by jitter (its band will be enormous, which the output shows).
- **Let a case own its inputs.** Build them in `setup`, drop them in `teardown`. Inputs of every case held alive for a whole run exist twice, once per revision, and make every later collection slower on both sides. A workload that mutates its input has to rebuild it in `setup` or inside `run`.
- **A case must not accumulate state across calls.** Listeners on a long-lived object, a cache, a registry: anything that grows per call makes each iteration slower than the last. Nothing in the table shows it, because the reported milliseconds are a minimum (the cleanest early iteration) and the delta is a paired ratio (a drift that hits both sides cancels exactly). One campaign found 67% of a case's time inside a duplicate check walking a listener list the case itself had grown, and the timings had looked ordinary. The drift warning is the cheap detector; the first profile is the reliable one.
- **Async bodies must be self-contained and batched.** The timed region ends when the returned promise resolves, so a body that starts a timer or an unawaited chain measures the scheduling and looks very fast. A fixed batch per call keeps the microtask overhead a constant that pairing can cancel. Replace network and disk with an in-process double, or the measurement is of the machine.
- **Forced collection hides part of the cost.** The children run with `--expose-gc` and collect before every timed body, which stops one side from paying for the other side's garbage. It also means a change that allocates more garbage looks cheaper here than in production, so measure such changes with `mem.mts` as well.
- **Two revisions, one process.** Both revisions share the heap, and shared code sees their objects as polymorphic. A per-case delta on code that neither revision touched is not a result until `solo.mts` agrees with it: one campaign measured +21% paired against -3% standalone on such a case. The cases module is loaded once per side (a `?slot=` query on the import), which removes one source of this, not the artefact itself.
- **Two revisions share more than code.** Anything a library keeps on `globalThis` (config, registries, caches) belongs to whichever instance initialised last, for both sides. Timing survives it, since both sides then use the same state, but never compare behaviour in one process: `differential.mts` spawns one process per revision for exactly this reason.
- **A wide within-run band is not a small effect.** The marker uses the dispersion inside one run; the per-case bar uses the spread of medians across calibration runs. A short case can be marked in both runs and still carry a real effect that both runs agree on. Resolve it with `solo.mts`, not with the marker.
- **ESM only.** Keep the harness as `.mts`. `import.meta.dirname` is undefined under CommonJS, and the failure looks like an unrelated path error.
- **Module names.** Do not name a module like a sibling directory: `dataset.ts` next to `dataset/` resolves to the directory.
- **CommonJS libraries** work through `entryModules`: `"*": "./index.js"` for the public surface, plus a named alias per internal module the cases need (`"coreUtil": "./lib/core/util.js"`). The internals are usually the point, because that is where the hot functions are.
- **`git stash` without a pathspec** takes the harness change along with the experiment, and the next run measures neither. Stash by path during the loop, or use a temporary commit.
- **zsh eats a word that starts with `=`.** A marker like `echo ==== CONTROL` in a script fails with a message that reads as if the script were broken. Quote it.
