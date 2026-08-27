'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const splitter = require('../research/universal_volatility_overlay_proxy_splitter');

function dailyRows(firstDate, lastDate, startValue = 100) {
  const rows = [];
  for (let cursor = splitter.dateMs(firstDate), index = 0; cursor <= splitter.dateMs(lastDate); cursor += 86400000, index++) {
    rows.push({ date: splitter.isoDate(cursor), value: startValue + index / 100 });
  }
  return rows;
}

function syntheticSeries() {
  const rows = dailyRows('2015-12-30', '2018-12-31');
  return {
    key: 'fixture',
    ticker: 'FIX',
    name: 'Synthetic data-only fixture',
    currency: 'USD',
    returnType: 'SYNTHETIC_POSITIVE_LEVEL',
    executable: false,
    methodology: 'Deterministic daily fixture.',
    pointInTimeStatus: 'synthetic',
    source: { sourceUrl: 'https://example.invalid/fixture', retrievedAt: '2026-08-25T00:00:00.000Z' },
    history: splitter.seriesHistory(rows),
    rows,
  };
}

test('schema is proxy-only and command rejects every selector before file access', () => {
  assert.equal(splitter.OUTPUT_SCHEMA, 'universal-vol-overlay-proxy-input-v1');
  assert.notEqual(splitter.OUTPUT_SCHEMA, 'universal-vol-overlay-input-v1');
  assert.equal(splitter.OUTPUT_STAGE, 'development');
  assert.deepEqual(splitter.parseArgs([]), { stage: 'development', output: splitter.PATHS.output });

  for (const argv of [['validation'], ['evaluation'], ['development'], ['--output', 'anything.json']]) {
    let reads = 0;
    assert.throws(
      () => splitter.main(argv, { io: { readFileSync() { reads++; throw new Error('must not read'); } } }),
      /accepts no arguments or stage selector/,
    );
    assert.equal(reads, 0, `${argv.join(' ')} was rejected only after a file read`);
  }
});

test('canonical serialization and row receipts are deterministic', () => {
  const left = { z: 1, a: { y: 2, b: 3 }, rows: [{ value: 2, date: '2018-01-02' }] };
  const right = { rows: [{ date: '2018-01-02', value: 2 }], a: { b: 3, y: 2 }, z: 1 };
  assert.equal(splitter.stableJson(left), splitter.stableJson(right));
  assert.equal(splitter.sha256(Buffer.from(splitter.stableJson(left))), splitter.sha256(Buffer.from(splitter.stableJson(right))));
  const receipt = splitter.rowsReceipt([{ date: '2018-01-02', value: 2 }]);
  assert.deepEqual(receipt, {
    firstDate: '2018-01-02',
    lastDate: '2018-01-02',
    rowCount: 1,
    rowsSha256: splitter.sha256(Buffer.from('[{"date":"2018-01-02","value":2}]\n')),
  });
});

test('warm-up inventory requires twelve consecutive calendar months with at least fifteen data intervals', () => {
  const inventory = new Map();
  let month = '2016-01';
  for (let index = 0; index < 15; index++, month = splitter.nextMonth(month)) inventory.set(month, 20);
  inventory.set('2016-03', 14);
  const run = splitter.firstWarmupRun(inventory);
  assert.equal(run.length, 12);
  assert.equal(run[0].month, '2016-04');
  assert.equal(run.at(-1).month, '2017-03');
  assert.ok(run.every(item => item.supportedIntervalCount >= 15));

  const broken = new Map([...inventory].filter(([key]) => key !== '2016-10'));
  assert.throws(() => splitter.firstWarmupRun(broken), /no 12-month cash-supported warm-up run/);
});

