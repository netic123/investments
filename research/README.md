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

The two equity-index targets, `^OMXSBGI` and `^STOXX`, are not investable. The frozen schema-3 and schema-4 research runs tested unified model v1 with `BTC-USD` as Crypto's benchmark and return target. Those protocols, runners and result artifacts are historical evidence and must not be rewritten to describe production v2.

Production model v2 instead uses `CRYPTO-BROAD-EW`: a fixed, daily-rebalanced equal-weight return index of BTC/ETH/SOL/XRP/ADA/DOGE/BNB. It is broader than BTC alone but is not literally every coin, not market-cap weighted and not investable. Its fixed August 2026 constituent selection creates hindsight-selection and survivorship bias when reconstructed backward, and its history starts only when all seven assets have common Yahoo daily closes. Crypto's safe-haven input remains IEF and its credit input remains HYG/LQD. Breadth compares `CRYPTO-NONCORE-EW` (SOL/XRP/ADA/DOGE/BNB) with `CRYPTO-CORE-EW` (BTC/ETH); those constituent sets therefore overlap the broad benchmark. All three synthetic series are analytical daily-rebalanced constructions, not investable or historical market-cap indices. Model v2 requires a new preregistered out-of-sample test before any predictive claim.

The same numerical observation parameters do not imply the same elapsed time. Crypto trades seven days per week, so 252 Crypto observations cover about 8.3 months; 252 equity trading observations cover roughly one trading year. The current UTC date is excluded from Crypto. IEF and HYG/LQD trade on US-market dates, and their latest scored components can carry across weekends for at most seven calendar days. The model's realized-volatility raw calculation uses `sqrt(252)` wherever that mapping is used, so the Crypto raw percentage is not a 365-day annualized volatility. The positive scaling constant does not alter its percentile score.

## Legacy artifacts

The existing files created on `2026-08-23` under `research/artifacts/` are immutable schema-1 outputs from the retired CoinMarketCap-signal experiment. The files carrying timestamp `2026-08-24T20-36-58Z` are immutable schema-2 outputs from the retired separate five-component Crypto model. Neither validates or describes the active unified model. The active schema-3 runner intentionally refuses both old input formats; run it live to freeze a new schema-3 snapshot before drawing a conclusion about the current model.

## Current evidence and the separate rotation direction

The completed retrospective work does **not** support using the displayed Fear
& Greed score as a strategy that reliably beats buy-and-hold in all five
markets. Do not select a later model on the already inspected history and call
that a clean holdout.

The schema-12 exploratory rule search
([`FEAR_GREED_RULE_SEARCH_PROTOCOL.md`](FEAR_GREED_RULE_SEARCH_PROTOCOL.md),
[`fear_greed_rule_search.js`](fear_greed_rule_search.js), run 2026-08-27)
extended the tested space to the previously unexplored momentum direction:
score-vs-own-SMA crossovers, score slope, persistent level rules,
momentum-direction hysteresis, single-component rules, component ensemble
votes and price-trend/sentiment hybrids — 45 candidates under a
development/holdout split with a replay-bound selection file. Outcome:
`EXPLORATORY_NO_HOLDOUT_WINNER`. USA, Europe and Global produced zero
development survivors out of 45 after costs; Sweden's lone marginal survivor
lost its holdout outright; Crypto's development winner (`CSMAX_M_strength`,
the strength component against its own 63-observation mean) beat buy-and-hold
at base cost on the holdout with roughly half the drawdown but failed the
0.75% stress-cost gate and sat only at the 77th percentile of 199 timing
placebos. Under its own stop rule the study is closed; it is the seventh
rule family falsified against this endpoint.

The source and history audit is in
[`DATA_SOURCE_AUDIT_2026-08-25.md`](DATA_SOURCE_AUDIT_2026-08-25.md). It
separates real market identity, total-return status, currency, investability,
point-in-time membership and current-vintage revision risk. In particular,
price indices such as `^STOXX` cannot be used as dividend-inclusive
buy-and-hold comparators, and the fixed seven-coin basket is not a historical
all-crypto market.

A fundamentally different cross-market relative/absolute momentum portfolio is
frozen in [`GEM_ROTATION_REPLICATION_PROTOCOL.md`](GEM_ROTATION_REPLICATION_PROTOCOL.md)
and implemented by [`gem_rotation.js`](gem_rotation.js). It deliberately uses
no Fear & Greed components. The runner currently returns `DATA_REQUIRED`
against the old schema-5 snapshot because the repository does not yet contain
five verified USD total-return risky series and a genuine cash total-return
index:

```powershell
node research/gem_rotation.js --audit research/local-artifacts/final-frozen/inputs/fear-greed-model-search-input-2026-08-24T22-13-44Z.json
```

The longer four-ETF falsification panel is separately frozen in
[`EQUITY_ROTATION_FALSIFICATION_PROTOCOL.md`](EQUITY_ROTATION_FALSIFICATION_PROTOCOL.md).
It can reject a weak rotation idea using history from 2008, but it cannot prove
a five-market edge or repair the missing broad investable crypto history.

Finally, [`FEAR_GREED_V3_PROSPECTIVE_LOCKBOX_PROTOCOL.md`](FEAR_GREED_V3_PROSPECTIVE_LOCKBOX_PROTOCOL.md)
specifies how an eventual surviving model must be collected prospectively with
append-only raw payloads, revisions and hashes. It is a design only; the
lockbox is not activated.

## Official Treasury reality check for the v2 cash proxy

The data-only [`TREASURY_13W_CASH_AUDIT_2026-08-25.md`](TREASURY_13W_CASH_AUDIT_2026-08-25.md)
compares the frozen v2 DTB3 cash reconstruction with 1,638 matured official
13-week Treasury-bill auctions over their exact issue-to-maturity dates. The
audit uses the historical multiple-price/noncompetitive and single-price rules,
reports absolute-error tails and valid non-overlapping cumulative roll paths,
and explicitly validates positive cash only—not borrowing or any strategy.

```powershell
node research/treasury_13w_cash_audit.js
node --test test/treasury_13w_cash_audit.test.js
```
