# Data-source audit for the Fear/Greed backtests

**Audit date:** 2026-08-25  
**Scope:** Current production/research targets, recommended AM12-CASH targets, cash, and the current breadth inputs.  
**Evidence standard:** Fund sponsor, index administrator, U.S. Federal Reserve/Treasury, and Yahoo's own methodology/help pages. Current Yahoo availability dates were independently queried from the Yahoo Finance chart endpoint on the audit date.

## Bottom line

The current data do not support the claim that one model beats five investable total-return markets after costs.

- `SPY` and `ACWI` adjusted close are usable investable USD total-return proxies, but `SPY` represents the S&P 500 rather than the whole U.S. market.
- `^OMXSBGI` is a real SEK gross-return index, but it is neither USD-denominated nor directly investable.
- `^DJUS` and `^STOXX` are price indices in the available Yahoo series. They omit dividends and therefore cannot be used as buy-and-hold total-return comparators.
- The fixed seven-coin basket is a transparent research construction, but it has present-day membership, hindsight/survivorship bias, daily equal-weight rebalancing, and no implementation costs or crypto distributions. It is not an all-crypto market index.
- `CMBITM` is the best identified authoritative broad crypto benchmark, but it is a price-return index, its pre-launch history is backcast/revisable, full history is licensed, and it is not directly investable.
- The current “breadth” inputs are relative-performance/style proxies, not actual constituent breadth measures.

For a defensible experiment, run two separately labelled panels:

1. **Investable equity total-return panel:** `EWD`, `IYY`, `VGK`, `ACWI`, plus a frozen cash construction. This can start on 2008-03-28 on the current Yahoo common calendar.
2. **Multi-asset benchmark panel:** the same four ETFs plus licensed `CMBITM`. This can start no earlier than CMBITM's governing first-value date, 2019-07-01. It must not be described as five investable total-return markets.

## Trust grades

| Grade | Meaning |
|---|---|
| **A** | Real investable instrument; adjusted market-price series can represent total return after fund expenses, subject to the stated data/trading caveats. |
| **B** | Authoritative market index or observable series, but non-investable, wrong currency for the claim, price-return only, backcast, or otherwise not an exact investable total-return target. |
| **C** | Transparent analytical proxy that can be useful if labelled narrowly; it is not the market concept claimed by a broad label. |
| **F for claim** | The series may be real, but using it for the stated total-return, whole-market, point-in-time, or investability claim is invalid. |

Grades are purpose-specific. For example, `^DJUS` is **B** as a U.S. price index but **F for claim** as a total-return buy-and-hold benchmark.

## Current and recommended target series

“First date” below is the earliest daily row returned by Yahoo on 2026-08-25 unless the cell explicitly says it is an official index first-value date. A Yahoo first date is an availability observation, not an authoritative inception guarantee.

