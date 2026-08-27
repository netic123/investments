'use strict';

// EUROPE-LOCKBOX-V1 prospective collector (activation record:
// research/EUROPE_LOCKBOX_V1_ACTIVATION.md). Collects, once per UTC day, the
// facts needed to score the preregistered EUROPE-MONTHLY-CONTRARIAN-V1
// candidate on data nobody has seen yet: the production europe Fear & Greed
// score (all five market scores are recorded when available), the executable
// instrument's recent daily closes (XSX6.DE, accumulating = total return),
// and the DTB3 cash rate. Entries are append-only with revision-zero-primary
// semantics: the first entry written for a date is permanent; a re-run on the
// same date is a no-op. Each entry chains the SHA-256 of its predecessor, so
// any later edit of history breaks the chain for every subsequent entry.
// Raw upstream payloads are hashed into each entry but not republished
// (redistribution compromise documented in the activation record).
//
//   node scripts/lockbox-collect.js --init   # write GENESIS.json once
//   node scripts/lockbox-collect.js          # collect today's entry

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const LOCKBOX_DIR = path.join(ROOT, 'lockbox');
const ENTRIES_DIR = path.join(LOCKBOX_DIR, 'entries');
const GENESIS_PATH = path.join(LOCKBOX_DIR, 'GENESIS.json');
const CANDIDATE_PROTOCOL = path.join(ROOT, 'research', 'FEAR_GREED_EUROPE_MONTHLY_CONTRARIAN_LOCKBOX_PROTOCOL.md');

const ENTRY_SCHEMA = 'europe-lockbox-entry-v1';
const INSTRUMENT_SYMBOL = 'XSX6.DE';
const INSTRUMENT_NAME = 'Xtrackers Stoxx Europe 600 UCITS ETF 1C (accumulating; price series is total return)';
const USER_AGENT = 'netic123-investments-lockbox/1.0';
const RECENT_BARS = 15;

function sha256(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('non-finite number in lockbox entry');
  return value;
}

function canonicalJson(value) { return JSON.stringify(canonicalize(value), null, 1); }

function writeWithSidecar(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  fs.writeFileSync(`${file}.sha256`, `${sha256(Buffer.from(text))}  ${path.basename(file)}\n`);
}

function utcDate() { return new Date().toISOString().slice(0, 10); }

