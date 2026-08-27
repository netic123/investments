'use strict';

// Research-only v3 shadow scorer. This file deliberately has no import from,
// export to, or mutation of the production dashboard model.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_SNAPSHOT_PATH = path.join(
  __dirname,
  'local-artifacts',
  'v2-validation-final',
  'inputs',
  'fear-greed-v2-validation-input-2026-08-25T12-44-22Z.json',
);

const MODEL_ID = 'investments-unified-fear-greed-v3-shadow-absolute-vol-normalized-v1';
const STATUS = 'RETROSPECTIVE_DEVELOPMENT_ONLY_NOT_VALIDATED_NOT_LIVE_APPROVED';
const SOURCE_STATUS = 'RETROSPECTIVE_DEVELOPMENT_ONLY_NO_CONFIRMATORY_OUTCOME';
const MARKET_KEYS = Object.freeze(['crypto', 'sweden', 'usa', 'europe', 'global']);
const COMPONENT_KEYS = Object.freeze([
  'trend',
  'strength',
  'volatility',
  'safeHaven',
  'credit',
  'breadth',
]);

const PARAMETERS = deepFreeze({
  // Every number below applies unchanged to all five markets.
  trendSmaBars: 200,
  drawdownHighBars: 252,
  realizedVolShortBars: 20,
  realizedVolLongBars: 252,
  normalizationVolBars: 63,
  relativeReturnBars: 20,
  participationSmaBars: 100,
  normalizationHorizonBars: 20,
  symmetricSigmaLimit: 2,
  drawdownSigmaLimit: 2,
  volatilityRatioOctaveLimit: 1,
  volatilityFloorDaily: 1e-6,
  maxCarryCalendarDays: 7,
  minimumParticipationSegments: 2,
  componentWeights: Object.freeze(Object.fromEntries(COMPONENT_KEYS.map(key => [key, 1 / COMPONENT_KEYS.length]))),
});

const FROZEN_DEVELOPMENT_INPUT = deepFreeze({
  basename: 'fear-greed-v2-validation-input-2026-08-25T12-44-22Z.json',
  sha256: 'ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d',
  collectedAt: '2026-08-25T12:44:22.950Z',
  interpretation: SOURCE_STATUS,
});

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function clip(value, minimum = 0, maximum = 100) {
  if (!Number.isFinite(value)) return null;
  return Math.min(maximum, Math.max(minimum, value));
}

