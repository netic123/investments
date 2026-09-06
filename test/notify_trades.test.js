'use strict';

// Trade notifications (scripts/notify-trades.js): one GitHub issue per interval with a trade, never twice, never the
// whole history on a first run, never a failed build.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const n = require('../scripts/notify-trades');
const build = require('../scripts/build-pages');

const snaps = [
  { date: '2026-09-03', netAssets: 297896435.64, sharesOutstanding: 18320814, source: { capturedAt: '2026-09-03T00:20:00Z' } },
  { date: '2026-09-04', netAssets: 296253105.4, sharesOutstanding: 18400814, source: { capturedAt: '2026-09-04T00:12:00Z' } },
  { date: '2026-09-08', netAssets: 300998929.82, sharesOutstanding: 18660814, source: { capturedAt: '2026-09-05T12:59:53Z' } },
];
const log = [
  { from: '2026-09-04', to: '2026-09-08', ticker: 'ODL NO', kind: 'INCREASE', delta: 64507, pct: 9.7, approxUsd: 660390, absValue: 660390, sharesTo: 727740 },
  { from: '2026-09-04', to: '2026-09-08', ticker: 'FXFXX', kind: 'DECREASE', delta: -3236790, pct: -54, approxUsd: 3236790, absValue: 3236790, sharesTo: 2751515, cashLike: true },
  { from: '2026-09-03', to: '2026-09-04', ticker: 'AMR', kind: 'SOLD OUT', delta: -5, pct: -100, approxUsd: 1000, absValue: 1000, sharesTo: 0 },
];
const nav = { history: [{ date: '2026-09-02', nav: 16.26 }, { date: '2026-09-03', nav: 16.1 }, { date: '2026-09-04', nav: 16.13 }] };
const holdings = { latest: { date: '2026-09-08' }, snapshots: snaps, log };

test('tradeEntries carries the fields the feed and the issues share, newest first', () => {
  const entries = build.tradeEntries(holdings, nav, { generatedAt: '2026-09-05T17:22:48Z' });
  assert.deepEqual(entries.map(e => [e.key, e.session, e.tradeCount]), [['2026-09-04/2026-09-08', '4 Sept 2026 session', 1], ['2026-09-03/2026-09-04', '3 Sept 2026 session', 1]]);
  assert.match(entries[0].lines[0], /^Bought more: ODL NO \+64,507 shares/);
  assert.match(entries[0].basis, /priced at the 3 Sept 2026 and 4 Sept 2026 closes/);
  assert.equal((build.tradesFeedXml(holdings, nav, { generatedAt: '2026-09-05T17:22:48Z' }).match(/<entry>/g) || []).length, 2, 'the feed is built from the same entries');
});

