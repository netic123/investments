# Fear & Greed predictive backtest

Generated: 2026-08-24T21:16:34.705Z

> **Gate: exploratory historical evidence only; not ready for real capital.** The inputs are not point-in-time vintages, BTC is an assumed target, and two equity targets are non-investable indices.

## Bottom line

| Market | 1-bar holdout slope / 10 score pts | p | BH q (20) | Train/test sign | Score MSE improvement vs controls | Fear-only CAGR | Buy/hold CAGR | Classification |
|---|---:|---:|---:|---|---:|---:|---:|---|
| Sweden | -0.06% | 0.2453 | 0.4907 | positive / negative | -1.38% | 5.14% | 20.73% | No robust evidence of return prediction |
| USA | -0.01% | 0.4637 | 0.6624 | negative / negative | -0.12% | 3.56% | 15.80% | No robust evidence of return prediction |
| Europe | -0.02% | 0.0993 | 0.3843 | negative / negative | -0.19% | 6.02% | 10.25% | No robust evidence of return prediction |
| Global | -0.02% | 0.4310 | 0.6624 | negative / negative | -0.03% | 5.62% | 19.41% | No robust evidence of return prediction |
| Crypto (BTC benchmark) | 0.01% | 0.7394 | 0.7784 | positive / positive | -0.31% | -4.93% | 8.72% | No robust evidence of return prediction |

A negative slope supports the frozen contrarian hypothesis. Positive score MSE improvement means controls plus score beat controls alone out of sample. Neither condition by itself proves tradable value.

## Primary 20-test ledger

