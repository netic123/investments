'use strict';

const path = require('node:path');
const common = require('./pls1-lockbox-common');
const model = require('../research/fear_greed_control_residual_pls1');

// Capture the evidence-critical intrinsics before any caller can mutate the
// ambient realm after this module has loaded. The protocol separately requires
// a clean, pinned Node process at module-load time.
const NATIVE_ARRAY_SORT = Function.prototype.call.bind(Array.prototype.sort);
const NATIVE_JSON_STRINGIFY = JSON.stringify;
const NATIVE_NUMBER_IS_FINITE = Number.isFinite;
const NATIVE_OBJECT_FREEZE = Object.freeze;
const NATIVE_OBJECT_IS_FROZEN = Object.isFrozen;
const NATIVE_OBJECT_VALUES = Object.values;

const NORMAL_TAIL_COEFFICIENTS = deepFreeze({
  algorithm: 'CEPHES_ERFC_IEEE754_BINARY64_V1',
  erfT: [
    9.60497373987051638749e0,
    9.00260197203842689217e1,
    2.23200534594684319226e3,
    7.00332514112805075473e3,
    5.55923013010394962768e4,
  ],
  erfU: [
    3.35617141647503099647e1,
    5.21357949780152679795e2,
    4.59432382970980127987e3,
    2.26290000613890934246e4,
    4.92673942608635921086e4,
  ],
  erfcP: [
    2.46196981473530512524e-10,
    5.64189564831068821977e-1,
    7.46321056442269912687e0,
    4.86371970985681366614e1,
    1.96520832956077098242e2,
    5.26445194995477358631e2,
    9.34528527171957607540e2,
    1.02755188689515710272e3,
    5.57535335369399327526e2,
  ],
  erfcQ: [
    1.32281951154744992508e1,
    8.67072140885989742329e1,
    3.54937778887819891062e2,
    9.75708501743205489753e2,
    1.82390916687909736289e3,
    2.24633760818710981792e3,
    1.65666309194161350182e3,
    5.57535340817727675546e2,
  ],
  erfcR: [
    5.64189583547755073984e-1,
    1.27536670759978104416e0,
    5.01905042251180477414e0,
    6.16021097993053585195e0,
    7.40974269950448939160e0,
    2.97886665372100240670e0,
  ],
  erfcS: [
    2.26052863220117276590e0,
    9.39603524938001434673e0,
    1.20489539808096656605e1,
    1.70814450747565897222e1,
    9.60896809063285878198e0,
    3.36907645100081516050e0,
  ],
});

const ENDPOINT_CONTRACT = deepFreeze({
  schema: 'fg-control-residual-pls1-endpoint-contract-v1',
  modelId: model.MODEL_ID,
  marketOrder: [...common.MARKET_ORDER],
  activationMode: 'POST_MANIFEST_REMOTE_ACTIVATION',
  regularMode: 'DAILY_OR_RECOVERY_REMOTE_RUN',
  originsPerMarket: 756,
  originWindow: 'FIRST_756_DECISION_ORIGINS_STRICTLY_AFTER_ACTIVATION_BY_TARGET_DATE',
  extendOrReplaceInvalidOrigins: false,
  missedTargetSessions: 'WEALTH_AND_MATURITY_ROWS_NOT_DECISION_ORIGINS',
  zeroMissedDecisionOrigins: {
    required: true,
    window: 'ACTIVATION_BUNDLE_THROUGH_FIXED_ORIGIN_756_FINAL_OUTCOME_DATE_INCLUSIVE',
    effect: 'FAIL_STATISTICAL_GATES_WITHOUT_EXTENDING_OR_REPLACING_FIXED_ORIGINS',
  },
  outcomeSessionOffset: 2,
  minimumElapsedDays: 1095,
  minimumElapsedSeconds: 1095 * 86400,
  minimumMaturedRowsAtOrigin: model.MIN_MATURED_ROWS,
  zeroFactorEligibleWhenBothPredictionsFinite: true,
  mseM1ToM0MaximumRatio: 0.995,
  clarkWest: {
    lossDifferential: 'e0^2-e1^2+(f0-f1)^2',
    neweyWestLag: 5,
    autocovarianceDenominator: 756,
    bartlettWeight: '1-h/6',
    alternative: 'MEAN_D_GREATER_THAN_ZERO',
    pValue: '0.5*CEPHES_ERFC(z/sqrt(2))',
    invalidVariancePValue: 1,
  },
  holm: {
    familyWiseAlpha: 0.05,
    hypotheses: 6,
    order: [...common.MARKET_ORDER],
    tieBreak: 'FROZEN_MARKET_ORDER',
    comparison: 'P_LE_ALPHA_DIVIDED_BY_REMAINING_HYPOTHESES',
  },
  wealth: {
    initialCapital: 1,
    initialFilledPosition: 'LONG',
    intervalBeforeFill: true,
    transactionCostFactor: '1-c',
    noTerminalLiquidation: true,
    buyAndHoldInitialPosition: 'LONG',
    buyAndHoldCosts: 0,
  },
  x2MinimumRatio: 2,
  arithmetic: 'UNROUNDED_IEEE754_BINARY64',
  performanceBeforeEndpoint: 'WITHHELD',
  normalTailCoefficientSha256: model.hashCanonical(NORMAL_TAIL_COEFFICIENTS),
});

const DECISION_SCHEMA = 'fg-control-residual-pls1-decision-v1';
const MANIFEST_KEYS = NATIVE_OBJECT_FREEZE(NATIVE_ARRAY_SORT([
  'schema', 'status', 'lockboxId', 'modelId', 'modelVersion', 'protocolFreezeMarker',
  'frozenAtUtc', 'sourceCommitSha', 'sourceTreeSha', 'runtime', 'seed', 'schedule',
  'marketOrder', 'componentOrder', 'controlOrder', 'minimumMaturedRows', 'currentZLimit',
  'maximumCurrentControlMahalanobisRadius', 'maximumCurrentPlsScoreZ', 'numericTolerance',
  'maximumControlNormalConditionInfinity', 'exactDyadicComparisonPolicy', 'label',
  'execution', 'targets', 'cash', 'costs', 'upstream', 'trustGate', 'dataRights',
  'remoteIntegrity', 'knownLimitations', 'pinnedFiles',
 ]));
const BUNDLE_KEYS = NATIVE_OBJECT_FREEZE(NATIVE_ARRAY_SORT([
  'schema', 'status', 'lockboxId', 'modelId', 'manifestSha256', 'seedSha256',
  'manifestCommitSha', 'mode', 'collectedAtUtc', 'signalKnownAtUtc', 'decisionDate',
  'previousBundle', 'remoteRun', 'sourceAcquisition', 'marketOrder', 'markets',
  'forbiddenUntilTrustGate',
 ]));
const PREVIOUS_BUNDLE_KEYS = NATIVE_OBJECT_FREEZE(NATIVE_ARRAY_SORT(['decisionDate', 'sha256']));
const MARKET_RECORD_KEYS = NATIVE_OBJECT_FREEZE(NATIVE_ARRAY_SORT([
  'marketClass', 'sentimentReferenceId', 'targetId', 'cashId', 'newRows',
  'newRowsSha256', 'missedDecisionDates', 'inputRow', 'inputRowSha256', 'decisions',
  'fit', 'resolvedEvents',
 ]));
const FILL_EVENT_KEYS = NATIVE_OBJECT_FREEZE(NATIVE_ARRAY_SORT([
  'schema', 'kind', 'market', 'model', 'decisionSha256', 'decisionDate',
  'decisionRecordedAtUtc', 'fillDate', 'filledPosition', 'targetClose', 'cashClose',
  'oneWayPrimaryCost', 'oneWayStressCost', 'costChargedOnlyIfStateChanged', 'eventSha256',
 ]));
const OUTCOME_EVENT_KEYS = NATIVE_OBJECT_FREEZE(NATIVE_ARRAY_SORT([
  'schema', 'kind', 'market', 'model', 'decisionSha256', 'decisionDate',
  'executionDate', 'outcomeEndDate', 'valid', 'invalidReason', 'relativeLogReturn',
  'eventSha256',
 ]));
const DECISION_KEYS = NATIVE_OBJECT_FREEZE(NATIVE_ARRAY_SORT([
  'schema',
  'modelId',
  'modelVersion',
  'model',
  'market',
  'marketName',
  'marketClass',
  'targetId',
  'cashId',
  'decisionDate',
  'decisionRowIndex',
  'signalAvailableAtUtc',
  'earliestExecutionRule',
  'action',
  'targetPosition',
  'filledPosition',
  'tradeRequired',
  'prediction',
  'fallbackReason',
  'fitFailureReason',
  'learnedFromHistory',
  'decisionBasis',
  'currentFeaturesValid',
  'currentFeatureInvalidReasons',
  'trainingRowCount',
  'trainingStartDate',
  'trainingEndDate',
  'latestMaturedOutcomeClose',
  'allHistoryStart',
  'allHistoryEnd',
  'allHistoryRows',
  'learnerTruncatedSuppliedLedger',
  'sourceHistoryCompleteness',
  'trainingRowsSha256',
  'currentRowSha256',
  'fitSha256',
  'zeroFactor',
  'evidenceStatus',
  'decisionSha256',
 ]));

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || NATIVE_OBJECT_IS_FROZEN(value)) return value;
  for (const item of NATIVE_OBJECT_VALUES(value)) deepFreeze(item);
  return NATIVE_OBJECT_FREEZE(value);
}

function finite(value) {
  return typeof value === 'number' && NATIVE_NUMBER_IS_FINITE(value);
}

function positive(value) {
  return finite(value) && value > 0;
}

function exactIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return NATIVE_NUMBER_IS_FINITE(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function exactUtc(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && NATIVE_NUMBER_IS_FINITE(Date.parse(value))
    && new Date(value).toISOString() === value;
}

function polevl(value, coefficients) {
  let result = 0;
  for (const coefficient of coefficients) result = (result * value) + coefficient;
  return result;
}

function p1evl(value, coefficients) {
  let result = value + coefficients[0];
  for (let index = 1; index < coefficients.length; index += 1) {
    result = (result * value) + coefficients[index];
  }
  return result;
}

// This is the frozen Cephes rational approximation, evaluated only with
// JavaScript IEEE-754 binary64 operations. It is deliberately self-contained:
// endpoint p-values never depend on a platform statistics library.
function cephesErf(value) {
  if (!finite(value)) return value === Infinity ? 1 : value === -Infinity ? -1 : NaN;
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value);
  if (x > 1) return sign * (1 - cephesErfc(x));
  const square = x * x;
  return sign * x * polevl(square, NORMAL_TAIL_COEFFICIENTS.erfT)
    / p1evl(square, NORMAL_TAIL_COEFFICIENTS.erfU);
}

