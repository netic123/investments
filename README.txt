INVESTMENTS
===========

Start:   double-click start.bat  -> the browser opens http://127.0.0.1:8765
Stop:    close the black window (or Ctrl+C in it)

Requires Node.js 18+. No other dependencies, no installation.

GITHUB PAGES
Public site: https://netic123.github.io/investments/

Every push to main — including a merged pull request — plus a manual dispatch and the daily 09:15 UTC schedule
runs .github/workflows/pages.yml. The workflow starts the local server temporarily on the GitHub runner, fetches
and validates the seven public API responses, and
publishes only _site/index.html, _site/.nojekyll and _site/api/*.json. When the fund's holdings
and NAV files disagree (normal for a few hours after a share creation/redemption), the build still
publishes; the page then labels the pricing date as not asserted, and api/build.json records the
non-reconciled state. GitHub Pages is static: it does not keep server.js
running. The public values therefore reflect the timestamp shown in the page header and change on the next
successful deployment. "Reload snapshot" only checks whether that newer deployment is available. Each scheduled
build imports the previously published WAGN snapshots before adding the newest receipt, so history survives static
Pages rebuilds instead of resetting to the few snapshots committed in the repository.

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
  - Dalal Street's manager-aggregated 13F — fetched automatically from official SEC submissions + filing XML,
    with declared row count and total value validated before publication. The config copy is a clearly labelled
    fallback only when SEC cannot be reached. A Pages build accepts only that exact dated fallback and only through
    its stated next-filing deadline; the page never labels fallback as newly verified. While fallback is displayed,
    the visitor's browser also asks the CORS-enabled official SEC submissions endpoint whether a newer accession exists.
  - Upcoming dates
  Open directly: / or /#pabrai
- Crypto, Sweden, USA, US Tech, Europe, Global = one repository-owned unified Fear & Greed model v3 (0–100),
            calculated by marketfg.js. Every tab uses the same six-component scoring engine. At each date, every raw
            component is ranked causally against all finite observations available for that component from the start
            of the current provider maximum-history response through that date. There is no rolling percentile window
            and no internal score-history truncation. Scoring requires at least 126 valid raw observations. The six
            ranks have equal weights and use the same one-decimal labels:
            0–24.9 extreme fear, 25–44.9 fear, 45–55.9 neutral, 56–74.9 greed, 75–100 extreme greed. All six
            components are required: momentum (benchmark vs SMA125), strength (distance from the trailing
            252-observation high), volatility (configured implied volatility, else realised 20-observation
            volatility vs its 50-observation average, inverted), safe-haven demand (benchmark minus government
            bonds over 20 common observations), credit appetite (high yield vs investment grade relative to
            SMA125), and breadth (configured non-core/smaller series vs core/larger series relative to SMA63).
            Yahoo supplies raw histories only; no third-party sentiment score or fitted weight enters the model.
            Open directly: /#crypto /#sweden /#usa /#ustech /#europe /#global
- Crypto uses CRYPTO-BROAD-EW, a transparent daily-rebalanced equal-weight return index of BTC, ETH, SOL,
            XRP, ADA, DOGE and BNB. It is broader than BTC alone but is not literally every coin, market-cap
            weighted, investable or a point-in-time total-market history. Its breadth input compares two further
            analytical return indices: CRYPTO-CORE-EW contains BTC and ETH at equal weight; CRYPTO-NONCORE-EW
            contains SOL, XRP, ADA, DOGE and BNB at equal weight.
            IEF is the external safe-haven comparator and HYG/LQD is external US corporate-credit appetite.
            The current UTC date is excluded. The strength raw feature retains a trailing 252-observation high,
            but its resulting raw values are ranked over all available causal history rather than a 252-row window.
            US Tech uses XLK as its benchmark; it is not QQQ or the entire Nasdaq-100.

HOW IT WORKS
- The fund's own daily holdings file is fetched on load/update and by the local server's 30-minute background
  capture. Successful API results have a 5-minute in-memory cache; the page refreshes every 10 minutes.
- Every new file day is saved as a snapshot in data/snapshots.json. Changes = the difference in NUMBER OF
  SHARES between two snapshots. When both receipts include fund SharesOutstanding, the page also adjusts the
  position signal for ETF creations/redemptions and shows the raw inventory change underneath. Weight moves with
  prices and is not itself evidence of buying or selling.
- If Investments is not run every weekday, several days' net quantity changes are merged under "Changes".
  They are not proof of exact execution dates/prices; the heading says when the interval spans several days.
- The fund file's displayed date is later than its valuation date. The page claims a pricing date only when the
  holdings NetAssets and SharesOutstanding reconcile to rounded NAV × SharesOutstanding from the official NAV file.
- Weekends/evenings: the card shows "Last close" with a timestamp, not "Price now".
- Locally, the Update button re-fetches EVERYTHING: fund files, Yahoo quotes and the 33 unique Yahoo series
  behind the six unified-model tabs (it takes a few seconds; the status line shows progress and the time with
  seconds, and every source shows when it was fetched). The automatic 10-minute refresh is gentler: it reuses
  daily series that are less than 15 minutes old. Crypto excludes the current UTC date; equity markets use their
  configured exchange-local daily bars. Identical numbers after an Update are therefore normal until another
  eligible daily observation is available. On GitHub
  Pages, Reload snapshot re-downloads the most recently deployed JSON; upstream sources are fetched by the
  workflow, not by the visitor's browser.
- Every market score is computed locally in marketfg.js from full Yahoo daily histories. The 33 unique raw
  model series are cached for 15 minutes and share one 25-second fetch deadline. A market history begins only
  when all six components can be scored; there are no three-to-five-component substitutes. During equity
  trading hours the latest exchange-local point can change until the close; Crypto uses completed UTC dates.
  The primary Yahoo chart host is retried against Yahoo's second chart host when needed; the selected hostname
  for every symbol and full-history input digests are included in the public signal record. Yahoo's hosts are
  not assumed byte-identical or immutable, and its chart feed has no contractual public API/SLA, so availability
  and historical revision remain real limitations. The NAV chart covers the fund's whole life (since 29 Sep 2023;
  price only, distributions excluded).
- While the server runs it also captures the fund's holdings file every 30 minutes on its own, so a file
  day is not missed when the page is closed (a missed day merges multiple days into one net quantity change).

SOURCES AND HOW THEY WERE VERIFIED (26 Aug 2026)
- Fund holdings / NAV / performance: the fund's own files on wagonsetf.filepoint.live — verified to be the
  exact five FilePoint files loaded by wagonsetf.com's embedded fund page. The 25 Aug holdings receipt was HTTP
  200, contained 20 securities plus four cash/currency rows, and its parsed rows matched the upstream file exactly.
  It reported $281,177,571.66 NetAssets and 17,920,814 SharesOutstanding; rounded 24 Aug NAV $15.69 × 17,920,814
  reconciles to that convention. Schema, consistent row dates/account/totals, CUSIPs, value/weight tolerances,
  freshness, regression and SHA-256 provenance are now checked before a receipt is accepted.
- Quotes (your tickers + the ETF's): Yahoo Finance, verified to the cent against Nasdaq's and TSX's own quote
  services. FX (USD/SEK, CAD/SEK): Yahoo's last tick; differs from the ECB/Riksbank daily fix by ~0.1 %.
  The rate and its time are shown under "Price in SEK".
- Dalal Street: official SEC EDGAR submissions for CIK 0001549575 select the newest two 13F-HR report quarters;
  primary_doc.xml and infotable.xml are fetched and cross-checked for manager identity, report date, amendment
  state, declared entry count and declared total value. As checked 26 Aug, latest accession
  0001549575-26-000015 (filed 13 Aug, report date 30 Jun) has four rows totalling $326,749,980 and exactly matches
  the labelled config fallback. An amendment stops automatic publication for manual review. This still cannot be
  live trading data: 13F is quarterly, may arrive up to 45 days after quarter-end, and omits cash, shorts and many
  non-US or otherwise non-reportable positions. It is manager-submitted data; SEC publication is not an SEC audit
  or certification that the filing is accurate and complete.
- Unified Market Fear & Greed (own model): marketfg.js calculates all six tabs. Production v3 ranks each raw
  component over all finite observations supplied by Yahoo through each date; Yahoo's claim to maximum history
  is requested but not independently verifiable. Historical v1/v2 research used different score definitions and
  does not validate v3. Crypto's seven constituent
  histories are BTC, ETH, SOL, XRP, ADA, DOGE and BNB; the three equal-weight return indices are reconstructed
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
  model applies backward-looking realised volatility to STOXX Europe 600); US Tech means XLK and mixes that
  benchmark with VXN and general US bond/credit proxies; the global credit ETFs
  (HYLD.L/CORP.L) are thinly traded, so that indicator is noisier. Those dated checks do not guarantee future
  Yahoo availability or prove that the composite predicts returns. The frozen Crypto backtests evaluated model
  v1 with BTC as target; they do not validate production v3's broad benchmark or expanding percentile history.
- Event dates: six confirmed by primary sources (Kaspi EGM/record date, TCMB, Pareto, WAGN call, 13F rule,
  RIG/VAL filings). Q3 report dates are NOT announced yet — they are expectations from last year's cadence,
  marked "~" / "expected" on the page; re-check the companies' IR pages in mid-October.

UPDATE BY HAND
- data/positions.local.json: focus tickers, exact WAGN/Yahoo symbol, entry price/currency and estimated or
  confirmed next report date (restart after editing; Update does not reload this file)
- data/positions.public.json: the explicitly approved public GitHub Pages tickers only. Keep every entry price
  null; the Pages build fails if a personal entry price is added.
- dalalStreet: verified CUSIP-to-display-ticker mapping and last-known fallback only. Official SEC data updates
  automatically; after a new filing, review any unknown CUSIP label and update this mapping rather than retyping
  official share/value totals.
- dates: upcoming events (the list empties itself when dates have passed)
- names: name, flag, Avanza status per ticker (online / telefon / nej)
- marketFearGreed: the one active model ID/version, expanding percentile mode, shared 252-observation strength
  lookback, 126-observation percentile warm-up, six-component requirement, Yahoo symbols per market and
  Crypto's fixed BROAD-EW/CORE-EW/NONCORE-EW constituents. A cold calculation requires all six components.
  Changing a parameter, proxy or synthetic constituent changes the model; increment the model version, restart
  and preregister a new out-of-sample test. Never rewrite the frozen schema-3/schema-4 model-v1 BTC results to
  describe a later production model.

IF SOMETHING GOES WRONG
- "holdings file could not be fetched" = the fund's server did not respond; the page shows the last saved file.
- "SEC live verification unavailable" = the SEC request or XML validation failed. The page shows the exact dated
  manual fallback and separately tries to confirm the latest accession from SEC in the visitor's browser. The Pages
  build rejects altered fallback data and refuses to republish it after its stated next-filing deadline.
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
