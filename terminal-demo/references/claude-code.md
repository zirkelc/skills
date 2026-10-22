# Recording Claude Code with vhs

## Best isolation: a demo home

The strongest isolation is a separate home folder for the demo: Claude Code and the shell in the tape both run with `HOME` set to it. Then `~/...` paths in the frames are demo paths (for example `~/notes`), nothing of the real home shows, and nothing in it changes, not even global state such as `~/.claude.json`. Build the home fresh from a fixture in `reset.sh`:

- **Login.** On macOS, Claude Code reads its login from the login keychain, which it finds through `~/Library/Keychains`. Link that folder into the demo home (`ln -s "$HOME/Library/Keychains" "$DEMO_HOME/Library/Keychains"`). On Linux, link `~/.claude/.credentials.json` instead. Without it, the session says "Not logged in".
- **`~/.claude.json`.** Write one with `hasCompletedOnboarding`, `lastOnboardingVersion` and `lastReleaseNotesSeen` (set to `claude --version`), the trust of the working directory (`"projects": { "<dir>": { "hasTrustDialogAccepted": true } }`), and the counters of the notices that a fresh home shows, as seen. In 2.1.308 these were: `autoPermissionsNotificationCount`, `hasSeenAutoModeEntryWarning`, `hasSeenAutoDefaultNotice`, `announcementImpressions` (the launch promos by id), `promoStartupSeenCount`, `passesUpsellSeenCount` with `passesLastSeenRemaining`, `fullscreenUpsellSeenCount`, `effortCalloutV2Dismissed` and `numStartups`. Probe the start screen with a screenshot and compare the user's own `~/.claude.json` for the key of any notice that is left (read only the key names, never the account data).
- **Claude Code's theme.** Set `"theme": "dark"` in the demo's `~/.claude.json` for a dark terminal theme and `"theme": "light"` for a light one. Claude Code draws its own colors, so with the wrong theme its text looks wrong on the terminal background. A simple way: `reset.sh` takes the theme from the name of the settings file (for example light for a name that ends in `-light`).
- **Background.** In 2.1.308, a plugin pane has the background `#262626` in the dark theme and `#eeeeee` in the light theme. The `atom` and `atom-light` presets use these colors, so the pane and the terminal have one color. Check the color on a probe screenshot after an update.
- **`~/.claude/settings.json`.** Put the demo's settings there, for example `"tui": "fullscreen"` (a plugin pane beside the chat), `"skipAutoPermissionPrompt": true` and `"promptSuggestionEnabled": false` (no ghost text in the prompt).
- **The shell.** In the hidden part of the tape, run `reset.sh` with the real `HOME` (it needs it for the links), then `export HOME=<demo home>`, then start `launch.sh`. After Claude Code exits, `cd ~/...` in the shown part goes to the demo home.
- On macOS, `/tmp` is `/private/tmp`. Use the physical path (`cd "$DEMO_HOME" && pwd -P`) for `HOME`, so Claude Code and the shell agree on `~`.

The rest of this file describes a lighter isolation in the real home, for when a demo home is not possible.

## Launch an isolated session

The recording must not show the user's own settings, plugins, MCP servers, CLAUDE.md or memory, and it must load the plugin under test from a local folder. A `launch.sh` that does this:

```sh
#!/bin/sh
DEMO=$(cd "$(dirname "$0")" && pwd)
cd "$DEMO/fixture/sample-repo" || exit 1
clear
exec env -i HOME="$HOME" USER="$USER" LOGNAME="$LOGNAME" PATH="$PATH" TERM="$TERM" \
  LANG=en_US.UTF-8 SHELL=/bin/zsh TMPDIR="$TMPDIR" \
  XDG_CONFIG_HOME="$DEMO/.config" \
  CLAUDE_CODE_DISABLE_CLAUDE_MDS=1 CLAUDE_CODE_DISABLE_AUTO_MEMORY=1 \
  CLAUDE_CODE_NO_FLICKER=1 DISABLE_AUTOUPDATER=1 \
  claude --plugin-dir /path/to/plugin/checkout \
    --setting-sources project,local --strict-mcp-config \
    --permission-mode auto \
    --allowedTools "Edit(/$DEMO/fixture/**)" \
    "$@"
```

