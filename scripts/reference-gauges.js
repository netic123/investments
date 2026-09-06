#!/usr/bin/env node
'use strict';

// Reference gauges: independent, public readings shown next to the home-made
// Fear & Greed score so a reader can see whether it agrees with the world
// outside this site. The model itself is not changed by any of them.
//
//   CNN Fear & Greed (US)      the Internet Archive's latest snapshot of CNN's
//                              graphdata JSON (CNN's own endpoint answers 418
//                              to automated readers; the archive is public).
//                              The score, its rating and its time are shown
//                              with attribution; the 250-point history in the
//                              snapshot is used only to compare with this
//                              site's US score (correlation, mean gap, band
//                              agreement) and is not republished.
//   Cboe put/call ratios       one JSON per trading day on cdn.cboe.com since
//                              7 Oct 2019 (non-trading days answer 403), and
//                              the archived totalpc.csv for 1 Nov 2006 to
//                              4 Oct 2019; kept in data/cboe-putcall.json so a
//                              build fetches only the days it lacks and can
//                              rank today's ratio against the whole record.
//   OFR Financial Stress Index a daily CSV from the US Office of Financial
//                              Research (a US-government work), with credit,
//                              valuation, safe-asset, funding and volatility
//                              sub-indexes and US / other advanced / emerging
//                              contributions, two business days behind.
//   Crypto Fear & Greed        alternative.me's index (0–100, daily), the
//                              reference most crypto readers know.
//
// Everything is fetched by the build, never by the browser. A source that
// cannot be read is labelled (ok:false, fetchError) and the others still show.
//
//   node scripts/reference-gauges.js --check                    fetch everything and print it
//   node scripts/reference-gauges.js --from-published [url] [--expect-sha256 <hex>]
//        append the Cboe days the published api/refs.json fetched to data/cboe-putcall.json

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const CBOE_TARGET = path.join(ROOT, 'data', 'cboe-putcall.json');
const PUBLISHED_REFS_URL = 'https://netic123.github.io/investments/api/refs.json';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Investments/1.0';
const CNN_GRAPHDATA = 'production.dataviz.cnn.io/index/fearandgreed/graphdata';
const CNN_AVAILABILITY = `https://archive.org/wayback/available?url=${CNN_GRAPHDATA}`;
const CBOE_DAILY = 'https://cdn.cboe.com/data/us/options/market_statistics/daily/';
const CBOE_PAGE = 'https://www.cboe.com/us/options/market_statistics/daily/';
const OFR_CSV = 'https://www.financialresearch.gov/financial-stress-index/data/fsi.csv';
const OFR_PAGE = 'https://www.financialresearch.gov/financial-stress-index/';
const ALTME_API = 'https://api.alternative.me/fng/?limit=2';
const ALTME_PAGE = 'https://alternative.me/crypto/fear-and-greed-index/';
// the same five bands as the page (MARKET_BANDS) and CNN's ratings
const BANDS = [[0, 24.9, 'extreme fear'], [25, 44.9, 'fear'], [45, 55.9, 'neutral'], [56, 74.9, 'greed'], [75, 100, 'extreme greed']];
const bandOf = v => { const x = Number(v); if (!Number.isFinite(x)) return -1; for (let i = 0; i < BANDS.length; i++) if (x <= BANDS[i][1] || i === BANDS.length - 1) return i; return -1; };

const isoDay = d => d.toISOString().slice(0, 10);
const fetchOk = async (fetchImpl, url, { userAgent = USER_AGENT, timeoutMs = 30000, accept } = {}) => {
  let r;
  try { r = await fetchImpl(url, { headers: { 'User-Agent': userAgent, ...(accept ? { Accept: accept } : {}) }, signal: AbortSignal.timeout(timeoutMs) }); }
  catch (e) { throw new Error(`no contact with ${new URL(url).host}`); }
  if (!r.ok) { const err = new Error(`HTTP ${r.status}`); err.status = r.status; throw err; }
  return r;
};

