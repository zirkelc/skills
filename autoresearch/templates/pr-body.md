> **Context: performance optimization campaign.** This is one of <N> PRs extracted from a systematic performance campaign on <area>, run as an automated research loop: <E> isolated experiments, <K> kept, <D> discarded. Every candidate change was
>
> - benchmarked with an A/B harness that <loads two git revisions of `<src>` into one process / runs builds of two git revisions alternately> and times <C> workloads in strict alternation: A and B run back to back inside each iteration, and the delta is the median of their per-iteration ratios, so both sides always sample the same machine state. <If in-process: module instances carry a stable load-order bias of several percent, so the harness runs both load orders in separate child processes and combines them with a geometric mean.>
> - measured on **<C> deterministic workloads mirroring `<existing bench dir>`** (<list>). The repo's own benchmarks <compare the library against other libraries / load one version per process> and cannot load two revisions into one execution, so using them for A/B would mean comparing two standalone runs, and run-to-run drift is larger than most effect sizes here. The mirrored cases use seeded data, so both revisions process identical inputs and the same workloads feed the characterisation guard below. The untouched `<existing bench dir>` suite served as an external cross-check.
> - gated by a **calibrated noise floor** (~<x>% on the suite total, measured with identical code on both sides): changes under <bar>% total, or under <per-case>% on a targeted case, were discarded, and every keep required a second confirming run.
> - verified behaviour-preserving by a **characterisation guard** (<what is hashed>) plus the full test suite (<T> tests), both green after every commit.
>
> The numbers below are fresh verification runs of **this branch in isolation against `<base>`** (two independent runs each; an identical-source control run measured <c>% total, i.e. noise). Negative = faster. The headline figures come from **standalone runs, one revision per process**, which is what you will measure when you build each side separately, each shown next to an identical-code control at the same settings. The paired harness is the more sensitive instrument and decides which changes were kept, but it holds both revisions in one process, so its per-case numbers can come out either side of the standalone ones; they are not the claim.

## What this PR does

<One paragraph per commit: what was slow, why, what changed, which existing pattern or prior art it follows.>

## Verification (this branch vs `<base>`)

| case | run 1 | run 2 | standalone | identical-code control | speed-up vs `<base>` |
|---|---|---|---|---|---|
| <targeted case> | <d1> | <d2> | **<s1>** | <c1> | **<s>x** |
| <case the control cannot resolve> | <d1> | <d2> | not resolvable | <c1> | <s>x (focused runs; the standalone control could not separate it) |
| <asymptotic case> | <d1> | <d2> | <s1> | <c1> | <s>x at <size>, linear from here |
| **suite TOTAL** | **<d1>** | **<d2>** | | | **<s>x** |

<The suite total is a full-suite paired run and carries the full-suite noise, so a line that moves on
code this PR does not touch is the instrument, not the change. Say which lines those are.>

<Optional external cross-check, with its caveat stated in the same paragraph.>

## Observable surface

- <Each difference a careful reviewer could notice, or "None intended" with the reason.>

## Reproducing the numbers

<Install step. Where to save the harness files. Noise-control command. Measurement command
against the PR head ref. How long a run takes and how to judge it.>

<Preferred: link the campaign branch at a named commit, and say what it contains (harness, plan,
experiment log with the discarded experiments). Inline the sources only when there is no fork or the
repo is private. Keep the cases module inline either way: it defines what was measured.>

Harness: <fork-url>/tree/<commit-sha>/perf (plan.md and experiments.tsv are in the same directory)

<details>
<summary><code><cases file></code>, the workloads these numbers come from</summary>

```<lang>
<cases source>
```

</details>

---

Companion PRs from the same campaign: <add after all PRs exist>
