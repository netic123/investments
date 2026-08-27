'use strict';

// Deterministic data-only adapter for the frozen v2 universal-volatility proxy
// falsification study. It reuses the already reviewed v1 calendar/row-role
// primitives and contains no candidate, signal, target, portfolio, performance,
// metric, gate, or stage-outcome calculation. The command accepts no selector
// and can create only the physically separated development data file plus its
// adjacent SHA-256 receipt.

const fs = require('node:fs');
const path = require('node:path');

const v1 = require('./universal_volatility_overlay_proxy_splitter');
const dataV2 = require('./five_market_proxy_data_v2');

const OUTPUT_SCHEMA = 'universal-vol-overlay-proxy-input-v2';
const OUTPUT_STATUS = 'RETROSPECTIVE_PROXY_DATA_ONLY_NOT_CONFIRMATORY';
const OUTPUT_STAGE = 'development';
const DEVELOPMENT_END = '2018-12-31';
const MARKET_ORDER = Object.freeze(['sweden', 'usa', 'europe', 'global']);

const PATHS = Object.freeze({
  normativeProtocol: path.join(__dirname, 'UNIVERSAL_VOLATILITY_OVERLAY_PROTOCOL.md'),
  proxyProtocol: path.join(__dirname, 'UNIVERSAL_VOLATILITY_OVERLAY_PROXY_FALSIFICATION_PROTOCOL_V2.md'),
  strictRunner: path.join(__dirname, 'universal_volatility_overlay.js'),
  strictRunnerTests: path.join(__dirname, '..', 'test', 'universal_volatility_overlay.test.js'),
  dataBuilder: path.join(__dirname, 'five_market_proxy_data_v2.js'),
  dataBuilderTests: path.join(__dirname, '..', 'test', 'five_market_proxy_data_v2.test.js'),
  calendarRoleSplitterV1: path.join(__dirname, 'universal_volatility_overlay_proxy_splitter.js'),
  calendarRoleSplitterV1Tests: path.join(__dirname, '..', 'test', 'universal_volatility_overlay_proxy_splitter.test.js'),
  manifest: path.join(__dirname, 'FIVE_MARKET_PROXY_DATA_FREEZE_V2_2026-08-24.json'),
  manifestSidecar: path.join(__dirname, 'FIVE_MARKET_PROXY_DATA_FREEZE_V2_2026-08-24.json.sha256'),
  parentInput: path.join(__dirname, 'local-artifacts', 'five-market-proxy-data-v2', 'five-market-proxy-input-v2-2026-08-24.json'),
  parentInputSidecar: path.join(__dirname, 'local-artifacts', 'five-market-proxy-data-v2', 'five-market-proxy-input-v2-2026-08-24.json.sha256'),
  output: path.join(__dirname, 'local-artifacts', 'universal-volatility-overlay-proxy-v2', 'development-input-v2-2026-08-24.json'),
});

const EXPECTED = Object.freeze({
  normativeProtocol: '601bb020265d593d057bccc259854871e032a025bd708412eba878d8ab0d9406',
  proxyProtocol: 'd8756e157ab0e6ce8374fbc944cf1a7d89866d2f1b7b88bbcc7dce9bbcd1b6c7',
  strictRunner: '22d9cb26505cc62dfd7b27ea94f5ecc295c2d4bcc0e432534d27567464ecfe1b',
  strictRunnerTests: '0b6ce991bfe039566c651f3cd7aa32effb43be395eb39d1e6e95d8c02de38aa1',
  dataBuilder: 'f06d62546b7a9b4405ae47fdc3c703ba550a3ad4e1ef0270ebd5b805aa24cc83',
  dataBuilderTests: 'ab45176102bd28064aea1a1df09d7c453fbd02de88ac7e946657dea53742fd42',
  calendarRoleSplitterV1: 'ca5de9e90e9faecf6bf85e0d7f245b9ba0f350f20711df24de599d1d6fadb874',
  calendarRoleSplitterV1Tests: 'ec9b79f92b0adb61c2b5895778c9cbe106db156ab2d8a56c5aa57e88ff0415ba',
  manifest: '1e64de19073b05aacc599083edff050eddd5a710be792212d1d0bcd8ccc0159e',
  manifestSidecar: '3d84a806621cb78052ba6ed99456d6c242d62df3236ace8bffa0fa04e3ea84ee',
  parentInput: 'a85ffc681b4911fdd6d65a2e091301985937f7ffa05aac41f1642209eda95247',
  parentInputSidecar: '826acb0de5756dde835ac1cce583eb9c7631bd7ae2ee10ce877a220c456316c4',
});

