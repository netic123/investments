#!/usr/bin/env node
'use strict';

// Open a GitHub issue when the snapshot just built shows a new trade, so the
// repository owner is told by GitHub itself (the issue mentions the owner;
// GitHub's e-mail and app notifications do the rest). Runs in the build job of
// .github/workflows/pages.yml after the snapshot is written, with the
// workflow's own GITHUB_TOKEN (issues: write); no third party is involved.
//
// One issue per file-to-file interval that lists at least one trade (the same
// entries as api/trades.xml; unit flows and cash-like moves alone do not
// count). Each issue carries a hidden marker with the interval's file dates;
// before creating one, the existing "trade" issues (open or closed) are read
// and an interval that already has a marker is skipped, so a rebuild never
// notifies twice. Only the three newest intervals are considered, and when no
// trade issue exists at all only the newest, so the first run does not post
// the whole history. A failure to reach GitHub is a warning, never a failed
// build. --dry-run prints what would be created and calls nothing.

const fs = require('fs');
const path = require('path');
const { SITE_URL, tradeEntries } = require('./build-pages');

const API = 'https://api.github.com';
const LABEL = 'trade';
const MARKER = 'investments-trade';
const CONSIDER = 3;
const ROOT = path.resolve(__dirname, '..');

const markerOf = key => `<!-- ${MARKER}: ${key} -->`;
const markersIn = text => [...String(text || '').matchAll(new RegExp(`<!-- ${MARKER}: (\\d{4}-\\d{2}-\\d{2}/\\d{4}-\\d{2}-\\d{2}) -->`, 'g'))].map(m => m[1]);

// Which entries get an issue: on a first run (no marked issue anywhere) the newest traded interval only; afterwards the
// traded intervals newer than the newest one already marked (up to CONSIDER, so a chain that died for a day catches up),
// never an older one — sessions that were on the page before the notifier existed are not news.
function issuesToCreate(entries, existingKeys) {
  const traded = entries.filter(e => e && e.tradeCount > 0);
  const have = new Set(existingKeys);
  if (!have.size) return traded.slice(0, 1);
  const newestMarked = [...have].map(k => String(k).split('/')[1] || '').sort().pop();
  return traded.filter(e => !have.has(e.key) && e.to > newestMarked).slice(0, CONSIDER);
}

function issueFor(entry, { owner, siteUrl = SITE_URL, runUrl, fileDate }) {
  const title = `Pabrai trades, ${entry.session}: ${entry.lines.slice(0, entry.tradeCount).map(l => l.replace(/^([^:]+): (\S+(?: \S+)?) ([+-][\d,]+) shares.*$/, '$1 $2 $3')).join('; ')}`.slice(0, 200);
  const body = [
    `@${owner} — the fund’s file dated ${fileDate} shows trades in the ${entry.session}:`,
    '',
    ...entry.lines.map(l => `- ${l}`),
    '',
    `${entry.basis} Share-count changes between two official files after removing moves proportional to a unit creation or redemption; not trade tickets, so the exact time and price are unknown.`,
    '',
    `Page: ${siteUrl}#pabrai · Feed: ${siteUrl}api/trades.xml${runUrl ? ` · Build: ${runUrl}` : ''}`,
    '',
    markerOf(entry.key),
  ].join('\n');
  return { title, body, labels: [LABEL] };
}

function headers(token) {
  return { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'netic123-investments-notify/1.0', 'Content-Type': 'application/json' };
}

async function github(fetchImpl, token, url, init = {}) {
  const response = await fetchImpl(url, { ...init, headers: headers(token), signal: AbortSignal.timeout(30000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`${url.replace(API, '')} answered HTTP ${response.status}`);
  return response.json();
}

async function existingMarkers(fetchImpl, token, repo) {
  const keys = [];
  for (let page = 1; page <= 3; page++) {
    const list = await github(fetchImpl, token, `${API}/repos/${repo}/issues?labels=${LABEL}&state=all&per_page=100&page=${page}`);
    for (const issue of list || []) keys.push(...markersIn(issue.body));
    if (!list || list.length < 100) break;
  }
  return keys;
}

async function ensureLabel(fetchImpl, token, repo) {
  const label = await github(fetchImpl, token, `${API}/repos/${repo}/labels/${LABEL}`);
  if (label) return false;
  await github(fetchImpl, token, `${API}/repos/${repo}/labels`, { method: 'POST', body: JSON.stringify({ name: LABEL, color: '7a4a22', description: 'A trade shown by the fund’s daily holdings file (opened by the build)' }) });
  return true;
}

async function notifyTrades({ siteDir = path.join(ROOT, '_site'), token = process.env.GITHUB_TOKEN, repo = process.env.GITHUB_REPOSITORY || 'netic123/investments', runUrl = process.env.BUILD_RUN_URL || null, dryRun = false, fetchImpl = fetch, log = () => {} } = {}) {
  const api = path.join(siteDir, 'api');
  const holdings = JSON.parse(fs.readFileSync(path.join(api, 'holdings.json'), 'utf8'));
  const nav = JSON.parse(fs.readFileSync(path.join(api, 'nav.json'), 'utf8'));
  const build = fs.existsSync(path.join(api, 'build.json')) ? JSON.parse(fs.readFileSync(path.join(api, 'build.json'), 'utf8')) : {};
  const entries = tradeEntries(holdings, nav, { generatedAt: build.generatedAt });
  const owner = String(repo).split('/')[0];
  const fileDate = holdings.latest && holdings.latest.date ? holdings.latest.date : 'unknown';
  if (dryRun) {
    const would = issuesToCreate(entries, []);
    for (const e of would) { const issue = issueFor(e, { owner, runUrl, fileDate }); log(`would create (first-run rule): ${issue.title}\n${issue.body}\n`); }
    return { created: [], skipped: entries.filter(e => e.tradeCount > 0).length, dryRun: true };
  }
  if (!token) throw new Error('GITHUB_TOKEN is not set');
  const existing = await existingMarkers(fetchImpl, token, repo);
  const todo = issuesToCreate(entries, existing);
  if (!todo.length) { log(`no new trade to report (${existing.length} marked issue${existing.length === 1 ? '' : 's'} exist; newest interval ${entries[0] ? entries[0].key : 'none'})`); return { created: [], skipped: 0 }; }
  if (await ensureLabel(fetchImpl, token, repo)) log(`created the "${LABEL}" label`);
  const created = [];
  for (const e of todo) {
    const issue = issueFor(e, { owner, runUrl, fileDate });
    const made = await github(fetchImpl, token, `${API}/repos/${repo}/issues`, { method: 'POST', body: JSON.stringify(issue) });
    created.push({ key: e.key, number: made && made.number, url: made && made.html_url });
    log(`opened issue #${made && made.number} for ${e.key}: ${issue.title}`);
  }
  return { created, skipped: 0 };
}

module.exports = { CONSIDER, LABEL, MARKER, issueFor, issuesToCreate, markerOf, markersIn, notifyTrades };

if (require.main === module) notifyTrades({ dryRun: process.argv.includes('--dry-run'), log: line => process.stdout.write(`${line}\n`) }).catch(error => {
  // never fail the build over a notification
  process.stdout.write(`::warning::trade notification skipped: ${error && error.message || error}\n`);
});
