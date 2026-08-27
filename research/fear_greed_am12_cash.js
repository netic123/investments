'use strict';

// Exact, research-only AM12-CASH replication. No network and no production writes.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const PROTOCOL_PATH = path.join(__dirname, 'AM12_CASH_REPLICATION_PROTOCOL.md');
const PROTOCOL_SHA256 = 'a1e6a3039501f87488e981c3c29a658207cdd1ca301d3a8ee7cad3c7753a42d2';
const DEFAULT_SCHEMA5 = path.join(__dirname, 'local-artifacts', 'v2-validation-final', 'inputs', 'fear-greed-v2-validation-input-2026-08-25T12-44-22Z.json');
const MARKET_KEYS = Object.freeze(['crypto', 'sweden', 'usa', 'europe', 'global']);
const INPUT_SCHEMA = 'am12-cash-input-v1';
const INPUT_STATUS = 'RETROSPECTIVE_DEVELOPMENT_ONLY';
const MAX_STALE_DAYS = 7;
const PRIMARY_COST = 0.002;
const STRESS_COST = 0.004;
const DAY_COUNT = 365.2425;

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function isoMs(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`invalid ISO date: ${date}`);
  const value = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error(`invalid ISO date: ${date}`);
  return value;
}
function daysBetween(first, last) { return (isoMs(last) - isoMs(first)) / 86400000; }

function assertProtocolFrozen() {
  const bytes = fs.readFileSync(PROTOCOL_PATH);
  const digest = sha256(bytes);
  const text = bytes.toString('utf8');
  if (digest !== PROTOCOL_SHA256 || !text.includes('FROZEN_AM12_CASH_V1')) {
    throw new Error(`AM12-CASH protocol identity drifted: ${digest}`);
  }
  return digest;
}

function anniversary12(date) {
  const source = new Date(`${date}T00:00:00.000Z`);
  isoMs(date);
  const year = source.getUTCFullYear() - 1;
  const month = source.getUTCMonth();
  const day = source.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(day, lastDay))).toISOString().slice(0, 10);
}

