# Cross-market GEM-style rotation protocol

<!-- GEM_ROTATION_FREEZE_MARKER: FROZEN_GEM_ROTATION_V1 -->
<!-- GEM_ROTATION_FREEZE_AT: 2026-08-25T18:43:32.5298855Z -->

Status: **frozen before conforming data or outcomes; retrospective research
only; separate from Fear & Greed and AM12-CASH; not approved for production**.

This protocol predeclares two rules. `GEM_TOP1_CASH` is the primary rule.
`GEM_TOP2_SLOTS_CASH` is a robustness report, not a candidate from which the
final period may select a winner. Parameters are identical in Crypto, Sweden,
USA, Europe and Global.

## Literature boundary

The design combines cross-sectional ranking with an own-return-versus-cash
filter. Cross-sectional momentum over 3–12 month formation horizons is
documented by Jegadeesh and Titman (1993), and persistence in an instrument's
own 1–12 month return is documented for futures by Moskowitz, Ooi and Pedersen
(2012). Antonacci describes combining relative and absolute momentum as “dual
momentum.” These sources motivate the small frozen family; none is evidence
that this exact five-index, long/cash implementation will beat its benchmarks.

- Jegadeesh and Titman: https://doi.org/10.1111/j.1540-6261.1993.tb04702.x
- Moskowitz, Ooi and Pedersen: https://doi.org/10.1016/j.jfineco.2011.11.003
- Antonacci: https://doi.org/10.2139/ssrn.2042750

The implementation deliberately omits volatility targeting and leverage. This
avoids attributing any result to volatility scaling rather than momentum.

## Required input

Schema is `gem-rotation-input-v1`, status is
`RETROSPECTIVE_DEVELOPMENT_ONLY`, and the input must contain:

1. exactly five risky USD total-return wealth indices in this fixed order:
   `crypto`, `sweden`, `usa`, `europe`, `global`;
2. one verified USD 3-month Treasury-bill/cash total-return wealth index; and
3. one verified ACWI USD total-return wealth index used only as a benchmark.

Every series declares `id`, `role`, `currency=USD`,
`returnType=total_return`, methodology, source, timezone, exact retrieval UTC,
and strictly ordered positive `{date,value}` rows. Sweden and Europe must
include unhedged USD currency conversion. A yield such as `^IRX`, a bond ETF
such as `IEF`, zero cash, local-currency returns, or price-only indices are not
valid substitutes.

The runner uses only the strict intersection of dates present in all seven
series. There is no as-of fill, interpolation or return reconstruction. Dates
represent completed, executable research closes. Fewer than 25 calendar months
of common data is invalid.

## Frozen monthly signal

- The signal date is the final strict-common close in each calendar month.
- Let `a` be exactly 12 calendar months before the signal date. Preserve month
  and day; clamp 29 February to 28 February when required.
- The reference is the latest strict-common close on or before `a`, no more
  than seven calendar days stale.
- For each risky market `i`, compute `R_i = TRI_i(t)/TRI_i(reference)-1`.
- Compute cash return `C` over the same two strict-common dates.
- Rank markets by `R_i` descending. Exact ties use the frozen market order
  `crypto`, `sweden`, `usa`, `europe`, `global`.
- The signal executes at the first strict-common close after `t`.

`GEM_TOP1_CASH` allocates 100% to the first-ranked market only when its return
is strictly greater than `C`; otherwise it allocates 100% to cash.

`GEM_TOP2_SLOTS_CASH` has two fixed 50% slots. Each of the two highest-ranked
markets receives its 50% slot only when its own return is strictly greater than
`C`; a failed slot remains in cash. Thus it can hold 100% cash, 50% top-one plus
50% cash, or 50% each in the top two. This variant is always reported beside
the primary rule and cannot replace it based on final-period results.

There is no leverage, shorting, fitted threshold, smoothing, Fear & Greed
input, or per-market parameter.

## Execution, costs and metrics

- Portfolios begin from cash with NAV 1 at the first execution close.
- Primary one-way cost is 20 bp (`0.002`) and stress cost is 40 bp (`0.004`).
- Cost equals the rate times absolute risky notional traded. Selling one market
  and buying another therefore counts both one-way legs. Post-cost target
  weights are solved exactly; cash itself has no trading charge.
- Risky and cash notionals then compound by their respective total-return index
  ratios until the next strict-common close.
- Any risky holdings are liquidated with the same cost at the final close.
- No leverage or shorting is allowed; target risky weights sum to at most one.

For each rule and cost, report terminal wealth, annualized log return,
annualized volatility from common-close log returns, maximum drawdown, total
one-way risky turnover and rebalance count.

Report these same-start benchmarks with the same entry and terminal cost:

1. ACWI buy-and-hold;
2. a 20%/market five-market portfolio rebalanced at every monthly execution;
3. buy-and-hold for each of the five risky market indices.

All benchmarks and rules use the identical first and final strict-common close.
Taxes, spreads, slippage, custody and tracking error are excluded.

## Evaluation boundary

Both frozen variants must be reported. The primary designation cannot change
after outcomes are seen, and no final or holdout segment may be used to select
between them. All currently available history is retrospective development
data, not confirmation. Failure is reported as failure; it is not permission
to alter lookback, ranks, cash gate, weights or costs on the same history.
