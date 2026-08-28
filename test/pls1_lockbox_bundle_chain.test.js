'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const common = require('../scripts/pls1-lockbox-common');
const seedBuilder = require('../scripts/build-pls1-lockbox-seed');
const manifestBuilder = require('../scripts/create-pls1-lockbox-manifest');
const collector = require('../scripts/pls1-lockbox-collect');
const verifier = require('../scripts/pls1-lockbox-verify');
const model = require('../research/fear_greed_control_residual_pls1');
const evaluator = require('../scripts/pls1-lockbox-evaluate');

const N = evaluator.ENDPOINT_CONTRACT.originsPerMarket;

function isoDay(start, offsetDays) {
  return new Date(Date.parse(`${start}T00:00:00.000Z`) + (offsetDays * 86400000))
    .toISOString().slice(0, 10);
}

function collectedAt(date) {
  return `${date}T06:17:00.000Z`;
}

function addCanonicalHash(value, key) {
  value[key] = model.hashCanonical(value);
  return value;
}

function endpointManifestFixture() {
  return {
    schema: 'fg-control-residual-pls1-manifest-v1',
    status: 'LOCKED_BEFORE_FIRST_PROSPECTIVE_DECISION',
    lockboxId: 'control-residual-pls1-v1',
    modelId: model.MODEL_ID,
    modelVersion: model.SCHEMA_VERSION,
    protocolFreezeMarker: model.PROTOCOL_FREEZE_MARKER,
    frozenAtUtc: '2026-08-28T00:00:00.000Z',
    sourceCommitSha: '1'.repeat(40),
    sourceTreeSha: '2'.repeat(40),
    runtime: {},
    seed: { sha256: 'a'.repeat(64) },
    schedule: {},
    marketOrder: common.MARKET_ORDER,
    componentOrder: model.COMPONENT_KEYS,
    controlOrder: model.CONTROL_KEYS,
    minimumMaturedRows: model.MIN_MATURED_ROWS,
    currentZLimit: model.CURRENT_Z_LIMIT,
    maximumCurrentControlMahalanobisRadius: model.MAX_CURRENT_CONTROL_MAHALANOBIS_RADIUS,
    maximumCurrentPlsScoreZ: model.MAX_CURRENT_PLS_SCORE_Z,
    numericTolerance: model.NUMERIC_TOLERANCE,
    maximumControlNormalConditionInfinity: model.MAX_CONTROL_NORMAL_CONDITION_INFINITY,
    exactDyadicComparisonPolicy: model.EXACT_DYADIC_COMPARISON_POLICY,
    label: 'frozen-relative-log-return-label',
    execution: 'first later target close',
    targets: {},
    cash: {},
    costs: model.COSTS,
    trustGate: {
      minimumCalendarDays: 1095,
      minimumMaturedForecastsPerMarket: 756,
      fixedFirstDecisionOriginsPerMarket: 756,
      extendWindowForMissingOrInvalidOrigins: false,
      m1MseRelativeToM0Maximum: 0.995,
      m1StressWealthMustExceed: ['M0', 'BUY_AND_HOLD'],
      clarkWestNeweyWestLag: 5,
      holmFamilyWiseAlpha: 0.05,
      x2EveryMarketMinimumRatio: 2,
      interimTuningOrEarlyGraduationAllowed: false,
    },
    upstream: {},
    dataRights: {},
    remoteIntegrity: {},
    knownLimitations: [],
    pinnedFiles: [],
  };
}

function outcomeAt(originIndex) {
  const pair = Math.floor(originIndex / 2);
  const magnitude = 0.03 + (0.001 * (pair % 7));
  return originIndex % 2 === 0 ? magnitude : -magnitude;
}

function makeFit(predictionM0, predictionM1, originNumber, market) {
  return addCanonicalHash({
    ok: true,
    zeroFactor: false,
    predictionM0,
    predictionM1,
    trainingRowCount: model.MIN_MATURED_ROWS + originNumber,
    frozenGoldenIdentity: `${market}:${originNumber}`,
  }, 'fitSha256');
}

