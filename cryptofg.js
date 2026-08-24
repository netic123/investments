'use strict';

// cryptofg.js — repository-owned crypto market-state model.
//
// This is deliberately not a wrapper around a published Fear & Greed index.
// It computes five equally weighted components from completed UTC daily prices
// for a fixed basket. The result is a descriptive price-based risk-appetite
// proxy, not a survey of emotions and not a demonstrated return forecast.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Investments/1.0';
const SERIES_TTL_MS = 15 * 60 * 1000;
const seriesCache = new Map();
const lastGood = new Map();

const LABELS = [[0, 24, 'Extreme Fear'], [25, 44, 'Fear'], [45, 55, 'Neutral'], [56, 74, 'Greed'], [75, 100, 'Extreme Greed']];
const COMPONENTS = {
  trend: {
    name: 'Bitcoin trend',
    desc: 'BTC close relative to its 200-day moving average',
    unit: '%', dir: 1,
  },
  strength: {
    name: 'Bitcoin strength',
    desc: 'BTC distance from its trailing 365-day high',
    unit: '%', dir: 1,
  },
  volatility: {
    name: 'Volatility shock',
    desc: 'BTC 30-day realised volatility relative to its 90-day average',
    unit: '%', dir: -1,
  },
  breadth: {
    name: 'Market breadth',
    desc: 'Share of the fixed basket above each asset’s 200-day average',
    unit: '%', dir: 1,
  },
  altcoinAppetite: {
    name: 'Altcoin appetite',
    desc: 'Median 30-day altcoin return minus BTC’s 30-day return',
    unit: 'pp', dir: 1,
  },
};

const DEFAULTS = {
  modelId: 'investments-crypto-risk-appetite',
  version: 1,
  range: 'max',
  scoreWindow: 365,
  minScorePoints: 180,
  trendDays: 200,
  highDays: 365,
  volatilityDays: 30,
  volatilityBaselineDays: 90,
  breadthSmaDays: 200,
  relativeReturnDays: 30,
  historyPoints: 8000,
  timeoutMs: 30000,
  concurrency: 3,
};

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const round1 = value => value == null ? null : Math.round(value * 10) / 10;

