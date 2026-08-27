'use strict';

// Frozen, dependency-free model search for the shared six-component Fear & Greed model.
// Node 18+ is required for built-in fetch and AbortSignal.timeout.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'data', 'config.json');
const MARKET_FG_PATH = path.join(ROOT, 'marketfg.js');
const PROTOCOL_PATH = path.join(__dirname, 'FEAR_GREED_MODEL_SEARCH_PROTOCOL.md');
const DEFAULT_ARTIFACT_ROOT = path.join(__dirname, 'artifacts');
const SCHEMA_VERSION = 4;
const REQUIRED_COMPONENTS = 6;
const COMPONENT_KEYS = ['momentum', 'strength', 'volatility', 'safeHaven', 'credit', 'breadth'];
const CONTROL_FEATURES = ['lagReturn1', 'lagReturn5', 'lagReturn20', 'realizedVol20', 'trend125'];
const TARGETS = Object.freeze({ return: 'forwardReturn', risk: 'futureLogVol' });
const REFIT_OBSERVATIONS = 21;
const PRIMARY_HORIZON = 21;
const DATA_ADEQUACY_MINIMUMS = Object.freeze({
  forecastRows: 756,
  nonOverlappingOutcomes: 36,
  calendarSpanDays: 1095,
});
const USER_AGENT = 'InvestmentsFearGreedModelSearch/1.0 (+local reproducible research)';
const COIN_METRICS_USER_AGENT = 'InvestmentsFearGreedResearch/2.0 (+local reproducible research)';
const YAHOO_CHART_TEMPLATE = 'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}';
const CMBITM_ENDPOINT = 'https://indexes.coinmetrics.io/api/indexes?index=cmbitm&frequency=1d-ny-close&timezone=America%2FNew_York';
const CMBITM_PARSER_CONTRACT = 'cmbitm-top-level-time-value-strict-ny-date-v1';

const RAW_MODEL_CONTRACT = Object.freeze({
  id: 'investments-unified-fear-greed',
  version: 1,
  window: 252,
  minWindowPoints: 126,
  minComponents: 6,
  fillDays: 7,
});

const MARKET_SPECS = Object.freeze([
  { key: 'sweden', name: 'Sweden', target: '^OMXSBGI', annualization: 252, investable: false },
  { key: 'usa', name: 'USA', target: 'SPY', annualization: 252, investable: true },
  { key: 'europe', name: 'Europe', target: '^STOXX', annualization: 252, investable: false },
  { key: 'global', name: 'Global', target: 'ACWI', annualization: 252, investable: true },
  { key: 'crypto', name: 'Crypto (Coin Metrics CMBI Total Market)', target: 'CMBITM', annualization: 365, investable: false },
]);

const EXPERIMENTAL_CRYPTO_MAPPING = Object.freeze({
  index: 'CMBITM',
  vol: null,
  bond: 'IEF',
  hy: 'HYG',
  ig: 'LQD',
  small: 'CMBITM',
  large: 'BTC-USD',
});

const WEIGHT_TEMPLATES = Object.freeze([
  { id: 'equal', name: 'Equal', weights: [1, 1, 1, 1, 1, 1] },
  { id: 'trend_breadth', name: 'Trend and breadth', weights: [2, 2, 1, 1, 1, 2] },
  { id: 'defensive_risk', name: 'Defensive risk', weights: [1, 1, 2, 2, 2, 1] },
  { id: 'price_regime', name: 'Price regime', weights: [2, 2, 2, 1, 1, 1] },
  { id: 'cross_asset_risk', name: 'Cross-asset risk', weights: [1, 1, 1, 2, 2, 2] },
]);
const SMOOTHING_WINDOWS = Object.freeze([1, 5, 21]);

function buildCandidates() {
  const candidates = [];
  for (const template of WEIGHT_TEMPLATES) {
    const total = template.weights.reduce((sum, value) => sum + value, 0);
    if (!(total > 0) || template.weights.length !== COMPONENT_KEYS.length || template.weights.some(value => !(value > 0))) {
      throw new Error(`invalid frozen weight template: ${template.id}`);
    }
    for (const smoothing of SMOOTHING_WINDOWS) {
      candidates.push({
        id: `${template.id}_s${smoothing}`,
        name: `${template.name}, ${smoothing}-observation mean`,
        declarationOrder: candidates.length,
        templateId: template.id,
        componentOrder: COMPONENT_KEYS.slice(),
        rawWeights: template.weights.slice(),
        normalizedWeights: template.weights.map(value => value / total),
        smoothingObservations: smoothing,
      });
    }
  }
  if (candidates.length !== 15) throw new Error(`frozen candidate family must contain exactly 15 candidates, got ${candidates.length}`);
  return candidates;
}

const FROZEN_CANDIDATES = Object.freeze(buildCandidates().map(candidate => Object.freeze(candidate)));
const FROZEN_DESIGN = Object.freeze({
  study: 'shared-fear-greed-model-search',
  schemaVersion: SCHEMA_VERSION,
  componentOrder: COMPONENT_KEYS,
  candidateCount: 15,
  candidates: FROZEN_CANDIDATES,
  primaryHorizonBars: PRIMARY_HORIZON,
  entryLagBars: 1,
  splitFractions: [0.50, 0.25, 0.25],
  refitEveryForecastObservations: REFIT_OBSERVATIONS,
  targets: {
    return: 'simple return from close t+1 through close t+22',
    risk: 'log of annualized realized volatility over the same 21 later returns',
  },
  controls: CONTROL_FEATURES,
  finalInference: 'one-sided Newey-West paired loss-improvement mean test; bandwidth at least 21; BH across five tabs',
  dataAdequacyMinimumsPerMarketPerDevelopmentAndFinalSegment: DATA_ADEQUACY_MINIMUMS,
});

function parseArgs(argv) {
  const output = { snapshot: null, outDir: DEFAULT_ARTIFACT_ROOT, help: false };
  for (let i = 0; i < argv.length; i++) {
    const argument = argv[i];
    if (argument === '--snapshot') output.snapshot = argv[++i];
    else if (argument === '--out-dir') output.outDir = argv[++i];
    else if (argument === '--help' || argument === '-h') output.help = true;
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (output.snapshot) output.snapshot = path.resolve(process.cwd(), output.snapshot);
  output.outDir = path.resolve(process.cwd(), output.outDir);
  return output;
}

function usage() {
  return [
    'Usage:',
    '  node research/fear_greed_model_search.js',
    '  node research/fear_greed_model_search.js --snapshot research/artifacts/inputs/<schema-4-snapshot>.json',
    '  node research/fear_greed_model_search.js --out-dir <directory>',
    '',
    'A live run downloads inputs, freezes a schema-4 snapshot, and then evaluates the frozen 15 candidates.',
    'A --snapshot replay verifies the adjacent SHA-256 sidecar and performs no network requests.',
  ].join('\n');
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]);
    return output;
  }
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function portablePath(file) {
  if (!file) return null;
  const absolute = path.resolve(file);
  const relative = path.relative(ROOT, absolute);
  const inside = relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  return (inside ? (relative || '.') : path.basename(absolute)).split(path.sep).join('/');
}

function runStamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

function assertExactObject(actual, expected, context) {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`${context} drifted from the frozen protocol`);
}

function assertRawModelContract(model, context) {
  const expected = RAW_MODEL_CONTRACT;
  if (!model || model.id !== expected.id || Number(model.version) !== expected.version ||
      Number(model.window) !== expected.window || Number(model.minWindowPoints) !== expected.minWindowPoints ||
      Number(model.minComponents) !== expected.minComponents || Number(model.fillDays) !== expected.fillDays) {
    throw new Error(`${context}: raw six-component engine identity or parameters drifted`);
  }
}

function collectMappedSymbols(specification) {
  if (typeof specification === 'string' && specification) return [specification];
  if (specification && Array.isArray(specification.symbols)) return specification.symbols.filter(symbol => typeof symbol === 'string' && symbol);
  return [];
}

function normalizedSeriesInventory(seriesMap) {
  return [...seriesMap.values()].sort((left, right) => left.symbol.localeCompare(right.symbol)).map(series => ({
    symbol: series.symbol,
    sourceUrl: series.sourceUrl,
    timezone: series.timezone || series.tz,
    adjustmentMode: series.adjustmentMode,
    fetchedAt: series.fetchedAt,
    rowCount: series.rows.length,
    firstDate: series.rows[0].date,
    lastDate: series.rows.at(-1).date,
    normalizedRowsSha256: sha256Buffer(Buffer.from(canonicalJson(series.rows), 'utf8')),
  }));
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function fetchJson(url, description, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(30000),
      });
      const text = await response.text();
      let body = null;
      try { body = JSON.parse(text); } catch { /* handled below */ }
      if (!response.ok) {
        const detail = body && body.chart && body.chart.error && body.chart.error.description;
        throw new Error(`${description}: HTTP ${response.status}${detail ? ` (${detail})` : ''}`);
      }
      if (!body || typeof body !== 'object') throw new Error(`${description}: response was not JSON`);
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(750 * (2 ** (attempt - 1)));
    }
  }
  throw lastError || new Error(`${description}: fetch failed`);
}

