# AM12-CASH exact replication protocol

<!-- AM12_CASH_FREEZE_MARKER: FROZEN_AM12_CASH_V1 -->
<!-- AM12_CASH_FREEZE_AT: 2026-08-25T18:36:41.2020187Z -->

Status: **frozen before a conforming five-market input existed; retrospective development only; not approved for production**.

This protocol defines one rule and no parameter search. A runner may reject an
input, but it may not substitute a yield, a bond ETF, a price-only local index,
zero cash, or a locally denominated return series for a missing required input.

## Required input

The input must declare schema `am12-cash-input-v1`, contain exactly `crypto`,
`sweden`, `usa`, `europe`, and `global`, and provide:

1. one strictly ordered, positive **USD total-return wealth index** for each
   risky market, including distributions and unhedged conversion to USD;
2. one strictly ordered, positive **USD 3-month Treasury-bill/cash total-return
   wealth index**, including reinvestment; and
3. source, methodology, currency, total-return status, observation timezone,
   and retrieval timestamp for every series.

The cash series may be shared by all markets. A quoted annualized T-bill yield
(for example `^IRX`) is not a total-return index and is invalid. `IEF`, another
bond ETF, or an assumed zero cash return is invalid. No interpolation or
yield-to-return reconstruction is permitted inside the runner.

Dates are ISO `YYYY-MM-DD`. Risk-series dates are executable research closes.
For a risk date, the latest cash observation on or before that date may be used
only when it is no more than seven calendar days old. Otherwise the input is
ineligible at that date.

## Frozen signal

- Signal dates are the final eligible risky close in each calendar month.
- Let `t` be that close and `a` be the date exactly 12 calendar months earlier.
  Preserve month and day; if that day does not exist in the prior year (29
  February), clamp it to that month's final calendar day.
- The risky reference is the latest risky close on or before `a`, no more than
  seven calendar days stale relative to `a`.
- Cash values are resolved as-of `t` and the risky reference date, each with the
  same seven-calendar-day maximum staleness.
- Risk return is `R = riskyTRI(t) / riskyTRI(reference) - 1`.
- Cash return is `C = cashTRI(t) / cashTRI(reference) - 1`.
- If `R > C`, the target is 100% risky; otherwise, including equality, it is
  100% cash.

There is no leverage, shorting, volatility scaling, smoothing, fitted threshold,
market-specific parameter, or Fear & Greed input.

## Execution and wealth accounting

- A month-end signal is known only after its close. It executes at the first
  risky close strictly after the signal date.
- The strategy is either 100% risky or 100% cash. Between risky closes, the
  selected wealth index supplies the return.
- Primary one-way cost is 20 basis points (`0.002`) on the absolute allocation
  change. The fixed stress is 40 basis points (`0.004`).
- The full sample starts at the first executable close following the first valid
  signal and ends at the last eligible risky close.
- Strategy and benchmark both start from cash with NAV 1 at the same first
  executable close. Entering risk incurs the applicable one-way cost. At the
  final close, any risky position is liquidated and incurs the same one-way cost.
- Buy-and-hold is 100% risky from that same first close, with the same entry and
  terminal costs. It is recomputed separately at 20 bp and 40 bp.
- Taxes, slippage, spreads, custody, and instrument tracking error are excluded.

## Full history and corrected chronological halves

Report the complete eligible history and two independently restarted halves.
Split the `N` risky close-to-close return intervals at `floor(N/2)`. The first
half receives intervals `[0, floor(N/2))`; the second receives
`[floor(N/2), N)`. The halves share the seam close, so no interval is omitted or
duplicated. Each half restarts strategy and benchmark at NAV 1 on its first
close, using the latest signal whose execution date is on or before that close,
and applies symmetric entry and terminal costs.

Report terminal wealth, annualized log return, maximum drawdown, allocation
changes, and strategy-minus-buy-and-hold values for primary and double cost.
Report every market separately and the equal-initial-capital common-calendar
portfolio only when a common calendar can be formed without interpolation.

## Interpretation boundary

All currently available history is retrospective development data and cannot
confirm reliability. A successful replication would describe this exact rule
only; it would not validate the dashboard Fear & Greed index. The frozen rule
must not be changed after outcomes are viewed.