| Market / series | Identity and return status | Currency | Point-in-time / survivorship status | First date | Trust and permitted use |
|---|---|---:|---|---:|---|
| **Current USA: `SPY` adjusted close** | State Street SPDR S&P 500 ETF; quarterly distributions; adjusted close is a market-price total-return proxy | USD | Actual surviving fund with evolving index membership; no fixed-constituent look-ahead, but selecting a surviving fund today is still a research-design choice | 1993-01-29; official inception 1993-01-22 | **A** for investable S&P 500 return; **C** if labelled “all U.S. market” |
| **Current/alternative USA: `^DJUS`** | Dow Jones U.S. Index **price-return** series; official family also has `DJUST` total return and `DJUSNTR` net total return | USD index points | Index reconstitution is methodical, but Yahoo is a current-vintage history; official 1991–launch history is pre-launch/hypothetical | 2000-02-14; official first value 1991-12-31 and launch 2000-02-14 | **B** for broad price movement; **F for claim** as total-return buy-and-hold |
| **Recommended USA: `IYY` adjusted close** | iShares Dow Jones U.S. ETF; tracks the Dow Jones U.S. Index and distributes quarterly | USD | Actual fund with evolving benchmark membership; no fixed-constituent look-ahead | 2000-06-16; official inception 2000-06-12 | **A**; preferred exact investable broad-U.S. target |
| **Current Sweden: `^OMXSBGI`** | Nasdaq OMX Stockholm Benchmark **gross-return** index; free-float broad benchmark, revised twice yearly | SEK index points | Genuine reconstituted index, but Yahoo is current-vintage and official historical/corporate-action data require entitlement | 2013-03-05 in Yahoo; official base date 1995-12-30 | **B+** for Swedish local gross market return; **F for claim** as USD, after-cost, directly investable wealth |
| **Recommended Sweden: `EWD` adjusted close** | iShares MSCI Sweden ETF; current MSCI Sweden 25/50 Net benchmark; semiannual distributions | USD | Actual fund. Continuous fund history, but benchmark changed on 2016-12-01 from MSCI Sweden Net to MSCI Sweden 25/50 Net | 1996-03-18; official inception 1996-03-12 | **A**; preferred investable USD Swedish-equity target; disclose benchmark splice and USD/SEK exposure |
| **Current Europe: `^STOXX`** | Yahoo mapping of STOXX Europe 600 `SXXP`, a **price-return** EUR index. Official `SXXR`/`SXXGR` are net/gross return versions | EUR index points | Genuine reconstituted price index, but Yahoo is current-vintage; longer official return-index data are licensed | 2004-04-26 in Yahoo | **B** for European price movement; **F for claim** as total-return buy-and-hold |
| **Recommended Europe: `VGK` adjusted close** | Vanguard FTSE Europe ETF; current FTSE Developed Europe All Cap; quarterly distributions and physical replication | USD | Actual fund. Benchmark splice: MSCI Europe through 2013-03-26, FTSE Developed Europe through 2015-09-30, then FTSE Developed Europe All Cap | 2005-03-10; official inception 2005-03-04 | **A**; preferred broad investable USD European-equity target, with benchmark-splice disclosure |
| **Longer Europe robustness: `IEV` adjusted close** | iShares Europe ETF; current S&P Europe 350 benchmark | USD | Actual fund with evolving benchmark membership | 2000-07-28; official inception 2000-07-25 | **A**, but narrower than VGK; use only as a predeclared longer-history robustness target |
| **Current/recommended Global: `ACWI` adjusted close** | iShares MSCI ACWI ETF; MSCI ACWI Net; large/mid developed and emerging markets, about 85% of the opportunity set; semiannual distributions | USD | Actual fund with evolving benchmark membership; no small caps | 2008-03-28; official inception 2008-03-26 | **A**; preferred longest live broad global ETF target |
| **Broader Global robustness: `SPGM` adjusted close** | State Street SPDR Portfolio MSCI Global Stock Market ETF; MSCI ACWI IMI, about 99% including small caps | USD | Actual fund with evolving benchmark membership | 2012-03-05; official inception 2012-02-27 | **A** and broader than ACWI, but materially shorter; use as robustness rather than the primary history target |
| **Current Crypto: fixed seven-coin synthetic** | Daily equal-weight BTC/ETH/SOL/XRP/ADA/DOGE/BNB price basket; no staking, forks/airdrops, spreads, custody, or rebalancing costs | USD | **Not point-in-time membership**; present-day winners create hindsight and survivorship; daily rebalancing is synthetic | 2020-04-10 common Yahoo date, limited by SOL | **C** only as “these seven coins”; **F for claim** as all-crypto, investable, or after-cost market return |
| **Recommended broad Crypto: `CMBITM`** | Coin Metrics CMBI Total Market, market-cap-weighted broad eligible universe; monthly rebalance and quarterly reconstitution; **price return**, not total return | USD index points | Rules-based constituents, but 2019–launch portion is backcast, current-vintage history is restatable, and it is not a tradable fund | Governing methodology: 2019-07-01 first value; launch 2022-11-22 | **B** as authoritative broad crypto price benchmark; **F for claim** as investable total return |

