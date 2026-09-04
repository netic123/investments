#!/usr/bin/env node
'use strict';

// Decide whether the Pages build must run the test suite before it publishes.
//
// A push, the daily tested schedule slot and a dispatch that did not ask to
// skip the suite always run it. Every other trigger (the half-hourly weekday
// slots, the page's live update, the external cron) may skip it only when a
// completed, successful run of this workflow for the SAME commit actually
// executed the test step and that step passed. Nothing else counts: a push run
// that failed its tests, or a commit pushed with [skip ci], leaves the commit
// untested and the next slot runs the suite. When GitHub's API cannot be read
// the answer is "run the tests" (fail safe).
//
// Inputs are environment variables set by .github/workflows/pages.yml; the
// outputs are written to $GITHUB_OUTPUT as run_tests (true|false),
// tests_verified_by (the html_url of the run that proved the commit, or empty)
// and gate_reason (one sentence for the log). The token is only ever sent to
// api.github.com and is never printed.

const API = 'https://api.github.com';

function truthy(value) {
  return value === true || String(value || '').trim().toLowerCase() === 'true';
}

// The triggers that must run the suite regardless of history.
function testsRequired({ event, schedule, testedSchedule, skipTests }) {
  if (event === 'push') return 'a push always runs the suite';
  if (event === 'schedule' && testedSchedule && schedule === testedSchedule) return `the ${testedSchedule} slot always runs the suite`;
  if (event === 'workflow_dispatch' && !truthy(skipTests)) return 'the dispatch did not ask to skip the suite';
  return null;
}

async function githubJson(fetchImpl, token, url) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'netic123-investments-tests-gate/1.0',
    },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`${url.replace(API, '')} answered HTTP ${response.status}`);
  return response.json();
}

// A completed, successful run of pages.yml for this commit whose test step ran
// and passed; null when there is none. GitHub lists runs newest first and the
// proving run (the push, or the daily tested slot) is normally the OLDEST run
// for a commit, with every suite-skipping build stacked on top of it, so the
// listing is read in pages of 100, up to three pages.
const RUN_PAGE = 100;
const RUN_PAGES = 3;
async function findTestedRun({ repo, sha, workflow, stepName, token, fetchImpl }) {
  for (let page = 1; page <= RUN_PAGES; page++) {
    const runs = await githubJson(fetchImpl, token, `${API}/repos/${repo}/actions/workflows/${workflow}/runs?head_sha=${encodeURIComponent(sha)}&status=success&per_page=${RUN_PAGE}&page=${page}`);
    const list = (runs && runs.workflow_runs) || [];
    for (const run of list) {
      if (run.head_sha !== sha || run.conclusion !== 'success') continue;
      const jobs = await githubJson(fetchImpl, token, `${API}/repos/${repo}/actions/runs/${run.id}/jobs?per_page=100`);
      const proved = ((jobs && jobs.jobs) || []).some(job => job.conclusion === 'success'
        && (job.steps || []).some(step => step.name === stepName && step.conclusion === 'success'));
      if (proved) return { id: run.id, htmlUrl: run.html_url, event: run.event };
    }
    if (list.length < RUN_PAGE) break;
  }
  return null;
}

async function decideTests(options) {
  const { event, schedule, testedSchedule, skipTests, repo, sha, token, workflow = 'pages.yml', stepName, fetchImpl = fetch } = options;
  const required = testsRequired({ event, schedule, testedSchedule, skipTests });
  if (required) return { runTests: true, verifiedBy: null, reason: required };
  if (!token || !repo || !sha) return { runTests: true, verifiedBy: null, reason: 'no token, repository or commit to check the history with' };
  try {
    const run = await findTestedRun({ repo, sha, workflow, stepName, token, fetchImpl });
    if (run) return { runTests: false, verifiedBy: run.htmlUrl, reason: `commit ${sha.slice(0, 7)} passed the suite in run ${run.id} (${run.event})` };
    return { runTests: true, verifiedBy: null, reason: `no successful run of ${workflow} for commit ${sha.slice(0, 7)} ran the test step` };
  } catch (error) {
    return { runTests: true, verifiedBy: null, reason: `GitHub's API could not be read (${error && error.message || error}); running the suite` };
  }
}

async function main() {
  const decision = await decideTests({
    event: process.env.GITHUB_EVENT_NAME,
    schedule: process.env.EVENT_SCHEDULE,
    testedSchedule: process.env.TESTED_SCHEDULE,
    skipTests: process.env.SKIP_TESTS,
    repo: process.env.GITHUB_REPOSITORY,
    sha: process.env.GITHUB_SHA,
    token: process.env.GITHUB_TOKEN,
    stepName: process.env.TEST_STEP_NAME || 'Test repository-owned market models',
  });
  const lines = [
    `run_tests=${decision.runTests ? 'true' : 'false'}`,
    `tests_verified_by=${decision.verifiedBy || ''}`,
    `gate_reason=${decision.reason.replace(/[\r\n]+/g, ' ')}`,
  ];
  if (process.env.GITHUB_OUTPUT) require('fs').appendFileSync(process.env.GITHUB_OUTPUT, `${lines.join('\n')}\n`);
  process.stdout.write(`${lines.join('\n')}\n`);
}

module.exports = { decideTests, findTestedRun, testsRequired };

if (require.main === module) main().catch(error => {
  // Even an unexpected failure must not skip the suite.
  process.stdout.write(`run_tests=true\ntests_verified_by=\ngate_reason=gate failed (${error && error.message || error}); running the suite\n`);
  if (process.env.GITHUB_OUTPUT) require('fs').appendFileSync(process.env.GITHUB_OUTPUT, 'run_tests=true\ntests_verified_by=\n');
});
