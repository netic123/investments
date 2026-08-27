'use strict';

// Research-only data collector/normalizer. It intentionally contains no signal,
// portfolio, ranking, backtest, or performance logic.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCHEMA = 'five-market-proxy-input-v1';
const STATUS = 'RETROSPECTIVE_PROXY_DATA_ONLY_NOT_CONFIRMATORY';
const ROBUSTNESS_CACHE_SCHEMA = 'five-market-robustness-yahoo-cache-v1';
const FREEZE_MANIFEST_SCHEMA = 'five-market-proxy-freeze-manifest-v1';
const DEFAULT_AS_OF_DATE = '2026-08-24';
const DEFAULT_CMBITM_SNAPSHOT = path.join(__dirname, 'local-artifacts', 'final-frozen', 'inputs', 'fear-greed-model-search-input-2026-08-24T22-13-44Z.json');
const DEFAULT_EQUITY_CACHE = path.join(__dirname, 'local-artifacts', 'equity-rotation-panel', 'input-2026-08-24.json');
const DEFAULT_ROBUSTNESS_CACHE = path.join(__dirname, 'local-artifacts', 'five-market-proxy-data', 'robustness-yahoo-2026-08-24.json');
const DEFAULT_OUTPUT = path.join(__dirname, 'local-artifacts', 'five-market-proxy-data', 'five-market-proxy-input-2026-08-24.json');
const DEFAULT_MANIFEST = path.join(__dirname, 'FIVE_MARKET_PROXY_DATA_FREEZE_2026-08-24.json');

const EXPECTED_CMBITM_SNAPSHOT_SHA256 = '9d42777cc8ad7de6394cb0045e24fa0b588c1e31915acadbc49af55842579b7c';
const EXPECTED_EQUITY_CACHE_SHA256 = '4a9b5cda4fcd78c30a5a0b346d17f483ea16aaa07ecb5cc9bf7795dff2a27b08';
const EXPECTED_CMBITM_RAW_SHA256 = 'fe7d5b99e1b6c4cb1f989df6c78123fc5457c582becff86354c4cffb242f5f7e';

const RETURN_TYPES = Object.freeze({
  CRYPTO: 'PRICE_RETURN_NONINVESTABLE_BACKCAST',
  ETF: 'USD_ETF_ADJUSTED_CLOSE_TOTAL_RETURN_PROXY',
  CASH: 'RECONSTRUCTED_91_DAY_TBILL_ACCRUAL_PROXY',
});

const PRIMARY_ETFS = Object.freeze([
  Object.freeze({
    key: 'sweden', ticker: 'EWD', name: 'iShares MSCI Sweden ETF',
    benchmark: 'MSCI Sweden 25/50 Index', inception: '1996-03-12',
    officialUrl: 'https://www.ishares.com/us/products/239684/ishares-msci-sweden-etf',
    identityCaveat: 'Live USD ETF history; benchmark changed on 2016-12-01. The fund is an investable proxy, not the complete Swedish market itself.',
  }),
  Object.freeze({
    key: 'usa', ticker: 'IYY', name: 'iShares Dow Jones U.S. ETF',
    benchmark: 'Dow Jones U.S. Index', inception: '2000-06-12',
    officialUrl: 'https://www.ishares.com/us/products/239513/ishares-dow-jones-us-etf',
    identityCaveat: 'Live broad-U.S. USD ETF history; adjusted close is a retrospective market-price wealth proxy, not an executable fill price.',
  }),
  Object.freeze({
    key: 'europe', ticker: 'IEV', name: 'iShares Europe ETF',
    benchmark: 'S&P Europe 350 Index (Net)', inception: '2000-07-25',
    officialUrl: 'https://www.ishares.com/us/products/239736/ishares-europe-etf',
    identityCaveat: 'Live USD ETF history; narrower than an all-cap Europe benchmark and retained as the long-history primary proxy.',
  }),
  Object.freeze({
    key: 'global', ticker: 'ACWI', name: 'iShares MSCI ACWI ETF',
    benchmark: 'MSCI All Country World Index (Net)', inception: '2008-03-26',
    officialUrl: 'https://www.ishares.com/us/products/239600/ishares-msci-acwi-etf',
    identityCaveat: 'Live USD ETF history covering developed and emerging large/mid caps; it omits small caps and overlaps the regional series.',
  }),
]);

const ROBUSTNESS_ETFS = Object.freeze([
  Object.freeze({
    key: 'usa_large_cap', marketKey: 'usa', ticker: 'SPY', name: 'State Street SPDR S&P 500 ETF Trust',
    benchmark: 'S&P 500 Index', inception: '1993-01-22',
    officialUrl: 'https://www.ssga.com/us/en/individual/etfs/state-street-spdr-sp-500-etf-trust-spy',
    identityCaveat: 'Large-cap U.S. robustness proxy only; it must never replace broad-U.S. IYY after any result is inspected.',
  }),
  Object.freeze({
    key: 'europe_broader', marketKey: 'europe', ticker: 'VGK', name: 'Vanguard FTSE Europe ETF',
    benchmark: 'FTSE Developed Europe All Cap Index', inception: '2005-03-04',
    officialUrl: 'https://investor.vanguard.com/investment-products/etfs/profile/vgk',
    identityCaveat: 'Broader Europe robustness proxy only; its historical fund series contains disclosed benchmark changes and must not replace IEV after results.',
  }),
  Object.freeze({
    key: 'global_including_small_cap', marketKey: 'global', ticker: 'SPGM', name: 'State Street SPDR Portfolio MSCI Global Stock Market ETF',
    benchmark: 'MSCI ACWI IMI Index', inception: '2012-02-27',
    officialUrl: 'https://www.ssga.com/us/en/individual/etfs/state-street-spdr-portfolio-msci-global-stock-market-etf-spgm',
    identityCaveat: 'Global including-small-cap robustness proxy only; the shorter history must not replace ACWI after results.',
  }),
]);

