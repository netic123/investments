'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const common = require('./pls1-lockbox-common');
const seedBuilder = require('./build-pls1-lockbox-seed');
const model = require('../research/fear_greed_control_residual_pls1');

const MAX_GITHUB_API_RESPONSE_BYTES = 2 * 1024 * 1024;
const ATTEMPT_FAILURE_STAGE = Object.freeze([
  ...common.ATTEMPT_FAILURE_STAGE,
  'FROZEN_CALENDAR_HORIZON_EXHAUSTED',
  'ACTIVATION_FORWARD_HORIZON',
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function canonicalWithoutHash(value, hashKey) {
  const copy = { ...value };
  delete copy[hashKey];
  return copy;
}

function gitBytesAtHead(relativePath, repoRoot = common.ROOT) {
  try {
    return childProcess.execFileSync('git', ['show', `HEAD:${relativePath}`], { cwd: repoRoot });
  } catch {
    throw new Error(`${relativePath}: file must be committed in HEAD`);
  }
}

function assertManifestCommitted(manifestPath = common.MANIFEST_PATH, repoRoot = common.ROOT) {
  const relative = path.relative(repoRoot, manifestPath).replace(/\\/g, '/');
  const committed = gitBytesAtHead(relative, repoRoot);
  const current = fs.readFileSync(manifestPath);
  if (!committed.equals(current)) throw new Error('working manifest differs from committed HEAD bytes');
  const commitSha = childProcess.execFileSync('git', ['log', '-1', '--format=%H', '--', relative], {
    cwd: repoRoot, encoding: 'utf8',
  }).trim();
  if (!/^[a-f0-9]{40}$/.test(commitSha)) throw new Error('manifest commit identity is invalid');
  const sourceCommitSha = JSON.parse(current.toString('utf8')).sourceCommitSha;
  if (!/^[a-f0-9]{40}$/.test(String(sourceCommitSha))) {
    throw new Error('manifest source commit identity is invalid');
  }
  if (commitSha === sourceCommitSha) {
    throw new Error('manifest commit must strictly descend from its frozen source commit');
  }
  require('./pls1-lockbox-git-binding').assertGitObjectBinding({
    repoRoot,
    manifestPath,
    manifestCommitSha: commitSha,
  });
  return { commitSha };
}

function assertCleanProductionCheckout(manifest) {
  const status = childProcess.execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: common.ROOT, encoding: 'utf8',
  }).trim();
  if (status) throw new Error(`production checkout is not clean: ${status.split(/\r?\n/)[0]}`);
  const head = childProcess.execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: common.ROOT, encoding: 'utf8',
  }).trim();
  if (process.env.GITHUB_SHA !== head || process.env.GITHUB_WORKFLOW_SHA !== head) {
    throw new Error('GitHub event/workflow SHA must both equal the checked-out frozen HEAD');
  }
  for (const identity of manifest.pinnedFiles) {
    const committed = gitBytesAtHead(identity.path);
    const current = fs.readFileSync(path.join(common.ROOT, identity.path));
    if (!committed.equals(current)) throw new Error(`${identity.path}: frozen bytes are not HEAD bytes`);
  }
  return head;
}

function loadBundles(lockboxRoot = common.LOCKBOX_ROOT) {
  return common.listDecisionFiles(lockboxRoot).map(file => ({
    file,
    sha256: common.verifySidecar(file),
    value: readJson(file),
  }));
}

function historicalRows(seedMarket, bundles, marketKey) {
  const rows = seedMarket.rows.map(row => ({ ...row, availableAtUtc: null }));
  for (const bundle of bundles) {
    const record = bundle.value.markets && bundle.value.markets[marketKey];
    if (!record || !Array.isArray(record.newRows)) throw new Error(`${bundle.file}: missing ${marketKey} newRows`);
    for (const source of record.newRows) {
      const row = { ...source, availableAtUtc: null };
      if (row.date <= rows.at(-1).date) throw new Error(`${marketKey}: primary rows are not strictly increasing`);
      rows.push(row);
    }
  }
  return rows;
}

