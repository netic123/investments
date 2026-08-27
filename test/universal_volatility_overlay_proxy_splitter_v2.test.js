'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const splitter = require('../research/universal_volatility_overlay_proxy_splitter_v2');
const v1 = require('../research/universal_volatility_overlay_proxy_splitter');

function actualSha256(file) {
  return v1.sha256(fs.readFileSync(file));
}

test('v2 schema is proxy-only and every selector is rejected before file access', () => {
  assert.equal(splitter.OUTPUT_SCHEMA, 'universal-vol-overlay-proxy-input-v2');
  assert.notEqual(splitter.OUTPUT_SCHEMA, 'universal-vol-overlay-input-v1');
  assert.notEqual(splitter.OUTPUT_SCHEMA, 'universal-vol-overlay-proxy-input-v1');
  assert.equal(splitter.OUTPUT_STAGE, 'development');
  assert.deepEqual(splitter.parseArgs([]), { stage: 'development', output: splitter.PATHS.output });

  for (const argv of [['validation'], ['evaluation'], ['development'], ['--output', 'anything.json']]) {
    let reads = 0;
    assert.throws(
      () => splitter.main(argv, { io: { readFileSync() { reads++; throw new Error('must not read'); } } }),
      /accepts no arguments or stage selector/,
    );
    assert.equal(reads, 0, `${argv.join(' ')} was rejected only after file access`);
  }
});

test('frozen protocol, strict runner, tests, and v2 data-code identities are exact', () => {
  const exact = [
    ['normativeProtocol', splitter.PATHS.normativeProtocol],
    ['proxyProtocol', splitter.PATHS.proxyProtocol],
    ['strictRunner', splitter.PATHS.strictRunner],
    ['strictRunnerTests', splitter.PATHS.strictRunnerTests],
    ['dataBuilder', splitter.PATHS.dataBuilder],
    ['dataBuilderTests', splitter.PATHS.dataBuilderTests],
    ['calendarRoleSplitterV1', splitter.PATHS.calendarRoleSplitterV1],
    ['calendarRoleSplitterV1Tests', splitter.PATHS.calendarRoleSplitterV1Tests],
    ['manifest', splitter.PATHS.manifest],
    ['manifestSidecar', splitter.PATHS.manifestSidecar],
    ['parentInput', splitter.PATHS.parentInput],
    ['parentInputSidecar', splitter.PATHS.parentInputSidecar],
  ];
  for (const [key, file] of exact) {
    assert.equal(actualSha256(file), splitter.EXPECTED[key], key);
  }
  const protocol = fs.readFileSync(splitter.PATHS.proxyProtocol, 'utf8');
  assert.match(protocol, /FROZEN_UNIVERSAL_VOL_PROXY_FALSIFICATION_V2/);
  assert.match(protocol, new RegExp(splitter.EXPECTED.strictRunner));
  assert.match(protocol, new RegExp(splitter.EXPECTED.strictRunnerTests));
  assert.doesNotMatch(protocol, /DRAFT_ONLY_NOT_FROZEN|TO_BE_FILLED/);
});

const frozenFilesAvailable = [
  ...Object.values(splitter.PATHS).filter(file => file !== splitter.PATHS.output),
  ...Object.values(require('../research/five_market_proxy_data_v2').PATHS).filter(file => file !== require('../research/five_market_proxy_data_v2').PATHS.output && file !== require('../research/five_market_proxy_data_v2').PATHS.manifest),
].every(file => fs.existsSync(file));

let cachedVerified;
function verifiedActual() {
  cachedVerified ||= splitter.loadAndVerifyFrozenArtifacts();
  return cachedVerified;
}

