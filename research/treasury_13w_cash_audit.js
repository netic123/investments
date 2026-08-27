'use strict';

// Data-only reality check for the v2 reconstructed DTB3 cash series. This
// module compares positive cash held from the actual issue date through the
// actual maturity date of official 13-week Treasury-bill auctions. It never
// reads or produces a market signal, strategy return, or strategy result.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const base = require('./five_market_proxy_data');
const v2 = require('./five_market_proxy_data_v2');

const REPO_ROOT = path.resolve(__dirname, '..');
const SCHEMA = 'treasury-13w-dtb3-cash-audit-v1';
const RECEIPT_SCHEMA = 'fiscaldata-treasury-13w-auctions-source-v1';
const STATUS = 'DATA_ONLY_POSITIVE_CASH_PROXY_REALITY_AUDIT';
const START_AUCTION_DATE = '1995-01-01';
const AS_OF_DATE = '2026-08-24';
const SINGLE_PRICE_START = '1998-11-02';
const API_ENDPOINT = 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v1/accounting/od/auctions_query';
const API_REQUEST_URL = `${API_ENDPOINT}?filter=security_type:eq:Bill,security_term:eq:13-Week,auction_date:gte:${START_AUCTION_DATE},auction_date:lte:${AS_OF_DATE}&sort=auction_date,cusip&page[number]=1&page[size]=10000`;

const PATHS = Object.freeze({
  raw: path.join(__dirname, 'local-artifacts', 'treasury-13w-cash-audit', 'fiscaldata-treasury-13w-auctions-1995-01-01-to-2026-08-24.json'),
  rawSidecar: path.join(__dirname, 'local-artifacts', 'treasury-13w-cash-audit', 'fiscaldata-treasury-13w-auctions-1995-01-01-to-2026-08-24.json.sha256'),
  receipt: path.join(__dirname, 'local-artifacts', 'treasury-13w-cash-audit', 'fiscaldata-treasury-13w-auctions-source-2026-08-24.json'),
  receiptSidecar: path.join(__dirname, 'local-artifacts', 'treasury-13w-cash-audit', 'fiscaldata-treasury-13w-auctions-source-2026-08-24.json.sha256'),
  v2Manifest: path.join(__dirname, 'FIVE_MARKET_PROXY_DATA_FREEZE_V2_2026-08-24.json'),
  v2ManifestSidecar: path.join(__dirname, 'FIVE_MARKET_PROXY_DATA_FREEZE_V2_2026-08-24.json.sha256'),
  result: path.join(__dirname, 'TREASURY_13W_CASH_AUDIT_2026-08-24.json'),
  resultSidecar: path.join(__dirname, 'TREASURY_13W_CASH_AUDIT_2026-08-24.json.sha256'),
});

const EXPECTED = Object.freeze({
  raw: 'fa267363f210822e6f2c499bf6a2ea6b76d02a32bb80bfc8f921d96cb4e4c16d',
  rawSidecar: '8a04b0d99d46565aef9fb156d843e4600b116855ac6093eab2b702eaf573f1e0',
  receipt: '8fe04a0bfc077eb7ca19ca44ad95437abcff2ec0ac685cdac6615314052c8798',
  receiptSidecar: '839755d6a1f6d3feebae08a7261fd5b5104adfc8d029944db70db7460147188e',
  result: '432ba57be9884d0a5135132004e479f8d2e84b95abbfe7366ef68af2f2e5e84d',
  resultSidecar: 'ef5b3b552737bf478d9daf797f1d66b18de36e4057e40a15b9dce4176376dd0a',
  v2Manifest: '1e64de19073b05aacc599083edff050eddd5a710be792212d1d0bcd8ccc0159e',
  v2ManifestSidecar: '3d84a806621cb78052ba6ed99456d6c242d62df3236ace8bffa0fa04e3ea84ee',
  v2FredRaw: v2.EXPECTED.fredRaw,
  v2FredRawSidecar: v2.EXPECTED.fredRawSidecar,
  v2CashRows: v2.EXPECTED.cashRows,
  auctionRows: 1652,
  multiplePriceRows: 200,
  singlePriceRows: 1452,
  maturedRows: 1638,
});

const SUBPERIODS = Object.freeze([
  Object.freeze({ key: 'multiple_price_1995_to_1998_11_01', firstAuctionDate: START_AUCTION_DATE, lastAuctionDate: '1998-11-01' }),
  Object.freeze({ key: 'single_price_1998_11_02_to_2007', firstAuctionDate: SINGLE_PRICE_START, lastAuctionDate: '2007-12-31' }),
  Object.freeze({ key: 'single_price_2008_to_2019', firstAuctionDate: '2008-01-01', lastAuctionDate: '2019-12-31' }),
  Object.freeze({ key: 'single_price_2020_to_2026_08_24', firstAuctionDate: '2020-01-01', lastAuctionDate: AS_OF_DATE }),
]);

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

function exactIsoUtc(value, context) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) {
    throw new IntegrityError(`${context} must be exact ISO UTC`);
  }
  return value;
}

