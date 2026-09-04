INVESTMENTS
===========

Start:   double-click start.bat  -> the browser opens http://127.0.0.1:8765
Stop:    close the black window (or Ctrl+C in it)

Requires Node.js 18+. No other dependencies, no installation.

GITHUB PAGES
Public site: https://netic123.github.io/investments/

Every push to main — including a merged pull request, but not commits marked [skip ci] such as the lockbox
records and the holdings-history commits described below — plus a manual dispatch and the schedules run
.github/workflows/pages.yml. The schedules ask GitHub for a build at 09:20 UTC every day (the tested slot: it
always runs the test suite) and every 30 minutes, at :20 and :50, from 05:20 to 22:50 UTC Monday–Friday. A
slot is an opportunity, not a promise: GitHub starts scheduled runs late and skips most of them. Observed:
between 28 Aug and 1 Sep 2026 the then single daily run started 4.9 to 11.6 hours after its cron time; on
Thu 3 Sep 2026 GitHub started 7 of the 36 weekday slots (at 09:51, 13:36, 13:54, 14:35, 18:05, 21:02 and
23:17 UTC); on Fri 4 Sep 2026 none of the first 8 slots (05:20 to 08:50 UTC) had started by 08:57 UTC, so the
site still showed the 3 Sep holdings file although the fund had published the 4 Sep file at about 00:02 UTC.
The build reads the cron lines from pages.yml at build time and publishes them in api/build.json (schedules,
testedSchedule, refreshTrigger, and which slot fired in `schedule`) together with that dated observation
(scheduleNote, a constant in scripts/build-pages.js — update it when a newer one is measured); the page's About
line prints both, and the status line states the snapshot's age instead of promising a next build. The owner
decided against an external cron (see EXTERNAL CRON). Fear & Greed bars for a trading day enter the first
build after that exchange's local midnight, because only completed source-local dates are scored.

The test suite (about four minutes; three research suites that are pinned to the freeze machine are excluded)
runs on every push, on the 09:20 slot and on a dispatch that did not ask to skip it. Every other trigger — the
half-hourly slots, the page's live update, an external dispatch with skip_tests=true — may skip it only when
scripts/tests-gate.js finds, through GitHub's API (the build job has actions: read), a completed successful
run of pages.yml for the same commit whose test step ran and passed; when there is none, or the API cannot be
read, the suite runs. api/build.json records testsSkipped from what the test step actually did (never from the
trigger) and, when it was skipped, testsVerifiedBy: the URL of the run that proved the commit. The About line
shows both.

