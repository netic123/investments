'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../research/fear_greed_control_residual_pls1');
const seedBuilder = require('../scripts/build-pls1-lockbox-seed');
const collector = require('../scripts/pls1-lockbox-collect');

function isoDay(index) {
  return new Date(Date.UTC(2018, 0, 1 + index)).toISOString().slice(0, 10);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function closeTo(actual, expected, tolerance = 2e-11, message = '') {
  assert.equal(Number.isFinite(actual), true, `${message} actual must be finite`);
  assert.equal(Number.isFinite(expected), true, `${message} expected must be finite`);
  const scale = Math.max(1, Math.abs(actual), Math.abs(expected));
  assert.ok(Math.abs(actual - expected) <= tolerance * scale,
    `${message} expected ${actual} to be within ${tolerance * scale} of ${expected}`);
}

function arraysClose(actual, expected, tolerance = 2e-11, message = '') {
  assert.equal(actual.length, expected.length, `${message} length`);
  actual.forEach((value, index) => closeTo(
    value, expected[index], tolerance, `${message}[${index}]`,
  ));
}

function makeTrainingRows(length = 480) {
  return Array.from({ length }, (unused, index) => {
    const controls = [
      Math.sin(index / 7) + (index * 0.0001),
      Math.cos(index / 11) - (index * 0.00007),
      Math.sin(index / 17) + Math.cos(index / 5),
      0.02 + (0.003 * Math.cos(index / 19)),
      Math.sin(index / 37) + (0.2 * Math.cos(index / 13)),
    ];
    const components = [
      50 + (12 * Math.sin(index / 3)) + (2 * controls[0]),
      48 + (10 * Math.cos(index / 8)) - controls[1],
      52 + (11 * Math.sin(index / 13)) + controls[2],
      47 + (9 * Math.cos(index / 23)) - (3 * controls[3]),
      51 + (8 * Math.sin(index / 29)) + controls[4],
      49 + (7 * Math.cos(index / 31)) - controls[0],
    ];
    const latent = (0.7 * components[0]) - (0.4 * components[2])
      + (0.2 * components[5]);
    const outcome = (0.003 * controls[0]) - (0.002 * controls[1])
      + (0.00008 * latent) + (0.0005 * Math.sin(index / 2.3));
    return { controls, components, outcome };
  });
}

function makeMarket(length = 460) {
  let target = 100;
  let cash = 100;
  const rows = [];
  for (let index = 0; index < length; index += 1) {
    target *= Math.exp(0.00035 + (0.007 * Math.sin(index / 9))
      + (0.004 * Math.cos(index / 23)) + (0.001 * Math.sin(index / 3.7)));
    cash *= Math.exp(0.00012 + (0.00002 * Math.cos(index / 31)));
    const componentValues = [
      50 + (18 * Math.sin(index / 13)) + (4 * Math.sin(index / 5)),
      49 + (17 * Math.cos(index / 17)),
      51 - (16 * Math.sin(index / 11)),
      48 + (15 * Math.cos(index / 7)),
      52 + (14 * Math.sin(index / 19)),
      47 + (13 * Math.cos(index / 31)),
    ].map(value => Math.max(0, Math.min(100, value)));
    rows.push({
      date: isoDay(index),
      targetClose: target,
      cashClose: cash,
      referenceDate: isoDay(index),
      components: Object.fromEntries(model.COMPONENT_KEYS.map(
        (key, component) => [key, componentValues[component]],
      )),
      componentAsOf: Object.fromEntries(model.COMPONENT_KEYS.map(key => [key, isoDay(index)])),
      availableAtUtc: null,
    });
  }
  return {
    key: 'properties',
    name: 'Properties synthetic market',
    targetId: 'SYNTH',
    cashId: 'BIL',
    marketClass: 'equity',
    rows,
  };
}

function assertDeepFrozen(value, location = 'value', seen = new Set()) {
  if (value === null || typeof value !== 'object' || seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true, `${location} must be frozen`);
  for (const [key, child] of Object.entries(value)) {
    assertDeepFrozen(child, `${location}.${key}`, seen);
  }
}

function trainingResiduals(rows, fit) {
  const residualY = [];
  const residualX = [];
  for (const row of rows) {
    const standardizedControls = row.controls.map((value, column) => (
      (value - fit.controlMeans[column]) / fit.controlPopulationStandardDeviations[column]
    ));
    const design = [1, ...standardizedControls];
    const standardizedComponents = row.components.map((value, column) => (
      fit.componentPopulationStandardDeviations[column] <= model.NUMERIC_TOLERANCE
        ? 0
        : (value - fit.componentMeans[column])
          / fit.componentPopulationStandardDeviations[column]
    ));
    residualY.push(row.outcome - design.reduce(
      (sum, value, column) => sum + (value * fit.alpha[column]), 0,
    ));
    residualX.push(standardizedComponents.map((value, component) => (
      value - design.reduce(
        (sum, designValue, rowIndex) => sum + (designValue * fit.gamma[rowIndex][component]),
        0,
      )
    )));
  }
  return { residualY, residualX };
}

test('dangerous canonical property names are rejected recursively at every key order', () => {
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const first = JSON.parse(`{"outer":{"ok":1,"${key}":2},"tail":3}`);
    const second = JSON.parse(`{"tail":3,"outer":{"${key}":2,"ok":1}}`);
    for (const hostile of [first, second]) {
      assert.throws(() => model.canonicalize(hostile),
        new RegExp(`Canonical JSON rejects dangerous property name ${key}`));
    }
  }
});

