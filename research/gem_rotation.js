'use strict';

// Research-only cross-market relative/absolute momentum rotation scaffold.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PROTOCOL_PATH = path.join(__dirname, 'GEM_ROTATION_REPLICATION_PROTOCOL.md');
const PROTOCOL_SHA256 = 'c04e1b966e90e7626e5a4c01c02beb364f9b953b45dc72791df2cab5c7522f16';
const DEFAULT_SCHEMA5 = path.join(__dirname, 'local-artifacts', 'v2-validation-final', 'inputs', 'fear-greed-v2-validation-input-2026-08-25T12-44-22Z.json');
const INPUT_SCHEMA = 'gem-rotation-input-v1';
const INPUT_STATUS = 'RETROSPECTIVE_DEVELOPMENT_ONLY';
const MARKET_KEYS = Object.freeze(['crypto', 'sweden', 'usa', 'europe', 'global']);
const MAX_REFERENCE_STALE_DAYS = 7;
const PRIMARY_COST = 0.002;
const STRESS_COST = 0.004;
const DAY_COUNT = 365.2425;

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function sampleStd(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}
function dateMs(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`invalid date ${date}`);
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== date) throw new Error(`invalid date ${date}`);
  return ms;
}
function days(first, last) { return (dateMs(last) - dateMs(first)) / 86400000; }

function assertProtocolFrozen() {
  const bytes = fs.readFileSync(PROTOCOL_PATH);
  const digest = sha256(bytes);
  if (digest !== PROTOCOL_SHA256 || !bytes.toString('utf8').includes('FROZEN_GEM_ROTATION_V1')) throw new Error(`GEM protocol drifted: ${digest}`);
  return digest;
}

