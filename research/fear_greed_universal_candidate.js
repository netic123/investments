'use strict';

// Research-only universal candidate search. The final 20% of every market is
// sealed by identity and boundary only; this runner never evaluates it.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const v3 = require('./fear_greed_v3_shadow');
const overlay = require('./fear_greed_core_overlay');

const ROOT = path.resolve(__dirname, '..');
const TEST_PATH = path.join(ROOT, 'test', 'fear_greed_universal_candidate.test.js');
const INPUT_SHA256 = 'ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d';
const COST = 0.005;
const BORROW_RATE = 0.05;
const CASH_RATE = 0;
const DAY_COUNT = 365.2425;
const SPLIT = Object.freeze({ train: 0.60, development: 0.20, finalSealed: 0.20 });

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non-finite canonical value');
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function buildCandidateGrid() {
  const candidates = [];
  for (const trendBars of [100, 200]) {
    for (const bearExposure of [0, 0.5]) {
      candidates.push({ family: 'trend', trendBars, bearExposure, volatilityLookback: null, targetVolatility: null, crashFilter: 'none' });
      for (const volatilityLookback of [20, 63]) {
        for (const targetVolatility of [0.10, 0.15]) {
          candidates.push({ family: 'trend_vol', trendBars, bearExposure, volatilityLookback, targetVolatility, crashFilter: 'none' });
        }
      }
      for (const crashFilter of ['drawdown_15', 'participation_50']) {
        candidates.push({
          family: 'trend_vol_crash', trendBars, bearExposure,
          volatilityLookback: 63, targetVolatility: 0.15, crashFilter,
          crashExposureCap: 0.25,
        });
      }
    }
  }
  return candidates.map((candidate, index) => Object.freeze({
    id: `U${String(index + 1).padStart(2, '0')}`,
    maximumExposure: 1.5,
    ...candidate,
  }));
}

const CANDIDATES = Object.freeze(buildCandidateGrid());
const DESIGN = Object.freeze({
  status: 'RETROSPECTIVE_DEVELOPMENT_ONLY_FINAL_HOLDOUT_SEALED_NOT_EVALUATED',
  candidateCount: CANDIDATES.length,
  candidates: CANDIDATES,
  universalParameters: true,
  decisionTiming: 'features at completed close t; rebalance at next target close',
  financing: { oneWayCost: COST, negativeCashAnnualRate: BORROW_RATE, positiveCashAnnualRate: CASH_RATE },
  split: SPLIT,
  objective: [
    'maximize minimum annualized log-return excess versus same-start buy-and-hold across 5 markets x train/development',
    'then maximize equal-cell mean annualized log-return excess',
    'then minimize equal-cell mean traded-notional turnover',
    'then declaration order',
  ],
  finalPolicy: 'no candidate performance, benchmark performance, ranking, pass/fail, or wealth is computed on final rows',
});

function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function sampleStd(values) {
  if (values.length < 2) return null;
  const average = mean(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1));
}

function validatePrices(rows, marketKey) {
  if (!Array.isArray(rows) || rows.length < 300) throw new Error(`${marketKey}: insufficient prices`);
  for (let index = 0; index < rows.length; index++) {
    if (!rows[index] || !(Number(rows[index].close) > 0) ||
        (index && rows[index].date <= rows[index - 1].date)) throw new Error(`${marketKey}: invalid price row`);
  }
  return rows;
}

function realizedVolatility(prices, index, lookback, annualization) {
  if (index < lookback) return null;
  const values = [];
  for (let cursor = index - lookback + 1; cursor <= index; cursor++) {
    values.push(Math.log(prices[cursor].close / prices[cursor - 1].close));
  }
  const daily = sampleStd(values);
  return daily > 0 ? daily * Math.sqrt(annualization) : null;
}

function buildStates(snapshotMarket, shadowMarket) {
  const prices = validatePrices(snapshotMarket.prices.rows, snapshotMarket.key);
  const shadow = new Map(shadowMarket.history.map(row => [row.date, row]));
  const states = [];
  for (let index = 251; index < prices.length; index++) {
    const row = shadow.get(prices[index].date);
    if (!row) continue;
    const vol20 = realizedVolatility(prices, index, 20, snapshotMarket.annualization);
    const vol63 = realizedVolatility(prices, index, 63, snapshotMarket.annualization);
    const sma100 = mean(prices.slice(index - 99, index + 1).map(item => item.close));
    const sma200 = mean(prices.slice(index - 199, index + 1).map(item => item.close));
    const high252 = Math.max(...prices.slice(index - 251, index + 1).map(item => item.close));
    const participation = row.components && row.components.breadth && row.components.breadth.raw;
    if (!(vol20 > 0) || !(vol63 > 0) || !Number.isFinite(participation)) continue;
    states.push({
      date: prices[index].date,
      priceIndex: index,
      close: prices[index].close,
      sma100,
      sma200,
      vol20,
      vol63,
      drawdown252: prices[index].close / high252 - 1,
      participation,
    });
  }
  if (states.length < 300) throw new Error(`${snapshotMarket.key}: insufficient eligible states`);
  return states;
}

