#!/usr/bin/env node
'use strict';

// Dalal Street LLC's Form 13F history: every quarterly filing since the first
// (31 Mar 2012), one row per reported security, kept in
// data/dalal13f-history.json so the page can show how each position was built
// and sold quarter by quarter without asking SEC for sixty filings at every
// build. The build appends the current filing it has already fetched and
// validated (mergeCurrent, from server.js); the record job persists that
// quarter with --from-published. Run by hand to (re)fill:
//
//   node scripts/dalal-13f-history.js                 fetch the quarters the file lacks, write the file
//   node scripts/dalal-13f-history.js --check         list the quarters the file lacks, write nothing
//   node scripts/dalal-13f-history.js --from-published [url]   persist the quarter api/dalal.json carries
//
// Formats: filings from 30 Jun 2013 are XML (primary_doc.xml + infotable.xml,
// parsed by pabrai.js and checked against the filing's own entry and value
// totals); the five earlier filings are the fixed-width text form, parsed
// here (name, class, CUSIP, shares on one line, the value in $ thousands on
// the wrapped line under it). Values: SEC changed the information table's
// unit from thousands of dollars to dollars for filings submitted on or after
// 3 Jan 2023; every row is stored in dollars and the quarter says which
// conversion applied (valueUnit). One quarter may have an amendment
// (13F-HR/A); the history keeps the latest filing per quarter and flags it.
// Requests go to SEC with the application's own User-Agent, at most four per
// second, and the token-free public endpoints only.

const fs = require('fs');
const path = require('path');
const { aggregateSecRows, fetchResource, normalizeCik, parseSecInformationTable, parseSecPrimary, recent13fFilings, secUserAgent } = require('../pabrai');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_TARGET = path.join(ROOT, 'data', 'dalal13f-history.json');
const PUBLISHED_DALAL_URL = 'https://netic123.github.io/investments/api/dalal.json';
const DOLLARS_FROM = '2023-01-03'; // filings submitted on or after this date report values in dollars

const valueMultiplier = filed => (String(filed) >= DOLLARS_FROM ? 1 : 1000);
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const num = s => Number(String(s).replace(/,/g, ''));

// The fixed-width text information table of the 2012-2013 filings. A row line carries name, class, CUSIP, then
// either "value shares SH" (2012 layouts, value in whole $ thousands) or "shares SH" with the value (in $ thousands,
// two decimals) on the wrapped line under it, which may also carry the rest of a long class title (2013 layout).
function parseText13f(text) {
  const lines = String(text).split(/\r?\n/);
  const rows = [];
  const rowRe = /^(\S.*?\S)\s{2,}(\S+(?: \S+)*?)\s{2,}([0-9A-Za-z]{9})\s+(?:([\d,]+(?:\.\d+)?)\s+)?([\d,]+)\s+(SH|PRN)\b(?:\s+(PUT|CALL))?/;
  for (let i = 0; i < lines.length; i++) {
    const m = rowRe.exec(lines[i]);
    if (!m) continue;
    let value = m[4] != null ? num(m[4]) : null, title = m[2].trim();
    if (value == null) {
      const next = /^\s+(?:(\S.*?)\s{2,})?([\d,]+\.\d{2})\s*$/.exec(lines[i + 1] || '');
      if (next) { value = num(next[2]); if (next[1]) title = `${title} ${next[1].trim()}`; i++; }
    }
    if (value == null) throw new Error(`text 13F row without a value: ${lines[i].trim()}`);
    const cusip = m[3].toUpperCase();
    rows.push({ issuer: m[1].trim(), title, cusip, shares: num(m[5]), shareType: m[6], putCall: m[7] || null, valueThousands: value, key: `${cusip}|${title.toUpperCase()}|${(m[7] || '').toUpperCase()}` });
  }
  if (!rows.length) throw new Error('text 13F has no information table rows');
  return rows;
}

