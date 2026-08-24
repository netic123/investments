# Fear & Greed backtest runner

This research runner tests whether the repository's one unified Fear & Greed model, applied to Crypto, Sweden, USA, Europe and Global, predicts later market returns. All five signals are recomputed by `marketfg.js` with the same six-component engine, trailing 252-observation percentile scoring, 126-valid-observation minimum, six-component requirement, directions, equal weights and labels. The configured raw proxies differ; volatility is an implied-volatility level where configured and benchmark realized volatility otherwise. It is dependency-free and uses Node's built-in `fetch`, crypto, and filesystem APIs. The active runner does not download or use any published third-party Fear & Greed score.

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
node research/fear_greed_backtest.js --snapshot research/artifacts/inputs/<schema-3-snapshot>.json
```

The saved-snapshot path makes no network requests. If the adjacent `.sha256` file exists, the runner verifies it and stops on a mismatch. New dated result files are produced, while the frozen input is left unchanged.

For reproducibility checks, compare `analysisFingerprintSha256` between runs. Runtime timestamps and output paths intentionally differ, but the fingerprint covers the frozen design, all trial statistics, decisions, and market results. The result also states whether the currently executing backtest/protocol hashes match those frozen in the input snapshot.

An alternate artifact directory can be supplied with `--out-dir`.

## Core timing convention

A score dated target bar `t` is never paired with the same close. It becomes actionable at the close of target bar `t+1`; an `h`-bar outcome ends at the close of `t+1+h`. Signal dates must match a target price date exactly. Every market's primary rows must contain all six model components. Missing scores are not backfilled. At the 60/40 split, training observations whose outcomes extend beyond the first holdout entry are purged, preventing long-horizon outcome overlap across the boundary.

The two index targets, `^OMXSBGI` and `^STOXX`, are not investable. For Crypto, `BTC-USD` is both the configured benchmark and explicit return target, but it is not the entire crypto market. Crypto's safe-haven input is IEF and its credit input is HYG/LQD. Breadth compares `CRYPTO-NONCORE-EW` (fixed SOL/XRP/ADA/DOGE/BNB equal-weight return index) with `CRYPTO-CORE-EW` (fixed BTC/ETH equal-weight return index). Both synthetic series are analytical daily-rebalanced constructions, not investable or historical market-cap indices.

The same numerical observation parameters do not imply the same elapsed time. Crypto trades seven days per week, so 252 Crypto observations cover about 8.3 months; 252 equity trading observations cover roughly one trading year. The current UTC date is excluded from Crypto. IEF and HYG/LQD trade on US-market dates, and their latest scored components can carry across weekends for at most seven calendar days. The model's realized-volatility raw calculation uses `sqrt(252)` wherever that mapping is used, so the Crypto raw percentage is not a 365-day annualized volatility. The positive scaling constant does not alter its percentile score.

## Legacy artifacts

The existing files created on `2026-08-23` under `research/artifacts/` are immutable schema-1 outputs from the retired CoinMarketCap-signal experiment. The files carrying timestamp `2026-08-24T20-36-58Z` are immutable schema-2 outputs from the retired separate five-component Crypto model. Neither validates or describes the active unified model. The active schema-3 runner intentionally refuses both old input formats; run it live to freeze a new schema-3 snapshot before drawing a conclusion about the current model.
