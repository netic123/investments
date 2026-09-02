INVESTMENTS
===========

Start:   double-click start.bat  -> the browser opens http://127.0.0.1:8765
Stop:    close the black window (or Ctrl+C in it)

Requires Node.js 18+. No other dependencies, no installation.

GITHUB PAGES
Public site: https://netic123.github.io/investments/

Every push to main — including a merged pull request, but not commits marked [skip ci] such as the lockbox
records — plus a manual dispatch and the schedules run .github/workflows/pages.yml. The schedules keep the
public snapshot fresh on their own: 09:20 UTC every day (after the NAV file; this slot also runs the test
suite) and hourly at :20 from 05:20 to 22:20 UTC Monday–Friday (without the suite, which already ran on the
push that deployed the code). In August 2026 GitHub started the single daily run 5–11 hours after its cron
time and two of the five scheduled builds between 28 Aug and 1 Sep failed, leaving the site a day stale; with
an hourly slot a late start still lands within the hour and a transient failure costs an hour. Fear & Greed
bars for a trading day enter the first build after that exchange's local midnight, because only completed
source-local dates are scored. api/build.json records which schedule fired. The workflow first
compiles the page's inline script without running it (a syntax error would leave the public page at "loading…"
forever, so the build fails before any network work), then starts the local server temporarily on the GitHub
runner, fetches and validates the seven public API responses, and publishes only _site/index.html,
_site/.nojekyll and _site/api/*.json. The published index.html carries a Content-Security-Policy that the build
adds and verifies in the artifact: default-src 'none'; script-src only the one inline block, by its SHA-256
hash; style-src 'unsafe-inline' and fonts.googleapis.com; font-src fonts.gstatic.com; connect-src the site
itself and https://data.sec.gov; img-src the site and data: URIs; base-uri, form-action and object-src 'none'.
That is also the complete list of what a visitor's browser contacts, and the page footer says so: the site's
own JSON files, Google Fonts for the typefaces and — only when the build could not verify the 13F itself —
SEC's EDGAR submissions index, to check whether a newer filing exists.

When the holdings file cannot be reconciled to the official NAV (the two proofs are under HOW IT WORKS), the
build still publishes; the page then labels the pricing date as not asserted and prints the reason, and
api/build.json records the outcome as navReconciliation and navReconciliationMode ("exact", "per-share" or
null). A DailyNAV file that lags the historical NAV file (a newer rate without a unit count) no longer fails the
build; it only limits which proof is available. GitHub Pages is static: it does not keep server.js running.
Every public figure is as of the build time in the status line — "snapshot built <time> (<age>) · page loaded
<time>", in the visitor's local time with the zone abbreviation — and changes only on the next successful
deployment. When no build has succeeded for more than 30 hours (build.json snapshotStaleAfterHours), the status
line of both the Pabrai and the Fear & Greed tabs warns that every figure on the page is as of that old build.
"Reload snapshot" re-downloads every JSON with a cache-busting query, bypassing the Pages CDN cache (max-age
600 s), and reports "newer snapshot loaded" or "no newer snapshot has been published"; the automatic 10-minute
reload reads through that cache. build.json also records refreshTrigger with both schedules. Each build imports
the previously published WAGN snapshots before adding the newest receipt, so history survives static Pages
rebuilds instead of resetting to the few snapshots committed in the repository.

The Pages build is deliberately forced to the approved data/positions.public.json watchlist: Constellation
Software, Kaspi.kz and Warrior Met Coal, all with entry price set to null. It never publishes the gitignored
data/positions.local.json or data/portfolio.local.json, even when the build script is run on a computer where
those files exist. No API key or GitHub secret is supplied to the snapshot server. The only optional input is
the repository variable SEC_USER_AGENT, passed by pages.yml as the environment variable of the same name: a
declared User-Agent carrying a real e-mail address for SEC EDGAR. Set it — the built-in default is accepted by
data.sec.gov but not reliably by www.sec.gov, which serves the filing XML, so without it a build may fall back
to the labelled manual 13F. It must not mention github.com or github.io, which SEC's edge rejects; such a value
fails the build loudly instead of silently degrading every build to the fallback.
The generated _site directory is ignored by Git and is an explicit allowlist; research files, backend code,
configuration files and repository metadata are not included in the deployed artifact.

LIVE UPDATE ON THE PUBLIC SITE (owner only)
GitHub Pages has no server, and the fund's FilePoint files and Yahoo send no CORS headers, so a browser cannot
fetch them directly; "live" on the public site therefore means a fresh build. The page's "Live update…" button
sets that up: paste a fine-grained GitHub token once, and the button becomes "Update (rebuild)". Pressing it
sends a workflow_dispatch to pages.yml with skip_tests=true (the suite already ran on the push that deployed the
code), follows the run through api.github.com, and reloads the page when the deployment is live — about 2 to
4 minutes, longer if GitHub queues the run behind a scheduled build. Create the token under GitHub → Settings →
Developer settings → Personal access tokens → Fine-grained tokens: resource owner netic123, repository access
"Only select repositories" → investments, repository permission Actions: Read and write (Metadata: Read is
added automatically), nothing else, with an expiry you are comfortable with. The token is stored only in that
browser's local storage (key investments.liveUpdateToken), is sent only to api.github.com, and can be removed
with ⚙ → "Forget token". Anyone who can use that browser profile can start builds with it, nothing more; the
page's Content-Security-Policy allows scripts only from the one hashed inline block, so a script from anywhere
else cannot read it. Visitors without a token see the same page as before; the button only opens the
explanation. api/build.json records the trigger ("workflow_dispatch", "schedule" or "push"), the reason and
whether the tests were skipped, and the About line in the footer shows it.
Auto mode: with a token stored, ⚙ offers "Automatically rebuild while this page is open and the snapshot is
older than N minutes" (default 30). While the tab is visible, the page then starts a build by itself whenever
the snapshot is older than that (checked on load and on the 10-minute refresh), at most once per 15 minutes,
and follows an already queued or running build instead of starting another. The setting is stored in the same
browser (key investments.liveUpdateAutoMinutes).

YOUR FOCUSED WATCHLIST
Copy data/positions.example.json to data/positions.local.json and enter display ticker, exact WAGN ticker
(fundTicker, when different), Yahoo symbol, entry price and currency. That file is gitignored and is never
committed, so the repo can be shared without revealing what you follow. If it is missing the app visibly
labels the fallback list as DEMO instead of presenting the examples as your holdings. GitHub Pages uses
data/positions.public.json, which contains the three approved public tickers but deliberately excludes your
personal entry prices; the complete private list is available only from the local server.

TABS (top of the page)
- Pabrai  = the default tab: what Mohnish Pabrai is doing, for the positions you follow yourself:
  - Your focused stocks (from data/positions.local.json): WAGN's change in shares held vs the previous daily
    file, Dalal Street's quarterly 13F position/change, the Yahoo price vs your entry, SEK price and next report
  - Every change in shares held between the two latest saved files, with a callout stating the unit
    creation/redemption when WAGN's units outstanding changed between them, plus the full log
  - The whole ETF portfolio sorted by weight, with plain "Δ shares" columns and Avanza status (online / by
    phone / not available)
  - Fund performance vs S&P 500 and the NAV curve
  - Dalal Street's manager-aggregated 13F — fetched automatically from official SEC submissions + filing XML,
    with declared row count and total value validated before publication. The config copy is a clearly labelled
    fallback only when SEC cannot be reached. A Pages build accepts only that exact dated fallback; after its
    stated next-filing deadline it still publishes the fallback, flagged pastFilingDeadline, and the page warns
    that a newer 13F may exist. The page never labels fallback as newly verified. While fallback is displayed,
    the visitor's browser also asks the CORS-enabled official SEC submissions endpoint whether a newer accession
    exists, and says so when that check could not run.
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
- Every new file day is saved as a snapshot in data/snapshots.json. Changes = differences in the NUMBER OF
  SHARES held between two snapshots: a new holding, a full exit or a different share count. A holding whose
  share count did not change is never listed, even when a cash creation diluted its share per WAGN unit; a raw
  change that is proportional to the change in units outstanding (an in-kind basket; tolerance half a share or
  0.5 % of the move) is skipped as an ETF flow, not a trade. When units changed between the two files, a
  callout states the creation/redemption and a "vs pro-rata" column restates each trade relative to deploying
  the flow in proportion to the previous portfolio — context, not the headline. In the full portfolio the
  "Δ shares" columns are plain share differences; "∝ unit flow" marks a raw move that was proportional to a
  flow. Weight moves with prices and is not itself evidence of buying or selling.
- If Investments is not run every weekday, several days' net changes are merged under "Changes". They are not
  proof of exact execution dates/prices; a callout says when the interval spans more than one weekday (a
  Friday → Monday pair of files is not flagged).
- The holdings file is dated the next weekday and priced at the previous NAV date; its NetAssets equals the
  official NAV × the file's own SharesOutstanding to the cent. The page asserts a pricing date on one of two
  proofs: "exact" (the NAV file reports the same unit count, or none, and NetAssets equals rounded NAV × units
  within one hundred-thousandth) or "per-share" (NetAssets / units rounds to the NAV within half a cent although
  the unit count differs, because a creation or redemption settled after the NAV file; the page then says how
  many units, or that the NAV file carried no unit count). The NAV date must be 0–4 calendar days before the file date. Otherwise the pricing date is not
  asserted and the page prints why. Every snapshot from 25 Aug to 1 Sep 2026 matched the prior NAV date
  uniquely, including the creation days 27 Aug (+250,000 units) and 1 Sep (+150,000 units).
- Every timestamp is shown in the visitor's local time with the zone abbreviation. Locally a quote is labelled
  "Price now" only when it is at most 30 minutes old, otherwise "Last price"; on the public site it is always
  "Price at snapshot", with the quote time and, once it is more than 30 minutes old, its age, because the quote
  is as old as the build that fetched it. The percentage next to it is "vs previous close". Fear & Greed shows "computed <date time zone>" rather
  than a bare clock time, and a callout when components are carried forward from an earlier completed bar (the
  model allows up to fillDays, seven calendar days).
- Locally, the Update button re-fetches EVERYTHING: fund files, Yahoo quotes and the 33 unique Yahoo series
  behind the six unified-model tabs (it takes a few seconds; the status line shows progress and the time with
  seconds, and every source shows when it was fetched). The automatic 10-minute refresh is gentler: it reuses
  daily series that are less than 15 minutes old. Crypto excludes the current UTC date; equity markets use their
  configured exchange-local daily bars. Identical numbers after an Update are therefore normal until another
  eligible daily observation is available. On GitHub Pages, Reload snapshot re-downloads the most recently
  deployed JSON, bypassing the CDN cache; upstream sources are fetched by the workflow, not by the visitor's
  browser.
- Every market score is computed locally in marketfg.js from full Yahoo daily histories. The 33 unique raw
  model series are cached for 15 minutes and share one 25-second fetch deadline. A market history begins only
  when all six components can be scored; there are no three-to-five-component substitutes. Only completed
  source-local daily bars enter a score: a market's newest point is the last completed exchange-local date, it
  never moves during a trading session, and Crypto uses completed UTC dates. When a component's source has no
  bar for the benchmark's date (a different exchange, or a lagging Yahoo history), its latest score is carried
  forward for at most fillDays (seven calendar days) and the page says which components are carried.
  The primary Yahoo chart host is retried against Yahoo's second chart host when needed; the selected hostname
  for every symbol and full-history input digests are included in the public signal record. Yahoo's hosts are
  not assumed byte-identical or immutable, and its chart feed has no contractual public API/SLA, so availability
  and historical revision remain real limitations. The NAV chart covers the fund's whole life (since 29 Sep 2023;
  price only, distributions excluded).
- While the server runs it also captures the fund's holdings file every 30 minutes on its own, so a file
  day is not missed when the page is closed (a missed day merges multiple days into one net quantity change).

SOURCES AND HOW THEY WERE VERIFIED (26 Aug 2026; SEC path and pricing date re-verified 2 Sep 2026)
- Fund holdings / NAV / performance: the fund's own files on wagonsetf.filepoint.live — verified to be the
  exact five FilePoint files loaded by wagonsetf.com's embedded fund page. The 25 Aug holdings receipt was HTTP
  200, contained 20 securities plus four cash/currency rows, and its parsed rows matched the upstream file exactly.
  It reported $281,177,571.66 NetAssets and 17,920,814 SharesOutstanding, equal to rounded 24 Aug NAV $15.69 ×
  17,920,814 to the cent (the "exact" proof). The 27 Aug and 1 Sep receipts, dated the days 250,000 and 150,000
  units were created, also matched their prior NAV date; the 1 Sep case, where the 31 Aug NAV file still
  reported 18,170,814 units against the receipt's 18,320,814, is the "per-share" proof and is the fixture in
  test/pabrai.test.js. ODL NO (Odfjell Drilling) first appeared in the 25 Aug file with 100 shares and the
  26 Aug file added a NOK currency row; its CASHNOK CUSIP classified it as cash before NOK was added to
  cashTickers. Schema, consistent row dates/account/totals, CUSIPs, value/weight tolerances, freshness,
  regression and SHA-256 provenance are checked before a receipt is accepted.
- Quotes (your tickers + the ETF's): Yahoo Finance, verified to the cent against Nasdaq's and TSX's own quote
  services. FX (USD/SEK, CAD/SEK): Yahoo's last tick; differs from the ECB/Riksbank daily fix by ~0.1 %.
  The rate and its time are shown under "Price in SEK".
- Dalal Street: official SEC EDGAR submissions for CIK 0001549575 select the newest two 13F-HR report quarters;
  primary_doc.xml and infotable.xml are fetched and cross-checked for manager identity, report date, amendment
  state, declared entry count and declared total value. Before 2 Sep 2026 every Pages build and every local run
  fell back to the manual filing, for two reasons found and fixed that day. (1) SEC's edge answers HTTP 403,
  from everywhere, to any User-Agent that mentions github.com or github.io — which the old default
  'netic123-investments/1.0 (netic123@users.noreply.github.com)' did. The default is now
  'netic123-investments/1.0 (public dashboard; contact via the netic123/investments repository)', which
  data.sec.gov (the submissions index) accepts; www.sec.gov, which serves the filing XML, expects an e-mail-style
  contact and does not reliably accept it. Only SEC_USER_AGENT set to a string with a real e-mail address
  (environment variable locally, the repository variable for Pages builds) makes the automatic path reliable; a
  value mentioning github.com or github.io is refused. (2) EDGAR's submissions feed names the primary document
  through its XSL viewer path (xslForm13F_X02/primary_doc.xml), which returns HTML; the fetch now takes the
  basename so the raw XML is read. With both fixes the automatic path was verified end to end on 2 Sep 2026
  (with an e-mail-contact User-Agent, and once with the default before www.sec.gov began refusing it):
  accession 0001549575-26-000015 (filed 13 Aug, report date 30 Jun) has four rows totalling $326,749,980 and
  exactly matches the labelled config fallback, which the page states when the automatic rows equal the
  configured copy. An amendment stops
  automatic publication for manual review. This still cannot be live trading data: 13F is quarterly, may arrive
  up to 45 days after quarter-end, and omits cash, shorts and many non-US or otherwise non-reportable positions.
  It is manager-submitted data; SEC publication is not an SEC audit or certification that the filing is
  accurate and complete.
- Unified Market Fear & Greed (own model): marketfg.js calculates all six tabs. Production v3 ranks each raw
  component over all finite observations supplied by Yahoo through each date; Yahoo's claim to maximum history
  is requested but not independently verifiable. Historical v1/v2 research used different score definitions and
  does not validate v3. Crypto's seven constituent
  histories are BTC, ETH, SOL, XRP, ADA, DOGE and BNB; the three equal-weight return indices are reconstructed
  from their common dated closes and rebalanced analytically every day. They are not market-cap indices,
  investable portfolios or point-in-time constituent histories. The fixed August 2026 membership creates
  selection/survivorship bias in retrospective results. IEF and HYG/LQD add external US Treasury and corporate-
  credit conditions; they are not crypto-native sentiment. Weekend Crypto composites carry their latest scored
  US-market components for at most seven calendar days, and the same carry-forward applies to any market whose
  component source closed earlier than its benchmark (the page lists the carried components). The realised-volatility raw value is annualised with
  sqrt(252) wherever that realised-volatility mapping is used; for seven-day crypto it is not a 365-day annualised
  volatility, although this positive constant does not change its percentile score.
- The original 23 equity Yahoo series were checked for identity (ISIN/name), freshness and gaps on 24 Aug 2026;
  20 of 23 closes were verified to the cent against Nasdaq, Cboe/FRED, Avanza, Carnegie, stoxx.com,
  Xetra and LSE. The three US Tech series added later (XLK, ^VXN, RSPT) have not had that check. Model
  validation: the US version of the FIRST rolling-window model (v1) was compared ONCE, on 23 Aug 2026, with
  CNN's published index (a one-off manual check, not a feed): correlation 0.88 over 398 trading days, mean gap
  8.9 points, ours on average 6 points greedier, same label 56 % of days, within one band 93 %. That check
  predates the v3 expanding-percentile score and does not validate it. The remaining gap is CNN's put/call and
  NYSE breadth inputs, which have no open data source. Known caveats: OMXSBGI is total return but STOXX 600
  is a price index (slight spring-dividend bias for Europe); Sweden/Europe use realised volatility because
  no matching implied series is configured (Europe does have VSTOXX for Euro STOXX 50 options, but this
  model applies backward-looking realised volatility to STOXX Europe 600); US Tech means XLK and mixes that
  benchmark with VXN and general US bond/credit proxies; the global credit ETFs
  (HYLD.L/CORP.L) are thinly traded, so that indicator is noisier. Those dated checks do not guarantee future
  Yahoo availability or prove that the composite predicts returns. The frozen Crypto backtests evaluated model
  v1 with BTC as target; they do not validate production v3's broad benchmark or expanding percentile history.
- Event dates: data/config.json holds eight firm entries (Kaspi dividend record date/EGM, two TCMB decisions,
  the Pareto conference, Constellation's dividend record and payment dates, the WAGN investor call, the SEC 13F
  deadline) and five approximate ones, prefixed "~" on the page: the WAGN annual report (N-CSR, due
  within 70 days of 30 Jun), the Q3 report dates, which are NOT announced yet and are expectations from last
  year's cadence, and the earliest RIG/VAL closing, back-calculated from the DOJ 60-day commitment after both
  certified substantial compliance; Transocean's certification rests on a CTFN report of 24 Aug that no primary
  filing has confirmed, DOJ may end the wait earlier, and other approvals and shareholder votes are still
  needed. Re-check the companies' IR pages in mid-October.

UPDATE BY HAND
- data/positions.local.json: focus tickers, exact WAGN/Yahoo symbol, entry price/currency and estimated or
  confirmed next report date (restart after editing; Update does not reload this file)
- data/positions.public.json: the explicitly approved public GitHub Pages tickers only. Keep every entry price
  null; the Pages build fails if a personal entry price is added.
- dalalStreet: verified CUSIP-to-display-ticker mapping and last-known fallback only. Official SEC data updates
  automatically; after a new filing, review any unknown CUSIP label and update this mapping rather than retyping
  official share/value totals. Set SEC_USER_AGENT to a User-Agent string with a real e-mail address (locally as an
  environment variable, on GitHub as the repository variable); that is what makes the automatic path reliable
  against www.sec.gov. It must not mention github.com or github.io.
- dates: upcoming events; "approx": true prefixes the date with "~" (an entry drops off the page three days
  after its date)
- names: name, flag, Avanza status per ticker (online / telefon / nej); the newest entry is ODL NO (Odfjell
  Drilling, Norway, online)
- cashTickers: currency rows treated as cash (NOK was added with ODL NO). A row whose CUSIP is CASH<ISO code> is
  classified as cash even before its code is listed here, so a new trading currency does not reject the file.
- marketFearGreed: the one active model ID/version, expanding percentile mode, shared 252-observation strength
  lookback, 126-observation percentile warm-up, six-component requirement, Yahoo symbols per market and
  Crypto's fixed BROAD-EW/CORE-EW/NONCORE-EW constituents. A cold calculation requires all six components.
  Changing a parameter, proxy or synthetic constituent changes the model; increment the model version, restart
  and preregister a new out-of-sample test. Never rewrite the frozen schema-3/schema-4 model-v1 BTC results to
  describe a later production model.

IF SOMETHING GOES WRONG
- "the official holdings file could not be fetched (<reason>)" = no usable file was received: the fund's server
  did not respond, or its response did not parse as a valid holdings file (schema, row dates, totals, CUSIPs).
  "the official holdings file was fetched but rejected (<reason>)" = a valid file was received but refused:
  stale (more than 5 calendar days old), future-dated beyond the next weekday, dated earlier than the file
  already saved, or an older revision (earlier Last-Modified) of a file date already saved. It is not saved. In both cases the page shows the last accepted file and its date.
- "pricing date of the holdings file is not asserted — <reason>" = neither reconciliation proof held. The reason
  is one of: the newest NAV date is not within the four days before the file date, NetAssets ÷ units is not
  that NAV (both values are printed), or the required fields are missing. The file itself is still shown.
- "this snapshot is N h old — no scheduled rebuild has succeeded since <time>" (public site, on both tabs) = the
  published snapshot is older than 30 hours; every figure on the page is as of that build. Check the workflow
  runs on GitHub.
- "SEC automatic refresh unavailable at build/update time — official filing manually verified <date>" = the SEC
  request or XML validation failed (likely when SEC_USER_AGENT is not set to an e-mail contact; see SOURCES).
  The page shows the exact dated manual fallback and separately tries to
  confirm the latest accession from SEC in the visitor's browser: "SEC's submissions index was checked from your
  browser ... still the latest 13F accession" when it could, "Filing recency unconfirmed" when that check could
  not run, or "NEW SEC FILING DETECTED" when a newer accession exists. If the message adds "is past its next
  filing deadline; a newer 13F may exist", the fallback's stated deadline has passed and the build could not
  check SEC: the Pages build no longer fails on this, but the fallback must be re-verified by hand. The build
  still rejects altered fallback data.
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
