---
name: track
description: "File a tracking issue for an upstream issue or pull request in a dependency or tool. The tracking issue goes into a private GitHub repository and records the requirement, the affected code, the workaround, and the upstream link. The skill also lists open tracking issues, checks the upstream state, checks that a recorded workaround is still in the code, and closes a tracking issue after the fix is adopted. Instructions are free text with no keywords, e.g. \"track https://github.com/vitest-dev/vitest/issues/123\", \"what am I waiting on?\", \"did anything get fixed upstream?\", \"we removed the dynalite workaround\". Use when the user finds a bug or a missing feature in software they depend on but do not control."
argument-hint: "e.g. an upstream issue or PR url, 'what am I waiting on?', 'anything fixed?', 'done with the vitest one'"
---

# Track

An upstream subscription records that you want a fix. It does not record why you need the
fix or which code needs it. When the fix is released, that information is necessary and
usually lost.

This skill records that information in a private GitHub repository, the store. Each
tracking issue names the requirement, the affected files, the workaround, and the upstream
issue or pull request.

A daily workflow in the store checks the state of each upstream link. When the state
changes, the workflow adds a label and a comment. Nobody has to check upstream manually.

**Use this skill on your own initiative** when a defect in a dependency blocks or changes
the current work and the session moves on. A comment such as `// workaround for a vitest
bug` is not sufficient. It does not record when the workaround can be removed.

## Instructions are free text

There are no subcommands and no fixed word order. Identify the intent from the content of
the instruction, not from keywords.

## Step 1: Find the store

The store is one private GitHub repository that contains tracking issues. Find it with these
commands. Do not assume its location:

```bash
gh api user --jq .login                                 # <owner>
gh repo view <owner>/issues --json name,isPrivate       # the default store
```

The default store is `<owner>/issues`. A repository named in the instruction overrides the
default.

**The store exists and is private:** continue. Because the store is private, tracking
issues can contain real file paths, repository names, and constraints. Do not record
credentials or tokens. An issue body is not a secret store.

**The store exists and is public:** tell the user and stop. The store holds information
that must not be public. Do not write into a public store without confirmation.

**The store does not exist:** ask the user before you create it. Then run:

```bash
gh repo create <owner>/issues --private \
  --description "Upstream issues and pull requests I am waiting on, and why"

gh label create "upstream:fixed"       -R <owner>/issues -c 0e8a16 -d "Upstream merged or closed as completed: adopt it and drop the workaround"
gh label create "upstream:declined"    -R <owner>/issues -c b60205 -d "Upstream closed as not planned, or PR closed unmerged: the workaround is permanent"
gh label create "upstream:moved"       -R <owner>/issues -c fbca04 -d "Upstream closed as a duplicate: re-point at the surviving issue"
gh label create "upstream:unreachable" -R <owner>/issues -c 5319e7 -d "The upstream link no longer resolves"
```

Then push the files in this skill's `templates/` directory. These files are the complete
content of the store:

```
templates/README.md                              -> README.md
templates/.github/ISSUE_TEMPLATE/tracker.md      -> .github/ISSUE_TEMPLATE/tracker.md
templates/.github/workflows/upstream-check.yml   -> .github/workflows/upstream-check.yml
templates/.github/scripts/upstream-check.js      -> .github/scripts/upstream-check.js
```

Copy all four files. The workflow checks out the repository and requires the script at this
exact path.

These commands are safe to run again. A new repository has nine default labels. They can be
deleted, but this is optional.

When you create the repository, tell the user once that the daily workflow uses
approximately 31 billed Actions minutes per month on a private repository. This is
approximately one percent of a paid personal plan. Do not repeat this later.

## Step 2: Read the open tracking issues

Do this before each action. Every intent uses this list. Filing uses it to prevent a
duplicate.

```bash
gh issue list -R <owner>/issues --state open --limit 50 \
  --json number,title,labels,updatedAt
```

## Step 3: Identify the intent

Classify the instruction by its content. The user does not say "file", "list", or "close".

| The instruction… | Intent | Example |
|---|---|---|
| names an upstream issue or PR, or a defect in a dependency | **File** | a github url, "vitest can't reset a spy's implementation" |
| asks what is open | **Review** | "what am I waiting on?", no instruction at all |
| asks whether the upstream state changed | **Re-check** | "anything fixed?", "is that PR merged yet?" |
| asks whether a workaround is still needed or still in the code | **Verify** | "do we still need the dynalite fork?" |
| reports that the fix is adopted or the workaround is removed | **Close** | "we upgraded, the patch is gone" |

Three rules resolve most unclear cases:

- **A URL means File**, unless the store already tracks that URL. Then the intent is
  Re-check, or an update of the existing tracking issue.
- **Tense.** Present or future tense ("I need", "this is broken") means File. Past tense
  ("we removed", "that shipped") means Close.
- **A reference to an existing tracking issue.** Match loosely. "The vitest one" refers to
  the tracking issue with the title prefix `[vitest]`.

If the intent is not clear, ask one short question. A duplicate tracking issue or a wrong
close costs more than a question.

## Step 4: Act

### File a tracking issue

**Search for a duplicate first.** The upstream URL identifies the tracking issue. GitHub
search indexes the URL, so search for the full URL:

```bash
gh issue list -R <owner>/issues --state all --search "<upstream url>"
```

An open match: update that tracking issue. Do not file a second one. A closed match: the
problem returned, or this is a new instance of it. Say which one you think applies and ask.

**Read the upstream thread before you write.** Read the state, the labels, and the latest
comments, and check for a linked pull request. Use `gh issue view <url> --comments`. A
tracking issue that describes the upstream state incorrectly is worse than no tracking
issue.

