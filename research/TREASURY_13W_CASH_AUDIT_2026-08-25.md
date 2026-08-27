# Official 13-week Treasury-bill validation of the v2 cash proxy

Status: **data-only positive-cash validation; no market signal, strategy return, or strategy outcome was read or produced.** The fixed source cutoff is 24 August 2026.

## Bottom line

The v2 `DTB3-91D-ACCRUAL-V2` series is well grounded as an **approximation of positive U.S.-dollar cash accrual**, but it is not an official total-return index and is not an exact substitute for buying a Treasury bill.

Across 1,638 matured official 13-week bill auctions from January 1995 through May 2026, the median absolute issue-to-maturity error was 1.735 basis points and the mean absolute error was 3.685 basis points. The 95th percentile was 16.322 basis points and the maximum was 34.155 basis points. The pooled exposure-weighted annualized return was 2.4973% for auction bills and 2.4718% for v2, a v2-minus-auction difference of -0.0255 percentage points per year.

All 1,638 observations also form 13 genuine non-overlapping exact-roll chains, each containing 126 consecutive bills. Across those 13 roughly 31-year chains, v2's annualized return was 0.0021 to 0.0458 percentage points lower than the auction return. Its final wealth was 0.064% to 1.395% lower, with a median shortfall of 0.881%. That is close over the long run, but the quarterly tail errors show why the reconstruction must remain labelled as a proxy.

This finding validates **positive cash only**. It says nothing about borrowing, margin rates, leverage financing, haircuts, short-sale proceeds, forced liquidation, or secondary-market exit prices.

## Frozen official evidence

