# Universal volatility-managed buy-and-hold overlay protocol

<!-- UNIVERSAL_VOL_OVERLAY_FREEZE_MARKER: FROZEN_UNIVERSAL_VOL_OVERLAY_V1 -->
<!-- UNIVERSAL_VOL_OVERLAY_FREEZE_AT: 2026-08-25T19:07:19.598Z -->

Status: **frozen design before this candidate family has been run by this work;
research only; no production approval**.

This document specifies one small, falsifiable family of volatility-managed
buy-and-hold overlays. It does not claim that the family will beat buy-and-hold.
If no predeclared candidate clears the early-development gates, the result is
`NO_UNIVERSAL_CANDIDATE`; changing a lookback, cap, cost or gate after seeing
that failure is not allowed on the same history.

The exact same calculation, parameters, selection rule, financing assumptions
and pass/fail gates apply to `crypto`, `sweden`, `usa`, `europe` and `global`.
Market calendars and instrument identities are data, not tunable parameters.
Fear & Greed scores are not an input.

## Economic basis and limits

Moreira and Muir scale portfolio excess returns inversely with lagged realized
variance. Their evidence motivates reducing exposure after high realized
volatility, because expected return did not rise proportionally with variance
in their samples. Harvey et al. find that volatility targeting can improve the
risk profile of equity-like risk assets and reduce left-tail severity. These
papers motivate this experiment; neither proves that this exact capped,
financed five-market overlay will beat each market's own buy-and-hold return.

Cederburg, O'Doherty, Wang and Yan provide the essential counter-evidence:
volatility-managed portfolios did not systematically beat unmanaged portfolios
in direct real-time comparisons, and in-sample benefits often did not survive
out of sample. Consequently this protocol forbids a full-sample scaling
constant, adds explicit trading and borrowing costs, compares against
leverage-matched controls, and separates early selection from later tests.

Primary sources:

- Moreira and Muir, *Volatility-Managed Portfolios*, Journal of Finance 72
  (2017), NBER working-paper version and DOI:
  https://www.nber.org/papers/w22208 and https://doi.org/10.1111/jofi.12513
- Harvey, Hoyle, Korgaonkar, Rattray, Sargaison and van Hemert, *The Impact of
  Volatility Targeting*, Journal of Portfolio Management 45 (2018), author PDF
  and DOI: https://people.duke.edu/~charvey/Research/Published_Papers/P135_The_impact_of.pdf
  and https://doi.org/10.3905/jpm.2018.45.1.014
- Cederburg, O'Doherty, Wang and Yan, *On the Performance of
  Volatility-Managed Portfolios*, Journal of Financial Economics 138 (2020),
  author PDF and DOI: https://www.lehigh.edu/~xuy219/research/COWY.pdf and
  https://doi.org/10.1016/j.jfineco.2020.04.015

The formula below is intentionally not an exact replication of Moreira and
Muir. Their common full-sample normalizing constant would know the future in a
live implementation. This protocol replaces it with a trailing twelve-month
median variance anchor that is known at each signal date. That substitution is
an unvalidated design choice and must be judged by the staged test.

## Required input and reality checks

The runner must accept only schema `universal-vol-overlay-input-v1` with:

1. exactly five strictly ordered, positive **executable USD total-return wealth
   indices** named `crypto`, `sweden`, `usa`, `europe` and `global`;
2. one strictly ordered, positive **USD 3-month Treasury-bill total-return
   wealth index**, including reinvestment; and
3. source, methodology, currency, return type, instrument identity, execution
   venue, session timezone, retrieval UTC, revision/vintage status and rows for
   every series.

Sweden and Europe must include unhedged conversion to USD. A price-only index,
local-currency series, annualized yield, `^IRX`, `DTB3`, `IEF`, zero cash, or a
silently reconstructed yield return is invalid. LSEG describes the FTSE
3-Month US T-Bill Index Series as tracking the daily performance of 3-month
Treasury bills; a licensed series with frozen methodology is one conforming
example: https://www.lseg.com/en/ftse-russell/indices/3m-us-tbill. FRED's
`DTB3` is only a daily discount-basis yield, not a wealth index:
https://fred.stlouisfed.org/series/DTB3.