### Important CMBITM source conflict

The current CMBITM web summary says base date 2019-04-01, while the governing methodology version 1.4, revised 2025-09-18, states first value/base date 2019-07-01. Freeze the methodology PDF and use 2019-07-01 unless Coin Metrics resolves the conflict in writing. The Community API exposes only the prior 30 daily observations; full history requires a Pro/licensed source. Coin Metrics has also published index restatements, including a 2024 correction involving missing SOL data. Therefore CMBITM history must be versioned and hashed.

## Current breadth inputs

These are all real fund prices, but their ratio is not market breadth in the standard constituent sense (advance/decline, percentage above a moving average, or new highs/lows). They are **relative style-performance proxies**.

| Tab / current proxy | What it actually measures | Currency / current Yahoo common start | Point-in-time issue | Grade and label |
|---|---|---|---|---|
| Sweden: `XACT-SMABOLAG.ST / XACT-SVERIGE.ST` | Swedish small-cap ETF performance relative to broad Swedish ETF performance | SEK; 2016-02-09 | Actual evolving funds; fund/index changes and current-vintage Yahoo history still apply | **C**; label “small vs broad relative strength”, not breadth |
| USA: `IWM / SPY` | Russell 2000 small-cap ETF relative to S&P 500 large-cap ETF | USD; 2000-05-26 | Actual evolving funds; it omits mid-cap and is not a constituent participation count | **C**; label “small vs large relative strength” |
| Europe: `EXSE.DE / EXSA.DE` | STOXX Europe Small 200 ETF relative to STOXX Europe 600 ETF | EUR; 2008-01-02 in current Yahoo | Actual funds, but current Yahoo availability begins later than official fund launches | **C**; label “small vs broad relative strength” |
| Global: `WSML.L / IWDA.L` | Developed-world small-cap accumulating ETF relative to developed-world large/mid accumulating ETF | USD London listings; 2018-03-27 | Actual accumulating funds; distributions are retained in NAV/price rather than appearing as Yahoo cash-dividend events | **C**; label “small vs large/mid relative strength”; it excludes emerging markets while `ACWI` includes them |
| Crypto: non-core equal weight / BTC+ETH equal weight | Selected altcoins relative to selected core coins | USD; 2020-04-10 | Same fixed-membership hindsight/survivorship as the seven-coin benchmark, with no executable weighting/cost model | **C** descriptively; **F for claim** as point-in-time market breadth |

A future true-breadth implementation needs point-in-time constituent membership and delisting-complete prices. Without those, a percentage-above-MA or advance/decline series will also be survivorship-biased.

## Yahoo adjusted close: legitimate use and limits

Yahoo states that adjusted close incorporates splits and dividend distributions using split/dividend multipliers based on CRSP standards. It is therefore a legitimate practical **ETF market-price total-return proxy** for `SPY`, `IYY`, `EWD`, `VGK`, `IEV`, `ACWI`, and `SPGM`.

It is not:

- an authoritative fund NAV series;
- an immutable point-in-time database;
- a licence to redistribute an index administrator's history;
- a way to turn price indices such as `^DJUS` or `^STOXX` into total-return indices; or
- proof of returns after bid/ask spread, commission, tax, market impact, or implementation delay.

For ETFs, operating expenses and tracking effects are already embedded in the fund price/NAV. Do not subtract the expense ratio a second time. Separately model trading costs. For accumulating UCITS share classes such as `WSML` and `IWDA`, retained income is embedded in NAV/price even when Yahoo reports no cash-dividend events.

Yahoo histories are current-vintage reconstructions and can be revised as corporate-action data change. A frozen raw Yahoo payload with timestamp and hash makes a research run reproducible, but does not prove that the reconstructed historical value was the value available to an investor on that historical date. Prospective tests must archive and hash close, adjusted close, dividends, splits, metadata, and retrieval time before the lockbox is opened.

