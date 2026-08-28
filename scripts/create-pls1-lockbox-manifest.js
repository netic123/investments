'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const common = require('./pls1-lockbox-common');
const model = require('../research/fear_greed_control_residual_pls1');

const DATA_RIGHTS_STATUS = Object.freeze({
  PRODUCTION: 'CONFIRMED_BY_WRITTEN_LICENSE',
  LOCAL_FIXTURE: 'LOCAL_TEST_FIXTURE_ONLY_NOT_PRODUCTION_CONFIRMATION',
});
const LOCAL_FIXTURE_EVIDENCE_REFERENCE = 'LOCAL_TEST_FIXTURE_ONLY';
const SOURCE_IDENTITY_SCHEMA_POLICY = Object.freeze({
  status: 'BLOCKED_STABLE_SOURCE_IDENTITIES_NOT_MACHINE_BOUND',
  reason: 'The v1 source contract does not yet bind stable security/share-class identifiers, index owner/return variants, crypto venue or aggregation methodology, adjustment methodology, and corporate-action identity history.',
});

const PINNED_FILES = Object.freeze([
  '.github/workflows/pls1-lockbox.yml',
  'research/FEAR_GREED_CONTROL_RESIDUAL_PLS1_PROTOCOL.md',
  'research/fear_greed_control_residual_pls1.js',
  'research/PLS1_SOURCE_IDENTITY_CONTRACT.json',
  'research/FEAR_GREED_EXPANDING_BINARY_PROTOCOL.md',
  'research/fear_greed_expanding_binary.js',
  'scripts/pls1-lockbox-common.js',
  'scripts/build-pls1-lockbox-seed.js',
  'scripts/create-pls1-lockbox-manifest.js',
  'scripts/pls1-lockbox-collect.js',
  'scripts/pls1-lockbox-verify.js',
  'scripts/pls1-lockbox-evaluate.js',
  'scripts/pls1-lockbox-anchor.js',
  'scripts/pls1-lockbox-git-binding.js',
  'scripts/pls1-lockbox-inventory.js',
  'test/fear_greed_control_residual_pls1.test.js',
  'test/fear_greed_control_residual_pls1_properties.test.js',
  'test/pls1_lockbox.test.js',
  'test/pls1_lockbox_anchor.test.js',
  'test/pls1_lockbox_tuf_anchor.test.js',
  'test/fixtures/sigstore-root-10.json.gz.b64',
  'test/pls1_lockbox_evaluator.test.js',
  'test/pls1_lockbox_git_binding.test.js',
  'test/pls1_lockbox_inventory.test.js',
  'test/pls1_lockbox_seed_common_regressions.test.js',
  'test/pls1_lockbox_tail_equivalence.test.js',
  'marketfg.js',
  'data/config.json',
]);

const INSTRUMENT_IDENTITIES = Object.freeze({
  BITW: Object.freeze({ venue: 'NYSE Arca', currency: 'USD', cusip: '091749101',
    officialUrl: 'https://bitwiseinvestments.com/newsroom/bitwises-bitw-the-first-and-largest-crypto-index-fund-to-begin-trading-on-nyse' }),
  EWD: Object.freeze({ venue: 'NYSE Arca', currency: 'USD', cusip: '464286756',
    officialUrl: 'https://www.ishares.com/us/products/239684/ishares-msci-sweden-etf' }),
  SPY: Object.freeze({ venue: 'NYSE Arca', currency: 'USD', cusip: '78462F103', isin: 'US78462F1030',
    officialUrl: 'https://www.ssga.com/us/en/individual/etfs/state-street-spdr-sp-500-etf-trust-spy' }),
  XLK: Object.freeze({ venue: 'NYSE Arca', currency: 'USD',
    officialUrl: 'https://www.ssga.com/us/en/intermediary/etfs/state-street-technology-select-sector-spdr-etf-xlk' }),
  VGK: Object.freeze({ venue: 'NYSE Arca', currency: 'USD',
    officialUrl: 'https://advisors.vanguard.com/investments/products/vgk/vanguard-ftse-europe-etf' }),
  ACWI: Object.freeze({ venue: 'Nasdaq', currency: 'USD', cusip: '464288257',
    officialUrl: 'https://www.ishares.com/us/products/239600/ishares-msci-acwi-etf' }),
  BIL: Object.freeze({ venue: 'NYSE Arca', currency: 'USD', cusip: '78468R663', isin: 'US78468R6633',
    officialUrl: 'https://www.ssga.com/us/en/intermediary/etfs/state-street-spdr-bloomberg-1-3-month-t-bill-etf-bil' }),
});

