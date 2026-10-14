---
name: create-claude-code-mod
description: Build a new Claude Code mod (a live pane or panel, a band above the prompt, a status line, a toast, a slash command, or a hook on tool calls or prompts). Uses the official mods as examples for architecture, UI and tests, and adds lessons learned from building real mods. Use when the user wants to create a new Claude Code mod.
disable-model-invocation: true
argument-hint: "what the mod must do, e.g. 'a pane that lists the open PRs of this repo'"
---

# New Claude Code Mod

Build a new Claude Code mod: $ARGUMENTS

If the arguments do not describe the mod, ask the user what the mod must do before you continue.

## Step 1: Load the plugin-authoring skill

Load the `plugin-authoring` skill first. It is the reference for the mod format, the hooks module and the UI surfaces. Follow it where this skill does not say otherwise.

## Step 2: Study the existing mods

Use the existing mods as examples for architecture, UI and tests:

- https://github.com/anthropics/claude-code/tree/main/mods
- https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods

Find the mod that is nearest to the new one (same UI surface, same hook events) and copy its structure. The examples can be older than the running build. When an example and the generated type file disagree, the type file is correct.

## Step 3: Build the mod

Build the mod and apply these lessons. They were found on build 2.1.296. If the type file of the running build says something different, follow the type file.

### Module structure (the validator forces it)

- Only the hooks module touches `$`. The validator follows `$` only into top-level functions of the same file. It refuses `$` that crosses an import, and `$` itself assigned to a variable, stored or spread (`const engine = $`). A closure that only uses `$` in its body is allowed. Build a `Host` object of closures in the hooks module and give it to the other modules:
  ```ts
  function hostOf($: EngineInterface): Host {
    return {
      run: (argv, init) => $.process.run(argv, init),
      after: (ms, fn) => $.clock.after(ms, fn),
      home: () => $.env.get('HOME'),
      readStatus: () => read($, status),
      updateStatus: (change) => update($, status, change),
    }
  }
  ```
- Define each `atom(...)` in the hooks module. Write its `plugin` and `key` as string literals, inline or in a local `as const` ref object. A string variable, an imported constant and an atom from another module are refused.
- Write the name given to `$.env.get` inline as a string literal. Even a local const is refused.
- Hook matchers can use constants, also imported ones. `claude plugin validate` then shows `?` in place of the value.
- The validator accepts unknown matcher fields without a warning, and the hook then never runs. For example, the `ui.press` matcher field is `element`, not `key`.
- An atom's `plugin` must be the `name` in `plugin.json`. When you rename the plugin, rename every atom and the `PluginState` key too.
- Views are pure functions: `view(ui, actions, model)`, where `ui` is a typed subset of the element table (`Pick<ElementTable<'terminal' | 'desktop'>, 'Box' | 'Text' | 'Button'>`) and `actions` are closures made in the hooks module. On a surface you did not type (for example `mobile`, which has no `Input`), return `next(e)` or a short note.
- `setTimeout` runs, but it has no type and the test kit's clock cannot control it. Use `$.clock.after` and `$.clock.every`. A `$` captured in `session.start` stays valid for timers and later work.

### Reloads and stored state

- A hot reload runs `register` and `session.start` again. It cancels the `$.clock` timers of the old module, but open panes and `$.state` stay. In `session.start`, close the pane ids of earlier versions and set your "pane is open" flags from `$.ui.panes()`. Put a `.catch` on each of these calls, so one failure cannot stop the start.
- Stored values can have an older shape. `$.state` survives reloads and `$.store` survives sessions. Check the shape each time you read a stored value and fall back to a default.
- Work from a press or a timer has no caller. Wrap it so that it never rejects, and send failures to `$.ui.log`. Put the background work of a session on one promise queue, so that runs do not overlap.

### Engine behaviour