function makeDecision({ market, modelKey, bundle, inputRow, fit, prediction,
  targetPosition, filledPosition, originNumber }) {
  return addCanonicalHash({
    schema: 'fg-control-residual-pls1-decision-v1',
    modelId: model.MODEL_ID,
    modelVersion: model.SCHEMA_VERSION,
    model: modelKey,
    market,
    marketName: market,
    marketClass: common.TARGETS[market].marketClass,
    targetId: common.TARGETS[market].symbol,
    cashId: common.CASH.symbol,
    decisionDate: bundle.decisionDate,
    decisionRowIndex: model.MIN_MATURED_ROWS + originNumber + 1,
    signalAvailableAtUtc: bundle.collectedAtUtc,
    earliestExecutionRule: 'FIRST_TARGET_CLOSE_STRICTLY_AFTER_FEATURE_CLOSE_AND_RECORDED_AVAILABILITY',
    action: targetPosition === 'LONG' ? 'BUY' : 'SELL',
    targetPosition,
    filledPosition,
    tradeRequired: targetPosition !== filledPosition,
    prediction,
    fallbackReason: null,
    fitFailureReason: null,
    learnedFromHistory: true,
    decisionBasis: 'LEARNED_FORECAST_WITH_STATEFUL_COST_HURDLE',
    currentFeaturesValid: true,
    currentFeatureInvalidReasons: [],
    trainingRowCount: model.MIN_MATURED_ROWS + originNumber,
    trainingStartDate: '2018-01-01',
    trainingEndDate: bundle.decisionDate,
    latestMaturedOutcomeClose: bundle.decisionDate,
    allHistoryStart: '2018-01-01',
    allHistoryEnd: bundle.decisionDate,
    allHistoryRows: model.MIN_MATURED_ROWS + originNumber + 2,
    learnerTruncatedSuppliedLedger: false,
    sourceHistoryCompleteness: 'REQUIRES_EXTERNAL_LOCKBOX_VERIFICATION',
    trainingRowsSha256: model.hashCanonical({ market, originNumber, rows: 'all-history' }),
    currentRowSha256: model.hashCanonical(inputRow),
    fitSha256: fit.fitSha256,
    zeroFactor: false,
    evidenceStatus: 'PROSPECTIVE_CANDIDATE_NOT_YET_TRUSTED',
  }, 'decisionSha256');
}

function event(kind, fields) {
  return addCanonicalHash({
    schema: `fg-control-residual-pls1-${kind.toLowerCase()}-v1`,
    kind,
    ...fields,
  }, 'eventSha256');
}

