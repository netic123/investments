# FG-EXTREMES-RETRO-V1 — per-tab extreme fear/greed model (frozen 2026-08-27)

<!-- FG-EXTREMES-RETRO-V1-FROZEN 2026-08-27 : per-tab parameters and expected outcomes are
     frozen inside fear_greed_extremes_retro_model.js, which refuses to report if any number
     drifts from them on the frozen inputs. -->

Status: `RETROSPECTIVE_MINED_MODEL_NOT_PREDICTIVE_NOT_VALIDATED`

Forbidden labels for this model until prospective evidence exists: `PASS`, `VALIDATED`,
`CONFIRMED`, `DEPLOYABLE`.

## What this is

The literal answer to "sell at extreme greed, buy at extreme fear, and beat the market index
in every tab, historically." One rule form, per-tab calibration:

| Tab | Buy when ≤ | Sell when ≥ | Smoothing | Cadence | vs index B&H | Trades | Same-rule placebo p |
|---|---|---|---|---|---|---|---|
| Crypto | 20 | 80 | 10 obs | month-end | **1.355×** | 3 | 0.19 |
| Sweden | 20 | 70 | 10 obs | daily | **1.158×** | 7 | 0.01 |
| USA | 5 | 85 | 21 obs | month-end | **1.039×** | 2 | 0.01 |
| Europe | 45 | 80 | 42 obs | daily | **1.744×** | 8 | 0.01 |
| Global | 45 | 75 | 63 obs | weekly | **1.236×** | 6 | 0.02 |

Conventions (identical in every tab): production v2 composite score carried onto the target
calendar (≤7 calendar days stale), trailing-mean smoothed over available observations,
displayed-integer rounding at decision time; decisions execute at the next close; one-way
base costs (crypto 0.25%, others 0.10%) including a terminal-close fill; out-of-market
capital earns the audited DTB3 13-week T-bill accrual. Benchmark: buy-and-hold of the same
tab's index series over the identical window. Frozen inputs: schema-5 snapshot
`ac025aec…444d` and the frozen FRED DTB3 bytes pinned by `five_market_proxy_data_v2.js`.

Two ingredients turned the previously always-losing extremes rule into a five-tab
retrospective winner: **smoothing the score** (collapsing whipsaw to 2–8 trades per tab) and
**correct cash accounting** (T-bill yield instead of 0% while out of the market).

## What this is NOT — read before acting on it

- **Mined.** Each tab's parameters are the best of 1,458 configurations evaluated on fully
  exposed history (schemas 3–12 plus the 2026-08-27 sweeps). The per-rule placebo p-values
  in the table do NOT price in that selection; the earlier max-of-family placebos in this
  program show how much that matters.
- **Few events.** The edges rest on 2–8 trades per tab. USA's entire win is two trades
  (one panic bought, one exit). A single different episode ordering erases it.
- **Not uniform.** The same searches proved the stronger claims false: no single shared
  configuration beats all five tabs (~15,000 shared configs, best wins 3/5 — losing crypto
  0.71× and USA 0.81×), and one world-score rule on the combined equal-weight portfolio
  beats the combined basket in 0 of 1,458 configs (best 0.85×). Threshold demands across
  tabs are mutually exclusive; per-tab calibration is the only form in which the extremes
  rule wins everywhere.
- **Not the dashboard bands.** The production labels (buy ≤24 / sell ≥75, raw daily) LOSE
  in four of five tabs (crypto 0.10×, USA 0.43×, Europe 0.81×, Global 0.76×).
- **Not predictive.** The score's measured forward-return information is ≈ zero (schema 11);
  a fitted lookup on shuffled garbage "beat" the USA index 1.6–1.7×, demonstrating how
  easily retrospective wins are manufactured. Forward-looking claims for any part of this
  model require the prospective lockbox
  (FEAR_GREED_V3_PROSPECTIVE_LOCKBOX_PROTOCOL.md); the only candidate currently
  preregistered is the Europe monthly contrarian rule
  (FEAR_GREED_EUROPE_MONTHLY_CONTRARIAN_LOCKBOX_PROTOCOL.md).

## Reproduce

```powershell
node research/fear_greed_extremes_retro_model.js
```

Requires the frozen local artifacts (schema-5 snapshot, frozen FRED bytes). The runner
verifies both hashes, recomputes every tab, and exits with an error if any ratio or trade
count drifts from the frozen expectations by more than 1e-9 relative.

Not investment advice.
