---
name: orca-move
description: Move an existing Orca worktree and its Claude Code session from one Orca host to another (from a paired Orca server to this machine, or from this machine to a paired server), with its branch, unpushed commits and uncommitted changes, and resume the same conversation there. Use when the user says "move this worktree here", "move it to the server", "continue this on my laptop", "bring that session local", or when a running task needs the other machine (a GUI app, a desktop browser, local files, or a machine that stays on).
argument-hint: "which worktree and where, free-form, e.g. 'move fix-parser from build-server to here' or 'move this worktree to build-server'. The source defaults to the worktree this session runs in, the target to the other end."
---

# Orca Move

Move an Orca worktree from one host to another and resume its agent session there. One end of the move is this machine. The other end is a paired Orca server.

Orca has no move between hosts (see [stablyai/orca#40354](https://github.com/stablyai/orca/issues/40354)), so this skill does it in five parts:

1. It stops the source agent, so the conversation does not change during the move.
2. It carries the branch, the unpushed commits and the uncommitted changes in a git bundle. Nothing is committed to the branch and nothing is pushed.
3. It creates a worktree on the target host and unpacks the bundle there.
4. It copies the Claude Code session transcript and resumes it on the target host, with a note that the host and the paths changed.
5. It removes the source worktree only after the user approves.

The source worktree stays as it was until the last step. If a step fails, the source can continue.

## When to use

- A task that runs on a server now needs the local machine: a GUI app, the desktop browser, a simulator, local files or credentials that the server does not have.
- A local task must continue on a server, for example so that it continues when the laptop sleeps.

## When not to use

- The work can start again from a short brief. Use `orca-handoff` with a host instead: it is faster, and it does not need SSH.
- The agent is not Claude Code. This skill can move the code, but it cannot resume another agent's conversation. Move the code (steps 1 to 3), then start a new agent with a brief from `orca-handoff`, and say so.
- The agent is in the middle of a turn. Wait until it is idle, or ask the user.

## Arguments

The argument is free-form prose. Read it and find these parts:

- **worktree** (default: the worktree that contains the current directory): the worktree to move. The user can name it by its display name, its branch or its path.
- **from** and **to**: the two hosts. One of them is this machine. A name from `orca host list` is the paired server. When the user gives only one host ("move fix-parser here", "move this to build-server"), the other end is the other host.
- **remove source** (default: **ask**): remove the source worktree after the move. "Keep the old one" means do not ask and keep it.

Ask a question only when the worktree or the paired server does not resolve to exactly one match, or when SSH to the server does not work.

In the commands below:

- `$env` is the name of the paired server from `orca host list`.
- `$ssh` is the SSH target of that server (see **SSH**).
- `<src>` and `<dst>` are the source and target hosts. For each `orca` command, add `--environment "$env"` when that command acts on the paired server.

## SSH

Orca does not copy files between hosts, so this skill needs SSH from this machine to the paired server. It must log in as the user that runs Orca on that server, because the session files and the repository belong to that user.

Find the SSH target in this order:

1. The user's instructions (for example a CLAUDE.md that names the host and its user).
2. The Orca host name itself: `ssh -o BatchMode=yes -o ConnectTimeout=5 "$env" true`.

If neither works, stop and ask the user for the SSH target. Do not guess user names or addresses.

Run multi-line commands on the server as a script on stdin, not as a quoted string: `ssh "$ssh" bash -s <<'EOF' ... EOF`. With a quoted string, the local shell (zsh in particular) expands `$var`, `~` and `==` before SSH sends them.

## Preflight

Do these checks before you change anything.

### 1. The source worktree

```sh
orca worktree list --json | jq -c '.result.worktrees[] | {displayName, path, branch, repoId}'   # add --environment "$env" for the server
```

Select the worktree. Record its path (`$src_path`), its branch (`$branch`, without `refs/heads/`) and its display name (`$name`).

### 2. The target repo

The target host must have the same repo, set up in Orca. Match it by the git remote, not by the path, as in `orca-handoff`:

```sh
key=$(git -C "$src_path" remote get-url origin | sed -E 's#^[a-z+]+://##; s#^[^@/]+@##; s#:#/#; s#\.git$##' | tr '[:upper:]' '[:lower:]')
orca repo list --json | jq -r --arg key "$key" \
  '.result.repos[] | select((.gitRemoteIdentity.canonicalKey // "" | ascii_downcase) == $key) | "\(.id)\t\(.path)"'
```

Run the `git` part on the source host and the `orca repo list` part for the target host. Record the repo id (`$dst_repo_id`) and the repo path (`$dst_repo`). If no repo matches, stop and say that the repo is not set up on the target host. Do not clone it without the user's approval.

### 3. The agent terminals

```sh
orca terminal list --worktree "path:$src_path" --json \
  | jq -c '.result.terminals[] | {handle, agentIdentity, connected, preview: (.preview | .[-300:])}'
```

- **No agent terminal:** move only the code (steps 1 to 3), and skip the session steps.
- **An agent other than `claude`:** see **When not to use**.
- **The agent works on a turn:** stop and ask. A move in the middle of a turn loses that turn.
- **More than one Claude terminal:** move all of them. Each one has its own session.

### 4. The Claude session ID

Find it on the source host while the agent still runs. Claude Code keeps one record for each running process in `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/sessions/<pid>.json`, with `sessionId`, `cwd` and `kind`. This file is internal to Claude Code and its format can change, so use the fallback when it does not match.

```sh
cfg="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
for pid in $(pgrep -x claude); do
  f="$cfg/sessions/$pid.json"
  [ -f "$f" ] && jq -r --arg p "$src_path" 'select(.cwd == $p) | "\(.pid) \(.sessionId)"' "$f"
done
```

Fallback: the newest transcript in the project folder of the worktree (see **The project folder**). If more than one transcript changed since the agent started, and you cannot tell which one belongs to the terminal, ask the user.

Also record the Claude command line of each process (`ps -o args= -p <pid>`). The resume in step 5 uses its flags again.

### 5. The current session

If the worktree to move is the one that this session runs in, this session cannot stop itself before the copy. Do the steps in this order: steps 2 and 3 (code), step 4 (copy the transcript) as the last action, then step 5. The last turn of this session is not in the copy. Tell the user, and tell them to close this terminal after the move.

## The project folder

Claude Code keeps the transcripts of a directory in `${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects/<folder>`. The folder name is the absolute path with each character that is not a letter or a digit changed to `-`:

```sh
proj_dir() { printf '%s' "$1" | sed 's/[^A-Za-z0-9]/-/g'; }
proj_dir /home/dev/work/my-app      # -home-dev-work-my-app
```

Use the real path (`pwd -P`). On macOS, `/tmp` is `/private/tmp`.

## Step 1: Stop the source agent

Stop the agent before you copy anything, so that its transcript does not change during the move. Send the agent's exit command:

```sh
orca terminal send --terminal <handle> --text "/exit" --enter --json
```

Then, on the source host, wait until the process from preflight step 4 has stopped (`kill -0 <pid>` fails), for at most 30 seconds. If it still runs, stop and ask. Do not kill the process.

The terminal and the worktree stay. If the move fails, `claude --resume <session-id>` in the source worktree continues the session.

## Step 2: Pack the code on the source host

Run this in `$src_path` on the source host. It makes a temporary commit of the working tree with a temporary index, so the branch, the index and the files do not change:

```sh
set -eu
ref="refs/orca-move/$(printf '%s' "$branch" | tr '/' '-')"
head=$(git rev-parse HEAD)
out=$(mktemp -d)
idx="$out/index"
cp "$(git rev-parse --git-path index)" "$idx"
GIT_INDEX_FILE="$idx" git add -A
tree=$(GIT_INDEX_FILE="$idx" git write-tree)
wip=$(git commit-tree "$tree" -p "$head" -m "orca-move: uncommitted changes")
git update-ref "$ref/head" "$head"
git update-ref "$ref/wip" "$wip"
git bundle create "$out/move.bundle" "$ref/head" "$ref/wip"
git update-ref -d "$ref/head"
git update-ref -d "$ref/wip"
echo "$out/move.bundle"
```

Then copy the bundle to the target host (`scp`, through this machine).

What moves and what does not:

- **Moves:** all commits of the branch, the modified, deleted and new files. Untracked files arrive as untracked.
- **Does not move:** files that `.gitignore` excludes (for example `.env` files, `node_modules`, build output), and the stash. A staged change arrives as an unstaged change.
- List the ignored files that are not build output (`git status --ignored --short | grep -vE 'node_modules|dist|build|\.cache'`). Do not copy them on your own, because they often hold secrets. Name them in the report, so the user can decide.

## Step 3: Create the worktree on the target host and unpack

Create the worktree without an agent. The agent starts in step 5, with the old conversation:

```sh
orca worktree create --repo "id:$dst_repo_id" --name "$name" --branch "$branch" \
  --no-parent --setup skip --json
```

Read the real path and branch from `.result.worktree.path` and `.result.worktree.branch`. Orca can add a suffix when the name or the branch is already in use on the target host. Do not assume that they are the same as on the source.

Then, in the new worktree on the target host:

```sh
set -eu
git fetch "$bundle" "$ref/*:$ref/*"
git reset --hard "$ref/head"
git diff --binary HEAD "$ref/wip" | git apply
git update-ref -d "$ref/head"
git update-ref -d "$ref/wip"
git rev-parse --verify --quiet "refs/remotes/origin/$branch" >/dev/null \
  && git branch --set-upstream-to "origin/$branch"
git status --short
```

`git reset --hard` is safe here, because the worktree is new and empty of changes. Compare `git status --short` with the source. They must list the same files.

Then delete the temporary folder (`$out`) on the source host and the bundle on the target host. Use `trash` when it is installed, so that a mistake can be undone.

## Step 4: Copy the session transcript

For each session ID, copy the transcript and its folder (subagents and saved tool results) from the source project folder to the target project folder:

```sh
src_dir="$cfg/projects/$(proj_dir "$src_path")"
dst_dir="$cfg/projects/$(proj_dir "$dst_path")"
# on the source host:
tar -C "$src_dir" -cf - "$id.jsonl" $( [ -d "$src_dir/$id" ] && echo "$id" )
# on the target host, from stdin:
mkdir -p "$dst_dir" && tar -C "$dst_dir" -xf -
```

Connect the two halves with SSH (`ssh "$ssh" bash -s` on one side, a local shell on the other). `$cfg` can be different on the two hosts. Compare the size of the transcript on both hosts after the copy.

Do not change the transcript. It still names the old paths, and the note in step 5 tells the agent about them.

## Step 5: Resume on the target host

Start the session in a new terminal of the target worktree. Use the flags of the source command line again (model, permission mode, effort), but leave out the original prompt and each flag that names a path on the source host (for example `--plugin-dir`, `--mcp-config`, `--settings`):

```sh
orca terminal create --worktree "path:$dst_path" --title "$name" \
  --command "claude --resume $id <kept flags>" --json
orca terminal wait --terminal <new handle> --for tui-idle --timeout-ms 60000 --json
```

Then send the note, as one line with no line break:

```sh
orca terminal send --terminal <new handle> --enter --json --text "This session moved from <src> to <dst>. The repository is now at <dst_path> on branch <branch>; paths in the earlier conversation under <src_path> are now under <dst_path>. Tools, credentials, services and files outside the repository can be different on this host, and files ignored by git did not move. Check what you need before you continue. Then continue the task where you stopped. If you were waiting for an answer, ask the question again."
```

Read the terminal after the agent answers. If `claude --resume` did not find the session, the transcript is in the wrong folder: compare the folder name with `proj_dir "$(pwd -P)"` in the new worktree.

## Step 6: The source worktree

- Close the source agent terminals. The transcript stays on the source host as a backup.
- Remove the source worktree only when the user approves it, or when they asked for it in the request. Before you remove it, check again that the target has the same changes. Then: `orca worktree rm --worktree "path:$src_path" --json` (with `--environment "$env"` when the source is the server). Add `--force` only for uncommitted changes that you verified on the target.
- The branch stays in the source repo. Delete it only when the user asks.

## Report

A short table, then two or three sentences:

| | |
|---|---|
| From | `<src host>`: `<src_path>` |
| To | `<dst host>`: `<dst_path>` |
| Branch | `<branch>` @ `<short sha>`, `<n>` files with uncommitted changes |
| Session | `<session id>`, resumed in terminal `<handle>` |
| Source | `kept`, or `removed` |

In the sentences, name what did not move: ignored files, the stash, a staged state, an agent other than Claude Code, the last turn of a session that moved itself. Then return to the main task.

## CLI specifics

For flags and JSON shapes beyond the commands above, use the `orca-cli` skill. It loads the guide that matches the installed Orca version (`orca skills get orca-cli`).