test('canonical JSON never aliases sparse, undefined, accessor, or symbol-bearing values', () => {
  const validHashes = new Set([
    model.hashCanonical([null]),
    model.hashCanonical({}),
    model.hashCanonical({ value: 1 }),
  ]);
  const invalidValues = [new Array(1), { value: undefined }, new Date(0)];
  const symbolBearing = {};
  symbolBearing[Symbol('value')] = 1;
  invalidValues.push(symbolBearing);
  for (const invalid of invalidValues) {
    assert.throws(() => model.hashCanonical(invalid));
  }
  assert.equal(validHashes.size, 3);

  for (let seed = 1; seed <= 25; seed += 1) {
    let reads = 0;
    const accessor = {};
    Object.defineProperty(accessor, `value${seed}`, {
      enumerable: true,
      get() {
        reads += 1;
        return seed + reads;
      },
    });
    assert.throws(() => model.canonicalize(accessor), /data property/);
    assert.equal(reads, 0);
  }
});

test('exact dyadic score gating is sign-symmetric and accepts exact equality only', () => {
  for (const variance of [0, Number.MIN_VALUE, 0.04, 1, 2.3545552473930567]) {
    for (const score of [0, 1, 5, 7.672280051251155]) {
      assert.equal(model.currentPlsScoreWithinRange(score, variance),
        model.currentPlsScoreWithinRange(-score, variance));
    }
  }
  assert.equal(model.currentPlsScoreWithinRange(5, 1), true);
  assert.equal(model.currentPlsScoreWithinRange(5 + Number.EPSILON, 1), true,
    'adding epsilon below the binary64 ulp at five leaves the exact value unchanged');
  assert.equal(model.currentPlsScoreWithinRange(5 + (4 * Number.EPSILON), 1), false);
});

test('current control Mahalanobis radius is invariant to consistent affine control units', () => {
  const rows = makeTrainingRows();
  const currentControls = [0.4, -0.2, 0.7, 0.018, -0.1];
  const currentComponents = [58, 44, 62, 51, 49, 55];
  const scales = [2, 0.5, 3, 10, 4];
  const shifts = [7, -3, 20, 0.4, -11];
  const transform = values => values.map(
    (value, column) => (value * scales[column]) + shifts[column],
  );
  const baseline = model.fitControlResidualPls1(rows, currentControls, currentComponents);
  const transformed = model.fitControlResidualPls1(rows.map(row => ({
    ...row,
    controls: transform(row.controls),
  })), transform(currentControls), currentComponents);

  assert.equal(baseline.ok, true);
  assert.equal(transformed.ok, true);
  arraysClose(transformed.standardizedCurrentControls,
    baseline.standardizedCurrentControls, 2e-11, 'standardized current controls');
  closeTo(transformed.currentControlMahalanobisRadius,
    baseline.currentControlMahalanobisRadius, 2e-11, 'control Mahalanobis radius');
  closeTo(transformed.predictionM0, baseline.predictionM0, 2e-11, 'M0 prediction');
  closeTo(transformed.predictionM1, baseline.predictionM1, 2e-11, 'M1 prediction');
});

