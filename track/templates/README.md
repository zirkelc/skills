# issues

Upstream issues and pull requests I am waiting on, and the reason I am waiting.

The upstream tracker records what the maintainers need. This repository records
what *I* needed: which project hit the limitation, what the workaround costs,
and what to delete once the fix lands. That context is the part that is normally
lost between subscribing to an issue and it being fixed a year later.

This repository is private, so issues can name real paths, real repositories and
real constraints. Anything written *upstream* is public and has to stand on its own.

## How an issue is written

One issue per upstream problem, titled `[package] what I need`.

- **Upstream** — the issue and PR links. The workflow reads only this section.
- **What I need** — the capability or fix, in my terms rather than the maintainer's.
- **Where it bites** — the repositories, files and lines affected, and a grep that
  comes back empty once the workaround is gone.
- **Workaround** — what happens instead today, and what it costs.
- **Notes** — versions, alternatives already rejected, related discussions.

## Labels

`.github/workflows/upstream-check.yml` runs daily, resolves every link in the
Upstream section, and labels the issue when the conclusion changes. No label means
upstream is still open and there is nothing to do.

| label | what happened | what it asks for |
|---|---|---|
| `upstream:fixed` | merged, or closed as completed | check for a release, upgrade, delete the workaround |
| `upstream:declined` | closed as not planned, or PR closed unmerged | the workaround is permanent now: keep, fork, patch or move off it |
| `upstream:moved` | closed as a duplicate | re-point the Upstream section at the surviving issue |
| `upstream:unreachable` | the link no longer resolves | the repository was renamed, deleted or made private |

The workflow never closes an issue. Upstream shipping a fix is not the same as
this project having adopted it, and the label is the queue of work that adoption
creates. An issue closes when the workaround is actually gone.
