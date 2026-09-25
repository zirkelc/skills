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
- Which artifacts are derived, which of them are committed or gitignored, and which artifact each gate consumes. A repo that commits or generates build output can run its tests against one artifact while the harness measures another: if the tests load `cjs/` and you change `src/`, every guard run is green for the wrong reason. If the shipped artifact is generated, the harness has to build every revision itself, and no side may fall back to whatever lies on disk, or an edit leaves one side measuring the previous experiment.
- Which metric the maintainers actually accept. Look at merged perf PRs and their titles. Time is the default, but some maintainers value memory per instance or compressed bundle size more, and they reject wins on a metric they do not value. `references/methodology.md` (Other metrics) describes how to measure each one.
- **Whether every gate can run at all, here, today.** Run each of them once on the base before you calibrate, the expensive ones included, and report any that needs sudo, a network, docker, a submodule or a service, with the exact command the user would have to run. A conformance suite that wants `/etc/hosts` entries stops a campaign three hours in, when the human who could have answered in one line has moved on. A gate that cannot run is a gate you do not have, and the plan has to say so.

**Use what is there. Do not replace it.** An existing benchmark encodes what the maintainers consider representative. If it is inadequate, say so and propose an extension. If there is no benchmark, build the smallest one that exercises the real workload on realistic inputs, and confirm the workload choice with the user.

Existing benchmarks usually cannot serve as the A/B instrument, because they load one version of the code per process (often to compare against other libraries). Mirror their workloads into deterministic cases for the harness instead, and keep the original benchmarks as an external cross-check. `references/methodology.md` explains why.

## Step 2: Establish a correctness guard

Performance work that changes behaviour is not an optimisation. Before the first experiment, you need a check that fails when output changes.

If the test suite pins observable output, use it. If not, add a characterisation guard: run the current code over the benchmark inputs and record the results (return values, error messages and issue lists, or a hash of them if they are large). This captures current behaviour as-is, including bugs. The point is to prove that each change preserves behaviour, not that the code is correct.

A guard proves behaviour on the inputs you chose, and nothing else. A change whose risky inputs the suite does not cover (long inputs, edge cases, anything a rewritten parser or resolver might handle differently) needs a differential run before it is kept: both revisions over generated and hand-picked inputs, compared on everything observable, structure as well as rendered output. Choose them so that the cheap wins of this kind of work are observable: if the library memoizes, caches or otherwise shares structures between results, include an input where the same object is reachable twice (a shared node, a cycle, a repeated reference). Without such an input, every change that stops copying something looks behaviour-preserving.

Make the benchmark cases deterministic (seeded random data), so that the same case definitions feed both the guard and the A/B harness. Each runtime folder ships a guard script for this.

A sample that is not deterministic turns the guard into a random number generator, and the damage is not the first failure but the habit of ignoring it. The node-ts guard samples twice when recording and refuses to write a key that moved; where a runtime cannot do that, record and then check once against unchanged code. When the output legitimately contains randomness (a mask, a nonce, a timestamp, an address), sample the deterministic part plus a **round-trip verdict**: that the frame decodes back to its payload, that the id parses, that the two halves agree. And watch for a function that mutates its input in place, which makes the second sample differ from the first for a reason that has nothing to do with randomness.

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

Keep the harness scratch directories where no tool looks: inside `node_modules`. Every formatter, linter, type checker and test glob already ignores that directory, and the runtime still resolves dependencies upward from it. `.git/info/exclude` hides a directory from git and from nothing else, so it is the wrong tool for this and the right one for the plan and the log.

The harness sources themselves are visible, so check each formatter, linter and type checker for whether it reaches them, and add the ignore entries in the harness commit, where they stay out of every later PR.

Before you trust the harness, run a **canary** twice, once for each instrument:

- For the harness: put a deliberate slowdown (a short busy loop) into one function in the working tree, and compare `HEAD` with the working tree. Only the cases that call that function must slow down. If no case moves, or all cases move, the harness does not measure the revision you think it measures (typical cause: a materialised tree that still imports code from the working tree).
- For the gates: a **different** edit, one that changes output rather than timing (return a wrong value from a function the cases reach). Run the guard and the tests without regenerating any derived artifact. At least one of them must fail. If they all pass, they read an artifact your changes never reach, and every later green run means nothing. A slowdown cannot serve here: no gate can fail on timing.