### Numerical cross-check against official fund returns

As a current-vintage accuracy check, Yahoo adjusted-close ratios fetched on
2026-08-25 were compared with each iShares page's official **market-price**
returns through 2026-06-30. The 10-year comparison uses 2016-06-30 through
2026-06-30; the calendar-year comparison is 2025. Percentage-point differences
below are absolute values, not relative percentages.

| ETF | 2025 Yahoo | 2025 official | Difference | 10-year Yahoo | 10-year official | Difference |
|---|---:|---:|---:|---:|---:|---:|
| `EWD` | 36.543% | 36.53% | 0.013 pp | 151.251% | 151.42% | 0.169 pp |
| `IYY` | 17.082% | 17.08% | 0.002 pp | 303.116% | 303.32% | 0.204 pp |
| `IEV` | 35.628% | 35.63% | 0.002 pp | 154.209% | 154.67% | 0.461 pp |
| `ACWI` | 22.413% | 22.41% | 0.003 pp | 235.962% | 236.10% | 0.138 pp |

This strongly supports using the current Yahoo adjusted-close histories as
practical ETF market-price total-return proxies for retrospective development.
It does **not** remove the point-in-time revision, licensing, execution-cost or
prospective-lockbox limitations above.

### Structural integrity of the frozen normalized rows

The exact normalized v2 input was also checked row by row on 2026-08-25. This
is a structural sanity check, not an independent price vendor comparison.

| Series | Duplicate dates | Non-finite or non-positive values | Largest calendar gap | Largest absolute daily log-return observations |
|---|---:|---:|---:|---|
| `CMBITM` | 0 | 0 | 1 day | -27.017% on 2020-03-12; +22.176% on 2021-05-24; -19.958% on 2021-05-19 |
| `EWD` | 0 | 0 | 7 days | -14.679% on 2008-10-15; -12.869% on 2020-03-16; -12.860% on 2008-09-29 |
| `IYY` | 0 | 0 | 7 days | -12.905% on 2020-03-16; -10.160% on 2020-03-12; -9.838% on 2008-10-15 |
| `IEV` | 0 | 0 | 7 days | +12.885% on 2008-10-13; +12.200% on 2008-10-28; -12.044% on 2020-03-12 |
| `ACWI` | 0 | 0 | 5 days | -11.896% on 2020-03-16; +11.701% on 2008-10-13; -10.343% on 2020-03-12 |

The seven-day equity gaps are 2001-09-10 to 2001-09-17. NYSE records that the
market reopened on 17 September after the 11 September attacks:
<https://www.nyse.com/history-of-nyse>. ACWI's five-day maximum is 2012-10-26
to 2012-10-31. The SEC records that U.S. equity and option markets were closed
on 29 and 30 October because of Hurricane Sandy:
<https://www.sec.gov/about/offices/ocie/jointobservations-bcps08072013.pdf>.
The observed gaps therefore match documented market closures rather than
silent missing rows. The largest price moves cluster in the 2008 crisis, the
March 2020 shock and well-known crypto stress dates; their presence is not by
itself proof that every historical price is correct, but no mechanical split,
duplicate or non-positive-value anomaly was found in this check.

## Effective history of the current six-component scores

The target instrument can have a long price history while the displayed score
starts much later because all six components and their percentile warm-up must
coexist. The running local API was queried on 2026-08-25; its latest completed
dates and effective score histories were:

| Tab | Current target | First score | Latest score | Score rows | Consequence |
|---|---|---:|---:|---:|---|
| Crypto | fixed seven-coin equal-weight basket | 2020-12-16 | 2026-08-24 | 2,078 | Fewer than six years; only a small number of crypto regimes and inherited survivor bias |
| Sweden | `^OMXSBGI` | 2023-03-20 | 2026-08-25 | 845 | About 3.4 years; excludes both the 2020 crash and most of the 2022 sell-off, so it is inadequate for a serious historical validation |
| USA | `SPY` | 2008-04-07 | 2026-08-25 | 4,626 | The only current score with roughly 18 years and the 2008, 2020 and 2022 stress periods |
| Europe | `^STOXX` | 2011-08-30 | 2026-08-25 | 3,758 | Roughly 15 years, but the target remains a price index that omits dividends |
| Global | `ACWI` | 2018-12-20 | 2026-08-25 | 1,929 | Under eight years; contains 2020 and 2022 but few independent regimes |