The source is the U.S. Department of the Treasury, Bureau of the Fiscal Service [Treasury Securities Auctions Data](https://fiscaldata.treasury.gov/datasets/treasury-securities-auctions-data/) API. The exact request selected `Bill`, `13-Week`, and auction dates from 1995-01-01 through 2026-08-24, sorted by auction date and CUSIP in one 10,000-row page.

- Retrieved: `2026-08-25T20:21:13.689Z`
- Complete API rows: 1,652
- Raw response bytes retained locally: 5,470,919
- Raw response SHA-256: `fa267363f210822e6f2c499bf6a2ea6b76d02a32bb80bfc8f921d96cb4e4c16d`
- Source receipt SHA-256: `8fe04a0bfc077eb7ca19ca44ad95437abcff2ec0ac685cdac6615314052c8798`
- Tracked audit result SHA-256: `432ba57be9884d0a5135132004e479f8d2e84b95abbfe7366ef68af2f2e5e84d`

The raw response, its adjacent SHA-256 file, the source receipt, and the receipt sidecar are preserved below the ignored `research/local-artifacts/treasury-13w-cash-audit/` directory. The complete normalized date/price comparisons, aggregate metrics, exclusions, chain results, source identities, and limitations are tracked in [`TREASURY_13W_CASH_AUDIT_2026-08-24.json`](TREASURY_13W_CASH_AUDIT_2026-08-24.json), with its adjacent tracked SHA-256 file. FiscalData's data dictionary notes that CUSIPs are assigned by the CUSIP Service Bureau, operated by Standard & Poor's. The full identifiers are therefore retained only in the ignored raw source; the public tracked derivative intentionally omits the CUSIP list and identifies windows by their official dates.

The API payload reports 200 `Multi-Price` auctions through 26 October 1998 and 1,452 `Single-Price` auctions beginning 2 November 1998. That boundary matches Treasury's official 1999 rule, which says that all marketable Treasury auctions switched on 2 November 1998 and defines a noncompetitive multiple-price bid at the weighted-average accepted competitive yield or discount rate, versus the highest accepted yield or discount rate in a single-price auction ([Treasury final rule, especially pages 1-2](https://www.treasurydirect.gov/files/laws-and-regulations/auction-regulations-uoc/auct-reg-gsr-90125.pdf)). Treasury's current [auction FAQ](https://www.treasurydirect.gov/help-center/auction-faqs/) likewise explains that single-price successful competitive and noncompetitive bidders pay the price based on the highest accepted rate or yield.

## Exact calculation

For each auction:

1. Before 2 November 1998, the noncompetitive purchase price is the API's `avg_med_price`.
2. On and after 2 November 1998, the purchase price is the API's `high_price`.
3. The realized holding-period return is `100 / purchase_price - 1`.
4. Only a bill with `maturity_date <= 2026-08-24` is eligible.
5. The modeled return is `v2 cash level on actual maturity date / v2 cash level on actual issue date - 1`.
6. The signed error is modeled v2 HPR minus official auction HPR.

This reflects the actual economics described by Treasury: bills are bought at or below par, mature at face value, and the difference is interest ([Treasury bill pricing](https://www.treasurydirect.gov/marketable-securities/understanding-pricing/)). It does not impose a synthetic 91-day window. Among the matured observations there are 51 90-day terms, 1,536 91-day terms, and 51 92-day terms. Every one of the 1,638 matured auctions had both exact v2 boundary dates; no interpolation or date filling was used. Fourteen later auctions were excluded only because they had not matured by the fixed cutoff.

The v2 comparator is rebuilt from its exact frozen current-vintage [FRED `DTB3` series](https://fred.stlouisfed.org/series/DTB3), a secondary-market 3-month Treasury-bill rate on a bank-discount basis sourced from the Federal Reserve's [H.15 release](https://www.federalreserve.gov/releases/h15/). It applies the already-frozen v2 rule: each calendar-day accrual interval uses the latest DTB3 observation strictly before the interval start, with a seven-calendar-day maximum age. No v2 strategy file is involved.

## Full-sample error results

| Measure | Result |
|---|---:|
| Comparable matured windows | 1,638 |
| Mean official auction HPR | 0.618307% |
| Mean v2 modeled HPR | 0.612033% |
| Mean signed error | -0.627 bp |
| Median signed error | -0.072 bp |
| Mean absolute error | 3.685 bp |
| Root mean squared error | 6.436 bp |
| Absolute error p50 | 1.735 bp |
| Absolute error p90 | 9.391 bp |
| Absolute error p95 | 16.322 bp |
| Absolute error p99 | 24.872 bp |
| Maximum absolute error | 34.155 bp |
| Pooled official annualized return | 2.497291% |
| Pooled v2 annualized return | 2.471771% |
| Pooled v2 minus official annualized | -0.025521 percentage points |
| Pearson correlation | 0.992938 |

The correlation is included only as a secondary descriptive statistic. The validation conclusion rests on signed error, absolute-error tails, annualized difference, and the non-overlapping cumulative roll paths. The pooled annualized numbers sum log growth across all exact holding windows and divide by summed holding days. Because the weekly auctions overlap, those pooled figures are not a cumulative wealth backtest.

## Valid cumulative comparison

Multiplying all 1,638 weekly auction returns would count the same calendar periods roughly 13 times. The audit therefore constructs maximal paths only when one bill's actual maturity date exactly equals the next bill's actual issue date. This yields 13 paths, covers every matured observation exactly once, and never uses returns to select a path.

The deterministic primary path starts on 5 January 1995 and ends on 28 May 2026. It contains 126 consecutive bills:

| Measure | Official auction bills | v2 cash | v2 minus official |
|---|---:|---:|---:|
| Terminal wealth from 1.0 | 2.171318 | 2.158610 | -0.012708 |
| Annualized return | 2.498852% | 2.479701% | -0.019151 percentage points |
| Relative terminal-wealth difference |  |  | -0.585278% |

Across all 13 exact-roll paths:

| Measure | Minimum | Median | Maximum |
|---|---:|---:|---:|
| v2 minus auction annualized return | -0.045826 pp | -0.028880 pp | -0.002094 pp |
| v2-to-auction terminal-wealth difference | -1.394756% | -0.881288% | -0.064175% |

The paths omit taxes, fees, auction limits, account restrictions, and operational friction. They are an executable-in-principle hold-to-maturity benchmark, not a claim that every investor could transact without those constraints.

## Subperiod stability

| Auction period | Windows | Mean signed error | Absolute p95 | Absolute max | Pooled annualized difference |
|---|---:|---:|---:|---:|---:|
| Multi-price, 1995 to 1998-11-01 | 200 | -1.634 bp | 10.256 bp | 15.165 bp | -0.068122 pp |
| Single-price, 1998-11-02 to 2007 | 479 | -1.259 bp | 20.061 bp | 32.814 bp | -0.051745 pp |
| Single-price, 2008 to 2019 | 626 | -0.609 bp | 8.267 bp | 34.155 bp | -0.024486 pp |
| Single-price, 2020 to 2026-08-24 | 333 | +0.852 bp | 19.236 bp | 32.045 bp | +0.035030 pp |

The bias is small but not constant; it changes sign in the latest subperiod. The largest quarter-window differences occur around rapid rate changes, including 2008 and 2020. That is consistent with the instruments being different: an auction bill locks its issue price until par redemption, while v2 continuously accrues a changing secondary-market DTB3 quote.

## Reliability boundary and known limitations

The evidence supports keeping v2 as a pragmatic positive-cash proxy when an official long-history daily total-return series is unavailable. It does **not** support relabelling v2 as an observed or executable Treasury total-return index.

- FiscalData is current-vintage official data. Treasury may correct historical records later; the local raw bytes and hashes make this run auditable.
- Historical price precision changed. Treasury's [auction timeline](https://www.treasurydirect.gov/research-center/timeline/auctions/) records the September 2004 change from three to six decimal places. Older rounded prices impose a small mechanical error floor.
- DTB3 and the auction bill are not identical: secondary-market bank-discount quote versus a new bill bought at auction and held to par.
- The validation observes only the full holding-period return. It does not validate a daily mark-to-market path or an early sale.
- Weekly windows overlap and are not independent observations.
- Positive Treasury cash return is not a borrowing rate. This audit provides no evidence for margin, leverage, haircut, short-financing, or forced-liquidation assumptions.
- No Kenneth French, VUSXX, ETF, or third-party Fear & Greed file is used.

## Reproduce locally

Audit the immutable local source bytes and verify every pinned hash:

```powershell
node research/treasury_13w_cash_audit.js
```

Run the focused synthetic boundary, price-selection, exact-date, percentile, and non-overlapping-chain tests:

```powershell
node --test test/treasury_13w_cash_audit.test.js
```

`--fetch` is deliberately one-time and refuses to replace an existing source freeze. On a new freeze it stops after writing and summarizing the source bytes; the new hashes must be reviewed and deliberately pinned before the no-argument audit can accept them:

```powershell
node research/treasury_13w_cash_audit.js --fetch
```

The tracked script pins the raw payload, both raw-source sidecars, the source receipt, the v2 manifest, the v2 FRED bytes, the normalized v2 cash rows, and the tracked audit result.
