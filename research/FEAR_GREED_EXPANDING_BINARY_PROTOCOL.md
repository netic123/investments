# Fear & Greed expanding-history binary signal protocol

<!-- FG_EXPANDING_BINARY_FREEZE_MARKER: FROZEN_PRE_OUTCOME_2026_08_28_V1 -->
<!-- FG_EXPANDING_BINARY_MODEL_ID: FG-ONLINE-RIDGE-PREQ-V1 -->

## Status and question

This protocol defines one deterministic research signal that, after every
completed target close, uses every fully matured observation available from
the beginning of that market's usable history and emits exactly one target
state: `BUY`/`LONG` or `SELL`/`CASH`.

The historical replay is **retrospective prequential development only**.  It
can falsify this algorithm and can prove its row-level timing is causal.  It
cannot validate the family, erase prior inspection of the same histories, or
support a claim that future returns will beat the index.  Only immutable
decisions made after the final code/data manifest is frozen can become
prospective evidence.

The economic diagnostic asks whether the exact target-state path finishes at
least 2.000 times as wealthy as continuous buy-and-hold in the same target,
over the same available signal period, after the costs below.  The diagnostic
is reported separately for every market.  A universal claim requires every
configured market to pass; a single passing tab is never presented as a
universal winner.  This gate never changes a decision or stops a replay early.
Because this version fixes cash at zero, its number is never an investable x2
pass; it is a price-series diagnostic only.

## Input and completed-bar rule

For the frozen five-market replay, input is the exact schema-5 snapshot
`research/local-artifacts/v2-validation-final/inputs/fear-greed-v2-validation-input-2026-08-25T12-44-22Z.json`
with SHA-256
`ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d`, including its
target close histories, exact published 0.1-point composite scores and all six
component scores.  That snapshot is already classified as retrospective
development data.

Target suitability is frozen as follows:

| Market | Target | Suitability for this version |
|---|---|---|
| Crypto | `CRYPTO-BROAD-EW` | synthetic, hindsight-selected analytical basket; not investable |
| Sweden | `^OMXSBGI` | gross-return reference index; not the declared executable strategy instrument |
| USA | `SPY` adjusted close | ETF total-return proxy, but zero-cash model remains non-executable |
| US Tech live extension | `XLK` adjusted close | ETF total-return proxy outside schema 5; zero-cash model remains non-executable |
| Europe | `^STOXX` | price index that omits dividends; unsuitable for an x2 wealth claim |
| Global | `ACWI` adjusted close | ETF total-return proxy, but zero-cash model remains non-executable |

Accordingly every market in this version is
`UNSCORABLE_FOR_INVESTABLE_X2`, even if its price-series diagnostic exceeds
2.000.  These labels cannot be changed after seeing results.
`SPY`, `XLK` and `ACWI` must carry a fully adjusted series flag; an unadjusted
fallback is invalid and emits `SELL` with suitability
`UNADJUSTED_CLOSE_NOT_TOTAL_RETURN`.  Every configured target identity is
pinned to the table above; a mismatch is invalid and cannot inherit the old
disclosure.

For a live decision, every target and component source must exclude the
retrieval date in that source's exchange-local timezone.  This deliberately
accepts a one-day lag.  The collector must run before the next canonical
target close, record `availableAtUtc` as the latest availability time of every
required input, and execute only at the first target close strictly after both
the feature close and `availableAtUtc`.  A collection that misses that window
must never use an already-passed historical close; it emits the invalid-data
fallback for the next future close and is not a model forecast for MSE.

This version does not pretend that a date-only price history identifies that
future close.  Retrospective rows carry `availableAtUtc = null` and use the
frozen next-close replay.  Exactly one current final row may carry a precise
UTC availability timestamp; its execution index remains unresolved and its
card states the future-close rule.  A historical row with a non-null
availability timestamp is rejected.  Prospective activation remains blocked
until an append-only collector records exact eligible close timestamps and
implements the missed-window fallback above.

A stale fallback, partial bar, missing component, identity/hash failure or
non-increasing date is invalid.  It creates the mandatory fail-closed `SELL`
target for the next eligible future close and remains in the economic ledger.
The UI may continue to display that last emitted binary target with its
original decision date and a stale/invalid label; it must not relabel an old
model decision as newly verified.

