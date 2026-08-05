---
name: issue
description: Create or update a structured GitHub issue for a bug, feature, refactoring, or task discovered while working on something else, then reference it from the code with a TODO(#1234) comment. Use when a fix or idea surfaces mid-session that will not be done now, instead of leaving a bare TODO that nobody will ever see again.
argument-hint: "[optional: a topic to file, or 'scan <path>' to triage existing TODOs]"
---

# Issue

Park a discovery where it stays visible. Work surfaces constantly while doing something unrelated: a duplicated index, a rename that never happened, a missing test. Left as a bare `// TODO`, it is invisible the moment the session ends. This skill turns it into an issue carrying the context we already have, then points the code at it.

**Raise this yourself** when something issue-worthy comes up mid-task. Don't wait to be asked, and don't quietly drop the finding into a TODO comment instead.

**Never file without explicit confirmation.** Raising a finding is your job; deciding it becomes an issue is the user's. This holds however obvious the finding looks.

## Project Override

Before anything else, check whether the repository defines its own issue skill at `.claude/skills/issue/SKILL.md` (relative to the repo root).

**If that file exists, read it and follow it instead of this one.** It replaces this flow entirely; it does not merge with it, and no step below applies. Repos have their own labels, templates, and conventions, and this generic flow knows none of them.

Do not tell the user which of the two was used.

## The bar

Most `TODO` comments must never become issues. `TODO: add a test case`, `TODO: rename this` are notes to the next person touching that file, and they're fine as they are.

Propose an issue when **at least one** holds:

- **It surfaced in this session but sits outside the current scope**, and would be dropped the moment the session ends. This is the main case: the thing worth doing that we're deliberately not doing right now.
- It affects **production behaviour, data, or cost**.
- It needs a **decision** someone has to make, not just typing.
- The context to act on it lives **outside the file** (a trace, a query, a migration, another package).
- It's **cross-cutting** and the TODO sits in only one of the places involved.

Otherwise leave the TODO alone. A wrong issue costs more attention than a missing one.

## Arguments

Optional, free-form:

- **A topic** (e.g. `the unhandled rejection in the upload handler`) → draft that one.
- **`scan <path>`** → bulk triage mode, see the last section.
- **Nothing** → the finding from the current session.

## Step 1: Gather the context

Read the code rather than working from memory. Collect:

- **What surfaced**, in one sentence.
- **Where it lives**: exact `path/to/file.ts:line` for every relevant site, not just the one with the TODO.
- **How it was found**: the PR, commit, or session. Link it where there's something to link.
- **What it costs** if left alone.
- **What's already ruled out**: approaches tried and rejected this session. This is the part that's otherwise lost.

**Assume the repo is public.** Issue bodies are world-readable and indexed. Keep out credentials, customer or account identifiers, internal hostnames, and anything pulled from a private system — describe them generically instead. Include real identifiers only after confirming the repo is private with `gh repo view --json isPrivate`.

## Step 2: Check for an existing issue

Never file a duplicate. Search open **and** closed issues first:

```bash
gh issue list --state all --limit 30 --search "<distinctive keywords>"
```

Search for the symptom and the file, not the wording you'd use. Also grep for an existing reference:

```bash
rg 'TODO\(#[0-9]+\)' <path>
```

- **A matching open issue exists** → update it. Add what's new under the existing sections, keeping what's there. Don't restate.
- **A matching closed issue exists** → say so and ask whether to reopen or file fresh. A regression and a new instance want different handling.
- **Nothing matches** → create.

## Step 3: Draft

**Title:** prefix it with the conventional-commit type the eventual fix would carry (`fix:`, `feat:`, `refactor:`, `perf:`, `test:`, `docs:`, `chore:`), then say what's wrong or wanted — specific enough to recognise in a list a year from now. Not `fix: schema` but `fix: drop the duplicate unique index on documents`.

**Body:** if the repo has templates in `.github/ISSUE_TEMPLATE/`, follow those. Otherwise:

```markdown
## Context
Where this surfaced. Link the PR, commit, or session.

## Problem
What is wrong and what it costs. Concrete.

## Proposal
The fix as far as it's currently understood. "Not yet known" is a valid answer,
and beats inventing a design nobody has thought through.

## Code references
- `src/db/schema.ts:412` (the TODO this came from)
- `src/jobs/reindex.ts:88` (related call site)

## Notes
Commands that reproduce it, and dead ends already ruled out.
```

Drop sections that would be empty rather than padding them.

**Labels:** don't pass any. `gh issue create` fails outright on a label the repo doesn't define, and guessing a taxonomy is worse than leaving it untriaged. A repo with a real label scheme should define its own issue skill.

## Step 4: Confirm

**Mandatory. Never create or edit an issue without an explicit yes.**

Print the title and full body as it will appear, then ask. Creating an issue is outward-facing and notifies watchers.

A clear "ja" / "yes, file it" is approval. A question about the wording, a comment, or silence is not. If the user asks for changes, redraft in full and ask again.

When a finding fails **The bar**, say so and recommend leaving the TODO as it is. Filing anyway is the user's call, never a default.

## Step 5: File it

```bash
gh issue create --title "<title>" --body-file - <<'EOF'
<body>
EOF
```

Updating instead:

```bash
gh issue edit <number> --body-file - <<'EOF'
<merged body>
EOF
```

Return the issue URL.

## Step 6: Reference it from the code

This is what keeps the issue findable from the place it matters. After filing, **edit the source directly**:

```ts
/** TODO(#1234): drop this index, it duplicates the implicit unique btree on … */
```

- Rewrite the originating comment in place, preserving its existing text.
- Use the same marker that was already there (`TODO`, `FIXME`).
- Add the reference at **every** site listed under Code references, not only the one that triggered the issue.
- Where no comment exists yet at a relevant site, add one.

Report the edited files. Leave them uncommitted unless asked, so the reference lands with whatever change the user is already making.

Any time you want the parked set: `rg 'TODO\(#'`.

## Scan mode

`scan <path>` triages existing TODOs in bulk. Only on explicit request.

1. `rg -n '\b(TODO|FIXME)\b' <path>` and read each hit **with its surrounding code**. A TODO is unintelligible without it.
2. Apply **The bar** to every one. Expect the large majority to fail it; that's the correct outcome, not a reason to lower the bar.
3. Present a shortlist: file, line, what it is, proposed type, one line on why it clears the bar.
4. File only what the user picks, then cross-reference as in Step 6.

Never file the whole list. Never file anything in scan mode without an explicit selection.
