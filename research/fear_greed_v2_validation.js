'use strict';

// Schema 5 audits the exact production v2 score on reused history. It is
// intentionally incapable of returning a historical validation/reliability pass.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const marketfg = require('../marketfg');
const math = require('./fear_greed_model_search');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'data', 'config.json');
const MARKETFG_PATH = path.join(ROOT, 'marketfg.js');
const SCHEMA4_MATH_PATH = path.join(__dirname, 'fear_greed_model_search.js');
const PROTOCOL_PATH = path.join(__dirname, 'FEAR_GREED_V2_VALIDATION_PROTOCOL.md');
const DEFAULT_ARTIFACT_ROOT = path.join(__dirname, 'local-artifacts', 'v2-validation');
const DEFAULT_GATE_DIRECTORY = path.join(__dirname, 'local-artifacts', '.schema5-v2-validation-gate');
const DEFAULT_LIVE_LOCK_PATH = path.join(DEFAULT_GATE_DIRECTORY, 'live-collection.lock');
const DEFAULT_LIVE_RECEIPT_PATH = path.join(DEFAULT_GATE_DIRECTORY, 'successful-live-collection-receipt.json');

const SCHEMA_VERSION = 5;
const STATUS = 'RETROSPECTIVE_DEVELOPMENT_ONLY_NO_CONFIRMATORY_OUTCOME';
const REQUIRED_COMPONENTS = 6;
const INITIAL_SEED_OBSERVATIONS = 252;
const REFIT_OBSERVATIONS = 21;
const PRIMARY_HORIZON = 21;
const MAXIMUM_CANDIDATES = 15;
const USER_AGENT = 'InvestmentsFearGreedV2Validation/1.0 (+local reproducible research)';
const YAHOO_ENDPOINT_TEMPLATE = 'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}';
const YAHOO_PARTIAL_BAR_POLICY = 'research completed-bar wrapper: exclude each source retrieval-exchange-local date and all later rows before synthetic construction and the unchanged production engine';
const YAHOO_ADJUSTMENT_POLICY = 'whole Yahoo adjusted-close history when complete; otherwise whole raw-close history; never mix adjustment modes within a source';
const DRAFT_PROTOCOL_MARKER = 'DRAFT_NOT_FROZEN';
const REQUIRED_FROZEN_PROTOCOL_MARKER = 'FROZEN_SCHEMA5_V2_VALIDATION_V1';
const REQUIRED_FROZEN_MODE = 'rankChallengers=true';
const SYNTHETIC_TEST_RUNTIME = Symbol('schema5-synthetic-test-runtime');

const COMPONENT_KEYS = Object.freeze(math.COMPONENT_KEYS.slice());
const CONTROL_FEATURES = Object.freeze(math.CONTROL_FEATURES.slice());
const DATA_ADEQUACY_MINIMUMS = Object.freeze({ ...math.DATA_ADEQUACY_MINIMUMS });
const OUTCOMES = Object.freeze({ return: 'forwardReturn', risk: 'futureLogVol' });
const MODEL_CONTRACT = Object.freeze({
  id: 'investments-unified-fear-greed',
  version: 2,
  range: 'max',
  window: 252,
  minWindowPoints: 126,
  minComponents: 6,
  fillDays: 7,
});

const CRYPTO_CONSTITUENTS = Object.freeze([
  'BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'ADA-USD', 'DOGE-USD', 'BNB-USD',
]);
const CRYPTO_TARGET_SPEC = Object.freeze({
  id: 'CRYPTO-BROAD-EW',
  name: 'Broad crypto equal-weight basket',
  method: 'equalWeightReturns',
  currency: 'USD',
  timezone: 'UTC',
  symbols: CRYPTO_CONSTITUENTS,
});
const FROZEN_MARKET_SYMBOLS = Object.freeze({
  crypto: Object.freeze({
    index: CRYPTO_TARGET_SPEC,
    vol: null,
    bond: 'IEF',
    hy: 'HYG',
    ig: 'LQD',
    small: Object.freeze({
      id: 'CRYPTO-NONCORE-EW', name: 'Non-core crypto equal-weight basket', method: 'equalWeightReturns',
      currency: 'USD', timezone: 'UTC', symbols: Object.freeze(['SOL-USD', 'XRP-USD', 'ADA-USD', 'DOGE-USD', 'BNB-USD']),
    }),
    large: Object.freeze({
      id: 'CRYPTO-CORE-EW', name: 'BTC and ETH equal-weight core basket', method: 'equalWeightReturns',
      currency: 'USD', timezone: 'UTC', symbols: Object.freeze(['BTC-USD', 'ETH-USD']),
    }),
  }),
  sweden: Object.freeze({ index: '^OMXSBGI', vol: null, bond: 'XACT-OBLIGATION.ST', hy: '0P0001C87Y.ST', ig: '0P00000KIW.ST', small: 'XACT-SMABOLAG.ST', large: 'XACT-SVERIGE.ST' }),
  usa: Object.freeze({ index: 'SPY', vol: '^VIX', bond: 'IEF', hy: 'HYG', ig: 'LQD', small: 'IWM', large: null }),
  europe: Object.freeze({ index: '^STOXX', vol: null, bond: 'SXRQ.DE', hy: 'IHYG.L', ig: 'IEAC.L', small: 'EXSE.DE', large: 'EXSA.DE' }),
  global: Object.freeze({ index: 'ACWI', vol: '^VIX', bond: 'IEF', hy: 'HYLD.L', ig: 'CORP.L', small: 'WSML.L', large: 'IWDA.L' }),
});
const MARKET_SPECS = Object.freeze([
  Object.freeze({ key: 'crypto', name: 'Crypto', targetId: 'CRYPTO-BROAD-EW', annualization: 365, targetSpec: FROZEN_MARKET_SYMBOLS.crypto.index, barPolicy: 'completed-utc-date' }),
  Object.freeze({ key: 'sweden', name: 'Sweden', targetId: '^OMXSBGI', annualization: 252, targetSpec: FROZEN_MARKET_SYMBOLS.sweden.index }),
  Object.freeze({ key: 'usa', name: 'USA', targetId: 'SPY', annualization: 252, targetSpec: FROZEN_MARKET_SYMBOLS.usa.index }),
  Object.freeze({ key: 'europe', name: 'Europe', targetId: '^STOXX', annualization: 252, targetSpec: FROZEN_MARKET_SYMBOLS.europe.index }),
  Object.freeze({ key: 'global', name: 'Global', targetId: 'ACWI', annualization: 252, targetSpec: FROZEN_MARKET_SYMBOLS.global.index }),
]);

function frozenDependencySymbols() {
  return [...new Set(Object.values(FROZEN_MARKET_SYMBOLS).flatMap(symbols =>
    Object.values(symbols).flatMap(spec => marketfg.collectSpecSymbols(spec))))].sort();
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object') return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.isFrozen(value) ? value : Object.freeze(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const keys = Object.keys(value);
    const orderedKeys = keys.length === COMPONENT_KEYS.length && COMPONENT_KEYS.every(key => keys.includes(key))
      ? COMPONENT_KEYS
      : keys.sort();
    return Object.fromEntries(orderedKeys.map(key => [key, canonicalize(value[key])]));
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
  const relative = path.relative(ROOT, path.resolve(file));
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative)
    ? relative.replace(/\\/g, '/')
    : path.resolve(file).replace(/\\/g, '/');
}

function assertExact(actual, expected, context) {
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`${context} drifted from the frozen schema-5 design`);
}

function runStamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

function requireIsoTimestamp(value, context) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${context} must be a precise ISO-8601 UTC timestamp`);
  }
  return Date.parse(value);
}

function isIsoDate(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00.000Z`)) && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;
}

function parseProtocolFreezeState(text = fs.readFileSync(PROTOCOL_PATH, 'utf8')) {
  const marker = /<!--\s*SCHEMA5_FREEZE_MARKER:\s*([^\s]+)\s*-->/.exec(text);
  const freezeAt = /<!--\s*SCHEMA5_FREEZE_AT:\s*([^\s]+)\s*-->/.exec(text);
  const mode = /<!--\s*SCHEMA5_FREEZE_MODE:\s*([^\s]+)\s*-->/.exec(text);
  if (!marker || !freezeAt || !mode) throw new Error('protocol freeze gate lines are missing or malformed');
  return {
    marker: marker[1],
    frozenAt: freezeAt[1] === 'NOT_FROZEN' ? null : freezeAt[1],
    mode: mode[1],
  };
}

function assertProtocolFrozen(state) {
  if (!state || state.marker !== REQUIRED_FROZEN_PROTOCOL_MARKER || state.mode !== REQUIRED_FROZEN_MODE || !state.frozenAt) {
    throw new Error(`live schema-5 collection is disabled: protocol marker is ${state && state.marker || 'missing'}, expected ${REQUIRED_FROZEN_PROTOCOL_MARKER}`);
  }
  requireIsoTimestamp(state.frozenAt, 'protocol frozenAt');
  return state;
}

