# Fear & Greed predictive backtest protocol

Status: crypto model v1 frozen on 2026-08-24 before running its replacement forward-return results. The existing equity design and statistical decision rules are unchanged from the protocol frozen on 2026-08-23.

This is an exploratory historical study, not a deployable trading system. Its purpose is to test whether the five Fear & Greed series displayed by this repository contain information about strictly later market returns.

## Series and targets

The tested signals are exactly the series shown by the app:

| Signal | Primary return target | Reason |
|---|---|---|
| Sweden own model | `^OMXSBGI` | The model's configured Swedish index |
| USA own model | `SPY` adjusted close | The model's configured US index/proxy |
| Europe own model | `^STOXX` | The model's configured European index |
| Global own model | `ACWI` adjusted close | The model's configured global proxy |
| Crypto Risk Appetite — repository model v1 | `BTC-USD` adjusted close | BTC is both the model benchmark input and the explicit tested return target, but it is not the whole seven-asset basket |

The equity targets for Sweden and Europe are indices rather than directly tradable instruments. Their strategy results are therefore hypothetical diagnostics, not executable performance claims.

The crypto signal is calculated by `cryptofg.js`; no published Fear & Greed score may be substituted or used as a fallback. Version 1 is frozen as follows before its results are inspected:

- fixed basket: `BTC-USD`, `ETH-USD`, `SOL-USD`, `XRP-USD`, `ADA-USD`, `DOGE-USD`, `BNB-USD`;
- Bitcoin trend: `100 × (BTC close / SMA200 − 1)`;
- Bitcoin strength: `100 × (BTC close / trailing 365-day high − 1)`;
- volatility shock: BTC 30-day annualized realized volatility relative to its 90-day average, scored in the fear direction;
- breadth: percentage of all seven basket assets above their own 200-day moving averages;
- altcoin appetite: median 30-day return of the six non-BTC assets minus BTC's 30-day return;
- each raw component receives a no-lookahead midrank percentile using at most the current and previous 364 valid completed daily observations, with at least 180 required;
- volatility's percentile is inverted; the five component scores are averaged with equal weight;
- all five components and all seven assets are required for every canonical historical row;
- fixed display bands are 0–24 Extreme Fear, 25–44 Fear, 45–55 Neutral, 56–74 Greed, and 75–100 Extreme Greed.

The windows, equal weights, basket and bands are heuristic design choices, not empirically calibrated probabilities. The basket was selected in August 2026 and therefore creates explicit hindsight-selection and survivorship risk in the retrospective history. The model is a relative price-regime proxy; it does not directly observe emotions, derivatives, funding, search, social-media or news sentiment.

## Samples and timestamps

- Equity primary sample: dates on which all six configured components are present. Earlier three-to-five-component histories are a structurally different model and are reported only as secondary robustness evidence.
- Crypto primary sample: only model-v1 rows with all five components and all seven frozen-basket assets, using completed UTC daily candles. The still-forming retrieval date is excluded.
- A normalized dated input snapshot, retrieval time, source identities, code/config hashes, and SHA-256 digest must be saved before analysis.
- No provider supplies a point-in-time vintage archive or revision history for these downloaded series. Historical revision cannot be ruled out.
- A date label alone does not prove the value was executable at that instant. The primary alignment therefore imposes one full target-bar lag: score on bar `t`, hypothetical entry at close of bar `t+1`, exit at close of `t+1+h`.
- Missing signals are never backfilled. The existing equity model may carry a component score forward for at most seven calendar days across exchange holidays; this must remain disclosed.

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

No threshold optimization is permitted. Apply 10 basis points for each absolute position change; cash earns zero in this initial diagnostic. Report exposure, switches, compound/annualized return, annualized volatility, zero-cash Sharpe, and maximum drawdown. Equity uses 252 and crypto 365 observations for annualization. These strategies are descriptive secondary tests and receive no standalone significance claim.

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

- Liu and Tsyvinski, *Risks and Returns of Cryptocurrency* (momentum and realized-volatility context only; it does not validate this composite): https://www.nber.org/papers/w24877
- Liu, Tsyvinski and Wu, *Common Risk Factors in Cryptocurrency* (market and momentum-factor context only): https://www.nber.org/papers/w25882
- Yahoo Finance historical-data help (raw-price source context; the chart endpoint itself has no contractual public API/SLA): https://help.yahoo.com/kb/finance/download-historical-data-yahoo-finance-sln2311.html
- CNN methodology used only as context for the repo's own equity construction: https://www.cnn.com/markets/fear-and-greed
