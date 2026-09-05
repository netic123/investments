#!/usr/bin/env node
'use strict';

// Build the public GitHub Pages artifact from the app's existing HTTP contract.
// The Node server exists only for the duration of this build; Pages receives a
// strict allowlist of HTML + JSON files and never receives repository internals.

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const vm = require('vm');
const crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { isQuarterEndDate, reconcileWagnHoldingsToNav, secUserAgent, summarizeNportCheck, validateWagnHoldingsFreshness } = require('../pabrai');
const { collectSpecSymbols, hashPublicDecision, hashPublishedScoreHistory } = require('../marketfg');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '_site');
const API_OUT = path.join(OUT, 'api');
const ENDPOINTS = ['config', 'holdings', 'dalal', 'nport', 'nav', 'perf', 'quotes', 'marketfg'];
const EXPECTED_FILES = ['.nojekyll', 'index.html', 'api/build.json', ...ENDPOINTS.map(name => `api/${name}.json`)].sort();
const PUBLIC_POSITION_KEYS = ['currency', 'entry', 'fundTicker', 'nextReport', 'nextReportApprox', 'nextReportNote', 'secTicker', 'ticker', 'yahoo'];
const PUBLIC_EXPANDING_SIGNAL_KEYS = [
  'action', 'actionMeaning', 'availableAtUtc', 'cashModel',
  'decisionAsOfClose', 'decisionSha256', 'evidenceStatus', 'executeNoEarlierThanClose',
  'expectedTargetId',
  'historyEnd', 'historyObservations', 'historyScope', 'historyStart', 'historyTruncated',
  'inputsCompleted', 'inputsFresh', 'latestMaturedOutcomeThrough',
  'learnerDecisionSha256', 'learnerInputHistorySha256', 'learnerModelId', 'learnerModelVersion',
  'learnerUsesAllSuppliedHistory', 'modelId', 'modelVersion', 'providerHistoryCompleteness',
  'providerSymbolByRequestedSymbol',
  'positionStateMeaning', 'prospectiveRecorded', 'publishedScoreHistorySha256', 'reason', 'simulatedFilledPosition',
  'simulatedFilledRiskyWeight', 'simulatedTransitionRequired', 'targetId',
  'targetPosition', 'targetRiskyWeight', 'targetSuitability', 'trainingEnd',
  'trainingRows', 'trainingStart', 'x2ClaimAllowed',
  'sourceHostBySymbol', 'sourceHostFallbackUsed', 'sourceHosts',
  'upstreamScoreModelId', 'upstreamScoreModelVersion',
  'upstreamScorePercentileMode', 'upstreamScorePercentileScope',
].sort();

const assert = (condition, message) => { if (!condition) throw new Error(message); };
// Snapshot staleness, as published in api/build.json and applied by index.html.
// The workflow schedules a build every 15 minutes on weekdays (05:05-22:50 UTC, and since 5 Sep 2026 also 00:07-04:52 UTC Tue-Sat plus 12:50 UTC Sat-Sun;
// the window below is the daytime series, so the 3 h expectation is not raised at night, when GitHub's hit rate is unmeasured;
// see .github/workflows/pages.yml) and once a day at 09:20 UTC, but GitHub
// starts scheduled runs late and skips most slots, so the snapshot's age is
// the only honest freshness statement. While the daytime weekday schedule is active
// (SCHEDULE_WINDOW_UTC) a snapshot older than SNAPSHOT_STALE_AFTER_HOURS means
// no slot since has run; outside that window (weekends and nights, when only
// the daily slot exists) the threshold is SNAPSHOT_STALE_AFTER_HOURS_OFF_SCHEDULE,
// so a warning there means the daily build has also been missed.
const SNAPSHOT_STALE_AFTER_HOURS = 3;
const SNAPSHOT_STALE_AFTER_HOURS_OFF_SCHEDULE = 30;
const SCHEDULE_WINDOW_UTC = Object.freeze({ days: 'Mon-Fri', from: '05:05', to: '23:20' });
// The fund's FilePoint holdings file is normally live by this UTC time on the
// calendar day after each NYSE trading day, Saturdays included (observed at
// about 00:02 UTC on 1-5 Sep 2026; the Saturday file was dated Tue 8 Sep, the
// trading day after Labor Day); index.html can say that the expected file has
// not been captured when the snapshot is older.
const HOLDINGS_FILE_EXPECTED_BY_UTC = '00:30';
// A dated observation of how GitHub honours the schedules; keep it literal.
const SCHEDULE_NOTE = 'GitHub starts scheduled runs late and skips most slots: on Thu 3 Sep 2026 it started 7 of the 36 half-hourly weekday slots then configured, and on Fri 4 Sep 2026 6 of the first 33 by 21:30 UTC; the weekday schedule was doubled to 72 slots on 4 Sep 2026 to raise the number of attempts, and on 5 Sep 2026 a night series (00:07-04:52 UTC, Tue-Sat) and a 12:50 UTC weekend slot were added because no slot had fallen in the five hours after the fund’s 00:02 UTC file';
const WORKFLOW_PATH = path.join(ROOT, '.github', 'workflows', 'pages.yml');
const LOCAL_MODE_MARKER = '<meta name="investments-mode" content="local">';
const STATIC_MODE_MARKER = '<meta name="investments-mode" content="static">';
// Everything the public page is allowed to load or contact. Scripts are
// limited to the one inline block by hash; styles include inline style
// attributes; connections are the same-origin JSON snapshot, SEC's EDGAR
// submissions index (data.sec.gov, which the page asks from the visitor's
// browser whether a newer 13F exists, only when the build could not verify
// the 13F itself) and GitHub's public Actions API (see below).
const STATIC_CSP_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'sha256-__SCRIPT_HASH__'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  // api.github.com is contacted by a visitor's browser when the Build history
  // section is opened (an unauthenticated read of the last 20 runs of
  // pages.yml; GitHub sees an ordinary web request and nothing about the
  // visitor is sent) and by the owner's optional live update (dispatching a
  // rebuild with a token stored in that browser, then polling the run; after
  // the new build.json is live the page reloads itself).
  "connect-src 'self' https://data.sec.gov https://api.github.com",
  "img-src 'self' data:",
  "base-uri 'none'",
  "form-action 'none'",
  "object-src 'none'",
];

function inlineScript(html) {
  const blocks = html.split('<script>');
  assert(blocks.length === 2, 'index.html must contain exactly one inline <script> block');
  const end = blocks[1].indexOf('</script>');
  assert(end > 0, 'index.html inline script is not terminated');
  return blocks[1].slice(0, end);
}

// A syntax error in the inline script leaves the public page at "loading…"
// forever; compile it (without running it) before anything is deployed.
function checkInlineScript(html) {
  const source = inlineScript(html);
  try { new vm.Script(source, { filename: 'index.html (inline script)' }); }
  catch (error) { throw new Error(`index.html inline script does not compile: ${error.message}`); }
  return source;
}

function staticCsp(html) {
  const hash = crypto.createHash('sha256').update(inlineScript(html), 'utf8').digest('base64');
  return STATIC_CSP_DIRECTIVES.join('; ').replace('__SCRIPT_HASH__', hash);
}

// The commit is stamped into the page so a visitor's browser can tell whether
// the HTML the CDN served and the api/*.json it served come from the same
// build: index.html and each JSON expire independently, so a reload after a
// deployment can pair new data with the previous page code. build.json's own
// digest list cannot catch that, because a page cannot hash itself.
// Publish LF line endings whatever the checkout used. A browser normalises CRLF
// to LF before it hashes an inline script for the Content-Security-Policy, so a
// CRLF page would declare a hash the browser never computes and would block its
// own script; normalising here also makes the published bytes, and the digests
// in api/build.json, identical from a Windows and a Linux checkout.
function staticPageHtml(rawHtml, commit) {
  const sourceHtml = rawHtml.split('\r\n').join('\n');
  assert(sourceHtml.split(LOCAL_MODE_MARKER).length === 2, 'index.html must contain exactly one local-mode marker');
  assert(!sourceHtml.includes('http-equiv="Content-Security-Policy"'), 'index.html must not carry its own Content-Security-Policy; the build adds one');
  assert(!/<meta name="investments-build-commit"/.test(sourceHtml), 'index.html must not carry a build-commit marker; the build adds one');
  checkInlineScript(sourceHtml);
  const stamp = commit ? `\n<meta name="investments-build-commit" content="${String(commit).replace(/[^0-9a-zA-Z._-]/g, '')}">` : '';
  return sourceHtml.replace(LOCAL_MODE_MARKER, `${STATIC_MODE_MARKER}${stamp}\n<meta http-equiv="Content-Security-Policy" content="${staticCsp(sourceHtml)}">`);
}

