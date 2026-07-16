---
name: release-please
disable-model-invocation: true
description: Merge an open Release Please PR on GitHub to cut a release, then monitor the release workflow and report the published version. Use when the user wants to release, ship, or publish a repo whose releases are managed by release-please.
argument-hint: "[repo url or owner/repo or name]"
---

# Release via Release Please

Merge the open [Release Please](https://github.com/googleapis/release-please) PR for a repo to trigger a release, then watch the release workflow to completion and report what shipped.

All steps use the `gh` CLI. Do not proceed past a failing precondition without telling the user.

## Step 1: Resolve the Repository

If an argument was given, use it as the target repo. It may be:

- A full URL: `https://github.com/owner/repo` → extract `owner/repo`.
- A slug: `owner/repo` → use as-is.
- A bare name: `repo` → resolve the owner via the authenticated user (`gh api user --jq .login`) and try `<login>/<repo>`.

If **no argument** was given, default to the repo of the current working directory:

```bash
gh repo view --json nameWithOwner --jq .nameWithOwner
```

If that fails (not inside a git repo, or no GitHub remote), tell the user and ask them to pass a repo URL or `owner/repo`.

Confirm the repo exists and you can read it:

```bash
gh repo view <owner/repo> --json nameWithOwner,defaultBranchRef --jq '{repo: .nameWithOwner, base: .defaultBranchRef.name}'
```

If it fails, report the error and ask the user to clarify the repo. Carry `<owner/repo>` and the default base branch forward.

## Step 2: Find the Open Release PR

List open PRs and identify the release-please PR(s):

```bash
gh pr list --repo <owner/repo> --state open --json number,title,headRefName,labels,url
```

A release-please PR is identified by **either**:
- A head branch starting with `release-please--` (e.g. `release-please--branches--main--components--<pkg>`), **or**
- A label starting with `autorelease:` (e.g. `autorelease: pending`).

Then:
- **No matching PR** → stop and tell the user there is no pending release PR. (Either everything is already released, or no releasable commits have landed since the last release.)
- **Exactly one** → use it.
- **More than one** (monorepo with multiple components) → list them with title + URL and ask the user which to merge (or whether to merge all).

## Step 3: Check PR Status Checks

For the chosen PR, inspect the status checks:

```bash
gh pr checks <number> --repo <owner/repo>
```

Also confirm it is mergeable (not blocked, no conflicts):

```bash
gh pr view <number> --repo <owner/repo> --json mergeable,mergeStateStatus,title,body --jq '{mergeable, mergeStateStatus, title}'
```

Summarize the check results to the user:
- If all checks pass and it is mergeable → say so and continue to Step 4.
- If any check is **failing** or **pending**, or `mergeable` is `CONFLICTING` → **warn the user clearly** which checks failed/are pending, and ask whether to merge anyway or stop. Do not merge over failing checks without explicit confirmation.

## Step 4: Confirm and Merge

Show the user the release the PR will cut (extract the version and changelog from the PR `body` from Step 3) and ask for explicit confirmation:

> "Merge PR #<n> **<title>** in `<owner/repo>` to cut this release?"

Honor a confirmation already present in the argument hint (e.g. `merge`, `yes`) without re-asking.

On confirmation, merge with squash (release-please detects the merge regardless of method):

```bash
gh pr merge <number> --repo <owner/repo> --squash
```

Capture the resulting commit on the base branch for the next step:

```bash
gh pr view <number> --repo <owner/repo> --json mergeCommit --jq '.mergeCommit.oid'
```

If the merge is blocked (e.g. branch protection requires admin), report the exact `gh` error and stop.

## Step 5: Monitor the Release Workflow

Merging pushes to the base branch, which triggers the release-please action and any publish workflow. Find the workflow run(s) for the merge commit and watch them:

```bash
# Find runs for the merge commit
gh run list --repo <owner/repo> --commit <merge-sha> --json databaseId,name,status,conclusion,workflowName
```

If no run appears immediately, poll a few times (the run may take a few seconds to register):

```bash
sleep 5; gh run list --repo <owner/repo> --commit <merge-sha> --json databaseId,name,status,conclusion,workflowName
```

Watch the relevant run(s) to completion:

```bash
gh run watch <databaseId> --repo <owner/repo> --exit-status
```

Report progress to the user. If a workflow **fails**, report which job failed and surface the failing step's log tail:

```bash
gh run view <databaseId> --repo <owner/repo> --log-failed
```

Then stop and let the user decide how to proceed.

## Step 6: Report the Release

Once the workflow completes successfully, the release-please action will have created a GitHub release and tag. Fetch and report it:

```bash
gh release view --repo <owner/repo> --json tagName,name,url,publishedAt,body --jq '{tag: .tagName, name, url, publishedAt}'
```

Print a concise summary to the user:
- The released version / tag and the release URL.
- The changelog / release notes body.
- If the repo publishes to a registry (e.g. npm), mention that the publish workflow completed (from Step 5) and link to it.

If no new release shows up despite a successful workflow, note that release-please may still be processing and point the user to the repo's Actions and Releases pages.
