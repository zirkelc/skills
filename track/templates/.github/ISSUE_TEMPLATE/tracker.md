---
name: Upstream tracker
about: A fix or feature needed from a dependency, and the code that needs it
title: "[package] <requirement>"
---

## Upstream

<!-- Each issue or PR link that decides the outcome. The workflow reads only this
     section. Put related links in Notes. -->

- https://github.com/owner/repo/issues/123

## Requirement

<!-- The fix or feature this project needs, in one or two sentences. -->

## Affected code

<!-- Absolute repository path, exact file:line, and a grep that returns no results
     after the workaround is removed. -->

- `~/Developer/acme-api`, `src/db/client.ts:41`: the retry loop exists only because of this issue
- `rg 'RETRY_AROUND_5435' ~/Developer/acme-api` returns no results after the fix is adopted

## Workaround

<!-- The current workaround and its cost. Remove this section if there is no workaround. -->

## Notes

<!-- Affected versions, rejected alternatives, related links. -->