test('actual v2 graph verifies in protocol-first order and rebuilds exact source bytes without later-stage access', { skip: !frozenFilesAvailable }, () => {
  const accessLog = [];
  const verified = splitter.loadAndVerifyFrozenArtifacts({ accessLog });
  assert.deepEqual(accessLog, [
    splitter.PATHS.normativeProtocol,
    splitter.PATHS.proxyProtocol,
    splitter.PATHS.strictRunner,
    splitter.PATHS.strictRunnerTests,
    splitter.PATHS.dataBuilder,
    splitter.PATHS.dataBuilderTests,
    splitter.PATHS.calendarRoleSplitterV1,
    splitter.PATHS.calendarRoleSplitterV1Tests,
    splitter.PATHS.manifestSidecar,
    splitter.PATHS.manifest,
    splitter.PATHS.parentInputSidecar,
    splitter.PATHS.parentInput,
  ].map(file => path.resolve(file)));
  assert.ok(accessLog.every(file => !/(^|[\\/])(validation|evaluation)([\\/]|$)/i.test(file)));
  assert.equal(verified.protocols.normative.sha256, splitter.EXPECTED.normativeProtocol);
  assert.equal(verified.protocols.proxy.sha256, splitter.EXPECTED.proxyProtocol);
  assert.equal(verified.manifest.containsStrategyOutcomes, false);
  assert.equal(verified.input.cash.source.maximumObservationStalenessCalendarDays, 7);
  assert.equal(verified.input.cash.source.informationLagRule, 'STRICTLY_PRIOR_OBSERVATION_DATE_FOR_EACH_ACCRUAL_START_DATE');
  assert.equal(verified.input.cash.source.observedYieldHistory.firstDate, '1995-01-03');
  assert.equal(verified.input.cash.history.firstDate, '1995-01-04');
  assert.equal(verified.input.cash.history.normalizedRowsSha256, '3aff9a603124d5ee195a544b785802e68b5245ffead03db9d081901e8b24ff4f');
});

test('a one-byte parent mutation stops at its hash before source reconstruction', { skip: !frozenFilesAvailable }, () => {
  const reads = [];
  let sourceLoads = 0;
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
  assert.throws(
    () => splitter.loadAndVerifyFrozenArtifacts({ io, loadSourceGraph() { sourceLoads++; throw new Error('must not load'); } }),
    /five-market-proxy-input-v2-2026-08-24\.json SHA-256 mismatch/,
  );
  assert.equal(reads.at(-1), path.resolve(splitter.PATHS.parentInput));
  assert.equal(sourceLoads, 0);
});

test('actual development split has exact per-market roles and excludes crypto and all post-2018 rows', { skip: !frozenFilesAvailable }, () => {
  const first = splitter.buildDevelopmentInput(verifiedActual());
  const second = splitter.buildDevelopmentInput(verifiedActual());
  assert.equal(v1.stableJson(first), v1.stableJson(second));
  assert.equal(v1.sha256(Buffer.from(v1.stableJson(first))), '67e176b5c7ba4d1123b2b1cdf4325edad5af0d5e5e98782cbe88f3f0457dc89f');
  assert.equal(first.schema, splitter.OUTPUT_SCHEMA);
  assert.equal(first.status, splitter.OUTPUT_STATUS);
  assert.equal(first.stage, 'development');
  assert.equal(first.containsStrategyOutcomes, false);
  assert.deepEqual(first.markets.map(item => item.key), ['sweden', 'usa', 'europe', 'global']);
  assert.equal(first.markets.some(item => item.ticker === 'CMBITM'), false);
  assert.equal(first.boundary.cryptoIncluded, false);
  assert.equal(first.boundary.laterStageDataIncluded, false);
  assert.equal(first.boundary.validationOrEvaluationArtifactOpenedOrCreated, false);
  assert.deepEqual(first.cash.stageHistory, splitter.EXPECTED_DEVELOPMENT.cash);

  for (const market of first.markets) {
    const expected = splitter.EXPECTED_DEVELOPMENT[market.key];
    assert.equal(market.stageHistory.firstDate, expected.firstDate);
    assert.equal(market.stageHistory.lastDate, expected.lastDate);
    assert.equal(market.stageHistory.rowCount, expected.rowCount);
    assert.equal(market.stageHistory.rowsSha256, expected.rowsSha256);
    assert.equal(market.rowRolesSha256, expected.rowRolesSha256);
    assert.equal(market.rowRoles.length, market.rows.length);
    assert.equal(market.roleReceipts.reduce((sum, receipt) => sum + receipt.rowCount, 0), market.rows.length);
    assert.equal(market.roleReceipts.find(receipt => receipt.role === 'stage_boundary_anchor_no_return').rowCount, 1);
    assert.equal(market.rows.some(row => row.date > '2018-12-31'), false);
    assert.equal(market.rows.at(-1).date, '2018-12-31');
  }
});