async function mapLimit(items, limit, iteratee) {
  const output = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      output[index] = await iteratee(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return output;
}

async function fetchYahooSeries(symbol, fetchedAt) {
  const period2 = Math.floor(new Date(fetchedAt).getTime() / 1000) + 86400;
  const query = `period1=0&period2=${period2}&interval=1d&events=div%2Csplits`;
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  let json = null;
  let usedUrl = null;
  let firstError = null;
  for (const host of hosts) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`;
    try {
      json = await fetchJson(url, `Yahoo chart ${symbol}`, 2);
      usedUrl = url;
      break;
    } catch (error) {
      if (!firstError) firstError = error;
    }
  }
  if (!json) throw firstError || new Error(`Yahoo chart failed (${symbol})`);
  const result = json.chart && json.chart.result && json.chart.result[0];
  if (!result) throw new Error(`Yahoo chart returned no result (${symbol})`);
  const meta = result.meta || {};
  const timestamps = result.timestamp || [];
  const rawClose = ((((result.indicators || {}).quote || [])[0] || {}).close) || [];
  const adjustedClose = ((((result.indicators || {}).adjclose || [])[0] || {}).adjclose) || [];
  const adjusted = adjustedClose.length === rawClose.length && rawClose.every((close, index) =>
    !(Number.isFinite(close) && close > 0) || (Number.isFinite(adjustedClose[index]) && adjustedClose[index] > 0));
  const closes = adjusted ? adjustedClose : rawClose;
  const timezone = meta.exchangeTimezoneName || 'UTC';
  const retrievalLocalDate = new Date(fetchedAt).toLocaleDateString('sv-SE', { timeZone: timezone });
  const byDate = new Map();
  let excludedCurrentOrFutureRows = 0;
  for (let index = 0; index < timestamps.length; index++) {
    const close = closes[index];
    if (!Number.isFinite(close) || close <= 0) continue;
    const date = new Date(timestamps[index] * 1000).toLocaleDateString('sv-SE', { timeZone: timezone });
    if (date >= retrievalLocalDate) { excludedCurrentOrFutureRows++; continue; }
    byDate.set(date, { date, close });
  }
  const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 200) throw new Error(`Yahoo returned too little completed daily history (${symbol}: ${rows.length})`);
  return {
    symbol,
    name: String(meta.longName || meta.shortName || symbol).replace(/\s+/g, ' ').trim(),
    currency: meta.currency || null,
    tz: timezone,
    timezone,
    adjusted,
    adjustmentMode: adjusted ? 'Yahoo adjusted close for the whole series' : 'Yahoo close; no complete adjusted-close series supplied',
    sourceUrl: usedUrl,
    fetchedAt,
    lastDate: rows.at(-1).date,
    intraday: false,
    retrievalLocalDate,
    excludedCurrentOrFutureRows,
    rows,
  };
}

async function fetchCmbitmSeries(fetchedAt) {
  const response = await fetch(CMBITM_ENDPOINT, {
    headers: { 'User-Agent': COIN_METRICS_USER_AGENT, Accept: 'application/json' },
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  const rawBytes = Buffer.from(text, 'utf8');
  const rawResponseSha256 = sha256Buffer(rawBytes);
  let body = null;
  try { body = JSON.parse(text); } catch { /* handled below */ }
  if (!response.ok) throw new Error(`Coin Metrics CMBITM: HTTP ${response.status}${text ? ` (${text.slice(0, 160)})` : ''}`);
  if (!Array.isArray(body)) throw new Error('Coin Metrics CMBITM response was not the required top-level array');
  const fetchedAtMilliseconds = new Date(fetchedAt).getTime();
  if (!Number.isFinite(fetchedAtMilliseconds)) throw new Error(`invalid CMBITM retrieval timestamp: ${fetchedAt}`);
  const normalized = [];
  let excludedAfterRetrieval = 0;
  for (const entry of body) {
    const timestamp = entry && entry.time;
    const timestampMilliseconds = new Date(timestamp).getTime();
    const value = Number(entry && entry.value);
    if (typeof timestamp !== 'string' || !Number.isFinite(timestampMilliseconds)) throw new Error('Coin Metrics CMBITM contains an invalid time');
    if (!Number.isFinite(value) || value <= 0) throw new Error(`Coin Metrics CMBITM contains a non-positive value at ${timestamp}`);
    if (timestampMilliseconds > fetchedAtMilliseconds) { excludedAfterRetrieval++; continue; }
    normalized.push({ timestamp, timestampMilliseconds, value });
  }
  normalized.sort((left, right) => left.timestampMilliseconds - right.timestampMilliseconds);
  const rows = [];
  let priorTimestamp = -Infinity;
  let priorDate = null;
  for (const entry of normalized) {
    if (entry.timestampMilliseconds <= priorTimestamp) throw new Error(`Coin Metrics CMBITM contains a duplicate/non-increasing timestamp: ${entry.timestamp}`);
    const date = new Date(entry.timestampMilliseconds).toLocaleDateString('sv-SE', { timeZone: 'America/New_York' });
    if (priorDate && date <= priorDate) throw new Error(`Coin Metrics CMBITM contains a duplicate/non-increasing New York close date: ${date}`);
    rows.push({ date, close: entry.value });
    priorTimestamp = entry.timestampMilliseconds;
    priorDate = date;
  }
  if (rows.length < 1000) throw new Error(`Coin Metrics CMBITM returned too little completed history (${rows.length})`);
  return {
    symbol: 'CMBITM',
    name: 'Coin Metrics CMBI Total Market Index',
    currency: 'USD',
    tz: 'America/New_York',
    timezone: 'America/New_York',
    adjusted: false,
    adjustmentMode: 'Coin Metrics CMBITM USD index level at the New York close',
    sourceUrl: CMBITM_ENDPOINT,
    parserContract: CMBITM_PARSER_CONTRACT,
    rawResponseSha256,
    rawResponseBytes: rawBytes.length,
    rawRowCount: body.length,
    acceptedRawRowCount: normalized.length,
    completedRowCount: rows.length,
    firstAcceptedTimestamp: normalized[0].timestamp,
    lastAcceptedTimestamp: normalized.at(-1).timestamp,
    firstCompletedDate: rows[0].date,
    lastCompletedDate: rows.at(-1).date,
    fetchedAt,
    lastDate: rows.at(-1).date,
    intraday: false,
    excludedAfterRetrieval,
    rows,
  };
}

function validateConfiguredMarkets(marketConfig) {
  const actualKeys = Object.keys((marketConfig && marketConfig.markets) || {}).sort();
  const expectedKeys = MARKET_SPECS.map(spec => spec.key).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`configured market set drifted: ${actualKeys.join(', ') || 'missing'}`);
  }
  assertRawModelContract({
    id: marketConfig.modelId,
    version: marketConfig.version,
    window: marketConfig.window,
    minWindowPoints: marketConfig.minWindowPoints,
    minComponents: marketConfig.minComponents,
    fillDays: marketConfig.fillDays,
  }, 'data/config.json');
  for (const spec of MARKET_SPECS.filter(spec => spec.key !== 'crypto')) {
    const target = marketConfig.markets[spec.key] && marketConfig.markets[spec.key].symbols && marketConfig.markets[spec.key].symbols.index;
    if (target !== spec.target) throw new Error(`${spec.key}: configured index ${target || 'missing'} differs from frozen target ${spec.target}`);
  }
}

function normalizeSignalRows(source, completedPriceDates, marketKey) {
  const rows = [];
  let priorDate = null;
  for (const row of source.history || []) {
    if (!completedPriceDates.has(row.date)) continue;
    if (priorDate && row.date <= priorDate) throw new Error(`${marketKey}: signal history is not strictly increasing`);
    priorDate = row.date;
    const components = {};
    for (const key of COMPONENT_KEYS) {
      const value = row.parts && row.parts[key];
      if (!value || !Number.isFinite(value.score) || value.score < 0 || value.score > 100 ||
          !Number.isFinite(value.raw) || typeof value.asOf !== 'string' || value.asOf > row.date) {
        throw new Error(`${marketKey}/${row.date}: invalid or non-causal ${key} research component`);
      }
      components[key] = { score: value.score, raw: value.raw, asOf: value.asOf };
    }
    if (Number(row.n) !== REQUIRED_COMPONENTS) throw new Error(`${marketKey}/${row.date}: not all six components are present`);
    rows.push({ date: row.date, componentCount: REQUIRED_COMPONENTS, components });
  }
  if (rows.length < 250) throw new Error(`${marketKey}: too little strict six-component signal history (${rows.length})`);
  return rows;
}

async function collectLiveSnapshot() {
  const createdAt = new Date().toISOString();
  const configBytes = fs.readFileSync(CONFIG_PATH);
  const config = JSON.parse(configBytes.toString('utf8'));
  if (config.cryptoFearGreed) throw new Error('retired separate cryptoFearGreed configuration is present');
  const productionMarketConfig = config.marketFearGreed || {};
  validateConfiguredMarkets(productionMarketConfig);

  const researchMarketConfig = deepClone(productionMarketConfig);
  const productionCryptoMapping = deepClone(researchMarketConfig.markets.crypto.symbols);
  researchMarketConfig.markets.crypto = {
    ...researchMarketConfig.markets.crypto,
    name: 'Crypto — experimental Coin Metrics CMBI Total Market benchmark',
    barPolicy: 'completed provider New York close',
    symbols: deepClone(EXPERIMENTAL_CRYPTO_MAPPING),
  };

  const marketfg = require(MARKET_FG_PATH);
  const rawSymbols = [...new Set(Object.values(researchMarketConfig.markets).flatMap(market =>
    Object.values(market.symbols || {}).flatMap(spec => marketfg.collectSpecSymbols(spec))))];
  const yahooSymbols = rawSymbols.filter(symbol => symbol !== 'CMBITM');
  const [yahooSeries, cmbitmSeries] = await Promise.all([
    mapLimit(yahooSymbols, 3, symbol => fetchYahooSeries(symbol, createdAt)),
    fetchCmbitmSeries(createdAt),
  ]);
  const rawSeries = new Map(yahooSeries.map(series => [series.symbol, series]));
  rawSeries.set('CMBITM', cmbitmSeries);
  const rawModel = {
    ...RAW_MODEL_CONTRACT,
    owner: 'repository',
    name: 'Unified Fear & Greed raw six-component engine',
  };
  assertRawModelContract(rawModel, 'research raw model');
  const computedMarkets = {};
  for (const spec of MARKET_SPECS) {
    computedMarkets[spec.key] = marketfg.computeMarket(spec.key, researchMarketConfig.markets[spec.key], rawSeries, {
      window: RAW_MODEL_CONTRACT.window,
      minWindowPoints: RAW_MODEL_CONTRACT.minWindowPoints,
      minComponents: RAW_MODEL_CONTRACT.minComponents,
      fillDays: RAW_MODEL_CONTRACT.fillDays,
      historyPoints: 100000,
      includeHistoryParts: true,
    });
  }

  const markets = MARKET_SPECS.map(spec => {
    const source = computedMarkets[spec.key];
    const targetPrices = rawSeries.get(spec.target);
    const completedPriceDates = new Set(targetPrices.rows.map(row => row.date));
    if (source.indexSymbol !== spec.target) throw new Error(`${spec.key}: marketfg index ${source.indexSymbol} differs from ${spec.target}`);
    return {
      ...spec,
      signalIdentity: 'Repository-owned six-component raw engine with frozen candidate weights and causal smoothing applied only by this runner',
      researchMapping: deepClone(source.mapping),
      requiredComponents: REQUIRED_COMPONENTS,
      componentCarryDays: RAW_MODEL_CONTRACT.fillDays,
      signals: normalizeSignalRows(source, completedPriceDates, spec.key),
      prices: targetPrices,
    };
  });
  const cmbitmEvidence = {
    parserContract: cmbitmSeries.parserContract,
    rawResponseSha256: cmbitmSeries.rawResponseSha256,
    rawResponseBytes: cmbitmSeries.rawResponseBytes,
    rawRowCount: cmbitmSeries.rawRowCount,
    acceptedRawRowCount: cmbitmSeries.acceptedRawRowCount,
    completedRowCount: cmbitmSeries.completedRowCount,
    excludedAfterRetrieval: cmbitmSeries.excludedAfterRetrieval,
    firstAcceptedTimestamp: cmbitmSeries.firstAcceptedTimestamp,
    lastAcceptedTimestamp: cmbitmSeries.lastAcceptedTimestamp,
    firstCompletedDate: cmbitmSeries.firstCompletedDate,
    lastCompletedDate: cmbitmSeries.lastCompletedDate,
  };
  const seriesInventory = normalizedSeriesInventory(rawSeries);

  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt,
    purpose: 'Frozen normalized inputs for the predeclared shared Fear & Greed model search',
    frozenDesign: deepClone(FROZEN_DESIGN),
    sourceCode: {
      nodeVersion: process.version,
      platform: `${process.platform}-${process.arch}`,
      marketfgPath: portablePath(MARKET_FG_PATH),
      marketfgSha256: sha256File(MARKET_FG_PATH),
      configPath: portablePath(CONFIG_PATH),
      configSha256: sha256Buffer(configBytes),
      runnerPath: portablePath(__filename),
      runnerSha256: sha256File(__filename),
      protocolPath: portablePath(PROTOCOL_PATH),
      protocolSha256: sha256File(PROTOCOL_PATH),
    },
    sources: {
      componentScores: {
        identity: 'marketfg.js computeMarket includeHistoryParts output from normalized Yahoo series plus research-only CMBITM adapter',
        fetchedAt: createdAt,
        rawModel,
        failedMarkets: {},
        symbolErrors: {},
        yahooEndpointTemplate: YAHOO_CHART_TEMPLATE,
        coinMetricsCmbitmEndpoint: CMBITM_ENDPOINT,
        coinMetricsCmbitmRawResponse: cmbitmEvidence,
      },
      targetPrices: {
        identity: 'Yahoo Finance chart daily adjusted closes for four targets; Coin Metrics CMBITM New York close index levels for Crypto',
        fetchedAt: createdAt,
        endpointTemplate: YAHOO_CHART_TEMPLATE,
        partialBarPolicy: 'Yahoo excludes the retrieval-exchange-local current date and later dates. CMBITM admits only timestamps at or before fetchedAt and validates strictly increasing New York close dates.',
      },
      normalizedSeriesInventory: seriesInventory,
    },
    mappings: {
      productionCryptoMappingAtCollection: productionCryptoMapping,
      experimentalCryptoMapping: deepClone(EXPERIMENTAL_CRYPTO_MAPPING),
      unchangedNonCryptoMappings: Object.fromEntries(MARKET_SPECS.filter(spec => spec.key !== 'crypto').map(spec => [
        spec.key, deepClone(productionMarketConfig.markets[spec.key].symbols),
      ])),
    },
    assumptions: {
      cryptoIndex: 'CMBITM is a provider-maintained broad eligible/investable crypto index, not literally every cryptoasset and not a repository-owned index.',
      cryptoConstruction: 'CMBITM is estimated-market-cap weighted, rebalanced monthly and reconstituted quarterly; pegged assets, on-chain derivatives, illiquid assets and too-new assets are excluded.',
      cryptoBreadthOverlap: 'Breadth uses CMBITM / BTC-USD. BTC is also inside CMBITM, so numerator and denominator overlap; this is an explicit limitation.',
      cryptoCalendar: 'CMBITM uses provider New York closes and Crypto outcomes/controls are annualized at 365.',
      cryptoComponentVolatilityScaling: 'The shared raw engine retains its fixed sqrt(252) realised-volatility scale. That positive constant cancels in volatility-versus-own-mean and percentile scoring; it does not change the Crypto component score.',
      cryptoHistory: 'The returned series starts 2019-07-01. Values before the 2022-11-22 index launch are provider-backtested. Methodology v1.4 names 2019-07-01 as first/base date while the product webpage names 2019-04-01; the returned data is authoritative for this snapshot.',
      cryptoLicensing: 'indexes.coinmetrics.io is an undocumented web endpoint for this use. Results are local research only pending explicit licensing and redistribution permission.',
      timing: 'Signal on benchmark bar t; enter at close t+1; exit at close t+22. Only outcomes already ended by a refit origin may train that refit.',
      vintage: 'Downloaded current histories are not point-in-time vintages and can contain provider revisions.',
      inference: 'The final 25% is a quasi-holdout because prior v1 outcomes through August 2026 were already inspected.',
    },
    markets,
  };
}

function validateSnapshot(snapshot) {
  if (!snapshot || Number(snapshot.schemaVersion) !== SCHEMA_VERSION || !Array.isArray(snapshot.markets)) {
    throw new Error('unsupported or invalid snapshot: this runner accepts schema 4 only');
  }
  assertExactObject(snapshot.frozenDesign, FROZEN_DESIGN, 'snapshot frozen design');
  const sourceCode = snapshot.sourceCode || {};
  const currentSourceHashes = {
    marketfgSha256: sha256File(MARKET_FG_PATH),
    configSha256: sha256File(CONFIG_PATH),
    runnerSha256: sha256File(__filename),
    protocolSha256: sha256File(PROTOCOL_PATH),
  };
  for (const [key, currentHash] of Object.entries(currentSourceHashes)) {
    if (!/^[a-f0-9]{64}$/.test(String(sourceCode[key] || '')) || sourceCode[key] !== currentHash) {
      throw new Error(`snapshot ${key} does not match the currently executing frozen source`);
    }
  }
  assertRawModelContract(snapshot.sources && snapshot.sources.componentScores && snapshot.sources.componentScores.rawModel, 'snapshot');
  const actualKeys = snapshot.markets.map(market => market.key).sort();
  const expectedKeys = MARKET_SPECS.map(spec => spec.key).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) throw new Error('snapshot market set differs from the frozen five-tab design');
  for (const spec of MARKET_SPECS) {
    const market = snapshot.markets.find(candidate => candidate.key === spec.key);
    if (!market || market.target !== spec.target || Number(market.annualization) !== spec.annualization) {
      throw new Error(`${spec.key}: snapshot target or annualization drifted`);
    }
    if (Number(market.requiredComponents) !== REQUIRED_COMPONENTS || !market.prices || !Array.isArray(market.prices.rows) || !Array.isArray(market.signals)) {
      throw new Error(`${spec.key}: incomplete schema-4 market payload`);
    }
    let priorPriceDate = null;
    for (const row of market.prices.rows) {
      if (typeof row.date !== 'string' || !Number.isFinite(row.close) || row.close <= 0 || (priorPriceDate && row.date <= priorPriceDate)) {
        throw new Error(`${spec.key}: invalid or unordered price history`);
      }
      priorPriceDate = row.date;
    }
    let priorSignalDate = null;
    for (const row of market.signals) {
      if (typeof row.date !== 'string' || (priorSignalDate && row.date <= priorSignalDate) || Number(row.componentCount) !== REQUIRED_COMPONENTS) {
        throw new Error(`${spec.key}: invalid or unordered strict signal history`);
      }
      priorSignalDate = row.date;
      if (!row.components || Object.keys(row.components).sort().join('|') !== COMPONENT_KEYS.slice().sort().join('|')) {
        throw new Error(`${spec.key}/${row.date}: component set differs from the frozen six`);
      }
      for (const key of COMPONENT_KEYS) {
        const value = row.components[key];
        if (!value || !Number.isFinite(value.score) || value.score < 0 || value.score > 100 || !Number.isFinite(value.raw) || value.asOf > row.date) {
          throw new Error(`${spec.key}/${row.date}: invalid or non-causal ${key}`);
        }
      }
    }
  }
  const expectedInventorySymbols = [...new Set(snapshot.markets.flatMap(market =>
    Object.values((market.researchMapping && market.researchMapping.symbols) || {}).flatMap(collectMappedSymbols)))].sort();
  const inventory = snapshot.sources && snapshot.sources.normalizedSeriesInventory;
  if (!Array.isArray(inventory) || JSON.stringify(inventory.map(item => item.symbol).sort()) !== JSON.stringify(expectedInventorySymbols)) {
    throw new Error('snapshot normalized source-series inventory is missing symbols or contains unconfigured symbols');
  }
  const inventoryBySymbol = new Map();
  for (const item of inventory) {
    if (!item || typeof item.symbol !== 'string' || inventoryBySymbol.has(item.symbol) || typeof item.sourceUrl !== 'string' ||
        typeof item.timezone !== 'string' || typeof item.adjustmentMode !== 'string' || typeof item.fetchedAt !== 'string' ||
        !Number.isInteger(item.rowCount) || item.rowCount < 1 || typeof item.firstDate !== 'string' || typeof item.lastDate !== 'string' ||
        !/^[a-f0-9]{64}$/.test(String(item.normalizedRowsSha256 || ''))) {
      throw new Error('snapshot contains an invalid normalized source-series inventory entry');
    }
    inventoryBySymbol.set(item.symbol, item);
  }
  for (const market of snapshot.markets) {
    const item = inventoryBySymbol.get(market.target);
    const expectedRowsHash = sha256Buffer(Buffer.from(canonicalJson(market.prices.rows), 'utf8'));
    if (!item || item.rowCount !== market.prices.rows.length || item.firstDate !== market.prices.rows[0].date ||
        item.lastDate !== market.prices.rows.at(-1).date || item.normalizedRowsSha256 !== expectedRowsHash) {
      throw new Error(`${market.key}: target rows do not match the normalized source-series inventory`);
    }
  }
  const cryptoMarket = snapshot.markets.find(market => market.key === 'crypto');
  assertExactObject(cryptoMarket.researchMapping && cryptoMarket.researchMapping.symbols, EXPERIMENTAL_CRYPTO_MAPPING, 'snapshot Crypto research mapping');
  const cryptoPrices = cryptoMarket.prices || {};
  const rawEvidence = snapshot.sources && snapshot.sources.componentScores && snapshot.sources.componentScores.coinMetricsCmbitmRawResponse;
  const expectedEvidence = {
    parserContract: cryptoPrices.parserContract,
    rawResponseSha256: cryptoPrices.rawResponseSha256,
    rawResponseBytes: cryptoPrices.rawResponseBytes,
    rawRowCount: cryptoPrices.rawRowCount,
    acceptedRawRowCount: cryptoPrices.acceptedRawRowCount,
    completedRowCount: cryptoPrices.completedRowCount,
    excludedAfterRetrieval: cryptoPrices.excludedAfterRetrieval,
    firstAcceptedTimestamp: cryptoPrices.firstAcceptedTimestamp,
    lastAcceptedTimestamp: cryptoPrices.lastAcceptedTimestamp,
    firstCompletedDate: cryptoPrices.firstCompletedDate,
    lastCompletedDate: cryptoPrices.lastCompletedDate,
  };
  if (cryptoPrices.parserContract !== CMBITM_PARSER_CONTRACT || !/^[a-f0-9]{64}$/.test(String(cryptoPrices.rawResponseSha256 || '')) ||
      !Number.isInteger(cryptoPrices.rawResponseBytes) || cryptoPrices.rawResponseBytes <= 0 ||
      !Number.isInteger(cryptoPrices.rawRowCount) || cryptoPrices.rawRowCount < cryptoPrices.acceptedRawRowCount ||
      Number(cryptoPrices.acceptedRawRowCount) !== cryptoPrices.rows.length || Number(cryptoPrices.completedRowCount) !== cryptoPrices.rows.length ||
      cryptoPrices.firstCompletedDate !== cryptoPrices.rows[0].date || cryptoPrices.lastCompletedDate !== cryptoPrices.rows.at(-1).date ||
      typeof cryptoPrices.firstAcceptedTimestamp !== 'string' || typeof cryptoPrices.lastAcceptedTimestamp !== 'string') {
    throw new Error('snapshot CMBITM raw-response evidence is incomplete or inconsistent');
  }
  assertExactObject(rawEvidence, expectedEvidence, 'snapshot CMBITM source evidence');
  return snapshot;
}

function writeChecksum(file, digest) {
  const checksumFile = file.replace(/\.[^.]+$/, '.sha256');
  fs.writeFileSync(checksumFile, `${digest}  ${path.basename(file)}\n`, { encoding: 'utf8', flag: 'wx' });
  return checksumFile;
}

function writeSnapshot(snapshot, outputRoot, stamp = runStamp()) {
  validateSnapshot(snapshot);
  const directory = path.join(outputRoot, 'inputs');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `fear-greed-model-search-input-${stamp}.json`);
  const bytes = Buffer.from(canonicalJson(snapshot), 'utf8');
  fs.writeFileSync(file, bytes, { flag: 'wx' });
  const digest = sha256Buffer(bytes);
  const checksumFile = writeChecksum(file, digest);
  return { snapshot, file, checksumFile, sha256: digest, checksumVerified: true };
}

function readSnapshot(file) {
  const bytes = fs.readFileSync(file);
  const digest = sha256Buffer(bytes);
  const checksumFile = file.replace(/\.[^.]+$/, '.sha256');
  if (!fs.existsSync(checksumFile)) throw new Error(`schema-4 snapshot checksum sidecar is required: ${checksumFile}`);
  const expected = fs.readFileSync(checksumFile, 'utf8').trim().split(/\s+/)[0].toLowerCase();
  if (expected !== digest) throw new Error(`snapshot checksum mismatch: expected ${expected}, got ${digest}`);
  const snapshot = validateSnapshot(JSON.parse(bytes.toString('utf8')));
  return { snapshot, file, checksumFile, sha256: digest, checksumVerified: true };
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStandardDeviation(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (values.length - 1));
}

function computeCandidateSeries(signalRows, candidate) {
  if (!candidate || !FROZEN_CANDIDATES.some(item => item.id === candidate.id)) throw new Error('candidate is outside the frozen family');
  const base = signalRows.map(row => {
    let score = 0;
    for (let index = 0; index < COMPONENT_KEYS.length; index++) {
      const value = row.components && row.components[COMPONENT_KEYS[index]];
      if (!value || !Number.isFinite(value.score)) throw new Error(`${row.date || 'unknown'}: missing component ${COMPONENT_KEYS[index]}`);
      score += candidate.normalizedWeights[index] * value.score;
    }
    return score;
  });
  const output = [];
  const window = candidate.smoothingObservations;
  let rolling = 0;
  for (let index = 0; index < signalRows.length; index++) {
    rolling += base[index];
    if (index >= window) rolling -= base[index - window];
    if (index >= window - 1) output.push({ date: signalRows[index].date, score: rolling / window });
  }
  return output;
}

function computeControls(prices, index, annualization) {
  if (index < 125) return null;
  const close = prices[index].close;
  const logReturns20 = [];
  for (let cursor = index - 19; cursor <= index; cursor++) {
    logReturns20.push(Math.log(prices[cursor].close / prices[cursor - 1].close));
  }
  const average125 = mean(prices.slice(index - 124, index + 1).map(row => row.close));
  const realizedVolatility = sampleStandardDeviation(logReturns20);
  if (!(realizedVolatility > 0) || !(average125 > 0)) return null;
  return {
    lagReturn1: close / prices[index - 1].close - 1,
    lagReturn5: close / prices[index - 5].close - 1,
    lagReturn20: close / prices[index - 20].close - 1,
    realizedVol20: realizedVolatility * Math.sqrt(annualization),
    trend125: close / average125 - 1,
  };
}

function buildCommonObservations(market, candidates = FROZEN_CANDIDATES) {
  if (candidates.length !== 15) throw new Error('analysis requires all 15 frozen candidates');
  const candidateMaps = new Map(candidates.map(candidate => [
    candidate.id,
    new Map(computeCandidateSeries(market.signals, candidate).map(row => [row.date, row.score])),
  ]));
  const prices = market.prices.rows;
  const priceIndex = new Map(prices.map((row, index) => [row.date, index]));
  const audit = {
    signals: market.signals.length,
    maximumSmoothingWarmupDropped: Math.max(...candidates.map(candidate => candidate.smoothingObservations)) - 1,
    missingCandidateScore: 0,
    missingExactPriceDate: 0,
    missingControls: 0,
    incompleteOutcome: 0,
    zeroFutureVolatility: 0,
    eligible: 0,
  };
  const rows = [];
  for (const signal of market.signals) {
    const candidateScores = {};
    let complete = true;
    for (const candidate of candidates) {
      const score = candidateMaps.get(candidate.id).get(signal.date);
      if (!Number.isFinite(score)) { complete = false; break; }
      candidateScores[candidate.id] = score;
    }
    if (!complete) { audit.missingCandidateScore++; continue; }
    const signalIndex = priceIndex.get(signal.date);
    if (signalIndex == null) { audit.missingExactPriceDate++; continue; }
    const controls = computeControls(prices, signalIndex, market.annualization);
    if (!controls || CONTROL_FEATURES.some(feature => !Number.isFinite(controls[feature]))) { audit.missingControls++; continue; }
    const entryIndex = signalIndex + 1;
    const exitIndex = entryIndex + PRIMARY_HORIZON;
    if (exitIndex >= prices.length) { audit.incompleteOutcome++; continue; }
    const futureLogReturns = [];
    for (let cursor = entryIndex + 1; cursor <= exitIndex; cursor++) {
      futureLogReturns.push(Math.log(prices[cursor].close / prices[cursor - 1].close));
    }
    const futureVolatility = sampleStandardDeviation(futureLogReturns) * Math.sqrt(market.annualization);
    if (!(futureVolatility > 0)) { audit.zeroFutureVolatility++; continue; }
    rows.push({
      signalDate: signal.date,
      signalIndex,
      entryIndex,
      exitIndex,
      entryDate: prices[entryIndex].date,
      exitDate: prices[exitIndex].date,
      controls,
      candidateScores,
      forwardReturn: prices[exitIndex].close / prices[entryIndex].close - 1,
      futureLogVol: Math.log(futureVolatility),
    });
  }
  audit.eligible = rows.length;
  return { rows, audit };
}

function splitCommonRows(rows) {
  if (!Array.isArray(rows) || rows.length < 4) throw new Error('too few common rows for a 50/25/25 split');
  const developmentStart = Math.floor(rows.length * 0.50);
  const finalStart = Math.floor(rows.length * 0.75);
  if (developmentStart < 1 || finalStart <= developmentStart || finalStart >= rows.length) throw new Error('invalid 50/25/25 split');
  return {
    rule: 'first 50% initial history, next 25% development walk-forward, final 25% one-time quasi-holdout',
    total: rows.length,
    initial: { start: 0, end: developmentStart, count: developmentStart, firstDate: rows[0].signalDate, lastDate: rows[developmentStart - 1].signalDate },
    development: { start: developmentStart, end: finalStart, count: finalStart - developmentStart, firstDate: rows[developmentStart].signalDate, lastDate: rows[finalStart - 1].signalDate },
    final: { start: finalStart, end: rows.length, count: rows.length - finalStart, firstDate: rows[finalStart].signalDate, lastDate: rows.at(-1).signalDate },
  };
}

function calendarDaysBetween(firstDate, lastDate) {
  const first = Date.parse(`${firstDate}T00:00:00Z`);
  const last = Date.parse(`${lastDate}T00:00:00Z`);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) return null;
  return Math.round((last - first) / 86400000);
}

function assessSegmentAdequacy(allRows, segment, minimums = DATA_ADEQUACY_MINIMUMS) {
  const rows = allRows.slice(segment.start, segment.end);
  let nonOverlappingOutcomes = 0;
  let priorAdmittedExitIndex = -Infinity;
  for (const row of rows) {
    if (row.entryIndex >= priorAdmittedExitIndex) {
      nonOverlappingOutcomes++;
      priorAdmittedExitIndex = row.exitIndex;
    }
  }
  const calendarSpanDays = rows.length ? calendarDaysBetween(rows[0].entryDate, rows.at(-1).exitDate) : null;
  const gates = {
    forecastRowsAtLeast756: rows.length >= minimums.forecastRows,
    nonOverlappingOutcomesAtLeast36: nonOverlappingOutcomes >= minimums.nonOverlappingOutcomes,
    calendarSpanAtLeast1095Days: Number.isFinite(calendarSpanDays) && calendarSpanDays >= minimums.calendarSpanDays,
  };
  return {
    segment: { ...segment },
    forecastRows: rows.length,
    nonOverlappingOutcomes,
    greedyRule: 'chronological; admit a row when entryIndex >= the previously admitted exitIndex',
    firstEntryDate: rows.length ? rows[0].entryDate : null,
    lastExitDate: rows.length ? rows.at(-1).exitDate : null,
    calendarSpanDays,
    minimums: { ...minimums },
    gates,
    failedGates: Object.entries(gates).filter(([, pass]) => !pass).map(([gate]) => gate),
    pass: Object.values(gates).every(Boolean),
    interpretation: 'Frozen data-adequacy minimum only; not a formal statistical-power guarantee.',
  };
}

function availableTrainingRows(allRows, forecastOrigin) {
  const originSignalIndex = typeof forecastOrigin === 'number' ? forecastOrigin : forecastOrigin.signalIndex;
  return allRows.filter(row => row.signalIndex < originSignalIndex && row.exitIndex <= originSignalIndex);
}

function solveLinear(matrix, vector, tolerance = 1e-12) {
  const size = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let column = 0; column < size; column++) {
    let pivot = column;
    for (let row = column + 1; row < size; row++) {
      if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    }
    if (!Number.isFinite(augmented[pivot][column]) || Math.abs(augmented[pivot][column]) <= tolerance) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let cursor = column; cursor <= size; cursor++) augmented[column][cursor] /= divisor;
    for (let row = 0; row < size; row++) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let cursor = column; cursor <= size; cursor++) augmented[row][cursor] -= factor * augmented[column][cursor];
    }
  }
  return augmented.map(row => row[size]);
}

function featureValue(row, feature, candidateId) {
  return feature === 'score' ? row.candidateScores[candidateId] : row.controls[feature];
}

function fitOls(rows, featureNames, candidateId, outcomeKey) {
  const minimumRows = Math.max(30, (featureNames.length + 1) * 5);
  if (rows.length < minimumRows) return { ok: false, reason: `only ${rows.length} training rows; ${minimumRows} required` };
  const means = {};
  const scales = {};
  for (const feature of featureNames) {
    const values = rows.map(row => featureValue(row, feature, candidateId));
    if (values.some(value => !Number.isFinite(value))) return { ok: false, reason: `non-finite ${feature}` };
    means[feature] = mean(values);
    scales[feature] = sampleStandardDeviation(values);
    if (!Number.isFinite(scales[feature]) || scales[feature] <= 1e-12) return { ok: false, reason: `singular ${feature} scale` };
  }
  const outcomes = rows.map(row => row[outcomeKey]);
  if (outcomes.some(value => !Number.isFinite(value))) return { ok: false, reason: `non-finite ${outcomeKey}` };
  const design = rows.map(row => [1, ...featureNames.map(feature => (featureValue(row, feature, candidateId) - means[feature]) / scales[feature])]);
  const dimension = featureNames.length + 1;
  const xtx = Array.from({ length: dimension }, () => Array(dimension).fill(0));
  const xty = Array(dimension).fill(0);
  for (let row = 0; row < design.length; row++) {
    for (let left = 0; left < dimension; left++) {
      xty[left] += design[row][left] * outcomes[row];
      for (let right = 0; right < dimension; right++) xtx[left][right] += design[row][left] * design[row][right];
    }
  }
  const coefficients = solveLinear(xtx, xty);
  if (!coefficients) return { ok: false, reason: 'singular OLS normal equations' };
  return {
    ok: true,
    featureNames: featureNames.slice(),
    means,
    scales,
    coefficients,
    predict(row) {
      let prediction = coefficients[0];
      for (let index = 0; index < featureNames.length; index++) {
        const feature = featureNames[index];
        prediction += coefficients[index + 1] * ((featureValue(row, feature, candidateId) - means[feature]) / scales[feature]);
      }
      return prediction;
    },
  };
}

function walkForwardForecast(allRows, segment, candidateId, outcomeKey) {
  const forecastRows = allRows.slice(segment.start, segment.end);
  const predictions = [];
  const blocks = [];
  for (let offset = 0; offset < forecastRows.length; offset += REFIT_OBSERVATIONS) {
    const blockRows = forecastRows.slice(offset, offset + REFIT_OBSERVATIONS);
    const origin = blockRows[0];
    const trainingRows = availableTrainingRows(allRows, origin);
    const controlsModel = fitOls(trainingRows, CONTROL_FEATURES, candidateId, outcomeKey);
    const fullModel = fitOls(trainingRows, [...CONTROL_FEATURES, 'score'], candidateId, outcomeKey);
    if (!controlsModel.ok || !fullModel.ok) {
      return {
        ok: false,
        candidateId,
        outcomeKey,
        segment: { ...segment },
        failedAt: origin.signalDate,
        reason: `controls=${controlsModel.reason || 'ok'}; full=${fullModel.reason || 'ok'}`,
        blocks,
      };
    }
    const scoreCoefficient = fullModel.coefficients.at(-1);
    const maximumTrainingExitIndex = trainingRows.length ? Math.max(...trainingRows.map(row => row.exitIndex)) : null;
    blocks.push({
      block: blocks.length + 1,
      forecastStart: blockRows[0].signalDate,
      forecastEnd: blockRows.at(-1).signalDate,
      forecastRows: blockRows.length,
      forecastOriginSignalIndex: origin.signalIndex,
      trainingRows: trainingRows.length,
      maximumTrainingExitIndex,
      lastKnownOutcomeExitDate: trainingRows.length ? trainingRows.at(-1).exitDate : null,
      outcomeAvailabilityVerified: maximumTrainingExitIndex != null && maximumTrainingExitIndex <= origin.signalIndex,
      scoreStandardizedCoefficient: scoreCoefficient,
    });
    for (const row of blockRows) {
      const actual = row[outcomeKey];
      const controlsPrediction = controlsModel.predict(row);
      const fullPrediction = fullModel.predict(row);
      predictions.push({
        signalDate: row.signalDate,
        actual,
        controlsPrediction,
        fullPrediction,
        controlsSquaredError: (actual - controlsPrediction) ** 2,
        fullSquaredError: (actual - fullPrediction) ** 2,
        lossDifference: ((actual - controlsPrediction) ** 2) - ((actual - fullPrediction) ** 2),
      });
    }
  }
  const mseControls = mean(predictions.map(row => row.controlsSquaredError));
  const mseFull = mean(predictions.map(row => row.fullSquaredError));
  return {
    ok: predictions.length > 0 && Number.isFinite(mseControls) && Number.isFinite(mseFull),
    candidateId,
    outcomeKey,
    segment: { ...segment },
    refitEveryForecastObservations: REFIT_OBSERVATIONS,
    forecastRows: predictions.length,
    mseControls,
    mseControlsPlusScore: mseFull,
    relativeMseImprovementVsControls: mseControls > 0 ? (mseControls - mseFull) / mseControls : null,
    blocks,
    predictions,
  };
}

function coefficientSignSummary(blocks) {
  const values = blocks.map(block => block.scoreStandardizedCoefficient);
  const positive = values.filter(value => value > 0).length;
  const negative = values.filter(value => value < 0).length;
  const zero = values.length - positive - negative;
  const dominantSign = positive === negative ? null : (positive > negative ? 'positive' : 'negative');
  const dominantCount = dominantSign === 'positive' ? positive : dominantSign === 'negative' ? negative : 0;
  return {
    blocks: values.length,
    positive,
    negative,
    zero,
    positiveFraction: values.length ? positive / values.length : null,
    negativeFraction: values.length ? negative / values.length : null,
    dominantSign,
    dominantFraction: values.length ? dominantCount / values.length : null,
  };
}

function compactWalkForward(result) {
  if (!result || !result.ok) return result;
  const { predictions, ...summary } = result;
  return {
    ...summary,
    scoreCoefficientSigns: coefficientSignSummary(result.blocks),
    pairedLossDifferences: predictions.map(row => ({ signalDate: row.signalDate, lossDifference: row.lossDifference })),
  };
}

function buildDevelopmentLedger(marketContexts, candidates, outcomeKey) {
  return candidates.map(candidate => {
    const markets = {};
    const improvements = [];
    const failures = [];
    for (const spec of MARKET_SPECS) {
      const context = marketContexts[spec.key];
      const forecast = walkForwardForecast(context.rows, context.split.development, candidate.id, outcomeKey);
      markets[spec.key] = compactWalkForward(forecast);
      if (forecast.ok && Number.isFinite(forecast.relativeMseImprovementVsControls)) improvements.push(forecast.relativeMseImprovementVsControls);
      else failures.push(`${spec.key}: ${forecast.reason || 'non-finite forecast result'}`);
    }
    const validAllMarkets = failures.length === 0 && improvements.length === MARKET_SPECS.length;
    return {
      candidate,
      outcomeKey,
      validAllMarkets,
      failures,
      positiveMarketCount: validAllMarkets ? improvements.filter(value => value > 0).length : null,
      worstMarketImprovement: validAllMarkets ? Math.min(...improvements) : null,
      equalMarketMeanImprovement: validAllMarkets ? mean(improvements) : null,
      markets,
    };
  });
}

function selectCandidate(ledger) {
  const valid = ledger.filter(entry => entry.validAllMarkets);
  if (!valid.length) return null;
  return [...valid].sort((left, right) => {
    if (right.positiveMarketCount !== left.positiveMarketCount) return right.positiveMarketCount - left.positiveMarketCount;
    if (right.worstMarketImprovement !== left.worstMarketImprovement) return right.worstMarketImprovement - left.worstMarketImprovement;
    if (right.equalMarketMeanImprovement !== left.equalMarketMeanImprovement) return right.equalMarketMeanImprovement - left.equalMarketMeanImprovement;
    return left.candidate.declarationOrder - right.candidate.declarationOrder;
  })[0];
}

function erf(value) {
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value);
  const t = 1 / (1 + 0.3275911 * absolute);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - polynomial * Math.exp(-absolute * absolute));
}

function normalCdf(value) {
  return 0.5 * (1 + erf(value / Math.sqrt(2)));
}

function neweyWestMeanTest(values, minimumBandwidth = PRIMARY_HORIZON) {
  if (!Array.isArray(values) || values.length < minimumBandwidth + 2 || values.some(value => !Number.isFinite(value))) {
    return { n: values ? values.length : 0, mean: null, standardError: null, z: null, pValueOneSidedPositive: null, bandwidth: null };
  }
  const n = values.length;
  const average = mean(values);
  const centered = values.map(value => value - average);
  const automatic = Math.floor(4 * ((n / 100) ** (2 / 9)));
  const bandwidth = Math.min(n - 1, Math.max(minimumBandwidth, automatic));
  let longRunVariance = centered.reduce((sum, value) => sum + value * value, 0) / n;
  for (let lag = 1; lag <= bandwidth; lag++) {
    let covariance = 0;
    for (let index = lag; index < n; index++) covariance += centered[index] * centered[index - lag];
    covariance /= n;
    longRunVariance += 2 * (1 - lag / (bandwidth + 1)) * covariance;
  }
  longRunVariance = Math.max(0, longRunVariance);
  const standardError = Math.sqrt(longRunVariance / n);
  let z;
  let pValue;
  if (standardError > 0) {
    z = average / standardError;
    pValue = Math.max(0, Math.min(1, 1 - normalCdf(z)));
  } else {
    z = average > 0 ? Infinity : average < 0 ? -Infinity : 0;
    pValue = average > 0 ? 0 : 1;
  }
  return { n, mean: average, standardError, z, pValueOneSidedPositive: pValue, bandwidth };
}

function benjaminiHochberg(tests) {
  const output = tests.map(test => ({ ...test, qValue: null }));
  const valid = output.filter(test => Number.isFinite(test.pValue)).sort((left, right) => left.pValue - right.pValue || left.id.localeCompare(right.id));
  let prior = 1;
  for (let index = valid.length - 1; index >= 0; index--) {
    const rank = index + 1;
    const qValue = Math.min(prior, valid[index].pValue * valid.length / rank, 1);
    valid[index].qValue = qValue;
    prior = qValue;
  }
  return output;
}

function evaluateFinal(marketContexts, selectedEntry, outcomeKey) {
  if (!selectedEntry) return { selectedCandidate: null, markets: {}, bhFamilySize: 0, reason: 'no candidate completed development in all five markets' };
  const candidateId = selectedEntry.candidate.id;
  const transient = {};
  const tests = [];
  for (const spec of MARKET_SPECS) {
    const context = marketContexts[spec.key];
    const forecast = walkForwardForecast(context.rows, context.split.final, candidateId, outcomeKey);
    transient[spec.key] = forecast;
    const nw = forecast.ok ? neweyWestMeanTest(forecast.predictions.map(row => row.lossDifference), PRIMARY_HORIZON) : null;
    tests.push({
      id: spec.key,
      pValue: nw && Number.isFinite(nw.pValueOneSidedPositive) ? nw.pValueOneSidedPositive : null,
    });
  }
  const adjusted = benjaminiHochberg(tests);
  const qByMarket = new Map(adjusted.map(test => [test.id, test.qValue]));
  const markets = {};
  for (const spec of MARKET_SPECS) {
    const forecast = transient[spec.key];
    const development = selectedEntry.markets[spec.key];
    const finalSummary = compactWalkForward(forecast);
    const nw = forecast.ok ? neweyWestMeanTest(forecast.predictions.map(row => row.lossDifference), PRIMARY_HORIZON) : null;
    const qValue = qByMarket.get(spec.key);
    const developmentSigns = development && development.scoreCoefficientSigns;
    const finalSigns = finalSummary && finalSummary.scoreCoefficientSigns;
    const adequacy = marketContexts[spec.key].adequacy;
    let pass = false;
    const gates = {};
    if (outcomeKey === TARGETS.return) {
      gates.developmentSegmentDataAdequate = adequacy.development.pass;
      gates.finalSegmentDataAdequate = adequacy.final.pass;
      gates.finalMseImprovementAtLeast005 = !!(forecast.ok && forecast.relativeMseImprovementVsControls >= 0.005);
      gates.bh5QAtMost005 = Number.isFinite(qValue) && qValue <= 0.05;
      gates.developmentDominantNonZeroAtLeast70 = !!(developmentSigns && developmentSigns.dominantSign && developmentSigns.dominantFraction >= 0.70);
      gates.finalDominantNonZeroAtLeast70 = !!(finalSigns && finalSigns.dominantSign && finalSigns.dominantFraction >= 0.70);
      gates.sameDominantSign = !!(developmentSigns && finalSigns && developmentSigns.dominantSign && developmentSigns.dominantSign === finalSigns.dominantSign);
      pass = Object.values(gates).every(Boolean);
    } else {
      gates.developmentSegmentDataAdequate = adequacy.development.pass;
      gates.finalSegmentDataAdequate = adequacy.final.pass;
      gates.finalMseImprovementAtLeast010 = !!(forecast.ok && forecast.relativeMseImprovementVsControls >= 0.010);
      gates.bh5QAtMost005 = Number.isFinite(qValue) && qValue <= 0.05;
      gates.developmentNegativeAtLeast70 = !!(developmentSigns && developmentSigns.negativeFraction >= 0.70);
      gates.finalNegativeAtLeast70 = !!(finalSigns && finalSigns.negativeFraction >= 0.70);
      pass = Object.values(gates).every(Boolean);
    }
    markets[spec.key] = {
      walkForward: finalSummary,
      neweyWestPairedLossImprovement: nw,
      bh5QValue: qValue,
      gates,
      dataAdequacy: adequacy,
      pass,
    };
  }
  return {
    selectedCandidate: selectedEntry.candidate,
    selectedDevelopmentRank: {
      positiveMarketCount: selectedEntry.positiveMarketCount,
      worstMarketImprovement: selectedEntry.worstMarketImprovement,
      equalMarketMeanImprovement: selectedEntry.equalMarketMeanImprovement,
    },
    bhFamilySize: adjusted.filter(test => Number.isFinite(test.pValue)).length,
    markets,
  };
}

function fingerprintAnalysis(payload) {
  return sha256Buffer(Buffer.from(canonicalJson(payload), 'utf8'));
}

function analyzeSnapshot(snapshot, inputInfo = {}, options = {}) {
  validateSnapshot(snapshot);
  const candidates = buildCandidates();
  const marketContexts = {};
  const marketAudit = {};
  for (const spec of MARKET_SPECS) {
    const market = snapshot.markets.find(candidate => candidate.key === spec.key);
    const built = buildCommonObservations(market, candidates);
    if (built.rows.length < 160) throw new Error(`${spec.key}: only ${built.rows.length} common eligible rows; at least 160 are required for stable walk-forward fitting`);
    const split = splitCommonRows(built.rows);
    const adequacy = {
      development: assessSegmentAdequacy(built.rows, split.development),
      final: assessSegmentAdequacy(built.rows, split.final),
    };
    adequacy.pass = adequacy.development.pass && adequacy.final.pass;
    marketContexts[spec.key] = { rows: built.rows, split, adequacy };
    marketAudit[spec.key] = { target: spec.target, annualization: spec.annualization, observationAudit: built.audit, split, dataAdequacy: adequacy };
  }

  const returnLedger = buildDevelopmentLedger(marketContexts, candidates, TARGETS.return);
  const riskLedger = buildDevelopmentLedger(marketContexts, candidates, TARGETS.risk);
  if (returnLedger.length !== 15 || riskLedger.length !== 15) throw new Error('development ledger does not contain exactly 15 candidates per target');
  const selectedReturn = selectCandidate(returnLedger);
  const selectedRisk = selectCandidate(riskLedger);
  const dataAdequacyAllMarkets = MARKET_SPECS.every(spec => marketContexts[spec.key].adequacy.pass);
  const developmentReturnGate = {
    candidateSelected: !!selectedReturn,
    allDevelopmentAndFinalSegmentsDataAdequate: dataAdequacyAllMarkets,
    positiveImprovementAllFive: !!(selectedReturn && selectedReturn.positiveMarketCount === 5),
    equalMarketMeanImprovementAtLeast005: !!(selectedReturn && selectedReturn.equalMarketMeanImprovement >= 0.005),
  };
  developmentReturnGate.pass = developmentReturnGate.candidateSelected && developmentReturnGate.allDevelopmentAndFinalSegmentsDataAdequate &&
    developmentReturnGate.positiveImprovementAllFive && developmentReturnGate.equalMarketMeanImprovementAtLeast005;
  const developmentRiskGate = {
    candidateSelected: !!selectedRisk,
    allDevelopmentAndFinalSegmentsDataAdequate: dataAdequacyAllMarkets,
    positiveImprovementAllFive: !!(selectedRisk && selectedRisk.positiveMarketCount === 5),
    equalMarketMeanImprovementAtLeast010: !!(selectedRisk && selectedRisk.equalMarketMeanImprovement >= 0.010),
  };
  developmentRiskGate.pass = developmentRiskGate.candidateSelected && developmentRiskGate.allDevelopmentAndFinalSegmentsDataAdequate &&
    developmentRiskGate.positiveImprovementAllFive && developmentRiskGate.equalMarketMeanImprovementAtLeast010;

  const finalReturn = evaluateFinal(marketContexts, selectedReturn, TARGETS.return);
  const finalRisk = evaluateFinal(marketContexts, selectedRisk, TARGETS.risk);
  const returnAllFivePass = MARKET_SPECS.every(spec => finalReturn.markets[spec.key] && finalReturn.markets[spec.key].pass);
  const riskAllFivePass = MARKET_SPECS.every(spec => finalRisk.markets[spec.key] && finalRisk.markets[spec.key].pass);
  const decisions = {
    dataAdequacy: {
      minimumsPerMarketPerSegment: { ...DATA_ADEQUACY_MINIMUMS },
      allDevelopmentAndFinalSegmentsPass: dataAdequacyAllMarkets,
      formalPowerGuarantee: false,
      conclusion: dataAdequacyAllMarkets
        ? 'All development and final segments meet the frozen adequacy minimum; this is not a formal power guarantee.'
        : 'At least one development/final segment fails the frozen adequacy minimum; all results remain exploratory and underpowered.',
    },
    return: {
      developmentGate: developmentReturnGate,
      allFiveFinalTabsPass: returnAllFivePass,
      sharedHistoricalGatePass: developmentReturnGate.pass && returnAllFivePass,
      conclusion: !dataAdequacyAllMarkets
        ? 'Exploratory and underpowered: no historically promising or reliable return model can be claimed.'
        : developmentReturnGate.pass && returnAllFivePass
        ? 'Historically promising return model; not reliable until a separate forward-frozen paper period passes.'
        : 'No historically reliable shared return-prediction model found in the frozen 15-candidate family.',
    },
    futureRisk: {
      developmentGate: developmentRiskGate,
      allFiveFinalTabsPass: riskAllFivePass,
      sharedHistoricalGatePass: developmentRiskGate.pass && riskAllFivePass,
      conclusion: !dataAdequacyAllMarkets
        ? 'Exploratory and underpowered: no historically promising future-risk model can be claimed.'
        : developmentRiskGate.pass && riskAllFivePass
        ? 'Historically promising future-volatility model only; this is not return-direction evidence and still requires a forward-frozen period.'
        : 'No shared future-volatility model passed the frozen all-five-market gate.',
    },
  };

  const deterministicAnalysis = {
    schemaVersion: SCHEMA_VERSION,
    inputSnapshotSha256: inputInfo.sha256 || sha256Buffer(Buffer.from(canonicalJson(snapshot), 'utf8')),
    frozenDesign: deepClone(FROZEN_DESIGN),
    marketAudit,
    development: { return: returnLedger, futureRisk: riskLedger },
    selections: {
      returnCandidateId: selectedReturn ? selectedReturn.candidate.id : null,
      futureRiskCandidateId: selectedRisk ? selectedRisk.candidate.id : null,
    },
    final: { return: finalReturn, futureRisk: finalRisk },
    decisions,
  };
  const analysisFingerprintSha256 = fingerprintAnalysis(deterministicAnalysis);
  return {
    ...deterministicAnalysis,
    generatedAt: options.generatedAt || new Date().toISOString(),
    execution: options.execution || null,
    status: !dataAdequacyAllMarkets
      ? 'EXPLORATORY_UNDERPOWERED'
      : decisions.return.sharedHistoricalGatePass
      ? 'HISTORICALLY_PROMISING_REQUIRES_FORWARD_FREEZE'
      : 'NO_HISTORICALLY_RELIABLE_RETURN_MODEL_FOUND',
    analysisFingerprintSha256,
  };
}

function percent(value, digits = 2) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : '—';
}

function number(value, digits = 4) {
  return Number.isFinite(value) ? value.toFixed(digits) : '—';
}

function markdownReport(results) {
  const lines = [];
  lines.push('# Shared Fear & Greed model-search report');
  lines.push('');
  lines.push(`Status: **${results.status}**`);
  lines.push('');
  lines.push(results.decisions.return.conclusion);
  lines.push('');
  lines.push('This was one bounded historical search. The last 25% is only a quasi-holdout, and no passing result may be called reliable without a new forward-frozen paper period.');
  lines.push('');
  lines.push('## Frozen design');
  lines.push('');
  lines.push('- Five positive weight templates × trailing means of 1, 5 and 21 observations = exactly 15 candidates.');
  lines.push('- One shared candidate is selected lexicographically on development results; no tab-specific weights are allowed.');
  lines.push('- Primary outcomes: 21-bar later return and log future 21-bar annualized realized volatility.');
  lines.push('- Chronological 50% initial / 25% development / 25% final split; expanding OLS refit every 21 forecast rows.');
  lines.push('- Controls: lagged 1/5/20-bar returns, trailing 20-bar realized volatility, and close relative to its trailing 125-bar average.');
  lines.push('- Per market and per development/final segment, adequacy requires at least 756 forecast rows, 36 greedy non-overlapping 21-bar outcomes, and 1,095 calendar days from first entry to last exit. This is an adequacy minimum, not a formal power guarantee.');
  lines.push('');
  lines.push('## Data adequacy before interpretation');
  lines.push('');
  lines.push('| Tab | Segment | Forecast rows | Non-overlapping outcomes | Calendar span days | Failed gates | Adequate |');
  lines.push('|---|---|---:|---:|---:|---|---|');
  for (const spec of MARKET_SPECS) {
    for (const segmentName of ['development', 'final']) {
      const adequacy = results.marketAudit[spec.key].dataAdequacy[segmentName];
      lines.push(`| ${spec.name} | ${segmentName} | ${adequacy.forecastRows} | ${adequacy.nonOverlappingOutcomes} | ${adequacy.calendarSpanDays == null ? '—' : adequacy.calendarSpanDays} | ${adequacy.failedGates.length ? adequacy.failedGates.join(', ') : 'none'} | ${adequacy.pass ? 'PASS' : 'FAIL'} |`);
    }
  }
  lines.push('');
  lines.push(`All-segment adequacy gate: **${results.decisions.dataAdequacy.allDevelopmentAndFinalSegmentsPass ? 'PASS' : 'FAIL'}**. ${results.decisions.dataAdequacy.conclusion}`);
  lines.push('');
  lines.push('## Development candidate ledger — return');
  lines.push('');
  lines.push('| # | Candidate | Positive tabs | Worst improvement | Equal-tab mean | Valid |');
  lines.push('|---:|---|---:|---:|---:|---|');
  for (const entry of results.development.return) {
    lines.push(`| ${entry.candidate.declarationOrder + 1} | ${entry.candidate.id} | ${entry.positiveMarketCount == null ? '—' : entry.positiveMarketCount} | ${percent(entry.worstMarketImprovement)} | ${percent(entry.equalMarketMeanImprovement)} | ${entry.validAllMarkets ? 'yes' : 'no'} |`);
  }
  lines.push('');
  lines.push(`Selected return candidate: **${results.selections.returnCandidateId || 'none'}**. Development gate: **${results.decisions.return.developmentGate.pass ? 'PASS' : 'FAIL'}**.`);
  lines.push('');
  lines.push('## Final quasi-holdout — return');
  lines.push('');
  lines.push('| Tab | MSE improvement | NW mean loss improvement | one-sided p | BH5 q | Dev dominant sign | Final dominant sign | Pass |');
  lines.push('|---|---:|---:|---:|---:|---|---|---|');
  for (const spec of MARKET_SPECS) {
    const result = results.final.return.markets[spec.key];
    const walk = result && result.walkForward;
    const nw = result && result.neweyWestPairedLossImprovement;
    const development = results.development.return.find(entry => entry.candidate.id === results.selections.returnCandidateId);
    const developmentSigns = development && development.markets[spec.key] && development.markets[spec.key].scoreCoefficientSigns;
    const finalSigns = walk && walk.scoreCoefficientSigns;
    lines.push(`| ${spec.name} | ${percent(walk && walk.relativeMseImprovementVsControls)} | ${number(nw && nw.mean, 8)} | ${number(nw && nw.pValueOneSidedPositive)} | ${number(result && result.bh5QValue)} | ${developmentSigns && developmentSigns.dominantSign || '—'} | ${finalSigns && finalSigns.dominantSign || '—'} | ${result && result.pass ? 'PASS' : 'FAIL'} |`);
  }
  lines.push('');
  lines.push(`Shared return gate: **${results.decisions.return.sharedHistoricalGatePass ? 'PASS' : 'FAIL'}**.`);
  lines.push('');
  lines.push('## Development candidate ledger — future risk');
  lines.push('');
  lines.push('| # | Candidate | Positive tabs | Worst improvement | Equal-tab mean | Valid |');
  lines.push('|---:|---|---:|---:|---:|---|');
  for (const entry of results.development.futureRisk) {
    lines.push(`| ${entry.candidate.declarationOrder + 1} | ${entry.candidate.id} | ${entry.positiveMarketCount == null ? '—' : entry.positiveMarketCount} | ${percent(entry.worstMarketImprovement)} | ${percent(entry.equalMarketMeanImprovement)} | ${entry.validAllMarkets ? 'yes' : 'no'} |`);
  }
  lines.push('');
  lines.push(`Selected future-risk candidate: **${results.selections.futureRiskCandidateId || 'none'}**. Development gate: **${results.decisions.futureRisk.developmentGate.pass ? 'PASS' : 'FAIL'}**.`);
  lines.push('');
  lines.push('## Final quasi-holdout — future risk');
  lines.push('');
  lines.push('| Tab | MSE improvement | one-sided p | BH5 q | Dev negative blocks | Final negative blocks | Pass |');
  lines.push('|---|---:|---:|---:|---:|---:|---|');
  for (const spec of MARKET_SPECS) {
    const result = results.final.futureRisk.markets[spec.key];
    const walk = result && result.walkForward;
    const development = results.development.futureRisk.find(entry => entry.candidate.id === results.selections.futureRiskCandidateId);
    const developmentSigns = development && development.markets[spec.key] && development.markets[spec.key].scoreCoefficientSigns;
    const finalSigns = walk && walk.scoreCoefficientSigns;
    lines.push(`| ${spec.name} | ${percent(walk && walk.relativeMseImprovementVsControls)} | ${number(result && result.neweyWestPairedLossImprovement && result.neweyWestPairedLossImprovement.pValueOneSidedPositive)} | ${number(result && result.bh5QValue)} | ${percent(developmentSigns && developmentSigns.negativeFraction)} | ${percent(finalSigns && finalSigns.negativeFraction)} | ${result && result.pass ? 'PASS' : 'FAIL'} |`);
  }
  lines.push('');
  lines.push(results.decisions.futureRisk.conclusion);
  lines.push('');
  lines.push('## Data identity and limitations');
  lines.push('');
  lines.push(`- Input snapshot SHA-256: \`${results.inputSnapshotSha256}\`.`);
  lines.push(`- Analysis fingerprint: \`${results.analysisFingerprintSha256}\`.`);
  lines.push('- Crypto benchmark/target is Coin Metrics `CMBITM`; the benchmark also supplies the realised-volatility input; breadth is `CMBITM / BTC-USD`; safe haven is `IEF`; credit is `HYG/LQD`. CMBITM is broad eligible/investable crypto, not every coin. BTC overlaps the breadth numerator and denominator.');
  lines.push('- Crypto controls and future-volatility outcomes use 365-day annualization. The shared component engine retains its fixed `sqrt(252)` raw-volatility scale, but that positive constant cancels in volatility-versus-own-mean and percentile scoring, so it cannot change the component score.');
  lines.push('- CMBITM is estimated-market-cap weighted, rebalanced monthly and reconstituted quarterly. It excludes pegged/on-chain-derivative, illiquid and too-new assets.');
  lines.push('- The returned CMBITM history starts 2019-07-01 and values before its 2022-11-22 launch are provider-backtested. Methodology v1.4 gives a 2019-07-01 first/base date while the product webpage gives 2019-04-01; this report uses the returned observations rather than resolving that documentation discrepancy.');
  lines.push('- `indexes.coinmetrics.io` is an undocumented web endpoint for this use. This output is local research only until licensing and redistribution permission are explicit.');
  lines.push('- Sweden and Europe targets are non-investable indices. USA and Global use ETF proxies. CMBITM investability and replication costs are not tested.');
  lines.push('- Current Yahoo histories are not point-in-time vintages. Corrections and adjusted-history changes cannot be ruled out.');
  lines.push('- No trading costs, spreads, slippage, tax, cash yield, tracking error, custody, or execution constraints are included in these forecast-loss tests.');
  lines.push('- A risk-selected candidate is evidence about future volatility only; it is never reported as a return predictor.');
  return lines.join('\n');
}

