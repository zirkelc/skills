# Autoresearch skill: feedback from the first campaign (linkedom, 2026-09-22/23)

For review. Nothing in the skill has been changed yet. This file collects what the campaign
needed that the skill does not name, with the concrete text or code to add, and where it belongs.

**The campaign**: linkedom (a DOM implementation on Node), runtime `node-ts`, 18 experiments,
8 kept, 10 discarded, suite total 2.02x faster, retained heap per document -62%, four PRs opened
upstream (WebReflection/linkedom #335 to #338). Machine: Apple M5, 4 performance + 6 efficiency
cores, shared with the user's other work.

**What the skill got right and needs no change**: the canary (it caught a missing path in `src`
within one run, before any experiment), committing before benchmarking (all ten discards stayed
recoverable by hash), the paired A/B design itself, `.git/info/exclude` for scratch files, and
the rule to mirror the repo's own benchmark workloads instead of replacing them.

---

## Review by the skill author (2026-09-23)

All 17 items approved. Nine are adopted as written; eight are adopted with a change, noted in the
response under each item. Nothing is rejected, because every item carries either counter-evidence from
calibration or a concrete failure it prevented.

Items 1, 6 and 8 are not additions to the skill, they are defects in it:

- **1** built the delta from two independently drawn minima, which discards the pairing the method
  depends on. The per-side minimum stays, for the absolute numbers only.
- **6** is caused by `loadCases` importing the cases module once for both revisions, so the case code
  is polymorphic by construction. This gets fixed at the source (a per-slot query on that import), and
  `solo.mts` ships as the confirmation step.
- **8** can make the guard pass for the wrong reason on every experiment of a campaign, which voids its
  evidence. It gets a setup-time check of its own: edit the source, run the gate without regenerating,
  and confirm that the gate fails.

Five things I add on top of the items:

1. Per-case dispersion of the paired ratios in the A/B output (item 1), so each run states its own
   confidence instead of relying on a remembered noise band.
2. `setup`/`teardown` in `mem.mts` as well (item 3), otherwise memory cannot be measured for cases
   whose instances need built inputs.
3. A fixture manifest with URL, sha256 and date (item 10), so input drift cannot be mistaken for a
   behaviour change.
4. A named commit for the linked harness branch, plus the cases module inline (item 15).
5. A dependency-share hint line in the profiler when dependency frames are hidden (Appendix A), so the
   `--deps` flag is found when it matters rather than by luck.

Order of implementation, by what a future campaign loses without it: 1, 8, 6, 3, 5, 2, then the rest.

## Contents

- [A. Measurement method](#a-measurement-method) (items 1 to 7)
- [B. Fitting the repo](#b-fitting-the-repo) (items 8 to 10)
- [C. Loop bookkeeping](#c-loop-bookkeeping) (items 11, 12)
- [D. PR packaging](#d-pr-packaging) (items 13 to 17)
- [Appendix A: diff of the runtime against the skill's copy](#appendix-a-diff-of-the-runtime-against-the-skills-copy)
- [Appendix B: new files](#appendix-b-new-files)
- [Appendix C: evidence](#appendix-c-evidence)

| # | Item | Target file | Cost when missing | Verdict |
|---|---|---|---|---|
| 1 | Minimum is the wrong estimator on a busy or heterogeneous machine | `references/methodology.md`, `runtimes/node-ts/{README.md,ab.mts}` | ~2 h, three harness rebuilds | approved (default, + dispersion) |
| 2 | No machine-readiness gate | `SKILL.md` step 4, new `jitter.mts` | ~40 min of unusable runs | approved (probe decides) |
| 3 | Case size and harness heap are part of the instrument | `runtimes/node-ts/{README.md,harness.mts,cases.example.mts}` | ~1 h | approved (+ mem.mts) |
| 4 | Forced collection between timed runs | `runtimes/node-ts/ab.mts` | part of item 1 | approved (+ caveat) |
| 5 | TOTAL alone is a bad gate when case sizes differ | `references/methodology.md`, `ab.mts` | wrong keep/discard calls | approved (gate changed) |
| 6 | In-process pairing produces reproducible per-case artefacts | `references/methodology.md`, new `solo.mts` | ~30 min, nearly a false claim in a PR | approved (+ fix at source) |
| 7 | Per-case noise bands, derived mechanically | `SKILL.md` step 4 | wrong per-case rule | approved |
| 8 | Committed build output; what the tests actually load | `SKILL.md` steps 1, 6 | silent invalidation risk | approved (highest value) |
| 9 | Run the repo's whole quality gate per experiment | `SKILL.md` step 6 | two late surprises | approved (split cheap/expensive) |
| 10 | Third-party inputs: acquisition, licence, drift | `SKILL.md` step 2, template script | ~20 min | approved (+ manifest) |
| 11 | A near-miss list | `SKILL.md` step 6 or 7 | one kept PR nearly lost | approved |
| 12 | Wall-clock budget, not only an experiment budget | `SKILL.md` steps 0, 4 | two retunes | approved (factor 2.5) |
| 13 | Check that the grouping covers every kept commit | `references/pr-packaging.md` | one commit dropped | approved |
| 14 | The harness is not on the PR branch | `references/pr-packaging.md` | ~15 min | approved (+ scope note) |
| 15 | Publishing the harness as a branch beats inlining it | `references/pr-packaging.md` | 900 lines per PR body | approved (+ SHA, cases inline) |
| 16 | Isolated and stacked numbers differ | `references/pr-packaging.md` | contradictory PR bodies | approved |
| 17 | Regenerate derived output per PR branch | `references/pr-packaging.md` | one PR without its types | approved |

---

## A. Measurement method

### 1. The minimum is the wrong estimator on a busy or heterogeneous machine

**What the skill says.** `methodology.md`, "Why the minimum": the work is deterministic, noise can
only add time, so the minimum over iterations is the best estimate, and means or medians absorb
noise instead.

**What happened.** That reasoning holds per side, but the deltas come from *two* minima, drawn
independently. On this machine (4 performance + 6 efficiency cores, other work running), each
side's minimum is the best moment that side happened to get. With identical code on both sides,
single cases moved by up to 20% and the suite total by 12%. Three rebuilds of the harness later,
the fix was to stop comparing minima: A and B already run back to back inside one iteration, so
take their ratio per iteration and report the **median of those ratios**. The absolute
milliseconds still come from the minima.

| configuration (identical code both sides) | TOTAL | worst single case |
|---|---|---|
| minima, 15 iterations, 2 children per load order | +3.29% | clone-deep +16.9% |
| minima, 20 iterations, 1 child per load order | +12.07%, +4.72% | parse-shop +23.8% |
| **median of paired ratios, 30 iterations** | **+1.76%, +1.81%, -1.41%** | **bench-w3c +9.3%** |

**To add.** In `methodology.md`, after "Why the minimum", a section "When the minimum fails":
the minimum assumes both sides sample the same machine state; on a shared machine, or on cores of
different speed, they do not. Then the rule: take the delta from the median of paired ratios, keep
the minima for the absolute numbers, and say so in the output header. In the runtime README,
document the estimator. Code in Appendix A.

**Response (skill author): approved, and the most valuable item here.** The existing section is not
wrong about one side: the minimum is still the best estimate of a single side's true cost, and that is
why the absolute milliseconds keep coming from it. What is wrong is the step the text never spells
out: the delta was built from two minima drawn independently, which throws away the pairing that the
whole method rests on. Each side's minimum comes from its own best moment, and on a machine with
performance and efficiency cores those two moments are not the same machine state. The ratio inside
one iteration is the paired quantity; its median is the right estimator. Your calibration table is the
proof, so this becomes the default, not an option, and the header must name the estimator (your diff
does this). One addition: print the dispersion of the ratios per case (25th and 75th percentile, or
just the share of iterations below 1). A case whose interquartile range straddles 1 has no effect, and
a run that says so needs no separate argument about noise.

### 2. No machine-readiness gate

**What happened.** I calibrated for about 40 minutes before I thought to look at the machine. The
1-minute load average was 57 on 10 cores (an Xcode build the user had running). A pure CPU loop
varied 11% at the median and 70% at the maximum. Every number from that period was useless.

**To add.** In `SKILL.md`, at the start of step 4: measure the machine before you calibrate. Read
the load average and the core layout, and run a CPU-loop probe. Calibrate only when p50 is within
about 5% of the minimum; otherwise wait or tell the user. Re-check before each confirmation run
and discard runs whose load spiked. Ship `jitter.mts` (Appendix B) and add it to the commands
table in the runtime README.

**Response: approved.** Cheap, and it fails loudly, which is the right shape for a gate. Two
refinements. First, the CPU-loop probe decides, not the load average: the average is context, it lags
by design, and on a shared machine it can look calm while another process holds a performance core.
State that order in the skill so nobody gates on `loadavg` alone. Second, 5% is a starting threshold,
not a constant: record the probe's own numbers (min, p50, max) in the plan next to the noise floor, so
a later reader can tell a noisy campaign from a quiet one. The memory harness does not need this gate,
since allocation counts do not move with machine load.

### 3. Case size and harness heap are part of the instrument

**What happened.** My first case set kept about 30 parsed documents alive (15 per side) for the
whole run, with case bodies of 100 to 500 ms. Every timed body then contained at least one
collection or one core migration, so the minimum filtered nothing, and one run took 8 to 10
minutes. Shrinking the bodies to 10 to 60 ms and letting each case build and drop its own inputs
cut a run to 4.5 minutes and was one of the two changes that made the noise floor usable.

**To add.** Two sentences in the runtime README under "Traps": keep case bodies roughly 5 to 50 ms,
because a body that spans hundreds of milliseconds almost always contains a GC pause; and let a
case own its inputs, because inputs of *all* cases alive at once (twice, once per revision) make
every collection slower. Extend the `PerfCase` contract with `setup?()` and `teardown?()`, and
call them in `ab.mts`, `guard.mts` and `profile.mts` (Appendix A). Show the pattern in
`cases.example.mts`, including the note that a mutating workload has to rebuild its input in
`setup` or inside `run`.

**Response: approved.** This is an instrument-design point that the skill states nowhere, and both
halves are right: a body of hundreds of milliseconds contains a collection almost by construction, so
the minimum stops filtering anything, and inputs held for the whole run inflate every later collection
on both sides at once. The `setup`/`teardown` extension is the correct shape, because it keeps the case
definition the single source for the A/B harness, the guard and the profiler. One gap in the diff:
`mem.mts` also has to call `setup`/`teardown` before `alloc`, otherwise a case whose instances need
built inputs cannot be measured for memory. Also worth one line in the contract: `collect` must not
depend on `run` having run first, now that `setup` exists and the guard calls them in a fixed order.

### 4. Forced collection between timed runs

**What happened.** Allocation-heavy cases let one side's garbage be collected inside the other
side's timing. Running the children with `--expose-gc` and calling `gc()` before every timed body
removed that coupling. It costs a few percent of run time.

**To add.** Ship it in `ab.mts` (the parent spawns children with `--expose-gc`; the call is a
no-op when the flag is missing) and name it in the README.

**Response: approved, with a caveat that belongs next to it in the README.** Removing the coupling
is right: without it, one side pays for the other side's garbage, and which side pays is decided by
timing, not by the code. The caveat is that a forced collection before every body also hides part of
what a change really costs. A change that allocates twice as much garbage pays for it in production,
and the harness now shows less of that. So the README should say: gc-per-iteration for the timing
numbers, and `mem.mts` as the counterpart that catches what the timing no longer sees. Also state the
rule that follows: never call `gc()` inside a timed body, only between bodies, and always for both
sides.

### 5. TOTAL alone is a bad gate when case sizes differ

**What happened.** One case (the repo's own benchmark sequence on a 2.3 MB page) was about half of
the suite total, so it alone decided every keep. I added a `GEOMEAN` line that weights every case
equally and gated on both numbers. Where they disagree, that is information: item 11's experiment
had TOTAL -6.0% and GEOMEAN +1.9%, which is exactly the signature of "one big case wins, many
small cases lose". I discarded it for that reason, and the eventual variant won on both.

**To add.** In `methodology.md`, under "Noise floor and keep bar": report a time-weighted total and
an equally-weighted geometric mean, gate on both, and read a disagreement as a concentrated effect
that needs a per-case look. In `SKILL.md` step 4, record both noise floors.

**Response: approved, with a change to the gate.** The diagnosis is exactly right, and the example
(TOTAL -6.0% against GEOMEAN +1.9%) is the clearest argument for it: that signature means one big case
paid for many small regressions. "Gate on both numbers" is too strict as written, though. A change that
targets the dominant case legitimately improves TOTAL and leaves GEOMEAN flat, and the skill already
allows exactly that through the per-case rule. Make it: one of the two must clear its bar, the other
must not regress beyond its own noise band, and any disagreement gets a per-case look before the keep
or discard is recorded. That keeps your rejection of the item 11 experiment intact, because there
GEOMEAN did regress.

### 6. In-process pairing produces reproducible per-case artefacts

**What the skill says.** `methodology.md` warns about load-order bias and cancels it with both
load orders.

**What happened.** A different artefact hit me. The cases module is shared between the two
revisions, so its functions see two hidden-class families. One case (`querySelectorAll` and
friends) reported +25% and +29% in two runs: stable, repeatable, and looking exactly like a real
regression in code that the experiment had not touched. Profiles of both revisions were identical.
Timing it standalone, one process per revision, showed it equal or faster. I nearly reported a
regression that does not exist, and the same artefact reappeared in two later experiments.

**To add.** In `methodology.md`, a trap: "a per-case delta can be an artefact of two module
instances in one process; before you report, act on, or discard for a per-case regression, confirm
it standalone, one revision per process". Ship `solo.mts` (Appendix B). Mention it also in
`pr-packaging.md`, because such a case needs an explanation in the PR body if the reviewer runs
the harness themselves. (This session's PR #335 contains such a paragraph.)

**Response: approved, and there is a fix at the source that should ship with the detection.** The
artefact is real and it is caused by my code: `loadCases` imports the cases module by the same URL for
both revisions, so ESM hands out one module instance and every case closure sees two hidden-class
families. Appending a per-slot query to that import (`...cases.mts?slot=a` and `?slot=b`) gives each
side its own instance, which makes the case code monomorphic per side and removes most of this class of
artefact instead of only detecting it. It costs one extra compile of a small module. Detection still
has to ship, because the library's own objects and shared built-ins stay polymorphic, so `solo.mts`
stays as the confirmation step, and the rule "confirm a per-case regression standalone before you
report, act on, or discard for it" goes into `methodology.md` as written.

### 7. Per-case noise bands, derived mechanically

**What the skill says.** Step 6: "the targeted case clears twice its own noise band (5% is a
reasonable default)".

**What happened.** The real bands differed by a factor of three between case classes: about ±3%
for the large cases and about ±9% for the short ones (bodies under 2 ms). A single default would
have kept two changes that were noise and discarded one that was real.

**To add.** In step 4: record the per-case spread from the three calibration runs, and set each
case's bar at twice its own band, not at a global default. One line in the plan template for the
per-case table.

**Response: approved.** The 5% default was a guess carried over from a campaign whose cases were
all of similar size, and a factor of three between case classes is enough to make that guess produce
both kinds of error. Deriving each band from the calibration runs is mechanical and costs nothing extra,
since those runs already happen. Add the per-case table to the plan template, and use the same numbers
in the PR body: "this case's noise band is ±3%, the effect is -18%" is a stronger sentence than any
global default.

---

## B. Fitting the repo

### 8. Committed build output, and what the gates actually load

**What happened.** linkedom commits its `cjs/` and `types/` output. The tests run against `cjs/`,
the harness measures `esm/`. Without `npm run cjs` before each test and guard run, I would have
measured a changed `esm/` while validating an unchanged `cjs/`: the guard would have been green for
the wrong reason, on every single experiment. A discard (`git reset --hard HEAD~1`) also leaves the
generated files stale, so the regeneration has to be repeated there.

**To add.** In step 1, a question to answer explicitly: which artifacts are derived, which of them
are committed, and which artifact does each gate (tests, lint, coverage, benchmark) consume. In
step 6, a rule: regenerate derived output before the guard and the tests, and again after a
discard. This is cheap to state and expensive to miss.

**Response: approved, and this is the highest-value item for correctness, not for speed.** A guard
that is green because it validated an artifact the change never touched is worse than no guard: the
whole campaign's evidence becomes void, and nothing in the loop would reveal it. That makes it a step 1
question ("which artifacts are derived, which are committed, and which one does each gate consume")
and a step 6 rule, including after a discard, where `git reset --hard` leaves the generated files from
the abandoned experiment in place. I would also add one canary-style check at setup time: change the
source, run the gate without regenerating, and confirm that the gate fails. If it passes, the gate does
not see your changes at all.

### 9. Run the repo's whole quality gate per experiment, not only the tests

**What happened.** This repo requires 100% coverage ("nothing that doesn't score 100% test
coverage will go through") and lints `esm/`. One experiment dropped branch coverage to 99.92%
because a cache-clear branch was unreachable in the tests, and needed a new test to be
acceptable. Another failed lint on an import that my change had made unused. Both are real costs
of the change and belong in the keep decision, not in a surprise at PR time.

**To add.** In step 6: run what CI runs, not only the test command. And in the "simpler is better"
paragraph: a change that needs a new test to hold the project's coverage rule is more expensive
than its delta suggests; record that in the log when weighing it.

**Response: approved, with a cost refinement.** The principle is right: a coverage rule or a lint
rule is part of the price of a change, and finding it at PR time means the keep decision was made on
incomplete information. But running a full coverage pass after every experiment can dominate the loop
on a slow suite, and most experiments are discarded. Split it: the cheap gates (tests, lint, type
check) run before every commit; the expensive ones (coverage, docs build, whole-CI equivalent) run
before a keep becomes final, which is at most twice per kept change. If an expensive gate then fails,
the change goes back to the log as a `fail` with the reason. And yes: "needed a new test to hold the
coverage rule" belongs in the complexity weighing, next to the delta.

### 10. Third-party inputs: acquisition, licence, drift

**What the skill says.** Step 2: make inputs deterministic, keep fixture files out of the
formatter's reach.

**What happened.** The realistic inputs for this workload are full e-commerce pages. The user
explicitly did not want their own repo's fixtures copied, so I downloaded 14 public storefront
pages (13 MB). Three things followed that the skill does not mention: they must not be committed
(third-party content), they change over time (so the guard hashes are tied to a snapshot, and
`--update` must run only once, at campaign start), and the PR has to tell the maintainer how to
get them.

**To add.** In step 2, a paragraph on inputs from outside the repo: keep them untracked (via
`.git/info/exclude`), ship a fetch script that lists the sources, record the guard once against
that snapshot, and never re-record to make a change pass. A `fetch-fixtures.sh` template belongs
in `templates/` (Appendix B).

**Response: approved.** Three consequences, all correct, and none of them is in the skill. One
addition: write a manifest next to the fetch script with the URL, the sha256 and the fetch date of every
file. Without it you cannot tell later whether a guard mismatch came from your change or from a page
that was re-downloaded and has changed, which is the one failure mode that could make you distrust a
correct guard. The manifest also gives the PR the exact sentence a maintainer needs in order to
reproduce the inputs.

---

## C. Loop bookkeeping

### 11. A near-miss list

**What happened.** Experiment 4 measured -2.3% on the total and -4.2% on its targeted case, both
under the bar, and was discarded correctly. Six experiments later I bundled it with a one-line
change in the same file; together they measured -4.7% and -4.4% and became PR #336. Without my
own note in the plan that the effect was "real but under the bar", that work would have been lost.

**To add.** In step 6 or 7: log every discard with its measured delta, and mark those above
roughly half the bar as near misses. When you later touch the same area, bundle them. The log
template can carry a `near-miss` status next to `discard`.

**Response: approved.** The cost of being wrong here is asymmetric: a forgotten near miss is work
that is simply lost, while the extra line in the log costs nothing. Recording the delta for every
discard (which the template already does) plus a `near-miss` status above roughly half the bar is the
right amount of bookkeeping. One constraint to state with it: a bundle of near misses is still a bundle,
so the existing rule applies, and if the bundle regresses it must be split before its parts are
abandoned.

### 12. Wall-clock budget, not only an experiment budget

**What happened.** The budget is set in experiments (20). The binding constraint was time: at
first, one A/B run took 6.5 minutes, so 20 experiments with a confirmation run each meant more
than four hours of pure measurement, plus builds and tests. I retuned iterations and children
twice.

**To add.** In step 4, after the noise floor: measure one run's duration, multiply by two times
the experiment budget, and tune `--iters`/`--repeats` until that fits the session. In step 0,
when asking for the budget, say what it means in wall-clock time once the harness exists.

**Response: approved.** The experiment budget is the wrong unit on its own, and the campaign
notices too late. Use a factor of about 2.5 rather than 2 when projecting: every kept change needs a
confirmation run, and the gates and builds around each experiment are not free. The step 0 wording
should stay honest about the order of events: the wall-clock figure only exists after the harness does,
so step 0 asks for the budget and step 4 reports what it means in hours, with the tuning that makes it
fit.

---

## D. PR packaging

### 13. Check that the grouping covers every kept commit

**What happened.** The grouping table I showed the user listed 7 of 8 kept commits. I noticed only
while cherry-picking the third branch.

**To add.** In step 1 of `pr-packaging.md`: before presenting the grouping, verify mechanically
that the union of the groups equals the kept-commit list, and show the difference if it is not
empty.

**Response: approved.** A mechanical set difference between the kept-commit list and the union of
the groups, printed before the grouping is shown. No judgement involved, so there is no reason for a
human to be the one who notices.

### 14. The harness is not on the PR branch

**What happened.** PR branches start from the base, where `perf/` does not exist, so the guard and
the A/B harness cannot run there. `git checkout <campaign-branch> -- perf && git reset -- perf`
puts the harness into the working tree as untracked files: the branch stays clean and everything
runs. Switching back needs the copies removed again, because the campaign branch tracks those
paths.

**To add.** One line in step 2 or 3 of `pr-packaging.md`. It matters because the obvious
alternative (committing the harness into the PR) is wrong, and the second obvious alternative
(worktrees) is not always available: this user's rules forbid creating worktrees without an
explicit request, and everything worked in the main checkout.

**Response: approved, with one clarification about when it is needed.** The A/B harness itself does
not need this: it materialises both revisions with `git archive`, so it can compare any two revisions
from the campaign checkout, which is how the numbers for the zod PRs were produced. What needs the
harness present on the PR branch is everything that runs against the working tree: the guard, and any
run where the PR branch is the checked-out state. Your `git checkout <campaign-branch> -- perf &&
git reset -- perf` is the right way to do that without polluting the branch, and the note about removing
the copies before switching back is the part people will forget.

### 15. Publishing the harness as a branch beats inlining it

**What happened.** The template asks for the harness sources in `<details>` blocks. That is about
900 lines per body, four times over. Pushing the campaign branch to the user's fork and linking it
kept the bodies readable, and it also exposes `plan.md` and `experiments.tsv`, so a reviewer can
see the ten discarded experiments and their numbers. That is the more convincing artifact.

**To add.** In step 4 of `pr-packaging.md`: two options, with guidance. Inline the sources when no
fork exists or the repo is private; otherwise push the campaign branch and link it, and say in the
body what it contains. Practical note worth keeping: `gh repo fork` takes switch flags, so
`--clone=false` is not valid and prints the help text instead of forking.

**Response: approved, with a refinement.** 900 lines of harness in a PR body buries the change, and
the campaign branch carries something better than the sources: the plan and the log, which show the ten
experiments that failed. That is the artifact that makes the method credible. Two conditions, though.
Name the exact commit of the harness branch in the body, because a branch can be force-pushed or
deleted and the reviewer's reproduction then silently differs. And keep one file inline: the cases
module, which defines what was measured. A reviewer who wants to judge whether the benchmark is honest
reads that file, not the runner.

### 16. Isolated and stacked numbers differ

**What happened.** PR #338's trade-off cost 1 to 3% on serialization when measured alone, but 8 to
9% when measured on top of the other three PRs, where serialization is already twice as fast. A
reviewer reading two of my bodies would otherwise find two different numbers for the same effect.

**To add.** In step 4: report the isolated number, and wherever the stacked number differs
materially, give both with the reason. Same for gains: PR #338 is 1.18x on cloning alone and 1.74x
stacked, because the other PRs removed the work that hid it.

**Response: approved.** The same effect appeared in the zod campaign in the opposite direction
(a PR measured alone looked larger than its stacked contribution, because it had the untouched path to
itself). The rule that follows is the one you used: the isolated number is the claim, the stacked number
is disclosed wherever it differs materially, with the reason, so two PR bodies cannot contradict each
other.

### 17. Regenerate derived output per PR branch

**What happened.** Of the four branches, only one changed the generated `types/`. The campaign
branch never ran `tsc` at all, so this only surfaced during packaging. I folded the regenerated
types into the commit that causes them.

**To add.** In the per-branch checklist of step 2: regenerate every committed derived artifact and
fold the result into the commit that causes it, then re-run the tests on the result.

**Response: approved.** It follows from item 8 and costs one line in the per-branch checklist. The
part worth keeping explicit is folding the regenerated artifact into the commit that causes it, rather
than adding a "regenerate" commit on top, so that each commit in the PR stands on its own.

---

## Appendix A: diff of the runtime against the skill's copy

`runtimes/node-ts/` as shipped, against `perf/` at the end of the campaign. Items 1, 3, 4, 5 and
the profiler's `--deps` flag.

```diff
=== ab.mts
--- runtimes/node-ts/ab.mts (skill)
+++ perf/ab.mts (campaign)
@@ -18,6 +18,8 @@
   first: number;
   /** Minimum ns per case body for the module loaded second. */
   second: number;
+  /** Median over iterations of (second / first), each pair timed back to back. */
+  ratio: number;
 }
 
 const HARNESS_DIR = import.meta.dirname;
@@ -29,11 +31,14 @@
   child: { type: "boolean" },
 });
 
-const ITERS = Number(values.iters ?? 25);
-const WARMUP = Number(values.warmup ?? 4);
+const ITERS = Number(values.iters ?? 30);
+const WARMUP = Number(values.warmup ?? 3);
 const TARGET_NS = Number(values["target-ms"] ?? 1.5) * 1_000_000;
-const REPEATS = Number(values.repeats ?? 2);
+const REPEATS = Number(values.repeats ?? 1);
 
+/** Children run with `--expose-gc`; the parent does not need it. */
+const gc: () => void = (globalThis as any).gc ?? (() => {});
+
 /** Runs inside a child process: times the two entries loaded in the given order. */
 async function measure(entryFirst: string, entrySecond: string): Promise<Array<Row>> {
   const casesFirst = await loadCases(config, entryFirst);
@@ -44,10 +49,13 @@
     const a: PerfCase = casesFirst[i];
     const b: PerfCase = casesSecond[i];
     if (a.name !== b.name) throw new Error(`Case order differs: ${a.name} vs ${b.name}`);
+    a.setup?.();
+    b.setup?.();
 
     /** JIT warm-up on the raw bodies, then size each timed run to about TARGET_NS. */
     let probe = Number.POSITIVE_INFINITY;
-    for (let w = 0; w < 10; w++) {
+    /** Slow cases need fewer probe runs to warm up: stop early once one body takes over 20 ms. */
+    for (let w = 0; w < 10 && !(w >= 3 && probe > 20_000_000); w++) {
       probe = Math.min(probe, timeNs(a.run));
       b.run();
     }
@@ -63,18 +71,41 @@
       runA();
       runB();
     }
+    /**
+     * The cases allocate whole documents, so a collection triggered by one side's garbage can
+     * land in the other side's timing. A full collection before each timed run keeps the two
+     * sides independent.
+     */
+    const timeA = () => (gc(), timeNs(runA));
+    const timeB = () => (gc(), timeNs(runB));
+    /**
+     * On a loaded machine (and on cores of different speed) the minimum of each side is the
+     * best moment each side happened to get. The two runs of one iteration share the machine
+     * state, so the median of their ratios is the more robust estimate of the difference.
+     */
     let minA = Number.POSITIVE_INFINITY;
     let minB = Number.POSITIVE_INFINITY;
+    const ratios: Array<number> = [];
     for (let iter = 0; iter < ITERS; iter++) {
+      let tA: number;
+      let tB: number;
       if (iter % 2 === 0) {
-        minA = Math.min(minA, timeNs(runA));
-        minB = Math.min(minB, timeNs(runB));
+        tA = timeA();
+        tB = timeB();
       } else {
-        minB = Math.min(minB, timeNs(runB));
-        minA = Math.min(minA, timeNs(runA));
+        tB = timeB();
+        tA = timeA();
       }
+      minA = Math.min(minA, tA);
+      minB = Math.min(minB, tB);
+      ratios.push(tB / tA);
     }
-    rows.push({ name: a.name, first: minA / reps, second: minB / reps });
+    ratios.sort((x, y) => x - y);
+    const mid = ratios.length >> 1;
+    const ratio = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
+    a.teardown?.();
+    b.teardown?.();
+    rows.push({ name: a.name, first: minA / reps, second: minB / reps, ratio });
   }
   return rows;
 }
@@ -84,7 +115,7 @@
   const passthrough = ["--iters", String(ITERS), "--warmup", String(WARMUP), "--target-ms", String(TARGET_NS / 1_000_000)];
   const res = spawnSync(
     process.execPath,
-    [...process.execArgv, self, "--child", ...passthrough, "--entry", config.entry, "--cases", config.cases, ...config.src.flatMap((s) => ["--src", s]), entryFirst, entrySecond],
+    [...process.execArgv, "--expose-gc", self, "--child", ...passthrough, "--entry", config.entry, "--cases", config.cases, ...config.src.flatMap((s) => ["--src", s]), entryFirst, entrySecond],
     { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] }
   );
   if (res.status !== 0) throw new Error(`child failed:\n${res.stderr}`);
@@ -98,6 +129,7 @@
     name: row.name,
     first: Math.min(...runs.map((r) => r[i].first)),
     second: Math.min(...runs.map((r) => r[i].second)),
+    ratio: Math.exp(runs.reduce((sum, r) => sum + Math.log(r[i].ratio), 0) / runs.length),
   }));
 }
 
@@ -118,25 +150,27 @@
   const pct = (ratio: number) => `${((ratio - 1) * 100).toFixed(2).padStart(7)}%`;
   const speedup = (ratio: number) => `${(1 / ratio).toFixed(2).padStart(6)}x`;
 
-  console.log(`A = ${revA}, B = ${revB} (min of ${ITERS} iters, ${REPEATS} children x 2 load orders, ms)`);
+  console.log(`A = ${revA}, B = ${revB} (min ms of ${ITERS} iters; delta = median of paired ratios; ${REPEATS} children x 2 load orders)`);
   console.log(`${"case".padEnd(26)}${"A".padStart(10)}${"B".padStart(10)}${"delta".padStart(9)}${"speed".padStart(8)}`);
 
   let sumA = 0;
   let sumB = 0;
-  const totals = { abA: 0, abB: 0, baA: 0, baB: 0 };
+  let logSum = 0;
   for (let i = 0; i < orderAB.length; i++) {
     const ab = orderAB[i];
     const ba = orderBA[i];
-    const ratio = Math.sqrt((ab.second / ab.first) * (ba.first / ba.second));
+    /** orderAB measured B/A, orderBA measured A/B; the geometric mean cancels load-order bias. */
+    const ratio = Math.sqrt(ab.ratio / ba.ratio);
+    logSum += Math.log(ratio);
     const a = (ab.first + ba.second) / 2;
     sumA += a;
     sumB += a * ratio;
-    totals.abA += ab.first;
-    totals.abB += ab.second;
-    totals.baB += ba.first;
-    totals.baA += ba.second;
     console.log(`${ab.name.padEnd(26)}${ms(a)}${ms(a * ratio)} ${pct(ratio)}${speedup(ratio)}`);
   }
-  const totalRatio = Math.sqrt((totals.abB / totals.abA) * (totals.baB / totals.baA));
+  /** Per-case ratios weighted by the case's time. */
+  const totalRatio = sumB / sumA;
   console.log(`${"TOTAL".padEnd(26)}${ms(sumA)}${ms(sumA * totalRatio)} ${pct(totalRatio)}${speedup(totalRatio)}`);
+  /** Every case with the same weight, so the largest case does not decide alone. */
+  const geo = Math.exp(logSum / orderAB.length);
+  console.log(`${"GEOMEAN".padEnd(46)} ${pct(geo)}${speedup(geo)}`);
 }
=== harness.mts
--- runtimes/node-ts/harness.mts (skill)
+++ perf/harness.mts (campaign)
@@ -18,6 +18,13 @@
   collect: () => unknown;
   /** Optional: create and return one retained instance, measured by the memory harness. */
   alloc?: () => unknown;
+  /**
+   * Optional: build the inputs just before the case runs. Large inputs (parsed documents) that
+   * stay alive for every case make each collection slower and the timings noisier.
+   */
+  setup?: () => void;
+  /** Optional: release what `setup` built, once the case is done. */
+  teardown?: () => void;
 }
 
 /** A cases module exports this function. It receives the module namespace of the entry point. */
=== guard.mts
--- runtimes/node-ts/guard.mts (skill)
+++ perf/guard.mts (campaign)
@@ -31,9 +31,12 @@
 for (const c of cases) {
   let sample: unknown;
   try {
+    c.setup?.();
     sample = c.collect();
   } catch (error) {
     sample = { __threw: replacer("", error) };
+  } finally {
+    c.teardown?.();
   }
   const json = JSON.stringify(sample, replacer);
   actual[c.name] = { hash: fnv1a(json), bytes: json.length };
=== profile.mts
--- runtimes/node-ts/profile.mts (skill)
+++ perf/profile.mts (campaign)
@@ -17,7 +17,10 @@
 const { config, positionals, values } = loadConfig(HARNESS_DIR, process.argv.slice(2), {
   seconds: { type: "string" },
   top: { type: "string" },
+  deps: { type: "boolean" },
 });
+/** Dependency frames matter when the library hands its hot loops to them (parser, selector engine). */
+const DEPS = Boolean(values.deps);
 const SECONDS = Number(values.seconds ?? 4);
 const TOP = Number(values.top ?? 30);
 
@@ -26,6 +29,7 @@
 const selected = only ? all.filter((c) => only.includes(c.name)) : all;
 if (selected.length === 0) throw new Error(`No case matches. Known: ${all.map((c) => c.name).join(", ")}`);
 
+for (const c of selected) c.setup?.();
 /** Warm up before sampling so the profile shows optimized code, not the interpreter. */
 for (const c of selected) for (let i = 0; i < 10; i++) c.run();
 
@@ -72,9 +76,11 @@
 const rootUrl = `file://${config.root}/`;
 function label(n: ProfileNode): string | null {
   const { url, functionName, lineNumber } = n.callFrame;
-  if (url.includes("node_modules") || url.startsWith("node:")) return null;
+  if (url.startsWith("node:") || (url.includes("node_modules") && !DEPS)) return null;
   if (!url && (!functionName || ["(program)", "(idle)", "(root)"].includes(functionName))) return null;
-  const file = url.startsWith(rootUrl) ? url.slice(rootUrl.length).replace(/^\.perf-trees\/[^/]+\//, "") : url;
+  const file = url.includes("node_modules/")
+    ? url.slice(url.lastIndexOf("node_modules/") + "node_modules/".length)
+    : url.startsWith(rootUrl) ? url.slice(rootUrl.length).replace(/^\.perf-trees\/[^/]+\//, "") : url;
   return `${functionName || "(anonymous)"} ${file}${file ? `:${lineNumber + 1}` : ""}`;
 }
```

A note on the `--deps` flag: without it the profiler dropped htmlparser2 and css-select, which
together were 20 to 40% of every profile in this library. For a library that hands its hot loops
to a dependency, seeing those frames decides which experiments are worth running at all.

The default changes (`ITERS` 25 to 30, `WARMUP` 4 to 3, `REPEATS` 2 to 1) are this machine's
compromise between precision and a 4.5-minute run, not a general recommendation. They belong in
the README as "tune these in step 4", not as new defaults.

**Response: agreed on all three.** `--deps` is a defect fix, not a preference: dropping every
dependency frame is only correct for a library with no runtime dependencies, which is what the original
was written against. Ship the flag, and when dependency frames are hidden, print one line with the share
of samples they hold ("dependencies: 34% of samples, re-run with --deps"), so the flag is found when it
matters. On the defaults: agreed, they stay as they are in the skill, with the README saying that step 4
tunes them. Add one sentence about the direction of that tuning under the new estimator: with a median
of paired ratios, more iterations in one child buy more than more children, because every extra
iteration is another paired sample while another child only repeats the whole measurement.

## Appendix B: new files

### `runtimes/node-ts/jitter.mts` (item 2), tested

```ts
/**
 * Machine-readiness probe. Run it before calibrating and before any confirmation run.
 *
 *   node perf/jitter.mts [--repeats 40]
 *
 * Times the same pure CPU loop many times and reports the spread. The loop cannot get faster
 * than its true cost, so the spread is what the machine adds: other load, frequency changes, or
 * a scheduler that moves the process between cores of different speed (Apple silicon, big.LITTLE).
 * When p50 is far above the minimum, per-side minima are draws from different machine states and
 * the A/B deltas of single cases become unusable.
 */
import * as os from "node:os";
import { parseArgs } from "node:util";

const { values } = parseArgs({ args: process.argv.slice(2), options: { repeats: { type: "string" } } });
const REPEATS = Number(values.repeats ?? 40);

const times: Array<number> = [];
for (let r = 0; r < REPEATS; r++) {
  const start = process.hrtime.bigint();
  let x = 0;
  for (let i = 0; i < 2e7; i++) x = (x + i * 7) % 1_000_003;
  times.push(Number(process.hrtime.bigint() - start) / 1e6);
}
times.sort((a, b) => a - b);

const min = times[0];
const p50 = times[times.length >> 1];
const max = times[times.length - 1];
const spread = (p50 / min - 1) * 100;
const [load1] = os.loadavg();

console.log(`cores ${os.cpus().length}, load average (1 min) ${load1.toFixed(2)}`);
console.log(`cpu loop: min ${min.toFixed(1)} ms, p50 ${p50.toFixed(1)} ms, max ${max.toFixed(1)} ms`);
console.log(`p50 is ${spread.toFixed(1)}% above min`);

if (spread > 5) {
  console.log("BUSY: calibrate and measure later, or expect per-case noise of 10% and more.");
  process.exit(1);
}
console.log("OK: the machine is quiet enough to calibrate.");
```

Output during this campaign, busy machine (load 57) and quiet machine (load 1.9):

```
cpu loop: min 63.0 ms, p50 70.2 ms, max 107.5 ms     ->  p50 11.4% above min   BUSY
cpu loop: min 60.9 ms, p50 61.9 ms, max  64.3 ms     ->  p50  1.6% above min   OK
```

### `runtimes/node-ts/solo.mts` (item 6), tested

```ts
/**
 * Standalone timing of one case against one revision, in a process of its own.
 *
 *   node --expose-gc perf/solo.mts <rev|WORKTREE> <case> [--iters 25]
 *
 * The A/B harness loads two revisions into one process, which is what makes it precise, but it
 * also makes the shared case code see two sets of hidden classes. That can produce a stable,
 * reproducible delta on a case whose code neither revision changed. Before reporting a per-case
 * regression, run it here for both revisions: one revision per process, nothing shared.
 */
import { WORKTREE, loadCases, loadConfig, materialise } from "./harness.mts";

const HARNESS_DIR = import.meta.dirname;
const { config, positionals, values } = loadConfig(HARNESS_DIR, process.argv.slice(2), {
  iters: { type: "string" },
});
const ITERS = Number(values.iters ?? 25);
const rev = positionals[0] ?? WORKTREE;
const name = positionals[1];
if (!name) throw new Error("Usage: solo.mts <rev|WORKTREE> <case>");

const gc: () => void = (globalThis as any).gc ?? (() => {});
const cases = await loadCases(config, materialise(config, rev, "solo"));
const perfCase = cases.find((c) => c.name === name);
if (!perfCase) throw new Error(`No case ${name}. Known: ${cases.map((c) => c.name).join(", ")}`);

perfCase.setup?.();
for (let w = 0; w < 5; w++) perfCase.run();

let min = Number.POSITIVE_INFINITY;
for (let i = 0; i < ITERS; i++) {
  gc();
  const start = process.hrtime.bigint();
  perfCase.run();
  min = Math.min(min, Number(process.hrtime.bigint() - start) / 1e6);
}
perfCase.teardown?.();

console.log(`${name} @ ${rev}: min ${min.toFixed(2)} ms of ${ITERS} iterations`);
```

Used on the case that the paired harness reported as +25% and +29%:

```
query-simple @ origin/main: min 13.24 ms of 12 iterations
query-simple @ WORKTREE:    min 12.91 ms of 12 iterations
```

### `templates/fetch-fixtures.sh` (item 10)

```sh
#!/bin/sh
# Downloads the pages used as perf fixtures into perf/fixtures/ (untracked).
# The sources are live pages, so a new download changes the guard hashes: record them again
# with `node perf/guard.mts --update` only before the first experiment of a campaign.
set -e
cd "$(dirname "$0")"
mkdir -p fixtures
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
for u in \
  https://example.com/one \
  https://example.com/two
do
  f=$(echo "$u" | sed -E 's#https?://(www\.)?##; s#/$##; s#/#_#g').html
  curl -sfL -A "$UA" -H 'Accept-Language: en-US' --max-time 30 -o "fixtures/$f" "$u"
  echo "$f"
done
```

### Case pattern for item 3 (for `cases.example.mts`)

```ts
/** Inputs live only while this case runs: everything alive at once makes every collection slower. */
let docs: Array<any> = [];
cases.push({
  name: "query",
  setup: () => { docs = PAGES.map((p) => lib.parse(p)); },
  teardown: () => { docs = []; },
  run: () => { for (const d of docs) d.query(".item"); },
  collect: () => docs.map((d) => d.query(".item").length),
});
```

## Appendix C: evidence

Calibration of the three harness configurations, identical code on both sides, same machine,
same cases (item 1):

| configuration | run 1 | run 2 | run 3 | worst case |
|---|---|---|---|---|
| minima, 15 iterations, 2 children | +3.29% | (stopped) | | clone-deep +16.9%, text-content -15.7% |
| minima, 20 iterations, 1 child | +12.07% | +4.72% | | parse-shop +23.8%, contains-position +20.2% |
| ratio median, 30 iterations, 1 child | +1.76% | +1.81% | -1.41% | bench-w3c +9.3% |

Campaign outcome for context: 18 experiments, 8 kept. Cumulative 2.02x on the suite total (two
runs, -50.6% both), -62.4% retained heap per document, and on the repo's own 12 MB benchmark
parse 2.9x, cloneNode 6.6x, innerHTML round trip 2.2x, total benchmark time 1.7x.

Discarded experiments that produced knowledge worth keeping in `methodology.md` as examples:

- An end marker allocated as a class instance: 1.82x on cloning, but 16 to 31% slower on every
  tree walk. The same object built as a literal without symbol keys kept the win and lost the
  regression. Both variants are in the log (experiments 11 to 13).
- A compiled-selector cache: no effect, because compilation is minor next to matching. A
  reasonable idea that the profile did not support, which is why it was measured and not assumed.
