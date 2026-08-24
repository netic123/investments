'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const ROOT = path.resolve(__dirname, '..');

test('public Pages watchlist contains only the approved identities and no entry prices', () => {
  const watchlist = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'positions.public.json'), 'utf8'));
  const allowedKeys = ['currency', 'entry', 'fundTicker', 'nextReport', 'nextReportApprox', 'nextReportNote', 'secTicker', 'ticker', 'yahoo'];
  for (const position of watchlist.myPositions) {
    assert.deepEqual(Object.keys(position).filter(key => !allowedKeys.includes(key)), []);
  }
  const actual = watchlist.myPositions.map(position => ({
    ticker: position.ticker,
    fundTicker: position.fundTicker,
    yahoo: position.yahoo,
    entry: position.entry,
  }));

  assert.deepEqual(actual, [
    { ticker: 'CSU.TO', fundTicker: 'CSU CN', yahoo: 'CSU.TO', entry: null },
    { ticker: 'KSPI', fundTicker: 'KSPI', yahoo: 'KSPI', entry: null },
    { ticker: 'HCC', fundTicker: 'HCC', yahoo: 'HCC', entry: null },
  ]);
});

test('private position files stay ignored', () => {
  const ignored = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').split(/\r?\n/);
  assert.ok(ignored.includes('data/positions.local.json'));
  assert.ok(ignored.includes('data/portfolio.local.json'));
});
