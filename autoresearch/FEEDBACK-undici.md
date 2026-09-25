# Feedback: first campaign with the skill (nodejs/undici)

Campaign: nodejs/undici at `328ab843`, Node v24.14.0, node-ts runtime, budget 12 experiments.
Result: 6 kept, 4 PRs (#5901-#5904). The finished harness, plan and log are on
https://github.com/zirkelc/undici/tree/afde94231e5e3ac6ee5a874e20f2b8b1eae800df/perf and can serve
as a reference implementation for most points below.

Each item says what happened, what I had to work out myself, and what I propose for the skill.
Ordered by how much it would have saved or changed.

---

## Review (added by the skill author)

All 20 items are accepted. Eleven go in as proposed, nine go in with a change to the design or the
placement, and none is rejected. That is a different outcome from the two earlier reviews, and the
reason is visible in the file: every item here names what was measured, what it cost, and what the
alternative would have been, so there is little left to argue about.

Three of them change the method rather than the tooling, and they are the ones worth reading twice:

- **The measurement hierarchy (items 1 and 10).** Full suite, focused run, standalone run are not
  three ways to do the same thing. Your three numbers for the WebSocket branch, -69% paired,
  -54% focused, -32% standalone, are monotonic, and each step removes one part of the co-residency
  effect. So each level has one job: the full suite says nothing else regressed, the focused run
  decides the targeted case, the standalone run is the number a PR is allowed to print. The skill
  had all three scripts and no hierarchy, so it let a paired number reach a maintainer.
- **Bars go stale (item 1).** A per-case bar measured once at calibration is wrong by experiment 6.
  `cookies` moving from 3% to 13% inside one session settles it. A bar is only valid from a control
  run in the same session as the experiment it judges.
- **Any edit after the last measurement invalidates that measurement (item 14).** The packaging
  section assumed kept commits reach the PR unchanged. Reviews do not end that way.

One caution that applies to item 1 and is not in the file: a focused run also removes the
interleaving that keeps both module instances warm and their call sites polymorphic. So a focused
delta may differ from the full-suite delta for reasons that are not the change. That is fine as long
as the control is run the same way (focused, identical code), and it is why the focused bar cannot be
compared with a full-suite band. I will say so where the hierarchy is written down.

Proposed order of implementation: the runtime changes that are also bug fixes (3, 19), then the ones
that change decisions (1, 2, 5, 10), then the rest of the tooling (4, 6, 7, 8, 9, 18), then the
documentation-only items (11, 12, 13, 14, 15, 16, 17, 20).

---

## 1. Focused runs: a per-case mode in the harness (high)

**What happened.** On a shared machine the full-suite per-case bands were 3% to 21% (request-url
moved -10.7% in one identical-code run). A change aimed at one case (getCookies, ByteString,
WebSocket mask) could not be decided on the full suite: `cookies` measured -4.1% and -10.9% in two
runs, both marked `?`, and a later control showed the same case at +11.3% on identical code.

**What I did.** Added `PERF_ONLY=name[,name]` to the cases module (a filter in `buildCases`), and ran
the targeted case alone with 150-200 paired iterations. A focused run took 5-10 s instead of 20 s,
and the focused bands were 0.1% to 2.5% instead of 3% to 21%. Every per-case keep and discard after
experiment 3 was decided that way, with 2+ focused identical-code controls per case as its bar.

**Proposal.**
- Build it into the runtime: `ab.mts --only case[,case]` (and the same flag for `solo.mts`,
  `profile.mts`, `mem.mts`), rather than an env var in the cases module.
- Add to step 4: calibrate a focused bar per targeted case (two focused identical-code runs), and to
  step 6: a per-case keep is decided on focused runs; the full suite only checks that the summaries
  do not regress.
- Say in step 6 that a full-suite per-case bar calibrated on a quiet hour becomes wrong later; the
  cookies bar went from 3% to 13% within the session. Focused controls next to the experiment avoid
  that drift.

**Response: approve, with a change to where the filter lives.**

The filter goes into `loadCases()` in `harness.mts`, driven by one `--only` option parsed in
`loadConfig()`. Then every script inherits it, including the ones you did not list, and the cases
module stays a plain list of cases. Your version works, but it makes every future campaign copy a
filter into its own `cases.mts`, which is a place to get it wrong once per campaign. Two details
that go with it: an unknown name throws and prints the known names (a typo must not silently measure
nothing), and `ab.mts` passes `--only` down to its children, which it currently does not do for
anything but `--entry`, `--src` and `--cases`. `profile.mts` already filters by a positional; that
becomes a synonym for `--only` rather than a second mechanism.

The documentation change is the larger half of this item, and it is the measurement hierarchy in the
review note above: full suite for the summaries, focused for the targeted case, standalone for the
headline. The skill shipped all three scripts without saying which decides what.

The drift point is the strongest argument in the item. A bar table written once at calibration is
stale by experiment 6, so step 4 will say that a per-case bar comes from a control in the same
session as the experiment it judges, and step 6 will require the focused control next to the focused
experiment. The calibration table keeps its job for the two summaries, which move far less.

Also going in, because it follows from the same reasoning: a focused delta may not be compared with a
full-suite band. Precision comes partly from more iterations and partly from the other cases being
absent, and the second half changes the conditions. Like for like, or not at all.

## 2. Shared machine: probe before and after every run (high)

**What happened.** Other agents on the same machine ran test suites in bursts (load average 60-110)
for the whole session. The probe before a run was quiet, but a burst started during the run. About
one run in five overlapped a burst, and those runs looked like data: an identical-code control gave
`cookies` +11.3%, a cumulative run TOTAL -7.99% with the machine busy afterwards.

**What I did.** `perf/quiet.sh`: `jitter.mts --max 5 --wait 60` before the command, the command,
then one more probe. A run whose after-probe is busy is logged `INVALID` and repeated. 60-iteration
runs overlapped bursts far more often than 25-iteration runs, so I kept 25.

**Proposal.**
- Ship the wrapper in the runtime folder and make it the documented way to run `ab.mts`.
- In step 4, qualify the README advice "more iterations in one child buy more": on a machine with
  bursty load, shorter runs are better, because a run is only valid if the whole run was quiet.
  Recommend choosing iterations so one run fits between bursts, and using focused runs (item 1)
  for precision instead.
- `--max 2` (the default) never passed on this machine; `--max 5` did, matching the SKILL.md text
  "within about 5%". Make the script default match the text.

**Response: approve the first two, approve the third in the other direction.**

The after-probe is the insight here, and it is obviously right: you cannot know a run was quiet until
it has finished. So it should not depend on remembering a wrapper. `ab.mts` will run a short probe
itself after the last child (about a second) and print `machine: quiet` or
`machine: BUSY (p50 N% above min): treat this run as invalid`, in the output that the log row is
copied from. `quiet.sh` still ships, for the half that has to happen before the command, because a
blocking `--wait 60` inside a measurement command is the wrong default.

One caveat to record with it: a burst that starts and ends inside the run passes both probes. The
probes lower the error rate, they do not certify a run. The independent evidence stays what it was,
the identical-code control and the per-case bands.

The iteration advice is a good catch. The README sentence ("more iterations in one child buy more
than more children") was written on a quiet machine and is wrong on a shared one, where a run is
valid only if all of it was quiet. It gets the qualification and the pointer to focused runs.

On `--max`: I will make the two consistent by fixing SKILL.md to 2%, not by loosening the tool. The
comment in `jitter.mts` ("5% still runs, but its numbers were not usable in practice") is itself a
measured result from an earlier campaign, and raising the default would quietly raise the floor for
every future campaign on a quiet machine. What was missing is the escape hatch, so both places will
now say: if the machine never reaches the default, raise `--max`, record the value in the plan, and
expect the bar to rise with it. Your session is the worked example of that, not a reason to change
the default.

## 3. Async workloads (high)

**What happened.** The runtime only times synchronous bodies. The most valuable case (a whole
`fetch` through a mock dispatcher) returns promises, and the brief asked for it.

**What I did.** `run` and `collect` may return a promise. `timeNs` awaits a returned promise inside
the timed region; `ab.mts`, `solo.mts`, `guard.mts`, `profile.mts` and `scan.mts` await every call.
Sync cases pay nothing measurable. The async case runs a fixed batch (200 requests) per call, so the
microtask overhead is constant on both sides.

**Proposal.** Merge this into the runtime and document the fixed-batch rule next to the case-size
rules. The diff is small; see `perf/harness.mts`, `ab.mts` and friends on the reference branch.

**Response: approve as proposed.** I read the diff against the shipped runtime and will take it
essentially unchanged. Your claim that sync cases pay nothing holds for the reason that matters:
`timeNs` awaits only when the body returns something, so a synchronous body adds one function return
inside the timed region and no microtask.

Two things the diff does not say, which will go into the docs beside the fixed-batch rule:

- The returned promise must cover all of the work. A body that starts a timer, an I/O callback or an
  unawaited chain and resolves before that work finishes times the scheduling, not the work. That
  failure looks like a very fast case, not like an error.
- The timed region of an async body includes the microtask drain, which is the real reason the batch
  must be fixed: it makes that overhead a constant that pairing can cancel, instead of a term that
  scales with whatever the change did to the number of awaits.

## 4. A cheap isolation check before spending an experiment (high)

**What happened.** Five candidates would have cost an experiment each and all lost: a regex for
fetch's `isValidHeaderValue` (6x slower than the current `includes`), loops vs regexes for token and
core header checks (current code already faster), an `arguments` guard (V8 already removes it),
`Reflect.ownKeys` instead of a spread (2.7x slower; this also explained why experiment 1 failed),
`String.search` vs `RegExp.test` (30% slower, which rejected a code-review suggestion).

**What I did.** A 20-line script per question: the current function and the candidate over the same
realistic inputs, best of 20 repetitions, three rounds, plus an exhaustive equivalence check over
all 65 536 UTF-16 code units where the function is a character test.

**Proposal.**
- Add a step between "candidate" and "experiment": if the change is local to one function, time both
  versions in isolation first. It filters, it does not decide: a keep still needs the A/B.
- Ship a template (`micro.example.mjs`) with two traps in its comments, both of which I hit:
  results must be kept alive (write them into a sink array), or V8 removes the work and reports
  nothing (`new AbortController()` measured 0.02 ms for 80 000); and the inputs must be realistic,
  because regex vs loop flips with string length.

**Response: approve, with one limit added.**

Five candidates rejected for the price of five short scripts is the best return in this file, and
your framing ("it filters, it does not decide") is the right one. I am adding the other half of that
sentence, because a filter that is trusted too far is worse than no filter: a micro-benchmark may
**reject** a candidate, never keep one, and it may reject only on a large margin. It cannot see the
three effects that make the paired harness necessary in the first place, namely allocation and GC
pressure, hidden-class and call-site polymorphism, and inlining at the real call site. When a
candidate's value is one of those (it removes an allocation, it makes a call site monomorphic, it
lets a caller inline), an isolated loss is not evidence and the experiment has to be spent.

Worth recording as a synthesis, because your brief said the opposite in isolation: undici's own
`benchmarks/` race candidate implementations inside one revision, and the brief told you not to copy
that shape. That was right for the decision and wrong for the filter. The skill will say both, and
name the maintainers' benchmark style as the model for the filter.

The template ships with your two traps. The dead-code one is the more dangerous of them, because a
missing sink does not produce a suspicious number, it produces an attractive one.

## 5. Cases that accumulate state across runs (medium)

**What happened.** The first profile showed one case at 67% in `addAbortListener`. Each run added
abort listeners to one long-lived signal, and Node's EventTarget checks duplicates by walking the
list, so every run was slower than the one before. The timings looked ordinary.

**What I did.** Rebuilt the shared object inside the run every 10 derivations, and moved the
mechanism into the scaling scan, where it showed up as O(n²) (step ratios 17x and 24x). That became
the campaign's main decision item.

**Proposal.**
- Add a rule to the case-writing guidance: a case must not grow any state across runs (listeners on
  a shared object, caches, registries). Build shared objects in `setup` or inside `run`.
- Cheap detector: in the harness, compare the median of the first and the last quarter of a side's
  timings; a steady rise on identical code flags accumulation. Or: profile once before calibrating
  and read the top frame, which is what caught it here.
- Name "N operations on one shared object" as a scaling shape to try in the scan, next to
  "input length".

**Response: approve, all three.**

The detector earns its place for a reason your text implies but does not state: the A/B is blind to
this by construction. The per-side figure is a minimum, so it reports the cleanest early iteration,
and the delta is a paired ratio, so a drift that hits both sides cancels exactly. A case can double
in cost over a run while every column in the table looks ordinary. That is the same shape as the
existing markers, so it goes on the existing `perf-warning` channel and is documented as a hint, not
a gate: JIT tiering and heap growth can also produce a rise, and with 25 iterations each quarter is
six samples.

The rule goes to the README beside "let a case own its inputs", which turned out to cover mutation
of an input but not a shared object that the case only appends to. Yours is the more common shape,
because it looks harmless: nothing is overwritten, the case just remembers.

The scan shape is a genuinely new idea in this file. Everything the scan could find so far scaled
with input length; "N operations against one long-lived object" is a second axis, and it is where
listener lists, caches and registries hide.

## 6. Guard determinism with random output and mutated inputs (medium)

**What happened.** The first guard recorded a WebSocket frame sample that changed on every run: the
mask is random, and `createFastTextFrame` masks its input in place.

**What I did.** Sampled the deterministic parts plus a round-trip check (unmask with the frame's own
key, compare with the payload), and gave the in-place function a copy.

**Proposal.**
- Step 2: after `--update`, run the guard twice; a mismatch on unchanged code means a case samples
  randomness or mutated inputs.
- Name the round-trip pattern for outputs that contain randomness: sample what is deterministic and
  a verdict that the output decodes back to the input.

**Response: approve, implemented inside `--update` instead of as advice.**

`--update` will compute the samples twice and refuse to write when any key differs, naming the case.
"Run it twice" is a rule that gets forgotten exactly once, and the failure is the worst kind: the
guard still passes and fails at random for the rest of the campaign, which trains the reader to
ignore it. Making it impossible to record a non-deterministic expectation costs one extra pass over
the cases, once.

The round-trip pattern goes in step 2 as you describe it. It is the general answer for output that
contains randomness, a timestamp or an address: sample the deterministic part, and add a verdict that
the non-deterministic part is self-consistent.

## 7. Case body sizes (medium)

**What happened.** My first cases ran 0.3-3 ms per body; the warning appears only inside an `ab.mts`
run, after calibration had started.

**Proposal.** Have `guard.mts --update` (or a `sizes` command) time each body once and print the ones
outside 1-50 ms, before the first calibration run. It costs seconds and avoids a recalibration.

**Response: approve the need, change the placement.**

It becomes `ab.mts --sizes`: one revision, one timing pass per body, prints every case outside the
range and exits. The guard's job is behaviour, and the size range and its warning already live in
`ab.mts`, so putting the check there keeps one definition of the range instead of two that can drift
apart. It goes into the README setup list as the step between writing the cases and the first
calibration run, which is the part of your proposal that actually matters.

## 8. Adding a case mid-campaign (medium)

**What happened.** The skill allows adding a case with its expectation "recorded against the base
revision", but not how. The guard only runs against the working tree.

**What I did.** Checked out the base's `lib/` and `index.js` into the working tree, ran
`guard.mts --update --expected <tmp>`, restored the files, copied only the new key into the
expectation file, and verified that every existing key was identical between the two files (which
also proved that the kept changes preserved behaviour).

**Proposal.** `guard.mts --record <case> --rev <base>`: materialise the base, compute that one case,
merge it into the expectation file, and fail if any existing key differs on the base.

**Response: approve the capability, with a smaller surface.**

`guard.mts` gets the same positional revision every other script has (default `WORKTREE`), and then
your `--record` is just composition with the `--only` from item 1:

```sh
node perf/guard.mts main --update --only new-case
```

The safety rule you applied by hand becomes automatic and is the important part: when `--update` runs
against a revision other than the working tree it merges instead of overwriting, and it fails if any
existing key differs on that revision. Note what that check gave you as a side effect, which is worth
saying in the skill: it is also a proof that every kept change so far preserved behaviour, measured
against the base rather than against the previous commit.

A dedicated `--record` flag would have done the same thing in one place only. Two general options do
it here and in the next situation nobody has thought of yet.

## 9. Differential inputs are strings only (medium)

**What happened.** `differential.mts` feeds string inputs. The risky inputs here were objects
(records with symbol keys, getters that log their order, proxies, derived requests whose headers
must stay independent).

**What I did.** Named scenarios: an input string that matches a key in a `SCENARIOS` map runs that
function; other strings are parsed as data.

**Proposal.** Document this pattern in the differential section, or give the suite an optional
`scenarios: Record<string, () => unknown>` field. And add to step 6: when a change removes a copy,
add aliasing scenarios (mutate the source after deriving, mutate the derived after deriving,
compare both) before the change is kept. That is what made experiment 8 safe.

**Response: approve, as the explicit field rather than the documented pattern.**

`scenarios?: Record<string, () => unknown>` on the suite, run before the string inputs and reported
by name. Your overload works, but it gives one list two meanings, and the day a real input collides
with a scenario name is an hour nobody gets back. The explicit field also keeps the seeded random
inputs reproducible by index, which the overload quietly complicates.

The aliasing recipe is a refinement of the step 6 bullet that already exists ("a change that removes
a defensive copy needs an input where the aliasing is observable"). It says what that input looks
like, which is the part people get wrong: mutate the source after deriving, mutate the derived after
deriving, and compare both directions. It goes into that bullet. It does not become a second rule,
because two rules for one thing is how a checklist starts rotting.

## 10. Standalone runs, and when paired numbers overstate (medium)

**What happened.** The final WebSocket branch measured -69% / -68% paired (full), -54% focused, and
-32% standalone. The methodology section predicts this for small, call-site-bound cases, but the
size of the gap surprised me. Another row (`parse-headers` +3.7%, clean band, untouched code) was
equal standalone.

**What I did.** `solo.mts` three times per revision, alternating base and branch processes, and
used the standalone number as the headline.

**Proposal.**
- A `solo-ab.mts` that alternates processes A, B, A, B for N pairs and prints the per-pair deltas.
  I ran that loop by hand about eight times.
- In step 9, make "headline = standalone number" a rule for every case under ~5 ms per body, not
  only when a row looks suspicious.

**Response: approve both, with a different rule and one less script.**

The rule will be simpler than a size threshold: **every headline number in a PR comes from a
standalone run.** The paired runs are the decision instrument, the standalone run is what a
maintainer is told. A threshold invites an argument about which side of it a case falls on, and it
protects the wrong direction: the paired number is the one that overstates, so the cheap rule should
be the conservative one. Where an effect is too small for a standalone run to resolve it, which is
most near-bar keeps, the PR reports the paired number and names the instrument.

Your three numbers go into `methodology.md` as numbers, not as a prediction. -69% paired, -54%
focused, -32% standalone, monotonic, is the clearest evidence in three campaigns that each level of
isolation removes another part of the co-residency effect, and it is the argument I need the next
time a PR body is being written. Two zod PRs were closed over credibility, and a -69% that a reviewer
measures as -32% is exactly how that happens.

The alternating runner becomes a mode of `solo.mts` (`solo.mts <revA> <revB> <case> --pairs 4`)
rather than a new file. Same alternation, same output, one script that means "standalone", and the
existing single-revision form keeps working.

## 11. Near misses did not survive a focused re-test (medium)

**What happened.** Both near misses (dictionary converter, a fetch spread) looked like -1.4% to -2.2%
on their first runs. Bundled or re-tested in focused mode, both were indistinguishable from their
controls.

**Proposal.** Before a near miss goes on the bundle list, run it once focused against a focused
control. If it is not above the control there, log it as a discard. That saves the later bundle
experiment, which here cost two of the twelve.

**Response: approve.** This strengthens the near-miss rule rather than weakening it. The rule exists
because small real effects add up into a win that one experiment cannot see, and it paid for a whole
PR in an earlier campaign. What it never had was a way to tell "small and real" from "noise shaped
like a win", so every near miss went on the list with equal weight and the bundle was a coin toss.
Here that toss cost two of twelve experiments. The focused re-test is the missing filter, and it is
cheap because item 1 already built it.

## 12. Flaky tests under load (medium)

**What happened.** Two gate failures had nothing to do with the change: `referrer policy is origin`
(an assertion that never ran) and `esm-wrapper` (HTTP 403 from a server that only answers 200: a
reused port that another process answered). Both passed five times in a row on the change.

**Proposal.** Step 6: when a gate fails in a test the change cannot reach, re-run that file five
times on the change (and once on the base); pass five of five, and the change is unrelated, means
flaky. Log it with the test name. Without a rule it is tempting to either discard a good change or
wave the failure away.

**Response: approve.** The current rule ("otherwise discard and log `fail`") is safe against the
wrong risk: on a flaky suite it throws away good changes and teaches the agent to distrust the gate,
which is the more expensive failure. Your discriminator is cheap, and the base run is what turns it
from a judgement call into evidence.

Two additions. The reachability check comes first and is stated as a question with an answer in the
diff, not as an impression. And the log line keeps the test name, so a suite that flakes twice in one
campaign becomes visible as a property of the suite, which is something the PR can mention and the
maintainers may want to know. This also connects to item 2: port reuse and timeouts flake far more
often under exactly the load that invalidates measurements.

## 13. Gates that need system changes (medium)

**What happened.** The repo's WPT gate needs `/etc/hosts` entries (sudo). The setup prompted
interactively and stopped. I found out after the first WPT attempt, not in step 1.

**Proposal.**
- Step 1: run every gate once on the base before calibrating, including the expensive ones; report
  any gate that needs sudo, network, docker or a submodule, with the exact command the user can run.
- When a gate's runner rewrites its expectation file (WPT here), compare base and branch results
  run on the same machine, normalised per test and per case to pass/fail. Names with random ports
  and messages with UUIDs differ on every run. The committed expectation file described a different
  WPT checkout (1 167 vs 1 282 tests), so comparing against it was meaningless.

**Response: approve both. The second is the more valuable one.**

The first is a clean addition to step 1 and it converts a mid-campaign blocker into a question the
human can answer in step 0, while they are still in the conversation. An agent that hits a sudo
prompt three hours in has already lost the session's momentum.

The second generalises past WPT, which is why it is the better item: a gate whose output embeds
ports, UUIDs, temporary paths or timings must be normalised before two runs of it can be compared,
and a committed expectation file that describes a different checkout is not a gate at all, it is a
green light wired to nothing. The rule that falls out is the same one the skill already applies to
timings: compare base against branch, on the same machine, in the same session, and normalise
everything that is not the thing you are asking about.

## 14. Review round before packaging (medium)

**What happened.** A code review of the kept commits between campaign and packaging found no bugs,
but its cleanups changed the measured code: a one-line form of one change, a shared helper that
gave a second code path the unrolled loop (and doubled that PR's effect), and one suggestion that
was slower (`search` vs `test`, rejected after an isolation check).

**Proposal.** Add a review step to `pr-packaging.md` before branches are built, with two rules:
treat every review suggestion that touches a hot path as an experiment (isolation check, then the
branch verification), and expect the branch numbers to differ from the campaign log. The existing
"build the verification table from branch runs" rule then covers the rest.

**Response: approve, and this is the item I would keep if I could keep only one.**

The principle behind it is one sentence the skill does not contain: **any edit after the last
measurement invalidates that measurement.** Everything in the method is built to stop an unmeasured
change from reaching a conclusion, and then the packaging section assumed the kept commits travel to
the PR untouched. No review ends that way.

Your three outcomes are the whole argument in miniature: one cleanup was neutral, one doubled the
effect (so the campaign log understated the PR), and one was slower and would have shipped as an
improvement. Two of those three are cosmetic-looking changes with measurable consequences, which is
why "it is only a cleanup" cannot be the standard. The review step goes in before branches are built,
with your two rules.

## 15. Worktrees for PR branches (low)

**What I had to work out.**
- Worktrees outside the repo directory, so no test glob or formatter sees them.
- `node_modules` as a symlink to the main checkout's; `.gitignore` has `node_modules/`, which does
  not match a symlink, so it needs a line in `info/exclude`.
- Submodules are empty in a new worktree (WPT here). A symlink to the main checkout's submodule
  directory works; restore the empty directory afterwards (`trash`, then `mkdir`).

**Proposal.** A short "worktree setup" block in `pr-packaging.md` with these three points.

**Response: approve.** The `.gitignore` detail is right and not obvious: a pattern with a trailing
slash matches a directory, and a symlink to a directory is not a directory as far as git is
concerned, so the ignore misses it and the worktree looks dirty. That one costs ten confused minutes
every time it is met for the first time. All three go in as a block.

## 16. Base moved before creating the PRs (low)

**What happened.** Upstream `main` moved two commits between verification and PR creation.

**What I did.** `git diff --stat <base> origin/main` to see whether the touched files or the
invariants overlap, and `git merge-tree --write-tree origin/main <branch>` per branch to confirm a
clean merge. No overlap, so the branches stayed on the measured base.

**Proposal.** Add both commands to step 5 of `pr-packaging.md` ("re-verify before you nudge it"
covers the later case, not the day of creation).

**Response: approve.** Both commands go into section 5. `merge-tree --write-tree` is the right tool
and is under-used: it answers "does this still merge" without touching the working tree or the index,
so it costs nothing to run before every PR creation. The decision rule goes with it: an overlap in
the touched files, or in the files an invariant depends on, means re-verify on the new base rather
than rebase and hope.

## 17. PR mechanics (low)

- Merge the repo's PR template sections with the skill's body template; the skill does not say how.
  I put the campaign preamble first, then the repo's sections. Leave a DCO/CLA checkbox unticked:
  only the human can agree to it.
- For a first contribution, CI shows 0 checks until a maintainer approves the workflow runs. Say so,
  so nobody waits for checks that will not start.
- `gh repo fork owner/repo --clone=false` works; adding `--remote=false` made it fail.
- Build the bodies from a script with placeholders (PR number, companion links, harness link at a
  full hash), then fill and `gh pr edit` after all PRs exist. That kept four bodies consistent.

**Response: approve all four.**

The unticked checkbox is not mechanics and will go in as a rule, not as a note: a DCO or CLA box is a
legal declaration by a person, so an agent never ticks one, in any repository, for any reason. It
belongs next to the existing rule that the user confirms every PR before it is created.

The 0-checks state is worth the line because it looks exactly like broken CI, and the natural
reaction (push again, or ask the maintainer what is wrong) is the wrong one on a first contribution.
The ordering advice (create all PRs, then fill cross-references with `gh pr edit`) is the standard
answer to a set of PRs that reference each other, and it also stops the first body from being the
only one written by hand. The `gh` flag combination goes in as an observed detail with the version
caveat that implies.

## 18. Profiler gaps (low)

- `--lines` finds functions by name; anonymous functions (the webidl converters) cannot be selected.
  Accept `file:line` as well.
- Self time can exceed total time for a frame when V8 inlines (recordConverter showed 27% self,
  17.6% total). Say that line-level data is unreliable for inlined code, which cost me one wasted
  experiment.
- `--by-area`: aggregate self time by path prefix (for example `lib/mock/`, `lib/web/fetch/`,
  `node:`). The brief asked what share of the fetch profile the mock is; I wrote an inline
  aggregator for that (3.9% mock, 29% fetch, 33% Node internals).

**Response: approve all three, the second one first.**

Self time above total time is a contradiction that has a meaning, and an agent that does not know the
meaning will read the line data as if it were true. It goes into the traps list in the README, not
only into the profiler's help text, because it changed a decision: the profile said one statement was
hot, the statement had been inlined into its caller, and an experiment was spent on it.

`--by-area` is a small aggregation over data the profiler already has, and it answers the question
that gets asked at the start of every campaign with a mock, a fixture loader or a test harness in the
picture: how much of this profile is my instrument. Your 3.9% is also the answer that made the fetch
case trustworthy, so it is evidence worth being able to produce in one command.

## 19. Smaller harness fixes (low)

- `findPackages` crashed when a `src` entry is a file (`index.js`); fixed with an `isDirectory()`
  check.
- CommonJS entries through `entryModules` worked with `"*": "./index.js"` plus namespaced internals
  (`coreUtil`, `wsFrame`, `coreRequest`). Worth one line in the README, since internals are often
  what the cases need.
- zsh trap for scripts: `echo ==== CONTROL` fails (`=` expansion). Quote such markers.
- `git stash` without a pathspec stashed the harness change together with the experiment; always
  stash by path during the loop.

**Response: approve all four.**

`findPackages` is a real bug and I will take your fix. It is also the fourth defect in that file
found by a repository shaped differently from my test repos, which is the pattern that produced
`selftest.mts`; a root-level file as a `src` entry is now a case it should build.

The zsh note is correct and worth the line: a word starting with `=` triggers equals-expansion, so
`====` sends the shell looking for a command named `===`. It fails in a way that reads like the
script is broken rather than the marker.

Stashing by path matches the rule the user already keeps for worktrees, and the failure you hit is
the reason for it: a stash without a pathspec silently takes the instrument along with the
experiment, and the run afterwards measures neither.

## 20. Process notes (low)

- Write the plan while calibrating, not at the end. I held the calibration numbers only in the log
  and the conversation for most of the session.
- The dry-rule counter was ambiguous for a re-test of a near miss (is it a new experiment?). I
  counted it as one. Say so.
- A cumulative A/B run the day after keeps showing a noisy row on code no PR touched
  (`core-request` -6.5% / +7.1%). Tell the reader that the cumulative table inherits the full-suite
  noise and that per-PR standalone numbers are the reliable ones.

**Response: approve all three.**

The first is the one that would have cost you something later: the probe numbers, both noise floors,
the bar and the per-case bands are exactly the values a reader needs to judge the campaign, and they
live in the conversation until they are written down. A conversation is not a deliverable. Step 4
will say the plan is opened during calibration and the numbers land in it as they are measured.

Counting a re-test as an experiment is the right call and gets said in step 8, next to the dry rule.
Not counting it makes the budget elastic in the one direction where an agent is already tempted.

The third goes into the summary guidance and into the PR body template. A reader who sees a swing on
code that no PR touched is not being unreasonable when they stop trusting the whole table, so the
table has to say what it is before they ask.
