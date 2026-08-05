---
name: pr
description: Create a GitHub Pull Request against the default base branch, or refresh the description of the branch's existing one, summarizing all changes on the current branch.
argument-hint: "[optional hint: e.g. PR title/wording, 'no commit', or a follow-up like 'draft', 'merge']"
---

# Create or Update Pull Request

Open a GitHub PR against the default base branch with a clear summary of all changes — or, when the branch already has one open, refresh its description so it reflects everything on the branch.

This skill owns PR bodies. Anything that needs a PR description written or rewritten should come through here rather than drafting its own.

## Project Override

Before anything else, check whether the repository defines its own PR skill at `.claude/skills/pr/SKILL.md` (relative to the repo root).

**If that file exists, read it and follow it instead of this one.** It replaces this flow entirely; it does not merge with it, and no step below applies. Only fall back to the steps here when the repo has no such file.

Do not tell the user which of the two was used.

## Argument Hint

If the user passed an argument, treat it as guidance, not a literal title or body. It may contain:

- **Title/body hints** — wording, scope, type, or focus to bias the drafted PR (e.g. `fix flaky tests`, `scope: api`, `emphasize the perf win`).
- **Flags** — adjustments to the `gh pr create` invocation (e.g. `draft` → `--draft`, `base develop` → `--base develop`, `reviewer alice` → `--reviewer alice`).
- **`no commit`** (or `update only`) — do not invoke the `commit` skill for any reason; treat uncommitted work as deliberately out of scope and proceed with what's already committed. Another skill that just committed passes this to stop the two delegating to each other in a loop.
- **Follow-up instructions** — actions to perform after creating the PR (e.g. `merge`, `auto-merge`, `open in browser`).
- **Combinations** of the above.

Apply `no commit` in Step 1. Apply title/body hints when drafting in Step 3. Apply flags and follow-ups in Step 4 and after.

If no argument is provided, follow the default flow.

## Repository Context

- Default base branch: !`git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main`
- Current branch: !`git branch --show-current`
- Existing PR for this branch: !`gh pr view --json number,url,state,isDraft,body 2>/dev/null || echo none`
- Working tree status: !`git status`
- Commits ahead of base: !`git log origin/HEAD..HEAD --format='%h %s'`
- Changed files (committed + uncommitted): !`git diff --stat $(git merge-base origin/HEAD HEAD)`
- Full diff (committed + uncommitted): !`git diff $(git merge-base origin/HEAD HEAD)`
- Upstream tracking: !`git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null || echo none`

Both diffs run against the **merge base**, not `origin/HEAD...HEAD`, so they show the branch's work whether or not it has been committed yet. A `...HEAD` diff is empty while the work still sits in the working tree, which is the normal state when someone finishes a task and asks for a PR, and drafting from an empty diff yields an invented summary. Note `git diff` does not list untracked files; `git status` above covers those, and once Step 1 commits them they appear here.

If `origin/HEAD` is unset in this repo, substitute `origin/main`.

## Step 1: Validate State

**This skill never runs `git add` or `git commit` itself.** Committing is the `commit` skill's job — it owns message drafting, deciding what to stage, the repo's branch policy, and any pre-commit hooks. Staging a dirty tree from here would bypass all of that and can sweep in unrelated work.

Using the context above, match one case:

- **On the base branch** → stop; tell the user to create a feature branch first.
- **No commits ahead, clean tree** → stop; there is genuinely nothing to PR.
- **No commits ahead, dirty tree** → the work exists, it just isn't committed. Say so, then invoke the `commit` skill with the hint `no push` (this skill pushes in Step 4). When it finishes, re-read the git state and continue from Step 2 — the context above was captured before the commit, so untracked files only become visible in the diff afterwards.
- **Commits ahead, dirty tree** → the intent is ambiguous, so ask and wait:
  > "The branch has N commit(s) plus uncommitted changes. Include the uncommitted work (I'll run the `commit` skill first), or open the PR with only what's committed?"

  Never resolve this by committing without an answer.
- **Commits ahead, clean tree** → proceed.

**If the argument hint says `no commit`**, the two dirty-tree cases collapse: don't invoke the `commit` skill and don't ask about the uncommitted work. Proceed with what's committed, and mention in the summary which files were left out.

Then note the mode for the rest of the run, from `Existing PR for this branch` in the context:

- **`none`** → **create mode.** Draft a fresh title and body.
- **An open PR** → **update mode.** Keep its title unless the branch's purpose has actually changed, and refresh its body.
- **A closed or merged PR** → treat as create mode; a new PR is wanted, not a resurrection of the old one.

## Step 2: Identify Unrelated Changes

Read the full diff in the context. Identify any files that appear unrelated to the branch's purpose — e.g. lockfile-only changes from unrelated installs, accidental edits, or changes from a different task. If such files are detected, ask the user:
> "These files appear unrelated to the PR — should they be included in the description?
> - `path/to/file1`
> - `path/to/file2`"

Only use the confirmed-relevant changes when drafting the PR below.

## Step 3: Draft PR Title and Body

**Title:** Short conventional-commit-style title (under 70 chars). Use the dominant change type (`feat:`, `fix:`, `chore:`, etc.).

**Body:** Use this exact format:

```
## Summary
<2-5 bullet points describing the key changes>

## Test plan
<Bulleted checklist of how to verify these changes>
```

Optionally add one more section after `## Test plan`, and only when there is something a reviewer would otherwise trip over:

```
## Notes
<Pre-existing failures the reviewer will hit that this branch did not cause, or
 scope deliberately left out — each with a one-line reason.>
```

The bar: it changes how the PR is read. A known-flaky test that will redden CI qualifies, because otherwise the reviewer blames the branch. A TODO list, a changelog, or detail that belongs in Summary does not. Omit the section entirely when nothing meets the bar.

**In update mode**, draft against the existing body rather than from a blank page:

- **Preserve anything a human added** — extra sections, review notes, checklists, linked issues, screenshots. Assume unfamiliar content is deliberate and keep it.
- **Refresh the generated sections** so Summary and Test plan cover the whole branch, not just the newest commit.
- **Keep any structure the existing body already uses**, even where it differs from the template above. A body that has been shaped by hand or by a repo template is the better guide.

If the existing body already covers everything on the branch, say so and skip the edit rather than rewriting it for the sake of it.

## Step 4: Push, then Create or Update the PR

1. If upstream tracking is `none` in the context, push with: `git push -u origin HEAD`
2. Otherwise, push with: `git push`
3. Then, by mode:
   - **Create mode:** `gh pr create --base <base> --title "<title>" --body "<body>"`, using a HEREDOC for the body.
   - **Update mode:** `gh pr edit <number> --body "<body>"`, again with a HEREDOC. Only pass `--title` when the title actually changed. Apply it directly, no confirmation — preserving the manual content is Step 3's job, and Step 5 prints the result for review.

## Step 5: Print Summary

Print a summary of the PR to the user:
- Whether the PR was created or updated (and, if updated, that the description was already accurate when nothing changed)
- The PR title
- The PR body (Summary and Test plan sections)
- A bulleted list of files included in the PR (from `git diff --name-only $(git merge-base origin/HEAD HEAD)`)
- The PR URL