function gitValue(args) {
  return childProcess.execFileSync('git', args, { cwd: common.ROOT, encoding: 'utf8' }).trim();
}

function fileIdentity(relativePath) {
  const bytes = fs.readFileSync(path.join(common.ROOT, relativePath));
  return { path: relativePath, sha256: common.sha256(bytes), bytes: bytes.length };
}

function assertCleanCommittedInputs(seedPath) {
  const status = gitValue(['status', '--porcelain=v1', '--untracked-files=all']);
  if (status !== '') throw new Error('manifest creation requires a completely clean worktree');
  const required = [...PINNED_FILES, path.relative(common.ROOT, seedPath).replace(/\\/g, '/'),
    `${path.relative(common.ROOT, seedPath).replace(/\\/g, '/')}.sha256`];
  for (const relativePath of required) {
    gitValue(['ls-files', '--error-unmatch', '--', relativePath]);
    const committed = childProcess.execFileSync('git', ['show', `HEAD:${relativePath}`], { cwd: common.ROOT });
    const current = fs.readFileSync(path.join(common.ROOT, relativePath));
    if (!committed.equals(current)) throw new Error(`${relativePath}: bytes are not frozen in HEAD`);
  }
}

function assertSourceIdentitySchemaReady() {
  throw new Error(`manifest blocked: ${SOURCE_IDENTITY_SCHEMA_POLICY.status}: ${SOURCE_IDENTITY_SCHEMA_POLICY.reason}`);
}

function requireExternalPrerequisites(sourceIdentityEvidenceReference) {
  if (typeof sourceIdentityEvidenceReference !== 'string' || !sourceIdentityEvidenceReference
      || sourceIdentityEvidenceReference === LOCAL_FIXTURE_EVIDENCE_REFERENCE) {
    throw new Error('manifest blocked: the seed lacks independently reviewed production data-rights evidence');
  }
  const dataRights = process.env.PLS1_DATA_RIGHTS_EVIDENCE_REFERENCE;
  const independentAnchor = process.env.PLS1_INDEPENDENT_ANCHOR_REFERENCE;
  if (!dataRights) {
    throw new Error('manifest blocked: written perpetual raw-retention and public-redistribution rights are unconfirmed');
  }
  if (dataRights !== sourceIdentityEvidenceReference) {
    throw new Error('manifest blocked: data-rights evidence must exactly match the independently verified seed source contract');
  }
  if (!independentAnchor) {
    throw new Error('manifest blocked: an independent external timestamp-anchor reference is required');
  }
  assertSourceIdentitySchemaReady();
  require('./pls1-lockbox-anchor').assertEndpointAnchorPolicyReady();
  let protection;
  let workflow;
  try {
    protection = JSON.parse(childProcess.execFileSync('gh', [
      'api', `repos/${common.GITHUB_REMOTE.repository}/branches/${common.GITHUB_REMOTE.branch}/protection`,
    ], { cwd: common.ROOT, encoding: 'utf8' }));
  } catch {
    throw new Error('manifest blocked: GitHub main branch protection is absent or unverifiable');
  }
  if (!protection.enforce_admins || protection.enforce_admins.enabled !== true
      || !protection.allow_force_pushes || protection.allow_force_pushes.enabled !== false
      || !protection.allow_deletions || protection.allow_deletions.enabled !== false) {
    throw new Error('manifest blocked: main must enforce admins and block force pushes and deletion');
  }
  try {
    workflow = JSON.parse(childProcess.execFileSync('gh', [
      'api', `repos/${common.GITHUB_REMOTE.repository}/actions/workflows/${path.basename(common.GITHUB_REMOTE.workflowPath)}`,
    ], { cwd: common.ROOT, encoding: 'utf8' }));
  } catch {
    throw new Error('manifest blocked: the frozen GitHub Actions workflow identity is absent or unverifiable');
  }
  if (!Number.isSafeInteger(workflow.id) || workflow.id < 1
      || workflow.path !== common.GITHUB_REMOTE.workflowPath || workflow.state !== 'active') {
    throw new Error('manifest blocked: the GitHub Actions workflow id/path/state is invalid');
  }
  return {
    dataRights,
    independentAnchor,
    branchProtectionSha256: model.hashCanonical(protection),
    workflowId: String(workflow.id),
  };
}

