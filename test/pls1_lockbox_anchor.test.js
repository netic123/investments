'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const anchor = require('../scripts/pls1-lockbox-anchor');

// These are deliberately synthetic parser fixtures. They exercise fail-closed
// policy logic only; they are not signatures and cannot pass createAnchorReceipt
// or verifyAnchorReceipt, both of which always execute the pinned real verifier.

function policyFixture() {
  return {
    lockboxId: 'control-residual-pls1-v1',
    decisionDate: '2026-08-28',
    eventName: 'schedule',
    repository: 'example/investments',
    repositoryId: '123456789',
    workflowPath: '.github/workflows/pls1-lockbox.yml',
    workflowRef: 'example/investments/.github/workflows/pls1-lockbox.yml@refs/heads/main',
    sourceRef: 'refs/heads/main',
    sourceDigest: 'a'.repeat(40),
    runId: '987654321',
    runAttempt: 3,
    firstEligibleExecutionDate: '2026-08-31',
    firstEligibleExecutionAtUtc: '2026-08-31T20:00:00.000Z',
    trustedRootSha256: 'b'.repeat(64),
    targetCalendarSha256: '1'.repeat(64),
    verifierPath: process.platform === 'win32' ? 'C:\\frozen\\gh.exe' : '/frozen/gh',
  };
}

function decisionFixture(policy = policyFixture()) {
  return {
    schema: 'fg-control-residual-pls1-six-market-decision-bundle-v1',
    status: 'PROSPECTIVE_CANDIDATE_NOT_YET_TRUSTED',
    lockboxId: policy.lockboxId,
    modelId: 'FG-CONTROL-RESIDUAL-PLS1-PREQ-V1',
    collectedAtUtc: '2026-08-28T10:00:00.123Z',
    signalKnownAtUtc: '2026-08-28T10:00:00.123Z',
    decisionDate: policy.decisionDate,
    remoteRun: {
      environment: 'GITHUB_ACTIONS_REMOTE',
      eventName: policy.eventName,
      runId: policy.runId,
      runAttempt: policy.runAttempt,
      headSha: policy.sourceDigest,
      workflowSha: policy.sourceDigest,
      workflowPath: policy.workflowPath,
      workflowRef: policy.workflowRef,
      repository: policy.repository,
      repositoryId: policy.repositoryId,
      ref: policy.sourceRef,
      serverUrl: 'https://github.com',
      runnerEnvironment: 'github-hosted',
    },
    sourceAcquisition: { targetCalendarSha256: policy.targetCalendarSha256 },
    markets: {},
  };
}

function identityUri(policy) {
  return `https://github.com/${policy.workflowRef}`;
}

function invocationUri(policy) {
  return `https://github.com/${policy.repository}/actions/runs/${policy.runId}/attempts/${policy.runAttempt}`;
}

function statementFixture(policy, decisionSha256) {
  return {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{
      name: anchor.decisionRelativePath(policy.decisionDate),
      digest: { sha256: decisionSha256 },
    }],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: 'https://actions.github.io/buildtypes/workflow/v1',
        externalParameters: { workflow: {
          ref: policy.sourceRef,
          repository: `https://github.com/${policy.repository}`,
          path: policy.workflowPath,
        } },
        internalParameters: { github: {
          event_name: policy.eventName,
          repository_id: policy.repositoryId,
          repository_owner_id: '24680',
          runner_environment: 'github-hosted',
        } },
        resolvedDependencies: [{
          uri: `git+https://github.com/${policy.repository}@${policy.sourceRef}`,
          digest: { gitCommit: policy.sourceDigest },
        }],
      },
      runDetails: {
        builder: { id: identityUri(policy) },
        metadata: { invocationId: invocationUri(policy) },
      },
    },
  };
}

