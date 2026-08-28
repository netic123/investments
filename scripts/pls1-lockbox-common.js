'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const model = require('../research/fear_greed_control_residual_pls1');

const NATIVE_ARRAY_SORT = Function.prototype.call.bind(Array.prototype.sort);
const NATIVE_CRYPTO_CREATE_HASH = crypto.createHash.bind(crypto);
const NATIVE_NUMBER_IS_FINITE = Number.isFinite;
const NATIVE_OBJECT_FREEZE = Object.freeze;

const ROOT = path.join(__dirname, '..');
const LOCKBOX_ROOT = path.join(ROOT, 'research', 'lockbox', 'control-residual-pls1-v1');
const FREEZE_DIR = path.join(LOCKBOX_ROOT, 'freeze');
const RAW_DIR = path.join(LOCKBOX_ROOT, 'raw', 'sha256');
const DECISIONS_DIR = path.join(LOCKBOX_ROOT, 'decisions');
const ATTEMPTS_DIR = path.join(LOCKBOX_ROOT, 'attempts');
const SEED_PATH = path.join(FREEZE_DIR, 'seed.json');
const MANIFEST_PATH = path.join(FREEZE_DIR, 'manifest.json');
const LOCKBOX_ID = 'control-residual-pls1-v1';
const MARKET_ORDER = NATIVE_OBJECT_FREEZE(['crypto', 'sweden', 'usa', 'ustech', 'europe', 'global']);
const TARGETS = NATIVE_OBJECT_FREEZE({
  crypto: NATIVE_OBJECT_FREEZE({ symbol: 'BITW', name: 'Bitwise 10 Crypto Index ETF', marketClass: 'crypto' }),
  sweden: NATIVE_OBJECT_FREEZE({ symbol: 'EWD', name: 'iShares MSCI Sweden ETF', marketClass: 'equity' }),
  usa: NATIVE_OBJECT_FREEZE({ symbol: 'SPY', name: 'State Street SPDR S&P 500 ETF Trust', marketClass: 'equity' }),
  ustech: NATIVE_OBJECT_FREEZE({ symbol: 'XLK', name: 'State Street Technology Select Sector SPDR ETF', marketClass: 'equity' }),
  europe: NATIVE_OBJECT_FREEZE({ symbol: 'VGK', name: 'Vanguard FTSE Europe ETF', marketClass: 'equity' }),
  global: NATIVE_OBJECT_FREEZE({ symbol: 'ACWI', name: 'iShares MSCI ACWI ETF', marketClass: 'equity' }),
});
const CASH = NATIVE_OBJECT_FREEZE({ symbol: 'BIL', name: 'State Street SPDR Bloomberg 1-3 Month T-Bill ETF' });
const SCHEDULE_EXPRESSIONS = NATIVE_OBJECT_FREEZE([
  '17 6 * * *',
  '17 9 * * *',
  '17 11 * * *',
]);
const GITHUB_REMOTE = NATIVE_OBJECT_FREEZE({
  apiBaseUrl: 'https://api.github.com',
  branch: 'main',
  ref: 'refs/heads/main',
  repository: 'netic123/investments',
  repositoryId: '1343383255',
  serverUrl: 'https://github.com',
  workflowPath: '.github/workflows/pls1-lockbox.yml',
  workflowRef: 'netic123/investments/.github/workflows/pls1-lockbox.yml@refs/heads/main',
});
const WORKFLOW_ACTIONS = NATIVE_OBJECT_FREEZE({
  checkout: NATIVE_OBJECT_FREEZE({
    repository: 'actions/checkout',
    version: 'v7.0.1',
    commitSha: '3d3c42e5aac5ba805825da76410c181273ba90b1',
  }),
  setupNode: NATIVE_OBJECT_FREEZE({
    repository: 'actions/setup-node',
    version: 'v7.0.0',
    commitSha: '820762786026740c76f36085b0efc47a31fe5020',
  }),
  attest: NATIVE_OBJECT_FREEZE({
    repository: 'actions/attest',
    version: 'v4.2.2',
    commitSha: '1e69f48acb82d1966a394da916b4c1698aa569d6',
  }),
});
const REQUIRED_RUNTIME = NATIVE_OBJECT_FREEZE({
  node: '22.19.0',
  v8: '12.4.254.21-node.29',
  icu: '77.1',
  tz: '2025b',
  zlib: '1.3.1-470d3a2',
});
const ATTEMPT_STATUS = NATIVE_OBJECT_FREEZE({
  SKIPPED_PAST_CUTOFF: 'SKIPPED_PAST_CUTOFF',
  SKIPPED_ALREADY_RECORDED_DATE: 'SKIPPED_ALREADY_RECORDED_DATE',
  SUCCESS_NO_NEW_DECISION: 'SUCCESS_NO_NEW_DECISION',
  FAILED_NO_DECISION: 'FAILED_NO_DECISION',
});
const ATTEMPT_REASON = NATIVE_OBJECT_FREEZE({
  PRE_ACQUISITION_CUTOFF: 'PRE_ACQUISITION_CUTOFF',
  LATEST_COMPLETED_SOURCE_SESSION_ALREADY_IN_LEDGER:
    'LATEST_COMPLETED_SOURCE_SESSION_ALREADY_IN_LEDGER',
  NO_NEW_COMPLETED_COMMON_TARGET_SESSION: 'NO_NEW_COMPLETED_COMMON_TARGET_SESSION',
});
const ATTEMPT_FAILURE_STAGE = NATIVE_OBJECT_FREEZE([
  'PREFLIGHT',
  'ACQUISITION',
  'RAW_PERSISTENCE',
  'OFFLINE_REPLAY',
  'POST_ACQUISITION_CUTOFF',
  'ROW_ALIGNMENT',
  'MODEL_COMPUTATION',
  'POST_COMPUTE_CUTOFF',
  'DECISION_PERSISTENCE',
]);
const ACQUISITION_STATE = NATIVE_OBJECT_FREEZE({
  NOT_STARTED: 'NOT_STARTED',
  PARTIAL_UNVERIFIED: 'PARTIAL_UNVERIFIED',
  COMPLETE_REPLAY_VERIFIED: 'COMPLETE_REPLAY_VERIFIED',
});
const MAX_RAW_BYTES = 64 * 1024 * 1024;