Current-vintage Yahoo histories can revise.  A live/prospective collector must
therefore preserve append-only raw bytes, normalized values, retrieval time,
source timezone, model/code/config hashes and the decision hash.  A later
revision is a separate audit record and never overwrites the original scored
decision.

## Calendar, label and causal order

The learner is fitted separately per market.  There is no cross-market
pooling, rolling window, reset, decay or deletion of an old eligible row.

Let `t` be a completed target close with a valid score row and let `P[t]` be
the exact target series level.  The feature vector observed at `t` forecasts
the one-bar log return earned only after next-close execution:

```
y[t] = log(P[t+2] / P[t+1])
```

Cash return is fixed at zero in this development diagnostic because the live
contract does not yet contain an executable, currency-matched total-return
cash instrument for every tab.  This limitation is displayed and no
investability or total-return claim is allowed for an unsuitable target.

At close `t`, a training row is eligible only when its complete outcome close
is already known: `featureIndex + 2 <= t`.  Processing order is fixed:

1. apply the `t-1` to `t` return using the position carried over that interval;
2. fill exactly action `a[t-1]`, emitted after close `t-1`, charging one-way
   cost if the position changes;
3. add every newly matured label ending at `t` to the expanding statistics;
4. fit from all matured rows and emit `a[t]` for close `t+1`.

Thus `a[t]` fills at `t+1`, controls the return from `t+1` to `t+2`, and its
label first enters a later fit after close `t+2`.  No score observed at `t` can
affect wealth before close `t+1`, and a queued target cannot be cancelled using
information at its execution close.  If there is no scheduled score row at a
target close, the invalid-data fallback is the action for that index; execution
indices are never silently skipped or reused.

## Frozen pattern family

The full model `M1` is one expanding ridge regression.  A nested price-only
control `M0` is calculated for attribution but never substitutes for `M1`.
Both models use the identical intersection of dates on which every `M1`
feature and matured label is complete, plus identical refit origins,
prediction dates, execution dates and endpoints.  The intercept is
unpenalized and every other coefficient uses fixed `lambda = 1.0` under the
objective

```
mean((y - prediction)^2) + lambda * sum(beta[j]^2).
```

Every raw square and interaction column is constructed first and then treated
as its own predictor.  For training matrix `X`, unstandardized label `y`,
population column standard deviations `s` and `n` matured rows, the exact fit
is:

```
Z[i,j] = (X[i,j] - mean(X[,j])) / s[j]
beta = inverse(Z'Z/n + lambda*I) * Z'(y - mean(y))/n
intercept = mean(y)
prediction = intercept + zCurrent' * beta
```

The algebraically equivalent `Z'Z + n*lambda*I` form is permitted.  Training
rows are not clamped.  Only the current prediction vector is clamped to
`[-5, 5]`, after standardization from the matured training set.  This choice
allows raw sums and cross-products to reproduce a direct full expanding batch
fit exactly.  Zero-variance features receive coefficient and standardized
value zero.  No current/unmatured row enters means or standard deviations.
There is no lambda search, feature selection, cross-validation or
market-specific parameter.

`M0` uses five target-price controls, all known at `t`:

1. one-bar log return;
2. five-bar log return;
3. twenty-bar log return;
4. population standard deviation of the latest twenty one-bar log returns;
5. log target level divided by its 125-bar arithmetic mean.

`M1` adds this fixed seven-term Fear & Greed pattern basis:

1. published composite score minus 50;
2. the square of that centered score;
3. one-score-row change;
4. five-score-row change;
5. twenty-one-score-row change;
6. population standard deviation of the six current component scores;
7. centered composite score multiplied by the 125-bar target trend feature.

Every feature must be finite.  Component dispersion requires exactly the six
production components.  The minimum fit is 252 matured rows.  The learner is
refitted at every valid decision using incremental sufficient statistics that
are mathematically equivalent to the equations above.  A direct
batch-versus-incremental synthetic equality test is mandatory at multiple
sample sizes.

## Mandatory binary state

Initial filled position is `LONG`, matching buy-and-hold without an artificial
initial transaction.  `BUY` and `SELL` are target states, not instructions to
repeat a transaction every day:

- `BUY`: target risky weight 1.0 in the exact benchmark target.
- `SELL`: target risky weight 0.0; the development replay earns zero on cash.
- A repeated state incurs no trade or cost.
- No shorting, leverage, borrowing, option, rotation or fractional allocation.

