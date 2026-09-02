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
const { reconcileWagnHoldingsToNav, secUserAgent, validateWagnHoldingsFreshness } = require('../pabrai');
const { collectSpecSymbols, hashPublicDecision, hashPublishedScoreHistory } = require('../marketfg');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '_site');
const API_OUT = path.join(OUT, 'api');
const ENDPOINTS = ['config', 'holdings', 'dalal', 'nav', 'perf', 'quotes', 'marketfg'];
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
// The published page may be older than a visitor expects when a scheduled build
// fails; index.html warns once the snapshot is older than this (a daily build
// was missed).
const SNAPSHOT_STALE_AFTER_HOURS = 30;
const LOCAL_MODE_MARKER = '<meta name="investments-mode" content="local">';
const STATIC_MODE_MARKER = '<meta name="investments-mode" content="static">';
// Everything the public page is allowed to load or contact. Scripts are
// limited to the one inline block by hash; styles include inline style
// attributes; connections are the same-origin JSON snapshot plus SEC's
// EDGAR submissions index, which the page asks (from the visitor's browser)
// whether a newer 13F exists.
const STATIC_CSP_DIRECTIVES = [
  "default-src 'none'",
  "script-src 'sha256-__SCRIPT_HASH__'",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  // api.github.com only serves the owner's optional live update (dispatching a
  // rebuild with a token stored in that browser); visitors never contact it.
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

function staticPageHtml(sourceHtml) {
  assert(sourceHtml.split(LOCAL_MODE_MARKER).length === 2, 'index.html must contain exactly one local-mode marker');
  assert(!sourceHtml.includes('http-equiv="Content-Security-Policy"'), 'index.html must not carry its own Content-Security-Policy; the build adds one');
  checkInlineScript(sourceHtml);
  return sourceHtml.replace(LOCAL_MODE_MARKER, `${STATIC_MODE_MARKER}\n<meta http-equiv="Content-Security-Policy" content="${staticCsp(sourceHtml)}">`);
}

function verifyStaticPage(html) {
  assert(html.includes(STATIC_MODE_MARKER) && !html.includes(LOCAL_MODE_MARKER), 'published page is not in static mode');
  const match = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(html);
  assert(match, 'published page has no Content-Security-Policy');
  assert(match[1] === staticCsp(html), 'published Content-Security-Policy does not match the inline script');
  assert(!/script-src[^;]*'unsafe-inline'/.test(match[1]), 'published Content-Security-Policy must not allow unsafe inline scripts');
  checkInlineScript(html);
}
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
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
  const { config, holdings, dalal, nav, perf, quotes, marketfg } = data;
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
  // The holdings file (dated the next weekday) is priced at the previous NAV
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
      if (component && component.lag && component.asOf) out.push(`${market}.${key}@${component.asOf}`);
    }
  }
  return out.sort();
}

