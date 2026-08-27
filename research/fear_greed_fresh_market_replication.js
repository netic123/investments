'use strict';

// One-shot fresh-market replication of the frozen Europe contrarian rule.
// Protocol (frozen and committed pre-outcome):
// FEAR_GREED_FRESH_MARKET_REPLICATION_PROTOCOL.md. Refuses to run unless the
// protocol is committed clean at HEAD, and refuses to run twice (stop rule).
// Run: node research/fear_greed_fresh_market_replication.js

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const marketfg = require('../marketfg.js');
const model = require('./fear_greed_extremes_retro_model.js');
const bat = require('./fear_greed_extended_battery.js');
const s9 = require('./fear_greed_core_overlay.js');
const v2 = require('./five_market_proxy_data_v2.js');
const base = require('./five_market_proxy_data.js');

const PROTOCOL = path.join(__dirname, 'FEAR_GREED_FRESH_MARKET_REPLICATION_PROTOCOL.md');
const RESULT_PATH = path.join(__dirname, 'FRESH_MARKET_REPLICATION_RESULT_2026-08-28.json');
const FEAR = 35, GREED = 85, BASE_COST = 0.001, STRESS_COST = 0.0025, WARMUP_ROWS = 20;

// germany was removed by the documented PRE-OUTCOME supersession (EWGS history is
// unavailable from Yahoo's max-range endpoint); see the protocol's freeze marker.
const MARKETS = {
  japan: { name: 'Japan', symbols: { index: 'EWJ', vol: null, bond: 'IEF', hy: 'HYG', ig: 'LQD', small: 'SCJ', large: null } },
  uk: { name: 'United Kingdom', symbols: { index: 'EWU', vol: null, bond: 'IEF', hy: 'HYG', ig: 'LQD', small: 'EWUS', large: null } },
  em: { name: 'Emerging Markets', symbols: { index: 'EEM', vol: null, bond: 'IEF', hy: 'HYG', ig: 'LQD', small: 'EEMS', large: null } },
};

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function assertProtocolCommittedClean() {
  const text = fs.readFileSync(PROTOCOL, 'utf8');
  if (!text.includes('FRESH-MARKET-REPLICATION-FROZEN 2026-08-28')) throw new Error('protocol freeze marker missing');
  const status = execFileSync('git', ['status', '--porcelain', '--', PROTOCOL], { cwd: __dirname, encoding: 'utf8' }).trim();
  if (status) throw new Error('protocol has uncommitted changes; the freeze must be on record before the run');
}

