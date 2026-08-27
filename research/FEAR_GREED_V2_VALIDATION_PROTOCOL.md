# Production Fear & Greed v2 validation protocol

Status: frozen at `2026-08-25T12:42:53.927Z` for one schema-5 retrospective-development collection with challenger ranking enabled. Frozen does not mean validated, confirmatory or reliable.

The following three machine-readable lines are an executable safety gate. They must remain exactly as written during draft review. Freezing requires one deliberate edit that changes the marker to `FROZEN_SCHEMA5_V2_VALIDATION_V1`, replaces `NOT_FROZEN` with a precise ISO-8601 UTC timestamp, and retains `rankChallengers=true`. The runner rejects live collection for every other state. Replay does not consume the one-run gate.

<!-- SCHEMA5_FREEZE_MARKER: FROZEN_SCHEMA5_V2_VALIDATION_V1 -->
<!-- SCHEMA5_FREEZE_AT: 2026-08-25T12:42:53.927Z -->
<!-- SCHEMA5_FREEZE_MODE: rankChallengers=true -->

After freeze, a live run must explicitly request `rankChallengers=true`. Before network access, the runner atomically acquires one global schema-5 collection lock. Immediately after the one snapshot is successfully written, it atomically creates a persistent receipt containing the snapshot hash and releases its own lock. The receipt permanently blocks a second live collection. Only a failed attempt that stops during pre-snapshot collection may remove the lock it acquired; later failures require manual audit. The protocol freeze timestamp and the later data-collection timestamp are separate fields. Production live execution always parses the on-disk protocol and always uses the one canonical lock/receipt path; programmatic overrides are rejected. The isolated synthetic-test seam requires an injected collector and therefore cannot select the production network collector.

## Scope and interpretation

This study audits the exact production model v2 shown by the dashboard. It also permits one bounded, optional challenger ranking for development of a later model version. It does not create a new historical holdout.

All market history through the later schema-5 collection time is treated as **retrospective prequential development data**; the protocol freeze time and data-collection time are distinct. Earlier v1/schema-3 and schema-4 work already exposed market outcomes, and the four securities tabs retain the same benchmarks and inputs. The Crypto v2 benchmark is different, but it is built from fixed August 2026 constituents and is correlated with previously inspected crypto history. Therefore no pre-freeze result may be labelled validated, historically promising, confirmatory or reliable.

The schema-5 runner must always return:

`RETROSPECTIVE_DEVELOPMENT_ONLY_NO_CONFIRMATORY_OUTCOME`

Historical development can reject production v2 or nominate a separately versioned prospective challenger. Only append-only signals recorded after the freeze can eventually provide confirmation.

## Exact production v2 identity

All five tabs use `investments-unified-fear-greed` version 2, Yahoo history range `max`, window 252, minimum 126 percentile observations, all-six minimum components and seven-calendar-day carry with the same raw six-component engine:

1. momentum;
2. strength;
3. inverted volatility;
4. safe-haven demand;
5. credit appetite;
6. breadth.

Every raw component retains the production 252-observation percentile window, 126-valid-observation minimum, direction, formula and at-most-seven-calendar-day carry rule. Every admitted score row must contain all six components.

The configured targets are:

| Tab | Benchmark and return target | Annualization for controls/outcomes |
|---|---|---:|
| Crypto | `CRYPTO-BROAD-EW` | 365 |
| Sweden | `^OMXSBGI` | 252 |
| USA | `SPY` | 252 |
| Europe | `^STOXX` | 252 |
| Global | `ACWI` | 252 |

Crypto production v2 is frozen as:

- benchmark: `CRYPTO-BROAD-EW`, a daily-rebalanced equal-weight return index of BTC, ETH, SOL, XRP, ADA, DOGE and BNB;
- volatility source: realised volatility of `CRYPTO-BROAD-EW`;
- safe haven: `IEF`;
- credit: `HYG/LQD`;
- breadth: `CRYPTO-NONCORE-EW / CRYPTO-CORE-EW`, where NONCORE contains SOL/XRP/ADA/DOGE/BNB and CORE contains BTC/ETH.

The complete production symbol objects are frozen, not merely the return targets:

- Crypto: `index=CRYPTO-BROAD-EW(BTC-USD,ETH-USD,SOL-USD,XRP-USD,ADA-USD,DOGE-USD,BNB-USD; equalWeightReturns)`, `vol=null`, `bond=IEF`, `hy=HYG`, `ig=LQD`, `small=CRYPTO-NONCORE-EW(SOL-USD,XRP-USD,ADA-USD,DOGE-USD,BNB-USD; equalWeightReturns)`, `large=CRYPTO-CORE-EW(BTC-USD,ETH-USD; equalWeightReturns)`; bar policy `completed-utc-date`.
- Sweden: `index=^OMXSBGI`, `vol=null`, `bond=XACT-OBLIGATION.ST`, `hy=0P0001C87Y.ST`, `ig=0P00000KIW.ST`, `small=XACT-SMABOLAG.ST`, `large=XACT-SVERIGE.ST`.
- USA: `index=SPY`, `vol=^VIX`, `bond=IEF`, `hy=HYG`, `ig=LQD`, `small=IWM`, `large=null`.
- Europe: `index=^STOXX`, `vol=null`, `bond=SXRQ.DE`, `hy=IHYG.L`, `ig=IEAC.L`, `small=EXSE.DE`, `large=EXSA.DE`.
- Global: `index=ACWI`, `vol=^VIX`, `bond=IEF`, `hy=HYLD.L`, `ig=CORP.L`, `small=WSML.L`, `large=IWDA.L`.