function cephesErfc(value) {
  if (value === Infinity) return 0;
  if (value === -Infinity) return 2;
  if (!finite(value)) return NaN;
  const x = Math.abs(value);
  if (x < 1) return 1 - cephesErf(value);
  const exponential = Math.exp(-(x * x));
  let numerator;
  let denominator;
  if (x < 8) {
    numerator = polevl(x, NORMAL_TAIL_COEFFICIENTS.erfcP);
    denominator = p1evl(x, NORMAL_TAIL_COEFFICIENTS.erfcQ);
  } else {
    numerator = polevl(x, NORMAL_TAIL_COEFFICIENTS.erfcR);
    denominator = p1evl(x, NORMAL_TAIL_COEFFICIENTS.erfcS);
  }
  const tail = exponential * numerator / denominator;
  return value < 0 ? 2 - tail : tail;
}

function normalSurvival(value) {
  if (value === Infinity) return 0;
  if (value === -Infinity) return 1;
  if (!finite(value)) return NaN;
  const raw = 0.5 * cephesErfc(value / Math.SQRT2);
  return Math.max(0, Math.min(1, raw));
}

function forecastMse(outcomes, forecastsM0, forecastsM1) {
  const n = ENDPOINT_CONTRACT.originsPerMarket;
  if (!Array.isArray(outcomes) || !Array.isArray(forecastsM0) || !Array.isArray(forecastsM1)
      || outcomes.length !== n || forecastsM0.length !== n || forecastsM1.length !== n
      || !outcomes.every(finite) || !forecastsM0.every(finite) || !forecastsM1.every(finite)) {
    return deepFreeze({ ok: false, n: Array.isArray(outcomes) ? outcomes.length : null,
      M0: null, M1: null, maximumAllowedM1: null, m1ToM0Ratio: null,
      passed: false, reason: 'MSE_REQUIRES_EXACTLY_756_FINITE_ALIGNED_OBSERVATIONS' });
  }
  const mseM0 = outcomes.reduce((sum, outcome, index) => (
    sum + ((outcome - forecastsM0[index]) ** 2)
  ), 0) / n;
  const mseM1 = outcomes.reduce((sum, outcome, index) => (
    sum + ((outcome - forecastsM1[index]) ** 2)
  ), 0) / n;
  const maximumAllowedM1 = ENDPOINT_CONTRACT.mseM1ToM0MaximumRatio * mseM0;
  const passed = finite(mseM0) && mseM0 > 0 && finite(mseM1)
    && mseM1 <= maximumAllowedM1;
  return deepFreeze({ ok: finite(mseM0) && finite(mseM1), n, M0: finite(mseM0) ? mseM0 : null,
    M1: finite(mseM1) ? mseM1 : null,
    maximumAllowedM1: finite(maximumAllowedM1) ? maximumAllowedM1 : null,
    m1ToM0Ratio: finite(mseM0) && mseM0 > 0 && finite(mseM1) ? mseM1 / mseM0 : null,
    passed, reason: passed ? null : 'MSE_IMPROVEMENT_GATE_FAILED' });
}

function clarkWest(outcomes, forecastsM0, forecastsM1) {
  const n = ENDPOINT_CONTRACT.originsPerMarket;
  if (!Array.isArray(outcomes) || !Array.isArray(forecastsM0) || !Array.isArray(forecastsM1)
      || outcomes.length !== n || forecastsM0.length !== n || forecastsM1.length !== n
      || !outcomes.every(finite) || !forecastsM0.every(finite) || !forecastsM1.every(finite)) {
    return deepFreeze({ ok: false, n: Array.isArray(outcomes) ? outcomes.length : null,
      meanDifferential: null, longRunVariance: null, standardError: null,
      z: null, pOneSided: 1, reason: 'CW_REQUIRES_EXACTLY_756_FINITE_ALIGNED_OBSERVATIONS' });
  }
  const differential = outcomes.map((outcome, index) => {
    const errorM0 = outcome - forecastsM0[index];
    const errorM1 = outcome - forecastsM1[index];
    const forecastDifference = forecastsM0[index] - forecastsM1[index];
    return (errorM0 ** 2) - (errorM1 ** 2) + (forecastDifference ** 2);
  });
  if (!differential.every(finite)) {
    return deepFreeze({ ok: false, n, meanDifferential: null, longRunVariance: null,
      standardError: null, z: null, pOneSided: 1, reason: 'CW_NONFINITE_DIFFERENTIAL' });
  }
  const mean = differential.reduce((sum, value) => sum + value, 0) / n;
  const gamma = [];
  for (let lag = 0; lag <= ENDPOINT_CONTRACT.clarkWest.neweyWestLag; lag += 1) {
    let covariance = 0;
    for (let index = lag; index < n; index += 1) {
      covariance += (differential[index] - mean) * (differential[index - lag] - mean);
    }
    gamma.push(covariance / n);
  }
  let longRunVariance = gamma[0];
  for (let lag = 1; lag <= ENDPOINT_CONTRACT.clarkWest.neweyWestLag; lag += 1) {
    longRunVariance += 2 * (1 - (lag / 6)) * gamma[lag];
  }
  const standardError = longRunVariance > 0 ? Math.sqrt(longRunVariance / n) : null;
  if (!finite(mean) || !finite(longRunVariance) || !(longRunVariance > 0)
      || !finite(standardError) || !(standardError > 0)) {
    return deepFreeze({ ok: false, n, meanDifferential: finite(mean) ? mean : null,
      autocovariances: gamma.every(finite) ? gamma : null,
      longRunVariance: finite(longRunVariance) ? longRunVariance : null,
      standardError: null, z: null, pOneSided: 1, reason: 'CW_NONPOSITIVE_OR_NONFINITE_LONG_RUN_VARIANCE' });
  }
  const z = mean / standardError;
  const pOneSided = normalSurvival(z);
  if (!finite(z) || !finite(pOneSided)) {
    return deepFreeze({ ok: false, n, meanDifferential: mean, autocovariances: gamma,
      longRunVariance, standardError, z: null, pOneSided: 1, reason: 'CW_NONFINITE_TEST_STATISTIC' });
  }
  return deepFreeze({ ok: true, n, meanDifferential: mean, autocovariances: gamma,
    longRunVariance, standardError, z, pOneSided, reason: null });
}

function holmStepDown(pValuesByMarket) {
  const order = ENDPOINT_CONTRACT.marketOrder;
  const ranked = NATIVE_ARRAY_SORT(order.map((market, marketOrderIndex) => ({
    market,
    marketOrderIndex,
    p: pValuesByMarket && finite(pValuesByMarket[market])
      && pValuesByMarket[market] >= 0 && pValuesByMarket[market] <= 1
      ? pValuesByMarket[market] : 1,
  })), (left, right) => (left.p - right.p) || (left.marketOrderIndex - right.marketOrderIndex));
  let stopped = false;
  const results = ranked.map((item, rankIndex) => {
    const threshold = ENDPOINT_CONTRACT.holm.familyWiseAlpha / (order.length - rankIndex);
    const rejected = !stopped && item.p <= threshold;
    if (!rejected) stopped = true;
    return {
      rank: rankIndex + 1,
      market: item.market,
      p: item.p,
      threshold,
      rejected,
    };
  });
  return deepFreeze({
    method: 'HOLM_STEP_DOWN_FIXED_SIX_MARKET_FAMILY',
    familyWiseAlpha: ENDPOINT_CONTRACT.holm.familyWiseAlpha,
    ranked: results,
    rejectedByMarket: Object.fromEntries(order.map(market => [market,
      Boolean(results.find(result => result.market === market).rejected)])),
    allRejected: results.every(result => result.rejected),
  });
}

function replayWealth(rows, targetStates, oneWayCost,
  decisionRowIndices = Array.from({ length: ENDPOINT_CONTRACT.originsPerMarket + 1 },
    (unused, index) => index)) {
  if (!Array.isArray(rows) || rows.length < ENDPOINT_CONTRACT.originsPerMarket + 3
      || !Array.isArray(targetStates)
      || targetStates.length !== ENDPOINT_CONTRACT.originsPerMarket + 1
      || !Array.isArray(decisionRowIndices)
      || decisionRowIndices.length !== ENDPOINT_CONTRACT.originsPerMarket + 1
      || !rows.every(row => row && positive(row.targetClose) && positive(row.cashClose))
      || !targetStates.every(state => state === 'LONG' || state === 'CASH')
      || !finite(oneWayCost) || oneWayCost < 0 || oneWayCost >= 1) {
    return deepFreeze({ ok: false, terminalWealth: null, transitions: null,
      finalPosition: null, reason: 'WEALTH_REPLAY_INPUT_INVALID' });
  }
  let wealth = 1;
  let filledPosition = ENDPOINT_CONTRACT.wealth.initialFilledPosition;
  let transitions = 0;
  const queuedByRowIndex = new Map();
  for (let decisionIndex = 0; decisionIndex < decisionRowIndices.length; decisionIndex += 1) {
    const rowIndex = decisionRowIndices[decisionIndex];
    if (!Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex + 2 >= rows.length
        || (decisionIndex > 0 && rowIndex <= decisionRowIndices[decisionIndex - 1])
        || queuedByRowIndex.has(rowIndex)) {
      return deepFreeze({ ok: false, terminalWealth: null, transitions: null,
        finalPosition: null, reason: 'WEALTH_DECISION_ROW_INDICES_INVALID' });
    }
    queuedByRowIndex.set(rowIndex, targetStates[decisionIndex]);
  }
  if (decisionRowIndices[0] !== 0
      || decisionRowIndices.at(-1) + 2 !== rows.length - 1) {
    return deepFreeze({ ok: false, terminalWealth: null, transitions: null,
      finalPosition: null, reason: 'WEALTH_WINDOW_BOUNDARIES_INVALID' });
  }
  for (let index = 1; index < rows.length; index += 1) {
    const previous = rows[index - 1];
    const current = rows[index];
    const intervalFactor = filledPosition === 'LONG'
      ? current.targetClose / previous.targetClose
      : current.cashClose / previous.cashClose;
    if (!positive(intervalFactor)) {
      return deepFreeze({ ok: false, terminalWealth: null, transitions,
        finalPosition: filledPosition, reason: 'WEALTH_INTERVAL_FACTOR_INVALID' });
    }
    wealth *= intervalFactor;
    const queuedDecisionRowIndex = index - 1;
    if (queuedByRowIndex.has(queuedDecisionRowIndex)) {
      const target = queuedByRowIndex.get(queuedDecisionRowIndex);
      if (target !== filledPosition) {
        wealth *= 1 - oneWayCost;
        transitions += 1;
        filledPosition = target;
      }
    }
    if (!positive(wealth)) {
      return deepFreeze({ ok: false, terminalWealth: null, transitions,
        finalPosition: filledPosition, reason: 'WEALTH_BECAME_NONFINITE_OR_NONPOSITIVE' });
    }
  }
  return deepFreeze({ ok: true, terminalWealth: wealth, transitions,
    finalPosition: filledPosition, reason: null });
}

function buyAndHoldWealth(rows) {
  if (!Array.isArray(rows) || rows.length < ENDPOINT_CONTRACT.originsPerMarket + 3
      || !rows.every(row => row && positive(row.targetClose))) return null;
  const wealth = rows.at(-1).targetClose / rows[0].targetClose;
  return positive(wealth) ? wealth : null;
}

function hashWithout(value, key) {
  if (!value || typeof value !== 'object') return null;
  const copy = { ...value };
  delete copy[key];
  try { return model.hashCanonical(copy); } catch { return null; }
}

