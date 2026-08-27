'use strict';

// Research-only long equity-panel falsification runner. No production writes.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PROTOCOL_PATH = path.join(__dirname, 'EQUITY_ROTATION_FALSIFICATION_PROTOCOL.md');
const PROTOCOL_SHA256 = '95cd9a01824efb5a2ecf1361e36bead4c08c3fc241a9f44cc284bf89af7fe206';
const INPUT_SCHEMA = 'equity-rotation-panel-input-v1';
const INPUT_STATUS = 'RETROSPECTIVE_DEVELOPMENT_PROXY_ONLY';
const RESULT_STATUS = 'RETROSPECTIVE_FALSIFICATION_ONLY_NOT_CONFIRMATORY';
const MAX_STALE_DAYS = 7;
const DAY_COUNT = 365.2425;
const PRIMARY_COST = 0.002;
const STRESS_COST = 0.004;
const FRED_START = '2008-01-01';

const ASSETS = Object.freeze([
  Object.freeze({
    key: 'sweden', ticker: 'EWD', name: 'iShares MSCI Sweden ETF',
    officialInception: '1996-03-12', officialBenchmark: 'MSCI Sweden 25/50 Index',
    officialUrl: 'https://www.ishares.com/us/products/239684/ishares-msci-sweden-etf',
  }),
  Object.freeze({
    key: 'usa', ticker: 'IYY', name: 'iShares Dow Jones U.S. ETF',
    officialInception: '2000-06-12', officialBenchmark: 'Dow Jones U.S. Index',
    officialUrl: 'https://www.ishares.com/us/products/239513/ishares-dow-jones-us-etf',
  }),
  Object.freeze({
    key: 'europe', ticker: 'IEV', name: 'iShares Europe ETF',
    officialInception: '2000-07-25', officialBenchmark: 'S&P Europe 350 Index (Net)',
    officialUrl: 'https://www.ishares.com/us/products/239736/ishares-europe-etf',
  }),
  Object.freeze({
    key: 'global', ticker: 'ACWI', name: 'iShares MSCI ACWI ETF',
    officialInception: '2008-03-26', officialBenchmark: 'MSCI All Country World Index (Net)',
    officialUrl: 'https://www.ishares.com/us/products/239600/ishares-msci-acwi-etf',
  }),
]);
const ASSET_KEYS = Object.freeze(ASSETS.map(asset => asset.key));

class DataRequiredError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DataRequiredError';
    this.code = 'DATA_REQUIRED';
    this.details = details;
  }
}

function sha256(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function sampleStd(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}
function dateMs(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`invalid ISO date ${date}`);
  const value = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error(`invalid ISO date ${date}`);
  return value;
}
function days(first, last) { return (dateMs(last) - dateMs(first)) / 86400000; }
function isoDate(value) { return new Date(value).toISOString().slice(0, 10); }
function priorDate(date) { return isoDate(dateMs(date) - 86400000); }
function exactIsoUtc(value, context) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) throw new Error(`${context} must be exact ISO UTC`);
}
function requireText(value, context) { if (typeof value !== 'string' || !value.trim()) throw new Error(`${context} is required`); }

function assertProtocolFrozen() {
  const bytes = fs.readFileSync(PROTOCOL_PATH);
  const digest = sha256(bytes);
  if (digest !== PROTOCOL_SHA256 || !bytes.toString('utf8').includes('FROZEN_EQUITY_ROTATION_PANEL_V1')) {
    throw new Error(`equity rotation protocol drifted: ${digest}`);
  }
  return digest;
}

function anniversary12(date) {
  dateMs(date);
  const source = new Date(`${date}T00:00:00.000Z`);
  const year = source.getUTCFullYear() - 1;
  const month = source.getUTCMonth();
  const day = Math.min(source.getUTCDate(), new Date(Date.UTC(year, month + 1, 0)).getUTCDate());
  return isoDate(Date.UTC(year, month, day));
}

function yahooUrl(ticker, cutoffExclusive) {
  const period1 = Math.floor(Date.parse('1995-01-01T00:00:00.000Z') / 1000);
  const period2 = Math.floor(dateMs(cutoffExclusive) / 1000);
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;
}

function fredUrl(asOfDate) {
  return `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTB3&cosd=${FRED_START}&coed=${asOfDate}`;
}

