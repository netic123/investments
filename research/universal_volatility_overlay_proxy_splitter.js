'use strict';

// Deterministic data-only adapter for the frozen universal-volatility proxy
// falsification study. This module deliberately contains no candidate, signal,
// target, portfolio, performance, metric, gate, or stage-outcome calculation.
// Its command has no stage selector and can create only the Stage-1 development
// data file and its adjacent SHA-256 receipt.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const OUTPUT_SCHEMA = 'universal-vol-overlay-proxy-input-v1';
const OUTPUT_STATUS = 'RETROSPECTIVE_PROXY_DATA_ONLY_NOT_CONFIRMATORY';
const OUTPUT_STAGE = 'development';
const DEVELOPMENT_END = '2018-12-31';
const MIN_DATA_INTERVALS_PER_MONTH = 15;
const WARMUP_MONTHS = 12;
const MARKET_ORDER = Object.freeze(['sweden', 'usa', 'europe', 'global']);
const PARENT_MARKET_ORDER = Object.freeze(['crypto', ...MARKET_ORDER]);

const PATHS = Object.freeze({
  normativeProtocol: path.join(__dirname, 'UNIVERSAL_VOLATILITY_OVERLAY_PROTOCOL.md'),
  proxyProtocol: path.join(__dirname, 'UNIVERSAL_VOLATILITY_OVERLAY_PROXY_FALSIFICATION_PROTOCOL.md'),
  manifest: path.join(__dirname, 'FIVE_MARKET_PROXY_DATA_FREEZE_2026-08-24.json'),
  manifestSidecar: path.join(__dirname, 'FIVE_MARKET_PROXY_DATA_FREEZE_2026-08-24.json.sha256'),
  parentInput: path.join(__dirname, 'local-artifacts', 'five-market-proxy-data', 'five-market-proxy-input-2026-08-24.json'),
  parentInputSidecar: path.join(__dirname, 'local-artifacts', 'five-market-proxy-data', 'five-market-proxy-input-2026-08-24.json.sha256'),
  cmbitmSource: path.join(__dirname, 'local-artifacts', 'final-frozen', 'inputs', 'fear-greed-model-search-input-2026-08-24T22-13-44Z.json'),
  equityCashSource: path.join(__dirname, 'local-artifacts', 'equity-rotation-panel', 'input-2026-08-24.json'),
  robustnessSource: path.join(__dirname, 'local-artifacts', 'five-market-proxy-data', 'robustness-yahoo-2026-08-24.json'),
  output: path.join(__dirname, 'local-artifacts', 'universal-volatility-overlay-proxy', 'development-input-2026-08-24.json'),
});

const EXPECTED = Object.freeze({
  normativeProtocol: '601bb020265d593d057bccc259854871e032a025bd708412eba878d8ab0d9406',
  proxyProtocol: 'fe1088f197388fb5edfd6cdbb96f3c037d0567d9aabda6a9c72d5f656972be13',
  manifest: '236881d17829b35356ea06b582c5ebd49020f81958400913aa9a83e544ab032a',
  manifestSidecar: 'be46dbec6ea58d22f54dc572ab961d9608020a283aa0cc3d38f0ee48eebd262d',
  parentInput: 'a7a1e895ff4dbda68849beaead5f86cabad4493f89db43ec05e6a805847a329c',
  parentInputSidecar: '94beab97c7d39f1fffce5e21222f9aeb046172bfb8a03a3bae35679d098f9cf7',
  cmbitmSource: '9d42777cc8ad7de6394cb0045e24fa0b588c1e31915acadbc49af55842579b7c',
  equityCashSource: '4a9b5cda4fcd78c30a5a0b346d17f483ea16aaa07ecb5cc9bf7795dff2a27b08',
  robustnessSource: 'dc4e8a6cd9fdc14c5c0efc94eacdd0dcd5185e3c672b2f2e774330901d133bdc',
  fiveMarketDates: 'aa7b9b53bd0f47b8de6da980f5d188dcb4eb5651d89bc0eb3449a7424a008481',
  equityDates: '1626c6fc91efa55d71c67a10941a432104dd5e1cc2a467bf666dde341bce2ccf',
});

