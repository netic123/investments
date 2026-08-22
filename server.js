// Pabrai Dashboard — lokal server. Inga beroenden, kräver Node 18+.
// Hämtar fondens egna CSV-filer + kurser från Yahoo, sparar dagliga ögonblicksbilder,
// och serverar index.html. Starta: node server.js  (eller dubbelklicka start.bat)

const http = require('http');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');

const ROOT = __dirname;
const DATA = path.join(ROOT, 'data');
const CONFIG_PATH = path.join(DATA, 'config.json');
const SNAP_PATH = path.join(DATA, 'snapshots.json');

const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
const PORT = Number(process.env.PORT || config.port || 8765);
const ADDR = `http://127.0.0.1:${PORT}`; // 127.0.0.1, inte localhost — slipper IPv6-fallback på ~300 ms per anrop
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) PabraiDashboard/1.0';
const TTL_MS = 5 * 60 * 1000;

process.on('unhandledRejection', e => console.error('Ohanterat fel:', e && e.message || e));
process.on('uncaughtException', e => console.error('Oväntat fel:', e && e.message || e));

// ---------- cache: delar pågående hämtning mellan samtidiga anrop, cachar bara lyckade svar ----------
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
  catch (e) { throw new Error(`ingen kontakt med ${new URL(url).host}`); }
  if (!r.ok) throw new Error(`${r.status} ${r.statusText} (${shortName(url)})`);
  return r.text();
}
async function fetchJson(url) {
  let r;
  try { r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) }); }
  catch (e) { throw new Error(`ingen kontakt med ${new URL(url).host}`); }
  if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
  return r.json();
}

// Enkel CSV-parser — fondens filer har inga citerade kommatecken.
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

// ---------- ögonblicksbilder på disk (validerade, säkerhetskopierade vid fel, atomisk skrivning) ----------
function loadSnapshots() {
  if (!fs.existsSync(SNAP_PATH)) return [];
  try {
    const v = JSON.parse(fs.readFileSync(SNAP_PATH, 'utf8'));
    if (!Array.isArray(v)) throw new Error('inte en lista');
    return v.filter(s => s && typeof s.date === 'string' && s.rows && typeof s.rows === 'object');
  } catch (e) {
    const bak = SNAP_PATH + '.broken-' + Date.now();
    try { fs.copyFileSync(SNAP_PATH, bak); } catch {}
    console.error(`snapshots.json gick inte att läsa (${e.message}) — kopia sparad som ${path.basename(bak)}`);
    return [];
  }
}
function saveSnapshots(list) {
  list.sort((a, b) => a.date.localeCompare(b.date));
  const tmp = SNAP_PATH + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 1));
  fs.renameSync(tmp, SNAP_PATH);
}

// ---------- innehav ----------
async function getHoldings() {
  const cashSet = new Set(config.cashTickers || []);
  let live = null, fetchError = null;
  try {
    const rows = parseCsv(await fetchText(config.sources.holdings));
    if (!rows.length) throw new Error('tom innehavsfil');
    const fileDate = rows[0].Date;
    const date = isoFromUs(fileDate);
    if (!date) throw new Error(`oväntat datumformat: ${fileDate}`);
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
    if (!Object.keys(snap.rows).length) throw new Error('inga innehav i filen');
    live = snap;
  } catch (e) { fetchError = String(e.message || e); }

  const snaps = loadSnapshots();
  if (live) {
    const i = snaps.findIndex(s => s.date === live.date);
    const changed = i === -1 || JSON.stringify(snaps[i]) !== JSON.stringify(live);
    if (i === -1) snaps.push(live); else snaps[i] = live; // samma dag: senaste filen gäller
    if (changed) {
      try { saveSnapshots(snaps); }
      catch (e) { console.error('kunde inte spara snapshots.json:', e.message); fetchError = 'kunde inte spara ögonblicksbild (' + e.message + ')'; }
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
      kind: !ra ? 'NY' : !rb ? 'SÅLD HELT' : delta > 0 ? 'KÖP' : 'SÄLJ',
      localPrice: price, approxUsd: Math.abs(delta) * usdPerShare, absValue: Math.abs(delta) * usdPerShare,
      cashLike: cashLike.has(t), // penningmarknadsfond o.dyl. — visas i tabellen men räknas inte som affär
    });
  }
  return out.sort((x, y) => y.absValue - x.absValue);
}

// ---------- NAV / avkastning ----------
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
    history: history.slice(-250),
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

// ---------- kurser (Yahoo) ----------
async function yahooQuote(symbol) {
  const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const j = await fetchJson(u);
  const res = j.chart && j.chart.result && j.chart.result[0];
  if (!res) throw new Error(`inget resultat för ${symbol}`);
  const m = res.meta || {};
  // Gårdagens stängning = näst sista giltiga dagsstängningen. chartPreviousClose är stängningen FÖRE hela
  // intervallet och duger aldrig som "igår" — hellre tomt än fel siffra.
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
  const symbols = [...config.myPositions.map(p => p.yahoo), ...Object.values(config.fx || {})];
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
  '/api/holdings': () => cached('holdings', getHoldings, v => v.ok), // misslyckad hämtning cachas inte
  '/api/nav': () => cached('nav', getNav),
  '/api/perf': () => cached('perf', getPerf),
  '/api/quotes': () => cached('quotes', getQuotes, v => Object.values(v).some(q => !q.error)),
  '/api/config': async () => config,
  '/api/refresh': async () => { cache.clear(); return { cleared: true }; },
};

const server = http.createServer(async (req, res) => {
  let p;
  try { p = new URL(req.url, ADDR).pathname; } catch { return send(res, 400, { error: 'ogiltig URL' }); }
  try {
    if (routes[p]) return send(res, 200, await routes[p]());
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
    console.log(`Dashboarden verkar redan köras på ${ADDR} — öppnar den i webbläsaren.`);
    if (process.platform === 'win32' && !process.env.NO_OPEN) exec(`start "" "${ADDR}"`);
    setTimeout(() => process.exit(0), 1500);
  } else { console.error('Serverfel:', e.message || e); process.exit(1); }
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`Pabrai Dashboard körs på ${ADDR}  (Ctrl+C eller stäng fönstret för att stoppa)`);
  if (process.platform === 'win32' && !process.env.NO_OPEN) exec(`start "" "${ADDR}"`);
});