function readArtifact(file, expectedSha256 = null) {
  const absolutePath = path.resolve(file);
  const bytes = fs.readFileSync(absolutePath);
  const digest = sha256(bytes);
  if (expectedSha256 && digest !== expectedSha256) {
    throw new IntegrityError(`${repoPath(absolutePath)} SHA-256 mismatch`, { expectedSha256, actualSha256: digest });
  }
  return { absolutePath, path: repoPath(absolutePath), bytes, sha256: digest };
}

function verifySidecar(sidecar, artifact, expectedFilename = path.basename(artifact.absolutePath)) {
  const expected = `${artifact.sha256}  ${expectedFilename}\n`;
  if (sidecar.bytes.toString('utf8') !== expected) throw new IntegrityError(`${sidecar.path} is not the exact expected SHA-256 sidecar`);
}

function parseJsonBytes(bytes, context) {
  try { return JSON.parse(Buffer.from(bytes).toString('utf8')); }
  catch (error) { throw new IntegrityError(`${context} is invalid JSON`, { cause: error.message }); }
}

function strictNumber(value, context) {
  if (value === null || value === undefined || value === '' || value === 'null') throw new IntegrityError(`${context} is missing`);
  const number = Number(value);
  if (!Number.isFinite(number)) throw new IntegrityError(`${context} is not numeric`, { value });
  return number;
}

function normalizeAuctionRow(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) throw new IntegrityError('auction row must be an object');
  const requiredText = field => {
    const value = row[field];
    if (typeof value !== 'string' || !value || value === 'null') throw new IntegrityError(`auction row ${field} is missing`);
    return value;
  };
  const auctionDate = requiredText('auction_date');
  const issueDate = requiredText('issue_date');
  const maturityDate = requiredText('maturity_date');
  base.dateMs(auctionDate);
  base.dateMs(issueDate);
  base.dateMs(maturityDate);
  if (row.security_type !== 'Bill' || row.security_term !== '13-Week' || row.security_term_week_year !== '13-Week') {
    throw new IntegrityError('auction row is not the requested 13-week Treasury bill', {
      securityType: row.security_type,
      securityTerm: row.security_term,
      securityTermWeekYear: row.security_term_week_year,
    });
  }
  if (auctionDate < START_AUCTION_DATE || auctionDate > AS_OF_DATE) throw new IntegrityError('auction row is outside the frozen request range', { auctionDate });
  if (auctionDate > issueDate || issueDate >= maturityDate) throw new IntegrityError('auction row dates are not ordered auction <= issue < maturity', { auctionDate, issueDate, maturityDate });

  const isMultiplePrice = auctionDate < SINGLE_PRICE_START;
  const expectedFormat = isMultiplePrice ? 'Multi-Price' : 'Single-Price';
  if (row.auction_format !== expectedFormat) {
    throw new IntegrityError('auction format does not match the documented 1998-11-02 regime boundary', {
      auctionDate,
      expectedFormat,
      actualFormat: row.auction_format,
    });
  }
  const purchasePriceField = isMultiplePrice ? 'avg_med_price' : 'high_price';
  const purchasePricePer100 = strictNumber(row[purchasePriceField], `${auctionDate} ${purchasePriceField}`);
  if (!(purchasePricePer100 > 0)) throw new IntegrityError('auction purchase price must be positive', { auctionDate, purchasePricePer100 });
  const holdingDays = base.calendarDays(issueDate, maturityDate);
  if (!Number.isInteger(holdingDays) || holdingDays < 1 || holdingDays > 366) throw new IntegrityError('auction holding period is invalid', { issueDate, maturityDate, holdingDays });
  const cusip = requiredText('cusip');
  return {
    key: `${cusip}|${auctionDate}|${issueDate}|${maturityDate}`,
    cusip,
    auctionDate,
    issueDate,
    maturityDate,
    holdingDays,
    auctionFormat: expectedFormat,
    purchasePriceField,
    purchasePricePer100,
    realizedHoldingPeriodReturn: 100 / purchasePricePer100 - 1,
  };
}

function normalizeAuctionRows(rows) {
  if (!Array.isArray(rows) || rows.length === 0) throw new IntegrityError('FiscalData payload contains no auction rows');
  const normalized = rows.map(normalizeAuctionRow).sort((left, right) => left.auctionDate.localeCompare(right.auctionDate) || left.cusip.localeCompare(right.cusip));
  const seen = new Set();
  for (const row of normalized) {
    if (seen.has(row.key)) throw new IntegrityError('FiscalData payload contains a duplicate auction row', { key: row.key });
    seen.add(row.key);
  }
  return normalized;
}

function payloadSummary(auctions, meta) {
  const termDayCounts = {};
  for (const row of auctions) termDayCounts[row.holdingDays] = (termDayCounts[row.holdingDays] || 0) + 1;
  return {
    rowCount: auctions.length,
    firstAuctionDate: auctions[0].auctionDate,
    lastAuctionDate: auctions.at(-1).auctionDate,
    multiplePriceRows: auctions.filter(row => row.auctionFormat === 'Multi-Price').length,
    singlePriceRows: auctions.filter(row => row.auctionFormat === 'Single-Price').length,
    maturedByAsOfDate: auctions.filter(row => row.maturityDate <= AS_OF_DATE).length,
    notMaturedByAsOfDate: auctions.filter(row => row.maturityDate > AS_OF_DATE).length,
    holdingDayCounts: termDayCounts,
    apiMeta: {
      count: Number(meta.count),
      totalCount: Number(meta['total-count']),
      totalPages: Number(meta['total-pages']),
    },
  };
}