The risky series must represent instruments that could actually have carried
the tested exposure. A broad crypto reference index that cannot be bought or
replicated at the recorded closes is not an executable series. If an instrument
is not margin eligible, a candidate requiring exposure above 1.0 fails that
market; the runner may not assume synthetic leverage. FINRA notes both that
Regulation T generally permits lending up to 50% of a marginable equity
purchase and that firms can impose stricter rules or make a security
non-marginable: https://www.finra.org/rules-guidance/key-topics/margin-accounts.
The protocol's 1.50 target cap is below the general 2.0 initial-exposure limit,
but that fact does not establish eligibility for any particular ETF or crypto
instrument.

Dates are completed executable closes. For each risky close, the latest cash
TRI observation on or before that date may be used only when it is at most
seven calendar days old. There is no interpolation. A month needs at least 15
risky close-to-close observations or its volatility estimate is missing.
Twelve consecutive valid prior calendar months are required for a signal.

Each series is classified as one of:

- `point_in_time_revision_zero`: the raw values available then were preserved;
- `current_vintage_revised_history`: a later download can contain revisions; or
- `provider_backcast`: values precede the methodology's live launch.

Only the first class can support a genuinely point-in-time historical claim.
The latter two may falsify a candidate retrospectively but cannot confirm it.
Current ETF adjusted-close downloads and pre-launch crypto index history must
not be relabelled as point-in-time observations.

## Frozen monthly state and signal

For market `i`, let `P_i(d)` be its USD risky total-return wealth index at risky
close `d`, and let `C_i(d)` be the permitted as-of USD cash TRI value for that
same close. For every close-to-close interval ending in calendar month `m`,
calculate the daily log excess return

```text
e_i(d) = ln(P_i(d) / P_i(previous d))
       - ln(C_i(d) / C_i(previous d)).
```

The completed-month realized variance is

```text
v_i(m) = mean(e_i(d)^2 for all valid intervals ending in m).
```

Do not demean, annualize, winsorize or use an implied-volatility series. At the
final completed risky close of month `m`, define the causal anchor as the
median of the twelve strictly preceding complete monthly variances:

```text
a_i(m) = median(v_i(m-12), ..., v_i(m-1)).
q_i(m) = a_i(m) / v_i(m).
```

The anchor excludes `v_i(m)`. Every input to `q_i(m)` is known only after the
month-`m` close. A signal executes at the first executable risky close strictly
after that close; same-close execution is forbidden.

## Frozen four-candidate family

There are exactly four candidates and no others:

| Candidate | exponent `p` | upper target cap `u` |
|---|---:|---:|
| `IVOL_125` | 0.5 | 1.25 |
| `IVOL_150` | 0.5 | 1.50 |
| `IVAR_125` | 1.0 | 1.25 |
| `IVAR_150` | 1.0 | 1.50 |

For each candidate, the preliminary risky target is

```text
z_i(m) = min(u, max(0.50, q_i(m)^p)).
```

`p=0.5` scales inversely with relative realized volatility; `p=1.0` scales
inversely with relative realized variance. The 0.50 floor keeps this a long
buy-and-hold overlay rather than a market-exit rule. The caps bound borrowing.

A fixed no-trade band reduces turnover. Let `x_i(m-1)` be the preceding desired
target, initialized to 1.00 before the first signal:

```text
if abs(z_i(m) - x_i(m-1)) < 0.10: x_i(m) = x_i(m-1)
else:                              x_i(m) = z_i(m)
```

Equality at 0.10 trades. Targets are not rounded. A missing required month
produces no new signal; it is not filled with the prior variance. An already
executed position may remain unchanged until the next valid signal, but the
missing month and stale target are reported.

## Position accounting, financing and costs

At an execution close, let pre-trade risky notional be `A-`, signed cash be
`B-`, and wealth be `W- = A- + B-`. For desired risky exposure `x`, the runner
solves exactly for post-cost wealth `W+` and risky notional `A+`:

```text
A+ = x * W+
W+ = W- - k * abs(A+ - A-)
B+ = W+ - A+.
```

The unique non-negative piecewise-linear solution must be used; an approximate
pre-cost weight shortcut is not allowed. `k` is a one-way transaction-cost
rate. Between rebalances, risky units and signed cash compound separately; the
portfolio is not silently rebalanced every day.

For an interval of `deltaDays` calendar days:

```text
gRisk   = P_i(d1) / P_i(d0)
gCash   = C_i(d1) / C_i(d0)
gBorrow = gCash * exp(spreadAnnual * deltaDays / 365.2425)

A1 = A0 * gRisk
B1 = B0 * (gCash if B0 >= 0 else gBorrow)
W1 = A1 + B1.
```

Thus cash below 1.0 exposure earns the Treasury-bill TRI; leverage above 1.0
borrows at that same return plus a spread. The fixed scenarios are:

| Scenario | one-way transaction cost `k` | annual borrowing spread |
|---|---:|---:|
| Primary | 0.20% | 1.50% |
| Stress | 0.50% | 3.00% |

All candidates, controls and benchmarks use the same scenario. They start from
cash with NAV 1 at the same first execution close. Entry is charged. At the
last close, all risky exposure is liquidated and the same one-way cost is
charged. Taxes, market impact, custody, locate fees and index-replication costs
are excluded and must be disclosed; the stress scenario is not proof those
omissions are immaterial.

Wealth must stay positive. Report actual close-by-close leverage
`A / (A + B)` and equity-to-long-notional ratio `W / A` when `A > 0`. Any
target above the instrument's documented margin limit, any non-positive wealth,
or any equity-to-long-notional ratio below 40% is an execution failure, not a
return observation. This 40% research floor is deliberately more conservative
than the general 25% U.S. maintenance minimum and does not override a broker's
higher house requirement.

## Symmetric benchmarks and leverage-attribution controls

Every market and segment has four comparisons. All use identical dates, data,
cash TRI, transaction-cost scenario, financing algebra, entry and terminal
liquidation.

1. **Buy-and-hold:** target 1.00 at entry, then hold risky units without
   rebalancing until terminal liquidation.
2. **Constant mean-exposure control:** set one constant monthly target equal to
   the candidate's calendar-time-weighted mean executed target within that
   segment,
   `L_mean = sum(x_j * deltaDays_j) / sum(deltaDays_j)`, and rebalance it only
   on the candidate's scheduled execution closes.
3. **Constant volatility-matched control:** test targets
   `L = 0.5000, 0.5001, ..., 1.5000`, rebalanced on the same closes, and choose
   the target whose after-cost annualized volatility is closest to the
   candidate's. Exact ties select the lower target.
4. **Cash:** the unlevered T-bill TRI over the same dates, with no risky-entry
   cost.

Controls 2 and 3 use segment-wide candidate properties and are therefore ex
post attribution diagnostics, not deployable strategies. They may not select
parameters or replace the candidate. Their purpose is to distinguish volatility
timing from a raw return increase caused merely by higher average beta or risk.
A timing-edge claim requires the candidate to beat buy-and-hold **and both
constant-exposure controls** under identical financing and costs.

Also report a deployable diagnostic: freeze the selected candidate's
development-period `L_mean` and carry that constant unchanged through the
validation and evaluation periods. It is not a pass/fail substitute for the
segment-matched controls.

## Chronological stages and sealed access

The present repository has already exposed the available historical outcomes
to other model searches. Therefore even a later chronological slice is only a
**retrospective temporal or quasi-out-of-sample test**, never a genuinely
untouched holdout. True confirmation must start after a committed model/code
freeze with append-only revision-zero observations.

The staged historical procedure is nevertheless fixed to reduce further
leakage:

### Stage 1: early development and candidate selection

- Input return intervals end no later than **2018-12-31**.
- Use Sweden, USA, Europe and Global only. A broad, executable crypto history
  is not required or backfilled before its defensible inception.
- Each equity market needs at least 60 eligible executed monthly holdings after
  its twelve-month variance warm-up.
- Run and report all four candidates. Later files must not be opened by the
  development command.

A candidate is development-eligible only if it passes every gate below in all
four equity markets under both Primary and Stress costs. If none qualifies,
stop with `NO_UNIVERSAL_CANDIDATE` and do not open validation or evaluation
inputs.

Among eligible candidates, select the one with the largest worst-market Stress
`timingEdgeAnnualLogReturn` defined below. A tie within one basis point per year
selects the lower upper cap; a remaining tie selects `p=0.5`; a remaining tie
uses the table order. Commit a selection manifest containing the protocol hash,
runner hash, development-input hash, all four results and selected candidate
before Stage 2.

### Stage 2: five-market validation gate

- Return intervals begin on or after **2019-01-01** and end no later than
  **2022-12-31**.