These dates show why merely backtesting the current six-component score harder
cannot create reliable evidence across all tabs. In particular, Sweden is
constrained by short-lived component funds, not by the official benchmark's
underlying 1995 base date.

## Cash series for AM12-CASH

### Preferred licensed validation series

The authoritative total-return comparator is the **S&P U.S. Treasury Current 3-Month Bill Index**, ticker `SPBDU3TT`. S&P states that it is a total-return index holding the current three-month U.S. Treasury bill. It has a first value of 1992-12-31 and was launched on 2019-11-05, so its pre-launch history is back-tested and full data are licensed.

### Free reproducible construction

Use a frozen series named **`DTB3-91D-ACCRUAL`**, based on the Federal Reserve H.15/FRED `DTB3` daily three-month Treasury bill secondary-market **discount rate**. `DTB3` begins 1954-01-04.

At a signal/trade date, use only the last observation published before the trade. Forward-fill weekends/holidays only after publication. With `d = DTB3 / 100` and `n = 91` calendar days:

```text
P = 100 * (1 - d * n / 360)
G = 100 / P
interval cash factor = G ^ (delta_calendar_days / n)
```

This follows TreasuryDirect's bank-discount price convention and preserves the quoted bill's maturity factor. It is a transparent continuously rolled accrual proxy, not an observed mark-to-market total-return index. Validate it against `SPBDU3TT` over the licensed overlap. Do not compound `DTB3` directly as though it were an investment-basis or effective annual yield. `DGS3MO` is also a yield—not a return index—and is interpolated on an investment basis.

## Recommended panels and honest history

### Panel A — investable equity total return

| Market | Primary target | Robustness target |
|---|---|---|
| Sweden | `EWD` | `^OMXSBGI` only as a local-currency diagnostic, never as the wealth comparator |
| USA | `IYY` | `SPY` to show whether results depend on broad-market versus large-cap exposure |
| Europe | `VGK` | `IEV` for longer but narrower history |
| Global | `ACWI` | `SPGM` for small-cap-inclusive breadth |
| Cash | `DTB3-91D-ACCRUAL` | licensed `SPBDU3TT` validation |

On current Yahoo availability, the four primary equity targets share a common start of **2008-03-28**. A 12-month absolute-momentum feature makes the first properly lagged month-end signal approximately March 2009 and the first subsequent held month approximately April 2009. Use the actual next-tradable common calendar in code rather than assuming those dates.

This panel can support a statement about four investable equity ETFs in USD, after the preregistered trading cost, but not about independent markets: `ACWI` overlaps the regional funds and the series are correlated.

### Panel B — all-market benchmark, not five investable total-return markets

Use `EWD`, `IYY`, `VGK`, `ACWI`, licensed/frozen `CMBITM`, and the same cash construction. The common start can be no earlier than **2019-07-01**, with the first AM12 signal around July 2020. The exact first observation must be verified in the licensed CMBITM delivery.

Permitted claim: performance against four investable ETF total-return targets and one authoritative broad crypto **price index**, with separate costs/limitations.

Prohibited claim: one model beats five investable total-return markets after costs.

The current fixed seven-coin substitute moves the common start to 2020-04-10 and the first AM12 signal to roughly April/May 2021, but it does not cure the identity, survivorship, or investability defect and should not be a confirmatory target.

## Is more history needed?

**Yes for a reliable five-market claim; not because older data alone can erase prior model selection.**

