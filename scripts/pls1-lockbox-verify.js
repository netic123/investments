'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const common = require('./pls1-lockbox-common');
const seedBuilder = require('./build-pls1-lockbox-seed');
const model = require('../research/fear_greed_control_residual_pls1');

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function hashWithout(value, key) {
  const copy = { ...value };
  delete copy[key];
  return model.hashCanonical(copy);
}

function equalCanonical(actual, expected, context) {
  if (model.canonicalStringify(actual) !== model.canonicalStringify(expected)) {
    throw new Error(`${context}: canonical replay mismatch`);
  }
}

function exactKeys(value, keys, context) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${context}: object required`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${context}: exact keys mismatch (${actual.join(',')})`);
  }
}

function exactDate(value) {
  return common.isExactDate(value);
}

function exactUtc(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && new Date(value).toISOString() === value;
}

function sha(value, length = 64) {
  return typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
}

function verifyReceipts(root, receipts, context, { allowEmpty = false } = {}) {
  if (!Array.isArray(receipts) || (!allowEmpty && receipts.length === 0)) {
    throw new Error(`${context}: raw receipt inventory is missing`);
  }
  const rawByOrdinal = new Map();
  let previousStartedAtUtc = null;
  receipts.forEach((receipt, ordinal) => {
    if (!receipt || receipt.requestOrdinal !== ordinal
        || !['COMPONENT', 'EXECUTABLE'].includes(receipt.phase)
        || receipt.method !== 'GET' || !exactUtc(receipt.startedAtUtc)
        || !exactUtc(receipt.completedAtUtc) || receipt.completedAtUtc < receipt.startedAtUtc
        || !Array.isArray(receipt.acceptedFor)) {
      throw new Error(`${context}: invalid/duplicate/non-contiguous receipt ${ordinal}`);
    }
    const hasBody = typeof receipt.path === 'string';
    const baseKeys = ['requestOrdinal', 'phase', 'method', 'url', 'startedAtUtc', 'completedAtUtc',
      'status', 'responseUrl', 'headers', 'acceptedFor', 'error'];
    exactKeys(receipt, hasBody ? [...baseKeys, 'path', 'rawSha256', 'rawBytes', 'gzipSha256', 'gzipBytes']
      : baseKeys, `${context}: receipt ${ordinal}`);
    if (typeof receipt.url !== 'string' || !receipt.url
        || previousStartedAtUtc !== null && receipt.startedAtUtc < previousStartedAtUtc) {
      throw new Error(`${context}: receipt URL/timing order is invalid at ${ordinal}`);
    }
    previousStartedAtUtc = receipt.startedAtUtc;
    if (!receipt.headers || typeof receipt.headers !== 'object' || Array.isArray(receipt.headers)) {
      throw new Error(`${context}: receipt headers are invalid at ${ordinal}`);
    }
    const allowedHeaders = new Set(['content-type', 'content-length', 'date', 'etag', 'last-modified']);
    for (const [key, value] of Object.entries(receipt.headers)) {
      if (!allowedHeaders.has(key) || typeof value !== 'string') {
        throw new Error(`${context}: receipt header schema is invalid at ${ordinal}`);
      }
    }
    if (hasBody) {
      const raw = common.verifyRawBlob(root, receipt);
      if (!raw.length && receipt.acceptedFor.length) {
        throw new Error(`${context}: selected response-body bytes are empty at ${ordinal}`);
      }
      rawByOrdinal.set(ordinal, raw);
    } else if (receipt.rawSha256 !== undefined || receipt.gzipSha256 !== undefined) {
      throw new Error(`${context}: partial raw identity at ${ordinal}`);
    }
    const statusKnown = Number.isInteger(receipt.status) && receipt.status >= 100 && receipt.status <= 599;
    if ((statusKnown && receipt.responseUrl !== receipt.url)
        || (!statusKnown && receipt.responseUrl !== null)) {
      throw new Error(`${context}: response URL is redirected or unbound at ${ordinal}`);
    }
    if (statusKnown && !hasBody && !receipt.error) {
      throw new Error(`${context}: HTTP response lacks archived body or read error at ${ordinal}`);
    }
    if (!statusKnown && !(receipt.status === null && typeof receipt.error === 'string' && receipt.error)) {
      throw new Error(`${context}: network failure receipt is incomplete at ${ordinal}`);
    }
    if ((hasBody && receipt.error !== null)
        || (!statusKnown && (hasBody || Object.keys(receipt.headers).length !== 0))
        || (statusKnown && !hasBody && !(typeof receipt.error === 'string' && receipt.error))) {
      throw new Error(`${context}: receipt transport/body state is contradictory at ${ordinal}`);
    }
    if (receipt.acceptedFor.length) {
      if (receipt.acceptedFor.length !== 1 || !(receipt.status >= 200 && receipt.status < 300) || !hasBody) {
        throw new Error(`${context}: accepted receipt is not one archived 2xx response at ${ordinal}`);
      }
    }
  });
  return rawByOrdinal;
}

function replaySourceAcquisition(root, source, context, sourceIdentityContract) {
  if (!source || !['max', '5y'].includes(source.range) || !exactDate(source.retrievalDateUtc)
      || !Array.isArray(source.sourceSelections)) throw new Error(`${context}: source identity incomplete`);
  const rawByOrdinal = verifyReceipts(root, source.rawResponses, context);
  return seedBuilder.replayAlignedDataFromReceipts({
    receipts: source.rawResponses,
    sourceSelections: source.sourceSelections,
    loadRaw: receipt => rawByOrdinal.get(receipt.requestOrdinal),
    range: source.range,
    retrievalDateUtc: source.retrievalDateUtc,
    sourceIdentityContract,
  });
}

function validateRowShape(row, context) {
  exactKeys(row, ['date', 'targetClose', 'cashClose', 'referenceDate', 'components',
    'componentAsOf', 'availableAtUtc'], context);
  exactKeys(row.components, model.COMPONENT_KEYS, `${context} components`);
  exactKeys(row.componentAsOf, model.COMPONENT_KEYS, `${context} componentAsOf`);
}

