# Feedback from the first campaign: micromark

Campaign: micromark monorepo (23 npm workspaces), branch `perf-autoresearch`, 16 experiments,
7 kept, 9 discarded. Result: suite total -7.3%, geomean -9.3%, three quadratic resolvers made
linear. Output: 6 upstream PRs (micromark#234 to #239), 1 PR in a sibling repo
(micromark-extension-gfm-strikethrough#5), and 1 CI fix PR found along the way (micromark#240).
The adapted harness, plan and log are at
<https://github.com/zirkelc/micromark/tree/aa1760d79f8a4b898c071faf3676ff19aea5b8cc/perf>.

This file lists everything I had to work out myself because the skill did not name it. The
items are ordered by how much time they cost or how much they would have changed the result.
Each item has a concrete suggestion for where it belongs.

## Review by the skill author (2026-09-24)

All 18 items approved: 16 as written, 2 with a change (item 6's threshold, item 17 partly). Nothing
rejected. A campaign on a 23-workspace monorepo with a generated build found the parts of the method
that only ever met a single-package, source-only library.

**Four are defects, not gaps.** Each one is an instruction of mine that is wrong rather than missing:

- **1** `WORKTREE` returns the on-disk path, so a repo whose build output is generated measures a
  stale artifact after every edit.
- **3** I recommended `.git/info/exclude` for scratch directories as if it hid them from tooling.
  Only git reads it. Formatters, linters and type checkers do not.
- **5** the gate canary reuses the harness canary's busy loop, which cannot fail a behaviour gate, so
  the check can only pass.
- **8** "the band of each case" is ambiguous between two quantities that differ by an order of
  magnitude, and the reading I assumed makes an earlier safety argument of mine false. One real
  effect was discarded because of it.

**What ships.** Harness: `build` in the config with per-tree builds in workspace order, content-hashed
`WORKTREE` when a build is configured, monorepo resolution (tree-local symlinks, dereferenced copies
of dependents, generated per-tree entry, a resolution assertion at start), trees under
`node_modules/.perf-trees/` with the profiler prefix fix, case-size warnings, `jitter.mts --max/--wait`,
`profile.mts --callers/--lines`, and three new files: `scan.mts`, `differential.mts`,
`gates.example.sh`. Method: the scaling scan and a **keep (asymptotic)** category, the per-case band
defined as the spread of medians across calibration runs, markers never overriding two agreeing runs,
differential tests for inputs the suite does not cover, control runs during the campaign, no CPU work
beside a measurement, continuing after step 8, warm and repeated cross-checks, and six packaging
rules of which the privacy scrub is blocking.

**What does not ship.** A size script (repo-specific, so the rule goes into the methodology instead),
`callers.mjs` as a separate file (it folds into the profiler), and the general zsh traps beyond the
one refspec the skill itself tells people to run.

**Order, by what a campaign loses without it:** 8, 1, 3, 5, 10, 2, 6, then 11 to 16, then the rest.
Items 8 and 5 change decisions, 1 and 3 can invalidate a whole campaign's evidence, and 10 is a class
of win the method could not see at all.

**Implemented in `32b57e3`.** What changed per item, where I deviated from your suggestion, one
finding of my own that came out of testing it, and how to verify the lot:
[Appendix: the implementation](#appendix-the-implementation).

## 1. Harness: repos whose build output is generated and gitignored

**What happened.** micromark writes its production files (`index.js`, `lib/`) from `dev/` with a
babel step (`micromark-build`: unassert, undebug, inline constants), and the output is
gitignored. `git archive` of a revision contains only `dev/`. `WORKTREE` returned the working
tree's entry directly, which would measure a stale build after any edit. Users load the
production build (the default export condition), so that is what the harness had to measure.

**What I did** (in `perf/harness.mts` on the fork):

- Materialise **every** side, including `WORKTREE`. The working tree is packed from
  `git ls-files -co --exclude-standard -- <src>` and keyed by a sha1 of the file contents, so an
  unchanged working tree reuses its build and any edit gives a new tree. The harness can then
  never measure a stale artifact, and the guard runs on the same kind of artifact as the A/B.
- Run the repo's build in each tree after unpacking, **in workspace order** from the root
  manifest. Inlining constants reads the built files of dependencies, so an unordered build
  fails with a module-not-found error from `import-meta-resolve`.

**Suggestion.** Add a `build` extension point to `perf.config.json` (a command or a function run
in each tree), and make `WORKTREE` a content-hashed materialisation by default. Add to step 1:
"If the build output is gitignored, the harness must build each tree itself; never let a side
fall back to on-disk artifacts."

**Response (skill author): approved, and it is a defect.** `materialise` returning the on-disk path for `WORKTREE` assumes the source is the artifact. That holds for a source-only library and silently fails everywhere else. Adopting both halves: a `build` command in `perf.config.json`, run per tree in workspace order, and a content-hashed `WORKTREE` materialisation. One refinement: tie the content hash to the presence of `build`. A repo without a build step gains nothing from copying its sources per experiment, and pays a copy on every run. With `build` configured, no side may point at on-disk artifacts, which is the rule you want in step 1.

## 2. Harness: workspace packages and third-party dependents that import them by name

The runtime README says: "add them to `src` and import them by path, or accept that they are
shared". Neither was enough here.

- The internal packages import each other by name, so every tree got its own
  `node_modules/<name>` **symlink** to `../packages/<name>` inside the tree. Node resolves the
  tree's own `node_modules` before the repo root.
- The workload also needs third-party packages that import workspace packages by name
  (`micromark-extension-gfm*` → `micromark-util-*`, `mdast-util-from-markdown` → `micromark`).
  These had to be **real copies** (`fs.cpSync(..., {dereference: true})`), not symlinks.
  Node resolves a symlink to its realpath, which is in the root `node_modules`, and from there
  the package would import the working tree's packages again.
- I verified the resolution with a small `check.mjs` inside the tree
  (`import.meta.resolve` of every package name). The canary would have found a leak too, but
  much later.
- Each tree gets a **generated entry file** (`perf-entry.mjs`) that re-exports the library plus
  the ecosystem pieces the cases need (`gfm`, `fromMarkdown`). The cases module can then use
  one `lib` object whose parts all come from the same tree.

**Suggestion.** A section "Monorepos" in `runtimes/node-ts/README.md` with these four points,
and a `copyDependents` pattern (a regex over root `node_modules`) plus a generated `entry` in
the config.

**Response: approved, and the README advice was wrong, not merely incomplete.** "Accept that they are shared" means measuring one revision twice while reporting a delta between two, which is worse than a leak I cannot see. Shipping all four parts: tree-local `node_modules/<name>` symlinks for workspace packages, dereferenced copies for third-party packages that import workspace packages by name (`copyDependents` as a regex over the root `node_modules`), a generated per-tree entry from an `entryModules` map so the cases get one `lib` whose parts all come from one tree, and your `check.mjs` as an automatic assertion: resolve every configured package inside the tree and fail if any path lies outside it. That last one is the important one. It turns a leak the canary finds late into a startup error.

## 3. Harness location: keep trees out of reach of every repo tool

`.perf-trees/` at the repo root was inside `tsconfig.json`'s `include: ["**/*.js"]`, and
also inside the reach of `xo`, `prettier` and `remark`.

- **`.git/info/exclude` does not help.** prettier, xo and remark read `.gitignore` or their
  own ignore files, not `info/exclude`. The skill recommends `info/exclude` for exactly these
  directories.
- **Fix:** put the trees under `node_modules/.perf-trees/`. Every tool already ignores
  `node_modules`, and Node still resolves the remaining dependencies upward from there. The
  profiler then needed a patch, because it hides any frame whose URL contains `node_modules`:
  I strip the `node_modules/.perf-trees/<key>/` prefix before classifying frames.
- The harness `.mts` files and the plan and log in `perf/` were still linted: remark failed
  the format gate on `perf/plan.md` (`-f` turns warnings into errors), and xo reported 312
  errors in the `.mts` files. So the harness commit had to add `perf/` to `.prettierignore`,
  a new `.remarkignore`, and `xo.config.js`. Those edits live only in the harness commit and
  never reach a PR.

**Suggestion.** Step 3: "Put trees under `node_modules/.perf-trees/`. Check each formatter,
linter and type checker for whether it reaches `perf/`: `.git/info/exclude` is honoured by git
only. If one does, add ignore entries in the harness commit." Update `profile.mts` to handle
the `node_modules/.perf-trees` prefix.

**Response: approved. My advice was wrong in a way I did not notice twice.** I recommended `.git/info/exclude` for scratch directories as if it hid them from tooling; git is the only thing that reads it. `node_modules/.perf-trees/` is the right default precisely because every formatter, linter and type checker already ignores that directory, and Node still resolves upward from it. It also exposes a latent bug: `profile.mts` drops frames whose URL contains `node_modules`, so with trees there it would hide the entire library. The prefix strip ships with the move. The ignore entries for `perf/` stay a harness-commit concern, which is item 16's first point.

## 4. Two conditions: which gate reads which artifact

The skill asks this question (step 1) but does not say how to make the gates safe once the
answer is "different artifacts". Here:

| gate | artifact |
|---|---|
| `test-api-dev`, `test-coverage` | `dev/` sources (development condition) |
| `test-api-prod` | gitignored production build, **stale unless `build` ran first** |
| guard | its own freshly built tree (item 1) |

The gate canary proved it: with a behaviour change in `dev/` and no rebuild, the guard and
`test-api-dev` failed, but `test-api-prod` passed.

**Suggestion.** Add a rule: "A gate that reads a derived artifact runs only after the step that
generates it, in the same script." Ship a `gates.sh` template (item 14).

**Response: approved.** The skill says to regenerate derived artifacts before the gates, which is the same idea stated as a habit rather than as a structure, and a habit is exactly what gets skipped at experiment 12. A script that runs the gates in dependency order makes the ordering impossible to get wrong and gives one line per gate to paste into the log. `gates.example.sh` ships with the runtime.

## 5. The gate canary needs a behaviour change, not a busy loop

Step 3 says to use "that same edit" (the busy loop) for the gate canary. A busy loop changes
timing, not output, so no guard or test can fail on it. I used a second canary that changes
output (`sanitizeUri` returning `value + "canary"`) and ran the gates without a rebuild.

**Suggestion.** In step 3, split the canary: a slowdown for the harness, and a behaviour change
for the gates.

**Response: approved, and it is a defect in step 3.** "With that same edit in place" is wrong: a busy loop cannot fail a behaviour gate, so the gate canary as written can only pass, which makes it worse than no canary. Two canaries now: a slowdown for the harness, and an output change for the gates, run without regenerating derived artifacts.

## 6. Noise changes during a campaign: wait for a quiet machine, recalibrate

- The first calibration was very quiet (floor 0.08%). Two experiments later, an identical-code
  control measured -1.27%: the user's browser was using 40 to 80% CPU. The per-iteration
  bands doubled.
- `jitter.mts` said "OK" at up to 5% above min, but runs started at 5% were clearly noisier.
  One run started at 6.9% after my wait loop timed out, and I had to mark it invalid.
- What worked:
  - A wrapper (`ab.sh`, item 14) that polls the probe until p50 is under **1.5%** above min,
    then runs the A/B.
  - `--repeats 2 --iters 30`.
  - A recalibration with two new controls: floor 0.75%, bar raised to 1.5%.
  - Re-confirming both earlier keeps under the new settings.
- The wait dominated wall-clock time: up to 10 minutes per run versus 90 s of measurement.
  The budget estimate in step 4 did not account for it.

**Suggestion.** Step 4:
- Re-run an identical-code control every few experiments, or whenever bands look wider than at
  calibration.
- If the control exceeds the floor, recalibrate and re-confirm the keeps made since the last
  good control.
- Make `jitter.mts` accept a threshold (`--max 1.5`) and a wait mode, instead of a wrapper.
- Record in the log when a run started on a busy probe, and treat it as invalid.
- Budget for the wait, not only for run time.

**Response: approved.** The probe was built to answer "is this machine quiet now", and the campaign needs "keep it quiet for the next hour", which is a different question. Adopting: `--max` and a wait mode in `jitter.mts` (poll, with a timeout, and fail rather than measure when it expires), a control run every few experiments or whenever the bands widen, recalibration plus re-confirmation of the keeps since the last good control, and the wait in the budget arithmetic. On the threshold: 5% stays as the point above which numbers are unusable, but the default for `--max` becomes 2, because your runs at 5% were already too noisy to trust and a default that permits them is a trap.

## 7. Never run CPU work next to a measurement

A/B runs went into the background (they take minutes). Gates, builds and the profiler must
not run while an A/B is in progress, or they skew it. I stashed the next experiment and waited
for the notification.

**Suggestion.** One line in step 6 or step 7: "While an A/B run is in progress, do not start
builds, tests or profiles. Read code instead."

**Response: approved, one line in step 6.** Obvious once stated, and easy to violate precisely when a campaign is going well, because a backgrounded A/B looks like free time.

## 8. Definition of a per-case "band" for the keep rules

Step 4 asks for "the band of each case, taken from the same three runs". But the harness prints
a per-run interquartile band per row, which was ±5 to ±15% here. That is far wider than the
spread of the per-case medians across runs (0.5 to 1.8%). I used "largest |median delta| over
the three runs" as the per-case noise and 2x that as the per-case bar.

In experiment 14 the rules conflicted: the targeted case was -4.9% and -4.6% (above its 3.2%
bar), but marked `?` in both runs. "Marked in both runs → no effect" won, and I logged a near
miss.

**Suggestion.** Define the per-case band explicitly (spread of per-case medians across the
calibration runs). State which rule wins when a case clears its per-case bar but is marked in
both runs.

**Response: approved, and this is the item with the largest effect on decisions.** "The band of each case" was ambiguous, and the two readings differ by an order of magnitude: the in-run interquartile spread (5 to 15% here) and the spread of per-case medians across calibration runs (0.5 to 1.8%). Your reading is the right one, because the bar has to be compared with a quantity measured the same way as the effect, and it will be defined that way.

That also breaks an argument I published earlier. I claimed a case marked in both runs cannot clear its own bar, so the two rules cannot conflict. That held only while both came from the same quantity. With the band defined across runs, they can conflict, and experiment 14 is the proof. The resolution is the one the markers already carry: a marker says the run does not confirm the row, never that the change does nothing. Two runs that agree at -4.9% and -4.6% outrank a wide within-run spread; the correct next step is a standalone run, not a discard. I will fix the rule and the argument rather than keep a rule that discarded a real effect.

## 9. Case size: check it in the first run

My first chat cases took 80 to 160 ms per body (the guideline is 5 to 50 ms). I only noticed
in the canary run, and had to change the fixtures and amend the harness commit before the
first experiment.

**Suggestion.** Let `ab.mts` warn when a case's minimum is above 50 ms or below 1 ms.

**Response: approved.** Cheap, and it catches the mistake at the only moment it is cheap to fix. `ab.mts` will warn when a case's minimum body time is above 50 ms or below 1 ms, and name the case.

## 10. A scaling scan finds a class of wins that the suite cannot show

The strongest late wins were **quadratic** code paths: mid-array `splice` inside a resolver
loop, once per item. On chat-sized documents they are invisible (suite-neutral), but on long
input they cost 5x to 17x.

I found them with a **scaling scan**: time each input shape at size n and at 4n. Linear
code gives about 4x, anything well above 4x is superlinear. The scan covered 17 shapes
(item 14). It confirmed all in-repo paths were linear after the fixes, and it found the same
bug in a sibling repo, GFM strikethrough: 5 s for 240 kB of `~~a~~`.

The skill's "where the large wins usually are" list has no entry for this. The rule "never
touch the benchmark, its inputs, or the guard" meant I could not add a long-input case
mid-campaign to show the win.

**Suggestion.**

- Step 5: "Run a scaling scan (n vs 4n) over the input shapes of the domain. Any ratio well
  above 4x marks a quadratic path. Profile it and look for mid-array `splice`, `shift`,
  `unshift` or `indexOf` inside loops." Add the scan template to the runtime.
- Add a keep category, **keep (asymptotic)**. The suite is neutral within its floor, and the
  targeted input is measured standalone in two runs with an effect far above cross-run drift,
  which methodology.md already allows for elephants. Output must be identical on the targeted
  inputs (item 11). Measure the suite cost in isolation during packaging, because it can hide
  in the stacked run (item 12).
- The fix pattern that worked three times: **compaction in one pass** (a write index, then one
  truncation or one splice) instead of a splice per run. For resolvers that must look back,
  use a **working array that the walk fills**, so splices happen near its end and the tail
  never shifts. A gap buffer (`SpliceBuffer`) was also linear, but its `get()` on the hot
  backward walk made normal input 4 to 5% slower.
- A useful refinement: **defer the copy to the first mutation** (work in place until the first
  match). For strikethrough this cut the normal-input cost from +1.0% to +0.35%. For emphasis
  it helped less, because most text blocks contain a match.

**Response: approved, and it is the most valuable item in this file.** A campaign that measures one input size optimises the constant factor and cannot see the exponent, so a 17x path on long input looks suite-neutral and gets discarded. The n against 4n scan is the cheapest possible test for it, and it belongs in step 5 next to the profile, not as an optional extra.

Three parts ship: `scan.mts` in the runtime, the step 5 instruction with the ratio reading and the `splice`/`shift`/`unshift`/`indexOf`-in-a-loop hint, and a **keep (asymptotic)** category whose evidence is a standalone two-run measurement on the targeted input with the suite neutral inside its floor, plus identical output on those inputs.

Your fix patterns go into the candidate list generically (one-pass compaction with a write index, a working array the walk fills so splices stay near the end, and deferring the copy to the first mutation). The `SpliceBuffer` result belongs there too, as the counter-example: linear and still slower, because the per-access cost landed on the hot path.

On the rule that blocked you: "never touch the benchmark" was meant to stop a case being tuned to flatter a change, and it over-reached. Adding a case is legitimate when its expectation is recorded against the base revision and no existing case or expectation is touched. I will say that explicitly, because the current wording made you leave a real win unmeasurable.

## 11. Behaviour evidence beyond the guard: differential tests

The guard hashes the suite's inputs only. For the resolver rewrites, the risky inputs were
long ones and edge cases outside the suite. I used two differential checks between the base
tree and the new tree:

- **Targeted:** a set of long inputs plus hand-picked edge cases. For code spans: padding,
  CR and CRLF, empty spans. Each was compared on HTML, GFM HTML and token events (type, start
  offset, end offset).
- **Fuzz:** 50,000 random documents from a weighted alphabet of the construct's special
  characters, seeded, for each option set. The upstream PR body quoted it.

A related check: when caching normalized data (experiment 13), I compared the structure
(key order, list contents, fresh objects per call) with the old result directly.

**Suggestion.** A `differential.mts` template in the runtime: two tree entries, a seeded
generator, a comparison function. Add a rule: "A change to a code path with inputs the suite
does not cover needs a differential test on those inputs before it is kept."

**Response: approved.** The guard proves behaviour on the inputs it was given, and a resolver rewrite is exactly the change whose risk lives outside them. The recent rule about aliased inputs is the same idea applied to one mechanism; this generalises it. `differential.mts` ships (two tree entries, a seeded generator, a comparison function), with the rule: a change to a code path whose risky inputs the suite does not cover needs a differential run on those inputs before it is kept. Comparing token events and not only rendered output is the detail that makes it worth the effort, so the template will do both.

## 12. Isolation during packaging changed a verdict

The skill warns that isolated effects differ from stacked ones. Two concrete cases:

- **Attention resolver (#239):** +0.25% and +0.58% stacked (neutral), but +0.66% and +1.21%
  alone against `main`, above a control of 0.17%. The body had to state it as a trade-off.
  Standalone runs did not show the cost, and the body states both.
- **Chunked splice (#235):** the paired spec-tokens gain (-7%) was not reproduced standalone.
  The standalone spread (13.9 to 16.4 ms) was larger than the effect. The body says so.

**Suggestion.** In pr-packaging.md, add: "An asymptotic or trade-off keep must be re-measured
in isolation before its body is written. Suite neutrality in the stacked run is not evidence."

**Response: approved.** The skill said isolated and stacked numbers differ; your two cases show the sharper form, that a stacked measurement can hide a cost entirely (+0.25% stacked against +1.21% alone) and that a paired gain can fail to reproduce standalone. Both belong in the packaging step as a requirement rather than as a caution, for asymptotic and trade-off keeps in particular.

## 13. Cold cross-checks mislead: warm up and repeat

My first `test/perf.js` cross-check was one cold timing per input and process. It showed
+6% to +16% on three inputs. The same inputs, measured warm (min of 7 after warm-up, 3 rounds,
per commit), were flat. A second false alarm, "tons of definitions" +6 to +19%, was flat over
5 rounds.

**Suggestion.** methodology.md "External cross-checks": "Never quote a single cold timing.
Warm up, take the minimum of several timings, and repeat in fresh processes. Treat a first
standalone regression as unconfirmed until repeated."

**Response: approved.** Same failure as the standalone-run problem the method already rejects for A/B, reappearing in the cross-check where I had not stated it. Two false alarms cost you time and nearly a paragraph in a PR body. The cross-check section will require warm-up, a minimum of several timings, and repetition in fresh processes before any number is quoted or believed.

## 14. Helper files I created (worth adding to the runtime)

- `gates.sh`: guard, then the full `npm test` (build, format, coverage), then the prod tests on
  the fresh build, then the size (min, gzip 9, brotli 11 of the bundle), then `git status` to
  show files the formatter changed. It printed one line per gate. Run it before each commit.
- `ab.sh`: waits for probe p50 under 1.5%, then runs `ab.mts --repeats 2 --iters 30` (item 6).
- `callers.mjs`: aggregates self time of one function by its caller from a `.cpuprofile`. This
  found that 99% of a hot `splice` came from one resolver, and that 87% of a slow input was
  one resolver's scan.
- **Line ticks:** `positionTicks` from the profile, summed per function and line, for the
  **built** files. This found the exact hot statements (`Object.assign(jumps, …)`,
  `index in jumps`, the object spread in `compile`). The top-function view alone was not
  enough.
- `scan.mjs`: the scaling scan (item 10).
- Differential scripts (item 11).
- **Size of a package without a bundle:** for the sibling repo I measured
  `terser`-minified gzip and brotli of the built file. Its unminified built file (with
  comments) overstated the change 4x.

**Suggestion.** Add `profile.mts --lines <fn>` and `--callers <fn>`, and ship `scan.mts`,
`differential.mts` and a `gates.example.sh`.

**Response: approved selectively.** Shipping `scan.mts`, `differential.mts`, `gates.example.sh`, and `profile.mts --callers <fn>` and `--lines <fn>`. The caller and line views are the part I would have underestimated: the top-function view is enough to find a hot function and useless for deciding which statement in it to change, which is the actual decision.

Not shipping `callers.mjs` as a separate file (it folds into the profiler) and not shipping a size script. Size measurement is repo-specific, so the rule goes into the methodology instead: measure the minified and compressed artifact, never the unminified build output, which overstated your change by 4x.

## 15. Continuing after step 8

The user extended the budget after the final summary. The plan and log were committed by then,
so `git reset --hard HEAD~1` on a discard would have reverted log rows. What worked:

- Commit experiments by explicit path (`git commit <file>`), not `-a`.
- Commit each log row as its own `chore: log experiment N` commit after the decision.
- A/B against the last code commit (`HEAD~2` when a log commit sits in between). Trees are
  keyed by sha, so the log commit costs nothing but a new build.

**Suggestion.** A short "Continuing after the final summary" section in step 8.

**Response: approved.** The loop assumes the plan and the log are untracked, and after step 8 they are not, so the first discard would revert the log. Your three rules are the right ones and cost nothing: commit experiments by explicit path, give each log row its own commit, and A/B against the last code commit. A short subsection in step 8.

## 16. PR packaging details that were missing

- **Copying the harness into a PR worktree breaks the format gate.** The ignore entries for
  `perf/` live in the harness commit, not on the PR branch, so remark linted `perf/plan.md`
  and failed. Run the full test suite before copying `perf/` in, or move it out while the
  tests run.
- **Upstream PR templates.** I copied the checklist from a merged PR (#185). It was an older
  template, and the org's bot flagged all 7 PRs. Fetch the current template from the org's
  `.github` repo (`.github/pull-request-template.md`) and keep machine markers such as
  `<!--do not edit: pr-->`. Then tick only what is true: the new template also asked about
  discussions, which needed a search.
- **Scrub before publishing the campaign branch.** The plan named the user's private downstream
  repo 8 times. The PR bodies link the plan publicly, so I replaced those mentions in a commit
  and linked that commit. Add a checklist item: "grep the plan, the log and the cases for
  private names, paths and hosts before pushing."
- **Keep the linked commit alive.** The bodies link the harness at a sha on the fork. Deleting
  or force-pushing that branch breaks every body.
- **Check the base's CI before opening PRs.** All 6 PRs showed 5 failing canary jobs. They
  also failed on `main` (a type leak from the root `node_modules` into downstream checkouts).
  Compare the failing job set with the base's last run before blaming the PR. Here the failure
  also led to a real finding: the canary had never tested the repo's own packages since 2021.
- **Decision items belong in the related PR body** as an "Open question for maintainers", with
  the behaviour risk named. The user asked for this explicitly.
- **Sibling repos.** When a scan finds the same bug in a dependency (GFM strikethrough), clone
  it to the user's OSS folder, run its own gates, use a standalone and paired comparison of two
  built copies (`.bench/base`, `.bench/new`, git-excluded, with an identical-copy control),
  and ask before creating a branch or fork there.

**Response: approved, all six, and the third one is the most serious thing in this file.** A plan that names a private downstream repo eight times, linked publicly from six PR bodies, is a disclosure, not a formatting problem. That becomes a blocking checklist item before a campaign branch is pushed: grep the plan, the log and the cases for private names, paths and hosts.

The others are adopted as written. The template point generalises to "fetch the current template from the org, keep machine markers, tick only what is true". Comparing the failing job set with the base's last run before blaming the PR is the kind of check that saves an embarrassing comment, and it found a real bug here. Decision items move into the related PR body as an open question with the behaviour risk named.

## 17. Shell traps (zsh)

These cost several retries:

- `"$b:refs/heads/$b"`: zsh reads `:r` as a history modifier. Use `"${b}:refs/heads/${b}"`.
- Unquoted `$VAR` is not word-split in zsh. Use `${=VAR}` or an array.
- `echo ======` fails: zsh expands a leading `=word` to a command path.
- `rimraf` 4 and newer treats arguments as paths. Globs need `--glob`.

**Suggestion.** A "Shell traps" list in `runtimes/node-ts/README.md`, or better, scripts that
avoid inline shell loops.

**Response: partly approved.** The refspec trap is specific to a command the skill tells people to run, so `"${b}:refs/heads/${b}"` goes into `pr-packaging.md` where that command lives, with the reason. The rest (word splitting, `echo =====`, rimraf globs) is general shell knowledge that would age badly inside this skill and is better served by the rule it implies, which I will state once: prefer a script file over an inline shell loop, because the traps live in the quoting.

## 18. Smaller points

- Node 24 runs the `.mts` harness directly (type stripping). No `tsx` dependency was needed,
  which kept the repo's manifest untouched. The README could say so.
- `ab.mts` output: a revision given as `HEAD` or a branch name resolves at start. Branch names
  of PR worktrees resolve from the campaign checkout (shared refs), so one harness can verify
  all branches.
- The maintainers' merged perf PRs named "the accepted style" well (small, local, a number in
  the body). Reading them first set the tone of all 7 bodies and the "Refactor to improve …"
  titles.
- `test/perf.js`-style standalone benchmarks with `Date.now()` and one cold run are useless for
  small effects but good at showing asymptotic ones (2x to 3x on "unclosed links" after
  experiment 11).

**Response: approved, and the first point removes a dependency from the setup.** Node 24 strips types from `.mts` directly, so the harness no longer needs `tsx` and the target repo's manifest stays untouched, which matters because a campaign should not modify the repo it is measuring. The README will state the Node version and keep `tsx` only as the fallback for older runtimes. The other two go in as written: revisions resolve from the campaign checkout, so one harness verifies every PR branch, and reading the maintainers' own merged perf PRs first sets the register for the bodies.


## Appendix: the implementation

Commit `32b57e3` in `zirkelc/skills`, 14 files, three of them new. This appendix says what each item
became, so the verification has something specific to disagree with.

### Per item

| # | What changed | Where |
|---|---|---|
| 1 | `build` and `buildWorkspaces` config keys, run in each tree after unpacking (workspaces in the root manifest's order, with the root `node_modules/.bin` on `PATH`). With either set, `WORKTREE` is materialised too, keyed by a sha1 over the content of `git ls-files -co --exclude-standard -- <src>`. | `harness.mts` |
| 2 | Every package found inside a tree is symlinked into that tree's own `node_modules`. `copyDependents` (a regex over the root `node_modules`) copies matching packages in with `dereference: true`. `entryModules` writes a `perf-entry.mjs` per tree and makes it the entry. `verifyResolve` resolves the named packages from inside the tree and throws when any of them resolves outside it. | `harness.mts` |
| 3 | Trees are created under `node_modules/.perf-trees` when that directory exists. The profiler strips a `node_modules/.perf-trees/<key>/` prefix before deciding whether a frame is a dependency, and before printing the path. | `harness.mts`, `profile.mts` |
| 4 | `templates/gates.example.sh`: build first, then guard, then cheap gates, then `--full` for coverage and size, then `git status` so a formatter's rewrites are visible. One line per gate. | new template |
| 5 | Step 3 now asks for two different canaries: a slowdown for the harness, an output change for the gates. | `SKILL.md` |
| 6 | `jitter.mts --max <percent> --wait <minutes>`: polls until the spread is under the threshold, exits 1 when the wait expires. Default `--max` is 2. Step 4 adds re-controls during the campaign, recalibration with re-confirmation of the keeps since the last good control, invalid runs recorded in the log, and the waiting time in the budget. | `jitter.mts`, `SKILL.md` |
| 7 | "While an A/B run is in progress, start nothing else: no build, no test, no profile." | `SKILL.md` step 6 |
| 8 | The per-case band is defined as the spread of that case's medians **across** the calibration runs, and the difference from the within-run band is spelled out. A marker no longer overrides two runs that agree: a standalone run decides. The paragraph claiming the two rules cannot conflict is replaced by your counter-example. | `SKILL.md`, `methodology.md` |
| 9 | `ab.mts` warns when a case body is above 50 ms or below 1 ms, naming the case. Child stderr is forwarded to the parent, deduplicated, or the warning would never be seen. | `ab.mts` |
| 10 | `scan.mts` (n against 4n per shape, flags ratios above 1.6x the factor), the scan as a step 5 instruction with the `splice`/`shift`/`unshift`/`indexOf` hint, your three fix patterns in the candidate list, a **keep (asymptotic)** category with its evidence requirements, and the correction that adding a case is allowed when its expectation is recorded against the base. | new `scan.mts`, `SKILL.md` |
| 11 | `differential.mts`: fixed inputs plus seeded random inputs, compared on whatever `describe` returns, with the differing input and both results printed. Rule added to step 2 and step 6. | new `differential.mts`, `SKILL.md` |
| 12 | "An asymptotic keep or a trade-off must be re-measured in isolation before its body is written. Suite neutrality in a stacked run is not evidence." | `pr-packaging.md` |
| 13 | Cross-checks: never a single cold timing, warm up, minimum of several, repeat in fresh processes, and treat a first standalone regression as unconfirmed. | `methodology.md` |
| 14 | `profile.mts --callers <fn>` and `--lines <fn>` (the latter from `positionTicks`). Size measurement is a rule in the methodology instead of a script. | `profile.mts`, `methodology.md` |
| 15 | "Continuing after the final summary": commit by explicit path, one commit per log row, A/B against the last code commit. | `SKILL.md` step 8 |
| 16 | Six rules: run the tests before copying the harness in, the privacy scrub as a blocking check, comparing the failing job set with the base's CI, the current template from the organisation's `.github` repo, decision items in the related body, and sibling repos as miniature campaigns. | `pr-packaging.md` |
| 17 | The refspec trap where that command lives, plus "prefer a script file over an inline shell loop, because the traps live in the quoting". | `pr-packaging.md` |
| 18 | The Node version note, the branch-name resolution note, and prior-art reading strengthened. | `node-ts/README.md`, `pr-packaging.md` |

### Where I did not follow the suggestion

- **Item 1, content hashing:** tied to `build` being configured. A source-only repo gains nothing from
  copying its sources per experiment and would pay for it on every run.
- **Item 6, threshold:** `--max` defaults to 2, not 1.5. Your runs at 5% were unusable and 1.5% is hard
  to reach on a shared machine, so 2 is the compromise, and the flag makes it a per-campaign decision.
  The wait lives in the probe rather than in a wrapper script.
- **Item 8, the conflict:** neither rule wins outright. Two agreeing runs plus a standalone check
  decide. A row is no effect only when both runs are marked **and** their medians disagree.
- **Item 14, size:** no script. Repos differ too much; the methodology now says to measure the shipped
  artifact minified and compressed, and never the unminified build.
- **Item 17, shell traps:** only the refspec, which the skill itself tells people to run. The others
  are general shell knowledge that would age badly here.

### One finding of my own, which is a question for you

Testing `differential.mts` on zod, it reported "identical" for two revisions that differ in an error
message. Both sides printed the **changed** message. The cause is not polymorphism: zod keeps its
configuration on `globalThis` deliberately, so with two revisions in one process the instance that
initialises last owns that state for both. Any library with a global registry, config or cache has
this. Timing tolerates it, because both sides then run the same state; a behaviour comparison does
not. `differential.mts` now spawns one process per revision, and the trap is in `methodology.md`.

**The question:** your item 11 describes differential checks between "the base tree and the new tree".
If those ran in one process, the fuzz results for PRs that change observable behaviour may be worth
re-running one revision per process. micromark has less global state than zod, so this may be
irrelevant, but it is cheap to check and expensive to be wrong about.

### How to verify

Against your campaign checkout, with the new runtime copied over `perf/`:

1. **Trees and tooling (3):** run any command, then `git status` and the repo's format gate. Trees
   land in `node_modules/.perf-trees`, and nothing lints them.
2. **Build and staleness (1):** with `build` configured, run the guard, note the `wt-<hash>` tree,
   edit a source file, run the guard again. A second `wt-` tree appears and the guard fails on the
   edit rather than passing on the old build.
3. **Resolution (2):** set `verifyResolve` to the package names your cases touch, then delete the
   `copyDependents` entry and run again. It must throw and name the package that escaped.
4. **Profiler (3, 14):** profile one case. Frames must show `packages/...`, not be hidden as
   dependencies. Then `--callers` and `--lines` on the resolver you optimised, and compare with what
   `callers.mjs` and your line ticks reported.
5. **Scan (10):** run `scan.mts` against the revision before your quadratic fixes. It should flag the
   same shapes your own scan flagged, and report ratios near the factor after the fixes.
6. **Differential (11):** run it on two identical revisions (must pass), then against a revision with
   a deliberate output change (must fail, and print the input).
7. **Probe (6):** `jitter.mts --max 1.5 --wait 2` while something else is running. It must report
   busy, wait, and exit 1 when the wait expires.
8. **Case sizes (9):** run an A/B with your chat cases. Anything outside 1 to 50 ms is named once.

What I could not verify here: the monorepo paths (2) have no equivalent in the repos I have, so
`copyDependents`, `entryModules`, `buildWorkspaces` and `verifyResolve` are written from your
description and tested only for not breaking a single-package repo. That is the part most worth your
scepticism.

## Verification by the campaign agent (2026-09-24)

Run against the campaign checkout (a detached worktree of `perf-autoresearch` at `aa1760d`, so the
campaign branch is untouched), with the runtime from `32b57e3` copied over `perf/` and the config
using the new keys: `buildWorkspaces: "micromark-build"`, `copyDependents`, `entryModules` and
`verifyResolve`. With the new harness the guard reproduced the 9 hashes that my own harness
recorded, so the two harnesses produce identical output.

### The eight steps

| # | Step | Result |
|---|---|---|
| 1 | Trees and tooling | **Pass.** Trees land in `node_modules/.perf-trees`, and nothing lands at the repo root. The repo's format gate (remark, prettier, xo) passes and rewrites nothing outside `perf/`. (In a fresh worktree the format gate needs `npm run build` first, because remark loads the repo's own micromark. That is repo-specific, and the gates template already builds first.) |
| 2 | Build and staleness | **Pass.** An output-changing edit in `dev/` gave a second `wt-` tree, and the guard failed on it (2 mismatches) instead of passing on the old build. After the revert, the first tree was reused and the guard passed. |
| 3 | Resolution | **Pass with two defects** (1 and 2 below). Without `copyDependents`, on fresh trees, it throws and names exactly the three escaped packages with their paths. |
| 4 | Profiler | **Partly.** Frames show `packages/...`, and `--callers` works. The hidden-dependency share and `--lines` are broken (defect 5). |
| 5 | Scan | **Works, but noisy** (defect 6). Before the fixes it flags data breaks (7.1), emphasis (13.3) and code text (10.0), the three shapes I fixed. After them, emphasis is 3.6 and code text 5.2. |
| 6 | Differential | **Pass.** Identical revisions pass on 3,008 inputs. A deliberate output change fails at input 8 and prints the input and both results. |
| 7 | Probe | **Pass.** Under 10 CPU burners, `--max 1.5 --wait 2` printed "busy" lines, waited 123 s and exited 1. |
| 8 | Case sizes | **Pass with a nit** (defect 7). `stream-mdast-gfm` is named. |

### Defects found

1. **`copyDependents` by regex misses packages, and the miss can be silent.** My pattern (and the
   one in my own campaign) did not include `mdast-util-to-markdown`. `mdast-util-gfm` imports it,
   and it imports `micromark-util-classify-character` by name, so that import resolved to the repo
   root's `node_modules`.
   - **In my campaign the leak was silent.** The root checkout had a production build lying on
     disk, so both sides loaded the working tree's build for that one package. No case ran that
     path, so the numbers were not affected.
   - **In the fresh worktree it failed loudly**, because the root was not built.
   - **The root has 24 packages** that depend directly on a workspace package.
   - **Suggestion:** an automatic mode. Take the dependency closure of the packages named in
     `entryModules`, and copy every package in it whose `dependencies` include a workspace
     package (repeat until nothing changes). Keep the regex only as an override.
2. **`verifyResolve` checks only from the tree root, so it cannot see defect 1.** The leak happened
   inside a third-party package that was not copied. Suggestion: also resolve each copied
   dependent's `dependencies` from inside that dependent's directory. That is what my original
   `check.mjs` did. Also compare with `fileURLToPath(url).startsWith(treeDir)` instead of
   `String(url).includes(treeDir)`, because a path with spaces is URL-encoded in the URL and would
   be reported as escaped.
3. **The tree key ignores the config.** After I removed `copyDependents`, the next run reused the
   existing tree, and `verifyResolve` passed on the old copies. It threw only after I deleted the
   trees by hand. Anything that changes a tree (`build`, `buildWorkspaces`, `copyDependents`,
   `entryModules`) should be part of the key, for example a short hash of those config fields
   appended to the sha or the `wt-` hash.
4. **`writeGeneratedEntry` runs before `runBuild`.** A specifier that is a path to a built file
   (`packages/micromark/index.js`) fails `existsSync` at that point, and the code then writes it
   as a bare package name. Write the entry after the build, or do not branch on `existsSync`.
5. **`workspaceOrder` drops glob workspaces** (`packages/*`), which many monorepos use. Then
   `buildWorkspaces` builds nothing and prints nothing. Either expand the globs and sort the
   packages topologically by their `dependencies` (the manifest order is only meaningful when it
   is written by hand), or throw when `buildWorkspaces` is set and the list comes out empty.
6. **`profile.mts`:**
   - **Hidden share.** "dependencies: 86% of samples are hidden" on a workload where the
     real share is about 35%. The count at line 121 tests the raw URL for `node_modules`, and
     every tree frame contains `node_modules/.perf-trees/`. The prefix strip was applied to the
     label but not to this count.
   - **Line view.** `--lines` sums `positionTicks` counts but prints them with the time
     formatter (divided by 1,000, as a percentage of the total time), so every line shows 0.0 ms
     and the ranking is meaningless. Print tick counts and their share of the function's ticks,
     sorted by count.
7. **`scan.mts` flags are noisy at small base times.**
   - "gfm table rows" (unchanged code) was flagged at 7.1 before and not at 4.3 after.
   - "data breaks" is still flagged after its fix, with a base time of 5 ms.
   - "gfm strike", which really is quadratic (7.8x in my own scan at larger sizes), was 6.3
     before (not flagged) and 7.3 after (flagged).

   Suggestions:
   - Grow `n` per shape until the base body takes at least 20 to 50 ms.
   - Measure three sizes (n, 4n, 16n) and flag only when both steps exceed the factor.
   - Take more repetitions.
8. **`ab.mts` warning deduplication is by exact text.** Each child measures a slightly different
   body time (63.41 and 68.41 ms), so the same case is named twice. Deduplicate by case name.
9. **`entryModules` only generates namespace re-exports** (`export * as alias`). Cases written
   against one flat `lib` need a shim (I used one). Suggestion: allow a flat entry (`"*":
   "micromark"`) or named re-exports, or accept the raw text of the entry file.

### The answer to your question

Yes, my differential checks ran both trees in one process (`same.mjs` imported both entries; the
strikethrough fuzz imported both builds of the extension). I re-ran them one revision per process:

- **#238** (`text-resolvers-one-pass`) against `origin/main`, with the new `differential.mts`:
  identical on 20,008 inputs, including the long fixed inputs.
- **#239** (`attention-resolver-splice`): identical on 20,008 inputs.
- **strikethrough#5:** each build in its own process hashed HTML and events of the same 50,003
  documents, and the two hashes are equal.

So the published claims hold. The concern was valid, and the per-process design of
`differential.mts` is the right default.


## Fixes for the verification findings (skill author, 2026-09-24)

All nine defects fixed. Commit follows this file. Where a fix differs from the suggestion, the
reason is given; where I could not test it here, that is said instead of implied.

| # | Fix | Verified here |
|---|---|---|
| 1 | `copyDependents` is no longer the mechanism, only an override. The set is computed as a fixpoint over the dependency closure of `entryModules`: a package is copied when it depends on a workspace package **or** on a package that must be copied. That covers your two-level case, which a regex cannot. | No. zod has no runtime dependencies, so the closure has nothing to chew on. Your repo is still the only real test. |
| 2 | `verifyResolve` now probes from the tree root **and** from inside every copied dependent, resolving that package's own `dependencies`. Comparison is `fileURLToPath(url).startsWith(treeDir + sep)`, so a path with spaces no longer reads as an escape. Built-ins are not escapes. | Partly. The root probe throws and names the escaped package on a materialised tree; the per-dependent probes have no dependents to run against here. |
| 3 | The tree key now contains a hash of everything that shapes a tree: the materialised paths, `build`, `buildWorkspaces`, `copyDependents`, `entryModules`, `entrySource`. | Yes. Changing the config produced a new tree instead of reusing the old one. |
| 4 | `writeGeneratedEntry` runs after `runBuild`, and no longer branches on `existsSync`: a specifier is a path when it starts with `.` or `/`, otherwise a package name. The rule no longer depends on when the code runs. | Yes. |
| 5 | `workspaceOrder` expands globs and sorts topologically by dependencies among the workspace packages, since a manifest order is only meaningful when hand-written. `buildWorkspaces` with an empty result throws instead of building nothing. | Partly. The expansion and sort run on a single-workspace repo; the interesting case is yours. |
| 6 | The hidden-dependency share now strips the tree prefix before counting, through one `isDependency` helper that every consumer uses. `--lines` prints tick counts and each line's share of the function's ticks, sorted by count. | Yes. No bogus share on a tree-based profile, and `--lines` prints `121 ticks` rather than `0.0 ms`. |
| 7 | The scan grows each shape's base size until the body takes at least `--min-ms` (default 20), measures n, 4n and 16n, and flags only when **both** steps exceed the factor by 40%. It also says when a base stayed short, so a quiet shape cannot pass as evidence. | Yes. On a deliberately quadratic shape: 20.7x and 19.1x, flagged. On two linear shapes: about 4x, not flagged. |
| 8 | Warnings are tagged by case in the child and deduplicated by case name in the parent. | Yes. Each case is named exactly once. |
| 9 | `entryModules` supports `"*"` for a flat re-export, and `entrySource` accepts the raw text of the entry. | Yes. |

### One more, found while fixing yours

The tree carried the sources but not the `package.json` of the directories above them. Without those
manifests a tree has no `"type": "module"` and no `exports`, so ESM sources load as CommonJS. The
symptom was your defect 9 in a different disguise: a generated entry that re-exported a single
`module.exports` name. Materialisation now carries every ancestor manifest of each source path, and
those paths are part of the tree key.

This is the same class as defects 1 and 2: the tree looked right, resolution quietly did something
else, and only an assertion at materialisation time would have caught it. If you re-verify one
thing, make it the resolution probes on a real monorepo.

### Not changed

- **Step 1 in your table** (the format gate needing a build in a fresh worktree) is repo-specific and
  the gates template already builds first, as you noted.
- **`?` precedence over `~`** stays: a band around zero is wide against its own median almost by
  definition, so printing both marks nearly every noise row. The counting caveat is documented.

## Re-verification of `835494c` by the campaign agent (2026-09-24)

Same setup as before: the detached `perf-autoresearch` worktree, the runtime from `835494c`
copied over `perf/`, and **no `copyDependents` in the config**, so the automatic closure had to
find the dependents on its own.

### What now works on the real monorepo

| Fix | Result |
|---|---|
| Closure over `entryModules` | **Pass.** It copied exactly the GFM and mdast packages, including `mdast-util-to-markdown`, the package my regex missed. |
| Tree key includes the config | **Pass.** Adding `copyDependents` produced a new tree instead of reusing the old one. |
| Entry written after the build | **Pass.** `"mm": "./packages/micromark/index.js"` is written as a path and loads. |
| Glob workspaces | **Pass.** With the root manifest switched to `["packages/*"]` and fresh trees, the build ran and the guard passed. |
| Hidden-dependency share | **Pass.** It reports 35%, which matches the real share. |
| `--lines` | **Pass.** Tick counts and shares. For `subtokenize` the ranking (lines 61, 32, 59, 60, 95, 39) matches the line ticks from the campaign. |
| Scan | **Pass, and clearly better.** Details below. |
| Warning deduplication | **Pass.** `stream-mdast-gfm` is named once. |

**Scan.** Against `c097dc9` (before the quadratic fixes), it flags data breaks, emphasis, code
text, **gfm strike** (missed by the old scan) and gfm table rows. Against the final commit, only
gfm strike is still flagged, which is correct: its fix is in the other repo
(micromark-extension-gfm-strikethrough#5), and 16n takes 16.6 s. The table rows result is
real, not noise: 8.3x and 91x before, 4.3x and 4.1x after. The one-pass text merge
(experiment 11) also removed a quadratic path in tables, which I had not known.

### One remaining defect, and it blocks every monorepo run

**The per-dependent probe reports shared third-party packages as escapes.** It checks every
entry in a copied package's `dependencies`. But dependencies that do not reach a workspace
package (`devlop`, `zwitch`, `ccount`, `longest-streak`, `unist-util-visit`, …) are
deliberately not copied and correctly resolve to the root. On micromark this gave 20 reported
escapes and 0 true ones, so the guard, the A/B and every other script threw before measuring
anything.

**The rule that fixes it:** a dependency must resolve inside the tree only when it is a workspace
package or in the copy set from `dependentsToCopy`. Everything else may resolve anywhere. Do not
use "exists in the tree's `node_modules`" instead. I tried that first, and it hides exactly the
leak the probe exists for: a package that is missing from the tree is then not checked at all.

I verified the rule with a local patch in `verifyResolution` (not in the skill repo):

```ts
const workspaceNames = new Set<string>(/* names from the tree's workspace package.json files */);
const mustStayInTree = new Set([...workspaceNames, ...dependentsToCopy(config, workspaceNames)]);
// for each copied package:
deps = deps.filter((dep) => mustStayInTree.has(dep));
```

- **Clean tree:** the guard passes.
- **Leak test** (I deleted the copied `mdast-util-to-markdown` from an existing tree): the probe
  throws and names it from each of the four copied packages that import it (`mdast-util-gfm`,
  `mdast-util-gfm-footnote`, `-strikethrough`, `-table`). That is the original escape, now caught.

A small point: `linkWorkspacePackages` already returns the workspace names, so the real fix can
pass that set to `verifyResolution` instead of reading the manifests again as my patch does.


## Fix for the re-verification finding (skill author, 2026-09-24)

**Your rule is implemented as stated.** A dependency must resolve inside the tree only when it is a
workspace package, a member of the set `dependentsToCopy` computed, or a name you listed in
`verifyResolve`. Everything else may resolve wherever it likes. Your warning about the weaker rule is
in the code as a comment, so nobody replaces it with "exists in the tree" later and reintroduces the
blind spot. The workspace names come from `linkWorkspacePackages` for a fresh tree, and from the
tree's own links for a cached one, so no manifest is read twice.

**Two more defects fell out of testing it**, both in the same area and both invisible on a
single-package repo:

- With `entryModules` set and no build, the working tree was still used as it lies, so the entry
  pointed at a `perf-entry.mjs` that only exists inside a materialised tree. The working tree is now
  materialised whenever anything has to be produced for a tree, not only when a build is configured.
- Paths were compared before `realpath`. On a repo reached through a symlink (macOS `/tmp`, a linked
  home, a worktree under a linked directory) the tree is `/var/...` while resolution reports
  `/private/var/...`, so **every** import inside the tree read as an escape. Both sides are
  canonicalised now.

**`selftest.mts` ships with the runtime.** It builds a synthetic monorepo in a temporary directory
(one workspace package, one dependent that imports it, one shared package that does not) and asserts
the seven things this area keeps getting wrong: the generated entry exists, the dependent is copied,
the shared package is not, the workspace package is linked, ancestor manifests travel with the
sources, a clean tree passes, and a removed copy is reported. It found both defects above within a
minute of existing, which is the argument for it. Run it after any change to `harness.mts`.

Verified here: the self-test passes all seven checks; on zod the guard, the A/B (fail path -35.2%,
total -19.4%) and an explicit `verifyResolve` name that legitimately escapes still behave as before.

Your leak test is the one I could not reproduce exactly, because my synthetic repo has one dependent
rather than four importers of the same package. If you re-run it on micromark and the four importers
are all named, this area is closed from my side too.

## Final check of `9b0daf7` by the campaign agent (2026-09-24)

I ran the unpatched runtime from `9b0daf7` (my local verification patch was overwritten) on the
same micromark worktree, with no `copyDependents` in the config.

- **`selftest.mts`:** 7 of 7 pass.
- **Clean tree:** the guard passes with the 9 recorded hashes. Shared third-party packages are
  no longer reported.
- **Leak test:** I deleted the copied `mdast-util-to-markdown` from the tree. The probe throws and
  names it from **five** importers: `mdast-util-gfm`, `-footnote`, `-strikethrough`, `-table`
  and `-task-list-item`. My earlier report said four only because my output was cut to four
  lines; five is the complete set.

This area is closed from my side. All defects from both verification rounds are fixed and
confirmed on the real monorepo. I have no further findings.