class DataRequiredError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'DataRequiredError';
    this.code = 'DATA_REQUIRED';
    this.details = details;
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
}

function stableJson(value, space = 2) {
  return `${JSON.stringify(canonicalize(value), null, space)}\n`;
}

function isSha256(value) {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
}

function dateMs(date) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid ISO date: ${date}`);
  const value = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error(`Invalid ISO date: ${date}`);
  return value;
}

function isoDate(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function addDays(date, count) {
  return isoDate(dateMs(date) + count * 86400000);
}

function calendarDays(first, last) {
  return (dateMs(last) - dateMs(first)) / 86400000;
}

function exactIsoUtc(value, context) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new Error(`${context} must be exact ISO UTC`);
  }
}

function requiredText(value, context) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${context} is required`);
  return value;
}

function stableArtifactPath(filePath) {
  const absolutePath = path.resolve(filePath);
  const relativePath = path.relative(REPO_ROOT, absolutePath);
  if (!relativePath.startsWith('..') && !path.isAbsolute(relativePath)) return relativePath.replace(/\\/g, '/');
  return absolutePath.replace(/\\/g, '/');
}

function sourceArtifact(filePath, expectedSha256 = null) {
  const absolutePath = path.resolve(filePath);
  const bytes = fs.readFileSync(absolutePath);
  const digest = sha256(bytes);
  if (expectedSha256 && digest !== expectedSha256) {
    throw new DataRequiredError(`Frozen source artifact hash mismatch: ${absolutePath}`, { expectedSha256, actualSha256: digest });
  }
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); }
  catch (error) { throw new DataRequiredError(`Frozen source artifact is not valid JSON: ${absolutePath}`, { cause: error.message }); }
  return { absolutePath, bytes, sha256: digest, parsed };
}

function normalizePositiveRows(rows, sourceField, asOfDate, context) {
  dateMs(asOfDate);
  if (!Array.isArray(rows) || rows.length < 2) throw new DataRequiredError(`${context} requires at least two rows`);
  const byDate = new Map();
  for (const row of rows) {
    const date = row && row.date;
    dateMs(date);
    if (date > asOfDate) throw new DataRequiredError(`${context} contains a row after the completed-close cutoff`, { date, asOfDate });
    const value = Number(row[sourceField]);
    if (!(value > 0) || !Number.isFinite(value)) throw new DataRequiredError(`${context} has an invalid ${sourceField}`, { date, value: row[sourceField] });
    if (byDate.has(date)) throw new DataRequiredError(`${context} contains a duplicate date`, { date });
    byDate.set(date, value);
  }
  return [...byDate].sort(([left], [right]) => left.localeCompare(right)).map(([date, value]) => ({ date, value }));
}

function normalizeYieldRows(rows, asOfDate, context = 'DTB3') {
  dateMs(asOfDate);
  if (!Array.isArray(rows) || rows.length < 2) throw new DataRequiredError(`${context} requires at least two rows`);
  const byDate = new Map();
  for (const row of rows) {
    const date = row && row.date;
    dateMs(date);
    if (date > asOfDate) throw new DataRequiredError(`${context} contains a future observation`, { date, asOfDate });
    const percent = Number(row.percent);
    if (!Number.isFinite(percent)) throw new DataRequiredError(`${context} has an invalid percent`, { date, percent: row.percent });
    if (byDate.has(date)) throw new DataRequiredError(`${context} contains a duplicate date`, { date });
    byDate.set(date, percent);
  }
  return [...byDate].sort(([left], [right]) => left.localeCompare(right)).map(([date, percent]) => ({ date, percent }));
}

function history(rows) {
  return {
    firstDate: rows[0].date,
    lastDate: rows.at(-1).date,
    rowCount: rows.length,
    normalizedRowsSha256: sha256(Buffer.from(stableJson(rows, 0))),
  };
}

function bankDiscountDailyFactor(percent) {
  const discount = Number(percent) / 100;
  const priceFraction = 1 - discount * 91 / 360;
  if (!(priceFraction > 0) || !Number.isFinite(priceFraction)) throw new DataRequiredError(`Invalid DTB3 discount yield: ${percent}`);
  return (1 / priceFraction) ** (1 / 91);
}

function buildDailyCashWealth(yieldRows, asOfDate, maxStaleCalendarDays = 7) {
  const observations = normalizeYieldRows(yieldRows, asOfDate);
  if (!Number.isInteger(maxStaleCalendarDays) || maxStaleCalendarDays < 1) throw new Error('maxStaleCalendarDays must be a positive integer');
  // DTB3 observation timestamps were not archived. Conservatively lag the
  // series by one calendar date: an interval beginning on t may use only an
  // observation whose date is strictly earlier than t.
  const startDate = addDays(observations[0].date, 1);
  if (startDate > asOfDate) throw new DataRequiredError('DTB3 history has no causally usable accrual interval');
  let observationIndex = 0;
  let wealth = 1;
  const rows = [{ date: startDate, value: wealth }];
  for (let cursor = dateMs(startDate); cursor < dateMs(asOfDate); cursor += 86400000) {
    const currentDate = isoDate(cursor);
    while (observations[observationIndex + 1] && observations[observationIndex + 1].date < currentDate) observationIndex++;
    const observation = observations[observationIndex];
    if (!(observation.date < currentDate)) throw new DataRequiredError(`No strictly prior DTB3 observation for ${currentDate}`);
    const age = calendarDays(observation.date, currentDate);
    if (age > maxStaleCalendarDays) {
      throw new DataRequiredError(`DTB3 observation becomes stale before ${addDays(currentDate, 1)}`, {
        observationDate: observation.date,
        accrualStartDate: currentDate,
        ageCalendarDays: age,
        maxStaleCalendarDays,
      });
    }
    wealth *= bankDiscountDailyFactor(observation.percent);
    rows.push({ date: addDays(currentDate, 1), value: wealth });
  }
  return { observations, rows };
}