function buildCandidates() {
  const candidates = math.buildCandidates().map(candidate => deepClone(candidate));
  if (candidates.length !== MAXIMUM_CANDIDATES) throw new Error(`frozen family must contain exactly ${MAXIMUM_CANDIDATES} candidates`);
  if (candidates[0].id !== 'equal_s1') throw new Error('production equal_s1 must be first in the frozen family');
  return candidates;
}

const FROZEN_DESIGN = deepFreeze({
  study: 'production-fear-greed-v2-retrospective-development-audit',
  schemaVersion: SCHEMA_VERSION,
  interpretationStatus: STATUS,
  productionCandidateId: 'equal_s1',
  modelContract: MODEL_CONTRACT,
  productionScorePrecision: 'exact published 0.1-point marketfg.js history score',
  candidateMaximumIncludingProduction: MAXIMUM_CANDIDATES,
  candidates: Object.freeze(buildCandidates().map(candidate => Object.freeze(candidate))),
  candidateIds: Object.freeze(buildCandidates().map(candidate => candidate.id)),
  componentOrder: COMPONENT_KEYS,
  candidateCommonWarmupRows: 20,
  outcomes: Object.freeze({
    signal: 'target close t', entry: 'target close t+1', exit: 'target close t+22', horizonBars: PRIMARY_HORIZON,
    primary: OUTCOMES.return, secondary: OUTCOMES.risk,
  }),
  controls: CONTROL_FEATURES,
  split: Object.freeze({
    initialSeedObservations: INITIAL_SEED_OBSERVATIONS,
    development: 'all remaining pre-freeze eligible rows',
    historicalFinalOrHoldout: false,
  }),
  refitEveryForecastObservations: REFIT_OBSERVATIONS,
  trainingAvailability: 'signalIndex < forecast origin and exitIndex <= forecast origin signalIndex',
  rankingRules: Object.freeze([
    'greatest positive-market count',
    'greatest worst-market relative MSE improvement',
    'greatest equal-market mean relative MSE improvement',
    'lowest frozen declaration order',
  ]),
  nominationThresholds: Object.freeze({
    positiveImprovementRequiredMarkets: 5,
    equalMarketMeanImprovementMinimum: 0.005,
    commonNonZeroCoefficientSignMinimumFractionEveryMarket: 0.70,
  }),
  adequacyReferenceMinimums: DATA_ADEQUACY_MINIMUMS,
  targetIds: Object.freeze(Object.fromEntries(MARKET_SPECS.map(spec => [spec.key, spec.targetId]))),
  annualizations: Object.freeze(Object.fromEntries(MARKET_SPECS.map(spec => [spec.key, spec.annualization]))),
  marketSymbols: FROZEN_MARKET_SYMBOLS,
  dependencySymbols: Object.freeze(frozenDependencySymbols()),
  researchCompletedBarWrapper: Object.freeze({
    appliesToAllYahooSources: true,
    partialBarPolicy: YAHOO_PARTIAL_BAR_POLICY,
    adjustmentPolicy: YAHOO_ADJUSTMENT_POLICY,
    effectiveCryptoUtcCutoff: 'UTC calendar date of the collection createdAt timestamp',
  }),
});

function validateModelConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('data/config.json is missing marketFearGreed');
  const actual = {
    id: config.modelId,
    version: Number(config.version),
    range: config.range,
    window: Number(config.window),
    minWindowPoints: Number(config.minWindowPoints),
    minComponents: Number(config.minComponents),
    fillDays: Number(config.fillDays),
  };
  assertExact(actual, MODEL_CONTRACT, 'production model contract');
  const actualKeys = Object.keys(config.markets || {}).sort();
  const expectedKeys = MARKET_SPECS.map(spec => spec.key).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) throw new Error(`production market set drifted: ${actualKeys.join(', ') || 'missing'}`);
  for (const spec of MARKET_SPECS) {
    const configuredMarket = config.markets[spec.key];
    assertExact(configuredMarket && configuredMarket.symbols, FROZEN_MARKET_SYMBOLS[spec.key], `${spec.key} complete production symbols`);
    if (spec.barPolicy && configuredMarket.barPolicy !== spec.barPolicy) throw new Error(`${spec.key} bar policy drifted from ${spec.barPolicy}`);
  }
  return config;
}

function resolveProductionTarget(spec, sourceMap) {
  const target = marketfg.resolveSeriesSpec(spec.targetSpec, sourceMap);
  if (!target) throw new Error(`${spec.key}: production target ${spec.targetId} could not be constructed`);
  if (target.symbol !== spec.targetId) throw new Error(`${spec.key}: resolved target ${target.symbol} differs from ${spec.targetId}`);
  if (spec.key === 'crypto') {
    if (target.construction !== 'daily-rebalanced arithmetic equal-weight return index') throw new Error('Crypto target used a different construction adapter');
    assertExact(target.sourceSymbols, CRYPTO_CONSTITUENTS, 'Crypto target constituents');
  }
  return target;
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function validateYahooRequestIdentity(sourceUrl, symbol, fetchedAt) {
  let parsed;
  try { parsed = new URL(sourceUrl); } catch { throw new Error(`Yahoo source URL is invalid (${symbol})`); }
  if (parsed.protocol !== 'https:' || !['query1.finance.yahoo.com', 'query2.finance.yahoo.com'].includes(parsed.hostname)) {
    throw new Error(`Yahoo source host is not frozen query1/query2 HTTPS (${symbol})`);
  }
  const expectedPath = `/v8/finance/chart/${encodeURIComponent(symbol)}`;
  if (parsed.pathname.toUpperCase() !== expectedPath.toUpperCase()) throw new Error(`Yahoo chart URL symbol/path mismatch (${symbol})`);
  const expectedPeriod2 = String(Math.floor(requireIsoTimestamp(fetchedAt, `${symbol} fetchedAt`) / 1000) + 86400);
  const keys = [...parsed.searchParams.keys()].sort();
  if (keys.join('|') !== ['events', 'interval', 'period1', 'period2'].join('|') ||
      parsed.searchParams.get('period1') !== '0' || parsed.searchParams.get('period2') !== expectedPeriod2 ||
      parsed.searchParams.get('interval') !== '1d' || parsed.searchParams.get('events') !== 'div,splits') {
    throw new Error(`Yahoo chart query differs from frozen max-daily request (${symbol})`);
  }
  return parsed;
}

function normalizeYahooPayload(rawPayload, { symbol, fetchedAt, sourceUrl }) {
  requireIsoTimestamp(fetchedAt, `${symbol} fetchedAt`);
  validateYahooRequestIdentity(sourceUrl, symbol, fetchedAt);
  const rawBytes = Buffer.isBuffer(rawPayload) ? rawPayload : Buffer.from(String(rawPayload), 'utf8');
  let json = null;
  try { json = JSON.parse(rawBytes.toString('utf8')); } catch { throw new Error(`Yahoo payload is not JSON (${symbol})`); }
  const result = json && json.chart && json.chart.result && json.chart.result[0];
  if (!result) throw new Error(`Yahoo returned no chart result (${symbol})`);
  const meta = result.meta || {};
  if (meta.symbol !== symbol) throw new Error(`Yahoo payload meta.symbol differs from requested symbol (${symbol})`);
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
    const timestamp = Number(timestamps[index]);
    if (!Number.isFinite(timestamp)) throw new Error(`Yahoo contains an invalid timestamp (${symbol})`);
    const date = new Date(timestamp * 1000).toLocaleDateString('sv-SE', { timeZone: timezone });
    if (date >= retrievalLocalDate) { excludedCurrentOrFutureRows++; continue; }
    byDate.set(date, { date, close });
  }
  const rows = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  if (rows.length < 200) throw new Error(`Yahoo returned too little completed history (${symbol}: ${rows.length})`);
  return {
    symbol,
    name: String(meta.longName || meta.shortName || symbol).replace(/\s+/g, ' ').trim(),
    currency: meta.currency || null,
    tz: timezone,
    timezone,
    adjusted,
    adjustmentMode: adjusted ? 'Yahoo adjusted close for the whole series' : 'Yahoo close; no complete adjusted-close series supplied',
    sourceUrl,
    fetchedAt,
    rawResponsePayloadBase64: rawBytes.toString('base64'),
    rawResponseSha256: sha256Buffer(rawBytes),
    rawResponseBytes: rawBytes.length,
    rawTimestampCount: timestamps.length,
    completedRowCount: rows.length,
    retrievalLocalDate,
    excludedCurrentOrFutureRows,
    firstDate: rows[0].date,
    lastDate: rows.at(-1).date,
    intraday: false,
    normalizedRowsSha256: normalizedRowsSha256(rows),
    rows,
  };
}

