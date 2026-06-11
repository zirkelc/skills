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

### Git

- **commit** — Create a git commit with an auto-generated conventional commit message. Optionally push to remote.

  ```bash
  npx skills add zirkelc/skills/commit
  ```

- **pr** — Create a GitHub Pull Request against the default base branch, summarizing all changes on the current branch.

  ```bash
  npx skills add zirkelc/skills/pr
  ```

### Sessions

- **handoff** — Hand off the current session to a fresh agent. Writes a self-contained markdown document (task, context, errors, reproduction, snippets, next steps) so a new agent can continue the work, often in another repo.

  ```bash
  npx skills add zirkelc/skills/handoff
  ```

- **copy** — Copy your latest message, or a specific part of it (a command, code block, quote, or snippet), to the clipboard exactly as authored, avoiding the indentation and line-break artifacts of manual terminal selection.

  ```bash
  npx skills add zirkelc/skills/copy
  ```

### GitHub

- **release-please** — Merge an open Release Please PR for a repo to cut a release, then monitor the release workflow and report the published version.

  ```bash
  npx skills add zirkelc/skills/release-please
  ```

- **repo-logo** — Generate a logo and social banner for a GitHub repo, iterate on the design, then optionally add the logo to the README and set the banner as the repo's social preview.

  ```bash
  npx skills add zirkelc/skills/repo-logo
  ```

### Meta

- **sync-skills** — Symlink every skill in this repo into `~/.claude/skills` so edits are live globally. Classifies each target as new / already-linked / content-update / conflict, applies safe changes silently, and asks before replacing a skill from a different location.

  ```bash
  npx skills add zirkelc/skills/sync-skills
  ```

### Scaffolding

- **typescript-package** — Scaffold a new TypeScript package from the [template-single-typescript](https://github.com/zirkelc/template-single-typescript) template.

  ```bash
  npx skills add zirkelc/skills/typescript-package
  ```

- **vscode-extension** — Scaffold a new VS Code extension from the [template-vscode-extension](https://github.com/zirkelc/template-vscode-extension) template.

  ```bash
  npx skills add zirkelc/skills/vscode-extension
  ```