// ---------- CNN via the Internet Archive ----------
function waybackTimestampToIso(ts) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(ts || ''));
  return m ? `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}Z` : null;
}
function parseCnn(json, { snapshotAt = null, snapshotUrl = null } = {}) {
  const fg = json && json.fear_and_greed;
  if (!fg || !Number.isFinite(Number(fg.score))) throw new Error('the snapshot carries no fear_and_greed score');
  const ts = fg.timestamp ? new Date(fg.timestamp) : null;
  const components = {};
  for (const k of ['market_momentum_sp500', 'market_momentum_sp125', 'stock_price_strength', 'stock_price_breadth', 'put_call_options', 'market_volatility_vix', 'market_volatility_vix_50', 'junk_bond_demand', 'safe_haven_demand']) {
    const c = json[k]; if (c && Number.isFinite(Number(c.score))) components[k] = { score: Number(c.score), rating: c.rating || null };
  }
  const byDate = new Map();
  for (const p of (json.fear_and_greed_historical && json.fear_and_greed_historical.data) || []) {
    const x = Number(p.x), y = Number(p.y); if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    byDate.set(isoDay(new Date(x)), { score: y, rating: p.rating || null });
  }
  const history = [...byDate.entries()].map(([date, v]) => ({ date, ...v })).sort((a, b) => a.date.localeCompare(b.date));
  return {
    score: Number(fg.score), rating: String(fg.rating || ''), timestamp: ts && !isNaN(ts) ? ts.toISOString() : null, date: ts && !isNaN(ts) ? isoDay(ts) : null,
    previousClose: Number.isFinite(Number(fg.previous_close)) ? Number(fg.previous_close) : null,
    previous1Week: Number.isFinite(Number(fg.previous_1_week)) ? Number(fg.previous_1_week) : null,
    previous1Month: Number.isFinite(Number(fg.previous_1_month)) ? Number(fg.previous_1_month) : null,
    previous1Year: Number.isFinite(Number(fg.previous_1_year)) ? Number(fg.previous_1_year) : null,
    components, history, snapshotAt, snapshotUrl,
  };
}
// This site's US score against CNN's over the days both have: Pearson correlation, the mean gap (this site minus CNN),
// the share of days in the same band and within one band. The joined series stays in memory.
function compareSeries(cnnHistory, modelHistory) {
  const model = new Map((modelHistory || []).filter(r => r && r.date && Number.isFinite(Number(r.score))).map(r => [r.date, Number(r.score)]));
  const pairs = (cnnHistory || []).filter(p => model.has(p.date)).map(p => ({ date: p.date, cnn: Number(p.score), model: model.get(p.date) }));
  const n = pairs.length;
  if (n < 2) return { n, from: null, to: null, correlation: null, meanGap: null, sameBandPct: null, withinOneBandPct: null };
  const mx = pairs.reduce((s, p) => s + p.model, 0) / n, my = pairs.reduce((s, p) => s + p.cnn, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const p of pairs) { sxy += (p.model - mx) * (p.cnn - my); sxx += (p.model - mx) ** 2; syy += (p.cnn - my) ** 2; }
  const correlation = sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : null;
  const same = pairs.filter(p => bandOf(p.model) === bandOf(p.cnn)).length, within = pairs.filter(p => Math.abs(bandOf(p.model) - bandOf(p.cnn)) <= 1).length;
  // the same model shifted down by its mean gap: how much of the disagreement is level rather than signal
  const gap = mx - my, sameShifted = pairs.filter(p => bandOf(p.model - gap) === bandOf(p.cnn)).length;
  return { n, from: pairs[0].date, to: pairs[n - 1].date, correlation, meanGap: gap, meanAbsGap: pairs.reduce((s, p) => s + Math.abs(p.model - p.cnn), 0) / n, sameBandPct: same / n * 100, withinOneBandPct: within / n * 100, sameBandShiftedPct: sameShifted / n * 100, meanAbsGapShifted: pairs.reduce((s, p) => s + Math.abs(p.model - gap - p.cnn), 0) / n };
}
async function fetchCnn({ fetchImpl = fetch, userAgent = USER_AGENT, modelHistory = null } = {}) {
  const fetchedAt = new Date().toISOString();
  const out = { name: 'CNN Fear & Greed (US)', page: 'https://www.cnn.com/markets/fear-and-greed', via: 'Internet Archive (web.archive.org)', fetchedAt };
  try {
    const avail = await (await fetchOk(fetchImpl, CNN_AVAILABILITY, { userAgent, accept: 'application/json' })).json();
    const closest = avail && avail.archived_snapshots && avail.archived_snapshots.closest;
    if (!closest || !closest.available || String(closest.status) !== '200' || !closest.timestamp) throw new Error('the Internet Archive lists no snapshot of CNN’s graphdata');
    const snapshotUrl = `https://web.archive.org/web/${closest.timestamp}id_/https://${CNN_GRAPHDATA}`;
    const r = await fetchOk(fetchImpl, snapshotUrl, { userAgent, timeoutMs: 45000 });
    let buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 2 && buf[0] === 0x1f && buf[1] === 0x8b) buf = zlib.gunzipSync(buf);
    const parsed = parseCnn(JSON.parse(buf.toString('utf8')), { snapshotAt: waybackTimestampToIso(closest.timestamp), snapshotUrl: `https://web.archive.org/web/${closest.timestamp}/https://${CNN_GRAPHDATA}` });
    const comparison = compareSeries(parsed.history, modelHistory);
    const { history, ...rest } = parsed; // the series is not published
    return { ...out, ok: true, fetchError: null, ...rest, historyPoints: history.length, comparison };
  } catch (error) {
    return { ...out, ok: false, fetchError: String(error && error.message || error) };
  }
}