const EXPECTED_DEVELOPMENT = Object.freeze({
  cash: Object.freeze({
    firstDate: '1996-03-18', lastDate: DEVELOPMENT_END, rowCount: 8324,
    rowsSha256: '6fbca98c2cfa7bfd8b47d5417c89684c800dad7ee1b4650234138239dd88d3c8',
  }),
  sweden: Object.freeze({
    ticker: 'EWD', firstDate: '1996-03-18', lastDate: DEVELOPMENT_END, rowCount: 5737,
    rowsSha256: '078638b1af531f13207ef19d26faed27ca76822df5f67893e300b3759aa5f1f9',
    rowRolesSha256: '752fa469f9f1ab2ab0ba06f14cfb464955560cca166d7cc4f8d9bfc71b0c09dd',
    warmupFirstMonth: '1996-04', warmupLastMonth: '1997-03', firstSignalFormationMonth: '1997-04',
    formationLastRowDate: '1997-04-30', stageBoundaryAnchorDate: '1997-05-01', firstEligibleIntervalEndDate: '1997-05-02',
  }),
  usa: Object.freeze({
    ticker: 'IYY', firstDate: '2000-06-16', lastDate: DEVELOPMENT_END, rowCount: 4664,
    rowsSha256: '69a31a21292cfc02bc85c7a3dce78f96b727e3ca754f22d0394053bc494c8023',
    rowRolesSha256: '9b2ac795387c6455faf99381b702ba056990e51843df865e7116a50f47eaaed9',
    warmupFirstMonth: '2000-07', warmupLastMonth: '2001-06', firstSignalFormationMonth: '2001-07',
    formationLastRowDate: '2001-07-31', stageBoundaryAnchorDate: '2001-08-01', firstEligibleIntervalEndDate: '2001-08-02',
  }),
  europe: Object.freeze({
    ticker: 'IEV', firstDate: '2000-07-28', lastDate: DEVELOPMENT_END, rowCount: 4635,
    rowsSha256: 'f8147e4e26f3b9f086ddf1f052d008deb12fa6695d727d2003b8de1f520108ed',
    rowRolesSha256: 'bbac7918e7cf31e42c17cef89de7b4c2f01c58d9cbac69b774a041b80c39e3ff',
    warmupFirstMonth: '2000-08', warmupLastMonth: '2001-07', firstSignalFormationMonth: '2001-08',
    formationLastRowDate: '2001-08-31', stageBoundaryAnchorDate: '2001-09-04', firstEligibleIntervalEndDate: '2001-09-05',
  }),
  global: Object.freeze({
    ticker: 'ACWI', firstDate: '2008-03-28', lastDate: DEVELOPMENT_END, rowCount: 2710,
    rowsSha256: '27aedab9db78998299d231c6ce6830658bac3eece6861965ac1122d928e767d6',
    rowRolesSha256: 'ee48beb51a4beb8a559e1ec52957e48ce40a983cab80c7f8f756ba0dc86e70d6',
    warmupFirstMonth: '2008-04', warmupLastMonth: '2009-03', firstSignalFormationMonth: '2009-04',
    formationLastRowDate: '2009-04-30', stageBoundaryAnchorDate: '2009-05-01', firstEligibleIntervalEndDate: '2009-05-04',
  }),
});

const IntegrityError = v1.IntegrityError;

function fail(message, details = {}) {
  throw new IntegrityError(message, details);
}

function assertEqual(actual, expected, context) {
  if (actual !== expected) fail(`${context} mismatch`, { expected, actual });
}

function assertJsonEqual(actual, expected, context) {
  const actualJson = v1.stableJson(actual, 0);
  const expectedJson = v1.stableJson(expected, 0);
  if (actualJson !== expectedJson) fail(`${context} mismatch`);
}

