'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const path = require('node:path');
const model = require('../research/fear_greed_control_residual_pls1');

function isoDay(index) {
  return new Date(Date.UTC(2018, 0, 1 + index)).toISOString().slice(0, 10);
}

function makeMarket(length = 520, mutate = null) {
  let target = 100;
  let cash = 100;
  const rows = [];
  for (let index = 0; index < length; index += 1) {
    target *= Math.exp(0.00035 + (0.007 * Math.sin(index / 9))
      + (0.004 * Math.cos(index / 23)) + (0.001 * Math.sin(index / 3.7)));
    cash *= Math.exp(0.00012 + (0.00002 * Math.cos(index / 31)));
    const base = 50 + (18 * Math.sin(index / 13)) + (7 * Math.cos(index / 29));
    rows.push({
      date: isoDay(index),
      targetClose: target,
      cashClose: cash,
      referenceDate: isoDay(index),
      components: {
        momentum: Math.max(0, Math.min(100, base + (4 * Math.sin(index / 5)))),
        strength: Math.max(0, Math.min(100, 49 + (17 * Math.cos(index / 17)))),
        volatility: Math.max(0, Math.min(100, 51 - (16 * Math.sin(index / 11)))),
        safeHaven: Math.max(0, Math.min(100, 48 + (15 * Math.cos(index / 7)))),
        credit: Math.max(0, Math.min(100, 52 + (14 * Math.sin(index / 19)))),
        breadth: Math.max(0, Math.min(100, 47 + (13 * Math.cos(index / 31)))),
      },
      componentAsOf: Object.fromEntries(model.COMPONENT_KEYS.map(key => [key, isoDay(index)])),
      availableAtUtc: null,
    });
  }
  const market = {
    key: 'test', name: 'Synthetic', targetId: 'SYNTH', cashId: 'CASH',
    marketClass: 'equity', rows,
  };
  if (mutate) mutate(market);
  return market;
}

function makeTrainingRows(n = 400) {
  const rows = [];
  for (let index = 0; index < n; index += 1) {
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
    rows.push({ controls, components, outcome });
  }
  return rows;
}

function makeTinyResidualTrainingRows(epsilon) {
  return Array.from({ length: 400 }, (unused, index) => {
    const controls = [Math.sin(index / 7), Math.cos(index / 11),
      Math.sin(index / 17) + Math.cos(index / 5),
      0.02 + (0.003 * Math.cos(index / 19)),
      Math.sin(index / 37) + (0.2 * Math.cos(index / 13))];
    const noise = [Math.sin(index * 1.414), Math.cos(index * 1.732),
      Math.sin(index * 2.236), Math.cos(index * 2.646),
      Math.sin(index * 3.142), Math.cos(index * 3.606)];
    return {
      controls,
      components: [50 + (3 * controls[0]) + (epsilon * noise[0]),
        50 + (3 * controls[1]) + (epsilon * noise[1]),
        50 + (2 * controls[2]) + (epsilon * noise[2]),
        50 + (100 * controls[3]) + (epsilon * noise[3]),
        50 + (2 * controls[4]) + (epsilon * noise[4]),
        50 + controls[0] - controls[1] + (epsilon * noise[5])],
      outcome: (0.002 * controls[0]) - (0.001 * controls[1]) + (0.01 * noise[0]),
    };
  });
}

function normalFit(design, outcomes) {
  const n = design.length;
  const p = design[0].length;
  const matrix = Array.from({ length: p }, () => Array(p).fill(0));
  const rhs = Array(p).fill(0);
  for (let row = 0; row < n; row += 1) {
    for (let left = 0; left < p; left += 1) {
      rhs[left] += design[row][left] * outcomes[row] / n;
      for (let right = 0; right < p; right += 1) {
        matrix[left][right] += design[row][left] * design[row][right] / n;
      }
    }
  }
  return model.solveLinearSystem(matrix, rhs);
}

function seededNearCollinearRows(seed, epsilon) {
  let state = seed;
  const random = () => {
    state = ((1664525 * state) + 1013904223) >>> 0;
    return ((state / 4294967296) * 2) - 1;
  };
  return Array.from({ length: 252 }, (unused, index) => {
    const first = random();
    const noise = random();
    const other0 = random();
    const other1 = random();
    const other2 = random();
    return {
      controls: [first, first + (epsilon * noise), other0, other1, other2],
      components: [50, 50, 50, 50, 50, 50],
      outcome: (0.001 * first) + (0.0002 * Math.sin(index)),
    };
  });
}

function standardizedControlNormal(rows) {
  const means = Array.from({ length: 5 }, (unused, column) => rows.reduce(
    (sum, row) => sum + row.controls[column], 0,
  ) / rows.length);
  const sds = means.map((mean, column) => Math.sqrt(rows.reduce(
    (sum, row) => sum + ((row.controls[column] - mean) ** 2), 0,
  ) / rows.length));
  const design = rows.map(row => [1, ...row.controls.map(
    (value, column) => (value - means[column]) / sds[column],
  )]);
  const normal = Array.from({ length: 6 }, () => Array(6).fill(0));
  for (const row of design) {
    for (let left = 0; left < 6; left += 1) {
      for (let right = 0; right < 6; right += 1) {
        normal[left][right] += row[left] * row[right] / rows.length;
      }
    }
  }
  return { means, sds, normal };
}