- A band must compose with other bands. In an `AbovePrompt` hook, call `const below = await next(e)`. Return `below` when you have nothing to draw, and else a column of your band above `below`. The engine's own drawing holds only surveys: return `next(e)` when `e.props.hasSurvey` is true, and draw your band alone when `below` is null or `below.type === 'engine'`. If you do not do this, you hide the bands of other mods. The official example bands do not do this.
- A pane opened from a command or a press hook counts as the person's open, also after other awaits, if the hook awaits `$.ui.open` before it returns. An open from a timer or from detached work (`void (async () => ...)()`) counts as unasked and waits undrawn below 144 columns. If `isPlaced` is false, draw the same view in the band.
- A `$` call in a Button `onPress` closure skips the mod's own hooks (for example its `ui.close` and `tool.check` hooks). Do work that must pass your own hooks from a `ui.press` hook (match `e.plugin` and `e.element`), or do the hook's work in the closure too.
- Esc can step back one view: in a `ui.close` hook for your pane, when `e.origin.kind === 'person'` and a sub-view is open, change the view and return `{ deny: 'back one view' }`.
- A `command.run` hook that only opens or closes UI returns `{}`. Command output is stored as `<plugin>: <text>`, so `{ text: '' }` writes an empty `<plugin>: ` line.
- `$.ui.status` is always drawn as `⚠ <plugin>: <text>` in the warning color. Use it only for a problem and clear it with `undefined`. Do not add your own name or `⚠`. Older mods used it for information.
- The engine adds `<plugin>: ` in front of the message of a failed `$` call. Remove it before you show the message in your own UI.
- `$.fs.read` refuses files over 4 MiB, and session transcripts are often larger. The stdout of `$.process.run` has the same limit. Read large files with `$.process.spawn({ argv: ['cat', path] })` and join the stdout chunks.
- A plugin root loaded through a symlink (`--plugin-dir`, a dev folder) is the link path. Get the real path with `$.fs.stat(root, { resolve: true })` before you build paths next to it.
- A hook has a 10 s budget. `$.clock.sleep` counts against it, but waits in other `$` calls do not. `next.signal` aborts at the budget, at an interrupt, or when a hook above settles.
- `session.end` has one 1.5 s bound for all hooks and the engine together, and here waits in `$` calls count against it. Read `next.budget.remainingMs` before each step, give child processes that time minus a margin, and skip work that does not fit. A killed process can leave lock files behind.
- A gating hook (for example on `tool.call` or `tool.check`) that throws or runs past its budget lets the action go on. Add `.catch(($, e, next) => (next.called ? next(e) : { deny: '...' }))` to it. `claude plugin validate` only prints a note when the `.catch` is missing.
- Every hook also sees the events of subagents, with `e.agentId` set. Filter hooks that are only for the main conversation with `e.agentId === undefined`.
- A `required: true` field in `userConfig` without a value stops the module from loading, in tests too. Code for the "not set" case cannot run.
- `classic.SubagentStop` also fires for internal agents whose transcript file does not exist. Check with `$.fs.exists` before you read `agent_transcript_path`.

### Prompts, context and agents

- `prompt.context` blocks also reach subagents. For text that only the main conversation must get, use `prompt.context` as a trigger and add a hidden row with `$.session.append` (stored as `isMeta`).
- Do not add messages in the result of `session.compact`. They are stored as a prompt the person typed. Add them after `next(e)` with `$.clock.after(0, ...)`, and skip `e.agentId !== undefined` and `e.trigger === 'precompute'`. A message that a hook builds needs `toolUses: []`, or the hook is skipped for the wrong shape.
- Detect text you injected with a unique marker (for example an HTML comment), not with a sentence of the content. Do the check and the append in one serialized chain, so concurrent events cannot add two copies.
- A guard can skip a user-tier mod. When the machine has any managed settings file, or on a Team or Enterprise plan, the built-in guard `cc-plugin-sec-default` bypasses user-tier hooks on `classic.*`, `prompt.context` and the other prompt-building events, `session.compact`, `session.append`, `settings.read`, `tool.describe`, `tool.check`, `agent.offer`, `agent.spawn` and more. The debug log shows `bypassed by cc-plugin-sec-default`. `prompt.submit` is not on that list, so give important text a second path through its `context`.
- In auto mode, the mod's own `$.agent.spawn` is denied ("classifier gave no verdict"), because no model response asked for it. A `tool.check` hook on `Agent` that returns `{ decision: 'allow' }` when `next.origin.plugin === $.plugin.name` and the `subagent_type` is the mod's own lets it run. No approval prompt appears, so keep the condition that narrow and tell the user that the mod adds this allow.
- The report of a subagent that the mod spawns is delivered to the main conversation and starts a main model turn.
- A registered tool is deferred by default, but the main model sees its name and can load it through ToolSearch. To keep the main model off it, deny it in its `tool.call` hook when `e.agentId` is not your agent's. Hide your agent type with `agent.offer` (`{ isOffered: false }`). Limit the agent with an exact `tools` list, `disallowedTools` and `omitClaudeMd: true`.
- `turn.complete` fires once per turn. For a subagent, its `answer` is the final report: match it by `e.agentId`. `turn.step` fires once per model request, and its `answer` can be empty. Do not poll `$.agent.list()` and `$.session.messages` for the answer: the status can stop before the last message is stored.

### Terminal UI