- `--setting-sources project,local` leaves out `~/.claude/settings.json`, and with it the user's enabled plugins, hooks and status line.
- `--strict-mcp-config` with no `--mcp-config` loads no MCP servers.
- `--plugin-dir` loads the plugin from a checkout, so the recording shows the version in that checkout, not the installed one.
- `--permission-mode auto` with a narrow `--allowedTools` keeps permission prompts out of the frames. Use `acceptEdits` if auto mode is not available.
- `XDG_CONFIG_HOME` gives tools that read `~/.config` (such as the plugin's own CLI) a demo config. Put demo values there for anything personal, for example a demo host name and user name.
- `CLAUDE_CODE_NO_FLICKER=1` turns on the fullscreen renderer. Without it, a plugin pane does not open beside the chat. The user's own settings may turn it on, but the demo does not load them.
- `DISABLE_AUTOUPDATER=1` keeps the "Auto-update failed" notice out of the footer.
- The login (the Claude account) still comes from the user's keychain, so a live take costs model usage on the user's account.

## State that the isolation does not cover

Some of Claude Code's state is global and is read by every session, also by the demo session: `~/.claude.json` (for example the saved width of plugin panes, `pluginPanes.dockColumns`) and a plugin's store under `~/.claude/plugins/store/` (for example a pane's saved choices). A demo that changes such a value changes it for the user's own sessions too.

- Change global state only when a frame needs it. Say so to the user before the first take.
- Save the old value first, and put it back with a `trap ... EXIT` in the script that runs the tapes, because vhs can end the session before `launch.sh` reaches its own clean-up.
- After the last take, check that the value is back, and tell the user what the demo touched.

`"$@"` passes extra arguments, for example `--resume <session-id>`.

## Live take or resumed session

- **Live take.** The tape types a prompt and the model works on it. It shows real work, but every take costs model usage, takes one to several minutes, and gives a different result each time. Record two or three takes and let the user pick.
- **Resumed session.** `launch.sh --resume <session-id>` opens a finished session again, with no model call. Use it for still screenshots of a state that a live take reached once. The session id is in the transcript or in what the take wrote.

## First start in a folder

The first time Claude Code starts in a folder, it asks whether to trust it. Run one probe tape that answers it (for example `Down`, `Enter`), and check with a screenshot. After that, the folder is trusted and later takes start straight in the prompt.

## Wait for Claude Code

- **Ready:** wait for the prompt box, for example `Wait+Screen@60s /auto mode on|accept edits on/`. The text of the footer depends on the version and the permission mode, so take it from a probe screenshot.
- **Done:** wait for text that only shows when the turn has ended. Good choices are the footer line that shows the time of the finished turn (for example `/done .*(AM|PM)/`) or a line that the task itself writes. Use a long timeout (`@400s`), because the model's time varies.
- After the wait, add `Sleep 2s` to `Sleep 3s`, so the last lines are drawn before the screenshot.

## Ghost text in the prompt

After a turn, Claude Code can show a suggested next prompt in grey in the prompt line (for example "commit this"), and at the start it can show text from the user's history. Look at the prompt line in every screenshot. Take the screenshot before the suggestion appears, or press `Esc` or type into the prompt and clear it, if the suggestion is not wanted in the frame.

## Panes and focus

A plugin pane (for example one opened by a slash command) has its own focus.

- `Ctrl+X` then `Tab` moves the focus from the prompt to the next focus area. If the footer shows another focus target (for example `← 1 agent` for a background agent), the first `Ctrl+X Tab` can land there, and a second one reaches the pane. The number depends on the session, so check it with a screenshot after each press in a probe tape.
- Inside the pane, `Tab` moves between buttons and rows, and `Enter` presses the one with the focus. Write the order of the controls down in the demo README once you have seen it in the frames.
- `Esc` goes back in the pane, and from the top level it closes the pane.
- A pane that opens next to the conversation needs a wide terminal. 1800 pixels at font size 16 is wide enough. If the pane does not show, make the terminal wider before you change anything else.

## Speed up the model's work

In a live take, most of the time goes to the model. Find the start and the end of the waiting on a contact sheet and speed that part up 4 to 8 times with `scripts/speedup.sh`. Keep the typing of the prompt and the final result at normal speed.
