#!/usr/bin/env node
'use strict';

// Pabrai's private funds on Borsa Istanbul, read from KAP, Turkey's Public
// Disclosure Platform (kap.org.tr, run by the central registry MKK). Every
// listed company's general-information form on KAP carries the table
// "Breakdown of Shareholders Holding More Than 5% of the Capital and Voting
// Rights" (kpy41_acc5_sermayede_dogrudan) as data embedded in the page:
// direct holder, nominal capital held, % of capital, % of votes, plus the
// date KAP stamps on the entry. The Pabrai Investment Funds (II, IV and 3)
// are Pabrai's private funds; their Turkish stakes are several times the
// ETF's (3.7x at Gimat, 26x at Reysas on 6 Sep 2026) and appear in no SEC
// filing. The ETF itself appears under its former name "Pabrai Wagons Fund"
// where it holds 5 % or more (Gimat).
//
// server.js reads the pages configured in data/config.json (names[<ticker>].kap)
// on every build (/api/kap) and appends the committed history; the record job
// in .github/workflows/pages.yml persists a changed Pabrai row into
// data/kap-holders.json with --from-published, so the page can show when a
// fund's stake changed. Only the Pabrai rows are kept in the history, so the
// file changes only when one of them does. seenAt is the fetch time of the
// build whose published kap.json the record job persisted (a push build or
// the daily slot), which can be up to a day after the first build that read
// the state; a served kap.json is imported only when its bytes match the
// digest build.json names for it and its read is later than the last
// recorded one, so a stale CDN copy cannot append a phantom change.
//
//   node scripts/kap-holders.js --check                    fetch the configured pages and print the Pabrai rows
//   node scripts/kap-holders.js --record                   fetch them and append a changed row to data/kap-holders.json
//   node scripts/kap-holders.js --from-published [url] [--expect-sha256 <hex>]
//                                                          persist the rows the published api/kap.json carries
//
// Nominal capital: KAP's share-group item (kpy41_acc5_sermayeyi_temsil_eden)
// states the nominal value per share; it is read here and exposed as
// nominalValuePerShare when every group states the same per-share value and
// it is smaller than the group's nominal total (TAB Gida's entry repeats the
// group totals in the per-share column, which is refused, so the value is null
// there). Where it is 1 TL the figures are share counts; the page says for
// which companies that holds. The paid-in capital equals the table's total for
// all five, which proves nothing about the per-share value.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_TARGET = path.join(ROOT, 'data', 'kap-holders.json');
const PUBLISHED_KAP_URL = 'https://netic123.github.io/investments/api/kap.json';
const PAGE_BASE = 'https://www.kap.org.tr/en/sirket-bilgileri/genel/';
const HOLDERS_KEY = 'kpy41_acc5_sermayede_dogrudan';
const CAPITAL_KEY = 'kpy41_acc5_odenmis_sermaye';
const SHARE_GROUPS_KEY = 'kpy41_acc5_sermayeyi_temsil_eden';
const TABLE_TITLE = 'Breakdown of Shareholders Holding More Than 5% of the Capital and Voting Rights';
const SOURCE = 'KAP (Public Disclosure Platform, Borsa Istanbul): company general-information pages, the >5 % shareholder table';
const HISTORY_NOTE = 'One observation per change in a Pabrai row (a private fund, or the ETF under its former name) of a company’s >5 % direct-holder table on KAP; seenAt is the fetch time of the build whose published kap.json the record job persisted (a push build or the daily slot), which can be up to a day after the first build that read the state; tableDate is the date KAP stamps on the table. Shares are nominal lira of capital; KAP’s share-group table states 1 TL per share for Reysas REIT, Reysas, TAV and Gimat, and is malformed for TAB Gida.';
const PABRAI = /PABRAI/i;
// the ETF's own row: its former name as a mutual fund, still used by the registry
const ETF_ROW = /WAGONS/i;
const OTHER_ROW = /^(DİĞER|DIĞER|DIGER|OTHER)$/i;
const TOTAL_ROW = /^(TOPLAM|TOTAL)$/i;
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Investments/1.0';

