'use strict';

// Frozen-v2, development-only retrospective proxy-falsification runner.
//
// This file deliberately has no downloader and no validation/evaluation
// command. The production command is sealed until every applicable protocol,
// runner, splitter, and synthetic-test file is committed and clean. Only then
// may it open the one exact Stage-1 input and its adjacent SHA-256 sidecar.

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const core = require('./universal_volatility_overlay');

const REPO_ROOT = path.resolve(__dirname, '..');
const INPUT_SCHEMA = 'universal-vol-overlay-proxy-input-v2';
const INPUT_STATUS = 'RETROSPECTIVE_PROXY_DATA_ONLY_NOT_CONFIRMATORY';
const RESULT_SCHEMA = 'universal-vol-overlay-proxy-development-result-v2';
const STAGE = 'development';
const POSITIVE_STATUS = 'PROXY_DEVELOPMENT_ELIGIBLE';
const POSITIVE_OUTCOME_LABEL = 'DEVELOPMENT_CANDIDATE_ONLY';
const NEGATIVE_STATUS = 'NO_UNIVERSAL_CANDIDATE_PROXY_FALSIFIED';
const PROTOCOL_MARKER = 'FROZEN_UNIVERSAL_VOL_PROXY_FALSIFICATION_V2';
const FINAL_COMPLETED_DATE = '2018-12-31';
const COUNTERFACTUAL_MAXIMUM_TARGET = 1.5;
const MARKET_ORDER = Object.freeze(['sweden', 'usa', 'europe', 'global']);
const RESULT_TEST_PATH = path.join(__dirname, '..', 'test', 'universal_volatility_overlay_proxy_v2.test.js');

const PATHS = Object.freeze({
  normativeProtocol: path.join(__dirname, 'UNIVERSAL_VOLATILITY_OVERLAY_PROTOCOL.md'),
  proxyProtocolV1: path.join(__dirname, 'UNIVERSAL_VOLATILITY_OVERLAY_PROXY_FALSIFICATION_PROTOCOL.md'),
  proxyProtocolV2: path.join(__dirname, 'UNIVERSAL_VOLATILITY_OVERLAY_PROXY_FALSIFICATION_PROTOCOL_V2.md'),
  strictRunner: path.join(__dirname, 'universal_volatility_overlay.js'),
  strictRunnerTests: path.join(__dirname, '..', 'test', 'universal_volatility_overlay.test.js'),
  baseDataBuilder: path.join(__dirname, 'five_market_proxy_data.js'),
  baseDataBuilderTests: path.join(__dirname, '..', 'test', 'five_market_proxy_data.test.js'),
  dataBuilder: path.join(__dirname, 'five_market_proxy_data_v2.js'),
  dataBuilderTests: path.join(__dirname, '..', 'test', 'five_market_proxy_data_v2.test.js'),
  calendarRoleSplitterV1: path.join(__dirname, 'universal_volatility_overlay_proxy_splitter.js'),
  calendarRoleSplitterV1Tests: path.join(__dirname, '..', 'test', 'universal_volatility_overlay_proxy_splitter.test.js'),
  splitterV2: path.join(__dirname, 'universal_volatility_overlay_proxy_splitter_v2.js'),
  splitterV2Tests: path.join(__dirname, '..', 'test', 'universal_volatility_overlay_proxy_splitter_v2.test.js'),
  dataFreezeManifest: path.join(__dirname, 'FIVE_MARKET_PROXY_DATA_FREEZE_V2_2026-08-24.json'),
  dataFreezeManifestSidecar: path.join(__dirname, 'FIVE_MARKET_PROXY_DATA_FREEZE_V2_2026-08-24.json.sha256'),
  runner: __filename,
  runnerTests: RESULT_TEST_PATH,
  developmentInput: path.join(__dirname, 'local-artifacts', 'universal-volatility-overlay-proxy-v2', 'development-input-v2-2026-08-24.json'),
  developmentResult: path.join(__dirname, 'local-artifacts', 'universal-volatility-overlay-proxy-v2', 'development-result-v2-2026-08-25.json'),
});

const PRODUCTION_CODE_FREEZE_PATHS = Object.freeze([
  PATHS.normativeProtocol,
  PATHS.proxyProtocolV1,
  PATHS.proxyProtocolV2,
  PATHS.strictRunner,
  PATHS.strictRunnerTests,
  PATHS.baseDataBuilder,
  PATHS.baseDataBuilderTests,
  PATHS.dataBuilder,
  PATHS.dataBuilderTests,
  PATHS.calendarRoleSplitterV1,
  PATHS.calendarRoleSplitterV1Tests,
  PATHS.splitterV2,
  PATHS.splitterV2Tests,
  PATHS.dataFreezeManifest,
  PATHS.dataFreezeManifestSidecar,
  PATHS.runner,
  PATHS.runnerTests,
]);

const EXPECTED = Object.freeze({
  normativeProtocol: '601bb020265d593d057bccc259854871e032a025bd708412eba878d8ab0d9406',
  proxyProtocolV1: 'fe1088f197388fb5edfd6cdbb96f3c037d0567d9aabda6a9c72d5f656972be13',
  proxyProtocolV2: 'd8756e157ab0e6ce8374fbc944cf1a7d89866d2f1b7b88bbcc7dce9bbcd1b6c7',
  strictRunner: '22d9cb26505cc62dfd7b27ea94f5ecc295c2d4bcc0e432534d27567464ecfe1b',
  strictRunnerTests: '0b6ce991bfe039566c651f3cd7aa32effb43be395eb39d1e6e95d8c02de38aa1',
  baseDataBuilder: 'b03f0c8842127ce8250365999701bc7e5279b84deb6c15eb90689ceb2411d502',
  baseDataBuilderTests: '4c8305dd24abb5f002d9da41ba9c649797013f55ebaeadb533a43845dcdd3786',
  dataBuilder: 'f06d62546b7a9b4405ae47fdc3c703ba550a3ad4e1ef0270ebd5b805aa24cc83',
  dataBuilderTests: 'ab45176102bd28064aea1a1df09d7c453fbd02de88ac7e946657dea53742fd42',
  calendarRoleSplitterV1: 'ca5de9e90e9faecf6bf85e0d7f245b9ba0f350f20711df24de599d1d6fadb874',
  calendarRoleSplitterV1Tests: 'ec9b79f92b0adb61c2b5895778c9cbe106db156ab2d8a56c5aa57e88ff0415ba',
  splitterV2: '202ad468edeed7ae8f651d3ef30b2465b977ea4a6c09b5e3d8167386ba338c8a',
  splitterV2Tests: '9ba2ac639aee42290c3b036808d17eaa634ba8978f46b7f13f740c376183f464',
  normalizedParentInput: 'a85ffc681b4911fdd6d65a2e091301985937f7ffa05aac41f1642209eda95247',
  normalizedParentInputSidecar: '826acb0de5756dde835ac1cce583eb9c7631bd7ae2ee10ce877a220c456316c4',
  dataFreezeManifest: '1e64de19073b05aacc599083edff050eddd5a710be792212d1d0bcd8ccc0159e',
  dataFreezeManifestSidecar: '3d84a806621cb78052ba6ed99456d6c242d62df3236ace8bffa0fa04e3ea84ee',
  developmentInput: '67e176b5c7ba4d1123b2b1cdf4325edad5af0d5e5e98782cbe88f3f0457dc89f',
  developmentInputSidecarBytes: '1cdd49e7ad4f5ae1cd526f47705e8802fd6b3dd46b285a4e6cbf004c380e6c43',
});

const CODE_IDENTITIES = Object.freeze({
  strictRunner: Object.freeze({ path: 'research/universal_volatility_overlay.js', sha256: EXPECTED.strictRunner, bytes: 149645 }),
  strictRunnerTests: Object.freeze({ path: 'test/universal_volatility_overlay.test.js', sha256: EXPECTED.strictRunnerTests, bytes: 60101 }),
  dataBuilder: Object.freeze({ path: 'research/five_market_proxy_data_v2.js', sha256: EXPECTED.dataBuilder, bytes: 19240 }),
  dataBuilderTests: Object.freeze({ path: 'test/five_market_proxy_data_v2.test.js', sha256: EXPECTED.dataBuilderTests, bytes: 7469 }),
  calendarRoleSplitterV1: Object.freeze({ path: 'research/universal_volatility_overlay_proxy_splitter.js', sha256: EXPECTED.calendarRoleSplitterV1, bytes: 41403 }),
  calendarRoleSplitterV1Tests: Object.freeze({ path: 'test/universal_volatility_overlay_proxy_splitter.test.js', sha256: EXPECTED.calendarRoleSplitterV1Tests, bytes: 13594 }),
});

