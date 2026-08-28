'use strict';

// One-shot offline adapter for the preregistered schema-5 retrospective replay.
// Importing this module never opens the frozen snapshot.  Real data are read
// only from the explicit CLI route after the protocol and checkout are frozen.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const core = require('./fear_greed_expanding_binary.js');
const analyzer = require('./fear_greed_expanding_binary_result_analyzer.js');

const ROOT = path.resolve(__dirname, '..');
const SNAPSHOT_PATH = path.join(
  __dirname,
  'local-artifacts',
  'v2-validation-final',
  'inputs',
  'fear-greed-v2-validation-input-2026-08-25T12-44-22Z.json',
);
const SNAPSHOT_SHA256 = 'ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d';
const OUTPUT_DIR = path.join(__dirname, 'local-artifacts', 'expanding-binary-v1', 'results');
const EXECUTE_FLAG = '--execute-frozen-retrospective';
const EXPECTED_SCHEMA_VERSION = 5;
const VERIFIED_PARSED_SNAPSHOTS = new WeakSet();
const NATIVE_BUFFER_FROM = Buffer.from.bind(Buffer);
const NATIVE_BUFFER_IS_BUFFER = Buffer.isBuffer.bind(Buffer);
const NATIVE_BUFFER_TO_STRING = Function.prototype.call.bind(Buffer.prototype.toString);

const MARKET_SPECS = analyzer.FROZEN_MARKET_SPECS;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function copyHashAndDecodeBuffer(bytes) {
  assert(NATIVE_BUFFER_IS_BUFFER(bytes), 'Frozen snapshot must be supplied as bytes');
  // Hash and decode the same native copy.  All three Buffer operations were
  // captured when this guarded module loaded, before a caller can replace an
  // instance or shared prototype method between authentication and decoding.
  const stableBytes = NATIVE_BUFFER_FROM(bytes);
  return Object.freeze({
    sha256: sha256Bytes(stableBytes),
    text: NATIVE_BUFFER_TO_STRING(stableBytes, 'utf8'),
  });
}

function getAdapterIdentity() {
  return Object.freeze({
    file: path.basename(__filename),
    sha256: sha256Bytes(fs.readFileSync(__filename)),
  });
}

function validateOrderedRows(rows, label) {
  assert(Array.isArray(rows) && rows.length >= 2, `${label} requires at least two rows`);
  let previous = null;
  for (const [index, row] of rows.entries()) {
    assert(row && core.isExactIsoDate(row.date),
      `${label} row ${index} has an invalid date`);
    assert(typeof row.close === 'number' && Number.isFinite(row.close) && row.close > 0,
      `${label} row ${index} has an invalid close`);
    assert(previous === null || previous < row.date, `${label} dates are not strictly increasing`);
    previous = row.date;
  }
}

function snapshotToInputs(snapshot) {
  assert(snapshot && Number(snapshot.schemaVersion) === EXPECTED_SCHEMA_VERSION,
    `Expected schema ${EXPECTED_SCHEMA_VERSION}`);
  assert(Array.isArray(snapshot.markets), 'Snapshot markets are missing');
  assert(snapshot.markets.map((market) => market.key).join(',') === MARKET_SPECS.map((spec) => spec.key).join(','),
    'Frozen market order or set drifted');

  return Object.freeze(MARKET_SPECS.map((spec) => {
    const market = snapshot.markets.find((candidate) => candidate.key === spec.key);
    assert(market && market.targetId === spec.targetId, `${spec.key}: target identity drifted`);
    assert(Number(market.annualization) === spec.annualization, `${spec.key}: annualization drifted`);
    assert(market.prices && market.prices.symbol === spec.targetId, `${spec.key}: price-series identity drifted`);
    if (spec.requiresAdjusted) {
      assert(market.prices.adjusted === true,
        `${spec.key}: frozen ETF target is not an adjusted-close total-return proxy`);
    }
    validateOrderedRows(market.prices.rows, `${spec.key} prices`);
    assert(Array.isArray(market.signals) && market.signals.length > 0, `${spec.key}: signals are missing`);
    const priceDates = new Set(market.prices.rows.map((row) => row.date));
    let previousSignalDate = null;
    const signals = market.signals.map((row, index) => {
      assert(row && typeof row.date === 'string' && priceDates.has(row.date),
        `${spec.key} signal ${index} has no exact target close`);
      assert(previousSignalDate === null || previousSignalDate < row.date,
        `${spec.key} signal dates are not strictly increasing`);
      assert(Number.isFinite(row.publishedScore), `${spec.key}/${row.date}: published score is invalid`);
      const componentKeys = Object.keys(row.components || {});
      assert(componentKeys.join(',') === core.COMPONENT_KEYS.join(','),
        `${spec.key}/${row.date}: component identity/order drifted`);
      for (const component of core.COMPONENT_KEYS) {
        assert(row.components[component] && Number.isFinite(row.components[component].score),
          `${spec.key}/${row.date}: ${component} score is invalid`);
      }
      previousSignalDate = row.date;
      return Object.freeze({
        date: row.date,
        publishedScore: row.publishedScore,
        components: Object.freeze(Object.fromEntries(core.COMPONENT_KEYS.map((component) => [
          component,
          Object.freeze({ score: row.components[component].score }),
        ]))),
        availableAtUtc: null,
      });
    });
    return Object.freeze({
      key: spec.key,
      name: market.name || spec.key,
      targetId: spec.targetId,
      targetAdjusted: market.prices.adjusted === true,
      marketClass: spec.marketClass,
      annualization: spec.annualization,
      prices: Object.freeze(market.prices.rows.map((row) => Object.freeze({ date: row.date, close: row.close }))),
      signals: Object.freeze(signals),
    });
  }));
}

