'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const crypto = require('node:crypto');

const SHA1_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const DECIMAL_ID_PATTERN = /^[1-9]\d*$/;
const UTC_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
const POLICY_SCHEMA = 'fg-control-residual-pls1-effective-github-policy-v1';
const RUN_INVENTORY_SCHEMA = 'fg-control-residual-pls1-workflow-run-inventory-v1';
const API_VERSION = '2026-03-10';
const TERMINAL_CONCLUSIONS = Object.freeze([
  'action_required',
  'cancelled',
  'failure',
  'neutral',
  'skipped',
  'stale',
  'startup_failure',
  'success',
  'timed_out',
]);
const RULESET_SOURCE_TYPES = Object.freeze(['Enterprise', 'Organization', 'Repository']);
const RULESET_ENFORCEMENT = Object.freeze(['active', 'disabled', 'evaluate']);
const RULESET_ACTOR_TYPES = Object.freeze([
  'DeployKey',
  'Integration',
  'OrganizationAdmin',
  'RepositoryRole',
  'Team',
  'User',
]);
const RULESET_BYPASS_MODES = Object.freeze(['always', 'exempt', 'pull_request']);
const LEGACY_BYPASS_SURFACES = Object.freeze([
  'PULL_REQUEST_BYPASS_ALLOWANCE',
  'RESTRICTION_BYPASS',
]);

// Capture only the JSON/SHA-256 digest primitives used below so a later direct
// replacement of those two bindings cannot forge a digest. This module does not
// claim to survive arbitrary in-process mutation of Array/Object/Map/Set/Date
// intrinsics: production use still requires a clean, pinned Node process with no
// preload/injected code, plus independently authenticated remote evidence.
const NATIVE_ARRAY_IS_ARRAY = Array.isArray;
const NATIVE_ARRAY_SORT = Function.prototype.call.bind(Array.prototype.sort);
const NATIVE_CRYPTO_CREATE_HASH = crypto.createHash.bind(crypto);
const NATIVE_DATE_PARSE = Date.parse;
const NATIVE_JSON_STRINGIFY = JSON.stringify;
const NATIVE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS = Object.getOwnPropertyDescriptors;
const NATIVE_OBJECT_GET_OWN_PROPERTY_SYMBOLS = Object.getOwnPropertySymbols;
const NATIVE_OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const NATIVE_OBJECT_KEYS = Object.keys;
const NATIVE_OBJECT_PROTOTYPE = Object.prototype;
const NATIVE_NUMBER_IS_FINITE = Number.isFinite;
const NATIVE_NUMBER_IS_SAFE_INTEGER = Number.isSafeInteger;

function exactSha1(value, context) {
  if (typeof value !== 'string' || !SHA1_PATTERN.test(value)) {
    throw new Error(`${context}: expected an exact 40-character lowercase SHA`);
  }
  return value;
}

function exactSha256(value, context) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    throw new Error(`${context}: expected an exact 64-character lowercase SHA-256`);
  }
  return value;
}

function plainRecord(value, context) {
  if (!value || typeof value !== 'object' || NATIVE_ARRAY_IS_ARRAY(value)) {
    throw new Error(`${context}: expected a plain record`);
  }
  const prototype = NATIVE_OBJECT_GET_PROTOTYPE_OF(value);
  if (prototype !== NATIVE_OBJECT_PROTOTYPE && prototype !== null) {
    throw new Error(`${context}: custom prototypes are forbidden`);
  }
  if (NATIVE_OBJECT_GET_OWN_PROPERTY_SYMBOLS(value).length !== 0) {
    throw new Error(`${context}: symbol keys are forbidden`);
  }
  const descriptors = NATIVE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(value);
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
      throw new Error(`${context}.${key}: accessors are forbidden`);
    }
  }
  return value;
}

function exactKeys(value, expected, context) {
  plainRecord(value, context);
  const actual = NATIVE_ARRAY_SORT(NATIVE_OBJECT_KEYS(value).slice());
  const wanted = NATIVE_ARRAY_SORT(expected.slice());
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(`${context}: exact keys mismatch`);
  }
}