// "360.090.525,84" -> 360090525.84 (Turkish thousands '.' and decimal ',')
function turkishNumber(text) {
  const s = String(text == null ? '' : text).trim();
  if (!s) return null;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

// "05/09/2026" or "20/01/2026 16:02:49" -> "2026-09-05"
function kapDate(text) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s|$)/.exec(String(text == null ? '' : text).trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
}

// The page embeds its data as JSON inside JavaScript strings, so every quote is escaped once.
const unescapePage = html => String(html || '').replace(/\\"/g, '"');

// The value of one embedded item ("itemKey":"<key>","value":<json>), with the creationDate KAP stamps on the
// item. The value is an array (bracket-matched, strings respected) or a string.
function extractItem(text, key) {
  const marker = `"itemKey":"${key}","value":`;
  const at = text.indexOf(marker);
  if (at < 0) return null;
  let i = at + marker.length;
  let value;
  if (text[i] === '[') {
    let depth = 0, inString = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inString) { if (ch === '\\') j++; else if (ch === '"') inString = false; continue; }
      if (ch === '"') inString = true;
      else if (ch === '[') depth++;
      else if (ch === ']' && --depth === 0) { value = JSON.parse(text.slice(i, j + 1)); i = j + 1; break; }
    }
    if (value === undefined) throw new Error(`unterminated array for ${key}`);
  } else if (text[i] === '"') {
    const m = /^"((?:[^"\\]|\\.)*)"/.exec(text.slice(i));
    if (!m) throw new Error(`unterminated string for ${key}`);
    value = JSON.parse(m[0]); i += m[0].length;
  } else if (text.startsWith('null', i)) { value = null; i += 4; }
  else throw new Error(`unexpected value for ${key}`);
  const tail = /^,"disclosureIndex":(?:null|"[^"]*"|\d+),"creationDate":(null|"[^"]*")/.exec(text.slice(i, i + 200));
  const creationDate = tail && tail[1] !== 'null' ? JSON.parse(tail[1]) : null;
  return { value, creationDate, tableDate: kapDate(creationDate) };
}

// KAP's share-group table: the nominal value per share every group states, when each states the same value and
// it is smaller than the group's nominal total (a per-share column that repeats the group totals is refused);
// null when the item is absent, malformed or the groups disagree.
function nominalValuePerShare(text) {
  const item = extractItem(text, SHARE_GROUPS_KEY);
  if (!item || !Array.isArray(item.value) || !item.value.length) return null;
  const groups = item.value.map(g => ({ per: turkishNumber(g && g.nominalValuePerShare), total: turkishNumber(g && g.nominalValueOfShares) }));
  if (groups.some(g => !(g.per > 0) || !(g.total > 0) || g.per >= g.total)) return null;
  const first = groups[0].per;
  return groups.every(g => Math.abs(g.per - first) < 1e-9) ? first : null;
}