function validateSeed(seed, root = common.LOCKBOX_ROOT) {
  exactKeys(seed, ['schema', 'status', 'lockboxId', 'modelId', 'createdAtUtc',
    'retrievalDateUtc', 'sourceCommitSha', 'sourceTreeSha', 'sourceRuntime',
    'sourceIdentityContract', 'sourceIdentityContractSha256', 'marketOrder', 'componentOrder',
    'cash', 'cashMetadata', 'marketfgNormalizedSha256', 'targetCalendarSha256',
    'firstProspectiveDecisionMustBeAfter', 'sourceSelections', 'sourceReceipts', 'markets'], 'seed');
  if (seed.schema !== 'fg-control-residual-pls1-seed-v1'
      || seed.status !== 'PRE_ACTIVATION_WARMUP_ONLY_NOT_VALIDATION_EVIDENCE'
      || seed.lockboxId !== common.LOCKBOX_ID || seed.modelId !== model.MODEL_ID
      || !exactUtc(seed.createdAtUtc) || !exactDate(seed.retrievalDateUtc)
      || !sha(seed.sourceCommitSha, 40) || !sha(seed.sourceTreeSha, 40)
      || !sha(seed.marketfgNormalizedSha256)
      || !sha(seed.targetCalendarSha256) || !sha(seed.sourceIdentityContractSha256)
      || seed.sourceIdentityContractSha256 !== model.hashCanonical(seed.sourceIdentityContract)) {
    throw new Error('seed identity mismatch');
  }
  seedBuilder.validateSourceIdentityContract(seed.sourceIdentityContract);
  seedBuilder.assertSourceCalendarHorizon(seed.sourceIdentityContract, seed.retrievalDateUtc,
    seedBuilder.REQUIRED_FUTURE_SOURCE_SESSIONS);
  if (common.isProductionLockboxRoot(root)) {
    const contractBytes = fs.readFileSync(seedBuilder.SOURCE_IDENTITY_PATH);
    if (!contractBytes.equals(Buffer.from(model.canonicalStringify(seed.sourceIdentityContract)))) {
      throw new Error('seed source identity contract differs from the pinned reviewed file');
    }
  }
  equalCanonical(seed.marketOrder, common.MARKET_ORDER, 'seed market order');
  equalCanonical(seed.componentOrder, model.COMPONENT_KEYS, 'seed component order');
  equalCanonical(seed.cash, common.CASH, 'seed cash identity');
  if (!seed.sourceRuntime || !['win32', 'linux'].includes(seed.sourceRuntime.platform)
      || seed.sourceRuntime.arch !== 'x64') throw new Error('seed build platform identity mismatch');
  exactKeys(seed.sourceRuntime, ['node', 'v8', 'icu', 'tz', 'zlib', 'platform', 'arch'],
    'seed source runtime');
  for (const [key, expected] of Object.entries(common.REQUIRED_RUNTIME)) {
    if (seed.sourceRuntime[key] !== expected) throw new Error(`seed runtime ${key} mismatch`);
  }
  exactKeys(seed.firstProspectiveDecisionMustBeAfter, common.MARKET_ORDER,
    'seed first prospective boundary');
  exactKeys(seed.markets, common.MARKET_ORDER, 'seed markets');
  if (!seed.cashMetadata || seed.cashMetadata.providerSymbol !== common.CASH.symbol
      || seed.cashMetadata.currency !== 'USD' || seed.cashMetadata.adjusted !== true
      || typeof seed.cashMetadata.timezone !== 'string') throw new Error('seed cash metadata mismatch');
  const replay = replaySourceAcquisition(root, {
    range: 'max',
    retrievalDateUtc: seed.retrievalDateUtc,
    sourceSelections: seed.sourceSelections,
    rawResponses: seed.sourceReceipts,
  }, 'seed source replay', seed.sourceIdentityContract);
  if (replay.marketfgNormalizedSha256 !== seed.marketfgNormalizedSha256) {
    throw new Error('seed Fear & Greed normalized projection hash mismatch');
  }
  if (replay.targetCalendarSha256 !== seed.targetCalendarSha256) {
    throw new Error('seed target calendar hash mismatch');
  }
  equalCanonical(replay.cashMetadata, seed.cashMetadata, 'seed cash raw replay');
  equalCanonical(replay.markets, seed.markets, 'seed markets raw replay');
  const terminalDates = new Set();
  for (const key of common.MARKET_ORDER) {
    const market = seed.markets[key];
    if (!market || market.key !== key || market.marketClass !== common.TARGETS[key].marketClass
        || market.targetId !== common.TARGETS[key].symbol || market.targetName !== common.TARGETS[key].name
        || market.cashId !== common.CASH.symbol || typeof market.sentimentReferenceId !== 'string'
        || !market.sentimentReferenceId || !market.targetMetadata
        || market.targetMetadata.providerSymbol !== common.TARGETS[key].symbol
        || market.targetMetadata.currency !== 'USD' || market.targetMetadata.adjusted !== true) {
      throw new Error(`seed ${key}: closed mapping/metadata mismatch`);
    }
    market.rows.forEach((row, index) => validateRowShape(row, `seed ${key} row ${index}`));
    const normalized = model.normalizeMarket({
      key, name: market.name, marketClass: market.marketClass,
      targetId: market.targetId, cashId: market.cashId, rows: market.rows,
    });
    if (normalized.rows.length < model.MIN_MATURED_ROWS + 126) {
      throw new Error(`seed ${key}: insufficient all-history rows`);
    }
    const last = market.rows.at(-1).date;
    if (seed.firstProspectiveDecisionMustBeAfter[key] !== last || !(last < seed.retrievalDateUtc)) {
      throw new Error(`seed ${key}: first prospective boundary mismatch`);
    }
    terminalDates.add(last);
  }
  if (terminalDates.size !== 1) throw new Error('seed terminal target dates differ across markets');
  const latestReceipt = seed.sourceReceipts.reduce((latest, receipt) => (
    receipt.completedAtUtc > latest ? receipt.completedAtUtc : latest
  ), '0000-01-01T00:00:00.000Z');
  if (latestReceipt > seed.createdAtUtc) throw new Error('seed createdAt predates a source completion');
  return replay;
}

function gitObjectBytes(commit, relativePath) {
  return childProcess.execFileSync('git', ['show', `${commit}:${relativePath}`], { cwd: common.ROOT });
}

function gitText(args) {
  return childProcess.execFileSync('git', args, { cwd: common.ROOT, encoding: 'utf8' }).trim();
}

