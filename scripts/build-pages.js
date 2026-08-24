#!/usr/bin/env node
'use strict';

// Build the public GitHub Pages artifact from the app's existing HTTP contract.
// The Node server exists only for the duration of this build; Pages receives a
// strict allowlist of HTML + JSON files and never receives repository internals.

const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '_site');
const API_OUT = path.join(OUT, 'api');
const ENDPOINTS = ['config', 'holdings', 'nav', 'perf', 'quotes', 'marketfg'];
const EXPECTED_FILES = ['.nojekyll', 'index.html', 'api/build.json', ...ENDPOINTS.map(name => `api/${name}.json`)].sort();

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const EXPECTED_MARKET_SYMBOLS = {
  crypto: {
    index: 'BTC-USD', vol: null, bond: 'IEF', hy: 'HYG', ig: 'LQD',
    small: { id: 'CRYPTO-NONCORE-EW', method: 'equalWeightReturns', symbols: ['SOL-USD', 'XRP-USD', 'ADA-USD', 'DOGE-USD', 'BNB-USD'] },
    large: { id: 'CRYPTO-CORE-EW', method: 'equalWeightReturns', symbols: ['BTC-USD', 'ETH-USD'] },
  },
  sweden: { index: '^OMXSBGI', vol: null, bond: 'XACT-OBLIGATION.ST', hy: '0P0001C87Y.ST', ig: '0P00000KIW.ST', small: 'XACT-SMABOLAG.ST', large: 'XACT-SVERIGE.ST' },
  usa: { index: 'SPY', vol: '^VIX', bond: 'IEF', hy: 'HYG', ig: 'LQD', small: 'IWM', large: null },
  europe: { index: '^STOXX', vol: null, bond: 'SXRQ.DE', hy: 'IHYG.L', ig: 'IEAC.L', small: 'EXSE.DE', large: 'EXSA.DE' },
  global: { index: 'ACWI', vol: '^VIX', bond: 'IEF', hy: 'HYLD.L', ig: 'CORP.L', small: 'WSML.L', large: 'IWDA.L' },
};

function normalizedMapping(symbols) {
  const actual = symbols || {};
  return Object.fromEntries(['index', 'vol', 'bond', 'hy', 'ig', 'small', 'large'].map(key => {
    const value = actual[key];
    return [key, value && typeof value === 'object' ? { id: value.id, method: value.method, symbols: value.symbols } : value == null ? null : value];
  }));
}

function assertMarketMapping(name, symbols, context) {
  assert(JSON.stringify(normalizedMapping(symbols)) === JSON.stringify(EXPECTED_MARKET_SYMBOLS[name]), `${context}: ${name} raw-series mapping drifted`);
}