function yahooUrl(ticker, cutoffExclusive) {
  const period1 = Math.floor(Date.parse('1990-01-01T00:00:00.000Z') / 1000);
  const period2 = Math.floor(dateMs(cutoffExclusive) / 1000);
  return `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?period1=${period1}&period2=${period2}&interval=1d&events=div%2Csplits&includeAdjustedClose=true`;
}

async function fetchBytes(url, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new DataRequiredError('Fetch implementation is unavailable', { url });
  let response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: 'application/json,text/plain,*/*',
        'user-agent': 'investments-five-market-proxy-research/1.0',
      },
    });
  } catch (error) {
    throw new DataRequiredError(`Yahoo robustness fetch failed: ${url}`, { cause: error.message, url });
  }
  if (!response || !response.ok) throw new DataRequiredError(`Yahoo robustness source returned HTTP ${response && response.status}`, { url, status: response && response.status });
  return Buffer.from(await response.arrayBuffer());
}

function parseYahooAdjustedClose(bytes, definition, asOfDate) {
  let payload;
  try { payload = JSON.parse(Buffer.from(bytes).toString('utf8')); }
  catch (error) { throw new DataRequiredError(`${definition.ticker}: Yahoo payload is not JSON`, { cause: error.message }); }
  const chart = payload && payload.chart;
  if (!chart || chart.error || !Array.isArray(chart.result) || chart.result.length !== 1) {
    throw new DataRequiredError(`${definition.ticker}: Yahoo chart result unavailable`, { error: chart && chart.error });
  }
  const result = chart.result[0];
  const timestamps = result.timestamp;
  const adjusted = result.indicators && result.indicators.adjclose && result.indicators.adjclose[0] && result.indicators.adjclose[0].adjclose;
  if (!Array.isArray(timestamps) || !Array.isArray(adjusted) || timestamps.length !== adjusted.length) {
    throw new DataRequiredError(`${definition.ticker}: Yahoo adjusted-close arrays are missing or inconsistent`);
  }
  if (!result.meta || result.meta.symbol !== definition.ticker || result.meta.currency !== 'USD' || result.meta.instrumentType !== 'ETF') {
    throw new DataRequiredError(`${definition.ticker}: Yahoo identity is not the expected USD ETF`, { meta: result.meta || null });
  }
  const rows = [];
  for (let index = 0; index < timestamps.length; index++) {
    const date = isoDate(Number(timestamps[index]) * 1000);
    const value = Number(adjusted[index]);
    if (date <= asOfDate && Number.isFinite(value) && value > 0) rows.push({ date, value });
  }
  return {
    rows: normalizePositiveRows(rows, 'value', asOfDate, definition.ticker),
    yahooMeta: {
      symbol: result.meta.symbol,
      currency: result.meta.currency,
      exchangeName: result.meta.exchangeName,
      instrumentType: result.meta.instrumentType,
      exchangeTimezoneName: result.meta.exchangeTimezoneName,
      dataGranularity: result.meta.dataGranularity,
    },
  };
}

async function collectRobustnessCache({ asOfDate = DEFAULT_AS_OF_DATE, retrievedAt = new Date().toISOString(), fetchImpl = globalThis.fetch } = {}) {
  dateMs(asOfDate);
  exactIsoUtc(retrievedAt, 'retrievedAt');
  const cutoffExclusive = addDays(asOfDate, 1);
  const sources = [];
  for (const definition of ROBUSTNESS_ETFS) {
    const sourceUrl = yahooUrl(definition.ticker, cutoffExclusive);
    const bytes = await fetchBytes(sourceUrl, fetchImpl);
    const parsed = parseYahooAdjustedClose(bytes, definition, asOfDate);
    sources.push({
      definitionKey: definition.key,
      ticker: definition.ticker,
      sourceUrl,
      retrievedAt,
      rawResponseBytes: bytes.length,
      rawPayloadSha256: sha256(bytes),
      rawPayloadBase64: bytes.toString('base64'),
      yahooMeta: parsed.yahooMeta,
      normalizedRowsSha256: history(parsed.rows).normalizedRowsSha256,
      rowCount: parsed.rows.length,
      firstDate: parsed.rows[0].date,
      lastDate: parsed.rows.at(-1).date,
    });
  }
  return {
    schema: ROBUSTNESS_CACHE_SCHEMA,
    status: STATUS,
    asOfDate,
    cutoffExclusive,
    retrievedAt,
    sources,
  };
}

function writeStableJson(filePath, value) {
  const absolutePath = path.resolve(filePath);
  const bytes = Buffer.from(stableJson(value));
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, bytes);
  const digest = sha256(bytes);
  fs.writeFileSync(`${absolutePath}.sha256`, `${digest}  ${path.basename(absolutePath)}\n`);
  return { absolutePath, bytes: bytes.length, sha256: digest };
}

function writeRobustnessCache(filePath, cache) {
  if (!cache || cache.schema !== ROBUSTNESS_CACHE_SCHEMA) throw new Error(`cache.schema must be ${ROBUSTNESS_CACHE_SCHEMA}`);
  return writeStableJson(filePath, cache);
}

