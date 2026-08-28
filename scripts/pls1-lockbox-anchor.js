'use strict';

// This module intentionally does not create attestations or fetch trust material.
// It verifies one already-created, locally archived GitHub/Sigstore attestation
// with one exact, SHA-pinned GitHub CLI binary and one externally pinned trusted
// root snapshot. The separate long-horizon gate below remains blocked until the
// repository freezes an auditable TUF root/metadata-update archival protocol.

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');
const { TextDecoder } = require('node:util');

// Security-critical primitives are captured once. The verifier still requires a
// clean, pinned Node process with no preload/injected code; later ambient
// monkey-patching must not be able to change signature or strict-JSON results.
const NATIVE_ARRAY_IS_ARRAY = Array.isArray;
const NATIVE_ARRAY_BUFFER_IS_VIEW = ArrayBuffer.isView;
const NATIVE_BUFFER_FROM_FUNCTION = Buffer.from;
const NATIVE_BUFFER_BYTE_LENGTH_FUNCTION = Buffer.byteLength;
const NATIVE_BUFFER_FROM = NATIVE_BUFFER_FROM_FUNCTION.bind(Buffer);
const NATIVE_BUFFER_BYTE_LENGTH = NATIVE_BUFFER_BYTE_LENGTH_FUNCTION.bind(Buffer);
const NATIVE_BUFFER_EQUALS = Buffer.prototype.equals;
const NATIVE_BUFFER_TO_STRING = Buffer.prototype.toString;
const NATIVE_OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const NATIVE_OBJECT_PROTOTYPE = Object.prototype;
const NATIVE_OBJECT_KEYS = Object.keys;
const NATIVE_OBJECT_IS = Object.is;
const NATIVE_OBJECT_VALUES = Object.values;
const NATIVE_OBJECT_FREEZE = Object.freeze;
const NATIVE_OBJECT_IS_FROZEN = Object.isFrozen;
const NATIVE_OBJECT_HAS_OWN = Object.hasOwn;
const NATIVE_OBJECT_ENTRIES = Object.entries;
const NATIVE_OBJECT_FROM_ENTRIES = Object.fromEntries;
const NATIVE_OBJECT_CREATE = Object.create;
const NATIVE_OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const NATIVE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const NATIVE_OBJECT_GET_OWN_PROPERTY_SYMBOLS = Object.getOwnPropertySymbols;
const NATIVE_JSON_PARSE_FUNCTION = JSON.parse;
const NATIVE_JSON_STRINGIFY_FUNCTION = JSON.stringify;
const NATIVE_JSON_PARSE = NATIVE_JSON_PARSE_FUNCTION.bind(JSON);
const NATIVE_JSON_STRINGIFY = NATIVE_JSON_STRINGIFY_FUNCTION.bind(JSON);
const NATIVE_DATE_PARSE = Date.parse;
const NATIVE_DATE_TO_ISO_STRING = Date.prototype.toISOString;
const NATIVE_NUMBER_IS_FINITE = Number.isFinite;
const NATIVE_NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger;
const NATIVE_MATH_FLOOR = Math.floor;
const NATIVE_ARRAY_SORT = Array.prototype.sort;
const NATIVE_ARRAY_MAP = Array.prototype.map;
const NATIVE_ARRAY_FILTER = Array.prototype.filter;
const NATIVE_ARRAY_EVERY = Array.prototype.every;
const NATIVE_ARRAY_INCLUDES = Array.prototype.includes;
const NATIVE_ARRAY_PUSH = Array.prototype.push;
const NATIVE_ARRAY_ITERATOR = Array.prototype[Symbol.iterator];
const NATIVE_ARRAY_TO_JSON_DESCRIPTOR = Object.getOwnPropertyDescriptor(Array.prototype, 'toJSON');
const NATIVE_OBJECT_TO_JSON_DESCRIPTOR = Object.getOwnPropertyDescriptor(Object.prototype, 'toJSON');
const NATIVE_STRING_INCLUDES = String.prototype.includes;
const NATIVE_STRING_STARTS_WITH = String.prototype.startsWith;
const NATIVE_STRING_ENDS_WITH = String.prototype.endsWith;
const NATIVE_STRING_SPLIT = String.prototype.split;
const NATIVE_STRING_SLICE = String.prototype.slice;
const NATIVE_STRING_REPLACE = String.prototype.replace;
const NATIVE_STRING_CHAR_CODE_AT = String.prototype.charCodeAt;
const NATIVE_STRING_CODE_POINT_AT = String.prototype.codePointAt;
const NATIVE_REGEXP_TEST = RegExp.prototype.test;
const NATIVE_REGEXP_EXEC = RegExp.prototype.exec;
const NATIVE_SET = Set;
const NATIVE_MAP = Map;
const NATIVE_SET_ADD = Set.prototype.add;
const NATIVE_SET_HAS = Set.prototype.has;
const NATIVE_MAP_GET = Map.prototype.get;
const NATIVE_MAP_HAS = Map.prototype.has;
const NATIVE_MAP_SET = Map.prototype.set;
const NATIVE_DATE = Date;
const NATIVE_NUMBER = Number;
const NATIVE_BUFFER = Buffer;
const NATIVE_FS_READ_FILE_SYNC = fs.readFileSync;
const NATIVE_FS_LSTAT_SYNC = fs.lstatSync;
const NATIVE_FS_REALPATH_SYNC = fs.realpathSync;
const NATIVE_PATH_RELATIVE = path.relative;
const NATIVE_PATH_RESOLVE = path.resolve;
const NATIVE_PATH_IS_ABSOLUTE = path.isAbsolute;
const NATIVE_PATH_BASENAME = path.basename;
const NATIVE_PATH_SEP = path.sep;
const NATIVE_CHILD_SPAWN_SYNC = childProcess.spawnSync;
const NATIVE_TEXT_DECODE = TextDecoder.prototype.decode;
const NATIVE_CRYPTO_CREATE_HASH_FUNCTION = crypto.createHash;
const NATIVE_CRYPTO_VERIFY_FUNCTION = crypto.verify;
const NATIVE_CRYPTO_CREATE_PUBLIC_KEY_FUNCTION = crypto.createPublicKey;
const NATIVE_CRYPTO_CREATE_HASH = NATIVE_CRYPTO_CREATE_HASH_FUNCTION.bind(crypto);
const NATIVE_CRYPTO_VERIFY = NATIVE_CRYPTO_VERIFY_FUNCTION.bind(crypto);
const NATIVE_CRYPTO_CREATE_PUBLIC_KEY = NATIVE_CRYPTO_CREATE_PUBLIC_KEY_FUNCTION.bind(crypto);
const HASH_PROTOTYPE = NATIVE_OBJECT_GET_PROTOTYPE_OF(NATIVE_CRYPTO_CREATE_HASH('sha256'));
const NATIVE_HASH_UPDATE = HASH_PROTOTYPE.update;
const NATIVE_HASH_DIGEST = HASH_PROTOTYPE.digest;
const PUBLIC_KEY_OBJECT_PROTOTYPE = NATIVE_OBJECT_GET_PROTOTYPE_OF(NATIVE_CRYPTO_CREATE_PUBLIC_KEY({
  key: NATIVE_BUFFER_FROM(`302a300506032b6570032100${'00'.repeat(32)}`, 'hex'),
  type: 'spki',
  format: 'der',
}));
const NATIVE_KEY_OBJECT_EXPORT = PUBLIC_KEY_OBJECT_PROTOTYPE.export;
const UTF8_FATAL_DECODER = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const ANCHOR_SCHEMA = 'fg-control-residual-pls1-decision-anchor-v1';
const ANCHOR_STATUS = 'SINGLE_EVENT_CRYPTOGRAPHIC_ANCHOR_VERIFIED';
const DECISION_SCHEMA = 'fg-control-residual-pls1-six-market-decision-bundle-v1';
const DECISION_STATUS = 'PROSPECTIVE_CANDIDATE_NOT_YET_TRUSTED';
const BUNDLE_MEDIA_TYPE = 'application/vnd.dev.sigstore.bundle.v0.3+json';
const VERIFICATION_MEDIA_TYPE = 'application/vnd.dev.sigstore.verificationresult+json;version=0.1';
const IN_TOTO_STATEMENT_TYPE = 'https://in-toto.io/Statement/v1';
const SLSA_PREDICATE_TYPE = 'https://slsa.dev/provenance/v1';
const GITHUB_BUILD_TYPE = 'https://actions.github.io/buildtypes/workflow/v1';
const OIDC_ISSUER = 'https://token.actions.githubusercontent.com';
const REKOR_URI = 'https://rekor.sigstore.dev';
const ATTEST_ACTION = Object.freeze({
  repository: 'actions/attest',
  version: 'v4.2.2',
  commitSha: '1e69f48acb82d1966a394da916b4c1698aa569d6',
});
const PINNED_GH_VERIFIER = Object.freeze({
  name: 'gh',
  version: '2.98.0',
  platform: 'linux',
  arch: 'x64',
  releaseCommitSha: 'a255baf71d13fe5947a4eb7ad521ffd412d64cee',
  distributionArchive: 'gh_2.98.0_linux_amd64.tar.gz',
  distributionArchiveSha256: '3b8ac6b30336802fc1a858d7c084e11cdf24ac1a761ca90b68022d7d729208de',
  executableBytes: 41377954,
  executableSha256: '62885b97de6a0cd85e616cdd94bcda908bf5cf1018094385892b05cea3537163',
  minimumSecurityVersion: '2.97.0',
});
const LONG_HORIZON_TRUST_POLICY = Object.freeze({
  status: 'BLOCKED_STATIC_TRUSTED_ROOT_CANNOT_COVER_PROSPECTIVE_HORIZON',
  endpointEligible: false,
  reason: 'A single frozen trusted_root.jsonl snapshot cannot authorize future Fulcio/Rekor key rotations.',
  requiredResolution: 'Freeze a TUF bootstrap root and archive and offline-verify every signed root, timestamp, snapshot, targets metadata, and selected trusted-root target update before accepting rotated keys.',
});
const TRUSTED_ROOT_RELATIVE_PATH = 'freeze/sigstore-public-good-trusted-root.jsonl';
const MAX_DECISION_BYTES = 16 * 1024 * 1024;
const MAX_BUNDLE_BYTES = 4 * 1024 * 1024;
const MAX_TRUSTED_ROOT_BYTES = 4 * 1024 * 1024;
const MAX_VERIFIER_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_TUF_METADATA_BYTES = 1024 * 1024;
const MAX_TUF_SELECTION_RECEIPT_BYTES = 512 * 1024;
const MAX_TUF_ROOT_ROTATIONS = 64;
const MAX_TUF_SIGNATURES = 64;
const MAX_TUF_KEYS = 128;
const MAX_TUF_TARGETS = 512;
const TUF_REPLAY_POLICY_SCHEMA = 'fg-control-residual-pls1-tuf-replay-policy-v1';
const TUF_SELECTION_RECEIPT_SCHEMA = 'fg-control-residual-pls1-tuf-selection-receipt-v1';
const TUF_SELECTION_RECEIPT_STATUS = 'TUF_SELECTION_INPUT_NOT_A_TRUST_VERDICT';
const TUF_OFFLINE_REPLAY_STATUS = 'SINGLE_DECISION_TUF_DUAL_REPLAY_VERIFIED_ENDPOINT_BLOCKED';
const TUF_TRUST_BINDING_SCHEMA = 'fg-control-residual-pls1-tuf-selection-binding-v1';
const TUF_TRUSTED_ROOT_TARGET_NAME = 'trusted_root.json';
const TUF_SPEC_VERSION = '1.0';
const SIGSTORE_TUF_BOOTSTRAP = Object.freeze({
  version: 10,
  relativePath: 'freeze/tuf/bootstrap/10.root.json',
  bytes: 6911,
  sha256: '836bff947925edfc23eb9ce17af66fb1e43bb5e2bdd240520985ae52b585eae9',
  sourceRepository: 'sigstore/root-signing',
  sourceCommitSha: 'c6f23ff62645fb0c46ebc7945675835b52f91aa8',
  sourceBlobSha1: '3f18ee74ca6415a3a8dbdc30be69fc1b1703c02f',
});
const TUF_ENDPOINT_POLICY = Object.freeze({
  status: 'BLOCKED_COMPLETE_PER_DECISION_TUF_COVERAGE_NOT_ESTABLISHED',
  endpointEligible: false,
  reason: 'A verified receipt for one decision cannot establish complete prospective per-decision coverage.',
  requiredResolution: 'Verify every decision receipt, remote run, current-policy replay, and immutable append-only timestamp chain across the complete prospective horizon.',
});

