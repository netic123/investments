'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const proxy = require('../research/universal_volatility_overlay_proxy_v2');
const core = require('../research/universal_volatility_overlay');
const splitter = require('../research/universal_volatility_overlay_proxy_splitter');

const MARKET_IDENTITIES = Object.freeze({
  sweden: { market: 'Sweden', name: 'Synthetic EWD fixture', identityCaveat: 'Synthetic fixture only', benchmark: 'Synthetic Sweden benchmark', inception: '1996-03-12', url: 'https://example.invalid/ewd' },
  usa: { market: 'Usa', name: 'Synthetic IYY fixture', identityCaveat: 'Synthetic fixture only', benchmark: 'Synthetic USA benchmark', inception: '2000-06-12', url: 'https://example.invalid/iyy' },
  europe: { market: 'Europe', name: 'Synthetic IEV fixture', identityCaveat: 'Synthetic fixture only', benchmark: 'Synthetic Europe benchmark', inception: '2000-07-25', url: 'https://example.invalid/iev' },
  global: { market: 'Global', name: 'Synthetic ACWI fixture', identityCaveat: 'Synthetic fixture only', benchmark: 'Synthetic global benchmark', inception: '2008-03-26', url: 'https://example.invalid/acwi' },
});

function syntheticDates() {
  const dates = [];
  for (let year = 2017, month = 10; year < 2019; month++) {
    if (month === 13) { year++; month = 1; }
    for (let day = 1; day <= 16; day++) dates.push(`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`);
  }
  dates.push('2018-12-31');
  return dates;
}

function parentHistory(rows) {
  const stage = splitter.rowsReceipt(rows);
  return {
    firstDate: stage.firstDate,
    lastDate: stage.lastDate,
    rowCount: stage.rowCount,
    normalizedRowsSha256: stage.rowsSha256,
  };
}

function syntheticMarketSeries(key, rows) {
  const expected = proxy.FULL_SERIES[key];
  const identity = MARKET_IDENTITIES[key];
  return {
    key,
    market: identity.market,
    primary: true,
    robustnessOnly: false,
    ticker: expected.ticker,
    name: identity.name,
    currency: 'USD',
    returnType: 'USD_ETF_ADJUSTED_CLOSE_TOTAL_RETURN_PROXY',
    executable: true,
    executableMeaning: 'True means the underlying listed ETF is tradeable; adjusted-close values are retrospective wealth levels, not executable fill prices.',
    seriesLevelExecutable: false,
    underlyingInstrumentExecutable: true,
    priceField: 'Yahoo adjusted close',
    methodology: 'Current-vintage Yahoo adjusted close, adjusted for applicable splits and dividend distributions; USD ETF market-price total-return proxy after fund expenses but before investor trading costs and taxes.',
    pointInTimeStatus: 'Actual live fund history with evolving benchmark membership; Yahoo corporate-action history is current-vintage and can be revised.',
    identityCaveat: identity.identityCaveat,
    officialIdentity: {
      benchmark: identity.benchmark,
      inception: identity.inception,
      url: identity.url,
      checkedAt: '2026-08-25',
    },
    source: {
      provider: 'Yahoo Finance chart endpoint',
      sourceUrl: `https://example.invalid/${expected.ticker}`,
      adjustedCloseDefinitionUrl: 'https://help.yahoo.com/kb/SLN28256.html',
      retrievedAt: '2026-08-25T12:00:00.000Z',
      rawPayloadSha256: expected.rawPayloadSha256,
      sourceArtifactPath: proxy.SOURCE_ARTIFACTS[1].path,
      sourceArtifactSha256: proxy.SOURCE_ARTIFACTS[1].sha256,
      sourceArtifactSchema: 'equity-rotation-panel-input-v1',
      sourceArtifactStatus: 'RETROSPECTIVE_DEVELOPMENT_PROXY_ONLY',
      yahooMeta: {
        symbol: expected.ticker,
        currency: 'USD',
        exchangeName: 'SYNTHETIC',
        instrumentType: 'ETF',
        exchangeTimezoneName: 'UTC',
        dataGranularity: '1d',
      },
    },
    history: parentHistory(rows),
    rows,
  };
}

