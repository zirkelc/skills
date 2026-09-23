#!/usr/bin/env python3
"""Paired A/B timing of two git revisions through an external benchmark command.

Use this runner for any runtime that cannot load two copies of the code into one
process (Rust, Go, C/C++, Python, JVM without class-loader isolation, ...).

    python3 ab_cmd.py [REV_A=HEAD] [REV_B=WORKTREE] --run "CMD" [--build "CMD"]

Each revision is unpacked with `git archive` into its own directory, built once
(the build is cached per commit and slot, except for WORKTREE), and the two
benchmark commands then run alternately: A,B on even iterations and B,A on odd
ones, so both sides of one iteration share the same machine state. The delta is
the median of the per-iteration ratios (the pairing survives that way, while a
quotient of two independently drawn minima does not); the absolute numbers are
the per-side minima. Negative delta = REV_B is faster.

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
    ratios: dict[str, list[float]] = {}
    for i in range(args.iters):
        order = [("a", tree_a), ("b", tree_b)] if i % 2 == 0 else [("b", tree_b), ("a", tree_a)]
        this_iter: dict[str, dict[str, float]] = {}
        for side, tree in order:
            this_iter[side] = run_once(tree, args.workdir, args.run, args.format)
            target = min_a if side == "a" else min_b
            for name, ns in this_iter[side].items():
                target[name] = min(target.get(name, math.inf), ns)
        for name, ns_a in this_iter["a"].items():
            ns_b = this_iter["b"].get(name)
            if ns_b is not None and ns_a > 0:
                ratios.setdefault(name, []).append(ns_b / ns_a)

    names = [n for n in min_a if n in min_b]
    if set(min_a) != set(min_b):
        print(f"warning: case sets differ, comparing {len(names)} shared cases", file=sys.stderr)

    def quantile(values: list[float], q: float) -> float:
        xs = sorted(values)
        pos = (len(xs) - 1) * q
        lo, hi = math.floor(pos), math.ceil(pos)
        return xs[lo] if lo == hi else xs[lo] + (xs[hi] - xs[lo]) * (pos - lo)

    ms = lambda ns: f"{ns / 1e6:10.4f}"
    print(f"A = {args.rev_a}, B = {args.rev_b} (min ms of {args.iters} alternating runs; delta = median of paired ratios)")
    print(f"{'case':<26}{'A':>10}{'B':>10}{'delta':>9}{'band':>16}{'speed':>9}")
    total_a = total_b = 0.0
    log_sum = 0.0
    for name in names:
        a, b = min_a[name], min_b[name]
        ratio = quantile(ratios[name], 0.5)
        lo = (quantile(ratios[name], 0.25) - 1) * 100
        hi = (quantile(ratios[name], 0.75) - 1) * 100
        median_pct = (ratio - 1) * 100
        if lo < 0 < hi:
            marker = "?"  # the iterations disagree about the direction: no effect
        elif hi - lo > 2 * abs(median_pct):
            marker = "~"  # wide against its own median: confirm the case standalone
        else:
            marker = " "
        total_a += a
        total_b += a * ratio
        log_sum += math.log(ratio)
        band = f"{lo:+.1f}..{hi:+.1f}%{marker}"
        print(f"{name:<26}{ms(a)}{ms(a * ratio)} {(ratio - 1) * 100:7.2f}%{band:>16} {1 / ratio:7.2f}x")
    total_ratio = total_b / total_a
    geo = math.exp(log_sum / len(names))
    print(f"{'TOTAL':<26}{ms(total_a)}{ms(total_b)} {(total_ratio - 1) * 100:7.2f}%{'':>16} {1 / total_ratio:7.2f}x")
    print(f"{'GEOMEAN':<46} {(geo - 1) * 100:7.2f}%{'':>16} {1 / geo:7.2f}x")
    print('(band = interquartile range of per-iteration deltas; "?" = contains 0%, no effect; "~" = wide against its median, confirm standalone)')


if __name__ == "__main__":
    main()
