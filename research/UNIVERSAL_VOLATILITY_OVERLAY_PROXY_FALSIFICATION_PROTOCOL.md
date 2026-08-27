# Universal volatility overlay proxy-falsification protocol

<!-- UNIVERSAL_VOL_PROXY_FALSIFICATION_FREEZE_MARKER: FROZEN_UNIVERSAL_VOL_PROXY_FALSIFICATION_V1 -->
<!-- UNIVERSAL_VOL_PROXY_FALSIFICATION_FREEZE_AT: 2026-08-25T19:19:02.1693943Z -->
<!-- NORMATIVE_BASE_PROTOCOL_SHA256: 601bb020265d593d057bccc259854871e032a025bd708412eba878d8ab0d9406 -->

Status: **frozen research design; retrospective proxy falsification only; no
candidate-family outcome was inspected or run to write this document; never
confirmatory, executable, deployable, or production-approved**.

This is a deliberately weaker, one-way test of the exact candidate family
frozen in `research/UNIVERSAL_VOLATILITY_OVERLAY_PROTOCOL.md`. It admits only a
documented imperfect panel that the normative protocol correctly rejects as
confirmatory input. A negative numeric result may falsify the frozen candidate
or family on this panel. A positive numeric result cannot confirm an edge,
cannot make any source executable, and cannot authorize a dashboard signal or
capital allocation. Its only permitted interpretation is:

```text
ADVANCE_TO_LICENSED_EXECUTABLE_PROSPECTIVE_VALIDATION
```

No result produced under this protocol may be labelled `PASS`, `VALIDATED`,
`CONFIRMED`, `OOS_CONFIRMED`, `EXECUTABLE` or `DEPLOYABLE`.

## Normative base and non-amendment rule

The exact bytes of the normative base protocol are locked by:

```text
path:   research/UNIVERSAL_VOLATILITY_OVERLAY_PROTOCOL.md
marker: FROZEN_UNIVERSAL_VOL_OVERLAY_V1
sha256: 601bb020265d593d057bccc259854871e032a025bd708412eba878d8ab0d9406
```

The base protocol's monthly state, four candidates, no-trade band, execution
lag, exact post-cost accounting, financing, costs, comparisons, chronology,
metrics, seven gates, bootstrap and stop rules are incorporated without a
parameter change. A runner must hash the base protocol before doing any
calculation and stop on a mismatch.

This document changes only two things:

1. it admits the exact frozen proxy data listed below for a retrospective
   falsification screen; and
2. it adds weaker result labels that can reject or advance research but can
   never satisfy the base protocol's source/executability requirements.

It does **not** authorize any alternative lookback, cap, floor, band, cost,
borrowing spread, comparison, stage date, minimum sample, threshold, bootstrap
setting, market-specific parameter or post-result substitution. If the two
documents conflict about candidate math or a numerical gate, the hashed base
protocol controls. This document controls only proxy admission and the weaker
inference boundary.

## Exact frozen data and artifact identities

Only the following frozen container may supply observations. A regenerated,
renamed or later-vintage download is a different experiment even if its ticker
and date range look identical.

| Artifact | Exact SHA-256 |
|---|---|
| Normative base protocol, `research/UNIVERSAL_VOLATILITY_OVERLAY_PROTOCOL.md` | `601bb020265d593d057bccc259854871e032a025bd708412eba878d8ab0d9406` |
| Data-freeze manifest, `research/FIVE_MARKET_PROXY_DATA_FREEZE_2026-08-24.json` | `236881d17829b35356ea06b582c5ebd49020f81958400913aa9a83e544ab032a` |
| Manifest sidecar bytes, `research/FIVE_MARKET_PROXY_DATA_FREEZE_2026-08-24.json.sha256` | `be46dbec6ea58d22f54dc572ab961d9608020a283aa0cc3d38f0ee48eebd262d` |
| Normalized input, `research/local-artifacts/five-market-proxy-data/five-market-proxy-input-2026-08-24.json` | `a7a1e895ff4dbda68849beaead5f86cabad4493f89db43ec05e6a805847a329c` |
| Input sidecar bytes, `research/local-artifacts/five-market-proxy-data/five-market-proxy-input-2026-08-24.json.sha256` | `94beab97c7d39f1fffce5e21222f9aeb046172bfb8a03a3bae35679d098f9cf7` |
| Upstream schema-4 artifact supplying CMBITM, `research/local-artifacts/final-frozen/inputs/fear-greed-model-search-input-2026-08-24T22-13-44Z.json` | `9d42777cc8ad7de6394cb0045e24fa0b588c1e31915acadbc49af55842579b7c` |
| Upstream equity/cash source artifact, `research/local-artifacts/equity-rotation-panel/input-2026-08-24.json` | `4a9b5cda4fcd78c30a5a0b346d17f483ea16aaa07ecb5cc9bf7795dff2a27b08` |

