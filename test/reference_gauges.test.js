'use strict';

// Independent readings next to the Fear & Greed scores (scripts/reference-gauges.js): the four parsers, the comparison
// with CNN, the Cboe record and its ranking, the digest-checked persistence, the build summary, and the wiring.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
const g = require('../scripts/reference-gauges');
const FX = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

test('CNN: the score, its time, the components and the dated history are read from the snapshot JSON', () => {
  const c = g.parseCnn(JSON.parse(FX('refs-cnn-graphdata.json')), { snapshotAt: '2026-09-06T16:38:48Z', snapshotUrl: 'https://web.archive.org/web/20260906163848/https://production.dataviz.cnn.io/index/fearandgreed/graphdata' });
  assert.ok(Math.abs(c.score - 41.857) < 0.001);
  assert.equal(c.rating, 'fear');
  assert.equal(c.date, '2026-09-04');
  assert.equal(c.timestamp, '2026-09-04T23:59:43.000Z');
  assert.ok(Math.abs(c.previousClose - 35.229) < 0.001);
  assert.equal(c.components.stock_price_strength.score, 12.6);
  assert.equal(c.components.junk_bond_demand.rating, 'extreme greed');
  assert.ok(c.history.length >= 5 && c.history.every(p => /^\d{4}-\d{2}-\d{2}$/.test(p.date)));
  assert.equal(c.history[c.history.length - 1].date, '2026-09-04', 'the last point carries the close’s own UTC date');
  assert.equal(g.waybackTimestampToIso('20260906163848'), '2026-09-06T16:38:48Z');
  assert.throws(() => g.parseCnn({}), /no fear_and_greed score/);
});

test('the comparison with CNN: correlation, mean gap (this site minus CNN), same-band and within-one-band shares over the days both have', () => {
  const cnn = [{ date: '2026-09-01', score: 40 }, { date: '2026-09-02', score: 45 }, { date: '2026-09-03', score: 50 }, { date: '2026-09-04', score: 42 }, { date: '2026-09-05', score: 42 }];
  const model = [{ date: '2026-09-01', score: 55 }, { date: '2026-09-02', score: 60 }, { date: '2026-09-03', score: 65 }, { date: '2026-09-04', score: 57 }, { date: '2026-08-31', score: 50 }];
  const cmp = g.compareSeries(cnn, model);
  assert.deepEqual([cmp.n, cmp.from, cmp.to], [4, '2026-09-01', '2026-09-04']);
  assert.ok(Math.abs(cmp.correlation - 1) < 1e-9, 'a constant offset correlates perfectly');
  assert.equal(cmp.meanGap, 15);
  assert.equal(cmp.sameBandPct, 0);
  assert.equal(cmp.withinOneBandPct, 75, '42 (fear) against 57 (greed) is two bands apart');
  assert.equal(cmp.sameBandShiftedPct, 100, 'shifted by its mean gap the model matches CNN band for band');
  assert.ok(Math.abs(cmp.meanAbsGapShifted) < 1e-9);
  assert.equal(g.compareSeries(cnn, []).n, 0);
  assert.deepEqual([g.bandOf(10), g.bandOf(44.9), g.bandOf(45), g.bandOf(56), g.bandOf(75), g.bandOf('x')], [0, 1, 2, 3, 4, -1]);
});

test('fetchCnn: the archive availability answer, a gzip-compressed snapshot, and a labelled failure', async () => {
  const body = zlib.gzipSync(Buffer.from(FX('refs-cnn-graphdata.json')));
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push(url);
    assert.match(init.headers['User-Agent'], /Investments/);
    if (url.startsWith('https://archive.org/wayback/available')) return { ok: true, status: 200, json: async () => ({ archived_snapshots: { closest: { status: '200', available: true, timestamp: '20260906163848', url: 'x' } } }) };
    if (/web\.archive\.org\/web\/20260906163848id_\//.test(url)) return { ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) };
    return { ok: false, status: 500 };
  };
  const model = [{ date: '2026-09-04', score: 56.4 }, { date: '2026-09-03', score: 55 }];
  const r = await g.fetchCnn({ fetchImpl, modelHistory: model });
  assert.equal(r.ok, true);
  assert.equal(r.snapshotAt, '2026-09-06T16:38:48Z');
  assert.equal(r.rating, 'fear');
  assert.ok(!('history' in r), 'the series is not published');
  assert.equal(r.historyPoints >= 5, true);
  assert.equal(r.comparison.n, 2);
  assert.match(r.snapshotUrl, /^https:\/\/web\.archive\.org\/web\/20260906163848\/https:\/\/production\.dataviz\.cnn\.io/);
  const none = await g.fetchCnn({ fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ archived_snapshots: {} }) }) });
  assert.equal(none.ok, false); assert.match(none.fetchError, /lists no snapshot/);
  const down = await g.fetchCnn({ fetchImpl: async () => { throw new Error('ECONNRESET'); } });
  assert.match(down.fetchError, /no contact with archive\.org/);
});