function prospectiveRows(acquiredMarket, priorRows, availableAtUtc) {
  const last = priorRows.at(-1);
  if (!last || !acquiredMarket || !Array.isArray(acquiredMarket.rows)) {
    throw new Error(`${acquiredMarket && acquiredMarket.key}: missing current or prior rows`);
  }
  const rawByDate = new Map(acquiredMarket.rows.map(row => [row.date, row]));
  const targetAnchor = [...priorRows].reverse().find(row => Number.isFinite(row.targetClose)
    && row.targetClose > 0 && rawByDate.get(row.date)
    && Number.isFinite(rawByDate.get(row.date).targetClose)
    && rawByDate.get(row.date).targetClose > 0);
  if (!targetAnchor) throw new Error(`${acquiredMarket.key}: no current-vintage target bridge row`);
  const rawTargetBase = rawByDate.get(targetAnchor.date).targetClose;
  const cashAnchor = [...priorRows].reverse().find(row => Number.isFinite(row.cashClose)
    && row.cashClose > 0 && rawByDate.get(row.date)
    && Number.isFinite(rawByDate.get(row.date).cashClose) && rawByDate.get(row.date).cashClose > 0);
  if (!cashAnchor) throw new Error(`${acquiredMarket.key}: no current-vintage cash bridge row`);
  const rawCashBase = rawByDate.get(cashAnchor.date).cashClose;
  const newer = acquiredMarket.rows.filter(row => row.date > last.date);
  return newer.map((source, index) => {
    if (!(Number.isFinite(source.targetClose) && source.targetClose > 0)
        || !(Number.isFinite(source.cashClose) && source.cashClose > 0)) {
      throw new Error(`${acquiredMarket.key} ${source.date}: prospective target and cash closes must both be finite and positive`);
    }
    const targetClose = targetAnchor.targetClose * (source.targetClose / rawTargetBase);
    const cashClose = cashAnchor.cashClose * (source.cashClose / rawCashBase);
    if (!(Number.isFinite(targetClose) && targetClose > 0)
        || !(Number.isFinite(cashClose) && cashClose > 0)) {
      throw new Error(`${acquiredMarket.key} ${source.date}: invalid chained close`);
    }
    return {
      date: source.date,
      targetClose,
      cashClose,
      referenceDate: source.referenceDate,
      components: { ...source.components },
      componentAsOf: { ...source.componentAsOf },
      availableAtUtc: index === newer.length - 1 ? availableAtUtc : null,
    };
  });
}

// Backward-compatible pure helper retained for focused invariance tests.
function latestProspectiveRow(seedMarket, acquiredMarket, priorRows, availableAtUtc) {
  const rows = prospectiveRows(acquiredMarket, priorRows, availableAtUtc);
  return rows.length ? rows.at(-1) : null;
}

function eventRecord(kind, fields) {
  const event = { schema: `fg-control-residual-pls1-${kind.toLowerCase()}-v1`, kind, ...fields };
  event.eventSha256 = model.hashCanonical(event);
  return model.deepFreeze(event);
}

function eventIdentity(kind, modelKey, decisionSha256) {
  return `${kind}:${modelKey}:${decisionSha256}`;
}

function resolvedEventsForMarket(bundles, marketKey, rowsOrCurrent) {
  // The one-row form exists only for unit-level timing validation.
  if (!Array.isArray(rowsOrCurrent)) {
    const previous = bundles.at(-1);
    if (!previous) return [];
    const priorMarket = previous.value.markets[marketKey];
    const current = rowsOrCurrent;
    if (!(current.date > priorMarket.decisions.M0.decisionDate)) {
      throw new Error(`${marketKey}: fill target session must be strictly later than decision session`);
    }
    return ['M0', 'M1'].map(modelKey => {
      const decision = priorMarket.decisions[modelKey];
      return eventRecord('FILL', {
        market: marketKey,
        model: modelKey,
        decisionSha256: decision.decisionSha256,
        decisionDate: decision.decisionDate,
        decisionRecordedAtUtc: previous.value.collectedAtUtc,
        fillDate: current.date,
        filledPosition: decision.targetPosition,
        targetClose: current.targetClose,
        cashClose: current.cashClose,
        oneWayPrimaryCost: model.COSTS[priorMarket.marketClass].primary,
        oneWayStressCost: model.COSTS[priorMarket.marketClass].stress,
        costChargedOnlyIfStateChanged: decision.tradeRequired,
      });
    });
  }

  const allRows = rowsOrCurrent;
  const rowIndex = new Map(allRows.map((row, index) => [row.date, index]));
  const already = new Set();
  for (const bundle of bundles) {
    const events = bundle.value.markets[marketKey].resolvedEvents || [];
    for (const event of events) already.add(eventIdentity(event.kind, event.model, event.decisionSha256));
  }
  const candidates = [];
  for (const origin of bundles) {
    const originMarket = origin.value.markets[marketKey];
    const originIndex = rowIndex.get(origin.value.decisionDate);
    if (!Number.isInteger(originIndex)) throw new Error(`${marketKey}: decision row missing from primary ledger`);
    const fillRow = allRows[originIndex + 1];
    const outcomeRow = allRows[originIndex + 2];
    for (const modelKey of ['M0', 'M1']) {
      const decision = originMarket.decisions[modelKey];
      if (fillRow && !already.has(eventIdentity('FILL', modelKey, decision.decisionSha256))) {
        if (!(fillRow.date > decision.decisionDate)) {
          throw new Error(`${marketKey}: fill target session must be strictly later than decision session`);
        }
        candidates.push({ effectiveDate: fillRow.date, kindOrder: 0, event: eventRecord('FILL', {
          market: marketKey,
          model: modelKey,
          decisionSha256: decision.decisionSha256,
          decisionDate: decision.decisionDate,
          decisionRecordedAtUtc: origin.value.collectedAtUtc,
          fillDate: fillRow.date,
          filledPosition: decision.targetPosition,
          targetClose: fillRow.targetClose,
          cashClose: fillRow.cashClose,
          oneWayPrimaryCost: model.COSTS[originMarket.marketClass].primary,
          oneWayStressCost: model.COSTS[originMarket.marketClass].stress,
          costChargedOnlyIfStateChanged: decision.tradeRequired,
        }) });
      }
      if (fillRow && outcomeRow
          && !already.has(eventIdentity('OUTCOME', modelKey, decision.decisionSha256))) {
        const valid = [fillRow.targetClose, outcomeRow.targetClose,
          fillRow.cashClose, outcomeRow.cashClose].every(value => Number.isFinite(value) && value > 0);
        const relativeLogReturn = valid
          ? Math.log(outcomeRow.targetClose / fillRow.targetClose)
            - Math.log(outcomeRow.cashClose / fillRow.cashClose) : null;
        candidates.push({ effectiveDate: outcomeRow.date, kindOrder: 1, event: eventRecord('OUTCOME', {
          market: marketKey,
          model: modelKey,
          decisionSha256: decision.decisionSha256,
          decisionDate: decision.decisionDate,
          executionDate: fillRow.date,
          outcomeEndDate: outcomeRow.date,
          valid,
          invalidReason: valid ? null : 'MISSING_NONPOSITIVE_EXECUTION_OR_OUTCOME_CLOSE',
          relativeLogReturn,
        }) });
      }
    }
  }
  candidates.sort((left, right) => left.effectiveDate.localeCompare(right.effectiveDate)
    || left.kindOrder - right.kindOrder
    || left.event.decisionDate.localeCompare(right.event.decisionDate)
    || left.event.model.localeCompare(right.event.model));
  return candidates.map(item => item.event);
}