test('identity, feature order, and constants are closed before any result', () => {
  assert.equal(model.MODEL_ID, 'FG-CONTROL-RESIDUAL-PLS1-PREQ-V1');
  assert.equal(model.PROTOCOL_FREEZE_MARKER,
    'FROZEN_BEFORE_PROSPECTIVE_OUTCOME_2026_08_28_V1');
  assert.deepEqual(model.COMPONENT_KEYS,
    ['momentum', 'strength', 'volatility', 'safeHaven', 'credit', 'breadth']);
  assert.equal(model.MIN_MATURED_ROWS, 252);
  assert.equal(model.CURRENT_Z_LIMIT, 5);
  assert.equal(model.MAX_CURRENT_CONTROL_MAHALANOBIS_RADIUS, 5);
  assert.equal(model.MAX_CURRENT_PLS_SCORE_Z, 5);
  assert.equal(model.EXACT_DYADIC_COMPARISON_POLICY, 'EXACT_DYADIC_FINAL_BINARY64_V1');
  assert.equal(model.NUMERIC_TOLERANCE, 1e-12);
  assert.equal(model.MAX_CONTROL_NORMAL_CONDITION_INFINITY, 67108864);
});

test('canonical JSON rejects prototype-control keys instead of hashing them as absent', () => {
  const clean = { safe: 1 };
  const cleanHash = model.hashCanonical(clean);
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const hostile = JSON.parse(`{"safe":1,"${key}":{"forged":true}}`);
    assert.deepEqual(Object.keys(hostile).sort(), [key, 'safe'].sort());
    assert.throws(() => model.canonicalStringify(hostile),
      new RegExp(`Canonical JSON rejects dangerous property name ${key}`));
    assert.throws(() => model.hashCanonical(hostile),
      new RegExp(`Canonical JSON rejects dangerous property name ${key}`));
    assert.equal(model.hashCanonical(clean), cleanHash);
  }
});

test('canonical JSON accepts only plain dense data-property JSON and never invokes getters', () => {
  const sparse = new Array(1);
  assert.throws(() => model.hashCanonical(sparse), /dense array/);
  assert.notEqual(model.hashCanonical([null]), undefined);

  const extraArrayProperty = [1];
  extraArrayProperty.ignoredByJsonStringify = 2;
  assert.throws(() => model.hashCanonical(extraArrayProperty), /no extra properties/);
  assert.throws(() => model.hashCanonical({ hidden: undefined }), /rejects undefined/);
  assert.throws(() => model.hashCanonical(new Date('2026-08-28T00:00:00.000Z')),
    /requires a plain object/);

  const symbolOnly = { safe: 1 };
  symbolOnly[Symbol('hidden')] = 2;
  assert.throws(() => model.hashCanonical(symbolOnly), /rejects symbol properties/);

  let getterReads = 0;
  const accessor = { safe: 1 };
  Object.defineProperty(accessor, 'changing', {
    enumerable: true,
    get() {
      getterReads += 1;
      return getterReads;
    },
  });
  assert.throws(() => model.hashCanonical(accessor), /requires enumerable data property changing/);
  assert.equal(getterReads, 0, 'canonicalization must inspect and reject an accessor without reading it');

  const nonEnumerable = { safe: 1 };
  Object.defineProperty(nonEnumerable, 'hidden', { value: 2, enumerable: false });
  assert.throws(() => model.hashCanonical(nonEnumerable),
    /requires enumerable data property hidden/);
});

test('canonical snapshots bypass ambient object and array prototype setters', () => {
  const modulePath = path.resolve(__dirname, '../research/fear_greed_control_residual_pls1.js');
  const script = String.raw`
    const model = require(${JSON.stringify(modulePath)});
    const objectLeft = { ambientCollisionKey: 'LEFT' };
    const objectRight = { ambientCollisionKey: 'RIGHT' };
    const arrayLeft = ['LEFT'];
    const arrayRight = ['RIGHT'];
    Object.defineProperty(Object.prototype, 'ambientCollisionKey', {
      configurable: true,
      set() {},
    });
    Object.defineProperty(Array.prototype, '0', {
      configurable: true,
      set() {},
    });
    try {
      if (model.hashCanonical(objectLeft) === model.hashCanonical(objectRight)) {
        throw new Error('object prototype setter caused a canonical collision');
      }
      if (model.hashCanonical(arrayLeft) === model.hashCanonical(arrayRight)) {
        throw new Error('array prototype setter caused a canonical collision');
      }
      const snapshot = model.canonicalize(objectLeft);
      if (Object.getPrototypeOf(snapshot) !== null
          || JSON.stringify(snapshot) !== '{"ambientCollisionKey":"LEFT"}') {
        throw new Error('null-prototype canonical snapshot is not exact JSON');
      }
    } finally {
      delete Object.prototype.ambientCollisionKey;
      delete Array.prototype[0];
    }
  `;
  assert.doesNotThrow(() => childProcess.execFileSync(process.execPath, ['-e', script], {
    stdio: 'pipe',
  }));
});

