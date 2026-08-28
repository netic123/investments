# Fear & Greed Long-History Proxy — Research Protocol (v1)

FG_LONG_HISTORY_PROXY_FREEZE_MARKER: DRAFT_NOT_FROZEN_2026_08_28

- Status: `DRAFT_NOT_FROZEN`
- Disclosure status constant: `RETROSPECTIVE_LONG_HISTORY_PROXY_DATA_ONLY_NOT_CONFIRMATORY`
- Variant id: `long-history-proxy-v1`
- Module: `research/fear_greed_long_history_proxy.js`
- Committed canonical mapping freeze: `research/FEAR_GREED_LONG_HISTORY_PROXY_MAPPING.json` (+ adjacent `.sha256` sidecar)
- Tests: `test/fear_greed_long_history_proxy.test.js`
- Bulk outputs (gitignored): `research/local-artifacts/long-history-proxy-v1/`
- `containsStrategyOutcomes: false` in every artifact this variant emits.

## 1. Purpose and hard scope limits

This is a RESEARCH-ONLY long-history variant of the production six-component
Fear & Greed engine. It exists to answer one question: how far back can the
same six-component composite be computed when each configured market instrument
is replaced by the longest-history instrument that still passes an identity
gate on Yahoo's daily feed?

The variant outputs component/score HISTORY and achieved spans only. It
contains **no signals, no backtests, no wealth curves, no allocations, and no
BUY/SELL output** of any kind (`includeExpandingSignal` is never enabled).
Nothing this variant produces is confirmatory evidence for anything.

## 2. Production and frozen experiments are untouched

- `marketfg.js` and `data/config.json` are READ-ONLY inputs. Production v2
  (`investments-unified-fear-greed`, version 2) is not modified in any way.
- All previously frozen experiments and their artifacts are untouched.
- **This variant's score history must never silently replace production
  history.** It is written only under `research/local-artifacts/long-history-proxy-v1/`
  with its own schema ids (`fear-greed-long-history-proxy-v1-*`), its own
  disclosure status, and per-market warnings; no server, page, ledger, or
  lockbox consumes it.

## 3. Engine identity

The engine is reused, not reimplemented. The module deep-clones the production
`config.marketFearGreed` shape, overwrites each market's `symbols` with the
frozen research mapping below, and calls marketfg's exported pure surface —
`computeMarket`, `collectSpecSymbols`, `resolveSeriesSpec`,
`equalWeightReturnSeries` — UNMODIFIED. Engine parameters stay
production-identical:

| parameter | value |
|---|---|
| range | max (fetched as `period1=0&interval=1d`) |
| window | 252 |
| minWindowPoints | 126 |
| minComponents | 6 |
| fillDays | 7 |

## 4. Selection rules (how the mapping was chosen)

1. **Identity first**: a candidate had to be the same economic object as the
   production slot (same asset class, same role in the component formula), with
   deviations recorded as an explicit `identityCaveat` per market/role.
2. **Probe-verified availability**: only instruments whose Yahoo daily history
   was actually probed count; claimed histories were not trusted (e.g. `^OMX`
   was rejected because its probed daily coverage starts 2008-11-20 despite the
   1986 index inception).
3. **Never outcomes**: no score output, backtest, or performance figure was
   consulted for any selection. Selections were frozen before this module ever
   computed a score.
4. **Cross-role consistency**: one credit pair (VWEHX/VWESX) across all
   substituted markets; breadth always swapped as a same-family pair
   (NAESX/VFINX, DFCSX/VEURX, or fixed crypto baskets); one bond instrument
   (FGOVX) across all substituted markets.

## 5. NO-SPLICE rule

Each instrument is the **sole whole-history primary** for its market/role.
Earlier or later data from any other instrument or source must never be
prepended, appended, or blended into a slot series. In particular, the Yahoo
1980-01-02 mutual-fund feed floor is treated as the frozen research span start
— it is a **feed floor, not fund inception** — and must not be extended by
splicing another data source. The crypto baskets are one fixed membership over
their whole span.

## 6. Frozen instrument mapping

The canonical machine-readable freeze is
`research/FEAR_GREED_LONG_HISTORY_PROXY_MAPPING.json`; the module refuses to
run if that file, its `.sha256` sidecar, and the in-code `FROZEN_MAPPING`
constant disagree. The table below lists instrument and identity caveat per
market/role (verbatim caveats live in the JSON freeze and in every emitted
`warnings[]` array).

### usa

