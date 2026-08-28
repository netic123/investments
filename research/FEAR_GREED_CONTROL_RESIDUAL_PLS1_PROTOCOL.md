# Fear & Greed control-residual PLS1 prospective protocol

Status: **DRAFT PRE-REGISTRATION; NOT ACTIVATED; NO PROSPECTIVE OUTCOME HAS BEEN OBSERVED**.

The exact bytes become frozen only when a committed manifest pins this document,
all transitive code/tests/workflow bytes, the complete historical seed, the exact
runtime, independently reviewed source identities and calendars, written
data-rights evidence, protected remote history, and an independently verifiable
timestamp for every decision. Until that happens, this is an audited candidate
specification, not a live validation experiment.

Freeze marker: `FROZEN_BEFORE_PROSPECTIVE_OUTCOME_2026_08_28_V1`.

Model ID: `FG-CONTROL-RESIDUAL-PLS1-PREQ-V1`.

## Runtime integrity assumption

Every model, collector, verifier, and standalone-evaluator process must start
as a clean invocation of the exact Node runtime pinned by the manifest. No
`--require` or loader preload, injected startup code, inspector mutation, or
other pre-load modification of JavaScript intrinsics is permitted. A run that
cannot establish this clean module-load boundary is invalid evidence and fails
closed. Security-critical native operations are captured when their modules
load so later same-process mutation of those captured properties cannot alter
canonical bytes, hashes, exact binary64 certificates, schema ordering, finite
number gates, or immutable evidence snapshots. Caller-supplied market rows,
identity fields, prior positions, and training inputs are snapshotted at their
trust boundary: each property is read exactly once into a local, only the
validated locals are stored in the frozen normalized ledger, and session
monotonicity is asserted against the previously stored normalized row, so an
accessor-based time-of-check/time-of-use input can never bless an out-of-order
or divergent ledger. This protects against mutation
after module load only; it is not a claim to defend a process or realm already
compromised before the modules load.

This document defines one candidate before its first prospective decision. It
does not claim that the candidate works, beats buy-and-hold, or doubles an
index. Historical rows may initialize the expanding fit, but they are labelled
`PRE_ACTIVATION_WARMUP_ONLY` and can never count as validation evidence.

The word `PLS1` means conventional one-response, one-component partial least
squares: the component direction is the cross-covariance direction. “Control
residual” means that both the outcome and the six Fear & Greed inputs are first
projected on the same fixed price-control design. This is not a byte-for-byte
replication of Huang, Jiang, Tu and Zhou's different two-stage aligned-sentiment
construction.

## Closed family and executable instruments

The family is frozen as all six dashboard tabs, in this order:

| key | sentiment reference | executable risky target | venue/currency | primary one-way cost | stress one-way cost |
| --- | --- | --- | --- | ---: | ---: |
| `crypto` | fixed seven-asset equal-weight analytical basket | `BITW` | NYSE Arca / USD | 0.25% | 0.75% |
| `sweden` | `^OMXSBGI` | `EWD` | NYSE Arca / USD | 0.10% | 0.25% |
| `usa` | `SPY` | `SPY` | NYSE Arca / USD | 0.10% | 0.25% |
| `ustech` | `XLK` | `XLK` | NYSE Arca / USD | 0.10% | 0.25% |
| `europe` | `^STOXX` | `VGK` | NYSE Arca / USD | 0.10% | 0.25% |
| `global` | `ACWI` | `ACWI` | Nasdaq / USD | 0.10% | 0.25% |

The shared hypothetical cash sleeve is `BIL`, the State Street SPDR Bloomberg
1-3 Month T-Bill ETF, in USD. Risky and cash inputs are dividend/split-adjusted
market-close series. These are total-return proxy calculations, not quoted or
executed fills. `BITW` is a broad crypto ETP, but it does not replicate the
dashboard's fixed seven-coin equal-weight reference basket. Its pre-December
2025 history was an OTC/closed-end structure and could contain discount/premium
effects. Those are permanent scope limitations, not details that may be tuned
away later.

The frozen upstream normalizer is the repository's production-v2 six-component
Fear & Greed engine. Each feature row contains the unrounded component scores
in this exact order:

1. `momentum`
2. `strength`
3. `volatility`
4. `safeHaven`
5. `credit`
6. `breadth`

