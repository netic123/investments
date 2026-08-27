# Component-fragility tail-risk falsification protocol

<!-- COMPONENT_FRAGILITY_TAIL_FREEZE_MARKER: FROZEN_COMPONENT_FRAGILITY_TAIL_V1 -->
<!-- COMPONENT_FRAGILITY_TAIL_HYPOTHESIS_SPEC_FREEZE_AT: 2026-08-26T07:41:46.961Z -->
<!-- COMPONENT_FRAGILITY_TAIL_INITIAL_INTEGRITY_FREEZE_AT: 2026-08-26T08:30:34.171Z -->
<!-- COMPONENT_FRAGILITY_TAIL_DISCLOSURE_REFREEZE_AT: 2026-08-26T08:39:10.443Z -->
<!-- COMPONENT_FRAGILITY_TAIL_FINAL_NUMERICAL_INTEGRITY_REFREEZE_AT: 2026-08-26T08:48:51.262Z -->

Status: **the core statistical hypothesis was frozen at the first timestamp;
initial integrity code at the second; an input-access disclosure at the third;
and final fail-closed numerical-underflow plus invocation/export hardening at the
fourth, all before any component-fragility production-snapshot outcome was
computed. The fourth refreeze changes only invalid/underflow inference handling,
not the feature, timing, model, threshold, market family, or stop rule: finite
nonconstant data whose HAC variance underflows to zero now fail inference instead
of being treated as significant.
Retrospective cross-market falsification only; not validated, investable, or
approved for production**.

This protocol tests one new question. It does not search weights, thresholds,
lookbacks, markets, or exposure rules:

> Does disagreement between the dashboard's six component scores, when combined
> with synchronized component weakening, improve a fixed model's forecast of
> the next 21-return-interval maximum drawdown beyond the current score and
> ordinary price/volatility controls?

The dashboard components are engineered market indicators. Their dispersion is
**not** a survey of investor beliefs and must not be called investor
disagreement. Research on investor disagreement and crash risk is motivation
for asking the question, not evidence that this proxy works. In particular, the
Hong--Stein differences-of-opinion model and later direct disagreement studies
use economically different measurements:

- https://www.nber.org/papers/w7376
- https://www.nber.org/papers/w18619

## Exact retrospective input

The only admissible production input is the canonical schema-5 snapshot:

- `research/local-artifacts/v2-validation-final/inputs/fear-greed-v2-validation-input-2026-08-25T12-44-22Z.json`
- sidecar `research/local-artifacts/v2-validation-final/inputs/fear-greed-v2-validation-input-2026-08-25T12-44-22Z.sha256`
- SHA-256 `ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d`
- status `RETROSPECTIVE_DEVELOPMENT_ONLY_NO_CONFIRMATORY_OUTCOME`
- last completed target date 24 August 2026.

The adjacent sidecar must exist and agree before the JSON is parsed. The input
must validate through the frozen schema-5 reader. The five markets are exactly,
and in this fixed order, `crypto`, `sweden`, `usa`, `europe`, and `global`.
Every admitted signal has all six components in this exact order: `momentum`,
`strength`, `volatility`, `safeHaven`, `credit`, and `breadth`.

The source limitations are part of the result, not optional footnotes. Crypto is
a daily-rebalanced equal-weight basket of seven constituents selected with
August 2026 knowledge and is a synthetic spot-price-return basket, not a
point-in-time, survivorship-free all-coin index. Sweden is Nasdaq `OMXSBGI` in
SEK, whose provider definition is gross total return. USA is SPY adjusted close
in USD, a dividend-adjusted ETF market-price total-return proxy rather than the
S&P 500 index itself. Europe is the STOXX Europe 600 price-index series
`^STOXX` in EUR and excludes dividends. Global is ACWI adjusted close in USD, a
dividend-adjusted ETF market-price total-return proxy rather than official MSCI
index return. Yahoo histories are current-vintage research data, not a licensed
point-in-time archive. Those facts prevent a positive result from establishing
a like-for-like live, executable universal edge.

## Causal observation construction

For a signal dated at target close `t`, require an exact target-price row on
that date. No signal or price is forward-filled or interpolated. Features use
only data ending at `t`. The forecast origin is the next target close `t+1`.
The outcome path ends at `t+22`, which contains exactly 21 close-to-close return
intervals after the origin.

At least 125 prior target closes, an exact signal at target bar `t-5`, and a
complete outcome through `t+22` are required. An ineligible row is counted and
reported; it is never silently repaired.

