'use strict';

// Standalone trust boundary for the one permitted production command. Keep this
// file restricted to node: built-ins until every frozen byte has been checked.

const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const FIXED_TAG = 'component-fragility-tail-risk-v1-preoutcome';
const MANIFEST_SCHEMA = 'component-fragility-tail-risk-freeze-manifest-v1';
const MANIFEST_RELATIVE = 'research/component-fragility-tail-risk-freeze-v1.json';
const RUNNER_RELATIVE = 'research/component_fragility_tail_risk.js';
const EXPECTED_FILE_PATHS = Object.freeze([
  'research/COMPONENT_FRAGILITY_TAIL_RISK_PROTOCOL.md',
  RUNNER_RELATIVE,
  'test/component_fragility_tail_risk.test.js',
  'research/component_fragility_tail_risk_launcher.js',
  'research/FEAR_GREED_V2_VALIDATION_PROTOCOL.md',
  'research/fear_greed_v2_validation.js',
  'research/fear_greed_model_search.js',
  'marketfg.js',
  'data/config.json',
]);
const EXPECTED_FILE_KEYS = Object.freeze(['protocol', 'runner', 'tests', 'launcher', 'schema5Protocol', 'schema5Reader', 'schema4Math', 'marketEngine', 'productionConfig']);
const ATTEMPT_SCOPE = 'shared-git-common-directory';
const ATTEMPT_RELATIVE = 'codex-one-shot-research/component-fragility-tail-v1/attempt-receipt-2026-08-26.json';
const OUTPUT_DIRECTORY_RELATIVE = 'research/local-artifacts/component-fragility-tail-v1';
const PREFLIGHT_TOKEN = Symbol('component-fragility-tail-launcher-preflight');
const DIRECT_INVOCATION_TOKEN = Symbol('component-fragility-tail-direct-invocation');

class LauncherIntegrityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'LauncherIntegrityError';
    this.code = 'INTEGRITY_ERROR';
    this.details = details;
  }
}

function fail(message, details = {}) {
  throw new LauncherIntegrityError(message, details);
}

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonicalize(value[key])]));
  if (typeof value === 'number' && !Number.isFinite(value)) fail('manifest cannot contain nonfinite numbers');
  return value;
}

function canonicalJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function assertCleanDirectInvocation(argv) {
  if (require.main !== module || module.parent !== null) fail('launcher requires direct Node script entry');
  if (!Array.isArray(argv) || argv.length !== 0 || process.argv.length !== 2 || path.resolve(process.argv[1] || '') !== path.resolve(__filename)) fail('launcher accepts only the exact direct script command with no arguments');
  if (!Array.isArray(process.execArgv) || process.execArgv.length !== 0) fail('launcher rejects Node preload, loader, inspector, eval, and other exec arguments');
  const nodeOptions = process.env.NODE_OPTIONS == null ? null : String(process.env.NODE_OPTIONS);
  if (nodeOptions && nodeOptions.trim()) fail('launcher rejects nonempty NODE_OPTIONS');
  const repositoryCache = Object.keys(require.cache).map(file => path.resolve(file)).filter(file => {
    const relative = path.relative(REPO_ROOT, file);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
  }).sort();
  if (repositoryCache.length !== 1 || path.relative(repositoryCache[0], path.resolve(__filename)) !== '') fail('launcher rejects repository modules cached before the attempt receipt');
  const evidence = {
    argv: [path.resolve(process.execPath), path.resolve(process.argv[1])],
    execArgv: [],
    kind: 'CLEAN_DIRECT_NODE_SCRIPT_ENTRY',
    nodeOptions: null,
    repositoryRequireCache: repositoryCache,
  };
  Object.defineProperty(evidence, DIRECT_INVOCATION_TOKEN, { value: true });
  return Object.freeze(evidence);
}

function gitText(execFileSync, root, args, context) {
  try {
    return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    fail(`launcher Git check failed: ${context}`, { stderr: error && error.stderr && String(error.stderr).trim() || null });
  }
}

