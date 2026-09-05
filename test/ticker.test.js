'use strict';

// The ticker chain (.github/workflows/ticker.yml, scripts/ticker.js): a build is requested only when the fund's files
// moved on or the snapshot aged, and a run re-dispatches the chain only behind a real wait timer and never beside another.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const ticker = require('../scripts/ticker');

const snapshot = {
  build: { generatedAt: '2026-09-05T17:22:48.649Z', commit: '4f0b3af' },
  holdings: { latest: { date: '2026-09-08' }, source: { etag: '"c97820d2c93cdd1:0"', lastModified: 'Sat, 05 Sep 2026 00:02:20 GMT' } },
  nav: { date: '2026-09-04' },
};
const at = iso => Date.parse(iso);

test('a build is due for a new holdings file, a new NAV file or an aged snapshot, and not otherwise', () => {
  const fresh = at('2026-09-05T18:00:00Z');
  const same = { etag: '"c97820d2c93cdd1:0"', lastModified: 'Sat, 05 Sep 2026 00:02:20 GMT' };
  assert.equal(ticker.buildDecision({ ...snapshot, holdingsHead: same, navDate: '2026-09-04', now: fresh }), null);
  assert.match(ticker.buildDecision({ ...snapshot, holdingsHead: { etag: '"new:0"', lastModified: 'Wed, 09 Sep 2026 00:02:11 GMT' }, navDate: '2026-09-04', now: fresh }), /new ETag/);
  assert.match(ticker.buildDecision({ ...snapshot, holdingsHead: { etag: null, lastModified: 'Wed, 09 Sep 2026 00:02:11 GMT' }, navDate: '2026-09-04', now: fresh }), /modified Wed, 09 Sep 2026/, 'Last-Modified decides only when there is no ETag');
  assert.match(ticker.buildDecision({ ...snapshot, holdingsHead: same, navDate: '2026-09-08', now: fresh }), /NAV file dated 2026-09-08/);
  assert.equal(ticker.buildDecision({ ...snapshot, holdingsHead: same, navDate: '2026-09-03', now: fresh }), null, 'an older NAV date is not news');
  assert.match(ticker.buildDecision({ ...snapshot, holdingsHead: same, navDate: '2026-09-04', now: at('2026-09-05T20:30:00Z') }), /3\.1 h old/);
  assert.match(ticker.buildDecision({ ...snapshot, holdingsHead: null, navDate: null, now: fresh, build: {} }), /build time cannot be read/);
  assert.equal(ticker.REBUILD_AFTER_HOURS, 3);
});

test('the DailyNAV rate date is read from the file itself', () => {
  const csv = 'Fund Name,Fund Ticker,CUSIP,Net Assets,Shares Outstanding,NAV,NAV Change Dollars,NAV Change Percentage,Market Price,Market Price Change Dollars,Market Price Change Percentage,Premium/Discount Percentage,Rate Date,Median 30 Day Spread Percentage\nPabrai Wagons ETF,WAGN,74316P538,296803681.15,18400814.000,16.1300,0.0300,0.1863,16.2400,0.0700,0.4329,0.6820,09/04/2026,0.1325\n';
  assert.equal(ticker.navRateDate(csv), '2026-09-04');
  assert.equal(ticker.navRateDate('header only'), null);
  assert.equal(ticker.navRateDate(''), null);
});

test('the chain continues only behind a wait timer of at least ten minutes and never beside another alive run', () => {
  const plan = (waitMinutes, aliveOthers = []) => ticker.chainPlan({ waitMinutes, aliveOthers, environment: 'ticker' });
  assert.deepEqual(plan(15), { dispatch: true, reason: 'next tick in about 15 min' });
  assert.equal(plan(null).dispatch, false);
  assert.match(plan(null).reason, /has no wait timer .*Settings → Environments/);
  assert.equal(plan(5).dispatch, false);
  assert.match(plan(5).reason, /under the 10-minute floor/);
  assert.equal(plan(15, [{ id: 7, status: 'waiting' }]).dispatch, false);
  assert.match(plan(15, [{ id: 7, status: 'waiting' }]).reason, /another run of the chain is alive \(7 waiting\)/);
  assert.equal(ticker.MIN_WAIT_MINUTES, 10);
  for (const status of ['waiting', 'queued', 'in_progress']) assert.ok(ticker.ALIVE.has(status));
  assert.ok(!ticker.ALIVE.has('completed'));
});

test('the environment is read for its wait timer and the run lists for alive runs, with the repository token only', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: init.headers.Authorization });
    if (url.endsWith('/environments/ticker')) return { ok: true, status: 200, json: async () => ({ protection_rules: [{ type: 'wait_timer', wait_timer: 15 }] }) };
    if (url.includes('/workflows/ticker.yml/runs')) return { ok: true, status: 200, json: async () => ({ workflow_runs: [{ id: 1, status: 'completed' }, { id: 2, status: 'waiting' }] }) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  assert.equal(await ticker.waitTimerMinutes(fetchImpl, 'tok', 'netic123/investments', 'ticker'), 15);
  assert.equal(await ticker.waitTimerMinutes(fetchImpl, 'tok', 'netic123/investments', 'missing'), null, 'a missing environment is null, never an error');
  assert.deepEqual((await ticker.aliveRuns(fetchImpl, 'tok', 'netic123/investments', 'ticker.yml')).map(r => r.id), [2]);
  for (const call of calls) assert.equal(call.auth, 'Bearer tok');
});

test('the workflows wire the chain: the ticker waits on the environment, and every successful build restarts a dead chain', () => {
  const tickerYml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ticker.yml'), 'utf8');
  assert.match(tickerYml, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(tickerYml, /\n  schedule:/);
  assert.match(tickerYml, /environment: ticker/);
  assert.match(tickerYml, /concurrency:\n  group: ticker\n  cancel-in-progress: false/);
  assert.match(tickerYml, /actions: write\n      contents: read/);
  assert.match(tickerYml, /run: node scripts\/ticker\.js/);
  const pagesYml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.match(pagesYml, /kick-ticker:/);
  assert.match(pagesYml, /run: node scripts\/ticker\.js --kick-only/);
  assert.equal((pagesYml.match(/contents: write/g) || []).length, 1, 'the record job stays the only writer');
});