| role | instrument | first daily bar | identity caveat (summary) |
|---|---|---|---|
| index | VFINX | 1980-01-02 | S&P 500 exposure at once-daily mutual-fund NAV with expense drag; Yahoo daily feed starts at the 1980-01-02 backfill floor, not the 1976 inception. |
| vol | null (realized-vol fallback) | bound by index | Backward-looking 20-bar realized vol replaces implied ^VIX — lags spikes, omits the variance risk premium. |
| bond | FGOVX | 1980-01-02 | Active government-income fund with agencies/MBS at ~5y duration vs IEF's pure 7-10y Treasuries; MBS negative convexity damps flight-to-quality rallies. |
| hy | VWEHX | 1980-01-02 | Quality-tilted active HY at once-daily NAV; understates distressed-tail stress vs HYG. |
| ig | VWESX | 1980-01-02 | Long duration (~12-14y) adds a rates/curve component to the hy/ig ratio. |
| small | NAESX | 1980-01-02 | Actively managed pre-1989 with shifting small-cap benchmarks vs IWM's fixed Russell 2000. |
| large | VFINX | 1980-01-02 | Explicit pin of the S&P 500 breadth denominator (production usa uses large:null passthrough). |

### ustech

| role | instrument | first daily bar | identity caveat (summary) |
|---|---|---|---|
| index | ^IXIC | 1971-02-05 | Price-return composite of all Nasdaq listings, broader than XLK and without dividend adjustment. |
| vol | null (realized-vol fallback) | bound by index | Realized 20-bar vol of the research tech index replaces ^VXN implied vol. |
| bond | FGOVX | 1980-01-02 | As usa bond. |
| hy | VWEHX | 1980-01-02 | As usa hy. |
| ig | VWESX | 1980-01-02 | As usa ig. |
| small | NAESX | 1980-01-02 | Tech-specific breadth signal is lost entirely; replaced by broad-market small-vs-large risk appetite. |
| large | VFINX | 1980-01-02 | **MUST be explicit**: production ustech large:null passthrough would divide NAESX by ^IXIC — a universe-mismatched ratio. |

### europe

| role | instrument | first daily bar | identity caveat (summary) |
|---|---|---|---|
| index | VEURX | 1990-06-18 | USD total-return fund replaces a EUR price index; all components absorb FX translation and dividend accrual. |
| vol | KEEP (null) | bound by index | Production already vol:null; realized-vol input becomes VEURX (USD layer inherited). |
| bond | FGOVX | 1980-01-02 | USD US-government fund replaces euro 7-10y government — a global/USD flight-to-quality proxy. |
| hy | VWEHX | 1980-01-02 | US/USD credit-stress proxy; euro-periphery episodes register only via spillover. |
| ig | VWESX | 1980-01-02 | US-only long-duration IG replaces euro IG. |
| small | DFCSX | 1988-04-15 | Continental (ex-UK) USD systematic small-cap strategy, not a named-index tracker. |
| large | VEURX | 1990-06-18 | UK-inclusive large caps against a continental-only small leg; USD NAVs on both legs. |

### sweden

| role | instrument | first daily bar | identity caveat (summary) |
|---|---|---|---|
| index | EWD | 1996-03-18 | USD ETF on the concentrated MSCI Sweden 25/50 universe replaces the SEK all-share gross index. |
| vol | KEEP (null) | bound by index | Production already vol:null; realized-vol input becomes EWD. |
| bond | FGOVX | 1980-01-02 | US rates replace Riksbank/SEK dynamics — global/USD flight-to-quality proxy. |
| hy | VWEHX | 1980-01-02 | US/USD credit-stress proxy; Swedish property-crisis stress only via global spillover. |
| ig | VWESX | 1980-01-02 | US-only long-duration IG replaces SEK/Nordic IG. |
| small | DFCSX | 1988-04-15 | Sweden diluted to region-level European small-cap risk appetite. |
| large | VEURX | 1990-06-18 | European rather than Swedish denominator; same-family pair with DFCSX. |

### global

| role | instrument | first daily bar | identity caveat (summary) |
|---|---|---|---|
| index | ANWPX | 1980-01-02 | Actively managed global growth fund replaces cap-weighted MSCI ACWI; NAV can post a day late. |
| vol | null (realized-vol fallback) | bound by index | The only market whose vol IDENTITY changes: production global uses ^VIX; research uses realized vol of the global substitute. |
| bond | FGOVX | 1980-01-02 | As usa bond. |
| hy | VWEHX | 1980-01-02 | Drops non-US issuers vs HYLD.L; smallest identity step of the non-US markets. |
| ig | VWESX | 1980-01-02 | US-only long-duration IG replaces global IG (CORP.L). |
| small | NAESX | 1980-01-02 | US-only small caps replace MSCI World small caps — a US-centric proxy. |
| large | VFINX | 1980-01-02 | S&P 500 replaces MSCI World large/mid as breadth denominator. |

### crypto

| role | instrument | first daily bar | identity caveat (summary) |
|---|---|---|---|
| index | CRYPTO-BROAD-EW (BTC, ETH, XRP, ADA, DOGE, BNB) | 2017-11-09 | Fixed six-member equal-weight basket dropping SOL from the production seven; hindsight-selected fixed membership, 7-day/week bars. |
| vol | KEEP (null) | bound by index basket | Production already vol:null; realized vol computed from the research six-coin basket. |
| bond | KEEP (IEF) | 2002-07-22 | Production instrument retained — can never bind. |
| hy | KEEP (HYG) | 2007-04-11 | Production instrument retained — can never bind. |
| ig | KEEP (LQD) | 2002-07-22 | Production instrument retained — can never bind. |
| small | CRYPTO-NONCORE-EW (XRP, ADA, DOGE, BNB) | 2017-11-09 | Dropping SOL overweights 2017-era coins in the breadth numerator; single fixed membership, no splicing. |
| large | KEEP (CRYPTO-CORE-EW: BTC, ETH) | 2017-11-09 | Production core basket retained. |