function safeCanonicalHash(value) {
  try { return model.hashCanonical(value); } catch { return null; }
}

function canonicalEqual(left, right) {
  try { return model.canonicalStringify(left) === model.canonicalStringify(right); } catch { return false; }
}

function snapshotExactDecision(value) {
  return snapshotExactObject(value, DECISION_KEYS);
}

function snapshotExactObject(value, exactKeys) {
  try {
    const snapshot = model.canonicalize(value);
    if (!snapshot || Array.isArray(snapshot)
        || !canonicalEqual(NATIVE_ARRAY_SORT(Object.keys(snapshot)),
          NATIVE_ARRAY_SORT([...exactKeys]))) return null;
    return snapshot;
  } catch {
    return null;
  }
}

function snapshotExactEvent(value) {
  const kind = value && typeof value === 'object' ? value.kind : null;
  const keys = kind === 'FILL' ? FILL_EVENT_KEYS : kind === 'OUTCOME' ? OUTCOME_EVENT_KEYS : null;
  return keys ? snapshotExactObject(value, keys) : null;
}

function frozenDecisionSemanticsValid(decision, fit, requireLearnedFit) {
  if (decision.evidenceStatus !== 'PROSPECTIVE_CANDIDATE_NOT_YET_TRUSTED'
      || decision.learnerTruncatedSuppliedLedger !== false
      || decision.sourceHistoryCompleteness !== 'REQUIRES_EXTERNAL_LOCKBOX_VERIFICATION'
      || decision.earliestExecutionRule
        !== 'FIRST_TARGET_CLOSE_STRICTLY_AFTER_FEATURE_CLOSE_AND_RECORDED_AVAILABILITY'
      || !Number.isInteger(decision.decisionRowIndex) || decision.decisionRowIndex < 0
      || !Number.isInteger(decision.allHistoryRows)
      || decision.allHistoryRows !== decision.decisionRowIndex + 1
      || decision.allHistoryEnd !== decision.decisionDate
      || !exactIsoDate(decision.allHistoryStart)
      || decision.allHistoryStart > decision.allHistoryEnd
      || !Array.isArray(decision.currentFeatureInvalidReasons)
      || !Number.isInteger(decision.trainingRowCount) || decision.trainingRowCount < 0
      || decision.trainingRowCount > Math.max(0, decision.allHistoryRows - 2)) return false;
  const fitOk = Boolean(fit && fit.ok === true);
  if (fitOk) {
    return decision.learnedFromHistory === true
      && decision.decisionBasis === 'LEARNED_FORECAST_WITH_STATEFUL_COST_HURDLE'
      && decision.fitFailureReason === null
      && decision.currentFeaturesValid === true
      && finite(decision.prediction)
      && decision.fitSha256 === fit.fitSha256
      && (decision.fallbackReason === null || decision.fallbackReason === model.ZERO_FACTOR_REASON)
      && decision.zeroFactor === (fit.zeroFactor === true);
  }
  if (requireLearnedFit || decision.learnedFromHistory !== false
      || decision.fitSha256 !== null || decision.prediction !== null
      || decision.zeroFactor !== false) return false;
  if (decision.fallbackReason === model.WARMUP_REASON) {
    return fit == null && decision.fitFailureReason === null
      && decision.decisionBasis === 'PRE_REGISTERED_WARMUP_POLICY'
      && decision.currentFeaturesValid === true
      && decision.trainingRowCount < ENDPOINT_CONTRACT.minimumMaturedRowsAtOrigin
      && decision.targetPosition === 'LONG' && decision.action === 'BUY';
  }
  if (decision.fallbackReason === model.INVALID_REASON) {
    return decision.decisionBasis === 'PRE_REGISTERED_FAIL_CLOSED_POLICY'
      && decision.targetPosition === 'CASH' && decision.action === 'SELL'
      && decision.fitFailureReason === (fit && fit.ok === false ? fit.reason : null);
  }
  return false;
}

function issueCollector() {
  const entries = [];
  const seen = new Set();
  return {
    add(code, context = {}) {
      const clean = { code };
      for (const key of ['market', 'originNumber', 'decisionDate', 'model', 'detail']) {
        if (context[key] !== undefined && context[key] !== null) clean[key] = context[key];
      }
      const identity = NATIVE_JSON_STRINGIFY(clean);
      if (!seen.has(identity)) {
        seen.add(identity);
        entries.push(clean);
      }
    },
    sorted() {
      return NATIVE_ARRAY_SORT(entries.slice(), (left, right) => {
        const leftIdentity = NATIVE_JSON_STRINGIFY(left);
        const rightIdentity = NATIVE_JSON_STRINGIFY(right);
        return leftIdentity < rightIdentity ? -1 : leftIdentity > rightIdentity ? 1 : 0;
      });
    },
  };
}

function validateManifestContract(manifest, issues) {
  if (!manifest || typeof manifest !== 'object') {
    issues.add('MANIFEST_MISSING');
    return null;
  }
  manifest = snapshotExactObject(manifest, MANIFEST_KEYS);
  if (!manifest) {
    issues.add('MANIFEST_SCHEMA_OR_KEYS_INVALID');
    return null;
  }
  if (manifest.schema !== 'fg-control-residual-pls1-manifest-v1'
      || manifest.status !== 'LOCKED_BEFORE_FIRST_PROSPECTIVE_DECISION'
      || manifest.lockboxId !== 'control-residual-pls1-v1'
      || manifest.modelVersion !== model.SCHEMA_VERSION
      || manifest.protocolFreezeMarker !== model.PROTOCOL_FREEZE_MARKER) {
    issues.add('MANIFEST_IDENTITY_MISMATCH');
  }
  if (manifest.modelId !== ENDPOINT_CONTRACT.modelId) issues.add('MANIFEST_MODEL_ID_MISMATCH');
  if (!canonicalEqual(manifest.marketOrder, ENDPOINT_CONTRACT.marketOrder)) {
    issues.add('MANIFEST_MARKET_ORDER_MISMATCH');
  }
  if (manifest.minimumMaturedRows !== ENDPOINT_CONTRACT.minimumMaturedRowsAtOrigin) {
    issues.add('MANIFEST_MINIMUM_MATURED_ROWS_MISMATCH');
  }
  if (manifest.exactDyadicComparisonPolicy !== model.EXACT_DYADIC_COMPARISON_POLICY) {
    issues.add('MANIFEST_EXACT_DYADIC_COMPARISON_POLICY_MISMATCH');
  }
  if (!canonicalEqual(manifest.costs, model.COSTS)) issues.add('MANIFEST_COSTS_MISMATCH');
  const gate = manifest.trustGate || {};
  if (gate.minimumCalendarDays !== ENDPOINT_CONTRACT.minimumElapsedDays
      || gate.minimumMaturedForecastsPerMarket !== ENDPOINT_CONTRACT.originsPerMarket
      || gate.fixedFirstDecisionOriginsPerMarket !== ENDPOINT_CONTRACT.originsPerMarket
      || gate.extendWindowForMissingOrInvalidOrigins !== false
      || gate.m1MseRelativeToM0Maximum !== ENDPOINT_CONTRACT.mseM1ToM0MaximumRatio
      || gate.clarkWestNeweyWestLag !== ENDPOINT_CONTRACT.clarkWest.neweyWestLag
      || gate.holmFamilyWiseAlpha !== ENDPOINT_CONTRACT.holm.familyWiseAlpha
      || gate.x2EveryMarketMinimumRatio !== ENDPOINT_CONTRACT.x2MinimumRatio
      || gate.interimTuningOrEarlyGraduationAllowed !== false
      || !canonicalEqual(gate.m1StressWealthMustExceed, ['M0', 'BUY_AND_HOLD'])) {
    issues.add('MANIFEST_TRUST_GATE_MISMATCH');
  }
  return manifest;
}

function snapshotBundleForEvaluation(source, bundleIndex, issues) {
  const bundle = snapshotExactObject(source, BUNDLE_KEYS);
  if (!bundle) {
    issues.add('BUNDLE_SCHEMA_OR_KEYS_INVALID', { originNumber: bundleIndex,
      decisionDate: source && source.decisionDate });
    return null;
  }
  if (!snapshotExactObject(bundle.previousBundle, PREVIOUS_BUNDLE_KEYS)) {
    issues.add('BUNDLE_PREVIOUS_SCHEMA_OR_KEYS_INVALID', { originNumber: bundleIndex,
      decisionDate: bundle.decisionDate });
  }
  if (!canonicalEqual(bundle.forbiddenUntilTrustGate,
    ['TRUSTED', 'VALIDATED', 'BEATS_INDEX', '2X'])) {
    issues.add('BUNDLE_FORBIDDEN_CLAIMS_CONTRACT_MISMATCH', { originNumber: bundleIndex,
      decisionDate: bundle.decisionDate });
  }
  if (bundle.signalKnownAtUtc !== bundle.collectedAtUtc) {
    issues.add('BUNDLE_SIGNAL_COLLECTION_TIME_MISMATCH', { originNumber: bundleIndex,
      decisionDate: bundle.decisionDate });
  }
  if (!snapshotExactObject(bundle.markets, ENDPOINT_CONTRACT.marketOrder)) {
    issues.add('BUNDLE_MARKETS_SCHEMA_OR_KEYS_INVALID', { originNumber: bundleIndex,
      decisionDate: bundle.decisionDate });
    return bundle;
  }
  for (const market of ENDPOINT_CONTRACT.marketOrder) {
    if (!snapshotExactObject(bundle.markets[market], MARKET_RECORD_KEYS)) {
      issues.add('MARKET_RECORD_SCHEMA_OR_KEYS_INVALID', { market, originNumber: bundleIndex,
        decisionDate: bundle.decisionDate });
    }
  }
  return bundle;
}

function bundleSessionDates(bundle, bundleIndex, issues, maximumRelevantRows = null) {
  let reference = null;
  for (const market of ENDPOINT_CONTRACT.marketOrder) {
    const record = bundle && bundle.markets && bundle.markets[market];
    if (!record || !Array.isArray(record.newRows) || record.newRows.length === 0) {
      issues.add('BUNDLE_MARKET_NEW_ROWS_MISSING', { market, originNumber: bundleIndex,
        decisionDate: bundle && bundle.decisionDate });
      continue;
    }
    const relevantRows = maximumRelevantRows === null
      ? record.newRows : record.newRows.slice(0, maximumRelevantRows);
    const dates = relevantRows.map(row => row && row.date);
    if (dates.some(date => !exactIsoDate(date))
        || dates.some((date, index) => index > 0 && date <= dates[index - 1])) {
      issues.add('BUNDLE_MARKET_NEW_ROW_DATES_INVALID_OR_OUT_OF_ORDER', {
        market, originNumber: bundleIndex, decisionDate: bundle.decisionDate,
      });
    }
    if (maximumRelevantRows === null
        && (!record.inputRow || !canonicalEqual(record.inputRow, record.newRows.at(-1))
          || record.inputRow.date !== bundle.decisionDate
          || record.inputRowSha256 !== safeCanonicalHash(record.inputRow)
          || record.newRowsSha256 !== safeCanonicalHash(record.newRows)
          || !canonicalEqual(record.missedDecisionDates,
            record.newRows.slice(0, -1).map(row => row && row.date)))) {
      issues.add('BUNDLE_MARKET_NEW_ROWS_IDENTITY_MISMATCH', {
        market, originNumber: bundleIndex, decisionDate: bundle.decisionDate,
      });
    }
    if (relevantRows.some((row, rowIndex) => !row
        || row.availableAtUtc !== (rowIndex === record.newRows.length - 1
          ? bundle.collectedAtUtc : null))) {
      issues.add('BUNDLE_MARKET_NEW_ROWS_AVAILABILITY_MISMATCH', {
        market, originNumber: bundleIndex, decisionDate: bundle.decisionDate,
      });
    }
    if (reference === null) reference = dates;
    else if (!canonicalEqual(dates, reference)) {
      issues.add('SIX_MARKET_TARGET_SESSION_SEQUENCES_DIFFER', {
        market, originNumber: bundleIndex, decisionDate: bundle.decisionDate,
      });
    }
  }
  return reference || [];
}