async function fetchBytes(url, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new DataRequiredError('Fetch implementation is unavailable', { url });
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/json,text/csv,text/plain,*/*',
        'user-agent': 'investments-equity-rotation-research/1.0',
      },
    });
  } catch (error) {
    throw new DataRequiredError(`Source fetch failed: ${url}`, { cause: error.message, url });
  }
  if (!response || !response.ok) throw new DataRequiredError(`Source returned HTTP ${response && response.status}: ${url}`, { url, status: response && response.status });
  try {
    return Buffer.from(await response.arrayBuffer());
  } catch (error) {
    throw new DataRequiredError(`Source payload could not be read: ${url}`, { cause: error.message, url });
  }
}

function parseYahooPayload(bytes, asset, cutoffExclusive) {
  let payload;
  try { payload = JSON.parse(Buffer.from(bytes).toString('utf8')); }
  catch (error) { throw new DataRequiredError(`${asset.ticker}: Yahoo payload is not JSON`, { cause: error.message }); }
  const chart = payload && payload.chart;
  if (!chart || chart.error || !Array.isArray(chart.result) || chart.result.length !== 1) {
    throw new DataRequiredError(`${asset.ticker}: Yahoo chart result unavailable`, { error: chart && chart.error });
  }
  const result = chart.result[0];
  const timestamps = result.timestamp;
  const adjusted = result.indicators && result.indicators.adjclose && result.indicators.adjclose[0] && result.indicators.adjclose[0].adjclose;
  if (!Array.isArray(timestamps) || !Array.isArray(adjusted) || timestamps.length !== adjusted.length) {
    throw new DataRequiredError(`${asset.ticker}: Yahoo adjusted-close arrays are missing or inconsistent`);
  }
  if (result.meta && result.meta.currency !== 'USD') throw new DataRequiredError(`${asset.ticker}: Yahoo currency is ${result.meta.currency}, expected USD`);
  const byDate = new Map();
  for (let index = 0; index < timestamps.length; index++) {
    const date = isoDate(Number(timestamps[index]) * 1000);
    const value = Number(adjusted[index]);
    if (date < cutoffExclusive && Number.isFinite(value) && value > 0) byDate.set(date, value);
  }
  const rows = [...byDate].sort(([left], [right]) => left.localeCompare(right)).map(([date, value]) => ({ date, value }));
  if (rows.length < 3000) throw new DataRequiredError(`${asset.ticker}: only ${rows.length} valid completed adjusted closes`);
  return {
    key: asset.key,
    ticker: asset.ticker,
    name: asset.name,
    currency: 'USD',
    returnType: 'yahoo_adjusted_close_market_price_total_return_proxy',
    methodology: 'Yahoo adjusted close; split and dividend-distribution adjusted; current-vintage USD market-price proxy',
    officialIdentity: {
      issuer: 'iShares / BlackRock',
      inception: asset.officialInception,
      benchmark: asset.officialBenchmark,
      url: asset.officialUrl,
      manuallyCrossCheckedAt: '2026-08-25',
    },
    yahooMeta: {
      symbol: result.meta && result.meta.symbol,
      currency: result.meta && result.meta.currency,
      exchangeName: result.meta && result.meta.exchangeName,
      instrumentType: result.meta && result.meta.instrumentType,
      exchangeTimezoneName: result.meta && result.meta.exchangeTimezoneName,
      dataGranularity: result.meta && result.meta.dataGranularity,
    },
    rows,
  };
}

function parseFredCsv(bytes, asOfDate) {
  const lines = Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (lines.length < 2) throw new DataRequiredError('FRED DTB3 CSV has no observations');
  const header = lines[0].split(',').map(value => value.trim().toUpperCase());
  const dateIndex = header.indexOf('DATE') >= 0 ? header.indexOf('DATE') : header.indexOf('OBSERVATION_DATE');
  const valueIndex = header.indexOf('DTB3');
  if (dateIndex < 0 || valueIndex < 0) throw new DataRequiredError(`FRED DTB3 CSV header is unexpected: ${lines[0]}`);
  const byDate = new Map();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const columns = line.split(',');
    const date = columns[dateIndex] && columns[dateIndex].trim();
    const percent = Number(columns[valueIndex]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && date <= asOfDate && Number.isFinite(percent)) byDate.set(date, percent);
  }
  const rows = [...byDate].sort(([left], [right]) => left.localeCompare(right)).map(([date, percent]) => ({ date, percent }));
  if (rows.length < 3000) throw new DataRequiredError(`FRED DTB3 has only ${rows.length} valid daily observations`);
  return rows;
}

async function fetchResearchInput({ asOfDate, fetchImpl = globalThis.fetch, retrievedAt = new Date().toISOString() } = {}) {
  assertProtocolFrozen();
  dateMs(asOfDate);
  exactIsoUtc(retrievedAt, 'retrievedAt');
  const cutoffExclusive = isoDate(dateMs(asOfDate) + 86400000);
  const equitySources = [];
  for (const asset of ASSETS) {
    const sourceUrl = yahooUrl(asset.ticker, cutoffExclusive);
    const bytes = await fetchBytes(sourceUrl, fetchImpl);
    equitySources.push({
      ...parseYahooPayload(bytes, asset, cutoffExclusive),
      sourceUrl,
      rawPayloadSha256: sha256(bytes),
      retrievedAt,
    });
  }
  const dtb3SourceUrl = fredUrl(asOfDate);
  const dtb3Bytes = await fetchBytes(dtb3SourceUrl, fetchImpl);
  const input = {
    schema: INPUT_SCHEMA,
    status: INPUT_STATUS,
    asOfDate,
    cutoffExclusive,
    retrievedAt,
    protocolSha256: PROTOCOL_SHA256,
    sourceBoundary: {
      authoritativeFundIdentityCrossCheck: 'official iShares product pages listed per asset',
      equityHistory: 'current-vintage Yahoo adjusted close proxy; not an authoritative/licensed index dataset',
      yahooAdjustedCloseDefinition: 'https://help.yahoo.com/kb/SLN28256.html',
      cashHistory: 'FRED DTB3 observed discount yields; reconstructed wealth proxy, not an official total-return index',
    },
    equities: equitySources,
    dtb3: {
      id: 'DTB3',
      role: 'usd_3m_tbill_91_day_accrual_proxy_input',
      units: 'percent_bank_discount_basis',
      source: 'Board of Governors of the Federal Reserve System (US), via FRED',
      officialUrl: 'https://fred.stlouisfed.org/series/DTB3',
      sourceUrl: dtb3SourceUrl,
      retrievedAt,
      rawPayloadSha256: sha256(dtb3Bytes),
      rows: parseFredCsv(dtb3Bytes, asOfDate),
    },
  };
  validateInput(input);
  return input;
}

function validateOrderedRows(rows, context, valueField, minimum) {
  if (!Array.isArray(rows) || rows.length < minimum) throw new Error(`${context} requires at least ${minimum} rows`);
  let previous = '';
  for (const row of rows) {
    if (!row || (previous && row.date <= previous)) throw new Error(`${context} must be strictly date ordered`);
    dateMs(row.date);
    if (!Number.isFinite(Number(row[valueField])) || (valueField === 'value' && !(Number(row[valueField]) > 0))) throw new Error(`${context}.${valueField} is invalid at ${row.date}`);
    previous = row.date;
  }
}

function validateInput(input) {
  assertProtocolFrozen();
  if (!input || input.schema !== INPUT_SCHEMA) throw new Error(`input.schema must be ${INPUT_SCHEMA}`);
  if (input.status !== INPUT_STATUS) throw new Error(`input.status must be ${INPUT_STATUS}`);
  dateMs(input.asOfDate);
  dateMs(input.cutoffExclusive);
  if (input.cutoffExclusive !== isoDate(dateMs(input.asOfDate) + 86400000)) throw new Error('cutoffExclusive must be the day after asOfDate');
  exactIsoUtc(input.retrievedAt, 'input.retrievedAt');
  if (input.protocolSha256 !== PROTOCOL_SHA256) throw new Error('input protocol hash mismatch');
  if (!Array.isArray(input.equities) || input.equities.map(item => item.key).join(',') !== ASSET_KEYS.join(',')) throw new Error(`equities must be ${ASSET_KEYS.join(',')} in order`);
  for (let index = 0; index < ASSETS.length; index++) {
    const expected = ASSETS[index];
    const series = input.equities[index];
    if (series.ticker !== expected.ticker || series.currency !== 'USD') throw new Error(`${expected.key}: ticker/currency identity mismatch`);
    if (series.returnType !== 'yahoo_adjusted_close_market_price_total_return_proxy') throw new Error(`${expected.key}: returnType must remain explicitly proxy-labeled`);
    requireText(series.methodology, `${expected.key}.methodology`);
    requireText(series.sourceUrl, `${expected.key}.sourceUrl`);
    requireText(series.rawPayloadSha256, `${expected.key}.rawPayloadSha256`);
    exactIsoUtc(series.retrievedAt, `${expected.key}.retrievedAt`);
    if (!series.officialIdentity || series.officialIdentity.url !== expected.officialUrl) throw new Error(`${expected.key}: official identity URL mismatch`);
    validateOrderedRows(series.rows, `${expected.key}.rows`, 'value', 3000);
    if (series.rows.at(-1).date >= input.cutoffExclusive) throw new Error(`${expected.key}: contains incomplete cutoff date`);
  }
  if (!input.dtb3 || input.dtb3.id !== 'DTB3' || input.dtb3.units !== 'percent_bank_discount_basis') throw new Error('DTB3 source identity/units mismatch');
  requireText(input.dtb3.rawPayloadSha256, 'dtb3.rawPayloadSha256');
  exactIsoUtc(input.dtb3.retrievedAt, 'dtb3.retrievedAt');
  validateOrderedRows(input.dtb3.rows, 'dtb3.rows', 'percent', 3000);
  return input;
}

function strictCommonEquityRows(input) {
  validateInput(input);
  const maps = input.equities.map(series => new Map(series.rows.map(row => [row.date, Number(row.value)])));
  const dates = input.equities[0].rows.map(row => row.date).filter(date => maps.every(map => map.has(date)));
  if (!dates.length) throw new DataRequiredError('No strict-common ETF adjusted-close dates');
  if (days('2008-03-26', dates[0]) < 0 || days('2008-03-26', dates[0]) > MAX_STALE_DAYS) {
    throw new DataRequiredError(`Strict-common history begins ${dates[0]}, not within seven days after ACWI inception`);
  }
  if (days(dates[0], dates.at(-1)) / DAY_COUNT < 15) throw new DataRequiredError('Strict-common ETF history is shorter than 15 years');
  const bases = maps.map(map => map.get(dates[0]));
  return dates.map(date => ({
    date,
    assets: Object.fromEntries(ASSET_KEYS.map((key, index) => [key, maps[index].get(date) / bases[index]])),
  }));
}

function lastIndexOnOrBefore(rows, date, field = 'date') {
  let low = 0, high = rows.length - 1, found = -1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (rows[middle][field] <= date) { found = middle; low = middle + 1; } else high = middle - 1;
  }
  return found;
}

function discountDailyFactor(percent) {
  const discount = Number(percent) / 100;
  const price = 1 - discount * 91 / 360;
  if (!(price > 0) || !Number.isFinite(price)) throw new DataRequiredError(`Invalid DTB3 discount rate ${percent}`);
  return (1 / price) ** (1 / 91);
}

function buildCashRows(commonRows, dtb3Rows) {
  const firstDate = commonRows[0].date;
  let rateIndex = lastIndexOnOrBefore(dtb3Rows, firstDate);
  if (rateIndex < 0 || days(dtb3Rows[rateIndex].date, firstDate) > MAX_STALE_DAYS) throw new DataRequiredError(`DTB3 unavailable within ${MAX_STALE_DAYS} days at ${firstDate}`);
  let wealth = 1;
  const output = [{ date: firstDate, value: wealth }];
  for (let rowIndex = 1; rowIndex < commonRows.length; rowIndex++) {
    let cursor = dateMs(commonRows[rowIndex - 1].date);
    const end = dateMs(commonRows[rowIndex].date);
    while (cursor < end) {
      while (dtb3Rows[rateIndex + 1] && dateMs(dtb3Rows[rateIndex + 1].date) <= cursor) rateIndex++;
      const rate = dtb3Rows[rateIndex];
      const nextObservation = dtb3Rows[rateIndex + 1] ? dateMs(dtb3Rows[rateIndex + 1].date) : Infinity;
      const segmentEnd = Math.min(end, nextObservation);
      if (days(rate.date, isoDate(segmentEnd)) > MAX_STALE_DAYS) throw new DataRequiredError(`DTB3 observation ${rate.date} becomes too stale by ${isoDate(segmentEnd)}`);
      const calendarDays = (segmentEnd - cursor) / 86400000;
      wealth *= discountDailyFactor(rate.percent) ** calendarDays;
      cursor = segmentEnd;
    }
    output.push({ date: commonRows[rowIndex].date, value: wealth });
  }
  return output;
}

function mergeCash(commonRows, cashRows) {
  if (commonRows.length !== cashRows.length) throw new Error('cash/equity calendar lengths differ');
  return commonRows.map((row, index) => {
    if (row.date !== cashRows[index].date) throw new Error(`cash/equity calendar mismatch at ${row.date}`);
    return { ...row, cash: cashRows[index].value };
  });
}

function signalAt(rows, index) {
  if (!rows[index + 1]) return null;
  const signal = rows[index];
  const anniversaryDate = anniversary12(signal.date);
  const referenceIndex = lastIndexOnOrBefore(rows, anniversaryDate);
  if (referenceIndex < 0 || days(rows[referenceIndex].date, anniversaryDate) > MAX_STALE_DAYS) return null;
  const reference = rows[referenceIndex];
  const cashReturn12m = signal.cash / reference.cash - 1;
  const ranked = ASSET_KEYS.map((key, order) => ({ key, order, return12m: signal.assets[key] / reference.assets[key] - 1 }))
    .sort((left, right) => right.return12m - left.return12m || left.order - right.order);
  const top1Weights = ranked[0].return12m > cashReturn12m ? { [ranked[0].key]: 1 } : {};
  const top2Weights = {};
  for (const item of ranked.slice(0, 2)) if (item.return12m > cashReturn12m) top2Weights[item.key] = 0.5;
  return {
    signalDate: signal.date,
    anniversaryDate,
    referenceDate: reference.date,
    executionDate: rows[index + 1].date,
    cashReturn12m,
    ranking: ranked.map(({ key, return12m }) => ({ key, return12m })),
    top1Weights,
    top2Weights,
  };
}

function buildMonthlySignals(rows) {
  const finalIndexByMonth = new Map();
  rows.forEach((row, index) => finalIndexByMonth.set(row.date.slice(0, 7), index));
  return [...finalIndexByMonth.values()].map(index => signalAt(rows, index)).filter(Boolean);
}

function validateWeights(weights, keys) {
  const values = keys.map(key => Number((weights && weights[key]) || 0));
  const total = values.reduce((sum, value) => sum + value, 0);
  if (values.some(value => !Number.isFinite(value) || value < 0 || value > 1) || total > 1 + 1e-12) throw new Error('invalid long/cash target weights');
  return values;
}

function exactRebalance(wealth, preRisk, targetWeights, cost, keys) {
  if (!(wealth > 0) || !(cost >= 0 && cost < 1)) throw new Error('invalid rebalance inputs');
  const weights = validateWeights(targetWeights, keys);
  const notionals = keys.map(key => Number(preRisk[key] || 0));
  const equation = postWealth => postWealth + cost * weights.reduce((sum, weight, index) => sum + Math.abs(weight * postWealth - notionals[index]), 0) - wealth;
  let low = 0, high = wealth;
  for (let iteration = 0; iteration < 120; iteration++) {
    const midpoint = (low + high) / 2;
    if (equation(midpoint) > 0) high = midpoint; else low = midpoint;
  }
  const postWealth = (low + high) / 2;
  const postRisk = Object.fromEntries(keys.map((key, index) => [key, weights[index] * postWealth]));
  const tradedNotional = keys.reduce((sum, key) => sum + Math.abs(postRisk[key] - Number(preRisk[key] || 0)), 0);
  const costAmount = cost * tradedNotional;
  const postCash = postWealth - Object.values(postRisk).reduce((sum, value) => sum + value, 0);
  if (Math.abs(wealth - postWealth - costAmount) > 1e-11 || postCash < -1e-11) throw new Error('rebalance accounting identity failed');
  return { postWealth, postRisk, postCash: Math.max(0, postCash), tradedNotional, costAmount };
}

function maximumDrawdown(curve) {
  let peak = 1;
  let worst = 0;
  for (const row of curve) {
    peak = Math.max(peak, row.wealth);
    worst = Math.min(worst, row.wealth / peak - 1);
  }
  return worst;
}

function summarize(curve, totalOneWayTurnover, tradeCount, totalModeledCostPaid) {
  const years = days(curve[0].date, curve.at(-1).date) / DAY_COUNT;
  const logReturns = [];
  for (let index = 1; index < curve.length; index++) logReturns.push(Math.log(curve[index].wealth / curve[index - 1].wealth));
  const terminalWealth = curve.at(-1).wealth;
  const annualizedLogReturn = years > 0 ? Math.log(terminalWealth) / years : null;
  return {
    startDate: curve[0].date,
    endDate: curve.at(-1).date,
    years,
    commonCloseObservations: curve.length,
    terminalWealth,
    cumulativeReturn: terminalWealth - 1,
    cagr: annualizedLogReturn === null ? null : Math.exp(annualizedLogReturn) - 1,
    annualizedLogReturn,
    annualizedVolatility: years > 0 && logReturns.length > 1 ? sampleStd(logReturns) * Math.sqrt(logReturns.length / years) : null,
    maximumDrawdown: maximumDrawdown(curve),
    totalOneWayTurnover,
    tradeCount,
    totalModeledCostPaid,
  };
}

function latestWeights(schedule, date) {
  let target = null;
  for (const item of schedule) {
    if (item.executionDate > date) break;
    target = item.weights;
  }
  return target;
}

function simulateWindow(allRows, schedule, cost, keys, startDate, endDate) {
  const rows = allRows.filter(row => row.date >= startDate && row.date <= endDate);
  if (rows.length < 2 || rows[0].date !== startDate || rows.at(-1).date !== endDate) throw new Error(`invalid simulation window ${startDate}..${endDate}`);
  const initialTarget = latestWeights(schedule, startDate);
  if (!initialTarget) throw new Error(`no target effective at ${startDate}`);
  const executionMap = new Map(schedule.map(item => [item.executionDate, item.weights]));
  let wealth = 1;
  let risk = Object.fromEntries(keys.map(key => [key, 0]));
  let cash = 1;
  let totalOneWayTurnover = 0;
  let tradeCount = 0;
  let totalModeledCostPaid = 0;
  let preTradeWealth = wealth;
  let fill = exactRebalance(wealth, risk, initialTarget, cost, keys);
  ({ postWealth: wealth, postRisk: risk, postCash: cash } = fill);
  if (fill.tradedNotional > 1e-14) {
    totalOneWayTurnover += fill.tradedNotional / preTradeWealth;
    totalModeledCostPaid += fill.costAmount;
    tradeCount++;
  }
  const curve = [{ date: rows[0].date, wealth }];
  for (let index = 1; index < rows.length; index++) {
    const start = rows[index - 1];
    const end = rows[index];
    for (const key of keys) risk[key] *= end.assets[key] / start.assets[key];
    cash *= end.cash / start.cash;
    wealth = cash + Object.values(risk).reduce((sum, value) => sum + value, 0);
    const target = end.date < endDate ? executionMap.get(end.date) : null;
    if (target) {
      preTradeWealth = wealth;
      fill = exactRebalance(wealth, risk, target, cost, keys);
      ({ postWealth: wealth, postRisk: risk, postCash: cash } = fill);
      if (fill.tradedNotional > 1e-14) {
        totalOneWayTurnover += fill.tradedNotional / preTradeWealth;
        totalModeledCostPaid += fill.costAmount;
        tradeCount++;
      }
    }
    curve.push({ date: end.date, wealth });
  }
  preTradeWealth = wealth;
  fill = exactRebalance(wealth, risk, {}, cost, keys);
  ({ postWealth: wealth, postRisk: risk, postCash: cash } = fill);
  if (fill.tradedNotional > 1e-14) {
    totalOneWayTurnover += fill.tradedNotional / preTradeWealth;
    totalModeledCostPaid += fill.costAmount;
    tradeCount++;
  }
  curve[curve.length - 1] = { date: endDate, wealth };
  return summarize(curve, totalOneWayTurnover, tradeCount, totalModeledCostPaid);
}

function schedules(signals) {
  const equalWeights = Object.fromEntries(ASSET_KEYS.map(key => [key, 0.25]));
  return {
    top1: signals.map(signal => ({ executionDate: signal.executionDate, weights: signal.top1Weights })),
    top2: signals.map(signal => ({ executionDate: signal.executionDate, weights: signal.top2Weights })),
    equalWeight: signals.map(signal => ({ executionDate: signal.executionDate, weights: equalWeights })),
  };
}

function windowDefinitions(rows, signals) {
  const startDate = signals[0].executionDate;
  const endDate = rows.at(-1).date;
  const midpointMs = dateMs(startDate) + (dateMs(endDate) - dateMs(startDate)) / 2;
  const splitSignal = signals.find(signal => dateMs(signal.executionDate) >= midpointMs && signal.executionDate > startDate && signal.executionDate < endDate);
  if (!splitSignal) throw new Error('no chronological half split execution date');
  const splitDate = splitSignal.executionDate;
  return [
    { key: 'full', startDate, endDate },
    { key: 'firstHalf', startDate, endDate: splitDate },
    { key: 'secondHalf', startDate: splitDate, endDate },
  ];
}

function analyzeWindow(rows, signalSchedules, cost, window) {
  const { startDate, endDate } = window;
  const strategies = {
    ROTATION_TOP1_CASH: simulateWindow(rows, signalSchedules.top1, cost, ASSET_KEYS, startDate, endDate),
    ROTATION_TOP2_SLOTS_CASH: simulateWindow(rows, signalSchedules.top2, cost, ASSET_KEYS, startDate, endDate),
  };
  const benchmarks = {
    ACWI_BUY_AND_HOLD: simulateWindow(rows, [{ executionDate: startDate, weights: { global: 1 } }], cost, ASSET_KEYS, startDate, endDate),
    MONTHLY_EQUAL_WEIGHT_4: simulateWindow(rows, signalSchedules.equalWeight, cost, ASSET_KEYS, startDate, endDate),
    EACH_ASSET_BUY_AND_HOLD: Object.fromEntries(ASSET_KEYS.map(key => [
      key,
      simulateWindow(rows, [{ executionDate: startDate, weights: { [key]: 1 } }], cost, ASSET_KEYS, startDate, endDate),
    ])),
  };
  const comparisonCagrs = {
    ACWI_BUY_AND_HOLD: benchmarks.ACWI_BUY_AND_HOLD.cagr,
    MONTHLY_EQUAL_WEIGHT_4: benchmarks.MONTHLY_EQUAL_WEIGHT_4.cagr,
    ...Object.fromEntries(ASSET_KEYS.map(key => [`BUY_AND_HOLD_${key.toUpperCase()}`, benchmarks.EACH_ASSET_BUY_AND_HOLD[key].cagr])),
  };
  const bestBenchmarkCagr = Math.max(...Object.values(comparisonCagrs));
  return {
    ...window,
    cost,
    strategies,
    benchmarks,
    cagrDifferenceVsBenchmarks: Object.fromEntries(Object.entries(strategies).map(([strategy, metrics]) => [
      strategy,
      Object.fromEntries(Object.entries(comparisonCagrs).map(([benchmark, cagr]) => [benchmark, metrics.cagr - cagr])),
    ])),
    bestBenchmarkCagr,
    top1BeatsEveryBenchmarkByCagr: strategies.ROTATION_TOP1_CASH.cagr > bestBenchmarkCagr,
    top2BeatsEveryBenchmarkByCagr: strategies.ROTATION_TOP2_SLOTS_CASH.cagr > bestBenchmarkCagr,
  };
}

function analyzeInput(input) {
  validateInput(input);
  const equityRows = strictCommonEquityRows(input);
  const cashRows = buildCashRows(equityRows, input.dtb3.rows);
  const rows = mergeCash(equityRows, cashRows);
  const signals = buildMonthlySignals(rows);
  if (signals.length < 100) throw new DataRequiredError(`Only ${signals.length} monthly 12-month signals`);
  const signalSchedules = schedules(signals);
  const definitions = windowDefinitions(rows, signals);
  const at20bp = Object.fromEntries(definitions.map(window => [window.key, analyzeWindow(rows, signalSchedules, PRIMARY_COST, window)]));
  const at40bp = Object.fromEntries(definitions.map(window => [window.key, analyzeWindow(rows, signalSchedules, STRESS_COST, window)]));
  const top1Pass20 = definitions.every(window => at20bp[window.key].top1BeatsEveryBenchmarkByCagr);
  const top1Pass40 = definitions.every(window => at40bp[window.key].top1BeatsEveryBenchmarkByCagr);
  const top2Pass20 = definitions.every(window => at20bp[window.key].top2BeatsEveryBenchmarkByCagr);
  const top2Pass40 = definitions.every(window => at40bp[window.key].top2BeatsEveryBenchmarkByCagr);
  return {
    schema: 'equity-rotation-panel-result-v1',
    status: RESULT_STATUS,
    protocolSha256: assertProtocolFrozen(),
    inputSha256: sha256(Buffer.from(JSON.stringify(input))),
    dataBoundary: {
      asOfDate: input.asOfDate,
      retrievedAt: input.retrievedAt,
      firstStrictCommonClose: rows[0].date,
      lastStrictCommonClose: rows.at(-1).date,
      strictCommonCloseCount: rows.length,
      strictCommonYears: days(rows[0].date, rows.at(-1).date) / DAY_COUNT,
      inputLabels: {
        equities: 'current-vintage Yahoo adjusted-close USD market-price total-return proxies',
        cash: 'reconstructed frictionless 91-day DTB3 accrual proxy',
      },
      rawPayloadSha256: Object.fromEntries([
        ...input.equities.map(series => [series.ticker, series.rawPayloadSha256]),
        ['DTB3', input.dtb3.rawPayloadSha256],
      ]),
    },
    signalCount: signals.length,
    firstSignal: signals[0],
    lastSignal: signals.at(-1),
    windows: definitions,
    results: { at20bp, at40bp },
    falsificationGate: {
      requirement: 'A rule must beat ACWI, monthly equal-weight and every constituent buy-and-hold by CAGR in full, first-half and second-half windows.',
      ROTATION_TOP1_CASH: { passesAt20bp: top1Pass20, passesAt40bp: top1Pass40 },
      ROTATION_TOP2_SLOTS_CASH: { passesAt20bp: top2Pass20, passesAt40bp: top2Pass40 },
      primaryIdeaSurvivesThisPanel: top1Pass20 && top1Pass40,
      caveat: 'Even a pass is retrospective hypothesis generation, not confirmation or evidence of future outperformance.',
    },
    warnings: [
      'Yahoo adjusted closes are current-vintage market-price proxies and can be revised.',
      'DTB3 is a discount yield; cash wealth is reconstructed and is not an official total-return index.',
      'Sweden, Europe and Global overlap; the four outcomes are not independent.',
      'Taxes, exact spreads, slippage, market impact, tracking error and ETF premium/discount are excluded.',
    ],
  };
}

function compactResult(result) {
  const compactWindow = window => ({
    startDate: window.startDate,
    endDate: window.endDate,
    cost: window.cost,
    strategies: window.strategies,
    benchmarks: window.benchmarks,
    cagrDifferenceVsBenchmarks: window.cagrDifferenceVsBenchmarks,
    bestBenchmarkCagr: window.bestBenchmarkCagr,
    top1BeatsEveryBenchmarkByCagr: window.top1BeatsEveryBenchmarkByCagr,
    top2BeatsEveryBenchmarkByCagr: window.top2BeatsEveryBenchmarkByCagr,
  });
  return {
    ...result,
    results: {
      at20bp: Object.fromEntries(Object.entries(result.results.at20bp).map(([key, value]) => [key, compactWindow(value)])),
      at40bp: Object.fromEntries(Object.entries(result.results.at40bp).map(([key, value]) => [key, compactWindow(value)])),
    },
  };
}

function parseArgs(argv) {
  const options = { mode: null, asOfDate: priorDate(isoDate(Date.now())), input: null, output: null };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--fetch') options.mode = 'fetch';
    else if (arg === '--input') { options.mode = 'input'; options.input = argv[++index]; }
    else if (arg === '--as-of') options.asOfDate = argv[++index];
    else if (arg === '--save-input') options.input = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!options.mode) throw new Error('Use --fetch or --input <file>');
  if (options.mode === 'input' && !options.input) throw new Error('--input requires a file');
  dateMs(options.asOfDate);
  return options;
}

async function main(argv = process.argv.slice(2)) {
  assertProtocolFrozen();
  const options = parseArgs(argv);
  let input;
  if (options.mode === 'fetch') {
    input = await fetchResearchInput({ asOfDate: options.asOfDate });
    if (options.input) {
      const inputPath = path.resolve(options.input);
      fs.mkdirSync(path.dirname(inputPath), { recursive: true });
      fs.writeFileSync(inputPath, `${JSON.stringify(input, null, 2)}\n`);
    }
  } else {
    const bytes = fs.readFileSync(path.resolve(options.input));
    input = JSON.parse(bytes);
  }
  const result = compactResult(analyzeInput(input));
  if (options.output) {
    const outputPath = path.resolve(options.output);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`);
  }
  console.log(JSON.stringify(result, null, 2));
  return result;
}

module.exports = {
  PROTOCOL_PATH, PROTOCOL_SHA256, INPUT_SCHEMA, INPUT_STATUS, RESULT_STATUS,
  MAX_STALE_DAYS, DAY_COUNT, PRIMARY_COST, STRESS_COST, ASSETS, ASSET_KEYS,
  DataRequiredError, sha256, dateMs, days, assertProtocolFrozen, anniversary12,
  yahooUrl, fredUrl, fetchBytes, parseYahooPayload, parseFredCsv,
  fetchResearchInput, validateOrderedRows, validateInput, strictCommonEquityRows,
  lastIndexOnOrBefore, discountDailyFactor, buildCashRows, mergeCash,
  signalAt, buildMonthlySignals, validateWeights, exactRebalance,
  maximumDrawdown, summarize, latestWeights, simulateWindow, schedules,
  windowDefinitions, analyzeWindow, analyzeInput, compactResult, parseArgs, main,
};

if (require.main === module) {
  main().catch(error => {
    if (error && error.code === 'DATA_REQUIRED') {
      console.error(JSON.stringify({ status: 'DATA_REQUIRED', message: error.message, details: error.details || {} }, null, 2));
      process.exitCode = 2;
      return;
    }
    console.error(error && error.stack || error);
    process.exitCode = 1;
  });
}
