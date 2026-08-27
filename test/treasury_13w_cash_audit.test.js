'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const audit = require('../research/treasury_13w_cash_audit');

function rawAuction(overrides = {}) {
  return {
    cusip: '912796AA1',
    security_type: 'Bill',
    security_term: '13-Week',
    security_term_week_year: '13-Week',
    auction_date: '1998-10-26',
    issue_date: '1998-10-29',
    maturity_date: '1999-01-28',
    auction_format: 'Multi-Price',
    avg_med_price: '98.750',
    high_price: '98.700',
    ...overrides,
  };
}

function comparison(overrides = {}) {
  return {
    key: 'A',
    cusip: 'A',
    auctionDate: '1995-01-03',
    issueDate: '1995-01-05',
    maturityDate: '1995-04-06',
    holdingDays: 91,
    auctionFormat: 'Multi-Price',
    purchasePriceField: 'avg_med_price',
    purchasePricePer100: 99,
    auctionHoldingPeriodReturn: 0.01,
    modeledV2CashHoldingPeriodReturn: 0.011,
    signedError: 0.001,
    signedErrorBasisPoints: 10,
    absoluteErrorBasisPoints: 10,
    ...overrides,
  };
}

test('the purchase-price field switches exactly on 1998-11-02', () => {
  const multiple = audit.normalizeAuctionRow(rawAuction());
  assert.equal(multiple.auctionFormat, 'Multi-Price');
  assert.equal(multiple.purchasePriceField, 'avg_med_price');
  assert.equal(multiple.purchasePricePer100, 98.75);
  assert.equal(multiple.holdingDays, 91);
  assert.ok(Math.abs(multiple.realizedHoldingPeriodReturn - (100 / 98.75 - 1)) < 1e-15);

  const single = audit.normalizeAuctionRow(rawAuction({
    cusip: '912796AB9',
    auction_date: '1998-11-02',
    issue_date: '1998-11-05',
    maturity_date: '1999-02-04',
    auction_format: 'Single-Price',
    avg_med_price: '98.800',
    high_price: '98.600',
  }));
  assert.equal(single.auctionFormat, 'Single-Price');
  assert.equal(single.purchasePriceField, 'high_price');
  assert.equal(single.purchasePricePer100, 98.6);
  assert.ok(Math.abs(single.realizedHoldingPeriodReturn - (100 / 98.6 - 1)) < 1e-15);
});

test('literal FiscalData null prices and auction-format boundary violations fail closed', () => {
  assert.throws(() => audit.normalizeAuctionRow(rawAuction({ avg_med_price: 'null' })), /avg_med_price is missing/);
  assert.throws(() => audit.normalizeAuctionRow(rawAuction({ auction_format: 'Single-Price' })), /regime boundary/);
  assert.throws(() => audit.normalizeAuctionRow(rawAuction({
    auction_date: '1998-11-02',
    issue_date: '1998-11-05',
    maturity_date: '1999-02-04',
    auction_format: 'Multi-Price',
  })), /regime boundary/);
});

test('actual issue-to-maturity day counts are retained, including 90 and 92 days', () => {
  const ninety = audit.normalizeAuctionRow(rawAuction({
    issue_date: '1998-10-29',
    maturity_date: '1999-01-27',
  }));
  const ninetyTwo = audit.normalizeAuctionRow(rawAuction({
    cusip: '912796AC7',
    issue_date: '1998-10-29',
    maturity_date: '1999-01-29',
  }));
  assert.equal(ninety.holdingDays, 90);
  assert.equal(ninetyTwo.holdingDays, 92);
});

test('comparison uses exact v2 cash levels and excludes bills not matured by the fixed cutoff', () => {
  const matured = audit.normalizeAuctionRow(rawAuction({ avg_med_price: '99.000' }));
  const notMatured = audit.normalizeAuctionRow(rawAuction({
    cusip: '912797ZZ9',
    auction_date: '2026-08-24',
    issue_date: '2026-08-27',
    maturity_date: '2026-11-27',
    auction_format: 'Single-Price',
    high_price: '99.000000',
  }));
  const result = audit.compareAuctionWindows([
    matured,
    notMatured,
  ], [
    { date: matured.issueDate, value: 1.5 },
    { date: matured.maturityDate, value: 1.53 },
  ]);
  assert.equal(result.comparisons.length, 1);
  assert.equal(result.exclusions.length, 1);
  assert.equal(result.exclusions[0].reason, 'NOT_MATURED_BY_FIXED_AS_OF_DATE');
  assert.ok(Math.abs(result.comparisons[0].modeledV2CashHoldingPeriodReturn - 0.02) < 1e-15);
  assert.ok(Math.abs(result.comparisons[0].auctionHoldingPeriodReturn - (100 / 99 - 1)) < 1e-15);
});

