'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const anchor = require('../scripts/pls1-lockbox-anchor');

// Every artifact below is synthetic and exists only in an isolated temporary
// directory. No fixture is a real seed, manifest, production receipt, Sigstore
// attestation, or activation input.

function sha256(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function fileReference(relativePath, bytes, version) {
  return { path: relativePath, bytes: bytes.length, sha256: sha256(bytes), version };
}

function contentReference(relativePath, bytes) {
  return { path: relativePath, bytes: bytes.length, sha256: sha256(bytes) };
}

function writeBound(root, relativePath, bytes) {
  const file = path.join(root, ...relativePath.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
  fs.writeFileSync(`${file}.sha256`, anchor.sidecarBytes(file, sha256(bytes)));
}

function tufKey() {
  const pair = crypto.generateKeyPairSync('ed25519');
  const publicDer = pair.publicKey.export({ type: 'spki', format: 'der' });
  return {
    id: sha256(publicDer),
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    tuf: {
      keytype: 'ed25519',
      scheme: 'ed25519',
      keyval: { public: pair.publicKey.export({ type: 'spki', format: 'pem' }).toString() },
    },
  };
}

function signEnvelope(signed, signers) {
  const bytes = anchor.__test.canonicalTufSignedBytes(signed);
  return {
    signatures: signers.map(signer => ({
      keyid: signer.id,
      sig: crypto.sign(null, bytes, signer.privateKey).toString('hex'),
    })),
    signed,
  };
}

function metadataBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 1)}\n`);
}

function rootSigned(version, rootKey, timestampKey, snapshotKey, targetsKey) {
  return {
    _type: 'root',
    spec_version: '1.0',
    version,
    expires: '2027-12-31T23:59:59Z',
    consistent_snapshot: true,
    keys: {
      [rootKey.id]: rootKey.tuf,
      [timestampKey.id]: timestampKey.tuf,
      [snapshotKey.id]: snapshotKey.tuf,
      [targetsKey.id]: targetsKey.tuf,
    },
    roles: {
      root: { keyids: [rootKey.id], threshold: 1 },
      timestamp: { keyids: [timestampKey.id], threshold: 1 },
      snapshot: { keyids: [snapshotKey.id], threshold: 1 },
      targets: { keyids: [targetsKey.id], threshold: 1 },
    },
  };
}

function selectionReceipt({ purpose, selectionTimeUtc, lockboxId, bootstrapReference,
  rootChain, timestampReference, snapshotReference, targetsReference, targetReference,
  jsonlReference, selectedLog, unknownField = false }) {
  const receipt = {
    schema: anchor.TUF_SELECTION_RECEIPT_SCHEMA,
    status: anchor.TUF_SELECTION_RECEIPT_STATUS,
    purpose,
    lockboxId,
    selectionTimeUtc,
    bootstrapRoot: bootstrapReference,
    rootChain,
    timestamp: timestampReference,
    snapshot: snapshotReference,
    targets: targetsReference,
    selectedTrustedRoot: {
      targetName: 'trusted_root.json',
      targetReference,
      jsonlPath: jsonlReference.path,
      jsonlBytes: jsonlReference.bytes,
      jsonlSha256: jsonlReference.sha256,
      jsonlEntryIndex: 0,
    },
    selectedTransparencyLog: selectedLog,
    versions: {
      root: rootChain.length ? rootChain.at(-1).version : bootstrapReference.version,
      timestamp: timestampReference.version,
      snapshot: snapshotReference.version,
      targets: targetsReference.version,
      snapshotMetaVersions: { 'targets.json': targetsReference.version },
    },
  };
  if (unknownField) receipt.endpointEligible = true;
  receipt.receiptSha256 = anchor.hashCanonical(receipt);
  return receipt;
}

function bundleBytes(logIdKeyId, integratedTimeUnix) {
  const statement = { _type: 'synthetic-shape-only-not-an-attestation' };
  const bundle = {
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    verificationMaterial: {
      certificate: { rawBytes: Buffer.from('synthetic-certificate').toString('base64') },
      tlogEntries: [{
        logIndex: '1',
        logId: { keyId: logIdKeyId },
        kindVersion: { kind: 'dsse', version: '0.0.1' },
        integratedTime: String(integratedTimeUnix),
        inclusionPromise: { signedEntryTimestamp: Buffer.from('synthetic-set').toString('base64') },
        inclusionProof: {
          logIndex: '1', rootHash: Buffer.from('root').toString('base64'), treeSize: '1',
          hashes: [], checkpoint: { envelope: 'synthetic checkpoint' },
        },
        canonicalizedBody: Buffer.from('body').toString('base64'),
      }],
      timestampVerificationData: {},
    },
    dsseEnvelope: {
      payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
      payloadType: 'application/vnd.in-toto+json',
      signatures: [{ sig: Buffer.from('synthetic-signature').toString('base64') }],
    },
  };
  return Buffer.from(JSON.stringify(bundle));
}

function buildFixture(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pls1-tuf-anchor-'));
  const lockboxId = 'synthetic-pls1-tuf-v1';
  const decisionDate = '2026-08-28';
  const eventTimeUtc = '2026-08-28T10:00:02.000Z';
  const currentPolicyTimeUtc = '2026-08-29T12:00:00.000Z';
  const oldRootKey = tufKey();
  const newRootKey = tufKey();
  const timestampKey = tufKey();
  const snapshotKey = tufKey();
  const targetsKey = tufKey();
  const logKey = crypto.generateKeyPairSync('ed25519');
  const logPublicDer = logKey.publicKey.export({ type: 'spki', format: 'der' });
  const logIdKeyId = crypto.createHash('sha256').update(logPublicDer).digest('base64');
  const selectedLog = {
    baseUrl: 'https://rekor.synthetic.example',
    logIdKeyId,
    publicKeySha256: sha256(logPublicDer),
    validFromUtc: '2026-01-01T00:00:00Z',
    validUntilUtc: '2027-01-01T00:00:00Z',
  };
  const trustedRoot = {
    mediaType: 'application/vnd.dev.sigstore.trustedroot+json;version=0.1',
    tlogs: [{
      baseUrl: selectedLog.baseUrl,
      hashAlgorithm: 'SHA2_256',
      publicKey: {
        rawBytes: logPublicDer.toString('base64'),
        keyDetails: 'PKIX_ED25519',
        validFor: { start: selectedLog.validFromUtc, end: selectedLog.validUntilUtc },
      },
      logId: { keyId: selectedLog.logIdKeyId },
    }],
    certificateAuthorities: [],
    ctlogs: [],
    timestampAuthorities: [],
  };
  const targetBytes = metadataBytes(trustedRoot);
  const targetSha = sha256(targetBytes);
  const targetReference = contentReference(
    `freeze/tuf/targets/${targetSha}.trusted_root.json`, targetBytes);
  writeBound(root, targetReference.path, targetBytes);
  const jsonlBytes = Buffer.from(`${JSON.stringify(trustedRoot)}\n`);
  const jsonlSha = sha256(jsonlBytes);
  const jsonlReference = contentReference(
    `freeze/tuf/trusted-root-jsonl/${jsonlSha}.trusted_root.jsonl`, jsonlBytes);
  writeBound(root, jsonlReference.path, jsonlBytes);

  const targetsSigned = {
    _type: 'targets', spec_version: '1.0', version: 3,
    expires: options.targetsExpires || '2027-12-31T23:59:59Z',
    targets: {
      'trusted_root.json': {
        length: targetBytes.length,
        hashes: { sha256: options.targetDescriptorSha256 || targetSha },
      },
    },
  };
  const targetsEnvelope = signEnvelope(targetsSigned, [targetsKey]);
  const targetsBytes = metadataBytes(targetsEnvelope);
  const targetsReference = fileReference(anchor.__test.targetsRelativePath(3), targetsBytes, 3);
  writeBound(root, targetsReference.path, targetsBytes);

  const snapshotSigned = {
    _type: 'snapshot', spec_version: '1.0', version: 5,
    expires: options.snapshotExpires || '2027-12-31T23:59:59Z',
    meta: {
      'targets.json': {
        version: 3, length: targetsBytes.length, hashes: { sha256: sha256(targetsBytes) },
      },
    },
  };
  const snapshotEnvelope = signEnvelope(snapshotSigned, [snapshotKey]);
  const snapshotBytes = metadataBytes(snapshotEnvelope);
  const snapshotReference = fileReference(anchor.__test.snapshotRelativePath(5), snapshotBytes, 5);
  writeBound(root, snapshotReference.path, snapshotBytes);

  const timestampSigned = {
    _type: 'timestamp', spec_version: '1.0', version: 7,
    expires: options.timestampExpires || '2027-12-31T23:59:59Z',
    meta: {
      'snapshot.json': {
        version: 5, length: snapshotBytes.length,
        hashes: { sha256: options.snapshotDescriptorSha256 || sha256(snapshotBytes) },
      },
    },
  };
  const timestampEnvelope = signEnvelope(timestampSigned, [timestampKey]);
  const timestampBytes = metadataBytes(timestampEnvelope);
  const timestampReference = fileReference(anchor.__test.timestampRelativePath(7), timestampBytes, 7);
  writeBound(root, timestampReference.path, timestampBytes);

  const root1Envelope = signEnvelope(
    rootSigned(1, oldRootKey, timestampKey, snapshotKey, targetsKey), [oldRootKey]);
  const root1Bytes = metadataBytes(root1Envelope);
  const bootstrapPin = {
    version: 1,
    relativePath: 'freeze/tuf/bootstrap/1.root.json',
    bytes: root1Bytes.length,
    sha256: sha256(root1Bytes),
  };
  writeBound(root, bootstrapPin.relativePath, root1Bytes);
  const root2Signed = rootSigned(2, newRootKey, timestampKey, snapshotKey, targetsKey);
  const root2Envelope = signEnvelope(root2Signed,
    options.omitOldRootAuthorization ? [newRootKey] : [oldRootKey, newRootKey]);
  const root2Bytes = metadataBytes(root2Envelope);
  const root2Reference = fileReference(anchor.__test.rootHistoryRelativePath(2), root2Bytes, 2);
  writeBound(root, root2Reference.path, root2Bytes);

  const eventReceiptPath = anchor.__test.eventTufSelectionRelativePath(decisionDate);
  const eventReceipt = selectionReceipt({
    purpose: 'EVENT_TIME', selectionTimeUtc: '2026-08-28T09:59:00.000Z', lockboxId,
    bootstrapReference: {
      path: bootstrapPin.relativePath, bytes: bootstrapPin.bytes,
      sha256: bootstrapPin.sha256, version: bootstrapPin.version,
    },
    rootChain: [root2Reference], timestampReference, snapshotReference, targetsReference,
    targetReference, jsonlReference, selectedLog,
    unknownField: options.eventReceiptUnknownField,
  });
  const eventReceiptBytes = anchor.canonicalBytes(eventReceipt);
  writeBound(root, eventReceiptPath, eventReceiptBytes);
  const currentReceiptPath = anchor.__test.currentTufSelectionRelativePath(
    decisionDate, currentPolicyTimeUtc);
  const currentReceipt = selectionReceipt({
    purpose: 'CURRENT_POLICY', selectionTimeUtc: currentPolicyTimeUtc, lockboxId,
    bootstrapReference: {
      path: bootstrapPin.relativePath, bytes: bootstrapPin.bytes,
      sha256: bootstrapPin.sha256, version: bootstrapPin.version,
    },
    rootChain: [root2Reference], timestampReference, snapshotReference, targetsReference,
    targetReference, jsonlReference, selectedLog,
  });
  const currentReceiptBytes = anchor.canonicalBytes(currentReceipt);
  writeBound(root, currentReceiptPath, currentReceiptBytes);

  const decision = {
    schema: 'fg-control-residual-pls1-six-market-decision-bundle-v1',
    status: 'PROSPECTIVE_CANDIDATE_NOT_YET_TRUSTED',
    lockboxId,
    modelId: 'FG-CONTROL-RESIDUAL-PLS1-PREQ-V1',
    collectedAtUtc: '2026-08-28T10:00:00.000Z',
    signalKnownAtUtc: '2026-08-28T10:00:00.000Z',
    decisionDate,
    tufTrustSelection: {
      schema: anchor.TUF_TRUST_BINDING_SCHEMA,
      bootstrapRootSha256: bootstrapPin.sha256,
      eventSelectionReceiptPath: eventReceiptPath,
      eventSelectionReceiptSha256: sha256(eventReceiptBytes),
      trustedRootJsonlPath: jsonlReference.path,
      trustedRootJsonlSha256: jsonlReference.sha256,
      selectedLogBaseUrl: selectedLog.baseUrl,
      selectedLogIdKeyId: selectedLog.logIdKeyId,
      selectedLogPublicKeySha256: selectedLog.publicKeySha256,
    },
    markets: {},
  };
  const decisionBytes = anchor.canonicalBytes(decision);
  writeBound(root, anchor.decisionRelativePath(decisionDate), decisionBytes);
  const integratedTimeUnix = Date.parse(eventTimeUtc) / 1000;
  const sigstoreBundleBytes = bundleBytes(logIdKeyId, integratedTimeUnix);
  writeBound(root, anchor.bundleRelativePath(decisionDate), sigstoreBundleBytes);

  const floor = {
    root: { version: 2, sha256: root2Reference.sha256 },
    timestamp: { version: 7, sha256: timestampReference.sha256 },
    snapshot: { version: 5, sha256: snapshotReference.sha256 },
    targets: { version: 3, sha256: targetsReference.sha256 },
    snapshotMetaVersions: { 'targets.json': 3 },
  };
  const policy = {
    schema: anchor.TUF_REPLAY_POLICY_SCHEMA,
    lockboxId,
    decisionDate,
    decisionSha256: sha256(decisionBytes),
    bundleSha256: sha256(sigstoreBundleBytes),
    eventTimeUtc,
    currentPolicyTimeUtc,
    eventRollbackFloor: structuredClone(floor),
    currentRollbackFloor: structuredClone(floor),
    currentSelectionReceipt: { path: currentReceiptPath, sha256: sha256(currentReceiptBytes) },
  };
  return { root, bootstrapPin, policy, root1Envelope, root2Envelope, selectedLog,
    eventReceipt, currentReceipt };
}

function runFixture(fixture) {
  return anchor.__test.verifyOfflineTufReplayWithBootstrap({
    lockboxRoot: fixture.root,
    policy: fixture.policy,
    bootstrapPin: fixture.bootstrapPin,
  });
}

test('the exact frozen Sigstore root-10 bytes and 3-of-5 threshold verify offline', () => {
  const fixturePath = path.join(__dirname, 'fixtures', 'sigstore-root-10.json.gz.b64');
  const compressed = Buffer.from(fs.readFileSync(fixturePath, 'utf8').trim(), 'base64');
  const bytes = zlib.gunzipSync(compressed);
  assert.equal(bytes.length, anchor.SIGSTORE_TUF_BOOTSTRAP.bytes);
  assert.equal(sha256(bytes), anchor.SIGSTORE_TUF_BOOTSTRAP.sha256);
  const envelope = anchor.__test.parseStrictJsonBytes(bytes, 'frozen real Sigstore root 10');
  anchor.__test.validateTufRootEnvelope(envelope, 'frozen real Sigstore root 10');
  assert.equal(envelope.signed.version, 10);
  assert.equal(envelope.signed.roles.root.threshold, 3);
  assert.equal(anchor.__test.verifyTufThreshold(envelope, envelope.signed, 'root',
    'frozen real Sigstore root 10 self-signature'), 5);
});

test('offline TUF replay verifies two policy times but remains explicitly endpoint-blocked', t => {
  const fixture = buildFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const result = runFixture(fixture);
  assert.equal(result.status, 'SINGLE_DECISION_TUF_DUAL_REPLAY_VERIFIED_ENDPOINT_BLOCKED');
  assert.equal(result.event.selectionVerifiedForOneDecisionOnly, true);
  assert.equal(result.current.selectionVerifiedForOneDecisionOnly, true);
  assert.equal(result.singleDecisionTufSelectionVerified, true);
  assert.equal(result.completePerDecisionCoverageVerified, false);
  assert.equal(result.sigstoreBundleCryptographyVerifiedByThisLayer, false);
  assert.equal(result.endpointEligible, false);
  assert.equal(result.endpointTrustPolicy.endpointEligible, false);
  assert.match(result.endpointTrustPolicy.status, /^BLOCKED_/);
});

test('root rotation requires sequential old-root and new-root threshold authorization', t => {
  const fixture = buildFixture({ omitOldRootAuthorization: true });
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  assert.throws(() => runFixture(fixture), /old-root authorization has 0 valid root signatures/);
});

test('timestamp-to-snapshot and targets-to-selected-root mix-and-match attacks fail closed', t => {
  const snapshotMismatch = buildFixture({ snapshotDescriptorSha256: 'f'.repeat(64) });
  t.after(() => fs.rmSync(snapshotMismatch.root, { recursive: true, force: true }));
  assert.throws(() => runFixture(snapshotMismatch), /timestamp-to-snapshot SHA-256 mix-and-match/);

  const targetMismatch = buildFixture({ targetDescriptorSha256: 'e'.repeat(64) });
  t.after(() => fs.rmSync(targetMismatch.root, { recursive: true, force: true }));
  assert.throws(() => runFixture(targetMismatch), /selected trusted-root target mix-and-match/);
});

test('rollback, freeze, unknown claims, and missing current replay all fail closed', t => {
  const crossReplayRollback = buildFixture();
  t.after(() => fs.rmSync(crossReplayRollback.root, { recursive: true, force: true }));
  crossReplayRollback.policy.currentRollbackFloor.timestamp.version = 6;
  crossReplayRollback.policy.currentRollbackFloor.timestamp.sha256 = '0'.repeat(64);
  assert.throws(() => runFixture(crossReplayRollback),
    /current timestamp rollback floor predates the event-time floor/);

  const rollback = buildFixture();
  t.after(() => fs.rmSync(rollback.root, { recursive: true, force: true }));
  rollback.policy.currentRollbackFloor.timestamp.version = 8;
  assert.throws(() => runFixture(rollback), /timestamp rollback detected/);

  const freeze = buildFixture({ timestampExpires: '2026-08-29T11:59:59Z' });
  t.after(() => fs.rmSync(freeze.root, { recursive: true, force: true }));
  assert.throws(() => runFixture(freeze), /timestamp is expired \(freeze attack\)/);

  const unknown = buildFixture({ eventReceiptUnknownField: true });
  t.after(() => fs.rmSync(unknown.root, { recursive: true, force: true }));
  assert.throws(() => runFixture(unknown), /selection receipt keys differ/);

  const missingCurrent = buildFixture();
  t.after(() => fs.rmSync(missingCurrent.root, { recursive: true, force: true }));
  delete missingCurrent.policy.currentSelectionReceipt;
  assert.throws(() => runFixture(missingCurrent), /replay policy keys differ/);
});

test('strict TUF JSON rejects duplicate names and trusted-root JSONL must be exact compact LF', () => {
  assert.equal(anchor.__test.canonicalTufSignedBytes({ pem: 'line1\nline2\\"' }).toString(),
    '{"pem":"line1\nline2\\\\\\""}',
    'TUF uses OLPC canonical strings: literal newline, escaped backslash and quote only');
  assert.throws(() => anchor.__test.parseStrictJsonBytes(
    Buffer.from('{"signed":{"version":1,"version":2},"signatures":[]}'), 'duplicate fixture'),
  /duplicate object key version/);
  assert.throws(() => anchor.__test.parseCompactTrustedRootJsonl(Buffer.from('{ }\n'), 'JSONL fixture'),
    /not exact compact JSON/);
  assert.throws(() => anchor.__test.parseCompactTrustedRootJsonl(Buffer.from('{}\r\n'), 'JSONL fixture'),
    /without CR bytes/);
});

test('post-load intrinsic mutation and prototype setters cannot produce an accepted replay', t => {
  const fixture = buildFixture();
  t.after(() => fs.rmSync(fixture.root, { recursive: true, force: true }));
  const nativeStringify = JSON.stringify;
  JSON.stringify = () => '{}';
  try {
    assert.throws(() => runFixture(fixture), /security-critical intrinsic was mutated/);
  } finally {
    JSON.stringify = nativeStringify;
  }

  Object.defineProperty(Object.prototype, 'a', {
    configurable: true,
    set() { throw new Error('ambient setter executed'); },
  });
  Object.defineProperty(Array.prototype, '0', {
    configurable: true,
    set() { throw new Error('ambient array setter executed'); },
  });
  try {
    assert.equal(anchor.canonicalBytes({ a: 1, b: [2] }).toString(), '{"a":1,"b":[2]}\n');
  } finally {
    delete Object.prototype.a;
    delete Array.prototype[0];
  }
});