No composite score, score change, square, interaction, component dispersion,
lag, smoothing, second factor, market-specific sign, or alternative proxy is
allowed. Every component must be finite and in `[0,100]`.

## Row alignment and all-history rule

Each market uses the US-listed risky target's complete completed-session
calendar from the first available sentiment-reference row onward. Before
activation, a separately reviewed source-identity contract must freeze the
provider-native symbol, venue/MIC, currency, stable security or share-class
identifier, corporate-action identity history, adjustment methodology, first
raw and adjusted dates, and complete valid session calendar for every raw
input. An index must additionally bind its owner symbol, return variant,
currency, and stable index identifier; a crypto pair must bind one venue or one
deterministic aggregation methodology. A provider alias is never a stable
instrument identity. The frozen contract is the sole replay authority;
provider metadata cannot prove itself and a second hand-written calendar cannot
overrule it. Its future horizon must contain the activation
session, all first 756 post-activation decision origins, and the two later
sessions needed to fill and mature the 756th origin. The activation decision is
not one of those 756 forecast origins. That horizon is enforced twice. The seed
build requires at least 759 future sessions beyond its own retrieval boundary
as an early gate only; the binding check is anchored at activation, which
happens after manifest review and therefore later than the seed boundary.
Before the activation decision is persisted, the frozen risky-target calendar
must still contain at least 758 sessions strictly after the activation decision
close; otherwise the run fails closed as `FAILED_ACTIVATION_FORWARD_HORIZON`
and writes no decision. The offline verifier independently re-derives the same
758-session bound from the activation bundle's recorded decision close and
rejects any activation bundle that lacks it. An exceptional closure not present
in the frozen calendar terminates this candidate unless the pre-registered
exception mechanism permits it; it is never silently guessed after seeing
outcomes.

The current draft identity schema checks provider symbol, currency, exchange,
timezone, type, first dates, and calendar, but does not yet machine-require all
of the stable-identifier, index-variant, crypto-methodology, adjustment, and
corporate-action fields above. An evidence-reference string cannot repair that
schema gap, so activation remains blocked until the contract and replay checks
are upgraded and independently populated.

A Fear & Greed component vector is attached only when its reference date is no
later than the target session and no more than seven calendar days old.
Otherwise all six components, all six component provenance dates, and the
reference date are explicitly null. Target and `BIL` must both have a finite,
positive adjusted close for every newly appended target session. Neither is
interpolated. An incomplete target/cash session makes the acquisition fail
closed and retry from archived source bytes; it does not create a partial row or
a decision. If it cannot be recovered before a later session, the fixed
zero-missed-decision trust gate necessarily fails.

The activation seed is acquired with the provider's maximum-history range and
stores every target-session row permitted by the independently frozen boundary,
not a rolling window. The first prospective decision date must be strictly later
than the final seed date in every market. Live acquisition uses a five-year raw
snapshot for every component, risky target, and `BIL`; that range is only a
bounded recovery and feature-recalculation input. A frozen property test must
prove that its mature terminal aligned row and decision are byte-identical to a
maximum-history replay on the same vintage. It never limits the learner.

After activation, every first-seen target-session row is appended and is never
replaced. A provider correction is an audit revision and may affect a later
model version, but cannot rewrite a prior primary row or decision. Every fit
uses all valid matured primary rows from the oldest seed row through the latest
matured outcome. There is no rolling window, maximum row count, decay, reset,
or partial-history scoring path.

The core model can prove only that it does not truncate the supplied ledger; it
cannot prove that a caller supplied the provider's complete history. Each raw
decision therefore says `learnerTruncatedSuppliedLedger=false` and
`sourceHistoryCompleteness=REQUIRES_EXTERNAL_LOCKBOX_VERIFICATION`. Only the
seed, permanent-ledger, closed-inventory, and offline-replay checks may promote
that into a complete-source-history claim.

Historical availability times cannot be reconstructed. Seed rows therefore
initialize the fit only. A live row first receives `dataAvailableAtUtc` after
all inputs are archived and replayed. Its binary decision receives the later
`signalKnownAtUtc` only after model computation finishes. The decision payload
is then independently timestamped. Execution is the first risky-target close
strictly after the feature close, `signalKnownAtUtc`, and the verified external
anchor time. None of these times may be stamped from a pre-download or
pre-computation clock.