Here `t-5` means price-row index `j-5` when `t` is target-price row index `j`.
That exact earlier target-price date must itself have an all-six signal. It is
not the fifth previous eligible signal or the fifth previous calendar day.

Let the six full-precision component scores at target bar `t` be
`s_1(t),...,s_6(t)` and let their mean be `m(t)`.

Component dispersion is:

```
D(t) = sqrt(mean_i((s_i(t) - m(t))^2)) / 100
```

Component weakening over exactly five target bars is:

```
W(t) = sqrt(mean_i(max(0, s_i(t-5) - s_i(t))^2)) / 100
```

The sole added predictor is the interaction:

```
F(t) = D(t) * W(t)
```

There is no alternate dispersion estimator, change window, positive-change
term, smoothing, threshold, component deletion, component weight, or
market-specific definition.

The controls-only model `M0` contains an intercept and exactly these seven
features:

1. the exact stored published 0.1-point score divided by 100;
2. trailing log return `log(P(t) / P(t-1))`;
3. trailing log return `log(P(t) / P(t-5))`;
4. trailing log return `log(P(t) / P(t-20))`;
5. the unannualized sample standard deviation of the last 20 log returns;
6. `log(P(t) / arithmeticMean(P(t-124),...,P(t)))`; and
7. nonnegative current 63-target-close log drawdown magnitude
   `log(max(P(t-62),...,P(t)) / P(t))`.

The full model `M1` is byte-identical to `M0` plus exactly `F(t)`. Every feature
is standardized once using the exact training weights below. For feature `x`,
with training-row weights summing to one, use `mu = sum(w*x)` and
`scale = sqrt(sum(w*(x-mu)^2))`. A nonfinite or nonpositive scale is
`UNIDENTIFIABLE`. The outcome is not standardized. Both models are weighted
least squares with an intercept, solved once. There is no ridge penalty,
variable selection, market dummy, refit, or hyperparameter.

## Tail outcome

Initialize the future running peak at `P(t+1)`. On the path from `t+1` through
`t+22`, define nonnegative maximum log-drawdown magnitude:

```
D21(t) = max_{t+1 <= k <= j <= t+22}(log(P(k) / P(j)))
```

Let `sigma20(t)` be the sample standard deviation of the 20 log returns ending
at `t`, without annualization. The common scale for a 21-interval horizon is
`sigma20(t) * sqrt(21)`. It must be finite and strictly positive. The exact
continuous outcome is:

```
Y(t) = log(1 + D21(t) / (sigma20(t) * sqrt(21)))
```

This definition makes larger values worse. It uses a nonnegative loss magnitude
and therefore has no drawdown-sign ambiguity. No cap, winsorization, event
threshold, quantile choice, or market-specific normalization is allowed.

## Frozen chronology and shared fit

The pooled training sample contains exactly every eligible USA and Europe row
whose outcome exit date is no later than 31 December 2018. No other market is
admitted to the fit.

If `n_USA` and `n_Europe` are their admitted row counts, every USA row receives
weight `0.5 / n_USA` and every Europe row receives weight
`0.5 / n_Europe`, so the weights sum to one. This
prevents the longer USA history from mechanically defining the allegedly
universal coefficient. `M0` and `M1` are each fitted exactly once to that pooled
pre-2019 sample. The
same fitted coefficients, training means, and training scales are then held
fixed for every evaluation forecast in all five markets. No market can refit or
calibrate the model.

The evaluation sample contains every eligible row with entry date on or after
1 January 2019. A training outcome may not cross the cutoff. Any crossing row is
dropped from both models. The evaluation
history is a chronological pseudo-holdout only: these dates and related returns
have already been inspected in earlier repository research, so the result is
not confirmatory or genuinely untouched.

Both standardized designs are solved by deterministic two-pass modified
Gram--Schmidt QR in declared column order on rows multiplied by `sqrt(weight)`.
For each new column, subtract projections on every prior orthonormal column in
order, repeat that full projection pass once, then take the Euclidean norm. A
diagonal norm that is nonfinite or `<= 1e-10` is rank failure. Back-substitution
uses the resulting upper-triangular `R` without pivoting. No `X'WX` rank test,
ridge, pseudoinverse, feature drop, or fallback fit is permitted.

