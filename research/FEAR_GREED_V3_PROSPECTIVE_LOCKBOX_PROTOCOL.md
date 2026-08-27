# Five-market prospective lockbox protocol

Status: **design only; not activated; no observation created by this document**.

Earliest permissible nominal collection slot: **2026-08-26T02:17:00.000Z**.
The actual first slot is the first daily slot at or after that instant for which
an immutable freeze manifest has already been committed. A missed pre-freeze or
missed scheduled slot is never reconstructed later.

This is the smallest proposed persistent collector for one unchanged rule
applied to Crypto, Sweden, USA, Europe and Global. It is deliberately separate
from `data/snapshots.json`: the local server replaces an existing row for the
same day, while a lockbox must never replace a prior observation.

The input schema has two compatible purposes, but each freeze manifest approves
exactly one rule whose identity and code hashes exist before its prospective
evaluation starts:

1. preserve every input and computed component needed by the frozen v3 shadow
   Fear & Greed formula; and
2. preserve immutable USD total-return risky-market series plus one USD cash
   total-return index, so a separately frozen universal cross-market rotation or
   AM12-CASH rule can later be evaluated without silently treating a reference
   index as a tradable fund.

Collecting compatible data does not validate either use. Choosing a second rule
requires a second immutable manifest and evaluation start. If a rotation rule
is frozen after data have already been inspected, only observations after that
rule's own freeze time can be confirmatory for it.

## Non-negotiable properties

- All five markets use one model identity, one parameter set and one decision
  rule. Market-specific symbols and calendars are inputs, not permission for
  market-specific tuning.
- The manifest, source bytes, normalized rows, membership, observations,
  revisions and failure attempts are append-only and SHA-256-addressed.
- Raw HTTP response bytes are retained losslessly. Parsing or formatting is
  never used as a substitute for hashing the bytes actually received.
- A score is emitted only when all required inputs for all six components exist.
  A canonical five-market observation is emitted only when all five market
  records, the shared cash TRI and the crypto membership record pass validation.
- No cache, prior successful fetch or later download may silently fill a failed
  source. A failure is an append-only failed attempt and produces no canonical
  observation for that slot.
- Canonical revision zero is the point-in-time record used for prospective
  evaluation. Later vendor corrections are preserved as revisions and reported,
  but they never rewrite revision zero or retroactively improve a result.
- Model code, parameters, mappings, normalization, FX rules, execution proxies,
  calendar rules, crypto eligibility/weighting, cash source or cost algebra may
  not change inside a lockbox version. A change creates a new manifest, model
  ID, directory and evaluation clock.
- Ordinary constituent entry and exit produced by an already frozen crypto
  rebalance rule is not a model change. The exact point-in-time membership and
  inputs that caused it still have to be stored.

## Why the existing runtime is not the collector

The present code has four properties that are valid for a dashboard snapshot
but invalid for this lockbox:

- `server.js` replaces the same date in `data/snapshots.json` (`latest file
  wins`);
- `marketfg.js` keeps parsed values rather than the exact raw response bytes;
- only the crypto mapping currently removes the current UTC date, while equity
  mappings can include a provider's current daily bar; and
- `.github/workflows/pages.yml` currently builds only on a push/manual trigger,
  has `contents: read`, and `scripts/build-pages.js` deletes/rebuilds `_site`
  under a strict file allowlist.

The production cache and `lastGood` fallback therefore remain outside the
lockbox. The new collector is a separate Node process with no server import and
no write path to `data/snapshots.json`.

## Immutable directory layout

The future implementation uses this exact repository tree. Nothing in this
tree is edited or deleted after its first accepted commit.

```text
research/lockbox/five-market-v1/
  freeze/
    manifest-v1.json
    manifest-v1.sha256
    calendars/
      2026.json
      2026.sha256
      2027.json
      2027.sha256
    seed/
      seed.json
      seed.sha256
  raw/
    sha256/<first-two-hex>/<sha256>.gz
  memberships/
    YYYY/MM/DD/<slot-compact>/membership.json
    YYYY/MM/DD/<slot-compact>/membership.sha256
  observations/
    YYYY/MM/DD/<slot-compact>/r000/observation.json
    YYYY/MM/DD/<slot-compact>/r000/observation.sha256
    YYYY/MM/DD/<slot-compact>/r000/bundle.sha256
    YYYY/MM/DD/<slot-compact>/r001/...
  attempts/
    YYYY/MM/DD/<slot-compact>/<collected-at-compact>/attempt.json
    YYYY/MM/DD/<slot-compact>/<collected-at-compact>/attempt.sha256
```