function exposureFor(candidate, state) {
  const sma = candidate.trendBars === 100 ? state.sma100 : state.sma200;
  let exposure = state.close > sma ? 1 : candidate.bearExposure;
  if (candidate.targetVolatility != null) {
    const volatility = candidate.volatilityLookback === 20 ? state.vol20 : state.vol63;
    exposure *= candidate.targetVolatility / volatility;
  }
  exposure = Math.max(0, Math.min(candidate.maximumExposure, exposure));
  const crash = candidate.crashFilter === 'drawdown_15' && state.drawdown252 <= -0.15 ||
    candidate.crashFilter === 'participation_50' && state.participation < 0.5;
  if (crash) exposure = Math.min(exposure, candidate.crashExposureCap);
  return exposure;
}

function splitStates(states) {
  const trainEnd = Math.floor(states.length * SPLIT.train);
  const developmentEnd = Math.floor(states.length * (SPLIT.train + SPLIT.development));
  if (!(trainEnd > 1 && developmentEnd > trainEnd && developmentEnd < states.length)) throw new Error('invalid split');
  return {
    train: { start: 0, end: trainEnd },
    development: { start: trainEnd, end: developmentEnd },
    final: { start: developmentEnd, end: states.length },
  };
}

function segmentPrices(prices, states, segment, followingSegment) {
  const startPriceIndex = states[segment.start].priceIndex;
  const endPriceIndex = followingSegment
    ? states[followingSegment.start].priceIndex - 1
    : states[segment.end - 1].priceIndex;
  if (endPriceIndex <= startPriceIndex) throw new Error('segment has fewer than two target closes');
  return { rows: prices.slice(startPriceIndex, endPriceIndex + 1), startPriceIndex, endPriceIndex };
}

function simulateCandidate(prices, stateMap, candidate, cost = COST) {
  let units = 1 / prices[0].close;
  let cash = 0;
  let wealth = 1;
  let pending = stateMap.has(prices[0].date) ? exposureFor(candidate, stateMap.get(prices[0].date)) : null;
  let tradedNotional = 0;
  let bankrupt = false;
  for (let index = 0; index < prices.length - 1; index++) {
    const start = prices[index];
    const end = prices[index + 1];
    const days = (Date.parse(`${end.date}T00:00:00Z`) - Date.parse(`${start.date}T00:00:00Z`)) / 86400000;
    cash *= Math.exp((cash < 0 ? BORROW_RATE : CASH_RATE) * days / DAY_COUNT);
    const risky = units * end.close;
    wealth = risky + cash;
    if (!(wealth > 0) || !Number.isFinite(wealth)) { bankrupt = true; wealth = 0; break; }
    if (pending != null) {
      const fill = overlay.exactRebalance({ wealth, riskyNotional: risky, targetExposure: pending, cost });
      wealth = fill.postWealth;
      units = fill.postRisky / end.close;
      cash = fill.postCash;
      tradedNotional += fill.tradedNotional;
    }
    pending = stateMap.has(end.date) ? exposureFor(candidate, stateMap.get(end.date)) : null;
  }
  const years = (Date.parse(`${prices.at(-1).date}T00:00:00Z`) - Date.parse(`${prices[0].date}T00:00:00Z`)) / (DAY_COUNT * 86400000);
  const buyAndHold = prices.at(-1).close / prices[0].close;
  return {
    startDate: prices[0].date,
    endDate: prices.at(-1).date,
    terminalWealth: wealth,
    buyAndHoldTerminalWealth: buyAndHold,
    annualizedLogExcess: !bankrupt && years > 0 ? Math.log(wealth / buyAndHold) / years : -Infinity,
    tradedNotional,
    bankrupt,
  };
}