function certificateFixture(policy) {
  const owner = policy.repository.split('/')[0];
  return {
    certificateIssuer: 'CN=sigstore-intermediate,O=sigstore.dev',
    subjectAlternativeName: identityUri(policy),
    issuer: 'https://token.actions.githubusercontent.com',
    githubWorkflowTrigger: policy.eventName,
    githubWorkflowSHA: policy.sourceDigest,
    githubWorkflowName: 'PLS1 prospective lockbox',
    githubWorkflowRepository: policy.repository,
    githubWorkflowRef: policy.sourceRef,
    buildSignerURI: identityUri(policy),
    buildSignerDigest: policy.sourceDigest,
    runnerEnvironment: 'github-hosted',
    sourceRepositoryURI: `https://github.com/${policy.repository}`,
    sourceRepositoryDigest: policy.sourceDigest,
    sourceRepositoryRef: policy.sourceRef,
    sourceRepositoryIdentifier: policy.repositoryId,
    sourceRepositoryOwnerURI: `https://github.com/${owner}`,
    sourceRepositoryOwnerIdentifier: '24680',
    buildConfigURI: identityUri(policy),
    buildConfigDigest: policy.sourceDigest,
    buildTrigger: policy.eventName,
    runInvocationURI: invocationUri(policy),
    sourceRepositoryVisibilityAtSigning: 'public',
  };
}

function bundleFixture(statement, integratedTimeUnix) {
  return {
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    verificationMaterial: {
      certificate: { rawBytes: Buffer.from('synthetic-certificate').toString('base64') },
      tlogEntries: [{
        logIndex: '123',
        logId: { keyId: Buffer.from('synthetic-rekor-key').toString('base64') },
        kindVersion: { kind: 'dsse', version: '0.0.1' },
        integratedTime: String(integratedTimeUnix),
        inclusionPromise: {
          signedEntryTimestamp: Buffer.from('synthetic-set').toString('base64'),
        },
        inclusionProof: {
          logIndex: '123',
          rootHash: Buffer.from('synthetic-root').toString('base64'),
          treeSize: '456',
          hashes: [],
          checkpoint: { envelope: 'rekor.sigstore.dev synthetic checkpoint' },
        },
        canonicalizedBody: Buffer.from('synthetic-body').toString('base64'),
      }],
      timestampVerificationData: {},
    },
    dsseEnvelope: {
      payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
      payloadType: 'application/vnd.in-toto+json',
      signatures: [{ sig: Buffer.from('synthetic-signature').toString('base64') }],
    },
  };
}

function verifiedFixture() {
  const policy = policyFixture();
  anchor.__test.validatePolicy(policy);
  const decision = decisionFixture(policy);
  anchor.__test.validateDecision(decision, policy);
  const decisionBytes = anchor.canonicalBytes(decision);
  const decisionEvidence = {
    relativePath: anchor.decisionRelativePath(policy.decisionDate),
    absolutePath: '/unused/decision.json',
    bytes: decisionBytes,
    bytesLength: decisionBytes.length,
    sha256: anchor.hashCanonical(decision),
    value: decision,
  };
  const statement = statementFixture(policy, decisionEvidence.sha256);
  const integratedTimeUnix = Math.floor(Date.parse('2026-08-28T10:00:02.000Z') / 1000);
  const bundle = bundleFixture(statement, integratedTimeUnix);
  const bundleBytes = Buffer.from(JSON.stringify(bundle));
  const parsedBundle = anchor.__test.parseSigstoreBundle(bundleBytes);
  const certificate = certificateFixture(policy);
  const output = [{
    attestation: { bundle, bundle_url: '', initiator: '' },
    verificationResult: {
      mediaType: 'application/vnd.dev.sigstore.verificationresult+json;version=0.1',
      signature: { certificate },
      verifiedTimestamps: [{
        type: 'Tlog',
        uri: 'https://rekor.sigstore.dev',
        timestamp: new Date(integratedTimeUnix * 1000).toISOString(),
      }],
      verifiedIdentity: {},
      statement,
    },
  }];
  return { policy, decision, decisionEvidence, statement, bundle, bundleBytes, parsedBundle,
    certificate, output };
}

function replaceStatement(fixture, mutate) {
  const statement = structuredClone(fixture.statement);
  mutate(statement);
  const bundle = bundleFixture(statement, fixture.parsedBundle.integratedTimeUnix);
  const bundleBytes = Buffer.from(JSON.stringify(bundle));
  fixture.statement = statement;
  fixture.bundle = bundle;
  fixture.bundleBytes = bundleBytes;
  fixture.parsedBundle = anchor.__test.parseSigstoreBundle(bundleBytes);
  fixture.output[0].attestation.bundle = bundle;
  fixture.output[0].verificationResult.statement = statement;
  return fixture;
}

