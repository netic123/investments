# Fear & Greed predictive backtest protocol

Status: unified model v1 and input schema 3 frozen on 2026-08-24 before inspecting its replacement Crypto forward-return results. The statistical decision rules remain unchanged from the protocol frozen on 2026-08-23. Schema-1 CoinMarketCap and schema-2 five-component-Crypto artifacts are archival only and are not valid inputs to the active runner.

This is an exploratory historical study, not a deployable trading system. Its purpose is to test whether the five Fear & Greed series displayed by this repository contain information about strictly later market returns.

## Series and targets

The tested signals are exactly the series shown by the app:

| Signal | Primary return target | Reason |
|---|---|---|
| Sweden — unified model v1 | `^OMXSBGI` | The model's configured Swedish index |
| USA — unified model v1 | `SPY` adjusted close | The model's configured US index/proxy |
| Europe — unified model v1 | `^STOXX` | The model's configured European index |
| Global — unified model v1 | `ACWI` adjusted close | The model's configured global proxy |
| Crypto — unified model v1 | `BTC-USD` adjusted close | BTC is both the configured benchmark and explicit tested return target; it is not the entire crypto market |

The equity targets for Sweden and Europe are indices rather than directly tradable instruments. Their strategy results are therefore hypothetical diagnostics, not executable performance claims.

`marketfg.js` calculates every signal. No published Fear & Greed score may be substituted or used as a fallback. Unified model v1 is frozen as follows before its results are inspected:

1. Momentum: `100 × (benchmark close / SMA125 − 1)`.
2. Strength: `100 × (benchmark close / maximum over the trailing 252 observations − 1)`; at least 126 benchmark observations are required before the raw series starts.
3. Volatility: a configured implied-volatility level, or 20-observation annualized realized benchmark volatility where none is configured, relative to its 50-observation average. The component's percentile is inverted because higher volatility is fear. Realized volatility uses `sqrt(252)` wherever that mapping is used; the Crypto raw percentage is therefore not annualized on a 365-day convention.
4. Safe-haven demand: the benchmark's 20-common-observation return minus the configured government-bond return.
5. Credit appetite: the high-yield/investment-grade ratio relative to its 125-observation average.
6. Breadth: the configured non-core/smaller-series to core/larger-series ratio relative to its 63-observation average.

Each raw component receives a causal midrank percentile over at most its current and previous 251 raw-series positions. Unavailable values inside that window are skipped, and at least 126 valid raw values are required. Volatility is inverted and the six component scores are averaged with exactly equal weight. All six components are required for every displayed and canonical historical row. The fixed bands are 0–24 Extreme Fear, 25–44 Fear, 45–55 Neutral, 56–74 Greed, and 75–100 Extreme Greed.

Only the configured raw-market mappings differ. Crypto is frozen as:

- benchmark and return target: `BTC-USD`;
- volatility: BTC realized volatility because no separate implied-volatility series is configured;
- safe haven: `IEF`, an external 7–10 year US Treasury ETF proxy;
- credit: `HYG/LQD`, external US high-yield versus investment-grade corporate-credit conditions, not crypto-native credit;
- core breadth series `CRYPTO-CORE-EW`: fixed BTC and ETH equal-weight return index;
- non-core breadth series `CRYPTO-NONCORE-EW`: fixed SOL, XRP, ADA, DOGE and BNB equal-weight return index.

Each synthetic index starts at 100 on the first date common to all its constituents. On every later common date it is multiplied by one plus the arithmetic mean of constituent simple returns, equivalent to an analytical daily rebalance to equal weights. These are transparent research constructions, not market-cap indices, investable products, or portfolios net of trading costs. Their fixed August 2026 membership creates explicit hindsight-selection and survivorship risk in retrospective history.

The 252/126 observation parameters are numerically identical across all five markets, but elapsed time is not: 252 seven-day Crypto observations cover about 8.3 months, whereas 252 equity trading observations cover roughly one trading year. The model is a relative price-regime proxy, not an empirically calibrated probability or a direct observation of emotions, derivatives, funding, search, social-media or news sentiment.

## Samples and timestamps

- Every market's primary sample contains only unified-model-v1 rows with all six configured components. Three-to-five-component composites are not admitted.
- Crypto uses completed UTC dates. The current UTC date is excluded before the BTC benchmark and both synthetic return indices are constructed.
- A normalized dated input snapshot, retrieval time, source identities, code/config hashes, and SHA-256 digest must be saved before analysis.
- The active normalized format is schema 3. The runner must reject schema 1 (retired CoinMarketCap experiment) and schema 2 (retired separate five-component Crypto model); those timestamped artifacts remain immutable archival evidence.
- No provider supplies a point-in-time vintage archive or revision history for these downloaded series. Historical revision cannot be ruled out.
- A date label alone does not prove the value was executable at that instant. The primary alignment therefore imposes one full target-bar lag: score on bar `t`, hypothetical entry at close of bar `t+1`, exit at close of `t+1+h`.
- Missing signals are never backfilled. A component score may be carried forward for at most seven calendar days across exchange holidays and mixed calendars. In Crypto, this means the latest scored IEF and HYG/LQD components can carry across weekends while BTC and the synthetic baskets continue to receive daily observations.

