# Fear & Greed rule search — exploratory development/holdout protocol (schema 12)

<!-- RULE-SEARCH-DESIGN-DECLARED 2026-08-27 : candidate space, selection rule and holdout gate
     written before any schema-12 development or holdout outcome was computed. This is NOT a
     schema-5-style pre-outcome freeze: the author has seen the outcomes of schemas 3-11 on the
     same exposed history, and development outcomes are (by design) seen before the holdout stage
     is run. See "Prior exposure" below.
     AMENDED 2026-08-27, still pre-outcome: an adversarial code review of the runner (before any
     development or holdout outcome was computed) found protocol/code drift and integrity gaps;
     this document was corrected together with the runner. See "Amendment log" at the end. -->

## Purpose

Schemas 3–11 falsified: v1 predictiveness, 15 composite re-weightings, 31 contrarian
extreme-threshold long/cash rules, annual walk-forward selection among them, trend-confirmed
extreme entries, the 50/100/150 exposure overlay, the Faber MA10 price rule as a five-market
winner, and v3 as a predictor. This study asks the remaining unasked question:

> Does ANY simple rule on the production v2 score or its six components — including the
> untested momentum direction (risk-on when sentiment is high or rising) — beat buy-and-hold
> after costs on a development window, and does the selected rule survive a single evaluation
> on a chronologically later holdout window?

## Status vocabulary

Allowed final statuses:
- `EXPLORATORY_NO_DEVELOPMENT_SURVIVOR`
- `EXPLORATORY_NO_HOLDOUT_WINNER`
- `EXPLORATORY_HOLDOUT_WINNERS_LOCKBOX_CANDIDATES_ONLY`

Forbidden labels anywhere in outputs: `PASS`, `VALIDATED`, `CONFIRMED`, `DEPLOYABLE`.
A holdout win is a preregistration candidate for the prospective lockbox
(FEAR_GREED_V3_PROSPECTIVE_LOCKBOX_PROTOCOL.md) and nothing more.

## Prior exposure (why this cannot confirm anything)

The full history through 2026-08-24 was exposed to the author through the outcomes of
schemas 3–11. The development/holdout split below is internal to THIS study only; it does not
restore out-of-sample status for the holdout years, which appeared inside the evaluation
windows of earlier studies. Additionally the candidate space below is the seventh rule family
tested against this endpoint; any holdout win carries a large unquantified multiplicity
discount. Only the prospective lockbox can produce confirmatory evidence.

## Input

- Frozen schema-5 snapshot
  `local-artifacts/v2-validation-final/inputs/fear-greed-v2-validation-input-2026-08-25T12-44-22Z.json`,
  sha256 `ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d`
  (verified before parse; identical pin to schemas 6–10).
- All five markets. Per-market usable range: signal rows after a common warm-up of
  126 signal rows (the maximum indicator lookback below), so every candidate sees identical
  decision dates. Price SMA gates use the full price history, which starts well before the
  first decision bar in every market (7–15 years of lead for the equity markets; ~8 months of
  price lead before the first crypto signal row, plus the 126-row warm-up).
- Bar grid: the simulation grid is the signal-dated closes only. A target close inside the
  range that has no signal row is excluded from the interval grid; the frozen snapshot contains
  exactly one such bar (sweden 2024-01-08), whose daily return is compounded into the adjacent
  interval for strategies and benchmark alike. This deliberately differs from schema 6's
  all-price-rows grid; strategy and buy-and-hold always share the identical grid, and each
  market's excluded dates are disclosed in the output.

## Simulation contract (schema-6 accounting on the signal-bar grid)

- Long/cash only, position ∈ {0, 1}. Decision from data at bar t executes at bar t+1 of the
  signal-bar grid with a multiplicative one-way cost, exactly as schema 6 applies it. Terminal
  positions marked to market; no terminal liquidation. Cash earns 0% (conservative against
  long/cash rules; no cash yield credit). Terminal-wealth, CAGR, drawdown, exposure and fill
  accounting reproduce schema 6 bit-for-bit on a shared grid; Sharpe and annualized volatility
  are re-derived from the wealth curve and may differ from schema 6's direct returns array at
  machine precision (~1e-13 relative). No gate consumes Sharpe or volatility.
- Initial position: long (primary); cash-start reported as sensitivity.
- Costs per one-way switch: base crypto 0.25%, equities 0.10%; stress crypto 0.75%,
  equities 0.25% (schema-6 `MARKET_COSTS`).
- Annualization: snapshot per-market values (crypto 365, equities 252); calendar-day CAGR.

## Candidate space (45 candidates, enumerated exhaustively)

Let S_t = raw publishedScore, I_t = displayed integer (production rounding), C_t(c) = component
score for c ∈ {momentum, strength, volatility, safeHaven, credit, breadth}, P_t = target close,
SMA_k(x) = trailing k-observation mean including t. "Long iff X" means desired position 1 when
X is true at close t, else 0; execution next close.