function parseFrozenSnapshotBytes(bytes) {
  const decoded = copyHashAndDecodeBuffer(bytes);
  const actualSha256 = decoded.sha256;
  assert(actualSha256 === SNAPSHOT_SHA256,
    `Frozen snapshot hash drift: expected ${SNAPSHOT_SHA256}, got ${actualSha256}`);
  let snapshot;
  try { snapshot = JSON.parse(decoded.text); }
  catch { throw new Error('Frozen snapshot is not valid JSON'); }
  const parsed = Object.freeze({
    snapshot,
    snapshotSha256: actualSha256,
    inputs: snapshotToInputs(snapshot),
  });
  VERIFIED_PARSED_SNAPSHOTS.add(parsed);
  return parsed;
}

function loadFrozenSnapshot(snapshotPath = SNAPSHOT_PATH) {
  assert(path.resolve(snapshotPath) === path.resolve(SNAPSHOT_PATH), 'Only the preregistered snapshot path is accepted');
  return parseFrozenSnapshotBytes(fs.readFileSync(snapshotPath));
}

function compactMarketResult(coreMarket, gateMarket, spec) {
  return Object.freeze({
    key: spec.key,
    targetId: spec.targetId,
    targetSuitability: spec.suitability,
    action: coreMarket.currentSignal.action,
    targetPosition: coreMarket.currentSignal.targetPosition,
    decisionClose: coreMarket.currentSignal.decisionClose.date,
    trainingRows: coreMarket.currentSignal.trainingRowCount,
    coreAnalysisSha256: coreMarket.analysisSha256,
    gateResultSha256: gateMarket.resultSha256,
    status: gateMarket.status,
    investmentClaimAllowed: false,
    wealthRatios: gateMarket.metrics.wealthRatios,
    prequentialMse: gateMarket.metrics.prequentialMse,
    scoredDecisions: gateMarket.metrics.scoredDecisions,
    gates: gateMarket.gates,
  });
}

function computeFrozenStudy(parsed, gitCommit = null) {
  assert(parsed && VERIFIED_PARSED_SNAPSHOTS.has(parsed)
    && parsed.snapshotSha256 === SNAPSHOT_SHA256 && Array.isArray(parsed.inputs),
    'Parsed frozen snapshot identity is invalid');
  core.assertProtocolIdentity();
  const coreStudy = core.analyzeMarkets(parsed.inputs);
  // The analyzer deliberately refuses caller-supplied core outputs.  Give it
  // only the normalized market inputs so it independently reruns the learner,
  // ledgers, costs, labels, MSE and endpoints before evaluating any gate.
  const gateStudy = analyzer.analyzeFrozenResults(parsed.inputs.map((market) => ({ market })));
  assert(coreStudy.markets.length === MARKET_SPECS.length && gateStudy.markets.length === MARKET_SPECS.length,
    'Five-market result count drifted');
  for (let index = 0; index < MARKET_SPECS.length; index += 1) {
    assert(gateStudy.markets[index].identities.sourceAnalysisSha256
      === coreStudy.markets[index].analysisSha256,
    `${MARKET_SPECS[index].key}: independent analyzer/core result identity mismatch`);
  }
  const deterministic = {
    schemaVersion: 1,
    modelId: core.MODEL_ID,
    evidenceStatus: core.EVIDENCE_STATUS,
    replayKind: 'ONE_SHOT_RETROSPECTIVE_PREQUENTIAL_DEVELOPMENT_ONLY',
    inputSha256: parsed.snapshotSha256,
    gitCommit,
    identities: Object.freeze({
      protocol: core.assertProtocolIdentity(),
      runner: core.getRunnerIdentity(),
      modelConfig: core.getConfigIdentity(),
      analyzer: analyzer.getAnalyzerIdentity(),
      adapter: getAdapterIdentity(),
      normalizedInputsSha256: coreStudy.identities.normalizedInputsSha256,
      coreStudySha256: coreStudy.analysisSha256,
      gateStudySha256: gateStudy.resultSha256,
    }),
    status: gateStudy.status,
    universalPass: false,
    investmentClaimAllowed: false,
    markets: Object.freeze(MARKET_SPECS.map((spec, index) => (
      compactMarketResult(coreStudy.markets[index], gateStudy.markets[index], spec)
    ))),
    mandatoryMissingEvidence: Object.freeze([
      '999_SHIFT_FAMILYWISE_PLACEBO_NOT_IMPLEMENTED',
      'NO_PROSPECTIVE_DECISION_LEDGER',
      'ZERO_RETURN_CASH_ASSUMPTION',
    ]),
    wording: 'RESEARCH SIGNAL - RETROSPECTIVE, NOT VALIDATED',
  };
  deterministic.resultSha256 = core.hashCanonical(deterministic);
  return Object.freeze(deterministic);
}