const FULL_SERIES = Object.freeze({
  sweden: Object.freeze({
    ticker: 'EWD', firstDate: '1996-03-18', lastDate: '2026-08-24', rowCount: 7658,
    normalizedRowsSha256: '2580ba27aa7d31a1f2d6f41a986092f00461f09f71326472748042421206223e',
    rawPayloadSha256: '0127d2948dfe4a79753c9b5280a390d25e9d13f6dd27fb5f444cde16791eed2b',
  }),
  usa: Object.freeze({
    ticker: 'IYY', firstDate: '2000-06-16', lastDate: '2026-08-24', rowCount: 6585,
    normalizedRowsSha256: '108dcfd1c3b5f05bd71ccf4b16e7008ca4c369113bfe10ce92a590a202d8d3bc',
    rawPayloadSha256: '0c881ef398ac8f34fda4976063fd912a60b3ea073f3fe1125fa768686555ad92',
  }),
  europe: Object.freeze({
    ticker: 'IEV', firstDate: '2000-07-28', lastDate: '2026-08-24', rowCount: 6556,
    normalizedRowsSha256: '8b61a4eb0acfea35c0a54d8426280c484a19e3f6458693dd8d974bce54ec7d25',
    rawPayloadSha256: '1cd419d89766efbaca5b903523cd80b38f5e4c57a1ef50ed26804875dbd4950f',
  }),
  global: Object.freeze({
    ticker: 'ACWI', firstDate: '2008-03-28', lastDate: '2026-08-24', rowCount: 4631,
    normalizedRowsSha256: '9307603c3c78b5fff46fd0563fb8395421e53beceb2faa153ef2f4c03b8491da',
    rawPayloadSha256: '94a61e38d1fcb1ee44d0870452d3f4cebfb014cc9b90cff9453cc6f732557761',
  }),
  cash: Object.freeze({
    ticker: 'DTB3-91D-ACCRUAL-V2', firstDate: '1995-01-04', lastDate: '2026-08-24', rowCount: 11556,
    normalizedRowsSha256: '3aff9a603124d5ee195a544b785802e68b5245ffead03db9d081901e8b24ff4f',
    rawPayloadSha256: '55f7f224f84545a0a577353e7d4f1826025eb28424b51249eabb456396449fcd',
  }),
});

const DEVELOPMENT_SERIES = Object.freeze({
  cash: Object.freeze({ firstDate: '1996-03-18', lastDate: FINAL_COMPLETED_DATE, rowCount: 8324, rowsSha256: '6fbca98c2cfa7bfd8b47d5417c89684c800dad7ee1b4650234138239dd88d3c8' }),
  sweden: Object.freeze({
    firstDate: '1996-03-18', lastDate: FINAL_COMPLETED_DATE, rowCount: 5737,
    rowsSha256: '078638b1af531f13207ef19d26faed27ca76822df5f67893e300b3759aa5f1f9',
    rowRolesSha256: '752fa469f9f1ab2ab0ba06f14cfb464955560cca166d7cc4f8d9bfc71b0c09dd',
    warmupFirstMonth: '1996-04', warmupLastMonth: '1997-03', firstSignalFormationMonth: '1997-04',
    formationLastRowDate: '1997-04-30', stageBoundaryAnchorDate: '1997-05-01', firstEligibleIntervalEndDate: '1997-05-02',
  }),
  usa: Object.freeze({
    firstDate: '2000-06-16', lastDate: FINAL_COMPLETED_DATE, rowCount: 4664,
    rowsSha256: '69a31a21292cfc02bc85c7a3dce78f96b727e3ca754f22d0394053bc494c8023',
    rowRolesSha256: '9b2ac795387c6455faf99381b702ba056990e51843df865e7116a50f47eaaed9',
    warmupFirstMonth: '2000-07', warmupLastMonth: '2001-06', firstSignalFormationMonth: '2001-07',
    formationLastRowDate: '2001-07-31', stageBoundaryAnchorDate: '2001-08-01', firstEligibleIntervalEndDate: '2001-08-02',
  }),
  europe: Object.freeze({
    firstDate: '2000-07-28', lastDate: FINAL_COMPLETED_DATE, rowCount: 4635,
    rowsSha256: 'f8147e4e26f3b9f086ddf1f052d008deb12fa6695d727d2003b8de1f520108ed',
    rowRolesSha256: 'bbac7918e7cf31e42c17cef89de7b4c2f01c58d9cbac69b774a041b80c39e3ff',
    warmupFirstMonth: '2000-08', warmupLastMonth: '2001-07', firstSignalFormationMonth: '2001-08',
    formationLastRowDate: '2001-08-31', stageBoundaryAnchorDate: '2001-09-04', firstEligibleIntervalEndDate: '2001-09-05',
  }),
  global: Object.freeze({
    firstDate: '2008-03-28', lastDate: FINAL_COMPLETED_DATE, rowCount: 2710,
    rowsSha256: '27aedab9db78998299d231c6ce6830658bac3eece6861965ac1122d928e767d6',
    rowRolesSha256: 'ee48beb51a4beb8a559e1ec52957e48ce40a983cab80c7f8f756ba0dc86e70d6',
    warmupFirstMonth: '2008-04', warmupLastMonth: '2009-03', firstSignalFormationMonth: '2009-04',
    formationLastRowDate: '2009-04-30', stageBoundaryAnchorDate: '2009-05-01', firstEligibleIntervalEndDate: '2009-05-04',
  }),
});

const SOURCE_ARTIFACTS = Object.freeze([
  Object.freeze({ role: 'CMBITM_SCHEMA4_CACHE_ACTUAL_SOURCE', path: 'research/local-artifacts/final-frozen/inputs/fear-greed-model-search-input-2026-08-24T22-13-44Z.json', sha256: '9d42777cc8ad7de6394cb0045e24fa0b588c1e31915acadbc49af55842579b7c', hasSidecar: false }),
  Object.freeze({ role: 'PRIMARY_ETFS_FROZEN_CACHE_RISKY_ROWS_ONLY', path: 'research/local-artifacts/equity-rotation-panel/input-2026-08-24.json', sha256: '4a9b5cda4fcd78c30a5a0b346d17f483ea16aaa07ecb5cc9bf7795dff2a27b08', hasSidecar: false }),
  Object.freeze({ role: 'PREDECLARED_ROBUSTNESS_ETF_RAW_CACHE', path: 'research/local-artifacts/five-market-proxy-data/robustness-yahoo-2026-08-24.json', sha256: 'dc4e8a6cd9fdc14c5c0efc94eacdd0dcd5185e3c672b2f2e774330901d133bdc', hasSidecar: false }),
  Object.freeze({ role: 'DTB3_EXTENDED_OFFICIAL_RAW_CSV', path: 'research/local-artifacts/five-market-proxy-data-v2/fred-dtb3-1995-01-01-to-2026-08-24.csv', sha256: '55f7f224f84545a0a577353e7d4f1826025eb28424b51249eabb456396449fcd', hasSidecar: true, sidecarSha256: 'ce6397a8c6be720548ec039e8bccff24a889984fe6771bdc6a4c47dcd0048eef' }),
  Object.freeze({ role: 'DTB3_EXTENDED_SOURCE_RECEIPT', path: 'research/local-artifacts/five-market-proxy-data-v2/fred-dtb3-source-2026-08-24.json', sha256: 'f2816de5c736a806268faaeedd3634720038186c4bebf73b37104aecfde9f7ab', hasSidecar: true, sidecarSha256: '3a47772cfd38e409a284e78bf01283b8ad0b988a588c2994fa5748c09189ea09' }),
]);

const PRODUCTION_PROFILE = Object.freeze({
  syntheticOnly: false,
  fullSeries: FULL_SERIES,
  developmentSeries: DEVELOPMENT_SERIES,
});

const INPUT_EVIDENCE_TOKEN = Symbol('universal-vol-overlay-proxy-v2-input-evidence');
const SYNTHETIC_ANALYSIS_INJECTION_TOKEN = Symbol('universal-vol-overlay-proxy-v2-synthetic-analysis-injection');

class IntegrityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'IntegrityError';
    this.code = 'INTEGRITY_ERROR';
    this.details = details;
  }
}

function fail(message, details = {}) {
  throw new IntegrityError(message, details);
}

function sha256(value) {
  return core.sha256Buffer(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object') return value;
  if (!Object.isFrozen(value)) Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) fail('canonical JSON cannot contain a non-finite number');
  return value;
}

function compactCanonicalJson(value) {
  return `${JSON.stringify(canonicalize(value))}\n`;
}

function jsonSafe(value) {
  if (Array.isArray(value)) return value.map(jsonSafe);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, jsonSafe(child)]));
  if (value === Infinity) return 'Infinity';
  if (value === -Infinity) return '-Infinity';
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN';
  return value;
}

function assertEqual(actual, expected, context) {
  if (actual !== expected) fail(`${context} mismatch`, { expected, actual });
}

function assertCanonicalEqual(actual, expected, context) {
  const left = core.canonicalJson(jsonSafe(actual));
  const right = core.canonicalJson(jsonSafe(expected));
  if (left !== right) fail(`${context} does not match its deterministic replay`);
  return actual;
}

