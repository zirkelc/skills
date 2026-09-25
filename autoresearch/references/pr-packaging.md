# Packaging kept commits as PRs

Turn the linear branch of kept commits into a few independent PRs that reviewers can judge one at a time. Each PR must stand alone: it applies to the base without the others, it passes the tests alone, and its numbers come from measuring it alone.

## 0. Review the kept commits, and treat the review as measurement

Read the kept commits again before you group them. A campaign optimises for one small change at a time, so the series arrives with duplicated helpers, an unrolled loop in one of two places that need it, and forms that were convenient while experimenting.

The rule that makes this safe is short: **any edit after the last measurement invalidates that measurement.** A review suggestion that touches a hot path is an experiment, and it gets the same treatment: the isolation check first, then the branch verification in section 3, and the numbers in the body come from the branch, never from the campaign log. In one campaign the review found no bugs and still changed the results three ways. One cleanup was neutral. One moved a shared helper so that a second code path got the unrolled loop as well, which doubled that PR's effect and made the campaign log an understatement. One was slower and would have shipped as an improvement, and the isolation check is what caught it.

So: review, then re-measure, then group. Never review after the verification table is written.

## 1. Group the commits

Group kept commits by theme (the path or mechanism they touch), not by the order in which they were made. Good groups are the ones a maintainer can accept or reject as a unit, for example "error construction", "schema construction", "parse fast paths". Four PRs from eleven commits worked well. A group with a single strong commit is fine.

Order the PRs by how easy they are to accept: the largest and least controversial first.

Before you present the grouping, check it mechanically: the union of the groups must equal the list of kept commits. Print the difference if it is not empty. A grouping table that silently lists 7 of 8 kept commits looks complete to everyone reading it.

Present the grouping to the user before you create branches.

## 2. Build one branch per group

Check that the base branch did not move (`git fetch`). For each group:

```sh
git worktree add <path> -b <branch> <base>
cd <path> && git cherry-pick <commit> <commit> ...
```

Branch names: hyphenated (`perf-error-path`), not slash-separated, because a remote branch named `perf` blocks every `perf/*` ref.

Three things about the worktree itself, each of which costs ten confused minutes the first time:

- Put it **outside** the repository directory, so no test glob, formatter or type checker finds a second copy of the sources.
- It has no `node_modules`. A symlink to the main checkout's is enough, but `.gitignore` says `node_modules/`, and a pattern with a trailing slash matches a directory, which a symlink is not. So the symlink shows as untracked until you add it to `.git/info/exclude`.
- Submodules are empty in a new worktree, which silently disables any gate that lives in one (a conformance suite, a fixture corpus). A symlink to the main checkout's submodule directory works; afterwards `trash` the symlink and recreate the empty directory, or the next `git submodule` command in the main checkout is confused.

Resolve conflicts so that each branch contains only its own group's code:

- Drop scratch edits that leaked into commits during the loop (for example `.gitignore` lines).
- When a conflict hunk contains code from another group, keep only the part that belongs to this group.
- Afterwards, grep each branch for symbols introduced by the other groups. The count must be zero.

Run the repo's full test suite **before** you copy the harness into the branch. The ignore entries that keep formatters and linters away from `perf/` live in the campaign's harness commit, not on a PR branch, so a copied-in harness fails the format gate on its own plan and scripts.

Install dependencies, then regenerate every committed derived artifact (types, bundled output) and fold the result into the commit that causes it, rather than adding a "regenerate" commit on top. Only some branches will change generated files, and the campaign branch may never have built them at all.

Then run the full test suite and the guard on each branch.

The guard needs the harness, and the harness does not exist on a branch that starts from the base. Copy it in as untracked files instead of committing it:

```sh
git checkout <campaign-branch> -- perf && git reset -- perf
```

Remove those copies again before switching back to the campaign branch, which tracks the same paths. The A/B harness itself does not need this: it materialises both revisions with `git archive`, so it can compare any two revisions from the campaign checkout. Only what runs against the working tree (the guard, and any run while the PR branch is checked out) needs the copy.