// ---------- Cboe put/call ----------
function readCboeHistory(target = CBOE_TARGET) {
  if (!fs.existsSync(target)) return { source: `${CBOE_PAGE} (daily JSON on cdn.cboe.com since 2019-10-07) and the archived totalpc.csv (2006-11-01 to 2019-10-04)`, days: {} };
  const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  return { ...parsed, days: parsed.days && typeof parsed.days === 'object' ? parsed.days : {} };
}
function writeCboeHistory(history, target = CBOE_TARGET) {
  const days = Object.fromEntries(Object.keys(history.days).sort().map(k => [k, history.days[k]]));
  fs.writeFileSync(target, `${JSON.stringify({ ...history, days })}\n`, 'utf8');
}
function parseCboeDaily(json) {
  const ratio = n => { const x = ((json && json.ratios) || []).find(q => q && q.name === n); const v = x ? Number(x.value) : NaN; return Number.isFinite(v) ? v : null; };
  const t = ratio('TOTAL PUT/CALL RATIO');
  if (t == null) throw new Error('no TOTAL PUT/CALL RATIO in the day’s file');
  return { t, e: ratio('EQUITY PUT/CALL RATIO'), i: ratio('INDEX PUT/CALL RATIO') };
}
// Where today's ratio sits in the record: the share of days with a lower total ratio (a high ratio = more puts = fear).
function cboeStats(days, latestDate) {
  const keys = Object.keys(days).filter(k => days[k] && Number.isFinite(days[k].t)).sort();
  const upTo = keys.filter(k => k <= latestDate);
  const latest = days[latestDate];
  if (!latest || upTo.length < 5) return null;
  const last5 = upTo.slice(-5).map(k => days[k].t), fiveDay = last5.reduce((s, v) => s + v, 0) / last5.length;
  const all = keys.map(k => days[k].t);
  const pctBelow = v => all.filter(x => x < v).length / all.length * 100;
  // five-day averages across the record, for ranking the current five-day average like for like
  const fives = []; for (let j = 4; j < keys.length; j++) fives.push(keys.slice(j - 4, j + 1).reduce((s, k) => s + days[k].t, 0) / 5);
  return { latest: { date: latestDate, ...latest }, fiveDay, pctBelowLatest: pctBelow(latest.t), pctBelowFiveDay: fives.filter(x => x < fiveDay).length / fives.length * 100, historyFrom: keys[0], historyTo: keys[keys.length - 1], historyDays: keys.length };
}
async function fetchCboe({ fetchImpl = fetch, userAgent = USER_AGENT, history = null, today = null, maxDays = 25 } = {}) {
  const fetchedAt = new Date().toISOString();
  const out = { name: 'Cboe put/call ratios', page: CBOE_PAGE, fetchedAt };
  try {
    const hist = history || readCboeHistory();
    const days = { ...hist.days };
    const known = Object.keys(days).sort();
    const end = today ? new Date(`${today}T00:00:00Z`) : new Date(); end.setUTCHours(0, 0, 0, 0);
    const start = known.length ? new Date(`${known[known.length - 1]}T00:00:00Z`) : new Date(end); if (known.length) start.setUTCDate(start.getUTCDate() + 1);
    const newDays = {}, tried = [];
    for (let d = new Date(start); d <= end && tried.length < maxDays; d.setUTCDate(d.getUTCDate() + 1)) {
      const dow = d.getUTCDay(); if (dow === 0 || dow === 6) continue;
      const iso = isoDay(d); tried.push(iso);
      try {
        const r = await fetchOk(fetchImpl, `${CBOE_DAILY}${iso}_daily_options`, { userAgent, timeoutMs: 20000 });
        const day = parseCboeDaily(await r.json()); days[iso] = day; newDays[iso] = day;
      } catch (e) { if (e && (e.status === 403 || e.status === 404)) continue; throw e; }
    }
    const latestDate = Object.keys(days).sort().pop();
    const stats = latestDate ? cboeStats(days, latestDate) : null;
    if (!stats) throw new Error('no put/call record to rank against');
    return { ...out, ok: true, fetchError: null, ...stats, newDays, requests: tried.length, note: 'Cboe: furnished without responsibility for accuracy; a ratio above 1 means more puts than calls traded' };
  } catch (error) {
    return { ...out, ok: false, fetchError: String(error && error.message || error) };
  }
}
function mergeCboeDays(history, newDays) {
  let added = 0; const days = { ...history.days };
  for (const [k, v] of Object.entries(newDays || {})) { if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v || !Number.isFinite(v.t)) continue; if (!days[k]) added++; days[k] = { t: v.t, e: v.e == null ? null : v.e, i: v.i == null ? null : v.i }; }
  return { history: { ...history, days }, added };
}