function canonicalJson(value, context = 'evidence', seen = new Set()) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return NATIVE_JSON_STRINGIFY(value);
  if (typeof value === 'number') {
    if (!NATIVE_NUMBER_IS_FINITE(value)) throw new Error(`${context}: non-finite number is forbidden`);
    return NATIVE_JSON_STRINGIFY(value);
  }
  if (typeof value !== 'object') throw new Error(`${context}: non-JSON value is forbidden`);
  if (seen.has(value)) throw new Error(`${context}: cyclic value is forbidden`);
  seen.add(value);
  try {
    if (NATIVE_ARRAY_IS_ARRAY(value)) {
      const descriptors = NATIVE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(value);
      const expectedKeys = Array.from({ length: value.length }, (_, index) => String(index));
      const actualKeys = NATIVE_OBJECT_KEYS(descriptors).filter(key => key !== 'length');
      if (NATIVE_OBJECT_GET_OWN_PROPERTY_SYMBOLS(value).length !== 0
          || actualKeys.length !== expectedKeys.length
          || actualKeys.some((key, index) => key !== expectedKeys[index])) {
        throw new Error(`${context}: sparse, decorated, or symbolic arrays are forbidden`);
      }
      return `[${expectedKeys.map(key => {
        const descriptor = descriptors[key];
        if (!descriptor || !Object.hasOwn(descriptor, 'value') || descriptor.get || descriptor.set) {
          throw new Error(`${context}[${key}]: accessors are forbidden`);
        }
        return canonicalJson(descriptor.value, `${context}[${key}]`, seen);
      }).join(',')}]`;
    }
    plainRecord(value, context);
    const descriptors = NATIVE_OBJECT_GET_OWN_PROPERTY_DESCRIPTORS(value);
    const keys = NATIVE_ARRAY_SORT(NATIVE_OBJECT_KEYS(descriptors));
    return `{${keys.map(key => {
      const descriptor = descriptors[key];
      return `${NATIVE_JSON_STRINGIFY(key)}:${canonicalJson(descriptor.value,
        `${context}.${key}`, seen)}`;
    }).join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

function canonicalSha256(value) {
  return NATIVE_CRYPTO_CREATE_HASH('sha256').update(canonicalJson(value)).digest('hex');
}

function hashWithout(record, key, context) {
  plainRecord(record, context);
  const clone = Object.create(null);
  for (const current of NATIVE_OBJECT_KEYS(record)) {
    if (current !== key) Object.defineProperty(clone, current, {
      configurable: true,
      enumerable: true,
      value: record[current],
      writable: true,
    });
  }
  return canonicalSha256(clone);
}

function exactUtc(value, context) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
      || !NATIVE_NUMBER_IS_FINITE(NATIVE_DATE_PARSE(value))
      || new Date(NATIVE_DATE_PARSE(value)).toISOString() !== value) {
    throw new Error(`${context}: expected exact millisecond UTC`);
  }
  return value;
}

function exactUtcDate(value, context) {
  if (typeof value !== 'string' || !UTC_DATE_PATTERN.test(value)
      || new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) !== value) {
    throw new Error(`${context}: expected an exact UTC calendar date`);
  }
  return value;
}

function nextUtcDate(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function exactDecimalId(value, context) {
  if (typeof value !== 'string' || !DECIMAL_ID_PATTERN.test(value)) {
    throw new Error(`${context}: expected an exact positive decimal-string identity`);
  }
  return value;
}

function exactEnum(value, allowed, context) {
  if (!allowed.includes(value)) throw new Error(`${context}: unsupported value`);
  return value;
}

function expectedRemote(remote, context, keys = [
  'apiBaseUrl', 'apiVersion', 'branch', 'ref', 'repository', 'repositoryId',
]) {
  exactKeys(remote, keys, context);
  if (remote.apiBaseUrl !== 'https://api.github.com' || remote.apiVersion !== API_VERSION
      || typeof remote.repository !== 'string' || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(remote.repository)
      || typeof remote.branch !== 'string' || !remote.branch
      || remote.ref !== `refs/heads/${remote.branch}`) {
    throw new Error(`${context}: remote identity is invalid`);
  }
  exactDecimalId(remote.repositoryId, `${context}.repositoryId`);
  return remote;
}

function assertRemoteIdentity(record, expected, context) {
  for (const key of ['apiBaseUrl', 'apiVersion', 'branch', 'ref', 'repository', 'repositoryId']) {
    if (record[key] !== expected[key]) throw new Error(`${context}: ${key} mismatch`);
  }
}

function validateLegacyBypassActor(actor, context) {
  exactKeys(actor, ['actorId', 'actorName', 'actorType', 'bypassMode', 'surface'], context);
  exactEnum(actor.surface, LEGACY_BYPASS_SURFACES, `${context}.surface`);
  if (typeof actor.actorType !== 'string' || !actor.actorType
      || (actor.actorId !== null && !DECIMAL_ID_PATTERN.test(actor.actorId))
      || typeof actor.actorName !== 'string' || !actor.actorName) {
    throw new Error(`${context}: legacy bypass actor identity is incomplete`);
  }
  exactEnum(actor.bypassMode, RULESET_BYPASS_MODES, `${context}.bypassMode`);
}

function validateRulesetBypassActor(actor, context) {
  exactKeys(actor, ['actorId', 'actorType', 'bypassMode'], context);
  exactEnum(actor.actorType, RULESET_ACTOR_TYPES, `${context}.actorType`);
  exactEnum(actor.bypassMode, RULESET_BYPASS_MODES, `${context}.bypassMode`);
  const nullActor = actor.actorType === 'DeployKey' || actor.actorType === 'OrganizationAdmin';
  if ((nullActor && actor.actorId !== null)
      || (!nullActor && (typeof actor.actorId !== 'string'
        || !DECIMAL_ID_PATTERN.test(actor.actorId)))) {
    throw new Error(`${context}: ruleset bypass actor identity is invalid`);
  }
}

function assertEffectivePolicySnapshot(snapshot, { remote, expectedSnapshotSha256 } = {}) {
  const expected = expectedRemote(remote, 'expected policy remote');
  exactKeys(snapshot, [
    'apiBaseUrl', 'apiVersion', 'branch', 'capturedAtUtc', 'effectiveBranchRuleEnumeration',
    'legacyBranchProtection', 'ref', 'repository', 'repositoryId', 'rulesetEnumeration',
    'rulesets', 'schema', 'snapshotSha256',
  ], 'effective GitHub policy snapshot');
  if (snapshot.schema !== POLICY_SCHEMA) throw new Error('effective GitHub policy schema mismatch');
  assertRemoteIdentity(snapshot, expected, 'effective GitHub policy snapshot');
  exactUtc(snapshot.capturedAtUtc, 'effective GitHub policy capturedAtUtc');

  const legacy = snapshot.legacyBranchProtection;
  exactKeys(legacy, [
    'allowDeletions', 'allowForcePushes', 'apiRequestUrl', 'apiResponseUrl', 'bypassActors',
    'enforceAdmins', 'present', 'responseBodySha256', 'schema',
  ], 'legacy branch protection projection');
  const legacyUrl = `${expected.apiBaseUrl}/repos/${expected.repository}/branches/`
    + `${encodeURIComponent(expected.branch)}/protection`;
  if (legacy.schema !== 'fg-control-residual-pls1-legacy-branch-protection-v1'
      || legacy.apiRequestUrl !== legacyUrl || legacy.apiResponseUrl !== legacyUrl
      || legacy.present !== true || legacy.enforceAdmins !== true
      || legacy.allowForcePushes !== false || legacy.allowDeletions !== false
      || !NATIVE_ARRAY_IS_ARRAY(legacy.bypassActors)) {
    throw new Error('legacy branch protection is absent, weakened, or redirected');
  }
  exactSha256(legacy.responseBodySha256, 'legacy branch protection response body');
  legacy.bypassActors.forEach((actor, index) => validateLegacyBypassActor(actor,
    `legacy branch protection bypass actor ${index}`));
  if (legacy.bypassActors.length !== 0) {
    throw new Error('legacy branch protection has a bypass actor; immutable-history coverage is unproved');
  }

  const enumeration = snapshot.rulesetEnumeration;
  exactKeys(enumeration, ['complete', 'includesParents', 'pages', 'perPage', 'schema', 'targets'],
    'ruleset enumeration');
  if (enumeration.schema !== 'fg-control-residual-pls1-ruleset-enumeration-v1'
      || enumeration.complete !== true || enumeration.includesParents !== true
      || enumeration.targets !== 'branch' || enumeration.perPage !== 100
      || !NATIVE_ARRAY_IS_ARRAY(enumeration.pages) || enumeration.pages.length < 1) {
    throw new Error('repository/parent ruleset enumeration is incomplete');
  }
  const listedRulesetIds = [];
  enumeration.pages.forEach((page, index) => {
    const pageNumber = index + 1;
    exactKeys(page, ['apiRequestUrl', 'apiResponseUrl', 'nextPageUrl', 'page',
      'responseBodySha256', 'rulesetIds', 'schema'], `ruleset enumeration page ${pageNumber}`);
    const url = `${expected.apiBaseUrl}/repos/${expected.repository}/rulesets?includes_parents=true`
      + `&targets=branch&per_page=100&page=${pageNumber}`;
    const nextUrl = index + 1 < enumeration.pages.length
      ? `${expected.apiBaseUrl}/repos/${expected.repository}/rulesets?includes_parents=true`
        + `&targets=branch&per_page=100&page=${pageNumber + 1}` : null;
    if (page.schema !== 'fg-control-residual-pls1-ruleset-enumeration-page-v1'
        || page.page !== pageNumber || page.apiRequestUrl !== url || page.apiResponseUrl !== url
        || page.nextPageUrl !== nextUrl || !NATIVE_ARRAY_IS_ARRAY(page.rulesetIds)
        || page.rulesetIds.length > 100
        || (nextUrl !== null && page.rulesetIds.length !== 100)) {
      throw new Error(`ruleset enumeration page ${pageNumber}: pagination is incomplete or redirected`);
    }
    exactSha256(page.responseBodySha256, `ruleset enumeration page ${pageNumber} body`);
    page.rulesetIds.forEach((id, itemIndex) => {
      exactDecimalId(id, `ruleset enumeration page ${pageNumber} item ${itemIndex}`);
      listedRulesetIds.push(id);
    });
  });
  if (new Set(listedRulesetIds).size !== listedRulesetIds.length) {
    throw new Error('ruleset enumeration contains duplicate identities');
  }

  if (!NATIVE_ARRAY_IS_ARRAY(snapshot.rulesets)) throw new Error('ruleset details must be an array');
  const detailsById = new Map();
  snapshot.rulesets.forEach((ruleset, index) => {
    const context = `ruleset detail ${index}`;
    exactKeys(ruleset, [
      'apiRequestUrl', 'apiResponseUrl', 'bypassActors', 'bypassActorsPropertyPresent',
      'conditionsSha256', 'enforcement', 'id', 'name', 'responseBodySha256', 'rulesSha256',
      'schema', 'source', 'sourceType', 'target',
    ], context);
    exactDecimalId(ruleset.id, `${context}.id`);
    const url = `${expected.apiBaseUrl}/repos/${expected.repository}/rulesets/${ruleset.id}`
      + '?includes_parents=true';
    if (ruleset.schema !== 'fg-control-residual-pls1-ruleset-detail-v1'
        || typeof ruleset.name !== 'string' || !ruleset.name
        || ruleset.target !== 'branch' || ruleset.apiRequestUrl !== url
        || ruleset.apiResponseUrl !== url || ruleset.bypassActorsPropertyPresent !== true
        || !NATIVE_ARRAY_IS_ARRAY(ruleset.bypassActors)) {
      throw new Error(`${context}: identity, target, endpoint, or bypass visibility is invalid`);
    }
    exactEnum(ruleset.sourceType, RULESET_SOURCE_TYPES, `${context}.sourceType`);
    if (typeof ruleset.source !== 'string' || !ruleset.source) {
      throw new Error(`${context}: source identity is absent`);
    }
    exactEnum(ruleset.enforcement, RULESET_ENFORCEMENT, `${context}.enforcement`);
    for (const field of ['responseBodySha256', 'conditionsSha256', 'rulesSha256']) {
      exactSha256(ruleset[field], `${context}.${field}`);
    }
    ruleset.bypassActors.forEach((actor, actorIndex) => validateRulesetBypassActor(actor,
      `${context}.bypassActors[${actorIndex}]`));
    if (detailsById.has(ruleset.id)) throw new Error(`${context}: duplicate ruleset identity`);
    detailsById.set(ruleset.id, ruleset);
  });
  if (detailsById.size !== listedRulesetIds.length
      || listedRulesetIds.some(id => !detailsById.has(id))) {
    throw new Error('ruleset enumeration and complete detail inventory differ');
  }

  const branchRules = snapshot.effectiveBranchRuleEnumeration;
  exactKeys(branchRules, ['complete', 'pages', 'perPage', 'schema'],
    'effective branch rule enumeration');
  if (branchRules.schema !== 'fg-control-residual-pls1-effective-branch-rule-enumeration-v1'
      || branchRules.complete !== true || branchRules.perPage !== 100
      || !NATIVE_ARRAY_IS_ARRAY(branchRules.pages) || branchRules.pages.length < 1) {
    throw new Error('effective branch rule enumeration is incomplete');
  }
  const effectiveRules = [];
  branchRules.pages.forEach((page, index) => {
    const pageNumber = index + 1;
    exactKeys(page, ['apiRequestUrl', 'apiResponseUrl', 'nextPageUrl', 'page', 'responseBodySha256',
      'rules', 'schema'], `effective branch rule page ${pageNumber}`);
    const url = `${expected.apiBaseUrl}/repos/${expected.repository}/rules/branches/`
      + `${encodeURIComponent(expected.branch)}?per_page=100&page=${pageNumber}`;
    const nextUrl = index + 1 < branchRules.pages.length
      ? `${expected.apiBaseUrl}/repos/${expected.repository}/rules/branches/`
        + `${encodeURIComponent(expected.branch)}?per_page=100&page=${pageNumber + 1}` : null;
    if (page.schema !== 'fg-control-residual-pls1-effective-branch-rule-page-v1'
        || page.page !== pageNumber || page.apiRequestUrl !== url || page.apiResponseUrl !== url
        || page.nextPageUrl !== nextUrl || !NATIVE_ARRAY_IS_ARRAY(page.rules)
        || page.rules.length > 100 || (nextUrl !== null && page.rules.length !== 100)) {
      throw new Error(`effective branch rule page ${pageNumber}: pagination is incomplete or redirected`);
    }
    exactSha256(page.responseBodySha256, `effective branch rule page ${pageNumber} body`);
    page.rules.forEach((rule, ruleIndex) => {
      const context = `effective branch rule page ${pageNumber} item ${ruleIndex}`;
      exactKeys(rule, ['parametersSha256', 'rulesetId', 'rulesetSource', 'rulesetSourceType',
        'schema', 'type'], context);
      exactDecimalId(rule.rulesetId, `${context}.rulesetId`);
      exactEnum(rule.rulesetSourceType, RULESET_SOURCE_TYPES, `${context}.rulesetSourceType`);
      if (rule.schema !== 'fg-control-residual-pls1-effective-branch-rule-v1'
          || typeof rule.rulesetSource !== 'string' || !rule.rulesetSource
          || typeof rule.type !== 'string' || !rule.type) {
        throw new Error(`${context}: rule identity is incomplete`);
      }
      exactSha256(rule.parametersSha256, `${context}.parametersSha256`);
      const detail = detailsById.get(rule.rulesetId);
      if (!detail || detail.sourceType !== rule.rulesetSourceType
          || detail.source !== rule.rulesetSource || detail.enforcement !== 'active') {
        throw new Error(`${context}: active ruleset detail/source is absent`);
      }
      effectiveRules.push(rule);
    });
  });
  if (effectiveRules.length === 0) {
    throw new Error('legacy branch protection alone is insufficient; no effective ruleset was proved');
  }
  const effectiveRuleIdentities = effectiveRules.map(rule => canonicalSha256(rule));
  if (new Set(effectiveRuleIdentities).size !== effectiveRuleIdentities.length) {
    throw new Error('effective branch rule enumeration contains duplicate projections');
  }
  const effectiveRulesetIds = new Set(effectiveRules.map(rule => rule.rulesetId));
  for (const id of effectiveRulesetIds) {
    if (detailsById.get(id).bypassActors.length !== 0) {
      throw new Error(`effective ruleset ${id} has bypass actors; immutable-history coverage is unproved`);
    }
  }

  exactSha256(snapshot.snapshotSha256, 'effective GitHub policy snapshotSha256');
  const actualSnapshotSha256 = hashWithout(snapshot, 'snapshotSha256',
    'effective GitHub policy snapshot');
  if (snapshot.snapshotSha256 !== actualSnapshotSha256) {
    throw new Error('effective GitHub policy snapshot hash mismatch');
  }
  if (expectedSnapshotSha256 !== undefined) {
    exactSha256(expectedSnapshotSha256, 'expected effective GitHub policy snapshotSha256');
    if (expectedSnapshotSha256 !== actualSnapshotSha256) {
      throw new Error('effective GitHub policy differs from the frozen manifest snapshot');
    }
  }
  return Object.freeze({
    effectiveRuleCount: effectiveRules.length,
    effectiveRulesetCount: effectiveRulesetIds.size,
    legacyBypassActorCount: legacy.bypassActors.length,
    rulesetCount: detailsById.size,
    snapshotSha256: actualSnapshotSha256,
  });
}

function workflowExpected(expected, context) {
  expectedRemote(expected, context, [
    'apiBaseUrl', 'apiVersion', 'branch', 'ref', 'repository', 'repositoryId', 'workflowId',
    'workflowPath', 'workflowRef',
  ]);
  exactDecimalId(expected.workflowId, `${context}.workflowId`);
  if (typeof expected.workflowPath !== 'string' || !/^\.github\/workflows\/[A-Za-z0-9_.-]+\.ya?ml$/.test(expected.workflowPath)
      || expected.workflowRef !== `${expected.repository}/${expected.workflowPath}@refs/heads/${expected.branch}`) {
    throw new Error(`${context}: workflow identity is invalid`);
  }
  return expected;
}

function runListUrl(expected, date, page) {
  return `${expected.apiBaseUrl}/repos/${expected.repository}/actions/workflows/`
    + `${expected.workflowId}/runs?branch=${encodeURIComponent(expected.branch)}`
    + `&created=${date}&per_page=100&page=${page}`;
}

function attemptUrl(expected, runId, runAttempt) {
  return `${expected.apiBaseUrl}/repos/${expected.repository}/actions/runs/`
    + `${runId}/attempts/${runAttempt}`;
}

function assertCompleteRunAttemptReconciliation(inventory, terminalArtifacts,
  { remote, expectedInventorySha256 } = {}) {
  const expected = workflowExpected(remote, 'expected workflow remote');
  exactKeys(inventory, [
    'activationDateUtc', 'apiBaseUrl', 'apiVersion', 'branch', 'inventorySha256',
    'observedDateUtc', 'queryDays', 'ref', 'repository', 'repositoryId', 'runs', 'schema',
    'workflowId', 'workflowPath', 'workflowRef',
  ], 'workflow run inventory');
  if (inventory.schema !== RUN_INVENTORY_SCHEMA) throw new Error('workflow run inventory schema mismatch');
  for (const key of ['apiBaseUrl', 'apiVersion', 'branch', 'ref', 'repository', 'repositoryId',
    'workflowId', 'workflowPath', 'workflowRef']) {
    if (inventory[key] !== expected[key]) throw new Error(`workflow run inventory: ${key} mismatch`);
  }
  exactUtcDate(inventory.activationDateUtc, 'workflow inventory activationDateUtc');
  exactUtcDate(inventory.observedDateUtc, 'workflow inventory observedDateUtc');
  if (inventory.observedDateUtc < inventory.activationDateUtc) {
    throw new Error('workflow inventory observation predates activation');
  }
  if (!NATIVE_ARRAY_IS_ARRAY(inventory.queryDays) || inventory.queryDays.length < 1) {
    throw new Error('workflow inventory has no daily query coverage');
  }

  const listedRuns = new Map();
  let expectedDate = inventory.activationDateUtc;
  inventory.queryDays.forEach((day, dayIndex) => {
    const context = `workflow inventory query day ${dayIndex}`;
    exactKeys(day, ['complete', 'createdDateUtc', 'pages', 'schema', 'totalCount'], context);
    exactUtcDate(day.createdDateUtc, `${context}.createdDateUtc`);
    if (day.schema !== 'fg-control-residual-pls1-workflow-run-query-day-v1'
        || day.createdDateUtc !== expectedDate || day.complete !== true
        || !NATIVE_NUMBER_IS_SAFE_INTEGER(day.totalCount) || day.totalCount < 0
        || day.totalCount >= 1000 || !NATIVE_ARRAY_IS_ARRAY(day.pages)
        || day.pages.length !== Math.max(1, Math.ceil(day.totalCount / 100))) {
      throw new Error(`${context}: search-limit, continuity, or pagination coverage is incomplete`);
    }
    let itemCount = 0;
    day.pages.forEach((page, pageIndex) => {
      const pageNumber = pageIndex + 1;
      const pageContext = `${context} page ${pageNumber}`;
      exactKeys(page, ['apiRequestUrl', 'apiResponseUrl', 'nextPageUrl', 'page', 'responseBodySha256',
        'runs', 'schema'], pageContext);
      const url = runListUrl(expected, day.createdDateUtc, pageNumber);
      const nextUrl = pageIndex + 1 < day.pages.length
        ? runListUrl(expected, day.createdDateUtc, pageNumber + 1) : null;
      if (page.schema !== 'fg-control-residual-pls1-workflow-run-query-page-v1'
          || page.page !== pageNumber || page.apiRequestUrl !== url || page.apiResponseUrl !== url
          || page.nextPageUrl !== nextUrl || !NATIVE_ARRAY_IS_ARRAY(page.runs)
          || page.runs.length > 100 || (nextUrl !== null && page.runs.length !== 100)) {
        throw new Error(`${pageContext}: pagination is incomplete or redirected`);
      }
      exactSha256(page.responseBodySha256, `${pageContext}.responseBodySha256`);
      itemCount += page.runs.length;
      page.runs.forEach((summary, summaryIndex) => {
        const summaryContext = `${pageContext} run ${summaryIndex}`;
        exactKeys(summary, ['latestRunAttempt', 'runId', 'schema'], summaryContext);
        exactDecimalId(summary.runId, `${summaryContext}.runId`);
        if (summary.schema !== 'fg-control-residual-pls1-workflow-run-summary-v1'
            || !NATIVE_NUMBER_IS_SAFE_INTEGER(summary.latestRunAttempt)
            || summary.latestRunAttempt < 1) {
          throw new Error(`${summaryContext}: run-attempt summary is invalid`);
        }
        if (listedRuns.has(summary.runId)) {
          throw new Error(`${summaryContext}: duplicate workflow run identity`);
        }
        listedRuns.set(summary.runId, { ...summary, createdDateUtc: day.createdDateUtc });
      });
    });
    if (itemCount !== day.totalCount) throw new Error(`${context}: total_count does not match pages`);
    expectedDate = nextUtcDate(expectedDate);
  });
  if (inventory.queryDays.at(-1).createdDateUtc !== inventory.observedDateUtc) {
    throw new Error('workflow inventory omits one or more UTC query dates');
  }

  if (!NATIVE_ARRAY_IS_ARRAY(inventory.runs)) throw new Error('workflow run details must be an array');
  const attemptsByIdentity = new Map();
  const runIds = new Set();
  inventory.runs.forEach((run, runIndex) => {
    const context = `workflow run ${runIndex}`;
    exactKeys(run, [
      'attempts', 'createdAtUtc', 'eventName', 'headBranch', 'headSha', 'latestRunAttempt',
      'ref', 'repositoryId', 'runId', 'schema', 'workflowId', 'workflowPath', 'workflowRef',
      'workflowSha',
    ], context);
    exactDecimalId(run.runId, `${context}.runId`);
    const summary = listedRuns.get(run.runId);
    if (!summary || summary.latestRunAttempt !== run.latestRunAttempt || runIds.has(run.runId)) {
      throw new Error(`${context}: list/detail run identity mismatch or duplicate`);
    }
    runIds.add(run.runId);
    exactUtc(run.createdAtUtc, `${context}.createdAtUtc`);
    if (run.createdAtUtc.slice(0, 10) !== summary.createdDateUtc
        || !['schedule', 'workflow_dispatch'].includes(run.eventName)
        || run.repositoryId !== expected.repositoryId || run.workflowId !== expected.workflowId
        || run.workflowPath !== expected.workflowPath || run.workflowRef !== expected.workflowRef
        || run.headBranch !== expected.branch || run.ref !== expected.ref
        || !SHA1_PATTERN.test(run.headSha) || !SHA1_PATTERN.test(run.workflowSha)
        || run.headSha !== run.workflowSha || !NATIVE_ARRAY_IS_ARRAY(run.attempts)
        || run.attempts.length !== run.latestRunAttempt) {
      throw new Error(`${context}: immutable workflow/run identity is invalid`);
    }
    run.attempts.forEach((attempt, attemptIndex) => {
      const attemptNumber = attemptIndex + 1;
      const attemptContext = `${context} attempt ${attemptNumber}`;
      exactKeys(attempt, [
        'apiRequestUrl', 'apiResponseUrl', 'attemptProjectionSha256', 'conclusion', 'createdAtUtc',
        'eventName', 'headBranch', 'headSha', 'ref', 'repositoryId', 'responseBodySha256',
        'runAttempt', 'runId', 'runStartedAtUtc', 'schema', 'status', 'updatedAtUtc',
        'workflowId', 'workflowPath', 'workflowRef', 'workflowSha',
      ], attemptContext);
      if (attempt.schema !== 'fg-control-residual-pls1-terminal-workflow-run-attempt-v1'
          || attempt.runId !== run.runId || attempt.runAttempt !== attemptNumber
          || attempt.status !== 'completed' || !TERMINAL_CONCLUSIONS.includes(attempt.conclusion)
          || attempt.eventName !== run.eventName || attempt.repositoryId !== run.repositoryId
          || attempt.workflowId !== run.workflowId || attempt.workflowPath !== run.workflowPath
          || attempt.workflowRef !== run.workflowRef || attempt.headBranch !== run.headBranch
          || attempt.headSha !== run.headSha || attempt.workflowSha !== run.workflowSha
          || attempt.ref !== run.ref) {
        throw new Error(`${attemptContext}: terminal status or immutable identity mismatch`);
      }
      exactUtc(attempt.createdAtUtc, `${attemptContext}.createdAtUtc`);
      exactUtc(attempt.runStartedAtUtc, `${attemptContext}.runStartedAtUtc`);
      exactUtc(attempt.updatedAtUtc, `${attemptContext}.updatedAtUtc`);
      if (attempt.createdAtUtc !== run.createdAtUtc
          || attempt.createdAtUtc > attempt.runStartedAtUtc
          || attempt.runStartedAtUtc > attempt.updatedAtUtc) {
        throw new Error(`${attemptContext}: terminal chronology mismatch`);
      }
      const url = attemptUrl(expected, run.runId, attemptNumber);
      if (attempt.apiRequestUrl !== url || attempt.apiResponseUrl !== url) {
        throw new Error(`${attemptContext}: attempt-specific API endpoint mismatch`);
      }
      exactSha256(attempt.responseBodySha256, `${attemptContext}.responseBodySha256`);
      exactSha256(attempt.attemptProjectionSha256, `${attemptContext}.attemptProjectionSha256`);
      const projectionHash = hashWithout(attempt, 'attemptProjectionSha256', attemptContext);
      if (attempt.attemptProjectionSha256 !== projectionHash) {
        throw new Error(`${attemptContext}: immutable projection hash mismatch`);
      }
      attemptsByIdentity.set(`${run.runId}:${attemptNumber}`, attempt);
    });
  });
  if (runIds.size !== listedRuns.size || [...listedRuns.keys()].some(id => !runIds.has(id))) {
    throw new Error('workflow run list and complete attempt details differ');
  }

  if (!NATIVE_ARRAY_IS_ARRAY(terminalArtifacts)) {
    throw new Error('terminal artifact reconciliation index must be an array');
  }
  const artifactsByIdentity = new Map();
  terminalArtifacts.forEach((artifact, index) => {
    const context = `terminal artifact ${index}`;
    exactKeys(artifact, [
      'artifactKind', 'artifactPath', 'artifactSha256', 'attemptProjectionSha256',
      'recordedConclusion', 'runAttempt', 'runId', 'schema',
    ], context);
    exactDecimalId(artifact.runId, `${context}.runId`);
    if (artifact.schema !== 'fg-control-residual-pls1-terminal-artifact-index-v1'
        || !NATIVE_NUMBER_IS_SAFE_INTEGER(artifact.runAttempt) || artifact.runAttempt < 1
        || !['ATTEMPT', 'DECISION'].includes(artifact.artifactKind)
        || typeof artifact.artifactPath !== 'string'
        || !/^research\/lockbox\/control-residual-pls1-v1\/(attempts|decisions)\/.+\.json$/.test(artifact.artifactPath)
        || artifact.artifactPath.includes('..') || artifact.artifactPath.includes('\\')) {
      throw new Error(`${context}: terminal artifact identity/path is invalid`);
    }
    exactSha256(artifact.artifactSha256, `${context}.artifactSha256`);
    exactSha256(artifact.attemptProjectionSha256, `${context}.attemptProjectionSha256`);
    const identity = `${artifact.runId}:${artifact.runAttempt}`;
    const attempt = attemptsByIdentity.get(identity);
    if (!attempt || artifactsByIdentity.has(identity)) {
      throw new Error(`${context}: unknown or duplicate terminal run-attempt identity`);
    }
    if (artifact.attemptProjectionSha256 !== attempt.attemptProjectionSha256
        || artifact.recordedConclusion !== attempt.conclusion
        || (attempt.conclusion !== 'success' && artifact.artifactKind !== 'ATTEMPT')) {
      throw new Error(`${context}: terminal artifact does not bind the immutable attempt conclusion`);
    }
    artifactsByIdentity.set(identity, artifact);
  });
  for (const identity of attemptsByIdentity.keys()) {
    if (!artifactsByIdentity.has(identity)) {
      throw new Error(`missing terminal artifact for workflow run attempt ${identity}`);
    }
  }
  exactSha256(inventory.inventorySha256, 'workflow run inventorySha256');
  const inventorySha256 = hashWithout(inventory, 'inventorySha256', 'workflow run inventory');
  if (inventory.inventorySha256 !== inventorySha256) {
    throw new Error('workflow run inventory hash mismatch');
  }
  if (expectedInventorySha256 !== undefined) {
    exactSha256(expectedInventorySha256, 'expected workflow run inventorySha256');
    if (expectedInventorySha256 !== inventorySha256) {
      throw new Error('workflow run inventory differs from the frozen reconciliation snapshot');
    }
  }
  return Object.freeze({
    inventorySha256,
    queryDayCount: inventory.queryDays.length,
    terminalArtifactCount: artifactsByIdentity.size,
    workflowRunAttemptCount: attemptsByIdentity.size,
    workflowRunCount: runIds.size,
  });
}

function canonicalFilesystemPath(value) {
  const resolved = fs.realpathSync(path.resolve(value));
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function gitBytes(repoRoot, args, context) {
  try {
    return childProcess.execFileSync('git', args, {
      cwd: repoRoot,
      encoding: null,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(`${context}: Git command failed`);
  }
}

function gitText(repoRoot, args, context) {
  return gitBytes(repoRoot, args, context).toString('utf8').trim();
}

function resolveExactCommit(repoRoot, commitSha, context) {
  exactSha1(commitSha, context);
  const resolved = gitText(repoRoot, ['rev-parse', '--verify', `${commitSha}^{commit}`], context);
  if (!SHA1_PATTERN.test(resolved) || resolved !== commitSha) {
    throw new Error(`${context}: does not resolve to that exact commit`);
  }
  return resolved;
}

function assertAncestor(repoRoot, ancestor, descendant, context) {
  try {
    childProcess.execFileSync('git', ['merge-base', '--is-ancestor', ancestor, descendant], {
      cwd: repoRoot,
      encoding: null,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(`${context}: required Git ancestry is absent`);
  }
}

function resolveManifestLocation(repoRoot, manifestPath) {
  if (typeof repoRoot !== 'string' || !repoRoot) throw new Error('repoRoot is required');
  if (typeof manifestPath !== 'string' || !manifestPath) throw new Error('manifestPath is required');

  const root = canonicalFilesystemPath(repoRoot);
  const manifestCandidate = path.isAbsolute(manifestPath)
    ? manifestPath
    : path.join(root, manifestPath);
  const manifest = canonicalFilesystemPath(manifestCandidate);
  const relativeNative = path.relative(root, manifest);
  if (!relativeNative || path.isAbsolute(relativeNative)
      || relativeNative === '..' || relativeNative.startsWith(`..${path.sep}`)) {
    throw new Error('manifestPath must identify a file inside repoRoot');
  }
  if (!fs.statSync(manifest).isFile()) throw new Error('manifestPath must identify a regular file');

  const reportedTopLevel = gitText(root, ['rev-parse', '--show-toplevel'], 'repoRoot');
  if (canonicalFilesystemPath(reportedTopLevel) !== root) {
    throw new Error('repoRoot must be the exact Git worktree root');
  }
  return {
    repoRoot: root,
    manifestPath: manifest,
    manifestRelativePath: relativeNative.split(path.sep).join('/'),
  };
}

function parseManifest(bytes) {
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('current manifest bytes are not valid JSON');
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error('current manifest must be a JSON object');
  }
  return manifest;
}

function assertGitObjectBinding({ repoRoot, manifestPath, manifestCommitSha } = {}) {
  exactSha1(manifestCommitSha, 'manifestCommitSha');
  const location = resolveManifestLocation(repoRoot, manifestPath);
  const currentManifestBytes = fs.readFileSync(location.manifestPath);
  const manifest = parseManifest(currentManifestBytes);
  const sourceCommitSha = exactSha1(manifest.sourceCommitSha, 'manifest.sourceCommitSha');
  const sourceTreeSha = exactSha1(manifest.sourceTreeSha, 'manifest.sourceTreeSha');

  resolveExactCommit(location.repoRoot, sourceCommitSha, 'manifest.sourceCommitSha');
  resolveExactCommit(location.repoRoot, manifestCommitSha, 'manifestCommitSha');

  const actualSourceTreeSha = gitText(location.repoRoot,
    ['rev-parse', '--verify', `${sourceCommitSha}^{tree}`], 'manifest.sourceCommitSha tree');
  if (!SHA1_PATTERN.test(actualSourceTreeSha) || actualSourceTreeSha !== sourceTreeSha) {
    throw new Error('manifest source tree mismatch');
  }

  assertAncestor(location.repoRoot, sourceCommitSha, manifestCommitSha,
    'source commit to frozen manifest commit');

  const committedManifestBytes = gitBytes(location.repoRoot,
    ['cat-file', 'blob', `${manifestCommitSha}:${location.manifestRelativePath}`],
    'frozen manifest blob');
  if (!committedManifestBytes.equals(currentManifestBytes)) {
    throw new Error('current manifest bytes differ from frozen manifest commit');
  }

  const headCommitSha = gitText(location.repoRoot,
    ['rev-parse', '--verify', 'HEAD^{commit}'], 'checked-out HEAD');
  exactSha1(headCommitSha, 'checked-out HEAD');
  assertAncestor(location.repoRoot, manifestCommitSha, headCommitSha,
    'frozen manifest commit to checked-out HEAD');

  return Object.freeze({
    sourceCommitSha,
    sourceTreeSha,
    manifestCommitSha,
    headCommitSha,
    manifestRelativePath: location.manifestRelativePath,
  });
}

module.exports = Object.freeze({
  API_VERSION,
  POLICY_SCHEMA,
  RUN_INVENTORY_SCHEMA,
  SHA1_PATTERN,
  SHA256_PATTERN,
  assertCompleteRunAttemptReconciliation,
  assertEffectivePolicySnapshot,
  assertGitObjectBinding,
  canonicalSha256,
});
