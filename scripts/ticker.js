#!/usr/bin/env node
'use strict';

// The ticker (.github/workflows/ticker.yml): one run of a chain. It has
// already waited on the "ticker" environment's wait timer when this script
// starts. It then
//   1. reads the published snapshot (api/build.json, holdings.json, nav.json)
//      and asks the fund's server for its holdings file (HEAD: ETag,
//      Last-Modified) and its DailyNAV file (the rate date);
//   2. starts a Pages build (workflow_dispatch of pages.yml, skip_tests=true,
//      honoured only when a tested run of the commit exists) when the fund
//      published a newer holdings or NAV file than the snapshot carries, or
//      the snapshot is older than REBUILD_AFTER_HOURS; not when a build is
//      already queued or running;
//   3. dispatches the next run of the chain, unless another run of the
//      chain is already waiting, queued or running, or the environment has
//      no wait timer of at least MIN_WAIT_MINUTES (then it says so and stops:
//      a missing timer must not become a tight loop).
// With --kick-only it does step 3 alone (pages.yml runs it after every
// successful build, so a chain that died is restarted by the next build).
// The token is the workflow's own GITHUB_TOKEN; it is sent to api.github.com
// only and never printed. Every decision is written to the step summary.

const fs = require('fs');
const path = require('path');

const API = 'https://api.github.com';
const MIN_WAIT_MINUTES = 10;
const REBUILD_AFTER_HOURS = 3;
const ALIVE = new Set(['waiting', 'queued', 'in_progress', 'requested', 'pending']);

function headers(token, extra = {}) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'netic123-investments-ticker/1.0',
    ...extra,
  };
}

async function github(fetchImpl, token, url, init = {}) {
  const response = await fetchImpl(url, { ...init, headers: headers(token, init.headers || {}), signal: AbortSignal.timeout(30000) });
  if (response.status === 204) return null;
  if (!response.ok) throw new Error(`${url.replace(API, '')} answered HTTP ${response.status}`);
  return response.json();
}

// The environment's wait timer in minutes; null when the environment or the rule does not exist (or cannot be read).
async function waitTimerMinutes(fetchImpl, token, repo, name) {
  try {
    const env = await github(fetchImpl, token, `${API}/repos/${repo}/environments/${encodeURIComponent(name)}`);
    const rule = ((env && env.protection_rules) || []).find(r => r && r.type === 'wait_timer');
    const minutes = rule ? Number(rule.wait_timer) : NaN;
    return Number.isFinite(minutes) ? minutes : null;
  } catch {
    return null;
  }
}

// Runs of a workflow that are waiting on a timer, queued or running (the 30 newest are enough: a chain has one alive run).
async function aliveRuns(fetchImpl, token, repo, workflow) {
  const list = await github(fetchImpl, token, `${API}/repos/${repo}/actions/workflows/${workflow}/runs?per_page=30`);
  return ((list && list.workflow_runs) || []).filter(run => ALIVE.has(run.status));
}