**Title:** `[package] <requirement>`. The package is the installed or invoked name
(`vitest`, `@sparticuz/chromium`, `release-please`). The requirement is in the user's
terms, not the maintainer's. The title must identify the issue in a list one year later.

**Body:** use `.github/ISSUE_TEMPLATE/tracker.md` in the store. This file is the only
definition of the body format. Read the file. Do not write the format from memory. Remove
the `<!-- -->` comments when you fill in the sections:

```bash
gh api repos/<owner>/issues/contents/.github/ISSUE_TEMPLATE/tracker.md --jq .content | base64 -d
```

Rules for the content:

- **The workflow reads the Upstream section.** It reads GitHub issue and pull request links
  in this section only. Put each link that decides the outcome in this section. Put related
  links in Notes, where they do not affect the result.
- **The Affected code section makes the tracking issue checkable.** Record the absolute
  repository path, the exact `file.ts:line`, and a grep pattern that returns no results
  after the workaround is removed.
- **Write for a reader without this conversation.** Do not write "the file we just changed"
  or "as discussed". Name the file.
- **Do not invent facts.** Record an unknown version or an unclear root cause as an open
  question.
- Remove a section that has no content. A tracking issue without a workaround is valid.

**Do not set a label.** The workflow sets the `upstream:*` labels from the upstream state.
A label set by hand is not verified, and the next workflow run overwrites it.

**Confirm before you file.** Show the title and the full body. Then ask. A clear yes is
approval. A question about the wording is not approval.

```bash
gh issue create -R <owner>/issues --title "<title>" --body-file - <<'EOF'
<body>
EOF
```

**Then add a reaction upstream**, if the user asked for it or agrees:

```bash
gh api -X POST repos/<owner>/<repo>/issues/<n>/reactions -f content=+1
```

A reaction is a vote and does not notify subscribers. Do not post a "+1" comment. It
notifies every subscriber and contains no information. There is no API to subscribe to a
single issue. If the user wants upstream notifications, give them the URL. This is usually
not necessary, because the store replaces the subscription.

**Then add a reference in the affected code.** In each affected repository, add a comment
at the workaround:

```ts
/** Workaround for vitest-dev/vitest#123, tracked in zirkelc/issues#7. Remove both when the fix is adopted. */
```

Add the comment at each location listed under Affected code. Do not commit the edits. The
user commits them with their current change.

### Review

List the open tracking issues in groups. Order the groups: `upstream:fixed`, then
`upstream:moved` and `upstream:declined`, then `upstream:unreachable`, then issues without a
label. The store README defines each label. Issues without a label wait for upstream and need
no action.

Show one line per issue: number, title, label, and time since the last update. Do not list
closed tracking issues.

### Re-check

The workflow runs daily. Run it manually only when the user asks, or before you act on a
tracking issue:

```bash
gh workflow run upstream-check.yml -R <owner>/issues
```

To check one tracking issue immediately, query its links directly. For a pull request, use
the pulls endpoint. The issues endpoint does not always include the merge timestamp:

```bash
gh api repos/<owner>/<repo>/pulls/<n>  --jq '{state, merged, merged_at}'
gh api repos/<owner>/<repo>/issues/<n> --jq '{state, state_reason, closed_at}'
```

`state_reason` is `completed`, `not_planned`, `duplicate`, or null. A closed issue with a
null `state_reason` is common for older issues. Check `state` first. Use `state_reason` as
additional information.

### Verify

Compare the tracking issue with the code. For each open tracking issue, or for the issues
the user names:

1. Run the grep from the Affected code section in the repository it names.
2. **No results:** the workaround is not in the code. Either it was removed and the
   tracking issue was not closed, or the file moved. Find out which. Do not close the
   tracking issue on this result alone.
3. **Results, and upstream is fixed:** this is the work to adopt the fix. Report each
   location.
4. **Results, and upstream is open:** this is the expected state. Report it in one line.

Report outdated content. If a tracking issue names a file that does not exist, update the
issue body.

### Close

**Close a tracking issue when the workaround is removed, not when upstream merges the
fix.** The label records that upstream released the fix. The closed state records that this
project adopted it. These are two different events.

Before you close, confirm that the work is done: the dependency is upgraded, the patch is
deleted, the grep returns no results. Then add a comment and close. The comment explains the
decision to a later reader:

```bash
gh issue comment <n> -R <owner>/issues --body-file - <<'EOF'
Adopted in <version>. Removed the workaround at `src/db/client.ts:41`;
`rg 'RETRY_AROUND_5435'` now returns no results.
EOF
gh issue close <n> -R <owner>/issues
```

A tracking issue with the label `upstream:declined` can also be closed. The comment then
records the decision: fork, patch, move off the dependency, or keep the workaround
permanently.

## Step 5: Report

One or two lines.

- **Filed:** the tracking issue URL, the upstream link, and the annotated files.
- **Reviewed:** the grouped list only.
- **Re-checked:** only the changes. "Nothing changed" is a complete answer.
- **Verified:** per tracking issue: still needed, already removed, or outdated.
- **Closed:** what was adopted and what was deleted.

Do not show the issue body again after filing.

## Notes

- **The store is private. Upstream is public.** A tracking issue can name real paths and
  projects. Everything posted upstream, including a reaction, is public and permanent.
- **Related skills.** `issue` files issues in the current repository for its own bugs.
  `remind` stores local follow-ups without an upstream link. This skill is only for defects
  in software the user depends on but does not control.
- **The workflow never closes an issue.** It comments only when the result changes. A store
  without new comments means the upstream state did not change.