| Market | Horizon | N train/test | Purged at split | Holdout dates | Pearson | Spearman | Slope / 10 pts | 95% NW CI | p | BH q | Sign stable? | Q1-Q4 holdout return |
|---|---:|---:|---:|---|---:|---:|---:|---|---:|---:|---|---:|
| sweden | 1 | 504/337 | 0 | 2025-03-31 to 2026-08-19 | -0.086 | -0.106 | -0.06% | [-0.16%, 0.04%] | 0.2453 | 0.4907 | no | 0.20% |
| sweden | 5 | 498/335 | 4 | 2025-03-27 to 2026-08-13 | -0.187 | -0.313 | -0.30% | [-0.76%, 0.17%] | 0.2101 | 0.4668 | yes | 1.50% |
| sweden | 21 | 472/329 | 20 | 2025-03-13 to 2026-07-22 | -0.286 | -0.358 | -0.77% | [-1.78%, 0.24%] | 0.1369 | 0.3912 | yes | 2.92% |
| sweden | 63 | 405/312 | 62 | 2025-02-05 to 2026-05-20 | -0.220 | -0.241 | -0.69% | [-1.46%, 0.08%] | 0.0793 | 0.3843 | yes | 8.22% |
| usa | 1 | 2773/1849 | 0 | 2019-04-11 to 2026-08-19 | -0.023 | -0.049 | -0.01% | [-0.05%, 0.02%] | 0.4637 | 0.6624 | yes | 0.10% |
| usa | 5 | 2766/1848 | 4 | 2019-04-08 to 2026-08-13 | -0.033 | -0.078 | -0.04% | [-0.21%, 0.13%] | 0.6218 | 0.7315 | yes | 0.38% |
| usa | 21 | 2741/1841 | 20 | 2019-03-26 to 2026-07-22 | -0.103 | -0.124 | -0.26% | [-0.66%, 0.13%] | 0.1935 | 0.4668 | yes | 1.38% |
| usa | 63 | 2674/1824 | 62 | 2019-02-19 to 2026-05-20 | -0.180 | -0.118 | -0.70% | [-1.57%, 0.17%] | 0.1153 | 0.3843 | no | 2.88% |
| europe | 1 | 2252/1502 | 0 | 2020-08-31 to 2026-08-19 | -0.046 | -0.050 | -0.02% | [-0.05%, 0.00%] | 0.0993 | 0.3843 | yes | 0.09% |
| europe | 5 | 2246/1500 | 4 | 2020-08-27 to 2026-08-13 | -0.106 | -0.123 | -0.11% | [-0.21%, -0.00%] | 0.0477 | 0.3843 | yes | 0.51% |
| europe | 21 | 2220/1494 | 20 | 2020-08-13 to 2026-07-22 | -0.166 | -0.136 | -0.31% | [-0.62%, -0.01%] | 0.0425 | 0.3843 | yes | 1.51% |
| europe | 63 | 2153/1477 | 62 | 2020-07-09 to 2026-05-22 | 0.054 | 0.057 | 0.14% | [-0.53%, 0.81%] | 0.6807 | 0.7563 | no | -0.73% |
| global | 1 | 1155/770 | 0 | 2023-07-26 to 2026-08-19 | -0.032 | -0.053 | -0.02% | [-0.06%, 0.02%] | 0.4310 | 0.6624 | yes | 0.11% |
| global | 5 | 1148/769 | 4 | 2023-07-21 to 2026-08-13 | -0.079 | -0.089 | -0.09% | [-0.25%, 0.08%] | 0.3064 | 0.5106 | yes | 0.64% |
| global | 21 | 1123/762 | 20 | 2023-07-10 to 2026-07-22 | -0.138 | -0.093 | -0.27% | [-0.78%, 0.23%] | 0.2837 | 0.5106 | yes | 1.36% |
| global | 63 | 1055/746 | 62 | 2023-05-31 to 2026-05-20 | -0.299 | -0.242 | -0.85% | [-1.78%, 0.08%] | 0.0727 | 0.3843 | yes | 4.78% |
| crypto | 1 | 1282/856 | 0 | 2024-04-18 to 2026-08-21 | 0.011 | 0.005 | 0.01% | [-0.07%, 0.10%] | 0.7394 | 0.7784 | yes | -0.18% |
| crypto | 5 | 1276/854 | 4 | 2024-04-16 to 2026-08-17 | 0.036 | -0.011 | 0.10% | [-0.27%, 0.47%] | 0.5921 | 0.7315 | yes | -1.13% |
| crypto | 21 | 1250/848 | 20 | 2024-04-06 to 2026-08-01 | 0.018 | -0.018 | 0.10% | [-1.35%, 1.56%] | 0.8874 | 0.8874 | yes | -0.35% |
| crypto | 63 | 1183/831 | 62 | 2024-03-12 to 2026-06-20 | -0.085 | -0.115 | -0.91% | [-4.30%, 2.49%] | 0.6002 | 0.7315 | no | 5.81% |

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
| crypto | 1 | 0.23% (n=138) | -0.08% (n=286) | 0.08% (n=155) | 0.02% (n=224) | 0.37% (n=53) |
| crypto | 5 | 0.40% (n=138) | 0.14% (n=288) | -0.21% (n=155) | 0.37% (n=221) | 0.98% (n=52) |
| crypto | 21 | -0.28% (n=138) | 1.57% (n=290) | -1.31% (n=157) | 1.11% (n=212) | 0.94% (n=51) |
| crypto | 63 | 3.45% (n=138) | 2.87% (n=279) | 1.31% (n=159) | -1.09% (n=204) | 1.18% (n=51) |

These are provider-defined semantic bands, not thresholds selected from the completed history. Empty cells have no holdout observations.

## Incremental one-bar forecast

| Market | Forecast rows | Mean MSE | Controls MSE | Controls + score MSE | OOS R2 controls | OOS R2 full | Delta R2 | MSE improvement vs controls |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| Sweden | 337 | 0.00011417 | 0.00011420 | 0.00011578 | -0.03% | -1.41% | -1.38% | -1.38% |
| USA | 1849 | 0.00015156 | 0.00015397 | 0.00015415 | -1.59% | -1.71% | -0.12% | -0.12% |
| Europe | 1502 | 0.00007896 | 0.00007885 | 0.00007900 | 0.14% | -0.05% | -0.19% | -0.19% |
| Global | 770 | 0.00008387 | 0.00008398 | 0.00008400 | -0.12% | -0.16% | -0.03% | -0.03% |
| Crypto (BTC benchmark) | 856 | 0.00058041 | 0.00058208 | 0.00058388 | -0.29% | -0.60% | -0.31% | -0.31% |

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
| Crypto (BTC benchmark) | Buy and hold | 100.00% | 1 | 21.67% | 8.72% | 45.99% | 0.411 | -53.06% | — |
| Crypto (BTC benchmark) | Long only Fear/Extreme Fear | 49.53% | 48 | -11.18% | -4.93% | 35.89% | 0.038 | -41.05% | -13.65% |
| Crypto (BTC benchmark) | Long except Extreme Greed | 93.81% | 16 | 0.39% | 0.17% | 44.09% | 0.223 | -51.20% | -8.55% |
| Crypto (BTC benchmark) | Long only Greed/Extreme Greed | 32.36% | 43 | 14.09% | 5.78% | 24.30% | 0.351 | -39.28% | -2.94% |
| Crypto (BTC benchmark) | Long except Extreme Fear | 83.88% | 47 | -10.57% | -4.65% | 40.22% | 0.082 | -48.13% | -13.37% |

