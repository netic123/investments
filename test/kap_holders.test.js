'use strict';

// Pabrai's private funds on Borsa Istanbul (scripts/kap-holders.js): the KAP page parser, the Pabrai-row history and
// its change list, the build summary, and the wiring in server.js, build-pages.js, pages.yml and the page.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const kap = require('../scripts/kap-holders');

// The table as KAP embeds it: JSON inside a JavaScript string, every quote escaped once (the Gimat page, 6 Sep 2026).
const GMTAS_FRAGMENT = fs.readFileSync(path.join(__dirname, 'fixtures', 'kap-gmtas-fragment.txt'), 'utf8');

test('turkish numbers and dates', () => {
  assert.equal(kap.turkishNumber('360.090.525,84'), 360090525.84);
  assert.equal(kap.turkishNumber('2.000.000.000'), 2000000000);
  assert.equal(kap.turkishNumber('14,98'), 14.98);
  assert.equal(kap.turkishNumber(''), null);
  assert.equal(kap.kapDate('05/09/2026'), '2026-09-05');
  assert.equal(kap.kapDate('20/01/2026 16:02:49'), '2026-01-20', 'a stamp with a time keeps its date');
  assert.equal(kap.kapDate(null), null);
});

test('the >5 % table is read from the escaped page data, with the total, the paid-in capital, the date KAP stamps on it and the nominal value per share', () => {
  const parsed = kap.parseKapHolders(GMTAS_FRAGMENT, { etfShares: 16569895.878795 });
  assert.equal(parsed.tableDate, '2026-08-28');
  assert.equal(parsed.totalShares, 300000000);
  assert.equal(parsed.paidInCapital, 300000000);
  assert.equal(parsed.nominalValuePerShare, 1, 'KAP’s share-group table states 1 TL per share');
  assert.deepEqual(parsed.rows.map(r => [r.holder, r.shares, r.pct, r.pabrai, r.etf, r.other, r.total]), [
    ['THE PABRAI INVESTMENT FUND IVL.P.', 35226425, 11.74, true, false, false, false],
    ['THE PABRAI INVESTMENT FUND IIL.P.', 25684239, 8.56, true, false, false, false],
    ['PABRAI WAGONS FUND', 16569895.88, 5.52, true, true, false, false],
    ['DİĞER', 222519440.12, 74.18, false, false, true, false],
    ['TOPLAM', 300000000, 100, false, false, false, true],
  ]);
  const s = kap.pabraiSummary(parsed);
  assert.equal(s.privateRows.length, 2);
  assert.equal(s.etfRow.holder, 'PABRAI WAGONS FUND', 'the ETF under its former name is the ETF row');
  assert.ok(Math.abs(s.privatePct - 20.3) < 1e-9);
  assert.equal(s.privateShares, 60910664);
  // the ETF row is recognised by its share count too, when its name were to change
  const renamed = kap.parseKapHolders(GMTAS_FRAGMENT.replace('PABRAI WAGONS FUND', 'PABRAI SOMETHING ELSE'), { etfShares: 16569895.878795 });
  assert.equal(renamed.rows.find(r => r.holder === 'PABRAI SOMETHING ELSE').etf, true);
  assert.equal(kap.parseKapHolders(GMTAS_FRAGMENT.replace('PABRAI WAGONS FUND', 'PABRAI SOMETHING ELSE')).rows.find(r => r.holder === 'PABRAI SOMETHING ELSE').etf, false, 'without the file count only the name says so');
  // the nominal value: a per-share column that repeats the group total (TAB Gida's page) is refused, so is a disagreement
  assert.equal(kap.parseKapHolders(GMTAS_FRAGMENT.replace('nominalValuePerShare\\":\\"1\\"', 'nominalValuePerShare\\":\\"300000000\\"')).nominalValuePerShare, null, 'malformed: the per-share value equals the group total');
  assert.equal(kap.parseKapHolders(GMTAS_FRAGMENT.replace('nominalValuePerShare\\":\\"1\\"', 'nominalValuePerShare\\":\\"0,50\\"')).nominalValuePerShare, 0.5);
  assert.equal(kap.parseKapHolders(GMTAS_FRAGMENT.replace('kpy41_acc5_sermayeyi_temsil_eden', 'kpy41_acc5_absent')).nominalValuePerShare, null, 'no share-group item: not confirmed');
  assert.throws(() => kap.parseKapHolders('<html>nothing here</html>'), /not found/);
  assert.throws(() => kap.parseKapHolders(GMTAS_FRAGMENT.split('11,74').join('91,74')), /sum to/, 'listed holders above 100 % of capital are refused');
});

