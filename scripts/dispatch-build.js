#!/usr/bin/env node
'use strict';

// Start a public-snapshot build from anywhere: an external cron service, a
// shell, a scheduled task. It sends the same workflow_dispatch that the page's
// owner-only "Update (rebuild)" button sends, so GitHub's own scheduler (which
// has started this repository's scheduled runs hours late) is not needed.
//
//   GITHUB_DISPATCH_TOKEN=github_pat_... node scripts/dispatch-build.js "external cron"
//
// The token is a fine-grained personal access token with repository access to
// netic123/investments only and the permission Actions: Read and write. It is
// read from the environment and never written anywhere. A 204 answer means the
// build was queued (it runs behind any build already in progress, because the
// workflow's concurrency group serialises them); the reason is recorded in
// api/build.json and shown in the page's About line.

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