const SERIES_EXPECTED = Object.freeze({
  crypto: Object.freeze({
    ticker: 'CMBITM', returnType: 'PRICE_RETURN_NONINVESTABLE_BACKCAST', executable: false,
    firstDate: '2019-07-01', lastDate: '2026-08-24', rowCount: 2612,
    rawPayloadSha256: 'fe7d5b99e1b6c4cb1f989df6c78123fc5457c582becff86354c4cffb242f5f7e',
    normalizedRowsSha256: 'f8519b927bde51b9329417dc1f9e31ce0e67920a4c2bb9f3935a0d23e6b92729',
  }),
  sweden: Object.freeze({
    ticker: 'EWD', returnType: 'USD_ETF_ADJUSTED_CLOSE_TOTAL_RETURN_PROXY', executable: true,
    firstDate: '1996-03-18', lastDate: '2026-08-24', rowCount: 7658,
    rawPayloadSha256: '0127d2948dfe4a79753c9b5280a390d25e9d13f6dd27fb5f444cde16791eed2b',
    normalizedRowsSha256: '2580ba27aa7d31a1f2d6f41a986092f00461f09f71326472748042421206223e',
  }),
  usa: Object.freeze({
    ticker: 'IYY', returnType: 'USD_ETF_ADJUSTED_CLOSE_TOTAL_RETURN_PROXY', executable: true,
    firstDate: '2000-06-16', lastDate: '2026-08-24', rowCount: 6585,
    rawPayloadSha256: '0c881ef398ac8f34fda4976063fd912a60b3ea073f3fe1125fa768686555ad92',
    normalizedRowsSha256: '108dcfd1c3b5f05bd71ccf4b16e7008ca4c369113bfe10ce92a590a202d8d3bc',
  }),
  europe: Object.freeze({
    ticker: 'IEV', returnType: 'USD_ETF_ADJUSTED_CLOSE_TOTAL_RETURN_PROXY', executable: true,
    firstDate: '2000-07-28', lastDate: '2026-08-24', rowCount: 6556,
    rawPayloadSha256: '1cd419d89766efbaca5b903523cd80b38f5e4c57a1ef50ed26804875dbd4950f',
    normalizedRowsSha256: '8b61a4eb0acfea35c0a54d8426280c484a19e3f6458693dd8d974bce54ec7d25',
  }),
  global: Object.freeze({
    ticker: 'ACWI', returnType: 'USD_ETF_ADJUSTED_CLOSE_TOTAL_RETURN_PROXY', executable: true,
    firstDate: '2008-03-28', lastDate: '2026-08-24', rowCount: 4631,
    rawPayloadSha256: '94a61e38d1fcb1ee44d0870452d3f4cebfb014cc9b90cff9453cc6f732557761',
    normalizedRowsSha256: '9307603c3c78b5fff46fd0563fb8395421e53beceb2faa153ef2f4c03b8491da',
  }),
  cash: Object.freeze({
    ticker: 'DTB3-91D-ACCRUAL', returnType: 'RECONSTRUCTED_91_DAY_TBILL_ACCRUAL_PROXY', executable: false,
    firstDate: '2008-01-03', lastDate: '2026-08-24', rowCount: 6809,
    rawPayloadSha256: '0907b7c8ae0d047ff73ac231601b8d12e43f8e34cf42587c1bf9873f4aeb8bb4',
    normalizedRowsSha256: '2cd3c860511d7ebc3ed5b4461c14e7a75618535182786c5f6e8cb00601955c21',
  }),
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

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new IntegrityError('canonical JSON cannot contain non-finite numbers');
  return value;
}

function stableJson(value, space = 2) {
  return `${JSON.stringify(canonicalize(value), null, space)}\n`;
}

function repoPath(file) {
  const relative = path.relative(REPO_ROOT, path.resolve(file));
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new IntegrityError(`artifact is outside repository: ${file}`);
  return relative.replace(/\\/g, '/');
}

function dateMs(value, context = 'date') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new IntegrityError(`${context} must be YYYY-MM-DD`);
  const result = Date.parse(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(result) || new Date(result).toISOString().slice(0, 10) !== value) throw new IntegrityError(`${context} is invalid: ${value}`);
  return result;
}

function isoDate(milliseconds) {
  return new Date(milliseconds).toISOString().slice(0, 10);
}

function addDays(date, days) {
  return isoDate(dateMs(date) + days * 86400000);
}

function monthKey(date) {
  dateMs(date);
  return date.slice(0, 7);
}

function nextMonth(month) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) throw new IntegrityError(`invalid month: ${month}`);
  return new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 1)).toISOString().slice(0, 7);
}

function rowsReceipt(rows) {
  if (!Array.isArray(rows)) throw new IntegrityError('rows must be an array');
  return {
    firstDate: rows.length ? rows[0].date : null,
    lastDate: rows.length ? rows.at(-1).date : null,
    rowCount: rows.length,
    rowsSha256: sha256(Buffer.from(stableJson(rows, 0))),
  };
}

function validateRows(rows, context) {
  if (!Array.isArray(rows) || rows.length < 2) throw new IntegrityError(`${context} must contain at least two rows`);
  let previous = '';
  for (let index = 0; index < rows.length; index++) {
    const row = rows[index];
    if (!row || Object.keys(row).sort().join(',') !== 'date,value') throw new IntegrityError(`${context}[${index}] must contain exactly date and value`);
    dateMs(row.date, `${context}[${index}].date`);
    if (previous && row.date <= previous) throw new IntegrityError(`${context} must be strictly ordered and unique`);
    if (typeof row.value !== 'number' || !Number.isFinite(row.value) || !(row.value > 0)) throw new IntegrityError(`${context}[${index}].value must be positive and finite`);
    previous = row.date;
  }
  return rows;
}

function assertEqual(actual, expected, context) {
  if (actual !== expected) throw new IntegrityError(`${context} mismatch`, { expected, actual });
}

function assertJsonEqual(actual, expected, context) {
  const actualJson = stableJson(actual, 0);
  const expectedJson = stableJson(expected, 0);
  if (actualJson !== expectedJson) throw new IntegrityError(`${context} mismatch`);
}

function readExactBytes(file, expectedSha256, io, accessLog) {
  const resolved = path.resolve(file);
  if (accessLog) accessLog.push(resolved);
  const bytes = io.readFileSync(resolved);
  const digest = sha256(bytes);
  assertEqual(digest, expectedSha256, `${repoPath(resolved)} SHA-256`);
  return { bytes, sha256: digest, path: repoPath(resolved) };
}

function parseJsonBytes(artifact, context) {
  try { return JSON.parse(artifact.bytes.toString('utf8')); }
  catch (error) { throw new IntegrityError(`${context} is not valid JSON`, { cause: error.message }); }
}

function verifySidecar(artifact, expectedBaseDigest, expectedBaseName) {
  const match = /^([0-9a-f]{64})  ([^\r\n]+)\n$/.exec(artifact.bytes.toString('utf8'));
  if (!match) throw new IntegrityError(`${artifact.path} is not an exact SHA-256 sidecar`);
  assertEqual(match[1], expectedBaseDigest, `${artifact.path} referenced digest`);
  assertEqual(match[2], expectedBaseName, `${artifact.path} referenced filename`);
}