test('post-load intrinsic mutation cannot change evidence hashes or numeric and evaluator gates', () => {
  const modulePath = path.resolve(__dirname, '../research/fear_greed_control_residual_pls1.js');
  const commonPath = path.resolve(__dirname, '../scripts/pls1-lockbox-common.js');
  const evaluatorPath = path.resolve(__dirname, '../scripts/pls1-lockbox-evaluate.js');
  const script = String.raw`
    const crypto = require('node:crypto');
    const model = require(${JSON.stringify(modulePath)});
    const common = require(${JSON.stringify(commonPath)});
    const evaluator = require(${JSON.stringify(evaluatorPath)});
    const original = {
      stringify: JSON.stringify,
      createHash: crypto.createHash,
      readBigUInt64BE: Buffer.prototype.readBigUInt64BE,
      freeze: Object.freeze,
      isFrozen: Object.isFrozen,
      values: Object.values,
      sort: Array.prototype.sort,
      isFinite: Number.isFinite,
    };
    const expectedModelHash = model.hashCanonical({ z: 'LEFT', a: 1 });
    const expectedCommonHash = common.sha256(Buffer.from('captured-crypto'));
    const expectedDyadic = model.binary64Dyadic(1.5);
    try {
      JSON.stringify = () => '{"forged":true}';
      crypto.createHash = () => ({
        update() { return this; },
        digest() { return '0'.repeat(64); },
      });
      Buffer.prototype.readBigUInt64BE = () => 0n;
      Object.freeze = value => value;
      Object.values = () => [];
      Array.prototype.sort = function noSort() { return this; };
      Number.isFinite = () => true;

      const actualModelHash = model.hashCanonical({ a: 1, z: 'LEFT' });
      if (actualModelHash !== expectedModelHash
          || actualModelHash === model.hashCanonical({ a: 1, z: 'RIGHT' })) {
        throw new Error('captured canonical hash changed or collided');
      }
      if (common.sha256(Buffer.from('captured-crypto')) !== expectedCommonHash) {
        throw new Error('captured common SHA-256 changed');
      }
      const actualDyadic = model.binary64Dyadic(1.5);
      if (actualDyadic.numerator !== expectedDyadic.numerator
          || actualDyadic.exponent !== expectedDyadic.exponent) {
        throw new Error('captured binary64 decoding changed');
      }
      if (model.currentPlsScoreWithinRange(NaN, 1) !== false) {
        throw new Error('tampered Number.isFinite opened the PLS score gate');
      }

      const outcomes = Array(756).fill(0);
      outcomes[0] = NaN;
      const invalidMse = evaluator.forecastMse(
        outcomes, Array(756).fill(0), Array(756).fill(0),
      );
      if (invalidMse.ok !== false || invalidMse.passed !== false) {
        throw new Error('tampered Number.isFinite opened the evaluator MSE gate');
      }
      const holm = evaluator.holmStepDown({
        crypto: 0.06, sweden: 0.001, usa: 0.02,
        ustech: 0.03, europe: 0.04, global: 0.05,
      });
      if (holm.ranked[0].market !== 'sweden'
          || !original.isFrozen(holm) || !original.isFrozen(holm.ranked)) {
        throw new Error('captured sort/freeze/values did not preserve evaluator evidence');
      }
      const report = evaluator.evaluateProspectiveEndpoint({});
      if (report.failureReasons.length !== 2
          || !report.failureReasons.some(reason => reason.code === 'MANIFEST_MISSING')
          || !report.failureReasons.some(reason => reason.code === 'ACTIVATION_BUNDLE_MISSING')
          || report.trustVerdictAvailable !== false) {
        throw new Error('tampered stringify/sort collapsed evaluator failures');
      }
    } finally {
      JSON.stringify = original.stringify;
      crypto.createHash = original.createHash;
      Buffer.prototype.readBigUInt64BE = original.readBigUInt64BE;
      Object.freeze = original.freeze;
      Object.values = original.values;
      Array.prototype.sort = original.sort;
      Number.isFinite = original.isFinite;
    }
  `;
  assert.doesNotThrow(() => childProcess.execFileSync(process.execPath, ['-e', script], {
    stdio: 'pipe',
  }));
});

test('market class is an exact closed enum and is never silently coerced', () => {
  for (const marketClass of ['equity', 'crypto']) {
    const market = makeMarket(10, input => { input.marketClass = marketClass; });
    assert.equal(model.normalizeMarket(market).marketClass, marketClass);
  }
  for (const marketClass of [undefined, null, '', 'cryptoo', 'Equity', 0]) {
    const market = makeMarket(10, input => { input.marketClass = marketClass; });
    assert.throws(() => model.normalizeMarket(market),
      /Market class must be exactly crypto or equity/);
  }
});

