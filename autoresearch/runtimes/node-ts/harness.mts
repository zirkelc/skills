/**
 * Shared helpers for the node-ts autoresearch harness: configuration, revision
 * materialisation, case loading and deterministic data helpers.
 */
import { execFileSync, execSync } from "node:child_process";
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

/** One benchmark workload. */
export interface PerfCase {
  /** Stable name, used as the key in reports and in the guard file. */
  name: string;
  /** Timed body. Must be deterministic and side-effect free across calls. */
  run: () => void;
  /** Serializable sample of observable behaviour, hashed by the guard. */
  collect: () => unknown;
  /** Optional: create and return one retained instance, measured by the memory harness. */
  alloc?: () => unknown;
  /**
   * Optional: build the case's inputs just before it runs. Inputs of every case held alive for a
   * whole run (twice, once per revision) make each collection slower and every timing noisier, so
   * a case that needs large inputs should build them here and drop them in `teardown`.
   */
  setup?: () => void;
  /** Optional: release what `setup` built. */
  teardown?: () => void;
}

/** A cases module exports this function. It receives the module namespace of the entry point. */
export type BuildCases = (lib: any) => Array<PerfCase>;

/** Pseudo revision that means "the working tree as it is on disk". */
export const WORKTREE = "WORKTREE";

export interface HarnessConfig {
  /** Absolute repo root. */
  root: string;
  /** Entry point, relative to the repo root (for example `packages/lib/src/index.ts`). */
  entry: string;
  /** Paths archived per revision, relative to the repo root. */
  src: Array<string>;
  /** Cases module, relative to the repo root. */
  cases: string;
  /**
   * Command that turns the sources of a tree into what users load, run with the tree root as the
   * working directory. Set it whenever the shipped artifact is generated, especially when it is
   * gitignored: without it the harness would measure whatever happens to lie on disk.
   */
  build?: string | undefined;
  /**
   * Command run once per workspace, in the order of the root manifest's `workspaces` field, for
   * builds where a package needs its dependencies built first.
   */
  buildWorkspaces?: string | undefined;
  /**
   * Third-party packages that import the workspace packages by name. They are copied into the
   * tree (a symlink would resolve to its realpath and pull in the working tree again). Matched as
   * a regular expression against the directory names in the root `node_modules`.
   */
  copyDependents?: string | undefined;
  /**
   * Generates the tree's entry from a map of alias to specifier, so the cases receive one `lib`
   * whose parts all come from the same revision. Specifiers are package names or paths relative to
   * the tree root. When set, this replaces `entry` as the imported module.
   */
  entryModules?: Record<string, string> | undefined;
  /** Package names whose resolution must stay inside the tree. Checked once per materialisation. */
  verifyResolve?: Array<string> | undefined;
}

const CONFIG_FILE = "perf.config.json";

/**
 * Reads `perf.config.json` next to the harness scripts, then applies CLI flags on top.
 * Returns the resolved config and the remaining positional arguments.
 */
export function loadConfig(
  harnessDir: string,
  argv: Array<string>,
  extraOptions: Record<string, { type: "string" | "boolean"; multiple?: boolean }> = {}
): { config: HarnessConfig; positionals: Array<string>; values: Record<string, any> } {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      entry: { type: "string" },
      src: { type: "string", multiple: true },
      cases: { type: "string" },
      ...extraOptions,
    },
  });

  const configPath = path.join(harnessDir, CONFIG_FILE);
  const fileConfig = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, "utf8")) : {};

  const root = execFileSync("git", ["rev-parse", "--show-toplevel"], { cwd: harnessDir }).toString().trim();
  const entry = (values.entry as string | undefined) ?? fileConfig.entry;
  const src = (values.src as Array<string> | undefined) ?? fileConfig.src;
  const cases = (values.cases as string | undefined) ?? fileConfig.cases ?? path.relative(root, path.join(harnessDir, "cases.mts"));

  if (!entry || !src?.length) {
    throw new Error(`Set "entry" and "src" in ${configPath} or pass --entry and --src.`);
  }
  return {
    config: {
      root,
      entry,
      src,
      cases,
      build: fileConfig.build,
      buildWorkspaces: fileConfig.buildWorkspaces,
      copyDependents: fileConfig.copyDependents,
      entryModules: fileConfig.entryModules,
      verifyResolve: fileConfig.verifyResolve,
    },
    positionals,
    values,
  };
}

/**
 * Trees live under `node_modules/.perf-trees` when that directory exists. Everything in a repo
 * already ignores `node_modules`: formatters, linters, type checkers and test globs. `.git/info/
 * exclude` only hides a directory from git, which is not the same thing and was not enough.
 */
function treesDir(config: HarnessConfig): string {
  const inNodeModules = path.join(config.root, "node_modules");
  const base = fs.existsSync(inNodeModules) ? inNodeModules : config.root;
  return path.join(base, ".perf-trees");
}

