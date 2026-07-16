---
name: copy
disable-model-invocation: true
description: Copy your latest message, or a specific part of it, to the user's clipboard. Use when the user wants to "copy that", "copy to clipboard", or grab a quote/snippet/command/code block from your previous answer without selecting it manually in the terminal (which mangles indentation and line breaks).
argument-hint: "[optional: what to copy, e.g. 'the command', 'the json', 'the second code block']"
---

# Copy to Clipboard

Copy text from your previous response to the user's clipboard. The point is to avoid manual terminal selection, which adds stray indentation whitespace and wrong line breaks. So the clipboard must receive the text **exactly** as it was authored, with original line breaks and no leading indentation artifacts.

## Step 1: Determine What to Copy

Look at your most recent assistant message (the answer just before this skill was invoked) and decide which text the user wants on their clipboard.

- **If the user passed an argument**, treat it as a selector for which part to copy. Match it against your last message and copy only that part. Examples:
  - `the command` / `the curl` → the relevant command line
  - `the json` / `the code` → that code block's contents
  - `the second code block` → the Nth fenced block
  - `the quote` → the quoted/emphasized passage
  - A literal phrase → the matching span of text

  If the argument is ambiguous (e.g. several code blocks and no qualifier), ask one short clarifying question listing the candidates rather than guessing.

- **If no argument is provided**, infer the target from the shape of your last message:
  - If the answer's substance is one embedded artifact — a single fenced code block, a command, a quoted passage, a path, a generated string — copy just that artifact (the thing the user most likely wants to paste elsewhere), not the surrounding prose.
  - If the answer is mostly prose with no single dominant artifact, copy the **complete** answer text.

  When unsure between "the embedded artifact" and "the whole answer", prefer the artifact if there's exactly one obvious one; otherwise copy the whole answer.

## Step 2: Reconstruct the Exact Text

Reproduce the selected text verbatim from your previous message:

- Preserve original line breaks and internal indentation.
- For a fenced code block, copy the contents **between** the fences, not the ``` markers (unless the user explicitly asked for the markdown).
- Do not add a trailing prose comment, leading bullet, or quote marker.
- Strip nothing meaningful, but do not introduce terminal-wrapping artifacts.

## Step 3: Write to a Temp File

Write the exact text to a temp file with the Write tool (do **not** echo it through the shell — backticks, `$`, quotes, and newlines get mangled by shell quoting). Use a path under the OS temp dir, e.g. `${TMPDIR:-/tmp}/claude-copy.txt`.

Writing to a file and piping it into the clipboard tool guarantees the bytes land unaltered.

## Step 4: Pipe the File into the Clipboard

Pipe the file rather than passing the text inline:

- macOS: `pbcopy < "<path>"`
- Linux (Wayland): `wl-copy < "<path>"` — or X11: `xclip -selection clipboard < "<path>"`
- Windows: `clip.exe < "<path>"`

Pick the command for the current platform (macOS here by default). If the primary tool is missing on Linux, fall back to the other.

## Step 5: Confirm

Tell the user concisely what was copied — e.g. "Copied the curl command to your clipboard." For a short snippet you may echo it back in a fenced block for confirmation; for a long block just state what it was and its size (e.g. "Copied the 24-line config block").

If no clipboard tool was available, say so and show the temp file path so they can grab it manually.