test('one-factor PLS prediction is invariant to a consistent component permutation', () => {
  const rows = makeTrainingRows();
  const currentControls = [0.4, -0.2, 0.7, 0.018, -0.1];
  const currentComponents = [58, 44, 62, 51, 49, 55];
  const permutation = [3, 0, 5, 1, 4, 2];
  const permute = values => permutation.map(index => values[index]);
  const baseline = model.fitControlResidualPls1(rows, currentControls, currentComponents);
  const permuted = model.fitControlResidualPls1(rows.map(row => ({
    controls: row.controls,
    components: permute(row.components),
    outcome: row.outcome,
  })), currentControls, permute(currentComponents));

  assert.equal(baseline.ok, true);
  assert.equal(permuted.ok, true);
  closeTo(permuted.predictionM0, baseline.predictionM0, 2e-12, 'M0 prediction');
  closeTo(permuted.predictionM1, baseline.predictionM1, 2e-12, 'M1 prediction');
  closeTo(permuted.currentScore, baseline.currentScore, 2e-12, 'current score');
  closeTo(permuted.currentScoreZ, baseline.currentScoreZ, 2e-12, 'current score z');
  closeTo(permuted.currentControlMahalanobisRadius,
    baseline.currentControlMahalanobisRadius, 2e-12, 'control Mahalanobis radius');
  closeTo(permuted.q, baseline.q, 2e-12, 'q');
  closeTo(permuted.crossCovarianceNorm, baseline.crossCovarianceNorm, 2e-12,
    'cross-covariance norm');
  arraysClose(permuted.componentMeans, permute(baseline.componentMeans), 2e-12,
    'component means');
  arraysClose(permuted.weights, permute(baseline.weights), 2e-12, 'weights');
  arraysClose(permuted.crossCovariance, permute(baseline.crossCovariance), 2e-12,
    'cross-covariance');
  for (let row = 0; row < baseline.gamma.length; row += 1) {
    arraysClose(permuted.gamma[row], permute(baseline.gamma[row]), 2e-12, `gamma row ${row}`);
  }
});

test('reflecting every standardized component sign cannot change the PLS prediction', () => {
  const rows = makeTrainingRows();
  const currentControls = [0.4, -0.2, 0.7, 0.018, -0.1];
  const currentComponents = [58, 44, 62, 51, 49, 55];
  const reflect = values => values.map(value => 100 - value);
  const baseline = model.fitControlResidualPls1(rows, currentControls, currentComponents);
  const reflected = model.fitControlResidualPls1(rows.map(row => ({
    controls: row.controls,
    components: reflect(row.components),
    outcome: row.outcome,
  })), currentControls, reflect(currentComponents));

  assert.equal(baseline.ok, true);
  assert.equal(reflected.ok, true);
  closeTo(reflected.predictionM0, baseline.predictionM0, 2e-12, 'M0 prediction');
  closeTo(reflected.predictionM1, baseline.predictionM1, 2e-12, 'M1 prediction');
  closeTo(reflected.currentScore, baseline.currentScore, 2e-12, 'current score');
  closeTo(reflected.currentScoreZ, baseline.currentScoreZ, 2e-12, 'current score z');
  closeTo(reflected.currentControlMahalanobisRadius,
    baseline.currentControlMahalanobisRadius, 2e-12, 'control Mahalanobis radius');
  closeTo(reflected.q, baseline.q, 2e-12, 'q');
  closeTo(reflected.scoreVariance, baseline.scoreVariance, 2e-12, 'score variance');
  arraysClose(reflected.weights, baseline.weights.map(value => -value), 2e-12,
    'reflected weights');
  arraysClose(reflected.crossCovariance,
    baseline.crossCovariance.map(value => -value), 2e-12, 'reflected cross-covariance');
  arraysClose(reflected.residualCurrentComponents,
    baseline.residualCurrentComponents.map(value => -value), 2e-12,
    'reflected current residuals');
});