function artifactReceipt(artifact) {
  return { path: artifact.path, sha256: artifact.sha256, bytes: artifact.bytes.length };
}

function readExact(file, expectedSha256, io, accessLog) {
  return v1.readExactBytes(file, expectedSha256, io, accessLog);
}

function verifyProtocol(artifact, markerPattern, expectedMarker, context) {
  const match = markerPattern.exec(artifact.bytes.toString('utf8'));
  assertEqual(match && match[1], expectedMarker, `${context} freeze marker`);
  return { path: artifact.path, sha256: artifact.sha256, marker: expectedMarker };
}

function verifyFrozenManifest(manifest, input, receipts, rebuiltInput) {
  assertEqual(manifest.schema, dataV2.FREEZE_MANIFEST_SCHEMA, 'manifest schema');
  assertEqual(manifest.status, OUTPUT_STATUS, 'manifest status');
  assertEqual(manifest.version, 2, 'manifest version');
  assertEqual(manifest.asOfDate, dataV2.AS_OF_DATE, 'manifest as-of date');
  assertEqual(manifest.containsStrategyOutcomes, false, 'manifest containsStrategyOutcomes');
  assertEqual(manifest.v1Status, 'SUPERSEDED_BEFORE_ANY_UNIVERSAL_VOLATILITY_PROXY_OUTCOME', 'manifest v1 status');
  assertEqual(manifest.input.path, receipts.parentInput.path, 'manifest input path');
  assertEqual(manifest.input.fileSha256, receipts.parentInput.sha256, 'manifest input SHA-256');
  assertEqual(manifest.input.bytes, receipts.parentInput.bytes.length, 'manifest input bytes');
  assertEqual(manifest.input.adjacentSha256Path, receipts.parentInputSidecar.path, 'manifest input sidecar path');
  assertEqual(input.cash.source.maximumObservationStalenessCalendarDays, 7, 'cash maximum staleness');
  assertEqual(input.cash.source.informationLagRule, 'STRICTLY_PRIOR_OBSERVATION_DATE_FOR_EACH_ACCRUAL_START_DATE', 'cash causal observation rule');

  const rebuiltManifest = dataV2.freezeManifest(rebuiltInput, {
    absolutePath: PATHS.parentInput,
    bytes: receipts.parentInput.bytes.length,
    sha256: receipts.parentInput.sha256,
  });
  assertJsonEqual(manifest, rebuiltManifest, 'independently rebuilt v2 manifest');
  return rebuiltManifest;
}

