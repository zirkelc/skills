#!/usr/bin/env python3
"""Paired A/B timing of two git revisions through an external benchmark command.

Use this runner for any runtime that cannot load two copies of the code into one
process (Rust, Go, C/C++, Python, JVM without class-loader isolation, ...).

    python3 ab_cmd.py [REV_A=HEAD] [REV_B=WORKTREE] --run "CMD" [--build "CMD"]

Each revision is unpacked with `git archive` into its own directory, built once
(the build is cached per commit and slot, except for WORKTREE), and the two
benchmark commands then run alternately: A,B on even iterations and B,A on odd
ones, so slow machine drift hits both sides equally. The minimum per case is
reported. Negative delta = REV_B is faster.

Output formats of the benchmark command (--format):
  wall  time the whole command as one case called "wall" (default)
  json  parse stdout lines like {"case": "parse", "ns": 12345}; the minimum per
        case is kept. Use this when the benchmark can time its own cases, which
        excludes process start-up noise.

`{tree}` in --run and --build is replaced by the absolute tree directory. Commands
run with the tree (or --workdir inside it) as the working directory.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
import time
from pathlib import Path

WORKTREE = "WORKTREE"


def repo_root() -> Path:
    out = subprocess.run(["git", "rev-parse", "--show-toplevel"], check=True, capture_output=True, text=True)
    return Path(out.stdout.strip())


def materialise(root: Path, trees_dir: Path, rev: str, slot: str, paths: list[str]) -> Path:
    """Return the directory holding `rev`. One directory per slot, so a revision
    compared with itself still gives two independent builds."""
    if rev == WORKTREE:
        return root
    sha = subprocess.run(
        ["git", "rev-parse", f"{rev}^{{commit}}"], cwd=root, check=True, capture_output=True, text=True
    ).stdout.strip()
    target = trees_dir / f"{sha}-{slot}"
    if not target.exists():
        tmp = trees_dir / f"{sha}-{slot}.tmp-{os.getpid()}"
        tmp.mkdir(parents=True)
        archive = subprocess.run(["git", "archive", "--format=tar", sha, "--", *paths], cwd=root, check=True, capture_output=True)
        subprocess.run(["tar", "-x", "-C", str(tmp)], input=archive.stdout, check=True)
        tmp.rename(target)
    return target


def build(tree: Path, workdir: str, cmd: str | None, cached: bool) -> None:
    if not cmd:
        return
    marker = tree / ".ab-built"
    if cached and marker.exists():
        return
    print(f"building {tree} ...", file=sys.stderr)
    subprocess.run(cmd.replace("{tree}", str(tree)), shell=True, cwd=tree / workdir, check=True, stdout=sys.stderr)
    if cached:
        marker.write_text(cmd)


def run_once(tree: Path, workdir: str, cmd: str, fmt: str) -> dict[str, float]:
    """Run the benchmark command once and return ns per case."""
    start = time.perf_counter_ns()
    res = subprocess.run(cmd.replace("{tree}", str(tree)), shell=True, cwd=tree / workdir, capture_output=True, text=True)
    elapsed = time.perf_counter_ns() - start
    if res.returncode != 0:
        raise SystemExit(f"benchmark command failed in {tree}:\n{res.stderr}")
    if fmt == "wall":
        return {"wall": float(elapsed)}
    cases: dict[str, float] = {}
    for line in res.stdout.splitlines():
        line = line.strip()
        if not line.startswith("{"):
            continue
        row = json.loads(line)
        name = row.get("case") or row.get("name")
        if name is None or "ns" not in row:
            continue
        cases[name] = min(cases.get(name, math.inf), float(row["ns"]))
    if not cases:
        raise SystemExit('No {"case": ..., "ns": ...} lines on stdout. Use --format wall or fix the benchmark output.')
    return cases


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("rev_a", nargs="?", default="HEAD")
    parser.add_argument("rev_b", nargs="?", default=WORKTREE)
    parser.add_argument("--run", required=True, help="benchmark command")
    parser.add_argument("--build", help="build command, run once per tree")
    parser.add_argument("--paths", nargs="+", default=["."], help="paths to archive (default: whole repo)")
    parser.add_argument("--workdir", default=".", help="directory inside the tree where commands run")
    parser.add_argument("--trees-dir", help="where trees are unpacked (default: <repo>/.perf-trees)")
    parser.add_argument("--format", choices=["wall", "json"], default="wall")
    parser.add_argument("--iters", type=int, default=15)
    parser.add_argument("--warmup", type=int, default=2)
    args = parser.parse_args()

    root = repo_root()
    trees_dir = Path(args.trees_dir).resolve() if args.trees_dir else root / ".perf-trees"
    tree_a = materialise(root, trees_dir, args.rev_a, "a", args.paths)
    tree_b = materialise(root, trees_dir, args.rev_b, "b", args.paths)
    build(tree_a, args.workdir, args.build, cached=args.rev_a != WORKTREE)
    build(tree_b, args.workdir, args.build, cached=args.rev_b != WORKTREE)

    for _ in range(args.warmup):
        run_once(tree_a, args.workdir, args.run, args.format)
        run_once(tree_b, args.workdir, args.run, args.format)

    min_a: dict[str, float] = {}
    min_b: dict[str, float] = {}
    for i in range(args.iters):
        order = [("a", tree_a), ("b", tree_b)] if i % 2 == 0 else [("b", tree_b), ("a", tree_a)]
        for side, tree in order:
            target = min_a if side == "a" else min_b
            for name, ns in run_once(tree, args.workdir, args.run, args.format).items():
                target[name] = min(target.get(name, math.inf), ns)

    names = [n for n in min_a if n in min_b]
    if set(min_a) != set(min_b):
        print(f"warning: case sets differ, comparing {len(names)} shared cases", file=sys.stderr)

    ms = lambda ns: f"{ns / 1e6:10.4f}"
    print(f"A = {args.rev_a}, B = {args.rev_b} (min of {args.iters} alternating runs, ms)")
    print(f"{'case':<26}{'A':>10}{'B':>10}{'delta':>9}{'speed':>9}")
    total_a = total_b = 0.0
    for name in names:
        a, b = min_a[name], min_b[name]
        total_a += a
        total_b += b
        print(f"{name:<26}{ms(a)}{ms(b)} {(b / a - 1) * 100:7.2f}% {a / b:7.2f}x")
    print(f"{'TOTAL':<26}{ms(total_a)}{ms(total_b)} {(total_b / total_a - 1) * 100:7.2f}% {total_a / total_b:7.2f}x")


if __name__ == "__main__":
    main()