// One company page -> the holder table. etfShares (the ETF's share count from its daily file) lets a Pabrai row
// that equals it to the share be recognised as the ETF itself even under another name.
function parseKapHolders(html, { etfShares = null } = {}) {
  const text = unescapePage(html);
  const holders = extractItem(text, HOLDERS_KEY);
  if (!holders || !Array.isArray(holders.value)) throw new Error('the >5 % shareholder table was not found in the page');
  const capital = extractItem(text, CAPITAL_KEY);
  const paidInCapital = capital && typeof capital.value === 'string' ? turkishNumber(capital.value) : null;
  const rows = holders.value.map(r => {
    const holder = String(r.shareholder || '').replace(/\s+/g, ' ').trim();
    const shares = turkishNumber(r.shareInCapital);
    const pabrai = PABRAI.test(holder);
    const etf = pabrai && (ETF_ROW.test(holder) || (etfShares != null && shares != null && Math.abs(shares - etfShares) < 1));
    return { holder, shares, pct: turkishNumber(r.ratioInCapital), votingPct: turkishNumber(r.votingRightRatio), pabrai, etf, other: OTHER_ROW.test(holder), total: TOTAL_ROW.test(holder) };
  });
  const totalRow = rows.find(r => r.total);
  const totalShares = totalRow ? totalRow.shares : paidInCapital;
  if (!(totalShares > 0)) throw new Error('the table carries no total');
  const listed = rows.filter(r => !r.other && !r.total);
  const listedPct = listed.reduce((s, r) => s + (r.pct || 0), 0);
  if (listedPct > 100.5) throw new Error(`the listed holders sum to ${listedPct.toFixed(2)} % of capital`);
  return { tableDate: holders.tableDate, paidInCapital, totalShares, nominalValuePerShare: nominalValuePerShare(text), rows };
}

// The Pabrai rows of a parsed table: the private funds, and the ETF's own row where it is listed.
function pabraiRows(parsed) { return (parsed && parsed.rows || []).filter(r => r.pabrai); }
function pabraiSummary(parsed) {
  const rows = pabraiRows(parsed);
  const privateRows = rows.filter(r => !r.etf), etfRow = rows.find(r => r.etf) || null;
  return {
    privateRows, etfRow,
    privatePct: privateRows.reduce((s, r) => s + (r.pct || 0), 0),
    privateShares: privateRows.reduce((s, r) => s + (r.shares || 0), 0),
  };
}

async function fetchCompany(company, { fetchImpl = fetch, userAgent = USER_AGENT, timeoutMs = 20000, base = PAGE_BASE, etfShares = null } = {}) {
  const url = `${base}${company.oid}`;
  const fetchedAt = new Date().toISOString();
  const out = { ticker: company.ticker, code: company.code || null, name: company.name || null, oid: company.oid, url, fetchedAt };
  try {
    let response;
    try { response = await fetchImpl(url, { headers: { 'User-Agent': userAgent, Accept: 'text/html' }, signal: AbortSignal.timeout(timeoutMs) }); }
    catch (e) { throw new Error(`no contact with ${new URL(url).host}`); }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const parsed = parseKapHolders(html, { etfShares });
    return { ...out, ok: true, fetchError: null, bytes: Buffer.byteLength(html), ...parsed, ...pabraiSummary(parsed) };
  } catch (error) {
    return { ...out, ok: false, fetchError: String(error && error.message || error), rows: [], privateRows: [], etfRow: null, privatePct: null, privateShares: null, tableDate: null, totalShares: null, paidInCapital: null, nominalValuePerShare: null };
  }
}

// The companies the configuration names: names[<ticker>].kap = { oid, code }.
function configuredCompanies(config) {
  return Object.entries((config && config.names) || {})
    .filter(([, entry]) => entry && entry.kap && entry.kap.oid)
    .map(([ticker, entry]) => ({ ticker, code: entry.kap.code || ticker.split(' ')[0], oid: entry.kap.oid, name: entry.name || ticker }));
}

// ---------- history: data/kap-holders.json ----------
const emptyHistory = () => ({ source: SOURCE, note: HISTORY_NOTE, companies: {} });

function readHistory(target = DEFAULT_TARGET) {
  if (!fs.existsSync(target)) return emptyHistory();
  const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
  return { ...emptyHistory(), ...parsed, companies: parsed.companies && typeof parsed.companies === 'object' ? parsed.companies : {} };
}
function writeHistory(history, target = DEFAULT_TARGET) {
  fs.writeFileSync(target, `${JSON.stringify(history, null, 1)}\n`, 'utf8');
}

