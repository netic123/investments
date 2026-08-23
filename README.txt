INVESTMENTS
===========

Start:   double-click start.bat  -> the browser opens http://127.0.0.1:8765
Stop:    close the black window (or Ctrl+C in it)

Requires Node.js 18+. No other dependencies, no installation.

YOUR OWN HOLDINGS
Copy data/positions.example.json to data/positions.local.json and enter your tickers, Yahoo symbols and
entry prices. That file is gitignored and is never committed, so the repo can be shared without revealing
what you own. If it is missing the app falls back to the example file and still starts.

TABS (top of the page)
- Pabrai  = what Mohnish Pabrai is doing, for the positions you follow yourself:
  - Your own stocks (from data/positions.local.json): what Pabrai did in them since the previous
    file, price now (Yahoo) vs your entry price, in SEK, next report date
  - Every buy/sell in the ETF between the two latest saved files, plus the full log
  - The whole ETF portfolio sorted by weight, with Avanza status (online / by phone / not available)
  - Fund performance vs S&P 500 and the NAV curve
  - The private fund (13F) — static, updated by hand after each quarter
  - Upcoming dates
- Crypto  = CoinMarketCap's Crypto Fear & Greed Index (0-100): gauge, yesterday/last week/last month/
            yearly high-low, chart controls from 30 days through 5 and 10 years to Max (CMC's whole series,
            currently from 29 Jun 2023), how the index is
            computed. Open directly: /#crypto
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
- If Investments is not run every weekday, several days' trades are merged under "Changes". The heading
  says so when that is the case.
- The fund's file is dated one trading day AFTER the prices in it (T+1).
- Weekends/evenings: the card shows "Last close" with a timestamp, not "Price now".
- The Update button re-fetches EVERYTHING: fund files, Yahoo quotes, CoinMarketCap and all 23 Yahoo series
  behind the market indices (it takes a few seconds; the status line shows progress and the time with
  seconds, and every source shows when it was fetched). The automatic 10-minute refresh is gentler: it
  reuses Yahoo series that are less than 15 minutes old. CoinMarketCap is never asked more than once per
  10 seconds; its live value only changes every 15 minutes anyway, and the daily market data only changes
  once per trading day — so identical numbers after an Update are normal outside trading hours.
- The crypto index comes from CoinMarketCap's official API without a key. To use your own (free) key: set
  the environment variable CMC_API_KEY before starting.
- The market indices are computed in marketfg.js from each series' FULL dividend-adjusted daily history on
  Yahoo (23 series, ~9 MB per cold fetch, cached 15 minutes, one shared 25 s deadline). The charts go back as
  far as at least 3 of the 6 indicators exist: USA to 1994, Europe to 2005, Global to 2009, Sweden to 2014;
  all six exist from 2008 / 2011 / 2018 / 2023 (the chart says so for the earlier stretch). During trading
  hours today's point is a live value that can change until the close. The NAV chart covers the fund's whole
  life (since 29 Sep 2023; price only, distributions excluded).
- While the server runs it also captures the fund's holdings file every 30 minutes on its own, so a file
  day is not missed when the page is closed (a missed day merges two days' trades under "Changes").

SOURCES AND HOW THEY WERE VERIFIED (23 Aug 2026)
- Fund holdings / NAV / performance: the fund's own files on wagonsetf.filepoint.live — verified to be the
  exact files wagonsetf.com loads (its page embeds that site). NAV x shares = net assets to the cent; the
  market price matches Yahoo and Nasdaq; the performance table matches the fund's investor presentation.
  The holdings file is dated T+1: "dated 24 Aug" means priced at the 21 Aug close (the page says so).
- Quotes (your tickers + the ETF's): Yahoo Finance, verified to the cent against Nasdaq's and TSX's own quote
  services. FX (USD/SEK, CAD/SEK): Yahoo's last tick; differs from the ECB/Riksbank daily fix by ~0.1 %.
  The rate and its time are shown under "Price in SEK".
- Private fund: SEC EDGAR 13F-HR (accession in config.json, linked from the page). Shares and values are
  typed from the filing; weights and quarter changes are computed from them, so nothing is rounded by hand.
- Crypto Fear & Greed: CoinMarketCap's official API; identical to CMC's own page (value, time, 365-day
  history) at verification.
- Market Fear & Greed (own model): the 23 Yahoo series were checked for identity (ISIN/name), freshness and
  gaps; 20 of 23 closes were verified to the cent against Nasdaq, Cboe/FRED, Avanza, Carnegie, stoxx.com,
  Xetra and LSE. Model validation: the US version was compared ONCE with CNN's published index (a one-off
  manual check, not a feed): correlation 0.88 over 398 trading days, mean gap 8.9 points, ours on average
  6 points greedier, same label 56 % of days, within one band 93 %. The remaining gap is CNN's put/call and
  NYSE breadth inputs, which have no open data source. Known caveats: OMXSBGI is total return but STOXX 600
  is a price index (slight spring-dividend bias for Europe); Sweden/Europe use realised volatility (no VIX
  equivalent exists); the global credit ETFs (HYLD.L/CORP.L) are thinly traded, so that indicator is noisier.
- Event dates: six confirmed by primary sources (Kaspi EGM/record date, TCMB, Pareto, WAGN call, 13F rule,
  RIG/VAL filings). Q3 report dates are NOT announced yet — they are expectations from last year's cadence,
  marked "~" / "expected" on the page; re-check the companies' IR pages in mid-October.

UPDATE BY HAND (data/config.json)
- myPositions: your entry prices, Yahoo ticker, next report date
- dalalStreet: the private fund's 13F (next expected 13-16 Nov 2026)
- dates: upcoming events (the list empties itself when dates have passed)
- names: name, flag, Avanza status per ticker (online / telefon / nej)
- marketFearGreed: Yahoo symbols per market (index, vol, bond, hy, ig, small, large). If a series fails,
  that indicator is omitted (the index becomes the mean of those available, at least 3). Change a symbol
  here, then restart.

IF SOMETHING GOES WRONG
- "holdings file could not be fetched" = the fund's server did not respond; the page shows the last saved file.
- "quote missing: ..." = Yahoo did not respond for that ticker; the rest works.
- "Fear & Greed crypto could not be fetched" = CoinMarketCap did not respond or the rate limit is hit. If a
  previously fetched value exists it is shown with a warning until the next successful fetch.
- "Fear & Greed <market> could not be computed" / "index series ... missing" = Yahoo did not respond and the
  series has not been fetched since start. If a series was fetched earlier, the last successful one is reused
  (no time limit) until Yahoo responds again; the tab then shows a warning with Yahoo's error message and the
  indicator is marked "fallback data".
- If snapshots.json breaks, a copy is saved (snapshots.json.broken-<time>) and the history starts over.

Not investment advice.

LICENSE
MIT (see LICENSE). The code is yours to use; the market data belongs to its respective sources
(the fund, Yahoo Finance, CoinMarketCap, SEC EDGAR) and their terms apply to the data, not to this code.
