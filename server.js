// Investments — local server. No dependencies, requires Node 18+.
// Fetches the fund's own CSV files + quotes from Yahoo, stores daily snapshots,
// and serves index.html. Start: node server.js  (or double-click start.bat)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const marketfg = require('./marketfg'); // own Fear & Greed model for equity markets (Sweden/USA/Europe/Global)

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const CONFIG_PATH = path.join(DATA, 'config.json');
const SNAP_PATH = path.join(DATA, 'snapshots.json');
const PORTFOLIO_PATH = path.join(DATA, 'portfolio.local.json');

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// Your own focus list lives outside the committed config so the repo can be shared without it.
// data/positions.local.json is gitignored; if it is missing we fall back to the example so the server still starts.
const POSITIONS_PATH = path.join(DATA, 'positions.local.json');
const POSITIONS_EXAMPLE_PATH = path.join(DATA, 'positions.example.json');
const loadedPositions = (() => {
  let localIssue = null;
  for (const p of [POSITIONS_PATH, POSITIONS_EXAMPLE_PATH]) {
    try {
      const list = JSON.parse(fs.readFileSync(p, 'utf8')).myPositions;
      if (Array.isArray(list)) {
        const demo = p === POSITIONS_EXAMPLE_PATH;
        if (demo) console.log('data/positions.local.json unavailable — using the example watchlist. Copy the example file and enter your own.');
        return {
          list,
          meta: {
            source: demo ? 'example' : 'local',
            demo,
            warning: demo ? (localIssue || 'data/positions.local.json was not found') : null,
          },
        };
      }
      throw new Error('myPositions is not a list');
    } catch (e) {
      if (p === POSITIONS_PATH) localIssue = e.code === 'ENOENT' ? 'data/positions.local.json was not found' : `data/positions.local.json is invalid: ${e.message}`;
      if (e.code !== 'ENOENT') console.error(`${path.basename(p)}: ${e.message} — skipping it`);
    }
  }
  console.error('No usable positions file — the focused watchlist will be empty.');
  return { list: [], meta: { source: 'empty', demo: false, warning: localIssue || 'No usable positions file' } };
})();
config.myPositions = loadedPositions.list;
config.positionsMeta = loadedPositions.meta;

const PORT = Number(process.env.PORT || config.port || 8765);
const ADDR = `http://127.0.0.1:${PORT}`; // 127.0.0.1, not localhost — avoids the ~300 ms IPv6 fallback per call
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Investments/1.0';
const TTL_MS = 5 * 60 * 1000;

process.on('unhandledRejection', e => console.error('Unhandled error:', e && e.message || e));
process.on('uncaughtException', e => console.error('Unexpected error:', e && e.message || e));

// ---------- cache: shares an in-flight fetch between concurrent calls, caches only successful responses ----------
const cache = new Map();
function cached(key, fn, isGood = () => true) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.t < TTL_MS) return hit.p;
  const p = fn().then(v => { if (!isGood(v)) cache.delete(key); return v; }, e => { cache.delete(key); throw e; });
  cache.set(key, { t: Date.now(), p });
  return p;
}

const shortName = url => { try { return new URL(url).pathname.split('/').pop(); } catch { return url; } };

// ---------- private local portfolio snapshot ----------
// Read on every request so editing the gitignored file only requires a browser reload, not a server restart.
// This is deliberately separate from config, Yahoo quotes, WAGN snapshots and /api/refresh: its numbers are
// a dated user-supplied Avanza snapshot, not values that this server can recompute without quantities and FX lots.
async function getPortfolio() {
  let p;
  try { p = JSON.parse(fs.readFileSync(PORTFOLIO_PATH, 'utf8')); }
  catch (e) {
    if (e.code === 'ENOENT') return { available: false, reason: 'missing', loadedAt: new Date().toISOString() };
    throw new Error(`portfolio.local.json could not be read: ${e.message}`);
  }
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  if (!p || p.schemaVersion !== 1 || !iso.test(p.asOf || '') || !Array.isArray(p.stocks) || !Array.isArray(p.funds)) {
    throw new Error('portfolio.local.json has an unsupported or invalid schema');
  }
  if (!p.summary || !finite(p.summary.valueSek) || !finite(p.summary.gainSek) || !finite(p.summary.returnPct)) {
    throw new Error('portfolio.local.json is missing valid summary values');
  }
  for (const row of [...p.stocks, ...p.funds]) {
    if (!row || typeof row.name !== 'string' || !finite(row.valueSek) || !finite(row.gainSek) || !finite(row.returnPct)) {
      throw new Error('portfolio.local.json contains an invalid position row');
    }
  }
  return { available: true, snapshot: p, loadedAt: new Date().toISOString() };
}

