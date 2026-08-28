'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');
const binding = require('../scripts/pls1-lockbox-git-binding');

function git(root, args, options = {}) {
  return childProcess.execFileSync('git', args, {
    cwd: root,
    encoding: options.encoding === null ? null : 'utf8',
    input: options.input,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function gitText(root, args, options) {
  return git(root, args, options).toString('utf8').trim();
}

function write(file, bytes) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function initializeRepository(t, { wrongTree = false, unrelatedSource = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pls1-git-binding-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '-b', 'main']);
  git(root, ['config', 'user.name', 'PLS1 Test']);
  git(root, ['config', 'user.email', 'pls1-test@example.invalid']);
  write(path.join(root, '.gitattributes'), Buffer.from('* -text\n'));
  write(path.join(root, 'source.js'), Buffer.from("'use strict';\n"));
  git(root, ['add', '--', '.gitattributes', 'source.js']);
  git(root, ['commit', '-m', 'frozen source']);

  const mainSourceCommit = gitText(root, ['rev-parse', 'HEAD']);
  const sourceTreeSha = gitText(root, ['rev-parse', `${mainSourceCommit}^{tree}`]);
  const sourceCommitSha = unrelatedSource
    ? gitText(root, ['commit-tree', sourceTreeSha], { input: 'unrelated source\n' })
    : mainSourceCommit;
  const manifest = {
    schema: 'test-manifest-v1',
    sourceCommitSha,
    sourceTreeSha: wrongTree ? '0'.repeat(40) : sourceTreeSha,
  };
  const manifestPath = path.join(root, 'freeze', 'manifest.json');
  write(manifestPath, Buffer.from(JSON.stringify(manifest)));
  git(root, ['add', '--', 'freeze/manifest.json']);
  git(root, ['commit', '-m', 'freeze manifest']);
  const manifestCommitSha = gitText(root, ['rev-parse', 'HEAD']);
  return { root, manifestPath, manifestCommitSha, sourceCommitSha, sourceTreeSha };
}

test('binds source commit/tree, exact manifest blob, and checked-out HEAD ancestry', t => {
  const fixture = initializeRepository(t);
  const result = binding.assertGitObjectBinding({
    repoRoot: fixture.root,
    manifestPath: fixture.manifestPath,
    manifestCommitSha: fixture.manifestCommitSha,
  });
  assert.deepEqual(result, {
    sourceCommitSha: fixture.sourceCommitSha,
    sourceTreeSha: fixture.sourceTreeSha,
    manifestCommitSha: fixture.manifestCommitSha,
    headCommitSha: fixture.manifestCommitSha,
    manifestRelativePath: 'freeze/manifest.json',
  });
});

test('rejects a manifest whose declared source tree is not the source commit tree', t => {
  const fixture = initializeRepository(t, { wrongTree: true });
  assert.throws(() => binding.assertGitObjectBinding({
    repoRoot: fixture.root,
    manifestPath: fixture.manifestPath,
    manifestCommitSha: fixture.manifestCommitSha,
  }), /source tree mismatch/);
});

test('rejects working manifest bytes that differ from the frozen commit', t => {
  const fixture = initializeRepository(t);
  fs.appendFileSync(fixture.manifestPath, ' ');
  assert.throws(() => binding.assertGitObjectBinding({
    repoRoot: fixture.root,
    manifestPath: fixture.manifestPath,
    manifestCommitSha: fixture.manifestCommitSha,
  }), /current manifest bytes differ/);
});

test('rejects an unrelated source commit even when its tree hash matches', t => {
  const fixture = initializeRepository(t, { unrelatedSource: true });
  assert.throws(() => binding.assertGitObjectBinding({
    repoRoot: fixture.root,
    manifestPath: fixture.manifestPath,
    manifestCommitSha: fixture.manifestCommitSha,
  }), /source commit to frozen manifest commit.*ancestry is absent/);
});

test('rejects a frozen manifest commit that is not an ancestor of checked-out HEAD', t => {
  const fixture = initializeRepository(t);
  const tree = gitText(fixture.root, ['rev-parse', `${fixture.manifestCommitSha}^{tree}`]);
  const unrelatedHead = gitText(fixture.root, ['commit-tree', tree], { input: 'unrelated head\n' });
  git(fixture.root, ['checkout', '--detach', unrelatedHead]);
  assert.throws(() => binding.assertGitObjectBinding({
    repoRoot: fixture.root,
    manifestPath: fixture.manifestPath,
    manifestCommitSha: fixture.manifestCommitSha,
  }), /frozen manifest commit to checked-out HEAD.*ancestry is absent/);
});

test('rejects uppercase, short, and non-commit identities before trusting Git coercion', t => {
  const fixture = initializeRepository(t);
  for (const invalid of [fixture.manifestCommitSha.toUpperCase(),
    fixture.manifestCommitSha.slice(0, 12), `${'f'.repeat(39)}g`]) {
    assert.throws(() => binding.assertGitObjectBinding({
      repoRoot: fixture.root,
      manifestPath: fixture.manifestPath,
      manifestCommitSha: invalid,
    }), /exact 40-character lowercase SHA/);
  }
});

const SHA256_A = 'a'.repeat(64);
const SHA256_B = 'b'.repeat(64);
const SHA256_C = 'c'.repeat(64);
const SHA1_A = '1'.repeat(40);

function seal(record, digestKey) {
  const copy = structuredClone(record);
  delete copy[digestKey];
  record[digestKey] = binding.canonicalSha256(copy);
  return record;
}

function policyRemote() {
  return {
    apiBaseUrl: 'https://api.github.com',
    apiVersion: binding.API_VERSION,
    branch: 'main',
    ref: 'refs/heads/main',
    repository: 'netic123/investments',
    repositoryId: '1343383255',
  };
}

function policyFixture() {
  const remote = policyRemote();
  const rulesetListUrl = `${remote.apiBaseUrl}/repos/${remote.repository}/rulesets?includes_parents=true&targets=branch&per_page=100&page=1`;
  const branchRulesUrl = `${remote.apiBaseUrl}/repos/${remote.repository}/rules/branches/main?per_page=100&page=1`;
  const rulesetDetailUrl = `${remote.apiBaseUrl}/repos/${remote.repository}/rulesets/42?includes_parents=true`;
  const protectionUrl = `${remote.apiBaseUrl}/repos/${remote.repository}/branches/main/protection`;
  const snapshot = {
    schema: binding.POLICY_SCHEMA,
    ...remote,
    capturedAtUtc: '2026-08-28T12:00:00.000Z',
    legacyBranchProtection: {
      schema: 'fg-control-residual-pls1-legacy-branch-protection-v1',
      apiRequestUrl: protectionUrl,
      apiResponseUrl: protectionUrl,
      responseBodySha256: SHA256_A,
      present: true,
      enforceAdmins: true,
      allowForcePushes: false,
      allowDeletions: false,
      bypassActors: [],
    },
    rulesetEnumeration: {
      schema: 'fg-control-residual-pls1-ruleset-enumeration-v1',
      includesParents: true,
      targets: 'branch',
      perPage: 100,
      complete: true,
      pages: [{
        schema: 'fg-control-residual-pls1-ruleset-enumeration-page-v1',
        page: 1,
        apiRequestUrl: rulesetListUrl,
        apiResponseUrl: rulesetListUrl,
        responseBodySha256: SHA256_B,
        rulesetIds: ['42'],
        nextPageUrl: null,
      }],
    },
    effectiveBranchRuleEnumeration: {
      schema: 'fg-control-residual-pls1-effective-branch-rule-enumeration-v1',
      perPage: 100,
      complete: true,
      pages: [{
        schema: 'fg-control-residual-pls1-effective-branch-rule-page-v1',
        page: 1,
        apiRequestUrl: branchRulesUrl,
        apiResponseUrl: branchRulesUrl,
        responseBodySha256: SHA256_C,
        rules: [{
          schema: 'fg-control-residual-pls1-effective-branch-rule-v1',
          rulesetId: '42',
          rulesetSourceType: 'Repository',
          rulesetSource: remote.repository,
          type: 'non_fast_forward',
          parametersSha256: SHA256_A,
        }],
        nextPageUrl: null,
      }],
    },
    rulesets: [{
      schema: 'fg-control-residual-pls1-ruleset-detail-v1',
      id: '42',
      name: 'Immutable main history',
      target: 'branch',
      sourceType: 'Repository',
      source: remote.repository,
      enforcement: 'active',
      apiRequestUrl: rulesetDetailUrl,
      apiResponseUrl: rulesetDetailUrl,
      responseBodySha256: SHA256_A,
      bypassActorsPropertyPresent: true,
      bypassActors: [],
      conditionsSha256: SHA256_B,
      rulesSha256: SHA256_C,
    }],
    snapshotSha256: SHA256_A,
  };
  return seal(snapshot, 'snapshotSha256');
}

function mutatePolicy(mutator) {
  const snapshot = policyFixture();
  mutator(snapshot);
  return seal(snapshot, 'snapshotSha256');
}

test('effective GitHub policy binds legacy protection plus every parent-aware active ruleset', () => {
  const snapshot = policyFixture();
  assert.deepEqual(binding.assertEffectivePolicySnapshot(snapshot, {
    remote: policyRemote(),
    expectedSnapshotSha256: snapshot.snapshotSha256,
  }), {
    effectiveRuleCount: 1,
    effectiveRulesetCount: 1,
    legacyBypassActorCount: 0,
    rulesetCount: 1,
    snapshotSha256: snapshot.snapshotSha256,
  });
});

test('policy gate fails closed for the current live-style 404/empty and legacy-only states', () => {
  assert.throws(() => binding.assertEffectivePolicySnapshot(mutatePolicy(snapshot => {
    snapshot.legacyBranchProtection.present = false;
  }), { remote: policyRemote() }), /absent, weakened, or redirected/);

  assert.throws(() => binding.assertEffectivePolicySnapshot(mutatePolicy(snapshot => {
    snapshot.rulesetEnumeration.pages[0].rulesetIds = [];
    snapshot.rulesets = [];
    snapshot.effectiveBranchRuleEnumeration.pages[0].rules = [];
  }), { remote: policyRemote() }), /legacy branch protection alone is insufficient/);
});

test('policy gate requires complete includes_parents pagination and detail parity', () => {
  const cases = [
    snapshot => { snapshot.rulesetEnumeration.includesParents = false; },
    snapshot => { snapshot.rulesetEnumeration.complete = false; },
    snapshot => { snapshot.rulesetEnumeration.pages[0].nextPageUrl = 'https://example.invalid/next'; },
    snapshot => { snapshot.rulesets[0].bypassActorsPropertyPresent = false; },
    snapshot => { snapshot.rulesets = []; },
    snapshot => { snapshot.effectiveBranchRuleEnumeration.complete = false; },
  ];
  for (const mutate of cases) {
    assert.throws(() => binding.assertEffectivePolicySnapshot(mutatePolicy(mutate), {
      remote: policyRemote(),
    }), /incomplete|pagination|visibility|inventory differ|details differ|invalid/);
  }
});

test('policy gate records modes but rejects every applicable ruleset or legacy bypass actor', () => {
  for (const bypassMode of ['always', 'pull_request', 'exempt']) {
    assert.throws(() => binding.assertEffectivePolicySnapshot(mutatePolicy(snapshot => {
      snapshot.rulesets[0].bypassActors.push({
        actorId: '6', actorType: 'Integration', bypassMode,
      });
    }), { remote: policyRemote() }), /bypass actors/);
  }
  assert.throws(() => binding.assertEffectivePolicySnapshot(mutatePolicy(snapshot => {
    snapshot.legacyBranchProtection.bypassActors.push({
      actorId: '7',
      actorName: 'release-admin',
      actorType: 'User',
      bypassMode: 'always',
      surface: 'PULL_REQUEST_BYPASS_ALLOWANCE',
    });
  }), { remote: policyRemote() }), /legacy branch protection has a bypass actor/);
});

test('policy gate rejects non-active effective rulesets, unknown fields, and any snapshot drift', () => {
  assert.throws(() => binding.assertEffectivePolicySnapshot(mutatePolicy(snapshot => {
    snapshot.rulesets[0].enforcement = 'evaluate';
  }), { remote: policyRemote() }), /active ruleset detail/);
  assert.throws(() => binding.assertEffectivePolicySnapshot(mutatePolicy(snapshot => {
    snapshot.rulesets[0].trusted = true;
  }), { remote: policyRemote() }), /exact keys mismatch/);
  const snapshot = policyFixture();
  snapshot.snapshotSha256 = SHA256_A;
  assert.throws(() => binding.assertEffectivePolicySnapshot(snapshot, {
    remote: policyRemote(),
  }), /snapshot hash mismatch/);
  const valid = policyFixture();
  assert.throws(() => binding.assertEffectivePolicySnapshot(valid, {
    remote: policyRemote(), expectedSnapshotSha256: SHA256_A,
  }), /differs from the frozen manifest snapshot/);
});

test('evidence digests retain captured JSON and SHA-256 bindings after direct replacement', () => {
  const snapshot = policyFixture();
  const originalStringify = JSON.stringify;
  const originalCreateHash = crypto.createHash;
  JSON.stringify = () => '"forged"';
  crypto.createHash = () => ({ update() { return this; }, digest() { return SHA256_A; } });
  try {
    const result = binding.assertEffectivePolicySnapshot(snapshot, { remote: policyRemote() });
    assert.equal(result.snapshotSha256, snapshot.snapshotSha256);
  } finally {
    JSON.stringify = originalStringify;
    crypto.createHash = originalCreateHash;
  }
});

function workflowRemote() {
  return {
    ...policyRemote(),
    workflowId: '987654321',
    workflowPath: '.github/workflows/pls1-lockbox.yml',
    workflowRef: 'netic123/investments/.github/workflows/pls1-lockbox.yml@refs/heads/main',
  };
}

function workflowRunListUrl(remote, date, page = 1) {
  return `${remote.apiBaseUrl}/repos/${remote.repository}/actions/workflows/${remote.workflowId}`
    + `/runs?branch=main&created=${date}&per_page=100&page=${page}`;
}

function workflowAttempt(remote, runId, runAttempt, conclusion) {
  const url = `${remote.apiBaseUrl}/repos/${remote.repository}/actions/runs/${runId}`
    + `/attempts/${runAttempt}`;
  const attempt = {
    schema: 'fg-control-residual-pls1-terminal-workflow-run-attempt-v1',
    runId,
    runAttempt,
    status: 'completed',
    conclusion,
    eventName: 'schedule',
    repositoryId: remote.repositoryId,
    workflowId: remote.workflowId,
    workflowPath: remote.workflowPath,
    workflowRef: remote.workflowRef,
    headBranch: remote.branch,
    headSha: SHA1_A,
    workflowSha: SHA1_A,
    ref: remote.ref,
    createdAtUtc: '2026-08-28T06:17:00.000Z',
    runStartedAtUtc: `2026-08-28T06:1${6 + runAttempt}:01.000Z`,
    updatedAtUtc: `2026-08-28T06:2${6 + runAttempt}:01.000Z`,
    apiRequestUrl: url,
    apiResponseUrl: url,
    responseBodySha256: runAttempt === 1 ? SHA256_A : SHA256_B,
    attemptProjectionSha256: SHA256_A,
  };
  return seal(attempt, 'attemptProjectionSha256');
}

function resealInventory(inventory, { attempts = true } = {}) {
  if (attempts) {
    for (const run of inventory.runs) {
      for (const attempt of run.attempts) seal(attempt, 'attemptProjectionSha256');
    }
  }
  return seal(inventory, 'inventorySha256');
}

function reconciliationFixture() {
  const remote = workflowRemote();
  const runId = '10001';
  const date = '2026-08-28';
  const listUrl = workflowRunListUrl(remote, date);
  const attempts = [
    workflowAttempt(remote, runId, 1, 'startup_failure'),
    workflowAttempt(remote, runId, 2, 'success'),
  ];
  const inventory = {
    schema: binding.RUN_INVENTORY_SCHEMA,
    ...remote,
    activationDateUtc: date,
    observedDateUtc: date,
    queryDays: [{
      schema: 'fg-control-residual-pls1-workflow-run-query-day-v1',
      createdDateUtc: date,
      totalCount: 1,
      complete: true,
      pages: [{
        schema: 'fg-control-residual-pls1-workflow-run-query-page-v1',
        page: 1,
        apiRequestUrl: listUrl,
        apiResponseUrl: listUrl,
        responseBodySha256: SHA256_C,
        runs: [{
          schema: 'fg-control-residual-pls1-workflow-run-summary-v1',
          runId,
          latestRunAttempt: 2,
        }],
        nextPageUrl: null,
      }],
    }],
    runs: [{
      schema: 'fg-control-residual-pls1-workflow-run-v1',
      runId,
      latestRunAttempt: 2,
      eventName: 'schedule',
      repositoryId: remote.repositoryId,
      workflowId: remote.workflowId,
      workflowPath: remote.workflowPath,
      workflowRef: remote.workflowRef,
      headBranch: remote.branch,
      headSha: SHA1_A,
      workflowSha: SHA1_A,
      ref: remote.ref,
      createdAtUtc: '2026-08-28T06:17:00.000Z',
      attempts,
    }],
    inventorySha256: SHA256_A,
  };
  resealInventory(inventory);
  const terminalArtifacts = attempts.map((attempt, index) => ({
    schema: 'fg-control-residual-pls1-terminal-artifact-index-v1',
    runId,
    runAttempt: index + 1,
    artifactKind: index === 0 ? 'ATTEMPT' : 'DECISION',
    artifactPath: index === 0
      ? `research/lockbox/control-residual-pls1-v1/attempts/2026/08/28/${runId}-1.json`
      : 'research/lockbox/control-residual-pls1-v1/decisions/2026/08/28/decision.json',
    artifactSha256: index === 0 ? SHA256_A : SHA256_B,
    attemptProjectionSha256: attempt.attemptProjectionSha256,
    recordedConclusion: attempt.conclusion,
  }));
  return { inventory, remote, terminalArtifacts };
}

test('reconciles every immutable 1..run_attempt identity including pre-job startup failure', () => {
  const fixture = reconciliationFixture();
  assert.deepEqual(binding.assertCompleteRunAttemptReconciliation(
    fixture.inventory, fixture.terminalArtifacts, {
      remote: fixture.remote,
      expectedInventorySha256: fixture.inventory.inventorySha256,
    }), {
    inventorySha256: fixture.inventory.inventorySha256,
    queryDayCount: 1,
    terminalArtifactCount: 2,
    workflowRunAttemptCount: 2,
    workflowRunCount: 1,
  });
});

test('run reconciliation rejects missing, duplicate, and unknown terminal artifacts', () => {
  {
    const fixture = reconciliationFixture();
    fixture.terminalArtifacts.shift();
    assert.throws(() => binding.assertCompleteRunAttemptReconciliation(
      fixture.inventory, fixture.terminalArtifacts, { remote: fixture.remote }),
    /missing terminal artifact.*10001:1/);
  }
  {
    const fixture = reconciliationFixture();
    fixture.terminalArtifacts.push(structuredClone(fixture.terminalArtifacts[0]));
    assert.throws(() => binding.assertCompleteRunAttemptReconciliation(
      fixture.inventory, fixture.terminalArtifacts, { remote: fixture.remote }),
    /unknown or duplicate terminal/);
  }
  {
    const fixture = reconciliationFixture();
    fixture.terminalArtifacts[0].runId = '99999';
    assert.throws(() => binding.assertCompleteRunAttemptReconciliation(
      fixture.inventory, fixture.terminalArtifacts, { remote: fixture.remote }),
    /unknown or duplicate terminal/);
  }
});

test('run reconciliation requires contiguous attempt enumeration and terminal conclusions', () => {
  {
    const fixture = reconciliationFixture();
    fixture.inventory.runs[0].attempts.shift();
    fixture.inventory.runs[0].latestRunAttempt = 1;
    fixture.inventory.queryDays[0].pages[0].runs[0].latestRunAttempt = 1;
    resealInventory(fixture.inventory);
    assert.throws(() => binding.assertCompleteRunAttemptReconciliation(
      fixture.inventory, fixture.terminalArtifacts, { remote: fixture.remote }),
    /runId|runAttempt|terminal status|immutable identity/);
  }
  {
    const fixture = reconciliationFixture();
    fixture.inventory.runs[0].attempts[0].status = 'queued';
    resealInventory(fixture.inventory);
    assert.throws(() => binding.assertCompleteRunAttemptReconciliation(
      fixture.inventory, fixture.terminalArtifacts, { remote: fixture.remote }),
    /terminal status/);
  }
  {
    const fixture = reconciliationFixture();
    fixture.terminalArtifacts[0].artifactKind = 'DECISION';
    assert.throws(() => binding.assertCompleteRunAttemptReconciliation(
      fixture.inventory, fixture.terminalArtifacts, { remote: fixture.remote }),
    /does not bind the immutable attempt conclusion/);
  }
});

test('run reconciliation rejects identity drift, projection tampering, and open schemas', () => {
  {
    const fixture = reconciliationFixture();
    fixture.inventory.runs[0].attempts[1].headSha = '2'.repeat(40);
    resealInventory(fixture.inventory);
    assert.throws(() => binding.assertCompleteRunAttemptReconciliation(
      fixture.inventory, fixture.terminalArtifacts, { remote: fixture.remote }),
    /immutable identity mismatch/);
  }
  {
    const fixture = reconciliationFixture();
    fixture.inventory.runs[0].attempts[1].updatedAtUtc = '2026-08-28T06:29:01.000Z';
    resealInventory(fixture.inventory, { attempts: false });
    assert.throws(() => binding.assertCompleteRunAttemptReconciliation(
      fixture.inventory, fixture.terminalArtifacts, { remote: fixture.remote }),
    /immutable projection hash mismatch/);
  }
  {
    const fixture = reconciliationFixture();
    fixture.inventory.runs[0].attempts[0].trusted = true;
    resealInventory(fixture.inventory, { attempts: false });
    assert.throws(() => binding.assertCompleteRunAttemptReconciliation(
      fixture.inventory, fixture.terminalArtifacts, { remote: fixture.remote }),
    /exact keys mismatch/);
  }
});

test('run inventory cannot skip UTC days, exceed GitHub search limits, or claim incomplete pages', () => {
  {
    const fixture = reconciliationFixture();
    fixture.inventory.observedDateUtc = '2026-08-29';
    resealInventory(fixture.inventory);
    assert.throws(() => binding.assertCompleteRunAttemptReconciliation(
      fixture.inventory, fixture.terminalArtifacts, { remote: fixture.remote }),
    /omits one or more UTC query dates/);
  }
  {
    const fixture = reconciliationFixture();
    fixture.inventory.queryDays[0].totalCount = 1000;
    resealInventory(fixture.inventory);
    assert.throws(() => binding.assertCompleteRunAttemptReconciliation(
      fixture.inventory, fixture.terminalArtifacts, { remote: fixture.remote }),
    /search-limit/);
  }
  {
    const fixture = reconciliationFixture();
    fixture.inventory.queryDays[0].complete = false;
    resealInventory(fixture.inventory);
    assert.throws(() => binding.assertCompleteRunAttemptReconciliation(
      fixture.inventory, fixture.terminalArtifacts, { remote: fixture.remote }),
    /coverage is incomplete/);
  }
});

test('draft workflow is deliberately read-only and activation-locked pending remote reconciliation', () => {
  const workflow = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows',
    'pls1-lockbox.yml'), 'utf8');
  assert.match(workflow, /contents: read/);
  assert.match(workflow, /actions: read/);
  assert.match(workflow, /PLS1_REMOTE_INTEGRITY_ACTIVATION_DISABLED/);
  assert.match(workflow, /Production activation safety lock[\s\S]*exit 1/);
  assert.doesNotMatch(workflow, /contents: write|git push|pls1-lockbox-collect\.js|PLS1_RAW_ARCHIVE/);
});