## 3. Verify each branch alone

Run from the harness location (the campaign branch):

1. One noise-control run with identical code on both sides.
2. Two A/B runs of the base against the branch, focused on the cases the PR targets where the full suite cannot resolve them.
3. A standalone run per headline case, alternating whole processes (`solo.mts A B <case> --pairs 8 --iters 100` in node-ts), **each next to an identical-code control** (`solo.mts A A <case>`, same settings).

**Every headline number in the body comes from step 3, with its control beside it.** The reason is not that paired numbers are inflated: across five changes in one campaign the standalone number came out lower twice and higher twice. It is that a maintainer builds one revision per process, so that is the number they will measure, and a reviewer who reproduces something else stops believing the rest of the PR. Two PRs of an earlier campaign were closed over that kind of credibility.

The control is what turns the number into evidence. Process-to-process spread differed by a factor of twenty between cases of the same campaign, from +-1.5% to +-33%, so the same command resolves a 32% effect in one case and cannot resolve 9% in another. Where the control's spread covers the effect, say so in the body, give the focused number and name the instrument: one real change measured -8.5% and -9.8% focused against controls of +0.2% and +0.8%, and no standalone run could separate it from its own control.

Build the verification table from these runs, never from the campaign log: isolated effects differ from stacked ones.

An asymptotic keep or a trade-off must be re-measured in isolation before its body is written. Suite neutrality in a stacked run is not evidence: one campaign's trade-off measured +0.25% stacked and +1.21% alone, and another's paired gain did not reproduce standalone at all. Where the stacked number differs materially from the isolated one, give both with the reason. This happens in both directions: a PR measured alone can look larger because it has the untouched path to itself, and a trade-off can look cheap alone but cost several percent once the other PRs removed the work that hid it. Two bodies of the same campaign must not state two different numbers for the same effect without explaining why.

Optionally, run the repo's own benchmark on the base and on each branch as an external cross-check. Quote a figure only under the rules in `methodology.md` (elephants, or paired in-process references, with caveats stated).

## 4. Write the PR bodies

Use `templates/pr-body.md`. Every PR gets the same preamble (the campaign and its method), then its own content:

- **What this PR does**: one paragraph per commit. What was slow, why, and what changed. Point to existing patterns in the codebase that the change follows, and to prior art by the maintainers (unmerged branches, earlier PRs).
- **Verification**: a table with run 1, run 2 and the speed-up versus base for the cases the PR targets, plus the suite total. Mark noisy cases as noise instead of claiming them.
- **Observable surface**: everything a careful reviewer could notice: property descriptors, enumerability, own vs inherited properties, mutation semantics, new internal fields, error message timing. Name each one. A reviewer who finds an unlisted difference stops trusting the rest.
- **Invariants the change introduces**: anything the rest of the codebase must keep true for the change to stay correct, for example "nothing writes to this shared object" or "this structure is never aliased". A maintainer is accepting a constraint on future work, not only a diff, and that is a cost they are entitled to weigh.
- **Reproducing the numbers**: run instructions against the base, plus the harness itself. Two ways, in order of preference. Push the campaign branch to a fork and link it at a **named commit** (a branch can be force-pushed or deleted, and the reviewer's reproduction then silently differs); that also exposes the plan and the log, so a reviewer can see the experiments that failed, which is the more convincing artifact. Inline the sources in `<details>` blocks only when no fork exists or the repo is private. Either way, keep the cases module inline: it defines what was measured, and that is the file a reviewer reads to judge whether the benchmark is honest. For upstream PRs, use the PR head ref: `git fetch origin pull/<N>/head:pr-<N>`.
- **Instrument artefacts**: if a case shows a delta that standalone timing does not reproduce (see `methodology.md`), say so in the body. A reviewer who runs the harness will see the same line.
- **Companion PRs**: links to the other PRs of the campaign. Add these only after all PRs exist, with their real numbers. Placeholder numbers such as `#1 #2` link to, and notify, the old issues 1 and 2 of the target repo.

Also follow the repo's own PR conventions (templates, AGENTS.md or CLAUDE.md rules, tone). Where the repo has a template, the campaign preamble goes first and the repo's own sections follow it, so a maintainer finds the structure they expect. **Never tick a DCO or CLA checkbox.** It is a declaration by a person about their own work, and an agent cannot make it; leave it unticked and say so when you present the PR.

Write bodies to files and pass them with `--body-file`. Inline heredocs break backticks and template literals. When several PRs cross-reference each other, generate all the bodies from one script with placeholders (PR numbers, companion links, the harness link at a full hash), create the PRs, then fill the placeholders with `gh pr edit`. Four bodies written by hand drift apart; four generated from one script do not.

## 5. Confirm and create, one PR at a time

Before any of this touches a remote, grep the plan, the log and the cases for private names, paths and hosts. PR bodies link the campaign branch publicly, and a plan written during the campaign names the downstream repo that motivated the work. One campaign published a private repository's name eight times that way. This is a blocking check, not a tidy-up.

Check the base's own CI before you open anything. When a PR shows failing jobs, compare the failing set with the base's last run: a failure that also fails on the base is not yours, and saying so in the body saves the maintainer the same investigation. Occasionally the comparison finds a real bug in their CI, which is worth its own issue.

On a **first** contribution to a repository, GitHub shows no checks at all until a maintainer approves the workflow runs. That looks exactly like broken CI, and the natural reactions (push again, ask what is wrong) are both wrong. Say so when you hand the PR over, and wait.

The base moves between the verification and the creation, sometimes by hours. Check what changed before you open anything:

```sh
git diff --stat <measured-base> origin/main          # do the touched files or the invariants overlap?
git merge-tree --write-tree origin/main <branch>     # does it still merge cleanly? no working tree touched
```

No overlap means the branch can stay on the base it was measured against, and the body can say which commit that was. An overlap in the touched files, or in the files an invariant depends on, means re-verify on the new base rather than rebase and hope.

`gh repo fork <owner>/<repo> --clone=false` is the form that works when you only need the fork; adding `--remote=false` to it failed.

Use the current PR template from the organisation (`.github/pull-request-template.md` in its `.github` repo), not the one copied from a merged PR, which may be an old revision. Keep machine markers such as `<!--do not edit: pr-->`, and tick only what is true.

Put decision items (the ideas that would change behaviour, from the plan) into the body of the PR they relate to, as an open question for the maintainers, with the behaviour risk named.

For each PR, show the user the title, the branch, the commits, the verification table and the body. Wait for confirmation. Then push with an explicit refspec and create the PR:

In zsh, write the refspec with braces (`"${b}:refs/heads/${b}"`): `$b:refs/heads/...` is read as a history modifier and pushes the wrong ref. In general, prefer a script file over an inline shell loop, because the traps live in the quoting.

```sh
git push <remote> <branch>:refs/heads/<branch>
gh pr create --repo <owner/repo> --base <base> --head <fork-owner>:<branch> --title "..." --body-file <file>
```

If the user wants a staging round, create the PRs on their fork first, then transfer them upstream: create the upstream PRs, update the bodies with the real numbers and head refs, and close the fork PRs with a link to the upstream PR.

If `gh pr create` fails with an API error, check with `gh pr view <branch> --repo <owner/repo>` whether the PR exists before you retry.

While a PR waits, the base moves. Re-verify before you nudge it, and re-check the invariants from its body against current base: work that lands after you open a PR can add exactly the state your change assumed nobody would add, which turns a correct change into a broken one without touching its diff.

When a scan or a profile finds the same bug in a dependency, treat that as a separate campaign in miniature: clone the dependency, run its own gates, compare two built copies of it (with an identical-copy control), and ask before creating a branch or a fork there.

Afterwards, keep the campaign branch, the plan and the log. They are the reference when a reviewer asks about a discarded alternative, and when later PRs need a rebase after earlier ones land.