async function fetchText(url) {
  let r;
  try { r = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) }); }
  catch (e) { throw new Error(`no contact with ${new URL(url).host}`); }
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} (${shortName(url)})`);
  return r.text();
}
async function fetchJson(url) {
  let r;
  try { r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) }); }
  catch (e) { throw new Error(`no contact with ${new URL(url).host}`); }
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

// Simple CSV parser — the fund's files have no quoted commas.
function parseCsv(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter(l => l.trim().length);
  if (!lines.length) return [];
  const head = lines[0].split(',').map(s => s.trim());
  return lines.slice(1).map(l => {
    const cells = l.split(',');
    const o = {};
    head.forEach((h, i) => { o[h] = (cells[i] ?? '').trim(); });
    return o;
  });
}
const num = s => {
  const n = parseFloat(String(s).replace(/[%$,]/g, ''));
  return Number.isFinite(n) ? n : null;
};
// "08/24/2026" -> "2026-08-24"
const isoFromUs = s => {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s || '');
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
};

// ---------- snapshots on disk (validated, backed up on error, atomic write) ----------
function loadSnapshots() {
  if (!fs.existsSync(SNAP_PATH)) return [];
  try {
    const v = JSON.parse(fs.readFileSync(SNAP_PATH, 'utf8'));
    if (!Array.isArray(v)) throw new Error('not a list');
    return v.filter(s => s && typeof s.date === 'string' && s.rows && typeof s.rows === 'object');
  } catch (e) {
    const bak = SNAP_PATH + '.broken-' + Date.now();
    try { fs.copyFileSync(SNAP_PATH, bak); } catch {}
    console.error(`snapshots.json could not be read (${e.message}) — copy saved as ${path.basename(bak)}`);
    return [];
  }
}
function saveSnapshots(list) {
  list.sort((a, b) => a.date.localeCompare(b.date));
  const tmp = SNAP_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 1));
  fs.renameSync(tmp, SNAP_PATH);
}

// ---------- holdings ----------
async function getHoldings() {
  const cashSet = new Set(config.cashTickers || []);
  let live = null, fetchError = null;
  try {
    const rows = parseCsv(await fetchText(config.sources.holdings));
    if (!rows.length) throw new Error('empty holdings file');
    const fileDate = rows[0].Date;
    const date = isoFromUs(fileDate);
    if (!date) throw new Error(`unexpected date format: ${fileDate}`);
    const snap = { date, fileDate, netAssets: num(rows[0].NetAssets), rows: {}, cash: {} };
    for (const r of rows) {
      const t = r.StockTicker;
      if (!t) continue;
      if (cashSet.has(t)) { snap.cash[t] = num(r.MarketValue); continue; }
      snap.rows[t] = {
        shares: num(r.Shares), price: num(r.Price), mv: num(r.MarketValue), weight: num(r.Weightings),
        name: r.SecurityName || '',
      };
    }
    if (!Object.keys(snap.rows).length) throw new Error('no holdings in the file');
    live = snap;
  } catch (e) { fetchError = String(e.message || e); }

  const snaps = loadSnapshots();
  if (live) {
    const i = snaps.findIndex(s => s.date === live.date);
    const changed = i === -1 || JSON.stringify(snaps[i]) !== JSON.stringify(live);
    if (i === -1) snaps.push(live); else snaps[i] = live; // same day: the latest file wins
    if (changed) {
      try { saveSnapshots(snaps); }
      catch (e) { console.error('could not save snapshots.json:', e.message); fetchError = 'could not save snapshot (' + e.message + ')'; }
    }
  }
  snaps.sort((a, b) => a.date.localeCompare(b.date));
  const latest = snaps[snaps.length - 1] || null;
  const previous = snaps.length > 1 ? snaps[snaps.length - 2] : null;
  const first = snaps[0] || null;

  const log = [];
  for (let k = 1; k < snaps.length; k++) log.push(...diff(snaps[k - 1], snaps[k]));
  log.sort((a, b) => b.to.localeCompare(a.to) || b.absValue - a.absValue);

  return {
    ok: !!live, fetchError, fetchedAt: new Date().toISOString(),
    latest, previous, first,
    changesVsPrevious: previous && latest ? diff(previous, latest) : [],
    changesVsFirst: first && latest && first !== latest ? diff(first, latest) : [],
    snapshotDates: snaps.map(s => s.date),
    log,
  };
}

function diff(a, b) {
  const out = [];
  const cashLike = new Set(config.cashLike || []);
  const tickers = new Set([...Object.keys(a.rows), ...Object.keys(b.rows)]);
  for (const t of tickers) {
    const ra = a.rows[t], rb = b.rows[t];
    const sa = (ra && ra.shares) || 0, sb = (rb && rb.shares) || 0;
    const delta = sb - sa;
    if (Math.abs(delta) < 0.5) continue;
    const price = (rb && rb.price) || (ra && ra.price) || 0;
    const usdPerShare = rb && rb.mv && rb.shares ? rb.mv / rb.shares : (ra && ra.mv && ra.shares ? ra.mv / ra.shares : 0);
    out.push({
      ticker: t, from: a.date, to: b.date, sharesFrom: sa, sharesTo: sb, delta,
      pct: sa ? delta / sa * 100 : null,
      kind: !ra ? 'NEW' : !rb ? 'SOLD OUT' : delta > 0 ? 'INCREASE' : 'DECREASE',
      localPrice: price, approxUsd: Math.abs(delta) * usdPerShare, absValue: Math.abs(delta) * usdPerShare,
      cashLike: cashLike.has(t), // money-market fund etc. — shown in the table but not counted as a position change
    });
  }
  return out.sort((x, y) => y.absValue - x.absValue);
}

// ---------- NAV / performance ----------
async function getNav() {
  const [daily, hist] = await Promise.all([
    fetchText(config.sources.navDaily).then(parseCsv),
    fetchText(config.sources.navHistory).then(parseCsv),
  ]);
  const d = daily[0] || {};
  const history = hist.map(r => ({
    date: isoFromUs(r['Rate Date']), nav: num(r.NAV), price: num(r['Market Price']), prem: num(r['Premium/Discount Percentage']),
  })).filter(r => r.date && r.nav != null).sort((a, b) => a.date.localeCompare(b.date));
  return {
    date: isoFromUs(d['Rate Date']), nav: num(d.NAV), navChgPct: num(d['NAV Change Percentage']),
    price: num(d['Market Price']), premium: num(d['Premium/Discount Percentage']),
    netAssets: num(d['Net Assets']), sharesOut: num(d['Shares Outstanding']), spread: num(d['Median 30 Day Spread Percentage']),
    history, // the fund's full daily series since inception (29 Sep 2023) — price only, no distributions
  };
}
async function getPerf() {
  const [m, q] = await Promise.all([
    fetchText(config.sources.monthlyPerf).then(parseCsv),
    fetchText(config.sources.quarterlyPerf).then(parseCsv).catch(() => []),
  ]);
  const shape = rows => rows.map(r => ({
    name: r['Fund Name'], ticker: r['Fund Ticker'], m1: num(r['1 Month']), m3: num(r['3 Month']), m6: num(r['6 Month']),
    ytd: num(r.YTD), y1: num(r['1 Year']), y3: num(r['3 Year']), sinceCum: num(r['Since Inception Cumulative']),
    sinceAnn: num(r['Since Inception Annualized']), date: isoFromUs(r.Date),
  }));
  return { monthly: shape(m), quarterly: shape(q) };
}

// ---------- quotes (Yahoo) ----------
async function yahooQuote(symbol) {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const j = await fetchJson(u);
  const res = j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error(`no result for ${symbol}`);
  const m = res.meta || {};
  // Yesterday's close = the second-to-last valid daily close. chartPreviousClose is the close BEFORE the whole
  // range and never works as "yesterday" — better empty than wrong.
  const closes = (((res.indicators || {}).quote || [])[0] || {}).close || [];
  const valid = closes.filter(c => c != null && Number.isFinite(c));
  const prevClose = valid.length >= 2 ? valid[valid.length - 2] : null;
  return {
    symbol, price: m.regularMarketPrice ?? null, prevClose,
    currency: m.currency || null, time: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
    exchange: m.exchangeName || null,
  };
}
async function getQuotes() {
  const symbols = [...new Set([...config.myPositions.map(p => p.yahoo), ...Object.values(config.fx || {})].filter(Boolean))];
  const out = {};
  await Promise.all(symbols.map(async s => {
    try { out[s] = await yahooQuote(s); } catch (e) { out[s] = { symbol: s, error: String(e.message || e) }; }
  }));
  return out;
}

// ---------- Crypto Fear & Greed (CoinMarketCap) ----------
// CoinMarketCap's official API. Without a key /public-api/v3/… is used (keyless, IP-based quota).
// If CMC_API_KEY is set in the environment, /v3/… with the key in X-CMC_PRO_API_KEY is used instead (free Basic plan is enough).
//   latest     → { data:{ value:78, value_classification:"Greed", update_time:"2026-08-23T00:08:10.031Z" } }
//   historical → { data:[ { timestamp:"1787356800", value:76, value_classification:"Greed" }, … ] }  newest first, one value/day 00:00 UTC
// Errors arrive as { status:{ error_code:"1011", error_message:"You've hit an IP rate limit." } } with HTTP 4xx.
const FG_HISTORY_MAX = 5000;          // row cap; the API pages 500 rows per call (CMC's series starts 2023-06-29, ~1,150 rows today)
const FG_MIN_INTERVAL_MS = 60 * 1000; // CMC updates every 15 minutes — no point fetching more often (protects the quota on repeated Update presses)
const FG_FORCE_MIN_MS = 10 * 1000;    // a forced refresh (Update button) may re-fetch after this — hard floor against hammering
let lastFg = null;                    // last successful response — shown with a warning if CMC does not respond
let fgForce = false;                  // set by /api/refresh?force=1

async function cmcJson(url, headers) {
  let r;
  try { r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(20000) }); }
  catch (e) { throw new Error('no contact with CoinMarketCap'); }
  const j = await r.json().catch(() => null);
  const st = (j && j.status) || {};
  if (!r.ok || (st.error_code != null && String(st.error_code) !== '0')) {
    const msg = st.error_message || `${r.status} ${r.statusText}`;
    throw new Error(r.status === 429 ? `CoinMarketCap: rate limit reached (${msg})` : `CoinMarketCap: ${msg}`);
  }
  if (!j || typeof j !== 'object') throw new Error(`CoinMarketCap: invalid response (HTTP ${r.status})`);
  return j;
}

let fgAttempt = null; // last attempt (successful or not) — the throttle also applies when CMC answers 429, otherwise we keep hammering
async function getFearGreed() {
  if (fgAttempt) {
    const age = Date.now() - fgAttempt.t;
    if (age < FG_FORCE_MIN_MS || (!fgForce && age < FG_MIN_INTERVAL_MS)) return fgAttempt.p;
  }
  fgForce = false;
  fgAttempt = { t: Date.now(), p: fetchFearGreed() };
  return fgAttempt.p;
}
async function fetchFearGreed() {
  const key = process.env.CMC_API_KEY || '';
  const root = String((config.sources && config.sources.fearGreed) || 'https://pro-api.coinmarketcap.com').replace(/\/+$/, '');
  const base = root + (key ? '/v3' : '/public-api/v3') + '/fear-and-greed/';
  // Only ever send the API key to CoinMarketCap itself. sources.fearGreed is editable config, and in a shared
  // repo an edited config must not be able to redirect the key to someone else's host.
  let cmcHost = '';
  try { cmcHost = new URL(root).host; } catch { /* malformed root — treated as untrusted below */ }
  if (key && cmcHost !== 'pro-api.coinmarketcap.com') {
    throw new Error(`CMC_API_KEY is set but sources.fearGreed points at "${cmcHost || root}" — refusing to send the key anywhere but pro-api.coinmarketcap.com`);
  }
  const headers = key ? { 'X-CMC_PRO_API_KEY': key } : {};
  try {
    let historyError = null;
    // the whole daily history: pages of 500 (API max), newest first; the first three pages in parallel, more only if the third was full
    const page = start => cmcJson(base + `historical?start=${start}&limit=500`, headers).then(j => {
      if (!j || !Array.isArray(j.data)) throw new Error('CoinMarketCap: unexpected history format');
      return j.data;
    });
    const historyAll = async () => {
      const pages = await Promise.all([1, 501, 1001].map(page));
      let rows = pages.flat(), start = 1501;
      while (pages[2].length === 500 && start <= FG_HISTORY_MAX) { const more = await page(start); rows = rows.concat(more); if (more.length < 500) break; start += 500; }
      return rows;
    };
    const [latest, histRows] = await Promise.all([
      cmcJson(base + 'latest', headers),
      historyAll().catch(e => { historyError = String(e.message || e); return null; }),
    ]);
    const d = (latest && latest.data) || {};
    const value = num(d.value);
    if (value == null) throw new Error('invalid value from CoinMarketCap');
    const dayIso = ts => { const n = Number(ts); return Number.isFinite(n) && n > 0 ? new Date(n * 1000).toISOString().slice(0, 10) : null; };
    const byDate = new Map();
    for (const r of (histRows || [])) {
      const date = dayIso(r.timestamp), v = num(r.value);
      if (date && v != null) byDate.set(date, { date, value: v, label: r.value_classification || null });
    }
    // if only the history fails, keep the last fetched one (with historyError + historyFetchedAt so the page can say how old it is)
    const history = histRows ? [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)) : (lastFg ? lastFg.v.history : []);
    const historyFetchedAt = histRows ? new Date().toISOString() : (lastFg ? lastFg.v.historyFetchedAt : null);
    const v = {
      value, label: d.value_classification || null, updateTime: d.update_time || null,
      keyed: !!key, history, historyError, historyFetchedAt, fetchedAt: new Date().toISOString(),
    };
    lastFg = { t: Date.now(), v };
    return v;
  } catch (e) {
    if (!lastFg) throw e;
    console.error(new Date().toISOString(), '/api/feargreed', e.message || e);
    return { ...lastFg.v, stale: true, fetchError: String(e.message || e) };
  }
}

// ---------- http ----------
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const routes = {
  '/api/portfolio': getPortfolio,
  '/api/holdings': () => cached('holdings', getHoldings, v => v.ok), // a failed fetch is not cached
  '/api/nav': () => cached('nav', getNav),
  '/api/perf': () => cached('perf', getPerf),
  '/api/quotes': () => cached('quotes', getQuotes, v => Object.values(v).some(q => !q.error)),
  '/api/feargreed': () => cached('feargreed', getFearGreed, v => !v.stale), // fallback value (stale) is not cached
  // equity-market Fear & Greed: the Yahoo series are cached 15 min inside the module; a plain /api/refresh only recomputes,
  // /api/refresh?force=1 (the Update button) re-fetches all series and lets CoinMarketCap be re-fetched too
  '/api/marketfg': () => cached('marketfg', () => marketfg.getMarketFearGreed(config.marketFearGreed), v => v.ok),
  '/api/config': async () => config,
  '/api/refresh': async (u) => {
    cache.clear();
    const force = u && u.searchParams.get('force') === '1';
    if (force) { marketfg.clearCache(); fgForce = true; }
    return { cleared: true, forced: force };
  },
};

// Listening on 127.0.0.1 keeps other machines out, but not a web page in your own browser: DNS rebinding
// lets evil.com resolve to 127.0.0.1 and read /api/config, which carries your positions. Such requests still
// carry the attacker's name in Host, so pinning Host to the loopback address we actually serve blocks them.
const ALLOWED_HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`, `[::1]:${PORT}`]);

