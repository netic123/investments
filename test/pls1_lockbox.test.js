'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const common = require('../scripts/pls1-lockbox-common');
const seedBuilder = require('../scripts/build-pls1-lockbox-seed');
const manifestBuilder = require('../scripts/create-pls1-lockbox-manifest');
const collector = require('../scripts/pls1-lockbox-collect');
const verifier = require('../scripts/pls1-lockbox-verify');
const model = require('../research/fear_greed_control_residual_pls1');

function isoDay(index) {
  return new Date(Date.UTC(2022, 0, 1 + index)).toISOString().slice(0, 10);
}

function completedSessionDates(length, retrievalDateUtc = '2026-08-28') {
  const dates = [];
  const cursor = new Date(`${retrievalDateUtc}T00:00:00.000Z`);
  while (dates.length < length) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    const date = cursor.toISOString().slice(0, 10);
    if (seedBuilder.isExpectedNyseSession(date)) dates.unshift(date);
  }
  return dates;
}

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pls1-lockbox-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function overwriteCanonicalWithSidecar(file, value) {
  const bytes = common.canonicalBytes(value);
  const digest = common.sha256(bytes);
  fs.writeFileSync(file, bytes);
  fs.writeFileSync(`${file}.sha256`, common.sidecarBytes(path.basename(file), digest));
}

