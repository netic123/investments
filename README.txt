INVESTMENTS
===========

Start:   double-click start.bat  -> the browser opens http://127.0.0.1:8765
Stop:    close the black window (or Ctrl+C in it)

Requires Node.js 18+. No other dependencies, no installation.

GITHUB PAGES
Public site: https://netic123.github.io/investments/

Every push to main — including a merged pull request — runs .github/workflows/pages.yml. The workflow starts
the local server temporarily on the GitHub runner, fetches and validates the six public API responses, and
publishes only _site/index.html, _site/.nojekyll and _site/api/*.json. GitHub Pages is static: it does not keep server.js
running. The public values therefore reflect the timestamp shown in the page header and change on the next
successful main deployment. "Reload snapshot" only checks whether that newer deployment is available.

The Pages build is deliberately forced to the approved data/positions.public.json watchlist: Constellation
Software, Kaspi.kz and Warrior Met Coal, all with entry price set to null. It never publishes the gitignored
data/positions.local.json or data/portfolio.local.json, even when the build script is run on a computer where
those files exist. No API key or GitHub secret is supplied to the snapshot server.
The generated _site directory is ignored by Git and is an explicit allowlist; research files, backend code,
configuration files and repository metadata are not included in the deployed artifact.

YOUR FOCUSED WATCHLIST
Copy data/positions.example.json to data/positions.local.json and enter display ticker, exact WAGN ticker
(fundTicker, when different), Yahoo symbol, entry price and currency. That file is gitignored and is never
committed, so the repo can be shared without revealing what you follow. If it is missing the app visibly
labels the fallback list as DEMO instead of presenting the examples as your holdings. GitHub Pages uses
data/positions.public.json, which contains the three approved public tickers but deliberately excludes your
personal entry prices; the complete private list is available only from the local server.

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
- Crypto, Sweden, USA, Europe, Global = one repository-owned unified Fear & Greed model v1 (0–100),
            calculated by marketfg.js. Every tab uses the same six-component scoring engine, a trailing 252-observation
            percentile window, at least 126 valid raw observations, equal weights and the same labels:
            0–24 extreme fear, 25–44 fear, 45–55 neutral, 56–74 greed, 75–100 extreme greed. All six
            components are required: momentum (benchmark vs SMA125), strength (distance from the trailing
            252-observation high), volatility (configured implied volatility, else realised 20-observation
            volatility vs its 50-observation average, inverted), safe-haven demand (benchmark minus government
            bonds over 20 common observations), credit appetite (high yield vs investment grade relative to
            SMA125), and breadth (configured non-core/smaller series vs core/larger series relative to SMA63).
            Yahoo supplies raw histories only; no third-party sentiment score or fitted weight enters the model.
            Open directly: /#crypto /#sweden /#usa /#europe /#global
- Crypto uses BTC-USD as benchmark, not as a claim to represent the entire crypto market. Its breadth input
            compares two transparent daily-rebalanced analytical return indices: CRYPTO-CORE-EW contains BTC
            and ETH at equal weight; CRYPTO-NONCORE-EW contains SOL, XRP, ADA, DOGE and BNB at equal weight.
            IEF is the external safe-haven comparator and HYG/LQD is external US corporate-credit appetite.
            The current UTC date is excluded. Because crypto trades every day, 252 crypto observations cover
            about 8.3 months; 252 equity trading observations cover roughly one trading year. The parameter is
            deliberately the same, but the elapsed calendar duration is not.

HOW IT WORKS
- The fund's own daily holdings file is fetched every 5 minutes (the page refreshes every 10).
- Every new file day is saved as a snapshot in data/snapshots.json. Changes = the difference in NUMBER OF
  SHARES between two snapshots. Weight in percent moves with prices and means nothing.
- If Investments is not run every weekday, several days' net quantity changes are merged under "Changes".
  They are not proof of exact execution dates/prices; the heading says when the interval spans several days.
- The fund's file is dated one trading day AFTER the prices in it (T+1).
- Weekends/evenings: the card shows "Last close" with a timestamp, not "Price now".
- Locally, the Update button re-fetches EVERYTHING: fund files, Yahoo quotes and the 30 unique Yahoo series
  behind the five unified-model tabs (it takes a few seconds; the status line shows progress and the time with
  seconds, and every source shows when it was fetched). The automatic 10-minute refresh is gentler: it reuses
  daily series that are less than 15 minutes old. Crypto excludes the current UTC date; equity markets use their
  configured exchange-local daily bars. Identical numbers after an Update are therefore normal until another
  eligible daily observation is available. On GitHub
  Pages, Reload snapshot re-downloads the most recently deployed JSON; upstream sources are fetched by the
  workflow, not by the visitor's browser.
- Every market score is computed locally in marketfg.js from full Yahoo daily histories. The 30 unique raw
  model series are cached for 15 minutes and share one 25-second fetch deadline. A market history begins only
  when all six components can be scored; there are no three-to-five-component substitutes. During equity
  trading hours the latest exchange-local point can change until the close; Crypto uses completed UTC dates.
  Yahoo's chart feed has no contractual public API/SLA, so availability and historical revision remain real
  limitations. The NAV chart covers the fund's whole life (since 29 Sep 2023; price only, distributions excluded).
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
- Unified Market Fear & Greed (own model): marketfg.js calculates all five tabs. Crypto's seven constituent
  histories are BTC, ETH, SOL, XRP, ADA, DOGE and BNB; the two equal-weight return indices are reconstructed
  from their common dated closes and rebalanced analytically every day. They are not market-cap indices,
  investable portfolios or point-in-time constituent histories. The fixed August 2026 membership creates
  selection/survivorship bias in retrospective results. IEF and HYG/LQD add external US Treasury and corporate-
  credit conditions; they are not crypto-native sentiment. Weekend Crypto composites carry their latest scored
  US-market components for at most seven calendar days. The realised-volatility raw value is annualised with
  sqrt(252) wherever that realised-volatility mapping is used; for seven-day crypto it is not a 365-day annualised
  volatility, although this positive constant does not change its percentile score.
- The original 23 equity Yahoo series were checked for identity (ISIN/name), freshness and gaps on 24 Aug 2026;
  20 of 23 closes were verified to the cent against Nasdaq, Cboe/FRED, Avanza, Carnegie, stoxx.com,
  Xetra and LSE. Model validation: the US version was compared ONCE with CNN's published index (a one-off
  manual check, not a feed): correlation 0.88 over 398 trading days, mean gap 8.9 points, ours on average
  6 points greedier, same label 56 % of days, within one band 93 %. The remaining gap is CNN's put/call and
  NYSE breadth inputs, which have no open data source. Known caveats: OMXSBGI is total return but STOXX 600
  is a price index (slight spring-dividend bias for Europe); Sweden/Europe use realised volatility because
  no matching implied series is configured (Europe does have VSTOXX for Euro STOXX 50 options, but this
  model applies backward-looking realised volatility to STOXX Europe 600); the global credit ETFs
  (HYLD.L/CORP.L) are thinly traded, so that indicator is noisier. Those dated checks do not guarantee future
  Yahoo availability or prove that the composite predicts returns.
- Event dates: six confirmed by primary sources (Kaspi EGM/record date, TCMB, Pareto, WAGN call, 13F rule,
  RIG/VAL filings). Q3 report dates are NOT announced yet — they are expectations from last year's cadence,
  marked "~" / "expected" on the page; re-check the companies' IR pages in mid-October.

UPDATE BY HAND
- data/positions.local.json: focus tickers, exact WAGN/Yahoo symbol, entry price/currency and estimated or
  confirmed next report date (restart after editing; Update does not reload this file)
- data/positions.public.json: the explicitly approved public GitHub Pages tickers only. Keep every entry price
  null; the Pages build fails if a personal entry price is added.
- dalalStreet: the manager-aggregated 13F (next filing due by 16 Nov 2026)
- dates: upcoming events (the list empties itself when dates have passed)
- names: name, flag, Avanza status per ticker (online / telefon / nej)
- marketFearGreed: the one active model ID/version, shared 252/126/6 parameters, Yahoo symbols per market and
  Crypto's fixed CORE-EW/NONCORE-EW constituents. A cold calculation requires all six components. Changing a
  parameter, proxy or synthetic constituent changes the model; increment the model version, restart and rerun
  the schema-3 backtest instead of silently rewriting the definition.

IF SOMETHING GOES WRONG
- "holdings file could not be fetched" = the fund's server did not respond; the page shows the last saved file.
- "quote missing: ..." = Yahoo did not respond for that ticker; the rest works.
- "Fear & Greed <market> could not be computed" / "index series ... missing" = Yahoo did not respond and the
  required raw series could not be fetched, or a required synthetic series could not be constructed, since
  startup. Crypto requires BTC, ETH, SOL, XRP, ADA,
  DOGE, BNB, IEF, HYG and LQD; the other tabs require their configured sources. If a raw series was fetched
  earlier, the last successful in-memory copy may be reused with an explicit warning. No third-party sentiment
  index is substituted.
- If snapshots.json breaks, a copy is saved (snapshots.json.broken-<time>) and the history starts over.

Not investment advice.

LICENSE
MIT (see LICENSE). The code is yours to use; the market data belongs to its respective sources
(the fund, Yahoo Finance and SEC EDGAR) and their terms apply to the data, not to this code.