function git(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function assertFrozenCleanCheckout() {
  assert(core.PROTOCOL_FREEZE_MARKER.startsWith('FROZEN_PRE_OUTCOME_'),
    'Protocol is not frozen pre-outcome');
  core.assertProtocolIdentity();
  const status = git(['status', '--porcelain=v1', '--untracked-files=all']);
  assert(status === '', 'Frozen retrospective replay requires a clean committed checkout');
  for (const file of [
    'research/FEAR_GREED_EXPANDING_BINARY_PROTOCOL.md',
    'research/fear_greed_expanding_binary.js',
    'research/fear_greed_expanding_binary_result_analyzer.js',
    'research/run_fear_greed_expanding_binary_frozen.js',
    'test/fear_greed_expanding_binary.test.js',
    'test/fear_greed_expanding_binary_result_analyzer.test.js',
    'test/run_fear_greed_expanding_binary_frozen.test.js',
  ]) git(['ls-files', '--error-unmatch', file]);
  return git(['rev-parse', 'HEAD']);
}

function writeResultArtifact(result, generatedAt = new Date().toISOString()) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const outputPath = path.join(OUTPUT_DIR, `fear-greed-expanding-binary-v1-${stamp}.json`);
  const envelope = Object.freeze({ generatedAt, ...result });
  fs.writeFileSync(outputPath, `${JSON.stringify(envelope, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  return Object.freeze({ outputPath, envelope });
}

function runCli(argv = process.argv.slice(2)) {
  assert(argv.length === 1 && argv[0] === EXECUTE_FLAG,
    `Direct execution is disabled; use exactly ${EXECUTE_FLAG}`);
  const gitCommit = assertFrozenCleanCheckout();
  const parsed = loadFrozenSnapshot();
  const first = computeFrozenStudy(parsed, gitCommit);
  const second = computeFrozenStudy(parsed, gitCommit);
  assert(first.resultSha256 === second.resultSha256, 'Double replay is not deterministic');
  const written = writeResultArtifact(first);
  process.stdout.write(`${JSON.stringify({
    outputPath: written.outputPath,
    resultSha256: first.resultSha256,
    status: first.status,
    universalPass: first.universalPass,
    markets: first.markets.map((market) => ({
      key: market.key,
      action: market.action,
      status: market.status,
      primaryX: market.wealthRatios.primary.full,
      stressX: market.wealthRatios.stress.full,
    })),
  }, null, 2)}\n`);
  return written;
}

if (require.main === module) {
  try { runCli(); }
  catch (error) {
    process.stderr.write(`${error && error.message ? error.message : error}\n`);
    process.exitCode = 1;
  }
}

module.exports = Object.freeze({
  SNAPSHOT_PATH,
  SNAPSHOT_SHA256,
  OUTPUT_DIR,
  EXECUTE_FLAG,
  EXPECTED_SCHEMA_VERSION,
  MARKET_SPECS,
  sha256Bytes,
  copyHashAndDecodeBuffer,
  getAdapterIdentity,
  snapshotToInputs,
  parseFrozenSnapshotBytes,
  loadFrozenSnapshot,
  assertFrozenCleanCheckout,
  runCli,
});