/** Content hash of the working tree's tracked and untracked source files. */
function worktreeKey(config: HarnessConfig): string {
  const listed = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "--", ...config.src], {
    cwd: config.root,
    maxBuffer: 1 << 28,
  })
    .toString()
    .split("\n")
    .filter(Boolean)
    .sort();
  const hash = crypto.createHash("sha1");
  for (const rel of listed) {
    hash.update(rel);
    hash.update("\0");
    try {
      hash.update(fs.readFileSync(path.join(config.root, rel)));
    } catch {
      /* deleted between listing and reading */
    }
  }
  return `wt-${hash.digest("hex").slice(0, 16)}`;
}

/**
 * Materialises `rev` into its own directory and returns the absolute entry path inside it.
 *
 * One directory per slot, so a revision compared with itself still gives two real copies. The
 * working tree is materialised too whenever a build is configured, and keyed by the content of its
 * sources: an unchanged tree reuses its build, any edit produces a new one, and no side can fall
 * back to a stale artifact on disk.
 */
export function materialise(config: HarnessConfig, rev: string, slot: string): string {
  const builds = Boolean(config.build || config.buildWorkspaces);
  if (rev === WORKTREE && !builds) return entryPath(config, config.root);

  const key =
    rev === WORKTREE
      ? worktreeKey(config)
      : execFileSync("git", ["rev-parse", `${rev}^{commit}`], { cwd: config.root }).toString().trim();
  const dir = path.join(treesDir(config), `${key}-${slot}`);

  if (!fs.existsSync(dir)) {
    const tmp = `${dir}.tmp-${process.pid}`;
    fs.mkdirSync(tmp, { recursive: true });
    if (rev === WORKTREE) {
      copyWorktree(config, tmp);
    } else {
      const tar = execFileSync("git", ["archive", "--format=tar", key, "--", ...config.src], {
        cwd: config.root,
        maxBuffer: 1 << 30,
      });
      execFileSync("tar", ["-x", "-C", tmp], { input: tar });
    }
    linkWorkspacePackages(config, tmp);
    copyDependents(config, tmp);
    linkNodeModules(config, tmp);
    writeGeneratedEntry(config, tmp);
    runBuild(config, tmp);
    fs.renameSync(tmp, dir);
  }
  verifyResolution(config, dir);
  return entryPath(config, dir);
}

function entryPath(config: HarnessConfig, treeDir: string): string {
  return path.join(treeDir, config.entryModules ? "perf-entry.mjs" : config.entry);
}

/** Copies the working tree's source files, tracked and untracked, ignoring what git ignores. */
function copyWorktree(config: HarnessConfig, treeDir: string): void {
  const listed = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "--", ...config.src], {
    cwd: config.root,
    maxBuffer: 1 << 28,
  })
    .toString()
    .split("\n")
    .filter(Boolean);
  for (const rel of listed) {
    const target = path.join(treeDir, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(config.root, rel), target);
  }
}

/** Every package inside the tree becomes resolvable by name from within the tree. */
function linkWorkspacePackages(config: HarnessConfig, treeDir: string): void {
  const modulesDir = path.join(treeDir, "node_modules");
  for (const src of config.src) {
    for (const pkgDir of findPackages(path.join(treeDir, src))) {
      let name: string;
      try {
        name = JSON.parse(fs.readFileSync(path.join(pkgDir, "package.json"), "utf8")).name;
      } catch {
        continue;
      }
      if (!name) continue;
      const link = path.join(modulesDir, name);
      if (fs.existsSync(link)) continue;
      fs.mkdirSync(path.dirname(link), { recursive: true });
      fs.symlinkSync(path.relative(path.dirname(link), pkgDir), link, "dir");
    }
  }
}

function findPackages(dir: string): Array<string> {
  if (!fs.existsSync(dir)) return [];
  const found: Array<string> = [];
  if (fs.existsSync(path.join(dir, "package.json"))) found.push(dir);
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && entry.name !== "node_modules") {
      found.push(...findPackages(path.join(dir, entry.name)));
    }
  }
  return found;
}

/**
 * Third-party packages that import the workspace packages by name need a real copy in the tree.
 * A symlink resolves to its realpath in the root `node_modules`, and from there the package would
 * import the working tree's code again, which puts one revision on both sides of the comparison.
 */
