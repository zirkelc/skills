# Methodology

Why the harness is built the way it is, and how to read and report its numbers.

## Contents

- Why paired measurement
- Why the minimum
- Load-order bias
- Why not use the repo's own benchmark as the instrument
- Noise floor and keep bar
- Reading the numbers: run 1, run 2, speed-up
- External cross-checks and their caveats
- Other metrics: memory and bundle size

## Why paired measurement

Two separate executions of the same code get two independent draws of machine noise: thermal state, background load, GC timing, and JIT or code-layout decisions. The difference between two such runs is `signal + noise1 - noise2`. In a real campaign, the same microbenchmark ran twice on identical code and reported 128 µs/iter and then 441 µs/iter. The effects worth finding are 2 to 25%. An instrument whose blank reading moves by 300% cannot measure them.

The paired harness makes the noise common-mode. Both revisions are measured side by side, in strict alternation, so whatever the machine does in a given moment hits both sides almost equally and cancels in the ratio. This took the noise floor from hundreds of percent to about 1 to 2% on the suite total.

- In runtimes that can load two copies of the code into one process (JavaScript module instances, JVM class loaders), measure both in one process.
- In compiled or single-image runtimes, run the two built binaries alternately in ABBA order (`runtimes/generic/`). This is less tight than in-process pairing, but drift still cancels.

## Why the minimum

The work is deterministic and CPU-bound. No source of noise can make it faster than its true cost; every source can only add time. The minimum over many iterations is therefore the best estimate of true cost. Means and medians absorb the noise instead.

Scale each timed iteration so it runs for about 1 to 2 ms (repeat the case body N times, the same N for both sides). Very short iterations are dominated by timer resolution.

## Load-order bias

With two copies of identical code in one process, the copy loaded second was measured about 3% faster, consistently, in both directions. The cause is JIT state (inline caches, code layout), not the code. The harness therefore runs the measurement twice in separate child processes, once per load order, and combines the two ratios with a geometric mean:

```
ratio = sqrt((b1 / a1) * (a2 / b2))
```

where run 1 loads A first and run 2 loads B first. Without this, every change "wins" or "loses" by the bias.

## Why not use the repo's own benchmark as the instrument

Existing benchmark suites usually answer a different question: "is this library faster than library X?" They import one version of the code per process, so they cannot compare two revisions of it in one execution. Using them for A/B would mean comparing two standalone runs, which is the failure mode above. They also often use unseeded random data, so the two sides would not see the same inputs, and the outputs cannot be hashed for a guard.

So: mirror their workloads (the maintainers' own idea of what is representative) into deterministic cases, use those for decisions, and keep the original suite as an external cross-check. Say this explicitly in PR bodies, because reviewers will ask.

## Noise floor and keep bar

- Noise floor: the largest absolute TOTAL delta over three runs with identical code on both sides (first cold run discarded).
- Keep bar: about twice the noise floor, never below 1%. Both runs must clear it.
- Per-case rule: a change aimed at one path may keep if that case clears about twice its own noise band (5% as a default) in both runs and the TOTAL does not regress.
- Some cases are much noisier than others (allocation-heavy or GC-bound cases). Do not claim a result from a case whose two runs disagree, for example -10% and -0.3%. Show it as noise.

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
