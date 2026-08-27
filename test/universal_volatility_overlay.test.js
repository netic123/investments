'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const overlay = require('../research/universal_volatility_overlay');

function cashSeries(rows, extra = {}) {
  return {
    role: 'usd_3m_tbill_total_return_wealth_index',
    source: 'synthetic fixture provider',
    methodology: 'synthetic reinvested USD three-month Treasury-bill total-return wealth index',
    currency: 'USD',
    returnType: 'total_return_wealth_index',
    instrumentIdentity: 'SYNTHETIC-USD-3M-TBILL-TRI',
    executionVenue: 'synthetic fixture venue',
    sessionTimezone: 'UTC',
    retrievalUtc: '2026-08-25T20:00:00.000Z',
    expectedLastCompletedCloseDate: rows.at(-1).date,
    revisionStatus: 'point_in_time_revision_zero',
    isPriceOnly: false,
    includesReinvestment: true,
    knownDataIssues: [],
    tenorMonths: 3,
    isYieldSeries: false,
    isReconstructedFromYield: false,
    rows,
    ...extra,
  };
}

function riskySeries(key, rows, extra = {}) {
  return {
    key,
    role: 'executable_risky_total_return_wealth_index',
    source: 'synthetic fixture provider',
    methodology: 'synthetic executable USD total-return wealth index',
    currency: 'USD',
    returnType: 'total_return_wealth_index',
    instrumentIdentity: `SYNTHETIC-${key.toUpperCase()}-USD-TRI`,
    executionVenue: 'synthetic fixture venue',
    sessionTimezone: 'UTC',
    retrievalUtc: '2026-08-25T20:00:00.000Z',
    expectedLastCompletedCloseDate: rows.at(-1).date,
    revisionStatus: 'point_in_time_revision_zero',
    isPriceOnly: false,
    includesReinvestment: true,
    knownDataIssues: [],
    executable: true,
    replicableAtRecordedCloses: true,
    marginEligible: true,
    maxTargetExposure: 1.5,
    marginRuleSource: 'synthetic documented 150 percent target limit',
    usdConversion: key === 'sweden' || key === 'europe' ? 'unhedged_to_usd' : 'native_usd',
    rows,
    ...extra,
  };
}

function fixtureInput(stage = 'validation') {
  const riskyDates = stage === 'development'
    ? ['2010-01-04', '2018-12-31']
    : stage === 'evaluation'
      ? ['2022-01-03', '2026-08-24']
      : ['2018-01-02', '2022-12-30'];
  const cashDates = stage === 'validation' ? ['2018-01-02', '2022-12-31'] : riskyDates;
  const cashRows = cashDates.map((date, index) => ({ date, value: 100 + index }));
  const keys = stage === 'development' ? overlay.DEVELOPMENT_MARKET_KEYS : overlay.MARKET_KEYS;
  return {
    schema: overlay.INPUT_SCHEMA,
    stage,
    frozenAtUtc: '2026-08-25T20:01:00.000Z',
    ...(stage === 'evaluation' ? { finalCompletedDate: '2026-08-24' } : {}),
    cashTotalReturn: cashSeries(cashRows),
    markets: keys.map(key => {
      const dates = stage === 'validation' && key === 'crypto'
        ? ['2018-01-02', '2022-12-31']
        : riskyDates;
      return riskySeries(key, dates.map((date, index) => ({ date, value: 100 + index })));
    }),
  };
}

function monthlyVarianceFixture(variances) {
  const rows = [];
  let risky = 100;
  let cash = 100;
  for (let monthIndex = 0; monthIndex < variances.length; monthIndex++) {
    const date = new Date(Date.UTC(2020, monthIndex, 1));
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    for (let day = 1; day <= 16; day++) {
      if (rows.length) risky *= Math.exp(Math.sqrt(variances[monthIndex]));
      rows.push({
        date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        value: risky,
        cashDate: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        cashValue: cash,
      });
    }
  }
  return rows;
}

function alignedRows(values, cashValues = values.map(() => 100), dates = null) {
  const actualDates = dates || values.map((_, index) => `2020-01-${String(index + 1).padStart(2, '0')}`);
  return values.map((value, index) => ({
    date: actualDates[index],
    value,
    cashDate: actualDates[index],
    cashValue: cashValues[index],
  }));
}

