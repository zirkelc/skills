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

TOTAL deltas: <a>, <b>, <c>  → noise floor <x>%
Noisy cases: <case: range>

**Keep bar: TOTAL improvement >= <2x noise, min 1%>, confirmed by a second run.**
Per-case rule: targeted case >= <5%> in both runs, TOTAL not regressing.

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