function loadAndVerifyFrozenArtifacts({ io = fs, accessLog = null, loadSourceGraph = dataV2.loadFrozenArtifacts } = {}) {
  // The normative protocol is always the first opened file; no data or later
  // stage path is touched before the governing frozen bytes are checked.
  const normative = readExact(PATHS.normativeProtocol, EXPECTED.normativeProtocol, io, accessLog);
  const normativeReceipt = verifyProtocol(
    normative,
    /UNIVERSAL_VOL_OVERLAY_FREEZE_MARKER:\s*([^\s]+)\s*-->/,
    'FROZEN_UNIVERSAL_VOL_OVERLAY_V1',
    'normative protocol',
  );
  const proxy = readExact(PATHS.proxyProtocol, EXPECTED.proxyProtocol, io, accessLog);
  const proxyReceipt = verifyProtocol(
    proxy,
    /UNIVERSAL_VOL_PROXY_FALSIFICATION_FREEZE_MARKER:\s*([^\s]+)\s*-->/,
    'FROZEN_UNIVERSAL_VOL_PROXY_FALSIFICATION_V2',
    'v2 proxy protocol',
  );
  const proxyText = proxy.bytes.toString('utf8');
  for (const digest of [EXPECTED.normativeProtocol, EXPECTED.strictRunner, EXPECTED.strictRunnerTests]) {
    if (!proxyText.includes(digest)) fail(`v2 proxy protocol does not embed required identity ${digest}`);
  }

  const strictRunner = readExact(PATHS.strictRunner, EXPECTED.strictRunner, io, accessLog);
  const strictRunnerTests = readExact(PATHS.strictRunnerTests, EXPECTED.strictRunnerTests, io, accessLog);
  const dataBuilder = readExact(PATHS.dataBuilder, EXPECTED.dataBuilder, io, accessLog);
  const dataBuilderTests = readExact(PATHS.dataBuilderTests, EXPECTED.dataBuilderTests, io, accessLog);
  const calendarRoleSplitterV1 = readExact(PATHS.calendarRoleSplitterV1, EXPECTED.calendarRoleSplitterV1, io, accessLog);
  const calendarRoleSplitterV1Tests = readExact(PATHS.calendarRoleSplitterV1Tests, EXPECTED.calendarRoleSplitterV1Tests, io, accessLog);

  const manifestSidecar = readExact(PATHS.manifestSidecar, EXPECTED.manifestSidecar, io, accessLog);
  v1.verifySidecar(manifestSidecar, EXPECTED.manifest, path.basename(PATHS.manifest));
  const manifestArtifact = readExact(PATHS.manifest, EXPECTED.manifest, io, accessLog);
  const manifest = v1.parseJsonBytes(manifestArtifact, 'v2 data-freeze manifest');

  const parentInputSidecar = readExact(PATHS.parentInputSidecar, EXPECTED.parentInputSidecar, io, accessLog);
  v1.verifySidecar(parentInputSidecar, EXPECTED.parentInput, path.basename(PATHS.parentInput));
  const parentInputArtifact = readExact(PATHS.parentInput, EXPECTED.parentInput, io, accessLog);
  const input = dataV2.validateInput(v1.parseJsonBytes(parentInputArtifact, 'normalized v2 parent input'));

  // Rebuild from the separately frozen FRED bytes and the exact reused v1
  // risky/robustness bytes. The v2 builder performs its own source/sidecar hash
  // checks and does not access the network.
  const loadedSources = loadSourceGraph();
  const rebuiltInput = dataV2.validateInput(dataV2.buildInput(loadedSources));
  assertJsonEqual(input, rebuiltInput, 'independently rebuilt normalized v2 input');

  const receipts = {
    normative, proxy, strictRunner, strictRunnerTests, dataBuilder,
    dataBuilderTests, calendarRoleSplitterV1, calendarRoleSplitterV1Tests,
    manifest: manifestArtifact, manifestSidecar,
    parentInput: parentInputArtifact, parentInputSidecar,
  };
  verifyFrozenManifest(manifest, input, receipts, rebuiltInput);

  const cryptoMarket = input.markets.find(item => item.key === 'crypto');
  if (!cryptoMarket || cryptoMarket.primary.ticker !== 'CMBITM' || cryptoMarket.primary.executable !== false) {
    fail('v2 licensing boundary requires sole non-executable CMBITM primary crypto series');
  }

  return {
    input,
    manifest,
    loadedSources,
    receipts,
    protocols: { normative: normativeReceipt, proxy: proxyReceipt },
    codeIdentities: {
      strictRunner: artifactReceipt(strictRunner),
      strictRunnerTests: artifactReceipt(strictRunnerTests),
      dataBuilder: artifactReceipt(dataBuilder),
      dataBuilderTests: artifactReceipt(dataBuilderTests),
      calendarRoleSplitterV1: artifactReceipt(calendarRoleSplitterV1),
      calendarRoleSplitterV1Tests: artifactReceipt(calendarRoleSplitterV1Tests),
    },
  };
}

function assertExpectedDevelopmentBoundary(output) {
  assertEqual(output.cash.stageHistory.firstDate, EXPECTED_DEVELOPMENT.cash.firstDate, 'cash development first date');
  assertEqual(output.cash.stageHistory.lastDate, EXPECTED_DEVELOPMENT.cash.lastDate, 'cash development last date');
  assertEqual(output.cash.stageHistory.rowCount, EXPECTED_DEVELOPMENT.cash.rowCount, 'cash development row count');
  assertEqual(output.cash.stageHistory.rowsSha256, EXPECTED_DEVELOPMENT.cash.rowsSha256, 'cash development rows SHA-256');

  assertJsonEqual(output.markets.map(item => item.key), MARKET_ORDER, 'development market order');
  for (const market of output.markets) {
    const expected = EXPECTED_DEVELOPMENT[market.key];
    if (!expected) fail(`unexpected development market ${market.key}`);
    for (const key of ['ticker']) assertEqual(market[key], expected[key], `${market.key} ${key}`);
    for (const key of ['firstDate', 'lastDate', 'rowCount', 'rowsSha256']) {
      assertEqual(market.stageHistory[key], expected[key], `${market.key} stageHistory.${key}`);
    }
    assertEqual(market.rowRolesSha256, expected.rowRolesSha256, `${market.key} rowRolesSha256`);
    for (const key of [
      'warmupFirstMonth', 'warmupLastMonth', 'firstSignalFormationMonth',
      'formationLastRowDate', 'stageBoundaryAnchorDate', 'firstEligibleIntervalEndDate',
    ]) assertEqual(market.calendarInventory[key], expected[key], `${market.key} calendarInventory.${key}`);
  }
  return output;
}