async function fetchYahooSeries(symbol, fetchedAt, attempts = 3) {
  const fetchedAtMs = Date.parse(fetchedAt);
  if (!Number.isFinite(fetchedAtMs)) throw new Error(`invalid fetch time: ${fetchedAt}`);
  const period2 = Math.floor(fetchedAtMs / 1000) + 86400;
  const query = `period1=0&period2=${period2}&interval=1d&events=div%2Csplits`;
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const host = hosts[attempt % hosts.length];
    const sourceUrl = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`;
    try {
      const response = await fetch(sourceUrl, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(30000),
      });
      const text = await response.text();
      let json = null;
      try { json = JSON.parse(text); } catch { /* rejected below */ }
      if (!response.ok) {
        const detail = json && json.chart && json.chart.error && json.chart.error.description;
        throw new Error(`Yahoo ${response.status}${detail ? ` (${detail})` : ''} (${symbol})`);
      }
      return normalizeYahooPayload(text, { symbol, fetchedAt, sourceUrl });
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await sleep(500 * (2 ** attempt));
    }
  }
  throw lastError || new Error(`Yahoo fetch failed (${symbol})`);
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

function normalizedRowsSha256(rows) {
  return sha256Buffer(Buffer.from(canonicalJson(rows.map(row => ({ date: row.date, close: row.close }))), 'utf8'));
}

function rawSeriesInventory(seriesMap) {
  return [...seriesMap.values()].sort((left, right) => left.symbol.localeCompare(right.symbol)).map(series => ({
    symbol: series.symbol,
    name: series.name,
    currency: series.currency || null,
    sourceUrl: series.sourceUrl,
    tz: series.tz || series.timezone || null,
    timezone: series.timezone || series.tz || null,
    adjusted: !!series.adjusted,
    adjustmentMode: series.adjustmentMode || null,
    fetchedAt: series.fetchedAt || null,
    rawResponsePayloadBase64: series.rawResponsePayloadBase64,
    rawResponseSha256: series.rawResponseSha256,
    rawResponseBytes: series.rawResponseBytes,
    rawTimestampCount: series.rawTimestampCount,
    completedRowCount: series.rows.length,
    excludedCurrentOrFutureRows: series.excludedCurrentOrFutureRows,
    retrievalLocalDate: series.retrievalLocalDate,
    firstDate: series.rows[0].date,
    lastDate: series.rows.at(-1).date,
    intraday: false,
    normalizedRowsSha256: normalizedRowsSha256(series.rows),
    normalizedRows: series.rows.map(row => ({ date: row.date, close: row.close })),
  }));
}

function targetSeriesInventory(markets) {
  return markets.map(market => ({
    market: market.key,
    symbol: market.prices.symbol,
    construction: market.prices.construction || (market.prices.adjusted
      ? 'direct Yahoo completed adjusted-close series'
      : 'direct Yahoo completed raw-close series'),
    sourceSymbols: market.prices.sourceSymbols || [market.prices.symbol],
    rowCount: market.prices.rows.length,
    firstDate: market.prices.rows[0].date,
    lastDate: market.prices.rows.at(-1).date,
    normalizedRowsSha256: normalizedRowsSha256(market.prices.rows),
  }));
}

function productionRoundedScore(components) {
  const scores = COMPONENT_KEYS.map(key => components && components[key] && components[key].score);
  if (scores.some(score => !Number.isFinite(score))) return null;
  return Math.round((scores.reduce((sum, score) => sum + score, 0) / REQUIRED_COMPONENTS) * 10) / 10;
}

function normalizeSignals(source, target, marketKey) {
  const targetDates = new Set(target.rows.map(row => row.date));
  const output = [];
  let previousDate = null;
  for (const row of source.history || []) {
    if (!targetDates.has(row.date)) continue;
    if (!isIsoDate(row.date) || (previousDate && row.date <= previousDate)) throw new Error(`${marketKey}: invalid or unordered signal dates`);
    if (Number(row.n) !== REQUIRED_COMPONENTS) continue;
    if (!Number.isFinite(row.score)) throw new Error(`${marketKey}/${row.date}: missing published score`);
    const publishedScore = Number(row.score);
    if (Math.abs(publishedScore * 10 - Math.round(publishedScore * 10)) > 1e-9) {
      throw new Error(`${marketKey}/${row.date}: published score is not a 0.1-point value`);
    }
    const components = {};
    for (const key of COMPONENT_KEYS) {
      const value = row.parts && row.parts[key];
      if (!value || !Number.isFinite(value.score) || value.score < 0 || value.score > 100 ||
          !Number.isFinite(value.raw) || !isIsoDate(value.asOf) || value.asOf > row.date ||
          (Date.parse(`${row.date}T00:00:00.000Z`) - Date.parse(`${value.asOf}T00:00:00.000Z`)) / 86400000 > MODEL_CONTRACT.fillDays) {
        throw new Error(`${marketKey}/${row.date}: invalid or non-causal ${key} component`);
      }
      components[key] = { score: value.score, raw: value.raw, asOf: value.asOf };
    }
    const recomputed = productionRoundedScore(components);
    if (recomputed !== publishedScore) throw new Error(`${marketKey}/${row.date}: published score ${publishedScore} differs from rounded exact-six mean ${recomputed}`);
    output.push({ date: row.date, publishedScore, componentCount: REQUIRED_COMPONENTS, components });
    previousDate = row.date;
  }
  if (output.length < INITIAL_SEED_OBSERVATIONS + PRIMARY_HORIZON + 30) {
    throw new Error(`${marketKey}: too little strict all-six-component history (${output.length})`);
  }
  return output;
}

function marketSourceMapAtFrozenCutoff(spec, rawSeries, effectiveCryptoUtcCutoff) {
  if (spec.key !== 'crypto') return rawSeries;
  if (!isIsoDate(effectiveCryptoUtcCutoff)) throw new Error('Crypto effective UTC cutoff is invalid');
  if (new Date().toISOString().slice(0, 10) < effectiveCryptoUtcCutoff) throw new Error('strict replay runtime UTC date predates the frozen Crypto cutoff');
  const trimmed = new Map();
  for (const [symbol, series] of rawSeries) {
    const completed = marketfg.beforeUtcDate(series, effectiveCryptoUtcCutoff);
    if (!completed) throw new Error(`Crypto frozen UTC cutoff removes every row for ${symbol}`);
    if (completed.rows.some(row => row.date >= effectiveCryptoUtcCutoff)) throw new Error(`Crypto source ${symbol} exceeds frozen UTC cutoff`);
    trimmed.set(symbol, completed);
  }
  return trimmed;
}

function reconstructFrozenMarket(spec, rawSeries, effectiveCryptoUtcCutoff, productionConfig = null) {
  const config = productionConfig || validateModelConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).marketFearGreed);
  const sourceMap = marketSourceMapAtFrozenCutoff(spec, rawSeries, effectiveCryptoUtcCutoff);
  const target = resolveProductionTarget(spec, sourceMap);
  const computed = marketfg.computeMarket(spec.key, config.markets[spec.key], sourceMap, {
    window: MODEL_CONTRACT.window,
    minWindowPoints: MODEL_CONTRACT.minWindowPoints,
    minComponents: MODEL_CONTRACT.minComponents,
    fillDays: MODEL_CONTRACT.fillDays,
    historyPoints: 100000,
    includeHistoryParts: true,
  });
  if (computed.indexSymbol !== spec.targetId) throw new Error(`${spec.key}: reconstructed production index identity drifted`);
  return {
    target,
    mapping: deepClone(computed.mapping),
    signals: normalizeSignals(computed, target, spec.key),
  };
}

function reconstructFrozenSignals(spec, rawSeries, effectiveCryptoUtcCutoff, productionConfig = null) {
  return reconstructFrozenMarket(spec, rawSeries, effectiveCryptoUtcCutoff, productionConfig).signals;
}

async function collectLiveSnapshot(options = {}) {
  const createdAt = options.createdAt || new Date().toISOString();
  const rankChallengers = options.rankChallengers === true;
  const protocolState = assertProtocolFrozen(options.protocolState || parseProtocolFreezeState());
  const createdAtMilliseconds = requireIsoTimestamp(createdAt, 'collection createdAt');
  if (createdAtMilliseconds < requireIsoTimestamp(protocolState.frozenAt, 'protocol frozenAt')) throw new Error('collection createdAt precedes protocol freeze');
  const configBytes = fs.readFileSync(CONFIG_PATH);
  const rootConfig = JSON.parse(configBytes.toString('utf8'));
  if (rootConfig.cryptoFearGreed) throw new Error('retired separate cryptoFearGreed configuration is present');
  const productionConfig = validateModelConfig(rootConfig.marketFearGreed);
  const symbols = [...new Set(Object.values(productionConfig.markets).flatMap(market =>
    Object.values(market.symbols || {}).flatMap(spec => marketfg.collectSpecSymbols(spec))))].sort();
  assertExact(symbols, frozenDependencySymbols(), 'configured dependency symbols');
  const series = await mapLimit(symbols, 3, symbol => fetchYahooSeries(symbol, createdAt));
  const rawSeries = new Map(series.map(item => [item.symbol, item]));
  const markets = [];
  for (const spec of MARKET_SPECS) {
    const marketConfig = productionConfig.markets[spec.key];
    const marketRawSeries = marketSourceMapAtFrozenCutoff(spec, rawSeries, createdAt.slice(0, 10));
    const target = resolveProductionTarget(spec, marketRawSeries);
    const computed = marketfg.computeMarket(spec.key, marketConfig, marketRawSeries, {
      window: MODEL_CONTRACT.window,
      minWindowPoints: MODEL_CONTRACT.minWindowPoints,
      minComponents: MODEL_CONTRACT.minComponents,
      fillDays: MODEL_CONTRACT.fillDays,
      historyPoints: 100000,
      includeHistoryParts: true,
    });
    if (computed.indexSymbol !== spec.targetId) throw new Error(`${spec.key}: computed production index identity drifted`);
    markets.push({
      key: spec.key,
      name: spec.name,
      targetId: spec.targetId,
      targetSpec: deepClone(spec.targetSpec),
      annualization: spec.annualization,
      requiredComponents: REQUIRED_COMPONENTS,
      productionMapping: deepClone(computed.mapping),
      signals: normalizeSignals(computed, target, spec.key),
      prices: {
        symbol: target.symbol,
        name: target.name,
        currency: target.currency || null,
        timezone: target.tz || null,
        adjusted: !!target.adjusted,
        fetchedAt: target.fetchedAt || createdAt,
        construction: target.construction || (target.adjusted ? 'direct Yahoo completed adjusted-close series' : 'direct Yahoo completed raw-close series'),
        sourceSymbols: target.sourceSymbols || [target.symbol],
        rows: target.rows.map(row => ({ date: row.date, close: row.close })),
      },
    });
  }
  const sourceCode = {
    nodeVersion: process.version,
    platform: `${process.platform}-${process.arch}`,
    marketfgPath: portablePath(MARKETFG_PATH), marketfgSha256: sha256File(MARKETFG_PATH),
    configPath: portablePath(CONFIG_PATH), configSha256: sha256Buffer(configBytes),
    runnerPath: portablePath(__filename), runnerSha256: sha256File(__filename),
    protocolPath: portablePath(PROTOCOL_PATH), protocolSha256: sha256File(PROTOCOL_PATH),
    schema4MathPath: portablePath(SCHEMA4_MATH_PATH), schema4MathSha256: sha256File(SCHEMA4_MATH_PATH),
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    createdAt,
    freezeAt: protocolState.frozenAt,
    protocolFreeze: deepClone(protocolState),
    status: STATUS,
    purpose: 'Frozen exact production v2 retrospective prequential development inputs; never a confirmatory outcome',
    frozenDesign: deepClone(FROZEN_DESIGN),
    analysisPlan: { rankChallengers },
    sourceCode,
    sources: {
      yahoo: {
        endpointTemplate: YAHOO_ENDPOINT_TEMPLATE,
        fetchedAt: createdAt,
        effectiveCryptoUtcCutoff: createdAt.slice(0, 10),
        partialBarPolicy: YAHOO_PARTIAL_BAR_POLICY,
        adjustmentPolicy: YAHOO_ADJUSTMENT_POLICY,
        normalizedSeriesInventory: rawSeriesInventory(rawSeries),
      },
      targets: {
        identity: 'exact configured production targets; synthetic indices use marketfg.equalWeightReturnSeries strict common dates',
        normalizedSeriesInventory: targetSeriesInventory(markets),
      },
    },
    assumptions: {
      historyStatus: 'all pre-freeze history is reused retrospective development data; there is no historical final/holdout',
      cryptoTarget: 'fixed August 2026 seven-asset daily-rebalanced equal-weight analytical backcast; not all coins, not point-in-time membership, and subject to survivorship/selection bias',
      providerVintage: 'downloaded current Yahoo history can contain provider revisions and is not a point-in-time vintage',
      outcomeTiming: 'score on target t, hypothetical entry close t+1, exit close t+22; incomplete outcomes excluded',
    },
    markets,
  };
}

function currentSourceHashes() {
  return {
    marketfgSha256: sha256File(MARKETFG_PATH),
    configSha256: sha256File(CONFIG_PATH),
    runnerSha256: sha256File(__filename),
    protocolSha256: sha256File(PROTOCOL_PATH),
    schema4MathSha256: sha256File(SCHEMA4_MATH_PATH),
  };
}

function validateOrderedPrices(rows, context) {
  if (!Array.isArray(rows) || rows.length < 200) throw new Error(`${context}: insufficient prices`);
  let prior = null;
  for (const row of rows) {
    if (!isIsoDate(row.date) || (prior && row.date <= prior) || !Number.isFinite(row.close) || row.close <= 0) {
      throw new Error(`${context}: invalid or unordered prices`);
    }
    prior = row.date;
  }
}

function validateInventory(snapshot) {
  const rawInventory = snapshot.sources && snapshot.sources.yahoo && snapshot.sources.yahoo.normalizedSeriesInventory;
  const targetInventory = snapshot.sources && snapshot.sources.targets && snapshot.sources.targets.normalizedSeriesInventory;
  if (!Array.isArray(rawInventory) || !Array.isArray(targetInventory) || targetInventory.length !== MARKET_SPECS.length) {
    throw new Error('schema-5 source inventories are missing');
  }
  const actualSymbols = rawInventory.map(entry => entry && entry.symbol);
  if (new Set(actualSymbols).size !== actualSymbols.length) throw new Error('raw-series inventory contains a duplicate symbol');
  assertExact([...actualSymbols].sort(), frozenDependencySymbols(), 'raw-series dependency symbol set');
  const reconstructedRawSeries = new Map();
  for (const entry of rawInventory) {
    if (!entry.symbol || !entry.sourceUrl || !entry.timezone || !entry.adjustmentMode || !entry.fetchedAt ||
        typeof entry.rawResponsePayloadBase64 !== 'string' || !/^[a-f0-9]{64}$/.test(String(entry.rawResponseSha256 || '')) ||
        !Number.isInteger(entry.rawResponseBytes) || entry.rawResponseBytes <= 0 || !Number.isInteger(entry.completedRowCount) ||
        entry.completedRowCount < 2 || !/^[a-f0-9]{64}$/.test(String(entry.normalizedRowsSha256 || '')) || !Array.isArray(entry.normalizedRows)) {
      throw new Error(`raw-series inventory is incomplete (${entry.symbol || 'unknown'})`);
    }
    if (entry.fetchedAt !== snapshot.createdAt) throw new Error(`${entry.symbol}: source fetchedAt differs from collection createdAt`);
    const rawBytes = Buffer.from(entry.rawResponsePayloadBase64, 'base64');
    if (rawBytes.toString('base64') !== entry.rawResponsePayloadBase64) throw new Error(`${entry.symbol}: raw Yahoo payload is not canonical base64`);
    if (rawBytes.length !== entry.rawResponseBytes || sha256Buffer(rawBytes) !== entry.rawResponseSha256) throw new Error(`${entry.symbol}: raw Yahoo payload hash/length mismatch`);
    const normalized = normalizeYahooPayload(rawBytes, { symbol: entry.symbol, fetchedAt: entry.fetchedAt, sourceUrl: entry.sourceUrl });
    const recomputedEntry = rawSeriesInventory(new Map([[entry.symbol, normalized]]))[0];
    assertExact(entry, recomputedEntry, `${entry.symbol} replayed Yahoo normalization`);
    if (entry.lastDate >= entry.retrievalLocalDate) throw new Error(`${entry.symbol}: last normalized date is not strictly before retrieval-local date`);
    reconstructedRawSeries.set(entry.symbol, normalized);
  }
  const actualTargetMarkets = targetInventory.map(entry => entry && entry.market);
  if (new Set(actualTargetMarkets).size !== actualTargetMarkets.length) throw new Error('target inventory contains a duplicate market');
  assertExact([...actualTargetMarkets].sort(), MARKET_SPECS.map(spec => spec.key).sort(), 'target inventory market set');
  for (const spec of MARKET_SPECS) {
    const market = snapshot.markets.find(item => item.key === spec.key);
    const entry = targetInventory.find(item => item.market === spec.key);
    const marketRawSeries = marketSourceMapAtFrozenCutoff(spec, reconstructedRawSeries, snapshot.sources.yahoo.effectiveCryptoUtcCutoff);
    const reconstructed = resolveProductionTarget(spec, marketRawSeries);
    assertExact(reconstructed.rows, market.prices.rows, `${spec.key} target reconstructed from frozen Yahoo payloads`);
    const expectedConstruction = reconstructed.construction || (reconstructed.adjusted ? 'direct Yahoo completed adjusted-close series' : 'direct Yahoo completed raw-close series');
    if (market.prices.construction !== expectedConstruction || market.prices.adjusted !== !!reconstructed.adjusted ||
        market.prices.name !== reconstructed.name || market.prices.currency !== (reconstructed.currency || null) ||
        market.prices.timezone !== (reconstructed.tz || null) || market.prices.fetchedAt !== (reconstructed.fetchedAt || snapshot.createdAt)) {
      throw new Error(`${spec.key}: target adjustment/construction metadata differs from reconstructed source`);
    }
    assertExact(market.prices.sourceSymbols, reconstructed.sourceSymbols || [reconstructed.symbol], `${spec.key} reconstructed target sources`);
    if (!entry || entry.symbol !== spec.targetId || entry.rowCount !== market.prices.rows.length ||
        entry.firstDate !== market.prices.rows[0].date || entry.lastDate !== market.prices.rows.at(-1).date ||
        entry.construction !== expectedConstruction || entry.normalizedRowsSha256 !== normalizedRowsSha256(market.prices.rows)) {
      throw new Error(`${spec.key}: target-series inventory does not lock the normalized prices`);
    }
  }
  assertExact(targetInventory, targetSeriesInventory(snapshot.markets), 'target-series inventory');
  return reconstructedRawSeries;
}

function validateSnapshot(snapshot, options = {}) {
  if (!snapshot || Number(snapshot.schemaVersion) !== SCHEMA_VERSION || !Array.isArray(snapshot.markets)) {
    throw new Error('unsupported or invalid snapshot: this runner accepts schema 5 only');
  }
  if (snapshot.status !== STATUS) throw new Error('snapshot contains an impermissible confirmatory status');
  const protocolState = assertProtocolFrozen(options.protocolState || parseProtocolFreezeState());
  assertExact(snapshot.protocolFreeze, protocolState, 'snapshot protocol freeze identity');
  if (snapshot.freezeAt !== protocolState.frozenAt) throw new Error('snapshot freezeAt differs from frozen protocol timestamp');
  const createdAtMilliseconds = requireIsoTimestamp(snapshot.createdAt, 'snapshot createdAt');
  if (createdAtMilliseconds < requireIsoTimestamp(snapshot.freezeAt, 'snapshot freezeAt')) throw new Error('snapshot createdAt precedes protocol freezeAt');
  assertExact(snapshot.frozenDesign, FROZEN_DESIGN, 'snapshot frozen design');
  if (!snapshot.analysisPlan || snapshot.analysisPlan.rankChallengers !== true) throw new Error('schema-5 frozen plan requires rankChallengers=true');
  const hashes = currentSourceHashes();
  for (const [key, value] of Object.entries(hashes)) {
    if (!snapshot.sourceCode || snapshot.sourceCode[key] !== value) throw new Error(`snapshot ${key} does not match the currently executing frozen source`);
  }
  if (snapshot.sourceCode.nodeVersion !== process.version || snapshot.sourceCode.platform !== `${process.platform}-${process.arch}`) {
    throw new Error('snapshot Node version/platform differs from the strict replay runtime');
  }
  const currentProductionConfig = validateModelConfig(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')).marketFearGreed);
  if (!snapshot.sources || !snapshot.sources.yahoo || snapshot.sources.yahoo.fetchedAt !== snapshot.createdAt ||
      snapshot.sources.yahoo.endpointTemplate !== YAHOO_ENDPOINT_TEMPLATE ||
      snapshot.sources.yahoo.effectiveCryptoUtcCutoff !== snapshot.createdAt.slice(0, 10) ||
      snapshot.sources.yahoo.partialBarPolicy !== YAHOO_PARTIAL_BAR_POLICY || snapshot.sources.yahoo.adjustmentPolicy !== YAHOO_ADJUSTMENT_POLICY) {
    throw new Error('snapshot Yahoo retrieval policy/timestamp drifted');
  }
  const actualKeys = snapshot.markets.map(market => market.key).sort();
  const expectedKeys = MARKET_SPECS.map(spec => spec.key).sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) throw new Error('snapshot does not contain the exact five production tabs');
  for (const spec of MARKET_SPECS) {
    const market = snapshot.markets.find(item => item.key === spec.key);
    if (!market || market.targetId !== spec.targetId || Number(market.annualization) !== spec.annualization || Number(market.requiredComponents) !== REQUIRED_COMPONENTS) {
      throw new Error(`${spec.key}: target, annualization or component count drifted`);
    }
    assertExact(market.targetSpec, spec.targetSpec, `${spec.key} snapshot target specification`);
    assertExact(market.productionMapping, {
      barPolicy: spec.barPolicy || 'exchange-local daily bars',
      symbols: FROZEN_MARKET_SYMBOLS[spec.key],
    }, `${spec.key} complete production mapping`);
    validateOrderedPrices(market.prices && market.prices.rows, `${spec.key} target`);
    if (market.prices.symbol !== spec.targetId) throw new Error(`${spec.key}: target series identity drifted`);
    if (spec.key === 'crypto') {
      if (market.prices.construction !== 'daily-rebalanced arithmetic equal-weight return index') throw new Error('Crypto target construction drifted');
      assertExact(market.prices.sourceSymbols, CRYPTO_CONSTITUENTS, 'Crypto snapshot target constituents');
    }
    if (!Array.isArray(market.signals) || market.signals.length < INITIAL_SEED_OBSERVATIONS + 30) throw new Error(`${spec.key}: insufficient signals`);
    const targetDates = new Set(market.prices.rows.map(row => row.date));
    let prior = null;
    for (const row of market.signals) {
      if (!isIsoDate(row.date) || !targetDates.has(row.date) || (prior && row.date <= prior) || Number(row.componentCount) !== REQUIRED_COMPONENTS ||
          !Number.isFinite(row.publishedScore) || row.publishedScore < 0 || row.publishedScore > 100 ||
          Math.abs(row.publishedScore * 10 - Math.round(row.publishedScore * 10)) > 1e-9) {
        throw new Error(`${spec.key}: invalid signal or non-0.1 production score`);
      }
      if (!row.components || Object.keys(row.components).join('|') !== COMPONENT_KEYS.join('|')) {
        throw new Error(`${spec.key}/${row.date}: component set/order is not the exact production six`);
      }
      for (const key of COMPONENT_KEYS) {
        const value = row.components[key];
        if (!value || !Number.isFinite(value.score) || value.score < 0 || value.score > 100 ||
            !Number.isFinite(value.raw) || !isIsoDate(value.asOf) || value.asOf > row.date ||
            (Date.parse(`${row.date}T00:00:00.000Z`) - Date.parse(`${value.asOf}T00:00:00.000Z`)) / 86400000 > MODEL_CONTRACT.fillDays) {
          throw new Error(`${spec.key}/${row.date}: invalid/non-causal ${key}`);
        }
      }
      const recomputed = productionRoundedScore(row.components);
      if (recomputed !== row.publishedScore) throw new Error(`${spec.key}/${row.date}: published equal_s1 score differs from rounded exact-six mean`);
      prior = row.date;
    }
  }
  const reconstructedRawSeries = validateInventory(snapshot);
  for (const spec of MARKET_SPECS) {
    const market = snapshot.markets.find(item => item.key === spec.key);
    const reconstructed = reconstructFrozenMarket(
      spec,
      reconstructedRawSeries,
      snapshot.sources.yahoo.effectiveCryptoUtcCutoff,
      currentProductionConfig,
    );
    assertExact(market.productionMapping, reconstructed.mapping, `${spec.key} mapping reconstructed by marketfg.computeMarket`);
    assertExact(market.signals, reconstructed.signals, `${spec.key} complete signals reconstructed from frozen Yahoo payloads`);
  }
  return snapshot;
}

function writeChecksum(file, digest) {
  const checksumFile = file.replace(/\.[^.]+$/, '.sha256');
  fs.writeFileSync(checksumFile, `${digest}  ${path.basename(file)}\n`, { encoding: 'utf8', flag: 'wx' });
  return checksumFile;
}

function writeSnapshot(snapshot, outputRoot, stamp = runStamp(), options = {}) {
  validateSnapshot(snapshot, options);
  const directory = path.join(outputRoot, 'inputs');
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, `fear-greed-v2-validation-input-${stamp}.json`);
  const bytes = Buffer.from(canonicalJson(snapshot), 'utf8');
  const sha256 = sha256Buffer(bytes);
  fs.writeFileSync(file, bytes, { flag: 'wx' });
  const checksumFile = writeChecksum(file, sha256);
  return { file, checksumFile, sha256 };
}

function readSnapshot(file, options = {}) {
  const bytes = fs.readFileSync(file);
  const sha256 = sha256Buffer(bytes);
  const checksumFile = file.replace(/\.[^.]+$/, '.sha256');
  if (!fs.existsSync(checksumFile)) throw new Error(`snapshot checksum sidecar is missing: ${checksumFile}`);
  const sidecar = fs.readFileSync(checksumFile, 'utf8').trim().split(/\s+/)[0];
  if (sidecar !== sha256) throw new Error(`snapshot checksum mismatch: expected ${sidecar}, calculated ${sha256}`);
  const snapshot = JSON.parse(bytes.toString('utf8'));
  validateSnapshot(snapshot, options);
  return { snapshot, file: path.resolve(file), checksumFile: path.resolve(checksumFile), sha256, checksumVerified: true };
}

function buildCommonObservations(market, candidates = buildCandidates()) {
  if (!Array.isArray(candidates) || candidates.length !== MAXIMUM_CANDIDATES) throw new Error(`candidate-common rows require exactly ${MAXIMUM_CANDIDATES} frozen candidates`);
  assertExact(candidates, FROZEN_DESIGN.candidates, 'analysis candidate definitions/order');
  const candidateMaps = new Map(candidates.map(candidate => [
    candidate.id,
    new Map(math.computeCandidateSeries(market.signals, candidate).map(row => [row.date, row.score])),
  ]));
  // The published production score is the authoritative equal_s1 input. This
  // intentionally replaces the higher-precision component reconstruction.
  candidateMaps.set('equal_s1', new Map(market.signals.map(row => [row.date, row.publishedScore])));
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
    returnEligible: 0,
    riskEligible: 0,
  };
  const returnRows = [];
  const riskRows = [];
  for (const signal of market.signals) {
    const candidateScores = {};
    let complete = true;
    for (const candidate of candidates) {
      const value = candidateMaps.get(candidate.id).get(signal.date);
      if (!Number.isFinite(value)) { complete = false; break; }
      candidateScores[candidate.id] = value;
    }
    if (!complete) { audit.missingCandidateScore++; continue; }
    const signalIndex = priceIndex.get(signal.date);
    if (signalIndex == null) { audit.missingExactPriceDate++; continue; }
    const controls = math.computeControls(prices, signalIndex, market.annualization);
    if (!controls || CONTROL_FEATURES.some(feature => !Number.isFinite(controls[feature]))) { audit.missingControls++; continue; }
    const entryIndex = signalIndex + 1;
    const exitIndex = entryIndex + PRIMARY_HORIZON;
    if (exitIndex >= prices.length) { audit.incompleteOutcome++; continue; }
    const futureLogReturns = [];
    for (let cursor = entryIndex + 1; cursor <= exitIndex; cursor++) futureLogReturns.push(Math.log(prices[cursor].close / prices[cursor - 1].close));
    const average = futureLogReturns.reduce((sum, value) => sum + value, 0) / futureLogReturns.length;
    const variance = futureLogReturns.reduce((sum, value) => sum + ((value - average) ** 2), 0) / (futureLogReturns.length - 1);
    const futureVolatility = Math.sqrt(variance) * Math.sqrt(market.annualization);
    const returnRow = {
      signalDate: signal.date,
      signalIndex,
      entryIndex,
      exitIndex,
      entryDate: prices[entryIndex].date,
      exitDate: prices[exitIndex].date,
      publishedProductionScore: signal.publishedScore,
      controls,
      candidateScores,
      forwardReturn: prices[exitIndex].close / prices[entryIndex].close - 1,
    };
    returnRows.push(returnRow);
    if (futureVolatility > 0 && Number.isFinite(futureVolatility)) riskRows.push({ ...returnRow, futureLogVol: Math.log(futureVolatility) });
    else audit.zeroFutureVolatility++;
  }
  audit.returnEligible = returnRows.length;
  audit.riskEligible = riskRows.length;
  return { rows: returnRows, returnRows, riskRows, audit };
}

function developmentSplit(rows) {
  if (!Array.isArray(rows) || rows.length <= INITIAL_SEED_OBSERVATIONS) throw new Error(`at least ${INITIAL_SEED_OBSERVATIONS + 1} candidate-common rows are required`);
  return {
    rule: 'first 252 candidate-common rows are fitting seed; every remaining pre-freeze row is retrospective development; no historical final/holdout',
    total: rows.length,
    initial: {
      start: 0, end: INITIAL_SEED_OBSERVATIONS, count: INITIAL_SEED_OBSERVATIONS,
      firstDate: rows[0].signalDate, lastDate: rows[INITIAL_SEED_OBSERVATIONS - 1].signalDate,
    },
    development: {
      start: INITIAL_SEED_OBSERVATIONS, end: rows.length, count: rows.length - INITIAL_SEED_OBSERVATIONS,
      firstDate: rows[INITIAL_SEED_OBSERVATIONS].signalDate, lastDate: rows.at(-1).signalDate,
    },
    final: null,
  };
}

function compactForecast(result) {
  if (!result || !result.ok) return result;
  return {
    ok: true,
    candidateId: result.candidateId,
    outcomeKey: result.outcomeKey,
    segment: result.segment,
    refitEveryForecastObservations: result.refitEveryForecastObservations,
    forecastRows: result.forecastRows,
    mseControls: result.mseControls,
    mseControlsPlusScore: result.mseControlsPlusScore,
    relativeMseImprovementVsControls: result.relativeMseImprovementVsControls,
    scoreCoefficientSigns: math.coefficientSignSummary(result.blocks),
    blocks: result.blocks,
    pairedLossDifferences: result.predictions.map(row => ({ signalDate: row.signalDate, lossDifference: row.lossDifference })),
  };
}

function forecastOne(context, candidateId, outcomeKey) {
  if (!context || !context.available) return { ok: false, candidateId, outcomeKey, reason: context && context.reason || 'analysis context unavailable' };
  return compactForecast(math.walkForwardForecast(context.rows, context.split.development, candidateId, outcomeKey));
}

function analysisContext(rows) {
  if (!Array.isArray(rows) || rows.length <= INITIAL_SEED_OBSERVATIONS) {
    return { available: false, rows: rows || [], split: null, adequacy: null, reason: `only ${rows && rows.length || 0} rows; more than ${INITIAL_SEED_OBSERVATIONS} required` };
  }
  const split = developmentSplit(rows);
  return {
    available: true,
    rows,
    split,
    adequacy: math.assessSegmentAdequacy(rows, split.development, DATA_ADEQUACY_MINIMUMS),
  };
}

function addDescriptiveInference(byMarket) {
  const tests = [];
  for (const spec of MARKET_SPECS) {
    const result = byMarket[spec.key];
    const values = result && result.ok ? result.pairedLossDifferences.map(row => row.lossDifference) : [];
    const nw = math.neweyWestMeanTest(values, PRIMARY_HORIZON);
    if (result) result.descriptiveNeweyWest = nw;
    tests.push({ id: spec.key, pValue: nw.pValueOneSidedPositive });
  }
  const completeFamily = tests.length === MARKET_SPECS.length && tests.every(test => Number.isFinite(test.pValue));
  const adjusted = completeFamily
    ? math.benjaminiHochberg(tests)
    : tests.map(test => ({ ...test, qValue: null }));
  for (const row of adjusted) if (byMarket[row.id]) byMarket[row.id].descriptiveBhQValue = row.qValue;
  return {
    familySize: MARKET_SPECS.length,
    completeFamily,
    reason: completeFamily ? null : 'at least one predeclared tab statistic is unavailable; all five BH q-values are suppressed',
    tests: adjusted,
  };
}

function candidateLedger(contexts, candidates) {
  if (candidates.length > MAXIMUM_CANDIDATES) throw new Error(`candidate search attempted to exceed frozen maximum ${MAXIMUM_CANDIDATES}`);
  return candidates.map(candidate => {
    const markets = {};
    const improvements = [];
    const failures = [];
    for (const spec of MARKET_SPECS) {
      const forecast = forecastOne(contexts[spec.key], candidate.id, OUTCOMES.return);
      markets[spec.key] = forecast;
      if (forecast.ok && Number.isFinite(forecast.relativeMseImprovementVsControls)) improvements.push(forecast.relativeMseImprovementVsControls);
      else failures.push(`${spec.key}: ${forecast.reason || 'invalid forecast'}`);
    }
    const validAllMarkets = failures.length === 0 && improvements.length === MARKET_SPECS.length;
    return {
      candidate,
      validAllMarkets,
      failures,
      positiveMarketCount: validAllMarkets ? improvements.filter(value => value > 0).length : null,
      worstMarketImprovement: validAllMarkets ? Math.min(...improvements) : null,
      equalMarketMeanImprovement: validAllMarkets ? improvements.reduce((sum, value) => sum + value, 0) / improvements.length : null,
      markets,
    };
  });
}

function selectDevelopmentCandidate(ledger) {
  return math.selectCandidate(ledger);
}

function nominationDecision(selected) {
  if (!selected) return { nominated: false, candidateId: null, reason: 'no candidate completed all five development forecasts' };
  const signs = Object.fromEntries(MARKET_SPECS.map(spec => [spec.key, selected.markets[spec.key].scoreCoefficientSigns]));
  const threshold = FROZEN_DESIGN.nominationThresholds.commonNonZeroCoefficientSignMinimumFractionEveryMarket;
  const commonPositive = MARKET_SPECS.every(spec => signs[spec.key].positiveFraction >= threshold);
  const commonNegative = MARKET_SPECS.every(spec => signs[spec.key].negativeFraction >= threshold);
  const gates = {
    positiveImprovementAllFiveMarkets: selected.positiveMarketCount === FROZEN_DESIGN.nominationThresholds.positiveImprovementRequiredMarkets,
    equalMarketMeanImprovementAtLeastHalfPercent: selected.equalMarketMeanImprovement >= FROZEN_DESIGN.nominationThresholds.equalMarketMeanImprovementMinimum,
    commonCoefficientSignAtLeast70PercentEveryMarket: commonPositive || commonNegative,
  };
  return {
    nominated: Object.values(gates).every(Boolean),
    candidateId: selected.candidate.id,
    commonCoefficientSign: commonPositive ? 'positive' : commonNegative ? 'negative' : null,
    gates,
    interpretation: 'retrospective development nomination only; never historical validation or reliability',
  };
}

function fingerprintAnalysis(payload) {
  return sha256Buffer(Buffer.from(canonicalJson(payload), 'utf8'));
}

function analyzeSnapshot(snapshot, inputInfo = {}, options = {}) {
  validateSnapshot(snapshot, options);
  const candidates = buildCandidates();
  const contexts = {};
  for (const spec of MARKET_SPECS) {
    const market = snapshot.markets.find(item => item.key === spec.key);
    const common = buildCommonObservations(market, candidates);
    contexts[spec.key] = {
      audit: common.audit,
      return: analysisContext(common.returnRows),
      futureRisk: analysisContext(common.riskRows),
    };
  }
  const production = { return: {}, futureRisk: {} };
  for (const spec of MARKET_SPECS) {
    production.return[spec.key] = forecastOne(contexts[spec.key].return, 'equal_s1', OUTCOMES.return);
    production.futureRisk[spec.key] = forecastOne(contexts[spec.key].futureRisk, 'equal_s1', OUTCOMES.risk);
  }
  const productionInference = {
    return: addDescriptiveInference(production.return),
    futureRisk: addDescriptiveInference(production.futureRisk),
  };
  let challengers = {
    enabled: false,
    evaluatedCandidates: 0,
    maximumCandidates: MAXIMUM_CANDIDATES,
    ledger: [],
    selectedDevelopmentCandidate: null,
    nomination: { nominated: false, candidateId: null, reason: 'challenger ranking was frozen off for this snapshot' },
  };
  if (snapshot.analysisPlan.rankChallengers) {
    const returnContexts = Object.fromEntries(MARKET_SPECS.map(spec => [spec.key, contexts[spec.key].return]));
    const ledger = candidateLedger(returnContexts, candidates);
    if (ledger.length !== MAXIMUM_CANDIDATES) throw new Error('challenger ledger did not stop at the frozen maximum of 15');
    const selected = selectDevelopmentCandidate(ledger);
    challengers = {
      enabled: true,
      evaluatedCandidates: ledger.length,
      maximumCandidates: MAXIMUM_CANDIDATES,
      ledger,
      selectedDevelopmentCandidate: selected ? selected.candidate.id : null,
      nomination: nominationDecision(selected),
    };
  }
  const adequacy = Object.fromEntries(MARKET_SPECS.map(spec => [spec.key, contexts[spec.key].return.adequacy]));
  const secondaryRiskAdequacy = Object.fromEntries(MARKET_SPECS.map(spec => [spec.key, contexts[spec.key].futureRisk.adequacy]));
  const commonRowAudits = Object.fromEntries(MARKET_SPECS.map(spec => [spec.key, {
    ...contexts[spec.key].audit,
    returnSplit: contexts[spec.key].return.split,
    riskSplit: contexts[spec.key].futureRisk.split,
  }]));
  const fingerprintPayload = {
    schemaVersion: SCHEMA_VERSION,
    status: STATUS,
    inputSnapshotSha256: inputInfo.sha256 || null,
    frozenDesign: snapshot.frozenDesign,
    analysisPlan: snapshot.analysisPlan,
    commonRowAudits,
    adequacy,
    secondaryRiskAdequacy,
    production,
    productionInference,
    challengers,
    confirmatoryOutcomeAvailable: false,
    historicalReliabilityClaimAllowed: false,
  };
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    status: STATUS,
    interpretation: 'All statistics use reused pre-freeze history as retrospective prequential development only.',
    confirmatoryOutcomeAvailable: false,
    historicalFinalOrHoldoutUsed: false,
    historicalReliabilityClaimAllowed: false,
    input: {
      snapshotPath: inputInfo.file || null,
      snapshotSha256: inputInfo.sha256 || null,
      snapshotChecksumVerified: inputInfo.checksumVerified === true,
      freezeAt: snapshot.freezeAt,
    },
    frozenDesign: deepClone(snapshot.frozenDesign),
    analysisPlan: deepClone(snapshot.analysisPlan),
    commonRowAudits,
    adequacy,
    secondaryRiskAdequacy,
    production,
    productionInference,
    challengers,
    conclusion: 'NO_CONFIRMATORY_OUTCOME: these results may reject a design or nominate a prospective version, but cannot show historical validation, reliability, or a trustworthy trading edge.',
    analysisFingerprintSha256: fingerprintAnalysis(fingerprintPayload),
  };
}

function percent(value, digits = 2) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : '—';
}

function markdownReport(results) {
  const lines = [];
  lines.push('# Production Fear & Greed v2 retrospective development audit', '');
  lines.push(`**Status: ${results.status}.**`, '');
  lines.push('This report has no confirmatory historical outcome and makes no reliability claim. All pre-freeze history was already reusable/development data.', '');
  lines.push(`Analysis fingerprint: \`${results.analysisFingerprintSha256}\``, '');
  lines.push('## Exact production equal_s1 audit', '');
  lines.push('| Tab | Development rows | Return MSE improvement | Return coefficient sign | Risk MSE improvement | Descriptive return BH q |');
  lines.push('|---|---:|---:|---|---:|---:|');
  for (const spec of MARKET_SPECS) {
    const ret = results.production.return[spec.key];
    const risk = results.production.futureRisk[spec.key];
    const sign = ret.ok && ret.scoreCoefficientSigns.dominantSign
      ? `${ret.scoreCoefficientSigns.dominantSign} ${percent(ret.scoreCoefficientSigns.dominantFraction, 1)}` : '—';
    lines.push(`| ${spec.name} | ${ret.forecastRows || 0} | ${percent(ret.relativeMseImprovementVsControls)} | ${sign} | ${percent(risk.relativeMseImprovementVsControls)} | ${Number.isFinite(ret.descriptiveBhQValue) ? ret.descriptiveBhQValue.toFixed(4) : '—'} |`);
  }
  lines.push('', 'The production input above is the exact published 0.1-point score; component precision is used only for challenger composites.', '');
  lines.push('## Development data adequacy', '');
  lines.push('| Tab | Forecast rows | Greedy non-overlapping outcomes | Calendar span (days) | Reference screen | Failed gates |');
  lines.push('|---|---:|---:|---:|---|---|');
  for (const spec of MARKET_SPECS) {
    const value = results.adequacy[spec.key];
    lines.push(`| ${spec.name} | ${value.forecastRows} | ${value.nonOverlappingOutcomes} | ${value.calendarSpanDays == null ? '—' : value.calendarSpanDays} | ${value.pass ? 'PASS' : 'UNDERPOWERED'} | ${value.failedGates.join(', ') || '—'} |`);
  }
  lines.push('', 'The 756 / 36 / 1,095 thresholds are an adequacy reference, not a formal power guarantee and not confirmation.', '');
  lines.push('## Optional bounded challenger development', '');
  if (!results.challengers.enabled) {
    lines.push('Frozen off for this snapshot. Only production equal_s1 was audited.', '');
  } else {
    lines.push(`Exactly ${results.challengers.evaluatedCandidates} candidates were evaluated (hard maximum ${results.challengers.maximumCandidates}). No additional candidate was tried.`, '');
    lines.push(`Development selection: \`${results.challengers.selectedDevelopmentCandidate || 'none'}\`. Prospective nomination gate: **${results.challengers.nomination.nominated ? 'PASS' : 'FAIL'}**.`, '');
    lines.push('| Candidate | Positive tabs | Worst improvement | Equal-tab mean | Valid all tabs |');
    lines.push('|---|---:|---:|---:|---|');
    for (const entry of results.challengers.ledger) {
      lines.push(`| ${entry.candidate.id} | ${entry.positiveMarketCount == null ? '—' : entry.positiveMarketCount} | ${percent(entry.worstMarketImprovement)} | ${percent(entry.equalMarketMeanImprovement)} | ${entry.validAllMarkets ? 'yes' : 'no'} |`);
    }
    lines.push('', 'Any nomination is a prospective model-development decision only. It does not validate v2 or the nominee on history.', '');
  }
  lines.push('## Bottom line', '', results.conclusion, '');
  return lines.join('\n');
}