## Frozen hypotheses and horizons

The provider-style contrarian hypothesis is fixed before results:

- null: the continuous score has no relation to a future return;
- contrarian alternative: a higher (greedier) score predicts a lower future return.

A positive slope is evidence for the competing momentum interpretation, not confirmation of the contrarian claim.

The horizons are 1, 5, 21, and 63 target bars. The 1-bar result is primary. Multi-bar returns overlap and therefore require heteroskedasticity/autocorrelation-consistent inference.

For each market and horizon:

1. Reserve the latest 40% of eligible signal dates as a chronological holdout; the first 60% is training/development data.
2. Regress the simple forward return on the continuous score (scaled per ten score points).
3. Report Pearson and Spearman correlations, effect size, Newey-West standard error and two-sided p-value. HAC bandwidth is at least the return horizon.
4. Learn score quartiles from the training sample only, then compare fearful and greedy tails in the holdout.
5. Report the fixed, predeclared model bands without selecting thresholds from completed history.
6. Apply Benjamini-Hochberg false-discovery-rate adjustment across the complete family of 20 market-by-horizon score tests. All tests remain visible.
7. Report the coefficient sign separately in training and holdout. A sign reversal counts against robustness.

## Incremental-information test

Because price momentum and volatility are direct model inputs, univariate predictiveness is not enough. For the primary 1-bar horizon, compare these expanding, chronologically trained forecasts on the same holdout:

- historical-mean return;
- controls-only OLS using lagged 1-, 5-, and 20-bar target returns, 20-bar realized volatility, and price versus its 125-bar average;
- the same controls plus the Fear & Greed score.

Only outcomes that were fully observed by a forecast date may enter its training set. Scaling or regularization, if any, must be fitted inside the available training data. Report out-of-sample MSE and out-of-sample R-squared improvement of controls plus score versus controls only. The score does not add forecasting information if this improvement is zero or negative.

## Fixed economic diagnostics

Using only 1-bar returns in the holdout and the one-bar signal lag, compare buy-and-hold with these long/cash rules based on published bands:

- long only during Fear or Extreme Fear;
- long except during Extreme Greed;
- long only during Greed or Extreme Greed;
- long except during Extreme Fear.

No threshold optimization is permitted. Apply 10 basis points for each absolute position change; cash earns zero in this initial diagnostic. Report exposure, switches, compound/annualized return, annualized volatility, zero-cash Sharpe, and maximum drawdown. Strategy performance annualization uses 252 bars for equity and 365 bars for Crypto. This does not alter the model itself: unified model v1 retains the same 252/126 scoring parameters and `sqrt(252)` realized-volatility raw formula in every market. These strategies are descriptive secondary tests and receive no standalone significance claim.

## Decision rule

Call the index potentially predictive only if all of the following hold:

1. The frozen one-bar holdout effect has the predeclared contrarian sign and is stable versus training.
2. Statistical evidence survives the declared multiple-testing adjustment.
3. Controls plus score improves genuinely out-of-sample forecast error versus controls only.
4. Any claimed economic value survives the frozen lag and costs and is not merely a consequence of lower market exposure.

Anything weaker is classified as one of:

- no robust evidence of return prediction;
- statistically suggestive but not incremental;
- incrementally predictive but not economically useful;
- exploratory only because the sample, vintage, target, or methodology is inadequate.

Even a pass is not ready for real capital. It requires frozen forward collection of the score at its actual publication time, a point-in-time paper-trading period, an executable instrument, venue-specific spreads/fees/slippage, cash yield, and risk-matched benchmark testing.

## Primary source references

- iShares IEF product page (7–10 year US Treasury exposure): https://www.ishares.com/us/products/239456/ishares-710-year-treasury-bond-etf
- iShares HYG product page (US-dollar high-yield corporate bonds): https://www.ishares.com/us/products/239565/ishares-iboxx-high-yield-corporate-bond-etf
- iShares LQD product page (US-dollar investment-grade corporate bonds): https://www.ishares.com/us/products/239566/ishares-iboxx-investment-grade-corporate-bond-etf
- Liu and Tsyvinski, *Risks and Returns of Cryptocurrency* (momentum and realized-volatility context only; it does not validate this composite): https://www.nber.org/papers/w24877
- Liu, Tsyvinski and Wu, *Common Risk Factors in Cryptocurrency* (market and momentum-factor context only): https://www.nber.org/papers/w25882
- Yahoo Finance historical-data help (raw-price source context; the chart endpoint itself has no contractual public API/SLA): https://help.yahoo.com/kb/finance/download-historical-data-yahoo-finance-sln2311.html
- CNN methodology used only as context for the repo's own equity construction: https://www.cnn.com/markets/fear-and-greed
