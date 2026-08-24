'use strict';
// marketfg.js — one repository-owned "Fear & Greed" model for every configured market.
// Used by server.js (/api/marketfg). No dependencies, requires Node 18+.
//
// The model is CNN-inspired (CNN Fear & Greed Index for the US) but computed entirely locally from daily closes
// in Yahoo Finance. Crypto and equity markets use the same six-component engine, percentile scoring,
// window, directions and weights; only the explicitly configured raw-market proxies differ. In particular,
// volatility is an implied-volatility level where configured and benchmark realised volatility otherwise.
// Six indicators, the same for every market:
//   momentum   benchmark vs its 125-observation average                         (+ = greed)
//   strength   benchmark distance from its trailing 252-observation high        (+ = greed)
//   volatility configured volatility series, else realised 20-observation vol    (− = high vol = fear)
//   safeHaven  20-common-observation return of benchmark minus safe-haven proxy   (+ = greed)
//   credit     high yield / investment grade vs 125-observation average          (+ = greed)
//   breadth    configured broader-risk / core proxy vs 63-observation average     (+ = greed)
// Each raw series → percentile rank (0–100) within a rolling window of 252 observations.
// Composite = the equal-weight mean of all six indicators. Labels:
// 0–24 Extreme Fear · 25–44 Fear · 45–55 Neutral · 56–74 Greed · 75–100 Extreme Greed.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Investments/1.0';
const SERIES_TTL_MS = 15 * 60 * 1000; // daily data effectively changes once a day — don't fetch more often
const seriesCache = new Map();         // symbol -> { t, p }
const lastGood = new Map();            // symbol -> last successful series (fallback if Yahoo does not respond)

// range 'max' = each series' full history on Yahoo (SPY since 1993, ^VIX since 1990 …); the composite reaches back as far as ≥ minComponents indicators exist
const DEFAULTS = {
  modelId: 'investments-unified-fear-greed', version: 1,
  range: 'max', window: 252, minWindowPoints: 126, minComponents: 6,
  fillDays: 7, historyPoints: 8000, timeoutMs: 25000, concurrency: 6,
};
const LABELS = [[0, 24, 'Extreme Fear'], [25, 44, 'Fear'], [45, 55, 'Neutral'], [56, 74, 'Greed'], [75, 100, 'Extreme Greed']];

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
  const s = Math.round(Math.round(score * 10) / 10); // same rounding as the displayed value (1 decimal) → label and number always agree
  const hit = labels.find(([a, b]) => s >= a && s <= b);
  return hit ? hit[2] : null;
}
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const round1 = v => v == null ? null : Math.round(v * 10) / 10;

