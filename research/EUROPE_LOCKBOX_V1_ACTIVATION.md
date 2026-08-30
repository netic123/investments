# EUROPE-LOCKBOX-V1 — scoped prospective collector activation record

<!-- EUROPE-LOCKBOX-V1-ACTIVATED 2026-08-27 : scoped collection begins; no outcome may be
     read before the candidate protocol's declared sample size is reached. -->

Status: `COLLECTING_NO_OUTCOME_READ`

## Scope

This activates prospective collection for exactly one preregistered candidate:
**EUROPE-MONTHLY-CONTRARIAN-V1**
(FEAR_GREED_EUROPE_MONTHLY_CONTRARIAN_LOCKBOX_PROTOCOL.md). It is a deliberately scoped
subset of the full five-market lockbox design in
FEAR_GREED_V3_PROSPECTIVE_LOCKBOX_PROTOCOL.md, which remains `NOT_ACTIVATED`: its gates
demand point-in-time crypto membership sources, five USD total-return series, and calendar
authorities this repository does not have. Nothing here claims otherwise.

## What is collected, where

One append-only entry per UTC weekday under `lockbox/entries/<date>.json`
(`scripts/lockbox-collect.js`, run by `.github/workflows/lockbox.yml` at 22:30 UTC —
after the Xetra and US closes):

- the production unified v2 **europe** score with component scores (other markets'
  headline scores recorded opportunistically),
- the executable instrument's last 15 daily closes,
- the last 10 DTB3 observations (cash leg),
- SHA-256 of each raw upstream payload, the marketfg.js/config.json identity hashes,
  and the SHA-256 of the previous entry (genesis-anchored chain).

`scripts/lockbox-verify.js` re-verifies the entire chain network-free on every run and in
CI, and reports progress toward the candidate's ≥ 60 completed monthly decisions.

## Decisions taken at activation (the scoped gates)

1. **Instrument**: `XSX6.DE` — Xtrackers Stoxx Europe 600 UCITS ETF 1C, Xetra, EUR.
   Chosen because the 1C share class is accumulating: dividends are internalized, so the
   price series is a total-return series by construction (the ^STOXX price-index problem
   the data-source audit flagged does not arise). Verified on Yahoo 2026-08-27: identity,
   currency EUR, history since 2009-01-20. Fallback if delisted: `EXSA.DE` (distributing;
   adjusted closes), recorded here so a future switch is a documented event, not a quiet
   substitution.
2. **Rule and model identity**: frozen in the candidate protocol and hashed into
   `lockbox/GENESIS.json` (candidate protocol SHA-256, marketfg.js SHA-256,
   data/config.json SHA-256). Changing the production model version changes those hashes
   visibly in subsequent entries.
3. **Append-only semantics**: first write per date is permanent (revision-zero-primary);
   re-runs are no-ops; every entry chains its predecessor's SHA-256, so editing history
   breaks verification for every later entry. Provider revisions of already-recorded
   closes surface as warnings; the first-recorded value stays primary.
4. **Write path**: GitHub Actions `GITHUB_TOKEN` with job-scoped `contents: write`,
   committing as github-actions[bot] with `[skip ci]` (no Pages redeploy per entry).
   Proven by a manual `workflow_dispatch` preflight at activation.
5. **Storage budget**: one entry ≈ 4–6 KB plus sidecar; ~260 weekday entries/year
   ≈ **~1.5 MB per year** of repository growth. Accepted.
6. **Redistribution compromise** (deviation from the full design, disclosed): raw
   upstream payloads are hashed into entries but NOT republished in the repository,
   because redistribution rights for raw Yahoo payloads are not established. The stored
   facts are compact derived values (scores, closes, rates) consistent with what the
   public site already publishes. Consequence: third parties can verify the chain and
   internal consistency but cannot re-derive entries from archived raw bytes.
7. **Timing**: entries record each series' own as-of dates; the europe score recorded at
   22:30 UTC is that day's completed Xetra close observation.

## Known deviations and identity semantics (post-activation audit, 2026-08-28)

- **Entry 2026-08-27's final instrument bar is an intraday snapshot.** The activation-day
  collection ran manually at 14:48 UTC, 42 minutes before the Xetra close; it recorded
  XSX6.DE at 169.80 while the official session close was 170.08, and Yahoo's response was
  also missing the 2026-08-26 bar at that moment. Under revision-zero-primary those first
  recorded values stay primary; later entries carry the official closes for the same dates,
  so the verifier's provider-revision warnings for 2026-08-26/27 are expected and explained
  here, not signs of tampering. The collector now records **completed sessions only**
  (bars strictly before the entry's own UTC date), which prevents both defect classes; the
  scheduled 22:30 UTC runs were never exposed to them.
- **GENESIS identity hashes are activation-time snapshots.** `configSha256` in GENESIS pins
  data/config.json as it was at activation (2026-08-27T14:47Z); the config legitimately
  evolved 33 minutes later (the additive ustech market). Do not re-verify GENESIS pins
  against the live tree: model-identity drift is tracked per-entry instead, because every
  daily entry embeds the then-current marketfg.js and config.json hashes.
- **The public dashboard moved to model v3 after activation.** This candidate remains explicitly
  pinned to the original v2 trailing-percentile scorer through `FROZEN_MARKET_MODEL` in
  `scripts/lockbox-collect.js`. Its entries must never be pooled with v3 evidence. The per-entry
  source hashes disclose the implementation/configuration transition even though the candidate's
  score definition remains v2.

## What this store can and cannot show

It can, after ≥ 60 completed prospective months, answer the candidate protocol's primary
endpoint on data that did not exist at freeze time. It cannot retroactively validate any
backtest, and no interim peeking at outcome statistics is permitted: the verifier reports
collection progress and integrity only. The evaluation itself runs once, per the
candidate protocol's stop rule.