- The equity-only panel has roughly 17 years before the audit date and is adequate for exploratory rolling out-of-sample work across several equity regimes. It is still not an untouched final test because the project has repeatedly inspected much of this history in v1–v3/MA10 work.
- CMBITM offers only about seven years from its official first value, of which more than three years precede launch and are backcast. After a 12-month feature lookback, the effective monthly sample is small and covers few independent crypto cycles.
- Adding older BTC alone or today's seven winners does not create older broad-crypto market history. It changes the target and introduces survivorship.
- Licensed index history can improve measurement and sample size, but any pre-launch/backtested portion must be labelled. It cannot become an “as known then” lockbox merely by being downloaded now.
- A final confirmatory result now requires a prospectively archived lockbox. A practical minimum is **60 new monthly forecasts per market**, with the model, costs, data-vintage rules, exclusions, and family-wise gate frozen before collection. Report earlier history as development/retrospective evidence only.

### Longer crypto alternatives audited but not added to v2

The following official alternatives were checked before any universal-volatility
outcome was opened. None is silently spliced into CMBITM and none replaces it in
the v2 primary panel.

- **CCi30** publishes daily price-index closes from 2015-01-01 and went live on
  2017-01-01. It would add substantial 2016–2018 sensitivity history after the
  twelve-month warm-up. Direct structural checks found 4,254 positive daily
  rows with no duplicate date or calendar gap, but volume is zero on 1,160
  early rows. Its official monthly weight file also contains two apparent
  breaches of the stated 30-name construction: 2020-03-01 and 2020-07-01 each
  contain 31 distinct names and total approximately 101.12% and 101.11%.
  Published index-page and methodology wording also differ about committee
  discretion, and the published CC BY-NC-ND terms do not establish safe public
  redistribution or derived-strategy use for this GitHub project. It is
  therefore lower-confidence, local-only falsification data unless permission
  is clarified, not a positive-proof benchmark. Official sources:
  <https://cci30.com/index-data/> and
  <https://cci30.com/wp-content/uploads/2021/11/CCi30-Cryptocurrency-Index-Methodology-Manual.pdf>.
- **CMBI10** is a Coin Metrics top-ten price index beginning 2017-01-03. It
  provides only about ten eligible Stage-1 months after warm-up, is a
  same-provider backcast rather than independent confirmation, and the public
  history checked on 2026-08-25 omitted the 2022-11-10 close. Coin Metrics has
  also documented a historical CMBI10/CMBITM restatement caused by missing SOL
  data. It is useful only as a separately frozen large-cap sensitivity series:
  <https://indexes.coinmetrics.io/cmbi10> and
  <https://coinmetrics.io/wp-content/uploads/2024/08/Restatment-of-Indexes-8.20.24.pdf>.
- **21Shares HODL** is an actual physically backed top-five basket ETP with NAV
  history from 2018-11-20. It is the strongest execution-reality check found,
  but it is too short to add Stage-1 evidence after warm-up, is not the total
  crypto market, and its fee/rebalancing/index rules changed historically:
  <https://www.21shares.com/en-uk/product/hodl>.

The v2 decision is therefore conservative: keep CMBITM as the broad primary
benchmark, do not manufacture older “all crypto” history from a splice, and do
not add the alternatives until a separate versioned protocol, exact data freeze
and applicable reuse rights exist. Older data can add falsification power, but
these sources cannot turn a retrospective pass into point-in-time or executable
confirmation.

## Hard blockers

1. There is no identified broad, directly investable USD crypto total-return vehicle with CMBITM-like point-in-time coverage back to 2019.
2. Full CMBITM history and the official equity return-index histories require licences/entitlements.
3. Current Yahoo downloads are current-vintage retrospective reconstructions, not an as-known-then database.
4. The available historical periods have already influenced model work, so no relabelling of old dates can create an untouched lockbox.
5. The current breadth ratios do not measure constituent participation and must not be described as true market breadth.

## Primary sources

### Funds and indices

