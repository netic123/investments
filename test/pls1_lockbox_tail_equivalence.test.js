'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const seedBuilder = require('../scripts/build-pls1-lockbox-seed');
const collector = require('../scripts/pls1-lockbox-collect');
const common = require('../scripts/pls1-lockbox-common');
const model = require('../research/fear_greed_control_residual_pls1');

const RETRIEVAL_DATE = '2026-08-28';
const ACQUIRED_AT_UTC = '2026-08-28T07:00:00.000Z';
const MAX_SESSIONS = 1000;
const RECOVERY_SESSIONS = 800;
const NEW_SESSIONS = 3;

function completedSessionDates(length, retrievalDateUtc = RETRIEVAL_DATE) {
  const dates = [];
  const cursor = new Date(`${retrievalDateUtc}T00:00:00.000Z`);
  while (dates.length < length) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const date = cursor.toISOString().slice(0, 10);
    if (seedBuilder.isExpectedNyseSession(date)) dates.unshift(date);
  }
  return dates;
}

function sourceCalendar(firstDate, horizonDate = '2030-12-31') {
  const sessions = [];
  for (const cursor = new Date(`${firstDate}T00:00:00.000Z`);
    cursor.toISOString().slice(0, 10) <= horizonDate;
    cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    if (seedBuilder.isExpectedNyseSession(date)) sessions.push(date);
  }
  return sessions;
}

function symbolSeed(symbol) {
  return [...symbol].reduce((sum, character) => sum + character.charCodeAt(0), 0);
}

function makeSourceVintage() {
  const dates = completedSessionDates(MAX_SESSIONS);
  const series = {};
  for (const symbol of seedBuilder.requiredSourceSymbols()) {
    const seed = symbolSeed(symbol);
    let value = 40 + (seed % 80);
    const rows = dates.map((date, index) => {
      value *= Math.exp(0.00015
        + (0.003 * Math.sin((index + seed) / (5 + (seed % 11))))
        + (0.0017 * Math.cos((index + (2 * seed)) / (13 + (seed % 7)))));
      return {
        timestamp: Date.parse(`${date}T12:00:00.000Z`) / 1000,
        close: value,
        adjustedClose: value * (1 + ((index % 97) * 0.000001)),
      };
    });
    series[symbol] = {
      firstTradeDate: Date.parse(`${dates[0]}T14:30:00.000Z`) / 1000,
      rows,
    };
  }
  return { dates, series };
}

function bodyFor(vintage, symbol, range) {
  const source = vintage.series[symbol];
  const rows = range === 'max' ? source.rows : source.rows.slice(-RECOVERY_SESSIONS);
  return Buffer.from(JSON.stringify({
    chart: {
      result: [{
        meta: {
          symbol,
          exchangeTimezoneName: 'America/New_York',
          longName: `Synthetic ${symbol}`,
          currency: 'USD',
          exchangeName: symbol === 'ACWI' ? 'NMS' : 'PCX',
          instrumentType: 'ETF',
          firstTradeDate: source.firstTradeDate,
        },
        timestamp: rows.map(row => row.timestamp),
        indicators: {
          quote: [{ close: rows.map(row => row.close) }],
          adjclose: [{ adjclose: rows.map(row => row.adjustedClose) }],
        },
      }],
      error: null,
    },
  }));
}

function sourceIdentityContract(vintage) {
  const requiredSymbols = seedBuilder.requiredSourceSymbols();
  const sessions = sourceCalendar(vintage.dates[0]);
  const calendarId = 'SYNTHETIC_XNYS';
  const identities = Object.fromEntries([...requiredSymbols].sort().map(symbol => [symbol, {
    calendarId,
    currency: 'USD',
    exchange: symbol === 'ACWI' ? 'NMS' : 'PCX',
    firstAdjustedDate: vintage.dates[0],
    firstTradeDate: vintage.series[symbol].firstTradeDate,
    firstTradeDateLocal: vintage.dates[0],
    instrumentType: 'ETF',
    providerSymbol: symbol,
    timezone: 'America/New_York',
  }]));
  return {
    calendars: {
      [calendarId]: {
        evidenceReference: 'LOCAL_TAIL_EQUIVALENCE_FIXTURE_ONLY',
        horizonDate: sessions.at(-1),
        sessions,
        sessionsSha256: model.hashCanonical(sessions),
        timezone: 'America/New_York',
      },
    },
    evidenceReference: 'LOCAL_TAIL_EQUIVALENCE_FIXTURE_ONLY',
    identities,
    requiredSymbols,
    schema: 'fg-control-residual-pls1-source-identities-v1',
    status: 'INDEPENDENTLY_VERIFIED_LICENSED_SOURCE_IDENTITIES',
  };
}

