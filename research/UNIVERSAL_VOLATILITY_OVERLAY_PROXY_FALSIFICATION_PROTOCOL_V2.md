# Universal volatility overlay proxy-falsification protocol v2

<!-- UNIVERSAL_VOL_PROXY_FALSIFICATION_FREEZE_MARKER: FROZEN_UNIVERSAL_VOL_PROXY_FALSIFICATION_V2 -->
<!-- UNIVERSAL_VOL_PROXY_FALSIFICATION_FREEZE_AT: 2026-08-25T21:29:04.3858034Z -->
<!-- NORMATIVE_BASE_PROTOCOL_SHA256: 601bb020265d593d057bccc259854871e032a025bd708412eba878d8ab0d9406 -->

Status: **frozen research design; retrospective proxy falsification only; no
strategy outcome was run or inspected to write or freeze this document; never
confirmatory, executable, deployable, or production-approved**.

This document is the versioned successor to the frozen v1 proxy-falsification
protocol. It preserves the exact model, candidates, costs, chronology,
comparisons, metrics, bootstrap, gates and one-way inference boundary. V2
changes only the cash-source history and the versioned data/stage schemas so
that the per-market development test does not unnecessarily discard valid EWD,
IYY and IEV history.

This document freezes only the pre-outcome v2 proxy design and exact artifact
identities. Freezing it does not itself authorize a Stage-1 calculation.

## Normative chain and non-amendment rule

The unchanged normative base protocol is:

```text
path:   research/UNIVERSAL_VOLATILITY_OVERLAY_PROTOCOL.md
marker: FROZEN_UNIVERSAL_VOL_OVERLAY_V1
sha256: 601bb020265d593d057bccc259854871e032a025bd708412eba878d8ab0d9406
```

The v1 proxy protocol from which this v2 document is derived is preserved at:

```text
path:   research/UNIVERSAL_VOLATILITY_OVERLAY_PROXY_FALSIFICATION_PROTOCOL.md
marker: FROZEN_UNIVERSAL_VOL_PROXY_FALSIFICATION_V1
sha256: fe1088f197388fb5edfd6cdbb96f3c037d0567d9aabda6a9c72d5f656972be13
```

All v1 proxy-protocol clauses are incorporated except where this document
explicitly replaces:

1. the exact data/artifact identities;
2. the cash history boundary and its source provenance;
3. the normalized input schema, changed from `five-market-proxy-input-v1` to
   `five-market-proxy-input-v2`; and
4. the physically separated stage schema, changed from
   `universal-vol-overlay-proxy-input-v1` to
   `universal-vol-overlay-proxy-input-v2`.

If this document conflicts with the normative base protocol about candidate
math, accounting, costs, comparisons, dates, metrics, gates or stop rules, the
hashed normative base controls. If it conflicts with v1 about an unchanged
proxy limitation or inference rule, the more restrictive rule controls. This
document controls only the v2 identities and the longer causal cash support.

The unchanged limitations remain absolute: a proxy failure may falsify on this
panel; a numerical success may only advance the unchanged candidate to a new
licensed, executable and prospective study. No v2 result may be labelled
`PASS`, `VALIDATED`, `CONFIRMED`, `OOS_CONFIRMED`, `EXECUTABLE` or
`DEPLOYABLE`.

## V1 superseded before outcomes

The v1 data chain inherited a DTB3 request beginning on 2008-01-01 from an
older equity-rotation experiment whose strict-common four-ETF calendar began
with ACWI in March 2008. The universal volatility protocol instead uses each
market's own completed-close calendar. Reusing the old cash boundary therefore
discarded otherwise available EWD observations from 1996, and IYY/IEV
observations from 2000.

This defect was found before any universal-volatility proxy candidate return,
target, metric or gate was calculated. V1 is retained byte-for-byte as audit
evidence and has status:

```text
SUPERSEDED_BEFORE_ANY_UNIVERSAL_VOLATILITY_PROXY_OUTCOME
```

No v1 file, hash or protocol is rewritten. V2 is a different pre-outcome data
experiment. The extension is not a response to model performance and changes
no model parameter.

## Exact frozen v2 data identities

The v2 data normalizer and focused tests are:

| Artifact | SHA-256 |
|---|---|
| `research/five_market_proxy_data_v2.js` | `f06d62546b7a9b4405ae47fdc3c703ba550a3ad4e1ef0270ebd5b805aa24cc83` |
| `test/five_market_proxy_data_v2.test.js` | `ab45176102bd28064aea1a1df09d7c453fbd02de88ac7e946657dea53742fd42` |