## Fixed features and relative-return label

For risky adjusted close `P`, cash adjusted close `B`, and feature close `i`,
the five price controls are:

```text
C1 = log(P[i] / P[i-1])
C5 = log(P[i] / P[i-5])
C20 = log(P[i] / P[i-20])
VOL20 = population standard deviation of the 20 one-close log returns ending i
TREND125 = log(P[i] / arithmetic mean(P[i-124..i]))
```

The response is the executable risky-minus-cash log return earned after the
next-close fill:

```text
y[i] = log(P[i+2] / P[i+1]) - log(B[i+2] / B[i+1])
```

At decision close `t`, the training set is exactly every valid feature row `i`
whose outcome end `i+2` is no later than `t`. Current, unmatured, or later rows
enter no mean, scale, projection, loading, or coefficient.

## Exact M0 and M1 algebra

For the matured training rows, standardize the five controls and six component
columns separately with training-only population means and population standard
deviations. Outcomes are not standardized. Training values are never clamped.
A current standardized coordinate is clamped to `[-5,5]`. A control standard
deviation at or below `1e-12` invalidates the fit. A component standard
deviation at or below `1e-12` becomes an all-zero standardized column.

Let `D = [1, Zc]`, `Zx` be the standardized component matrix, and use ordinary
least squares:

```text
alpha = inverse(D' D) D' y
e     = y - D alpha
Gamma = inverse(D' D) D' Zx
E     = Zx - D Gamma
```

`M0` predicts `mu0 = d_current alpha`. The single PLS direction is:

```text
g = E' e / n
w = g / ||g||2
s = E w
vs = s' s / n
q = (s' e / n) / vs
mu1 = mu0 + q * ((zx_current - d_current Gamma) w)
```

The direction `g / ||g||` is the only sign convention. It aligns the factor to
matured relative returns, never to a desired BUY action or a semantic
fear/greed sign. If `||g||` is exactly zero, or finite `vs <= 1e-12`, use
`w=0`, `q=0`, and `M1=M0`. That is a valid nested-null result. Any other
nonfinite value, invalid control variance, singular solve, or failed normal
equation check invalidates both fits.

Clamping the six current component coordinates does not by itself bound their
distance from the component/control relationship learned in the training set.
After current-component residualization, the current factor score must therefore
be finite and satisfy:

```text
abs(s_current) <= MAX_CURRENT_PLS_SCORE_Z * sqrt(vs)
MAX_CURRENT_PLS_SCORE_Z = 5
```

Exact equality is valid. A score above that fixed five-training-standard-
deviation ceiling invalidates both fits as `CURRENT_PLS_SCORE_OUT_OF_RANGE`.
For an exact zero factor, `s_current=0` and the check remains valid. This gate is
frozen before activation and prevents an almost zero-variance training factor
from turning a valid but off-manifold current component/control combination into
an unbounded finite forecast.

The boundary comparison does not use the rounded `sqrt(vs)` value. Under the
frozen policy `EXACT_DYADIC_FINAL_BINARY64_V1`, the final binary64 values are
decoded as exact signed dyadic integers and the implementation compares
`s_current^2 <= 25*vs` with `BigInt` shifts. This preserves true equality of the
actual frozen binary64 inputs and rejects a value that only appears equal after
a rounded square root.

The pinned solver uses partial-pivot Gaussian elimination on `D'D/n`, declared
column order, largest absolute pivot, lowest-row tie break, and pivot tolerance
`1e-12`. It may not silently use ridge, a pseudoinverse, feature deletion, or a
library-dependent rank rule. The standardized normal matrix must also have an
infinity-norm condition number no greater than
`67,108,864 = 1/sqrt(binary64 epsilon)`; a finite solution above that
pre-registered stability ceiling fails closed as
`CONTROL_MATRIX_ILL_CONDITIONED`.

The condition boundary is certified exactly over the final 6 by 6 binary64
normal matrix. All entries are decoded to exact dyadics and integerized as
`A=2^E B`. Fraction-free Bareiss determinants construct `det(B)` and
`adj(B)`, and the certificate must first verify
`B*adj(B)=det(B)*I`. Singularity or a failed identity rejects the fit. The
condition gate is the exact integer comparison
`maxRowAbsSum(B)*maxRowAbsSum(adj(B)) <= 67108864*abs(det(B))`.
The floating-point condition number remains a diagnostic only; it does not
decide the boundary.