test('the frozen PLS orientation makes q nonnegative and covariance equal ||g||', () => {
  const rows = makeTrainingRows(500);
  const fit = model.fitControlResidualPls1(
    rows, [0.4, -0.2, 0.7, 0.018, -0.1], [58, 44, 62, 51, 49, 55],
  );
  assert.equal(fit.ok, true);
  assert.equal(fit.zeroFactor, false);
  assert.ok(fit.q >= 0, `q must be nonnegative, received ${fit.q}`);

  const { residualY, residualX } = trainingResiduals(rows, fit);
  const n = rows.length;
  const crossCovariance = model.COMPONENT_KEYS.map((unused, component) => residualX.reduce(
    (sum, values, row) => sum + (values[component] * residualY[row]), 0,
  ) / n);
  const scores = residualX.map(values => values.reduce(
    (sum, value, component) => sum + (value * fit.weights[component]), 0,
  ));
  const scoreOutcomeCovariance = scores.reduce(
    (sum, score, row) => sum + (score * residualY[row]), 0,
  ) / n;
  const scoreVariance = scores.reduce((sum, score) => sum + (score ** 2), 0) / n;

  arraysClose(crossCovariance, fit.crossCovariance, 2e-12, 'reconstructed g');
  closeTo(scoreOutcomeCovariance, fit.crossCovarianceNorm, 2e-12,
    "cov(Ew,e) must equal ||E'e/n||");
  assert.ok(scoreOutcomeCovariance >= -1e-14,
    `oriented score covariance must be nonnegative, received ${scoreOutcomeCovariance}`);
  closeTo(scoreVariance, fit.scoreVariance, 2e-12, 'score variance');
  closeTo(fit.q, scoreOutcomeCovariance / scoreVariance, 2e-12, 'q identity');
  closeTo(fit.currentScoreZ, fit.currentScore / Math.sqrt(scoreVariance), 2e-12,
    'current score training-standard-deviation leverage');
  assert.ok(Math.abs(fit.currentScoreZ) <= model.MAX_CURRENT_PLS_SCORE_Z);
  arraysClose(fit.weights,
    crossCovariance.map(value => value / fit.crossCovarianceNorm), 2e-12,
    'fixed g / ||g|| orientation');
});

test('mutating row t+2 cannot affect decisions at t or t+1, but matures at t+2', () => {
  const t = 420;
  const original = makeMarket(450);
  const changed = clone(original);
  changed.rows[t + 2].targetClose *= 1.2;
  changed.rows[t + 2].cashClose *= 0.95;
  for (const key of model.COMPONENT_KEYS) {
    changed.rows[t + 2].components[key] = 100 - changed.rows[t + 2].components[key];
  }
  const positions = { M0: 'CASH', M1: 'LONG' };

  for (const decisionIndex of [t, t + 1]) {
    const baseline = model.buildLatestDecision(original, positions, decisionIndex);
    const mutated = model.buildLatestDecision(changed, positions, decisionIndex);
    assert.deepEqual(mutated.feature, baseline.feature);
    assert.deepEqual(mutated.trainingRows, baseline.trainingRows);
    assert.deepEqual(mutated.fit, baseline.fit);
    assert.deepEqual(mutated.M0, baseline.M0);
    assert.deepEqual(mutated.M1, baseline.M1);
  }

  const baselineAtMaturity = model.buildLatestDecision(original, positions, t + 2);
  const mutatedAtMaturity = model.buildLatestDecision(changed, positions, t + 2);
  assert.notEqual(mutatedAtMaturity.M1.trainingRowsSha256,
    baselineAtMaturity.M1.trainingRowsSha256,
    'the changed t+2 row must enter identity only when it is observed and the t label matures');
});

