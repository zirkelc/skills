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

---

# Round 2: review of b973d68, run against undici itself

Reviewer: the campaign agent. Method: the changed node-ts scripts copied over `perf/*.mts` in the
undici campaign checkout (own `cases.mts`, `perf.config.json`, `guard-expected.json` kept: async
cases, CommonJS through `entryModules`), every new feature run on the real suite, then everything
restored. Nothing committed in either repository. Ordered by risk.

## Review of round 2 (added by the skill author)

Everything accepted. One blocker in code I shipped this morning (R1), one defect in a template that
reproduces the exact artefact the skill exists to warn about (R5), and one error of reasoning that is
mine and matters more than either (R9, with R10): I built a general claim out of a single case, and
that case turned out to be bimodal for the reason R1 found.

The three worth reading twice:

- **R1.** The drift warning fires on a third of clean cases, because I aggregated four noisy values
  with `max`. Requiring all four to agree (`min`) separates a real accumulator from noise by a factor
  of 30 on your data. My own test could not have found this: two clean cases and one deliberately
  broken one measure sensitivity, never a false-positive rate. That needs a dozen real cases, which
  is the fourth round in a row where the defect lived in a code path my test repo does not have.
- **R5.** `best(current)` and `best(candidate)` called through one call site make it polymorphic, so
  the template de-optimises the cheaper candidate and reports the wrong sign depending on order. The
  filter I added to catch call-site effects had a call-site effect. Any two-variant measurement in one
  process is the same class of error as two revisions in one process, and the answer is the same one:
  a process per variant.
- **R9 and R10.** "The paired number overstates, the error runs one way" is wrong, and your five-case
  table shows it going both ways by up to a factor of two. The rule survives with the reason that
  actually holds, which is the better reason anyway: the standalone number is the one a maintainer
  reproduces. I generalised from one case while the skill's own rules require two agreeing runs.

R11 then adds the part that was missing from the rule: a standalone headline without its own
identical-code control is not better evidence than the paired number it replaces, and "not resolvable"
is a legitimate verdict that the control is what produces.

## R1. The drift warning is wrong about one time in three on a real suite (blocker)

**Measured.** Three quiet identical-code full-suite runs (a fourth ended busy and is excluded). The
warning fired on 3-5 of 12 cases **per run**, at 12% to 113%:

| case | runs flagged (of 3) | values |
|---|---|---|
| request-clone | 3 | 16, 13, 12 |
| request-init | 2 | 14, 15 |
| response-new | 2 | 50, 54 |
| cookies | 2 | 113, 39 |
| core-request | 1 | 65 |
| ws-frame | 1 | 45 |
| parse-headers | 1 | 22 |
| fetch-mock | 1 | 14 |

**They are false positives.** Each flagged case run 400 times in one process, forced GC before every
call, median of the first 50 against the last 50, three repeats: no consistent growth (cookies -8%,
+28%, -5%; response-new +3%, +16%, +7%; core-request -1%, -4%). An effect of 50-113% inside 25
iterations cannot be accumulation that 400 iterations do not show.

**Cause.** `drift = max(driftPct(timesA), driftPct(timesB))` per child, and the parent prints the
warning if any child crosses 12%. That is the **worst of four** noisy values (2 sides x 2 load
orders), each a median of 6 samples.

**Fix, tested.** Take the **minimum** of the four. Real accumulation hits every side and every load
order the same way; noise does not. Same runs, both rules (a patched copy logged all four values):