function listEntryDates(entriesDir = ENTRIES_DIR) {
  if (!fs.existsSync(entriesDir)) return [];
  return fs.readdirSync(entriesDir)
    .filter(name => /^\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map(name => name.slice(0, 10))
    .sort();
}

function previousEntrySha(entriesDir = ENTRIES_DIR, genesisPath = GENESIS_PATH) {
  const dates = listEntryDates(entriesDir);
  const file = dates.length
    ? path.join(entriesDir, `${dates[dates.length - 1]}.json`)
    : genesisPath;
  if (!fs.existsSync(file)) throw new Error('lockbox is not initialized: run --init first');
  return { previousDate: dates.length ? dates[dates.length - 1] : 'GENESIS', previousSha256: sha256(fs.readFileSync(file)) };
}

async function fetchWithFallback(pathAndQuery) {
  let lastError;
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const response = await fetch(`https://${host}${pathAndQuery}`, {
        headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(20000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const bytes = Buffer.from(await response.arrayBuffer());
      return { bytes, json: JSON.parse(bytes.toString('utf8')) };
    } catch (error) { lastError = error; }
  }
  throw lastError;
}

async function fetchInstrument(symbol = INSTRUMENT_SYMBOL) {
  const { bytes, json } = await fetchWithFallback(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=2mo&interval=1d`);
  const result = json.chart && json.chart.result && json.chart.result[0];
  if (!result) throw new Error(`instrument ${symbol}: no chart result`);
  const timezone = result.meta.exchangeTimezoneName;
  const quote = result.indicators.quote[0];
  const adj = result.indicators.adjclose && result.indicators.adjclose[0];
  const bars = [];
  for (let i = 0; i < result.timestamp.length; i++) {
    const close = quote.close[i];
    if (!(close > 0)) continue;
    const date = new Date(result.timestamp[i] * 1000).toLocaleDateString('sv-SE', { timeZone: timezone });
    bars.push({ date, close, adjclose: adj && adj.adjclose[i] > 0 ? adj.adjclose[i] : null });
  }
  const deduped = new Map(bars.map(bar => [bar.date, bar]));
  const recent = [...deduped.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-RECENT_BARS);
  if (recent.length < 5) throw new Error(`instrument ${symbol}: too few bars`);
  return { symbol, name: INSTRUMENT_NAME, currency: result.meta.currency, timezone, bars: recent, rawSha256: sha256(bytes) };
}

async function fetchCash() {
  const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=DTB3&cosd=${start}`;
  const response = await fetch(url, { headers: { 'user-agent': USER_AGENT }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) throw new Error(`FRED HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const lines = bytes.toString('utf8').trim().split(/\r?\n/);
  const rows = [];
  for (const line of lines.slice(1)) {
    const [date, value] = line.split(',');
    if (/^\d{4}-\d{2}-\d{2}$/.test(date) && value !== '.' && Number.isFinite(Number(value))) {
      rows.push({ date, percent: Number(value) });
    }
  }
  if (!rows.length) throw new Error('FRED DTB3: no usable rows');
  return { series: 'DTB3', sourceUrl: url, rows: rows.slice(-10), rawSha256: sha256(bytes) };
}

function modelIdentity() {
  return {
    marketfgSha256: sha256(fs.readFileSync(path.join(ROOT, 'marketfg.js'))),
    configSha256: sha256(fs.readFileSync(path.join(ROOT, 'data', 'config.json'))),
  };
}

function compactMarket(market) {
  return {
    score: market.score, label: market.label, asOf: market.asOf, n: market.n,
    components: Object.fromEntries(Object.entries(market.components || {}).map(([key, component]) => [key, {
      score: component.score, raw: component.raw, asOf: component.asOf,
    }])),
  };
}

function buildEntry({ entryDate, marketfgResult, instrument, cash, chain, identity, collectedAt }) {
  const europe = marketfgResult.markets && marketfgResult.markets.europe;
  if (!europe || !Number.isFinite(europe.score)) throw new Error('europe score missing; refusing to write an entry');
  const otherMarkets = {};
  for (const [key, market] of Object.entries(marketfgResult.markets)) {
    if (key !== 'europe' && market && Number.isFinite(market.score)) {
      otherMarkets[key] = { score: market.score, label: market.label, asOf: market.asOf };
    }
  }
  return {
    schema: ENTRY_SCHEMA,
    entryDate,
    collectedAt,
    candidate: 'EUROPE-MONTHLY-CONTRARIAN-V1',
    modelIdentity: { modelId: marketfgResult.model.id, version: marketfgResult.model.version, ...identity },
    europe: compactMarket(europe),
    otherMarkets,
    instrument,
    cash,
    failedMarkets: marketfgResult.failed || {},
    previousEntry: chain,
  };
}

function writeEntryIfAbsent(entry, entriesDir = ENTRIES_DIR) {
  const file = path.join(entriesDir, `${entry.entryDate}.json`);
  if (fs.existsSync(file)) return { written: false, file };
  writeWithSidecar(file, canonicalJson(entry));
  return { written: true, file };
}

function writeGenesis() {
  if (fs.existsSync(GENESIS_PATH)) throw new Error('GENESIS.json already exists; the lockbox may be initialized exactly once');
  const genesis = {
    schema: 'europe-lockbox-genesis-v1',
    activatedAt: new Date().toISOString(),
    candidate: 'EUROPE-MONTHLY-CONTRARIAN-V1',
    candidateProtocolSha256: sha256(fs.readFileSync(CANDIDATE_PROTOCOL)),
    activationRecord: 'research/EUROPE_LOCKBOX_V1_ACTIVATION.md',
    instrument: { symbol: INSTRUMENT_SYMBOL, name: INSTRUMENT_NAME },
    rule: 'decide on the last trading day of each calendar month: sell when displayed integer >= 85, buy when <= 35; execution next close; primary endpoint after >= 60 prospective monthly decisions',
    ...modelIdentity(),
    note: 'Entries are append-only, revision-zero-primary, and chained by SHA-256. Nothing in this store is an outcome claim.',
  };
  writeWithSidecar(GENESIS_PATH, canonicalJson(genesis));
  return genesis;
}

async function collect() {
  const entryDate = utcDate();
  const existing = path.join(ENTRIES_DIR, `${entryDate}.json`);
  if (fs.existsSync(existing)) {
    process.stdout.write(`already collected ${entryDate} (revision-zero-primary; no changes)\n`);
    return { written: false };
  }
  const chain = previousEntrySha();
  const { getMarketFearGreed } = require(path.join(ROOT, 'marketfg.js'));
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
  const marketfgResult = await getMarketFearGreed(config.marketFearGreed);
  if (!marketfgResult.ok || marketfgResult.failed && marketfgResult.failed.europe) {
    throw new Error(`market model failed: ${JSON.stringify(marketfgResult.failed || {})}`);
  }
  const [instrument, cash] = await Promise.all([fetchInstrument(), fetchCash()]);
  // Completed sessions only: the entry's own UTC date may still be trading (or
  // carry a partial Yahoo bar), so it is sealed by a LATER entry, never this
  // one. Entry 2026-08-27 predates this rule — see the activation record.
  instrument.bars = instrument.bars.filter(bar => bar.date < entryDate);
  if (instrument.bars.length < 5) throw new Error('too few completed instrument bars after excluding the current session');
  const entry = buildEntry({
    entryDate, marketfgResult, instrument, cash, chain,
    identity: modelIdentity(), collectedAt: new Date().toISOString(),
  });
  const result = writeEntryIfAbsent(entry);
  process.stdout.write(`${result.written ? 'collected' : 'skipped'} ${entryDate}: europe ${entry.europe.score} (${entry.europe.label}, asOf ${entry.europe.asOf}), ${INSTRUMENT_SYMBOL} ${instrument.bars[instrument.bars.length - 1].close} @ ${instrument.bars[instrument.bars.length - 1].date}\n`);
  return result;
}

async function main() {
  if (process.argv.includes('--init')) {
    const genesis = writeGenesis();
    process.stdout.write(`lockbox initialized: candidate ${genesis.candidate}, instrument ${genesis.instrument.symbol}\n`);
    return;
  }
  await collect();
}

module.exports = {
  ENTRY_SCHEMA, INSTRUMENT_SYMBOL, LOCKBOX_DIR, ENTRIES_DIR, GENESIS_PATH,
  sha256, canonicalJson, writeWithSidecar, listEntryDates, previousEntrySha,
  buildEntry, writeEntryIfAbsent, writeGenesis, compactMarket, utcDate,
};

if (require.main === module) {
  main().catch(error => { process.stderr.write(`lockbox collect failed: ${error.message}\n`); process.exit(1); });
}
