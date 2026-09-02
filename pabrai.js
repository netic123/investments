'use strict';

// Source parsers and validators for the Pabrai tab. This module has no runtime
// dependencies so its rules can be tested without starting the local server.

const crypto = require('crypto');

const WAGN_REQUIRED_HEADERS = [
  'Date', 'Account', 'StockTicker', 'CUSIP', 'SecurityName', 'Shares', 'Price',
  'MarketValue', 'Weightings', 'NetAssets', 'SharesOutstanding', 'CreationUnits',
  'MoneyMarketFlag',
];

// SEC asks automated clients to declare who they are. Its edge answers HTTP
// 403 to any User-Agent that mentions github.com or github.io (verified
// 2026-09-02 against data.sec.gov and www.sec.gov), which is why the earlier
// noreply.github.com contact never worked from anywhere. This default is
// accepted by data.sec.gov (the submissions index); the archive host
// www.sec.gov, which serves the filing XML, expects an e-mail-style contact
// and answered 403 to this default in most (not all) attempts on 2026-09-02.
// Set SEC_USER_AGENT to "<app> (<your e-mail>)" to make the automatic 13F
// path reliable; anything mentioning github.com/github.io is rejected here.
const DEFAULT_SEC_USER_AGENT = 'netic123-investments/1.0 (public dashboard; contact via the netic123/investments repository)';
const REJECTED_SEC_USER_AGENT = /github\.(com|io)/i;

function secUserAgent(candidate) {
  const value = String(candidate || '').trim();
  if (!value) return DEFAULT_SEC_USER_AGENT;
  if (REJECTED_SEC_USER_AGENT.test(value)) throw new Error('SEC rejects User-Agent strings that mention github.com or github.io');
  // A header value: one line of printable ASCII, or the request itself is malformed.
  if (/[^\x20-\x7e]/.test(value)) throw new Error('SEC User-Agent must be a single line of printable ASCII');
  return value;
}

// The vendor occasionally re-serves an older copy of a file date it has
// already revised. Both receipts carry the HTTP Last-Modified header; a copy
// modified before the saved one must not overwrite it.
function isOlderSameDateRevision(savedSource, liveSource) {
  if (!savedSource || !liveSource || !savedSource.sha256 || savedSource.sha256 === liveSource.sha256) return false;
  const saved = Date.parse(savedSource.lastModified || ''), served = Date.parse(liveSource.lastModified || '');
  return Number.isFinite(saved) && Number.isFinite(served) && served < saved;
}

function sha256(value) {
  return crypto.createHash('sha256').update(Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8')).digest('hex');
}

function parseCsv(text) {
  let input = String(text == null ? '' : text);
  if (input.charCodeAt(0) === 0xfeff) input = input.slice(1);
  const matrix = [];
  let row = [], field = '', quoted = false;

  const finishField = () => { row.push(field); field = ''; };
  const finishRow = () => {
    finishField();
    if (row.some(cell => cell.trim() !== '')) matrix.push(row);
    row = [];
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
      continue;
    }
    if (ch === '"') {
      if (field.length) throw new Error('invalid CSV quote placement');
      quoted = true;
    } else if (ch === ',') finishField();
    else if (ch === '\n') finishRow();
    else if (ch === '\r') {
      if (input[i + 1] === '\n') i++;
      finishRow();
    } else field += ch;
  }
  if (quoted) throw new Error('unterminated quoted CSV field');
  if (field.length || row.length) finishRow();
  if (!matrix.length) return { headers: [], rows: [] };

  const headers = matrix[0].map(value => value.trim());
  if (headers.some(header => !header)) throw new Error('CSV contains an empty header');
  const duplicates = headers.filter((header, index) => headers.indexOf(header) !== index);
  if (duplicates.length) throw new Error(`CSV contains duplicate headers: ${[...new Set(duplicates)].join(', ')}`);
  const rows = matrix.slice(1).map((cells, index) => {
    if (cells.length !== headers.length) throw new Error(`CSV row ${index + 2} has ${cells.length} columns; expected ${headers.length}`);
    return Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex].trim()]));
  });
  return { headers, rows };
}

function strictNumber(value, field, { integer = false, allowNegative = false } = {}) {
  let raw = String(value == null ? '' : value).trim();
  let parenthesized = false;
  if (/^\(.*\)$/.test(raw)) { parenthesized = true; raw = raw.slice(1, -1); }
  raw = raw.replace(/[$,%]/g, '').trim();
  if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) throw new Error(`${field} is not a complete number: ${String(value)}`);
  let number = Number(raw);
  if (parenthesized) number = -number;
  if (!Number.isFinite(number)) throw new Error(`${field} is not finite`);
  if (!allowNegative && number < 0) throw new Error(`${field} must not be negative`);
  if (integer && !Number.isInteger(number)) throw new Error(`${field} must be an integer`);
  return number;
}

function optionalNumber(value, field, options) {
  return value == null || String(value).trim() === '' ? null : strictNumber(value, field, options);
}

