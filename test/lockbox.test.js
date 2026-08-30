'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const collect = require('../scripts/lockbox-collect.js');
const verify = require('../scripts/lockbox-verify.js');

test('legacy Europe prospective collector remains explicitly pinned to rolling model v2', () => {
  assert.deepEqual(collect.FROZEN_MARKET_MODEL, {
    version: 2,
    percentileMode: 'trailing-window',
    window: 252,
    minWindowPoints: 126,
    strengthWindow: 252,
    percentileMinPoints: 126,
  });
});

function temporaryLockbox(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lockbox-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'entries'), { recursive: true });
  return dir;
}

function syntheticGenesis(dir) {
  const genesis = {
    schema: 'europe-lockbox-genesis-v1', activatedAt: '2026-08-27T00:00:00.000Z',
    candidate: 'EUROPE-MONTHLY-CONTRARIAN-V1', instrument: { symbol: collect.INSTRUMENT_SYMBOL },
  };
  collect.writeWithSidecar(path.join(dir, 'GENESIS.json'), collect.canonicalJson(genesis));
}

function syntheticEntry(dir, entryDate, score, previousFile) {
  const previousSha256 = collect.sha256(fs.readFileSync(previousFile));
  const entry = {
    schema: collect.ENTRY_SCHEMA, entryDate, collectedAt: `${entryDate}T22:30:00.000Z`,
    candidate: 'EUROPE-MONTHLY-CONTRARIAN-V1',
    modelIdentity: { modelId: 'investments-unified-fear-greed', version: 2 },
    europe: { score, label: 'x', asOf: entryDate, n: 6, components: {} },
    otherMarkets: {},
    instrument: { symbol: collect.INSTRUMENT_SYMBOL, bars: [{ date: entryDate, close: 100 + score }] },
    cash: { series: 'DTB3', rows: [{ date: entryDate, percent: 4 }] },
    failedMarkets: {},
    previousEntry: { previousDate: 'x', previousSha256 },
  };
  const file = path.join(dir, 'entries', `${entryDate}.json`);
  collect.writeWithSidecar(file, collect.canonicalJson(entry));
  return file;
}

function buildChain(dir, rows) {
  syntheticGenesis(dir);
  let previous = path.join(dir, 'GENESIS.json');
  for (const [date, score] of rows) previous = syntheticEntry(dir, date, score, previous);
}

test('verify passes on an intact chain and counts completed monthly decisions', t => {
  const dir = temporaryLockbox(t);
  buildChain(dir, [['2026-08-28', 50], ['2026-08-31', 30], ['2026-09-01', 90], ['2026-09-30', 86], ['2026-10-01', 50]]);
  const report = verify.verifyLockbox(dir);
  assert.equal(report.ok, true);
  assert.equal(report.entries, 5);
  // completed months: 2026-08 (last integer 30 -> fear) and 2026-09 (86 -> greed); 2026-10 still open
  assert.equal(report.completedMonthlyDecisions, 2);
  assert.equal(report.fearDecisions, 1);
  assert.equal(report.greedDecisions, 1);
});

test('editing a past entry breaks the chain for every later entry', t => {
  const dir = temporaryLockbox(t);
  buildChain(dir, [['2026-08-28', 50], ['2026-08-29', 40], ['2026-08-30', 30]]);
  const target = path.join(dir, 'entries', '2026-08-29.json');
  const tampered = fs.readFileSync(target, 'utf8').replace('"score": 40', '"score": 10');
  collect.writeWithSidecar(target, tampered); // even with a matching sidecar...
  assert.throws(() => verify.verifyLockbox(dir), /2026-08-30: chain broken/);
});

test('a tampered byte without a sidecar update is caught immediately', t => {
  const dir = temporaryLockbox(t);
  buildChain(dir, [['2026-08-28', 50]]);
  const target = path.join(dir, 'entries', '2026-08-28.json');
  fs.writeFileSync(target, fs.readFileSync(target, 'utf8').replace('"score": 50', '"score": 99'));
  assert.throws(() => verify.verifyLockbox(dir), /sidecar hash mismatch/);
});

test('writeEntryIfAbsent is append-only: the first write per date is permanent', t => {
  const dir = temporaryLockbox(t);
  syntheticGenesis(dir);
  const entriesDir = path.join(dir, 'entries');
  const entry = {
    schema: collect.ENTRY_SCHEMA, entryDate: '2026-08-28',
    europe: { score: 42 }, previousEntry: { previousSha256: 'x' },
  };
  const first = collect.writeEntryIfAbsent(entry, entriesDir);
  assert.equal(first.written, true);
  const before = fs.readFileSync(first.file, 'utf8');
  const second = collect.writeEntryIfAbsent({ ...entry, europe: { score: 99 } }, entriesDir);
  assert.equal(second.written, false);
  assert.equal(fs.readFileSync(first.file, 'utf8'), before, 'primary entry bytes must never change');
});

test('provider close revisions are warnings, never silent adoption; missing europe score fails', t => {
  const dir = temporaryLockbox(t);
  buildChain(dir, [['2026-08-28', 50]]);
  // second entry repeats the same bar date with a different close
  const previous = path.join(dir, 'entries', '2026-08-28.json');
  const previousSha256 = collect.sha256(fs.readFileSync(previous));
  const entry = {
    schema: collect.ENTRY_SCHEMA, entryDate: '2026-08-29', collectedAt: 'x',
    candidate: 'EUROPE-MONTHLY-CONTRARIAN-V1', modelIdentity: {},
    europe: { score: 44, label: 'x', asOf: '2026-08-29', n: 6, components: {} }, otherMarkets: {},
    instrument: { symbol: collect.INSTRUMENT_SYMBOL, bars: [{ date: '2026-08-28', close: 151 }] },
    cash: { series: 'DTB3', rows: [] }, failedMarkets: {},
    previousEntry: { previousDate: '2026-08-28', previousSha256 },
  };
  collect.writeWithSidecar(path.join(dir, 'entries', '2026-08-29.json'), collect.canonicalJson(entry));
  const report = verify.verifyLockbox(dir);
  assert.equal(report.ok, true);
  assert.ok(report.warnings.some(w => w.includes('provider revision')));
});

test('canonicalJson rejects non-finite values and buildEntry refuses a missing europe score', () => {
  assert.throws(() => collect.canonicalJson({ x: NaN }), /non-finite/);
  assert.throws(() => collect.buildEntry({
    entryDate: '2026-08-28', marketfgResult: { markets: {}, model: {} },
    instrument: {}, cash: {}, chain: {}, identity: {}, collectedAt: 'x',
  }), /europe score missing/);
});
