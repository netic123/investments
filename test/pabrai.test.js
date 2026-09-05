'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_SEC_USER_AGENT,
  classify13fChange,
  compareManualDalal,
  compareNportWithSnapshot,
  diffWagnSnapshots,
  formatDayMonthYear,
  impliedUnitsFromNav,
  isOlderSameDateRevision,
  isQuarterEndDate,
  usFederalHoliday,
  issuerNameKey,
  fetchDalalStreet13f,
  fetchLatestPabraiNport,
  next13fDeadline,
  nextNportOpportunity,
  normalizeWagnHoldings,
  parseCsv,
  parseNportPrimary,
  parseSecInformationTable,
  parseSecPrimary,
  reconcileWagnHoldingsToNav,
  rollToBusinessDay,
  secContactKind,
  secUserAgent,
  selectWagnNavObservation,
  selectCurrentAndPrevious13f,
  selectNportFilings,
  selectShareholderReports,
  selectSnapshotForNport,
  summarizeNportCheck,
  summarizeWagnUnitFlow,
  validateWagnHoldingsFreshness,
  nextTradingDay,
  nyseClosure,
} = require('../pabrai');

const WAGN_HEADER = 'Date,Account,StockTicker,CUSIP,SecurityName,Shares,Price,MarketValue,Weightings,NetAssets,SharesOutstanding,CreationUnits,MoneyMarketFlag';

function primaryXml({ date, entries, total, amendment = false }) {
  return `<?xml version="1.0"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/thirteenffiler">
  <headerData><filerInfo><periodOfReport>${date}</periodOfReport></filerInfo></headerData>
  <formData><coverPage><reportCalendarOrQuarter>${date}</reportCalendarOrQuarter><isAmendment>${amendment}</isAmendment><filingManager><name>Dalal Street, LLC</name></filingManager><reportType>13F HOLDINGS REPORT</reportType></coverPage>
  <summaryPage><tableEntryTotal>${entries}</tableEntryTotal><tableValueTotal>${total}</tableValueTotal></summaryPage></formData>
</edgarSubmission>`;
}

function infoXml(rows) {
  return `<?xml version="1.0"?><informationTable xmlns="http://www.sec.gov/edgar/document/thirteenf/informationtable">${rows.map(row => `
  <infoTable><nameOfIssuer>${row.issuer}</nameOfIssuer><titleOfClass>${row.title || 'COM'}</titleOfClass><cusip>${row.cusip}</cusip><value>${row.value}</value>
    <shrsOrPrnAmt><sshPrnamt>${row.shares}</sshPrnamt><sshPrnamtType>SH</sshPrnamtType></shrsOrPrnAmt><investmentDiscretion>SOLE</investmentDiscretion>
    <votingAuthority><Sole>${row.shares}</Sole><Shared>0</Shared><None>0</None></votingAuthority></infoTable>`).join('')}
</informationTable>`;
}

function response(body, status = 200, headers = {}) {
  const bytes = Buffer.from(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: { get: name => headers[String(name).toLowerCase()] || null },
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  };
}

test('CSV parser preserves a quoted comma and validates complete rows', () => {
  const parsed = parseCsv('A,B\r\n1,"Example, Inc."\r\n');
  assert.deepEqual(parsed.headers, ['A', 'B']);
  assert.deepEqual(parsed.rows, [{ A: '1', B: 'Example, Inc.' }]);
  assert.throws(() => parseCsv('A,B\n1\n'), /has 1 columns; expected 2/);
});

test('WAGN parser validates schema and retains CUSIP, fund shares and provenance', () => {
  const csv = `${WAGN_HEADER}\n` +
    '08/25/2026,WAGN,ABC,012345678,"Example, Inc.",90,10,900,90%,1000,100,0.01,N\n' +
    '08/25/2026,WAGN,USD,,US Dollar,100,1,100,10%,1000,100,0.01,N\n';
  const snap = normalizeWagnHoldings(csv, {
    cashTickers: ['USD'],
    sourceUrl: 'https://example.test/holdings.csv',
    officialPage: 'https://example.test/fund',
    retrievedAt: '2026-08-25T01:00:00.000Z',
    lastModified: 'Tue, 25 Aug 2026 00:02:24 GMT',
    etag: 'abc',
  });
  assert.equal(snap.date, '2026-08-25');
  assert.equal(snap.sharesOutstanding, 100);
  assert.equal(snap.rows.ABC.cusip, '012345678');
  assert.equal(snap.rows.ABC.name, 'Example, Inc.');
  assert.equal(snap.cash.USD, 100);
  assert.equal(snap.source.rowCount, 2);
  assert.equal(snap.source.fileDate, '2026-08-25');
  assert.equal(snap.source.lastModified, 'Tue, 25 Aug 2026 00:02:24 GMT');
  assert.match(snap.source.sha256, /^[0-9a-f]{64}$/);
});

test('WAGN freshness accepts only the immediately next trading day across a weekend', () => {
  const friday = validateWagnHoldingsFreshness('2026-08-31', '2026-08-28T23:59:59.000Z');
  const saturday = validateWagnHoldingsFreshness('2026-08-31', '2026-08-29T14:31:00.000Z');
  const sunday = validateWagnHoldingsFreshness('2026-08-31', '2026-08-30T09:15:00.000Z');

  assert.deepEqual(
    [friday.ageDays, saturday.ageDays, sunday.ageDays],
    [-3, -2, -1],
    'the same next-weekday receipt has different but valid calendar offsets across the weekend',
  );
  assert.ok(friday.futureDateAccepted && saturday.futureDateAccepted && sunday.futureDateAccepted);
  assert.equal(saturday.maximumFutureDate, '2026-08-31');
});

test('WAGN freshness accepts the file dated the trading day after a market holiday', () => {
  // Sat 5 Sep 2026 00:02 UTC: FilePoint published the file priced at Fri 4 Sep's close dated Tue 8 Sep (Labor Day skipped)
  const saturday = validateWagnHoldingsFreshness('2026-09-08', '2026-09-05T00:28:21.905Z');
  assert.equal(saturday.maximumFutureDate, '2026-09-08');
  assert.ok(saturday.futureDateAccepted);
  assert.equal(validateWagnHoldingsFreshness('2026-09-08', '2026-09-07T10:00:00.000Z').maximumFutureDate, '2026-09-08', 'on the holiday itself');
  assert.equal(validateWagnHoldingsFreshness('2026-09-08', '2026-09-08T00:10:00.000Z').ageDays, 0);
  assert.throws(
    () => validateWagnHoldingsFreshness('2026-09-09', '2026-09-05T00:28:21.905Z'),
    /unsupported future date \(2026-09-09; checked 2026-09-05; next allowed trading day 2026-09-08\)/,
  );
  assert.equal(nextTradingDay('2026-09-04'), '2026-09-08');
  assert.equal(nextTradingDay('2026-12-31'), '2027-01-04', '1 Jan 2027 is a closure');
  assert.equal(nextTradingDay('2026-04-02'), '2026-04-06', 'Good Friday 2026 is a closure but not a federal holiday');
  assert.equal(nextTradingDay('2026-10-09'), '2026-10-12', 'Columbus Day is a federal holiday but the NYSE is open');
  assert.equal(nyseClosure('2026-09-07'), 'Labor Day');
  assert.equal(nextTradingDay('2028-06-30'), '2028-07-03', 'beyond the list only weekends are skipped');
});

test('WAGN freshness rejects arbitrary future dates and preserves the stale boundary', () => {
  assert.throws(
    () => validateWagnHoldingsFreshness('2026-09-01', '2026-08-29T14:31:00.000Z'),
    /unsupported future date/,
  );
  assert.throws(
    () => validateWagnHoldingsFreshness('2026-08-28', '2026-08-26T09:15:00.000Z'),
    /unsupported future date/,
  );
  assert.equal(
    validateWagnHoldingsFreshness('2026-08-24', '2026-08-29T09:15:00.000Z').ageDays,
    5,
  );
  assert.throws(
    () => validateWagnHoldingsFreshness('2026-08-23', '2026-08-29T09:15:00.000Z'),
    /6 calendar days old/,
  );
  assert.throws(
    () => validateWagnHoldingsFreshness('2026-02-30', '2026-08-29T09:15:00.000Z'),
    /not a valid calendar date/,
  );
  assert.throws(
    () => validateWagnHoldingsFreshness('2026-08-31', 'not-a-timestamp'),
    /check time is not an exact UTC timestamp/,
  );
  assert.throws(
    () => validateWagnHoldingsFreshness('2026-08-31', '2026-08-29'),
    /check time is not an exact UTC timestamp/,
  );
  assert.throws(
    () => validateWagnHoldingsFreshness('2026-08-31', '2026-08-29T16:31:00.000+02:00'),
    /check time is not an exact UTC timestamp/,
  );
});

test('WAGN parser recognises a new CASH currency CUSIP without allowing negative securities', () => {
  const security = '08/26/2026,WAGN,ABC,012345678,Example Inc,100.1,10,1001,100.1%,1000,100,0.01,N';
  const nokCash = '08/26/2026,WAGN,NOK,CASHNOK,NORWEGIAN KRONE,-9.29,1,-1,-0.1%,1000,100,0.01,';
  const snap = normalizeWagnHoldings(`${WAGN_HEADER}\n${security}\n${nokCash}\n`);
  assert.equal(snap.cash.NOK, -1);
  assert.equal(snap.rows.NOK, undefined);

  const negativeSecurity = '08/26/2026,WAGN,NOK,123456789,Norwegian Security,-1,1,-1,-0.1%,1000,100,0.01,N';
  assert.throws(
    () => normalizeWagnHoldings(`${WAGN_HEADER}\n${security}\n${negativeSecurity}\n`),
    /NOK MarketValue must not be negative/,
  );
});

test('newer official NAV history wins over a lagging DailyNAV row', () => {
  const daily = { date: '2026-08-24', nav: 15.69, navChgPct: -0.4442, price: 15.73, premium: 0.2549, netAssets: 281144824.56, sharesOut: 17920814 };
  const history = [
    { date: '2026-08-24', nav: 15.69, price: 15.73, premium: 0.2549 },
    { date: '2026-08-25', nav: 15.84, price: 15.91, premium: 0.4419 },
  ];
  const selected = selectWagnNavObservation(daily, history);
  assert.equal(selected.date, '2026-08-25');
  assert.equal(selected.nav, 15.84);
  assert.equal(selected.currentSource, 'historical');
  assert.equal(selected.dailyFileDate, '2026-08-24');
  assert.equal(selected.sharesOut, null, 'stale DailyNAV-only fields must not be relabelled as current');
  assert.ok(Math.abs(selected.navChgPct - (15.84 / 15.69 - 1) * 100) < 1e-12);
});

