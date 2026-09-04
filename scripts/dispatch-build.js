#!/usr/bin/env node
'use strict';

// Start a public-snapshot build from anywhere: an external cron service, a
// shell, a scheduled task. It sends the same workflow_dispatch that the page's
// owner-only "Update (rebuild)" button sends, so a build can be started on a
// clock the owner controls (GitHub starts this repository's scheduled runs
// late and skips most slots). The owner has decided against running one; the
// script stays available.
//
//   GITHUB_DISPATCH_TOKEN=github_pat_... node scripts/dispatch-build.js "external cron"
//
// The token is a fine-grained personal access token with repository access to
// netic123/investments only and the permission Actions: Read and write. That
// permission does more than start builds: whoever holds the token can also
// cancel, re-run and approve this repository's workflow runs, delete its runs,
// logs, artifacts and caches, and enable or disable its workflows (nothing
// outside Actions, and it cannot read or change code). Give it a short
// expiry; the signed attestations survive a deleted run. It is read from the
// environment and never written anywhere. A 204 answer means the build was
// queued (it runs behind any build already in progress, because the
// workflow's concurrency group serialises them); the reason is recorded in
// api/build.json and shown in the page's About line, so it is public text.
// The build skips the test suite only when a successful tested run of the
// same commit already exists (the workflow's gate step checks).

const token = process.env.GITHUB_DISPATCH_TOKEN;
const repo = process.env.GITHUB_DISPATCH_REPO || 'netic123/investments';
const reason = process.argv[2] || 'external cron';

if (!token || !token.trim()) {
  process.stderr.write('GITHUB_DISPATCH_TOKEN is not set (a fine-grained token with Actions: read and write on the repository)\n');
  process.exit(2);
}

(async () => {
  const response = await fetch(`https://api.github.com/repos/${repo}/actions/workflows/pages.yml/dispatches`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token.trim()}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'netic123-investments-dispatch/1.0',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main', inputs: { skip_tests: 'true', reason } }),
    signal: AbortSignal.timeout(20000),
  });
  if (response.status === 204) {
    // 204 only means the dispatch was accepted; whether the build ran and
    // what it published is visible in the page's Build history and api/build.json.
    process.stdout.write(`build requested for ${repo} (${reason})\n`);
    return;
  }
  const body = (await response.text()).slice(0, 300);
  process.stderr.write(`GitHub answered HTTP ${response.status}: ${body}\n`);
  process.exit(1);
})().catch(error => {
  process.stderr.write(`dispatch failed: ${error && error.message || error}\n`);
  process.exit(1);
});
