'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const core = require('../research/fear_greed_expanding_binary.js');
const analyzer = require('../research/fear_greed_expanding_binary_result_analyzer.js');

function isoDay(index, spacingDays = 2) {
  const date = new Date('2015-01-01T00:00:00.000Z');
  date.setUTCDate(date.getUTCDate() + (index * spacingDays));
  return date.toISOString().slice(0, 10);
}

function makeMarket(length, overrides = {}) {
  const spacingDays = overrides.spacingDays || 2;
  const prices = [];
  const signals = [];
  for (let index = 0; index < length; index += 1) {
    const logLevel = Math.log(100) + (0.00025 * index)
      + (0.035 * Math.sin(index / 17)) + (0.008 * Math.cos(index / 4.3));
    const close = Math.exp(logLevel);
    const score = 50 + (24 * Math.sin(index / 19)) + (5 * Math.cos(index / 37));
    const date = isoDay(index, spacingDays);
    prices.push({ date, close });
    signals.push({
      date,
      availableAtUtc: null,
      publishedScore: score,
      components: Object.fromEntries(core.COMPONENT_KEYS.map((key, componentIndex) => [
        key,
        { score: score + ((componentIndex - 2.5) * 1.3) + Math.sin(index / (5 + componentIndex)) },
      ])),
    });
  }
  return {
    key: overrides.key || 'SYNTH',
    name: overrides.name || overrides.key || 'Synthetic market',
    targetId: overrides.targetId || 'SYNTH-TARGET',
    targetAdjusted: overrides.requiresAdjusted ? true : null,
    marketClass: overrides.marketClass || 'equity',
    annualization: overrides.annualization || 252,
    prices,
    signals,
  };
}

function scoreability() {
  return {
    riskyInstrument: { executable: true, returnType: 'total_return', currency: 'USD' },
    cashInstrument: { executable: true, returnType: 'total_return', currency: 'USD' },
    benchmarkUsesSameRiskyInstrument: true,
    cashReturnsIncludedInLabelsAndLedgers: true,
    targetIdentityFrozen: true,
  };
}

function makePath(wealths, positions = null) {
  return wealths.map((wealth, index) => ({
    priceIndex: index,
    date: isoDay(index),
    wealth,
    ...(positions ? { filledPosition: positions[Math.min(index, positions.length - 1)] } : {}),
  }));
}

function exactFiveMarkets(length = 430) {
  return analyzer.FROZEN_MARKET_SPECS.map((spec) => ({ market: makeMarket(length, spec) }));
}

test('full and continuous-half wealth ratios are derived from exact path endpoints', () => {
  const strategy = makePath([1, 3, 9, 27, 81]);
  const benchmark = makePath([1, 2, 4, 8, 16]);
  const metrics = analyzer.relativeWealthMetrics(strategy, benchmark, 'exact fixture');
  assert.equal(metrics.full, 81 / 16);
  assert.equal(metrics.firstHalf, 9 / 4);
  assert.equal(metrics.secondHalf, (81 / 9) / (16 / 4));
  assert.equal(metrics.halfBoundaryPriceIndex, 2);
});

test('prequential summaries reject negative, inconsistent, and zero-count-impossible MSE data', () => {
  const valid = { count: 2, sumSquaredError: 0.02, meanSquaredError: 0.01 };
  assert.equal(analyzer.validatePrequentialSummary(valid, 'valid').meanSquaredError, 0.01);
  assert.throws(() => analyzer.computeMseMetrics(
    { count: 756, sumSquaredError: 756, meanSquaredError: -1 },
    { count: 756, sumSquaredError: 756, meanSquaredError: 1 },
  ), /meanSquaredError/);
  assert.throws(() => analyzer.validatePrequentialSummary(
    { count: 2, sumSquaredError: 0.02, meanSquaredError: 0.02 }, 'inconsistent',
  ), /SSE\/count/);
  assert.throws(() => analyzer.validatePrequentialSummary(
    { count: 0, sumSquaredError: 1, meanSquaredError: null }, 'zero',
  ), /zero-count/);
});

