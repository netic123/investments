'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const runner = require('../research/fear_greed_expanding_binary.js');

function isoDay(index) {
  return new Date(Date.UTC(2018, 0, 1 + index)).toISOString().slice(0, 10);
}

function makeSyntheticMarket(length, overrides = {}) {
  const prices = [];
  const signals = [];
  for (let index = 0; index < length; index += 1) {
    const logLevel = Math.log(100) + (0.00035 * index)
      + (0.028 * Math.sin(index / 11)) + (0.011 * Math.cos(index / 3.7));
    const close = Math.exp(logLevel);
    const publishedScore = 50 + (22 * Math.sin(index / 13)) + (7 * Math.cos(index / 31));
    prices.push({ date: isoDay(index), close });
    signals.push({
      date: isoDay(index),
      availableAtUtc: null,
      publishedScore,
      components: {
        momentum: publishedScore + (2 * Math.sin(index / 5)),
        strength: publishedScore - 3 + Math.cos(index / 7),
        volatility: publishedScore + 5 - Math.sin(index / 9),
        safeHaven: publishedScore - 6 + Math.cos(index / 4),
        credit: publishedScore + 1.5 + Math.sin(index / 8),
        breadth: publishedScore - 1.5 - Math.cos(index / 6),
      },
    });
  }
  const market = {
    key: overrides.key || 'SYNTH',
    name: overrides.name || 'Synthetic market',
    targetId: overrides.targetId || 'SYNTH_TARGET',
    marketClass: overrides.marketClass || 'equity',
    annualization: overrides.annualization || 252,
    prices,
    signals,
  };
  if (typeof overrides.mutate === 'function') overrides.mutate(market);
  return market;
}

function copyMarket(market) {
  return JSON.parse(JSON.stringify(market));
}

function marketPrefix(market, lastIndex) {
  const copy = copyMarket(market);
  copy.prices = copy.prices.slice(0, lastIndex + 1);
  copy.signals = copy.signals.slice(0, lastIndex + 1);
  return copy;
}

function gaussianSolve(matrix, vector) {
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let pivot = 0; pivot < vector.length; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < vector.length; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    }
    [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    const divisor = augmented[pivot][pivot];
    for (let column = pivot; column <= vector.length; column += 1) {
      augmented[pivot][column] /= divisor;
    }
    for (let row = 0; row < vector.length; row += 1) {
      if (row === pivot) continue;
      const multiplier = augmented[row][pivot];
      for (let column = pivot; column <= vector.length; column += 1) {
        augmented[row][column] -= multiplier * augmented[pivot][column];
      }
    }
  }
  return augmented.map((row) => row[vector.length]);
}

function batchStandardizedRidge(rows, outcomes, current, lambda = 1) {
  const dimension = current.length;
  const means = Array(dimension).fill(0);
  for (const row of rows) {
    for (let feature = 0; feature < dimension; feature += 1) means[feature] += row[feature];
  }
  for (let feature = 0; feature < dimension; feature += 1) means[feature] /= rows.length;
  const meanY = outcomes.reduce((sum, value) => sum + value, 0) / outcomes.length;
  const sds = means.map((mean, feature) => Math.sqrt(rows.reduce(
    (sum, row) => sum + ((row[feature] - mean) ** 2), 0,
  ) / rows.length));
  const active = sds.map((sd, index) => (sd > 1e-14 ? index : null)).filter((x) => x !== null);
  const zRows = rows.map((row) => active.map((feature) => (
    (row[feature] - means[feature]) / sds[feature]
  )));
  const matrix = active.map((unused, row) => active.map((alsoUnused, column) => {
    let value = 0;
    for (const z of zRows) value += z[row] * z[column];
    return (value / rows.length) + (row === column ? lambda : 0);
  }));
  const rhs = active.map((unused, column) => {
    let value = 0;
    for (let row = 0; row < rows.length; row += 1) {
      value += zRows[row][column] * (outcomes[row] - meanY);
    }
    return value / rows.length;
  });
  const activeCoefficients = active.length > 0 ? gaussianSolve(matrix, rhs) : [];
  const coefficients = Array(dimension).fill(0);
  active.forEach((feature, index) => { coefficients[feature] = activeCoefficients[index]; });
  const zCurrent = current.map((value, feature) => (
    sds[feature] > 1e-14
      ? Math.max(-5, Math.min(5, (value - means[feature]) / sds[feature]))
      : 0
  ));
  return {
    means,
    sds,
    coefficients,
    zCurrent,
    prediction: meanY + coefficients.reduce(
      (sum, coefficient, feature) => sum + (coefficient * zCurrent[feature]), 0,
    ),
    maximumAbsoluteTrainingZ: Math.max(0, ...zRows.flat().map(Math.abs)),
  };
}