function parseFiscalDataPayload(bytes, requireFullSnapshot = true) {
  const payload = parseJsonBytes(bytes, 'FiscalData Treasury auction payload');
  if (!payload || !Array.isArray(payload.data) || !payload.meta || typeof payload.meta !== 'object') {
    throw new IntegrityError('FiscalData Treasury auction payload schema is missing data or meta');
  }
  const auctions = normalizeAuctionRows(payload.data);
  const summary = payloadSummary(auctions, payload.meta);
  if (summary.apiMeta.count !== auctions.length || summary.apiMeta.totalCount !== auctions.length || summary.apiMeta.totalPages !== 1) {
    throw new IntegrityError('FiscalData pagination is incomplete', { summary });
  }
  if (requireFullSnapshot) {
    const expectedIdentity = {
      rowCount: EXPECTED.auctionRows,
      firstAuctionDate: '1995-01-03',
      lastAuctionDate: '2026-08-24',
      multiplePriceRows: EXPECTED.multiplePriceRows,
      singlePriceRows: EXPECTED.singlePriceRows,
      maturedByAsOfDate: EXPECTED.maturedRows,
    };
    for (const [field, expected] of Object.entries(expectedIdentity)) {
      if (summary[field] !== expected) throw new IntegrityError(`FiscalData frozen identity mismatch for ${field}`, { expected, actual: summary[field] });
    }
  }
  return { payload, auctions, summary };
}

function writeNewArtifact(file, bytes) {
  const absolutePath = path.resolve(file);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, bytes, { flag: 'wx' });
  return { absolutePath, path: repoPath(absolutePath), bytes: Buffer.byteLength(bytes), sha256: sha256(bytes) };
}

function sidecarBytes(artifact) {
  return Buffer.from(`${artifact.sha256}  ${path.basename(artifact.absolutePath)}\n`, 'utf8');
}

async function fetchAndFreezeSource(fetchImpl = globalThis.fetch, now = () => new Date()) {
  if (typeof fetchImpl !== 'function') throw new IntegrityError('Fetch implementation is unavailable');
  for (const file of [PATHS.raw, PATHS.rawSidecar, PATHS.receipt, PATHS.receiptSidecar]) {
    if (fs.existsSync(file)) throw new IntegrityError(`refusing to replace frozen source artifact: ${repoPath(file)}`);
  }
  let response;
  try {
    response = await fetchImpl(API_REQUEST_URL, {
      headers: {
        accept: 'application/json',
        'user-agent': 'investments-treasury-13w-cash-audit/1.0',
      },
    });
  } catch (error) {
    throw new IntegrityError('official FiscalData Treasury auction request failed', { cause: error.message, url: API_REQUEST_URL });
  }
  if (!response || !response.ok) throw new IntegrityError('official FiscalData Treasury auction request returned an error', { status: response && response.status, url: API_REQUEST_URL });
  const rawBytes = Buffer.from(await response.arrayBuffer());
  const parsed = parseFiscalDataPayload(rawBytes, true);
  const retrievedAt = exactIsoUtc(now().toISOString(), 'retrieval time');
  const raw = writeNewArtifact(PATHS.raw, rawBytes);
  const rawSidecar = writeNewArtifact(PATHS.rawSidecar, sidecarBytes(raw));
  const responseHeaders = {};
  for (const name of ['content-type', 'content-length', 'date', 'etag', 'last-modified']) {
    const value = response.headers && response.headers.get && response.headers.get(name);
    if (value) responseHeaders[name] = value;
  }
  const receiptValue = {
    schema: RECEIPT_SCHEMA,
    status: STATUS,
    provider: 'U.S. Department of the Treasury, Bureau of the Fiscal Service',
    dataset: 'Treasury Securities Auctions Data',
    endpoint: API_ENDPOINT,
    requestUrl: API_REQUEST_URL,
    retrievedAt,
    requestedAuctionDateStart: START_AUCTION_DATE,
    requestedAuctionDateEnd: AS_OF_DATE,
    filters: {
      securityType: 'Bill',
      securityTerm: '13-Week',
      pageNumber: 1,
      pageSize: 10000,
      sort: ['auction_date', 'cusip'],
    },
    responseHeaders,
    rawPayload: {
      path: raw.path,
      bytes: raw.bytes,
      sha256: raw.sha256,
      sidecarPath: rawSidecar.path,
      sidecarSha256: rawSidecar.sha256,
    },
    payloadSummary: parsed.summary,
    rawBytesRetained: true,
    containsStrategySignals: false,
    containsStrategyOutcomes: false,
  };
  const receipt = writeNewArtifact(PATHS.receipt, Buffer.from(base.stableJson(receiptValue), 'utf8'));
  const receiptSidecar = writeNewArtifact(PATHS.receiptSidecar, sidecarBytes(receipt));
  return { raw, rawSidecar, receipt, receiptSidecar, receiptValue, parsed };
}

