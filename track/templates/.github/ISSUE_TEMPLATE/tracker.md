---
name: Upstream tracker
about: Something a dependency needs to fix, and why we needed it
title: "[package] what I need"
---

## Upstream

<!-- Every issue or PR link that would settle this. The workflow reads this section
     and nothing else, so related-but-not-deciding threads belong in Notes. -->

- https://github.com/owner/repo/issues/123

## What I need

<!-- The capability or fix in our terms, not the maintainer's. One or two sentences. -->

## Where it bites

<!-- Absolute repo path, exact file:line, and a grep that returns nothing once the
     workaround is gone. This is what makes the tracker checkable later. -->

- `~/Developer/acme-api` — `src/db/client.ts:41`, the retry loop only exists because of this
- `rg 'RETRY_AROUND_5435' ~/Developer/acme-api` comes back empty once this is done

## Workaround

<!-- What happens instead today, and what it costs. Delete if there is none yet. -->

## Notes

<!-- Versions affected, alternatives already rejected, related threads. -->