Remove the canary before you continue.

## Step 4: Calibrate the threshold

**Open the plan now and write the numbers into it as you measure them.** Everything below is what a later reader needs to judge the campaign, and it is exactly what stays in the conversation until someone writes it down. A conversation is not a deliverable.

**Measure the machine first.** A calibration run on a busy machine measures the other work. Run the runtime's readiness probe (`jitter.mts` in node-ts): it times one pure CPU loop many times and reports how far the median sits above the minimum. Calibrate only when that spread is within about 2%. The probe decides, not the load average, which lags and says nothing about which core the process gets. On a machine that never reaches 2% (a shared machine, other agents), raise the threshold rather than waiting forever, but record the value you used and expect the bar to rise with it: the bar is measured on the same machine as the experiments, so a noisier machine buys fewer decidable experiments, not looser ones.

**Bracket every run.** Probe before, and probe after. A run that started quiet can be ruined by a burst that begins in the middle of it, and nothing can tell you that before the run has finished: in one campaign about one run in five overlapped a burst, and one of those was an identical-code control reporting +11.3% on a case. The node-ts `ab.mts` probes itself at the end and prints a verdict; `quiet.sh` does the waiting beforehand. Neither certifies a run, since a burst that begins and ends inside it passes both. Log a run whose machine was busy as invalid and repeat it, rather than reasoning about it, and do that even when its numbers look plausible: an invalid run that lands near the truth is the one that gets quoted.

Budget the waiting as work. On a shared machine it is not a rounding error on the measurement: one wait for a quiet probe in this method's history lasted 58 minutes, in a session where later windows opened within seconds.

Then run the A/B comparison with identical code on both sides three times. Discard a first run that materialised trees or compiled caches, because it runs cold.

Record in the plan:

- The probe numbers (min, p50, max) and the threshold you accepted, so a later reader can tell a quiet campaign from a noisy one.
- The noise floor for **both** summary numbers, the time-weighted total and the equally weighted geometric mean.
- The band of **each case**: the spread of that case's medians **across** the three runs, not the interquartile range printed inside one run. The two differ by an order of magnitude (across runs: under 2%; within a run: 5 to 15%), and the bar has to be compared with a quantity measured the same way as the effect. Bands differ by a factor of three between large and short cases, so a single default would keep noise in one case and discard a real effect in another.
- The keep bar: about twice the noise floor, never below 1%.
- One run's duration multiplied by about 2.5 times the experiment budget (every kept change needs a confirmation run, and the gates are not free), plus the waiting. On a shared machine the wait for a quiet probe can exceed the measurement several times over, and it is the number that decides whether a budget fits a session.
- How long a run may be. On a quiet machine, more iterations in one run buy more precision than more runs. On a busy one this reverses, because a run is only data if all of it was quiet: keep runs short enough to fit between bursts, and buy precision with focused runs instead.

**Per-case bars are local and they go stale.** The table above is calibrated once and stays usable for the two summaries, which move little. A single case is a different matter: one campaign's `cookies` band roughly doubled inside one session, from about 3% to about 6.6%, and one of the two controls behind the later figure had itself ended on a busy machine. So a per-case bar is only valid when it comes from a control run made in the same session, the same way, as the experiment it judges, and when no invalid run went into it. Calibrate a focused bar (two identical-code runs limited to that case) at the moment you target a case, not in advance for all of them.

The machine does not stay as it was. Re-run an identical-code control every few experiments, and whenever the bands look wider than at calibration. If a control exceeds the floor, recalibrate, raise the bar, and re-confirm the keeps made since the last good control.

## Step 5: Baseline and plan

Run the tests and the benchmark unchanged, and record the numbers. Profile the workload (the runtime folder has a profiler helper) and note where the time goes.

Write the plan from `templates/plan.md` and the log from `templates/experiments.tsv` (tab-separated, because commas break descriptions): what the repo does, what the benchmark measures, baseline numbers, noise floor, keep bar, and an initial candidate list ranked by profile weight.