function verifyStaticPage(html, commit) {
  assert(html.includes(STATIC_MODE_MARKER) && !html.includes(LOCAL_MODE_MARKER), 'published page is not in static mode');
  if (commit) {
    const stamp = /<meta name="investments-build-commit" content="([^"]*)">/.exec(html);
    assert(stamp && stamp[1] === commit, 'published page does not carry this build\'s commit');
  }
  const match = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert(match, 'published page has no Content-Security-Policy');
  assert(match[1] === staticCsp(html), 'published Content-Security-Policy does not match the inline script');
  assert(!/script-src[^;]*'unsafe-inline'/.test(match[1]), 'published Content-Security-Policy must not allow unsafe inline scripts');
  checkInlineScript(html);
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// The schedule the page describes is read from the workflow file at build time,
// so api/build.json cannot drift from pages.yml.
function workflowSchedules(workflowText) {
  return [...workflowText.matchAll(/^\s*- cron: '([^']+)'\s*$/gm)].map(match => match[1]);
}

// The one schedule slot whose runs must execute the test suite (the gate step
// in pages.yml names it); null when the workflow has no such condition.
function testedScheduleSlot(workflowText) {
  const match = /TESTED_SCHEDULE: '([^']+)'/.exec(workflowText);
  return match ? match[1] : null;
}

// Plain-English rendering of the cron shapes this workflow uses; anything else
// is printed verbatim so the sentence never claims a time the cron does not.
function describeCron(cron) {
  const parts = String(cron).trim().split(/\s+/);
  const pad = value => value.padStart(2, '0');
  if (parts.length !== 5 || parts[2] !== '*' || parts[3] !== '*') return `cron '${cron}' (UTC)`;
  const [minute, hour, , , dow] = parts;
  const days = dow === '*' ? 'every day' : dow === '1-5' ? 'Mon-Fri' : dow === '2-6' ? 'Tue-Sat' : dow === '0,6' ? 'Sat-Sun' : null;
  if (!days) return `cron '${cron}' (UTC)`;
  if (/^\d{1,2}$/.test(minute) && /^\d{1,2}$/.test(hour)) return `${pad(hour)}:${pad(minute)} UTC ${days}`;
  if (/^\d{1,2}(,\d{1,2})*$/.test(minute) && /^\d{1,2}(-\d{1,2})?(,\d{1,2}(-\d{1,2})?)*$/.test(hour)) {
    const minuteList = minute.split(',').map(m => `:${pad(m)}`);
    const minutes = minuteList.length > 1 ? `${minuteList.slice(0, -1).join(', ')} and ${minuteList[minuteList.length - 1]}` : minuteList[0];
    const hours = hour.split(',').map(h => h.split('-').map(pad).join('-')).join(' and ');
    return `${minutes} past ${hours} UTC ${days}`;
  }
  return `cron '${cron}' (UTC)`;
}

function refreshTriggerSentence(schedules, testedSlot) {
  const slots = schedules.map(cron => `${describeCron(cron)}${cron === testedSlot ? ' (with the test suite)' : ''}`);
  const scheduled = slots.length ? `, or one of the scheduled slots: ${slots.join('; ')}` : '';
  return `push to main, a dispatch (manual or the page's live update)${scheduled}. Scheduled slots other than the tested one skip the suite only when a successful tested run of the same commit exists. ${SCHEDULE_NOTE}.`;
}

