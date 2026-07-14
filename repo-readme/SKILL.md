---
name: repo-readme
description: Write or rewrite the README for a TypeScript/npm library, following a fixed house structure (centered header, Why?, Installation, Usage, Advanced, API, Types, License). Derives Usage and API sections from the package's actual exports. Use when the user wants to write, rewrite, restructure, or review a README for a library or package.
argument-hint: "[optional: path to the package, defaults to the current working directory]"
---

# Write a Library README

Write a README for a TypeScript/npm library that reads like documentation, not marketing.

The README is the **only** doc most users will read. It must carry: what the library is, why it exists, how to install it, how to use it (progressively), where the sharp edges are, and the full API. In that order.

## Step 1: Read the Package

Never write a section you have not verified against the source. Before writing anything:

1. **`package.json`** — name, `description` (this becomes the tagline), `exports` map (each subpath is likely a Usage section), `peerDependencies` (drives the version-compatibility note), `devDependencies` (test framework, bundler).
2. **Every entry point in `exports`** — read the actual exported functions, classes, types, and their signatures. The API section is generated from these, so it must be exhaustive and exact.
3. **Tests** (`src/**/*.test.ts`, `test/`) — the best source of realistic, working examples. Lift the domain from here rather than inventing one.
4. **The existing README**, if any, plus `CHANGELOG.md` — to catch deprecations, version splits, and prior phrasing worth keeping.
5. **`assets/`** — check for `logo-light.png` / `logo-dark.png`.

If the package wraps or extends another library (an SDK, a framework), read enough of that library to link its primitives correctly. Every foreign concept you name gets a link to its docs.

## Step 2: Structure

Emit exactly this skeleton. Sections marked optional are dropped when they don't apply; the rest are mandatory and always in this order.

```
<div align="center"> logo · tagline · badges </div>
<intro paragraph>          — un-headed, directly below the header
## Why?
## Installation
## How It Works            — optional
## Usage
## Advanced                — optional
## API
## Types                   — optional
## License
```

Use `##` for every top-level section and `###` for everything nested inside them, including individual API entries. (The source packages drift between `##` and `###` here; normalize to this.)

No table of contents. No emoji. No "Features" checklist. No badge wall. No contributing section, roadmap, or acknowledgements. Their absence is the style.

### Header

Always emit the centered block, with `assets/logo-light.png` / `assets/logo-dark.png` referenced whether or not they exist yet (the `repo-logo` skill can generate them afterwards). See `TEMPLATE.md` for the exact markup.

Exactly two badges: npm total downloads and CI status. The tagline is a single line under 10 words and should match `package.json`'s `description`; if they differ, fix the weaker one.

### Intro paragraph

One paragraph, no heading, immediately below the header. It states what the library is and which surface it operates on, and links every foreign primitive it names:

> This library provides composable filter and transformation utilities for the event streams produced by [`createStream()`](https://example.com/docs/create-stream) in Framework.

### `## Why?`

The problem, before the solution. Two to four bullets, each opening with a **bold lead-in** naming the pain, then a concrete description of it. Close with a single bridging sentence starting "This library …".

```markdown
Framework sends every event to the client by default. However, you may want to:

- **Filter**: Some events carry large payloads or sensitive fields that should never reach the client
- **Transform**: Rewrite an event's contents while it is still in flight
- **Observe**: Log lifecycle events or run side-effects without modifying the stream

This library provides type-safe, composable utilities for all these use cases.
```

If the pain is architectural rather than a list of wants, write it as short bolded paragraphs instead (`**Resume is hard** because the server doesn't track what's been sent…`). Same job: make the reader recognize their own problem.

### `## Installation`

If the package tracks another library's major version, open with a version-compatibility `NOTE` callout, then an install block whose lines are commented with which version they target:

````markdown
> [!NOTE]
> Version compatibility:
>
> - Use [`pkg@1.x`](https://github.com/owner/pkg/tree/v1.x) for Framework v6
> - Use [`pkg@2.x`](https://github.com/owner/pkg/tree/v2.x) for Framework v7

```bash
npm install pkg@1 # Framework v6
npm install pkg@2 # Framework v7
```
````

Otherwise just the install command. Name peer dependencies in one line below it (`` `framework` and `vitest` are peer dependencies. ``).

### `## How It Works` (optional)

Only when the library has real runtime moving parts a diagram clarifies — multiple processes, a broker, a lifecycle across requests. A mermaid `sequenceDiagram` is the right tool. A single-process transform library does not need this; skip it rather than padding.

### `## Usage`

The bulk of the README. Ordering is progressive:

1. **The minimal happy path first.** One code block under 25 lines that a reader can copy, paste, and run. It shows the whole loop: import, construct, call, use the result.
2. **Then one `###` section per concept**, ordered so each builds on the last. Simple/static before dynamic before conditional. If the package has multiple entry points, they usually map one-to-one onto these sections.
3. **Then the sections that describe the rules**: defaults, precedence, ordering, mutability. These get their own headings (`### Defaults`, `### Last-Call Wins`) because ambiguity about *which rule wins* is what actually confuses users.

Every section is: 1-3 sentences of prose → exactly one code block → optionally one callout. Not more.

### `## Advanced` (optional)

Edge cases, escape hatches, telemetry, performance notes, and honest limitations. Anything a user hits on day 30 rather than day 1.

### `## API`

A mechanical mirror of the Usage ordering, generated from the exports you read in Step 1. Exhaustive: every public export gets an entry. Each entry is:

- a `###` heading with the name in backticks and its parameter shape — `` ### `createClient(options)` ``
- a `ts` block with the type signature
- prose: what it returns, what defaults apply, what rule governs it
- a short example

For builder-heavy APIs, a denser form works well — signature, then example calls as comments showing the literal output:

````markdown
```ts
Build.text(text: string): TextPart
// Build.text('Hi'): { type: 'text', text: 'Hi' }
```
````

### `## Types` (optional)

Only for type-heavy packages that export types users must name (inference helpers, option bags, discriminated unions). One `###` entry per exported type, with the shape inline as a comment.

### `## License`

One line: the license name. Nothing else.

## Step 3: Writing Rules

These are what actually make the difference. Apply them throughout.

**Teach in the code comments, not in paragraphs.** The load-bearing explanation belongs inside the snippet, at the line it explains. Prose sets up; code explains.

```typescript
const client = createClient({ handlers })
  // context: enable the export handler only for authenticated users
  .enableWhen('export', ({ context }) => context?.isAuthenticated)
  // history: disable the search handler once it has already run this turn
  .disableWhen('search', ({ history }) => history?.some((h) => h.name === 'search'));
```

**State defaults explicitly.** Every option that has a default says so, in words, where it's introduced: "`maxAttempts` defaults to `1`", "All handlers are enabled by default", "By default the mock reports a `stop` status".

**State precedence explicitly** when more than one thing can set the same value. A numbered list beats a paragraph:

```markdown
**Precedence** for the upcoming attempt (highest to lowest):

1. The value returned from `onRetry`
2. The `options` set on the retry entry
3. The original options from the request
```

**Be honest about limitations, loudly.** A README that talks the reader out of a feature earns trust. Use `> [!IMPORTANT]` and say what does not work and what to do instead:

```markdown
> [!IMPORTANT]
> **Streaming limitation:** retries only apply before the first chunk is emitted. Once the stream begins
> delivering content, the response is committed. If reliable retries are critical for your use case,
> consider using the non-streaming call instead.
```

**Callouts have fixed roles.** `[!NOTE]` for version compatibility, caveats, and "this requires vX". `[!TIP]` for a nice-to-know that isn't required. `[!IMPORTANT]` for footguns that will cost the reader an afternoon. `[!WARNING]` for deprecations and things that will break.

**Tables only for enumerable facts** — option lists, entry-point maps, condition helpers, telemetry attributes, deprecated→replacement mappings. Never for explanation; the explanation goes in the prose around the table.

**One running domain per README.** Pick one (orders and search, weather, chat) and reuse it in every example so they compound instead of resetting. Lift it from the tests.

**Document deprecations in place, with a mapping table.** Don't delete the old API from the docs; show the one-line equivalent for each old entry and link a `MIGRATION.md` if the change is large.

**Link every foreign primitive** to its docs, every time it's introduced in a new section. Cross-link within the README by anchor (`see [Streaming](#streaming)`) rather than repeating yourself.

**Match the package's own code style** in every snippet: quotes, semicolons, `Array<T>` vs `T[]`. Read a source file and copy it. Snippets must typecheck against the real API — no invented options, no invented method names.

## Step 4: Review

Before presenting, check the draft against this list:

- [ ] Tagline matches `package.json`'s `description`, and is under 10 words
- [ ] Intro paragraph names the surface and links every foreign primitive
- [ ] `Why?` describes pain the reader recognizes, not features
- [ ] The first Usage code block is copy-pasteable and under 25 lines
- [ ] Every code block uses the same domain, and would typecheck against the real exports
- [ ] Every default is stated; every precedence rule is stated
- [ ] Every public export from every entry point appears in `API`
- [ ] Known limitations are documented, not omitted
- [ ] Heading levels are `##` for sections, `###` for everything nested
- [ ] No TOC, no emoji, no Features list, no marketing

Then show the user the finished README and a short list of anything you could not verify from the source (a guessed default, an unclear limitation) so they can correct it.

## Reference

`TEMPLATE.md` in this skill's directory holds the exact markup for the header block and a skeleton of every section.
