'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const base = require('../research/five_market_proxy_data');
const v2 = require('../research/five_market_proxy_data_v2');

const EXPECTED_INPUT_SHA256 = 'a85ffc681b4911fdd6d65a2e091301985937f7ffa05aac41f1642209eda95247';
const EXPECTED_INPUT_SIDECAR_SHA256 = '826acb0de5756dde835ac1cce583eb9c7631bd7ae2ee10ce877a220c456316c4';
const EXPECTED_MANIFEST_SHA256 = '1e64de19073b05aacc599083edff050eddd5a710be792212d1d0bcd8ccc0159e';
const EXPECTED_MANIFEST_SIDECAR_SHA256 = '3d84a806621cb78052ba6ed99456d6c242d62df3236ace8bffa0fa04e3ea84ee';

function fileSha(file) {
  return v2.sha256(fs.readFileSync(file));
}

test('v2 uses distinct schemas and paths and rejects every CLI argument', () => {
  assert.equal(v2.SCHEMA, 'five-market-proxy-input-v2');
  assert.equal(v2.FREEZE_MANIFEST_SCHEMA, 'five-market-proxy-freeze-manifest-v2');
  assert.notEqual(v2.PATHS.output, base.DEFAULT_OUTPUT);
  assert.notEqual(v2.PATHS.manifest, base.DEFAULT_MANIFEST);
  assert.deepEqual(v2.parseArgs([]), { output: v2.PATHS.output, manifest: v2.PATHS.manifest });
  assert.throws(() => v2.parseArgs(['--output', 'x']), /accepts no arguments/);
});