const quarterRow = row => ({ cusip: row.cusip, ...(row.cusipAsFiled ? { cusipAsFiled: row.cusipAsFiled } : {}), issuer: row.issuer, title: row.title, putCall: row.putCall || null, shares: row.shares, valueUsd: row.valueUsd });

// A filing whose information table the strict parser refuses because a CUSIP is not nine characters (the 30 Sep 2016
// filing lists Berkshire Hathaway as 84670702, the leading zero dropped): parsed leniently here, the CUSIP left-padded
// to nine characters and the value as filed kept beside it. Nothing else is relaxed.
function parseInfoTableLenient(xml) {
  const blocks = String(xml).match(/<(?:\w+:)?infoTable\b[\s\S]*?<\/(?:\w+:)?infoTable>/g) || [];
  const value = (block, tag) => { const m = new RegExp(`<(?:\\w+:)?${tag}\\b[^>]*>([\\s\\S]*?)<\\/(?:\\w+:)?${tag}>`).exec(block); return m ? m[1].trim() : null; };
  if (!blocks.length) throw new Error('SEC information table has no infoTable entries');
  return blocks.map((block, index) => {
    const asFiled = String(value(block, 'cusip') || '').replace(/\s+/g, '').toUpperCase();
    if (!/^[0-9A-Z]{6,9}$/.test(asFiled)) throw new Error(`SEC entry ${index + 1} has an unusable CUSIP ${asFiled}`);
    const cusip = asFiled.padStart(9, '0');
    const row = { issuer: value(block, 'nameOfIssuer'), title: value(block, 'titleOfClass'), cusip, cusipAsFiled: asFiled === cusip ? undefined : asFiled, valueUsd: num(value(block, 'value')), shares: num(value(block, 'sshPrnamt')), shareType: value(block, 'sshPrnamtType'), putCall: value(block, 'putCall') };
    if (!Number.isFinite(row.valueUsd) || !Number.isFinite(row.shares)) throw new Error(`SEC entry ${index + 1} (${cusip}) has a non-numeric value or share count`);
    row.key = `${cusip}|${String(row.title || '').toUpperCase()}|${String(row.putCall || '').toUpperCase()}`;
    return row;
  });
}

// One quarter from one filing: XML (validated against the filing's own totals) or text.
async function fetchQuarter(filing, cik, options = {}) {
  const compactCik = String(Number(normalizeCik(cik)));
  const base = `https://www.sec.gov/Archives/edgar/data/${compactCik}/${filing.accession.replace(/-/g, '')}`;
  const common = { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs || 30000, userAgent: options.userAgent };
  const multiplier = valueMultiplier(filing.filed);
  const shared = { reportDate: filing.reportDate, filed: filing.filed, accession: filing.accession, form: filing.form, amended: filing.form.endsWith('/A'), valueUnit: multiplier === 1 ? 'dollars as filed' : 'thousands of dollars as filed, stored in dollars', sourceUrl: `${base}/${filing.accession}-index.html` };
  const primaryName = String(filing.primaryDocument || 'primary_doc.xml').split('/').pop();
  if (/\.xml$/i.test(primaryName)) {
    const primaryReceipt = await fetchResource(`${base}/${primaryName}`, { ...common, accept: 'application/xml,text/xml,*/*' });
    await delay(options.pauseMs ?? 250);
    const infoReceipt = await fetchResource(`${base}/infotable.xml`, { ...common, accept: 'application/xml,text/xml,*/*' });
    const primary = parseSecPrimary(primaryReceipt.text);
    let rows, lenient = false;
    try { rows = parseSecInformationTable(infoReceipt.text); }
    catch (error) {
      if (!/invalid CUSIP/.test(String(error && error.message))) throw error;
      rows = parseInfoTableLenient(infoReceipt.text); lenient = true;
    }
    if (primary.reportDate !== filing.reportDate) throw new Error(`${filing.accession}: report date ${primary.reportDate} != ${filing.reportDate}`);
    if (primary.tableEntryTotal !== rows.length) throw new Error(`${filing.accession}: declares ${primary.tableEntryTotal} entries, contains ${rows.length}`);
    const valueTotal = rows.reduce((sum, row) => sum + row.valueUsd, 0);
    if (valueTotal !== primary.tableValueTotal) throw new Error(`${filing.accession}: value total ${valueTotal} != ${primary.tableValueTotal}`);
    return { ...shared, format: 'xml', ...(lenient ? { note: 'a CUSIP in this filing is shorter than nine characters as filed (cusipAsFiled); it was left-padded with zeros' } : {}), managerName: primary.managerName, entries: rows.length, totalValueUsd: primary.tableValueTotal * multiplier, rows: aggregateSecRows(rows.map(row => ({ ...row, valueUsd: row.valueUsd * multiplier }))).map(quarterRow), receipts: { primary: primaryReceipt.sha256, informationTable: infoReceipt.sha256 } };
  }
  const receipt = await fetchResource(`${base}/${primaryName}`, { ...common, accept: 'text/plain,*/*' });
  const rows = parseText13f(receipt.text).map(row => ({ ...row, valueUsd: Math.round(row.valueThousands * 1000) }));
  return { ...shared, format: 'text', managerName: null, entries: rows.length, totalValueUsd: rows.reduce((sum, row) => sum + row.valueUsd, 0), rows: aggregateSecRows(rows).map(quarterRow), receipts: { primary: receipt.sha256 } };
}