Before fitting `M1`, project its standardized `F(t)` column on the standardized
`M0` design with that exact weighted QR. Its weighted residual variance is
`sum(w * residual^2)`; a nonfinite value or value `<= 1e-12` is
`UNIDENTIFIABLE`. As a sign-stability diagnostic, fit the same standardized
`M1` separately to the USA training rows and to the Europe training rows,
retaining the pooled training means and scales without restandardizing by
market. Within each diagnostic fit, rows have equal weights summing to one and
the same QR/tolerances apply. The pooled, USA-only, and Europe-only standardized fragility coefficients
must all be strictly positive. The separate fits never replace the shared
pooled model used for forecasts.

## Forecast metrics and inference

For each market, report `M0` and `M1` mean squared error and:

```
relative improvement = (MSE_M0 - MSE_M1) / MSE_M0
```

For nested-model inference, calculate the Clark--West adjusted loss on each
evaluation row:

```
e0^2 - e1^2 + (forecast_M0 - forecast_M1)^2
```

Use a deterministic one-sided positive-mean Newey--West test with bandwidth
exactly `L=21` forecast rows. If adjusted losses are `a_0,...,a_(n-1)` and their
mean is `a_bar`, define `c_i=a_i-a_bar`,
`gamma_l=sum_{i=l}^{n-1}(c_i*c_(i-l))/n`, and:

```
LRV = gamma_0 + 2 * sum_{l=1}^{21}((1 - l/22) * gamma_l)
SE  = sqrt(LRV / n)
z   = a_bar / SE
p   = 1 - Phi(z)
```

`Phi` is the standard-normal CDF calculated by the fixed runner's
Abramowitz--Stegun erf approximation with `p=0.3275911` and coefficients
`0.254829592`, `-0.284496736`, `1.421413741`, `-1.453152027`, and
`1.061405429`. If `LRV` is negative or nonfinite, the statistic is missing and
the gate fails. If `LRV` is exactly zero and every represented adjusted-loss
value is exactly identical, set `p=0` only when `a_bar>0`; otherwise set `p=1`.
If `LRV` rounds to exactly zero for finite but non-identical represented values,
treat the standard error, z statistic, and p-value as missing so numerical
underflow can never become false significance. Clamp a finite calculated
p-value to `[0,1]`.
Every nonfinite returned HAC field is serialized as JSON `null`; a data-induced
missing statistic is a failed inference gate, not an input or code-integrity
exception.

Apply Holm step-down family-wise adjustment across exactly the five market
p-values. Sort ascending by raw p-value and use the fixed market order as the
tie break. At zero-based sorted rank `r`, compute
`rawAdjusted=min(1,(5-r)*p_r)` and set the final adjusted value to the running
maximum of this value and all earlier sorted ranks. Map results back to fixed
market order. A missing, nonfinite, negative, or greater-than-one member makes
the complete inference gate fail; it is never omitted from the family.

For every market, also report the evaluation row count, the first entry date,
the last exit date, calendar span, and a greedy non-overlapping outcome count.
Calendar span is exactly
`(UTC(lastExitDate)-UTC(firstEntryDate))/86_400_000` using ISO midnight UTC;
there is no inclusive-day addition or rounding.
The greedy rule admits a chronological row when its entry index is at least the
previously admitted row's exit index.

## One immutable pass gate

The hypothesis passes only if **all** of the following hold on exact unrounded
values:

1. the pooled, USA-only, and Europe-only `M1` coefficients on standardized
   `F(t)` are all strictly positive;
2. every market has at least 756 evaluation forecasts;
3. every market has at least 36 greedy non-overlapping outcomes;
4. every market spans at least 1,095 calendar days from first entry to last
   exit;
5. `M1` relative MSE improvement is strictly greater than 0.5% in every market;
6. every raw one-sided Clark--West p-value is finite; and
7. every Holm-adjusted p-value is strictly below 0.05.

Every prediction, error, squared error, and MSE must be finite, and every
market's `MSE_M0` must be strictly positive. Otherwise its numeric/inference
gate fails.

Equality at the performance or significance boundary fails. A pooled average,
one strong market, lower drawdown in an unrelated trading simulation, or a
visually appealing chart cannot rescue a failed gate.

Status precedence is fixed. An input, checksum, code-freeze, path, or write
integrity error throws and creates no result. Otherwise evaluate in this order:

1. `UNIDENTIFIABLE`;
2. `UNDERPOWERED`;
3. `NO_COMPONENT_FRAGILITY_TAIL_SIGNAL`; and
4. `TAIL_FORECAST_GATE_PASSED_RETROSPECTIVE_ONLY`.