async function fetchPrices(symbol) {
  const now = Math.floor(Date.now() / 1000) + 86400;
  let lastError;
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const response = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?period1=0&period2=${now}&interval=1d`,
        { headers: { 'user-agent': 'netic123-investments-research/1.0' }, signal: AbortSignal.timeout(30000) });
      const json = await response.json();
      const result = json.chart && json.chart.result && json.chart.result[0];
      if (!result) throw new Error('no chart result');
      const timezone = result.meta.exchangeTimezoneName;
      const quote = result.indicators.quote[0];
      const adj = result.indicators.adjclose && result.indicators.adjclose[0];
      const rows = [];
      for (let i = 0; i < result.timestamp.length; i++) {
        const close = adj && adj.adjclose[i] > 0 ? adj.adjclose[i] : quote.close[i];
        if (!(close > 0)) continue;
        rows.push({ date: new Date(result.timestamp[i] * 1000).toLocaleDateString('sv-SE', { timeZone: timezone }), close });
      }
      return [...new Map(rows.map(row => [row.date, row])).values()].sort((a, b) => (a.date < b.date ? -1 : 1));
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

function loadCashFactor() {
  const raw = v2.readExact(v2.PATHS.fredRaw, v2.EXPECTED.fredRaw);
  const wealth = new Map(base.buildDailyCashWealth(v2.parseFredCsv(raw.bytes), '2026-08-24', 7).rows.map(r => [r.date, r.value]));
  return (d0, d1) => { const a = wealth.get(d0), b = wealth.get(d1); return a > 0 && b > 0 ? b / a : 1; };
}

function evaluateMarket(key, scoreHistory, prices, cashFactor) {
  const signals = scoreHistory.filter(row => Number.isFinite(row.score));
  if (signals.length < WARMUP_ROWS + 260) throw new Error(`${key}: too few score observations (${signals.length})`);
  const startDate = signals[WARMUP_ROWS].date;
  const bars = prices.filter(row => row.date >= startDate && row.date <= signals[signals.length - 1].date);
  const dates = signals.map(row => row.date);
  const values = signals.map(row => row.score);
  const carried = bat.carryOntoCalendar(bars, dates, values, 7);
  const spec = { fear: FEAR, greed: GREED, cadence: 'me' };
  const positions = model.buildPositions(carried, bars, spec);
  const benchmark = bars[bars.length - 1].close / bars[0].close;
  const run = cost => model.simulateWithCash(bars, positions, cost, cashFactor);
  const baseRun = run(BASE_COST);
  const stressRun = run(STRESS_COST);
  const offsets = s9.deterministicShiftOffsets(values.length, 99);
  const shifted = offsets.map(offset => {
    const rotated = bat.carryOntoCalendar(bars, dates, bat.rotate(values, offset), 7);
    return model.simulateWithCash(bars, model.buildPositions(rotated, bars, spec), BASE_COST, cashFactor).terminalWealth / benchmark;
  });
  const actualRatio = baseRun.terminalWealth / benchmark;
  const atLeast = shifted.filter(v => v >= actualRatio).length;
  return {
    window: `${bars[0].date}->${bars[bars.length - 1].date}`,
    bars: bars.length,
    indexBuyAndHold: benchmark,
    ratioBase: actualRatio,
    ratioStress: stressRun.terminalWealth / benchmark,
    trades: baseRun.trades,
    exposure: baseRun.exposure,
    placeboFiniteSampleP: (1 + atLeast) / (1 + shifted.length),
    placeboMedian: shifted.sort((a, b) => a - b)[Math.floor(shifted.length / 2)],
  };
}

function verdictOf(results) {
  const wins = Object.values(results).filter(r => r.ratioBase > 1).length;
  const strong = Object.values(results).filter(r => r.placeboFiniteSampleP <= 0.10).length;
  if (wins >= 2 && strong >= 2) return 'REPLICATION_SUPPORTED';
  if (wins <= 1) return 'REPLICATION_FAILED';
  return 'REPLICATION_MIXED';
}

async function main() {
  assertProtocolCommittedClean();
  if (fs.existsSync(RESULT_PATH)) throw new Error('result already exists; the stop rule forbids re-runs');
  const cashFactor = loadCashFactor();
  const cfg = { window: 252, minWindowPoints: 126, minComponents: 6, fillDays: 7, markets: {} };
  for (const [key, market] of Object.entries(MARKETS)) cfg.markets[key] = { name: market.name, currency: 'USD', symbols: market.symbols };
  process.stderr.write('computing six-component scores for 4 fresh markets…\n');
  const fg = await marketfg.getMarketFearGreed(cfg);
  const failed = Object.keys(fg.failed || {});
  if (failed.length) throw new Error(`markets failed to compute: ${failed.join(', ')} ${JSON.stringify(fg.failed)}`);
  const results = {};
  for (const key of Object.keys(MARKETS)) {
    const prices = await fetchPrices(MARKETS[key].symbols.index);
    results[key] = evaluateMarket(key, fg.markets[key].history, prices, cashFactor);
    process.stderr.write(`${key}: ratio ${results[key].ratioBase.toFixed(3)} (p ${results[key].placeboFiniteSampleP.toFixed(2)})\n`);
  }
  const output = {
    protocol: 'FEAR_GREED_FRESH_MARKET_REPLICATION_PROTOCOL.md',
    protocolSha256: sha256(fs.readFileSync(PROTOCOL)),
    ranAt: new Date().toISOString(),
    rule: { fear: FEAR, greed: GREED, cadence: 'month-end', baseCost: BASE_COST, stressCost: STRESS_COST, cash: 'DTB3-91D-ACCRUAL-V2' },
    verdict: verdictOf(results),
    markets: results,
    interpretation: 'Quasi-out-of-sample spatial replication on unmined markets; retrospective current-vintage data; not confirmatory in the lockbox sense.',
  };
  const text = JSON.stringify(output, null, 2);
  fs.writeFileSync(RESULT_PATH, text);
  fs.writeFileSync(`${RESULT_PATH}.sha256`, `${sha256(Buffer.from(text))}  ${path.basename(RESULT_PATH)}\n`);
  process.stdout.write(`${text}\n`);
}

module.exports = { MARKETS, evaluateMarket, verdictOf, FEAR, GREED };
if (require.main === module) main().catch(error => { process.stderr.write(`replication run failed: ${error.message}\n`); process.exit(1); });