function verifyProtocol(artifact, markerPattern, expectedMarker, context) {
  const text = artifact.bytes.toString('utf8');
  const marker = markerPattern.exec(text);
  assertEqual(marker && marker[1], expectedMarker, `${context} freeze marker`);
  return { path: artifact.path, sha256: artifact.sha256, marker: expectedMarker };
}

function seriesHistory(rows) {
  const receipt = rowsReceipt(rows);
  return {
    firstDate: receipt.firstDate,
    lastDate: receipt.lastDate,
    normalizedRowsSha256: receipt.rowsSha256,
    rowCount: receipt.rowCount,
  };
}

function verifySeries(series, manifestReceipt, expected, context) {
  if (!series || typeof series !== 'object') throw new IntegrityError(`${context} is missing`);
  if (!manifestReceipt || typeof manifestReceipt !== 'object') throw new IntegrityError(`${context} manifest receipt is missing`);
  validateRows(series.rows, `${context}.rows`);
  assertEqual(series.ticker, expected.ticker, `${context}.ticker`);
  assertEqual(series.returnType, expected.returnType, `${context}.returnType`);
  assertEqual(series.executable, expected.executable, `${context}.executable`);
  const history = seriesHistory(series.rows);
  assertJsonEqual(series.history, history, `${context}.history`);
  assertEqual(history.firstDate, expected.firstDate, `${context}.firstDate`);
  assertEqual(history.lastDate, expected.lastDate, `${context}.lastDate`);
  assertEqual(history.rowCount, expected.rowCount, `${context}.rowCount`);
  assertEqual(history.normalizedRowsSha256, expected.normalizedRowsSha256, `${context}.normalizedRowsSha256`);
  assertEqual(series.source.rawPayloadSha256, expected.rawPayloadSha256, `${context}.rawPayloadSha256`);
  for (const key of ['ticker', 'returnType', 'executable']) assertEqual(manifestReceipt[key], series[key], `${context} manifest ${key}`);
  for (const key of ['firstDate', 'lastDate', 'rowCount', 'normalizedRowsSha256']) assertEqual(manifestReceipt[key], series.history[key], `${context} manifest ${key}`);
  for (const key of ['rawPayloadSha256', 'retrievedAt', 'sourceUrl', 'sourceArtifactSha256']) assertEqual(manifestReceipt[key], series.source[key], `${context} manifest ${key}`);
  return history;
}

function normalizeUpstreamRows(rows, valueField, context) {
  if (!Array.isArray(rows)) throw new IntegrityError(`${context} rows are missing`);
  return rows.map((row, index) => {
    const value = Number(row && row[valueField]);
    dateMs(row && row.date, `${context}[${index}].date`);
    if (!(value > 0) || !Number.isFinite(value)) throw new IntegrityError(`${context}[${index}] has invalid ${valueField}`);
    return { date: row.date, value };
  });
}

function reconstructCash(yieldRows, asOfDate) {
  if (!Array.isArray(yieldRows) || yieldRows.length < 2) throw new IntegrityError('DTB3 rows are missing');
  const observations = yieldRows.map((row, index) => {
    dateMs(row && row.date, `DTB3[${index}].date`);
    const percent = Number(row.percent);
    if (!Number.isFinite(percent)) throw new IntegrityError(`DTB3[${index}].percent is invalid`);
    return { date: row.date, percent };
  });
  for (let index = 1; index < observations.length; index++) {
    if (observations[index].date <= observations[index - 1].date) throw new IntegrityError('DTB3 rows are not strictly ordered');
  }
  const startDate = addDays(observations[0].date, 1);
  let observationIndex = 0;
  let wealth = 1;
  const rows = [{ date: startDate, value: wealth }];
  for (let cursor = dateMs(startDate); cursor < dateMs(asOfDate); cursor += 86400000) {
    const date = isoDate(cursor);
    while (observations[observationIndex + 1] && observations[observationIndex + 1].date < date) observationIndex++;
    const observation = observations[observationIndex];
    if (!(observation.date < date)) throw new IntegrityError(`no strictly prior DTB3 observation for ${date}`);
    const staleDays = (dateMs(date) - dateMs(observation.date)) / 86400000;
    if (staleDays > 7) throw new IntegrityError(`DTB3 observation is stale for ${date}`);
    const discountRate = observation.percent / 100;
    const billPrice = 1 - discountRate * 91 / 360;
    if (!(billPrice > 0) || !Number.isFinite(billPrice)) throw new IntegrityError(`non-positive DTB3 bill price for ${observation.date}`);
    wealth *= (1 / billPrice) ** (1 / 91);
    rows.push({ date: addDays(date, 1), value: wealth });
  }
  return { observations, rows };
}

function strictCommonDates(series) {
  if (!Array.isArray(series) || series.length < 2) throw new IntegrityError('strict-common inventory needs at least two series');
  const sets = series.map(item => new Set(item.rows.map(row => row.date)));
  return series[0].rows.map(row => row.date).filter(date => sets.every(set => set.has(date)));
}

function parseFrozenYahoo(rawBytes, expectedTicker, asOfDate) {
  let payload;
  try { payload = JSON.parse(rawBytes.toString('utf8')); }
  catch (error) { throw new IntegrityError(`${expectedTicker} raw robustness payload is invalid JSON`); }
  const result = payload?.chart?.result;
  if (payload?.chart?.error || !Array.isArray(result) || result.length !== 1) throw new IntegrityError(`${expectedTicker} raw robustness result is unavailable`);
  const item = result[0];
  if (item?.meta?.symbol !== expectedTicker || item.meta.currency !== 'USD' || item.meta.instrumentType !== 'ETF') {
    throw new IntegrityError(`${expectedTicker} raw robustness identity mismatch`);
  }
  const timestamps = item.timestamp;
  const adjusted = item?.indicators?.adjclose?.[0]?.adjclose;
  if (!Array.isArray(timestamps) || !Array.isArray(adjusted) || timestamps.length !== adjusted.length) throw new IntegrityError(`${expectedTicker} raw robustness arrays mismatch`);
  const rows = [];
  for (let index = 0; index < timestamps.length; index++) {
    const date = isoDate(Number(timestamps[index]) * 1000);
    const value = Number(adjusted[index]);
    if (date <= asOfDate && Number.isFinite(value) && value > 0) rows.push({ date, value });
  }
  validateRows(rows, `${expectedTicker} normalized robustness rows`);
  return rows;
}