// ---------- OFR Financial Stress Index ----------
function parseOfrCsv(text) {
  const lines = String(text || '').replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (!lines.length) throw new Error('empty CSV');
  const head = lines[0].split(',').map(s => s.trim());
  const col = name => head.findIndex(h => h.toLowerCase() === name.toLowerCase());
  const idx = { date: col('Date'), fsi: col('OFR FSI'), credit: col('Credit'), equity: col('Equity valuation'), safe: col('Safe assets'), funding: col('Funding'), vol: col('Volatility'), us: col('United States'), other: col('Other advanced economies'), em: col('Emerging markets') };
  if (idx.date < 0 || idx.fsi < 0) throw new Error(`unexpected header: ${lines[0].slice(0, 120)}`);
  const num = v => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const rows = [];
  for (const line of lines.slice(1)) { const c = line.split(','); const date = (c[idx.date] || '').trim(); const fsi = num(c[idx.fsi]); if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || fsi == null) continue; rows.push({ date, fsi, credit: num(c[idx.credit]), equityValuation: num(c[idx.equity]), safeAssets: num(c[idx.safe]), funding: num(c[idx.funding]), volatility: num(c[idx.vol]), us: num(c[idx.us]), otherAdvanced: num(c[idx.other]), em: num(c[idx.em]) }); }
  if (!rows.length) throw new Error('no data rows');
  rows.sort((a, b) => a.date.localeCompare(b.date));
  const latest = rows[rows.length - 1];
  const pctBelow = rows.filter(r => r.fsi < latest.fsi).length / rows.length * 100;
  return { latest, pctBelow, historyFrom: rows[0].date, days: rows.length };
}
async function fetchOfr({ fetchImpl = fetch, userAgent = USER_AGENT } = {}) {
  const fetchedAt = new Date().toISOString();
  const out = { name: 'OFR Financial Stress Index', page: OFR_PAGE, csv: OFR_CSV, fetchedAt };
  try {
    const r = await fetchOk(fetchImpl, OFR_CSV, { userAgent, timeoutMs: 45000 });
    const parsed = parseOfrCsv(await r.text());
    return { ...out, ok: true, fetchError: null, ...parsed, note: 'a US-government work; positive = above-average stress, negative = calmer than average; two business days behind' };
  } catch (error) { return { ...out, ok: false, fetchError: String(error && error.message || error) }; }
}