function symbolSeed(symbol) {
  return [...symbol].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function yahooBody(symbol, length, { retrievalDateUtc = '2026-08-28', priceOffset = 0,
  firstTradeDate = null } = {}) {
  const seed = symbolSeed(symbol) + priceOffset;
  const dates = completedSessionDates(length, retrievalDateUtc);
  const timestamps = [];
  const closes = [];
  const adjusted = [];
  let value = 40 + (seed % 80);
  for (let index = 0; index < length; index += 1) {
    value *= Math.exp(0.00015 + (0.003 * Math.sin((index + seed) / (5 + (seed % 11))))
      + (0.0017 * Math.cos((index + (2 * seed)) / (13 + (seed % 7)))));
    timestamps.push(Date.parse(`${dates[index]}T12:00:00.000Z`) / 1000);
    closes.push(value);
    adjusted.push(value * (1 + ((index % 97) * 0.000001)));
  }
  return Buffer.from(JSON.stringify({
    chart: {
      result: [{
        meta: {
          symbol,
          exchangeTimezoneName: 'America/New_York',
          longName: `Synthetic ${symbol}`,
          currency: 'USD',
          exchangeName: symbol === 'ACWI' ? 'NMS' : 'PCX',
          instrumentType: 'ETF',
          firstTradeDate: firstTradeDate == null
            ? Date.parse(`${dates[0]}T14:30:00.000Z`) / 1000 : firstTradeDate,
        },
        timestamp: timestamps,
        indicators: { quote: [{ close: closes }], adjclose: [{ adjclose: adjusted }] },
      }],
      error: null,
    },
  }));
}

function sessionCalendar(firstDate, horizonDate = '2029-09-30') {
  const sessions = [];
  for (const cursor = new Date(`${firstDate}T00:00:00.000Z`);
    cursor.toISOString().slice(0, 10) <= horizonDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    if (seedBuilder.isExpectedNyseSession(date)) sessions.push(date);
  }
  return sessions;
}

function syntheticSourceIdentityContract(firstAdjustedDate) {
  const requiredSymbols = seedBuilder.requiredSourceSymbols();
  const sessions = sessionCalendar(firstAdjustedDate);
  const calendarId = 'SYNTHETIC_XNYS';
  const calendars = {
    [calendarId]: {
      evidenceReference: manifestBuilder.LOCAL_FIXTURE_EVIDENCE_REFERENCE,
      horizonDate: sessions.at(-1),
      sessions,
      sessionsSha256: model.hashCanonical(sessions),
      timezone: 'America/New_York',
    },
  };
  const firstTradeDate = Date.parse(`${firstAdjustedDate}T14:30:00.000Z`) / 1000;
  const identities = Object.fromEntries([...requiredSymbols].sort().map(symbol => [symbol, {
    calendarId,
    currency: 'USD',
    exchange: symbol === 'ACWI' ? 'NMS' : 'PCX',
    firstAdjustedDate,
    firstTradeDate,
    firstTradeDateLocal: firstAdjustedDate,
    instrumentType: 'ETF',
    providerSymbol: symbol,
    timezone: 'America/New_York',
  }]));
  return {
    calendars,
    evidenceReference: manifestBuilder.LOCAL_FIXTURE_EVIDENCE_REFERENCE,
    identities,
    requiredSymbols,
    schema: 'fg-control-residual-pls1-source-identities-v1',
    status: 'INDEPENDENTLY_VERIFIED_LICENSED_SOURCE_IDENTITIES',
  };
}

function sourceFixture(root, range, length, baseUtc, {
  retrievalDateUtc = baseUtc.slice(0, 10), fallbackSymbols = [], fallbackOrder = fallbackSymbols,
  sourceIdentityContract = null,
} = {}) {
  const contract = seedBuilder.expectedSourceContract(range);
  const firstDate = completedSessionDates(length, retrievalDateUtc)[0];
  const identities = sourceIdentityContract || syntheticSourceIdentityContract(firstDate);
  const sourceSelections = [];
  const receipts = [];
  function pushReceipt(selection, host, status, acceptedFor) {
    const ordinal = receipts.length;
    const phase = selection.role === 'COMPONENT' ? 'COMPONENT' : 'EXECUTABLE';
    const requestedRange = selection.requestedRange;
    const startedAtUtc = new Date(Date.parse(baseUtc) + (ordinal * 2000)).toISOString();
    const period2 = phase === 'COMPONENT'
      ? Math.floor(Date.parse(startedAtUtc) / 1000) + 86400
      : Math.floor(Date.parse(`${retrievalDateUtc}T00:00:00.000Z`) / 1000) + 86400;
    const query = requestedRange === 'max'
      ? `period1=0&period2=${period2}&interval=1d${phase === 'EXECUTABLE' ? '&events=div%2Csplits' : ''}`
      : `range=${requestedRange}&interval=1d${phase === 'EXECUTABLE' ? '&events=div%2Csplits' : ''}`;
    const bytes = yahooBody(selection.symbol, length, { retrievalDateUtc,
      firstTradeDate: identities.identities[selection.symbol].firstTradeDate });
    const raw = common.createRawBlob(root, bytes);
    const completedAtUtc = new Date(Date.parse(startedAtUtc) + 1000).toISOString();
    const url = `https://${host}/v8/finance/chart/${encodeURIComponent(selection.symbol)}?${query}`;
    receipts.push({
      requestOrdinal: ordinal,
      phase,
      method: 'GET',
      url,
      startedAtUtc,
      completedAtUtc,
      status,
      responseUrl: url,
      headers: { 'content-type': 'application/json' },
      acceptedFor: acceptedFor ? [selection.acceptedFor] : [],
      error: null,
      path: raw.path,
      rawSha256: raw.rawSha256,
      rawBytes: raw.rawBytes,
      gzipSha256: raw.gzipSha256,
      gzipBytes: raw.gzipBytes,
    });
    return ordinal;
  }
  const components = contract.selections.filter(selection => selection.role === 'COMPONENT');
  const executables = contract.selections.filter(selection => selection.role !== 'COMPONENT');
  for (const selection of components) {
    const requestOrdinal = pushReceipt(selection, 'query1.finance.yahoo.com', 200, true);
    sourceSelections.push({ ...selection, requestOrdinal });
  }
  const executableSelectionOrdinals = new Map();
  for (const selection of executables) {
    const fallback = fallbackSymbols.includes(selection.symbol);
    const requestOrdinal = pushReceipt(selection, 'query1.finance.yahoo.com', fallback ? 500 : 200, !fallback);
    if (!fallback) executableSelectionOrdinals.set(selection.symbol, requestOrdinal);
  }
  for (const symbol of fallbackOrder) {
    const selection = executables.find(item => item.symbol === symbol);
    if (!selection || !fallbackSymbols.includes(symbol)) throw new Error(`invalid fallback fixture symbol ${symbol}`);
    const requestOrdinal = pushReceipt(selection, 'query2.finance.yahoo.com', 200, true);
    executableSelectionOrdinals.set(symbol, requestOrdinal);
  }
  for (const selection of executables) {
    sourceSelections.push({ ...selection,
      requestOrdinal: executableSelectionOrdinals.get(selection.symbol) });
  }
  const replay = seedBuilder.replayAlignedDataFromReceipts({
    receipts,
    sourceSelections,
    loadRaw: receipt => common.verifyRawBlob(root, receipt),
    range,
    retrievalDateUtc,
    sourceIdentityContract: identities,
  });
  return { ...replay, receipts, sourceSelections, retrievalDateUtc,
    sourceIdentityContract: identities };
}

function manifestFixture(seed, seedSha256) {
  return {
    schema: 'fg-control-residual-pls1-manifest-v1',
    status: 'LOCKED_BEFORE_FIRST_PROSPECTIVE_DECISION',
    lockboxId: common.LOCKBOX_ID,
    modelId: model.MODEL_ID,
    modelVersion: model.SCHEMA_VERSION,
    protocolFreezeMarker: model.PROTOCOL_FREEZE_MARKER,
    frozenAtUtc: '2026-08-28T06:55:00.000Z',
    sourceCommitSha: '1'.repeat(40),
    sourceTreeSha: '2'.repeat(40),
    runtime: {
      required: common.REQUIRED_RUNTIME,
      productionPlatform: 'linux',
      productionArch: 'x64',
      mismatchPolicy: 'NEW_MANIFEST_REQUIRED_UNLESS_BYTE_EQUIVALENCE_IS_PROVED_BEFORE_ANY_NEW_DECISION',
    },
    seed: {
      path: 'freeze/seed.json', sha256: seedSha256,
      status: seed.status, createdAtUtc: seed.createdAtUtc,
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
    costs: model.COSTS,
    targets: Object.fromEntries(common.MARKET_ORDER.map(key => {
      const target = common.TARGETS[key];
      return [key, { ...target, ...manifestBuilder.INSTRUMENT_IDENTITIES[target.symbol] }];
    })),
    cash: { ...common.CASH, ...manifestBuilder.INSTRUMENT_IDENTITIES[common.CASH.symbol] },
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
      status: manifestBuilder.DATA_RIGHTS_STATUS.LOCAL_FIXTURE,
      evidenceReference: manifestBuilder.LOCAL_FIXTURE_EVIDENCE_REFERENCE,
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
      workflowId: '123456789',
      workflowPath: common.GITHUB_REMOTE.workflowPath,
      workflowRef: common.GITHUB_REMOTE.workflowRef,
      branchProtectionRequired: true,
      forcePushAndDeletionBlockedRequired: true,
      enforceAdminsRequired: true,
      branchProtectionSnapshotSha256: '0'.repeat(64),
      independentTimestampAnchorRequired: true,
      independentTimestampAnchorReference: 'LOCAL_TEST_FIXTURE_ONLY',
    },
    knownLimitations: [
      'BITW does not replicate the fixed seven-coin equal-weight sentiment reference basket',
      'BITW history before its December 2025 NYSE Arca uplisting reflects its earlier quoted structure',
      'historical seed availability times are unknowable and seed rows never count as validation',
      'predictive trust requires future outcomes; activation alone is not validation',
      'adjusted-close fills are hypothetical total-return proxy fills, not quoted or executed trades',
      'source license and retention rights are a trust prerequisite, not inferred from endpoint availability',
    ],
    pinnedFiles: manifestBuilder.PINNED_FILES.map(relativePath => ({
      path: relativePath,
      sha256: relativePath === 'research/PLS1_SOURCE_IDENTITY_CONTRACT.json'
        ? seed.sourceIdentityContractSha256 : 'a'.repeat(64),
      bytes: 1,
    })),
  };
}

function createFixture(t, { includeLiveSource = true } = {}) {
  const root = temporaryRoot(t);
  const seedFirstDate = completedSessionDates(1400, '2026-08-27')[0];
  const sourceIdentityContract = syntheticSourceIdentityContract(seedFirstDate);
  const seedSource = sourceFixture(root, 'max', 1400, '2026-08-27T05:00:00.000Z', {
    sourceIdentityContract,
  });
  const markets = seedSource.markets;
  const seed = {
    schema: 'fg-control-residual-pls1-seed-v1',
    status: 'PRE_ACTIVATION_WARMUP_ONLY_NOT_VALIDATION_EVIDENCE',
    lockboxId: common.LOCKBOX_ID,
    modelId: model.MODEL_ID,
    createdAtUtc: '2026-08-27T05:30:00.000Z',
    retrievalDateUtc: seedSource.retrievalDateUtc,
    sourceCommitSha: '1'.repeat(40),
    sourceTreeSha: '2'.repeat(40),
    sourceRuntime: common.runtimeIdentity(),
    sourceIdentityContract,
    sourceIdentityContractSha256: model.hashCanonical(sourceIdentityContract),
    marketOrder: common.MARKET_ORDER,
    componentOrder: model.COMPONENT_KEYS,
    cash: common.CASH,
    cashMetadata: seedSource.cashMetadata,
    marketfgNormalizedSha256: seedSource.marketfgNormalizedSha256,
    targetCalendarSha256: seedSource.targetCalendarSha256,
    firstProspectiveDecisionMustBeAfter: Object.fromEntries(common.MARKET_ORDER.map(key => [
      key, markets[key].rows.at(-1).date,
    ])),
    sourceSelections: seedSource.sourceSelections,
    sourceReceipts: seedSource.receipts,
    markets,
  };
  const seedPath = path.join(root, 'freeze', 'seed.json');
  const seedWrite = common.createCanonicalWithSidecar(seedPath, seed);
  const manifest = manifestFixture(seed, seedWrite.sha256);
  const manifestPath = path.join(root, 'freeze', 'manifest.json');
  const manifestWrite = common.createCanonicalWithSidecar(manifestPath, manifest);
  const liveSource = includeLiveSource
    ? sourceFixture(root, '5y', 1000, '2026-08-28T06:30:00.000Z', {
      sourceIdentityContract,
    }) : null;
  const acquired = liveSource ? {
    acquiredAtUtc: '2026-08-28T06:50:00.000Z',
    retrievalDateUtc: liveSource.retrievalDateUtc,
    range: '5y',
    markets: liveSource.markets,
    sourceSelections: liveSource.sourceSelections,
    cashMetadata: liveSource.cashMetadata,
    marketfgNormalizedSha256: liveSource.marketfgNormalizedSha256,
    targetCalendarSha256: liveSource.targetCalendarSha256,
  } : null;
  return {
    root, seed, seedSha256: seedWrite.sha256, manifest,
    manifestSha256: manifestWrite.sha256, acquired,
    liveReceipts: liveSource ? liveSource.receipts : [],
  };
}

test('schedules are retry labels only; actual cutoff is evaluated from completion time', () => {
  assert.deepEqual(common.SCHEDULE_EXPRESSIONS, ['17 6 * * *', '17 9 * * *', '17 11 * * *']);
  assert.equal(collector.beforeSafetyCutoff('2026-08-28T11:59:59.999Z'), true);
  assert.equal(collector.beforeSafetyCutoff('2026-08-28T12:00:00.000Z'), false);
  assert.equal(typeof common.slotForTime, 'undefined', 'actual time may not be relabelled as an inferred slot');
});

test('workflow action dependencies are exact verified release commits, never tags or invented SHAs', () => {
  const workflow = fs.readFileSync(path.join(common.ROOT, '.github', 'workflows',
    'pls1-lockbox.yml'), 'utf8');
  for (const action of [common.WORKFLOW_ACTIONS.checkout, common.WORKFLOW_ACTIONS.setupNode]) {
    const exact = `uses: ${action.repository}@${action.commitSha} # ${action.version}`;
    assert.equal(workflow.split(exact).length - 1, 1, `${action.repository} exact pin missing or duplicated`);
    assert.equal(new RegExp(`uses:\\s+${action.repository.replace('/', '\\/')}@v`).test(workflow), false,
      `${action.repository} may not use a mutable tag`);
  }
  const anchor = require('../scripts/pls1-lockbox-anchor');
  assert.deepEqual(anchor.ATTEST_ACTION, common.WORKFLOW_ACTIONS.attest);
  assert.equal(workflow.includes('8e8c483db84b4c5d6a2e0c0a0f6329d763d0ef06'), false);
  assert.equal(workflow.includes('1e60f620b9541d1c2438d8fb12923e8c4c7eefb5'), false);
});

test('atomic create is idempotent for exact bytes and refuses any overwrite', t => {
  const root = temporaryRoot(t);
  const file = path.join(root, 'x', 'value.json');
  assert.equal(common.atomicCreate(file, Buffer.from('one')).created, true);
  assert.equal(common.atomicCreate(file, Buffer.from('one')).created, false);
  assert.throws(() => common.atomicCreate(file, Buffer.from('two')), /append-only collision/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'one');
});

test('exact sidecars and deterministic compressed response bodies detect tampering', t => {
  const root = temporaryRoot(t);
  const file = path.join(root, 'record.json');
  common.createCanonicalWithSidecar(file, { b: 2, a: 1 });
  assert.match(common.verifySidecar(file), /^[a-f0-9]{64}$/);
  fs.appendFileSync(`${file}.sha256`, 'junk');
  assert.throws(() => common.verifySidecar(file), /exact sidecar mismatch/);
  const first = common.createRawBlob(root, Buffer.from('raw evidence'));
  const second = common.createRawBlob(root, Buffer.from('raw evidence'));
  assert.equal(first.gzipSha256, second.gzipSha256);
  assert.equal(common.verifyRawBlob(root, first).toString('utf8'), 'raw evidence');
  fs.appendFileSync(path.join(root, first.path), 'x');
  assert.throws(() => common.verifyRawBlob(root, first), /compressed raw receipt mismatch/);
});

test('manifest creation hashes and parses the seed from one canonical body read', t => {
  const fixture = createFixture(t, { includeLiveSource: false });
  const seedPath = path.join(fixture.root, 'freeze', 'seed.json');
  const manifestPath = path.join(fixture.root, 'freeze', 'manifest.json');
  fs.unlinkSync(manifestPath);
  fs.unlinkSync(`${manifestPath}.sha256`);
  const nativeRead = fs.readFileSync.bind(fs);
  let seedBodyReads = 0;
  t.mock.method(fs, 'readFileSync', (target, ...args) => {
    if (path.resolve(String(target)) === path.resolve(seedPath)) {
      seedBodyReads += 1;
      if (seedBodyReads > 1) return Buffer.from('{"schema":"TOCTOU_SECOND_READ"}');
    }
    return nativeRead(target, ...args);
  });
  const created = manifestBuilder.createManifest({ lockboxRoot: fixture.root });
  assert.equal(seedBodyReads, 1,
    'the manifest seed digest and parsed value must come from one exact body read');
  assert.equal(created.manifest.seed.sha256, fixture.seedSha256);
  assert.equal(created.manifest.exactDyadicComparisonPolicy,
    model.EXACT_DYADIC_COMPARISON_POLICY);
  assert.equal(created.manifest.dataRights.status,
    manifestBuilder.DATA_RIGHTS_STATUS.LOCAL_FIXTURE);
  assert.equal(created.manifest.dataRights.evidenceReference,
    fixture.seed.sourceIdentityContract.evidenceReference);
});

test('data-rights promotion is bound to the independently verified seed evidence', t => {
  const priorRights = process.env.PLS1_DATA_RIGHTS_EVIDENCE_REFERENCE;
  process.env.PLS1_DATA_RIGHTS_EVIDENCE_REFERENCE = 'ARBITRARY_FREE_TEXT';
  t.after(() => {
    if (priorRights === undefined) delete process.env.PLS1_DATA_RIGHTS_EVIDENCE_REFERENCE;
    else process.env.PLS1_DATA_RIGHTS_EVIDENCE_REFERENCE = priorRights;
  });
  assert.throws(() => manifestBuilder.requireExternalPrerequisites('FROZEN_LICENSE_REFERENCE'),
    /must exactly match the independently verified seed source contract/);

  const sourceIdentityContract = syntheticSourceIdentityContract('2022-01-03');
  const seed = {
    status: 'PRE_ACTIVATION_WARMUP_ONLY_NOT_VALIDATION_EVIDENCE',
    createdAtUtc: '2026-08-27T05:30:00.000Z',
    sourceIdentityContract,
    sourceIdentityContractSha256: model.hashCanonical(sourceIdentityContract),
  };
  const seedSha256 = 'b'.repeat(64);
  const manifest = manifestFixture(seed, seedSha256);
  manifest.dataRights.evidenceReference = 'ARBITRARY_FREE_TEXT';
  assert.throws(() => verifier.validateManifest(manifest, seedSha256, false,
    seed.sourceIdentityContractSha256, sourceIdentityContract.requiredSymbols,
    sourceIdentityContract.evidenceReference, false),
    /data-rights evidence must exactly match the verified seed source contract/);
});

test('production manifest remains blocked until stable source identities are machine-bound', t => {
  const priorRights = process.env.PLS1_DATA_RIGHTS_EVIDENCE_REFERENCE;
  const priorAnchor = process.env.PLS1_INDEPENDENT_ANCHOR_REFERENCE;
  process.env.PLS1_DATA_RIGHTS_EVIDENCE_REFERENCE = 'FROZEN_LICENSE_REFERENCE';
  process.env.PLS1_INDEPENDENT_ANCHOR_REFERENCE = 'INDEPENDENT_ANCHOR_REFERENCE';
  t.after(() => {
    if (priorRights === undefined) delete process.env.PLS1_DATA_RIGHTS_EVIDENCE_REFERENCE;
    else process.env.PLS1_DATA_RIGHTS_EVIDENCE_REFERENCE = priorRights;
    if (priorAnchor === undefined) delete process.env.PLS1_INDEPENDENT_ANCHOR_REFERENCE;
    else process.env.PLS1_INDEPENDENT_ANCHOR_REFERENCE = priorAnchor;
  });
  assert.throws(() => manifestBuilder.requireExternalPrerequisites('FROZEN_LICENSE_REFERENCE'),
    /BLOCKED_STABLE_SOURCE_IDENTITIES_NOT_MACHINE_BOUND/);
  assert.throws(() => manifestBuilder.assertSourceIdentitySchemaReady(),
    /stable security\/share-class identifiers/);
});

test('final trust requires production plus every statistical, economic, anchor, and 2x gate', () => {
  const fullyPassed = {
    production: true,
    endpoint: { statisticalGatesPassed: true, x2StatisticalGatesPassed: true },
    anchorPolicyReady: true,
    perDecisionAnchorCoverageVerified: true,
  };
  assert.deepEqual(verifier.deriveFinalTrustState(fullyPassed), {
    trusted: true,
    x2Trusted: true,
    forbiddenClaims: [],
  });
  for (const mutation of [
    state => { state.production = false; },
    state => { state.endpoint = null; },
    state => { delete state.endpoint; },
    state => { state.endpoint.statisticalGatesPassed = false; },
    state => { state.endpoint.x2StatisticalGatesPassed = false; },
    state => { state.anchorPolicyReady = false; },
    state => { state.perDecisionAnchorCoverageVerified = false; },
  ]) {
    const state = structuredClone(fullyPassed);
    mutation(state);
    assert.deepEqual(verifier.deriveFinalTrustState(state), {
      trusted: false,
      x2Trusted: false,
      forbiddenClaims: ['TRUSTED', 'VALIDATED', 'BEATS_INDEX', '2X'],
    });
  }
});

test('a local fixture cannot claim production data-rights confirmation', () => {
  const sourceIdentityContract = syntheticSourceIdentityContract('2022-01-03');
  const seed = {
    status: 'PRE_ACTIVATION_WARMUP_ONLY_NOT_VALIDATION_EVIDENCE',
    createdAtUtc: '2026-08-27T05:30:00.000Z',
    sourceIdentityContract,
    sourceIdentityContractSha256: model.hashCanonical(sourceIdentityContract),
  };
  const seedSha256 = 'b'.repeat(64);
  const manifest = manifestFixture(seed, seedSha256);
  manifest.dataRights.status = manifestBuilder.DATA_RIGHTS_STATUS.PRODUCTION;
  assert.throws(() => verifier.validateManifest(manifest, seedSha256, false,
    seed.sourceIdentityContractSha256, sourceIdentityContract.requiredSymbols,
    sourceIdentityContract.evidenceReference, false),
    /local fixture cannot claim production data-rights confirmation/);
});

test('manifest verifier rejects any change to the exact dyadic boundary policy', () => {
  const sourceIdentityContract = syntheticSourceIdentityContract('2022-01-03');
  const seed = {
    status: 'PRE_ACTIVATION_WARMUP_ONLY_NOT_VALIDATION_EVIDENCE',
    createdAtUtc: '2026-08-27T05:30:00.000Z',
    sourceIdentityContract,
    sourceIdentityContractSha256: model.hashCanonical(sourceIdentityContract),
  };
  const seedSha256 = 'b'.repeat(64);
  const manifest = manifestFixture(seed, seedSha256);
  manifest.exactDyadicComparisonPolicy = 'ROUNDED_BINARY64_BOUNDARY';
  assert.throws(() => verifier.validateManifest(manifest, seedSha256, false,
    seed.sourceIdentityContractSha256, sourceIdentityContract.requiredSymbols,
    sourceIdentityContract.evidenceReference, false),
  /manifest numeric\/runtime contract mismatch/);
});

test('Yahoo parser requires exact ordered arrays, provider identity, and completed local dates', () => {
  const body = JSON.parse(yahooBody('SPY', 3).toString('utf8'));
  const parsed = seedBuilder.parseYahooChart(Buffer.from(JSON.stringify(body)), 'SPY', '2026-08-28');
  assert.equal(parsed.providerSymbol, 'SPY');
  assert.equal(parsed.rows.length, 3);
  body.chart.result[0].indicators.quote[0].close[1] = null;
  assert.equal(seedBuilder.parseYahooChart(Buffer.from(JSON.stringify(body)), 'SPY',
    '2026-08-28').rows.length, 3, 'valid adjusted close survives a null raw quote');
  body.chart.result[0].timestamp[1] = body.chart.result[0].timestamp[0];
  assert.throws(() => seedBuilder.parseYahooChart(Buffer.from(JSON.stringify(body)), 'SPY',
    '2026-08-28'), /strictly increasing/);
});

test('alignment preserves every target session and represents stale components or missing cash explicitly', () => {
  const history = Array.from({ length: 20 }, (unused, index) => ({
    date: isoDay(index < 8 ? index : index + 8), n: 6,
    parts: Object.fromEntries(model.COMPONENT_KEYS.map((key, component) => [key, {
      score: 10 + component + (index / 1000), raw: index,
      asOf: isoDay(index < 8 ? index : index + 8),
    }])),
  }));
  const target = { rows: Array.from({ length: 27 }, (unused, index) => ({
    date: isoDay(index), adjustedClose: 100 + index,
  })) };
  const cash = { rows: target.rows.map(row => ({ ...row })) };
  cash.rows.splice(10, 1);
  const aligned = seedBuilder.alignMarketRows({ key: 'x', history }, target, cash, 7, 1);
  assert.deepEqual(aligned.map(row => row.date), target.rows.map(row => row.date));
  assert.equal(aligned[10].cashClose, null);
  assert.equal(aligned[15].referenceDate, null);
  assert.ok(model.COMPONENT_KEYS.every(key => aligned[15].components[key] === null));
});

test('role-bound raw replay rejects component/target ambiguity for a duplicated symbol', t => {
  const root = temporaryRoot(t);
  const source = sourceFixture(root, 'max', 700, '2026-08-28T05:00:00.000Z');
  const changed = JSON.parse(JSON.stringify(source.sourceSelections));
  const component = changed.find(item => item.role === 'COMPONENT' && item.symbol === 'SPY');
  const target = changed.find(item => item.role === 'TARGET' && item.symbol === 'SPY');
  [component.requestOrdinal, target.requestOrdinal] = [target.requestOrdinal, component.requestOrdinal];
  assert.throws(() => seedBuilder.replayAlignedDataFromReceipts({
    receipts: source.receipts,
    sourceSelections: changed,
    loadRaw: receipt => common.verifyRawBlob(root, receipt),
    range: 'max',
    retrievalDateUtc: source.retrievalDateUtc,
    sourceIdentityContract: source.sourceIdentityContract,
  }), /selected|receipt|phase|inventory|query/i);
});

test('raw replay rejects contradictory prices for one ticker across component and target roles', t => {
  const root = temporaryRoot(t);
  const source = sourceFixture(root, 'max', 700, '2026-08-28T05:00:00.000Z');
  const selection = source.sourceSelections.find(item => item.role === 'TARGET' && item.symbol === 'SPY');
  const receipt = source.receipts[selection.requestOrdinal];
  const replacement = common.createRawBlob(root, yahooBody('SPY', 700, {
    retrievalDateUtc: source.retrievalDateUtc, priceOffset: 997,
    firstTradeDate: source.sourceIdentityContract.identities.SPY.firstTradeDate,
  }));
  Object.assign(receipt, replacement);
  assert.throws(() => seedBuilder.replayAlignedDataFromReceipts({
    receipts: source.receipts,
    sourceSelections: source.sourceSelections,
    loadRaw: item => common.verifyRawBlob(root, item),
    range: 'max',
    retrievalDateUtc: source.retrievalDateUtc,
    sourceIdentityContract: source.sourceIdentityContract,
  }), /duplicated component\/target roles disagree/);
});

test('frozen target calendar rejects non-sessions and a stale terminal session', () => {
  const validDates = completedSessionDates(5);
  assert.throws(() => seedBuilder.validateTargetCalendar([{ rows: [
    ...[...validDates, '2026-08-23'].sort().map(date => ({ date })),
  ] }], '2026-08-28'), /unexpected non-session/);
  assert.throws(() => seedBuilder.validateTargetCalendar([{ rows:
    validDates.slice(0, -1).map(date => ({ date })) }], '2026-08-28'), /terminal date|missing expected/);
});

test('NYSE calendar does not invent a Friday observance for Saturday New Year', () => {
  assert.equal(seedBuilder.isExpectedNyseSession('2021-12-31'), true);
  assert.equal(seedBuilder.isExpectedNyseSession('2027-12-31'), true);
  assert.equal(seedBuilder.isExpectedNyseSession('2023-01-02'), false,
    'Sunday New Year is observed on Monday');
});

test('raw replay treats the independently frozen source calendar as its sole session authority', t => {
  const root = temporaryRoot(t);
  const source = sourceFixture(root, '5y', 800, '2026-08-28T05:00:00.000Z');
  const removedHardcodedSession = '2026-08-24';
  const addedFrozenSession = '2026-08-23';
  assert.equal(seedBuilder.isExpectedNyseSession(removedHardcodedSession), true);
  assert.equal(seedBuilder.isExpectedNyseSession(addedFrozenSession), false);

  const frozen = JSON.parse(JSON.stringify(source.sourceIdentityContract));
  const calendar = frozen.calendars.SYNTHETIC_XNYS;
  const calendarIndex = calendar.sessions.indexOf(removedHardcodedSession);
  assert.notEqual(calendarIndex, -1);
  calendar.sessions[calendarIndex] = addedFrozenSession;
  calendar.sessionsSha256 = model.hashCanonical(calendar.sessions);

  for (const receipt of source.receipts) {
    const body = JSON.parse(common.verifyRawBlob(root, receipt).toString('utf8'));
    const timestamps = body.chart.result[0].timestamp;
    const timestampIndex = timestamps.indexOf(Date.parse(`${removedHardcodedSession}T12:00:00.000Z`) / 1000);
    assert.notEqual(timestampIndex, -1);
    timestamps[timestampIndex] = Date.parse(`${addedFrozenSession}T12:00:00.000Z`) / 1000;
    Object.assign(receipt, common.createRawBlob(root, Buffer.from(JSON.stringify(body))));
  }

  const replay = seedBuilder.replayAlignedDataFromReceipts({
    receipts: source.receipts,
    sourceSelections: source.sourceSelections,
    loadRaw: receipt => common.verifyRawBlob(root, receipt),
    range: '5y',
    retrievalDateUtc: source.retrievalDateUtc,
    sourceIdentityContract: frozen,
  });
  for (const key of common.MARKET_ORDER) {
    const dates = replay.markets[key].rows.map(row => row.date);
    assert.equal(dates.includes(addedFrozenSession), true);
    assert.equal(dates.includes(removedHardcodedSession), false);
  }
});

test('raw replay rejects receipts whose claimed acquisition day is unrelated to retrieval', t => {
  const root = temporaryRoot(t);
  const source = sourceFixture(root, '5y', 800, '2026-08-28T05:00:00.000Z');
  source.receipts[0].startedAtUtc = '1999-01-01T05:00:00.000Z';
  source.receipts[0].completedAtUtc = '1999-01-01T05:00:01.000Z';
  assert.throws(() => seedBuilder.replayAlignedDataFromReceipts({
    receipts: source.receipts, sourceSelections: source.sourceSelections,
    loadRaw: receipt => common.verifyRawBlob(root, receipt), range: '5y',
    retrievalDateUtc: source.retrievalDateUtc,
    sourceIdentityContract: source.sourceIdentityContract,
  }), /outside retrieval UTC date/);
});

test('raw replay accepts real Promise-all fallback interleaving and still accounts for every attempt', t => {
  const root = temporaryRoot(t);
  const source = sourceFixture(root, '5y', 800, '2026-08-28T05:00:00.000Z', {
    fallbackSymbols: ['SPY', 'XLK'], fallbackOrder: ['XLK', 'SPY'],
  });
  assert.deepEqual(Object.keys(source.markets), common.MARKET_ORDER);
  assert.equal(source.receipts.filter(receipt => receipt.phase === 'EXECUTABLE').length,
    seedBuilder.expectedSourceContract('5y').executableSymbols.length + 2);
});

test('raw replay permits fallback after HTTP 200 when reading the first response body failed', t => {
  const root = temporaryRoot(t);
  const source = sourceFixture(root, '5y', 800, '2026-08-28T05:00:00.000Z', {
    fallbackSymbols: ['SPY'], fallbackOrder: ['SPY'],
  });
  const first = source.receipts.find(receipt => receipt.phase === 'EXECUTABLE'
    && seedBuilder.receiptSymbol(receipt) === 'SPY'
    && new URL(receipt.url).hostname === 'query1.finance.yahoo.com');
  first.status = 200;
  first.error = 'synthetic response.arrayBuffer failure';
  for (const key of ['path', 'rawSha256', 'rawBytes', 'gzipSha256', 'gzipBytes']) delete first[key];
  const replay = seedBuilder.replayAlignedDataFromReceipts({
    receipts: source.receipts,
    sourceSelections: source.sourceSelections,
    loadRaw: receipt => common.verifyRawBlob(root, receipt),
    range: '5y',
    retrievalDateUtc: source.retrievalDateUtc,
    sourceIdentityContract: source.sourceIdentityContract,
  });
  assert.deepEqual(Object.keys(replay.markets), common.MARKET_ORDER);
});

test('current-vintage chaining retains all complete missed sessions and rejects incomplete cash evidence', () => {
  const priorRows = [{
    date: '2026-08-26', targetClose: 100, cashClose: 100,
    referenceDate: '2026-08-26', components: Object.fromEntries(model.COMPONENT_KEYS.map(key => [key, 50])),
    componentAsOf: Object.fromEntries(model.COMPONENT_KEYS.map(key => [key, '2026-08-26'])),
    availableAtUtc: null,
  }];
  const base = { ...priorRows[0], targetClose: 50, cashClose: 80 };
  const acquired = { key: 'x', rows: [base,
    { ...base, date: '2026-08-27', targetClose: 55, cashClose: null,
      referenceDate: '2026-08-27', componentAsOf: Object.fromEntries(model.COMPONENT_KEYS.map(key => [key, '2026-08-27'])) },
    { ...base, date: '2026-08-28', targetClose: 56, cashClose: 80.8,
      referenceDate: '2026-08-28', componentAsOf: Object.fromEntries(model.COMPONENT_KEYS.map(key => [key, '2026-08-28'])) },
  ] };
  assert.throws(() => collector.prospectiveRows(acquired, priorRows,
    '2026-08-29T07:00:00.000Z'), /target and cash closes must both be finite/);
  acquired.rows[1].cashClose = 80.4;
  const next = collector.prospectiveRows(acquired, priorRows, '2026-08-29T07:00:00.000Z');
  assert.equal(next.length, 2);
  assert.ok(Math.abs(next[0].targetClose - 110) < 1e-12);
  assert.ok(Math.abs(next[0].cashClose - 100.5) < 1e-12);
  assert.equal(next[0].availableAtUtc, null);
  assert.ok(Math.abs(next[1].targetClose - 112) < 1e-12);
  assert.ok(Math.abs(next[1].cashClose - 101) < 1e-12);
  assert.equal(next[1].availableAtUtc, '2026-08-29T07:00:00.000Z');
});

test('GitHub provenance is attempt-specific and hashes only the immutable canonical projection', async t => {
  let protection = {
    enforce_admins: { enabled: true },
    allow_force_pushes: { enabled: false },
    allow_deletions: { enabled: false },
    required_pull_request_reviews: { required_approving_review_count: 1 },
  };
  const integrity = {
    actionsApiBaseUrl: common.GITHUB_REMOTE.apiBaseUrl,
    repository: common.GITHUB_REMOTE.repository,
    repositoryId: common.GITHUB_REMOTE.repositoryId,
    branch: common.GITHUB_REMOTE.branch,
    ref: common.GITHUB_REMOTE.ref,
    serverUrl: common.GITHUB_REMOTE.serverUrl,
    workflowId: '987654321',
    workflowPath: common.GITHUB_REMOTE.workflowPath,
    workflowRef: common.GITHUB_REMOTE.workflowRef,
    branchProtectionSnapshotSha256: model.hashCanonical(protection),
  };
  const manifest = { remoteIntegrity: integrity };
  const sha = '6'.repeat(40);
  const env = {
    GITHUB_API_URL: integrity.actionsApiBaseUrl,
    GITHUB_EVENT_NAME: 'schedule',
    GITHUB_REF: integrity.ref,
    GITHUB_REPOSITORY: integrity.repository,
    GITHUB_REPOSITORY_ID: integrity.repositoryId,
    GITHUB_RUN_ATTEMPT: '3',
    GITHUB_RUN_ID: '33147231957',
    GITHUB_SERVER_URL: integrity.serverUrl,
    GITHUB_SHA: sha,
    GITHUB_TOKEN: 'test-token',
    GITHUB_WORKFLOW_REF: integrity.workflowRef,
    GITHUB_WORKFLOW_SHA: sha,
    PLS1_TRIGGER_SCHEDULE: common.SCHEDULE_EXPRESSIONS[0],
    RUNNER_ENVIRONMENT: 'github-hosted',
  };
  const previousEnvironment = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  Object.assign(process.env, env);
  t.after(() => {
    for (const [key, value] of Object.entries(previousEnvironment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const canonicalUrl = `${integrity.actionsApiBaseUrl}/repos/${integrity.repository}`
    + `/actions/runs/${env.GITHUB_RUN_ID}/attempts/${env.GITHUB_RUN_ATTEMPT}`;
  let finalUrl = canonicalUrl;
  let run = {
    id: Number(env.GITHUB_RUN_ID),
    run_attempt: Number(env.GITHUB_RUN_ATTEMPT),
    workflow_id: Number(integrity.workflowId),
    path: integrity.workflowPath,
    head_branch: integrity.branch,
    head_sha: sha,
    event: env.GITHUB_EVENT_NAME,
    created_at: '2026-08-28T06:00:00Z',
    run_started_at: '2026-08-28T06:01:00Z',
    html_url: `${integrity.serverUrl}/${integrity.repository}/actions/runs/${env.GITHUB_RUN_ID}`,
    repository: { id: Number(integrity.repositoryId), full_name: integrity.repository },
    status: 'in_progress',
    conclusion: null,
    updated_at: '2026-08-28T06:02:00Z',
  };
  const calls = [];
  let declaredLengthOverride = null;
  let bodyReaderRequests = 0;
  let bodyCancellations = 0;
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    const isProtection = String(url).endsWith('/branches/main/protection');
    const bytes = Buffer.from(JSON.stringify(isProtection ? protection : run));
    return {
      ok: true,
      status: 200,
      url: isProtection ? String(url) : finalUrl,
      headers: new Headers({ 'content-length': String(declaredLengthOverride ?? bytes.length) }),
      body: {
        async cancel() { bodyCancellations += 1; },
        getReader() {
          bodyReaderRequests += 1;
          let delivered = false;
          return {
            async read() {
              if (delivered) return { done: true, value: undefined };
              delivered = true;
              return { done: false, value: bytes };
            },
            async cancel() { bodyCancellations += 1; },
            releaseLock() {},
          };
        },
      },
    };
  });

  const remote = await collector.githubRunProvenance(manifest);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, canonicalUrl);
  assert.equal(calls[0].options.redirect, 'error');
  assert.equal(remote.apiRequestUrl, canonicalUrl);
  assert.equal(remote.apiResponseUrl, canonicalUrl);
  assert.equal(remote.runAttempt, run.run_attempt);
  assert.equal(remote.workflowId, integrity.workflowId);
  assert.equal(remote.workflowPath, integrity.workflowPath);
  assert.equal(remote.workflowRef, integrity.workflowRef);
  assert.equal(remote.immutableProjectionSha256, model.hashCanonical(remote.immutableProjection));
  assert.equal(Object.hasOwn(remote, 'apiResponseSha256'), false);
  assert.equal(Object.hasOwn(remote.immutableProjection, 'status'), false);
  assert.equal(Object.hasOwn(remote.immutableProjection, 'conclusion'), false);
  assert.equal(Object.hasOwn(remote.immutableProjection, 'updated_at'), false);
  assert.doesNotThrow(() => verifier.validateRemoteRun(remote,
    '2026-08-28T07:00:00.000Z', true, manifest));
  const liveProtection = await collector.assertLiveBranchProtection(manifest);
  assert.equal(liveProtection.snapshotSha256, integrity.branchProtectionSnapshotSha256);
  protection = { ...protection, allow_force_pushes: { enabled: true } };
  await assert.rejects(collector.assertLiveBranchProtection(manifest), /differs/);
  protection = { ...protection, allow_force_pushes: { enabled: false } };

  run = { ...run, run_attempt: 2 };
  await assert.rejects(collector.githubRunProvenance(manifest), /frozen identity/);
  run = { ...run, run_attempt: 3, workflow_id: Number(integrity.workflowId) + 1 };
  await assert.rejects(collector.githubRunProvenance(manifest), /frozen identity/);
  run = { ...run, workflow_id: Number(integrity.workflowId), path: '.github/workflows/other.yml' };
  await assert.rejects(collector.githubRunProvenance(manifest), /frozen identity/);
  run = { ...run, path: integrity.workflowPath };
  finalUrl = `${canonicalUrl}/redirected`;
  await assert.rejects(collector.githubRunProvenance(manifest), /final response URL/);
  finalUrl = canonicalUrl;
  process.env.GITHUB_WORKFLOW_REF = `${integrity.repository}/${integrity.workflowPath}@refs/heads/other`;
  await assert.rejects(collector.githubRunProvenance(manifest), /frozen remote identity/);
  process.env.GITHUB_WORKFLOW_REF = integrity.workflowRef;

  const readsBeforeOversize = bodyReaderRequests;
  const cancellationsBeforeOversize = bodyCancellations;
  declaredLengthOverride = collector.MAX_GITHUB_API_RESPONSE_BYTES + 1;
  await assert.rejects(collector.githubRunProvenance(manifest),
    error => error.code === 'PLS1_RESPONSE_BODY_TOO_LARGE');
  await assert.rejects(collector.assertLiveBranchProtection(manifest),
    error => error.code === 'PLS1_RESPONSE_BODY_TOO_LARGE');
  assert.equal(bodyReaderRequests, readsBeforeOversize,
    'oversized GitHub responses must be rejected before a reader is acquired');
  assert.equal(bodyCancellations, cancellationsBeforeOversize + 2,
    'both oversized GitHub response streams must be cancelled');
  declaredLengthOverride = null;

  const changedProjection = JSON.parse(JSON.stringify(remote));
  changedProjection.immutableProjection.runAttempt = 2;
  changedProjection.immutableProjectionSha256 = model.hashCanonical(changedProjection.immutableProjection);
  assert.throws(() => verifier.validateRemoteRun(changedProjection,
    '2026-08-28T07:00:00.000Z', true, manifest), /projection/);
  assert.throws(() => verifier.validateRemoteRun({ ...remote, apiResponseSha256: 'a'.repeat(64) },
    '2026-08-28T07:00:00.000Z', true, manifest), /exact keys/);
});

test('production caller cannot inject time, acquisition, or provenance', async () => {
  await assert.rejects(collector.collect({ clock: () => new Date(0) }), /forbids injected/);
  await assert.rejects(collector.collect({ acquire: async () => ({}) }), /forbids injected/);
  await assert.rejects(collector.collect({ provenance: {} }), /forbids injected/);
  await assert.rejects(collector.collect({ lockboxRoot: `${common.LOCKBOX_ROOT}${path.sep}`,
    clock: () => new Date(0) }), /forbids injected/);
});

test('production-root detection resolves a junction alias before applying injection guards', async t => {
  const root = temporaryRoot(t);
  const alias = path.join(root, 'research-alias');
  try {
    fs.symlinkSync(path.join(common.ROOT, 'research'), alias, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    if (['EPERM', 'EACCES', 'UNKNOWN'].includes(error.code)) {
      t.skip(`filesystem does not permit directory links: ${error.code}`);
      return;
    }
    throw error;
  }
  const aliased = path.join(alias, 'lockbox', common.LOCKBOX_ID);
  assert.equal(common.isProductionLockboxRoot(aliased), true);
  await assert.rejects(collector.collect({ lockboxRoot: aliased, clock: () => new Date(0) }),
    /forbids injected/);
});

test('offline verifier derives the activation from all role-bound raw bytes and rejects one changed byte', t => {
  const fixture = createFixture(t);
  const collectedAtUtc = '2026-08-28T07:30:00.000Z';
  const newRowsByMarket = Object.fromEntries(common.MARKET_ORDER.map(key => [key,
    collector.prospectiveRows(fixture.acquired.markets[key], fixture.seed.markets[key].rows,
      collectedAtUtc),
  ]));
  const bundle = collector.buildDecisionBundle({
    seed: fixture.seed,
    manifest: fixture.manifest,
    seedSha256: fixture.seedSha256,
    manifestSha256: fixture.manifestSha256,
    manifestCommit: { commitSha: '5'.repeat(40) },
    acquired: fixture.acquired,
    sourceReceipts: fixture.liveReceipts,
    bundles: [],
    collectedAtUtc,
    provenance: collector.localTestProvenance('2026-08-28T06:00:00.000Z'),
    newRowsByMarket,
  });
  const file = common.decisionPath(fixture.root, bundle.decisionDate);
  common.createCanonicalWithSidecar(file, bundle);
  const report = verifier.verifyLockbox(fixture.root, { verifyPinnedFiles: false });
  assert.equal(report.ok, true);
  assert.equal(report.decisions, 1);
  assert.equal(report.trusted, false);
  assert.equal(report.integrity,
    'VERIFIED_BY_ROLE_BOUND_RESPONSE_BODY_REPLAY_AND_INDEPENDENT_CAUSAL_RECOMPUTATION');
  for (const key of common.MARKET_ORDER) {
    assert.equal(bundle.markets[key].newRows.length, 1);
    assert.ok(['BUY', 'SELL'].includes(bundle.markets[key].decisions.M1.action));
  }
  const firstRaw = fixture.seed.sourceReceipts[0];
  fs.appendFileSync(path.join(fixture.root, firstRaw.path), ' ');
  assert.throws(() => verifier.verifyLockbox(fixture.root, { verifyPinnedFiles: false }),
    /compressed raw receipt mismatch/);
});

test('offline verifier rejects mutable claim fields and undeclared market-record keys', async t => {
  const storedActivation = nested => {
    const fixture = createFixture(nested);
    const collectedAtUtc = '2026-08-28T07:30:00.000Z';
    const newRowsByMarket = Object.fromEntries(common.MARKET_ORDER.map(key => [key,
      collector.prospectiveRows(fixture.acquired.markets[key], fixture.seed.markets[key].rows,
        collectedAtUtc),
    ]));
    const bundle = collector.buildDecisionBundle({
      seed: fixture.seed,
      manifest: fixture.manifest,
      seedSha256: fixture.seedSha256,
      manifestSha256: fixture.manifestSha256,
      manifestCommit: { commitSha: '5'.repeat(40) },
      acquired: fixture.acquired,
      sourceReceipts: fixture.liveReceipts,
      bundles: [],
      collectedAtUtc,
      provenance: collector.localTestProvenance('2026-08-28T06:00:00.000Z'),
      newRowsByMarket,
    });
    const file = common.decisionPath(fixture.root, bundle.decisionDate);
    common.createCanonicalWithSidecar(file, bundle);
    return { fixture, file, bundle: structuredClone(bundle) };
  };

  await t.test('forbidden claim list is exact frozen data', nested => {
    const { fixture, file, bundle } = storedActivation(nested);
    bundle.forbiddenUntilTrustGate = [];
    overwriteCanonicalWithSidecar(file, bundle);
    assert.throws(() => verifier.verifyLockbox(fixture.root, { verifyPinnedFiles: false }),
      /forbidden claims before full trust gate/);
  });

  await t.test('market records have a closed exact schema', nested => {
    const { fixture, file, bundle } = storedActivation(nested);
    bundle.markets.usa.misleadingTrustClaim = 'TRUSTED';
    overwriteCanonicalWithSidecar(file, bundle);
    assert.throws(() => verifier.verifyLockbox(fixture.root, { verifyPinnedFiles: false }),
      /usa market record: exact keys mismatch/);
  });
});

test('post-cutoff preflight writes one deterministic no-network attempt and closes the inventory', async t => {
  const fixture = createFixture(t, { includeLiveSource: false });
  let acquisitionCalls = 0;
  const now = '2026-08-28T12:30:00.000Z';
  const provenance = {
    ...collector.localTestProvenance('2026-08-28T12:00:00.000Z'),
    runId: 'cutoff-preflight-test',
  };
  const result = await collector.collect({
    lockboxRoot: fixture.root,
    clock: () => new Date(now),
    provenance,
    acquire: async () => {
      acquisitionCalls += 1;
      throw new Error('network must not be reached');
    },
  });
  assert.equal(acquisitionCalls, 0);
  assert.equal(result.written, false);
  assert.equal(result.reason, common.ATTEMPT_REASON.PRE_ACQUISITION_CUTOFF);
  const attempts = common.listAttemptFiles(fixture.root);
  assert.equal(attempts.length, 1);
  const attempt = JSON.parse(fs.readFileSync(attempts[0], 'utf8'));
  assert.equal(attempt.status, common.ATTEMPT_STATUS.SKIPPED_PAST_CUTOFF);
  assert.equal(attempt.reason, common.ATTEMPT_REASON.PRE_ACQUISITION_CUTOFF);
  assert.equal(attempt.failureStage, null);
  assert.equal(attempt.errorSha256, null);
  assert.deepEqual(attempt.sourceAcquisition,
    collector.notStartedSourceAcquisition('5y', '2026-08-28'));
  const report = verifier.verifyLockbox(fixture.root, { verifyPinnedFiles: false });
  assert.equal(report.attempts, 1);
  assert.match(report.inventorySha256, /^[a-f0-9]{64}$/);

  const orphan = path.join(fixture.root, 'orphan.txt');
  fs.writeFileSync(orphan, 'unreferenced');
  assert.throws(() => verifier.verifyLockbox(fixture.root, { verifyPinnedFiles: false }),
    /inventory is not closed/);
  fs.rmSync(orphan);

  attempt.unregisteredField = true;
  delete attempt.attemptSha256;
  attempt.attemptSha256 = model.hashCanonical(attempt);
  const bytes = common.canonicalBytes(attempt);
  fs.writeFileSync(attempts[0], bytes);
  fs.writeFileSync(`${attempts[0]}.sha256`, common.sidecarBytes(path.basename(attempts[0]),
    common.sha256(bytes)));
  assert.throws(() => verifier.verifyLockbox(fixture.root, { verifyPinnedFiles: false }),
    /attempt: exact keys mismatch/);
});

test('already-recorded preflight suppresses a redundant five-year download', async t => {
  const fixture = createFixture(t);
  const decisionAtUtc = '2026-08-28T07:30:00.000Z';
  const newRowsByMarket = Object.fromEntries(common.MARKET_ORDER.map(key => [key,
    collector.prospectiveRows(fixture.acquired.markets[key], fixture.seed.markets[key].rows,
      decisionAtUtc),
  ]));
  const bundle = collector.buildDecisionBundle({
    seed: fixture.seed,
    manifest: fixture.manifest,
    seedSha256: fixture.seedSha256,
    manifestSha256: fixture.manifestSha256,
    manifestCommit: { commitSha: '5'.repeat(40) },
    acquired: fixture.acquired,
    sourceReceipts: fixture.liveReceipts,
    bundles: [],
    collectedAtUtc: decisionAtUtc,
    provenance: {
      ...collector.localTestProvenance('2026-08-28T06:00:00.000Z'),
      runId: 'decision-run-test',
    },
    newRowsByMarket,
  });
  common.createCanonicalWithSidecar(common.decisionPath(fixture.root, bundle.decisionDate), bundle);
  assert.equal(bundle.decisionDate, '2026-08-27');

  let acquisitionCalls = 0;
  const result = await collector.collect({
    lockboxRoot: fixture.root,
    clock: () => new Date('2026-08-28T08:00:00.000Z'),
    provenance: {
      ...collector.localTestProvenance('2026-08-28T07:55:00.000Z'),
      runId: 'already-recorded-test',
    },
    acquire: async () => {
      acquisitionCalls += 1;
      throw new Error('redundant network acquisition must not run');
    },
  });
  assert.equal(acquisitionCalls, 0);
  assert.equal(result.reason,
    common.ATTEMPT_REASON.LATEST_COMPLETED_SOURCE_SESSION_ALREADY_IN_LEDGER);
  const report = verifier.verifyLockbox(fixture.root, { verifyPinnedFiles: false });
  assert.equal(report.decisions, 1);
  assert.equal(report.attempts, 1);
});

test('partial acquisition validation rejects a role receipt from an unrelated URL', t => {
  const fixture = createFixture(t);
  const partialReceipt = JSON.parse(JSON.stringify(fixture.liveReceipts[0]));
  const unrelated = new URL(partialReceipt.url);
  unrelated.hostname = 'example.invalid';
  partialReceipt.url = unrelated.toString();
  partialReceipt.responseUrl = partialReceipt.url;
  const attempt = {
    collectedAtUtc: '2026-08-28T06:40:00.000Z',
    remoteRun: collector.localTestProvenance('2026-08-28T06:00:00.000Z'),
  };
  assert.throws(() => verifier.validateAttemptSource(fixture.root, {
    state: common.ACQUISITION_STATE.PARTIAL_UNVERIFIED,
    range: '5y',
    retrievalDateUtc: '2026-08-28',
    rawResponses: [partialReceipt],
  }, attempt, fixture.seed, 'partial test'), /host|URL|receipt/i);
});