- State Street, SPY: <https://www.ssga.com/us/en/individual/etfs/state-street-spdr-sp-500-etf-trust-spy>
- S&P Dow Jones Indices, Dow Jones U.S. Index: <https://www.spglobal.com/spdji/en/indices/equity/dow-jones-us-index/>
- iShares, IYY: <https://www.ishares.com/us/products/239513/ishares-dow-jones-us-etf>
- Nasdaq, OMX Stockholm Benchmark Gross Index: <https://indexes.nasdaq.com/Index/Overview/OMXSBGI>
- iShares, EWD: <https://www.ishares.com/us/products/239684/EWD>
- STOXX, STOXX Europe 600: <https://www.stoxx.com/index-details.html?symbol=SXXP>
- Vanguard, VGK fact sheet: <https://fund-docs.vanguard.com/F0963.pdf>
- iShares, IEV: <https://www.ishares.com/us/products/239736/ishares-europe-etf>
- iShares, ACWI: <https://www.ishares.com/us/products/239600/ishares-msci-acwi-etf>
- MSCI, MSCI ACWI: <https://www.msci.com/indexes/index/892400/msci-acwi-index>
- State Street, SPGM: <https://www.ssga.com/us/en/individual/etfs/state-street-spdr-portfolio-msci-global-stock-market-etf-spgm>
- Coin Metrics, CMBITM summary: <https://indexes.coinmetrics.io/cmbitm>
- Coin Metrics, CMBI Total Market Series Methodology v1.4: <https://files.gitbook.com/v0/b/gitbook-x-prod.appspot.com/o/spaces%2F-MO23j33wWGzm0NrZseN%2Fuploads%2FXufzMuLtZDcNdnscsYyJ%2FCMBI%20Total%20Market%20Series%20Methodology%20v1.4.pdf?alt=media&token=2f910357-87f9-4f83-adae-2fb885f5a00e>
- Coin Metrics, Index Levels API: <https://docs.coinmetrics.io/indexes-timeseries/index-levels>
- Coin Metrics, 2024 index restatement: <https://coinmetrics.io/wp-content/uploads/2024/08/Restatment-of-Indexes-8.20.24.pdf>

### Breadth-proxy funds

- XACT product catalogue, including XACT Svenska Småbolag and XACT Sverige: <https://www.xact.se/sv/Products>
- iShares, IWM: <https://www.ishares.com/us/products/239710/ishares-russell-2000-etf>
- iShares, EXSE: <https://www.ishares.com/de/privatanleger/de/produkte/251972/ishares-stoxx-europe-small-200-ucits-etf-de-fund?siteEntryPassthrough=true&switchLocale=y>
- iShares, EXSA: <https://www.ishares.com/de/privatanleger/de/produkte/251931/ishares-stoxx-europe-600-ucits-etf-de-fund?siteEntryPassthrough=true&switchLocale=y>
- iShares, WSML: <https://www.ishares.com/uk/individual/en/products/296576/ishares-msci-world-small-cap-ucits-etf-usd-%28acc%29-fund>
- iShares, IWDA: <https://www.ishares.com/uk/individual/en/products/251882/ishares-core-msci-world-ucits-etf>

### Adjusted close and cash

- Yahoo Finance, adjusted-close methodology: <https://help.yahoo.com/kb/SLN28256.html>
- Yahoo Finance, historical-data availability/licensing caveats: <https://ca.help.yahoo.com/kb/finance/historical-prices-adjusted-close-sln2311.html>
- Federal Reserve H.15/FRED, `DTB3`: <https://fred.stlouisfed.org/series/DTB3>
- Federal Reserve H.15/FRED, `DGS3MO`: <https://fred.stlouisfed.org/series/DGS3MO>
- TreasuryDirect, Treasury bill pricing convention: <https://www.treasurydirect.gov/marketable-securities/understanding-pricing/>
- S&P Dow Jones Indices, Current 3-Month U.S. Treasury Bill Total Return Index: <https://www.spglobal.com/spdji/en/indices/fixed-income/sp-us-treasury-current-3-month-bill-index/>