function responseBodyLimitError(label, maxBytes, detail) {
  const suffix = detail ? ` (${detail})` : '';
  const error = new Error(`${label} exceeds the ${maxBytes}-byte response-body limit${suffix}`);
  error.code = 'PLS1_RESPONSE_BODY_TOO_LARGE';
  return error;
}

async function cancelUnlockedResponseBody(response, error) {
  const body = response && response.body;
  if (body && typeof body.cancel === 'function') {
    try { await body.cancel(error); } catch {}
  }
}

async function readResponseBodyLimited(response, maxBytes = MAX_RAW_BYTES,
  label = 'HTTP response') {
  if (!response || !Number.isSafeInteger(maxBytes) || maxBytes < 0
      || typeof label !== 'string' || !label) {
    throw new TypeError('bounded response-body read requires a response, a non-negative safe byte limit, and a label');
  }
  const contentLengthHeader = response.headers && typeof response.headers.get === 'function'
    ? response.headers.get('content-length') : null;
  let declaredContentLength = null;
  if (contentLengthHeader !== null) {
    const normalized = String(contentLengthHeader).trim();
    if (!/^(0|[1-9]\d*)$/.test(normalized)) {
      const error = new Error(`${label} has an invalid Content-Length header`);
      await cancelUnlockedResponseBody(response, error);
      throw error;
    }
    const contentLength = Number(normalized);
    if (!Number.isSafeInteger(contentLength)) {
      const error = new Error(`${label} has an unsafe Content-Length header`);
      await cancelUnlockedResponseBody(response, error);
      throw error;
    }
    declaredContentLength = contentLength;
    if (contentLength > maxBytes) {
      const error = responseBodyLimitError(label, maxBytes, `Content-Length ${contentLength}`);
      await cancelUnlockedResponseBody(response, error);
      throw error;
    }
  }

  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    if (contentLengthHeader === '0') return Buffer.alloc(0);
    throw new Error(`${label} has no readable streaming body`);
  }
  const reader = body.getReader();
  let storage = Buffer.alloc(0);
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!ArrayBuffer.isView(value)) {
        throw new Error(`${label} yielded a non-byte response-body chunk`);
      }
      const chunkBytes = value.byteLength;
      if (chunkBytes > maxBytes - totalBytes) {
        const error = responseBodyLimitError(label, maxBytes,
          `received at least ${totalBytes + chunkBytes} bytes`);
        throw error;
      }
      if (!chunkBytes) continue;
      const requiredBytes = totalBytes + chunkBytes;
      if (storage.length < requiredBytes) {
        let capacity = storage.length || Math.min(maxBytes, 64 * 1024);
        while (capacity < requiredBytes) {
          capacity = Math.min(maxBytes, Math.max(requiredBytes, capacity * 2));
        }
        const expanded = Buffer.allocUnsafe(capacity);
        if (totalBytes) storage.copy(expanded, 0, 0, totalBytes);
        storage = expanded;
      }
      const chunk = Buffer.from(value.buffer, value.byteOffset, chunkBytes);
      chunk.copy(storage, totalBytes);
      totalBytes = requiredBytes;
    }
  } catch (error) {
    try { await reader.cancel(error); } catch {}
    throw error;
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  if (declaredContentLength !== null && totalBytes !== declaredContentLength) {
    throw new Error(`${label} Content-Length mismatch: declared ${declaredContentLength}, received ${totalBytes}`);
  }
  return totalBytes === 0 ? Buffer.alloc(0) : storage.subarray(0, totalBytes);
}