test('official extended DTB3 raw bytes and both sidecars have exact frozen identities', () => {
  const rawSidecar = v2.readExact(v2.PATHS.fredRawSidecar, v2.EXPECTED.fredRawSidecar);
  const raw = v2.readExact(v2.PATHS.fredRaw, v2.EXPECTED.fredRaw);
  const receiptSidecar = v2.readExact(v2.PATHS.fredReceiptSidecar, v2.EXPECTED.fredReceiptSidecar);
  const receiptArtifact = v2.readExact(v2.PATHS.fredReceipt, v2.EXPECTED.fredReceipt);
  v2.verifySidecar(rawSidecar, raw.sha256, path.basename(v2.PATHS.fredRaw));
  v2.verifySidecar(receiptSidecar, receiptArtifact.sha256, path.basename(v2.PATHS.fredReceipt));
  const receipt = v2.parseJson(receiptArtifact, 'fixture receipt');
  assert.equal(receipt.sourceUrl, 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTB3&cosd=1995-01-01&coed=2026-08-24');
  assert.equal(receipt.rawArtifact.sha256, raw.sha256);
  assert.equal(receipt.rawArtifact.bytes, raw.bytes.length);
  assert.equal(receipt.containsStrategyOutcomes, false);
});

test('extended DTB3 parser freezes 7,916 non-missing rows and no observation gap exceeds four days', () => {
  const bytes = fs.readFileSync(v2.PATHS.fredRaw);
  const rows = v2.parseFredCsv(bytes);
  assert.equal(rows.length, 7916);
  assert.equal(rows[0].date, '1995-01-03');
  assert.equal(rows.at(-1).date, '2026-08-21');
  assert.equal(base.history(rows).normalizedRowsSha256, v2.EXPECTED.observedYieldRows);
  let maximumGap = 0;
  for (let index = 1; index < rows.length; index++) {
    maximumGap = Math.max(maximumGap, base.calendarDays(rows[index - 1].date, rows[index].date));
  }
  assert.equal(maximumGap, 4);
});

test('cash reconstruction remains strictly prior-date causal and rejects a rate older than seven days', () => {
  const onePercent = (1 / (1 - 0.01 * 91 / 360)) ** (1 / 91);
  const twoPercent = (1 / (1 - 0.02 * 91 / 360)) ** (1 / 91);
  const built = base.buildDailyCashWealth([
    { date: '2020-01-02', percent: 1 },
    { date: '2020-01-03', percent: 2 },
    { date: '2020-01-06', percent: 3 },
  ], '2020-01-06', 7);
  assert.deepEqual(built.rows.map(row => row.date), ['2020-01-03', '2020-01-04', '2020-01-05', '2020-01-06']);
  assert.ok(Math.abs(built.rows[1].value - onePercent) < 1e-14);
  assert.ok(Math.abs(built.rows.at(-1).value - onePercent * twoPercent ** 2) < 1e-14);
  assert.throws(
    () => base.buildDailyCashWealth([{ date: '2020-01-01', percent: 2 }, { date: '2020-01-20', percent: 2 }], '2020-01-20', 7),
    /stale/,
  );
});

test('v2 rebuild is deterministic, changes only cash source history, and preserves every risky hash', () => {
  const loaded = v2.loadFrozenArtifacts();
  const first = v2.buildInput(loaded);
  const second = v2.buildInput(loaded);
  assert.equal(base.stableJson(first), base.stableJson(second));
  assert.equal(first.cash.history.firstDate, '1995-01-04');
  assert.equal(first.cash.history.lastDate, '2026-08-24');
  assert.equal(first.cash.history.rowCount, 11556);
  assert.equal(first.cash.history.normalizedRowsSha256, v2.EXPECTED.cashRows);
  assert.equal(first.cash.source.informationLagRule, 'STRICTLY_PRIOR_OBSERVATION_DATE_FOR_EACH_ACCRUAL_START_DATE');
  assert.equal(first.cash.source.maximumObservationStalenessCalendarDays, 7);
  assert.equal(first.cashExtension.v1Status, 'SUPERSEDED_BEFORE_ANY_UNIVERSAL_VOLATILITY_PROXY_OUTCOME');
  assert.equal(first.cashExtension.riskyAndRobustnessBytesRefetched, false);
  assert.equal(first.cashExtension.modelLogicChanged, false);
  for (const item of first.markets) {
    assert.equal(item.primary.history.normalizedRowsSha256, v2.EXPECTED_RISKY_ROWS[item.key]);
  }
  assert.deepEqual(first.markets.flatMap(item => item.robustness).map(item => item.history.normalizedRowsSha256), [
    '63c7ed0f134e85d7a3346108c7fd02fc6d4c967d9cea131a9f65522ad9014b06',
    'a08d69f5c24af5afff1dd1ea3b20b714945702c2a03c3f049cebbc6bdf507d74',
    '2f5688031fea83d7c9aad6963c05992144a930ce19b8aa8a56ae141d4f9e21b6',
  ]);
  assert.equal(first.historyPanels.investableEquityPrimaryLongHistory.strictCommonHistory.datesSha256, '1626c6fc91efa55d71c67a10941a432104dd5e1cc2a467bf666dde341bce2ccf');
  assert.equal(first.historyPanels.fiveMarketPrimary.strictCommonHistory.datesSha256, 'aa7b9b53bd0f47b8de6da980f5d188dcb4eb5651d89bc0eb3449a7424a008481');
  assert.doesNotThrow(() => v2.assertDataOnly(first));
});

test('generated v2 input and repository-intended manifest are exact canonical rebuilds with exact sidecars', () => {
  const loaded = v2.loadFrozenArtifacts();
  const rebuiltInput = v2.buildInput(loaded);
  const inputBytes = fs.readFileSync(v2.PATHS.output);
  assert.equal(inputBytes.toString('utf8'), base.stableJson(rebuiltInput));
  assert.equal(v2.sha256(inputBytes), EXPECTED_INPUT_SHA256);
  assert.equal(fileSha(`${v2.PATHS.output}.sha256`), EXPECTED_INPUT_SIDECAR_SHA256);
  assert.equal(fs.readFileSync(`${v2.PATHS.output}.sha256`, 'utf8'), `${EXPECTED_INPUT_SHA256}  ${path.basename(v2.PATHS.output)}\n`);

  const rebuiltManifest = v2.freezeManifest(rebuiltInput, {
    absolutePath: v2.PATHS.output,
    bytes: inputBytes.length,
    sha256: EXPECTED_INPUT_SHA256,
  });
  const manifestBytes = fs.readFileSync(v2.PATHS.manifest);
  assert.equal(manifestBytes.toString('utf8'), base.stableJson(rebuiltManifest));
  assert.equal(v2.sha256(manifestBytes), EXPECTED_MANIFEST_SHA256);
  assert.equal(fileSha(`${v2.PATHS.manifest}.sha256`), EXPECTED_MANIFEST_SIDECAR_SHA256);
  assert.equal(fs.readFileSync(`${v2.PATHS.manifest}.sha256`, 'utf8'), `${EXPECTED_MANIFEST_SHA256}  ${path.basename(v2.PATHS.manifest)}\n`);
  assert.equal(rebuiltManifest.containsStrategyOutcomes, false);
});

test('all v1 source and freeze bytes remain unchanged', () => {
  assert.equal(fileSha(base.DEFAULT_CMBITM_SNAPSHOT), base.EXPECTED_CMBITM_SNAPSHOT_SHA256);
  assert.equal(fileSha(base.DEFAULT_EQUITY_CACHE), base.EXPECTED_EQUITY_CACHE_SHA256);
  assert.equal(fileSha(base.DEFAULT_ROBUSTNESS_CACHE), v2.EXPECTED.robustnessCache);
  assert.equal(fileSha(base.DEFAULT_OUTPUT), 'a7a1e895ff4dbda68849beaead5f86cabad4493f89db43ec05e6a805847a329c');
  assert.equal(fileSha(base.DEFAULT_MANIFEST), '236881d17829b35356ea06b582c5ebd49020f81958400913aa9a83e544ab032a');
});