test('the history keeps one observation per change in a Pabrai row, refuses a read not later than the last, and lists the changes by percentage', () => {
  const parsed = kap.parseKapHolders(GMTAS_FRAGMENT);
  const company = { ticker: 'GMTAS TI', code: 'GMTAS', ok: true, fetchedAt: '2026-09-06T12:00:00Z', ...parsed, ...kap.pabraiSummary(parsed) };
  let h = { source: kap.SOURCE, companies: {} };
  let r = kap.mergeObservation(h, company, '2026-09-06T12:00:00Z');
  assert.equal(r.added, true); h = r.history;
  assert.deepEqual(h.companies['GMTAS TI'][0].rows.map(x => [x.holder, x.shares, x.pct, x.etf]), [['THE PABRAI INVESTMENT FUND IVL.P.', 35226425, 11.74, false], ['THE PABRAI INVESTMENT FUND IIL.P.', 25684239, 8.56, false], ['PABRAI WAGONS FUND', 16569895.88, 5.52, true]]);
  assert.equal(h.companies['GMTAS TI'][0].tableDate, '2026-08-28');
  r = kap.mergeObservation(h, company, '2026-09-07T12:00:00Z');
  assert.equal(r.added, false, 'the same table again is not a new observation');
  assert.equal(r.history, h);
  const failed = kap.mergeObservation(h, { ticker: 'GMTAS TI', ok: false, fetchError: 'HTTP 500', rows: [] }, '2026-09-08T12:00:00Z');
  assert.equal(failed.added, false, 'a page that could not be read records nothing');
  const later = { ...company, rows: company.rows.map(x => x.holder === 'THE PABRAI INVESTMENT FUND IIL.P.' ? { ...x, shares: 20000000, pct: 6.67 } : x).filter(x => x.holder !== 'THE PABRAI INVESTMENT FUND IVL.P.'), tableDate: '2026-10-01' };
  // a stale copy of an earlier build's kap.json: a different table, but not read later than the recorded one
  const stale = kap.mergeObservation(h, later, '2026-09-06T09:00:00Z');
  assert.deepEqual([stale.added, stale.stale, stale.history], [false, true, h], 'a read not later than the last recorded one is refused');
  r = kap.mergeObservation(h, later, '2026-10-02T00:30:00Z');
  assert.equal(r.added, true);
  const changes = kap.changesOf(r.history.companies['GMTAS TI']);
  assert.deepEqual(changes.map(c => [c.holder, c.kind, c.sharesFrom, c.sharesTo, c.pctTo, c.seenAt, c.tableDate]).sort(), [
    ['THE PABRAI INVESTMENT FUND IIL.P.', 'down', 25684239, 20000000, 6.67, '2026-10-02T00:30:00Z', '2026-10-01'],
    ['THE PABRAI INVESTMENT FUND IVL.P.', 'no longer listed', 35226425, null, null, '2026-10-02T00:30:00Z', '2026-10-01'],
  ]);
  // the direction is the percentage's: a cancellation of other holders' shares lifts a fund's percentage with its
  // shares unchanged ("up"); a bonus issue doubles every holder's shares with the percentage unchanged ("capital change")
  const obs = (seenAt, rows) => ({ seenAt, tableDate: null, totalShares: 300000000, rows });
  const pif = { holder: 'THE PABRAI INVESTMENT FUND IIL.P.', shares: 25684239, pct: 8.56, votingPct: 8.56, etf: false };
  assert.deepEqual(kap.changesOf([obs('a', [pif]), obs('b', [{ ...pif, pct: 9.1, votingPct: 9.1 }])]).map(c => c.kind), ['up']);
  assert.deepEqual(kap.changesOf([obs('a', [pif]), obs('b', [{ ...pif, shares: pif.shares * 2 }])]).map(c => c.kind), ['capital change']);
  assert.deepEqual(kap.changesOf([obs('a', [pif]), obs('b', [{ ...pif, shares: pif.shares * 2, pct: 9.1 }])]).map(c => c.kind), ['up']);
  assert.deepEqual(kap.changesOf([]), []);
  // mergeCurrent over a published api/kap.json, and the build.json line
  const published = { fetchedAt: '2026-09-06T12:00:00Z', companies: [company, { ticker: 'RYSAS TI', code: 'RYSAS', ok: false, fetchError: 'HTTP 503', rows: [] }] };
  const m = kap.mergeCurrent({ source: kap.SOURCE, companies: {} }, published);
  assert.deepEqual([m.added, m.stale], [['GMTAS TI'], []]);
  assert.equal(kap.summarize(published), '1 of 2 KAP pages read; Pabrai rows: GMTAS 3; failed: RYSAS (HTTP 503)');
  assert.equal(kap.summarize(null), 'not fetched');
});

