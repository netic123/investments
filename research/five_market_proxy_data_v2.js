'use strict';

// Versioned, deterministic data-only normalizer for the universal-volatility
// proxy study. V2 changes only the cash source boundary: exact already-frozen
// risky and robustness artifacts are reused, while DTB3 comes from a separate
// official FRED CSV beginning in 1995. This module contains no model, signal,
// target, portfolio, return, metric, gate, or result calculation.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const base = require('./five_market_proxy_data');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCHEMA = 'five-market-proxy-input-v2';
const STATUS = base.STATUS;
const FREEZE_MANIFEST_SCHEMA = 'five-market-proxy-freeze-manifest-v2';
const FRED_RECEIPT_SCHEMA = 'fred-dtb3-raw-source-v1';
const AS_OF_DATE = '2026-08-24';

const PATHS = Object.freeze({
  cmbitmSnapshot: base.DEFAULT_CMBITM_SNAPSHOT,
  equityRiskyCache: base.DEFAULT_EQUITY_CACHE,
  robustnessCache: base.DEFAULT_ROBUSTNESS_CACHE,
  fredRaw: path.join(__dirname, 'local-artifacts', 'five-market-proxy-data-v2', 'fred-dtb3-1995-01-01-to-2026-08-24.csv'),
  fredRawSidecar: path.join(__dirname, 'local-artifacts', 'five-market-proxy-data-v2', 'fred-dtb3-1995-01-01-to-2026-08-24.csv.sha256'),
  fredReceipt: path.join(__dirname, 'local-artifacts', 'five-market-proxy-data-v2', 'fred-dtb3-source-2026-08-24.json'),
  fredReceiptSidecar: path.join(__dirname, 'local-artifacts', 'five-market-proxy-data-v2', 'fred-dtb3-source-2026-08-24.json.sha256'),
  output: path.join(__dirname, 'local-artifacts', 'five-market-proxy-data-v2', 'five-market-proxy-input-v2-2026-08-24.json'),
  manifest: path.join(__dirname, 'FIVE_MARKET_PROXY_DATA_FREEZE_V2_2026-08-24.json'),
});

const EXPECTED = Object.freeze({
  cmbitmSnapshot: base.EXPECTED_CMBITM_SNAPSHOT_SHA256,
  equityRiskyCache: base.EXPECTED_EQUITY_CACHE_SHA256,
  robustnessCache: 'dc4e8a6cd9fdc14c5c0efc94eacdd0dcd5185e3c672b2f2e774330901d133bdc',
  fredRaw: '55f7f224f84545a0a577353e7d4f1826025eb28424b51249eabb456396449fcd',
  fredRawSidecar: 'ce6397a8c6be720548ec039e8bccff24a889984fe6771bdc6a4c47dcd0048eef',
  fredReceipt: 'f2816de5c736a806268faaeedd3634720038186c4bebf73b37104aecfde9f7ab',
  fredReceiptSidecar: '3a47772cfd38e409a284e78bf01283b8ad0b988a588c2994fa5748c09189ea09',
  observedYieldRows: 'd6f4e4e41088d8e1b442c8ddfa63ba69118adacdee2070a9b780bb62e490b3fb',
  cashRows: '3aff9a603124d5ee195a544b785802e68b5245ffead03db9d081901e8b24ff4f',
});

const EXPECTED_RISKY_ROWS = Object.freeze({
  crypto: 'f8519b927bde51b9329417dc1f9e31ce0e67920a4c2bb9f3935a0d23e6b92729',
  sweden: '2580ba27aa7d31a1f2d6f41a986092f00461f09f71326472748042421206223e',
  usa: '108dcfd1c3b5f05bd71ccf4b16e7008ca4c369113bfe10ce92a590a202d8d3bc',
  europe: '8b61a4eb0acfea35c0a54d8426280c484a19e3f6458693dd8d974bce54ec7d25',
  global: '9307603c3c78b5fff46fd0563fb8395421e53beceb2faa153ef2f4c03b8491da',
});

class IntegrityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'IntegrityError';
    this.code = 'INTEGRITY_ERROR';
    this.details = details;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function repoPath(file) {
  const relative = path.relative(REPO_ROOT, path.resolve(file));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new IntegrityError(`artifact is outside repository: ${file}`);
  return relative.replace(/\\/g, '/');
}