test('protocol, config, and runner identities are pinned and canonical', () => {
  const protocol = runner.assertProtocolIdentity();
  assert.equal(protocol.modelId, runner.MODEL_ID);
  assert.equal(protocol.freezeMarker, 'FROZEN_PRE_OUTCOME_2026_08_28_V1');
  assert.equal(protocol.protocolSha256, runner.PROTOCOL_SHA256);
  assert.match(runner.getRunnerIdentity().runnerSha256, /^[a-f0-9]{64}$/);
  assert.match(runner.getConfigIdentity().configSha256, /^[a-f0-9]{64}$/);
  assert.equal(
    runner.canonicalStringify({ z: 1, a: { d: 2, c: 3 } }),
    runner.canonicalStringify({ a: { c: 3, d: 2 }, z: 1 }),
  );
});

test('feature basis uses completed prices, raw square/interaction columns, and exact t+2 label', () => {
  const market = runner.normalizeMarket(makeSyntheticMarket(200));
  const observation = runner.buildFeatureObservation(market, 150);
  assert.equal(observation.m0Valid, true);
  assert.equal(observation.m1Valid, true);
  assert.equal(observation.featureIndex, 150);
  assert.equal(observation.maturityIndex, 152);
  const centered = market.signals[150].publishedScore - 50;
  assert.equal(observation.m1Features[5], centered);
  assert.equal(observation.m1Features[6], centered ** 2);
  assert.equal(observation.m1Features[7],
    market.signals[150].publishedScore - market.signals[149].publishedScore);
  assert.equal(observation.m1Features[8],
    market.signals[150].publishedScore - market.signals[145].publishedScore);
  assert.equal(observation.m1Features[9],
    market.signals[150].publishedScore - market.signals[129].publishedScore);
  assert.equal(observation.m1Features[11], centered * observation.m0Features[4]);
  assert.equal(
    runner.computeForwardLabel(market, 150, 151),
    null,
    'the label must not exist one close early',
  );
  assert.equal(
    runner.computeForwardLabel(market, 150, 152),
    Math.log(market.prices[152].close / market.prices[151].close),
  );
});

test('incremental sufficient statistics equal an independent full standardized ridge refit', () => {
  const rows = [];
  const outcomes = [];
  for (let index = 0; index < 600; index += 1) {
    const row = [
      index === 599 ? 100 : Math.sin(index / 17),
      Math.cos(index / 23) + (index * 0.0002),
      ((index % 19) - 9) / 7,
      4,
    ];
    rows.push(row);
    outcomes.push((0.002 * row[0]) - (0.004 * row[1]) + (0.0015 * row[2])
      + (0.0003 * Math.sin(index / 5)));
  }
  const current = [1e8, -1e8, 1e8, 99];
  const statistics = runner.createSufficientStatistics(4);
  rows.forEach((row, index) => runner.addObservation(statistics, row, outcomes[index]));
  const incremental = runner.fitStandardizedRidge(statistics, current);
  const batch = batchStandardizedRidge(rows, outcomes, current);
  assert.equal(incremental.ok, true);
  assert.ok(batch.maximumAbsoluteTrainingZ > 5,
    'this fixture proves training z values are not supposed to be clamped');
  assert.deepEqual(incremental.standardizedCurrent, batch.zCurrent);
  for (let feature = 0; feature < current.length; feature += 1) {
    assert.ok(Math.abs(incremental.means[feature] - batch.means[feature]) < 1e-11);
    assert.ok(Math.abs(incremental.populationStandardDeviations[feature] - batch.sds[feature]) < 1e-11);
    assert.ok(Math.abs(incremental.coefficients[feature] - batch.coefficients[feature]) < 1e-11);
  }
  assert.ok(Math.abs(incremental.prediction - batch.prediction) < 1e-11);
  assert.equal(incremental.coefficients[3], 0, 'zero-variance column must have coefficient zero');
  assert.equal(incremental.standardizedCurrent[3], 0, 'zero-variance current value must standardize to zero');
  assert.ok(incremental.standardizedCurrent.slice(0, 3).every((value) => Math.abs(value) === 5));
});

