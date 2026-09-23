# Packaging kept commits as PRs

Turn the linear branch of kept commits into a few independent PRs that reviewers can judge one at a time. Each PR must stand alone: it applies to the base without the others, it passes the tests alone, and its numbers come from measuring it alone.

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

Resolve conflicts so that each branch contains only its own group's code:

- Drop scratch edits that leaked into commits during the loop (for example `.gitignore` lines).
- When a conflict hunk contains code from another group, keep only the part that belongs to this group.
- Afterwards, grep each branch for symbols introduced by the other groups. The count must be zero.

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
2. Two A/B runs of the base against the branch.
3. A standalone run per headline case (one revision per process), because in-process pairing inflates small, call-site-bound cases on both sides. The number a maintainer reproduces is the standalone one.

Build the verification table from these runs, never from the campaign log: isolated effects differ from stacked ones.

Where the stacked number differs materially from the isolated one, give both with the reason. This happens in both directions: a PR measured alone can look larger because it has the untouched path to itself, and a trade-off can look cheap alone but cost several percent once the other PRs removed the work that hid it. Two bodies of the same campaign must not state two different numbers for the same effect without explaining why.

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

Also follow the repo's own PR conventions (templates, AGENTS.md or CLAUDE.md rules, tone). Write bodies to files and pass them with `--body-file`. Inline heredocs break backticks and template literals.

## 5. Confirm and create, one PR at a time

For each PR, show the user the title, the branch, the commits, the verification table and the body. Wait for confirmation. Then push with an explicit refspec and create the PR:

```sh
git push <remote> <branch>:refs/heads/<branch>
gh pr create --repo <owner/repo> --base <base> --head <fork-owner>:<branch> --title "..." --body-file <file>
```

If the user wants a staging round, create the PRs on their fork first, then transfer them upstream: create the upstream PRs, update the bodies with the real numbers and head refs, and close the fork PRs with a link to the upstream PR.

If `gh pr create` fails with an API error, check with `gh pr view <branch> --repo <owner/repo>` whether the PR exists before you retry.

While a PR waits, the base moves. Re-verify before you nudge it, and re-check the invariants from its body against current base: work that lands after you open a PR can add exactly the state your change assumed nobody would add, which turns a correct change into a broken one without touching its diff.

Afterwards, keep the campaign branch, the plan and the log. They are the reference when a reviewer asks about a discarded alternative, and when later PRs need a rebase after earlier ones land.