`slot-compact` is the nominal UTC slot in `YYYYMMDDTHHmmssZ` form. A raw object
is stored once by the SHA-256 of its uncompressed response bytes. The `.gz`
file is a deterministic, lossless gzip representation with `mtime=0`; each
reference records both the uncompressed SHA-256 and the stored gzip SHA-256.
Decompression followed by SHA-256 must reproduce the raw hash before parsing.

Every file creation uses exclusive-create semantics (`flag: "wx"`). Existing
bytes must be re-read and hash-checked; an existing path with different bytes is
a hard failure. There is no mutable `latest.json`, index, pointer or status file.
The public Pages summary is derived at build time and is not committed.

## Canonical JSON and hashes

Manifest, calendar, seed, membership, observation and attempt JSON use this
single encoding:

1. UTF-8 without BOM;
2. object keys recursively sorted by Unicode code point;
3. array order preserved;
4. only JSON finite numbers, booleans, strings, arrays, objects and `null`;
5. `JSON.stringify` with no insignificant whitespace, followed by one LF.

The adjacent `.sha256` contains the lowercase SHA-256 of the exact JSON file
bytes, two spaces, the base file name and one LF. `bundle.sha256` hashes, in
order, the manifest hash, calendar hashes, seed hash, membership JSON hash,
observation JSON hash and the lexicographically ordered list of uncompressed raw
payload hashes. The observation does not contain its own or the bundle's hash,
avoiding a circular definition.

## Freeze manifest contract

`freeze/manifest-v1.json` is created once from a clean committed tree. The
sidecar hash is checked before any network request. Every canonical observation
records `manifestSha256`, `sourceCommitSha` and `sourceTreeSha`.

The manifest must contain all fields below and no unresolved `null`, `TBD`,
wildcard symbol or implicit fallback:

```json
{
  "schema": "five-market-prospective-lockbox-manifest-v1",
  "status": "LOCKED_BEFORE_PROSPECTIVE_COLLECTION",
  "lockboxId": "five-market-v1",
  "notBeforeUtc": "2026-08-26T02:17:00.000Z",
  "firstEligibleSlotUtc": "<exact slot at or after manifest commit>",
  "schedule": {
    "cronUtc": "17 2 * * *",
    "slotDurationHours": 24,
    "lateAcceptanceHours": 24,
    "cutoffRule": "accept only economic dates strictly before slot UTC date"
  },
  "runtime": {
    "nodeMajor": 22,
    "collectorPath": "scripts/collect-prospective-lockbox.js",
    "collectorSha256": "<sha256>",
    "collectorTestPath": "test/prospective_lockbox.test.js",
    "collectorTestSha256": "<sha256>"
  },
  "model": {
    "modelId": "<one frozen universal model ID>",
    "protocolPath": "<path>",
    "protocolSha256": "<sha256>",
    "implementationPath": "<path>",
    "implementationSha256": "<sha256>",
    "frozenAtUtc": "<exact ISO UTC>",
    "prospectiveStartSlotUtc": "<first slot strictly after freeze>"
  },
  "sourceCommitSha": "<40 hex>",
  "sourceTreeSha": "<40 hex>",
  "calendarFiles": [
    {"path": "freeze/calendars/2026.json", "sha256": "<sha256>"},
    {"path": "freeze/calendars/2027.json", "sha256": "<sha256>"}
  ],
  "marketOrder": ["crypto", "sweden", "usa", "europe", "global"],
  "seriesCatalog": ["<fully specified records defined below>"],
  "markets": ["<five fully specified market records defined below>"],
  "cashTotalReturnSeriesId": "<USD 3-month T-bill/cash TRI ID>",
  "cryptoMethodology": "<fully specified methodology record>",
  "rawRequestPolicy": {
    "historyCalendarDays": 550,
    "interval": "1d",
    "includePrePost": false,
    "events": ["div", "splits"],
    "userAgent": "<exact value>",
    "timeoutMs": 20000,
    "retries": 0
  },
  "normalizationPolicy": "<exact versioned rules and hash>",
  "revisionPolicy": "revision-zero-primary-later-revisions-audit-only",
  "minimumCompleteFiveMarketObservation": true
}
```

