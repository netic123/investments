# Long equity-panel rotation falsification protocol

<!-- EQUITY_ROTATION_PANEL_FREEZE_MARKER: FROZEN_EQUITY_ROTATION_PANEL_V1 -->
<!-- EQUITY_ROTATION_PANEL_FREEZE_AT: 2026-08-25T18:50:41.9155366Z -->

Status: **frozen before this panel's outcomes were calculated; retrospective
falsification research only; not authoritative, confirmatory, or approved for
production**.

This test asks whether a simple, uniform cross-market momentum allocator
survives a materially longer equity-only history before broad crypto is added.
It does not tune or replace any live Fear & Greed value. Both frozen variants
are always reported; the result may not select whichever one happens to win.

## Frozen investable proxies and source boundary

The four risky assets, in fixed tie-break order, are:

1. `sweden`: EWD, iShares MSCI Sweden ETF;
2. `usa`: IYY, iShares Dow Jones U.S. ETF;
3. `europe`: IEV, iShares Europe ETF; and
4. `global`: ACWI, iShares MSCI ACWI ETF.

Daily USD adjusted closes are retrieved from Yahoo Finance. Yahoo states that
adjusted close applies split and dividend-distribution multipliers. The series
are therefore treated as **USD market-price total-return proxies**, not fund
NAV returns or licensed index total returns. They are current-vintage data:
Yahoo may correct history, the endpoint is not a contractual research feed,
and this run does not have a point-in-time vintage archive. The four underlying
fund identities were cross-checked against the issuer's official product pages:

- EWD: https://www.ishares.com/us/products/239684/ishares-msci-sweden-etf
- IYY: https://www.ishares.com/us/products/239513/ishares-dow-jones-us-etf
- IEV: https://www.ishares.com/us/products/239736/ishares-europe-etf
- ACWI: https://www.ishares.com/us/products/239600/ishares-msci-acwi-etf
- Yahoo adjusted-close definition: https://help.yahoo.com/kb/SLN28256.html

The cash proxy starts from FRED series DTB3, the Federal Reserve Board's daily
3-Month Treasury Bill Secondary Market Rate on a bank-discount basis:
https://fred.stlouisfed.org/series/DTB3. DTB3 is a quoted yield, **not** a
total-return index. The runner transparently reconstructs a hypothetical
constant 91-day-bill wealth series and labels it as such. For a quoted annual
discount rate `d`, each observed rate implies:

```
price per $1 maturity = 1 - d * 91 / 360
91-day gross return   = 1 / price
calendar-day factor  = (1 / price)^(1 / 91)
```

The most recent non-missing observation at or before a day is accrued from
that close until the next observation. A rate more than seven calendar days
old is invalid. This assumes frictionless rolling, no taxes, no bid/ask spread
and no reinvestment delay; consequently the reconstructed cash series is a
development proxy, not an investable or official T-bill total-return index.

## Input and calendar

The input schema is `equity-rotation-panel-input-v1` and status is
`RETROSPECTIVE_DEVELOPMENT_PROXY_ONLY`. Raw response SHA-256 hashes, retrieval
UTC, requested cutoff, source URLs, Yahoo metadata and derived rows are stored.
The current UTC date is excluded so an intraday bar cannot enter the run.

The trading calendar is the strict intersection of completed adjusted-close
dates for EWD, IYY, IEV and ACWI. No equity close is forward-filled. The common
history must begin no later than seven calendar days after ACWI's official
26 March 2008 inception and must contain at least 15 years. The first common
close is the panel start; the backtest begins only once a 12-month signal can
execute.

## Frozen signal and execution

- The signal close is the final strict-common close in each calendar month.
- The anniversary target is exactly 12 calendar months earlier, clamping 29
  February to 28 February when necessary.
- The reference is the latest strict-common close on or before that target and
  may be no more than seven calendar days stale.
- Each risky return and the reconstructed cash return use those same two dates.
- Risky markets rank by 12-month return, descending. Exact ties use the frozen
  order `sweden`, `usa`, `europe`, `global`.
- The signal executes only at the first strict-common close after the signal.

`ROTATION_TOP1_CASH` holds the top-ranked market at 100% only when its return is
strictly greater than cash; otherwise it holds 100% cash.

`ROTATION_TOP2_SLOTS_CASH` has two immutable 50% slots. Each of the top two
markets receives its slot only when its own return is strictly greater than
cash; a failed slot remains in cash. This is a robustness result, not a second
model from which the historical winner may be chosen.

There is no leverage, shorting, volatility targeting, Fear & Greed input,
fitted threshold, per-market parameter, or same-close execution.

## Costs, benchmarks, windows and metrics

The primary one-way cost is 20 basis points and the stress cost is 40 basis
points. Cost equals the rate times absolute risky notional traded. A rotation
therefore pays for both the sell and buy legs. Post-cost target weights are
solved exactly. All portfolios enter from cash and liquidate risky assets at
the window end; cash itself has no trading cost.

At both costs and over each window, report:

- both frozen rotation rules;
- ACWI buy-and-hold;
- 25% in each ETF, rebalanced at every monthly execution date; and
- buy-and-hold in each of EWD, IYY, IEV and ACWI.

Every comparison uses the same start and end closes. Report terminal wealth,
cumulative return, CAGR, annualized log return, annualized volatility of daily
common-close log returns, maximum drawdown, total one-way turnover in portfolio
turns, rebalance/trade count and total modeled cost paid.

The full window runs from the first executable signal through the last common
close. The chronological split date is frozen mechanically as the first
monthly execution close on or after the calendar-time midpoint between those
dates. The two independent half-window runs are `[start, split]` and
`[split, end]`. A target that executes exactly at an end close is not opened
just to liquidate immediately. Both halves independently pay entry and exit
costs.

## Interpretation boundary

This panel can falsify a weak idea but cannot confirm a universal edge. Sweden,
Europe and Global overlap economically; the assets share a U.S. trading
calendar and USD currency exposure; ACWI is both a candidate and benchmark;
and all available outcomes are already retrospective. Taxes, exact spreads,
market impact, ETF premiums/discounts, tracking error and current-vintage
revision risk are not modeled. A good result remains hypothesis-generating and
must be followed by a separately frozen, append-only prospective test.