function sha256(bytes) {
  return NATIVE_CRYPTO_CREATE_HASH('sha256').update(bytes).digest('hex');
}

function isExactDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return NATIVE_NUMBER_IS_FINITE(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function normalizedAbsolutePath(value) {
  let resolved = path.resolve(String(value));
  while (resolved.length > path.parse(resolved).root.length
      && (resolved.endsWith(path.sep) || resolved.endsWith(path.posix.sep))) {
    resolved = resolved.slice(0, -1);
  }
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function filesystemCanonicalPath(value) {
  const absolute = path.resolve(String(value));
  const unresolved = [];
  let existing = absolute;
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) break;
    unresolved.unshift(path.basename(existing));
    existing = parent;
  }
  const real = fs.existsSync(existing)
    ? (fs.realpathSync.native ? fs.realpathSync.native(existing) : fs.realpathSync(existing))
    : existing;
  return normalizedAbsolutePath(path.join(real, ...unresolved));
}

function isProductionLockboxRoot(value) {
  return filesystemCanonicalPath(value) === filesystemCanonicalPath(LOCKBOX_ROOT);
}

function isPathWithin(root, value) {
  const parent = filesystemCanonicalPath(root);
  const child = filesystemCanonicalPath(value);
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

function canonicalBytes(value) {
  return Buffer.from(model.canonicalStringify(value));
}

function sidecarBytes(fileName, digest) {
  return Buffer.from(`${digest}  ${fileName}\n`);
}

function fsyncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    if (process.platform !== 'win32') throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function atomicCreate(file, bytes) {
  const payload = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const directory = path.dirname(file);
  fs.mkdirSync(directory, { recursive: true });
  if (fs.existsSync(file)) {
    const existing = fs.readFileSync(file);
    if (!existing.equals(payload)) throw new Error(`append-only collision at ${file}`);
    return { created: false, sha256: sha256(existing) };
  }
  const temporary = path.join(directory,
    `.${path.basename(file)}.${process.pid}.${crypto.randomBytes(8).toString('hex')}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(temporary, 'wx');
    fs.writeFileSync(descriptor, payload);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const reread = fs.readFileSync(temporary);
    if (!reread.equals(payload)) throw new Error(`temporary reread mismatch for ${file}`);
    try {
      fs.linkSync(temporary, file);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const existing = fs.readFileSync(file);
      if (!existing.equals(payload)) throw new Error(`append-only collision at ${file}`);
      fs.unlinkSync(temporary);
      return { created: false, sha256: sha256(existing) };
    }
    fsyncDirectory(directory);
    fs.unlinkSync(temporary);
    return { created: true, sha256: sha256(payload) };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function createCanonicalWithSidecar(file, value) {
  const bytes = canonicalBytes(value);
  const digest = sha256(bytes);
  const body = atomicCreate(file, bytes);
  const sidecar = atomicCreate(`${file}.sha256`, sidecarBytes(path.basename(file), digest));
  return { file, sha256: digest, created: body.created || sidecar.created };
}

function verifySidecarBytes(file, bytes) {
  if (!Buffer.isBuffer(bytes)) throw new Error(`${file}: sidecar verification requires exact bytes`);
  const digest = sha256(bytes);
  const expected = sidecarBytes(path.basename(file), digest);
  const actual = fs.readFileSync(`${file}.sha256`);
  if (!actual.equals(expected)) throw new Error(`${file}: exact sidecar mismatch`);
  return digest;
}

function verifySidecar(file) {
  return verifySidecarBytes(file, fs.readFileSync(file));
}

function verifyCanonicalJson(file) {
  // Read evidence bytes once so the hash and parsed value cannot come from
  // different file versions if a local alias changes the path concurrently.
  const bytes = fs.readFileSync(file);
  const digest = verifySidecarBytes(file, bytes);
  const value = JSON.parse(bytes.toString('utf8'));
  if (!bytes.equals(canonicalBytes(value))) throw new Error(`${file}: JSON bytes are not exact canonical bytes`);
  return { digest, value };
}

function rawPath(root, rawSha256) {
  return path.join(root, 'raw', 'sha256', rawSha256.slice(0, 2), `${rawSha256}.json.gz`);
}

function deterministicGzip(bytes) {
  const compressed = zlib.gzipSync(bytes, { level: 9, mtime: 0 });
  compressed[9] = 255;
  return compressed;
}

function createRawBlob(root, bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_RAW_BYTES) {
    throw new Error(`raw response body must contain 0..${MAX_RAW_BYTES} bytes`);
  }
  const rawSha256 = sha256(bytes);
  const compressed = deterministicGzip(bytes);
  // RFC 1952's OS byte is metadata, not evidence. Pin it to UNKNOWN so the
  // same raw response has identical stored bytes on Windows and Linux.
  const file = rawPath(root, rawSha256);
  const result = atomicCreate(file, compressed);
  return {
    path: path.relative(root, file).replace(/\\/g, '/'),
    rawSha256,
    rawBytes: bytes.length,
    gzipSha256: sha256(compressed),
    gzipBytes: compressed.length,
    created: result.created,
  };
}

function verifyRawBlob(root, receipt) {
  if (!receipt || typeof receipt.path !== 'string'
      || !/^[a-f0-9]{64}$/.test(String(receipt.rawSha256))
      || !Number.isInteger(receipt.rawBytes) || receipt.rawBytes < 0 || receipt.rawBytes > MAX_RAW_BYTES
      || !/^[a-f0-9]{64}$/.test(String(receipt.gzipSha256))
      || !Number.isInteger(receipt.gzipBytes) || receipt.gzipBytes < 1) {
    throw new Error('raw receipt has no archived response-body bytes');
  }
  const file = rawPath(root, receipt.rawSha256);
  const expectedPath = path.relative(root, file).replace(/\\/g, '/');
  if (receipt.path !== expectedPath || !isPathWithin(root, file)) {
    throw new Error(`${receipt.path}: raw receipt path is not its content-addressed lockbox path`);
  }
  const compressed = fs.readFileSync(file);
  if (sha256(compressed) !== receipt.gzipSha256 || compressed.length !== receipt.gzipBytes) {
    throw new Error(`${receipt.path}: compressed raw receipt mismatch`);
  }
  const raw = zlib.gunzipSync(compressed, { maxOutputLength: Math.max(1, receipt.rawBytes) });
  if (sha256(raw) !== receipt.rawSha256 || raw.length !== receipt.rawBytes) {
    throw new Error(`${receipt.path}: raw receipt mismatch`);
  }
  if (!compressed.equals(deterministicGzip(raw))) {
    throw new Error(`${receipt.path}: gzip bytes are not the frozen deterministic encoding`);
  }
  return raw;
}

function runtimeIdentity() {
  return NATIVE_OBJECT_FREEZE({
    node: process.versions.node,
    v8: process.versions.v8,
    icu: process.versions.icu,
    tz: process.versions.tz,
    zlib: process.versions.zlib,
    platform: process.platform,
    arch: process.arch,
  });
}

function assertRequiredRuntime({ production = false } = {}) {
  const actual = runtimeIdentity();
  for (const [key, expected] of Object.entries(REQUIRED_RUNTIME)) {
    if (actual[key] !== expected) {
      throw new Error(`runtime ${key} mismatch: expected ${expected}, received ${actual[key]}`);
    }
  }
  if (production && (actual.platform !== 'linux' || actual.arch !== 'x64')) {
    throw new Error(`production runtime must be linux/x64, received ${actual.platform}/${actual.arch}`);
  }
  return actual;
}

function decisionPath(root, decisionDate) {
  assertDate(decisionDate);
  return path.join(root, 'decisions', decisionDate.slice(0, 4), decisionDate.slice(5, 7),
    decisionDate.slice(8, 10), 'r000', 'decision.json');
}

function attemptPath(root, collectedAtUtc, runIdentity = 'local') {
  const slotDate = collectedAtUtc.slice(0, 10);
  const compact = collectedAtUtc.replace(/[-:.]/g, '');
  const safeRun = String(runIdentity).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  return path.join(root, 'attempts', slotDate.slice(0, 4), slotDate.slice(5, 7),
    slotDate.slice(8, 10), `${compact}-${safeRun}.json`);
}

function assertDate(value) {
  if (!isExactDate(value)) throw new Error(`invalid date ${value}`);
}

function listDecisionFiles(root = LOCKBOX_ROOT) {
  const base = path.join(root, 'decisions');
  if (!fs.existsSync(base)) return [];
  const found = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'decision.json') found.push(full);
    }
  }
  walk(base);
  return NATIVE_ARRAY_SORT(found);
}

function listAttemptFiles(root = LOCKBOX_ROOT) {
  const base = path.join(root, 'attempts');
  if (!fs.existsSync(base)) return [];
  const found = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith('.json') && !entry.name.endsWith('.sha256')) found.push(full);
    }
  }
  walk(base);
  return NATIVE_ARRAY_SORT(found);
}

module.exports = NATIVE_OBJECT_FREEZE({
  ROOT,
  LOCKBOX_ROOT,
  FREEZE_DIR,
  RAW_DIR,
  DECISIONS_DIR,
  ATTEMPTS_DIR,
  SEED_PATH,
  MANIFEST_PATH,
  LOCKBOX_ID,
  MARKET_ORDER,
  TARGETS,
  CASH,
  SCHEDULE_EXPRESSIONS,
  GITHUB_REMOTE,
  WORKFLOW_ACTIONS,
  REQUIRED_RUNTIME,
  ATTEMPT_STATUS,
  ATTEMPT_REASON,
  ATTEMPT_FAILURE_STAGE,
  ACQUISITION_STATE,
  MAX_RAW_BYTES,
  readResponseBodyLimited,
  sha256,
  isExactDate,
  normalizedAbsolutePath,
  filesystemCanonicalPath,
  isProductionLockboxRoot,
  isPathWithin,
  canonicalBytes,
  sidecarBytes,
  atomicCreate,
  createCanonicalWithSidecar,
  verifySidecar,
  verifyCanonicalJson,
  rawPath,
  deterministicGzip,
  createRawBlob,
  verifyRawBlob,
  runtimeIdentity,
  assertRequiredRuntime,
  decisionPath,
  attemptPath,
  listDecisionFiles,
  listAttemptFiles,
});