The three synthetic indices must be constructed by the same strict common-date `equalWeightReturns` adapter used by production. Each starts at 100 on the first date common to every frozen constituent and is multiplied thereafter by one plus the arithmetic mean of constituent simple returns. Missing a constituent is an error; the basket must never narrow silently.

`CRYPTO-BROAD-EW` is a fixed analytical backcast, not literally every coin, not market-cap weighted, not directly investable and not a point-in-time total-market universe. Its fixed August 2026 membership creates constituent-selection and survivorship risk in history. That limitation does not disappear merely because every price calculation is causal conditional on the fixed membership.

## Primary production audit

The production audit contains exactly one candidate:

- id: `equal_s1`;
- weights: `[1,1,1,1,1,1]`, normalized to one sixth each;
- smoothing: one observation;
- score: the exact 0.1-point value published by `marketfg.js`, not a hidden higher-precision reconstruction.

As a mandatory identity diagnostic, each saved row is independently recomputed by summing the six full-precision component scores in the production insertion order above, dividing by six, and applying native JavaScript `Math.round(mean * 10) / 10`. It must equal the serialized published score exactly. Every component `asOf` date must be no later than the signal and no more than seven calendar days old, inclusive.

The primary target is the strictly later 21-bar simple benchmark return. Future 21-bar log realised volatility may be reported as a secondary outcome for the same `equal_s1` score, but it cannot select a separate model or rescue return prediction. Invalid or zero future volatility removes a row only from the secondary risk sample; it must remain in the primary return sample, primary split, return adequacy calculation and challenger ranking.

## Optional challenger development family

The optional search is capped at exactly 15 total candidates, including production `equal_s1`. It may never expand after results are seen.

The component order is momentum, strength, volatility, safe haven, credit and breadth. Five positive weight templates are frozen:

- equal: `[1,1,1,1,1,1]`;
- trend and breadth: `[2,2,1,1,1,2]`;
- defensive risk: `[1,1,2,2,2,1]`;
- price regime: `[2,2,2,1,1,1]`;
- cross-asset risk: `[1,1,1,2,2,2]`.

Each template is evaluated with a trailing causal arithmetic mean of 1, 5 or 21 signal observations. All templates retain strictly positive weights and all six components. Challenger composites use the full causal component scores recorded by `includeHistoryParts`; only `equal_s1` is replaced by the exact published 0.1-point production score.

No component deletion, market-specific weight, negative weight, interaction, nonlinear learner, threshold, band optimization, alternative primary horizon or separate risk-model search is allowed. A selected challenger is only a prospective v3 candidate; it cannot validate production v2.

## Alignment, controls and outcomes

All 15 candidates use an identical per-market row set. The first 20 otherwise eligible candidate-score rows are discarded so 1-, 5- and 21-observation smoothing cannot change sample membership.

For a score on target bar `t`:

- hypothetical entry is the close of `t+1`;
- the 21-bar outcome exits at the close of `t+22`;
- future risk is the log of annualized realised volatility over those same 21 later returns;
- a training row is available at a refit origin only when its exit index is at or before that origin's signal index.

There is no same-bar execution. Signal and target dates must match exactly. Missing scores are not filled. Current or incomplete provider bars are excluded before synthetic targets and components are constructed.

Completed-bar handling is a frozen research wrapper around the unchanged production engine. Production configuration itself declares `completed-utc-date` only for Crypto. For this historical audit, every Yahoo source is first normalized in its own exchange timezone and its retrieval-local calendar date plus all later dates are removed; those completed histories are then passed to the same production engine. The snapshot separately records the effective Crypto UTC cutoff as the UTC calendar date of the common collection timestamp. Replay must reproduce each per-source cutoff from its frozen payload, timezone and that timestamp; the prefiltered rows make the later wall clock irrelevant. Whole-series adjusted-close versus raw-close identity is frozen per source and may never be mixed.

The controls-only OLS contains information available at `t`:

- lagged 1-, 5- and 20-bar returns;
- trailing 20-bar realised volatility;
- benchmark close relative to its trailing 125-bar average.

The full OLS adds one candidate score. Features are standardized only from that fit's available training rows. Singular fits fail; no ridge, fallback or silent regularization is permitted.

## Retrospective prequential development

There is no historical final or holdout segment.

For each market:

1. construct the candidate-common eligible rows;
2. reserve the first 252 eligible rows as the initial fitting seed;
3. forecast every remaining pre-freeze row with an expanding origin;
4. refit every 21 forecast observations;
5. at every refit, purge every training row whose `t+22` exit is not yet known.