// The latest filing per quarter (an amendment replaces the original).
function latestPerQuarter(filings) {
  const byQuarter = new Map();
  for (const filing of filings) {
    const current = byQuarter.get(filing.reportDate);
    if (!current || String(filing.accepted || filing.filed) > String(current.accepted || current.filed)) byQuarter.set(filing.reportDate, filing);
  }
  return [...byQuarter.values()].sort((a, b) => a.reportDate.localeCompare(b.reportDate));
}

function readHistory(target = DEFAULT_TARGET) {
  if (!fs.existsSync(target)) return { cik: null, managerName: null, quarters: [] };
  const value = JSON.parse(fs.readFileSync(target, 'utf8'));
  if (!value || !Array.isArray(value.quarters)) throw new Error(`${target} is not a 13F history file`);
  return value;
}

function writeHistory(history, target = DEFAULT_TARGET) {
  const sorted = { ...history, quarters: [...history.quarters].sort((a, b) => a.reportDate.localeCompare(b.reportDate)) };
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(sorted, null, 1)}\n`);
  fs.renameSync(tmp, target);
  return sorted;
}

// The build's current filing (api/dalal.json, already fetched and validated by pabrai.js) appended when the history
// lacks its accession; a quarter already present with another accession is replaced only by a later filing.
function mergeCurrent(history, dalal) {
  const quarters = [...((history && history.quarters) || [])];
  if (!dalal || dalal.ok !== true || !dalal.accession || !Array.isArray(dalal.holdings)) return { ...history, quarters };
  const existing = quarters.find(q => q.reportDate === dalal.asOf);
  if (existing && (existing.accession === dalal.accession || String(existing.filed) >= String(dalal.filed))) return { ...history, quarters };
  const rows = dalal.holdings.filter(row => !row.exited).map(row => ({ cusip: row.cusip, issuer: row.secIssuer || row.name, title: row.title || null, putCall: row.putCall || null, shares: row.shares, valueUsd: row.valueUsd }));
  const quarter = { reportDate: dalal.asOf, filed: dalal.filed, accession: dalal.accession, form: dalal.form || '13F-HR', amended: String(dalal.form || '').endsWith('/A'), valueUnit: 'dollars as filed', sourceUrl: dalal.sourceUrl || null, format: 'xml', managerName: dalal.managerName || null, entries: dalal.entryTotal || rows.length, totalValueUsd: dalal.portfolioValueUsd, rows, appendedFromBuild: dalal.fetchedAt || true };
  return { ...history, cik: history.cik || dalal.cik || null, managerName: history.managerName || dalal.managerName || null, quarters: [...quarters.filter(q => q.reportDate !== dalal.asOf), quarter].sort((a, b) => a.reportDate.localeCompare(b.reportDate)) };
}

async function fillFromSec({ target = DEFAULT_TARGET, check = false, config = null, fetchImpl = fetch, log = () => {} } = {}) {
  const cfg = config || JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8')).dalalStreet || {};
  const cik = normalizeCik(cfg.cik || '0001549575');
  const userAgent = secUserAgent(process.env.SEC_USER_AGENT);
  const common = { fetchImpl, timeoutMs: 30000, userAgent };
  const submissions = JSON.parse((await fetchResource(`https://data.sec.gov/submissions/CIK${cik}.json`, { ...common, accept: 'application/json' })).text);
  const wanted = latestPerQuarter(recent13fFilings(submissions, cik));
  const history = readHistory(target);
  const have = new Map(history.quarters.map(q => [q.reportDate, q]));
  const missing = wanted.filter(f => { const q = have.get(f.reportDate); return !q || q.accession !== f.accession; });
  log(`${wanted.length} quarters on EDGAR, ${history.quarters.length} in ${path.relative(ROOT, target)}, ${missing.length} to fetch${check ? ' (check only)' : ''}`);
  if (check) return { missing: missing.map(f => f.reportDate), written: false };
  const fetched = [];
  let quarters = history.quarters;
  const header = { cik, managerName: cfg.managerName || history.managerName || null, source: 'SEC EDGAR Form 13F-HR filings of Dalal Street, LLC; see each quarter\'s sourceUrl' };
  for (const filing of missing) {
    const quarter = await fetchQuarter(filing, cik, common);
    fetched.push(quarter);
    log(`  ${quarter.reportDate} ${quarter.form} filed ${quarter.filed}: ${quarter.entries} entries, $${Math.round(quarter.totalValueUsd).toLocaleString('en-GB')} (${quarter.format}${quarter.amended ? ', amendment' : ''}${quarter.note ? '; ' + quarter.note : ''})`);
    // written after every quarter, so a failure part-way keeps what was fetched
    quarters = [...quarters.filter(q => q.reportDate !== quarter.reportDate), quarter];
    writeHistory({ ...header, quarters }, target);
    await delay(250);
  }
  if (!fetched.length) return { missing: [], written: false };
  return { missing: fetched.map(q => q.reportDate), written: true };
}