test('Cboe: the day file, the ranking against the record, the days a build adds, and a labelled failure', async () => {
  const day = g.parseCboeDaily(JSON.parse(FX('refs-cboe-2026-09-04.json')));
  assert.deepEqual(day, { t: 0.76, e: 0.58, i: 0.89 });
  assert.throws(() => g.parseCboeDaily({ ratios: [] }), /no TOTAL/);
  // a small record: 8 trading days, the last one high
  const days = { '2026-08-24': { t: 0.9, e: null, i: null }, '2026-08-25': { t: 0.8, e: null, i: null }, '2026-08-26': { t: 0.7, e: null, i: null }, '2026-08-27': { t: 1.0, e: null, i: null }, '2026-08-28': { t: 0.6, e: null, i: null }, '2026-08-31': { t: 0.85, e: null, i: null }, '2026-09-01': { t: 0.75, e: null, i: null }, '2026-09-02': { t: 1.2, e: null, i: null } };
  const st = g.cboeStats(days, '2026-09-02');
  assert.equal(st.latest.t, 1.2);
  assert.ok(Math.abs(st.fiveDay - (1.0 + 0.6 + 0.85 + 0.75 + 1.2) / 5) < 1e-9);
  assert.equal(st.pctBelowLatest, 87.5, 'seven of eight days had a lower ratio');
  assert.deepEqual([st.historyFrom, st.historyTo, st.historyDays], ['2026-08-24', '2026-09-02', 8]);
  assert.equal(g.cboeStats({ '2026-09-02': { t: 1 } }, '2026-09-02'), null, 'fewer than five days: no ranking');
  // a build on Monday 7 Sep 2026 fetches Thu 3 and Fri 4 Sep (Sat/Sun skipped; the Cboe answers 403 for a holiday)
  const asked = [];
  const fetchImpl = async url => { asked.push(url.slice(-24)); if (/2026-09-03_/.test(url)) return { ok: false, status: 403 }; if (/2026-09-04_/.test(url)) return { ok: true, status: 200, json: async () => JSON.parse(FX('refs-cboe-2026-09-04.json')) }; return { ok: false, status: 404 }; };
  const r = await g.fetchCboe({ fetchImpl, history: { days }, today: '2026-09-07' });
  assert.equal(r.ok, true);
  assert.deepEqual(asked, ['2026-09-03_daily_options', '2026-09-04_daily_options', '2026-09-07_daily_options']);
  assert.deepEqual(r.newDays, { '2026-09-04': { t: 0.76, e: 0.58, i: 0.89 } });
  assert.equal(r.latest.date, '2026-09-04');
  assert.equal(r.requests, 3);
  const merged = g.mergeCboeDays({ days }, r.newDays);
  assert.equal(merged.added, 1); assert.equal(Object.keys(merged.history.days).length, 9);
  assert.equal(g.mergeCboeDays({ days }, { 'bad': { t: 1 }, '2026-08-24': { t: 0.9 } }).added, 0, 'malformed keys are ignored; a known day is not double-counted');
  const down = await g.fetchCboe({ fetchImpl: async () => ({ ok: false, status: 500 }), history: { days }, today: '2026-09-07' });
  assert.equal(down.ok, false); assert.match(down.fetchError, /HTTP 500/);
});

test('OFR: the CSV, the latest row and its rank since 2000', () => {
  const o = g.parseOfrCsv(FX('refs-ofr-fsi.csv'));
  assert.equal(o.latest.date, '2026-09-02');
  assert.equal(o.latest.fsi, -2.768);
  assert.equal(o.latest.em, -0.547);
  assert.equal(o.historyFrom, '2000-01-03');
  assert.equal(o.days, 6);
  assert.ok(o.pctBelow >= 0 && o.pctBelow <= 100);
  assert.throws(() => g.parseOfrCsv('a,b\n1,2\n'), /unexpected header/);
});

test('alternative.me: the latest value, its day and the previous one', () => {
  const a = g.parseAltMe(JSON.parse(FX('refs-altme.json')));
  assert.deepEqual([a.value, a.classification, a.date], [73, 'Greed', '2026-09-06']);
  assert.equal(a.previous.date, '2026-09-05');
  assert.throws(() => g.parseAltMe({ data: [] }), /no data rows/);
});