function isoFromUs(value, field = 'date') {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value || ''));
  if (!match) throw new Error(`${field} has unexpected format: ${String(value)}`);
  const iso = `${match[3]}-${match[1]}-${match[2]}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) throw new Error(`${field} is not a valid date: ${String(value)}`);
  return iso;
}

function isoFromSec(value, field = 'SEC date') {
  const raw = String(value || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const date = new Date(`${raw}T00:00:00Z`);
    if (Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === raw) return raw;
  }
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(raw);
  if (match) return isoFromUs(`${match[1]}/${match[2]}/${match[3]}`, field);
  throw new Error(`${field} has unexpected format: ${raw}`);
}

function exactIsoDate(value, field) {
  const raw = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`${field} must be an exact ISO date`);
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new Error(`${field} is not a valid calendar date`);
  }
  return raw;
}

function nextWeekdayDate(isoDate) {
  const parsed = new Date(`${isoDate}T00:00:00.000Z`);
  do parsed.setUTCDate(parsed.getUTCDate() + 1);
  while (parsed.getUTCDay() === 0 || parsed.getUTCDay() === 6);
  return parsed.toISOString().slice(0, 10);
}

function validateWagnHoldingsFreshness(fileDate, checkedAt = new Date().toISOString()) {
  const exactFileDate = exactIsoDate(fileDate, 'holdings file date');
  const exactCheckTime = String(checkedAt || '');
  const checkTimestamp = Date.parse(exactCheckTime);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(exactCheckTime)
      || !Number.isFinite(checkTimestamp)
      || new Date(checkTimestamp).toISOString() !== exactCheckTime) {
    throw new Error('holdings freshness check time is not an exact UTC timestamp');
  }
  const checkDate = exactCheckTime.slice(0, 10);

  const fileDay = Date.parse(`${exactFileDate}T00:00:00.000Z`) / 864e5;
  const checkDay = Date.parse(`${checkDate}T00:00:00.000Z`) / 864e5;
  const ageDays = checkDay - fileDay;
  const maximumFutureDate = nextWeekdayDate(checkDate);

  // FilePoint normally timestamps a receipt just after midnight UTC for that
  // UTC date. Before a weekend it can instead publish the next weekday's WAGN
  // portfolio, as it did on Saturday 2026-08-29 for Monday 2026-08-31. Permit
  // only that immediately next weekday; never accept an arbitrary +2/+3 date.
  if (ageDays < 0 && exactFileDate !== maximumFutureDate) {
    throw new Error(`official holdings source has an unsupported future date (${exactFileDate}; checked ${checkDate}; next allowed weekday ${maximumFutureDate})`);
  }
  if (ageDays > 5) {
    throw new Error(`official holdings source is stale (${exactFileDate}, ${ageDays} calendar days old)`);
  }
  return { ageDays, checkDate, maximumFutureDate, futureDateAccepted: ageDays < 0 };
}

function selectWagnNavObservation(daily, history = []) {
  const rows = [...history]
    .filter(row => row && /^\d{4}-\d{2}-\d{2}$/.test(String(row.date || '')) && Number.isFinite(row.nav))
    .sort((a, b) => a.date.localeCompare(b.date));
  const latest = rows[rows.length - 1] || null;
  const usableDaily = daily && /^\d{4}-\d{2}-\d{2}$/.test(String(daily.date || '')) && Number.isFinite(daily.nav) ? daily : null;

  // FilePoint's DailyNAV and DailyNAVHistorical files do not always advance at
  // the same time. Prefer the newest official rate date, while keeping fields
  // that exist only in DailyNAV out of a newer historical observation.
  if (latest && (!usableDaily || latest.date > usableDaily.date)) {
    const previous = rows.length > 1 ? rows[rows.length - 2] : null;
    const navChgPct = previous && previous.nav
      ? (latest.nav / previous.nav - 1) * 100
      : null;
    return {
      date: latest.date,
      nav: latest.nav,
      navChgPct,
      price: Number.isFinite(latest.price) ? latest.price : null,
      premium: Number.isFinite(latest.premium) ? latest.premium : Number.isFinite(latest.prem) ? latest.prem : null,
      netAssets: null,
      sharesOut: null,
      spread: null,
      currentSource: 'historical',
      dailyFileDate: usableDaily ? usableDaily.date : null,
      dailyFileLag: !!usableDaily,
    };
  }
  if (!usableDaily) return null;
  return {
    ...usableDaily,
    currentSource: 'daily',
    dailyFileDate: usableDaily.date,
    dailyFileLag: false,
  };
}

function normalizeWagnHoldings(text, options = {}) {
  const { headers, rows } = parseCsv(text);
  if (!rows.length) throw new Error('empty holdings file');
  const missing = WAGN_REQUIRED_HEADERS.filter(header => !headers.includes(header));
  if (missing.length) throw new Error(`holdings schema is missing: ${missing.join(', ')}`);

  const cashTickers = new Set(options.cashTickers || []);
  const fileDate = rows[0].Date;
  const date = isoFromUs(fileDate, 'holdings Date');
  const account = rows[0].Account;
  if (!account) throw new Error('holdings Account is empty');
  const netAssets = strictNumber(rows[0].NetAssets, 'NetAssets');
  const sharesOutstanding = strictNumber(rows[0].SharesOutstanding, 'SharesOutstanding');
  if (sharesOutstanding <= 0) throw new Error('SharesOutstanding must be positive');
  const creationUnits = optionalNumber(rows[0].CreationUnits, 'CreationUnits');

  const snap = {
    date,
    fileDate,
    account,
    netAssets,
    sharesOutstanding,
    creationUnits,
    rows: {},
    cash: {},
  };
  const seenTickers = new Set();
  let marketValueSum = 0, weightSum = 0;

  for (let index = 0; index < rows.length; index++) {
    const source = rows[index];
    const label = `holdings row ${index + 2}`;
    if (source.Date !== fileDate) throw new Error(`${label} has a different Date`);
    if (source.Account !== account) throw new Error(`${label} has a different Account`);
    const rowNetAssets = strictNumber(source.NetAssets, `${label} NetAssets`);
    if (Math.abs(rowNetAssets - netAssets) > 0.01) throw new Error(`${label} has a different NetAssets value`);
    const rowSharesOutstanding = strictNumber(source.SharesOutstanding, `${label} SharesOutstanding`);
    if (Math.abs(rowSharesOutstanding - sharesOutstanding) > 0.000001) throw new Error(`${label} has a different SharesOutstanding value`);

    const ticker = String(source.StockTicker || '').trim();
    if (!ticker) throw new Error(`${label} has an empty StockTicker`);
    if (seenTickers.has(ticker)) throw new Error(`duplicate StockTicker in holdings file: ${ticker}`);
    seenTickers.add(ticker);

    const cusip = String(source.CUSIP || '').trim().toUpperCase();
    // FilePoint identifies currency balances with a synthetic CASH<ISO code>
    // CUSIP (for example CASHNOK). Use that source identity as well as the
    // configured allowlist, so a newly introduced trading currency cannot make
    // the whole official file look unavailable. This deliberately does not
    // allow negative values for arbitrary securities.
    const upperTicker = ticker.toUpperCase();
    const isCurrencyCash = /^[A-Z]{3}$/.test(upperTicker) && cusip === `CASH${upperTicker}`;
    const isCash = cashTickers.has(ticker) || isCurrencyCash;
    const marketValue = strictNumber(source.MarketValue, `${ticker} MarketValue`, { allowNegative: isCash });
    const weight = strictNumber(source.Weightings, `${ticker} Weightings`, { allowNegative: isCash });
    marketValueSum += marketValue;
    weightSum += weight;
    if (isCash) {
      snap.cash[ticker] = marketValue;
      continue;
    }

    if (!cusip) throw new Error(`${ticker} has an empty CUSIP`);
    const name = String(source.SecurityName || '').trim();
    if (!name) throw new Error(`${ticker} has an empty SecurityName`);
    snap.rows[ticker] = {
      cusip,
      shares: strictNumber(source.Shares, `${ticker} Shares`),
      price: strictNumber(source.Price, `${ticker} Price`),
      mv: marketValue,
      weight,
      name,
    };
  }

  if (!Object.keys(snap.rows).length) throw new Error('holdings file has no securities');
  if (weightSum < 95 || weightSum > 105) throw new Error(`holdings weights sum to ${weightSum.toFixed(4)}%, outside the validation range`);
  const marketValueGapPct = netAssets ? Math.abs(marketValueSum - netAssets) / netAssets * 100 : Infinity;
  if (marketValueGapPct > 1) throw new Error(`holdings market values differ from NetAssets by ${marketValueGapPct.toFixed(3)}%`);

  const retrievedAt = options.retrievedAt || new Date().toISOString();
  snap.source = {
    provider: 'Pabrai Wagons ETF / FilePoint',
    fileDate: date,
    url: options.sourceUrl || null,
    officialPage: options.officialPage || null,
    capturedAt: retrievedAt,
    lastModified: options.lastModified || null,
    etag: options.etag || null,
    sha256: sha256(text),
    schema: headers,
    rowCount: rows.length,
    securityCount: Object.keys(snap.rows).length,
    cashRowCount: Object.keys(snap.cash).length,
    marketValueGapPct,
    weightSum,
  };
  return snap;
}

// WAGN units outstanding between two receipts. Creations/redemptions change
// the denominator of every weight and, when settled in cash, leave untraded
// share counts unchanged, so the reader needs the unit flow separately.
function summarizeWagnUnitFlow(before, after) {
  const unitsFrom = before && before.sharesOutstanding, unitsTo = after && after.sharesOutstanding;
  if (!(unitsFrom > 0) || !(unitsTo > 0)) return null;
  const delta = unitsTo - unitsFrom;
  return {
    from: before.date, to: after.date, unitsFrom, unitsTo, delta,
    pct: delta / unitsFrom * 100,
    kind: delta > 0 ? 'creation' : delta < 0 ? 'redemption' : 'none',
    // an untraded holding's share of one WAGN unit moves by this much
    perUnitPct: unitsFrom / unitsTo * 100 - 100,
  };
}

// A change row is a change in the number of shares the fund actually holds:
// a new holding, a full exit, or a different share count. Dilution of an
// untraded holding by a cash creation is not a trade and never produces a row.
// A raw change that is proportional to the change in units outstanding (an
// in-kind creation/redemption basket) is not a manager decision either and is
// skipped. Where both receipts carry SharesOutstanding and units changed, the
// flow-adjusted figures describe the same trade relative to a pro-rata
// deployment of the flow; they are context, not the headline.
function diffWagnSnapshots(before, after, options = {}) {
  const cashLike = new Set(options.cashLike || []);
  const oldEntries = Object.entries(before.rows || {}).map(([ticker, row]) => ({ ticker, row }));
  const newEntries = Object.entries(after.rows || {}).map(([ticker, row]) => ({ ticker, row }));
  const oldByTicker = new Map(oldEntries.map(entry => [entry.ticker, entry]));
  const oldByCusip = new Map(oldEntries.filter(entry => entry.row && entry.row.cusip).map(entry => [entry.row.cusip, entry]));
  const usedOld = new Set();
  const pairs = [];

  // Prefer stable CUSIP identity when both receipts have it. During migration
  // from legacy snapshots (which had only tickers), fall back to the exact
  // ticker so enriching a receipt cannot fabricate a sale plus a new holding.
  for (const current of newEntries) {
    let prior = current.row && current.row.cusip ? oldByCusip.get(current.row.cusip) : null;
    if (!prior || usedOld.has(prior)) prior = oldByTicker.get(current.ticker);
    if (prior && usedOld.has(prior)) prior = null;
    if (prior) usedOld.add(prior);
    pairs.push({ prior, current });
  }
  for (const prior of oldEntries) if (!usedOld.has(prior)) pairs.push({ prior, current: null });

  const unitFlow = summarizeWagnUnitFlow(before, after);
  const out = [];
  for (const pair of pairs) {
    const { prior, current } = pair;
    const ticker = current ? current.ticker : prior.ticker;
    const oldRow = prior && prior.row, newRow = current && current.row;
    const sharesFrom = (oldRow && oldRow.shares) || 0, sharesTo = (newRow && newRow.shares) || 0;
    const delta = sharesTo - sharesFrom;
    // Same share count in both files: nothing was bought or sold.
    if (Math.abs(delta) < 0.5) continue;
    const flowAdjusted = !!(oldRow && newRow && unitFlow && unitFlow.delta !== 0);
    const expectedSharesTo = flowAdjusted ? sharesFrom * unitFlow.unitsTo / unitFlow.unitsFrom : null;
    const flowAdjustedDelta = flowAdjusted ? sharesTo - expectedSharesTo : null;
    // Inventory that moved only in proportion to WAGN units outstanding is an
    // in-kind ETF flow, not evidence that the manager changed the position.
    // Tolerate basket rounding of up to half a share or 0.5 % of the move.
    if (flowAdjusted && Math.abs(flowAdjustedDelta) <= Math.max(0.5, Math.abs(delta) * 0.005)) continue;
    const price = (newRow && newRow.price) || (oldRow && oldRow.price) || 0;
    const usdPerShare = newRow && newRow.mv && newRow.shares ? newRow.mv / newRow.shares : (oldRow && oldRow.mv && oldRow.shares ? oldRow.mv / oldRow.shares : 0);
    const cusip = (newRow && newRow.cusip) || (oldRow && oldRow.cusip) || null;
    const pct = sharesFrom ? delta / sharesFrom * 100 : null;
    out.push({
      ticker, tickerFrom: prior && prior.ticker, tickerTo: current && current.ticker,
      securityKey: cusip ? `CUSIP:${cusip}` : `TICKER:${ticker}`,
      cusip,
      from: before.date, to: after.date, sharesFrom, sharesTo, delta, pct,
      sharesOutstandingFrom: unitFlow ? unitFlow.unitsFrom : before.sharesOutstanding || null,
      sharesOutstandingTo: unitFlow ? unitFlow.unitsTo : after.sharesOutstanding || null,
      unitFlow,
      flowAdjusted, expectedSharesTo, flowAdjustedDelta,
      flowAdjustedPct: flowAdjusted && expectedSharesTo ? flowAdjustedDelta / expectedSharesTo * 100 : null,
      // The headline is the raw inventory change; kept under the old names so
      // every consumer of this contract reads the same number.
      signalDelta: delta,
      signalPct: pct,
      kind: !oldRow ? 'NEW' : !newRow ? 'SOLD OUT' : delta > 0 ? 'INCREASE' : 'DECREASE',
      localPrice: price, approxUsd: Math.abs(delta) * usdPerShare, absValue: Math.abs(delta) * usdPerShare,
      cashLike: cashLike.has(ticker),
    });
  }
  return out.sort((left, right) => right.absValue - left.absValue);
}

// The holdings receipt is dated the next weekday and carries NetAssets equal to
// the official NAV of the previous rate date multiplied by the receipt's own
// SharesOutstanding, to the cent. Two proofs of the pricing date are accepted:
//   exact      the NAV file reports the same SharesOutstanding and NetAssets
//              equals rounded NAV x shares within one hundred-thousandth;
//   per-share  NetAssets / SharesOutstanding rounds to the NAV although the
//              unit count differs, because a creation or redemption settled
//              between the two files (the NAV file still shows the old count).
// Either way the NAV rate date must be on or up to four calendar days before
// the holdings file date. Anything else leaves the pricing date unasserted and
// says why.
function reconcileWagnHoldingsToNav(latest, nav) {
  const L = latest, N = nav;
  const isoDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
  if (!L || !N || !Number.isFinite(L.netAssets) || !Number.isFinite(L.sharesOutstanding) || L.sharesOutstanding <= 0
      || !Number.isFinite(N.nav) || !isoDate(N.date) || !isoDate(L.date)) {
    return { matched: false, mode: null, reason: 'required NAV reconciliation fields are missing' };
  }
  const dateGap = (Date.parse(`${L.date}T00:00:00Z`) - Date.parse(`${N.date}T00:00:00Z`)) / 864e5;
  const roundedNav = Math.round(N.nav * 100) / 100;
  const perShare = L.netAssets / L.sharesOutstanding;
  const perShareGap = Math.abs(perShare - roundedNav);
  const expected = roundedNav * L.sharesOutstanding;
  const gap = Math.abs(L.netAssets - expected);
  const tolerance = Math.max(1, Math.abs(L.netAssets) * 0.00001);
  const navFileShares = Number.isFinite(N.sharesOut) && N.sharesOut > 0 ? N.sharesOut : null;
  const unitChange = navFileShares == null ? null : L.sharesOutstanding - navFileShares;
  const base = { navDate: N.date, nav: roundedNav, fundShares: L.sharesOutstanding, navFileShares, unitChange, dateGap, perShare, perShareGap, gap, tolerance };
  if (!(dateGap >= 0 && dateGap <= 4)) {
    return { ...base, matched: false, mode: null, reason: `the newest NAV is dated ${N.date}, which is not within the four days before the holdings file date ${L.date}` };
  }
  if (gap <= tolerance && (navFileShares == null || Math.abs(unitChange) < 0.5)) {
    return { ...base, matched: true, mode: 'exact', reason: null };
  }
  if (perShareGap <= 0.005) {
    return { ...base, matched: true, mode: 'per-share', reason: null };
  }
  return { ...base, matched: false, mode: null, reason: `NetAssets / SharesOutstanding = ${perShare.toFixed(4)} per share does not equal the ${N.date} NAV of ${roundedNav.toFixed(2)}` };
}

function decodeXml(value) {
  return String(value == null ? '' : value)
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(parseInt(code, 10)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&amp;/g, '&');
}

function xmlTagPattern(tag, global = false) {
  const prefix = '(?:[A-Za-z_][\\w.-]*:)?';
  return new RegExp(`<${prefix}${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${prefix}${tag}\\s*>`, global ? 'gi' : 'i');
}

function xmlBlocks(xml, tag) {
  return [...String(xml).matchAll(xmlTagPattern(tag, true))].map(match => match[1]);
}

function xmlValue(xml, tag, { required = true } = {}) {
  const match = xmlTagPattern(tag).exec(String(xml));
  if (!match) {
    if (required) throw new Error(`SEC XML is missing ${tag}`);
    return null;
  }
  return decodeXml(match[1].replace(/<[^>]*>/g, '')).trim();
}

function parseSecPrimary(xml) {
  const managerBlock = xmlBlocks(xml, 'filingManager')[0] || '';
  const summaryBlock = xmlBlocks(xml, 'summaryPage')[0] || '';
  const amendmentRaw = xmlValue(xml, 'isAmendment', { required: false });
  return {
    managerName: xmlValue(managerBlock, 'name'),
    reportDate: isoFromSec(xmlValue(xml, 'reportCalendarOrQuarter', { required: false }) || xmlValue(xml, 'periodOfReport'), 'SEC report date'),
    isAmendment: /^(true|1|yes)$/i.test(amendmentRaw || ''),
    amendmentType: xmlValue(xml, 'amendmentType', { required: false }),
    reportType: xmlValue(xml, 'reportType', { required: false }),
    tableEntryTotal: strictNumber(xmlValue(summaryBlock, 'tableEntryTotal'), 'SEC tableEntryTotal', { integer: true }),
    tableValueTotal: strictNumber(xmlValue(summaryBlock, 'tableValueTotal'), 'SEC tableValueTotal', { integer: true }),
  };
}

function secSecurityKey(row) {
  return [row.cusip, String(row.title || '').toUpperCase(), String(row.putCall || '').toUpperCase()].join('|');
}

function parseSecInformationTable(xml) {
  const blocks = xmlBlocks(xml, 'infoTable');
  if (!blocks.length) throw new Error('SEC information table has no infoTable entries');
  return blocks.map((block, index) => {
    const cusip = xmlValue(block, 'cusip').replace(/\s+/g, '').toUpperCase();
    if (!/^[0-9A-Z]{9}$/.test(cusip)) throw new Error(`SEC entry ${index + 1} has invalid CUSIP ${cusip}`);
    const amountBlock = xmlBlocks(block, 'shrsOrPrnAmt')[0] || '';
    const votingBlock = xmlBlocks(block, 'votingAuthority')[0] || '';
    const row = {
      issuer: xmlValue(block, 'nameOfIssuer'),
      title: xmlValue(block, 'titleOfClass'),
      cusip,
      valueUsd: strictNumber(xmlValue(block, 'value'), `SEC ${cusip} value`, { integer: true }),
      shares: strictNumber(xmlValue(amountBlock, 'sshPrnamt'), `SEC ${cusip} shares`),
      shareType: xmlValue(amountBlock, 'sshPrnamtType'),
      putCall: xmlValue(block, 'putCall', { required: false }),
      otherManager: xmlValue(block, 'otherManager', { required: false }),
      discretion: xmlValue(block, 'investmentDiscretion', { required: false }),
      voting: {
        sole: optionalNumber(xmlValue(votingBlock, 'Sole', { required: false }), `SEC ${cusip} voting sole`),
        shared: optionalNumber(xmlValue(votingBlock, 'Shared', { required: false }), `SEC ${cusip} voting shared`),
        none: optionalNumber(xmlValue(votingBlock, 'None', { required: false }), `SEC ${cusip} voting none`),
      },
    };
    row.key = secSecurityKey(row);
    return row;
  });
}

function normalizeCik(value) {
  const digits = String(value == null ? '' : value).replace(/\D/g, '');
  if (!digits || digits.length > 10) throw new Error(`invalid SEC CIK: ${String(value)}`);
  return digits.padStart(10, '0');
}

function recent13fFilings(submissions, expectedCik) {
  const cik = normalizeCik(submissions && submissions.cik);
  if (cik !== normalizeCik(expectedCik)) throw new Error(`SEC submissions CIK ${cik} does not match ${normalizeCik(expectedCik)}`);
  const recent = submissions && submissions.filings && submissions.filings.recent;
  if (!recent || !Array.isArray(recent.form)) throw new Error('SEC submissions response has no recent filings');
  const filings = [];
  for (let index = 0; index < recent.form.length; index++) {
    const form = recent.form[index];
    if (form !== '13F-HR' && form !== '13F-HR/A') continue;
    filings.push({
      form,
      accession: recent.accessionNumber[index],
      filed: recent.filingDate[index],
      accepted: recent.acceptanceDateTime[index] || null,
      reportDate: recent.reportDate[index],
      primaryDocument: recent.primaryDocument[index] || 'primary_doc.xml',
    });
  }
  filings.sort((a, b) => b.reportDate.localeCompare(a.reportDate) || String(b.accepted || b.filed).localeCompare(String(a.accepted || a.filed)));
  if (!filings.length) throw new Error('SEC submissions response has no 13F-HR filings');
  return filings;
}

function selectCurrentAndPrevious13f(filings) {
  const reportDates = [...new Set(filings.map(filing => filing.reportDate))].sort().reverse();
  if (reportDates.length < 2) throw new Error('SEC submissions response has no prior 13F quarter for comparison');
  const select = reportDate => {
    const group = filings.filter(filing => filing.reportDate === reportDate);
    const amendment = group.find(filing => filing.form === '13F-HR/A');
    if (amendment) throw new Error(`SEC report ${reportDate} includes amendment ${amendment.accession}; manual amendment review is required before publication`);
    const base = group.find(filing => filing.form === '13F-HR');
    if (!base) throw new Error(`SEC report ${reportDate} has no base 13F-HR filing`);
    return base;
  };
  return { current: select(reportDates[0]), previous: select(reportDates[1]) };
}

async function fetchResource(url, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const headers = { Accept: options.accept || '*/*', 'User-Agent': secUserAgent(options.userAgent), ...(options.headers || {}) };
  let response;
  try {
    response = await fetchImpl(url, { headers, signal: options.signal || AbortSignal.timeout(options.timeoutMs || 30000) });
  } catch (error) {
    throw new Error(`no contact with ${new URL(url).host}: ${error && error.message ? error.message : error}`);
  }
  const body = Buffer.from(await response.arrayBuffer());
  if (!response.ok) throw new Error(`${response.status} ${response.statusText || ''} (${new URL(url).pathname.split('/').pop()})`.trim());
  return {
    url,
    text: body.toString('utf8'),
    status: response.status,
    lastModified: response.headers && response.headers.get ? response.headers.get('last-modified') : null,
    etag: response.headers && response.headers.get ? response.headers.get('etag') : null,
    sha256: sha256(body),
    bytes: body.length,
  };
}

async function fetchSecFiling(filing, cik, options = {}) {
  const compactCik = String(Number(normalizeCik(cik)));
  const compactAccession = filing.accession.replace(/-/g, '');
  const base = `https://www.sec.gov/Archives/edgar/data/${compactCik}/${compactAccession}`;
  // EDGAR's submissions feed names the primary document through its XSL viewer
  // path (for example xslForm13F_X02/primary_doc.xml), which returns HTML. The
  // raw XML that parseSecPrimary needs sits at the archive root.
  const primaryName = String(filing.primaryDocument || 'primary_doc.xml').split('/').pop() || 'primary_doc.xml';
  const primaryReceipt = await fetchResource(`${base}/${primaryName}`, { ...options, accept: 'application/xml,text/xml,*/*' });
  const infoReceipt = await fetchResource(`${base}/infotable.xml`, { ...options, accept: 'application/xml,text/xml,*/*' });
  const primary = parseSecPrimary(primaryReceipt.text);
  const rows = parseSecInformationTable(infoReceipt.text);
  if (primary.isAmendment || filing.form.endsWith('/A')) throw new Error(`SEC accession ${filing.accession} is an amendment and requires manual review`);
  if (primary.reportDate !== filing.reportDate) throw new Error(`SEC accession ${filing.accession} report date mismatch (${primary.reportDate} vs ${filing.reportDate})`);
  if (primary.tableEntryTotal !== rows.length) throw new Error(`SEC accession ${filing.accession} declares ${primary.tableEntryTotal} entries but contains ${rows.length}`);
  const valueTotal = rows.reduce((sum, row) => sum + row.valueUsd, 0);
  if (valueTotal !== primary.tableValueTotal) throw new Error(`SEC accession ${filing.accession} value total mismatch (${valueTotal} vs ${primary.tableValueTotal})`);
  return { filing, primary, rows, valueTotal, sourceUrl: `${base}/${filing.accession}-index.html`, receipts: { primary: primaryReceipt, informationTable: infoReceipt } };
}