function writeResults(results, outputRoot, stamp = runStamp()) {
  const directory = path.join(outputRoot, 'results');
  fs.mkdirSync(directory, { recursive: true });
  const jsonFile = path.join(directory, `fear-greed-v2-validation-results-${stamp}.json`);
  const reportFile = path.join(directory, `fear-greed-v2-validation-report-${stamp}.md`);
  const jsonBytes = Buffer.from(canonicalJson(results), 'utf8');
  const reportBytes = Buffer.from(markdownReport(results), 'utf8');
  const jsonSha256 = sha256Buffer(jsonBytes);
  const reportSha256 = sha256Buffer(reportBytes);
  fs.writeFileSync(jsonFile, jsonBytes, { flag: 'wx' });
  fs.writeFileSync(reportFile, reportBytes, { flag: 'wx' });
  return {
    jsonFile, reportFile,
    jsonChecksumFile: writeChecksum(jsonFile, jsonSha256),
    reportChecksumFile: writeChecksum(reportFile, reportSha256),
    jsonSha256, reportSha256,
  };
}

function parseArgs(argv) {
  const output = { snapshot: null, outDir: DEFAULT_ARTIFACT_ROOT, rankChallengers: null, help: false };
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index];
    if (argument === '--snapshot') output.snapshot = argv[++index];
    else if (argument === '--out-dir') output.outDir = argv[++index];
    else if (argument === '--rank-challengers') output.rankChallengers = true;
    else if (argument === '--help' || argument === '-h') output.help = true;
    else throw new Error(`unknown argument: ${argument}`);
  }
  if (!output.outDir) throw new Error('--out-dir requires a value');
  if (argv.includes('--snapshot') && !output.snapshot) throw new Error('--snapshot requires a value');
  return output;
}

