'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const study = require('../research/component_fragility_tail_risk');
const launcher = require('../research/component_fragility_tail_risk_launcher');

const DAY_MS = 86400000;

function isoDay(start, offset) {
  return new Date(Date.parse(`${start}T00:00:00.000Z`) + offset * DAY_MS).toISOString().slice(0, 10);
}

function signal(date, scores, options = {}) {
  const components = {};
  study.COMPONENT_ORDER.forEach((key, index) => {
    components[key] = {
      score: scores[index],
      raw: scores[index],
      asOf: options.asOfByKey && options.asOfByKey[key] || options.asOf || date,
    };
  });
  const mean = scores.reduce((sum, value) => sum + value, 0) / scores.length;
  return {
    date,
    publishedScore: options.publishedScore == null ? Math.round(mean * 10) / 10 : options.publishedScore,
    componentCount: 6,
    components,
  };
}

function causalMarket() {
  const prices = Array.from({ length: 149 }, (_, index) => ({
    date: isoDay('2010-01-01', index),
    close: 100 * Math.exp(0.0012 * index + 0.004 * Math.sin(index * 0.71)),
  }));
  const lagIndex = 120;
  const signalIndex = 125;
  return {
    key: 'usa',
    prices: { rows: prices },
    signals: [
      signal(prices[lagIndex].date, [20, 15, 40, 35, 70, 50]),
      signal(prices[signalIndex].date, [10, 20, 30, 40, 50, 60]),
    ],
  };
}

function featureVector(seed, marketOffset = 0) {
  const x = seed + 1 + marketOffset * 0.173;
  return {
    publishedScore: 0.5 + 0.17 * Math.sin(x * 0.31) + 0.03 * Math.cos(x * 0.07),
    logReturn1: 0.012 * Math.sin(x * 0.47) + 0.003 * Math.cos(x * 0.19),
    logReturn5: 0.025 * Math.cos(x * 0.23) + 0.004 * Math.sin(x * 0.61),
    logReturn20: 0.06 * Math.sin(x * 0.13) + 0.007 * Math.cos(x * 0.43),
    sigma20: 0.015 + 0.004 * (1 + Math.sin(x * 0.29)) + 0.00003 * x,
    trend125: 0.08 * Math.cos(x * 0.11) + 0.009 * Math.sin(x * 0.37),
    drawdown63: 0.03 + 0.02 * (1 + Math.sin(x * 0.17)) + 0.001 * Math.cos(x * 0.53),
    fragility: 0.012 + 0.006 * (1 + Math.cos(x * 0.41)) + 0.0002 * Math.sin(x * 0.67),
  };
}

function syntheticRows(market, count, options = {}) {
  const marketOffset = market === 'usa' ? 0 : market === 'europe' ? 2 : study.MARKET_ORDER.indexOf(market) + 4;
  return Array.from({ length: count }, (_, index) => {
    const features = featureVector(index + (options.seedOffset || 0), marketOffset);
    if (options.collinearFragility) features.fragility = 0.01 + 0.03 * features.publishedScore;
    const linear = 0.2
      + 0.11 * features.publishedScore
      - 0.8 * features.logReturn1
      + 0.35 * features.logReturn5
      - 0.22 * features.logReturn20
      + 1.7 * features.sigma20
      + 0.18 * features.trend125
      + 0.5 * features.drawdown63
      + 4.2 * features.fragility;
    const entryOffset = index * 3;
    return {
      market,
      signalDate: isoDay('2019-01-01', entryOffset - 1),
      signalIndex: index * 3,
      entryIndex: index * 3 + 1,
      exitIndex: index * 3 + 22,
      entryDate: isoDay('2019-01-01', entryOffset),
      exitDate: isoDay('2019-01-01', entryOffset + 21),
      features,
      outcome: linear + (options.noise ? options.noise * Math.sin((index + 1) * 0.83 + marketOffset) : 0),
    };
  });
}

function builtFixture(training, evaluationCount = 40) {
  const evaluation = {};
  for (const market of study.MARKET_ORDER) evaluation[market] = syntheticRows(market, evaluationCount, { seedOffset: 100, noise: 0.01 });
  return {
    markets: study.MARKET_ORDER.map(market => ({ market, audit: { synthetic: true } })),
    training,
    evaluation,
    chronologyAudit: Object.fromEntries(study.MARKET_ORDER.map(market => [market, { synthetic: true }])),
  };
}

