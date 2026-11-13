---
name: typescript-package
description: Scaffold a new TypeScript package project from the zirkelc/template-typescript-package GitHub template. Creates the GitHub repo, clones it, updates placeholders, and opens it in VS Code.
---

# New TypeScript Package

Scaffold a new TypeScript package from the [template-typescript-package](https://github.com/zirkelc/template-typescript-package) template.

## Step 1: Gather Project Info

Ask the user for:
- **Name:** npm package name (e.g. `my-package`)
- **Description:** one-line description
- **Visibility:** public or private (default: public)

## Step 2: Determine Target Directory

Check the current working directory with `pwd` and `ls`.

**Already in the project dir** — use this path if:
- The CWD name matches `<name>`, or
- The CWD is empty (no files) and the user confirms this is the intended project directory

In this case, create the repo without `--clone`, then clone into `.`:
```bash
gh repo create <name> \
  --template zirkelc/template-typescript-package \
  --description "<description>" \
  --[public|private] \
  --gitignore ""

git clone "$(gh repo view <name> --json url -q .url)" .
```

**Not in the project dir** — clone into a new subdirectory. Run from `~/Developer`:
```bash
gh repo create <name> \
  --template zirkelc/template-typescript-package \
  --description "<description>" \
  --[public|private] \
  --clone \
  --gitignore ""
```

If the command fails (name conflict, auth issue, etc.): stop and report the error.

The project dir is referred to as `<project-dir>` in subsequent steps (either CWD or `~/Developer/<name>`).

## Step 3: Update Placeholders

Read `package.json` in `<project-dir>`. Identify all placeholder values (typically `template-typescript-package`, `zirkelc`, generic description strings) and replace them with the user's values:

| Placeholder | Replace with |
|---|---|
| `template-typescript-package` | `<name>` |
| Package `description` field | `<description>` |
| Repository URLs containing `template-typescript-package` | updated with `<name>` |

Also scan `README.md` for the template title/description and replace with the project's name and description.

Use targeted edits — do not reformat or rewrite files beyond the placeholder substitutions.

## Step 4: Install Dependencies

```bash
cd <project-dir> && pnpm install
```

## Step 5: Open the project

On a machine with a desktop, open it with `code <project-dir>`. On a headless machine, skip this step and give the path.

Tell the user the project is ready and remind them to:
- Review `.github/workflows/` for any remaining TODO items (e.g. npm publish setup)
- Run `pnpm build` and `pnpm test` to verify the setup