test('WAGN parser rejects duplicate tickers and inconsistent source dates', () => {
  const row = '08/25/2026,WAGN,ABC,012345678,Example Inc,90,10,900,50%,1800,100,0.01,N';
  assert.throws(() => normalizeWagnHoldings(`${WAGN_HEADER}\n${row}\n${row}\n`), /duplicate StockTicker/);
  const second = '08/24/2026,WAGN,USD,,US Dollar,900,1,900,50%,1800,100,0.01,N';
  assert.throws(() => normalizeWagnHoldings(`${WAGN_HEADER}\n${row}\n${second}\n`, { cashTickers: ['USD'] }), /different Date/);
});

test('enriching a legacy snapshot with CUSIPs does not fabricate sales and new holdings', () => {
  const before = { date: '2026-08-24', rows: {
    HCC: { shares: 254389, price: 106.73, mv: 27150938 },
    RIG: { shares: 4128872, price: 5.92, mv: 24442922 },
  } };
  const after = { date: '2026-08-25', sharesOutstanding: 17920814, rows: {
    HCC: { cusip: '93627C101', shares: 254389, price: 106.60, mv: 27117867 },
    RIG: { cusip: 'H8817H100', shares: 4128872, price: 5.77, mv: 23823591 },
  } };
  assert.deepEqual(diffWagnSnapshots(before, after), []);
  after.rows.HCC.shares -= 100;
  const changes = diffWagnSnapshots(before, after);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].ticker, 'HCC');
  assert.equal(changes[0].kind, 'DECREASE');
  assert.equal(changes[0].delta, -100);
});

test('CUSIP identity survives a ticker rename and flow adjustment separates ETF flows', () => {
  const before = { date: '2026-08-24', sharesOutstanding: 1000, rows: {
    OLD: { cusip: '012345678', shares: 100, price: 10, mv: 1000 },
  } };
  const after = { date: '2026-08-25', sharesOutstanding: 1100, rows: {
    NEW: { cusip: '012345678', shares: 120, price: 10, mv: 1200 },
  } };
  const [change] = diffWagnSnapshots(before, after);
  assert.equal(change.tickerFrom, 'OLD');
  assert.equal(change.tickerTo, 'NEW');
  assert.equal(change.delta, 20);
  assert.equal(change.kind, 'INCREASE');
  assert.equal(change.expectedSharesTo, 110);
  assert.equal(change.flowAdjustedDelta, 10);
  assert.equal(change.signalDelta, 20, 'the headline is the raw inventory change');
  assert.equal(change.approxUsd, 200, 'value at the latest price is the raw change');
  assert.equal(change.flowAdjusted, true);
  assert.deepEqual(change.unitFlow, { from: '2026-08-24', to: '2026-08-25', known: true, state: 'known', unitsFrom: 1000, unitsTo: 1100, delta: 100, pct: 10, kind: 'creation', perUnitPct: 1000 / 1100 * 100 - 100 });
  assert.equal(change.unitsKnown, true);
  after.rows.NEW.shares = 110;
  assert.deepEqual(diffWagnSnapshots(before, after), [], 'a purely proportional in-kind creation flow is not a manager-change signal');
});

test('a cash creation never turns untraded holdings into changes', () => {
  // WAGN 2026-08-31 -> 2026-09-01: 150,000 units created for cash; HCC, RIG and
  // CSU CN were not traded, RYGYO TI was bought, AMR was trimmed.
  const before = { date: '2026-08-31', sharesOutstanding: 18170814, rows: {
    HCC: { cusip: '93627C101', shares: 254389, price: 108.24, mv: 27535065.36 },
    RIG: { cusip: 'H8817H100', shares: 4128872, price: 5.81, mv: 23988746.32 },
    'CSU CN': { cusip: 'B15C4L6', shares: 5735, price: 3138.72, mv: 12987884.99 },
    'RYGYO TI': { cusip: 'B3VKHD1', shares: 37081196, price: 50.80, mv: 39032000 },
    AMR: { cusip: '020764106', shares: 62041, price: 235.70, mv: 14623063.7 },
  } };
  const after = { date: '2026-09-01', sharesOutstanding: 18320814, rows: {
    HCC: { cusip: '93627C101', shares: 254389, price: 108.24, mv: 27535065.36 },
    RIG: { cusip: 'H8817H100', shares: 4128872, price: 5.81, mv: 23988746.32 },
    'CSU CN': { cusip: 'B15C4L6', shares: 5735, price: 3138.72, mv: 12987884.99 },
    'RYGYO TI': { cusip: 'B3VKHD1', shares: 38693581, price: 50.80, mv: 40730085.26 },
    AMR: { cusip: '020764106', shares: 61541, price: 235.70, mv: 14505213.7 },
  } };
  const changes = diffWagnSnapshots(before, after);
  assert.deepEqual(changes.map(c => [c.ticker, c.kind, c.delta]), [['RYGYO TI', 'INCREASE', 1612385], ['AMR', 'DECREASE', -500]]);
  const [rygyo, amr] = changes;
  assert.equal(rygyo.flowAdjusted, true);
  assert.ok(Math.abs(rygyo.flowAdjustedDelta - 1306280) < 1, 'pro-rata context stays available');
  assert.equal(amr.signalDelta, -500);
  assert.ok(amr.flowAdjustedDelta < -500, 'the trim is larger relative to a pro-rata deployment');
  const flow = summarizeWagnUnitFlow(before, after);
  assert.equal(flow.delta, 150000);
  assert.equal(flow.kind, 'creation');
  assert.ok(Math.abs(flow.perUnitPct + 0.8188) < 0.001);
  // a legacy receipt without a unit count is an explicit unknown, never "no flow"
  assert.deepEqual(summarizeWagnUnitFlow({ date: '2026-08-20', rows: {} }, after),
    { from: '2026-08-20', to: '2026-09-01', known: false, state: 'units unknown for the earlier file', unitsFrom: null, unitsTo: 18320814, delta: null, pct: null, kind: 'unknown', perUnitPct: null });
  assert.equal(summarizeWagnUnitFlow({ date: '2026-08-20', rows: {} }, { date: '2026-08-24', rows: {} }).state, 'units unknown for both files');
  assert.equal(summarizeWagnUnitFlow(after, { date: '2026-09-02', rows: {} }).state, 'units unknown for the later file');
  const legacyChange = diffWagnSnapshots({ date: '2026-08-20', rows: { HCC: { cusip: '93627C101', shares: 254000, price: 108, mv: 27432000 } } }, after);
  assert.equal(legacyChange.find(c => c.ticker === 'HCC').unitsKnown, false);
  assert.equal(legacyChange.find(c => c.ticker === 'HCC').unitFlowState, 'units unknown for the earlier file');
  assert.equal(legacyChange.find(c => c.ticker === 'HCC').flowAdjusted, false);
  // no units changed: nothing is flow-adjusted, and identical files produce no rows
  const same = { ...after, date: '2026-09-02' };
  assert.deepEqual(diffWagnSnapshots(after, same), []);
  same.rows = { ...after.rows, HCC: { ...after.rows.HCC, shares: 254000 } };
  const [hcc] = diffWagnSnapshots(after, same);
  assert.equal(hcc.flowAdjusted, false);
  assert.equal(hcc.delta, -389);
});

test('pricing date reconciles exactly or per share, and says why when it cannot', () => {
  const receipt = { date: '2026-09-01', netAssets: 296613978.66, sharesOutstanding: 18320814 };
  // a creation settled after the NAV file: the unit count differs but NetAssets / units is the NAV to the cent
  const perShare = reconcileWagnHoldingsToNav(receipt, { date: '2026-08-31', nav: 16.19, sharesOut: 18170814 });
  assert.equal(perShare.matched, true);
  assert.equal(perShare.mode, 'per-share');
  assert.equal(perShare.unitChange, 150000);
  assert.equal(perShare.navDate, '2026-08-31');
  // same unit count in both files
  const exact = reconcileWagnHoldingsToNav({ date: '2026-08-28', netAssets: 289824483.3, sharesOutstanding: 18170814 }, { date: '2026-08-27', nav: 15.95, sharesOut: 18170814 });
  assert.equal(exact.mode, 'exact');
  assert.equal(exact.unitChange, 0);
  // a NAV that lags the historical file has no unit count; the per-share proof still works
  assert.equal(reconcileWagnHoldingsToNav(receipt, { date: '2026-08-31', nav: 16.19, sharesOut: null }).mode, 'exact');
  // the wrong day
  const wrong = reconcileWagnHoldingsToNav(receipt, { date: '2026-08-28', nav: 16.06, sharesOut: 18170814 });
  assert.equal(wrong.matched, false);
  assert.match(wrong.reason, /16\.1900 per share does not equal the 2026-08-28 NAV of 16\.06/);
  // NAV newer than the receipt or too old
  assert.match(reconcileWagnHoldingsToNav(receipt, { date: '2026-09-02', nav: 16.19, sharesOut: 18320814 }).reason, /not within the four days/);
  assert.match(reconcileWagnHoldingsToNav(receipt, { date: '2026-08-25', nav: 16.19, sharesOut: 18320814 }).reason, /not within the four days/);
  assert.equal(reconcileWagnHoldingsToNav(receipt, null).reason, 'required NAV reconciliation fields are missing');
});

