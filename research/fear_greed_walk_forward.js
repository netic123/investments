'use strict';

// Schema 7: deterministic, network-free pooled annual walk-forward evaluation.
// The protocol was frozen before this runner was allowed to inspect outcomes.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const http2 = require('http2');
const net = require('net');
const tls = require('tls');
const dns = require('dns');
const dgram = require('dgram');
const schema5 = require('./fear_greed_v2_validation');
const schema6 = require('./fear_greed_extreme_strategy');

const SCHEMA_VERSION = 7;
const PROTOCOL_PATH = path.join(__dirname, 'FEAR_GREED_WALK_FORWARD_PROTOCOL.md');
const SCHEMA6_RUNNER_PATH = path.join(__dirname, 'fear_greed_extreme_strategy.js');
const REQUIRED_PROTOCOL_MARKER = 'FROZEN_SCHEMA7_POOLED_WALK_FORWARD_V1';
const REQUIRED_PROTOCOL_FREEZE_AT = '2026-08-25T15:53:54.1645065Z';
const REQUIRED_PROTOCOL_SHA256 = '72ecf89d3631e127be2de86c63e313ead642cc15b595fb13c2606cf4dcaf802b';
const REQUIRED_SCHEMA6_PROTOCOL_SHA256 = '8f81c86c30df9480af898feb4d3e35e19a41847c8b0a5ea0c8527b90a6f261db';
const REQUIRED_SCHEMA6_RUNNER_SHA256 = '7f68d4966d0a81d5ed2c762932c70109352f43c748af4c0a442fc4c11a006ce8';
const REQUIRED_SNAPSHOT_SHA256 = 'ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d';
const DEFAULT_SNAPSHOT_PATH = schema6.DEFAULT_SNAPSHOT_PATH;
const YEAR_DAYS = schema6.YEAR_DAYS;
const STATUS_PASS = 'RETROSPECTIVE_WALK_FORWARD_PASS';
const STATUS_FAIL = 'NO_WALK_FORWARD_HISTORICAL_WINNER';
const EXPECTED_MARKET_ORDER = Object.freeze(['crypto', 'sweden', 'usa', 'europe', 'global']);
const FROZEN_CANDIDATES = schema6.FROZEN_DESIGN.candidates;
const MARKET_COSTS = schema6.MARKET_COSTS;

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}

const FROZEN_DESIGN = deepFreeze({
  schemaVersion: SCHEMA_VERSION,
  statusBoundary: [STATUS_PASS, STATUS_FAIL],
  protocolMarker: REQUIRED_PROTOCOL_MARKER,
  protocolFrozenAt: REQUIRED_PROTOCOL_FREEZE_AT,
  requiredSnapshotSha256: REQUIRED_SNAPSHOT_SHA256,
  requiredSchema6ProtocolSha256: REQUIRED_SCHEMA6_PROTOCOL_SHA256,
  requiredSchema6RunnerSha256: REQUIRED_SCHEMA6_RUNNER_SHA256,
  candidateCount: 31,
  candidates: FROZEN_CANDIDATES,
  trainingCalendarYears: 3,
  minimumTrainingMarkets: 2,
  initialState: 'long',
  executionLagTargetBars: 1,
  terminalLiquidation: false,
  cashAnnualReturn: 0,
  calendarYearDays: YEAR_DAYS,
  costs: MARKET_COSTS,
  selectionRanking: [
    'positive-market count descending',
    'median annualized log excess descending',
    'worst-market annualized log excess descending',
    'equal-market mean annualized log excess descending',
    'schema-6 declaration order ascending',
  ],
  commonAggregate: 'arithmetic mean of five equal starting allocations; no rebalance',
});

function sha256Buffer(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('canonical JSON cannot contain a non-finite number');
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function fingerprint(value) {
  return sha256Buffer(Buffer.from(canonicalJson(value), 'utf8'));
}

function parseProtocolState(text = fs.readFileSync(PROTOCOL_PATH, 'utf8')) {
  const marker = /<!--\s*SCHEMA7_FREEZE_MARKER:\s*([^\s]+)\s*-->/.exec(text);
  const frozenAt = /<!--\s*SCHEMA7_FREEZE_AT:\s*([^\s]+)\s*-->/.exec(text);
  if (!marker || !frozenAt) throw new Error('schema-7 protocol freeze lines are missing');
  return { marker: marker[1], frozenAt: frozenAt[1] };
}

function assertProtocolFrozen(state = parseProtocolState()) {
  if (state.marker !== REQUIRED_PROTOCOL_MARKER || state.frozenAt !== REQUIRED_PROTOCOL_FREEZE_AT) {
    throw new Error(`schema-7 protocol is not the required frozen design: ${JSON.stringify(state)}`);
  }
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(state.frozenAt) || !Number.isFinite(Date.parse(state.frozenAt))) {
    throw new Error('schema-7 frozenAt is not a valid exact ISO UTC timestamp');
  }
  const actualSha256 = sha256File(PROTOCOL_PATH);
  if (actualSha256 !== REQUIRED_PROTOCOL_SHA256) {
    throw new Error(`schema-7 frozen protocol hash mismatch: expected ${REQUIRED_PROTOCOL_SHA256}, got ${actualSha256}`);
  }
  return state;
}

function assertDependenciesPinned() {
  const protocol = assertProtocolFrozen();
  const schema6Protocol = schema6.assertProtocolFrozen();
  const schema6RunnerSha256 = sha256File(SCHEMA6_RUNNER_PATH);
  if (schema6.REQUIRED_PROTOCOL_SHA256 !== REQUIRED_SCHEMA6_PROTOCOL_SHA256 ||
      sha256File(schema6.PROTOCOL_PATH) !== REQUIRED_SCHEMA6_PROTOCOL_SHA256) {
    throw new Error('schema-6 frozen protocol dependency hash drifted');
  }
  if (schema6RunnerSha256 !== REQUIRED_SCHEMA6_RUNNER_SHA256) {
    throw new Error(`schema-6 runner dependency hash mismatch: expected ${REQUIRED_SCHEMA6_RUNNER_SHA256}, got ${schema6RunnerSha256}`);
  }
  if (schema6.REQUIRED_SNAPSHOT_SHA256 !== REQUIRED_SNAPSHOT_SHA256) throw new Error('schema-6 snapshot dependency hash drifted');
  if (!Array.isArray(FROZEN_CANDIDATES) || FROZEN_CANDIDATES.length !== 31 ||
      FROZEN_CANDIDATES.some((candidate, index) => candidate.declarationOrder !== index)) {
    throw new Error('schema-6 candidate family or declaration order drifted');
  }
  return {
    protocol,
    schema7ProtocolSha256: sha256File(PROTOCOL_PATH),
    schema6Protocol,
    schema6ProtocolSha256: sha256File(schema6.PROTOCOL_PATH),
    schema6RunnerSha256,
  };
}

function isoYear(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`invalid ISO date: ${date}`);
  return Number(date.slice(0, 4));
}

function yearStart(year) {
  if (!Number.isInteger(year)) throw new Error(`invalid calendar year: ${year}`);
  return `${year}-01-01`;
}