function assertGitAncestor(ancestor, descendant, context) {
  try {
    childProcess.execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: common.ROOT,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {
    throw new Error(`${context}: required Git ancestry is absent`);
  }
}

function assertRemoteHeadGitBinding(remote, manifest, manifestCommitSha = null, cache = new Set()) {
  const cacheKey = `${remote.headSha}:${manifestCommitSha || 'NO_MANIFEST_COMMIT_ARGUMENT'}`;
  if (cache.has(cacheKey)) return;
  const resolved = gitText(['rev-parse', '--verify', `${remote.headSha}^{commit}`]);
  if (resolved !== remote.headSha) throw new Error('remote run head does not resolve to its exact commit');
  assertGitAncestor(manifest.sourceCommitSha, remote.headSha, 'source commit to remote run head');
  assertGitAncestor(remote.headSha, 'HEAD', 'remote run head to checked-out verifier HEAD');
  if (manifestCommitSha !== null) {
    assertGitAncestor(manifestCommitSha, remote.headSha, 'frozen manifest commit to remote run head');
  }
  const relativeManifest = path.relative(common.ROOT, common.MANIFEST_PATH).replace(/\\/g, '/');
  if (!gitObjectBytes(remote.headSha, relativeManifest).equals(fs.readFileSync(common.MANIFEST_PATH))) {
    throw new Error('remote run head does not contain the exact frozen manifest bytes');
  }
  try {
    childProcess.execFileSync('git', ['diff', '--quiet', manifest.sourceCommitSha, remote.headSha,
      '--', ...manifest.pinnedFiles.map(identity => identity.path)], {
      cwd: common.ROOT,
      stdio: ['ignore', 'ignore', 'ignore'],
    });
  } catch {
    throw new Error('remote run head changed one or more manifest-pinned source files');
  }
  cache.add(cacheKey);
}

function validateManifest(manifest, seedSha256, verifyPinnedFiles, sourceIdentityContractSha256 = null,
  requiredSourceSymbols = null, sourceIdentityEvidenceReference = null, production = verifyPinnedFiles) {
  exactKeys(manifest, ['schema', 'status', 'lockboxId', 'modelId', 'modelVersion',
    'protocolFreezeMarker', 'frozenAtUtc', 'sourceCommitSha', 'sourceTreeSha', 'runtime', 'seed',
    'schedule', 'marketOrder', 'componentOrder', 'controlOrder', 'minimumMaturedRows',
    'currentZLimit', 'maximumCurrentControlMahalanobisRadius', 'maximumCurrentPlsScoreZ',
    'numericTolerance',
    'maximumControlNormalConditionInfinity', 'exactDyadicComparisonPolicy', 'label',
    'execution', 'targets', 'cash', 'costs',
    'upstream', 'trustGate', 'dataRights', 'remoteIntegrity', 'knownLimitations', 'pinnedFiles'],
  'manifest');
  if (manifest.schema !== 'fg-control-residual-pls1-manifest-v1'
      || manifest.status !== 'LOCKED_BEFORE_FIRST_PROSPECTIVE_DECISION'
      || manifest.lockboxId !== common.LOCKBOX_ID || manifest.modelId !== model.MODEL_ID
      || manifest.modelVersion !== model.SCHEMA_VERSION
      || manifest.protocolFreezeMarker !== model.PROTOCOL_FREEZE_MARKER
      || !exactUtc(manifest.frozenAtUtc) || !sha(manifest.sourceCommitSha, 40)
      || !sha(manifest.sourceTreeSha, 40) || !manifest.seed
      || manifest.seed.sha256 !== seedSha256) throw new Error('manifest identity mismatch');
  equalCanonical(manifest.marketOrder, common.MARKET_ORDER, 'manifest market order');
  equalCanonical(manifest.componentOrder, model.COMPONENT_KEYS, 'manifest component order');
  equalCanonical(manifest.controlOrder, model.CONTROL_KEYS, 'manifest control order');
  equalCanonical(manifest.costs, model.COSTS, 'manifest costs');
  if (manifest.minimumMaturedRows !== model.MIN_MATURED_ROWS
      || manifest.currentZLimit !== model.CURRENT_Z_LIMIT
      || manifest.maximumCurrentControlMahalanobisRadius
        !== model.MAX_CURRENT_CONTROL_MAHALANOBIS_RADIUS
      || manifest.maximumCurrentPlsScoreZ !== model.MAX_CURRENT_PLS_SCORE_Z
      || manifest.numericTolerance !== model.NUMERIC_TOLERANCE
      || manifest.maximumControlNormalConditionInfinity
        !== model.MAX_CONTROL_NORMAL_CONDITION_INFINITY
      || manifest.exactDyadicComparisonPolicy !== model.EXACT_DYADIC_COMPARISON_POLICY
      || !manifest.runtime || !manifest.runtime.required) {
    throw new Error('manifest numeric/runtime contract mismatch');
  }
  equalCanonical(manifest.runtime.required, common.REQUIRED_RUNTIME, 'manifest required runtime');
  exactKeys(manifest.runtime, ['required', 'productionPlatform', 'productionArch', 'mismatchPolicy'],
    'manifest runtime');
  if (manifest.runtime.productionPlatform !== 'linux' || manifest.runtime.productionArch !== 'x64'
      || manifest.runtime.mismatchPolicy
        !== 'NEW_MANIFEST_REQUIRED_UNLESS_BYTE_EQUIVALENCE_IS_PROVED_BEFORE_ANY_NEW_DECISION') {
    throw new Error('manifest production platform contract mismatch');
  }
  exactKeys(manifest.schedule, ['triggerExpressionsUtc', 'activationRule',
    'decisionSafetyCutoffUtc', 'semanticKey', 'nominalDelayIsEvidence',
    'missedSessionsAreBackfilledAsDecisions', 'missedSessionsRemainInPrimaryPriceLedger'],
  'manifest schedule');
  if (!manifest.schedule || !Array.isArray(manifest.schedule.triggerExpressionsUtc)
      || JSON.stringify(manifest.schedule.triggerExpressionsUtc) !== JSON.stringify(common.SCHEDULE_EXPRESSIONS)
      || manifest.schedule.decisionSafetyCutoffUtc !== '12:00:00Z'
      || manifest.schedule.nominalDelayIsEvidence !== false
      || manifest.schedule.missedSessionsAreBackfilledAsDecisions !== false
      || manifest.schedule.missedSessionsRemainInPrimaryPriceLedger !== true
      || JSON.stringify(manifest.schedule.semanticKey) !== JSON.stringify(['manifestSha256', 'decisionDate'])) {
    throw new Error('manifest schedule contract mismatch');
  }
  exactKeys(manifest.targets, common.MARKET_ORDER, 'manifest targets');
  for (const key of common.MARKET_ORDER) {
    const expected = common.TARGETS[key];
    const actual = manifest.targets[key];
    if (!actual || actual.symbol !== expected.symbol || actual.name !== expected.name
        || actual.marketClass !== expected.marketClass || actual.currency !== 'USD'
        || typeof actual.officialUrl !== 'string') throw new Error(`manifest ${key} target mismatch`);
  }
  if (!manifest.cash || manifest.cash.symbol !== common.CASH.symbol
      || manifest.cash.currency !== 'USD' || typeof manifest.cash.officialUrl !== 'string') {
    throw new Error('manifest cash mismatch');
  }
  const gate = manifest.trustGate || {};
  exactKeys(gate, ['minimumCalendarDays', 'minimumMaturedForecastsPerMarket',
    'fixedFirstDecisionOriginsPerMarket', 'extendWindowForMissingOrInvalidOrigins',
    'm1MseRelativeToM0Maximum', 'm1StressWealthMustExceed', 'clarkWestNeweyWestLag',
    'holmFamilyWiseAlpha', 'x2EveryMarketMinimumRatio',
    'interimTuningOrEarlyGraduationAllowed'], 'manifest trust gate');
  if (gate.minimumCalendarDays !== 1095 || gate.minimumMaturedForecastsPerMarket !== 756
      || gate.fixedFirstDecisionOriginsPerMarket !== 756
      || gate.extendWindowForMissingOrInvalidOrigins !== false
      || gate.m1MseRelativeToM0Maximum !== 0.995
      || gate.clarkWestNeweyWestLag !== 5 || gate.holmFamilyWiseAlpha !== 0.05
      || gate.x2EveryMarketMinimumRatio !== 2
      || gate.interimTuningOrEarlyGraduationAllowed !== false
      || JSON.stringify(gate.m1StressWealthMustExceed) !== JSON.stringify(['M0', 'BUY_AND_HOLD'])) {
    throw new Error('manifest trust gate mismatch');
  }
  exactKeys(manifest.dataRights, ['requiredBeforeActivation', 'status', 'evidenceReference',
    'requiredScope', 'coveredSymbols'], 'manifest data rights');
  const { PINNED_FILES, DATA_RIGHTS_STATUS, LOCAL_FIXTURE_EVIDENCE_REFERENCE } =
    require('./create-pls1-lockbox-manifest');
  if (!manifest.dataRights || manifest.dataRights.requiredBeforeActivation !== true
      || typeof sourceIdentityEvidenceReference !== 'string' || !sourceIdentityEvidenceReference
      || typeof manifest.dataRights.evidenceReference !== 'string'
      || !manifest.dataRights.evidenceReference
      || manifest.dataRights.requiredScope
        !== 'AUTOMATED_RETRIEVAL_PRIVATE_RETENTION_AND_PUBLIC_RAW_REDISTRIBUTION_INDEFINITELY'
      || !Array.isArray(requiredSourceSymbols)) {
    throw new Error('manifest lacks complete source retention/redistribution rights evidence');
  }
  if (manifest.dataRights.evidenceReference !== sourceIdentityEvidenceReference) {
    throw new Error('manifest data-rights evidence must exactly match the verified seed source contract');
  }
  if (!production && (manifest.dataRights.status !== DATA_RIGHTS_STATUS.LOCAL_FIXTURE
      || manifest.dataRights.evidenceReference !== LOCAL_FIXTURE_EVIDENCE_REFERENCE)) {
    throw new Error('local fixture cannot claim production data-rights confirmation');
  }
  if (production && (manifest.dataRights.status !== DATA_RIGHTS_STATUS.PRODUCTION
      || manifest.dataRights.evidenceReference === LOCAL_FIXTURE_EVIDENCE_REFERENCE)) {
    throw new Error('production manifest lacks independently bound written data-rights confirmation');
  }
  equalCanonical(manifest.dataRights.coveredSymbols, requiredSourceSymbols,
    'manifest source-rights symbol coverage');
  const remoteIntegrity = manifest.remoteIntegrity || {};
  exactKeys(remoteIntegrity, ['actionsApiBaseUrl', 'repository', 'repositoryId', 'branch', 'ref',
    'serverUrl', 'workflowId', 'workflowPath', 'workflowRef', 'branchProtectionRequired',
    'forcePushAndDeletionBlockedRequired', 'enforceAdminsRequired',
    'branchProtectionSnapshotSha256', 'independentTimestampAnchorRequired',
    'independentTimestampAnchorReference'], 'manifest remote integrity');
  if (remoteIntegrity.actionsApiBaseUrl !== common.GITHUB_REMOTE.apiBaseUrl
      || remoteIntegrity.repository !== common.GITHUB_REMOTE.repository
      || remoteIntegrity.repositoryId !== common.GITHUB_REMOTE.repositoryId
      || remoteIntegrity.branch !== common.GITHUB_REMOTE.branch
      || remoteIntegrity.ref !== common.GITHUB_REMOTE.ref
      || remoteIntegrity.serverUrl !== common.GITHUB_REMOTE.serverUrl
      || !/^[1-9]\d*$/.test(remoteIntegrity.workflowId)
      || remoteIntegrity.workflowPath !== common.GITHUB_REMOTE.workflowPath
      || remoteIntegrity.workflowRef !== common.GITHUB_REMOTE.workflowRef
      || remoteIntegrity.branchProtectionRequired !== true
      || remoteIntegrity.forcePushAndDeletionBlockedRequired !== true
      || remoteIntegrity.enforceAdminsRequired !== true
      || !sha(remoteIntegrity.branchProtectionSnapshotSha256)
      || remoteIntegrity.independentTimestampAnchorRequired !== true
      || typeof remoteIntegrity.independentTimestampAnchorReference !== 'string'
      || !remoteIntegrity.independentTimestampAnchorReference) {
    throw new Error('manifest remote integrity contract is incomplete');
  }
  if (!Array.isArray(manifest.pinnedFiles) || manifest.pinnedFiles.length !== PINNED_FILES.length) {
    throw new Error('manifest pinned-file inventory count mismatch');
  }
  manifest.pinnedFiles.forEach((identity, index) => {
    if (!identity || identity.path !== PINNED_FILES[index]
        || identity.path.includes('..') || identity.path.includes('\\')
        || !sha(identity.sha256) || !Number.isInteger(identity.bytes) || identity.bytes <= 0) {
      throw new Error(`manifest pinned file ${index}: identity/order mismatch`);
    }
    if (verifyPinnedFiles) {
      const current = fs.readFileSync(path.join(common.ROOT, identity.path));
      const frozen = gitObjectBytes(manifest.sourceCommitSha, identity.path);
      if (current.length !== identity.bytes || common.sha256(current) !== identity.sha256
          || !current.equals(frozen)) throw new Error(`${identity.path}: pinned/commit identity mismatch`);
    }
  });
  const sourceIdentity = manifest.pinnedFiles.find(identity => (
    identity.path === 'research/PLS1_SOURCE_IDENTITY_CONTRACT.json'));
  if (!sourceIdentity || sourceIdentity.sha256 !== sourceIdentityContractSha256) {
    throw new Error('manifest source identity pin differs from the seed identity contract');
  }
  if (verifyPinnedFiles) {
    const actualTree = childProcess.execFileSync('git', ['rev-parse', '--verify',
      `${manifest.sourceCommitSha}^{tree}`], { cwd: common.ROOT, encoding: 'utf8' }).trim();
    if (actualTree !== manifest.sourceTreeSha) throw new Error('manifest source Git tree mismatch');
    childProcess.execFileSync('git', ['merge-base', '--is-ancestor', manifest.sourceCommitSha, 'HEAD'],
      { cwd: common.ROOT });
  }
}

function primaryRows(seed, accepted, key) {
  const rows = seed.markets[key].rows.map(row => ({ ...row, availableAtUtc: null }));
  for (const bundle of accepted) {
    for (const source of bundle.markets[key].newRows) {
      if (source.date <= rows.at(-1).date) throw new Error(`${key}: non-increasing primary ledger`);
      rows.push({ ...source, availableAtUtc: null });
    }
  }
  return rows;
}

function expectedProspectiveRows(acquiredMarket, priorRows, availableAtUtc) {
  const last = priorRows.at(-1);
  const byDate = new Map(acquiredMarket.rows.map(row => [row.date, row]));
  const targetAnchor = [...priorRows].reverse().find(row => Number.isFinite(row.targetClose)
    && row.targetClose > 0 && byDate.get(row.date)
    && Number.isFinite(byDate.get(row.date).targetClose) && byDate.get(row.date).targetClose > 0);
  if (!targetAnchor) throw new Error('raw replay lacks target bridge');
  const targetBase = byDate.get(targetAnchor.date).targetClose;
  const cashAnchor = [...priorRows].reverse().find(row => Number.isFinite(row.cashClose)
    && row.cashClose > 0 && byDate.get(row.date) && Number.isFinite(byDate.get(row.date).cashClose)
    && byDate.get(row.date).cashClose > 0);
  if (!cashAnchor) throw new Error('raw replay lacks cash bridge');
  const cashBase = byDate.get(cashAnchor.date).cashClose;
  const newer = acquiredMarket.rows.filter(row => row.date > last.date);
  return newer.map((row, index) => {
    if (!(Number.isFinite(row.targetClose) && row.targetClose > 0)
        || !(Number.isFinite(row.cashClose) && row.cashClose > 0)) {
      throw new Error(`${acquiredMarket.key} ${row.date}: prospective target and cash closes must both be finite and positive`);
    }
    return {
      date: row.date,
      targetClose: targetAnchor.targetClose * (row.targetClose / targetBase),
      cashClose: cashAnchor.cashClose * (row.cashClose / cashBase),
      referenceDate: row.referenceDate,
      components: { ...row.components },
      componentAsOf: { ...row.componentAsOf },
      availableAtUtc: index === newer.length - 1 ? availableAtUtc : null,
    };
  });
}

function makeEvent(kind, fields) {
  const event = { schema: `fg-control-residual-pls1-${kind.toLowerCase()}-v1`, kind, ...fields };
  event.eventSha256 = model.hashCanonical(event);
  return event;
}

function expectedEvents(accepted, key, allRows) {
  const byDate = new Map(allRows.map((row, index) => [row.date, index]));
  const recorded = new Set();
  for (const bundle of accepted) {
    for (const event of bundle.markets[key].resolvedEvents) {
      recorded.add(`${event.kind}:${event.model}:${event.decisionSha256}`);
    }
  }
  const pending = [];
  accepted.forEach(origin => {
    const index = byDate.get(origin.decisionDate);
    if (!Number.isInteger(index)) throw new Error(`${key}: prior decision date missing from rows`);
    const fill = allRows[index + 1];
    const end = allRows[index + 2];
    for (const modelKey of ['M0', 'M1']) {
      const decision = origin.markets[key].decisions[modelKey];
      if (fill && !recorded.has(`FILL:${modelKey}:${decision.decisionSha256}`)) {
        if (!(fill.date > decision.decisionDate)) throw new Error(`${key}: non-strict fill date`);
        pending.push({ date: fill.date, order: 0, event: makeEvent('FILL', {
          market: key, model: modelKey, decisionSha256: decision.decisionSha256,
          decisionDate: decision.decisionDate, decisionRecordedAtUtc: origin.collectedAtUtc,
          fillDate: fill.date, filledPosition: decision.targetPosition,
          targetClose: fill.targetClose, cashClose: fill.cashClose,
          oneWayPrimaryCost: model.COSTS[origin.markets[key].marketClass].primary,
          oneWayStressCost: model.COSTS[origin.markets[key].marketClass].stress,
          costChargedOnlyIfStateChanged: decision.tradeRequired,
        }) });
      }
      if (fill && end && !recorded.has(`OUTCOME:${modelKey}:${decision.decisionSha256}`)) {
        const valid = [fill.targetClose, end.targetClose, fill.cashClose, end.cashClose]
          .every(value => Number.isFinite(value) && value > 0);
        pending.push({ date: end.date, order: 1, event: makeEvent('OUTCOME', {
          market: key, model: modelKey, decisionSha256: decision.decisionSha256,
          decisionDate: decision.decisionDate, executionDate: fill.date, outcomeEndDate: end.date,
          valid, invalidReason: valid ? null : 'MISSING_NONPOSITIVE_EXECUTION_OR_OUTCOME_CLOSE',
          relativeLogReturn: valid ? Math.log(end.targetClose / fill.targetClose)
            - Math.log(end.cashClose / fill.cashClose) : null,
        }) });
      }
    }
  });
  pending.sort((left, right) => left.date.localeCompare(right.date) || left.order - right.order
    || left.event.decisionDate.localeCompare(right.event.decisionDate)
    || left.event.model.localeCompare(right.event.model));
  return pending.map(item => item.event);
}

function validateRemoteRun(remote, collectedAtUtc, production, manifest) {
  if (!remote || !exactUtc(remote.runCreatedAtUtc) || !exactUtc(remote.runStartedAtUtc)
      || remote.runCreatedAtUtc > remote.runStartedAtUtc || remote.runStartedAtUtc > collectedAtUtc
      || !Number.isSafeInteger(remote.runAttempt) || remote.runAttempt < 1) {
    throw new Error('remote run timing/identity is invalid');
  }
  if (!production) {
    if (remote.environment !== 'LOCAL_TEST_ONLY') throw new Error('temporary fixture lacks local-test provenance');
    return;
  }
  exactKeys(remote, [
    'environment', 'eventName', 'scheduleExpression', 'runId', 'runAttempt', 'runCreatedAtUtc',
    'runStartedAtUtc', 'headSha', 'workflowSha', 'workflowId', 'workflowPath', 'workflowRef',
    'repository', 'repositoryId', 'ref', 'serverUrl', 'runnerEnvironment', 'apiRequestUrl',
    'apiResponseUrl', 'immutableProjection', 'immutableProjectionSha256', 'htmlUrl',
  ], 'GitHub remote provenance');
  const integrity = manifest.remoteIntegrity;
  const canonicalApiRequest = `${integrity.actionsApiBaseUrl}/repos/${integrity.repository}`
    + `/actions/runs/${remote.runId}/attempts/${remote.runAttempt}`;
  const canonicalHtmlUrl = `${integrity.serverUrl}/${integrity.repository}/actions/runs/${remote.runId}`;
  const expectedProjection = {
    schema: 'fg-control-residual-pls1-github-run-attempt-projection-v1',
    apiRequestUrl: canonicalApiRequest,
    apiResponseUrl: canonicalApiRequest,
    eventName: remote.eventName,
    headBranch: integrity.branch,
    headSha: remote.headSha,
    htmlUrl: canonicalHtmlUrl,
    ref: remote.ref,
    repository: remote.repository,
    repositoryId: remote.repositoryId,
    runAttempt: remote.runAttempt,
    runCreatedAtUtc: remote.runCreatedAtUtc,
    runId: remote.runId,
    runStartedAtUtc: remote.runStartedAtUtc,
    workflowId: remote.workflowId,
    workflowPath: remote.workflowPath,
    workflowRef: remote.workflowRef,
    workflowSha: remote.workflowSha,
  };
  exactKeys(remote.immutableProjection, Object.keys(expectedProjection),
    'GitHub immutable run-attempt projection');
  equalCanonical(remote.immutableProjection, expectedProjection,
    'GitHub immutable run-attempt projection');
  if (remote.environment !== 'GITHUB_ACTIONS_REMOTE' || !/^[1-9]\d*$/.test(remote.runId)
      || !sha(remote.headSha, 40) || !sha(remote.workflowSha, 40)
      || remote.headSha !== remote.workflowSha
      || remote.workflowId !== integrity.workflowId
      || remote.workflowPath !== integrity.workflowPath
      || remote.workflowRef !== integrity.workflowRef
      || remote.repository !== integrity.repository
      || remote.repositoryId !== integrity.repositoryId
      || remote.ref !== integrity.ref || remote.serverUrl !== integrity.serverUrl
      || remote.runnerEnvironment !== 'github-hosted'
      || remote.apiRequestUrl !== canonicalApiRequest || remote.apiResponseUrl !== canonicalApiRequest
      || remote.htmlUrl !== canonicalHtmlUrl
      || remote.immutableProjectionSha256 !== model.hashCanonical(remote.immutableProjection)
      || !['schedule', 'workflow_dispatch'].includes(remote.eventName)) {
    throw new Error('GitHub remote provenance contract mismatch');
  }
  if (remote.eventName === 'schedule') {
    if (!common.SCHEDULE_EXPRESSIONS.includes(remote.scheduleExpression)) {
      throw new Error('unknown scheduled trigger expression');
    }
  } else if (remote.scheduleExpression !== null) throw new Error('manual run claims a schedule expression');
}

function validateReceiptEnvelope(receipts, remote, acquiredAtUtc, dataAvailableAtUtc,
  recordedAtUtc, context) {
  if (!Array.isArray(receipts) || !remote || !exactUtc(remote.runStartedAtUtc)
      || !exactUtc(recordedAtUtc)) throw new Error(`${context}: temporal envelope is incomplete`);
  for (const receipt of receipts) {
    if (receipt.startedAtUtc < remote.runStartedAtUtc || receipt.completedAtUtc > recordedAtUtc) {
      throw new Error(`${context}: receipt lies outside the workflow run envelope`);
    }
  }
  if (acquiredAtUtc !== null) {
    if (!exactUtc(acquiredAtUtc) || !exactUtc(dataAvailableAtUtc)
        || acquiredAtUtc > dataAvailableAtUtc || dataAvailableAtUtc > recordedAtUtc
        || receipts.some(receipt => receipt.completedAtUtc > acquiredAtUtc)) {
      throw new Error(`${context}: acquisition/data/signal timestamps are not causal`);
    }
  }
}

function receiptInventoryPaths(receipts) {
  return receipts.filter(receipt => typeof receipt.path === 'string').map(receipt => receipt.path);
}

function permanentLedgerTerminalDate(seed, accepted) {
  const dates = common.MARKET_ORDER.map(key => primaryRows(seed, accepted, key).at(-1).date);
  if (new Set(dates).size !== 1) throw new Error(`six-market permanent ledger dates differ: ${dates.join(',')}`);
  return dates[0];
}

function validateAttemptSource(root, source, attempt, seed, context) {
  if (!source || source.range !== '5y' || !exactDate(source.retrievalDateUtc)
      || !Array.isArray(source.rawResponses)) {
    throw new Error(`${context}: attempt acquisition state is incomplete`);
  }
  const state = source.state;
  if (state === common.ACQUISITION_STATE.NOT_STARTED) {
    exactKeys(source, ['state', 'range', 'retrievalDateUtc', 'rawResponses'], context);
    if (source.rawResponses.length !== 0
        || source.retrievalDateUtc !== attempt.collectedAtUtc.slice(0, 10)) {
      throw new Error(`${context}: not-started acquisition has receipts or a false retrieval date`);
    }
    validateReceiptEnvelope([], attempt.remoteRun, null, null, attempt.collectedAtUtc, context);
    return { replay: null, receiptPaths: [] };
  }
  if (state === common.ACQUISITION_STATE.PARTIAL_UNVERIFIED) {
    exactKeys(source, ['state', 'range', 'retrievalDateUtc', 'rawResponses'], context);
    verifyReceipts(root, source.rawResponses, `${context}: partial receipts`, { allowEmpty: true });
    seedBuilder.validatePartialAcquisitionReceipts({
      receipts: source.rawResponses,
      range: source.range,
      retrievalDateUtc: source.retrievalDateUtc,
    });
    validateReceiptEnvelope(source.rawResponses, attempt.remoteRun, null, null,
      attempt.collectedAtUtc, context);
    return { replay: null, receiptPaths: receiptInventoryPaths(source.rawResponses) };
  }
  if (state !== common.ACQUISITION_STATE.COMPLETE_REPLAY_VERIFIED) {
    throw new Error(`${context}: unknown acquisition state ${state}`);
  }
  exactKeys(source, ['state', 'range', 'retrievalDateUtc', 'acquiredAtUtc', 'dataAvailableAtUtc',
    'marketfgNormalizedSha256', 'targetCalendarSha256', 'alignedMarketsSha256',
    'sourceSelections', 'rawResponses'], context);
  if (!exactUtc(source.acquiredAtUtc) || !exactUtc(source.dataAvailableAtUtc)
      || source.retrievalDateUtc !== source.acquiredAtUtc.slice(0, 10)
      || source.acquiredAtUtc > source.dataAvailableAtUtc
      || source.dataAvailableAtUtc > attempt.collectedAtUtc
      || !sha(source.marketfgNormalizedSha256) || !sha(source.targetCalendarSha256)
      || !sha(source.alignedMarketsSha256)) {
    throw new Error(`${context}: complete attempt acquisition identity mismatch`);
  }
  const replay = replaySourceAcquisition(root, source, `${context}: complete replay`,
    seed.sourceIdentityContract);
  validateReceiptEnvelope(source.rawResponses, attempt.remoteRun, source.acquiredAtUtc,
    source.dataAvailableAtUtc, attempt.collectedAtUtc, context);
  if (replay.marketfgNormalizedSha256 !== source.marketfgNormalizedSha256
      || replay.targetCalendarSha256 !== source.targetCalendarSha256
      || model.hashCanonical(replay.markets) !== source.alignedMarketsSha256) {
    throw new Error(`${context}: attempt normalized source hash mismatch`);
  }
  if (source.rawResponses.some(receipt => receipt.completedAtUtc > source.acquiredAtUtc)) {
    throw new Error(`${context}: attempt source completion postdates acquiredAt`);
  }
  return { replay, receiptPaths: receiptInventoryPaths(source.rawResponses) };
}

function validateAttemptChain(root, manifest, manifestSha256, seed, accepted, production,
  terminalRunAttempts = new Set(), remoteGitCache = new Set()) {
  const attempts = common.listAttemptFiles(root);
  const receiptPaths = [];
  let previous = { path: 'GENESIS', sha256: manifestSha256 };
  let previousUtc = null;
  for (const file of attempts) {
    const canonical = common.verifyCanonicalJson(file);
    const digest = canonical.digest;
    const attempt = canonical.value;
    exactKeys(attempt, ['schema', 'lockboxId', 'collectedAtUtc', 'remoteRun', 'previousAttempt',
      'status', 'reason', 'failureStage', 'errorSha256', 'manifestSha256', 'seedSha256',
      'sourceAcquisition', 'attemptSha256'], `${file}: attempt`);
    if (attempt.schema !== 'fg-control-residual-pls1-attempt-v1'
        || attempt.lockboxId !== common.LOCKBOX_ID || !exactUtc(attempt.collectedAtUtc)
        || attempt.manifestSha256 !== manifestSha256
        || attempt.seedSha256 !== manifest.seed.sha256
        || attempt.attemptSha256 !== hashWithout(attempt, 'attemptSha256')) {
      throw new Error(`${file}: attempt identity mismatch`);
    }
    exactKeys(attempt.previousAttempt, ['path', 'sha256'], `${file}: previous attempt`);
    equalCanonical(attempt.previousAttempt, previous, `${file}: attempt chain`);
    if (previousUtc && attempt.collectedAtUtc <= previousUtc) throw new Error(`${file}: attempt times not increasing`);
    validateRemoteRun(attempt.remoteRun, attempt.collectedAtUtc, production, manifest);
    if (production) assertRemoteHeadGitBinding(attempt.remoteRun, manifest, null, remoteGitCache);
    const expectedPath = common.attemptPath(root, attempt.collectedAtUtc,
      `${attempt.remoteRun.runId}-${attempt.remoteRun.runAttempt}`);
    if (common.normalizedAbsolutePath(file) !== common.normalizedAbsolutePath(expectedPath)) {
      throw new Error(`${file}: semantic attempt path mismatch`);
    }
    const runAttemptIdentity = `${attempt.remoteRun.runId}:${attempt.remoteRun.runAttempt}`;
    if (terminalRunAttempts.has(runAttemptIdentity)) {
      throw new Error(`${file}: duplicate terminal artifact for GitHub run attempt ${runAttemptIdentity}`);
    }
    terminalRunAttempts.add(runAttemptIdentity);
    const sourceResult = validateAttemptSource(root, attempt.sourceAcquisition, attempt, seed,
      `${file}: attempt source`);
    receiptPaths.push(...sourceResult.receiptPaths);
    const nonFailure = attempt.failureStage === null && attempt.errorSha256 === null;
    if (attempt.status === common.ATTEMPT_STATUS.SKIPPED_PAST_CUTOFF) {
      if (!nonFailure || attempt.reason !== common.ATTEMPT_REASON.PRE_ACQUISITION_CUTOFF
          || attempt.sourceAcquisition.state !== common.ACQUISITION_STATE.NOT_STARTED
          || new Date(attempt.collectedAtUtc).getUTCHours() < 12) {
        throw new Error(`${file}: invalid pre-acquisition cutoff attempt`);
      }
    } else if (attempt.status === common.ATTEMPT_STATUS.SKIPPED_ALREADY_RECORDED_DATE) {
      const prior = accepted.filter(bundle => bundle.collectedAtUtc < attempt.collectedAtUtc);
      const latestFrozen = seedBuilder.frozenTargetCalendar(
        seed.sourceIdentityContract, attempt.sourceAcquisition.retrievalDateUtc).at(-1);
      if (!nonFailure
          || attempt.reason !== common.ATTEMPT_REASON.LATEST_COMPLETED_SOURCE_SESSION_ALREADY_IN_LEDGER
          || attempt.sourceAcquisition.state !== common.ACQUISITION_STATE.NOT_STARTED
          || new Date(attempt.collectedAtUtc).getUTCHours() >= 12
          || latestFrozen !== permanentLedgerTerminalDate(seed, prior)) {
        throw new Error(`${file}: false already-recorded-date attempt`);
      }
    } else if (attempt.status === common.ATTEMPT_STATUS.SUCCESS_NO_NEW_DECISION) {
      if (!nonFailure || attempt.reason !== common.ATTEMPT_REASON.NO_NEW_COMPLETED_COMMON_TARGET_SESSION
          || attempt.sourceAcquisition.state !== common.ACQUISITION_STATE.COMPLETE_REPLAY_VERIFIED
          || !sourceResult.replay) throw new Error(`${file}: invalid no-new-decision attempt`);
      const prior = accepted.filter(bundle => bundle.collectedAtUtc < attempt.collectedAtUtc);
      for (const key of common.MARKET_ORDER) {
        if (expectedProspectiveRows(sourceResult.replay.markets[key], primaryRows(seed, prior, key),
          attempt.sourceAcquisition.dataAvailableAtUtc).length !== 0) {
          throw new Error(`${file}: false no-new-decision attempt`);
        }
      }
    } else if (attempt.status === common.ATTEMPT_STATUS.FAILED_NO_DECISION) {
      if (!common.ATTEMPT_FAILURE_STAGE.includes(attempt.failureStage)
          || attempt.reason !== `FAILED_${attempt.failureStage}` || !sha(attempt.errorSha256)) {
        throw new Error(`${file}: failure attempt is not stage-coded`);
      }
      const expectedState = attempt.failureStage === 'PREFLIGHT'
        ? common.ACQUISITION_STATE.NOT_STARTED
        : (['ACQUISITION', 'RAW_PERSISTENCE', 'OFFLINE_REPLAY'].includes(attempt.failureStage)
          ? common.ACQUISITION_STATE.PARTIAL_UNVERIFIED
          : common.ACQUISITION_STATE.COMPLETE_REPLAY_VERIFIED);
      if (attempt.sourceAcquisition.state !== expectedState) {
        throw new Error(`${file}: failure stage/acquisition state mismatch`);
      }
    } else {
      throw new Error(`${file}: unknown attempt status ${attempt.status}`);
    }
    previous = { path: path.relative(root, file).replace(/\\/g, '/'), sha256: digest };
    previousUtc = attempt.collectedAtUtc;
  }
  return { count: attempts.length, files: attempts, receiptPaths };
}

function deriveFinalTrustState({ production, endpoint, anchorPolicyReady,
  perDecisionAnchorCoverageVerified }) {
  const trusted = Boolean(production === true
    && endpoint && endpoint.statisticalGatesPassed === true
    && endpoint.x2StatisticalGatesPassed === true
    && anchorPolicyReady === true
    && perDecisionAnchorCoverageVerified === true);
  return model.deepFreeze({
    trusted,
    x2Trusted: trusted,
    forbiddenClaims: trusted ? [] : ['TRUSTED', 'VALIDATED', 'BEATS_INDEX', '2X'],
  });
}

function verifyLockbox(root = common.LOCKBOX_ROOT,
  { verifyPinnedFiles = common.isProductionLockboxRoot(root) } = {}) {
  const production = common.isProductionLockboxRoot(root);
  const seedPath = path.join(root, 'freeze', 'seed.json');
  const manifestPath = path.join(root, 'freeze', 'manifest.json');
  const seedCanonical = common.verifyCanonicalJson(seedPath);
  const manifestCanonical = common.verifyCanonicalJson(manifestPath);
  const seedSha256 = seedCanonical.digest;
  const manifestSha256 = manifestCanonical.digest;
  const seed = seedCanonical.value;
  const manifest = manifestCanonical.value;
  validateSeed(seed, root);
  validateManifest(manifest, seedSha256, verifyPinnedFiles, seed.sourceIdentityContractSha256,
    seed.sourceIdentityContract.requiredSymbols, seed.sourceIdentityContract.evidenceReference,
    production);
  if (production && verifyPinnedFiles) {
    const relativeManifest = path.relative(common.ROOT, common.MANIFEST_PATH).replace(/\\/g, '/');
    const committedManifest = gitObjectBytes('HEAD', relativeManifest);
    if (!committedManifest.equals(fs.readFileSync(common.MANIFEST_PATH))) {
      throw new Error('current manifest bytes are not committed in checked-out HEAD');
    }
  }
  const inventoryFiles = new Set([
    path.relative(root, seedPath).replace(/\\/g, '/'),
    `${path.relative(root, seedPath).replace(/\\/g, '/')}.sha256`,
    path.relative(root, manifestPath).replace(/\\/g, '/'),
    `${path.relative(root, manifestPath).replace(/\\/g, '/')}.sha256`,
    ...receiptInventoryPaths(seed.sourceReceipts),
  ]);
  const files = common.listDecisionFiles(root);
  const accepted = [];
  let previousSha256 = manifestSha256;
  let previousDate = 'MANIFEST';
  let previousCollectedAtUtc = null;
  let manifestCommitSha = null;
  const terminalRunAttempts = new Set();
  const remoteGitCache = new Set();
  for (const file of files) {
    const canonical = common.verifyCanonicalJson(file);
    const bundleSha256 = canonical.digest;
    const bundle = canonical.value;
    exactKeys(bundle, ['schema', 'status', 'lockboxId', 'modelId', 'manifestSha256', 'seedSha256',
      'manifestCommitSha', 'mode', 'collectedAtUtc', 'signalKnownAtUtc', 'decisionDate',
      'previousBundle', 'remoteRun', 'sourceAcquisition', 'marketOrder', 'markets',
      'forbiddenUntilTrustGate'], `${file}: decision bundle`);
    if (bundle.schema !== 'fg-control-residual-pls1-six-market-decision-bundle-v1'
        || bundle.status !== 'PROSPECTIVE_CANDIDATE_NOT_YET_TRUSTED'
        || bundle.lockboxId !== manifest.lockboxId || bundle.modelId !== model.MODEL_ID
        || bundle.manifestSha256 !== manifestSha256 || bundle.seedSha256 !== seedSha256
        || bundle.signalKnownAtUtc !== bundle.collectedAtUtc || !exactUtc(bundle.collectedAtUtc)
        || !exactDate(bundle.decisionDate)) throw new Error(`${file}: bundle identity mismatch`);
    equalCanonical(bundle.forbiddenUntilTrustGate,
      ['TRUSTED', 'VALIDATED', 'BEATS_INDEX', '2X'],
      `${file}: forbidden claims before full trust gate`);
    if (bundle.previousBundle.sha256 !== previousSha256
        || bundle.previousBundle.decisionDate !== previousDate) throw new Error(`${file}: bundle chain broken`);
    exactKeys(bundle.previousBundle, ['decisionDate', 'sha256'], `${file}: previous bundle`);
    if (common.normalizedAbsolutePath(file)
        !== common.normalizedAbsolutePath(common.decisionPath(root, bundle.decisionDate))) {
      throw new Error(`${file}: semantic path/date mismatch`);
    }
    if (previousCollectedAtUtc && bundle.collectedAtUtc <= previousCollectedAtUtc) {
      throw new Error(`${file}: collection times are not increasing`);
    }
    if (new Date(bundle.collectedAtUtc).getUTCHours() >= 12) throw new Error(`${file}: post-cutoff decision`);
    const expectedMode = accepted.length ? 'DAILY_OR_RECOVERY_REMOTE_RUN' : 'POST_MANIFEST_REMOTE_ACTIVATION';
    if (bundle.mode !== expectedMode) throw new Error(`${file}: collection mode mismatch`);
    if (!sha(bundle.manifestCommitSha, 40)) throw new Error(`${file}: manifest commit identity invalid`);
    if (manifestCommitSha === null) manifestCommitSha = bundle.manifestCommitSha;
    else if (manifestCommitSha !== bundle.manifestCommitSha) throw new Error(`${file}: manifest commit identity changed`);
    validateRemoteRun(bundle.remoteRun, bundle.collectedAtUtc, production, manifest);
    if (production) {
      assertRemoteHeadGitBinding(bundle.remoteRun, manifest, bundle.manifestCommitSha, remoteGitCache);
    }
    const runAttemptIdentity = `${bundle.remoteRun.runId}:${bundle.remoteRun.runAttempt}`;
    if (terminalRunAttempts.has(runAttemptIdentity)) {
      throw new Error(`${file}: duplicate terminal artifact for GitHub run attempt ${runAttemptIdentity}`);
    }
    terminalRunAttempts.add(runAttemptIdentity);
    equalCanonical(bundle.marketOrder, common.MARKET_ORDER, `${file}: market order`);
    const source = bundle.sourceAcquisition;
    exactKeys(source, ['state', 'range', 'retrievalDateUtc', 'acquiredAtUtc', 'dataAvailableAtUtc',
      'marketfgNormalizedSha256', 'targetCalendarSha256', 'alignedMarketsSha256',
      'sourceSelections', 'rawResponses'], `${file}: source acquisition`);
    if (!source || source.state !== common.ACQUISITION_STATE.COMPLETE_REPLAY_VERIFIED
        || source.range !== '5y' || !exactDate(source.retrievalDateUtc)
        || !exactUtc(source.acquiredAtUtc) || source.acquiredAtUtc > bundle.collectedAtUtc
        || !exactUtc(source.dataAvailableAtUtc)
        || source.acquiredAtUtc > source.dataAvailableAtUtc
        || source.dataAvailableAtUtc > bundle.signalKnownAtUtc
        || source.retrievalDateUtc !== bundle.collectedAtUtc.slice(0, 10)
        || source.retrievalDateUtc !== source.acquiredAtUtc.slice(0, 10)
        || !sha(source.marketfgNormalizedSha256) || !sha(source.targetCalendarSha256)
        || !sha(source.alignedMarketsSha256)) {
      throw new Error(`${file}: acquisition timing/identity mismatch`);
    }
    if (bundle.decisionDate >= source.retrievalDateUtc) throw new Error(`${file}: non-completed decision session`);
    const replay = replaySourceAcquisition(root, source, `${bundle.decisionDate} source replay`,
      seed.sourceIdentityContract);
    validateReceiptEnvelope(source.rawResponses, bundle.remoteRun, source.acquiredAtUtc,
      source.dataAvailableAtUtc, bundle.signalKnownAtUtc, `${file}: bundle`);
    if (replay.marketfgNormalizedSha256 !== source.marketfgNormalizedSha256
        || replay.targetCalendarSha256 !== source.targetCalendarSha256
        || model.hashCanonical(replay.markets) !== source.alignedMarketsSha256) {
      throw new Error(`${file}: normalized source replay mismatch`);
    }
    for (const receipt of source.rawResponses) {
      if (receipt.completedAtUtc > source.acquiredAtUtc) {
        throw new Error(`${file}: source completed after acquisition completion`);
      }
    }
    inventoryFiles.add(path.relative(root, file).replace(/\\/g, '/'));
    inventoryFiles.add(`${path.relative(root, file).replace(/\\/g, '/')}.sha256`);
    receiptInventoryPaths(source.rawResponses).forEach(receiptPath => inventoryFiles.add(receiptPath));
    for (const key of common.MARKET_ORDER) {
      const record = bundle.markets[key];
      if (record && typeof record === 'object') {
        exactKeys(record, ['marketClass', 'sentimentReferenceId', 'targetId', 'cashId',
          'newRows', 'newRowsSha256', 'missedDecisionDates', 'inputRow',
          'inputRowSha256', 'decisions', 'fit', 'resolvedEvents'],
        `${file}: ${key} market record`);
        exactKeys(record.decisions, ['M0', 'M1'], `${file}: ${key} decisions`);
      }
      const priorRows = primaryRows(seed, accepted, key);
      const expectedNew = expectedProspectiveRows(replay.markets[key], priorRows,
        source.dataAvailableAtUtc);
      if (!record || record.marketClass !== common.TARGETS[key].marketClass
          || record.targetId !== common.TARGETS[key].symbol || record.cashId !== common.CASH.symbol
          || !Array.isArray(record.newRows) || !record.newRows.length) {
        throw new Error(`${file}: ${key} mapping/new-row mismatch`);
      }
      record.newRows.forEach((row, index) => validateRowShape(row, `${file}: ${key} new row ${index}`));
      equalCanonical(record.newRows, expectedNew, `${bundle.decisionDate} ${key} raw-derived new rows`);
      if (record.newRowsSha256 !== model.hashCanonical(record.newRows)
          || record.inputRowSha256 !== model.hashCanonical(record.inputRow)
          || record.inputRow.date !== bundle.decisionDate
          || record.inputRow.availableAtUtc !== source.dataAvailableAtUtc) {
        throw new Error(`${file}: ${key} row identity/availability mismatch`);
      }
      equalCanonical(record.inputRow, record.newRows.at(-1), `${file}: ${key} final input row`);
      equalCanonical(record.missedDecisionDates, record.newRows.slice(0, -1).map(row => row.date),
        `${file}: ${key} missed dates`);
      if (!(bundle.decisionDate > seed.firstProspectiveDecisionMustBeAfter[key])) {
        throw new Error(`${file}: ${key} decision reuses historical seed date`);
      }
      const rows = [...priorRows, ...record.newRows.map(row => ({ ...row, availableAtUtc: null }))];
      rows[rows.length - 1] = { ...record.inputRow };
      const priorMarket = accepted.length ? accepted.at(-1).markets[key] : null;
      const positions = priorMarket ? {
        M0: priorMarket.decisions.M0.targetPosition,
        M1: priorMarket.decisions.M1.targetPosition,
      } : { M0: 'LONG', M1: 'LONG' };
      const decisionReplay = model.buildLatestDecision({
        key, name: seed.markets[key].name, marketClass: seed.markets[key].marketClass,
        targetId: seed.markets[key].targetId, cashId: seed.markets[key].cashId, rows,
      }, positions);
      equalCanonical(record.decisions.M0,
        model.stampDecisionAvailability(decisionReplay.M0, bundle.signalKnownAtUtc),
        `${bundle.decisionDate} ${key} M0`);
      equalCanonical(record.decisions.M1,
        model.stampDecisionAvailability(decisionReplay.M1, bundle.signalKnownAtUtc),
        `${bundle.decisionDate} ${key} M1`);
      equalCanonical(record.fit, decisionReplay.fit, `${bundle.decisionDate} ${key} fit`);
      const eventRows = [...priorRows, ...record.newRows.map(row => ({ ...row, availableAtUtc: null }))];
      equalCanonical(record.resolvedEvents, expectedEvents(accepted, key, eventRows),
        `${bundle.decisionDate} ${key} events`);
      for (const modelKey of ['M0', 'M1']) {
        const decision = record.decisions[modelKey];
        if (decision.decisionSha256 !== hashWithout(decision, 'decisionSha256')
            || !['BUY', 'SELL'].includes(decision.action)) {
          throw new Error(`${bundle.decisionDate} ${key} ${modelKey}: decision identity mismatch`);
        }
      }
      if (record.fit && record.fit.ok && record.fit.fitSha256 !== hashWithout(record.fit, 'fitSha256')) {
        throw new Error(`${bundle.decisionDate} ${key}: fit identity mismatch`);
      }
      for (const event of record.resolvedEvents) {
        if (event.eventSha256 !== hashWithout(event, 'eventSha256')) {
          throw new Error(`${bundle.decisionDate} ${key}: event identity mismatch`);
        }
      }
    }
    accepted.push(bundle);
    previousSha256 = bundleSha256;
    previousDate = bundle.decisionDate;
    previousCollectedAtUtc = bundle.collectedAtUtc;
  }
  const attemptResult = validateAttemptChain(root, manifest, manifestSha256, seed, accepted, production,
    terminalRunAttempts, remoteGitCache);
  if (production && manifestCommitSha !== null) {
    require('./pls1-lockbox-git-binding').assertGitObjectBinding({
      repoRoot: common.ROOT,
      manifestPath: common.MANIFEST_PATH,
      manifestCommitSha,
    });
  }
  for (const file of attemptResult.files) {
    const relative = path.relative(root, file).replace(/\\/g, '/');
    inventoryFiles.add(relative);
    inventoryFiles.add(`${relative}.sha256`);
  }
  attemptResult.receiptPaths.forEach(receiptPath => inventoryFiles.add(receiptPath));
  const inventory = require('./pls1-lockbox-inventory').assertClosedInventory(root,
    [...inventoryFiles]);
  const endpoint = require('./pls1-lockbox-evaluate').evaluateProspectiveEndpoint({
    manifest,
    bundles: accepted,
  });
  let anchorPolicyReady = false;
  let anchorPolicyBlockReason = null;
  try {
    require('./pls1-lockbox-anchor').assertEndpointAnchorPolicyReady();
    anchorPolicyReady = true;
  } catch (error) {
    anchorPolicyBlockReason = String(error.message || error);
  }
  // This must be set only by replaying every decision's archived TUF selection,
  // Sigstore bundle, independently derived execution deadline, and current-policy
  // revalidation. A global policy switch alone can never authorize trust.
  const perDecisionAnchorCoverageVerified = false;
  const finalTrust = deriveFinalTrustState({
    production,
    endpoint,
    anchorPolicyReady,
    perDecisionAnchorCoverageVerified,
  });
  return model.deepFreeze({
    ok: true,
    integrity: 'VERIFIED_BY_ROLE_BOUND_RESPONSE_BODY_REPLAY_AND_INDEPENDENT_CAUSAL_RECOMPUTATION',
    decisions: accepted.length,
    attempts: attemptResult.count,
    inventorySha256: inventory.inventorySha256,
    firstDecision: accepted.length ? accepted[0].decisionDate : null,
    lastDecision: accepted.length ? accepted.at(-1).decisionDate : null,
    endpoint,
    anchorPolicy: {
      ready: anchorPolicyReady,
      perDecisionCoverageVerified: perDecisionAnchorCoverageVerified,
      blockReason: anchorPolicyBlockReason
        || (perDecisionAnchorCoverageVerified ? null
          : 'PER_DECISION_TUF_SELECTION_BUNDLE_DEADLINE_AND_CURRENT_POLICY_REPLAY_NOT_IMPLEMENTED'),
    },
    trusted: finalTrust.trusted,
    x2Trusted: finalTrust.x2Trusted,
    verdict: finalTrust.trusted ? 'TRUSTED' : 'NOT_TRUSTED',
    forbiddenClaims: finalTrust.forbiddenClaims,
  });
}

module.exports = Object.freeze({
  hashWithout,
  equalCanonical,
  exactKeys,
  verifyReceipts,
  replaySourceAcquisition,
  validateSeed,
  validateManifest,
  assertRemoteHeadGitBinding,
  primaryRows,
  expectedProspectiveRows,
  expectedEvents,
  validateRemoteRun,
  validateReceiptEnvelope,
  receiptInventoryPaths,
  permanentLedgerTerminalDate,
  validateAttemptSource,
  validateAttemptChain,
  deriveFinalTrustState,
  verifyLockbox,
});

if (require.main === module) {
  try {
    process.stdout.write(`${JSON.stringify(verifyLockbox(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`PLS1 verification failed: ${error.stack || error.message}\n`);
    process.exit(1);
  }
}
