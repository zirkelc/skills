---
name: vscode-extension
description: Scaffold a new VS Code extension project from the zirkelc/template-vscode-extension GitHub template. Creates the GitHub repo, clones it, updates placeholders, and opens it in VS Code.
---

# New VS Code Extension

Scaffold a new VS Code extension from the [template-vscode-extension](https://github.com/zirkelc/template-vscode-extension) template.

## Step 1: Gather Project Info

Ask the user for:
- **Identifier:** extension id / repo name, lowercase-hyphenated (e.g. `my-extension`)
- **Display name:** human-readable name shown in the marketplace (e.g. `My Extension`)
- **Description:** one-line description
- **Publisher:** VS Code marketplace publisher ID (e.g. `zirkelc`)
- **Visibility:** public or private (default: public)

## Step 2: Determine Target Directory

Check the current working directory with `pwd` and `ls`.

**Already in the project dir** — use this path if:
- The CWD name matches `<identifier>`, or
- The CWD is empty (no files) and the user confirms this is the intended project directory

In this case, create the repo without `--clone`, then clone into `.`:
```bash
gh repo create <identifier> \
  --template zirkelc/template-vscode-extension \
  --description "<description>" \
  --[public|private] \
  --gitignore ""

git clone "$(gh repo view <identifier> --json url -q .url)" .
```

**Not in the project dir** — clone into a new subdirectory. Run from `~/Developer`:
```bash
gh repo create <identifier> \
  --template zirkelc/template-vscode-extension \
  --description "<description>" \
  --[public|private] \
  --clone \
  --gitignore ""
```

If the command fails (name conflict, auth issue, etc.): stop and report the error.

The project dir is referred to as `<project-dir>` in subsequent steps (either CWD or `~/Developer/<identifier>`).

## Step 3: Update Placeholders

Read `package.json` in `<project-dir>`. Identify all placeholder values and replace them with the user's values:

| Placeholder | Replace with |
|---|---|
| `name` field (extension identifier) | `<identifier>` |
| `displayName` field | `<display name>` |
| `description` field | `<description>` |
| `publisher` field | `<publisher>` |
| Repository URLs containing the template name | updated with `<identifier>` |

Also scan `README.md` for the template title/description and replace with the extension's display name and description.

Use targeted edits — do not reformat or rewrite files beyond the placeholder substitutions.

## Step 4: Install Dependencies

```bash
cd <project-dir> && pnpm install
```

## Step 5: Open the project

On a machine with a desktop, open it with `code <project-dir>`. On a headless machine, skip this step and give the path.

Tell the user the project is ready and remind them to:
- Press **F5** in VS Code to launch the Extension Development Host and test the bundled "Hello World" command
- Run `pnpm compile` to type-check and bundle
- Update the marketplace category, keywords, and icon in `package.json` before publishing
- Run `pnpm package` to produce a `.vsix` for local install, `pnpm vsce publish` to publish