Run a **scaling scan** before you list candidates: time each input shape at size n and at 4n. Linear work costs about four times more; a ratio well above that marks a superlinear path. These are invisible to a benchmark built on realistic sizes and cost five to twenty times on long input, so they are the one class of win the suite cannot find for you. Profile every shape the scan flags, and look for mid-array `splice`, `shift`, `unshift` or `indexOf` inside a loop over the same array.

Scan two kinds of shape, not one. The obvious kind scales the **input**: a longer document, a bigger array, a deeper tree. The other scales **operations against one long-lived object**: N listeners on one signal, N entries in one cache, N headers on one request, N registrations in one registry. Nothing about the input is large, so an input-length scan never reaches it, and a duplicate check that walks the collection turns an ordinary loop into O(n²). One campaign found exactly that, at step ratios of 17x and 24x, and it became the campaign's main finding.

Where the large wins usually are:

- **Work at construction that most callers never use.** An error message formatted eagerly although most callers only read the issue list; per-instance closures for rarely used methods; a lazy value that a subclass constructor forces immediately, which defeats its lazy design.
- **Failure paths.** Errors often cost 10 to 50 times more than successes, and benchmarks rarely cover them.
- **Allocations per call on leaf paths.** When one call takes nanoseconds, one object less per call can be 15%.
- **Superlinear paths**, from the scan above. Three fixes work repeatedly: compaction in one pass (a write index, then one truncation) instead of a removal per item; a working array that the walk fills, so removals stay near its end and the tail never shifts; and deferring a copy until the first mutation, so inputs without a match pay nothing. Measure the normal-input cost of each: a structure that is linear in theory can lose more on the hot path than it saves.

A code comment that documents a performance trade-off (for example "kept eager for monomorphic call sites") is evidence. Test it with one experiment if you doubt it, then accept the result. In one campaign, reversing such a trade-off regressed hot paths by 11 to 38%.

Keep the plan and the log out of git while the loop runs, because a discard resets the working tree. Use `.git/info/exclude`: pre-commit hooks in some repos reject untracked files, and exclusions in `.gitignore` would end up in your first experiment commit. Commit both at the end.

## Step 6: Rules