function normalizedName(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function aggregateSecRows(rows) {
  const map = new Map();
  for (const row of rows) {
    const existing = map.get(row.key);
    if (!existing) map.set(row.key, { ...row });
    else {
      existing.shares += row.shares;
      existing.valueUsd += row.valueUsd;
    }
  }
  return [...map.values()];
}

function compareManualDalal(live, manual) {
  if (!manual || !Array.isArray(manual.holdings)) return { matches: false, mismatches: ['manual fallback is missing'] };
  const mismatches = [];
  if (manual.asOf !== live.asOf) mismatches.push(`report date ${manual.asOf || 'missing'} != ${live.asOf}`);
  if (manual.filed !== live.filed) mismatches.push(`filing date ${manual.filed || 'missing'} != ${live.filed}`);
  if (manual.accession && manual.accession !== live.accession) mismatches.push(`accession ${manual.accession} != ${live.accession}`);
  if (manual.previous && manual.previous.accession && live.previous && manual.previous.accession !== live.previous.accession) mismatches.push(`previous accession ${manual.previous.accession} != ${live.previous.accession}`);
  if (manual.portfolioValueUsd !== live.portfolioValueUsd) mismatches.push(`portfolio value ${manual.portfolioValueUsd} != ${live.portfolioValueUsd}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(manual.manualVerifiedAt || ''))) mismatches.push('manual fallback has no verification date');
  const manualByCusip = new Map(manual.holdings.filter(row => row.cusip).map(row => [String(row.cusip).toUpperCase(), row]));
  const current = live.holdings.filter(row => !row.exited);
  for (const row of current) {
    const expected = manualByCusip.get(row.cusip);
    if (!expected) { mismatches.push(`${row.cusip} is absent from manual fallback`); continue; }
    if (expected.shares !== row.shares) mismatches.push(`${row.cusip} shares ${expected.shares} != ${row.shares}`);
    if (expected.valueUsd !== row.valueUsd) mismatches.push(`${row.cusip} value ${expected.valueUsd} != ${row.valueUsd}`);
    if (expected.prevShares !== undefined && expected.prevShares !== row.prevShares) mismatches.push(`${row.cusip} prior-quarter shares ${expected.prevShares} != ${row.prevShares}`);
  }
  if (manualByCusip.size !== current.length) mismatches.push(`manual fallback has ${manualByCusip.size} mapped holdings; SEC has ${current.length}`);
  return { matches: mismatches.length === 0, mismatches };
}

async function fetchDalalStreet13f(config = {}, options = {}) {
  const cik = normalizeCik(config.cik || '0001549575');
  const expectedManager = config.managerName || 'Dalal Street, LLC';
  const userAgent = secUserAgent(options.userAgent || process.env.SEC_USER_AGENT);
  const common = { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs || 30000, userAgent };
  const submissionsUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const submissionsReceipt = await fetchResource(submissionsUrl, { ...common, accept: 'application/json' });
  let submissions;
  try { submissions = JSON.parse(submissionsReceipt.text); }
  catch { throw new Error('SEC submissions endpoint returned invalid JSON'); }
  const filings = recent13fFilings(submissions, cik);
  const selected = selectCurrentAndPrevious13f(filings);
  const current = await fetchSecFiling(selected.current, cik, common);
  const previous = await fetchSecFiling(selected.previous, cik, common);
  if (normalizedName(current.primary.managerName) !== normalizedName(expectedManager)) throw new Error(`SEC filing manager ${current.primary.managerName} does not match ${expectedManager}`);
  if (normalizedName(previous.primary.managerName) !== normalizedName(expectedManager)) throw new Error(`prior SEC filing manager ${previous.primary.managerName} does not match ${expectedManager}`);

  const previousByKey = new Map(aggregateSecRows(previous.rows).map(row => [row.key, row]));
  const configuredByCusip = new Map((config.holdings || []).filter(row => row.cusip).map(row => [String(row.cusip).toUpperCase(), row]));
  const describe = row => {
    const known = configuredByCusip.get(row.cusip) || {};
    return {
      ticker: known.ticker || `CUSIP ${row.cusip}`,
      name: known.name || row.issuer,
      secIssuer: row.issuer,
      title: row.title,
      cusip: row.cusip,
      putCall: row.putCall,
      shareType: row.shareType,
    };
  };
  const currentRows = aggregateSecRows(current.rows);
  const currentKeys = new Set(currentRows.map(row => row.key));
  const holdings = currentRows.map(row => {
    const prior = previousByKey.get(row.key);
    return { ...describe(row), shares: row.shares, prevShares: prior ? prior.shares : null, valueUsd: row.valueUsd };
  }).sort((a, b) => b.valueUsd - a.valueUsd || a.cusip.localeCompare(b.cusip));
  // A security reported last quarter but absent now was sold out (or fell
  // below the reporting threshold); list it with zero shares so the quarterly
  // change can show the exit instead of dropping it silently.
  const exits = [...previousByKey.values()].filter(row => !currentKeys.has(row.key))
    .map(row => ({ ...describe(row), shares: 0, prevShares: row.shares, valueUsd: 0, exited: true }))
    .sort((a, b) => b.prevShares - a.prevShares || a.cusip.localeCompare(b.cusip));
  holdings.push(...exits);

  const fetchedAt = new Date().toISOString();
  const result = {
    ok: true,
    sourceStatus: 'official SEC verified',
    fetchError: null,
    fetchedAt,
    managerName: current.primary.managerName,
    cik,
    asOf: current.filing.reportDate,
    filed: current.filing.filed,
    accepted: current.filing.accepted,
    accession: current.filing.accession,
    form: current.filing.form,
    portfolioValueUsd: current.primary.tableValueTotal,
    entryTotal: current.primary.tableEntryTotal,
    nextFilingWindow: config.nextFilingWindow || null,
    source: `SEC EDGAR ${current.filing.form}, accession ${current.filing.accession} (${current.primary.managerName}, CIK ${cik})`,
    sourceUrl: current.sourceUrl,
    holdings,
    previous: {
      asOf: previous.filing.reportDate,
      filed: previous.filing.filed,
      accepted: previous.filing.accepted,
      accession: previous.filing.accession,
      sourceUrl: previous.sourceUrl,
    },
    provenance: {
      submissions: { url: submissionsReceipt.url, sha256: submissionsReceipt.sha256, bytes: submissionsReceipt.bytes, retrievedAt: fetchedAt },
      primary: { url: current.receipts.primary.url, sha256: current.receipts.primary.sha256, etag: current.receipts.primary.etag, lastModified: current.receipts.primary.lastModified },
      informationTable: { url: current.receipts.informationTable.url, sha256: current.receipts.informationTable.sha256, etag: current.receipts.informationTable.etag, lastModified: current.receipts.informationTable.lastModified },
    },
  };
  result.manualFallbackCheck = compareManualDalal(result, config);
  return result;
}

// ---------- Form N-PORT: the fund's own portfolio report to SEC ----------
// A registered fund reports its complete portfolio to SEC monthly on Form
// N-PORT; the trust (Professionally Managed Portfolios) files one report per
// series, so a dozen NPORT-P filings share each filing date and only the
// primary document says which series it is for. Only the report for the third
// month of each fiscal quarter becomes public, 60 days after that quarter end;
// this fund's fiscal year ends 30 June, so its public reports are as of
// 31 Mar, 30 Jun, 30 Sep and 31 Dec. The FilePoint holdings file dated the next
// weekday after such a date is priced as of that date, which is what makes a
// position-by-position comparison possible, months after the fact.

const NPORT_QUARTER_END_MONTHS = [3, 6, 9, 12];
// Short-term investment vehicles (money-market funds) and repurchase
// agreements are cash management, not positions the manager chose; they are
// listed but never counted as a share-count mismatch.
const NPORT_CASH_LIKE_ASSET_CATS = new Set(['STIV', 'RA']);
const NPORT_CASH_LIKE_NAME = /\b(money market|treasury obligations fund|cash)\b/i;

// Attribute of the first <tag .../> (or <tag ...>) element, e.g. <isin value="..."/>.
function xmlAttribute(xml, tag, attribute) {
  const attributes = xmlAttributeSets(xml, tag)[0];
  if (attributes == null) return null;
  const match = new RegExp(`(?:^|\\s)${attribute}\\s*=\\s*"([^"]*)"`, 'i').exec(attributes);
  return match ? decodeXml(match[1]).trim() : null;
}