test('maturity order is exact, minimum fit is 252 shared M1-complete rows, and fallbacks are binary', () => {
  const market = makeSyntheticMarket(400, {
    mutate(value) {
      value.signals[399].components.credit = null;
    },
  });
  const ledgers = runner.buildDecisionLedgers(market);
  const at125 = ledgers.M1.decisions[125];
  const at126 = ledgers.M1.decisions[126];
  const at376 = ledgers.M1.decisions[376];
  const at377 = ledgers.M1.decisions[377];
  const at399 = ledgers.M1.decisions[399];
  assert.equal(at125.trainingRowCount, 0);
  assert.equal(at126.trainingRowCount, 1, 'feature 124 may enter only when its outcome ends at 126');
  assert.equal(at126.trainingStartDate, isoDay(124));
  assert.equal(at126.latestMaturedOutcomeClose, isoDay(126));
  assert.equal(at376.trainingRowCount, 251);
  assert.equal(at376.action, 'BUY');
  assert.equal(at376.fallbackReason, runner.WARMUP_REASON);
  assert.equal(at377.trainingRowCount, 252);
  assert.equal(at377.fallbackReason, null);
  assert.ok(Number.isFinite(at377.prediction));
  assert.equal(at399.trainingRowCount, 274);
  assert.equal(at399.currentFeaturesValid, false);
  assert.equal(at399.action, 'SELL', 'invalid scheduled input must fail closed, not carry stale state');
  assert.equal(at399.fallbackReason, runner.INVALID_REASON);
  assert.equal(at399.earliestExecutionClose.rule, 'NEXT_COMPLETED_TARGET_CLOSE_AFTER_DECISION');
  assert.equal(at399.earliestExecutionDate, null, 'a current decision must not embed a future outcome close');
  assert.match(at399.decisionSha256, /^[a-f0-9]{64}$/);
  assert.ok(ledgers.M1.decisions.every((row) => row.action === 'BUY' || row.action === 'SELL'));
  assert.ok(ledgers.M0.decisions.every((row) => row.action === 'BUY' || row.action === 'SELL'));
  assert.equal(ledgers.M1.sufficientStatistics.n, ledgers.M0.sufficientStatistics.n,
    'M0 and M1 must use the exact same M1-complete training rows');
});

test('invalid input fails closed before warm-up can emit its BUY baseline', () => {
  const market = makeSyntheticMarket(140, {
    mutate(value) {
      value.signals[139].components.credit = null;
    },
  });
  const decision = runner.buildDecisionLedgers(market).M1.decisions.at(-1);
  assert.ok(decision.trainingRowCount < runner.MIN_MATURED_ROWS);
  assert.equal(decision.currentFeaturesValid, false);
  assert.equal(decision.action, 'SELL');
  assert.equal(decision.fallbackReason, runner.INVALID_REASON);
});

test('live availability is exact, current-only, and never assigned a guessed next-close index', () => {
  const market = makeSyntheticMarket(430);
  market.signals.at(-1).availableAtUtc = `${isoDay(430)}T09:15:00.000Z`;
  const decision = runner.buildDecisionLedgers(market).M1.decisions.at(-1);
  assert.equal(decision.signalAvailableAtUtc, `${isoDay(430)}T09:15:00.000Z`);
  assert.equal(decision.executionPriceIndex, null);
  assert.equal(decision.executionSchedulingStatus,
    'UNRESOLVED_FIRST_FUTURE_TARGET_CLOSE_AFTER_FEATURE_AND_AVAILABILITY');
  assert.equal(decision.earliestExecutionClose.rule,
    'FIRST_TARGET_CLOSE_STRICTLY_AFTER_FEATURE_CLOSE_AND_AVAILABLE_AT_UTC');

  const impossibleDate = makeSyntheticMarket(140);
  impossibleDate.prices[50].date = '2018-02-30';
  impossibleDate.signals[50].date = '2018-02-30';
  assert.throws(() => runner.normalizeMarket(impossibleDate), /invalid date/);

  const impossibleTimestamp = makeSyntheticMarket(140);
  impossibleTimestamp.signals.at(-1).availableAtUtc = '2099-02-30T00:00:00.000Z';
  assert.throws(() => runner.normalizeMarket(impossibleTimestamp), /invalid availableAtUtc/);

  const historicalAvailability = makeSyntheticMarket(140);
  historicalAvailability.signals[100].availableAtUtc = '2099-01-01T00:00:00.000Z';
  assert.throws(() => runner.normalizeMarket(historicalAvailability), /Only the current final signal/);
});

