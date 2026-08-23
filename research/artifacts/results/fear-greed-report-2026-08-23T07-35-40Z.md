# Fear & Greed predictive backtest

Generated: 2026-08-23T07:35:40.807Z

> **Gate: exploratory historical evidence only; not ready for real capital.** The inputs are not point-in-time vintages, BTC is an assumed target, and two equity targets are non-investable indices.

## Bottom line

| Market | 1-bar holdout slope / 10 score pts | p | BH q (20) | Train/test sign | Score MSE improvement vs controls | Fear-only CAGR | Buy/hold CAGR | Classification |
|---|---:|---:|---:|---|---:|---:|---:|---|
| Sweden | -0.06% | 0.2453 | 0.4907 | positive / negative | -1.38% | 5.14% | 20.73% | No robust evidence of return prediction |
| USA | -0.01% | 0.4637 | 0.6624 | negative / negative | -0.12% | 3.56% | 15.80% | No robust evidence of return prediction |
| Europe | -0.02% | 0.0993 | 0.3843 | negative / negative | -0.19% | 6.02% | 10.25% | No robust evidence of return prediction |
| Global | -0.02% | 0.4311 | 0.6624 | negative / negative | -0.03% | 5.62% | 19.41% | No robust evidence of return prediction |
| Crypto (BTC assumed target) | -0.01% | 0.8625 | 0.9035 | negative / negative | -0.13% | -22.35% | -22.17% | No robust evidence of return prediction |

A negative slope supports the frozen contrarian hypothesis. Positive score MSE improvement means controls plus score beat controls alone out of sample. Neither condition by itself proves tradable value.

## Primary 20-test ledger

| Market | Horizon | N train/test | Purged at split | Holdout dates | Pearson | Spearman | Slope / 10 pts | 95% NW CI | p | BH q | Sign stable? | Q1-Q4 holdout return |
|---|---:|---:|---:|---|---:|---:|---:|---|---:|---:|---|---:|
| sweden | 1 | 504/337 | 0 | 2025-03-31 to 2026-08-19 | -0.086 | -0.106 | -0.06% | [-0.16%, 0.04%] | 0.2453 | 0.4907 | no | 0.20% |
| sweden | 5 | 498/335 | 4 | 2025-03-27 to 2026-08-13 | -0.187 | -0.313 | -0.30% | [-0.76%, 0.17%] | 0.2101 | 0.4668 | yes | 1.50% |
| sweden | 21 | 472/329 | 20 | 2025-03-13 to 2026-07-22 | -0.286 | -0.358 | -0.77% | [-1.78%, 0.24%] | 0.1369 | 0.3912 | yes | 2.92% |
| sweden | 63 | 405/312 | 62 | 2025-02-05 to 2026-05-20 | -0.220 | -0.241 | -0.69% | [-1.46%, 0.08%] | 0.0793 | 0.3843 | yes | 8.22% |
| usa | 1 | 2773/1849 | 0 | 2019-04-11 to 2026-08-19 | -0.023 | -0.049 | -0.01% | [-0.05%, 0.02%] | 0.4637 | 0.6624 | yes | 0.10% |
| usa | 5 | 2766/1848 | 4 | 2019-04-08 to 2026-08-13 | -0.033 | -0.078 | -0.04% | [-0.21%, 0.13%] | 0.6217 | 0.7759 | yes | 0.38% |
| usa | 21 | 2741/1841 | 20 | 2019-03-26 to 2026-07-22 | -0.103 | -0.124 | -0.26% | [-0.66%, 0.13%] | 0.1935 | 0.4668 | yes | 1.38% |
| usa | 63 | 2674/1824 | 62 | 2019-02-19 to 2026-05-20 | -0.180 | -0.118 | -0.70% | [-1.57%, 0.17%] | 0.1153 | 0.3843 | no | 2.88% |
| europe | 1 | 2252/1502 | 0 | 2020-08-31 to 2026-08-19 | -0.046 | -0.050 | -0.02% | [-0.05%, 0.00%] | 0.0993 | 0.3843 | yes | 0.09% |
| europe | 5 | 2246/1500 | 4 | 2020-08-27 to 2026-08-13 | -0.106 | -0.123 | -0.11% | [-0.21%, -0.00%] | 0.0477 | 0.3843 | yes | 0.51% |
| europe | 21 | 2220/1494 | 20 | 2020-08-13 to 2026-07-22 | -0.166 | -0.136 | -0.31% | [-0.62%, -0.01%] | 0.0425 | 0.3843 | yes | 1.51% |
| europe | 63 | 2153/1477 | 62 | 2020-07-09 to 2026-05-22 | 0.054 | 0.057 | 0.14% | [-0.53%, 0.81%] | 0.6807 | 0.7759 | no | -0.73% |
| global | 1 | 1155/770 | 0 | 2023-07-26 to 2026-08-19 | -0.032 | -0.053 | -0.02% | [-0.06%, 0.02%] | 0.4311 | 0.6624 | yes | 0.11% |
| global | 5 | 1148/769 | 4 | 2023-07-21 to 2026-08-13 | -0.079 | -0.089 | -0.09% | [-0.25%, 0.08%] | 0.3063 | 0.5106 | yes | 0.64% |
| global | 21 | 1123/762 | 20 | 2023-07-10 to 2026-07-22 | -0.138 | -0.093 | -0.27% | [-0.78%, 0.23%] | 0.2837 | 0.5106 | yes | 1.36% |
| global | 63 | 1055/746 | 62 | 2023-05-31 to 2026-05-20 | -0.299 | -0.242 | -0.85% | [-1.78%, 0.08%] | 0.0727 | 0.3843 | yes | 4.78% |
| crypto | 1 | 689/460 | 0 | 2025-05-18 to 2026-08-20 | -0.006 | 0.003 | -0.01% | [-0.11%, 0.09%] | 0.8625 | 0.9035 | yes | -0.58% |
| crypto | 5 | 683/458 | 4 | 2025-05-16 to 2026-08-16 | -0.025 | -0.050 | -0.07% | [-0.45%, 0.30%] | 0.6984 | 0.7759 | yes | -0.23% |
| crypto | 21 | 657/452 | 20 | 2025-05-06 to 2026-07-31 | -0.043 | -0.036 | -0.24% | [-1.16%, 0.69%] | 0.6171 | 0.7759 | yes | -2.72% |
| crypto | 63 | 590/435 | 62 | 2025-04-11 to 2026-06-19 | -0.029 | -0.018 | -0.25% | [-4.36%, 3.86%] | 0.9035 | 0.9035 | yes | -19.28% |

