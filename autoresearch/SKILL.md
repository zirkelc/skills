---
name: autoresearch
description: Run a systematic performance-optimization campaign on a codebase as an autoresearch loop. Explore how the repo builds, tests and benchmarks; pin behaviour with a characterisation guard; build a paired A/B harness that compares two git revisions; calibrate the noise floor; then run one small experiment at a time, keep or discard each against a measured bar, diversify when stuck, and finally package the kept commits into independently verified PRs. Use this skill whenever the user wants to make a library or project measurably faster or leaner across many experiments, asks for a perf campaign, "autoresearch", "optimize this repo", "find performance wins", "benchmark and speed up X", or wants perf PRs for an open source project, in any language or runtime. Not for a single quick "why is this one function slow" question.
argument-hint: "[optional focus and budget, e.g. 'error path, 10 experiments' or 'memory per instance']"
---

# Autoresearch: performance campaigns

Improve the performance of a repository through many small, isolated experiments. Every experiment is committed, measured against the previous commit with a paired A/B comparison, and kept only when it clears a bar that you measured, not guessed. The branch ends as a linear record of kept changes. Every discarded attempt stays reachable by its hash in the log.

The method is runtime-agnostic. The scripts that implement it live in `runtimes/<runtime>/`. Read `runtimes/README.md` to pick one.

Supporting material, read when the step says so:

- `references/methodology.md`: why pairing, minima, load orders and noise bars matter, and how to read and report the numbers.
- `references/pr-packaging.md`: how to turn kept commits into PRs (step 9).
- `templates/`: plan, experiment log and PR body skeletons.

## Step 0: Agree on scope before touching anything

The loop commits often and discards with `git reset --hard`. Do not run it on a branch that holds unrelated work.

Ask the user, in one question round:

- Which branch or worktree to use. Recommend a dedicated branch or worktree, but create it only after the user confirms. A worktree inside the repo directory must be excluded from the test runner globs and the formatter paths, otherwise every test runs once per worktree and the formatter rewrites files of the other worktree.
- The focus (whole library, a specific path such as errors or construction) and the metric, if the user already knows it. Step 1 checks the metric against what the maintainers value.
- The budget. Default: 20 experiments. Say that this turns into a wall-clock figure in step 4, once the harness exists and one run has a duration.

## Step 1: Explore what already exists

Find out how the repo is built, tested and measured before you change anything. Look at the package manifest and its scripts, the test runner configuration, CI workflows, and any `bench*`, `perf*` or `profil*` directories. Also read CONTRIBUTING, agent instruction files (AGENTS.md, CLAUDE.md) and the recent history of perf-related commits and branches, including unmerged remote branches: maintainers often leave half-finished perf work that is prior art for your changes.

Report to the user:

- Package manager, how the tests run, and how long they take.
- Whether a benchmark exists (framework, what it measures, on which inputs), its metric, whether lower or higher is better, and how long one full run takes.
- Whether the tests pin observable behaviour, or only a subset.
- Whether the repo ships a build that is sold on size (a mini, browser or edge entry point), whether a size budget is enforced anywhere, and on which bytes. A change that adds a code path adds bytes to every build that includes it, and a size-sensitive project will reject a real time win that breaks its budget.
- Which artifacts are derived, which of them are committed, and which artifact each gate consumes. A repo that commits build output can run its tests against one artifact while the harness measures another. Answer it explicitly: if the tests load `cjs/` and you change `src/`, every guard run is green for the wrong reason.
- Which metric the maintainers actually accept. Look at merged perf PRs and their titles. Time is the default, but some maintainers value memory per instance or compressed bundle size more, and they reject wins on a metric they do not value. `references/methodology.md` (Other metrics) describes how to measure each one.

**Use what is there. Do not replace it.** An existing benchmark encodes what the maintainers consider representative. If it is inadequate, say so and propose an extension. If there is no benchmark, build the smallest one that exercises the real workload on realistic inputs, and confirm the workload choice with the user.

Existing benchmarks usually cannot serve as the A/B instrument, because they load one version of the code per process (often to compare against other libraries). Mirror their workloads into deterministic cases for the harness instead, and keep the original benchmarks as an external cross-check. `references/methodology.md` explains why.

## Step 2: Establish a correctness guard

Performance work that changes behaviour is not an optimisation. Before the first experiment, you need a check that fails when output changes.

If the test suite pins observable output, use it. If not, add a characterisation guard: run the current code over the benchmark inputs and record the results (return values, error messages and issue lists, or a hash of them if they are large). This captures current behaviour as-is, including bugs. The point is to prove that each change preserves behaviour, not that the code is correct.

A guard proves behaviour on the inputs you chose, and nothing else. Choose them so that the cheap wins of this kind of work are observable: if the library memoizes, caches or otherwise shares structures between results, include an input where the same object is reachable twice (a shared node, a cycle, a repeated reference). Without such an input, every change that stops copying something looks behaviour-preserving.

Make the benchmark cases deterministic (seeded random data), so that the same case definitions feed both the guard and the A/B harness. Each runtime folder ships a guard script for this.

