# Schema 7: pooled annual walk-forward Fear / Greed strategy

<!-- SCHEMA7_FREEZE_MARKER: FROZEN_SCHEMA7_POOLED_WALK_FORWARD_V1 -->
<!-- SCHEMA7_FREEZE_AT: 2026-08-25T15:53:54.1645065Z -->

Schema 7 was designed after schema 6 returned
`NO_SHARED_HISTORICAL_WINNER`. It is therefore a final retrospective
falsification, not an unseen confirmation. It must not be presented as proof of
future reliability even if it passes.

## Frozen dependencies

Use only the schema-5 snapshot with SHA-256
`ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d`.
Network access is forbidden.

Reuse schema 6 without modification:

- protocol SHA-256:
  `8f81c86c30df9480af898feb4d3e35e19a41847c8b0a5ea0c8527b90a6f261db`;
- runner SHA-256:
  `7f68d4966d0a81d5ed2c762932c70109352f43c748af4c0a442fc4c11a006ce8`;
- all 31 candidate definitions and declaration order;
- target histories, 21st-signal candidate-common start, two-stage score
  rounding, next-target-close execution, no shorting/leverage, fractional
  units, 0% cash return, and no terminal liquidation;
- stress one-way costs: 0.75% Crypto and 0.25% Sweden, USA, Europe and Global.

No new weight, threshold, smoothing, filter, stop, market-specific parameter,
or fixed candidate is permitted. A candidate change is not itself a trade.

## Annual selection using only prior data

The algorithm chooses one candidate for every calendar year and applies that
same candidate to all five markets during the year.

A market is eligible to train the choice for calendar year `Y` only when its
candidate-common history began no later than `1 January Y-3`. This guarantees
three complete prior calendar years. Its training window is exactly the target
closes from `1 January Y-3` through `31 December Y-1`, inclusive. Scores before
the window may be used only as causal indicator warm-up. Each candidate's
virtual training-window strategy and buy-and-hold comparison start fully long
at wealth 1.0, use schema-6 stress costs, and are marked to market at the final
training close.

The first evaluation year is the earliest year for which at least two markets
are training-eligible. It is mechanically expected to be 2015 (USA and Europe),
but the runner must derive and verify it from the frozen input.

For each evaluation year, rank all 31 candidates across the eligible training
markets, lexicographically:

1. more training markets with positive annualized log-return excess over
   buy-and-hold;
2. higher median annualized log excess;
3. higher worst-market annualized log excess;
4. higher equal-market mean annualized log excess;
5. lower immutable schema-6 declaration order.

For a candidate and training market, annualized log excess is exactly
`log(strategy terminal wealth / buy-and-hold terminal wealth) /
((last UTC date - first UTC date) / 365.2425 days)`. The median sorts finite
values ascending; an odd count takes the middle value and an even count takes
the arithmetic mean of the two middle values. Ranking compares full unrounded
finite JavaScript numbers. Exact equality falls through to the next key and,
finally, declaration order.

Equality is not positive. Every candidate must have a finite comparison in
every eligible training market. No minimum-trade filter is applied; a no-trade
candidate merely equals buy-and-hold before costs and gains no positive count.
Only the winning candidate ID and its pre-year training ledger may determine
the following year's live decisions.

## Continuous walk-forward execution

For each market, evaluation begins at the first target close on or after the
later of its candidate-common start and `1 January` of the first evaluation
year. Strategy and buy-and-hold each start fully long at wealth 1.0.

At the first evaluation close, there is no preceding interval or queued order;
observe that close using the already-selected candidate for its calendar year.
At every later completed target close `t`, use this exact event order:

1. Apply the full return from the preceding close to `t` if the position carried
   into the interval was long; cash earns 0%.
2. Execute and clear the one order, if any, that was queued at the preceding
   close, then apply exactly one one-way cost at `t`.
3. Only after that fill, observe the score at `t` using the candidate selected
   before the calendar year containing `t`.
4. If now long and that candidate's displayed score is at or above its frozen
   Extreme Greed boundary, queue one full sale. If now cash and the score is at
   or below its frozen Extreme Fear boundary, queue one all-in buy. Otherwise
   queue nothing. A missing or non-finite score also queues nothing; it never
   prevents a previously queued order from filling in step 2.

A queued order therefore survives a year boundary and cannot be cancelled or
overwritten by the new year's candidate. An opposite order may be queued only
after the carried order has filled and the new close is observed. Position,
pending order, wealth and cash-cycle state carry continuously across calendar
years. A candidate switch never changes position by itself. A terminal signal
without a later close remains unfilled; no forced exit is added.

## Frozen evaluation views

Primary comparisons use the complete continuous evaluation path for each
market. Report terminal wealth, CAGR, annualized log-return excess, volatility,
Sharpe, maximum drawdown, exposure, fills and completed cash cycles.

