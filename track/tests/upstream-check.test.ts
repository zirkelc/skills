import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

/** The script is CommonJS because actions/github-script requires it at runtime. */
const require = createRequire(import.meta.url);
const { upstreamSection, parseRefs, aggregate, nextLabels, isUnchanged, resolveRef } = require(
  '../templates/.github/scripts/upstream-check.js',
);

describe(`upstreamSection`, () => {
  test(`should return only the Upstream section when one exists`, () => {
    // Arrange
    const body = [`## Upstream`, `- a`, ``, `## Notes`, `- b`].join(`\n`);

    // Act
    const result = upstreamSection(body);

    // Assert
    expect(result).toBe(`- a\n`);
  });

  test(`should run to the end of the body when no heading follows`, () => {
    // Arrange
    const body = [`## Upstream`, `- a`, `- b`].join(`\n`);

    // Act
    const result = upstreamSection(body);

    // Assert
    expect(result).toBe(`- a\n- b`);
  });

  test(`should fall back to the whole body when there is no Upstream heading`, () => {
    // Arrange
    const body = `no headings here`;

    // Act
    const result = upstreamSection(body);

    // Assert
    expect(result).toBe(body);
  });
});

describe(`parseRefs`, () => {
  test(`should ignore links outside the Upstream section`, () => {
    // Arrange
    const body = [
      `## Upstream`,
      `- https://github.com/architect/dynalite/pull/143`,
      ``,
      `## Notes`,
      `- https://github.com/vitest-dev/vitest/pull/6426`,
    ].join(`\n`);

    // Act
    const result = parseRefs(body);

    // Assert
    expect(result.length).toBe(1);
    expect(result[0].key).toBe(`architect/dynalite#143`);
  });

  test(`should deduplicate a reference listed twice`, () => {
    // Arrange
    const body = [`## Upstream`, `- https://github.com/o/r/issues/1`, `- https://github.com/o/r/issues/1`].join(`\n`);

    // Act
    const result = parseRefs(body);

    // Assert
    expect(result.length).toBe(1);
  });

  test(`should distinguish a pull request from an issue`, () => {
    // Arrange
    const body = [`## Upstream`, `- https://github.com/o/r/pull/7`, `- https://github.com/o/r/issues/8`].join(`\n`);

    // Act
    const result = parseRefs(body);

    // Assert
    expect(result.map((r) => r.kind)).toEqual([`pull`, `issues`]);
    expect(result.map((r) => r.number)).toEqual([7, 8]);
  });

  test(`should return nothing for an empty body`, () => {
    // Arrange
    const body = ``;

    // Act
    const result = parseRefs(body);

    // Assert
    expect(result.length).toBe(0);
  });
});

describe(`aggregate`, () => {
  test(`should label fixed when any reference is fixed`, () => {
    // Arrange
    const results = [{ state: `declined` }, { state: `fixed` }];

    // Act
    const result = aggregate(results);

    // Assert
    expect(result).toBe(`upstream:fixed`);
  });

  test(`should stay unlabelled when an open reference outranks a declined sibling`, () => {
    // Arrange
    const results = [{ state: `open` }, { state: `declined` }];

    // Act
    const result = aggregate(results);

    // Assert
    expect(result).toBe(null);
  });

  test(`should not conclude while a reference could not be checked`, () => {
    // Arrange
    const results = [{ state: `unknown` }, { state: `declined` }];

    // Act
    const result = aggregate(results);

    // Assert
    expect(result).toBe(null);
  });

  test(`should label declined when every reference is declined`, () => {
    // Arrange
    const results = [{ state: `declined` }, { state: `declined` }];

    // Act
    const result = aggregate(results);

    // Assert
    expect(result).toBe(`upstream:declined`);
  });

  test(`should prefer moved over declined`, () => {
    // Arrange
    const results = [{ state: `declined` }, { state: `moved` }];

    // Act
    const result = aggregate(results);

    // Assert
    expect(result).toBe(`upstream:moved`);
  });
});