function assertExactKeys(value, expectedKeys, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${context} must be an object`);
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (actual.join('\u0000') !== expected.join('\u0000')) {
    const missing = expected.filter(key => !actual.includes(key));
    const unexpected = actual.filter(key => !expected.includes(key));
    fail(`${context} has a closed-schema key mismatch`, { missing, unexpected });
  }
  return value;
}

function assertBoolean(value, context) {
  if (typeof value !== 'boolean') fail(`${context} must be Boolean`);
}

function assertPositiveInteger(value, context) {
  if (!Number.isInteger(value) || value <= 0) fail(`${context} must be a positive integer`);
}

function assertSha256(value, context) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) fail(`${context} must be a lower-case SHA-256`);
}

function assertIsoUtc(value, context) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3,7})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    fail(`${context} must be an exact UTC timestamp`);
  }
  return value;
}

function receipt(rows, hashKey = 'rowsSha256') {
  if (!Array.isArray(rows) || !rows.length) fail('receipt rows must be non-empty');
  return {
    firstDate: rows[0].date,
    lastDate: rows.at(-1).date,
    rowCount: rows.length,
    [hashKey]: sha256(Buffer.from(compactCanonicalJson(rows))),
  };
}

function validateRows(rows, context) {
  if (!Array.isArray(rows) || rows.length < 2) fail(`${context} requires at least two rows`);
  let previous = null;
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    assertExactKeys(row, ['date', 'value'], `${context}[${index}]`);
    core.dateMilliseconds(row.date, `${context}[${index}].date`);
    if (previous != null && row.date <= previous) fail(`${context} must be strictly ordered and unique`);
    if (typeof row.value !== 'number' || !Number.isFinite(row.value) || !(row.value > 0)) fail(`${context}[${index}].value must be positive and finite`);
    previous = row.date;
  }
  return rows;
}

function assertReceipt(actual, expected, context, hashKey) {
  assertExactKeys(actual, ['firstDate', 'lastDate', 'rowCount', hashKey], context);
  for (const key of ['firstDate', 'lastDate', 'rowCount', hashKey]) assertEqual(actual[key], expected[key], `${context}.${key}`);
}

function validateNullableReceipt(value, context) {
  assertExactKeys(value, ['firstDate', 'lastDate', 'role', 'rowCount', 'rowsSha256'], context);
  if (typeof value.role !== 'string' || !value.role) fail(`${context}.role must be non-empty`);
  if (!Number.isInteger(value.rowCount) || value.rowCount < 0) fail(`${context}.rowCount must be non-negative`);
  assertSha256(value.rowsSha256, `${context}.rowsSha256`);
  if (value.rowCount === 0) {
    if (value.firstDate !== null || value.lastDate !== null) fail(`${context} empty receipt dates must be null`);
  } else {
    core.dateMilliseconds(value.firstDate, `${context}.firstDate`);
    core.dateMilliseconds(value.lastDate, `${context}.lastDate`);
  }
}

function monthKey(date) {
  core.dateMilliseconds(date);
  return date.slice(0, 7);
}

function nextMonth(month) {
  const [year, number] = month.split('-').map(Number);
  return new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
}

function validateProtocolReceipt(value, expected, context) {
  assertExactKeys(value, ['marker', 'path', 'sha256'], context);
  assertEqual(value.path, expected.path, `${context}.path`);
  assertEqual(value.sha256, expected.sha256, `${context}.sha256`);
  assertEqual(value.marker, expected.marker, `${context}.marker`);
}

function validateArtifactReceipt(value, expected, context) {
  assertExactKeys(value, ['bytes', 'path', 'sha256'], context);
  assertEqual(value.path, expected.path, `${context}.path`);
  assertEqual(value.sha256, expected.sha256, `${context}.sha256`);
  assertEqual(value.bytes, expected.bytes, `${context}.bytes`);
}

function validateParentReceipt(value, expected, context) {
  assertExactKeys(value, ['bytes', 'path', 'sha256', 'sidecarPath', 'sidecarSha256'], context);
  assertEqual(value.path, expected.path, `${context}.path`);
  assertEqual(value.sha256, expected.sha256, `${context}.sha256`);
  assertEqual(value.sidecarPath, `${expected.path}.sha256`, `${context}.sidecarPath`);
  assertEqual(value.sidecarSha256, expected.sidecarSha256, `${context}.sidecarSha256`);
  assertPositiveInteger(value.bytes, `${context}.bytes`);
}

function validateSourceArtifactReceipts(values) {
  if (!Array.isArray(values) || values.length !== SOURCE_ARTIFACTS.length) fail('parent.verifiedSourceArtifacts must contain exactly five frozen receipts');
  for (let index = 0; index < SOURCE_ARTIFACTS.length; index++) {
    const value = values[index];
    const expected = SOURCE_ARTIFACTS[index];
    const keys = ['bytes', 'path', 'role', 'sha256', ...(expected.hasSidecar ? ['sidecarPath', 'sidecarSha256'] : [])];
    assertExactKeys(value, keys, `parent.verifiedSourceArtifacts[${index}]`);
    for (const key of ['role', 'path', 'sha256']) assertEqual(value[key], expected[key], `parent.verifiedSourceArtifacts[${index}].${key}`);
    assertPositiveInteger(value.bytes, `parent.verifiedSourceArtifacts[${index}].bytes`);
    if (expected.hasSidecar) {
      assertEqual(value.sidecarPath, `${expected.path}.sha256`, `parent.verifiedSourceArtifacts[${index}].sidecarPath`);
      assertEqual(value.sidecarSha256, expected.sidecarSha256, `parent.verifiedSourceArtifacts[${index}].sidecarSha256`);
    }
  }
}

function validateCommonMarketMetadata(market, expected, context) {
  for (const [key, value] of Object.entries({
    key: context,
    ticker: expected.ticker,
    currency: 'USD',
    returnType: 'USD_ETF_ADJUSTED_CLOSE_TOTAL_RETURN_PROXY',
    executable: true,
    seriesLevelExecutable: false,
    underlyingInstrumentExecutable: true,
    primary: true,
    robustnessOnly: false,
    priceField: 'Yahoo adjusted close',
  })) assertEqual(market[key], value, `${context}.${key}`);
  assertEqual(market.executableMeaning, 'True means the underlying listed ETF is tradeable; adjusted-close values are retrospective wealth levels, not executable fill prices.', `${context}.executableMeaning`);
  assertEqual(market.methodology, 'Current-vintage Yahoo adjusted close, adjusted for applicable splits and dividend distributions; USD ETF market-price total-return proxy after fund expenses but before investor trading costs and taxes.', `${context}.methodology`);
  assertEqual(market.pointInTimeStatus, 'Actual live fund history with evolving benchmark membership; Yahoo corporate-action history is current-vintage and can be revised.', `${context}.pointInTimeStatus`);
  if (typeof market.market !== 'string' || !market.market || typeof market.name !== 'string' || !market.name || typeof market.identityCaveat !== 'string' || !market.identityCaveat) fail(`${context} identity text is incomplete`);

  assertExactKeys(market.officialIdentity, ['benchmark', 'checkedAt', 'inception', 'url'], `${context}.officialIdentity`);
  assertEqual(market.officialIdentity.checkedAt, '2026-08-25', `${context}.officialIdentity.checkedAt`);
  for (const key of ['benchmark', 'inception', 'url']) if (typeof market.officialIdentity[key] !== 'string' || !market.officialIdentity[key]) fail(`${context}.officialIdentity.${key} must be non-empty`);

  assertExactKeys(market.source, [
    'adjustedCloseDefinitionUrl', 'provider', 'rawPayloadSha256', 'retrievedAt', 'sourceArtifactPath',
    'sourceArtifactSchema', 'sourceArtifactSha256', 'sourceArtifactStatus', 'sourceUrl', 'yahooMeta',
  ], `${context}.source`);
  assertEqual(market.source.provider, 'Yahoo Finance chart endpoint', `${context}.source.provider`);
  assertEqual(market.source.rawPayloadSha256, expected.rawPayloadSha256, `${context}.source.rawPayloadSha256`);
  assertEqual(market.source.sourceArtifactPath, SOURCE_ARTIFACTS[1].path, `${context}.source.sourceArtifactPath`);
  assertEqual(market.source.sourceArtifactSha256, SOURCE_ARTIFACTS[1].sha256, `${context}.source.sourceArtifactSha256`);
  assertEqual(market.source.sourceArtifactSchema, 'equity-rotation-panel-input-v1', `${context}.source.sourceArtifactSchema`);
  assertEqual(market.source.sourceArtifactStatus, 'RETROSPECTIVE_DEVELOPMENT_PROXY_ONLY', `${context}.source.sourceArtifactStatus`);
  assertIsoUtc(market.source.retrievedAt, `${context}.source.retrievedAt`);
  if (market.parentHistory.lastDate > market.source.retrievedAt.slice(0, 10)) fail(`${context} last parent row is after retrieval UTC date`);
  assertExactKeys(market.source.yahooMeta, ['currency', 'dataGranularity', 'exchangeName', 'exchangeTimezoneName', 'instrumentType', 'symbol'], `${context}.source.yahooMeta`);
  assertEqual(market.source.yahooMeta.symbol, expected.ticker, `${context}.source.yahooMeta.symbol`);
  assertEqual(market.source.yahooMeta.currency, 'USD', `${context}.source.yahooMeta.currency`);
  assertEqual(market.source.yahooMeta.instrumentType, 'ETF', `${context}.source.yahooMeta.instrumentType`);
}

function validateCalendarInventory(market, cashDates, expected, context) {
  const inventory = market.calendarInventory;
  assertExactKeys(inventory, [
    'boundaryCrossingIntervalRole', 'firstEligibleIntervalEndDate', 'firstSignalFormationMonth',
    'formationLastRowDate', 'formationSupportedIntervalCount', 'minimumSupportedIntervalsPerWarmupMonth',
    'stageBoundaryAnchorDate', 'supportedIntervalDefinition', 'warmupFirstMonth', 'warmupLastMonth',
    'warmupLastRowDate', 'warmupMonths', 'warmupMonthsRequired',
  ], `${context}.calendarInventory`);
  assertEqual(inventory.minimumSupportedIntervalsPerWarmupMonth, 15, `${context}.calendarInventory.minimumSupportedIntervalsPerWarmupMonth`);
  assertEqual(inventory.warmupMonthsRequired, 12, `${context}.calendarInventory.warmupMonthsRequired`);
  assertEqual(inventory.boundaryCrossingIntervalRole, 'excluded_from_stage_returns', `${context}.calendarInventory.boundaryCrossingIntervalRole`);
  assertEqual(inventory.supportedIntervalDefinition, 'adjacent risky closes with exact-date cash rows; values are not transformed', `${context}.calendarInventory.supportedIntervalDefinition`);
  if (!Array.isArray(inventory.warmupMonths) || inventory.warmupMonths.length !== 12) fail(`${context}.calendarInventory.warmupMonths must contain exactly twelve months`);

  const counts = new Map();
  for (const row of market.rows) {
    if (!cashDates.has(row.date)) fail(`${context} has no exact-date cash support on ${row.date}`);
  }
  for (let index = 1; index < market.rows.length; index++) {
    const left = market.rows[index - 1];
    const right = market.rows[index];
    if (!cashDates.has(left.date) || !cashDates.has(right.date)) continue;
    const month = monthKey(right.date);
    counts.set(month, (counts.get(month) || 0) + 1);
  }
  for (let index = 0; index < inventory.warmupMonths.length; index++) {
    const item = inventory.warmupMonths[index];
    assertExactKeys(item, ['month', 'supportedIntervalCount'], `${context}.calendarInventory.warmupMonths[${index}]`);
    if (index && item.month !== nextMonth(inventory.warmupMonths[index - 1].month)) fail(`${context} warm-up months are not consecutive`);
    assertEqual(item.supportedIntervalCount, counts.get(item.month) || 0, `${context} warm-up supported interval count for ${item.month}`);
    if (item.supportedIntervalCount < 15) fail(`${context} warm-up month ${item.month} has fewer than 15 intervals`);
  }
  const eligibleMonths = [...counts.entries()]
    .filter(([, count]) => count >= 15)
    .sort(([left], [right]) => left.localeCompare(right));
  let earliestRun = null;
  for (let start = 0; start <= eligibleMonths.length - 12 && earliestRun == null; start++) {
    const run = eligibleMonths.slice(start, start + 12);
    if (run.every((item, index) => index === 0 || item[0] === nextMonth(run[index - 1][0]))) earliestRun = run;
  }
  if (!earliestRun) fail(`${context} has no twelve-month supported warm-up run`);
  assertCanonicalEqual(
    inventory.warmupMonths,
    earliestRun.map(([month, supportedIntervalCount]) => ({ month, supportedIntervalCount })),
    `${context}.calendarInventory earliest warm-up run`,
  );
  assertEqual(inventory.warmupFirstMonth, inventory.warmupMonths[0].month, `${context}.calendarInventory.warmupFirstMonth`);
  assertEqual(inventory.warmupLastMonth, inventory.warmupMonths.at(-1).month, `${context}.calendarInventory.warmupLastMonth`);
  assertEqual(inventory.firstSignalFormationMonth, nextMonth(inventory.warmupLastMonth), `${context}.calendarInventory.firstSignalFormationMonth`);
  assertEqual(inventory.formationSupportedIntervalCount, counts.get(inventory.firstSignalFormationMonth) || 0, `${context}.calendarInventory.formationSupportedIntervalCount`);
  if (inventory.formationSupportedIntervalCount < 15) fail(`${context} formation month has fewer than 15 intervals`);

  const warmupLastIndex = market.rows.findLastIndex(row => monthKey(row.date) === inventory.warmupLastMonth);
  if (warmupLastIndex < 0) fail(`${context} lacks the last warm-up row`);
  assertEqual(market.rows[warmupLastIndex].date, inventory.warmupLastRowDate, `${context}.calendarInventory.warmupLastRowDate`);
  const formationIndex = market.rows.findLastIndex(row => monthKey(row.date) === inventory.firstSignalFormationMonth);
  if (formationIndex < 0 || formationIndex + 2 >= market.rows.length) fail(`${context} lacks a causal anchor and first eligible interval end`);
  assertEqual(market.rows[formationIndex].date, inventory.formationLastRowDate, `${context}.calendarInventory.formationLastRowDate`);
  assertEqual(market.rows[formationIndex + 1].date, inventory.stageBoundaryAnchorDate, `${context}.calendarInventory.stageBoundaryAnchorDate`);
  assertEqual(market.rows[formationIndex + 2].date, inventory.firstEligibleIntervalEndDate, `${context}.calendarInventory.firstEligibleIntervalEndDate`);
  for (const key of ['warmupFirstMonth', 'warmupLastMonth', 'firstSignalFormationMonth', 'formationLastRowDate', 'stageBoundaryAnchorDate', 'firstEligibleIntervalEndDate']) {
    if (expected[key] != null) assertEqual(inventory[key], expected[key], `${context}.calendarInventory.${key}`);
  }

  const allowedRoles = new Set(['variance_warmup', 'first_signal_formation_data', 'stage_boundary_anchor_no_return', 'stage_return_interval_end_eligible']);
  if (!Array.isArray(market.rowRoles) || market.rowRoles.length !== market.rows.length) fail(`${context}.rowRoles length mismatch`);
  for (let index = 0; index < market.rowRoles.length; index++) {
    const role = market.rowRoles[index];
    if (!allowedRoles.has(role)) fail(`${context}.rowRoles[${index}] is not permitted`);
    const expectedRole = index <= warmupLastIndex
      ? 'variance_warmup'
      : index <= formationIndex
        ? 'first_signal_formation_data'
        : index === formationIndex + 1
          ? 'stage_boundary_anchor_no_return'
          : 'stage_return_interval_end_eligible';
    assertEqual(role, expectedRole, `${context}.rowRoles[${index}]`);
  }
  const roleHash = sha256(Buffer.from(compactCanonicalJson(market.rowRoles)));
  assertEqual(market.rowRolesSha256, roleHash, `${context}.rowRolesSha256 recomputation`);
  if (expected.rowRolesSha256 != null) assertEqual(market.rowRolesSha256, expected.rowRolesSha256, `${context}.rowRolesSha256 frozen identity`);

  if (!Array.isArray(market.roleReceipts) || market.roleReceipts.length !== 4) fail(`${context}.roleReceipts must contain four roles`);
  for (let index = 0; index < market.roleReceipts.length; index++) {
    const role = [...allowedRoles][index];
    const selected = market.rows.filter((row, rowIndex) => market.rowRoles[rowIndex] === role);
    const expectedReceipt = { role, ...receipt(selected) };
    assertCanonicalEqual(market.roleReceipts[index], expectedReceipt, `${context}.roleReceipts[${index}]`);
  }
}

function validateMarket(market, key, cashDates, profile) {
  const context = `markets.${key}`;
  assertExactKeys(market, [
    'calendarInventory', 'currency', 'exclusions', 'executable', 'executableMeaning', 'identityCaveat',
    'key', 'market', 'methodology', 'name', 'officialIdentity', 'parentHistory', 'pointInTimeStatus',
    'priceField', 'primary', 'returnType', 'robustnessOnly', 'rowRoles', 'rowRolesSha256',
    'roleReceipts', 'rows', 'seriesLevelExecutable', 'source', 'stageHistory', 'ticker',
    'underlyingInstrumentExecutable',
  ], context);
  const expectedFull = profile.fullSeries[key];
  const expectedStage = profile.developmentSeries[key];
  validateRows(market.rows, `${context}.rows`);
  assertReceipt(market.parentHistory, expectedFull, `${context}.parentHistory`, 'normalizedRowsSha256');
  const actualStage = receipt(market.rows);
  assertReceipt(market.stageHistory, actualStage, `${context}.stageHistory`, 'rowsSha256');
  assertCanonicalEqual(market.stageHistory, {
    firstDate: expectedStage.firstDate,
    lastDate: expectedStage.lastDate,
    rowCount: expectedStage.rowCount,
    rowsSha256: expectedStage.rowsSha256,
  }, `${context}.stageHistory frozen boundary`);
  assertEqual(market.rows.at(-1).date, FINAL_COMPLETED_DATE, `${context} exact Stage-1 endpoint`);
  if (market.rows.some(row => row.date > FINAL_COMPLETED_DATE)) fail(`${context} contains a later-stage row`);
  if (!Array.isArray(market.exclusions) || market.exclusions.length !== 2) fail(`${context}.exclusions must contain exactly two receipts`);
  market.exclusions.forEach((item, index) => validateNullableReceipt(item, `${context}.exclusions[${index}]`));
  assertEqual(market.exclusions[0].role, 'before_first_cash_supported_close', `${context}.exclusions[0].role`);
  assertEqual(market.exclusions[1].role, 'after_development_end', `${context}.exclusions[1].role`);
  validateCommonMarketMetadata(market, expectedFull, key);
  validateCalendarInventory(market, cashDates, expectedStage, context);
}

function validateCash(cash, profile) {
  const context = 'cash';
  assertExactKeys(cash, [
    'currency', 'exclusions', 'executable', 'executableMeaning', 'key', 'market', 'marketBoundaries',
    'methodology', 'name', 'parentHistory', 'pointInTimeStatus', 'priceField', 'primary', 'returnType',
    'robustnessOnly', 'role', 'rows', 'seriesLevelExecutable', 'source', 'stageHistory', 'ticker',
    'underlyingInstrumentExecutable',
  ], context);
  validateRows(cash.rows, 'cash.rows');
  assertReceipt(cash.parentHistory, profile.fullSeries.cash, 'cash.parentHistory', 'normalizedRowsSha256');
  const actualStage = receipt(cash.rows);
  assertReceipt(cash.stageHistory, actualStage, 'cash.stageHistory', 'rowsSha256');
  assertCanonicalEqual(cash.stageHistory, profile.developmentSeries.cash, 'cash.stageHistory frozen boundary');
  assertEqual(cash.rows.at(-1).date, FINAL_COMPLETED_DATE, 'cash exact Stage-1 endpoint');
  for (const [key, value] of Object.entries({
    key: 'cash', ticker: 'DTB3-91D-ACCRUAL-V2', currency: 'USD',
    returnType: 'RECONSTRUCTED_91_DAY_TBILL_ACCRUAL_PROXY', executable: false,
    seriesLevelExecutable: false, underlyingInstrumentExecutable: false, primary: true,
    robustnessOnly: false, role: 'shared_cash_support',
  })) assertEqual(cash[key], value, `cash.${key}`);
  assertEqual(cash.executableMeaning, 'False: this is a mathematical wealth reconstruction from a quoted yield, not a listed fund or observed total-return index.', 'cash.executableMeaning');
  if (!/current-vintage/i.test(cash.pointInTimeStatus) || !/not an executable/i.test(cash.pointInTimeStatus)) fail('cash.pointInTimeStatus must preserve the frozen nonconforming classification');
  assertExactKeys(cash.source, [
    'informationLagRule', 'maximumObservationStalenessCalendarDays', 'observedYieldHistory', 'observedYieldUnits',
    'officialSeriesUrl', 'provider', 'rawArtifactPath', 'rawArtifactSidecarPath', 'rawPayloadSha256',
    'rawResponseBytes', 'requestedEndDate', 'requestedStartDate', 'retrievedAt', 'sourceArtifactPath',
    'sourceArtifactSchema', 'sourceArtifactSha256', 'sourceArtifactSidecarPath', 'sourceUrl',
    'treasuryPricingConventionUrl',
  ], 'cash.source');
  assertEqual(cash.source.rawPayloadSha256, FULL_SERIES.cash.rawPayloadSha256, 'cash.source.rawPayloadSha256');
  assertEqual(cash.source.sourceArtifactSha256, SOURCE_ARTIFACTS[4].sha256, 'cash.source.sourceArtifactSha256');
  assertEqual(cash.source.informationLagRule, 'STRICTLY_PRIOR_OBSERVATION_DATE_FOR_EACH_ACCRUAL_START_DATE', 'cash.source.informationLagRule');
  assertEqual(cash.source.maximumObservationStalenessCalendarDays, 7, 'cash.source.maximumObservationStalenessCalendarDays');
  assertEqual(cash.source.observedYieldUnits, 'percent_bank_discount_basis', 'cash.source.observedYieldUnits');
  assertIsoUtc(cash.source.retrievedAt, 'cash.source.retrievedAt');
  if (cash.parentHistory.lastDate > cash.source.retrievedAt.slice(0, 10)) fail('cash last parent row is after retrieval UTC date');
  assertExactKeys(cash.source.observedYieldHistory, ['firstDate', 'lastDate', 'normalizedRowsSha256', 'rowCount'], 'cash.source.observedYieldHistory');
  assertCanonicalEqual(cash.source.observedYieldHistory, {
    firstDate: '1995-01-03', lastDate: '2026-08-21', rowCount: 7916,
    normalizedRowsSha256: 'd6f4e4e41088d8e1b442c8ddfa63ba69118adacdee2070a9b780bb62e490b3fb',
  }, 'cash.source.observedYieldHistory frozen identity');
  if (!Array.isArray(cash.exclusions) || cash.exclusions.length !== 2) fail('cash.exclusions must contain exactly two receipts');
  cash.exclusions.forEach((item, index) => validateNullableReceipt(item, `cash.exclusions[${index}]`));
  if (!Array.isArray(cash.marketBoundaries) || cash.marketBoundaries.length !== MARKET_ORDER.length) fail('cash.marketBoundaries must contain four markets');
  for (let index = 0; index < cash.marketBoundaries.length; index++) {
    const boundary = cash.marketBoundaries[index];
    assertExactKeys(boundary, ['firstEligibleIntervalEndDate', 'firstSignalFormationMonth', 'formationLastRowDate', 'key', 'stageBoundaryAnchorDate', 'warmupFirstMonth', 'warmupLastMonth', 'warmupLastRowDate'], `cash.marketBoundaries[${index}]`);
    assertEqual(boundary.key, MARKET_ORDER[index], `cash.marketBoundaries[${index}].key`);
  }
}

function validateDevelopmentInput(input, { profile = PRODUCTION_PROFILE } = {}) {
  assertExactKeys(input, [
    'boundary', 'cash', 'codeIdentities', 'containsStrategyOutcomes', 'deterministicBuild',
    'licensingBoundary', 'markets', 'parent', 'protocols', 'purpose', 'runnerPrecondition',
    'schema', 'stage', 'status',
  ], 'input');
  assertEqual(input.schema, INPUT_SCHEMA, 'input.schema');
  assertEqual(input.status, INPUT_STATUS, 'input.status');
  assertEqual(input.stage, STAGE, 'input.stage');
  assertEqual(input.containsStrategyOutcomes, false, 'input.containsStrategyOutcomes');

  assertExactKeys(input.deterministicBuild, ['commandAcceptsStageSelection', 'currentClockUsed', 'networkAccess', 'reusedCalendarRoleImplementation', 'serialization'], 'input.deterministicBuild');
  assertEqual(input.deterministicBuild.currentClockUsed, false, 'input.deterministicBuild.currentClockUsed');
  assertEqual(input.deterministicBuild.networkAccess, false, 'input.deterministicBuild.networkAccess');
  assertEqual(input.deterministicBuild.commandAcceptsStageSelection, false, 'input.deterministicBuild.commandAcceptsStageSelection');

  assertExactKeys(input.protocols, ['normative', 'proxy'], 'input.protocols');
  validateProtocolReceipt(input.protocols.normative, { path: 'research/UNIVERSAL_VOLATILITY_OVERLAY_PROTOCOL.md', sha256: EXPECTED.normativeProtocol, marker: core.PROTOCOL_MARKER }, 'input.protocols.normative');
  validateProtocolReceipt(input.protocols.proxy, { path: 'research/UNIVERSAL_VOLATILITY_OVERLAY_PROXY_FALSIFICATION_PROTOCOL_V2.md', sha256: EXPECTED.proxyProtocolV2, marker: PROTOCOL_MARKER }, 'input.protocols.proxy');

  assertExactKeys(input.codeIdentities, Object.keys(CODE_IDENTITIES), 'input.codeIdentities');
  for (const [key, expected] of Object.entries(CODE_IDENTITIES)) validateArtifactReceipt(input.codeIdentities[key], expected, `input.codeIdentities.${key}`);

  assertExactKeys(input.runnerPrecondition, [
    'applicableCodeProtocolTestsCommittedCleanRequiredBeforeStage1', 'currentDevelopmentInputCommitRequiredForStage1',
    'currentDevelopmentInputSidecarCommitRequiredForStage1', 'developmentInputAndSidecarCommittedCleanRequiredBeforeStage2Replay',
    'generatedArtifactCurrentlyIgnoredAndUntracked', 'selectionManifestCommittedCleanRequiredBeforeStage2Replay',
    'stageExecutionAuthorizedByGeneration',
  ], 'input.runnerPrecondition');
  const preconditionExpected = {
    applicableCodeProtocolTestsCommittedCleanRequiredBeforeStage1: true,
    currentDevelopmentInputCommitRequiredForStage1: false,
    currentDevelopmentInputSidecarCommitRequiredForStage1: false,
    developmentInputAndSidecarCommittedCleanRequiredBeforeStage2Replay: true,
    selectionManifestCommittedCleanRequiredBeforeStage2Replay: true,
    generatedArtifactCurrentlyIgnoredAndUntracked: true,
    stageExecutionAuthorizedByGeneration: false,
  };
  assertCanonicalEqual(input.runnerPrecondition, preconditionExpected, 'input.runnerPrecondition');

  assertExactKeys(input.licensingBoundary, ['cmbitmExecutable', 'cmbitmSolePrimaryNoSplice', 'permittedInference', 'proxyDataCannotSatisfyOriginalLicensedExecutableSourceGate', 'underlyingSourceTermsStillApply'], 'input.licensingBoundary');
  assertEqual(input.licensingBoundary.cmbitmExecutable, false, 'input.licensingBoundary.cmbitmExecutable');
  assertEqual(input.licensingBoundary.cmbitmSolePrimaryNoSplice, true, 'input.licensingBoundary.cmbitmSolePrimaryNoSplice');
  assertEqual(input.licensingBoundary.proxyDataCannotSatisfyOriginalLicensedExecutableSourceGate, true, 'input.licensingBoundary.proxyDataCannotSatisfyOriginalLicensedExecutableSourceGate');

  assertExactKeys(input.parent, ['dataFreezeManifest', 'normalizedInput', 'verifiedSourceArtifacts'], 'input.parent');
  validateParentReceipt(input.parent.normalizedInput, {
    path: 'research/local-artifacts/five-market-proxy-data-v2/five-market-proxy-input-v2-2026-08-24.json',
    sha256: EXPECTED.normalizedParentInput, sidecarSha256: EXPECTED.normalizedParentInputSidecar,
  }, 'input.parent.normalizedInput');
  validateParentReceipt(input.parent.dataFreezeManifest, {
    path: 'research/FIVE_MARKET_PROXY_DATA_FREEZE_V2_2026-08-24.json',
    sha256: EXPECTED.dataFreezeManifest, sidecarSha256: EXPECTED.dataFreezeManifestSidecar,
  }, 'input.parent.dataFreezeManifest');
  validateSourceArtifactReceipts(input.parent.verifiedSourceArtifacts);

  assertExactKeys(input.boundary, [
    'boundaryCrossingReturnInterval', 'cryptoIncluded', 'laterStageDataIncluded', 'marketCalendarPolicy',
    'marketOrder', 'returnIntervalEndInclusive', 'returnIntervalStart', 'validationOrEvaluationArtifactOpenedOrCreated',
  ], 'input.boundary');
  assertEqual(input.boundary.returnIntervalEndInclusive, FINAL_COMPLETED_DATE, 'input.boundary.returnIntervalEndInclusive');
  assertCanonicalEqual(input.boundary.marketOrder, MARKET_ORDER, 'input.boundary.marketOrder');
  assertEqual(input.boundary.cryptoIncluded, false, 'input.boundary.cryptoIncluded');
  assertEqual(input.boundary.laterStageDataIncluded, false, 'input.boundary.laterStageDataIncluded');
  assertEqual(input.boundary.validationOrEvaluationArtifactOpenedOrCreated, false, 'input.boundary.validationOrEvaluationArtifactOpenedOrCreated');
  assertEqual(input.boundary.boundaryCrossingReturnInterval, 'forbidden', 'input.boundary.boundaryCrossingReturnInterval');

  validateCash(input.cash, profile);
  const cashDates = new Set(input.cash.rows.map(row => row.date));
  if (!Array.isArray(input.markets) || input.markets.length !== MARKET_ORDER.length) fail('input.markets must contain exactly four Stage-1 equity markets');
  assertCanonicalEqual(input.markets.map(market => market && market.key), MARKET_ORDER, 'input market order');
  for (const market of input.markets) validateMarket(market, market.key, cashDates, profile);

  for (let index = 0; index < input.cash.marketBoundaries.length; index++) {
    const market = input.markets[index];
    const expected = {
      key: market.key,
      warmupFirstMonth: market.calendarInventory.warmupFirstMonth,
      warmupLastMonth: market.calendarInventory.warmupLastMonth,
      warmupLastRowDate: market.calendarInventory.warmupLastRowDate,
      firstSignalFormationMonth: market.calendarInventory.firstSignalFormationMonth,
      formationLastRowDate: market.calendarInventory.formationLastRowDate,
      stageBoundaryAnchorDate: market.calendarInventory.stageBoundaryAnchorDate,
      firstEligibleIntervalEndDate: market.calendarInventory.firstEligibleIntervalEndDate,
    };
    assertCanonicalEqual(input.cash.marketBoundaries[index], expected, `input.cash.marketBoundaries[${index}]`);
  }
  return input;
}

function makeSyntheticProfileForTests(input) {
  const fullSeries = { cash: { ...input.cash.parentHistory, ticker: input.cash.ticker, rawPayloadSha256: input.cash.source.rawPayloadSha256 } };
  const developmentSeries = { cash: { ...input.cash.stageHistory } };
  for (const market of input.markets) {
    fullSeries[market.key] = { ...market.parentHistory, ticker: market.ticker, rawPayloadSha256: market.source.rawPayloadSha256 };
    developmentSeries[market.key] = {
      ...market.stageHistory,
      rowRolesSha256: market.rowRolesSha256,
      warmupFirstMonth: market.calendarInventory.warmupFirstMonth,
      warmupLastMonth: market.calendarInventory.warmupLastMonth,
      firstSignalFormationMonth: market.calendarInventory.firstSignalFormationMonth,
      formationLastRowDate: market.calendarInventory.formationLastRowDate,
      stageBoundaryAnchorDate: market.calendarInventory.stageBoundaryAnchorDate,
      firstEligibleIntervalEndDate: market.calendarInventory.firstEligibleIntervalEndDate,
    };
  }
  return Object.freeze({ syntheticOnly: true, fullSeries: Object.freeze(fullSeries), developmentSeries: Object.freeze(developmentSeries) });
}

function makeInputEvidence(input, { bytes = Buffer.from(core.canonicalJson(input)), sidecarBytes = null, expectedInputSha256 = EXPECTED.developmentInput, expectedSidecarSha256 = EXPECTED.developmentInputSidecarBytes, profile = PRODUCTION_PROFILE } = {}) {
  if (!Buffer.isBuffer(bytes)) fail('development input evidence bytes must be a Buffer');
  const digest = sha256(bytes);
  assertEqual(digest, expectedInputSha256, 'development input SHA-256');
  const canonical = Buffer.from(core.canonicalJson(input));
  if (!bytes.equals(canonical)) fail('development input must be exact canonical JSON');
  if (sidecarBytes != null) {
    if (!Buffer.isBuffer(sidecarBytes)) fail('development input sidecar bytes must be a Buffer');
    assertEqual(sha256(sidecarBytes), expectedSidecarSha256, 'development input sidecar-bytes SHA-256');
    const expectedSidecar = Buffer.from(`${digest}  ${path.basename(PATHS.developmentInput)}\n`);
    if (!sidecarBytes.equals(expectedSidecar)) fail('development input sidecar content mismatch');
  }
  validateDevelopmentInput(input, { profile });
  deepFreeze(input);
  deepFreeze(profile);
  const evidence = { payload: input, bytes: Buffer.from(bytes), sha256: digest, sidecarSha256: sidecarBytes == null ? null : sha256(sidecarBytes), profile };
  Object.defineProperty(evidence, INPUT_EVIDENCE_TOKEN, { value: true, enumerable: false });
  return Object.freeze(evidence);
}

function assertInputEvidence(evidence) {
  if (!evidence || evidence[INPUT_EVIDENCE_TOKEN] !== true) fail('development analysis requires validated exact input evidence');
  if (sha256(evidence.bytes) !== evidence.sha256) fail('development input evidence bytes changed');
  if (!evidence.bytes.equals(Buffer.from(core.canonicalJson(evidence.payload)))) fail('development input evidence payload is not bound to its exact bytes');
  return evidence;
}

function assertNoLaterStagePath(file, context) {
  const resolved = path.resolve(file);
  if (/(^|[\\/])(validation|evaluation)([\\/]|$)/i.test(resolved)) fail(`${context} may not name a later-stage path`);
  return resolved;
}

function readDevelopmentInput(file, { io = fs, accessLog = null, enforceDefaultPath = true, expectedInputSha256 = EXPECTED.developmentInput, expectedSidecarSha256 = EXPECTED.developmentInputSidecarBytes, profile = PRODUCTION_PROFILE } = {}) {
  const resolved = assertNoLaterStagePath(file, 'development input');
  if (enforceDefaultPath && resolved !== path.resolve(PATHS.developmentInput)) fail('runner accepts only the exact frozen v2 Stage-1 development input path');
  const sidecarPath = `${resolved}.sha256`;
  if (accessLog) accessLog.push(sidecarPath);
  const sidecarBytes = io.readFileSync(sidecarPath);
  if (accessLog) accessLog.push(resolved);
  const bytes = io.readFileSync(resolved);
  let payload;
  try { payload = JSON.parse(bytes.toString('utf8')); }
  catch (error) { fail(`development input is not valid JSON: ${error.message}`); }
  return makeInputEvidence(payload, { bytes, sidecarBytes, expectedInputSha256, expectedSidecarSha256, profile });
}

function proxyLimitations(market) {
  return [
    { scope: market.key, code: 'CURRENT_VINTAGE_ADJUSTED_CLOSE_PROXY_NOT_RECORDED_EXECUTABLE_FILL' },
    { scope: market.key, code: 'HISTORICAL_MARGIN_AND_TARGET_EXECUTABILITY_NOT_DOCUMENTED' },
    { scope: 'cash', code: 'RECONSTRUCTED_DTB3_ACCRUAL_AND_MODELED_BORROWING_NOT_EXECUTABLE' },
    { scope: 'panel', code: 'ORIGINAL_REQUIRED_SOURCE_CONTRACT_NOT_SATISFIED' },
  ];
}

function buildProxyGateReport(coreGates) {
  const c = coreGates.conditions;
  const numericalConditions = {
    gate1BhEdge: c.bhEdgeAtLeast0025,
    gate2TimingEdge: c.timingEdgeAtLeast0010,
    gate3Volatility: c.volatilityNoGreaterThanBuyAndHold,
    gate4Drawdown: c.maximumDrawdownNoDeeperThanBuyAndHold,
    gate5Turnover: c.turnoverNoGreaterThanFourPerYear,
    gate6WealthFloorAndLiquidation: c.executionIntegrity,
    gate7ComputedIntervalsAndLiquidation: c.requiredSourceIntervalsAndLiquidationComplete,
  };
  const vector = [
    { gate: 1, id: 'bhEdgeAtLeast0025', pass: c.bhEdgeAtLeast0025 },
    { gate: 2, id: 'timingEdgeAtLeast0010', pass: c.timingEdgeAtLeast0010 },
    { gate: 3, id: 'volatilityNoGreaterThanBuyAndHold', pass: c.volatilityNoGreaterThanBuyAndHold },
    { gate: 4, id: 'maximumDrawdownNoDeeperThanBuyAndHold', pass: c.maximumDrawdownNoDeeperThanBuyAndHold },
    { gate: 5, id: 'turnoverNoGreaterThanFourPerYear', pass: c.turnoverNoGreaterThanFourPerYear },
    {
      gate: 6,
      id: 'executionIntegrity',
      pass: false,
      numericalWealthFloorAndLiquidation: c.executionIntegrity,
      instrumentExecutabilityDocumented: false,
      financingExecutabilityDocumented: false,
    },
    {
      gate: 7,
      id: 'requiredSourceIntervalsAndLiquidationComplete',
      pass: false,
      computedReturnIntervalsAndLiquidationComplete: c.requiredSourceIntervalsAndLiquidationComplete,
      requiredSourceConforming: false,
    },
  ];
  const screenPass = Object.values(numericalConditions).every(Boolean);
  const sampleRequirement = { ...coreGates.sampleRequirement };
  return {
    edges: coreGates.edges,
    originalSevenGates: {
      vector,
      allSeven: false,
      marketScenario: false,
      immutableReason: 'proxy_source_and_historical_executability_requirements_are_not_satisfied',
    },
    numericProxyScreen: {
      conditions: numericalConditions,
      pass: screenPass,
      isOriginalGateOrStagePass: false,
    },
    sampleRequirement,
    proxyDevelopmentCellEligible: screenPass && sampleRequirement.pass,
  };
}

function analyzeProxyMarket(input, market, { candidates = core.CANDIDATES, stageConfig = core.STAGES.development, coreModule = core } = {}) {
  const analysisArguments = {
    input: { cashTotalReturn: { rows: input.cash.rows, knownDataIssues: [] } },
    market: {
      key: market.key,
      rows: market.rows,
      instrumentIdentity: market.ticker,
      revisionStatus: 'current_vintage_revised_history',
      knownDataIssues: [],
      maxTargetExposure: COUNTERFACTUAL_MAXIMUM_TARGET,
    },
    stageConfig: { ...stageConfig },
    candidates,
    frozenDevelopmentMeanTarget: null,
  };
  const result = coreModule.analyzeMarket(analysisArguments);
  assertEqual(result.terminalDate, FINAL_COMPLETED_DATE, `${market.key} analyzed terminal close`);
  const computedReturnIntervalsComplete = result.sourceAndIntervalsComplete;
  for (const scenario of core.SCENARIOS) {
    for (const candidate of candidates) {
      result.scenarioResults[scenario.id][candidate.id].gates = buildProxyGateReport(result.scenarioResults[scenario.id][candidate.id].gates);
    }
  }
  result.documentedMaximumTargetExposure = null;
  result.counterfactualCalculationMaximumTargetExposure = COUNTERFACTUAL_MAXIMUM_TARGET;
  result.evidenceClass = 'retrospective_proxy_falsification_only';
  result.sourceAndIntervalsComplete = false;
  result.computedReturnIntervalsComplete = computedReturnIntervalsComplete;
  result.originalSourceConforming = false;
  result.originalInstrumentExecutabilityDocumented = false;
  result.knownDataIssues = proxyLimitations(market);
  return result;
}

function summarizeCandidates(marketResults, candidates = core.CANDIDATES) {
  return Object.fromEntries(candidates.map(candidate => {
    const cells = [];
    for (const market of marketResults) {
      for (const scenario of core.SCENARIOS) {
        const gates = market.scenarioResults[scenario.id][candidate.id].gates;
        cells.push({
          market: market.market,
          scenario: scenario.id,
          numericProxyScreen: gates.numericProxyScreen.pass,
          sampleRequirementMet: gates.sampleRequirement.pass,
          proxyDevelopmentEligible: gates.proxyDevelopmentCellEligible,
          originalSevenGateVector: gates.originalSevenGates.vector.map(gate => gate.pass),
          originalProtocolMarketScenario: false,
          timingEdgeAnnualLogReturn: gates.edges.timingEdgeAnnualLogReturn,
        });
      }
    }
    const stressEdges = cells.filter(cell => cell.scenario === 'stress').map(cell => cell.timingEdgeAnnualLogReturn);
    return [candidate.id, {
      candidate,
      proxyDevelopmentEligibleAcrossAllCells: cells.every(cell => cell.proxyDevelopmentEligible),
      cells,
      worstMarketStressTimingEdgeAnnualLogReturn: stressEdges.length && stressEdges.every(Number.isFinite) ? Math.min(...stressEdges) : null,
    }];
  }));
}

function selectProxyDevelopmentCandidate(summaries) {
  const strictShape = Object.fromEntries(core.CANDIDATES.map(candidate => [candidate.id, {
    ...summaries[candidate.id],
    eligible: summaries[candidate.id].proxyDevelopmentEligibleAcrossAllCells,
  }]));
  return core.selectDevelopmentCandidate(strictShape);
}

function makeSyntheticAnalysisInjectionForTests(evidence, marketResults) {
  assertInputEvidence(evidence);
  if (evidence.profile.syntheticOnly !== true) fail('synthetic analysis injection is forbidden for frozen production input evidence');
  if (!Array.isArray(marketResults) || marketResults.length !== MARKET_ORDER.length) fail('synthetic analysis injection requires exactly four market results');
  assertCanonicalEqual(marketResults.map(market => market && market.market), MARKET_ORDER, 'synthetic analysis injection market order');
  for (const market of marketResults) {
    if (!market || !market.scenarioResults || !market.targetCalendarByCandidate) fail(`synthetic ${market && market.market || 'market'} result is incomplete`);
    for (const scenario of core.SCENARIOS) {
      if (!market.scenarioResults[scenario.id]) fail(`synthetic ${market.market} result lacks ${scenario.id}`);
      for (const candidate of core.CANDIDATES) {
        if (!market.scenarioResults[scenario.id][candidate.id]?.gates) fail(`synthetic ${market.market}/${scenario.id}/${candidate.id} result lacks gates`);
        const calendar = market.targetCalendarByCandidate[candidate.id];
        if (!calendar || !(calendar.totalDays > 0) || !Number.isFinite(calendar.targetDaySum)) fail(`synthetic ${market.market}/${candidate.id} result lacks a target calendar`);
      }
    }
  }
  deepFreeze(marketResults);
  const injection = { inputSha256: evidence.sha256, marketResults };
  Object.defineProperty(injection, SYNTHETIC_ANALYSIS_INJECTION_TOKEN, { value: true, enumerable: false });
  return Object.freeze(injection);
}

function composeDevelopmentResult(evidence, marketResults) {
  assertInputEvidence(evidence);
  const input = evidence.payload;
  const candidateSummaries = summarizeCandidates(marketResults);
  const selected = selectProxyDevelopmentCandidate(candidateSummaries);
  const positive = selected != null;
  const pooled = positive ? core.pooledDevelopmentMeanTarget({ marketResults }, selected.id) : null;
  const result = {
    schema: RESULT_SCHEMA,
    status: positive ? POSITIVE_STATUS : NEGATIVE_STATUS,
    outcomeLabel: positive ? POSITIVE_OUTCOME_LABEL : NEGATIVE_STATUS,
    stage: STAGE,
    researchOnly: true,
    productionApproved: false,
    originalProtocolStagePass: false,
    numericProxyScreenClearedByAtLeastOneCandidate: positive,
    interpretation: positive ? 'development_candidate_only' : 'frozen_proxy_family_rejected_on_development_panel',
    protocolChain: {
      normative: { marker: core.PROTOCOL_MARKER, sha256: EXPECTED.normativeProtocol },
      proxyV1: { marker: 'FROZEN_UNIVERSAL_VOL_PROXY_FALSIFICATION_V1', sha256: EXPECTED.proxyProtocolV1 },
      proxyV2: { marker: PROTOCOL_MARKER, sha256: EXPECTED.proxyProtocolV2 },
    },
    frozenIdentities: {
      strictRunnerSha256: EXPECTED.strictRunner,
      strictRunnerTestsSha256: EXPECTED.strictRunnerTests,
      baseDataBuilderSha256: EXPECTED.baseDataBuilder,
      baseDataBuilderTestsSha256: EXPECTED.baseDataBuilderTests,
      dataBuilderV2Sha256: EXPECTED.dataBuilder,
      dataBuilderV2TestsSha256: EXPECTED.dataBuilderTests,
      calendarRoleSplitterV1Sha256: EXPECTED.calendarRoleSplitterV1,
      calendarRoleSplitterV1TestsSha256: EXPECTED.calendarRoleSplitterV1Tests,
      splitterV2Sha256: EXPECTED.splitterV2,
      splitterV2TestsSha256: EXPECTED.splitterV2Tests,
      dataFreezeManifestSha256: EXPECTED.dataFreezeManifest,
      dataFreezeManifestSidecarSha256: EXPECTED.dataFreezeManifestSidecar,
      developmentInputSha256: evidence.sha256,
      developmentInputSidecarBytesSha256: evidence.sidecarSha256,
      runnerSha256: sha256(fs.readFileSync(PATHS.runner)),
      runnerTestsSha256: sha256(fs.readFileSync(PATHS.runnerTests)),
    },
    inputReceipt: {
      schema: input.schema,
      stage: input.stage,
      sha256: evidence.sha256,
      sidecarBytesSha256: evidence.sidecarSha256,
    },
    inferenceBoundary: {
      sourceConforming: false,
      historicalInstrumentExecutabilityDocumented: false,
      cashAndFinancingExecutabilityDocumented: false,
      numericProxyScreenIsAnOriginalGate: false,
      strongestPositiveOutcome: POSITIVE_OUTCOME_LABEL,
    },
    allFourCandidateResults: {
      candidates: core.CANDIDATES.map(candidate => candidate.id),
      scenarios: core.SCENARIOS,
      stageConfig: core.STAGES.development,
      implementationConventions: core.IMPLEMENTATION_CONVENTIONS,
      excludedCostsDisclosure: ['taxes', 'market impact', 'custody', 'locate fees', 'ETF premium/discount', 'tracking error', 'index-replication costs'],
      marketDependenceWarning: 'The four equity proxy histories overlap economically and are not independent statistical observations.',
      marketResults,
      candidateSummaries,
    },
    selectedCandidate: selected && selected.id,
    selectedCandidateParameters: selected,
    developmentPooledMeanTargetDiagnostic: pooled,
    laterStageAccess: {
      authorized: false,
      filesOpenedOrCreated: false,
      commandsImplemented: false,
    },
  };
  return jsonSafe(result);
}

function buildDevelopmentResult(evidence, syntheticAnalysisInjection = null) {
  assertInputEvidence(evidence);
  const input = evidence.payload;
  let marketResults;
  if (syntheticAnalysisInjection == null) {
    marketResults = input.markets.map(market => analyzeProxyMarket(input, market, { candidates: core.CANDIDATES, stageConfig: core.STAGES.development }));
  } else {
    if (evidence.profile.syntheticOnly !== true || syntheticAnalysisInjection[SYNTHETIC_ANALYSIS_INJECTION_TOKEN] !== true) fail('unrecognized synthetic analysis injection');
    assertEqual(syntheticAnalysisInjection.inputSha256, evidence.sha256, 'synthetic analysis injection input SHA-256');
    marketResults = syntheticAnalysisInjection.marketResults;
  }
  return composeDevelopmentResult(evidence, marketResults);
}

function validateDevelopmentResult(result, evidence) {
  const rebuilt = buildDevelopmentResult(evidence);
  assertCanonicalEqual(result, rebuilt, 'development result');
  return rebuilt;
}

function repoPath(file) {
  const relative = path.relative(REPO_ROOT, path.resolve(file));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail(`artifact is outside repository: ${file}`);
  return relative.split(path.sep).join('/');
}

function readExactCode(file, expectedSha256, { io = fs, accessLog = null } = {}) {
  const resolved = path.resolve(file);
  if (accessLog) accessLog.push(resolved);
  const bytes = io.readFileSync(resolved);
  const digest = sha256(bytes);
  assertEqual(digest, expectedSha256, `${repoPath(resolved)} SHA-256`);
  return { resolved, bytes, sha256: digest };
}

function verifyFrozenCodeIdentities({ io = fs, accessLog = null } = {}) {
  const order = [
    ['normativeProtocol', core.PROTOCOL_MARKER],
    ['proxyProtocolV1', 'FROZEN_UNIVERSAL_VOL_PROXY_FALSIFICATION_V1'],
    ['proxyProtocolV2', PROTOCOL_MARKER],
    ['strictRunner', null], ['strictRunnerTests', null],
    ['baseDataBuilder', null], ['baseDataBuilderTests', null],
    ['dataBuilder', null], ['dataBuilderTests', null],
    ['calendarRoleSplitterV1', null], ['calendarRoleSplitterV1Tests', null],
    ['splitterV2', null], ['splitterV2Tests', null],
    ['dataFreezeManifest', null], ['dataFreezeManifestSidecar', null],
  ];
  const artifacts = {};
  for (const [key, marker] of order) {
    const artifact = readExactCode(PATHS[key], EXPECTED[key], { io, accessLog });
    if (marker && !artifact.bytes.toString('utf8').includes(marker)) fail(`${key} freeze marker mismatch`);
    artifacts[key] = { path: repoPath(artifact.resolved), sha256: artifact.sha256, bytes: artifact.bytes.length };
  }
  const v2Text = io.readFileSync(path.resolve(PATHS.proxyProtocolV2), 'utf8');
  for (const digest of [EXPECTED.normativeProtocol, EXPECTED.proxyProtocolV1, EXPECTED.strictRunner, EXPECTED.strictRunnerTests]) {
    if (!v2Text.includes(digest)) fail(`v2 protocol omits required identity ${digest}`);
  }
  return artifacts;
}

function assertCommittedCleanFiles(files, { execFileSync = childProcess.execFileSync, directory = __dirname } = {}) {
  if (!Array.isArray(files) || !files.length) fail('code freeze needs at least one file');
  let root;
  try {
    root = execFileSync('git', ['-C', path.resolve(directory), 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    fail('runner is not inside a Git worktree');
  }
  for (const file of files) {
    const resolved = path.resolve(file);
    const relative = path.relative(root, resolved).split(path.sep).join('/');
    if (!relative || relative.startsWith('../') || path.isAbsolute(relative)) fail(`code-freeze file is outside its Git worktree: ${resolved}`);
    try {
      execFileSync('git', ['-C', root, 'ls-files', '--error-unmatch', '--', relative], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      fail(`code-freeze file is not committed: ${resolved}`);
    }
    const status = execFileSync('git', ['-C', root, 'status', '--porcelain', '--', relative], { encoding: 'utf8' });
    if (status.trim()) fail(`code-freeze file has uncommitted changes: ${resolved}`);
    const committed = execFileSync('git', ['-C', root, 'rev-parse', `HEAD:${relative}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const working = execFileSync('git', ['-C', root, 'hash-object', '--path', relative, resolved], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    if (committed !== working) fail(`code-freeze file bytes differ from committed Git blob: ${resolved}`);
  }
  return true;
}