Individual current-control clamping does not prove that the five controls form a
joint combination represented in training, especially when two controls are
strongly correlated. Using the same validated standardized normal matrix and
`d_current=[1,zc_current]`, compute the fixed joint-control radius:

```text
r_control = sqrt(max(0, d_current' inverse(D'D/n) d_current))
MAX_CURRENT_CONTROL_MAHALANOBIS_RADIUS = 5
```

The intercept is included exactly as shown. The same verified integer normal
certificate is reused. With `d_current=2^F c`, the implementation evaluates
the sign and compares the exact rational squared radius
`2^(2F-E)*(c' adj(B) c)/det(B) <= 25` using `BigInt`; a negative value rejects.
The floating-point solve and square root remain diagnostics only. Exact equality
is valid. A nonfinite diagnostic or an exact squared radius above 25 invalidates both fits as
`CURRENT_CONTROL_MAHALANOBIS_OUT_OF_RANGE`. This gate is frozen before
activation so individually clamped but jointly off-manifold controls cannot
turn a nearly collinear, formally solvable M0 fit into an extreme finite
forecast.

## Causal order and binary states

At each newly observed completed target close `t`:

1. apply the interval return using the previously filled position;
2. fill the state queued at the prior eligible close and charge one one-way
   cost only when state changes;
3. mature forecasts whose outcome ends at `t`;
4. add valid row `t-2` to the permanent expanding training state;
5. build the current row using only facts available by the recorded time;
6. emit `BUY/LONG` or `SELL/CASH` for the first later eligible close.

The operational minimum is 252 matured complete rows. Before that, a valid row
emits `BUY/LONG` with reason `WARMUP_BUY_BASELINE`. Missing/invalid current data
or a failed mature fit emits `SELL/CASH` with reason
`FAIL_CLOSED_DATA_INVALID`; invalidity takes precedence over warm-up. A
zero-factor fit remains valid and uses M0. M0 is allowed only on the same
six-component-complete origins as M1.

Every decision records whether the binary target came from a learned forecast
or from one of those pre-registered policies. A warm-up BUY or invalid-data SELL
is an explicit policy fallback and must never be described as a learned pattern
from history.

Initial prospective filled state is `LONG`. Each model keeps its own filled
state. With stress one-way cost `c`, the fixed hurdle is `-log(1-c)`:

- from `CASH`, change to `LONG` only when the total prediction is strictly
  greater than the hurdle;
- from `LONG`, change to `CASH` only when the total prediction is strictly less
  than the negative hurdle;
- equality retains the filled state.

Primary and stress wealth replays use the identical target-state ledger chosen
with the stress hurdle. There is no HOLD/null action and no terminal
liquidation. The activation decision is a real queued state: its later fill,
state-change cost when applicable, and following outcome must be present and
verified in the wealth replay even though activation is excluded from the 756
forecast-error origins.

## Immutable prospective evidence

The lockbox ID is `control-residual-pls1-v1`. Its seed, manifest, attempts,
decisions, fills, outcomes, raw-response hashes, and SHA-256 sidecars are
append-only. Semantic decision identity is `(manifest hash, market key,
decision close)`, never the collector's wall-clock date. Scheduled GitHub runs
at 06:17Z, 09:17Z, and 11:17Z are redundant operational retries only. GitHub
does not provide a trustworthy nominal-date identity for a delayed cron event,
so no inferred nominal slot or delay is accepted as evidence. Actual remote-run
identity and post-acquisition completion time are recorded. Every decision,
including automatic first activation, must finish before the 12:00Z safety
cutoff and before its first possible execution close.

If several target sessions appeared since the previous accepted run, all
complete target/cash rows are appended to the primary price ledger. Only the
latest observed row receives a new decision. Earlier dates are permanently
labelled `MISSED_NO_PROSPECTIVE_DECISION`; they can later mature historical
training rows and resolve an already-recorded fill/outcome, but can never receive
a retroactive decision. A prior decision fills at the first complete target
session strictly after its decision date, even when that session has invalid
sentiment. Any missed decision from activation through the fixed endpoint's
final outcome date is a universal trust failure; recovery rows remain in all
fill, outcome, and wealth calculations and never replace one of the 756 origins.