function buildCmbitmSeries(snapshot, snapshotMeta, asOfDate) {
  if (!snapshot || snapshot.schemaVersion !== 4) throw new DataRequiredError('CMBITM source must be the frozen schemaVersion 4 snapshot that actually contains CMBITM');
  const market = Array.isArray(snapshot.markets) && snapshot.markets.find(item => item && item.key === 'crypto');
  const prices = market && market.prices;
  if (!prices || prices.symbol !== 'CMBITM') throw new DataRequiredError('Frozen schemaVersion 4 snapshot has no CMBITM crypto price series');
  if (prices.rawResponseSha256 !== EXPECTED_CMBITM_RAW_SHA256) {
    throw new DataRequiredError('CMBITM raw Coin Metrics payload hash mismatch', { expected: EXPECTED_CMBITM_RAW_SHA256, actual: prices.rawResponseSha256 });
  }
  if (prices.rawResponseSha256 !== snapshot.sources?.componentScores?.coinMetricsCmbitmRawResponse?.rawResponseSha256) {
    throw new DataRequiredError('CMBITM raw hash disagrees inside the frozen snapshot');
  }
  const rows = normalizePositiveRows(prices.rows, 'close', asOfDate, 'CMBITM');
  const item = {
    key: 'crypto',
    market: 'Crypto broad market benchmark',
    primary: true,
    robustnessOnly: false,
    ticker: 'CMBITM',
    name: prices.name,
    currency: 'USD',
    returnType: RETURN_TYPES.CRYPTO,
    executable: false,
    executableMeaning: 'False: CMBITM is an index level and cannot itself be bought or sold.',
    seriesLevelExecutable: false,
    underlyingInstrumentExecutable: false,
    priceField: 'official Coin Metrics CMBITM daily New York-close index level',
    methodology: 'Rules-based broad crypto price index; market-cap weighted, monthly rebalanced and quarterly reconstituted. It excludes distributions and implementation costs.',
    pointInTimeStatus: 'The rules vary constituents over time, but all available pre-2022-11-22 launch history is a current-vintage backcast and can be restated.',
    source: {
      provider: 'Coin Metrics',
      sourceUrl: prices.sourceUrl,
      officialIndexUrl: 'https://indexes.coinmetrics.io/cmbitm',
      methodologyUrl: 'https://files.gitbook.com/v0/b/gitbook-x-prod.appspot.com/o/spaces%2F-MO23j33wWGzm0NrZseN%2Fuploads%2FXufzMuLtZDcNdnscsYyJ%2FCMBI%20Total%20Market%20Series%20Methodology%20v1.4.pdf?alt=media&token=2f910357-87f9-4f83-adae-2fb885f5a00e',
      officialIdentityCheckedAt: '2026-08-25',
      baseDateConflict: 'The current official web summary says 2019-04-01, while the frozen endpoint delivery begins 2019-07-01 and the separately reviewed methodology v1.4 states 2019-07-01. This input uses only delivered rows and does not synthesize April-June 2019.',
      retrievedAt: prices.fetchedAt,
      rawPayloadSha256: prices.rawResponseSha256,
      rawResponseBytes: prices.rawResponseBytes,
      parserContract: prices.parserContract,
      sourceArtifactPath: snapshotMeta.path,
      sourceArtifactSha256: snapshotMeta.sha256,
      sourceArtifactSchemaVersion: snapshot.schemaVersion,
      sourceArtifactCreatedAt: snapshot.createdAt,
    },
    history: history(rows),
    rows,
  };
  if (item.history.firstDate !== '2019-07-01' || item.history.lastDate !== asOfDate) {
    throw new DataRequiredError('CMBITM frozen history boundary is not the declared 2019-07-01 through as-of range', { history: item.history, asOfDate });
  }
  return item;
}

function buildPrimaryEtfSeries(equityCache, sourceMeta, definition, asOfDate) {
  const source = equityCache.equities.find(item => item && item.key === definition.key);
  if (!source || source.ticker !== definition.ticker) throw new DataRequiredError(`${definition.key}: primary ETF cache identity mismatch`);
  if (source.currency !== 'USD' || source.returnType !== 'yahoo_adjusted_close_market_price_total_return_proxy') {
    throw new DataRequiredError(`${definition.ticker}: primary ETF cache return type/currency mismatch`);
  }
  if (!isSha256(source.rawPayloadSha256)) throw new DataRequiredError(`${definition.ticker}: missing raw Yahoo payload SHA-256`);
  const rows = normalizePositiveRows(source.rows, 'value', asOfDate, definition.ticker);
  const item = {
    key: definition.key,
    market: definition.key[0].toUpperCase() + definition.key.slice(1),
    primary: true,
    robustnessOnly: false,
    ticker: definition.ticker,
    name: definition.name,
    currency: 'USD',
    returnType: RETURN_TYPES.ETF,
    executable: true,
    executableMeaning: 'True means the underlying listed ETF is tradeable; adjusted-close values are retrospective wealth levels, not executable fill prices.',
    seriesLevelExecutable: false,
    underlyingInstrumentExecutable: true,
    priceField: 'Yahoo adjusted close',
    methodology: 'Current-vintage Yahoo adjusted close, adjusted for applicable splits and dividend distributions; USD ETF market-price total-return proxy after fund expenses but before investor trading costs and taxes.',
    pointInTimeStatus: 'Actual live fund history with evolving benchmark membership; Yahoo corporate-action history is current-vintage and can be revised.',
    identityCaveat: definition.identityCaveat,
    officialIdentity: {
      benchmark: definition.benchmark,
      inception: definition.inception,
      url: definition.officialUrl,
      checkedAt: '2026-08-25',
    },
    source: {
      provider: 'Yahoo Finance chart endpoint',
      sourceUrl: source.sourceUrl,
      adjustedCloseDefinitionUrl: 'https://help.yahoo.com/kb/SLN28256.html',
      retrievedAt: source.retrievedAt,
      rawPayloadSha256: source.rawPayloadSha256,
      sourceArtifactPath: sourceMeta.path,
      sourceArtifactSha256: sourceMeta.sha256,
      sourceArtifactSchema: equityCache.schema,
      sourceArtifactStatus: equityCache.status,
      yahooMeta: source.yahooMeta,
    },
    history: history(rows),
    rows,
  };
  if (item.history.lastDate !== asOfDate) throw new DataRequiredError(`${definition.ticker}: last completed row is not ${asOfDate}`, { lastDate: item.history.lastDate });
  return item;
}