The official extended FRED source is frozen separately from the unchanged
risky data:

| Artifact | Exact SHA-256 |
|---|---|
| Raw official CSV, `research/local-artifacts/five-market-proxy-data-v2/fred-dtb3-1995-01-01-to-2026-08-24.csv` | `55f7f224f84545a0a577353e7d4f1826025eb28424b51249eabb456396449fcd` |
| Raw CSV sidecar bytes, adjacent `.sha256` | `ce6397a8c6be720548ec039e8bccff24a889984fe6771bdc6a4c47dcd0048eef` |
| Source receipt, `research/local-artifacts/five-market-proxy-data-v2/fred-dtb3-source-2026-08-24.json` | `f2816de5c736a806268faaeedd3634720038186c4bebf73b37104aecfde9f7ab` |
| Source-receipt sidecar bytes, adjacent `.sha256` | `3a47772cfd38e409a284e78bf01283b8ad0b988a588c2994fa5748c09189ea09` |

The exact official request is:

```text
https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTB3&cosd=1995-01-01&coed=2026-08-24
retrieved UTC: 2026-08-25T19:59:12.404Z
raw bytes: 130742
```

The data freeze produced:

| Artifact | Exact SHA-256 |
|---|---|
| Normalized v2 input, `research/local-artifacts/five-market-proxy-data-v2/five-market-proxy-input-v2-2026-08-24.json` | `a85ffc681b4911fdd6d65a2e091301985937f7ffa05aac41f1642209eda95247` |
| Normalized-input sidecar bytes, adjacent `.sha256` | `826acb0de5756dde835ac1cce583eb9c7631bd7ae2ee10ce877a220c456316c4` |
| Repository-intended v2 manifest, currently untracked pending an authorized commit, `research/FIVE_MARKET_PROXY_DATA_FREEZE_V2_2026-08-24.json` | `1e64de19073b05aacc599083edff050eddd5a710be792212d1d0bcd8ccc0159e` |
| Manifest sidecar bytes, adjacent `.sha256` | `3d84a806621cb78052ba6ed99456d6c242d62df3236ace8bffa0fa04e3ea84ee` |

The following frozen v1 source artifacts are reused byte-for-byte and were not
refetched:

| Role | Artifact SHA-256 |
|---|---|
| Actual schema-4 CMBITM source | `9d42777cc8ad7de6394cb0045e24fa0b588c1e31915acadbc49af55842579b7c` |
| Primary ETF cache, risky rows only; its embedded 2008 DTB3 is explicitly ignored | `4a9b5cda4fcd78c30a5a0b346d17f483ea16aaa07ecb5cc9bf7795dff2a27b08` |
| Predeclared robustness raw cache | `dc4e8a6cd9fdc14c5c0efc94eacdd0dcd5185e3c672b2f2e774330901d133bdc` |

The v2 manifest says `containsStrategyOutcomes=false`, records
`riskyAndRobustnessBytesRefetched=false`, and carries the exact source and row
receipts. A regenerated or later-vintage file is a different experiment.

## Exact six series

The five risky series are byte-identical to v1:

| Role | Series/classification | Rows and range | Raw SHA-256 | Normalized-row SHA-256 |
|---|---|---|---|---|
| `crypto` | CMBITM; price-return, noninvestable, provider-backcast | 2,612; 2019-07-01 to 2026-08-24 | `fe7d5b99e1b6c4cb1f989df6c78123fc5457c582becff86354c4cffb242f5f7e` | `f8519b927bde51b9329417dc1f9e31ce0e67920a4c2bb9f3935a0d23e6b92729` |
| `sweden` | EWD; current-vintage USD adjusted-close ETF total-return proxy | 7,658; 1996-03-18 to 2026-08-24 | `0127d2948dfe4a79753c9b5280a390d25e9d13f6dd27fb5f444cde16791eed2b` | `2580ba27aa7d31a1f2d6f41a986092f00461f09f71326472748042421206223e` |
| `usa` | IYY; current-vintage USD adjusted-close ETF total-return proxy | 6,585; 2000-06-16 to 2026-08-24 | `0c881ef398ac8f34fda4976063fd912a60b3ea073f3fe1125fa768686555ad92` | `108dcfd1c3b5f05bd71ccf4b16e7008ca4c369113bfe10ce92a590a202d8d3bc` |
| `europe` | IEV; current-vintage USD adjusted-close ETF total-return proxy | 6,556; 2000-07-28 to 2026-08-24 | `1cd419d89766efbaca5b903523cd80b38f5e4c57a1ef50ed26804875dbd4950f` | `8b61a4eb0acfea35c0a54d8426280c484a19e3f6458693dd8d974bce54ec7d25` |
| `global` | ACWI; current-vintage USD adjusted-close ETF total-return proxy | 4,631; 2008-03-28 to 2026-08-24 | `94a61e38d1fcb1ee44d0870452d3f4cebfb014cc9b90cff9453cc6f732557761` | `9307603c3c78b5fff46fd0563fb8395421e53beceb2faa153ef2f4c03b8491da` |

