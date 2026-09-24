---
name: track
description: "Track an upstream issue or pull request in a dependency or tool, by filing the context into a private issues repo: what was needed, where it bites, what the workaround costs, and a link back to the upstream thread. Also reviews what is outstanding, re-checks upstream state on demand, verifies a recorded workaround still exists in the code, and closes a tracker once the fix is adopted. Instructions are free-form with no keywords, e.g. \"track https://github.com/vitest-dev/vitest/issues/123\", \"what am I waiting on?\", \"did anything get fixed upstream?\", \"we dropped the dynalite workaround\". Use when the user hits a bug or missing feature in software they depend on and the reason they need it would otherwise be lost."
argument-hint: "e.g. an upstream issue or PR url, 'what am I waiting on?', 'anything fixed?', 'done with the vitest one'"
---

# Track

Subscribing to an upstream issue records *that* you want it. It records nothing about
**why** you wanted it or **where** you needed it, and a year later, when the fix finally
lands, that is the only part that matters. This skill files the missing half into a
private issues repository: the project that hit the limitation, the workaround that is
now sitting in the code, and the grep that will come back empty once it can be deleted.

A daily workflow in that repository resolves every upstream link and labels the tracker
when the conclusion changes, so the fix arrives as a notification rather than as
something to remember to check.

**Raise this yourself** when work is blocked or bent around a defect in a dependency and
the session is about to move on. Do not just add a `// workaround for a vitest bug`
comment and leave it: that comment cannot tell anyone when it stops being necessary.

## The instruction is free-form

There are no subcommands and no required word order. Infer what is being asked from what
the instruction describes, not from keywords it contains.

## Step 1: Resolve the store

The store is one private GitHub repository of tracking issues. Resolve it, never assume it:

```bash
gh api user --jq .login                                 # <owner>
gh repo view <owner>/issues --json name,isPrivate       # the default store
```

`<owner>/issues` is the default. An explicit repository in the instruction outranks it.

**If it exists and is private**, continue. Confirming this is what licenses everything
below: real paths, real repository names, real constraints, real reasons. Do not record
credentials or tokens even so, because an issue body is not a secret store.

**If it exists and is public**, say so and stop. The whole point of the store is that it
holds the context that cannot go upstream. Ask before writing anything into a public one.

**If it does not exist**, ask before creating it. Then:

```bash
gh repo create <owner>/issues --private \
  --description "Upstream issues and pull requests I am waiting on, and why"

gh label create "upstream:fixed"       -R <owner>/issues -c 0e8a16 -d "Upstream merged or closed as completed: adopt it and drop the workaround"
gh label create "upstream:declined"    -R <owner>/issues -c b60205 -d "Upstream closed as not planned, or PR closed unmerged: the workaround is permanent"
gh label create "upstream:moved"       -R <owner>/issues -c fbca04 -d "Upstream closed as a duplicate: re-point at the surviving issue"
gh label create "upstream:unreachable" -R <owner>/issues -c 5319e7 -d "The upstream link no longer resolves"
```

Then push the README and the workflow from this skill's `templates/` directory, which are
the store's entire contents:

```
templates/README.md                              -> README.md
templates/.github/workflows/upstream-check.yml   -> .github/workflows/upstream-check.yml
```

Re-running any of this is a no-op. Deleting the nine default labels a new repository ships
with is optional tidying, not part of the setup.

Mention the daily workflow once, when the repository is created, and not again: it costs
about 31 billed minutes a month on a private repository, roughly one percent of a paid
personal allowance.

## Step 2: Read what is already tracked

Always, before acting. Every intent except filing a brand-new tracker needs it, and filing
needs it to avoid a duplicate.

```bash
gh issue list -R <owner>/issues --state open --limit 50 \
  --json number,title,labels,updatedAt
```

## Step 3: Infer the intent

Classify by what the instruction describes. The user will not say "file", "list" or "close".

