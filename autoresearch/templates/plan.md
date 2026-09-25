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

Write this section while you calibrate, not afterwards. These numbers are what a later reader
needs, and they live nowhere but the conversation until they are here.

Machine probe: min <a> ms, p50 <b> ms, max <c> ms (<x>% above min), threshold accepted <t>%
<- 2% is the target; a higher threshold is allowed on a shared machine and raises the bar with it

TOTAL deltas: <a>, <b>, <c>      → noise floor <x>%
GEOMEAN deltas: <a>, <b>, <c>    → noise floor <y>%

Per-case bands: the spread of each case's median **across** the three runs (not the band printed
inside one run, which is larger and answers a different question).

| case | band | bar (2x band) |
|---|---|---|
| <case> | ±<x>% | <y>% |

These decay. A case's band measured here is wrong a few experiments later (one campaign: 3% at
calibration, 13% six experiments on), so a per-case decision uses a focused control taken in the
same session as the experiment. Record those next to the experiment, not here.

| experiment | focused control (2 runs) | focused bar |
|---|---|---|
| <n, case> | <a>%, <b>% | <y>% |

Re-controls during the campaign: <experiment, control delta, verdict>. Invalid runs (machine busy
before or after): <experiment, what the probe said>.

**Keep bar: one summary clears <2x noise, min 1%>, the other does not regress beyond its band,
confirmed by a second run.** Per-case rule: targeted case clears its own focused bar in both runs.

Budget: one A/B run takes <n> min; <k> experiments x 2.5 = about <h> h of measurement, plus
<w> min of waiting per run for a quiet machine.

## Gates

| gate | command | runs here? | notes |
|---|---|---|---|
| <tests> | <cmd> | yes | <duration> |
| <conformance suite> | <cmd> | needs sudo / network / submodule | <the exact command the user must run> |

## Scaling scan (step 5)

| shape | n | 4n | ratio | verdict |
|---|---|---|---|---|
| <input-length shape> | <ms> | <ms> | <x> | linear / superlinear |
| <N operations on one long-lived object> | <ms> | <ms> | <x> | linear / superlinear |

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
weighed against the gain. Mark near misses (below the bar but above half of it) so a later
experiment in the same area can bundle them. Record which experiment added a case, if any.>

## Final summary

<Kept, rejected (and why), cumulative improvement from a base vs final A/B run twice,
external cross-check with caveats, what is left worth trying next.>