function buildRobustnessEtfSeries(cache, sourceMeta, definition, asOfDate) {
  if (!cache || cache.schema !== ROBUSTNESS_CACHE_SCHEMA || cache.status !== STATUS || cache.asOfDate !== asOfDate) {
    throw new DataRequiredError('Robustness cache identity/as-of mismatch');
  }
  const source = cache.sources.find(item => item && item.definitionKey === definition.key && item.ticker === definition.ticker);
  if (!source || !isSha256(source.rawPayloadSha256) || !source.rawPayloadBase64) throw new DataRequiredError(`${definition.ticker}: incomplete robustness raw cache`);
  const rawBytes = Buffer.from(source.rawPayloadBase64, 'base64');
  if (rawBytes.length !== source.rawResponseBytes || sha256(rawBytes) !== source.rawPayloadSha256) {
    throw new DataRequiredError(`${definition.ticker}: robustness raw payload bytes/hash mismatch`);
  }
  const parsed = parseYahooAdjustedClose(rawBytes, definition, asOfDate);
  const rowHistory = history(parsed.rows);
  if (rowHistory.normalizedRowsSha256 !== source.normalizedRowsSha256 || rowHistory.rowCount !== source.rowCount || rowHistory.firstDate !== source.firstDate || rowHistory.lastDate !== source.lastDate) {
    throw new DataRequiredError(`${definition.ticker}: robustness normalized rows disagree with raw-cache receipt`);
  }
  return {
    key: definition.key,
    marketKey: definition.marketKey,
    market: definition.marketKey[0].toUpperCase() + definition.marketKey.slice(1),
    primary: false,
    robustnessOnly: true,
    replacementPolicy: 'PREDECLARED_ROBUSTNESS_ONLY_NEVER_POST_RESULT_PRIMARY_REPLACEMENT',
    ticker: definition.ticker,
    name: definition.name,
    currency: 'USD',
    returnType: RETURN_TYPES.ETF,
    executable: true,
    executableMeaning: 'True means the underlying listed ETF is tradeable; adjusted-close values are retrospective wealth levels, not executable fill prices.',
    seriesLevelExecutable: false,
    underlyingInstrumentExecutable: true,
    priceField: 'Yahoo adjusted close',
    methodology: 'Current-vintage Yahoo adjusted close, adjusted for applicable splits and dividend distributions; predeclared USD ETF robustness proxy only.',
    pointInTimeStatus: 'Actual live fund history with evolving benchmark membership; Yahoo corporate-action history is current-vintage and can be revised.',
    identityCaveat: definition.identityCaveat,
    officialIdentity: {
      benchmark: definition.benchmark,
      inception: definition.inception,
      url: definition.officialUrl,
      checkedAt: '2026-08-25',
    },
    source: {
      provider: 'Yahoo Finance chart endpoint',
      sourceUrl: source.sourceUrl,
      adjustedCloseDefinitionUrl: 'https://help.yahoo.com/kb/SLN28256.html',
      retrievedAt: source.retrievedAt,
      rawPayloadSha256: source.rawPayloadSha256,
      rawResponseBytes: source.rawResponseBytes,
      sourceArtifactPath: sourceMeta.path,
      sourceArtifactSha256: sourceMeta.sha256,
      sourceArtifactSchema: cache.schema,
      yahooMeta: parsed.yahooMeta,
    },
    history: rowHistory,
    rows: parsed.rows,
  };
}

function buildCashSeries(equityCache, sourceMeta, asOfDate) {
  const dtb3 = equityCache.dtb3;
  if (!dtb3 || dtb3.id !== 'DTB3' || dtb3.units !== 'percent_bank_discount_basis' || !isSha256(dtb3.rawPayloadSha256)) {
    throw new DataRequiredError('Frozen DTB3 cache identity/units/hash mismatch');
  }
  const { observations, rows } = buildDailyCashWealth(dtb3.rows, asOfDate, 7);
  return {
    key: 'cash',
    market: 'USD cash proxy',
    primary: true,
    robustnessOnly: false,
    ticker: 'DTB3-91D-ACCRUAL',
    name: 'Reconstructed continuously rolled 91-day U.S. Treasury bill accrual proxy',
    currency: 'USD',
    returnType: RETURN_TYPES.CASH,
    executable: false,
    executableMeaning: 'False: this is a mathematical wealth reconstruction from a quoted yield, not a listed fund or observed total-return index.',
    seriesLevelExecutable: false,
    underlyingInstrumentExecutable: false,
    priceField: 'Derived wealth level, base 1.0 at first DTB3 observation',
    methodology: 'For bank-discount yield d=DTB3/100 and n=91: bill price fraction P=1-d*n/360; 91-day gross factor G=1/P; one-calendar-day factor G^(1/91). Because publication timestamps were not archived, accrual from date t to t+1 conservatively uses only the latest observation dated strictly before t, with a seven-calendar-day staleness cap.',
    pointInTimeStatus: 'FRED observations are official historical yields, but this frozen file is current-vintage. A strict prior-date information lag avoids same-date look-ahead; the reconstruction still does not model exact release time, bid/ask spread, reinvestment timing, taxes, or mark-to-market effects.',
    source: {
      provider: dtb3.source,
      sourceUrl: dtb3.sourceUrl,
      officialSeriesUrl: dtb3.officialUrl,
      treasuryPricingConventionUrl: 'https://www.treasurydirect.gov/marketable-securities/understanding-pricing/',
      retrievedAt: dtb3.retrievedAt,
      rawPayloadSha256: dtb3.rawPayloadSha256,
      sourceArtifactPath: sourceMeta.path,
      sourceArtifactSha256: sourceMeta.sha256,
      sourceArtifactSchema: equityCache.schema,
      observedYieldUnits: dtb3.units,
      informationLagRule: 'STRICTLY_PRIOR_OBSERVATION_DATE_FOR_EACH_ACCRUAL_START_DATE',
      observedYieldHistory: history(observations),
      observedYieldRows: observations,
    },
    history: history(rows),
    rows,
  };
}

