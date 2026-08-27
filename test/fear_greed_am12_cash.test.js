'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const am12 = require('../research/fear_greed_am12_cash');

function series(id, role, values, extra = {}) {
  return {
    id, role, currency: 'USD', returnType: 'total_return',
    methodology: 'test total-return wealth index with reinvestment',
    source: 'synthetic-test-fixture', timezone: 'UTC',
    retrievedAt: '2026-08-25T18:40:00.000Z',
    rows: values.map(([date, value]) => ({ date, value })),
    ...extra,
  };
}

function monthlyRows(multiplier = 1.02) {
  const rows = [];
  let value = 100;
  for (let year = 2020; year <= 2023; year++) {
    for (let month = 1; month <= 12; month++) {
      rows.push([`${year}-${String(month).padStart(2, '0')}-28`, value]);
      value *= multiplier;
    }
  }
  return rows;
}

function validInput() {
  const cash = series('USD-3M-TBILL-TRI', 'usd_3m_tbill_cash_total_return', monthlyRows(1.001));
  return {
    schema: am12.INPUT_SCHEMA,
    status: am12.INPUT_STATUS,
    cashTotalReturn: cash,
    markets: am12.MARKET_KEYS.map(key => ({ key, name: key, riskTotalReturn: series(`${key}-USD-TRI`, 'risky_market_total_return', monthlyRows(1.02)) })),
  };
}

test('protocol identity is frozen', () => {
  assert.equal(am12.assertProtocolFrozen(), am12.PROTOCOL_SHA256);
});

test('12-calendar-month anniversary clamps leap day', () => {
  assert.equal(am12.anniversary12('2024-02-29'), '2023-02-28');
  assert.equal(am12.anniversary12('2024-08-31'), '2023-08-31');
});

test('input rejects a quoted yield or bond ETF as cash total return', () => {
  const input = validInput();
  input.cashTotalReturn.id = '^IRX';
  assert.throws(() => am12.validateInput(input), /cannot use a quoted yield or bond ETF/);
  input.cashTotalReturn.id = 'IEF';
  assert.throws(() => am12.validateInput(input), /cannot use a quoted yield or bond ETF/);
});

test('monthly signal uses 12-month excess and executes at the next close', () => {
  const input = validInput();
  am12.validateInput(input);
  const risk = input.markets[0].riskTotalReturn.rows;
  const signals = am12.buildMonthlySignals(risk, input.cashTotalReturn.rows);
  assert.ok(signals.length > 20);
  assert.equal(signals[0].referenceDate, '2020-01-28');
  assert.equal(signals[0].signalDate, '2021-01-28');
  assert.equal(signals[0].executionDate, '2021-02-28');
  assert.equal(signals[0].target, 'risk');
});

test('corrected halves share one seam and cover every interval exactly once', () => {
  const rows = Array.from({ length: 10 }, (_, index) => ({ date: `2026-01-${String(index + 1).padStart(2, '0')}`, value: 100 + index }));
  const [first, second] = am12.splitHalves(rows);
  assert.equal(first.at(-1).date, second[0].date);
  assert.equal((first.length - 1) + (second.length - 1), rows.length - 1);
});

test('same-start strategy and buy-and-hold use symmetric risk entry and exit costs', () => {
  const rows = [
    { date: '2026-01-01', value: 100 },
    { date: '2026-01-02', value: 110 },
    { date: '2026-01-03', value: 121 },
  ];
  const cash = new Map(rows.map(row => [row.date, 100]));
  const signals = [{ executionDate: '2026-01-01', target: 'risk' }];
  const strategy = am12.simulateWindow(rows, cash, signals, 0.002);
  const benchmark = am12.benchmarkWindow(rows, 0.002);
  assert.ok(Math.abs(strategy.terminalWealth - benchmark.terminalWealth) < 1e-12);
  assert.equal(strategy.allocationChanges, 2);
  assert.equal(benchmark.allocationChanges, 2);
});

test('five-market conforming fixture runs full history and corrected halves only', () => {
  const results = am12.analyzeInput(validInput());
  assert.equal(Object.keys(results.markets).length, 5);
  for (const market of Object.values(results.markets)) {
    assert.equal(market.primary.halves.length, 2);
    assert.equal(market.doubleCostStress.halves.length, 2);
    assert.ok(Number.isFinite(market.primary.full.strategy.terminalWealth));
  }
  assert.equal(results.commonCalendar.primary.available, true);
  assert.ok(results.commonCalendar.primary.commonDateCount > 1);
});

test('schema-5 audit reports exact missing contract fields without substitution', () => {
  const audit = am12.auditSchema5({ markets: [
    { key: 'crypto', prices: { currency: 'USD' } },
    { key: 'sweden', prices: { currency: 'SEK' } },
    { key: 'usa', prices: { currency: 'USD' } },
    { key: 'europe', prices: { currency: 'EUR' } },
    { key: 'global', prices: { currency: 'USD' } },
  ] });
  assert.equal(audit.compatible, false);
  assert.ok(audit.missing.some(row => /T-bill\/cash total-return/.test(row)));
  assert.ok(audit.missing.some(row => /sweden: USD-converted/.test(row)));
  assert.ok(audit.missing.some(row => /europe: USD-converted/.test(row)));
});
