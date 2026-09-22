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
- The budget. Default: 20 experiments.

## Step 1: Explore what already exists

Find out how the repo is built, tested and measured before you change anything. Look at the package manifest and its scripts, the test runner configuration, CI workflows, and any `bench*`, `perf*` or `profil*` directories. Also read CONTRIBUTING, agent instruction files (AGENTS.md, CLAUDE.md) and the recent history of perf-related commits and branches, including unmerged remote branches: maintainers often leave half-finished perf work that is prior art for your changes.

Report to the user:

- Package manager, how the tests run, and how long they take.
- Whether a benchmark exists (framework, what it measures, on which inputs), its metric, whether lower or higher is better, and how long one full run takes.
- Whether the tests pin observable behaviour, or only a subset.
- Which metric the maintainers actually accept. Look at merged perf PRs and their titles. Time is the default, but some maintainers value memory per instance or compressed bundle size more, and they reject wins on a metric they do not value. `references/methodology.md` (Other metrics) describes how to measure each one.

**Use what is there. Do not replace it.** An existing benchmark encodes what the maintainers consider representative. If it is inadequate, say so and propose an extension. If there is no benchmark, build the smallest one that exercises the real workload on realistic inputs, and confirm the workload choice with the user.

Existing benchmarks usually cannot serve as the A/B instrument, because they load one version of the code per process (often to compare against other libraries). Mirror their workloads into deterministic cases for the harness instead, and keep the original benchmarks as an external cross-check. `references/methodology.md` explains why.

## Step 2: Establish a correctness guard

Performance work that changes behaviour is not an optimisation. Before the first experiment, you need a check that fails when output changes.

If the test suite pins observable output, use it. If not, add a characterisation guard: run the current code over the benchmark inputs and record the results (return values, error messages and issue lists, or a hash of them if they are large). This captures current behaviour as-is, including bugs. The point is to prove that each change preserves behaviour, not that the code is correct.

Make the benchmark cases deterministic (seeded random data), so that the same case definitions feed both the guard and the A/B harness. Each runtime folder ships a guard script for this.

If the inputs are files (Markdown, JSON, YAML fixtures), add them to the formatter's ignore list and check that a formatter run leaves them untouched. Formatters rewrite code blocks inside Markdown, which silently changes the dataset and moves every measurement.

Commit the guard before the first experiment. Never edit it afterwards to make a change pass.

## Step 3: Build the paired A/B harness

Comparing two separate benchmark runs does not work at the effect sizes of this work. Absolute timings drift by several percent with machine state, which is larger than most individual changes. Measure two git revisions against each other instead:

- Materialise each revision with `git archive <rev> <paths> | tar -x -C <dir>`, one directory per side, so that comparing a revision with itself gives two real copies.
- Default the second revision to the working tree, so that the common call is "current work vs. last commit".
- Alternate A and B on every timed iteration, and swap which one runs first, so neither side benefits from a cache that the other warmed.
- Take the minimum per case. The work is deterministic, so noise can only add time.
- Discard warm-up iterations before timing.
- Print per-case numbers, a total, and a percentage delta.

Copy the matching runtime folder into the repo (for example `perf/`) and adapt the documented extension points. If no runtime folder fits, use `runtimes/generic/`, or write a new runtime that meets the contract in `runtimes/README.md`.

Keep all harness scratch directories out of git. Prefer `.git/info/exclude` over `.gitignore`, so the exclusions do not leak into the commits that later become PRs.

Before you trust the harness, run a **canary**: put a deliberate slowdown (a short busy loop) into one function in the working tree, and compare `HEAD` with the working tree. Only the cases that call that function must slow down. If no case moves, or all cases move, the harness does not measure the revision you think it measures (typical cause: a materialised tree that still imports code from the working tree). Remove the canary before you continue.

## Step 4: Calibrate the threshold

Run the A/B comparison with identical code on both sides three times. Discard a first run that materialised trees or compiled caches, because it runs cold. The largest absolute TOTAL deviation you see is the noise floor of this repo on this machine. Set the keep bar at about twice that, and never below 1%. Note the per-case noise too: some cases (allocation-heavy or GC-bound ones) are much noisier than the rest.

Record the noise floor and the bar in the plan. Every later decision refers to them.

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
- A change that targets one path may keep on a per-case rule: the targeted case clears twice its own noise band in both runs (5% is a reasonable default) and the total does not regress. Say so in the log.
- Simpler is better, all else equal. The bar gates changes that add complexity. A change that removes code and is performance-neutral is worth keeping. A win that adds a cache with a subtle invariant probably is not. Record how you weighed it.
- If the total improves but a single case clearly regresses, say so instead of hiding it in the average.
- If the guard changes, the change altered behaviour. Discard it, log it as `behaviour`, and keep it as a decision for the user. Never update the guard to make it pass.
- If the tests fail, fix only trivial mistakes in your change. Otherwise discard and log `fail`. Do not spend more than a couple of attempts on one idea.
- If a benchmark run takes more than three times its usual duration, kill it, discard the change and log `fail`.
- Bundle two ideas into one experiment only when each is too small to measure alone. When a bundle regresses, split it before you give up on its parts: one part can hide a large regression behind the gains of the others.
- Profile before guessing, and re-profile after each kept change, because the hot spots move. Ignore loader and harness frames.
- If a pre-commit hook reformats or auto-fixes files, run the guard and tests again on the committed state.

## Step 7: The loop

One small, isolated change at a time:

1. Make the change.
2. Run the guard and the tests, then commit. Commit before benchmarking, so a discarded experiment stays recoverable by its hash.
3. Run the A/B comparison against the previous commit, and a second time if the first clears the bar.
4. Keep by leaving the commit in place, or discard with `git reset --hard HEAD~1`.
5. Record the row in the log either way (`commit, delta1, delta2, status, description`), with the hash even for discards. `delta2` is empty when the first run already rejected the change. Write up the approach and the reasoning in the plan.

## Step 8: When to stop

- **Dry.** Three consecutive experiments that are not kept means you are stuck, not finished. Re-profile from scratch, write at least five new candidates in the plan, each in a different part of the system than the last three attempts, and work through them. Stop when a diversification round ends with three consecutive non-kept experiments and nothing kept in between.
- **Budget.** Stop at the experiment budget from step 0 (default 20).

Never stop because you ran out of ideas. An idea that would change behaviour or needs a redesign is a reason to log it as a decision item and move on.

Then summarise in the plan: what was kept, what was rejected and why, the cumulative improvement (one A/B of the pre-loop commit against the final commit, run twice), and what is left worth trying. Also run the repo's own benchmark as an external cross-check and report it with its caveats. Commit the plan and the log.

## Step 9: Package kept commits as PRs

Follow `references/pr-packaging.md`. In short: group the kept commits into a few independent PRs by theme, cherry-pick each group onto a fresh base branch in its own worktree, verify each branch alone (tests, guard, a noise-control run, two A/B runs against the base), and write each PR body from `templates/pr-body.md`.

Show the user each PR (title, branch, commits, verification table, body) and wait for confirmation before you push or create it. Create each PR only after its confirmation. Follow the target repo's own PR conventions where they exist.