The 550-calendar-day raw window is fixed per nominal slot:
`period1 = UTC midnight(slotDate - 550 days)` and
`period2 = UTC midnight(slotDate)`. It supplies more than the frozen 252-return
maximum lookback under normal equity calendars and covers a 12-calendar-month
rotation comparison. Each dependency still has an explicit minimum-row check;
if any required source has insufficient history, the slot fails rather than
expanding the request ad hoc. Before activation, a measured dry run must publish
the exact compressed bytes per slot and one-year repository-growth estimate. If
that budget is rejected, storage design is a blocker and may not be changed
after collection begins.

`freeze/seed/seed.json` may preserve the complete pre-activation state needed to
initialize moving averages or a 12-month comparison. It is labelled
`PRE_ACTIVATION_WARMUP_ONLY`, includes raw hashes, and is never counted as a
prospective outcome. Chained prospective TRI values start from the seed's final
accepted value and never rewrite it.

## Series catalog and market roles

Every `seriesCatalog` item must contain:

```text
seriesId, role, provider, providerSeriesId, requestTemplate, sourceUrl,
rawContentType, economicName, currency, returnType, adjustmentPolicy,
executable, instrumentType, ticker, ISIN, venueMIC, calendarId, timezone,
timestampToSessionDateRule, publicationLagRule, methodologyName,
methodologyVersionOrDate, methodologyDocumentUrl, methodologyDocumentSha256,
normalizerId, normalizerSha256
```

Roles are closed, not free text:

- `sentiment_reference_index`: the broad index used to describe a market;
- `participation_proxy`: one of the frozen size/breadth proxies;
- `executable_risky_total_return`: the ETF, fund, spot basket or other defined
  implementation used for strategy returns;
- `fx_to_usd`: the frozen unhedged currency conversion series;
- `usd_cash_total_return`: a reinvested USD 3-month Treasury-bill/cash wealth
  index; and
- `crypto_constituent_price`: a constituent input to the own-methodology broad
  crypto index.

A reference index and an executable ETF are never aliases. Each market record
contains separate `sentimentReferenceSeriesId` and
`executableRiskyTotalReturnSeriesId`. The latter must set
`returnType = "total_return"`, `currency = "USD"` and `executable = true`.
When its source is a local-currency adjusted-close series, the manifest also
identifies an `fx_to_usd` series and freezes:

```text
USD total-return factor(t)
  = local total-return factor(t) * USD-per-local-currency factor(t)
```

Both factors are calculated from values contained in the same slot's raw
payload set. The observation records the local factor, FX factor and product.
No interpolation is allowed. An as-of carry, if permitted, is at most seven
calendar days, is frozen per series, and is explicitly recorded. The value is
known no earlier than `collectedAtUtc`; any decision executes only on a later
eligible executable close.

The shared cash record must be an actual positive USD total-return wealth index
with reinvestment. A quoted annualized yield such as `^IRX`, a bond ETF such as
`IEF`, or an assumed zero cash return is invalid. A missing cash TRI fails the
entire canonical observation.

The prospective USD TRI is chained, never restated:

```text
TRI_USD(t) = TRI_USD(t-1) * slot-local-total-return-factor(t) * slot-FX-factor(t)
```

For USD instruments the FX factor is exactly 1. For cash, the frozen cash TRI's
own consecutive-value factor is chained. A later dividend, split, FX or index
revision is recorded under `r001+`; it does not alter any `r000` TRI row.

An ETF replacement, venue change, index-family change, return-type change or
provider methodology change may not be spliced into the old series. It creates
a new `seriesId` and, when used by a frozen model, a new lockbox/model version.
Each observation records the active instrument identity and methodology hash,
so survivorship and fund replacement cannot disappear from history.

### ETF NAV, adjusted-close and index revisions

The manifest must choose one economic value for each role and may not switch
among them after outcomes appear:

- an ETF's exchange close is executable but its published NAV is not; store
  both when available, but use only the frozen `executable_risky_total_return`
  value for strategy wealth;
- a reference index level or ETF NAV can measure tracking, but cannot be used as
  a fill price;
- adjusted market close may be used as a total-return proxy only when its exact
  provider adjustment method is frozen and the raw close, adjusted close,
  split and distribution records are retained; and
- a provider-supplied official gross/net total-return index must keep its
  declared return type. Price, gross-return and net-return variants are distinct
  series IDs.