test('a missing score row never skips a completed target close and emits fail-closed SELL', () => {
  const market = makeSyntheticMarket(430);
  market.signals.splice(399, 1);
  const ledgers = runner.buildDecisionLedgers(market);
  const decision = ledgers.M1.decisions.find(row => row.decisionPriceIndex === 399);
  assert.ok(decision, 'the target close must remain in the decision ledger');
  assert.equal(decision.decisionDate, isoDay(399));
  assert.equal(decision.currentFeaturesValid, false);
  assert.equal(decision.action, 'SELL');
  assert.equal(decision.fallbackReason, runner.INVALID_REASON);
  assert.equal(ledgers.M1.decisions.length, market.prices.length,
    'every completed target close from the first score onward must emit a state');
});

test('log-cost hurdle has strict ties and remains a mandatory binary state', () => {
  const cost = runner.COSTS.crypto.stress;
  const hurdle = -Math.log(1 - cost);
  assert.equal(runner.logCostHurdle(cost), hurdle);
  assert.equal(runner.chooseBinaryTarget('CASH', hurdle, cost), 'CASH');
  assert.equal(runner.chooseBinaryTarget('CASH', hurdle + 1e-12, cost), 'LONG');
  assert.equal(runner.chooseBinaryTarget('LONG', -hurdle, cost), 'LONG');
  assert.equal(runner.chooseBinaryTarget('LONG', -hurdle - 1e-12, cost), 'CASH');
});

test('a[t] fills at t+1, controls t+1 to t+2, repeat states are free, and there is no liquidation', () => {
  const raw = makeSyntheticMarket(5, {
    mutate(market) {
      [100, 110, 121, 60.5, 60.5].forEach((close, index) => { market.prices[index].close = close; });
    },
  });
  const market = runner.normalizeMarket(raw);
  const positions = ['LONG', 'CASH', 'CASH', 'LONG', 'LONG'];
  const decisions = positions.map((targetPosition, index) => ({
    decisionPriceIndex: index,
    executionPriceIndex: index + 1,
    action: targetPosition === 'LONG' ? 'BUY' : 'SELL',
    targetPosition,
  }));
  const replay = runner.replayDecisionLedger(market, decisions, 0.01);
  assert.ok(Math.abs(replay.path[2].wealth - (1.21 * 0.99)) < 1e-12,
    'SELL queued at index 1 must fill only after earning the index 1 to 2 return');
  assert.ok(Math.abs(replay.path[3].wealth - replay.path[2].wealth) < 1e-12,
    'the filled CASH state must control the index 2 to 3 interval');
  assert.equal(replay.path[3].costCharged, 0, 'repeated SELL/CASH target must not trade');
  assert.equal(replay.fills, 2);
  assert.equal(replay.costRateSum, 0.02);
  assert.ok(Math.abs(replay.terminalWealth - (1.21 * 0.99 * 0.99)) < 1e-12);
  assert.equal(replay.terminalLiquidation, false);
});