function strictCommonHistory(series, context) {
  if (!Array.isArray(series) || series.length < 2) throw new Error(`${context} requires at least two series`);
  const sets = series.map(item => new Set(item.rows.map(row => row.date)));
  const dates = series[0].rows.map(row => row.date).filter(date => sets.every(set => set.has(date)));
  if (!dates.length) throw new DataRequiredError(`${context} has no strict-common dates`);
  return {
    firstDate: dates[0],
    lastDate: dates.at(-1),
    rowCount: dates.length,
    calendarYears: calendarDays(dates[0], dates.at(-1)) / 365.2425,
    datesSha256: sha256(Buffer.from(stableJson(dates, 0))),
  };
}

function normalizedSourceMeta(artifact) {
  return {
    path: stableArtifactPath(artifact.absolutePath),
    sha256: artifact.sha256,
    bytes: artifact.bytes.length,
  };
}

function buildInput({ cmbitmArtifact, equityArtifact, robustnessArtifact, asOfDate = DEFAULT_AS_OF_DATE }) {
  dateMs(asOfDate);
  const cutoffExclusive = addDays(asOfDate, 1);
  const cmbitmMeta = normalizedSourceMeta(cmbitmArtifact);
  const equityMeta = normalizedSourceMeta(equityArtifact);
  const robustnessMeta = normalizedSourceMeta(robustnessArtifact);
  const cmbitm = buildCmbitmSeries(cmbitmArtifact.parsed, cmbitmMeta, asOfDate);
  if (equityArtifact.parsed.schema !== 'equity-rotation-panel-input-v1' || equityArtifact.parsed.asOfDate !== asOfDate || equityArtifact.parsed.cutoffExclusive !== cutoffExclusive) {
    throw new DataRequiredError('Primary ETF/DTB3 cache schema or cutoff mismatch');
  }
  const primaryEtfs = PRIMARY_ETFS.map(definition => buildPrimaryEtfSeries(equityArtifact.parsed, equityMeta, definition, asOfDate));
  const robustnessEtfs = ROBUSTNESS_ETFS.map(definition => buildRobustnessEtfSeries(robustnessArtifact.parsed, robustnessMeta, definition, asOfDate));
  const cash = buildCashSeries(equityArtifact.parsed, equityMeta, asOfDate);
  const primaryRisky = [cmbitm, ...primaryEtfs];
  const markets = primaryRisky.map(primary => ({
    key: primary.key,
    primary,
    robustness: robustnessEtfs.filter(item => item.marketKey === primary.key),
  }));
  const input = {
    schema: SCHEMA,
    status: STATUS,
    purpose: 'Standardized research-only input for future predeclared model falsification; contains data and source evidence only, never a strategy outcome.',
    asOfDate,
    cutoffExclusive,
    deterministicBuild: {
      networkAccessDuringNormalization: false,
      currentClockUsedDuringNormalization: false,
      rowOrdering: 'strict ascending ISO date',
      jsonSerialization: 'recursively lexicographically sorted object keys; arrays preserved',
      note: 'The optional robustness collector is network-dependent once. Normalizing its frozen raw cache is deterministic.',
    },
    sourceArtifacts: [
      { role: 'CMBITM_SCHEMA4_CACHE_ACTUAL_SOURCE', ...cmbitmMeta, schemaVersion: cmbitmArtifact.parsed.schemaVersion, createdAt: cmbitmArtifact.parsed.createdAt },
      { role: 'PRIMARY_ETFS_AND_DTB3_CACHE', ...equityMeta, schema: equityArtifact.parsed.schema, retrievedAt: equityArtifact.parsed.retrievedAt },
      { role: 'PREDECLARED_ROBUSTNESS_ETF_RAW_CACHE', ...robustnessMeta, schema: robustnessArtifact.parsed.schema, retrievedAt: robustnessArtifact.parsed.retrievedAt },
    ],
    sourceCorrection: {
      fact: 'The frozen schemaVersion 5 v2-validation snapshot contains CRYPTO-BROAD-EW and no CMBITM rows.',
      action: 'CMBITM is sourced only from the actual earlier schemaVersion 4 final-frozen snapshot identified and hashed above.',
      prohibitedDescription: 'Do not describe CMBITM as sourced from schemaVersion 5.',
    },
    returnTypeContract: RETURN_TYPES,
    primarySeriesOrder: ['crypto', 'sweden', 'usa', 'europe', 'global'],
    robustnessPolicy: {
      status: 'PREDECLARED_BEFORE_ANY_FUTURE_MODEL_RUN',
      seriesOrder: ROBUSTNESS_ETFS.map(item => item.key),
      rule: 'SPY, VGK and SPGM are robustness targets only and may never replace IYY, IEV or ACWI after a result is inspected.',
    },
    markets,
    cash,
    historyPanels: {
      investableEquityPrimaryLongHistory: {
        members: primaryEtfs.map(item => item.ticker),
        claimBoundary: 'Four live USD ETF total-return proxies; overlapping markets; retrospective current-vintage data.',
        strictCommonHistory: strictCommonHistory(primaryEtfs, 'primary equity panel'),
      },
      fiveMarketPrimary: {
        members: primaryRisky.map(item => item.ticker),
        claimBoundary: 'Four live USD ETF total-return proxies plus one non-investable backcast crypto price index; never five investable total-return markets.',
        strictCommonHistory: strictCommonHistory(primaryRisky, 'five-market primary panel'),
      },
    },
    warnings: [
      'No strategy, signal, ranking, allocation, forecast, or performance outcome is included.',
      'CMBITM is PRICE_RETURN_NONINVESTABLE_BACKCAST, not total return and not executable.',
      'Yahoo adjusted closes are current-vintage ETF market-price total-return proxies and can be revised.',
      'DTB3 is an observed bank-discount yield; cash wealth is reconstructed and is not an official total-return index.',
      'Global overlaps USA, Europe and Sweden; market observations are not independent.',
      'The all-five strict-common window is much shorter than the equity-only window because CMBITM begins in 2019.',
    ],
  };
  validateInput(input);
  return input;
}