function assertProductionCodeFreeze(options = {}) {
  return assertCommittedCleanFiles(PRODUCTION_CODE_FREEZE_PATHS, options);
}

function assertDefaultInputPath(file) {
  const resolved = assertNoLaterStagePath(file, 'development input');
  if (resolved !== path.resolve(PATHS.developmentInput)) fail('runner accepts only the exact frozen v2 Stage-1 development input path');
  return resolved;
}

function assertDefaultResultPath(file) {
  const resolved = assertNoLaterStagePath(file, 'development result');
  if (resolved !== path.resolve(PATHS.developmentResult)) fail('runner writes only the frozen v2 development result path');
  return resolved;
}

function assertDevelopmentResultAbsent(file, { io = fs, enforceDefaultPath = true } = {}) {
  const resolved = enforceDefaultPath ? assertDefaultResultPath(file) : assertNoLaterStagePath(file, 'development result');
  for (const target of [resolved, `${resolved}.sha256`]) {
    if (io.existsSync(target)) fail(`one-shot Stage-1 result target already exists: ${target}`);
  }
  return resolved;
}

function writeDevelopmentResult(file, value, { io = fs, enforceDefaultPath = true } = {}) {
  const resolved = assertDevelopmentResultAbsent(file, { io, enforceDefaultPath });
  const bytes = Buffer.from(core.canonicalJson(value));
  io.mkdirSync(path.dirname(resolved), { recursive: true });
  const digest = sha256(bytes);
  io.writeFileSync(resolved, bytes, { flag: 'wx' });
  io.writeFileSync(`${resolved}.sha256`, Buffer.from(`${digest}  ${path.basename(resolved)}\n`), { flag: 'wx' });
  return { resolved, sha256: digest, bytes: bytes.length, sidecar: `${resolved}.sha256` };
}

