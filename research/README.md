# Fear & Greed backtest runner

This research runner tests whether the repository's four equity Fear & Greed composites and CoinMarketCap's published crypto Fear & Greed history predict later market returns. It is dependency-free and uses Node's built-in `fetch`, crypto, and filesystem APIs.

The frozen design is in `FEAR_GREED_PROTOCOL.md`. The implementation deliberately treats the work as exploratory and not ready for capital.

## Run live and freeze inputs

From the repository root:

```powershell
node research/fear_greed_backtest.js
```

The run writes dated artifacts below `research/artifacts/`:

- `inputs/fear-greed-input-<UTC timestamp>.json`
- `inputs/fear-greed-input-<UTC timestamp>.sha256`
- `results/fear-greed-results-<UTC timestamp>.json`
- `results/fear-greed-report-<UTC timestamp>.md`

The input JSON is canonicalized before hashing. It records retrieval times, endpoint identities, Node version, the exact normalized score and price histories, target metadata, and SHA-256 hashes of `marketfg.js`, `data/config.json`, and the backtest script.

## Re-run without network access

```powershell
node research/fear_greed_backtest.js --snapshot research/artifacts/inputs/fear-greed-input-2026-08-23T00-00-00Z.json
```

The saved-snapshot path makes no network requests. If the adjacent `.sha256` file exists, the runner verifies it and stops on a mismatch. New dated result files are produced, while the frozen input is left unchanged.

For reproducibility checks, compare `analysisFingerprintSha256` between runs. Runtime timestamps and output paths intentionally differ, but the fingerprint covers the frozen design, all trial statistics, decisions, and market results. The result also states whether the currently executing backtest/protocol hashes match those frozen in the input snapshot.

An alternate artifact directory can be supplied with `--out-dir`.

## Core timing convention

A score dated target bar `t` is never paired with the same close. It becomes actionable at the close of target bar `t+1`; an `h`-bar outcome ends at the close of `t+1+h`. Signal dates must match a target price date exactly. Equity primary rows must contain all six model components. Missing scores are not backfilled. At the 60/40 split, training observations whose outcomes extend beyond the first holdout entry are purged, preventing long-horizon outcome overlap across the boundary.

The two index targets, `^OMXSBGI` and `^STOXX`, are not investable. `BTC-USD` is an explicit assumed target for CoinMarketCap's market-wide crypto signal, not a provider-specified benchmark.
