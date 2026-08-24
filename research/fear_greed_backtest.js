'use strict';

// Reproducible, dependency-free Fear & Greed backtest.
// Node 18+ is required for the built-in fetch implementation.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'data', 'config.json');
const MARKET_FG_PATH = path.join(ROOT, 'marketfg.js');
const CRYPTO_FG_PATH = path.join(ROOT, 'cryptofg.js');
const PROTOCOL_PATH = path.join(__dirname, 'FEAR_GREED_PROTOCOL.md');
const DEFAULT_ARTIFACT_ROOT = path.join(__dirname, 'artifacts');
const HORIZONS = [1, 5, 21, 63];
const HOLDOUT_FRACTION = 0.40;
const REQUIRED_COMPONENTS = { equity: 6, crypto: 5 };
const TRANSACTION_COST = 0.001;
const WALK_FORWARD_BLOCK = 21;
const USER_AGENT = 'InvestmentsFearGreedBacktest/1.0 (+local reproducible research)';
const YAHOO_CHART_TEMPLATE = 'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}';

const MARKET_SPECS = [
  { key: 'sweden', name: 'Sweden', target: '^OMXSBGI', kind: 'equity', annualization: 252, investable: false },
  { key: 'usa', name: 'USA', target: 'SPY', kind: 'equity', annualization: 252, investable: true },
  { key: 'europe', name: 'Europe', target: '^STOXX', kind: 'equity', annualization: 252, investable: false },
  { key: 'global', name: 'Global', target: 'ACWI', kind: 'equity', annualization: 252, investable: true },
  { key: 'crypto', name: 'Crypto (BTC assumed target)', target: 'BTC-USD', kind: 'crypto', annualization: 365, investable: true },
];

const RULES = [
  { key: 'fear_only', name: 'Long only Fear/Extreme Fear', test: label => label === 'Fear' || label === 'Extreme Fear' },
  { key: 'not_extreme_greed', name: 'Long except Extreme Greed', test: label => label !== 'Extreme Greed' },
  { key: 'greed_only', name: 'Long only Greed/Extreme Greed', test: label => label === 'Greed' || label === 'Extreme Greed' },
  { key: 'not_extreme_fear', name: 'Long except Extreme Fear', test: label => label !== 'Extreme Fear' },
];

function parseArgs(argv) {
  const out = { snapshot: null, outDir: DEFAULT_ARTIFACT_ROOT, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--snapshot') out.snapshot = argv[++i];
    else if (arg === '--out-dir') out.outDir = argv[++i];
    else if (arg === '--help' || arg === '-h') out.help = true;
    else throw new Error(`unknown argument: ${arg}`);
  }
  if (out.snapshot) out.snapshot = path.resolve(process.cwd(), out.snapshot);
  out.outDir = path.resolve(process.cwd(), out.outDir);
  return out;
}

function usage() {
  return [
    'Usage:',
    '  node research/fear_greed_backtest.js',
    '  node research/fear_greed_backtest.js --snapshot research/artifacts/inputs/<snapshot>.json',
    '  node research/fear_greed_backtest.js --out-dir <directory>',
    '',
    'A live run downloads inputs and freezes a canonical JSON snapshot plus SHA-256.',
    'A --snapshot run performs no network requests and verifies an adjacent checksum when present.',
  ].join('\n');
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256File(file) {
  return sha256Buffer(fs.readFileSync(file));
}

function portablePath(file) {
  if (!file) return null;
  const absolute = path.resolve(file);
  const relative = path.relative(ROOT, absolute);
  const insideRepo = relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  return (insideRepo ? (relative || '.') : path.basename(absolute)).split(path.sep).join('/');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value), null, 2) + '\n';
}

function runStamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, description, attempts = 3) {
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(30000),
      });
      const text = await response.text();
      let body = null;
      try { body = JSON.parse(text); } catch { /* handled below */ }
      const apiStatus = body && body.status;
      const apiError = apiStatus && apiStatus.error_code != null && String(apiStatus.error_code) !== '0';
      if (!response.ok || apiError) {
        const detail = (apiStatus && apiStatus.error_message) || (body && body.chart && body.chart.error && body.chart.error.description) || text.slice(0, 200);
        throw new Error(`${description}: HTTP ${response.status}${detail ? ` (${detail})` : ''}`);
      }
      if (!body || typeof body !== 'object') throw new Error(`${description}: response was not JSON`);
      return body;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await sleep(750 * (2 ** (attempt - 1)));
    }
  }
  throw lastError || new Error(`${description}: fetch failed`);
}