function selectEndpointPrefix(bundles, manifest, issues) {
  if (!Array.isArray(bundles) || bundles.length === 0) {
    issues.add('ACTIVATION_BUNDLE_MISSING');
    return { endpointIndex: null, inspectedCount: 0, activation: null,
      originSlotsObserved: 0, maturityRowsObserved: 0, waitReason: 'ACTIVATION_BUNDLE_MISSING',
      bundles: [] };
  }
  const sanitizedBundles = [];
  const activation = snapshotBundleForEvaluation(bundles[0], 0, issues);
  sanitizedBundles[0] = activation;
  if (!activation || typeof activation !== 'object') issues.add('ACTIVATION_BUNDLE_INVALID');
  if (activation && activation.mode !== ENDPOINT_CONTRACT.activationMode) {
    issues.add('FIRST_BUNDLE_NOT_ACTIVATION');
  }
  const activationDate = activation && activation.decisionDate;
  const activationUtc = activation && activation.collectedAtUtc;
  if (!exactIsoDate(activationDate)) issues.add('ACTIVATION_DECISION_DATE_INVALID');
  if (!exactUtc(activationUtc)) issues.add('ACTIVATION_COLLECTION_UTC_INVALID');
  const activationMs = exactUtc(activationUtc) ? Date.parse(activationUtc) : null;
  const thresholdMs = activationMs == null ? null
    : activationMs + (ENDPOINT_CONTRACT.minimumElapsedSeconds * 1000);
  let endpointIndex = null;
  let maturityBundleIndex = null;
  let lastOriginDate = null;
  const postLastOriginDates = [];
  let previousDate = null;
  let previousUtcMs = null;
  let previousBundleSha256 = manifest && typeof manifest === 'object'
    ? safeCanonicalHash(manifest) : null;
  let previousBundleDate = 'MANIFEST';
  let inspectedCount = 0;
  for (let index = 0; index < bundles.length; index += 1) {
    const bundle = index === 0
      ? activation : snapshotBundleForEvaluation(bundles[index], index, issues);
    sanitizedBundles[index] = bundle;
    inspectedCount = index + 1;
    if (!bundle || typeof bundle !== 'object') {
      issues.add('BUNDLE_INVALID', { originNumber: index });
      continue;
    }
    if (bundle.schema !== 'fg-control-residual-pls1-six-market-decision-bundle-v1'
        || bundle.status !== 'PROSPECTIVE_CANDIDATE_NOT_YET_TRUSTED'
        || !manifest || bundle.lockboxId !== manifest.lockboxId
        || bundle.modelId !== ENDPOINT_CONTRACT.modelId
        || bundle.manifestSha256 !== safeCanonicalHash(manifest)
        || !manifest.seed || bundle.seedSha256 !== manifest.seed.sha256) {
      issues.add('BUNDLE_IDENTITY_MISMATCH', { originNumber: index,
        decisionDate: bundle.decisionDate });
    }
    if (!bundle.previousBundle
        || bundle.previousBundle.sha256 !== previousBundleSha256
        || bundle.previousBundle.decisionDate !== previousBundleDate) {
      issues.add('BUNDLE_CHAIN_BROKEN', { originNumber: index,
        decisionDate: bundle.decisionDate });
    }
    if (!canonicalEqual(bundle.marketOrder, ENDPOINT_CONTRACT.marketOrder)) {
      issues.add('BUNDLE_MARKET_ORDER_MISMATCH', { originNumber: index,
        decisionDate: bundle.decisionDate });
    }
    const remainingMaturityRows = index > ENDPOINT_CONTRACT.originsPerMarket
      && maturityBundleIndex === null
      ? ENDPOINT_CONTRACT.outcomeSessionOffset - postLastOriginDates.length : null;
    const sessionDates = maturityBundleIndex === null
      ? bundleSessionDates(bundle, index, issues, remainingMaturityRows) : [];
    if (index > 0 && bundle.mode !== ENDPOINT_CONTRACT.regularMode) {
      issues.add('NON_ACTIVATION_BUNDLE_MODE_INVALID', { originNumber: index,
        decisionDate: bundle.decisionDate });
    }
    if (!exactIsoDate(bundle.decisionDate)) {
      issues.add('BUNDLE_DECISION_DATE_INVALID', { originNumber: index });
    } else if (previousDate !== null && bundle.decisionDate <= previousDate) {
      issues.add('BUNDLE_DECISION_DATES_DUPLICATE_OR_OUT_OF_ORDER', {
        originNumber: index, decisionDate: bundle.decisionDate,
      });
    }
    if (!exactUtc(bundle.collectedAtUtc)) {
      issues.add('BUNDLE_COLLECTION_UTC_INVALID', { originNumber: index,
        decisionDate: bundle.decisionDate });
    } else {
      const utcMs = Date.parse(bundle.collectedAtUtc);
      if (previousUtcMs !== null && utcMs <= previousUtcMs) {
        issues.add('BUNDLE_COLLECTION_TIMES_DUPLICATE_OR_OUT_OF_ORDER', {
          originNumber: index, decisionDate: bundle.decisionDate,
        });
      }
      previousUtcMs = utcMs;
      if (index === ENDPOINT_CONTRACT.originsPerMarket) {
        lastOriginDate = bundle.decisionDate;
      } else if (index > ENDPOINT_CONTRACT.originsPerMarket && lastOriginDate !== null) {
        for (const date of sessionDates) {
          if (date > lastOriginDate && postLastOriginDates.length
              < ENDPOINT_CONTRACT.outcomeSessionOffset) postLastOriginDates.push(date);
        }
        if (maturityBundleIndex === null
            && postLastOriginDates.length === ENDPOINT_CONTRACT.outcomeSessionOffset) {
          maturityBundleIndex = index;
        }
      }
      if (maturityBundleIndex !== null && thresholdMs !== null && utcMs >= thresholdMs) {
        endpointIndex = index;
        break;
      }
    }
    if (exactIsoDate(bundle.decisionDate)) previousDate = bundle.decisionDate;
    previousBundleSha256 = safeCanonicalHash(bundle);
    previousBundleDate = bundle.decisionDate;
  }
  const originSlotsObserved = Math.min(ENDPOINT_CONTRACT.originsPerMarket,
    Math.max(0, inspectedCount - 1));
  const maturityRowsObserved = postLastOriginDates.length;
  let waitReason = null;
  if (endpointIndex === null) {
    if (originSlotsObserved < ENDPOINT_CONTRACT.originsPerMarket) waitReason = 'WAITING_FOR_756_FIXED_ORIGINS';
    else if (maturityRowsObserved < ENDPOINT_CONTRACT.outcomeSessionOffset) {
      waitReason = 'WAITING_FOR_FIXED_WINDOW_TO_MATURE';
    } else waitReason = 'WAITING_FOR_1095_DAY_TIME_GATE';
  }
  return { endpointIndex, inspectedCount, activation,
    originSlotsObserved, maturityRowsObserved, maturityBundleIndex,
    lastOriginDate, finalOutcomeDate: postLastOriginDates[1] || null, waitReason,
    bundles: sanitizedBundles };
}

function validateDecision(decision, modelKey, market, bundle, fit, originNumber, issues) {
  const context = { market, model: modelKey, originNumber, decisionDate: bundle.decisionDate };
  let eligible = true;
  const fail = code => { issues.add(code, context); eligible = false; };
  if (!decision || typeof decision !== 'object') {
    fail('DECISION_MISSING');
    return { eligible: false, decision: null };
  }
  decision = snapshotExactDecision(decision);
  if (!decision || decision.schema !== DECISION_SCHEMA) {
    fail('DECISION_SCHEMA_OR_KEYS_INVALID');
    return { eligible: false, decision: null };
  }
  if (decision.model !== modelKey || decision.market !== market
      || decision.decisionDate !== bundle.decisionDate) fail('DECISION_ORIGIN_IDENTITY_MISMATCH');
  if (decision.modelId !== ENDPOINT_CONTRACT.modelId
      || decision.modelVersion !== model.SCHEMA_VERSION
      || decision.marketClass !== common.TARGETS[market].marketClass
      || decision.targetId !== common.TARGETS[market].symbol
      || decision.cashId !== common.CASH.symbol) fail('DECISION_INSTRUMENT_OR_MODEL_IDENTITY_MISMATCH');
  if (decision.decisionSha256 !== hashWithout(decision, 'decisionSha256')) fail('DECISION_HASH_MISMATCH');
  if (!frozenDecisionSemanticsValid(decision, fit, true)) {
    fail('DECISION_FROZEN_SEMANTICS_INVALID');
  }
  if (!finite(decision.prediction)) fail('DECISION_PREDICTION_NONFINITE_OR_MISSING');
  if (decision.currentFeaturesValid !== true) fail('DECISION_CURRENT_FEATURES_INVALID');
  if (!Number.isInteger(decision.trainingRowCount)
      || decision.trainingRowCount < ENDPOINT_CONTRACT.minimumMaturedRowsAtOrigin) {
    fail('DECISION_WARMUP_OR_TRAINING_COUNT_INVALID');
  }
  if (decision.fallbackReason !== null
      && decision.fallbackReason !== model.ZERO_FACTOR_REASON) fail('DECISION_FAILED_FIT_OR_FALLBACK');
  if (!['LONG', 'CASH'].includes(decision.targetPosition)
      || !['LONG', 'CASH'].includes(decision.filledPosition)) fail('DECISION_POSITION_INVALID');
  if (decision.action !== (decision.targetPosition === 'LONG' ? 'BUY' : 'SELL')) {
    fail('DECISION_ACTION_POSITION_MISMATCH');
  }
  if (decision.tradeRequired !== (decision.targetPosition !== decision.filledPosition)) {
    fail('DECISION_TRADE_REQUIRED_MISMATCH');
  }
  if (finite(decision.prediction) && ['LONG', 'CASH'].includes(decision.filledPosition)
      && model.COSTS[common.TARGETS[market].marketClass]) {
    const expectedTarget = model.chooseBinaryTarget(decision.filledPosition, decision.prediction,
      model.COSTS[common.TARGETS[market].marketClass].stress);
    if (decision.targetPosition !== expectedTarget) fail('DECISION_STRESS_HURDLE_TARGET_MISMATCH');
  }
  if (!exactUtc(decision.signalAvailableAtUtc)
      || decision.signalAvailableAtUtc !== bundle.collectedAtUtc) fail('DECISION_AVAILABILITY_MISMATCH');
  if (!fit || fit.ok !== true || decision.fitSha256 !== fit.fitSha256) fail('DECISION_FIT_MISSING_OR_MISMATCH');
  if (fit && fit.ok === true) {
    const fitPrediction = modelKey === 'M0' ? fit.predictionM0 : fit.predictionM1;
    if (!finite(fitPrediction) || fitPrediction !== decision.prediction) fail('DECISION_FIT_PREDICTION_MISMATCH');
    if (fit.fitSha256 !== hashWithout(fit, 'fitSha256')) fail('FIT_HASH_MISMATCH');
    if (decision.fallbackReason === model.ZERO_FACTOR_REASON && fit.zeroFactor !== true) {
      fail('ZERO_FACTOR_REASON_WITHOUT_ZERO_FACTOR_FIT');
    }
    if (fit.zeroFactor === true && decision.fallbackReason !== model.ZERO_FACTOR_REASON) {
      fail('ZERO_FACTOR_FIT_WITHOUT_FROZEN_REASON');
    }
  }
  return { eligible, decision };
}