function syntheticCashSeries(rows) {
  return {
    key: 'cash',
    market: 'USD cash proxy',
    primary: true,
    robustnessOnly: false,
    ticker: 'DTB3-91D-ACCRUAL-V2',
    name: 'Synthetic reconstructed cash fixture',
    currency: 'USD',
    returnType: 'RECONSTRUCTED_91_DAY_TBILL_ACCRUAL_PROXY',
    executable: false,
    executableMeaning: 'False: this is a mathematical wealth reconstruction from a quoted yield, not a listed fund or observed total-return index.',
    seriesLevelExecutable: false,
    underlyingInstrumentExecutable: false,
    priceField: 'Derived wealth level',
    methodology: 'Synthetic fixture retaining the frozen strictly-prior observation convention.',
    pointInTimeStatus: 'Official historical FRED yields in a current-vintage 2026-08-25 download; this synthetic reconstructed path is not an executable or official total-return index.',
    source: {
      provider: 'Federal Reserve Bank of St. Louis (FRED)',
      sourceUrl: 'https://example.invalid/fred',
      officialSeriesUrl: 'https://fred.stlouisfed.org/series/DTB3',
      treasuryPricingConventionUrl: 'https://www.treasurydirect.gov/marketable-securities/understanding-pricing/',
      retrievedAt: '2026-08-25T12:00:00.000Z',
      requestedStartDate: '1995-01-01',
      requestedEndDate: '2026-08-24',
      rawPayloadSha256: proxy.FULL_SERIES.cash.rawPayloadSha256,
      rawResponseBytes: 123,
      rawArtifactPath: proxy.SOURCE_ARTIFACTS[3].path,
      rawArtifactSidecarPath: `${proxy.SOURCE_ARTIFACTS[3].path}.sha256`,
      sourceArtifactPath: proxy.SOURCE_ARTIFACTS[4].path,
      sourceArtifactSha256: proxy.SOURCE_ARTIFACTS[4].sha256,
      sourceArtifactSchema: 'fred-dtb3-raw-source-v1',
      sourceArtifactSidecarPath: `${proxy.SOURCE_ARTIFACTS[4].path}.sha256`,
      observedYieldUnits: 'percent_bank_discount_basis',
      informationLagRule: 'STRICTLY_PRIOR_OBSERVATION_DATE_FOR_EACH_ACCRUAL_START_DATE',
      maximumObservationStalenessCalendarDays: 7,
      observedYieldHistory: {
        firstDate: '1995-01-03',
        lastDate: '2026-08-21',
        rowCount: 7916,
        normalizedRowsSha256: 'd6f4e4e41088d8e1b442c8ddfa63ba69118adacdee2070a9b780bb62e490b3fb',
      },
      observedYieldRows: [{ date: '2017-09-29', value: 1 }],
    },
    history: parentHistory(rows),
    rows,
  };
}

function sourceReceipts() {
  return proxy.SOURCE_ARTIFACTS.map((item, index) => ({
    role: item.role,
    path: item.path,
    sha256: item.sha256,
    bytes: 100 + index,
    ...(item.hasSidecar ? { sidecarPath: `${item.path}.sha256`, sidecarSha256: item.sidecarSha256 } : {}),
  }));
}

function syntheticDevelopmentInput({ marketMultiplier = 1 } = {}) {
  const dates = syntheticDates();
  const cashRows = dates.map(date => ({ date, value: 100 }));
  const markets = proxy.MARKET_ORDER.map((key, marketIndex) => {
    const rows = dates.map(date => ({ date, value: 100 * marketMultiplier * (marketIndex + 1) }));
    return splitter.buildDevelopmentMarket(syntheticMarketSeries(key, rows), cashRows);
  });
  const cash = splitter.buildDevelopmentCash(syntheticCashSeries(cashRows), markets);
  return {
    schema: proxy.INPUT_SCHEMA,
    status: proxy.INPUT_STATUS,
    stage: 'development',
    containsStrategyOutcomes: false,
    purpose: 'Synthetic data-only fixture; never a market result.',
    deterministicBuild: {
      currentClockUsed: false,
      networkAccess: false,
      commandAcceptsStageSelection: false,
      reusedCalendarRoleImplementation: 'research/universal_volatility_overlay_proxy_splitter.js',
      serialization: 'recursively lexicographically sorted object keys; arrays preserved; LF newline',
    },
    protocols: {
      normative: { path: 'research/UNIVERSAL_VOLATILITY_OVERLAY_PROTOCOL.md', sha256: proxy.EXPECTED.normativeProtocol, marker: core.PROTOCOL_MARKER },
      proxy: { path: 'research/UNIVERSAL_VOLATILITY_OVERLAY_PROXY_FALSIFICATION_PROTOCOL_V2.md', sha256: proxy.EXPECTED.proxyProtocolV2, marker: proxy.PROTOCOL_MARKER },
    },
    codeIdentities: structuredClone(proxy.CODE_IDENTITIES),
    runnerPrecondition: {
      applicableCodeProtocolTestsCommittedCleanRequiredBeforeStage1: true,
      currentDevelopmentInputCommitRequiredForStage1: false,
      currentDevelopmentInputSidecarCommitRequiredForStage1: false,
      developmentInputAndSidecarCommittedCleanRequiredBeforeStage2Replay: true,
      selectionManifestCommittedCleanRequiredBeforeStage2Replay: true,
      generatedArtifactCurrentlyIgnoredAndUntracked: true,
      stageExecutionAuthorizedByGeneration: false,
    },
    licensingBoundary: {
      underlyingSourceTermsStillApply: true,
      cmbitmSolePrimaryNoSplice: true,
      cmbitmExecutable: false,
      proxyDataCannotSatisfyOriginalLicensedExecutableSourceGate: true,
      permittedInference: 'negative_proxy_result_may_falsify; numerical_success_only_advances_to_separately_licensed_executable_prospective_validation',
    },
    parent: {
      normalizedInput: {
        path: 'research/local-artifacts/five-market-proxy-data-v2/five-market-proxy-input-v2-2026-08-24.json',
        sha256: proxy.EXPECTED.normalizedParentInput,
        bytes: 1000,
        sidecarPath: 'research/local-artifacts/five-market-proxy-data-v2/five-market-proxy-input-v2-2026-08-24.json.sha256',
        sidecarSha256: proxy.EXPECTED.normalizedParentInputSidecar,
      },
      dataFreezeManifest: {
        path: 'research/FIVE_MARKET_PROXY_DATA_FREEZE_V2_2026-08-24.json',
        sha256: proxy.EXPECTED.dataFreezeManifest,
        bytes: 1000,
        sidecarPath: 'research/FIVE_MARKET_PROXY_DATA_FREEZE_V2_2026-08-24.json.sha256',
        sidecarSha256: proxy.EXPECTED.dataFreezeManifestSidecar,
      },
      verifiedSourceArtifacts: sourceReceipts(),
    },
    boundary: {
      returnIntervalEndInclusive: '2018-12-31',
      returnIntervalStart: 'data_determined_after_each_markets_twelve_month_anchor_warmup_and_completed_formation_month',
      marketOrder: [...proxy.MARKET_ORDER],
      marketCalendarPolicy: 'each_market_own_completed_close_calendar_no_strict_common_calendar',
      cryptoIncluded: false,
      boundaryCrossingReturnInterval: 'forbidden',
      laterStageDataIncluded: false,
      validationOrEvaluationArtifactOpenedOrCreated: false,
    },
    markets,
    cash,
  };
}