Q1-Q4 is the mean forward return below the training 25th-percentile score minus the mean above the training 75th percentile. The quartile cutoffs never use holdout scores. Training outcomes extending beyond the first holdout entry are purged at every horizon.

## Fixed-band conditional holdout returns

| Market | Horizon | Extreme Fear | Fear | Neutral | Greed | Extreme Greed |
|---|---:|---:|---:|---:|---:|---:|
| sweden | 1 | 0.66% (n=27) | -0.14% (n=57) | 0.14% (n=91) | 0.07% (n=149) | -0.41% (n=13) |
| sweden | 5 | 1.62% (n=29) | 0.37% (n=57) | 0.85% (n=91) | 0.03% (n=147) | -1.06% (n=11) |
| sweden | 21 | 3.69% (n=37) | 3.36% (n=59) | 1.60% (n=91) | 0.67% (n=140) | 3.16% (n=2) |
| sweden | 63 | 5.78% (n=40) | 5.55% (n=64) | 4.05% (n=96) | 3.69% (n=111) | -5.08% (n=1) |
| usa | 1 | 0.15% (n=192) | 0.04% (n=478) | 0.13% (n=299) | 0.04% (n=692) | 0.02% (n=188) |
| usa | 5 | 0.53% (n=192) | 0.39% (n=478) | 0.54% (n=300) | 0.16% (n=691) | 0.19% (n=187) |
| usa | 21 | 2.11% (n=192) | 2.18% (n=479) | 1.04% (n=298) | 0.76% (n=686) | 1.26% (n=186) |
| usa | 63 | 7.54% (n=192) | 4.42% (n=471) | 4.55% (n=291) | 3.13% (n=689) | 2.33% (n=181) |
| europe | 1 | 0.20% (n=191) | 0.04% (n=375) | -0.04% (n=310) | 0.06% (n=465) | -0.01% (n=161) |
| europe | 5 | 0.98% (n=191) | 0.20% (n=375) | -0.11% (n=310) | 0.14% (n=463) | 0.16% (n=161) |
| europe | 21 | 2.81% (n=191) | 1.07% (n=375) | -0.29% (n=310) | 0.81% (n=465) | 0.59% (n=153) |
| europe | 63 | 2.62% (n=191) | 2.42% (n=375) | 1.63% (n=312) | 2.95% (n=450) | 3.42% (n=149) |
| global | 1 | 0.10% (n=80) | 0.10% (n=206) | 0.07% (n=151) | 0.05% (n=276) | 0.09% (n=57) |
| global | 5 | 0.76% (n=80) | 0.43% (n=206) | 0.27% (n=151) | 0.29% (n=276) | 0.24% (n=56) |
| global | 21 | 4.19% (n=79) | 1.28% (n=201) | 0.73% (n=149) | 1.31% (n=275) | 2.09% (n=58) |
| global | 63 | 9.81% (n=78) | 5.79% (n=182) | 3.50% (n=140) | 3.37% (n=283) | 5.43% (n=63) |
| crypto | 1 | 0.08% (n=63) | -0.14% (n=188) | 0.10% (n=163) | -0.33% (n=46) | — (n=0) |
| crypto | 5 | 0.61% (n=63) | -0.82% (n=188) | 0.17% (n=160) | -1.13% (n=47) | — (n=0) |
| crypto | 21 | 1.19% (n=63) | -2.82% (n=173) | -1.91% (n=162) | -1.09% (n=54) | — (n=0) |
| crypto | 63 | 6.68% (n=55) | -8.66% (n=153) | -7.75% (n=173) | 1.90% (n=54) | — (n=0) |