The sidecars must contain the corresponding base-file digest and must be
verified before parsing. The manifest says `containsStrategyOutcomes=false`.
No strategy-result artifact is an input to this protocol.

The six and only six admitted normalized series are:

| Role | Series and frozen classification | Rows and range | Raw-payload SHA-256 | Normalized-rows SHA-256 |
|---|---|---|---|---|
| `crypto` | `CMBITM`; `PRICE_RETURN_NONINVESTABLE_BACKCAST`; not executable | 2,612; 2019-07-01 to 2026-08-24 | `fe7d5b99e1b6c4cb1f989df6c78123fc5457c582becff86354c4cffb242f5f7e` | `f8519b927bde51b9329417dc1f9e31ce0e67920a4c2bb9f3935a0d23e6b92729` |
| `sweden` | `EWD`; Yahoo adjusted-close USD ETF total-return proxy; current-vintage | 7,658; 1996-03-18 to 2026-08-24 | `0127d2948dfe4a79753c9b5280a390d25e9d13f6dd27fb5f444cde16791eed2b` | `2580ba27aa7d31a1f2d6f41a986092f00461f09f71326472748042421206223e` |
| `usa` | `IYY`; Yahoo adjusted-close USD ETF total-return proxy; current-vintage | 6,585; 2000-06-16 to 2026-08-24 | `0c881ef398ac8f34fda4976063fd912a60b3ea073f3fe1125fa768686555ad92` | `108dcfd1c3b5f05bd71ccf4b16e7008ca4c369113bfe10ce92a590a202d8d3bc` |
| `europe` | `IEV`; Yahoo adjusted-close USD ETF total-return proxy; current-vintage | 6,556; 2000-07-28 to 2026-08-24 | `1cd419d89766efbaca5b903523cd80b38f5e4c57a1ef50ed26804875dbd4950f` | `8b61a4eb0acfea35c0a54d8426280c484a19e3f6458693dd8d974bce54ec7d25` |
| `global` | `ACWI`; Yahoo adjusted-close USD ETF total-return proxy; current-vintage | 4,631; 2008-03-28 to 2026-08-24 | `94a61e38d1fcb1ee44d0870452d3f4cebfb014cc9b90cff9453cc6f732557761` | `9307603c3c78b5fff46fd0563fb8395421e53beceb2faa153ef2f4c03b8491da` |
| `cash` | `DTB3-91D-ACCRUAL`; reconstructed 91-day-bill accrual proxy; not executable | 6,809; 2008-01-03 to 2026-08-24 | `0907b7c8ae0d047ff73ac231601b8d12e43f8e34cf42587c1bf9873f4aeb8bb4` | `2cd3c860511d7ebc3ed5b4461c14e7a75618535182786c5f6e8cb00601955c21` |

The five-risky-series strict-common-date inventory has 1,797 dates from
2019-07-01 through 2026-08-24 and SHA-256
`aa7b9b53bd0f47b8de6da980f5d188dcb4eb5651d89bc0eb3449a7424a008481`.
That is an inventory check, not a rule that replaces each market's own completed
close calendar in the base protocol.

The input must also retain exact retrieval UTC, source URL, methodology,
currency, return type, instrument identity, venue/timezone, revision status,
row count and first/last date from the frozen artifact. A derived stage file
must retain those fields, its parent-input hash and hashes of its exact rows.

## Non-negotiable source limitations

`CMBITM` is a USD broad-crypto **price-return index**, not a fund, a directly
investable total-return wealth index or an executable close series. The word
"investable" in the provider's universe description is an eligibility-universe
term; it does not make CMBITM itself a traded instrument. Its observations
before the methodology launch are provider-backcast and the history may be
restated. The current Coin Metrics web summary says base date 2019-04-01, while
the frozen delivered rows begin 2019-07-01 and the separately reviewed
methodology v1.4 states 2019-07-01. This protocol uses only the delivered rows
from 2019-07-01 and never fabricates April-June 2019. The actual source is the
hashed schema-4 artifact above; describing it as sourced from schema 5 is
forbidden.

