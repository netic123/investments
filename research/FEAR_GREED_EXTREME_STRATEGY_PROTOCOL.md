# Schema 6: direct Extreme Fear / Extreme Greed strategy backtest

<!-- SCHEMA6_FREEZE_MARKER: FROZEN_SCHEMA6_EXTREME_STRATEGY_V1 -->
<!-- SCHEMA6_FREEZE_AT: 2026-08-25T15:22:18.061Z -->

This protocol was frozen before any direct strategy-versus-buy-and-hold return
was calculated. Earlier schema-5 work had already inspected the same historical
market outcomes for a different 21-bar forecast-MSE question. Consequently,
schema 6 is a bounded retrospective development study, not an independent or
prospective validation.

## Question and permitted claim

The tested question is whether one shared score rule can historically improve
on continuous buy-and-hold by being long after Extreme Fear and in cash after
Extreme Greed. A passing result may be called
`HISTORICALLY_WORKS_RETROSPECTIVELY`; it may not be called a validated
predictor, proof of future profit, or investment advice.

## Frozen input

The study is network-free and uses only:

`research/local-artifacts/v2-validation-final/inputs/fear-greed-v2-validation-input-2026-08-25T12-44-22Z.json`

Its required SHA-256 is
`ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d`.
The schema-5 reader must validate that snapshot, its captured Yahoo payloads,
the target series, and the reconstructed six-component signal histories before
schema 6 calculates outcomes. No second download, data repair, target change,
or constituent change is allowed.

The five frozen targets are:

- Crypto: `CRYPTO-BROAD-EW`, a synthetic fixed seven-coin daily-rebalanced
  equal-weight basket.
- Sweden: `^OMXSBGI`.
- USA: `SPY` adjusted close.
- Europe: `^STOXX`.
- Global: `ACWI` adjusted close.

## Frozen shared candidate family

Exactly 31 distinct candidates are allowed. Every candidate is applied
unchanged to all five markets.

### A. Published-score threshold family (18)

Use only the stored production `publishedScore`:

- buy boundary `F` in displayed integer points: `{15, 20, 24}`;
- sell boundary `G` in displayed integer points: `{75, 80, 85}`;
- trailing causal arithmetic score mean `S`: `{1, 5}` observations.

This is the Cartesian product `3 x 3 x 2 = 18`. The canonical current-label
rule is `P_F24_G75_S1`. A smoothed score is rounded exactly as production before
classification: `Math.round(Math.round(score * 10) / 10)`. Thus every permitted
buy is inside production's Extreme Fear bucket (integer score 0-24), and every
sell is inside Extreme Greed (75-100).

Declaration order is the nested loop `F`, then `G`, then `S`, each in the order
shown above.

### B. Frozen component-weight family (13 additional)

Reuse the exact 15 schema-5 weight/smoothing candidates, but remove `equal_s1`
and `equal_s5` because their equivalent shared ideas already occur in family A.
For these 13 candidates, use the schema-5 component candidate score and the
fixed current-label boundaries `F=24`, `G=75`. `equal_s1`, when reported as the
canonical production rule, always uses the stored 0.1-point published score.
Their declaration order follows schema 5 after excluding `equal_s1` and
`equal_s5`, and follows the 18 published-score candidates.

No candidate may be added, removed, changed, or made market-specific after an
outcome is visible. There are no crossing-only variants, stop losses, trend
filters, shorts, leverage, partial allocations, market-specific parameters, or
post-outcome threshold changes.

All candidates share the same first decision date within each market: the 21st
valid signal row, because the reused frozen family contains a 21-observation
smoothing candidate. Earlier score rows may be used only as causal warm-up.
This prevents a shorter smoothing window from receiving a longer test interval.

## Causal state machine

Primary interpretation is an investor who already owns the target at the first
decision close. Strategy and buy-and-hold each begin at wealth 1.0 and fully
invested at that identical close, with no artificial initial transaction.

For each target's own ordered bar calendar:

1. Observe the completed score at close `t`.
2. If long and the displayed score is at least `G`, queue a full sale.
3. If cash and the displayed score is at most `F`, queue an all-in buy.
4. Otherwise keep the current state. Repeated same-state signals do not trade.
5. The queued order executes only at the next available target close `t+1` and
   cannot be cancelled with information learned at `t+1`.
6. The position held before the `t+1` close earns (or avoids) the full
   `t -> t+1` target return. The new position applies only afterward.
7. Cash earns 0%; fractional units are allowed. There is no shorting or leverage.
8. An order with no later target close is unfilled. The terminal open position
   is marked to market and is not forcibly liquidated.

A secondary sensitivity starts in cash and waits for its first Extreme Fear
entry. It is never used to select or pass a candidate.

## Costs and benchmark

Every actual state change multiplies wealth by `(1 - cost)`. Costs are applied
once per fill, after the preceding close-to-close return and at the execution
close. Signals that do not change state have no cost.

