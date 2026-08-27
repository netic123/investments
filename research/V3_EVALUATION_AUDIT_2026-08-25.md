# Independent v3 evaluation audit — 25 August 2026

Verdict: `FAIL_NOT_A_COMMON_VALIDATED_PREDICTOR_OR_BUY_AND_HOLD_WINNER` is independently reproducible and robust to the one protocol/test mismatch found below. No identified defect can turn v3 into a five-market predictor or buy-and-hold winner.

## Independent reproduction

The audit reconstructed the forecast rows, expanding/purged OLS forecasts, nested loss adjustment and economic ledgers directly from the checksum-verified schema-5 snapshot without calling `fear_greed_v3_evaluation.analyze()`.

| Market | Saved MSE improvement | Independent MSE improvement | Saved overlay/B&H ratio | Independent ratio |
|---|---:|---:|---:|---:|
| Crypto | -67.8141% | -67.8141% | 0.146516 | 0.146516 |
| Sweden | -16.3578% | -16.3578% | 0.912095 | 0.912095 |
| USA | -0.244289% | -0.244289% | 0.259414 | 0.259414 |
| Europe | -2.47891% | -2.47891% | 0.534832 | 0.534832 |
| Global | +6.42717% | +6.42717% | 0.634139 | 0.634139 |

The largest difference was about `2.1e-15`, ordinary floating-point noise.

The exact common-calendar result was also reproduced: 1,020 common dates from 14 June 2022 through 24 August 2026; overlay wealth `1.6975875412`, buy-and-hold `2.1478102746`, ratio `0.7903805849`.

## Timing, inference and economic checks

- Signal is observed at close `t`; forecast/trade origin is `t+1`; the forecast exits at `t+22`, giving 21 return intervals.
- Every training outcome exits no later than the current refit origin. Refits are expanding and occur every 21 forecasts.
- Clark-West adjusted loss is `e0^2 - e1^2 + (f0 - f1)^2`; the Newey-West bandwidth is 21.
- Holm step-down adjustment is monotone and correct. The smallest adjusted p-value is `0.904509`, far above `0.05`.
- No coefficient direction appears in at least 70% of blocks in every market.
- Full precision is rounded to one decimal and then to the integer used by the dashboard label; for example, `74.45 -> 74.5 -> 75`.
- The old exposure receives the complete `t` to `t+1` return before a signal from `t` fills at `t+1`.
- Transaction costs are charged on absolute traded risky notional, and the post-cost position exactly reaches 50%, 100% or 150%.
- Negative cash pays 5% continuously compounded annual borrowing; positive cash earns zero; there is no artificial initial tactical cost or forced terminal liquidation.

## Fitting-seed wording mismatch

The frozen protocol calls the first 252 eligible candidate rows an “initial fitting seed,” and the test calls it an “exact 252-row fitting seed.” Outcome purging means only 231 outcomes are observable at the first OLS fit. A stricter sensitivity starts forecasts only after 252 outcomes are actually observable, at candidate row 273.

| Market | Strict-seed MSE improvement | Forecast rows |
|---|---:|---:|
| Crypto | -4.9847% | 1,781 |
| Sweden | -15.6682% | 740 |
| USA | -0.2352% | 4,516 |
| Europe | -1.8931% | 3,647 |
| Global | +6.4040% | 1,719 |

The strict-seed sensitivity still fails in four of five markets, and Sweden falls below the frozen 756-forecast adequacy minimum. The economic overlay is unaffected and still loses in five of five.

## Integrity and limits

- Evaluation protocol, runner, test, four declared dependencies and the 48.2 MB input all matched their frozen hashes.
- JSON and Markdown result sidecars and the internal analysis fingerprint matched.
- Source/test timestamps precede the freeze, which precedes results and result sidecars.
- The runner does not itself load and enforce the evaluation freeze JSON, and the freeze does not pin the overlay's transitive trend-confirm helper.
- The research files are currently untracked and result artifacts are Git-ignored, so the local hash record is internally consistent but not yet durable in Git.
- The 150% overlay would require a risk-matched benchmark even if it won. It instead underperforms unleveraged buy-and-hold in all five markets with negative net log-return excess everywhere.

Final audit conclusion: the v3 score is a potentially more coherent descriptive regime gauge, but this historical evaluation rejects it as a common incremental return predictor and as a common buy-and-hold-beating trading signal.