test('synthetic splitter excludes pre-cash rows, preserves the Stage-1 end, and seals the boundary interval', () => {
  const series = syntheticSeries();
  const cashRows = dailyRows('2016-01-01', '2018-12-31', 1);
  const output = splitter.buildDevelopmentMarket(series, cashRows);

  assert.equal(output.stageHistory.firstDate, '2016-01-01');
  assert.equal(output.stageHistory.lastDate, '2018-12-31');
  assert.equal(output.calendarInventory.warmupFirstMonth, '2016-01');
  assert.equal(output.calendarInventory.warmupLastMonth, '2016-12');
  assert.equal(output.calendarInventory.warmupLastRowDate, '2016-12-31');
  assert.equal(output.calendarInventory.firstSignalFormationMonth, '2017-01');
  assert.equal(output.calendarInventory.formationLastRowDate, '2017-01-31');
  assert.equal(output.calendarInventory.stageBoundaryAnchorDate, '2017-02-01');
  assert.equal(output.calendarInventory.firstEligibleIntervalEndDate, '2017-02-02');
  assert.equal(output.rowRoles[output.rows.findIndex(row => row.date === '2016-12-31')], 'variance_warmup');
  assert.equal(output.rowRoles[output.rows.findIndex(row => row.date === '2017-01-01')], 'first_signal_formation_data');
  assert.equal(output.rowRoles[output.rows.findIndex(row => row.date === '2017-02-01')], 'stage_boundary_anchor_no_return');
  assert.equal(output.rowRoles[output.rows.findIndex(row => row.date === '2017-02-02')], 'stage_return_interval_end_eligible');
  assert.deepEqual(output.exclusions.map(item => [item.role, item.rowCount]), [
    ['before_first_cash_supported_close', 2],
    ['after_development_end', 0],
  ]);
  assert.equal(output.rowRoles.length, output.rows.length);
  for (const receipt of output.roleReceipts) {
    const exactRows = output.rows.filter((row, index) => output.rowRoles[index] === receipt.role);
    assert.equal(receipt.rowsSha256, splitter.rowsReceipt(exactRows).rowsSha256);
  }
});

test('cash reconstruction uses only a strictly prior observation and enforces seven-day staleness', () => {
  const dailyAtOne = (1 / (1 - 0.01 * 91 / 360)) ** (1 / 91);
  const dailyAtTwo = (1 / (1 - 0.02 * 91 / 360)) ** (1 / 91);
  const rebuilt = splitter.reconstructCash([
    { date: '2020-01-02', percent: 1 },
    { date: '2020-01-03', percent: 2 },
    { date: '2020-01-06', percent: 3 },
  ], '2020-01-06');
  assert.deepEqual(rebuilt.rows.map(row => row.date), ['2020-01-03', '2020-01-04', '2020-01-05', '2020-01-06']);
  assert.ok(Math.abs(rebuilt.rows[1].value - dailyAtOne) < 1e-14);
  assert.ok(Math.abs(rebuilt.rows.at(-1).value - dailyAtOne * dailyAtTwo ** 2) < 1e-14);
  assert.throws(
    () => splitter.reconstructCash([{ date: '2020-01-01', percent: 2 }, { date: '2020-01-20', percent: 2 }], '2020-01-20'),
    /stale/,
  );
});

test('series integrity rejects changed normalized rows and embedded metadata', () => {
  const rows = [{ date: '2018-01-02', value: 1 }, { date: '2018-01-03', value: 2 }];
  const history = splitter.seriesHistory(rows);
  const source = {
    rawPayloadSha256: 'a'.repeat(64),
    retrievedAt: '2026-08-25T00:00:00.000Z',
    sourceUrl: 'https://example.invalid',
    sourceArtifactSha256: 'b'.repeat(64),
  };
  const series = { ticker: 'FIX', returnType: 'FIXTURE', executable: false, history, source, rows };
  const manifest = { ticker: 'FIX', returnType: 'FIXTURE', executable: false, ...history, ...source };
  const expected = {
    ticker: 'FIX', returnType: 'FIXTURE', executable: false,
    firstDate: history.firstDate, lastDate: history.lastDate, rowCount: history.rowCount,
    normalizedRowsSha256: history.normalizedRowsSha256, rawPayloadSha256: source.rawPayloadSha256,
  };
  assert.doesNotThrow(() => splitter.verifySeries(series, manifest, expected, 'fixture'));
  const changed = structuredClone(series);
  changed.rows[1].value = 3;
  assert.throws(() => splitter.verifySeries(changed, manifest, expected, 'fixture'), /history mismatch/);
  const changedHash = structuredClone(series);
  changedHash.source.rawPayloadSha256 = 'c'.repeat(64);
  assert.throws(() => splitter.verifySeries(changedHash, manifest, expected, 'fixture'), /rawPayloadSha256 mismatch/);
});