function usage() {
  return [
    'Usage:',
    '  node research/fear_greed_v2_validation.js --rank-challengers [--out-dir DIR]',
    '  node research/fear_greed_v2_validation.js --snapshot FILE [--out-dir DIR]',
    '',
    'Live collection must not be run until protocol/code review and freeze. Saved replay never uses the network.',
  ].join('\n');
}

function createSyntheticTestRuntime(overrides = {}) {
  return { ...overrides, [SYNTHETIC_TEST_RUNTIME]: true };
}

function resolveGatePaths(runtime = {}) {
  return {
    lockPath: path.resolve(runtime.liveLockPath || DEFAULT_LIVE_LOCK_PATH),
    receiptPath: path.resolve(runtime.liveReceiptPath || DEFAULT_LIVE_RECEIPT_PATH),
  };
}

function releaseOwnedLiveLock(gate) {
  if (!gate || !fs.existsSync(gate.lockPath)) return false;
  let current = null;
  try { current = JSON.parse(fs.readFileSync(gate.lockPath, 'utf8')); } catch { return false; }
  if (current.ownerToken !== gate.ownerToken) return false;
  fs.unlinkSync(gate.lockPath);
  return true;
}

function acquireLiveCollectionGate(protocolState, runtime = {}) {
  assertProtocolFrozen(protocolState);
  const paths = resolveGatePaths(runtime);
  fs.mkdirSync(path.dirname(paths.lockPath), { recursive: true });
  fs.mkdirSync(path.dirname(paths.receiptPath), { recursive: true });
  if (fs.existsSync(paths.receiptPath)) throw new Error(`schema-5 live collection already consumed; receipt exists: ${paths.receiptPath}`);
  const ownerToken = crypto.randomUUID();
  const lock = {
    schemaVersion: SCHEMA_VERSION,
    ownerToken,
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
    protocolFreeze: protocolState,
  };
  try {
    fs.writeFileSync(paths.lockPath, canonicalJson(lock), { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error && error.code === 'EEXIST') throw new Error(`schema-5 global live-collection lock already exists: ${paths.lockPath}`);
    throw error;
  }
  if (fs.existsSync(paths.receiptPath)) {
    releaseOwnedLiveLock({ ...paths, ownerToken });
    throw new Error(`schema-5 live collection already consumed; receipt exists: ${paths.receiptPath}`);
  }
  return { ...paths, ownerToken };
}

function consumeLiveCollectionGate(gate, snapshotWritten, snapshot) {
  const receipt = {
    schemaVersion: SCHEMA_VERSION,
    status: 'SUCCESSFUL_LIVE_SNAPSHOT_WRITTEN_NO_SECOND_COLLECTION_ALLOWED',
    protocolFreeze: snapshot.protocolFreeze,
    collectionCreatedAt: snapshot.createdAt,
    recordedAt: new Date().toISOString(),
    snapshotPath: path.resolve(snapshotWritten.file),
    snapshotSha256: snapshotWritten.sha256,
  };
  fs.writeFileSync(gate.receiptPath, canonicalJson(receipt), { encoding: 'utf8', flag: 'wx' });
  releaseOwnedLiveLock(gate);
  return { path: gate.receiptPath, receipt };
}

async function runStudy(args, runtime = {}) {
  const syntheticTestRuntime = runtime[SYNTHETIC_TEST_RUNTIME] === true;
  const overrideKeys = ['protocolState', 'liveLockPath', 'liveReceiptPath', 'collectLiveSnapshot', 'stamp'];
  if (!syntheticTestRuntime && overrideKeys.some(key => Object.hasOwn(runtime, key))) {
    throw new Error('runtime overrides are restricted to the synthetic non-production test seam');
  }
  if (syntheticTestRuntime && !args.snapshot && typeof runtime.collectLiveSnapshot !== 'function') {
    throw new Error('synthetic live test seam requires an injected collector; it can never select the production network collector');
  }
  const stamp = syntheticTestRuntime && runtime.stamp || runStamp();
  const protocolState = syntheticTestRuntime && runtime.protocolState || parseProtocolFreezeState();
  let inputInfo;
  let networkUsed;
  let snapshotWritten = null;
  let liveReceipt = null;
  if (args.snapshot) {
    inputInfo = readSnapshot(args.snapshot, { protocolState });
    networkUsed = false;
    if (args.rankChallengers != null && args.rankChallengers !== inputInfo.snapshot.analysisPlan.rankChallengers) {
      throw new Error('replay cannot change the snapshot-frozen rankChallengers plan');
    }
  } else {
    assertProtocolFrozen(protocolState);
    if (args.rankChallengers !== true) throw new Error('frozen schema-5 live collection requires explicit --rank-challengers');
    const gate = acquireLiveCollectionGate(protocolState, syntheticTestRuntime ? runtime : {});
    let phase = 'collecting';
    try {
      const collector = syntheticTestRuntime ? runtime.collectLiveSnapshot : collectLiveSnapshot;
      const snapshot = await collector({ rankChallengers: true, protocolState });
      phase = 'collected';
      snapshotWritten = writeSnapshot(snapshot, args.outDir, stamp, { protocolState });
      phase = 'snapshot-written';
      liveReceipt = consumeLiveCollectionGate(gate, snapshotWritten, snapshot);
      phase = 'receipt-written';
      inputInfo = { snapshot, ...snapshotWritten, checksumVerified: true };
      networkUsed = true;
    } catch (error) {
      if (phase === 'collecting') releaseOwnedLiveLock(gate);
      throw error;
    }
  }
  const results = analyzeSnapshot(inputInfo.snapshot, inputInfo, { protocolState });
  const outputs = writeResults(results, args.outDir, stamp);
  return {
    execution: { networkUsed, replay: !networkUsed, rankChallengers: inputInfo.snapshot.analysisPlan.rankChallengers },
    inputInfo: { file: inputInfo.file, checksumFile: inputInfo.checksumFile, sha256: inputInfo.sha256, checksumVerified: inputInfo.checksumVerified },
    snapshotWritten,
    liveReceipt,
    results,
    outputs,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage()); return; }
  const completed = await runStudy(args);
  console.log(JSON.stringify({
    status: completed.results.status,
    execution: completed.execution,
    input: completed.inputInfo,
    outputs: completed.outputs,
    analysisFingerprintSha256: completed.results.analysisFingerprintSha256,
  }, null, 2));
}

