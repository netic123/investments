# Shared Fear & Greed model-search protocol

Status: design finalized before the first completed candidate execution on 2026-08-25. An earlier schema-4 collection at 2026-08-24 22:09:24 UTC was interrupted after its input snapshot was written; no result artifact or candidate statistic was observed. The data-adequacy rule below was added from an independent methodology review before the completed run, and this protocol supersedes that incomplete attempt.

This is an exploratory historical model-development study. It follows the failed, frozen unified-model-v1 test. It is not a way to keep reusing the same holdout until a desirable chart appears, and it cannot establish live trading reliability. After one complete schema-4 run, no new candidate, threshold or freshly downloaded rerun may be used to rescue its conclusion on the same historical endpoint.

## Question and stop rule

The primary question is whether one common Fear & Greed construction adds out-of-sample information about strictly later returns in each dashboard market after ordinary price and volatility controls.

The existing v1 model failed in all five markets. This study searches one bounded family once. If no candidate passes the rules below, the search stops with **no historically reliable return-prediction model found**. A failed candidate is never retuned on the final segment.

Because the earlier v1 report already exposed market outcomes through August 2026, the final segment below is a **quasi-holdout**, not a pristine confirmatory holdout. Even a historical pass requires a new, forward-frozen paper period before the dashboard may claim reliability.

## Benchmarks

The same market benchmark supplies the model's momentum/strength inputs and the tested return target:

| Tab | Benchmark/target | Role |
|---|---|---|
| Sweden | `^OMXSBGI` | configured Swedish benchmark index |
| USA | `SPY` adjusted close | investable S&P 500 ETF proxy |
| Europe | `^STOXX` | configured European benchmark index |
| Global | `ACWI` adjusted close | investable MSCI ACWI ETF proxy |
| Crypto | Coin Metrics `CMBITM` | CMBI Total Market Index, broad investable-crypto price index |

The Crypto research mapping replaces the present BTC-only/fixed-seven-coin mapping:

- benchmark, volatility and return target: Coin Metrics `CMBITM`;
- safe haven: `IEF`;
- credit: `HYG/LQD`;
- breadth: `CMBITM / BTC-USD`.

Coin Metrics describes CMBITM as a USD, estimated-market-capitalization-weighted index of eligible assets in its Datonomy investable universe. Weights are reset monthly at the New York close and membership is reconstituted quarterly. Eligibility screens exclude pegged assets, on-chain derivatives such as stablecoins and wrapped tokens, illiquid assets and newly traded assets that have not met the minimum history rule. It is therefore a broad investable-universe benchmark, **not literally every token in existence**, and it is not a repository-owned index. The Fear & Greed composite remains repository-owned. The index has uninterrupted calendar-day observations in the captured sample, so the Crypto realized-volatility control and future-risk outcome use 365 while the securities-market tabs use 252. The unchanged production volatility component is scored relative to its own trailing mean, so its hard-coded annualization multiplier is a constant that cancels from the ratio and does not change its percentile score.

The breadth ratio deliberately asks whether the broad investable crypto market is outperforming Bitcoin. Because Bitcoin is itself included in CMBITM, this is an overlapping broad-versus-core ratio rather than a pure ex-Bitcoin breadth index; that limitation must remain visible in the report.

Full CMBITM history is obtained for this one-off study from Coin Metrics' public website endpoint with `frequency=1d-ny-close` and `timezone=America/New_York`. The endpoint is undocumented, while the documented Community API does not provide the full history. The response is therefore captured locally with its raw SHA-256 hash and strict timestamp/value validation. It must not become a production dependency or be redistributed through GitHub Pages without source/licensing confirmation. Methodology version 1.4 gives 1 July 2019 as the first/base-value date and 22 November 2022 as the methodology launch, while the product webpage currently says 1 April 2019; the returned series starts on 1 July 2019, and this source discrepancy must remain visible. Observations before the launch are provider-backtested index history rather than live-calculated history.