function xmlAttributeSets(xml, tag) {
  const prefix = '(?:[A-Za-z_][\\w.-]*:)?';
  return [...String(xml).matchAll(new RegExp(`<${prefix}${tag}\\b([^>]*?)\\/?>`, 'gi'))].map(match => match[1]);
}

// The archive writes "N/A" (and some filers 000000000) where a security has no
// CUSIP; neither is an identifier.
function nportCusip(value) {
  const raw = String(value == null ? '' : value).replace(/\s+/g, '').toUpperCase();
  return /^[0-9A-Z]{9}$/.test(raw) && !/^0{9}$/.test(raw) ? raw : null;
}

function isQuarterEndDate(iso) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(iso || ''))) return false;
  const date = new Date(`${iso}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return false;
  const next = new Date(date.getTime() + 864e5);
  return NPORT_QUARTER_END_MONTHS.includes(date.getUTCMonth() + 1) && next.getUTCMonth() !== date.getUTCMonth();
}

function addCalendarDays(iso, days) {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// The first calendar quarter end strictly after a report date, when that
// report should be public (60 days later) and which FilePoint file date is
// priced as of it. "Expected": SEC's publication rule, not a promise.
function nextNportOpportunity(reportDate) {
  const year = Number(String(reportDate).slice(0, 4));
  const candidates = [];
  for (const y of [year, year + 1]) for (const month of NPORT_QUARTER_END_MONTHS) {
    const last = new Date(Date.UTC(y, month, 0)).toISOString().slice(0, 10);
    candidates.push(last);
  }
  const next = candidates.find(date => date > reportDate);
  return { reportDate: next, publicBy: addCalendarDays(next, 60), snapshotDate: nextWeekdayDate(next) };
}

function isNportCashLike(row) {
  return NPORT_CASH_LIKE_ASSET_CATS.has(String(row.assetCat || '').toUpperCase()) || NPORT_CASH_LIKE_NAME.test(String(row.name || ''));
}

function parseNportPrimary(xml) {
  const text = String(xml == null ? '' : xml);
  const submissionType = (xmlValue(text, 'submissionType', { required: false }) || '').toUpperCase();
  if (!/^NPORT-P(\/A)?$/.test(submissionType)) throw new Error(`SEC document is not a Form N-PORT primary document (${submissionType || 'no submissionType'})`);
  const genInfo = xmlBlocks(text, 'genInfo')[0];
  if (!genInfo) throw new Error('SEC N-PORT document has no genInfo');
  const fundInfo = xmlBlocks(text, 'fundInfo')[0];
  if (!fundInfo) throw new Error('SEC N-PORT document has no fundInfo');

  const holdings = xmlBlocks(text, 'invstOrSec').map((block, index) => {
    const name = xmlValue(block, 'name', { required: false }) || '';
    if (!name) throw new Error(`SEC N-PORT holding ${index + 1} has no name`);
    const label = `N-PORT ${name}`;
    const identifiers = xmlBlocks(block, 'identifiers')[0] || '';
    const isin = String(xmlAttribute(identifiers, 'isin', 'value') || '').replace(/\s+/g, '').toUpperCase() || null;
    const otherIds = xmlAttributeSets(identifiers, 'other').map(attributes => ({
      desc: (/(?:^|\s)otherDesc\s*=\s*"([^"]*)"/i.exec(attributes) || [])[1] || null,
      value: (/(?:^|\s)value\s*=\s*"([^"]*)"/i.exec(attributes) || [])[1] || null,
    })).map(id => ({ desc: id.desc == null ? null : decodeXml(id.desc).trim(), value: id.value == null ? null : decodeXml(id.value).trim() }));
    const row = {
      name,
      lei: xmlValue(block, 'lei', { required: false }) || null,
      title: xmlValue(block, 'title', { required: false }) || null,
      cusip: nportCusip(xmlValue(block, 'cusip', { required: false })),
      isin: isin && /^[A-Z]{2}[0-9A-Z]{9}[0-9]$/.test(isin) ? isin : null,
      ticker: xmlAttribute(identifiers, 'ticker', 'value') || null,
      otherIds,
      balance: strictNumber(xmlValue(block, 'balance'), `${label} balance`, { allowNegative: true }),
      units: xmlValue(block, 'units', { required: false }) || null,
      // A USD position carries <curCd>; another currency is reported as
      // <currencyConditional curCd="TRY" exchangeRt="..."/> instead.
      curCd: xmlValue(block, 'curCd', { required: false }) || xmlAttribute(block, 'currencyConditional', 'curCd') || null,
      valUsd: strictNumber(xmlValue(block, 'valUSD'), `${label} valUSD`, { allowNegative: true }),
      pctVal: strictNumber(xmlValue(block, 'pctVal'), `${label} pctVal`, { allowNegative: true }),
      payoffProfile: xmlValue(block, 'payoffProfile', { required: false }) || null,
      assetCat: xmlValue(block, 'assetCat', { required: false }) || null,
      issuerCat: xmlValue(block, 'issuerCat', { required: false }) || null,
      invCountry: xmlValue(block, 'invCountry', { required: false }) || null,
    };
    row.cashLike = isNportCashLike(row);
    return row;
  });

  return {
    form: submissionType,
    isAmendment: submissionType.endsWith('/A'),
    cik: normalizeCik(xmlValue(genInfo, 'regCik')),
    registrantName: xmlValue(genInfo, 'regName'),
    seriesId: xmlValue(genInfo, 'seriesId'),
    seriesName: xmlValue(genInfo, 'seriesName'),
    seriesLei: xmlValue(genInfo, 'seriesLei', { required: false }) || null,
    repPdEnd: isoFromSec(xmlValue(genInfo, 'repPdEnd'), 'N-PORT repPdEnd'),
    repPdDate: isoFromSec(xmlValue(genInfo, 'repPdDate'), 'N-PORT repPdDate'),
    isFinalFiling: /^Y/i.test(xmlValue(genInfo, 'isFinalFiling', { required: false }) || ''),
    totAssets: optionalNumber(xmlValue(fundInfo, 'totAssets', { required: false }), 'N-PORT totAssets', { allowNegative: true }),
    netAssets: strictNumber(xmlValue(fundInfo, 'netAssets'), 'N-PORT netAssets', { allowNegative: true }),
    holdings,
  };
}

// Every NPORT-P and NPORT-P/A entry of the submissions feed, newest report
// date first; within a report date an amendment precedes the original it
// replaces, then newer acceptance first. The feed names the primary document
// through its XSL viewer path, which returns HTML, so only the basename is
// kept. The trust's 1,000-entry "recent" page reaches back years, so the
// older pages listed under filings.files are never needed for the newest report.
function selectNportFilings(submissions, expectedCik) {
  const cik = normalizeCik(submissions && submissions.cik);
  if (expectedCik != null && cik !== normalizeCik(expectedCik)) throw new Error(`SEC submissions CIK ${cik} does not match ${normalizeCik(expectedCik)}`);
  const recent = submissions && submissions.filings && submissions.filings.recent;
  if (!recent || !Array.isArray(recent.form)) throw new Error('SEC submissions response has no recent filings');
  const filings = [];
  for (let index = 0; index < recent.form.length; index++) {
    const form = recent.form[index];
    if (form !== 'NPORT-P' && form !== 'NPORT-P/A') continue;
    const reportDate = String((recent.reportDate || [])[index] || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reportDate)) continue;
    filings.push({
      form,
      isAmendment: form.endsWith('/A'),
      accession: recent.accessionNumber[index],
      filed: recent.filingDate[index],
      accepted: (recent.acceptanceDateTime || [])[index] || null,
      reportDate,
      primaryDocument: String((recent.primaryDocument || [])[index] || 'primary_doc.xml').split('/').pop() || 'primary_doc.xml',
    });
  }
  filings.sort((a, b) => b.reportDate.localeCompare(a.reportDate)
    || Number(b.isAmendment) - Number(a.isAmendment)
    || String(b.accepted || b.filed).localeCompare(String(a.accepted || a.filed)));
  return filings;
}

// The FilePoint file dated the next weekday after the report date is priced
// as of the report date; that is the one snapshot the N-PORT can be held against.
function selectSnapshotForNport(snapshots, reportDate) {
  const expectedDate = nextWeekdayDate(reportDate);
  const snapshot = (snapshots || []).find(candidate => candidate && candidate.date === expectedDate && candidate.rows && typeof candidate.rows === 'object') || null;
  return { expectedDate, snapshot };
}

// First two words of an issuer name, upper-cased, punctuation stripped:
// "Topicus.com Inc" and "TOPICUS.COM INC" both become "TOPICUS COM".
function issuerNameKey(name) {
  return String(name || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean).slice(0, 2).join(' ');
}

// Position-by-position comparison of the N-PORT with the FilePoint snapshot
// priced as of the same date. Rows are paired by 9-character CUSIP first, then
// by the national number embedded in the N-PORT ISIN (characters 3-11 are the
// CUSIP/CINS of US-style ISINs; GB and IE ISINs pad a 7-character SEDOL with
// "00"), because FilePoint's CUSIP column carries a SEDOL for most foreign
// names; only then by the normalised issuer name, and only when that name is
// unique on both sides. The method is recorded per row. Cash-like rows are
// listed separately and never counted as a mismatch.
function compareNportWithSnapshot(nport, snapshot, options = {}) {
  const reportDate = nport.repPdDate;
  const snapshotDate = options.expectedSnapshotDate || nextWeekdayDate(reportDate);
  const empty = { matched: [], mismatched: [], onlyInNport: [], onlyInHoldings: [], cashLike: [] };
  if (!snapshot) {
    return {
      comparable: false, reportDate, snapshotDate,
      reason: `no saved holdings file dated ${snapshotDate}, the file priced as of ${reportDate}`,
      ...empty,
      summary: { positions: nport.holdings.filter(row => !row.cashLike).length, filePositions: null, matched: 0, mismatched: 0, onlyInNport: 0, onlyInHoldings: 0, cashLike: 0, byMethod: { cusip: 0, isin: 0, name: 0 } },
    };
  }
  const tolerance = Number.isFinite(options.shareTolerance) ? options.shareTolerance : 0.5;
  const cashLikeTickers = new Set(options.cashLike || []);
  const fileRows = Object.entries(snapshot.rows || {}).map(([ticker, row]) => ({
    ticker,
    id: String(row && row.cusip || '').replace(/\s+/g, '').toUpperCase(),
    isin: String(row && row.isin || '').replace(/\s+/g, '').toUpperCase() || null,
    name: row && row.name || ticker,
    nameKey: issuerNameKey(row && row.name || ticker),
    shares: row && Number.isFinite(row.shares) ? row.shares : null,
    cashLike: cashLikeTickers.has(ticker),
    used: false,
  }));
  const nportRows = nport.holdings.map(row => {
    const nsin = row.isin ? row.isin.slice(2, 11) : null;
    return { ...row, nsin, sedol: nsin && nsin.startsWith('00') ? nsin.slice(2) : null, nameKey: issuerNameKey(row.name), used: false };
  });
  const pairs = [];
  const pair = (n, f, method) => { n.used = true; f.used = true; pairs.push({ n, f, method }); };
  for (const n of nportRows) {
    if (!n.cusip) continue;
    const f = fileRows.find(candidate => !candidate.used && candidate.id.length === 9 && candidate.id === n.cusip);
    if (f) pair(n, f, 'cusip');
  }
  for (const n of nportRows) {
    if (n.used || !n.isin) continue;
    const f = fileRows.find(candidate => !candidate.used && (
      (candidate.isin && candidate.isin === n.isin)
      || (candidate.id.length === 9 && candidate.id === n.nsin)
      || (candidate.id.length === 7 && n.sedol && candidate.id === n.sedol)));
    if (f) pair(n, f, 'isin');
  }
  const countKeys = rows => rows.filter(row => !row.used).reduce((map, row) => map.set(row.nameKey, (map.get(row.nameKey) || 0) + 1), new Map());
  const nportKeyCount = countKeys(nportRows), fileKeyCount = countKeys(fileRows);
  for (const n of nportRows) {
    if (n.used || !n.nameKey || nportKeyCount.get(n.nameKey) !== 1 || fileKeyCount.get(n.nameKey) !== 1) continue;
    const f = fileRows.find(candidate => !candidate.used && candidate.nameKey === n.nameKey);
    if (f) pair(n, f, 'name');
  }

  const result = { comparable: true, reportDate, snapshotDate, reason: null, ...empty, netAssets: null };
  const byMethod = { cusip: 0, isin: 0, name: 0 };
  for (const { n, f, method } of pairs) {
    const diff = f.shares == null ? null : f.shares - n.balance;
    const row = {
      name: n.name, ticker: n.ticker, fundTicker: f.ticker, id: n.cusip || n.isin || null, fileId: f.id || null, method,
      nportShares: n.balance, fileShares: f.shares, diff, nportValueUsd: n.valUsd, cashLike: n.cashLike || f.cashLike,
    };
    if (row.cashLike) { result.cashLike.push(row); continue; }
    byMethod[method]++;
    if (diff != null && Math.abs(diff) <= tolerance) result.matched.push(row); else result.mismatched.push(row);
  }
  for (const n of nportRows) {
    if (n.used) continue;
    const row = { name: n.name, ticker: n.ticker, fundTicker: null, id: n.cusip || n.isin || null, fileId: null, method: null, nportShares: n.balance, fileShares: null, diff: null, nportValueUsd: n.valUsd, cashLike: n.cashLike };
    (row.cashLike ? result.cashLike : result.onlyInNport).push(row);
  }
  for (const f of fileRows) {
    if (f.used) continue;
    const row = { name: f.name, ticker: null, fundTicker: f.ticker, id: null, fileId: f.id || null, method: null, nportShares: null, fileShares: f.shares, diff: null, nportValueUsd: null, cashLike: f.cashLike };
    (row.cashLike ? result.cashLike : result.onlyInHoldings).push(row);
  }
  const byValue = (a, b) => (b.nportValueUsd || 0) - (a.nportValueUsd || 0) || String(a.name).localeCompare(String(b.name));
  result.matched.sort(byValue); result.mismatched.sort(byValue); result.onlyInNport.sort(byValue); result.cashLike.sort(byValue);
  result.onlyInHoldings.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  if (Number.isFinite(nport.netAssets) && Number.isFinite(snapshot.netAssets) && snapshot.netAssets) {
    result.netAssets = { nport: nport.netAssets, file: snapshot.netAssets, diffPct: (nport.netAssets / snapshot.netAssets - 1) * 100 };
  }
  result.summary = {
    positions: nportRows.filter(row => !row.cashLike).length,
    filePositions: fileRows.filter(row => !row.cashLike).length,
    matched: result.matched.length,
    mismatched: result.mismatched.length,
    onlyInNport: result.onlyInNport.length,
    onlyInHoldings: result.onlyInHoldings.length,
    cashLike: result.cashLike.length,
    byMethod,
  };
  return result;
}

// One line for api/build.json and the report: what was checked, or why not.
function summarizeNportCheck(result) {
  if (!result || result.ok !== true) return `SEC N-PORT unavailable (${result && result.fetchError || 'no result'})`;
  const filed = `${result.form}, filed ${result.filed}`;
  const comparison = result.comparison || {};
  if (!comparison.comparable) {
    const next = result.nextOpportunity || {};
    return `N-PORT as of ${result.reportDate} (${filed}): no saved FilePoint file dated ${comparison.snapshotDate}, so no comparison yet; first check possible with the ${next.reportDate} report (public by about ${next.publicBy}) against the file dated ${next.snapshotDate}`;
  }
  const summary = comparison.summary;
  return `N-PORT as of ${result.reportDate} (${filed}) vs the FilePoint file dated ${comparison.snapshotDate}: ${summary.matched} of ${summary.positions} positions match share counts; ${summary.mismatched} differ, ${summary.onlyInNport} only in N-PORT, ${summary.onlyInHoldings} only in the file, ${summary.cashLike} cash-like rows not counted`;
}

async function fetchResourceWithRetry(url, options, attempts, retryDelayMs, sleep) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try { return await fetchResource(url, options); }
    catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(retryDelayMs);
    }
  }
  throw new Error(`${lastError.message} after ${attempts} attempts`);
}

// Newest public N-PORT of the configured series and its comparison with the
// saved FilePoint snapshot priced as of the same date. Walks the trust's
// NPORT-P filings newest report date first, opening one primary document at a
// time (spaced, far below SEC's 10 requests per second) until one names the
// series; returns ok:false with a stated reason instead of throwing, because
// SEC's archive host sometimes refuses the runner's requests and that must
// never look like a finding about the fund.
async function fetchLatestPabraiNport(config = {}, options = {}) {
  const fetchedAt = new Date().toISOString();
  const cik = normalizeCik(config.trustCik || '0000811030');
  const seriesNameMatch = String(config.seriesNameMatch || 'Pabrai Wagons');
  const userAgent = secUserAgent(options.userAgent || process.env.SEC_USER_AGENT);
  const common = { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs || 30000, userAgent };
  const delayMs = Number.isFinite(options.delayMs) ? options.delayMs : 1000;
  const retryDelayMs = Number.isFinite(options.retryDelayMs) ? options.retryDelayMs : 3000;
  const attempts = options.attempts || 3;
  const maxDocuments = options.maxDocuments || 30;
  const sleep = options.sleep || (ms => new Promise(resolve => setTimeout(resolve, ms)));
  const snapshots = Array.isArray(options.snapshots) ? options.snapshots : [];
  const opened = [];
  const base = { ok: false, sourceStatus: 'SEC N-PORT unavailable', fetchedAt, cik, seriesNameMatch, seriesId: config.seriesId || null, opened, provenance: {} };
  const failure = (message, extra = {}) => ({ ...base, ...extra, fetchError: message });

  const submissionsUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
  let submissionsReceipt;
  try { submissionsReceipt = await fetchResource(submissionsUrl, { ...common, accept: 'application/json' }); }
  catch (error) { return failure(`SEC submissions index: ${error.message}`); }
  base.provenance.submissions = { url: submissionsReceipt.url, sha256: submissionsReceipt.sha256, bytes: submissionsReceipt.bytes, retrievedAt: fetchedAt };
  let filings;
  try {
    let submissions;
    try { submissions = JSON.parse(submissionsReceipt.text); }
    catch { throw new Error('SEC submissions endpoint returned invalid JSON'); }
    base.registrantName = submissions.name || null;
    filings = selectNportFilings(submissions, cik);
  } catch (error) { return failure(error.message); }
  // Reports for other months are not public for this fund (see above); the
  // ones the trust files for other series are skipped to keep requests few.
  const candidates = filings.filter(filing => isQuarterEndDate(filing.reportDate));
  const describe = filing => ({ form: filing.form, accession: filing.accession, filed: filing.filed, reportDate: filing.reportDate });
  base.candidates = candidates.slice(0, maxDocuments).map(describe);
  if (!candidates.length) return failure('SEC submissions list no NPORT-P filing with a quarter-end report date');

  let selected = null;
  for (const filing of candidates.slice(0, maxDocuments)) {
    if (opened.length) await sleep(delayMs);
    const url = `https://www.sec.gov/Archives/edgar/data/${String(Number(cik))}/${filing.accession.replace(/-/g, '')}/${filing.primaryDocument}`;
    let receipt, parsed;
    try { receipt = await fetchResourceWithRetry(url, { ...common, accept: 'application/xml,text/xml,*/*' }, attempts, retryDelayMs, sleep); }
    catch (error) { return failure(`SEC archive refused or failed the primary document of ${filing.accession}: ${error.message}`); }
    try { parsed = parseNportPrimary(receipt.text); }
    catch (error) { return failure(`SEC primary document of ${filing.accession} could not be parsed: ${error.message}`); }
    opened.push({ ...describe(filing), seriesId: parsed.seriesId, seriesName: parsed.seriesName });
    if (parsed.seriesName.toLowerCase().includes(seriesNameMatch.toLowerCase())) { selected = { filing, receipt, parsed }; break; }
  }
  if (!selected) return failure(`none of the ${opened.length} N-PORT primary documents opened (limit ${maxDocuments}) names a series containing "${seriesNameMatch}"`);

  const { filing, receipt, parsed } = selected;
  if (parsed.cik !== cik) return failure(`N-PORT ${filing.accession} names registrant CIK ${parsed.cik}, not ${cik}`);
  if (parsed.repPdDate !== filing.reportDate) return failure(`N-PORT ${filing.accession} report date ${parsed.repPdDate} differs from the submissions index (${filing.reportDate})`);
  if (!isQuarterEndDate(parsed.repPdDate)) return failure(`N-PORT ${filing.accession} report date ${parsed.repPdDate} is not a quarter end`);

  const { expectedDate, snapshot } = selectSnapshotForNport(snapshots, parsed.repPdDate);
  const comparison = compareNportWithSnapshot(parsed, snapshot, { cashLike: options.cashLike, expectedSnapshotDate: expectedDate, shareTolerance: options.shareTolerance });
  const dated = snapshots.map(candidate => candidate && candidate.date).filter(date => /^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))).sort();
  const compactAccession = filing.accession.replace(/-/g, '');
  const result = {
    ...base,
    ok: true,
    sourceStatus: 'official SEC N-PORT fetched',
    fetchError: null,
    registrantName: parsed.registrantName,
    seriesId: parsed.seriesId,
    seriesName: parsed.seriesName,
    seriesLei: parsed.seriesLei,
    configuredSeriesId: config.seriesId || null,
    seriesIdMatchesConfig: config.seriesId ? config.seriesId === parsed.seriesId : null,
    form: filing.form,
    isAmendment: parsed.isAmendment || filing.isAmendment,
    accession: filing.accession,
    filed: filing.filed,
    accepted: filing.accepted,
    reportDate: parsed.repPdDate,
    repPdEnd: parsed.repPdEnd,
    isFinalFiling: parsed.isFinalFiling,
    netAssets: parsed.netAssets,
    totAssets: parsed.totAssets,
    holdingCount: parsed.holdings.length,
    holdings: parsed.holdings.map(row => ({
      name: row.name, ticker: row.ticker, cusip: row.cusip, isin: row.isin, lei: row.lei, balance: row.balance, units: row.units, curCd: row.curCd,
      valUsd: row.valUsd, pctVal: row.pctVal, assetCat: row.assetCat, issuerCat: row.issuerCat, invCountry: row.invCountry, cashLike: row.cashLike,
    })),
    source: `SEC EDGAR ${filing.form}, accession ${filing.accession} (${parsed.registrantName}, CIK ${cik}; series ${parsed.seriesName}, ${parsed.seriesId})`,
    sourceUrl: `https://www.sec.gov/Archives/edgar/data/${String(Number(cik))}/${compactAccession}/${filing.accession}-index.html`,
    snapshotRange: dated.length ? { first: dated[0], last: dated[dated.length - 1], count: dated.length } : null,
    comparison,
    nextOpportunity: nextNportOpportunity(parsed.repPdDate),
    provenance: {
      ...base.provenance,
      primary: { url: receipt.url, sha256: receipt.sha256, bytes: receipt.bytes, etag: receipt.etag, lastModified: receipt.lastModified },
    },
  };
  result.summary = summarizeNportCheck(result);
  return result;
}

module.exports = {
  isOlderSameDateRevision,
  reconcileWagnHoldingsToNav,
  secUserAgent,
  summarizeWagnUnitFlow,
  DEFAULT_SEC_USER_AGENT,
  WAGN_REQUIRED_HEADERS,
  aggregateSecRows,
  compareManualDalal,
  compareNportWithSnapshot,
  diffWagnSnapshots,
  fetchDalalStreet13f,
  fetchLatestPabraiNport,
  fetchResource,
  isQuarterEndDate,
  isoFromUs,
  isoFromSec,
  issuerNameKey,
  nextNportOpportunity,
  nextWeekdayDate,
  normalizeCik,
  normalizeWagnHoldings,
  selectWagnNavObservation,
  parseCsv,
  parseNportPrimary,
  parseSecInformationTable,
  parseSecPrimary,
  recent13fFilings,
  secSecurityKey,
  selectCurrentAndPrevious13f,
  selectNportFilings,
  selectSnapshotForNport,
  sha256,
  strictNumber,
  summarizeNportCheck,
  validateWagnHoldingsFreshness,
};
