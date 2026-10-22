#!/usr/bin/env python3
"""Prints the Set lines of a vhs tape: size, font and theme. Write the output to settings.tape and Source it from each tape.

  settings.py [--theme NAME] [--color KEY=#HEX ...] [--font FAMILY] [--font-size N]
              [--width PX] [--height PX] [--padding PX] [--typing-speed DURATION] [--shell SHELL]
              [--window macos|macos-right|rings|rings-right|none] [--margin PX] [--margin-fill COLOR|IMAGE]
              [--radius PX]

--theme takes a preset from the themes folder next to this script (neutral, ghostty,
terminal-app, terminal-app-pro), or any name that `vhs themes` lists, such as "Dracula".
--color changes one color of the theme (background, foreground, cursor, selection, black,
red, ..., brightWhite). It needs a preset, because vhs does not print its own themes.
--font is a CSS font list, so later names are fallbacks: "Fira Code, Menlo, monospace".
--window draws a window frame with a title bar around the terminal. --width and --height stay the
size of the terminal: the margin and the bar are added to them.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

THEMES = Path(__file__).resolve().parent.parent / "themes"
WINDOW_BARS = {"macos": "Colorful", "macos-right": "ColorfulRight", "rings": "Rings", "rings-right": "RingsRight"}
WINDOW_BAR_SIZE = 40
KEYS = [
    "background", "foreground", "cursor", "selection",
    "black", "red", "green", "yellow", "blue", "magenta", "cyan", "white",
    "brightBlack", "brightRed", "brightGreen", "brightYellow",
    "brightBlue", "brightMagenta", "brightCyan", "brightWhite",
]


def presets() -> list[str]:
    return sorted(path.stem for path in THEMES.glob("*.json"))


def vhs_themes() -> list[str] | None:
    if not shutil.which("vhs"):
        return None
    listed = subprocess.run(["vhs", "themes"], capture_output=True, text=True)
    # vhs prints the list on stderr.
    return [line.strip() for line in (listed.stdout + listed.stderr).splitlines() if line.strip()]


def fail(message: str) -> None:
    print(f"settings.py: {message}", file=sys.stderr)
    sys.exit(2)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--theme", default="neutral")
    parser.add_argument("--color", action="append", default=[], metavar="KEY=#HEX")
    parser.add_argument("--font")
    parser.add_argument("--font-size", type=int, default=16)
    parser.add_argument("--width", type=int, default=1800)
    parser.add_argument("--height", type=int, default=1000)
    parser.add_argument("--padding", type=int, default=20)
    parser.add_argument("--typing-speed", default="45ms")
    parser.add_argument("--shell", default="zsh" if shutil.which("zsh") else "bash")
    parser.add_argument("--window", default="none", choices=[*WINDOW_BARS, "none"])
    parser.add_argument("--margin", type=int)
    parser.add_argument("--margin-fill", default="#6b7280")
    parser.add_argument("--radius", type=int)
    args = parser.parse_args()

    preset = THEMES / f"{args.theme.lower()}.json"
    theme: dict | None = None
    builtin: str | None = None
    if preset.is_file():
        theme = json.loads(preset.read_text())
    else:
        known = vhs_themes()
        if known is not None and args.theme not in known:
            matches = [name for name in known if name.lower() == args.theme.lower()]
            if not matches:
                fail(f"no theme '{args.theme}'. Presets: {', '.join(presets())}. Run `vhs themes` for the built-in names.")
            args.theme = matches[0]
        builtin = args.theme

    font = args.font or (theme or {}).pop("font", None) or "JetBrains Mono, Menlo, monospace"
    if theme is not None:
        theme.pop("font", None)

    for change in args.color:
        key, _, value = change.partition("=")
        if key not in KEYS or not value.startswith("#"):
            fail(f"bad --color '{change}'. Use KEY=#HEX with KEY one of: {', '.join(KEYS)}.")
        if theme is None:
            fail(f"--color needs a preset theme, and '{builtin}' is a vhs built-in. Presets: {', '.join(presets())}.")
        theme[key] = value

    # With a window, the margin and the bar are added, so the terminal keeps the size asked for.
    is_window = args.window != "none"
    margin = args.margin if args.margin is not None else (40 if is_window else 0)
    radius = args.radius if args.radius is not None else (10 if is_window else 0)
    bar = WINDOW_BAR_SIZE if is_window else 0
    width = args.width + 2 * margin
    height = args.height + 2 * margin + bar

    lines = [
        f"Set Shell {args.shell}",
        f'Set FontFamily "{font}"',
        f"Set FontSize {args.font_size}",
        f"Set Width {width}",
        f"Set Height {height}",
        f"Set Padding {args.padding}",
        f"Set TypingSpeed {args.typing_speed}",
        f"Set Theme {json.dumps(theme)}" if theme is not None else f'Set Theme "{builtin}"',
    ]
    if is_window:
        lines += [f"Set WindowBar {WINDOW_BARS[args.window]}", f"Set WindowBarSize {bar}"]
    if margin:
        lines += [f"Set Margin {margin}", f'Set MarginFill "{args.margin_fill}"']
    if radius:
        lines.append(f"Set BorderRadius {radius}")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
