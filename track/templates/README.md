# issues

Upstream issues and pull requests I wait on, and the reason.

An upstream issue records what the maintainers need to fix. This repository records what I
need: the project that has the limitation, the workaround and its cost, and the code to
delete after the fix is released. This information is usually lost between the subscription
and the fix.

This repository is private. Issues can contain real file paths, repository names, and
constraints. Everything posted upstream is public.

One issue per upstream problem. Title format: `[package] <requirement>`. Body format:
[`.github/ISSUE_TEMPLATE/tracker.md`](.github/ISSUE_TEMPLATE/tracker.md).

## Labels

`.github/workflows/upstream-check.yml` runs daily. It reads each link in the Upstream
section, queries the upstream state, and sets a label when the result changes. An issue
without a label waits for upstream and needs no action.

| label | upstream state | required action |
|---|---|---|
| `upstream:fixed` | merged, or closed as completed | check for a release, upgrade, delete the workaround |
| `upstream:declined` | closed as not planned, or PR closed without merge | the workaround is permanent: keep it, fork, patch, or move off the dependency |
| `upstream:moved` | closed as a duplicate | replace the link in the Upstream section with the surviving issue |
| `upstream:unreachable` | the link does not resolve | the repository was renamed, deleted, or made private |

The workflow does not close issues. An upstream fix and its adoption in this project are two
different events. The label is the list of adoption work. Close an issue when the workaround
is removed from the code.
