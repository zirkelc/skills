# generic runtime

Out-of-process A/B runner for any language with a benchmark command. Needs Python 3.9 or later and git, no packages.

## How it works

`ab_cmd.py` unpacks each revision with `git archive` into `.perf-trees/<sha>-<slot>` (one directory per side), runs the build command once per tree (cached for committed revisions, rerun every time for the working tree), and then runs the two benchmark commands alternately: A,B on even iterations, B,A on odd ones.

Both sides of one iteration share the same machine state, so the delta is the median of their per-iteration ratios, printed with the interquartile band of those ratios; a band marked `?` contains 0%, which means this run does not confirm the direction (confirm it with the second run the method requires), and a band marked `~` is wide against its own median. The absolute milliseconds are the per-side minima. Two summaries follow: TOTAL weights each case by its time, GEOMEAN weights every case equally.

## Commands

```sh
# noise control (discard the first run, which builds the trees)
python3 perf/ab_cmd.py main main --build "cargo build --release" --run "./target/release/bench" --format json

# previous commit vs current commit
python3 perf/ab_cmd.py HEAD~1 HEAD --build "cargo build --release" --run "./target/release/bench" --format json

# HEAD vs working tree, whole command timed
python3 perf/ab_cmd.py --run "python3 -m mypkg.bench"
```

Options: `--paths` (what to archive, default the whole repo), `--workdir` (where commands run inside a tree, for sub-projects), `--trees-dir`, `--iters` (15), `--warmup` (2), `--format wall|json`. `{tree}` in `--run` and `--build` expands to the absolute tree path.

## Writing the benchmark command

Prefer `--format json`: the benchmark times its own cases and prints one line per case:

```json
{"case": "parse-success", "ns": 18234}
```

Inside the command, warm up, repeat each case many times, and print the minimum. This excludes process start-up and loading from the measurement. `--format wall` times the whole process and is only suitable when the work is much longer than start-up.

Use the same deterministic, seeded cases for the guard: add a mode to the benchmark program (or a sibling script) that prints the behaviour samples, and compare its output hash with a recorded file.

## Ecosystem notes

- **Rust.** Point `--run` at a small binary or `cargo bench` target that prints JSON lines. Every tree builds from scratch, so the first run is slow; later runs reuse the cached build. Do not share `CARGO_TARGET_DIR` between trees.
- **Go.** A `testing.B` benchmark can print JSON lines through a small `TestMain`, or run `go test -bench . -count 1` per iteration and parse `ns/op` in a wrapper. `benchstat` over interleaved runs is an acceptable alternative.
- **Python.** Make sure each tree imports its own copy: run with `PYTHONPATH={tree}/src` (or the package root) and never against an editable install of the working tree, which would leak into both sides. Check this with the canary test.
- **Noise.** Separate processes add start-up, allocator and cache effects, so the noise floor is usually higher than with in-process pairing. Calibrate with at least three control runs and raise `--iters` if the floor is above 2%.