The only permitted result statuses are therefore:

- `UNIDENTIFIABLE` when the common rows or fixed designs cannot be estimated as
  declared;
- `UNDERPOWERED` when any market misses a data-adequacy gate;
- `NO_COMPONENT_FRAGILITY_TAIL_SIGNAL` when the data are adequate but any
  directional, MSE, or inference gate fails; or
- `TAIL_FORECAST_GATE_PASSED_RETROSPECTIVE_ONLY`.

## Stop rule and economic boundary

This runner implements no exposure mapping and computes no strategy wealth. If
the forecast gate fails, this exact hypothesis stops. Its threshold, horizon,
normalization, features, cutoff, or required market count may not be altered in
response to the outcome.

If, and only if, the gate passes, a separate one-rule economic protocol may be
frozen before any mapping-to-exposure wealth is inspected. Even then, a
retrospective strategy win would require matched next-close execution, cash and
funding returns, transaction costs, full histories, independently restarted
halves, common-calendar robustness, and a prospective append-only lockbox before
capital could rely on it.

## Immutable launch, attempt, and publication gate

The only production command is, with no arguments:

`node research/component_fragility_tail_risk_launcher.js`

The launcher must be the direct CommonJS script entry. It rejects imported
`main` execution (and does not export `main`), every script argument, every Node
`execArgv` preload/loader/inspector/eval option, nonempty `NODE_OPTIONS`, a script
path other than the exact launcher, and any other repository-local module already
present in `require.cache`. Its receipt records the clean direct-entry evidence.
The runner's receipt verifier, schema loader, real-input reader, and production
analysis chain are internal and are not exported. These controls establish the
authorized cooperating command path; they do not claim that a repository owner
cannot copy the source or raw retrospective data and run different code.

The exact launcher is `research/component_fragility_tail_risk_launcher.js` and
the exact freeze manifest is
`research/component-fragility-tail-risk-freeze-v1.json`. The fixed annotated
pre-outcome Git tag is `component-fragility-tail-risk-v1-preoutcome`. The tag is
created only after independent review of the synthetic tests and freeze
manifest. Once created it may not be force-moved, replaced, or deleted.
The frozen runtime is Node `v22.19.0` on `win32` `x64`.

An ordinary annotated tag is a procedural accidental-drift control, not a
cryptographically immutable external timestamp: an administrator who can
rewrite Git refs can replace it. Adversarial tamper evidence would additionally
require a signed tag with a pre-pinned signer or publication of the tag-object
ID outside this repository. No signing identity is configured for this local
experiment, so this protocol does not claim that stronger property.

Before any production input sidecar or JSON bytes are opened, the launcher and
runner independently require all of the following:

1. `HEAD` is exactly the commit named by that annotated tag in an isolated
   linked Git worktree;
2. the manifest bytes are tracked, committed, clean, canonical JSON, and
   byte-identical to the manifest at the tag;
3. the manifest lists the exact repository paths, SHA-256 values, and Git blob
   identities of this protocol, the runner, the synthetic test, the launcher,
   the schema-5 protocol and reader, the schema-4 research-math module,
   `marketfg.js`, and `data/config.json`; and
4. every listed working-tree file is tracked, committed, clean, has the exact
   manifest SHA-256 and Git blob identity, and is byte-identical to its blob at
   the fixed tag.

The schema-5 reader is not loaded at runner module initialization. Its raw bytes
and all transitive research-math/configuration bytes above are verified against
the manifest and fixed tag before the runner loads that reader.

After those checks and confirmation that the result directory is absent, but
before the runner or schema-5 reader is loaded or any input bytes are opened,
the built-in-only launcher permanently reserves the sole attempt for this Git
repository. The receipt is relative to the absolute directory returned by
`git rev-parse --path-format=absolute --git-common-dir`, not to a worktree:

`codex-one-shot-research/component-fragility-tail-v1/attempt-receipt-2026-08-26.json`

It exclusively opens, writes, flushes, closes, rereads, and hashes a complete
canonical receipt in a unique file on the same volume, then atomically hard-links
that file to the exact
receipt path with no-replace semantics. Because every linked worktree in one
repository resolves the same Git common directory, concurrent or later launches
from a second worktree contend for the same fixed receipt. The receipt records
that shared common directory, its absolute receipt path, the winning worktree
root and worktree Git directory, the experiment ID and common-directory-relative
receipt path, and the exact relative and absolute publication paths. An existing
receipt of any contents makes every later invocation fail
before local-module or input access; it is never repaired. The receipt is never
deleted or rewritten, including when loading, analysis, or publication fails.
It contains launch/code identities but no result, prediction, or strategy
outcome. Only after the fixed receipt is re-read successfully may the launcher
load the runner. The runner independently resolves the same Git common directory
and repeats the tag, manifest, byte, receipt, winning-worktree, publication-path,
and output-absence checks before it lazy-loads the schema-5 reader. Direct
execution of the runner is forbidden.