If the inputs are files (Markdown, JSON, YAML fixtures), add them to the formatter's ignore list and check that a formatter run leaves them untouched. Formatters rewrite code blocks inside Markdown, which silently changes the dataset and moves every measurement.

Inputs that come from outside the repo (downloaded pages, third-party corpora) need three things the repo cannot give them: keep them untracked (`.git/info/exclude`), because they are someone else's content; ship a fetch script and a manifest with the URL, sha256 and date of every file (`templates/fetch-fixtures.sh`), because the PR has to tell a maintainer how to reproduce them; and record the guard once against that snapshot. Live sources change, so a later mismatch must be attributable to your change and not to a re-download.

Commit the guard before the first experiment. Never edit it afterwards to make a change pass.

## Step 3: Build the paired A/B harness

Comparing two separate benchmark runs does not work at the effect sizes of this work. Absolute timings drift by several percent with machine state, which is larger than most individual changes. Measure two git revisions against each other instead:

- Materialise each revision with `git archive <rev> <paths> | tar -x -C <dir>`, one directory per side, so that comparing a revision with itself gives two real copies.
- Default the second revision to the working tree, so that the common call is "current work vs. last commit".
- Alternate A and B on every timed iteration, and swap which one runs first, so neither side benefits from a cache that the other warmed.
- Take the minimum per case. The work is deterministic, so noise can only add time.
- Discard warm-up iterations before timing.
- Print per-case numbers, a total, and a percentage delta.

Copy the matching runtime folder into the repo (for example `perf/`) and adapt the documented extension points. If no folder fits the target runtime, write one against the contract in `runtimes/README.md`, which also describes the out-of-process pattern for runtimes that cannot load two revisions at once. Budget an hour for that, and treat the new harness itself as the first experiment: the canary and the control runs below decide whether it measures anything.

Keep all harness scratch directories out of git. Prefer `.git/info/exclude` over `.gitignore`, so the exclusions do not leak into the commits that later become PRs.

Before you trust the harness, run a **canary** twice, once for each instrument:

- For the harness: put a deliberate slowdown (a short busy loop) into one function in the working tree, and compare `HEAD` with the working tree. Only the cases that call that function must slow down. If no case moves, or all cases move, the harness does not measure the revision you think it measures (typical cause: a materialised tree that still imports code from the working tree).
- For the gates: with that same edit in place, run the guard and the tests **without** regenerating any derived artifact. At least one of them must fail. If they all pass, they are reading an artifact your changes never reach, and every later green run means nothing.

Remove the canary before you continue.

## Step 4: Calibrate the threshold

**Measure the machine first.** A calibration run on a busy machine measures the other work. Run the runtime's readiness probe (`jitter.mts` in node-ts): it times one pure CPU loop many times and reports how far the median sits above the minimum. Calibrate only when that spread is within about 5%; otherwise wait, or tell the user what is running. The probe decides, not the load average, which lags and says nothing about which core the process gets. Re-run it before every confirmation run, and discard runs whose machine was busy.

Then run the A/B comparison with identical code on both sides three times. Discard a first run that materialised trees or compiled caches, because it runs cold.

Record in the plan:

- The probe numbers (min, p50, max), so a later reader can tell a quiet campaign from a noisy one.
- The noise floor for **both** summary numbers, the time-weighted total and the equally weighted geometric mean.
- The band of **each case**, taken from the same three runs. Bands differ by a factor of three between large and short cases, so a single default would keep noise in one case and discard a real effect in another.
- The keep bar: about twice the noise floor, never below 1%.
- One run's duration multiplied by about 2.5 times the experiment budget (every kept change needs a confirmation run, and the gates are not free). If that does not fit the session, tune the iteration and child counts now and say what the budget means in hours.

## Step 5: Baseline and plan

Run the tests and the benchmark unchanged, and record the numbers. Profile the workload (the runtime folder has a profiler helper) and note where the time goes.

Write the plan from `templates/plan.md` and the log from `templates/experiments.tsv` (tab-separated, because commas break descriptions): what the repo does, what the benchmark measures, baseline numbers, noise floor, keep bar, and an initial candidate list ranked by profile weight.

Where the large wins usually are:

- **Work at construction that most callers never use.** An error message formatted eagerly although most callers only read the issue list; per-instance closures for rarely used methods; a lazy value that a subclass constructor forces immediately, which defeats its lazy design.
- **Failure paths.** Errors often cost 10 to 50 times more than successes, and benchmarks rarely cover them.
- **Allocations per call on leaf paths.** When one call takes nanoseconds, one object less per call can be 15%.

A code comment that documents a performance trade-off (for example "kept eager for monomorphic call sites") is evidence. Test it with one experiment if you doubt it, then accept the result. In one campaign, reversing such a trade-off regressed hot paths by 11 to 38%.

Keep the plan and the log out of git while the loop runs, because a discard resets the working tree. Use `.git/info/exclude`: pre-commit hooks in some repos reject untracked files, and exclusions in `.gitignore` would end up in your first experiment commit. Commit both at the end.

## Step 6: Rules