## Frozen six-component engine

No raw formula, component direction, percentile rule or input mapping may be changed during the search except for the explicit Crypto mapping above.

The six causal 0–100 component scores are:

1. momentum;
2. strength;
3. volatility, already inverted so high volatility means lower/less-greedy score;
4. safe-haven demand;
5. credit appetite;
6. breadth.

Each component retains the production 252-observation trailing percentile, 126-valid-observation minimum, and at-most-seven-calendar-day cross-market carry rule. Every admitted signal row must contain all six components. Only their positive composite weights and a causal trailing smoothing length may differ.

## Candidate family: exactly 15 specifications

The component order is momentum, strength, volatility, safe haven, credit and breadth. Five coherent positive weight templates are declared:

- equal: `[1, 1, 1, 1, 1, 1]`;
- trend and breadth: `[2, 2, 1, 1, 1, 2]`;
- defensive risk: `[1, 1, 2, 2, 2, 1]`;
- price regime: `[2, 2, 2, 1, 1, 1]`;
- cross-asset risk: `[1, 1, 1, 2, 2, 2]`.

Weights are normalized to sum to one. Every template uses all six components with a strictly positive weight. Each template is evaluated with a trailing arithmetic mean of 1, 5 or 21 signal observations. Smoothing includes the current observation and past observations only. This produces exactly `5 × 3 = 15` shared candidates. No candidate, threshold, interaction, component deletion, nonlinear learner or market-specific weight is added after results are seen.

## Alignment and outcomes

The primary return horizon is 21 observed benchmark bars. Secondary 1-, 5- and 63-bar summaries may be reported for the one selected candidate but cannot rescue a failed primary result.

For a signal on benchmark bar `t`:

- hypothetical entry is the close of `t+1`;
- the 21-bar return exits at the close of `t+22`;
- the future-risk outcome is the log of annualized realized volatility over those same 21 later returns;
- a training row is usable at a forecast origin only when its exit close is already known.

There is no same-bar execution. Missing scores are not filled. Prices and signal dates must match exactly. The current/incomplete provider bar is excluded.

## Controls and forecasts

For each market separately, the controls-only OLS contains information available at `t`:

- lagged 1-, 5- and 20-bar returns;
- trailing 20-bar realized volatility;
- benchmark close relative to its trailing 125-bar average.

The full OLS adds one candidate Fear & Greed score. Every feature is standardized using only that fit's available training rows. Models use an expanding origin and refit every 21 forecast observations. Singular fits fail the candidate; no silent fallback or regularization is introduced.

## Nested chronological selection

Each market's common eligible rows are split chronologically:

- first 50%: initial training history;
- next 25%: development walk-forward forecasts used for candidate selection;
- final 25%: one-time quasi-holdout evaluation.

Candidate selection uses development forecasts only. For every candidate, calculate the relative MSE improvement of controls plus score versus controls alone in each market.

Candidates are ranked lexicographically by:

1. greatest number of markets with positive development MSE improvement;
2. greatest worst-market development improvement;
3. greatest equal-market mean development improvement;
4. the fixed declaration order above.

The selected candidate proceeds even if it fails the development gate, so that the search has a complete auditable outcome. The development return gate requires positive improvement in all five markets and an equal-market mean improvement of at least 0.5%.

Return and future-risk candidates are selected independently from the same frozen 15-specification family. A risk-selected model must never be presented as a return predictor.

## Data-adequacy gate

The 21-bar outcomes overlap heavily, so the number of daily forecast rows is not an effective sample size. For **each market separately** and for **both its development and final segment**, all of the following conservative minimums are required:

1. at least 756 forecast rows;
2. at least 36 exactly non-overlapping 21-bar outcomes, counted greedily in chronological order by admitting the next row only when its entry index is at or after the previously admitted exit index;
3. at least 1,095 calendar days from the first admitted forecast entry to the segment's last forecast exit.