function validatePostWindowDecisionPresence(decision, modelKey, market, bundle,
  bundleIndex, expectedFilledPosition, fit, issues) {
  const context = { market, model: modelKey, originNumber: bundleIndex,
    decisionDate: bundle.decisionDate };
  if (!decision || typeof decision !== 'object') {
    issues.add('POST_WINDOW_DECISION_MISSING', context);
    return { valid: false, decision: null };
  }
  let valid = true;
  const fail = code => { issues.add(code, context); valid = false; };
  decision = snapshotExactDecision(decision);
  if (!decision || decision.schema !== DECISION_SCHEMA) {
    fail('POST_WINDOW_DECISION_SCHEMA_OR_KEYS_INVALID');
    return { valid: false, decision: null };
  }
  if (decision.model !== modelKey || decision.market !== market
      || decision.decisionDate !== bundle.decisionDate
      || decision.modelId !== ENDPOINT_CONTRACT.modelId
      || decision.modelVersion !== model.SCHEMA_VERSION
      || decision.marketClass !== common.TARGETS[market].marketClass
      || decision.targetId !== common.TARGETS[market].symbol
      || decision.cashId !== common.CASH.symbol) {
    fail('POST_WINDOW_DECISION_IDENTITY_MISMATCH');
  }
  if (decision.decisionSha256 !== hashWithout(decision, 'decisionSha256')) {
    fail('POST_WINDOW_DECISION_HASH_MISMATCH');
  }
  if (!frozenDecisionSemanticsValid(decision, fit, false)) {
    fail('POST_WINDOW_DECISION_FROZEN_SEMANTICS_INVALID');
  }
  if (!['LONG', 'CASH'].includes(decision.targetPosition)
      || !['LONG', 'CASH'].includes(decision.filledPosition)
      || decision.action !== (decision.targetPosition === 'LONG' ? 'BUY' : 'SELL')
      || decision.tradeRequired !== (decision.targetPosition !== decision.filledPosition)) {
    fail('POST_WINDOW_DECISION_BINARY_MAPPING_INVALID');
  }
  if (decision.filledPosition !== expectedFilledPosition) {
    fail('POST_WINDOW_DECISION_FILLED_STATE_CHAIN_BROKEN');
  }
  if (!exactUtc(decision.signalAvailableAtUtc)
      || decision.signalAvailableAtUtc !== bundle.collectedAtUtc) {
    fail('POST_WINDOW_DECISION_AVAILABILITY_MISMATCH');
  }
  return { valid, decision };
}

function validateEventHash(event, context, issues) {
  if (!event || event.eventSha256 !== hashWithout(event, 'eventSha256')) {
    issues.add('EVENT_HASH_MISMATCH', context);
    return false;
  }
  return true;
}

function validateEventSemantics(event, market, origin, context, issues) {
  let valid = true;
  const fail = code => { issues.add(code, context); valid = false; };
  if (!origin) {
    fail('EVENT_UNKNOWN_DECISION_ORIGIN');
    return false;
  }
  const decision = origin.decision;
  if (event.market !== market || event.model !== decision.model
      || event.decisionSha256 !== decision.decisionSha256
      || event.decisionDate !== decision.decisionDate) fail('EVENT_DECISION_BINDING_INVALID');
  if (event.kind === 'FILL') {
    const costs = model.COSTS[common.TARGETS[market].marketClass];
    if (event.schema !== 'fg-control-residual-pls1-fill-v1'
        || !exactUtc(event.decisionRecordedAtUtc)
        || event.decisionRecordedAtUtc !== origin.bundle.collectedAtUtc
        || !exactIsoDate(event.fillDate) || event.fillDate <= event.decisionDate
        || event.filledPosition !== decision.targetPosition
        || !positive(event.targetClose) || !positive(event.cashClose)
        || !costs || event.oneWayPrimaryCost !== costs.primary
        || event.oneWayStressCost !== costs.stress
        || event.costChargedOnlyIfStateChanged !== decision.tradeRequired) {
      fail('FILL_EVENT_FROZEN_SEMANTICS_INVALID');
    }
  } else if (event.kind === 'OUTCOME') {
    const validOutcome = event.valid === true && event.invalidReason === null
      && finite(event.relativeLogReturn);
    const invalidOutcome = event.valid === false
      && event.invalidReason === 'MISSING_NONPOSITIVE_EXECUTION_OR_OUTCOME_CLOSE'
      && event.relativeLogReturn === null;
    if (event.schema !== 'fg-control-residual-pls1-outcome-v1'
        || !exactIsoDate(event.executionDate) || event.executionDate <= event.decisionDate
        || !exactIsoDate(event.outcomeEndDate) || event.outcomeEndDate <= event.executionDate
        || (!validOutcome && !invalidOutcome)) fail('OUTCOME_EVENT_FROZEN_SEMANTICS_INVALID');
  } else fail('EVENT_KIND_INVALID');
  return valid;
}

