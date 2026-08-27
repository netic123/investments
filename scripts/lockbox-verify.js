'use strict';

// EUROPE-LOCKBOX-V1 verifier. Network-free. Verifies, over the whole store:
// sidecar hashes, the genesis-anchored SHA-256 chain (any edit to a past entry
// breaks every later link), filename/entryDate agreement, schema and required
// fields, cross-entry instrument consistency (same date should carry the same
// close; provider revisions are reported as warnings, never silently adopted —
// the first recorded value stays primary), and reports progress toward the
// candidate's >= 60 prospective monthly decisions.
//   node scripts/lockbox-verify.js

const fs = require('fs');
const path = require('path');
const collect = require('./lockbox-collect.js');

function readVerified(file) {
  const bytes = fs.readFileSync(file);
  const sidecar = fs.readFileSync(`${file}.sha256`, 'utf8');
  const digest = collect.sha256(bytes);
  if (!sidecar.startsWith(digest)) throw new Error(`${path.basename(file)}: sidecar hash mismatch`);
  return { bytes, json: JSON.parse(bytes.toString('utf8')), digest };
}

function verifyLockbox(lockboxDir = collect.LOCKBOX_DIR) {
  const entriesDir = path.join(lockboxDir, 'entries');
  const genesisPath = path.join(lockboxDir, 'GENESIS.json');
  const warnings = [];
  const genesis = readVerified(genesisPath);
  if (genesis.json.schema !== 'europe-lockbox-genesis-v1') throw new Error('genesis schema mismatch');

  const dates = collect.listEntryDates(entriesDir);
  let previousDigest = genesis.digest;
  let previousLabel = 'GENESIS';
  let previousDate = null;
  const closesByDate = new Map();
  const monthlyLast = new Map();
  for (const date of dates) {
    const file = path.join(entriesDir, `${date}.json`);
    const { json: entry, digest } = readVerified(file);
    if (entry.schema !== collect.ENTRY_SCHEMA) throw new Error(`${date}: entry schema mismatch`);
    if (entry.entryDate !== date) throw new Error(`${date}: filename and entryDate disagree`);
    if (!entry.previousEntry || entry.previousEntry.previousSha256 !== previousDigest) {
      throw new Error(`${date}: chain broken (expected predecessor ${previousLabel})`);
    }
    if (entry.candidate !== 'EUROPE-MONTHLY-CONTRARIAN-V1') throw new Error(`${date}: wrong candidate`);
    if (!Number.isFinite(entry.europe && entry.europe.score)) throw new Error(`${date}: europe score missing`);
    if (!entry.instrument || entry.instrument.symbol !== collect.INSTRUMENT_SYMBOL || !Array.isArray(entry.instrument.bars)) {
      throw new Error(`${date}: instrument record missing`);
    }
    for (const bar of entry.instrument.bars) {
      if (!(bar.close > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(bar.date)) throw new Error(`${date}: invalid instrument bar`);
      if (closesByDate.has(bar.date)) {
        if (Math.abs(closesByDate.get(bar.date) - bar.close) > 1e-9 * closesByDate.get(bar.date)) {
          warnings.push(`${date}: instrument close for ${bar.date} differs from first-recorded value (provider revision?); first value stays primary`);
        }
      } else closesByDate.set(bar.date, bar.close);
    }
    if (previousDate) {
      const gapDays = (Date.parse(date) - Date.parse(previousDate)) / 86400000;
      if (gapDays > 7) warnings.push(`${previousDate} -> ${date}: ${gapDays}-day collection gap`);
    }
    monthlyLast.set(date.slice(0, 7), { date, integer: Math.round(Math.round(entry.europe.score * 10) / 10) });
    previousDigest = digest;
    previousLabel = date;
    previousDate = date;
  }

  // A month counts as a decision only once it is over (a later month has begun).
  const months = [...monthlyLast.keys()].sort();
  const completedMonths = months.slice(0, Math.max(0, months.length - 1));
  const decisions = completedMonths.map(month => monthlyLast.get(month));
  const fearDecisions = decisions.filter(decision => decision.integer <= 35).length;
  const greedDecisions = decisions.filter(decision => decision.integer >= 85).length;
  return {
    ok: true,
    entries: dates.length,
    firstEntry: dates[0] || null,
    lastEntry: dates[dates.length - 1] || null,
    instrumentDatesCovered: closesByDate.size,
    completedMonthlyDecisions: decisions.length,
    fearDecisions,
    greedDecisions,
    targetMonthlyDecisions: 60,
    progress: `${decisions.length}/60 prospective monthly decisions`,
    warnings,
  };
}

module.exports = { verifyLockbox, readVerified };

if (require.main === module) {
  try {
    const report = verifyLockbox();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (report.warnings.length) process.stderr.write(`${report.warnings.length} warning(s)\n`);
  } catch (error) {
    process.stderr.write(`LOCKBOX INTEGRITY FAILURE: ${error.message}\n`);
    process.exit(1);
  }
}
