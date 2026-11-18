# Signal Atlas

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/agitdut/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/agitdut/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A static, offline token launch radar built from the sealed DefiLlama snapshot. It ranks 250 records: all 40 watchlist entries and all 210 below-floor protocols that record no token. Token-bearing protocols supply comparables, never ranked candidates.

Value = TVL × category market-cap/TVL multiple × bounded weekly growth × listing maturity × a small chain-diversity bonus. Sparse categories shrink toward the global median. This is our implied FDV-like estimate, not observed FDV or make.fun's claim. Listing age is not verified token-free history. Farm plans are category-derived trial workflows with estimated fees, time and capital at risk; the snapshot does not confirm live routes or rewards.

Run with Node 22 supporting TypeScript stripping (use `--experimental-strip-types` on older Node 22 releases):

```sh
MAKEFUN_OUTPUT_DIR=/tmp/radar-output node main.ts --input <kit-dir>/input/snapshot.json
node verify.mjs /tmp/radar-output <kit-dir>/input/snapshot.json
```

Open `/tmp/radar-output/dashboard/index.html` locally; all scripts and styles are local. The default build reads `/input/snapshot.json` (the scorer's sealed mount; the snapshot ships with the harness kit and is not stored in this repo) and writes `/output`. `--input` also accepts a directory; `--output` overrides the output environment variable. No dependencies or network are used by the build or dashboard.