function syntheticEvidence(options = {}) {
  const input = syntheticDevelopmentInput(options);
  const profile = proxy.makeSyntheticProfileForTests(input);
  const bytes = Buffer.from(core.canonicalJson(input));
  return proxy.makeInputEvidence(input, {
    bytes,
    expectedInputSha256: proxy.sha256(bytes),
    profile,
  });
}

function varianceRows() {
  const values = [
    0.0004, 0.0008, 0.0002, 0.0012, 0.0003, 0.0009,
    0.00025, 0.001, 0.00035, 0.0007, 0.00015, 0.0011,
    0.0002, 0.0006, 0.00018, 0.0009, 0.00022, 0.0005,
  ];
  const rows = [];
  let risky = 100;
  for (let monthIndex = 0; monthIndex < values.length; monthIndex++) {
    const date = new Date(Date.UTC(2017, 6 + monthIndex, 1));
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() + 1;
    for (let day = 1; day <= 16; day++) {
      if (rows.length) risky *= Math.exp(Math.sqrt(values[monthIndex]) * (day % 2 ? 1 : -0.8));
      rows.push({ date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`, value: risky });
    }
  }
  rows.push({ date: '2018-12-31', value: risky * 1.001 });
  return rows;
}

function positiveSyntheticMarketResults() {
  const passingConditions = {
    bhEdgeAtLeast0025: true,
    timingEdgeAtLeast0010: true,
    volatilityNoGreaterThanBuyAndHold: true,
    maximumDrawdownNoDeeperThanBuyAndHold: true,
    turnoverNoGreaterThanFourPerYear: true,
    executionIntegrity: true,
    requiredSourceIntervalsAndLiquidationComplete: true,
  };
  return proxy.MARKET_ORDER.map((market, marketIndex) => ({
    market,
    targetCalendarByCandidate: Object.fromEntries(core.CANDIDATES.map((candidate, candidateIndex) => {
      const target = 1 + marketIndex * 0.05 + candidateIndex * 0.01;
      return [candidate.id, { timeWeightedMeanTarget: target, targetDaySum: target * 100, totalDays: 100 }];
    })),
    scenarioResults: Object.fromEntries(core.SCENARIOS.map(scenario => [scenario.id,
      Object.fromEntries(core.CANDIDATES.map(candidate => [candidate.id, {
        gates: proxy.buildProxyGateReport({
          conditions: passingConditions,
          sampleRequirement: { eligibleExecutedMonthlyHoldings: 72, requiredMinimum: 60, pass: true },
          edges: {
            bhEdgeAnnualLogReturn: 0.01,
            meanEdgeAnnualLogReturn: 0.005,
            volEdgeAnnualLogReturn: 0.004,
            timingEdgeAnnualLogReturn: 0.004,
          },
        }),
      }]))
    ])),
  }));
}

function runGit(directory, args) {
  return childProcess.execFileSync('git', ['-C', directory, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('all frozen v2/base/core/splitter identities are exact without opening a stage artifact', () => {
  const accessLog = [];
  const receipts = proxy.verifyFrozenCodeIdentities({ accessLog });
  assert.equal(receipts.proxyProtocolV2.sha256, proxy.EXPECTED.proxyProtocolV2);
  assert.equal(receipts.strictRunner.sha256, proxy.EXPECTED.strictRunner);
  assert.equal(receipts.splitterV2.sha256, proxy.EXPECTED.splitterV2);
  assert.equal(proxy.EXPECTED.developmentInput, '67e176b5c7ba4d1123b2b1cdf4325edad5af0d5e5e98782cbe88f3f0457dc89f');
  assert.equal(proxy.EXPECTED.developmentInputSidecarBytes, '1cdd49e7ad4f5ae1cd526f47705e8802fd6b3dd46b285a4e6cbf004c380e6c43');
  assert.ok(accessLog.length >= 11);
  assert.ok(accessLog.every(file => !file.includes(`${path.sep}local-artifacts${path.sep}`)));
});

test('assertProductionCodeFreeze enumerates the exact 17-file Stage-1 seal', () => {
  const expected = [
    proxy.PATHS.normativeProtocol,
    proxy.PATHS.proxyProtocolV1,
    proxy.PATHS.proxyProtocolV2,
    proxy.PATHS.strictRunner,
    proxy.PATHS.strictRunnerTests,
    proxy.PATHS.baseDataBuilder,
    proxy.PATHS.baseDataBuilderTests,
    proxy.PATHS.dataBuilder,
    proxy.PATHS.dataBuilderTests,
    proxy.PATHS.calendarRoleSplitterV1,
    proxy.PATHS.calendarRoleSplitterV1Tests,
    proxy.PATHS.splitterV2,
    proxy.PATHS.splitterV2Tests,
    proxy.PATHS.dataFreezeManifest,
    proxy.PATHS.dataFreezeManifestSidecar,
    proxy.PATHS.runner,
    proxy.PATHS.runnerTests,
  ];
  assert.equal(expected.length, 17);
  assert.deepEqual([...proxy.PRODUCTION_CODE_FREEZE_PATHS], expected);

  const sealed = [];
  const blob = '1'.repeat(40);
  const execFileSync = (command, args) => {
    assert.equal(command, 'git');
    const operation = args[2];
    if (operation === 'rev-parse' && args[3] === '--show-toplevel') return `${proxy.REPO_ROOT}\n`;
    if (operation === 'ls-files') { sealed.push(args.at(-1)); return ''; }
    if (operation === 'status') return '';
    if (operation === 'rev-parse') return `${blob}\n`;
    if (operation === 'hash-object') return `${blob}\n`;
    throw new Error(`unexpected synthetic Git operation: ${args.join(' ')}`);
  };
  assert.equal(proxy.assertProductionCodeFreeze({ execFileSync, directory: proxy.REPO_ROOT }), true);
  assert.deepEqual(sealed, expected.map(file => path.relative(proxy.REPO_ROOT, file).split(path.sep).join('/')));
});

test('closed Stage-1 schema preserves nonconforming classifications and rejects extras', () => {
  const evidence = syntheticEvidence();
  assert.equal(evidence.payload.cash.executable, false);
  assert.ok(evidence.payload.markets.every(market => market.seriesLevelExecutable === false));

  const top = structuredClone(evidence.payload);
  top.futureRows = [];
  assert.throws(() => proxy.validateDevelopmentInput(top, { profile: evidence.profile }), /closed-schema key mismatch/);

  const market = structuredClone(evidence.payload);
  market.markets[0].outcome = 'invented';
  assert.throws(() => proxy.validateDevelopmentInput(market, { profile: evidence.profile }), /closed-schema key mismatch/);

  const nested = structuredClone(evidence.payload);
  nested.markets[0].source.futurePayload = [];
  assert.throws(() => proxy.validateDevelopmentInput(nested, { profile: evidence.profile }), /closed-schema key mismatch/);

  const sourceLaundering = structuredClone(evidence.payload);
  sourceLaundering.markets[0].seriesLevelExecutable = true;
  assert.throws(() => proxy.validateDevelopmentInput(sourceLaundering, { profile: evidence.profile }), /seriesLevelExecutable mismatch/);

  const cashLaundering = structuredClone(evidence.payload);
  cashLaundering.cash.executable = true;
  assert.throws(() => proxy.validateDevelopmentInput(cashLaundering, { profile: evidence.profile }), /cash\.executable mismatch/);
});

test('row, role, terminal, and exact-parent receipts are independently recomputed', () => {
  const evidence = syntheticEvidence();

  const row = structuredClone(evidence.payload);
  row.markets[0].rows[5].value *= 1.01;
  assert.throws(() => proxy.validateDevelopmentInput(row, { profile: evidence.profile }), /stageHistory\.rowsSha256 mismatch/);

  const role = structuredClone(evidence.payload);
  role.markets[0].rowRoles[0] = 'stage_return_interval_end_eligible';
  assert.throws(() => proxy.validateDevelopmentInput(role, { profile: evidence.profile }), /rowRoles\[0\] mismatch/);

  const terminal = structuredClone(evidence.payload);
  terminal.markets[0].rows.pop();
  assert.throws(() => proxy.validateDevelopmentInput(terminal, { profile: evidence.profile }), /stageHistory/);

  const declaredParent = structuredClone(evidence.payload);
  declaredParent.markets[0].parentHistory.rowCount += 1;
  assert.throws(() => proxy.validateDevelopmentInput(declaredParent, { profile: evidence.profile }), /parentHistory\.rowCount mismatch/);
});

test('validated input evidence is immutable and remains cryptographically bound to canonical bytes', () => {
  const evidence = syntheticEvidence();
  assert.throws(() => { evidence.payload.status = 'ALTERED'; }, TypeError);
  evidence.bytes[0] ^= 1;
  assert.throws(() => proxy.buildDevelopmentResult(evidence), /evidence bytes changed/);
});

test('the original seven-gate vector can never launder source or executability while numeric screen remains separate', () => {
  const numerical = {
    conditions: {
      bhEdgeAtLeast0025: true,
      timingEdgeAtLeast0010: true,
      volatilityNoGreaterThanBuyAndHold: true,
      maximumDrawdownNoDeeperThanBuyAndHold: true,
      turnoverNoGreaterThanFourPerYear: true,
      executionIntegrity: true,
      requiredSourceIntervalsAndLiquidationComplete: true,
    },
    sampleRequirement: { eligibleExecutedMonthlyHoldings: 72, requiredMinimum: 60, pass: true },
    edges: { bhEdgeAnnualLogReturn: 0.01, meanEdgeAnnualLogReturn: 0.005, volEdgeAnnualLogReturn: 0.004, timingEdgeAnnualLogReturn: 0.004 },
  };
  const report = proxy.buildProxyGateReport(numerical);
  assert.deepEqual(report.originalSevenGates.vector.map(item => item.pass), [true, true, true, true, true, false, false]);
  assert.equal(report.originalSevenGates.allSeven, false);
  assert.equal(report.numericProxyScreen.pass, true);
  assert.equal(report.numericProxyScreen.isOriginalGateOrStagePass, false);
  assert.equal(report.proxyDevelopmentCellEligible, true);
});

test('selection uses only the frozen all-market/all-scenario numeric screen and unchanged tie break', () => {
  const marketResults = proxy.MARKET_ORDER.map(market => ({
    market,
    scenarioResults: Object.fromEntries(core.SCENARIOS.map(scenario => [scenario.id,
      Object.fromEntries(core.CANDIDATES.map(candidate => [candidate.id, {
        gates: proxy.buildProxyGateReport({
          conditions: {
            bhEdgeAtLeast0025: true,
            timingEdgeAtLeast0010: true,
            volatilityNoGreaterThanBuyAndHold: true,
            maximumDrawdownNoDeeperThanBuyAndHold: true,
            turnoverNoGreaterThanFourPerYear: true,
            executionIntegrity: true,
            requiredSourceIntervalsAndLiquidationComplete: true,
          },
          sampleRequirement: { eligibleExecutedMonthlyHoldings: 72, requiredMinimum: 60, pass: true },
          edges: { timingEdgeAnnualLogReturn: 0.004, bhEdgeAnnualLogReturn: 0.01, meanEdgeAnnualLogReturn: 0.005, volEdgeAnnualLogReturn: 0.004 },
        }),
      }]))
    ])),
  }));
  const summaries = proxy.summarizeCandidates(marketResults);
  const selected = proxy.selectProxyDevelopmentCandidate(summaries);
  assert.equal(selected.id, 'IVOL_125');

  marketResults[0].scenarioResults.stress.IVOL_125.gates.numericProxyScreen.pass = false;
  marketResults[0].scenarioResults.stress.IVOL_125.gates.proxyDevelopmentCellEligible = false;
  const changed = proxy.summarizeCandidates(marketResults);
  assert.equal(changed.IVOL_125.proxyDevelopmentEligibleAcrossAllCells, false);
});

test('fully synthetic positive build orchestrates only the bounded development-candidate outcome', () => {
  const evidence = syntheticEvidence();
  assert.throws(() => proxy.buildDevelopmentResult(evidence, { marketResults: positiveSyntheticMarketResults() }), /unrecognized synthetic analysis injection/);
  const injected = proxy.makeSyntheticAnalysisInjectionForTests(evidence, positiveSyntheticMarketResults());
  const result = proxy.buildDevelopmentResult(evidence, injected);

  assert.equal(result.status, proxy.POSITIVE_STATUS);
  assert.equal(result.status, 'PROXY_DEVELOPMENT_ELIGIBLE');
  assert.equal(result.outcomeLabel, proxy.POSITIVE_OUTCOME_LABEL);
  assert.equal(result.outcomeLabel, 'DEVELOPMENT_CANDIDATE_ONLY');
  assert.equal(result.selectedCandidate, 'IVOL_125');
  assert.equal(result.selectedCandidateParameters.id, 'IVOL_125');
  assert.equal(result.developmentPooledMeanTargetDiagnostic.target, 1.075);
  assert.equal(result.developmentPooledMeanTargetDiagnostic.calendarDays, 400);
  assert.equal(result.developmentPooledMeanTargetDiagnostic.affectsSelectionOrGates, false);
  assert.equal(result.originalProtocolStagePass, false);
  assert.equal(result.numericProxyScreenClearedByAtLeastOneCandidate, true);
  assert.deepEqual(result.laterStageAccess, {
    authorized: false,
    filesOpenedOrCreated: false,
    commandsImplemented: false,
  });
  assert.ok(result.allFourCandidateResults.marketResults.every(market =>
    core.SCENARIOS.every(scenario =>
      market.scenarioResults[scenario.id].IVOL_125.gates.originalSevenGates.vector[5].pass === false &&
      market.scenarioResults[scenario.id].IVOL_125.gates.originalSevenGates.vector[6].pass === false
    )
  ));
});

test('real synthetic strict-core path uses exact grid, costs, candidate schedule, and deterministic paired bootstrap', { timeout: 120000 }, () => {
  const riskyRows = varianceRows();
  const cashRows = riskyRows.map(row => ({ date: row.date, value: 100 }));
  const input = { cash: { rows: cashRows } };
  const market = { key: 'sweden', ticker: 'SYNTHETIC-EWD', rows: riskyRows };
  const options = {
    candidates: [core.CANDIDATES[0]],
    stageConfig: { ...core.STAGES.development, minimumExecutedMonthlyHoldings: 1 },
  };
  const first = proxy.analyzeProxyMarket(input, market, options);
  const second = proxy.analyzeProxyMarket(input, market, options);
  for (const scenario of core.SCENARIOS) {
    const left = first.scenarioResults[scenario.id].IVOL_125;
    const right = second.scenarioResults[scenario.id].IVOL_125;
    assert.equal(left.candidate.valid, true);
    assert.equal(left.controls.volatilityGridTargetsTested, 10001);
    assert.equal(left.candidate.metrics.terminalLiquidationPerformed, true);
    assert.equal(left.bootstrap.buyAndHold.replicateCount, 10000);
    assert.equal(left.bootstrap.buyAndHold.seed, 20260825);
    assert.equal(left.bootstrap.buyAndHold.circularBlockMonths, 6);
    assert.deepEqual(left.bootstrap, right.bootstrap);
    assert.deepEqual(left.candidate.metrics, right.candidate.metrics);
    assert.equal(left.gates.originalSevenGates.vector[5].pass, false);
    assert.equal(left.gates.originalSevenGates.vector[6].pass, false);
  }
  assert.equal(first.sourceAndIntervalsComplete, false);
  assert.equal(first.originalInstrumentExecutabilityDocumented, false);
  assert.equal(first.actualTradeSchedules.IVOL_125[0].executionDate, first.firstExecutionDate);
});

let cachedFailure;
function failureFixture() {
  cachedFailure ||= (() => {
    const evidence = syntheticEvidence();
    const result = proxy.buildDevelopmentResult(evidence);
    return { evidence, result };
  })();
  return cachedFailure;
}

test('development-only result uses the exact one-way failure label and never an original stage claim', { timeout: 120000 }, () => {
  const { result } = failureFixture();
  assert.equal(result.schema, proxy.RESULT_SCHEMA);
  assert.equal(result.status, proxy.NEGATIVE_STATUS);
  assert.equal(result.outcomeLabel, proxy.NEGATIVE_STATUS);
  assert.equal(result.originalProtocolStagePass, false);
  assert.equal(result.numericProxyScreenClearedByAtLeastOneCandidate, false);
  assert.equal(result.laterStageAccess.authorized, false);
  assert.equal(result.laterStageAccess.filesOpenedOrCreated, false);
  assert.equal(result.laterStageAccess.commandsImplemented, false);
  assert.doesNotMatch(result.status, /PASS|VALIDATED|RELIABLE|BEATS_ALL_MARKETS/);
  assert.equal(proxy.POSITIVE_OUTCOME_LABEL, 'DEVELOPMENT_CANDIDATE_ONLY');
});

test('complete canonical replay rejects top, nested-gate, selection, path, and coordinated-input tampering', { timeout: 120000 }, () => {
  const { evidence, result } = failureFixture();
  assert.doesNotThrow(() => proxy.validateDevelopmentResult(result, evidence));

  const top = structuredClone(result);
  top.originalProtocolStagePass = true;
  assert.throws(() => proxy.validateDevelopmentResult(top, evidence), /deterministic replay/);

  const gate = structuredClone(result);
  gate.allFourCandidateResults.marketResults[0].scenarioResults.primary.IVOL_125.gates.originalSevenGates.vector[5].pass = true;
  assert.throws(() => proxy.validateDevelopmentResult(gate, evidence), /deterministic replay/);

  const selected = structuredClone(result);
  selected.status = proxy.POSITIVE_STATUS;
  selected.outcomeLabel = proxy.POSITIVE_OUTCOME_LABEL;
  selected.selectedCandidate = 'IVOL_125';
  assert.throws(() => proxy.validateDevelopmentResult(selected, evidence), /deterministic replay/);

  const path = structuredClone(result);
  path.allFourCandidateResults.marketResults[0].scenarioResults.primary.IVOL_125.candidate.navPath = [{ invented: true }];
  assert.throws(() => proxy.validateDevelopmentResult(path, evidence), /deterministic replay/);

  const alternateEvidence = syntheticEvidence({ marketMultiplier: 1.01 });
  const coordinatedAlternate = proxy.buildDevelopmentResult(alternateEvidence);
  assert.throws(() => proxy.validateDevelopmentResult(coordinatedAlternate, evidence), /deterministic replay/);
});

test('sidecar-first reader accepts only canonical synthetic bytes and catches sidecar/hash/schema tampering', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-v2-stage1-input-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'development-input-v2-2026-08-24.json');
  const input = syntheticDevelopmentInput();
  const profile = proxy.makeSyntheticProfileForTests(input);
  const bytes = Buffer.from(core.canonicalJson(input));
  const digest = proxy.sha256(bytes);
  const sidecar = Buffer.from(`${digest}  ${path.basename(file)}\n`);
  fs.writeFileSync(file, bytes);
  fs.writeFileSync(`${file}.sha256`, sidecar);
  const accessLog = [];
  const evidence = proxy.readDevelopmentInput(file, {
    enforceDefaultPath: false,
    expectedInputSha256: digest,
    expectedSidecarSha256: proxy.sha256(sidecar),
    profile,
    accessLog,
  });
  assert.equal(evidence.sha256, digest);
  assert.deepEqual(accessLog, [`${file}.sha256`, file].map(item => path.resolve(item)));

  fs.writeFileSync(`${file}.sha256`, Buffer.from(`${'0'.repeat(64)}  ${path.basename(file)}\n`));
  assert.throws(() => proxy.readDevelopmentInput(file, {
    enforceDefaultPath: false,
    expectedInputSha256: digest,
    expectedSidecarSha256: proxy.sha256(sidecar),
    profile,
  }), /sidecar-bytes SHA-256 mismatch/);
});

test('command surface exposes development only and rejects every later-stage path before operations', () => {
  const valid = ['development', '--input', proxy.PATHS.developmentInput, '--output', proxy.PATHS.developmentResult];
  assert.deepEqual(proxy.parseCommand(valid), { stage: 'development', input: proxy.PATHS.developmentInput, output: proxy.PATHS.developmentResult });
  for (const argv of [
    ['validation', '--input', 'x', '--output', 'y'],
    ['evaluation', '--input', 'x', '--output', 'y'],
    ['development', '--input', 'x'],
    ['development', '--input', 'x', '--output', 'y', '--selection-manifest', 'z'],
  ]) assert.throws(() => proxy.parseCommand(argv), /accepts only/);

  let operations = 0;
  assert.throws(() => proxy.main(['validation', '--input', 'x', '--output', 'y'], {
    verifyFrozenCodeIdentities() { operations++; },
  }), /accepts only/);
  assert.equal(operations, 0);
  assert.throws(() => proxy.assertNoLaterStagePath(path.join(os.tmpdir(), 'validation', 'x.json'), 'test'), /later-stage path/);
  assert.throws(() => proxy.assertNoLaterStagePath(path.join(os.tmpdir(), 'evaluation', 'x.json'), 'test'), /later-stage path/);
});

test('main ordering is code/protocol freeze then the sole Stage-1 input, analysis, and development result', () => {
  const order = [];
  const fakeEvidence = { synthetic: true };
  const fakeResult = {
    schema: proxy.RESULT_SCHEMA,
    stage: 'development',
    status: proxy.NEGATIVE_STATUS,
    outcomeLabel: proxy.NEGATIVE_STATUS,
    selectedCandidate: null,
    originalProtocolStagePass: false,
  };
  const result = proxy.main([
    'development', '--input', proxy.PATHS.developmentInput, '--output', proxy.PATHS.developmentResult,
  ], {
    verifyFrozenCodeIdentities() { order.push('protocol-and-code-identities'); },
    assertProductionCodeFreeze() { order.push('committed-clean-code-freeze'); },
    assertDevelopmentResultAbsent(file) { order.push(`one-shot:${path.basename(file)}`); },
    readDevelopmentInput(file) { order.push(`read:${path.basename(file)}`); return fakeEvidence; },
    buildDevelopmentResult(evidence) { assert.equal(arguments.length, 1); assert.equal(evidence, fakeEvidence); order.push('analyze-stage1'); return fakeResult; },
    writeDevelopmentResult(file, value) { assert.equal(value, fakeResult); order.push(`write:${path.basename(file)}`); return { sha256: 'a'.repeat(64) }; },
    writeStatus() { order.push('status'); },
  });
  assert.equal(result, fakeResult);
  assert.deepEqual(order, [
    'protocol-and-code-identities',
    'committed-clean-code-freeze',
    'one-shot:development-result-v2-2026-08-25.json',
    'read:development-input-v2-2026-08-24.json',
    'analyze-stage1',
    'write:development-result-v2-2026-08-25.json',
    'status',
  ]);
});

test('main stops on an existing one-shot target before opening the Stage-1 input', () => {
  let inputReads = 0;
  assert.throws(() => proxy.main([
    'development', '--input', proxy.PATHS.developmentInput, '--output', proxy.PATHS.developmentResult,
  ], {
    verifyFrozenCodeIdentities() {},
    assertProductionCodeFreeze() {},
    assertDevelopmentResultAbsent() { throw new proxy.IntegrityError('one-shot Stage-1 result target already exists'); },
    readDevelopmentInput() { inputReads++; throw new Error('must not read'); },
  }), /already exists/);
  assert.equal(inputReads, 0);
});

test('temporary Git sealing rejects untracked and dirty code and accepts exact committed bytes', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-v2-code-freeze-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  runGit(directory, ['init', '--quiet']);
  runGit(directory, ['config', 'user.email', 'synthetic@example.invalid']);
  runGit(directory, ['config', 'user.name', 'Synthetic Fixture']);
  const committed = path.join(directory, 'protocol.md');
  const untracked = path.join(directory, 'runner.js');
  fs.writeFileSync(committed, 'frozen\n');
  fs.writeFileSync(untracked, 'untracked\n');
  runGit(directory, ['add', 'protocol.md']);
  runGit(directory, ['commit', '--quiet', '-m', 'freeze synthetic protocol']);

  assert.equal(proxy.assertCommittedCleanFiles([committed], { directory }), true);
  assert.throws(() => proxy.assertCommittedCleanFiles([untracked], { directory }), /not committed/);
  fs.writeFileSync(committed, 'dirty\n');
  assert.throws(() => proxy.assertCommittedCleanFiles([committed], { directory }), /uncommitted changes/);
});

test('one-shot writer rejects result or sidecar pre-existence and uses create-new writes', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-v2-result-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const file = path.join(directory, 'development-result.json');
  const written = proxy.writeDevelopmentResult(file, { schema: proxy.RESULT_SCHEMA, status: proxy.NEGATIVE_STATUS }, { enforceDefaultPath: false });
  assert.deepEqual(fs.readdirSync(directory).sort(), ['development-result.json', 'development-result.json.sha256']);
  assert.equal(fs.readFileSync(`${file}.sha256`, 'utf8'), `${written.sha256}  development-result.json\n`);
  const original = fs.readFileSync(file);
  assert.throws(() => proxy.writeDevelopmentResult(file, { altered: true }, { enforceDefaultPath: false }), /already exists/);
  assert.deepEqual(fs.readFileSync(file), original);

  const sidecarOnly = path.join(directory, 'development-sidecar-only.json');
  fs.writeFileSync(`${sidecarOnly}.sha256`, 'preexisting\n');
  assert.throws(() => proxy.writeDevelopmentResult(sidecarOnly, {}, { enforceDefaultPath: false }), /already exists/);
  assert.equal(fs.existsSync(sidecarOnly), false);
  assert.equal(fs.readFileSync(`${sidecarOnly}.sha256`, 'utf8'), 'preexisting\n');

  const createFlags = [];
  const syntheticIo = {
    existsSync() { return false; },
    mkdirSync() {},
    writeFileSync(target, bytes, options) {
      assert.ok(Buffer.isBuffer(bytes));
      createFlags.push({ target, flag: options && options.flag });
    },
  };
  const raceSafe = path.join(directory, 'synthetic-create-new.json');
  proxy.writeDevelopmentResult(raceSafe, {}, { io: syntheticIo, enforceDefaultPath: false });
  assert.deepEqual(createFlags.map(item => item.flag), ['wx', 'wx']);
  assert.deepEqual(createFlags.map(item => item.target), [raceSafe, `${raceSafe}.sha256`].map(item => path.resolve(item)));

  assert.throws(() => proxy.writeDevelopmentResult(path.join(directory, 'validation', 'x.json'), {}, { enforceDefaultPath: false }), /later-stage path/);
  assert.throws(() => proxy.writeDevelopmentResult(path.join(directory, 'evaluation', 'x.json'), {}, { enforceDefaultPath: false }), /later-stage path/);
});