Revision zero chains the values received in that slot. If a later download
changes an earlier ETF NAV, close, adjustment factor, distribution, FX fixing or
index level, append a revision containing the original/revised rows and raw
hashes and recompute the alternative factor/score under that revision. Do not
rewrite the canonical TRI or use the corrected history to improve a prior
decision. A data correction with unchanged methodology is an audit revision; a
methodology, benchmark, fund or return-variant change is a new series and model
version. Both the originally known and latest-corrected research results may be
reported, clearly separated, but the prospective primary result always uses
`r000`.

## Calendar registry and completed-bar rule

`freeze/calendars/YYYY.json` contains the exact session date, regular open,
regular close and status (`open`, `holiday`, `early-close`, `exceptional-close`)
for every calendar used by a frozen series. Times are ISO instants in UTC plus
the source local time and IANA timezone. It also stores the official source
document/payload raw hash and the tzdata version used to convert local times.

The expected calendar families are:

| Market/role | Calendar identity to freeze | IANA timezone | Normal daily boundary |
|---|---|---|---|
| Crypto own index and constituents | `CRYPTO_UTC_24_7` | `UTC` | `[00:00, 24:00)` UTC |
| Sweden reference/executable | Nasdaq Stockholm / `XSTO` | `Europe/Stockholm` | frozen official regular close |
| USA reference | frozen U.S. index calculation calendar | `America/New_York` | frozen official index close |
| USA executable ETF | its actual MIC, normally `ARCX` or `XNYS` | `America/New_York` | venue regular close |
| Europe reference | frozen STOXX/index calculation calendar | `Europe/Zurich` or publisher-declared zone | frozen official index close |
| Europe executable ETF | its actual MIC, for example `XETR` | `Europe/Berlin` | venue regular close |
| Global reference | exact publisher/index calendar | publisher-declared | frozen official close |
| Global executable ETF | its actual MIC, often `ARCX` or `XNAS` | venue zone | venue regular close |
| USD cash TRI | publisher's U.S. business-day calendar | publisher-declared | frozen publication rule |

The example MICs are not a mapping decision. The manifest must resolve the
actual MIC/timezone for every final symbol. In particular, the currently
observed Yahoo metadata for `^OMXSBGI` identifies a U.S. timezone; the collector
must not trust that provider metadata as Stockholm's calendar. The independent
manifest calendar and timestamp rule govern.

For nominal slot `S`, let `D` be `S`'s UTC `YYYY-MM-DD`. A daily row is accepted
only when all of these are true:

1. its economic/session date is strictly less than `D`;
2. its frozen official regular/early close instant is at or before `S`;
3. the raw payload was actually received at `collectedAtUtc >= S` and before the
   next nominal daily slot;
4. the provider-specific publication-lag rule says the value was available;
5. the date is an open/early/exceptional session in the frozen calendar, or a
   separately appended official exceptional-session record supports it; and
6. all timestamps, values and identifiers pass the frozen normalizer.

For crypto, this means the current UTC date is always excluded. At the first
permitted slot, the latest possible crypto bar date is 2026-08-25. For exchange
markets, weekends and holidays create no synthetic row. The observation records
the expected prior session, actual last accepted session, lag in calendar days,
raw provider timestamp and derived session date.

No raw timestamp is silently treated as a close instant: providers sometimes
label daily bars with the open or another convention. The manifest's
`timestampToSessionDateRule` maps it to a session date; the calendar supplies
the completion instant.

## Crypto point-in-time membership

The current fixed seven-coin basket is not an all-market crypto index and cannot
be relabelled as one. Before activation, the manifest must freeze an own
methodology and a source capable of returning point-in-time identifier, price,
circulating market cap, volume and classification fields. CoinMarketCap's Fear
& Greed model is not an input.

At every slot the collector stores the exact raw universe response and one
membership record containing:

```text
provider asset ID, symbol, name, contract/network identity where applicable,
first eligible date, last eligible date, circulating supply, USD price,
circulating market cap, frozen liquidity statistic, category flags,
eligibility result, every inclusion/exclusion reason, rank, uncapped weight,
capped weight, rebalance observation date, effective-from date, effective-to
date, methodology hash and all supporting raw payload hashes.
```

The membership file must state whether the index is equal-weighted,
capitalization-weighted or capped, the rebalance frequency, lag between
selection and effectiveness, treatment of stablecoins, wrapped assets, liquid
staking tokens, forks, airdrops, missing prices, delistings and assets with
multiple venues, and the return calculation including fees. Selection uses only
fields present in the selection slot. Membership becomes effective only after
the frozen lag; there is no historical backfill of a newly discovered asset.