function gitValue(args, fallback = 'unknown') {
  try { return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || fallback; }
  catch { return fallback; }
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const socket = net.createServer();
    socket.unref();
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', () => {
      const address = socket.address();
      socket.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000), ...options });
  const text = await response.text();
  let value;
  try { value = JSON.parse(text); }
  catch { throw new Error(`${url} returned invalid JSON`); }
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}: ${value.error || response.statusText}`);
  return value;
}

async function waitForServer(base, child, logs) {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (child.exitCode != null) throw new Error(`snapshot server exited early (${child.exitCode})\n${logs.text}`);
    try { await fetchJson(`${base}/api/config`); return; }
    catch { await delay(250); }
  }
  throw new Error(`snapshot server did not start within 30 seconds\n${logs.text}`);
}

function validateSnapshot(data, examplePositions) {
  const { config, holdings, nav, perf, quotes, marketfg } = data;
  assert(config && typeof config === 'object', 'config is missing');
  assert(config.positionsMeta && config.positionsMeta.demo === true && config.positionsMeta.source === 'example', 'public build did not select the demo watchlist');
  assert(JSON.stringify(config.myPositions) === JSON.stringify(examplePositions), 'public build positions differ from data/positions.example.json');
  assert(!config.sources || !Object.prototype.hasOwnProperty.call(config.sources, 'fearGreed'), 'retired third-party crypto index source is still configured');
  assert(!Object.prototype.hasOwnProperty.call(config, 'cryptoFearGreed'), 'retired separate crypto model config is still present');
  assert(config.marketFearGreed && config.marketFearGreed.modelId === 'investments-unified-fear-greed' && config.marketFearGreed.version === 1, 'unified model config is missing or has drifted');
  assert(config.marketFearGreed.window === 252 && config.marketFearGreed.minWindowPoints === 126 && config.marketFearGreed.minComponents === 6 && config.marketFearGreed.fillDays === 7, 'unified model parameters have drifted');
  assert(JSON.stringify(Object.keys(config.marketFearGreed.markets || {}).sort()) === JSON.stringify(['crypto', 'europe', 'global', 'sweden', 'usa']), 'unified config must contain exactly five markets');
  assert(config.marketFearGreed.markets.crypto.barPolicy === 'completed-utc-date', 'Crypto completed-bar policy has drifted');
  for (const name of ['crypto', 'sweden', 'usa', 'europe', 'global']) assertMarketMapping(name, config.marketFearGreed.markets[name].symbols, 'config');

  assert(holdings && holdings.latest && typeof holdings.latest.date === 'string', 'holdings has no usable latest snapshot');
  assert(holdings.latest.rows && typeof holdings.latest.rows === 'object', 'holdings rows are missing');
  assert(nav && typeof nav.date === 'string' && Array.isArray(nav.history) && nav.history.length > 1, 'NAV data is incomplete');
  assert(perf && Array.isArray(perf.monthly) && perf.monthly.length > 0, 'performance data is incomplete');
  assert(quotes && typeof quotes === 'object' && Object.values(quotes).some(q => q && Number.isFinite(q.price)), 'all quotes are missing');
  assert(marketfg && marketfg.ok === true && marketfg.markets && typeof marketfg.markets === 'object', 'market Fear & Greed is invalid');
  assert(marketfg.model && marketfg.model.id === 'investments-unified-fear-greed' && marketfg.model.version === 1 && marketfg.model.owner === 'repository', 'market result does not identify the unified repository model');
  assert(marketfg.model.window === 252 && marketfg.model.minWindowPoints === 126 && marketfg.model.minComponents === 6 && marketfg.model.fillDays === 7, 'unified result parameters have drifted');
  assert(JSON.stringify(Object.keys(marketfg.markets).sort()) === JSON.stringify(['crypto', 'europe', 'global', 'sweden', 'usa']), 'unified model must return exactly the five configured markets');
  const componentKeys = ['breadth', 'credit', 'momentum', 'safeHaven', 'strength', 'volatility'];
  for (const name of ['crypto', 'sweden', 'usa', 'europe', 'global']) {
    const market = marketfg.markets[name];
    assert(market && Number.isFinite(market.score) && market.score >= 0 && market.score <= 100, `market Fear & Greed is missing ${name}`);
    assert(Array.isArray(market.history) && market.history.length > 1, `market Fear & Greed history is incomplete for ${name}`);
    assert(market.n === 6 && market.total === 6, `${name} is not using all six unified-model components`);
    assert(JSON.stringify(Object.keys(market.components || {}).sort()) === JSON.stringify(componentKeys), `${name} component contract is incomplete`);
    assert(Object.values(market.components).every(component => Number.isFinite(component.score) && component.asOf), `${name} has an unavailable current component`);
    assert(market.history.every(row => Number.isFinite(row.score) && row.score >= 0 && row.score <= 100 && row.n === 6), `${name} history changes the unified model definition`);
    assertMarketMapping(name, market.mapping && market.mapping.symbols, 'result');
  }
  const crypto = marketfg.markets.crypto;
  assert(crypto.mapping && crypto.mapping.barPolicy === 'completed-utc-date' && crypto.intraday === false, 'Crypto result does not prove completed UTC bars');
  assert(crypto.asOf < new Date().toISOString().slice(0, 10), 'Crypto result includes the still-forming current UTC bar');
}

async function captureSnapshot(base, examplePositions) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const pairs = await Promise.all(ENDPOINTS.map(async name => [name, await fetchJson(`${base}/api/${name}`)]));
      const data = Object.fromEntries(pairs);
      validateSnapshot(data, examplePositions);
      return data;
    } catch (error) {
      lastError = error;
      if (attempt === 3) break;
      process.stderr.write(`Snapshot attempt ${attempt} failed: ${error.message}. Retrying…\n`);
      try { await fetchJson(`${base}/api/refresh?force=1`, { method: 'POST' }); } catch {}
      await delay(attempt === 1 ? 12000 : 25000);
    }
  }
  throw lastError;
}

function prepareOutput() {
  assert(path.dirname(OUT) === ROOT && path.basename(OUT) === '_site', 'refusing to clean an unexpected output path');
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(API_OUT, { recursive: true });
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value)}\n`, 'utf8');
}

function artifactFiles(dir, prefix = '') {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), `symbolic links are forbidden in the Pages artifact: ${path.join(prefix, entry.name)}`);
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isDirectory()) files.push(...artifactFiles(path.join(dir, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`unexpected artifact entry: ${relative}`);
  }
  return files.sort();
}

