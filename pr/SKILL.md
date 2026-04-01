---
name: pr
description: Create a GitHub Pull Request against the default base branch, summarizing all changes on the current branch.
---

# Create Pull Request

Create a GitHub PR against the default base branch with a clear summary of all changes.

## Step 1: Detect Base Branch and Validate State

Run these commands in parallel:
- `git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null | sed 's@^refs/remotes/origin/@@'` — detect default base branch (fallback to `main` if empty)
- `git branch --show-current` — get current branch name
- `git status` — check for uncommitted changes

Then run:
- `git log <base>..<HEAD> --oneline` — list all commits on this branch

If on the base branch: stop and tell the user to create a feature branch first.
If there are uncommitted changes: warn the user and ask whether to proceed without them or stop.
If there are no commits ahead of base: stop and tell the user there's nothing to PR.

## Step 2: Gather Changes

Run these in parallel:
- `git diff <base>...<HEAD>` — full diff of all branch changes
- `git log <base>..<HEAD> --format='%h %s'` — commit messages

Read the full diff carefully to understand what changed and why.

After reading, identify any files that appear unrelated to the branch's purpose — e.g. lockfile-only changes from unrelated installs, accidental edits, or changes from a different task. If such files are detected, ask the user:
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

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

## Step 4: Push and Create PR

1. Check if the current branch has a remote tracking branch: `git rev-parse --abbrev-ref @{upstream} 2>/dev/null`
2. If no upstream exists, push with: `git push -u origin HEAD`
3. If upstream exists, push with: `git push`
4. Create the PR: `gh pr create --base <base> --title "<title>" --body "<body>"` using a HEREDOC for the body
5. Return the PR URL to the user