The production `equal_s1` audit is always calculated. If challenger ranking was frozen on for that snapshot, all 15 candidates are evaluated once on the same development rows and ranked lexicographically by:

1. greatest number of markets with positive relative MSE improvement over controls;
2. greatest worst-market improvement;
3. greatest equal-market mean improvement;
4. fixed declaration order.

A challenger nomination gate requires positive improvement in all five markets, an equal-market mean improvement of at least 0.5%, and one common non-zero coefficient sign in at least 70% of refit blocks within every market. Failing the gate ends challenger development; no sixteenth candidate or historical rerun is allowed.

The schema-5 frozen design stores every candidate's raw and normalized weights, smoothing window and declaration order, the exact lexicographic ranking rules above, and every nomination threshold. Candidate IDs alone are insufficient provenance.

The ranking and gate are development diagnostics only. They carry no historical significance or reliability claim because the history has already been reused.

## Data-adequacy reporting

For each market's development forecast segment, report:

- forecast-row count;
- greedy non-overlapping 21-bar outcome count, admitting the next row only when its entry index is at or after the previously admitted exit index;
- calendar days from first development entry through last development exit.

The prior conservative reference minimums remain visible: 756 forecast rows, 36 non-overlapping outcomes and 1,095 calendar days. They are an adequacy screen, not a formal power guarantee. Failing them forces an `UNDERPOWERED` development label, but passing them still does not turn reused history into confirmation.

## Descriptive inference

Report raw relative MSE improvement, refit-block coefficient signs and one-sided Newey-West paired loss-improvement statistics with bandwidth at least 21. Apply Benjamini-Hochberg across the complete five-tab family for the fixed production score. If any one of the five predeclared statistics is unavailable, suppress every adjusted q-value rather than silently shrinking the family. These historical p/q values are descriptive only and cannot create a pass status.

Because controls-only is nested within controls-plus-score, the future confirmatory protocol should additionally freeze an appropriate nested-forecast test such as Clark-West before prospective outcomes are inspected. Schema 5 does not consume or simulate that future confirmation.

## Future confirmation, not executed here

After production code and this design are frozen, create append-only point-in-time signal records. Any change to components, weights, smoothing, membership, benchmark, carry rules, controls, horizon, rounding or inference resets the clock under a new version.

Evaluate prospective confirmation once, based only on data availability, when every tab has at least:

- 756 prospective forecast rows;
- 36 greedy non-overlapping 21-bar outcomes;
- 1,095 calendar days from first prospective entry through last evaluated exit.

No interim significance stopping is allowed. The fixed production candidate must improve raw MSE by at least 0.5% in every tab, survive the predeclared nested-model test with BH adjustment across five tabs, and retain its frozen coefficient sign in at least 70% of refit blocks. All five tabs must pass. Trading reliability would still require identified instruments and realistic costs.

## Integrity and artifacts

A live schema-5 development run must freeze before analysis:

- exact production mappings and model identity;
- normalized target prices and six-component histories;
- exact published 0.1 production scores;
- every raw Yahoo response payload, response hash, deterministic normalized source row and normalized-series hash for the exact unique configured dependency-symbol set;
- derived synthetic-target construction, constituents and row hash;
- retrieval and partial-bar policies;
- hashes of `marketfg.js`, `data/config.json`, the schema-5 runner, this protocol and any imported analysis-math dependency;
- whether challenger ranking is enabled;
- a canonical schema-5 JSON snapshot and SHA-256 sidecar.

Replay decodes and hashes every saved Yahoo payload, verifies Yahoo `meta.symbol`, the query1/query2 HTTPS chart path, encoded symbol, `period1=0`, collection-derived `period2`, daily interval and event query, re-runs the frozen deterministic Yahoo normalization, and verifies all normalized source rows and metadata. It reconstructs every configured return target—including the strict-common-date Crypto basket—and compares the reconstructed rows with the saved target. It then reruns `marketfg.computeMarket` from those reconstructed sources with the frozen mappings/options and requires the entire normalized six-component signal history to equal the saved signals exactly. It also verifies the exact current Node version and platform. Signal dates must be valid target dates; every component as-of date must be a valid non-empty date no later than its signal date. For each row, the arithmetic mean of the exact six stored component scores, rounded by the production 0.1-point rule, must equal the saved published `equal_s1` score.

Saved replay must use no network, verify all frozen source hashes and reproduce the analysis fingerprint. JSON and Markdown results receive separate SHA-256 sidecars. Schema-1/2/3/4 files and artifacts remain immutable.

## Primary methodological references

- Halbert White, *A Reality Check for Data Snooping*: https://doi.org/10.1111/1468-0262.00152
- Clark and West, *Approximately Normal Tests for Equal Predictive Accuracy in Nested Models*: https://doi.org/10.1016/j.jeconom.2006.05.023
- Giacomini and White, *Tests of Conditional Predictive Ability*: https://doi.org/10.1111/j.1468-0262.2006.00718.x
- Harvey, Liu and Zhu, *... and the Cross-Section of Expected Returns*: https://www.nber.org/papers/w20592