function fail(message) {
  throw new Error(`PLS1 anchor: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function assertCleanPinnedNodeIntrinsics() {
  const clean = Array.isArray === NATIVE_ARRAY_IS_ARRAY
    && ArrayBuffer.isView === NATIVE_ARRAY_BUFFER_IS_VIEW
    && Buffer === NATIVE_BUFFER && Buffer.from === NATIVE_BUFFER_FROM_FUNCTION
    && Buffer.byteLength === NATIVE_BUFFER_BYTE_LENGTH_FUNCTION
    && Buffer.prototype.equals === NATIVE_BUFFER_EQUALS
    && Buffer.prototype.toString === NATIVE_BUFFER_TO_STRING
    && Object.getPrototypeOf === NATIVE_OBJECT_GET_PROTOTYPE_OF
    && Object.keys === NATIVE_OBJECT_KEYS && Object.is === NATIVE_OBJECT_IS
    && Object.values === NATIVE_OBJECT_VALUES && Object.freeze === NATIVE_OBJECT_FREEZE
    && Object.isFrozen === NATIVE_OBJECT_IS_FROZEN && Object.hasOwn === NATIVE_OBJECT_HAS_OWN
    && Object.entries === NATIVE_OBJECT_ENTRIES && Object.fromEntries === NATIVE_OBJECT_FROM_ENTRIES
    && Object.create === NATIVE_OBJECT_CREATE && Object.defineProperty === NATIVE_OBJECT_DEFINE_PROPERTY
    && Object.getOwnPropertyDescriptor === NATIVE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR
    && Object.getOwnPropertySymbols === NATIVE_OBJECT_GET_OWN_PROPERTY_SYMBOLS
    && JSON.parse === NATIVE_JSON_PARSE_FUNCTION && JSON.stringify === NATIVE_JSON_STRINGIFY_FUNCTION
    && Date === NATIVE_DATE && Date.parse === NATIVE_DATE_PARSE
    && Date.prototype.toISOString === NATIVE_DATE_TO_ISO_STRING
    && Number === NATIVE_NUMBER && Number.isFinite === NATIVE_NUMBER_IS_FINITE
    && Number.isSafeInteger === NATIVE_NUMBER_IS_SAFE_INTEGER && Math.floor === NATIVE_MATH_FLOOR
    && Array.prototype.sort === NATIVE_ARRAY_SORT && Array.prototype.map === NATIVE_ARRAY_MAP
    && Array.prototype.filter === NATIVE_ARRAY_FILTER && Array.prototype.every === NATIVE_ARRAY_EVERY
    && Array.prototype.includes === NATIVE_ARRAY_INCLUDES && Array.prototype.push === NATIVE_ARRAY_PUSH
    && Array.prototype[Symbol.iterator] === NATIVE_ARRAY_ITERATOR
    && NATIVE_OBJECT_IS(NATIVE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(Array.prototype, 'toJSON'),
      NATIVE_ARRAY_TO_JSON_DESCRIPTOR)
    && NATIVE_OBJECT_IS(NATIVE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(Object.prototype, 'toJSON'),
      NATIVE_OBJECT_TO_JSON_DESCRIPTOR)
    && String.prototype.includes === NATIVE_STRING_INCLUDES
    && String.prototype.startsWith === NATIVE_STRING_STARTS_WITH
    && String.prototype.endsWith === NATIVE_STRING_ENDS_WITH
    && String.prototype.split === NATIVE_STRING_SPLIT
    && String.prototype.slice === NATIVE_STRING_SLICE
    && String.prototype.replace === NATIVE_STRING_REPLACE
    && String.prototype.charCodeAt === NATIVE_STRING_CHAR_CODE_AT
    && String.prototype.codePointAt === NATIVE_STRING_CODE_POINT_AT
    && RegExp.prototype.test === NATIVE_REGEXP_TEST && RegExp.prototype.exec === NATIVE_REGEXP_EXEC
    && Set === NATIVE_SET && Set.prototype.add === NATIVE_SET_ADD && Set.prototype.has === NATIVE_SET_HAS
    && Map === NATIVE_MAP && Map.prototype.get === NATIVE_MAP_GET
    && Map.prototype.has === NATIVE_MAP_HAS && Map.prototype.set === NATIVE_MAP_SET
    && fs.readFileSync === NATIVE_FS_READ_FILE_SYNC && fs.lstatSync === NATIVE_FS_LSTAT_SYNC
    && fs.realpathSync === NATIVE_FS_REALPATH_SYNC && path.relative === NATIVE_PATH_RELATIVE
    && path.resolve === NATIVE_PATH_RESOLVE && path.isAbsolute === NATIVE_PATH_IS_ABSOLUTE
    && path.basename === NATIVE_PATH_BASENAME && path.sep === NATIVE_PATH_SEP
    && childProcess.spawnSync === NATIVE_CHILD_SPAWN_SYNC
    && TextDecoder.prototype.decode === NATIVE_TEXT_DECODE
    && crypto.createHash === NATIVE_CRYPTO_CREATE_HASH_FUNCTION
    && crypto.verify === NATIVE_CRYPTO_VERIFY_FUNCTION
    && crypto.createPublicKey === NATIVE_CRYPTO_CREATE_PUBLIC_KEY_FUNCTION
    && PUBLIC_KEY_OBJECT_PROTOTYPE.export === NATIVE_KEY_OBJECT_EXPORT
    && HASH_PROTOTYPE.update === NATIVE_HASH_UPDATE && HASH_PROTOTYPE.digest === NATIVE_HASH_DIGEST;
  assert(clean,
    'clean pinned Node process required: a security-critical intrinsic was mutated after module load');
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || NATIVE_ARRAY_IS_ARRAY(value)) return false;
  const prototype = NATIVE_OBJECT_GET_PROTOTYPE_OF(value);
  return prototype === NATIVE_OBJECT_PROTOTYPE || prototype === null;
}

function assertExactKeys(value, expected, context) {
  assert(isPlainObject(value), `${context} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  assert(JSON.stringify(actual) === JSON.stringify(wanted),
    `${context} keys differ: expected ${wanted.join(',')}; received ${actual.join(',')}`);
}

function canonicalize(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    assert(NATIVE_NUMBER_IS_FINITE(value), 'canonical JSON rejects non-finite numbers');
    return NATIVE_OBJECT_IS(value, -0) ? 0 : value;
  }
  if (NATIVE_ARRAY_IS_ARRAY(value)) {
    assert(NATIVE_OBJECT_GET_OWN_PROPERTY_SYMBOLS(value).length === 0,
      'canonical JSON rejects symbol-bearing arrays');
    const keys = NATIVE_OBJECT_KEYS(value);
    assert(keys.length === value.length,
      'canonical JSON rejects sparse arrays or arrays with extra properties');
    const result = [];
    for (let index = 0; index < value.length; index += 1) {
      assert(keys[index] === String(index), 'canonical JSON rejects sparse or unordered array keys');
      const descriptor = NATIVE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, String(index));
      assert(descriptor && NATIVE_OBJECT_HAS_OWN(descriptor, 'value'),
        'canonical JSON accepts only array data properties');
      assert(descriptor.value !== undefined, 'canonical JSON rejects undefined array values');
      NATIVE_OBJECT_DEFINE_PROPERTY(result, index, { value: canonicalize(descriptor.value),
        enumerable: true, writable: true, configurable: true });
    }
    return result;
  }
  if (isPlainObject(value)) {
    assert(NATIVE_OBJECT_GET_OWN_PROPERTY_SYMBOLS(value).length === 0,
      'canonical JSON rejects symbol-bearing objects');
    const result = NATIVE_OBJECT_CREATE(null);
    const keys = NATIVE_OBJECT_KEYS(value);
    NATIVE_ARRAY_SORT.call(keys);
    for (const key of keys) {
      assert(!NATIVE_ARRAY_INCLUDES.call(['__proto__', 'constructor', 'prototype'], key),
        `canonical JSON rejects unsafe object key ${key}`);
      const descriptor = NATIVE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
      assert(descriptor && NATIVE_OBJECT_HAS_OWN(descriptor, 'value'),
        `canonical JSON accepts only data property ${key}`);
      assert(descriptor.value !== undefined, `canonical JSON rejects undefined at ${key}`);
      NATIVE_OBJECT_DEFINE_PROPERTY(result, key, { value: canonicalize(descriptor.value),
        enumerable: true, writable: true, configurable: true });
    }
    return result;
  }
  fail(`canonical JSON rejects ${typeof value}`);
}

function canonicalBytes(value) {
  assertCleanPinnedNodeIntrinsics();
  return NATIVE_BUFFER_FROM(`${NATIVE_JSON_STRINGIFY(canonicalize(value))}\n`);
}

function sha256(bytes) {
  assertCleanPinnedNodeIntrinsics();
  const hash = NATIVE_CRYPTO_CREATE_HASH('sha256');
  NATIVE_HASH_UPDATE.call(hash, bytes);
  return NATIVE_HASH_DIGEST.call(hash, 'hex');
}

function hashCanonical(value) {
  return sha256(canonicalBytes(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || NATIVE_OBJECT_IS_FROZEN(value)) return value;
  // Node.js intentionally rejects Object.freeze() for non-empty Buffers and
  // typed-array views. Their hashes, not JavaScript object immutability, bind
  // their evidence bytes; callers never receive a trust verdict from a Buffer.
  if (NATIVE_ARRAY_BUFFER_IS_VIEW(value)) return value;
  for (const child of NATIVE_OBJECT_VALUES(value)) deepFreeze(child);
  return NATIVE_OBJECT_FREEZE(value);
}

function exactDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = NATIVE_DATE_PARSE(`${value}T00:00:00.000Z`);
  return NATIVE_NUMBER_IS_FINITE(parsed)
    && NATIVE_STRING_SLICE.call(NATIVE_DATE_TO_ISO_STRING.call(new NATIVE_DATE(parsed)), 0, 10)
      === value;
}

function exactUtc(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && NATIVE_NUMBER_IS_FINITE(NATIVE_DATE_PARSE(value))
    && NATIVE_DATE_TO_ISO_STRING.call(new NATIVE_DATE(value)) === value;
}

function exactSha(value, length = 64) {
  return typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
}

function exactPositiveIntegerString(value) {
  return typeof value === 'string' && /^[1-9]\d*$/.test(value)
    && NATIVE_NUMBER_IS_SAFE_INTEGER(NATIVE_NUMBER(value));
}

function exactBase64(value, context) {
  assertCleanPinnedNodeIntrinsics();
  assert(typeof value === 'string' && value.length > 0 && value.length % 4 === 0
    && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value),
  `${context} is not canonical base64`);
  const bytes = NATIVE_BUFFER_FROM(value, 'base64');
  assert(NATIVE_BUFFER_TO_STRING.call(bytes, 'base64') === value,
    `${context} has a noncanonical base64 encoding`);
  return bytes;
}

function dateParts(date) {
  assert(exactDate(date), `invalid decision date ${date}`);
  return [date.slice(0, 4), date.slice(5, 7), date.slice(8, 10)];
}

function decisionRelativePath(date) {
  return ['decisions', ...dateParts(date), 'r000', 'decision.json'].join('/');
}

function anchorRelativePath(date) {
  return ['anchors', ...dateParts(date), 'r000', 'anchor.json'].join('/');
}

function bundleRelativePath(date) {
  return ['anchors', ...dateParts(date), 'r000', 'decision.sigstore.json'].join('/');
}

function exactRelativePath(value, expected, context) {
  assert(typeof value === 'string' && value === expected
    && !value.includes('\\') && !value.startsWith('/')
    && !value.split('/').some(part => part === '' || part === '.' || part === '..'),
  `${context} is not the exact frozen relative path`);
}

function pathWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..'
    && !path.isAbsolute(relative));
}

function resolveEvidencePath(lockboxRoot, relative, context) {
  assert(path.isAbsolute(lockboxRoot), 'lockboxRoot must be absolute');
  const rootReal = fs.realpathSync(lockboxRoot);
  const candidate = path.resolve(rootReal, ...relative.split('/'));
  assert(pathWithin(rootReal, candidate), `${context} escapes the lockbox root`);
  const stat = fs.lstatSync(candidate);
  assert(stat.isFile() && !stat.isSymbolicLink(), `${context} must be a regular non-symlink file`);
  const real = fs.realpathSync(candidate);
  assert(pathWithin(rootReal, real), `${context} resolves outside the lockbox root`);
  return real;
}

function sidecarBytes(file, digest) {
  assertCleanPinnedNodeIntrinsics();
  return NATIVE_BUFFER_FROM(`${digest}  ${NATIVE_PATH_BASENAME(file)}\n`);
}

function readBoundFile(lockboxRoot, relative, maximumBytes, context) {
  assertCleanPinnedNodeIntrinsics();
  const file = resolveEvidencePath(lockboxRoot, relative, context);
  const before = fs.lstatSync(file, { bigint: true });
  assert(before.isFile() && !before.isSymbolicLink() && before.nlink === 1n,
    `${context} must be one regular non-link, non-hardlinked file`);
  assert(before.size >= 1n && before.size <= BigInt(maximumBytes),
    `${context} must contain 1..${maximumBytes} bytes`);
  const bytes = fs.readFileSync(file);
  const after = fs.lstatSync(file, { bigint: true });
  assert(after.dev === before.dev && after.ino === before.ino && after.size === before.size
    && after.mtimeNs === before.mtimeNs && BigInt(bytes.length) === before.size,
  `${context} changed during its single bounded read`);
  const digest = sha256(bytes);
  const sidecarFile = resolveEvidencePath(lockboxRoot, `${relative}.sha256`, `${context} sidecar`);
  const expectedSidecar = sidecarBytes(file, digest);
  const sidecarBefore = fs.lstatSync(sidecarFile, { bigint: true });
  assert(sidecarBefore.isFile() && !sidecarBefore.isSymbolicLink() && sidecarBefore.nlink === 1n
    && sidecarBefore.size === BigInt(expectedSidecar.length),
  `${context} sidecar is not one exact-size regular non-hardlinked file`);
  const sidecar = fs.readFileSync(sidecarFile);
  const sidecarAfter = fs.lstatSync(sidecarFile, { bigint: true });
  assert(sidecarAfter.dev === sidecarBefore.dev && sidecarAfter.ino === sidecarBefore.ino
    && sidecarAfter.size === sidecarBefore.size && sidecarAfter.mtimeNs === sidecarBefore.mtimeNs
    && BigInt(sidecar.length) === sidecarBefore.size,
  `${context} sidecar changed during its single bounded read`);
  assert(sidecar.equals(expectedSidecar), `${context} sidecar mismatch`);
  return deepFreeze({ relativePath: relative, absolutePath: file, bytes, bytesLength: bytes.length,
    sha256: digest });
}

function validatePolicy(policy) {
  assertExactKeys(policy, [
    'decisionDate', 'eventName', 'firstEligibleExecutionAtUtc', 'firstEligibleExecutionDate',
    'lockboxId', 'repository', 'repositoryId', 'runAttempt', 'runId', 'sourceDigest',
    'sourceRef', 'targetCalendarSha256', 'trustedRootSha256', 'verifierPath', 'workflowPath',
    'workflowRef',
  ], 'policy');
  assert(typeof policy.lockboxId === 'string' && policy.lockboxId.length > 0,
    'policy lockboxId is invalid');
  assert(exactDate(policy.decisionDate), 'policy decisionDate is invalid');
  assert(['schedule', 'workflow_dispatch'].includes(policy.eventName), 'policy eventName is invalid');
  assert(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(policy.repository),
    'policy repository is invalid');
  assert(exactPositiveIntegerString(policy.repositoryId), 'policy repositoryId is invalid');
  assert(/^\.github\/workflows\/[A-Za-z0-9_.\/-]+\.ya?ml$/.test(policy.workflowPath)
    && !policy.workflowPath.split('/').some(part => part === '..' || part === '.'),
  'policy workflowPath is invalid');
  assert(/^refs\/heads\/[A-Za-z0-9._\/-]+$/.test(policy.sourceRef)
    && !policy.sourceRef.includes('..'), 'policy sourceRef is invalid');
  assert(policy.workflowRef
    === `${policy.repository}/${policy.workflowPath}@${policy.sourceRef}`,
  'policy workflowRef is not the exact repository/workflow/ref identity');
  assert(exactSha(policy.sourceDigest, 40), 'policy sourceDigest is invalid');
  assert(exactPositiveIntegerString(policy.runId), 'policy runId is invalid');
  assert(Number.isSafeInteger(policy.runAttempt) && policy.runAttempt >= 1,
    'policy runAttempt is invalid');
  assert(exactDate(policy.firstEligibleExecutionDate)
    && policy.firstEligibleExecutionDate > policy.decisionDate,
  'first eligible execution date must be after the decision date');
  assert(exactUtc(policy.firstEligibleExecutionAtUtc)
    && policy.firstEligibleExecutionAtUtc.slice(0, 10) === policy.firstEligibleExecutionDate,
  'first eligible execution cutoff is not exact UTC on its declared date');
  assert(exactSha(policy.trustedRootSha256), 'policy trustedRootSha256 is invalid');
  assert(exactSha(policy.targetCalendarSha256), 'policy targetCalendarSha256 is invalid');
  assert(typeof policy.verifierPath === 'string' && path.isAbsolute(policy.verifierPath),
    'policy verifierPath must be absolute');
  return policy;
}

function validateDecision(decision, policy) {
  assert(isPlainObject(decision), 'decision must be an object');
  assert(decision.schema === DECISION_SCHEMA && decision.status === DECISION_STATUS,
    'decision schema/status is not the prospective six-market bundle');
  assert(decision.lockboxId === policy.lockboxId, 'decision lockboxId differs from policy');
  assert(decision.decisionDate === policy.decisionDate, 'decision date differs from policy');
  assert(exactUtc(decision.collectedAtUtc) && decision.signalKnownAtUtc === decision.collectedAtUtc,
    'decision signal time is invalid');
  assert(Date.parse(decision.signalKnownAtUtc) < Date.parse(policy.firstEligibleExecutionAtUtc),
    'decision was not recorded before the first eligible execution cutoff');
  const remote = decision.remoteRun;
  assert(isPlainObject(remote), 'decision remoteRun is missing');
  assert(remote.environment === 'GITHUB_ACTIONS_REMOTE'
    && remote.runnerEnvironment === 'github-hosted', 'decision was not a GitHub-hosted remote run');
  assert(remote.eventName === policy.eventName, 'decision event differs from policy');
  assert(remote.repository === policy.repository && remote.repositoryId === policy.repositoryId,
    'decision repository identity differs from policy');
  assert(remote.workflowPath === policy.workflowPath && remote.workflowRef === policy.workflowRef,
    'decision workflow identity differs from policy');
  assert(remote.ref === policy.sourceRef, 'decision source ref differs from policy');
  assert(remote.headSha === policy.sourceDigest && remote.workflowSha === policy.sourceDigest,
    'decision source/workflow digest differs from policy');
  assert(remote.runId === policy.runId && remote.runAttempt === policy.runAttempt,
    'decision run ID/attempt differs from policy');
  assert(remote.serverUrl === 'https://github.com', 'decision is not bound to github.com');
  assert(isPlainObject(decision.sourceAcquisition)
    && decision.sourceAcquisition.targetCalendarSha256 === policy.targetCalendarSha256,
  'decision target calendar identity differs from policy');
  return decision;
}