function mean(values) {
  return values.length && values.every(Number.isFinite)
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function sampleStandardDeviation(values) {
  if (!Array.isArray(values) || values.length < 2 || values.some(value => !Number.isFinite(value))) return null;
  const average = mean(values);
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

// These transforms have explicit anchors. They never rank today's value
// against a trailing empirical percentile.
function symmetricSigmaScore(z, parameters = PARAMETERS) {
  return clip(50 + 50 * z / parameters.symmetricSigmaLimit);
}

function drawdownSigmaScore(z, parameters = PARAMETERS) {
  // z is zero at the trailing high and normally negative below it.
  return clip(100 + 100 * z / parameters.drawdownSigmaLimit);
}

function volatilityRatioScore(ratio, parameters = PARAMETERS) {
  if (!(ratio > 0)) return null;
  return clip(50 - 50 * Math.log2(ratio) / parameters.volatilityRatioOctaveLimit);
}

function requireIsoDate(value, context) {
  const milliseconds = typeof value === 'string' ? Date.parse(`${value}T00:00:00.000Z`) : NaN;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(milliseconds) || new Date(milliseconds).toISOString().slice(0, 10) !== value) {
    throw new Error(`${context} is not a valid ISO date`);
  }
}

function assertFrozenParameters(parameters) {
  if (JSON.stringify(parameters) !== JSON.stringify(PARAMETERS)) {
    throw new Error('v3 shadow scoring parameters differ from the frozen universal definition');
  }
  return parameters;
}

function calendarDays(later, earlier) {
  return (Date.parse(`${later}T00:00:00.000Z`) - Date.parse(`${earlier}T00:00:00.000Z`)) / 86400000;
}

function normalizeSeries(series, context = 'series') {
  if (!series || !Array.isArray(series.rows) || !series.rows.length) throw new Error(`${context} has no rows`);
  let previous = null;
  const rows = series.rows.map((row, index) => {
    requireIsoDate(row && row.date, `${context} row ${index} date`);
    const close = Number(row.close);
    if (!(close > 0)) throw new Error(`${context} row ${row.date} has a non-positive close`);
    if (previous && row.date <= previous) throw new Error(`${context} dates are unordered or duplicated`);
    previous = row.date;
    return { date: row.date, close };
  });
  return {
    id: String(series.id || series.symbol || context),
    name: String(series.name || series.id || series.symbol || context),
    sourceSymbols: Array.isArray(series.sourceSymbols) ? series.sourceSymbols.slice() : [String(series.symbol || series.id || context)],
    rows,
  };
}

function equalWeightReturnSeries(spec, sourceMap) {
  if (!spec || spec.method !== 'equalWeightReturns' || !Array.isArray(spec.symbols) || spec.symbols.length < 2) {
    throw new Error('synthetic series must declare equalWeightReturns and at least two constituents');
  }
  if (new Set(spec.symbols).size !== spec.symbols.length) throw new Error(`${spec.id || 'synthetic series'} has duplicate constituents`);
  const inputs = spec.symbols.map(symbol => sourceMap.get(symbol));
  if (inputs.some(series => !series)) throw new Error(`${spec.id || 'synthetic series'} is missing a constituent`);
  const maps = inputs.map(series => new Map(series.rows.map(row => [row.date, row.close])));
  const dates = inputs[0].rows.map(row => row.date).filter(date => maps.every(map => map.has(date)));
  if (dates.length < 2) throw new Error(`${spec.id || 'synthetic series'} has fewer than two strict common dates`);

  const rows = [];
  let level = 100;
  let previous = null;
  for (const date of dates) {
    const closes = maps.map(map => map.get(date));
    if (previous) {
      const averageReturn = mean(closes.map((close, index) => close / previous[index] - 1));
      if (!Number.isFinite(averageReturn) || 1 + averageReturn <= 0) throw new Error(`${spec.id || 'synthetic series'} has an invalid return on ${date}`);
      level *= 1 + averageReturn;
    }
    rows.push({ date, close: level });
    previous = closes;
  }
  return normalizeSeries({
    id: String(spec.id || `EW(${spec.symbols.join(',')})`),
    name: String(spec.name || spec.id || 'Equal-weight return series'),
    sourceSymbols: spec.symbols,
    rows,
  }, String(spec.id || 'synthetic series'));
}

function resolveSeriesSpec(spec, sourceMap, context = 'series spec') {
  if (typeof spec === 'string' && spec) {
    const direct = sourceMap.get(spec);
    if (!direct) throw new Error(`${context} ${spec} is absent from the frozen source inventory`);
    return direct;
  }
  if (spec && spec.method === 'equalWeightReturns') return equalWeightReturnSeries(spec, sourceMap);
  throw new Error(`${context} is missing or unsupported`);
}

function sourceMapFromSnapshot(snapshot) {
  const inventory = snapshot && snapshot.sources && snapshot.sources.yahoo && snapshot.sources.yahoo.normalizedSeriesInventory;
  if (!Array.isArray(inventory) || !inventory.length) throw new Error('snapshot has no normalized Yahoo source inventory');
  const sourceMap = new Map();
  for (const item of inventory) {
    if (!item || typeof item.symbol !== 'string' || sourceMap.has(item.symbol)) throw new Error('source inventory has a missing or duplicate symbol');
    sourceMap.set(item.symbol, normalizeSeries({ ...item, rows: item.normalizedRows }, item.symbol));
  }
  return sourceMap;
}

function lastIndexOnOrBefore(rows, date) {
  let low = 0;
  let high = rows.length - 1;
  let found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (rows[middle].date <= date) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }
  return found;
}