function replaceIntegratedTime(fixture, integratedAtUtc) {
  const integratedTimeUnix = Math.floor(Date.parse(integratedAtUtc) / 1000);
  const bundle = bundleFixture(fixture.statement, integratedTimeUnix);
  const bundleBytes = Buffer.from(JSON.stringify(bundle));
  fixture.bundle = bundle;
  fixture.bundleBytes = bundleBytes;
  fixture.parsedBundle = anchor.__test.parseSigstoreBundle(bundleBytes);
  fixture.output[0].attestation.bundle = bundle;
  fixture.output[0].verificationResult.verifiedTimestamps[0].timestamp
    = new Date(integratedTimeUnix * 1000).toISOString();
  return fixture;
}

test('anchor canonicalization rejects prototype-mutating JSON keys', () => {
  const cleanHash = anchor.hashCanonical({ a: 1 });
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    const hostile = JSON.parse(`{"a":1,"${key}":{"forged":true}}`);
    assert.equal(Object.hasOwn(hostile, key), true);
    assert.throws(() => anchor.canonicalBytes(hostile), /unsafe object key/);
    assert.throws(() => anchor.hashCanonical(hostile), /unsafe object key/);
    assert.equal(anchor.hashCanonical({ a: 1 }), cleanHash);
  }
});