function loadFrozenSource() {
  const raw = readArtifact(PATHS.raw, EXPECTED.raw);
  const rawSidecar = readArtifact(PATHS.rawSidecar, EXPECTED.rawSidecar);
  verifySidecar(rawSidecar, raw);
  const receipt = readArtifact(PATHS.receipt, EXPECTED.receipt);
  const receiptSidecar = readArtifact(PATHS.receiptSidecar, EXPECTED.receiptSidecar);
  verifySidecar(receiptSidecar, receipt);
  const receiptValue = parseJsonBytes(receipt.bytes, 'FiscalData source receipt');
  if (receiptValue.schema !== RECEIPT_SCHEMA || receiptValue.status !== STATUS || receiptValue.requestUrl !== API_REQUEST_URL || receiptValue.rawBytesRetained !== true || receiptValue.containsStrategySignals !== false || receiptValue.containsStrategyOutcomes !== false) {
    throw new IntegrityError('FiscalData source receipt identity mismatch');
  }
  exactIsoUtc(receiptValue.retrievedAt, 'source receipt retrievedAt');
  if (!receiptValue.rawPayload || receiptValue.rawPayload.path !== raw.path || receiptValue.rawPayload.bytes !== raw.bytes.length || receiptValue.rawPayload.sha256 !== raw.sha256 || receiptValue.rawPayload.sidecarPath !== rawSidecar.path || receiptValue.rawPayload.sidecarSha256 !== rawSidecar.sha256) {
    throw new IntegrityError('FiscalData source receipt artifact linkage mismatch');
  }
  const parsed = parseFiscalDataPayload(raw.bytes, true);
  if (base.stableJson(receiptValue.payloadSummary) !== base.stableJson(parsed.summary)) throw new IntegrityError('FiscalData source receipt summary mismatch');
  return { raw, rawSidecar, receipt, receiptSidecar, receiptValue, ...parsed };
}

function loadV2Cash() {
  const manifest = readArtifact(PATHS.v2Manifest, EXPECTED.v2Manifest);
  const manifestSidecar = readArtifact(PATHS.v2ManifestSidecar, EXPECTED.v2ManifestSidecar);
  verifySidecar(manifestSidecar, manifest);
  const manifestValue = parseJsonBytes(manifest.bytes, 'v2 freeze manifest');
  if (manifestValue.schema !== v2.FREEZE_MANIFEST_SCHEMA || manifestValue.asOfDate !== AS_OF_DATE || manifestValue.containsStrategyOutcomes !== false || !manifestValue.cash || manifestValue.cash.normalizedRowsSha256 !== EXPECTED.v2CashRows) {
    throw new IntegrityError('v2 freeze manifest identity mismatch');
  }
  const fredRaw = readArtifact(v2.PATHS.fredRaw, EXPECTED.v2FredRaw);
  const fredRawSidecar = readArtifact(v2.PATHS.fredRawSidecar, EXPECTED.v2FredRawSidecar);
  verifySidecar(fredRawSidecar, fredRaw);
  const observations = v2.parseFredCsv(fredRaw.bytes, AS_OF_DATE);
  const built = base.buildDailyCashWealth(observations, AS_OF_DATE, 7);
  const cashHistory = base.history(built.rows);
  if (cashHistory.normalizedRowsSha256 !== EXPECTED.v2CashRows || cashHistory.firstDate !== '1995-01-04' || cashHistory.lastDate !== AS_OF_DATE) {
    throw new IntegrityError('rebuilt v2 cash rows do not match the frozen v2 identity', { cashHistory });
  }
  return { manifest, manifestSidecar, manifestValue, fredRaw, fredRawSidecar, observations, rows: built.rows, cashHistory };
}

function compareAuctionWindows(auctions, cashRows, asOfDate = AS_OF_DATE) {
  base.dateMs(asOfDate);
  const cashByDate = new Map();
  for (const row of cashRows) {
    base.dateMs(row.date);
    if (cashByDate.has(row.date)) throw new IntegrityError('v2 cash rows contain a duplicate date', { date: row.date });
    if (!(Number(row.value) > 0)) throw new IntegrityError('v2 cash row is not positive', { row });
    cashByDate.set(row.date, Number(row.value));
  }
  const comparisons = [];
  const exclusions = [];
  for (const auction of auctions) {
    if (auction.maturityDate > asOfDate) {
      exclusions.push({ key: auction.key, cusip: auction.cusip, auctionDate: auction.auctionDate, issueDate: auction.issueDate, maturityDate: auction.maturityDate, reason: 'NOT_MATURED_BY_FIXED_AS_OF_DATE' });
      continue;
    }
    const issueValue = cashByDate.get(auction.issueDate);
    const maturityValue = cashByDate.get(auction.maturityDate);
    if (!(issueValue > 0) || !(maturityValue > 0)) {
      exclusions.push({
        key: auction.key,
        cusip: auction.cusip,
        auctionDate: auction.auctionDate,
        issueDate: auction.issueDate,
        maturityDate: auction.maturityDate,
        reason: 'EXACT_V2_CASH_BOUNDARY_MISSING',
        issueValuePresent: issueValue > 0,
        maturityValuePresent: maturityValue > 0,
      });
      continue;
    }
    const modeledHoldingPeriodReturn = maturityValue / issueValue - 1;
    const error = modeledHoldingPeriodReturn - auction.realizedHoldingPeriodReturn;
    comparisons.push({
      key: auction.key,
      cusip: auction.cusip,
      auctionDate: auction.auctionDate,
      issueDate: auction.issueDate,
      maturityDate: auction.maturityDate,
      holdingDays: auction.holdingDays,
      auctionFormat: auction.auctionFormat,
      purchasePriceField: auction.purchasePriceField,
      purchasePricePer100: auction.purchasePricePer100,
      auctionHoldingPeriodReturn: auction.realizedHoldingPeriodReturn,
      modeledV2CashHoldingPeriodReturn: modeledHoldingPeriodReturn,
      signedError: error,
      signedErrorBasisPoints: error * 10000,
      absoluteErrorBasisPoints: Math.abs(error) * 10000,
    });
  }
  return { comparisons, exclusions };
}