function buildSyntheticGateFixture() {
  const start = '2020-01-01';
  const calendarStepDays = 2;
  const bundleCount = N + 3;
  const manifest = endpointManifestFixture();
  const manifestSha256 = model.hashCanonical(manifest);
  const dates = Array.from({ length: bundleCount }, (unused, index) => (
    isoDay(start, index * calendarStepDays)
  ));
  const targetCloses = [100];
  for (let endBundleIndex = 1; endBundleIndex < bundleCount; endBundleIndex += 1) {
    const originIndex = endBundleIndex - 3;
    const logReturn = endBundleIndex <= 2 ? 0
      : originIndex >= 0 && originIndex < N ? outcomeAt(originIndex) : 0;
    targetCloses.push(targetCloses.at(-1) * Math.exp(logReturn));
  }
  const bundles = dates.map((date, bundleIndex) => ({
    schema: 'fg-control-residual-pls1-six-market-decision-bundle-v1',
    status: 'PROSPECTIVE_CANDIDATE_NOT_YET_TRUSTED',
    lockboxId: manifest.lockboxId,
    modelId: model.MODEL_ID,
    manifestSha256,
    seedSha256: manifest.seed.sha256,
    manifestCommitSha: '1'.repeat(40),
    mode: bundleIndex === 0
      ? evaluator.ENDPOINT_CONTRACT.activationMode : evaluator.ENDPOINT_CONTRACT.regularMode,
    decisionDate: date,
    collectedAtUtc: collectedAt(date),
    signalKnownAtUtc: collectedAt(date),
    marketOrder: common.MARKET_ORDER,
    remoteRun: {},
    sourceAcquisition: {},
    markets: {},
    forbiddenUntilTrustGate: ['TRUSTED', 'VALIDATED', 'BEATS_INDEX', '2X'],
  }));

  for (const market of common.MARKET_ORDER) {
    const targetStatesM1 = Array.from({ length: bundleCount }, (unused, bundleIndex) => {
      if (bundleIndex === 0) return 'LONG';
      if (bundleIndex > N) return 'LONG';
      return outcomeAt(bundleIndex - 1) > 0 ? 'LONG' : 'CASH';
    });
    for (let bundleIndex = 0; bundleIndex < bundleCount; bundleIndex += 1) {
      const bundle = bundles[bundleIndex];
      const inputRow = {
        date: bundle.decisionDate,
        targetClose: targetCloses[bundleIndex],
        cashClose: 100,
        availableAtUtc: bundle.collectedAtUtc,
      };
      const originIndex = bundleIndex - 1;
      const predictionM0 = 0;
      const predictionM1 = bundleIndex === 0
        ? 0.03
        : originIndex >= 0 && originIndex < N ? outcomeAt(originIndex) : 0.03;
      const fit = makeFit(predictionM0, predictionM1, bundleIndex + 1, market);
      const filledM1 = bundleIndex === 0 ? 'LONG' : targetStatesM1[bundleIndex - 1];
      const targetM1 = targetStatesM1[bundleIndex];
      const decisions = {
        M0: makeDecision({ market, modelKey: 'M0', bundle, inputRow, fit,
          prediction: predictionM0, targetPosition: 'LONG', filledPosition: 'LONG',
          originNumber: bundleIndex + 1 }),
        M1: makeDecision({ market, modelKey: 'M1', bundle, inputRow, fit,
          prediction: predictionM1, targetPosition: targetM1, filledPosition: filledM1,
          originNumber: bundleIndex + 1 }),
      };
      bundle.markets[market] = {
        marketClass: common.TARGETS[market].marketClass,
        sentimentReferenceId: market,
        targetId: common.TARGETS[market].symbol,
        cashId: common.CASH.symbol,
        newRows: [inputRow],
        newRowsSha256: model.hashCanonical([inputRow]),
        missedDecisionDates: [],
        inputRow,
        inputRowSha256: model.hashCanonical(inputRow),
        decisions,
        fit,
        resolvedEvents: [],
      };
    }
  }

  for (let currentBundleIndex = 1; currentBundleIndex < bundleCount; currentBundleIndex += 1) {
    for (const market of common.MARKET_ORDER) {
      const currentRecord = bundles[currentBundleIndex].markets[market];
      const currentRow = currentRecord.inputRow;
      const priorBundleIndex = currentBundleIndex - 1;
      if (priorBundleIndex >= 0 && priorBundleIndex <= N) {
        const originBundle = bundles[priorBundleIndex];
        const originRecord = originBundle.markets[market];
        for (const modelKey of ['M0', 'M1']) {
          const decision = originRecord.decisions[modelKey];
          const costs = model.COSTS[originRecord.marketClass];
          currentRecord.resolvedEvents.push(event('FILL', {
            market,
            model: modelKey,
            decisionSha256: decision.decisionSha256,
            decisionDate: decision.decisionDate,
            decisionRecordedAtUtc: originBundle.collectedAtUtc,
            fillDate: currentRow.date,
            filledPosition: decision.targetPosition,
            targetClose: currentRow.targetClose,
            cashClose: currentRow.cashClose,
            oneWayPrimaryCost: costs.primary,
            oneWayStressCost: costs.stress,
            costChargedOnlyIfStateChanged: decision.tradeRequired,
          }));
        }
      }
      const outcomeOriginBundleIndex = currentBundleIndex - 2;
      if (outcomeOriginBundleIndex >= 0 && outcomeOriginBundleIndex <= N) {
        const originBundle = bundles[outcomeOriginBundleIndex];
        const originRecord = originBundle.markets[market];
        const executionRow = bundles[outcomeOriginBundleIndex + 1].markets[market].inputRow;
        const relativeLogReturn = Math.log(currentRow.targetClose / executionRow.targetClose)
          - Math.log(currentRow.cashClose / executionRow.cashClose);
        for (const modelKey of ['M0', 'M1']) {
          const decision = originRecord.decisions[modelKey];
          currentRecord.resolvedEvents.push(event('OUTCOME', {
            market,
            model: modelKey,
            decisionSha256: decision.decisionSha256,
            decisionDate: decision.decisionDate,
            executionDate: executionRow.date,
            outcomeEndDate: currentRow.date,
            valid: true,
            invalidReason: null,
            relativeLogReturn,
          }));
        }
      }
    }
  }
  let previousBundleSha256 = manifestSha256;
  let previousBundleDate = 'MANIFEST';
  for (const bundle of bundles) {
    bundle.previousBundle = {
      decisionDate: previousBundleDate,
      sha256: previousBundleSha256,
    };
    previousBundleSha256 = model.hashCanonical(bundle);
    previousBundleDate = bundle.decisionDate;
  }
  return { manifest, bundles };
}

function rebuildBundleChain(fixture) {
  let previousBundleSha256 = model.hashCanonical(fixture.manifest);
  let previousBundleDate = 'MANIFEST';
  for (const bundle of fixture.bundles) {
    bundle.previousBundle = { decisionDate: previousBundleDate, sha256: previousBundleSha256 };
    previousBundleSha256 = model.hashCanonical(bundle);
    previousBundleDate = bundle.decisionDate;
  }
}

const baseFixture = buildSyntheticGateFixture();

test('an untampered bundle chain passes the evaluator with no BUNDLE_CHAIN_BROKEN issue', () => {
  const result = evaluator.evaluateProspectiveEndpoint(structuredClone(baseFixture));
  assert.equal(result.performanceDisclosed, true);
  assert.equal(result.gates.integrity, true);
  assert.equal(result.statisticalGatesPassed, true);
  assert.deepEqual(result.failureReasons, []);
  assert.equal(result.failureReasons.some(reason => reason.code === 'BUNDLE_CHAIN_BROKEN'),
    false);
});