| Family | Ids | Rule (momentum direction) | Contrarian variant |
|---|---|---|---|
| Score/SMA cross | SMAX_M_k, SMAX_C_k; k ∈ {21, 63, 126} | long iff S_t > SMA_k(S) | inverted |
| Score slope | SLOPE_M_k, SLOPE_C_k; k ∈ {5, 21, 63} | long iff S_t > S_{t−k} | inverted |
| Score level | LVL_M_L, LVL_C_L; L ∈ {35, 45, 50, 55, 65} | long iff I_t ≥ L | long iff I_t ≤ L |
| Hysteresis (momentum) | HYST_M_H_L; (H,L) ∈ {(55,45), (60,40), (65,45), (70,50)} | enter long when I_t ≥ H, exit when I_t ≤ L | — (contrarian hysteresis = burned schema-6 family) |
| Component/SMA63 cross | CSMAX_M_c; 6 components | long iff C_t(c) > SMA_63(C(c)) | — |
| Component level | CLVL_M_c; 6 components | long iff C_t(c) > 50 | — |
| Ensemble vote | ENS_M_n; n ∈ {3, 4, 5} | long iff ≥ n of 6 components > 50 | — |
| Hybrid trend+sentiment | HYB_TREND_AND_NOTFEAR (P>SMA125(P) AND I ≥ 45); HYB_TREND_AND_NOTGREED (P>SMA125(P) AND I ≤ 74); HYB_TREND_OR_GREED (P>SMA125(P) OR I ≥ 65); HYB_TREND_AND_RISING (P>SMA125(P) AND S_t > SMA_21(S)) | as listed | — |

Controls (never selectable; reported for attribution):
- `CTRL_PRICE_SMA125`: long iff P_t > SMA_125(P) — pure price trend, no sentiment.
- `CTRL_PRICE_SMA210`: long iff P_t > SMA_210(P) — daily analog of the schema-10 MA10 rule.
- Buy-and-hold benchmark.

## Windows

Per market, over the common decision range (signal row 127 onward): development = first
ceil(0.60 · N) target bars, holdout = the remaining bars, split at a bar boundary with one
overlapping boundary bar as the holdout's first price row (no return overlap). Both windows
must contain at least 30 bars or the market is refused with an error.

## Stage 1 — development (all candidates)

Run all 45 candidates + controls on the development window at zero/base/stress costs.

Eligibility (frozen): development terminalWealthRatio vs buy-and-hold > 1 at base AND at
stress cost, and fillCount ≥ 4.

Selection (frozen):
- Per market: the eligible candidate with maximum development terminalWealthRatio at base
  cost. Tiebreak: fewer fills, then lexicographic id. If none, that market's
  `selectionStatus` is emitted as `NO_DEVELOPMENT_SURVIVOR`.
- Shared: the candidate maximizing min over markets of ln(terminalWealthRatio) at base cost,
  required > 0 at base and stress in every market (no fill minimum). If none: no shared
  selection.

Stage 1 writes the selection file — carrying the selections, a fingerprint of the full
development results, and the sha256 of this protocol file and of the runner file — and MUST
NOT compute or print any holdout outcome.

## Stage 2 — holdout (selected candidates only, run once)

For each selected candidate — the per-market selections AND the shared selection — plus the
two controls: one evaluation on the holdout window at zero/base/stress costs plus the
cash-start base-cost sensitivity. Gating uses base and stress only.

Win gate (frozen), applied identically to per-market and shared selections: holdout
terminalWealthRatio > 1 at base AND at stress cost. A per-market selection wins its market by
passing the gate there; the shared selection wins by passing the gate in every market. Both
kinds of win enter the winners list (tagged by scope) and drive the final status; the
no-survivor status is emitted only when development selected nothing, per-market or shared.

Also reported (not gating): holdout maximumDrawdown vs buy-and-hold; comparison vs
`CTRL_PRICE_SMA125` on the same window (does sentiment add anything beyond price trend?),
computed for per-market and shared selections alike; circular-shift timing placebo (≤199
deterministic offsets of the candidate's sentiment series relative to prices, price gates
unshifted) with the actual holdout wealth's mid-rank percentile ((below + 0.5·ties)/n), a
finite-sample exceedance fraction, and a degenerate-distribution flag when every shift
produces the same terminal wealth. The placebo median uses the average of the two middle
order statistics for even shift counts.

## Determinism and provenance

Snapshot sha256 verified before parse; global fetch is stubbed to throw during analysis (the
computation is snapshot-driven and performs no network access); the full analysis is executed
twice and both canonical JSON fingerprints must match; results are written with sha256
sidecars under `local-artifacts/rule-search/`.

Stage-2 integrity: the holdout stage refuses to run unless the selection file exists, the
protocol-file and runner-file sha256 recorded at stage 1 match the current files, a fresh
deterministic replay of the development stage reproduces the recorded fingerprint, and the
selection file's selections equal the replay's selections (the replay's selections are what
is actually evaluated, so an edited selection file cannot steer the holdout). Each stage
refuses to overwrite an existing selection or holdout output unless an explicit
`--force-overwrite` flag is passed; any use of that flag after a holdout outcome exists is a
protocol violation and must be disclosed.

## Stop rule

One development stage and one holdout stage. No re-selection, no added candidates, no
threshold retuning after any schema-12 outcome is seen. A failed holdout closes this study;
the only permitted continuation is prospective lockbox preregistration of an unrelated,
pre-specified design.

## Amendment log

2026-08-27, pre-outcome (before any development or holdout numbers were computed): an
adversarial review of the runner produced these corrections, applied to code and protocol
together — (1) the holdout stage now gates the shared selection identically to per-market
selections, includes shared wins in the winners list, and derives the no-survivor status from
both selection kinds; (2) the selection file's selections are now bound: stage 2 re-derives
them by deterministic replay, refuses on mismatch, and pins the protocol and runner files by
sha256 across stages; (3) both stages refuse to overwrite existing outputs without an
explicit disclosed flag; (4) the bar grid (signal-dated closes; one excluded sweden bar
2024-01-08), the machine-precision Sharpe/volatility caveat, the 30-bar window minimums, the
crypto price-lead correction, the zero-cost/cash-start holdout reporting, and the
network-stub wording were disclosed or corrected above; (5) the placebo now reports a
mid-rank percentile, an even-count-correct median, and a degeneracy flag; (6) a
prior-exposure summary line that embedded a forbidden label as a substring was reworded, and
the tests now scan complete serialized outputs for the forbidden vocabulary.