function readCanonicalDecision(lockboxRoot, policy) {
  const relative = decisionRelativePath(policy.decisionDate);
  const evidence = readBoundFile(lockboxRoot, relative, MAX_DECISION_BYTES, 'decision');
  let decision;
  try {
    decision = JSON.parse(evidence.bytes.toString('utf8'));
  } catch (error) {
    fail(`decision JSON parse failed: ${error.message}`);
  }
  assert(evidence.bytes.equals(canonicalBytes(decision)), 'decision bytes are not exact canonical JSON');
  validateDecision(decision, policy);
  return deepFreeze({ ...evidence, value: decision });
}

function parseSigstoreBundle(bytes) {
  let bundle;
  try {
    bundle = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    fail(`Sigstore bundle JSON parse failed: ${error.message}`);
  }
  assert(isPlainObject(bundle) && bundle.mediaType === BUNDLE_MEDIA_TYPE,
    'Sigstore bundle media type is not frozen v0.3');
  const material = bundle.verificationMaterial;
  assert(isPlainObject(material), 'Sigstore verification material is missing');
  assert(isPlainObject(material.certificate), 'Sigstore certificate is missing');
  const certificateBytes = exactBase64(material.certificate.rawBytes, 'Sigstore certificate');
  assert(Array.isArray(material.tlogEntries) && material.tlogEntries.length === 1,
    'Sigstore bundle must have exactly one transparency-log entry');
  const tlog = material.tlogEntries[0];
  assert(isPlainObject(tlog) && isPlainObject(tlog.logId), 'transparency-log identity is missing');
  exactBase64(tlog.logId.keyId, 'transparency-log key ID');
  assert(typeof tlog.integratedTime === 'string' && /^\d+$/.test(tlog.integratedTime),
    'transparency-log integrated time is invalid');
  const integratedTimeUnix = Number(tlog.integratedTime);
  assert(Number.isSafeInteger(integratedTimeUnix) && integratedTimeUnix > 0,
    'transparency-log integrated time is outside the safe range');
  assert(isPlainObject(tlog.inclusionPromise)
    && typeof tlog.inclusionPromise.signedEntryTimestamp === 'string',
  'transparency-log inclusion promise is missing');
  exactBase64(tlog.inclusionPromise.signedEntryTimestamp,
    'transparency-log signed entry timestamp');
  assert(isPlainObject(tlog.inclusionProof) && isPlainObject(tlog.inclusionProof.checkpoint)
    && typeof tlog.inclusionProof.checkpoint.envelope === 'string'
    && tlog.inclusionProof.checkpoint.envelope.length > 0,
  'transparency-log inclusion proof/checkpoint is missing');
  const envelope = bundle.dsseEnvelope;
  assert(isPlainObject(envelope) && envelope.payloadType === 'application/vnd.in-toto+json',
    'DSSE envelope/payload type is invalid');
  assert(Array.isArray(envelope.signatures) && envelope.signatures.length === 1
    && isPlainObject(envelope.signatures[0]), 'DSSE envelope must have exactly one signature');
  exactBase64(envelope.signatures[0].sig, 'DSSE signature');
  const payload = exactBase64(envelope.payload, 'DSSE payload');
  let statement;
  try {
    statement = JSON.parse(payload.toString('utf8'));
  } catch (error) {
    fail(`DSSE statement JSON parse failed: ${error.message}`);
  }
  return deepFreeze({ bundle, certificateBytes, integratedTimeUnix, statement, tlog });
}

function parseTrustedRoot(bytes) {
  const text = bytes.toString('utf8');
  assert(!text.startsWith('\uFEFF'), 'trusted root must not have a UTF-8 BOM');
  const lines = text.split(/\r?\n/).filter(line => line.length > 0);
  assert(lines.length >= 1 && lines.length <= 32, 'trusted root JSONL entry count is invalid');
  for (let index = 0; index < lines.length; index += 1) {
    let value;
    try {
      value = JSON.parse(lines[index]);
    } catch (error) {
      fail(`trusted root JSONL line ${index + 1} parse failed: ${error.message}`);
    }
    assert(isPlainObject(value), `trusted root JSONL line ${index + 1} is not an object`);
  }
  return lines.length;
}

function expectedCertificateIdentity(policy) {
  return `https://github.com/${policy.workflowRef}`;
}

function expectedRunInvocation(policy) {
  return `https://github.com/${policy.repository}/actions/runs/${policy.runId}/attempts/${policy.runAttempt}`;
}

function buildGhArguments(decisionPath, bundlePath, trustedRootPath, policy) {
  return Object.freeze([
    'attestation', 'verify', decisionPath,
    '--bundle', bundlePath,
    '--custom-trusted-root', trustedRootPath,
    '--repo', policy.repository,
    '--signer-digest', policy.sourceDigest,
    '--source-digest', policy.sourceDigest,
    '--source-ref', policy.sourceRef,
    '--cert-identity', expectedCertificateIdentity(policy),
    '--cert-oidc-issuer', OIDC_ISSUER,
    '--predicate-type', SLSA_PREDICATE_TYPE,
    '--deny-self-hosted-runners',
    '--hostname', 'github.com',
    '--limit', '1',
    '--format', 'json',
  ]);
}

function verifyPinnedGhIdentity(verifierPath) {
  assertCleanPinnedNodeIntrinsics();
  assert(process.platform === PINNED_GH_VERIFIER.platform
    && process.arch === PINNED_GH_VERIFIER.arch,
  `cryptographic verification requires ${PINNED_GH_VERIFIER.platform}/${PINNED_GH_VERIFIER.arch}`);
  const stat = fs.lstatSync(verifierPath);
  assert(stat.isFile() && !stat.isSymbolicLink(), 'gh verifier must be a regular non-symlink file');
  assert(stat.size === PINNED_GH_VERIFIER.executableBytes, 'gh verifier byte length mismatch');
  const bytes = fs.readFileSync(verifierPath);
  assert(sha256(bytes) === PINNED_GH_VERIFIER.executableSha256, 'gh verifier SHA-256 mismatch');
  const result = childProcess.spawnSync(verifierPath, ['--version'], {
    encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 1024 * 1024,
    env: verifierEnvironment(),
  });
  assert(!result.error && result.status === 0 && result.signal === null,
    'gh verifier version command failed');
  assert(result.stderr === '', 'gh verifier version command wrote stderr');
  const firstLine = result.stdout.split(/\r?\n/)[0];
  assert(firstLine.startsWith(`gh version ${PINNED_GH_VERIFIER.version} (`),
    'gh verifier version output mismatch');
  return deepFreeze({ ...PINNED_GH_VERIFIER });
}

function verifierEnvironment() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GH_') || key.startsWith('GITHUB_')) delete env[key];
  }
  env.GH_PROMPT_DISABLED = '1';
  env.GH_NO_UPDATE_NOTIFIER = '1';
  env.NO_COLOR = '1';
  env.CLICOLOR = '0';
  // With both --bundle and --custom-trusted-root, GitHub documents this path as
  // offline verification. A closed local proxy makes an accidental network
  // dependency fail instead of silently changing the trust decision.
  env.HTTP_PROXY = 'http://127.0.0.1:9';
  env.HTTPS_PROXY = 'http://127.0.0.1:9';
  env.ALL_PROXY = 'http://127.0.0.1:9';
  env.NO_PROXY = '';
  return env;
}

function runPinnedGhVerifier(verifierPath, args) {
  verifyPinnedGhIdentity(verifierPath);
  const result = childProcess.spawnSync(verifierPath, args, {
    encoding: 'utf8', windowsHide: true, timeout: 60000,
    maxBuffer: MAX_VERIFIER_OUTPUT_BYTES, env: verifierEnvironment(),
  });
  assert(!result.error && result.status === 0 && result.signal === null,
    `gh cryptographic verification failed${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
  assert(result.stderr === '', 'gh cryptographic verification wrote stderr');
  assert(Buffer.byteLength(result.stdout) >= 2
    && Buffer.byteLength(result.stdout) <= MAX_VERIFIER_OUTPUT_BYTES,
  'gh cryptographic verification output size is invalid');
  let output;
  try {
    output = JSON.parse(result.stdout);
  } catch (error) {
    fail(`gh cryptographic verification output is not JSON: ${error.message}`);
  }
  return output;
}

function equalCanonical(left, right, context) {
  assert(canonicalBytes(left).equals(canonicalBytes(right)), `${context} differs`);
}

function validateStatement(statement, policy, decisionSha256Value, expectedSubjectName) {
  assert(isPlainObject(statement) && statement._type === IN_TOTO_STATEMENT_TYPE,
    'verified in-toto statement type is invalid');
  assert(statement.predicateType === SLSA_PREDICATE_TYPE,
    'verified predicate type is invalid');
  assert(Array.isArray(statement.subject) && statement.subject.length === 1,
    'verified statement must cover exactly one subject');
  const subject = statement.subject[0];
  assertExactKeys(subject, ['digest', 'name'], 'verified subject');
  assert(subject.name === expectedSubjectName, 'verified subject name does not equal decision path');
  assertExactKeys(subject.digest, ['sha256'], 'verified subject digest');
  assert(subject.digest.sha256 === decisionSha256Value,
    'verified subject digest does not equal canonical decision SHA-256');
  const predicate = statement.predicate;
  assert(isPlainObject(predicate) && isPlainObject(predicate.buildDefinition)
    && isPlainObject(predicate.runDetails), 'verified SLSA predicate is incomplete');
  const definition = predicate.buildDefinition;
  assert(definition.buildType === GITHUB_BUILD_TYPE,
    'verified SLSA GitHub workflow build type is invalid');
  const workflow = definition.externalParameters && definition.externalParameters.workflow;
  assert(isPlainObject(workflow)
    && workflow.repository === `https://github.com/${policy.repository}`
    && workflow.path === policy.workflowPath && workflow.ref === policy.sourceRef,
  'verified SLSA workflow source identity is invalid');
  const github = definition.internalParameters && definition.internalParameters.github;
  assert(isPlainObject(github) && github.event_name === policy.eventName
    && String(github.repository_id) === policy.repositoryId
    && github.runner_environment === 'github-hosted',
  'verified SLSA GitHub internal parameters are invalid');
  assert(Array.isArray(definition.resolvedDependencies)
    && definition.resolvedDependencies.length === 1,
  'verified SLSA source dependency cardinality is invalid');
  const dependency = definition.resolvedDependencies[0];
  assert(isPlainObject(dependency)
    && dependency.uri === `git+https://github.com/${policy.repository}@${policy.sourceRef}`
    && isPlainObject(dependency.digest)
    && dependency.digest.gitCommit === policy.sourceDigest,
  'verified SLSA source dependency is invalid');
  assert(predicate.runDetails.builder
    && predicate.runDetails.builder.id === expectedCertificateIdentity(policy),
  'verified SLSA builder identity is invalid');
  assert(predicate.runDetails.metadata
    && predicate.runDetails.metadata.invocationId === expectedRunInvocation(policy),
  'verified SLSA run ID/attempt is invalid');
}

function validateCertificate(certificate, policy) {
  assert(isPlainObject(certificate), 'verified certificate projection is missing');
  const identity = expectedCertificateIdentity(policy);
  const repositoryUri = `https://github.com/${policy.repository}`;
  const owner = policy.repository.split('/')[0];
  assert(certificate.issuer === OIDC_ISSUER, 'certificate OIDC issuer is invalid');
  assert(certificate.subjectAlternativeName === identity
    && certificate.buildSignerURI === identity && certificate.buildConfigURI === identity,
  'certificate signer workflow identity is invalid');
  assert(certificate.githubWorkflowRepository === policy.repository
    && certificate.githubWorkflowRef === policy.sourceRef,
  'certificate workflow repository/ref is invalid');
  assert(certificate.githubWorkflowSHA === policy.sourceDigest
    && certificate.buildSignerDigest === policy.sourceDigest
    && certificate.buildConfigDigest === policy.sourceDigest,
  'certificate workflow digest is invalid');
  assert(certificate.sourceRepositoryURI === repositoryUri
    && certificate.sourceRepositoryDigest === policy.sourceDigest
    && certificate.sourceRepositoryRef === policy.sourceRef
    && certificate.sourceRepositoryIdentifier === policy.repositoryId,
  'certificate source repository identity is invalid');
  assert(certificate.sourceRepositoryOwnerURI === `https://github.com/${owner}`,
    'certificate source repository owner is invalid');
  assert(certificate.githubWorkflowTrigger === policy.eventName
    && certificate.buildTrigger === policy.eventName,
  'certificate workflow trigger is invalid');
  assert(certificate.runInvocationURI === expectedRunInvocation(policy),
    'certificate run ID/attempt is invalid');
  assert(certificate.runnerEnvironment === 'github-hosted',
    'certificate does not bind a GitHub-hosted runner');
  assert(certificate.sourceRepositoryVisibilityAtSigning === 'public',
    'certificate does not prove public-repository signing');
}

function validateVerifiedGhOutput(output, parsedBundle, decisionEvidence, policy) {
  assert(Array.isArray(output) && output.length === 1,
    'gh must return exactly one cryptographically verified attestation');
  const entry = output[0];
  assertExactKeys(entry, ['attestation', 'verificationResult'], 'gh verification entry');
  assertExactKeys(entry.attestation, ['bundle', 'bundle_url', 'initiator'],
    'gh verified attestation envelope');
  assert(entry.attestation.bundle_url === '' && entry.attestation.initiator === '',
    'gh verification did not use only the archived local bundle');
  equalCanonical(entry.attestation.bundle, parsedBundle.bundle,
    'gh-verified bundle and archived bundle');
  const verification = entry.verificationResult;
  assertExactKeys(verification,
    ['mediaType', 'signature', 'statement', 'verifiedIdentity', 'verifiedTimestamps'],
    'gh verification result');
  assert(verification.mediaType === VERIFICATION_MEDIA_TYPE,
    'gh verification-result media type is invalid');
  assertExactKeys(verification.signature, ['certificate'], 'gh signature result');
  validateCertificate(verification.signature.certificate, policy);
  equalCanonical(verification.statement, parsedBundle.statement,
    'gh-verified statement and DSSE payload');
  validateStatement(verification.statement, policy, decisionEvidence.sha256,
    decisionEvidence.relativePath);
  assert(Array.isArray(verification.verifiedTimestamps)
    && verification.verifiedTimestamps.length === 1,
  'gh must cryptographically verify exactly one external timestamp');
  const timestamp = verification.verifiedTimestamps[0];
  assertExactKeys(timestamp, ['timestamp', 'type', 'uri'], 'gh verified timestamp');
  assert(timestamp.type === 'Tlog' && timestamp.uri === REKOR_URI,
    'verified timestamp is not the Sigstore Public Good Rekor log');
  const timestampMs = Date.parse(timestamp.timestamp);
  assert(Number.isFinite(timestampMs)
    && timestampMs === parsedBundle.integratedTimeUnix * 1000,
  'verified Rekor time differs from the bundle integrated time');
  const signalSecond = Math.floor(Date.parse(decisionEvidence.value.signalKnownAtUtc) / 1000);
  assert(parsedBundle.integratedTimeUnix >= signalSecond,
    'Rekor time predates the decision signal-known second');
  assert(timestampMs < Date.parse(policy.firstEligibleExecutionAtUtc),
    'Rekor time is not strictly before the first eligible execution');
  return deepFreeze({
    certificate: verification.signature.certificate,
    integratedTimeUnix: parsedBundle.integratedTimeUnix,
    integratedAtUtc: new Date(timestampMs).toISOString(),
    logIdKeyId: parsedBundle.tlog.logId.keyId,
    statement: verification.statement,
  });
}