function sourceArtifactByRole(sourceArtifacts, role, context) {
  const matches = sourceArtifacts.filter(item => item && item.role === role);
  if (matches.length !== 1) throw new IntegrityError(`${context} must contain exactly one ${role}`);
  return matches[0];
}

function verifyFrozenGraph({ manifest, input, cmbitmSource, equityCashSource, robustnessSource, receipts }) {
  assertEqual(manifest.schema, 'five-market-proxy-freeze-manifest-v1', 'manifest.schema');
  assertEqual(manifest.status, OUTPUT_STATUS, 'manifest.status');
  assertEqual(manifest.asOfDate, '2026-08-24', 'manifest.asOfDate');
  assertEqual(manifest.containsStrategyOutcomes, false, 'manifest.containsStrategyOutcomes');
  assertEqual(manifest.input.path, receipts.parentInput.path, 'manifest input path');
  assertEqual(manifest.input.fileSha256, EXPECTED.parentInput, 'manifest input hash');
  assertEqual(manifest.input.bytes, receipts.parentInput.bytes.length, 'manifest input bytes');
  assertEqual(manifest.input.adjacentSha256Path, receipts.parentInputSidecar.path, 'manifest input sidecar path');

  assertEqual(input.schema, 'five-market-proxy-input-v1', 'parent input.schema');
  assertEqual(input.status, OUTPUT_STATUS, 'parent input.status');
  assertEqual(input.asOfDate, '2026-08-24', 'parent input.asOfDate');
  assertEqual(input.cutoffExclusive, '2026-08-25', 'parent input.cutoffExclusive');
  assertJsonEqual(input.primarySeriesOrder, PARENT_MARKET_ORDER, 'parent input primary series order');
  assertJsonEqual(input.markets.map(item => item.key), PARENT_MARKET_ORDER, 'parent input market order');
  if (input.markets.some(item => !item.primary || item.primary.key !== item.key)) throw new IntegrityError('parent market/primary key mismatch');

  const actualSources = {
    CMBITM_SCHEMA4_CACHE_ACTUAL_SOURCE: receipts.cmbitmSource,
    PRIMARY_ETFS_AND_DTB3_CACHE: receipts.equityCashSource,
    PREDECLARED_ROBUSTNESS_ETF_RAW_CACHE: receipts.robustnessSource,
  };
  for (const role of Object.keys(actualSources)) {
    const inputReceipt = sourceArtifactByRole(input.sourceArtifacts, role, 'parent input sourceArtifacts');
    const manifestReceipt = sourceArtifactByRole(manifest.sourceArtifacts, role, 'manifest sourceArtifacts');
    const actual = actualSources[role];
    assertEqual(inputReceipt.path, actual.path, `${role} parent path`);
    assertEqual(inputReceipt.sha256, actual.sha256, `${role} parent SHA-256`);
    assertEqual(inputReceipt.bytes, actual.bytes.length, `${role} parent bytes`);
    assertEqual(manifestReceipt.path, actual.path, `${role} manifest path`);
    assertEqual(manifestReceipt.fileSha256, actual.sha256, `${role} manifest SHA-256`);
    assertEqual(manifestReceipt.bytes, actual.bytes.length, `${role} manifest bytes`);
  }

  assertEqual(cmbitmSource.schemaVersion, 4, 'CMBITM source schemaVersion');
  const cmbitmUpstream = cmbitmSource.markets.find(item => item?.key === 'crypto')?.prices;
  if (!cmbitmUpstream || cmbitmUpstream.symbol !== 'CMBITM') throw new IntegrityError('CMBITM upstream identity is missing');
  assertEqual(cmbitmUpstream.rawResponseSha256, SERIES_EXPECTED.crypto.rawPayloadSha256, 'CMBITM upstream raw hash');
  assertEqual(cmbitmSource.sources?.componentScores?.coinMetricsCmbitmRawResponse?.rawResponseSha256, SERIES_EXPECTED.crypto.rawPayloadSha256, 'CMBITM source receipt raw hash');

  assertEqual(equityCashSource.schema, 'equity-rotation-panel-input-v1', 'equity/cash source schema');
  assertEqual(equityCashSource.status, 'RETROSPECTIVE_DEVELOPMENT_PROXY_ONLY', 'equity/cash source status');
  assertEqual(equityCashSource.asOfDate, '2026-08-24', 'equity/cash source asOfDate');
  assertEqual(equityCashSource.dtb3?.id, 'DTB3', 'DTB3 upstream identity');
  assertEqual(equityCashSource.dtb3?.rawPayloadSha256, SERIES_EXPECTED.cash.rawPayloadSha256, 'DTB3 upstream raw hash');

  const manifestPrimary = new Map(manifest.primarySeries.map(item => [item.key, item]));
  const parentPrimary = new Map(input.markets.map(item => [item.key, item.primary]));
  for (const key of PARENT_MARKET_ORDER) {
    const series = parentPrimary.get(key);
    verifySeries(series, manifestPrimary.get(key), SERIES_EXPECTED[key], `parent ${key}`);
    assertEqual(
      series.source.sourceArtifactSha256,
      key === 'crypto' ? EXPECTED.cmbitmSource : EXPECTED.equityCashSource,
      `${key} source artifact hash`,
    );
    const upstreamRows = key === 'crypto'
      ? normalizeUpstreamRows(cmbitmUpstream.rows, 'close', 'CMBITM upstream')
      : normalizeUpstreamRows(equityCashSource.equities.find(item => item?.key === key)?.rows, 'value', `${key} upstream`);
    assertJsonEqual(series.rows, upstreamRows, `${key} normalized rows versus upstream`);
    if (key !== 'crypto') {
      const upstream = equityCashSource.equities.find(item => item?.key === key);
      assertEqual(upstream.ticker, SERIES_EXPECTED[key].ticker, `${key} upstream ticker`);
      assertEqual(upstream.rawPayloadSha256, SERIES_EXPECTED[key].rawPayloadSha256, `${key} upstream raw hash`);
    }
  }

  verifySeries(input.cash, manifest.cash, SERIES_EXPECTED.cash, 'parent cash');
  assertEqual(input.cash.source.sourceArtifactSha256, EXPECTED.equityCashSource, 'cash source artifact hash');
  const rebuiltCash = reconstructCash(equityCashSource.dtb3.rows, input.asOfDate);
  assertJsonEqual(input.cash.source.observedYieldRows, rebuiltCash.observations, 'cash observed-yield rows');
  assertJsonEqual(input.cash.rows, rebuiltCash.rows, 'independently reconstructed cash rows');
  assertEqual(seriesHistory(rebuiltCash.rows).normalizedRowsSha256, SERIES_EXPECTED.cash.normalizedRowsSha256, 'independently reconstructed cash rows hash');
  const observedYieldHash = sha256(Buffer.from(stableJson(rebuiltCash.observations, 0)));
  assertEqual(rebuiltCash.observations[0].date, input.cash.source.observedYieldHistory.firstDate, 'cash observation first date');
  assertEqual(rebuiltCash.observations.at(-1).date, input.cash.source.observedYieldHistory.lastDate, 'cash observation last date');
  assertEqual(rebuiltCash.observations.length, input.cash.source.observedYieldHistory.rowCount, 'cash observation row count');
  assertEqual(observedYieldHash, input.cash.source.observedYieldHistory.normalizedRowsSha256, 'cash observed-yield hash');

  const robustnessByKey = new Map(input.markets.flatMap(item => item.robustness || []).map(item => [item.key, item]));
  assertEqual(robustnessSource.schema, 'five-market-robustness-yahoo-cache-v1', 'robustness source schema');
  assertEqual(robustnessSource.status, OUTPUT_STATUS, 'robustness source status');
  assertEqual(robustnessSource.asOfDate, input.asOfDate, 'robustness source asOfDate');
  for (const receipt of manifest.robustnessSeries) {
    const series = robustnessByKey.get(receipt.key);
    if (!series || series.ticker !== receipt.ticker) throw new IntegrityError(`${receipt.key} robustness identity mismatch`);
    verifySeries(series, receipt, {
      ticker: receipt.ticker,
      returnType: receipt.returnType,
      executable: receipt.executable,
      firstDate: receipt.firstDate,
      lastDate: receipt.lastDate,
      rowCount: receipt.rowCount,
      rawPayloadSha256: receipt.rawPayloadSha256,
      normalizedRowsSha256: receipt.normalizedRowsSha256,
    }, `parent robustness ${receipt.key}`);
    const source = robustnessSource.sources.find(item => item?.definitionKey === receipt.key && item.ticker === receipt.ticker);
    if (!source) throw new IntegrityError(`${receipt.key} raw robustness source missing`);
    const raw = Buffer.from(source.rawPayloadBase64, 'base64');
    assertEqual(raw.length, source.rawResponseBytes, `${receipt.key} raw byte count`);
    assertEqual(sha256(raw), source.rawPayloadSha256, `${receipt.key} raw payload hash`);
    assertEqual(source.rawPayloadSha256, receipt.rawPayloadSha256, `${receipt.key} manifest raw hash`);
    const rows = parseFrozenYahoo(raw, receipt.ticker, input.asOfDate);
    assertJsonEqual(series.rows, rows, `${receipt.key} robustness normalized rows`);
    assertEqual(seriesHistory(rows).normalizedRowsSha256, receipt.normalizedRowsSha256, `${receipt.key} robustness row hash`);
    assertEqual(receipt.sourceArtifactSha256, EXPECTED.robustnessSource, `${receipt.key} robustness source artifact hash`);
  }

  const primarySeries = PARENT_MARKET_ORDER.map(key => parentPrimary.get(key));
  const fiveDates = strictCommonDates(primarySeries);
  const equityDates = strictCommonDates(MARKET_ORDER.map(key => parentPrimary.get(key)));
  assertEqual(sha256(Buffer.from(stableJson(fiveDates, 0))), EXPECTED.fiveMarketDates, 'five-market strict-common dates hash');
  assertEqual(sha256(Buffer.from(stableJson(equityDates, 0))), EXPECTED.equityDates, 'equity strict-common dates hash');
  assertJsonEqual(input.historyPanels, manifest.historyPanels, 'history panels parent/manifest');
  assertEqual(input.historyPanels.fiveMarketPrimary.strictCommonHistory.datesSha256, EXPECTED.fiveMarketDates, 'parent five-market inventory hash');
  assertEqual(input.historyPanels.investableEquityPrimaryLongHistory.strictCommonHistory.datesSha256, EXPECTED.equityDates, 'parent equity inventory hash');

  return { parentPrimary };
}