test('row availability may be null but a decision stamp requires exact non-null UTC', () => {
  const retrospective = model.normalizeMarket(makeMarket(10));
  assert.equal(retrospective.rows.at(-1).availableAtUtc, null);

  const timestamp = '2026-08-28T09:15:00.000Z';
  const live = makeMarket(10, market => { market.rows.at(-1).availableAtUtc = timestamp; });
  assert.equal(model.normalizeMarket(live).rows.at(-1).availableAtUtc, timestamp);

  const impossible = makeMarket(10, market => {
    market.rows.at(-1).availableAtUtc = '2026-02-30T09:15:00.000Z';
  });
  assert.throws(() => model.normalizeMarket(impossible), /invalid availableAtUtc/);

  const decision = model.buildLatestDecision(makeMarket(378)).M1;
  assert.throws(() => model.stampDecisionAvailability({ ...decision }, timestamp),
    /A genuine PLS1 decision record is required/);
  assert.throws(() => model.stampDecisionAvailability({
    schema: 'fg-control-residual-pls1-decision-v1',
    action: 'BUY',
    targetPosition: 'CASH',
    filledPosition: 'VOID',
    tradeRequired: false,
  }, timestamp), /A genuine PLS1 decision record is required/);
  for (const invalid of [null, undefined, '', '2026-08-28',
    '2026-02-30T09:15:00.000Z']) {
    assert.throws(() => model.stampDecisionAvailability(decision, invalid),
      /Stamped signal availability must be exact UTC/);
  }
  const stamped = model.stampDecisionAvailability(decision, timestamp);
  assert.equal(stamped.signalAvailableAtUtc, timestamp);
  assert.notEqual(stamped.decisionSha256, decision.decisionSha256);
});

test('feature basis and relative-cash label mature exactly at t+2', () => {
  const market = model.normalizeMarket(makeMarket(200));
  const feature = model.buildFeatureObservation(market, 150);
  assert.equal(feature.valid, true);
  assert.equal(feature.maturityIndex, 152);
  assert.equal(model.computeForwardLabel(market, 150, 151), null);
  const expected = Math.log(market.rows[152].targetClose / market.rows[151].targetClose)
    - Math.log(market.rows[152].cashClose / market.rows[151].cashClose);
  assert.equal(model.computeForwardLabel(market, 150, 152), expected);
});

test('closed-form PLS residuals are orthogonal and equal a direct nested OLS fit', () => {
  const rows = makeTrainingRows(500);
  const currentControls = [0.4, -0.2, 0.7, 0.018, -0.1];
  const currentComponents = [58, 44, 62, 51, 49, 55];
  const fit = model.fitControlResidualPls1(rows, currentControls, currentComponents);
  assert.equal(fit.ok, true);
  assert.ok(fit.maximumNormalEquationResidual < 1e-10);
  assert.equal(fit.maximumCurrentPlsScoreZ, model.MAX_CURRENT_PLS_SCORE_Z);
  assert.ok(Math.abs(fit.currentScoreZ) <= model.MAX_CURRENT_PLS_SCORE_Z);
  assert.equal(fit.maximumCurrentControlMahalanobisRadius,
    model.MAX_CURRENT_CONTROL_MAHALANOBIS_RADIUS);
  assert.equal(fit.exactDyadicComparisonPolicy, model.EXACT_DYADIC_COMPARISON_POLICY);
  assert.equal(fit.exactControlNormalCertificate.inverseIdentityVerified, true);
  assert.equal(fit.exactControlNormalCertificate.conditionWithinRange, true);
  assert.equal(fit.exactCurrentControlMahalanobisCertificate.withinRange, true);
  assert.equal(fit.currentPlsScoreExactSquaredWithinRange, true);
  assert.ok(fit.currentControlMahalanobisRadius
    <= model.MAX_CURRENT_CONTROL_MAHALANOBIS_RADIUS);
  assert.ok(Math.abs(Math.sqrt(fit.weights.reduce((sum, value) => sum + value ** 2, 0)) - 1) < 1e-12);

  const design = [];
  const outcomes = [];
  for (const row of rows) {
    const zc = row.controls.map((value, column) => (
      (value - fit.controlMeans[column]) / fit.controlPopulationStandardDeviations[column]
    ));
    const d = [1, ...zc];
    const zx = row.components.map((value, column) => (
      fit.componentPopulationStandardDeviations[column] <= model.NUMERIC_TOLERANCE
        ? 0
        : (value - fit.componentMeans[column]) / fit.componentPopulationStandardDeviations[column]
    ));
    const residual = zx.map((value, component) => value - d.reduce(
      (sum, item, index) => sum + (item * fit.gamma[index][component]), 0,
    ));
    design.push([...d, residual.reduce(
      (sum, value, component) => sum + (value * fit.weights[component]), 0,
    )]);
    outcomes.push(row.outcome);
  }
  const direct = normalFit(design, outcomes);
  assert.ok(direct);
  const currentDirect = [1, ...fit.standardizedCurrentControls, fit.currentScore];
  const directPrediction = currentDirect.reduce(
    (sum, value, index) => sum + (value * direct[index]), 0,
  );
  assert.ok(Math.abs(directPrediction - fit.predictionM1) < 1e-11);
  for (let index = 0; index < fit.alpha.length; index += 1) {
    assert.ok(Math.abs(direct[index] - fit.alpha[index]) < 1e-11,
      'orthogonal factor must leave M0 control coefficients unchanged');
  }
});