function buildDevelopmentInput(verified) {
  const primary = new Map(verified.input.markets.map(item => [item.key, item.primary]));
  const markets = MARKET_ORDER.map(key => v1.buildDevelopmentMarket(primary.get(key), verified.input.cash.rows));
  const cash = v1.buildDevelopmentCash(verified.input.cash, markets);
  const output = {
    schema: OUTPUT_SCHEMA,
    status: OUTPUT_STATUS,
    stage: OUTPUT_STAGE,
    containsStrategyOutcomes: false,
    purpose: 'Physically separate deterministic v2 Stage-1 proxy data only; not confirmatory, executable, deployable, or an outcome.',
    deterministicBuild: {
      currentClockUsed: false,
      networkAccess: false,
      commandAcceptsStageSelection: false,
      reusedCalendarRoleImplementation: 'research/universal_volatility_overlay_proxy_splitter.js',
      serialization: 'recursively lexicographically sorted object keys; arrays preserved; LF newline',
    },
    protocols: verified.protocols,
    codeIdentities: verified.codeIdentities,
    runnerPrecondition: {
      applicableCodeProtocolTestsCommittedCleanRequiredBeforeStage1: true,
      currentDevelopmentInputCommitRequiredForStage1: false,
      currentDevelopmentInputSidecarCommitRequiredForStage1: false,
      developmentInputAndSidecarCommittedCleanRequiredBeforeStage2Replay: true,
      selectionManifestCommittedCleanRequiredBeforeStage2Replay: true,
      generatedArtifactCurrentlyIgnoredAndUntracked: true,
      stageExecutionAuthorizedByGeneration: false,
    },
    licensingBoundary: {
      underlyingSourceTermsStillApply: true,
      cmbitmSolePrimaryNoSplice: true,
      cmbitmExecutable: false,
      proxyDataCannotSatisfyOriginalLicensedExecutableSourceGate: true,
      permittedInference: 'negative_proxy_result_may_falsify; numerical_success_only_advances_to_separately_licensed_executable_prospective_validation',
    },
    parent: {
      normalizedInput: {
        path: verified.receipts.parentInput.path,
        sha256: verified.receipts.parentInput.sha256,
        bytes: verified.receipts.parentInput.bytes.length,
        sidecarPath: verified.receipts.parentInputSidecar.path,
        sidecarSha256: verified.receipts.parentInputSidecar.sha256,
      },
      dataFreezeManifest: {
        path: verified.receipts.manifest.path,
        sha256: verified.receipts.manifest.sha256,
        bytes: verified.receipts.manifest.bytes.length,
        sidecarPath: verified.receipts.manifestSidecar.path,
        sidecarSha256: verified.receipts.manifestSidecar.sha256,
      },
      verifiedSourceArtifacts: verified.manifest.sourceArtifacts.map(item => ({
        role: item.role,
        path: item.path,
        sha256: item.fileSha256,
        bytes: item.bytes,
        ...(item.sidecarPath ? { sidecarPath: item.sidecarPath, sidecarSha256: item.sidecarSha256 } : {}),
      })),
    },
    boundary: {
      returnIntervalEndInclusive: DEVELOPMENT_END,
      returnIntervalStart: 'data_determined_after_each_markets_twelve_month_anchor_warmup_and_completed_formation_month',
      marketOrder: [...MARKET_ORDER],
      marketCalendarPolicy: 'each_market_own_completed_close_calendar_no_strict_common_calendar',
      cryptoIncluded: false,
      boundaryCrossingReturnInterval: 'forbidden',
      laterStageDataIncluded: false,
      validationOrEvaluationArtifactOpenedOrCreated: false,
    },
    markets,
    cash,
  };
  return assertExpectedDevelopmentBoundary(v1.assertDataOnly(output));
}