function loadAndVerifyFrozenArtifacts({ io = fs, accessLog = null } = {}) {
  // The normative protocol is the first file opened and hashed. No data bytes
  // are opened before this check.
  const normativeProtocol = readExactBytes(PATHS.normativeProtocol, EXPECTED.normativeProtocol, io, accessLog);
  const normativeReceipt = verifyProtocol(normativeProtocol, /UNIVERSAL_VOL_OVERLAY_FREEZE_MARKER:\s*([^\s]+)\s*-->/, 'FROZEN_UNIVERSAL_VOL_OVERLAY_V1', 'normative protocol');
  const proxyProtocol = readExactBytes(PATHS.proxyProtocol, EXPECTED.proxyProtocol, io, accessLog);
  const proxyReceipt = verifyProtocol(proxyProtocol, /UNIVERSAL_VOL_PROXY_FALSIFICATION_FREEZE_MARKER:\s*([^\s]+)\s*-->/, 'FROZEN_UNIVERSAL_VOL_PROXY_FALSIFICATION_V1', 'proxy protocol');
  if (!proxyProtocol.bytes.toString('utf8').includes(`NORMATIVE_BASE_PROTOCOL_SHA256: ${EXPECTED.normativeProtocol}`)) {
    throw new IntegrityError('proxy protocol does not embed the exact normative protocol hash');
  }

  // Sidecars are hashed and checked before their corresponding JSON files are
  // opened, as required by the proxy protocol.
  const manifestSidecar = readExactBytes(PATHS.manifestSidecar, EXPECTED.manifestSidecar, io, accessLog);
  verifySidecar(manifestSidecar, EXPECTED.manifest, path.basename(PATHS.manifest));
  const manifestArtifact = readExactBytes(PATHS.manifest, EXPECTED.manifest, io, accessLog);
  const manifest = parseJsonBytes(manifestArtifact, 'data-freeze manifest');

  const parentInputSidecar = readExactBytes(PATHS.parentInputSidecar, EXPECTED.parentInputSidecar, io, accessLog);
  verifySidecar(parentInputSidecar, EXPECTED.parentInput, path.basename(PATHS.parentInput));
  const parentInputArtifact = readExactBytes(PATHS.parentInput, EXPECTED.parentInput, io, accessLog);
  const input = parseJsonBytes(parentInputArtifact, 'normalized parent input');

  const cmbitmArtifact = readExactBytes(PATHS.cmbitmSource, EXPECTED.cmbitmSource, io, accessLog);
  const equityArtifact = readExactBytes(PATHS.equityCashSource, EXPECTED.equityCashSource, io, accessLog);
  const robustnessArtifact = readExactBytes(PATHS.robustnessSource, EXPECTED.robustnessSource, io, accessLog);
  const receipts = {
    normativeProtocol,
    proxyProtocol,
    manifest: manifestArtifact,
    manifestSidecar,
    parentInput: parentInputArtifact,
    parentInputSidecar,
    cmbitmSource: cmbitmArtifact,
    equityCashSource: equityArtifact,
    robustnessSource: robustnessArtifact,
  };
  const verified = verifyFrozenGraph({
    manifest,
    input,
    cmbitmSource: parseJsonBytes(cmbitmArtifact, 'CMBITM source'),
    equityCashSource: parseJsonBytes(equityArtifact, 'equity/cash source'),
    robustnessSource: parseJsonBytes(robustnessArtifact, 'robustness source'),
    receipts,
  });
  return { input, manifest, receipts, protocols: { normative: normativeReceipt, proxy: proxyReceipt }, ...verified };
}

