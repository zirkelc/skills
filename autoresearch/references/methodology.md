# Methodology

Why the harness is built the way it is, and how to read and report its numbers.

## Contents

- Why paired measurement
- Why the minimum, and when it fails
- Load-order bias
- Two revisions in one process
- Why not use the repo's own benchmark as the instrument
- Noise floor and keep bar
- Reading the numbers: run 1, run 2, speed-up
- External cross-checks and their caveats
- Other metrics: memory and bundle size

## Why paired measurement

Two separate executions of the same code get two independent draws of machine noise: thermal state, background load, GC timing, and JIT or code-layout decisions. The difference between two such runs is `signal + noise1 - noise2`. In a real campaign, the same microbenchmark ran twice on identical code and reported 128 µs/iter and then 441 µs/iter. The effects worth finding are 2 to 25%. An instrument whose blank reading moves by 300% cannot measure them.

The paired harness makes the noise common-mode. Both revisions are measured side by side, in strict alternation, so whatever the machine does in a given moment hits both sides almost equally and cancels in the ratio. This took the noise floor from hundreds of percent to about 1 to 2% on the suite total.

- In runtimes that can load two copies of the code into one process (JavaScript module instances, JVM class loaders), measure both in one process.
- In compiled or single-image runtimes, build both revisions and run them alternately, A,B then B,A. This is less tight than in-process pairing, because process start-up and separate heaps add noise, but the drift still cancels and the estimator stays the same.

## Why the minimum, and when it fails

The work is deterministic and CPU-bound. No source of noise can make it faster than its true cost; every source can only add time. The minimum over many iterations is therefore the best estimate of **one side's** true cost, and that is what the harness reports as the absolute milliseconds.

The delta is a different question. A minimum per side is each side's best moment, and those two moments are not the same machine state: on a shared machine, or on a chip with performance and efficiency cores, one side can win the better core or the quieter second. Taking the quotient of two independently drawn minima throws away the pairing that the whole method rests on. Measured on an M5 with identical code on both sides, that quotient moved single cases by up to 24% and the suite total by 12%.

So the delta comes from the pairing that already exists: A and B run back to back inside one iteration, so take their ratio per iteration and report the **median of those ratios**. Same data, same runs, one estimator that keeps what the design was built for. On the same machine and cases, the calibration moved from +12.07% to about ±1.8% on the total.

Report the dispersion with it. The interquartile range of the per-iteration ratios says whether the iterations of **this run** agree: a band that contains 0% means they disagree about the direction, so this run does not confirm the row, whatever its median says. That is a statement about the run, not about the change. The verdict still comes from the rule the whole method rests on: two runs that agree. A case flagged in one run and clean in the other is a noisy case with a real effect; a case flagged in both is no effect.

That last part is safe for short, noisy cases, which is not obvious: a 1 ms body has a wide band by construction, so it looks like a case the rule could kill. It cannot, because the marker and the per-case bar scale with the same quantity. A flag means the median is small against the band; the bar is twice the case's band from calibration. An effect small enough to stay flagged in two runs is therefore an effect the per-case rule would reject anyway, and the two rules cannot contradict each other. Measured: a 1 ms case with a real -41% effect stayed unflagged in both runs (band 0.7 times its median), while the untouched case beside it was flagged in both. The caveat is the assumption: if a case is suddenly far noisier than its calibration band, the machine changed under you, so re-run the probe instead of reading the row.

Scale each timed iteration so it runs for about 1 to 2 ms (repeat the case body N times, the same N for both sides). Very short iterations are dominated by timer resolution, and case bodies beyond roughly 50 ms contain a garbage collection almost by construction.

## Load-order bias

With two copies of identical code in one process, the copy loaded second was measured about 3% faster, consistently, in both directions. The cause is JIT state (inline caches, code layout), not the code. The harness therefore runs the measurement twice in separate child processes, once per load order, and combines the two ratios with a geometric mean:

```
ratio = sqrt((b1 / a1) * (a2 / b2))
```

where run 1 loads A first and run 2 loads B first. Without this, every change "wins" or "loses" by the bias.

## Two revisions in one process

In-process pairing is what makes the method precise, and it has an artefact of its own. Both revisions live in one process: they share the heap, and any code they share sees objects of two different shapes. A case can then report a large, stable, repeatable delta although neither revision touched the code it exercises. In one campaign a selector case reported +25% and +29% in two runs; profiles of both revisions were identical, and timing it standalone showed it equal or faster.

Do not expect to engineer this away. The harness gives each side its own instance of the cases module, which removes one source (the case bodies stay monomorphic per side), and that is worth having. It is not sufficient: the same campaign re-measured the same case with the per-slot import active and still saw +21.1% paired against -3.0% standalone. The remaining mechanism is the shared heap, not shared code, and no module identity can separate that.

So the rule is not "confirm if you are unsure", it is: **a per-case delta on code the change did not touch is not a result until a standalone run agrees with it.** Run one revision per process (`solo.mts` in the node-ts runtime) before you report it, act on it, or discard a change because of it. When the standalone numbers disagree with the paired ones, the row is an artefact of the instrument and belongs in the PR body as such, because a reviewer who runs the harness will see the same line.

Untouched code is where the artefact is easiest to recognise, not where it stops. The same polymorphism inflates the numbers of code the change did touch, on both sides at once, and a maintainer who reproduces a headline figure one build per process will then get a different number than the PR claims. So confirm standalone before a number goes into a PR body whenever the case is small, hot and dominated by call sites rather than by work: leaf operations, wrappers, anything whose body is a few microseconds. Large cases that spend their time inside one algorithm are not exposed this way.