// ---------- alternative.me crypto Fear & Greed ----------
function parseAltMe(json) {
  const rows = (json && Array.isArray(json.data) ? json.data : []).map(d => ({ value: Number(d.value), classification: String(d.value_classification || ''), timestamp: Number(d.timestamp) })).filter(d => Number.isFinite(d.value) && Number.isFinite(d.timestamp)).sort((a, b) => b.timestamp - a.timestamp);
  if (!rows.length) throw new Error('no data rows');
  const latest = rows[0], prev = rows[1] || null;
  return { value: latest.value, classification: latest.classification, date: isoDay(new Date(latest.timestamp * 1000)), previous: prev ? { value: prev.value, classification: prev.classification, date: isoDay(new Date(prev.timestamp * 1000)) } : null };
}
async function fetchAltMe({ fetchImpl = fetch, userAgent = USER_AGENT } = {}) {
  const fetchedAt = new Date().toISOString();
  const out = { name: 'Crypto Fear & Greed (alternative.me)', page: ALTME_PAGE, api: ALTME_API, fetchedAt };
  try {
    const r = await fetchOk(fetchImpl, ALTME_API, { userAgent, accept: 'application/json' });
    return { ...out, ok: true, fetchError: null, ...parseAltMe(await r.json()), note: 'alternative.me’s index, 0 = extreme fear, 100 = extreme greed, one value per day (UTC)' };
  } catch (error) { return { ...out, ok: false, fetchError: String(error && error.message || error) }; }
}

// ---------- all four ----------
async function referenceGauges({ fetchImpl = fetch, userAgent = USER_AGENT, modelHistoryUsa = null, cboeHistory = null, today = null } = {}) {
  const fetchedAt = new Date().toISOString();
  const [cnn, cboe, ofr, crypto] = await Promise.all([
    fetchCnn({ fetchImpl, userAgent, modelHistory: modelHistoryUsa }),
    fetchCboe({ fetchImpl, userAgent, history: cboeHistory, today }),
    fetchOfr({ fetchImpl, userAgent }),
    fetchAltMe({ fetchImpl, userAgent }),
  ]);
  return { ok: !!(cnn.ok && cboe.ok && ofr.ok && crypto.ok), fetchedAt, cnn, cboe, ofr, crypto, failed: [['cnn', cnn], ['cboe', cboe], ['ofr', ofr], ['crypto', crypto]].filter(([, v]) => !v.ok).map(([k]) => k) };
}
function summarize(refs) {
  if (!refs) return 'not fetched';
  const p = [];
  p.push(refs.cnn && refs.cnn.ok ? `CNN ${refs.cnn.score.toFixed(1)} ${refs.cnn.rating} (${refs.cnn.date}, archive ${refs.cnn.snapshotAt})` : `CNN failed (${refs.cnn && refs.cnn.fetchError})`);
  p.push(refs.cboe && refs.cboe.ok ? `Cboe P/C ${refs.cboe.latest.t} (${refs.cboe.latest.date}, ${Object.keys(refs.cboe.newDays || {}).length} new day(s))` : `Cboe failed (${refs.cboe && refs.cboe.fetchError})`);
  p.push(refs.ofr && refs.ofr.ok ? `OFR FSI ${refs.ofr.latest.fsi} (${refs.ofr.latest.date})` : `OFR failed (${refs.ofr && refs.ofr.fetchError})`);
  p.push(refs.crypto && refs.crypto.ok ? `alt.me ${refs.crypto.value} ${refs.crypto.classification} (${refs.crypto.date})` : `alt.me failed (${refs.crypto && refs.crypto.fetchError})`);
  return p.join('; ');
}