These are provider-defined semantic bands, not thresholds selected from the completed history. Empty cells have no holdout observations.

## Incremental one-bar forecast

| Market | Forecast rows | Mean MSE | Controls MSE | Controls + score MSE | OOS R2 controls | OOS R2 full | Delta R2 | MSE improvement vs controls |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Sweden | 337 | 0.00011417 | 0.00011420 | 0.00011578 | -0.03% | -1.41% | -1.38% | -1.38% |
| USA | 1849 | 0.00015156 | 0.00015397 | 0.00015415 | -1.59% | -1.71% | -0.12% | -0.12% |
| Europe | 1502 | 0.00007896 | 0.00007885 | 0.00007900 | 0.14% | -0.05% | -0.19% | -0.19% |
| Global | 770 | 0.00008387 | 0.00008398 | 0.00008400 | -0.12% | -0.16% | -0.03% | -0.03% |
| Crypto (BTC assumed target) | 460 | 0.00048420 | 0.00048746 | 0.00048808 | -0.67% | -0.80% | -0.13% | -0.13% |

Models refit in expanding 21-observation blocks. A training outcome is admitted only when its exit close is already known by the block's first forecast date. Predictor scaling is recomputed inside each training window.

## Fixed 1-bar holdout economic diagnostics

| Market | Rule | Exposure | Changes | Total return | CAGR | Ann. vol | Sharpe (cash=0) | Max DD | CAGR minus buy/hold |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Sweden | Buy and hold | 100.00% | 1 | 28.65% | 20.73% | 16.98% | 1.194 | -13.29% | — |
| Sweden | Long only Fear/Extreme Fear | 24.93% | 22 | 6.93% | 5.14% | 12.17% | 0.472 | -13.29% | -15.59% |
| Sweden | Long except Extreme Greed | 96.14% | 5 | 35.13% | 25.25% | 16.83% | 1.422 | -13.29% | 4.52% |
| Sweden | Long only Greed/Extreme Greed | 48.07% | 45 | -0.68% | -0.51% | 9.23% | -0.009 | -9.12% | -21.23% |
| Sweden | Long except Extreme Fear | 91.99% | 7 | 7.37% | 5.46% | 15.24% | 0.425 | -13.21% | -15.26% |
| USA | Buy and hold | 100.00% | 1 | 193.41% | 15.80% | 19.54% | 0.849 | -33.72% | — |
| USA | Long only Fear/Extreme Fear | 36.24% | 150 | 29.26% | 3.56% | 15.98% | 0.299 | -30.60% | -12.24% |
| USA | Long except Extreme Greed | 89.83% | 103 | 158.44% | 13.82% | 19.22% | 0.770 | -33.72% | -1.99% |
| USA | Long only Greed/Extreme Greed | 47.59% | 187 | 11.87% | 1.54% | 9.00% | 0.215 | -22.07% | -14.26% |
| USA | Long except Extreme Fear | 89.62% | 89 | 112.21% | 10.80% | 14.81% | 0.767 | -37.59% | -5.00% |
| Europe | Buy and hold | 100.00% | 1 | 78.94% | 10.25% | 14.11% | 0.763 | -22.55% | — |
| Europe | Long only Fear/Extreme Fear | 37.68% | 126 | 41.70% | 6.02% | 10.76% | 0.597 | -14.64% | -4.23% |
| Europe | Long except Extreme Greed | 89.28% | 59 | 70.94% | 9.41% | 13.59% | 0.730 | -22.55% | -0.84% |
| Europe | Long only Greed/Extreme Greed | 41.68% | 123 | 12.79% | 2.04% | 7.26% | 0.315 | -11.61% | -8.21% |
| Europe | Long except Extreme Fear | 87.28% | 57 | 18.01% | 2.82% | 12.21% | 0.289 | -34.22% | -7.44% |
| Global | Buy and hold | 100.00% | 1 | 71.95% | 19.41% | 14.54% | 1.293 | -16.55% | — |
| Global | Long only Fear/Extreme Fear | 37.14% | 96 | 18.19% | 5.62% | 11.42% | 0.536 | -15.05% | -13.79% |
| Global | Long except Extreme Greed | 92.60% | 27 | 59.44% | 16.49% | 14.40% | 1.133 | -16.55% | -2.92% |
| Global | Long only Greed/Extreme Greed | 43.25% | 109 | 7.52% | 2.40% | 6.94% | 0.377 | -10.34% | -17.01% |
| Global | Long except Extreme Fear | 89.61% | 39 | 54.23% | 15.23% | 11.52% | 1.289 | -13.70% | -4.18% |
| Crypto (BTC assumed target) | Buy and hold | 100.00% | 1 | -27.08% | -22.17% | 41.88% | -0.388 | -53.06% | — |
| Crypto (BTC assumed target) | Long only Fear/Extreme Fear | 54.57% | 32 | -27.30% | -22.35% | 33.88% | -0.576 | -44.68% | -0.18% |
| Crypto (BTC assumed target) | Long except Extreme Greed | 100.00% | 1 | -27.08% | -22.17% | 41.88% | -0.388 | -53.06% | 0.00% |
| Crypto (BTC assumed target) | Long only Greed/Extreme Greed | 10.00% | 15 | -15.87% | -12.82% | 9.18% | -1.447 | -20.36% | 9.35% |
| Crypto (BTC assumed target) | Long except Extreme Fear | 86.30% | 15 | -28.97% | -23.77% | 34.32% | -0.619 | -51.40% | -1.60% |