test('missing exact issue or maturity cash boundaries are reported, never filled', () => {
  const row = audit.normalizeAuctionRow(rawAuction());
  const result = audit.compareAuctionWindows([row], [{ date: row.issueDate, value: 1 }]);
  assert.equal(result.comparisons.length, 0);
  assert.deepEqual(result.exclusions, [{
    key: row.key,
    cusip: row.cusip,
    auctionDate: row.auctionDate,
    issueDate: row.issueDate,
    maturityDate: row.maturityDate,
    reason: 'EXACT_V2_CASH_BOUNDARY_MISSING',
    issueValuePresent: true,
    maturityValuePresent: false,
  }]);
});

test('R-7 percentiles and non-correlation error metrics are explicit', () => {
  assert.equal(audit.quantileR7([0, 10], 0.95), 9.5);
  assert.equal(audit.quantileR7([3, 1, 2], 0.5), 2);
  const rows = [
    comparison(),
    comparison({
      key: 'B',
      cusip: 'B',
      auctionDate: '1995-01-10',
      issueDate: '1995-01-12',
      maturityDate: '1995-04-13',
      auctionHoldingPeriodReturn: 0.02,
      modeledV2CashHoldingPeriodReturn: 0.018,
      signedError: -0.002,
      signedErrorBasisPoints: -20,
      absoluteErrorBasisPoints: 20,
    }),
  ];
  const summary = audit.summarizeComparisons(rows);
  assert.equal(summary.windowCount, 2);
  assert.equal(summary.meanSignedErrorBasisPoints, -5);
  assert.equal(summary.absoluteErrorBasisPoints.p50, 15);
  assert.equal(summary.absoluteErrorBasisPoints.p95, 19.5);
  assert.ok(Number.isFinite(summary.rootMeanSquaredErrorBasisPoints));
  assert.match(summary.pooledExposureAnnualized.interpretation, /not an investable cumulative wealth path/);
});

test('cumulative growth is built only from exact non-overlapping roll chains', () => {
  const a1 = comparison();
  const a2 = comparison({
    key: 'A2',
    cusip: 'A2',
    auctionDate: '1995-04-03',
    issueDate: a1.maturityDate,
    maturityDate: '1995-07-06',
    auctionHoldingPeriodReturn: 0.02,
    modeledV2CashHoldingPeriodReturn: 0.019,
    signedError: -0.001,
    signedErrorBasisPoints: -10,
  });
  const b1 = comparison({
    key: 'B1',
    cusip: 'B1',
    auctionDate: '1995-01-10',
    issueDate: '1995-01-12',
    maturityDate: '1995-04-13',
    auctionHoldingPeriodReturn: 0.015,
    modeledV2CashHoldingPeriodReturn: 0.014,
    signedError: -0.001,
    signedErrorBasisPoints: -10,
  });
  const chains = audit.buildExactRollChains([a1, a2, b1]);
  assert.equal(chains.length, 2);
  assert.equal(chains[0].summary.windowCount, 2);
  assert.equal(chains[0].summary.auctionTerminalWealth, 1.0302);
  assert.equal(chains[0].summary.modeledV2CashTerminalWealth, Number((1.011 * 1.019).toPrecision(15)));
  assert.equal(audit.summarizeExactRollChains(chains).coveredWindowCount, 3);
});

test('CLI is fixed to immutable audit or one-time fetch and refuses drift options', () => {
  assert.deepEqual(audit.parseArgs([]), { fetch: false });
  assert.deepEqual(audit.parseArgs(['--fetch']), { fetch: true });
  assert.throws(() => audit.parseArgs(['--output', 'elsewhere.json']), /accepted invocation/);
  assert.throws(() => audit.parseArgs(['--fetch', '--replace']), /accepted invocation/);
});
