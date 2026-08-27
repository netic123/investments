'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const panel = require('../research/equity_rotation_panel');

function businessRows(start, end, makeValue, field = 'value') {
  const rows = [];
  let index = 0;
  for (let ms = Date.parse(`${start}T00:00:00.000Z`); ms <= Date.parse(`${end}T00:00:00.000Z`); ms += 86400000) {
    const day = new Date(ms).getUTCDay();
    if (day === 0 || day === 6) continue;
    rows.push({ date: new Date(ms).toISOString().slice(0, 10), [field]: makeValue(index++, ms) });
  }
  return rows;
}

function fixtureInput() {
  const retrievedAt = '2026-08-25T18:55:00.000Z';
  const growth = { sweden: 0.0005, usa: 0.0004, europe: 0.0003, global: 0.0002 };
  return {
    schema: panel.INPUT_SCHEMA,
    status: panel.INPUT_STATUS,
    asOfDate: '2026-08-24',
    cutoffExclusive: '2026-08-25',
    retrievedAt,
    protocolSha256: panel.PROTOCOL_SHA256,
    sourceBoundary: {},
    equities: panel.ASSETS.map(asset => ({
      key: asset.key,
      ticker: asset.ticker,
      name: asset.name,
      currency: 'USD',
      returnType: 'yahoo_adjusted_close_market_price_total_return_proxy',
      methodology: 'synthetic adjusted-close proxy fixture',
      sourceUrl: `https://example.invalid/${asset.ticker}`,
      rawPayloadSha256: 'a'.repeat(64),
      retrievedAt,
      officialIdentity: { url: asset.officialUrl },
      rows: businessRows('2008-03-28', '2026-08-24', index => 100 * Math.exp(growth[asset.key] * index)),
    })),
    dtb3: {
      id: 'DTB3',
      role: 'usd_3m_tbill_91_day_accrual_proxy_input',
      units: 'percent_bank_discount_basis',
      rawPayloadSha256: 'b'.repeat(64),
      retrievedAt,
      rows: businessRows('2008-01-01', '2026-08-24', () => 2, 'percent'),
    },
  };
}

test('protocol identity is frozen before panel outcomes', () => {
  assert.equal(panel.assertProtocolFrozen(), panel.PROTOCOL_SHA256);
});

test('91-day bank-discount conversion and accrual are explicit', () => {
  const expected = (1 / (1 - 0.02 * 91 / 360)) ** (1 / 91);
  assert.ok(Math.abs(panel.discountDailyFactor(2) - expected) < 1e-15);
  const common = [
    { date: '2020-01-02', assets: {} },
    { date: '2020-01-03', assets: {} },
    { date: '2020-01-06', assets: {} },
  ];
  const cash = panel.buildCashRows(common, [
    { date: '2020-01-02', percent: 2 },
    { date: '2020-01-03', percent: 2 },
    { date: '2020-01-06', percent: 2 },
  ]);
  assert.ok(Math.abs(cash[2].value - expected ** 4) < 1e-13);
});

test('monthly signal uses 12 calendar months and executes next common close', () => {
  const input = fixtureInput();
  const equity = panel.strictCommonEquityRows(input);
  const rows = panel.mergeCash(equity, panel.buildCashRows(equity, input.dtb3.rows));
  const signal = panel.buildMonthlySignals(rows)[0];
  assert.ok(signal.signalDate >= '2009-03-01');
  assert.ok(signal.executionDate > signal.signalDate);
  assert.equal(signal.ranking[0].key, 'sweden');
  assert.deepEqual(signal.top1Weights, { sweden: 1 });
  assert.deepEqual(signal.top2Weights, { sweden: 0.5, usa: 0.5 });
});

test('exact cost accounting charges both legs when rotating', () => {
  const first = panel.exactRebalance(1, { a: 0, b: 0 }, { a: 1 }, 0.002, ['a', 'b']);
  const second = panel.exactRebalance(first.postWealth, first.postRisk, { b: 1 }, 0.002, ['a', 'b']);
  assert.ok(second.tradedNotional > first.postWealth * 1.99);
  assert.ok(Math.abs(first.postWealth + first.costAmount - 1) < 1e-11);
  assert.ok(Math.abs(second.postWealth + second.costAmount - first.postWealth) < 1e-11);
});

test('full and chronological halves report all rules, costs, benchmarks and metrics', () => {
  const result = panel.analyzeInput(fixtureInput());
  assert.equal(result.status, panel.RESULT_STATUS);
  assert.deepEqual(Object.keys(result.results.at20bp), ['full', 'firstHalf', 'secondHalf']);
  assert.deepEqual(Object.keys(result.results.at40bp), ['full', 'firstHalf', 'secondHalf']);
  for (const costGroup of Object.values(result.results)) {
    for (const window of Object.values(costGroup)) {
      assert.ok(Number.isFinite(window.strategies.ROTATION_TOP1_CASH.cagr));
      assert.ok(Number.isFinite(window.strategies.ROTATION_TOP2_SLOTS_CASH.annualizedLogReturn));
      assert.ok(Number.isFinite(window.benchmarks.ACWI_BUY_AND_HOLD.annualizedVolatility));
      assert.ok(Number.isFinite(window.benchmarks.MONTHLY_EQUAL_WEIGHT_4.maximumDrawdown));
      assert.deepEqual(Object.keys(window.benchmarks.EACH_ASSET_BUY_AND_HOLD), panel.ASSET_KEYS);
      assert.ok(window.strategies.ROTATION_TOP1_CASH.totalOneWayTurnover > 0);
    }
  }
});

test('source failure reports DATA_REQUIRED instead of inventing rows', async () => {
  await assert.rejects(
    panel.fetchResearchInput({
      asOfDate: '2026-08-24',
      retrievedAt: '2026-08-25T18:55:00.000Z',
      fetchImpl: async () => ({ ok: false, status: 503 }),
    }),
    error => error && error.code === 'DATA_REQUIRED' && /HTTP 503/.test(error.message),
  );
});
