#!/usr/bin/env node
'use strict';

// Keep a durable copy of the WAGN holdings history outside the chain of Pages
// deployments. The public api/holdings.json carries every receipt the builds
// have captured (each with the official file's SHA-256 and capture time), but
// only on the CDN: this script merges its provenance-bearing snapshots into the
// committed data/snapshots.json, which the next build reads as a seed. The
// record job in .github/workflows/pages.yml runs it after a push build and
// after the daily tested slot and commits the result with [skip ci].
//
//   node scripts/record-holdings-history.js <holdings.json path or the published URL> [--target data/snapshots.json]
//
// The target is written only when the merge adds or replaces a receipt, in
// the same one-space-indented form server.js uses for that file, and the
// script exits 0 either way; it exits 1 only when the source cannot be read.
// Legacy rows of the committed file (no provenance) are kept; a receipt from
// the source replaces a committed row of the same date only when it was
// captured later (mergeSnapshots).

const fs = require('fs');
const path = require('path');
const { PUBLISHED_HOLDINGS_URL, assertPublishedHoldingsUrl, mergeSnapshots, usableSnapshots } = require('./build-pages');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_TARGET = path.join(ROOT, 'data', 'snapshots.json');

async function readSource(source, fetchImpl) {
  if (/^https?:\/\//.test(source)) {
    assertPublishedHoldingsUrl(source);
    const response = await fetchImpl(source, {
      headers: { 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
      signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`${source} answered HTTP ${response.status}`);
    return response.json();
  }
  return JSON.parse(fs.readFileSync(source, 'utf8'));
}

function readTarget(target) {
  if (!fs.existsSync(target)) return [];
  const value = JSON.parse(fs.readFileSync(target, 'utf8'));
  if (!Array.isArray(value)) throw new Error(`${target} is not a JSON array of snapshots`);
  return value;
}

const digestOf = snapshot => (snapshot.source && snapshot.source.sha256) || null;

async function recordHoldingsHistory({ source, target = DEFAULT_TARGET, fetchImpl = fetch } = {}) {
  if (!source) throw new Error('a holdings.json path or the published URL is required');
  const published = usableSnapshots(await readSource(source, fetchImpl), { requireProvenance: true });
  const existingRaw = readTarget(target);
  const existing = usableSnapshots({ snapshots: existingRaw });
  const merged = mergeSnapshots(existing, published);
  const before = new Map(existing.map(snapshot => [snapshot.date, snapshot]));
  const added = merged.filter(snapshot => !before.has(snapshot.date)).map(snapshot => snapshot.date);
  const replaced = merged.filter(snapshot => before.has(snapshot.date) && digestOf(before.get(snapshot.date)) !== digestOf(snapshot)).map(snapshot => snapshot.date);
  const written = added.length > 0 || replaced.length > 0;
  if (written) {
    const tmp = `${target}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(merged, null, 1));
    fs.renameSync(tmp, target);
  }
  return { added, replaced, written, total: merged.length, sourceCount: published.length, target };
}

async function main() {
  const args = process.argv.slice(2);
  let source = null;
  let target = DEFAULT_TARGET;
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--target') target = path.resolve(args[++index]);
    else if (!source) source = args[index];
    else throw new Error(`unexpected argument: ${args[index]}`);
  }
  const result = await recordHoldingsHistory({ source: source || PUBLISHED_HOLDINGS_URL, target });
  const describe = list => (list.length ? list.join(', ') : 'none');
  process.stdout.write(`${result.written ? 'updated' : 'unchanged'} ${path.relative(ROOT, result.target) || result.target}: ${result.total} receipts (source carried ${result.sourceCount} with provenance); added ${describe(result.added)}; replaced ${describe(result.replaced)}\n`);
}

module.exports = { recordHoldingsHistory };

if (require.main === module) main().catch(error => {
  process.stderr.write(`record-holdings-history failed: ${error && error.message || error}\n`);
  process.exitCode = 1;
});