For counterfactual calculation only, a recorded CMBITM New York close is the
proxy risky close and the first strictly later recorded close is the proxy
rebalance timestamp. This preserves the base protocol's one-full-close lag but
does not represent a fill, venue or tradable instrument. Original executability
condition 6 therefore remains false for CMBITM regardless of the numeric path.

`EWD`, `IYY`, `IEV` and `ACWI` are live USD ETFs, but Yahoo adjusted close is a
current-vintage market-price total-return **proxy**. Yahoo says it adjusts close
for applicable splits and dividend distributions. That does not turn the
download into issuer NAV total return, a licensed official index return, an
as-known-then archive, or proof that every historical adjusted close was
available in its current form at the time. EWD and IEV provide unhedged foreign
equity/currency exposure through USD-traded fund prices; they are not a literal
licensed USD conversion of a Swedish or European return index.

The manifest's `executable=true` for an ETF means the live fund identity was
verified. It does not prove historical close execution, margin eligibility,
borrow capacity or a 1.25/1.50 target at every date. Those facts remain part of
the unchanged original executability gate and must never be guessed.

The cash series is a transparent hypothetical accrual construction, not DTB3
itself, not an official T-bill total-return index, not a traded bill ladder and
not an executable financing account. Consequently this entire panel violates
the base protocol's confirmatory input contract before any return is examined.

No ticker or source may be substituted. In particular, this protocol forbids
BTC, SPY, VGK, SPGM, local-currency indices, `^IRX`, an ETF bond proxy, zero
cash, an official series fetched after the freeze, or any robustness series in
the data container. A problem with one permitted series stops the affected
stage; it does not open a search for a replacement.

Primary identity/methodology pages checked for this freeze are:

- Coin Metrics CMBITM: https://indexes.coinmetrics.io/cmbitm
- EWD: https://www.ishares.com/us/products/239684/ishares-msci-sweden-etf
- IYY: https://www.ishares.com/us/products/239513/ishares-dow-jones-us-etf
- IEV: https://www.ishares.com/us/products/239736/ishares-europe-etf
- ACWI: https://www.ishares.com/us/products/239600/ishares-msci-acwi-etf
- Yahoo adjusted-close definition: https://help.yahoo.com/kb/SLN28256.html
- FRED DTB3: https://fred.stlouisfed.org/series/DTB3

## Explicit causal `DTB3-91D-ACCRUAL` construction

FRED DTB3 is a daily 3-month Treasury-bill secondary-market rate on a bank
discount basis, quoted in percent per year. It has observation dates but the
frozen raw payload has no publication timestamps. Same-observation-date use is
therefore forbidden.

For every calendar-day accrual interval `[d, d + 1]`, select the latest
non-missing DTB3 row with observation date `s` satisfying:

```text
s < d
calendarDays(d - s) <= 7
```

Let `y_s` be the quoted DTB3 percent value. The exact construction is:

```text
discountRate = y_s / 100
billPrice    = 1 - discountRate * 91 / 360
gross91      = 1 / billPrice
dailyFactor  = gross91^(1 / 91)
```

Reject a non-positive `billPrice`, a missing eligible strictly prior rate, or a
rate more than seven calendar days old. A risky interval `[d0, d1]` compounds
one `dailyFactor` for every calendar start date `d` in `[d0, d1)`. Normalize
the resulting positive wealth path to 1 at its first retained date. There is no
interpolation and no same-day assumption.

This model assumes a frictionless constant 91-day reinvestment, no bid/ask
spread, taxes, auction/settlement lag or reinvestment delay. It is used both as
`C_i(d)` in the exact excess-return signal and as the proxy cash/borrowing base
in the exact financing algebra below. Its explicitness makes the proxy test
reproducible; it does not make the construction executable or confirmatory.
The runner consumes the frozen normalized cash rows; an independent
reconstruction is only an integrity check and must reproduce their exact hash
before any stage input is created.

## Unchanged monthly state and four candidates

For market `i`, let `P_i(d)` be its admitted USD risky proxy at close `d` and
let `C_i(d)` be the permitted causal cash-proxy value as of the same close. For
each close-to-close interval ending in calendar month `m`:

```text
e_i(d) = ln(P_i(d) / P_i(previous d))
       - ln(C_i(d) / C_i(previous d))

v_i(m) = mean(e_i(d)^2 for all valid intervals ending in m)
```

Do not demean, annualize, winsorize or use implied volatility. A month needs at
least 15 risky close-to-close observations. Twelve consecutive valid strictly
prior calendar months are required. At the final completed risky close of
month `m`:

```text
a_i(m) = median(v_i(m-12), ..., v_i(m-1))
q_i(m) = a_i(m) / v_i(m)
```

The anchor excludes `v_i(m)`. The signal may execute only at the first
executable risky close strictly after the month-`m` close; same-close execution
is forbidden.

There are exactly four candidates:

| Candidate | exponent `p` | upper target cap `u` |
|---|---:|---:|
| `IVOL_125` | 0.5 | 1.25 |
| `IVOL_150` | 0.5 | 1.50 |
| `IVAR_125` | 1.0 | 1.25 |
| `IVAR_150` | 1.0 | 1.50 |

For each candidate:

```text
z_i(m) = min(u, max(0.50, q_i(m)^p))

if abs(z_i(m) - x_i(m-1)) < 0.10: x_i(m) = x_i(m-1)
else:                              x_i(m) = z_i(m)
```

Initialize the preceding desired target to 1.00. Equality at 0.10 trades.
Targets are not rounded. A missing required month produces no new signal and
must be reported; the variance itself is never forward-filled.

## Unchanged accounting, financing and costs

At an execution close, with pre-trade risky notional `A-`, signed cash `B-`,
wealth `W- = A- + B-`, desired risky exposure `x` and one-way cost rate `k`,
solve the unique non-negative piecewise-linear system exactly:

```text
A+ = x * W+
W+ = W- - k * abs(A+ - A-)
B+ = W+ - A+
```

An approximate pre-cost-weight shortcut is forbidden. Between rebalances,
risky units and signed cash compound separately. For an interval of
`deltaDays` calendar days:

```text
gRisk   = P_i(d1) / P_i(d0)
gCash   = C_i(d1) / C_i(d0)
gBorrow = gCash * exp(spreadAnnual * deltaDays / 365.2425)

A1 = A0 * gRisk
B1 = B0 * (gCash if B0 >= 0 else gBorrow)
W1 = A1 + B1
```

The scenarios remain:

| Scenario | one-way transaction cost `k` | annual borrowing spread |
|---|---:|---:|
| Primary | 0.20% | 1.50% |
| Stress | 0.50% | 3.00% |

Every candidate, benchmark and control starts from cash with NAV 1 at the same
first execution close. Entry is charged. At the last close, all risky exposure
is liquidated and the same one-way cost is charged. Taxes, market impact,
custody, locate fees, ETF premium/discount, tracking error and index-replication
costs remain excluded and disclosed.

Wealth must stay positive. Report close-by-close leverage `A / (A + B)` and,
when `A > 0`, equity-to-long-notional `W / A`. Any target above documented
instrument limits, non-positive wealth or equity/notional below 40% is an
original-gate failure. The proxy runner may calculate counterfactual arithmetic
for research, but may not convert absent instrument evidence into an execution
claim.

## Unchanged symmetric comparisons

Every market, segment and scenario has exactly these four comparisons on
identical dates, proxy cash, cost algebra, entry and terminal liquidation:

1. buy-and-hold at target 1.00, without interim rebalancing;
2. constant mean exposure equal to the candidate's calendar-time-weighted mean
   executed target in that segment,
   `L_mean = sum(x_j * deltaDays_j) / sum(deltaDays_j)`, rebalanced only on the
   candidate's execution closes;
3. constant volatility-matched exposure searched only on
   `L = 0.5000, 0.5001, ..., 1.5000`, rebalanced on the same closes, choosing
   the closest after-cost annualized volatility and the lower target on an
   exact tie; and
4. the unlevered `DTB3-91D-ACCRUAL` proxy over the same dates, with no risky
   entry cost.

Controls 2 and 3 remain ex-post attribution diagnostics, never deployable
strategies or candidate selectors. Also report the original deployable
diagnostic that freezes the selected candidate's Stage-1 `L_mean` and carries
it unchanged through Stages 2 and 3. It cannot replace either segment-matched
control or any gate.