- Only changes to the implementation count. Never edit the benchmark, its inputs, or the guard to move the numbers. Adding a case is allowed, and sometimes necessary (a long-input case for a superlinear path): record its expectation against the base revision, leave every existing case and expectation untouched, and say in the log which experiment added it.
- Judge every change with the A/B comparison against the previous commit.
- **Three instruments, three jobs, and they disagree on purpose.** The full suite says whether anything else moved. A focused run (the suite limited to the case the change targets) decides that case. A standalone run, one revision per process, is what a maintainer will measure and therefore the only number a PR may print. They differ by up to a factor of two, in **both** directions: across five changes in one campaign the focused run was larger than the full suite for one, and the standalone run larger than both for another (`references/methodology.md` has the table). So never compare across the levels: a focused delta belongs against a focused control, never against a full-suite band.
- Discard anything under the bar immediately. At or above it, run the comparison a second time and keep the change only if both runs clear the bar. First runs mislead: one experiment measured -3.2% and then +0.4%.
- **Filter local candidates before spending an experiment on them.** When a change is confined to one function, time the current version against the candidate in a throwaway script over realistic inputs (`micro.example.mjs` in node-ts). One campaign rejected five candidates that way for the price of five short scripts, and one of them explained a failed experiment it had already spent. Three things keep it honest. It may reject, never keep: a win here still has to survive the A/B. It may only reject on a large margin, because it cannot see allocation pressure, call-site polymorphism or inlining at the real call site, so a candidate whose value is one of those has to be measured in place. And **run each variant in its own process**: two functions called from one timing loop make that call site polymorphic, which removes inlining from whichever variant depended on it, and the same script then reports a different sign depending on the order of its rounds. That is the method's own central artefact, reproduced at a smaller scale. Keep the results alive in a fixed-size sink, or the runtime either removes the work (an attractive number for nothing) or charges both sides for growing an array.
- Log every discard with its measured delta, and mark anything above roughly half the bar as a **near miss**. Effects under the bar are still effects: when you later touch the same area, bundle the near misses in. One campaign recovered a whole PR that way, six experiments after the original discard. Before a near miss goes on that list, re-test it focused against a focused control, because the list is only worth bundling if its entries are small and real rather than noise shaped like a win. In one campaign both near misses looked like -1.4% to -2.2% and neither survived the focused re-test, and the bundle experiment that followed cost two of twelve.
- A change that targets one path may keep on a per-case rule: the targeted case clears twice its own band in both runs, and the summaries do not regress. Measure that on focused runs against a focused control taken in the same session, not against the calibration table, and say so in the log.
- A change may keep as **asymptotic** when it makes a superlinear path linear: the suite is neutral inside its floor, and the targeted long input is measured standalone in two runs with an effect far above cross-run drift. Output on the targeted inputs must be identical, which needs a differential run, and the suite cost must be re-measured in isolation during packaging, because a stacked run can hide it.
- A marked row (the harness flags a band that contains 0%, or one that is wide against its median) says that **this run** does not confirm it, not that the change does nothing. It never overrides two runs that agree: when the two medians agree and clear the case's bar, a standalone run decides, not the marker. A row marked in both runs whose medians do **not** agree is no effect.
- Simpler is better, all else equal. The bar gates changes that add complexity. A change that removes code and is performance-neutral is worth keeping. A win that adds a cache with a subtle invariant probably is not. Record how you weighed it.
- A change whose correctness rests on the rest of the codebase keeping an invariant ("nothing writes to this shared object", "this structure is never aliased") costs more than its diff: it constrains future work, and a later, unrelated change can break it without touching your code. Name the invariant in the log and in the PR body, and weigh it as complexity, not as a free win.
- If the total improves but a single case clearly regresses, say so instead of hiding it in the average.
- While an A/B run is in progress, start nothing else: no build, no test, no profile. They compete for the same cores and skew the run that is deciding your experiment. Read code instead.
- Run the gates through one script that regenerates derived artifacts first (`templates/gates.example.sh`). Ordering a gate before the step that generates what it reads is the same failure as having no gate.
- Measure the compressed size delta of every change that adds a code path (a fast path, a cache, a new branch), and weigh it with the time delta. In a project with a size budget, bytes can reject a real win.
- A change that removes a defensive copy, or that starts mutating in place, needs an input where the aliasing is observable before the guard means anything. Add that case first, then make the change, and exercise both directions: derive a value from a source, mutate the source, report the derived value; then derive again, mutate the derived value, report the source. A shared structure usually shows up in only one of the two. The inputs are often objects rather than strings, which is what a differential suite's named scenarios are for.
- Regenerate every committed derived artifact before the guard and the tests, and again after a discard: `git reset --hard` restores the sources but leaves the generated files of the abandoned experiment in place.
- Run what CI runs, not only the test command, but split it by cost: the cheap gates (tests, lint, type check) before every commit, the expensive ones (coverage, docs build, whole-CI equivalent) before a keep becomes final. A change that needs a new test to hold the project's coverage rule is more expensive than its delta suggests; weigh that in the keep decision and record it in the log.
- If the guard changes, the change altered behaviour. Discard it, log it as `behaviour`, and keep it as a decision for the user. Never update the guard to make it pass.
- If the tests fail, fix only trivial mistakes in your change. Otherwise discard and log `fail`. Do not spend more than a couple of attempts on one idea.
- **A gate can fail for reasons that are not your change, and discarding a good change is the worse error.** When the failing test is one the change cannot reach, say why in one line from the diff, then run that file five times on the change and once on the base. Five of five, plus a base that behaves the same, means flaky: log it with the test name and continue. Anything less means your change. Record every such failure, because a suite that flakes twice in one campaign is a fact worth telling the maintainers. Expect more of this under load, since the machine state that ruins measurements also ruins timeouts and reused ports.
- **A gate that rewrites its own expectation file cannot be compared against the committed one.** Run it on the base and on the branch, on the same machine in the same session, and compare the two results normalised to pass or fail per test. Names with ports and messages with identifiers differ on every run, and a committed expectation recorded against a different checkout of the suite compares nothing: in one campaign it described 1,167 tests where the local run had 1,282.
- If a benchmark run takes more than three times its usual duration, kill it, discard the change and log `fail`.
- Bundle two ideas into one experiment only when each is too small to measure alone. When a bundle regresses, split it before you give up on its parts: one part can hide a large regression behind the gains of the others.
- Profile before guessing, and re-profile after each kept change, because the hot spots move. Ignore loader and harness frames, but not dependency frames: a library that hands its hot loops to a dependency spends most of its time there.
- Before you report, act on, or discard for a per-case regression in code the change did not touch, confirm it standalone (one revision per process). Two module instances in one process can produce a stable delta that does not exist.
- If a pre-commit hook reformats or auto-fixes files, run the guard and tests again on the committed state.