A build without the suite takes about a minute of build and deploy runner time (Jobs API, all 27 runs of
2–4 Sep 2026: build job 31–61 s, deploy 8–63 s; the build job takes 224–317 s with the suite, of which the
test step is 183–261 s), free for a public repository, plus
whatever queue GitHub adds; the build job times out after 15 minutes. Each build fetches: the five fund files;
a full history (period1=0) plus a 3-month top-up request for each of the 33 Yahoo series behind the six
Fear & Greed tabs, 66 chart requests, counted in api/build.json yahooRequests (requests, fullHistoryRequests,
topUpRequests, retries, http429, http5xx, byHost, cacheHits); six Yahoo quotes (the three watchlist tickers,
the two FX pairs and WAGN itself); the 13F (five requests to SEC: the submissions index, then primary_doc.xml
and infotable.xml for each of the two quarters); and the N-PORT (the submissions index plus one primary
document per trust filing opened until one names the fund's series — eight on 2 Sep 2026, at most 30). When a
Fear & Greed component is carried forward on the first attempt, the build asks the server to drop its route
cache and the Yahoo series cache (/api/refresh?force=1) and repeats every one of those fetches once (a third
attempt only after a failure); yahooRequests describes the model computation behind the published snapshot,
not the discarded attempt. A holiday and a feed gap look the same to that retry (see HOW IT WORKS).

The workflow first compiles the page's inline script without running it (a syntax error would leave the
public page at "loading…" forever, so the build fails before any network work), then starts the local server
temporarily on the GitHub runner, fetches and validates the eight public API responses, and publishes only
_site/index.html, _site/.nojekyll and _site/api/*.json. The published index.html carries a
Content-Security-Policy that the build adds and verifies in the artifact: default-src 'none'; script-src only
the one inline block, by its SHA-256 hash; style-src 'unsafe-inline' and fonts.googleapis.com; font-src
fonts.gstatic.com; connect-src the site itself, https://data.sec.gov and https://api.github.com; img-src the
site and data: URIs; base-uri, form-action and object-src 'none'. What a visitor's browser actually contacts
(the page footer says the same, and test/site_trust.test.js checks that every connect-src host is named
there): the site's own JSON files on every page load, on Reload snapshot and on the 10-minute re-check;
Google Fonts for the typefaces; data.sec.gov (SEC's EDGAR submissions index) on a page load and, at most once an
hour, on a 10-minute re-check that loads a newer snapshot, while the published snapshot carries the manually
verified 13F fallback — whichever tab the visitor
opened, because the Pabrai section is rendered either way — to check whether a newer filing exists; and
api.github.com only when the visitor presses "Show build history" (an unauthenticated read of the last 20 runs)
or when the owner's live update runs with a stored token, which happens on the Update button and, with
automatic rebuilds switched on, by itself on load and on the 10-minute re-check. No credential and nothing the
visitor did on the page are sent to GitHub, which sees the request as any web server does: the IP address, the
browser's user agent and that it came from netic123.github.io. Nothing typed on the page is sent anywhere
except the owner's token and rebuild interval, which go to api.github.com (the interval is also published in
the build's reason); without a stored token, a page load contacts nothing on GitHub.

When the holdings file cannot be reconciled to the official NAV (the two proofs are under HOW IT WORKS), the
build still publishes; the page then labels the pricing date as not asserted and prints the reason, and
api/build.json records the outcome as navReconciliation and navReconciliationMode ("exact", "per-share" or
null). A DailyNAV file that lags the historical NAV file (a newer rate without a unit count) does not fail the
build; it only limits which proof is available. GitHub Pages is static: it does not keep server.js running.
Every public figure is as of the build time in the status line — "snapshot built <time> (<age>) · CDN copy
N s old · page loaded <time>[ · checked <time>]", in the visitor's local time with the zone abbreviation that
applied at each instant — and changes only on the next successful deployment. Three warnings come from the
snapshot alone and show on every tab, and a fourth from the page's own build stamp. Age: api/build.json publishes snapshotStaleAfterHours = 3, applied while
the weekday schedule is active (scheduleWindowUtc: Mon–Fri 05:20–23:20 UTC), and
snapshotStaleAfterHoursOffSchedule = 30 for weekends and nights; past the applicable threshold the status line
says "this snapshot is N h old, older than the T h expected [while the weekday schedule is active | outside the
weekday schedule]: no newer build has been served to this page since <time> (the CDN can keep the previous
build.json for up to 10 min), so every figure on this page is as of that build. Nothing on this page can start a
build; a new snapshot appears after a push, after a requested build, or when GitHub starts one of the scheduled
slots, and it skips most of them" and, once Build history has been read, how many runs GitHub started in the
last 24 hours ("at least N" when every listed run falls inside them, since only 20 are read). Holdings file: build.json publishes holdingsFileExpectedByUtc = 00:30
(the fund's file for a weekday was live at about 00:02 UTC on 1–4 Sep 2026); when the snapshot's file is
older than the newest weekday file that should exist (Friday's on a weekend) the status line says "the fund's
file dated <D> is normally published by 00:30 UTC; this snapshot was built before it and shows the <F> file",
or, for a build made after that time, "… still shows the <F> file: the fund had not published a newer one when
the build fetched, or the fetch failed". US market holidays come from a fixed NYSE list for 2026–2027 in
index.html (US_MARKET_HOLIDAYS): on a holiday, and on the day after it (whose file would carry the holiday's
close), the line instead says which holiday it is and that how FilePoint dates its file around one has not
been observed, so no file is expected with confidence. The About line states the rule with the published numbers.
Mixed set: when a JSON file's bytes do not match the digest build.json publishes for it (normally the CDN still
serving an earlier build's file) the status line says so on every tab. Build stamp: the build writes its commit
into index.html as a meta tag; when that differs from build.json's commit, the CDN paired one build's page with
another's data, and the status line says so and asks for a reload in a few minutes.

"Reload snapshot" re-downloads the JSON files skipping the browser cache (cache: no-store). It cannot bypass
the Pages CDN, which keeps each file for up to 10 minutes (Cache-Control max-age=600) and ignores query
strings; the status line therefore shows the served copy's age from the Age header ("CDN copy N s old",
advancing while the page holds it) and reports one of "newer snapshot loaded", "no newer snapshot was served
(the CDN may hold a copy for up to 10 min)", "same build re-loaded", "first snapshot loaded", "the CDN served
an older snapshot (built …) than the one already loaded; kept the loaded one" or "the CDN served files from
two different builds; kept the consistent set already loaded". Consistency is checked, not assumed: the page
hashes every api/*.json it loads (SHA-256 of the bytes) against build.json's files map, re-fetches build.json
and the disagreeing files once, keeps a previously loaded consistent set over a mixed one, never replaces the
loaded set with an older build.json, and on a first load that is still mixed warns "a file's bytes do not match the
SHA-256 that build.json publishes for it, normally the CDN still serving a file from an earlier build; figures may
not match". index.html cannot check its own hash from inside the page. The
automatic 10-minute re-check reads the JSON files the same way, never index.html, and does not run while the
owner's live update is running.

Each build imports the previously published holdings history (INVESTMENTS_PREVIOUS_PUBLIC_HOLDINGS_URL, which
must be set on GitHub; the fetch is attempted three times, 5 s then 10 s apart) and merges it with the committed data/snapshots.json
before adding the newest receipt, so history survives static Pages rebuilds; it refuses to publish fewer
receipts than the previous build.json's carriedSnapshotCount unless INVESTMENTS_ALLOW_SNAPSHOT_HISTORY_SHRINK=1
is set by hand. After a push build and after the 09:20 slot (when GitHub runs it) the workflow's record job —
the only job in pages.yml with contents: write, though the lockbox workflow has its own writer — waits for the
CDN to serve the new build (up to ten reads half a minute
apart, then imports whatever it serves with a warning), runs scripts/record-holdings-history.js, which merges
the provenance-bearing receipts of the published holdings.json into data/snapshots.json (legacy rows without
provenance are kept; a later capture of the same date wins), and commits "Record WAGN holdings history <date>
[skip ci]" only when a receipt was added or replaced. A local checkout therefore sees those commits; build.json
historyDurability says so. The Pages build is deliberately forced to the approved data/positions.public.json
watchlist: Constellation Software, Kaspi.kz and Warrior Met Coal, all with entry price set to null. It never
publishes the gitignored data/positions.local.json or data/portfolio.local.json, even when the build script is
run on a computer where those files exist. No API key or GitHub secret is supplied to the snapshot server. The
only optional input is the repository variable SEC_USER_AGENT, passed by pages.yml as the environment variable
of the same name: a declared User-Agent with a contact address for SEC EDGAR, e.g. "<app> (<e-mail>)". It is not
set for this repository, and every GitHub build since 2 Sep 2026 has fetched and verified the 13F, and the
N-PORT once that check existed, with the built-in default (see SOURCES, Dalal Street, for the whole record). A value mentioning github.com or
github.io, which SEC's edge rejects, fails the build loudly instead of silently degrading every build to the
fallback. build.json records which contact was used as secContact ("repository variable SEC_USER_AGENT" or
"built-in default (no e-mail contact)"), never the value, and the About line shows it; the build log carries a
WARNING when the default was in use and an SEC request failed. The generated _site directory is ignored by Git
and is an explicit allowlist; research files, backend code, configuration files and repository metadata are
not included in the deployed artifact.

PROVENANCE AND BUILD HISTORY
api/build.json names the commit, the trigger, the reason of a dispatch and the Actions run that produced the
snapshot (runId, runUrl), and lists the SHA-256 of the exact bytes written for index.html and every api/*.json
except build.json itself, which cannot carry its own digest (files; the empty .nojekyll is not hashed either).
The workflow also runs actions/attest-build-provenance on index.html and every api/*.json, so GitHub signs a
provenance statement binding each digest to that run and commit; anyone with a GitHub account can check a
downloaded file after "gh auth login" with "gh attestation verify <file> --owner netic123" (the attestation
API answers 401 without a login), or browse https://github.com/netic123/investments/attestations. The page's
About line links the run, the tested run when the suite was skipped, and explains this. The "Build history"
section sits below the tabs, so every tab shows it. It loads only when the visitor presses "Show build history
— contacts api.github.com": one unauthenticated request for the last 20 runs of pages.yml (GitHub allows 60
such requests per hour per address; a 403 or 429 is reported as that), re-read at most every 5 minutes. The
table shows Queued (when GitHub created the run), Trigger, Result and Duration. For a first attempt GitHub's
run_started_at equals created_at, so Duration is measured from the queue time to the run's last update (a re-run's
row counts from its original queue time too) and includes any wait behind a running deploy, because the
workflow's concurrency group serialises deployments (job-level times are not fetched) and a link to each log, including runs that
failed and therefore published nothing; the note counts published, failed and started-in-the-last-24-hours
runs, and the callout says when a newer build has finished that the CDN had not served at the page's last
check. That is the reliability record behind the status line's age warning.

LIVE UPDATE ON THE PUBLIC SITE (owner only)
GitHub Pages has no server, and the fund's FilePoint files and Yahoo send no CORS headers, so a browser cannot
fetch them directly; "live" on the public site therefore means a fresh build. Visitors never see this: the
"Live update…" button appears only when the page is opened with #owner in the address
(https://netic123.github.io/investments/#owner, remembered in sessionStorage for that browser tab session) or
when a token is already stored in that browser. The button sets it up: paste a fine-grained GitHub token once
(github_pat_…), and the button becomes "Update (rebuild)". Pressing it first asks GitHub for the last ten runs:
a queued or running build, or a finished successful build newer than the loaded snapshot that the CDN has not
served yet, is followed instead of starting another; otherwise it sends a workflow_dispatch to pages.yml with
skip_tests=true (honoured only when a tested run of the same commit exists, see GITHUB PAGES), follows the run
through api.github.com (polled every 15 s, for up to 15 minutes), then reads api/build.json every 20 s for up
to 10 minutes until the CDN serves the one that run produced (its runId, or a generatedAt after the dispatch)
and reloads the page with location.reload(), so the page code and the data come from one deployment; if the
CDN still serves the previous snapshot after 10 minutes the status line says so and asks you to reload later.
GitHub's error answers are explained by status (401 invalid or expired token; 403 with the rate limit used up
and its reset time, or a missing permission; 404 wrong repository or token scope; 429; 5xx). Create the token
under GitHub → Settings → Developer settings → Personal access tokens → Fine-grained tokens: resource owner
netic123, repository access "Only select repositories" → investments, repository permission Actions: Read and
write (Metadata: Read is added automatically), nothing else, with a short expiry. The token is kept in that
browser's local storage (key investments.liveUpdateToken), is sent only to api.github.com, and can be removed
with ⚙ → "Forget token". Local storage is scoped by origin, not by page: every page served from
https://netic123.github.io (all Pages sites of this account — today only this one) and any browser extension
with page access can read the token; the page's Content-Security-Policy stops scripts injected into this page,
not other same-origin pages. Anyone who can use that browser profile can use the token for the same. The
permission does more than start builds: it also allows cancelling, re-running and approving this repository's
workflow runs and deleting its runs, logs, artifacts and caches — everything under Actions there, nothing
outside it; it cannot read or change code. The signed attestations survive a deleted run. The dispatch reason
is public text: api/build.json records the trigger ("workflow_dispatch", "schedule" or "push"), the reason
(shown on the About line, cut to 80 characters) and whether the tests were skipped.
Auto mode: with a token stored, ⚙ offers "Automatically rebuild while this page is open and the snapshot is
older than N minutes" (default 30, 5 to 720). While the tab is visible, the page then starts a build by itself
whenever the snapshot is older than that (checked on load and on the 10-minute re-check, judging the age from
the CDN copy of build.json), at most once per 15 minutes, following an already queued, running or
just-published build instead of starting another; after a failed automatic build it waits for a newer
snapshot or a manual Update. The setting is stored in the same browser (key investments.liveUpdateAutoMinutes).

EXTERNAL CRON (optional; not in use)
GitHub starts this repository's scheduled runs late and skips most slots (the observations are under GITHUB
PAGES). A build on a clock you control is possible: an external cron can send the same workflow_dispatch the
page's "Update (rebuild)" button sends, and scripts/dispatch-build.js does exactly that:

  GITHUB_DISPATCH_TOKEN=github_pat_... node scripts/dispatch-build.js "external cron"

The owner has decided against running one; the script stays available. For a hosted cron (for example
cron-job.org) the job would be:
  URL:      https://api.github.com/repos/netic123/investments/actions/workflows/pages.yml/dispatches
  Method:   POST
  Headers:  Accept: application/vnd.github+json
            Authorization: Bearer <fine-grained token>
            X-GitHub-Api-Version: 2022-11-28
            Content-Type: application/json
  Body:     {"ref":"main","inputs":{"skip_tests":"true","reason":"external cron"}}
  Schedule: whatever you prefer; expected answer 204.
The token is the same kind as for the live update (see the recipe and the scope there; it lives only in the
cron service's job settings; revoke it there and on GitHub to stop). A 204 only means the dispatch was queued:
each one runs behind any build already in progress (the workflow's concurrency group serialises them), skips
the suite only when a tested run of the same commit exists, and api/build.json records trigger
"workflow_dispatch" with the reason, which the page's About line shows. GitHub's own schedules keep running
either way; when both fire, the later one queues behind the earlier.

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
    file, Dalal Street's 13F position and its change vs the named prior filing, the Yahoo price in the listing
    currency vs your entry, SEK price and next report. A ticker that a 13F structurally cannot show (a listing
    only abroad, a money-market fund; config names[<ticker>].sec13f) says so instead of "not reported".
  - Every change in shares held between the two latest saved files, with a callout stating the unit
    creation/redemption when WAGN's units outstanding changed between them, a line stating what the cash-like
    rows did (never listed as trades), plus the full log
  - The whole ETF portfolio sorted by weight, with plain "Δ shares" columns, the price with its listing
    currency code, and the "Avanza (SE broker)" column: whether the line can be bought through the Swedish
    retail broker Avanza (online / by phone / not available), a note checked by hand in the configuration, not
    fetched live and carrying no checked-on date
  - Fund performance vs S&P 500 (the fund's own month-end return table) and the NAV curve
  - Dalal Street's manager-aggregated 13F — fetched from official SEC submissions + filing XML and validated by
    the build against the filing's own summary totals (declared row count and total value); the page says
    "fetched from SEC EDGAR and validated by this build", never that SEC verified anything. The config copy is a
    clearly labelled fallback only when SEC cannot be reached. A Pages build accepts only that exact dated
    fallback; after its stated next-filing deadline it still publishes the fallback, flagged pastFilingDeadline,
    and the page warns that a newer 13F may exist. The page never labels fallback as newly verified. While
    fallback is displayed, the visitor's browser also asks the CORS-enabled official SEC submissions endpoint
    whether a newer accession exists, and says so when that check could not run.
  - Independent check — SEC N-PORT: the fund's own quarterly portfolio report to SEC, held against the saved
    daily file proven to be priced as of the report date (share counts per position, with the matching method
    per row), or the statement that no such file is saved yet and when the first comparison becomes possible
  - Dates: the hand-maintained entries from data/config.json plus the fund's annual and semi-annual
    shareholder reports (Forms N-CSR and N-CSRS) as SEC's submissions index lists them at build time
  Open directly: / or /#pabrai
- Crypto, Sweden, USA, US Tech, Europe, Global = one repository-owned unified Fear & Greed model v3 (0–100),
            calculated by marketfg.js. Every tab uses the same six-component scoring engine. At each date, every raw
            component is ranked causally against all finite observations available for that component from the start
            of the current provider maximum-history response through that date. There is no rolling percentile window
            and no internal score-history truncation. Scoring requires at least 126 valid raw observations. The six
            ranks have equal weights. Scores are published and shown with one decimal everywhere (gauge, tiles,
            components, chart), and a label is the band that one-decimal value falls in (model.bands: 0–24.9 extreme
            fear, 25–44.9 fear, 45–55.9 neutral, 56–74.9 greed, 75–100 extreme greed; 24.95 rounds to 25.0 and is
            Fear); integer rounding is never used for labels. All six components are required: momentum (benchmark
            vs SMA125), strength (distance from the trailing 252-observation high, computed on a shorter window from
            126 observations until 252 exist), volatility (configured implied volatility, else realised
            20-observation volatility vs its 50-observation average, inverted), safe-haven demand (benchmark minus
            government bonds over 20 common observations), credit appetite (high yield vs investment grade relative
            to SMA125), and breadth (configured non-core/smaller series vs core/larger series relative to SMA63).
            Yahoo supplies raw histories only; no third-party sentiment score or fitted weight enters the model.
            The header KPI is "Fear & Greed · latest close": the score of the benchmark's last daily bar dated before
            the build day at its exchange (a bar dated the build day is left out until the next day, even after the
            close, because the provider may still revise it), never intraday, stamped "as of <date> — all 6 indicators
            as of that date" or "… composite of the benchmark's last bar dated before the build day; N of 6 indicators
            carried from <the distinct dates of the carried ones>" (the same stamp is in the tab's
            section note and the Indicators note). The Series list shows curated instrument names and types from
            marketfg.js (e.g. "STOXX Europe 600 (^STOXX) — price index (dividends excluded)", "Cboe Nasdaq-100
            Volatility Index (^VXN)"), keeping Yahoo's own name ("STXE 600 I", "CBOE NASDAQ 100 Voltility") in a
            tooltip. Every tab prints the market's disclosure from api/marketfg.json (benchmark type; what was and
            was not checked about its raw series, dated; a note) and its first scored date. Europe's benchmark
            ^STOXX is a price index (dividends excluded) unlike Sweden's gross total return ^OMXSBGI, and both tabs
            say so. US Tech means XLK, not QQQ or the Nasdaq-100; it was added on 27 Aug 2026 (commit 23429e4), after
            every research study and after the 24 Aug 2026 series check, and its tab says that no study covers it.
            The expanding-history BUY/SELL research signal is still computed and published in api/marketfg.json, but
            the public page does not show it (the card appears only in the local app or with #owner in the address,
            remembered for that browser tab session): it has passed no prospective validation, and a coloured
            BUY/SELL reads as a recommendation. Each Fear & Greed tab's own footer block attributes the research honestly
            (US Tech prints its own variant, naming the one fitted study that includes it): the owner's
            back-tests of the earlier v1 and v2 scores (trailing-window percentiles) found no reliable timing rule —
            seven kinds of rule on those scores, their components and benchmark prices across Crypto, Sweden, USA, Europe
            and Global rejected after costs; one Europe
            candidate on v2 failed replication and is still tracked in real time, on v2 — and this v3 score has had
            no rule search and no prospective test.
            Open directly: /#crypto /#sweden /#usa /#ustech /#europe /#global
- Crypto uses CRYPTO-BROAD-EW, a transparent daily-rebalanced equal-weight return index of BTC, ETH, SOL,
            XRP, ADA, DOGE and BNB. It is broader than BTC alone but is not literally every coin, market-cap
            weighted, investable or a point-in-time total-market history. Its breadth input compares two further
            analytical return indices: CRYPTO-CORE-EW contains BTC and ETH at equal weight; CRYPTO-NONCORE-EW
            contains SOL, XRP, ADA, DOGE and BNB at equal weight.
            IEF is the external safe-haven comparator and HYG/LQD is external US corporate-credit appetite.
            The current UTC date is excluded. The strength raw feature retains a trailing 252-observation high,
            but its resulting raw values are ranked over all available causal history rather than a 252-row window.
            Warm-up, as marketfg.js publishes it (model.warmup): strength is computed from the 126th benchmark
            observation on a trailing high whose window grows from 126 to 252; momentum needs 125 observations,
            credit 125 and breadth 63 common observations of its two series, safe-haven 21, volatility 50 (60 with
            realised volatility); each component gets a percentile only once it has 126 finite raw values, so the
            composite starts about 251 observations after the latest-starting source series — roughly eight months on
            crypto's seven-day calendar; the first scored date is 16 Dec 2020 (the page prints it per market).

HOW IT WORKS
- The fund's own daily holdings file is fetched on load/update and by the local server's 30-minute background
  capture. Successful API results have a 5-minute in-memory cache; the page refreshes every 10 minutes.
- Every new file day is saved as a snapshot in data/snapshots.json (on the public site the build's temporary
  copy, seeded from the repository file and the previously published history). Two stamps describe the file
  shown: "File first captured <time>" (when this exact file, by SHA-256, was first saved: capturedAt) and what
  the fetch behind this snapshot established (upstreamCheckedAt, upstreamCheckOutcome): "confirmed unchanged at
  <time> (the fetch behind this snapshot served the same SHA-256)", "(saved by the fetch behind this
  snapshot)", or "not re-confirmed: the fetch at <time> served a file that was rejected | failed, so this is the
  saved copy". Changes = differences in the NUMBER OF SHARES held between two snapshots: a new holding, a full
  exit or a different share count. A holding whose share count did not change is never listed, even when a cash
  creation diluted its share per WAGN unit; a raw change that is proportional to the change in units
  outstanding (an in-kind basket; tolerance half a share or 0.5 % of the move) is skipped as an ETF flow, not a
  trade. When units changed between the two files, a callout states the creation/redemption and a
  "vs pro-rata" column restates each trade relative to deploying the flow in proportion to the previous
  portfolio — context, not the headline. Files saved before 25 Aug 2026 (20 and 24 Aug) report no unit count;
  a count for them is implied from NetAssets ÷ the NAV of the previous rate date, accepted only when the
  quotient is within 0.01 of a whole number, and labelled "implied" wherever it appears (the Fund assets KPI
  splits the change since the first saved file into NAV change × unit flow on that basis); when no count can be
  implied the page says the units are unknown and does not split. In the full portfolio the "Δ shares" columns
  are plain share differences; "∝ unit flow" marks a raw move that was proportional to a flow; "Currency
  balances & other (net)" excludes the FXFXX money-market row (listed as cash-like per the configuration), and a
  second footer row gives net cash including it; a negative currency balance is reported as the file states it
  (more owed than held), without a cause. Weight moves with prices and is not itself evidence of buying or
  selling.
- If Investments is not run every weekday, several days' net changes are merged under "Changes". They are not
  proof of exact execution dates/prices; a callout says when the interval spans more than one weekday (a
  Friday → Monday pair of files is not flagged).
- The holdings file is dated the next weekday and priced at the previous NAV date; its NetAssets equals the
  official NAV × the file's own SharesOutstanding to the cent. The page asserts a pricing date on one of two
  proofs: "exact" (the NAV file reports the same unit count, or none, and NetAssets equals rounded NAV × units
  within one hundred-thousandth of NetAssets, or one dollar, whichever is larger — about $3,000 at the fund's
  current size, though every file observed so far matches to the cent) or "per-share" (NetAssets / units rounds to the NAV within half a cent although
  the unit count differs, because a creation or redemption settled after the NAV file; the page then says how
  many units, or that the NAV file carried no unit count). The NAV date must be 0–4 calendar days before the
  file date. Otherwise the pricing date is not asserted and the page prints why. The match proves the pricing
  date, not an asset total: the file's NetAssets is the rounded NAV × units, and the page shows the NAV file's
  own net assets next to it (nav.netAssets, from DailyNAV) with the difference when both files carry the same
  unit count, or "not directly comparable" when they do not. Every snapshot checked so far (25 Aug 2026 onward,
  including the creation days 27 Aug, +250,000 units, and 1 Sep, +150,000 units) matched the prior NAV date
  uniquely; api/build.json (navReconciliation, navReconciliationMode) records the result for the current one.
- Every timestamp is shown in the visitor's local time with the zone abbreviation of that instant. Locally a
  quote is labelled "Price now" only when it is at most 30 minutes old, otherwise "Last price"; on the public
  site it is always "Price at snapshot", with the quote time and, once it is more than 30 minutes old, its age,
  because the quote is as old as the build that fetched it. Prices carry their listing currency code (TI Borsa
  Istanbul TRY, IN India INR, CN Canada CAD, PW Warsaw PLN, NO Oslo NOK, no suffix USD; config
  names[<ticker>].currency overrides). The percentage next to a quote is "vs previous close". The NAV KPI shows
  the file's one-day change with the previous rate date; the market price is the fund's closing price from the
  DailyNAV file with its premium/discount, Yahoo's WAGN quote being only in the tooltip. Fear & Greed shows
  "computed <date time zone>" rather than a bare clock time, and a callout when components are carried forward
  from an earlier completed bar (the model allows up to fillDays, seven calendar days).
- Locally, the Update button re-fetches EVERYTHING: fund files, both SEC filings, Yahoo quotes and the 33 unique
  Yahoo series behind the six unified-model tabs (it takes a few seconds; the status line shows progress and
  the time with seconds, and every source shows when it was fetched). The automatic 10-minute refresh is
  gentler: it reuses daily series that are less than 15 minutes old. Crypto excludes the current UTC date;
  equity markets use their configured exchange-local daily bars. Identical numbers after an Update are therefore
  normal until another eligible daily observation is available. On GitHub Pages, Reload snapshot re-downloads
  the published JSON through the Pages CDN, which may still serve the previous deployment for up to 10 minutes
  (see GITHUB PAGES); upstream sources are fetched by the
  workflow, not by the visitor's browser.
- Every market score is computed locally in marketfg.js from full Yahoo daily histories. The 33 unique raw
  model series are cached for 15 minutes and share one 25-second fetch deadline (12 s per request attempt). A
  market history begins only when all six components can be scored; there are no three-to-five-component
  substitutes. Only completed source-local daily bars enter a score: a market's newest point is the last
  completed exchange-local date, it never moves during a trading session, and Crypto uses completed UTC dates.
  When a component's source has no completed bar for the benchmark's date, its latest score is carried forward
  for at most fillDays (seven calendar days) and the page lists the carried components with what the data
  shows, quoting marketfg.js (lagDetail, also in api/build.json carriedForwardComponents and per market in
  carriedComponents): "Yahoo listed <date> with no close (feed gap)" — the only case that is certainly a Yahoo
  gap; "no <date> bar (weekend; the source has no weekend bars)"; "no <date> bar on any of the N <venue>
  series (exchange holiday or feed gap; the model cannot tell which)" — 31 Aug 2026, a UK bank holiday, left
  every London-listed series without a bar and looks exactly like a feed gap, because the model has no exchange
  calendar; or "no <date> bar for <symbol> while other <venue> series have one (feed gap)". The page says a
  component moves forward only once its source has a newer completed bar and that a holiday leaves no bar to
  publish; nothing promises that a missing bar will appear. Observed: on 2 Sep 2026 Yahoo listed 1 Sep for the
  Xetra and Stockholm ETFs with no close and listed no 1 Sep bar at all for the London ones, on both of its
  chart endpoints, and at 13:03 UTC that day none of the twelve series had been filled on the query1 host. By
  12:20 UTC on 4 Sep 2026 every one of them carried a 1 Sep close, so that gap was repaired at some point in
  between (the moment was not observed), while the same series then listed 3 Sep with no close. Whether every
  such gap is repaired, and how quickly, is not known. Every build recomputes the whole history from Yahoo's full
  response, so a gap Yahoo fills later disappears from the next build, while a date Yahoo never fills keeps its
  composite row scored with the carried component values (within fillDays). As a further safeguard, after each
  full-history fetch a short-range request (3mo) is made and bars strictly after the full history's last date
  are appended, only when both responses agree on their last shared close (so differently adjusted series are
  never mixed); this only helps when the full-history endpoint alone trails, and api/build.json lists any such
  top-up (recentBarTopUps). That top-up is made by every getMarketFearGreed caller — the local server's
  /api/marketfg and the public build alike — so the public model computation sends two chart requests per
  symbol, 66 in all (api/marketfg.json fetchStats, copied to build.json yahooRequests) — and that count is per
  model computation: a build whose first attempt carried a component forward discards it and computes again, so
  build.json also publishes snapshotAttempts and yahooRequestsAllAttempts (132 requests over two attempts on
  4 Sep 2026). The research replays in research/ call getMarketFearGreed too and therefore also top up; only the
  lockbox collectors, which call getMarketFearGreedResearchHistory, send the 33 full-history requests alone and
  never top up, keeping the exact single request their frozen capture contracts expect. A request that fails is
  retried once on Yahoo's other chart host (query2, or query1); an HTTP 429 or 5xx answer first waits
  Retry-After seconds (default 2 s, at most 10 s) and is allowed one further host swap, so at most three
  attempts per series; a plain 4xx is not retried. The selected hostname for every symbol and full-history
  input digests are included in the public signal record. Yahoo's hosts are not assumed byte-identical or
  immutable, and its chart feed has no contractual public API/SLA, so availability and historical revision
  remain real limitations. The NAV chart covers the fund's whole life (the NAV history file's first record is
  29 Sep 2023 at $10.00; NAV per unit only, distributions not added back).
- While the server runs it also captures the fund's holdings file every 30 minutes on its own, so a file
  day is not missed when the page is closed (a missed day merges multiple days into one net quantity change).
  The public site has no such loop: it captures once per Pages build.

SOURCES AND HOW THEY WERE VERIFIED (26 Aug 2026; SEC path and pricing date re-verified 2 Sep 2026; config
dates, 13F fallback and N-PORT note re-checked 4 Sep 2026)
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
  regression and SHA-256 provenance are checked before a receipt is accepted. The Performance table is the
  fund's MonthlyPerformance file as it is: month-end returns at NAV and at market price and two S&P 500 rows;
  the file states no return basis for the fund rows (only its S&P rows are named total-return indices) and no
  inception date, so the page cites the NAV history's first record instead and notes that the NAV history
  carries no market price before 6 Feb 2026.
- Quotes (the three public focus tickers and, locally, every position in data/positions.local.json; plus the
  two FX pairs and WAGN itself, one Yahoo chart request each): Yahoo Finance. The three focus tickers were
  verified to the cent against Nasdaq's and TSX's own quote services on 26 Aug 2026; the WAGN quote was added on
  4 Sep 2026 and has not been checked against an exchange quote service (WAGN lists on NYSE Arca, which Yahoo
  reports as "PCX"). The ETF's NAV, closing market price, premium/discount
  and net assets come from the fund's DailyNAV file, not from Yahoo; Yahoo's WAGN quote (NYSE Arca) is shown
  only in the market-price tooltip. FX (USD/SEK, CAD/SEK): Yahoo's last tick; on 26 Aug 2026 it differed from
  the ECB/Riksbank daily fix by ~0.1 %. The rate and its time are shown under "Price in SEK".
- Dalal Street: official SEC EDGAR submissions for CIK 0001549575 select the newest two 13F-HR report quarters;
  primary_doc.xml and infotable.xml are fetched for both and cross-checked for manager identity, report date,
  amendment state, declared entry count and declared total value (five requests in all). The SEC User-Agent
  record, once: SEC asks automated clients to declare who they are with a contact. Before 2 Sep 2026 every Pages
  build and every local run fell back to the manual filing, for two reasons found and fixed that day: (1) SEC's
  edge answers HTTP 403, from everywhere, to any User-Agent that mentions github.com or github.io — which the old
  default did; the default is now 'netic123-investments/1.0 (public dashboard; contact via the
  netic123/investments repository)', which names no e-mail address; (2) EDGAR's submissions feed names the
  primary document through its XSL viewer path (xslForm13F_X02/primary_doc.xml), which returns HTML; the fetch
  now takes the basename so the raw XML is read. Since then every build from GitHub's runners (13 of 13 on
  2 Sep 2026 for the 13F, and every build since for both filings, per api/build.json dalalVerification and
  nportCheck) has fetched the filings from www.sec.gov with that built-in default; no SEC_USER_AGENT variable is
  set. data.sec.gov (the submissions index) accepts a declared User-Agent without an e-mail address. www.sec.gov
  has answered 403 to that default to a bare curl from the owner's own connection (2 and 4 Sep 2026: curl with
  the default and no other headers, 403; the same curl with an e-mail contact, 200), while this application's
  own client (Node fetch, with Accept and User-Agent headers) received 200 from the same connection with the
  default on 4 Sep 2026; what exactly triggers the 403 has not been established. Setting SEC_USER_AGENT to
  "<app> (<e-mail>)" remains SEC's
  requested courtesy and the first thing to try if the fallback message reappears; a value mentioning
  github.com or github.io is refused; build.json secContact and the dalal/nport results' secContact ("default"
  | "configured") record which was used, never the value. Verified 2 Sep 2026: accession 0001549575-26-000015
  (filed 13 Aug, report date 30 Jun) has four rows totalling $326,749,980 and exactly matches the labelled config
  fallback, which the page states when the automatic rows equal the configured copy; the prior filing
  0001549575-26-000009 (report date 31 Mar, filed 14 May 2026) is named as the base of every quarter-on-quarter
  change (previous.accession, linked). An amendment stops automatic publication for manual review. Labels are
  what the filings establish, not trades: "increase" / "decrease" / "unchanged" with the numbers, "first
  reported (not in the prior 13F)", "new (not reported last quarter)" and "no longer reported", each with a
  caveat where one applies, because Form 13F lets a manager omit any holding under 10,000 shares AND under
  $200,000 (KSPI, 1,702 shares and $147,461 in the 30 Jun filing, is below that; a row can appear or vanish
  without a trade). The next filing deadline is computed from the displayed filing (45 days after the next
  quarter end, a Saturday, Sunday or US federal holiday rolled to the next business day: by 16 Nov 2026 for the
  30 Sep 2026 report) and marked nextFilingSource "computed"; only the manual fallback uses the hand-typed
  config deadline and says so on the page. This still cannot be live trading data: 13F is quarterly, may arrive
  up to 45 days after quarter-end, and omits cash, shorts and many non-US or otherwise non-reportable positions.
  It is manager-submitted data; SEC publication is not an SEC audit or certification that the filing is
  accurate and complete.
- Pabrai Wagons N-PORT (independent check of the daily file): the fund's own portfolio report to SEC on Form
  N-PORT, filed by the trust Professionally Managed Portfolios (CIK 0000811030) once per series, so a dozen
  NPORT-P filings share each filing date and only the primary document names the series. The build reads the
  submissions index at data.sec.gov, keeps the NPORT-P and NPORT-P/A filings with a quarter-end report date
  (newest report date first; an amendment before the original it replaces, and the page says when it used
  one), opens primary_doc.xml one document at a time about a second apart (each document retried up to three
  times, 3 s apart) until one names a series containing "Pabrai Wagons", and records the SHA-256 of both
  responses, every accession it opened, the request count and how many quarter-end filings the index lists
  (candidateCount, 228 on 4 Sep 2026, within the roughly one thousand newest filings that submissions index page
  carries — candidateScope publishes the exact count at build time; SEC paginates the older ones, which this walk
  does not read) against the walk limit
  of 30 documents. Verified 2 Sep and 4 Sep 2026:
  accession 0001193125-26-360389, filed 21 Aug 2026, series S000098509 "Pabrai Wagons ETF" (a new series ID;
  the mutual fund it replaced in February 2026 was S000081831), report period 30 Jun 2026, 19 positions
  (18 equities and the money-market fund), net assets $209,475,318.76; it was the eighth document opened. Only
  the report for the last month of each fiscal quarter (year end 30 Jun: 31 Mar, 30 Jun, 30 Sep, 31 Dec) becomes
  public, and it is public on EDGAR as soon as the trust files it, which it must do within 60 days after that
  quarter end (the 30 Jun 2026 report was filed on 21 Aug, day 52; the trust has filed 33 to 60 days after the
  period end in every quarter since 2022). A deadline on a Saturday, Sunday or federal holiday rolls to the
  next business day, and pabrai.js models all eleven federal holidays; the check is therefore quarterly and about two months
  behind, and the trust's reports for other months belong to other series and are skipped. The comparison
  holds the N-PORT against the first saved FilePoint file dated 1–4 calendar days after the report date whose
  NetAssets per unit equals the official NAV dated the report date (normally the file dated the next weekday;
  after a market holiday a later one; the proof is printed on the page, and a file whose per-unit value does
  not match is never used); only when no NAV for the report date is available is the next-weekday file taken,
  flagged as unproven. Rows are paired by 9-character CUSIP, else by the national number inside the N-PORT
  ISIN (FilePoint's CUSIP column carries a SEDOL for most foreign names, and the N-PORT has no CUSIP for
  them), else by the first two words of the issuer name when that is unique on both sides — taken from the
  filing's untruncated <title> where it extends the archive's 30-character <name> (several of the 19 names are
  truncated there, e.g. "Reysas Gayrimenkul Yatirim Ort"; the page shows the full name and "filed as …"); share
  counts within half a share match, cash-like rows (N-PORT asset category STIV or RA, a money-market-fund
  name, or a configured cash-like ticker) are listed but not counted, and the page shows the method per row.
  No saved file is priced as of 30 Jun 2026 (saved files start 20 Aug 2026), so no comparison has been
  possible yet; the first is the 30 Sep 2026 report, which appears on EDGAR when the trust files it and is due
  within 60 days of the quarter end — 29 Nov 2026 is a Sunday, so the deadline is Mon 30 Nov 2026, and on the
  trust's record it will probably appear a week or two earlier — against the first saved file priced as of
  30 Sep 2026 (normally the one dated 1 Oct 2026). Against the unrelated 28 Aug file all 18 equities pair (3 by CUSIP, 2 by ISIN, 13 by
  name), which exercises the matching, not the holdings. When SEC's index or a document cannot be fetched or
  parsed, the build publishes "SEC N-PORT unavailable" with the reason after the dash, never a failure and
  never a claim about the fund. api/build.json records the outcome as nportCheck. Like the 13F, an N-PORT is
  fund-submitted data that SEC publishes without auditing it. The same submissions index yields the trust's
  annual and semi-annual shareholder reports for the series (Forms N-CSR and N-CSRS, recognised by the index's
  own description, matched case-insensitively on "PABRAI" — deliberately short, because the description has
  read "PABRAI WAGONS FUND", "PABRAI WAGONS ETF" and "PABRAI 6.30.24 ANNUAL" over the years;
  nport.shareholderReports.descriptionMatch publishes the fragment): nport.shareholderReports carries the newest of each, the next period end
  and the EDGAR due date (70 days after the period end, rolled past weekends and federal holidays), and it is
  published whether or not the document walk succeeded. The FY 30 Jun 2026 N-CSR was filed on EDGAR on 3 Sep
  2026 (accession 0001133228-26-012211, "PABRAI WAGONS ETF - N-CSR"); the fund's own site (wagonsetf.com/ir) had
  carried the PDF since 28 Aug 2026, which the page states for that one accession only.
- Unified Market Fear & Greed (own model): marketfg.js calculates all six tabs. Production v3 ranks each raw
  component over all finite observations supplied by Yahoo through each date; Yahoo's claim to maximum history
  is requested but not independently verifiable. Historical v1/v2 research used different score definitions
  (trailing-window percentiles) and does not validate v3; the rule searches and the Europe lockbox in
  research/ were run on those earlier scores, and the page says so. Crypto's seven constituent
  histories are BTC, ETH, SOL, XRP, ADA, DOGE and BNB; the three equal-weight return indices are reconstructed
  from their common dated closes and rebalanced analytically every day. They are not market-cap indices,
  investable portfolios or point-in-time constituent histories. The fixed August 2026 membership creates
  selection/survivorship bias in retrospective results. IEF and HYG/LQD add external US Treasury and corporate-
  credit conditions; they are not crypto-native sentiment. Weekend Crypto composites carry their latest scored
  US-market components for at most seven calendar days, and the same carry-forward applies to any market whose
  component source closed earlier than its benchmark (the page lists the carried components). The realised-
  volatility raw value is annualised with sqrt(252) wherever that realised-volatility mapping is used; for
  seven-day crypto it is not a 365-day annualised volatility, although this positive constant does not change
  its percentile score.
- The original 23 equity Yahoo series were checked for identity (ISIN/name), freshness and gaps on 24 Aug 2026;
  20 of 23 closes were verified to the cent against Nasdaq, Cboe/FRED, Avanza, Carnegie, stoxx.com,
  Xetra and LSE; no later check has been made. The three US Tech series added on 27 Aug 2026 (XLK, ^VXN, RSPT)
  have not had that check or any other second-source check, and the seven crypto pairs were not among the 23;
  each tab's disclosure (api/marketfg.json markets.<key>.disclosure) says which of its series were checked,
  without counting them, so the sentence cannot drift from the component table beside it. Model validation: the US version of the FIRST rolling-window model (v1) was compared ONCE, on
  23 Aug 2026, by hand with CNN's published index number (CNN publishes a number, not an open feed or component
  data): correlation 0.88 over 398 trading days, mean gap 8.9 points, ours on average 6 points greedier, same
  label 56 % of days, within one band 93 %. That check predates the v3 expanding-percentile score and does not
  validate it. The remaining gap is CNN's put/call and NYSE breadth inputs, which have no open data source.
  Known caveats, now also printed on the tabs: OMXSBGI is a gross total return index but STOXX 600 is a price
  index (every ex-dividend drop lowers it, so Europe's momentum, strength and safe-haven read lower than on a
  total-return benchmark; European dividends cluster in spring); Sweden/Europe use realised volatility because
  no matching implied series is configured (Europe does have VSTOXX for Euro STOXX 50 options, but this
  model applies backward-looking realised volatility to STOXX Europe 600); Sweden's two credit inputs are fund
  NAV series (Carnegie), not exchange closes, and keep Yahoo's names because no second source for their share
  class was checked; US Tech means XLK and mixes that benchmark with VXN and general US bond/credit proxies;
  the global credit ETFs (HYLD.L/CORP.L) are thinly traded, so that indicator is noisier, and Global's volatility
  input is the US ^VIX. Those dated checks do not guarantee future Yahoo availability or prove that the
  composite predicts returns. The frozen Crypto backtests evaluated model v1 with BTC as target; they do not
  validate production v3's broad benchmark or expanding percentile history.
- Event dates: data/config.json holds thirteen hand-maintained entries, every one checked against the named
  primary source on 4 Sep 2026 and saying so in its label: nine firm (the Kaspi.kz proposed dividend record date
  from its EGM notice, three TCMB rate decisions, the Pareto energy conference, Constellation's dividend record
  and payment dates, the WAGN investor call, the SEC 13F deadline 16 Nov 2026 with its arithmetic) and four
  approximate ones, prefixed "~" on the page: the three Q3 report dates, which are NOT announced yet and are
  Avanza estimates, and the earliest RIG/VAL closing, back-calculated from the DOJ 60-day commitment in both
  companies' 8-Ks of 1 Jul 2026 after both certify substantial compliance; the certification dates rest on
  press reports that no primary filing had confirmed as of 4 Sep 2026, DOJ may end the wait earlier, and other
  approvals and the shareholder votes are still needed. Re-check the companies' IR pages in mid-October. The
  WAGN annual report is deliberately not in the list: the N-CSR/N-CSRS lines come from SEC's submissions index
  at build time (see the N-PORT entry), or a due line when a period that has ended has no report on EDGAR yet.

UPDATE BY HAND
- data/positions.local.json: focus tickers, exact WAGN/Yahoo symbol, entry price/currency and estimated or
  confirmed next report date (restart after editing; Update does not reload this file)
- data/positions.public.json: the explicitly approved public GitHub Pages tickers only. Keep every entry price
  null; the Pages build fails if a personal entry price is added.
- dalalStreet: verified CUSIP-to-display-ticker mapping and last-known fallback only (manualVerifiedAt
  2026-09-04; the previous filing under previous.*). Official SEC data updates automatically, and the next
  filing deadline is computed on that path; nextFilingWindow/nextFilingDeadline are used only by the manual
  fallback (_nextFilingNote says so). After a new filing, review any unknown CUSIP label and update this mapping
  rather than retyping official share/value totals. SEC_USER_AGENT: see GITHUB PAGES and SOURCES.
- dates: upcoming events; "approx": true prefixes the date with "~"; an entry stays on the page until three
  days after its date and disappears on the fourth. _datesNote records the 4 Sep 2026 check.
- names: name, flag, Avanza status per ticker (online / telefon / nej, a hand note without a checked-on date),
  an optional currency override, and sec13f { reportable, note }: whether the security is on SEC's 13(f) list
  as far as known (US-listed shares and ADSs are; shares listed only abroad and money-market funds are not), so
  the watch card can say that absence from a 13F is structural; _namesNote explains it. The newest entry is
  ODL NO (Odfjell Drilling, Norway, online).
- nport: the trust CIK, the series-name fragment that identifies the fund's N-PORT among the trust's filings,
  and the series ID last seen (informational; the page says if a filing names a different one); the note was
  re-verified 4 Sep 2026.
- cashTickers: currency rows treated as cash (NOK was added with ODL NO). A row whose CUSIP is CASH<ISO code> is
  classified as cash even before its code is listed here, so a new trading currency does not reject the file.
  cashLike: tickers (FXFXX) shown in the tables but never listed as trades and excluded from the currency row.
- marketFearGreed: the one active model ID/version, expanding percentile mode, shared 252-observation strength
  lookback (strength emits from 126 observations), 126-observation percentile warm-up, six-component
  requirement, Yahoo symbols per market and Crypto's fixed BROAD-EW/CORE-EW/NONCORE-EW constituents; the
  curated display names and per-market disclosures live in marketfg.js (DISPLAY_NAMES, MARKET_DISCLOSURES). A
  cold calculation requires all six components. Changing a parameter, proxy or synthetic constituent changes
  the model; increment the model version, restart and preregister a new out-of-sample test. Never rewrite the
  frozen schema-3/schema-4 model-v1 BTC results to describe a later production model.
- data/snapshots.json: refreshed by the workflow's record job on main (see GITHUB PAGES); pull before editing
  it locally, or the next local commit conflicts.

IF SOMETHING GOES WRONG
- "the official holdings file could not be fetched (<reason>) — showing the last accepted file, dated <date>"
  = no usable file was received: the fund's server did not respond, or its response did not parse as a valid
  holdings file (schema, row dates, totals, CUSIPs). "the official holdings file was fetched but rejected
  (<reason>) — showing …" = a valid file was received but refused: stale (more than 5 calendar days old),
  future-dated beyond the next weekday, dated earlier than the file already saved, or an older revision
  (earlier Last-Modified) of a file date already saved. It is not saved. In both cases the page shows the last
  accepted file and its date, and the file line says "not re-confirmed".
- "pricing date of the holdings file is not asserted — <reason>" = neither reconciliation proof held. The reason
  is one of: the newest NAV date is not within the four days before the file date, NetAssets ÷ units is not
  that NAV (both values are printed), or the required fields are missing. The file itself is still shown. (Not
  shown when the CDN served a mixed set; the mixed-build warning covers that case.)
- "this snapshot is N h old, older than the T h expected … no newer build has been served to this page since
  <time>" (public site,
  every tab) = the published snapshot is older than the applicable threshold (3 h Mon–Fri 05:20–23:20 UTC, 30 h
  otherwise); every figure on the page is as of that build. Press "Show build history" to see what GitHub
  started; nothing on the page can trigger a build except the owner's live update.
- "the fund's file dated <D> is normally published by 00:30 UTC; this snapshot …" (public site, every tab) = the
  newest weekday file is not in the snapshot: either the build predates the file, or the fund had not published
  it when the build fetched, or the fetch failed. Not an error in itself. On a US market holiday and the day
  after it the line says so instead (see GITHUB PAGES).
- "a file's bytes do not match the SHA-256 that build.json publishes for it …; figures may not match" = the first
  load got a mixed set even
  after one retry; Reload snapshot a few minutes later.
- "SEC automatic refresh unavailable at build/update time (<reason>) — official filing manually verified <date>"
  = the SEC request or XML validation failed; the reason names the failed request, and api/build.json
  dalalVerification and secContact record it (see SOURCES for the User-Agent record). "SEC automatic refresh
  failed (<reason>) — showing the official filing manually verified <date>" = the browser could not load
  api/dalal.json at all. In both cases the page shows the exact dated manual fallback and separately tries to
  confirm the latest accession from SEC in the visitor's browser: "SEC's submissions index was checked from your
  browser ... still the latest 13F accession" when it could, "Filing recency unconfirmed" when that check could
  not run, or "NEW SEC FILING DETECTED" when a newer accession exists. If the message adds "is past its next
  filing deadline; a newer 13F may exist", the fallback's stated deadline has passed and the build could not
  check SEC: the Pages build does not fail on this, but the fallback must be re-verified by hand. The build
  still rejects altered fallback data.
- "SEC N-PORT check unavailable at build/update time — <reason>" = SEC's submissions index or the filing
  document could not be fetched or parsed; the reason names the request, and the N-PORT section says how many
  filings the index lists and how many documents were opened, and asserts nothing about the fund. The check
  runs again on the next build. The shareholder-report lines come from the same submissions index and survive a
  failed document walk, so the Dates section keeps showing them; only when the index itself could not be fetched
  does it say the shareholder reports could not be read from SEC's index, and assert nothing about them. "SEC N-PORT check could not be fetched (<reason>)" = the browser
  could not load api/nport.json; the Dates section then shows the configured entries only.
- "quote missing: ..." = Yahoo did not respond for that ticker; the rest works.
- "Fear & Greed <market> could not be computed" / "index series ... missing" = Yahoo did not respond and the
  required raw series could not be fetched, or a required synthetic series could not be constructed, since
  startup. Crypto requires BTC, ETH, SOL, XRP, ADA, DOGE, BNB, IEF, HYG and LQD; the other tabs require their
  configured sources. If a raw series was fetched earlier, the last successful in-memory copy may be reused with
  an explicit warning ("fallback data"). No third-party sentiment index is substituted.
- "live update: …" messages belong to the owner's live update; they end with the page reloading or with the
  GitHub answer explained (see LIVE UPDATE).
- If snapshots.json breaks, a copy is saved (snapshots.json.broken-<time>) and the history starts over.

DATED OBSERVATIONS THAT WILL AGE
Nothing below is derived from a live source; each is true as of the date it carries and must be re-measured by
hand. Where to change it when it is:
- GitHub's schedule reliability (7 of 36 slots on 3 Sep 2026; none of the first 8 on 4 Sep): SCHEDULE_NOTE in
  scripts/build-pages.js (the About line prints it), the GITHUB PAGES section above, and the comment block over
  the cron lines in .github/workflows/pages.yml.
- Runner times (build 31–61 s / 224–317 s, deploy 8–63 s, test step 183–261 s over 2–4 Sep 2026): GITHUB PAGES
  above and the timeout comment on the build job in pages.yml.
- "Every GitHub build since 2 Sep 2026 verified the SEC filings with the built-in default User-Agent": GITHUB
  PAGES and SOURCES above, the header comment of pabrai.js, the SEC_USER_AGENT comment in pages.yml and in
  scripts/build-pages.js. api/build.json dalalVerification, nportCheck and secContact are the live record.
- The N-PORT quarter dates (next report 30 Sep 2026, due 30 Nov 2026) and candidateCount 228: SOURCES above;
  the page computes both from SEC's index at each build.
- The Yahoo gap observations of 2 and 4 Sep 2026: HOW IT WORKS above.
- The 24 Aug 2026 series check (20 of 23 closes) and the 23 Aug 2026 CNN comparison: SOURCES above and
  MARKET_DISCLOSURES in marketfg.js.
- The Avanza column, the flags and the sec13f notes in data/config.json: hand notes; the flags follow the fund's
  30 Jun 2026 N-PORT and should be re-read against each new one.

Not investment advice.

LICENSE
MIT (see LICENSE). The code is yours to use; the market data belongs to its respective sources
(the fund, Yahoo Finance and SEC EDGAR) and their terms apply to the data, not to this code.
