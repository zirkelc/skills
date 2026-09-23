#!/bin/sh
# Downloads the pages used as perf fixtures into perf/fixtures/ (untracked) and writes a manifest
# next to them. The sources are live pages: a later download can differ, which would change the
# guard hashes. The manifest (URL, sha256, date) is what tells you afterwards whether a guard
# mismatch came from your change or from the input. Record the guard once, with
# `node perf/guard.mts --update`, before the first experiment of the campaign, and never again.
set -e
cd "$(dirname "$0")"
mkdir -p fixtures
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36'
MANIFEST=fixtures/MANIFEST.tsv
printf 'file\tsha256\tfetched\turl\n' > "$MANIFEST"
for u in \
  https://example.com/one \
  https://example.com/two
do
  f=$(echo "$u" | sed -E 's#https?://(www\.)?##; s#/$##; s#/#_#g').html
  curl -sfL -A "$UA" -H 'Accept-Language: en-US' --max-time 30 -o "fixtures/$f" "$u"
  printf '%s\t%s\t%s\t%s\n' "$f" "$(shasum -a 256 "fixtures/$f" | cut -d' ' -f1)" "$(date -u +%Y-%m-%d)" "$u" >> "$MANIFEST"
  echo "$f"
done
echo "manifest: $MANIFEST"