function readExact(file, expectedSha256) {
  const absolutePath = path.resolve(file);
  const bytes = fs.readFileSync(absolutePath);
  const digest = sha256(bytes);
  if (digest !== expectedSha256) throw new IntegrityError(`${repoPath(absolutePath)} SHA-256 mismatch`, { expectedSha256, actualSha256: digest });
  return { absolutePath, path: repoPath(absolutePath), bytes, sha256: digest };
}

function verifySidecar(artifact, expectedDigest, expectedFilename) {
  const match = /^([0-9a-f]{64})  ([^\r\n]+)\n$/.exec(artifact.bytes.toString('utf8'));
  if (!match || match[1] !== expectedDigest || match[2] !== expectedFilename) {
    throw new IntegrityError(`${artifact.path} is not the exact expected SHA-256 sidecar`);
  }
}

function parseJson(artifact, context) {
  try { return JSON.parse(artifact.bytes.toString('utf8')); }
  catch (error) { throw new IntegrityError(`${context} is invalid JSON`, { cause: error.message }); }
}

function parseFredCsv(bytes, asOfDate = AS_OF_DATE) {
  base.dateMs(asOfDate);
  const lines = Buffer.from(bytes).toString('utf8').replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/);
  if (lines[0] !== 'observation_date,DTB3') throw new IntegrityError(`unexpected FRED CSV header: ${lines[0] || '<empty>'}`);
  const rows = [];
  const seen = new Set();
  for (let index = 1; index < lines.length; index++) {
    if (!lines[index]) continue;
    const columns = lines[index].split(',');
    if (columns.length !== 2) throw new IntegrityError(`FRED CSV row ${index + 1} must contain exactly two columns`);
    const [date, rawValue] = columns;
    base.dateMs(date);
    if (date > asOfDate) throw new IntegrityError(`FRED CSV contains a future row: ${date}`);
    if (seen.has(date)) throw new IntegrityError(`FRED CSV contains a duplicate date: ${date}`);
    seen.add(date);
    if (rawValue === '.' || rawValue === '') continue;
    const percent = Number(rawValue);
    if (!Number.isFinite(percent)) throw new IntegrityError(`FRED CSV contains an invalid DTB3 value on ${date}`);
    rows.push({ date, percent });
  }
  const normalized = base.normalizeYieldRows(rows, asOfDate, 'extended DTB3');
  const receipt = base.history(normalized);
  if (receipt.firstDate !== '1995-01-03' || receipt.lastDate !== '2026-08-21' || receipt.rowCount !== 7916 || receipt.normalizedRowsSha256 !== EXPECTED.observedYieldRows) {
    throw new IntegrityError('extended DTB3 normalized history mismatch', { receipt });
  }
  return normalized;
}

function loadFrozenArtifacts() {
  const rawSidecar = readExact(PATHS.fredRawSidecar, EXPECTED.fredRawSidecar);
  verifySidecar(rawSidecar, EXPECTED.fredRaw, path.basename(PATHS.fredRaw));
  const fredRaw = readExact(PATHS.fredRaw, EXPECTED.fredRaw);
  const receiptSidecar = readExact(PATHS.fredReceiptSidecar, EXPECTED.fredReceiptSidecar);
  verifySidecar(receiptSidecar, EXPECTED.fredReceipt, path.basename(PATHS.fredReceipt));
  const fredReceiptArtifact = readExact(PATHS.fredReceipt, EXPECTED.fredReceipt);
  const fredReceipt = parseJson(fredReceiptArtifact, 'FRED source receipt');

  if (fredReceipt.schema !== FRED_RECEIPT_SCHEMA || fredReceipt.status !== STATUS || fredReceipt.seriesId !== 'DTB3' || fredReceipt.requestedStartDate !== '1995-01-01' || fredReceipt.requestedEndDate !== AS_OF_DATE || fredReceipt.containsStrategyOutcomes !== false || fredReceipt.rawBytesRetained !== true) {
    throw new IntegrityError('FRED source receipt identity mismatch');
  }
  base.exactIsoUtc(fredReceipt.retrievedAt, 'FRED receipt retrievedAt');
  if (fredReceipt.rawArtifact.path !== fredRaw.path || fredReceipt.rawArtifact.bytes !== fredRaw.bytes.length || fredReceipt.rawArtifact.sha256 !== fredRaw.sha256) {
    throw new IntegrityError('FRED source receipt raw-artifact mismatch');
  }

  const cmbitmArtifact = base.sourceArtifact(PATHS.cmbitmSnapshot, EXPECTED.cmbitmSnapshot);
  const equityArtifact = base.sourceArtifact(PATHS.equityRiskyCache, EXPECTED.equityRiskyCache);
  const robustnessArtifact = base.sourceArtifact(PATHS.robustnessCache, EXPECTED.robustnessCache);
  const observations = parseFredCsv(fredRaw.bytes, AS_OF_DATE);
  return { cmbitmArtifact, equityArtifact, robustnessArtifact, fredRaw, rawSidecar, fredReceiptArtifact, receiptSidecar, fredReceipt, observations };
}