test('state shares use all emitted rows but an unexecuted final BUY cannot complete a cash episode', () => {
  const decisions = [
    { action: 'SELL', targetPosition: 'CASH', filledPosition: 'LONG', executionPriceIndex: 1 },
    { action: 'SELL', targetPosition: 'CASH', filledPosition: 'CASH', executionPriceIndex: 2 },
    { action: 'BUY', targetPosition: 'LONG', filledPosition: 'CASH', executionPriceIndex: 3 },
  ];
  const queued = analyzer.scoredDecisionDiagnostics(decisions, 2);
  assert.equal(queued.emittedDecisionCount, 3);
  assert.deepEqual(queued.stateCounts, { long: 1, cash: 2 });
  assert.equal(queued.completedCashEpisodes, 0);
  assert.equal(queued.completedCashEpisodeScope,
    'EXECUTED_TRANSITIONS_THROUGH_EVALUATION_END');
  const executed = analyzer.scoredDecisionDiagnostics(decisions, 3);
  assert.equal(executed.completedCashEpisodes, 1);
});

test('derived non-finite path arithmetic is rejected before metrics or hashes are emitted', () => {
  assert.throws(() => analyzer.summarizePath(
    makePath([Number.MIN_VALUE, Number.MAX_VALUE]), 252, 'overflow fixture',
  ), /invalid derived return|terminal factor/);
});

test('exact volatility grid chooses the truly closest point even below the old tolerance', () => {
  const tiny = 1e-14;
  const benchmark = makePath([1, 1 + tiny, 1, 1 + tiny]);
  const strategy = benchmark.map(row => ({ ...row, filledPosition: 'LONG' }));
  const summary = analyzer.summarizePath(strategy, 252, 'tiny strategy');
  const controls = analyzer.buildMatchedControls({
    market: { annualization: 252 },
    models: { M1: { primary: { path: strategy } } },
    buyAndHold: { path: benchmark },
  }, summary, summary);
  assert.equal(controls.volatilityMatched.weight, 1);
  assert.equal(controls.volatilityMatched.volatilityDistance, 0);
});

test('caller-supplied analyses and ledgers are rejected rather than self-authenticated', () => {
  assert.throws(() => analyzer.analyzeFrozenMarketResult({
    models: { M1: {}, M0: {} },
    buyAndHold: { path: [] },
    analysisSha256: 'a'.repeat(64),
  }), /Caller-supplied analysis\/ledgers are not accepted/);
  assert.throws(() => analyzer.analyzeFrozenMarketResult({
    ledgers: { market: makeMarket(430) },
  }), /Caller-supplied analysis\/ledgers are not accepted/);
});

test('market-only input is normalized and fully recomputed with fixed nonvalidated evidence', () => {
  const result = analyzer.analyzeFrozenMarketResult({
    market: { ...makeMarket(430), schemaVersion: 999 },
    status: 'VALIDATED',
    scoreability: scoreability(),
  });
  assert.equal(result.sourceKind, 'RECOMPUTED_FROM_NORMALIZED_MARKET_ZERO_CASH_CORE');
  assert.equal(result.evidenceStatus, core.EVIDENCE_STATUS);
  assert.equal(result.status, analyzer.STATUS.UNSCORABLE);
  assert.equal(result.gates.dataIntegrity.status, analyzer.GATE_STATUS.PASS);
  assert.equal(result.gates.scoreability.status, analyzer.GATE_STATUS.UNSCORABLE);
  assert.ok(result.gates.scoreability.reasons.includes('ZERO_RETURN_CASH_LEDGER'));
  assert.equal(result.investmentClaimAllowed, false);
  assert.match(result.identities.sourceAnalysisSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.identities.analyzer.protocol.protocolSha256, core.PROTOCOL_SHA256);
  assert.equal(result.identities.analyzer.coreRunner.runnerSha256,
    core.getRunnerIdentity().runnerSha256);
});

