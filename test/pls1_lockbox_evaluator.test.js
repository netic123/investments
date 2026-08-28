'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const common = require('../scripts/pls1-lockbox-common');
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

function temporaryLockboxRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pls1-evaluator-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'freeze'), { recursive: true });
  return root;
}

function addCanonicalHash(value, key) {
  value[key] = model.hashCanonical(value);
  return value;
}

function manifestFixture() {
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

function buildSyntheticGateFixture({ calendarStepDays = 2, activationM1Target = 'LONG',
  activationExecutionLogReturn = 0, activationOutcomeLogReturn = 0 } = {}) {
  const start = '2020-01-01';
  const bundleCount = N + 3;
  const manifest = manifestFixture();
  const manifestSha256 = model.hashCanonical(manifest);
  const dates = Array.from({ length: bundleCount }, (unused, index) => (
    isoDay(start, index * calendarStepDays)
  ));
  const targetCloses = [100];
  for (let endBundleIndex = 1; endBundleIndex < bundleCount; endBundleIndex += 1) {
    const originIndex = endBundleIndex - 3;
    const logReturn = endBundleIndex === 1 ? activationExecutionLogReturn
      : endBundleIndex === 2 ? activationOutcomeLogReturn
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
      if (bundleIndex === 0) return activationM1Target;
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
        ? (activationM1Target === 'LONG' ? 0.03 : -0.03)
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

function rehashEvent(recordedEvent) {
  delete recordedEvent.eventSha256;
  recordedEvent.eventSha256 = model.hashCanonical(recordedEvent);
}

function mutateDecisionAndRebindEvents(fixture, bundleIndex, market, modelKey, mutate) {
  const decision = fixture.bundles[bundleIndex].markets[market].decisions[modelKey];
  const priorSha256 = decision.decisionSha256;
  mutate(decision);
  delete decision.decisionSha256;
  decision.decisionSha256 = model.hashCanonical(decision);
  for (const bundle of fixture.bundles) {
    for (const recordedEvent of bundle.markets[market].resolvedEvents) {
      if (recordedEvent.model !== modelKey || recordedEvent.decisionSha256 !== priorSha256) continue;
      recordedEvent.decisionSha256 = decision.decisionSha256;
      rehashEvent(recordedEvent);
    }
  }
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

function makeFirstOriginZeroFactor(source) {
  const fixture = structuredClone(source);
  const originBundle = fixture.bundles[1];
  for (const market of common.MARKET_ORDER) {
    const record = originBundle.markets[market];
    record.fit.zeroFactor = true;
    record.fit.predictionM0 = 0;
    record.fit.predictionM1 = 0;
    delete record.fit.fitSha256;
    record.fit.fitSha256 = model.hashCanonical(record.fit);
    for (const modelKey of ['M0', 'M1']) {
      const decision = record.decisions[modelKey];
      const oldDecisionSha256 = decision.decisionSha256;
      decision.prediction = 0;
      decision.fallbackReason = model.ZERO_FACTOR_REASON;
      decision.zeroFactor = true;
      decision.fitSha256 = record.fit.fitSha256;
      delete decision.decisionSha256;
      decision.decisionSha256 = model.hashCanonical(decision);
      for (const laterBundle of fixture.bundles.slice(2, 4)) {
        const laterRecord = laterBundle.markets[market];
        for (const recordedEvent of laterRecord.resolvedEvents) {
          if (recordedEvent.decisionSha256 !== oldDecisionSha256) continue;
          recordedEvent.decisionSha256 = decision.decisionSha256;
          rehashEvent(recordedEvent);
        }
      }
    }
  }
  rebuildBundleChain(fixture);
  return fixture;
}

function addOneMissedDecisionSession(source, recoveryBundleIndex = 100) {
  const fixture = structuredClone(source);
  const recoveryBundle = fixture.bundles[recoveryBundleIndex];
  const precedingBundle = fixture.bundles[recoveryBundleIndex - 1];
  const missedDate = isoDay(precedingBundle.decisionDate, 1);
  for (const market of common.MARKET_ORDER) {
    const record = recoveryBundle.markets[market];
    const precedingRow = precedingBundle.markets[market].inputRow;
    const missedRow = {
      date: missedDate,
      targetClose: precedingRow.targetClose,
      cashClose: precedingRow.cashClose,
      availableAtUtc: null,
    };
    record.newRows = [missedRow, record.inputRow];
    record.newRowsSha256 = model.hashCanonical(record.newRows);
    record.missedDecisionDates = [missedDate];
    for (const modelKey of ['M0', 'M1']) {
      const priorDecision = fixture.bundles[recoveryBundleIndex - 1]
        .markets[market].decisions[modelKey];
      const twoBackDecision = fixture.bundles[recoveryBundleIndex - 2]
        .markets[market].decisions[modelKey];
      const fill = record.resolvedEvents.find(item => item.kind === 'FILL'
        && item.decisionSha256 === priorDecision.decisionSha256);
      fill.fillDate = missedDate;
      fill.targetClose = missedRow.targetClose;
      fill.cashClose = missedRow.cashClose;
      rehashEvent(fill);
      const earlierOutcome = record.resolvedEvents.find(item => item.kind === 'OUTCOME'
        && item.decisionSha256 === twoBackDecision.decisionSha256);
      earlierOutcome.outcomeEndDate = missedDate;
      earlierOutcome.relativeLogReturn = Math.log(missedRow.targetClose / precedingRow.targetClose)
        - Math.log(missedRow.cashClose / precedingRow.cashClose);
      rehashEvent(earlierOutcome);
      const nextRecord = fixture.bundles[recoveryBundleIndex + 1].markets[market];
      const movedIndex = nextRecord.resolvedEvents.findIndex(item => item.kind === 'OUTCOME'
        && item.decisionSha256 === priorDecision.decisionSha256);
      const [movedOutcome] = nextRecord.resolvedEvents.splice(movedIndex, 1);
      movedOutcome.executionDate = missedDate;
      movedOutcome.outcomeEndDate = record.inputRow.date;
      movedOutcome.relativeLogReturn = Math.log(record.inputRow.targetClose / missedRow.targetClose)
        - Math.log(record.inputRow.cashClose / missedRow.cashClose);
      rehashEvent(movedOutcome);
      record.resolvedEvents.push(movedOutcome);
    }
    record.resolvedEvents.sort((left, right) => {
      const leftDate = left.kind === 'FILL' ? left.fillDate : left.outcomeEndDate;
      const rightDate = right.kind === 'FILL' ? right.fillDate : right.outcomeEndDate;
      return leftDate.localeCompare(rightDate)
        || (left.kind === 'FILL' ? 0 : 1) - (right.kind === 'FILL' ? 0 : 1)
        || left.decisionDate.localeCompare(right.decisionDate)
        || left.model.localeCompare(right.model);
    });
  }
  rebuildBundleChain(fixture);
  return fixture;
}

function addMissedActivationSession(source) {
  const fixture = structuredClone(source);
  const activationBundle = fixture.bundles[0];
  const missedDate = isoDay(activationBundle.decisionDate, -1);
  for (const market of common.MARKET_ORDER) {
    const record = activationBundle.markets[market];
    const missedRow = {
      date: missedDate,
      targetClose: record.inputRow.targetClose,
      cashClose: record.inputRow.cashClose,
      availableAtUtc: null,
    };
    record.newRows = [missedRow, record.inputRow];
    record.newRowsSha256 = model.hashCanonical(record.newRows);
    record.missedDecisionDates = [missedDate];
  }
  rebuildBundleChain(fixture);
  return fixture;
}

function addIgnoredTailInsideMaturityBundle(source) {
  const fixture = structuredClone(source);
  const maturityBundle = fixture.bundles[N + 2];
  const outcomeDate = maturityBundle.decisionDate;
  const tailDate = isoDay(outcomeDate, 1);
  maturityBundle.decisionDate = tailDate;
  maturityBundle.collectedAtUtc = collectedAt(tailDate);
  for (const market of common.MARKET_ORDER) {
    const record = maturityBundle.markets[market];
    const outcomeRow = record.newRows[0];
    outcomeRow.availableAtUtc = null;
    const ignoredTail = {
      date: tailDate,
      targetClose: 1e200,
      cashClose: 1e-200,
      availableAtUtc: maturityBundle.collectedAtUtc,
    };
    record.newRows = [outcomeRow, ignoredTail];
    record.newRowsSha256 = model.hashCanonical(record.newRows);
    record.missedDecisionDates = [outcomeDate];
    record.inputRow = ignoredTail;
    record.inputRowSha256 = model.hashCanonical(ignoredTail);
    record.resolvedEvents.push({
      kind: 'OUTCOME',
      model: 'M1',
      decisionSha256: record.decisions.M1.decisionSha256,
      outcomeEndDate: tailDate,
      deliberatelyInvalidBeyondEndpoint: true,
    });
  }
  return fixture;
}

function hideMissedFinalOutcomeSession(source) {
  const fixture = structuredClone(source);
  const maturityBundle = fixture.bundles[N + 2];
  const hiddenDate = isoDay(fixture.bundles[N + 1].decisionDate, 1);
  for (const market of common.MARKET_ORDER) {
    const record = maturityBundle.markets[market];
    const laterDecisionRow = record.inputRow;
    const hiddenOutcomeRow = {
      date: hiddenDate,
      targetClose: laterDecisionRow.targetClose,
      cashClose: laterDecisionRow.cashClose,
      availableAtUtc: null,
    };
    record.newRows = [hiddenOutcomeRow, laterDecisionRow];
    record.newRowsSha256 = model.hashCanonical(record.newRows);
    record.missedDecisionDates = [];
    for (const modelKey of ['M0', 'M1']) {
      const originDecision = fixture.bundles[N].markets[market].decisions[modelKey];
      const outcome = record.resolvedEvents.find(item => item.kind === 'OUTCOME'
        && item.decisionSha256 === originDecision.decisionSha256);
      outcome.outcomeEndDate = hiddenDate;
      rehashEvent(outcome);
    }
  }
  rebuildBundleChain(fixture);
  return { fixture, hiddenDate };
}

function removeFinalWindowDecisions(source) {
  const fixture = structuredClone(source);
  for (const bundleIndex of [N + 1, N + 2]) {
    for (const market of common.MARKET_ORDER) {
      delete fixture.bundles[bundleIndex].markets[market].decisions;
      delete fixture.bundles[bundleIndex].markets[market].fit;
    }
  }
  rebuildBundleChain(fixture);
  return fixture;
}

function makeFinalWindowDecisionsFallbacks(source) {
  const fixture = structuredClone(source);
  for (const market of common.MARKET_ORDER) {
    const priorTargets = {
      M0: fixture.bundles[N].markets[market].decisions.M0.targetPosition,
      M1: fixture.bundles[N].markets[market].decisions.M1.targetPosition,
    };
    for (const bundleIndex of [N + 1, N + 2]) {
      const record = fixture.bundles[bundleIndex].markets[market];
      record.fit = null;
      for (const modelKey of ['M0', 'M1']) {
        const decision = record.decisions[modelKey];
        decision.prediction = null;
        decision.fallbackReason = model.INVALID_REASON;
        decision.fitFailureReason = null;
        decision.learnedFromHistory = false;
        decision.decisionBasis = 'PRE_REGISTERED_FAIL_CLOSED_POLICY';
        decision.currentFeaturesValid = false;
        decision.currentFeatureInvalidReasons = ['DETERMINISTIC_TEST_FALLBACK'];
        decision.filledPosition = priorTargets[modelKey];
        decision.targetPosition = 'CASH';
        decision.action = 'SELL';
        decision.tradeRequired = decision.filledPosition !== 'CASH';
        decision.fitSha256 = null;
        decision.zeroFactor = false;
        delete decision.decisionSha256;
        decision.decisionSha256 = model.hashCanonical(decision);
        priorTargets[modelKey] = decision.targetPosition;
      }
    }
  }
  rebuildBundleChain(fixture);
  return fixture;
}

test('the frozen Cephes survival function and coefficient identity match golden values', () => {
  assert.equal(Object.isFrozen(evaluator.ENDPOINT_CONTRACT), true);
  assert.equal(Object.isFrozen(evaluator.NORMAL_TAIL_COEFFICIENTS), true);
  assert.equal(Object.isFrozen(evaluator.NORMAL_TAIL_COEFFICIENTS.erfcP), true);
  assert.equal(evaluator.ENDPOINT_CONTRACT.normalTailCoefficientSha256,
    '56b4b0ed8b02f2a104e408432e79494ec875a84a703f8472fae1e59d1de39e4d');
  assert.deepEqual(evaluator.ENDPOINT_CONTRACT.zeroMissedDecisionOrigins, {
    required: true,
    window: 'ACTIVATION_BUNDLE_THROUGH_FIXED_ORIGIN_756_FINAL_OUTCOME_DATE_INCLUSIVE',
    effect: 'FAIL_STATISTICAL_GATES_WITHOUT_EXTENDING_OR_REPLACING_FIXED_ORIGINS',
  });
  assert.equal(model.hashCanonical(evaluator.ENDPOINT_CONTRACT),
    'a8c67a223b94c34bd761e14aa8d470d47cc8cfea5bde6762474959d4e0346992');
  assert.equal(evaluator.normalSurvival(0), 0.5);
  assert.ok(Math.abs(evaluator.normalSurvival(1) - 0.15865525393145707) < 1e-16);
  assert.ok(Math.abs(evaluator.normalSurvival(-1) - 0.8413447460685429) < 1e-16);
  assert.ok(Math.abs(evaluator.normalSurvival(1.959963984540054) - 0.025) < 2e-17);
  assert.ok(Math.abs(evaluator.normalSurvival(3) - 0.0013498980316300945) < 2e-18);
});

test('Clark-West fail-closes invalid variance and Holm uses exact thresholds and frozen tie order', () => {
  const zeros = Array(N).fill(0);
  const mseBelowBoundary = evaluator.forecastMse(zeros, Array(N).fill(1),
    Array(N).fill(Math.sqrt(0.994)));
  assert.equal(mseBelowBoundary.passed, true);
  assert.ok(mseBelowBoundary.M1 <= mseBelowBoundary.maximumAllowedM1);
  const exactBoundaryForecasts = Array(N).fill(0);
  for (let index = 0; index < 199; index += 1) exactBoundaryForecasts[index] = 1;
  exactBoundaryForecasts[199] = Math.sqrt((0.995 * N) - 199);
  const mseAtBoundary = evaluator.forecastMse(zeros, Array(N).fill(1),
    exactBoundaryForecasts);
  assert.equal(mseAtBoundary.M1, mseAtBoundary.maximumAllowedM1);
  assert.equal(mseAtBoundary.passed, true, 'the unrounded 0.995 boundary is inclusive');
  const mseAboveBoundary = evaluator.forecastMse(zeros, Array(N).fill(1),
    Array(N).fill(Math.sqrt(0.996)));
  assert.equal(mseAboveBoundary.passed, false);

  const outcomes = Array.from({ length: N }, (unused, index) => outcomeAt(index));
  const valid = evaluator.clarkWest(outcomes, Array(N).fill(0), outcomes);
  assert.equal(valid.ok, true);
  assert.ok(valid.z > 10);
  assert.ok(valid.pOneSided < 1e-20);
  const constant = evaluator.clarkWest(Array(N).fill(1), Array(N).fill(0),
    Array(N).fill(1));
  assert.equal(constant.ok, false);
  assert.equal(constant.z, null);
  assert.equal(constant.pOneSided, 1);

  const exact = Object.fromEntries(common.MARKET_ORDER.map((market, index) => [
    market, 0.05 / (common.MARKET_ORDER.length - index),
  ]));
  const passed = evaluator.holmStepDown(exact);
  assert.equal(passed.allRejected, true);
  assert.deepEqual(passed.ranked.map(row => row.market), common.MARKET_ORDER);
  const adjacent = { ...exact, usa: (0.05 / 4) + Number.EPSILON };
  const failed = evaluator.holmStepDown(adjacent);
  assert.equal(failed.allRejected, false);
  assert.equal(failed.ranked.find(row => row.market === 'usa').rejected, false);
  assert.equal(failed.ranked[3].rejected, false, 'Holm must stop after the first failure');

  const ties = evaluator.holmStepDown(Object.fromEntries(common.MARKET_ORDER.map(market => [market, 0.001])));
  assert.deepEqual(ties.ranked.map(row => row.market), common.MARKET_ORDER);
});

test('wealth applies each interval before its queued fill, charges one-way cost once, and never liquidates', () => {
  const rows = Array.from({ length: N + 3 }, (unused, index) => ({
    date: isoDay('2020-01-01', index),
    targetClose: index === 0 ? 100 : 50,
    cashClose: 100,
  }));
  const replay = evaluator.replayWealth(rows, Array(N + 1).fill('CASH'), 0.1);
  assert.equal(replay.ok, true);
  assert.equal(replay.terminalWealth, 0.45);
  assert.equal(replay.transitions, 1);
  assert.equal(replay.finalPosition, 'CASH');
  assert.equal(evaluator.buyAndHoldWealth(rows), 0.5);
});

test('endpoint wealth starts at activation close and requires the activation fill and outcome', () => {
  const longActivation = evaluator.evaluateProspectiveEndpoint(buildSyntheticGateFixture({
    activationM1Target: 'LONG',
    activationOutcomeLogReturn: 0.2,
  }));
  const cashFixture = buildSyntheticGateFixture({
    activationM1Target: 'CASH',
    activationOutcomeLogReturn: 0.2,
  });
  const cashActivation = evaluator.evaluateProspectiveEndpoint(cashFixture);
  assert.equal(longActivation.gates.coverage, true);
  assert.equal(cashActivation.gates.coverage, true);
  for (const market of common.MARKET_ORDER) {
    const longWealth = longActivation.markets[market].wealth;
    const cashWealth = cashActivation.markets[market].wealth;
    assert.equal(cashWealth.firstDate, cashFixture.bundles[0].decisionDate);
    assert.equal(cashWealth.activationDecisionRowIndex, 0);
    assert.equal(cashWealth.queuedDecisionRowIndices[0], 0);
    assert.ok(cashWealth.M1.stress.terminalWealth < longWealth.M1.stress.terminalWealth,
      'the activation CASH target must miss its next interval and incur the frozen transition cost');
    assert.ok(cashWealth.M1.stress.transitions > longWealth.M1.stress.transitions);
  }

  const missingFill = structuredClone(cashFixture);
  const activationDecisionSha = missingFill.bundles[0].markets.usa.decisions.M1.decisionSha256;
  missingFill.bundles[1].markets.usa.resolvedEvents = missingFill.bundles[1]
    .markets.usa.resolvedEvents.filter(recorded => !(
      recorded.kind === 'FILL' && recorded.model === 'M1'
      && recorded.decisionSha256 === activationDecisionSha
    ));
  rebuildBundleChain(missingFill);
  const rejected = evaluator.evaluateProspectiveEndpoint(missingFill);
  assert.equal(rejected.gates.coverage, false);
  assert.ok(rejected.failureReasons.some(reason => (
    reason.code === 'ACTIVATION_REQUIRES_EXACTLY_ONE_FIRST_SESSION_FILL'
      && reason.market === 'usa' && reason.model === 'M1' && reason.originNumber === 0
  )));
});

test('synthetic 756-origin plumbing fixture passes statistical gates but never issues trust', () => {
  const fixture = buildSyntheticGateFixture();
  const result = evaluator.evaluateProspectiveEndpoint(fixture);
  assert.equal(result.performanceDisclosed, true);
  assert.equal(result.endpoint.evaluable, true);
  assert.equal(result.endpoint.endpointBundleIndex, N + 2);
  assert.equal(result.endpoint.fixedOriginsPerMarket, N);
  assert.equal(result.endpoint.laterOriginsExcluded, true);
  assert.deepEqual(result.gates, model.canonicalize({
    endpoint: true,
    coverage: true,
    integrity: true,
    zeroMissedDecisionOrigins: true,
    mse: true,
    clarkWestHolm: true,
    wealth: true,
    x2: true,
  }));
  assert.equal(result.statisticalGatesPassed, true);
  assert.equal(result.x2StatisticalGatesPassed, true);
  assert.equal(result.statisticalVerdict, 'STATISTICAL_GATES_PASSED');
  assert.equal(result.x2StatisticalVerdict, 'X2_STATISTICAL_GATES_PASSED');
  assert.equal(result.trustVerdictAvailable, false);
  assert.equal(Object.hasOwn(result, 'trusted'), false);
  assert.equal(Object.hasOwn(result, 'x2Trusted'), false);
  assert.deepEqual(result.failureReasons, []);
  for (const market of common.MARKET_ORDER) {
    const record = result.markets[market];
    assert.equal(record.completeOrigins, N);
    assert.ok(record.mse.M1 < 1e-30);
    assert.equal(record.mse.passed, true);
    assert.equal(record.clarkWest.ok, true);
    assert.equal(record.wealth.rows, N + 3);
    assert.equal(record.wealth.activationDecisionRowIndex, 0);
    assert.equal(record.wealth.originRowIndices[0], 1);
    assert.deepEqual(record.wealth.queuedDecisionRowIndices.slice(0, 3), [0, 1, 2]);
    assert.ok(record.wealth.M1.stress.terminalWealth > record.wealth.M0.stress.terminalWealth);
    assert.ok(record.wealth.m1StressToBuyAndHoldRatio >= 2);
  }

  const poisonousLaterBundle = {
    mode: 'MUTATED_AFTER_FROZEN_ENDPOINT',
    decisionDate: 'not-a-date',
    collectedAtUtc: 'not-a-time',
    markets: { future: { leakedOutcome: 1e99 } },
  };
  const withLaterData = evaluator.evaluateProspectiveEndpoint({
    manifest: fixture.manifest,
    bundles: [...fixture.bundles, poisonousLaterBundle],
  });
  assert.equal(withLaterData.evaluationSha256, result.evaluationSha256);
  assert.deepEqual(withLaterData, result);
});

test('one invalid record in the first 756 fails closed and is never replaced by later origins', () => {
  const fixture = buildSyntheticGateFixture();
  const broken = structuredClone(fixture);
  const decision = broken.bundles[1].markets.usa.decisions.M1;
  decision.prediction = null;
  decision.decisionSha256 = model.hashCanonical(Object.fromEntries(
    Object.entries(decision).filter(([key]) => key !== 'decisionSha256'),
  ));
  const duplicatedFill = structuredClone(broken.bundles[2].markets.sweden.resolvedEvents
    .find(item => item.kind === 'FILL' && item.model === 'M0'));
  broken.bundles[2].markets.sweden.resolvedEvents.push(duplicatedFill);
  broken.bundles[2].markets.sweden.resolvedEvents.sort((left, right) => (
    left.model.localeCompare(right.model)
  ));
  rebuildBundleChain(broken);
  const result = evaluator.evaluateProspectiveEndpoint(broken);
  assert.equal(result.performanceDisclosed, true);
  assert.equal(result.endpoint.fixedOriginsPerMarket, N);
  assert.equal(result.endpoint.lastOriginDate, fixture.bundles[N].decisionDate);
  assert.equal(result.gates.coverage, false);
  assert.equal(result.gates.integrity, false);
  assert.equal(result.statisticalGatesPassed, false);
  assert.equal(result.x2StatisticalGatesPassed, false);
  assert.equal(result.statisticalVerdict, 'STATISTICAL_GATES_FAILED');
  assert.ok(result.failureReasons.some(reason => reason.code === 'DECISION_PREDICTION_NONFINITE_OR_MISSING'
    && reason.market === 'usa' && reason.originNumber === 1));
  assert.ok(result.failureReasons.some(reason => reason.code
    === 'ORIGIN_REQUIRES_EXACTLY_ONE_FIRST_SESSION_FILL' && reason.market === 'sweden'));
});

test('a zero-factor origin remains eligible when both frozen predictions are finite', () => {
  const result = evaluator.evaluateProspectiveEndpoint(
    makeFirstOriginZeroFactor(buildSyntheticGateFixture()),
  );
  assert.equal(result.gates.coverage, true);
  assert.equal(result.gates.integrity, true);
  assert.equal(result.statisticalGatesPassed, true);
  assert.equal(result.x2StatisticalGatesPassed, true);
  assert.deepEqual(result.failureReasons, []);
});

test('a missed decision origin fails statistical eligibility without replacement or row deletion', () => {
  const fixture = addOneMissedDecisionSession(buildSyntheticGateFixture(), 100);
  const result = evaluator.evaluateProspectiveEndpoint(fixture);
  assert.equal(result.statisticalGatesPassed, false);
  assert.equal(result.x2StatisticalGatesPassed, false);
  assert.equal(result.statisticalVerdict, 'STATISTICAL_GATES_FAILED');
  assert.equal(result.x2StatisticalVerdict, 'X2_STATISTICAL_GATES_FAILED');
  assert.equal(result.gates.coverage, true);
  assert.equal(result.gates.integrity, true);
  assert.equal(result.gates.zeroMissedDecisionOrigins, false);
  assert.equal(result.gates.mse, true);
  assert.equal(result.gates.clarkWestHolm, true);
  assert.equal(result.gates.wealth, true);
  assert.equal(result.gates.x2, true);
  assert.equal(result.endpoint.fixedOriginsPerMarket, N);
  assert.equal(result.endpoint.lastOriginDate, fixture.bundles[N].decisionDate);
  const missedDate = fixture.bundles[100].markets.usa.missedDecisionDates[0];
  const missedReasons = result.failureReasons.filter(reason => (
    reason.code === 'MISSED_DECISION_ORIGIN_IN_FIXED_ENDPOINT_WINDOW'
  ));
  assert.equal(missedReasons.length, common.MARKET_ORDER.length);
  assert.deepEqual(missedReasons.map(reason => reason.market),
    [...common.MARKET_ORDER].sort());
  assert.ok(missedReasons.every(reason => reason.decisionDate === missedDate
    && reason.detail === `recordedInBundleIndex=100;bundleDecisionDate=${fixture.bundles[100].decisionDate}`));
  assert.equal(result.failureReasons.length, common.MARKET_ORDER.length);
  for (const market of common.MARKET_ORDER) {
    const record = result.markets[market];
    assert.equal(record.completeOrigins, N);
    assert.equal(record.targetSessionRows, N + 4);
    assert.equal(record.missedDecisionSessionRows, 1);
    assert.equal(record.missedDecisionOriginCount, 1);
    assert.deepEqual(record.missedDecisionOriginDates, [missedDate]);
    assert.equal(record.zeroMissedDecisionOriginsPassed, false);
    assert.equal(record.gates.zeroMissedDecisionOrigins, false);
    assert.equal(record.wealth.rows, N + 4);
    assert.equal(record.wealth.originRowIndices[98], 99);
    assert.equal(record.wealth.originRowIndices[99], 101,
      'the missed target session is a wealth row but never a replacement origin');
  }
  const resolved = fixture.bundles[100].markets.usa.resolvedEvents;
  const priorDecision = fixture.bundles[99].markets.usa.decisions.M1;
  assert.ok(resolved.some(item => item.kind === 'FILL'
    && item.decisionSha256 === priorDecision.decisionSha256));
  assert.ok(resolved.some(item => item.kind === 'OUTCOME'
    && item.decisionSha256 === priorDecision.decisionSha256));
});

test('a missed activation decision session deterministically fails the frozen prerequisite', () => {
  const fixture = addMissedActivationSession(buildSyntheticGateFixture());
  const result = evaluator.evaluateProspectiveEndpoint(fixture);
  const missedDate = fixture.bundles[0].markets.usa.missedDecisionDates[0];
  assert.equal(result.performanceDisclosed, true);
  assert.equal(result.endpoint.fixedOriginsPerMarket, N);
  assert.equal(result.endpoint.lastOriginDate, fixture.bundles[N].decisionDate);
  assert.equal(result.gates.coverage, true);
  assert.equal(result.gates.integrity, true);
  assert.equal(result.gates.zeroMissedDecisionOrigins, false);
  assert.equal(result.statisticalGatesPassed, false);
  assert.equal(result.x2StatisticalGatesPassed, false);
  assert.deepEqual(result.failureReasons.map(reason => reason.code),
    Array(common.MARKET_ORDER.length).fill('MISSED_DECISION_ORIGIN_IN_FIXED_ENDPOINT_WINDOW'));
  assert.ok(result.failureReasons.every(reason => reason.decisionDate === missedDate
    && reason.detail === `recordedInBundleIndex=0;bundleDecisionDate=${fixture.bundles[0].decisionDate}`));
});

test('rows after outcome 756 stay outside metrics but unknown maturity-bundle events fail closed', () => {
  const baseline = evaluator.evaluateProspectiveEndpoint(buildSyntheticGateFixture());
  const tailed = evaluator.evaluateProspectiveEndpoint(
    addIgnoredTailInsideMaturityBundle(buildSyntheticGateFixture()),
  );
  assert.equal(tailed.statisticalGatesPassed, false,
    'the outcome-date row is still a missed decision inside the frozen endpoint window');
  assert.equal(tailed.x2StatisticalGatesPassed, false);
  assert.equal(tailed.gates.coverage, false);
  assert.equal(tailed.gates.integrity, false);
  assert.equal(tailed.gates.zeroMissedDecisionOrigins, false);
  assert.equal(tailed.endpoint.fixedOriginsPerMarket, N);
  assert.equal(tailed.endpoint.lastOriginDate, baseline.endpoint.lastOriginDate);
  assert.equal(tailed.endpoint.finalOutcomeDate, baseline.endpoint.finalOutcomeDate);
  assert.equal(tailed.failureReasons.filter(reason => (
    reason.code === 'MISSED_DECISION_ORIGIN_IN_FIXED_ENDPOINT_WINDOW'
  )).length, common.MARKET_ORDER.length);
  assert.equal(tailed.failureReasons.filter(reason => (
    reason.code === 'EVENT_SCHEMA_OR_KEYS_INVALID'
  )).length, common.MARKET_ORDER.length);
  for (const market of common.MARKET_ORDER) {
    assert.equal(tailed.markets[market].windowSha256, null);
    assert.equal(tailed.markets[market].wealth, null);
    assert.equal(tailed.markets[market].mse, null);
    assert.equal(tailed.markets[market].clarkWest, null);
    assert.equal(tailed.markets[market].targetSessionRows, N + 3);
  }
});

test('an undeclared missed final-outcome session fails closed without extending 756 origins', () => {
  const { fixture, hiddenDate } = hideMissedFinalOutcomeSession(
    buildSyntheticGateFixture(),
  );
  const result = evaluator.evaluateProspectiveEndpoint(fixture);
  assert.equal(result.endpoint.fixedOriginsPerMarket, N);
  assert.equal(result.endpoint.lastOriginDate, fixture.bundles[N].decisionDate);
  assert.equal(result.endpoint.finalOutcomeDate, hiddenDate);
  assert.equal(result.statisticalGatesPassed, false);
  assert.equal(result.x2StatisticalGatesPassed, false);
  assert.equal(result.gates.coverage, false);
  const failures = result.failureReasons.filter(reason => (
    reason.code === 'MARKET_NEW_ROWS_IDENTITY_MISMATCH'
      && reason.originNumber === N + 2
  ));
  assert.equal(failures.length, common.MARKET_ORDER.length);
  assert.deepEqual(failures.map(reason => reason.market), [...common.MARKET_ORDER].sort());
});

test('both final-window sessions require immutable binary decisions but allow fallbacks', () => {
  const missing = evaluator.evaluateProspectiveEndpoint(
    removeFinalWindowDecisions(buildSyntheticGateFixture()),
  );
  assert.equal(missing.endpoint.fixedOriginsPerMarket, N);
  assert.equal(missing.gates.coverage, false);
  assert.equal(missing.statisticalGatesPassed, false);
  const missingFailures = missing.failureReasons.filter(reason => (
    reason.code === 'POST_WINDOW_DECISION_MISSING'
  ));
  assert.equal(missingFailures.length, 2 * common.MARKET_ORDER.length * 2);
  assert.deepEqual([...new Set(missingFailures.map(reason => reason.originNumber))],
    [N + 1, N + 2]);

  const fallbacks = evaluator.evaluateProspectiveEndpoint(
    makeFinalWindowDecisionsFallbacks(buildSyntheticGateFixture()),
  );
  assert.equal(fallbacks.endpoint.fixedOriginsPerMarket, N);
  assert.equal(fallbacks.gates.coverage, true);
  assert.equal(fallbacks.gates.zeroMissedDecisionOrigins, true);
  assert.equal(fallbacks.statisticalGatesPassed, true);
  assert.deepEqual(fallbacks.failureReasons, []);
});

test('fixed-origin decisions require the exact frozen schema and exact key set', () => {
  const fixture = buildSyntheticGateFixture();
  const mutations = [
    ['usa', decision => { decision.schema = 'NOT_A_PLS1_DECISION'; }],
    ['sweden', decision => { delete decision.evidenceStatus; }],
    ['europe', decision => { decision.uncommittedOverride = true; }],
  ];
  for (const [market, mutate] of mutations) {
    const decision = fixture.bundles[1].markets[market].decisions.M1;
    mutate(decision);
    delete decision.decisionSha256;
    decision.decisionSha256 = model.hashCanonical(decision);
  }
  rebuildBundleChain(fixture);
  const result = evaluator.evaluateProspectiveEndpoint(fixture);
  assert.equal(result.gates.coverage, false);
  assert.equal(result.gates.integrity, false);
  assert.equal(result.statisticalGatesPassed, false);
  for (const market of mutations.map(([name]) => name)) {
    assert.ok(result.failureReasons.some(reason => (
      reason.code === 'DECISION_SCHEMA_OR_KEYS_INVALID'
        && reason.market === market && reason.model === 'M1' && reason.originNumber === 1
    )));
  }
});

test('rehashed fixed-origin decisions cannot change frozen evidence, history, or learned-policy semantics', () => {
  const fixture = buildSyntheticGateFixture();
  const mutations = [
    ['usa', decision => { decision.evidenceStatus = 'TRUSTED'; }],
    ['sweden', decision => { decision.learnedFromHistory = false; }],
    ['europe', decision => { decision.decisionBasis = 'PRE_REGISTERED_WARMUP_POLICY'; }],
    ['global', decision => { decision.learnerTruncatedSuppliedLedger = true; }],
    ['ustech', decision => { decision.sourceHistoryCompleteness = 'ASSUMED_COMPLETE'; }],
  ];
  for (const [market, mutate] of mutations) {
    mutateDecisionAndRebindEvents(fixture, 1, market, 'M1', mutate);
  }
  rebuildBundleChain(fixture);
  const result = evaluator.evaluateProspectiveEndpoint(fixture);
  assert.equal(result.gates.coverage, false);
  assert.equal(result.gates.integrity, false);
  assert.equal(result.statisticalGatesPassed, false);
  for (const [market] of mutations) {
    assert.ok(result.failureReasons.some(reason => (
      reason.code === 'DECISION_FROZEN_SEMANTICS_INVALID'
        && reason.market === market && reason.model === 'M1' && reason.originNumber === 1
    )));
  }
});

test('every event requires an exact schema and a known immutable decision origin', () => {
  const fixture = buildSyntheticGateFixture();
  const forgedSchema = fixture.bundles[2].markets.usa.resolvedEvents.find(
    recorded => recorded.kind === 'FILL' && recorded.model === 'M1',
  );
  forgedSchema.schema = 'fg-control-residual-pls1-forged-fill-v1';
  rehashEvent(forgedSchema);

  const unknown = structuredClone(fixture.bundles[2].markets.sweden.resolvedEvents.find(
    recorded => recorded.kind === 'FILL' && recorded.model === 'M0',
  ));
  unknown.decisionSha256 = 'f'.repeat(64);
  rehashEvent(unknown);
  fixture.bundles[2].markets.sweden.resolvedEvents.push(unknown);
  rebuildBundleChain(fixture);

  const result = evaluator.evaluateProspectiveEndpoint(fixture);
  assert.equal(result.gates.coverage, false);
  assert.equal(result.gates.integrity, false);
  assert.equal(result.statisticalGatesPassed, false);
  assert.ok(result.failureReasons.some(reason => (
    reason.code === 'FILL_EVENT_FROZEN_SEMANTICS_INVALID' && reason.market === 'usa'
  )));
  assert.ok(result.failureReasons.some(reason => (
    reason.code === 'EVENT_UNKNOWN_DECISION_ORIGIN' && reason.market === 'sweden'
  )));
});

test('manifest, bundle, and market records have closed schemas and frozen anti-claim fields', () => {
  const fixture = buildSyntheticGateFixture();
  fixture.manifest.trusted = true;
  fixture.bundles[0].verdict = 'TRUSTED';
  fixture.bundles[1].forbiddenUntilTrustGate = [];
  fixture.bundles[2].markets.usa.trusted = true;
  const result = evaluator.evaluateProspectiveEndpoint(fixture);
  assert.equal(result.statisticalGatesPassed, false);
  assert.equal(result.x2StatisticalGatesPassed, false);
  assert.equal(result.trustVerdictAvailable, false);
  assert.ok(result.failureReasons.some(reason => reason.code === 'MANIFEST_SCHEMA_OR_KEYS_INVALID'));
  assert.ok(result.failureReasons.some(reason => reason.code === 'BUNDLE_SCHEMA_OR_KEYS_INVALID'
    && reason.originNumber === 0));
  assert.ok(result.failureReasons.some(reason => (
    reason.code === 'BUNDLE_FORBIDDEN_CLAIMS_CONTRACT_MISMATCH' && reason.originNumber === 1
  )));
  assert.ok(result.failureReasons.some(reason => (
    reason.code === 'MARKET_RECORD_SCHEMA_OR_KEYS_INVALID'
      && reason.market === 'usa' && reason.originNumber === 2
  )));
});

test('post-window filled positions continue the immutable state chain through N plus 2', () => {
  const fixture = buildSyntheticGateFixture();
  const prior = fixture.bundles[N].markets.usa.decisions.M1;
  assert.equal(prior.targetPosition, 'CASH');
  const forged = fixture.bundles[N + 1].markets.usa.decisions.M1;
  forged.filledPosition = 'LONG';
  forged.targetPosition = 'LONG';
  forged.action = 'BUY';
  forged.tradeRequired = false;
  delete forged.decisionSha256;
  forged.decisionSha256 = model.hashCanonical(forged);
  rebuildBundleChain(fixture);

  const result = evaluator.evaluateProspectiveEndpoint(fixture);
  assert.equal(result.endpoint.fixedOriginsPerMarket, N);
  assert.equal(result.gates.coverage, false);
  assert.equal(result.statisticalGatesPassed, false);
  assert.ok(result.failureReasons.some(reason => (
    reason.code === 'POST_WINDOW_DECISION_FILLED_STATE_CHAIN_BROKEN'
      && reason.market === 'usa' && reason.model === 'M1' && reason.originNumber === N + 1
  )));
});

test('standalone evaluation hashes and parses seed, manifest, and bundles from one canonical read', t => {
  const root = temporaryLockboxRoot(t);
  const seedPath = path.join(root, 'freeze', 'seed.json');
  const manifestPath = path.join(root, 'freeze', 'manifest.json');
  const seed = common.createCanonicalWithSidecar(seedPath, { schema: 'test-seed-v1' });
  const manifest = manifestFixture();
  manifest.seed.sha256 = seed.sha256;
  common.createCanonicalWithSidecar(manifestPath, manifest);

  const nativeRead = fs.readFileSync.bind(fs);
  let seedBodyReads = 0;
  let manifestBodyReads = 0;
  t.mock.method(fs, 'readFileSync', (target, ...args) => {
    const resolved = path.resolve(String(target));
    if (resolved === path.resolve(seedPath)) seedBodyReads += 1;
    if (resolved === path.resolve(manifestPath)) {
      manifestBodyReads += 1;
      if (manifestBodyReads > 1) {
        return Buffer.from('{"schema":"forged-second-read"}\n');
      }
    }
    return nativeRead(target, ...args);
  });

  const result = evaluator.evaluateLockbox(root);
  assert.equal(result.performanceDisclosed, false);
  assert.equal(result.manifestSha256, model.hashCanonical(manifest));
  assert.equal(seedBodyReads, 1);
  assert.equal(manifestBodyReads, 1);
});

test('standalone evaluation rejects sidecar-valid but noncanonical JSON bytes', t => {
  const root = temporaryLockboxRoot(t);
  const seedPath = path.join(root, 'freeze', 'seed.json');
  const manifestPath = path.join(root, 'freeze', 'manifest.json');
  const seed = common.createCanonicalWithSidecar(seedPath, { schema: 'test-seed-v1' });
  const bytes = Buffer.from(`{"schema":"first","schema":"second","seed":{"sha256":"${seed.sha256}"}}\n`);
  fs.writeFileSync(manifestPath, bytes);
  fs.writeFileSync(`${manifestPath}.sha256`,
    common.sidecarBytes(path.basename(manifestPath), common.sha256(bytes)));
  assert.throws(() => evaluator.evaluateLockbox(root), /JSON bytes are not exact canonical bytes/);
});

test('performance remains undisclosed when 756 origins matured before the exact 1095-day UTC gate', () => {
  const start = '2020-01-01';
  const manifest = manifestFixture();
  const manifestSha256 = model.hashCanonical(manifest);
  let previousBundleSha256 = manifestSha256;
  let previousBundleDate = 'MANIFEST';
  const bundles = Array.from({ length: N + 3 }, (unused, index) => {
    const date = isoDay(start, index);
    const bundle = {
      schema: 'fg-control-residual-pls1-six-market-decision-bundle-v1',
      status: 'PROSPECTIVE_CANDIDATE_NOT_YET_TRUSTED',
      lockboxId: manifest.lockboxId,
      modelId: model.MODEL_ID,
      manifestSha256,
      seedSha256: manifest.seed.sha256,
      manifestCommitSha: '1'.repeat(40),
      mode: index === 0
        ? evaluator.ENDPOINT_CONTRACT.activationMode : evaluator.ENDPOINT_CONTRACT.regularMode,
      decisionDate: date,
      collectedAtUtc: collectedAt(date),
      signalKnownAtUtc: collectedAt(date),
      marketOrder: common.MARKET_ORDER,
      previousBundle: { decisionDate: previousBundleDate, sha256: previousBundleSha256 },
      remoteRun: {},
      sourceAcquisition: {},
      markets: {},
      forbiddenUntilTrustGate: ['TRUSTED', 'VALIDATED', 'BEATS_INDEX', '2X'],
    };
    for (const market of common.MARKET_ORDER) {
      const inputRow = { date, targetClose: 100 + index, cashClose: 100,
        availableAtUtc: bundle.collectedAtUtc };
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
        decisions: null,
        fit: null,
        resolvedEvents: [],
      };
    }
    previousBundleSha256 = model.hashCanonical(bundle);
    previousBundleDate = date;
    return bundle;
  });
  const result = evaluator.evaluateProspectiveEndpoint({ manifest, bundles });
  assert.equal(result.performanceDisclosed, false);
  assert.equal(result.endpoint.evaluable, false);
  assert.equal(result.endpoint.originSlotsObserved, N);
  assert.equal(result.endpoint.maturityRowsObserved, 2);
  assert.equal(result.endpoint.waitReason, 'WAITING_FOR_1095_DAY_TIME_GATE');
  assert.equal(result.markets, null);
  assert.equal(result.statisticalGatesPassed, false);
  assert.deepEqual(result.failureReasons, []);
});