| The instruction… | Intent | Example |
|---|---|---|
| names an upstream issue or PR, or a defect in a dependency | **File** | a github url, "vitest can't reset a spy's implementation" |
| asks what is outstanding | **Review** | "what am I waiting on?", bare invocation |
| asks whether anything has moved upstream | **Re-check** | "anything fixed?", "is that PR merged yet?" |
| asks whether a workaround is still needed or still present | **Verify** | "do we still need the dynalite fork?" |
| reports the fix adopted, or the workaround removed | **Close** | "we upgraded, the patch is gone" |

Three signals settle most ambiguity:

- **A URL almost always means File**, unless the store already tracks it, in which case it
  is a Re-check or an amendment of the existing tracker.
- **Tense.** Future or present ("I need", "this is broken") files. Past ("we removed",
  "that shipped") closes.
- **Reference to something already tracked.** Match loosely: "the vitest one" should find
  the tracker whose title starts `[vitest]`.

If genuinely ambiguous, ask **one** short question. A duplicate tracker and a wrongly
closed one both cost more than asking.

## Step 4: Act

### File a new tracker

**Check for a duplicate first.** The upstream URL is the identity, and GitHub search
tokenises it, so searching the full URL works:

```bash
gh issue list -R <owner>/issues --state all --search "<upstream url>"
```

An open match means amend that one rather than filing a second. A closed match means the
problem came back, or a new instance of it: say which you think it is and ask.

**Read the upstream thread before writing.** State, labels, the last few comments, and
whether a linked PR exists. A tracker that misstates what upstream is doing is worse than
none, and `gh issue view <url> --comments` is cheap.

**Title:** `[package] what I need`, where the package is what it is called when installed
or invoked (`vitest`, `@sparticuz/chromium`, `release-please`), and the rest is the
capability in the user's terms, not the maintainer's. Specific enough to recognise in a
list a year from now.

**Body:**

```markdown
## Upstream
- https://github.com/owner/repo/issues/123

## What I need
The capability or fix, in our terms. One or two sentences.

## Where it bites
- `~/Developer/acme-api` — `src/db/client.ts:41`, the retry loop only exists because of this
- `rg 'RETRY_AROUND_5435' ~/Developer/acme-api` comes back empty once this is done

## Workaround
What happens instead today, and what it costs.

## Notes
Versions affected, alternatives already rejected, related threads.
```

Rules that matter more than the shape:

- **The Upstream section is machine-read.** The workflow resolves every GitHub issue or PR
  link in that section and nowhere else. Put every link that would settle the question
  there, and keep merely related threads in Notes so they do not vote.
- **Where it bites is the whole point.** Absolute repository paths, exact `file.ts:line`,
  and a grep pattern that returns nothing once the workaround is gone. This is what makes
  the tracker checkable later instead of merely readable.
- **Write it to be read cold.** The future session cannot see this conversation. No "the
  file we just changed", no "as discussed". Name it.
- **No invented facts.** An unknown version or an unclear root cause goes in as an open
  question, never as a guess.
- Drop a section rather than padding it. A tracker with no workaround yet is fine.

**Never pass a label.** The `upstream:*` labels are derived from upstream state by the
workflow. Setting one by hand states a conclusion that nothing verified, and the next run
will overwrite it anyway.

**Confirm before filing.** Print the title and the full body as it will appear, then ask.
A clear yes is approval; a question about the wording is not.

```bash
gh issue create -R <owner>/issues --title "<title>" --body-file - <<'EOF'
<body>
EOF
```

**Then vote upstream**, if the user asked for it or agrees:

```bash
gh api -X POST repos/<owner>/<repo>/issues/<n>/reactions -f content=+1
```

A reaction is the one upstream signal that is both useful and silent. Do not post a "+1"
comment: it notifies every subscriber and says nothing. Per-issue subscription has no API,
so if the user wants the upstream notification too, give them the URL to click. Usually
they do not need it, since this store is what replaces it.