function maxUtc(values) {
  const valid = values.filter(value => typeof value === 'string' && Number.isFinite(Date.parse(value)));
  if (!valid.length) throw new Error('no valid UTC availability timestamps');
  return new Date(Math.max(...valid.map(Date.parse))).toISOString();
}

function localTestProvenance(nowUtc) {
  return {
    environment: 'LOCAL_TEST_ONLY',
    eventName: 'test',
    scheduleExpression: null,
    runId: 'local-test',
    runAttempt: 1,
    runCreatedAtUtc: nowUtc,
    runStartedAtUtc: nowUtc,
    headSha: '0'.repeat(40),
    workflowSha: '0'.repeat(40),
    repository: 'local/test',
    repositoryId: '0',
    ref: 'refs/heads/test',
    serverUrl: 'https://github.invalid',
    runnerEnvironment: 'self-hosted-test',
  };
}

async function githubRunProvenance(manifest) {
  const integrity = manifest && manifest.remoteIntegrity;
  if (!integrity) throw new Error('production collection requires frozen remote integrity metadata');
  const required = ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_WORKFLOW_SHA',
    'GITHUB_REPOSITORY', 'GITHUB_REPOSITORY_ID', 'GITHUB_REF', 'GITHUB_EVENT_NAME',
    'GITHUB_SERVER_URL', 'GITHUB_API_URL', 'GITHUB_WORKFLOW_REF', 'RUNNER_ENVIRONMENT',
    'GITHUB_TOKEN'];
  for (const key of required) if (!process.env[key]) throw new Error(`production collection requires ${key}`);
  if (!/^[1-9]\d*$/.test(process.env.GITHUB_RUN_ID)
      || !/^[1-9]\d*$/.test(process.env.GITHUB_RUN_ATTEMPT)) {
    throw new Error('production collection requires canonical positive run id and attempt');
  }
  const runAttempt = Number(process.env.GITHUB_RUN_ATTEMPT);
  if (!Number.isSafeInteger(runAttempt)) throw new Error('GitHub run attempt is outside the safe integer range');
  if (process.env.GITHUB_API_URL !== integrity.actionsApiBaseUrl
      || process.env.GITHUB_SERVER_URL !== integrity.serverUrl
      || process.env.GITHUB_REPOSITORY !== integrity.repository
      || process.env.GITHUB_REPOSITORY_ID !== integrity.repositoryId
      || process.env.GITHUB_REF !== integrity.ref
      || process.env.GITHUB_WORKFLOW_REF !== integrity.workflowRef
      || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
    throw new Error('GitHub environment does not match the frozen remote identity');
  }
  if (process.env.GITHUB_SHA !== process.env.GITHUB_WORKFLOW_SHA) {
    throw new Error('GitHub workflow SHA must equal the frozen run head SHA');
  }
  if (!['schedule', 'workflow_dispatch'].includes(process.env.GITHUB_EVENT_NAME)) {
    throw new Error(`unsupported GitHub event ${process.env.GITHUB_EVENT_NAME}`);
  }
  const scheduleExpression = process.env.PLS1_TRIGGER_SCHEDULE || null;
  if (process.env.GITHUB_EVENT_NAME === 'schedule'
      && !common.SCHEDULE_EXPRESSIONS.includes(scheduleExpression)) {
    throw new Error('scheduled run has an unknown or missing schedule expression');
  }
  if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch' && scheduleExpression !== null) {
    throw new Error('manual run cannot claim a schedule expression');
  }
  const apiUrl = `${integrity.actionsApiBaseUrl}/repos/${integrity.repository}`
    + `/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT}`;
  const response = await fetch(apiUrl, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': seedBuilder.USER_AGENT,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  if (response.url !== apiUrl) {
    throw new Error('GitHub workflow-run attempt final response URL is not the canonical request URL');
  }
  const bytes = await common.readResponseBodyLimited(response, MAX_GITHUB_API_RESPONSE_BYTES,
    'GitHub workflow-run attempt provenance response');
  if (!response.ok) throw new Error(`GitHub workflow-run attempt provenance HTTP ${response.status}`);
  const run = JSON.parse(bytes.toString('utf8'));
  if (String(run.id) !== process.env.GITHUB_RUN_ID || run.head_sha !== process.env.GITHUB_SHA
      || run.run_attempt !== runAttempt || String(run.workflow_id) !== integrity.workflowId
      || run.path !== integrity.workflowPath || run.head_branch !== integrity.branch
      || run.event !== process.env.GITHUB_EVENT_NAME
      || !run.repository || run.repository.full_name !== integrity.repository
      || String(run.repository && run.repository.id) !== process.env.GITHUB_REPOSITORY_ID
      || run.html_url !== `${integrity.serverUrl}/${integrity.repository}/actions/runs/${process.env.GITHUB_RUN_ID}`
      || !Number.isFinite(Date.parse(run.created_at)) || !Number.isFinite(Date.parse(run.run_started_at))) {
    throw new Error('GitHub workflow-run attempt provenance response does not match the frozen identity');
  }
  const immutableProjection = model.deepFreeze({
    schema: 'fg-control-residual-pls1-github-run-attempt-projection-v1',
    apiRequestUrl: apiUrl,
    apiResponseUrl: response.url,
    eventName: run.event,
    headBranch: run.head_branch,
    headSha: run.head_sha,
    htmlUrl: run.html_url,
    ref: process.env.GITHUB_REF,
    repository: run.repository.full_name,
    repositoryId: String(run.repository.id),
    runAttempt: run.run_attempt,
    runCreatedAtUtc: new Date(run.created_at).toISOString(),
    runId: String(run.id),
    runStartedAtUtc: new Date(run.run_started_at).toISOString(),
    workflowId: String(run.workflow_id),
    workflowPath: run.path,
    workflowRef: process.env.GITHUB_WORKFLOW_REF,
    workflowSha: process.env.GITHUB_WORKFLOW_SHA,
  });
  return {
    environment: 'GITHUB_ACTIONS_REMOTE',
    eventName: immutableProjection.eventName,
    scheduleExpression,
    runId: immutableProjection.runId,
    runAttempt: immutableProjection.runAttempt,
    runCreatedAtUtc: immutableProjection.runCreatedAtUtc,
    runStartedAtUtc: immutableProjection.runStartedAtUtc,
    headSha: immutableProjection.headSha,
    workflowSha: immutableProjection.workflowSha,
    workflowId: immutableProjection.workflowId,
    workflowPath: immutableProjection.workflowPath,
    workflowRef: immutableProjection.workflowRef,
    repository: immutableProjection.repository,
    repositoryId: immutableProjection.repositoryId,
    ref: immutableProjection.ref,
    serverUrl: integrity.serverUrl,
    runnerEnvironment: process.env.RUNNER_ENVIRONMENT,
    apiRequestUrl: immutableProjection.apiRequestUrl,
    apiResponseUrl: immutableProjection.apiResponseUrl,
    immutableProjection,
    immutableProjectionSha256: model.hashCanonical(immutableProjection),
    htmlUrl: immutableProjection.htmlUrl,
  };
}