function buildReceipt({ decisionEvidence, bundleEvidence, trustedRootEvidence,
  trustedRootEntries, verified, policy }) {
  const identity = {
    repository: policy.repository,
    repositoryId: policy.repositoryId,
    workflowPath: policy.workflowPath,
    workflowRef: policy.workflowRef,
    sourceRef: policy.sourceRef,
    sourceDigest: policy.sourceDigest,
    eventName: policy.eventName,
    runId: policy.runId,
    runAttempt: policy.runAttempt,
    runnerEnvironment: 'github-hosted',
    certificateIdentity: expectedCertificateIdentity(policy),
    runInvocationUri: expectedRunInvocation(policy),
  };
  const receipt = {
    schema: ANCHOR_SCHEMA,
    status: ANCHOR_STATUS,
    lockboxId: policy.lockboxId,
    decision: {
      path: decisionEvidence.relativePath,
      decisionDate: policy.decisionDate,
      bytes: decisionEvidence.bytesLength,
      sha256: decisionEvidence.sha256,
      signalKnownAtUtc: decisionEvidence.value.signalKnownAtUtc,
    },
    anchor: {
      mechanism: 'GITHUB_ARTIFACT_ATTESTATION_SIGSTORE_PUBLIC_GOOD_REKOR',
      attestationAction: {
        ...ATTEST_ACTION,
        binding: 'REQUIRES_SEPARATE_GIT_TREE_VERIFICATION_OF_WORKFLOW_AT_SOURCE_DIGEST',
      },
      bundle: {
        path: bundleEvidence.relativePath,
        bytes: bundleEvidence.bytesLength,
        sha256: bundleEvidence.sha256,
        mediaType: BUNDLE_MEDIA_TYPE,
      },
      trustedRoot: {
        path: trustedRootEvidence.relativePath,
        bytes: trustedRootEvidence.bytesLength,
        sha256: trustedRootEvidence.sha256,
        jsonlEntries: trustedRootEntries,
        authorization: 'EXTERNALLY_PINNED_SNAPSHOT_FOR_THIS_SINGLE_RECEIPT_ONLY',
      },
      verifier: { ...PINNED_GH_VERIFIER },
      identity,
      transparencyLog: {
        uri: REKOR_URI,
        logIdKeyId: verified.logIdKeyId,
        integratedTimeUnix: verified.integratedTimeUnix,
        integratedAtUtc: verified.integratedAtUtc,
        verificationSource: 'GH_VERIFIED_TIMESTAMPS_AND_BUNDLE_TLOG_ENTRY',
      },
      certificateSha256: sha256(
        exactBase64(parsedRawCertificateFromBundle(bundleEvidence.bytes), 'Sigstore certificate'),
      ),
      predicateType: SLSA_PREDICATE_TYPE,
      oidcIssuer: OIDC_ISSUER,
    },
    deadline: {
      firstEligibleExecutionDate: policy.firstEligibleExecutionDate,
      firstEligibleExecutionAtUtc: policy.firstEligibleExecutionAtUtc,
      targetCalendarSha256: policy.targetCalendarSha256,
      deadlineDerivation: 'REQUIRES_SEPARATE_REPLAY_AGAINST_FROZEN_TARGET_CALENDAR',
      comparison: 'REKOR_INTEGRATED_TIME_STRICTLY_BEFORE_FIRST_ELIGIBLE_EXECUTION',
    },
    endpointTrustPolicy: { ...LONG_HORIZON_TRUST_POLICY },
  };
  receipt.receiptSha256 = hashCanonical(receipt);
  return deepFreeze(receipt);
}

function parsedRawCertificateFromBundle(bundleBytes) {
  const bundle = JSON.parse(bundleBytes.toString('utf8'));
  return bundle.verificationMaterial.certificate.rawBytes;
}

function createAnchorReceipt(input) {
  assertCleanPinnedNodeIntrinsics();
  const invocation = deepFreeze(canonicalize(input));
  assertExactKeys(invocation, ['lockboxRoot', 'policy'], 'anchor creation input');
  const { lockboxRoot } = invocation;
  const frozenPolicy = invocation.policy;
  validatePolicy(frozenPolicy);
  const decisionEvidence = readCanonicalDecision(lockboxRoot, frozenPolicy);
  const bundleEvidence = readBoundFile(lockboxRoot, bundleRelativePath(frozenPolicy.decisionDate),
    MAX_BUNDLE_BYTES, 'Sigstore bundle');
  const parsedBundle = parseSigstoreBundle(bundleEvidence.bytes);
  const trustedRootEvidence = readBoundFile(lockboxRoot, TRUSTED_ROOT_RELATIVE_PATH,
    MAX_TRUSTED_ROOT_BYTES, 'trusted root');
  assert(trustedRootEvidence.sha256 === frozenPolicy.trustedRootSha256,
    'trusted root differs from the externally pinned policy SHA-256');
  const trustedRootEntries = parseTrustedRoot(trustedRootEvidence.bytes);
  const args = buildGhArguments(decisionEvidence.absolutePath, bundleEvidence.absolutePath,
    trustedRootEvidence.absolutePath, frozenPolicy);
  const output = runPinnedGhVerifier(frozenPolicy.verifierPath, args);
  const verified = validateVerifiedGhOutput(output, parsedBundle, decisionEvidence, frozenPolicy);
  return buildReceipt({ decisionEvidence, bundleEvidence, trustedRootEvidence,
    trustedRootEntries, verified, policy: frozenPolicy });
}

function validateReceiptShape(receipt, policy) {
  assertExactKeys(receipt, ['anchor', 'deadline', 'decision', 'endpointTrustPolicy', 'lockboxId',
    'receiptSha256', 'schema', 'status'], 'anchor receipt');
  assert(receipt.schema === ANCHOR_SCHEMA && receipt.status === ANCHOR_STATUS,
    'anchor receipt schema/status mismatch');
  assert(receipt.lockboxId === policy.lockboxId, 'anchor receipt lockboxId mismatch');
  assert(exactSha(receipt.receiptSha256)
    && receipt.receiptSha256 === hashCanonical(Object.fromEntries(
      Object.entries(receipt).filter(([key]) => key !== 'receiptSha256'),
    )), 'anchor receipt self-hash mismatch');
  assertExactKeys(receipt.decision,
    ['bytes', 'decisionDate', 'path', 'sha256', 'signalKnownAtUtc'], 'anchor receipt decision');
  exactRelativePath(receipt.decision.path, decisionRelativePath(policy.decisionDate),
    'anchor receipt decision path');
  assertExactKeys(receipt.anchor,
    ['attestationAction', 'bundle', 'certificateSha256', 'identity', 'mechanism', 'oidcIssuer',
      'predicateType', 'transparencyLog', 'trustedRoot', 'verifier'], 'anchor receipt proof');
  assertExactKeys(receipt.deadline,
    ['comparison', 'deadlineDerivation', 'firstEligibleExecutionAtUtc', 'firstEligibleExecutionDate',
      'targetCalendarSha256'],
    'anchor receipt deadline');
  assertExactKeys(receipt.endpointTrustPolicy,
    ['endpointEligible', 'reason', 'requiredResolution', 'status'],
    'anchor receipt endpoint policy');
  equalCanonical(receipt.endpointTrustPolicy, LONG_HORIZON_TRUST_POLICY,
    'anchor receipt long-horizon trust policy');
}

function verifyAnchorReceipt(input) {
  assertCleanPinnedNodeIntrinsics();
  const invocation = deepFreeze(canonicalize(input));
  assertExactKeys(invocation, ['lockboxRoot', 'policy'], 'anchor verification input');
  const { lockboxRoot } = invocation;
  const frozenPolicy = invocation.policy;
  validatePolicy(frozenPolicy);
  const relative = anchorRelativePath(frozenPolicy.decisionDate);
  const archived = readBoundFile(lockboxRoot, relative, MAX_BUNDLE_BYTES, 'anchor receipt');
  let receipt;
  try {
    receipt = JSON.parse(archived.bytes.toString('utf8'));
  } catch (error) {
    fail(`anchor receipt JSON parse failed: ${error.message}`);
  }
  assert(archived.bytes.equals(canonicalBytes(receipt)), 'anchor receipt is not exact canonical JSON');
  validateReceiptShape(receipt, frozenPolicy);
  const expected = createAnchorReceipt({ lockboxRoot, policy: frozenPolicy });
  equalCanonical(receipt, expected, 'archived and independently reconstructed anchor receipt');
  return deepFreeze({
    receipt,
    receiptFileSha256: archived.sha256,
    singleEventCryptographicallyVerified: true,
    endpointEligible: false,
    endpointBlockReason: LONG_HORIZON_TRUST_POLICY.reason,
  });
}

function assertAllowedKeys(value, required, optional, context) {
  assert(isPlainObject(value), `${context} must be an object`);
  const actual = Object.keys(value).sort();
  const requiredSet = new Set(required);
  const allowedSet = new Set([...required, ...optional]);
  for (const key of actual) assert(allowedSet.has(key), `${context} has unknown key ${key}`);
  for (const key of requiredSet) assert(Object.hasOwn(value, key), `${context} is missing key ${key}`);
}

function strictJsonText(bytes, context) {
  assertCleanPinnedNodeIntrinsics();
  let text;
  try {
    text = NATIVE_TEXT_DECODE.call(UTF8_FATAL_DECODER, bytes);
  } catch (error) {
    fail(`${context} is not valid UTF-8: ${error.message}`);
  }
  assert(!text.startsWith('\uFEFF'), `${context} must not contain a UTF-8 BOM`);
  return text;
}

// JSON.parse cannot report duplicate member names. TUF signs the parsed
// canonical `signed` object, so accepting duplicate names would let different
// parsers disagree about the authenticated value. This small bounded parser
// rejects duplicates, accessors/prototypes, unsafe names, holes, and trailing
// bytes before any signature decision is made.
function parseStrictJsonBytes(bytes, context) {
  const text = strictJsonText(bytes, context);
  let offset = 0;
  const whitespace = /[\x20\x09\x0a\x0d]/;

  function skipWhitespace() {
    while (offset < text.length && whitespace.test(text[offset])) offset += 1;
  }

  function parseString() {
    assert(text[offset] === '"', `${context} expected a JSON string at byte ${offset}`);
    const start = offset;
    offset += 1;
    let escaped = false;
    while (offset < text.length) {
      const code = text.charCodeAt(offset);
      if (!escaped && code === 0x22) {
        offset += 1;
        try { return NATIVE_JSON_PARSE(text.slice(start, offset)); } catch (error) {
          fail(`${context} has an invalid JSON string: ${error.message}`);
        }
      }
      assert(code >= 0x20, `${context} has an unescaped control character`);
      if (!escaped && code === 0x5c) escaped = true;
      else escaped = false;
      offset += 1;
    }
    fail(`${context} has an unterminated JSON string`);
  }

  function parseNumber() {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(text.slice(offset));
    assert(match, `${context} has an invalid JSON number at byte ${offset}`);
    offset += match[0].length;
    const value = Number(match[0]);
    assert(Number.isFinite(value) && !Object.is(value, -0),
      `${context} rejects non-finite or negative-zero JSON numbers`);
    return value;
  }

  function parseValue(depth) {
    assert(depth <= 64, `${context} exceeds the maximum JSON nesting depth`);
    skipWhitespace();
    assert(offset < text.length, `${context} ended before a JSON value`);
    if (text[offset] === '"') return parseString();
    if (text[offset] === '{') {
      offset += 1;
      const result = Object.create(null);
      const seen = new Set();
      skipWhitespace();
      if (text[offset] === '}') { offset += 1; return result; }
      while (true) {
        skipWhitespace();
        const key = parseString();
        assert(!['__proto__', 'constructor', 'prototype'].includes(key),
          `${context} rejects unsafe object key ${key}`);
        assert(!seen.has(key), `${context} has duplicate object key ${key}`);
        seen.add(key);
        skipWhitespace();
        assert(text[offset] === ':', `${context} expected ':' after object key`);
        offset += 1;
        const value = parseValue(depth + 1);
        Object.defineProperty(result, key, { value, enumerable: true, writable: true,
          configurable: true });
        skipWhitespace();
        if (text[offset] === '}') { offset += 1; return result; }
        assert(text[offset] === ',', `${context} expected ',' between object members`);
        offset += 1;
      }
    }
    if (text[offset] === '[') {
      offset += 1;
      const result = [];
      skipWhitespace();
      if (text[offset] === ']') { offset += 1; return result; }
      let index = 0;
      while (true) {
        Object.defineProperty(result, index, { value: parseValue(depth + 1), enumerable: true,
          writable: true, configurable: true });
        index += 1;
        assert(index <= 4096, `${context} exceeds the maximum JSON array length`);
        skipWhitespace();
        if (text[offset] === ']') { offset += 1; return result; }
        assert(text[offset] === ',', `${context} expected ',' between array members`);
        offset += 1;
      }
    }
    if (text.startsWith('true', offset)) { offset += 4; return true; }
    if (text.startsWith('false', offset)) { offset += 5; return false; }
    if (text.startsWith('null', offset)) { offset += 4; return null; }
    if (text[offset] === '-' || /[0-9]/.test(text[offset])) return parseNumber();
    fail(`${context} has an invalid JSON token at byte ${offset}`);
  }

  const value = parseValue(0);
  skipWhitespace();
  assert(offset === text.length, `${context} has trailing bytes after the JSON value`);
  return value;
}