The broad crypto return index is calculated from the membership that was
already effective at the start of the return interval. Every rebalance stores
old/new membership and turnover. If the construction is not demonstrably
tradable at its recorded prices and venues, it is
`sentiment_reference_index` only. A separately frozen executable spot basket or
fund is required for strategy-return claims.

Until provider, eligibility, exclusions, weighting, lag, price composite,
corporate-action handling and execution-cost rules are all resolved, crypto
membership is an activation blocker.

## Observation contract

Each `observation.json` contains at least:

```text
schema, lockboxId, revision, revisionKind, nominalSlotUtc, collectedAtUtc,
manifestSha256, sourceCommitSha, sourceTreeSha, githubRepository,
githubRunId, githubRunAttempt, runnerImage, nodeVersion, status,
calendarHashes, seedSha256, membershipSha256, rawPayloadInventory,
normalizationInventory, cashTotalReturn, markets
```

Each raw inventory item records canonical request parameters, provider,
provider series ID, HTTP status, redirect chain, response headers needed for
provenance (`Date`, `ETag`, `Last-Modified`, content type), fetch start/end UTC,
byte count, uncompressed raw SHA-256, gzip SHA-256, normalizer identity,
normalized-row SHA-256, first/last normalized date and first/last accepted date.

Each market record contains:

- exact reference-index and executable-instrument identities;
- calendar, currency, return type, methodology and membership hashes;
- the latest accepted completed bar and its raw/normalized provenance;
- the immutable USD risky TRI value and its local-return and FX factors;
- all six unrounded v3 component values, their input dates and raw dependencies;
- the unrounded score, display-rounded score and component count;
- `knownAtUtc = collectedAtUtc` and the first permissible execution session;
- stale-day counts and warnings; and
- no outcome, forward return or future label.

The public Pages JSON may expose only slot, collection time, model/manifest
hashes, completed-bar dates, score/component values, reference/executable
identities, crypto membership summary, status and revision count. Raw payloads,
full membership and the immutable audit tree stay outside `_site` unless their
redistribution rights have been separately confirmed.

## Revisions, reruns and missed slots

- The first complete collection within a slot's 24-hour acceptance window is
  `r000`, `revisionKind = "point_in_time_primary"`.
- A byte-identical rerun is an idempotent no-op after every existing hash is
  verified.
- A later fetch in the same still-open slot with any changed raw or normalized
  hash appends `r001`, then `r002`, and so on. It includes
  `supersedesObservationSha256`, old/new hashes, changed rows, source headers,
  reason and score/TRI deltas.
- Once the next nominal slot begins, a missing prior `r000` is permanently
  `MISSED`. A later current payload cannot be written as that slot's canonical
  data. The next run appends a failed-attempt/missed-slot record and proceeds
  only with its own slot.
- A provider correction observed on a later day is an audit revision linked to
  the affected source/row; prospective evaluation continues to use what was in
  the affected slot's `r000`.
- A failure after some downloads preserves an `attempt.json` and any
  content-addressed raw blobs. It does not produce membership effectiveness,
  chained TRI or a score.

Git conflicts are never resolved by overwrite. The workflow fetches/rebases,
re-runs the exclusive-path/hash checks and retries the append-only commit up to
three times. Any semantic conflict fails closed.

## Smallest implementation and workflow plan

No production file is changed by this design document. Activation would add or
change exactly these implementation surfaces:

1. Add `scripts/collect-prospective-lockbox.js` using only Node 22 built-ins.
   It validates manifest/code/calendar hashes before networking; derives the
   nominal slot independently of runner delay; fetches raw bytes; validates
   completed rows; builds membership, USD TRI and five scores; writes only with
   `wx`; and prints the created paths and SHA-256 values.
2. Add `test/prospective_lockbox.test.js` with fixture bytes covering UTC and
   DST boundaries, early close/holiday, a current partial bar, wrong provider
   timezone, raw replay, FX conversion, cash TRI rejection, crypto membership
   lag, insufficient history, duplicate idempotence, revision append, missed
   slot, partial failure and attempted overwrite.
3. Create the manifest, calendar and seed files only after a clean candidate
   commit, then put their exact hashes in the first observation.