function cashSupportedMonthlyInventory(rows, cashDates) {
  const counts = new Map();
  for (let index = 1; index < rows.length; index++) {
    const previous = rows[index - 1];
    const current = rows[index];
    if (!cashDates.has(previous.date) || !cashDates.has(current.date)) continue;
    const month = monthKey(current.date);
    counts.set(month, (counts.get(month) || 0) + 1);
  }
  return counts;
}

function firstWarmupRun(monthlyCounts, requiredMonths = WARMUP_MONTHS, minimumIntervals = MIN_DATA_INTERVALS_PER_MONTH) {
  const eligible = [...monthlyCounts.entries()].filter(([, count]) => count >= minimumIntervals).sort(([left], [right]) => left.localeCompare(right));
  for (let start = 0; start <= eligible.length - requiredMonths; start++) {
    const run = eligible.slice(start, start + requiredMonths);
    let consecutive = true;
    for (let index = 1; index < run.length; index++) {
      if (run[index][0] !== nextMonth(run[index - 1][0])) { consecutive = false; break; }
    }
    if (consecutive) return run.map(([month, supportedIntervalCount]) => ({ month, supportedIntervalCount }));
  }
  throw new IntegrityError(`no ${requiredMonths}-month cash-supported warm-up run exists`);
}

function roleReceipt(rows, roles, role) {
  const selected = rows.filter((row, index) => roles[index] === role);
  return { role, ...rowsReceipt(selected) };
}

function exclusionReceipt(role, rows) {
  return { role, ...rowsReceipt(rows) };
}

function stripObservedRows(source) {
  if (!source || typeof source !== 'object') return source;
  const { observedYieldRows, ...metadata } = source;
  return metadata;
}