| Market | Base one-way cost | Stress one-way cost |
|---|---:|---:|
| Crypto | 25 bp | 75 bp |
| Sweden | 10 bp | 25 bp |
| USA | 10 bp | 25 bp |
| Europe | 10 bp | 25 bp |
| Global | 10 bp | 25 bp |

Zero cost is diagnostic only. The primary table uses base cost and the pass gate
uses stress cost. Taxes, variable spread/slippage, FX conversion, account fees,
and interest on cash are excluded.

Buy-and-hold remains fully invested from the same first close through the same
last close. Because both legs represent an already-owned position and are
marked to market, neither receives an initial or terminal fee. Its terminal
wealth is the exact target close ratio on the matched interval.

## Windows and metrics

Report each candidate on:

- each market's full candidate-common history;
- two independent chronological halves of each market's close-to-close
  intervals, each initialized fully invested at wealth 1.0;
- one common-calendar sensitivity from the latest of the five first eligible
  dates to the earliest of their last dates.

The full-history result is the primary historical comparison. Halves and the
common window are robustness diagnostics, not unseen holdouts.

For strategy and buy-and-hold report matched start/end dates, target bars,
calendar years, terminal wealth, total return, CAGR, annualized log-return
excess, annualized volatility, Sharpe ratio with zero cash rate, and maximum
drawdown. For the strategy also report exposure, cash share, fills, signal buys,
signal sells, completed sell-then-buy cash cycles, unfilled terminal orders,
total cost haircut, and longest invested/cash bar runs. Never collapse these
into one ambiguous trade count.

Common-calendar aggregate wealth is the arithmetic mean of five equal starting
allocations, rebalanced only at inception. Its comparison is the corresponding
mean of the five buy-and-hold terminal wealth values.

Calendar years are exact UTC date distance divided by `365.2425`. Volatility
and Sharpe use simple close-to-close net returns, sample standard deviation,
and the frozen market annualization (`365` for Crypto, `252` otherwise).
Maximum drawdown includes initial wealth 1.0 and is reported as a non-positive
return from the running peak. For an odd number of matched intervals, the first
half receives `floor(N/2)` intervals and the second receives the remainder.
Window boundaries are inclusive target closes. Total cost is reported both as
the relative haircut `1 - W_cost/W_zero` and the absolute terminal-wealth
difference `W_zero - W_cost`.

## Frozen ranking and historical pass gate

Candidate ranking is deterministic, in this order:

1. passes every gate below;
2. more full-history markets with positive stress-cost excess CAGR;
3. more positive market-by-half stress-cost cells;
4. higher common-window equal-capital annualized log excess;
5. higher median full-history stress-cost excess CAGR;
6. higher mean full-history stress-cost excess CAGR;
7. higher worst-market full-history stress-cost excess CAGR;
8. lower immutable declaration order.

A shared candidate receives `HISTORICALLY_WORKS_RETROSPECTIVELY` only when all
of the following hold under stress costs:

1. It beats buy-and-hold terminal wealth in at least four of five full histories.
2. Its equal-market mean and median full-history annualized log excess are both
   positive, and its worst-market excess is no worse than -1.00 percentage point.
3. At least seven of ten market-by-half cells have positive terminal-wealth
   excess, and every market has at least one positive half.
4. Its equal-capital common-window terminal wealth exceeds common-window
   buy-and-hold.
5. It completes at least one signal-driven sell-then-buy cash cycle in every
   full market history and at least two in four of five markets.
6. Maximum drawdown is improved or equal in at least three of five full histories.
7. The candidate and all input/code/protocol hashes replay deterministically.

If no candidate passes, status is `NO_SHARED_HISTORICAL_WINNER`. The top-ranked
failure is still reported with every failed gate. Gates must not be weakened and
the family must not be expanded after seeing that failure.

## Required pre-outcome tests

Before the real snapshot is evaluated, synthetic tests must cover:

- exact production rounding boundaries (`24.4/24.5`, `74.4/74.5`);
- one-bar delayed execution, including the loss/gain on the exit bar;
- target-calendar gaps rather than calendar-day execution;
- causal five-observation smoothing and common start date;
- repeated-extreme signal de-duplication and state carry;
- one-way multiplicative costs on actual fills only;
- a terminal unfilled order and no forced liquidation;
- matched buy-and-hold interval and metrics;
- exactly 31 unique, shared candidates and deterministic ranking;
- deterministic network-free replay and analytical fingerprint.

## Known evidence limits

This study tests a timing rule, not whether the score adds forecast information
beyond controls. Historical candidate selection is exposed to data snooping.
Yahoo is not signed official point-in-time exchange data and may revise history.
The targets are economically heterogeneous: Sweden is a gross-return index,
Europe is a price index, USA/Global are adjusted-close ETF proxies, and Crypto
is a non-investable synthetic fixed-constituent backcast with selection and
survivorship bias. A genuine reliability claim requires a locked append-only
forward test started after this protocol.