function analyzeMarket(market, bundles, maturityBundleIndex, finalOutcomeDate, issues) {
  const n = ENDPOINT_CONTRACT.originsPerMarket;
  const rows = [];
  const rowBundleIndices = [];
  const rowIndexByDate = new Map();
  const eventOccurrences = new Map();
  const missedDecisionOriginDates = [];
  let valid = true;
  const fail = (code, context = {}) => {
    issues.add(code, { market, ...context });
    valid = false;
  };
  const activationRecord = bundles[0] && bundles[0].markets && bundles[0].markets[market];
  const recordMissedDecisionOrigins = (record, bundleIndex) => {
    if (!record || !Array.isArray(record.missedDecisionDates)) return;
    for (const missedDate of record.missedDecisionDates) {
      if (!exactIsoDate(missedDate) || missedDate > finalOutcomeDate) continue;
      missedDecisionOriginDates.push(missedDate);
      const container = bundles[bundleIndex];
      issues.add('MISSED_DECISION_ORIGIN_IN_FIXED_ENDPOINT_WINDOW', {
        market,
        decisionDate: missedDate,
        detail: `recordedInBundleIndex=${bundleIndex};bundleDecisionDate=${container && container.decisionDate}`,
      });
    }
  };
  recordMissedDecisionOrigins(activationRecord, 0);
  const activationBundle = bundles[0];
  const activationFit = activationRecord && activationRecord.fit;
  const activationDecisions = activationRecord && activationRecord.decisions;
  let previousTargetState = { M0: null, M1: null };
  const checkedActivation = { M0: { eligible: false, decision: null },
    M1: { eligible: false, decision: null } };
  if (!activationRecord || !Array.isArray(activationRecord.newRows)
      || activationRecord.newRows.length === 0 || !activationRecord.inputRow
      || !canonicalEqual(activationRecord.inputRow, activationRecord.newRows.at(-1))
      || activationRecord.inputRow.date !== (activationBundle && activationBundle.decisionDate)
      || activationRecord.inputRowSha256 !== safeCanonicalHash(activationRecord.inputRow)
      || activationRecord.newRowsSha256 !== safeCanonicalHash(activationRecord.newRows)
      || !canonicalEqual(activationRecord.missedDecisionDates,
        activationRecord.newRows.slice(0, -1).map(row => row && row.date))) {
    fail('ACTIVATION_MARKET_NEW_ROWS_IDENTITY_MISMATCH');
  }
  if (!activationRecord
      || activationRecord.marketClass !== common.TARGETS[market].marketClass
      || activationRecord.targetId !== common.TARGETS[market].symbol
      || activationRecord.cashId !== common.CASH.symbol) {
    fail('ACTIVATION_MARKET_INSTRUMENT_MAPPING_MISMATCH');
  }
  const activationRow = activationRecord && activationRecord.inputRow;
  if (!activationRow || !exactIsoDate(activationRow.date)
      || activationRow.availableAtUtc !== (activationBundle && activationBundle.collectedAtUtc)
      || !positive(activationRow.targetClose) || !positive(activationRow.cashClose)) {
    fail('ACTIVATION_WEALTH_ROW_INVALID');
  } else {
    rowIndexByDate.set(activationRow.date, 0);
    rows.push(activationRow);
    rowBundleIndices.push(0);
  }
  if (!activationFit || activationFit.ok !== true || !activationDecisions) {
    fail('ACTIVATION_FIT_OR_DECISIONS_MISSING');
  } else {
    checkedActivation.M0 = validateDecision(activationDecisions.M0, 'M0', market,
      activationBundle, activationFit, 0, issues);
    checkedActivation.M1 = validateDecision(activationDecisions.M1, 'M1', market,
      activationBundle, activationFit, 0, issues);
    if (!checkedActivation.M0.eligible || !checkedActivation.M1.eligible) valid = false;
    if (checkedActivation.M0.decision && checkedActivation.M1.decision) {
      if (checkedActivation.M0.decision.filledPosition
          !== ENDPOINT_CONTRACT.wealth.initialFilledPosition
          || checkedActivation.M1.decision.filledPosition
          !== ENDPOINT_CONTRACT.wealth.initialFilledPosition) {
        fail('ACTIVATION_INITIAL_FILLED_POSITION_MISMATCH');
      }
      if (checkedActivation.M0.decision.trainingRowsSha256
          !== checkedActivation.M1.decision.trainingRowsSha256
          || checkedActivation.M0.decision.trainingRowCount
          !== checkedActivation.M1.decision.trainingRowCount
          || checkedActivation.M0.decision.currentRowSha256
          !== checkedActivation.M1.decision.currentRowSha256) {
        fail('ACTIVATION_M0_M1_ORIGIN_SETS_OR_ROWS_UNEQUAL');
      }
      previousTargetState = {
        M0: checkedActivation.M0.decision.targetPosition,
        M1: checkedActivation.M1.decision.targetPosition,
      };
    }
  }
  const allowedEventOrigins = new Map();
  for (let bundleIndex = 0; bundleIndex <= maturityBundleIndex; bundleIndex += 1) {
    const originBundle = bundles[bundleIndex];
    const record = originBundle && originBundle.markets && originBundle.markets[market];
    for (const modelKey of ['M0', 'M1']) {
      const decision = snapshotExactDecision(record && record.decisions
        && record.decisions[modelKey]);
      if (decision && decision.schema === DECISION_SCHEMA && decision.model === modelKey
          && decision.market === market && decision.decisionDate === originBundle.decisionDate
          && decision.decisionSha256 === hashWithout(decision, 'decisionSha256')) {
        const identity = `${modelKey}|${decision.decisionSha256}`;
        if (allowedEventOrigins.has(identity)) {
          fail('DUPLICATE_EVENT_DECISION_IDENTITY', { originNumber: bundleIndex,
            decisionDate: originBundle.decisionDate, model: modelKey });
        } else allowedEventOrigins.set(identity, { decision, bundle: originBundle, bundleIndex });
      }
    }
  }
  const seenEventIdentities = new Set();
  let previousPrimaryDate = activationRecord && activationRecord.inputRow
    && activationRecord.inputRow.date;
  for (let bundleIndex = 1; bundleIndex <= maturityBundleIndex; bundleIndex += 1) {
    const bundle = bundles[bundleIndex];
    const record = bundle && bundle.markets && bundle.markets[market];
    if (!record || !Array.isArray(record.newRows) || record.newRows.length === 0) {
      fail('MARKET_NEW_ROWS_MISSING', { originNumber: bundleIndex,
        decisionDate: bundle && bundle.decisionDate });
      continue;
    }
    recordMissedDecisionOrigins(record, bundleIndex);
    if (record.marketClass !== common.TARGETS[market].marketClass
        || record.targetId !== common.TARGETS[market].symbol
        || record.cashId !== common.CASH.symbol) {
      fail('MARKET_INSTRUMENT_MAPPING_MISMATCH', { originNumber: bundleIndex,
        decisionDate: bundle.decisionDate });
    }
    let relevantRows = record.newRows;
    if (bundleIndex === maturityBundleIndex) {
      const finalRowIndex = record.newRows.findIndex(row => row && row.date === finalOutcomeDate);
      if (finalRowIndex < 0) {
        fail('FINAL_OUTCOME_ROW_MISSING_FROM_MATURITY_BUNDLE', {
          originNumber: bundleIndex, decisionDate: bundle.decisionDate,
        });
        relevantRows = [];
      } else relevantRows = record.newRows.slice(0, finalRowIndex + 1);
    }
    if (!record.inputRow || !canonicalEqual(record.inputRow, record.newRows.at(-1))
        || record.inputRow.date !== bundle.decisionDate
        || record.inputRowSha256 !== safeCanonicalHash(record.inputRow)
        || record.newRowsSha256 !== safeCanonicalHash(record.newRows)
        || !canonicalEqual(record.missedDecisionDates,
          record.newRows.slice(0, -1).map(row => row && row.date))) {
      fail('MARKET_NEW_ROWS_IDENTITY_MISMATCH', { originNumber: bundleIndex,
        decisionDate: bundle.decisionDate });
    }
    if (relevantRows.some((row, rowIndex) => !row
        || row.availableAtUtc !== (rowIndex === record.newRows.length - 1
          ? bundle.collectedAtUtc : null))) {
      fail('MARKET_NEW_ROWS_AVAILABILITY_MISMATCH', { originNumber: bundleIndex,
        decisionDate: bundle.decisionDate });
    }
    for (const sourceRow of relevantRows) {
      if (!sourceRow || !exactIsoDate(sourceRow.date)
          || (previousPrimaryDate && sourceRow.date <= previousPrimaryDate)) {
        fail('MARKET_TARGET_SESSION_ROWS_DUPLICATE_OR_OUT_OF_ORDER', {
          originNumber: bundleIndex, decisionDate: sourceRow && sourceRow.date,
        });
      }
      if (!positive(sourceRow.targetClose) || !positive(sourceRow.cashClose)) {
        fail('MARKET_CLOSE_MISSING_NONPOSITIVE_OR_NONFINITE', {
          originNumber: bundleIndex, decisionDate: sourceRow && sourceRow.date,
        });
      }
      if (sourceRow && exactIsoDate(sourceRow.date)) previousPrimaryDate = sourceRow.date;
    }
    for (const row of relevantRows) {
      if (!row || !exactIsoDate(row.date)) continue;
      if (rowIndexByDate.has(row.date)) {
        fail('MARKET_TARGET_SESSION_ROW_DUPLICATED_IN_WEALTH_WINDOW', {
          originNumber: bundleIndex, decisionDate: row.date,
        });
        continue;
      }
      rowIndexByDate.set(row.date, rows.length);
      rows.push(row);
      rowBundleIndices.push(bundleIndex);
    }
    if (!Array.isArray(record.resolvedEvents)) {
      fail('MARKET_RESOLVED_EVENTS_MISSING', { originNumber: bundleIndex,
        decisionDate: bundle.decisionDate });
    } else {
      let previousEventOrder = null;
      for (const sourceEvent of record.resolvedEvents) {
        const recordedEvent = snapshotExactEvent(sourceEvent);
        if (!recordedEvent) {
          fail('EVENT_SCHEMA_OR_KEYS_INVALID', { originNumber: bundleIndex,
            decisionDate: bundle.decisionDate });
          continue;
        }
        const originIdentity = `${recordedEvent.model}|${recordedEvent.decisionSha256}`;
        const origin = allowedEventOrigins.get(originIdentity);
        const eventContext = { market, model: recordedEvent.model, originNumber: bundleIndex,
          decisionDate: bundle.decisionDate };
        if (!validateEventHash(recordedEvent, eventContext, issues)) valid = false;
        if (!validateEventSemantics(recordedEvent, market, origin, eventContext, issues)) valid = false;
        const effectiveDate = recordedEvent.kind === 'FILL'
          ? recordedEvent.fillDate : recordedEvent.kind === 'OUTCOME'
            ? recordedEvent.outcomeEndDate : null;
        if (!exactIsoDate(effectiveDate)) {
          fail('EVENT_EFFECTIVE_DATE_OR_KIND_INVALID', { originNumber: bundleIndex,
            decisionDate: bundle.decisionDate });
        }
        const kindOrder = recordedEvent.kind === 'FILL' ? '0' : '1';
        const order = `${effectiveDate || ''}|${kindOrder}|${recordedEvent.decisionDate || ''}|${recordedEvent.model || ''}`;
        if (previousEventOrder !== null && order < previousEventOrder) {
          fail('EVENT_RECORDS_OUT_OF_FROZEN_ORDER', { originNumber: bundleIndex,
            decisionDate: bundle.decisionDate });
        }
        previousEventOrder = order;
        const key = `${recordedEvent.kind}|${recordedEvent.model}|${recordedEvent.decisionSha256}`;
        if (seenEventIdentities.has(key)) {
          fail('DUPLICATE_EVENT_IDENTITY', { model: recordedEvent.model,
            originNumber: bundleIndex, decisionDate: bundle.decisionDate });
        }
        seenEventIdentities.add(key);
        if (!origin || (exactIsoDate(effectiveDate) && effectiveDate > finalOutcomeDate)) continue;
        if (!eventOccurrences.has(key)) eventOccurrences.set(key, []);
        eventOccurrences.get(key).push({ bundleIndex, event: recordedEvent });
      }
    }
  }
  if (!rows.length || rows[0].date !== (bundles[0] && bundles[0].decisionDate)
      || rows.at(-1).date !== finalOutcomeDate) {
    fail('WEALTH_TARGET_SESSION_WINDOW_BOUNDARIES_BROKEN');
  }

  const validateResolvedOriginEvents = ({ bundle, decisions, originNumber, rowIndex }) => {
    const executionRow = Number.isInteger(rowIndex) ? rows[rowIndex + 1] : null;
    const endRow = Number.isInteger(rowIndex) ? rows[rowIndex + 2] : null;
    const prefix = originNumber === 0 ? 'ACTIVATION' : 'ORIGIN';
    if (!Number.isInteger(rowIndex) || !executionRow || !endRow) {
      fail(`${prefix}_FIRST_FILL_OR_NEXT_OUTCOME_SESSION_MISSING`, { originNumber,
        decisionDate: bundle && bundle.decisionDate });
      return { executionRow, endRow, outcome: null, snapshots: {} };
    }
    let outcomeForOrigin = null;
    const snapshots = {};
    for (const [modelKey, decision] of [['M0', decisions && decisions.M0],
      ['M1', decisions && decisions.M1]]) {
      const eventContext = { market, model: modelKey, originNumber,
        decisionDate: bundle && bundle.decisionDate };
      if (!decision) {
        fail(`${prefix}_DECISION_MISSING_FOR_EVENT_VALIDATION`, eventContext);
        continue;
      }
      const fillOccurrences = eventOccurrences.get(
        `FILL|${modelKey}|${decision.decisionSha256}`,
      ) || [];
      const outcomeOccurrences = eventOccurrences.get(
        `OUTCOME|${modelKey}|${decision.decisionSha256}`,
      ) || [];
      const expectedFillBundleIndex = rowBundleIndices[rowIndex + 1];
      const expectedOutcomeBundleIndex = rowBundleIndices[rowIndex + 2];
      if (fillOccurrences.length !== 1
          || fillOccurrences[0].bundleIndex !== expectedFillBundleIndex) {
        fail(`${prefix}_REQUIRES_EXACTLY_ONE_FIRST_SESSION_FILL`, eventContext);
        continue;
      }
      if (outcomeOccurrences.length !== 1
          || outcomeOccurrences[0].bundleIndex !== expectedOutcomeBundleIndex) {
        fail(`${prefix}_REQUIRES_EXACTLY_ONE_NEXT_SESSION_OUTCOME`, eventContext);
        continue;
      }
      const fill = fillOccurrences[0].event;
      const outcome = outcomeOccurrences[0].event;
      if (!validateEventHash(fill, eventContext, issues)
          || !validateEventHash(outcome, eventContext, issues)) valid = false;
      const expectedCosts = model.COSTS[common.TARGETS[market].marketClass];
      if (fill.market !== market || fill.decisionDate !== bundle.decisionDate
          || fill.decisionRecordedAtUtc !== bundle.collectedAtUtc
          || fill.fillDate !== executionRow.date
          || fill.filledPosition !== decision.targetPosition
          || fill.targetClose !== executionRow.targetClose
          || fill.cashClose !== executionRow.cashClose
          || fill.oneWayPrimaryCost !== expectedCosts.primary
          || fill.oneWayStressCost !== expectedCosts.stress
          || fill.costChargedOnlyIfStateChanged !== decision.tradeRequired) {
        fail('FILL_MAPPING_OR_COST_CONTRACT_BROKEN', eventContext);
      }
      const fillContainer = bundles[expectedFillBundleIndex];
      if (!exactUtc(fill.decisionRecordedAtUtc) || !fillContainer
          || !exactUtc(fillContainer.collectedAtUtc)
          || Date.parse(fill.decisionRecordedAtUtc) >= Date.parse(fillContainer.collectedAtUtc)) {
        fail('FILL_TIME_ORDER_INVALID', eventContext);
      }
      const expectedOutcome = positive(executionRow.targetClose) && positive(executionRow.cashClose)
        && positive(endRow.targetClose) && positive(endRow.cashClose)
        ? Math.log(endRow.targetClose / executionRow.targetClose)
          - Math.log(endRow.cashClose / executionRow.cashClose) : null;
      if (outcome.market !== market || outcome.decisionDate !== bundle.decisionDate
          || outcome.executionDate !== executionRow.date
          || outcome.outcomeEndDate !== endRow.date
          || outcome.valid !== true || outcome.invalidReason !== null
          || !finite(outcome.relativeLogReturn) || !finite(expectedOutcome)
          || outcome.relativeLogReturn !== expectedOutcome) {
        fail('OUTCOME_MAPPING_OR_VALUE_BROKEN', eventContext);
      }
      if (outcomeForOrigin === null && finite(expectedOutcome)) outcomeForOrigin = expectedOutcome;
      else if (finite(expectedOutcome) && outcomeForOrigin !== expectedOutcome) {
        fail('M0_M1_OUTCOMES_UNEQUAL', eventContext);
      }
      snapshots[modelKey] = {
        decisionSha256: decision.decisionSha256,
        prediction: decision.prediction,
        targetPosition: decision.targetPosition,
        fillEventSha256: fill.eventSha256,
        outcomeEventSha256: outcome.eventSha256,
      };
    }
    return { executionRow, endRow, outcome: outcomeForOrigin, snapshots };
  };

  let activationSnapshot = null;
  const activationDecisionRowIndex = activationBundle && exactIsoDate(activationBundle.decisionDate)
    ? rowIndexByDate.get(activationBundle.decisionDate) : null;
  if (checkedActivation.M0.decision && checkedActivation.M1.decision) {
    const activationEvents = validateResolvedOriginEvents({
      bundle: activationBundle,
      decisions: { M0: checkedActivation.M0.decision, M1: checkedActivation.M1.decision },
      originNumber: 0,
      rowIndex: activationDecisionRowIndex,
    });
    if (activationEvents.snapshots.M0 && activationEvents.snapshots.M1
        && activationEvents.executionRow && activationEvents.endRow) {
      activationSnapshot = {
        decisionDate: activationBundle.decisionDate,
        decisionRowIndex: activationDecisionRowIndex,
        executionDate: activationEvents.executionRow.date,
        outcomeEndDate: activationEvents.endRow.date,
        M0: activationEvents.snapshots.M0,
        M1: activationEvents.snapshots.M1,
      };
    }
  }

  const forecastsM0 = [];
  const forecastsM1 = [];
  const outcomes = [];
  const statesM0 = [];
  const statesM1 = [];
  const originRowIndices = [];
  const originSnapshot = [];
  const decisionHashes = { M0: new Set(), M1: new Set() };
  for (const modelKey of ['M0', 'M1']) {
    const activationDecision = checkedActivation[modelKey].decision;
    if (activationDecision && typeof activationDecision.decisionSha256 === 'string') {
      decisionHashes[modelKey].add(activationDecision.decisionSha256);
    }
  }
  for (let originIndex = 0; originIndex < n; originIndex += 1) {
    const bundleIndex = originIndex + 1;
    const bundle = bundles[bundleIndex];
    const record = bundle && bundle.markets && bundle.markets[market];
    const fit = record && record.fit;
    const decisions = record && record.decisions;
    const originNumber = originIndex + 1;
    if (!record || !decisions) {
      fail('MARKET_ORIGIN_RECORD_MISSING', { originNumber,
        decisionDate: bundle && bundle.decisionDate });
      continue;
    }
    const rowIndex = rowIndexByDate.get(bundle.decisionDate);
    const executionRow = Number.isInteger(rowIndex) ? rows[rowIndex + 1] : null;
    const endRow = Number.isInteger(rowIndex) ? rows[rowIndex + 2] : null;
    if (!Number.isInteger(rowIndex) || !executionRow || !endRow) {
      fail('ORIGIN_FIRST_FILL_OR_NEXT_OUTCOME_SESSION_MISSING', { originNumber,
        decisionDate: bundle.decisionDate });
      continue;
    }
    if (originIndex > 0 && rowIndex <= originRowIndices.at(-1)) {
      fail('DECISION_ORIGIN_ROWS_DUPLICATE_OR_OUT_OF_ORDER', { originNumber,
        decisionDate: bundle.decisionDate });
    }
    if (!fit || fit.ok !== true) fail('MARKET_ORIGIN_FIT_FAILED_OR_MISSING', {
      originNumber, decisionDate: bundle.decisionDate,
    });
    const checkedM0 = validateDecision(decisions.M0, 'M0', market, bundle, fit,
      originNumber, issues);
    const checkedM1 = validateDecision(decisions.M1, 'M1', market, bundle, fit,
      originNumber, issues);
    if (!checkedM0.eligible || !checkedM1.eligible) valid = false;
    if (!checkedM0.decision || !checkedM1.decision) continue;
    const decisionM0 = checkedM0.decision;
    const decisionM1 = checkedM1.decision;
    if (decisionM0.filledPosition !== previousTargetState.M0
        || decisionM1.filledPosition !== previousTargetState.M1) {
      fail('DECISION_FILLED_STATE_CHAIN_BROKEN', { originNumber,
        decisionDate: bundle.decisionDate });
    }
    previousTargetState = {
      M0: decisionM0.targetPosition,
      M1: decisionM1.targetPosition,
    };
    if (decisionM0.trainingRowsSha256 !== decisionM1.trainingRowsSha256
        || decisionM0.trainingRowCount !== decisionM1.trainingRowCount
        || decisionM0.currentRowSha256 !== decisionM1.currentRowSha256) {
      fail('M0_M1_ORIGIN_SETS_OR_ROWS_UNEQUAL', { originNumber,
        decisionDate: bundle.decisionDate });
    }
    for (const [modelKey, decision] of [['M0', decisionM0], ['M1', decisionM1]]) {
      if (decisionHashes[modelKey].has(decision.decisionSha256)) {
        fail('DUPLICATE_DECISION_IDENTITY', { originNumber,
          decisionDate: bundle.decisionDate, model: modelKey });
      }
      decisionHashes[modelKey].add(decision.decisionSha256);
    }
    const eventValidation = validateResolvedOriginEvents({
      bundle,
      decisions: { M0: decisionM0, M1: decisionM1 },
      originNumber,
      rowIndex,
    });
    const outcomeForOrigin = eventValidation.outcome;
    const snapshots = eventValidation.snapshots;
    if (checkedM0.eligible && checkedM1.eligible && finite(outcomeForOrigin)
        && snapshots.M0 && snapshots.M1) {
      forecastsM0.push(decisionM0.prediction);
      forecastsM1.push(decisionM1.prediction);
      outcomes.push(outcomeForOrigin);
      statesM0.push(decisionM0.targetPosition);
      statesM1.push(decisionM1.targetPosition);
      originRowIndices.push(rowIndex);
      originSnapshot.push({
        originNumber,
        decisionDate: bundle.decisionDate,
        decisionRowIndex: rowIndex,
        executionDate: executionRow.date,
        outcomeEndDate: endRow.date,
        outcome: outcomeForOrigin,
        M0: snapshots.M0,
        M1: snapshots.M1,
      });
    }
  }
  for (let bundleIndex = n + 1; bundleIndex <= maturityBundleIndex; bundleIndex += 1) {
    const bundle = bundles[bundleIndex];
    if (!bundle || bundle.decisionDate > finalOutcomeDate) continue;
    const record = bundle.markets && bundle.markets[market];
    for (const modelKey of ['M0', 'M1']) {
      const checked = validatePostWindowDecisionPresence(
        record && record.decisions && record.decisions[modelKey],
        modelKey, market, bundle, bundleIndex, previousTargetState[modelKey],
        record && record.fit, issues,
      );
      if (!checked.valid) valid = false;
      if (checked.decision && ['LONG', 'CASH'].includes(checked.decision.targetPosition)) {
        previousTargetState[modelKey] = checked.decision.targetPosition;
      }
    }
  }
  if (forecastsM0.length !== n || forecastsM1.length !== n || outcomes.length !== n
      || statesM0.length !== n || statesM1.length !== n || originRowIndices.length !== n
      || originSnapshot.length !== n) {
    fail('FIXED_WINDOW_COVERAGE_NOT_EXACTLY_756_COMPLETE_ORIGINS', {
      detail: `complete=${Math.min(forecastsM0.length, forecastsM1.length, outcomes.length)}`,
    });
  }
  if (!activationSnapshot) fail('ACTIVATION_EVENT_COVERAGE_INCOMPLETE');
  const summary = {
    market,
    coveragePassed: valid,
    completeOrigins: Math.min(forecastsM0.length, forecastsM1.length, outcomes.length),
    firstOriginDate: bundles[1] && bundles[1].decisionDate,
    lastOriginDate: bundles[n] && bundles[n].decisionDate,
    outcomeEndDate: finalOutcomeDate,
    targetSessionRows: rows.length,
    missedDecisionSessionRows: Math.max(0, rows.length - n - 3),
    missedDecisionOriginCount: missedDecisionOriginDates.length,
    missedDecisionOriginDates,
    zeroMissedDecisionOriginsPassed: missedDecisionOriginDates.length === 0,
  };
  if (!valid) {
    return { ...summary, coveragePassed: false, windowSha256: null, mse: null,
      clarkWest: null, wealth: null,
      gates: { zeroMissedDecisionOrigins: missedDecisionOriginDates.length === 0,
        mse: false, wealth: false, x2: false } };
  }
  const mse = forecastMse(outcomes, forecastsM0, forecastsM1);
  const mseGate = mse.passed;
  if (!mseGate) fail('MSE_IMPROVEMENT_GATE_FAILED');
  const cw = clarkWest(outcomes, forecastsM0, forecastsM1);
  if (!cw.ok) fail('CLARK_WEST_CALCULATION_FAILED', { detail: cw.reason });
  const costs = model.COSTS[common.TARGETS[market].marketClass];
  const queuedDecisionRowIndices = [activationDecisionRowIndex, ...originRowIndices];
  const wealthStatesM0 = [checkedActivation.M0.decision.targetPosition, ...statesM0];
  const wealthStatesM1 = [checkedActivation.M1.decision.targetPosition, ...statesM1];
  const primaryM0 = replayWealth(rows, wealthStatesM0, costs.primary,
    queuedDecisionRowIndices);
  const stressM0 = replayWealth(rows, wealthStatesM0, costs.stress,
    queuedDecisionRowIndices);
  const primaryM1 = replayWealth(rows, wealthStatesM1, costs.primary,
    queuedDecisionRowIndices);
  const stressM1 = replayWealth(rows, wealthStatesM1, costs.stress,
    queuedDecisionRowIndices);
  const buyHold = buyAndHoldWealth(rows);
  const wealthGate = Boolean(stressM0.ok && stressM1.ok && positive(buyHold)
    && stressM1.terminalWealth > stressM0.terminalWealth
    && stressM1.terminalWealth > buyHold);
  const x2Gate = Boolean(stressM1.ok && positive(buyHold)
    && stressM1.terminalWealth >= ENDPOINT_CONTRACT.x2MinimumRatio * buyHold);
  if (!wealthGate) fail('STRESS_WEALTH_GATE_FAILED');
  if (!x2Gate) fail('X2_GATE_FAILED');
  const windowSnapshot = {
    market,
    rows: rows.map(row => ({ date: row.date, targetClose: row.targetClose,
      cashClose: row.cashClose })),
    activation: activationSnapshot,
    origins: originSnapshot,
  };
  return {
    ...summary,
    coveragePassed: true,
    windowSha256: model.hashCanonical(windowSnapshot),
    mse,
    clarkWest: cw,
    wealth: {
      rows: rows.length,
      firstDate: rows[0].date,
      lastDate: rows.at(-1).date,
      activationDecisionRowIndex,
      originRowIndices,
      queuedDecisionRowIndices,
      M0: { primary: primaryM0, stress: stressM0 },
      M1: { primary: primaryM1, stress: stressM1 },
      buyAndHold: { terminalWealth: buyHold, initialPosition: 'LONG', costs: 0 },
      m1StressToBuyAndHoldRatio: stressM1.ok && positive(buyHold)
        ? stressM1.terminalWealth / buyHold : null,
    },
    gates: { zeroMissedDecisionOrigins: missedDecisionOriginDates.length === 0,
      mse: mseGate, wealth: wealthGate, x2: x2Gate },
  };
}