- Use all five markets. Each begins only after its own twelve-month warm-up and
  first executable next-close signal; no crypto history is fabricated.
- Require at least 24 eligible executed monthly holdings per market.
- Run only the Stage-1-selected candidate. No parameter, formula, source role,
  cost or gate changes are permitted.

If the selected candidate fails any gate in any market, report the failure and
do not open Stage 3 input. A pass manifest with exact hashes must be committed
before Stage 3.

### Stage 3: five-market temporal evaluation

- Return intervals begin on or after **2023-01-01** and end at the input's
  pre-frozen final completed date.
- Use all five markets with at least 24 eligible executed monthly holdings per
  market.
- Run the one selected candidate exactly once and publish every market result,
  including failures. This stage cannot select a different candidate.

Signals may use the twelve complete months immediately preceding a segment
because those values were historically known, but each segment restarts NAV at
1, charges fresh entry/exit costs, and contains no return interval crossing its
boundary.

For strong mechanical separation, the runner should accept physically separate
development, validation and evaluation files and expose separate stage
commands. A stage must hash and reject rows outside its permitted date range.
An all-stages command that loads every outcome before selection is forbidden.

## Frozen metrics and pass/fail gates

For each market, candidate, control, benchmark, segment and cost scenario,
report:

- terminal wealth and annualized log return;
- annualized volatility of close-to-close log returns, using
  `sqrt(intervalCount / (calendarDays / 365.2425))` as the annualizer;
- maximum drawdown from the complete after-cost NAV path;
- excess-return Sharpe ratio versus the cash TRI;
- total one-way risky turnover and turnover divided by elapsed years;
- rebalance count, time-weighted mean target, maximum realized leverage and
  minimum equity-to-long-notional ratio;
- gross borrowing cost, transaction cost and time above 1.0 exposure; and
- missing/stale dates and every forced data or execution rejection.

Define, in annual log-return units:

```text
bhEdge       = candidate - buyAndHold
meanEdge     = candidate - constantMeanExposureControl
volEdge      = candidate - constantVolMatchedControl
timingEdge   = min(meanEdge, volEdge).
```

A candidate passes one market in one cost scenario only when all conditions
hold without rounding:

1. `bhEdge >= 0.0025` (at least 0.25 percentage point per year);
2. `timingEdge >= 0.0010` (at least 0.10 percentage point per year beyond both
   leverage-attribution controls);
3. candidate annualized volatility is no greater than buy-and-hold volatility;
4. candidate maximum drawdown is no deeper than buy-and-hold maximum drawdown;
5. one-way turnover is no greater than 4.0 times NAV per elapsed year;
6. wealth remains positive, the 40% equity/notional floor is never breached,
   and every target is executable under documented instrument rules; and
7. no required source, return interval or terminal liquidation is missing.

Each stage passes only when every included market passes all seven conditions
under **both** Primary and Stress costs. Aggregate or equal-weight results are
reported but cannot compensate for one failed market. Sweden, Europe, USA and
Global overlap economically, so five passes are not treated as five independent
statistical observations.

As uncertainty diagnostics, report a deterministic 10,000-replicate paired
moving-block bootstrap of monthly candidate-minus-comparator log returns using
six-month circular blocks and seed `20260825`, separately for each comparator
and market. Report percentile 90% and 95% intervals. These intervals do not
replace the hard gates, and short crypto history must be called underpowered.

## Interpretation and stop rules

- A Stage-1 failure falsifies this four-candidate family on early equity data.
- A Stage-2 failure falsifies the selected candidate as a universal historical
  overlay. Stage 3 remains sealed; there is no fallback candidate.
- A Stage-3 pass would mean only that the unchanged formula beat all five
  benchmarks in this retrospective temporal split under the stated proxies and
  assumptions. It would not prove future reliability.
- A result that beats buy-and-hold but not the mean- or volatility-matched
  control is leverage/beta evidence, not timing evidence.
- A result that passes Primary but fails Stress is not robust enough for the
  dashboard or real capital.
- Current-vintage or provider-backcast data limit the claim to retrospective
  research even if all numerical gates pass.
- No dashboard, production signal or live allocation may use the model until a
  prospective append-only evaluation is separately frozen and completed.

No later-period outcome was evaluated to write this protocol. The next allowed
artifact is a code-reviewed runner and synthetic-fixture tests; only after their
hashes are frozen may Stage 1 be executed.