A decision record contains no future fill, outcome, return, MSE, or wealth.
Fills and outcomes are later records referencing the immutable decision hash.
The public UI may show the last accepted state as stale, but a failed collection
cannot invent a new decision. Failed and no-new-session attempts, including all
available response bodies, form their own verified append-only chain.

Before any market-data request, the collector checks the actual UTC cutoff and
the latest completed session in the frozen target calendar against the terminal
date already in the permanent ledger. A post-cutoff run records
`SKIPPED_PAST_CUTOFF`; a run whose latest completed session is already recorded
records `SKIPPED_ALREADY_RECORDED_DATE`. Neither may contact the data source.
The frozen calendar is finite, so once the permanent ledger's terminal date
equals the calendar's absolute final session the horizon is exhausted: every
later run must fail closed as `FAILED_FROZEN_CALENDAR_HORIZON_EXHAUSTED`
without contacting the data source and may never record the benign
already-recorded skip, because exhaustion is a stalled experiment, not a
recorded state. Continuing requires a new independently reviewed calendar
freeze. The verifier rejects any chain that records the benign skip in the
exhausted state.
Every other non-decision run is exactly `SUCCESS_NO_NEW_DECISION` or
`FAILED_NO_DECISION`. Failures use one frozen stage code and a SHA-256 of the
diagnostic text, not mutable free-form semantics. No live-collection source
request may be initiated at or after 12:00Z on its retrieval date; the
collector refuses such an initiation before any network contact, and the
verifier rejects any attempt containing an archived receipt whose start time is
not strictly before that deadline. A `SUCCESS_NO_NEW_DECISION` attempt must
additionally be recorded strictly before the 12:00Z cutoff on its own retrieval
date; a `FAILED_NO_DECISION` record time may legitimately land later, but its
receipts remain bound by the initiation deadline. Acquisition state is exactly
`NOT_STARTED`, `PARTIAL_UNVERIFIED`, or `COMPLETE_REPLAY_VERIFIED`; only exact
offline equality between the captured result and every role-bound archived body
permits the final state. Partial receipts are still checked against the frozen
ordinal, phase, role, URL, date, and fallback contract.

Production collection is allowed only in the pinned GitHub Actions workflow on
the protected `main` branch. Caller-supplied clocks, acquisition functions, and
production output roots are rejected. Exactly one terminal decision or attempt
artifact is required for every GitHub `(run ID, run attempt)`, including runs
that fail or are cancelled before the collector starts. Duplicate terminal
artifacts and missing terminal artifacts both fail the chain. A local
fail-closed validator now checks a closed, daily paginated inventory of every
remote run and every attempt `1..run_attempt`, including startup failure and
cancellation, against exactly one terminal-artifact index entry. It is not yet
integrated with a separately protected remote inventory collector or the full
lockbox verifier; GitHub run deletion is not independently detectable from the
current run list alone. The draft workflow is therefore deliberately read-only
and activation remains blocked. Each artifact records and hashes a canonical
immutable projection obtained from the
attempt-specific GitHub REST resource and binds the run ID/attempt, event,
repository ID, workflow ID/path/ref,
head SHA, workflow SHA, ref, runner environment, request URL, and response URL.
The manifest's declared source tree must equal the actual Git tree object. The
manifest bytes must equal the blob in the frozen manifest commit, that commit
must strictly descend from the source commit, and every recorded remote head
must contain the same manifest and unchanged pinned source files on the same
ancestor chain. The strict-descent rule is enforced by the collector before any
decision, including the automatic activation, and the verifier re-derives and
checks it even when no decision bundle has recorded a manifest commit yet; a
merge-base check of the manifest commit against its own history is not
evidence.
Before each qualifying market-data acquisition, the complete effective branch
policy must hash to the snapshot frozen in the manifest. That snapshot includes
the applicable branch-protection object, every effective repository or
organization ruleset, enforcement state, and every bypass actor or bypass mode;
a missing, weakened, strengthened, redirected, or otherwise changed policy
requires a new manifest rather than silent acceptance. A local fail-closed
validator now requires legacy protection, complete parent-aware ruleset and
effective-rule pagination, visible bypass actors, and zero applicable bypasses.
Manifest creation, collection, and full verification do not yet acquire, freeze,
or replay that projection, so activation remains blocked.
Git committer or workflow time is metadata only and is never treated as the
decision freeze anchor.

