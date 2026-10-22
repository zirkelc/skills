#!/bin/sh
# Puts frames of a video into one image, with the time on each frame, to check a take.
#
#   contact-sheet.sh <video> <out.png> [start-seconds] [end-seconds] [frames-per-second] [crop w:h:x:y]
#
# Defaults: the whole video, one frame per second, no crop. Five frames per row.
set -eu

[ $# -ge 2 ] || { echo "usage: $0 <video> <out.png> [start] [end] [fps] [crop w:h:x:y]" >&2; exit 2; }
video=$1 out=$2 start=${3:-0} end=${4:-} fps=${5:-1} crop=${6:-}

duration=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$video")
[ -n "$end" ] || end=$duration

# The number of frames decides the rows of the grid.
count=$(awk -v s="$start" -v e="$end" -v f="$fps" 'BEGIN { n = int((e - s) * f + 0.999); print (n < 1 ? 1 : n) }')
rows=$(( (count + 4) / 5 ))

filter="fps=$fps"
[ -z "$crop" ] || filter="$filter,crop=$crop"
filter="$filter,scale=480:-1"
# Some ffmpeg builds have no drawtext filter. Then the times are printed instead of drawn.
if ffmpeg -hide_banner -filters 2>/dev/null | grep -q ' drawtext '; then
  filter="$filter,drawtext=text='%{pts\\:hms}':x=6:y=6:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.7"
  is_drawn=1
else
  is_drawn=0
fi
filter="$filter,tile=5x$rows"

ffmpeg -v error -y -ss "$start" -to "$end" -i "$video" -vf "$filter" -frames:v 1 "$out"
echo "$out: $count frames from ${start}s to ${end}s, 5 per row, left to right"
[ "$is_drawn" = 1 ] || awk -v s="$start" -v f="$fps" -v n="$count" 'BEGIN { for (i = 0; i < n; i++) printf "frame %d: %.1fs\n", i + 1, s + i / f }'
