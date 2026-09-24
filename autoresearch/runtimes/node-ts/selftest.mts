/**
 * Self-test for the harness, on a synthetic monorepo it builds in a temporary directory.
 *
 *   node perf/selftest.mts
 *
 * Run it after changing `harness.mts`. Everything it checks has been a real defect: a tree that
 * silently shares code with the working tree produces plausible numbers and no symptom, and a
 * resolution check that cries wolf stops a campaign before it measures anything. Neither shows up
 * on a single-package repo, which is why this builds a monorepo with:
 *
 *   packages/w   a workspace package
 *   node_modules/d   a third-party package that imports `w` (must be copied into the tree)
 *   node_modules/s   a third-party package that imports nothing of ours (must stay shared)
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "autoresearch-selftest-"));
const write = (rel: string, body: string) => {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), body);
};

write("package.json", JSON.stringify({ name: "selftest-root", private: true, type: "module", workspaces: ["packages/*"] }));
write("packages/w/package.json", JSON.stringify({ name: "w", version: "1.0.0", type: "module", main: "index.js" }));
write("packages/w/index.js", 'export const tag = "base";\n');
write("node_modules/d/package.json", JSON.stringify({ name: "d", version: "1.0.0", type: "module", main: "index.js", dependencies: { w: "*", s: "*" } }));
write("node_modules/d/index.js", 'import { tag } from "w";\nimport { pad } from "s";\nexport const via = () => tag + pad;\n');
write("node_modules/s/package.json", JSON.stringify({ name: "s", version: "1.0.0", type: "module", main: "index.js" }));
write("node_modules/s/index.js", 'export const pad = "!";\n');
fs.symlinkSync("../packages/w", path.join(root, "node_modules/w"), "dir");
execFileSync("git", ["init", "-q"], { cwd: root });
execFileSync("git", ["add", "-A"], { cwd: root });
execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base"], { cwd: root });

const { materialise, WORKTREE } = await import("./harness.mts");
const config = {
  root,
  entry: "packages/w/index.js",
  src: ["packages/w"],
  cases: "perf/cases.mts",
  entryModules: { w: "w", d: "d" },
  verifyResolve: ["w", "d"],
} as any;

let failures = 0;
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "ok  " : "FAIL"}  ${name}${detail ? `: ${detail}` : ""}`);
  if (!ok) failures++;
};

/** A working tree with a generated entry must be materialised: the entry exists only in a tree. */
const entry = materialise(config, WORKTREE, "selftest");
check("generated entry exists", fs.existsSync(entry), entry);

const treeDir = path.dirname(entry);
const copied = fs.readdirSync(path.join(treeDir, "node_modules"));
check("dependent of a workspace package is copied", copied.includes("d"));
check("shared package is not copied", !copied.includes("s"));
check("workspace package is linked", fs.lstatSync(path.join(treeDir, "node_modules/w")).isSymbolicLink());
check("ancestor manifest travels with the sources", fs.existsSync(path.join(treeDir, "packages/w/package.json")));

/** The clean tree must pass: a shared dependency resolving to the root is not a leak. */
let clean = true;
try {
  materialise(config, WORKTREE, "selftest");
} catch (error) {
  clean = false;
  console.log(String(error).split("\n").slice(0, 4).join("\n"));
}
check("clean tree passes the resolution check", clean);

/** Removing the copy must be caught, from every importer: that is the leak the check exists for. */
fs.rmSync(path.join(treeDir, "node_modules/d"), { recursive: true, force: true });
let caught = "";
try {
  materialise(config, WORKTREE, "selftest");
} catch (error) {
  caught = String(error);
}
check("missing copy is reported as an escape", caught.includes("resolve outside the tree") && caught.includes(" d "));

fs.rmSync(root, { recursive: true, force: true });
console.log(failures === 0 ? "\nself-test passed" : `\n${failures} check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