function writeResults(results, outputRoot, stamp = runStamp()) {
  const directory = path.join(outputRoot, 'results');
  fs.mkdirSync(directory, { recursive: true });
  const jsonFile = path.join(directory, `fear-greed-model-search-results-${stamp}.json`);
  const reportFile = path.join(directory, `fear-greed-model-search-report-${stamp}.md`);
  const jsonBytes = Buffer.from(canonicalJson(results), 'utf8');
  const reportBytes = Buffer.from(`${markdownReport(results)}\n`, 'utf8');
  fs.writeFileSync(jsonFile, jsonBytes, { flag: 'wx' });
  fs.writeFileSync(reportFile, reportBytes, { flag: 'wx' });
  const jsonSha256 = sha256Buffer(jsonBytes);
  const reportSha256 = sha256Buffer(reportBytes);
  const jsonChecksumFile = writeChecksum(jsonFile, jsonSha256);
  const reportChecksumFile = writeChecksum(reportFile, reportSha256);
  return { jsonFile, reportFile, jsonChecksumFile, reportChecksumFile, jsonSha256, reportSha256 };
}

async function runStudy(args, options = {}) {
  const stamp = options.stamp || runStamp(options.now ? options.now() : new Date());
  let inputInfo;
  let execution;
  if (args.snapshot) {
    inputInfo = readSnapshot(args.snapshot);
    execution = { mode: 'saved-snapshot-replay', networkUsed: false, executedAt: new Date().toISOString(), nodeVersion: process.version };
  } else {
    const snapshot = await collectLiveSnapshot();
    inputInfo = writeSnapshot(snapshot, args.outDir, stamp);
    execution = { mode: 'live-fetch-freeze-and-search', networkUsed: true, executedAt: new Date().toISOString(), nodeVersion: process.version };
  }
  const currentRunnerSha256 = sha256File(__filename);
  const currentProtocolSha256 = sha256File(PROTOCOL_PATH);
  execution.currentRunnerSha256 = currentRunnerSha256;
  execution.snapshotRunnerSha256 = inputInfo.snapshot.sourceCode && inputInfo.snapshot.sourceCode.runnerSha256;
  execution.runnerMatchesFrozenSnapshot = execution.currentRunnerSha256 === execution.snapshotRunnerSha256;
  execution.currentProtocolSha256 = currentProtocolSha256;
  execution.snapshotProtocolSha256 = inputInfo.snapshot.sourceCode && inputInfo.snapshot.sourceCode.protocolSha256;
  execution.protocolMatchesFrozenSnapshot = execution.currentProtocolSha256 === execution.snapshotProtocolSha256;
  execution.currentMarketfgSha256 = sha256File(MARKET_FG_PATH);
  execution.snapshotMarketfgSha256 = inputInfo.snapshot.sourceCode && inputInfo.snapshot.sourceCode.marketfgSha256;
  execution.marketfgMatchesFrozenSnapshot = execution.currentMarketfgSha256 === execution.snapshotMarketfgSha256;
  execution.currentConfigSha256 = sha256File(CONFIG_PATH);
  execution.snapshotConfigSha256 = inputInfo.snapshot.sourceCode && inputInfo.snapshot.sourceCode.configSha256;
  execution.configMatchesFrozenSnapshot = execution.currentConfigSha256 === execution.snapshotConfigSha256;
  if (!execution.runnerMatchesFrozenSnapshot || !execution.protocolMatchesFrozenSnapshot ||
      !execution.marketfgMatchesFrozenSnapshot || !execution.configMatchesFrozenSnapshot) {
    throw new Error('current marketfg/config/runner/protocol differs from the frozen schema-4 snapshot; refusing a non-identical replay');
  }
  const results = analyzeSnapshot(inputInfo.snapshot, inputInfo, { execution });
  const outputs = writeResults(results, args.outDir, stamp);
  return { inputInfo, results, outputs, execution };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const completed = await runStudy(args);
  console.log(JSON.stringify({
    status: completed.results.status,
    execution: completed.execution,
    input: {
      path: completed.inputInfo.file,
      sha256: completed.inputInfo.sha256,
      checksumVerified: completed.inputInfo.checksumVerified,
    },
    outputs: completed.outputs,
    selections: completed.results.selections,
    decisions: completed.results.decisions,
    analysisFingerprintSha256: completed.results.analysisFingerprintSha256,
  }, null, 2));
}

module.exports = {
  SCHEMA_VERSION,
  COMPONENT_KEYS,
  CONTROL_FEATURES,
  TARGETS,
  DATA_ADEQUACY_MINIMUMS,
  MARKET_SPECS,
  EXPERIMENTAL_CRYPTO_MAPPING,
  CMBITM_PARSER_CONTRACT,
  WEIGHT_TEMPLATES,
  SMOOTHING_WINDOWS,
  FROZEN_DESIGN,
  buildCandidates,
  canonicalize,
  canonicalJson,
  sha256Buffer,
  normalizedSeriesInventory,
  validateSnapshot,
  writeSnapshot,
  readSnapshot,
  computeCandidateSeries,
  computeControls,
  buildCommonObservations,
  splitCommonRows,
  assessSegmentAdequacy,
  availableTrainingRows,
  solveLinear,
  fitOls,
  walkForwardForecast,
  coefficientSignSummary,
  selectCandidate,
  neweyWestMeanTest,
  benjaminiHochberg,
  fingerprintAnalysis,
  analyzeSnapshot,
  markdownReport,
  writeResults,
  runStudy,
  parseArgs,
  main,
};

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  });
}