const EXPECTED_MARKET_SYMBOLS = {
  crypto: {
    index: { id: 'CRYPTO-BROAD-EW', method: 'equalWeightReturns', symbols: ['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'ADA-USD', 'DOGE-USD', 'BNB-USD'] },
    vol: null, bond: 'IEF', hy: 'HYG', ig: 'LQD',
    small: { id: 'CRYPTO-NONCORE-EW', method: 'equalWeightReturns', symbols: ['SOL-USD', 'XRP-USD', 'ADA-USD', 'DOGE-USD', 'BNB-USD'] },
    large: { id: 'CRYPTO-CORE-EW', method: 'equalWeightReturns', symbols: ['BTC-USD', 'ETH-USD'] },
  },
  sweden: { index: '^OMXSBGI', vol: null, bond: 'XACT-OBLIGATION.ST', hy: '0P0001C87Y.ST', ig: '0P00000KIW.ST', small: 'XACT-SMABOLAG.ST', large: 'XACT-SVERIGE.ST' },
  usa: { index: 'SPY', vol: '^VIX', bond: 'IEF', hy: 'HYG', ig: 'LQD', small: 'IWM', large: null },
  ustech: { index: 'XLK', vol: '^VXN', bond: 'IEF', hy: 'HYG', ig: 'LQD', small: 'RSPT', large: null },
  europe: { index: '^STOXX', vol: null, bond: 'SXRQ.DE', hy: 'IHYG.L', ig: 'IEAC.L', small: 'EXSE.DE', large: 'EXSA.DE' },
  global: { index: 'ACWI', vol: '^VIX', bond: 'IEF', hy: 'HYLD.L', ig: 'CORP.L', small: 'WSML.L', large: 'IWDA.L' },
};
const EXPECTED_TARGET_SUITABILITY = Object.freeze({
  crypto: 'SYNTHETIC_ANALYTICAL_BASKET_NOT_INVESTABLE',
  sweden: 'GROSS_RETURN_REFERENCE_INDEX_NOT_EXECUTABLE_INSTRUMENT',
  usa: 'INVESTABLE_ETF_TOTAL_RETURN_PROXY_NOT_EXECUTION_RECORD_ZERO_CASH',
  ustech: 'INVESTABLE_ETF_TOTAL_RETURN_PROXY_OUTSIDE_SCHEMA5_ZERO_CASH',
  europe: 'PRICE_RETURN_INDEX_OMITS_DIVIDENDS_NOT_INVESTABLE_X2_TARGET',
  global: 'INVESTABLE_ETF_TOTAL_RETURN_PROXY_NOT_EXECUTION_RECORD_ZERO_CASH',
});

function normalizedMapping(symbols) {
  const actual = symbols || {};
  return Object.fromEntries(['index', 'vol', 'bond', 'hy', 'ig', 'small', 'large'].map(key => {
    const value = actual[key];
    return [key, value && typeof value === 'object' ? { id: value.id, method: value.method, symbols: value.symbols } : value == null ? null : value];
  }));
}

function assertMarketMapping(name, symbols, context) {
  assert(JSON.stringify(normalizedMapping(symbols)) === JSON.stringify(EXPECTED_MARKET_SYMBOLS[name]), `${context}: ${name} raw-series mapping drifted`);
}

function gitValue(args, fallback = 'unknown') {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback; }
  catch { return fallback; }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.unref();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();
      socket.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000), ...options });
  const text = await response.text();
  let value;
  try { value = JSON.parse(text); }
  catch { throw new Error(`${url} returned invalid JSON`); }
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}: ${value.error || response.statusText}`);
  return value;
}

async function waitForServer(base, child, logs) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`snapshot server exited early (${child.exitCode})\n${logs.text}`);
    try { await fetchJson(`${base}/api/config`); return; }
    catch { await delay(250); }
  }
  throw new Error(`snapshot server did not start within 30 seconds\n${logs.text}`);
}

function validateSnapshot(data, publicPositions) {
  const { config, holdings, dalal, nport, nav, perf, quotes, marketfg } = data;
  assert(config && typeof config === 'object', 'config is missing');
  assert(config.positionsMeta && config.positionsMeta.demo === false && config.positionsMeta.public === true && config.positionsMeta.source === 'public', 'public build did not select the approved public watchlist');
  assert(JSON.stringify(config.myPositions) === JSON.stringify(publicPositions), 'public build positions differ from data/positions.public.json');
  assert(config.myPositions.every(position => position.entry === null), 'public build exposed a non-null entry price');
  assert(!config.sources || !Object.prototype.hasOwnProperty.call(config.sources, 'fearGreed'), 'retired third-party crypto index source is still configured');
  assert(!Object.prototype.hasOwnProperty.call(config, 'cryptoFearGreed'), 'retired separate crypto model config is still present');
  assert(config.marketFearGreed && config.marketFearGreed.modelId === 'investments-unified-fear-greed' && config.marketFearGreed.version === 3, 'unified model config is missing or has drifted');
  assert(config.marketFearGreed.range === 'max', 'public Fear & Greed must request the provider maximum history');
  assert(config.marketFearGreed.percentileMode === 'expanding'
    && config.marketFearGreed.strengthWindow === 252
    && config.marketFearGreed.percentileMinPoints === 126
    && config.marketFearGreed.minComponents === 6
    && config.marketFearGreed.fillDays === 7
    && !Object.prototype.hasOwnProperty.call(config.marketFearGreed, 'window')
    && !Object.prototype.hasOwnProperty.call(config.marketFearGreed, 'minWindowPoints'), 'unified model parameters have drifted');
  assert(JSON.stringify(Object.keys(config.marketFearGreed.markets || {}).sort()) === JSON.stringify(['crypto', 'europe', 'global', 'sweden', 'usa', 'ustech']), 'unified config must contain exactly the six configured markets');
  assert(config.marketFearGreed.markets.crypto.barPolicy === 'completed-utc-date', 'Crypto completed-bar policy has drifted');
  for (const name of ['crypto', 'sweden', 'usa', 'ustech', 'europe', 'global']) assertMarketMapping(name, config.marketFearGreed.markets[name].symbols, 'config');

  assert(holdings && typeof holdings === 'object' && holdings.latest && typeof holdings.latest.date === 'string', `official holdings source was not fetched and no accepted receipt is available: ${holdings && holdings.fetchError || 'unknown source failure'}`);
  const holdingsLive = holdings.ok === true && !holdings.fetchError;
  if (holdingsLive) {
    assert(holdings.source && holdings.source.status === 'verified' && holdings.source.url === config.sources.holdings, 'holdings source is not the configured official WAGN feed');
    assert(holdings.source.fileDate === holdings.latest.date, 'holdings source status and parsed latest file date differ');
  } else {
    // The official feed did not respond, or served a file that failed
    // validation (stale, future-dated, regressed to an older day). The last
    // accepted receipt is still true as of its own date, so it is published
    // with that label instead of freezing NAV, quotes and every Fear & Greed
    // tab for the day; the freshness gate below still applies to it.
    assert(['unavailable', 'rejected'].includes(holdings.source && holdings.source.status), `unexpected holdings source state: ${holdings.source && holdings.source.status}`);
    process.stderr.write(`WARNING: official holdings source not accepted (${holdings.fetchError}); publishing the last accepted receipt dated ${holdings.latest.date}, labelled as such.\n`);
  }
  data.holdingsSource = holdingsLive
    ? 'official feed fetched and accepted'
    : `last accepted receipt dated ${holdings.latest.date}; official feed ${holdings.source.status} (${holdings.fetchError})`;
  assert(holdings.latest.rows && typeof holdings.latest.rows === 'object', 'holdings rows are missing');
  assert(holdings.latest.source && holdings.latest.source.url === config.sources.holdings && /^[0-9a-f]{64}$/.test(holdings.latest.source.sha256 || ''), 'latest holdings receipt lacks official provenance or SHA-256');
  assert(holdings.latest.source.fileDate === holdings.latest.date, 'holdings receipt provenance conflicts with parsed file date');
  assert(Number.isFinite(holdings.latest.sharesOutstanding) && holdings.latest.sharesOutstanding > 0, 'holdings SharesOutstanding is missing');
  // FilePoint calls the column CUSIP, but foreign holdings legitimately carry
  // seven-character SEDOLs there. Require a complete source identifier without
  // pretending every market uses the nine-character US CUSIP format.
  assert(Object.values(holdings.latest.rows).every(row => row && /^[0-9A-Z]{6,12}$/.test(row.cusip || '') && Number.isFinite(row.shares) && Number.isFinite(row.mv)), 'holdings rows lack validated security-identifier/share/value fields');
  validateWagnHoldingsFreshness(
    holdings.latest.date,
    // This is an independent publication-time gate. Never let a stored source
    // timestamp freeze the freshness clock for a later Pages build.
    new Date().toISOString(),
  );
  assert(Array.isArray(holdings.snapshots) && holdings.snapshots.length >= 1 && holdings.snapshots.some(snapshot => snapshot.date === holdings.latest.date), 'durable holdings history is missing from the API contract');
  assert(nav && typeof nav.date === 'string' && Array.isArray(nav.history) && nav.history.length > 1, 'NAV data is incomplete');
  assert(Number.isFinite(nav.nav) && nav.nav > 0, 'NAV is missing');
  // DailyNAV normally carries the unit count; when it lags DailyNAVHistorical
  // the newer historical rate has none, which only limits the reconciliation
  // proof below, so it must not fail the whole snapshot.
  assert(nav.sharesOut == null || (Number.isFinite(nav.sharesOut) && nav.sharesOut > 0), 'NAV SharesOutstanding is invalid');
  // The holdings file (dated the next NYSE trading day) is priced at the previous NAV
  // date and carries NetAssets = NAV x its own units to the cent, also when a
  // creation or redemption settled after the NAV file. index.html applies the
  // same rule client-side; the outcome is recorded in api/build.json.
  data.navReconciliation = reconcileWagnHoldingsToNav(holdings.latest, nav);
  data.navReconciled = data.navReconciliation.matched;
  if (!data.navReconciled) {
    process.stderr.write(`WARNING: pricing date not asserted (${data.navReconciliation.reason}); publishing with the unverified pricing-date label.\n`);
  }
  const officialDalal = !!(dalal && dalal.ok === true && dalal.sourceStatus === 'official SEC verified' && !dalal.fetchError);
  const labelledFallback = !!(dalal && dalal.ok === false && dalal.fallback === true && dalal.sourceStatus === 'manual fallback — SEC verification unavailable' && dalal.fetchError);
  assert(officialDalal || labelledFallback, 'Dalal Street 13F is neither official live data nor the explicitly labelled fallback');
  assert(dalal.cik === '0001549575' && /^\d{10}-\d{2}-\d{6}$/.test(dalal.accession || ''), 'Dalal Street SEC identity/accession is invalid');
  assert(/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//.test(dalal.sourceUrl || ''), 'Dalal Street source is not an official SEC filing page');
  assert(Array.isArray(dalal.holdings) && dalal.holdings.length > 0 && dalal.holdings.every(row => /^[0-9A-Z]{9}$/.test(row.cusip || '') && Number.isFinite(row.shares) && Number.isFinite(row.valueUsd)), 'Dalal Street SEC holdings are incomplete');
  assert(dalal.holdings.reduce((sum, row) => sum + row.valueUsd, 0) === dalal.portfolioValueUsd, 'Dalal Street SEC holding values do not equal the filing total');
  if (officialDalal) {
    assert(dalal.provenance && /^[0-9a-f]{64}$/.test(dalal.provenance.submissions && dalal.provenance.submissions.sha256 || '') && /^[0-9a-f]{64}$/.test(dalal.provenance.informationTable && dalal.provenance.informationTable.sha256 || ''), 'Dalal Street SEC provenance hashes are missing');
  } else {
    assert(dalal.manualVerifiedAt === config.dalalStreet.manualVerifiedAt && dalal.accession === config.dalalStreet.accession, 'Dalal fallback identity differs from the manually verified configuration');
    assert(JSON.stringify(dalal.holdings) === JSON.stringify(config.dalalStreet.holdings), 'Dalal fallback holdings differ from the manually verified configuration');
    assert(/^\d{4}-\d{2}-\d{2}$/.test(dalal.nextFilingDeadline || ''), 'Dalal fallback has no next filing deadline');
    // After the deadline a newer 13F may exist that the build could not see.
    // Failing the whole snapshot would freeze WAGN holdings, NAV, quotes and
    // every Fear & Greed tab as well; instead the fallback is published with an
    // explicit flag that index.html turns into a warning, and the visitor's
    // browser still checks SEC's submissions index for a newer accession.
    dalal.pastFilingDeadline = new Date().toISOString().slice(0, 10) > dalal.nextFilingDeadline;
    if (dalal.pastFilingDeadline) {
      process.stderr.write('WARNING: the manually verified 13F fallback is past its next filing deadline and SEC could not be checked; publishing it flagged as possibly superseded.\n');
    }
  }
  // The fund's own N-PORT is an independent cross-check of the FilePoint file
  // and nothing else depends on it, so SEC being unavailable is published as a
  // labelled state, never a build failure; a claimed success must carry its
  // identity, provenance hashes and a well-formed comparison.
  assert(nport && typeof nport === 'object', 'N-PORT check response is missing');
  if (nport.ok === true) {
    assert(nport.cik === '0000811030' && /Pabrai Wagons/.test(nport.seriesName || '') && /^S\d{9}$/.test(nport.seriesId || ''), 'N-PORT is not the Pabrai Wagons series of CIK 0000811030');
    assert(/^\d{10}-\d{2}-\d{6}$/.test(nport.accession || '') && /^NPORT-P(\/A)?$/.test(nport.form || '') && /^\d{4}-\d{2}-\d{2}$/.test(nport.filed || ''), 'N-PORT accession, form or filing date is invalid');
    assert(/^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\//.test(nport.sourceUrl || ''), 'N-PORT source is not an official SEC filing page');
    assert(isQuarterEndDate(nport.reportDate), `N-PORT report date ${nport.reportDate} is not a quarter end`);
    assert(nport.provenance && /^[0-9a-f]{64}$/.test(nport.provenance.submissions && nport.provenance.submissions.sha256 || '') && /^[0-9a-f]{64}$/.test(nport.provenance.primary && nport.provenance.primary.sha256 || ''), 'N-PORT SEC provenance hashes are missing');
    assert(Array.isArray(nport.holdings) && nport.holdings.length > 0 && nport.holdings.every(row => row && typeof row.name === 'string' && Number.isFinite(row.balance) && Number.isFinite(row.valUsd)), 'N-PORT holdings are incomplete');
    const comparison = nport.comparison;
    assert(comparison && typeof comparison.comparable === 'boolean' && /^\d{4}-\d{2}-\d{2}$/.test(comparison.snapshotDate || '') && comparison.reportDate === nport.reportDate, 'N-PORT comparison is malformed');
    for (const key of ['matched', 'mismatched', 'onlyInNport', 'onlyInHoldings', 'cashLike']) assert(Array.isArray(comparison[key]), `N-PORT comparison ${key} is not a list`);
    assert(comparison.summary && Number.isInteger(comparison.summary.matched) && Number.isInteger(comparison.summary.positions), 'N-PORT comparison summary is malformed');
    if (comparison.comparable) {
      assert(comparison.summary.matched === comparison.matched.length && comparison.summary.mismatched === comparison.mismatched.length, 'N-PORT comparison counts do not match its rows');
      assert(comparison.matched.concat(comparison.mismatched).every(row => ['cusip', 'isin', 'name'].includes(row.method)), 'N-PORT comparison rows lack a match method');
    } else {
      assert(typeof comparison.reason === 'string' && comparison.reason.length > 0, 'N-PORT not-comparable state lacks a reason');
      assert(nport.nextOpportunity && /^\d{4}-\d{2}-\d{2}$/.test(nport.nextOpportunity.reportDate || ''), 'N-PORT next opportunity is missing');
    }
  } else {
    assert(nport.ok === false && typeof nport.fetchError === 'string' && nport.fetchError.length > 0 && nport.sourceStatus === 'SEC N-PORT unavailable', 'N-PORT check is neither fetched data nor a labelled unavailable state');
    process.stderr.write(`WARNING: SEC N-PORT check unavailable (${nport.fetchError}); publishing that state, labelled as such.\n`);
  }
  assert(!JSON.stringify(nport).includes('<edgarSubmission'), 'N-PORT response must not carry raw XML');
  assert(perf && Array.isArray(perf.monthly) && perf.monthly.length > 0, 'performance data is incomplete');
  assert(quotes && typeof quotes === 'object' && Object.values(quotes).some(q => q && Number.isFinite(q.price)), 'all quotes are missing');
  assert(marketfg && marketfg.ok === true && marketfg.markets && typeof marketfg.markets === 'object', 'market Fear & Greed is invalid');
  assert(marketfg.model && marketfg.model.id === 'investments-unified-fear-greed' && marketfg.model.version === 3 && marketfg.model.owner === 'repository', 'market result does not identify the unified repository model');
  assert(marketfg.model.range === 'max', 'public Fear & Greed result did not use the provider maximum history');
  assert(marketfg.model.method === 'equal-weight causal-expanding-percentile six-component composite'
    && marketfg.model.percentileMode === 'expanding'
    && marketfg.model.percentileScope === 'ALL_FINITE_COMPONENT_RAW_OBSERVATIONS_FROM_CURRENT_PROVIDER_MAX_RESPONSE_THROUGH_EACH_DATE'
    && marketfg.model.percentileMinPoints === 126
    && marketfg.model.percentileHistoryTruncated === false
    && marketfg.model.providerHistoryCompleteness === 'UNVERIFIED'
    && marketfg.model.strengthWindow === 252
    && !Object.prototype.hasOwnProperty.call(marketfg.model, 'percentileWindow')
    && marketfg.model.minComponents === 6 && marketfg.model.fillDays === 7, 'unified result parameters have drifted');
  assert(marketfg.model.expandingSignal && marketfg.model.expandingSignal.id === 'FG-ONLINE-RIDGE-PREQ-FG3-V1' && marketfg.model.expandingSignal.version === 1, 'expanding binary pipeline identity is missing');
  assert(marketfg.model.expandingSignal.learnerId === 'FG-ONLINE-RIDGE-PREQ-V1'
    && marketfg.model.expandingSignal.learnerVersion === 1
    && marketfg.model.expandingSignal.upstreamScoreModelId === marketfg.model.id
    && marketfg.model.expandingSignal.upstreamScoreModelVersion === marketfg.model.version
    && marketfg.model.expandingSignal.minimumMaturedRows === 252
    && /REQUIRES_REVALIDATION.*NOT_VALIDATED/.test(marketfg.model.expandingSignal.evidenceStatus), 'expanding learner status or upstream binding drifted');
  assert(JSON.stringify(Object.keys(marketfg.markets).sort()) === JSON.stringify(['crypto', 'europe', 'global', 'sweden', 'usa', 'ustech']), 'unified model must return exactly the six configured markets');
  const componentKeys = ['breadth', 'credit', 'momentum', 'safeHaven', 'strength', 'volatility'];
  for (const name of ['crypto', 'sweden', 'usa', 'ustech', 'europe', 'global']) {
    const market = marketfg.markets[name];
    assert(market && Number.isFinite(market.score) && market.score >= 0 && market.score <= 100, `market Fear & Greed is missing ${name}`);
    assert(Array.isArray(market.history) && market.history.length > 1, `market Fear & Greed history is incomplete for ${name}`);
    assert(market.n === 6 && market.total === 6, `${name} is not using all six unified-model components`);
    assert(JSON.stringify(Object.keys(market.components || {}).sort()) === JSON.stringify(componentKeys), `${name} component contract is incomplete`);
    assert(Object.values(market.components).every(component => Number.isFinite(component.score) && component.asOf), `${name} has an unavailable current component`);
    assert(market.history.every(row => Number.isFinite(row.score) && row.score >= 0 && row.score <= 100 && row.n === 6), `${name} history changes the unified model definition`);
    assertMarketMapping(name, market.mapping && market.mapping.symbols, 'result');
    assert(market.mapping && market.mapping.barPolicy === 'completed-source-local-date' && market.intraday === false, `${name} does not prove source-local completed bars`);
    const signal = market.expandingSignal;
    assert(signal && JSON.stringify(Object.keys(signal).sort()) === JSON.stringify(PUBLIC_EXPANDING_SIGNAL_KEYS), `${name} expanding signal public allowlist drifted`);
    assert(signal.modelId === 'FG-ONLINE-RIDGE-PREQ-FG3-V1'
      && signal.modelVersion === 1
      && signal.learnerModelId === 'FG-ONLINE-RIDGE-PREQ-V1'
      && signal.learnerModelVersion === 1
      && signal.upstreamScoreModelId === marketfg.model.id
      && signal.upstreamScoreModelVersion === marketfg.model.version
      && signal.upstreamScorePercentileMode === marketfg.model.percentileMode
      && signal.upstreamScorePercentileScope === marketfg.model.percentileScope
      && ['BUY', 'SELL'].includes(signal.action), `${name} expanding signal identity/action is invalid`);
    assert(signal.actionMeaning === 'TARGET_POSITION'
      && signal.targetPosition === (signal.action === 'BUY' ? 'LONG' : 'CASH')
      && signal.positionStateMeaning === 'RETROSPECTIVE_SIMULATION_ONLY_NOT_ACTUAL_HOLDING_OR_EXECUTION'
      && ['LONG', 'CASH'].includes(signal.simulatedFilledPosition)
      && signal.targetRiskyWeight === (signal.targetPosition === 'LONG' ? 1 : 0)
      && signal.simulatedFilledRiskyWeight === (signal.simulatedFilledPosition === 'LONG' ? 1 : 0)
      && typeof signal.simulatedTransitionRequired === 'boolean'
      && signal.simulatedTransitionRequired === (signal.targetPosition !== signal.simulatedFilledPosition), `${name} expanding signal is not an exact binary target state`);
    const expectedTargetId = typeof EXPECTED_MARKET_SYMBOLS[name].index === 'object'
      ? EXPECTED_MARKET_SYMBOLS[name].index.id
      : EXPECTED_MARKET_SYMBOLS[name].index;
    assert(signal.decisionAsOfClose === market.asOf && signal.targetId === market.indexSymbol && signal.expectedTargetId === expectedTargetId && signal.targetId === signal.expectedTargetId, `${name} signal does not identify the reviewed completed target close`);
    assert(signal.executeNoEarlierThanClose === 'FIRST_TARGET_CLOSE_STRICTLY_AFTER_FEATURE_CLOSE_AND_AVAILABLE_AT_UTC' && Number.isFinite(Date.parse(signal.availableAtUtc || '')), `${name} signal execution/availability contract is incomplete`);
    assert(signal.historyStart === market.history[0].date && signal.historyEnd === market.history.at(-1).date && signal.historyObservations === market.history.length && signal.historyTruncated === false, `${name} expanding signal is not using the full published score history`);
    assert(signal.historyScope === 'ALL_USABLE_SCORE_ROWS_FROM_CURRENT_PROVIDER_MAX_RESPONSE'
      && signal.learnerUsesAllSuppliedHistory === true
      && signal.providerHistoryCompleteness === 'UNVERIFIED',
    `${name} expanding signal overstates external provider-history completeness`);
    assert(/^[0-9a-f]{64}$/.test(signal.publishedScoreHistorySha256 || '')
      && signal.publishedScoreHistorySha256 === hashPublishedScoreHistory(market.history)
      && /^[0-9a-f]{64}$/.test(signal.learnerInputHistorySha256 || ''), `${name} full-history input hashes are missing or invalid`);
    const sourceHostBySymbol = signal.sourceHostBySymbol || {};
    const providerSymbolByRequestedSymbol = signal.providerSymbolByRequestedSymbol || {};
    const expectedSourceSymbols = [...new Set(Object.values(EXPECTED_MARKET_SYMBOLS[name])
      .flatMap(spec => collectSpecSymbols(spec)))].sort();
    const usedHosts = [...new Set(Object.values(sourceHostBySymbol))].sort();
    assert(JSON.stringify(Object.keys(sourceHostBySymbol).sort()) === JSON.stringify(expectedSourceSymbols)
      && JSON.stringify(Object.keys(providerSymbolByRequestedSymbol).sort()) === JSON.stringify(expectedSourceSymbols)
      && expectedSourceSymbols.every(symbol => providerSymbolByRequestedSymbol[symbol] === symbol)
      && Object.values(sourceHostBySymbol).every(host => ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'].includes(host))
      && JSON.stringify(signal.sourceHosts) === JSON.stringify(usedHosts)
      && signal.sourceHostFallbackUsed === usedHosts.includes('query2.finance.yahoo.com'), `${name} Yahoo host provenance is incomplete`);
    assert(Number.isInteger(signal.trainingRows) && signal.trainingRows >= 252 && signal.trainingStart && signal.trainingEnd && signal.latestMaturedOutcomeThrough, `${name} expanding training span is incomplete`);
    assert(signal.inputsCompleted === true && signal.inputsFresh === true, `${name} expanding signal was produced from incomplete or stale inputs`);
    assert(signal.targetSuitability === EXPECTED_TARGET_SUITABILITY[name], `${name} target suitability disclosure drifted`);
    assert(signal.cashModel === 'ZERO_RETURN_DEVELOPMENT_ASSUMPTION'
      && signal.evidenceStatus === 'RETROSPECTIVE_PREQUENTIAL_RESEARCH_REQUIRES_REVALIDATION_FOR_UPSTREAM_SCORE_V3_NOT_VALIDATED'
      && signal.prospectiveRecorded === false && signal.x2ClaimAllowed === false, `${name} expanding signal overstates evidence or cash`);
    assert(/^[0-9a-f]{64}$/.test(signal.learnerDecisionSha256 || ''), `${name} learner decision hash is missing`);
    assert(/^[0-9a-f]{64}$/.test(signal.decisionSha256 || '')
      && signal.decisionSha256 !== signal.learnerDecisionSha256
      && signal.decisionSha256 === hashPublicDecision(signal), `${name} upstream-bound public decision hash is missing or invalid`);
    assert(!Object.prototype.hasOwnProperty.call(signal, 'prices') && !Object.prototype.hasOwnProperty.call(signal, 'parts') && !Object.prototype.hasOwnProperty.call(signal, 'features') && !Object.prototype.hasOwnProperty.call(signal, 'coefficients'), `${name} expanding signal exposes internal histories or fit parameters`);
  }
  const crypto = marketfg.markets.crypto;
  assert(crypto.indexSymbol === 'CRYPTO-BROAD-EW' && crypto.indexName === 'Broad crypto equal-weight basket', 'Crypto result is not using the broad repository-owned benchmark');
  for (const component of ['momentum', 'strength', 'volatility']) {
    assert(JSON.stringify(crypto.components[component].symbols) === JSON.stringify(['CRYPTO-BROAD-EW']), `Crypto ${component} is not based on the broad benchmark`);
  }
  assert(JSON.stringify(crypto.components.safeHaven.symbols) === JSON.stringify(['CRYPTO-BROAD-EW', 'IEF']), 'Crypto safe-haven component is not based on the broad benchmark');
  assert(crypto.mapping && crypto.mapping.configuredBarPolicy === 'completed-utc-date' && crypto.mapping.barPolicy === 'completed-source-local-date' && crypto.intraday === false, 'Crypto result does not prove completed source-local bars');
  assert(crypto.asOf < new Date().toISOString().slice(0, 10), 'Crypto result includes the still-forming current UTC bar');
}

function carriedForwardComponents(marketfg) {
  const out = [];
  for (const [market, value] of Object.entries((marketfg && marketfg.markets) || {})) {
    for (const [key, component] of Object.entries((value && value.components) || {})) {
      if (component && component.lag && component.asOf) out.push(`${market}.${key}@${component.asOf}${component.lagDetail ? ` (${component.lagDetail})` : ''}`);
    }
  }
  return out.sort();
}

// Which series had newer bars appended by the 3-month top-up request
// (marketfg.js topUpRecentBars). Who asks for that top-up, exactly: every
// getMarketFearGreed caller — the local server's /api/marketfg, this public
// build, and the research replays in research/ that call it — unless the
// config sets topUpRecentBars to false. Only the lockbox collectors, which go
// through getMarketFearGreedResearchHistory (includeExpandingSignal false),
// keep the single full-history request their frozen capture contracts expect.
// So it is the public contract, not the public build alone, that doubles the
// Yahoo chart requests.
function recentBarTopUps(marketfg) {
  const out = new Map();
  for (const value of Object.values((marketfg && marketfg.markets) || {})) {
    for (const [symbol, topUp] of Object.entries((value && value.recentBarTopUps) || {})) {
      if (topUp && topUp.appended > 0) out.set(symbol, `${symbol} +${topUp.appended} (${topUp.from}..${topUp.to})`);
    }
  }
  return [...out.values()].sort();
}

// Snapshot retry budget (the build job's timeout-minutes in pages.yml must
// leave room for it after the test suite): up to 3 attempts, all eight
// endpoints fetched in parallel with a 120 s timeout each (fetchJson), and
// waits of 20 s after attempt 1 and 40 s after attempt 2.
async function captureSnapshot(base, publicPositions) {
  let lastError;
  // marketfg.js counts chart requests per model computation. A retried build
  // computes the model again from an empty cache, so the published count is
  // only the last attempt's; these totals keep the discarded ones visible.
  let discardedYahooRequests = 0;
  let attemptsMade = 0;
  const retryReasons = [];
  for (let attempt = 1; attempt <= 3; attempt++) {
    attemptsMade = attempt;
    try {
      const pairs = await Promise.all(ENDPOINTS.map(async name => [name, await fetchJson(`${base}/api/${name}`)]));
      const data = Object.fromEntries(pairs);
      // Prefer a live official holdings file: retry a failed fetch before
      // settling for the labelled last accepted receipt on the final attempt.
      if (attempt < 3 && !(data.holdings && data.holdings.ok === true)) {
        const retry = new Error(`official holdings source was not accepted: ${data.holdings && data.holdings.fetchError || 'unknown source failure'}`);
        retry.fetchStats = data.marketfg && data.marketfg.fetchStats;
        throw retry;
      }
      // Yahoo's full-history responses sometimes lag a source's newest completed
      // bars by a day or two, in which case the model carries the affected
      // component forward (up to fillDays) and the page labels it. An exchange
      // holiday (31 Aug 2026, a UK bank holiday, left the London-listed series
      // without a bar) produces exactly the same lagDetail as a feed gap, and
      // without an exchange calendar the build cannot tell the two apart. So
      // the retry below is a guess, not a fix: it is made once, never fails
      // the build, and when the gap was a holiday it changes nothing. The
      // retry is not cheap: /api/refresh?force=1 clears the server's route
      // cache and the whole Yahoo series cache, so attempt 2 repeats every
      // upstream fetch (the fund's files, the 13F and N-PORT requests to SEC,
      // the position and FX quotes, and each Yahoo series with its 3-month
      // top-up), and any attempt 3 does so again.
      const carried = carriedForwardComponents(data.marketfg);
      if (attempt === 1 && carried.length) {
        const retry = new Error(`Fear & Greed components carried forward from earlier bars: ${carried.join(', ')}`);
        retry.fetchStats = data.marketfg && data.marketfg.fetchStats;
        throw retry;
      }
      data.carriedForwardComponents = carried;
      data.snapshotAttempts = attemptsMade;
      data.discardedYahooRequests = discardedYahooRequests;
      data.snapshotRetryReasons = retryReasons;
      data.recentBarTopUps = recentBarTopUps(data.marketfg);
      if (data.recentBarTopUps.length) process.stderr.write(`NOTE: recent bars appended from short-range requests: ${data.recentBarTopUps.join(', ')}\n`);
      if (carried.length) process.stderr.write(`WARNING: publishing with carried-forward Fear & Greed components: ${carried.join(', ')}\n`);
      try { validateSnapshot(data, publicPositions); }
      catch (error) { if (error && typeof error === 'object') error.fetchStats = data.marketfg && data.marketfg.fetchStats; throw error; }
      return data;
    } catch (error) {
      lastError = error;
      // Whatever this attempt fetched is thrown away, but Yahoo was asked for
      // it: keep the count so build.json can report what the build really sent.
      const attemptStats = error && error.fetchStats;
      discardedYahooRequests += Number(attemptStats && attemptStats.requests) || 0;
      retryReasons.push(`attempt ${attempt}: ${String(error && error.message || error).slice(0, 160)}`);
      if (attempt === 3) break;
      process.stderr.write(`Snapshot attempt ${attempt} failed: ${error.message}. Retrying…\n`);
      try { await fetchJson(`${base}/api/refresh?force=1`, { method: 'POST' }); } catch {}
      await delay(attempt === 1 ? 20000 : 40000);
    }
  }
  throw lastError;
}

function usableSnapshots(value, { requireProvenance = false } = {}) {
  if (!value || typeof value !== 'object') return [];
  const candidates = Array.isArray(value.snapshots) ? value.snapshots : [value.first, value.previous, value.latest];
  return candidates.filter(snapshot => {
    if (!snapshot || !/^\d{4}-\d{2}-\d{2}$/.test(snapshot.date || '') || !snapshot.rows || typeof snapshot.rows !== 'object') return false;
    const source = snapshot.source;
    if (source && (source.fileDate !== snapshot.date || !/^[0-9a-f]{64}$/.test(source.sha256 || ''))) return false;
    // Only the committed repository copy may carry legacy receipts without provenance.
    return requireProvenance ? !!source : true;
  });
}

const capturedAtMs = snapshot => Date.parse((snapshot.source && snapshot.source.capturedAt) || '') || 0;

function mergeSnapshots(...lists) {
  const byDate = new Map();
  for (const list of lists) for (const snapshot of list || []) {
    const existing = byDate.get(snapshot.date);
    if (!existing || capturedAtMs(snapshot) >= capturedAtMs(existing)) byDate.set(snapshot.date, snapshot);
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

const PUBLISHED_HOLDINGS_URL = 'https://netic123.github.io/investments/api/holdings.json';

function assertPublishedHoldingsUrl(url) {
  const parsed = new URL(url);
  assert(parsed.protocol === 'https:' && parsed.hostname === 'netic123.github.io' && parsed.pathname === '/investments/api/holdings.json', 'previous public holdings URL is not the approved GitHub Pages endpoint');
  return parsed;
}

// The published history is one input of the next build (the other is the
// committed data/snapshots.json, which the workflow's record job refreshes
// from the published file, so the repository holds a durable copy). A
// transient CDN failure is retried before it fails the build.
async function fetchPublishedJson(url, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await fetchJson(url, { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' } }); }
    catch (error) {
      lastError = error;
      if (attempt < attempts) await delay(5000 * attempt);
    }
  }
  throw lastError;
}

async function loadPreviousPublishedSnapshots() {
  const url = process.env.INVESTMENTS_PREVIOUS_PUBLIC_HOLDINGS_URL;
  if (!url) {
    // A GitHub build without the published history would republish only the
    // committed copy and shorten the public log; refuse rather than do so silently.
    assert(!process.env.GITHUB_ACTIONS, 'INVESTMENTS_PREVIOUS_PUBLIC_HOLDINGS_URL must be set for a GitHub build');
    return { snapshots: [], previousCount: 0 };
  }
  const parsed = assertPublishedHoldingsUrl(url);
  const value = await fetchPublishedJson(url);
  const snapshots = usableSnapshots(value, { requireProvenance: true });
  assert(snapshots.length > 0, 'previous public holdings endpoint contains no reusable snapshots');
  // The previous build.json says how many receipts the last build carried; a
  // shorter list now would mean history was lost somewhere upstream.
  let previousCount = 0;
  try {
    const previousBuild = await fetchPublishedJson(`${parsed.origin}/investments/api/build.json`, 1);
    if (previousBuild && Number.isInteger(previousBuild.carriedSnapshotCount)) previousCount = previousBuild.carriedSnapshotCount;
  } catch (error) {
    process.stderr.write(`NOTE: previous api/build.json could not be read (${error.message}); the history lower bound is not checked.\n`);
  }
  return { snapshots, previousCount };
}

function prepareOutput() {
  assert(path.dirname(OUT) === ROOT && path.basename(OUT) === '_site', 'refusing to clean an unexpected output path');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(API_OUT, { recursive: true });
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, 'utf8');
}

function artifactFiles(dir, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), `symbolic links are forbidden in the Pages artifact: ${path.join(prefix, entry.name)}`);
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...artifactFiles(path.join(dir, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`unexpected artifact entry: ${relative}`);
  }
  return files.sort();
}

const DIGESTED_FILES = ['index.html', ...ENDPOINTS.map(name => `api/${name}.json`)];

function artifactDigests(dir, relatives) {
  return Object.fromEntries(relatives.map(relative => [
    relative, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, relative))).digest('hex'),
  ]));
}

function verifyArtifact(forbiddenSecrets, commit) {
  const actual = artifactFiles(OUT);
  assert(JSON.stringify(actual) === JSON.stringify(EXPECTED_FILES), `unexpected Pages artifact manifest:\n${actual.join('\n')}`);
  for (const relative of actual.filter(name => name.endsWith('.json'))) {
    JSON.parse(fs.readFileSync(path.join(OUT, relative), 'utf8'));
  }
  verifyStaticPage(fs.readFileSync(path.join(OUT, 'index.html'), 'utf8'), commit);
  for (const secret of forbiddenSecrets) {
    for (const relative of actual) {
      const bytes = fs.readFileSync(path.join(OUT, relative));
      assert(!bytes.includes(Buffer.from(secret)), `an environment secret was found in ${relative}`);
    }
  }
  for (const retiredMarker of ['pro-api.coinmarketcap.com', 'CMC_API_KEY', '/api/feargreed', 'cryptoFearGreed', 'five equally weighted indicators']) {
    for (const relative of actual) {
      const bytes = fs.readFileSync(path.join(OUT, relative));
      assert(!bytes.includes(Buffer.from(retiredMarker)), `retired crypto-index integration marker found in ${relative}`);
    }
  }
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  const graceful = await Promise.race([exited.then(() => true), delay(5000).then(() => false)]);
  if (!graceful && child.exitCode == null) {
    child.kill('SIGKILL');
    await Promise.race([exited, delay(5000)]);
  }
}

async function main() {
  const publicWatchlist = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'positions.public.json'), 'utf8'));
  assert(Array.isArray(publicWatchlist.myPositions), 'data/positions.public.json has no myPositions list');
  const expectedPublicPositions = [
    { ticker: 'CSU.TO', fundTicker: 'CSU CN', yahoo: 'CSU.TO' },
    { ticker: 'KSPI', fundTicker: 'KSPI', yahoo: 'KSPI' },
    { ticker: 'HCC', fundTicker: 'HCC', yahoo: 'HCC' },
  ];
  assert(publicWatchlist.myPositions.length === expectedPublicPositions.length, 'public watchlist must contain exactly the three approved positions');
  for (let index = 0; index < expectedPublicPositions.length; index++) {
    const position = publicWatchlist.myPositions[index];
    const expected = expectedPublicPositions[index];
    assert(position && position.ticker === expected.ticker && position.fundTicker === expected.fundTicker && position.yahoo === expected.yahoo, `public watchlist position ${index + 1} has drifted`);
    assert(position.entry === null, `public watchlist position ${expected.ticker} must not publish an entry price`);
    const unexpectedKeys = Object.keys(position).filter(key => !PUBLIC_POSITION_KEYS.includes(key));
    assert(unexpectedKeys.length === 0, `public watchlist position ${expected.ticker} contains forbidden fields: ${unexpectedKeys.join(', ')}`);
  }
  const forbiddenSecrets = ['GH_TOKEN', 'GITHUB_TOKEN']
    .map(name => process.env[name]).filter(value => typeof value === 'string' && value.length >= 8);

  // Fail before any network work if the page itself cannot run.
  checkInlineScript(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'));

  const committedSnapshots = fs.existsSync(path.join(ROOT, 'data', 'snapshots.json'))
    ? usableSnapshots({ snapshots: JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'snapshots.json'), 'utf8')) })
    : [];
  const previousPublished = await loadPreviousPublishedSnapshots();
  const carriedSnapshots = mergeSnapshots(committedSnapshots, previousPublished.snapshots);
  assert(carriedSnapshots.length > 0, 'no seed holdings snapshots are available');
  assert(carriedSnapshots.length >= previousPublished.previousCount || process.env.INVESTMENTS_ALLOW_SNAPSHOT_HISTORY_SHRINK === '1',
    `refusing to publish ${carriedSnapshots.length} holdings receipts when the previous build carried ${previousPublished.previousCount} (set INVESTMENTS_ALLOW_SNAPSHOT_HISTORY_SHRINK=1 to accept a shorter history)`);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'investments-pages-'));
  const snapshotPath = path.join(temp, 'snapshots.json');
  fs.writeFileSync(snapshotPath, `${JSON.stringify(carriedSnapshots)}\n`, 'utf8');

  let child;
  const logs = { text: '' };
  try {
    const port = await getFreePort();
    const base = `http://127.0.0.1:${port}`;
    // Pass only runtime basics. In particular, do not give the public snapshot
    // server GitHub tokens, Actions runtime credentials, or arbitrary secrets.
    const childEnv = {};
    for (const name of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS']) {
      if (process.env[name]) childEnv[name] = process.env[name];
    }
    // SEC asks automated clients to identify themselves. The optional
    // repository variable SEC_USER_AGENT supplies a declared User-Agent with a
    // contact address; it is not set for this repository, and every GitHub
    // build since 2 Sep 2026 fetched and verified the 13F, and the N-PORT once
    // that check existed, with the built-in default. www.sec.gov has answered
    // 403 to that default to a bare curl from the owner's own connection,
    // while this application's own client (Node fetch, with Accept and
    // User-Agent) received 200 from the same connection on 4 Sep 2026; what
    // exactly triggers the 403 has not been established. A value is validated here so a rejected one
    // (anything mentioning github.com/github.io) fails loudly instead of
    // silently degrading every build to the manual 13F fallback. Which
    // contact was used is recorded in api/build.json (secContact), never the
    // value.
    const secContact = process.env.SEC_USER_AGENT && process.env.SEC_USER_AGENT.trim()
      ? 'repository variable SEC_USER_AGENT'
      : 'built-in default (no e-mail contact)';
    if (process.env.SEC_USER_AGENT && process.env.SEC_USER_AGENT.trim()) childEnv.SEC_USER_AGENT = secUserAgent(process.env.SEC_USER_AGENT);
    child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...childEnv,
        PORT: String(port),
        NO_OPEN: '1',
        INVESTMENTS_PUBLIC_BUILD: '1',
        INVESTMENTS_SNAPSHOT_PATH: snapshotPath,
      },
    });
    const collectLog = chunk => { logs.text = (logs.text + chunk.toString()).slice(-20000); };
    child.stdout.on('data', collectLog);
    child.stderr.on('data', collectLog);

    await waitForServer(base, child, logs);
    const data = await captureSnapshot(base, publicWatchlist.myPositions);
    if (secContact.startsWith('built-in default') && (!data.dalal.ok || !data.nport.ok)) {
      process.stderr.write('WARNING: an SEC request failed while the built-in default User-Agent was in use (no SEC_USER_AGENT variable); see dalalVerification and nportCheck in api/build.json.\n');
    }
    const workflowText = fs.existsSync(WORKFLOW_PATH) ? fs.readFileSync(WORKFLOW_PATH, 'utf8') : '';
    const schedules = workflowSchedules(workflowText);
    const testedSlot = testedScheduleSlot(workflowText);
    const testsVerifiedBy = /^https:\/\/github\.com\/[^\s]+\/actions\/runs\/\d+$/.test(process.env.INVESTMENTS_BUILD_TESTS_VERIFIED_BY || '')
      ? process.env.INVESTMENTS_BUILD_TESTS_VERIFIED_BY
      : null;
    const generatedAt = new Date().toISOString();
    const build = {
      generatedAt,
      commit: process.env.GITHUB_SHA || gitValue(['rev-parse', 'HEAD']),
      ref: process.env.GITHUB_REF_NAME || gitValue(['branch', '--show-current']),
      // A local build may run on uncommitted changes; the commit alone would then overstate provenance.
      dirty: process.env.GITHUB_SHA ? false : gitValue(['status', '--porcelain'], '') !== '',
      trigger: process.env.INVESTMENTS_BUILD_TRIGGER || (process.env.GITHUB_SHA ? 'unknown' : 'local'),
      // The Actions run that produced this snapshot (its log is public), and
      // how to verify GitHub's signed provenance statement for each file.
      runId: process.env.GITHUB_RUN_ID || null,
      runUrl: process.env.GITHUB_RUN_ID && process.env.GITHUB_REPOSITORY
        ? `${process.env.GITHUB_SERVER_URL || 'https://github.com'}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
        : null,
      attestation: process.env.GITHUB_RUN_ID ? 'GitHub artifact attestation (SLSA provenance) signed for this run; with a GitHub account: gh attestation verify <file> --owner netic123' : null,
      schedule: process.env.INVESTMENTS_BUILD_SCHEDULE || null,
      reason: process.env.INVESTMENTS_BUILD_REASON || null,
      // Derived by the workflow from the test step's real outcome, not from
      // the trigger; when the suite was skipped, testsVerifiedBy is the earlier
      // successful run of this workflow for the same commit whose test step
      // passed (the gate step only allows the skip when such a run exists).
      testsSkipped: process.env.INVESTMENTS_BUILD_TESTS_SKIPPED === 'true',
      testsVerifiedBy,
      dataMode: 'build-time snapshot',
      watchlist: 'public-no-entry-prices',
      // Read from pages.yml at build time so the description cannot drift from
      // the workflow; the cron strings are published as written there.
      refreshTrigger: refreshTriggerSentence(schedules, testedSlot),
      schedules,
      testedSchedule: testedSlot,
      scheduleNote: SCHEDULE_NOTE,
      snapshotStaleAfterHours: SNAPSHOT_STALE_AFTER_HOURS,
      snapshotStaleAfterHoursOffSchedule: SNAPSHOT_STALE_AFTER_HOURS_OFF_SCHEDULE,
      scheduleWindowUtc: { ...SCHEDULE_WINDOW_UTC },
      holdingsFileExpectedByUtc: HOLDINGS_FILE_EXPECTED_BY_UTC,
      carriedSnapshotCount: carriedSnapshots.length,
      historyDurability: 'push builds and the daily 09:20 UTC slot (when GitHub runs it) commit new receipts to data/snapshots.json, but only bytes that match the digest this build published for them; every build also imports the previously published history',
      holdingsSource: data.holdingsSource,
      carriedForwardComponents: data.carriedForwardComponents,
      recentBarTopUps: data.recentBarTopUps,
      // What the published model computation asked Yahoo for (marketfg.js
      // counts per call). A retried build computed the model more than once
      // from an empty cache, so snapshotAttempts and yahooRequestsAllAttempts
      // say what the whole build sent; the page shows both.
      yahooRequests: (data.marketfg && data.marketfg.fetchStats) ?? null,
      snapshotAttempts: data.snapshotAttempts ?? null,
      // whether a close Yahoo lacked was filled from the listing venue in this build (marketfg.js fillVenueGap), per market
      venueFills: Object.fromEntries(Object.entries((data.marketfg && data.marketfg.markets) || {}).map(([key, market]) => [key, market.venueFills || {}])),
      // why each earlier attempt was discarded (its model computation, and its requests, were repeated)
      snapshotRetryReasons: data.snapshotRetryReasons || [],
      yahooRequestsAllAttempts: data.marketfg && data.marketfg.fetchStats
        ? (Number(data.marketfg.fetchStats.requests) || 0) + (data.discardedYahooRequests || 0)
        : null,
      // Which SEC contact the build used, never its value: the repository
      // variable SEC_USER_AGENT when set, else the built-in default.
      secContact,
      dalalVerification: data.dalal.ok
        ? 'official SEC fetched and validated'
        : `labelled manual fallback verified ${data.dalal.manualVerifiedAt}; live SEC check failed (${data.dalal.fetchError})${data.dalal.pastFilingDeadline ? '; past the next filing deadline, a newer filing may exist' : ''}`,
      navReconciliation: data.navReconciled
        ? (data.navReconciliation.mode === 'exact'
          ? `holdings NetAssets and SharesOutstanding reconcile to the official NAV receipt dated ${data.navReconciliation.navDate}`
          : data.navReconciliation.unitChange
            ? `holdings NetAssets per unit reconcile to the official NAV dated ${data.navReconciliation.navDate}; the file carries ${Math.abs(data.navReconciliation.unitChange)} ${data.navReconciliation.unitChange > 0 ? 'more' : 'fewer'} units than the NAV file of that date (a ${data.navReconciliation.unitChange > 0 ? 'creation' : 'redemption'} booked after that NAV was struck)`
            : `holdings NetAssets per unit reconcile to the official NAV dated ${data.navReconciliation.navDate}${data.navReconciliation.navFileShares == null ? ' (the NAV file carried no unit count)' : ''}`)
        : `pricing date not asserted: ${data.navReconciliation.reason}`,
      navReconciliationMode: data.navReconciliation.mode,
      nportCheck: summarizeNportCheck(data.nport),
    };

    prepareOutput();
    const sourceHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    fs.writeFileSync(path.join(OUT, 'index.html'), staticPageHtml(sourceHtml, build.commit), 'utf8');
    fs.writeFileSync(path.join(OUT, '.nojekyll'), '', 'utf8');
    for (const name of ENDPOINTS) writeJson(path.join(API_OUT, `${name}.json`), data[name]);
    // SHA-256 of the exact bytes just written for index.html and every
    // api/*.json except build.json itself, which cannot carry its own digest
    // (the empty .nojekyll marker is the only other published file and is not
    // hashed). A reader can check that what the CDN serves is what this run
    // produced, and index.html can tell whether the JSON files it fetched all
    // come from this build; the workflow's attestation step signs these files
    // and build.json as well.
    build.files = artifactDigests(OUT, DIGESTED_FILES);
    writeJson(path.join(API_OUT, 'build.json'), build);
    verifyArtifact(forbiddenSecrets, build.commit);

    const totalBytes = artifactFiles(OUT).reduce((sum, file) => sum + fs.statSync(path.join(OUT, file)).size, 0);
    process.stdout.write(`${JSON.stringify({ ok: true, output: '_site', fileCount: EXPECTED_FILES.length, bytes: totalBytes, ...build })}\n`);
  } catch (error) {
    if (logs.text) process.stderr.write(`Snapshot server log:\n${logs.text}\n`);
    throw error;
  } finally {
    await stopChild(child);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = {
  DIGESTED_FILES, ENDPOINTS, HOLDINGS_FILE_EXPECTED_BY_UTC, PUBLISHED_HOLDINGS_URL, SCHEDULE_NOTE, SCHEDULE_WINDOW_UTC,
  SNAPSHOT_STALE_AFTER_HOURS, SNAPSHOT_STALE_AFTER_HOURS_OFF_SCHEDULE, STATIC_CSP_DIRECTIVES,
  artifactDigests, assertPublishedHoldingsUrl, checkInlineScript, describeCron, inlineScript, mergeSnapshots,
  refreshTriggerSentence, staticCsp, staticPageHtml, testedScheduleSlot, usableSnapshots, verifyStaticPage, workflowSchedules,
};

if (require.main === module) main().catch(error => {
  process.stderr.write(`Pages build failed: ${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});
