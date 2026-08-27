# Schema 9: frozen partial core-position Fear / Greed overlay

<!-- SCHEMA9_FREEZE_MARKER: FROZEN_SCHEMA9_CORE_50_STEP_50_V1 -->
<!-- SCHEMA9_FREEZE_AT: 2026-08-25T17:10:40.436Z -->
<!-- SCHEMA9_RUNNER_NORMALIZED_SHA256: 3c493629894265b3bbc0de4aaa2fab85b3a0ae7934c280afe95cf975ca9c2b63 -->
<!-- SCHEMA9_TEST_SHA256: cc04066c384a81f6e88629a83e87962387e76d480194afed685a62ac6f828ec7 -->

## Status and question

This protocol is written before the first execution of this strategy against
the frozen five-market snapshot. The exact rule has one purpose: test whether
a modest core-position implementation of the dashboard's own Extreme Fear and
Extreme Greed labels has historically added terminal wealth versus matched
100% buy-and-hold after explicit trading and financing friction.

The history has already been viewed in schemas 3 through 8. Consequently, even
a pass is only `RETROSPECTIVE_EXPLORATORY_CANDIDATE`; it is not independent
confirmation, proof of prediction, or permission to trade. A pass still needs
a separately frozen forward period. A fail cannot be rescued by changing an
exposure, threshold, cost, lag, start date, market, or gate on the same data.

## One rule, declared once

Strategy ID: `S9_CORE_50_STEP_50`.

The already-published integer dashboard score maps to the following target
index exposure as a fraction of current post-trade NAV:

| Published score | Dashboard label | Target exposure | Action versus neutral |
| ---: | --- | ---: | --- |
| `0..24` | Extreme Fear | `150%` | buy/add 50 percentage points |
| `25..74` | neutral band | `100%` | hold the buy-and-hold anchor |
| `75..100` | Extreme Greed | `50%` | sell/trim 50 percentage points |

This is a symmetric policy choice around 100%, not a fitted parameter and not
a claim that the academic literature has validated these three exact weights.
It retains at least a 50% core holding and never shorts the target. The 150%
cap is consistent with the upper exposure cap used in published recursive
sentiment-allocation work, but that work does not establish this threshold
rule. No smoothing, trend filter, confirmation day, cooldown, stop, forecast,
market-specific parameter, or alternative candidate is allowed.

The identical rule is applied to exactly these frozen targets and in this
order: Crypto, Sweden, USA, Europe, and Global. The target definitions and the
synthetic seven-coin Crypto basket are inherited byte-for-byte from the frozen
schema-5 snapshot. This test does not cure the Crypto basket's survivorship,
constituent-selection, or investability limitations.

## Causal timing and self-financing accounting

Each market starts at its first target close with an exact published score and
at 100% target exposure, NAV 1.0, with no invented initial transaction. The
matched benchmark starts at that same close and is 100% buy-and-hold.

At every processed target close:

1. Any target queued from the preceding close executes after the old holdings
   earn that complete close-to-close return. The current close therefore never
   earns a return that was known only at that close.
2. The trade restores the target exposure exactly after its transaction cost.
3. Only after execution is the current published score observed. If finite,
   it queues its mapped target for the next target close. A repeated extreme
   score therefore rebalances the drifted position on the next close. A
   missing score queues no order and leaves holdings unchanged.
4. A terminal signal without a later target close is unfilled. There is no
   forced terminal liquidation and no terminal cost.

Risky units and cash are tracked explicitly. Positive cash earns 0%. Negative
cash accrues continuously at a deliberately conservative fixed 5.00% annual
rate using ACT/365.2425 between target closes. This fixed stress rate is not
represented as the actual historical funding rate. It prevents free leverage
from manufacturing a winner; a later real-rate sensitivity may only be added
as a separately labelled diagnostic and cannot rescue the primary result.

At an execution close, one-way trading friction is exactly 0.50% of the
absolute risky notional bought or sold. If pre-trade NAV is `W`, pre-trade
risky notional is `R`, target exposure is `E`, and cost rate is `c`, post-trade
risky notional `N` is solved so that `N / (W - c*abs(N-R)) = E`:

- buy: `N = E*(W + c*R)/(1 + E*c)`;
- sell: `N = E*(W - c*R)/(1 - E*c)`.

The implementation must verify the target identity numerically after every
fill. NAV at or below zero is bankruptcy and an automatic fail.

## Benchmark and windows

Buy-and-hold is the frictionless same-target close ratio from the exact same
window start through end. This is intentionally the same benchmark used in
schemas 6 through 8. It receives neither leverage nor tactical cash. Internal
index construction is identical for the strategy and benchmark.

Each market reports:

- its complete eligible native history;
- two independent cash/NAV-start halves split by exactly `floor(N/2)` return
  intervals, with the boundary close shared;
- trades, turnover, financing, time-weighted exposure, volatility and maximum
  drawdown;
- a zero-transaction-cost diagnostic with the same 5% financing rate.

The five-market common calendar is the exact intersection of eligible target
dates. Every constituent is rerun between the exact common endpoints using all
of its own intervening target closes. Five equal initial capital sleeves are
combined without cross-market rebalancing and sampled on common dates.

## Frozen timing placebo

For every full native history, construct up to 199 deterministic non-zero,
evenly spaced circular shifts of the entire date-aligned score sequence,
including missing values. Re-run the identical strategy and friction for every
shift. This preserves each market's score distribution and regime clustering
while breaking the original date alignment. It is a descriptive timing
placebo, not a formal iid p-value because financial histories are nonstationary.

Report the fraction of shifted terminal wealth observations not exceeding the
actual terminal wealth and the finite-sample exceedance fraction
`(1 + count(shift >= actual))/(1 + shift_count)`.

## Historical candidate gate

The only passing status is `RETROSPECTIVE_EXPLORATORY_CANDIDATE`. Every
condition below must hold after 0.50% one-way costs and 5% borrowing friction:

1. full-history strategy terminal wealth exceeds buy-and-hold in at least four
   of five markets;
2. at least seven of ten independent native half windows beat buy-and-hold;
3. common-calendar terminal wealth and annualized log return both exceed the
   five-sleeve buy-and-hold aggregate;
4. at least four markets execute both an Extreme Fear target and an Extreme
   Greed target during their full history;
5. maximum drawdown is no worse than buy-and-hold in at least three markets;
6. every full-history strategy/B&H terminal-wealth ratio is at least 0.90;
7. actual terminal wealth is at or above the 90th percentile of the frozen
   circular-shift placebo in at least three markets; and
8. the canonical offline result is byte-identical on a saved replay and all
   frozen hashes match.

Otherwise the status is `NO_CORE_OVERLAY_HISTORICAL_WINNER`. Passing the gate
would mean only that this one predeclared implementation is historically
promising on already-reused data. It would not establish live reliability.

## Provenance and stop rule

The protocol, normalized runner, tests, input snapshot, production score code,
configuration, and output artifacts are SHA-256 identified. Network access is
disabled during analysis. Tests may use only synthetic rows before freeze; the
real snapshot may not be executed until this marker and all hashes are final.

After the first completed real-snapshot run, this rule and gate are immutable.
No schema 9B or schema 10 may be used to search the same historical endpoint
for a winner. If it fails, only genuinely new forward observations or an
independently published exact rule can provide new evidence.

## Method references

- Huang, Jiang, Tu and Zhou, *Investor Sentiment Aligned: A Powerful Predictor
  of Stock Returns*, Review of Financial Studies (2015),
  https://doi.org/10.1093/rfs/hhu080 . This motivates a capped exposure
  implementation but does not validate the 50/100/150 threshold rule.
- Moreira and Muir, *Volatility-Managed Portfolios*, Journal of Finance (2017),
  https://doi.org/10.1111/jofi.12513 . This motivates explicit leverage and
  financing scrutiny; volatility management is deliberately absent here so
  the Fear/Greed signal cannot borrow its performance.
- Perez de Juan et al., *Fear & Greed as a predictor of global stock-index
  futures*, RECT@ (2026), https://doi.org/10.24310/recta.27.1.2026.23291 . This
  is a direct <=25/>75 historical trading rule, but it is binary, retrospective
  and lacks a buy-and-hold comparison; schema 9 is not a replication.
