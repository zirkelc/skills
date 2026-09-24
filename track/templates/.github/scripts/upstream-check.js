/**
 * Resolves the upstream issues and pull requests that each open tracker references,
 * and labels the tracker when the conclusion changes.
 *
 * Run from `.github/workflows/upstream-check.yml` via actions/github-script. The pure
 * helpers are exported so they can be tested without a network or an Actions runtime.
 */

const LABELS = {
  fixed: 'upstream:fixed',
  declined: 'upstream:declined',
  moved: 'upstream:moved',
  unreachable: 'upstream:unreachable',
};

const ALL_LABELS = Object.values(LABELS);

const NEXT_STEP = {
  [LABELS.fixed]:
    'Check whether the fix is in a released version, upgrade, then remove the workaround recorded above and close this issue.',
  [LABELS.declined]:
    'Upstream will not do this, so the workaround is now permanent. Decide whether to keep it, fork, patch, or move off the dependency.',
  [LABELS.moved]: 'Upstream closed this as a duplicate. Re-point the Upstream section at the issue it was merged into.',
  [LABELS.unreachable]:
    'The upstream reference cannot be read any more. The repository may be private, renamed, or deleted.',
};

/** The "## Upstream" section alone, or the whole body when it has no such heading. */
const upstreamSection = (body) => {
  const lines = body.split('\n');
  const start = lines.findIndex((line) => /^##\s+Upstream\s*$/.test(line));
  if (start === -1) return body;

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^##\s/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
};

/** Upstream references in that section, deduplicated by owner/repo#number. */
const parseRefs = (body) => {
  if (!body) return [];

  const scope = upstreamSection(body);
  const pattern = /https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(issues|pull)\/(\d+)/g;
  const seen = new Map();

  for (const match of scope.matchAll(pattern)) {
    const [url, owner, repo, kind, number] = match;
    const key = `${owner}/${repo}#${number}`;
    if (!seen.has(key)) seen.set(key, { owner, repo, kind, number: Number(number), key, url });
  }

  return [...seen.values()];
};

/**
 * One label for the whole tracker. A fix anywhere settles it; otherwise anything still
 * open upstream means we are still waiting, even when a sibling reference was declined,
 * because the open one may yet land. An unresolved reference never decides the outcome.
 */
const aggregate = (results) => {
  if (results.some((r) => r.state === 'fixed')) return LABELS.fixed;
  if (results.some((r) => r.state === 'open' || r.state === 'unknown')) return null;

  for (const state of ['moved', 'declined', 'unreachable']) {
    if (results.some((r) => r.state === state)) return LABELS[state];
  }

  return null;
};

/** The labels a tracker should end up with, preserving any that this job does not own. */
const nextLabels = (current, want) => {
  const names = current.map((label) => (typeof label === 'string' ? label : label.name));
  const keep = names.filter((name) => !ALL_LABELS.includes(name));
  return want ? [...keep, want] : keep;
};

/** Whether the conclusion already matches, so re-runs stay silent. */
const isUnchanged = (current, want) => {
  const names = current.map((label) => (typeof label === 'string' ? label : label.name));
  const mine = names.filter((name) => ALL_LABELS.includes(name));
  return mine.length === (want ? 1 : 0) && (!want || mine[0] === want);
};

const comment = (author, want, results) => {
  const lines = results.map((r) => {
    const state = r.state === 'open' ? 'still open' : r.state === 'unknown' ? 'could not check' : `**${r.state}**`;
    return `- ${state} — [${r.key}](${r.url})${r.detail ? ` — ${r.detail}` : ''}`;
  });

  const heading = want
    ? `@${author} upstream state changed: \`${want}\``
    : `@${author} upstream reopened, so this is back to waiting.`;

  return [heading, '', ...lines, '', want ? NEXT_STEP[want] : 'No action needed yet.'].join('\n');
};

/**
 * Resolve one reference to open | fixed | declined | moved | unreachable | unknown.
 * A pull request is authoritative only via the pulls endpoint, because the issues
 * endpoint does not guarantee the merged timestamp is present.
 */
const resolveRef = async (github, ref) => {
  try {
    if (ref.kind === 'pull') {
      const { data } = await github.rest.pulls.get({ owner: ref.owner, repo: ref.repo, pull_number: ref.number });
      if (data.state === 'open') return { ...ref, state: 'open' };

      return {
        ...ref,
        state: data.merged ? 'fixed' : 'declined',
        detail: data.merged ? `merged ${data.merged_at}` : `closed without merging ${data.closed_at}`,
      };
    }

    const { data } = await github.rest.issues.get({ owner: ref.owner, repo: ref.repo, issue_number: ref.number });
    if (data.state === 'open') return { ...ref, state: 'open' };

    const reason = data.state_reason;
    const state = reason === 'not_planned' ? 'declined' : reason === 'duplicate' ? 'moved' : 'fixed';
    return { ...ref, state, detail: `closed ${data.closed_at}${reason ? ` as ${reason}` : ' (no reason given)'}` };
  } catch (error) {
    /* A missing reference is a real conclusion; anything else is this job failing to look. */
    if (error.status === 404 || error.status === 410) {
      return { ...ref, state: 'unreachable', detail: `not readable (HTTP ${error.status})` };
    }
    return { ...ref, state: 'unknown', detail: `lookup failed (${error.status || error.message})` };
  }
};

const run = async ({ github, context, core }) => {
  const { owner, repo } = context.repo;
  const issues = await github.paginate(github.rest.issues.listForRepo, { owner, repo, state: 'open', per_page: 100 });

  let changed = 0;
  let failed = 0;

  for (const issue of issues) {
    if (issue.pull_request) continue;

    /* One unreadable tracker must not cost every tracker after it its daily check. */
    try {
      const refs = parseRefs(issue.body);
      if (refs.length === 0) continue;

      const results = [];
      for (const ref of refs) results.push(await resolveRef(github, ref));

      if (results.some((r) => r.state === 'unknown')) failed += 1;

      const want = aggregate(results);
      if (isUnchanged(issue.labels, want)) continue;

      await github.rest.issues.setLabels({
        owner,
        repo,
        issue_number: issue.number,
        labels: nextLabels(issue.labels, want),
      });
      await github.rest.issues.createComment({
        owner,
        repo,
        issue_number: issue.number,
        body: comment(issue.user.login, want, results),
      });

      changed += 1;
      core.info(`#${issue.number}: -> ${want || 'none'}`);
    } catch (error) {
      failed += 1;
      core.warning(`#${issue.number}: ${error.message}`);
    }
  }

  core.info(`checked ${issues.length} issue(s), updated ${changed}, could not check ${failed}`);

  /* Surface a run that silently checked nothing, rather than reporting a green tick. */
  if (failed > 0 && changed === 0) core.setFailed(`${failed} tracker(s) could not be checked`);
};

module.exports = { run, upstreamSection, parseRefs, aggregate, nextLabels, isUnchanged, comment, resolveRef, LABELS };
