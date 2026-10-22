---
name: terminal-demo
description: Record terminal demos with vhs, as an MP4 video, a GIF or PNG screenshots, in a way that can be run again with one command. Covers plain CLIs, full-screen TUIs and live Claude Code sessions, including a plugin's pane or mod. Use this skill whenever the user wants a terminal screenshot, a screen recording or GIF of a CLI, media for a tweet, a README image of terminal output, or wants to redo or update earlier recordings, even if they do not name vhs.
argument-hint: "[what to record] [in <path> | in project] [theme <name> | colors <key>=#hex ...] [font <family> [size]] [window [title <text>]] [light and dark]"
---

# Terminal demo

Record a terminal with [vhs](https://github.com/charmbracelet/vhs): a `.tape` file types keys into a headless terminal and writes a video and screenshots. Nothing touches the user's own terminal or windows, so it does not matter what the user does meanwhile.

The goal is a recording that the next person can make again with one command. So the tapes, the launch script and the demo data are kept in a folder that lasts, and every run starts from the same state.

## Arguments

All arguments are optional, free text, in any order. Read them from the request, take the default for anything not given, and say which defaults you took.

- **What to record** (default: ask, unless the conversation makes it clear): the program, the steps, and the outputs (a video, one screenshot per state).
- **Location** of the demo folder:
  - **temp** (default): a new folder from `mktemp -d "${TMPDIR:-/tmp}/terminal-demo.XXXXXX"`. Good for a one-off. The system can clear it, so at the end tell the user where it is and offer to move it.
  - **a path** ("in ~/demos/my-cli"): use that folder, and create it if needed.
  - **project** ("in the project", "in the repo"): `demo/` at the root of the current git repository (`git rev-parse --show-toplevel`), so the demo is versioned with the code. Suggest an ignore entry for `demo/out/` and do not commit unless the user asks.
  - If the folder already holds a demo (a `README.md` and a `record.sh`), reuse it and change only what the request needs.
- **Theme** (default: `graphite-dark`, and `graphite-light` for the light version): a preset name from [`themes/`](themes/), any of the 300+ names that `vhs themes` lists, or explicit colors. If the user cannot decide, record samples to choose from. See [Theme and font](#theme-and-font).
- **Font** (default: the theme's font, else `JetBrains Mono, Menlo, monospace`) and **size** (default 16).
- **Window** (default: none): a window frame with a title bar and rounded corners around the terminal, so it looks like a real terminal window, optionally with a title. See [Window frame](#window-frame).
- **Light and dark** (default: one version; for a README image, offer both): a dark version on GitHub's dark page and a light version on its light page, which the README shows by the reader's theme. See [Light and dark versions](#light-and-dark-versions).
- **Output folder** (default: `out/` in the demo folder). Never overwrite earlier media without asking. Write to a new folder or new file names instead.

## Before you start

Check the tools. Install what is missing only after the user says so:

```sh
command -v vhs ttyd ffmpeg python3
```

Settle the size with the user, or take the default: 1800×1000 at font size 16 fits a README and a tweet. A small card (for example a command to copy) is 1200×520 at font size 26.

## Set up a demo folder that lasts

Make one folder per demo. If the project already has one, use it and its tapes, and change only what the request needs. Read `README.md` in the folder first, if there is one.

```
<demo>/
├── README.md          # what the demo shows, and the commands to record it again
├── fixture/           # the demo data: a sample repository, sample files
├── launch.sh          # starts the program under test in a clean environment
├── reset.sh           # puts the fixture back to its start
├── record.sh          # runs every tape and the post-processing: the one command for next time
├── settings.tape      # the shared Set lines: size, font, theme
├── <name>.tape        # one tape per recording
└── out/               # what the tapes write, unless the user names another folder
```

- **Demo data, not real data.** A recording is published. Never record the user's own files, history, tokens, real hostnames or real paths, if a demo value can replace them. Build a fixture with believable sample content. Before you deliver, look at every screenshot for personal data.
- **Lines that fit.** Keep each line that the demo prints from the fixture shorter than the terminal width, with the prefix that the command adds (for example a file name from `grep`). A line that breaks in two looks like a fault. Shorten the sample text rather than add a command that cuts the output.
- **`launch.sh`** starts the program with a fixed working directory and a clean environment (`env -i HOME=... PATH=... TERM=...`), so the user's shell profile, aliases and settings do not leak into the frames. Give the program its own config directory (for example with `XDG_CONFIG_HOME`).
- **`reset.sh`** removes what the last take added (prefer moving it to the trash, for example with `trash`, over deleting it) and restores the fixture, for example with `git checkout -- .`. Each tape that changes the fixture runs `reset.sh` first, in the hidden part.
- **`record.sh`** runs `reset.sh`, the tapes in order and the video post-processing, and puts global state back with a `trap ... EXIT`. The next recording is then `./record.sh`.
- **`settings.tape`** holds the `Set` lines, and each tape includes it with `Source settings.tape`. Make it with `scripts/settings.py` (see below), so a change of theme or size is one command.

Write absolute paths into the tapes, or run vhs from the demo folder. vhs resolves `Output`, `Screenshot` and `Source` paths from its working directory.

## Theme and font

`scripts/settings.py` prints the `Set` lines for size, font and theme. Write them to the demo folder:

```sh
python3 scripts/settings.py > <demo>/settings.tape                     # graphite-dark, the default
python3 scripts/settings.py --theme graphite-light > <demo>/settings-light.tape
python3 scripts/settings.py --theme ghostty > <demo>/settings.tape
python3 scripts/settings.py --theme "Dracula" --font "Fira Code, monospace" --font-size 18 > <demo>/settings.tape
python3 scripts/settings.py --theme neutral --color background=#000000 --color blue=#5fafff > <demo>/settings.tape
python3 scripts/settings.py --width 1200 --height 520 --font-size 26 > <demo>/settings.tape
```

Presets in [`themes/`](themes/):

| Name | Look |
| --- | --- |
| `graphite-dark` | strong colors on dark grey `#262626`, based on the Atom colors. The default, and the dark version of a README image. The background is the one of a Claude Code plugin pane in its dark theme, so a pane and the terminal have one color. |
| `graphite-light` | dark colors on light grey `#eeeeee`, based on the Atom One Light colors. The light version of a README image, and the pane background of Claude Code's light theme. |
| `neutral` | dark grey with the soft colors of Catppuccin Mocha. |
| `ghostty` | the default colors and font of Ghostty |
| `terminal-app` | macOS Terminal, profile "Basic" (light) |
| `terminal-app-pro` | macOS Terminal, profile "Pro" (dark) |

Any other name goes to vhs as a built-in theme ([list](https://github.com/charmbracelet/vhs/blob/main/THEMES.md), or `vhs themes`), for example `Dracula`, `GitHub Dark`, `Catppuccin Mocha` or `Builtin Solarized Light`. The script matches the name without regard to case, and refuses a name that vhs does not know. `--color KEY=#hex` changes one color (`background`, `foreground`, `cursor`, `selection`, `black` to `white`, `brightBlack` to `brightWhite`). It works on presets and on vhs themes: vhs does not print the colors of its themes, but the script reads them from the vhs program, where they are stored as JSON text. To keep a custom theme, save it as a new JSON file in `themes/`.

Match the background to the program. When the program draws its own panes or panels with a background color (for example a Claude Code plugin pane), give the terminal the same background with `--color background=#...`, so the frame has one color. Take the color from a probe screenshot (for example `ffmpeg -i shot.png -vf crop=1:1:X:Y -f rawvideo -pix_fmt rgb24 - | xxd -p`). In a light terminal, also switch the program to its light theme, if it has one: a program that sets its own colors keeps its dark colors otherwise, and they look wrong on a light background.

**Let the user pick.** `scripts/theme-samples.sh <out-dir> [theme ...]` records one short sample per theme (the 16 colors and some text) and puts them on sheets of 12. With no theme, it records all vhs themes, about 350, in a few minutes. Open the folder for the user (`open -a Preview <out-dir>/*.png` on macOS), and give them the list that it prints for each sheet.

If the user names a terminal or a shell instead of a theme ("like my zsh", "like iTerm"), the colors come from the terminal, not from the shell. Ask which terminal, or take the closest preset and say so.

`--font` takes a CSS font list. vhs draws with fonts installed on the machine and silently takes the next name in the list when one is missing, so look at the first screenshot. Programs that draw icons (for example a prompt theme or Claude Code's spinner) need a font with those glyphs, such as a Nerd Font.

## Window frame

There are two ways to put the terminal into a window. vhs's own frame is quick, but has no title. `scripts/frame.sh` draws a window with a title after the take.

### With a title: frame.sh

Record the take with no window (the default of `settings.py`), then frame each output:

```sh
scripts/frame.sh out/demo.mp4 out/demo-dark.gif dark "my-cli"            # GIF, dark page, dark title bar
scripts/frame.sh out/demo.mp4 out/demo-dark.mp4 dark "my-cli"            # the same as MP4
scripts/frame.sh out/result.png out/result-light.png light "my-cli" light  # PNG, light page, light title bar
```

- The arguments are the input (an MP4 or a PNG), the output (`.mp4`, `.gif` or `.png`), the page (`dark` is GitHub's `#0d1117`, `light` is `#ffffff`), the title, and the title bar (`dark` by default, or `light` for a light theme).
- The window has a macOS title bar of 40 pixels with three buttons and the title, rounded corners, a thin border, and a margin of 24 pixels in the page color. The image has no visible edge on the GitHub page.
- `frame.sh` draws the frame from `frame.html` with headless Chrome (on macOS from `/Applications`, elsewhere `google-chrome` or `chromium`, or set `CHROME`), and ffmpeg puts the take under it.
- Ask the user for the title, or take the name of the program or the folder.

### Without a title: vhs

vhs can draw a window around the terminal: a title bar with three buttons, rounded corners, and a margin around it in a color or an image.

```sh
python3 scripts/settings.py --window macos > <demo>/settings.tape
python3 scripts/settings.py --window rings --margin 60 --margin-fill "#1e293b" > <demo>/settings.tape
python3 scripts/settings.py --window macos --margin-fill wallpaper.png > <demo>/settings.tape
```

- `--window`: `macos` (red, yellow and green buttons), `macos-right`, `rings` (outlined buttons), `rings-right` or `none`.
- `--margin` (default 40 with a window), `--margin-fill` (a color or an image path, default `#6b7280`) and `--radius` (default 10 with a window).
- `--width` and `--height` stay the size of the terminal. The script adds the margin and the bar, so the terminal has the same columns and rows with and without a window. This matters for a program whose layout depends on the width, for example a pane that opens only in a wide terminal.
- The bar has no title text. vhs has no setting for it. Use `frame.sh` for a title.

A window suits a README, a tweet, a slide or a landing page. On a page with a background (a README), use `frame.sh` with the page color, so that only the window shows.

## Light and dark versions

For a README, make one version for GitHub's dark page and one for its light page, and let the README pick:

1. Record the takes twice, once with `graphite-dark` and once with `graphite-light` (a separate settings file each, for example `./record.sh graphite-dark` and `./record.sh graphite-light`). If the program has its own theme, switch it to light for the light take.
2. Frame the dark take on the dark page and the light take on the light page: `frame.sh ... dark "<title>"` and `frame.sh ... light "<title>" light`.
3. Name the files `<name>-dark.gif` and `<name>-light.gif`, and show them with a `<picture>`:

```html
<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/demo-dark.gif" />
  <img src="assets/demo-light.gif" alt="What the demo shows, in one sentence" />
</picture>
```

A live take differs each time, so the two versions show different model output. If they must show the same content, record one take and frame it on both pages instead.

## Write the tape

A tape has a hidden part (setup) and a shown part (what the viewer sees):

```
Output out/demo.mp4
Source settings.tape

Hide
Type "clear && ./reset.sh && ./launch.sh"
Enter
Wait+Screen@30s /some text that shows the program is ready/
Show

Type "the command the viewer should see"
Sleep 500ms
Enter
Wait+Screen@120s /text that shows the result is there/
Sleep 2s
Screenshot out/result.png
Sleep 1s
```

Rules that came from failed takes:

- **Wait on the screen, not on the clock.** `Wait+Screen@<timeout> /regex/` waits until the text is on the screen. A fixed `Sleep` is too short on a slow run and wastes time on a fast one. Use `Sleep` only for the pauses the viewer should see.
- **End with a `Sleep` after the last `Screenshot`.** Without it, vhs can stop before it writes the file.
- **Start the program in `Hide`, after a `clear`.** The viewer then does not see the launch command or the start-up noise. When vhs sizes the terminal at the start, zsh can print a `%` mark. The `clear` removes it.
- **Keys go to whatever has the focus.** In a TUI with panes or dialogs, a key can land in the wrong place. Never trust a count of `Tab` presses until you have seen the frames.
- **One state per screenshot.** If you need several states from one program run, take them in order in one tape. That is faster and keeps them consistent.

## Check every take

vhs reports success even when the keys did nothing. So look at the result before you go on:

1. Read each screenshot with the Read tool.
2. For a video, make a contact sheet and read it: `scripts/contact-sheet.sh out/demo.mp4 out/sheet.png` puts one frame per second in a grid, five per row, and gives the time of each frame (drawn on it, or printed when the ffmpeg build has no `drawtext`). Add a start, an end and a frame rate to look closer at one part, and a crop (`w:h:x:y`) to zoom into a pane.
3. Fix the tape and record again. Compare with the frames you looked at, not with what you expected.

Probe tapes are fine. Keep them in `out/` or a temporary folder, and trash them at the end.

## Finish the video

- **Speed up the waiting.** `scripts/speedup.sh in.mp4 out.mp4 <from> <to> <factor>` plays the part between two seconds faster and keeps the rest at normal speed. Take the times from the contact sheet.
- **Make it play everywhere.** The script writes H.264, `yuv420p` and `+faststart`, which X, GitHub and Slack accept. A video for X must be under 2:20 minutes.
- **Make a GIF for a README.** GitHub shows an MP4 in a README only when it is uploaded through the web editor, but it shows a GIF anywhere. `frame.sh` writes a GIF with a window. For one with no window: `ffmpeg -i in.mp4 -vf "fps=12,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle" out.gif`. At 12 frames per second, a 40-second take of a 1600-pixel terminal is about 3 MB.

## Deliver

1. Copy the final files to the folder the user named, with clear names.
2. Update the demo folder's `README.md`: what each tape records, how to run it (`./record.sh`), what it costs (time, and model usage for a live agent), and the key order you found in the frames.
3. Tell the user about anything that is not demo data in the frames (for example a home directory path), and about any state outside the demo folder that the demo changes.
4. Open the output folder for the user (`open <folder>` on macOS) and list the files with one line on each.

## Recording Claude Code

A live Claude Code session needs more: an isolated profile, the plugin under test, the trust dialog, the focus of a pane and a wait for the model. Read [`references/claude-code.md`](references/claude-code.md) before you write a tape that starts `claude`.