test('streaming prefix replay equals an explicit-index replay over the full future-bearing input', () => {
  const fullMarket = makeMarket(410);
  let positions = { M0: 'LONG', M1: 'LONG' };
  for (let decisionIndex = 377; decisionIndex <= 386; decisionIndex += 1) {
    const fromFullInput = model.buildLatestDecision(fullMarket, positions, decisionIndex);
    const fromStreamingPrefix = model.buildLatestDecision({
      ...fullMarket,
      rows: fullMarket.rows.slice(0, decisionIndex + 1),
    }, positions);
    assert.deepEqual(fromFullInput.trainingRows, fromStreamingPrefix.trainingRows,
      `training mismatch at ${isoDay(decisionIndex)}`);
    assert.deepEqual(fromFullInput.fit, fromStreamingPrefix.fit,
      `fit mismatch at ${isoDay(decisionIndex)}`);
    assert.deepEqual(fromFullInput.M0, fromStreamingPrefix.M0,
      `M0 mismatch at ${isoDay(decisionIndex)}`);
    assert.deepEqual(fromFullInput.M1, fromStreamingPrefix.M1,
      `M1 mismatch at ${isoDay(decisionIndex)}`);
    const causalFeature = feature => ({
      ...feature,
      maturityDate: null,
    });
    assert.deepEqual(causalFeature(fromFullInput.feature), causalFeature(fromStreamingPrefix.feature),
      `causal feature mismatch at ${isoDay(decisionIndex)}`);
    assert.equal(fromFullInput.feature.maturityDate, fromStreamingPrefix.feature.maturityDate,
      `future-bearing input must not reveal an otherwise unknown t+2 date at ${isoDay(decisionIndex)}`);
    positions = {
      M0: fromStreamingPrefix.M0.targetPosition,
      M1: fromStreamingPrefix.M1.targetPosition,
    };
  }
});

test('the current feature row is excluded from every training moment and coefficient', () => {
  const original = makeMarket(430);
  const changed = clone(original);
  const current = changed.rows.at(-1);
  current.components.momentum += 1;
  const baseline = model.buildLatestDecision(original);
  const mutated = model.buildLatestDecision(changed);

  assert.equal(baseline.fit.ok, true);
  assert.equal(mutated.fit.ok, true);
  const mathematicalTrainingPayload = row => ({
    featureIndex: row.featureIndex,
    featureDate: row.featureDate,
    executionIndex: row.executionIndex,
    executionDate: row.executionDate,
    maturityIndex: row.maturityIndex,
    maturityDate: row.maturityDate,
    controls: row.controls,
    components: row.components,
    outcome: row.outcome,
  });
  assert.deepEqual(mutated.trainingRows.map(mathematicalTrainingPayload),
    baseline.trainingRows.map(mathematicalTrainingPayload));
  const trainingOnlyFitFields = [
    'trainingRowCount',
    'controlMeans',
    'controlPopulationStandardDeviations',
    'componentMeans',
    'componentPopulationStandardDeviations',
    'alpha',
    'gamma',
    'crossCovariance',
    'crossCovarianceNorm',
    'weights',
    'scoreVariance',
    'q',
    'zeroFactor',
    'maximumCurrentControlMahalanobisRadius',
    'maximumCurrentPlsScoreZ',
    'maximumNormalEquationResidual',
  ];
  for (const field of trainingOnlyFitFields) {
    assert.deepEqual(mutated.fit[field], baseline.fit[field],
      `${field} must be a function of matured training rows only`);
  }
  assert.deepEqual(mutated.fit.standardizedCurrentControls,
    baseline.fit.standardizedCurrentControls);
  assert.equal(mutated.fit.currentControlMahalanobisRadius,
    baseline.fit.currentControlMahalanobisRadius);
  assert.equal(mutated.fit.predictionM0, baseline.fit.predictionM0);
  assert.notDeepEqual(mutated.fit.standardizedCurrentComponents,
    baseline.fit.standardizedCurrentComponents);
  assert.notEqual(mutated.fit.fitSha256, baseline.fit.fitSha256);
});