function asOfIndex(series, date, parameters = PARAMETERS) {
  const index = lastIndexOnOrBefore(series.rows, date);
  if (index < 0) return null;
  const asOf = series.rows[index].date;
  const age = calendarDays(date, asOf);
  if (age < 0 || age > parameters.maxCarryCalendarDays) return null;
  return { index, asOf, ageCalendarDays: age };
}

function closeWindow(rows, endIndex, count) {
  if (endIndex < count - 1) return null;
  return rows.slice(endIndex - count + 1, endIndex + 1).map(row => row.close);
}

function logReturnWindow(rows, endIndex, count) {
  if (endIndex < count) return null;
  const output = [];
  for (let index = endIndex - count + 1; index <= endIndex; index++) {
    output.push(Math.log(rows[index].close / rows[index - 1].close));
  }
  return output;
}

function normalizedTrendState(series, date, smaBars, parameters = PARAMETERS) {
  const located = asOfIndex(series, date, parameters);
  if (!located) return null;
  const closes = closeWindow(series.rows, located.index, smaBars);
  const returns = logReturnWindow(series.rows, located.index, parameters.normalizationVolBars);
  if (!closes || !returns) return null;
  const movingAverage = mean(closes);
  const dailySigma = Math.max(sampleStandardDeviation(returns), parameters.volatilityFloorDaily);
  const rawLogDistance = Math.log(series.rows[located.index].close / movingAverage);
  const normalizedSigma = rawLogDistance / (dailySigma * Math.sqrt(parameters.normalizationHorizonBars));
  return {
    asOf: located.asOf,
    ageCalendarDays: located.ageCalendarDays,
    close: series.rows[located.index].close,
    movingAverage,
    rawLogDistance,
    dailySigma,
    normalizedSigma,
  };
}

function trendComponent(series, date, parameters = PARAMETERS) {
  const state = normalizedTrendState(series, date, parameters.trendSmaBars, parameters);
  return state && {
    score: symmetricSigmaScore(state.normalizedSigma, parameters),
    raw: state.normalizedSigma,
    units: 'sigma-distance from own 200-bar SMA over a 20-bar horizon',
    ...state,
  };
}

function strengthComponent(series, date, parameters = PARAMETERS) {
  const located = asOfIndex(series, date, parameters);
  if (!located) return null;
  const closes = closeWindow(series.rows, located.index, parameters.drawdownHighBars);
  const returns = logReturnWindow(series.rows, located.index, parameters.normalizationVolBars);
  if (!closes || !returns) return null;
  const trailingHigh = Math.max(...closes);
  const dailySigma = Math.max(sampleStandardDeviation(returns), parameters.volatilityFloorDaily);
  const rawLogDrawdown = Math.log(series.rows[located.index].close / trailingHigh);
  const normalizedSigma = rawLogDrawdown / (dailySigma * Math.sqrt(parameters.normalizationHorizonBars));
  return {
    score: drawdownSigmaScore(normalizedSigma, parameters),
    raw: normalizedSigma,
    units: 'sigma-drawdown from own 252-bar high over a 20-bar horizon',
    asOf: located.asOf,
    ageCalendarDays: located.ageCalendarDays,
    close: series.rows[located.index].close,
    trailingHigh,
    rawLogDrawdown,
    dailySigma,
    normalizedSigma,
  };
}

function volatilityComponent(series, date, parameters = PARAMETERS) {
  const located = asOfIndex(series, date, parameters);
  if (!located) return null;
  const shortReturns = logReturnWindow(series.rows, located.index, parameters.realizedVolShortBars);
  const longReturns = logReturnWindow(series.rows, located.index, parameters.realizedVolLongBars);
  if (!shortReturns || !longReturns) return null;
  const shortDailySigma = Math.max(sampleStandardDeviation(shortReturns), parameters.volatilityFloorDaily);
  const longDailySigma = Math.max(sampleStandardDeviation(longReturns), parameters.volatilityFloorDaily);
  const ratio = shortDailySigma / longDailySigma;
  return {
    score: volatilityRatioScore(ratio, parameters),
    raw: ratio,
    units: '20-bar realised volatility divided by 252-bar realised volatility',
    asOf: located.asOf,
    ageCalendarDays: located.ageCalendarDays,
    shortDailySigma,
    longDailySigma,
    ratio,
  };
}