## Stage separation and sealed access

The full normalized data container is only a source freeze. Before any strategy
execution, a data-only splitter must create three physically separate stage
inputs, each with a canonical SHA-256, parent-input SHA-256, exact row hashes
and explicit warm-up/return roles. The splitter may validate and slice data but
must not calculate a strategy return, target, metric or gate.

Each derived file must use the distinct schema
`universal-vol-overlay-proxy-input-v1`, status
`RETROSPECTIVE_PROXY_DATA_ONLY_NOT_CONFIRMATORY`, and exactly one stage value:
`development`, `validation` or `evaluation`. It must preserve the frozen
nonconforming classifications, including `executable=false` for CMBITM and
cash. It must never masquerade as the base protocol's conforming
`universal-vol-overlay-input-v1`; a strict base runner must reject the proxy
schema, and a proxy runner must reject the base schema unless separately
authorized and implemented.

A stage command may open only its own input. Warm-up rows are permitted solely
when needed for the twelve complete months immediately before the segment.
They may generate the first causal signal but may not contribute a return
interval crossing the segment boundary. The stage runner must hash and reject
unpermitted rows. Validation input remains unavailable to Stage 1; evaluation
input remains unavailable until a Stage-2 manifest is committed. An all-stages
command that loads later outcomes before selection is forbidden.

### Stage 1: early development and proxy candidate selection

- Return intervals end no later than **2018-12-31**.
- Use only `EWD`, `IYY`, `IEV` and `ACWI`; CMBITM is not backfilled.
- Require at least 60 eligible executed monthly holdings per equity market
  after the twelve-month variance warm-up.
- Run and report all four candidates under Primary and Stress costs.

For proxy sequencing only, a candidate is `PROXY_DEVELOPMENT_ELIGIBLE` when it
clears the numeric proxy screen defined below in all four markets and both cost
scenarios. If none qualifies, stop with
`NO_UNIVERSAL_CANDIDATE_PROXY_FALSIFIED`; do not open later-stage inputs and do
not change a parameter.

Among proxy-eligible candidates, apply the base selection rule unchanged:
largest worst-market Stress `timingEdgeAnnualLogReturn`; a tie within one basis
point per year selects the lower cap; a remaining tie selects `p=0.5`; a final
tie uses table order. Before Stage 2, commit a selection manifest containing
both protocol hashes, runner/test hashes, exact Stage-1 input hash, all four
results, original seven-gate vectors, proxy-screen vectors and selected
candidate.

### Stage 2: five-market retrospective proxy validation gate

- Return intervals begin on or after **2019-01-01** and end no later than
  **2022-12-31**.
- Use all five fixed risky series. CMBITM begins only after its own twelve-month
  warm-up from delivered observations starting 2019-07-01; no earlier crypto
  row is fabricated.
- Require at least 24 eligible executed monthly holdings per market.
- Run only the Stage-1-selected candidate. No source, formula, parameter, cost,
  comparison, gate or fallback candidate may change.

If any market/scenario fails the numeric proxy screen, record
`STAGE_2_PROXY_FALSIFIED`, keep Stage 3 sealed and stop. Numeric success across
all markets/scenarios is only `STAGE_2_PROXY_ADVANCE`; it is not validation in
the confirmatory sense. Commit an exact-hash manifest before Stage 3.

### Stage 3: five-market retrospective temporal proxy evaluation

- Return intervals begin on or after **2023-01-01** and end on the frozen final
  completed date, **2026-08-24**.
- Use all five fixed risky series with at least 24 eligible executed monthly
  holdings per market.
- Run the one selected candidate exactly once and publish every market and
  scenario, including failures. No candidate can be reselected.

Each segment restarts NAV at 1, charges fresh entry and exit, and contains no
return interval crossing its boundary. A numeric failure is
`STAGE_3_PROXY_FALSIFIED`. Numeric success is only
`ADVANCE_TO_LICENSED_EXECUTABLE_PROSPECTIVE_VALIDATION`. It is not a historical
confirmation and does not authorize a signal.

## Exact metrics and original seven gates

For every market, candidate, control, benchmark, segment and scenario, report
all base-protocol metrics:

- terminal wealth and annualized log return;
- annualized volatility of close-to-close log returns using
  `sqrt(intervalCount / (calendarDays / 365.2425))`;
