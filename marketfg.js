'use strict';
// marketfg.js — own "Fear & Greed" model for equity markets (Sweden, USA, Europe, Global).
// Used by server.js (/api/marketfg). No dependencies, requires Node 18+.
//
// The model is CNN-inspired (CNN Fear & Greed Index for the US) but computed entirely locally from daily closes
// in Yahoo Finance (range=3y), because no published index with an open feed exists for Sweden/Europe/global.
// Six indicators, the same for every market:
//   momentum   index vs its 125-day average                         (+ = greed)
//   strength   index distance from its 52-week high                 (+ = greed)
//   volatility VIX level where one exists, else realised 20-day     (− = high vol = fear)
//   safeHaven  20-day return of stocks minus government bonds        (+ = greed)
//   credit     high yield / investment grade vs 125-day average      (+ = greed)
//   breadth    small caps / large caps vs 63-day average             (+ = greed)
// Each raw series → percentile rank (0–100) within a rolling window of 252 trading days (≈ 1 year).
// Composite = mean of the indicators available that day (at least 3). Labels as CNN:
// 0–24 Extreme Fear · 25–44 Fear · 45–55 Neutral · 56–74 Greed · 75–100 Extreme Greed.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Investments/1.0';
const SERIES_TTL_MS = 15 * 60 * 1000; // daily data effectively changes once a day — don't fetch more often
const seriesCache = new Map();         // symbol -> { t, p }
const lastGood = new Map();            // symbol -> last successful series (fallback if Yahoo does not respond)

// range 'max' = each series' full history on Yahoo (SPY since 1993, ^VIX since 1990 …); the composite reaches back as far as ≥ minComponents indicators exist
const DEFAULTS = { range: 'max', window: 252, minWindowPoints: 126, minComponents: 3, fillDays: 7, historyPoints: 8000, timeoutMs: 25000, concurrency: 6 };
const LABELS = [[0, 24, 'Extreme Fear'], [25, 44, 'Fear'], [45, 55, 'Neutral'], [56, 74, 'Greed'], [75, 100, 'Extreme Greed']];

const COMPONENTS = {
  momentum:   { name: 'Momentum',         desc: 'Index vs its 125-day moving average', unit: '%', dir: 1 },
  strength:   { name: 'Strength',         desc: 'Index distance from its 52-week high', unit: '%', dir: 1 },
  volatility: { name: 'Volatility',       desc: 'VIX (or realised 20-day volatility) relative to its 50-day average — as CNN', unit: '%', dir: -1 },
  safeHaven:  { name: 'Safe-haven demand', desc: '20-day return of stocks minus government bonds', unit: 'pp', dir: 1 },
  credit:     { name: 'Credit appetite',  desc: 'High yield vs investment grade, relative to 125-day average', unit: '%', dir: 1 },
  breadth:    { name: 'Breadth',          desc: 'Small caps vs large caps, relative to 63-day average', unit: '%', dir: 1 },
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

// ---------- one market ----------
function computeMarket(key, m, S, opt) {
  const sym = m.symbols || {};
  const get = slot => sym[slot] ? S.get(sym[slot]) || null : null;
  const idx = get('index');
  if (!idx) throw new Error(`index series (${sym.index || '—'}) missing`);
  const bond = get('bond'), vol = get('vol'), hy = get('hy'), ig = get('ig') || bond, small = get('small'), large = get('large') || idx;
  const warnings = [], staleSeen = new Set();
  const comps = {};
  const add = (k, series, build, note) => {
    const missing = series.filter(s => !s);
    if (missing.length) return; // slot not configured / data missing → the indicator is omitted
    const c = build();
    const score = pctScores(c.raw, opt.window, opt.minWindowPoints);
    if (COMPONENTS[k].dir < 0) for (let i = 0; i < score.length; i++) if (score[i] != null) score[i] = 100 - score[i];
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
  if (vol) add('volatility', [vol], () => compRelSma(compLevel(vol), 50), 'implied volatility vs its 50-day average');
  else { add('volatility', [idx], () => compRelSma(compRealizedVol(idx), 50), 'realised 20-day volatility vs its 50-day average'); if (sym.vol) warnings.push(`volatility index ${sym.vol} could not be fetched — realised volatility is used`); }
  if (bond) add('safeHaven', [idx, bond], () => compSafeHaven(idx, bond)); else if (sym.bond) warnings.push(`bond series ${sym.bond} missing`);
  if (hy && ig) add('credit', [hy, ig], () => compRatioVsSma(hy, ig, 125)); else if (sym.hy) warnings.push(`credit series ${sym.hy}${sym.ig && !ig ? ' / ' + sym.ig : ''} missing`);
  if (small && large) add('breadth', [small, large], () => compRatioVsSma(small, large, 63)); else if (sym.small) warnings.push(`small-cap series ${sym.small} missing`);

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
      key: k, name: COMPONENTS[k].name, desc: COMPONENTS[k].desc, unit: COMPONENTS[k].unit, dir: COMPONENTS[k].dir,
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
    history: history.slice(-opt.historyPoints).map(h => ({ date: h.date, score: round1(h.score), label: labelOf(h.score), n: h.n })),
  };
}

// ---------- all markets ----------
async function getMarketFearGreed(cfg) {
  const opt = { ...DEFAULTS, ...(cfg || {}) };
  const markets = (cfg && cfg.markets) || {};
  const symbols = [...new Set(Object.values(markets).flatMap(m => Object.values(m.symbols || {}).filter(Boolean)))];
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
    model: { window: opt.window, range: opt.range, minComponents: opt.minComponents, labels: LABELS, components: COMPONENTS },
    markets: out, failed, symbolErrors: errors,
  };
}

module.exports = { getMarketFearGreed, clearCache, LABELS, COMPONENTS, labelOf, pctScores, computeMarket };