test('adequacy counts only genuine matured post-warm-up predictions and proves their calendar span', () => {
  const result = analyzer.analyzeFrozenMarketResult({ market: makeMarket(1200) });
  assert.equal(result.gates.adequacy.status, analyzer.GATE_STATUS.PASS);
  assert.ok(result.gates.adequacy.provableCount >= analyzer.CONFIG.minimumPostWarmupForecasts);
  assert.ok(result.gates.adequacy.calendarSpanDays >= analyzer.CONFIG.minimumForecastCalendarDays);
  assert.equal(result.metrics.prequentialMse.m1Count,
    result.gates.adequacy.provableCount);
});

test('placebo gate remains mandatory-incomplete and caller summaries cannot clear it', () => {
  const missing = analyzer.evaluatePlaceboEvidence(null, 'SYNTH');
  const supplied = analyzer.evaluatePlaceboEvidence({ repetitions: 999 }, 'SYNTH');
  assert.equal(missing.status, analyzer.GATE_STATUS.MANDATORY_INCOMPLETE);
  assert.equal(missing.required.repetitions, 999);
  assert.equal(supplied.status, analyzer.GATE_STATUS.MANDATORY_INCOMPLETE);
  assert.equal(supplied.callerSuppliedEvidenceRejected, true);
});

test('universal analysis is bound to the exact ordered five-market family and deeply immutable', () => {
  const inputs = exactFiveMarkets();
  const validGlobal = inputs[4].market;
  const forgedGlobal = { ...validGlobal, targetId: 'FORGED-GLOBAL' };
  let globalGetterReads = 0;
  inputs[4] = Object.defineProperty({}, 'market', {
    enumerable: true,
    get() {
      globalGetterReads += 1;
      return globalGetterReads === 1 ? validGlobal : forgedGlobal;
    },
  });
  const result = analyzer.analyzeFrozenResults(inputs);
  assert.equal(globalGetterReads, 1,
    'caller market data must be captured once before validation and use');
  assert.equal(result.status, analyzer.STATUS.UNSCORABLE);
  assert.equal(result.universalPass, false);
  assert.deepEqual(result.markets.map(row => row.market.key),
    ['crypto', 'sweden', 'usa', 'europe', 'global']);
  assert.equal(result.markets[4].market.targetId, 'ACWI');
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.markets), true);
  assert.equal(Object.isFrozen(result.markets[0].gates), true);
  assert.throws(() => result.markets.pop(), TypeError);

  assert.throws(() => analyzer.analyzeFrozenResults(inputs.slice(0, 4)),
    /exactly five frozen markets/);
  const reordered = [...inputs];
  [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
  assert.throws(() => analyzer.analyzeFrozenResults(reordered), /key\/order drifted/);
  const wrongTarget = exactFiveMarkets();
  wrongTarget[2].market.targetId = 'QQQ';
  assert.throws(() => analyzer.analyzeFrozenResults(wrongTarget), /target identity drifted/);
  const unadjusted = exactFiveMarkets();
  unadjusted[4].market.targetAdjusted = false;
  assert.throws(() => analyzer.analyzeFrozenResults(unadjusted), /adjusted target evidence/);
});

test('zero-cash identity remains UNSCORABLE even when every supplied suitability attestation is favorable', () => {
  const result = analyzer.analyzeFrozenMarketResult({
    market: makeMarket(430),
    scoreability: scoreability(),
  }, {
    scoreability: scoreability(),
    placeboEvidence: { repetitions: 999, claimedPass: true },
  });
  assert.equal(result.status, analyzer.STATUS.UNSCORABLE);
  assert.equal(result.gates.placebo.status, analyzer.GATE_STATUS.MANDATORY_INCOMPLETE);
  assert.equal(result.investmentClaimAllowed, false);
  assert.match(result.wording, /^UNSCORABLE/);
});