function buildDevelopmentMarket(series, cashRows) {
  const cashDates = new Set(cashRows.map(row => row.date));
  const firstCashDate = cashRows[0].date;
  const beforeCash = series.rows.filter(row => row.date < firstCashDate);
  const retained = series.rows.filter(row => row.date >= firstCashDate && row.date <= DEVELOPMENT_END);
  const afterEnd = series.rows.filter(row => row.date > DEVELOPMENT_END);
  validateRows(retained, `${series.key} development rows`);
  for (const row of retained) {
    if (!cashDates.has(row.date)) throw new IntegrityError(`${series.key} has no cash support on ${row.date}`);
  }
  const monthlyCounts = cashSupportedMonthlyInventory(retained, cashDates);
  const warmupInventory = firstWarmupRun(monthlyCounts);
  const warmupLastMonth = warmupInventory.at(-1).month;
  const warmupLastIndex = retained.findLastIndex(row => monthKey(row.date) === warmupLastMonth);
  const formationMonth = nextMonth(warmupLastMonth);
  const formationSupportedIntervalCount = monthlyCounts.get(formationMonth) || 0;
  if (formationSupportedIntervalCount < MIN_DATA_INTERVALS_PER_MONTH) {
    throw new IntegrityError(`${series.key} first post-warm-up formation month is not data-valid`);
  }
  const formationLastIndex = retained.findLastIndex(row => monthKey(row.date) === formationMonth);
  if (warmupLastIndex < 0 || formationLastIndex <= warmupLastIndex || formationLastIndex + 2 >= retained.length) {
    throw new IntegrityError(`${series.key} has no causal post-formation development boundary`);
  }
  const roles = retained.map((row, index) => {
    if (index <= warmupLastIndex) return 'variance_warmup';
    if (index <= formationLastIndex) return 'first_signal_formation_data';
    if (index === formationLastIndex + 1) return 'stage_boundary_anchor_no_return';
    return 'stage_return_interval_end_eligible';
  });
  const roleNames = ['variance_warmup', 'first_signal_formation_data', 'stage_boundary_anchor_no_return', 'stage_return_interval_end_eligible'];
  const { rows, history, source, ...metadata } = series;
  return {
    ...metadata,
    source: stripObservedRows(source),
    parentHistory: history,
    stageHistory: rowsReceipt(retained),
    exclusions: [
      exclusionReceipt('before_first_cash_supported_close', beforeCash),
      exclusionReceipt('after_development_end', afterEnd),
    ],
    calendarInventory: {
      supportedIntervalDefinition: 'adjacent risky closes with exact-date cash rows; values are not transformed',
      minimumSupportedIntervalsPerWarmupMonth: MIN_DATA_INTERVALS_PER_MONTH,
      warmupMonthsRequired: WARMUP_MONTHS,
      warmupMonths: warmupInventory,
      warmupFirstMonth: warmupInventory[0].month,
      warmupLastMonth,
      warmupLastRowDate: retained[warmupLastIndex].date,
      firstSignalFormationMonth: formationMonth,
      formationSupportedIntervalCount,
      formationLastRowDate: retained[formationLastIndex].date,
      stageBoundaryAnchorDate: retained[formationLastIndex + 1].date,
      firstEligibleIntervalEndDate: retained[formationLastIndex + 2].date,
      boundaryCrossingIntervalRole: 'excluded_from_stage_returns',
    },
    rows: retained,
    rowRoles: roles,
    rowRolesSha256: sha256(Buffer.from(stableJson(roles, 0))),
    roleReceipts: roleNames.map(role => roleReceipt(retained, roles, role)),
  };
}

function buildDevelopmentCash(series, marketOutputs) {
  const firstDate = marketOutputs.map(item => item.stageHistory.firstDate).sort()[0];
  const before = series.rows.filter(row => row.date < firstDate);
  const retained = series.rows.filter(row => row.date >= firstDate && row.date <= DEVELOPMENT_END);
  const after = series.rows.filter(row => row.date > DEVELOPMENT_END);
  validateRows(retained, 'cash development rows');
  const { rows, history, source, ...metadata } = series;
  return {
    ...metadata,
    source: stripObservedRows(source),
    parentHistory: history,
    stageHistory: rowsReceipt(retained),
    exclusions: [
      exclusionReceipt('before_first_development_market_close', before),
      exclusionReceipt('after_development_end', after),
    ],
    role: 'shared_cash_support',
    marketBoundaries: marketOutputs.map(item => ({
      key: item.key,
      warmupFirstMonth: item.calendarInventory.warmupFirstMonth,
      warmupLastMonth: item.calendarInventory.warmupLastMonth,
      warmupLastRowDate: item.calendarInventory.warmupLastRowDate,
      firstSignalFormationMonth: item.calendarInventory.firstSignalFormationMonth,
      formationLastRowDate: item.calendarInventory.formationLastRowDate,
      stageBoundaryAnchorDate: item.calendarInventory.stageBoundaryAnchorDate,
      firstEligibleIntervalEndDate: item.calendarInventory.firstEligibleIntervalEndDate,
    })),
    rows: retained,
  };
}

function assertDataOnly(value) {
  const forbidden = new Set([
    'signal', 'signals', 'strategyReturn', 'strategyReturns', 'target', 'targets',
    'metric', 'metrics', 'gate', 'gates', 'terminalWealth', 'annualizedReturn',
    'sharpe', 'drawdown', 'turnover', 'nav', 'result', 'results',
    'selectedCandidate', 'candidateResults',
  ]);
  const visit = (item, location) => {
    if (Array.isArray(item)) return item.forEach((child, index) => visit(child, `${location}[${index}]`));
    if (!item || typeof item !== 'object') return;
    for (const [key, child] of Object.entries(item)) {
      if (forbidden.has(key)) throw new IntegrityError(`forbidden non-data field ${location}.${key}`);
      visit(child, `${location}.${key}`);
    }
  };
  visit(value, 'developmentInput');
  return value;
}