Every absolute position change costs 10 bp, including the initial buy. Cash return is zero. These are exposure-dependent diagnostics, not standalone significance tests or executable returns.

## Data coverage and identity

| Market | Signal | Target | Completed price bars | All signal rows | Strict signal rows | 1-bar eligible | Price mode |
|---|---|---|---:|---:|---:|---:|---|
| Sweden | repo six-component model | ^OMXSBGI (non-investable index) | 3326 | 3076 | 843 | 841 | Yahoo adjusted close for the whole series |
| USA | repo six-component model | SPY | 8448 | 8198 | 4624 | 4622 | Yahoo adjusted close for the whole series |
| Europe | repo six-component model | ^STOXX (non-investable index) | 5613 | 5363 | 3756 | 3754 | Yahoo adjusted close for the whole series |
| Global | repo six-component model | ACWI | 4630 | 4381 | 1927 | 1925 | Yahoo adjusted close for the whole series |
| Crypto (BTC assumed target) | CMC published series | BTC-USD | 4358 | 1151 | 1151 | 1149 | Yahoo adjusted close for the whole series |

Input snapshot: `research/artifacts/inputs/fear-greed-input-2026-08-23T07-35-25Z.json`

SHA-256: `b41203e00ddadc518fc1765fa1297ad87fff4e1da41b3260857f295e362fac4d` (checksum verified: true)

Analysis fingerprint: `06d44d237d47c20364fd1ce591b3cadc06886bfcc3d11dcc99d3b7aeeff125a9` (compare this across live and saved-snapshot runs)

Equity identity: the repository recomputes a CNN-inspired score from current Yahoo histories. It is not a licensed or archived CNN series. The strict primary sample requires all six configured components; the model can carry an individual component score across a source-market holiday for up to seven calendar days.

Crypto identity: CoinMarketCap published Fear & Greed history from its official keyless endpoint. `BTC-USD` is an explicit researcher assumption because the signal is market-wide and the repository specifies no crypto return benchmark. Alternative.me is not used.

## Timing and limitations

- Exact signal/target date match only. A score on bar t enters at close t+1 and exits at close t+1+h.
- The retrieval-local current target bar is excluded to avoid a partially formed Yahoo candle.
- Current-history downloads are not point-in-time vintages. Provider revisions, adjusted-close restatements, and symbol survivorship cannot be ruled out.
- `^OMXSBGI` and `^STOXX` are non-investable indices. A real implementation needs an identified tradable vehicle and tracking/currency/cost analysis.
- The backtest omits bid/ask spreads, slippage, tax, cash yield, custody/funding, and operational constraints.
- Fixed-band and strategy tables are secondary diagnostics. The exact primary inference family is the 20 holdout score slopes shown above.
- Even favorable historical results require forward-frozen score collection, timestamp validation, paper trading, risk-matched benchmarks, and venue-specific costs before capital use.

## Sources

- CoinMarketCap historical API documentation: https://coinmarketcap.com/api/documentation/pro-api-reference/global-metrics
- CoinMarketCap keyless endpoint: https://pro-api.coinmarketcap.com/public-api/v3/fear-and-greed/historical
- Yahoo chart endpoint template: https://query1.finance.yahoo.com/v8/finance/chart/{symbol}
- Local equity construction: `marketfg.js` plus `data/config.json`; their hashes are in the snapshot.