test('persistPublished writes the committed file only when a Pabrai row changed, and refuses a served file whose bytes do not match the published digest', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'investments-kap-'));
  try {
    const target = path.join(dir, 'kap-holders.json');
    const parsed = kap.parseKapHolders(GMTAS_FRAGMENT);
    const company = { ticker: 'GMTAS TI', ok: true, fetchedAt: '2026-09-06T12:00:00Z', ...parsed, ...kap.pabraiSummary(parsed) };
    const body = Buffer.from(`${JSON.stringify({ fetchedAt: '2026-09-06T12:00:00Z', companies: [company] })}\n`);
    const digest = crypto.createHash('sha256').update(body).digest('hex');
    const fetchImpl = async () => ({ ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) });
    const lines = [];
    const first = await kap.persistPublished({ url: 'https://example.invalid/kap.json', target, fetchImpl, expectedSha256: digest, log: l => lines.push(l) });
    assert.deepEqual(first, { written: true, added: ['GMTAS TI'], stale: [], sha256: digest });
    const text = fs.readFileSync(target, 'utf8');
    assert.ok(!text.includes('\r'), 'LF only');
    assert.equal(kap.readHistory(target).companies['GMTAS TI'].length, 1);
    const again = await kap.persistPublished({ url: 'https://example.invalid/kap.json', target, fetchImpl, expectedSha256: digest });
    assert.deepEqual(again, { written: false, added: [], stale: [], sha256: digest });
    assert.equal(fs.readFileSync(target, 'utf8'), text);
    await assert.rejects(kap.persistPublished({ url: 'https://example.invalid/kap.json', target, fetchImpl, expectedSha256: 'a'.repeat(64) }), /does not match the digest this build published/);
    assert.equal(fs.readFileSync(target, 'utf8'), text, 'nothing written on a mismatch');
    const unverified = await kap.persistPublished({ url: 'https://example.invalid/kap.json', target, fetchImpl, log: l => lines.push(l) });
    assert.equal(unverified.written, false);
    assert.ok(lines.some(l => /importing it unverified/.test(l)), 'without a digest the import says it is unverified');
    await assert.rejects(kap.persistPublished({ url: 'https://example.invalid/kap.json', target, fetchImpl: async () => ({ ok: false, status: 503 }) }), /HTTP 503/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('fetchCompany labels a failed page instead of throwing, and reads a good one', async () => {
  const bad = await kap.fetchCompany({ ticker: 'RYSAS TI', code: 'RYSAS', oid: 'x' }, { fetchImpl: async () => ({ ok: false, status: 503 }) });
  assert.equal(bad.ok, false); assert.match(bad.fetchError, /HTTP 503/); assert.deepEqual(bad.rows, []);
  const down = await kap.fetchCompany({ ticker: 'RYSAS TI', code: 'RYSAS', oid: 'x' }, { fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  assert.match(down.fetchError, /no contact with www\.kap\.org\.tr/);
  const good = await kap.fetchCompany({ ticker: 'GMTAS TI', code: 'GMTAS', oid: 'a3ff494df37b408aa9088106fe98f59e' }, { fetchImpl: async (url, init) => { assert.equal(url, 'https://www.kap.org.tr/en/sirket-bilgileri/genel/a3ff494df37b408aa9088106fe98f59e'); assert.match(init.headers['User-Agent'], /Investments/); return { ok: true, status: 200, text: async () => GMTAS_FRAGMENT }; } });
  assert.equal(good.ok, true); assert.equal(good.privateRows.length, 2); assert.equal(good.etfRow.pct, 5.52); assert.equal(good.nominalValuePerShare, 1); assert.equal(good.url.endsWith(good.oid), true);
});

test('the configuration names the five Turkish holdings with their KAP page ids, and the committed history covers them', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
  const companies = kap.configuredCompanies(config);
  assert.deepEqual(companies.map(c => c.ticker).sort(), ['GMTAS TI', 'RYGYO TI', 'RYSAS TI', 'TABGD TI', 'TAVHL TI']);
  for (const c of companies) assert.match(c.oid, /^[0-9a-f]{32}$/, c.ticker);
  assert.equal(config.sources.kapCompanyPage, kap.PAGE_BASE);
  const history = kap.readHistory();
  assert.equal(history.note, kap.HISTORY_NOTE);
  for (const c of companies) assert.ok(Array.isArray(history.companies[c.ticker]) && history.companies[c.ticker].length >= 1, `${c.ticker} recorded`);
  const rysas = history.companies['RYSAS TI'][0];
  assert.ok(rysas.rows.some(r => /PABRAI INVESTMENT FUND 3/.test(r.holder) && r.pct === 14.98), 'the first record carries PIF 3 at 14.98 % of Reysas');
  assert.ok(!fs.readFileSync(kap.DEFAULT_TARGET, 'utf8').includes('\r'), 'LF only');
});

test('server, build, workflow and page are wired for api/kap.json', () => {
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(server, /require\('\.\/scripts\/kap-holders'\)/);
  assert.match(server, /'\/api\/kap': \(\) => cached\('kap', getKap, v => v\.ok\)/);
  assert.match(server, /etfSharesOf: t => \(rows && rows\[t\]/, 'the ETF’s file share count reaches the parser');
  assert.match(server, /pending: true/, 'an observation only this build has read is flagged');
  const build = require('../scripts/build-pages');
  assert.ok(build.ENDPOINTS.includes('kap'));
  assert.ok(build.EXPECTED_FILES.includes('api/kap.json') && build.DIGESTED_FILES.includes('api/kap.json'));
  assert.match(fs.readFileSync(path.join(ROOT, 'scripts', 'build-pages.js'), 'utf8'), /kapCheck: summarizeKap\(data\.kap\)/);
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.match(yml, /node scripts\/kap-holders\.js --from-published "\$PUBLISHED_API\/kap\.json" --expect-sha256 "\$wantKap"/);
  assert.match(yml, /\['api\/kap\.json'\]/, 'the digest build.json names for api/kap.json is read in the wait loop');
  assert.match(yml, /git add data\/snapshots\.json data\/dalal13f-history\.json data\/kap-holders\.json/);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /const SNAPSHOT_FILES=\['config','holdings','nav','perf','quotes','dalal','nport','kap','marketfg'\];/);
  assert.match(html, /function renderKap\(K,H\)/);
  assert.match(html, /renderKap\(data\.kap\|\|null, data\.holdings\|\|null\)/);
  assert.match(html, /Pabrai’s private funds in Turkey/);
  assert.match(html, /none listed at 5 % or more/);
  assert.match(html, /lists each direct holder of 5 % or more of a company’s capital or votes/);
  assert.match(html, /a fund below 5 % is not listed, so a total is a floor/i);
  assert.match(html, /your browser does not contact KAP/);
  assert.match(html, /KAP’s own share-group table gives a nominal value of 1 TL per share for/);
  assert.match(html, /not yet in the committed record/);
  assert.match(html, /'Capital change'/);
  assert.doesNotMatch(html, /MKK/, 'no provenance the page has not seen');
  assert.match(fs.readFileSync(path.join(ROOT, 'README.txt'), 'utf8'), /kap-holders\.js/);
});