describe(`nextLabels`, () => {
  test(`should replace an owned label while keeping foreign ones`, () => {
    // Arrange
    const current = [{ name: `upstream:declined` }, { name: `blocked` }];

    // Act
    const result = nextLabels(current, `upstream:fixed`);

    // Assert
    expect(result).toEqual([`blocked`, `upstream:fixed`]);
  });

  test(`should drop the owned label when upstream reopens`, () => {
    // Arrange
    const current = [{ name: `upstream:fixed` }, { name: `blocked` }];

    // Act
    const result = nextLabels(current, null);

    // Assert
    expect(result).toEqual([`blocked`]);
  });
});

describe(`isUnchanged`, () => {
  test(`should report unchanged when the label already matches`, () => {
    // Arrange
    const current = [{ name: `upstream:fixed` }];

    // Act
    const result = isUnchanged(current, `upstream:fixed`);

    // Assert
    expect(result).toBe(true);
  });

  test(`should report unchanged when nothing is wanted and nothing is owned`, () => {
    // Arrange
    const current = [{ name: `blocked` }];

    // Act
    const result = isUnchanged(current, null);

    // Assert
    expect(result).toBe(true);
  });

  test(`should report changed when the conclusion differs`, () => {
    // Arrange
    const current = [{ name: `upstream:declined` }];

    // Act
    const result = isUnchanged(current, `upstream:fixed`);

    // Assert
    expect(result).toBe(false);
  });
});

describe(`resolveRef`, () => {
  test(`should treat a merged pull request as fixed`, async () => {
    // Arrange
    const github = { rest: { pulls: { get: async () => ({ data: { state: `closed`, merged: true, merged_at: `2024-12-05T14:01:06Z` } }) } } };

    // Act
    const result = await resolveRef(github, { kind: `pull`, owner: `o`, repo: `r`, number: 1 });

    // Assert
    expect(result.state).toBe(`fixed`);
  });

  test(`should treat a pull request closed without merging as declined`, async () => {
    // Arrange
    const github = { rest: { pulls: { get: async () => ({ data: { state: `closed`, merged: false, closed_at: `2025-04-22T14:56:05Z` } }) } } };

    // Act
    const result = await resolveRef(github, { kind: `pull`, owner: `o`, repo: `r`, number: 1 });

    // Assert
    expect(result.state).toBe(`declined`);
  });

  test(`should treat an issue closed as not_planned as declined`, async () => {
    // Arrange
    const github = { rest: { issues: { get: async () => ({ data: { state: `closed`, state_reason: `not_planned`, closed_at: `2024-03-21T19:09:56Z` } }) } } };

    // Act
    const result = await resolveRef(github, { kind: `issue`, owner: `o`, repo: `r`, number: 1 });

    // Assert
    expect(result.state).toBe(`declined`);
  });

  test(`should treat a closed issue with no reason as fixed`, async () => {
    // Arrange
    const github = { rest: { issues: { get: async () => ({ data: { state: `closed`, state_reason: null, closed_at: `2024-01-01T00:00:00Z` } }) } } };

    // Act
    const result = await resolveRef(github, { kind: `issue`, owner: `o`, repo: `r`, number: 1 });

    // Assert
    expect(result.state).toBe(`fixed`);
    expect(result.detail).toContain(`no reason given`);
  });

  test(`should treat a missing reference as unreachable`, async () => {
    // Arrange
    const github = { rest: { issues: { get: async () => { throw Object.assign(new Error(`nope`), { status: 404 }); } } } };

    // Act
    const result = await resolveRef(github, { kind: `issue`, owner: `o`, repo: `r`, number: 1 });

    // Assert
    expect(result.state).toBe(`unreachable`);
  });

  test(`should treat a rate limit as unknown rather than a conclusion`, async () => {
    // Arrange
    const github = { rest: { issues: { get: async () => { throw Object.assign(new Error(`rate limited`), { status: 403 }); } } } };

    // Act
    const result = await resolveRef(github, { kind: `issue`, owner: `o`, repo: `r`, number: 1 });

    // Assert
    expect(result.state).toBe(`unknown`);
  });
});