function copyDependents(config: HarnessConfig, treeDir: string): void {
  if (!config.copyDependents) return;
  const pattern = new RegExp(config.copyDependents);
  const rootModules = path.join(config.root, "node_modules");
  if (!fs.existsSync(rootModules)) return;
  const names: Array<string> = [];
  for (const entry of fs.readdirSync(rootModules, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (entry.name.startsWith("@")) {
      for (const scoped of fs.readdirSync(path.join(rootModules, entry.name))) names.push(`${entry.name}/${scoped}`);
    } else {
      names.push(entry.name);
    }
  }
  for (const name of names.filter((n) => pattern.test(n))) {
    const target = path.join(treeDir, "node_modules", name);
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(path.join(rootModules, name), target, { recursive: true, dereference: true });
  }
}

/**
 * Workspace packages often keep their own `node_modules` next to their sources. Link the ones that
 * exist between a source path and the repo root; the root `node_modules` is reached by normal
 * upward resolution.
 */
function linkNodeModules(config: HarnessConfig, treeDir: string): void {
  for (const src of config.src) {
    let rel = path.dirname(src);
    while (rel && rel !== "." && rel !== path.sep) {
      const real = path.join(config.root, rel, "node_modules");
      const link = path.join(treeDir, rel, "node_modules");
      if (fs.existsSync(real) && !fs.existsSync(link) && fs.existsSync(path.dirname(link))) {
        fs.symlinkSync(real, link, "dir");
      }
      rel = path.dirname(rel);
    }
  }
}

/** Writes an entry that re-exports the library and the ecosystem pieces the cases need. */
function writeGeneratedEntry(config: HarnessConfig, treeDir: string): void {
  if (!config.entryModules) return;
  const lines = Object.entries(config.entryModules).map(([alias, specifier]) => {
    const target = specifier.startsWith(".") || specifier.includes("/") && fs.existsSync(path.join(treeDir, specifier))
      ? `./${path.relative(treeDir, path.join(treeDir, specifier))}`
      : specifier;
    return `export * as ${alias} from ${JSON.stringify(target)};`;
  });
  fs.writeFileSync(path.join(treeDir, "perf-entry.mjs"), `${lines.join("\n")}\n`);
}

/** Runs the repo's build inside the tree, in workspace order when the build needs it. */
function runBuild(config: HarnessConfig, treeDir: string): void {
  const env = { ...process.env, PATH: `${path.join(config.root, "node_modules", ".bin")}:${process.env.PATH ?? ""}` };
  if (config.buildWorkspaces) {
    for (const workspace of workspaceOrder(config)) {
      const cwd = path.join(treeDir, workspace);
      if (!fs.existsSync(cwd)) continue;
      execSync(config.buildWorkspaces, { cwd, env, stdio: "inherit" });
    }
  }
  if (config.build) execSync(config.build, { cwd: treeDir, env, stdio: "inherit" });
}

/** The root manifest's `workspaces` order, which is the order a dependency-aware build needs. */
function workspaceOrder(config: HarnessConfig): Array<string> {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(config.root, "package.json"), "utf8"));
    const workspaces = Array.isArray(manifest.workspaces) ? manifest.workspaces : (manifest.workspaces?.packages ?? []);
    return workspaces.filter((w: string) => !w.includes("*"));
  } catch {
    return [];
  }
}

/**
 * Asserts that the configured package names resolve inside the tree. A resolution that escapes to
 * the repo root puts the working tree's code on both sides of the comparison, which produces
 * plausible numbers and no symptom, so this runs before any measurement rather than after one.
 */
function verifyResolution(config: HarnessConfig, treeDir: string): void {
  if (!config.verifyResolve?.length) return;
  const probe = path.join(treeDir, "perf-resolve-check.mjs");
  fs.writeFileSync(
    probe,
    `const names = ${JSON.stringify(config.verifyResolve)};\n` +
      `const out = {};\nfor (const n of names) { try { out[n] = import.meta.resolve(n); } catch (e) { out[n] = String(e); } }\n` +
      `console.log(JSON.stringify(out));\n`
  );
  const resolved = JSON.parse(execFileSync(process.execPath, [probe], { encoding: "utf8" }));
  const escaped = Object.entries(resolved).filter(([, url]) => !String(url).includes(treeDir));
  if (escaped.length) {
    throw new Error(
      `These packages resolve outside the tree, so both sides would load the same code:\n` +
        escaped.map(([name, url]) => `  ${name} -> ${url}`).join("\n")
    );
  }
}

/**
 * Imports the entry module and builds the cases against it.
 *
 * `slot` gives this side its own instance of the cases module. Without it both revisions share one
 * instance, so every case function sees two hidden-class families and can report a large, stable
 * delta for code that neither revision touched. See `references/methodology.md`.
 */
export async function loadCases(config: HarnessConfig, entryPath: string, slot?: string): Promise<Array<PerfCase>> {
  const lib = await import(pathToFileURL(entryPath).href);
  const casesUrl = pathToFileURL(path.join(config.root, config.cases)).href;
  const casesModule = await import(slot ? `${casesUrl}?slot=${slot}` : casesUrl);
  const build: BuildCases | undefined = casesModule.buildCases;
  if (typeof build !== "function") throw new Error(`${config.cases} must export buildCases(lib).`);
  return build(lib);
}

/** mulberry32 PRNG, for seeded and reproducible benchmark inputs. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** FNV-1a 32-bit hash of a string. */
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Wall-clock duration of `fn` in nanoseconds. */
export function timeNs(fn: () => void): number {
  const start = process.hrtime.bigint();
  fn();
  return Number(process.hrtime.bigint() - start);
}