test('data-only guard rejects outcome computations while permitting required source return-type metadata', () => {
  assert.doesNotThrow(() => splitter.assertDataOnly({ returnType: 'DATA_CLASSIFICATION', containsStrategyOutcomes: false }));
  for (const key of ['signal', 'strategyReturn', 'target', 'metric', 'gate', 'terminalWealth', 'sharpe', 'turnover', 'nav', 'results']) {
    assert.throws(() => splitter.assertDataOnly({ nested: { [key]: 1 } }), /forbidden non-data field/);
  }
});

const frozenFilesAvailable = [
  splitter.PATHS.normativeProtocol,
  splitter.PATHS.proxyProtocol,
  splitter.PATHS.manifest,
  splitter.PATHS.manifestSidecar,
  splitter.PATHS.parentInput,
  splitter.PATHS.parentInputSidecar,
  splitter.PATHS.cmbitmSource,
  splitter.PATHS.equityCashSource,
  splitter.PATHS.robustnessSource,
].every(file => fs.existsSync(file));

test('actual frozen integrity graph verifies in sealed order without opening a later-stage file', { skip: !frozenFilesAvailable }, () => {
  const accessLog = [];
  const verified = splitter.loadAndVerifyFrozenArtifacts({ accessLog });
  assert.deepEqual(accessLog, [
    splitter.PATHS.normativeProtocol,
    splitter.PATHS.proxyProtocol,
    splitter.PATHS.manifestSidecar,
    splitter.PATHS.manifest,
    splitter.PATHS.parentInputSidecar,
    splitter.PATHS.parentInput,
    splitter.PATHS.cmbitmSource,
    splitter.PATHS.equityCashSource,
    splitter.PATHS.robustnessSource,
  ].map(file => path.resolve(file)));
  assert.ok(accessLog.every(file => !/(^|[\\/])(validation|evaluation)([\\/]|$)/i.test(file)));
  assert.equal(verified.protocols.normative.sha256, splitter.EXPECTED.normativeProtocol);
  assert.equal(verified.protocols.proxy.sha256, splitter.EXPECTED.proxyProtocol);
  assert.equal(verified.input.markets[0].primary.ticker, 'CMBITM');
  assert.equal(verified.input.markets[0].primary.executable, false);
  assert.equal(verified.input.cash.executable, false);
});

test('a one-byte parent mutation stops at the file hash before JSON parsing or source access', { skip: !frozenFilesAvailable }, () => {
  const reads = [];
  const io = {
    readFileSync(file) {
      const resolved = path.resolve(file);
      reads.push(resolved);
      const bytes = fs.readFileSync(resolved);
      if (resolved !== path.resolve(splitter.PATHS.parentInput)) return bytes;
      const changed = Buffer.from(bytes);
      changed[changed.length - 2] ^= 1;
      return changed;
    },
  };
  assert.throws(() => splitter.loadAndVerifyFrozenArtifacts({ io }), /five-market-proxy-input-2026-08-24\.json SHA-256 mismatch/);
  assert.equal(reads.at(-1), path.resolve(splitter.PATHS.parentInput));
  assert.equal(reads.includes(path.resolve(splitter.PATHS.cmbitmSource)), false);
  assert.equal(reads.includes(path.resolve(splitter.PATHS.equityCashSource)), false);
});

