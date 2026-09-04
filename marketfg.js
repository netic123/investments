'use strict';
// marketfg.js — one repository-owned "Fear & Greed" model for every configured market.
// Used by server.js (/api/marketfg). No dependencies, requires Node 18+.
//
// The model is CNN-inspired (CNN Fear & Greed Index for the US) but computed entirely locally from daily closes
// in Yahoo Finance. Crypto and equity markets use the same six-component engine, causal expanding-percentile
// scoring, directions and weights; only the explicitly configured raw-market proxies differ. In particular,
// volatility is an implied-volatility level where configured and benchmark realised volatility otherwise.
// Six indicators, the same for every market:
//   momentum   benchmark vs its 125-observation average                         (+ = greed)
//   strength   benchmark distance from its trailing 252-observation high        (+ = greed)
//   volatility configured volatility series, else realised 20-observation vol    (− = high vol = fear)
//   safeHaven  20-common-observation return of benchmark minus safe-haven proxy   (+ = greed)
//   credit     high yield / investment grade vs 125-observation average          (+ = greed)
//   breadth    configured broader-risk / core proxy vs 63-observation average     (+ = greed)
// Each raw series → percentile rank (0–100) against every finite observation available through that date.
// Composite = the equal-weight mean of all six indicators. Labels:
// 0–24.9 Extreme Fear · 25–44.9 Fear · 45–55.9 Neutral · 56–74.9 Greed · 75–100 Extreme Greed.

const expandingBinary = require('./research/fear_greed_expanding_binary');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Investments/1.0';
const SERIES_TTL_MS = 15 * 60 * 1000; // daily data effectively changes once a day — don't fetch more often
const seriesCache = new Map();         // symbol + requested range -> { t, p }
const lastGood = new Map();            // symbol + requested range -> last successful series

// range 'max' = each series' full history on Yahoo (SPY since 1993, ^VIX since 1990 …); the composite reaches back as far as ≥ minComponents indicators exist
const DEFAULTS = {
  modelId: 'investments-unified-fear-greed', version: 3,
  range: 'max', percentileMode: 'expanding', strengthWindow: 252,
  percentileMinPoints: 126, minComponents: 6,
  // Score history is intentionally uncapped: the expanding learner and public
  // chart both retain the entire usable history for each market.
  fillDays: 7, timeoutMs: 25000, concurrency: 6,
};
const LABELS = [[0, 24.9, 'Extreme Fear'], [25, 44.9, 'Fear'], [45, 55.9, 'Neutral'], [56, 74.9, 'Greed'], [75, 100, 'Extreme Greed']];
const LEGACY_LABELS = [[0, 24, 'Extreme Fear'], [25, 44, 'Fear'], [45, 55, 'Neutral'], [56, 74, 'Greed'], [75, 100, 'Extreme Greed']];
// The same bands as LABELS, published as objects so the page and README quote
// the edges instead of restating them. A score is rounded to one decimal first
// and then classified, so 24.95 rounds to 25.0 and is Fear, 24.94 is 24.9 and
// Extreme Fear; nothing is ever classified from an integer-rounded value.
const BANDS = Object.freeze(LABELS.map(([min, max, label]) => Object.freeze({ min, max, label })));
const BANDS_MEANING = 'the published score is the composite rounded to one decimal and the label is the band that one-decimal value falls in; integer rounding is never used for labels';
// What the code actually needs before a market's first composite row exists
// (see compMomentum, compStrength, compRelSma, compSafeHaven, compRatioVsSma,
// expandingPctScores and computeMarket). Published as model.warmup so the page
// and README quote it instead of guessing.
const ordinal = n => `${n}${[11, 12, 13].includes(n % 100) ? 'th' : ['th', 'st', 'nd', 'rd'][Math.min(n % 10, 4) % 4] || 'th'}`;
function warmupDescription(strengthWindow, minPts) {
  // strength: first raw value at observation minPts, then minPts finite raws -> observation 2*minPts-1 (251 for 126)
  // momentum and credit: first raw value at observation 125, then minPts finite raws -> observation minPts+124 (250 for 126)
  const strengthFirst = 2 * minPts - 1;
  const smaFirst = 124 + minPts;
  return `strength is computed from the ${ordinal(minPts)} benchmark observation onward on a trailing high whose window grows from ${minPts} to ${strengthWindow} observations (a partial window until ${strengthWindow} exist); momentum needs 125 benchmark observations, credit 125 and breadth 63 common observations of its two series, safe-haven 21 common observations, volatility 50 observations of the configured series (60 with realised volatility); each component receives a percentile only once it has ${minPts} finite raw values, so strength is first scored at the benchmark's ${ordinal(strengthFirst)} observation, momentum at its ${ordinal(smaFirst)} and credit at the ${ordinal(smaFirst)} common observation of its two series; the composite starts on the first benchmark date on which all six components have a percentile (each within fillDays), about ${Math.max(strengthFirst, smaFirst)} observations after the latest-starting source series`;
}
const WARMUP = Object.freeze({
  strengthWindow: DEFAULTS.strengthWindow,
  percentileMinPoints: DEFAULTS.percentileMinPoints,
  description: warmupDescription(DEFAULTS.strengthWindow, DEFAULTS.percentileMinPoints),
});
const PUBLIC_PERCENTILE_SCOPE = 'ALL_FINITE_COMPONENT_RAW_OBSERVATIONS_FROM_CURRENT_PROVIDER_MAX_RESPONSE_THROUGH_EACH_DATE';
const PUBLIC_SIGNAL_MODEL_ID = 'FG-ONLINE-RIDGE-PREQ-FG3-V1';
const PUBLIC_SIGNAL_MODEL_VERSION = 1;
// Suitability codes of each market's learner target. They are asserted
// verbatim by scripts/build-pages.js. OUTSIDE_SCHEMA5 on ustech means the
// market was added after the five-market research schema (Crypto, Sweden,
// USA, Europe, Global): no rule search, replication or lockbox covers it.
// europe's code records that ^STOXX is a price index (dividends excluded).
const TARGET_DISCLOSURES = Object.freeze({
  crypto: Object.freeze({ expectedTargetId: 'CRYPTO-BROAD-EW', requiresAdjusted: false, suitability: 'SYNTHETIC_ANALYTICAL_BASKET_NOT_INVESTABLE' }),
  sweden: Object.freeze({ expectedTargetId: '^OMXSBGI', requiresAdjusted: false, suitability: 'GROSS_RETURN_REFERENCE_INDEX_NOT_EXECUTABLE_INSTRUMENT' }),
  usa: Object.freeze({ expectedTargetId: 'SPY', requiresAdjusted: true, suitability: 'INVESTABLE_ETF_TOTAL_RETURN_PROXY_NOT_EXECUTION_RECORD_ZERO_CASH' }),
  ustech: Object.freeze({ expectedTargetId: 'XLK', requiresAdjusted: true, suitability: 'INVESTABLE_ETF_TOTAL_RETURN_PROXY_OUTSIDE_SCHEMA5_ZERO_CASH' }),
  europe: Object.freeze({ expectedTargetId: '^STOXX', requiresAdjusted: false, suitability: 'PRICE_RETURN_INDEX_OMITS_DIVIDENDS_NOT_INVESTABLE_X2_TARGET' }),
  global: Object.freeze({ expectedTargetId: 'ACWI', requiresAdjusted: true, suitability: 'INVESTABLE_ETF_TOTAL_RETURN_PROXY_NOT_EXECUTION_RECORD_ZERO_CASH' }),
});