This one-shot boundary is repository-global across linked worktrees, not global
across separately cloned repositories. A separately copied clone can have its
own Git common directory and therefore its own receipt; stronger cross-clone
serialization would require an externally administered immutable registry.
It also assumes a local filesystem that provides reliable atomic same-volume
hard-link creation. It does not claim protection against a malicious writer or
administrator deleting or replacing the receipt or its parent through a
symlink/junction, network filesystems with weaker link semantics, or sudden
power loss before filesystem metadata is durably committed. The forced
concurrency test covers cooperating processes on the actual local filesystem,
not those stronger adversarial or durability conditions.

The preliminary receipt-existence check is only an early fail-closed check. The
successful no-replace `linkSync` operation is the sole concurrency linearization
point that selects the one winner. Cleanup removes the unique temporary file only
after this invocation successfully created it; a pre-existing colliding temporary
path is never deleted or repaired.

The sole final result directory is:

`research/local-artifacts/component-fragility-tail-v1`

It contains exactly:

- `component-fragility-tail-v1-result-2026-08-26.json`; and
- `component-fragility-tail-v1-result-2026-08-26.json.sha256`.

The runner writes both create-new files into one unique adjacent staging
directory, flushes and rereads them, verifies the sidecar against the result,
and only then publishes the whole directory with one same-volume atomic rename.
Any pre-rename failure leaves the final directory absent. On a rename failure,
the runner reports whether a destination appeared and never retries; it does not
delete that destination. The staging directory may be removed, but the
permanent attempt receipt remains.
No timestamped alternate, overwrite, replay output, caller-selected production
path, second attempt, or partial final-directory publication is permitted.

Node's portable directory rename is atomic but is not a cross-platform
`RENAME_NOREPLACE` primitive. The repository-global permanent receipt serializes
cooperating launchers in all linked worktrees and the runner checks destination
absence immediately before rename;
this prevents ordinary stale-output and concurrent-run overwrites. It does not
defend against an unrelated malicious filesystem process racing an empty target
directory into place. A native no-replace primitive or exclusive commit-pointer
design would be required for that stronger adversarial boundary.

The snapshot is pre-existing retrospective development data, already opened and
used by earlier model research. It was never a blinded or confirmatory outcome
set. The one-shot boundary seals only the first authorized cooperating execution,
evaluation, and publication of `COMPONENT_FRAGILITY_TAIL_V1`; it does not make
the raw snapshot secret or technically prevent unrelated processes or a
repository owner from reading it or invoking copied/pure research math. Within
the clean direct production launcher process, however, neither the sidecar nor
JSON bytes may be opened before the repository-global attempt receipt is
successfully reserved.

Exact preparation disclosure: after the statistical specification and integrity
code were frozen, but before the annotated tag or any component-fragility
production attempt existed, `node --test test/*.test.js` ran on 26 August 2026.
An unrelated pre-existing test, `test/fear_greed_v3_shadow.test.js`, read and
parsed the same schema-5 snapshot and recomputed the earlier v3 shadow analysis.
The component-fragility module was also loaded for its synthetic unit tests, but
no component-fragility production path read the snapshot, `main` was not invoked,
and no component-fragility coefficient, forecast, gate, or result was computed
from that production snapshot; no production publication existed. This full-suite
read violated the prior blanket preparation wording
that no synthetic test process could open the raw file; this disclosure replaces
that indefensible wording before the tag. It did not reveal the new hypothesis's
outcome. That disclosure itself changed no hypothesis, feature, timing, model,
threshold, market, gate, or status rule; the later fourth-timestamp fail-closed
numerical refreeze is separately stated above and in the HAC rule.

Focused component-fragility synthetic tests use only synthetic inputs and must
never compute this hypothesis on the production snapshot. With adequate data, a
nonfinite or missing numeric inference value terminates as
`NO_COMPONENT_FRAGILITY_TAIL_SIGNAL`; it is not promoted to an integrity
exception.