test('zero residual component covariance is a valid exact M1 equals M0 result', () => {
  const rows = makeTrainingRows(350).map((row, index) => ({
    controls: row.controls,
    components: [50, 50, 50, 50, 50, 50],
    outcome: 0.01 + (0.004 * row.controls[0]) - (0.002 * row.controls[3])
      + (index * 0),
  }));
  const fit = model.fitControlResidualPls1(rows, rows[0].controls, rows[0].components);
  assert.equal(fit.ok, true);
  assert.equal(fit.zeroFactor, true);
  assert.equal(fit.q, 0);
  assert.deepEqual(fit.weights, [0, 0, 0, 0, 0, 0]);
  assert.equal(fit.predictionM1, fit.predictionM0);
});

test('nonzero cross-covariance with negligible residual score variance is an exact zero factor', () => {
  const epsilon = 1e-6;
  const rows = makeTinyResidualTrainingRows(epsilon);
  const current = rows.at(-1);
  const fit = model.fitControlResidualPls1(rows, current.controls, current.components);
  assert.equal(fit.ok, true);
  assert.ok(fit.crossCovarianceNorm > 0);
  assert.ok(fit.scoreVariance <= model.NUMERIC_TOLERANCE);
  assert.equal(fit.zeroFactor, true);
  assert.deepEqual(fit.weights, [0, 0, 0, 0, 0, 0]);
  assert.equal(fit.q, 0);
  assert.equal(fit.currentScore, 0);
  assert.equal(fit.predictionM1, fit.predictionM0);
});

test('current PLS score leverage has exact below, boundary, and above behavior', () => {
  const variance = 0.04;
  const boundary = model.MAX_CURRENT_PLS_SCORE_Z * Math.sqrt(variance);
  assert.equal(model.currentPlsScoreWithinRange(boundary - Number.EPSILON, variance), true);
  assert.equal(model.currentPlsScoreWithinRange(boundary, variance), true);
  assert.equal(model.currentPlsScoreWithinRange(boundary + Number.EPSILON, variance), false);
  assert.equal(model.currentPlsScoreWithinRange(0, 0), true);
  assert.equal(model.currentPlsScoreWithinRange(Number.NaN, variance), false);
  assert.equal(model.currentPlsScoreWithinRange(0, Number.NaN), false);
  assert.equal(model.currentPlsScoreWithinRange(
    7.672280051251155, 2.3545552473930567,
  ), false, 'exact dyadic squaring must reject the rounded-sqrt false accept');
});

test('near-zero-variance factor fails closed instead of emitting an extreme finite forecast', () => {
  const rows = makeTinyResidualTrainingRows(3e-6);
  const current = rows.at(-1);
  const fit = model.fitControlResidualPls1(
    rows, current.controls, [100, 0, 100, 0, 100, 0],
  );
  assert.deepEqual(fit, { ok: false, reason: 'CURRENT_PLS_SCORE_OUT_OF_RANGE' });
});

test('rank-deficient controls fail deterministically without ridge or feature deletion', () => {
  const rows = makeTrainingRows(300).map(row => ({
    ...row,
    controls: [row.controls[0], row.controls[0], ...row.controls.slice(2)],
  }));
  const current = rows[0];
  const fit = model.fitControlResidualPls1(rows, current.controls, current.components);
  assert.equal(fit.ok, false);
  assert.equal(fit.reason, 'CONTROL_VARIANCE_OR_RANK_INVALID');
});

test('ill-conditioned standardized controls fail before an unstable finite forecast is emitted', () => {
  const epsilon = 1e-5;
  const rows = Array.from({ length: 400 }, (unused, index) => {
    const first = Math.sin(index / 7) + (index * 0.0001);
    const noise = Math.cos(index * 1.61803398875);
    return {
      controls: [first, first + (epsilon * noise), Math.cos(index / 11),
        Math.sin(index / 13), 0.02 + (0.003 * Math.cos(index / 19))],
      components: [50 + (10 * Math.sin(index / 3)), 50 + (9 * Math.cos(index / 5)),
        50 + (8 * Math.sin(index / 7)), 50 + (7 * Math.cos(index / 9)),
        50 + (6 * Math.sin(index / 11)), 50 + (5 * Math.cos(index / 13))],
      outcome: (0.01 * noise) + (0.0001 * Math.sin(index / 2)),
    };
  });
  const current = rows.at(-1);
  const fit = model.fitControlResidualPls1(rows, current.controls, current.components);
  assert.deepEqual(fit, { ok: false, reason: 'CONTROL_MATRIX_ILL_CONDITIONED' });
});

