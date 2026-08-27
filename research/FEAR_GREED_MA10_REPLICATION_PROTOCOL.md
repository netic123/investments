# MA10-LF-50 published-rule replication protocol

Status: frozen candidate specification before the repository snapshot outcome is opened.

Purpose: replicate one simple, externally published trend rule as a return benchmark. This is not a new Fear & Greed calibration and it is not selected from a leaderboard. The rule is based on the 10-month moving-average timing specification described by Meb Faber, with deliberately more conservative execution and costs.

Primary question: does one identical, causal, long-or-cash rule finish with more net wealth than buy-and-hold in each of Crypto, Sweden, USA, Europe and Global?

## Frozen rule `MA10-LF-50`

For each market independently:

1. Use the market target's daily adjusted/total-return rows exactly as stored in the frozen schema-5 input snapshot.
2. Select the final available target close in every calendar month. No incomplete future row is added.
3. Once ten complete month-end closes exist, compute the arithmetic mean of the latest ten month-end closes, including the current month-end close.
4. Signal `1` when the current month-end close is strictly greater than that mean; otherwise signal `0`. A tie means cash.
5. The signal becomes executable only at the next available target close after the month-end signal close. Same-close execution is forbidden.
6. Hold either 100% of the target or 100% cash. No shorting, leverage, volatility scaling, threshold band, stop, market-specific parameter, discretionary override or missing-data substitution is permitted.
7. Cash return is fixed at zero. This deliberately does not award a historical cash yield.
8. Charge 0.50% of wealth for every one-way exposure change (`0 -> 1` or `1 -> 0`). The primary cost is therefore 50 basis points per side.
9. Buy-and-hold starts on the same first executable date and pays the same 0.50% initial entry cost. Neither strategy is forcibly liquidated at the final row.
10. From one target close to the next, apply the return earned by the exposure that was already held, then execute any order at that close and deduct its cost. This prevents the new signal from receiving the return that occurred before execution.

## Frozen data and boundaries

- Input: the canonical schema-5 snapshot under `research/local-artifacts/v2-validation-final/inputs/`.
- The runner must verify the input SHA-256 sidecar before analysis.
- All rows in that snapshot end no later than 2026-08-24.
- The exact existing target definitions are retained so this is comparable with prior repository work.
- Crypto's target is a hindsight-defined fixed seven-asset equal-weight reconstruction. Sweden and Europe include non-investable index targets. Therefore this replication is retrospective development evidence, not deployable investment proof.
- The historical rows have already been inspected in earlier model work. They are not an untouched confirmatory holdout.

## Primary gate

`PASS` requires every condition below:

- finite positive wealth for both strategies in all five markets;
- `MA10-LF-50` terminal net wealth strictly greater than buy-and-hold terminal net wealth in all five markets;
- the equal-weight five-sleeve common portfolio terminal wealth strictly greater than its equal-weight buy-and-hold counterpart;
- no missing next-close execution for a signal that should be executable before the dataset ends.

Equality is a failure. Sharpe, volatility, CAGR or drawdown cannot rescue a terminal-wealth failure. The runner reports those diagnostics only to explain the result.

## Frozen robustness checks

These checks can falsify but cannot rescue the primary result:

- chronological first and second halves, with a required positive excess-wealth result in both halves of every market;
- costs of 0, 25, 50 and 100 basis points per side, with 50 basis points remaining primary;
- exact replay fingerprint equality from the same verified input.

## Interpretation and stop rule

- `PASS` means only that this exact published rule cleared this retrospective repository screen.
- `FAIL` means the rule does not meet the user's all-five-markets requirement and must not be tuned on these outcomes.
- No neighbouring moving-average length, execution lag, cash return, band or market-specific exception may be tried as a continuation of this test.
- A deployable claim would still require point-in-time investable benchmarks, a complete all-in cost model and genuinely new append-only observations.

Primary source for the original rule family: Mebane T. Faber, *A Quantitative Approach to Tactical Asset Allocation*, updated retrospective/out-of-sample discussion, Journal of Portfolio Management (2018), https://doi.org/10.3905/jpm.2018.44.2.156 . The source does not establish an after-cost five-market win; this protocol tests that stronger claim rather than assuming it.