function buildCashSeries(loaded) {
  const built = base.buildDailyCashWealth(loaded.observations, AS_OF_DATE, 7);
  const observedHistory = base.history(built.observations);
  const cashHistory = base.history(built.rows);
  if (observedHistory.normalizedRowsSha256 !== EXPECTED.observedYieldRows) throw new IntegrityError('observed-yield rows changed');
  if (cashHistory.firstDate !== '1995-01-04' || cashHistory.lastDate !== AS_OF_DATE || cashHistory.rowCount !== 11556 || cashHistory.normalizedRowsSha256 !== EXPECTED.cashRows) {
    throw new IntegrityError('extended cash rows mismatch', { cashHistory });
  }
  return {
    key: 'cash',
    market: 'USD cash proxy',
    primary: true,
    robustnessOnly: false,
    ticker: 'DTB3-91D-ACCRUAL-V2',
    name: 'Reconstructed continuously rolled 91-day U.S. Treasury bill accrual proxy, extended-cash v2',
    currency: 'USD',
    returnType: base.RETURN_TYPES.CASH,
    executable: false,
    executableMeaning: 'False: this is a mathematical wealth reconstruction from a quoted yield, not a listed fund or observed total-return index.',
    seriesLevelExecutable: false,
    underlyingInstrumentExecutable: false,
    priceField: 'Derived wealth level, base 1.0 on 1995-01-04 after the first strictly prior DTB3 observation',
    methodology: 'Unchanged v1 causal construction. For bank-discount yield d=DTB3/100 and n=91: P=1-d*n/360; G=1/P; one-calendar-day factor G^(1/91). Accrual from date t to t+1 uses only the latest observation dated strictly before t, with a seven-calendar-day staleness cap.',
    pointInTimeStatus: 'Official historical FRED yields in a current-vintage 2026-08-25 download. Strict prior-observation-date lag avoids same-date look-ahead, but the reconstructed wealth path is not an executable or official total-return index.',
    source: {
      provider: loaded.fredReceipt.provider,
      sourceUrl: loaded.fredReceipt.sourceUrl,
      officialSeriesUrl: loaded.fredReceipt.officialSeriesUrl,
      treasuryPricingConventionUrl: 'https://www.treasurydirect.gov/marketable-securities/understanding-pricing/',
      retrievedAt: loaded.fredReceipt.retrievedAt,
      requestedStartDate: loaded.fredReceipt.requestedStartDate,
      requestedEndDate: loaded.fredReceipt.requestedEndDate,
      rawPayloadSha256: loaded.fredRaw.sha256,
      rawResponseBytes: loaded.fredRaw.bytes.length,
      rawArtifactPath: loaded.fredRaw.path,
      rawArtifactSidecarPath: loaded.rawSidecar.path,
      sourceArtifactPath: loaded.fredReceiptArtifact.path,
      sourceArtifactSha256: loaded.fredReceiptArtifact.sha256,
      sourceArtifactSchema: loaded.fredReceipt.schema,
      sourceArtifactSidecarPath: loaded.receiptSidecar.path,
      observedYieldUnits: 'percent_bank_discount_basis',
      informationLagRule: 'STRICTLY_PRIOR_OBSERVATION_DATE_FOR_EACH_ACCRUAL_START_DATE',
      maximumObservationStalenessCalendarDays: 7,
      observedYieldHistory: observedHistory,
      observedYieldRows: built.observations,
    },
    history: cashHistory,
    rows: built.rows,
  };
}

function sourceReceipt(role, artifact, extra = {}) {
  return { role, path: base.stableArtifactPath(artifact.absolutePath), sha256: artifact.sha256, bytes: artifact.bytes.length, ...extra };
}