function validateManifestShape(manifest) {
  if (!manifest || manifest.schema !== MANIFEST_SCHEMA || manifest.experimentId !== 'component-fragility-tail-v1' || manifest.requiredAnnotatedTag !== FIXED_TAG) fail('launcher freeze-manifest identity drifted');
  if (!manifest.runtime || manifest.runtime.node !== 'v22.19.0' || manifest.runtime.platform !== 'win32' || manifest.runtime.arch !== 'x64') fail('launcher freeze-manifest runtime drifted');
  if (!Array.isArray(manifest.files) || manifest.files.length !== EXPECTED_FILE_PATHS.length || manifest.files.map(entry => entry.path).join('|') !== EXPECTED_FILE_PATHS.join('|') || manifest.files.map(entry => entry.key).join('|') !== EXPECTED_FILE_KEYS.join('|')) fail('launcher freeze-manifest file order/key/path drifted');
  for (const entry of manifest.files) {
    if (!entry || !Number.isInteger(entry.bytes) || entry.bytes <= 0 || !/^[0-9a-f]{64}$/.test(entry.sha256) || !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(entry.gitBlob)) fail(`launcher freeze-manifest file identity invalid for ${entry && entry.path}`);
  }
  if (!manifest.input || manifest.input.path !== 'research/local-artifacts/v2-validation-final/inputs/fear-greed-v2-validation-input-2026-08-25T12-44-22Z.json' || manifest.input.sidecarPath !== 'research/local-artifacts/v2-validation-final/inputs/fear-greed-v2-validation-input-2026-08-25T12-44-22Z.sha256' || manifest.input.sha256 !== 'ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d') fail('launcher input identity drifted');
  if (!manifest.attemptReceipt || manifest.attemptReceipt.scope !== ATTEMPT_SCOPE || manifest.attemptReceipt.path !== ATTEMPT_RELATIVE || !manifest.publication || manifest.publication.directory !== OUTPUT_DIRECTORY_RELATIVE || manifest.publication.resultPath !== `${OUTPUT_DIRECTORY_RELATIVE}/component-fragility-tail-v1-result-2026-08-26.json` || manifest.publication.sidecarPath !== `${OUTPUT_DIRECTORY_RELATIVE}/component-fragility-tail-v1-result-2026-08-26.json.sha256`) fail('launcher attempt/publication path drifted');
  return manifest;
}