function finalizeReport(report) {
  const canonical = model.canonicalize(report);
  canonical.evaluationSha256 = model.hashCanonical(canonical);
  return deepFreeze(canonical);
}

function evaluateProspectiveEndpoint(input = {}) {
  const issues = issueCollector();
  const manifest = validateManifestContract(input.manifest, issues);
  const selection = selectEndpointPrefix(input.bundles, manifest, issues);
  const bundles = selection.bundles;
  const manifestSha256 = manifest && typeof manifest === 'object'
    ? model.hashCanonical(manifest) : null;
  if (selection.endpointIndex === null) {
    const currentIssues = issues.sorted();
    return finalizeReport({
      schema: 'fg-control-residual-pls1-endpoint-evaluation-v1',
      modelId: ENDPOINT_CONTRACT.modelId,
      contractSha256: model.hashCanonical(ENDPOINT_CONTRACT),
      manifestSha256,
      performanceDisclosed: false,
      endpoint: {
        evaluable: false,
        activationDecisionDate: selection.activation && selection.activation.decisionDate || null,
        activationCollectedAtUtc: selection.activation && selection.activation.collectedAtUtc || null,
        thresholdUtc: selection.activation && exactUtc(selection.activation.collectedAtUtc)
          ? new Date(Date.parse(selection.activation.collectedAtUtc)
            + (ENDPOINT_CONTRACT.minimumElapsedSeconds * 1000)).toISOString() : null,
        originSlotsObserved: selection.originSlotsObserved,
        maturityRowsObserved: selection.maturityRowsObserved,
        waitReason: selection.waitReason,
      },
      gates: { endpoint: false, coverage: false, integrity: currentIssues.length === 0,
        zeroMissedDecisionOrigins: false, mse: false, clarkWestHolm: false,
        wealth: false, x2: false },
      markets: null,
      holm: null,
      statisticalGatesPassed: false,
      x2StatisticalGatesPassed: false,
      statisticalVerdict: 'ENDPOINT_NOT_EVALUABLE',
      x2StatisticalVerdict: 'X2_ENDPOINT_NOT_EVALUABLE',
      trustVerdictAvailable: false,
      failureReasons: currentIssues,
    });
  }
  const endpointBundle = bundles[selection.endpointIndex];
  const performanceBundles = bundles.slice(0, selection.maturityBundleIndex + 1);
  const marketResults = {};
  for (const market of ENDPOINT_CONTRACT.marketOrder) {
    marketResults[market] = analyzeMarket(market, performanceBundles,
      selection.maturityBundleIndex, selection.finalOutcomeDate, issues);
  }
  const pValues = Object.fromEntries(ENDPOINT_CONTRACT.marketOrder.map(market => [market,
    marketResults[market].clarkWest && marketResults[market].clarkWest.ok
      ? marketResults[market].clarkWest.pOneSided : 1,
  ]));
  const holm = holmStepDown(pValues);
  if (!holm.allRejected) issues.add('CLARK_WEST_HOLM_GATE_FAILED');
  const finalIssues = issues.sorted();
  const coverageGate = ENDPOINT_CONTRACT.marketOrder.every(market => (
    marketResults[market].coveragePassed && marketResults[market].completeOrigins
      === ENDPOINT_CONTRACT.originsPerMarket
  ));
  const integrityGate = finalIssues.every(issue => ['MSE_IMPROVEMENT_GATE_FAILED',
    'CLARK_WEST_CALCULATION_FAILED', 'CLARK_WEST_HOLM_GATE_FAILED',
    'STRESS_WEALTH_GATE_FAILED', 'X2_GATE_FAILED',
    'MISSED_DECISION_ORIGIN_IN_FIXED_ENDPOINT_WINDOW'].includes(issue.code));
  const zeroMissedDecisionOriginsGate = ENDPOINT_CONTRACT.marketOrder.every(market => (
    marketResults[market].gates.zeroMissedDecisionOrigins
  ));
  const mseGate = ENDPOINT_CONTRACT.marketOrder.every(market => marketResults[market].gates.mse);
  const wealthGate = ENDPOINT_CONTRACT.marketOrder.every(market => marketResults[market].gates.wealth);
  const x2Gate = ENDPOINT_CONTRACT.marketOrder.every(market => marketResults[market].gates.x2);
  const statisticalGatesPassed = coverageGate && integrityGate && zeroMissedDecisionOriginsGate
    && mseGate && holm.allRejected && wealthGate;
  const x2StatisticalGatesPassed = statisticalGatesPassed && x2Gate;
  const endpointAnchor = {
    activationDecisionDate: selection.activation.decisionDate,
    activationCollectedAtUtc: selection.activation.collectedAtUtc,
    thresholdUtc: new Date(Date.parse(selection.activation.collectedAtUtc)
      + (ENDPOINT_CONTRACT.minimumElapsedSeconds * 1000)).toISOString(),
    endpointDecisionDate: endpointBundle.decisionDate,
    endpointCollectedAtUtc: endpointBundle.collectedAtUtc,
    endpointBundleIndex: selection.endpointIndex,
    maturityBundleIndex: selection.maturityBundleIndex,
  };
  return finalizeReport({
    schema: 'fg-control-residual-pls1-endpoint-evaluation-v1',
    modelId: ENDPOINT_CONTRACT.modelId,
    contractSha256: model.hashCanonical(ENDPOINT_CONTRACT),
    manifestSha256,
    performanceDisclosed: true,
    endpoint: {
      evaluable: true,
      ...endpointAnchor,
      endpointAnchorSha256: model.hashCanonical(endpointAnchor),
      fixedOriginsPerMarket: ENDPOINT_CONTRACT.originsPerMarket,
      firstOriginDate: performanceBundles[1].decisionDate,
      lastOriginDate: performanceBundles[ENDPOINT_CONTRACT.originsPerMarket].decisionDate,
      finalOutcomeDate: selection.finalOutcomeDate,
      laterOriginsExcluded: true,
    },
    gates: { endpoint: true, coverage: coverageGate, integrity: integrityGate,
      zeroMissedDecisionOrigins: zeroMissedDecisionOriginsGate, mse: mseGate,
      clarkWestHolm: holm.allRejected, wealth: wealthGate, x2: x2Gate },
    markets: marketResults,
    holm,
    statisticalGatesPassed,
    x2StatisticalGatesPassed,
    statisticalVerdict: statisticalGatesPassed
      ? 'STATISTICAL_GATES_PASSED' : 'STATISTICAL_GATES_FAILED',
    x2StatisticalVerdict: x2StatisticalGatesPassed
      ? 'X2_STATISTICAL_GATES_PASSED' : 'X2_STATISTICAL_GATES_FAILED',
    trustVerdictAvailable: false,
    failureReasons: finalIssues,
  });
}