- maximum drawdown from the complete after-cost NAV path;
- excess-return Sharpe ratio versus the cash proxy;
- total one-way risky turnover and turnover per elapsed year;
- rebalance count, time-weighted mean target, maximum realized leverage and
  minimum equity-to-long-notional ratio;
- gross borrowing cost, transaction cost and time above 1.0 exposure; and
- every missing/stale date and forced data or execution rejection.

In annual log-return units:

```text
bhEdge     = candidate - buyAndHold
meanEdge   = candidate - constantMeanExposureControl
volEdge    = candidate - constantVolMatchedControl
timingEdge = min(meanEdge, volEdge)
```

The original seven conditions are unchanged and evaluated without rounding:

1. `bhEdge >= 0.0025`;
2. `timingEdge >= 0.0010` beyond both leverage-attribution controls;
3. candidate annualized volatility is no greater than buy-and-hold volatility;
4. candidate maximum drawdown is no deeper than buy-and-hold maximum drawdown;
5. one-way turnover is no greater than 4.0 times NAV per elapsed year;
6. wealth remains positive, the 40% equity/notional floor is never breached,
   and every target is executable under documented instrument rules; and
7. no required source, return interval or terminal liquidation is missing.

Every original gate receives an explicit Boolean plus evidence. No aggregate or
equal-weight result may compensate for a market/scenario failure. All markets
must clear all seven gates under both Primary and Stress costs for an original
stage pass. Because this protocol deliberately admits nonconforming CMBITM and
cash data, it can never assert that original stage pass even when return/risk
numbers look favorable.

Also report the unchanged uncertainty diagnostic: a deterministic
10,000-replicate paired moving-block bootstrap of monthly
candidate-minus-comparator log returns, six-month circular blocks, seed
`20260825`, separately for every comparator and market, with percentile 90%
and 95% intervals. It does not replace a gate. Short CMBITM history must be
called underpowered.

## Numeric proxy screen versus an original-protocol pass

To allow one-way falsification without laundering source defects, report a
separate derived status:

```text
numericProxyScreen =
    original conditions 1 through 5 are true
    AND wealth-positive and 40%-floor clauses of condition 6 are true
    AND no computed return interval or terminal liquidation is missing
```

This screen deliberately does **not** erase or override the instrument-
executability clause of condition 6, the required-source clause of condition 7
or the base input-schema failure. Those remain separately reported as false or
unresolved. `numericProxyScreen` is not an eighth gate, a revised gate, a pass
or a validation claim. It exists only to decide whether the staged proxy
falsification stops early or whether the unchanged candidate merits the next
sealed proxy stage.

The decision rules are one-way:

- Failure of a numerical condition rejects the candidate or family on this
  exact frozen proxy panel and stops according to Stage 1/2/3. It may not be
  repaired by tuning or swapping a source on the same history.
- Numeric success does not cure price-return versus total-return mismatch,
  provider backcast, current-vintage revisions, noninvestability, unknown
  historical margin eligibility, reconstructed cash or modeled borrowing.
- Even numeric success in all three stages only advances the unchanged
  candidate to a new study using licensed total-return data, documented
  executable instruments/financing and an append-only prospective collection.
- Cleaner data may produce a different result, so a proxy failure is a
  falsification on this frozen representation, not proof about every possible
  conforming dataset. The frozen negative result must nevertheless remain
  published and may not be relabelled after a later study.

## Stop and deployment rules

No dashboard, production signal, paper-trading feed or live allocation may use
an output from this protocol. No value from this protocol may be presented as
expected return, advice, a forecast, an executable backtest or evidence of
future reliability.

After a three-stage numeric advance, the next research design must, at minimum:

1. acquire and freeze licensed USD total-return histories with documented
   methodology and vintage/revision handling;
2. map every risky target to an actually executable instrument and document
   date-appropriate margin/financing limits;
3. replace the reconstructed cash/borrowing proxy with an executable or
   licensed total-return/financing specification;
4. preserve this candidate, all parameters and all gates without using the
   cleaner-data outcomes to retune them; and
5. commit code and collection rules before an append-only prospective period
   begins.

This document authorizes no outcome execution. The next permissible artifacts
are a separately code-reviewed proxy runner, synthetic-fixture tests and
physically separated stage inputs with exact hashes. Running Stage 1 is a
separate action after those artifacts are frozen.