function preflight({ execFileSync = childProcess.execFileSync, io = fs, directory = __dirname, requireLinkedWorktree = true, expectedRepoRoot = REPO_ROOT } = {}) {
  const root = gitText(execFileSync, path.resolve(directory), ['rev-parse', '--show-toplevel'], 'locate worktree');
  if (expectedRepoRoot && path.resolve(root) !== path.resolve(expectedRepoRoot)) fail('launcher is outside the frozen repository root');
  const gitDirectory = path.resolve(gitText(execFileSync, root, ['rev-parse', '--path-format=absolute', '--git-dir'], 'resolve linked Git directory'));
  const commonDirectory = path.resolve(gitText(execFileSync, root, ['rev-parse', '--path-format=absolute', '--git-common-dir'], 'resolve common Git directory'));
  if (requireLinkedWorktree && gitDirectory === commonDirectory) fail('launcher requires an isolated linked Git worktree');
  const tagRef = `refs/tags/${FIXED_TAG}`;
  if (gitText(execFileSync, root, ['cat-file', '-t', tagRef], 'require annotated tag') !== 'tag') fail('launcher requires the fixed tag to be annotated');
  const tagObject = gitText(execFileSync, root, ['rev-parse', tagRef], 'resolve tag object');
  const tagCommit = gitText(execFileSync, root, ['rev-parse', `${tagRef}^{commit}`], 'resolve tag commit');
  const headCommit = gitText(execFileSync, root, ['rev-parse', 'HEAD^{commit}'], 'resolve HEAD');
  if (tagCommit !== headCommit) fail('launcher HEAD differs from the fixed tag commit', { tagCommit, headCommit });

  const manifestPath = path.join(root, ...MANIFEST_RELATIVE.split('/'));
  const manifestBytes = io.readFileSync(manifestPath);
  gitText(execFileSync, root, ['ls-files', '--error-unmatch', '--', MANIFEST_RELATIVE], 'require tracked manifest');
  if (gitText(execFileSync, root, ['status', '--porcelain', '--', MANIFEST_RELATIVE], 'require clean manifest')) fail('launcher freeze manifest is dirty');
  const manifestHeadBlob = gitText(execFileSync, root, ['rev-parse', `HEAD:${MANIFEST_RELATIVE}`], 'resolve manifest HEAD blob');
  const manifestTagBlob = gitText(execFileSync, root, ['rev-parse', `${tagCommit}:${MANIFEST_RELATIVE}`], 'resolve manifest tag blob');
  const manifestWorkingBlob = gitText(execFileSync, root, ['hash-object', '--path', MANIFEST_RELATIVE, manifestPath], 'hash working manifest');
  if (manifestHeadBlob !== manifestTagBlob || manifestHeadBlob !== manifestWorkingBlob) fail('launcher manifest is not byte-identical across HEAD, tag, and worktree');
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString('utf8')); } catch (error) { fail('launcher freeze manifest is not valid JSON'); }
  validateManifestShape(manifest);
  if (manifestBytes.toString('utf8') !== canonicalJson(manifest)) fail('launcher freeze manifest is not canonical JSON');

  const identities = {};
  for (const entry of manifest.files) {
    if (entry.path.includes('..') || path.isAbsolute(entry.path)) fail(`launcher rejects unsafe manifest path ${entry.path}`);
    const absolute = path.join(root, ...entry.path.split('/'));
    gitText(execFileSync, root, ['ls-files', '--error-unmatch', '--', entry.path], `require tracked ${entry.path}`);
    if (gitText(execFileSync, root, ['status', '--porcelain', '--', entry.path], `require clean ${entry.path}`)) fail(`launcher frozen file is dirty: ${entry.path}`);
    const headBlob = gitText(execFileSync, root, ['rev-parse', `HEAD:${entry.path}`], `resolve HEAD blob ${entry.path}`);
    const tagBlob = gitText(execFileSync, root, ['rev-parse', `${tagCommit}:${entry.path}`], `resolve tag blob ${entry.path}`);
    const workingBlob = gitText(execFileSync, root, ['hash-object', '--path', entry.path, absolute], `hash working file ${entry.path}`);
    const bytes = io.readFileSync(absolute);
    if (headBlob !== entry.gitBlob || tagBlob !== entry.gitBlob || workingBlob !== entry.gitBlob || bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) fail(`launcher frozen identity mismatch: ${entry.path}`);
    identities[entry.key] = { path: entry.path, bytes: entry.bytes, gitBlob: entry.gitBlob, sha256: entry.sha256 };
  }
  if (process.version !== manifest.runtime.node || process.platform !== manifest.runtime.platform || process.arch !== manifest.runtime.arch) fail('launcher runtime differs from the freeze manifest');
  if (io.existsSync(path.join(commonDirectory, ...ATTEMPT_RELATIVE.split('/')))) fail('repository-global permanent one-shot attempt receipt already exists; retry is forbidden');
  if (io.existsSync(path.join(root, ...OUTPUT_DIRECTORY_RELATIVE.split('/')))) fail('final result directory already exists');
  const freeze = { root: path.resolve(root), gitDirectory, commonDirectory, tag: FIXED_TAG, tagObject, tagCommit, manifest: { path: MANIFEST_RELATIVE, sha256: sha256(manifestBytes), gitBlob: manifestHeadBlob, bytes: manifestBytes.length }, identities };
  Object.defineProperty(freeze, PREFLIGHT_TOKEN, { value: true });
  return Object.freeze(freeze);
}

