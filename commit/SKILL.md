---
name: commit
description: Create a git commit with an auto-generated conventional commit message summarizing the changes, then optionally push, sync the description of any PR already open for the branch, and report drift from the default branch.
argument-hint: "[optional hint: e.g. message scope/wording or follow-up like 'push']"
---

# Create Commit

Create a commit with an auto-generated message summarizing the relevant changes for the current task.

## Project Override

Before anything else, check whether the repository defines its own commit skill at `.claude/skills/commit/SKILL.md` (relative to the repo root).

**If that file exists, read it and follow it instead of this one.** It replaces this flow entirely; it does not merge with it, and no step below applies. Only fall back to the steps here when the repo has no such file.

Do not tell the user which of the two was used.

## Argument Hint

If the user passed an argument, treat it as guidance, not a literal message. It may contain:

- **Message hints** — wording, scope, type, or focus to bias the drafted commit message (e.g. `fix typo`, `scope: api`, `feat: add cache`).
- **Follow-up instructions** — actions to perform after committing (e.g. `push`, `push and open PR`, `no push`).
- **Both** — combine them (e.g. `fix flaky test, then push`).

Apply message hints when drafting in Step 5. Apply follow-up instructions in Step 9 (e.g. skip the "Push to remote?" prompt if the user already said `push` or `no push`).

If no argument is provided, follow the default flow.

## Repository Context

- Working tree status: !`git status`
- Unstaged changes: !`git diff`
- Staged changes: !`git diff --cached`
- Recent commits (style reference): !`git log -5 --format='%h %s' 2>/dev/null || true`
- Current branch: !`git branch --show-current`
- Default branch: !`git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null || echo origin/main`

The default branch is reported as `origin/<name>`; the local branch name is the part after `origin/`. Commands below use the `origin/HEAD` ref directly, which git resolves to the same thing. If `origin/HEAD` is unset in this repo, substitute `origin/main`.

## Step 1: Check for Changes

If there are no changes in the context above (nothing staged, unstaged, or untracked): stop and tell the user there's nothing to commit.

## Step 2: Default-Branch Notice

If `Current branch` matches the default branch, mention it once in the Step 7 summary (e.g. "committed directly to `main`") and carry on.

Commit on whatever branch is checked out. **Never create or switch branches here, and never ask whether to** — not even when committing straight to `main`. If the user wants a feature branch, they will say so.

If the current branch is anything else, skip this step.

## Step 3: Read Untracked Files

For untracked files shown in the status above, read them with the Read tool to understand their contents. Diffs already cover modified files.

## Step 4: Filter to Relevant Changes

Evaluate each changed/untracked file against the apparent intent of the current task. Classify each as **relevant** or **unrelated**.

Mark a file as unrelated if it:
- Belongs to a different feature or fix unrelated to the current task
- Is an auto-generated artifact (lockfiles, build output, `.cache/`) not caused by this task
- Appears accidentally modified (e.g. whitespace-only changes in unrelated files)

If unsure about any file, ask the user before proceeding:
> "These files are also changed — are they part of this commit?
> - `path/to/file1`
> - `path/to/file2`"

Only carry the relevant files forward into Step 5.

## Step 5: Draft Commit Message

Write a conventional commit message:
- **Type:** `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `docs:`, etc.
- **Scope (optional):** package name if changes are scoped to one package, e.g. `feat(api):`
- **Subject:** concise summary of what changed and why (under 72 chars)
- **Body (if needed):** additional context for complex changes, separated by a blank line

If multiple unrelated changes exist, suggest the user split them into separate commits.

## Step 6: Stage and Commit

1. Stage only the relevant files identified in Step 4 with `git add <specific files>` — never use `git add -A`
2. Create the commit using a HEREDOC:

```
git commit -m "$(cat <<'EOF'
<type>(<scope>): <subject>

<optional body>
EOF
)"
```

3. Run `git status` to verify the commit succeeded.

## Step 7: Print Summary

Print a summary of the commit to the user:
- The commit message (subject and body)
- A bulleted list of files included in the commit (from `git show --name-only --format= HEAD`)
- The commit URL (from `gh browse $(git rev-parse HEAD) --no-browser`)

The URL only resolves once the commit exists on the remote. If the commit hasn't been pushed yet, skip the line here rather than printing a link that 404s, and print it in Step 9 immediately after the push instead.

## Step 8: Sync the PR (if one is open)

Check whether the current branch already has an open PR:

```
gh pr view --json number,url,state 2>/dev/null
```

If the command fails, returns nothing, or the PR isn't open, there's no PR to sync — skip to Step 9.

If an open PR exists, its description should reflect the commit just made. **Hand that to the `pr` skill** with the hint `no commit`, rather than drafting a body here — the project's own at `.claude/skills/pr/SKILL.md` if the repo defines one, otherwise the personal one. That skill owns PR bodies: it will see the open PR, refresh the description against the whole branch, and honour whatever structure the project requires.

The `no commit` hint matters. Step 4 deliberately leaves unrelated files unstaged, so the `pr` skill can find a dirty tree straight after a commit; without the hint it may try to invoke this skill right back.

It also pushes, so once it returns, skip Step 9 and go to Step 10 — just say the branch was pushed as part of the PR sync.

If no `pr` skill is available, fall back to doing it inline: compare the existing body against the full branch (`git log origin/HEAD..HEAD --format='%h %s'` and `git diff origin/HEAD...HEAD`; the new commit is already in local HEAD, so this works before pushing). If the body still covers everything, say so and change nothing. If not, refresh the generated sections while preserving manual content and mirroring the structure the body already uses, then apply it directly with `gh pr edit <number> --body "$(cat <<'EOF' … EOF
)"` and print the updated body and the PR URL. Then continue to Step 9 to push.

## Step 9: Push

Skip this step entirely if Step 8 delegated to the `pr` skill — that already pushed.

- **If the argument hint already specified push behavior** (e.g. `push`, `no push`), honor it without asking.
- **If Step 8 updated a PR inline**, the branch is meant to be pushed: `git push` (an upstream already exists).
- **Otherwise:** ask **"Push to remote?"**
  - If yes: check for upstream with `git rev-parse --abbrev-ref '@{upstream}' 2>/dev/null`, then `git push -u origin HEAD` (no upstream) or `git push` (has upstream).
  - If no: continue to Step 10.

After a successful push, print the remote commit URL (from `gh browse $(git rev-parse HEAD) --no-browser`).

## Step 10: Base-Drift Check (notify only, never integrate)

Run this after **every** commit, whether or not it was pushed:

1. Refresh the remote: `git fetch origin --quiet`
2. Count the drift: `git rev-list --count HEAD..origin/HEAD`
3. Report:
   - **Count is 0** — say nothing. This step is silent when there's no drift.
   - **Count > 0** — tell the user in one or two sentences how far ahead the default branch is, plus the most recent few subjects (`git log HEAD..origin/HEAD --format='%h %s' -5`). On a feature branch, mention they could integrate with `git merge origin/HEAD`; on the default branch itself, suggest `git pull`.

**This step only notifies. Never run the merge or pull** — not when drift is found, and not when the user approved an integration earlier in some other context. Whether and when to integrate is the user's call.