test('the scale-free condition ceiling has exact below, boundary, and above behavior', () => {
  const maximum = model.MAX_CONTROL_NORMAL_CONDITION_INFINITY;
  assert.ok(model.matrixConditionInfinity([[1, 0], [0, 2 / maximum]]) < maximum);
  assert.equal(model.matrixConditionInfinity([[1, 0], [0, 1 / maximum]]), maximum);
  assert.ok(model.matrixConditionInfinity([[1, 0], [0, 0.5 / maximum]]) > maximum);
});

test('exact dyadic normal certificate accepts equality, rejects the next value, singularity, and is power-of-two scale invariant', () => {
  const maximum = model.MAX_CONTROL_NORMAL_CONDITION_INFINITY;
  const boundary = 1 / maximum;
  const nextSmaller = boundary - (Number.EPSILON * boundary);
  const diagonal = value => Array.from({ length: 6 }, (unused, row) => (
    Array.from({ length: 6 }, (unused2, column) => (
      row === column ? (row === 1 ? value : 1) : 0
    ))
  ));
  const equal = model.certifyExactControlNormal(diagonal(boundary));
  const above = model.certifyExactControlNormal(diagonal(nextSmaller));
  assert.equal(equal.ok, true);
  assert.equal(equal.conditionWithinRange, true);
  assert.equal(equal.provenance.conditionNumerator,
    equal.provenance.conditionMaximumScaledDeterminant);
  assert.equal(above.ok, true);
  assert.equal(above.conditionWithinRange, false);
  assert.equal(model.certifyExactControlNormal(diagonal(0)).ok, false);

  const scaled = model.certifyExactControlNormal(
    diagonal(boundary).map(row => row.map(value => value * 8)),
  );
  assert.equal(scaled.ok, true);
  assert.equal(scaled.conditionWithinRange, true);
  assert.equal(scaled.provenance.conditionNumerator,
    scaled.provenance.conditionMaximumScaledDeterminant);
});

test('exact dyadic condition certificate rejects the seed-631 rounded-inverse false accept', () => {
  const rows = seededNearCollinearRows(631, 0.00024209750206604126);
  const { normal } = standardizedControlNormal(rows);
  assert.equal(model.matrixConditionInfinity(normal), 67108863.9877084);
  const certificate = model.certifyExactControlNormal(normal);
  assert.equal(certificate.ok, true);
  assert.equal(certificate.conditionWithinRange, false);
  assert.equal(certificate.provenance.finalBinary64MatrixSha256,
    '3ad37981c63a14f87d9147e2d6e1030b3d09d3cbe955d48e19aad94cf79faf89');
  assert.equal(certificate.provenance.certificateSha256,
    '5b97572ea8b44c4e959fb47fff375a4612fa3e05145941e7cdaeacb4aeb11245');
  assert.deepEqual(model.fitControlResidualPls1(
    rows, rows[100].controls, [50, 50, 50, 50, 50, 50],
  ), { ok: false, reason: 'CONTROL_MATRIX_ILL_CONDITIONED' });
});

test('current control Mahalanobis radius has exact below, boundary, above, and nonfinite behavior', () => {
  assert.equal(model.calculateCurrentControlMahalanobisRadius(
    [[1, 0], [0, 1]], [3, 4],
  ), 5);
  const maximum = model.MAX_CURRENT_CONTROL_MAHALANOBIS_RADIUS;
  const step = 4 * Number.EPSILON;
  assert.equal(model.currentControlMahalanobisWithinRange(maximum - step), true);
  assert.equal(model.currentControlMahalanobisWithinRange(maximum), true);
  assert.equal(model.currentControlMahalanobisWithinRange(maximum + step), false);
  assert.equal(model.currentControlMahalanobisWithinRange(Number.NaN), false);
  assert.equal(model.currentControlMahalanobisWithinRange(Number.POSITIVE_INFINITY), false);
  assert.equal(model.calculateCurrentControlMahalanobisRadius(
    [[1, 0], [0, 1]], [Number.NaN, 0],
  ), null);
});