// Proper instrument names and types for the 33 configured Yahoo symbols. Yahoo's
// own meta names are abbreviated or misspelt ("STXE 600 I", "CBOE NASDAQ 100
// Voltility"); the page shows these instead and keeps Yahoo's name as
// providerName. The two Stockholm fund NAV series keep Yahoo's name because no
// second source for their exact share class was checked; their type says so.
const DISPLAY_NAMES = Object.freeze({
  '^STOXX': { name: 'STOXX Europe 600', type: 'price index (dividends excluded)' },
  '^OMXSBGI': { name: 'OMX Stockholm Benchmark GI', type: 'gross total return index' },
  '^VIX': { name: 'Cboe Volatility Index', type: 'implied volatility index' },
  '^VXN': { name: 'Cboe Nasdaq-100 Volatility Index', type: 'implied volatility index' },
  SPY: { name: 'SPDR S&P 500 ETF Trust', type: 'ETF' },
  XLK: { name: 'State Street Technology Select Sector SPDR ETF', type: 'ETF' },
  ACWI: { name: 'iShares MSCI ACWI ETF', type: 'ETF' },
  IEF: { name: 'iShares 7-10 Year Treasury Bond ETF', type: 'ETF' },
  HYG: { name: 'iShares iBoxx $ High Yield Corporate Bond ETF', type: 'ETF' },
  LQD: { name: 'iShares iBoxx $ Investment Grade Corporate Bond ETF', type: 'ETF' },
  IWM: { name: 'iShares Russell 2000 ETF', type: 'ETF' },
  RSPT: { name: 'Invesco S&P 500 Equal Weight Technology ETF', type: 'ETF' },
  'SXRQ.DE': { name: 'iShares € Govt Bond 7-10yr UCITS ETF EUR (Acc)', type: 'UCITS ETF, Xetra' },
  'IHYG.L': { name: 'iShares € High Yield Corp Bond UCITS ETF EUR (Dist)', type: 'UCITS ETF, London' },
  'IEAC.L': { name: 'iShares Core € Corp Bond UCITS ETF EUR (Dist)', type: 'UCITS ETF, London' },
  'EXSE.DE': { name: 'iShares STOXX Europe Small 200 UCITS ETF (DE)', type: 'UCITS ETF, Xetra' },
  'EXSA.DE': { name: 'iShares STOXX Europe 600 UCITS ETF (DE) EUR (Dist)', type: 'UCITS ETF, Xetra' },
  'HYLD.L': { name: 'iShares Global High Yield Corp Bond UCITS ETF USD (Dist)', type: 'UCITS ETF, London' },
  'CORP.L': { name: 'iShares Global Corp Bond UCITS ETF USD (Dist)', type: 'UCITS ETF, London' },
  'WSML.L': { name: 'iShares MSCI World Small Cap UCITS ETF USD (Acc)', type: 'UCITS ETF, London' },
  'IWDA.L': { name: 'iShares Core MSCI World UCITS ETF USD (Acc)', type: 'UCITS ETF, London' },
  'XACT-OBLIGATION.ST': { name: 'XACT Obligation (UCITS ETF)', type: 'UCITS ETF, Stockholm' },
  'XACT-SMABOLAG.ST': { name: 'XACT Svenska Småbolag (UCITS ETF)', type: 'UCITS ETF, Stockholm' },
  'XACT-SVERIGE.ST': { name: 'XACT Sverige (UCITS ETF)', type: 'UCITS ETF, Stockholm' },
  '0P0001C87Y.ST': { name: null, type: 'fund NAV series (Yahoo name)' },
  '0P00000KIW.ST': { name: null, type: 'fund NAV series (Yahoo name)' },
  'BTC-USD': { name: 'Bitcoin USD', type: 'crypto pair' },
  'ETH-USD': { name: 'Ethereum USD', type: 'crypto pair' },
  'SOL-USD': { name: 'Solana USD', type: 'crypto pair' },
  'XRP-USD': { name: 'XRP USD', type: 'crypto pair' },
  'ADA-USD': { name: 'Cardano USD', type: 'crypto pair' },
  'DOGE-USD': { name: 'Dogecoin USD', type: 'crypto pair' },
  'BNB-USD': { name: 'BNB USD', type: 'crypto pair' },
});

// Listing venue from the symbol alone (Yahoo's meta carries no exchange
// calendar). Used by lagDetailFor to say whether a missing bar is shared by
// every series of that venue in the market (an exchange holiday or a feed gap
// covering the venue; the model cannot tell which) or by one series only (a
// feed gap).
function venueOf(symbol) {
  const s = String(symbol || '');
  if (/^0P[0-9A-Z]+\.ST$/.test(s)) return 'Stockholm fund NAV';
  if (s.endsWith('.L')) return 'London-listed';
  if (s.endsWith('.DE')) return 'Xetra-listed';
  if (s.endsWith('.ST')) return 'Stockholm-listed';
  if (s.endsWith('-USD')) return 'crypto';
  if (s === '^VIX' || s === '^VXN') return 'US-listed'; // Cboe indices follow the US exchange calendar
  if (s === '^STOXX') return 'STOXX Europe index';
  if (s === '^OMXSBGI') return 'Stockholm-listed';
  if (s.startsWith('^')) return 'index';
  return 'US-listed';
}

// What was and was not checked about each market's raw series, dated. The
// 24 Aug 2026 check covered the 23 non-crypto series configured at the time
// (identity by ISIN/name, freshness, gaps; 20 of the 23 closes verified to the
// cent against Nasdaq, Cboe/FRED, Avanza, Carnegie, stoxx.com, Xetra and LSE;
// see README). The seven crypto pairs and the three US Tech series were not
// part of it, and no research study in research/ covers US Tech.
const CHECK_23 = 'among the 23 series whose identity, freshness and gaps were checked on 24 Aug 2026 (20 of the 23 closes verified to the cent against a second source)';
// 4 Sep 2026: the ten US-listed series (SPY, XLK, ACWI, IEF, HYG, LQD, IWM, RSPT, ^VIX, ^VXN) were checked again by
// hand: the name and every close from 20 Aug to 3 Sep 2026 against Nasdaq's historical table (the eight ETFs) or
// Cboe's published daily history (the two indices), 111 closes in all, and Yahoo's dividend adjustment of IEF, HYG
// and LQD for their 1 Sep 2026 ex-dates against the amounts and the prior closes. The sixteen European and Swedish
// series and the seven crypto pairs were not part of it.
const CHECK_US = 'checked again on 4 Sep 2026: name and every close from 20 Aug to 3 Sep 2026 verified to the cent against Nasdaq (the ETFs) or Cboe’s published daily history (^VIX, ^VXN), and Yahoo’s dividend adjustment of IEF, HYG and LQD for their 1 Sep 2026 ex-dates reproduced to six decimals from the amounts and the prior closes';
const MARKET_DISCLOSURES = Object.freeze({
  crypto: Object.freeze({
    benchmarkType: 'repository-built daily-rebalanced equal-weight return index of seven Yahoo crypto pairs (not investable, not market-cap weighted)',
    verified: `IEF, HYG and LQD were ${CHECK_23} and ${CHECK_US}; the seven crypto pairs were not among those 23 series and have had no second-source check`,
    note: 'volatility is the basket\'s realised 20-observation volatility against its 50-observation average, because no implied-volatility series exists for it; it is backward-looking and behaves differently from a VIX-style measure. IEF and HYG/LQD are external US Treasury and corporate-credit proxies, not crypto-native sentiment; they trade on weekdays only, so weekend composites carry their latest scored values',
  }),
  sweden: Object.freeze({
    benchmarkType: 'gross total return index (OMX Stockholm Benchmark GI, dividends reinvested)',
    verified: `every series of this market was ${CHECK_23}; no later check`,
    note: 'realised volatility is used because no matching implied-volatility series is configured; the two credit inputs are fund NAV series (Carnegie), not exchange-traded closes',
  }),
  usa: Object.freeze({
    benchmarkType: 'ETF total-return proxy (SPY, dividend-adjusted closes)',
    verified: `every series of this market was ${CHECK_23} and ${CHECK_US}`,
    note: 'CNN\'s put/call and NYSE breadth inputs have no open data source and are not replicated',
  }),
  ustech: Object.freeze({
    benchmarkType: 'ETF total-return proxy (XLK, dividend-adjusted closes); XLK is the S&P 500 technology sector, not QQQ or the Nasdaq-100',
    verified: `XLK, ^VXN and RSPT were added on 27 Aug 2026, after the 24 Aug 2026 check, and IEF, HYG and LQD were ${CHECK_23}; all six were ${CHECK_US}`,
    note: 'US Tech was added on 27 Aug 2026, after the retrospective rule searches, the replication test, the diagnostic battery and the Europe lockbox activation, none of which covers it; the only research/ records that include it are FG-X2-FITTED-V1 (28 Aug 2026), a deliberately overfit fitted lookup that its own document calls neither a strategy nor evidence of predictive value, and the PLS1 pre-registration draft, which is not activated. The volatility input is Nasdaq-100 implied volatility (^VXN) applied to a sector ETF, and the bond/credit inputs are general US proxies',
  }),
  europe: Object.freeze({
    benchmarkType: 'price index (STOXX Europe 600, dividends excluded), unlike Sweden\'s gross total return benchmark',
    verified: `every series of this market was ${CHECK_23}; no later check`,
    note: 'every ex-dividend drop lowers the price index, so momentum, strength and safe-haven read lower than they would on a total-return benchmark; European dividends cluster in spring; realised volatility is used because no matching implied-volatility series is configured',
  }),
  global: Object.freeze({
    benchmarkType: 'ETF total-return proxy (ACWI, dividend-adjusted closes)',
    verified: `every series of this market was ${CHECK_23}; ACWI, ^VIX and IEF were ${CHECK_US}; the four London-listed series have had no later check`,
    note: 'HYLD.L and CORP.L are thinly traded, so the credit indicator is noisier; the volatility input is the US ^VIX, not a global implied-volatility index',
  }),
});

