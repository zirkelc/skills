# Performance campaign: <repo> (<branch>)

## Repo

<What the project does. Package manager. How tests run and how long they take. Existing
benchmarks: framework, what they measure, metric, lower or higher is better, run time.
Whether tests pin observable behaviour. Which metric the maintainers accept, with evidence
(merged perf PRs).>

## Harness

<Runtime folder used and adaptations. Cases and what they mirror. How to run the A/B and
the guard. One full A/B run takes <N> s.>

## Calibration (identical code both sides, 3 runs, first cold run discarded)

Machine probe: min <a> ms, p50 <b> ms, max <c> ms (<x>% above min) <- must be quiet to calibrate

TOTAL deltas: <a>, <b>, <c>      → noise floor <x>%
GEOMEAN deltas: <a>, <b>, <c>    → noise floor <y>%

Per-case bands from the same runs:

| case | band | bar (2x band) |
|---|---|---|
| <case> | ±<x>% | <y>% |

**Keep bar: one summary clears <2x noise, min 1%>, the other does not regress beyond its band,
confirmed by a second run.** Per-case rule: targeted case clears its own bar in both runs.

Budget: one A/B run takes <n> min; <k> experiments x 2.5 = about <h> h of measurement.

## Baseline

| case | time |
|---|---|
| <case> | <value> |
| TOTAL | <value> |

Profile summary: <where the time goes, top self-time frames>.

## Candidates

1. <candidate, the profile evidence for it, expected effect>

## Decision items (behaviour changes, not attempted)

- <idea, why it changes behaviour, what a maintainer would need to decide>

## Experiment notes

<One short section per experiment: approach, reasoning, result, and how complexity was
weighed against the gain.>

## Final summary

<Kept, rejected (and why), cumulative improvement from a base vs final A/B run twice,
external cross-check with caveats, what is left worth trying next.>