function replayVintage(vintage, sourceIdentity, range, baseUtc) {
  const contract = seedBuilder.expectedSourceContract(range);
  const receipts = [];
  const bodies = [];
  const sourceSelections = [];

  function addReceipt(selection) {
    const requestOrdinal = receipts.length;
    const phase = selection.role === 'COMPONENT' ? 'COMPONENT' : 'EXECUTABLE';
    const startedAtUtc = new Date(Date.parse(baseUtc) + (requestOrdinal * 2000)).toISOString();
    const completedAtUtc = new Date(Date.parse(startedAtUtc) + 1000).toISOString();
    const period2 = phase === 'COMPONENT'
      ? Math.floor(Date.parse(startedAtUtc) / 1000) + 86400
      : Math.floor(Date.parse(`${RETRIEVAL_DATE}T00:00:00.000Z`) / 1000) + 86400;
    const query = range === 'max'
      ? `period1=0&period2=${period2}&interval=1d`
      : `range=${range}&interval=1d`;
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/`
      + `${encodeURIComponent(selection.symbol)}?${query}`
      + (phase === 'EXECUTABLE' ? '&events=div%2Csplits' : '');
    const bytes = bodyFor(vintage, selection.symbol, range);
    bodies.push(bytes);
    receipts.push({
      requestOrdinal,
      phase,
      method: 'GET',
      url,
      startedAtUtc,
      completedAtUtc,
      status: 200,
      responseUrl: url,
      headers: { 'content-type': 'application/json' },
      acceptedFor: [selection.acceptedFor],
      error: null,
      path: `in-memory/${range}/${requestOrdinal}`,
      rawSha256: model.sha256Bytes(bytes),
      rawBytes: bytes.length,
    });
    sourceSelections.push({ ...selection, requestOrdinal });
  }

  for (const selection of contract.selections.filter(item => item.role === 'COMPONENT')) {
    addReceipt(selection);
  }
  for (const selection of contract.selections.filter(item => item.role !== 'COMPONENT')) {
    addReceipt(selection);
  }

  return seedBuilder.replayAlignedDataFromReceipts({
    receipts,
    sourceSelections,
    loadRaw: receipt => bodies[receipt.requestOrdinal],
    range,
    retrievalDateUtc: RETRIEVAL_DATE,
    sourceIdentityContract: sourceIdentity,
  });
}

function learnerInput(market, rows) {
  return {
    key: market.key,
    name: market.name,
    marketClass: market.marketClass,
    targetId: market.targetId,
    cashId: market.cashId,
    rows,
  };
}

test('5y recovery tail equals max-range tail when both extend the same permanent all-history ledger', () => {
  const vintage = makeSourceVintage();
  const sourceIdentity = sourceIdentityContract(vintage);
  const maximum = replayVintage(vintage, sourceIdentity, 'max', '2026-08-28T05:00:00.000Z');
  const recovery = replayVintage(vintage, sourceIdentity, '5y', '2026-08-28T06:00:00.000Z');

  assert.equal(RECOVERY_SESSIONS >= seedBuilder.MIN_LIVE_SOURCE_SESSIONS, true);

  for (const key of common.MARKET_ORDER) {
    const permanentRows = maximum.markets[key].rows
      .slice(0, -NEW_SESSIONS)
      .map(row => ({ ...row, availableAtUtc: null }));
    const maximumNewRows = collector.prospectiveRows(
      maximum.markets[key], permanentRows, ACQUIRED_AT_UTC,
    );
    const recoveryNewRows = collector.prospectiveRows(
      recovery.markets[key], permanentRows, ACQUIRED_AT_UTC,
    );

    assert.equal(maximumNewRows.length, NEW_SESSIONS, `${key}: max expected three new sessions`);
    assert.equal(recoveryNewRows.length, NEW_SESSIONS, `${key}: 5y expected three new sessions`);
    assert.deepEqual(recoveryNewRows, maximumNewRows,
      `${key}: the complete recovery tail must match the same-vintage max tail exactly`);
    assert.deepEqual(recoveryNewRows.at(-2), maximumNewRows.at(-2),
      `${key}: the row that newly matures the preceding origin must be identical`);
    assert.deepEqual(recoveryNewRows.at(-1), maximumNewRows.at(-1),
      `${key}: the terminal aligned decision row must be identical`);

    const maximumLedger = [...permanentRows, ...maximumNewRows];
    const recoveryLedger = [...permanentRows, ...recoveryNewRows];
    assert.deepEqual(recoveryLedger, maximumLedger,
      `${key}: both acquisitions must extend the identical permanent ledger`);
    assert.ok(permanentRows[0].date < recovery.markets[key].rows[0].date,
      `${key}: the permanent learner history must predate the bounded recovery source`);
    assert.ok(recoveryLedger.length > recovery.markets[key].rows.length,
      `${key}: learner input must contain more history than the bounded recovery source`);

    const positions = { M0: 'LONG', M1: 'CASH' };
    const maximumDecision = model.buildLatestDecision(
      learnerInput(maximum.markets[key], maximumLedger), positions,
    );
    const recoveryDecision = model.buildLatestDecision(
      learnerInput(recovery.markets[key], recoveryLedger), positions,
    );

    assert.deepEqual(recoveryDecision.M0, maximumDecision.M0,
      `${key}: M0 decision must be source-range invariant`);
    assert.deepEqual(recoveryDecision.M1, maximumDecision.M1,
      `${key}: M1 PLS1 decision must be source-range invariant`);
    assert.ok(['BUY', 'SELL'].includes(recoveryDecision.M0.action));
    assert.ok(['BUY', 'SELL'].includes(recoveryDecision.M1.action));
    assert.equal(recoveryDecision.M1.allHistoryStart, permanentRows[0].date);
    assert.equal(recoveryDecision.M1.allHistoryRows, recoveryLedger.length);
    assert.equal(recoveryDecision.M1.learnerTruncatedSuppliedLedger, false);
    assert.equal(recoveryDecision.M1.sourceHistoryCompleteness,
      'REQUIRES_EXTERNAL_LOCKBOX_VERIFICATION');
    assert.ok(recoveryDecision.M1.trainingRowCount >= model.MIN_MATURED_ROWS);
  }
});