const COMPONENTS = {
  momentum:   { name: 'Momentum',         desc: 'Benchmark vs its 125-observation moving average', unit: '%', dir: 1 },
  strength:   { name: 'Strength',         desc: 'Benchmark distance from its trailing 252-observation high', unit: '%', dir: 1 },
  volatility: { name: 'Volatility',       desc: 'Configured volatility series (or realised 20-observation volatility) relative to its 50-observation average', unit: '%', dir: -1 },
  safeHaven:  { name: 'Safe-haven demand', desc: '20-common-observation return of the benchmark minus its safe-haven proxy', unit: 'pp', dir: 1 },
  credit:     { name: 'Credit appetite',  desc: 'High yield vs investment grade, relative to 125-observation average', unit: '%', dir: 1 },
  breadth:    { name: 'Breadth',          desc: 'Broader-risk vs core proxy, relative to 63-observation average', unit: '%', dir: 1 },
};

function labelOf(score, labels = LABELS) {
  if (score == null || !Number.isFinite(score)) return null;
  const s = round1(score);
  const hit = labels.find(([a, b]) => s >= a && s <= b);
  return hit ? hit[2] : null;
}
function legacyLabelOf(score) {
  if (score == null || !Number.isFinite(score)) return null;
  const s = Math.round(round1(score));
  const hit = LEGACY_LABELS.find(([a, b]) => s >= a && s <= b);
  return hit ? hit[2] : null;
}
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const round1 = v => v == null ? null : Math.round(v * 10) / 10;

// ---------- Yahoo ----------
// Request pattern (what one getMarketFearGreed call actually sends):
//   * each of the 33 unique configured symbols = one full-history chart
//     request (period1=0&interval=1d) to query1.finance.yahoo.com;
//   * every getMarketFearGreed caller — the local server's /api/marketfg, the
//     public build and the research replays in research/ that call it — adds one
//     3-month top-up request per symbol after each successful full-history
//     request (topUpRecentBars), so 66 chart requests; only the lockbox
//     collectors, which call getMarketFearGreedResearchHistory, send the 33
//     full-history requests alone, as their frozen capture contracts expect;
//   * a request that fails for any reason is retried once on the other chart
//     host (query2, or query1 when query2 failed); an HTTP 429 or 5xx answer
//     first waits Retry-After seconds when the header is present, else 2 s,
//     and is allowed one further host swap, so at most three attempts;
//   * series are cached for 15 minutes; a forced re-fetch (server.js
//     /api/refresh?force=1, which scripts/build-pages.js can trigger when a
//     component was carried forward) clears the cache and repeats all of it.
// Every request is counted in the fetchStats object threaded through
// getSeries → fetchSeries → fetchYahooChart and published on the result root.
function makeExchangeDateFormatter(timeZone) {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  });
}

const YAHOO_HOSTS = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
const RETRY_DEFAULT_MS = 2000;
const RETRY_MAX_MS = 10000; // longer Retry-After values would exceed the shared 25 s deadline anyway

function newFetchStats() {
  return {
    requests: 0,                                              // chart requests actually sent (full history + top-ups + retries)
    byHost: Object.fromEntries(YAHOO_HOSTS.map(h => [h, 0])), // requests per chart host
    retries: 0,                                               // requests sent after a failed attempt for the same symbol and range
    http429: 0,                                               // answers with HTTP 429 (rate limited)
    http5xx: 0,                                               // answers with HTTP 500-599
    retryWaitMs: 0,                                           // total time waited before retrying after a 429/5xx
    topUpRequests: 0,                                         // 3mo top-up requests (every getMarketFearGreed caller)
    fullHistoryRequests: 0,                                   // period1=0 full-history requests
    cacheHits: 0,                                             // series served from the 15-minute cache without any request
  };
}

function retryAfterMs(response) {
  const header = response && typeof response.headers?.get === 'function' ? response.headers.get('retry-after') : null;
  if (!header) return RETRY_DEFAULT_MS;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(RETRY_MAX_MS, Math.round(seconds * 1000));
  const at = Date.parse(header);
  if (Number.isFinite(at)) return Math.min(RETRY_MAX_MS, Math.max(0, at - Date.now()));
  return RETRY_DEFAULT_MS;
}

function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) return reject(signal.reason || new Error('aborted'));
    const timer = setTimeout(() => { if (signal) signal.removeEventListener('abort', onAbort); resolve(); }, ms);
    function onAbort() { clearTimeout(timer); reject(signal.reason || new Error('aborted')); }
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