async function assertLiveBranchProtection(manifest) {
  const integrity = manifest && manifest.remoteIntegrity;
  if (!integrity || !process.env.GITHUB_TOKEN) {
    throw new Error('live branch-protection verification requires frozen integrity and GITHUB_TOKEN');
  }
  const apiUrl = `${integrity.actionsApiBaseUrl}/repos/${integrity.repository}`
    + `/branches/${encodeURIComponent(integrity.branch)}/protection`;
  const response = await fetch(apiUrl, {
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
      'x-github-api-version': '2022-11-28',
      'user-agent': seedBuilder.USER_AGENT,
    },
    redirect: 'error',
    signal: AbortSignal.timeout(20000),
  });
  if (response.url !== apiUrl) throw new Error('branch-protection response URL is not canonical');
  const bytes = await common.readResponseBodyLimited(response, MAX_GITHUB_API_RESPONSE_BYTES,
    'GitHub branch-protection response');
  if (!response.ok) throw new Error(`branch-protection verification HTTP ${response.status}`);
  if (bytes.length < 2 || bytes.length > 2 * 1024 * 1024) {
    throw new Error('branch-protection response size is invalid');
  }
  let protection;
  try {
    protection = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('branch-protection response is not JSON');
  }
  if (!protection || !protection.enforce_admins || protection.enforce_admins.enabled !== true
      || !protection.allow_force_pushes || protection.allow_force_pushes.enabled !== false
      || !protection.allow_deletions || protection.allow_deletions.enabled !== false
      || model.hashCanonical(protection) !== integrity.branchProtectionSnapshotSha256) {
    throw new Error('live branch protection differs from the frozen protected-history snapshot');
  }
  return model.deepFreeze({
    apiUrl,
    snapshotSha256: integrity.branchProtectionSnapshotSha256,
  });
}