async function dispatch(fetchImpl, token, repo, workflow, inputs) {
  await github(fetchImpl, token, `${API}/repos/${repo}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ref: 'main', inputs }),
  });
}

// The DailyNAV file's rate date (MM/DD/YYYY in the "Rate Date" column) as an ISO date, or null.
function navRateDate(csv) {
  const lines = String(csv || '').trim().split(/\r?\n/);
  if (lines.length < 2) return null;
  const cols = lines[0].split(','), i = cols.findIndex(c => c.trim() === 'Rate Date');
  const cell = i >= 0 ? (lines[1].split(',')[i] || '').trim() : '';
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(cell);
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

// Why a build is due, or null. Pure: every input is a fact already fetched.
function buildDecision({ build, holdings, nav, holdingsHead, navDate, now }) {
  const source = (holdings && holdings.source) || {};
  if (holdingsHead) {
    if (holdingsHead.etag && source.etag && holdingsHead.etag !== source.etag) return `the fund serves a holdings file with a new ETag (${holdingsHead.etag}; the snapshot carries ${source.etag})`;
    if (!holdingsHead.etag && holdingsHead.lastModified && source.lastModified && holdingsHead.lastModified !== source.lastModified) return `the fund serves a holdings file modified ${holdingsHead.lastModified} (the snapshot carries ${source.lastModified})`;
  }
  if (navDate && nav && nav.date && navDate > nav.date) return `the fund serves a NAV file dated ${navDate} (the snapshot carries ${nav.date})`;
  const built = build && Date.parse(build.generatedAt);
  if (!Number.isFinite(built)) return 'the published build time cannot be read';
  const ageHours = (now - built) / 36e5;
  if (ageHours > REBUILD_AFTER_HOURS) return `the snapshot is ${ageHours.toFixed(1)} h old (rebuilt after ${REBUILD_AFTER_HOURS} h so quotes and market bars move on)`;
  return null;
}

// Whether this run may dispatch the next: the timer must exist and be long enough, and no other run of the chain may be alive.
function chainPlan({ waitMinutes, aliveOthers, environment }) {
  if (waitMinutes == null) return { dispatch: false, reason: `environment "${environment}" has no wait timer (create it under Settings → Environments with a wait timer of at least ${MIN_WAIT_MINUTES} minutes); not re-dispatching` };
  if (waitMinutes < MIN_WAIT_MINUTES) return { dispatch: false, reason: `environment "${environment}" waits ${waitMinutes} min, under the ${MIN_WAIT_MINUTES}-minute floor; not re-dispatching` };
  if (aliveOthers.length) return { dispatch: false, reason: `another run of the chain is alive (${aliveOthers.map(r => `${r.id} ${r.status}`).join(', ')}); not re-dispatching` };
  return { dispatch: true, reason: `next tick in about ${waitMinutes} min` };
}

async function fetchText(fetchImpl, url, init = {}) {
  const response = await fetchImpl(url, { ...init, headers: { 'User-Agent': 'netic123-investments-ticker/1.0', 'Cache-Control': 'no-cache', ...(init.headers || {}) }, signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  return response;
}

async function main() {
  const fetchImpl = fetch;
  const token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY || 'netic123/investments';
  const environment = process.env.TICKER_ENVIRONMENT || 'ticker', publishedApi = (process.env.PUBLISHED_API || 'https://netic123.github.io/investments/api').replace(/\/$/, '');
  const kickOnly = process.argv.includes('--kick-only');
  const hop = Number(process.env.TICKER_HOP) || 0, runId = String(process.env.GITHUB_RUN_ID || '');
  const lines = [];
  const say = line => { lines.push(line); process.stdout.write(`${line}\n`); };
  if (!token) throw new Error('GITHUB_TOKEN is not set');

  if (!kickOnly) {
    const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'config.json'), 'utf8'));
    const sources = config.sources || {};
    let decision, detail;
    try {
      const [build, holdings, nav] = await Promise.all(['build', 'holdings', 'nav'].map(name => fetchText(fetchImpl, `${publishedApi}/${name}.json`).then(r => r.json())));
      const head = await fetchText(fetchImpl, sources.holdings, { method: 'HEAD' });
      const holdingsHead = { etag: head.headers.get('etag') || null, lastModified: head.headers.get('last-modified') || null };
      const navCsv = await fetchText(fetchImpl, sources.navDaily).then(r => r.text());
      decision = buildDecision({ build, holdings, nav, holdingsHead, navDate: navRateDate(navCsv), now: Date.now() });
      detail = `snapshot built ${build.generatedAt} (commit ${String(build.commit || '').slice(0, 7)}), holdings file dated ${holdings.latest && holdings.latest.date} (ETag ${holdingsHead.etag}), NAV ${nav.date}, fund NAV file ${navRateDate(navCsv)}`;
    } catch (error) {
      decision = `the check itself failed (${error && error.message || error}); building so the snapshot cannot silently age`;
      detail = 'one of the published files or the fund\'s server could not be read';
    }
    say(`Tick ${hop}: ${detail}`);
    if (decision) {
      const building = await aliveRuns(fetchImpl, token, repo, 'pages.yml');
      if (building.length) say(`A build is due (${decision}) but one is already ${building[0].status} (run ${building[0].id}); not starting another`);
      else {
        await dispatch(fetchImpl, token, repo, 'pages.yml', { skip_tests: 'true', reason: `ticker: ${decision}`.slice(0, 200) });
        say(`Build requested: ${decision}`);
      }
    } else say('No build due: the snapshot carries the fund\'s current files and is fresh');
  }

  const waitMinutes = await waitTimerMinutes(fetchImpl, token, repo, environment);
  const aliveOthers = (await aliveRuns(fetchImpl, token, repo, 'ticker.yml')).filter(run => String(run.id) !== runId);
  const plan = chainPlan({ waitMinutes, aliveOthers, environment });
  if (plan.dispatch) {
    await dispatch(fetchImpl, token, repo, 'ticker.yml', { hop: String(kickOnly ? 0 : hop + 1) });
    say(`${kickOnly ? 'Chain started' : 'Next tick dispatched'}: ${plan.reason}`);
  } else say(`${kickOnly ? 'No chain started' : 'Chain ends here'}: ${plan.reason}`);
  if (process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${lines.map(l => `- ${l}`).join('\n')}\n`);
}

module.exports = { ALIVE, MIN_WAIT_MINUTES, REBUILD_AFTER_HOURS, buildDecision, chainPlan, navRateDate, waitTimerMinutes, aliveRuns };

if (require.main === module) main().catch(error => {
  process.stderr.write(`ticker failed: ${error && error.stack || error}\n`);
  process.exitCode = 1;
});