function evaluateDevelopment(snapshot, shadowAnalysis) {
  const prepared = {};
  const sealMarkets = {};
  for (const snapshotMarket of snapshot.markets) {
    const shadowMarket = shadowAnalysis.markets.find(item => item.key === snapshotMarket.key);
    const states = buildStates(snapshotMarket, shadowMarket);
    const split = splitStates(states);
    const trainPrices = segmentPrices(snapshotMarket.prices.rows, states, split.train, split.development);
    const developmentPrices = segmentPrices(snapshotMarket.prices.rows, states, split.development, split.final);
    prepared[snapshotMarket.key] = { market: snapshotMarket, states, split, trainPrices, developmentPrices };
    const finalStates = states.slice(split.final.start, split.final.end);
    const finalPriceRows = snapshotMarket.prices.rows.slice(finalStates[0].priceIndex);
    sealMarkets[snapshotMarket.key] = {
      eligibleRows: states.length,
      train: { count: split.train.end, firstDate: states[0].date, lastDate: states[split.train.end - 1].date },
      development: { count: split.development.end - split.development.start, firstDate: states[split.development.start].date, lastDate: states[split.development.end - 1].date },
      final: {
        count: split.final.end - split.final.start,
        firstDecisionDate: finalStates[0].date,
        lastDecisionDate: finalStates.at(-1).date,
        firstTargetPriceIndex: finalStates[0].priceIndex,
        targetPriceSliceSha256: sha256(canonicalJson(finalPriceRows)),
        status: 'SEALED_NOT_EVALUATED',
      },
    };
  }

  const ledger = CANDIDATES.map(candidate => {
    const cells = [];
    const markets = {};
    for (const key of v3.MARKET_KEYS) {
      const item = prepared[key];
      const stateMap = new Map(item.states.map(state => [state.date, state]));
      const train = simulateCandidate(item.trainPrices.rows, stateMap, candidate);
      const development = simulateCandidate(item.developmentPrices.rows, stateMap, candidate);
      markets[key] = { train, development };
      cells.push(train, development);
    }
    const excesses = cells.map(cell => cell.annualizedLogExcess);
    return {
      candidate,
      objective: {
        worstCellAnnualizedLogExcess: Math.min(...excesses),
        equalCellMeanAnnualizedLogExcess: mean(excesses),
        equalCellMeanTradedNotional: mean(cells.map(cell => cell.tradedNotional)),
        anyBankruptcy: cells.some(cell => cell.bankrupt),
      },
      markets,
    };
  });
  ledger.sort((left, right) =>
    Number(left.objective.anyBankruptcy) - Number(right.objective.anyBankruptcy) ||
    right.objective.worstCellAnnualizedLogExcess - left.objective.worstCellAnnualizedLogExcess ||
    right.objective.equalCellMeanAnnualizedLogExcess - left.objective.equalCellMeanAnnualizedLogExcess ||
    left.objective.equalCellMeanTradedNotional - right.objective.equalCellMeanTradedNotional ||
    left.candidate.id.localeCompare(right.candidate.id));

  const holdoutSeal = {
    inputSnapshotSha256: INPUT_SHA256,
    candidateGridSha256: sha256(canonicalJson(CANDIDATES)),
    splitRule: SPLIT,
    markets: sealMarkets,
    prohibition: 'No final performance or ranking was computed by this runner.',
  };
  holdoutSeal.sealSha256 = sha256(canonicalJson(holdoutSeal));
  return { selected: ledger[0], topFive: ledger.slice(0, 5), holdoutSeal };
}

function run() {
  const input = v3.readFrozenDevelopmentSnapshot();
  if (input.sha256 !== INPUT_SHA256) throw new Error('frozen input identity drifted');
  const shadow = v3.analyzeSnapshot(input.snapshot);
  const evidence = evaluateDevelopment(input.snapshot, shadow);
  return {
    status: DESIGN.status,
    interpretation: 'Candidate selection on repeatedly viewed retrospective history; not confirmation and not approved for live use.',
    design: DESIGN,
    identities: {
      runnerSha256: sha256(fs.readFileSync(__filename)),
      testSha256: fs.existsSync(TEST_PATH) ? sha256(fs.readFileSync(TEST_PATH)) : null,
      inputSnapshotSha256: input.sha256,
      v3ModelId: v3.MODEL_ID,
    },
    selectedDevelopmentCandidate: evidence.selected,
    topFiveDevelopmentCandidates: evidence.topFive.map(row => ({ candidate: row.candidate, objective: row.objective })),
    holdoutSeal: evidence.holdoutSeal,
    finalHoldoutResults: 'INTENTIONALLY_NOT_COMPUTED',
  };
}

module.exports = {
  INPUT_SHA256, COST, BORROW_RATE, CASH_RATE, SPLIT, CANDIDATES, DESIGN,
  canonicalize, canonicalJson, sha256, buildCandidateGrid, realizedVolatility,
  buildStates, exposureFor, splitStates, segmentPrices, simulateCandidate,
  evaluateDevelopment, run,
};

if (require.main === module) {
  try {
    console.log(JSON.stringify(run(), null, 2));
  } catch (error) {
    console.error(error && error.stack || error);
    process.exitCode = 1;
  }
}