// What an observation keeps: the Pabrai rows only, plus the table's total and date.
function observationOf(company, seenAt) {
  return {
    seenAt: seenAt || company.fetchedAt || null,
    tableDate: company.tableDate || null,
    totalShares: company.totalShares == null ? null : company.totalShares,
    rows: pabraiRows(company).map(r => ({ holder: r.holder, shares: r.shares, pct: r.pct, votingPct: r.votingPct, etf: !!r.etf })),
  };
}
const rowsKey = rows => JSON.stringify((rows || []).map(r => [r.holder, r.shares, r.pct]).sort());
function sameObservation(a, b) { return !!a && !!b && rowsKey(a.rows) === rowsKey(b.rows) && (a.totalShares == null) === (b.totalShares == null) && Math.abs((a.totalShares || 0) - (b.totalShares || 0)) < 1; }

// Append one company's current table to its history when it differs from the last observation and was read later
// than it (a stale copy of an earlier build's kap.json carries an older fetch time and is refused). Pure.
function mergeObservation(history, company, seenAt) {
  if (!company || !company.ok) return { history, added: false };
  const list = Array.isArray(history.companies[company.ticker]) ? history.companies[company.ticker] : [];
  const current = observationOf(company, seenAt);
  const last = list[list.length - 1];
  if (sameObservation(last, current)) return { history, added: false };
  if (last && last.seenAt && current.seenAt && String(current.seenAt) <= String(last.seenAt)) return { history, added: false, stale: true };
  return { history: { ...history, companies: { ...history.companies, [company.ticker]: [...list, current] } }, added: true };
}
function mergeCurrent(history, kap) {
  let merged = history, added = [], stale = [];
  for (const company of (kap && kap.companies) || []) {
    const r = mergeObservation(merged, company, kap.fetchedAt);
    merged = r.history; if (r.added) added.push(company.ticker); if (r.stale) stale.push(company.ticker);
  }
  return { history: merged, added, stale };
}

// The changes a company's observations record: per holder, between consecutive observations. The direction is the
// percentage's (what the table is about); shares that move with the percentage unchanged are a capital change
// (a bonus issue, a cancellation), not a purchase or a sale.
function changesOf(observations) {
  const list = Array.isArray(observations) ? observations : [];
  const out = [];
  const kindOf = (a, b) => !a ? 'listed' : !b ? 'no longer listed' : a.pct != null && b.pct != null && a.pct !== b.pct ? (b.pct > a.pct ? 'up' : 'down') : 'capital change';
  for (let i = 1; i < list.length; i++) {
    const before = Object.fromEntries((list[i - 1].rows || []).map(r => [r.holder, r])), after = Object.fromEntries((list[i].rows || []).map(r => [r.holder, r]));
    for (const holder of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const a = before[holder], b = after[holder];
      if (a && b && Math.abs((a.shares || 0) - (b.shares || 0)) < 1 && a.pct === b.pct) continue;
      out.push({ seenAt: list[i].seenAt, tableDate: list[i].tableDate, holder, etf: !!((b || a).etf), kind: kindOf(a, b), sharesFrom: a ? a.shares : null, sharesTo: b ? b.shares : null, pctFrom: a ? a.pct : null, pctTo: b ? b.pct : null });
    }
  }
  return out;
}

// One line for api/build.json.
function summarize(kap) {
  if (!kap) return 'not fetched';
  const cos = kap.companies || [], okc = cos.filter(c => c.ok);
  const rows = okc.map(c => `${c.code || c.ticker} ${pabraiRows(c).length}`).join(', ');
  return `${okc.length} of ${cos.length} KAP pages read${okc.length ? `; Pabrai rows: ${rows}` : ''}${cos.length > okc.length ? `; failed: ${cos.filter(c => !c.ok).map(c => `${c.code || c.ticker} (${c.fetchError})`).join(', ')}` : ''}`;
}

