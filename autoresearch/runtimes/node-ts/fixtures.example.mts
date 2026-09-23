/**
 * Large read-only inputs for the cases, in a module of their own.
 *
 * The cases module is imported once per revision (a `?slot=` query gives each side its own
 * instance), so anything at its top level exists twice in the child process. This module carries no
 * query, so both sides share one copy of the data. Keep it to plain inputs: anything built from
 * them (parsed documents, instances) belongs in a case's `setup`, so it lives only while that case
 * runs.
 *
 * Never import the library under test here. This module is shared by both revisions on purpose, so
 * anything built from the library in it would be created by one revision and then measured against
 * the other, in every case that touches it. That mistake invalidates a whole campaign and nothing in
 * the output shows it. Plain data only: strings, buffers, numbers, plain objects.
 *
 * Generate the inputs deterministically, or read files that `fetch-fixtures.sh` downloaded into
 * `perf/fixtures/` (untracked, with a manifest of URL, sha256 and date).
 */
import * as fs from "node:fs";
import * as path from "node:path";

const DIR = path.join(import.meta.dirname, "fixtures");

export const FIXTURES: Array<string> = fs.existsSync(DIR)
  ? fs
      .readdirSync(DIR)
      .filter((f) => f.endsWith(".html"))
      .sort()
      .map((f) => fs.readFileSync(path.join(DIR, f), "utf8"))
  : [];