These thresholds represent roughly 36 independent monthly horizons and three calendar years in which multiple regimes can occur. They are an adequacy screen, **not a formal guarantee of statistical power**. Development and final statistics are still calculated and shown when a segment fails this screen, but that tab is labelled `EXPLORATORY_UNDERPOWERED`; it cannot pass a historical tab gate or contribute to the phrase “historically promising.” Because one shared model must work across the dashboard, any underpowered tab blocks the shared historical pass.

## Final quasi-holdout decisions

For each market, compare paired squared forecast errors from controls and controls plus the selected score. The loss difference is `controls error² − full error²`, so positive values favor the score. Use a one-sided Newey–West mean test with bandwidth at least 21 observations and Benjamini–Hochberg adjustment across the five market tests.

A tab passes the historical return gate only if all are true:

1. both development and final segments pass the data-adequacy gate;
2. final relative MSE improvement is at least 0.5%;
3. its loss-improvement BH q-value is at most 0.05;
4. at least 70% of development and final refit blocks give the score coefficient the same non-zero sign;
5. the dominant coefficient sign is the same in development and final evaluation.

The one shared model passes across the dashboard only if the development gate and all five tab gates pass. Otherwise the report names each passing/failing tab and says the shared return model failed.

The future-risk candidate also has to pass a development gate before any overall historical risk pass is possible: development MSE improvement must be positive in all five markets and the equal-market mean improvement must be at least 1.0%. Its final gate requires data adequacy in both segments and is stricter on effect size: at least 1.0% final MSE improvement, BH q at most 0.05, a negative score coefficient in at least 70% of development and final blocks (more greed predicts lower later volatility), and the same all-five-market requirement. A risk pass supports only the statement that the score contains information about later volatility, not market direction or return.

## Integrity and reporting

A live run must save:

- the normalized component/price snapshot;
- source identities, retrieval timestamp and exact mappings;
- hashes of the model engine, configuration, runner and this protocol;
- a SHA-256 sidecar for the input;
- the full 15-candidate development ledger;
- the selected candidates and one-time final results;
- SHA-256 sidecars for JSON and Markdown results.

A saved-snapshot replay must make no network calls, must verify that the current model engine, configuration, runner and protocol hashes match the frozen snapshot, and must reproduce the analysis fingerprint. No earlier schema-1/2/3 artifact is overwritten.

## Interpretation

Historical success is necessary but not sufficient. Current Yahoo histories are not point-in-time vintages, provider corrections are possible, Sweden/Europe targets are not directly investable, and the final period is no longer pristine because v1 outcomes were already viewed. No live score is changed by this study alone.

The model may be called historically promising only after passing the frozen gates. It may be called reliable only after an additional forward-frozen period with timestamped signals, no model changes, identified tradable vehicles and realistic spreads, fees, slippage and cash yield.

## Primary references

- Coin Metrics CMBI Total Market Index: https://indexes.coinmetrics.io/cmbitm
- Coin Metrics CMBI Total Market Series Methodology v1.4: https://files.gitbook.com/v0/b/gitbook-x-prod.appspot.com/o/spaces%2F-MO23j33wWGzm0NrZseN%2Fuploads%2FXufzMuLtZDcNdnscsYyJ%2FCMBI%20Total%20Market%20Series%20Methodology%20v1.4.pdf?alt=media&token=2f910357-87f9-4f83-adae-2fb885f5a00e
- Coin Metrics CMBI methodology overview: https://gitbook-docs.coinmetrics.io/index-data/coin-metrics-bletchley-indexes-cmbi
- Coin Metrics index-level data documentation: https://docs.coinmetrics.io/indexes-timeseries/index-levels
- Halbert White, *A Reality Check for Data Snooping*: https://doi.org/10.1111/1468-0262.00152
- Harvey, Liu and Zhu, *... and the Cross-Section of Expected Returns*: https://www.nber.org/papers/w20592
- Bailey et al., *The Probability of Backtest Overfitting*: https://doi.org/10.21314/JCF.2016.322