Every request is assigned a frozen acquisition phase (`COMPONENT` or
`EXECUTABLE`) and one exact accepted semantic role (`COMPONENT`, risky target,
or `BIL`) and response ordinal. Contiguous request inventory, URL
host/path/query, fallback order, provider symbol, currency, timezone, timestamp
order, array coverage, and adjusted-close coverage are checked. Archived bytes
are decoded HTTP response-body bytes (not transport-level wire bytes). The
offline verifier reparses those bytes, recomputes every component vector and
aligned target row, re-chains immutable adjusted-close levels, and independently
recomputes every fit, decision, fill, and outcome.
Every response body is consumed with a frozen byte limit that is enforced while
streaming, with exact `Content-Length` validation when present. No unbounded
whole-body read is permitted before the limit check.
The verifier also derives the complete expected file and directory set from the
seed, manifest, decisions, attempts, and their referenced raw bodies. Any
unknown file, orphan body, missing sidecar, empty directory, link, reparse point,
or path outside the one lockbox root fails the entire chain.

Activation is forbidden unless independently reviewed written source terms or
an executed provider agreement specifically permit the automated retrieval,
indefinite retention, and intended publication/redistribution of the raw corpus
for every declared component, target, cash symbol, endpoint, and fallback—not
merely the seven executable instruments. The writing must also cover public
distribution of the binary derived signal, exchange/index-owner pass-through
rights, retained hashes and provenance, and survival of the required rights for
already acquired evidence after termination or later terms changes. A manifest
field, collector assertion, salesperson email, free-text `YES`, endpoint
availability, or successful request is not evidence of permission. The remote
branch must block force pushes and deletion and enforce the complete effective
rule for admins and every declared bypass actor.

After a decision JSON is canonically created, its SHA-256 must be submitted as
the subject of the manifest-pinned independent timestamp mechanism. Before any
artifact attestation is created, the decision must already embed the SHA-256 of
the exact compact-LF trusted-root JSONL bytes and the SHA-256 of an append-only
selection receipt identifying the authenticated root, signing key, transparency
log ID, and log key used for that event. Its separate immutable anchor proof
must cryptographically cover that exact decision hash, bind the declared public
repository and pinned signer workflow/run attempt, and prove an external
integrated time before the first eligible execution. Because Rekor truncates
integration timestamps to whole seconds, every signal-known-before-integration
comparison is made at whole-second precision — the integration second must be
no earlier than the signal-known instant floored to its second — in both the
anchor-receipt layer and the offline TUF replay layer. The execution deadline is
independently derived from the frozen signed session calendar and the recorded
decision date; a caller-supplied deadline is never authoritative. A one-time
free-text service reference, Git commit, GitHub API timestamp, unsigned receipt,
or merely uploaded attestation is insufficient. Strict-JSON TUF metadata,
selection receipts, and compact trusted-root JSONL inputs are rejected when
their raw bytes begin with a UTF-8 byte-order mark, so two byte-distinct
encodings of the same metadata can never both be valid chain links. Missing or
unverifiable per-decision proof blocks the decision from the trusted endpoint.
One static Sigstore trusted-root snapshot is not a long-horizon policy because
the signing and transparency-log roots rotate. Activation remains blocked until
a separately frozen TUF bootstrap and append-only archive can authenticate and
offline-replay the complete root, timestamp, snapshot, targets, and selected
trusted-root update chain for every decision. Log selection is made by the
authenticated log ID/key in that event's trusted material rather than a
hard-coded historical Rekor URL. In every replay — event-time and
current-policy alike — the selected log key's validity window is checked
against the entry's Rekor integration time, never against the replay
wall-clock, so a routine log-key rotation recorded in the current trusted root
cannot retroactively invalidate honest historical evidence; freshness,
rollback-floor, and root-chain expiry checks continue to use the replay's own
policy time. Verification must replay the event-time policy
and also revalidate the evidence under the current frozen acceptance policy. A
receipt cannot nominate its own new root, and a cryptographically valid
single-event test is not endpoint readiness. A local offline verifier now
supports the exact pinned Sigstore root-10 bootstrap, sequential threshold root
rotation with thresholds counted over distinct verified key material (the
canonical parsed public-key projection), never over distinct keyids,
timestamp/snapshot/targets replay, rollback/freeze/mix-and-match
checks, dynamic log selection, and separate event-time/current-policy selection
receipts for one decision. That layer deliberately does not verify the Sigstore
bundle cryptography and cannot establish complete per-decision coverage. No
collector creates the required bindings, no append-only production TUF archive
or calendar-derived deadline chain exists, and the full verifier does not yet
compose these checks; activation therefore remains blocked.