function parseCommand(argv) {
  if (!Array.isArray(argv) || argv.length !== 5 || argv[0] !== STAGE || argv[1] !== '--input' || argv[3] !== '--output' || !argv[2] || !argv[4]) {
    fail('v2 proxy runner accepts only: development --input <exact-stage1-input> --output <development-result>');
  }
  return { stage: STAGE, input: argv[2], output: argv[4] };
}

function main(argv = process.argv.slice(2), dependencies = {}) {
  const command = parseCommand(argv); // Reject every other stage before reads.
  assertDefaultInputPath(command.input);
  assertDefaultResultPath(command.output);
  const operations = {
    verifyFrozenCodeIdentities,
    assertProductionCodeFreeze,
    assertDevelopmentResultAbsent,
    readDevelopmentInput,
    buildDevelopmentResult,
    writeDevelopmentResult,
    writeStatus: value => process.stdout.write(value),
    ...dependencies,
  };
  operations.verifyFrozenCodeIdentities();
  operations.assertProductionCodeFreeze();
  operations.assertDevelopmentResultAbsent(command.output);
  const evidence = operations.readDevelopmentInput(command.input);
  const result = operations.buildDevelopmentResult(evidence);
  const written = operations.writeDevelopmentResult(command.output, result);
  operations.writeStatus(`${JSON.stringify({
    schema: result.schema,
    stage: result.stage,
    status: result.status,
    outcomeLabel: result.outcomeLabel,
    selectedCandidate: result.selectedCandidate,
    originalProtocolStagePass: result.originalProtocolStagePass,
    outputSha256: written.sha256,
  }, null, 2)}\n`);
  return result;
}

