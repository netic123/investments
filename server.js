// Investments — local server. No dependencies, requires Node 18+.
// Fetches the fund's own CSV files + quotes from Yahoo, stores daily snapshots,
// and serves index.html. Start: node server.js  (or double-click start.bat)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const marketfg = require('./marketfg'); // one six-component Fear & Greed model for Crypto/Sweden/USA/Europe/Global

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const CONFIG_PATH = path.join(DATA, 'config.json');
const SNAP_PATH = process.env.INVESTMENTS_SNAPSHOT_PATH
  ? path.resolve(process.env.INVESTMENTS_SNAPSHOT_PATH)
  : path.join(DATA, 'snapshots.json');

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

// Your own focus list lives outside the committed config so the repo can be shared without it.
// data/positions.local.json is gitignored; if it is missing we fall back to the example so the server still starts.
const POSITIONS_PATH = path.join(DATA, 'positions.local.json');
const POSITIONS_PUBLIC_PATH = path.join(DATA, 'positions.public.json');
const POSITIONS_EXAMPLE_PATH = path.join(DATA, 'positions.example.json');
const PUBLIC_BUILD = process.env.INVESTMENTS_PUBLIC_BUILD === '1';
const PUBLIC_POSITION_KEYS = ['ticker', 'fundTicker', 'secTicker', 'yahoo', 'entry', 'currency', 'nextReport', 'nextReportApprox', 'nextReportNote'];
const sanitizePublicPosition = position => Object.fromEntries(PUBLIC_POSITION_KEYS
  .filter(key => key === 'entry' || Object.prototype.hasOwnProperty.call(position, key))
  .map(key => [key, key === 'entry' ? null : position[key]]));
const loadedPositions = (() => {
  let localIssue = null;
  // A Pages build is public. Even if someone runs it on a machine that has the ignored local file,
  // it may serialize only the separately approved committed public watchlist, whose entry prices are null.
  const sources = PUBLIC_BUILD ? [POSITIONS_PUBLIC_PATH] : [POSITIONS_PATH, POSITIONS_EXAMPLE_PATH];
  for (const p of sources) {
    try {
      const sourceList = JSON.parse(fs.readFileSync(p, 'utf8')).myPositions;
      if (Array.isArray(sourceList)) {
        const demo = p === POSITIONS_EXAMPLE_PATH;
        const publicWatchlist = p === POSITIONS_PUBLIC_PATH;
        const list = publicWatchlist ? sourceList.map(sanitizePublicPosition) : sourceList;
        if (demo) console.log('data/positions.local.json unavailable — using the example watchlist. Copy the example file and enter your own.');
        return {
          list,
          meta: {
            source: publicWatchlist ? 'public' : demo ? 'example' : 'local',
            demo,
            public: publicWatchlist,
            warning: publicWatchlist
              ? 'Public watchlist intentionally omits entry prices'
              : demo ? (localIssue || 'data/positions.local.json was not found') : null,
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

// ---------- http ----------
function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}
const routes = {
  '/api/holdings': () => cached('holdings', getHoldings, v => v.ok), // a failed fetch is not cached
  '/api/nav': () => cached('nav', getNav),
  '/api/perf': () => cached('perf', getPerf),
  '/api/quotes': () => cached('quotes', getQuotes, v => Object.values(v).some(q => !q.error)),
  // All five market tabs come from this one model response. Yahoo series are cached for 15 minutes inside the module;
  // a plain /api/refresh recomputes, while /api/refresh?force=1 re-fetches every configured daily series.
  '/api/marketfg': () => cached('marketfg', () => marketfg.getMarketFearGreed(config.marketFearGreed), v => {
    const expected = Object.keys((config.marketFearGreed && config.marketFearGreed.markets) || {}).sort();
    const actual = Object.keys((v && v.markets) || {}).sort();
    return !!(v && v.ok) && Object.keys(v.failed || {}).length === 0 && JSON.stringify(actual) === JSON.stringify(expected);
  }),
  '/api/config': async () => config,
  '/api/refresh': async (u) => {
    cache.clear();
    const force = u && u.searchParams.get('force') === '1';
    if (force) marketfg.clearCache();
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