function buildDevelopmentInput(verified) {
  const parent = verified.input;
  const primary = new Map(parent.markets.map(item => [item.key, item.primary]));
  const marketOutputs = MARKET_ORDER.map(key => buildDevelopmentMarket(primary.get(key), parent.cash.rows));
  const cash = buildDevelopmentCash(parent.cash, marketOutputs);
  const output = {
    schema: OUTPUT_SCHEMA,
    status: OUTPUT_STATUS,
    stage: OUTPUT_STAGE,
    containsStrategyOutcomes: false,
    purpose: 'Physically separate deterministic Stage-1 proxy data only; not confirmatory, executable, deployable, or an outcome.',
    deterministicBuild: {
      currentClockUsed: false,
      networkAccess: false,
      commandAcceptsStageSelection: false,
      serialization: 'recursively lexicographically sorted object keys; arrays preserved; LF newline',
    },
    protocols: verified.protocols,
    parent: {
      normalizedInput: {
        path: verified.receipts.parentInput.path,
        sha256: verified.receipts.parentInput.sha256,
        bytes: verified.receipts.parentInput.bytes.length,
        sidecarPath: verified.receipts.parentInputSidecar.path,
        sidecarSha256: verified.receipts.parentInputSidecar.sha256,
      },
      dataFreezeManifest: {
        path: verified.receipts.manifest.path,
        sha256: verified.receipts.manifest.sha256,
        bytes: verified.receipts.manifest.bytes.length,
        sidecarPath: verified.receipts.manifestSidecar.path,
        sidecarSha256: verified.receipts.manifestSidecar.sha256,
      },
      verifiedSourceArtifacts: [
        verified.receipts.cmbitmSource,
        verified.receipts.equityCashSource,
        verified.receipts.robustnessSource,
      ].map(item => ({ path: item.path, sha256: item.sha256, bytes: item.bytes.length })),
    },
    boundary: {
      returnIntervalEndInclusive: DEVELOPMENT_END,
      returnIntervalStart: 'data_determined_after_each_markets_twelve_month_anchor_warmup_and_completed_formation_month',
      marketOrder: [...MARKET_ORDER],
      marketCalendarPolicy: 'each_market_own_completed_close_calendar_no_strict_common_calendar',
      preCashRiskyRows: 'excluded',
      boundaryCrossingReturnInterval: 'forbidden',
      laterStageDataIncluded: false,
    },
    markets: marketOutputs,
    cash,
  };
  return assertDataOnly(output);
}

function assertDefaultDevelopmentOutput(file) {
  const resolved = path.resolve(file);
  if (resolved !== path.resolve(PATHS.output)) throw new IntegrityError('the command may write only the frozen development proxy input path');
  if (/(^|[\\/])(validation|evaluation)([\\/]|$)/i.test(resolved)) throw new IntegrityError('later-stage output paths are forbidden');
  return resolved;
}

function writeDevelopmentInput(value, { io = fs, output = PATHS.output, enforceDefaultPath = true } = {}) {
  const resolved = enforceDefaultPath ? assertDefaultDevelopmentOutput(output) : path.resolve(output);
  const bytes = Buffer.from(stableJson(value));
  io.mkdirSync(path.dirname(resolved), { recursive: true });
  io.writeFileSync(resolved, bytes);
  const digest = sha256(bytes);
  io.writeFileSync(`${resolved}.sha256`, `${digest}  ${path.basename(resolved)}\n`);
  const displayedPath = enforceDefaultPath ? repoPath(resolved) : resolved.replace(/\\/g, '/');
  return { path: displayedPath, absolutePath: resolved, bytes: bytes.length, sha256: digest, sidecarPath: `${displayedPath}.sha256` };
}

function parseArgs(argv) {
  if (!Array.isArray(argv) || argv.length !== 0) throw new IntegrityError('development splitter accepts no arguments or stage selector');
  return { stage: OUTPUT_STAGE, output: PATHS.output };
}

function main(argv = process.argv.slice(2), dependencies = {}) {
  parseArgs(argv); // Reject every alternative before opening any file.
  const verified = loadAndVerifyFrozenArtifacts(dependencies);
  const output = buildDevelopmentInput(verified);
  const written = writeDevelopmentInput(output, { io: dependencies.io || fs });
  process.stdout.write(`${JSON.stringify({
    schema: output.schema,
    status: output.status,
    stage: output.stage,
    outputPath: written.path,
    outputSha256: written.sha256,
    bytes: written.bytes,
    markets: output.markets.map(item => ({
      key: item.key,
      firstDate: item.stageHistory.firstDate,
      lastDate: item.stageHistory.lastDate,
      rowCount: item.stageHistory.rowCount,
      rowsSha256: item.stageHistory.rowsSha256,
      warmupFirstMonth: item.calendarInventory.warmupFirstMonth,
      warmupLastMonth: item.calendarInventory.warmupLastMonth,
      firstSignalFormationMonth: item.calendarInventory.firstSignalFormationMonth,
      stageBoundaryAnchorDate: item.calendarInventory.stageBoundaryAnchorDate,
      firstEligibleIntervalEndDate: item.calendarInventory.firstEligibleIntervalEndDate,
    })),
    cash: output.cash.stageHistory,
  }, null, 2)}\n`);
  return { output, written };
}

module.exports = {
  REPO_ROOT, OUTPUT_SCHEMA, OUTPUT_STATUS, OUTPUT_STAGE, DEVELOPMENT_END,
  MIN_DATA_INTERVALS_PER_MONTH, WARMUP_MONTHS, MARKET_ORDER, PARENT_MARKET_ORDER,
  PATHS, EXPECTED, SERIES_EXPECTED, IntegrityError, sha256, canonicalize,
  stableJson, repoPath, dateMs, isoDate, addDays, monthKey, nextMonth,
  rowsReceipt, validateRows, readExactBytes, parseJsonBytes, verifySidecar,
  seriesHistory, verifySeries, normalizeUpstreamRows, reconstructCash,
  strictCommonDates, parseFrozenYahoo, verifyFrozenGraph,
  loadAndVerifyFrozenArtifacts, cashSupportedMonthlyInventory, firstWarmupRun,
  roleReceipt, exclusionReceipt, buildDevelopmentMarket, buildDevelopmentCash,
  assertDataOnly, buildDevelopmentInput, assertDefaultDevelopmentOutput,
  writeDevelopmentInput, parseArgs, main,
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
