#!/bin/sh
# Plays one part of a video faster and keeps the rest at normal speed, for example the wait for a model.
#
#   speedup.sh <in.mp4> <out.mp4> <from-seconds> <to-seconds> <factor>
#
# Writes H.264 in yuv420p with +faststart, which X, GitHub and Slack play.
set -eu

[ $# -eq 5 ] || { echo "usage: $0 <in.mp4> <out.mp4> <from> <to> <factor>" >&2; exit 2; }
in=$1 out=$2 from=$3 to=$4 factor=$5

ffmpeg -v error -y -i "$in" -filter_complex \
  "[0:v]trim=0:$from,setpts=PTS-STARTPTS[a];[0:v]trim=$from:$to,setpts=(PTS-STARTPTS)/$factor[b];[0:v]trim=$to,setpts=PTS-STARTPTS[c];[a][b][c]concat=n=3:v=1:a=0,format=yuv420p[v]" \
  -map "[v]" -c:v libx264 -crf 18 -preset slow -movflags +faststart "$out"

echo "$out: $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$out")s"