function exactDatePair(left, right) {
  const rightByDate = new Map(right.rows.map(row => [row.date, row.close]));
  const rows = left.rows
    .filter(row => rightByDate.has(row.date))
    .map(row => ({ date: row.date, left: row.close, right: rightByDate.get(row.date) }));
  if (rows.length < 2) throw new Error(`${left.id}/${right.id} have fewer than two strict common dates`);
  return { id: `${left.id}/${right.id}`, left, right, rows };
}

function relativeAppetiteComponent(pair, date, label, parameters = PARAMETERS) {
  const located = asOfIndex(pair, date, parameters);
  if (!located || located.index < Math.max(parameters.relativeReturnBars, parameters.normalizationVolBars)) return null;
  const end = pair.rows[located.index];
  const start = pair.rows[located.index - parameters.relativeReturnBars];
  const rawRelativeLogReturn = Math.log(end.left / start.left) - Math.log(end.right / start.right);
  const dailyRelativeReturns = [];
  for (let index = located.index - parameters.normalizationVolBars + 1; index <= located.index; index++) {
    const current = pair.rows[index];
    const previous = pair.rows[index - 1];
    dailyRelativeReturns.push(Math.log(current.left / previous.left) - Math.log(current.right / previous.right));
  }
  const dailyRelativeSigma = Math.max(sampleStandardDeviation(dailyRelativeReturns), parameters.volatilityFloorDaily);
  const normalizedSigma = rawRelativeLogReturn / (dailyRelativeSigma * Math.sqrt(parameters.relativeReturnBars));
  return {
    score: symmetricSigmaScore(normalizedSigma, parameters),
    raw: normalizedSigma,
    units: `sigma-normalized ${parameters.relativeReturnBars}-bar ${label} relative log return`,
    asOf: located.asOf,
    ageCalendarDays: located.ageCalendarDays,
    rawRelativeLogReturn,
    dailyRelativeSigma,
    normalizedSigma,
    left: pair.left.id,
    right: pair.right.id,
  };
}

function participationComponent(segments, date, parameters = PARAMETERS) {
  const unique = [];
  const identities = new Set();
  for (const series of segments) {
    if (!series) continue;
    const identity = series.id;
    if (!identities.has(identity)) {
      identities.add(identity);
      unique.push(series);
    }
  }
  if (unique.length < parameters.minimumParticipationSegments) return null;
  const states = unique.map(series => ({
    series,
    state: normalizedTrendState(series, date, parameters.participationSmaBars, parameters),
  }));
  if (states.some(item => !item.state)) return null;
  const segmentStates = states.map(({ series, state }) => ({
    id: series.id,
    asOf: state.asOf,
    normalizedSigma: state.normalizedSigma,
    aboveOwnTrend: state.rawLogDistance > 0,
    score: symmetricSigmaScore(state.normalizedSigma, parameters),
  }));
  const aboveTrendFraction = segmentStates.filter(item => item.aboveOwnTrend).length / segmentStates.length;
  return {
    score: mean(segmentStates.map(item => item.score)),
    raw: aboveTrendFraction,
    units: 'participation proxy: fraction of available broad/large/small segments above their own 100-bar SMA',
    asOf: segmentStates.map(item => item.asOf).sort().at(0),
    segmentCount: segmentStates.length,
    aboveTrendFraction,
    segments: segmentStates,
  };
}