test('referenceGauges labels each source, summarize describes the set, and persistPublished appends only digest-checked new days', async () => {
  const cboeJson = JSON.parse(FX('refs-cboe-2026-09-04.json')), cnnBody = Buffer.from(FX('refs-cnn-graphdata.json'));
  const fetchImpl = async url => {
    if (url.startsWith('https://archive.org/wayback/available')) return { ok: true, status: 200, json: async () => ({ archived_snapshots: { closest: { status: '200', available: true, timestamp: '20260906163848' } } }) };
    if (/web\.archive\.org/.test(url)) return { ok: true, status: 200, arrayBuffer: async () => cnnBody.buffer.slice(cnnBody.byteOffset, cnnBody.byteOffset + cnnBody.byteLength) };
    if (/cdn\.cboe\.com/.test(url)) return /2026-09-04_/.test(url) ? { ok: true, status: 200, json: async () => cboeJson } : { ok: false, status: 403 };
    if (/financialresearch\.gov/.test(url)) return { ok: false, status: 503 };
    if (/alternative\.me/.test(url)) return { ok: true, status: 200, json: async () => JSON.parse(FX('refs-altme.json')) };
    return { ok: false, status: 500 };
  };
  const days = { '2026-08-27': { t: 1.0 }, '2026-08-28': { t: 0.6 }, '2026-08-31': { t: 0.85 }, '2026-09-01': { t: 0.75 }, '2026-09-02': { t: 1.2 }, '2026-09-03': { t: 0.9 } };
  const refs = await g.referenceGauges({ fetchImpl, cboeHistory: { days }, today: '2026-09-06', modelHistoryUsa: [{ date: '2026-09-04', score: 56.4 }] });
  assert.equal(refs.ok, false);
  assert.deepEqual(refs.failed, ['ofr']);
  assert.equal(refs.cnn.ok, true); assert.equal(refs.cboe.ok, true); assert.equal(refs.crypto.ok, true);
  assert.match(g.summarize(refs), /^CNN 41\.9 fear \(2026-09-04, archive 2026-09-06T16:38:48Z\); Cboe P\/C 0\.76 \(2026-09-04, 1 new day\(s\)\); OFR failed \(HTTP 503\); alt\.me 73 Greed \(2026-09-06\)$/);
  assert.equal(g.summarize(null), 'not fetched');
  // the record job
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'investments-refs-'));
  try {
    const target = path.join(dir, 'cboe-putcall.json');
    g.writeCboeHistory({ source: 'test', days }, target);
    const body = Buffer.from(`${JSON.stringify(refs)}\n`);
    const digest = crypto.createHash('sha256').update(body).digest('hex');
    const served = async () => ({ ok: true, status: 200, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) });
    const first = await g.persistPublished({ url: 'https://example.invalid/refs.json', target, fetchImpl: served, expectedSha256: digest });
    assert.deepEqual(first, { written: true, added: 1, sha256: digest });
    const after = g.readCboeHistory(target);
    assert.deepEqual(after.days['2026-09-04'], { t: 0.76, e: 0.58, i: 0.89 });
    assert.ok(!fs.readFileSync(target, 'utf8').includes('\r'), 'LF only');
    const again = await g.persistPublished({ url: 'https://example.invalid/refs.json', target, fetchImpl: served, expectedSha256: digest });
    assert.deepEqual(again, { written: false, added: 0, sha256: digest });
    await assert.rejects(g.persistPublished({ url: 'https://example.invalid/refs.json', target, fetchImpl: served, expectedSha256: 'b'.repeat(64) }), /does not match the digest/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the committed Cboe record and the wiring in server, build, workflow and page', () => {
  const rec = g.readCboeHistory();
  const keys = Object.keys(rec.days).sort();
  assert.ok(keys.length > 4900 && keys[0] === '2006-11-01', `record from 2006-11-01 (${keys.length} days)`);
  assert.ok(keys[keys.length - 1] >= '2026-09-04');
  assert.deepEqual(rec.days['2026-09-04'], { t: 0.76, e: 0.58, i: 0.89 });
  assert.equal(rec.days['2006-11-01'].t, 0.91);
  assert.ok(!fs.readFileSync(g.CBOE_TARGET, 'utf8').includes('\r'), 'LF only');
  const server = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  assert.match(server, /require\('\.\/scripts\/reference-gauges'\)/);
  assert.match(server, /'\/api\/refs': \(\) => cached\('refs', getRefs, v => v\.ok\)/);
  assert.match(server, /'\/api\/marketfg': marketfgCached,/);
  const build = require('../scripts/build-pages');
  assert.ok(build.ENDPOINTS.includes('refs') && build.EXPECTED_FILES.includes('api/refs.json') && build.DIGESTED_FILES.includes('api/refs.json'));
  assert.match(fs.readFileSync(path.join(ROOT, 'scripts', 'build-pages.js'), 'utf8'), /refsCheck: summarizeRefs\(data\.refs\)/);
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.match(yml, /node scripts\/reference-gauges\.js --from-published "\$PUBLISHED_API\/refs\.json" --expect-sha256 "\$wantRefs"/);
  assert.match(yml, /git add data\/snapshots\.json data\/dalal13f-history\.json data\/kap-holders\.json data\/cboe-putcall\.json/);
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.match(html, /REFS=data\.refs\|\|null;/);
  assert.match(html, /<div class="callout refs" id="\$\{id\}-refs" hidden><\/div>/);
  assert.match(html, /renderRefs\(id\);/);
  assert.match(html, /CNN Fear &amp; Greed \(US\):/);
  assert.match(html, /Cboe put\/call ratio \(US options\):/);
  assert.match(html, /OFR Financial Stress Index:/);
  assert.match(html, /Crypto Fear &amp; Greed \(alternative\.me\):/);
  assert.match(html, /no public gauge exists for Sweden alone/);
  assert.match(fs.readFileSync(path.join(ROOT, 'README.txt'), 'utf8'), /reference-gauges\.js/);
});