The state path uses the exact log equivalent of the stress one-way cost as a
fixed hysteresis hurdle, `k = -log(1 - stressCost)`:

| Market class | Primary one-way cost | Stress one-way cost/hurdle |
|---|---:|---:|
| Crypto analytical basket | 0.25% | 0.75% |
| Every equity/index tab | 0.10% | 0.25% |

For a valid fit with predicted risky log return `mu`:

- if currently `CASH`, change to `BUY` only when `mu > k`;
- if currently `LONG`, change to `SELL` only when `mu < -k`;
- equality retains the current state.

The same target-state ledger is replayed at primary and stress costs.  Costs
must never cause a friendlier model to be reselected.

Fallbacks are also mandatory states and remain in the scored path:

- fewer than 252 matured rows: `BUY`, reason `WARMUP_BUY_BASELINE`;
- invalid/missing current features or failed fit: `SELL`, reason
  `FAIL_CLOSED_DATA_INVALID`.

Invalidity takes precedence over warm-up: an invalid row with fewer than 252
matured observations is still `SELL`, never the valid-row warm-up `BUY`.

For interval gross risky factor `R`, cash factor `1`, pre-fill position `q`
and the prior action, wealth first earns `q*R + (1-q)`, then is multiplied by
`1-cost` exactly once if the filled action changes `q`.  The position is then
set to that action.  Neither strategy nor benchmark is liquidated at the end.
The final queued action is reported but has no wealth effect without a later
execution close.

Every decision record includes the action, filled position, next-close target,
whether a trade is required, decision close, earliest execution close,
training start/end, latest matured outcome close, row count, prediction,
fallback reason and evidence status.

## Fixed reporting and gates

`M0` generates its own binary target ledger using the identical warm-up,
hysteresis, invalid fallback, execution, cash and cost rules.  It never drives
the published action, but its MSE and wealth are required to establish whether
Fear & Greed adds anything beyond price controls.

For `M1`, `M0` and buy-and-hold, report terminal wealth, annualized log return,
realized volatility, maximum drawdown, exposure, state counts, fills and costs.
For every market report the full-period primary- and stress-cost ratios versus
the exact buy-and-hold target, plus the two chronological halves.  Also report
prequential MSE for `M1` and `M0` only for predictions emitted after the 252-row
warm-up whose labels later mature.

Full wealth starts at the first valid score close, includes every warm-up and
fallback action, and ends at the last realized target close.  The first action
can fill only at the following close.  Chronological halves split the realized
return intervals into two fixed contiguous counts; position and wealth carry
through the midpoint without a reset or free trade.  MSE and model-activity
adequacy use only post-warm-up predictions whose labels later mature.
Finite predictions are eligible only when the decision has at least 252
matured training rows, no fallback, valid current features and a successful
fit.  M0 and M1 forecast-origin sets must match exactly.  The analyzer
recomputes every eligible `t+2` error from normalized target prices and rejects
a reported count, sum of squared errors or mean squared error that differs
from that recomputation; negative or non-finite error metrics are invalid.

An individual market's retrospective x2 price-series diagnostic requires both
its primary- and stress-cost terminal wealth ratios to be at least 2.000, both
fixed chronological halves to beat 1.000, `BUY` and `SELL` each to occupy at
least 10% of all emitted decision rows, at least 12 completed `SELL`-then-`BUY`
cash episodes, and maximum drawdown and realized volatility no worse than
buy-and-hold.  It also requires at least 756 matured post-warm-up forecasts,
1,095 calendar days, `M1` MSE at least 0.5% lower than identical-row `M0`, and
`M1` terminal wealth greater than `M0` at both costs.  `M1` must additionally
beat a constant mix with the same mean risky exposure and an exact-grid
index/cash mix with the closest realized volatility, at both primary and
stress costs.  Both controls are frictionless daily-rebalanced diagnostics
with the same zero-return cash assumption.  The volatility grid is exactly
`0.000, 0.001, ..., 1.000`; raw absolute distance determines the closest point
and an exact tie selects the lower risky weight.  These controls do not make
the zero-cash strategy investable.

State shares use every emitted target, including warm-up, fallback and the
final queued action.  A cash episode is completed only by an executed
`SELL`-then-`BUY` round trip through the realized endpoint; a final queued but
unexecuted `BUY` cannot complete an episode.

