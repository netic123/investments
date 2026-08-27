'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const v3 = require('./fear_greed_v3_shadow');
const math = require('./fear_greed_model_search');
const overlay = require('./fear_greed_core_overlay');

const SCHEMA_VERSION = 11;
const STATUS = 'RETROSPECTIVE_DEVELOPMENT_ONLY_NO_CONFIRMATORY_OUTCOME';
const CANDIDATE_ID = 'v3_shadow';
const INITIAL_SEED = 252;
const PRIMARY_HORIZON = 21;
const MIN_MSE_IMPROVEMENT = 0.005;
const MIN_SIGN_FRACTION = 0.70;
const ALPHA = 0.05;
const PRIMARY_COST = 0.005;
const DOUBLE_COST = 0.010;
const MARKET_KEYS = Object.freeze(['crypto', 'sweden', 'usa', 'europe', 'global']);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function displayedInteger(score) {
  if (!Number.isFinite(score)) return null;
  return Math.round(Math.round(score * 10) / 10);
}

function buildForecastRows(market, scoreHistory) {
  const prices = market.prices.rows;
  const priceIndex = new Map(prices.map((row, index) => [row.date, index]));
  const rows = [];
  const audit = { scores: scoreHistory.length, missingExactPriceDate: 0, missingControls: 0, incompleteOutcome: 0, eligible: 0 };
  for (const signal of scoreHistory) {
    const signalIndex = priceIndex.get(signal.date);
    if (signalIndex == null) { audit.missingExactPriceDate++; continue; }
    const controls = math.computeControls(prices, signalIndex, market.annualization);
    if (!controls || math.CONTROL_FEATURES.some(key => !Number.isFinite(controls[key]))) { audit.missingControls++; continue; }
    const entryIndex = signalIndex + 1;
    const exitIndex = entryIndex + PRIMARY_HORIZON;
    if (exitIndex >= prices.length) { audit.incompleteOutcome++; continue; }
    rows.push({
      signalDate: signal.date,
      signalIndex,
      entryIndex,
      exitIndex,
      entryDate: prices[entryIndex].date,
      exitDate: prices[exitIndex].date,
      controls,
      candidateScores: { [CANDIDATE_ID]: signal.exactScore },
      forwardReturn: prices[exitIndex].close / prices[entryIndex].close - 1,
    });
  }
  audit.eligible = rows.length;
  return { rows, audit };
}

function developmentSegment(rows) {
  if (rows.length <= INITIAL_SEED) throw new Error(`only ${rows.length} rows; more than ${INITIAL_SEED} required`);
  return {
    start: INITIAL_SEED,
    end: rows.length,
    count: rows.length - INITIAL_SEED,
    firstDate: rows[INITIAL_SEED].signalDate,
    lastDate: rows.at(-1).signalDate,
  };
}

function holmAdjust(entries) {
  const sorted = entries.map((entry, index) => ({ ...entry, index })).sort((a, b) => a.pValue - b.pValue || a.index - b.index);
  let running = 0;
  for (let rank = 0; rank < sorted.length; rank++) {
    const raw = Math.min(1, (sorted.length - rank) * sorted[rank].pValue);
    running = Math.max(running, raw);
    sorted[rank].adjustedPValue = running;
  }
  return sorted.sort((a, b) => a.index - b.index).map(({ index, ...entry }) => entry);
}

function compactForecast(forecast) {
  if (!forecast || !forecast.ok) return forecast;
  return {
    ok: true,
    forecastRows: forecast.forecastRows,
    mseControls: forecast.mseControls,
    mseControlsPlusScore: forecast.mseControlsPlusScore,
    relativeMseImprovementVsControls: forecast.relativeMseImprovementVsControls,
    coefficientSigns: math.coefficientSignSummary(forecast.blocks),
    blocks: forecast.blocks,
  };
}

function forecastMarket(market, scoreMarket) {
  const built = buildForecastRows(market, scoreMarket.history);
  const segment = developmentSegment(built.rows);
  const adequacy = math.assessSegmentAdequacy(built.rows, segment, math.DATA_ADEQUACY_MINIMUMS);
  const forecast = math.walkForwardForecast(built.rows, segment, CANDIDATE_ID, 'forwardReturn');
  if (!forecast.ok) return { key: market.key, audit: built.audit, segment, adequacy, forecast };
  const adjustedLosses = forecast.predictions.map(row =>
    row.controlsSquaredError - row.fullSquaredError + (row.controlsPrediction - row.fullPrediction) ** 2);
  const clarkWest = math.neweyWestMeanTest(adjustedLosses, PRIMARY_HORIZON);
  return { key: market.key, audit: built.audit, segment, adequacy, forecast: compactForecast(forecast), clarkWest };
}