4. Extend `.github/workflows/pages.yml` with daily UTC schedule
   `17 2 * * *` and manual inputs `mode` (`deploy-only` or `collect`) and
   `slotUtc`. Use one concurrency group with `cancel-in-progress: false`.
5. Add a `collect` job before `build`. Only the scheduled event or explicit
   manual `mode=collect` may collect; an ordinary push is pass-through. Grant
   `contents: write` only to this job, run the collector tests, validate that
   the git diff contains additions only below
   `research/lockbox/five-market-v1`, commit, push with bounded retry, and emit
   the exact resulting commit SHA.
6. Make `build` depend on `collect` and check out that emitted SHA. Keep its
   current `contents: read` permission, repository tests and Pages artifact
   validation. Add one derived `api/lockbox.json` to the strict Pages allowlist
   and change the build metadata refresh description to scheduled plus push.
7. Keep the current deploy job and its narrow `pages: write`/`id-token: write`
   permissions. The same workflow run builds and deploys the collector commit.

This single-workflow design is intentional. GitHub documents that a push made
with the repository `GITHUB_TOKEN` does not trigger a new push workflow, so a
collector commit cannot rely on starting the existing Pages workflow. Scheduled
workflows run from the latest default-branch commit and use UTC by default.
GitHub also warns that scheduled runs can be delayed or dropped during high
load, especially at the start of an hour; minute 17 and the explicit missed-slot
rule reduce ambiguity but do not make scheduling guaranteed.

Official GitHub references:

- [Triggering a workflow](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [Workflow syntax and schedules](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)
- [Troubleshooting delayed scheduled workflows](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows)
- [Custom GitHub Pages workflows](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

## Activation gates and current blockers

The lockbox must remain `NOT_ACTIVATED` until all gates pass:

1. **Clean, immutable source identity.** The working tree currently contains
   many modified/untracked research and production files, so the current HEAD
   cannot truthfully identify the proposed collector/model bundle.
2. **One final model freeze.** V3 is research-only and its preferred future
   mappings are recommendations, not a frozen prospective mapping. Any
   cross-market rotation rule also needs its own protocol/code/hash and a
   prospective start strictly after that freeze.
3. **Exact reference and execution mappings.** `^DJUS`/IYY, `^OMXSBGI`, the
   European pair and ACWI/SPGM are not interchangeable. Every tab needs one
   final reference index, one executable risky total-return series and all
   participation proxies, with identifiers, return type and calendar.
4. **Crypto methodology and point-in-time source.** The fixed seven survivors
   are not broad-market membership. No provider, eligibility rule, weighting,
   rebalance lag or executable basket has yet been frozen.
5. **USD total-return and cash data.** The repo does not currently contain five
   immutable USD total-return risky series or an actual reinvested USD cash TRI.
   Local-currency price series, `^IRX`, IEF and zero cash are not substitutes.
6. **Calendar evidence.** Official annual sessions, early closes, exceptional
   closures, publication rules and tzdata must be captured and hashed for every
   final series. Yahoo's observed `^OMXSBGI` timezone metadata is not suitable
   as the Stockholm calendar authority.
7. **Provider and redistribution decision.** Yahoo's chart endpoint has no
   project-owned contractual schema/SLA, can revise adjusted history, and raw
   payload redistribution rights have not been established. Accept that risk or
   freeze another authorized point-in-time source before activation.
8. **GitHub write path.** The current workflow is read-only. A read-only API
   check from the currently active local GitHub identity returned `403` for the
   repository's workflow-permission setting, and branch-protection status could
   not be established. `GITHUB_TOKEN` contents-write permission and direct-main
   bot commits must be proven in a disposable preflight. If main is protected,
   use a separately protected append-only data branch and have the same Pages
   run check out its emitted SHA; do not weaken protection silently.
9. **Storage budget.** Run one frozen 550-day, all-dependency dry capture and
   measure compressed size. Approve the projected yearly Git growth before the
   first canonical slot; retention may not be shortened after outcomes appear.
10. **Independent replay.** A fresh checkout with network disabled must verify
    every sidecar and bundle, decompress every referenced raw object, reproduce
    normalized rows, membership, USD TRI, components and scores, and reject any
    unreferenced or overwritten byte.

Passing these gates makes collection auditable. It still does not show that a
Fear & Greed score predicts returns or that any rotation rule beats symmetric
buy-and-hold after costs; those are later prospective results, not properties of
the collector.