function loadBundlesThroughEndpoint(root, manifest) {
  const files = common.listDecisionFiles(root);
  const bundles = [];
  let activationMs = null;
  let lastOriginDate = null;
  let maturityRows = 0;
  for (const file of files) {
    const { value: bundle } = common.verifyCanonicalJson(file);
    bundles.push(bundle);
    if (bundles.length === 1 && exactUtc(bundle.collectedAtUtc)) {
      activationMs = Date.parse(bundle.collectedAtUtc);
    }
    const index = bundles.length - 1;
    if (index === ENDPOINT_CONTRACT.originsPerMarket) lastOriginDate = bundle.decisionDate;
    else if (index > ENDPOINT_CONTRACT.originsPerMarket && lastOriginDate !== null
        && maturityRows < ENDPOINT_CONTRACT.outcomeSessionOffset) {
      const reference = bundle.markets && bundle.markets[ENDPOINT_CONTRACT.marketOrder[0]];
      for (const row of reference && Array.isArray(reference.newRows) ? reference.newRows : []) {
        if (row && row.date > lastOriginDate) maturityRows += 1;
        if (maturityRows === ENDPOINT_CONTRACT.outcomeSessionOffset) break;
      }
    }
    if (activationMs !== null && maturityRows === ENDPOINT_CONTRACT.outcomeSessionOffset
        && exactUtc(bundle.collectedAtUtc)
        && Date.parse(bundle.collectedAtUtc) >= activationMs
          + (ENDPOINT_CONTRACT.minimumElapsedSeconds * 1000)) break;
  }
  return bundles;
}

function evaluateLockbox(root = common.LOCKBOX_ROOT) {
  const seedPath = path.join(root, 'freeze', 'seed.json');
  const manifestPath = path.join(root, 'freeze', 'manifest.json');
  const { digest: seedSha256 } = common.verifyCanonicalJson(seedPath);
  const { value: manifest } = common.verifyCanonicalJson(manifestPath);
  if (!manifest.seed || manifest.seed.sha256 !== seedSha256) {
    throw new Error('PLS1 endpoint evaluation seed identity mismatch');
  }
  const bundles = loadBundlesThroughEndpoint(root, manifest);
  return evaluateProspectiveEndpoint({ manifest, bundles });
}

module.exports = deepFreeze({
  NORMAL_TAIL_COEFFICIENTS,
  ENDPOINT_CONTRACT,
  polevl,
  p1evl,
  cephesErf,
  cephesErfc,
  normalSurvival,
  forecastMse,
  clarkWest,
  holmStepDown,
  replayWealth,
  buyAndHoldWealth,
  evaluateProspectiveEndpoint,
  evaluateLockbox,
});

if (require.main === module) {
  try {
    process.stdout.write(`${NATIVE_JSON_STRINGIFY(evaluateLockbox(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`PLS1 endpoint evaluation failed: ${error.stack || error.message}\n`);
    process.exit(1);
  }
}