| | worst of 4 (shipped) | min of 4 (proposed) |
|---|---|---|
| deliberate accumulator (`request-clone` with one shared base for the whole run, the campaign's original bug) | 363% | **324%** (all four >= 324) |
| clean `cookies` in that same run | 16%, flagged | 6% |
| clean control, quiet: largest value over 12 cases | 15% (flagged) | 9% |
| clean control, busy run: largest value | 177% (flagged) | -5% |

At the shipped 12% threshold the min rule gives zero false positives here and finds the real case by
a factor of 30. The threshold could even rise to 25%.

**Second signal the detector throws away: negative drift.** `ws-frame` showed -30% on the side loaded
first in every run. Standalone, its first 50 calls take 14.3 ms and later calls 2.8 ms, even after 20
warm-up calls; the harness warms up with about 13. That is a case that has not reached its optimised
code when timing starts, and it plausibly explains why this case was bimodal (within-run band about
-60%..+180%) in every paired run of the campaign. Proposed: a separate warning when the min of the
four values is below about -20%: "still warming up: raise the warm-up or the body size".

**Cost if shipped as is.** A warning that fires on a third of clean cases is ignored within one run,
which removes the only instrument that can see accumulation.

**Response: approve, blocker, fixing both halves.**

The aggregation is the bug and `min` is the right answer, for the reason you give: accumulation is a
property of the case, so it has to appear on both sides and in both load orders, while noise picks a
side. Requiring agreement is the same rule the method already applies to runs and to markers, and I
did not apply it to my own detector.

This changes where the decision lives. The child cannot decide any more, because no child sees the
other one: each child reports the drift of both its sides in the row, and the parent takes the
minimum across sides, load orders and repeats before it warns. That also removes the warning
deduplication, which existed only because each child announced its own opinion.

Threshold: 20%, not the 12% I shipped. Your min rule leaves clean cases at 9% quiet and -5% busy, and
finds the real accumulator at 324%. 12% has three points of headroom over a measured clean maximum,
which is how a warning becomes noise again on a machine slightly worse than yours; 20% still catches
the real case by a factor of 16 and would catch a much milder one. I will record both numbers next to
the constant so the next person can move it with evidence.

The warm-up signal goes in as well, with the mirrored aggregation: warn when the **maximum** of the
four is below -20%, since that is when all four agree the case is getting faster. It is worth more
than the accumulation half in my view: a case that has not reached optimised code when timing starts
is bimodal, and it poisoned every paired run this campaign made of `ws-frame`, including the -69%
that I then generalised into a rule (R9). The message names the two fixes, more warm-up or a larger
body.

One thing I am not doing: raising the default warm-up. Your case needed more than 20 body calls and
the harness gives about 13, but a default that covers `ws-frame` would still miss the next case that
needs 200, and it would lengthen every run. The warning is the honest version of that trade.

## R2. `solo --pairs 4` at the default 25 iterations is not a reportable number for allocation-heavy cases

**Measured.** On the WebSocket commit it reproduces the hand-measured -32%: -33.7%, -32.0%, and -32.4%
at the default, in 2-4 s. That case is stable across processes.

On allocation-heavy cases the defaults gave wrong medians:

| case | default (4 pairs, 25 iters) | 4 pairs, 100 iters, two runs |
|---|---|---|
| request-url | **-51%** (pairs -71% .. -14%) | -14.9%, -15.3% |
| request-clone | **+0.2%** | -17.0%, -12.8% |

Identical-code control (`solo.mts base base request-clone`): single pairs -16.5% .. +23.9% at 25
iterations, -2% .. +18% at 100; the median of 4 pairs moved 4% on identical code. The same revision
measured 2.6 to 3.4 ms across processes. (Hypothesis: which core type the process lands on.)

**Proposed.**
- In `--pairs` mode default to `--iters 100` and 8 pairs.
- Print each revision's spread across processes (min..max of the A column and of the B column).
- Make an identical-code solo control part of the standalone rule: `solo.mts A A <case>` next to
  every headline. Only that says whether a standalone run can resolve the effect, and the rule "where
  an effect is too small for a standalone run to resolve, report the paired number" otherwise has no
  test for "too small".

**Response: approve all three.**

The defaults move to 8 pairs and 100 iterations **in `--pairs` mode only**; the single-revision form
keeps 25, because there it confirms a suspicious row rather than producing a claim. A headline number
that takes 30 seconds instead of 4 is the right price, and your -51% against -15% is what the wrong
price looks like.

The per-side spread gets printed, and it is the more informative half: 2.6 to 3.4 ms for the same
revision across processes says "this case cannot be measured this way today" more directly than any
median can.

The control is the part I had missed, and with R11 it becomes the third clause of the standalone rule
rather than advice: a headline standalone number is reported with an identical-code control at the
same settings, and when the control's spread covers the effect, the fallback applies. I will also
have `solo.mts` print the control command when the two revisions differ, because a rule that needs a
second command is a rule that gets half-followed.

## R3. The after-probe ignores the documented escape hatch (design 2)

`ab.mts` prints BUSY above a hard-coded 2%. `jitter.mts`, `quiet.sh` and SKILL.md now say: raise
`--max` on a machine that never reaches 2%. A user who does that gets every run marked invalid.
Give `ab.mts` the same `--max` (default 2) and print the threshold in the verdict line.

**Response: approve.** I wrote the escape hatch into three places and then hard-coded the number in
the fourth. `ab.mts` takes `--max` with the same default and prints it in the verdict, so the line
says what it compared against.

## R4. `quiet.sh` is silent while it waits

`node perf/jitter.mts --max 2 --wait 60 | tail -2` hides the probe's progress. The first control of
this review waited **58 minutes** with no output; later windows came within seconds. Keeping 2% as the
default is defensible (design 3), but a silent hour looks like a hang. Print one line per minute
while waiting (drop the `tail`, or let `jitter.mts --wait` print a heartbeat).

**Response: approve, as the heartbeat rather than by dropping the pipe.**

Removing `tail` would print a line every two seconds, so 58 minutes becomes 1,500 lines of the same
sentence, which hides the outcome as effectively as printing nothing. `jitter.mts --wait` prints at
most one line a minute, with the elapsed time and the current spread, so the wait is legible and its
length is visible while it happens. `quiet.sh` then drops the pipe.

The 58 minutes are worth recording in the skill as well, next to the budget arithmetic: on a shared
machine the waiting is not a rounding error on the measurement time, it is most of the session.

## R5. `micro.example.mjs` measures through one shared call site

**Measured.** Its own example over three rounds: +1.8%, -11.4%, -14.4%. With the order of
`best(current)` and `best(candidate)` swapped, the later rounds still favour the candidate. One
process per candidate (no shared call site at all), three pairs: candidate **-10%** (1.19 vs 1.31 ms).

**Cause.** `best(fn)` calls `fn(...)` from one site. After both functions have passed through it, the
site is polymorphic, which removes inlining from the cheap candidate (`current` goes from 1.48 to
1.63-1.76 ms after round 1) while the regex candidate is mostly native work and barely changes. In
the library the call site is monomorphic, so the template measures a condition that never occurs.
Here rounds 2-3 happened to land near the truth and round 1 did not; my own "separate loop per
variant" script (same shared-site shape) gave +2..+5%, the wrong sign. Order-dependent in either
direction.

My campaign scripts had the same shape, so I re-checked the one that decided a PR, one process per
candidate: `String.search` is **43%** slower than `RegExp.test` (3.70 vs 2.58 ms, three pairs). That
decision holds.

**Proposed.**
- One process per candidate: the script re-spawns itself with the candidate's name, as `solo.mts`
  does, and alternates A, B, A, B. That is the only form without a shared site.
- A fixed-size sink (`sink[i & 1023] = fn(...)`) instead of `sink.push(...)`. The push added about
  10% to both sides (array growth to 100 000 entries inside every timed round) and dilutes the ratio.
- Equivalence: embed each code unit at the start, the middle and the end of a longer string, not
  alone. With a one-character string the first and the last character are the same, so a candidate
  that only checks the first character passes; header validators check exactly that position.

(Asked: does the template match the scripts actually written during the campaign? In structure yes,
flaw included.)

**Response: approve all three, and this is the most embarrassing item in the file.**

The template exists to filter candidates cheaply, and I gave it a shared call site, which is the same
polymorphism the whole method is built around. A tool that measures two variants in one process is
two revisions in one process at a smaller scale, and it needed the same answer from the start: a
process per variant. It goes in as you describe, re-spawning itself and alternating.

The fixed-size sink is a second real defect, not a tidy-up: `push` grows an array to 100,000 entries
inside every timed round, so both sides carry an allocation cost that has nothing to do with the
functions and that pulls the ratio toward 1. A filter whose bias is toward "no difference" is a filter
that passes bad candidates through to the experiments it was supposed to save.

The equivalence point is the one I would not have found: with a one-character string the first
character is also the last, so a candidate that only checks position 0 passes a 65,536-value proof.
Header validators check exactly that position. Embedding each code unit at the start, the middle and
the end costs three times nothing.

Good that you re-checked the decision the old shape made (`String.search` 43% slower, holds). That is
the right instinct: when the instrument turns out to be wrong, re-run what it decided rather than
assume the conclusion survived.

## R6. Guard `--update`: works, one message invites the wrong fix (design 4)

All three forms leave the file byte-identical to the committed one: re-run on an unchanged tree,
against the base, and re-adding `core-request` from the base after deleting its key. The merge-only
rule did not block anything real.

The refusal after a sample redesign (done twice during harness building in this campaign) says
"Behaviour changed @ WORKTREE: discard the change, or delete the file deliberately." Two problems:

- In the harness-building phase the **case** changed, not behaviour.
- After keeps, deleting the whole file and re-recording captures the **changed** code, including
  cases that had been recorded against the base. That is the exact failure the guard exists to stop.

Proposed message: "If you changed this case's `collect()`, remove its key and record it from the
base: `guard.mts <base> --update`. If you changed the library, discard the change."

Also worth one comment line: the second sample runs in the same process, so randomness that is fixed
once per process (a seed or a key drawn at module load) passes the stability check.

**Response: approve both.**

The message is worse than useless as written, because the fix it suggests (delete and re-record) is
the one failure the merge-only rule was added to prevent, and it suggests it at the exact moment the
person is annoyed enough to take it. Your wording goes in nearly verbatim: name the two causes, give
the command for the case-changed one, and keep "discard" for the other.

The per-process randomness limit gets the comment. Spawning a second process to close it would make
the guard meaningfully slower on every `--update` to catch a case that is rarer than the one the
in-process check already catches, so the honest move is to say what the check does not cover rather
than to imply it covers everything.

## R7. Smaller findings

- `--only` works end to end, including the children. A typo gives the right message, wrapped in two
  stack traces from `child failed:`. Print only the child's `Error:` line when it is a harness
  error.
- `--sizes` flagged 7 of 11 of the campaign's original cases in 0.6 s, which is exactly the mistake it
  should catch. Keeps shrink cases (`request-url` 2.0 -> 1.57 ms, `core-request` 1.39 ms), so run it
  again after large keeps.
- `--by-area` agrees with the hand count: mock 4.6% (hand: 3.9%), `lib/web/` 28.6% (hand, fetch
  only: 29.1%), `node:` 28.8% (32.9%); different runs. Two changes: split `(vm)` (36%) into GC,
  microtasks and native frames, because GC share is the allocation signal a campaign acts on; and add
  a depth flag, because two levels merge `lib/web/fetch`, `webidl`, `websocket` and `cookies`, the
  four areas this campaign worked in.
- `differential.mts` is backward compatible with a suite that encodes scenarios as strings (5 023
  items identical).

**Response: approve all four.**

The stack traces go: when a child fails with a harness error, the parent prints the child's `Error:`
line alone. A message written to be read ("--only names no case: ..., known: ...") is worth nothing
wrapped in two stacks.

`--sizes` finding 7 of 11 original cases, and the note that keeps shrink cases so it is worth
re-running after large keeps, both go into the README. The second is the non-obvious half: the
instrument degrades as the campaign succeeds.

`--by-area` gets both changes. Splitting the url-less frames matters most, because 36% in `(vm)` is
not an answer to anything, and the garbage-collector share is the one number that tells a campaign to
go looking for allocations. I will split what the profile actually labels (garbage collector,
program, idle, other native) rather than invent categories it does not carry. The depth flag goes in
with a default of 2, since your four areas are all under `lib/web/`.

## R8. The nine changed designs

- Agree as implemented: 1 (`--only` in `loadCases`), 5 (`--record` as composition), 6 (`--sizes`
  in `ab.mts`), 8 (explicit `scenarios`).
- Agree, with the fixes above: 2 (after-probe; needs `--max`, R3), 3 (`--max 2`; needs progress
  output, R4), 4 (merge-only guard; message, R6), 7 (`solo --pairs`; defaults and a solo control, R2).
- 9 (unconditional standalone rule): agree with the rule, disagree with its stated reason. See R9.

**Response: noted, and this is the useful shape for a review of a review.** Four designs confirmed by
running them, four confirmed with a defect attached, one where the rule survives and its justification
does not. Nothing here needs me to defend a choice, which is the outcome I wanted from asking you to
run it on a real repository rather than to read the diff.

## R9. The standalone rule is right; "the paired number overstates" is not

SKILL.md, `methodology.md`, `pr-packaging.md` and the commit message justify the rule with a
monotonic hierarchy (paired full > focused > standalone, "the error runs one way"). The four PR
branches of this campaign do not show that:

| case | full paired | focused | standalone |
|---|---|---|---|
| ws-frame | -69 / -68 | -54 / -54 | -32 |
| request-url | -21 / -20 | -24 / -25 | -15 |
| request-clone | -11 / -12 | -15 / -16 | -13 / -17 |
| cookies | -8 / -18 | -19 / -18 | -21 |
| headers-record | -7 / -8 | -7 / -8 | -7 |

Monotonic for ws-frame only, and ws-frame is the case with the warm-up problem from R1. For
request-url the focused run is larger than the full suite; cookies and request-clone come out larger
standalone. Keep the rule, but give it the reason that holds: **the standalone number is the one a
maintainer reproduces**, in both directions.

Applied to the four PRs of this campaign, the rule changes 3 of 4 bodies, not always downward:
request-url 1.25x -> about 1.18x, request-clone 1.13x -> about 1.17x, cookies 1.22x -> about 1.27x,
ByteString unchanged; WebSocket already used the standalone number.

**Response: approve. This is my error and it is the one that matters most in this round.**

I took one case, wrote "monotonic, and in that order", and built a table in `methodology.md` around
it. Three things were wrong with that. The direction does not generalise, as your five cases show, by
up to a factor of two in both directions. The one case it came from was bimodal for a reason the same
review has now found. And the skill's own rules would have stopped me: nothing is a result until two
independent measurements agree, and n=1 with no control is not a finding, it is an anecdote with a
table around it.

The rule stands and the reason is replaced everywhere it appears, which is `SKILL.md` step 6 and step
9, `methodology.md` ("Two revisions in one process"), `pr-packaging.md` section 3, the commit message
of b973d68 (which I cannot rewrite, so the follow-up commit will say what it corrects), and the
`?`-marker discussion, which is untouched by this.

The new reason is better than the one it replaces, because it does not depend on a measurement at
all: a maintainer builds one revision per process, so that is the number they get, whichever
direction it differs in. Your five-case table replaces my one-case table, with the point stated
plainly next to it: the three levels measure different things, the differences are large, and they go
both ways.

"Changes 3 of 4 bodies, not always downward" is the sentence that makes the rule easy to keep. A rule
that only ever lowered a claim would be read as conservatism and rounded away.

## R10. Corrections to my own round-1 numbers, now quoted in the skill

- "`cookies` went from 3% to 13%": 13% was the **bar**, twice a band of 6.6%. The band came from one
  valid control (-6.56%) and one control that ended on a busy machine (+11.29%). The band roughly
  doubled, not quadrupled. Affects SKILL.md step 4, `methodology.md`, the commit message.
- "-69 / -54 / -32": one case, bimodal because of R1's warm-up problem. Not a general hierarchy (R9).
- "a cumulative run at -7.99%" as the example of busy runs that look like data: invalid, but the
  valid runs said -6.8% / -7.5%, so it looked like data because it nearly was. The +11.3%
  identical-code control is the example that makes the point.

**Response: approve all three. Thank you for auditing your own numbers after they were quoted.**

This is the part of a review that almost never happens, and all three corrections weaken claims I had
already written into the skill.

The cookies one changes the sentence but not the rule: a band that roughly doubles inside one session
still makes a bar written at calibration wrong, and I will say "roughly doubled, from a band of about
3% to about 6.6%" instead of quoting a bar as if it were a band. I will also say that one of the two
controls behind the 6.6% ended on a busy machine, because the honest version of this example is
partly a story about invalid runs, which is the neighbouring rule.

The -69/-54/-32 correction is folded into R9.

The -7.99% goes, and the +11.3% identical-code control replaces it. It was the better example anyway:
a busy run that lands near the true value teaches nothing, while a control that reports 11% on
identical code is the thing that makes someone throw a run away.

## R11. Addendum: final standalone numbers (8 pairs, 100 iterations, with controls)

Measured after R1-R10 with `solo.mts A B <case> --pairs 8 --iters 100`, each next to an
identical-code control (`solo.mts base base <case>`, same settings). These now stand in the four PR
bodies (#5901-#5904) and replace the standalone column of R9's table:

| case | standalone median | pair range | identical-code control |
|---|---|---|---|
| ws-frame | -32.2% | -32.7 .. -25.4 | +0.1%, -1.3 .. +1.5 |
| request-url | -12.6% | -24.3 .. -2.5 | 0.0%, -6.5 .. +7.2 |
| request-clone | -14.2% | -27.6 .. -3.6 | -1.8%, -16.2 .. +11.7 |
| request-init | not resolvable | | -33.8 .. +32.2 over two controls |
| headers-record | -10.4% | -17.8 .. -2.5 | -1.7%, -7.2 .. +9.1 |
| cookies (ByteString branch) | -9.2% | -14.2 .. -5.0 | +1.2%, -4.2 .. +6.3 |
| cookies (getCookies branch) | -23.0% | -28.2 .. -13.5 | +0.2%, -6.9 .. +2.0 |

Two consequences for the skill:

- **The controls are what made these reportable.** Their spread differs by a factor of 20 between
  cases (ws-frame +-1.5%, request-init +-33%), and without them the -51% / +0.2% of R2 would have
  looked just as final. A standalone headline without its own identical-code control is not better
  evidence than the paired number it replaces.
- **"Too small for a standalone run to resolve" happens, and on a real effect.** `request-init`
  measured -8.5% / -9.8% focused against focused controls of +0.2% / +0.8%, and standalone
  it cannot be told apart from its control. The skill's fallback (report the paired number and name
  the instrument) is the right rule; the control run is the test that triggers it. The PR body for
  #5901 does exactly that.

With standalone numbers, R9's direction check reads: request-url standalone (-12.6%) below both
paired levels; headers-record (-10.4%) and cookies on the getCookies branch (-23.0%) *above* both
paired levels. The error runs both ways.

**Response: approve. This completes the rule rather than adding to it.**

I wrote "every headline number comes from a standalone run" and left the reader without a way to know
whether that number means anything. Your control column is that way, and the factor of 20 between
`ws-frame` (+-1.5%) and `request-init` (+-33%) is why it cannot be assumed: the same command, the same
settings, and one case resolves a 32% effect while another cannot resolve 9%.

So the standalone rule becomes three clauses, and the third is yours:

1. The headline number comes from a standalone run, one revision per process, alternating.
2. It is reported next to an identical-code control at the same settings.
3. When the control's spread covers the effect, the effect is not resolvable standalone: report the
   focused number, name the instrument, and say that the standalone control could not separate it.

`request-init` is the case that makes clause 3 concrete, and it is worth quoting in the skill exactly
as you found it: a real effect (-8.5% / -9.8% focused, against controls of +0.2% / +0.8%) that the
standalone run cannot resolve. Without clause 2 that case has two bad outcomes, either a confident
standalone number that is noise or a real win dropped, and clause 3 is the only honest third option.

I will also carry your framing that a standalone headline without a control "is not better evidence
than the paired number it replaces". That is the sentence that stops clause 1 from being cargo cult.

---

# Round 3: verification of 809c76b and 4803a14 on undici

Same method as round 2: runtime copied over the undici campaign's `perf/`, own cases kept, a copy of
`ab.mts` that prints the four drift values per case from the parent, everything restored after.
Nothing committed.

## V1. Drift rules on the twelve cases (the point of this round)

Three quiet identical-code full-suite runs at the defaults (`--warmup 3`), four values per case:

- **Accumulation rule (lowest of four > 20%): 0 warnings in 36 case-runs.** It held on exactly the
  pattern that produced 113% before: `request-clone` 4 / 6 / 152 / 191, `parse-headers` -0 / 8 / 83 /
  85. Two values from one child spike, two stay near zero, and agreement ignores it. Largest lowest
  value on a clean case: 9% (same as in round 2), so 20% has room.
- **Warm-up rule (second-lowest < -20%): 8 warnings in 36 case-runs.** `ws-frame` 3 of 3,
  `headers-append-iterate` 2, `headers-record`, `response-new`, `cookies` 1 each.

**The warm-up warnings on the four ordinary cases are true.** Two full runs at `--warmup 20`: they
are gone (`headers-record` 4 / 5 / 9 / 10, `headers-append-iterate` -1 / 2 / 4 / 7, `response-new`
-5 / 3 / 4 / 11, `cookies` -5 / -5 / 1 / 4). One `parse-headers` warning remained in one run (-42 /
-22). So the default `--warmup 3` is too low for this suite, and the new rule found that. Worth a
line in the README: when several cases warn, raise the default for the campaign rather than per case,
and recalibrate, since warm-up changes what the bars were measured on.

## V2. ws-frame: the warning fires, raising `--warmup` does not fix it

| run | warm-up | four values | band |
|---|---|---|---|
| focused, 60 iters | 3 | -41 -38 -38 -4 | -53.9% .. +96.0% |
| focused, 60 iters | 3 | -46 -39 -3 1 | -55.2% .. +124.9% |
| focused, 60 iters | 50 | -53 -53 -6 -5 | -55.4% .. +124.6% |
| focused, 60 iters | 50 | -50 -49 21 21 | -54.3% .. +126.0% |

Warning in every run, bimodal band unchanged. Standalone the same case is stable to +-2% (V3). So this
is not warm-up that more iterations cure: in-process, with two revisions of the module, the case
keeps getting faster far past any warm-up, on the side loaded first. The message tells the user to
"raise --warmup or the body size", which here would cost an experiment and change nothing.

Proposed message addition: "If the warning survives a raised --warmup, this case is not stable
in-process: decide it on focused runs against a focused control, and report it standalone." That is
what the campaign did by instinct and what the skill can now say.

## V3. `solo --pairs` at the new defaults (8 pairs, 100 iterations) against R11

| case | R11 | now | control now | verdict |
|---|---|---|---|---|
| ws-frame | -32.2% | -32.0% | -1.9 .. +2.2 | reproduces |
| request-url | -12.6% | -17.7% | -3.2 .. +3.4 | direction and size agree, ranges overlap |
| request-clone | -14.2% | -8.2% | **-19.2 .. +18.4** | **not resolvable**: both values inside the control |
| request-init | not resolvable | not resolvable (-2.1%) | -18.7 .. +15.4, median -11.7 | consistent |
| headers-record | -10.4% | -11.5% | -7.7 .. +6.4 | reproduces |
| cookies (ByteString) | -9.2% | -10.0% | -2.4 .. +3.5 | reproduces |
| cookies (getCookies) | -23.0% | -21.5% | -6.2 .. +5.1 | reproduces |

Five of seven within their controls. The miss matters: `request-clone` was in PR #5901 as -14.2% /
1.17x. By the rule this round added, it is not resolvable standalone, and #5901 now reports the
focused paired number for it, named as such.

The per-revision spread line is what made this visible without arithmetic (base alone 2.55 .. 3.42 ms
across processes).

Two refinements:

- **Define "the control covers the effect".** As written it is a judgement call. `headers-record`
  (-11.5% against a control of -7.7 .. +6.4) passes narrowly, `request-clone` (-8.2% against +-19%)
  fails clearly, and a rule between them is what keeps the call honest. Proposal: the effect's median
  lies outside the control's pair range, in two runs made on different occasions. `request-clone`
  fails that on both runs, `headers-record` passes both.
- **Suggest two runs, not one.** request-url moved from -12.6% to -17.7% between days with tight
  controls both times. A single standalone run is one sample of the day.

## V4. `--by-area --depth 3` on fetch-mock

```
31.4%  node:
26.0%  lib/web/fetch/
24.4%  (garbage collector)
 4.1%  lib/mock/
 4.1%  runMicrotasks
 2.7%  parse
 1.9%  (program)
 1.4%  lib/web/webidl/
 0.7%  lib/core/
 ...   now, latin1Slice, enqueueMicrotask, decodeUTF8, ... each on its own row
```

Yes on both questions. GC is its own row, and the areas separate (fetch, webidl, mock, core; mock
4.1% against the hand count of 3.9%). One correction to the round-2 reasoning: `runMicrotasks` is a
frame in this profile (4.1%), so the V8 labels do show microtasks, which supports the choice of
using them. Cosmetic: every url-less builtin is its own row (`parse`, `now`, `latin1Slice`,
`enqueueMicrotask`, `decodeUTF8`, ...). Keeping the parenthesised V8 labels and grouping the rest as
`(native)` would keep the list short.

## V5. Regressions from round 1

None found. Checked on the real suite: guard (check, `--only`, `<base> --update`, byte-identical file,
the new two-cause message), `--sizes`, `--only` typo in `ab.mts` (now one line), differential (3 023
items identical), `solo` single form, `profile` positional case list, `mem.mts`, `scan.mts`, the
micro template (median -12%, consistent with the one-process-per-candidate truth of about -10%).

Small items:

- `solo --pairs` with a typo prints the table header before the one-line error, because the name is
  checked in the child. Check it in the parent before printing, as `ab.mts` effectively does.
- `micro.example.mjs`: `Number(stdout)` turns a crashed child into `NaN` without a message. Check
  the exit status.
- `combine()` with `--repeats > 1`: taking min-of-mins and max-of-maxes per load order keeps the
  accumulation rule strict but makes the warm-up rule looser, because one child's extreme can then
  supply both values of a load order. Only matters with repeats, which the campaign never used.
- `scan.mts` now flags `headers-many-names` (step ratios 5.85 / 6.86 against a limit of 5.6), an
  n log n sort with cache effects at a million names; the campaign's run was just under. The margin
  of 1.4x sits close to what n log n produces at these sizes. Low priority, but a "borderline" band
  between 1.4x and 1.8x would stop it reading as a finding.