## Frozen trust verdict

`OPERATIONAL` means only that the implementation is deterministic, causal,
binary, and replayable. `TRUSTED` is forbidden until one unchanged manifest has
all of the following:

- at least exactly 1,095 elapsed 24-hour periods since the activation decision's
  recorded UTC time;
- the evaluation window is exactly the first 756 decision origins after the
  activation bundle in every market; it is never extended or replaced;
- zero `missedDecisionDates` from activation through the 756th origin's final
  outcome date, inclusive;
- all 756 origins have finite same-origin M0/M1 predictions, at least 252 valid
  matured training rows, a valid current row and fit (an exact zero-factor fit
  is valid), a strict next-session fill, and a valid following-session outcome;
- any missing, invalid, warm-up, failed-fit, duplicate, out-of-order, or
  unresolved origin in that fixed window fails coverage rather than extending
  the window;
- zero chain, identity, overwrite, timing, or unresolved data-integrity errors;
- identical M0/M1 forecast origin sets;
- M1 prequential MSE, computed on the identical 756 unrounded relative-log-return
  outcomes with denominator 756, no greater than `0.995 * M0 MSE` in every
  market; M0 MSE must be finite and strictly positive;
- M1 after-stress-cost wealth above both M0 and buy-and-hold in every market;
- a one-sided Clark-West comparison using
  `d=e0^2-e1^2+(f0-f1)^2`, population-denominator Newey-West lag 5, Bartlett
  weight `1-h/6`, and the pinned Cephes normal survival approximation; nonpositive
  or nonfinite long-run variance fails closed with `p=1`;
- Holm step-down across exactly six markets at family-wise 5%, sorting ascending
  p-values and breaking exact ties by the frozen market order; all six nulls
  must be rejected; and
- M1 after-stress-cost terminal wealth at least exactly
  `2.0 * buy-and-hold terminal wealth` in every market. This 2x gate is
  mandatory for `TRUSTED`, even if no public 2x wording is planned.

Wealth starts at 1.0 at the activation close with M0, M1, and buy-and-hold
already `LONG`. The activation decision, followed by the first 756
post-activation decision origins, supplies the queued target-state ledger.
Each interval first earns the risky or BIL adjusted-close factor for the
position held over that interval; the prior eligible decision then fills, and
`(1-c)` is charged exactly once only on a state change. The activation fill and
outcome must each appear exactly once at their two later sessions. M0/M1 use the
same stress-hurdle target-state decisions for primary- and stress-cost replays.
Buy-and-hold remains long and has no transition cost. There is no terminal
liquidation. All comparisons use unrounded IEEE-754 binary64 values.

The standalone numerical evaluator can produce only a statistical-gates result;
it has no authority to emit `TRUSTED`. The full lockbox verifier may compose a
trust verdict only after independently verifying raw acquisition and replay,
Git and workflow binding, closed inventory, complete remote-run reconciliation,
effective branch policy, and every per-decision TUF selection receipt and
attestation. Until those checks are implemented and pass, the only possible
full-system verdict is `NOT_TRUSTED` regardless of statistical output.

No interim performance result may tune, replace, extend, stop, or graduate this
candidate. Progress reporting may disclose counts, integrity, and data gaps,
but the fixed endpoint verdict is produced only after the full gate. Failure of
any universal condition is `NOT_TRUSTED`; it is never averaged away.

No mathematical method guarantees a 2x result. This protocol is designed to
make failure undeniable rather than make success inevitable.