function computeDecisionBundleMarkets({ seed, bundles, newRowsByMarket }) {
  const markets = {};
  let decisionDate = null;
  for (const key of common.MARKET_ORDER) {
    const seedMarket = seed.markets[key];
    const priorRows = historicalRows(seedMarket, bundles, key);
    const newRows = newRowsByMarket[key];
    if (!Array.isArray(newRows) || !newRows.length) throw new Error(`${key}: no new target session`);
    const inputRow = newRows.at(-1);
    if (decisionDate === null) decisionDate = inputRow.date;
    if (inputRow.date !== decisionDate) throw new Error(`six-market decision dates differ: ${key}=${inputRow.date}`);
    if (!(inputRow.date > seed.firstProspectiveDecisionMustBeAfter[key])) {
      throw new Error(`${key}: first decision is not strictly after the complete historical seed`);
    }
    const rows = [...priorRows, ...newRows];
    const priorMarket = bundles.length ? bundles.at(-1).value.markets[key] : null;
    const positions = priorMarket ? {
      M0: priorMarket.decisions.M0.targetPosition,
      M1: priorMarket.decisions.M1.targetPosition,
    } : { M0: 'LONG', M1: 'LONG' };
    const result = model.buildLatestDecision({
      key,
      name: seedMarket.name,
      targetId: seedMarket.targetId,
      cashId: seedMarket.cashId,
      marketClass: seedMarket.marketClass,
      rows,
    }, positions);
    markets[key] = {
      marketClass: seedMarket.marketClass,
      sentimentReferenceId: seedMarket.sentimentReferenceId,
      targetId: seedMarket.targetId,
      cashId: seedMarket.cashId,
      newRows,
      newRowsSha256: model.hashCanonical(newRows),
      missedDecisionDates: newRows.slice(0, -1).map(row => row.date),
      inputRow,
      inputRowSha256: model.hashCanonical(inputRow),
      decisions: { M0: result.M0, M1: result.M1 },
      fit: result.fit,
      resolvedEvents: resolvedEventsForMarket(bundles, key, rows),
    };
  }
  const previousBundle = bundles.length ? {
    decisionDate: bundles.at(-1).value.decisionDate,
    sha256: bundles.at(-1).sha256,
  } : null;
  return model.deepFreeze({ markets, decisionDate, previousBundle });
}

function buildDecisionBundle({
  seed,
  manifest,
  seedSha256,
  manifestSha256,
  manifestCommit,
  acquired,
  sourceReceipts,
  bundles,
  collectedAtUtc,
  signalKnownAtUtc = collectedAtUtc,
  dataAvailableAtUtc = collectedAtUtc,
  provenance,
  newRowsByMarket,
  computed = null,
}) {
  const calculation = computed || computeDecisionBundleMarkets({ seed, bundles, newRowsByMarket });
  const decisionDate = calculation.decisionDate;
  const markets = Object.fromEntries(common.MARKET_ORDER.map(key => {
    const record = calculation.markets[key];
    return [key, { ...record, decisions: {
      M0: model.stampDecisionAvailability(record.decisions.M0, signalKnownAtUtc),
      M1: model.stampDecisionAvailability(record.decisions.M1, signalKnownAtUtc),
    } }];
  }));
  const previousBundle = calculation.previousBundle
    || { decisionDate: 'MANIFEST', sha256: manifestSha256 };
  if (signalKnownAtUtc !== collectedAtUtc || dataAvailableAtUtc > signalKnownAtUtc) {
    if (signalKnownAtUtc !== collectedAtUtc) throw new Error('collectedAtUtc must equal signalKnownAtUtc');
    throw new Error('data availability cannot postdate signal computation');
  }
  return model.deepFreeze({
    schema: 'fg-control-residual-pls1-six-market-decision-bundle-v1',
    status: 'PROSPECTIVE_CANDIDATE_NOT_YET_TRUSTED',
    lockboxId: manifest.lockboxId,
    modelId: manifest.modelId,
    manifestSha256,
    seedSha256,
    manifestCommitSha: manifestCommit.commitSha,
    mode: bundles.length ? 'DAILY_OR_RECOVERY_REMOTE_RUN' : 'POST_MANIFEST_REMOTE_ACTIVATION',
    collectedAtUtc: signalKnownAtUtc,
    signalKnownAtUtc,
    decisionDate,
    previousBundle,
    remoteRun: provenance,
    sourceAcquisition: {
      state: common.ACQUISITION_STATE.COMPLETE_REPLAY_VERIFIED,
      range: acquired.range,
      retrievalDateUtc: acquired.retrievalDateUtc,
      acquiredAtUtc: acquired.acquiredAtUtc,
      dataAvailableAtUtc,
      marketfgNormalizedSha256: acquired.marketfgNormalizedSha256,
      targetCalendarSha256: acquired.targetCalendarSha256,
      alignedMarketsSha256: model.hashCanonical(acquired.markets),
      sourceSelections: acquired.sourceSelections,
      rawResponses: sourceReceipts,
    },
    marketOrder: common.MARKET_ORDER,
    markets,
    forbiddenUntilTrustGate: ['TRUSTED', 'VALIDATED', 'BEATS_INDEX', '2X'],
  });
}