function createManifest({ lockboxRoot = common.LOCKBOX_ROOT } = {}) {
  const seedPath = path.join(lockboxRoot, 'freeze', 'seed.json');
  const manifestPath = path.join(lockboxRoot, 'freeze', 'manifest.json');
  if (fs.existsSync(manifestPath)) throw new Error('manifest already exists; it is immutable');
  const production = common.isProductionLockboxRoot(lockboxRoot);
  if (production) assertCleanCommittedInputs(seedPath);
  const seedCanonical = common.verifyCanonicalJson(seedPath);
  const seedSha256 = seedCanonical.digest;
  const seed = seedCanonical.value;
  require('./pls1-lockbox-verify').validateSeed(seed, lockboxRoot);
  const prerequisites = production
    ? requireExternalPrerequisites(seed.sourceIdentityContract.evidenceReference)
    : {
      dataRights: LOCAL_FIXTURE_EVIDENCE_REFERENCE,
      independentAnchor: 'LOCAL_TEST_FIXTURE_ONLY',
      branchProtectionSha256: '0'.repeat(64),
      workflowId: '1',
    };
  if (!production
      && seed.sourceIdentityContract.evidenceReference !== LOCAL_FIXTURE_EVIDENCE_REFERENCE) {
    throw new Error('local manifest creation requires the explicit local-test evidence marker');
  }
  const head = gitValue(['rev-parse', 'HEAD']);
  const tree = gitValue(['rev-parse', 'HEAD^{tree}']);
  const pinnedFiles = PINNED_FILES.map(fileIdentity);
  const manifest = {
    schema: 'fg-control-residual-pls1-manifest-v1',
    status: 'LOCKED_BEFORE_FIRST_PROSPECTIVE_DECISION',
    lockboxId: 'control-residual-pls1-v1',
    modelId: model.MODEL_ID,
    modelVersion: model.SCHEMA_VERSION,
    protocolFreezeMarker: model.PROTOCOL_FREEZE_MARKER,
    frozenAtUtc: new Date().toISOString(),
    sourceCommitSha: head,
    sourceTreeSha: tree,
    runtime: {
      required: common.REQUIRED_RUNTIME,
      productionPlatform: 'linux',
      productionArch: 'x64',
      mismatchPolicy: 'NEW_MANIFEST_REQUIRED_UNLESS_BYTE_EQUIVALENCE_IS_PROVED_BEFORE_ANY_NEW_DECISION',
    },
    seed: {
      path: path.relative(common.ROOT, seedPath).replace(/\\/g, '/'),
      sha256: seedSha256,
      status: seed.status,
      createdAtUtc: seed.createdAtUtc,
    },
    schedule: {
      triggerExpressionsUtc: common.SCHEDULE_EXPRESSIONS,
      activationRule: 'first qualifying remote run automatically activates only on a target session strictly after the complete seed',
      decisionSafetyCutoffUtc: '12:00:00Z',
      semanticKey: ['manifestSha256', 'decisionDate'],
      nominalDelayIsEvidence: false,
      missedSessionsAreBackfilledAsDecisions: false,
      missedSessionsRemainInPrimaryPriceLedger: true,
    },
    marketOrder: common.MARKET_ORDER,
    componentOrder: model.COMPONENT_KEYS,
    controlOrder: model.CONTROL_KEYS,
    minimumMaturedRows: model.MIN_MATURED_ROWS,
    currentZLimit: model.CURRENT_Z_LIMIT,
    maximumCurrentControlMahalanobisRadius: model.MAX_CURRENT_CONTROL_MAHALANOBIS_RADIUS,
    maximumCurrentPlsScoreZ: model.MAX_CURRENT_PLS_SCORE_Z,
    numericTolerance: model.NUMERIC_TOLERANCE,
    maximumControlNormalConditionInfinity: model.MAX_CONTROL_NORMAL_CONDITION_INFINITY,
    exactDyadicComparisonPolicy: model.EXACT_DYADIC_COMPARISON_POLICY,
    label: 'log(riskyAdjustedClose[t+2]/riskyAdjustedClose[t+1])-log(BILAdjustedClose[t+2]/BILAdjustedClose[t+1])',
    execution: 'first target close strictly after feature close and recorded availability',
    targets: Object.fromEntries(common.MARKET_ORDER.map(key => {
      const target = common.TARGETS[key];
      return [key, { ...target, ...INSTRUMENT_IDENTITIES[target.symbol] }];
    })),
    cash: { ...common.CASH, ...INSTRUMENT_IDENTITIES[common.CASH.symbol] },
    costs: model.COSTS,
    upstream: {
      fearGreedEngine: 'repository production-v2 six-component engine',
      marketDataProvider: 'Yahoo Finance chart endpoint',
      adjustedClosePolicy: 'whole positive adjusted-close series required; no adjusted/unadjusted mixing',
      carryLimitCalendarDays: 7,
      userAgent: 'netic123-investments-pls1-lockbox/1.0',
      rawPolicy: 'exact decoded response-body bytes stored as deterministic gzip addressed by uncompressed SHA-256',
    },
    trustGate: {
      minimumCalendarDays: 1095,
      minimumMaturedForecastsPerMarket: 756,
      fixedFirstDecisionOriginsPerMarket: 756,
      extendWindowForMissingOrInvalidOrigins: false,
      m1MseRelativeToM0Maximum: 0.995,
      m1StressWealthMustExceed: ['M0', 'BUY_AND_HOLD'],
      clarkWestNeweyWestLag: 5,
      holmFamilyWiseAlpha: 0.05,
      x2EveryMarketMinimumRatio: 2,
      interimTuningOrEarlyGraduationAllowed: false,
    },
    dataRights: {
      requiredBeforeActivation: true,
      status: production ? DATA_RIGHTS_STATUS.PRODUCTION : DATA_RIGHTS_STATUS.LOCAL_FIXTURE,
      evidenceReference: prerequisites.dataRights,
      requiredScope: 'AUTOMATED_RETRIEVAL_PRIVATE_RETENTION_AND_PUBLIC_RAW_REDISTRIBUTION_INDEFINITELY',
      coveredSymbols: seed.sourceIdentityContract.requiredSymbols,
    },
    remoteIntegrity: {
      actionsApiBaseUrl: common.GITHUB_REMOTE.apiBaseUrl,
      repository: common.GITHUB_REMOTE.repository,
      repositoryId: common.GITHUB_REMOTE.repositoryId,
      branch: common.GITHUB_REMOTE.branch,
      ref: common.GITHUB_REMOTE.ref,
      serverUrl: common.GITHUB_REMOTE.serverUrl,
      workflowId: prerequisites.workflowId,
      workflowPath: common.GITHUB_REMOTE.workflowPath,
      workflowRef: common.GITHUB_REMOTE.workflowRef,
      branchProtectionRequired: true,
      forcePushAndDeletionBlockedRequired: true,
      enforceAdminsRequired: true,
      branchProtectionSnapshotSha256: prerequisites.branchProtectionSha256,
      independentTimestampAnchorRequired: true,
      independentTimestampAnchorReference: prerequisites.independentAnchor,
    },
    knownLimitations: [
      'BITW does not replicate the fixed seven-coin equal-weight sentiment reference basket',
      'BITW history before its December 2025 NYSE Arca uplisting reflects its earlier quoted structure',
      'historical seed availability times are unknowable and seed rows never count as validation',
      'predictive trust requires future outcomes; activation alone is not validation',
      'adjusted-close fills are hypothetical total-return proxy fills, not quoted or executed trades',
      'source license and retention rights are a trust prerequisite, not inferred from endpoint availability',
    ],
    pinnedFiles,
  };
  const written = common.createCanonicalWithSidecar(manifestPath, manifest);
  process.stdout.write(`${JSON.stringify({
    manifestPath: path.relative(common.ROOT, manifestPath).replace(/\\/g, '/'),
    manifestSha256: written.sha256,
    sourceCommitSha: head,
    sourceTreeSha: tree,
    seedSha256,
  }, null, 2)}\n`);
  return { manifest, written };
}

module.exports = Object.freeze({
  PINNED_FILES,
  INSTRUMENT_IDENTITIES,
  DATA_RIGHTS_STATUS,
  LOCAL_FIXTURE_EVIDENCE_REFERENCE,
  SOURCE_IDENTITY_SCHEMA_POLICY,
  assertSourceIdentitySchemaReady,
  assertCleanCommittedInputs,
  requireExternalPrerequisites,
  createManifest,
});

if (require.main === module) {
  try {
    createManifest();
  } catch (error) {
    process.stderr.write(`PLS1 manifest failed: ${error.stack || error.message}\n`);
    process.exit(1);
  }
}