function labelOf(score, labels = LABELS) {
  if (!Number.isFinite(score)) return null;
  const shown = Math.round(Math.round(score * 10) / 10);
  const hit = labels.find(([low, high]) => shown >= low && shown <= high);
  return hit ? hit[2] : null;
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function smaAt(values, index, days) {
  if (index < days - 1) return null;
  let sum = 0;
  for (let i = index - days + 1; i <= index; i++) {
    if (!Number.isFinite(values[i])) return null;
    sum += values[i];
  }
  return sum / days;
}

function pctScores(raw, window, minPoints) {
  return raw.map((value, index) => {
    if (!Number.isFinite(value)) return null;
    let count = 0, below = 0, equal = 0;
    for (let i = Math.max(0, index - window + 1); i <= index; i++) {
      const candidate = raw[i];
      if (!Number.isFinite(candidate)) continue;
      count++;
      if (candidate < value) below++;
      else if (candidate === value) equal++;
    }
    return count < minPoints ? null : 100 * (below + 0.5 * equal) / count;
  });
}

async function fetchYahooSeries(symbol, signal) {
  const period2 = Math.floor(Date.now() / 1000) + 86400;
  const query = `period1=0&period2=${period2}&interval=1d`;
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  let result = null, usedUrl = null, firstError = null;

  for (const host of hosts) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`;
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        signal: signal || AbortSignal.timeout(20000),
      });
      const json = await response.json().catch(() => null);
      if (!response.ok) {
        const detail = json && json.chart && json.chart.error && json.chart.error.description;
        throw new Error(`Yahoo ${response.status}${detail ? ` ${detail}` : ''}`);
      }
      result = json && json.chart && json.chart.result && json.chart.result[0];
      if (!result) throw new Error('Yahoo returned no chart result');
      usedUrl = url;
      break;
    } catch (error) {
      if (!firstError) firstError = error;
      if (signal && signal.aborted) break;
    }
  }
  if (!result) throw new Error(`no completed Yahoo history for ${symbol}: ${firstError ? firstError.message : 'unknown error'}`);

  const meta = result.meta || {};
  const timestamps = result.timestamp || [];
  const quoteClose = (((result.indicators || {}).quote || [])[0] || {}).close || [];
  const adjClose = (((result.indicators || {}).adjclose || [])[0] || {}).adjclose || [];
  const adjusted = adjClose.length === quoteClose.length && quoteClose.every((close, i) =>
    !(Number.isFinite(close) && close > 0) || (Number.isFinite(adjClose[i]) && adjClose[i] > 0));
  const closes = adjusted ? adjClose : quoteClose;
  const utcToday = new Date().toISOString().slice(0, 10);
  const byDate = new Map();
  let excludedCurrentUtc = 0;

  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (!Number.isFinite(close) || close <= 0) continue;
    const date = new Date(timestamps[i] * 1000).toISOString().slice(0, 10);
    // Crypto trades continuously. Today's UTC bar is incomplete and is never admitted to the model or backtest.
    if (date >= utcToday) { excludedCurrentUtc++; continue; }
    byDate.set(date, { date, close });
  }

  const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 400) throw new Error(`too little completed Yahoo history (${symbol}: ${rows.length} days)`);
  let calendarGaps = 0;
  for (let i = 1; i < rows.length; i++) if (rows[i].date !== addDays(rows[i - 1].date, 1)) calendarGaps++;

  return {
    symbol,
    name: String(meta.longName || meta.shortName || symbol).replace(/\s+/g, ' ').trim(),
    currency: meta.currency || null,
    rows,
    adjusted,
    sourceUrl: usedUrl,
    excludedCurrentUtc,
    calendarGaps,
    lastDate: rows[rows.length - 1].date,
    fetchedAt: new Date().toISOString(),
  };
}

function getSeries(symbol, signal) {
  const hit = seriesCache.get(symbol);
  if (hit && Date.now() - hit.t < SERIES_TTL_MS) return hit.p;
  const promise = fetchYahooSeries(symbol, signal).then(series => {
    lastGood.set(symbol, series);
    return series;
  }, error => {
    seriesCache.delete(symbol);
    const fallback = lastGood.get(symbol);
    if (fallback) return { ...fallback, stale: true, fetchError: String(error.message || error) };
    throw error;
  });
  seriesCache.set(symbol, { t: Date.now(), p: promise });
  return promise;
}

function clearCache() { seriesCache.clear(); }

async function mapLimit(items, limit, fn) {
  const output = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      output[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return output;
}

function realisedVolatility(closes, days) {
  const returns = closes.map((close, i) => i ? Math.log(close / closes[i - 1]) : null);
  return closes.map((_, index) => {
    if (index < days) return null;
    const sample = returns.slice(index - days + 1, index + 1);
    if (sample.length !== days || sample.some(value => !Number.isFinite(value))) return null;
    const mean = sample.reduce((sum, value) => sum + value, 0) / sample.length;
    const variance = sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (sample.length - 1);
    return Math.sqrt(variance) * Math.sqrt(365) * 100;
  });
}

function prepareSeries(series, opt) {
  const closes = series.rows.map(row => row.close);
  const dates = series.rows.map(row => row.date);
  const trend = closes.map((close, i) => {
    const average = smaAt(closes, i, opt.trendDays);
    return average ? 100 * (close / average - 1) : null;
  });
  const breadthDistance = closes.map((close, i) => {
    const average = smaAt(closes, i, opt.breadthSmaDays);
    return average ? 100 * (close / average - 1) : null;
  });
  const strength = closes.map((close, i) => {
    if (i < opt.highDays - 1) return null;
    let high = -Infinity;
    for (let j = i - opt.highDays + 1; j <= i; j++) high = Math.max(high, closes[j]);
    return Number.isFinite(high) && high > 0 ? 100 * (close / high - 1) : null;
  });
  const relativeReturn = closes.map((close, i) => i < opt.relativeReturnDays ? null : close / closes[i - opt.relativeReturnDays] - 1);
  const volatility = realisedVolatility(closes, opt.volatilityDays);
  const volatilityShock = volatility.map((value, i) => {
    if (!Number.isFinite(value)) return null;
    const baseline = smaAt(volatility, i, opt.volatilityBaselineDays);
    return baseline && baseline > 0 ? 100 * (value / baseline - 1) : null;
  });
  return {
    ...series,
    closes, dates, trend, strength, breadthDistance, relativeReturn, volatilityShock,
    dateIndex: new Map(dates.map((date, i) => [date, i])),
  };
}

function computeCrypto(seriesInput, config = {}) {
  const opt = { ...DEFAULTS, ...config };
  const symbols = Array.isArray(opt.symbols) ? opt.symbols.slice() : [];
  if (symbols.length < 3) throw new Error('crypto model requires a fixed basket of at least three symbols');
  if (new Set(symbols).size !== symbols.length) throw new Error('crypto model basket contains duplicate symbols');
  const benchmark = opt.benchmark || symbols[0];
  if (!symbols.includes(benchmark)) throw new Error(`crypto benchmark ${benchmark} is not in the fixed basket`);

  const sourceMap = seriesInput instanceof Map ? seriesInput : new Map(Object.entries(seriesInput || {}));
  const missing = symbols.filter(symbol => !sourceMap.get(symbol));
  if (missing.length) throw new Error(`fixed crypto basket incomplete: ${missing.join(', ')}`);
  const prepared = new Map(symbols.map(symbol => [symbol, prepareSeries(sourceMap.get(symbol), opt)]));
  const btc = prepared.get(benchmark);
  const altSymbols = symbols.filter(symbol => symbol !== benchmark);

  const raw = {
    trend: btc.trend,
    strength: btc.strength,
    volatility: btc.volatilityShock,
    breadth: new Array(btc.dates.length).fill(null),
    altcoinAppetite: new Array(btc.dates.length).fill(null),
  };
  const assetCounts = new Array(btc.dates.length).fill(0);

  for (let i = 0; i < btc.dates.length; i++) {
    const date = btc.dates[i];
    const breadthValues = [];
    for (const symbol of symbols) {
      const series = prepared.get(symbol);
      const index = series.dateIndex.get(date);
      if (index == null || !Number.isFinite(series.breadthDistance[index])) continue;
      breadthValues.push(series.breadthDistance[index]);
    }
    assetCounts[i] = breadthValues.length;
    // The historical definition never changes: all configured assets must participate.
    if (breadthValues.length === symbols.length) raw.breadth[i] = 100 * breadthValues.filter(value => value > 0).length / symbols.length;

    const btcReturn = btc.relativeReturn[i];
    const altReturns = [];
    for (const symbol of altSymbols) {
      const series = prepared.get(symbol);
      const index = series.dateIndex.get(date);
      if (index != null && Number.isFinite(series.relativeReturn[index])) altReturns.push(series.relativeReturn[index]);
    }
    if (Number.isFinite(btcReturn) && altReturns.length === altSymbols.length) {
      raw.altcoinAppetite[i] = 100 * (median(altReturns) - btcReturn);
    }
  }

  const scores = {};
  for (const [key, definition] of Object.entries(COMPONENTS)) {
    scores[key] = pctScores(raw[key], opt.scoreWindow, opt.minScorePoints);
    if (definition.dir < 0) scores[key] = scores[key].map(value => value == null ? null : 100 - value);
  }

  const componentKeys = Object.keys(COMPONENTS);
  const history = [];
  for (let i = 0; i < btc.dates.length; i++) {
    const parts = {};
    let sum = 0;
    for (const key of componentKeys) {
      const score = scores[key][i];
      const value = raw[key][i];
      if (!Number.isFinite(score) || !Number.isFinite(value)) continue;
      parts[key] = { score, raw: value, asOf: btc.dates[i] };
      sum += score;
    }
    if (Object.keys(parts).length !== componentKeys.length || assetCounts[i] !== symbols.length) continue;
    const score = sum / componentKeys.length;
    history.push({ date: btc.dates[i], score, value: score, label: labelOf(score), n: componentKeys.length, assetCount: symbols.length, parts });
  }
  if (!history.length) throw new Error('too little completed history for all crypto model components and fixed-basket assets');

  const last = history[history.length - 1];
  const previousClose = history.length > 1 ? history[history.length - 2] : null;
  const atOrBefore = date => {
    let found = null;
    for (const row of history) { if (row.date <= date) found = row; else break; }
    return found;
  };
  const week = atOrBefore(addDays(last.date, -7));
  const month = atOrBefore(addDays(last.date, -30));
  const year = atOrBefore(addDays(last.date, -365));
  const components = {};
  for (const key of componentKeys) {
    const definition = COMPONENTS[key];
    const part = last.parts[key];
    const componentSymbols = key === 'trend' || key === 'strength' || key === 'volatility' ? [benchmark] : symbols;
    components[key] = {
      key,
      name: definition.name,
      desc: definition.desc,
      unit: definition.unit,
      dir: definition.dir,
      raw: round1(part.raw),
      score: round1(part.score),
      label: labelOf(part.score),
      asOf: part.asOf,
      symbols: componentSymbols,
      names: componentSymbols.map(symbol => prepared.get(symbol).name),
      note: key === 'volatility' ? 'higher raw volatility is inverted to mean more fear' : null,
      stale: componentSymbols.some(symbol => prepared.get(symbol).stale),
      lag: false,
    };
  }

  const staleSeries = symbols.filter(symbol => prepared.get(symbol).stale);
  const gapSeries = symbols.filter(symbol => prepared.get(symbol).calendarGaps > 0);
  const warnings = [];
  for (const symbol of staleSeries) warnings.push(`${symbol}: ${prepared.get(symbol).fetchError || 'Yahoo did not respond'} — using the last successful in-memory series`);
  if (gapSeries.length) warnings.push(`Yahoo histories contain calendar gaps for: ${gapSeries.map(symbol => `${symbol} (${prepared.get(symbol).calendarGaps})`).join(', ')}`);

  return {
    ok: true,
    value: round1(last.score),
    score: round1(last.score),
    label: labelOf(last.score),
    asOf: last.date,
    intraday: false,
    stale: staleSeries.length > 0,
    n: componentKeys.length,
    total: componentKeys.length,
    assetCount: symbols.length,
    components,
    previous: {
      close: previousClose ? round1(previousClose.score) : null,
      closeDate: previousClose ? previousClose.date : null,
      week: week ? round1(week.score) : null,
      weekDate: week ? week.date : null,
      month: month ? round1(month.score) : null,
      monthDate: month ? month.date : null,
      year: year ? round1(year.score) : null,
      yearDate: year ? year.date : null,
    },
    history: history.slice(-opt.historyPoints).map(row => ({
      date: row.date,
      value: round1(row.score),
      score: round1(row.score),
      label: labelOf(row.score),
      n: row.n,
      assetCount: row.assetCount,
    })),
    warnings,
    model: {
      id: opt.modelId,
      version: Number(opt.version),
      owner: 'repository',
      name: 'Crypto Risk Appetite — own price-based model',
      method: 'equal-weight trailing-percentile composite',
      labels: LABELS,
      components: COMPONENTS,
      scoreWindow: opt.scoreWindow,
      minScorePoints: opt.minScorePoints,
      parameters: {
        trendDays: opt.trendDays,
        highDays: opt.highDays,
        volatilityDays: opt.volatilityDays,
        volatilityBaselineDays: opt.volatilityBaselineDays,
        breadthSmaDays: opt.breadthSmaDays,
        relativeReturnDays: opt.relativeReturnDays,
      },
      benchmark,
      basket: symbols,
    },
  };
}

async function getCryptoFearGreed(config = {}) {
  const opt = { ...DEFAULTS, ...config };
  const symbols = Array.isArray(opt.symbols) ? opt.symbols : [];
  if (!symbols.length) throw new Error('cryptoFearGreed.symbols is empty');
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(new Error(`Yahoo crypto histories did not respond within ${Math.round(opt.timeoutMs / 1000)} s`)), opt.timeoutMs);
  let fetched;
  try {
    fetched = await mapLimit(symbols, opt.concurrency, symbol => getSeries(symbol, controller.signal)
      .then(value => ({ ok: true, value }), error => ({ ok: false, error: String(error.message || error) })));
  } finally {
    clearTimeout(deadline);
  }
  const series = new Map();
  const failures = {};
  fetched.forEach((result, i) => {
    if (result.ok) series.set(symbols[i], result.value);
    else failures[symbols[i]] = result.error;
  });
  if (Object.keys(failures).length) throw new Error(`fixed crypto basket could not be fetched: ${Object.entries(failures).map(([symbol, error]) => `${symbol}: ${error}`).join('; ')}`);

  const result = computeCrypto(series, opt);
  return {
    ...result,
    fetchedAt: new Date().toISOString(),
    source: {
      provider: 'Yahoo Finance',
      type: 'completed UTC daily adjusted closes where Yahoo supplies a complete adjusted series',
      endpointTemplate: 'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}',
      symbols,
      latestDates: Object.fromEntries(symbols.map(symbol => [symbol, series.get(symbol).lastDate])),
      currentUtcBarPolicy: 'excluded until the UTC date has completed',
      caveat: 'Yahoo chart data is a raw price source, not this model, and the chart endpoint has no public contractual API SLA.',
    },
  };
}

module.exports = {
  getCryptoFearGreed,
  computeCrypto,
  clearCache,
  LABELS,
  COMPONENTS,
  DEFAULTS,
  labelOf,
  pctScores,
  median,
};