function canonicalTufSignedBytes(value) {
  assertCleanPinnedNodeIntrinsics();
  // TUF 1.0 metadata uses the securesystemslib OLPC canonical JSON dialect,
  // not JSON.stringify/JCS: dictionary keys are sorted, numbers are integers,
  // and strings escape only quote and backslash (PEM newlines remain literal).
  // This exact distinction is covered by the frozen real root-10 regression.
  function compareUnicodeScalars(left, right) {
    let leftIndex = 0;
    let rightIndex = 0;
    while (leftIndex < left.length && rightIndex < right.length) {
      const leftPoint = NATIVE_STRING_CODE_POINT_AT.call(left, leftIndex);
      const rightPoint = NATIVE_STRING_CODE_POINT_AT.call(right, rightIndex);
      if (leftPoint !== rightPoint) return leftPoint < rightPoint ? -1 : 1;
      leftIndex += leftPoint > 0xffff ? 2 : 1;
      rightIndex += rightPoint > 0xffff ? 2 : 1;
    }
    return left.length - right.length;
  }

  function encodeString(string, context) {
    let encoded = '"';
    for (let index = 0; index < string.length; index += 1) {
      const code = NATIVE_STRING_CHAR_CODE_AT.call(string, index);
      if (code >= 0xd800 && code <= 0xdbff) {
        assert(index + 1 < string.length, `${context} has an unpaired high surrogate`);
        const low = NATIVE_STRING_CHAR_CODE_AT.call(string, index + 1);
        assert(low >= 0xdc00 && low <= 0xdfff, `${context} has an unpaired high surrogate`);
        encoded += string[index] + string[index + 1];
        index += 1;
      } else {
        assert(!(code >= 0xdc00 && code <= 0xdfff), `${context} has an unpaired low surrogate`);
        if (code === 0x22 || code === 0x5c) encoded += '\\';
        encoded += string[index];
      }
    }
    return `${encoded}"`;
  }

  function encode(current, depth, context) {
    assert(depth <= 64, `${context} exceeds TUF canonical nesting depth`);
    if (current === null) return 'null';
    if (current === true) return 'true';
    if (current === false) return 'false';
    if (typeof current === 'string') return encodeString(current, context);
    if (typeof current === 'number') {
      assert(NATIVE_NUMBER_IS_SAFE_INTEGER(current) && !NATIVE_OBJECT_IS(current, -0),
        `${context} TUF canonical JSON accepts only safe integers`);
      return String(current);
    }
    if (NATIVE_ARRAY_IS_ARRAY(current)) {
      assert(NATIVE_OBJECT_GET_OWN_PROPERTY_SYMBOLS(current).length === 0
        && NATIVE_OBJECT_KEYS(current).length === current.length,
      `${context} TUF canonical JSON rejects sparse or extended arrays`);
      let output = '[';
      for (let index = 0; index < current.length; index += 1) {
        const descriptor = NATIVE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(current, String(index));
        assert(descriptor && NATIVE_OBJECT_HAS_OWN(descriptor, 'value'),
          `${context} TUF canonical JSON rejects array accessors`);
        if (index > 0) output += ',';
        output += encode(descriptor.value, depth + 1, `${context}[${index}]`);
      }
      return `${output}]`;
    }
    assert(isPlainObject(current), `${context} TUF canonical JSON rejects ${typeof current}`);
    assert(NATIVE_OBJECT_GET_OWN_PROPERTY_SYMBOLS(current).length === 0,
      `${context} TUF canonical JSON rejects symbol-bearing objects`);
    const keys = NATIVE_OBJECT_KEYS(current);
    NATIVE_ARRAY_SORT.call(keys, compareUnicodeScalars);
    let output = '{';
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index];
      assert(!NATIVE_ARRAY_INCLUDES.call(['__proto__', 'constructor', 'prototype'], key),
        `${context} TUF canonical JSON rejects unsafe key ${key}`);
      const descriptor = NATIVE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(current, key);
      assert(descriptor && NATIVE_OBJECT_HAS_OWN(descriptor, 'value'),
        `${context} TUF canonical JSON rejects accessor ${key}`);
      if (index > 0) output += ',';
      output += `${encodeString(key, `${context} key`)}:${encode(descriptor.value,
        depth + 1, `${context}.${key}`)}`;
    }
    return `${output}}`;
  }

  const bytes = NATIVE_BUFFER_FROM(encode(value, 0, 'TUF signed body'), 'utf8');
  assert(bytes.length >= 2 && bytes.length <= MAX_TUF_METADATA_BYTES * 4,
    'TUF canonical signed body exceeds its bounded encoding limit');
  return bytes;
}

function exactTufUtc(value, context) {
  assert(typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)
    && Number.isFinite(Date.parse(value)), `${context} is not exact UTC`);
  const normalized = new Date(Date.parse(value)).toISOString();
  const expected = value.includes('.') ? value : value.replace('Z', '.000Z');
  assert(normalized === expected, `${context} is not a canonical UTC instant`);
  return Date.parse(value);
}

function exactBoundedPositiveInteger(value, maximum, context) {
  assert(Number.isSafeInteger(value) && value >= 1 && value <= maximum,
    `${context} must be an integer in 1..${maximum}`);
  return value;
}

function validateFileReference(reference, context) {
  assertExactKeys(reference, ['bytes', 'path', 'sha256', 'version'], context);
  assert(typeof reference.path === 'string' && reference.path.length >= 1
    && reference.path.length <= 240 && !reference.path.includes('\\')
    && !reference.path.startsWith('/')
    && !reference.path.split('/').some(part => part === '' || part === '.' || part === '..'),
  `${context} path is not a bounded safe relative path`);
  exactBoundedPositiveInteger(reference.bytes, MAX_TRUSTED_ROOT_BYTES, `${context} bytes`);
  assert(exactSha(reference.sha256), `${context} SHA-256 is invalid`);
  exactBoundedPositiveInteger(reference.version, Number.MAX_SAFE_INTEGER, `${context} version`);
}

function validateDigestReference(reference, context) {
  assertExactKeys(reference, ['path', 'sha256'], context);
  assert(typeof reference.path === 'string' && reference.path.length >= 1
    && reference.path.length <= 240 && !reference.path.includes('\\')
    && !reference.path.startsWith('/')
    && !reference.path.split('/').some(part => part === '' || part === '.' || part === '..'),
  `${context} path is not a bounded safe relative path`);
  assert(exactSha(reference.sha256), `${context} SHA-256 is invalid`);
}

function readReferencedFile(lockboxRoot, reference, maximumBytes, context) {
  validateFileReference(reference, context);
  const evidence = readBoundFile(lockboxRoot, reference.path, maximumBytes, context);
  assert(evidence.bytesLength === reference.bytes, `${context} byte length differs from receipt`);
  assert(evidence.sha256 === reference.sha256, `${context} SHA-256 differs from receipt`);
  return evidence;
}

function validateContentReference(reference, context) {
  assertExactKeys(reference, ['bytes', 'path', 'sha256'], context);
  validateFileReference({ ...reference, version: 1 }, context);
}

function readReferencedContent(lockboxRoot, reference, maximumBytes, context) {
  validateContentReference(reference, context);
  const evidence = readBoundFile(lockboxRoot, reference.path, maximumBytes, context);
  assert(evidence.bytesLength === reference.bytes, `${context} byte length differs from receipt`);
  assert(evidence.sha256 === reference.sha256, `${context} SHA-256 differs from receipt`);
  return evidence;
}

function rootHistoryRelativePath(version) {
  return `freeze/tuf/metadata/root_history/${version}.root.json`;
}

function timestampRelativePath(version) {
  return `freeze/tuf/metadata/${version}.timestamp.json`;
}

function snapshotRelativePath(version) {
  return `freeze/tuf/metadata/${version}.snapshot.json`;
}

function targetsRelativePath(version) {
  return `freeze/tuf/metadata/${version}.targets.json`;
}

function eventTufSelectionRelativePath(date) {
  return ['anchors', ...dateParts(date), 'r000', 'tuf-selection-event.json'].join('/');
}

function currentTufSelectionRelativePath(decisionDate, currentPolicyTimeUtc) {
  const currentDate = currentPolicyTimeUtc.slice(0, 10);
  return ['trust-replay', ...dateParts(currentDate), 'decisions', ...dateParts(decisionDate),
    'r000', 'tuf-selection-current.json'].join('/');
}

function validateTufKey(key, context) {
  assertAllowedKeys(key, ['keytype', 'scheme', 'keyval'],
    ['keyid_hash_algorithms', 'x-tuf-on-ci-keyowner', 'x-tuf-on-ci-online-uri'], context);
  assertExactKeys(key.keyval, ['public'], `${context} keyval`);
  assert(typeof key.keyval.public === 'string' && key.keyval.public.length >= 32
    && key.keyval.public.length <= 16384, `${context} public key is invalid`);
  const supported = (key.keytype === 'ecdsa' && key.scheme === 'ecdsa-sha2-nistp256')
    || (key.keytype === 'ed25519' && key.scheme === 'ed25519');
  assert(supported, `${context} uses unsupported key type/scheme`);
  if (Object.hasOwn(key, 'keyid_hash_algorithms')) {
    assert(Array.isArray(key.keyid_hash_algorithms)
      && key.keyid_hash_algorithms.length >= 1 && key.keyid_hash_algorithms.length <= 2
      && key.keyid_hash_algorithms.every(item => item === 'sha256' || item === 'sha512')
      && new Set(key.keyid_hash_algorithms).size === key.keyid_hash_algorithms.length,
    `${context} key ID hash algorithms are invalid`);
  }
  if (Object.hasOwn(key, 'x-tuf-on-ci-keyowner')) {
    assert(typeof key['x-tuf-on-ci-keyowner'] === 'string'
      && /^@[A-Za-z0-9_.-]{1,64}$/.test(key['x-tuf-on-ci-keyowner']),
    `${context} keyowner extension is invalid`);
  }
  if (Object.hasOwn(key, 'x-tuf-on-ci-online-uri')) {
    assert(typeof key['x-tuf-on-ci-online-uri'] === 'string'
      && key['x-tuf-on-ci-online-uri'].length <= 2048,
    `${context} online URI extension is invalid`);
  }
  try { NATIVE_CRYPTO_CREATE_PUBLIC_KEY(key.keyval.public); } catch (error) {
    fail(`${context} public key cannot be parsed: ${error.message}`);
  }
}

function validateTufRole(role, context) {
  assertAllowedKeys(role, ['keyids', 'threshold'],
    ['x-tuf-on-ci-expiry-period', 'x-tuf-on-ci-signing-period'], context);
  assert(Array.isArray(role.keyids) && role.keyids.length >= 1
    && role.keyids.length <= MAX_TUF_KEYS && new Set(role.keyids).size === role.keyids.length
    && role.keyids.every(value => exactSha(value)), `${context} key IDs are invalid`);
  exactBoundedPositiveInteger(role.threshold, role.keyids.length, `${context} threshold`);
  for (const extension of ['x-tuf-on-ci-expiry-period', 'x-tuf-on-ci-signing-period']) {
    if (Object.hasOwn(role, extension)) {
      exactBoundedPositiveInteger(role[extension], 36500, `${context} ${extension}`);
    }
  }
}

function validateTufEnvelope(envelope, context) {
  assertExactKeys(envelope, ['signatures', 'signed'], context);
  assert(Array.isArray(envelope.signatures) && envelope.signatures.length >= 1
    && envelope.signatures.length <= MAX_TUF_SIGNATURES,
  `${context} signature count is invalid`);
  const seen = new Set();
  for (let index = 0; index < envelope.signatures.length; index += 1) {
    const signature = envelope.signatures[index];
    assertExactKeys(signature, ['keyid', 'sig'], `${context} signature ${index}`);
    assert(exactSha(signature.keyid), `${context} signature ${index} key ID is invalid`);
    assert(!seen.has(signature.keyid), `${context} repeats signature key ${signature.keyid}`);
    seen.add(signature.keyid);
    assert(typeof signature.sig === 'string' && signature.sig.length >= 64
      && signature.sig.length <= 4096 && signature.sig.length % 2 === 0
      && /^[a-f0-9]+$/.test(signature.sig), `${context} signature ${index} is not canonical hex`);
  }
  assert(isPlainObject(envelope.signed), `${context} signed body must be an object`);
}

function validateCommonTufSigned(signed, type, required, optional, context) {
  assertAllowedKeys(signed, ['_type', 'spec_version', 'version', 'expires', ...required],
    optional, context);
  assert(signed._type === type, `${context} role type must be ${type}`);
  assert(signed.spec_version === TUF_SPEC_VERSION,
    `${context} spec version must be exactly ${TUF_SPEC_VERSION}`);
  exactBoundedPositiveInteger(signed.version, Number.MAX_SAFE_INTEGER, `${context} version`);
  exactTufUtc(signed.expires, `${context} expiry`);
}

function validateTufRootEnvelope(envelope, context) {
  validateTufEnvelope(envelope, context);
  const signed = envelope.signed;
  validateCommonTufSigned(signed, 'root', ['consistent_snapshot', 'keys', 'roles'],
    ['x-tuf-on-ci-expiry-period', 'x-tuf-on-ci-signing-period'], `${context} signed`);
  assert(signed.consistent_snapshot === true,
    `${context} must use consistent snapshots for immutable offline replay`);
  assert(isPlainObject(signed.keys), `${context} keys must be an object`);
  const keyIds = Object.keys(signed.keys).sort();
  assert(keyIds.length >= 4 && keyIds.length <= MAX_TUF_KEYS,
    `${context} key count is outside 4..${MAX_TUF_KEYS}`);
  for (const keyId of keyIds) {
    assert(exactSha(keyId), `${context} has invalid key ID ${keyId}`);
    validateTufKey(signed.keys[keyId], `${context} key ${keyId}`);
  }
  assertExactKeys(signed.roles, ['root', 'snapshot', 'targets', 'timestamp'], `${context} roles`);
  for (const roleName of ['root', 'snapshot', 'targets', 'timestamp']) {
    const role = signed.roles[roleName];
    validateTufRole(role, `${context} role ${roleName}`);
    for (const keyId of role.keyids) {
      assert(Object.hasOwn(signed.keys, keyId),
        `${context} role ${roleName} references unknown key ${keyId}`);
    }
  }
  for (const extension of ['x-tuf-on-ci-expiry-period', 'x-tuf-on-ci-signing-period']) {
    if (Object.hasOwn(signed, extension)) {
      exactBoundedPositiveInteger(signed[extension], 36500, `${context} ${extension}`);
    }
  }
  return signed;
}

function verifyTufThreshold(envelope, trustedRootSigned, roleName, context) {
  const role = trustedRootSigned.roles[roleName];
  assert(role, `${context} trusted root is missing role ${roleName}`);
  const authorized = new Set(role.keyids);
  const signedBytes = canonicalTufSignedBytes(envelope.signed);
  const verifiedKeyMaterials = new Set();
  for (const signature of envelope.signatures) {
    if (!authorized.has(signature.keyid)) continue;
    const key = trustedRootSigned.keys[signature.keyid];
    assert(key, `${context} authorized key ${signature.keyid} is absent from root`);
    let publicKey;
    try {
      publicKey = NATIVE_CRYPTO_CREATE_PUBLIC_KEY(key.keyval.public);
    } catch (error) {
      fail(`${context} authorized key ${signature.keyid} cannot be parsed: ${error.message}`);
    }
    let valid = false;
    try {
      const algorithm = key.scheme === 'ed25519' ? null : 'sha256';
      valid = NATIVE_CRYPTO_VERIFY(algorithm, signedBytes, publicKey,
        Buffer.from(signature.sig, 'hex'));
    } catch (error) {
      fail(`${context} signature verification errored: ${error.message}`);
    }
    if (valid) {
      verifiedKeyMaterials.add(hashCanonical(NATIVE_KEY_OBJECT_EXPORT.call(publicKey, { format: 'jwk' })));
    }
  }
  const verifiedCount = verifiedKeyMaterials.size;
  assert(verifiedCount >= role.threshold,
    `${context} has ${verifiedCount} valid ${roleName} signatures; threshold is ${role.threshold}`);
  return verifiedCount;
}

function validateMetaDescriptor(descriptor, context) {
  assertAllowedKeys(descriptor, ['version'], ['hashes', 'length'], context);
  exactBoundedPositiveInteger(descriptor.version, Number.MAX_SAFE_INTEGER, `${context} version`);
  if (Object.hasOwn(descriptor, 'length')) {
    exactBoundedPositiveInteger(descriptor.length, MAX_TUF_METADATA_BYTES, `${context} length`);
  }
  if (Object.hasOwn(descriptor, 'hashes')) {
    assertAllowedKeys(descriptor.hashes, [], ['sha256', 'sha512'], `${context} hashes`);
    assert(Object.keys(descriptor.hashes).length >= 1, `${context} hashes cannot be empty`);
    if (Object.hasOwn(descriptor.hashes, 'sha256')) {
      assert(exactSha(descriptor.hashes.sha256), `${context} SHA-256 is invalid`);
    }
    if (Object.hasOwn(descriptor.hashes, 'sha512')) {
      assert(exactSha(descriptor.hashes.sha512, 128), `${context} SHA-512 is invalid`);
    }
  }
}