function runGit(directory, args) {
  return childProcess.execFileSync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function temporaryGitRepository(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'universal-vol-overlay-git-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  runGit(directory, ['init', '--quiet']);
  runGit(directory, ['config', 'user.email', 'synthetic-fixture@example.invalid']);
  runGit(directory, ['config', 'user.name', 'Synthetic Fixture']);
  return directory;
}

function commitAll(directory, message) {
  runGit(directory, ['add', '--all']);
  runGit(directory, ['commit', '--quiet', '--message', message]);
}

function writeCanonicalArtifact(directory, name, payload, { sidecarDigest = null } = {}) {
  const file = path.join(directory, name);
  const bytes = Buffer.from(overlay.canonicalJson(payload), 'utf8');
  const digest = overlay.sha256Buffer(bytes);
  fs.writeFileSync(file, bytes);
  fs.writeFileSync(`${file}.sha256`, `${sidecarDigest || digest}\n`, 'utf8');
  return { file, bytes, digest };
}

function committedInputEvidence(t, input, name = `${input.stage}-input.json`) {
  const directory = temporaryGitRepository(t);
  const written = writeCanonicalArtifact(directory, name, input);
  commitAll(directory, `commit ${name} and sidecar`);
  return overlay.readCommittedManifest(written.file, `synthetic committed ${input.stage} input`);
}

test('base protocol marker and exact pre-outcome hash are enforced', () => {
  assert.deepEqual(overlay.assertProtocolFrozen(), {
    marker: 'FROZEN_UNIVERSAL_VOL_OVERLAY_V1',
    sha256: '601bb020265d593d057bccc259854871e032a025bd708412eba878d8ab0d9406',
  });
  assert.deepEqual(overlay.CANDIDATES, [
    { id: 'IVOL_125', p: 0.5, upperCap: 1.25 },
    { id: 'IVOL_150', p: 0.5, upperCap: 1.5 },
    { id: 'IVAR_125', p: 1, upperCap: 1.25 },
    { id: 'IVAR_150', p: 1, upperCap: 1.5 },
  ]);
});

test('strict stage schema accepts declarations but rejects proxy, price, local-currency, cash-yield, and executability substitutions', () => {
  assert.doesNotThrow(() => overlay.validateInput(fixtureInput('validation'), 'validation'));

  const proxy = fixtureInput('development');
  proxy.schema = 'universal-vol-overlay-proxy-input-v1';
  assert.throws(() => overlay.validateInput(proxy, 'development'), /input\.schema/);

  const priceOnly = fixtureInput('validation');
  priceOnly.markets[0].returnType = 'price_return';
  assert.throws(() => overlay.validateInput(priceOnly, 'validation'), /returnType/);

  const local = fixtureInput('validation');
  local.markets[1].currency = 'SEK';
  assert.throws(() => overlay.validateInput(local, 'validation'), /currency must be USD/);

  const yieldCash = fixtureInput('validation');
  yieldCash.cashTotalReturn.instrumentIdentity = 'DTB3';
  assert.throws(() => overlay.validateInput(yieldCash, 'validation'), /forbidden yield/);

  const reconstructed = fixtureInput('validation');
  reconstructed.cashTotalReturn.isReconstructedFromYield = true;
  assert.throws(() => overlay.validateInput(reconstructed, 'validation'), /isReconstructedFromYield/);

  const fakeLeverage = fixtureInput('validation');
  fakeLeverage.markets[0].marginEligible = false;
  assert.throws(() => overlay.validateInput(fakeLeverage, 'validation'), /maxTargetExposure must equal 1/);

  const hedgedEurope = fixtureInput('validation');
  hedgedEurope.markets[3].usdConversion = 'hedged_to_usd';
  assert.throws(() => overlay.validateInput(hedgedEurope, 'validation'), /unhedged_to_usd/);
});

test('strict stage endpoints are runner-derived exactly, with explicit 24/7 crypto handling', () => {
  assert.deepEqual(overlay.expectedTerminalCloses('development', '2018-12-31'), {
    cash: '2018-12-31', sweden: '2018-12-31', usa: '2018-12-31', europe: '2018-12-31', global: '2018-12-31',
  });
  assert.deepEqual(overlay.expectedTerminalCloses('validation', '2022-12-31'), {
    cash: '2022-12-31', crypto: '2022-12-31', sweden: '2022-12-30', usa: '2022-12-30', europe: '2022-12-30', global: '2022-12-30',
  });
  assert.deepEqual(overlay.expectedTerminalCloses('evaluation', '2026-08-24'), {
    cash: '2026-08-24', crypto: '2026-08-24', sweden: '2026-08-24', usa: '2026-08-24', europe: '2026-08-24', global: '2026-08-24',
  });
  assert.match(overlay.IMPLEMENTATION_CONVENTIONS.terminalCloseDeclaration, /runner-derived exact frozen stage endpoint/);
});

test('stage input and series schemas are closed and terminal/retrieval/freeze chronology is enforced', () => {
  const topLevelFuture = fixtureInput('validation');
  topLevelFuture.validationRows = [];
  assert.throws(() => overlay.validateInput(topLevelFuture, 'validation'), /unexpected: validationRows/);

  const cashFuture = fixtureInput('validation');
  cashFuture.cashTotalReturn.futureRows = [];
  assert.throws(() => overlay.validateInput(cashFuture, 'validation'), /unexpected: futureRows/);

  const riskyFuture = fixtureInput('validation');
  riskyFuture.markets[0].unknownGateOverride = true;
  assert.throws(() => overlay.validateInput(riskyFuture, 'validation'), /unexpected: unknownGateOverride/);

  const truncated = fixtureInput('validation');
  truncated.markets[0].expectedLastCompletedCloseDate = '2022-12-29';
  assert.throws(() => overlay.validateInput(truncated, 'validation'), /must end at declared expectedLastCompletedCloseDate/);

  const staleTerminal = fixtureInput('validation');
  staleTerminal.markets[1].rows = [{ date: '2018-01-02', value: 100 }, { date: '2022-12-29', value: 101 }];
  staleTerminal.markets[1].expectedLastCompletedCloseDate = '2022-12-29';
  assert.throws(() => overlay.validateInput(staleTerminal, 'validation'), /must equal the frozen validation endpoint 2022-12-30/);

  const truncated24x7Crypto = fixtureInput('validation');
  truncated24x7Crypto.markets[0].rows = [{ date: '2018-01-02', value: 100 }, { date: '2022-12-30', value: 101 }];
  truncated24x7Crypto.markets[0].expectedLastCompletedCloseDate = '2022-12-30';
  assert.throws(() => overlay.validateInput(truncated24x7Crypto, 'validation'), /must equal the frozen validation endpoint 2022-12-31/);

  const cashTruncated = fixtureInput('validation');
  cashTruncated.cashTotalReturn.rows = [{ date: '2018-01-02', value: 100 }, { date: '2022-12-29', value: 101 }];
  cashTruncated.cashTotalReturn.expectedLastCompletedCloseDate = '2022-12-29';
  assert.throws(() => overlay.validateInput(cashTruncated, 'validation'), /must equal the frozen validation endpoint 2022-12-31/);

  const retrievedAfterFreeze = fixtureInput('validation');
  retrievedAfterFreeze.markets[0].retrievalUtc = '2026-08-25T20:01:00.001Z';
  assert.throws(() => overlay.validateInput(retrievedAfterFreeze, 'validation'), /must not be later than input\.frozenAtUtc/);

  const closeAfterRetrievalDate = fixtureInput('validation');
  closeAfterRetrievalDate.markets[0].retrievalUtc = '2022-12-29T23:59:59.999Z';
  assert.throws(() => overlay.validateInput(closeAfterRetrievalDate, 'validation'), /must not be later than its retrieval UTC date/);
  assert.match(overlay.IMPLEMENTATION_CONVENTIONS.chronologyPrecision, /date-level integrity only/);
});

test('stage files reject outcome rows outside their permitted physical slice', () => {
  const validation = fixtureInput('validation');
  validation.markets[0].rows.push({ date: '2023-01-03', value: 102 });
  assert.throws(() => overlay.validateInput(validation, 'validation'), /after permitted 2022-12-31/);

  const evaluation = fixtureInput('evaluation');
  evaluation.markets[0].rows.unshift({ date: '2021-11-01', value: 99 });
  assert.throws(() => overlay.validateInput(evaluation, 'evaluation'), /risky seed close is more than seven calendar days before 2021-12-01/);

  const development = fixtureInput('development');
  development.markets.unshift(riskySeries('crypto', development.markets[0].rows));
  assert.throws(() => overlay.validateInput(development, 'development'), /markets must be exactly sweden,usa,europe,global/);
});

test('later stages permit exactly one immediate pre-warmup risky seed close but no earlier outcome history', () => {
  const validation = fixtureInput('validation');
  validation.cashTotalReturn.rows.unshift({ date: '2017-11-29', value: 99.9 });
  for (const market of validation.markets) market.rows.unshift({ date: '2017-11-30', value: 99 });
  assert.doesNotThrow(() => overlay.validateInput(validation, 'validation'));

  validation.markets[0].rows.unshift({ date: '2017-11-29', value: 98 });
  assert.throws(() => overlay.validateInput(validation, 'validation'), /at most one risky seed close/);
  assert.match(overlay.IMPLEMENTATION_CONVENTIONS.segmentState, /initializes.*1\.00/);

  const futureEvaluation = fixtureInput('evaluation');
  futureEvaluation.finalCompletedDate = '2026-08-26';
  assert.throws(() => overlay.validateInput(futureEvaluation, 'evaluation'), /not pre-frozen/);
});

test('cash as-of mapping permits seven calendar days, rejects eight, and never interpolates', () => {
  const risky = [{ date: '2020-01-08', value: 100 }, { date: '2020-01-09', value: 101 }];
  const cash = [{ date: '2020-01-01', value: 100 }, { date: '2020-01-09', value: 100.1 }];
  const aligned = overlay.alignCashToRisky(risky, cash);
  assert.equal(aligned.rows[0].cashDate, '2020-01-01');
  assert.equal(aligned.rows[0].cashValue, 100);
  assert.equal(aligned.rows[1].cashDate, '2020-01-09');
  assert.equal(aligned.rejections.length, 0);

  const stale = overlay.alignCashToRisky([{ date: '2020-01-09', value: 100 }, { date: '2020-01-10', value: 101 }], [{ date: '2020-01-01', value: 100 }]);
  assert.equal(stale.rows[0].cashValue, null);
  assert.equal(stale.rejections[0].type, 'stale_cash_asof');
  assert.equal(stale.rejections[0].staleCalendarDays, 8);
});

test('monthly variance is mean squared log excess without demeaning and causal anchor excludes current month', () => {
  const variances = Array.from({ length: 12 }, (_, index) => (index + 1) * 1e-6).concat([4e-6, 9e-6]);
  const result = overlay.buildMonthlyVarianceStates(monthlyVarianceFixture(variances));
  assert.equal(result.intervalRejections.length, 0);
  assert.equal(result.states[0].validIntervalCount, 15);
  assert.ok(Math.abs(result.states[0].realizedVariance - 1e-6) < 1e-15);
  const firstSignal = result.states[12];
  assert.equal(firstSignal.month, '2021-01');
  assert.ok(Math.abs(firstSignal.anchorVariance - 6.5e-6) < 1e-15);
  assert.ok(Math.abs(firstSignal.realizedVariance - 4e-6) < 1e-15);
  assert.ok(Math.abs(firstSignal.varianceRatio - 1.625) < 1e-12);
  assert.equal(firstSignal.finalRiskyClose, '2021-01-16');
  assert.equal(firstSignal.executionDate, '2021-02-01');
  assert.equal(firstSignal.signalStatus, 'valid_next_close_signal');
});

test('an interior missing whole month remains a Gate-7 failure even when the sample minimum is still met', () => {
  const rows = monthlyVarianceFixture(Array.from({ length: 100 }, () => 1e-6))
    .filter(row => !row.date.startsWith('2024-06'));
  const monthly = overlay.buildMonthlyVarianceStates(rows);
  const terminalDate = rows.at(-1).date;
  const schedules = overlay.buildCandidateSchedule(monthly.states, overlay.CANDIDATES[0], {
    segmentStartDate: null,
    finalCompletedDate: terminalDate,
    terminalCloseDate: terminalDate,
  });
  assert.ok(schedules.desiredTargetCalendar.length >= 60, 'fixture retains the frozen Stage-1 sample minimum');
  const completeness = overlay.assessRequiredCompleteness({
    monthlyStates: monthly.states,
    alignmentRejections: [],
    intervalRejections: monthly.intervalRejections,
    knownDataIssues: [],
    firstExecutionDate: schedules.actualTradeSchedule[0].executionDate,
    terminalDate,
  });
  assert.equal(completeness.sourceAndIntervalsComplete, false);
  assert.ok(completeness.missingRequiredMonths.some(item => item.month === '2024-06' && item.finalRiskyClose === null));
  assert.ok(completeness.staleTargetMonths.some(item => item.month === '2024-06'));

  const gates = overlay.evaluateSevenGates({
    candidateSimulation: validSimulation(0.0125),
    buyAndHold: validSimulation(0.0100, { annualizedVolatility: 0.11, maximumDrawdown: -0.25 }),
    constantMean: validSimulation(0.0115),
    constantVolatilityMatched: validSimulation(0.0110),
    sourceAndIntervalsComplete: completeness.sourceAndIntervalsComplete,
    eligibleExecutedMonthlyHoldings: schedules.desiredTargetCalendar.length,
    minimumExecutedMonthlyHoldings: 60,
  });
  assert.equal(gates.sampleRequirement.pass, true);
  assert.equal(gates.conditions.requiredSourceIntervalsAndLiquidationComplete, false);
  assert.equal(gates.marketScenarioPass, false);
});

test('a partial terminal month is reported but is not Gate-7-missing when it cannot execute before liquidation', () => {
  const rows = monthlyVarianceFixture(Array.from({ length: 15 }, () => 1e-6))
    .filter(row => !row.date.startsWith('2021-03') || Number(row.date.slice(-2)) <= 10);
  const monthly = overlay.buildMonthlyVarianceStates(rows);
  const terminalDate = rows.at(-1).date;
  const schedules = overlay.buildCandidateSchedule(monthly.states, overlay.CANDIDATES[0], {
    segmentStartDate: null,
    finalCompletedDate: terminalDate,
    terminalCloseDate: terminalDate,
  });
  const completeness = overlay.assessRequiredCompleteness({
    monthlyStates: monthly.states,
    alignmentRejections: [],
    intervalRejections: monthly.intervalRejections,
    knownDataIssues: [],
    firstExecutionDate: schedules.actualTradeSchedule[0].executionDate,
    terminalDate,
  });
  const terminalState = monthly.states.at(-1);
  assert.equal(terminalState.month, '2021-03');
  assert.equal(terminalState.realizedVariance, null);
  assert.equal(terminalState.signalStatus, 'missing_current_month_variance');
  assert.equal(completeness.missingRequiredMonths.some(item => item.month === '2021-03'), false);
  assert.equal(completeness.staleTargetMonths.some(item => item.month === '2021-03'), false);
  assert.equal(completeness.sourceAndIntervalsComplete, true);
  assert.match(overlay.IMPLEMENTATION_CONVENTIONS.partialTerminalMonth, /not Gate-7-missing/);
});

test('no-trade band holds only strictly inside and mathematical equality trades without target rounding', () => {
  const states = [
    {
      month: '2020-01', finalRiskyClose: '2020-01-31', executionDate: '2020-02-03',
      anchorVariance: 0.81, realizedVariance: 1, varianceRatio: 0.81, signalStatus: 'valid_next_close_signal',
    },
    {
      month: '2020-02', finalRiskyClose: '2020-02-28', executionDate: '2020-03-02',
      anchorVariance: 0.7225, realizedVariance: 1, varianceRatio: 0.7225, signalStatus: 'valid_next_close_signal',
    },
  ];
  const schedules = overlay.buildCandidateSchedule(states, overlay.CANDIDATES[0], { segmentStartDate: null, finalCompletedDate: '2020-03-31' });
  const schedule = schedules.desiredTargetCalendar;
  assert.ok(Math.abs(schedule[0].preliminaryTarget - 0.9) < 1e-15);
  assert.ok(Math.abs(schedule[0].desiredTarget - 0.9) < 1e-15);
  assert.equal(schedule[0].equalityAtBandTrades, true);
  assert.equal(schedule[0].noTradeBandHeld, false);
  assert.ok(Math.abs(schedule[1].preliminaryTarget - 0.85) < 1e-15);
  assert.ok(Math.abs(schedule[1].desiredTarget - 0.9) < 1e-15);
  assert.equal(schedule[1].noTradeBandHeld, true);
  assert.equal(schedules.actualTradeSchedule.length, 1, 'held desired target is reported but not traded');
});

test('a held desired target remains on the reporting calendar but creates no drift rebalance, turnover, or cost', () => {
  const states = [
    {
      month: '2020-01', finalRiskyClose: '2020-01-31', executionDate: '2020-02-03',
      anchorVariance: 0.81, realizedVariance: 1, varianceRatio: 0.81, signalStatus: 'valid_next_close_signal',
    },
    {
      month: '2020-02', finalRiskyClose: '2020-02-28', executionDate: '2020-03-02',
      anchorVariance: 0.7225, realizedVariance: 1, varianceRatio: 0.7225, signalStatus: 'valid_next_close_signal',
    },
  ];
  const schedules = overlay.buildCandidateSchedule(states, overlay.CANDIDATES[0], {
    segmentStartDate: null,
    finalCompletedDate: '2020-04-01',
    terminalCloseDate: '2020-04-01',
  });
  assert.equal(schedules.desiredTargetCalendar.length, 2);
  assert.equal(schedules.actualTradeSchedule.length, 1);
  assert.equal(schedules.desiredTargetCalendar[1].actualTradeReason, 'omitted_inside_no_trade_band');

  const rows = alignedRows([100, 120, 120], [100, 100, 100], ['2020-02-03', '2020-03-02', '2020-04-01']);
  const simulation = overlay.simulatePolicy({
    alignedRows: rows,
    schedule: schedules.actualTradeSchedule,
    scenario: { oneWayTransactionCost: 0.005, borrowingSpreadAnnual: 0 },
    maximumTargetExposure: 1.5,
    label: 'held_target_fixture',
  });
  assert.equal(simulation.valid, true);
  assert.equal(simulation.metrics.scheduledExecutionCount, 1);
  assert.equal(simulation.events.some(event => event.date === '2020-03-02'), false);
  assert.deepEqual(simulation.events.map(event => event.type), ['entry_or_scheduled_rebalance', 'terminal_liquidation']);
  assert.equal(simulation.metrics.transactionCost, simulation.events[0].transactionCost + simulation.events[1].transactionCost);
});

test('signals whose next close is the terminal row are report-only and cannot rebalance before liquidation', () => {
  const schedules = overlay.buildCandidateSchedule([{
    month: '2020-02', finalRiskyClose: '2020-02-28', executionDate: '2020-03-02',
    anchorVariance: 1, realizedVariance: 1, varianceRatio: 1, signalStatus: 'valid_next_close_signal',
  }], overlay.CANDIDATES[0], {
    segmentStartDate: null,
    finalCompletedDate: '2020-03-02',
    terminalCloseDate: '2020-03-02',
  });
  assert.equal(schedules.desiredTargetCalendar.length, 0);
  assert.equal(schedules.actualTradeSchedule.length, 0);
  assert.equal(schedules.omittedTerminalExecutions.length, 1);
  assert.equal(schedules.omittedTerminalExecutions[0].actualTradeReason, 'omitted_at_or_after_terminal_close');

  const rows = alignedRows([100, 101], [100, 100], ['2020-02-28', '2020-03-02']);
  assert.throws(() => overlay.simulatePolicy({
    alignedRows: rows,
    schedule: [{ executionDate: '2020-02-28', targetExposure: 1 }, { executionDate: '2020-03-02', targetExposure: 0.9 }],
    scenario: { oneWayTransactionCost: 0.002, borrowingSpreadAnnual: 0.015 },
    maximumTargetExposure: 1.5,
  }), /must omit and separately report executions at or after the terminal close/);
});

test('each later segment resets desired-target state to 1.00 and ignores pre-segment target history', () => {
  const states = [
    {
      month: '2018-11', finalRiskyClose: '2018-11-30', executionDate: '2018-12-03',
      anchorVariance: 0.01, realizedVariance: 1, varianceRatio: 0.01, signalStatus: 'valid_next_close_signal',
    },
    {
      month: '2018-12', finalRiskyClose: '2018-12-31', executionDate: '2019-01-02',
      anchorVariance: 0.81, realizedVariance: 1, varianceRatio: 0.81, signalStatus: 'valid_next_close_signal',
    },
  ];
  const schedules = overlay.buildCandidateSchedule(states, overlay.CANDIDATES[0], {
    segmentStartDate: '2019-01-01',
    finalCompletedDate: '2022-12-31',
  });
  const schedule = schedules.desiredTargetCalendar;
  assert.equal(schedule.length, 1);
  assert.equal(schedule[0].precedingDesiredTarget, 1);
  assert.ok(Math.abs(schedule[0].desiredTarget - 0.9) < 1e-15);
});

test('exact post-cost rebalance solves buys, sells, and terminal liquidation identities', () => {
  const buy = overlay.exactRebalance({ wealth: 1, riskyNotional: 0, targetExposure: 1.5, costRate: 0.005 });
  assert.ok(Math.abs(buy.postRisky - 1.5 * buy.postWealth) < 1e-14);
  assert.ok(Math.abs(buy.postWealth - (1 - 0.005 * buy.tradedNotional)) < 1e-14);
  assert.ok(buy.postCash < 0);

  const sell = overlay.exactRebalance({ wealth: buy.postWealth, riskyNotional: buy.postRisky, targetExposure: 0.5, costRate: 0.005 });
  assert.ok(Math.abs(sell.postRisky - 0.5 * sell.postWealth) < 1e-14);
  assert.equal(sell.side, 'sell');

  const exit = overlay.exactRebalance({ wealth: sell.postWealth, riskyNotional: sell.postRisky, targetExposure: 0, costRate: 0.005 });
  assert.equal(exit.postRisky, 0);
  assert.ok(Math.abs(exit.postWealth - (sell.postWealth - 0.005 * sell.postRisky)) < 1e-14);
});

test('separate holdings compound with exact T-bill cash, spread borrowing, entry cost, and terminal cost', () => {
  const dates = ['2020-01-01', '2021-01-01'];
  const rows = alignedRows([100, 100], [100, 102], dates);
  const scenario = { id: 'synthetic', oneWayTransactionCost: 0.005, borrowingSpreadAnnual: 0.03 };
  const simulation = overlay.simulatePolicy({
    alignedRows: rows,
    schedule: [{ executionDate: dates[0], targetExposure: 1.5 }],
    scenario,
    maximumTargetExposure: 1.5,
    label: 'synthetic_leverage',
  });
  assert.equal(simulation.valid, true);
  assert.equal(simulation.events[0].type, 'entry_or_scheduled_rebalance');
  assert.equal(simulation.events.at(-1).type, 'terminal_liquidation');
  const entry = simulation.events[0];
  const expectedBorrowGrowth = 1.02 * Math.exp(0.03 * 366 / overlay.YEAR_DAYS);
  const expectedGrossBorrowingCost = (-entry.postCash) * (expectedBorrowGrowth - 1);
  assert.ok(Math.abs(simulation.metrics.grossBorrowingCost - expectedGrossBorrowingCost) < 1e-12);
  assert.ok(Math.abs(simulation.metrics.transactionCost - simulation.events.reduce((sum, event) => sum + event.transactionCost, 0)) < 1e-14);
  assert.equal(simulation.metrics.timeAboveOneExposureCalendarDays, 366);
  assert.equal(simulation.metrics.terminalLiquidationPerformed, true);

  const saver = overlay.simulatePolicy({
    alignedRows: rows,
    schedule: [{ executionDate: dates[0], targetExposure: 0.5 }],
    scenario: { id: 'zero_cost', oneWayTransactionCost: 0, borrowingSpreadAnnual: 0.03 },
    maximumTargetExposure: 1.5,
    label: 'synthetic_saver',
  });
  assert.ok(Math.abs(saver.events.at(-1).preRiskyNotional - 0.5) < 1e-14, 'risky units are held rather than silently rebalanced each close');
  assert.ok(Math.abs(saver.metrics.terminalWealth - 1.01) < 1e-14, 'positive signed cash earns the T-bill TRI');
  assert.equal(saver.metrics.grossBorrowingCost, 0);
});

test('documented margin limit and 40 percent equity/notional floor are execution failures, never returns', () => {
  const rows = alignedRows([100, 100], [100, 100], ['2020-01-01', '2020-01-02']);
  const overLimit = overlay.simulatePolicy({
    alignedRows: rows,
    schedule: [{ executionDate: rows[0].date, targetExposure: 1.25 }],
    scenario: { oneWayTransactionCost: 0, borrowingSpreadAnnual: 0 },
    maximumTargetExposure: 1,
  });
  assert.equal(overLimit.valid, false);
  assert.equal(overLimit.metrics, null);
  assert.equal(overLimit.executionFailure.type, 'target_above_documented_margin_limit');

  const crash = overlay.simulatePolicy({
    alignedRows: alignedRows([100, 55], [100, 100], ['2020-01-01', '2020-01-02']),
    schedule: [{ executionDate: '2020-01-01', targetExposure: 1.5 }],
    scenario: { oneWayTransactionCost: 0, borrowingSpreadAnnual: 0 },
    maximumTargetExposure: 1.5,
  });
  assert.equal(crash.valid, false);
  assert.equal(crash.metrics, null);
  assert.equal(crash.executionFailure.type, 'equity_to_long_notional_below_research_floor');
});

test('calendar-time mean target and frozen 0.5000..1.5000 control grid are exact', () => {
  const schedule = [
    { executionDate: '2020-01-01', targetExposure: 0.5 },
    { executionDate: '2020-01-11', targetExposure: 1.5 },
  ];
  const target = overlay.scheduleTargetExposure(schedule, '2020-01-31');
  assert.equal(target.targetDaySum, 35);
  assert.equal(target.totalDays, 30);
  assert.equal(target.timeWeightedMeanTarget, 35 / 30);

  assert.deepEqual(overlay.executableGridTargets(1.5), {
    targets: Array.from({ length: 10001 }, (_, index) => (5000 + index) / 10000),
    rejectedAboveDocumentedLimit: 0,
  });
  const limited = overlay.executableGridTargets(1.25);
  assert.equal(limited.targets.length, 7501);
  assert.equal(limited.targets.at(-1), 1.25);
  assert.equal(limited.rejectedAboveDocumentedLimit, 2500);
});

test('full volatility-matched grid is shared and selects the lower target on an exact tie', () => {
  const rows = alignedRows([100, 101, 99, 102], [100, 100.01, 100.02, 100.03]);
  const schedule = [{ executionDate: rows[0].date, targetExposure: 1 }];
  const scenario = { oneWayTransactionCost: 0, borrowingSpreadAnnual: 0 };
  const candidate = overlay.simulatePolicy({ alignedRows: rows, schedule, scenario, maximumTargetExposure: 1.5 });
  const controls = overlay.chooseVolatilityMatchedControls({
    rows,
    candidateSchedules: { IVOL_125: schedule, IVAR_150: schedule },
    candidateSimulations: { IVOL_125: candidate, IVAR_150: candidate },
    scenario,
    maximumTargetExposure: 1.5,
  });
  assert.equal(controls.IVOL_125.gridTargetsTested, 10001);
  assert.equal(controls.IVOL_125.selectedTarget, controls.IVAR_150.selectedTarget);
  assert.equal(controls.IVOL_125.simulation.valid, true);
  assert.ok(controls.IVOL_125.selectedTarget >= 0.5 && controls.IVOL_125.selectedTarget <= 1.5);
  assert.equal(
    controls.IVOL_125.volatilityDistance,
    Math.abs(controls.IVOL_125.simulation.metrics.annualizedVolatility - candidate.metrics.annualizedVolatility),
    'compact grid volatility must be bit-identical to the fully reported selected control',
  );
});

test('volatility grid caches exact interval factors and respects candidate-specific actual trade dates', () => {
  const rows = alignedRows(
    [100, 102, 99, 104, 101, 106],
    [100, 100.01, 100.02, 100.03, 100.04, 100.05],
    ['2020-01-02', '2020-01-03', '2020-02-03', '2020-03-02', '2020-04-01', '2020-05-01'],
  );
  const scenario = { oneWayTransactionCost: 0.002, borrowingSpreadAnnual: 0.015 };
  const leftSchedule = [
    { executionDate: rows[0].date, targetExposure: 1 },
    { executionDate: rows[2].date, targetExposure: 0.8 },
  ];
  const rightSchedule = [
    { executionDate: rows[0].date, targetExposure: 1 },
    { executionDate: rows[3].date, targetExposure: 1.2 },
  ];
  const candidateSimulations = {
    IVOL_125: overlay.simulatePolicy({ alignedRows: rows, schedule: leftSchedule, scenario, maximumTargetExposure: 1.5 }),
    IVAR_150: overlay.simulatePolicy({ alignedRows: rows, schedule: rightSchedule, scenario, maximumTargetExposure: 1.5 }),
  };
  const controls = overlay.chooseVolatilityMatchedControls({
    rows,
    candidateSchedules: { IVOL_125: leftSchedule, IVAR_150: rightSchedule },
    candidateSimulations,
    scenario,
    maximumTargetExposure: 1.5,
  });
  assert.equal(controls.IVOL_125.gridTargetsTested, 10001);
  assert.equal(controls.IVAR_150.gridTargetsTested, 10001);
  assert.equal(controls.IVOL_125.simulation.metrics.scheduledExecutionCount, leftSchedule.length);
  assert.equal(controls.IVAR_150.simulation.metrics.scheduledExecutionCount, rightSchedule.length);
  for (const id of ['IVOL_125', 'IVAR_150']) {
    assert.equal(
      controls[id].volatilityDistance,
      Math.abs(controls[id].simulation.metrics.annualizedVolatility - candidateSimulations[id].metrics.annualizedVolatility),
    );
  }

  const executionDates = new Set(leftSchedule.map(event => event.executionDate));
  const prepared = overlay.prepareSimulationFactors(rows, scenario, executionDates);
  const direct = overlay.simulateConstantTargetVolatilityOnly({
    rows, executionDates, targetExposure: 0.9876, scenario, maximumTargetExposure: 1.5,
  });
  const cached = overlay.simulateConstantTargetVolatilityOnly({
    rows, executionDates, targetExposure: 0.9876, scenario, maximumTargetExposure: 1.5, preparedFactors: prepared,
  });
  assert.deepEqual(cached, direct, 'factor caching must not change exact compact-control output');
});

test('deterministic grid replay rejects a coherent valid-path control at a non-nearest grid target', () => {
  const rows = alignedRows(
    [100, 103, 99, 105, 101, 107],
    [100, 100.01, 100.02, 100.03, 100.04, 100.05],
    ['2020-01-02', '2020-01-03', '2020-02-03', '2020-03-02', '2020-04-01', '2020-05-01'],
  );
  const scenario = overlay.SCENARIOS[0];
  const schedule = [
    { executionDate: rows[0].date, targetExposure: 1.1 },
    { executionDate: rows[2].date, targetExposure: 0.8 },
    { executionDate: rows[4].date, targetExposure: 1.2 },
  ];
  const candidateSimulation = overlay.simulatePolicy({
    alignedRows: rows, schedule, scenario, maximumTargetExposure: 1.5, label: 'candidate',
  });
  const replayed = overlay.chooseVolatilityMatchedControls({
    rows,
    candidateSchedules: { candidate: schedule },
    candidateSimulations: { candidate: candidateSimulation },
    scenario,
    maximumTargetExposure: 1.5,
  }).candidate;
  assert.doesNotThrow(() => overlay.verifyVolatilityMatchedControl({
    rows, schedule, candidateSimulation, scenario, maximumTargetExposure: 1.5, reported: replayed,
  }));

  const wrongTarget = replayed.selectedTarget === 1.5 ? 1.4999 : replayed.selectedTarget + 0.0001;
  const wrongSimulation = overlay.simulatePolicy({
    alignedRows: rows,
    schedule: overlay.constantSchedule(schedule, wrongTarget),
    scenario,
    maximumTargetExposure: 1.5,
    label: `constant_volatility_matched_${wrongTarget.toFixed(4)}`,
  });
  const coherentNonNearest = {
    ...replayed,
    selectedTarget: wrongTarget,
    volatilityDistance: Math.abs(wrongSimulation.metrics.annualizedVolatility - candidateSimulation.metrics.annualizedVolatility),
    simulation: wrongSimulation,
  };
  assert.throws(() => overlay.verifyVolatilityMatchedControl({
    rows, schedule, candidateSimulation, scenario, maximumTargetExposure: 1.5, reported: coherentNonNearest,
  }), /deterministic 10,001-grid replay does not match/);
});

test('paired six-month circular bootstrap is deterministic at the frozen seed', () => {
  const values = [0.01, -0.02, 0.03, 0.005, -0.004, 0.007, 0.002];
  const first = overlay.movingBlockBootstrap(values, { replicates: 250, blockMonths: 6, seed: 20260825 });
  const second = overlay.movingBlockBootstrap(values, { replicates: 250, blockMonths: 6, seed: 20260825 });
  assert.deepEqual(first, second);
  assert.equal(first.circularBlockMonths, 6);
  assert.equal(first.seed, 20260825);
  assert.equal(first.percentile90.length, 2);
  assert.equal(first.percentile95.length, 2);
  assert.ok(first.percentile95[0] <= first.percentile90[0]);
  assert.ok(first.percentile95[1] >= first.percentile90[1]);
});

function validSimulation(annualizedLogReturn, overrides = {}) {
  return {
    valid: true,
    terminalLiquidationPerformed: true,
    metrics: {
      annualizedLogReturn,
      annualizedVolatility: 0.10,
      maximumDrawdown: -0.20,
      turnoverPerElapsedYear: 4,
      minimumEquityToLongNotional: 0.40,
      ...overrides,
    },
  };
}

test('all seven market gates use exact unrounded boundaries plus the stage holding minimum', () => {
  const candidate = validSimulation(0.0125);
  const buyAndHold = validSimulation(0.0100);
  const constantMean = validSimulation(0.0115);
  const constantVolatility = validSimulation(0.0110);
  const gates = overlay.evaluateSevenGates({
    candidateSimulation: candidate,
    buyAndHold,
    constantMean,
    constantVolatilityMatched: constantVolatility,
    sourceAndIntervalsComplete: true,
    eligibleExecutedMonthlyHoldings: 24,
    minimumExecutedMonthlyHoldings: 24,
  });
  assert.equal(gates.edges.bhEdgeAnnualLogReturn, 0.0025000000000000005);
  assert.ok(Math.abs(gates.edges.timingEdgeAnnualLogReturn - 0.001) < 1e-15);
  assert.equal(gates.marketScenarioPass, true);
  assert.ok(Object.values(gates.conditions).every(Boolean));

  candidate.metrics.turnoverPerElapsedYear = 4.000000000000001;
  const failed = overlay.evaluateSevenGates({
    candidateSimulation: candidate,
    buyAndHold,
    constantMean,
    constantVolatilityMatched: constantVolatility,
    sourceAndIntervalsComplete: true,
    eligibleExecutedMonthlyHoldings: 24,
    minimumExecutedMonthlyHoldings: 24,
  });
  assert.equal(failed.conditions.turnoverNoGreaterThanFourPerYear, false);
  assert.equal(failed.marketScenarioPass, false);
});

test('development selection applies one-basis-point tie, lower cap, p=0.5, then table order', () => {
  const summaries = Object.fromEntries(overlay.CANDIDATES.map(candidate => [candidate.id, {
    candidate,
    eligible: true,
    worstMarketStressTimingEdgeAnnualLogReturn: 0.0199,
  }]));
  summaries.IVOL_150.worstMarketStressTimingEdgeAnnualLogReturn = 0.0200;
  summaries.IVOL_125.worstMarketStressTimingEdgeAnnualLogReturn = 0.0199;
  summaries.IVAR_125.worstMarketStressTimingEdgeAnnualLogReturn = 0.0199;
  assert.equal(overlay.selectDevelopmentCandidate(summaries).id, 'IVOL_125');
  for (const summary of Object.values(summaries)) summary.eligible = false;
  assert.equal(overlay.selectDevelopmentCandidate(summaries), null);
});

test('valid simulation metrics are recomputed from actual synthetic paths and coordinated path/metric fabrication is rejected', () => {
  const rows = alignedRows(
    [100, 103, 101, 106, 104],
    [100, 100.01, 100.02, 100.03, 100.04],
    ['2020-01-02', '2020-02-03', '2020-03-02', '2020-04-01', '2020-05-01'],
  );
  const schedule = [
    { executionDate: '2020-01-02', signalDate: '2019-12-31', signalMonth: '2019-12', targetExposure: 1.1 },
    { executionDate: '2020-03-02', signalDate: '2020-02-28', signalMonth: '2020-02', targetExposure: 0.9 },
  ];
  const scenario = overlay.SCENARIOS[0];
  const simulation = overlay.simulatePolicy({
    alignedRows: rows,
    schedule,
    scenario,
    maximumTargetExposure: 1.5,
    includePath: true,
    label: 'actual_synthetic_policy',
  });
  assert.deepEqual(overlay.recomputeSimulationMetrics(simulation, scenario, 'actual synthetic policy'), simulation.metrics);
  assert.equal(overlay.assertSimulationBacksSchedule(simulation, schedule, 'actual synthetic policy'), true);

  const wrongSchedule = structuredClone(schedule);
  wrongSchedule[1].targetExposure = 0.91;
  assert.throws(() => overlay.assertSimulationBacksSchedule(simulation, wrongSchedule, 'wrong synthetic schedule'), /does not match its expected schedule event/);

  const emptyEvidence = structuredClone(simulation);
  emptyEvidence.events = [];
  emptyEvidence.navPath = [];
  assert.throws(() => overlay.recomputeSimulationMetrics(emptyEvidence, scenario, 'empty-evidence fabrication'), /at least two NAV path rows/);

  const coordinated = structuredClone(simulation);
  coordinated.events[0].transactionCost += 0.0001;
  coordinated.metrics.transactionCost += 0.0001;
  assert.throws(() => overlay.recomputeSimulationMetrics(coordinated, scenario, 'coordinated fabrication'), /exact post-cost rebalance identity mismatch/);

  const pathTamper = structuredClone(simulation);
  pathTamper.navPath[1].wealth += 0.01;
  pathTamper.metrics.terminalWealth += 0.01;
  assert.throws(() => overlay.recomputeSimulationMetrics(pathTamper, scenario, 'path fabrication'), /wealth identity mismatch/);
});

test('input replay rejects a coherent alternate valid path with all metrics, controls, bootstrap, and gates regenerated', () => {
  const aligned = monthlyVarianceFixture(Array.from({ length: 18 }, () => 1e-6));
  const terminalDate = aligned.at(-1).date;
  const analysisArguments = {
    input: {
      cashTotalReturn: {
        knownDataIssues: [],
        rows: aligned.map(row => ({ date: row.date, value: row.cashValue })),
      },
    },
    market: {
      key: 'sweden',
      instrumentIdentity: 'SYNTHETIC-SWEDEN-VALID-PATH',
      revisionStatus: 'point_in_time_revision_zero',
      knownDataIssues: [],
      maxTargetExposure: 1.5,
      rows: aligned.map(row => ({ date: row.date, value: row.value })),
    },
    stageConfig: {
      segmentStartDate: null,
      finalCompletedDate: terminalDate,
      warmupVarianceStartDate: null,
      minimumExecutedMonthlyHoldings: 1,
    },
    candidates: [overlay.CANDIDATES[0]],
    frozenDevelopmentMeanTarget: null,
  };
  const original = overlay.analyzeMarket(analysisArguments);
  assert.equal(original.scenarioResults.primary.IVOL_125.candidate.valid, true);
  assert.equal(original.scenarioResults.primary.IVOL_125.controls.volatilityGridTargetsTested, 10001);
  assert.doesNotThrow(() => overlay.verifyMarketResultReplay(original, analysisArguments, 'original synthetic market'));

  const alternateArguments = structuredClone(analysisArguments);
  const changedIndex = alternateArguments.market.rows.findIndex(row => row.date > original.firstExecutionDate);
  alternateArguments.market.rows[changedIndex].value *= 1.05;
  const coherentAlternate = overlay.analyzeMarket(alternateArguments);
  assert.equal(coherentAlternate.scenarioResults.primary.IVOL_125.candidate.valid, true);
  assert.notDeepEqual(coherentAlternate.scenarioResults.primary.IVOL_125.candidate.navPath, original.scenarioResults.primary.IVOL_125.candidate.navPath);
  assert.throws(
    () => overlay.verifyMarketResultReplay(coherentAlternate, analysisArguments, 'coherent alternate synthetic market'),
    /deterministic input replay does not match/,
  );
});

test('actual synthetic Stage-1 detail cannot be coordinated into a pass by rehashing gates, summaries, and decisions', t => {
  const developmentInput = fixtureInput('development');
  const developmentEvidence = committedInputEvidence(t, developmentInput);
  const manifest = overlay.buildDevelopmentManifest(developmentInput, developmentEvidence.sha256);
  assert.equal(manifest.status, 'NO_UNIVERSAL_CANDIDATE');
  assert.doesNotThrow(() => overlay.recomputeAnalysisIntegrity(
    manifest.allFourCandidateResults,
    'development',
    overlay.CANDIDATES.map(candidate => candidate.id),
  ));
  assert.throws(() => overlay.validateSelectionManifest(manifest, developmentEvidence), /did not pass replayed Stage 1/);
  assert.throws(() => overlay.validateSelectionManifest(manifest), /committed development input/);

  const changed = structuredClone(manifest);
  for (const market of changed.allFourCandidateResults.marketResults) {
    for (const scenario of overlay.SCENARIOS) {
      for (const candidate of overlay.CANDIDATES) {
        const cell = market.scenarioResults[scenario.id][candidate.id];
        for (const key of Object.keys(cell.gates.conditions)) cell.gates.conditions[key] = true;
        cell.gates.sampleRequirement.pass = true;
        cell.gates.originalSevenGatePass = true;
        cell.gates.marketScenarioPass = true;
      }
    }
  }
  for (const summary of Object.values(changed.allFourCandidateResults.candidateSummaries)) summary.eligible = true;
  changed.allFourCandidateResults.stagePass = true;
  changed.stagePass = true;
  changed.status = 'STAGE_1_SELECTED_CANDIDATE';
  changed.selectedCandidate = 'IVOL_125';
  changed.selectedCandidateParameters = overlay.CANDIDATES[0];
  changed.developmentPooledMeanTargetDiagnostic = {
    convention: 'forged', target: 1, targetDaySum: 1, calendarDays: 1, byMarket: {}, affectsSelectionOrGates: false,
  };
  assert.throws(() => overlay.validateSelectionManifest(changed, developmentEvidence), /deterministic Stage-1 replay does not match/);

  const summaryTamper = structuredClone(manifest.allFourCandidateResults);
  summaryTamper.candidateSummaries.IVOL_125.eligible = true;
  assert.throws(() => overlay.recomputeAnalysisIntegrity(
    summaryTamper, 'development', overlay.CANDIDATES.map(candidate => candidate.id),
  ), /candidate summaries does not match/);

  const nestedPassTamper = structuredClone(manifest.allFourCandidateResults);
  nestedPassTamper.stagePass = true;
  assert.throws(() => overlay.recomputeAnalysisIntegrity(
    nestedPassTamper, 'development', overlay.CANDIDATES.map(candidate => candidate.id),
  ), /analysis\.stagePass does not match/);

  const topPassTamper = structuredClone(manifest);
  topPassTamper.stagePass = true;
  assert.throws(() => overlay.validateSelectionManifest(topPassTamper, developmentEvidence), /deterministic Stage-1 replay does not match/);

  const selectionTamper = structuredClone(manifest);
  selectionTamper.selectedCandidate = 'IVOL_125';
  selectionTamper.selectedCandidateParameters = overlay.CANDIDATES[0];
  assert.throws(() => overlay.validateSelectionManifest(selectionTamper, developmentEvidence), /deterministic Stage-1 replay does not match/);

  const extra = structuredClone(manifest.allFourCandidateResults);
  extra.marketResults[0].scenarioResults.primary.IVOL_125.futureRows = [];
  assert.throws(() => overlay.recomputeAnalysisIntegrity(extra, 'development', overlay.CANDIDATES.map(candidate => candidate.id)), /unexpected: futureRows/);
});

test('deterministic Stage-1 replay rejects substituted inputs and a coherent alternate result with downstream hashes rewritten', t => {
  const originalInput = fixtureInput('development');
  const originalEvidence = committedInputEvidence(t, originalInput, 'original-development.json');
  const originalManifest = overlay.buildDevelopmentManifest(originalInput, originalEvidence.sha256);

  const substitutedInput = fixtureInput('development');
  substitutedInput.markets[0].knownDataIssues = ['synthetic alternate-history declaration'];
  const substitutedEvidence = committedInputEvidence(t, substitutedInput, 'substituted-development.json');
  assert.throws(
    () => overlay.validateSelectionManifest(originalManifest, substitutedEvidence),
    /developmentInputSha256 does not match the committed development input/,
  );

  const alteredEvidence = committedInputEvidence(t, fixtureInput('development'), 'altered-development.json');
  alteredEvidence.bytes[0] ^= 1;
  assert.throws(() => overlay.validateSelectionManifest(originalManifest, alteredEvidence), /sha256 does not match its exact bytes/);

  const coherentAlternate = overlay.buildDevelopmentManifest(substitutedInput, substitutedEvidence.sha256);
  coherentAlternate.developmentInputSha256 = originalEvidence.sha256;
  coherentAlternate.allFourCandidateResults.inputSha256 = originalEvidence.sha256;
  assert.throws(
    () => overlay.validateSelectionManifest(coherentAlternate, originalEvidence),
    /deterministic Stage-1 replay does not match/,
  );
});

test('actual synthetic Stage-2 detail also recomputes nested gates, summaries, and stagePass', () => {
  const analysis = overlay.analyzeStage(fixtureInput('validation'), 'validation', {
    selectedCandidate: 'IVOL_125',
    frozenDevelopmentMeanTarget: 1,
    inputSha256: 'b'.repeat(64),
  });
  assert.equal(analysis.stagePass, false);
  assert.doesNotThrow(() => overlay.recomputeAnalysisIntegrity(analysis, 'validation', ['IVOL_125'], {
    frozenDevelopmentMeanTarget: 1,
  }));

  const changed = structuredClone(analysis);
  for (const market of changed.marketResults) {
    for (const scenario of overlay.SCENARIOS) {
      const cell = market.scenarioResults[scenario.id].IVOL_125;
      for (const key of Object.keys(cell.gates.conditions)) cell.gates.conditions[key] = true;
      cell.gates.sampleRequirement.pass = true;
      cell.gates.originalSevenGatePass = true;
      cell.gates.marketScenarioPass = true;
    }
  }
  changed.candidateSummaries.IVOL_125.eligible = true;
  changed.stagePass = true;
  assert.throws(() => overlay.recomputeAnalysisIntegrity(changed, 'validation', ['IVOL_125'], {
    frozenDevelopmentMeanTarget: 1,
  }), /gates does not match/);

  const summaryTamper = structuredClone(analysis);
  summaryTamper.candidateSummaries.IVOL_125.eligible = true;
  assert.throws(() => overlay.recomputeAnalysisIntegrity(summaryTamper, 'validation', ['IVOL_125'], {
    frozenDevelopmentMeanTarget: 1,
  }), /candidate summaries does not match/);

  const nestedPassTamper = structuredClone(analysis);
  nestedPassTamper.stagePass = true;
  assert.throws(() => overlay.recomputeAnalysisIntegrity(nestedPassTamper, 'validation', ['IVOL_125'], {
    frozenDevelopmentMeanTarget: 1,
  }), /analysis\.stagePass does not match/);
});

test('a synthetic insufficient-history Stage 1 reports all four failures and seals later stages', () => {
  const manifest = overlay.buildDevelopmentManifest(fixtureInput('development'), 'a'.repeat(64));
  assert.equal(manifest.schema, overlay.SELECTION_MANIFEST_SCHEMA);
  assert.equal(manifest.status, 'NO_UNIVERSAL_CANDIDATE');
  assert.equal(manifest.stagePass, false);
  assert.equal(manifest.selectedCandidate, null);
  assert.equal(manifest.developmentPooledMeanTargetDiagnostic, null);
  assert.equal(manifest.testSha256, overlay.testSha256());
  assert.deepEqual(Object.keys(manifest.allFourCandidateResults.candidateSummaries).sort(), overlay.CANDIDATES.map(candidate => candidate.id).sort());
  for (const summary of Object.values(manifest.allFourCandidateResults.candidateSummaries)) assert.equal(summary.eligible, false);
  assert.doesNotThrow(() => overlay.recomputeAnalysisIntegrity(
    manifest.allFourCandidateResults,
    'development',
    overlay.CANDIDATES.map(candidate => candidate.id),
  ));
});

test('CLI exposes only physically separated stage commands and forbids all-stages or later inputs in development', () => {
  assert.deepEqual(overlay.parseCommand(['development', '--input', 'dev.json', '--output', 'selection.json']), {
    stage: 'development',
    options: { '--input': 'dev.json', '--output': 'selection.json' },
  });
  assert.throws(() => overlay.parseCommand(['all-stages', '--input', 'all.json', '--output', 'x.json']), /all-stages command is forbidden/);
  assert.throws(() => overlay.parseCommand(['development', '--input', 'dev.json', '--output', 'x.json', '--validation-manifest', 'later.json']), /may not receive or open prior\/later-stage/);
  assert.deepEqual(overlay.parseCommand([
    'validation', '--input', 'val.json', '--output', 'validation.json',
    '--selection-manifest', 'selection.json', '--development-input', 'development.json',
  ]), {
    stage: 'validation',
    options: {
      '--input': 'val.json', '--output': 'validation.json',
      '--selection-manifest': 'selection.json', '--development-input': 'development.json',
    },
  });
  assert.throws(() => overlay.parseCommand(['validation', '--input', 'val.json', '--output', 'x.json', '--selection-manifest', 's.json']), /requires exactly --selection-manifest and --development-input/);
  assert.throws(() => overlay.parseCommand(['evaluation', '--input', 'eval.json', '--output', 'x.json', '--selection-manifest', 's.json']), /requires committed selection\/validation manifests and exact development\/validation inputs/);
  assert.throws(() => overlay.buildValidationManifest(fixtureInput('validation'), 'a'.repeat(64), null), /requires an in-process stage1 replay receipt/);
  assert.throws(() => overlay.buildEvaluationResult(fixtureInput('evaluation'), 'a'.repeat(64), null, null), /requires an in-process stage1 replay receipt/);
});

test('temporary Git sealing rejects dirty, untracked, missing-sidecar, noncanonical, or hash-mismatched prior inputs', t => {
  const directory = temporaryGitRepository(t);
  const payload = fixtureInput('development');
  const clean = writeCanonicalArtifact(directory, 'development-input.json', payload);
  commitAll(directory, 'commit synthetic prior input and sidecar');

  assert.equal(overlay.assertCommittedArtifact(clean.file), true);
  const read = overlay.readCommittedManifest(clean.file, 'synthetic committed prior input');
  assert.deepEqual(read.payload, payload);
  assert.equal(read.sha256, clean.digest);

  fs.appendFileSync(clean.file, '\n', 'utf8');
  assert.throws(() => overlay.assertCommittedArtifact(clean.file), /has uncommitted changes: .*development-input\.json/);
  fs.writeFileSync(clean.file, clean.bytes);
  assert.equal(overlay.assertCommittedArtifact(clean.file), true);

  fs.writeFileSync(`${clean.file}.sha256`, `${'0'.repeat(64)}\n`, 'utf8');
  assert.throws(() => overlay.assertCommittedArtifact(clean.file), /has uncommitted changes: .*development-input\.json\.sha256/);
  fs.writeFileSync(`${clean.file}.sha256`, `${clean.digest}\n`, 'utf8');

  const untracked = writeCanonicalArtifact(directory, 'untracked.json', { value: 2 });
  assert.throws(() => overlay.assertCommittedArtifact(untracked.file), /is not committed: .*untracked\.json/);

  const missingSidecarFile = path.join(directory, 'missing-sidecar.json');
  fs.writeFileSync(missingSidecarFile, overlay.canonicalJson({ value: 3 }), 'utf8');
  runGit(directory, ['add', 'missing-sidecar.json']);
  runGit(directory, ['commit', '--quiet', '--message', 'commit artifact without sidecar']);
  assert.throws(() => overlay.assertCommittedArtifact(missingSidecarFile), /is not committed: .*missing-sidecar\.json\.sha256/);

  const noncanonicalPayload = { z: 1, a: 2 };
  const noncanonicalFile = path.join(directory, 'noncanonical.json');
  const noncanonicalBytes = Buffer.from(JSON.stringify(noncanonicalPayload, null, 2), 'utf8');
  fs.writeFileSync(noncanonicalFile, noncanonicalBytes);
  fs.writeFileSync(`${noncanonicalFile}.sha256`, `${overlay.sha256Buffer(noncanonicalBytes)}\n`, 'utf8');
  commitAll(directory, 'commit noncanonical synthetic manifest');
  assert.throws(() => overlay.readCommittedManifest(noncanonicalFile, 'noncanonical manifest'), /not the exact canonical JSON serialization/);

  const wrongHash = writeCanonicalArtifact(directory, 'wrong-hash.json', { value: 4 }, { sidecarDigest: 'f'.repeat(64) });
  commitAll(directory, 'commit wrong synthetic sidecar');
  assert.throws(() => overlay.readCommittedManifest(wrongHash.file, 'wrong-hash manifest'), /SHA-256 sidecar mismatch/);
});

test('temporary Git code freeze requires all exact protocol, runner, and test bytes committed and clean', t => {
  const directory = temporaryGitRepository(t);
  const protocol = path.join(directory, 'protocol.md');
  const runner = path.join(directory, 'runner.js');
  const syntheticTest = path.join(directory, 'runner.test.js');
  fs.writeFileSync(protocol, 'frozen protocol\n', 'utf8');
  fs.writeFileSync(runner, 'module.exports = true;\n', 'utf8');
  fs.writeFileSync(syntheticTest, 'synthetic test\n', 'utf8');
  commitAll(directory, 'freeze synthetic code triple');

  const receipt = overlay.assertCodeFreezeCommitted({ directory, targets: [protocol, runner, syntheticTest] });
  assert.equal(receipt.protocolSha256, overlay.sha256Buffer(fs.readFileSync(protocol)));
  assert.equal(receipt.runnerSha256, overlay.sha256Buffer(fs.readFileSync(runner)));
  assert.equal(receipt.testSha256, overlay.sha256Buffer(fs.readFileSync(syntheticTest)));

  fs.appendFileSync(runner, '// dirty\n', 'utf8');
  assert.throws(() => overlay.assertCodeFreezeCommitted({ directory, targets: [protocol, runner, syntheticTest] }), /has uncommitted changes/);
  fs.writeFileSync(runner, 'module.exports = true;\n', 'utf8');

  const untrackedTest = path.join(directory, 'future.test.js');
  fs.writeFileSync(untrackedTest, 'future test\n', 'utf8');
  assert.throws(() => overlay.assertCodeFreezeCommitted({ directory, targets: [protocol, runner, untrackedTest] }), /is not committed/);
});

test('main enforces protocol, parsing, code freeze, prior-stage manifests, input, analysis, and write ordering', () => {
  const invalidOrder = [];
  assert.throws(() => overlay.main(['all-stages'], {
    assertProtocolFrozen() { invalidOrder.push('protocol'); },
    assertCodeFreezeCommitted() { invalidOrder.push('code'); },
  }), /all-stages command is forbidden/);
  assert.deepEqual(invalidOrder, ['protocol']);

  const sealedOrder = [];
  assert.throws(() => overlay.main(['development', '--input', 'never-open.json', '--output', 'never-write.json'], {
    assertProtocolFrozen() { sealedOrder.push('protocol'); },
    assertCodeFreezeCommitted() { sealedOrder.push('code'); throw new Error('synthetic code seal stop'); },
    readJsonFile() { sealedOrder.push('input'); throw new Error('input opened too early'); },
  }), /synthetic code seal stop/);
  assert.deepEqual(sealedOrder, ['protocol', 'code']);

  const priorStageOrder = [];
  assert.throws(() => overlay.main([
    'validation', '--input', 'never-open.json', '--output', 'never-write.json',
    '--selection-manifest', 'selection.json', '--development-input', 'development.json',
  ], {
    assertProtocolFrozen() { priorStageOrder.push('protocol'); },
    assertCodeFreezeCommitted() { priorStageOrder.push('code'); },
    readCommittedManifest(_file, context) { priorStageOrder.push(context); return { payload: {} }; },
    validateSelectionManifest() { priorStageOrder.push('Stage-1 replay'); throw new Error('synthetic prior-stage stop'); },
    readJsonFile() { priorStageOrder.push('input'); throw new Error('input opened too early'); },
  }), /synthetic prior-stage stop/);
  assert.deepEqual(priorStageOrder, ['protocol', 'code', 'selection manifest', 'committed development input', 'Stage-1 replay']);

  const evaluationOrder = [];
  const stage1Replay = { synthetic: 'stage1-replay' };
  const stage2Replay = { synthetic: 'stage2-replay' };
  const evaluationOutput = overlay.main([
    'evaluation', '--input', 'evaluation.json', '--output', 'evaluation-output.json',
    '--selection-manifest', 'selection.json', '--development-input', 'development.json',
    '--validation-manifest', 'validation.json', '--validation-input', 'validation-input.json',
  ], {
    assertProtocolFrozen() { evaluationOrder.push('protocol'); },
    assertCodeFreezeCommitted() { evaluationOrder.push('code'); },
    readCommittedManifest(_file, context) { evaluationOrder.push(context); return { payload: { context } }; },
    validateSelectionManifest(_manifest, evidence) {
      assert.equal(evidence.payload.context, 'committed development input');
      evaluationOrder.push('Stage-1 replay');
      return stage1Replay;
    },
    validateValidationManifest(_manifest, replay, evidence) {
      assert.equal(replay, stage1Replay);
      assert.equal(evidence.payload.context, 'committed validation input');
      evaluationOrder.push('Stage-2 replay');
      return stage2Replay;
    },
    readJsonFile() {
      evaluationOrder.push('evaluation input');
      return { payload: {}, bytes: Buffer.from(overlay.canonicalJson({}), 'utf8'), sha256: 'a'.repeat(64) };
    },
    buildEvaluationResult(_input, _sha256, firstReplay, secondReplay) {
      assert.equal(firstReplay, stage1Replay);
      assert.equal(secondReplay, stage2Replay);
      evaluationOrder.push('evaluation analysis');
      return { status: 'SYNTHETIC_ONLY', selectedCandidate: 'IVOL_125' };
    },
    writeArtifact() {
      evaluationOrder.push('write');
      return { resolved: 'evaluation-output.json', sha256: 'b'.repeat(64) };
    },
    writeStatus() { evaluationOrder.push('status'); },
  });
  assert.equal(evaluationOutput.status, 'SYNTHETIC_ONLY');
  assert.deepEqual(evaluationOrder, [
    'protocol', 'code',
    'selection manifest', 'committed development input', 'Stage-1 replay',
    'validation manifest', 'committed validation input', 'Stage-2 replay',
    'evaluation input', 'evaluation analysis', 'write', 'status',
  ]);

  const developmentOrder = [];
  const output = overlay.main(['development', '--input', 'synthetic.json', '--output', 'synthetic-output.json'], {
    assertProtocolFrozen() { developmentOrder.push('protocol'); },
    assertCodeFreezeCommitted() { developmentOrder.push('code'); },
    readJsonFile() {
      developmentOrder.push('input');
      return { payload: {}, bytes: Buffer.from(overlay.canonicalJson({}), 'utf8'), sha256: 'a'.repeat(64) };
    },
    buildDevelopmentManifest() {
      developmentOrder.push('analysis');
      return { status: 'SYNTHETIC_ONLY', selectedCandidate: null };
    },
    writeArtifact() {
      developmentOrder.push('write');
      return { resolved: 'synthetic-output.json', sha256: 'b'.repeat(64) };
    },
    writeStatus() { developmentOrder.push('status'); },
  });
  assert.equal(output.status, 'SYNTHETIC_ONLY');
  assert.deepEqual(developmentOrder, ['protocol', 'code', 'input', 'analysis', 'write', 'status']);
});