test('development payload is outcome-free and preserves strict-runner and licensing boundaries', { skip: !frozenFilesAvailable }, () => {
  const output = splitter.buildDevelopmentInput(verifiedActual());
  assert.doesNotThrow(() => v1.assertDataOnly(output));
  assert.equal(output.runnerPrecondition.applicableCodeProtocolTestsCommittedCleanRequiredBeforeStage1, true);
  assert.equal(output.runnerPrecondition.currentDevelopmentInputCommitRequiredForStage1, false);
  assert.equal(output.runnerPrecondition.currentDevelopmentInputSidecarCommitRequiredForStage1, false);
  assert.equal(output.runnerPrecondition.developmentInputAndSidecarCommittedCleanRequiredBeforeStage2Replay, true);
  assert.equal(output.runnerPrecondition.selectionManifestCommittedCleanRequiredBeforeStage2Replay, true);
  assert.equal(output.runnerPrecondition.generatedArtifactCurrentlyIgnoredAndUntracked, true);
  assert.equal(output.runnerPrecondition.stageExecutionAuthorizedByGeneration, false);
  assert.equal(Object.hasOwn(output.runnerPrecondition, 'gitCommittedInputRequired'), false);
  assert.equal(output.licensingBoundary.cmbitmSolePrimaryNoSplice, true);
  assert.equal(output.licensingBoundary.cmbitmExecutable, false);
  assert.equal(output.licensingBoundary.proxyDataCannotSatisfyOriginalLicensedExecutableSourceGate, true);
  for (const key of ['signal', 'strategyReturn', 'target', 'metric', 'gate', 'terminalWealth', 'sharpe', 'turnover', 'nav', 'results']) {
    assert.throws(() => v1.assertDataOnly({ nested: { [key]: 1 } }), /forbidden non-data field/);
  }
});

test('writer creates only development bytes plus an adjacent digest and rejects later-stage paths even under test injection', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'universal-proxy-v2-splitter-'));
  const output = path.join(directory, 'development-input-v2.json');
  const payload = { schema: splitter.OUTPUT_SCHEMA, status: splitter.OUTPUT_STATUS, stage: 'development' };
  const written = splitter.writeDevelopmentInput(payload, { output, enforceDefaultPath: false });
  assert.deepEqual(fs.readdirSync(directory).sort(), ['development-input-v2.json', 'development-input-v2.json.sha256']);
  const bytes = fs.readFileSync(output);
  assert.equal(written.sha256, v1.sha256(bytes));
  assert.equal(fs.readFileSync(`${output}.sha256`, 'utf8'), `${written.sha256}  development-input-v2.json\n`);

  for (const stage of ['validation', 'evaluation']) {
    const forbidden = path.join(directory, stage, 'input.json');
    assert.throws(
      () => splitter.writeDevelopmentInput(payload, { output: forbidden, enforceDefaultPath: false }),
      /later-stage output paths are forbidden/,
    );
    assert.equal(fs.existsSync(forbidden), false);
  }
  assert.throws(() => splitter.assertDefaultDevelopmentOutput(output), /only the frozen v2 development proxy input path/);
});