function requireText(value, context) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${context} is required`);
}

function validateSeries(series, context, expectedRole) {
  if (!series || typeof series !== 'object') throw new Error(`${context} is required`);
  requireText(series.id, `${context}.id`);
  if (series.currency !== 'USD') throw new Error(`${context}.currency must be USD`);
  if (series.returnType !== 'total_return') throw new Error(`${context}.returnType must be total_return`);
  if (series.role !== expectedRole) throw new Error(`${context}.role must be ${expectedRole}`);
  requireText(series.methodology, `${context}.methodology`);
  requireText(series.source, `${context}.source`);
  requireText(series.timezone, `${context}.timezone`);
  requireText(series.retrievedAt, `${context}.retrievedAt`);
  const retrieved = Date.parse(series.retrievedAt);
  if (!Number.isFinite(retrieved) || new Date(retrieved).toISOString() !== series.retrievedAt) throw new Error(`${context}.retrievedAt must be exact ISO UTC`);
  if (!Array.isArray(series.rows) || series.rows.length < 14) throw new Error(`${context}.rows needs at least 14 observations`);
  let prior = '';
  for (const row of series.rows) {
    if (!row || (prior && row.date <= prior) || !(Number(row.value) > 0)) throw new Error(`${context}.rows must be strictly ordered positive total-return values`);
    isoMs(row.date);
    prior = row.date;
  }
  if (expectedRole === 'usd_3m_tbill_cash_total_return' && /\^IRX|IEF/i.test(`${series.id} ${series.methodology}`)) {
    throw new Error(`${context} cannot use a quoted yield or bond ETF as cash total return`);
  }
  return series;
}

function validateInput(input) {
  assertProtocolFrozen();
  if (!input || input.schema !== INPUT_SCHEMA) throw new Error(`input.schema must be ${INPUT_SCHEMA}`);
  if (input.status !== INPUT_STATUS) throw new Error(`input.status must be ${INPUT_STATUS}`);
  validateSeries(input.cashTotalReturn, 'cashTotalReturn', 'usd_3m_tbill_cash_total_return');
  if (!Array.isArray(input.markets) || input.markets.map(row => row.key).join(',') !== MARKET_KEYS.join(',')) {
    throw new Error(`markets must be exactly ${MARKET_KEYS.join(',')} in that order`);
  }
  for (const market of input.markets) {
    requireText(market.name, `${market.key}.name`);
    validateSeries(market.riskTotalReturn, `${market.key}.riskTotalReturn`, 'risky_market_total_return');
  }
  return input;
}

function lastIndexOnOrBefore(rows, date) {
  let low = 0, high = rows.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (rows[middle].date <= date) { found = middle; low = middle + 1; } else high = middle - 1;
  }
  return found;
}

function asOf(rows, date) {
  const index = lastIndexOnOrBefore(rows, date);
  if (index < 0 || daysBetween(rows[index].date, date) > MAX_STALE_DAYS) return null;
  return { ...rows[index], index, staleDays: daysBetween(rows[index].date, date) };
}

function signalAt(riskRows, cashRows, index) {
  const end = riskRows[index];
  const anniversary = anniversary12(end.date);
  const referenceIndex = lastIndexOnOrBefore(riskRows, anniversary);
  if (referenceIndex < 0 || daysBetween(riskRows[referenceIndex].date, anniversary) > MAX_STALE_DAYS) return null;
  const reference = riskRows[referenceIndex];
  const cashEnd = asOf(cashRows, end.date);
  const cashReference = asOf(cashRows, reference.date);
  if (!cashEnd || !cashReference || !riskRows[index + 1]) return null;
  const riskyReturn = end.value / reference.value - 1;
  const cashReturn = cashEnd.value / cashReference.value - 1;
  return {
    signalDate: end.date,
    anniversaryDate: anniversary,
    referenceDate: reference.date,
    executionDate: riskRows[index + 1].date,
    riskyReturn12m: riskyReturn,
    cashReturn12m: cashReturn,
    excessReturn12m: riskyReturn - cashReturn,
    target: riskyReturn > cashReturn ? 'risk' : 'cash',
  };
}

function buildMonthlySignals(riskRows, cashRows) {
  const months = new Map();
  for (let index = 0; index < riskRows.length; index++) {
    const month = riskRows[index].date.slice(0, 7);
    if (!months.has(month)) months.set(month, []);
    months.get(month).push(index);
  }
  const signals = [];
  for (const indices of months.values()) {
    for (let cursor = indices.length - 1; cursor >= 0; cursor--) {
      const signal = signalAt(riskRows, cashRows, indices[cursor]);
      if (signal) { signals.push(signal); break; }
    }
  }
  return signals;
}

function alignedCashMap(riskRows, cashRows) {
  const map = new Map();
  for (const row of riskRows) {
    const cash = asOf(cashRows, row.date);
    if (!cash) throw new Error(`cash total return unavailable within ${MAX_STALE_DAYS} days at ${row.date}`);
    map.set(row.date, cash.value);
  }
  return map;
}

function maximumDrawdown(curve) {
  let peak = -Infinity, worst = 0;
  for (const row of curve) { peak = Math.max(peak, row.wealth); worst = Math.min(worst, row.wealth / peak - 1); }
  return worst;
}

function summarize(curve, changes) {
  const years = daysBetween(curve[0].date, curve.at(-1).date) / DAY_COUNT;
  const terminalWealth = curve.at(-1).wealth;
  return {
    startDate: curve[0].date,
    endDate: curve.at(-1).date,
    intervals: curve.length - 1,
    terminalWealth,
    annualizedLogReturn: years > 0 && terminalWealth > 0 ? Math.log(terminalWealth) / years : null,
    maximumDrawdown: maximumDrawdown(curve),
    allocationChanges: changes,
  };
}

function latestTarget(signals, date) {
  let target = null;
  for (const signal of signals) {
    if (signal.executionDate > date) break;
    target = signal.target;
  }
  return target;
}

function simulateWindow(riskRows, cashMap, signals, cost) {
  if (riskRows.length < 2) throw new Error('window requires at least two risky closes');
  let target = latestTarget(signals, riskRows[0].date);
  if (!target) throw new Error(`no executable signal at window start ${riskRows[0].date}`);
  let wealth = target === 'risk' ? 1 - cost : 1;
  let changes = target === 'risk' ? 1 : 0;
  const curve = [{ date: riskRows[0].date, wealth }];
  const executionMap = new Map(signals.map(signal => [signal.executionDate, signal.target]));
  for (let index = 1; index < riskRows.length; index++) {
    const start = riskRows[index - 1], end = riskRows[index];
    wealth *= target === 'risk'
      ? end.value / start.value
      : cashMap.get(end.date) / cashMap.get(start.date);
    const next = executionMap.get(end.date);
    if (next && next !== target) { wealth *= 1 - cost; changes++; target = next; }
    curve.push({ date: end.date, wealth });
  }
  if (target === 'risk') { wealth *= 1 - cost; changes++; curve[curve.length - 1] = { date: riskRows.at(-1).date, wealth }; }
  return { ...summarize(curve, changes), finalPositionAfterLiquidation: 'cash', curve };
}

function benchmarkWindow(riskRows, cost) {
  let wealth = 1 - cost;
  const curve = [{ date: riskRows[0].date, wealth }];
  for (let index = 1; index < riskRows.length; index++) {
    wealth *= riskRows[index].value / riskRows[index - 1].value;
    curve.push({ date: riskRows[index].date, wealth });
  }
  wealth *= 1 - cost;
  curve[curve.length - 1] = { date: riskRows.at(-1).date, wealth };
  return { ...summarize(curve, 2), curve };
}

function compareWindow(riskRows, cashMap, signals, cost) {
  const strategy = simulateWindow(riskRows, cashMap, signals, cost);
  const buyAndHold = benchmarkWindow(riskRows, cost);
  return {
    cost,
    strategy,
    buyAndHold,
    terminalWealthDifference: strategy.terminalWealth - buyAndHold.terminalWealth,
    annualizedLogReturnDifference: strategy.annualizedLogReturn - buyAndHold.annualizedLogReturn,
    maximumDrawdownDifference: strategy.maximumDrawdown - buyAndHold.maximumDrawdown,
  };
}

function splitHalves(rows) {
  const intervals = rows.length - 1;
  const seam = Math.floor(intervals / 2);
  if (seam < 1 || intervals - seam < 1) throw new Error('both halves need an interval');
  return [rows.slice(0, seam + 1), rows.slice(seam)];
}

function stripCurves(value) {
  if (Array.isArray(value)) return value.map(stripCurves);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'curve').map(([key, nested]) => [key, stripCurves(nested)]));
  }
  return value;
}

function prepareMarket(market, cashSeries) {
  const risk = market.riskTotalReturn.rows;
  const signals = buildMonthlySignals(risk, cashSeries.rows);
  if (!signals.length) throw new Error(`${market.key}: no valid 12-calendar-month signal`);
  const startIndex = risk.findIndex(row => row.date === signals[0].executionDate);
  const rows = risk.slice(startIndex);
  const cashMap = alignedCashMap(rows, cashSeries.rows);
  return { market, signals, rows, cashMap };
}

function commonCalendar(preparedMarkets, cost) {
  const dateCounts = new Map();
  for (const prepared of preparedMarkets) {
    for (const row of prepared.rows) dateCounts.set(row.date, (dateCounts.get(row.date) || 0) + 1);
  }
  const commonDates = [...dateCounts.entries()].filter(([, count]) => count === preparedMarkets.length).map(([date]) => date).sort();
  if (commonDates.length < 2) return { available: false, reason: 'fewer than two exact common risky close dates' };
  const startDate = commonDates[0], endDate = commonDates.at(-1);
  const runs = preparedMarkets.map(prepared => {
    const rows = prepared.rows.filter(row => row.date >= startDate && row.date <= endDate);
    return {
      key: prepared.market.key,
      strategy: simulateWindow(rows, prepared.cashMap, prepared.signals, cost),
      buyAndHold: benchmarkWindow(rows, cost),
    };
  });
  const aggregate = key => commonDates.map(date => ({
    date,
    wealth: mean(runs.map(run => {
      const row = run[key].curve.find(item => item.date === date);
      if (!row) throw new Error(`${run.key}: common date ${date} missing from ${key} curve`);
      return row.wealth;
    })),
  }));
  const strategyCurve = aggregate('strategy');
  const benchmarkCurve = aggregate('buyAndHold');
  const strategy = summarize(strategyCurve, null);
  const buyAndHold = summarize(benchmarkCurve, null);
  return {
    available: true,
    cost,
    startDate,
    endDate,
    commonDateCount: commonDates.length,
    strategy,
    buyAndHold,
    terminalWealthDifference: strategy.terminalWealth - buyAndHold.terminalWealth,
    annualizedLogReturnDifference: strategy.annualizedLogReturn - buyAndHold.annualizedLogReturn,
    maximumDrawdownDifference: strategy.maximumDrawdown - buyAndHold.maximumDrawdown,
  };
}

function analyzeInput(input) {
  validateInput(input);
  const markets = {};
  const preparedMarkets = [];
  for (const market of input.markets) {
    const prepared = prepareMarket(market, input.cashTotalReturn);
    preparedMarkets.push(prepared);
    const halves = splitHalves(prepared.rows);
    const analyzeCost = cost => ({
      full: compareWindow(prepared.rows, prepared.cashMap, prepared.signals, cost),
      halves: halves.map((rows, index) => ({ half: index + 1, ...compareWindow(rows, prepared.cashMap, prepared.signals, cost) })),
    });
    markets[market.key] = {
      riskSeriesId: market.riskTotalReturn.id,
      signalCount: prepared.signals.length,
      firstSignalDate: prepared.signals[0].signalDate,
      firstExecutionDate: prepared.signals[0].executionDate,
      lastSignalDate: prepared.signals.at(-1).signalDate,
      primary: stripCurves(analyzeCost(PRIMARY_COST)),
      doubleCostStress: stripCurves(analyzeCost(STRESS_COST)),
    };
  }
  return {
    status: 'RETROSPECTIVE_DEVELOPMENT_ONLY_NOT_CONFIRMATORY',
    rule: 'AM12-CASH_V1',
    protocolSha256: assertProtocolFrozen(),
    inputSchema: input.schema,
    costs: { primary: PRIMARY_COST, doubleCostStress: STRESS_COST },
    markets,
    commonCalendar: {
      primary: commonCalendar(preparedMarkets, PRIMARY_COST),
      doubleCostStress: commonCalendar(preparedMarkets, STRESS_COST),
    },
    warning: 'Historical replication only; no production approval and no Fear & Greed validation.',
  };
}

function auditSchema5(snapshot) {
  const missing = [];
  if (!snapshot || snapshot.schema !== INPUT_SCHEMA) missing.push(`top-level schema ${INPUT_SCHEMA}`);
  if (!snapshot || !snapshot.cashTotalReturn) missing.push('USD 3-month T-bill/cash total-return wealth index');
  for (const key of MARKET_KEYS) {
    const market = snapshot && Array.isArray(snapshot.markets) && snapshot.markets.find(row => row.key === key);
    if (!market) { missing.push(`${key}: market`); continue; }
    const prices = market.prices || {};
    if (prices.currency !== 'USD') missing.push(`${key}: USD-converted risky total-return series (current currency ${prices.currency || 'undeclared'})`);
    if (prices.returnType !== 'total_return') missing.push(`${key}: explicit returnType=total_return`);
    if (!prices.methodology || !prices.source || !prices.retrievedAt) missing.push(`${key}: required total-return provenance fields`);
  }
  return {
    status: missing.length ? 'AM12_CASH_INPUT_REQUIRED' : 'CONTRACT_FIELDS_PRESENT_REQUIRES_FULL_VALIDATION',
    compatible: missing.length === 0,
    missing,
    forbiddenSubstitutions: ['quoted T-bill yield such as ^IRX', 'IEF or another bond ETF', 'zero cash return', 'local-currency risky return'],
  };
}

function parseArgs(argv) {
  const args = { input: null, auditSchema5: null };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--input') args.input = argv[++index];
    else if (argv[index] === '--audit-schema5') args.auditSchema5 = argv[++index];
    else throw new Error(`unknown argument ${argv[index]}`);
  }
  if (args.input && args.auditSchema5) throw new Error('choose --input or --audit-schema5');
  return args;
}

function main(argv = process.argv.slice(2)) {
  assertProtocolFrozen();
  const args = parseArgs(argv);
  if (args.input) {
    const file = path.resolve(args.input);
    const bytes = fs.readFileSync(file);
    const results = analyzeInput(JSON.parse(bytes));
    console.log(JSON.stringify({ ...results, inputFile: file, inputSha256: sha256(bytes) }, null, 2));
    return results;
  }
  const file = path.resolve(args.auditSchema5 || DEFAULT_SCHEMA5);
  const bytes = fs.readFileSync(file);
  const audit = auditSchema5(JSON.parse(bytes));
  console.log(JSON.stringify({ ...audit, auditedFile: file, auditedSha256: sha256(bytes), protocolSha256: PROTOCOL_SHA256 }, null, 2));
  return audit;
}

module.exports = {
  PROTOCOL_PATH, PROTOCOL_SHA256, DEFAULT_SCHEMA5, MARKET_KEYS, INPUT_SCHEMA,
  INPUT_STATUS, MAX_STALE_DAYS, PRIMARY_COST, STRESS_COST, assertProtocolFrozen,
  anniversary12, validateSeries, validateInput, lastIndexOnOrBefore, asOf,
  signalAt, buildMonthlySignals, alignedCashMap, maximumDrawdown, latestTarget,
  simulateWindow, benchmarkWindow, compareWindow, splitHalves, prepareMarket,
  commonCalendar, analyzeInput, auditSchema5, parseArgs, main,
};

if (require.main === module) {
  try { main(); } catch (error) { console.error(error && error.stack || error); process.exitCode = 1; }
}
