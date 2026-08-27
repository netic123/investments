# Frozen v3 shadow evaluation protocol

Status: frozen before any v3 predictive or strategy outcome is opened.

Model under test: `investments-unified-fear-greed-v3-shadow-absolute-vol-normalized-v1`, byte-identified by `FEAR_GREED_V3_SHADOW_FREEZE.json`.

Input: the exact schema-5 snapshot with SHA-256 `ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d`. Every observation ends no later than 24 August 2026 and has already been available during earlier research. Therefore every result is retrospective development evidence; there is no historical confirmation or untouched holdout.

No candidate, weight, lookback, threshold or market-specific exception is selected in this evaluation. There are exactly two frozen questions.

## A. Incremental 21-bar forecast test

- Signal: the full-precision v3 composite after target close `t`.
- Entry/origin: target close `t+1`.
- Outcome: simple target return from close `t+1` through close `t+22` (21 return intervals).
- Controls-only `M0`: intercept plus lagged 1-, 5- and 20-bar return, 20-bar realised volatility and target distance from its 125-bar trend.
- Full `M1`: byte-identical controls, rows, refit schedule and outcome plus exactly one standardized v3 score term.
- Initial fitting seed: 252 eligible rows.
- Evaluation: every remaining pre-freeze row in chronological order.
- Refit: expanding window every 21 forecasts.
- Purge: a training row is usable only when its outcome exit index is no later than the current forecast-origin signal index.
- Primary effect: raw MSE improvement `(MSE_M0 - MSE_M1) / MSE_M0`.
- Nested-model inference: one-sided Clark-West adjusted loss `e0^2 - e1^2 + (forecast0 - forecast1)^2`, with a Newey-West mean test using lag 21.
- Multiplicity: Holm family-wise adjustment across exactly five markets.

Forecast PASS requires all of the following in all five markets: raw MSE improvement at least 0.5%; a common coefficient direction appearing in at least 70% of refit blocks in every market; finite one-sided Clark-West p-values; Holm-adjusted p-value below 0.05; and the frozen reference adequacy screen of at least 756 forecasts, 36 greedy non-overlapping outcomes and 1,095 calendar days. Equality fails.

## B. One fixed economic overlay

The economic mapping is the already-used `50/100/150` contrarian core overlay, applied once to v3 without threshold search:

- Convert the v3 full-precision composite to its displayed one-decimal value and then to the same displayed integer used for the label.
- displayed label `Extreme Fear` (integer 0–24): target 150% benchmark exposure;
- displayed label `Fear`, `Neutral` or `Greed` (25–74): target 100%;
- displayed label `Extreme Greed` (75–100): target 50%;
- a score observed after close `t` queues a rebalance only for close `t+1`; the old position receives the entire intervening return;
- repeat scores rebalance drifted exposure to the same target;
- 0.50% one-way cost on traded risky notional, zero return on positive cash and 5% continuously compounded annual borrowing cost on negative cash;
- initial position is 100% benchmark, so neither overlay nor matched buy-and-hold pays an artificial initial tactical cost;
- no forced terminal liquidation;
- benchmark is frictionless 100% buy-and-hold from the exact same first target close;
- double-cost falsification uses 1.00% one way with every other rule unchanged.

Economic PASS requires terminal wealth and annualized net log return above matched buy-and-hold in 5/5 markets at primary costs, above buy-and-hold in 5/5 at double costs, positive terminal-wealth and log-return excess on the exact five-market common calendar, and no bankruptcy. Equality fails. Chronological halves and drawdown are reported but cannot rescue a failure.

Because the overlay reaches 150% exposure, even a PASS would still require a risk-matched benchmark before an alpha claim. A lower drawdown, volatility or Sharpe cannot rescue a terminal-return failure.

## Stop and interpretation rule

- If either frozen test fails, v3 is not a validated return predictor or buy-and-hold winner.
- A coherent current score is only descriptive evidence and cannot override a failed return test.
- Do not search neighbouring anchors, thresholds, smoothing windows, weights or market-specific variants on these outcomes.
- Production remains unchanged. Promotion requires a new point-in-time input mapping and genuinely append-only prospective evidence.
