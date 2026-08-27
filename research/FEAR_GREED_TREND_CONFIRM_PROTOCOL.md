# Schema 8: trend-confirmed Extreme Fear / Extreme Greed strategy

<!-- SCHEMA8_FREEZE_MARKER: FROZEN_SCHEMA8_TREND_CONFIRM_V1 -->
<!-- SCHEMA8_FREEZE_AT: 2026-08-25T16:35:00.861Z -->
<!-- SCHEMA8_RUNNER_NORMALIZED_SHA256: 4fc79435f90d6dabfb90fa8cf534bcd07cfd700ad493a80b099ab417c1331624 -->

This protocol was frozen before the schema-8 strategy was evaluated on the
historical outcomes. The underlying schema-5 history and other retrospective
analyses had already been viewed, so schema 8 is a predeclared but
**retrospective exploratory** experiment. It is not an untouched holdout, a
reliability claim, a causal-economic result, or investment advice.

## One frozen question and one rule

The only tested rule is `EFG90_TREND12M_CASH_50BP`. It asks whether an Extreme
Fear or Extreme Greed observation can act as a temporary setup while a
12-calendar-month price trend confirms the eventual entry or exit. There is no
candidate search, market-specific calibration, alternate threshold, stop,
short, leverage, partial allocation, smoothing choice, or post-result change.

The same thresholds and state machine apply unchanged to Crypto, Sweden, USA,
Europe, and Global:

- Extreme Fear: published production score `<= 24`;
- Extreme Greed: published production score `>= 75`;
- setup life: through trigger date plus exactly 90 calendar days, inclusive;
- trend lookback: exactly 365 calendar days, using the newest completed target
  close on or before the anniversary, provided it is no more than seven
  calendar days older than the anniversary;
- execution: the next completed target close;
- starting state: cash, with no active arm;
- one-way cost: 50 basis points on every filled buy and every filled sell;
- cash return: zero.

## Frozen input and provenance

The study is network-free and accepts only:

`research/local-artifacts/v2-validation-final/inputs/fear-greed-v2-validation-input-2026-08-25T12-44-22Z.json`

Required SHA-256:
`ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d`.

The schema-5 reader must validate the sidecar, captured Yahoo payloads,
normalized source inventory, target construction, exact five production
mappings, reconstructed six-component signal histories, protocol/config/code
hashes, Node version, and platform before schema 8 reads an outcome. No
network, repair, revised history, target substitution, or constituent change is
permitted.

Frozen targets are `CRYPTO-BROAD-EW`, `^OMXSBGI`, adjusted `SPY`, `^STOXX`, and
adjusted `ACWI`. Their heterogeneous economics and the synthetic crypto
backcast remain limitations.

## Exact causal inputs

For target date `t`, `P_t` is its positive completed target close and `S_t` is
the stored 0.1-point production `publishedScore` for that exact date. A missing
same-date score is never carried forward to create or refresh an arm. An
already-active arm may be confirmed on a later target bar without a new score.

All dates are strict `YYYY-MM-DD` UTC calendar labels. Historical score rows
must already have passed schema-5 point-in-time reconstruction. The rule is
information-causal/no-lookahead; this does not establish economic causation.

For each target bar `t`, set `a = t - 365 calendar days`. Let `ref(t)` be the
latest completed target close whose date is `<= a`. The reference is valid only
when `0 <= a - ref(t) <= 7` calendar days. Define

`trend(t) = log(P_t / P_ref(t))`.

- `trend(t) > 0` is bullish;
- `trend(t) < 0` is bearish;
- exact zero or a missing reference is neutral and cannot confirm.

Only rows before the evaluation start may be used to construct the trend
reference; they earn no strategy or benchmark return.

## Exact state-machine ordering

State is `CASH` or `LONG`, plus no arm, `FEAR_ARM`, or `GREED_ARM`, and at most
one pending order. Every independently evaluated window starts `CASH`, with
wealth 1.0, no arm, and no pending order.

At each completed target close, process in this order:

1. If an order was queued on the preceding processed target bar, first earn or
   avoid the entire preceding close-to-close return using the old position,
   then fill the unconditional order at the current close. A filled buy divides
   wealth by `1.005`; a filled sell multiplies wealth by `0.995`. Clear the arm,
   change state, and skip all signal processing on this execution bar.
2. Otherwise, remove an arm when the current calendar date is strictly after
   its expiry. The expiry date itself remains valid.
3. If state is `CASH` and same-date `S_t <= 24`, create or refresh a `FEAR_ARM`
   through `t + 90 calendar days`. If state is `LONG` and `S_t >= 75`, create or
   refresh a `GREED_ARM` through the same horizon. An opposite-state extreme is
   ignored. A repeated qualifying extreme refreshes the arm from its new date.
4. After that update, if `CASH` with an active `FEAR_ARM` and `trend(t) > 0`,
   queue an all-in buy. If `LONG` with an active `GREED_ARM` and
   `trend(t) < 0`, queue a full sale. Same-bar arming and confirmation is
   allowed, but the fill is still only at the next completed target close.
5. A queued order cannot be cancelled using later information. If no later
   close exists it is reported unfilled. Terminal positions are marked to
   market and never forcibly liquidated.

The position held before an execution close earns that entire interval's
return. Fractional units are allowed. There is no interest, shorting, or
leverage. One completed buy-plus-sell cycle means a filled buy followed later
by its first filled sell; because every window starts cash, filled sells count
completed cycles.