function yearEnd(year) {
  if (!Number.isInteger(year)) throw new Error(`invalid calendar year: ${year}`);
  return `${year}-12-31`;
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function median(values) {
  if (!values.length) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function clonePending(order) {
  return order ? { ...order } : null;
}

function candidateFear(candidate) {
  const value = candidate && (candidate.fear == null ? candidate.buyBoundary : candidate.fear);
  if (!Number.isFinite(value)) throw new Error(`${candidate && candidate.id}: missing fear boundary`);
  return value;
}

function candidateGreed(candidate) {
  const value = candidate && (candidate.greed == null ? candidate.sellBoundary : candidate.greed);
  if (!Number.isFinite(value)) throw new Error(`${candidate && candidate.id}: missing greed boundary`);
  return value;
}

function validateAlignedMarket(market) {
  if (!market || typeof market.key !== 'string' || !Array.isArray(market.rows) || market.rows.length < 2) {
    throw new Error('aligned market requires a key and at least two rows');
  }
  let previous = '';
  for (const row of market.rows) {
    if (!row || typeof row.date !== 'string' || row.date <= previous || !(Number(row.close) > 0) || !row.scores || typeof row.scores !== 'object') {
      throw new Error(`${market.key}: invalid aligned target row`);
    }
    isoYear(row.date);
    previous = row.date;
  }
  const firstDecisionDate = market.firstDecisionDate || market.rows[0].date;
  if (firstDecisionDate !== market.rows[0].date) throw new Error(`${market.key}: firstDecisionDate must equal first aligned row`);
  return market;
}

function trainingEligibilityDate(year) {
  return yearStart(year - 3);
}

function isMarketTrainingEligible(market, year) {
  validateAlignedMarket(market);
  return (market.firstDecisionDate || market.rows[0].date) <= trainingEligibilityDate(year);
}

function deriveTrainingEligibleMarkets(markets, year) {
  if (!Array.isArray(markets)) throw new Error('markets must be an array');
  return markets.filter(market => isMarketTrainingEligible(market, year));
}

const eligibleMarketsForYear = deriveTrainingEligibleMarkets;

function deriveFirstEvaluationYear(markets, minimumMarkets = 2) {
  if (!Array.isArray(markets) || markets.length < minimumMarkets || !Number.isInteger(minimumMarkets) || minimumMarkets < 1) {
    throw new Error('cannot derive first evaluation year');
  }
  markets.forEach(validateAlignedMarket);
  const earliest = Math.min(...markets.map(market => isoYear(market.firstDecisionDate || market.rows[0].date))) + 3;
  const latest = Math.max(...markets.map(market => isoYear(market.firstDecisionDate || market.rows[0].date))) + 4;
  for (let year = earliest; year <= latest; year++) {
    if (deriveTrainingEligibleMarkets(markets, year).length >= minimumMarkets) return year;
  }
  throw new Error('no evaluation year has the required training-market breadth');
}

function trainingWindowRows(input, year) {
  const rows = Array.isArray(input) ? input : input && input.rows;
  if (!Array.isArray(rows)) throw new Error('training rows must be an array or aligned market');
  const startDate = yearStart(year - 3);
  const endDate = yearEnd(year - 1);
  return rows.filter(row => row.date >= startDate && row.date <= endDate);
}

const trainingRowsForYear = trainingWindowRows;

function validateTrainingWindow(rows, year, marketKey = 'market') {
  if (rows.length < 2) throw new Error(`${marketKey}/${year}: training window needs at least two target closes`);
  const years = new Set(rows.map(row => isoYear(row.date)));
  for (const requiredYear of [year - 3, year - 2, year - 1]) {
    if (!years.has(requiredYear)) throw new Error(`${marketKey}/${year}: training window does not contain calendar year ${requiredYear}`);
  }
}

function evaluateTrainingCandidate(market, candidate, year, options = {}) {
  validateAlignedMarket(market);
  const rows = trainingWindowRows(market.rows, year);
  validateTrainingWindow(rows, year, market.key);
  const prices = rows.map(row => ({ date: row.date, close: row.close }));
  const scoreMap = new Map(rows.filter(row => Number.isFinite(row.scores[candidate.id])).map(row => [row.date, row.scores[candidate.id]]));
  const candidateForRun = { ...candidate, fear: candidateFear(candidate), greed: candidateGreed(candidate) };
  const marketCost = options.cost == null
    ? MARKET_COSTS[market.key] && MARKET_COSTS[market.key].stress
    : options.cost;
  if (!(marketCost >= 0 && marketCost < 1)) throw new Error(`${market.key}: missing or invalid stress cost`);
  const annualization = options.annualization || market.annualization || (market.key === 'crypto' ? 365 : 252);
  const comparison = schema6.runWindow({
    prices,
    scoreMap,
    candidate: candidateForRun,
    cost: marketCost,
    annualization,
    initialPosition: 'long',
    includeDetails: false,
  });
  const days = (Date.parse(`${rows.at(-1).date}T00:00:00.000Z`) - Date.parse(`${rows[0].date}T00:00:00.000Z`)) / 86400000;
  const annualizedLogReturnExcess = Math.log(comparison.strategy.terminalWealth / comparison.buyAndHold.terminalWealth) / (days / YEAR_DAYS);
  if (!Number.isFinite(annualizedLogReturnExcess)) {
    throw new Error(`${market.key}/${year}/${candidate.id}: non-finite training comparison`);
  }
  return {
    market: market.key,
    targetId: market.targetId || market.key,
    startDate: rows[0].date,
    endDate: rows.at(-1).date,
    targetBars: rows.length,
    cost: marketCost,
    strategyTerminalWealth: comparison.strategy.terminalWealth,
    buyAndHoldTerminalWealth: comparison.buyAndHold.terminalWealth,
    annualizedLogReturnExcess,
    fills: comparison.strategy.fills,
    completedCashCycles: comparison.strategy.completedCashCycles,
  };
}

function trainingCandidateComparator(left, right) {
  const leftValues = [left.positiveMarketCount, left.medianAnnualizedLogExcess, left.worstAnnualizedLogExcess, left.meanAnnualizedLogExcess];
  const rightValues = [right.positiveMarketCount, right.medianAnnualizedLogExcess, right.worstAnnualizedLogExcess, right.meanAnnualizedLogExcess];
  for (let index = 0; index < leftValues.length; index++) {
    if (leftValues[index] !== rightValues[index]) return rightValues[index] - leftValues[index];
  }
  return left.declarationOrder - right.declarationOrder;
}

function rankTrainingCandidates(candidateRows) {
  if (!Array.isArray(candidateRows) || !candidateRows.length) throw new Error('candidate training ledger is empty');
  return candidateRows.slice().sort(trainingCandidateComparator);
}

function annualCandidateLedger(markets, candidates, year, options = {}) {
  const eligible = deriveTrainingEligibleMarkets(markets, year);
  if (eligible.length < (options.minimumMarkets || 2)) throw new Error(`${year}: fewer than two training-eligible markets`);
  const candidateRows = candidates.map(candidate => {
    const perMarket = eligible.map(market => evaluateTrainingCandidate(market, candidate, year, options));
    const excesses = perMarket.map(row => row.annualizedLogReturnExcess);
    if (excesses.some(value => !Number.isFinite(value))) throw new Error(`${year}/${candidate.id}: incomplete finite ledger`);
    return {
      candidateId: candidate.id,
      declarationOrder: candidate.declarationOrder,
      positiveMarketCount: excesses.filter(value => value > 0).length,
      medianAnnualizedLogExcess: median(excesses),
      worstAnnualizedLogExcess: Math.min(...excesses),
      meanAnnualizedLogExcess: mean(excesses),
      perMarket,
    };
  });
  return {
    year,
    trainingStartDate: yearStart(year - 3),
    trainingEndDate: yearEnd(year - 1),
    eligibleMarkets: eligible.map(market => market.key),
    candidates: candidateRows,
  };
}

function selectAnnualWinner(markets, candidates, year, options = {}) {
  if (Array.isArray(markets) && markets.length && markets.every(row => row && Number.isFinite(row.positiveMarketCount))) {
    return rankTrainingCandidates(markets)[0];
  }
  const ledger = annualCandidateLedger(markets, candidates, year, options);
  const ranked = rankTrainingCandidates(ledger.candidates);
  const ranks = new Map(ranked.map((row, index) => [row.candidateId, index + 1]));
  ledger.candidates = ledger.candidates.map(row => ({ ...row, rank: ranks.get(row.candidateId) }));
  ledger.winnerCandidateId = ranked[0].candidateId;
  ledger.winnerDeclarationOrder = ranked[0].declarationOrder;
  return ledger;
}

function buildSelectionLedger(markets, candidates = FROZEN_CANDIDATES, options = {}) {
  if (!Array.isArray(markets) && markets && typeof markets === 'object') {
    const input = markets;
    markets = input.markets;
    candidates = input.candidates || FROZEN_CANDIDATES;
    options = {
      ...input,
      firstEvaluationYear: input.firstEvaluationYear,
      lastEvaluationYear: input.lastEvaluationYear,
    };
  }
  if (!Array.isArray(markets) || !markets.length || !Array.isArray(candidates) || !candidates.length) throw new Error('invalid selection-ledger inputs');
  const firstEvaluationYear = options.firstEvaluationYear || deriveFirstEvaluationYear(markets);
  const lastEvaluationYear = options.lastEvaluationYear || Math.max(...markets.map(market => isoYear(market.rows.at(-1).date)));
  if (lastEvaluationYear < firstEvaluationYear) throw new Error('last evaluation year precedes first evaluation year');
  const years = [];
  for (let year = firstEvaluationYear; year <= lastEvaluationYear; year++) {
    years.push(selectAnnualWinner(markets, candidates, year, options));
  }
  return { firstEvaluationYear, lastEvaluationYear, years };
}

function selectionByYear(selectionLedger) {
  const years = Array.isArray(selectionLedger) ? selectionLedger : selectionLedger && selectionLedger.years;
  if (!Array.isArray(years)) throw new Error('invalid annual selection ledger');
  return new Map(years.map(row => {
    const candidateId = row.winnerCandidateId || row.selectedCandidateId || row.candidateId;
    if (!Number.isInteger(row.year) || !candidateId) throw new Error('selection ledger row is incomplete');
    return [row.year, candidateId];
  }));
}

function candidateById(candidates) {
  const map = new Map(candidates.map(candidate => [candidate.id, candidate]));
  if (map.size !== candidates.length) throw new Error('candidate IDs are not unique');
  return map;
}

function scoreForCandidate(row, candidateId) {
  const score = row && row.scores && row.scores[candidateId];
  return Number.isFinite(score) ? score : null;
}

function queueAtClose(row, position, candidate, signalCounters) {
  const score = scoreForCandidate(row, candidate.id);
  const decision = schema6.queuedDecision(position, score, candidateFear(candidate), candidateGreed(candidate));
  if (!decision) return null;
  if (decision.side === 'buy') signalCounters.buys++;
  else signalCounters.sells++;
  return {
    side: decision.side,
    desiredPosition: decision.desiredPosition,
    signalDate: row.date,
    signalYear: isoYear(row.date),
    candidateId: candidate.id,
    displayedInteger: decision.displayedInteger,
    roundedScore: schema6.productionRound1(score),
  };
}

function simulateWalkForward(market, selectionLedger, candidates = FROZEN_CANDIDATES, options = {}) {
  if (!market || !market.rows) {
    const input = market || {};
    market = input.market;
    selectionLedger = input.selectionLedger || input.selections;
    candidates = input.candidates || FROZEN_CANDIDATES;
    options = {
      ...input,
      firstEvaluationYear: input.firstEvaluationYear,
      cost: input.cost,
      annualization: input.annualization,
    };
  }
  validateAlignedMarket(market);
  const selected = selectionByYear(selectionLedger);
  const candidateMap = candidateById(candidates);
  const firstEvaluationYear = options.firstEvaluationYear || selectionLedger.firstEvaluationYear || Math.min(...selected.keys());
  const evaluationFloor = yearStart(firstEvaluationYear);
  const rows = market.rows.filter(row => row.date >= evaluationFloor);
  if (rows.length < 2) throw new Error(`${market.key}: evaluation path needs at least two target closes`);
  const cost = options.cost == null ? MARKET_COSTS[market.key] && MARKET_COSTS[market.key].stress : options.cost;
  if (!(cost >= 0 && cost < 1)) throw new Error(`${market.key}: missing or invalid walk-forward stress cost`);
  const annualization = options.annualization || market.annualization || (market.key === 'crypto' ? 365 : 252);

  const candidateForRow = row => {
    const year = isoYear(row.date);
    const id = selected.get(year);
    const candidate = candidateMap.get(id);
    if (!candidate) throw new Error(`${market.key}/${row.date}: no frozen candidate selected before year ${year}`);
    return candidate;
  };

  let wealth = 1;
  let benchmarkWealth = 1;
  let position = 1;
  let cashCycleOpen = false;
  let completedCashCycles = 0;
  let filledBuys = 0;
  let filledSells = 0;
  const signals = { buys: 0, sells: 0 };
  const events = [];
  const intervals = [];
  const states = [];

  let pending = queueAtClose(rows[0], position, candidateForRow(rows[0]), signals);
  states.push({
    index: 0,
    date: rows[0].date,
    close: rows[0].close,
    wealth,
    benchmarkWealth,
    position,
    pendingOrder: clonePending(pending),
    observedCandidateId: candidateForRow(rows[0]).id,
  });

  for (let index = 1; index < rows.length; index++) {
    const start = rows[index - 1];
    const end = rows[index];
    const startPosition = position;
    const pendingAtStart = clonePending(pending);
    const strategyWealthStart = wealth;
    const benchmarkWealthStart = benchmarkWealth;
    const marketFactor = end.close / start.close;
    let netFactor = startPosition === 1 ? marketFactor : 1;
    wealth *= netFactor;
    benchmarkWealth *= marketFactor;
    let fillEvent = null;

    if (pending) {
      wealth *= 1 - cost;
      netFactor *= 1 - cost;
      position = pending.desiredPosition;
      let completedCashCycle = false;
      if (pending.side === 'sell') {
        filledSells++;
        cashCycleOpen = true;
      } else {
        filledBuys++;
        if (cashCycleOpen) {
          completedCashCycles++;
          completedCashCycle = true;
        }
        cashCycleOpen = false;
      }
      fillEvent = {
        ...pending,
        executionDate: end.date,
        executionClose: end.close,
        cost,
        completedCashCycle,
      };
      events.push(fillEvent);
      pending = null;
    }

    const observedCandidate = candidateForRow(end);
    pending = queueAtClose(end, position, observedCandidate, signals);
    intervals.push({
      index: index - 1,
      startDate: start.date,
      endDate: end.date,
      endingYear: isoYear(end.date),
      startClose: start.close,
      endClose: end.close,
      marketFactor,
      benchmarkReturn: marketFactor - 1,
      strategyReturn: netFactor - 1,
      netFactor,
      startPosition,
      endPosition: position,
      pendingAtStart,
      fillEvent,
      strategyWealthStart,
      strategyWealthEnd: wealth,
      benchmarkWealthStart,
      benchmarkWealthEnd: benchmarkWealth,
      observedCandidateId: observedCandidate.id,
      queuedAtEnd: clonePending(pending),
    });
    states.push({
      index,
      date: end.date,
      close: end.close,
      wealth,
      benchmarkWealth,
      position,
      pendingOrder: clonePending(pending),
      observedCandidateId: observedCandidate.id,
    });
  }

  return {
    market: market.key,
    targetId: market.targetId || market.key,
    annualization,
    cost,
    startDate: rows[0].date,
    endDate: rows.at(-1).date,
    rows,
    states,
    intervals,
    events,
    terminalWealth: wealth,
    buyAndHoldTerminalWealth: benchmarkWealth,
    finalPosition: position === 1 ? 'long' : 'cash',
    pendingTerminalOrder: clonePending(pending),
    signalBuys: signals.buys,
    signalSells: signals.sells,
    filledBuys,
    filledSells,
    fills: filledBuys + filledSells,
    completedCashCycles,
  };
}

function viewFromIntervalRange(simulation, startInterval, endIntervalExclusive, id = 'view') {
  if (!simulation || !Array.isArray(simulation.intervals) || !Array.isArray(simulation.states)) throw new Error('invalid walk-forward simulation');
  if (!Number.isInteger(startInterval) || !Number.isInteger(endIntervalExclusive) || startInterval < 0 || endIntervalExclusive > simulation.intervals.length || startInterval >= endIntervalExclusive) {
    throw new Error(`${id}: invalid interval range`);
  }
  const intervals = simulation.intervals.slice(startInterval, endIntervalExclusive);
  const firstState = simulation.states[startInterval];
  const lastState = simulation.states[endIntervalExclusive];
  const strategyReturns = intervals.map(interval => interval.strategyReturn);
  const benchmarkReturns = intervals.map(interval => interval.benchmarkReturn);
  const strategyWealthPath = [1];
  const benchmarkWealthPath = [1];
  for (const interval of intervals) {
    strategyWealthPath.push(strategyWealthPath.at(-1) * interval.netFactor);
    benchmarkWealthPath.push(benchmarkWealthPath.at(-1) * interval.marketFactor);
  }
  const prices = simulation.rows.slice(startInterval, endIntervalExclusive + 1).map(row => ({ date: row.date, close: row.close }));
  const strategy = schema6.summarizePath({
    prices,
    returns: strategyReturns,
    wealthPath: strategyWealthPath,
    annualization: simulation.annualization,
    terminalWealth: strategyWealthPath.at(-1),
  });
  const buyAndHold = schema6.summarizePath({
    prices,
    returns: benchmarkReturns,
    wealthPath: benchmarkWealthPath,
    annualization: simulation.annualization,
    terminalWealth: benchmarkWealthPath.at(-1),
  });
  const fills = intervals.filter(interval => interval.fillEvent);
  strategy.exposure = intervals.filter(interval => interval.startPosition === 1).length / intervals.length;
  strategy.fills = fills.length;
  strategy.filledBuys = fills.filter(interval => interval.fillEvent.side === 'buy').length;
  strategy.filledSells = fills.filter(interval => interval.fillEvent.side === 'sell').length;
  strategy.completedCashCycles = fills.filter(interval => interval.fillEvent.completedCashCycle).length;
  const logExcess = Math.log(strategy.terminalWealth) - Math.log(buyAndHold.terminalWealth);
  return {
    id,
    startDate: firstState.date,
    endDate: lastState.date,
    intervals: intervals.length,
    startPosition: firstState.position === 1 ? 'long' : 'cash',
    endPosition: lastState.position === 1 ? 'long' : 'cash',
    pendingOrderAtStart: clonePending(firstState.pendingOrder),
    pendingOrderAtEnd: clonePending(lastState.pendingOrder),
    strategy,
    buyAndHold,
    terminalWealthDifference: strategy.terminalWealth - buyAndHold.terminalWealth,
    terminalWealthRatio: strategy.terminalWealth / buyAndHold.terminalWealth,
    logReturnExcess: logExcess,
    annualizedLogReturnExcess: logExcess / (strategy.calendarDays / YEAR_DAYS),
    maximumDrawdownImprovement: strategy.maximumDrawdown - buyAndHold.maximumDrawdown,
    positiveExcess: logExcess > 0,
  };
}

function buildFullView(simulation) {
  return viewFromIntervalRange(simulation, 0, simulation.intervals.length, 'full');
}

function buildChronologicalHalves(simulation) {
  const count = simulation.intervals.length;
  const split = Math.floor(count / 2);
  if (split < 1 || count - split < 1) throw new Error(`${simulation.market}: chronological halves each need at least one interval`);
  return [
    viewFromIntervalRange(simulation, 0, split, 'half-1'),
    viewFromIntervalRange(simulation, split, count, 'half-2'),
  ];
}

function commonCalendarBounds(simulations) {
  if (!Array.isArray(simulations) || simulations.length !== 5) throw new Error('common view requires exactly five market simulations');
  const startDate = simulations.map(simulation => simulation.startDate).sort().at(-1);
  const endDate = simulations.map(simulation => simulation.endDate).sort()[0];
  if (startDate >= endDate) throw new Error('invalid common-calendar bounds');
  return { startDate, endDate };
}

function dateBoundView(simulation, lowerBound, upperBound, id = 'common') {
  const startStateIndex = simulation.states.findIndex(state => state.date >= lowerBound);
  let endStateIndex = -1;
  for (let index = simulation.states.length - 1; index >= 0; index--) {
    if (simulation.states[index].date <= upperBound) { endStateIndex = index; break; }
  }
  if (startStateIndex < 0 || endStateIndex <= startStateIndex) throw new Error(`${simulation.market}: insufficient target closes inside ${lowerBound}..${upperBound}`);
  return viewFromIntervalRange(simulation, startStateIndex, endStateIndex, id);
}

function buildCommonView(simulations, bounds = commonCalendarBounds(simulations)) {
  const markets = Object.fromEntries(simulations.map(simulation => [simulation.market, dateBoundView(simulation, bounds.startDate, bounds.endDate, 'common')]));
  const views = Object.values(markets);
  const strategyTerminalWealth = mean(views.map(view => view.strategy.terminalWealth));
  const buyAndHoldTerminalWealth = mean(views.map(view => view.buyAndHold.terminalWealth));
  const days = (Date.parse(`${bounds.endDate}T00:00:00.000Z`) - Date.parse(`${bounds.startDate}T00:00:00.000Z`)) / 86400000;
  if (!(days > 0)) throw new Error('non-positive common-calendar span');
  return {
    ...bounds,
    marketCount: views.length,
    markets,
    strategyTerminalWealth,
    buyAndHoldTerminalWealth,
    terminalWealthDifference: strategyTerminalWealth - buyAndHoldTerminalWealth,
    logReturnExcess: Math.log(strategyTerminalWealth) - Math.log(buyAndHoldTerminalWealth),
    annualizedLogReturnExcess: (Math.log(strategyTerminalWealth) - Math.log(buyAndHoldTerminalWealth)) / (days / YEAR_DAYS),
    positiveExcess: Math.log(strategyTerminalWealth) - Math.log(buyAndHoldTerminalWealth) > 0,
  };
}

function validateRawTargetPrices(rawTargetPrices, marketKey = 'market') {
  if (!Array.isArray(rawTargetPrices) || rawTargetPrices.length < 2) throw new Error(`${marketKey}: raw target prices are missing`);
  let previous = '';
  for (const row of rawTargetPrices) {
    if (!row || typeof row.date !== 'string' || row.date <= previous || !(Number(row.close) > 0)) throw new Error(`${marketKey}: invalid raw target series`);
    isoYear(row.date);
    previous = row.date;
  }
}

function buildCompleteYearCells(simulation, rawTargetPrices) {
  validateRawTargetPrices(rawTargetPrices, simulation.market);
  const evaluationDates = new Set(simulation.states.map(state => state.date));
  const rawByYear = new Map();
  rawTargetPrices.forEach((row, index) => {
    const year = isoYear(row.date);
    if (!rawByYear.has(year)) rawByYear.set(year, []);
    rawByYear.get(year).push({ ...row, rawIndex: index });
  });
  const cells = [];
  for (const year of Array.from(rawByYear.keys()).sort((a, b) => a - b)) {
    const yearRows = rawByYear.get(year);
    const first = yearRows[0];
    const last = yearRows.at(-1);
    const predecessor = first.rawIndex > 0 ? rawTargetPrices[first.rawIndex - 1] : null;
    const hasFollowingYearClose = rawByYear.has(year + 1) && rawByYear.get(year + 1).length > 0;
    const complete = Boolean(predecessor && hasFollowingYearClose && evaluationDates.has(predecessor.date) && evaluationDates.has(first.date) && evaluationDates.has(last.date));
    if (!complete) continue;
    const yearIntervals = simulation.intervals.filter(interval => interval.endingYear === year);
    if (!yearIntervals.length) throw new Error(`${simulation.market}/${year}: complete year has no ending-close intervals`);
    const startInterval = yearIntervals[0].index;
    const endIntervalExclusive = yearIntervals.at(-1).index + 1;
    if (endIntervalExclusive - startInterval !== yearIntervals.length) throw new Error(`${simulation.market}/${year}: year intervals are not contiguous`);
    const view = viewFromIntervalRange(simulation, startInterval, endIntervalExclusive, `year-${year}`);
    if (view.startDate !== predecessor.date || view.endDate !== last.date) {
      throw new Error(`${simulation.market}/${year}: complete-year view does not include predecessor through last close`);
    }
    cells.push({
      market: simulation.market,
      year,
      predecessorDate: predecessor.date,
      firstRawTargetDate: first.date,
      lastRawTargetDate: last.date,
      followingYearObserved: true,
      ...view,
    });
  }
  return cells;
}

const buildCompleteMarketYearCells = buildCompleteYearCells;

function buildEvaluationViews(simulation, rawTargetPrices) {
  return {
    full: buildFullView(simulation),
    halves: buildChronologicalHalves(simulation),
    completeYearCells: buildCompleteYearCells(simulation, rawTargetPrices),
  };
}

function evaluateGate(marketResults, common, completeYearCells, deterministicIntegrityVerified = false) {
  const markets = Array.isArray(marketResults) ? marketResults : Object.values(marketResults || {});
  if (markets.length !== 5) throw new Error('walk-forward gate requires exactly five markets');
  const fullViews = markets.map(result => result.full);
  const halfViews = markets.flatMap(result => result.halves);
  if (halfViews.length !== 10) throw new Error('walk-forward gate requires exactly ten chronological halves');
  if (!Array.isArray(completeYearCells)) throw new Error('complete-year cells must be an array');
  for (const view of fullViews) {
    const finite = [
      view.annualizedLogReturnExcess,
      view.strategy && view.strategy.terminalWealth,
      view.buyAndHold && view.buyAndHold.terminalWealth,
      view.strategy && view.strategy.maximumDrawdown,
      view.buyAndHold && view.buyAndHold.maximumDrawdown,
      view.strategy && view.strategy.completedCashCycles,
    ];
    if (finite.some(value => !Number.isFinite(value))) throw new Error('full-market gate metrics must be finite');
  }
  if (halfViews.some(view => typeof view.positiveExcess !== 'boolean') ||
      completeYearCells.some(cell => typeof cell.positiveExcess !== 'boolean') ||
      !Number.isFinite(common && common.strategyTerminalWealth) ||
      !Number.isFinite(common && common.buyAndHoldTerminalWealth)) {
    throw new Error('half/common/year gate metrics are incomplete');
  }
  const annualizedExcesses = fullViews.map(view => view.annualizedLogReturnExcess);
  const positiveFullMarkets = fullViews.filter(view => view.strategy.terminalWealth > view.buyAndHold.terminalWealth).length;
  const positiveHalfCells = halfViews.filter(view => view.positiveExcess).length;
  const everyMarketPositiveHalf = markets.every(result => result.halves.some(view => view.positiveExcess));
  const positiveCompleteYearCells = completeYearCells.filter(cell => cell.positiveExcess).length;
  const completeYearRatio = completeYearCells.length ? positiveCompleteYearCells / completeYearCells.length : null;
  const everyMarketHasCycle = fullViews.every(view => view.strategy.completedCashCycles >= 1);
  const marketsWithTwoCycles = fullViews.filter(view => view.strategy.completedCashCycles >= 2).length;
  const drawdownImprovedMarkets = fullViews.filter(view => view.strategy.maximumDrawdown >= view.buyAndHold.maximumDrawdown).length;
  const gates = {
    fullHistoryBreadth: positiveFullMarkets >= 4,
    fullHistoryDistribution: mean(annualizedExcesses) > 0 && median(annualizedExcesses) > 0 && Math.min(...annualizedExcesses) >= -0.01,
    chronologicalHalves: positiveHalfCells >= 7 && everyMarketPositiveHalf,
    commonCalendarAggregate: common.strategyTerminalWealth > common.buyAndHoldTerminalWealth,
    completeMarketYears: completeYearCells.length > 0 && completeYearRatio >= 0.60,
    adequateCycles: everyMarketHasCycle && marketsWithTwoCycles >= 4,
    drawdownBreadth: drawdownImprovedMarkets >= 3,
    deterministicIntegrity: deterministicIntegrityVerified === true,
  };
  return {
    pass: Object.values(gates).every(Boolean),
    status: Object.values(gates).every(Boolean) ? STATUS_PASS : STATUS_FAIL,
    gates,
    diagnostics: {
      positiveFullMarkets,
      meanFullAnnualizedLogExcess: mean(annualizedExcesses),
      medianFullAnnualizedLogExcess: median(annualizedExcesses),
      worstFullAnnualizedLogExcess: Math.min(...annualizedExcesses),
      positiveHalfCells,
      everyMarketPositiveHalf,
      positiveCompleteYearCells,
      completeYearCells: completeYearCells.length,
      completeYearPositiveRatio: completeYearRatio,
      everyMarketHasCycle,
      marketsWithTwoCycles,
      drawdownImprovedMarkets,
    },
  };
}

function evaluatePassGate(input) {
  if (!input || !Array.isArray(input.full) || !Array.isArray(input.halves) || !input.common || !Array.isArray(input.yearCells)) {
    throw new Error('invalid simplified walk-forward gate input');
  }
  const logExcessOf = row => Number.isFinite(row.logReturnExcess)
    ? row.logReturnExcess
    : Math.log(row.strategyTerminalWealth) - Math.log(row.buyHoldTerminalWealth == null ? row.buyAndHoldTerminalWealth : row.buyHoldTerminalWealth);
  const markets = input.full.map(full => ({
    market: full.market,
    full: {
      positiveExcess: logExcessOf(full) > 0,
      annualizedLogReturnExcess: full.annualizedLogExcess == null ? full.annualizedLogReturnExcess : full.annualizedLogExcess,
      strategy: {
        terminalWealth: full.strategyTerminalWealth,
        completedCashCycles: full.completedCashCycles,
        maximumDrawdown: full.strategyMaxDrawdown,
      },
      buyAndHold: {
        terminalWealth: full.buyHoldTerminalWealth == null ? full.buyAndHoldTerminalWealth : full.buyHoldTerminalWealth,
        maximumDrawdown: full.buyHoldMaxDrawdown == null ? full.buyAndHoldMaxDrawdown : full.buyHoldMaxDrawdown,
      },
    },
    halves: input.halves.filter(half => half.market === full.market).map(half => ({ positiveExcess: logExcessOf(half) > 0 })),
  }));
  const common = {
    strategyTerminalWealth: input.common.strategyTerminalWealth,
    buyAndHoldTerminalWealth: input.common.buyHoldTerminalWealth == null
      ? input.common.buyAndHoldTerminalWealth
      : input.common.buyHoldTerminalWealth,
  };
  const cells = input.yearCells.map(cell => ({ positiveExcess: logExcessOf(cell) > 0 }));
  return evaluateGate(markets, common, cells,
    input.deterministicIntegrityVerified === true || input.deterministicReplayVerified === true);
}

function fingerprintSelectionLedger(selectionLedger) {
  return fingerprint(selectionLedger);
}

function compactExecution(simulation) {
  return {
    startDate: simulation.startDate,
    endDate: simulation.endDate,
    cost: simulation.cost,
    finalPosition: simulation.finalPosition,
    pendingTerminalOrder: simulation.pendingTerminalOrder,
    signalBuys: simulation.signalBuys,
    signalSells: simulation.signalSells,
    filledBuys: simulation.filledBuys,
    filledSells: simulation.filledSells,
    fills: simulation.fills,
    completedCashCycles: simulation.completedCashCycles,
    events: simulation.events,
  };
}

function fingerprintAnalysis(results) {
  const payload = {
    schemaVersion: results.schemaVersion,
    status: results.status,
    frozenDesign: results.frozenDesign,
    protocol: results.protocol,
    input: { snapshotSha256: results.input && results.input.snapshotSha256 },
    firstEvaluationYear: results.firstEvaluationYear,
    lastEvaluationYear: results.lastEvaluationYear,
    selectionLedgerSha256: results.selectionLedgerSha256,
    selectionLedger: results.selectionLedger,
    markets: results.markets,
    common: results.common,
    completeYearCells: results.completeYearCells,
    gate: results.gate,
  };
  return fingerprint(payload);
}

function analyzeAlignedMarkets(markets, inputInfo = {}, options = {}) {
  const dependencies = assertDependenciesPinned();
  if (!Array.isArray(markets) || markets.length !== 5) throw new Error('schema-7 requires exactly five aligned markets');
  markets.forEach(validateAlignedMarket);
  const candidates = options.candidates || FROZEN_CANDIDATES;
  if (!options.allowSyntheticCandidates && (candidates.length !== 31 || candidates.some((candidate, index) => candidate.declarationOrder !== index))) {
    throw new Error('production schema-7 analysis requires the 31 frozen schema-6 candidates in declaration order');
  }
  const firstEvaluationYear = options.firstEvaluationYear || deriveFirstEvaluationYear(markets);
  const lastEvaluationYear = options.lastEvaluationYear || Math.max(...markets.map(market => isoYear(market.rows.at(-1).date)));
  const selectionLedger = buildSelectionLedger(markets, candidates, { ...options, firstEvaluationYear, lastEvaluationYear });
  const selectionLedgerSha256 = fingerprintSelectionLedger(selectionLedger);
  const simulations = markets.map(market => simulateWalkForward(market, selectionLedger, candidates, { firstEvaluationYear }));
  const marketResults = {};
  for (let index = 0; index < markets.length; index++) {
    const market = markets[index];
    const simulation = simulations[index];
    const rawTargetPrices = market.rawTargetPrices || market.rows.map(row => ({ date: row.date, close: row.close }));
    const views = buildEvaluationViews(simulation, rawTargetPrices);
    marketResults[market.key] = {
      market: market.key,
      targetId: market.targetId || market.key,
      annualization: simulation.annualization,
      execution: compactExecution(simulation),
      ...views,
    };
  }
  const common = buildCommonView(simulations);
  const completeYearCells = Object.values(marketResults).flatMap(result => result.completeYearCells);
  const gate = evaluateGate(marketResults, common, completeYearCells, options.deterministicIntegrityVerified === true);
  const results = {
    schemaVersion: SCHEMA_VERSION,
    purpose: 'pooled annual walk-forward Extreme Fear buy / Extreme Greed sell strategy versus matched buy-and-hold',
    interpretation: 'final retrospective falsification after schema 6; not prospective validation or investment advice',
    status: gate.status,
    frozenDesign: FROZEN_DESIGN,
    protocol: {
      marker: dependencies.protocol.marker,
      frozenAt: dependencies.protocol.frozenAt,
      protocolSha256: dependencies.schema7ProtocolSha256,
      runnerSha256: sha256File(__filename),
      schema6ProtocolSha256: dependencies.schema6ProtocolSha256,
      schema6RunnerSha256: dependencies.schema6RunnerSha256,
    },
    input: {
      snapshotPath: inputInfo.file || null,
      snapshotSha256: inputInfo.sha256 || REQUIRED_SNAPSHOT_SHA256,
      checksumVerified: inputInfo.checksumVerified === true,
      snapshotCreatedAt: inputInfo.snapshot && inputInfo.snapshot.createdAt || inputInfo.snapshotCreatedAt || null,
    },
    firstEvaluationYear,
    lastEvaluationYear,
    selectionLedgerSha256,
    selectionLedger,
    markets: marketResults,
    common,
    completeYearCells,
    gate,
  };
  results.analysisFingerprintSha256 = fingerprintAnalysis(results);
  return results;
}

function alignSnapshotMarkets(snapshot) {
  if (!snapshot || snapshot.schemaVersion !== schema5.SCHEMA_VERSION || !Array.isArray(snapshot.markets)) throw new Error('schema-7 accepts schema-5 snapshots only');
  if (snapshot.markets.map(market => market.key).join(',') !== EXPECTED_MARKET_ORDER.join(',')) throw new Error('frozen five-market order or set drifted');
  return snapshot.markets.map(market => {
    if (!Array.isArray(market.signals) || market.signals.length <= schema6.COMMON_WARMUP_ROWS) throw new Error(`${market.key}: insufficient candidate-common signals`);
    const firstDecisionDate = market.signals[schema6.COMMON_WARMUP_ROWS].date;
    const scoreMaps = new Map(FROZEN_CANDIDATES.map(candidate => [candidate.id, schema6.buildCandidateScoreMap(market, candidate)]));
    const rows = market.prices.rows
      .filter(row => row.date >= firstDecisionDate)
      .map(row => ({
        date: row.date,
        close: row.close,
        scores: Object.fromEntries(FROZEN_CANDIDATES.map(candidate => {
          const score = scoreMaps.get(candidate.id).get(row.date);
          return [candidate.id, Number.isFinite(score) ? score : null];
        })),
      }));
    if (!rows.length || rows[0].date !== firstDecisionDate) throw new Error(`${market.key}: candidate-common start is not an exact target close`);
    return {
      key: market.key,
      targetId: market.targetId,
      annualization: market.annualization,
      firstDecisionDate,
      rows,
      rawTargetPrices: market.prices.rows.map(row => ({ date: row.date, close: row.close })),
    };
  });
}

function analyzeSnapshot(snapshot, inputInfo = {}, options = {}) {
  if (!snapshot || snapshot.schemaVersion !== schema5.SCHEMA_VERSION) throw new Error(`expected schema-5 input, got ${snapshot && snapshot.schemaVersion}`);
  const aligned = alignSnapshotMarkets(snapshot);
  const results = analyzeAlignedMarkets(aligned, { ...inputInfo, snapshot }, options);
  if (results.firstEvaluationYear !== 2015) throw new Error(`frozen input first evaluation year drifted: expected 2015, got ${results.firstEvaluationYear}`);
  return results;
}

function pct(value, digits = 2) {
  return Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : 'n/a';
}

function wealth(value) {
  return Number.isFinite(value) ? value.toFixed(3) : 'n/a';
}

function markdownReport(results) {
  const lines = [];
  lines.push('# Schema 7 pooled annual walk-forward result', '');
  lines.push(`**Status: ${results.status}.**`, '');
  lines.push('This is a final retrospective falsification designed after schema 6 failed. It is not proof of future reliability or investment advice.', '');
  lines.push(`- Frozen schema-5 snapshot: \`${results.input.snapshotSha256}\``);
  lines.push(`- Schema-7 protocol: \`${results.protocol.protocolSha256}\``);
  lines.push(`- Pinned schema-6 runner: \`${results.protocol.schema6RunnerSha256}\``);
  lines.push(`- Annual selections: ${results.firstEvaluationYear}-${results.lastEvaluationYear}; stress one-way costs applied.`);
  lines.push(`- Selection-ledger hash: \`${results.selectionLedgerSha256}\``);
  lines.push(`- Analysis fingerprint: \`${results.analysisFingerprintSha256}\``, '');
  lines.push('## Annual pooled selections', '');
  lines.push('| Evaluation year | Eligible training markets | Selected candidate |');
  lines.push('| ---: | --- | --- |');
  for (const row of results.selectionLedger.years) lines.push(`| ${row.year} | ${row.eligibleMarkets.join(', ')} | ${row.winnerCandidateId} |`);
  lines.push('', '## Full continuous paths at stress cost', '');
  lines.push('| Market | Strategy | Buy & hold | Ann. log excess | Max-DD improvement | Exposure | Fills | Cash cycles |');
  lines.push('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const [key, market] of Object.entries(results.markets)) {
    const full = market.full;
    lines.push(`| ${key} | ${wealth(full.strategy.terminalWealth)} | ${wealth(full.buyAndHold.terminalWealth)} | ${pct(full.annualizedLogReturnExcess)} | ${pct(full.maximumDrawdownImprovement)} | ${pct(full.strategy.exposure)} | ${full.strategy.fills} | ${full.strategy.completedCashCycles} |`);
  }
  lines.push('', '## Frozen pass gate', '');
  for (const [name, passed] of Object.entries(results.gate.gates)) lines.push(`- ${passed ? 'PASS' : 'FAIL'}: ${name}`);
  lines.push('');
  lines.push(`Common equal-capital terminal wealth: strategy ${wealth(results.common.strategyTerminalWealth)} versus buy-and-hold ${wealth(results.common.buyAndHoldTerminalWealth)}.`);
  lines.push(`Complete market-year cells: ${results.gate.diagnostics.positiveCompleteYearCells}/${results.gate.diagnostics.completeYearCells} positive (${pct(results.gate.diagnostics.completeYearPositiveRatio)}).`);
  return lines.join('\n');
}

function runStamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

function writeWithSidecar(file, content) {
  fs.writeFileSync(file, content, 'utf8');
  const sha256 = sha256File(file);
  const checksumFile = `${file}.sha256`;
  fs.writeFileSync(checksumFile, `${sha256}  ${path.basename(file)}\n`, 'utf8');
  return { file: path.resolve(file), checksumFile: path.resolve(checksumFile), sha256 };
}

function writeResults(results, outDir, stamp = runStamp()) {
  fs.mkdirSync(outDir, { recursive: true });
  const selectionLedger = writeWithSidecar(
    path.join(outDir, `fear-greed-walk-forward-selection-ledger-${stamp}.json`),
    canonicalJson(results.selectionLedger),
  );
  if (selectionLedger.sha256 !== results.selectionLedgerSha256) throw new Error('written selection-ledger hash differs from frozen result hash');
  const json = writeWithSidecar(path.join(outDir, `fear-greed-walk-forward-${stamp}.json`), canonicalJson(results));
  const report = writeWithSidecar(path.join(outDir, `fear-greed-walk-forward-${stamp}.md`), `${markdownReport(results)}\n`);
  if (new Set([selectionLedger.checksumFile, json.checksumFile, report.checksumFile]).size !== 3) throw new Error('checksum sidecars are not distinct');
  return { selectionLedger, json, report };
}

function usage() {
  return 'node research/fear_greed_walk_forward.js [--snapshot <schema5-input.json>] [--out-dir <directory>]';
}

function parseArgs(argv) {
  const args = { snapshot: DEFAULT_SNAPSHOT_PATH, outDir: path.join(__dirname, 'local-artifacts', 'walk-forward') };
  for (let index = 0; index < argv.length; index++) {
    const token = argv[index];
    if (token === '--snapshot') args.snapshot = argv[++index];
    else if (token === '--out-dir') args.outDir = argv[++index];
    else if (token === '--help' || token === '-h') args.help = true;
    else throw new Error(`unknown argument: ${token}`);
  }
  if (!args.help && (!args.snapshot || !args.outDir)) throw new Error(usage());
  return args;
}

function withNetworkDisabled(callback) {
  if (typeof callback !== 'function') throw new Error('withNetworkDisabled requires a callback');
  const blocked = () => { throw new Error('schema-7 replay forbids all network access'); };
  const targets = [
    [global, 'fetch'],
    [global, 'WebSocket'],
    [http, 'request'], [http, 'get'],
    [https, 'request'], [https, 'get'],
    [http2, 'connect'],
    [net, 'connect'], [net, 'createConnection'],
    [net.Socket.prototype, 'connect'],
    [tls, 'connect'],
    [dgram, 'createSocket'],
    [dns, 'lookup'], [dns, 'resolve'], [dns, 'resolve4'], [dns, 'resolve6'], [dns, 'resolveAny'], [dns, 'reverse'],
  ];
  if (dns.promises) {
    for (const method of ['lookup', 'resolve', 'resolve4', 'resolve6', 'resolveAny', 'reverse']) targets.push([dns.promises, method]);
  }
  const originals = targets.map(([object, key]) => ({ object, key, hadOwn: Object.prototype.hasOwnProperty.call(object, key), value: object[key] }));
  for (const entry of originals) entry.object[entry.key] = blocked;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    for (const entry of originals.reverse()) {
      if (entry.hadOwn) entry.object[entry.key] = entry.value;
      else delete entry.object[entry.key];
    }
  };
  try {
    const result = callback();
    if (result && typeof result.then === 'function') return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

function verifyDeterministicResults(factory) {
  if (typeof factory !== 'function') throw new Error('deterministic replay verifier requires a result factory');
  const first = factory();
  const second = factory();
  const validHashes = result => {
    if (!result || typeof result !== 'object') return false;
    if (result.selectionLedger || result.selectionLedgerSha256) {
      if (!result.selectionLedger || result.selectionLedgerSha256 !== fingerprintSelectionLedger(result.selectionLedger)) return false;
    }
    if (result.schemaVersion === SCHEMA_VERSION) return result.analysisFingerprintSha256 === fingerprintAnalysis(result);
    if (result.analysisFingerprintSha256) {
      const core = { ...result };
      delete core.analysisFingerprintSha256;
      return result.analysisFingerprintSha256 === fingerprint(core);
    }
    return false;
  };
  if (!validHashes(first) || !validHashes(second) ||
      first.selectionLedgerSha256 !== second.selectionLedgerSha256 ||
      first.analysisFingerprintSha256 !== second.analysisFingerprintSha256 ||
      canonicalJson(first) !== canonicalJson(second)) {
    throw new Error('schema-7 deterministic replay verification failed');
  }
  return first;
}

function runStudy(args, runtime = {}) {
  return withNetworkDisabled(() => {
    assertDependenciesPinned();
    const snapshotPath = path.resolve(args.snapshot || DEFAULT_SNAPSHOT_PATH);
    const inputInfo = schema5.readSnapshot(snapshotPath);
    if (inputInfo.sha256 !== REQUIRED_SNAPSHOT_SHA256) throw new Error(`schema-7 requires snapshot ${REQUIRED_SNAPSHOT_SHA256}, got ${inputInfo.sha256}`);
    const results = verifyDeterministicResults(() => analyzeSnapshot(inputInfo.snapshot, inputInfo, { deterministicIntegrityVerified: true }));
    const outputs = writeResults(results, path.resolve(args.outDir), runtime.stamp || runStamp(runtime.now || new Date()));
    return {
      execution: { networkUsed: false, replay: true, deterministicReplayVerified: true },
      inputInfo,
      results,
      outputs,
    };
  });
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage()); return; }
  const completed = runStudy(args);
  console.log(JSON.stringify({
    status: completed.results.status,
    firstEvaluationYear: completed.results.firstEvaluationYear,
    lastEvaluationYear: completed.results.lastEvaluationYear,
    annualSelections: completed.results.selectionLedger.years.map(row => ({ year: row.year, candidateId: row.winnerCandidateId })),
    selectionLedgerSha256: completed.results.selectionLedgerSha256,
    analysisFingerprintSha256: completed.results.analysisFingerprintSha256,
    input: { file: completed.inputInfo.file, sha256: completed.inputInfo.sha256, checksumVerified: completed.inputInfo.checksumVerified },
    outputs: completed.outputs,
  }, null, 2));
}

module.exports = {
  SCHEMA_VERSION,
  PROTOCOL_PATH,
  SCHEMA6_RUNNER_PATH,
  REQUIRED_PROTOCOL_MARKER,
  REQUIRED_PROTOCOL_FREEZE_AT,
  REQUIRED_PROTOCOL_SHA256,
  REQUIRED_SCHEMA6_PROTOCOL_SHA256,
  REQUIRED_SCHEMA6_RUNNER_SHA256,
  REQUIRED_SNAPSHOT_SHA256,
  DEFAULT_SNAPSHOT_PATH,
  YEAR_DAYS,
  STATUS_PASS,
  STATUS_FAIL,
  EXPECTED_MARKET_ORDER,
  MARKET_COSTS,
  FROZEN_CANDIDATES,
  FROZEN_DESIGN,
  sha256Buffer,
  sha256File,
  canonicalize,
  canonicalJson,
  fingerprint,
  parseProtocolState,
  assertProtocolFrozen,
  assertDependenciesPinned,
  isoYear,
  yearStart,
  yearEnd,
  mean,
  median,
  trainingEligibilityDate,
  isMarketTrainingEligible,
  deriveTrainingEligibleMarkets,
  eligibleMarketsForYear,
  deriveFirstEvaluationYear,
  trainingWindowRows,
  trainingRowsForYear,
  evaluateTrainingCandidate,
  trainingCandidateComparator,
  rankTrainingCandidates,
  annualCandidateLedger,
  selectAnnualWinner,
  buildSelectionLedger,
  selectionByYear,
  queueAtClose,
  simulateWalkForward,
  viewFromIntervalRange,
  buildFullView,
  buildChronologicalHalves,
  commonCalendarBounds,
  dateBoundView,
  buildCommonView,
  buildCompleteYearCells,
  buildCompleteMarketYearCells,
  buildEvaluationViews,
  evaluateGate,
  evaluatePassGate,
  fingerprintSelectionLedger,
  fingerprintAnalysis,
  alignSnapshotMarkets,
  analyzeAlignedMarkets,
  analyzeSnapshot,
  markdownReport,
  runStamp,
  writeWithSidecar,
  writeResults,
  usage,
  parseArgs,
  withNetworkDisabled,
  verifyDeterministicResults,
  runStudy,
  main,
};

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  }
}