test('rewriting a non-terminal historical bundle without a chain rebuild fails the integrity gate', () => {
  const tampered = structuredClone(baseFixture);
  tampered.bundles[5].manifestCommitSha = '6'.repeat(40);
  const result = evaluator.evaluateProspectiveEndpoint(tampered);
  assert.equal(result.performanceDisclosed, true);
  assert.deepEqual(result.failureReasons, model.canonicalize([{
    code: 'BUNDLE_CHAIN_BROKEN',
    decisionDate: tampered.bundles[6].decisionDate,
    originNumber: 6,
  }]));
  assert.equal(result.gates.integrity, false);
  assert.equal(result.gates.coverage, true,
    'the rewrite is self-consistent everywhere except the hash chain');
  assert.equal(result.statisticalGatesPassed, false);
  assert.equal(result.x2StatisticalGatesPassed, false);
  assert.equal(result.statisticalVerdict, 'STATISTICAL_GATES_FAILED');

  const rebuilt = structuredClone(baseFixture);
  rebuilt.bundles[5].manifestCommitSha = '6'.repeat(40);
  rebuildBundleChain(rebuilt);
  const rebuiltResult = evaluator.evaluateProspectiveEndpoint(rebuilt);
  assert.deepEqual(rebuiltResult.failureReasons, [],
    'only the hash chain binds a rewritten historical bundle, so its check must never regress');
});

test('a forged activation link to the manifest is BUNDLE_CHAIN_BROKEN at the activation bundle', () => {
  const tampered = structuredClone(baseFixture);
  tampered.bundles[0].previousBundle = { decisionDate: 'MANIFEST', sha256: 'f'.repeat(64) };
  const result = evaluator.evaluateProspectiveEndpoint(tampered);
  assert.deepEqual(result.failureReasons, model.canonicalize([
    {
      code: 'BUNDLE_CHAIN_BROKEN',
      decisionDate: tampered.bundles[0].decisionDate,
      originNumber: 0,
    },
    {
      code: 'BUNDLE_CHAIN_BROKEN',
      decisionDate: tampered.bundles[1].decisionDate,
      originNumber: 1,
    },
  ]));
  assert.equal(result.gates.integrity, false);
  assert.equal(result.statisticalGatesPassed, false);
});

function completedSessionDates(length, retrievalDateUtc = '2026-08-28') {
  const dates = [];
  const cursor = new Date(`${retrievalDateUtc}T00:00:00.000Z`);
  while (dates.length < length) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const date = cursor.toISOString().slice(0, 10);
    if (seedBuilder.isExpectedNyseSession(date)) dates.unshift(date);
  }
  return dates;
}

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pls1-bundle-chain-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function overwriteCanonicalWithSidecar(file, value) {
  const bytes = common.canonicalBytes(value);
  const digest = common.sha256(bytes);
  fs.writeFileSync(file, bytes);
  fs.writeFileSync(`${file}.sha256`, common.sidecarBytes(path.basename(file), digest));
}

