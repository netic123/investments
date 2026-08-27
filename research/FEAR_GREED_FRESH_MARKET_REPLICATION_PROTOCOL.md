# Fresh-market replication of the Europe contrarian rule — preregistered one-shot test

<!-- FRESH-MARKET-REPLICATION-FROZEN 2026-08-28 : rule, markets, mappings, gates and stop
     rule declared and committed BEFORE any outcome on any fresh market was computed. The
     runner refuses to run unless this file is committed and byte-identical to HEAD. -->

Status before the run: `FROZEN_AWAITING_SINGLE_RUN`

## Why this test exists

Every prior strategy result in this program was mined from five repeatedly-searched
markets. The preregistered Europe rule (EUROPE-MONTHLY-CONTRARIAN-V1) is under prospective
validation in the lockbox, but that verdict is years away. Spatial replication is the one
strong reality test available now: apply the frozen rule — zero retuning — to markets no
search in this repository has ever touched. Fresh markets cannot have been overfit by
construction. A win here is genuine (retrospective, unmined) supporting evidence; a loss
is genuine falsification pressure on the Europe result.

## Frozen rule under test (copied from EUROPE-MONTHLY-CONTRARIAN-V1, no modifications)

- Signal: the production unified v2 six-component score (marketfg.js engine, standard
  parameters 252/126/6/7), computed per fresh market with the mappings below; displayed
  integer of the raw composite at each decision close.
- Decision: last trading day of each calendar month. If long and integer ≥ **85** → sell;
  if in cash and integer ≤ **35** → buy. Execution next close. Initial state long.
- Out-of-market capital earns the audited DTB3 13-week T-bill accrual; one-way cost 0.10%
  (stress scenario 0.25%) per switch including a terminal-close fill (schema-6 convention).
- Benchmark: buy-and-hold of the same ETF (adjusted closes = total return, investable).

## Fresh markets and frozen mappings (declared before any data inspection beyond
inception dates)

Macro slots use the same external-proxy convention as the production crypto and global
tabs (IEF / HYG / LQD); volatility is null → realized fallback; breadth = the market's
small-cap ETF vs the core ETF (large null → index).

| Market | index | small | vol | bond | hy | ig |
|---|---|---|---|---|---|---|
| japan | EWJ | SCJ | null | IEF | HYG | LQD |
| uk | EWU | EWUS | null | IEF | HYG | LQD |
| em | EEM | EEMS | null | IEF | HYG | LQD |
| germany | EWG | EWGS | null | IEF | HYG | LQD |

Eligible window per market: ETF price rows from the date of the 21st score observation
(schema-6 warm-up convention) through the last completed session at run time.

## Preregistered outcomes and gates (frozen)

Per market: terminal wealth ratio vs buy-and-hold at base and stress cost, trade count,
and a same-rule 99-shift circular timing placebo (finite-sample p, floor 0.01).

Verdict (exactly one, mechanical):
- `REPLICATION_SUPPORTED`: ≥ 3 of 4 markets with base-cost ratio > 1 AND ≥ 2 of 4 with
  placebo p ≤ 0.10.
- `REPLICATION_FAILED`: ≤ 1 of 4 markets with base-cost ratio > 1.
- `REPLICATION_MIXED`: anything else.

Interpretation bounds, declared in advance: data is retrospective and current-vintage
(Yahoo), so even `REPLICATION_SUPPORTED` is quasi-out-of-sample evidence, not
confirmation; it would justify adding a fresh-market arm to the prospective lockbox.
`REPLICATION_FAILED` materially weakens the Europe candidate's prior and must be recorded
in research/README.md next to it. Forbidden labels: `PASS`, `VALIDATED`, `CONFIRMED`,
`DEPLOYABLE`.

## Stop rule

One run, results committed verbatim whatever they say. No threshold, mapping, market-set
or window changes after this freeze; any variant is a new protocol with a new identity.