Crypto keeps the production `barPolicy: completed-utc-date`.

## 7. Finalizer caveats (all also emitted verbatim in `warnings[]`)

1. The Yahoo **1980-01-02 mutual-fund backfill floor** is a feed floor, not
   fund inception (several funds date to the 1970s or earlier).
2. Every substituted fund leg is a **once-daily 4pm NAV** (and NAVs can post a
   day late); adjusted-NAV total-return semantics should be spot-verified per
   fund family before any hard freeze.
3. **USD/FX contamination for europe and sweden**: all components in those
   markets embed FX translation absent from the EUR/SEK production series, and
   their credit/bond legs become global/USD stress proxies.
4. **ustech breadth loses sector identity entirely** (broad-market NAESX/VFINX
   replaces RSPT/XLK), and ustech `large` must be explicitly `VFINX` to avoid
   the null-passthrough NAESX/^IXIC mismatch.
5. **^IXIC is price-return** (adjclose equals close): ustech momentum and
   safe-haven vs a total-return bond fund are mildly understated.
6. **Realized-vol substitution for implied vol** in usa/ustech/global: lags
   spikes and omits the variance risk premium; global is the only market whose
   volatility identity changes relative to production.
7. **Crypto baskets are fixed-membership hindsight selections** (SOL dropped)
   — analytical baskets, not investable or point-in-time index memberships.
8. **NO SPLICING** — each instrument is the sole whole-history primary
   (section 5).
9. The bond-role finalizer override (FGOVX over proposer-primary VFITX) and
   the truncated-proposal notes are preserved verbatim in the JSON freeze.

## 8. Acquisition and receipts

- Endpoint: Yahoo v8 chart, `period1=0&period2=now+1d&interval=1d&events=div,splits`
  (a literal `range=max` downgrades long fund histories to monthly bars and is
  never used). `query1` is tried first; `query2` is retried once on failure.
- Browser-like User-Agent (same as `marketfg.js`); sequential fetches paced at
  roughly one request per second across the 19 unique symbols.
- Identity checks on every payload: `meta.symbol`, `currency === USD`,
  `instrumentType` per frozen contract (MUTUALFUND / INDEX / ETF /
  CRYPTOCURRENCY), and `dataGranularity === 1d` (monthly-downgrade guard).
- Bars are exchange-local dates; the retrieval-local date and anything after it
  is excluded (completed bars only). Provider `null` gap padding is skipped and
  counted; any non-null, non-finite, or non-positive close aborts the run.
- Receipts per symbol: source URL, retrieval timestamp, raw payload bytes,
  raw payload SHA-256 **and full base64 payload**, Yahoo meta identity fields,
  adjustment mode, row count, first/last dates, normalized-rows SHA-256.
- All artifacts are canonical JSON (recursively key-sorted, two-space, trailing
  newline) with adjacent `.sha256` sidecars in the format
  `<64-hex>␠␠<basename>\n`.

## 9. CLI

```
node research/fear_greed_long_history_proxy.js
```

- Rejects ALL arguments.
- Verifies the committed mapping freeze + sidecar, builds the research config
  from the production shape, acquires all series, computes all six markets, and
  writes `yahoo-raw-<stamp>.json`, `scores-<stamp>.json`, and
  `summary-<stamp>.json` (each with a `.sha256` sidecar) under
  `research/local-artifacts/long-history-proxy-v1/`.
- Prints the achieved first/last score dates and row counts per market next to
  the frozen projections.

## 10. Projected spans (frozen before any computation)

| market | current production first score | projected research first score | gain (years) |
|---|---|---|---|
| usa | 2008-04-07 | ~1980-12-24 | 27.3 |
| ustech | ~2008-04 | ~1980-12-24 | 27.3 |
| europe | 2011-08-30 | ~1991-06-14 | 20.2 |
| sweden | 2023-03-20 | ~1997-03-14 | 26 |
| global | 2018-12-20 | ~1980-12-24 | 38 |
| crypto | 2020-12-16 | ~2018-07-17 | 2.4 |

Achieved spans are recorded per run in the summary artifact; a material
difference from projection (e.g. NAV gaps breaking the ≥126-point percentile
window) must be reported, not smoothed over.

## 11. Test coverage

`node --test test/fear_greed_long_history_proxy.test.js` (offline, no network):
committed-mapping round-trip and sidecar format, canonical serialization, CLI
argument rejection, the explicit ustech-large pin, literal vol:null fallback
wiring, crypto basket memberships, payload identity checks and non-finite
rejection, and an injected-series `computeMarket` smoke test proving the
adapter yields all six components through the unmodified production engine.