module.exports = {
  REPO_ROOT, INPUT_SCHEMA, INPUT_STATUS, RESULT_SCHEMA, STAGE,
  POSITIVE_STATUS, POSITIVE_OUTCOME_LABEL, NEGATIVE_STATUS, PROTOCOL_MARKER,
  FINAL_COMPLETED_DATE, COUNTERFACTUAL_MAXIMUM_TARGET, MARKET_ORDER,
  PATHS, PRODUCTION_CODE_FREEZE_PATHS, EXPECTED, CODE_IDENTITIES, FULL_SERIES, DEVELOPMENT_SERIES,
  SOURCE_ARTIFACTS, PRODUCTION_PROFILE, IntegrityError, fail, sha256,
  deepFreeze, canonicalize, compactCanonicalJson, jsonSafe, assertEqual,
  assertCanonicalEqual, assertExactKeys, receipt, validateRows,
  validateDevelopmentInput, makeSyntheticProfileForTests, makeInputEvidence,
  assertInputEvidence, assertNoLaterStagePath, readDevelopmentInput,
  proxyLimitations, buildProxyGateReport, analyzeProxyMarket,
  summarizeCandidates, selectProxyDevelopmentCandidate,
  makeSyntheticAnalysisInjectionForTests, composeDevelopmentResult,
  buildDevelopmentResult, validateDevelopmentResult, readExactCode,
  verifyFrozenCodeIdentities, assertCommittedCleanFiles,
  assertProductionCodeFreeze, assertDefaultInputPath, assertDefaultResultPath,
  assertDevelopmentResultAbsent,
  writeDevelopmentResult, parseCommand, main,
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