Two shapes in the output point at such a row, and both are hints, not verdicts:

- The band contains 0% (`?`): the iterations disagree about the direction.
- The band is wide against its own median (`~`): the campaign that found this artefact measured a width of 2.8 times the median on the artefact row and 3.1 times on a noise row, against 0.03 to 0.23 on the real effects, with two real but noisy cases in between at 1.0 and 1.9. A threshold of twice the median separates them usefully on that data, which is one machine and fourteen cases: treat it as a reason to check, never as a gate.

`?` takes precedence when both apply, so `~` marks only rows with a confident-looking median that the iterations do not support, which is the artefact's shape. Defining `~` against the case's calibration band instead of its own median was considered and rejected: it would make every run depend on numbers that live in the plan, and a harness that needs the plan to print a row is a harness that breaks when the plan is stale. The same artefact row can therefore print `~` in one run and `?` in another, depending on whether its band happened to cross zero. Nothing is lost for a decision, since both say "not confirmed", but a campaign counting how often the artefact appears has to count rows marked in either form.

## Why not use the repo's own benchmark as the instrument

Existing benchmark suites usually answer a different question: "is this library faster than library X?" They import one version of the code per process, so they cannot compare two revisions of it in one execution. Using them for A/B would mean comparing two standalone runs, which is the failure mode above. They also often use unseeded random data, so the two sides would not see the same inputs, and the outputs cannot be hashed for a guard.

So: mirror their workloads (the maintainers' own idea of what is representative) into deterministic cases, use those for decisions, and keep the original suite as an external cross-check. Say this explicitly in PR bodies, because reviewers will ask.

## Noise floor and keep bar

- Measure the machine first. A calibration run on a busy machine measures the other work, not the code.
- Noise floor: the largest absolute delta over three runs with identical code on both sides (first cold run discarded). Record it for **both** summary numbers.
- Report two summaries: a **time-weighted total**, which answers "how much work disappeared", and an **equally weighted geometric mean**, which answers "did most cases improve". One case can easily be half the suite total and then decide every keep on its own.
- Keep bar: about twice the noise floor, never below 1%. One of the two summaries must clear its bar and the other must not regress beyond its own noise band, in both runs.
- A disagreement between the two is information, not a problem: TOTAL -6% with GEOMEAN +2% is the signature of one big case winning while many small cases lose. Look at the per-case lines before you record the decision.
- Per-case rule: a change aimed at one path may keep if that case clears twice **its own** band, derived from the calibration runs, and the summaries do not regress. Do not use one global default: bands differ by a factor of three between large cases and short ones.
- Do not claim a result from a case whose two runs disagree, for example -10% and -0.3%. Show it as noise.

## Reading the numbers: run 1, run 2, speed-up

- A **run** is one full harness invocation: both load orders, all cases, minimum of N iterations. It gives one delta per case. Negative means the second revision is faster.
- **Run 2** is an independent repeat, minutes later. Show both runs, not an average, so reviewers can judge stability. Two runs that agree (-41% and -38%) show a real effect. Two runs that disagree show noise.
- **Speed-up** expresses the same result as a multiplier, from the mean of the two runs:

```
speed-up = time_base / time_branch = 1 / (1 + delta)
```

A delta of -39.5% is a speed-up of 1.65x. The relation is not linear: -20% is 1.25x, -50% is 2.00x, -58% is 2.39x. Percentages measure time removed; multipliers measure throughput gained. Report both.

## External cross-checks and their caveats

Run the repo's own benchmark on the base and on the branch at the end. Quote a figure only when it is methodologically sound, and state its weakness next to it:

- A comparison of two standalone runs is acceptable only when the effect is much larger than cross-run drift (for example 2x). Standalone runs can confirm elephants, not measure mice.
- When a benchmark includes an in-process reference (for example a pinned published version of the same library), the ratio against that reference is paired within one run and is robust to drift. Quote the shift of that ratio between base and branch, not the absolute multiplier. The absolute value also contains the version gap (pinned version vs current source) and the build-format gap (compiled package vs source loaded through a TypeScript loader), which have nothing to do with the change.
- Do not include comparisons to old major versions or competitor libraries in a PR about a change. They are not relevant to the change and invite the wrong discussion.

## Other metrics: memory and bundle size

The paired principle applies to other metrics too, but the noise profile differs:

- **Memory per instance.** Retain N instances, force GC before and after, divide the heap delta by N. This counts allocations, not time, so it is reproducible to a fraction of a byte. Changes that move per-instance closures or own properties to shared prototypes or module-level values show up clearly. Some maintainers value this metric more than time: one campaign's schema-construction PR was measured as a time win but landed upstream framed as "cut per-schema memory ~90%". Measure memory alongside time for construction changes.
- **Bundle size.** Deterministic, so no noise averaging is needed, but measure gzip (level 9) and brotli (quality 11) bytes. Minified bytes are not what users download: deduplicating repeated code shrinks minified output but is neutral or negative after compression, because compression already encodes repetition almost for free. Only the removal of unique bytes (data, dead code) moves compressed size. A 30-experiment campaign that cut minified size by 2 to 4% per PR had all four PRs closed after the maintainer measured them compressed: one was -1.6 kB minified but +26 B brotli. Gate keep and discard on compressed bytes from the first experiment.

  The reverse direction matters even in a campaign that optimises time: a fast path is a size change. It adds a branch and its body to every build that includes the module, including builds sold on size. One campaign had a real 23% win on its targeted case rejected because the fast path cost a size-focused build 115 to 136 gzipped bytes and broke its size budget. Measure the compressed delta of every change that adds a code path, and weigh it with the time delta rather than after the fact.
