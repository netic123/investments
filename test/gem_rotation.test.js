'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const gem = require('../research/gem_rotation');

function rows(growth) {
  const output = [];
  let value = 100;
  for (let year = 2020; year <= 2023; year++) {
    for (let month = 1; month <= 12; month++) {
      output.push({ date: `${year}-${String(month).padStart(2, '0')}-28`, value });
      value *= growth;
    }
  }
  return output;
}

function series(id, role, growth, extra = {}) {
  return {
    id, role, currency: 'USD', returnType: 'total_return',
    methodology: 'synthetic test total-return wealth index', source: 'synthetic fixture',
    timezone: 'UTC', retrievedAt: '2026-08-25T18:50:00.000Z', rows: rows(growth), ...extra,
  };
}

function input() {
  const growth = { crypto: 1.02, sweden: 1.015, usa: 1.01, europe: 1.005, global: 1.003 };
  return {
    schema: gem.INPUT_SCHEMA,
    status: gem.INPUT_STATUS,
    cashTotalReturn: series('USD-3M-TBILL-TRI', 'usd_3m_tbill_cash_total_return', 1.001),
    acwiBenchmarkTotalReturn: series('ACWI-USD-TRI', 'acwi_benchmark_total_return', 1.008),
    markets: gem.MARKET_KEYS.map(key => ({ key, name: key, riskTotalReturn: series(`${key}-USD-TRI`, 'risky_market_total_return', growth[key]) })),
  };
}

test('protocol is frozen before conforming outcomes', () => {
  assert.equal(gem.assertProtocolFrozen(), gem.PROTOCOL_SHA256);
});

test('contract rejects local currency and fake cash proxies', () => {
  const local = input();
  local.markets[1].riskTotalReturn.currency = 'SEK';
  assert.throws(() => gem.validateInput(local), /currency must be USD/);
  const fake = input();
  fake.cashTotalReturn.id = '^IRX';
  assert.throws(() => gem.validateInput(fake), /cannot substitute/);
});

test('primary ranks top one and robustness assigns two fixed 50 percent slots', () => {
  const valid = input();
  gem.validateInput(valid);
  const common = gem.strictCommonRows(valid);
  const signals = gem.buildMonthlySignals(common);
  assert.ok(signals.length > 20);
  assert.equal(signals[0].signalDate, '2021-01-28');
  assert.equal(signals[0].executionDate, '2021-02-28');
  assert.deepEqual(signals[0].top1Weights, { crypto: 1 });
  assert.deepEqual(signals[0].top2Weights, { crypto: 0.5, sweden: 0.5 });
});

test('cash gate leaves failed top-two slots in cash', () => {
  const valid = input();
  valid.cashTotalReturn = series('USD-3M-TBILL-TRI', 'usd_3m_tbill_cash_total_return', 1.018);
  const signal = gem.buildMonthlySignals(gem.strictCommonRows(valid))[0];
  assert.deepEqual(signal.top1Weights, { crypto: 1 });
  assert.deepEqual(signal.top2Weights, { crypto: 0.5 });
});

test('exact rebalance charges both legs of a rotation and preserves identity', () => {
  const first = gem.exactRebalance(1, { a: 0, b: 0 }, { a: 1 }, 0.002, ['a', 'b']);
  const second = gem.exactRebalance(first.postWealth, first.postRisk, { b: 1 }, 0.002, ['a', 'b']);
  assert.ok(second.tradedNotional > first.postWealth * 1.99);
  assert.ok(Math.abs(first.postWealth + first.costAmount - 1) < 1e-11);
  assert.ok(Math.abs(second.postWealth + second.costAmount - first.postWealth) < 1e-11);
});

test('conforming fixture reports both rules and every frozen benchmark at both costs', () => {
  const result = gem.analyzeInput(input());
  for (const costResult of [result.primary, result.doubleCostStress]) {
    assert.ok(Number.isFinite(costResult.strategies.GEM_TOP1_CASH.terminalWealth));
    assert.ok(Number.isFinite(costResult.strategies.GEM_TOP2_SLOTS_CASH.annualizedVolatility));
    assert.ok(Number.isFinite(costResult.benchmarks.ACWIBuyAndHold.maximumDrawdown));
    assert.ok(Number.isFinite(costResult.benchmarks.monthlyEqualWeightFive.totalOneWayRiskyTurnover));
    assert.equal(Object.keys(costResult.benchmarks.eachAssetBuyAndHold).length, 5);
  }
  assert.equal(result.primaryRuleFixed, 'GEM_TOP1_CASH');
});

test('legacy snapshot audit stops at DATA_REQUIRED', () => {
  const audit = gem.auditExistingSnapshot({ markets: gem.MARKET_KEYS.map(key => ({ key, prices: { currency: key === 'sweden' ? 'SEK' : 'USD' } })) });
  assert.equal(audit.status, 'DATA_REQUIRED');
  assert.equal(audit.compatible, false);
  assert.ok(audit.missing.some(row => /T-bill/.test(row)));
});
