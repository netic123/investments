INVESTMENTS
===========

Start:   double-click start.bat  -> the browser opens http://127.0.0.1:8765
Stop:    close the black window (or Ctrl+C in it)

Requires Node.js 18+. No other dependencies, no installation.

GITHUB PAGES
Public site: https://netic123.github.io/investments/

Every push to main — including a merged pull request — runs .github/workflows/pages.yml. The workflow starts
the local server temporarily on the GitHub runner, fetches and validates the seven public API responses, and
publishes only _site/index.html, _site/.nojekyll and _site/api/*.json. GitHub Pages is static: it does not keep server.js
running. The public values therefore reflect the timestamp shown in the page header and change on the next
successful main deployment. "Reload snapshot" only checks whether that newer deployment is available.

The Pages build is deliberately forced to data/positions.example.json and visibly labels it DEMO. It never
publishes the gitignored data/positions.local.json or data/portfolio.local.json, even when the build script is
run on a computer where those files exist. No API key or GitHub secret is supplied to the snapshot server.
The generated _site directory is ignored by Git and is an explicit allowlist; research files, backend code,
configuration files and repository metadata are not included in the deployed artifact.

YOUR FOCUSED WATCHLIST
Copy data/positions.example.json to data/positions.local.json and enter display ticker, exact WAGN ticker
(fundTicker, when different), Yahoo symbol, entry price and currency. That file is gitignored and is never
committed, so the repo can be shared without revealing what you follow. If it is missing the app visibly
labels the fallback list as DEMO instead of presenting the examples as your holdings. GitHub Pages always
uses that DEMO list; the private local list is only available from the local server.

TABS (top of the page)
- Pabrai  = the default tab: what Mohnish Pabrai is doing, for the positions you follow yourself:
  - Your focused stocks (from data/positions.local.json): WAGN's latest daily quantity change, Dalal
    Street's quarterly 13F position/change, price now (Yahoo) vs your entry, SEK price and next report
  - Every net quantity change in the ETF between the two latest saved files, plus the full log
  - The whole ETF portfolio sorted by weight, with Avanza status (online / by phone / not available)
  - Fund performance vs S&P 500 and the NAV curve
  - Dalal Street's manager-aggregated 13F — static, delayed and updated by hand after each quarter
  - Upcoming dates
  Open directly: / or /#pabrai
- Crypto  = Crypto Risk Appetite, OWN PRICE-BASED MODEL v1 (0-100): five equally weighted indicators from
            completed UTC daily closes for a frozen seven-asset basket. Bitcoin trend (vs 200-day average),
            strength (distance from 365-day high), volatility shock (30-day realised volatility vs its 90-day
            average, inverted), breadth (share of the basket above its 200-day average), and altcoin appetite
            (median 30-day alt return minus BTC). Each raw indicator is ranked only against its own previous
            365 observations; all five indicators and all seven assets are required. The tab exposes every raw
            value, score, formula, symbol and caveat. Open directly: /#crypto
- Sweden, USA, Europe, Global = Fear & Greed for the equity markets, OWN MODEL (no published index with
            open data exists for these — the US CNN index only has an unofficial feed whose terms forbid
            automated access). Six indicators from Yahoo Finance daily data, CNN-inspired: momentum (index vs
            125-day average), strength (distance from 52-week high), volatility (VIX where it exists, else
            realised 20-day), safe-haven demand (stocks vs government bonds, 20 days), credit appetite (high
            yield vs investment grade), breadth (small caps vs large caps). Each indicator = percentile within
            the last 252 trading days (0–100); the index = the mean. Labels as CNN: 0–24 extreme fear, 25–44
            fear, 45–55 neutral, 56–74 greed, 75–100 extreme greed. The tab shows every indicator's value
            and score. Open directly: /#sweden /#usa /#europe /#global

HOW IT WORKS
- The fund's own daily holdings file is fetched every 5 minutes (the page refreshes every 10).
- Every new file day is saved as a snapshot in data/snapshots.json. Changes = the difference in NUMBER OF
  SHARES between two snapshots. Weight in percent moves with prices and means nothing.
- If Investments is not run every weekday, several days' net quantity changes are merged under "Changes".
  They are not proof of exact execution dates/prices; the heading says when the interval spans several days.
- The fund's file is dated one trading day AFTER the prices in it (T+1).
- Weekends/evenings: the card shows "Last close" with a timestamp, not "Price now".
- Locally, the Update button re-fetches EVERYTHING: fund files, Yahoo quotes, the seven fixed crypto series
  and all 23 Yahoo series behind the equity indices (it takes a few seconds; the status line shows progress
  and the time with seconds, and every source shows when it was fetched). The automatic 10-minute refresh is
  gentler: it reuses daily series that are less than 15 minutes old. The crypto model admits only the previous
  completed UTC day, while equity data changes once per trading day — so identical numbers after an Update are
  normal until another daily bar is complete. On GitHub
  Pages, Reload snapshot re-downloads the most recently deployed JSON; upstream sources are fetched by the
  workflow, not by the visitor's browser.
- The crypto SCORE is computed locally in cryptofg.js. Yahoo Finance supplies raw price history only; no
  third-party sentiment score, proprietary weighting or API key enters the calculation. Yahoo's chart feed
  does not have a contractual public API/SLA, so availability and historical revision remain real limitations.
- The market indices are computed in marketfg.js from each series' FULL dividend-adjusted daily history on
  Yahoo (23 series, ~9 MB per cold fetch, cached 15 minutes, one shared 25 s deadline). The charts go back as
  far as at least 3 of the 6 indicators exist: USA to 1994, Europe to 2005, Global to 2009, Sweden to 2014;
  all six exist from 2008 / 2011 / 2018 / 2023 (the chart says so for the earlier stretch). During trading
  hours today's point is a live value that can change until the close. The NAV chart covers the fund's whole
  life (since 29 Sep 2023; price only, distributions excluded).
- While the server runs it also captures the fund's holdings file every 30 minutes on its own, so a file
  day is not missed when the page is closed (a missed day merges multiple days into one net quantity change).

SOURCES AND HOW THEY WERE VERIFIED (24 Aug 2026)
- Fund holdings / NAV / performance: the fund's own files on wagonsetf.filepoint.live — verified to be the
  exact files wagonsetf.com loads (its page embeds that site). Rounded NAV × shares matches the holdings-file
  net-assets convention within 0.001% of the daily NAV file; market price matches Nasdaq and performance
  matches the fund's published table.
  The holdings file is dated T+1: "dated 24 Aug" means priced at the 21 Aug close (the page says so).
- Quotes (your tickers + the ETF's): Yahoo Finance, verified to the cent against Nasdaq's and TSX's own quote
  services. FX (USD/SEK, CAD/SEK): Yahoo's last tick; differs from the ECB/Riksbank daily fix by ~0.1 %.
  The rate and its time are shown under "Price in SEK".
- Dalal Street: SEC EDGAR 13F-HR (accession in config.json, linked from the page). Shares and values are
  typed from the filing; weights and quarter changes are computed from them, so nothing is rounded by hand.
- Crypto Risk Appetite (own model): all seven configured Yahoo chart histories returned HTTP 200 on 24 Aug
  2026. Completed daily history began 17 Sep 2014 for BTC, 9 Nov 2017 for ETH/XRP/ADA/DOGE/BNB and 10 Apr
  2020 for SOL; every latest completed date was 23 Aug 2026. The score, component ranks and history are
  recomputed by cryptofg.js. Known caveats: fixed present-day basket (selection/survivorship bias), equal rather
  than market-cap weights, BTC-heavy inputs, no derivatives/funding/search/social/news data, heuristic windows
  and category boundaries, and an undocumented Yahoo chart endpoint. It is a descriptive relative price regime,
  not a direct emotion reading or a proven predictor.
- Market Fear & Greed (own model): the 23 Yahoo series were checked for identity (ISIN/name), freshness and
  gaps; 20 of 23 closes were verified to the cent against Nasdaq, Cboe/FRED, Avanza, Carnegie, stoxx.com,
  Xetra and LSE. Model validation: the US version was compared ONCE with CNN's published index (a one-off
  manual check, not a feed): correlation 0.88 over 398 trading days, mean gap 8.9 points, ours on average
  6 points greedier, same label 56 % of days, within one band 93 %. The remaining gap is CNN's put/call and
  NYSE breadth inputs, which have no open data source. Known caveats: OMXSBGI is total return but STOXX 600
  is a price index (slight spring-dividend bias for Europe); Sweden/Europe use realised volatility because
  no matching implied series is configured (Europe does have VSTOXX for Euro STOXX 50 options, but this
  model applies backward-looking realised volatility to STOXX Europe 600); the global credit ETFs
  (HYLD.L/CORP.L) are thinly traded, so that indicator is noisier.
- Event dates: six confirmed by primary sources (Kaspi EGM/record date, TCMB, Pareto, WAGN call, 13F rule,
  RIG/VAL filings). Q3 report dates are NOT announced yet — they are expectations from last year's cadence,
  marked "~" / "expected" on the page; re-check the companies' IR pages in mid-October.

UPDATE BY HAND
- data/positions.local.json: focus tickers, exact WAGN/Yahoo symbol, entry price/currency and estimated or
  confirmed next report date (restart after editing; Update does not reload this file)
- dalalStreet: the manager-aggregated 13F (next filing due by 16 Nov 2026)
- dates: upcoming events (the list empties itself when dates have passed)
- names: name, flag, Avanza status per ticker (online / telefon / nej)
- cryptoFearGreed: the frozen v1 basket and all five model windows. Changing any of these changes the model;
  increment version instead of silently rewriting v1 history, then restart and rerun the backtest.
- marketFearGreed: Yahoo symbols per market (index, vol, bond, hy, ig, small, large). If a series fails,
  that indicator is omitted (the index becomes the mean of those available, at least 3). Change a symbol
  here, then restart.

IF SOMETHING GOES WRONG
- "holdings file could not be fetched" = the fund's server did not respond; the page shows the last saved file.
- "quote missing: ..." = Yahoo did not respond for that ticker; the rest works.
- "Fear & Greed crypto could not be fetched" = at least one member of the frozen seven-asset price basket
  could not be loaded at startup. After a successful load, the last in-memory series may be reused with an
  explicit fallback warning; no third-party sentiment index is substituted.
- "Fear & Greed <market> could not be computed" / "index series ... missing" = Yahoo did not respond and the
  series has not been fetched since start. If a series was fetched earlier, the last successful one is reused
  (no time limit) until Yahoo responds again; the tab then shows a warning with Yahoo's error message and the
  indicator is marked "fallback data".
- If snapshots.json breaks, a copy is saved (snapshots.json.broken-<time>) and the history starts over.

Not investment advice.

LICENSE
MIT (see LICENSE). The code is yours to use; the market data belongs to its respective sources
(the fund, Yahoo Finance and SEC EDGAR) and their terms apply to the data, not to this code.