async function persistPublished({ url = PUBLISHED_DALAL_URL, target = DEFAULT_TARGET, fetchImpl = fetch, log = () => {} } = {}) {
  const response = await fetchImpl(url, { headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' }, signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  const dalal = await response.json();
  const history = readHistory(target);
  const merged = mergeCurrent(history, dalal);
  const written = merged.quarters.length !== history.quarters.length || merged.quarters.some((q, i) => q.accession !== (history.quarters[i] || {}).accession);
  if (written) writeHistory(merged, target);
  log(`${written ? 'updated' : 'unchanged'} ${path.relative(ROOT, target)}: ${merged.quarters.length} quarters${written ? `; added ${dalal.asOf} (${dalal.accession})` : ''}`);
  return { written, quarters: merged.quarters.length };
}

async function main() {
  const args = process.argv.slice(2);
  const log = line => process.stdout.write(`${line}\n`);
  if (args[0] === '--from-published') return persistPublished({ url: args[1] || PUBLISHED_DALAL_URL, log });
  return fillFromSec({ check: args.includes('--check'), log });
}

module.exports = { DEFAULT_TARGET, DOLLARS_FROM, PUBLISHED_DALAL_URL, fetchQuarter, fillFromSec, latestPerQuarter, mergeCurrent, parseText13f, persistPublished, readHistory, valueMultiplier, writeHistory };

if (require.main === module) main().catch(error => {
  process.stderr.write(`dalal-13f-history failed: ${error && error.message || error}\n`);
  process.exitCode = 1;
});