function resolveMarket(snapshot, market, sourceMap = sourceMapFromSnapshot(snapshot)) {
  if (!market || !MARKET_KEYS.includes(market.key)) throw new Error('unknown market in snapshot');
  const mapping = market.productionMapping && market.productionMapping.symbols;
  if (!mapping) throw new Error(`${market.key} has no frozen production symbol mapping`);
  const benchmark = normalizeSeries({
    ...market.prices,
    id: market.targetId,
    rows: market.prices && market.prices.rows,
  }, `${market.key} benchmark`);
  const bond = resolveSeriesSpec(mapping.bond, sourceMap, `${market.key} safe-haven`);
  const highYield = resolveSeriesSpec(mapping.hy, sourceMap, `${market.key} high yield`);
  const investmentGrade = mapping.ig == null
    ? bond
    : resolveSeriesSpec(mapping.ig, sourceMap, `${market.key} investment grade`);
  const small = resolveSeriesSpec(mapping.small, sourceMap, `${market.key} small segment`);
  const large = mapping.large == null
    ? benchmark
    : resolveSeriesSpec(mapping.large, sourceMap, `${market.key} large segment`);
  return {
    benchmark,
    bond,
    highYield,
    investmentGrade,
    participationSegments: [benchmark, large, small],
  };
}

function scoreMarket(snapshot, market, parameters = PARAMETERS, sourceMap = sourceMapFromSnapshot(snapshot)) {
  assertFrozenParameters(parameters);
  const resolved = resolveMarket(snapshot, market, sourceMap);
  const safePair = exactDatePair(resolved.benchmark, resolved.bond);
  const creditPair = exactDatePair(resolved.highYield, resolved.investmentGrade);
  const history = [];
  for (const benchmarkRow of resolved.benchmark.rows) {
    const date = benchmarkRow.date;
    const components = {
      trend: trendComponent(resolved.benchmark, date, parameters),
      strength: strengthComponent(resolved.benchmark, date, parameters),
      volatility: volatilityComponent(resolved.benchmark, date, parameters),
      safeHaven: relativeAppetiteComponent(safePair, date, 'benchmark-minus-safe-haven', parameters),
      credit: relativeAppetiteComponent(creditPair, date, 'high-yield-minus-investment-grade', parameters),
      breadth: participationComponent(resolved.participationSegments, date, parameters),
    };
    if (COMPONENT_KEYS.some(key => !components[key] || !Number.isFinite(components[key].score))) continue;
    const score = mean(COMPONENT_KEYS.map(key => components[key].score));
    history.push({
      date,
      score: Math.round(score * 10) / 10,
      exactScore: score,
      componentCount: COMPONENT_KEYS.length,
      components,
    });
  }
  if (!history.length) throw new Error(`${market.key} produced no complete v3 shadow scores`);
  return {
    key: market.key,
    name: market.name,
    benchmarkId: resolved.benchmark.id,
    status: STATUS,
    rowCount: history.length,
    firstDate: history[0].date,
    lastDate: history.at(-1).date,
    latest: history.at(-1),
    history,
  };
}

function validateDevelopmentSnapshot(snapshot) {
  if (!snapshot || snapshot.status !== SOURCE_STATUS) throw new Error(`snapshot status must be ${SOURCE_STATUS}`);
  if (snapshot.createdAt !== FROZEN_DEVELOPMENT_INPUT.collectedAt) throw new Error('snapshot collection timestamp differs from the frozen development input');
  const keys = (snapshot.markets || []).map(market => market.key);
  if (JSON.stringify(keys) !== JSON.stringify(MARKET_KEYS)) throw new Error('snapshot markets or market order differ from the frozen five-market design');
  return snapshot;
}

function analyzeSnapshot(snapshot, parameters = PARAMETERS) {
  assertFrozenParameters(parameters);
  validateDevelopmentSnapshot(snapshot);
  const sourceMap = sourceMapFromSnapshot(snapshot);
  const markets = snapshot.markets.map(market => scoreMarket(snapshot, market, parameters, sourceMap));
  return {
    modelId: MODEL_ID,
    status: STATUS,
    sourceStatus: snapshot.status,
    sourceCreatedAt: snapshot.createdAt,
    parameters,
    interpretation: 'Descriptive shadow score only. Historical predictive value and superiority to buy-and-hold are not established.',
    markets,
  };
}

