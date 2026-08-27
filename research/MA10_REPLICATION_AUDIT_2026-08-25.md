# MA10-LF-50 replication audit correction — 25 August 2026

Status: the primary all-market verdict remains `FAIL_NO_COMMON_WINNER` and exactly one of five markets beats buy-and-hold. A defect in the secondary chronological-half diagnostic was found and corrected after the canonical result had been opened.

## Primary result independently reproduced

An implementation independent of `simulate()` reconstructed month ends, ten-month averages, next-close orders, exposure changes, transaction costs and buy-and-hold directly from the frozen schema-5 rows. It reproduced the canonical primary terminal values to JavaScript floating-point precision:

| Market | MA10-LF-50 | Buy-and-hold | Primary |
|---|---:|---:|:---:|
| Crypto | 10.4287455115447 | 7.873909109949305 | PASS |
| Sweden | 2.27710060517598 | 3.75268837689808 | FAIL |
| USA | 14.203739029985565 | 28.94505737967635 | FAIL |
| Europe | 2.324424118023191 | 2.514637289261746 | FAIL |
| Global | 2.84485414889147 | 6.801797707779566 | FAIL |

The arithmetic cross-market endpoint also fails: MA10 `6.41577268272418` versus buy-and-hold `9.97761797271301`. This is an average of differently dated endpoints, not an investable common-calendar portfolio.

## Defect and correction

The original `simulateHalf()` discarded the deliberately supplied pre-boundary warmup and recomputed ten months of observations after the second-half boundary. The reported second halves consequently began roughly nine to ten months too late.

The corrected code now constructs signals with the warmup retained, filters executable orders to the half boundary, and begins the independent second-half result at the first next-close execution on or after that boundary. A dedicated regression test requires that the start is less than 45 calendar days after the boundary and that the first signal predates its execution.

Independent corrected second-half results all fail:

| Market | Corrected second start | MA10 | Buy-and-hold | Result |
|---|---:|---:|---:|:---:|
| Crypto | 2023-07-01 | 2.082710688 | 2.650020684 | FAIL |
| Sweden | 2020-01-02 | 1.645412231 | 1.990418032 | FAIL |
| USA | 2009-12-01 | 2.944485873 | 9.194681569 | FAIL |
| Europe | 2015-07-01 | 1.106699928 | 1.681708630 | FAIL |
| Global | 2017-07-03 | 2.145059729 | 2.866902872 | FAIL |

Therefore the original statement that Crypto passed both halves was wrong. The corrected half robustness count is zero of five markets, which weakens the candidate; it cannot turn the failed primary result into a pass.

## Integrity scope

The original pre-outcome hashes remain recorded in `FEAR_GREED_MA10_REPLICATION_FREEZE.json`, and the original canonical result and sidecars remain untouched. The corrected source and test necessarily no longer match those original source hashes. Any corrected rerun must receive a new post-audit identity and must not be presented as if it had been frozen before the already-viewed outcome.