function validateSeries(series, expectedReturnType, expectedExecutable, context) {
  if (!series || series.returnType !== expectedReturnType || series.executable !== expectedExecutable) throw new Error(`${context}: returnType/executable mismatch`);
  if (!series.source || !isSha256(series.source.rawPayloadSha256) || !isSha256(series.source.sourceArtifactSha256)) throw new Error(`${context}: source hashes are missing`);
  requiredText(series.source.sourceUrl, `${context}.source.sourceUrl`);
  exactIsoUtc(series.source.retrievedAt, `${context}.source.retrievedAt`);
  const rows = normalizePositiveRows(series.rows, 'value', series.history.lastDate, `${context}.rows`);
  const rowHistory = history(rows);
  if (JSON.stringify(rowHistory) !== JSON.stringify(series.history)) throw new Error(`${context}: history metadata mismatch`);
}

function validateInput(input) {
  if (!input || input.schema !== SCHEMA || input.status !== STATUS) throw new Error(`input must be ${SCHEMA}/${STATUS}`);
  dateMs(input.asOfDate);
  if (input.cutoffExclusive !== addDays(input.asOfDate, 1)) throw new Error('cutoffExclusive must be one calendar day after asOfDate');
  if (!Array.isArray(input.markets) || input.markets.map(item => item.key).join(',') !== 'crypto,sweden,usa,europe,global') throw new Error('market order must be crypto,sweden,usa,europe,global');
  for (const item of input.markets) {
    const cryptoSeries = item.key === 'crypto';
    validateSeries(item.primary, cryptoSeries ? RETURN_TYPES.CRYPTO : RETURN_TYPES.ETF, !cryptoSeries, `${item.key}.primary`);
    if (item.primary.history.lastDate !== input.asOfDate) throw new Error(`${item.key}: primary last date must equal asOfDate`);
    for (const robustness of item.robustness || []) {
      if (!robustness.robustnessOnly || robustness.primary || robustness.replacementPolicy !== 'PREDECLARED_ROBUSTNESS_ONLY_NEVER_POST_RESULT_PRIMARY_REPLACEMENT') throw new Error(`${robustness.key}: robustness replacement policy missing`);
      validateSeries(robustness, RETURN_TYPES.ETF, true, `${robustness.key}.robustness`);
    }
  }
  validateSeries(input.cash, RETURN_TYPES.CASH, false, 'cash');
  if (input.cash.history.lastDate !== input.asOfDate) throw new Error('cash last date must equal asOfDate');
  if (input.markets[0].primary.ticker !== 'CMBITM' || input.markets[0].primary.source.rawPayloadSha256 !== EXPECTED_CMBITM_RAW_SHA256) throw new Error('CMBITM frozen identity/hash mismatch');
  if (input.historyPanels.fiveMarketPrimary.strictCommonHistory.firstDate !== '2019-07-01') throw new Error('five-market strict-common history must begin 2019-07-01');
  if (input.historyPanels.investableEquityPrimaryLongHistory.strictCommonHistory.firstDate !== '2008-03-28') throw new Error('equity strict-common history must begin 2008-03-28');
  return input;
}

function freezeManifest(input, inputWrite, sourceArtifacts) {
  const sourceFiles = new Map(sourceArtifacts.map(artifact => [stableArtifactPath(artifact.absolutePath), artifact]));
  return {
    schema: FREEZE_MANIFEST_SCHEMA,
    status: STATUS,
    asOfDate: input.asOfDate,
    containsStrategyOutcomes: false,
    input: {
      path: stableArtifactPath(inputWrite.absolutePath),
      bytes: inputWrite.bytes,
      fileSha256: inputWrite.sha256,
      adjacentSha256Path: `${stableArtifactPath(inputWrite.absolutePath)}.sha256`,
    },
    sourceArtifacts: input.sourceArtifacts.map(source => {
      const artifact = sourceFiles.get(source.path);
      if (!artifact || artifact.sha256 !== source.sha256 || artifact.bytes.length !== source.bytes) throw new Error(`manifest source artifact mismatch: ${source.path}`);
      const { sha256: fileSha256, ...preserved } = source;
      return { ...preserved, fileSha256 };
    }),
    primarySeries: input.markets.map(item => ({
      key: item.key,
      ticker: item.primary.ticker,
      returnType: item.primary.returnType,
      executable: item.primary.executable,
      firstDate: item.primary.history.firstDate,
      lastDate: item.primary.history.lastDate,
      rowCount: item.primary.history.rowCount,
      normalizedRowsSha256: item.primary.history.normalizedRowsSha256,
      rawPayloadSha256: item.primary.source.rawPayloadSha256,
      retrievedAt: item.primary.source.retrievedAt,
      sourceUrl: item.primary.source.sourceUrl,
      sourceArtifactSha256: item.primary.source.sourceArtifactSha256,
    })),
    robustnessSeries: input.markets.flatMap(item => item.robustness).map(item => ({
      key: item.key,
      ticker: item.ticker,
      role: item.replacementPolicy,
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
    })),
    cash: {
      ticker: input.cash.ticker,
      returnType: input.cash.returnType,
      executable: input.cash.executable,
      firstDate: input.cash.history.firstDate,
      lastDate: input.cash.history.lastDate,
      rowCount: input.cash.history.rowCount,
      normalizedRowsSha256: input.cash.history.normalizedRowsSha256,
      rawPayloadSha256: input.cash.source.rawPayloadSha256,
      retrievedAt: input.cash.source.retrievedAt,
      sourceUrl: input.cash.source.sourceUrl,
      sourceArtifactSha256: input.cash.source.sourceArtifactSha256,
    },
    historyPanels: input.historyPanels,
    sourceCorrection: input.sourceCorrection,
  };
}