## First eligible date and matched benchmark

For each market, the full history starts at the earliest stored signal date
that has an exact target close and a valid trend reference under the rule above.
All subsequent target bars through the last frozen close are processed.

Matched buy-and-hold starts fully invested at wealth 1.0 at that same first
eligible close and remains invested through the same final close. It is a
frictionless reference and receives no artificial initial or terminal fee;
this is deliberately stricter for the timing strategy. Strategy cash earns
zero. Taxes, product fees, FX conversion, variable spread, market impact, and
crypto basket rebalancing costs are excluded, so even a pass is not a claim of
deployable after-tax profit.

## Windows

Report the single rule in three views:

1. Each market's full eligible history.
2. Two independent chronological halves of each full history's intervals. If
   there are `N` intervals, half one gets `floor(N/2)` and half two gets the
   remainder; both restart cash/no-arm at wealth 1.0. Pre-window target history
   remains available only for causal trend references.
3. A literal common-five-market calendar sensitivity. Intersect the eligible
   target dates of all five markets. Use its first and last dates as common
   endpoints. Each market runs the unchanged state machine on all of its own
   target bars between those exact endpoints, then its wealth is sampled on the
   intersected dates. The aggregate path is the arithmetic mean of five equal
   inception allocations with no rebalancing. The matched aggregate benchmark
   is constructed identically. This preserves each market's genuine next-bar
   execution while giving the aggregate an exact shared date grid.

Chronological halves and the common-calendar view are robustness diagnostics,
not unseen holdouts.

## Metrics

For strategy and benchmark in every market/window report start/end dates,
target bars, intervals, calendar years, terminal wealth, total return, CAGR,
annualized log return, annualized volatility of simple interval returns using
sample standard deviation, and maximum drawdown including initial wealth 1.0.
Use `365` observations per year for Crypto and `252` for every equity tab.
Calendar years equal exact UTC day distance divided by `365.2425`.

Also report terminal-wealth difference and ratio, excess CAGR, annualized log
return excess, volatility difference, and drawdown improvement. Strategy audit
fields are exposure, cash share, signal arms, queued orders, filled buys,
filled sells, total fills, completed buy-plus-sell cycles, unfilled terminal
orders, longest long/cash interval runs, event ledger, wealth curve, and the
relative/absolute terminal haircut against the identical zero-cost path.

For the common aggregate path report the same wealth, CAGR, volatility, and
drawdown metrics on the exact intersected date grid. Common volatility uses
252 observations because that grid is restricted by the four equity-market
calendars. Aggregate trade counts are the sums of the five underlying runs.

## Frozen retrospective exploratory gate

Status is `RETROSPECTIVE_EXPLORATORY_GATE_PASS` only when every condition below
holds at the frozen 50-bp one-way cost; otherwise it is
`RETROSPECTIVE_EXPLORATORY_GATE_FAIL`:

1. Strategy terminal wealth exceeds matched buy-and-hold in at least four of
   five full histories.
2. Strategy terminal wealth exceeds matched buy-and-hold in at least seven of
   ten independent chronological-half cells.
3. Common-calendar aggregate terminal wealth exceeds its matched aggregate
   buy-and-hold wealth; equivalently its annualized log excess is positive.
4. At least four of five full histories contain at least one actual filled
   buy-plus-sell cycle.
5. Strategy maximum drawdown is no worse than buy-and-hold in at least three of
   five full histories.
6. No full-history strategy terminal wealth is below 80% of matched
   buy-and-hold terminal wealth.
7. Snapshot/protocol/normalized-runner/dependency hashes validate, two
   in-process analyses are byte-identical, and saved-result replay is designed
   to reject any source, input, result, or checksum drift.

There is no ranking and no fallback rule. Gates may not be weakened after an
outcome is visible.

## Hash and replay contract

The runner hard-codes the protocol SHA-256 and validates the normalized runner
SHA-256 written above. Runner normalization replaces only the two declared hash
literal values with 64 zeroes, avoiding a self-referential digest while locking
all executable logic. Results record the actual runner digest, normalized
runner digest, protocol digest, exact input digest, schema-5 dependency hashes,
Node version, and platform.

Normal execution and replay both disable `global.fetch`, accept only the frozen
snapshot digest, validate its sidecar, and calculate the analysis twice. Replay
also verifies the saved result's sidecar, exact frozen design, source hashes,
analysis fingerprint, and byte-for-byte equality with a fresh offline result.

## Evidence boundary

Moskowitz, Ooi, and Pedersen (2012, JFE,
<https://doi.org/10.1016/j.jfineco.2011.11.003>) provide a prior for
one-to-twelve-month own-return persistence across futures. Huang, Li, Wang, and
Zhou (2020, JFE, <https://doi.org/10.1016/j.jfineco.2019.08.004>) find much
weaker asset-level and out-of-sample evidence on re-examination. Schmeling
(2009, JEF, <https://doi.org/10.1016/j.jempfin.2009.01.002>) reports an average
contrarian sentiment-return relationship across 18 countries but meaningful
cross-country heterogeneity. None tests this repository score, these exact
thresholds, the 90-day arm, this conjunction, or all five targets.

Accordingly, a pass can only mean that this one frozen rule cleared its
predeclared **retrospective exploratory** hurdles on already-known history. A
reliability statement requires a later append-only prospective period that was
not available when this protocol and implementation were frozen.