function assertDataOnly(value) {
  const forbidden = new Set(['signal', 'signals', 'strategyReturn', 'strategyReturns', 'target', 'targets', 'metric', 'metrics', 'gate', 'gates', 'terminalWealth', 'annualizedReturn', 'sharpe', 'drawdown', 'turnover', 'nav', 'result', 'results', 'selectedCandidate', 'candidateResults']);
  const visit = (item, location) => {
    if (Array.isArray(item)) return item.forEach((child, index) => visit(child, `${location}[${index}]`));
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      if (forbidden.has(key)) throw new IntegrityError(`forbidden non-data field ${location}.${key}`);
      visit(child, `${location}.${key}`);
    }
  };
  visit(value, 'v2Input');
  return value;
}

function buildInput(loaded) {
  const v1 = base.buildInput({
    cmbitmArtifact: loaded.cmbitmArtifact,
    equityArtifact: loaded.equityArtifact,
    robustnessArtifact: loaded.robustnessArtifact,
    asOfDate: AS_OF_DATE,
  });
  const cash = buildCashSeries(loaded);
  const input = {
    ...v1,
    schema: SCHEMA,
    purpose: 'Versioned data-only v2 input for the frozen universal-volatility proxy falsification study. It extends only causal DTB3 cash support; no strategy outcome is present.',
    sourceArtifacts: [
      sourceReceipt('CMBITM_SCHEMA4_CACHE_ACTUAL_SOURCE', loaded.cmbitmArtifact, { schemaVersion: loaded.cmbitmArtifact.parsed.schemaVersion, createdAt: loaded.cmbitmArtifact.parsed.createdAt }),
      sourceReceipt('PRIMARY_ETFS_FROZEN_CACHE_RISKY_ROWS_ONLY', loaded.equityArtifact, { schema: loaded.equityArtifact.parsed.schema, retrievedAt: loaded.equityArtifact.parsed.retrievedAt, ignoredEmbeddedCash: true }),
      sourceReceipt('PREDECLARED_ROBUSTNESS_ETF_RAW_CACHE', loaded.robustnessArtifact, { schema: loaded.robustnessArtifact.parsed.schema, retrievedAt: loaded.robustnessArtifact.parsed.retrievedAt }),
      sourceReceipt('DTB3_EXTENDED_OFFICIAL_RAW_CSV', loaded.fredRaw, { sidecarPath: loaded.rawSidecar.path, sidecarSha256: loaded.rawSidecar.sha256, retrievedAt: loaded.fredReceipt.retrievedAt, sourceUrl: loaded.fredReceipt.sourceUrl }),
      sourceReceipt('DTB3_EXTENDED_SOURCE_RECEIPT', loaded.fredReceiptArtifact, { schema: loaded.fredReceipt.schema, sidecarPath: loaded.receiptSidecar.path, sidecarSha256: loaded.receiptSidecar.sha256, retrievedAt: loaded.fredReceipt.retrievedAt }),
    ],
    cash,
    cashExtension: {
      version: 2,
      v1Status: 'SUPERSEDED_BEFORE_ANY_UNIVERSAL_VOLATILITY_PROXY_OUTCOME',
      reason: 'The v1 data chain reused a DTB3 request beginning in 2008 because an older strict-common ACWI rotation experiment did not need earlier cash. That unnecessarily excluded valid EWD, IYY and IEV risky histories from this per-market-calendar study.',
      changedField: 'cash source history only',
      sourceStartRequested: '1995-01-01',
      firstObservedYieldDate: cash.source.observedYieldHistory.firstDate,
      firstCashWealthDate: cash.history.firstDate,
      riskyAndRobustnessBytesRefetched: false,
      modelLogicChanged: false,
    },
    warnings: [
      ...v1.warnings,
      'V2 preserves exact v1 risky and robustness bytes and changes only the independently frozen extended DTB3 cash source.',
      'V1 universal-volatility proxy data was superseded before outcomes because its inherited 2008 cash boundary unnecessarily truncated three Stage-1 markets.',
    ],
  };
  validateInput(input);
  return assertDataOnly(input);
}