test('exact dyadic Mahalanobis certificate accepts equality, rejects the next value, and is power-of-two scale invariant', () => {
  const identity = Array.from({ length: 6 }, (unused, row) => (
    Array.from({ length: 6 }, (unused2, column) => (row === column ? 1 : 0))
  ));
  const equalDesign = [3, 4, 0, 0, 0, 0];
  const aboveDesign = [3, 4 + (4 * Number.EPSILON), 0, 0, 0, 0];
  const equal = model.certifyExactCurrentControlMahalanobis(identity, equalDesign);
  const above = model.certifyExactCurrentControlMahalanobis(identity, aboveDesign);
  assert.equal(equal.ok, true);
  assert.equal(equal.withinRange, true);
  assert.equal(equal.provenance.quadraticNumerator, '25');
  assert.equal(above.ok, true);
  assert.equal(above.withinRange, false);

  const scaledNormal = identity.map(row => row.map(value => value * 4));
  const scaledDesign = equalDesign.map(value => value * 2);
  const scaled = model.certifyExactCurrentControlMahalanobis(scaledNormal, scaledDesign);
  assert.equal(scaled.ok, true);
  assert.equal(scaled.withinRange, true);
});

test('exact dyadic Mahalanobis certificate rejects the seed-43 rounded-radius false accept', () => {
  const rows = seededNearCollinearRows(43, 0.00028103764290890795);
  const { means, sds, normal } = standardizedControlNormal(rows);
  const currentControls = [
    0.013281980599290973,
    0.01246196411625891,
    0.0018604688072902343,
    -0.01673688524816599,
    0.016154750128320995,
  ];
  const currentDesign = [1, ...currentControls.map((value, column) => Math.max(-5, Math.min(5,
    (value - means[column]) / sds[column],
  )))];
  assert.equal(model.matrixConditionInfinity(normal), 49999999.99048491);
  assert.equal(model.calculateCurrentControlMahalanobisRadius(normal, currentDesign),
    4.999999998999998);
  const normalCertificate = model.certifyExactControlNormal(normal);
  const radiusCertificate = model.certifyExactCurrentControlMahalanobis(normal, currentDesign);
  assert.equal(normalCertificate.conditionWithinRange, true);
  assert.equal(normalCertificate.provenance.finalBinary64MatrixSha256,
    '26a4e91691f2d5f97bcd57b3bf89916d4341924102b3fd7d9aab481aadf1d833');
  assert.equal(radiusCertificate.ok, true);
  assert.equal(radiusCertificate.withinRange, false);
  assert.equal(radiusCertificate.provenance.certificateSha256,
    '9666f55c8490863db59b401abac8e39f74fde6d9086c0b67299a36cd7db1c390');
  assert.deepEqual(model.fitControlResidualPls1(
    rows, currentControls, [50, 50, 50, 50, 50, 50],
  ), { ok: false, reason: 'CURRENT_CONTROL_MAHALANOBIS_OUT_OF_RANGE' });
});

test('near-collinear controls fail closed on an off-manifold current combination', () => {
  const epsilon = 0.0003;
  const rows = Array.from({ length: 400 }, (unused, index) => {
    const first = Math.sin(index / 7) + (index * 0.0001);
    const noise = Math.cos(index * 1.61803398875);
    return {
      controls: [first, first + (epsilon * noise), Math.cos(index / 11),
        Math.sin(index / 13), 0.02 + (0.003 * Math.cos(index / 19))],
      components: [50, 50, 50, 50, 50, 50],
      outcome: 0.01 * noise,
    };
  });
  const fit = model.fitControlResidualPls1(
    rows, [1e12, -1e12, 0, 0, 0.02], [50, 50, 50, 50, 50, 50],
  );
  assert.deepEqual(fit, { ok: false, reason: 'CURRENT_CONTROL_MAHALANOBIS_OUT_OF_RANGE' });
});

test('jointly extreme current controls are clamped and then fail closed', () => {
  const rows = makeTrainingRows(400);
  const extreme = model.fitControlResidualPls1(rows,
    [1e12, -1e12, 1e12, -1e12, 1e12], [100, 0, 100, 0, 100, 0]);
  assert.deepEqual(extreme,
    { ok: false, reason: 'CURRENT_CONTROL_MAHALANOBIS_OUT_OF_RANGE' });
});

test('minimum maturity, complete-origin nesting, and mandatory binary fallbacks are exact', () => {
  const before = model.buildLatestDecision(makeMarket(376));
  const firstFit = model.buildLatestDecision(makeMarket(377));
  assert.equal(before.M1.trainingRowCount, 250);
  assert.equal(before.M1.action, 'BUY');
  assert.equal(before.M1.fallbackReason, model.WARMUP_REASON);
  assert.equal(before.M1.learnedFromHistory, false);
  assert.equal(before.M1.decisionBasis, 'PRE_REGISTERED_WARMUP_POLICY');
  assert.equal(firstFit.M1.trainingRowCount, 251);
  assert.equal(firstFit.M1.action, 'BUY');
  const active = model.buildLatestDecision(makeMarket(378));
  assert.equal(active.M1.trainingRowCount, 252);
  assert.ok(active.M1.action === 'BUY' || active.M1.action === 'SELL');
  assert.equal(active.M0.trainingRowsSha256, active.M1.trainingRowsSha256);

  const invalid = model.buildLatestDecision(makeMarket(378, market => {
    market.rows.at(-1).components.credit = null;
    market.rows.at(-1).componentAsOf.credit = null;
  }));
  assert.equal(invalid.M0.action, 'SELL');
  assert.equal(invalid.M1.action, 'SELL');
  assert.equal(invalid.M0.fallbackReason, model.INVALID_REASON);
  assert.equal(invalid.M1.fallbackReason, model.INVALID_REASON);
  assert.equal(invalid.M1.learnedFromHistory, false);
  assert.equal(invalid.M1.decisionBasis, 'PRE_REGISTERED_FAIL_CLOSED_POLICY');
});

