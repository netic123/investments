# Equity rotation panel: source and data audit

Audit date: 25 August 2026  
Research cutoff: completed closes through 24 August 2026  
Status: **proxy data accepted for retrospective falsification only; not an
authoritative or point-in-time confirmation dataset**

## What was actually fetched

| Series | Provider rows | Provider range | Yahoo identity check | Raw-response SHA-256 |
|---|---:|---|---|---|
| EWD | 7,658 | 1996-03-18 to 2026-08-24 | ETF, USD, America/New_York | `0127d2948dfe4a79753c9b5280a390d25e9d13f6dd27fb5f444cde16791eed2b` |
| IYY | 6,585 | 2000-06-16 to 2026-08-24 | ETF, USD, America/New_York | `0c881ef398ac8f34fda4976063fd912a60b3ea073f3fe1125fa768686555ad92` |
| IEV | 6,556 | 2000-07-28 to 2026-08-24 | ETF, USD, America/New_York | `1cd419d89766efbaca5b903523cd80b38f5e4c57a1ef50ed26804875dbd4950f` |
| ACWI | 4,631 | 2008-03-28 to 2026-08-24 | ETF, USD, America/New_York | `94a61e38d1fcb1ee44d0870452d3f4cebfb014cc9b90cff9453cc6f732557761` |
| FRED DTB3 | 4,863 non-missing observations | 2008-01-02 to 2026-08-21 | Percent, bank-discount basis | `0907b7c8ae0d047ff73ac231601b8d12e43f8e34cf42587c1bf9873f4aeb8bb4` |

The strict intersection is 4,631 U.S. trading closes from 28 March 2008 to
24 August 2026, or 18.41 years. The current 25 August UTC date was excluded.
No ETF close was forward-filled. DTB3 was accrued only from the latest
non-missing observation at or before each day, with a maximum seven-day age.

## Primary-source identity checks

- [EWD official iShares page](https://www.ishares.com/us/products/239684/ishares-msci-sweden-etf): iShares MSCI Sweden ETF, official inception
  12 March 1996, benchmark MSCI Sweden 25/50 Index.
- [IYY official iShares page](https://www.ishares.com/us/products/239513/ishares-dow-jones-us-etf): iShares Dow Jones U.S. ETF, official inception
  12 June 2000, benchmark Dow Jones U.S. Index.
- [IEV official iShares page](https://www.ishares.com/us/products/239736/ishares-europe-etf): iShares Europe ETF, official inception 25 July 2000,
  benchmark S&P Europe 350 Index (Net).
- [ACWI official iShares page](https://www.ishares.com/us/products/239600/ishares-msci-acwi-etf): iShares MSCI ACWI ETF, official inception
  26 March 2008, benchmark MSCI All Country World Index (Net).
- [Yahoo's adjusted-close definition](https://help.yahoo.com/kb/SLN28256.html)
  states that adjusted close includes applicable split and dividend-
  distribution adjustments.
- [FRED DTB3](https://fred.stlouisfed.org/series/DTB3) identifies the input as
  the Federal Reserve Board's daily 3-Month Treasury Bill Secondary Market
  Rate on a discount basis. It is a yield, not a total-return series.

## Independent 10-year return spot check

To check that the downloaded adjusted closes reflect the intended ETF market
returns, the Yahoo ratio from 30 June 2016 through 30 June 2026 was compared
with each issuer page's official `Market Price (%)` return as of 30 June 2026.
No number in this check was used by the trading rule.

| ETF | Yahoo cumulative | iShares cumulative | Difference | Yahoo annualized | iShares annualized | Annualized difference |
|---|---:|---:|---:|---:|---:|---:|
| EWD | 151.2508% | 151.42% | -0.1692 pp | 9.6505% | 9.66% | -0.95 bp |
| IYY | 303.1165% | 303.32% | -0.2035 pp | 14.9590% | 14.96% | -0.10 bp |
| IEV | 154.2088% | 154.67% | -0.4612 pp | 9.7789% | 9.80% | -2.11 bp |
| ACWI | 235.9617% | 236.10% | -0.1383 pp | 12.8831% | 12.89% | -0.69 bp |

All four annualized differences are within 2.11 basis points. That is strong
evidence that the chosen Yahoo fields and symbols reproduce the issuer's
rounded ten-year market-price returns. It does **not** prove every historical
daily observation, nor does it turn Yahoo into an authoritative point-in-time
index source.

## Reliability verdict

The equity proxies are sufficiently reality-aligned for this negative
falsification run because identity, currency, date coverage and a ten-year
return endpoint all agree closely with the issuer. The result is also very far
from the benchmarks, so rounding-sized source differences cannot reverse it.

The weak link is cash: DTB3 itself is an official observed yield, but the
91-day rolling wealth series is reconstructed. It assumes frictionless rolling
and does not model bid/ask spread, taxes or reinvestment timing. Since both
rotation variants underperform the risky benchmarks by several percentage
points of CAGR, replacing this cash approximation with a licensed T-bill
total-return index is unlikely to rescue this exact rule, but that statement is
an inference, not a measured sensitivity result.

Additional historical data are useful, but not by backcasting today's crypto
constituents. The honest validation design is two panels: this 18.4-year equity
panel and a shorter broad-crypto panel beginning only when a point-in-time,
rules-based crypto index is genuinely available. Future observations should be
stored append-only with retrieval time and payload/content hashes.

## Reproducibility

- Protocol: `research/EQUITY_ROTATION_FALSIFICATION_PROTOCOL.md`
- Runner: `research/equity_rotation_panel.js`
- Frozen derived input (gitignored local artifact):
  `research/local-artifacts/equity-rotation-panel/input-2026-08-24.json`
- Result: `research/EQUITY_ROTATION_PANEL_RESULT_2026-08-24.json`
- Result SHA-256:
  `8cf40a2dd727dbda46412b9f6498e1795608044b3e4090a9758b62670d87d06f`

An independent input replay produced the identical result SHA-256.