Every absolute position change costs 10 bp, including the initial buy. Cash return is zero. These are exposure-dependent diagnostics, not standalone significance tests or executable returns.

## Data coverage and identity

| Market | Signal | Target | Completed price bars | All signal rows | Strict signal rows | 1-bar eligible | Price mode |
|---|---|---|---:|---:|---:|---:|---|
| Sweden | repo unified six-component model v1 | ^OMXSBGI (non-investable index) | 3326 | 844 | 844 | 841 | Yahoo adjusted close for the whole series |
| USA | repo unified six-component model v1 | SPY | 8448 | 4625 | 4625 | 4622 | Yahoo adjusted close for the whole series |
| Europe | repo unified six-component model v1 | ^STOXX (non-investable index) | 5613 | 3757 | 3757 | 3754 | Yahoo adjusted close for the whole series |
| Global | repo unified six-component model v1 | ACWI | 4630 | 1928 | 1928 | 1925 | Yahoo adjusted close for the whole series |
| Crypto (BTC benchmark) | repo unified six-component model v1 | BTC-USD | 4359 | 2140 | 2140 | 2138 | Yahoo adjusted close for the whole series |

Input snapshot: `research/artifacts/inputs/fear-greed-input-2026-08-24T21-16-09Z.json`

SHA-256: `dd1d50e563b508a4e200c93f1b18b5f874331f531a071edf021d2d5dfbe3af0d` (checksum verified: true)

Analysis fingerprint: `7b9eb8c2effec534f12f4561ccb73dc402abb5ea348251305725c0a2a472c1a8` (compare this across live and saved-snapshot runs)

Shared-model identity: the repository recomputes all five market scores through one `marketfg.js` six-component engine with the same trailing 252-observation percentile scoring, 126-observation warm-up, directions, equal weights, bands, and all-six requirement. Raw proxies differ; volatility is an implied-volatility level where configured and benchmark realised volatility otherwise. These are not licensed or archived CNN or third-party Fear & Greed histories. An individual component can be carried across a source-market holiday for up to seven calendar days.

Crypto mapping: `BTC-USD` is the benchmark and tested return target; BTC supplies momentum, strength and realised volatility; `IEF` is the safe-haven comparator; `HYG/LQD` is US macro credit appetite; and daily-rebalanced fixed `NONCORE-EW/CORE-EW` groups proxy breadth. This is not a total-crypto-market index, true point-in-time breadth, or crypto-native credit. A 252-observation Crypto window spans about 8.3 calendar months, not one year.

## Timing and limitations

- Exact signal/target date match only. A score on bar t enters at close t+1 and exits at close t+1+h.
- The retrieval-local current target bar is excluded to avoid a partially formed Yahoo candle.
- Crypto signal inputs exclude the current UTC date; weekday-only IEF/HYG/LQD component scores can carry forward for at most seven calendar days.
- Current-history downloads are not point-in-time vintages. Provider revisions, adjusted-close restatements, and symbol survivorship cannot be ruled out.
- `^OMXSBGI` and `^STOXX` are non-investable indices. A real implementation needs an identified tradable vehicle and tracking/currency/cost analysis.
- The backtest omits bid/ask spreads, slippage, tax, cash yield, custody/funding, and operational constraints.
- Fixed-band and strategy tables are secondary diagnostics. The exact primary inference family is the 20 holdout score slopes shown above.
- Even favorable historical results require forward-frozen score collection, timestamp validation, paper trading, risk-matched benchmarks, and venue-specific costs before capital use.

## Sources

- Yahoo chart endpoint template: https://query1.finance.yahoo.com/v8/finance/chart/{symbol}
- Local shared-model construction for all five markets: `marketfg.js` plus `data/config.json`; their hashes and the frozen model definition are in the snapshot.