function assertNotLaterStageOutput(file) {
  const resolved = path.resolve(file);
  if (/(^|[\\/])(validation|evaluation)([\\/]|$)/i.test(resolved)) fail('later-stage output paths are forbidden');
  return resolved;
}

function assertDefaultDevelopmentOutput(file) {
  const resolved = assertNotLaterStageOutput(file);
  if (resolved !== path.resolve(PATHS.output)) fail('the command may write only the frozen v2 development proxy input path');
  return resolved;
}

function writeDevelopmentInput(value, { io = fs, output = PATHS.output, enforceDefaultPath = true } = {}) {
  const resolved = enforceDefaultPath ? assertDefaultDevelopmentOutput(output) : assertNotLaterStageOutput(output);
  const bytes = Buffer.from(v1.stableJson(value));
  io.mkdirSync(path.dirname(resolved), { recursive: true });
  io.writeFileSync(resolved, bytes);
  const digest = v1.sha256(bytes);
  io.writeFileSync(`${resolved}.sha256`, `${digest}  ${path.basename(resolved)}\n`);
  const displayedPath = enforceDefaultPath ? v1.repoPath(resolved) : resolved.replace(/\\/g, '/');
  return { path: displayedPath, absolutePath: resolved, bytes: bytes.length, sha256: digest, sidecarPath: `${displayedPath}.sha256` };
}

function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 0) fail('v2 development splitter accepts no arguments or stage selector');
  return { stage: OUTPUT_STAGE, output: PATHS.output };
}

function main(argv = process.argv.slice(2), dependencies = {}) {
  parseArgs(argv); // Every alternative is rejected before any file is opened.
  const verified = loadAndVerifyFrozenArtifacts(dependencies);
  const output = buildDevelopmentInput(verified);
  const written = writeDevelopmentInput(output, { io: dependencies.io || fs });
  process.stdout.write(`${JSON.stringify({
    schema: output.schema,
    status: output.status,
    stage: output.stage,
    outputPath: written.path,
    outputSha256: written.sha256,
    bytes: written.bytes,
    markets: output.markets.map(item => ({
      key: item.key,
      firstDate: item.stageHistory.firstDate,
      lastDate: item.stageHistory.lastDate,
      rowCount: item.stageHistory.rowCount,
      rowsSha256: item.stageHistory.rowsSha256,
      rowRolesSha256: item.rowRolesSha256,
      warmupFirstMonth: item.calendarInventory.warmupFirstMonth,
      warmupLastMonth: item.calendarInventory.warmupLastMonth,
      firstSignalFormationMonth: item.calendarInventory.firstSignalFormationMonth,
      stageBoundaryAnchorDate: item.calendarInventory.stageBoundaryAnchorDate,
      firstEligibleIntervalEndDate: item.calendarInventory.firstEligibleIntervalEndDate,
    })),
    cash: output.cash.stageHistory,
  }, null, 2)}\n`);
  return { output, written };
}

module.exports = {
  OUTPUT_SCHEMA, OUTPUT_STATUS, OUTPUT_STAGE, DEVELOPMENT_END, MARKET_ORDER,
  PATHS, EXPECTED, EXPECTED_DEVELOPMENT, IntegrityError, fail, assertEqual,
  assertJsonEqual, artifactReceipt, readExact, verifyProtocol, verifyFrozenManifest,
  loadAndVerifyFrozenArtifacts, assertExpectedDevelopmentBoundary,
  buildDevelopmentInput, assertNotLaterStageOutput, assertDefaultDevelopmentOutput, writeDevelopmentInput,
  parseArgs, main,
};

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: error && error.code === 'INTEGRITY_ERROR' ? 'INTEGRITY_ERROR' : 'ERROR',
      message: error && error.message,
      details: error && error.details || {},
    }, null, 2)}\n`);
    process.exitCode = error && error.code === 'INTEGRITY_ERROR' ? 2 : 1;
  }
}