**Finally, anchor it in the code.** In the repository that is actually affected, put the
tracker where the workaround is:

```ts
/** Workaround for vitest-dev/vitest#123, tracked in zirkelc/issues#7. Drop both when it lands. */
```

Add it at every site listed under *Where it bites*, and leave the edits uncommitted so they
land with whatever change the user is already making.

### Review

Show what is outstanding, grouped by what it asks of the user, because that is the
interesting half:

1. `upstream:fixed` — ready to adopt
2. `upstream:declined` and `upstream:moved` — need a decision
3. `upstream:unreachable` — need a look
4. unlabelled — still waiting, nothing to do

One line each: number, title, label, how long since it moved. Do not list closed trackers;
"what am I waiting on" is not a question about finished work.

### Re-check

The workflow already does this daily. Run it early only when asked, or when a tracker is
about to be acted on:

```bash
gh workflow run upstream-check.yml -R <owner>/issues
```

To answer about one tracker without waiting, resolve its links directly. A pull request is
authoritative only via the pulls endpoint, since the issues endpoint does not guarantee the
merged timestamp is present:

```bash
gh api repos/<owner>/<repo>/pulls/<n>  --jq '{state, merged, merged_at}'
gh api repos/<owner>/<repo>/issues/<n> --jq '{state, state_reason, closed_at}'
```

`state_reason` is `completed`, `not_planned`, `duplicate`, or null. **Null on a closed
issue is common and legitimate** for older issues, so branch on `state` first and treat the
reason as extra colour.

### Verify

Check the tracker against reality rather than against its own text. For each open tracker,
or the ones asked about:

1. Run the grep recorded under *Where it bites* in the repository it names.
2. **No hits** — the workaround is already gone. Either it was removed without closing the
   tracker, or the path moved. Find out which; do not close on the grep alone.
3. **Hits, and upstream is fixed** — this is the adoption work. Report the exact sites.
4. **Hits, and upstream is still open** — correct and expected. Say nothing beyond a line.

Report drift: a tracker naming a file that no longer exists is stale, and correcting its
body is worth more than the check that found it.

### Close

**A tracker closes when the workaround is gone, not when upstream merged.** The label says
upstream shipped; the close says we adopted it. Collapsing the two throws away the reminder
the store exists to hold.

Before closing, confirm the work is real: the dependency upgraded, the patch deleted, the
grep now empty. Then log it, because the closing comment is what explains the decision to
whoever finds the issue later:

```bash
gh issue comment <n> -R <owner>/issues --body-file - <<'EOF'
Adopted in <version>. Removed the workaround at `src/db/client.ts:41`;
`rg 'RETRY_AROUND_5435'` is now empty.
EOF
gh issue close <n> -R <owner>/issues
```

Closing a tracker upstream **declined** is also valid, and the log says what was decided
instead: forked, patched, moved off the dependency, or accepted permanently.

## Step 5: Report

One or two lines, no ceremony.

- **Filed** — the tracker URL, the upstream link, and which files were annotated.
- **Reviewed** — the grouped list, nothing else.
- **Re-checked** — only what changed. "Nothing moved" is a complete answer.
- **Verified** — per tracker: still needed, already gone, or stale.
- **Closed** — what was adopted and what was deleted.

Do not paste the issue body back after filing. The user approved it a moment ago.

## Notes

- **The store is private; upstream is not.** Everything written into a tracker may name
  real paths and real projects. Anything posted upstream, including a reaction, is public
  and permanent.
- **Neighbouring skills.** `issue` files against the repository being worked on, for our
  own bugs. `remind` handles local follow-ups with no upstream thread. This one is only for
  a defect in software we depend on but do not control.
- **The workflow never closes anything**, and it comments only when its conclusion changes,
  so a quiet repository means nothing moved rather than that it stopped running.