test('successful fits and decisions are deeply immutable, including nested numeric arrays', () => {
  const inputRows = makeTrainingRows(400);
  const beforeFitInput = clone(inputRows);
  const fit = model.fitControlResidualPls1(
    inputRows, [0.4, -0.2, 0.7, 0.018, -0.1], [58, 44, 62, 51, 49, 55],
  );
  assert.equal(fit.ok, true);
  assert.deepEqual(inputRows, beforeFitInput, 'fitting must not mutate caller-owned training rows');
  assertDeepFrozen(fit, 'fit');
  assert.throws(() => { fit.weights[0] = 123; }, TypeError);
  assert.throws(() => { fit.gamma[0].push(123); }, TypeError);

  const inputMarket = makeMarket(430);
  const beforeDecisionInput = clone(inputMarket);
  const decision = model.buildLatestDecision(inputMarket);
  assert.deepEqual(inputMarket, beforeDecisionInput, 'decision building must not mutate caller input');
  assertDeepFrozen(decision, 'decision');
  assert.throws(() => { decision.trainingRows[0].controls[0] = 123; }, TypeError);
  assert.throws(() => { decision.M1.currentFeatureInvalidReasons.push('forged'); }, TypeError);
  assert.throws(() => { decision.market.rows.push(decision.market.rows[0]); }, TypeError);
});

test('alignment preserves target sessions through an invalid component gap', () => {
  function historyRow(index) {
    return {
      date: isoDay(index),
      n: 6,
      parts: Object.fromEntries(model.COMPONENT_KEYS.map((key, component) => [key, {
        score: 40 + component + (index / 100),
        raw: index,
        asOf: isoDay(index),
      }])),
    };
  }
  const target = { rows: Array.from({ length: 20 }, (unused, index) => ({
    date: isoDay(index), adjustedClose: 100 + index,
  })) };
  const cash = { rows: Array.from({ length: 20 }, (unused, index) => ({
    date: isoDay(index), adjustedClose: 90 + (index / 10),
  })) };
  const aligned = seedBuilder.alignMarketRows({
    key: 'gap',
    history: [historyRow(0), historyRow(15)],
  }, target, cash, 7, 1);

  assert.deepEqual(aligned.map(row => row.date), target.rows.map(row => row.date),
    'a missing or stale component vector must invalidate the origin, not delete a target session');
  for (let index = 8; index < 15; index += 1) {
    assert.ok(model.COMPONENT_KEYS.every(key => aligned[index].components[key] === null),
      `${aligned[index].date} must retain the target row with invalid components`);
    assert.ok(model.COMPONENT_KEYS.every(key => aligned[index].componentAsOf[key] === null),
      `${aligned[index].date} must not forge component provenance`);
  }
});

test('normalized session ordering validates the stored ledger, never a re-read of caller rows', () => {
  function sessionRow(date) {
    return {
      date,
      targetClose: 100,
      cashClose: 100,
      referenceDate: date,
      components: Object.fromEntries(model.COMPONENT_KEYS.map(key => [key, 50])),
      componentAsOf: Object.fromEntries(model.COMPONENT_KEYS.map(key => [key, date])),
      availableAtUtc: null,
    };
  }
  const laterOnFirstRead = sessionRow('2020-01-05');
  const earlierOnSecondRead = sessionRow('2020-01-01');
  const rows = [sessionRow('2020-01-04'), sessionRow('2020-01-05'), sessionRow('2020-01-02')];
  let middleRowReads = 0;
  Object.defineProperty(rows, '1', {
    enumerable: true,
    configurable: true,
    get() {
      middleRowReads += 1;
      return middleRowReads === 1 ? laterOnFirstRead : earlierOnSecondRead;
    },
  });
  const market = {
    key: 'toctou', name: 'TOCTOU synthetic market', targetId: 'SYNTH', cashId: 'BIL',
    marketClass: 'equity', rows,
  };
  assert.throws(() => model.normalizeMarket(market), /Rows must be strictly increasing/);
  assert.equal(middleRowReads, 1, 'each caller-supplied row must be read exactly once');

  assert.throws(() => model.normalizeMarket({
    ...market,
    rows: [sessionRow('2020-01-04'), sessionRow('2020-01-04')],
  }), /Rows must be strictly increasing/, 'an exactly equal session date must never be stored');
  assert.deepEqual(model.normalizeMarket({
    ...market,
    rows: [sessionRow('2020-01-04'), sessionRow('2020-01-05')],
  }).rows.map(row => row.date), ['2020-01-04', '2020-01-05']);

  let classReads = 0;
  const divergentIdentity = {
    key: 'toctou', name: 'TOCTOU synthetic market', targetId: 'SYNTH', cashId: 'BIL',
    rows: [sessionRow('2020-01-04')],
  };
  Object.defineProperty(divergentIdentity, 'marketClass', {
    enumerable: true,
    configurable: true,
    get() {
      classReads += 1;
      return classReads === 1 ? 'crypto' : 'equity';
    },
  });
  const normalized = model.normalizeMarket(divergentIdentity);
  assert.equal(classReads, 1, 'the market class must be read exactly once');
  assert.equal(normalized.marketClass, 'crypto',
    'the stored market class must be the validated first read');
});