- Only changes to the implementation count. Never touch the benchmark, its inputs, or the guard to move the numbers.
- Judge every change with the A/B comparison against the previous commit.
- Discard anything under the bar immediately. At or above it, run the comparison a second time and keep the change only if both runs clear the bar. First runs mislead: one experiment measured -3.2% and then +0.4%.
- Log every discard with its measured delta, and mark anything above roughly half the bar as a **near miss**. Effects under the bar are still effects: when you later touch the same area, bundle the near misses in. One campaign recovered a whole PR that way, six experiments after the original discard.
- A change that targets one path may keep on a per-case rule: the targeted case clears twice its own band from step 4 in both runs, and the summaries do not regress. Say so in the log.
- A marked row (the harness flags a band that contains 0%, or one that is wide against its median) says that **this run** does not confirm it, not that the change does nothing. Use the second run, and a standalone run when the row is a case the change did not touch. A row marked in both runs is no effect; a row marked once and clean once is a noisy case with a real effect.
- Simpler is better, all else equal. The bar gates changes that add complexity. A change that removes code and is performance-neutral is worth keeping. A win that adds a cache with a subtle invariant probably is not. Record how you weighed it.
- A change whose correctness rests on the rest of the codebase keeping an invariant ("nothing writes to this shared object", "this structure is never aliased") costs more than its diff: it constrains future work, and a later, unrelated change can break it without touching your code. Name the invariant in the log and in the PR body, and weigh it as complexity, not as a free win.
- If the total improves but a single case clearly regresses, say so instead of hiding it in the average.
- Measure the compressed size delta of every change that adds a code path (a fast path, a cache, a new branch), and weigh it with the time delta. In a project with a size budget, bytes can reject a real win.
- A change that removes a defensive copy, or that starts mutating in place, needs an input where the aliasing is observable before the guard means anything. Add that case first, then make the change.
- Regenerate every committed derived artifact before the guard and the tests, and again after a discard: `git reset --hard` restores the sources but leaves the generated files of the abandoned experiment in place.
- Run what CI runs, not only the test command, but split it by cost: the cheap gates (tests, lint, type check) before every commit, the expensive ones (coverage, docs build, whole-CI equivalent) before a keep becomes final. A change that needs a new test to hold the project's coverage rule is more expensive than its delta suggests; weigh that in the keep decision and record it in the log.
- If the guard changes, the change altered behaviour. Discard it, log it as `behaviour`, and keep it as a decision for the user. Never update the guard to make it pass.
- If the tests fail, fix only trivial mistakes in your change. Otherwise discard and log `fail`. Do not spend more than a couple of attempts on one idea.
- If a benchmark run takes more than three times its usual duration, kill it, discard the change and log `fail`.
- Bundle two ideas into one experiment only when each is too small to measure alone. When a bundle regresses, split it before you give up on its parts: one part can hide a large regression behind the gains of the others.
- Profile before guessing, and re-profile after each kept change, because the hot spots move. Ignore loader and harness frames, but not dependency frames: a library that hands its hot loops to a dependency spends most of its time there.
- Before you report, act on, or discard for a per-case regression in code the change did not touch, confirm it standalone (one revision per process). Two module instances in one process can produce a stable delta that does not exist.
- If a pre-commit hook reformats or auto-fixes files, run the guard and tests again on the committed state.

## Step 7: The loop

One small, isolated change at a time:

1. Make the change.
2. Run the guard and the tests, then commit. Commit before benchmarking, so a discarded experiment stays recoverable by its hash.
3. Run the A/B comparison against the previous commit, and a second time if the first clears the bar.
4. Keep by leaving the commit in place, or discard with `git reset --hard HEAD~1`.
5. Record the row in the log either way (`commit, delta1, delta2, status, description`), with the hash even for discards. `status` is `keep`, `discard`, `near-miss`, `behaviour` or `fail`. `delta2` is empty when the first run already rejected the change. Write up the approach and the reasoning in the plan.

## Step 8: When to stop

- **Dry.** Three consecutive experiments that are not kept means you are stuck, not finished. Re-profile from scratch, write at least five new candidates in the plan, each in a different part of the system than the last three attempts, and work through them. Stop when a diversification round ends with three consecutive non-kept experiments and nothing kept in between.
- **Budget.** Stop at the experiment budget from step 0 (default 20).

Never stop because you ran out of ideas. An idea that would change behaviour or needs a redesign is a reason to log it as a decision item and move on.

Then summarise in the plan: what was kept, what was rejected and why, the cumulative improvement (one A/B of the pre-loop commit against the final commit, run twice), and what is left worth trying. Also run the repo's own benchmark as an external cross-check and report it with its caveats. Commit the plan and the log.

## Step 9: Package kept commits as PRs

Follow `references/pr-packaging.md`. In short: group the kept commits into a few independent PRs by theme, cherry-pick each group onto a fresh base branch in its own worktree, verify each branch alone (tests, guard, a noise-control run, two A/B runs against the base), and write each PR body from `templates/pr-body.md`.

Show the user each PR (title, branch, commits, verification table, body) and wait for confirmation before you push or create it. Create each PR only after its confirmation. Follow the target repo's own PR conventions where they exist.