test('actual development adapter is deterministic, has exact role hashes, and contains no crypto or later rows', { skip: !frozenFilesAvailable }, () => {
  const verified = splitter.loadAndVerifyFrozenArtifacts();
  const first = splitter.buildDevelopmentInput(verified);
  const second = splitter.buildDevelopmentInput(verified);
  assert.equal(splitter.stableJson(first), splitter.stableJson(second));
  assert.equal(
    splitter.sha256(Buffer.from(splitter.stableJson(first))),
    '2854a83456471e57196c893cb387fac15a6bb93db94e0edb536932cc9673cacd',
  );
  assert.equal(first.schema, 'universal-vol-overlay-proxy-input-v1');
  assert.equal(first.status, 'RETROSPECTIVE_PROXY_DATA_ONLY_NOT_CONFIRMATORY');
  assert.equal(first.stage, 'development');
  assert.equal(first.containsStrategyOutcomes, false);
  assert.deepEqual(first.markets.map(item => item.key), ['sweden', 'usa', 'europe', 'global']);
  assert.equal(first.markets.some(item => item.ticker === 'CMBITM'), false);
  assert.equal(first.cash.executable, false);
  assert.equal(first.cash.stageHistory.rowsSha256, 'b8ea4611127f1df349e8c1f9a34a2b626e195ad8d6351b18b499e5233706bda3');
  const expectedRows = {
    sweden: '830c7bcfd73b6bc1e364ac0ad2461e252bc8ffcd62f80d483d13824e3a53e5ad',
    usa: 'aec1cb1d722c9364820abef85efadeb602ea7849917fd16358c13bd5cfc80bff',
    europe: '6f6151d599e188642639d9bfc203b87502d08ac7b451d2d0674a1234aa592542',
    global: '27aedab9db78998299d231c6ce6830658bac3eece6861965ac1122d928e767d6',
  };
  for (const market of first.markets) {
    assert.equal(market.stageHistory.rowsSha256, expectedRows[market.key]);
    assert.equal(market.stageHistory.lastDate, '2018-12-31');
    assert.equal(market.rows.at(-1).date, '2018-12-31');
    assert.equal(market.rowRoles.length, market.rows.length);
    assert.equal(market.roleReceipts.reduce((sum, item) => sum + item.rowCount, 0), market.rows.length);
    assert.equal(market.roleReceipts.find(item => item.role === 'stage_boundary_anchor_no_return').rowCount, 1);
    assert.equal(market.rows.some(row => row.date >= '2019-01-01'), false);
  }
  assert.doesNotThrow(() => splitter.assertDataOnly(first));
});

test('writer emits only one requested development file and an exact adjacent digest receipt', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'universal-proxy-splitter-'));
  const output = path.join(directory, 'development-input.json');
  const payload = { schema: splitter.OUTPUT_SCHEMA, status: splitter.OUTPUT_STATUS, stage: 'development' };
  const written = splitter.writeDevelopmentInput(payload, { output, enforceDefaultPath: false });
  const entries = fs.readdirSync(directory).sort();
  assert.deepEqual(entries, ['development-input.json', 'development-input.json.sha256']);
  const bytes = fs.readFileSync(output);
  assert.equal(written.sha256, splitter.sha256(bytes));
  assert.equal(fs.readFileSync(`${output}.sha256`, 'utf8'), `${written.sha256}  development-input.json\n`);
  assert.throws(() => splitter.assertDefaultDevelopmentOutput(path.join(directory, 'validation', 'input.json')), /development proxy input path|later-stage/);
  assert.throws(() => splitter.assertDefaultDevelopmentOutput(path.join(directory, 'evaluation', 'input.json')), /development proxy input path|later-stage/);
});