function claimPermanentAttempt(freeze, { io = fs, clock = () => new Date().toISOString(), processId = process.pid, attemptId = crypto.randomBytes(12).toString('hex'), invocation = null } = {}) {
  if (!freeze || freeze[PREFLIGHT_TOKEN] !== true || freeze.tag !== FIXED_TAG || !freeze.manifest || !freeze.identities || !path.isAbsolute(freeze.root) || !path.isAbsolute(freeze.gitDirectory) || !path.isAbsolute(freeze.commonDirectory)) fail('launcher attempt claim requires completed frozen-code preflight');
  if (!invocation || (invocation[DIRECT_INVOCATION_TOKEN] !== true && invocation.kind !== 'SYNTHETIC_TEST_NOT_PRODUCTION')) fail('launcher attempt claim requires direct-entry or synthetic-test invocation evidence');
  const claimedAt = clock();
  if (typeof claimedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(claimedAt) || !Number.isInteger(processId) || processId < 0 || !/^[0-9A-Za-z_-]+$/.test(attemptId)) fail('launcher attempt identity is invalid');
  const receiptPath = path.join(freeze.commonDirectory, ...ATTEMPT_RELATIVE.split('/'));
  const outputDirectory = path.join(freeze.root, ...OUTPUT_DIRECTORY_RELATIVE.split('/'));
  const outputPath = path.join(outputDirectory, 'component-fragility-tail-v1-result-2026-08-26.json');
  const outputSidecarPath = `${outputPath}.sha256`;
  const receipt = {
    attemptId,
    claimedAt,
    codeFreeze: { files: freeze.identities, manifest: freeze.manifest, tag: freeze.tag, tagObject: freeze.tagObject, tagCommit: freeze.tagCommit },
    command: 'node research/component_fragility_tail_risk_launcher.js',
    expectedInput: {
      path: 'research/local-artifacts/v2-validation-final/inputs/fear-greed-v2-validation-input-2026-08-25T12-44-22Z.json',
      sha256: 'ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d',
      sidecarPath: 'research/local-artifacts/v2-validation-final/inputs/fear-greed-v2-validation-input-2026-08-25T12-44-22Z.sha256',
    },
    experimentId: 'component-fragility-tail-v1',
    intendedPublication: {
      absoluteDirectory: outputDirectory,
      absoluteResultPath: outputPath,
      absoluteSidecarPath: outputSidecarPath,
      directory: OUTPUT_DIRECTORY_RELATIVE,
      resultPath: `${OUTPUT_DIRECTORY_RELATIVE}/component-fragility-tail-v1-result-2026-08-26.json`,
      sidecarPath: `${OUTPUT_DIRECTORY_RELATIVE}/component-fragility-tail-v1-result-2026-08-26.json.sha256`,
    },
    invocation,
    phase: 'CLAIMED_BEFORE_SCHEMA5_LOAD_OR_INPUT_OPEN',
    processId,
    repositoryScope: {
      commonDirectory: freeze.commonDirectory,
      receiptPath,
      relativePath: ATTEMPT_RELATIVE,
      scope: ATTEMPT_SCOPE,
    },
    runtime: { arch: process.arch, node: process.version, platform: process.platform },
    schema: 'component-fragility-tail-risk-attempt-receipt-v1',
    status: 'PERMANENT_ONE_SHOT_ATTEMPT_RESERVED_BEFORE_INPUT_PARSE',
    winningWorktree: {
      gitDirectory: freeze.gitDirectory,
      root: freeze.root,
    },
  };
  const bytes = Buffer.from(canonicalJson(receipt));
  const temporary = `${receiptPath}.tmp-${processId}-${attemptId}`;
  io.mkdirSync(path.dirname(receiptPath), { recursive: true });
  let linked = false;
  let temporaryCreated = false;
  try {
    let descriptor;
    try {
      descriptor = io.openSync(temporary, 'wx', 0o600);
      temporaryCreated = true;
      io.writeFileSync(descriptor, bytes);
      io.fsyncSync(descriptor);
    } catch (error) {
      fail('launcher could not exclusively create and flush its staged attempt receipt', { code: error && error.code || null });
    } finally {
      if (descriptor !== undefined) {
        try { io.closeSync(descriptor); } catch (error) { fail('launcher could not close its staged attempt receipt', { code: error && error.code || null }); }
      }
    }
    const staged = io.readFileSync(temporary);
    if (!staged.equals(bytes) || sha256(staged) !== sha256(bytes)) fail('launcher staged attempt receipt failed byte verification');
    try {
      io.linkSync(temporary, receiptPath);
      linked = true;
    } catch (error) {
      if (error && error.code === 'EEXIST') fail('permanent one-shot attempt receipt already exists; retry is forbidden');
      fail('launcher could not atomically hard-link the permanent attempt receipt', { code: error && error.code || null });
    }
  } finally {
    if (temporaryCreated && io.existsSync(temporary)) {
      try { io.unlinkSync(temporary); } catch (error) { /* never remove or alter the fixed receipt */ }
    }
  }
  if (!linked) fail('launcher did not reserve the permanent attempt receipt');
  const published = io.readFileSync(receiptPath);
  if (!published.equals(bytes)) fail('launcher permanent attempt receipt differs after publication');
  return Object.freeze({ scope: ATTEMPT_SCOPE, path: ATTEMPT_RELATIVE, absolutePath: receiptPath, sha256: sha256(published), bytes: published.length, payload: receipt });
}

