# node-ts runtime

In-process A/B harness for JavaScript and TypeScript libraries on Node.js (tested with Node 24 and `tsx`).

## Files

| File | Purpose |
|---|---|
| `harness.mts` | Shared helpers: config, `git archive` materialisation, case loading, seeded `rng`, `fnv1a`, `timeNs` |
| `ab.mts` | Paired timing of two revisions, both load orders, geometric mean |
| `guard.mts` | Characterisation guard over the cases' `collect()` samples |
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
pnpm exec tsx perf/guard.mts --update           # once, before the first experiment
pnpm exec tsx perf/guard.mts                    # before every experiment commit
pnpm exec tsx perf/ab.mts main main             # noise control (discard the first, cold run)
pnpm exec tsx perf/ab.mts                       # HEAD vs working tree
pnpm exec tsx perf/ab.mts HEAD~1 HEAD           # previous commit vs current commit
pnpm exec tsx perf/mem.mts main HEAD            # bytes per instance, cases with alloc()
pnpm exec tsx perf/profile.mts                  # all cases, 4 s
pnpm exec tsx perf/profile.mts fail-case --seconds 2 --top 15
```

Every script also takes `--entry`, `--src` (repeatable) and `--cases` to override the config. `ab.mts` takes `--iters` (25), `--warmup` (4), `--target-ms` (1.5 per timed iteration) and `--repeats` (2 children per load order). One run of 12 cases takes about 8 s.

## Reading the output

`ab.mts` prints per case the minimum ms of one case body for A and B, the delta (negative = B faster) and the speed-up (`A / B`). The total delta uses the summed minima of both load orders. `mem.mts` prints bytes retained per instance; identical code gives a delta of exactly 0.0, so any non-zero delta is real.

## Traps

- **Hidden classes.** On V8, an accessor (getter/setter) as an own property of instances or of hot internal objects can move those objects out of fast-properties mode. Code that never touches the property then slows down: in one campaign, parse paths regressed by 57% to 142%. The inverse is a large win: moving the last per-instance accessor to the prototype made unrelated parse paths 12 to 58% faster. Prefer data properties on instances, and put accessors on shared prototypes.
- **Leaf paths are allocation-bound.** When one call takes about 15 ns, a shared frozen object instead of a fresh one per call gave 15%. Look for object literals, closures and spreads created on every call.
- **Line numbers in profiles** can show as `:1` when the TypeScript loader transforms files without line-preserving source maps. Rely on function and file names.
- **Error construction** often dominates failure paths (stack capture). Changing it usually changes `error.stack`, which is observable: treat it as a decision item, not as an experiment.
- **ESM only.** Keep the harness as `.mts`. `import.meta.dirname` is undefined under CommonJS, and the failure looks like an unrelated path error.
- **Module names.** Do not name a module like a sibling directory: `dataset.ts` next to `dataset/` resolves to the directory.