// Persist the Pabrai rows the published api/kap.json carries. With expectedSha256 (the digest build.json names for
// api/kap.json) a served file with other bytes is refused, nothing written; without one the import is unverified.
async function persistPublished({ url = PUBLISHED_KAP_URL, target = DEFAULT_TARGET, fetchImpl = fetch, log = () => {}, expectedSha256 = '' } = {}) {
  const response = await fetchImpl(url, { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const sha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  if (expectedSha256 && sha256 !== expectedSha256) throw new Error(`the served kap.json (${sha256}) does not match the digest this build published (${expectedSha256}); nothing written`);
  if (!expectedSha256) log('no digest given for the published kap.json; importing it unverified');
  const kap = JSON.parse(bytes.toString('utf8'));
  const history = readHistory(target);
  const { history: merged, added, stale } = mergeCurrent(history, kap);
  if (added.length) writeHistory(merged, target);
  log(`${added.length ? 'updated' : 'unchanged'} ${path.relative(ROOT, target)}${added.length ? `: new observation for ${added.join(', ')} (read ${kap.fetchedAt})` : ''}${stale.length ? `; refused a read not later than the recorded one for ${stale.join(', ')}` : ''}`);
  return { written: added.length > 0, added, stale, sha256 };
}

async function fetchAll(config, { fetchImpl = fetch, userAgent, timeoutMs, base, etfSharesOf = () => null } = {}) {
  const companies = configuredCompanies(config);
  const fetchedAt = new Date().toISOString();
  const results = await Promise.all(companies.map(c => fetchCompany(c, { fetchImpl, userAgent, timeoutMs, base: base || (config.sources && config.sources.kapCompanyPage) || PAGE_BASE, etfShares: etfSharesOf(c.ticker) })));
  return { ok: results.length > 0 && results.every(r => r.ok), fetchedAt, source: SOURCE, tableTitle: TABLE_TITLE, companies: results, failed: results.filter(r => !r.ok).map(r => r.ticker) };
}

async function main() {
  const args = process.argv.slice(2);
  const log = line => process.stdout.write(`${line}\n`);
  if (args[0] === '--from-published') {
    const at = args.indexOf('--expect-sha256');
    const url = args[1] && !args[1].startsWith('--') ? args[1] : PUBLISHED_KAP_URL;
    return persistPublished({ url, expectedSha256: at >= 0 ? String(args[at + 1] || '').trim() : '', log });
  }
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
  const kap = await fetchAll(config);
  for (const c of kap.companies) {
    log(`${c.ticker}${c.ok ? ` table dated ${c.tableDate || 'n/a'}, total ${c.totalShares}, nominal/share ${c.nominalValuePerShare == null ? 'not confirmed' : c.nominalValuePerShare + ' TL'}, ${pabraiRows(c).map(r => `${r.holder} ${r.pct} % (${r.shares})${r.etf ? ' [the ETF]' : ''}`).join('; ') || 'no Pabrai row'}` : ` FAILED: ${c.fetchError}`}`);
  }
  if (args[0] === '--record') {
    const { history, added } = mergeCurrent(readHistory(), kap);
    if (added.length) writeHistory(history);
    log(`${added.length ? 'updated' : 'unchanged'} data/kap-holders.json${added.length ? `: ${added.join(', ')}` : ''}`);
  }
  return kap;
}

module.exports = { CAPITAL_KEY, DEFAULT_TARGET, HISTORY_NOTE, HOLDERS_KEY, PAGE_BASE, PUBLISHED_KAP_URL, SHARE_GROUPS_KEY, SOURCE, TABLE_TITLE, changesOf, configuredCompanies, extractItem, fetchAll, fetchCompany, kapDate, mergeCurrent, mergeObservation, nominalValuePerShare, observationOf, pabraiRows, pabraiSummary, parseKapHolders, persistPublished, readHistory, summarize, turkishNumber, unescapePage, writeHistory };

if (require.main === module) main().catch(error => {
  process.stderr.write(`kap-holders failed: ${error && error.message || error}\n`);
  process.exitCode = 1;
});