function symbolSeed(symbol) {
  return [...symbol].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function yahooBody(symbol, length, { retrievalDateUtc = '2026-08-28', priceOffset = 0,
  firstTradeDate = null } = {}) {
  const seed = symbolSeed(symbol) + priceOffset;
  const dates = completedSessionDates(length, retrievalDateUtc);
  const timestamps = [];
  const closes = [];
  const adjusted = [];
  let value = 40 + (seed % 80);
  for (let index = 0; index < length; index += 1) {
    value *= Math.exp(0.00015 + (0.003 * Math.sin((index + seed) / (5 + (seed % 11))))
      + (0.0017 * Math.cos((index + (2 * seed)) / (13 + (seed % 7)))));
    timestamps.push(Date.parse(`${dates[index]}T12:00:00.000Z`) / 1000);
    closes.push(value);
    adjusted.push(value * (1 + ((index % 97) * 0.000001)));
  }
  return Buffer.from(JSON.stringify({
    chart: {
      result: [{
        meta: {
          symbol,
          exchangeTimezoneName: 'America/New_York',
          longName: `Synthetic ${symbol}`,
          currency: 'USD',
          exchangeName: symbol === 'ACWI' ? 'NMS' : 'PCX',
          instrumentType: 'ETF',
          firstTradeDate: firstTradeDate == null
            ? Date.parse(`${dates[0]}T14:30:00.000Z`) / 1000 : firstTradeDate,
        },
        timestamp: timestamps,
        indicators: { quote: [{ close: closes }], adjclose: [{ adjclose: adjusted }] },
      }],
      error: null,
    },
  }));
}

function sessionCalendar(firstDate, horizonDate = '2029-09-30') {
  const sessions = [];
  for (const cursor = new Date(`${firstDate}T00:00:00.000Z`);
    cursor.toISOString().slice(0, 10) <= horizonDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    if (seedBuilder.isExpectedNyseSession(date)) sessions.push(date);
  }
  return sessions;
}

function syntheticSourceIdentityContract(firstAdjustedDate) {
  const requiredSymbols = seedBuilder.requiredSourceSymbols();
  const sessions = sessionCalendar(firstAdjustedDate);
  const calendarId = 'SYNTHETIC_XNYS';
  const calendars = {
    [calendarId]: {
      evidenceReference: manifestBuilder.LOCAL_FIXTURE_EVIDENCE_REFERENCE,
      horizonDate: sessions.at(-1),
      sessions,
      sessionsSha256: model.hashCanonical(sessions),
      timezone: 'America/New_York',
    },
  };
  const firstTradeDate = Date.parse(`${firstAdjustedDate}T14:30:00.000Z`) / 1000;
  const identities = Object.fromEntries([...requiredSymbols].sort().map(symbol => [symbol, {
    calendarId,
    currency: 'USD',
    exchange: symbol === 'ACWI' ? 'NMS' : 'PCX',
    firstAdjustedDate,
    firstTradeDate,
    firstTradeDateLocal: firstAdjustedDate,
    instrumentType: 'ETF',
    providerSymbol: symbol,
    timezone: 'America/New_York',
  }]));
  return {
    calendars,
    evidenceReference: manifestBuilder.LOCAL_FIXTURE_EVIDENCE_REFERENCE,
    identities,
    requiredSymbols,
    schema: 'fg-control-residual-pls1-source-identities-v1',
    status: 'INDEPENDENTLY_VERIFIED_LICENSED_SOURCE_IDENTITIES',
  };
}

function sourceFixture(root, range, length, baseUtc, {
  retrievalDateUtc = baseUtc.slice(0, 10), fallbackSymbols = [], fallbackOrder = fallbackSymbols,
  sourceIdentityContract = null,
} = {}) {
  const contract = seedBuilder.expectedSourceContract(range);
  const firstDate = completedSessionDates(length, retrievalDateUtc)[0];
  const identities = sourceIdentityContract || syntheticSourceIdentityContract(firstDate);
  const sourceSelections = [];
  const receipts = [];
  function pushReceipt(selection, host, status, acceptedFor) {
    const ordinal = receipts.length;
    const phase = selection.role === 'COMPONENT' ? 'COMPONENT' : 'EXECUTABLE';
    const requestedRange = selection.requestedRange;
    const startedAtUtc = new Date(Date.parse(baseUtc) + (ordinal * 2000)).toISOString();
    const period2 = phase === 'COMPONENT'
      ? Math.floor(Date.parse(startedAtUtc) / 1000) + 86400
      : Math.floor(Date.parse(`${retrievalDateUtc}T00:00:00.000Z`) / 1000) + 86400;
    const query = requestedRange === 'max'
      ? `period1=0&period2=${period2}&interval=1d${phase === 'EXECUTABLE' ? '&events=div%2Csplits' : ''}`
      : `range=${requestedRange}&interval=1d${phase === 'EXECUTABLE' ? '&events=div%2Csplits' : ''}`;
    const bytes = yahooBody(selection.symbol, length, { retrievalDateUtc,
      firstTradeDate: identities.identities[selection.symbol].firstTradeDate });
    const raw = common.createRawBlob(root, bytes);
    const completedAtUtc = new Date(Date.parse(startedAtUtc) + 1000).toISOString();
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(selection.symbol)}?${query}`;
    receipts.push({
      requestOrdinal: ordinal,
      phase,
      method: 'GET',
      url,
      startedAtUtc,
      completedAtUtc,
      status,
      responseUrl: url,
      headers: { 'content-type': 'application/json' },
      acceptedFor: acceptedFor ? [selection.acceptedFor] : [],
      error: null,
      path: raw.path,
      rawSha256: raw.rawSha256,
      rawBytes: raw.rawBytes,
      gzipSha256: raw.gzipSha256,
      gzipBytes: raw.gzipBytes,
    });
    return ordinal;
  }
  const components = contract.selections.filter(selection => selection.role === 'COMPONENT');
  const executables = contract.selections.filter(selection => selection.role !== 'COMPONENT');
  for (const selection of components) {
    const requestOrdinal = pushReceipt(selection, 'query1.finance.yahoo.com', 200, true);
    sourceSelections.push({ ...selection, requestOrdinal });
  }
  const executableSelectionOrdinals = new Map();
  for (const selection of executables) {
    const fallback = fallbackSymbols.includes(selection.symbol);
    const requestOrdinal = pushReceipt(selection, 'query1.finance.yahoo.com', fallback ? 500 : 200, !fallback);
    if (!fallback) executableSelectionOrdinals.set(selection.symbol, requestOrdinal);
  }
  for (const symbol of fallbackOrder) {
    const selection = executables.find(item => item.symbol === symbol);
    if (!selection || !fallbackSymbols.includes(symbol)) throw new Error(`invalid fallback fixture symbol ${symbol}`);
    const requestOrdinal = pushReceipt(selection, 'query2.finance.yahoo.com', 200, true);
    executableSelectionOrdinals.set(symbol, requestOrdinal);
  }
  for (const selection of executables) {
    sourceSelections.push({ ...selection,
      requestOrdinal: executableSelectionOrdinals.get(selection.symbol) });
  }
  const replay = seedBuilder.replayAlignedDataFromReceipts({
    receipts,
    sourceSelections,
    loadRaw: receipt => common.verifyRawBlob(root, receipt),
    range,
    retrievalDateUtc,
    sourceIdentityContract: identities,
  });
  return { ...replay, receipts, sourceSelections, retrievalDateUtc,
    sourceIdentityContract: identities };
}

function lockboxManifestFixture(seed, seedSha256) {
  return {
    schema: 'fg-control-residual-pls1-manifest-v1',
    status: 'LOCKED_BEFORE_FIRST_PROSPECTIVE_DECISION',
    lockboxId: common.LOCKBOX_ID,
    modelId: model.MODEL_ID,
    modelVersion: model.SCHEMA_VERSION,
    protocolFreezeMarker: model.PROTOCOL_FREEZE_MARKER,
    frozenAtUtc: '2026-08-28T06:55:00.000Z',
    sourceCommitSha: '1'.repeat(40),
    sourceTreeSha: '2'.repeat(40),
    runtime: {
      required: common.REQUIRED_RUNTIME,
      productionPlatform: 'linux',
      productionArch: 'x64',
      mismatchPolicy: 'NEW_MANIFEST_REQUIRED_UNLESS_BYTE_EQUIVALENCE_IS_PROVED_BEFORE_ANY_NEW_DECISION',
    },
    seed: {
      path: 'freeze/seed.json', sha256: seedSha256,
      status: seed.status, createdAtUtc: seed.createdAtUtc,
    },
    schedule: {
      triggerExpressionsUtc: common.SCHEDULE_EXPRESSIONS,
      activationRule: 'first qualifying remote run automatically activates only on a target session strictly after the complete seed',
      decisionSafetyCutoffUtc: '12:00:00Z',
      semanticKey: ['manifestSha256', 'decisionDate'],
      nominalDelayIsEvidence: false,
      missedSessionsAreBackfilledAsDecisions: false,
      missedSessionsRemainInPrimaryPriceLedger: true,
    },
    marketOrder: common.MARKET_ORDER,
    componentOrder: model.COMPONENT_KEYS,
    controlOrder: model.CONTROL_KEYS,
    minimumMaturedRows: model.MIN_MATURED_ROWS,
    currentZLimit: model.CURRENT_Z_LIMIT,
    maximumCurrentControlMahalanobisRadius: model.MAX_CURRENT_CONTROL_MAHALANOBIS_RADIUS,
    maximumCurrentPlsScoreZ: model.MAX_CURRENT_PLS_SCORE_Z,
    numericTolerance: model.NUMERIC_TOLERANCE,
    maximumControlNormalConditionInfinity: model.MAX_CONTROL_NORMAL_CONDITION_INFINITY,
    exactDyadicComparisonPolicy: model.EXACT_DYADIC_COMPARISON_POLICY,
    label: 'log(riskyAdjustedClose[t+2]/riskyAdjustedClose[t+1])-log(BILAdjustedClose[t+2]/BILAdjustedClose[t+1])',
    execution: 'first target close strictly after feature close and recorded availability',
    costs: model.COSTS,
    targets: Object.fromEntries(common.MARKET_ORDER.map(key => {
      const target = common.TARGETS[key];
      return [key, { ...target, ...manifestBuilder.INSTRUMENT_IDENTITIES[target.symbol] }];
    })),
    cash: { ...common.CASH, ...manifestBuilder.INSTRUMENT_IDENTITIES[common.CASH.symbol] },
    upstream: {
      fearGreedEngine: 'repository production-v2 six-component engine',
      marketDataProvider: 'Yahoo Finance chart endpoint',
      adjustedClosePolicy: 'whole positive adjusted-close series required; no adjusted/unadjusted mixing',
      carryLimitCalendarDays: 7,
      userAgent: 'netic123-investments-pls1-lockbox/1.0',
      rawPolicy: 'exact decoded response-body bytes stored as deterministic gzip addressed by uncompressed SHA-256',
    },
    trustGate: {
      minimumCalendarDays: 1095,
      minimumMaturedForecastsPerMarket: 756,
      fixedFirstDecisionOriginsPerMarket: 756,
      extendWindowForMissingOrInvalidOrigins: false,
      m1MseRelativeToM0Maximum: 0.995,
      m1StressWealthMustExceed: ['M0', 'BUY_AND_HOLD'],
      clarkWestNeweyWestLag: 5,
      holmFamilyWiseAlpha: 0.05,
      x2EveryMarketMinimumRatio: 2,
      interimTuningOrEarlyGraduationAllowed: false,
    },
    dataRights: {
      requiredBeforeActivation: true,
      status: manifestBuilder.DATA_RIGHTS_STATUS.LOCAL_FIXTURE,
      evidenceReference: manifestBuilder.LOCAL_FIXTURE_EVIDENCE_REFERENCE,
      requiredScope: 'AUTOMATED_RETRIEVAL_PRIVATE_RETENTION_AND_PUBLIC_RAW_REDISTRIBUTION_INDEFINITELY',
      coveredSymbols: seed.sourceIdentityContract.requiredSymbols,
    },
    remoteIntegrity: {
      actionsApiBaseUrl: common.GITHUB_REMOTE.apiBaseUrl,
      repository: common.GITHUB_REMOTE.repository,
      repositoryId: common.GITHUB_REMOTE.repositoryId,
      branch: common.GITHUB_REMOTE.branch,
      ref: common.GITHUB_REMOTE.ref,
      serverUrl: common.GITHUB_REMOTE.serverUrl,
      workflowId: '123456789',
      workflowPath: common.GITHUB_REMOTE.workflowPath,
      workflowRef: common.GITHUB_REMOTE.workflowRef,
      branchProtectionRequired: true,
      forcePushAndDeletionBlockedRequired: true,
      enforceAdminsRequired: true,
      branchProtectionSnapshotSha256: '0'.repeat(64),
      independentTimestampAnchorRequired: true,
      independentTimestampAnchorReference: 'LOCAL_TEST_FIXTURE_ONLY',
    },
    knownLimitations: [
      'BITW does not replicate the fixed seven-coin equal-weight sentiment reference basket',
      'BITW history before its December 2025 NYSE Arca uplisting reflects its earlier quoted structure',
      'historical seed availability times are unknowable and seed rows never count as validation',
      'predictive trust requires future outcomes; activation alone is not validation',
      'adjusted-close fills are hypothetical total-return proxy fills, not quoted or executed trades',
      'source license and retention rights are a trust prerequisite, not inferred from endpoint availability',
    ],
    pinnedFiles: manifestBuilder.PINNED_FILES.map(relativePath => ({
      path: relativePath,
      sha256: relativePath === 'research/PLS1_SOURCE_IDENTITY_CONTRACT.json'
        ? seed.sourceIdentityContractSha256 : 'a'.repeat(64),
      bytes: 1,
    })),
  };
}

function createFixture(t) {
  const root = temporaryRoot(t);
  const seedFirstDate = completedSessionDates(1400, '2026-08-27')[0];
  const sourceIdentityContract = syntheticSourceIdentityContract(seedFirstDate);
  const seedSource = sourceFixture(root, 'max', 1400, '2026-08-27T05:00:00.000Z', {
    sourceIdentityContract,
  });
  const markets = seedSource.markets;
  const seed = {
    schema: 'fg-control-residual-pls1-seed-v1',
    status: 'PRE_ACTIVATION_WARMUP_ONLY_NOT_VALIDATION_EVIDENCE',
    lockboxId: common.LOCKBOX_ID,
    modelId: model.MODEL_ID,
    createdAtUtc: '2026-08-27T05:30:00.000Z',
    retrievalDateUtc: seedSource.retrievalDateUtc,
    sourceCommitSha: '1'.repeat(40),
    sourceTreeSha: '2'.repeat(40),
    sourceRuntime: common.runtimeIdentity(),
    sourceIdentityContract,
    sourceIdentityContractSha256: model.hashCanonical(sourceIdentityContract),
    marketOrder: common.MARKET_ORDER,
    componentOrder: model.COMPONENT_KEYS,
    cash: common.CASH,
    cashMetadata: seedSource.cashMetadata,
    marketfgNormalizedSha256: seedSource.marketfgNormalizedSha256,
    targetCalendarSha256: seedSource.targetCalendarSha256,
    firstProspectiveDecisionMustBeAfter: Object.fromEntries(common.MARKET_ORDER.map(key => [
      key, markets[key].rows.at(-1).date,
    ])),
    sourceSelections: seedSource.sourceSelections,
    sourceReceipts: seedSource.receipts,
    markets,
  };
  const seedPath = path.join(root, 'freeze', 'seed.json');
  const seedWrite = common.createCanonicalWithSidecar(seedPath, seed);
  const manifest = lockboxManifestFixture(seed, seedWrite.sha256);
  const manifestPath = path.join(root, 'freeze', 'manifest.json');
  const manifestWrite = common.createCanonicalWithSidecar(manifestPath, manifest);
  const liveSource = sourceFixture(root, '5y', 1000, '2026-08-28T06:30:00.000Z', {
    sourceIdentityContract,
  });
  const acquired = {
    acquiredAtUtc: '2026-08-28T06:50:00.000Z',
    retrievalDateUtc: liveSource.retrievalDateUtc,
    range: '5y',
    markets: liveSource.markets,
    sourceSelections: liveSource.sourceSelections,
    cashMetadata: liveSource.cashMetadata,
    marketfgNormalizedSha256: liveSource.marketfgNormalizedSha256,
    targetCalendarSha256: liveSource.targetCalendarSha256,
  };
  return {
    root, seed, seedSha256: seedWrite.sha256, manifest,
    manifestSha256: manifestWrite.sha256, acquired,
    liveReceipts: liveSource.receipts, sourceIdentityContract,
  };
}

test('the offline verifier rejects a rewritten historical bundle with a self-consistent sidecar', t => {
  const fixture = createFixture(t);
  const firstCollectedAtUtc = '2026-08-28T07:30:00.000Z';
  const firstNewRowsByMarket = Object.fromEntries(common.MARKET_ORDER.map(key => [key,
    collector.prospectiveRows(fixture.acquired.markets[key], fixture.seed.markets[key].rows,
      firstCollectedAtUtc),
  ]));
  const firstBundle = collector.buildDecisionBundle({
    seed: fixture.seed,
    manifest: fixture.manifest,
    seedSha256: fixture.seedSha256,
    manifestSha256: fixture.manifestSha256,
    manifestCommit: { commitSha: '5'.repeat(40) },
    acquired: fixture.acquired,
    sourceReceipts: fixture.liveReceipts,
    bundles: [],
    collectedAtUtc: firstCollectedAtUtc,
    provenance: collector.localTestProvenance('2026-08-28T06:00:00.000Z'),
    newRowsByMarket: firstNewRowsByMarket,
  });
  const firstFile = common.decisionPath(fixture.root, firstBundle.decisionDate);
  const firstWrite = common.createCanonicalWithSidecar(firstFile, firstBundle);

  const secondSource = sourceFixture(fixture.root, '5y', 1000, '2026-08-29T06:30:00.000Z', {
    sourceIdentityContract: fixture.sourceIdentityContract,
  });
  const secondAcquired = {
    acquiredAtUtc: '2026-08-29T06:50:00.000Z',
    retrievalDateUtc: secondSource.retrievalDateUtc,
    range: '5y',
    markets: secondSource.markets,
    sourceSelections: secondSource.sourceSelections,
    cashMetadata: secondSource.cashMetadata,
    marketfgNormalizedSha256: secondSource.marketfgNormalizedSha256,
    targetCalendarSha256: secondSource.targetCalendarSha256,
  };
  const priorBundles = [{ file: firstFile, sha256: firstWrite.sha256, value: firstBundle }];
  const secondCollectedAtUtc = '2026-08-29T07:30:00.000Z';
  const secondNewRowsByMarket = Object.fromEntries(common.MARKET_ORDER.map(key => [key,
    collector.prospectiveRows(secondAcquired.markets[key],
      collector.historicalRows(fixture.seed.markets[key], priorBundles, key),
      secondCollectedAtUtc),
  ]));
  const secondBundle = collector.buildDecisionBundle({
    seed: fixture.seed,
    manifest: fixture.manifest,
    seedSha256: fixture.seedSha256,
    manifestSha256: fixture.manifestSha256,
    manifestCommit: { commitSha: '5'.repeat(40) },
    acquired: secondAcquired,
    sourceReceipts: secondSource.receipts,
    bundles: priorBundles,
    collectedAtUtc: secondCollectedAtUtc,
    provenance: {
      ...collector.localTestProvenance('2026-08-29T06:00:00.000Z'),
      runId: 'local-test-2',
    },
    newRowsByMarket: secondNewRowsByMarket,
  });
  common.createCanonicalWithSidecar(
    common.decisionPath(fixture.root, secondBundle.decisionDate), secondBundle,
  );
  assert.equal(secondBundle.previousBundle.sha256, firstWrite.sha256);
  assert.equal(secondBundle.previousBundle.decisionDate, firstBundle.decisionDate);

  const baseline = verifier.verifyLockbox(fixture.root, { verifyPinnedFiles: false });
  assert.equal(baseline.ok, true);
  assert.equal(baseline.decisions, 2);
  assert.equal(baseline.firstDecision, firstBundle.decisionDate);
  assert.equal(baseline.lastDecision, secondBundle.decisionDate);

  const rewritten = structuredClone(firstBundle);
  rewritten.manifestCommitSha = '6'.repeat(40);
  overwriteCanonicalWithSidecar(firstFile, rewritten);
  assert.throws(() => verifier.verifyLockbox(fixture.root, { verifyPinnedFiles: false }),
    /bundle chain broken/);

  overwriteCanonicalWithSidecar(firstFile, firstBundle);
  assert.equal(verifier.verifyLockbox(fixture.root, { verifyPinnedFiles: false }).ok, true);
});