test('base and stress replay exactly one target ledger while charging their exact own costs', () => {
  const market = runner.normalizeMarket(makeSyntheticMarket(6));
  const targets = ['LONG', 'CASH', 'CASH', 'LONG', 'CASH', 'CASH'];
  const decisions = targets.map((targetPosition, index) => ({
    decisionPriceIndex: index,
    executionPriceIndex: index + 1,
    action: targetPosition === 'LONG' ? 'BUY' : 'SELL',
    targetPosition,
  }));
  const primary = runner.replayDecisionLedger(market, decisions, runner.COSTS.equity.primary);
  const stress = runner.replayDecisionLedger(market, decisions, runner.COSTS.equity.stress);
  assert.equal(primary.ledgerHash, stress.ledgerHash);
  assert.equal(primary.fills, stress.fills);
  assert.equal(primary.costRateSum, primary.fills * runner.COSTS.equity.primary);
  assert.equal(stress.costRateSum, stress.fills * runner.COSTS.equity.stress);
  assert.ok(stress.terminalWealth < primary.terminalWealth);
});

test('future mutations cannot alter any earlier decision and historical-prefix streaming is equivalent', () => {
  const original = makeSyntheticMarket(520);
  const mutated = copyMarket(original);
  for (let index = 431; index < mutated.prices.length; index += 1) {
    mutated.prices[index].close *= Math.exp(0.2 + (0.03 * Math.sin(index)));
    mutated.signals[index].publishedScore = 5 + (index % 90);
    for (const key of runner.COMPONENT_KEYS) {
      mutated.signals[index].components[key] = 10 + ((index * (key.length + 1)) % 80);
    }
  }
  const originalLedger = runner.buildDecisionLedgers(original);
  const mutatedLedger = runner.buildDecisionLedgers(mutated);
  assert.deepEqual(
    originalLedger.M1.decisions.slice(0, 431),
    mutatedLedger.M1.decisions.slice(0, 431),
    'data strictly after decision 430 must not alter that prefix',
  );

  for (const lastIndex of [130, 377, 430]) {
    const streamed = runner.buildDecisionLedgers(marketPrefix(original, lastIndex));
    assert.deepEqual(
      streamed.M1.decisions,
      originalLedger.M1.decisions.slice(0, lastIndex + 1),
      `prefix replay through ${lastIndex} must equal the same streaming prefix`,
    );
    assert.deepEqual(
      streamed.M0.decisions,
      originalLedger.M0.decisions.slice(0, lastIndex + 1),
      `M0 prefix replay through ${lastIndex} must also be invariant`,
    );
  }
});

test('the expanding fit retains its oldest eligible row more than three years later', () => {
  const market = makeSyntheticMarket(1500);
  const ledgers = runner.buildDecisionLedgers(market);
  const lastDecision = ledgers.M1.decisions.at(-1);
  assert.equal(ledgers.sharedTraining.startFeatureDate, isoDay(124));
  assert.equal(ledgers.sharedTraining.endFeatureDate, isoDay(1497));
  assert.equal(ledgers.sharedTraining.latestOutcomeDate, isoDay(1499));
  assert.equal(ledgers.sharedTraining.rowCount, 1374);
  assert.equal(lastDecision.trainingStartDate, isoDay(124));
  assert.ok((new Date(lastDecision.decisionDate) - new Date(lastDecision.trainingStartDate))
    > (3 * 365 * 24 * 60 * 60 * 1000));
});

test('double replay and canonical hashes are deterministic, while input drift changes identity', () => {
  const market = makeSyntheticMarket(430);
  const first = runner.analyzeMarket(market);
  const second = runner.analyzeMarket(copyMarket(market));
  assert.equal(first.analysisSha256, second.analysisSha256);
  assert.equal(runner.canonicalStringify(first), runner.canonicalStringify(second));
  assert.equal(first.models.M1.primary.ledgerHash, first.models.M1.stress.ledgerHash);
  assert.equal(first.models.M0.primary.ledgerHash, first.models.M0.stress.ledgerHash);
  assert.equal(first.currentSignal.action, first.models.M1.decisions.at(-1).action);
  assert.equal(first.currentSignal.decisionSha256,
    first.models.M1.decisions.at(-1).decisionSha256);
  assert.ok(['RETROSPECTIVE_PREQUENTIAL_FALSIFIED',
    'RETROSPECTIVE_PREQUENTIAL_DEVELOPMENT_ONLY'].includes(first.status));

  const drifted = copyMarket(market);
  drifted.signals[200].publishedScore += 0.1;
  const changed = runner.analyzeMarket(drifted);
  assert.notEqual(first.identities.inputSha256, changed.identities.inputSha256);
  assert.notEqual(first.analysisSha256, changed.analysisSha256);
});