The v2 cash series is:

| Role | Series/classification | Rows and range | Raw SHA-256 | Normalized-row SHA-256 |
|---|---|---|---|---|
| `cash` | `DTB3-91D-ACCRUAL-V2`; reconstructed, nonexecuted daily accrual proxy | 11,556; 1995-01-04 to 2026-08-24 | `55f7f224f84545a0a577353e7d4f1826025eb28424b51249eabb456396449fcd` | `3aff9a603124d5ee195a544b785802e68b5245ffead03db9d081901e8b24ff4f` |

The raw CSV contains 7,916 non-missing observations from 1995-01-03 through
2026-08-21. Their normalized-row SHA-256 is
`d6f4e4e41088d8e1b442c8ddfa63ba69118adacdee2070a9b780bb62e490b3fb`.
The maximum gap between consecutive non-missing observations is four calendar
days, below the unchanged seven-day rejection limit.

The risky-only strict-common inventories remain unchanged because cash is not
a member:

```text
five risky markets: aa7b9b53bd0f47b8de6da980f5d188dcb4eb5651d89bc0eb3449a7424a008481
four equity markets: 1626c6fc91efa55d71c67a10941a432104dd5e1cc2a467bf666dde341bce2ccf
```

### Pre-outcome longer-crypto boundary

Potential longer crypto histories were audited before any v2 outcome, but none
is admitted or fetched into this experiment. CMBITM remains the sole primary
crypto series and may never be spliced to another index:

- CCi30's earliest history is pre-live/lower-confidence and reports zero early
  volume; the reviewed constituent evidence also contains two 31-name,
  approximately 101.1%-weight anomalies, conflicting governance wording and
  unresolved CC BY-NC-ND/public-derivative-use constraints.
- CMBI10 would add only about ten eligible Stage-1 months after the required
  warm-up, remains a same-provider backcast and has a missing 2022-11-10 close.
- 21Shares HODL is an executable top-five product, not the broad market, and is
  too short for the required early-development history.

CCi30, CMBI10 and HODL may be studied only in a separately licensed and
preregistered future experiment. They cannot be substituted after a v2 result
or used to retroactively rescue this candidate family.

## Unchanged cash construction and limitations

FRED DTB3 is a daily bank-discount-basis yield, not a wealth index or traded
account. V2 does not relabel it. For every accrual interval `[d,d+1]`, select
only the latest non-missing observation `s` satisfying:

```text
s < d
calendarDays(d - s) <= 7
```

Then apply exactly the unchanged v1 formula:

```text
discountRate = DTB3_s / 100
billPrice    = 1 - discountRate * 91 / 360
gross91      = 1 / billPrice
dailyFactor  = gross91^(1 / 91)
```

The first observed yield is 1995-01-03, so the normalized wealth path begins
at 1.0 on 1995-01-04. The source has observation dates but not the release
timestamps archived for every historical row; strict prior-date use remains a
conservative information-lag convention, not proof of historical execution.

The proxy assumes a frictionless continuously rolled 91-day bill, no bid/ask
spread, auction or settlement timing, tax, custody, reinvestment delay or
mark-to-market effect. It remains unsuitable for an original-protocol source
pass. It also cannot establish historical borrowing availability or spreads
when candidate exposure exceeds 1.0.

Official identity pages:

- FRED DTB3: https://fred.stlouisfed.org/series/DTB3
- U.S. Treasury bill-pricing convention:
  https://www.treasurydirect.gov/marketable-securities/understanding-pricing/

## Data-only Treasury auction corroboration

An independent data-only audit compares v2 positive-cash accrual over exact
issue-to-maturity windows with official 13-week Treasury-bill auction prices.
It contains no market signal, allocation, candidate return or model gate and is
not an input to parameter selection. Its identities are:

| Artifact | SHA-256 |
|---|---|
| `research/treasury_13w_cash_audit.js` | `7f0109d3880b92e9cf56f00275c96fed24fa6a6fe6fdcc6041ffd66375418725` |
| `test/treasury_13w_cash_audit.test.js` | `f391736084aff5239b00f279ddcf188b3df0e8f49d8b1309da5ab5dab5171d62` |
| Repository-intended result, currently untracked pending an authorized commit, `research/TREASURY_13W_CASH_AUDIT_2026-08-24.json` | `432ba57be9884d0a5135132004e479f8d2e84b95abbfe7366ef68af2f2e5e84d` |
| Result-sidecar bytes, adjacent `.sha256` | `ef5b3b552737bf478d9daf797f1d66b18de36e4057e40a15b9dce4176376dd0a` |
| Human audit, `research/TREASURY_13W_CASH_AUDIT_2026-08-25.md` | `5d66c5a705872081763b32d08acc4e64b966ecd8d18b06be66d9c4aef76f29c0` |
| Raw official FiscalData response | `fa267363f210822e6f2c499bf6a2ea6b76d02a32bb80bfc8f921d96cb4e4c16d` |
| Raw-response-sidecar bytes | `8a04b0d99d46565aef9fb156d843e4600b116855ac6093eab2b702eaf573f1e0` |
| FiscalData source receipt | `8fe04a0bfc077eb7ca19ca44ad95437abcff2ec0ac685cdac6615314052c8798` |
| FiscalData-receipt-sidecar bytes | `839755d6a1f6d3feebae08a7261fd5b5104adfc8d029944db70db7460147188e` |

The FiscalData receipt is distinct from the FRED v2 receipt
`f2816de5c736a806268faaeedd3634720038186c4bebf73b37104aecfde9f7ab`.
They must never be conflated.

The official source is the U.S. Department of the Treasury, Bureau of the
Fiscal Service Treasury Securities Auctions Data API. The frozen response has
1,652 complete 13-week bill auctions from 1995-01-03 through 2026-08-24;
1,638 had matured by the fixed cutoff and had exact v2 cash observations at
their actual issue and maturity dates. Actual terms were 90, 91 or 92 days,
and the comparison uses those dates rather than assuming every bill lasts 91
days.

As a positive-cash approximation check, median absolute issue-to-maturity
error was 1.735 basis points, mean absolute error 3.685 basis points, 95th
percentile 16.322 basis points and maximum 34.155 basis points. Pooled
exposure-weighted annualized return was 2.4973% for official auction bills and
2.4718% for v2, a v2-minus-auction difference of -0.0255 percentage points per
year. Thirteen genuine non-overlapping exact-roll chains all had slightly lower
v2 annualized returns, by 0.0021 to 0.0458 percentage points per year.

This corroborates only the reasonableness of v2 as a **positive-cash accrual
proxy** over completed hold-to-maturity windows. It does not make v2 an
official index, validate its daily mark-to-market path or an early sale, prove
historical account access, or validate any borrowing, margin, leverage,
haircut, short-financing or forced-liquidation assumption. The corroboration
cannot satisfy original source/executability gates and cannot turn a proxy
screen into a pass. An independent reviewer rebuilt all 1,638 comparisons and
the v2 cash path and found no material computational, integrity, cutoff,
price-selection, percentile, exact-chain or public-identifier issue. That
clearance is limited to this data-only corroboration: the sources remain
current-vintage and revisable; taxes, fees and operational constraints are not
proved; and the artifacts remain untracked until an authorized commit. It does
not freeze or authorize the v2 model protocol.

## V2 per-market development calendars

The normative protocol states that market calendars are data, not tunable
parameters. The v1 proxy protocol states that strict-common history is only an
inventory check and may not replace each market's own completed-close
calendar. V2 therefore does not force all equity markets to ACWI's 2008 start.

The data-only splitter must reproduce these boundaries before Stage 1:

| Market | Retained data through 2018 | Warm-up | First formation | Entry anchor, no return | First eligible return end |
|---|---|---|---|---|---|
| EWD | 5,737 rows; 1996-03-18 to 2018-12-31 | 1996-04 to 1997-03 | 1997-04 | 1997-05-01 | 1997-05-02 |
| IYY | 4,664 rows; 2000-06-16 to 2018-12-31 | 2000-07 to 2001-06 | 2001-07 | 2001-08-01 | 2001-08-02 |
| IEV | 4,635 rows; 2000-07-28 to 2018-12-31 | 2000-08 to 2001-07 | 2001-08 | 2001-09-04 | 2001-09-05 |
| ACWI | 2,710 rows; 2008-03-28 to 2018-12-31 | 2008-04 to 2009-03 | 2009-04 | 2009-05-01 | 2009-05-04 |