function readFrozenDevelopmentSnapshot(file = DEFAULT_SNAPSHOT_PATH) {
  const resolved = path.resolve(file);
  const bytes = fs.readFileSync(resolved);
  const digest = sha256(bytes);
  if (path.basename(resolved) !== FROZEN_DEVELOPMENT_INPUT.basename || digest !== FROZEN_DEVELOPMENT_INPUT.sha256) {
    throw new Error(`input is not the exact frozen schema-5 development snapshot (sha256 ${digest})`);
  }
  const checksumPath = resolved.replace(/\.json$/i, '.sha256');
  const checksumText = fs.readFileSync(checksumPath, 'utf8').trim();
  const declared = checksumText.split(/\s+/)[0];
  if (declared !== digest) throw new Error('snapshot checksum sidecar does not match the snapshot bytes');
  const snapshot = JSON.parse(bytes.toString('utf8'));
  validateDevelopmentSnapshot(snapshot);
  return { file: resolved, checksumFile: checksumPath, sha256: digest, snapshot };
}

function compactSummary(analysis, input) {
  return {
    modelId: analysis.modelId,
    status: analysis.status,
    warning: analysis.interpretation,
    input: {
      file: input.file.replace(/\\/g, '/'),
      sha256: input.sha256,
      sourceCreatedAt: analysis.sourceCreatedAt,
    },
    parameters: analysis.parameters,
    markets: analysis.markets.map(market => ({
      key: market.key,
      benchmarkId: market.benchmarkId,
      coverage: { rows: market.rowCount, firstDate: market.firstDate, lastDate: market.lastDate },
      latest: {
        date: market.latest.date,
        score: market.latest.score,
        components: Object.fromEntries(COMPONENT_KEYS.map(key => [key, {
          score: Math.round(market.latest.components[key].score * 10) / 10,
          raw: market.latest.components[key].raw,
        }])),
      },
    })),
  };
}

function parseArgs(argv) {
  const output = { snapshot: DEFAULT_SNAPSHOT_PATH, help: false };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--snapshot') {
      if (!argv[index + 1]) throw new Error('--snapshot requires a path');
      output.snapshot = argv[++index];
    } else if (token === '--help' || token === '-h') {
      output.help = true;
    } else {
      throw new Error(`unknown argument ${token}`);
    }
  }
  return output;
}

function usage() {
  return [
    'Research-only v3 shadow scorer (no network, no production writes).',
    '',
    'Usage:',
    '  node research/fear_greed_v3_shadow.js',
    '  node research/fear_greed_v3_shadow.js --snapshot <exact-frozen-schema5-input.json>',
  ].join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  const input = readFrozenDevelopmentSnapshot(args.snapshot);
  const analysis = analyzeSnapshot(input.snapshot);
  console.log(JSON.stringify(compactSummary(analysis, input), null, 2));
}

module.exports = {
  MODEL_ID,
  STATUS,
  SOURCE_STATUS,
  MARKET_KEYS,
  COMPONENT_KEYS,
  PARAMETERS,
  FROZEN_DEVELOPMENT_INPUT,
  DEFAULT_SNAPSHOT_PATH,
  clip,
  mean,
  sampleStandardDeviation,
  symmetricSigmaScore,
  drawdownSigmaScore,
  volatilityRatioScore,
  assertFrozenParameters,
  normalizeSeries,
  equalWeightReturnSeries,
  resolveSeriesSpec,
  sourceMapFromSnapshot,
  lastIndexOnOrBefore,
  normalizedTrendState,
  trendComponent,
  strengthComponent,
  volatilityComponent,
  exactDatePair,
  relativeAppetiteComponent,
  participationComponent,
  resolveMarket,
  scoreMarket,
  validateDevelopmentSnapshot,
  analyzeSnapshot,
  readFrozenDevelopmentSnapshot,
  compactSummary,
  parseArgs,
  main,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  }
}