Also report:

- two chronological halves of each market's intervals: the first half contains
  exactly `floor(N/2)` intervals and the second contains the remainder. State is
  not restarted. A fill and cost at an interval's ending close belong to that
  interval's half; a decision queued at the boundary affects only the next
  interval. Normalize wealth at the boundary while carrying actual state;
- a common calendar view with bounds `L = max(five evaluation start dates)` and
  `U = min(five last target closes)`. For each market, use its first target close
  on or after `L` through its last target close on or before `U`, carry actual
  state into that first close, and exclude the interval crossing into it. At
  that close first record the continuous path after its return, fill, cost and
  observation; normalize that post-close wealth to 1.0, while carrying any new
  queued order into the first included interval;
- complete market-year cells only. An interval belongs to the calendar year of
  its ending close. Count a cell only when the evaluation path contains the raw
  target close immediately preceding that year's first raw target close, that
  first close, and that year's last raw target close, and the raw target series
  contains at least one later close in the following calendar year. This
  includes the interval ending at the first trading close, permits holidays at
  year boundaries, and excludes the partial first and terminal 2026 years
  mechanically. Normalize each complete cell at that raw predecessor close and
  include exactly all path intervals whose ending-close calendar year is the
  cell year.

For every full, half, common or complete-year view, positive excess means
`log(strategy end/start) - log(buy-and-hold end/start) > 0` exactly, with no
epsilon. Annualization changes only the reported scale, never the sign. The
complete-year gate also requires at least one complete cell before testing
`positive cells / total complete cells >= 0.60`.

Calendar years use exact UTC days divided by `365.2425`. Volatility and Sharpe
use simple net interval returns, sample standard deviation and annualization 365
for Crypto or 252 otherwise. Maximum drawdown includes initial wealth and is a
non-positive return from the running peak.

The common equal-capital portfolio is the arithmetic mean of the five
normalized terminal ratios with no rebalance. Buy-and-hold uses identical
target dates and is continuously long.

## Pass gate

The only passing status is `RETROSPECTIVE_WALK_FORWARD_PASS`. Every condition
must hold after stress costs:

1. Strategy terminal wealth exceeds buy-and-hold in at least four of five full
   market paths.
2. Equal-market mean and median annualized log excess are positive, and the
   worst market is no worse than -1.00 percentage point per year.
3. At least seven of ten chronological market-halves have positive excess, and
   every market has at least one positive half.
4. Common-window equal-capital terminal wealth exceeds common buy-and-hold.
5. At least 60% of all complete market-year cells have positive excess.
6. Every market completes at least one signal-driven sell-then-buy cash cycle,
   and at least four markets complete two or more.
7. Maximum drawdown is improved or equal in at least three of five markets.
8. Snapshot, protocol, dependency, selection-ledger and results hashes reproduce
   byte-identically with network disabled.

Otherwise status is `NO_WALK_FORWARD_HISTORICAL_WINNER`. There is one algorithm,
not a candidate leaderboard: no alternative lookback, rebalance frequency,
ranking rule, gate, or new historical strategy may be tried after this result.

All gates compare full unrounded finite values. Gate 2 means arithmetic
mean `> 0`, the standard median defined above `> 0`, and minimum `>= -0.01`.
Gate 5 requires a non-empty denominator. Gate 7 counts a market only when the
strategy's non-positive maximum drawdown is `>=` buy-and-hold's drawdown.
For gate 8, hash a canonical selection ledger and a canonical analysis core
that exclude their own hashes and `generatedAt`; reproduce both byte-identically
in two network-disabled evaluations. The serialized result-file SHA-256 exists
only in its distinct checksum sidecar and is not an input to its own content.

## Required pre-outcome tests

Synthetic tests must prove:

- the first evaluation year and training-eligible markets are mechanically
  derived from three complete prior years;
- changing data in year `Y` cannot change the candidate already selected for
  `Y`, but can affect `Y+1`;
- the exact trailing three-calendar-year training window and shared winner;
- candidate switches do not trade and queued orders survive year boundaries;
- next-close timing, costs, threshold rounding and missing-score holds;
- continuous state with normalized full/half/common/year return views;
- partial market-years are excluded and complete years partition intervals by
  ending-close year;
- all eight gates and the exact 60% boundary;
- pinned dependency hashes, network denial, deterministic replay and distinct
  checksum sidecars.

## Interpretation boundary

Schema 7 was conceived after observing schema 6 fail. Passing would show only
that a fully causal pooled walk-forward meta-rule survived this historical
falsification. A credible reliability claim still requires an append-only
forward test begun after this freeze. Failure ends historical model tuning;
continuing until a winner appears would be data snooping rather than evidence.