test('future, stale, or missing component provenance cannot enter a decision', () => {
  const future = makeMarket(378, market => {
    market.rows.at(-1).componentAsOf.credit = '2099-12-31';
  });
  assert.throws(() => model.buildLatestDecision(future), /future, or stale componentAsOf/);
  const missingCash = makeMarket(378, market => { market.rows.at(-1).cashClose = null; });
  const decision = model.buildLatestDecision(missingCash);
  assert.equal(decision.M0.action, 'SELL');
  assert.equal(decision.M1.action, 'SELL');
  assert.equal(decision.M1.fallbackReason, model.INVALID_REASON);
});

test('all matured rows are retained and the oldest training row never rolls away', () => {
  const decision = model.buildLatestDecision(makeMarket(1500));
  assert.equal(decision.M1.trainingRowCount, 1374);
  assert.equal(decision.M1.trainingStartDate, isoDay(124));
  assert.equal(decision.M1.trainingEndDate, isoDay(1497));
  assert.equal(decision.M1.latestMaturedOutcomeClose, isoDay(1499));
  assert.equal(decision.M1.allHistoryRows, 1500);
  assert.equal(decision.M1.learnerTruncatedSuppliedLedger, false);
  assert.equal(decision.M1.sourceHistoryCompleteness,
    'REQUIRES_EXTERNAL_LOCKBOX_VERIFICATION');
  assert.equal(decision.M1.learnedFromHistory, true);
  assert.equal(decision.M1.decisionBasis, 'LEARNED_FORECAST_WITH_STATEFUL_COST_HURDLE');
});

test('future mutation cannot alter a prior fit, prediction, action, or hash', () => {
  const original = makeMarket(520);
  const changed = JSON.parse(JSON.stringify(original));
  for (let index = 431; index < changed.rows.length; index += 1) {
    changed.rows[index].targetClose *= Math.exp(0.25);
    changed.rows[index].cashClose *= Math.exp(-0.03);
    for (const key of model.COMPONENT_KEYS) changed.rows[index].components[key] = index % 101;
  }
  const first = model.buildLatestDecision(original, { M0: 'CASH', M1: 'LONG' }, 430);
  const second = model.buildLatestDecision(changed, { M0: 'CASH', M1: 'LONG' }, 430);
  assert.deepEqual(second.M0, first.M0);
  assert.deepEqual(second.M1, first.M1);
  assert.equal(second.fit.fitSha256, first.fit.fitSha256);
});

test('schemaVersion and patched WeakSet prototypes cannot forge the private normalization brand', () => {
  const forged = makeMarket(300);
  forged.schemaVersion = model.SCHEMA_VERSION;
  forged.rows[150].date = forged.rows[149].date;
  const oldHas = WeakSet.prototype.has;
  const oldAdd = WeakSet.prototype.add;
  try {
    WeakSet.prototype.has = () => true;
    WeakSet.prototype.add = function noOp() { return this; };
    assert.throws(() => model.buildLatestDecision(forged), /strictly increasing|invalid date|Rows/);
  } finally {
    WeakSet.prototype.has = oldHas;
    WeakSet.prototype.add = oldAdd;
  }
});

test('binary hurdle uses strict ties and one fixed stress threshold', () => {
  const cost = model.COSTS.crypto.stress;
  const hurdle = model.logCostHurdle(cost);
  assert.equal(hurdle, 0.0075282664207915245);
  assert.equal(model.chooseBinaryTarget('CASH', hurdle, cost), 'CASH');
  assert.equal(model.chooseBinaryTarget('CASH', hurdle + Number.EPSILON, cost), 'LONG');
  assert.equal(model.chooseBinaryTarget('LONG', -hurdle, cost), 'LONG');
  assert.equal(model.chooseBinaryTarget('LONG', -hurdle - Number.EPSILON, cost), 'CASH');
});

test('decision and fit identities are deterministic while an input byte changes identity', () => {
  const first = model.buildLatestDecision(makeMarket(500));
  const second = model.buildLatestDecision(makeMarket(500));
  assert.equal(first.M1.decisionSha256, second.M1.decisionSha256);
  assert.equal(first.fit.fitSha256, second.fit.fitSha256);
  const changed = makeMarket(500, market => { market.rows[200].components.momentum += 0.0001; });
  const third = model.buildLatestDecision(changed);
  assert.notEqual(first.M1.trainingRowsSha256, third.M1.trainingRowsSha256);
  assert.notEqual(first.M1.decisionSha256, third.M1.decisionSha256);
});