const server = http.createServer(async (req, res) => {
  if (!ALLOWED_HOSTS.has(String(req.headers.host || '').toLowerCase())) {
    return send(res, 403, { error: 'unexpected Host header — open the page at ' + ADDR });
  }
  let u, p;
  try { u = new URL(req.url, ADDR); p = u.pathname; } catch { return send(res, 400, { error: 'invalid URL' }); }
  // /api/refresh clears caches and re-pulls every source, so it must not be reachable from a cross-site
  // <img> or <script> tag. Those can only issue GETs; requiring POST is enough to rule them out.
  if (p === '/api/refresh' && req.method !== 'POST') {
    return send(res, 405, { error: 'use POST for /api/refresh' });
  }
  try {
    if (routes[p]) return send(res, 200, await routes[p](u));
    if (p === '/' || p === '/index.html') {
      return send(res, 200, fs.readFileSync(path.join(ROOT, 'index.html')), 'text/html; charset=utf-8');
    }
    return send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(new Date().toISOString(), p, e.message || e);
    return send(res, 502, { error: String(e.message || e) });
  }
});

server.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.log(`Investments already seems to be running at ${ADDR} — opening it in the browser.`);
    if (process.platform === 'win32' && !process.env.NO_OPEN) exec(`start "" "${ADDR}"`);
    setTimeout(() => process.exit(0), 1500);
  } else { console.error('Server error:', e.message || e); process.exit(1); }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Investments running at ${ADDR}  (Ctrl+C or close the window to stop)`);
  if (process.platform === 'win32' && !process.env.NO_OPEN) exec(`start "" "${ADDR}"`);
  // capture the fund's holdings file every 30 minutes while the server runs, so a file day is not missed when the page is closed
  // (the fund republishes ~20:05 ET; a missed day merges multiple days into one net quantity change)
  setInterval(() => getHoldings().catch(e => console.error('snapshot capture:', e.message || e)), 30 * 60 * 1000).unref();
});