// The record job: append the Cboe days the published api/refs.json fetched, only when the served bytes match the digest
// build.json names for the file (a stale CDN copy is refused) and only days the committed file lacks.
async function persistPublished({ url = PUBLISHED_REFS_URL, target = CBOE_TARGET, fetchImpl = fetch, log = () => {}, expectedSha256 = '' } = {}) {
  const response = await fetchImpl(url, { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (expectedSha256 && sha256 !== expectedSha256) throw new Error(`the served refs.json (${sha256}) does not match the digest this build published (${expectedSha256}); nothing written`);
  if (!expectedSha256) log('no digest given for the published refs.json; importing it unverified');
  const refs = JSON.parse(bytes.toString('utf8'));
  const history = readCboeHistory(target);
  const { history: merged, added } = mergeCboeDays(history, refs && refs.cboe && refs.cboe.ok ? refs.cboe.newDays : {});
  if (added) writeCboeHistory(merged, target);
  log(`${added ? 'updated' : 'unchanged'} ${path.relative(ROOT, target)}${added ? `: ${added} new day(s), record to ${Object.keys(merged.days).sort().pop()}` : ''}`);
  return { written: added > 0, added, sha256 };
}

async function main() {
  const args = process.argv.slice(2);
  const log = line => process.stdout.write(`${line}\n`);
  if (args[0] === '--from-published') {
    const at = args.indexOf('--expect-sha256');
    return persistPublished({ url: args[1] && !args[1].startsWith('--') ? args[1] : PUBLISHED_REFS_URL, expectedSha256: at >= 0 ? String(args[at + 1] || '').trim() : '', log });
  }
  const refs = await referenceGauges();
  log(summarize(refs));
  if (refs.cnn.ok) log(`CNN comparison: ${JSON.stringify(refs.cnn.comparison)}; components ${JSON.stringify(refs.cnn.components)}`);
  if (refs.cboe.ok) log(`Cboe: 5-day ${refs.cboe.fiveDay.toFixed(3)}, below-latest ${refs.cboe.pctBelowLatest.toFixed(1)} %, record ${refs.cboe.historyFrom} → ${refs.cboe.historyTo} (${refs.cboe.historyDays} days)`);
  if (refs.ofr.ok) log(`OFR: ${JSON.stringify(refs.ofr.latest)}, below ${refs.ofr.pctBelow.toFixed(1)} % of days since ${refs.ofr.historyFrom}`);
  return refs;
}

module.exports = { ALTME_API, BANDS, CBOE_DAILY, CBOE_TARGET, CNN_AVAILABILITY, OFR_CSV, PUBLISHED_REFS_URL, bandOf, cboeStats, compareSeries, fetchAltMe, fetchCboe, fetchCnn, fetchOfr, mergeCboeDays, parseAltMe, parseCboeDaily, parseCnn, parseOfrCsv, persistPublished, readCboeHistory, referenceGauges, summarize, waybackTimestampToIso, writeCboeHistory };

if (require.main === module) main().catch(error => {
  process.stderr.write(`reference-gauges failed: ${error && error.message || error}\n`);
  process.exitCode = 1;
});