function verifyDescriptorAgainstEvidence(descriptor, evidence, context) {
  if (Object.hasOwn(descriptor, 'length')) {
    assert(descriptor.length === evidence.bytesLength, `${context} length mix-and-match detected`);
  }
  if (descriptor.hashes && descriptor.hashes.sha256) {
    assert(descriptor.hashes.sha256 === evidence.sha256,
      `${context} SHA-256 mix-and-match detected`);
  }
  if (descriptor.hashes && descriptor.hashes.sha512) {
    const digest = crypto.createHash('sha512').update(evidence.bytes).digest('hex');
    assert(descriptor.hashes.sha512 === digest, `${context} SHA-512 mix-and-match detected`);
  }
}

function validateTufTimestampEnvelope(envelope, context) {
  validateTufEnvelope(envelope, context);
  validateCommonTufSigned(envelope.signed, 'timestamp', ['meta'], [], `${context} signed`);
  assertExactKeys(envelope.signed.meta, ['snapshot.json'], `${context} metadata map`);
  validateMetaDescriptor(envelope.signed.meta['snapshot.json'], `${context} snapshot descriptor`);
  return envelope.signed;
}

function validateTufSnapshotEnvelope(envelope, context) {
  validateTufEnvelope(envelope, context);
  validateCommonTufSigned(envelope.signed, 'snapshot', ['meta'], [], `${context} signed`);
  assert(isPlainObject(envelope.signed.meta), `${context} metadata map must be an object`);
  const names = Object.keys(envelope.signed.meta).sort();
  assert(names.length >= 1 && names.length <= 64 && names.includes('targets.json'),
    `${context} metadata map must contain targets.json and at most 64 entries`);
  for (const name of names) {
    assert(/^[A-Za-z0-9._-]{1,128}\.json$/.test(name),
      `${context} metadata name ${name} is not a safe top-level JSON name`);
    validateMetaDescriptor(envelope.signed.meta[name], `${context} descriptor ${name}`);
  }
  return envelope.signed;
}

function validateTufDelegations(delegations, context) {
  assertExactKeys(delegations, ['keys', 'roles'], context);
  assert(isPlainObject(delegations.keys), `${context} keys must be an object`);
  const keyIds = Object.keys(delegations.keys).sort();
  assert(keyIds.length >= 1 && keyIds.length <= MAX_TUF_KEYS,
    `${context} key count is invalid`);
  for (const keyId of keyIds) {
    assert(exactSha(keyId), `${context} key ID ${keyId} is invalid`);
    validateTufKey(delegations.keys[keyId], `${context} key ${keyId}`);
  }
  assert(Array.isArray(delegations.roles) && delegations.roles.length >= 1
    && delegations.roles.length <= 64, `${context} roles array is invalid`);
  const names = new Set();
  for (let index = 0; index < delegations.roles.length; index += 1) {
    const role = delegations.roles[index];
    assertAllowedKeys(role, ['keyids', 'name', 'terminating', 'threshold'],
      ['paths', 'path_hash_prefixes'], `${context} role ${index}`);
    assert(typeof role.name === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(role.name)
      && !names.has(role.name), `${context} role ${index} name is invalid or duplicate`);
    names.add(role.name);
    assert(role.terminating === true || role.terminating === false,
      `${context} role ${role.name} terminating flag is invalid`);
    assert(Array.isArray(role.keyids) && role.keyids.length >= 1
      && role.keyids.length <= MAX_TUF_KEYS && new Set(role.keyids).size === role.keyids.length,
    `${context} role ${role.name} key IDs are invalid`);
    for (const keyId of role.keyids) {
      assert(exactSha(keyId) && Object.hasOwn(delegations.keys, keyId),
        `${context} role ${role.name} references unknown key ${keyId}`);
    }
    exactBoundedPositiveInteger(role.threshold, role.keyids.length,
      `${context} role ${role.name} threshold`);
    const hasPaths = Object.hasOwn(role, 'paths');
    const hasPrefixes = Object.hasOwn(role, 'path_hash_prefixes');
    assert(hasPaths !== hasPrefixes,
      `${context} role ${role.name} must have exactly one path selector kind`);
    const selectors = hasPaths ? role.paths : role.path_hash_prefixes;
    assert(Array.isArray(selectors) && selectors.length >= 1 && selectors.length <= 128
      && new Set(selectors).size === selectors.length
      && selectors.every(value => typeof value === 'string' && value.length >= 1
        && value.length <= 512), `${context} role ${role.name} path selectors are invalid`);
  }
}

function validateTargetDescriptor(descriptor, context) {
  assertAllowedKeys(descriptor, ['hashes', 'length'], ['custom'], context);
  exactBoundedPositiveInteger(descriptor.length, MAX_TRUSTED_ROOT_BYTES, `${context} length`);
  assertExactKeys(descriptor.hashes, ['sha256'], `${context} hashes`);
  assert(exactSha(descriptor.hashes.sha256), `${context} SHA-256 is invalid`);
  if (Object.hasOwn(descriptor, 'custom')) {
    // Custom target metadata has no authority in this verifier. It is still
    // required to be ordinary bounded JSON so no hidden claims are consumed.
    canonicalTufSignedBytes(descriptor.custom);
  }
}

function validateTufTargetsEnvelope(envelope, context) {
  validateTufEnvelope(envelope, context);
  validateCommonTufSigned(envelope.signed, 'targets', ['targets'],
    ['delegations', 'x-tuf-on-ci-expiry-period', 'x-tuf-on-ci-signing-period'],
    `${context} signed`);
  assert(isPlainObject(envelope.signed.targets), `${context} targets map must be an object`);
  const names = Object.keys(envelope.signed.targets).sort();
  assert(names.length >= 1 && names.length <= MAX_TUF_TARGETS,
    `${context} target count is invalid`);
  for (const name of names) {
    assert(typeof name === 'string' && name.length >= 1 && name.length <= 512
      && !name.includes('\\') && !name.startsWith('/')
      && !name.split('/').some(part => part === '' || part === '.' || part === '..'),
    `${context} target name ${name} is unsafe`);
    validateTargetDescriptor(envelope.signed.targets[name], `${context} target ${name}`);
  }
  if (Object.hasOwn(envelope.signed, 'delegations')) {
    validateTufDelegations(envelope.signed.delegations, `${context} delegations`);
  }
  for (const extension of ['x-tuf-on-ci-expiry-period', 'x-tuf-on-ci-signing-period']) {
    if (Object.hasOwn(envelope.signed, extension)) {
      exactBoundedPositiveInteger(envelope.signed[extension], 36500,
        `${context} ${extension}`);
    }
  }
  return envelope.signed;
}

function validateRollbackFloor(floor, context) {
  assertExactKeys(floor,
    ['root', 'snapshot', 'snapshotMetaVersions', 'targets', 'timestamp'], context);
  for (const roleName of ['root', 'timestamp', 'snapshot', 'targets']) {
    assertExactKeys(floor[roleName], ['sha256', 'version'], `${context} ${roleName}`);
    exactBoundedPositiveInteger(floor[roleName].version, Number.MAX_SAFE_INTEGER,
      `${context} ${roleName} version`);
    assert(exactSha(floor[roleName].sha256), `${context} ${roleName} SHA-256 is invalid`);
  }
  assert(isPlainObject(floor.snapshotMetaVersions),
    `${context} snapshot metadata versions must be an object`);
  const names = Object.keys(floor.snapshotMetaVersions).sort();
  assert(names.length >= 1 && names.length <= 64 && names.includes('targets.json'),
    `${context} snapshot metadata floor must include targets.json`);
  for (const name of names) {
    assert(/^[A-Za-z0-9._-]{1,128}\.json$/.test(name),
      `${context} snapshot metadata floor name ${name} is invalid`);
    exactBoundedPositiveInteger(floor.snapshotMetaVersions[name], Number.MAX_SAFE_INTEGER,
      `${context} snapshot metadata floor ${name}`);
  }
}

function assertNoRollback(actualVersion, actualSha256, floor, context) {
  assert(actualVersion >= floor.version,
    `${context} rollback detected: ${actualVersion} is below ${floor.version}`);
  if (actualVersion === floor.version) {
    assert(actualSha256 === floor.sha256,
      `${context} same-version equivocation detected`);
  }
}

function validateSelectedTrustedRootReference(selected, context) {
  assertExactKeys(selected, ['jsonlBytes', 'jsonlEntryIndex', 'jsonlPath', 'jsonlSha256',
    'targetName', 'targetReference'], context);
  assert(selected.targetName === TUF_TRUSTED_ROOT_TARGET_NAME,
    `${context} target name must be ${TUF_TRUSTED_ROOT_TARGET_NAME}`);
  validateContentReference(selected.targetReference, `${context} target reference`);
  assert(selected.targetReference.path
    === `freeze/tuf/targets/${selected.targetReference.sha256}.trusted_root.json`,
  `${context} target path is not content-addressed by its SHA-256`);
  assert(selected.jsonlPath
    === `freeze/tuf/trusted-root-jsonl/${selected.jsonlSha256}.trusted_root.jsonl`,
  `${context} JSONL path is not content-addressed by its SHA-256`);
  exactBoundedPositiveInteger(selected.jsonlBytes, MAX_TRUSTED_ROOT_BYTES,
    `${context} JSONL bytes`);
  assert(exactSha(selected.jsonlSha256), `${context} JSONL SHA-256 is invalid`);
  assert(Number.isSafeInteger(selected.jsonlEntryIndex) && selected.jsonlEntryIndex >= 0
    && selected.jsonlEntryIndex < 32, `${context} JSONL entry index is invalid`);
}

function validateSelectedLog(log, context) {
  assertExactKeys(log, ['baseUrl', 'logIdKeyId', 'publicKeySha256', 'validFromUtc',
    'validUntilUtc'], context);
  assert(typeof log.baseUrl === 'string' && /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(log.baseUrl),
    `${context} base URL is invalid`);
  exactBase64(log.logIdKeyId, `${context} log ID`);
  assert(exactSha(log.publicKeySha256), `${context} public key SHA-256 is invalid`);
  exactTufUtc(log.validFromUtc, `${context} validity start`);
  if (log.validUntilUtc !== null) exactTufUtc(log.validUntilUtc, `${context} validity end`);
  if (log.validUntilUtc !== null) {
    assert(Date.parse(log.validUntilUtc) > Date.parse(log.validFromUtc),
      `${context} validity interval is empty`);
  }
}

function selectionReceiptSelfHash(receipt) {
  const withoutHash = Object.create(null);
  for (const key of Object.keys(receipt).sort()) {
    if (key !== 'receiptSha256') Object.defineProperty(withoutHash, key,
      { value: receipt[key], enumerable: true });
  }
  return hashCanonical(withoutHash);
}

function validateTufSelectionReceipt(receipt, purpose, expectedPath, context) {
  assertExactKeys(receipt, ['bootstrapRoot', 'lockboxId', 'purpose', 'receiptSha256',
    'rootChain', 'schema', 'selectedTransparencyLog', 'selectedTrustedRoot', 'selectionTimeUtc',
    'snapshot', 'status', 'targets', 'timestamp', 'versions'], context);
  assert(receipt.schema === TUF_SELECTION_RECEIPT_SCHEMA
    && receipt.status === TUF_SELECTION_RECEIPT_STATUS,
  `${context} schema/status is invalid`);
  assert(receipt.purpose === purpose, `${context} purpose is invalid`);
  exactTufUtc(receipt.selectionTimeUtc, `${context} selection time`);
  assert(typeof receipt.lockboxId === 'string' && receipt.lockboxId.length >= 1
    && receipt.lockboxId.length <= 128, `${context} lockbox ID is invalid`);
  validateFileReference(receipt.bootstrapRoot, `${context} bootstrap root`);
  assert(Array.isArray(receipt.rootChain) && receipt.rootChain.length <= MAX_TUF_ROOT_ROTATIONS,
    `${context} root chain is too long`);
  for (let index = 0; index < receipt.rootChain.length; index += 1) {
    validateFileReference(receipt.rootChain[index], `${context} root chain ${index}`);
  }
  validateFileReference(receipt.timestamp, `${context} timestamp`);
  validateFileReference(receipt.snapshot, `${context} snapshot`);
  validateFileReference(receipt.targets, `${context} targets`);
  validateSelectedTrustedRootReference(receipt.selectedTrustedRoot,
    `${context} selected trusted root`);
  validateSelectedLog(receipt.selectedTransparencyLog, `${context} selected log`);
  assertExactKeys(receipt.versions,
    ['root', 'snapshot', 'snapshotMetaVersions', 'targets', 'timestamp'], `${context} versions`);
  for (const roleName of ['root', 'timestamp', 'snapshot', 'targets']) {
    exactBoundedPositiveInteger(receipt.versions[roleName], Number.MAX_SAFE_INTEGER,
      `${context} ${roleName} version`);
  }
  assert(isPlainObject(receipt.versions.snapshotMetaVersions),
    `${context} snapshot metadata versions must be an object`);
  const names = Object.keys(receipt.versions.snapshotMetaVersions).sort();
  assert(names.length >= 1 && names.length <= 64 && names.includes('targets.json'),
    `${context} snapshot metadata versions must include targets.json`);
  for (const name of names) {
    assert(/^[A-Za-z0-9._-]{1,128}\.json$/.test(name),
      `${context} snapshot metadata name ${name} is invalid`);
    exactBoundedPositiveInteger(receipt.versions.snapshotMetaVersions[name],
      Number.MAX_SAFE_INTEGER, `${context} snapshot metadata version ${name}`);
  }
  assert(exactSha(receipt.receiptSha256)
    && receipt.receiptSha256 === selectionReceiptSelfHash(receipt),
  `${context} self-hash is invalid`);
  assert(typeof expectedPath === 'string', `${context} expected path is invalid`);
}

function parseCompactTrustedRootJsonl(bytes, context) {
  const text = strictJsonText(bytes, context);
  assert(text.endsWith('\n') && !text.includes('\r'),
    `${context} must use exact LF termination without CR bytes`);
  const lines = text.slice(0, -1).split('\n');
  assert(lines.length >= 1 && lines.length <= 32 && lines.every(line => line.length >= 2),
    `${context} entry count or blank-line structure is invalid`);
  const values = [];
  for (let index = 0; index < lines.length; index += 1) {
    const value = parseStrictJsonBytes(Buffer.from(lines[index], 'utf8'),
      `${context} line ${index + 1}`);
    assert(isPlainObject(value), `${context} line ${index + 1} must be an object`);
    assert(NATIVE_JSON_STRINGIFY(value) === lines[index],
      `${context} line ${index + 1} is not exact compact JSON`);
    values.push(value);
  }
  return values;
}