test('the NAV reconciliation reports the NAV file\'s own net assets and how far the rounded NAV x units is from it', () => {
  // WAGN 2026-09-04 file: NetAssets 294,965,105.40 = 16.10 x 18,320,814; DailyNAV 3 Sep: net assets 294,891,395.17
  const receipt = { date: '2026-09-04', netAssets: 294965105.4, sharesOutstanding: 18320814 };
  const same = reconcileWagnHoldingsToNav(receipt, { date: '2026-09-03', nav: 16.10, sharesOut: 18320814, netAssets: 294891395.17 });
  assert.equal(same.mode, 'exact');
  assert.equal(same.navFileNetAssets, 294891395.17);
  assert.ok(Math.abs(same.netAssetsDifference - 73710.23) < 0.01, 'holdings file minus NAV file');
  assert.equal(same.netAssetsComparable, true);
  assert.ok(Math.abs(same.navFileNavPerUnit - 16.0960) < 0.0001, 'the NAV file implies an unrounded NAV per unit');
  assert.match(same.netAssetsNote, /rounded NAV x units; the NAV file's own net assets differ by \+73710\.23 USD/);
  // different unit counts: the totals are not comparable, and the result says so instead of a number
  const creation = reconcileWagnHoldingsToNav({ date: '2026-09-01', netAssets: 296613978.66, sharesOutstanding: 18320814 }, { date: '2026-08-31', nav: 16.19, sharesOut: 18170814, netAssets: 294200000 });
  assert.equal(creation.mode, 'per-share');
  assert.equal(creation.netAssetsDifference, null);
  assert.equal(creation.netAssetsComparable, false);
  assert.match(creation.netAssetsNote, /different unit counts/);
  // a NAV observation without net assets
  const bare = reconcileWagnHoldingsToNav(receipt, { date: '2026-09-03', nav: 16.10, sharesOut: null });
  assert.equal(bare.navFileNetAssets, null);
  assert.match(bare.netAssetsNote, /carries no net assets figure/);
});

test('units implied from NetAssets / NAV are accepted only when the file is exactly NAV x a whole number of units', () => {
  // the two legacy receipts (no SharesOutstanding column saved): 20 Aug priced at the 19 Aug NAV, 24 Aug at the 21 Aug NAV
  assert.equal(impliedUnitsFromNav(277772617, 15.50).units, 17920814);
  assert.equal(impliedUnitsFromNav(282432028.64, 15.76).units, 17920814);
  const good = impliedUnitsFromNav(277772617, 15.50);
  assert.equal(good.implied, true);
  assert.equal(good.residual, 0);
  // the accept band is the only deviation the arithmetic allows (two cent-roundings), not a flat 0.01 units
  assert.ok(good.roundingErrorBound < 0.001 && good.tolerance === good.roundingErrorBound * 2, 'the accept band is twice the cent-rounding bound');
  // a quotient 0.004 units off is inside the old flat band and outside the arithmetic one
  const nearMiss = impliedUnitsFromNav(17920814 * 15.5 + 0.062, 15.50);
  assert.equal(nearMiss.implied, false, '0.004 units from a whole number proves nothing at this NAV');
  // the wrong NAV date
  const wrong = impliedUnitsFromNav(277772617, 15.67);
  assert.equal(wrong.implied, false);
  assert.equal(wrong.units, null);
  assert.match(wrong.reason, /not a whole number of units/);
  // the NAV file's own net assets are not NAV x units, and must never yield a count
  assert.equal(impliedUnitsFromNav(294891395.17, 16.10).implied, false);
  assert.equal(impliedUnitsFromNav(null, 16.10).reason, 'NetAssets or NAV is missing');
});

test('the in-kind flow tolerance is pinned at its boundary', () => {
  const before = { date: '2026-08-24', sharesOutstanding: 1000, rows: { A: { cusip: '000000001', shares: 10000, price: 1, mv: 10000 } } };
  const after = shares => ({ date: '2026-08-25', sharesOutstanding: 1100, rows: { A: { cusip: '000000001', shares, price: 1, mv: shares } } });
  // pro-rata would be 11,000; 0.5 % of the 1,000-share move is 5 shares
  assert.deepEqual(diffWagnSnapshots(before, after(11005)), [], 'inside the tolerance the move is an in-kind flow');
  assert.deepEqual(diffWagnSnapshots(before, after(10996)), [], 'the tolerance scales with the size of the move');
  assert.equal(diffWagnSnapshots(before, after(11006)).length, 1, 'outside the tolerance the move is a trade');
  assert.equal(diffWagnSnapshots(before, after(10994))[0].kind, 'INCREASE', 'the raw direction is the headline even below pro-rata');
});

test('a re-served older revision of a saved file date is recognised', () => {
  const saved = { sha256: 'a'.repeat(64), lastModified: 'Tue, 01 Sep 2026 03:00:00 GMT' };
  assert.equal(isOlderSameDateRevision(saved, { sha256: 'b'.repeat(64), lastModified: 'Tue, 01 Sep 2026 00:02:17 GMT' }), true);
  assert.equal(isOlderSameDateRevision(saved, { sha256: 'b'.repeat(64), lastModified: 'Tue, 01 Sep 2026 04:00:00 GMT' }), false, 'a newer revision replaces the saved one');
  assert.equal(isOlderSameDateRevision(saved, { sha256: 'a'.repeat(64), lastModified: 'Mon, 31 Aug 2026 00:00:00 GMT' }), false, 'identical bytes are not a revision');
  assert.equal(isOlderSameDateRevision(saved, { sha256: 'b'.repeat(64), lastModified: null }), false, 'without both timestamps nothing can be concluded');
  assert.equal(isOlderSameDateRevision(null, { sha256: 'b'.repeat(64), lastModified: 'Tue, 01 Sep 2026 00:02:17 GMT' }), false);
});

test('the manual 13F copy is compared on identity and prior-quarter fields too', () => {
  const live = {
    asOf: '2026-06-30', filed: '2026-08-13', accession: '0001549575-26-000015', portfolioValueUsd: 100,
    previous: { accession: '0001549575-26-000009' },
    holdings: [
      { cusip: '020764106', shares: 10, prevShares: 5, valueUsd: 100 },
      { cusip: '674599105', shares: 0, prevShares: 7, valueUsd: 0, exited: true },
    ],
  };
  const manual = { asOf: '2026-06-30', filed: '2026-08-13', accession: '0001549575-26-000015', manualVerifiedAt: '2026-08-26', portfolioValueUsd: 100,
    previous: { accession: '0001549575-26-000009' }, holdings: [{ cusip: '020764106', shares: 10, prevShares: 5, valueUsd: 100 }] };
  assert.deepEqual(compareManualDalal(live, manual), { matches: true, mismatches: [] }, 'exited rows do not count against the manual copy');
  assert.match(compareManualDalal(live, { ...manual, manualVerifiedAt: undefined }).mismatches.join(';'), /no verification date/);
  assert.match(compareManualDalal(live, { ...manual, previous: { accession: '0001549575-26-000002' } }).mismatches.join(';'), /previous accession/);
  assert.match(compareManualDalal(live, { ...manual, holdings: [{ ...manual.holdings[0], prevShares: 4 }] }).mismatches.join(';'), /prior-quarter shares 4 != 5/);
});

test('SEC requests use a declared User-Agent that SEC accepts', () => {
  // SEC's edge answers 403 to anything that mentions github.com or github.io.
  assert.doesNotMatch(DEFAULT_SEC_USER_AGENT, /github\.(com|io)/i);
  assert.equal(secUserAgent(''), DEFAULT_SEC_USER_AGENT);
  assert.equal(secUserAgent('Example Fund research (contact@example.com)'), 'Example Fund research (contact@example.com)');
  assert.throws(() => secUserAgent('bot (me@users.noreply.github.com)'), /SEC rejects/);
  assert.throws(() => secUserAgent('bot (+https://user.github.io/site)'), /SEC rejects/);
  assert.throws(() => secUserAgent('bot (me@example.com)\r\nX-Injected: 1'), /printable ASCII/);
  assert.throws(() => secUserAgent('bot (mé@example.com)'), /printable ASCII/);
  // results say which kind of contact was used, never the value
  assert.equal(secContactKind(''), 'default');
  assert.equal(secContactKind(undefined), 'default');
  assert.equal(secContactKind('Example Fund research (contact@example.com)'), 'configured');
});

test('the next 13F deadline is computed from the report date: 45 days after the next quarter end, weekends rolled to Monday', () => {
  assert.deepEqual(next13fDeadline('2026-06-30'), {
    nextReportDate: '2026-09-30', dueDate: '2026-11-14', nextFilingDeadline: '2026-11-16', weekendRolled: true, rolledReason: 'a weekend', holidaysModelled: true,
    note: '45 days after the 2026-09-30 quarter end (2026-11-14 is a weekend, so the next business day)',
  });
  assert.equal(next13fDeadline('2026-03-31').nextFilingDeadline, '2026-08-14', 'a Friday stays');
  assert.equal(next13fDeadline('2026-03-31').weekendRolled, false);
  // 14 Feb 2027 is a Sunday and 15 Feb is Presidents' Day, so the deadline is Tuesday 16 Feb
  assert.equal(next13fDeadline('2026-09-30').nextFilingDeadline, '2027-02-16');
  assert.equal(next13fDeadline('2026-09-30').rolledReason, "a Sunday, and Presidents' Day the next working day");
  assert.equal(next13fDeadline('2026-12-31').nextFilingDeadline, '2027-05-17', '15 May 2027 is a Saturday');
  assert.throws(() => next13fDeadline('2026-6-30'), /exact ISO date/);
  assert.equal(rollToBusinessDay('2026-11-29'), '2026-11-30');
  assert.equal(rollToBusinessDay('2026-11-28'), '2026-11-30');
  assert.equal(rollToBusinessDay('2026-11-27'), '2026-11-27');
  // the eleven federal holidays, including the observed-day rule
  assert.equal(usFederalHoliday('2027-02-15'), "Presidents' Day");
  assert.equal(usFederalHoliday('2026-07-03'), 'Independence Day', '4 July 2026 is a Saturday, observed on the Friday');
  assert.equal(usFederalHoliday('2027-12-24'), 'Christmas Day', '25 Dec 2027 is a Saturday, observed on the Friday');
  assert.equal(usFederalHoliday('2026-11-26'), 'Thanksgiving Day');
  assert.equal(usFederalHoliday('2026-11-27'), null, 'the day after Thanksgiving is not a federal holiday');
  assert.equal(rollToBusinessDay('2027-07-03'), '2027-07-06', 'Saturday, Sunday, then the observed Independence Day');
  assert.equal(formatDayMonthYear('2026-11-16'), '16 Nov 2026');
  assert.equal(formatDayMonthYear('2026-09-08'), '8 Sept 2026', 'the page\'s own month style');
});

test('13F rows are classified by what the filings establish, with the de minimis threshold flagged', () => {
  // KSPI in 0001549575-26-000015: 1,702 shares, $147,461, absent from the prior filing
  const kspi = classify13fChange({ shares: 1702, prevShares: null, valueUsd: 147461, prevValueUsd: null });
  assert.equal(kspi.deMinimis, true);
  assert.equal(kspi.change, 'first reported');
  assert.match(kspi.changeNote, /under 10,000 shares and under \$200,000.*may have been held unreported last quarter/);
  // a large row not in the prior filing
  const large = classify13fChange({ shares: 50000, prevShares: null, valueUsd: 5000000 });
  assert.equal(large.deMinimis, false);
  assert.equal(large.change, 'new');
  assert.equal(large.changeText, 'new (not reported last quarter)');
  // rows above the threshold on both sides keep the plain direction
  assert.equal(classify13fChange({ shares: 1744050, prevShares: 1810831, valueUsd: 141547098, prevValueUsd: 150000000 }).change, 'decrease');
  assert.equal(classify13fChange({ shares: 20398659, prevShares: 20392672, valueUsd: 99749443, prevValueUsd: 90000000 }).change, 'increase');
  assert.equal(classify13fChange({ shares: 10, prevShares: 10, valueUsd: 5000000, prevValueUsd: 4000000 }).change, 'unchanged');
  // a vanished row: small last quarter, so it may still be held; large last quarter, so sold or below threshold; unknown prior value
  const smallExit = classify13fChange({ shares: 0, prevShares: 7, valueUsd: 0, prevValueUsd: 30, exited: true });
  assert.equal(smallExit.change, 'no longer reported');
  assert.equal(smallExit.prevDeMinimis, true);
  assert.match(smallExit.changeNote, /may still be held/);
  const largeExit = classify13fChange({ shares: 0, prevShares: 100000, valueUsd: 0, prevValueUsd: 8000000 });
  assert.equal(largeExit.prevDeMinimis, false);
  assert.match(largeExit.changeNote, /sold out, reduced below the 13F reporting threshold, or no longer a 13\(f\) security/);
  const manualExit = classify13fChange({ shares: 0, prevShares: 100000, valueUsd: 0 });
  assert.equal(manualExit.prevDeMinimis, null);
  assert.match(manualExit.changeNote, /prior value is not in this copy/);
  // the threshold is both conditions: 9,999 shares worth $250,000 is reportable
  assert.equal(classify13fChange({ shares: 9999, prevShares: 9000, valueUsd: 250000, prevValueUsd: 200000 }).deMinimis, false);
});

test('SEC XML parsers preserve leading-zero and letter-leading CUSIPs', () => {
  const primary = parseSecPrimary(primaryXml({ date: '06-30-2026', entries: 2, total: 150 }));
  const rows = parseSecInformationTable(infoXml([
    { issuer: 'ALPHA METALLURGICAL RESOUR I', cusip: '020764106', shares: 10, value: 100 },
    { issuer: 'TRANSOCEAN LTD', cusip: 'H8817H100', shares: 5, value: 50 },
  ]));
  assert.equal(primary.reportDate, '2026-06-30');
  assert.equal(primary.tableEntryTotal, 2);
  assert.deepEqual(rows.map(row => row.cusip), ['020764106', 'H8817H100']);
  assert.equal(rows.reduce((sum, row) => sum + row.valueUsd, 0), 150);
});

test('automatic SEC ingestion selects the latest two quarters and validates totals', async () => {
  const submissions = {
    cik: '0001549575',
    filings: { recent: {
      form: ['13F-HR', '13F-HR'],
      accessionNumber: ['0001549575-26-000015', '0001549575-26-000009'],
      filingDate: ['2026-08-13', '2026-05-14'],
      acceptanceDateTime: ['2026-08-13T11:50:17.000Z', '2026-05-14T15:00:59.000Z'],
      reportDate: ['2026-06-30', '2026-03-31'],
      primaryDocument: ['xslForm13F_X02/primary_doc.xml', 'xslForm13F_X02/primary_doc.xml'],
    } },
  };
  const bodies = new Map([
    ['https://data.sec.gov/submissions/CIK0001549575.json', JSON.stringify(submissions)],
    ['https://www.sec.gov/Archives/edgar/data/1549575/000154957526000015/primary_doc.xml', primaryXml({ date: '06-30-2026', entries: 1, total: 100 })],
    ['https://www.sec.gov/Archives/edgar/data/1549575/000154957526000015/infotable.xml', infoXml([{ issuer: 'ALPHA METALLURGICAL RESOUR I', cusip: '020764106', shares: 10, value: 100 }])],
    ['https://www.sec.gov/Archives/edgar/data/1549575/000154957526000009/primary_doc.xml', primaryXml({ date: '03-31-2026', entries: 1, total: 50 })],
    ['https://www.sec.gov/Archives/edgar/data/1549575/000154957526000009/infotable.xml', infoXml([{ issuer: 'ALPHA METALLURGICAL RESOUR I', cusip: '020764106', shares: 5, value: 50 }])],
  ]);
  const seenUserAgents = new Set();
  const fetchImpl = async (url, init) => {
    assert.ok(bodies.has(url), `unexpected URL ${url}`);
    seenUserAgents.add(init.headers['User-Agent']);
    return response(bodies.get(url), 200, { etag: 'fixture' });
  };
  const result = await fetchDalalStreet13f({
    cik: '0001549575',
    managerName: 'Dalal Street, LLC',
    manualVerifiedAt: '2026-08-26',
    userAgentNote: 'the explicit userAgent below keeps this test independent of SEC_USER_AGENT in the environment',
    nextFilingWindow: 'by 16 Nov 2026',
    asOf: '2026-06-30',
    filed: '2026-08-13',
    portfolioValueUsd: 100,
    holdings: [{ ticker: 'AMR', name: 'Alpha Metallurgical', cusip: '020764106', shares: 10, prevShares: 5, valueUsd: 100 }],
  }, { fetchImpl, userAgent: DEFAULT_SEC_USER_AGENT });
  assert.equal(result.ok, true);
  assert.equal(result.accession, '0001549575-26-000015');
  assert.equal(result.previous.accession, '0001549575-26-000009');
  assert.equal(result.holdings[0].ticker, 'AMR');
  assert.equal(result.holdings[0].shares, 10);
  assert.equal(result.holdings[0].prevShares, 5);
  assert.equal(result.holdings[0].prevValueUsd, 50);
  assert.equal(result.manualFallbackCheck.matches, true);
  assert.deepEqual([...seenUserAgents], [DEFAULT_SEC_USER_AGENT]);
  // the wording says who verified what; the machine value the build asserts is unchanged
  assert.equal(result.sourceStatus, 'official SEC verified');
  assert.match(result.sourceStatusText, /fetched from SEC EDGAR and validated by this build/);
  assert.doesNotMatch(result.sourceStatusText, /auto-verified/);
  assert.equal(result.secContact, 'default');
  // the prior filing behind every quarter-on-quarter change is named
  assert.deepEqual(result.previous, {
    form: '13F-HR', asOf: '2026-03-31', filed: '2026-05-14', accepted: '2026-05-14T15:00:59.000Z', accession: '0001549575-26-000009',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/1549575/000154957526000009/0001549575-26-000009-index.html', entryTotal: 1, portfolioValueUsd: 50,
  });
  assert.match(result.source, /previous quarter 0001549575-26-000009$/);
  // the next filing deadline is computed from the displayed report date, not copied from the config
  assert.equal(result.nextReportDate, '2026-09-30');
  assert.equal(result.nextFilingDeadline, '2026-11-16');
  assert.equal(result.nextFilingWindow, 'by 16 Nov 2026');
  assert.equal(result.nextFilingSource, 'computed');
  assert.equal(result.nextFilingHolidaysModelled, true, 'the computed deadline rolls past weekends and federal holidays');
  assert.equal(result.provenance.requests, 5, 'submissions index plus primary document and information table of two filings');
  assert.match(result.provenance.previousInformationTable.sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.deMinimisRule.shares, 10000);
});

test('a position reported only in the prior quarter is shown as an exit, not dropped', async () => {
  const submissions = {
    cik: '0001549575',
    filings: { recent: {
      form: ['13F-HR', '13F-HR'],
      accessionNumber: ['0001549575-26-000015', '0001549575-26-000009'],
      filingDate: ['2026-08-13', '2026-05-14'],
      acceptanceDateTime: ['2026-08-13T11:50:17.000Z', '2026-05-14T15:00:59.000Z'],
      reportDate: ['2026-06-30', '2026-03-31'],
      primaryDocument: ['xslForm13F_X02/primary_doc.xml', 'xslForm13F_X02/primary_doc.xml'],
    } },
  };
  const bodies = new Map([
    ['https://data.sec.gov/submissions/CIK0001549575.json', JSON.stringify(submissions)],
    ['https://www.sec.gov/Archives/edgar/data/1549575/000154957526000015/primary_doc.xml', primaryXml({ date: '06-30-2026', entries: 2, total: 147561 })],
    ['https://www.sec.gov/Archives/edgar/data/1549575/000154957526000015/infotable.xml', infoXml([
      { issuer: 'ALPHA METALLURGICAL RESOUR I', cusip: '020764106', shares: 10, value: 100 },
      // KASPI KZ JSC SPONSORED ADS as filed: under 10,000 shares and under $200,000
      { issuer: 'KASPI KZ JSC', title: 'SPONSORED ADS', cusip: '48581R205', shares: 1702, value: 147461 },
    ])],
    ['https://www.sec.gov/Archives/edgar/data/1549575/000154957526000009/primary_doc.xml', primaryXml({ date: '03-31-2026', entries: 2, total: 80 })],
    ['https://www.sec.gov/Archives/edgar/data/1549575/000154957526000009/infotable.xml', infoXml([
      { issuer: 'ALPHA METALLURGICAL RESOUR I', cusip: '020764106', shares: 5, value: 50 },
      { issuer: 'OCCIDENTAL PETE CORP', cusip: '674599105', shares: 7, value: 30 },
    ])],
  ]);
  const fetchImpl = async url => response(bodies.get(url), 200);
  const manual = {
    cik: '0001549575', managerName: 'Dalal Street, LLC', manualVerifiedAt: '2026-08-26',
    asOf: '2026-06-30', filed: '2026-08-13', accession: '0001549575-26-000015', portfolioValueUsd: 147561,
    previous: { accession: '0001549575-26-000009' },
    holdings: [
      { ticker: 'KSPI', name: 'Kaspi.kz', cusip: '48581R205', shares: 1702, prevShares: null, valueUsd: 147461 },
      { ticker: 'AMR', name: 'Alpha Metallurgical', cusip: '020764106', shares: 10, prevShares: 5, valueUsd: 100 },
    ],
  };
  const result = await fetchDalalStreet13f(manual, { fetchImpl });
  assert.deepEqual(result.holdings.map(row => [row.cusip, row.shares, row.prevShares, row.valueUsd, !!row.exited]), [
    ['48581R205', 1702, null, 147461, false],
    ['020764106', 10, 5, 100, false],
    ['674599105', 0, 7, 0, true],
  ]);
  // what the two filings establish, not "new" and "sold out"
  assert.deepEqual(result.holdings.map(row => [row.cusip, row.change, row.deMinimis, row.prevDeMinimis]), [
    ['48581R205', 'first reported', true, null],
    ['020764106', 'increase', true, true],
    ['674599105', 'no longer reported', false, true],
  ]);
  assert.match(result.holdings[0].changeNote, /may have been held unreported last quarter/);
  assert.match(result.holdings[2].changeNote, /may still be held/);
  assert.equal(result.holdings[2].prevValueUsd, 30);
  assert.equal(result.changeByCusip['674599105'].change, 'no longer reported');
  assert.equal(result.holdings.reduce((sum, row) => sum + row.valueUsd, 0), result.portfolioValueUsd);
  assert.equal(result.manualFallbackCheck.matches, true, JSON.stringify(result.manualFallbackCheck));
  // the manual copy is also checked against the prior quarter and the accession identity
  const wrongPrior = await fetchDalalStreet13f({ ...manual, holdings: [manual.holdings[0], { ...manual.holdings[1], prevShares: 6 }] }, { fetchImpl });
  assert.match(wrongPrior.manualFallbackCheck.mismatches.join('; '), /prior-quarter shares 6 != 5/);
  const wrongAccession = await fetchDalalStreet13f({ ...manual, accession: '0001549575-26-000001' }, { fetchImpl });
  assert.match(wrongAccession.manualFallbackCheck.mismatches.join('; '), /accession 0001549575-26-000001 != 0001549575-26-000015/);
});

test('an SEC amendment stops automatic publication for explicit review', () => {
  assert.throws(() => selectCurrentAndPrevious13f([
    { form: '13F-HR/A', accession: 'a', reportDate: '2026-06-30' },
    { form: '13F-HR', accession: 'b', reportDate: '2026-06-30' },
    { form: '13F-HR', accession: 'c', reportDate: '2026-03-31' },
  ]), /manual amendment review is required/);
});

// ---------- Form N-PORT: the fund's own quarterly report held against the daily file ----------

const NPORT_ROWS = [
  { name: 'Warrior Met Coal Inc', cusip: '93627C101', isin: 'US93627C1018', ticker: 'HCC', balance: '254389.000000000000', valUsd: '20646211.240000000000', pctVal: '9.8561545877', assetCat: 'EC', country: 'US', curCd: 'USD' },
  { name: 'Alpha Metallurgical Resources Inc', cusip: '020764106', isin: 'US0207641061', ticker: 'AMR', balance: '48646.000000000000', valUsd: '8023671.240000000000', pctVal: '3.8303659293', assetCat: 'EC', country: 'US', curCd: 'USD' },
  { name: 'Danaos Corp', cusip: 'N/A', isin: 'MHY1968P1218', ticker: 'DAC', balance: '77116.000000000000', valUsd: '9436684.920000000000', pctVal: '4.5049149350', assetCat: 'EC', country: 'GR', curCd: 'USD' },
  { name: 'Sygnity SA', cusip: 'N/A', isin: 'PLCMPLD00016', ticker: 'SGN', balance: '65125.000000000000', valUsd: '1364200.650000000000', pctVal: '0.6512464848', assetCat: 'EC', country: 'PL', currency: 'PLN' },
  { name: 'Noble Corp PLC', cusip: 'N/A', isin: 'GB00BMXNWH07', ticker: 'NE', balance: '251237.000000000000', valUsd: '9371140.100000000000', pctVal: '4.4736249385', assetCat: 'EC', country: 'US', curCd: 'USD' },
  { name: 'First American Treasury Obligations Fund 01/01/2040', cusip: '31846V328', isin: 'US31846V3289', ticker: 'FXFXX', balance: '1429076.850000000000', valUsd: '1429076.850000000000', pctVal: '0.6822172934', assetCat: 'STIV', country: 'US', curCd: 'USD' },
];

function nportXml({ form = 'NPORT-P', seriesId = 'S000098509', seriesName = 'Pabrai Wagons ETF', reportDate = '2026-06-30', netAssets = '209475318.760000000000', rows = NPORT_ROWS } = {}) {
  return `<?xml version="1.0" encoding="UTF-8"?><edgarSubmission xmlns="http://www.sec.gov/edgar/nport">
  <headerData><submissionType>${form}</submissionType><filerInfo><filer><issuerCredentials><cik>0000811030</cik></issuerCredentials></filer><seriesClassInfo><seriesId>${seriesId}</seriesId><classId>C000268187</classId></seriesClassInfo></filerInfo></headerData>
  <formData>
    <genInfo><regName>Professionally Managed Portfolios</regName><regCik>0000811030</regCik><seriesName>${seriesName}</seriesName><seriesId>${seriesId}</seriesId><seriesLei>529900POM4SRHKR00746</seriesLei><repPdEnd>${reportDate}</repPdEnd><repPdDate>${reportDate}</repPdDate><isFinalFiling>N</isFinalFiling></genInfo>
    <fundInfo><totAssets>211265625.140000000000</totAssets><totLiabs>1790306.380000000000</totLiabs><netAssets>${netAssets}</netAssets></fundInfo>
    <invstOrSecs>${rows.map(row => `
      <invstOrSec>
        <name>${row.name}</name><lei>N/A</lei><title>${row.title || row.name}</title><cusip>${row.cusip}</cusip>
        <identifiers><isin value="${row.isin}"/><ticker value="${row.ticker}"/><other otherDesc="Internal" value="X-${row.ticker}"/></identifiers>
        <balance>${row.balance}</balance><units>NS</units>${row.curCd ? `<curCd>${row.curCd}</curCd>` : `<currencyConditional curCd="${row.currency}" exchangeRt="40.5"/>`}
        <valUSD>${row.valUsd}</valUSD><pctVal>${row.pctVal}</pctVal><payoffProfile>Long</payoffProfile><assetCat>${row.assetCat}</assetCat><issuerCat>${row.assetCat === 'STIV' ? 'RF' : 'CORP'}</issuerCat><invCountry>${row.country}</invCountry>
      </invstOrSec>`).join('')}
    </invstOrSecs>
  </formData>
</edgarSubmission>`;
}

// The FilePoint file dated 2026-07-01 is priced as of 2026-06-30: its
// NetAssets is the 30 Jun NAV (16.11) x its 13,000,000 units to the cent. Its
// CUSIP column carries a SEDOL for the Polish name and a CINS for Danaos.
const NAV_HISTORY = [
  { date: '2026-06-29', nav: 16.05, price: 16.07, premium: 0.12 },
  { date: '2026-06-30', nav: 16.11, price: 16.14, premium: 0.19, netAssets: 209475318.76, sharesOut: 13000000 },
  { date: '2026-07-01', nav: 16.20, price: 16.22, premium: 0.12 },
];
function nportSnapshot(date = '2026-07-01', { netAssets = 209430000, sharesOutstanding = 13000000 } = {}) {
  return {
    date, netAssets, sharesOutstanding,
    rows: {
      HCC: { cusip: '93627C101', shares: 254389, name: 'Warrior Met Coal Inc' },
      AMR: { cusip: '020764106', shares: 62041, name: 'Alpha Metallurgical Resources Inc' },
      DAC: { cusip: 'Y1968P121', shares: 77116, name: 'Danaos Corp' },
      'SGN PW': { cusip: '5096747', shares: 65125, name: 'Sygnity SA' },
      'ODL NO': { cusip: 'BDX87W2', shares: 205316, name: 'Odfjell Drilling Ltd' },
      FXFXX: { cusip: '31846V328', shares: 1500000, name: 'First American Treasury Obligations Fund 01/01/2040' },
    },
    cash: { USD: 1000 },
  };
}

test('N-PORT primary document parser reads the series, period, net assets and every identifier', () => {
  const parsed = parseNportPrimary(nportXml());
  assert.equal(parsed.form, 'NPORT-P');
  assert.equal(parsed.isAmendment, false);
  assert.equal(parsed.cik, '0000811030');
  assert.equal(parsed.registrantName, 'Professionally Managed Portfolios');
  assert.equal(parsed.seriesId, 'S000098509');
  assert.equal(parsed.seriesName, 'Pabrai Wagons ETF');
  assert.equal(parsed.repPdDate, '2026-06-30');
  assert.equal(parsed.repPdEnd, '2026-06-30');
  assert.equal(parsed.netAssets, 209475318.76);
  assert.equal(parsed.totAssets, 211265625.14);
  assert.equal(parsed.holdings.length, 6);
  const hcc = parsed.holdings[0];
  assert.deepEqual([hcc.name, hcc.cusip, hcc.isin, hcc.ticker, hcc.balance, hcc.units, hcc.curCd, hcc.valUsd, hcc.assetCat, hcc.invCountry, hcc.cashLike],
    ['Warrior Met Coal Inc', '93627C101', 'US93627C1018', 'HCC', 254389, 'NS', 'USD', 20646211.24, 'EC', 'US', false]);
  assert.deepEqual(hcc.otherIds, [{ desc: 'Internal', value: 'X-HCC' }]);
  const sygnity = parsed.holdings.find(row => row.ticker === 'SGN');
  assert.equal(sygnity.cusip, null, '"N/A" is not a CUSIP');
  assert.equal(sygnity.isin, 'PLCMPLD00016');
  assert.equal(sygnity.curCd, 'PLN', 'a non-USD position reports its currency as an attribute');
  const moneyMarket = parsed.holdings.find(row => row.ticker === 'FXFXX');
  assert.equal(moneyMarket.cashLike, true, 'STIV rows are cash-like');
  assert.equal(parseNportPrimary(nportXml({ form: 'NPORT-P/A' })).isAmendment, true);
  assert.throws(() => parseNportPrimary(primaryXml({ date: '06-30-2026', entries: 1, total: 1 })), /not a Form N-PORT/);
  assert.throws(() => parseNportPrimary(nportXml().replace('<netAssets>209475318.760000000000</netAssets>', '')), /missing netAssets/);
});

test('cash-like is decided by asset category, a money-market name or a configured ticker, never by the word Cash in an issuer name', () => {
  const rows = [
    ...NPORT_ROWS,
    { name: 'Cash Converters International', title: 'Cash Converters International Ltd', cusip: 'N/A', isin: 'AU000000CCV6', ticker: 'CCV', balance: '1000.000000000000', valUsd: '250.000000000000', pctVal: '0.0001', assetCat: 'EC', country: 'AU', currency: 'AUD' },
    { name: 'Some Money Market Fund', cusip: '999999999', isin: 'US9999999995', ticker: 'MMKT', balance: '1.000000000000', valUsd: '1.000000000000', pctVal: '0.0001', assetCat: 'EC', country: 'US', curCd: 'USD' },
    { name: 'Repo Counterparty', cusip: 'N/A', isin: 'US8888888884', ticker: 'REPO', balance: '1.000000000000', valUsd: '1.000000000000', pctVal: '0.0001', assetCat: 'RA', country: 'US', curCd: 'USD' },
  ];
  const parsed = parseNportPrimary(nportXml({ rows }));
  const byTicker = Object.fromEntries(parsed.holdings.map(row => [row.ticker, row.cashLike]));
  assert.equal(byTicker.CCV, false, 'an equity issuer named Cash Converters is not cash-like');
  assert.equal(byTicker.FXFXX, true, 'STIV');
  assert.equal(byTicker.REPO, true, 'RA');
  assert.equal(byTicker.MMKT, true, 'a money-market-fund name');
  assert.equal(byTicker.HCC, false);
  // a ticker the configuration lists as cash-like
  const configured = parseNportPrimary(nportXml({ rows }), { cashLike: ['CCV'] });
  assert.equal(configured.holdings.find(row => row.ticker === 'CCV').cashLike, true);
  const comparison = compareNportWithSnapshot(parsed, nportSnapshot(), { cashLike: ['FXFXX'] });
  assert.equal(comparison.onlyInNport.some(row => row.ticker === 'CCV'), true, 'the equity is compared, not set aside');
  assert.match(comparison.cashLikeRule, /STIV or RA/);
});

test('N-PORT names come from the untruncated <title> when it extends the 30-character <name>, and pairing uses that full name', () => {
  const rows = [
    ...NPORT_ROWS,
    // the archive's 30-character cut falls inside the second word: the first two words of <name> would never match the file
    { name: 'Internationalconglomerate Hold', title: 'Internationalconglomerate Holdings Ltd', cusip: 'N/A', isin: 'TRERGYO00019', ticker: 'ICH', balance: '500.000000000000', valUsd: '5000.000000000000', pctVal: '0.0024', assetCat: 'EC', country: 'TR', currency: 'TRY' },
    // a security title that is not the issuer name leaves the name alone
    { name: 'Example Corp', title: '5.25% Notes due 2030', cusip: 'N/A', isin: 'XS0000000001', ticker: 'EXNOTE', balance: '100.000000000000', valUsd: '100.000000000000', pctVal: '0.0001', assetCat: 'DBT', country: 'US', curCd: 'USD' },
  ];
  const parsed = parseNportPrimary(nportXml({ rows }));
  const ich = parsed.holdings.find(row => row.ticker === 'ICH');
  assert.equal(ich.name, 'Internationalconglomerate Hold', 'the raw <name> is kept');
  assert.equal(ich.fullName, 'Internationalconglomerate Holdings Ltd');
  assert.equal(parsed.holdings.find(row => row.ticker === 'EXNOTE').fullName, 'Example Corp');
  const snapshot = nportSnapshot();
  snapshot.rows['ICH TI'] = { cusip: 'B3VKHD1', shares: 500, name: 'Internationalconglomerate Holdings Ltd' };
  const result = compareNportWithSnapshot(parsed, snapshot, { cashLike: ['FXFXX'] });
  const pair = result.matched.find(row => row.fundTicker === 'ICH TI');
  assert.ok(pair, 'paired by the full issuer name');
  assert.equal(pair.method, 'name');
  assert.equal(pair.methodLabel, 'issuer name (first two words)');
  assert.equal(pair.name, 'Internationalconglomerate Holdings Ltd');
  assert.equal(pair.secName, 'Internationalconglomerate Hold');
  assert.deepEqual(result.methodLabels, { cusip: 'CUSIP', isin: 'ISIN national number', name: 'issuer name (first two words)' });
});

test('N-PORT filings are selected newest report date first, amendment before original, by document basename', () => {
  const submissions = {
    cik: '811030',
    filings: { recent: {
      form: ['NPORT-P', '10-K', 'NPORT-P/A', 'NPORT-P', 'NPORT-P'],
      accessionNumber: ['0001193125-26-000001', '0001193125-26-000002', '0001193125-26-000003', '0001193125-26-000004', '0001193125-26-000005'],
      filingDate: ['2026-08-27', '2026-08-25', '2026-08-24', '2026-08-21', '2026-07-27'],
      acceptanceDateTime: ['2026-08-27T20:57:25.000Z', '2026-08-25T10:00:00.000Z', '2026-08-24T15:00:00.000Z', '2026-08-21T16:00:00.000Z', '2026-07-27T16:00:00.000Z'],
      reportDate: ['2026-06-30', '2026-06-30', '2026-06-30', '2026-06-30', '2026-05-31'],
      primaryDocument: ['xslFormNPORT-P_X01/primary_doc.xml', 'form10k.htm', 'xslFormNPORT-P_X01/primary_doc.xml', 'primary_doc.xml', 'xslFormNPORT-P_X01/primary_doc.xml'],
    } },
  };
  const filings = selectNportFilings(submissions, '0000811030');
  assert.deepEqual(filings.map(filing => [filing.accession, filing.form, filing.reportDate, filing.primaryDocument]), [
    ['0001193125-26-000003', 'NPORT-P/A', '2026-06-30', 'primary_doc.xml'],
    ['0001193125-26-000001', 'NPORT-P', '2026-06-30', 'primary_doc.xml'],
    ['0001193125-26-000004', 'NPORT-P', '2026-06-30', 'primary_doc.xml'],
    ['0001193125-26-000005', 'NPORT-P', '2026-05-31', 'primary_doc.xml'],
  ]);
  assert.throws(() => selectNportFilings(submissions, '0001549575'), /does not match/);
  assert.equal(isQuarterEndDate('2026-06-30'), true);
  assert.equal(isQuarterEndDate('2026-05-31'), false);
  assert.equal(isQuarterEndDate('2026-06-29'), false);
  assert.equal(isQuarterEndDate('2026-12-31'), true);
  // The third-month report is public on EDGAR when it is filed; 60 days after the quarter end is the filing deadline,
  // and a deadline on a weekend or federal holiday rolls to the next business day (Rule 0-3).
  const q3 = nextNportOpportunity('2026-06-30', { observedLagDays: 52 });
  assert.deepEqual([q3.reportDate, q3.dueDate, q3.filingDeadline, q3.deadlineRolled, q3.publicWhenFiled, q3.holidaysModelled, q3.snapshotDate],
    ['2026-09-30', '2026-11-29', '2026-11-30', true, true, true, '2026-10-01'], '29 Nov 2026 is a Sunday');
  assert.equal(q3.deadlineRolledReason, 'a Sunday');
  assert.match(q3.note, /public on EDGAR as soon as the trust files it, which must be no later than 60 days after that quarter end: 29 Nov 2026, which is a Sunday, so by 30 Nov 2026/);
  assert.match(q3.note, /filed 52 days after its period end.*probably appear before the deadline/);
  assert.doesNotMatch(q3.note, /releases it|makes it public 60 days/, 'no sentence may claim SEC withholds the report');
  assert.equal(nextNportOpportunity('2026-06-30').observedLagDays, null, 'no lag claim without a measured one');
  assert.match(q3.snapshotDateNote, /normally the FilePoint file dated 1 Oct 2026, the next NYSE trading day, .* proving its NetAssets per unit against the official NAV of 30 Sept 2026/);
  const q1 = nextNportOpportunity('2026-12-31');
  assert.deepEqual([q1.reportDate, q1.dueDate, q1.filingDeadline, q1.snapshotDate], ['2027-03-31', '2027-05-30', '2027-06-01', '2027-04-01'], '30 May 2027 is a Sunday and 31 May is Memorial Day');
  const q2 = nextNportOpportunity('2026-03-31');
  assert.deepEqual([q2.dueDate, q2.filingDeadline], ['2026-08-29', '2026-08-31'], '29 Aug 2026 is a Saturday');
  const q4 = nextNportOpportunity('2026-09-30');
  assert.deepEqual([q4.reportDate, q4.dueDate, q4.filingDeadline, q4.deadlineRolled], ['2026-12-31', '2027-03-01', '2027-03-01', false], 'a weekday 60th day is left alone');
  assert.equal(q4.deadlineRolledReason, null);
});

test('N-PORT comparison pairs by CUSIP, then ISIN national number, then issuer name, and sets cash aside', () => {
  const parsed = parseNportPrimary(nportXml());
  const snapshots = [nportSnapshot('2026-08-20'), nportSnapshot('2026-07-01')];
  const { expectedDate, snapshot, selection } = selectSnapshotForNport(snapshots, '2026-06-30', { navHistory: NAV_HISTORY });
  assert.equal(expectedDate, '2026-07-01', 'the file dated the next NYSE trading day is normally the one priced as of the report date');
  assert.equal(snapshot.date, '2026-07-01');
  assert.equal(selection.rule, 'nav-reconciled', 'chosen by proof against the NAV of the report date, not by its date');
  assert.deepEqual(selection.pricingDateProof, { navDate: '2026-06-30', nav: 16.11, mode: 'exact', perUnit: 16.11, fundShares: 13000000, navFileShares: 13000000, unitChange: 0, fileDate: '2026-07-01' });
  // without a NAV for the report date the next-weekday file is used but flagged as unproven
  const unproven = selectSnapshotForNport(snapshots, '2026-06-30');
  assert.equal(unproven.snapshot.date, '2026-07-01');
  assert.equal(unproven.selection.rule, 'unproven');
  assert.equal(unproven.selection.pricingDateProof, null);
  const result = compareNportWithSnapshot(parsed, snapshot, { cashLike: ['FXFXX'], selection });
  assert.equal(result.comparable, true);
  assert.equal(result.snapshotDate, '2026-07-01');
  assert.equal(result.snapshotSelection.rule, 'nav-reconciled');
  assert.equal(result.pricingDateProof.navDate, '2026-06-30');
  // rows are ordered by N-PORT value, largest first
  assert.deepEqual(result.matched.map(row => [row.fundTicker, row.method, row.diff]), [
    ['HCC', 'cusip', 0],
    ['DAC', 'isin', 0],
    ['SGN PW', 'name', 0],
  ]);
  assert.deepEqual(result.mismatched.map(row => [row.fundTicker, row.method, row.nportShares, row.fileShares, row.diff]), [['AMR', 'cusip', 48646, 62041, 13395]]);
  assert.deepEqual(result.onlyInNport.map(row => [row.ticker, row.id]), [['NE', 'GB00BMXNWH07']], 'a GB ISIN carries a SEDOL the file does not use, and the name is absent from the file');
  assert.deepEqual(result.onlyInHoldings.map(row => row.fundTicker), ['ODL NO']);
  assert.deepEqual(result.cashLike.map(row => [row.fundTicker, row.method, Math.round(row.diff * 100) / 100]), [['FXFXX', 'cusip', 70923.15]], 'the money-market fund is listed, not counted');
  assert.deepEqual(result.summary, { positions: 5, filePositions: 5, matched: 3, mismatched: 1, onlyInNport: 1, onlyInHoldings: 1, cashLike: 1, byMethod: { cusip: 2, isin: 1, name: 1 } });
  // the file's NetAssets is the rounded NAV x units, the N-PORT's is the fund's own total: they differ, and the row says why
  assert.ok(Math.abs(result.netAssets.diffPct - (209475318.76 / 209430000 - 1) * 100) < 1e-9);
  assert.match(result.netAssets.fileNote, /rounded NAV x its unit count/);
  // an ambiguous name never pairs: two file rows share "SYGNITY SA"
  const ambiguous = nportSnapshot();
  ambiguous.rows['SGN2 PW'] = { cusip: '5096748', shares: 1, name: 'Sygnity SA (second line)' };
  assert.equal(compareNportWithSnapshot(parsed, ambiguous, { cashLike: ['FXFXX'] }).onlyInNport.some(row => row.ticker === 'SGN'), true);
  assert.equal(issuerNameKey('Topicus.com Inc'), 'TOPICUS COM');
  assert.equal(issuerNameKey('Constellation Software Inc/Canada'), 'CONSTELLATION SOFTWARE');
});

test('without a saved file priced as of the report date the N-PORT check says so and names the next opportunity', () => {
  const parsed = parseNportPrimary(nportXml());
  const { snapshot, selection } = selectSnapshotForNport([nportSnapshot('2026-08-20')], '2026-06-30', { navHistory: NAV_HISTORY });
  assert.equal(snapshot, null);
  assert.equal(selection.rule, null);
  assert.equal(selection.reason, 'no saved holdings file dated within four calendar days after 2026-06-30 has NetAssets per unit equal to the official NAV of 16.11 dated 2026-06-30 (no saved file is dated within those four days)');
  const result = compareNportWithSnapshot(parsed, snapshot, { cashLike: ['FXFXX'], selection });
  assert.equal(result.comparable, false);
  assert.equal(result.snapshotDate, '2026-07-01', 'the date a file would normally carry');
  assert.equal(result.reason, selection.reason);
  assert.equal(result.snapshotSelection.navDate, '2026-06-30');
  assert.deepEqual([result.matched, result.mismatched, result.onlyInNport, result.onlyInHoldings, result.cashLike], [[], [], [], [], []]);
  assert.equal(result.summary.positions, 5);
  const line = summarizeNportCheck({ ok: true, form: 'NPORT-P', filed: '2026-08-21', reportDate: '2026-06-30', comparison: result, nextOpportunity: nextNportOpportunity('2026-06-30') });
  assert.equal(line, 'N-PORT as of 2026-06-30 (NPORT-P, filed 2026-08-21): no saved holdings file dated within four calendar days after 2026-06-30 has NetAssets per unit equal to the official NAV of 16.11 dated 2026-06-30 (no saved file is dated within those four days), so no comparison yet; first check possible with the 2026-09-30 report (public on EDGAR when the trust files it, due by 2026-11-30 (the 60th day, 2026-11-29, is a Sunday)) against the first saved file priced as of 2026-09-30, normally the one dated 2026-10-01');
  assert.equal(summarizeNportCheck({ ok: false, fetchError: '403 Forbidden' }), 'SEC N-PORT unavailable (403 Forbidden)');
  // without any NAV history the old date rule is the fallback, and the reason says the pricing date could not be proven
  const dated = compareNportWithSnapshot(parsed, null, { cashLike: ['FXFXX'], selection: selectSnapshotForNport([nportSnapshot('2026-08-20')], '2026-06-30').selection });
  assert.equal(dated.reason, 'no saved holdings file dated 2026-07-01, the next NYSE trading day after 2026-06-30, and no official NAV dated 2026-06-30 was available to prove another file\'s pricing date (no saved file is dated within those four days)');
});

test('the file for an N-PORT is chosen by its NAV-proven pricing date, so a market holiday or a missed capture cannot mislead', () => {
  // 31 Dec 2026 report: 1 Jan 2027 is a holiday, the first file is dated Monday 4 Jan 2027 and priced as of 31 Dec
  const holiday = selectSnapshotForNport([nportSnapshot('2027-01-04', { netAssets: 16.50 * 13000000 })], '2026-12-31', { navHistory: [{ date: '2026-12-31', nav: 16.50 }, { date: '2027-01-04', nav: 16.62 }] });
  assert.equal(holiday.expectedDate, '2027-01-04', 'the date rule skips the 1 Jan closure; the proof still decides');
  assert.equal(holiday.snapshot.date, '2027-01-04');
  assert.equal(holiday.selection.rule, 'nav-reconciled');
  assert.equal(holiday.selection.pricingDateProof.navDate, '2026-12-31');
  assert.equal(holiday.selection.pricingDateProof.perUnit, 16.5);
  // 30 Sep 2026 report: the 1 Oct file was never captured; the 2 Oct file is priced as of 1 Oct and must not be used
  const missed = selectSnapshotForNport([nportSnapshot('2026-10-02', { netAssets: 16.25 * 13000000 })], '2026-09-30', { navHistory: [{ date: '2026-09-30', nav: 16.20 }, { date: '2026-10-01', nav: 16.25 }] });
  assert.equal(missed.snapshot, null);
  assert.match(missed.selection.reason, /^no saved holdings file dated within four calendar days after 2026-09-30 has NetAssets per unit equal to the official NAV of 16\.20 dated 2026-09-30 \(tried: 2026-10-02 at 16\.2500 per unit, /);
  assert.deepEqual(missed.selection.candidates.map(c => [c.date, c.matched]), [['2026-10-02', false]]);
  // a creation settled between the NAV file and the holdings file still proves the date per unit
  const perShare = selectSnapshotForNport([nportSnapshot('2026-10-01', { netAssets: 16.20 * 13250000, sharesOutstanding: 13250000 })], '2026-09-30', { navHistory: [{ date: '2026-09-30', nav: 16.20, sharesOut: 13000000 }] });
  assert.equal(perShare.selection.rule, 'nav-reconciled');
  assert.equal(perShare.selection.pricingDateProof.mode, 'per-share');
  assert.equal(perShare.selection.pricingDateProof.unitChange, 250000);
  // a legacy receipt without a unit count cannot be proven even with a NAV
  const legacy = selectSnapshotForNport([{ date: '2026-07-01', netAssets: 209430000, rows: { HCC: { shares: 1 } } }], '2026-06-30', { navHistory: NAV_HISTORY });
  assert.equal(legacy.snapshot, null);
  assert.match(legacy.selection.reason, /tried: 2026-07-01 without a unit count/);
});

test('the trust\'s N-CSR and N-CSRS shareholder reports for the series are read from the submissions index', () => {
  // SEC EDGAR, CIK 0000811030, as listed on 4 Sep 2026 (plus other series' reports and an N-PX, which must be ignored)
  const submissions = {
    cik: '0000811030', name: 'PROFESSIONALLY MANAGED PORTFOLIOS',
    filings: { recent: {
      form: ['N-CSR', 'N-CSR', 'N-PX', 'N-CSRS', 'N-CSR', 'N-CSRS', 'N-CSR'],
      accessionNumber: ['0001133228-26-012211', '0001133228-26-012210', '0001549575-26-000020', '0001133228-26-003326', '0001133228-25-009634', '0001133228-25-002338', '0001133228-24-008836'],
      filingDate: ['2026-09-03', '2026-09-03', '2026-08-28', '2026-03-09', '2025-09-09', '2025-03-07', '2024-09-06'],
      acceptanceDateTime: ['2026-09-03T19:56:52.000Z', '2026-09-03T19:50:00.000Z', '2026-08-28T12:00:00.000Z', '2026-03-09T18:29:40.000Z', '2025-09-08T21:53:05.000Z', '2025-03-07T21:37:25.000Z', '2024-09-06T19:47:55.000Z'],
      reportDate: ['2026-06-30', '2026-06-30', '2026-06-30', '2025-12-31', '2025-06-30', '2024-12-31', '2024-06-30'],
      primaryDocument: ['pweft-efp26982_ncsr.htm', 'other-efp26981_ncsr.htm', 'primary_doc.xml', 'pwf-efp22329_ncsrs.htm', 'towf-efp16872_ncsr.htm', 'psfs-efp14037_ncsrs.htm', 'pa-efp8814_ncsr.htm'],
      primaryDocDescription: ['PABRAI WAGONS ETF - N-CSR', 'SOME OTHER FUND - N-CSR', 'PABRAI WAGONS ETF PROXY VOTING', 'PABRAI WAGONS FUND - N-CSRS', 'PABRAI WAGONS FUND - N-CSR', 'PABRAI WAGONS FUND - N-CSRS', 'PABRAI 6.30.24 ANNUAL - N-CSR'],
    } },
  };
  const reports = selectShareholderReports(submissions, { asOf: '2026-09-04' });
  assert.equal(reports.ok, true);
  assert.deepEqual(reports.annual, {
    form: 'N-CSR', isAmendment: false, filed: '2026-09-03', accepted: '2026-09-03T19:56:52.000Z', accession: '0001133228-26-012211', reportDate: '2026-06-30',
    primaryDocument: 'pweft-efp26982_ncsr.htm', description: 'PABRAI WAGONS ETF - N-CSR',
    sourceUrl: 'https://www.sec.gov/Archives/edgar/data/811030/000113322826012211/pweft-efp26982_ncsr.htm',
    indexUrl: 'https://www.sec.gov/Archives/edgar/data/811030/000113322826012211/0001133228-26-012211-index.html',
  });
  assert.equal(reports.semiAnnual.accession, '0001133228-26-003326');
  assert.equal(reports.semiAnnual.reportDate, '2025-12-31');
  assert.deepEqual(reports.reports.map(r => r.accession), ['0001133228-26-012211', '0001133228-26-003326', '0001133228-25-009634', '0001133228-25-002338', '0001133228-24-008836'], 'other series and the N-PX are ignored');
  assert.equal(reports.fiscalYearEnd, '06-30');
  assert.equal(reports.semiAnnualPeriodEnd, '12-31');
  assert.equal(reports.annualDueWithinDays, 70);
  assert.deepEqual([reports.nextAnnualPeriodEnd, reports.nextAnnualDue, reports.nextSemiAnnualPeriodEnd, reports.nextSemiAnnualDue], ['2027-06-30', '2027-09-08', '2026-12-31', '2027-03-11']);
  assert.equal(reports.holidaysModelled, true, "the due dates roll past weekends and federal holidays");
  assert.match(reports.indexScope, /^the 7 newest filings of the trust/);
  // without any report yet, the due date is for the newest period that has ended
  const none = selectShareholderReports({ cik: '811030', filings: { recent: { form: ['10-K'], accessionNumber: ['x'], filingDate: ['2026-01-01'], reportDate: ['2025-12-31'], primaryDocument: ['a.htm'], primaryDocDescription: ['X'] } } }, { asOf: '2026-09-04' });
  assert.equal(none.annual, null);
  assert.deepEqual([none.nextAnnualPeriodEnd, none.nextAnnualDue], ['2026-06-30', '2026-09-08']);
});

function nportSubmissions() {
  return {
    cik: '0000811030', name: 'PROFESSIONALLY MANAGED PORTFOLIOS',
    filings: { recent: {
      form: ['N-CSR', 'NPORT-P', 'NPORT-P/A', 'NPORT-P', 'NPORT-P', 'NPORT-P'],
      accessionNumber: ['0001133228-26-012211', '0001193125-26-000010', '0001193125-26-000012', '0001193125-26-000011', '0001193125-26-000009', '0001193125-26-000008'],
      filingDate: ['2026-09-03', '2026-07-27', '2026-08-28', '2026-08-27', '2026-08-21', '2026-05-28'],
      acceptanceDateTime: ['2026-09-03T19:56:52.000Z', '2026-07-27T16:00:00.000Z', '2026-08-28T16:00:00.000Z', '2026-08-27T20:57:25.000Z', '2026-08-21T16:00:00.000Z', '2026-05-28T16:00:00.000Z'],
      reportDate: ['2026-06-30', '2026-05-31', '2026-06-30', '2026-06-30', '2026-06-30', '2026-03-31'],
      primaryDocument: ['pweft-efp26982_ncsr.htm', 'xslFormNPORT-P_X01/primary_doc.xml', 'xslFormNPORT-P_X01/primary_doc.xml', 'xslFormNPORT-P_X01/primary_doc.xml', 'xslFormNPORT-P_X01/primary_doc.xml', 'xslFormNPORT-P_X01/primary_doc.xml'],
      primaryDocDescription: ['PABRAI WAGONS ETF - N-CSR', '', '', '', '', ''],
    } },
  };
}

test('the newest public Pabrai N-PORT is found among the trust filings, preferring an amendment, with provenance', async () => {
  const archive = 'https://www.sec.gov/Archives/edgar/data/811030';
  const bodies = new Map([
    ['https://data.sec.gov/submissions/CIK0000811030.json', JSON.stringify(nportSubmissions())],
    // an amended report of another series comes first in the walk
    [`${archive}/000119312526000012/primary_doc.xml`, nportXml({ form: 'NPORT-P/A', seriesId: 'S000036430', seriesName: 'Muzinich Dynamic Income Fund' })],
    [`${archive}/000119312526000011/primary_doc.xml`, nportXml({ seriesId: 'S000030908', seriesName: 'Boston Common ESG Impact U.S. Equity Fund' })],
    [`${archive}/000119312526000009/primary_doc.xml`, nportXml()],
    // the May report belongs to another series and must never be requested
    [`${archive}/000119312526000010/primary_doc.xml`, nportXml({ seriesId: 'S000099999', seriesName: 'Some Other Fund', reportDate: '2026-05-31' })],
  ]);
  const requested = [];
  const fetchImpl = async (url, init) => {
    requested.push(url);
    assert.ok(bodies.has(url), `unexpected URL ${url}`);
    assert.equal(init.headers['User-Agent'], DEFAULT_SEC_USER_AGENT);
    return response(bodies.get(url), 200, { etag: 'fixture' });
  };
  const config = { trustCik: '0000811030', seriesNameMatch: 'Pabrai Wagons', seriesId: 'S000098509' };
  const result = await fetchLatestPabraiNport(config, { fetchImpl, userAgent: DEFAULT_SEC_USER_AGENT, delayMs: 0, retryDelayMs: 0, snapshots: [nportSnapshot('2026-08-20')], cashLike: ['FXFXX'] });
  assert.equal(result.ok, true, result.fetchError);
  assert.equal(result.accession, '0001193125-26-000009');
  assert.equal(result.form, 'NPORT-P');
  assert.equal(result.filed, '2026-08-21');
  assert.equal(result.reportDate, '2026-06-30');
  assert.equal(result.seriesId, 'S000098509');
  assert.equal(result.seriesName, 'Pabrai Wagons ETF');
  assert.equal(result.seriesIdMatchesConfig, true);
  assert.equal(result.holdingCount, 6);
  assert.equal(result.sourceUrl, `${archive}/000119312526000009/0001193125-26-000009-index.html`);
  assert.deepEqual(result.opened.map(entry => entry.accession), ['0001193125-26-000012', '0001193125-26-000011', '0001193125-26-000009']);
  assert.ok(!requested.includes(`${archive}/000119312526000010/primary_doc.xml`), 'non-quarter-end reports are not opened');
  assert.match(result.provenance.submissions.sha256, /^[0-9a-f]{64}$/);
  assert.match(result.provenance.primary.sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.provenance.primary.url, `${archive}/000119312526000009/primary_doc.xml`);
  assert.equal(result.comparison.comparable, false);
  assert.deepEqual(result.snapshotRange, { first: '2026-08-20', last: '2026-08-20', count: 1 });
  assert.deepEqual([result.nextOpportunity.reportDate, result.nextOpportunity.dueDate, result.nextOpportunity.filingDeadline, result.nextOpportunity.snapshotDate], ['2026-09-30', '2026-11-29', '2026-11-30', '2026-10-01']);
  assert.equal(result.nextOpportunity.observedLagDays, 52, 'the displayed report was filed 52 days after its period end');
  assert.match(result.summary, /no saved holdings file dated 2026-07-01, the next NYSE trading day after 2026-06-30, and no official NAV dated 2026-06-30 was available/);
  assert.ok(!JSON.stringify(result).includes('<edgarSubmission'), 'the API result never carries raw XML');
  // what the check cost and how it identified itself, never the contact value
  assert.equal(result.documentsOpened, 3);
  assert.equal(result.provenance.documentsOpened, 3);
  assert.equal(result.provenance.requests, 4, 'the submissions index plus one request per document opened');
  assert.equal(result.secContact, 'default');
  assert.equal(result.candidateCount, 4);
  assert.equal(result.maxDocuments, 30);
  assert.match(result.sourceStatusText, /fetched from SEC EDGAR by this build/);
  assert.equal(result.holdings[0].name, 'Warrior Met Coal Inc');
  assert.equal(result.holdings[0].secName, 'Warrior Met Coal Inc');
  assert.match(result.cashLikeRule, /STIV or RA/);
  // the shareholder reports ride on the same index
  assert.equal(result.shareholderReports.ok, true);
  assert.equal(result.shareholderReports.annual.accession, '0001133228-26-012211');
  assert.equal(result.shareholderReports.annual.sourceUrl, 'https://www.sec.gov/Archives/edgar/data/811030/000113322826012211/pweft-efp26982_ncsr.htm');
  assert.equal(result.shareholderReports.semiAnnual, null);

  // an amendment of the fund's own report replaces the original for the period; with NAV history the file's pricing date is proven
  bodies.set(`${archive}/000119312526000012/primary_doc.xml`, nportXml({ form: 'NPORT-P/A' }));
  const amended = await fetchLatestPabraiNport(config, { fetchImpl, delayMs: 0, retryDelayMs: 0, snapshots: [nportSnapshot('2026-07-01')], cashLike: ['FXFXX'], navHistory: NAV_HISTORY });
  assert.equal(amended.ok, true, amended.fetchError);
  assert.equal(amended.accession, '0001193125-26-000012');
  assert.equal(amended.isAmendment, true);
  assert.equal(amended.form, 'NPORT-P/A');
  assert.equal(amended.comparison.comparable, true);
  assert.equal(amended.comparison.summary.matched, 3);
  assert.equal(amended.comparison.snapshotSelection.rule, 'nav-reconciled');
  assert.equal(amended.navHistoryDates, 3);
  assert.equal(amended.summary, 'N-PORT as of 2026-06-30 (NPORT-P/A, filed 2026-08-28) vs the FilePoint file dated 2026-07-01 (priced as of 2026-06-30: NetAssets per unit 16.11 equals that day\'s NAV): 3 of 5 positions match share counts; 1 differ, 1 only in N-PORT, 1 only in the file, 1 cash-like rows not counted');
  // without NAV history the same file is used under the date rule and labelled unproven
  const unproven = await fetchLatestPabraiNport(config, { fetchImpl, delayMs: 0, retryDelayMs: 0, snapshots: [nportSnapshot('2026-07-01')], cashLike: ['FXFXX'] });
  assert.equal(unproven.comparison.comparable, true);
  assert.equal(unproven.comparison.snapshotSelection.rule, 'unproven');
  assert.match(unproven.summary, /vs the FilePoint file dated 2026-07-01 \(pricing date not proven against a NAV\)/);
});

test('SEC refusing the N-PORT document is reported as unavailable, never thrown or presented as a finding', async () => {
  const submissionsUrl = 'https://data.sec.gov/submissions/CIK0000811030.json';
  let archiveRequests = 0;
  const fetchImpl = async url => {
    if (url === submissionsUrl) return response(JSON.stringify(nportSubmissions()), 200);
    archiveRequests++;
    return response('<html>Request Rate Threshold Exceeded</html>', 403);
  };
  const result = await fetchLatestPabraiNport({ trustCik: '0000811030', seriesNameMatch: 'Pabrai Wagons' }, { fetchImpl, delayMs: 0, retryDelayMs: 0, attempts: 3 });
  assert.equal(result.ok, false);
  assert.equal(result.sourceStatus, 'SEC N-PORT unavailable');
  assert.match(result.fetchError, /403/);
  assert.match(result.fetchError, /after 3 attempts/);
  assert.equal(archiveRequests, 3, 'the walk stops at the first document SEC refuses');
  assert.deepEqual(result.candidates.map(candidate => candidate.accession), ['0001193125-26-000012', '0001193125-26-000011', '0001193125-26-000009', '0001193125-26-000008']);
  assert.equal(result.candidateCount, 4, 'the uncapped number of quarter-end filings the index lists');
  assert.equal(result.maxDocuments, 30);
  assert.match(result.provenance.submissions.sha256, /^[0-9a-f]{64}$/);
  assert.equal(result.opened.length, 0);
  assert.equal(result.documentsOpened, 0);
  assert.equal(result.provenance.documentsOpened, 0);
  assert.equal(result.provenance.requests, 4, 'the index plus three refused attempts');
  assert.equal(result.secContact, 'default');
  // the shareholder reports need only the index, so they survive the refused document walk
  assert.equal(result.shareholderReports.ok, true);
  assert.equal(result.shareholderReports.annual.accession, '0001133228-26-012211');
  assert.equal(result.shareholderReports.annual.filed, '2026-09-03');
  // the submissions index itself being unreachable is the same labelled state, for the reports too
  const offline = await fetchLatestPabraiNport({}, { fetchImpl: async () => { throw new Error('ENOTFOUND'); }, delayMs: 0, retryDelayMs: 0 });
  assert.equal(offline.ok, false);
  assert.match(offline.fetchError, /SEC submissions index: no contact with data\.sec\.gov/);
  assert.equal(offline.shareholderReports.ok, false);
  assert.match(offline.shareholderReports.fetchError, /SEC submissions index/);
  assert.equal(offline.shareholderReports.annual, null);
  // a walk that never meets the series is also unavailable, with the counts opened, listed and capped
  const otherSeries = async url => url === submissionsUrl ? response(JSON.stringify(nportSubmissions()), 200) : response(nportXml({ seriesId: 'S000000001', seriesName: 'Another Fund' }), 200);
  const missing = await fetchLatestPabraiNport({ trustCik: '0000811030' }, { fetchImpl: otherSeries, delayMs: 0, retryDelayMs: 0, maxDocuments: 2 });
  assert.equal(missing.ok, false);
  assert.equal(missing.fetchError, `none of the 2 N-PORT primary documents opened (the newest of 4 quarter-end filings within the 6 newest filings of the trust in SEC's submissions index; walk limit 2) names a series containing "Pabrai Wagons"`);
  assert.equal(missing.candidates.length, 2);
  assert.equal(missing.candidateCount, 4);
  assert.equal(missing.documentsOpened, 2);
});