function compactRun(run) {
  return {
    terminalStrategy: run.strategy.terminalWealth,
    terminalBuyAndHold: run.buyAndHold.terminalWealth,
    terminalWealthRatio: run.terminalWealthRatio,
    annualizedLogReturnExcess: run.annualizedLogReturnExcess,
    maximumDrawdownStrategy: run.strategy.maximumDrawdown,
    maximumDrawdownBuyAndHold: run.buyAndHold.maximumDrawdown,
    bankrupt: run.strategy.bankrupt,
    fillCount: run.strategy.fillCount,
    fearFills: run.strategy.filledFearTargets,
    greedFills: run.strategy.filledGreedTargets,
  };
}

function economicMarket(market, scoreMarket) {
  const signals = scoreMarket.history.map(row => ({ date: row.date, publishedScore: displayedInteger(row.exactScore) }));
  const prepared = overlay.prepareMarket({ ...market, signals });
  const primary = overlay.runWindow({ prices: prepared.fullPrices, scoreMap: prepared.scoreMap, annualization: market.annualization, cost: PRIMARY_COST });
  const doubled = overlay.runWindow({ prices: prepared.fullPrices, scoreMap: prepared.scoreMap, annualization: market.annualization, cost: DOUBLE_COST });
  const halves = overlay.splitPriceWindows(prepared.fullPrices).map(prices => compactRun(overlay.runWindow({ prices, scoreMap: prepared.scoreMap, annualization: market.annualization, cost: PRIMARY_COST })));
  return { prepared, result: { key: market.key, startDate: prepared.fullPrices[0].date, endDate: prepared.fullPrices.at(-1).date, primary: compactRun(primary), doubleCost: compactRun(doubled), halves } };
}

function compactCommon(common) {
  return {
    startDate: common.startDate,
    endDate: common.endDate,
    commonDateCount: common.commonDateCount,
    terminalStrategy: common.strategy.terminalWealth,
    terminalBuyAndHold: common.buyAndHold.terminalWealth,
    terminalWealthRatio: common.terminalWealthRatio,
    annualizedLogReturnExcess: common.annualizedLogReturnExcess,
  };
}

function analyze() {
  const input = v3.readFrozenDevelopmentSnapshot();
  const shadow = v3.analyzeSnapshot(input.snapshot);
  const byMarket = new Map(input.snapshot.markets.map(market => [market.key, market]));
  const scoreByMarket = new Map(shadow.markets.map(market => [market.key, market]));

  const forecasts = MARKET_KEYS.map(key => forecastMarket(byMarket.get(key), scoreByMarket.get(key)));
  const adjusted = holmAdjust(forecasts.map(row => ({ key: row.key, pValue: row.clarkWest && row.clarkWest.pValueOneSidedPositive })));
  const adjustedByKey = new Map(adjusted.map(row => [row.key, row.adjustedPValue]));
  for (const row of forecasts) row.clarkWestHolmPValue = adjustedByKey.get(row.key);
  const allPositive = forecasts.every(row => row.forecast.ok && row.forecast.coefficientSigns.positiveFraction >= MIN_SIGN_FRACTION);
  const allNegative = forecasts.every(row => row.forecast.ok && row.forecast.coefficientSigns.negativeFraction >= MIN_SIGN_FRACTION);
  const commonSign = allPositive ? 'positive' : allNegative ? 'negative' : null;
  const forecastGates = {
    adequateFiveOfFive: forecasts.every(row => row.adequacy.pass),
    mseImprovementFiveOfFive: forecasts.every(row => row.forecast.ok && row.forecast.relativeMseImprovementVsControls >= MIN_MSE_IMPROVEMENT),
    commonCoefficientSignFiveOfFive: commonSign != null,
    clarkWestHolmFiveOfFive: forecasts.every(row => Number.isFinite(row.clarkWestHolmPValue) && row.clarkWestHolmPValue < ALPHA),
  };
  forecastGates.pass = Object.values(forecastGates).every(Boolean);

  const economicRows = MARKET_KEYS.map(key => economicMarket(byMarket.get(key), scoreByMarket.get(key)));
  const common = compactCommon(overlay.aggregateCommonCalendar(economicRows.map(row => row.prepared)));
  const economics = economicRows.map(row => row.result);
  const economicGates = {
    primaryFiveOfFive: economics.every(row => row.primary.terminalStrategy > row.primary.terminalBuyAndHold && row.primary.annualizedLogReturnExcess > 0),
    doubleCostFiveOfFive: economics.every(row => row.doubleCost.terminalStrategy > row.doubleCost.terminalBuyAndHold && row.doubleCost.annualizedLogReturnExcess > 0),
    positiveCommonCalendar: common.terminalStrategy > common.terminalBuyAndHold && common.annualizedLogReturnExcess > 0,
    noBankruptcy: economics.every(row => !row.primary.bankrupt && !row.doubleCost.bankrupt),
  };
  economicGates.pass = Object.values(economicGates).every(Boolean);

  const result = {
    schemaVersion: SCHEMA_VERSION,
    status: STATUS,
    modelId: v3.MODEL_ID,
    inputSha256: input.sha256,
    warning: 'All outcomes are reused retrospective development evidence; no historical validation or reliability claim is allowed.',
    forecast: { commonSign, gates: forecastGates, markets: forecasts },
    economic: { policy: 'display-label 50/100/150 contrarian overlay', primaryCost: PRIMARY_COST, doubleCost: DOUBLE_COST, gates: economicGates, markets: economics, common },
    conclusion: forecastGates.pass && economicGates.pass ? 'RETROSPECTIVE_SCREEN_PASS_NOT_CONFIRMATION' : 'FAIL_NOT_A_COMMON_VALIDATED_PREDICTOR_OR_BUY_AND_HOLD_WINNER',
  };
  result.analysisFingerprint = sha256(JSON.stringify(result));
  return result;
}