// ---------- Yahoo ----------
async function fetchSeries(symbol, range, signal) {
  // 'max' must be requested as an explicit period: range=max makes Yahoo downgrade to monthly bars, period1=0 keeps daily ones
  const q = range === 'max' ? `period1=0&period2=${Math.floor(Date.now() / 1000) + 86400}&interval=1d` : `range=${encodeURIComponent(range)}&interval=1d`;
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?${q}`;
  let r;
  try { r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: signal || AbortSignal.timeout(20000) }); }
  catch (e) { const m = (e && e.message) || ''; throw new Error(/Yahoo did not respond/.test(m) ? `${m} (${symbol})` : `no contact with Yahoo (${symbol})`); }
  const j = await r.json().catch(() => null);
  if (!r.ok) {
    const desc = j && j.chart && j.chart.error && j.chart.error.description;
    throw new Error(`Yahoo ${r.status}${desc ? ' ' + desc : ''} (${symbol})`);
  }
  const res = j && j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error(`no result from Yahoo (${symbol})`);
  const meta = res.meta || {};
  const tz = meta.exchangeTimezoneName || 'UTC';
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
  for (let i = 0; i < ts.length; i++) {
    const c = closes[i];
    if (c == null || !Number.isFinite(c) || c <= 0) continue;
    byDate.set(new Date(ts[i] * 1000).toLocaleDateString('sv-SE', { timeZone: tz }), c); // exchange-local date as YYYY-MM-DD (sv-SE gives ISO order); same day twice → latest wins
  }
  const rows = [...byDate.entries()].map(([date, close]) => ({ date, close })).sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 30) throw new Error(`too little history from Yahoo (${symbol}: ${rows.length} days)`);
  const reg = (meta.currentTradingPeriod || {}).regular || null;
  const now = Date.now() / 1000;
  return {
    symbol, name: String(meta.longName || meta.shortName || symbol).replace(/\s+/g, ' ').trim(), currency: meta.currency || null, tz, rows, adjusted,
    lastDate: rows[rows.length - 1].date,
    intraday: !!(reg && Number.isFinite(reg.start) && now >= reg.start && now <= reg.end),
    fetchedAt: new Date().toISOString(),
  };
}

function getSeries(symbol, range, signal) {
  const hit = seriesCache.get(symbol);
  if (hit && Date.now() - hit.t < SERIES_TTL_MS) return hit.p;
  const p = fetchSeries(symbol, range, signal).then(s => { lastGood.set(symbol, s); return s; }, e => {
    seriesCache.delete(symbol);
    const g = lastGood.get(symbol);
    if (g) return { ...g, stale: true, fetchError: String(e.message || e) };
    throw e;
  });
  seriesCache.set(symbol, { t: Date.now(), p });
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
function pctScores(raw, window, minPts) {
  return raw.map((v, i) => {
    if (v == null || !Number.isFinite(v)) return null;
    let n = 0, below = 0, eq = 0;
    for (let k = Math.max(0, i - window + 1); k <= i; k++) { const x = raw[k]; if (x == null || !Number.isFinite(x)) continue; n++; if (x < v) below++; else if (x === v) eq++; }
    return n < minPts ? null : 100 * (below + 0.5 * eq) / n;
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

// ---------- one market ----------
function computeMarket(key, m, S, opt) {
  const sym = m.symbols || {};
  const marketSources = new Map();
  const utcCutoff = m.barPolicy === 'completed-utc-date' ? new Date().toISOString().slice(0, 10) : null;
  for (const [symbol, series] of S) marketSources.set(symbol, utcCutoff ? beforeUtcDate(series, utcCutoff) : series);
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
    const score = pctScores(c.raw, opt.window, opt.minWindowPoints);
    if (definitions[k].dir < 0) for (let i = 0; i < score.length; i++) if (score[i] != null) score[i] = 100 - score[i];
    comps[k] = { ...c, score, symbols: series.map(s => s.symbol), names: series.map(s => s.name), stale: series.some(s => s.stale), note: note || null };
    for (const s of series) if (s.stale && !staleSeen.has(s.symbol)) { // fallback series (last successful fetch) — say why, once per symbol
      staleSeen.add(s.symbol);
      warnings.push(`${s.symbol}: ${s.fetchError || 'Yahoo did not respond'} — showing series fetched ${String(s.fetchedAt || '').slice(0, 16).replace('T', ' ')}`);
    }
  };
  add('momentum', [idx], () => compMomentum(idx));
  add('strength', [idx], () => compStrength(idx, opt.window, opt.minWindowPoints));
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
  for (const [k, c] of Object.entries(comps)) {
    const p = last.parts[k] || null;
    components[k] = {
      key: k, name: definitions[k].name, desc: definitions[k].desc, unit: definitions[k].unit, dir: definitions[k].dir,
      score: p ? round1(p.score) : null, label: p ? labelOf(p.score) : null, raw: p ? round1(p.raw) : null, asOf: p ? p.asOf : null,
      symbols: c.symbols, names: c.names, note: c.note,
      stale: !!c.stale,                         // fallback series: Yahoo did not respond at the last fetch
      lag: !!(p && p.asOf !== last.date),       // older date than the index (other exchange closed) — not an error
    };
  }
  return {
    key, name: m.name || key, currency: m.currency || idx.currency, indexSymbol: idx.symbol, indexName: idx.name,
    asOf: last.date, score: round1(last.score), label: labelOf(last.score), n: last.n, total: Object.keys(COMPONENTS).length,
    intraday: !!idx.intraday, stale: !!idx.stale || Object.values(comps).some(c => c.stale),
    previous: { close: prevClose ? round1(prevClose.score) : null, closeDate: prevClose ? prevClose.date : null,
      week: week ? round1(week.score) : null, weekDate: week ? week.date : null, month: month ? round1(month.score) : null, monthDate: month ? month.date : null,
      year: year ? round1(year.score) : null, yearDate: year ? year.date : null },
    components, warnings,
    mapping: { barPolicy: m.barPolicy || 'exchange-local daily bars', symbols: sym },
    history: history.slice(-opt.historyPoints).map(h => ({ date: h.date, score: round1(h.score), label: labelOf(h.score), n: h.n })),
  };
}

// ---------- all markets ----------
async function getMarketFearGreed(cfg) {
  const opt = { ...DEFAULTS, ...(cfg || {}) };
  const markets = (cfg && cfg.markets) || {};
  const symbols = [...new Set(Object.values(markets).flatMap(m => Object.values(m.symbols || {}).flatMap(spec => collectSpecSymbols(spec))))];
  // one shared deadline for the whole fetch (not 20 s per symbol × several rounds) — a hanging Yahoo must never lock the page for minutes
  const ac = new AbortController();
  const deadline = setTimeout(() => ac.abort(new Error(`Yahoo did not respond within ${Math.round(opt.timeoutMs / 1000)} s`)), opt.timeoutMs);
  let fetched;
  try { fetched = await mapLimit(symbols, opt.concurrency, s => getSeries(s, opt.range, ac.signal).then(v => ({ ok: true, v }), e => ({ ok: false, e: String(e.message || e) }))); }
  finally { clearTimeout(deadline); }
  const S = new Map(), errors = {};
  fetched.forEach((r, i) => { if (r.ok) { S.set(symbols[i], r.v); if (r.v.stale) errors[symbols[i]] = r.v.fetchError; } else errors[symbols[i]] = r.e; });
  const out = {}, failed = {};
  for (const [key, m] of Object.entries(markets)) {
    try { out[key] = computeMarket(key, m, S, opt); }
    catch (e) { failed[key] = String(e.message || e); }
  }
  return {
    ok: Object.keys(out).length > 0, fetchedAt: new Date().toISOString(),
    model: {
      id: opt.modelId, version: Number(opt.version), owner: 'repository',
      name: 'Unified Fear & Greed — six-component market model',
      method: 'equal-weight trailing-percentile six-component composite',
      window: opt.window, minWindowPoints: opt.minWindowPoints, range: opt.range,
      minComponents: opt.minComponents, fillDays: opt.fillDays, labels: LABELS, components: COMPONENTS,
    },
    markets: out, failed, symbolErrors: errors,
  };
}

module.exports = {
  getMarketFearGreed, clearCache, LABELS, COMPONENTS, labelOf, pctScores, computeMarket,
  collectSpecSymbols, equalWeightReturnSeries, resolveSeriesSpec, beforeUtcDate,
};
