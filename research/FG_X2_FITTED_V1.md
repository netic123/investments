# FG-X2-FITTED-V1 — the ≥2× model (deliberate overfit construction)

<!-- FG-X2-FITTED-V1-RECORDED 2026-08-28 : per-tab fitted state tables and outcomes are
     frozen in fg-x2-fitted-v1.json. -->

Status: `DELIBERATE_OVERFIT_CONSTRUCTION_NOT_A_STRATEGY`

Forbidden uses: trading on it, presenting any number below without this document's status
line, or citing it as evidence the Fear & Greed score has predictive value.

## What it is

The literal answer to "make every tab outperform its index by at least 2×": for each tab, a
fitted lookup mapping each day's (displayed score integer, 5-day score direction) state —
156–190 states per tab — to long-or-cash, selected by greedy wealth maximization over the
full available history with schema-6 execution (decide close t, act close t+1), one-way
costs, and the audited T-bill accrual on cash. Spec and full state tables:
[`fg-x2-fitted-v1.json`](fg-x2-fitted-v1.json).

| Tab | Index B&H | Model vs index | Trades | States |
|---|---|---|---|---|
| Crypto | 16.68× | **371.67×** | 762 | 161 |
| US Tech | 19.53× | **4.91×** | 1,364 | 186 |
| USA | 7.57× | **4.26×** | 942 | 190 |
| Europe | 2.85× | **3.15×** | 1,541 | 188 |
| Global | 2.72× | **3.09×** | 710 | 181 |
| Sweden | 1.48× | **2.30×** | 295 | 156 |

Every tab ≥ 2.0× its index on the historical record. Inputs: the frozen schema-5 snapshot
(`ac025aec…444d`) for the five original tabs; live-fetched ustech score history and XLK
adjusted closes (2026-08-27/28) for the sixth; DTB3 cash from the frozen FRED bytes.

## Why it is worthless as a strategy — measured, not asserted

The identical fitting procedure applied to circularly shuffled, informationless scores also
clears 2× in every market tested, and **beat the real scores in USA (4.33× vs 4.26×) and
Global (3.77× vs 3.09×)**. The fitted number measures the fitting machinery's capacity to
memorize the sample, not the signal: the state tables have no coherent structure (long at
one integer, cash at the next), and the trade counts (295–1,541) are the memorization
budget being spent. Expected out-of-sample edge over the index: zero beyond the signal's
true information content, which schemas 3–12 measured as approximately nil everywhere
except possibly Europe (under prospective validation in EUROPE-LOCKBOX-V1).

## Why it is committed anyway

As the program's permanent calibration reference: any future backtest of this repository's
score claiming outperformance must be compared against what this construction achieves for
free. A claimed edge is interesting only insofar as it exceeds, in placebo-controlled
terms, what deliberate overfitting produces on demand. The honest tiers remain
FG_EXTREMES_RETRO_V1.md (retrospective, mined, modest) and the lockbox (prospective, the
only tier that can confirm anything).

Not investment advice.
