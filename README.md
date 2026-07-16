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

## Skills

Each skill is tagged with how it can be invoked: **auto** — Claude may trigger it from a matching request; **slash-only** — runs only when you invoke it explicitly (e.g. `/copy`), because it carries `disable-model-invocation: true`.

### Git

- **commit** `invocable: auto` — Create a git commit with an auto-generated conventional commit message. Optionally push to remote.

  ```bash
  npx skills add zirkelc/skills/commit
  ```

- **pr** `invocable: auto` — Create a GitHub Pull Request against the default base branch, summarizing all changes on the current branch.

  ```bash
  npx skills add zirkelc/skills/pr
  ```

### Sessions

- **handoff** `invocable: slash-only` — Hand off the current session to a fresh agent. Writes a self-contained markdown document (task, context, errors, reproduction, snippets, next steps) so a new agent can continue the work, often in another repo.

  ```bash
  npx skills add zirkelc/skills/handoff
  ```

- **copy** `invocable: slash-only` — Copy your latest message, or a specific part of it (a command, code block, quote, or snippet), to the clipboard exactly as authored, avoiding the indentation and line-break artifacts of manual terminal selection.

  ```bash
  npx skills add zirkelc/skills/copy
  ```

### GitHub

- **release-please** `invocable: slash-only` — Merge an open Release Please PR for a repo to cut a release, then monitor the release workflow and report the published version.

  ```bash
  npx skills add zirkelc/skills/release-please
  ```

- **repo-logo** `invocable: auto` — Generate a logo and social banner for a GitHub repo, iterate on the design, then optionally add the logo to the README and set the banner as the repo's social preview.

  ```bash
  npx skills add zirkelc/skills/repo-logo
  ```

- **repo-readme** `invocable: auto` — Write or rewrite the README for a TypeScript/npm library, following a fixed structure (centered header, Why?, Installation, Usage, Advanced, API, Types, License). Derives the Usage and API sections from the package's actual exports.

  ```bash
  npx skills add zirkelc/skills/repo-readme
  ```

### Meta

- **sync-skills** `invocable: slash-only` — Symlink every skill in this repo into `~/.claude/skills` so edits are live globally. Classifies each target as new / already-linked / content-update / conflict, applies safe changes silently, and asks before replacing a skill from a different location.

  ```bash
  npx skills add zirkelc/skills/sync-skills
  ```

### Scaffolding

- **typescript-package** `invocable: auto` — Scaffold a new TypeScript package from the [template-single-typescript](https://github.com/zirkelc/template-single-typescript) template.

  ```bash
  npx skills add zirkelc/skills/typescript-package
  ```

- **vscode-extension** `invocable: auto` — Scaffold a new VS Code extension from the [template-vscode-extension](https://github.com/zirkelc/template-vscode-extension) template.

  ```bash
  npx skills add zirkelc/skills/vscode-extension
  ```