function parseArgs(argv) {
  const options = {
    collectRobustness: false,
    asOfDate: DEFAULT_AS_OF_DATE,
    retrievedAt: null,
    cmbitmSnapshot: DEFAULT_CMBITM_SNAPSHOT,
    equityCache: DEFAULT_EQUITY_CACHE,
    robustnessCache: DEFAULT_ROBUSTNESS_CACHE,
    output: DEFAULT_OUTPUT,
    manifest: DEFAULT_MANIFEST,
  };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--collect-robustness') options.collectRobustness = true;
    else if (arg === '--as-of') options.asOfDate = argv[++index];
    else if (arg === '--retrieved-at') options.retrievedAt = argv[++index];
    else if (arg === '--cmbitm-snapshot') options.cmbitmSnapshot = argv[++index];
    else if (arg === '--equity-cache') options.equityCache = argv[++index];
    else if (arg === '--robustness-cache') options.robustnessCache = argv[++index];
    else if (arg === '--output') options.output = argv[++index];
    else if (arg === '--manifest') options.manifest = argv[++index];
    else throw new Error(`Unknown argument: ${arg}`);
  }
  dateMs(options.asOfDate);
  if (options.retrievedAt) exactIsoUtc(options.retrievedAt, '--retrieved-at');
  return options;
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.collectRobustness) {
    const cache = await collectRobustnessCache({
      asOfDate: options.asOfDate,
      retrievedAt: options.retrievedAt || new Date().toISOString(),
    });
    const write = writeRobustnessCache(options.robustnessCache, cache);
    process.stderr.write(`Frozen robustness raw cache: ${write.absolutePath}\nSHA-256: ${write.sha256}\n`);
  }
  const cmbitmArtifact = sourceArtifact(options.cmbitmSnapshot, EXPECTED_CMBITM_SNAPSHOT_SHA256);
  const equityArtifact = sourceArtifact(options.equityCache, EXPECTED_EQUITY_CACHE_SHA256);
  const robustnessArtifact = sourceArtifact(options.robustnessCache);
  const input = buildInput({ cmbitmArtifact, equityArtifact, robustnessArtifact, asOfDate: options.asOfDate });
  const inputWrite = writeStableJson(options.output, input);
  const manifest = freezeManifest(input, inputWrite, [cmbitmArtifact, equityArtifact, robustnessArtifact]);
  const manifestWrite = writeStableJson(options.manifest, manifest);
  process.stdout.write(`${JSON.stringify({
    status: STATUS,
    inputPath: inputWrite.absolutePath,
    inputSha256: inputWrite.sha256,
    manifestPath: manifestWrite.absolutePath,
    manifestSha256: manifestWrite.sha256,
    primarySeries: manifest.primarySeries,
    robustnessSeries: manifest.robustnessSeries,
    cash: manifest.cash,
    historyPanels: manifest.historyPanels,
  }, null, 2)}\n`);
  return { input, inputWrite, manifest, manifestWrite };
}

module.exports = {
  REPO_ROOT, SCHEMA, STATUS, ROBUSTNESS_CACHE_SCHEMA, FREEZE_MANIFEST_SCHEMA,
  DEFAULT_AS_OF_DATE, DEFAULT_CMBITM_SNAPSHOT, DEFAULT_EQUITY_CACHE,
  DEFAULT_ROBUSTNESS_CACHE, DEFAULT_OUTPUT, DEFAULT_MANIFEST,
  EXPECTED_CMBITM_SNAPSHOT_SHA256, EXPECTED_EQUITY_CACHE_SHA256,
  EXPECTED_CMBITM_RAW_SHA256, RETURN_TYPES, PRIMARY_ETFS, ROBUSTNESS_ETFS,
  DataRequiredError, sha256, canonicalize, stableJson, isSha256, dateMs,
  isoDate, addDays, calendarDays, exactIsoUtc, requiredText, stableArtifactPath, sourceArtifact,
  normalizePositiveRows, normalizeYieldRows, history, bankDiscountDailyFactor,
  buildDailyCashWealth, yahooUrl, fetchBytes, parseYahooAdjustedClose,
  collectRobustnessCache, writeStableJson, writeRobustnessCache,
  buildCmbitmSeries, buildPrimaryEtfSeries, buildRobustnessEtfSeries,
  buildCashSeries, strictCommonHistory, normalizedSourceMeta, buildInput,
  validateSeries, validateInput, freezeManifest, parseArgs, main,
};

if (require.main === module) {
  main().catch(error => {
    if (error && error.code === 'DATA_REQUIRED') {
      process.stderr.write(`${JSON.stringify({ status: 'DATA_REQUIRED', message: error.message, details: error.details || {} }, null, 2)}\n`);
      process.exitCode = 2;
      return;
    }
    process.stderr.write(`${error && error.stack || error}\n`);
    process.exitCode = 1;
  });
}