## Step 7: The loop

One small, isolated change at a time:

0. If the change is confined to one function, time the candidate against the current version in isolation first. A large loss there ends the idea without an experiment; anything else continues to step 1.
1. Make the change.
2. Run the guard and the tests, then commit. Commit before benchmarking, so a discarded experiment stays recoverable by its hash.
3. Run the A/B comparison against the previous commit, and a second time if the first clears the bar. For a change aimed at one case, decide it on focused runs against a focused control, and use the full suite to check that nothing else moved.
4. Keep by leaving the commit in place, or discard with `git reset --hard HEAD~1`.
5. Record the row in the log either way (`commit, delta1, delta2, status, description`), with the hash even for discards. `status` is `keep`, `discard`, `near-miss`, `behaviour` or `fail`. `delta2` is empty when the first run already rejected the change. Write up the approach and the reasoning in the plan.

## Step 8: When to stop

- **Dry.** Three consecutive experiments that are not kept means you are stuck, not finished. Re-profile from scratch, write at least five new candidates in the plan, each in a different part of the system than the last three attempts, and work through them. Stop when a diversification round ends with three consecutive non-kept experiments and nothing kept in between.
- **Budget.** Stop at the experiment budget from step 0 (default 20). Re-testing a near miss, alone or bundled, is an experiment and counts. Not counting it makes the budget elastic in the one direction that is already tempting.

Never stop because you ran out of ideas. An idea that would change behaviour or needs a redesign is a reason to log it as a decision item and move on.

Then summarise in the plan: what was kept, what was rejected and why, the cumulative improvement (one A/B of the pre-loop commit against the final commit, run twice), and what is left worth trying. Also run the repo's own benchmark as an external cross-check and report it with its caveats. Commit the plan and the log.

Say what the cumulative table is, next to the table. It is a full-suite run, so it carries the full-suite noise, and a reader who finds a swing on a case that no change touched is right to stop trusting it. The per-change standalone numbers are the reliable ones and the table exists to show the shape of the whole, not to be quoted.

**If the budget is extended after that summary**, the plan and the log are now tracked, so a discard would revert log rows with the code. Three rules keep the loop working: commit experiments by explicit path rather than with `-a`, give each log row its own commit, and A/B against the last **code** commit, which is `HEAD~2` when a log commit sits in between.

## Step 9: Package kept commits as PRs

Follow `references/pr-packaging.md`. In short: review the kept commits, group them into a few independent PRs by theme, cherry-pick each group onto a fresh base branch in its own worktree, verify each branch alone (tests, guard, a noise-control run, two A/B runs against the base, and a standalone run for each headline number), and write each PR body from `templates/pr-body.md`.

Two rules travel with that step.

**Any edit after the last measurement invalidates that measurement**, so a review suggestion that touches a hot path is an experiment like any other, however cosmetic it looks: in one campaign the review's cleanups left one change neutral, doubled the effect of another, and would have shipped a third that was slower.

**Every headline number in a PR comes from a standalone run, reported next to an identical-code control.** The reason is not that paired numbers are inflated (they are sometimes lower), it is that a maintainer builds one revision per process, so the standalone number is the one they will get. The control is what makes that number evidence: process-to-process spread differs by a factor of twenty between cases, and where the control's spread covers the effect, the case is not resolvable standalone. Then report the focused number, name the instrument, and say the control could not separate it.

Show the user each PR (title, branch, commits, verification table, body) and wait for confirmation before you push or create it. Create each PR only after its confirmation. Follow the target repo's own PR conventions where they exist.