- `Input` has one line only and Enter submits. There is no multi-line option. `onInput` races `onSubmit`, so make `onInput` return its promise and let `onSubmit` wait for it.
- A `Button` has no text color. `variant="primary"` draws the accent color on every surface. For another color on the terminal, put a `plain` Button in a `Box paddingX={1} backgroundColor="..."`.
- The hit area of a Button is only its label. Put the padding spaces inside the label (`` label={` ${x} `} ``). A padding Box does not make it larger. To make a full row clickable, use several `plain` Buttons with one `hover` scope. `hover` is refused outside a keyed `Box` unless it names a `scope`.
- Small element limits: `plain` with `hotkey` draws `1: label`; an `Input` label gets a colon; the mouse cannot pick `Select` options (use a row of toggle Buttons); Markdown links show as `text (url)`; arrow keys reach a pane only through a `Client`.
- Yoga shrinks every cell in a row, and a squeezed `Text` wraps to more lines. Give fixed cells `flexShrink={0}` or a `width`. Give the one elastic cell `width={0} flexGrow={1} overflow="hidden"` and its `Text` `wrap="truncate-end"`. Keep each list row to one line, or row counts and alignment break.
- To keep a footer at the bottom of a docked pane (`e.props.placement === 'dock'`), fill the list with empty rows up to `e.props.scroll.bodyRows`.
- A render tree deeper than 32 levels or with more than 20,000 nodes is refused. Text past 100,000 characters is cut. For long lists, draw only the visible rows, hook `ui.scroll` on your pane, apply `e.by` to your own window and return `{}`.
- The tree refuses control characters in text. Remove them from all external text: `/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g` (tab, newline and carriage return are allowed).
- A pane opened with `holdToasts` also hides your own toasts. Show errors and status in the pane.

### Tests (`claude plugin test`)

- The kit answers nothing by default. Every event your hooks pass to `next(e)` and every `$` call needs an answer beneath the plugin (`session.start`, `command.register`, `ui.open`, `fs.*`, `process.run`, `store.*`, `ui.render`). Write one `world(on, options)` fixture that answers all of them, keeps files and the store in Maps, scripts process output and records each side effect for the asserts.
- Register every `on(...)` of a test before its first `$` call. Each event can be registered once per test, unless the matchers differ. A loop over surfaces in one test is fine.
- Mounts and commands need their full input: a Pane mount needs `title`, `isFocused`, `bodyColumns`, `placement`, `scroll` and `view`; `$.command.run` needs `origin` and `presentation`; `$.session.end` needs `resume`. Put these in typed fixtures.
- Fake `ui.open` with `{ value: { isPlaced: true } }` (or false) before you mount a pane, and `unmount()` before you mount it again on the same surface. A band that calls `next(e)` needs a `ui.render` answer beneath it, such as `() => ({ type: 'engine', ref: 0 })`.
- Type a hook taken from a matcher as `MatchedHook<'ui.render', { component: 'AbovePrompt' }>`, not `Hook<'ui.render'>`.
- Clock: `settle()` runs queued work without moving time. `advance(ms)` fires timers. Read the mocked time before the act.
- Kit gaps: no `$.ui.close` from the person (Esc), `hover` is on the tree node and not in `props`, `$.ui.press` needs a render first, `$.ui.input` takes `text`. Check what the kit cannot show live.
- Test views through the engine, so its tree validation runs: register a `ui.render` hook on a test-only `requestId` that returns your view, then render it.
- Give elements stable, prefixed keys (`row-<id>`, `pin-<id>`), so tests can press and find them. Put keys on `Box`, `Button` and `Input`: a key on `Text` is dropped.
- The kit does not run the auto-mode classifier or the guard. For those paths, write integration tests that run a real session: `claude -p --output-format json --plugin-dir <root> --debug-file <file>` with `--setting-sources project,local --strict-mcp-config`, and assert on the transcript and the debug log. `claude -p "/<command>"` runs a mod command without a model call. With more than one `--plugin-dir`, the first one is the outer hook.

### Packaging and release

- `.claude-plugin/types/` is generated when an interactive session loads the mod (not under `claude -p`), together with a root `tsconfig.json` that extends it when the mod has none. Add the types folder to `.gitignore`. Because the folder is missing on a fresh checkout, `tsc` cannot run in CI or a pre-commit hook unless you commit a copy of the types. Gate on `claude plugin validate` and `claude plugin test`.
- CI: install the native CLI (`curl -fsSL https://claude.ai/install.sh | bash`, add `$HOME/.local/bin` to `PATH`) and run `claude plugin validate .` and `claude plugin test .`. No login is needed.
- Installed copies update only when the `version` in `plugin.json` changes. Add a CI job that fails when shipped files changed after the last version change.
- Do not load a dev copy and an installed copy of the same mod at the same time. Both run every hook. Disable the installed copy while you develop.
- A mod can live in a subfolder of a larger repo: the root `plugin.json` names `hooks` and `types` by relative path, and the subfolder's `tsconfig.json` extends the generated config at the plugin root.
- For a public directory listing: every `$.process.run`, `$.command.run` and `$.prompt.submit` call causes a policy review, so add a "What it can access" section to the README, built from the call list that `claude plugin validate` prints. Nothing in the plugin folder may load remote resources. Mods need Claude Code 2.1.287 or later, and `plugin.json` has no field for a minimum version, so state it in the README.