test('the anchor freezes exact non-vulnerable verifier and attestation-action identities', () => {
  assert.deepEqual(anchor.ATTEST_ACTION, {
    repository: 'actions/attest',
    version: 'v4.2.2',
    commitSha: '1e69f48acb82d1966a394da916b4c1698aa569d6',
  });
  assert.deepEqual(anchor.PINNED_GH_VERIFIER, {
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
  assert.equal(Object.isFrozen(anchor.PINNED_GH_VERIFIER), true);
  assert.equal(Object.hasOwn(anchor, 'runPinnedGhVerifier'), false,
    'the cryptographic runner is not replaceable through the public API');
});

test('the command enforces local bundle/root, exact identity, source, hosted runner, and JSON output', () => {
  const fixture = verifiedFixture();
  const args = anchor.__test.buildGhArguments('/evidence/decision.json', '/evidence/bundle.json',
    '/evidence/root.jsonl', fixture.policy);
  assert.deepEqual(args, [
    'attestation', 'verify', '/evidence/decision.json',
    '--bundle', '/evidence/bundle.json',
    '--custom-trusted-root', '/evidence/root.jsonl',
    '--repo', 'example/investments',
    '--signer-digest', 'a'.repeat(40),
    '--source-digest', 'a'.repeat(40),
    '--source-ref', 'refs/heads/main',
    '--cert-identity', identityUri(fixture.policy),
    '--cert-oidc-issuer', 'https://token.actions.githubusercontent.com',
    '--predicate-type', 'https://slsa.dev/provenance/v1',
    '--deny-self-hosted-runners',
    '--hostname', 'github.com',
    '--limit', '1',
    '--format', 'json',
  ]);
});

test('a shape-only verified-output fixture derives an exact blocked-horizon receipt', () => {
  const fixture = verifiedFixture();
  const verified = anchor.__test.validateVerifiedGhOutput(fixture.output, fixture.parsedBundle,
    fixture.decisionEvidence, fixture.policy);
  const bundleEvidence = {
    relativePath: anchor.bundleRelativePath(fixture.policy.decisionDate),
    bytes: fixture.bundleBytes,
    bytesLength: fixture.bundleBytes.length,
    sha256: 'c'.repeat(64),
  };
  const trustedRootEvidence = {
    relativePath: anchor.TRUSTED_ROOT_RELATIVE_PATH,
    bytes: Buffer.from('{}\n'),
    bytesLength: 3,
    sha256: fixture.policy.trustedRootSha256,
  };
  const receipt = anchor.__test.buildReceipt({
    decisionEvidence: fixture.decisionEvidence,
    bundleEvidence,
    trustedRootEvidence,
    trustedRootEntries: 1,
    verified,
    policy: fixture.policy,
  });
  anchor.__test.validateReceiptShape(receipt, fixture.policy);
  assert.equal(receipt.status, 'SINGLE_EVENT_CRYPTOGRAPHIC_ANCHOR_VERIFIED');
  assert.equal(receipt.decision.sha256, fixture.decisionEvidence.sha256);
  assert.equal(receipt.anchor.identity.runId, fixture.policy.runId);
  assert.equal(receipt.anchor.identity.runAttempt, fixture.policy.runAttempt);
  assert.equal(receipt.anchor.attestationAction.binding,
    'REQUIRES_SEPARATE_GIT_TREE_VERIFICATION_OF_WORKFLOW_AT_SOURCE_DIGEST');
  assert.equal(receipt.anchor.transparencyLog.integratedAtUtc, '2026-08-28T10:00:02.000Z');
  assert.equal(receipt.endpointTrustPolicy.endpointEligible, false);
  const withoutHash = Object.fromEntries(
    Object.entries(receipt).filter(([key]) => key !== 'receiptSha256'),
  );
  assert.equal(receipt.receiptSha256, anchor.hashCanonical(withoutHash));

  const extra = structuredClone(receipt);
  extra.unfrozen = true;
  assert.throws(() => anchor.__test.validateReceiptShape(extra, fixture.policy), /keys differ/);
});

test('subject coverage is exactly one canonical decision path and SHA-256', () => {
  const wrongDigest = replaceStatement(verifiedFixture(), statement => {
    statement.subject[0].digest.sha256 = 'd'.repeat(64);
  });
  assert.throws(() => anchor.__test.validateVerifiedGhOutput(wrongDigest.output,
    wrongDigest.parsedBundle, wrongDigest.decisionEvidence, wrongDigest.policy),
  /subject digest does not equal canonical decision/);

  const wrongName = replaceStatement(verifiedFixture(), statement => {
    statement.subject[0].name = 'decision.json';
  });
  assert.throws(() => anchor.__test.validateVerifiedGhOutput(wrongName.output,
    wrongName.parsedBundle, wrongName.decisionEvidence, wrongName.policy),
  /subject name does not equal decision path/);

  const extraSubject = replaceStatement(verifiedFixture(), statement => {
    statement.subject.push(structuredClone(statement.subject[0]));
  });
  assert.throws(() => anchor.__test.validateVerifiedGhOutput(extraSubject.output,
    extraSubject.parsedBundle, extraSubject.decisionEvidence, extraSubject.policy),
  /exactly one subject/);
});

test('certificate identity rejects lookalike repositories, wrong attempts, and non-public runners', () => {
  const lookalike = verifiedFixture();
  lookalike.output[0].verificationResult.signature.certificate.subjectAlternativeName
    = identityUri(lookalike.policy).replace('example/investments', 'example/investmentz');
  assert.throws(() => anchor.__test.validateVerifiedGhOutput(lookalike.output,
    lookalike.parsedBundle, lookalike.decisionEvidence, lookalike.policy),
  /signer workflow identity/);

  const wrongAttempt = verifiedFixture();
  wrongAttempt.output[0].verificationResult.signature.certificate.runInvocationURI
    = invocationUri({ ...wrongAttempt.policy, runAttempt: 4 });
  assert.throws(() => anchor.__test.validateVerifiedGhOutput(wrongAttempt.output,
    wrongAttempt.parsedBundle, wrongAttempt.decisionEvidence, wrongAttempt.policy),
  /run ID\/attempt/);

  const selfHosted = verifiedFixture();
  selfHosted.output[0].verificationResult.signature.certificate.runnerEnvironment = 'self-hosted';
  assert.throws(() => anchor.__test.validateVerifiedGhOutput(selfHosted.output,
    selfHosted.parsedBundle, selfHosted.decisionEvidence, selfHosted.policy),
  /GitHub-hosted runner/);

  const privateRepo = verifiedFixture();
  privateRepo.output[0].verificationResult.signature.certificate
    .sourceRepositoryVisibilityAtSigning = 'private';
  assert.throws(() => anchor.__test.validateVerifiedGhOutput(privateRepo.output,
    privateRepo.parsedBundle, privateRepo.decisionEvidence, privateRepo.policy),
  /public-repository signing/);
});

test('run attempt is also required inside the SLSA invocation and source identity', () => {
  const wrongAttempt = replaceStatement(verifiedFixture(), statement => {
    statement.predicate.runDetails.metadata.invocationId
      = statement.predicate.runDetails.metadata.invocationId.replace('/attempts/3', '/attempts/4');
  });
  assert.throws(() => anchor.__test.validateVerifiedGhOutput(wrongAttempt.output,
    wrongAttempt.parsedBundle, wrongAttempt.decisionEvidence, wrongAttempt.policy),
  /SLSA run ID\/attempt/);

  const wrongSource = replaceStatement(verifiedFixture(), statement => {
    statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = 'e'.repeat(40);
  });
  assert.throws(() => anchor.__test.validateVerifiedGhOutput(wrongSource.output,
    wrongSource.parsedBundle, wrongSource.decisionEvidence, wrongSource.policy),
  /source dependency/);
});

test('Rekor proof fails closed at or after the first eligible execution', () => {
  const equalDeadline = replaceIntegratedTime(verifiedFixture(), '2026-08-31T20:00:00.000Z');
  assert.throws(() => anchor.__test.validateVerifiedGhOutput(equalDeadline.output,
    equalDeadline.parsedBundle, equalDeadline.decisionEvidence, equalDeadline.policy),
  /strictly before/);

  const afterDeadline = replaceIntegratedTime(verifiedFixture(), '2026-08-31T20:00:01.000Z');
  assert.throws(() => anchor.__test.validateVerifiedGhOutput(afterDeadline.output,
    afterDeadline.parsedBundle, afterDeadline.decisionEvidence, afterDeadline.policy),
  /strictly before/);

  const beforeSignal = replaceIntegratedTime(verifiedFixture(), '2026-08-28T09:59:59.000Z');
  assert.throws(() => anchor.__test.validateVerifiedGhOutput(beforeSignal.output,
    beforeSignal.parsedBundle, beforeSignal.decisionEvidence, beforeSignal.policy),
  /predates the decision signal-known second/);
});

test('only a verified Public Good Rekor timestamp with inclusion proof is accepted', () => {
  const wrongLog = verifiedFixture();
  wrongLog.output[0].verificationResult.verifiedTimestamps[0].uri = 'https://example.invalid';
  assert.throws(() => anchor.__test.validateVerifiedGhOutput(wrongLog.output,
    wrongLog.parsedBundle, wrongLog.decisionEvidence, wrongLog.policy), /not the Sigstore Public Good/);

  const unsigned = verifiedFixture();
  delete unsigned.bundle.verificationMaterial.tlogEntries[0].inclusionProof;
  assert.throws(() => anchor.__test.parseSigstoreBundle(Buffer.from(JSON.stringify(unsigned.bundle))),
    /inclusion proof/);

  const noTimestamp = verifiedFixture();
  noTimestamp.output[0].verificationResult.verifiedTimestamps = [];
  assert.throws(() => anchor.__test.validateVerifiedGhOutput(noTimestamp.output,
    noTimestamp.parsedBundle, noTimestamp.decisionEvidence, noTimestamp.policy),
  /exactly one external timestamp/);
});

test('receipt bytes, policy fields, and root authorization are never inferred or widened', () => {
  const policy = policyFixture();
  assert.throws(() => anchor.__test.validatePolicy({ ...policy, surprise: true }), /policy keys differ/);
  assert.throws(() => anchor.__test.validatePolicy({ ...policy, trustedRootSha256: null }),
    /trustedRootSha256/);
  assert.throws(() => anchor.__test.validatePolicy({ ...policy,
    workflowRef: 'example/investments/.github/workflows/other.yml@refs/heads/main' }),
  /workflowRef/);
  assert.throws(() => anchor.__test.validatePolicy({ ...policy,
    firstEligibleExecutionAtUtc: '2026-08-31T20:00:00Z' }), /cutoff is not exact UTC/);
  assert.equal(anchor.canonicalBytes({ b: 2, a: 1 }).toString('utf8'), '{"a":1,"b":2}\n');
  assert.equal(anchor.sidecarBytes('/x/anchor.json', 'f'.repeat(64)).toString('utf8'),
    `${'f'.repeat(64)}  anchor.json\n`);
});

test('static-root verification can never unlock the three-year endpoint', () => {
  assert.deepEqual(anchor.LONG_HORIZON_TRUST_POLICY, {
    status: 'BLOCKED_STATIC_TRUSTED_ROOT_CANNOT_COVER_PROSPECTIVE_HORIZON',
    endpointEligible: false,
    reason: 'A single frozen trusted_root.jsonl snapshot cannot authorize future Fulcio/Rekor key rotations.',
    requiredResolution: 'Freeze a TUF bootstrap root and archive and offline-verify every signed root, timestamp, snapshot, targets metadata, and selected trusted-root target update before accepting rotated keys.',
  });
  assert.equal(Object.isFrozen(anchor.LONG_HORIZON_TRUST_POLICY), true);
  assert.throws(() => anchor.assertEndpointAnchorPolicyReady(),
    /BLOCKED_COMPLETE_PER_DECISION_TUF_COVERAGE_NOT_ESTABLISHED/);
});
