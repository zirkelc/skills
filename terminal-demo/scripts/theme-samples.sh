#!/bin/sh
# Records one short sample screenshot per theme, so the user can pick a theme by looking.
#
#   theme-samples.sh <out-dir> [theme ...]
#
# A theme is a preset from the themes folder or a name that `vhs themes` lists. With no
# theme, it records every vhs theme (about 350, a few minutes with 6 at a time). Each sample
# shows the 16 colors and some plain text. Writes <out-dir>/NNN-<theme>.png, in the order
# given, and sheet-N.png with 12 samples each (3 per row), in the same order.
set -eu
[ $# -ge 1 ] || { echo "usage: $0 <out-dir> [theme ...]" >&2; exit 2; }
SCRIPTS=$(cd "$(dirname "$0")" && pwd)
out=$1
shift
mkdir -p "$out"
out=$(cd "$out" && pwd)
work=$(mktemp -d "${TMPDIR:-/tmp}/theme-samples.XXXXXX")

if [ $# -eq 0 ]; then
  vhs themes 2>&1 | grep -v '^[[:space:]]*$' > "$work/names"
else
  printf '%s\n' "$@" > "$work/names"
fi

# What each sample shows: every color by name, then text in the default color.
cat > "$work/sample.sh" <<'EOF'
names="black red green yellow blue magenta cyan white"
i=0; for n in $names; do printf '\033[3%dm%-9s\033[0m' $i $n; i=$((i+1)); done; echo
i=0; for n in $names; do printf '\033[9%dm%-9s\033[0m' $i $n; i=$((i+1)); done; echo
printf '\033[1mbold\033[0m  \033[2mdim\033[0m  \033[4munderline\033[0m  \033[7mreverse\033[0m\n'
echo
echo 'Default text: the quick brown fox jumps over the lazy dog. 0123456789 {} [] () <> => !='
EOF

i=0
while IFS= read -r theme; do
  i=$((i + 1))
  slug=$(printf '%03d-%s' "$i" "$(printf '%s' "$theme" | tr -c 'A-Za-z0-9._-' '_' | sed 's/_*$//')")
  if ! python3 "$SCRIPTS/settings.py" --theme "$theme" --width 1000 --height 300 --font-size 16 --typing-speed 5ms > "$work/$slug.set" 2>"$work/$slug.err"; then
    echo "skip $theme: $(cat "$work/$slug.err")" >&2
    continue
  fi
  # The settings go into the tape itself: vhs sources only files that end in .tape.
  { echo "Output \"$work/$slug.mp4\""; cat "$work/$slug.set"; } > "$work/$slug.tape"
  cat >> "$work/$slug.tape" <<EOF
Hide
Type "cd '$work' && clear"
Enter
Sleep 300ms
Show
Type "sh sample.sh"
Enter
Sleep 600ms
Screenshot "$out/$slug.png"
Sleep 300ms
EOF
done < "$work/names"

ls "$work"/*.tape | xargs -P 6 -I{} sh -c 'vhs "{}" >/dev/null 2>&1 || echo "failed: {}" >&2'

# Contact sheets of 12, in name order.
n=0
ls "$out"/[0-9][0-9][0-9]-*.png | split -l 12 - "$work/sheet."
for list in "$work"/sheet.*; do
  n=$((n + 1))
  mkdir "$work/frames-$n"
  j=0
  while IFS= read -r png; do
    cp "$png" "$work/frames-$n/$(printf '%02d' $j).png"
    j=$((j + 1))
  done < "$list"
  ffmpeg -v error -y -i "$work/frames-$n/%02d.png" -vf "scale=600:-1,pad=iw+10:ih+10:5:5:white,tile=3x4" -frames:v 1 "$out/sheet-$n.png"
  echo "sheet-$n.png: $(sed 's|.*/||; s|\.png$||' "$list" | tr '\n' ' ')"
done

if command -v trash >/dev/null 2>&1; then trash "$work"; else rm -rf "$work"; fi