Exactly 999 deterministic circular-shift placebos shift only the seven Fear &
Greed columns by at least 252 eligible rows, keep price controls/returns/costs
unchanged, and replay the entire learner.  Offsets and ties derive from the
frozen manifest hash.  Real incremental MSE and incremental stress wealth over
`M0` must both exceed the 99th percentile of the family-wise maximum placebo
statistic across every claimed market.  Failure of any condition fails that
market; a universal result requires all markets to pass.

This remains only `RETROSPECTIVE_PRICE_SERIES_X2_DIAGNOSTIC` when cash is fixed
at zero.  Europe (`^STOXX`, a price index), the synthetic Crypto basket, and
any other unsuitable target are `UNSCORABLE_FOR_INVESTABLE_X2` regardless of
their number.  An investable x2 gate requires the same executable total-return
instrument for strategy and benchmark plus a currency-matched executable cash
total-return series.  Adding those inputs creates a new model ID.

Regardless of those numbers, a historical result status is only one of:

- `RETROSPECTIVE_PREQUENTIAL_FALSIFIED`; or
- `RETROSPECTIVE_PREQUENTIAL_DEVELOPMENT_ONLY`.

It must never say `VALIDATED`, `TRUSTED` or `DEPLOYABLE`.

## Leakage and determinism tests before opening outcomes

Synthetic tests must establish:

1. prefix invariance when future prices/scores are mutated;
2. streaming equivalence to replaying each historical prefix;
3. an old matured row remains in the fit more than three years later;
4. score `t` cannot affect return ending at `t` and executes next close;
5. only labels ending by the fit origin enter training;
6. every score row emits exactly `BUY` or `SELL`, never `HOLD`/null;
7. repeated target states do not trade, changed states do and pay cost;
8. warm-up and invalid-data fallbacks are deterministic;
9. base and stress wealth replay the identical decision ledger;
10. canonical hashes and double replay are identical.
11. direct batch and incremental ridge agree, including `n*lambda` scaling;
12. training standardization excludes current and unmatured rows;
13. current standardized values beyond five are clamped only for prediction;
14. `M0` and `M1` use identical rows and origins;
15. multiplicative costs and the log hurdle are exact;
16. the final unexecuted action cannot affect terminal wealth;
17. a missed live execution window never backfills an already-passed close;
18. caller-supplied analyses, paths, ledgers, MSE summaries and evidence status
    are rejected; the gate analyzer accepts normalized market inputs only and
    independently reruns the frozen core;
19. every model path covers exactly one row per emitted decision, decision and
    path dates/states agree, costs and ledger hashes reproduce, and every
    derived metric is finite;
20. universal analysis contains exactly the ordered frozen family
    `crypto, sweden, usa, europe, global` with the pinned targets above;
21. state-share counts include the final target but completed cash episodes
    include executed fills only;
22. result objects and their nested market family are deeply immutable after
    their canonical result hashes are assigned.

The protocol, runner and tests are frozen and committed before the real
schema-5 result is generated.  Any later change to a feature, lag, lambda,
threshold, target, cash definition, cost, calendar, fallback, tie, or gate is
a new model ID and begins a new prospective evidence clock.

A separate prospective protocol must be frozen before activation.  Its start
is the first execution strictly after the immutable manifest, its endpoint is
240 calendar months later, and it cannot stop when wealth first crosses 2x or
extend a losing endpoint.  It repeats the base/stress x2, incremental,
placebo, risk and data-integrity gates with a predeclared multiple-testing
correction.  Any method, target, cash or data-contract change restarts that
clock.

## Public wording

Until genuinely prospective gates have passed, the card must say:

`RESEARCH SIGNAL - RETROSPECTIVE, NOT VALIDATED`

It may show the mandatory `BUY / LONG` or `SELL / CASH` target state and its
full expanding-history span, but it must also say that the signal is not proof
of predictive value and not investment advice.  Raw Extreme Fear/Greed bands
remain descriptive and must not appear as a conflicting trade recommendation.

## Method references

- A. P. Dawid, *The Prequential Approach* (1984), sequential forecasts for
  future observations: <https://doi.org/10.2307/2981683>.
- H. White, *A Reality Check for Data Snooping* (2000), repeated reuse of the
  same history: <https://doi.org/10.1111/1468-0262.00152>.
- Federal Reserve Bank of St. Louis, DTB3 is a discount-basis yield rather
  than an observed cash total-return series: <https://fred.stlouisfed.org/series/DTB3>.