test('prior model positions are read exactly once and bound into the frozen decision', () => {
  const market = makeMarket(200);
  let m0Reads = 0;
  const positions = { M1: 'LONG' };
  Object.defineProperty(positions, 'M0', {
    enumerable: true,
    configurable: true,
    get() {
      m0Reads += 1;
      return m0Reads === 1 ? 'LONG' : 'CASH';
    },
  });
  const decision = model.buildLatestDecision(market, positions);
  assert.equal(m0Reads, 1, 'each prior position must be read exactly once');
  assert.equal(decision.M0.fallbackReason, model.WARMUP_REASON);
  assert.equal(decision.M0.targetPosition, 'LONG');
  assert.equal(decision.M0.filledPosition, 'LONG',
    'the recorded filled position must be the validated first read');
  assert.equal(decision.M0.tradeRequired, false);
});

test('fitting reads each caller-supplied training and current value exactly once', () => {
  const rows = makeTrainingRows(400);
  const currentControls = [0.4, -0.2, 0.7, 0.018, -0.1];
  const currentComponents = [58, 44, 62, 51, 49, 55];
  const baseline = model.fitControlResidualPls1(rows, currentControls, currentComponents);
  assert.equal(baseline.ok, true);

  const hostileRows = clone(rows);
  const honestControls = hostileRows[7].controls;
  let controlsReads = 0;
  Object.defineProperty(hostileRows[7], 'controls', {
    enumerable: true,
    configurable: true,
    get() {
      controlsReads += 1;
      return controlsReads === 1 ? honestControls : honestControls.map(() => 1e9);
    },
  });
  const hostileRowFit = model.fitControlResidualPls1(hostileRows, currentControls,
    currentComponents);
  assert.equal(controlsReads, 1, 'training controls must be read exactly once');
  assert.equal(hostileRowFit.ok, true);
  assert.equal(hostileRowFit.fitSha256, baseline.fitSha256,
    'the fit must be a function of the validated first read only');

  const hostileCurrent = [...currentControls];
  let currentReads = 0;
  Object.defineProperty(hostileCurrent, '0', {
    enumerable: true,
    configurable: true,
    get() {
      currentReads += 1;
      return currentReads === 1 ? 0.4 : 40;
    },
  });
  const hostileCurrentFit = model.fitControlResidualPls1(rows, hostileCurrent,
    currentComponents);
  assert.equal(currentReads, 1, 'current controls must be read exactly once');
  assert.equal(hostileCurrentFit.ok, true);
  assert.equal(hostileCurrentFit.fitSha256, baseline.fitSha256,
    'the current design must be a function of the validated first read only');
});

test('fill records require a target session strictly later than the decision session', () => {
  const decisionDate = '2026-08-27';
  const decisions = Object.fromEntries(['M0', 'M1'].map((key, index) => [key, {
    decisionSha256: String(index + 1).repeat(64),
    decisionDate,
    targetPosition: index === 0 ? 'LONG' : 'CASH',
    tradeRequired: index === 1,
  }]));
  const priorBundle = {
    value: {
      collectedAtUtc: '2026-08-28T06:17:00.000Z',
      markets: { properties: { marketClass: 'equity', decisions } },
    },
  };
  const later = collector.resolvedEventsForMarket([priorBundle], 'properties', {
    date: '2026-08-28', targetClose: 101, cashClose: 100.01,
  });
  assert.equal(later.length, 2);
  assert.ok(later.every(event => event.kind === 'FILL' && event.fillDate > event.decisionDate));

  assert.throws(() => collector.resolvedEventsForMarket([priorBundle], 'properties', {
    date: decisionDate, targetClose: 101, cashClose: 100.01,
  }), /fill|target session|strictly|timing/i);
});
