'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PRIMARY_COST_BPS = 50;
const COST_GRID_BPS = Object.freeze([0, 25, 50, 100]);
const REQUIRED_MARKETS = Object.freeze(['crypto', 'sweden', 'usa', 'europe', 'global']);

function sha256Buffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function findCanonicalInput(repoRoot) {
  const dir = path.join(repoRoot, 'research', 'local-artifacts', 'v2-validation-final', 'inputs');
  const files = fs.readdirSync(dir).filter(name => name.endsWith('.json')).sort();
  if (files.length !== 1) throw new Error(`expected exactly one canonical schema-5 JSON input, found ${files.length}`);
  return path.join(dir, files[0]);
}

function verifyInput(inputPath) {
  const bytes = fs.readFileSync(inputPath);
  const actual = sha256Buffer(bytes);
  const sidecarPath = inputPath.replace(/\.json$/i, '.sha256');
  const sidecar = fs.readFileSync(sidecarPath, 'utf8').trim();
  const expected = sidecar.split(/\s+/)[0].toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error(`invalid SHA-256 sidecar: ${sidecarPath}`);
  if (actual !== expected) throw new Error(`input SHA-256 mismatch: expected ${expected}, got ${actual}`);
  return { bytes, sha256: actual, sidecarPath };
}

function normalizeRows(rows) {
  if (!Array.isArray(rows)) throw new Error('target rows must be an array');
  const clean = rows.map(row => ({ date: String(row.date), close: Number(row.close) }))
    .filter(row => /^\d{4}-\d{2}-\d{2}$/.test(row.date) && Number.isFinite(row.close) && row.close > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  for (let i = 1; i < clean.length; i++) {
    if (clean[i].date <= clean[i - 1].date) throw new Error(`duplicate or non-increasing target date: ${clean[i].date}`);
  }
  if (clean.length < 12) throw new Error(`too little target history: ${clean.length} rows`);
  return clean;
}

function monthEndRows(rows) {
  const out = [];
  for (const row of rows) {
    const month = row.date.slice(0, 7);
    if (out.length && out[out.length - 1].month === month) out[out.length - 1] = { ...row, month };
    else out.push({ ...row, month });
  }
  return out;
}

function buildOrders(rows, months = 10) {
  if (!Number.isInteger(months) || months < 2) throw new Error('months must be an integer >= 2');
  const ends = monthEndRows(rows);
  const rowIndex = new Map(rows.map((row, i) => [row.date, i]));
  const orders = [];
  for (let i = months - 1; i < ends.length; i++) {
    let sum = 0;
    for (let k = i - months + 1; k <= i; k++) sum += ends[k].close;
    const average = sum / months;
    const signal = ends[i].close > average ? 1 : 0;
    const signalIndex = rowIndex.get(ends[i].date);
    const executionIndex = signalIndex + 1;
    if (executionIndex >= rows.length) continue; // final month-end signal has no future close and is intentionally not executed
    orders.push({
      signalDate: ends[i].date,
      signalClose: ends[i].close,
      average,
      signal,
      executionDate: rows[executionIndex].date,
      executionIndex,
    });
  }
  if (!orders.length) throw new Error('no executable MA10 orders');
  return orders;
}

function maxDrawdown(pathValues) {
  let peak = -Infinity;
  let worst = 0;
  for (const value of pathValues) {
    if (value > peak) peak = value;
    const dd = value / peak - 1;
    if (dd < worst) worst = dd;
  }
  return worst;
}

function annualizedGrowth(startWealth, endWealth, startDate, endDate) {
  const years = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / (365.2425 * 86400000);
  return years > 0 && startWealth > 0 && endWealth > 0 ? Math.exp(Math.log(endWealth / startWealth) / years) - 1 : null;
}

function simulatePrepared(rows, orders, costBps = PRIMARY_COST_BPS) {
  if (!orders.length) throw new Error('no executable MA10 orders in evaluation window');
  const orderByIndex = new Map(orders.map(order => [order.executionIndex, order]));
  const startIndex = orders[0].executionIndex;
  const cost = costBps / 10000;
  let exposure = 0;
  let strategy = 1;
  let buyHold = 1 * (1 - cost);
  let changes = 0;
  let missingExecutions = 0;
  const strategyPath = [strategy];
  const buyHoldPath = [buyHold];
  const ledger = [];

  const firstOrder = orderByIndex.get(startIndex);
  if (!firstOrder) throw new Error('first order missing at start index');
  if (firstOrder.signal !== exposure) {
    strategy *= 1 - cost;
    exposure = firstOrder.signal;
    changes++;
  }
  ledger.push({ ...firstOrder, before: 0, after: exposure, strategyWealth: strategy });
  strategyPath[0] = strategy;

  for (let i = startIndex + 1; i < rows.length; i++) {
    const grossReturn = rows[i].close / rows[i - 1].close;
    if (!Number.isFinite(grossReturn) || grossReturn <= 0) throw new Error(`invalid gross return at ${rows[i].date}`);
    if (exposure === 1) strategy *= grossReturn;
    buyHold *= grossReturn;

    const order = orderByIndex.get(i);
    if (order) {
      const before = exposure;
      if (order.signal !== exposure) {
        strategy *= 1 - cost;
        exposure = order.signal;
        changes++;
      }
      ledger.push({ ...order, before, after: exposure, strategyWealth: strategy });
    }
    strategyPath.push(strategy);
    buyHoldPath.push(buyHold);
  }

  for (const order of orders) if (!rows[order.executionIndex] || rows[order.executionIndex].date !== order.executionDate) missingExecutions++;
  const startDate = rows[startIndex].date;
  const endDate = rows[rows.length - 1].date;
  return {
    costBps,
    startDate,
    endDate,
    startIndex,
    observations: rows.length - startIndex,
    executableSignals: orders.length,
    exposureChanges: changes,
    missingExecutions,
    terminalStrategy: strategy,
    terminalBuyHold: buyHold,
    wealthRatio: strategy / buyHold,
    excessWealth: strategy - buyHold,
    cagrStrategy: annualizedGrowth(1, strategy, startDate, endDate),
    cagrBuyHold: annualizedGrowth(1, buyHold, startDate, endDate),
    maxDrawdownStrategy: maxDrawdown(strategyPath),
    maxDrawdownBuyHold: maxDrawdown(buyHoldPath),
    ledger,
  };
}

function simulate(rowsInput, costBps = PRIMARY_COST_BPS, months = 10) {
  const rows = normalizeRows(rowsInput);
  return simulatePrepared(rows, buildOrders(rows, months), costBps);
}

function chronologicalHalves(rowsInput) {
  const rows = normalizeRows(rowsInput);
  const split = Math.floor(rows.length / 2);
  const overlapStart = Math.max(0, split - 320); // history only; result dates are trimmed below
  const first = rows.slice(0, split);
  const secondWithWarmup = rows.slice(overlapStart);
  return { first, secondWithWarmup, secondResultStart: rows[split].date };
}

function simulateHalf(rows, costBps, resultStart = null) {
  const normalized = normalizeRows(rows);
  const orders = buildOrders(normalized, 10)
    .filter(order => resultStart == null || order.executionDate >= resultStart);
  return simulatePrepared(normalized, orders, costBps);
}

function fingerprintResult(report) {
  const stable = {
    schemaVersion: report.schemaVersion,
    candidate: report.candidate,
    inputSha256: report.inputSha256,
    primaryCostBps: report.primaryCostBps,
    markets: report.markets.map(m => ({
      key: m.key,
      primary: m.primary,
      halves: m.halves,
      costGrid: m.costGrid,
    })),
    common: report.common,
    verdict: report.verdict,
  };
  return sha256Buffer(Buffer.from(JSON.stringify(stable)));
}

function analyzeSnapshot(snapshot, inputSha256) {
  if (!snapshot || !Array.isArray(snapshot.markets)) throw new Error('snapshot markets missing');
  const byKey = new Map(snapshot.markets.map(market => [market.key, market]));
  const missing = REQUIRED_MARKETS.filter(key => !byKey.has(key));
  if (missing.length) throw new Error(`required markets missing: ${missing.join(', ')}`);

  const markets = REQUIRED_MARKETS.map(key => {
    const market = byKey.get(key);
    const rows = normalizeRows(market.prices && market.prices.rows);
    const primary = simulate(rows, PRIMARY_COST_BPS);
    const halvesInput = chronologicalHalves(rows);
    const halves = {
      first: simulateHalf(halvesInput.first, PRIMARY_COST_BPS),
      second: simulateHalf(halvesInput.secondWithWarmup, PRIMARY_COST_BPS, halvesInput.secondResultStart),
    };
    const costGrid = Object.fromEntries(COST_GRID_BPS.map(costBps => [costBps, simulate(rows, costBps)]));
    return {
      key,
      name: market.name,
      targetId: market.targetId,
      targetSpec: market.targetSpec,
      rowCount: rows.length,
      firstDate: rows[0].date,
      lastDate: rows[rows.length - 1].date,
      primary,
      halves,
      costGrid,
      passedPrimary: primary.terminalStrategy > primary.terminalBuyHold && primary.missingExecutions === 0,
      passedHalves: halves.first.terminalStrategy > halves.first.terminalBuyHold && halves.second.terminalStrategy > halves.second.terminalBuyHold,
    };
  });

  const common = {
    strategy: markets.reduce((sum, market) => sum + market.primary.terminalStrategy, 0) / markets.length,
    buyHold: markets.reduce((sum, market) => sum + market.primary.terminalBuyHold, 0) / markets.length,
  };
  common.excessWealth = common.strategy - common.buyHold;
  common.wealthRatio = common.strategy / common.buyHold;

  const verdict = {
    allFivePrimary: markets.every(market => market.passedPrimary),
    commonPrimary: common.strategy > common.buyHold,
    allTenHalves: markets.every(market => market.passedHalves),
  };
  verdict.status = verdict.allFivePrimary && verdict.commonPrimary ? 'PASS_RETROSPECTIVE_REPLICATION' : 'FAIL_NO_COMMON_WINNER';

  const report = {
    schemaVersion: 10,
    status: 'RETROSPECTIVE_DEVELOPMENT_ONLY',
    candidate: 'MA10-LF-50',
    inputSha256,
    primaryCostBps: PRIMARY_COST_BPS,
    markets,
    common,
    verdict,
  };
  report.analysisFingerprint = fingerprintResult(report);
  return report;
}

function pct(value) {
  return `${(100 * value).toFixed(2)}%`;
}

function num(value) {
  return Number(value).toFixed(3);
}

function markdownReport(report) {
  const lines = [
    '# MA10-LF-50 published-rule replication',
    '',
    `Status: **${report.verdict.status}**`,
    '',
    `Input SHA-256: \`${report.inputSha256}\``,
    '',
    `Analysis fingerprint: \`${report.analysisFingerprint}\``,
    '',
    'This is retrospective development evidence on already-inspected data. It is not an untouched confirmatory result or deployment approval.',
    '',
    '| Market | Period | MA10 wealth | B&H wealth | Ratio | MA10 CAGR | B&H CAGR | MA10 max DD | B&H max DD | Primary | Halves |',
    '|---|---:|---:|---:|---:|---:|---:|---:|---:|:---:|:---:|',
  ];
  for (const market of report.markets) {
    const p = market.primary;
    lines.push(`| ${market.name || market.key} | ${p.startDate} to ${p.endDate} | ${num(p.terminalStrategy)} | ${num(p.terminalBuyHold)} | ${num(p.wealthRatio)} | ${pct(p.cagrStrategy)} | ${pct(p.cagrBuyHold)} | ${pct(p.maxDrawdownStrategy)} | ${pct(p.maxDrawdownBuyHold)} | ${market.passedPrimary ? 'PASS' : 'FAIL'} | ${market.passedHalves ? 'PASS' : 'FAIL'} |`);
  }
  lines.push('', `Common equal-sleeve terminal wealth: MA10 **${num(report.common.strategy)}**, B&H **${num(report.common.buyHold)}**, ratio **${num(report.common.wealthRatio)}**.`, '');
  lines.push(`Primary all-five gate: **${report.verdict.allFivePrimary ? 'PASS' : 'FAIL'}**.`);
  lines.push(`Common portfolio gate: **${report.verdict.commonPrimary ? 'PASS' : 'FAIL'}**.`);
  lines.push(`Two-halves falsification: **${report.verdict.allTenHalves ? 'PASS' : 'FAIL'}**.`);
  lines.push('', 'No parameter neighbour may be tried as a continuation of this frozen replication.');
  return `${lines.join('\n')}\n`;
}

function runCli(argv = process.argv.slice(2)) {
  const repoRoot = path.resolve(__dirname, '..');
  const inputPath = argv[0] ? path.resolve(argv[0]) : findCanonicalInput(repoRoot);
  const outputDir = argv[1] ? path.resolve(argv[1]) : path.join(repoRoot, 'research', 'local-artifacts', 'ma10-replication-final');
  const verified = verifyInput(inputPath);
  const snapshot = JSON.parse(verified.bytes.toString('utf8'));
  const report = analyzeSnapshot(snapshot, verified.sha256);
  fs.mkdirSync(outputDir, { recursive: true });
  const base = `fear-greed-ma10-replication-${String(snapshot.freezeAt || snapshot.createdAt || 'frozen').replace(/[:.]/g, '-')}`;
  const jsonPath = path.join(outputDir, `${base}.json`);
  const mdPath = path.join(outputDir, `${base}.md`);
  fs.writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(mdPath, markdownReport(report));
  process.stdout.write(`${markdownReport(report)}\nJSON: ${jsonPath}\nMarkdown: ${mdPath}\n`);
  return report;
}

if (require.main === module) runCli();

module.exports = {
  PRIMARY_COST_BPS,
  COST_GRID_BPS,
  REQUIRED_MARKETS,
  sha256Buffer,
  verifyInput,
  normalizeRows,
  monthEndRows,
  buildOrders,
  simulatePrepared,
  simulate,
  chronologicalHalves,
  simulateHalf,
  analyzeSnapshot,
  fingerprintResult,
  markdownReport,
};
