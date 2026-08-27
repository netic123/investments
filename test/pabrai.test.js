'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  diffWagnSnapshots,
  fetchDalalStreet13f,
  normalizeWagnHoldings,
  parseCsv,
  parseSecInformationTable,
  parseSecPrimary,
  selectWagnNavObservation,
  selectCurrentAndPrevious13f,
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
  assert.equal(change.expectedSharesTo, 110);
  assert.equal(change.signalDelta, 10);
  assert.equal(change.flowAdjusted, true);
  after.rows.NEW.shares = 110;
  assert.deepEqual(diffWagnSnapshots(before, after), [], 'a purely proportional creation flow is not a manager-change signal');
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
      primaryDocument: ['primary_doc.xml', 'primary_doc.xml'],
    } },
  };
  const bodies = new Map([
    ['https://data.sec.gov/submissions/CIK0001549575.json', JSON.stringify(submissions)],
    ['https://www.sec.gov/Archives/edgar/data/1549575/000154957526000015/primary_doc.xml', primaryXml({ date: '06-30-2026', entries: 1, total: 100 })],
    ['https://www.sec.gov/Archives/edgar/data/1549575/000154957526000015/infotable.xml', infoXml([{ issuer: 'ALPHA METALLURGICAL RESOUR I', cusip: '020764106', shares: 10, value: 100 }])],
    ['https://www.sec.gov/Archives/edgar/data/1549575/000154957526000009/primary_doc.xml', primaryXml({ date: '03-31-2026', entries: 1, total: 50 })],
    ['https://www.sec.gov/Archives/edgar/data/1549575/000154957526000009/infotable.xml', infoXml([{ issuer: 'ALPHA METALLURGICAL RESOUR I', cusip: '020764106', shares: 5, value: 50 }])],
  ]);
  const fetchImpl = async url => {
    assert.ok(bodies.has(url), `unexpected URL ${url}`);
    return response(bodies.get(url), 200, { etag: 'fixture' });
  };
  const result = await fetchDalalStreet13f({
    cik: '0001549575',
    managerName: 'Dalal Street, LLC',
    nextFilingWindow: 'by 16 Nov 2026',
    asOf: '2026-06-30',
    filed: '2026-08-13',
    portfolioValueUsd: 100,
    holdings: [{ ticker: 'AMR', name: 'Alpha Metallurgical', cusip: '020764106', shares: 10, prevShares: 5, valueUsd: 100 }],
  }, { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.accession, '0001549575-26-000015');
  assert.equal(result.previous.accession, '0001549575-26-000009');
  assert.equal(result.holdings[0].ticker, 'AMR');
  assert.equal(result.holdings[0].shares, 10);
  assert.equal(result.holdings[0].prevShares, 5);
  assert.equal(result.manualFallbackCheck.matches, true);
});

test('an SEC amendment stops automatic publication for explicit review', () => {
  assert.throws(() => selectCurrentAndPrevious13f([
    { form: '13F-HR/A', accession: 'a', reportDate: '2026-06-30' },
    { form: '13F-HR', accession: 'b', reportDate: '2026-06-30' },
    { form: '13F-HR', accession: 'c', reportDate: '2026-03-31' },
  ]), /manual amendment review is required/);
});