async function mapLimit(items, limit, fn) {
  const output = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      output[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return output;
}

async function fetchYahooSeries(symbol, fetchedAt) {
  const period2 = Math.floor(new Date(fetchedAt).getTime() / 1000) + 86400;
  const query = `period1=0&period2=${period2}&interval=1d&events=div%2Csplits`;
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com'];
  let json = null;
  let usedUrl = null;
  let firstError = null;
  for (const host of hosts) {
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`;
    try {
      json = await fetchJson(url, `Yahoo chart ${symbol}`, 2);
      usedUrl = url;
      break;
    } catch (error) {
      if (!firstError) firstError = error;
    }
  }
  if (!json) throw firstError || new Error(`Yahoo chart failed (${symbol})`);
  const result = json.chart && json.chart.result && json.chart.result[0];
  if (!result) throw new Error(`Yahoo chart returned no result (${symbol})`);
  const meta = result.meta || {};
  const timestamps = result.timestamp || [];
  const quotes = ((result.indicators && result.indicators.quote) || [])[0] || {};
  const rawClose = quotes.close || [];
  const adjClose = (((result.indicators && result.indicators.adjclose) || [])[0] || {}).adjclose || [];
  const adjusted = adjClose.length === rawClose.length && rawClose.every((close, i) =>
    !(Number.isFinite(close) && close > 0) || (Number.isFinite(adjClose[i]) && adjClose[i] > 0));
  const closes = adjusted ? adjClose : rawClose;
  const timezone = meta.exchangeTimezoneName || 'UTC';
  const retrievalLocalDate = new Date(fetchedAt).toLocaleDateString('sv-SE', { timeZone: timezone });
  const byDate = new Map();
  let excludedSameDate = 0;
  for (let i = 0; i < timestamps.length; i++) {
    const close = closes[i];
    if (!Number.isFinite(close) || close <= 0) continue;
    const date = new Date(timestamps[i] * 1000).toLocaleDateString('sv-SE', { timeZone: timezone });
    // Yahoo can expose a still-forming daily candle. Omitting the retrieval-local date is conservative and deterministic.
    if (date >= retrievalLocalDate) { excludedSameDate++; continue; }
    byDate.set(date, { date, close });
  }
  const rows = [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  if (rows.length < 150) throw new Error(`Yahoo returned too little completed history (${symbol}: ${rows.length})`);
  return {
    symbol,
    name: String(meta.longName || meta.shortName || symbol).replace(/\s+/g, ' ').trim(),
    currency: meta.currency || null,
    timezone,
    adjusted,
    adjustmentMode: adjusted ? 'Yahoo adjusted close for the whole series' : 'Yahoo close; no complete adjusted-close series supplied',
    excludedRetrievalLocalDateRows: excludedSameDate,
    sourceUrl: usedUrl,
    rows,
  };
}

async function collectLiveSnapshot() {
  const fetchedAt = new Date().toISOString();
  const configRaw = fs.readFileSync(CONFIG_PATH);
  const config = JSON.parse(configRaw.toString('utf8'));
  for (const spec of MARKET_SPECS.filter(row => row.kind === 'equity')) {
    const configured = config.marketFearGreed && config.marketFearGreed.markets && config.marketFearGreed.markets[spec.key];
    const configuredTarget = configured && configured.symbols && configured.symbols.index;
    if (configuredTarget !== spec.target) {
      throw new Error(`target/config drift for ${spec.key}: runner=${spec.target}, config index=${configuredTarget || 'missing'}`);
    }
  }
  const cryptoConfig = config.cryptoFearGreed || {};
  const cryptoSpec = MARKET_SPECS.find(row => row.kind === 'crypto');
  if (!cryptoSpec || cryptoConfig.benchmark !== cryptoSpec.target) {
    throw new Error(`target/config drift for crypto: runner=${cryptoSpec && cryptoSpec.target}, config benchmark=${cryptoConfig.benchmark || 'missing'}`);
  }
  const marketfg = require(MARKET_FG_PATH);
  const cryptofg = require(CRYPTO_FG_PATH);
  marketfg.clearCache();
  cryptofg.clearCache();
  const equity = await marketfg.getMarketFearGreed({
    ...(config.marketFearGreed || {}),
    historyPoints: 100000,
    timeoutMs: Math.max(60000, Number(config.marketFearGreed && config.marketFearGreed.timeoutMs) || 0),
  });
  if (!equity.ok) throw new Error(`equity Fear & Greed failed: ${JSON.stringify(equity.failed || {})}`);
  const missing = MARKET_SPECS.filter(x => x.kind === 'equity' && !equity.markets[x.key]);
  if (missing.length) throw new Error(`missing equity markets: ${missing.map(x => x.key).join(', ')}; failures=${JSON.stringify(equity.failed || {})}`);
  const cryptoModel = await cryptofg.getCryptoFearGreed({
    ...cryptoConfig,
    historyPoints: 100000,
    timeoutMs: Math.max(60000, Number(cryptoConfig.timeoutMs) || 0),
  });
  if (!cryptoModel.ok) throw new Error('repository-owned crypto model failed');

  const yahooSeries = await mapLimit(MARKET_SPECS, 3, spec => fetchYahooSeries(spec.target, fetchedAt));
  const yahooBySymbol = new Map(yahooSeries.map(series => [series.symbol, series]));

  const markets = MARKET_SPECS.map(spec => {
    const prices = yahooBySymbol.get(spec.target);
    if (spec.kind === 'crypto') {
      return {
        ...spec,
        signalIdentity: 'Repository-owned five-component crypto risk-appetite model, recomputed by cryptofg.js',
        providerBands: 'Repository model v1: 0-24 Extreme Fear, 25-44 Fear, 45-55 Neutral, 56-74 Greed, 75-100 Extreme Greed',
        configuredSymbols: cryptoConfig.symbols,
        requiredComponents: REQUIRED_COMPONENTS.crypto,
        requiredAssetCount: cryptoConfig.symbols.length,
        signals: cryptoModel.history.map(row => ({
          date: row.date,
          score: Number(row.score),
          label: row.label || equityBand(Number(row.score)),
          componentCount: Number(row.n),
          assetCount: Number(row.assetCount),
        })),
        prices,
      };
    }
    const source = equity.markets[spec.key];
    return {
      ...spec,
      signalIdentity: 'Repository-owned CNN-inspired six-component equity model, recomputed by marketfg.js',
      providerBands: 'Repository equity model: 0-24 Extreme Fear, 25-44 Fear, 45-55 Neutral, 56-74 Greed, 75-100 Extreme Greed',
      configuredSymbols: config.marketFearGreed.markets[spec.key].symbols,
      requiredComponents: REQUIRED_COMPONENTS.equity,
      modelComponentCarryDays: Number(config.marketFearGreed.fillDays || 7),
      signals: source.history.map(row => ({
        date: row.date,
        score: Number(row.score),
        label: row.label || equityBand(Number(row.score)),
        componentCount: Number(row.n),
      })),
      prices,
    };
  });

  return {
    schemaVersion: 2,
    createdAt: fetchedAt,
    purpose: 'Frozen normalized inputs for the Fear & Greed predictive backtest',
    sourceCode: {
      nodeVersion: process.version,
      platform: `${process.platform}-${process.arch}`,
      marketfgPath: path.relative(ROOT, MARKET_FG_PATH).replace(/\\/g, '/'),
      marketfgSha256: sha256File(MARKET_FG_PATH),
      cryptofgPath: path.relative(ROOT, CRYPTO_FG_PATH).replace(/\\/g, '/'),
      cryptofgSha256: sha256File(CRYPTO_FG_PATH),
      configPath: path.relative(ROOT, CONFIG_PATH).replace(/\\/g, '/'),
      configSha256: sha256Buffer(configRaw),
      backtestPath: path.relative(ROOT, __filename).replace(/\\/g, '/'),
      backtestSha256: sha256File(__filename),
      protocolPath: path.relative(ROOT, PROTOCOL_PATH).replace(/\\/g, '/'),
      protocolSha256: sha256File(PROTOCOL_PATH),
    },
    sources: {
      equity: {
        identity: 'marketfg.js output using data/config.json and current Yahoo daily histories',
        fetchedAt: equity.fetchedAt,
        model: equity.model,
        failedMarkets: equity.failed,
        symbolErrors: equity.symbolErrors,
        yahooEndpointTemplate: YAHOO_CHART_TEMPLATE,
      },
      cryptoModel: {
        identity: 'Repository-owned Crypto Risk Appetite model v1 from completed UTC Yahoo daily closes',
        fetchedAt: cryptoModel.fetchedAt,
        model: cryptoModel.model,
        source: cryptoModel.source,
        warnings: cryptoModel.warnings,
      },
      targetPrices: {
        identity: 'Yahoo Finance chart daily adjusted closes where supplied as a complete series',
        endpointTemplate: YAHOO_CHART_TEMPLATE,
        fetchedAt,
        partialBarPolicy: 'The retrieval-local calendar date is excluded for every target to avoid still-forming daily bars.',
      },
    },
    assumptions: {
      cryptoTarget: 'BTC-USD is the model benchmark and an explicit return target; the seven-asset fixed-basket score is not the same thing as a BTC-only position.',
      equityPrimarySample: 'Only rows with all six configured components (componentCount === 6).',
      cryptoPrimarySample: 'Only completed UTC rows with all five components and all seven frozen-basket assets.',
      timing: 'Signal on target bar t; enter at close t+1; exit at close t+1+h. Exact signal/target date match required.',
      vintage: 'Current downloaded histories are not point-in-time vintages; historical revisions and survivorship effects cannot be ruled out.',
      investability: '^OMXSBGI and ^STOXX are non-investable index diagnostics.',
    },
    markets,
  };
}

function writeSnapshot(snapshot, outputRoot, stamp) {
  const dir = path.join(outputRoot, 'inputs');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `fear-greed-input-${stamp}.json`);
  const bytes = Buffer.from(canonicalJson(snapshot), 'utf8');
  fs.writeFileSync(file, bytes);
  const digest = sha256Buffer(bytes);
  const checksumFile = file.replace(/\.json$/, '.sha256');
  fs.writeFileSync(checksumFile, `${digest}  ${path.basename(file)}\n`, 'utf8');
  return { file, checksumFile, sha256: digest, checksumVerified: true };
}

function readSnapshot(file) {
  const bytes = fs.readFileSync(file);
  const digest = sha256Buffer(bytes);
  const snapshot = JSON.parse(bytes.toString('utf8'));
  if (snapshot.schemaVersion !== 2 || !Array.isArray(snapshot.markets)) throw new Error('unsupported or invalid snapshot (the active runner requires an own-model v2 snapshot; retired v1 CMC snapshots remain archival only)');
  const candidates = [file.replace(/\.json$/i, '.sha256'), `${file}.sha256`];
  const checksumFile = candidates.find(candidate => fs.existsSync(candidate)) || null;
  let checksumVerified = null;
  if (checksumFile) {
    const expected = fs.readFileSync(checksumFile, 'utf8').trim().split(/\s+/)[0].toLowerCase();
    checksumVerified = expected === digest;
    if (!checksumVerified) throw new Error(`snapshot checksum mismatch: expected ${expected}, got ${digest}`);
  }
  return { snapshot, file, checksumFile, sha256: digest, checksumVerified };
}

function equityBand(value) {
  if (value <= 24) return 'Extreme Fear';
  if (value <= 44) return 'Fear';
  if (value <= 55) return 'Neutral';
  if (value <= 74) return 'Greed';
  return 'Extreme Greed';
}

function normalizedLabel(label, score) {
  const text = String(label || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
  const map = {
    'extreme fear': 'Extreme Fear', fear: 'Fear', neutral: 'Neutral', greed: 'Greed', 'extreme greed': 'Extreme Greed',
  };
  return map[text] || equityBand(score);
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function variance(values, sample = true) {
  if (values.length < (sample ? 2 : 1)) return null;
  const m = mean(values);
  const divisor = values.length - (sample ? 1 : 0);
  return values.reduce((sum, value) => sum + ((value - m) ** 2), 0) / divisor;
}

function standardDeviation(values, sample = true) {
  const v = variance(values, sample);
  return v == null ? null : Math.sqrt(Math.max(0, v));
}

function median(values) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  const middle = Math.floor(a.length / 2);
  return a.length % 2 ? a[middle] : (a[middle - 1] + a[middle]) / 2;
}

function quantile(values, probability) {
  if (!values.length) return null;
  const a = [...values].sort((x, y) => x - y);
  const index = (a.length - 1) * probability;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return a[lower];
  return a[lower] + (a[upper] - a[lower]) * (index - lower);
}

function pearson(x, y) {
  if (x.length !== y.length || x.length < 3) return null;
  const mx = mean(x), my = mean(y);
  let numerator = 0, sx = 0, sy = 0;
  for (let i = 0; i < x.length; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    numerator += dx * dy;
    sx += dx * dx;
    sy += dy * dy;
  }
  return sx > 0 && sy > 0 ? numerator / Math.sqrt(sx * sy) : null;
}

function averageRanks(values) {
  const order = values.map((value, index) => ({ value, index })).sort((a, b) => a.value - b.value);
  const ranks = new Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i + 1;
    while (j < order.length && order[j].value === order[i].value) j++;
    const rank = (i + 1 + j) / 2;
    for (let k = i; k < j; k++) ranks[order[k].index] = rank;
    i = j;
  }
  return ranks;
}

function spearman(x, y) {
  return x.length >= 3 ? pearson(averageRanks(x), averageRanks(y)) : null;
}

function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const a = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * a);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  return sign * (1 - polynomial * Math.exp(-a * a));
}

function normalCdf(x) {
  return 0.5 * (1 + erf(x / Math.sqrt(2)));
}

function invert2(matrix) {
  const determinant = matrix[0][0] * matrix[1][1] - matrix[0][1] * matrix[1][0];
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-20) return null;
  return [
    [matrix[1][1] / determinant, -matrix[0][1] / determinant],
    [-matrix[1][0] / determinant, matrix[0][0] / determinant],
  ];
}

function multiplyMatrices(a, b) {
  const out = Array.from({ length: a.length }, () => Array(b[0].length).fill(0));
  for (let i = 0; i < a.length; i++) {
    for (let k = 0; k < b.length; k++) {
      for (let j = 0; j < b[0].length; j++) out[i][j] += a[i][k] * b[k][j];
    }
  }
  return out;
}

function neweyWestSlope(rows, horizon) {
  const n = rows.length;
  if (n < 8) return { n, slopePer10: null, standardError: null, ci95Low: null, ci95High: null, z: null, pValue: null, bandwidth: null };
  const x = rows.map(row => (row.score - 50) / 10);
  const y = rows.map(row => row.forwardReturn);
  const mx = mean(x), my = mean(y);
  const denominator = x.reduce((sum, value) => sum + ((value - mx) ** 2), 0);
  if (!(denominator > 0)) return { n, slopePer10: null, standardError: null, ci95Low: null, ci95High: null, z: null, pValue: null, bandwidth: null };
  const slope = x.reduce((sum, value, i) => sum + (value - mx) * (y[i] - my), 0) / denominator;
  const intercept = my - slope * mx;
  const residuals = y.map((value, i) => value - intercept - slope * x[i]);
  const xtx = [[n, x.reduce((a, b) => a + b, 0)], [x.reduce((a, b) => a + b, 0), x.reduce((a, b) => a + b * b, 0)]];
  const bread = invert2(xtx);
  if (!bread) return { n, slopePer10: slope, standardError: null, ci95Low: null, ci95High: null, z: null, pValue: null, bandwidth: null };
  const automatic = Math.floor(4 * ((n / 100) ** (2 / 9)));
  const bandwidth = Math.min(n - 3, Math.max(horizon, automatic));
  const g = residuals.map((residual, i) => [residual, residual * x[i]]);
  const meat = [[0, 0], [0, 0]];
  for (const row of g) {
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) meat[i][j] += row[i] * row[j];
  }
  for (let lag = 1; lag <= bandwidth; lag++) {
    const weight = 1 - lag / (bandwidth + 1);
    for (let t = lag; t < n; t++) {
      for (let i = 0; i < 2; i++) {
        for (let j = 0; j < 2; j++) {
          meat[i][j] += weight * (g[t][i] * g[t - lag][j] + g[t - lag][i] * g[t][j]);
        }
      }
    }
  }
  let covariance = multiplyMatrices(multiplyMatrices(bread, meat), bread);
  const finiteSample = n / (n - 2);
  covariance = covariance.map(row => row.map(value => value * finiteSample));
  const standardError = Math.sqrt(Math.max(0, covariance[1][1]));
  const z = standardError > 0 ? slope / standardError : null;
  const pValue = z == null ? null : Math.max(0, Math.min(1, 2 * (1 - normalCdf(Math.abs(z)))));
  return {
    n,
    intercept,
    slopePer10: slope,
    standardError,
    ci95Low: slope - 1.96 * standardError,
    ci95High: slope + 1.96 * standardError,
    z,
    pValue,
    bandwidth,
  };
}

function summarizeUnivariate(rows, horizon) {
  if (!rows.length) return { n: 0 };
  const scores = rows.map(row => row.score);
  const returns = rows.map(row => row.forwardReturn);
  return {
    n: rows.length,
    firstSignalDate: rows[0].signalDate,
    lastSignalDate: rows[rows.length - 1].signalDate,
    meanForwardReturn: mean(returns),
    medianForwardReturn: median(returns),
    pearson: pearson(scores, returns),
    spearman: spearman(scores, returns),
    regression: neweyWestSlope(rows, horizon),
  };
}

function computeControls(prices, index, annualization) {
  if (index < 125) return null;
  const close = prices[index].close;
  const dailyLogReturns = [];
  for (let k = index - 19; k <= index; k++) dailyLogReturns.push(Math.log(prices[k].close / prices[k - 1].close));
  const average125 = mean(prices.slice(index - 124, index + 1).map(row => row.close));
  return {
    lagReturn1: close / prices[index - 1].close - 1,
    lagReturn5: close / prices[index - 5].close - 1,
    lagReturn20: close / prices[index - 20].close - 1,
    realizedVol20: standardDeviation(dailyLogReturns) * Math.sqrt(annualization),
    trend125: close / average125 - 1,
  };
}

function buildObservations(market, horizon) {
  const prices = market.prices.rows;
  const priceIndex = new Map(prices.map((row, index) => [row.date, index]));
  const requiredComponents = Number(market.requiredComponents || REQUIRED_COMPONENTS[market.kind]);
  const requiredAssetCount = market.kind === 'crypto' ? Number(market.requiredAssetCount || 0) : null;
  const strictSignals = market.signals.filter(row =>
    Number.isFinite(row.score) && row.componentCount === requiredComponents &&
    (market.kind !== 'crypto' || row.assetCount === requiredAssetCount));
  const audit = {
    allSignalRows: market.signals.length,
    strictSignalRows: strictSignals.length,
    requiredComponents,
    requiredAssetCount,
    droppedDefinitionChangingRows: market.signals.length - strictSignals.length,
    exactPriceDateMissing: 0,
    futureBarsMissing: 0,
    eligible: 0,
  };
  const rows = [];
  for (const signal of strictSignals) {
    const signalIndex = priceIndex.get(signal.date);
    if (signalIndex == null) { audit.exactPriceDateMissing++; continue; }
    const entryIndex = signalIndex + 1;
    const exitIndex = entryIndex + horizon;
    if (exitIndex >= prices.length) { audit.futureBarsMissing++; continue; }
    const controls = computeControls(prices, signalIndex, market.annualization);
    rows.push({
      signalDate: signal.date,
      score: Number(signal.score),
      label: normalizedLabel(signal.label, Number(signal.score)),
      signalIndex,
      entryIndex,
      exitIndex,
      entryDate: prices[entryIndex].date,
      exitDate: prices[exitIndex].date,
      entryClose: prices[entryIndex].close,
      exitClose: prices[exitIndex].close,
      forwardReturn: prices[exitIndex].close / prices[entryIndex].close - 1,
      controls,
    });
  }
  audit.eligible = rows.length;
  return { rows, audit, strictSignals };
}

function splitRows(rows) {
  const trainCount = Math.floor(rows.length * (1 - HOLDOUT_FRACTION));
  const test = rows.slice(trainCount);
  if (!test.length) return { train: rows.slice(0, trainCount), test, trainCount, purgedTrainingOverlap: 0 };
  const trainCandidates = rows.slice(0, trainCount);
  // Keep holdout outcomes fully separate: no training outcome may extend beyond the first holdout entry close.
  const train = trainCandidates.filter(row => row.exitIndex <= test[0].entryIndex);
  return {
    train,
    test,
    trainCount,
    purgedTrainingOverlap: trainCandidates.length - train.length,
    overlapPurgeRule: 'training exitIndex <= first holdout entryIndex',
  };
}

function summarizeTail(train, test) {
  const q25 = quantile(train.map(row => row.score), 0.25);
  const q75 = quantile(train.map(row => row.score), 0.75);
  const summarize = rows => {
    const fearful = rows.filter(row => row.score <= q25).map(row => row.forwardReturn);
    const greedy = rows.filter(row => row.score >= q75).map(row => row.forwardReturn);
    return {
      fearfulN: fearful.length,
      fearfulMean: mean(fearful),
      greedyN: greedy.length,
      greedyMean: mean(greedy),
      fearfulMinusGreedy: fearful.length && greedy.length ? mean(fearful) - mean(greedy) : null,
    };
  };
  return { trainingQ25: q25, trainingQ75: q75, train: summarize(train), test: summarize(test) };
}

function summarizeBands(rows) {
  const labels = ['Extreme Fear', 'Fear', 'Neutral', 'Greed', 'Extreme Greed'];
  const out = {};
  for (const label of labels) {
    const returns = rows.filter(row => row.label === label).map(row => row.forwardReturn);
    out[label] = { n: returns.length, mean: mean(returns), median: median(returns) };
  }
  return out;
}

function benjaminiHochberg(tests) {
  const valid = tests.filter(test => Number.isFinite(test.pValue)).sort((a, b) => a.pValue - b.pValue);
  let previous = 1;
  for (let i = valid.length - 1; i >= 0; i--) {
    const rank = i + 1;
    const q = Math.min(previous, valid[i].pValue * valid.length / rank, 1);
    valid[i].qValue = q;
    previous = q;
  }
  return tests;
}

function solveLinear(matrix, vector) {
  const n = vector.length;
  const augmented = matrix.map((row, i) => [...row, vector[i]]);
  for (let column = 0; column < n; column++) {
    let pivot = column;
    for (let row = column + 1; row < n; row++) if (Math.abs(augmented[row][column]) > Math.abs(augmented[pivot][column])) pivot = row;
    if (Math.abs(augmented[pivot][column]) < 1e-12) return null;
    [augmented[column], augmented[pivot]] = [augmented[pivot], augmented[column]];
    const divisor = augmented[column][column];
    for (let j = column; j <= n; j++) augmented[column][j] /= divisor;
    for (let row = 0; row < n; row++) {
      if (row === column) continue;
      const factor = augmented[row][column];
      for (let j = column; j <= n; j++) augmented[row][j] -= factor * augmented[column][j];
    }
  }
  return augmented.map(row => row[n]);
}

function fitOls(rows, featureNames) {
  if (rows.length < Math.max(30, featureNames.length * 5)) return null;
  const means = {}, scales = {};
  for (const feature of featureNames) {
    const values = rows.map(row => feature === 'score' ? row.score : row.controls[feature]);
    means[feature] = mean(values);
    scales[feature] = standardDeviation(values) || 1;
  }
  const design = rows.map(row => [1, ...featureNames.map(feature => {
    const value = feature === 'score' ? row.score : row.controls[feature];
    return (value - means[feature]) / scales[feature];
  })]);
  const y = rows.map(row => row.forwardReturn);
  const p = featureNames.length + 1;
  const xtx = Array.from({ length: p }, () => Array(p).fill(0));
  const xty = Array(p).fill(0);
  for (let r = 0; r < design.length; r++) {
    for (let i = 0; i < p; i++) {
      xty[i] += design[r][i] * y[r];
      for (let j = 0; j < p; j++) xtx[i][j] += design[r][i] * design[r][j];
    }
  }
  // Tiny numerical stabilizer; it is not economically meaningful regularization.
  for (let i = 1; i < p; i++) xtx[i][i] += 1e-10;
  const coefficients = solveLinear(xtx, xty);
  if (!coefficients) return null;
  return {
    featureNames,
    means,
    scales,
    coefficients,
    predict(row) {
      let value = coefficients[0];
      for (let i = 0; i < featureNames.length; i++) {
        const feature = featureNames[i];
        const raw = feature === 'score' ? row.score : row.controls[feature];
        value += coefficients[i + 1] * ((raw - means[feature]) / scales[feature]);
      }
      return value;
    },
  };
}

function incrementalForecast(allRows, trainCount) {
  const controlFeatures = ['lagReturn1', 'lagReturn5', 'lagReturn20', 'realizedVol20', 'trend125'];
  const usable = row => row.controls && controlFeatures.every(feature => Number.isFinite(row.controls[feature]));
  const holdout = allRows.slice(trainCount).filter(usable);
  const predictions = [];
  const blocks = [];
  for (let offset = 0; offset < holdout.length; offset += WALK_FORWARD_BLOCK) {
    const blockRows = holdout.slice(offset, offset + WALK_FORWARD_BLOCK);
    const forecastDate = blockRows[0].signalDate;
    const forecastSignalIndex = blockRows[0].signalIndex;
    const available = allRows.filter(row => usable(row) && row.signalIndex < forecastSignalIndex && row.exitIndex <= forecastSignalIndex);
    const controlsModel = fitOls(available, controlFeatures);
    const fullModel = fitOls(available, [...controlFeatures, 'score']);
    if (!controlsModel || !fullModel) throw new Error(`insufficient walk-forward training data at ${forecastDate}`);
    const historicalMean = mean(available.map(row => row.forwardReturn));
    blocks.push({
      block: blocks.length + 1,
      forecastStart: blockRows[0].signalDate,
      forecastEnd: blockRows[blockRows.length - 1].signalDate,
      forecasts: blockRows.length,
      trainingRows: available.length,
      lastKnownOutcomeExitDate: available[available.length - 1].exitDate,
      scoreStandardizedCoefficient: fullModel.coefficients[fullModel.coefficients.length - 1],
    });
    for (const row of blockRows) {
      predictions.push({
        actual: row.forwardReturn,
        mean: historicalMean,
        controls: controlsModel.predict(row),
        full: fullModel.predict(row),
      });
    }
  }
  const mse = key => mean(predictions.map(row => (row.actual - row[key]) ** 2));
  const mseMean = mse('mean'), mseControls = mse('controls'), mseFull = mse('full');
  const r2Controls = mseMean > 0 ? 1 - mseControls / mseMean : null;
  const r2Full = mseMean > 0 ? 1 - mseFull / mseMean : null;
  return {
    method: `Expanding origin, refit every ${WALK_FORWARD_BLOCK} holdout observations; only rows whose exit was known by block start enter training`,
    controls: controlFeatures,
    forecastRows: predictions.length,
    firstForecastDate: holdout.length ? holdout[0].signalDate : null,
    lastForecastDate: holdout.length ? holdout[holdout.length - 1].signalDate : null,
    mseHistoricalMean: mseMean,
    mseControls,
    mseControlsPlusScore: mseFull,
    oosR2ControlsVsHistoricalMean: r2Controls,
    oosR2ControlsPlusScoreVsHistoricalMean: r2Full,
    deltaOosR2VsControls: r2Full == null || r2Controls == null ? null : r2Full - r2Controls,
    relativeMseImprovementVsControls: mseControls > 0 ? (mseControls - mseFull) / mseControls : null,
    scoreCoefficientPositiveBlocks: blocks.filter(block => block.scoreStandardizedCoefficient > 0).length,
    scoreCoefficientNegativeBlocks: blocks.filter(block => block.scoreStandardizedCoefficient < 0).length,
    blocks,
  };
}

function maxDrawdown(returns) {
  let value = 1, peak = 1, worst = 0;
  for (const r of returns) {
    value *= 1 + r;
    peak = Math.max(peak, value);
    worst = Math.min(worst, value / peak - 1);
  }
  return worst;
}

function performanceMetrics(returns, positions, changes, annualization) {
  const totalReturn = returns.reduce((value, r) => value * (1 + r), 1) - 1;
  const annualizedReturn = returns.length ? (1 + totalReturn) ** (annualization / returns.length) - 1 : null;
  const volatility = returns.length > 1 ? standardDeviation(returns) * Math.sqrt(annualization) : null;
  const sharpe = volatility > 0 ? mean(returns) * annualization / volatility : null;
  return {
    periods: returns.length,
    exposure: mean(positions),
    positionChanges: changes.reduce((sum, value) => sum + Math.abs(value), 0),
    transactionCostRatePerAbsoluteChange: TRANSACTION_COST,
    totalReturn,
    annualizedReturn,
    annualizedVolatility: volatility,
    sharpeZeroCash: sharpe,
    maxDrawdown: maxDrawdown(returns),
  };
}

function strategyBacktest(market, firstTestObservation, strictSignals) {
  const prices = market.prices.rows;
  const scoreByDate = new Map(strictSignals.map(row => [row.date, {
    score: row.score,
    label: normalizedLabel(row.label, row.score, market.kind),
  }]));
  const start = firstTestObservation.entryIndex;
  const periods = [];
  for (let i = start; i < prices.length - 1; i++) {
    const signalDate = prices[i - 1].date;
    const signal = scoreByDate.get(signalDate) || null;
    periods.push({
      signalDate,
      entryDate: prices[i].date,
      exitDate: prices[i + 1].date,
      assetReturn: prices[i + 1].close / prices[i].close - 1,
      signal,
    });
  }
  const benchmarkReturns = [], benchmarkPositions = [], benchmarkChanges = [];
  let benchmarkPrevious = 0;
  for (const period of periods) {
    const position = 1;
    const change = position - benchmarkPrevious;
    benchmarkReturns.push((1 - TRANSACTION_COST * Math.abs(change)) * (1 + period.assetReturn) - 1);
    benchmarkPositions.push(position);
    benchmarkChanges.push(change);
    benchmarkPrevious = position;
  }
  const benchmark = performanceMetrics(benchmarkReturns, benchmarkPositions, benchmarkChanges, market.annualization);
  const strategies = {};
  for (const rule of RULES) {
    const returns = [], positions = [], changes = [];
    let previous = 0;
    for (const period of periods) {
      // Missing strict signals force cash. This is not a score backfill.
      const position = period.signal && rule.test(period.signal.label) ? 1 : 0;
      const change = position - previous;
      returns.push((1 - TRANSACTION_COST * Math.abs(change)) * (1 + position * period.assetReturn) - 1);
      positions.push(position);
      changes.push(change);
      previous = position;
    }
    const metrics = performanceMetrics(returns, positions, changes, market.annualization);
    strategies[rule.key] = {
      name: rule.name,
      ...metrics,
      annualizedReturnMinusBuyHold: metrics.annualizedReturn - benchmark.annualizedReturn,
      sharpeMinusBuyHold: (metrics.sharpeZeroCash == null || benchmark.sharpeZeroCash == null) ? null : metrics.sharpeZeroCash - benchmark.sharpeZeroCash,
    };
  }
  return {
    startSignalDate: firstTestObservation.signalDate,
    firstEntryDate: periods.length ? periods[0].entryDate : null,
    lastExitDate: periods.length ? periods[periods.length - 1].exitDate : null,
    periods: periods.length,
    periodsWithoutStrictSignal: periods.filter(period => !period.signal).length,
    missingSignalPolicy: 'Cash for that one-bar period; no score backfill',
    benchmark: { name: 'Buy and hold (10 bp initial entry)', ...benchmark },
    strategies,
  };
}

function sign(value) {
  if (value == null || value === 0) return 'zero/undefined';
  return value < 0 ? 'negative' : 'positive';
}

function analyzeSnapshot(snapshot, inputInfo, execution) {
  const generatedAt = new Date().toISOString();
  const trials = [];
  const marketResults = {};
  for (const spec of MARKET_SPECS) {
    const market = snapshot.markets.find(row => row.key === spec.key);
    if (!market) throw new Error(`snapshot lacks market ${spec.key}`);
    if (market.target !== spec.target) throw new Error(`snapshot target drift for ${spec.key}: runner=${spec.target}, snapshot=${market.target || 'missing'}`);
    const horizons = {};
    let oneBarContext = null;
    for (const horizon of HORIZONS) {
      const built = buildObservations(market, horizon);
      if (built.rows.length < 30) throw new Error(`${spec.key}/${horizon}: only ${built.rows.length} eligible observations`);
      const split = splitRows(built.rows);
      const full = summarizeUnivariate(built.rows, horizon);
      const train = summarizeUnivariate(split.train, horizon);
      const test = summarizeUnivariate(split.test, horizon);
      const tail = summarizeTail(split.train, split.test);
      const fixedBands = { full: summarizeBands(built.rows), train: summarizeBands(split.train), test: summarizeBands(split.test) };
      const trialId = `${spec.key}-h${horizon}`;
      const trial = {
        id: trialId,
        market: spec.key,
        target: spec.target,
        horizonBars: horizon,
        primaryHorizon: horizon === 1,
        frozenAlternative: 'negative slope (higher greed predicts lower return)',
        inference: 'two-sided Newey-West p-value on chronological 40% holdout',
        multiplicityFamily: 'All 5 markets x 4 horizons (20 tests), Benjamini-Hochberg',
        eligibleN: built.rows.length,
        trainN: split.train.length,
        purgedTrainingOverlapN: split.purgedTrainingOverlap,
        testN: split.test.length,
        trainFirstDate: train.firstSignalDate,
        trainLastDate: train.lastSignalDate,
        testFirstDate: test.firstSignalDate,
        testLastDate: test.lastSignalDate,
        pValue: test.regression.pValue,
        qValue: null,
      };
      trials.push(trial);
      horizons[horizon] = {
        horizonBars: horizon,
        audit: built.audit,
        split: {
          rule: 'first floor(60% * N) is the boundary; training outcomes ending after the first holdout entry are purged; remaining observations are holdout',
          boundaryCandidateTrainN: split.trainCount,
          trainN: split.train.length,
          purgedTrainingOverlapN: split.purgedTrainingOverlap,
          overlapPurgeRule: split.overlapPurgeRule,
          testN: split.test.length,
        },
        full,
        train,
        test,
        signStability: {
          trainSlopeSign: sign(train.regression.slopePer10),
          testSlopeSign: sign(test.regression.slopePer10),
          sameSlopeSign: sign(train.regression.slopePer10) === sign(test.regression.slopePer10),
          trainPearsonSign: sign(train.pearson),
          testPearsonSign: sign(test.pearson),
        },
        trainDefinedQuartiles: tail,
        fixedBands,
        trialId,
      };
      if (horizon === 1) oneBarContext = { built, split };
    }
    const incremental = incrementalForecast(oneBarContext.built.rows, oneBarContext.split.trainCount);
    const strategies = strategyBacktest(market, oneBarContext.split.test[0], oneBarContext.built.strictSignals);
    marketResults[spec.key] = {
      name: spec.name,
      target: spec.target,
      kind: spec.kind,
      investableTarget: spec.investable,
      priceAdjustment: market.prices.adjustmentMode,
      signalIdentity: market.signalIdentity,
      horizons,
      incrementalOneBar: incremental,
      fixedOosStrategies: strategies,
    };
  }

  if (trials.length !== 20 || trials.some(trial => !Number.isFinite(trial.pValue))) {
    throw new Error(`declared BH family must contain exactly 20 finite p-values (got ${trials.length})`);
  }
  benjaminiHochberg(trials);
  for (const trial of trials) marketResults[trial.market].horizons[trial.horizonBars].test.regression.qValueBh20 = trial.qValue;

  const decisions = {};
  for (const spec of MARKET_SPECS) {
    const result = marketResults[spec.key];
    const one = result.horizons[1];
    const q = one.test.regression.qValueBh20;
    const contrarianAndStable = one.test.regression.slopePer10 < 0 && one.train.regression.slopePer10 < 0;
    const survivesFdr = q <= 0.05;
    const incremental = result.incrementalOneBar.relativeMseImprovementVsControls > 0;
    const fearRule = result.fixedOosStrategies.strategies.fear_only;
    const economic = fearRule.annualizedReturnMinusBuyHold > 0 && fearRule.sharpeMinusBuyHold > 0;
    let classification;
    if (!contrarianAndStable || !survivesFdr) classification = 'No robust evidence of return prediction';
    else if (!incremental) classification = 'Statistically suggestive but not incremental';
    else if (!economic) classification = 'Incrementally predictive but not economically useful under the frozen diagnostic';
    else classification = 'Potentially predictive, but exploratory and not ready for real capital';
    decisions[spec.key] = {
      contrarianHoldoutSignAndTrainStable: contrarianAndStable,
      oneBarBhQAtMost005: survivesFdr,
      controlsPlusScoreImprovesMse: incremental,
      fearOnlyBeatsBuyHoldCagrAndSharpe: economic,
      classification,
    };
  }

  const result = {
    schemaVersion: 2,
    generatedAt,
    execution,
    inputSnapshot: {
      path: portablePath(inputInfo.file),
      sha256: inputInfo.sha256,
      checksumFile: portablePath(inputInfo.checksumFile),
      checksumVerified: inputInfo.checksumVerified,
      snapshotCreatedAt: snapshot.createdAt,
    },
    status: 'EXPLORATORY_ONLY_NOT_READY_FOR_REAL_CAPITAL',
    frozenDesign: {
      protocolPath: portablePath(PROTOCOL_PATH),
      signalExecutionLagBars: 1,
      horizonsBars: HORIZONS,
      trainingFraction: 0.60,
      holdoutFraction: HOLDOUT_FRACTION,
      splitOverlapPurge: 'Training observations must have exitIndex <= first holdout entryIndex; the original 60% boundary still defines the holdout and incremental forecast slice.',
      componentsRequired: REQUIRED_COMPONENTS,
      cryptoAssetsRequired: 7,
      forwardReturn: 'simple close-to-close return from t+1 entry close to t+1+h exit close',
      neweyWest: 'OLS score scaled per 10 points; Bartlett HAC bandwidth max(horizon, floor(4*(N/100)^(2/9))), capped N-3; two-sided asymptotic normal p-value',
      fdr: 'Benjamini-Hochberg over exactly 20 holdout slope tests',
      incremental: `Expanding 21-observation blocks; controls are lagged 1/5/20-bar returns, annualized 20-bar realized volatility, and close/125-bar SMA trend; all scaling fitted on available training only`,
      strategies: RULES.map(rule => rule.name),
      strategyCost: '10 basis points per absolute 0/1 position change, including initial entry; zero cash return',
      missingSignals: 'Never backfilled; fixed-rule strategy is in cash for a period lacking a strict signal',
      completeBarPolicy: snapshot.sources.targetPrices.partialBarPolicy,
      primaryHypothesis: 'Higher greed predicts lower future return; statistical p-values are two-sided',
    },
    caveats: [
      'The equity series are repository-owned CNN-inspired composites, not CNN historical indices.',
      'The crypto score is a repository-owned fixed-basket price proxy; BTC-USD is both its benchmark input and the tested return target, but it is not the whole basket.',
      '^OMXSBGI and ^STOXX are indices and are not directly investable.',
      'Inputs are current-history downloads, not point-in-time vintages; historical revisions and survivorship effects cannot be excluded.',
      'The equity model may carry an individual component score for up to seven calendar days across source-market holidays.',
      'The v1 crypto basket was selected in August 2026 from surviving assets, so its historical test has explicit hindsight-selection and survivorship risk.',
      'Yahoo chart data are convenient research inputs, not an exchange-grade execution feed.',
      'Costs omit spreads, slippage, taxes, funding/cash yield, borrow/custody, and venue constraints.',
      'Multiple descriptive band and strategy views are secondary; only the declared 20 slope tests receive BH adjustment.',
    ],
    trialLedger: trials,
    decisions,
    markets: marketResults,
  };
  result.analysisFingerprintSha256 = sha256Buffer(Buffer.from(canonicalJson({
    status: result.status,
    frozenDesign: result.frozenDesign,
    trialLedger: result.trialLedger,
    decisions: result.decisions,
    markets: result.markets,
  }), 'utf8'));
  return result;
}

function percent(value, digits = 2) {
  return value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(digits)}%`;
}

function number(value, digits = 3) {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function markdownReport(results) {
  const lines = [];
  lines.push('# Fear & Greed predictive backtest');
  lines.push('');
  lines.push(`Generated: ${results.generatedAt}`);
  lines.push('');
  lines.push('> **Gate: exploratory historical evidence only; not ready for real capital.** The inputs are not point-in-time vintages, BTC is an assumed target, and two equity targets are non-investable indices.');
  lines.push('');
  lines.push('## Bottom line');
  lines.push('');
  lines.push('| Market | 1-bar holdout slope / 10 score pts | p | BH q (20) | Train/test sign | Score MSE improvement vs controls | Fear-only CAGR | Buy/hold CAGR | Classification |');
  lines.push('|---|---:|---:|---:|---|---:|---:|---:|---|');
  for (const spec of MARKET_SPECS) {
    const market = results.markets[spec.key];
    const one = market.horizons[1];
    const incremental = market.incrementalOneBar;
    const strategy = market.fixedOosStrategies;
    lines.push(`| ${spec.name} | ${percent(one.test.regression.slopePer10)} | ${number(one.test.regression.pValue, 4)} | ${number(one.test.regression.qValueBh20, 4)} | ${one.signStability.trainSlopeSign} / ${one.signStability.testSlopeSign} | ${percent(incremental.relativeMseImprovementVsControls)} | ${percent(strategy.strategies.fear_only.annualizedReturn)} | ${percent(strategy.benchmark.annualizedReturn)} | ${results.decisions[spec.key].classification} |`);
  }
  lines.push('');
  lines.push('A negative slope supports the frozen contrarian hypothesis. Positive score MSE improvement means controls plus score beat controls alone out of sample. Neither condition by itself proves tradable value.');
  lines.push('');
  lines.push('## Primary 20-test ledger');
  lines.push('');
  lines.push('| Market | Horizon | N train/test | Purged at split | Holdout dates | Pearson | Spearman | Slope / 10 pts | 95% NW CI | p | BH q | Sign stable? | Q1-Q4 holdout return |');
  lines.push('|---|---:|---:|---:|---|---:|---:|---:|---|---:|---:|---|---:|');
  for (const trial of results.trialLedger) {
    const h = results.markets[trial.market].horizons[trial.horizonBars];
    lines.push(`| ${trial.market} | ${trial.horizonBars} | ${trial.trainN}/${trial.testN} | ${trial.purgedTrainingOverlapN} | ${trial.testFirstDate} to ${trial.testLastDate} | ${number(h.test.pearson)} | ${number(h.test.spearman)} | ${percent(h.test.regression.slopePer10)} | [${percent(h.test.regression.ci95Low)}, ${percent(h.test.regression.ci95High)}] | ${number(trial.pValue, 4)} | ${number(trial.qValue, 4)} | ${h.signStability.sameSlopeSign ? 'yes' : 'no'} | ${percent(h.trainDefinedQuartiles.test.fearfulMinusGreedy)} |`);
  }
  lines.push('');
  lines.push('Q1-Q4 is the mean forward return below the training 25th-percentile score minus the mean above the training 75th percentile. The quartile cutoffs never use holdout scores. Training outcomes extending beyond the first holdout entry are purged at every horizon.');
  lines.push('');
  lines.push('## Fixed-band conditional holdout returns');
  lines.push('');
  lines.push('| Market | Horizon | Extreme Fear | Fear | Neutral | Greed | Extreme Greed |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|');
  const bandOrder = ['Extreme Fear', 'Fear', 'Neutral', 'Greed', 'Extreme Greed'];
  for (const trial of results.trialLedger) {
    const bands = results.markets[trial.market].horizons[trial.horizonBars].fixedBands.test;
    const cells = bandOrder.map(label => `${percent(bands[label].mean)} (n=${bands[label].n})`);
    lines.push(`| ${trial.market} | ${trial.horizonBars} | ${cells.join(' | ')} |`);
  }
  lines.push('');
  lines.push('These are provider-defined semantic bands, not thresholds selected from the completed history. Empty cells have no holdout observations.');
  lines.push('');
  lines.push('## Incremental one-bar forecast');
  lines.push('');
  lines.push('| Market | Forecast rows | Mean MSE | Controls MSE | Controls + score MSE | OOS R2 controls | OOS R2 full | Delta R2 | MSE improvement vs controls |');
  lines.push('|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const spec of MARKET_SPECS) {
    const x = results.markets[spec.key].incrementalOneBar;
    lines.push(`| ${spec.name} | ${x.forecastRows} | ${number(x.mseHistoricalMean, 8)} | ${number(x.mseControls, 8)} | ${number(x.mseControlsPlusScore, 8)} | ${percent(x.oosR2ControlsVsHistoricalMean)} | ${percent(x.oosR2ControlsPlusScoreVsHistoricalMean)} | ${percent(x.deltaOosR2VsControls)} | ${percent(x.relativeMseImprovementVsControls)} |`);
  }
  lines.push('');
  lines.push(`Models refit in expanding ${WALK_FORWARD_BLOCK}-observation blocks. A training outcome is admitted only when its exit close is already known by the block's first forecast date. Predictor scaling is recomputed inside each training window.`);
  lines.push('');
  lines.push('## Fixed 1-bar holdout economic diagnostics');
  lines.push('');
  lines.push('| Market | Rule | Exposure | Changes | Total return | CAGR | Ann. vol | Sharpe (cash=0) | Max DD | CAGR minus buy/hold |');
  lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|---:|');
  for (const spec of MARKET_SPECS) {
    const s = results.markets[spec.key].fixedOosStrategies;
    lines.push(`| ${spec.name} | Buy and hold | ${percent(s.benchmark.exposure)} | ${s.benchmark.positionChanges} | ${percent(s.benchmark.totalReturn)} | ${percent(s.benchmark.annualizedReturn)} | ${percent(s.benchmark.annualizedVolatility)} | ${number(s.benchmark.sharpeZeroCash)} | ${percent(s.benchmark.maxDrawdown)} | — |`);
    for (const rule of RULES) {
      const x = s.strategies[rule.key];
      lines.push(`| ${spec.name} | ${rule.name} | ${percent(x.exposure)} | ${x.positionChanges} | ${percent(x.totalReturn)} | ${percent(x.annualizedReturn)} | ${percent(x.annualizedVolatility)} | ${number(x.sharpeZeroCash)} | ${percent(x.maxDrawdown)} | ${percent(x.annualizedReturnMinusBuyHold)} |`);
    }
  }
  lines.push('');
  lines.push('Every absolute position change costs 10 bp, including the initial buy. Cash return is zero. These are exposure-dependent diagnostics, not standalone significance tests or executable returns.');
  lines.push('');
  lines.push('## Data coverage and identity');
  lines.push('');
  lines.push('| Market | Signal | Target | Completed price bars | All signal rows | Strict signal rows | 1-bar eligible | Price mode |');
  lines.push('|---|---|---|---:|---:|---:|---:|---|');
  for (const spec of MARKET_SPECS) {
    const market = results.markets[spec.key];
    const h = market.horizons[1];
    const snapshotMarket = results._snapshotMarkets && results._snapshotMarkets[spec.key];
    lines.push(`| ${spec.name} | ${spec.kind === 'crypto' ? 'repo five-component model v1' : 'repo six-component model'} | ${spec.target}${spec.investable ? '' : ' (non-investable index)'} | ${snapshotMarket ? snapshotMarket.priceRows : 'see JSON'} | ${h.audit.allSignalRows} | ${h.audit.strictSignalRows} | ${h.audit.eligible} | ${market.priceAdjustment} |`);
  }
  lines.push('');
  lines.push('Input snapshot: `' + results.inputSnapshot.path + '`');
  lines.push('');
  lines.push('SHA-256: `' + results.inputSnapshot.sha256 + '` (checksum verified: ' + String(results.inputSnapshot.checksumVerified) + ')');
  lines.push('');
  lines.push('Analysis fingerprint: `' + results.analysisFingerprintSha256 + '` (compare this across live and saved-snapshot runs)');
  lines.push('');
  lines.push('Equity identity: the repository recomputes a CNN-inspired score from current Yahoo histories. It is not a licensed or archived CNN series. The strict primary sample requires all six configured components; the model can carry an individual component score across a source-market holiday for up to seven calendar days.');
  lines.push('');
  lines.push('Crypto identity: the repository recomputes its frozen five-component v1 score from completed UTC daily Yahoo closes for BTC plus six fixed altcoins. The strict primary sample requires all five components and all seven assets. `BTC-USD` is both the model benchmark and the tested return target, but it does not represent the whole basket.');
  lines.push('');
  lines.push('## Timing and limitations');
  lines.push('');
  lines.push('- Exact signal/target date match only. A score on bar t enters at close t+1 and exits at close t+1+h.');
  lines.push('- The retrieval-local current target bar is excluded to avoid a partially formed Yahoo candle.');
  lines.push('- Current-history downloads are not point-in-time vintages. Provider revisions, adjusted-close restatements, and symbol survivorship cannot be ruled out.');
  lines.push('- `^OMXSBGI` and `^STOXX` are non-investable indices. A real implementation needs an identified tradable vehicle and tracking/currency/cost analysis.');
  lines.push('- The backtest omits bid/ask spreads, slippage, tax, cash yield, custody/funding, and operational constraints.');
  lines.push('- Fixed-band and strategy tables are secondary diagnostics. The exact primary inference family is the 20 holdout score slopes shown above.');
  lines.push('- Even favorable historical results require forward-frozen score collection, timestamp validation, paper trading, risk-matched benchmarks, and venue-specific costs before capital use.');
  lines.push('');
  lines.push('## Sources');
  lines.push('');
  lines.push(`- Yahoo chart endpoint template: ${YAHOO_CHART_TEMPLATE}`);
  lines.push('- Local crypto construction: `cryptofg.js` plus `data/config.json`; their hashes and the frozen model definition are in the snapshot.');
  lines.push('- Local equity construction: `marketfg.js` plus `data/config.json`; their hashes are in the snapshot.');
  return lines.join('\n');
}

function writeResults(results, outputRoot, stamp) {
  const dir = path.join(outputRoot, 'results');
  fs.mkdirSync(dir, { recursive: true });
  const jsonFile = path.join(dir, `fear-greed-results-${stamp}.json`);
  const reportFile = path.join(dir, `fear-greed-report-${stamp}.md`);
  const serializable = { ...results };
  delete serializable._snapshotMarkets;
  fs.writeFileSync(jsonFile, canonicalJson(serializable), 'utf8');
  fs.writeFileSync(reportFile, markdownReport(results) + '\n', 'utf8');
  return { jsonFile, reportFile, jsonSha256: sha256File(jsonFile), reportSha256: sha256File(reportFile) };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(usage()); return; }
  const stamp = runStamp();
  let inputInfo;
  let execution;
  if (args.snapshot) {
    inputInfo = readSnapshot(args.snapshot);
    execution = { mode: 'saved-snapshot-rerun', networkUsed: false, executedAt: new Date().toISOString(), nodeVersion: process.version };
  } else {
    const snapshot = await collectLiveSnapshot();
    inputInfo = { snapshot, ...writeSnapshot(snapshot, args.outDir, stamp) };
    execution = { mode: 'live-fetch-and-freeze', networkUsed: true, executedAt: new Date().toISOString(), nodeVersion: process.version };
  }
  execution.currentBacktestSha256 = sha256File(__filename);
  execution.snapshotBacktestSha256 = inputInfo.snapshot.sourceCode && inputInfo.snapshot.sourceCode.backtestSha256 || null;
  execution.codeMatchesFrozenSnapshot = execution.snapshotBacktestSha256 === execution.currentBacktestSha256;
  execution.currentProtocolSha256 = sha256File(PROTOCOL_PATH);
  execution.snapshotProtocolSha256 = inputInfo.snapshot.sourceCode && inputInfo.snapshot.sourceCode.protocolSha256 || null;
  execution.protocolMatchesFrozenSnapshot = execution.snapshotProtocolSha256 === execution.currentProtocolSha256;
  const results = analyzeSnapshot(inputInfo.snapshot, inputInfo, execution);
  results._snapshotMarkets = Object.fromEntries(inputInfo.snapshot.markets.map(market => [market.key, { priceRows: market.prices.rows.length }]));
  const outputs = writeResults(results, args.outDir, stamp);
  console.log(JSON.stringify({
    status: results.status,
    execution,
    input: { path: inputInfo.file, sha256: inputInfo.sha256, checksumVerified: inputInfo.checksumVerified },
    outputs,
    decisions: results.decisions,
  }, null, 2));
}

main().catch(error => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});
