---
name: sync-skills
disable-model-invocation: true
description: Symlink every skill in this repo into the global Claude skills directory (~/.claude/skills) so edits in the repo are live everywhere. Inspects existing global skills first, classifies each as new / already-linked / content-update / conflict, silently applies safe changes, and asks before replacing a skill that comes from a different location or source. Use when the user wants to "sync skills", "link skills globally", or "make my repo skills available everywhere".
argument-hint: "[optional: 'dry-run' to preview without changing, or a path to the global skills dir]"
---

# Sync Skills Globally

Make every skill in this repository available globally by symlinking it into the global Claude skills directory. Be careful: never silently destroy a skill that came from a different source. Refresh same-skill content without bothering the user; **ask first** before replacing anything that points to another location.

## Argument Hint

- **No argument** → sync into the default global dir.
- **`dry-run` / `check` / `preview`** → report the planned actions and conflicts, but make no changes.
- **A path** → use that as the global skills dir instead of the default.

## Step 1: Resolve Source and Target

- **Source repo**: the repository that contains *this* skill. Resolve it from this skill's real location (follow symlinks), then take its parent — that is the skills repo root:
  ```bash
  SKILL_REAL="$(readlink -f "<this skill's directory>")"   # e.g. /Users/.../Developer/skills/sync-skills
  SOURCE_REPO="$(dirname "$SKILL_REAL")"
  ```
  Use the "Base directory for this skill" path from the invocation as `<this skill's directory>`.
- **Global dir**: `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/skills` (or the path passed as an argument). Create it with `mkdir -p` if missing.

## Step 2: Enumerate Repo Skills

List every immediate subdirectory of `SOURCE_REPO` that contains a `SKILL.md`. Each is a skill named after its folder. Ignore the repo root and any folder without a `SKILL.md`.

## Step 3: Classify Each Skill

For each repo skill `N`, look at the global target `GLOBAL_DIR/N` and classify it. Determine the target's real path with `readlink`, and when comparing identity read the `name:` field from the relevant `SKILL.md`.

| Target state | Classification | Action |
|---|---|---|
| Does not exist | **NEW** | Link (safe) |
| Symlink already pointing to `SOURCE_REPO/N` | **LINKED** | Skip (already correct) |
| Symlink pointing to a **different** path | **CONFLICT (other location)** | Ask first |
| Real directory whose `SKILL.md` `name:` **matches** `N` | **UPDATE** (same skill, different copy) | Relink (safe) |
| Real directory whose `name:` differs, or has no `SKILL.md` | **CONFLICT (different skill)** | Ask first |

Notes:
- **NEW** and **UPDATE** are "safe": they either add a skill or replace an older copy of the *same* skill with a live link. Apply these without prompting.
- A symlink that points anywhere other than this repo is "another location" by definition (e.g. a separately managed store) — always treat as a conflict, even if the skill name matches.
- Also flag **DANGLING**: a symlink into `SOURCE_REPO` whose target no longer exists (the skill was renamed/removed). Offer to clean it up.

## Step 4: Report the Plan

Print a concise table/list grouped by classification, e.g.:

```
NEW:      handoff
UPDATE:   commit, typescript-package   (replacing older copies of the same skill)
LINKED:   pr                           (already up to date)
CONFLICT: foo  -> currently a symlink to ../../.agents/skills/foo (other location)
          bar  -> real dir, SKILL.md name "baz" (different skill)
```

If the argument was `dry-run`, stop here. Do not modify anything.

## Step 5: Resolve Conflicts

If there are any conflicts, ask the user before touching them. Present each conflict with what is there now and what it would become, and let them choose per skill (or all). Use the AskUserQuestion tool with options like **Replace with repo link** / **Keep existing**. Never replace a conflicting entry without explicit confirmation.

Skills classified NEW or UPDATE do **not** need confirmation — proceed with them regardless of the conflict answers.

## Step 6: Apply

For each skill being linked (all NEW + UPDATE, plus any CONFLICT the user approved):

1. Remove the existing target:
   - Symlink → `rm "$GLOBAL_DIR/N"` (removes only the link).
   - Real directory → move it out of the way safely: `trash "$GLOBAL_DIR/N"` (never `rm -rf`). It lands in the Trash, recoverable.
2. Create the link: `ln -s "$SOURCE_REPO/N" "$GLOBAL_DIR/N"`.

For approved **DANGLING** cleanups, just `rm` the stale symlink.

Leave every global skill that is **not** in this repo untouched.

## Step 7: Print Summary

Report what changed:
- Newly linked skills
- Updated (relinked) skills, noting the old copy went to Trash
- Skills left as-is (already linked, or conflict the user chose to keep)
- The global dir path

Re-running this skill should be a no-op when everything is already linked.