function anniversary12(date) {
  dateMs(date);
  const source = new Date(`${date}T00:00:00.000Z`);
  const year = source.getUTCFullYear() - 1;
  const month = source.getUTCMonth();
  const day = Math.min(source.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

function text(value, context) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${context} is required`); }

function validateSeries(series, context, role) {
  if (!series) throw new Error(`${context} is required`);
  text(series.id, `${context}.id`);
  if (series.role !== role) throw new Error(`${context}.role must be ${role}`);
  if (series.currency !== 'USD') throw new Error(`${context}.currency must be USD`);
  if (series.returnType !== 'total_return') throw new Error(`${context}.returnType must be total_return`);
  text(series.methodology, `${context}.methodology`);
  text(series.source, `${context}.source`);
  text(series.timezone, `${context}.timezone`);
  text(series.retrievedAt, `${context}.retrievedAt`);
  const retrieved = Date.parse(series.retrievedAt);
  if (!Number.isFinite(retrieved) || new Date(retrieved).toISOString() !== series.retrievedAt) throw new Error(`${context}.retrievedAt must be exact ISO UTC`);
  if (!Array.isArray(series.rows) || series.rows.length < 25) throw new Error(`${context}.rows requires at least 25 observations`);
  let previous = '';
  for (const row of series.rows) {
    if (!row || (previous && row.date <= previous) || !(Number(row.value) > 0)) throw new Error(`${context}.rows must be ordered positive wealth-index observations`);
    dateMs(row.date); previous = row.date;
  }
  if (role === 'usd_3m_tbill_cash_total_return' && /\^IRX|IEF/i.test(`${series.id} ${series.methodology}`)) throw new Error(`${context} cannot substitute a yield or bond ETF`);
  return series;
}

function validateInput(input) {
  assertProtocolFrozen();
  if (!input || input.schema !== INPUT_SCHEMA) throw new Error(`input.schema must be ${INPUT_SCHEMA}`);
  if (input.status !== INPUT_STATUS) throw new Error(`input.status must be ${INPUT_STATUS}`);
  validateSeries(input.cashTotalReturn, 'cashTotalReturn', 'usd_3m_tbill_cash_total_return');
  validateSeries(input.acwiBenchmarkTotalReturn, 'acwiBenchmarkTotalReturn', 'acwi_benchmark_total_return');
  if (!Array.isArray(input.markets) || input.markets.map(row => row.key).join(',') !== MARKET_KEYS.join(',')) throw new Error(`markets must be ${MARKET_KEYS.join(',')} in order`);
  for (const market of input.markets) {
    text(market.name, `${market.key}.name`);
    validateSeries(market.riskTotalReturn, `${market.key}.riskTotalReturn`, 'risky_market_total_return');
  }
  return input;
}

function strictCommonRows(input) {
  const series = [input.cashTotalReturn, input.acwiBenchmarkTotalReturn, ...input.markets.map(row => row.riskTotalReturn)];
  const maps = series.map(item => new Map(item.rows.map(row => [row.date, row.value])));
  const rows = series[0].rows.filter(row => maps.every(map => map.has(row.date))).map(row => ({
    date: row.date,
    cash: maps[0].get(row.date),
    acwi: maps[1].get(row.date),
    assets: Object.fromEntries(MARKET_KEYS.map((key, index) => [key, maps[index + 2].get(row.date)])),
  }));
  const months = new Set(rows.map(row => row.date.slice(0, 7)));
  if (months.size < 25) throw new Error(`strict common calendar has only ${months.size} months; 25 required`);
  return rows;
}

function lastIndexOnOrBefore(rows, date) {
  let low = 0, high = rows.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (rows[middle].date <= date) { found = middle; low = middle + 1; } else high = middle - 1;
  }
  return found;
}

function signalAt(rows, index) {
  if (!rows[index + 1]) return null;
  const signal = rows[index];
  const anniversary = anniversary12(signal.date);
  const referenceIndex = lastIndexOnOrBefore(rows, anniversary);
  if (referenceIndex < 0 || days(rows[referenceIndex].date, anniversary) > MAX_REFERENCE_STALE_DAYS) return null;
  const reference = rows[referenceIndex];
  const cashReturn = signal.cash / reference.cash - 1;
  const ranked = MARKET_KEYS.map((key, order) => ({ key, order, return12m: signal.assets[key] / reference.assets[key] - 1 }))
    .sort((left, right) => right.return12m - left.return12m || left.order - right.order);
  const top1Weights = ranked[0].return12m > cashReturn ? { [ranked[0].key]: 1 } : {};
  const top2Weights = {};
  for (const item of ranked.slice(0, 2)) if (item.return12m > cashReturn) top2Weights[item.key] = 0.5;
  return {
    signalDate: signal.date,
    referenceDate: reference.date,
    anniversaryDate: anniversary,
    executionDate: rows[index + 1].date,
    cashReturn12m: cashReturn,
    ranking: ranked.map(({ key, return12m }) => ({ key, return12m })),
    top1Weights,
    top2Weights,
  };
}

function buildMonthlySignals(rows) {
  const monthLast = new Map();
  rows.forEach((row, index) => monthLast.set(row.date.slice(0, 7), index));
  return [...monthLast.values()].map(index => signalAt(rows, index)).filter(Boolean);
}

function validateWeights(weights, keys) {
  const values = keys.map(key => Number(weights[key] || 0));
  if (values.some(value => value < 0 || value > 1 || !Number.isFinite(value)) || values.reduce((a, b) => a + b, 0) > 1 + 1e-12) throw new Error('invalid long/cash weights');
  return values;
}

function exactRebalance(wealth, preRisk, targetWeights, cost, keys) {
  if (!(wealth > 0) || !(cost >= 0 && cost < 1)) throw new Error('invalid rebalance inputs');
  const weights = validateWeights(targetWeights, keys);
  const notionals = keys.map(key => Number(preRisk[key] || 0));
  const equation = postWealth => postWealth + cost * weights.reduce((sum, weight, index) => sum + Math.abs(weight * postWealth - notionals[index]), 0) - wealth;
  let low = 0, high = wealth;
  for (let iteration = 0; iteration < 100; iteration++) {
    const middle = (low + high) / 2;
    if (equation(middle) > 0) high = middle; else low = middle;
  }
  const postWealth = (low + high) / 2;
  const postRisk = Object.fromEntries(keys.map((key, index) => [key, weights[index] * postWealth]));
  const tradedNotional = keys.reduce((sum, key) => sum + Math.abs(postRisk[key] - (preRisk[key] || 0)), 0);
  const costAmount = cost * tradedNotional;
  const postCash = postWealth - Object.values(postRisk).reduce((a, b) => a + b, 0);
  if (Math.abs(wealth - costAmount - postWealth) > 1e-11 || postCash < -1e-12) throw new Error('rebalance identity failed');
  return { postWealth, postRisk, postCash: Math.max(0, postCash), tradedNotional, costAmount };
}

function maximumDrawdown(curve) {
  let peak = 0, worst = 0;
  for (const row of curve) { peak = Math.max(peak, row.wealth); worst = Math.min(worst, row.wealth / peak - 1); }
  return worst;
}

function summarize(curve, turnover, rebalanceCount) {
  const years = days(curve[0].date, curve.at(-1).date) / DAY_COUNT;
  const logReturns = [];
  for (let index = 1; index < curve.length; index++) logReturns.push(Math.log(curve[index].wealth / curve[index - 1].wealth));
  const terminalWealth = curve.at(-1).wealth;
  return {
    startDate: curve[0].date,
    endDate: curve.at(-1).date,
    observations: curve.length,
    terminalWealth,
    annualizedLogReturn: years > 0 ? Math.log(terminalWealth) / years : null,
    annualizedVolatility: years > 0 && logReturns.length > 1 ? sampleStd(logReturns) * Math.sqrt(logReturns.length / years) : null,
    maximumDrawdown: maximumDrawdown(curve),
    totalOneWayRiskyTurnover: turnover,
    rebalanceCount,
  };
}

function simulate(rows, targetSchedule, cost, keys) {
  if (rows.length < 2) throw new Error('simulation needs two closes');
  const schedule = new Map(targetSchedule.map(item => [item.executionDate, item.weights]));
  if (!schedule.has(rows[0].date)) throw new Error(`no target at same-start close ${rows[0].date}`);
  let wealth = 1, risk = Object.fromEntries(keys.map(key => [key, 0])), cash = 1;
  let turnover = 0, rebalanceCount = 0;
  let fill = exactRebalance(wealth, risk, schedule.get(rows[0].date), cost, keys);
  ({ postWealth: wealth, postRisk: risk, postCash: cash } = fill);
  turnover += fill.tradedNotional; if (fill.tradedNotional > 1e-14) rebalanceCount++;
  const curve = [{ date: rows[0].date, wealth }];
  for (let index = 1; index < rows.length; index++) {
    const start = rows[index - 1], end = rows[index];
    for (const key of keys) risk[key] *= end.assets[key] / start.assets[key];
    cash *= end.cash / start.cash;
    wealth = cash + Object.values(risk).reduce((a, b) => a + b, 0);
    if (schedule.has(end.date)) {
      fill = exactRebalance(wealth, risk, schedule.get(end.date), cost, keys);
      ({ postWealth: wealth, postRisk: risk, postCash: cash } = fill);
      turnover += fill.tradedNotional; if (fill.tradedNotional > 1e-14) rebalanceCount++;
    }
    curve.push({ date: end.date, wealth });
  }
  fill = exactRebalance(wealth, risk, {}, cost, keys);
  ({ postWealth: wealth, postRisk: risk, postCash: cash } = fill);
  turnover += fill.tradedNotional; if (fill.tradedNotional > 1e-14) rebalanceCount++;
  curve[curve.length - 1] = { date: rows.at(-1).date, wealth };
  return summarize(curve, turnover, rebalanceCount);
}

function analyzeAtCost(commonRows, signals, cost) {
  const startDate = signals[0].executionDate;
  const rows = commonRows.slice(commonRows.findIndex(row => row.date === startDate));
  const primarySchedule = signals.map(signal => ({ executionDate: signal.executionDate, weights: signal.top1Weights }));
  const robustSchedule = signals.map(signal => ({ executionDate: signal.executionDate, weights: signal.top2Weights }));
  const monthlyEqualWeight = signals.map(signal => ({ executionDate: signal.executionDate, weights: Object.fromEntries(MARKET_KEYS.map(key => [key, 0.2])) }));
  const strategies = {
    GEM_TOP1_CASH: simulate(rows, primarySchedule, cost, MARKET_KEYS),
    GEM_TOP2_SLOTS_CASH: simulate(rows, robustSchedule, cost, MARKET_KEYS),
  };
  const benchmarks = {
    monthlyEqualWeightFive: simulate(rows, monthlyEqualWeight, cost, MARKET_KEYS),
    eachAssetBuyAndHold: Object.fromEntries(MARKET_KEYS.map(key => [key, simulate(rows, [{ executionDate: startDate, weights: { [key]: 1 } }], cost, MARKET_KEYS)])),
  };
  const acwiRows = rows.map(row => ({ ...row, assets: { acwi: row.acwi } }));
  benchmarks.ACWIBuyAndHold = simulate(acwiRows, [{ executionDate: startDate, weights: { acwi: 1 } }], cost, ['acwi']);
  return { startDate, endDate: rows.at(-1).date, strategies, benchmarks };
}

function analyzeInput(input) {
  validateInput(input);
  const rows = strictCommonRows(input);
  const signals = buildMonthlySignals(rows);
  if (!signals.length) throw new Error('no executable 12-calendar-month signals on strict common calendar');
  return {
    status: 'RETROSPECTIVE_DEVELOPMENT_ONLY_NOT_CONFIRMATORY',
    protocolSha256: assertProtocolFrozen(),
    inputSchema: input.schema,
    commonCalendar: { observations: rows.length, months: new Set(rows.map(row => row.date.slice(0, 7))).size, firstDate: rows[0].date, lastDate: rows.at(-1).date },
    signalCount: signals.length,
    firstSignal: signals[0],
    lastSignal: signals.at(-1),
    primary: analyzeAtCost(rows, signals, PRIMARY_COST),
    doubleCostStress: analyzeAtCost(rows, signals, STRESS_COST),
    primaryRuleFixed: 'GEM_TOP1_CASH',
    robustnessRuleNeverSelectsPrimary: 'GEM_TOP2_SLOTS_CASH',
    warning: 'No final-period model selection; historical evidence is retrospective development only.',
  };
}

function auditExistingSnapshot(snapshot) {
  const missing = [];
  if (!snapshot || snapshot.schema !== INPUT_SCHEMA) missing.push(`top-level schema ${INPUT_SCHEMA}`);
  if (!snapshot || !snapshot.cashTotalReturn) missing.push('verified USD 3-month T-bill/cash total-return index');
  if (!snapshot || !snapshot.acwiBenchmarkTotalReturn) missing.push('explicit verified ACWI USD total-return benchmark series');
  for (const key of MARKET_KEYS) {
    const market = snapshot && Array.isArray(snapshot.markets) && snapshot.markets.find(row => row.key === key);
    if (!market) { missing.push(`${key}: risky market series`); continue; }
    const prices = market.prices || {};
    if (prices.currency !== 'USD') missing.push(`${key}: USD total-return conversion (current ${prices.currency || 'undeclared'})`);
    if (prices.returnType !== 'total_return') missing.push(`${key}: explicit returnType=total_return`);
    if (!prices.methodology || !prices.source || !prices.retrievedAt) missing.push(`${key}: verified methodology/source/retrieval fields`);
  }
  return {
    status: missing.length ? 'DATA_REQUIRED' : 'CONTRACT_FIELDS_PRESENT_REQUIRES_VALIDATION',
    compatible: missing.length === 0,
    missing,
    forbiddenSubstitutions: ['^IRX yield', 'IEF or bond ETF cash proxy', 'zero cash', 'local-currency risky returns', 'price-only index'],
  };
}

function main(argv = process.argv.slice(2)) {
  assertProtocolFrozen();
  let mode = 'audit', file = DEFAULT_SCHEMA5;
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--input') { mode = 'input'; file = argv[++index]; }
    else if (argv[index] === '--audit') { mode = 'audit'; file = argv[++index]; }
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  const resolved = path.resolve(file);
  const bytes = fs.readFileSync(resolved);
  const payload = JSON.parse(bytes);
  const output = mode === 'input' ? analyzeInput(payload) : auditExistingSnapshot(payload);
  console.log(JSON.stringify({ ...output, inputFile: resolved, inputSha256: sha256(bytes), protocolSha256: PROTOCOL_SHA256 }, null, 2));
  return output;
}

module.exports = {
  PROTOCOL_PATH, PROTOCOL_SHA256, DEFAULT_SCHEMA5, INPUT_SCHEMA, INPUT_STATUS,
  MARKET_KEYS, MAX_REFERENCE_STALE_DAYS, PRIMARY_COST, STRESS_COST,
  assertProtocolFrozen, anniversary12, validateSeries, validateInput,
  strictCommonRows, lastIndexOnOrBefore, signalAt, buildMonthlySignals,
  validateWeights, exactRebalance, maximumDrawdown, summarize, simulate,
  analyzeAtCost, analyzeInput, auditExistingSnapshot, main,
};

if (require.main === module) {
  try { main(); } catch (error) { console.error(error && error.stack || error); process.exitCode = 1; }
}