function validateTrustedRootTlog(log, context) {
  assertAllowedKeys(log, ['baseUrl', 'hashAlgorithm', 'logId', 'publicKey'], ['operator'], context);
  assert(typeof log.baseUrl === 'string' && /^https:\/\/[A-Za-z0-9.-]+(?::\d+)?$/.test(log.baseUrl),
    `${context} base URL is invalid`);
  assert(log.hashAlgorithm === 'SHA2_256', `${context} hash algorithm is unsupported`);
  assertExactKeys(log.logId, ['keyId'], `${context} log ID`);
  const logIdBytes = exactBase64(log.logId.keyId, `${context} log ID key ID`);
  assert(logIdBytes.length === 32, `${context} log ID must be 32 bytes`);
  assertExactKeys(log.publicKey, ['keyDetails', 'rawBytes', 'validFor'], `${context} public key`);
  assert(['PKIX_ECDSA_P256_SHA_256', 'PKIX_ED25519'].includes(log.publicKey.keyDetails),
    `${context} public key details are unsupported`);
  const publicKeyBytes = exactBase64(log.publicKey.rawBytes, `${context} public key bytes`);
  assert(publicKeyBytes.length >= 32 && publicKeyBytes.length <= 4096,
    `${context} public key byte length is invalid`);
  try {
    NATIVE_CRYPTO_CREATE_PUBLIC_KEY({ key: publicKeyBytes, type: 'spki', format: 'der' });
  } catch (error) {
    fail(`${context} public key DER cannot be parsed: ${error.message}`);
  }
  assert(crypto.createHash('sha256').update(publicKeyBytes).digest('base64') === log.logId.keyId,
    `${context} log ID is not the SHA-256 of the exact public key DER`);
  assertAllowedKeys(log.publicKey.validFor, ['start'], ['end'], `${context} validity`);
  exactTufUtc(log.publicKey.validFor.start, `${context} validity start`);
  if (Object.hasOwn(log.publicKey.validFor, 'end')) {
    exactTufUtc(log.publicKey.validFor.end, `${context} validity end`);
    assert(Date.parse(log.publicKey.validFor.end) > Date.parse(log.publicKey.validFor.start),
      `${context} validity interval is empty`);
  }
  if (Object.hasOwn(log, 'operator')) {
    assert(typeof log.operator === 'string' && log.operator.length >= 1 && log.operator.length <= 128,
      `${context} operator is invalid`);
  }
  return {
    baseUrl: log.baseUrl,
    logIdKeyId: log.logId.keyId,
    publicKeySha256: sha256(publicKeyBytes),
    validFromUtc: log.publicKey.validFor.start,
    validUntilUtc: Object.hasOwn(log.publicKey.validFor, 'end') ? log.publicKey.validFor.end : null,
  };
}

function selectTransparencyLogFromTrustedRoot(trustedRoot, selected, integrationTimeUtc, context) {
  assertExactKeys(trustedRoot,
    ['certificateAuthorities', 'ctlogs', 'mediaType', 'timestampAuthorities', 'tlogs'], context);
  assert(trustedRoot.mediaType === 'application/vnd.dev.sigstore.trustedroot+json;version=0.1',
    `${context} media type is not the frozen trusted-root v0.1 schema`);
  for (const field of ['certificateAuthorities', 'ctlogs', 'timestampAuthorities']) {
    assert(Array.isArray(trustedRoot[field]) && trustedRoot[field].length <= 64,
      `${context} ${field} must be a bounded array`);
    canonicalTufSignedBytes(trustedRoot[field]);
  }
  assert(Array.isArray(trustedRoot.tlogs) && trustedRoot.tlogs.length >= 1
    && trustedRoot.tlogs.length <= 64, `${context} transparency logs are invalid`);
  const matches = [];
  for (let index = 0; index < trustedRoot.tlogs.length; index += 1) {
    const projection = validateTrustedRootTlog(trustedRoot.tlogs[index], `${context} tlog ${index}`);
    if (projection.logIdKeyId === selected.logIdKeyId
      && projection.publicKeySha256 === selected.publicKeySha256
      && projection.baseUrl === selected.baseUrl) matches.push(projection);
  }
  assert(matches.length === 1,
    `${context} must contain exactly one selected transparency-log ID/key/URL tuple`);
  const projection = matches[0];
  assert(projection.validFromUtc === selected.validFromUtc
    && projection.validUntilUtc === selected.validUntilUtc,
  `${context} selected transparency-log validity differs from trusted material`);
  const integrationMs = exactTufUtc(integrationTimeUtc, `${context} log integration time`);
  assert(integrationMs >= Date.parse(projection.validFromUtc),
    `${context} selected transparency-log key was not yet valid`);
  if (projection.validUntilUtc !== null) {
    assert(integrationMs < Date.parse(projection.validUntilUtc),
      `${context} selected transparency-log key was expired`);
  }
  return projection;
}

function parseTufEvidence(evidence, expectedType, context) {
  const envelope = parseStrictJsonBytes(evidence.bytes, context);
  if (expectedType === 'root') validateTufRootEnvelope(envelope, context);
  else if (expectedType === 'timestamp') validateTufTimestampEnvelope(envelope, context);
  else if (expectedType === 'snapshot') validateTufSnapshotEnvelope(envelope, context);
  else if (expectedType === 'targets') validateTufTargetsEnvelope(envelope, context);
  else fail(`${context} requested unsupported TUF role ${expectedType}`);
  return envelope;
}

function validateTufReplayPolicy(policy, bootstrapPin) {
  assertExactKeys(policy, ['bundleSha256', 'currentPolicyTimeUtc', 'currentRollbackFloor',
    'currentSelectionReceipt', 'decisionDate', 'decisionSha256', 'eventRollbackFloor',
    'eventTimeUtc', 'lockboxId', 'schema'], 'TUF replay policy');
  assert(policy.schema === TUF_REPLAY_POLICY_SCHEMA, 'TUF replay policy schema is invalid');
  assert(typeof policy.lockboxId === 'string' && policy.lockboxId.length >= 1
    && policy.lockboxId.length <= 128, 'TUF replay policy lockbox ID is invalid');
  assert(exactDate(policy.decisionDate), 'TUF replay policy decision date is invalid');
  assert(exactSha(policy.decisionSha256), 'TUF replay policy decision SHA-256 is invalid');
  assert(exactSha(policy.bundleSha256), 'TUF replay policy bundle SHA-256 is invalid');
  const eventMs = exactTufUtc(policy.eventTimeUtc, 'TUF replay event time');
  const currentMs = exactTufUtc(policy.currentPolicyTimeUtc, 'TUF replay current-policy time');
  assert(currentMs >= eventMs, 'TUF current-policy replay cannot predate the event-time replay');
  validateRollbackFloor(policy.eventRollbackFloor, 'TUF event rollback floor');
  validateRollbackFloor(policy.currentRollbackFloor, 'TUF current rollback floor');
  for (const roleName of ['root', 'timestamp', 'snapshot', 'targets']) {
    const eventFloor = policy.eventRollbackFloor[roleName];
    const currentFloor = policy.currentRollbackFloor[roleName];
    assert(currentFloor.version >= eventFloor.version,
      `TUF current ${roleName} rollback floor predates the event-time floor`);
    if (currentFloor.version === eventFloor.version) {
      assert(currentFloor.sha256 === eventFloor.sha256,
        `TUF current ${roleName} rollback floor equivocates at the event-time version`);
    }
  }
  for (const name of Object.keys(policy.eventRollbackFloor.snapshotMetaVersions)) {
    assert(Object.hasOwn(policy.currentRollbackFloor.snapshotMetaVersions, name)
      && policy.currentRollbackFloor.snapshotMetaVersions[name]
        >= policy.eventRollbackFloor.snapshotMetaVersions[name],
    `TUF current snapshot metadata floor rolled back or removed ${name}`);
  }
  validateDigestReference(policy.currentSelectionReceipt, 'TUF current selection receipt');
  assert(policy.currentSelectionReceipt.path
    === currentTufSelectionRelativePath(policy.decisionDate, policy.currentPolicyTimeUtc),
  'TUF current selection receipt path is not the exact frozen replay path');
  assertExactKeys(bootstrapPin, ['bytes', 'relativePath', 'sha256', 'version'],
    'TUF bootstrap pin');
  validateFileReference({ bytes: bootstrapPin.bytes, path: bootstrapPin.relativePath,
    sha256: bootstrapPin.sha256, version: bootstrapPin.version }, 'TUF bootstrap pin');
  return policy;
}

function validateDecisionTufBinding(decision, decisionEvidence, policy, bootstrapPin) {
  assert(isPlainObject(decision) && decision.schema === DECISION_SCHEMA
    && decision.status === DECISION_STATUS, 'TUF-bound decision schema/status is invalid');
  assert(decision.lockboxId === policy.lockboxId && decision.decisionDate === policy.decisionDate,
    'TUF-bound decision identity differs from replay policy');
  assert(exactUtc(decision.signalKnownAtUtc), 'TUF-bound decision signal-known time is invalid');
  assert(decisionEvidence.sha256 === policy.decisionSha256,
    'TUF-bound decision SHA-256 differs from replay policy');
  const binding = decision.tufTrustSelection;
  assertExactKeys(binding, ['bootstrapRootSha256', 'eventSelectionReceiptPath',
    'eventSelectionReceiptSha256', 'schema', 'selectedLogBaseUrl', 'selectedLogIdKeyId',
    'selectedLogPublicKeySha256', 'trustedRootJsonlPath', 'trustedRootJsonlSha256'],
  'decision TUF trust selection');
  assert(binding.schema === TUF_TRUST_BINDING_SCHEMA,
    'decision TUF trust-selection schema is invalid');
  assert(binding.bootstrapRootSha256 === bootstrapPin.sha256,
    'decision TUF bootstrap SHA-256 is not the frozen Sigstore bootstrap');
  assert(binding.eventSelectionReceiptPath === eventTufSelectionRelativePath(policy.decisionDate),
    'decision TUF event selection receipt path is invalid');
  assert(exactSha(binding.eventSelectionReceiptSha256),
    'decision TUF event selection receipt SHA-256 is invalid');
  assert(exactSha(binding.trustedRootJsonlSha256)
    && binding.trustedRootJsonlPath
      === `freeze/tuf/trusted-root-jsonl/${binding.trustedRootJsonlSha256}.trusted_root.jsonl`,
  'decision trusted-root JSONL binding is invalid');
  validateSelectedLog({
    baseUrl: binding.selectedLogBaseUrl,
    logIdKeyId: binding.selectedLogIdKeyId,
    publicKeySha256: binding.selectedLogPublicKeySha256,
    validFromUtc: '1970-01-01T00:00:00Z',
    validUntilUtc: null,
  }, 'decision selected transparency log identity');
  return binding;
}