async function captureSnapshot(base, publicPositions) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const pairs = await Promise.all(ENDPOINTS.map(async name => [name, await fetchJson(`${base}/api/${name}`)]));
      const data = Object.fromEntries(pairs);
      // Prefer a live official holdings file: retry a failed fetch before
      // settling for the labelled last accepted receipt on the final attempt.
      if (attempt < 3 && !(data.holdings && data.holdings.ok === true)) {
        throw new Error(`official holdings source was not accepted: ${data.holdings && data.holdings.fetchError || 'unknown source failure'}`);
      }
      // Yahoo's full-history responses sometimes lag a source's newest completed
      // bars by a day or two, in which case the model carries the affected
      // component forward (up to fillDays) and the page labels it. A forced
      // re-fetch sometimes returns the missing bars, so try that once; an
      // exchange holiday produces the same lag legitimately, which is why this
      // is a single retry and never a failure.
      const carried = carriedForwardComponents(data.marketfg);
      if (attempt === 1 && carried.length) {
        throw new Error(`Fear & Greed components carried forward from earlier bars: ${carried.join(', ')}`);
      }
      data.carriedForwardComponents = carried;
      if (carried.length) process.stderr.write(`WARNING: publishing with carried-forward Fear & Greed components: ${carried.join(', ')}\n`);
      validateSnapshot(data, publicPositions);
      return data;
    } catch (error) {
      lastError = error;
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

async function loadPreviousPublishedSnapshots() {
  const url = process.env.INVESTMENTS_PREVIOUS_PUBLIC_HOLDINGS_URL;
  if (!url) return [];
  const parsed = new URL(url);
  assert(parsed.protocol === 'https:' && parsed.hostname === 'netic123.github.io' && parsed.pathname === '/investments/api/holdings.json', 'previous public holdings URL is not the approved GitHub Pages endpoint');
  const value = await fetchJson(url);
  const snapshots = usableSnapshots(value, { requireProvenance: true });
  assert(snapshots.length > 0, 'previous public holdings endpoint contains no reusable snapshots');
  return snapshots;
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

function verifyArtifact(forbiddenSecrets) {
  const actual = artifactFiles(OUT);
  assert(JSON.stringify(actual) === JSON.stringify(EXPECTED_FILES), `unexpected Pages artifact manifest:\n${actual.join('\n')}`);
  for (const relative of actual.filter(name => name.endsWith('.json'))) {
    JSON.parse(fs.readFileSync(path.join(OUT, relative), 'utf8'));
  }
  verifyStaticPage(fs.readFileSync(path.join(OUT, 'index.html'), 'utf8'));
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
  const previousPublishedSnapshots = await loadPreviousPublishedSnapshots();
  const carriedSnapshots = mergeSnapshots(committedSnapshots, previousPublishedSnapshots);
  assert(carriedSnapshots.length > 0, 'no seed holdings snapshots are available');

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
    // SEC asks automated clients to identify themselves; an optional repository
    // variable supplies a real contact. It is validated here so a rejected
    // value (anything mentioning github.com/github.io) fails loudly instead of
    // silently degrading every build to the manual 13F fallback.
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
    const generatedAt = new Date().toISOString();
    const build = {
      generatedAt,
      commit: process.env.GITHUB_SHA || gitValue(['rev-parse', 'HEAD']),
      ref: process.env.GITHUB_REF_NAME || gitValue(['branch', '--show-current']),
      // A local build may run on uncommitted changes; the commit alone would then overstate provenance.
      dirty: process.env.GITHUB_SHA ? false : gitValue(['status', '--porcelain'], '') !== '',
      trigger: process.env.INVESTMENTS_BUILD_TRIGGER || (process.env.GITHUB_SHA ? 'unknown' : 'local'),
      schedule: process.env.INVESTMENTS_BUILD_SCHEDULE || null,
      reason: process.env.INVESTMENTS_BUILD_REASON || null,
      testsSkipped: process.env.INVESTMENTS_BUILD_TESTS_SKIPPED === 'true',
      dataMode: 'build-time snapshot',
      watchlist: 'public-no-entry-prices',
      refreshTrigger: 'push to main, a dispatch (manual or the page\'s live update), or the schedules: 09:20 UTC daily with the test suite and every 30 minutes 05:20-22:50 UTC Mon-Fri without it (GitHub may start scheduled runs late)',
      snapshotStaleAfterHours: SNAPSHOT_STALE_AFTER_HOURS,
      carriedSnapshotCount: carriedSnapshots.length,
      holdingsSource: data.holdingsSource,
      carriedForwardComponents: data.carriedForwardComponents,
      dalalVerification: data.dalal.ok
        ? 'official SEC fetched and validated'
        : `labelled manual fallback verified ${data.dalal.manualVerifiedAt}; live SEC check failed (${data.dalal.fetchError})${data.dalal.pastFilingDeadline ? '; past the next filing deadline, a newer filing may exist' : ''}`,
      navReconciliation: data.navReconciled
        ? (data.navReconciliation.mode === 'exact'
          ? `holdings NetAssets and SharesOutstanding reconcile to the official NAV receipt dated ${data.navReconciliation.navDate}`
          : data.navReconciliation.unitChange
            ? `holdings NetAssets per unit reconcile to the official NAV dated ${data.navReconciliation.navDate}; ${data.navReconciliation.unitChange} units were created/redeemed after that NAV file`
            : `holdings NetAssets per unit reconcile to the official NAV dated ${data.navReconciliation.navDate}${data.navReconciliation.navFileShares == null ? ' (the NAV file carried no unit count)' : ''}`)
        : `pricing date not asserted: ${data.navReconciliation.reason}`,
      navReconciliationMode: data.navReconciliation.mode,
    };

    prepareOutput();
    const sourceHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    fs.writeFileSync(path.join(OUT, 'index.html'), staticPageHtml(sourceHtml), 'utf8');
    fs.writeFileSync(path.join(OUT, '.nojekyll'), '', 'utf8');
    for (const name of ENDPOINTS) writeJson(path.join(API_OUT, `${name}.json`), data[name]);
    writeJson(path.join(API_OUT, 'build.json'), build);
    verifyArtifact(forbiddenSecrets);

    const totalBytes = artifactFiles(OUT).reduce((sum, file) => sum + fs.statSync(path.join(OUT, file)).size, 0);
    process.stdout.write(`${JSON.stringify({ ok: true, output: '_site', files: EXPECTED_FILES.length, bytes: totalBytes, ...build })}\n`);
  } catch (error) {
    if (logs.text) process.stderr.write(`Snapshot server log:\n${logs.text}\n`);
    throw error;
  } finally {
    await stopChild(child);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = { STATIC_CSP_DIRECTIVES, SNAPSHOT_STALE_AFTER_HOURS, checkInlineScript, inlineScript, mergeSnapshots, staticCsp, staticPageHtml, usableSnapshots, verifyStaticPage };

if (require.main === module) main().catch(error => {
  process.stderr.write(`Pages build failed: ${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});