function temporaryDirectory(t, name) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function git(directory, args) {
  return childProcess.execFileSync('git', ['-C', directory, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function initializeFrozenTagRepository(directory) {
  fs.mkdirSync(directory, { recursive: true });
  const evidence = study.readFreezeManifest();
  for (const entry of evidence.manifest.files) {
    const target = path.join(directory, ...entry.path.split('/'));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(path.join(study.REPO_ROOT, ...entry.path.split('/')), target);
  }
  const manifestTarget = path.join(directory, 'research', 'component-fragility-tail-risk-freeze-v1.json');
  fs.mkdirSync(path.dirname(manifestTarget), { recursive: true });
  fs.copyFileSync(study.PATHS.manifest, manifestTarget);
  git(directory, ['init', '--quiet']);
  git(directory, ['config', 'user.email', 'synthetic@example.invalid']);
  git(directory, ['config', 'user.name', 'Synthetic Freeze Test']);
  git(directory, ['add', '--', '.']);
  git(directory, ['commit', '--quiet', '-m', 'synthetic immutable freeze']);
  git(directory, ['tag', '-a', study.FIXED_PREOUTCOME_TAG, '-m', 'synthetic pre-outcome tag']);
  return manifestTarget;
}

function copyFrozenTagFixture(t) {
  const directory = temporaryDirectory(t, 'component-fragility-freeze');
  return { directory, manifestTarget: initializeFrozenTagRepository(directory) };
}

function copyFrozenLinkedWorktreeFixture(t) {
  const parent = temporaryDirectory(t, 'component-fragility-linked-freeze');
  const repository = path.join(parent, 'repository');
  const manifestTarget = initializeFrozenTagRepository(repository);
  const worktreeA = path.join(parent, 'worktree-a');
  const worktreeB = path.join(parent, 'worktree-b');
  git(repository, ['worktree', 'add', '--quiet', '--detach', worktreeA, `${study.FIXED_PREOUTCOME_TAG}^{commit}`]);
  git(repository, ['worktree', 'add', '--quiet', '--detach', worktreeB, `${study.FIXED_PREOUTCOME_TAG}^{commit}`]);
  const commonA = path.resolve(git(worktreeA, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const commonB = path.resolve(git(worktreeB, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  assert.equal(commonA, commonB);
  assert.notEqual(path.resolve(worktreeA), path.resolve(worktreeB));
  return { parent, repository, manifestTarget, worktreeA, worktreeB, commonDirectory: commonA };
}

test('frozen production identities use the exact one-shot paths and final protocol hash', () => {
  assert.equal(study.EXPECTED_SHA256.protocol, '30f874087de0437150ce017c649847a535a727afcb7f04bd36e1214d57b9d69f');
  assert.equal(study.EXPECTED_SHA256.input, 'ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d');
  assert.match(study.PATHS.input.replaceAll('\\', '/'), /fear-greed-v2-validation-input-2026-08-25T12-44-22Z\.json$/);
  assert.equal(study.PATHS.inputSidecar, study.PATHS.input.replace(/\.json$/, '.sha256'));
  assert.match(study.PATHS.output.replaceAll('\\', '/'), /component-fragility-tail-v1\/component-fragility-tail-v1-result-2026-08-26\.json$/);
  assert.equal(study.PATHS.outputSidecar, `${study.PATHS.output}.sha256`);
  assert.equal(study.assertExactProductionPaths(), true);
  const pinned = study.verifyPinnedDependencies();
  assert.equal(pinned.protocol.sha256, study.EXPECTED_SHA256.protocol);
});

test('component fragility uses population dispersion and downside-only five-row weakening', () => {
  const current = signal('2020-06-06', [10, 20, 30, 40, 50, 60]);
  const lagged = signal('2020-06-01', [20, 15, 40, 35, 70, 50]);
  const actual = study.componentFragility(current, lagged);
  const expectedDispersion = Math.sqrt(1750 / 6) / 100;
  const expectedWeakening = Math.sqrt(600 / 6) / 100;
  assert.equal(actual.componentMean, 35);
  assert.ok(Math.abs(actual.dispersion - expectedDispersion) < 1e-15);
  assert.ok(Math.abs(actual.weakening - expectedWeakening) < 1e-15);
  assert.ok(Math.abs(actual.fragility - expectedDispersion * expectedWeakening) < 1e-15);
});

test('component timestamps must be ISO, causal, and at most seven calendar days stale', () => {
  const scores = [10, 20, 30, 40, 50, 60];
  const current = signal('2020-06-10', scores);
  assert.doesNotThrow(() => study.componentFragility(signal('2020-06-10', scores, { asOf: '2020-06-03' }), signal('2020-06-05', scores)));
  assert.throws(() => study.componentFragility(signal('2020-06-10', scores, { asOf: '2020-06-11' }), signal('2020-06-05', scores)), /causal/);
  assert.throws(() => study.componentFragility(signal('2020-06-10', scores, { asOf: '2020-06-02' }), signal('2020-06-05', scores)), /7 calendar days/);
  assert.throws(() => study.componentFragility(signal('2020-06-10', scores, { asOf: 'not-a-date' }), signal('2020-06-05', scores)), /ISO date/);
  assert.doesNotThrow(() => study.componentFragility(current, signal('2020-06-05', scores)));
});

test('causal builder uses exact price-row t-5, next-close entry, and t+22 exit', () => {
  const market = causalMarket();
  const built = study.buildCausalRows(market);
  assert.equal(built.audit.eligible, 1);
  assert.equal(built.audit.insufficientPriorTargetCloses, 1);
  const row = built.rows[0];
  const prices = market.prices.rows;
  assert.equal(row.signalIndex, 125);
  assert.equal(row.laggedSignalDate, prices[120].date);
  assert.equal(row.entryIndex, 126);
  assert.equal(row.exitIndex, 147);
  assert.equal(row.entryDate, prices[126].date);
  assert.equal(row.exitDate, prices[147].date);
  assert.ok(Number.isFinite(row.features.sigma20) && row.features.sigma20 > 0);

  const missingLag = causalMarket();
  missingLag.signals = [missingLag.signals[1]];
  const missing = study.buildCausalRows(missingLag);
  assert.equal(missing.rows.length, 0);
  assert.equal(missing.audit.missingExactLagFiveSignal, 1);
});

test('tail outcome uses only t+1 through t+22 and exact seven controls', () => {
  const market = causalMarket();
  const row = study.buildCausalRows(market).rows[0];
  const prices = market.prices.rows;
  const j = row.signalIndex;
  const returns20 = Array.from({ length: 20 }, (_, offset) => Math.log(prices[j - 19 + offset].close / prices[j - 20 + offset].close));
  const meanReturn = returns20.reduce((sum, value) => sum + value, 0) / 20;
  const sigma20 = Math.sqrt(returns20.reduce((sum, value) => sum + (value - meanReturn) ** 2, 0) / 19);
  let peak = prices[j + 1].close;
  let drawdown = 0;
  for (let index = j + 1; index <= j + 22; index++) {
    peak = Math.max(peak, prices[index].close);
    drawdown = Math.max(drawdown, Math.log(peak / prices[index].close));
  }
  assert.deepEqual(Object.keys(row.features), study.FULL_FEATURES);
  assert.ok(Math.abs(row.features.sigma20 - sigma20) < 1e-15);
  assert.ok(Math.abs(row.diagnostics.maximumDrawdown21 - drawdown) < 1e-15);
  assert.ok(Math.abs(row.outcome - Math.log(1 + drawdown / (sigma20 * Math.sqrt(21)))) < 1e-15);
});

test('weighted preprocessing gives USA and Europe exactly one-half total weight', () => {
  const rows = [
    { market: 'usa', features: { publishedScore: 0 } },
    { market: 'europe', features: { publishedScore: 10 } },
    { market: 'europe', features: { publishedScore: 20 } },
    { market: 'europe', features: { publishedScore: 30 } },
  ];
  const balanced = study.balancedTrainingWeights(rows);
  assert.equal(balanced.ok, true);
  assert.deepEqual(balanced.weights, [0.5, 1 / 6, 1 / 6, 1 / 6]);
  assert.ok(Math.abs(balanced.marketTotals.usa - 0.5) < 1e-15);
  assert.ok(Math.abs(balanced.marketTotals.europe - 0.5) < 1e-15);
  const preprocessing = study.weightedStandardization(rows, balanced.weights, ['publishedScore']);
  assert.equal(preprocessing.ok, true);
  assert.ok(Math.abs(preprocessing.means.publishedScore - 10) < 1e-15);
  assert.ok(Math.abs(preprocessing.scales.publishedScore - Math.sqrt(400 / 3)) < 1e-14);
});

test('two-pass weighted QR recovers a known line and deterministically rejects rank failure', () => {
  const x = [-2, -1, 0, 1, 3];
  const design = x.map(value => [1, value]);
  const outcome = x.map(value => 3 + 2 * value);
  const weights = [0.05, 0.15, 0.2, 0.25, 0.35];
  const solved = study.twoPassMgsQrSolve(design, outcome, weights);
  assert.equal(solved.ok, true);
  assert.ok(Math.abs(solved.coefficients[0] - 3) < 1e-13);
  assert.ok(Math.abs(solved.coefficients[1] - 2) < 1e-13);
  const singular = study.twoPassMgsQrSolve(x.map(value => [1, value, 2 * value]), outcome, weights);
  assert.equal(singular.ok, false);
  assert.equal(singular.failedColumn, 2);
  assert.match(singular.reason, /rank failure/);
});

test('fixed pooled preprocessing and diagnostic fits identify a positive independent fragility coefficient', () => {
  const training = [...syntheticRows('usa', 60), ...syntheticRows('europe', 37)];
  const fitted = study.fitSharedModels(training);
  assert.equal(fitted.ok, true, fitted.reason);
  assert.ok(Math.abs(fitted.weights.marketTotals.usa - 0.5) < 1e-12);
  assert.ok(Math.abs(fitted.weights.marketTotals.europe - 0.5) < 1e-12);
  assert.ok(fitted.residualizedFragilityVariance > study.RESIDUAL_FRAGILITY_TOLERANCE);
  assert.ok(fitted.fragilityCoefficients.pooled > 0);
  assert.ok(fitted.fragilityCoefficients.usa > 0);
  assert.ok(fitted.fragilityCoefficients.europe > 0);
});

test('fragility fully explained by M0 is unidentifiable before M1', () => {
  const rows = [
    ...syntheticRows('usa', 60, { collinearFragility: true }),
    ...syntheticRows('europe', 60, { collinearFragility: true }),
  ];
  const fitted = study.fitSharedModels(rows);
  assert.equal(fitted.ok, false);
  assert.equal(fitted.stage, 'residualized-fragility-variance');
  assert.ok(fitted.residualizedFragilityVariance <= study.RESIDUAL_FRAGILITY_TOLERANCE);
});

test('HAC-21 and Holm use the frozen formulas, fixed order, and missing-family behavior', () => {
  const adjustedLosses = Array.from({ length: 50 }, (_, index) => 0.02 + 0.013 * Math.sin((index + 1) * 0.37) - 0.004 * Math.cos((index + 1) * 0.11));
  const actual = study.neweyWestMeanTest21(adjustedLosses);
  const mean = adjustedLosses.reduce((sum, value) => sum + value, 0) / adjustedLosses.length;
  const centered = adjustedLosses.map(value => value - mean);
  let lrv = centered.reduce((sum, value) => sum + value ** 2, 0) / centered.length;
  for (let lag = 1; lag <= 21; lag++) {
    let gamma = 0;
    for (let index = lag; index < centered.length; index++) gamma += centered[index] * centered[index - lag];
    lrv += 2 * (1 - lag / 22) * gamma / centered.length;
  }
  assert.equal(actual.bandwidth, 21);
  assert.ok(Math.abs(actual.mean - mean) < 1e-16);
  assert.ok(Math.abs(actual.lrv - lrv) < 1e-16);
  assert.ok(Math.abs(actual.standardError - Math.sqrt(lrv / adjustedLosses.length)) < 1e-16);
  assert.equal(study.neweyWestMeanTest21(Array(30).fill(0.25)).pValueOneSidedPositive, 0);
  assert.equal(study.neweyWestMeanTest21(Array(30).fill(0)).pValueOneSidedPositive, 1);

  const holm = study.holmAdjustFive([
    { market: 'crypto', pValue: 0.01 },
    { market: 'sweden', pValue: 0.01 },
    { market: 'usa', pValue: 0.03 },
    { market: 'europe', pValue: 0.2 },
    { market: 'global', pValue: 0.5 },
  ]);
  assert.deepEqual(holm.map(row => row.adjustedPValue), [0.05, 0.05, 0.09, 0.4, 0.5]);
  const missing = study.holmAdjustFive(study.MARKET_ORDER.map((market, index) => ({ market, pValue: index === 2 ? null : 0.01 })));
  assert.deepEqual(missing.map(row => row.adjustedPValue), [null, null, null, null, null]);
  const outOfRange = study.holmAdjustFive(study.MARKET_ORDER.map((market, index) => ({ market, pValue: index === 3 ? 1.01 : 0.01 })));
  assert.deepEqual(outOfRange.map(row => row.adjustedPValue), [null, null, null, null, null]);
});

test('adequacy exact boundaries admit a shared seam and use non-inclusive UTC span', () => {
  const rows = Array.from({ length: 756 }, (_, index) => {
    const entryDays = Math.floor(index * 1074 / 755);
    return {
      entryIndex: index,
      exitIndex: index + 21,
      entryDate: isoDay('2020-01-01', entryDays),
      exitDate: isoDay('2020-01-01', entryDays + 21),
    };
  });
  const adequate = study.adequacyForRows(rows);
  assert.equal(adequate.forecastRows, 756);
  assert.equal(adequate.nonOverlappingOutcomes, 36);
  assert.equal(adequate.calendarSpanDays, 1095);
  assert.equal(adequate.pass, true);
  assert.equal(study.calendarDays('2020-01-01', '2022-12-30'), 1094);
});

test('status precedence is UNIDENTIFIABLE before UNDERPOWERED', () => {
  const identifiableTraining = [...syntheticRows('usa', 60), ...syntheticRows('europe', 60)];
  const underpowered = study.analyzeBuiltRows(builtFixture(identifiableTraining));
  assert.equal(underpowered.status, study.STATUS.UNDERPOWERED);

  const collinearTraining = [
    ...syntheticRows('usa', 60, { collinearFragility: true }),
    ...syntheticRows('europe', 60, { collinearFragility: true }),
  ];
  const unidentifiable = study.analyzeBuiltRows(builtFixture(collinearTraining));
  assert.equal(unidentifiable.status, study.STATUS.UNIDENTIFIABLE);
});

test('one-shot CLI refuses arguments and stops before opening input when the freeze gate fails', () => {
  assert.throws(() => study.parseCommand(['--input', 'alternate.json']), /accepts no arguments/);
  const source = study.main.toString();
  assert.doesNotMatch(source, /dependencies|\.\.\./);
  assert.ok(source.indexOf('assertProductionCodeFreeze(manifest)') < source.indexOf('readProductionInput(attempt, loadedReader)'));
});

test('runner and launcher stay free of schema-5 until the post-receipt loader', () => {
  const schemaPath = require.resolve('../research/fear_greed_v2_validation');
  assert.equal(require.cache[schemaPath], undefined);
  const fresh = childProcess.spawnSync(process.execPath, ['-e', [
    "const launcher=require('./research/component_fragility_tail_risk_launcher');",
    "const runner=require('./research/component_fragility_tail_risk');",
    "const target=require.resolve('./research/fear_greed_v2_validation');",
    "process.stdout.write(String(Boolean(require.cache[target])));",
  ].join('')], { cwd: study.REPO_ROOT, encoding: 'utf8' });
  assert.equal(fresh.status, 0, fresh.stderr);
  assert.equal(fresh.stdout, 'false');

  const direct = childProcess.spawnSync(process.execPath, ['research/component_fragility_tail_risk.js'], { cwd: study.REPO_ROOT, encoding: 'utf8' });
  assert.equal(direct.status, 2);
  assert.match(direct.stderr, /Direct runner execution is forbidden/);
});

test('only the built-in launcher can create the permanent production-attempt receipt', () => {
  assert.equal(study.publishPermanentAttemptReceipt, undefined);
  assert.equal(study.reserveProductionAttempt, undefined);
  assert.equal(launcher.claimPermanentAttempt, undefined);
  assert.equal(launcher.main, undefined);
  assert.throws(() => launcher.claimSyntheticAttemptForTest({ root: study.REPO_ROOT }, { attemptId: 'repo-poison' }), /completed temporary-repository preflight/);
  assert.equal(launcher.ATTEMPT_SCOPE, study.ATTEMPT_RECEIPT_SCOPE);
  assert.equal(launcher.ATTEMPT_RELATIVE, study.ATTEMPT_RECEIPT_GIT_COMMON_RELATIVE);
  const runnerSource = fs.readFileSync(study.PATHS.runner, 'utf8');
  assert.doesNotMatch(runnerSource, /\.linkSync\s*\(/);
  const launcherSource = fs.readFileSync(study.PATHS.launcher, 'utf8');
  assert.match(launcherSource, /\.linkSync\s*\(/);
});

test('launcher rejects preload and NODE_OPTIONS execution before Git preflight', t => {
  const directory = temporaryDirectory(t, 'component-fragility-preload');
  const preload = path.join(directory, 'preload.js');
  fs.writeFileSync(preload, "'use strict'; global.__componentFragilityPreloaded=true;\n");
  const launcherPath = path.join('research', 'component_fragility_tail_risk_launcher.js');
  const preloaded = childProcess.spawnSync(process.execPath, ['-r', preload, launcherPath], { cwd: study.REPO_ROOT, encoding: 'utf8' });
  assert.equal(preloaded.status, 2);
  assert.match(preloaded.stderr, /rejects Node preload/);

  const withNodeOptions = childProcess.spawnSync(process.execPath, [launcherPath], {
    cwd: study.REPO_ROOT,
    encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '--trace-warnings' },
  });
  assert.equal(withNodeOptions.status, 2);
  assert.match(withNodeOptions.stderr, /rejects nonempty NODE_OPTIONS/);
});

test('synthetic claim cannot poison the production repository common-directory receipt', t => {
  const fixture = copyFrozenTagFixture(t);
  const productionCommonDirectory = path.resolve(git(study.REPO_ROOT, ['rev-parse', '--path-format=absolute', '--git-common-dir']));
  const productionReceiptPath = path.join(productionCommonDirectory, ...launcher.ATTEMPT_RELATIVE.split('/'));
  const redirectedExec = (file, args, options) => {
    if (args.includes('--git-common-dir')) return `${productionCommonDirectory}\n`;
    return childProcess.execFileSync(file, args, options);
  };
  if (fs.existsSync(productionReceiptPath)) {
    // The production one-shot attempt was already claimed on this repository:
    // preflight must refuse retry and the permanent receipt must stay untouched.
    const claimedBytes = fs.readFileSync(productionReceiptPath);
    assert.throws(() => launcher.preflight({ directory: fixture.directory, requireLinkedWorktree: false, expectedRepoRoot: null, execFileSync: redirectedExec }), /retry is forbidden/);
    assert.ok(fs.readFileSync(productionReceiptPath).equals(claimedBytes));
    return;
  }
  const freeze = launcher.preflight({ directory: fixture.directory, requireLinkedWorktree: false, expectedRepoRoot: null, execFileSync: redirectedExec });
  assert.equal(path.resolve(freeze.commonDirectory), productionCommonDirectory);
  assert.throws(() => launcher.claimSyntheticAttemptForTest(freeze, { attemptId: 'production-common-poison' }), /outside the production repository/);
  assert.equal(fs.existsSync(productionReceiptPath), false);
});

test('launcher orders freeze, permanent receipt, then runner load', () => {
  const source = fs.readFileSync(study.PATHS.launcher, 'utf8');
  const mainAt = source.indexOf('function main(');
  const mainEnd = source.indexOf('\n}\n\nmodule.exports', mainAt);
  const mainSource = source.slice(mainAt, mainEnd + 2);
  assert.doesNotMatch(mainSource, /dependencies|\.\.\./);
  const invocationAt = mainSource.indexOf('assertCleanDirectInvocation(argv)');
  const freezeAt = mainSource.indexOf('preflight()');
  const receiptAt = mainSource.indexOf('claimPermanentAttempt(freeze, { invocation })');
  const runnerAt = mainSource.indexOf("require('./component_fragility_tail_risk')");
  const invokeAt = mainSource.indexOf('runner.main([], attempt)');
  assert.ok(mainAt >= 0 && mainEnd > mainAt && invocationAt >= 0 && invocationAt < freezeAt && freezeAt < receiptAt && receiptAt < runnerAt && runnerAt < invokeAt);
});

test('eight launchers across two linked worktrees share one repository-global receipt winner', async t => {
  const fixture = copyFrozenLinkedWorktreeFixture(t);
  const winnersPath = path.join(fixture.parent, 'winners.txt');
  const helperPath = path.join(fixture.parent, 'claim.js');
  fs.writeFileSync(helperPath, [
    "'use strict';",
    "const fs=require('node:fs');",
    "const launcher=require(process.argv[4]);",
    "let freeze;",
    "try { freeze=launcher.preflight({directory:process.argv[2],expectedRepoRoot:null}); }",
    "catch (error) { process.exit(error && error.code==='INTEGRITY_ERROR' ? 2 : 3); }",
    "process.send('READY');",
    "process.once('message',message=>{",
    " if(message!=='CLAIM') process.exit(4);",
    " try {",
    "  launcher.claimSyntheticAttemptForTest(freeze,{attemptId:'attempt-'+process.pid});",
    "  fs.appendFileSync(process.argv[3],freeze.root+'\\n');",
    "  process.exit(0);",
    " } catch (error) { process.exit(error && error.code==='INTEGRITY_ERROR' ? 2 : 3); }",
    "});",
  ].join('\n'));
  const launcherPath = path.join(study.REPO_ROOT, 'research', 'component_fragility_tail_risk_launcher.js');
  const children = Array.from({ length: 8 }, (_, index) => {
    const worktree = index % 2 === 0 ? fixture.worktreeA : fixture.worktreeB;
    const child = childProcess.spawn(process.execPath, [helperPath, worktree, winnersPath, launcherPath], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
    let readySeen = false;
    const ready = new Promise((resolve, reject) => {
      child.on('message', message => {
        if (message === 'READY' && !readySeen) {
          readySeen = true;
          resolve();
        }
      });
      child.on('exit', code => {
        if (!readySeen) reject(new Error(`launcher exited ${code} before the shared race barrier`));
      });
    });
    const exited = new Promise(resolve => child.on('exit', code => resolve(code)));
    return { child, ready, exited };
  });
  await Promise.all(children.map(item => item.ready));
  for (const item of children) item.child.send('CLAIM');
  const codes = await Promise.all(children.map(item => item.exited));
  assert.equal(codes.filter(code => code === 0).length, 1);
  assert.equal(codes.filter(code => code === 2).length, 7);
  const winners = fs.readFileSync(winnersPath, 'utf8').trim().split(/\r?\n/);
  assert.equal(winners.length, 1);
  const winningWorktree = path.resolve(winners[0]);
  assert.ok([path.resolve(fixture.worktreeA), path.resolve(fixture.worktreeB)].includes(winningWorktree));
  const receiptPath = path.join(fixture.commonDirectory, ...launcher.ATTEMPT_RELATIVE.split('/'));
  const receiptBytes = fs.readFileSync(receiptPath);
  const receipt = JSON.parse(receiptBytes.toString('utf8'));
  assert.equal(receipt.phase, 'CLAIMED_BEFORE_SCHEMA5_LOAD_OR_INPUT_OPEN');
  assert.equal(receipt.experimentId, 'component-fragility-tail-v1');
  assert.equal(receipt.invocation.kind, 'SYNTHETIC_TEST_NOT_PRODUCTION');
  assert.equal(receipt.status, 'PERMANENT_ONE_SHOT_ATTEMPT_RESERVED_BEFORE_INPUT_PARSE');
  assert.equal(path.resolve(receipt.repositoryScope.commonDirectory), fixture.commonDirectory);
  assert.equal(path.resolve(receipt.repositoryScope.receiptPath), path.resolve(receiptPath));
  assert.equal(receipt.repositoryScope.relativePath, launcher.ATTEMPT_RELATIVE);
  assert.equal(receipt.repositoryScope.scope, launcher.ATTEMPT_SCOPE);
  assert.equal(path.resolve(receipt.winningWorktree.root), winningWorktree);
  assert.equal(path.resolve(receipt.winningWorktree.gitDirectory), path.resolve(git(winningWorktree, ['rev-parse', '--path-format=absolute', '--git-dir'])));
  assert.equal(path.resolve(receipt.intendedPublication.absoluteDirectory), path.join(winningWorktree, ...launcher.OUTPUT_DIRECTORY_RELATIVE.split('/')));
  assert.equal(receiptBytes.toString('utf8'), launcher.canonicalJson(receipt));
  for (const worktree of [fixture.worktreeA, fixture.worktreeB]) {
    assert.equal(fs.existsSync(path.join(worktree, ...launcher.ATTEMPT_RELATIVE.split('/'))), false);
    assert.equal(fs.existsSync(path.join(worktree, 'research', 'local-artifacts', 'component-fragility-tail-v1-attempt-receipt-2026-08-26.json')), false);
  }
  const losingWorktree = winningWorktree === path.resolve(fixture.worktreeA) ? fixture.worktreeB : fixture.worktreeA;
  assert.throws(() => launcher.preflight({ directory: losingWorktree, expectedRepoRoot: null }), /repository-global permanent one-shot attempt receipt already exists/);
});

test('an existing or failed hard-link receipt fails closed and is never repaired', t => {
  const corruptFixture = copyFrozenTagFixture(t);
  const corruptFreeze = launcher.preflight({ directory: corruptFixture.directory, requireLinkedWorktree: false, expectedRepoRoot: null });
  const corruptPath = path.join(corruptFreeze.commonDirectory, ...launcher.ATTEMPT_RELATIVE.split('/'));
  fs.mkdirSync(path.dirname(corruptPath), { recursive: true });
  fs.writeFileSync(corruptPath, '');
  assert.throws(() => launcher.claimSyntheticAttemptForTest(corruptFreeze, { attemptId: 'corrupt-test' }), /already exists/);
  assert.equal(fs.readFileSync(corruptPath, 'utf8'), '');

  const collisionFixture = copyFrozenTagFixture(t);
  const collisionFreeze = launcher.preflight({ directory: collisionFixture.directory, requireLinkedWorktree: false, expectedRepoRoot: null });
  const collisionReceipt = path.join(collisionFreeze.commonDirectory, ...launcher.ATTEMPT_RELATIVE.split('/'));
  const collisionTemporary = `${collisionReceipt}.tmp-77-owned-by-other`;
  fs.mkdirSync(path.dirname(collisionTemporary), { recursive: true });
  fs.writeFileSync(collisionTemporary, 'foreign staged receipt');
  assert.throws(() => launcher.claimSyntheticAttemptForTest(collisionFreeze, { processId: 77, attemptId: 'owned-by-other' }), /exclusively create/);
  assert.equal(fs.readFileSync(collisionTemporary, 'utf8'), 'foreign staged receipt');
  assert.equal(fs.existsSync(collisionReceipt), false);

  const failedFixture = copyFrozenTagFixture(t);
  const failedFreeze = launcher.preflight({ directory: failedFixture.directory, requireLinkedWorktree: false, expectedRepoRoot: null });
  const failedPath = path.join(failedFreeze.commonDirectory, ...launcher.ATTEMPT_RELATIVE.split('/'));
  const failingIo = { ...fs, linkSync() { const error = new Error('synthetic link failure'); error.code = 'EPERM'; throw error; } };
  assert.throws(() => launcher.claimSyntheticAttemptForTest(failedFreeze, { io: failingIo, attemptId: 'link-failure' }), /hard-link/);
  assert.equal(fs.existsSync(failedPath), false);
  assert.deepEqual(fs.readdirSync(path.dirname(failedPath)), []);
});

test('canonical manifest is bound to an annotated tag, HEAD, clean bytes, SHA-256, and Git blobs', t => {
  const actualManifest = study.readFreezeManifest();
  assert.equal(actualManifest.manifest.requiredAnnotatedTag, study.FIXED_PREOUTCOME_TAG);
  assert.deepEqual(actualManifest.manifest.files.map(entry => entry.path), launcher.EXPECTED_FILE_PATHS);
  const fixture = copyFrozenTagFixture(t);
  const fixtureEvidence = study.readFreezeManifest({ manifestPath: fixture.manifestTarget });
  const frozen = study.assertProductionCodeFreeze(fixtureEvidence, { directory: fixture.directory, requireLinkedWorktree: false, expectedRepoRoot: null });
  assert.equal(frozen.tag, study.FIXED_PREOUTCOME_TAG);
  assert.equal(frozen.tagCommit, git(fixture.directory, ['rev-parse', 'HEAD']));
  assert.doesNotThrow(() => launcher.preflight({ directory: fixture.directory, requireLinkedWorktree: false, expectedRepoRoot: null }));

  git(fixture.directory, ['tag', '-d', study.FIXED_PREOUTCOME_TAG]);
  git(fixture.directory, ['tag', study.FIXED_PREOUTCOME_TAG]);
  assert.throws(() => launcher.preflight({ directory: fixture.directory, requireLinkedWorktree: false, expectedRepoRoot: null }), /annotated/);
  git(fixture.directory, ['tag', '-d', study.FIXED_PREOUTCOME_TAG]);
  git(fixture.directory, ['tag', '-a', study.FIXED_PREOUTCOME_TAG, '-m', 'restored synthetic tag']);

  fs.appendFileSync(path.join(fixture.directory, 'research', 'component_fragility_tail_risk.js'), '\n// synthetic dirty byte\n');
  assert.throws(() => study.assertProductionCodeFreeze(fixtureEvidence, { directory: fixture.directory, requireLinkedWorktree: false, expectedRepoRoot: null }), /uncommitted changes|dirty/);
});

test('runner repeats receipt verification before lazy schema loading or input access', () => {
  const source = study.main.toString();
  const freezeAt = source.indexOf('assertProductionCodeFreeze(manifest)');
  const receiptAt = source.indexOf('verifyClaimedAttemptReceipt(launcherAttemptEvidence, freeze)');
  const schemaAt = source.indexOf('loadSchema5Reader(attempt)');
  const inputAt = source.indexOf('readProductionInput(attempt, loadedReader)');
  const analysisAt = source.indexOf('analyzeProductionEvidence(evidence, codeEvidence)');
  assert.ok(freezeAt >= 0 && freezeAt < receiptAt && receiptAt < schemaAt && schemaAt < inputAt && inputAt < analysisAt);
  assert.equal(study.publishProductionResult, undefined);
  assert.equal(study.writeProductionResult, undefined);
  assert.equal(study.writeAndFsyncNewFile, undefined);
  assert.equal(study.verifyClaimedAttemptReceipt, undefined);
  assert.equal(study.loadSchema5Reader, undefined);
  assert.equal(study.verifyInputBytesBeforeParse, undefined);
  assert.equal(study.readProductionInput, undefined);
  assert.equal(study.analyzeProductionEvidence, undefined);
});

test('transactional publication exposes the exact pair together and cleans a failed stage', t => {
  const directory = temporaryDirectory(t, 'component-fragility-publication');
  const outputDirectory = path.join(directory, 'complete-bundle');
  const result = { schema: 'synthetic-result', status: 'SYNTHETIC', value: 1.25 };
  const published = study.publishSyntheticResultForTest(result, { outputDirectory, processId: 7, nonce: 'success' });
  assert.equal(published.directory, outputDirectory);
  const names = fs.readdirSync(outputDirectory).sort();
  assert.deepEqual(names, [path.basename(study.PATHS.output), path.basename(study.PATHS.outputSidecar)].sort());
  const resultBytes = fs.readFileSync(path.join(outputDirectory, path.basename(study.PATHS.output)));
  assert.equal(resultBytes.toString('utf8'), study.canonicalJson(result));
  assert.equal(fs.readFileSync(path.join(outputDirectory, path.basename(study.PATHS.outputSidecar)), 'utf8'), `${study.sha256(resultBytes)}  ${path.basename(study.PATHS.output)}\n`);

  const failedOutput = path.join(directory, 'failed-bundle');
  const failingIo = { ...fs, renameSync() { const error = new Error('synthetic rename failure'); error.code = 'EIO'; throw error; } };
  assert.throws(() => study.publishSyntheticResultForTest(result, { io: failingIo, outputDirectory: failedOutput, processId: 8, nonce: 'failure' }), /publication failed/);
  assert.equal(fs.existsSync(failedOutput), false);
  assert.deepEqual(fs.readdirSync(directory).filter(name => name.includes('.failed-bundle.staging-')), []);
  assert.throws(() => study.publishSyntheticResultForTest(result, { outputDirectory: study.PATHS.outputDirectory }), /outside the repository/);
  assert.throws(() => study.publishSyntheticResultForTest(result, { outputDirectory: path.join(study.PATHS.outputDirectory, 'child') }), /outside the repository/);
});

test('every nonfinite HAC statistic becomes null, including positive-LRV SE underflow', () => {
  const overflow = study.neweyWestMeanTest21(Array.from({ length: 30 }, (_, index) => index % 2 ? 1e308 : -1e308));
  for (const key of ['mean', 'lrv', 'standardError', 'z', 'pValueOneSidedPositive']) assert.ok(overflow[key] === null || Number.isFinite(overflow[key]));
  assert.doesNotThrow(() => study.canonicalJson(overflow));

  const underflowValues = Array(30).fill(0);
  underflowValues[0] = 1e-161;
  const underflow = study.neweyWestMeanTest21(underflowValues);
  assert.ok(underflow.lrv === null || Number.isFinite(underflow.lrv));
  assert.equal(underflow.standardError, 0);
  assert.equal(underflow.z, null);
  assert.equal(underflow.pValueOneSidedPositive, null);
  assert.doesNotThrow(() => study.canonicalJson(underflow));

  const lrvUnderflow = study.neweyWestMeanTest21(Array.from({ length: 30 }, (_, index) => index % 2 ? 1e-200 : 2e-200));
  assert.equal(lrvUnderflow.lrv, 0);
  assert.equal(lrvUnderflow.standardError, null);
  assert.equal(lrvUnderflow.z, null);
  assert.equal(lrvUnderflow.pValueOneSidedPositive, null);
  assert.equal(study.neweyWestMeanTest21(Array(30).fill(1e-200)).pValueOneSidedPositive, 0);
});

test('relative MSE improvement overflow becomes a failed numeric gate, not noncanonical infinity', () => {
  const row = {
    outcome: 0,
    entryDate: '2019-01-01',
    exitDate: '2019-01-02',
    entryIndex: 0,
    exitIndex: 1,
  };
  const evaluated = study.evaluateMarket('usa', [row], {
    m0: { predict: () => Math.sqrt(Number.MIN_VALUE) },
    m1: { predict: () => 1 },
  });
  assert.equal(evaluated.metrics.mseM0, Number.MIN_VALUE);
  assert.equal(evaluated.metrics.mseM1, 1);
  assert.equal(evaluated.metrics.relativeImprovement, null);
  assert.equal(evaluated.metrics.finitePredictionsErrorsAndMse, false);
  assert.doesNotThrow(() => study.canonicalJson(evaluated));
});

test('adequate rows with unusable finite-number inference terminate as NO_SIGNAL, not integrity error', () => {
  const training = [...syntheticRows('usa', 60), ...syntheticRows('europe', 60)];
  const built = builtFixture(training, 756);
  for (const market of study.MARKET_ORDER) built.evaluation[market].forEach((row, index) => { row.outcome = index % 2 ? 8e153 : -8e153; });
  const result = study.analyzeBuiltRows(built);
  assert.equal(result.status, study.STATUS.NO_SIGNAL);
  assert.equal(result.gate.adequateFiveOfFive, true);
  assert.equal(result.gate.pass, false);
  assert.doesNotThrow(() => study.canonicalJson(result));
});