function mean(values) {
  if (!Array.isArray(values) || values.length === 0) throw new IntegrityError('mean requires at least one value');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function quantileR7(values, probability) {
  if (!Array.isArray(values) || values.length === 0) throw new IntegrityError('quantile requires at least one value');
  if (!(probability >= 0 && probability <= 1)) throw new IntegrityError('quantile probability must be in [0,1]');
  const sorted = values.map(Number).sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function pearson(left, right) {
  if (left.length !== right.length || left.length < 2) return null;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let numerator = 0;
  let leftSum = 0;
  let rightSum = 0;
  for (let index = 0; index < left.length; index++) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftSum += leftDelta ** 2;
    rightSum += rightDelta ** 2;
  }
  return leftSum > 0 && rightSum > 0 ? numerator / Math.sqrt(leftSum * rightSum) : null;
}

function cleanNumber(value) {
  if (!Number.isFinite(value)) throw new IntegrityError('audit metric is not finite', { value });
  return Number(value.toPrecision(15));
}

function summarizeComparisons(comparisons) {
  if (!Array.isArray(comparisons) || comparisons.length === 0) throw new IntegrityError('comparison summary requires at least one window');
  const auctionReturns = comparisons.map(row => row.auctionHoldingPeriodReturn);
  const modeledReturns = comparisons.map(row => row.modeledV2CashHoldingPeriodReturn);
  const signedErrorsBps = comparisons.map(row => row.signedErrorBasisPoints);
  const absoluteErrorsBps = comparisons.map(row => row.absoluteErrorBasisPoints);
  const exposureDays = comparisons.reduce((sum, row) => sum + row.holdingDays, 0);
  const auctionLogGrowth = auctionReturns.reduce((sum, value) => sum + Math.log1p(value), 0);
  const modeledLogGrowth = modeledReturns.reduce((sum, value) => sum + Math.log1p(value), 0);
  const auctionAnnualized = Math.expm1(auctionLogGrowth * 365 / exposureDays);
  const modeledAnnualized = Math.expm1(modeledLogGrowth * 365 / exposureDays);
  return {
    windowCount: comparisons.length,
    firstAuctionDate: comparisons[0].auctionDate,
    lastAuctionDate: comparisons.at(-1).auctionDate,
    totalOverlappingExposureDays: exposureDays,
    meanAuctionHoldingPeriodReturnPct: cleanNumber(mean(auctionReturns) * 100),
    meanModeledHoldingPeriodReturnPct: cleanNumber(mean(modeledReturns) * 100),
    meanSignedErrorBasisPoints: cleanNumber(mean(signedErrorsBps)),
    medianSignedErrorBasisPoints: cleanNumber(quantileR7(signedErrorsBps, 0.5)),
    rootMeanSquaredErrorBasisPoints: cleanNumber(Math.sqrt(mean(signedErrorsBps.map(value => value ** 2)))),
    absoluteErrorBasisPoints: {
      mean: cleanNumber(mean(absoluteErrorsBps)),
      p50: cleanNumber(quantileR7(absoluteErrorsBps, 0.5)),
      p90: cleanNumber(quantileR7(absoluteErrorsBps, 0.9)),
      p95: cleanNumber(quantileR7(absoluteErrorsBps, 0.95)),
      p99: cleanNumber(quantileR7(absoluteErrorsBps, 0.99)),
      max: cleanNumber(Math.max(...absoluteErrorsBps)),
    },
    pooledExposureAnnualized: {
      interpretation: 'Annualized from summed log growth divided by summed holding days. Weekly auctions overlap, so this is an exposure-weighted diagnostic, not an investable cumulative wealth path.',
      auctionReturnPct: cleanNumber(auctionAnnualized * 100),
      modeledV2CashReturnPct: cleanNumber(modeledAnnualized * 100),
      modeledMinusAuctionPercentagePoints: cleanNumber((modeledAnnualized - auctionAnnualized) * 100),
    },
    pearsonCorrelation: cleanNumber(pearson(auctionReturns, modeledReturns)),
  };
}

function summarizeChain(rows) {
  if (!rows.length) throw new IntegrityError('exact-roll chain must not be empty');
  const first = rows[0];
  const last = rows.at(-1);
  const calendarDays = base.calendarDays(first.issueDate, last.maturityDate);
  const auctionTerminalWealth = Math.exp(rows.reduce((sum, row) => sum + Math.log1p(row.auctionHoldingPeriodReturn), 0));
  const modeledTerminalWealth = Math.exp(rows.reduce((sum, row) => sum + Math.log1p(row.modeledV2CashHoldingPeriodReturn), 0));
  const auctionAnnualized = auctionTerminalWealth ** (365 / calendarDays) - 1;
  const modeledAnnualized = modeledTerminalWealth ** (365 / calendarDays) - 1;
  return {
    chainId: first.issueDate,
    firstAuctionDate: first.auctionDate,
    firstIssueDate: first.issueDate,
    finalMaturityDate: last.maturityDate,
    windowCount: rows.length,
    calendarDays,
    auctionTerminalWealth: cleanNumber(auctionTerminalWealth),
    modeledV2CashTerminalWealth: cleanNumber(modeledTerminalWealth),
    modeledMinusAuctionTerminalWealth: cleanNumber(modeledTerminalWealth - auctionTerminalWealth),
    modeledToAuctionWealthRatioMinusOnePct: cleanNumber((modeledTerminalWealth / auctionTerminalWealth - 1) * 100),
    auctionAnnualizedReturnPct: cleanNumber(auctionAnnualized * 100),
    modeledV2CashAnnualizedReturnPct: cleanNumber(modeledAnnualized * 100),
    modeledMinusAuctionAnnualizedPercentagePoints: cleanNumber((modeledAnnualized - auctionAnnualized) * 100),
  };
}

function buildExactRollChains(comparisons) {
  const byIssueDate = new Map();
  for (const row of comparisons) {
    if (byIssueDate.has(row.issueDate)) throw new IntegrityError('more than one comparable 13-week auction has the same issue date', { issueDate: row.issueDate });
    byIssueDate.set(row.issueDate, row);
  }
  const predecessor = new Map();
  for (const row of comparisons) {
    const successor = byIssueDate.get(row.maturityDate);
    if (!successor) continue;
    if (predecessor.has(successor.key)) throw new IntegrityError('exact-roll chain has more than one predecessor', { key: successor.key });
    predecessor.set(successor.key, row.key);
  }
  const roots = comparisons.filter(row => !predecessor.has(row.key)).sort((left, right) => left.issueDate.localeCompare(right.issueDate) || left.cusip.localeCompare(right.cusip));
  const visited = new Set();
  const chains = [];
  for (const root of roots) {
    const rows = [];
    let cursor = root;
    while (cursor && !visited.has(cursor.key)) {
      rows.push(cursor);
      visited.add(cursor.key);
      cursor = byIssueDate.get(cursor.maturityDate);
    }
    chains.push({ rows, summary: summarizeChain(rows) });
  }
  if (visited.size !== comparisons.length) throw new IntegrityError('exact-roll chains did not cover every comparable auction', { visited: visited.size, comparisons: comparisons.length });
  chains.sort((left, right) => right.summary.windowCount - left.summary.windowCount || right.summary.calendarDays - left.summary.calendarDays || left.summary.chainId.localeCompare(right.summary.chainId));
  return chains;
}

function summarizeExactRollChains(chains) {
  if (!chains.length) throw new IntegrityError('at least one exact-roll chain is required');
  const summaries = chains.map(chain => chain.summary);
  const annualizedDifferences = summaries.map(row => row.modeledMinusAuctionAnnualizedPercentagePoints);
  const wealthRatioDifferences = summaries.map(row => row.modeledToAuctionWealthRatioMinusOnePct);
  return {
    construction: 'Maximal non-overlapping paths where one 13-week bill maturity date exactly equals the next 13-week bill issue date. The primary path is the longest, then longest calendar span, then earliest lexical chain id; selection uses no return value.',
    caveat: 'Auction purchase at issue and redemption at par are executable in principle, but these calculations omit bid limits, taxes, account frictions, fees, and any cash gap. Only exact no-gap paths are chained.',
    chainCount: chains.length,
    coveredWindowCount: summaries.reduce((sum, row) => sum + row.windowCount, 0),
    primaryChain: summaries[0],
    acrossChains: {
      windowCountMin: Math.min(...summaries.map(row => row.windowCount)),
      windowCountMedian: cleanNumber(quantileR7(summaries.map(row => row.windowCount), 0.5)),
      windowCountMax: Math.max(...summaries.map(row => row.windowCount)),
      modeledMinusAuctionAnnualizedPercentagePoints: {
        min: cleanNumber(Math.min(...annualizedDifferences)),
        median: cleanNumber(quantileR7(annualizedDifferences, 0.5)),
        max: cleanNumber(Math.max(...annualizedDifferences)),
      },
      modeledToAuctionWealthRatioMinusOnePct: {
        min: cleanNumber(Math.min(...wealthRatioDifferences)),
        median: cleanNumber(quantileR7(wealthRatioDifferences, 0.5)),
        max: cleanNumber(Math.max(...wealthRatioDifferences)),
      },
    },
    chains: summaries,
  };
}

function buildAudit(source, cash) {
  const compared = compareAuctionWindows(source.auctions, cash.rows, AS_OF_DATE);
  const missingBoundary = compared.exclusions.filter(row => row.reason === 'EXACT_V2_CASH_BOUNDARY_MISSING');
  if (compared.comparisons.length !== EXPECTED.maturedRows || missingBoundary.length !== 0) {
    throw new IntegrityError('not every matured auction has exact v2 cash issue/maturity boundaries', {
      expectedComparable: EXPECTED.maturedRows,
      actualComparable: compared.comparisons.length,
      missingBoundaryCount: missingBoundary.length,
    });
  }
  const chains = buildExactRollChains(compared.comparisons);
  const subperiods = SUBPERIODS.map(period => {
    const rows = compared.comparisons.filter(row => row.auctionDate >= period.firstAuctionDate && row.auctionDate <= period.lastAuctionDate);
    return { ...period, ...summarizeComparisons(rows) };
  });
  const termDayCounts = {};
  for (const row of compared.comparisons) termDayCounts[row.holdingDays] = (termDayCounts[row.holdingDays] || 0) + 1;
  return {
    schema: SCHEMA,
    status: STATUS,
    asOfDate: AS_OF_DATE,
    containsMarketSignals: false,
    containsStrategyReturns: false,
    containsStrategyOutcomes: false,
    purpose: 'Validate only the positive-cash accrual behavior of the frozen v2 DTB3 reconstruction against official, executable-in-principle 13-week Treasury bills bought at auction and held to maturity.',
    scopeBoundary: {
      validates: 'Positive USD cash held over exact Treasury-bill issue-to-maturity windows before fees, taxes, limits, and account frictions.',
      doesNotValidate: 'Borrowing, margin, leverage financing, haircuts, short-sale proceeds, secondary-market liquidation, or any market-timing or allocation strategy.',
    },
    officialAuctionSource: {
      provider: source.receiptValue.provider,
      dataset: source.receiptValue.dataset,
      endpoint: source.receiptValue.endpoint,
      requestUrl: source.receiptValue.requestUrl,
      retrievedAt: source.receiptValue.retrievedAt,
      rawPayloadPath: source.raw.path,
      rawPayloadBytes: source.raw.bytes.length,
      rawPayloadSha256: source.raw.sha256,
      rawPayloadSidecarPath: source.rawSidecar.path,
      sourceReceiptPath: source.receipt.path,
      sourceReceiptSha256: source.receipt.sha256,
      sourceReceiptSidecarPath: source.receiptSidecar.path,
    },
    v2CashSource: {
      manifestPath: cash.manifest.path,
      manifestSha256: cash.manifest.sha256,
      frozenFredRawPath: cash.fredRaw.path,
      frozenFredRawSha256: cash.fredRaw.sha256,
      cashTicker: cash.manifestValue.cash.ticker,
      cashRowsSha256: cash.cashHistory.normalizedRowsSha256,
      cashFirstDate: cash.cashHistory.firstDate,
      cashLastDate: cash.cashHistory.lastDate,
      informationLagRule: 'Each accrual interval beginning on date t uses the latest DTB3 observation dated strictly before t, no more than seven calendar days old.',
    },
    methodology: {
      multiplePriceRule: `For auction dates before ${SINGLE_PRICE_START}, use FiscalData avg_med_price, the noncompetitive multiple-price auction purchase basis.`,
      singlePriceRule: `For auction dates on or after ${SINGLE_PRICE_START}, use FiscalData high_price, the uniform-price auction purchase basis.`,
      realizedHoldingPeriodReturn: '100 / purchase_price_per_100 - 1, using actual issue and maturity dates and matured bills only.',
      modeledHoldingPeriodReturn: 'v2_cash_level_on_actual_maturity_date / v2_cash_level_on_actual_issue_date - 1.',
      signedError: 'modeled_v2_cash_hpr - official_auction_hpr.',
      percentileMethod: 'R-7 linear interpolation on absolute error in basis points.',
      pooledAnnualization: 'Sum log gross returns across windows and annualize by summed exact holding days. Because auctions occur weekly and overlap, this is a pooled exposure diagnostic, not cumulative wealth.',
      cumulativeComparison: 'Use only exact non-overlapping roll chains whose maturity date equals the next issue date; never multiply all overlapping weekly auctions into one wealth path.',
    },
    counts: {
      officialAuctionRows: source.summary.rowCount,
      multiplePriceRows: source.summary.multiplePriceRows,
      singlePriceRows: source.summary.singlePriceRows,
      maturedByAsOfDate: source.summary.maturedByAsOfDate,
      notMaturedByAsOfDate: source.summary.notMaturedByAsOfDate,
      comparableExactWindows: compared.comparisons.length,
      exactBoundaryMissing: missingBoundary.length,
      holdingDayCountsComparable: termDayCounts,
    },
    fullSample: summarizeComparisons(compared.comparisons),
    subperiods,
    exactRollCumulativeComparison: summarizeExactRollChains(chains),
    exclusions: compared.exclusions.map(({ key, cusip, ...row }) => row),
    windowComparisons: compared.comparisons.map(({ key, cusip, ...row }) => Object.fromEntries(Object.entries(row).map(([field, value]) => [field, typeof value === 'number' ? cleanNumber(value) : value]))),
    limitations: [
      'FiscalData is a current-vintage official auction dataset; this local snapshot preserves what the API returned at retrieval time, but Treasury can correct historical records.',
      'Older auction prices are commonly published to three decimal places; price rounding places a mechanical floor under attainable HPR agreement.',
      'DTB3 is a secondary-market bank-discount yield, whereas the comparator is a newly issued bill purchased at auction and held to par. They need not match exactly.',
      'The v2 series is reconstructed and non-executable; actual Treasury bills are executable, but only the issue-to-maturity HPR is observed here. No daily secondary-market total-return path is validated.',
      'Overlapping weekly auctions are not statistically independent. Pooled window percentiles describe approximation error, not an investable backtest.',
      'This audit does not validate borrowing costs. A positive-cash Treasury return cannot stand in for margin, leverage, haircut, or short-financing rates.',
    ],
  };
}

function writeFrozenResult(value) {
  const bytes = Buffer.from(base.stableJson(value), 'utf8');
  const digest = sha256(bytes);
  if (EXPECTED.result && digest !== EXPECTED.result) throw new IntegrityError('tracked Treasury cash audit result changed', { expectedSha256: EXPECTED.result, actualSha256: digest });
  if (fs.existsSync(PATHS.result)) {
    const current = fs.readFileSync(PATHS.result);
    if (!current.equals(bytes)) throw new IntegrityError(`refusing to replace changed tracked result: ${repoPath(PATHS.result)}`);
  } else {
    fs.writeFileSync(PATHS.result, bytes, { flag: 'wx' });
  }
  const artifact = { absolutePath: path.resolve(PATHS.result), path: repoPath(PATHS.result), bytes: bytes.length, sha256: digest };
  const expectedSidecar = sidecarBytes(artifact);
  if (EXPECTED.resultSidecar && sha256(expectedSidecar) !== EXPECTED.resultSidecar) throw new IntegrityError('tracked Treasury cash audit result sidecar identity changed');
  if (fs.existsSync(PATHS.resultSidecar)) {
    const current = fs.readFileSync(PATHS.resultSidecar);
    if (!current.equals(expectedSidecar)) throw new IntegrityError(`refusing to replace changed tracked sidecar: ${repoPath(PATHS.resultSidecar)}`);
  } else {
    fs.writeFileSync(PATHS.resultSidecar, expectedSidecar, { flag: 'wx' });
  }
  return { artifact, sidecar: readArtifact(PATHS.resultSidecar, EXPECTED.resultSidecar) };
}

function parseArgs(argv) {
  if (!Array.isArray(argv)) throw new IntegrityError('arguments must be an array');
  if (argv.length === 0) return { fetch: false };
  if (argv.length === 1 && argv[0] === '--fetch') return { fetch: true };
  throw new IntegrityError('accepted invocation is either no arguments (audit pinned frozen bytes) or --fetch (one-time immutable source freeze for review)');
}

async function main(argv = process.argv.slice(2)) {
  const options = parseArgs(argv);
  if (options.fetch) {
    const frozen = await fetchAndFreezeSource();
    process.stdout.write(`${JSON.stringify({
      status: 'SOURCE_FROZEN_REVIEW_AND_PIN_HASHES_BEFORE_AUDIT',
      raw: frozen.raw,
      rawSidecar: frozen.rawSidecar,
      receipt: frozen.receipt,
      receiptSidecar: frozen.receiptSidecar,
      payloadSummary: frozen.parsed.summary,
    }, null, 2)}\n`);
    return { frozen };
  }
  const source = loadFrozenSource();
  const cash = loadV2Cash();
  const audit = buildAudit(source, cash);
  const written = writeFrozenResult(audit);
  process.stdout.write(`${JSON.stringify({
    schema: audit.schema,
    status: audit.status,
    resultPath: written.artifact.path,
    resultSha256: written.artifact.sha256,
    source: audit.officialAuctionSource,
    counts: audit.counts,
    fullSample: audit.fullSample,
    primaryExactRollChain: audit.exactRollCumulativeComparison.primaryChain,
  }, null, 2)}\n`);
  return { source, cash, audit, written };
}

module.exports = {
  REPO_ROOT, SCHEMA, RECEIPT_SCHEMA, STATUS, START_AUCTION_DATE, AS_OF_DATE,
  SINGLE_PRICE_START, API_ENDPOINT, API_REQUEST_URL, PATHS, EXPECTED,
  SUBPERIODS, IntegrityError, sha256, repoPath, exactIsoUtc, readArtifact,
  verifySidecar, parseJsonBytes, strictNumber, normalizeAuctionRow,
  normalizeAuctionRows, payloadSummary, parseFiscalDataPayload,
  writeNewArtifact, sidecarBytes, fetchAndFreezeSource, loadFrozenSource,
  loadV2Cash, compareAuctionWindows, mean, quantileR7, pearson, cleanNumber,
  summarizeComparisons, summarizeChain, buildExactRollChains,
  summarizeExactRollChains, buildAudit, writeFrozenResult, parseArgs, main,
};

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${JSON.stringify({
      status: error && error.code === 'INTEGRITY_ERROR' ? 'INTEGRITY_ERROR' : 'ERROR',
      message: error && error.message,
      details: error && error.details || {},
    }, null, 2)}\n`);
    process.exitCode = error && error.code === 'INTEGRITY_ERROR' ? 2 : 1;
  });
}