test('an issue names the owner, lists the lines, links the page and the feed, and carries the interval marker', () => {
  const entry = build.tradeEntries(holdings, nav, {})[0];
  const issue = n.issueFor(entry, { owner: 'netic123', runUrl: 'https://github.com/netic123/investments/actions/runs/1', fileDate: '2026-09-08' });
  assert.equal(issue.title, 'Pabrai trades, 4 Sept 2026 session: Bought more ODL NO +64,507');
  assert.match(issue.body, /^@netic123 — the fund’s file dated 2026-09-08 shows trades in the 4 Sept 2026 session:/);
  assert.match(issue.body, /\n- Bought more: ODL NO \+64,507 shares/);
  assert.match(issue.body, /\n- WAGN units created: 260,000/);
  assert.match(issue.body, /not trade tickets, so the exact time and price are unknown/);
  assert.match(issue.body, /Page: https:\/\/netic123\.github\.io\/investments\/#pabrai · Feed: https:\/\/netic123\.github\.io\/investments\/api\/trades\.xml · Build: https:\/\/github\.com\/netic123\/investments\/actions\/runs\/1/);
  assert.ok(issue.body.endsWith(n.markerOf('2026-09-04/2026-09-08')));
  assert.deepEqual(issue.labels, ['trade']);
  assert.deepEqual(n.markersIn(issue.body), ['2026-09-04/2026-09-08']);
});

test('only intervals with a trade, only the three newest, never one already marked, and only the newest on a first run', () => {
  const e = (key, tradeCount) => ({ key, tradeCount });
  const entries = [e('d/e', 1), e('c/d', 0), e('b/c', 2), e('a/b', 1), e('z/a', 1)];
  assert.deepEqual(n.issuesToCreate(entries, []).map(x => x.key), ['d/e'], 'first run: the newest only');
  assert.deepEqual(n.issuesToCreate(entries, ['x/y']).map(x => x.key), ['d/e', 'b/c', 'a/b'], 'three newest traded intervals');
  assert.deepEqual(n.issuesToCreate(entries, ['d/e', 'b/c']).map(x => x.key), ['a/b'], 'marked ones are skipped');
  assert.deepEqual(n.issuesToCreate(entries, ['d/e', 'b/c', 'a/b']), []);
  assert.equal(n.CONSIDER, 3);
});

test('the run reads the built site, checks the existing issues, creates the label once and posts with the token only', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'investments-notify-'));
  try {
    fs.mkdirSync(path.join(dir, 'api'));
    fs.writeFileSync(path.join(dir, 'api', 'holdings.json'), JSON.stringify(holdings));
    fs.writeFileSync(path.join(dir, 'api', 'nav.json'), JSON.stringify(nav));
    fs.writeFileSync(path.join(dir, 'api', 'build.json'), JSON.stringify({ generatedAt: '2026-09-05T17:22:48Z' }));
    const calls = [];
    const fetchImpl = async (url, init = {}) => {
      calls.push({ url, method: init.method || 'GET', auth: init.headers.Authorization, body: init.body ? JSON.parse(init.body) : null });
      if (/\/issues\?labels=trade/.test(url)) return { ok: true, status: 200, json: async () => [{ number: 1, body: `old\n${n.markerOf('2026-09-03/2026-09-04')}` }] };
      if (/\/labels\/trade$/.test(url)) return { ok: false, status: 404, json: async () => ({}) };
      if (/\/labels$/.test(url)) return { ok: true, status: 201, json: async () => ({ name: 'trade' }) };
      if (/\/issues$/.test(url)) return { ok: true, status: 201, json: async () => ({ number: 2, html_url: 'https://github.com/netic123/investments/issues/2' }) };
      return { ok: false, status: 500, json: async () => ({}) };
    };
    const lines = [];
    const result = await n.notifyTrades({ siteDir: dir, token: 'tok', repo: 'netic123/investments', fetchImpl, log: l => lines.push(l) });
    assert.deepEqual(result.created, [{ key: '2026-09-04/2026-09-08', number: 2, url: 'https://github.com/netic123/investments/issues/2' }]);
    assert.deepEqual(calls.map(c => `${c.method} ${c.url.replace('https://api.github.com/repos/netic123/investments', '')}`), ['GET /issues?labels=trade&state=all&per_page=100&page=1', 'GET /labels/trade', 'POST /labels', 'POST /issues']);
    for (const c of calls) assert.equal(c.auth, 'Bearer tok');
    assert.match(calls[3].body.body, /@netic123/);
    assert.ok(lines.some(l => /created the "trade" label/.test(l)) && lines.some(l => /opened issue #2/.test(l)));
    // a second run with both intervals marked posts nothing and calls nothing but the issue list
    const again = await n.notifyTrades({ siteDir: dir, token: 'tok', repo: 'netic123/investments', log: () => {}, fetchImpl: async (url, init = {}) => (/\/issues\?labels=trade/.test(url) ? { ok: true, status: 200, json: async () => [{ number: 2, body: n.markerOf('2026-09-04/2026-09-08') }, { number: 1, body: n.markerOf('2026-09-03/2026-09-04') }] } : { ok: false, status: 500, json: async () => ({}) }) });
    assert.deepEqual(again.created, []);
    // dry run: no call at all
    const dry = await n.notifyTrades({ siteDir: dir, dryRun: true, fetchImpl: async () => { throw new Error('must not be called'); }, log: () => {} });
    assert.equal(dry.dryRun, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the build job runs the notifier after the snapshot with issues: write, and README says so', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.match(yml, /issues: write/);
  assert.match(yml, /run: node scripts\/notify-trades\.js/);
  assert.ok(yml.indexOf('run: node scripts/notify-trades.js') > yml.indexOf('run: node scripts/build-pages.js'), 'after the snapshot is written');
  assert.match(fs.readFileSync(path.join(ROOT, 'README.txt'), 'utf8'), /NOTIFICATIONS/);
});