function verifyTufSelectionReceiptEvidence({ lockboxRoot, receiptReference, purpose,
  verificationTimeUtc, logIntegrationTimeUtc, rollbackFloor, bootstrapPin, expectedLockboxId,
  expectedPath, expectedLogIdentity, evidenceReader }) {
  validateDigestReference(receiptReference, `${purpose} selection receipt reference`);
  assert(receiptReference.path === expectedPath,
    `${purpose} selection receipt path is not the exact frozen path`);
  const receiptEvidence = evidenceReader(receiptReference.path,
    MAX_TUF_SELECTION_RECEIPT_BYTES, `${purpose} TUF selection receipt`);
  assert(receiptEvidence.sha256 === receiptReference.sha256,
    `${purpose} selection receipt SHA-256 differs from its immutable binding`);
  const receipt = parseStrictJsonBytes(receiptEvidence.bytes, `${purpose} TUF selection receipt`);
  assert(receiptEvidence.bytes.equals(canonicalBytes(receipt)),
    `${purpose} TUF selection receipt is not exact canonical LF JSON`);
  validateTufSelectionReceipt(receipt, purpose, expectedPath, `${purpose} TUF selection receipt`);
  assert(receipt.lockboxId === expectedLockboxId,
    `${purpose} TUF selection receipt lockbox ID differs`);

  const pinReference = { bytes: bootstrapPin.bytes, path: bootstrapPin.relativePath,
    sha256: bootstrapPin.sha256, version: bootstrapPin.version };
  equalCanonical(receipt.bootstrapRoot, pinReference,
    `${purpose} selection receipt and frozen bootstrap pin`);
  const bootstrapEvidence = evidenceReader(bootstrapPin.relativePath, MAX_TUF_METADATA_BYTES,
    `${purpose} TUF bootstrap root`);
  assert(bootstrapEvidence.bytesLength === bootstrapPin.bytes
    && bootstrapEvidence.sha256 === bootstrapPin.sha256,
  `${purpose} TUF bootstrap bytes differ from the frozen external pin`);
  let trustedRootEnvelope = parseTufEvidence(bootstrapEvidence, 'root',
    `${purpose} TUF bootstrap root`);
  assert(trustedRootEnvelope.signed.version === bootstrapPin.version,
    `${purpose} TUF bootstrap version differs from its frozen pin`);
  verifyTufThreshold(trustedRootEnvelope, trustedRootEnvelope.signed, 'root',
    `${purpose} TUF bootstrap self-signature`);
  let trustedRootEvidence = bootstrapEvidence;
  let expectedRootVersion = bootstrapPin.version + 1;
  for (let index = 0; index < receipt.rootChain.length; index += 1) {
    const reference = receipt.rootChain[index];
    assert(reference.version === expectedRootVersion,
      `${purpose} TUF root rotation is not sequential at version ${reference.version}`);
    assert(reference.path === rootHistoryRelativePath(reference.version),
      `${purpose} TUF root rotation path is not the exact versioned history path`);
    const evidence = evidenceReader(reference.path, MAX_TUF_METADATA_BYTES,
      `${purpose} TUF root ${reference.version}`);
    assert(evidence.bytesLength === reference.bytes && evidence.sha256 === reference.sha256,
      `${purpose} TUF root ${reference.version} differs from its selection receipt`);
    const candidate = parseTufEvidence(evidence, 'root',
      `${purpose} TUF root ${reference.version}`);
    assert(candidate.signed.version === reference.version,
      `${purpose} TUF root filename/receipt/body version mix-and-match detected`);
    verifyTufThreshold(candidate, trustedRootEnvelope.signed, 'root',
      `${purpose} TUF root ${reference.version} old-root authorization`);
    verifyTufThreshold(candidate, candidate.signed, 'root',
      `${purpose} TUF root ${reference.version} new-root self-authorization`);
    trustedRootEnvelope = candidate;
    trustedRootEvidence = evidence;
    expectedRootVersion += 1;
  }
  const verificationMs = exactTufUtc(verificationTimeUtc, `${purpose} TUF verification time`);
  assert(Date.parse(trustedRootEnvelope.signed.expires) > verificationMs,
    `${purpose} TUF final root is expired (freeze attack)`);
  assert(receipt.versions.root === trustedRootEnvelope.signed.version,
    `${purpose} TUF receipt root version differs from verified root`);
  assertNoRollback(trustedRootEnvelope.signed.version, trustedRootEvidence.sha256,
    rollbackFloor.root, `${purpose} TUF root`);

  assert(receipt.timestamp.path === timestampRelativePath(receipt.timestamp.version),
    `${purpose} TUF timestamp path is not exact and version-addressed`);
  const timestampEvidence = evidenceReader(receipt.timestamp.path, MAX_TUF_METADATA_BYTES,
    `${purpose} TUF timestamp`);
  assert(timestampEvidence.bytesLength === receipt.timestamp.bytes
    && timestampEvidence.sha256 === receipt.timestamp.sha256,
  `${purpose} TUF timestamp differs from its selection receipt`);
  const timestampEnvelope = parseTufEvidence(timestampEvidence, 'timestamp',
    `${purpose} TUF timestamp`);
  verifyTufThreshold(timestampEnvelope, trustedRootEnvelope.signed, 'timestamp',
    `${purpose} TUF timestamp authorization`);
  assert(timestampEnvelope.signed.version === receipt.timestamp.version
    && receipt.versions.timestamp === receipt.timestamp.version,
  `${purpose} TUF timestamp version mix-and-match detected`);
  assert(Date.parse(timestampEnvelope.signed.expires) > verificationMs,
    `${purpose} TUF timestamp is expired (freeze attack)`);
  assertNoRollback(timestampEnvelope.signed.version, timestampEvidence.sha256,
    rollbackFloor.timestamp, `${purpose} TUF timestamp`);

  assert(receipt.snapshot.path === snapshotRelativePath(receipt.snapshot.version),
    `${purpose} TUF snapshot path is not exact and version-addressed`);
  const snapshotEvidence = evidenceReader(receipt.snapshot.path, MAX_TUF_METADATA_BYTES,
    `${purpose} TUF snapshot`);
  assert(snapshotEvidence.bytesLength === receipt.snapshot.bytes
    && snapshotEvidence.sha256 === receipt.snapshot.sha256,
  `${purpose} TUF snapshot differs from its selection receipt`);
  const timestampSnapshot = timestampEnvelope.signed.meta['snapshot.json'];
  verifyDescriptorAgainstEvidence(timestampSnapshot, snapshotEvidence,
    `${purpose} timestamp-to-snapshot`);
  const snapshotEnvelope = parseTufEvidence(snapshotEvidence, 'snapshot',
    `${purpose} TUF snapshot`);
  verifyTufThreshold(snapshotEnvelope, trustedRootEnvelope.signed, 'snapshot',
    `${purpose} TUF snapshot authorization`);
  assert(snapshotEnvelope.signed.version === timestampSnapshot.version
    && snapshotEnvelope.signed.version === receipt.snapshot.version
    && receipt.versions.snapshot === receipt.snapshot.version,
  `${purpose} TUF snapshot version mix-and-match detected`);
  assert(Date.parse(snapshotEnvelope.signed.expires) > verificationMs,
    `${purpose} TUF snapshot is expired (freeze attack)`);
  assertNoRollback(snapshotEnvelope.signed.version, snapshotEvidence.sha256,
    rollbackFloor.snapshot, `${purpose} TUF snapshot`);

  const actualMetaVersions = Object.create(null);
  for (const name of Object.keys(snapshotEnvelope.signed.meta).sort()) {
    Object.defineProperty(actualMetaVersions, name,
      { value: snapshotEnvelope.signed.meta[name].version, enumerable: true });
  }
  equalCanonical(receipt.versions.snapshotMetaVersions, actualMetaVersions,
    `${purpose} TUF receipt and snapshot metadata version map`);
  for (const name of Object.keys(rollbackFloor.snapshotMetaVersions)) {
    assert(Object.hasOwn(actualMetaVersions, name),
      `${purpose} TUF snapshot removed previously trusted metadata ${name}`);
    assert(actualMetaVersions[name] >= rollbackFloor.snapshotMetaVersions[name],
      `${purpose} TUF snapshot metadata ${name} rolled back`);
  }

  assert(receipt.targets.path === targetsRelativePath(receipt.targets.version),
    `${purpose} TUF targets path is not exact and version-addressed`);
  const targetsEvidence = evidenceReader(receipt.targets.path, MAX_TUF_METADATA_BYTES,
    `${purpose} TUF targets`);
  assert(targetsEvidence.bytesLength === receipt.targets.bytes
    && targetsEvidence.sha256 === receipt.targets.sha256,
  `${purpose} TUF targets differs from its selection receipt`);
  const snapshotTargets = snapshotEnvelope.signed.meta['targets.json'];
  verifyDescriptorAgainstEvidence(snapshotTargets, targetsEvidence,
    `${purpose} snapshot-to-targets`);
  const targetsEnvelope = parseTufEvidence(targetsEvidence, 'targets',
    `${purpose} TUF targets`);
  verifyTufThreshold(targetsEnvelope, trustedRootEnvelope.signed, 'targets',
    `${purpose} TUF targets authorization`);
  assert(targetsEnvelope.signed.version === snapshotTargets.version
    && targetsEnvelope.signed.version === receipt.targets.version
    && receipt.versions.targets === receipt.targets.version,
  `${purpose} TUF targets version mix-and-match detected`);
  assert(Date.parse(targetsEnvelope.signed.expires) > verificationMs,
    `${purpose} TUF targets is expired (freeze attack)`);
  assertNoRollback(targetsEnvelope.signed.version, targetsEvidence.sha256,
    rollbackFloor.targets, `${purpose} TUF targets`);

  const selected = receipt.selectedTrustedRoot;
  const targetDescriptor = targetsEnvelope.signed.targets[selected.targetName];
  assert(targetDescriptor, `${purpose} TUF targets does not authorize trusted_root.json`);
  const targetEvidence = evidenceReader(selected.targetReference.path, MAX_TRUSTED_ROOT_BYTES,
    `${purpose} TUF selected trusted-root target`);
  assert(targetEvidence.bytesLength === selected.targetReference.bytes
    && targetEvidence.sha256 === selected.targetReference.sha256,
  `${purpose} selected trusted-root target differs from its selection receipt`);
  assert(targetDescriptor.length === targetEvidence.bytesLength
    && targetDescriptor.hashes.sha256 === targetEvidence.sha256,
  `${purpose} selected trusted-root target mix-and-match detected`);
  const targetValue = parseStrictJsonBytes(targetEvidence.bytes,
    `${purpose} selected trusted-root target`);

  const jsonlEvidence = evidenceReader(selected.jsonlPath, MAX_TRUSTED_ROOT_BYTES,
    `${purpose} compact trusted-root JSONL`);
  assert(jsonlEvidence.bytesLength === selected.jsonlBytes
    && jsonlEvidence.sha256 === selected.jsonlSha256,
  `${purpose} compact trusted-root JSONL differs from its selection receipt`);
  const jsonlValues = parseCompactTrustedRootJsonl(jsonlEvidence.bytes,
    `${purpose} compact trusted-root JSONL`);
  assert(selected.jsonlEntryIndex < jsonlValues.length,
    `${purpose} compact trusted-root JSONL entry index is out of range`);
  equalCanonical(jsonlValues[selected.jsonlEntryIndex], targetValue,
    `${purpose} TUF target and selected compact trusted-root JSONL entry`);
  const selectedLog = selectTransparencyLogFromTrustedRoot(targetValue,
    receipt.selectedTransparencyLog, logIntegrationTimeUtc,
    `${purpose} authenticated trusted root`);
  assert(selectedLog.baseUrl === expectedLogIdentity.baseUrl
    && selectedLog.logIdKeyId === expectedLogIdentity.logIdKeyId
    && selectedLog.publicKeySha256 === expectedLogIdentity.publicKeySha256,
  `${purpose} authenticated log selection differs from the decision-bound log identity`);

  return deepFreeze({
    receipt,
    receiptFileSha256: receiptEvidence.sha256,
    finalRootVersion: trustedRootEnvelope.signed.version,
    timestampVersion: timestampEnvelope.signed.version,
    snapshotVersion: snapshotEnvelope.signed.version,
    targetsVersion: targetsEnvelope.signed.version,
    trustedRootTargetSha256: targetEvidence.sha256,
    trustedRootJsonlSha256: jsonlEvidence.sha256,
    selectedTransparencyLog: selectedLog,
    selectionVerifiedForOneDecisionOnly: true,
    endpointEligible: false,
  });
}

function verifyOfflineTufReplayWithBootstrap(input) {
  assertCleanPinnedNodeIntrinsics();
  const invocation = deepFreeze(canonicalize(input));
  assertExactKeys(invocation, ['bootstrapPin', 'lockboxRoot', 'policy'],
    'offline TUF replay input');
  const { lockboxRoot, policy, bootstrapPin } = invocation;
  validateTufReplayPolicy(policy, bootstrapPin);
  assert(path.isAbsolute(lockboxRoot), 'TUF replay lockbox root must be absolute');
  const cache = new Map();
  const evidenceReader = (relative, maximumBytes, context) => {
    if (cache.has(relative)) {
      const cached = cache.get(relative);
      assert(cached.bytesLength <= maximumBytes, `${context} exceeds its role byte limit`);
      return cached;
    }
    const evidence = readBoundFile(lockboxRoot, relative, maximumBytes, context);
    cache.set(relative, evidence);
    return evidence;
  };

  const decisionPath = decisionRelativePath(policy.decisionDate);
  const decisionEvidence = evidenceReader(decisionPath, MAX_DECISION_BYTES, 'TUF-bound decision');
  assert(decisionEvidence.sha256 === policy.decisionSha256,
    'TUF-bound decision SHA-256 differs from replay policy');
  const decision = parseStrictJsonBytes(decisionEvidence.bytes, 'TUF-bound decision');
  assert(decisionEvidence.bytes.equals(canonicalBytes(decision)),
    'TUF-bound decision is not exact canonical LF JSON');
  const binding = validateDecisionTufBinding(decision, decisionEvidence, policy, bootstrapPin);

  const bundlePath = bundleRelativePath(policy.decisionDate);
  const bundleEvidence = evidenceReader(bundlePath, MAX_BUNDLE_BYTES, 'TUF-bound Sigstore bundle');
  assert(bundleEvidence.sha256 === policy.bundleSha256,
    'TUF-bound Sigstore bundle SHA-256 differs from replay policy');
  parseStrictJsonBytes(bundleEvidence.bytes, 'TUF-bound Sigstore bundle');
  const parsedBundle = parseSigstoreBundle(bundleEvidence.bytes);
  assert(parsedBundle.tlog.logId.keyId === binding.selectedLogIdKeyId,
    'Sigstore bundle log ID differs from the decision-bound TUF selection');
  assert(new Date(parsedBundle.integratedTimeUnix * 1000).toISOString() === policy.eventTimeUtc,
    'TUF replay event time differs from the bundle integrated time');
  assert(parsedBundle.integratedTimeUnix
    >= Math.floor(Date.parse(decision.signalKnownAtUtc) / 1000),
  'TUF replay event time predates the decision signal-known second');
  const expectedLogIdentity = {
    baseUrl: binding.selectedLogBaseUrl,
    logIdKeyId: binding.selectedLogIdKeyId,
    publicKeySha256: binding.selectedLogPublicKeySha256,
  };

  const eventReference = {
    path: binding.eventSelectionReceiptPath,
    sha256: binding.eventSelectionReceiptSha256,
  };
  const event = verifyTufSelectionReceiptEvidence({ lockboxRoot, receiptReference: eventReference,
    purpose: 'EVENT_TIME', verificationTimeUtc: policy.eventTimeUtc,
    logIntegrationTimeUtc: policy.eventTimeUtc,
    rollbackFloor: policy.eventRollbackFloor, bootstrapPin,
    expectedLockboxId: policy.lockboxId,
    expectedPath: eventTufSelectionRelativePath(policy.decisionDate), expectedLogIdentity,
    evidenceReader });
  assert(Date.parse(event.receipt.selectionTimeUtc) <= Date.parse(decision.signalKnownAtUtc),
    'event-time TUF selection was not frozen before the decision signal was known');
  assert(event.trustedRootJsonlSha256 === binding.trustedRootJsonlSha256,
    'event-time trusted-root JSONL differs from the decision-embedded SHA-256');

  const current = verifyTufSelectionReceiptEvidence({ lockboxRoot,
    receiptReference: policy.currentSelectionReceipt, purpose: 'CURRENT_POLICY',
    verificationTimeUtc: policy.currentPolicyTimeUtc,
    logIntegrationTimeUtc: policy.eventTimeUtc,
    rollbackFloor: policy.currentRollbackFloor, bootstrapPin,
    expectedLockboxId: policy.lockboxId,
    expectedPath: currentTufSelectionRelativePath(policy.decisionDate,
      policy.currentPolicyTimeUtc), expectedLogIdentity, evidenceReader });
  assert(current.receipt.selectionTimeUtc === policy.currentPolicyTimeUtc,
    'current-policy selection receipt time differs from the frozen replay time');

  return deepFreeze({
    schema: TUF_REPLAY_POLICY_SCHEMA,
    status: TUF_OFFLINE_REPLAY_STATUS,
    lockboxId: policy.lockboxId,
    decisionDate: policy.decisionDate,
    decisionSha256: decisionEvidence.sha256,
    bundleSha256: bundleEvidence.sha256,
    event,
    current,
    offlineOnly: true,
    networkUsed: false,
    sigstoreBundleCryptographyVerifiedByThisLayer: false,
    singleDecisionTufSelectionVerified: true,
    completePerDecisionCoverageVerified: false,
    endpointTrustPolicy: { ...TUF_ENDPOINT_POLICY },
    endpointEligible: false,
  });
}

function verifyOfflineTufSelection(input) {
  assertCleanPinnedNodeIntrinsics();
  const invocation = deepFreeze(canonicalize(input));
  assertExactKeys(invocation, ['lockboxRoot', 'policy'], 'offline TUF selection input');
  const { lockboxRoot, policy } = invocation;
  const bootstrapPin = {
    version: SIGSTORE_TUF_BOOTSTRAP.version,
    relativePath: SIGSTORE_TUF_BOOTSTRAP.relativePath,
    bytes: SIGSTORE_TUF_BOOTSTRAP.bytes,
    sha256: SIGSTORE_TUF_BOOTSTRAP.sha256,
  };
  return verifyOfflineTufReplayWithBootstrap({ lockboxRoot, policy, bootstrapPin });
}

function assertEndpointAnchorPolicyReady() {
  fail(`${TUF_ENDPOINT_POLICY.status}: ${TUF_ENDPOINT_POLICY.requiredResolution}`);
}

module.exports = Object.freeze({
  ANCHOR_SCHEMA,
  ANCHOR_STATUS,
  ATTEST_ACTION,
  PINNED_GH_VERIFIER,
  LONG_HORIZON_TRUST_POLICY,
  SIGSTORE_TUF_BOOTSTRAP,
  TUF_ENDPOINT_POLICY,
  TUF_REPLAY_POLICY_SCHEMA,
  TUF_SELECTION_RECEIPT_SCHEMA,
  TUF_SELECTION_RECEIPT_STATUS,
  TUF_OFFLINE_REPLAY_STATUS,
  TUF_TRUST_BINDING_SCHEMA,
  TRUSTED_ROOT_RELATIVE_PATH,
  decisionRelativePath,
  anchorRelativePath,
  bundleRelativePath,
  canonicalBytes,
  hashCanonical,
  sidecarBytes,
  createAnchorReceipt,
  verifyAnchorReceipt,
  verifyOfflineTufSelection,
  assertEndpointAnchorPolicyReady,
  __test: Object.freeze({
    assertExactKeys,
    validatePolicy,
    validateDecision,
    parseSigstoreBundle,
    parseTrustedRoot,
    buildGhArguments,
    validateStatement,
    validateCertificate,
    validateVerifiedGhOutput,
    buildReceipt,
    validateReceiptShape,
    parseStrictJsonBytes,
    canonicalTufSignedBytes,
    validateTufRootEnvelope,
    validateTufTimestampEnvelope,
    validateTufSnapshotEnvelope,
    validateTufTargetsEnvelope,
    verifyTufThreshold,
    validateTufSelectionReceipt,
    parseCompactTrustedRootJsonl,
    selectTransparencyLogFromTrustedRoot,
    validateTufReplayPolicy,
    verifyOfflineTufReplayWithBootstrap,
    rootHistoryRelativePath,
    timestampRelativePath,
    snapshotRelativePath,
    targetsRelativePath,
    eventTufSelectionRelativePath,
    currentTufSelectionRelativePath,
  }),
});