function verifyArtifact(forbiddenSecrets) {
  const actual = artifactFiles(OUT);
  assert(JSON.stringify(actual) === JSON.stringify(EXPECTED_FILES), `unexpected Pages artifact manifest:\n${actual.join('\n')}`);
  for (const relative of actual.filter(name => name.endsWith('.json'))) {
    JSON.parse(fs.readFileSync(path.join(OUT, relative), 'utf8'));
  }
  for (const secret of forbiddenSecrets) {
    for (const relative of actual) {
      const bytes = fs.readFileSync(path.join(OUT, relative));
      assert(!bytes.includes(Buffer.from(secret)), `an environment secret was found in ${relative}`);
    }
  }
  for (const retiredMarker of ['pro-api.coinmarketcap.com', 'CMC_API_KEY', '/api/feargreed', 'cryptoFearGreed', 'five equally weighted indicators']) {
    for (const relative of actual) {
      const bytes = fs.readFileSync(path.join(OUT, relative));
      assert(!bytes.includes(Buffer.from(retiredMarker)), `retired crypto-index integration marker found in ${relative}`);
    }
  }
}

async function stopChild(child) {
  if (!child || child.exitCode != null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill();
  const graceful = await Promise.race([exited.then(() => true), delay(5000).then(() => false)]);
  if (!graceful && child.exitCode == null) {
    child.kill('SIGKILL');
    await Promise.race([exited, delay(5000)]);
  }
}

async function main() {
  const example = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'positions.example.json'), 'utf8'));
  assert(Array.isArray(example.myPositions), 'data/positions.example.json has no myPositions list');
  const forbiddenSecrets = ['GH_TOKEN', 'GITHUB_TOKEN']
    .map(name => process.env[name]).filter(value => typeof value === 'string' && value.length >= 8);

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'investments-pages-'));
  const snapshotPath = path.join(temp, 'snapshots.json');
  const sourceSnapshots = path.join(ROOT, 'data', 'snapshots.json');
  if (fs.existsSync(sourceSnapshots)) fs.copyFileSync(sourceSnapshots, snapshotPath);
  else fs.writeFileSync(snapshotPath, '[]\n', 'utf8');

  let child;
  const logs = { text: '' };
  try {
    const port = await getFreePort();
    const base = `http://127.0.0.1:${port}`;
    // Pass only runtime basics. In particular, do not give the public snapshot
    // server GitHub tokens, Actions runtime credentials, or arbitrary secrets.
    const childEnv = {};
    for (const name of ['PATH', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR', 'LANG', 'LC_ALL', 'TZ', 'SSL_CERT_FILE', 'SSL_CERT_DIR', 'NODE_EXTRA_CA_CERTS']) {
      if (process.env[name]) childEnv[name] = process.env[name];
    }
    child = spawn(process.execPath, [path.join(ROOT, 'server.js')], {
      cwd: ROOT,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...childEnv,
        PORT: String(port),
        NO_OPEN: '1',
        INVESTMENTS_PUBLIC_BUILD: '1',
        INVESTMENTS_SNAPSHOT_PATH: snapshotPath,
      },
    });
    const collectLog = chunk => { logs.text = (logs.text + chunk.toString()).slice(-20000); };
    child.stdout.on('data', collectLog);
    child.stderr.on('data', collectLog);

    await waitForServer(base, child, logs);
    const data = await captureSnapshot(base, example.myPositions);
    const generatedAt = new Date().toISOString();
    const build = {
      generatedAt,
      commit: process.env.GITHUB_SHA || gitValue(['rev-parse', 'HEAD']),
      ref: process.env.GITHUB_REF_NAME || gitValue(['branch', '--show-current']),
      dataMode: 'build-time snapshot',
      watchlist: 'demo',
      refreshTrigger: 'push to main',
    };

    prepareOutput();
    const sourceHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    const marker = '<meta name="investments-mode" content="local">';
    assert(sourceHtml.split(marker).length === 2, 'index.html must contain exactly one local-mode marker');
    fs.writeFileSync(path.join(OUT, 'index.html'), sourceHtml.replace(marker, '<meta name="investments-mode" content="static">'), 'utf8');
    fs.writeFileSync(path.join(OUT, '.nojekyll'), '', 'utf8');
    for (const name of ENDPOINTS) writeJson(path.join(API_OUT, `${name}.json`), data[name]);
    writeJson(path.join(API_OUT, 'build.json'), build);
    verifyArtifact(forbiddenSecrets);

    const totalBytes = artifactFiles(OUT).reduce((sum, file) => sum + fs.statSync(path.join(OUT, file)).size, 0);
    process.stdout.write(`${JSON.stringify({ ok: true, output: '_site', files: EXPECTED_FILES.length, bytes: totalBytes, ...build })}\n`);
  } catch (error) {
    if (logs.text) process.stderr.write(`Snapshot server log:\n${logs.text}\n`);
    throw error;
  } finally {
    await stopChild(child);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch(error => {
  process.stderr.write(`Pages build failed: ${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});