The Stage-1 cash slice must begin on 1996-03-18, end on 2018-12-31 and contain
8,324 rows. Its normalized-row SHA-256 must be
`6fbca98c2cfa7bfd8b47d5417c89684c800dad7ee1b4650234138239dd88d3c8`.

These are data roles only. No candidate target or return has been calculated to
derive them. The close immediately after the first formation month is an entry
anchor and contributes no crossing return; the next close is the first
eligible return endpoint.

## Unchanged model, stages and one-way decisions

The following remain exactly as frozen in the normative base and v1 proxy
protocols:

- completed-month mean squared daily log excess return;
- twelve strictly prior consecutive monthly variances and exclusion of the
  current formation month from the median anchor;
- candidates `IVOL_125`, `IVOL_150`, `IVAR_125`, `IVAR_150` only;
- 0.50 floor, 1.25/1.50 caps, 0.10 no-trade band and desired-target state
  initialized to 1.00;
- first strictly later close execution and no segment-boundary crossing return;
- exact post-cost rebalance algebra, separate risky/cash accrual, borrowing and
  terminal liquidation;
- Primary 20-basis-point one-way cost plus 1.50% borrowing spread;
- Stress 50-basis-point one-way cost plus 3.00% borrowing spread;
- buy-and-hold, constant mean-exposure, exact-grid constant volatility-matched
  and cash comparisons;
- Stage 1 through 2018, sealed Stage 2 during 2019-2022 and sealed Stage 3 from
  2023 through 2026-08-24;
- minimum holdings, all original seven conditions, the separate numerical
  proxy screen, bootstrap and stop rules; and
- prohibition on dashboard, paper or live use.

The development command may open only its physically separated v2 development
input and must run all four candidates. Before Stage 1, the independently
reviewed strict runner requires all applicable frozen protocol, runner and test
bytes to be tracked, committed and clean. Its current-stage reader does **not**
require the development input or sidecar to be committed for Stage 1. Creating
the development artifact still does not authorize Stage 1. If none clears the
numerical proxy screen in all four markets under both scenarios, stop with
`NO_UNIVERSAL_CANDIDATE_PROXY_FALSIFIED`. Validation and evaluation inputs must
not be opened or created.

If a candidate survives Stage 1, the exact development input and sidecar plus
the exact selection receipt must be tracked, committed and clean before Stage
2 may replay Stage 1 or any Stage-2 file is created or opened. Later stages and
the strongest possible terminal label remain exactly as in v1:

```text
ADVANCE_TO_LICENSED_EXECUTABLE_PROSPECTIVE_VALIDATION
```

## Frozen strict-runner identity and endpoint map

The proxy calculation must reuse the independently reviewed strict core
primitives rather than reimplement candidate arithmetic. The accepted exact
identities are:

```text
strict runner, research/universal_volatility_overlay.js:
  22d9cb26505cc62dfd7b27ea94f5ecc295c2d4bcc0e432534d27567464ecfe1b
strict runner tests, test/universal_volatility_overlay.test.js:
  0b6ce991bfe039566c651f3cd7aa32effb43be395eb39d1e6e95d8c02de38aa1
```

Those exact bytes passed 34 of 34 independently reviewed strict-runner tests.
The exact endpoint map enforced by those bytes for this v2 data set is:

| Stage | Cash endpoint | Risky-market endpoint |
|---|---|---|
| Stage 1 development | 2018-12-31 | EWD, IYY, IEV and ACWI: 2018-12-31 |
| Stage 2 sealed validation | 2022-12-31 | CMBITM: 2022-12-31; EWD, IYY, IEV and ACWI: 2022-12-30 |
| Stage 3 sealed evaluation | 2026-08-24 | CMBITM, EWD, IYY, IEV and ACWI: exact pre-frozen common executable close 2026-08-24 |

Only after this document receives its v2 SHA-256 may a versioned
development-only splitter and synthetic tests be completed and hashed. The
next permitted artifact after those are frozen is the physically separate v2
development data file. No validation/evaluation file or strategy outcome may
be opened to finish this pre-outcome chain.