module.exports = {
  SCHEMA_VERSION,
  STATUS,
  DRAFT_PROTOCOL_MARKER,
  REQUIRED_FROZEN_PROTOCOL_MARKER,
  REQUIRED_FROZEN_MODE,
  YAHOO_PARTIAL_BAR_POLICY,
  YAHOO_ADJUSTMENT_POLICY,
  COMPONENT_KEYS,
  CONTROL_FEATURES,
  DATA_ADEQUACY_MINIMUMS,
  MODEL_CONTRACT,
  CRYPTO_CONSTITUENTS,
  CRYPTO_TARGET_SPEC,
  FROZEN_MARKET_SYMBOLS,
  MARKET_SPECS,
  MAXIMUM_CANDIDATES,
  INITIAL_SEED_OBSERVATIONS,
  FROZEN_DESIGN,
  buildCandidates,
  canonicalize,
  canonicalJson,
  sha256Buffer,
  normalizedRowsSha256,
  frozenDependencySymbols,
  parseProtocolFreezeState,
  assertProtocolFrozen,
  validateModelConfig,
  resolveProductionTarget,
  validateYahooRequestIdentity,
  normalizeYahooPayload,
  normalizeSignals,
  reconstructFrozenSignals,
  productionRoundedScore,
  rawSeriesInventory,
  targetSeriesInventory,
  validateSnapshot,
  writeSnapshot,
  readSnapshot,
  buildCommonObservations,
  developmentSplit,
  analysisContext,
  addDescriptiveInference,
  candidateLedger,
  selectDevelopmentCandidate,
  nominationDecision,
  fingerprintAnalysis,
  analyzeSnapshot,
  markdownReport,
  writeResults,
  parseArgs,
  createSyntheticTestRuntime,
  runStudy,
  main,
};

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  });
}