function writeAttempt(lockboxRoot, collectedAtUtc, provenance, fields) {
  const attempts = common.listAttemptFiles(lockboxRoot);
  const previousAttempt = attempts.length ? {
    path: path.relative(lockboxRoot, attempts.at(-1)).replace(/\\/g, '/'),
    sha256: common.verifySidecar(attempts.at(-1)),
  } : { path: 'GENESIS', sha256: fields.manifestSha256 };
  const data = {
    schema: 'fg-control-residual-pls1-attempt-v1',
    lockboxId: common.LOCKBOX_ID,
    collectedAtUtc,
    remoteRun: provenance,
    previousAttempt,
    ...fields,
  };
  data.attemptSha256 = model.hashCanonical(data);
  const file = common.attemptPath(lockboxRoot, collectedAtUtc,
    `${provenance.runId}-${provenance.runAttempt}`);
  return common.createCanonicalWithSidecar(file, data);
}

function beforeSafetyCutoff(utc) {
  return new Date(utc).getUTCHours() < 12;
}

function notStartedSourceAcquisition(range, retrievalDateUtc) {
  return model.deepFreeze({
    state: common.ACQUISITION_STATE.NOT_STARTED,
    range,
    retrievalDateUtc,
    rawResponses: [],
  });
}

function partialSourceAcquisition(range, retrievalDateUtc, rawResponses) {
  return model.deepFreeze({
    state: common.ACQUISITION_STATE.PARTIAL_UNVERIFIED,
    range,
    retrievalDateUtc,
    rawResponses,
  });
}

function completeSourceAcquisition(acquired, rawResponses, dataAvailableAtUtc) {
  return model.deepFreeze({
    state: common.ACQUISITION_STATE.COMPLETE_REPLAY_VERIFIED,
    range: acquired.range,
    retrievalDateUtc: acquired.retrievalDateUtc,
    acquiredAtUtc: acquired.acquiredAtUtc,
    dataAvailableAtUtc,
    marketfgNormalizedSha256: acquired.marketfgNormalizedSha256,
    targetCalendarSha256: acquired.targetCalendarSha256,
    alignedMarketsSha256: model.hashCanonical(acquired.markets),
    sourceSelections: acquired.sourceSelections,
    rawResponses,
  });
}

function latestPermanentLedgerDate(seed, bundles) {
  const dates = common.MARKET_ORDER.map(key => historicalRows(seed.markets[key], bundles, key).at(-1).date);
  if (new Set(dates).size !== 1) {
    throw new Error(`six-market permanent ledgers have different terminal dates: ${dates.join(',')}`);
  }
  return dates[0];
}

function attemptFailureReason(stage) {
  if (!ATTEMPT_FAILURE_STAGE.includes(stage)) {
    throw new Error(`unknown attempt failure stage ${stage}`);
  }
  return `FAILED_${stage}`;
}