function markdown(result) {
  const lines = ['# V3 shadow frozen evaluation', '', `Conclusion: **${result.conclusion}**`, '', result.warning, '', '## Incremental 21-bar forecast', '', '| Market | Rows | MSE improvement | Coefficient sign | CW p | Holm p | Adequacy |', '|---|---:|---:|---|---:|---:|:---:|'];
  for (const row of result.forecast.markets) {
    const f = row.forecast;
    const signs = f.ok ? f.coefficientSigns : null;
    lines.push(`| ${row.key} | ${f.forecastRows || 0} | ${f.ok ? (100 * f.relativeMseImprovementVsControls).toFixed(2) + '%' : '—'} | ${signs && signs.dominantSign || '—'} ${signs ? (100 * signs.dominantFraction).toFixed(1) + '%' : ''} | ${row.clarkWest && Number.isFinite(row.clarkWest.pValueOneSidedPositive) ? row.clarkWest.pValueOneSidedPositive.toFixed(4) : '—'} | ${Number.isFinite(row.clarkWestHolmPValue) ? row.clarkWestHolmPValue.toFixed(4) : '—'} | ${row.adequacy.pass ? 'PASS' : 'FAIL'} |`);
  }
  lines.push('', `Forecast gate: **${result.forecast.gates.pass ? 'PASS' : 'FAIL'}**.`, '', '## Fixed 50/100/150 overlay versus buy-and-hold', '', '| Market | Overlay | B&H | Ratio | Net log-return excess | Double-cost ratio | Result |', '|---|---:|---:|---:|---:|---:|:---:|');
  for (const row of result.economic.markets) {
    const pass = row.primary.terminalStrategy > row.primary.terminalBuyAndHold && row.primary.annualizedLogReturnExcess > 0;
    lines.push(`| ${row.key} | ${row.primary.terminalStrategy.toFixed(3)} | ${row.primary.terminalBuyAndHold.toFixed(3)} | ${row.primary.terminalWealthRatio.toFixed(3)} | ${(100 * row.primary.annualizedLogReturnExcess).toFixed(2)}% | ${row.doubleCost.terminalWealthRatio.toFixed(3)} | ${pass ? 'PASS' : 'FAIL'} |`);
  }
  lines.push('', `Common calendar ${result.economic.common.startDate} to ${result.economic.common.endDate}: overlay ${result.economic.common.terminalStrategy.toFixed(3)}, B&H ${result.economic.common.terminalBuyAndHold.toFixed(3)}, ratio ${result.economic.common.terminalWealthRatio.toFixed(3)}.`, '', `Economic gate: **${result.economic.gates.pass ? 'PASS' : 'FAIL'}**.`, '', 'The live dashboard was not changed.');
  return `${lines.join('\n')}\n`;
}

function main() {
  const result = analyze();
  const outDir = path.join(__dirname, 'local-artifacts', 'v3-evaluation-final');
  fs.mkdirSync(outDir, { recursive: true });
  const jsonFile = path.join(outDir, 'fear-greed-v3-evaluation.json');
  const mdFile = path.join(outDir, 'fear-greed-v3-evaluation.md');
  fs.writeFileSync(jsonFile, `${JSON.stringify(result, null, 2)}\n`);
  fs.writeFileSync(mdFile, markdown(result));
  console.log(markdown(result));
  console.log(`Fingerprint: ${result.analysisFingerprint}`);
}

module.exports = { SCHEMA_VERSION, STATUS, displayedInteger, buildForecastRows, developmentSegment, holmAdjust, compactRun, analyze, markdown };

if (require.main === module) {
  try { main(); }
  catch (error) { console.error(error && error.stack || error); process.exitCode = 1; }
}