function claimSyntheticAttemptForTest(freeze, options = {}) {
  if (!freeze || freeze[PREFLIGHT_TOKEN] !== true || !freeze.root || !freeze.commonDirectory) fail('synthetic attempt claim requires completed temporary-repository preflight');
  const root = path.resolve(freeze.root);
  const relativeToRepository = path.relative(REPO_ROOT, root);
  if (relativeToRepository === '' || (!relativeToRepository.startsWith('..') && !path.isAbsolute(relativeToRepository))) fail('synthetic attempt root must be outside the repository');
  const productionCommonDirectory = gitText(childProcess.execFileSync, REPO_ROOT, ['rev-parse', '--path-format=absolute', '--git-common-dir'], 'resolve production common Git directory for synthetic isolation');
  const syntheticCommonReal = fs.realpathSync.native(path.resolve(freeze.commonDirectory));
  const productionCommonReal = fs.realpathSync.native(path.resolve(productionCommonDirectory));
  if (path.relative(syntheticCommonReal, productionCommonReal) === '') fail('synthetic attempt common directory must be outside the production repository');
  const invocation = Object.freeze({ kind: 'SYNTHETIC_TEST_NOT_PRODUCTION' });
  return claimPermanentAttempt(freeze, { ...options, invocation });
}

function main(argv = process.argv.slice(2)) {
  const invocation = assertCleanDirectInvocation(argv);
  const freeze = preflight();
  const attempt = claimPermanentAttempt(freeze, { invocation });
  const runner = require('./component_fragility_tail_risk');
  if (!runner || typeof runner.main !== 'function') fail('verified runner export is missing main');
  return runner.main([], attempt);
}

module.exports = {
  REPO_ROOT,
  FIXED_TAG,
  MANIFEST_SCHEMA,
  MANIFEST_RELATIVE,
  RUNNER_RELATIVE,
  EXPECTED_FILE_PATHS,
  EXPECTED_FILE_KEYS,
  ATTEMPT_SCOPE,
  ATTEMPT_RELATIVE,
  OUTPUT_DIRECTORY_RELATIVE,
  LauncherIntegrityError,
  canonicalize,
  canonicalJson,
  validateManifestShape,
  preflight,
  claimSyntheticAttemptForTest,
};

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: error && error.code === 'INTEGRITY_ERROR' ? 'INTEGRITY_ERROR' : 'ERROR', message: error && error.message, details: error && error.details || {} }, null, 2)}\n`);
    process.exitCode = error && error.code === 'INTEGRITY_ERROR' ? 2 : 1;
  }
}