function validateInput(input) {
  if (!input || input.schema !== SCHEMA || input.status !== STATUS || input.asOfDate !== AS_OF_DATE || input.cutoffExclusive !== '2026-08-25') throw new IntegrityError('v2 input schema/status/date mismatch');
  if (input.markets.map(item => item.key).join(',') !== 'crypto,sweden,usa,europe,global') throw new IntegrityError('v2 market order mismatch');
  for (const item of input.markets) {
    if (item.primary.history.normalizedRowsSha256 !== EXPECTED_RISKY_ROWS[item.key]) throw new IntegrityError(`${item.key} risky rows changed`);
  }
  if (input.cash.executable !== false || input.cash.returnType !== base.RETURN_TYPES.CASH || input.cash.source.rawPayloadSha256 !== EXPECTED.fredRaw || input.cash.source.sourceArtifactSha256 !== EXPECTED.fredReceipt || input.cash.history.normalizedRowsSha256 !== EXPECTED.cashRows) {
    throw new IntegrityError('v2 cash identity mismatch');
  }
  if (input.historyPanels.investableEquityPrimaryLongHistory.strictCommonHistory.datesSha256 !== '1626c6fc91efa55d71c67a10941a432104dd5e1cc2a467bf666dde341bce2ccf' || input.historyPanels.fiveMarketPrimary.strictCommonHistory.datesSha256 !== 'aa7b9b53bd0f47b8de6da980f5d188dcb4eb5651d89bc0eb3449a7424a008481') {
    throw new IntegrityError('risky-only history-panel dates changed');
  }
  return input;
}

function seriesManifestReceipt(item) {
  return {
    key: item.key,
    ticker: item.ticker,
    returnType: item.returnType,
    executable: item.executable,
    firstDate: item.history.firstDate,
    lastDate: item.history.lastDate,
    rowCount: item.history.rowCount,
    normalizedRowsSha256: item.history.normalizedRowsSha256,
    rawPayloadSha256: item.source.rawPayloadSha256,
    retrievedAt: item.source.retrievedAt,
    sourceUrl: item.source.sourceUrl,
    sourceArtifactSha256: item.source.sourceArtifactSha256,
  };
}

function freezeManifest(input, inputWrite) {
  return {
    schema: FREEZE_MANIFEST_SCHEMA,
    status: STATUS,
    version: 2,
    asOfDate: input.asOfDate,
    containsStrategyOutcomes: false,
    v1Status: input.cashExtension.v1Status,
    input: {
      path: base.stableArtifactPath(inputWrite.absolutePath),
      bytes: inputWrite.bytes,
      fileSha256: inputWrite.sha256,
      adjacentSha256Path: `${base.stableArtifactPath(inputWrite.absolutePath)}.sha256`,
    },
    sourceArtifacts: input.sourceArtifacts.map(item => {
      const { sha256: fileSha256, ...rest } = item;
      return { ...rest, fileSha256 };
    }),
    primarySeries: input.markets.map(item => seriesManifestReceipt(item.primary)),
    robustnessSeries: input.markets.flatMap(item => item.robustness).map(item => ({ ...seriesManifestReceipt(item), role: item.replacementPolicy })),
    cash: seriesManifestReceipt(input.cash),
    historyPanels: input.historyPanels,
    cashExtension: input.cashExtension,
    sourceCorrection: input.sourceCorrection,
  };
}

function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 0) throw new IntegrityError('v2 normalizer accepts no arguments');
  return { output: PATHS.output, manifest: PATHS.manifest };
}

function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  const loaded = loadFrozenArtifacts();
  const input = buildInput(loaded);
  const inputWrite = base.writeStableJson(options.output, input);
  const manifest = freezeManifest(input, inputWrite);
  const manifestWrite = base.writeStableJson(options.manifest, manifest);
  process.stdout.write(`${JSON.stringify({
    schema: input.schema,
    status: input.status,
    inputPath: base.stableArtifactPath(inputWrite.absolutePath),
    inputSha256: inputWrite.sha256,
    manifestPath: base.stableArtifactPath(manifestWrite.absolutePath),
    manifestSha256: manifestWrite.sha256,
    cash: manifest.cash,
    cashExtension: manifest.cashExtension,
    riskySeries: manifest.primarySeries,
  }, null, 2)}\n`);
  return { loaded, input, inputWrite, manifest, manifestWrite };
}

module.exports = {
  REPO_ROOT, SCHEMA, STATUS, FREEZE_MANIFEST_SCHEMA, FRED_RECEIPT_SCHEMA,
  AS_OF_DATE, PATHS, EXPECTED, EXPECTED_RISKY_ROWS, IntegrityError, sha256,
  repoPath, readExact, verifySidecar, parseJson, parseFredCsv,
  loadFrozenArtifacts, buildCashSeries, assertDataOnly, buildInput,
  validateInput, seriesManifestReceipt, freezeManifest, parseArgs, main,
};

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: error && error.code === 'INTEGRITY_ERROR' ? 'INTEGRITY_ERROR' : 'ERROR',
      message: error && error.message,
      details: error && error.details || {},
    }, null, 2)}\n`);
    process.exitCode = error && error.code === 'INTEGRITY_ERROR' ? 2 : 1;
  }
}
