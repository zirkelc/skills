# Skills

My personal directory of skills, straight from my `.claude` directory.

## Install all

```bash
npx skills add zirkelc/skills
```

## Use globally (symlink)

Symlink every skill in this repo into `~/.claude/skills` so edits here are live everywhere. Run the **sync-skills** skill — it inspects existing global skills, refreshes same-skill copies silently, and asks before replacing anything from a different location. Skills not in this repo are left untouched.

```
/sync-skills
```

## Project overrides

**commit**, **pr**, and **issue** stand down for the project they run in. If the repo defines its own skill of the same name under `.claude/skills/<name>/SKILL.md`, that file is read and followed instead — it replaces the personal flow entirely rather than merging with it, so a repo copy needs to be self-contained. Everywhere else, the versions here apply as written.

This matters because personal skills otherwise shadow project ones of the same name, which silently makes a repo's own `commit`/`pr` unreachable.

## Skills

Each skill is tagged with how it can be invoked:

- `invocable: auto` — Claude may trigger it from a matching request
- `invocable: slash-only` — runs only when you invoke it explicitly (e.g. `/handoff`), because it carries `disable-model-invocation: true`.

### Git

A pair: after committing, **commit** hands any open PR to **pr** to refresh its description, so PR bodies have a single owner.

- **commit** — Create a git commit with an auto-generated conventional commit message, then optionally push, sync the description of any PR already open for the branch, and report drift from the default branch.
  - `invocable: auto`

  ```bash
  npx skills add zirkelc/skills/commit
  ```

- **pr** — Create a GitHub Pull Request against the default base branch, or refresh the description of the branch's existing one, summarizing all changes on the current branch. Run it again after more commits to bring the description back in sync.
  - `invocable: auto`

  ```bash
  npx skills add zirkelc/skills/pr
  ```

### Sessions

- **handoff** — Hand off the current session to a fresh agent. Writes a self-contained markdown document (task, context, errors, reproduction, snippets, next steps) so a new agent can continue the work, often in another repo.
  - `invocable: slash-only`

  ```bash
  npx skills add zirkelc/skills/handoff
  ```

### GitHub

- **issue** — Turn a finding that surfaced mid-session into a structured GitHub issue, then reference it from the code with a `TODO(#1234)` comment. Applies a bar so most TODOs stay TODOs, and never files without confirmation.
  - `invocable: auto`

  ```bash
  npx skills add zirkelc/skills/issue
  ```

- **release-please** — Merge an open Release Please PR for a repo to cut a release, then monitor the release workflow and report the published version.
  - `invocable: slash-only`

  ```bash
  npx skills add zirkelc/skills/release-please
  ```

- **repo-logo** — Generate a logo and social banner for a GitHub repo, iterate on the design, then optionally add the logo to the README and set the banner as the repo's social preview.
  - `invocable: auto`

  ```bash
  npx skills add zirkelc/skills/repo-logo
  ```

- **repo-readme** — Write or rewrite the README for a TypeScript/npm library, following a fixed structure (centered header, Why?, Installation, Usage, Advanced, API, Types, License). Derives the Usage and API sections from the package's actual exports.
  - `invocable: auto`

  ```bash
  npx skills add zirkelc/skills/repo-readme
  ```

### Meta

- **sync-skills** — Symlink every skill in this repo into `~/.claude/skills` so edits are live globally. Classifies each target as new / already-linked / content-update / conflict, applies safe changes silently, and asks before replacing a skill from a different location.
  - `invocable: slash-only`

  ```bash
  npx skills add zirkelc/skills/sync-skills
  ```

### Scaffolding

- **typescript-package** — Scaffold a new TypeScript package from the [template-single-typescript](https://github.com/zirkelc/template-single-typescript) template.
  - `invocable: auto`

  ```bash
  npx skills add zirkelc/skills/typescript-package
  ```

- **vscode-extension** — Scaffold a new VS Code extension from the [template-vscode-extension](https://github.com/zirkelc/template-vscode-extension) template.
  - `invocable: auto`

  ```bash
  npx skills add zirkelc/skills/vscode-extension
  ```
