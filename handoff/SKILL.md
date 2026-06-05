---
name: handoff
description: Hand off the current Claude Code session to a fresh agent. Writes a self-contained markdown handoff document capturing the task, context, errors, reproduction, code snippets, and next steps, so a new agent (often in a different repo) can continue the work. Use when the user wants to "hand off", "transfer", or "continue this in another project/session".
argument-hint: "[optional: target directory and/or focus hint, e.g. '../some-lib fix the parser bug']"
---

# Session Handoff

Produce a single, self-contained markdown document that lets a **fresh agent with no memory of this conversation** pick up and continue the current work, typically in a different directory or repository (e.g. a cloned dependency where the actual fix will happen).

## Argument Hint

If the user passed an argument, it may contain:

- **A target directory** — where to save the handoff document (absolute or `~`-relative path). If present, save there instead of the OS temp dir.
- **A focus hint** — what the handoff is about or where the work continues (e.g. `fix the parser bug`, `continue in the cloned repo`). Use it to bias what context you emphasize.
- **Both** — e.g. `~/Developer/oss/some-lib fix the date parser`.

If no argument is provided, save to the OS temp directory (see Step 4) and infer the focus from the conversation.

## Step 1: Identify the Work to Hand Off

Review the current conversation and determine the unit of work being transferred. Capture:

- **The goal** — what the user is ultimately trying to achieve, in one or two sentences.
- **Why a handoff** — e.g. the bug lives in a dependency that must be fixed in its own cloned repo, the work outgrew the current session, etc.
- **Current state** — what has already been figured out, decided, or ruled out in this session.

Do not invent details. Only include what was actually established in the conversation or what you can verify from the codebase. If something important is unknown, list it explicitly under "Open Questions" rather than guessing.

## Step 2: Gather Concrete Context

Collect the artifacts a fresh agent will need. Pull these from the conversation and, where useful, re-read files to quote them accurately:

- **Error messages / stack traces** — verbatim, in fenced code blocks.
- **Reproduction** — exact steps or a minimal snippet that triggers the problem, plus expected vs. actual behavior.
- **Relevant code** — quote the key snippets with their `file_path:line` references. Prefer precise references over pasting large blocks; quote only what matters.
- **Root-cause analysis** — any diagnosis already reached this session (this is often the most valuable part of the handoff).
- **Requirements / acceptance criteria** — what "done" looks like, constraints, and any user preferences stated this session.
- **Environment** — relevant versions, package manager, branch, or commands, only if they matter to the task.

## Step 3: Determine the Continuation Target

Figure out **where** the work continues so the new agent knows its starting point:

- If the work moves to another repo (e.g. a cloned dependency), state the expected path. If you can locate it, verify it exists. If it is not cloned yet, note that cloning is the first step and include the repo URL if known.
- Suggest the first concrete actions (e.g. create a branch, write a failing test first, then fix).

## Step 4: Resolve the Output Path

- If the user's argument included a target directory, use it. Expand `~` and create the directory if needed (`mkdir -p`).
- Otherwise, use the OS temp directory: `${TMPDIR:-/tmp}` (resolve it with a shell command rather than hardcoding).
- Build a descriptive, unique filename: `handoff-<short-slug>-<timestamp>.md`, where `<short-slug>` is derived from the task and `<timestamp>` comes from `date -u +%Y%m%dT%H%M%SZ`.

## Step 5: Write the Handoff Document

Write the file using this structure. Omit any section that genuinely has no content rather than padding it.

```markdown
# Handoff: <concise task title>

> Generated <UTC timestamp> from a Claude Code session. Self-contained: read top to bottom, no prior context assumed.

## Goal
<What the user is trying to achieve, and why this is being handed off.>

## Continue Here
- **Target:** <directory / repo where the work continues, and whether it is already cloned>
- **First steps:** <e.g. clone repo, create branch `fix/...`, reproduce, write failing test>

## Current State
<What is already known, decided, or ruled out. The diagnosis so far.>

## Root Cause / Analysis
<The diagnosis reached this session, if any.>

## Reproduction
<Exact steps or minimal snippet. Expected vs. actual behavior.>

## Errors
```<lang>
<verbatim error / stack trace>
```

## Relevant Code
<Key snippets with `file_path:line` references and short explanations.>

## Requirements / Acceptance Criteria
<What "done" looks like; constraints; user preferences stated this session.>

## Environment
<Versions, package manager, branch, commands — only if relevant.>

## Open Questions
<Anything unknown the next agent must resolve. Be honest about gaps.>
```

Write self-contained prose: the new agent cannot see this conversation, so avoid references like "as discussed above" or "the file we edited."

## Step 6: Print Summary

Tell the user:
- The absolute path to the handoff document.
- A one-line summary of what it covers.
- A ready-to-use line to start the fresh agent, e.g.:
  > Continue in `<target dir>`, then point a new session at the handoff: `claude "Read <path> and continue the work."`