async function fetchYahooChart(host, symbol, query, signal, stats = null) {
  const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`;
  if (stats) { stats.requests++; stats.byHost[host] = (stats.byHost[host] || 0) + 1; }
  const attemptController = new AbortController();
  const relayAbort = () => attemptController.abort(signal && signal.reason);
  if (signal) {
    if (signal.aborted) relayAbort();
    else signal.addEventListener('abort', relayAbort, { once: true });
  }
  const attemptDeadline = setTimeout(() => attemptController.abort(new Error(`${host} timed out (${symbol})`)), 12000);
  let response, json;
  try {
    response = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: attemptController.signal });
    json = await response.json().catch(() => null);
  } catch (error) {
    if (signal && signal.aborted) throw signal.reason || error;
    throw new Error(`${host} did not respond (${symbol})`);
  } finally {
    clearTimeout(attemptDeadline);
    if (signal) signal.removeEventListener('abort', relayAbort);
  }
  if (!response.ok) {
    const description = json && json.chart && json.chart.error && json.chart.error.description;
    const status = Number(response.status);
    const error = new Error(`${host} HTTP ${status}${description ? ` ${description}` : ''} (${symbol})`);
    error.status = status;
    // 429 (rate limited) and 5xx (provider trouble) are worth one delayed retry on the other host; a 4xx is not.
    if (status === 429 || (status >= 500 && status <= 599)) {
      error.retryable = true;
      error.retryAfterMs = retryAfterMs(response);
      if (stats) { if (status === 429) stats.http429++; else stats.http5xx++; }
    }
    throw error;
  }
  const result = json && json.chart && json.chart.result && json.chart.result[0];
  if (!result) throw new Error(`${host} returned no chart result (${symbol})`);
  const providerSymbol = result.meta && result.meta.symbol;
  if (providerSymbol !== symbol) {
    throw new Error(`${host} symbol identity mismatch: requested ${symbol}, received ${providerSymbol || 'missing'} (${symbol})`);
  }
  return { result, host };
}

async function fetchSeries(symbol, range, signal, stats = null) {
  // 'max' must be requested as an explicit period: range=max makes Yahoo downgrade to monthly bars, period1=0 keeps daily ones
  const q = range === 'max' ? `period1=0&period2=${Math.floor(Date.now() / 1000) + 86400}&interval=1d` : `range=${encodeURIComponent(range)}&interval=1d`;
  if (stats) { if (range === 'max') stats.fullHistoryRequests++; }
  const failures = [];
  let acquired = null;
  // query1, then query2 on any failure; after a 429/5xx (see fetchYahooChart) wait
  // first, and allow one more swap back to the other host — never more than three attempts.
  const hosts = [...YAHOO_HOSTS];
  for (let attempt = 0; attempt < hosts.length; attempt++) {
    const host = hosts[attempt];
    try {
      if (attempt > 0 && stats) stats.retries++;
      acquired = await fetchYahooChart(host, symbol, q, signal, stats);
      break;
    } catch (error) {
      failures.push(String(error && error.message || error));
      if (signal && signal.aborted) break;
      if (error && error.retryable) {
        if (hosts.length < 3) hosts.push(YAHOO_HOSTS.find(h => h !== (hosts[attempt + 1] || host)));
        const wait = Number(error.retryAfterMs) || RETRY_DEFAULT_MS;
        if (stats) stats.retryWaitMs += wait;
        try { await abortableDelay(wait, signal); } catch { break; }
      }
    }
  }
  if (!acquired) throw new Error(`Yahoo chart unavailable: ${failures.join('; ')}`);
  const res = acquired.result;
  const meta = res.meta || {};
  const tz = meta.exchangeTimezoneName || 'UTC';
  const dateFormatter = makeExchangeDateFormatter(tz);
  const ts = res.timestamp || [];
  const quoteClose = (((res.indicators || {}).quote || [])[0] || {}).close || [];
  const adjClose = (((res.indicators || {}).adjclose || [])[0] || {}).adjclose || [];
  // Dividend-adjusted series (total return) so that ETF distributions don't become fake sentiment moves in ratios and
  // returns (IHYG's semi-annual coupon ≈ −1.1 % on the ex-date otherwise looked like "extreme fear" in the credit indicator).
  // Whole series or none — adjusted and unadjusted are never mixed. For indices and VIX adjclose = close.
  const adjusted = adjClose.length === quoteClose.length &&
    quoteClose.every((c, i) => !(Number.isFinite(c) && c > 0) || (Number.isFinite(adjClose[i]) && adjClose[i] > 0));
  const closes = adjusted ? adjClose : quoteClose;
  const byDate = new Map();
  const missingClose = new Set(); // bars Yahoo lists without a usable close (a data gap, not a closed exchange)
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    const date = dateFormatter.format(new Date(ts[i] * 1000)); // exchange-local date as YYYY-MM-DD (sv-SE gives ISO order)
    if (c == null || !Number.isFinite(c) || c <= 0) { missingClose.add(date); continue; }
    byDate.set(date, c); // same day twice → latest wins
  }
  for (const date of byDate.keys()) missingClose.delete(date);
  const missingCloseDates = [...missingClose].sort().slice(-40);
  const rows = [...byDate.entries()].map(([date, close]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 30) throw new Error(`too little history from Yahoo (${symbol}: ${rows.length} days)`);
  const reg = (meta.currentTradingPeriod || {}).regular || null;
  const now = Date.now() / 1000;
  const providerName = String(meta.longName || meta.shortName || symbol).replace(/\s+/g, ' ').trim();
  const display = DISPLAY_NAMES[symbol] || null;
  return {
    symbol,
    // curated instrument name (DISPLAY_NAMES) where one exists, else Yahoo's; Yahoo's is always kept as providerName
    name: display && display.name ? display.name : providerName,
    providerName,
    type: display ? display.type : null,
    venue: venueOf(symbol),
    currency: meta.currency || null, tz, rows, adjusted,
    missingCloseDates,
    lastDate: rows[rows.length - 1].date,
    intraday: !!(reg && Number.isFinite(reg.start) && now >= reg.start && now <= reg.end),
    fetchedAt: new Date().toISOString(), sourceHost: acquired.host, providerSymbol: meta.symbol,
  };
}

// Yahoo's full-history endpoint (period1=0) sometimes trails a symbol's newest
// completed bars by a day or two, London- and Stockholm-listed ETFs above all,
// while a short-range request already has them. Append only bars strictly
// after the full history's last date, and only when the short response agrees
// with the full history on their last shared bar, so differently adjusted
// series are never mixed. The full-history request itself is unchanged; the
// top-up is one extra chart request per symbol (so a public build sends two
// per symbol, 66 in all) and is recorded on the series so the page and
// build.json can say so.
const TOP_UP_RANGE = '3mo'; // fetchSeries wants at least 30 rows; one month of trading days is fewer
async function topUpRecentBars(series, signal, stats = null) {
  if (!series || !Array.isArray(series.rows) || !series.rows.length) return series;
  let recent;
  if (stats) stats.topUpRequests++;
  try { recent = await fetchSeries(series.symbol, TOP_UP_RANGE, signal, stats); }
  catch (error) { return { ...series, topUp: { appended: 0, reason: `short-range request failed: ${String(error && error.message || error)}` } }; }
  if (recent.adjusted !== series.adjusted) return { ...series, topUp: { appended: 0, reason: 'adjustment basis differs' } };
  const last = series.rows[series.rows.length - 1];
  const shared = recent.rows.find(row => row.date === last.date);
  if (!shared || Math.abs(shared.close / last.close - 1) > 1e-6) return { ...series, topUp: { appended: 0, reason: 'no agreeing overlap' } };
  const extra = recent.rows.filter(row => row.date > last.date);
  if (!extra.length) return { ...series, topUp: { appended: 0 } };
  const rows = [...series.rows, ...extra];
  return { ...series, rows, lastDate: rows[rows.length - 1].date, topUp: { appended: extra.length, from: extra[0].date, to: extra[extra.length - 1].date, host: recent.sourceHost, range: TOP_UP_RANGE } };
}

// topUp is opt-in: every getMarketFearGreed caller asks for it (the local
// server, the public build and the research replays that call it); only the
// lockbox collectors, through getMarketFearGreedResearchHistory, keep the exact
// single full-history request their frozen capture contracts expect.
// A cache hit sends nothing and is counted as such.
function getSeries(symbol, range, signal, topUp = false, stats = null) {
  const withTopUp = range === 'max' && topUp;
  const cacheKey = `${symbol}\u0000${range}${withTopUp ? '\u0000topup' : ''}`;
  const hit = seriesCache.get(cacheKey);
  if (hit && Date.now() - hit.t < SERIES_TTL_MS) { if (stats) stats.cacheHits++; return hit.p; }
  const acquire = withTopUp
    ? fetchSeries(symbol, range, signal, stats).then(s => topUpRecentBars(s, signal, stats))
    : fetchSeries(symbol, range, signal, stats);
  const p = acquire.then(s => { lastGood.set(cacheKey, s); return s; }, e => {
    seriesCache.delete(cacheKey);
    const g = lastGood.get(cacheKey);
    if (g) return { ...g, stale: true, fetchError: String(e.message || e) };
    throw e;
  });
  seriesCache.set(cacheKey, { t: Date.now(), p });
  return p;
}
function clearCache() { seriesCache.clear(); }

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length); let next = 0;
  const worker = async () => { while (next < items.length) { const k = next++; out[k] = await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return out;
}

// ---------- maths ----------
function smaAt(arr, i, n) { if (i < n - 1) return null; let s = 0; for (let k = i - n + 1; k <= i; k++) s += arr[k]; return s / n; }
// Frozen v2 research replay only. Public v3 must use expandingPctScores.
function pctScores(raw, window, minPts) {
  return raw.map((v, i) => {
    if (v == null || !Number.isFinite(v)) return null;
    let n = 0, below = 0, eq = 0;
    for (let k = Math.max(0, i - window + 1); k <= i; k++) { const x = raw[k]; if (x == null || !Number.isFinite(x)) continue; n++; if (x < v) below++; else if (x === v) eq++; }
    return n < minPts ? null : 100 * (below + 0.5 * eq) / n;
  });
}

// Exact causal expanding midranks in O(N log N). Coordinate compression sees
// the set of possible numeric keys, but counts are inserted only as each row is
// reached, so future values cannot affect an earlier percentile.
function expandingPctScores(raw, minPts) {
  const finite = raw.filter(value => Number.isFinite(value));
  const values = [...new Set(finite)].sort((a, b) => a - b);
  const ranks = new Map(values.map((value, index) => [value, index + 1]));
  const tree = new Int32Array(values.length + 1);
  const add = index => { for (let i = index; i < tree.length; i += i & -i) tree[i]++; };
  const sum = index => { let total = 0; for (let i = index; i > 0; i -= i & -i) total += tree[i]; return total; };
  let n = 0;
  return raw.map(value => {
    if (!Number.isFinite(value)) return null;
    const rank = ranks.get(value);
    add(rank);
    n++;
    const below = sum(rank - 1);
    const equal = sum(rank) - below;
    return n < minPts ? null : 100 * (below + 0.5 * equal) / n;
  });
}
function join(a, b) {
  const mb = new Map(b.rows.map(r => [r.date, r.close]));
  const dates = [], x = [], y = [];
  for (const r of a.rows) { const c = mb.get(r.date); if (c != null) { dates.push(r.date); x.push(r.close); y.push(c); } }
  return { dates, x, y };
}

// ---------- indicators: each returns { dates, raw } ----------
function compMomentum(idx) {
  const c = idx.rows.map(r => r.close);
  return { dates: idx.rows.map(r => r.date), raw: c.map((v, i) => { const m = smaAt(c, i, 125); return m ? 100 * (v / m - 1) : null; }) };
}
function compStrength(idx, window, minPts) {
  const c = idx.rows.map(r => r.close);
  return { dates: idx.rows.map(r => r.date), raw: c.map((v, i) => {
    const from = Math.max(0, i - window + 1); if (i - from + 1 < minPts) return null;
    let mx = -Infinity; for (let k = from; k <= i; k++) if (c[k] > mx) mx = c[k];
    return 100 * (v / mx - 1);
  }) };
}
function compRealizedVol(idx) {
  const c = idx.rows.map(r => r.close);
  return { dates: idx.rows.map(r => r.date), raw: c.map((v, i) => {
    if (i < 20) return null;
    const lr = []; for (let k = i - 19; k <= i; k++) lr.push(Math.log(c[k] / c[k - 1]));
    const m = lr.reduce((s, x) => s + x, 0) / lr.length;
    const sd = Math.sqrt(lr.reduce((s, x) => s + (x - m) * (x - m), 0) / (lr.length - 1));
    return sd * Math.sqrt(252) * 100;
  }) };
}
function compLevel(series) { return { dates: series.rows.map(r => r.date), raw: series.rows.map(r => r.close) }; }
// value relative to its own n-day average (CNN scores VIX this way: above its 50-day average = fear). Tolerates nulls in the input.
function compRelSma(c, n) {
  const raw = c.raw.map((v, i) => {
    if (v == null || i < n - 1) return null;
    let s = 0, k = 0; for (let j = i - n + 1; j <= i; j++) { const x = c.raw[j]; if (x != null && Number.isFinite(x)) { s += x; k++; } }
    return k >= n * 0.8 ? 100 * (v / (s / k) - 1) : null;
  });
  return { dates: c.dates, raw };
}
function compSafeHaven(idx, bond) {
  const j = join(idx, bond);
  return { dates: j.dates, raw: j.x.map((v, i) => i < 20 ? null : 100 * ((v / j.x[i - 20] - 1) - (j.y[i] / j.y[i - 20] - 1))) };
}
function compRatioVsSma(a, b, n) {
  const j = join(a, b); const ratio = j.x.map((v, i) => v / j.y[i]);
  return { dates: j.dates, raw: ratio.map((v, i) => { const m = smaAt(ratio, i, n); return m ? 100 * (v / m - 1) : null; }) };
}

// ---------- configurable raw-series adapters ----------
// A market slot is normally a Yahoo symbol. It may also be a transparent synthetic
// equal-weight return index built from fixed Yahoo symbols. The synthetic adapter is
// raw data preparation only; every market still enters the same six model formulas.
function collectSpecSymbols(spec, out = []) {
  if (typeof spec === 'string' && spec) out.push(spec);
  else if (spec && typeof spec === 'object' && Array.isArray(spec.symbols)) {
    for (const symbol of spec.symbols) if (typeof symbol === 'string' && symbol) out.push(symbol);
  }
  return out;
}

function specLabel(spec) {
  if (typeof spec === 'string') return spec;
  return spec && (spec.id || spec.name) ? String(spec.id || spec.name) : 'configured series';
}

function beforeUtcDate(series, utcDate) {
  if (!series || !utcDate) return series;
  const rows = series.rows.filter(row => row.date < utcDate);
  if (!rows.length) return null;
  return { ...series, rows, lastDate: rows[rows.length - 1].date, intraday: false };
}

// Conservative completed-bar wrapper for live/public calculations.  A source's
// exchange-local retrieval date is still forming or may still be revised by
// the provider, so only strictly earlier local dates enter a research score or
// learned decision.  This also makes the rule independent of the server's own
// timezone.
function beforeRetrievalLocalDate(series) {
  if (!series || !series.fetchedAt || !series.tz) return null;
  const instant = new Date(series.fetchedAt);
  if (!Number.isFinite(instant.getTime())) return null;
  let cutoff;
  try { cutoff = instant.toLocaleDateString('sv-SE', { timeZone: series.tz }); }
  catch { return null; }
  const completed = beforeUtcDate(series, cutoff);
  return completed ? { ...completed, completedBeforeLocalDate: cutoff, sourceFetchedAt: series.fetchedAt } : null;
}

function equalWeightReturnSeries(spec, sourceMap) {
  if (!spec || spec.method !== 'equalWeightReturns' || !Array.isArray(spec.symbols) || spec.symbols.length < 2) return null;
  if (new Set(spec.symbols).size !== spec.symbols.length) throw new Error(`${specLabel(spec)} contains duplicate constituents`);
  const sources = spec.symbols.map(symbol => sourceMap.get(symbol) || null);
  if (sources.some(series => !series)) return null;

  const maps = sources.map(series => new Map(series.rows.map(row => [row.date, row.close])));
  const dates = sources[0].rows.map(row => row.date).filter(date => maps.every(map => map.has(date)));
  if (dates.length < 2) throw new Error(`${specLabel(spec)} has too little common history (${dates.length} days)`);

  const rows = [];
  let level = 100;
  let previous = null;
  for (const date of dates) {
    const values = maps.map(map => map.get(date));
    if (previous) {
      const meanReturn = values.reduce((sum, value, i) => sum + value / previous[i] - 1, 0) / values.length;
      if (!Number.isFinite(meanReturn) || 1 + meanReturn <= 0) throw new Error(`${specLabel(spec)} produced an invalid equal-weight return on ${date}`);
      level *= 1 + meanReturn;
    }
    rows.push({ date, close: level });
    previous = values;
  }

  return {
    symbol: String(spec.id || `EW(${spec.symbols.join(',')})`),
    name: String(spec.name || `Equal-weight ${spec.symbols.join(', ')}`),
    currency: spec.currency || sources[0].currency || null,
    tz: spec.timezone || 'UTC',
    rows,
    adjusted: sources.every(series => series.adjusted),
    lastDate: rows[rows.length - 1].date,
    intraday: sources.some(series => series.intraday),
    fetchedAt: sources.map(series => series.fetchedAt).sort().at(-1) || null,
    stale: sources.some(series => series.stale),
    fetchError: sources.filter(series => series.fetchError).map(series => series.fetchError).join('; ') || null,
    sourceSymbols: spec.symbols.slice(),
    construction: 'daily-rebalanced arithmetic equal-weight return index',
  };
}

function resolveSeriesSpec(spec, sourceMap) {
  if (typeof spec === 'string') return sourceMap.get(spec) || null;
  if (spec && spec.method === 'equalWeightReturns') return equalWeightReturnSeries(spec, sourceMap);
  return null;
}

function latestIsoTimestamp(values) {
  return values.filter(value => typeof value === 'string' && Number.isFinite(Date.parse(value)))
    .sort().at(-1) || null;
}

function hashPublicDecision(signal) {
  const { decisionSha256: ignored, learnerDecisionSha256, ...publicDecision } = signal || {};
  return expandingBinary.hashCanonical({ publicDecision, learnerDecisionSha256 });
}

function hashPublishedScoreHistory(history) {
  return expandingBinary.hashCanonical((history || []).map(row => ({
    date: row.date, score: round1(row.score), n: row.n,
  })));
}

function buildPublicExpandingSignal(key, idx, history, marketSources, symbols, annualization, scoreModel) {
  const disclosure = TARGET_DISCLOSURES[key] || Object.freeze({
    expectedTargetId: null,
    requiresAdjusted: false,
    suitability: 'UNREVIEWED_TARGET_NOT_INVESTABLE_X2',
  });
  const relevantSymbols = [...new Set(Object.values(symbols || {}).flatMap(spec => collectSpecSymbols(spec)))];
  const relevantSources = relevantSymbols.map(symbol => marketSources.get(symbol)).filter(Boolean);
  const sourceHostBySymbol = Object.fromEntries(relevantSymbols.map(symbol => [
    symbol,
    (marketSources.get(symbol) || {}).sourceHost || null,
  ]));
  const providerSymbolByRequestedSymbol = Object.fromEntries(relevantSymbols.map(symbol => [
    symbol,
    (marketSources.get(symbol) || {}).providerSymbol || null,
  ]));
  const sourceHosts = [...new Set(Object.values(sourceHostBySymbol).filter(Boolean))].sort();
  const availableAtUtc = latestIsoTimestamp(relevantSources.map(series => series.sourceFetchedAt || series.fetchedAt));
  const inputStale = relevantSources.length !== relevantSymbols.length || relevantSources.some(series => series.stale);
  const targetIdentityValid = disclosure.expectedTargetId === idx.symbol;
  const targetAdjustmentValid = !disclosure.requiresAdjusted || idx.adjusted === true;
  const targetInputValid = targetIdentityValid && targetAdjustmentValid;
  const lastTarget = idx.rows.at(-1);
  const lastSignal = history.at(-1);
  const currentComplete = Boolean(targetInputValid && lastTarget && lastSignal && lastTarget.date === lastSignal.date && lastSignal.n === 6);
  const signalByDate = new Map(history.map(row => [row.date, row]));
  const scheduledSignals = idx.rows
    .filter(row => row.date >= history[0].date)
    .map(row => {
      const signal = signalByDate.get(row.date);
      const isLatestTarget = row.date === lastTarget.date;
      const usableSignal = targetInputValid && signal && !(isLatestTarget && (inputStale || !currentComplete));
      return usableSignal ? {
        date: row.date,
        publishedScore: round1(signal.score),
        components: signal.parts,
        availableAtUtc: isLatestTarget ? availableAtUtc : null,
      } : {
        date: row.date,
        publishedScore: null,
        components: {},
        availableAtUtc: isLatestTarget ? availableAtUtc : null,
      };
    });
  const input = {
    key,
    name: idx.name,
    targetId: idx.symbol,
    marketClass: key === 'crypto' ? 'crypto' : 'equity',
    annualization,
    prices: idx.rows,
    signals: scheduledSignals,
  };
  const ledgers = expandingBinary.buildDecisionLedgers(input);
  const decision = ledgers.M1.decisions.at(-1);
  if (!decision) throw new Error(`${key}: expanding learner emitted no decision`);
  const validFreshDecision = !inputStale && currentComplete;
  const action = decision.action;
  const targetRiskyWeight = action === 'BUY' ? 1 : 0;
  const simulatedFilledRiskyWeight = decision.filledPosition === 'LONG' ? 1 : 0;
  const targetPosition = action === 'BUY' ? 'LONG' : 'CASH';
  const simulatedFilledPosition = simulatedFilledRiskyWeight === 1 ? 'LONG' : 'CASH';
  const reason = decision.fallbackReason || 'EXPANDING_RIDGE_PATTERN';
  const targetSuitability = !targetIdentityValid
    ? 'TARGET_IDENTITY_MISMATCH_UNREVIEWED'
    : !targetAdjustmentValid
      ? 'UNADJUSTED_CLOSE_NOT_TOTAL_RETURN'
      : disclosure.suitability;
  const publicDecision = {
    modelId: PUBLIC_SIGNAL_MODEL_ID,
    modelVersion: PUBLIC_SIGNAL_MODEL_VERSION,
    learnerModelId: expandingBinary.MODEL_ID,
    learnerModelVersion: expandingBinary.SCHEMA_VERSION,
    upstreamScoreModelId: scoreModel.id,
    upstreamScoreModelVersion: Number(scoreModel.version),
    upstreamScorePercentileMode: scoreModel.percentileMode,
    upstreamScorePercentileScope: scoreModel.percentileScope,
    action,
    actionMeaning: 'TARGET_POSITION',
    targetPosition,
    positionStateMeaning: 'RETROSPECTIVE_SIMULATION_ONLY_NOT_ACTUAL_HOLDING_OR_EXECUTION',
    simulatedFilledPosition,
    targetRiskyWeight,
    simulatedFilledRiskyWeight,
    simulatedTransitionRequired: targetRiskyWeight !== simulatedFilledRiskyWeight,
    decisionAsOfClose: decision.decisionDate,
    executeNoEarlierThanClose: 'FIRST_TARGET_CLOSE_STRICTLY_AFTER_FEATURE_CLOSE_AND_AVAILABLE_AT_UTC',
    availableAtUtc,
    latestMaturedOutcomeThrough: decision.latestMaturedOutcomeClose,
    trainingRows: decision.trainingRowCount,
    trainingStart: decision.trainingStartDate,
    trainingEnd: decision.trainingEndDate,
    historyStart: history[0].date,
    historyEnd: lastSignal.date,
    historyObservations: history.length,
    historyTruncated: false,
    historyScope: 'ALL_USABLE_SCORE_ROWS_FROM_CURRENT_PROVIDER_MAX_RESPONSE',
    publishedScoreHistorySha256: hashPublishedScoreHistory(history),
    learnerInputHistorySha256: expandingBinary.hashCanonical(input),
    learnerUsesAllSuppliedHistory: true,
    providerHistoryCompleteness: 'UNVERIFIED',
    providerSymbolByRequestedSymbol,
    sourceHostBySymbol,
    sourceHostFallbackUsed: sourceHosts.includes('query2.finance.yahoo.com'),
    sourceHosts,
    reason,
    inputsCompleted: currentComplete,
    inputsFresh: !inputStale,
    targetId: idx.symbol,
    expectedTargetId: disclosure.expectedTargetId,
    targetSuitability,
    cashModel: 'ZERO_RETURN_DEVELOPMENT_ASSUMPTION',
    evidenceStatus: 'RETROSPECTIVE_PREQUENTIAL_RESEARCH_REQUIRES_REVALIDATION_FOR_UPSTREAM_SCORE_V3_NOT_VALIDATED',
    prospectiveRecorded: false,
    x2ClaimAllowed: false,
  };
  const boundDecision = {
    ...publicDecision,
    learnerDecisionSha256: decision.decisionSha256,
  };
  return Object.freeze({
    ...boundDecision,
    decisionSha256: hashPublicDecision(boundDecision),
  });
}

// Explains a carried-forward component: for each benchmark date the component
// missed, which of its source series lacked that date and how. Each case is
// stated as what the data shows and no more:
//   * Yahoo listed the bar without a close — a feed gap;
//   * a weekend date — the source has no weekend bars;
//   * no series of the same listing venue in this market (venueOf) has the bar
//     — an exchange holiday or a feed gap covering the venue; the model cannot
//     tell which without an exchange calendar, and a holiday leaves no bar
//     that a later build could find;
//   * this series alone lacks a bar that other same-venue series have — a feed gap.
// marketSymbols limits the same-venue comparison to the market's own series;
// without it every series in `sources` is compared.
function lagDetailFor(gapDates, symbols, sources, marketSymbols = null) {
  const rowsOf = s => { const x = sources.get(s); return x && Array.isArray(x.rows) ? x.rows : null; };
  const universe = (marketSymbols || [...sources.keys()]).filter(s => rowsOf(s));
  const parts = [];
  for (const symbol of symbols) {
    const rows = rowsOf(symbol);
    if (!rows) continue;
    const have = new Set(rows.map(row => row.date));
    const missing = new Set(sources.get(symbol).missingCloseDates || []);
    const noClose = gapDates.filter(date => !have.has(date) && missing.has(date));
    const noBar = gapDates.filter(date => !have.has(date) && !missing.has(date));
    if (noClose.length) parts.push(`${symbol}: Yahoo listed ${noClose.join(', ')} with no close (feed gap)`);
    if (!noBar.length) continue;
    const venue = venueOf(symbol);
    const peerDates = universe.filter(s => s !== symbol && venueOf(s) === venue).map(s => new Set(rowsOf(s).map(row => row.date)));
    const groups = { weekend: [], venue: [], single: [] };
    for (const date of noBar) {
      const day = new Date(`${date}T00:00:00Z`).getUTCDay();
      if (day === 0 || day === 6) groups.weekend.push(date);
      else if (peerDates.some(set => set.has(date))) groups.single.push(date);
      else groups.venue.push(date);
    }
    const bar = dates => `${dates.join(', ')} bar${dates.length > 1 ? 's' : ''}`;
    const venueCount = peerDates.length + 1;
    if (groups.weekend.length) parts.push(`${symbol}: no ${bar(groups.weekend)} (weekend; the source has no weekend bars)`);
    if (groups.venue.length) {
      parts.push(`${symbol}: no ${bar(groups.venue)} on ${venueCount > 1 ? `any of the ${venueCount}` : 'the only'} ${venue} series (exchange holiday or feed gap; the model cannot tell which)`);
    }
    if (groups.single.length) parts.push(`${symbol}: no ${bar(groups.single)} for ${symbol} while other ${venue} series have one (feed gap)`);
  }
  return parts.length ? parts.join('; ') : null;
}

// ---------- one market ----------
function computeMarket(key, m, S, opt) {
  const percentileMode = opt.percentileMode || 'trailing-window';
  if (!['expanding', 'trailing-window'].includes(percentileMode)) {
    throw new Error(`unsupported percentile mode ${percentileMode}`);
  }
  const strengthWindow = Number(opt.strengthWindow ?? opt.window ?? 252);
  const percentileMinPoints = Number(opt.percentileMinPoints ?? opt.minWindowPoints ?? 126);
  if (!Number.isInteger(strengthWindow) || strengthWindow < 2) throw new Error('strengthWindow must be an integer >= 2');
  if (!Number.isInteger(percentileMinPoints) || percentileMinPoints < 1) throw new Error('percentileMinPoints must be a positive integer');
  const scoreLabel = percentileMode === 'expanding' ? labelOf : legacyLabelOf;
  const sym = m.symbols || {};
  const marketSources = new Map();
  const utcCutoff = m.barPolicy === 'completed-utc-date' ? new Date().toISOString().slice(0, 10) : null;
  for (const [symbol, series] of S) {
    // getMarketFearGreed has already applied the stronger source-local wrapper.
    // Keep the legacy direct-compute Crypto wrapper only for callers/tests that
    // provide raw series, and never cut an already completed cached series a
    // second time against a later wall-clock date.
    const completed = series && series.completedBeforeLocalDate
      ? series
      : utcCutoff ? beforeUtcDate(series, utcCutoff) : series;
    marketSources.set(symbol, completed);
  }
  const get = slot => sym[slot] ? resolveSeriesSpec(sym[slot], marketSources) : null;
  const idx = get('index');
  if (!idx) throw new Error(`index series (${specLabel(sym.index) || '—'}) missing`);
  // A null slot means that the frozen mapping intentionally uses the documented fallback.
  // A configured-but-missing slot must never fall back silently, because that would change
  // the model under the same id/version while still appearing complete.
  const bond = get('bond'), vol = get('vol'), hy = get('hy');
  const ig = sym.ig == null ? bond : get('ig');
  const small = get('small'), large = sym.large == null ? idx : get('large');
  const warnings = [], staleSeen = new Set();
  const comps = {};
  const definitions = Object.fromEntries(Object.entries(COMPONENTS).map(([k, definition]) => [k, {
    ...definition,
    ...((m.components && m.components[k]) || {}),
    dir: definition.dir,
  }]));
  const add = (k, series, build, note) => {
    const missing = series.filter(s => !s);
    if (missing.length) return; // slot not configured / data missing → the indicator is omitted
    const c = build();
    const score = percentileMode === 'expanding'
      ? expandingPctScores(c.raw, percentileMinPoints)
      : pctScores(c.raw, Number(opt.window ?? strengthWindow), percentileMinPoints);
    if (definitions[k].dir < 0) for (let i = 0; i < score.length; i++) if (score[i] != null) score[i] = 100 - score[i];
    comps[k] = {
      ...c, score, symbols: series.map(s => s.symbol), names: series.map(s => s.name), stale: series.some(s => s.stale), note: note || null,
      // proper instrument name and type per source series (DISPLAY_NAMES), Yahoo's own name kept alongside
      seriesNames: series.map(s => ({
        symbol: s.symbol, name: s.name,
        type: s.type || (s.construction ? `repository-built ${s.construction}` : null),
        providerName: s.providerName || null,
      })),
    };
    for (const s of series) if (s.stale && !staleSeen.has(s.symbol)) { // fallback series (last successful fetch) — say why, once per symbol
      staleSeen.add(s.symbol);
      warnings.push(`${s.symbol}: ${s.fetchError || 'Yahoo did not respond'} — showing series fetched ${String(s.fetchedAt || '').slice(0, 16).replace('T', ' ')}`);
    }
  };
  add('momentum', [idx], () => compMomentum(idx));
  add('strength', [idx], () => compStrength(idx, strengthWindow, percentileMinPoints));
  // a fallback (stale) VIX series is preferred over silently switching the model to realised volatility for the whole history
  // scored as the level relative to its 50-day average (CNN's definition) — the level's 1-year percentile alone made a calm
  // market read as extreme greed for months and put the USA model ~11 points above CNN's published index
  if (vol) add('volatility', [vol], () => compRelSma(compLevel(vol), 50), 'configured volatility series vs its 50-observation average');
  else if (sym.vol == null) add('volatility', [idx], () => compRelSma(compRealizedVol(idx), 50), 'realised 20-observation volatility vs its 50-observation average');
  else warnings.push(`configured volatility series ${specLabel(sym.vol)} missing — the component is unavailable`);
  if (bond) add('safeHaven', [idx, bond], () => compSafeHaven(idx, bond), definitions.safeHaven.note); else if (sym.bond) warnings.push(`bond series ${specLabel(sym.bond)} missing`);
  if (hy && ig) add('credit', [hy, ig], () => compRatioVsSma(hy, ig, 125), definitions.credit.note); else if (sym.hy) warnings.push(`credit series ${specLabel(sym.hy)}${sym.ig && !ig ? ' / ' + specLabel(sym.ig) : ''} missing`);
  if (small && large) add('breadth', [small, large], () => compRatioVsSma(small, large, 63), definitions.breadth.note); else if (sym.small) warnings.push(`breadth series ${specLabel(sym.small)} missing`);

  // composite on the index calendar; gaps from other exchanges are filled with the latest score ≤ fillDays calendar days back
  const L = {};
  for (const [k, c] of Object.entries(comps)) {
    const dates = [], scores = [], raws = [];
    c.dates.forEach((d, i) => { if (c.score[i] != null) { dates.push(d); scores.push(c.score[i]); raws.push(c.raw[i]); } });
    L[k] = { dates, scores, raws, p: 0 };
  }
  const history = [];
  for (const r of idx.rows) {
    const d = r.date, parts = {}; let n = 0, sum = 0;
    for (const [k, x] of Object.entries(L)) {
      while (x.p < x.dates.length && x.dates[x.p] <= d) x.p++;
      const i = x.p - 1;
      if (i >= 0 && x.dates[i] >= addDays(d, -opt.fillDays)) { parts[k] = { score: x.scores[i], raw: x.raws[i], asOf: x.dates[i] }; n++; sum += x.scores[i]; }
    }
    if (n >= opt.minComponents) history.push({ date: d, score: sum / n, n, parts });
  }
  if (!history.length) throw new Error('too few indicators with data');
  const last = history[history.length - 1];
  const atOrBefore = iso => { let h = null; for (const x of history) { if (x.date <= iso) h = x; else break; } return h; };
  const prevClose = history.length > 1 ? history[history.length - 2] : null;
  const week = atOrBefore(addDays(last.date, -7)), month = atOrBefore(addDays(last.date, -30)), year = atOrBefore(addDays(last.date, -365));
  const components = {};
  const marketSymbolList = [...new Set(Object.values(sym).flatMap(spec => collectSpecSymbols(spec)))];
  const carriedComponents = [];
  for (const [k, c] of Object.entries(comps)) {
    const p = last.parts[k] || null;
    const lag = !!(p && p.asOf !== last.date);
    const gapDates = lag ? idx.rows.filter(row => row.date > p.asOf && row.date <= last.date).map(row => row.date) : [];
    const lagDetail = lag ? lagDetailFor(gapDates, c.symbols, marketSources, marketSymbolList) : null;
    components[k] = {
      key: k, name: definitions[k].name, desc: definitions[k].desc, unit: definitions[k].unit, dir: definitions[k].dir,
      score: p ? round1(p.score) : null, label: p ? scoreLabel(p.score) : null, raw: p ? round1(p.raw) : null, asOf: p ? p.asOf : null,
      symbols: c.symbols, names: c.names, seriesNames: c.seriesNames, note: c.note,
      stale: !!c.stale,                         // fallback series: Yahoo did not respond at the last fetch
      lag,                                      // older date than the index (other exchange closed, or a feed gap) — not an error
      lagDetail,
    };
    if (lag) {
      // the source series that actually lack a gap date (a two-series component may lag because of one of them)
      const lagging = c.symbols.filter(s => {
        const src = marketSources.get(s);
        if (!src || !Array.isArray(src.rows)) return false;
        const have = new Set(src.rows.map(row => row.date));
        return gapDates.some(date => !have.has(date));
      });
      carriedComponents.push({ component: k, symbol: (lagging.length ? lagging : c.symbols).join(', '), asOf: p.asOf, benchmarkDate: last.date, detail: lagDetail });
    }
  }
  const componentAsOfs = Object.values(components).map(c => c.asOf).filter(Boolean).sort();
  const expandingSignal = opt.includeExpandingSignal
    ? buildPublicExpandingSignal(
      key, idx, history, marketSources, sym,
      key === 'crypto' ? 365 : 252,
      {
        id: opt.modelId || DEFAULTS.modelId,
        version: Number(opt.version || DEFAULTS.version),
        percentileMode,
        percentileScope: percentileMode === 'expanding'
          ? PUBLIC_PERCENTILE_SCOPE
          : `TRAILING_${Number(opt.window ?? strengthWindow)}_FINITE_COMPONENT_RAW_OBSERVATIONS`,
      },
    )
    : null;
  return {
    key, name: m.name || key, currency: m.currency || idx.currency, indexSymbol: idx.symbol, indexName: idx.name,
    asOf: last.date, score: round1(last.score), label: scoreLabel(last.score), n: last.n, total: Object.keys(COMPONENTS).length,
    intraday: !!idx.intraday, stale: !!idx.stale || Object.values(comps).some(c => c.stale),
    previous: { close: prevClose ? round1(prevClose.score) : null, closeDate: prevClose ? prevClose.date : null,
      week: week ? round1(week.score) : null, weekDate: week ? week.date : null, month: month ? round1(month.score) : null, monthDate: month ? month.date : null,
      year: year ? round1(year.score) : null, yearDate: year ? year.date : null },
    components, warnings,
    // asOf above is the benchmark's last completed bar. Components whose source
    // had no bar for that date are carried from an earlier bar (lag=true); they
    // are listed here with why, and oldestComponentAsOf is the oldest of them.
    asOfMeaning: 'last benchmark bar dated before the retrieval date at the exchange (a same-day close is excluded until the next day); carried components are older',
    carriedComponents,
    // the distinct as-of dates of the carried components, oldest first: one
    // date means the stamp can name it, several mean the page must list them
    // rather than date them all to the oldest
    carriedDates: [...new Set(carriedComponents.map(c => c.asOf))].sort(),
    oldestComponentAsOf: componentAsOfs.length ? componentAsOfs[0] : null,
    firstScoredDate: history[0].date, // first date on which all six components had a percentile (see model.warmup)
    // What was and was not verified about this market's raw series, dated (MARKET_DISCLOSURES).
    disclosure: MARKET_DISCLOSURES[key] || { benchmarkType: null, verified: 'no dated verification is recorded for this market', note: null },
    // Which of this market's raw series had newer bars appended from a short-range request (see topUpRecentBars).
    recentBarTopUps: Object.fromEntries([...new Set(Object.values(sym).flatMap(spec => collectSpecSymbols(spec)))]
      .map(symbol => [symbol, marketSources.get(symbol)])
      .filter(([, series]) => series && series.topUp && series.topUp.appended > 0)
      .map(([symbol, series]) => [symbol, { appended: series.topUp.appended, from: series.topUp.from, to: series.topUp.to }])),
    ...(expandingSignal ? { expandingSignal } : {}),
    mapping: {
      barPolicy: opt.includeExpandingSignal && [...marketSources.values()].some(series => series && series.completedBeforeLocalDate)
        ? 'completed-source-local-date'
        : m.barPolicy || 'exchange-local daily bars',
      ...(opt.includeExpandingSignal ? { configuredBarPolicy: m.barPolicy || 'exchange-local daily bars' } : {}),
      symbols: sym,
    },
    history: history.map(h => {
      const row = { date: h.date, score: round1(h.score), label: scoreLabel(h.score), n: h.n };
      // Research runs can request the causal component observations used for each
      // composite row. The public/server contract stays compact by default.
      if (opt.includeHistoryParts) {
        row.parts = Object.fromEntries(Object.entries(h.parts).map(([component, value]) => [component, {
          score: value.score,
          raw: value.raw,
          asOf: value.asOf,
        }]));
      }
      return row;
    }),
  };
}

// ---------- all markets ----------
async function getMarketFearGreedWithMode(cfg, includeExpandingSignal) {
  expandingBinary.assertProtocolIdentity();
  const requested = cfg || {};
  const opt = { ...DEFAULTS, ...requested };
  // Configurations frozen before v3 had no mode field. Preserve their exact
  // rolling scorer for private replay; only an explicit v3 mode can be public.
  if (!Object.prototype.hasOwnProperty.call(requested, 'percentileMode')) {
    opt.percentileMode = Number(requested.version) <= 2 ? 'trailing-window' : DEFAULTS.percentileMode;
  }
  if (includeExpandingSignal && requested.range !== 'max') {
    throw new Error('PUBLIC_FULL_HISTORY_RANGE_REQUIRED: market Fear & Greed requires exact range "max"');
  }
  if (includeExpandingSignal && (
    requested.modelId !== DEFAULTS.modelId
    || Number(requested.version) !== 3
    || requested.percentileMode !== 'expanding'
  )) {
    throw new Error('PUBLIC_FULL_HISTORY_SCORING_REQUIRED: public Fear & Greed requires an explicit version 3 causal expanding model identity');
  }
  const markets = (cfg && cfg.markets) || {};
  const symbols = [...new Set(Object.values(markets).flatMap(m => Object.values(m.symbols || {}).flatMap(spec => collectSpecSymbols(spec))))];
  // one shared deadline for the whole fetch (not 20 s per symbol × several rounds) — a hanging Yahoo must never lock the page for minutes
  const ac = new AbortController();
  const deadlineError = new Error(`Yahoo did not respond within ${Math.round(opt.timeoutMs / 1000)} s`);
  let deadline;
  let fetched;
  // Every getMarketFearGreed caller tops up trailing full histories (see
  // topUpRecentBars): one full-history request per symbol, plus one 3mo request
  // per symbol whenever the top-up is on, plus any 429/5xx or host-swap
  // retries; fetchStats counts the requests of this call alone.
  const topUp = !!includeExpandingSignal && opt.topUpRecentBars !== false;
  const stats = newFetchStats();
  try {
    const fetchWork = mapLimit(symbols, opt.concurrency, s => getSeries(s, opt.range, ac.signal, topUp, stats).then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e.message || e) })));
    const hardDeadline = new Promise((_, reject) => {
      deadline = setTimeout(() => {
        ac.abort(deadlineError);
        reject(deadlineError);
      }, opt.timeoutMs);
    });
    fetched = await Promise.race([fetchWork, hardDeadline]);
  }
  finally { clearTimeout(deadline); }
  const S = new Map(), errors = {};
  fetched.forEach((r, i) => {
    if (!r.ok) { errors[symbols[i]] = r.e; return; }
    const completed = beforeRetrievalLocalDate(r.v);
    if (!completed) { errors[symbols[i]] = `${symbols[i]} has no completed source-local bar`; return; }
    S.set(symbols[i], completed);
    if (r.v.stale) errors[symbols[i]] = r.v.fetchError;
  });
  const out = {}, failed = {};
  for (const [key, m] of Object.entries(markets)) {
    try { out[key] = computeMarket(key, m, S, { ...opt, includeExpandingSignal }); }
    catch (e) { failed[key] = String(e.message || e); }
  }
  return {
    ok: Object.keys(out).length > 0, fetchedAt: new Date().toISOString(),
    model: {
      id: opt.modelId, version: Number(opt.version), owner: 'repository',
      name: 'Unified Fear & Greed — six-component market model',
      method: opt.percentileMode === 'expanding'
        ? 'equal-weight causal-expanding-percentile six-component composite'
        : 'equal-weight trailing-percentile six-component composite',
      percentileMode: opt.percentileMode,
      percentileScope: opt.percentileMode === 'expanding'
        ? PUBLIC_PERCENTILE_SCOPE
        : `TRAILING_${Number(opt.window ?? opt.strengthWindow)}_FINITE_COMPONENT_RAW_OBSERVATIONS`,
      percentileMinPoints: Number(opt.percentileMinPoints ?? opt.minWindowPoints),
      percentileHistoryTruncated: false,
      providerHistoryCompleteness: 'UNVERIFIED',
      strengthWindow: Number(opt.strengthWindow ?? opt.window),
      ...(opt.percentileMode === 'trailing-window' ? { percentileWindow: Number(opt.window ?? opt.strengthWindow) } : {}),
      range: opt.range,
      minComponents: opt.minComponents, fillDays: opt.fillDays,
      labels: opt.percentileMode === 'expanding' ? LABELS : LEGACY_LABELS,
      // the same bands as objects, with how a label is derived (one-decimal score, never integer rounding)
      bands: opt.percentileMode === 'expanding' ? BANDS : LEGACY_LABELS.map(([min, max, label]) => ({ min, max, label })),
      bandsMeaning: opt.percentileMode === 'expanding' ? BANDS_MEANING : 'legacy v2: the score is rounded to an integer and classified on integer bands',
      // The history is not a record of what this page showed: every point is
      // recomputed from the provider's current full response at each build.
      // publishedSince is the repository's first commit (the dashboard went up
      // that week); scoringSince is the commit that adopted this expanding
      // percentile definition. Both are constants: a build cannot read them
      // from git, because the published artefact carries no repository.
      publishedSince: '2026-08-23',
      scoringSince: opt.percentileMode === 'expanding' ? '2026-08-30' : null,
      historyNote: 'every point is recomputed by the current model from the full history the provider returns at each build; no point is a score this page displayed on that date',
      // what the code needs before a market's first composite row (see WARMUP); each market's firstScoredDate says where that fell
      warmup: {
        strengthWindow: Number(opt.strengthWindow ?? opt.window),
        percentileMinPoints: Number(opt.percentileMinPoints ?? opt.minWindowPoints),
        description: warmupDescription(Number(opt.strengthWindow ?? opt.window), Number(opt.percentileMinPoints ?? opt.minWindowPoints)),
      },
      components: COMPONENTS,
      ...(includeExpandingSignal ? { expandingSignal: {
        id: PUBLIC_SIGNAL_MODEL_ID,
        version: PUBLIC_SIGNAL_MODEL_VERSION,
        method: 'per-market expanding standardized ridge learner bound to unified Fear & Greed v3; next-close binary target state',
        learnerId: expandingBinary.MODEL_ID,
        learnerVersion: expandingBinary.SCHEMA_VERSION,
        upstreamScoreModelId: opt.modelId,
        upstreamScoreModelVersion: Number(opt.version),
        minimumMaturedRows: expandingBinary.MIN_MATURED_ROWS,
        evidenceStatus: 'RETROSPECTIVE_PREQUENTIAL_RESEARCH_REQUIRES_REVALIDATION_FOR_UPSTREAM_SCORE_V3_NOT_VALIDATED',
      } } : {}),
    },
    markets: out, failed, symbolErrors: errors,
    // What this call actually sent to Yahoo (see the request-pattern comment above fetchYahooChart).
    fetchStats: {
      ...stats,
      symbols: symbols.length,
      topUpEnabled: topUp,
      meaning: 'chart requests sent by this call: one full-history request per symbol, one 3mo top-up per symbol when topUpEnabled, plus retries; cacheHits were served without a request',
    },
  };
}

async function getMarketFearGreed(cfg) {
  return getMarketFearGreedWithMode(cfg, true);
}

// Internal acquisition for the permanent prospective ledger may use a bounded
// recovery range. It deliberately cannot emit the public BUY/SELL signal or its
// max-history claim; only getMarketFearGreed owns that public contract.
async function getMarketFearGreedResearchHistory(cfg) {
  return getMarketFearGreedWithMode(cfg, false);
}

module.exports = {
  getMarketFearGreed, getMarketFearGreedResearchHistory, clearCache,
  LABELS, BANDS, WARMUP, DISPLAY_NAMES, MARKET_DISCLOSURES, venueOf, warmupDescription, newFetchStats,
  compStrength, compMomentum,
  COMPONENTS, labelOf, pctScores, expandingPctScores, computeMarket, fetchSeries, topUpRecentBars, lagDetailFor,
  hashPublicDecision, hashPublishedScoreHistory, makeExchangeDateFormatter,
  collectSpecSymbols, equalWeightReturnSeries, resolveSeriesSpec, beforeUtcDate, beforeRetrievalLocalDate,
  buildPublicExpandingSignal,
};
