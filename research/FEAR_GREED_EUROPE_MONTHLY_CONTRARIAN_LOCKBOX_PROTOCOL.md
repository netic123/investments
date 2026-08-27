# Europe monthly contrarian rule — prospective lockbox preregistration candidate

<!-- EUROPE-MONTHLY-CONTRARIAN-CANDIDATE-DECLARED 2026-08-27 : rule identity, endpoints and
     gates declared before any prospective observation exists. This document registers a
     CANDIDATE for the prospective lockbox (FEAR_GREED_V3_PROSPECTIVE_LOCKBOX_PROTOCOL.md).
     It activates nothing and validates nothing. -->

Status: `COLLECTING_NO_OUTCOME_READ` (amended 2026-08-27, pre-collection: prospective
collection activated through the scoped collector EUROPE-LOCKBOX-V1 — see
EUROPE_LOCKBOX_V1_ACTIVATION.md. The instrument gate is resolved: `XSX6.DE`, an
accumulating STOXX Europe 600 UCITS ETF whose price series is total return by
construction. The activation is scoped to this candidate; the full five-market lockbox
design remains `NOT_ACTIVATED`.)

Forbidden labels anywhere in connection with this candidate until the prospective primary
endpoint is met: `PASS`, `VALIDATED`, `CONFIRMED`, `DEPLOYABLE`.

## Origin and mining disclosure (read this first)

This candidate was found by retrospective search over history that the research program has
inspected many times (schemas 3–12, the exhaustive 81-cell threshold grid, and the extended
diagnostic battery of 2026-08-27 in `fear_greed_extended_battery.js`). Everything below is
therefore a *mined* hypothesis, and the honest prior is weak:

- In the battery, Europe was the only market of five where contrarian timing beat
  buy-and-hold of the index at all; identical rule shapes LOSE in USA and Global.
- The family-F headline (1.54× buy-and-hold over 15 years) was the luckiest of 21 possible
  cadence anchors. The anchor sweep gives min 0.94, **median 1.16**, max 1.54 (20/21 anchors
  above 1). The anchor-free calendar month-end variant gives 1.18–1.20× at the G=85 sell
  threshold — and loses at G=80, a threshold sensitivity that suggests few-event fragility.
- The retrospective benchmark (`^STOXX`) is a PRICE index; the data-source audit grades it F
  for total-return claims. An approximate 3%/yr dividend correction at the rule's ~0.87–0.90
  exposure leaves roughly 1.10–1.15× over 15 years, i.e. on the order of +0.6–1.0 pp/yr.
- Supporting event-study evidence: Europe fear days (displayed integer ≤ 25) preceded
  one-month index returns +1.5 to +2.3 pp above the unconditional mean (episode-aware
  bootstrap p ≈ 0.005 uncorrected over 43–66 independent episodes) — but this does NOT
  survive Benjamini–Hochberg correction across the battery's 75 event-study cells.
- The best max-of-family placebo results (finite-sample p = 0.01 for families A and F in
  Europe) are the strongest placebo outcomes the program has produced, and they are still
  post-hoc selections from one 15-year sample.

Expected effect if real: roughly +0.5 to +1.0 pp/yr over index buy-and-hold in total-return
terms. Plausibly zero. Only prospective data can settle it.

## Frozen rule identity: EUROPE-MONTHLY-CONTRARIAN-V1

- Signal: the production unified Fear & Greed v2 **europe** score (`marketfg.js`,
  modelId `investments-unified-fear-greed`, version 2), displayed integer (production
  rounding: round the 1-decimal score to an integer).
- Decision date: the **last trading day of each calendar month** on the instrument's
  exchange calendar (no cadence anchor exists by construction).
- State machine, initial state long:
  - If long and displayed integer ≥ **85** at the decision close → sell entirely.
  - If in cash and displayed integer ≤ **35** at the decision close → buy entirely.
  - Otherwise: no action until the next month-end.
- Execution: next trading close after the decision close. One-way cost assumption for
  evaluation: 0.10% (stress 0.25%).
- Instrument: an investable, dividend-inclusive (accumulating or total-return-tracked)
  UCITS ETF on STOXX Europe 600. Selecting and verifying the exact instrument (identity,
  history, TR treatment) is an **activation gate**, following DATA_SOURCE_AUDIT_2026-08-25
  procedure; the retrospective `^STOXX` price series is not an acceptable prospective
  benchmark.
- Cash leg: primary evaluation at 0% (conservative); secondary at the audited
  DTB3-91D-ACCRUAL-V2 reconstruction (TREASURY_13W_CASH_AUDIT_2026-08-25.md).
- Benchmark: buy-and-hold of the same instrument over the identical prospective window.

Any change to the thresholds, cadence, signal, instrument class or execution rule creates a
NEW candidate id and restarts the prospective clock. No retuning on interim results.

## Prospective endpoints (declared before observation 1)

The rule trades roughly once every two years, so wealth-based confirmation alone would take
decades. The primary endpoint is therefore conditional-return-based and accrues one
observation per month:

- **Primary** (evaluated once, after ≥ 60 new prospective monthly decision points):
  the mean one-month forward instrument return following decision closes with displayed
  integer ≤ 35 exceeds the mean over all decision closes, with a one-sided episode-aware
  block-bootstrap p < 0.05 (declared direction: positive). Fewer than 6 fear decisions in
  the window → `UNDERPOWERED_EXTEND_COLLECTION`.
- **Secondary** (descriptive, reported alongside): strategy wealth vs buy-and-hold wealth
  at 0.10% costs, maximum drawdown comparison, exposure, and trade log.

Allowed outcomes: `PROSPECTIVE_PRIMARY_MET`, `PROSPECTIVE_PRIMARY_NOT_MET`,
`UNDERPOWERED_EXTEND_COLLECTION`. Meeting the primary endpoint once does not authorize any
stronger label than `PROSPECTIVE_PRIMARY_MET`; capital-readiness language remains forbidden.

## Activation gates (inherited, none satisfied by this document)

Activation requires the prospective lockbox infrastructure of
FEAR_GREED_V3_PROSPECTIVE_LOCKBOX_PROTOCOL.md: append-only hash-addressed raw-payload
storage with revision-zero-primary semantics, verified instrument identity and calendars,
an automated collector independent of the mutable dashboard runtime, redistribution-rights
review, storage budget, clean committed tree, and independent replay. Until those gates are
met and an activation freeze is recorded, this candidate collects nothing.

## Stop rule

One prospective evaluation at the declared sample size. If `PROSPECTIVE_PRIMARY_NOT_MET`,
the candidate is closed permanently; no threshold search on the prospective data is
permitted under this identity.
