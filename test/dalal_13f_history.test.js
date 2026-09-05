'use strict';

// Dalal Street's 13F history (scripts/dalal-13f-history.js, data/dalal13f-history.json): the text-era parser, the value
// unit, the latest-filing-per-quarter rule, the build-time append, and the committed file's shape.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const h = require('../scripts/dalal-13f-history');

test('the 2012-2013 text tables parse in both layouts: value before the shares, or on the wrapped line with a title tail', () => {
  const sameLine = 'BANK OF AMERICA CORPORATION     COM            060505104   71,794    7,502,000  SH        Sole        n/a      7,502,000\nPINNACLE AIRL CORP              COM            723443107    2,652    1,964,185  SH        Sole        n/a      1,964,185\n';
  const wrapped = 'GENERAL MTRS CO               *W EXP         37045V126          5,928,876 SH          SOLE             5,928,876\n                              07/10/201                69,901.45\nGOLDMAN SACHS GROUP INC       COM            38141g104            141,863 SH          SOLE               141,863\n                                                       20,875.14\n';
  assert.deepEqual(h.parseText13f(sameLine).map(r => [r.issuer, r.title, r.cusip, r.shares, r.valueThousands]), [['BANK OF AMERICA CORPORATION', 'COM', '060505104', 7502000, 71794], ['PINNACLE AIRL CORP', 'COM', '723443107', 1964185, 2652]]);
  const w = h.parseText13f(wrapped);
  assert.deepEqual(w.map(r => [r.issuer, r.title, r.cusip, r.shares, r.valueThousands]), [['GENERAL MTRS CO', '*W EXP 07/10/201', '37045V126', 5928876, 69901.45], ['GOLDMAN SACHS GROUP INC', 'COM', '38141G104', 141863, 20875.14]]);
  assert.throws(() => h.parseText13f('nothing here'), /no information table rows/);
});

test('values are stored in dollars: thousands as filed before 3 Jan 2023, dollars from then on', () => {
  assert.equal(h.valueMultiplier('2022-11-14'), 1000);
  assert.equal(h.valueMultiplier('2023-01-03'), 1);
  assert.equal(h.valueMultiplier('2026-08-13'), 1);
  assert.equal(h.DOLLARS_FROM, '2023-01-03');
});

test('one filing per quarter, the latest (an amendment replaces the original)', () => {
  const filings = [
    { reportDate: '2012-12-31', form: '13F-HR', accession: 'a', filed: '2013-02-12', accepted: '2013-02-12T10:00:00.000Z' },
    { reportDate: '2012-12-31', form: '13F-HR/A', accession: 'b', filed: '2013-05-06', accepted: '2013-05-06T10:00:00.000Z' },
    { reportDate: '2013-03-31', form: '13F-HR', accession: 'c', filed: '2013-05-13', accepted: '2013-05-13T10:00:00.000Z' },
  ];
  assert.deepEqual(h.latestPerQuarter(filings).map(f => f.accession), ['b', 'c']);
});

test('the build appends the validated current filing when the history lacks it, and only then', () => {
  const history = { cik: '0001549575', managerName: 'Dalal Street, LLC', quarters: [{ reportDate: '2026-03-31', filed: '2026-05-14', accession: 'x', rows: [] }] };
  const dalal = { ok: true, asOf: '2026-06-30', filed: '2026-08-13', accession: 'y', form: '13F-HR', cik: '0001549575', portfolioValueUsd: 326749980, entryTotal: 4, sourceUrl: 'u', fetchedAt: '2026-09-05T20:00:00Z',
    holdings: [{ cusip: '93627C101', secIssuer: 'WARRIOR MET COAL INC', title: 'COM', shares: 1744050, valueUsd: 141547098 }, { cusip: 'OLD000000', secIssuer: 'GONE', title: 'COM', shares: 0, prevShares: 5, valueUsd: 0, exited: true }] };
  const merged = h.mergeCurrent(history, dalal);
  assert.deepEqual(merged.quarters.map(q => q.reportDate), ['2026-03-31', '2026-06-30']);
  const added = merged.quarters[1];
  assert.equal(added.accession, 'y');
  assert.equal(added.totalValueUsd, 326749980);
  assert.deepEqual(added.rows, [{ cusip: '93627C101', issuer: 'WARRIOR MET COAL INC', title: 'COM', putCall: null, shares: 1744050, valueUsd: 141547098 }], 'exited rows are not positions');
  assert.equal(added.appendedFromBuild, '2026-09-05T20:00:00Z');
  assert.equal(h.mergeCurrent(merged, dalal).quarters.length, 2, 'already present: unchanged');
  assert.equal(h.mergeCurrent(history, { ...dalal, ok: false }).quarters.length, 1, 'a fallback copy is never appended');
  assert.equal(h.mergeCurrent(history, { ...dalal, asOf: '2026-03-31', accession: 'older', filed: '2026-05-01' }).quarters[0].accession, 'x', 'an earlier filing never replaces a later one');
});

test('the committed history holds every quarter since Q1 2012 in order, one per quarter, values in dollars', () => {
  const file = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'dalal13f-history.json'), 'utf8'));
  assert.equal(file.cik, '0001549575');
  assert.ok(file.quarters.length >= 58, `${file.quarters.length} quarters`);
  assert.equal(file.quarters[0].reportDate, '2012-03-31');
  for (let i = 1; i < file.quarters.length; i++) assert.ok(file.quarters[i].reportDate > file.quarters[i - 1].reportDate, 'ascending, no duplicate quarter');
  for (const q of file.quarters) {
    assert.match(q.accession, /^\d{10}-\d{2}-\d{6}$/);
    assert.ok(q.rows.length >= 1 && q.rows.every(r => /^[0-9A-Z]{9}$/.test(r.cusip) && Number.isFinite(r.shares) && Number.isFinite(r.valueUsd)), q.reportDate);
    assert.ok(q.totalValueUsd > 1e7 && q.totalValueUsd < 1e10, `${q.reportDate} total ${q.totalValueUsd} is in dollars`);
    if (q.format === 'xml') assert.equal(q.rows.reduce((s, r) => s + r.valueUsd, 0), q.totalValueUsd, `${q.reportDate} rows sum to the filing's total`);
  }
  const last = file.quarters[file.quarters.length - 1];
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8')).dalalStreet;
  if (last.reportDate === config.asOf) assert.equal(last.totalValueUsd, config.portfolioValueUsd, 'the newest quarter agrees with the verified copy in the configuration');
  const padded = file.quarters.find(q => q.rows.some(r => r.cusipAsFiled));
  assert.ok(padded && padded.note, 'the short-CUSIP filing is flagged');
});

test('the page renders the quarterly changes and the positions table, and the record job persists a new quarter', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /function renderDalalHistory\(D\)/);
  assert.match(html, /<h2>Quarter by quarter since 2012<\/h2>/);
  assert.match(html, /id="tblDalalPositions"/);
  assert.match(html, /an appearance or disappearance can be a reporting change, not a trade/);
  const pagesYml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.match(pagesYml, /node scripts\/dalal-13f-history\.js --from-published/);
  assert.match(pagesYml, /git add data\/snapshots\.json data\/dalal13f-history\.json/);
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(server, /history: dalalHistory\(live\)/);
  assert.match(server, /history: dalalHistory\(null\)/);
});