async function collect(options = {}) {
  const lockboxRoot = options.lockboxRoot || common.LOCKBOX_ROOT;
  const production = common.isProductionLockboxRoot(lockboxRoot);
  if (production && (Object.hasOwn(options, 'clock') || Object.hasOwn(options, 'acquire')
      || Object.hasOwn(options, 'provenance'))) {
    throw new Error('production collection forbids injected clock, acquisition, or provenance');
  }
  const clock = production ? () => new Date() : (options.clock || (() => new Date()));
  const acquire = production ? seedBuilder.acquireAlignedData
    : (options.acquire || seedBuilder.acquireAlignedData);
  const seedPath = path.join(lockboxRoot, 'freeze', 'seed.json');
  const manifestPath = path.join(lockboxRoot, 'freeze', 'manifest.json');
  const seedSha256 = common.verifySidecar(seedPath);
  const manifestSha256 = common.verifySidecar(manifestPath);
  const seed = readJson(seedPath);
  const manifest = readJson(manifestPath);
  let provenance;
  let manifestCommit;
  if (production) {
    if (process.env.PLS1_RAW_ARCHIVE_RIGHTS_CONFIRMED !== 'YES') {
      throw new Error('production raw-response archival is blocked until source rights are confirmed');
    }
    common.assertRequiredRuntime({ production: true });
    // Strict verification and clean/pinned checkout checks precede market-data network access.
    require('./pls1-lockbox-verify').verifyLockbox(lockboxRoot, { verifyPinnedFiles: true });
    manifestCommit = assertManifestCommitted(manifestPath);
    assertCleanProductionCheckout(manifest);
    provenance = await githubRunProvenance(manifest);
  } else {
    const initial = clock().toISOString();
    manifestCommit = { commitSha: '0'.repeat(40) };
    provenance = options.provenance || localTestProvenance(initial);
  }
  const bundles = loadBundles(lockboxRoot);
  let acquired;
  let sourceReceipts = [];
  let dataAvailableAtUtc = null;
  let acquisitionRequest = null;
  let acquisitionStarted = false;
  let acquisitionReplayVerified = false;
  let failureStage = 'PREFLIGHT';
  let decisionTerminalWritten = false;
  try {
    const startedAtUtc = clock().toISOString();
    acquisitionRequest = { range: '5y', retrievalDateUtc: startedAtUtc.slice(0, 10) };
    if (!beforeSafetyCutoff(startedAtUtc)) {
      writeAttempt(lockboxRoot, startedAtUtc, provenance, {
        status: common.ATTEMPT_STATUS.SKIPPED_PAST_CUTOFF,
        reason: common.ATTEMPT_REASON.PRE_ACQUISITION_CUTOFF,
        failureStage: null,
        errorSha256: null,
        manifestSha256,
        seedSha256,
        sourceAcquisition: notStartedSourceAcquisition(
          acquisitionRequest.range, acquisitionRequest.retrievalDateUtc),
      });
      return { written: false, reason: common.ATTEMPT_REASON.PRE_ACQUISITION_CUTOFF };
    }
    if (production) await assertLiveBranchProtection(manifest);
    const latestFrozenSession = seedBuilder.frozenTargetCalendar(
      seed.sourceIdentityContract, acquisitionRequest.retrievalDateUtc).at(-1);
    const ledgerDate = latestPermanentLedgerDate(seed, bundles);
    if (latestFrozenSession < ledgerDate) {
      throw new Error(`frozen target calendar regressed behind permanent ledger: ${latestFrozenSession} < ${ledgerDate}`);
    }
    if (ledgerDate === seedBuilder.frozenTargetCalendarSessions(seed.sourceIdentityContract).at(-1)) {
      failureStage = 'FROZEN_CALENDAR_HORIZON_EXHAUSTED';
      throw new Error(`frozen target calendar horizon is exhausted at recorded terminal ${ledgerDate}; a new independently reviewed calendar freeze is required`);
    }
    if (latestFrozenSession === ledgerDate) {
      writeAttempt(lockboxRoot, startedAtUtc, provenance, {
        status: common.ATTEMPT_STATUS.SKIPPED_ALREADY_RECORDED_DATE,
        reason: common.ATTEMPT_REASON.LATEST_COMPLETED_SOURCE_SESSION_ALREADY_IN_LEDGER,
        failureStage: null,
        errorSha256: null,
        manifestSha256,
        seedSha256,
        sourceAcquisition: notStartedSourceAcquisition(
          acquisitionRequest.range, acquisitionRequest.retrievalDateUtc),
      });
      return {
        written: false,
        reason: common.ATTEMPT_REASON.LATEST_COMPLETED_SOURCE_SESSION_ALREADY_IN_LEDGER,
      };
    }
    failureStage = 'ACQUISITION';
    acquisitionStarted = true;
    acquired = await acquire(acquisitionRequest);
    failureStage = 'RAW_PERSISTENCE';
    sourceReceipts = seedBuilder.persistCapturedRequests(lockboxRoot, acquired.requests || []);
    failureStage = 'OFFLINE_REPLAY';
    const replay = seedBuilder.replayAlignedDataFromReceipts({
      receipts: sourceReceipts,
      sourceSelections: acquired.sourceSelections,
      loadRaw: receipt => common.verifyRawBlob(lockboxRoot, receipt),
      range: acquired.range,
      retrievalDateUtc: acquired.retrievalDateUtc,
      sourceIdentityContract: seed.sourceIdentityContract,
    });
    if (model.canonicalStringify(replay.markets) !== model.canonicalStringify(acquired.markets)
        || replay.marketfgNormalizedSha256 !== acquired.marketfgNormalizedSha256
        || replay.targetCalendarSha256 !== acquired.targetCalendarSha256
        || model.canonicalStringify(replay.cashMetadata) !== model.canonicalStringify(acquired.cashMetadata)) {
      throw new Error('acquisition does not replay exactly from role-bound response-body receipts');
    }
    acquisitionReplayVerified = true;
    failureStage = 'POST_ACQUISITION_CUTOFF';
    dataAvailableAtUtc = maxUtc([
      clock().toISOString(), acquired.acquiredAtUtc, provenance.runCreatedAtUtc,
      provenance.runStartedAtUtc, ...sourceReceipts.map(receipt => receipt.completedAtUtc),
    ]);
    if (dataAvailableAtUtc.slice(0, 10) !== acquired.retrievalDateUtc) {
      throw new Error('acquisition crossed a UTC retrieval-date boundary');
    }
    if (!beforeSafetyCutoff(dataAvailableAtUtc)) throw new Error('PAST_1200Z_SAFETY_CUTOFF_AFTER_ACQUISITION');
    failureStage = 'ROW_ALIGNMENT';
    const newRowsByMarket = {};
    for (const key of common.MARKET_ORDER) {
      const priorRows = historicalRows(seed.markets[key], bundles, key);
      newRowsByMarket[key] = prospectiveRows(acquired.markets[key], priorRows, dataAvailableAtUtc);
    }
    const dateSequences = common.MARKET_ORDER.map(key => newRowsByMarket[key].map(row => row.date).join(','));
    if (new Set(dateSequences).size !== 1) {
      throw new Error(`six-market target-session sequences differ: ${dateSequences.join(' | ')}`);
    }
    if (!newRowsByMarket[common.MARKET_ORDER[0]].length) {
      writeAttempt(lockboxRoot, dataAvailableAtUtc, provenance, {
        status: common.ATTEMPT_STATUS.SUCCESS_NO_NEW_DECISION,
        reason: common.ATTEMPT_REASON.NO_NEW_COMPLETED_COMMON_TARGET_SESSION,
        failureStage: null,
        errorSha256: null,
        manifestSha256, seedSha256,
        sourceAcquisition: completeSourceAcquisition(acquired, sourceReceipts, dataAvailableAtUtc),
      });
      return { written: false, reason: 'NO_NEW_DECISION_DATE' };
    }
    if (!bundles.length) {
      failureStage = 'ACTIVATION_FORWARD_HORIZON';
      seedBuilder.assertActivationForwardHorizon(seed.sourceIdentityContract,
        newRowsByMarket[common.MARKET_ORDER[0]].at(-1).date);
    }
    failureStage = 'MODEL_COMPUTATION';
    const computed = computeDecisionBundleMarkets({ seed, bundles, newRowsByMarket });
    const signalKnownAtUtc = maxUtc([clock().toISOString(), dataAvailableAtUtc]);
    failureStage = 'POST_COMPUTE_CUTOFF';
    if (signalKnownAtUtc.slice(0, 10) !== acquired.retrievalDateUtc
        || !beforeSafetyCutoff(signalKnownAtUtc)) {
      throw new Error('PAST_1200Z_SAFETY_CUTOFF_AFTER_MODEL_COMPUTATION');
    }
    failureStage = 'DECISION_PERSISTENCE';
    const bundle = buildDecisionBundle({
      seed, manifest, seedSha256, manifestSha256, manifestCommit, acquired,
      sourceReceipts, bundles, collectedAtUtc: signalKnownAtUtc, signalKnownAtUtc,
      dataAvailableAtUtc, provenance, newRowsByMarket, computed,
    });
    const file = common.decisionPath(lockboxRoot, bundle.decisionDate);
    if (fs.existsSync(file)) throw new Error(`append-only decision collision at ${bundle.decisionDate}`);
    const written = common.createCanonicalWithSidecar(file, bundle);
    decisionTerminalWritten = true;
    process.stdout.write(`${JSON.stringify({
      written: true,
      decisionDate: bundle.decisionDate,
      file: path.relative(common.ROOT, file).replace(/\\/g, '/'),
      sha256: written.sha256,
      missedDecisionDates: bundle.markets.crypto.missedDecisionDates,
      actions: Object.fromEntries(common.MARKET_ORDER.map(key => [key, {
        M0: bundle.markets[key].decisions.M0.action,
        M1: bundle.markets[key].decisions.M1.action,
        trainingRows: bundle.markets[key].decisions.M1.trainingRowCount,
      }])),
    }, null, 2)}\n`);
    return { written: true, file, bundle, sha256: written.sha256 };
  } catch (error) {
    if (decisionTerminalWritten) throw error;
    const captured = acquired && acquired.requests ? acquired.requests : error.capturedRequests;
    if (!sourceReceipts.length && Array.isArray(error.persistedReceipts)) {
      sourceReceipts = error.persistedReceipts;
    }
    if (!sourceReceipts.length && Array.isArray(captured)) {
      try {
        sourceReceipts = seedBuilder.persistCapturedRequests(lockboxRoot, captured);
      } catch (persistenceError) {
        failureStage = 'RAW_PERSISTENCE';
        sourceReceipts = [];
        error = persistenceError;
      }
    }
    const collectedAtUtc = maxUtc([
      clock().toISOString(), acquired && acquired.acquiredAtUtc, error.acquiredAtUtc,
      provenance.runCreatedAtUtc, provenance.runStartedAtUtc,
      ...sourceReceipts.map(receipt => receipt.completedAtUtc),
    ]);
    writeAttempt(lockboxRoot, collectedAtUtc, provenance, {
      status: common.ATTEMPT_STATUS.FAILED_NO_DECISION,
      reason: attemptFailureReason(failureStage),
      failureStage,
      errorSha256: common.sha256(Buffer.from(String(error.message || error))),
      manifestSha256,
      seedSha256,
      sourceAcquisition: acquisitionReplayVerified
        ? completeSourceAcquisition(acquired, sourceReceipts, dataAvailableAtUtc || collectedAtUtc)
        : (acquisitionStarted
          ? partialSourceAcquisition(acquisitionRequest.range,
            acquisitionRequest.retrievalDateUtc, sourceReceipts)
          : notStartedSourceAcquisition(acquisitionRequest.range, acquisitionRequest.retrievalDateUtc)),
    });
    throw error;
  }
}

async function main() {
  await collect();
}

module.exports = Object.freeze({
  canonicalWithoutHash,
  assertManifestCommitted,
  assertCleanProductionCheckout,
  loadBundles,
  historicalRows,
  prospectiveRows,
  latestProspectiveRow,
  eventRecord,
  resolvedEventsForMarket,
  maxUtc,
  localTestProvenance,
  githubRunProvenance,
  assertLiveBranchProtection,
  computeDecisionBundleMarkets,
  buildDecisionBundle,
  writeAttempt,
  beforeSafetyCutoff,
  notStartedSourceAcquisition,
  partialSourceAcquisition,
  completeSourceAcquisition,
  latestPermanentLedgerDate,
  attemptFailureReason,
  ATTEMPT_FAILURE_STAGE,
  MAX_GITHUB_API_RESPONSE_BYTES,
  collect,
});

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`PLS1 collection failed after persisting available evidence: ${error.stack || error.message}\n`);
    process.exit(1);
  });
}
