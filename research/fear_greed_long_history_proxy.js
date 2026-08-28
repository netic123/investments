'use strict';

// RESEARCH-ONLY long-history variant of the six-component Fear & Greed engine.
//
// This module never touches production: marketfg.js and data/config.json are
// read-only inputs. It deep-clones the production marketFearGreed configuration,
// overwrites each market's symbols with the frozen long-history research mapping
// (research/FEAR_GREED_LONG_HISTORY_PROXY_MAPPING.json), and reuses marketfg's
// exported pure surface — computeMarket, collectSpecSymbols, resolveSeriesSpec,
// equalWeightReturnSeries — UNMODIFIED. Engine parameters stay production-identical
// (range max, window 252, minWindowPoints 126, minComponents 6, fillDays 7).
//
// It outputs component/score HISTORY and achieved spans only. It contains no
// signal, backtest, wealth, allocation, or BUY/SELL logic and its artifacts all
// declare containsStrategyOutcomes: false. The variant's history must never
// silently replace production history.

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'data', 'config.json');
const MARKET_FG_PATH = path.join(REPO_ROOT, 'marketfg.js');
const MAPPING_PATH = path.join(__dirname, 'FEAR_GREED_LONG_HISTORY_PROXY_MAPPING.json');
const PROTOCOL_PATH = path.join(__dirname, 'FEAR_GREED_LONG_HISTORY_PROXY_PROTOCOL.md');
const OUTPUT_DIR = path.join(__dirname, 'local-artifacts', 'long-history-proxy-v1');

const marketfg = require(MARKET_FG_PATH);

const SCHEMA = 'fear-greed-long-history-proxy-v1';
const MAPPING_SCHEMA = 'fear-greed-long-history-proxy-mapping-v1';
const STATUS = 'RETROSPECTIVE_LONG_HISTORY_PROXY_DATA_ONLY_NOT_CONFIRMATORY';
const VARIANT_ID = 'long-history-proxy-v1';
const FREEZE_MARKER = 'FG_LONG_HISTORY_PROXY_FREEZE_MARKER: DRAFT_NOT_FROZEN_2026_08_28';
// Browser-like UA as in marketfg.js: Yahoo v8 chart rejects some default agents.
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Investments/1.0';
const MARKET_ORDER = Object.freeze(['usa', 'ustech', 'europe', 'sweden', 'global', 'crypto']);
const MIN_ROWS_PER_SERIES = 200;

// Engine parameters must remain exactly the production values. The variant may
// only change the configured raw-market instrument mapping, never the engine.
const ENGINE_PARAMS = Object.freeze({
  modelId: 'investments-unified-fear-greed',
  version: 2,
  range: 'max',
  window: 252,
  minWindowPoints: 126,
  minComponents: 6,
  fillDays: 7,
});

// Frozen research instrument mapping, per market slot. vol: null is the literal
// engine realized-vol fallback (marketfg.js compRealizedVol path). ustech large
// MUST be explicit 'VFINX': production ustech has large:null and the null->index
// passthrough would divide broad US small caps (NAESX) by ^IXIC — a
// universe-mismatched ratio.
const RESEARCH_MARKET_SYMBOLS = Object.freeze({
  usa: Object.freeze({ index: 'VFINX', vol: null, bond: 'FGOVX', hy: 'VWEHX', ig: 'VWESX', small: 'NAESX', large: 'VFINX' }),
  ustech: Object.freeze({ index: '^IXIC', vol: null, bond: 'FGOVX', hy: 'VWEHX', ig: 'VWESX', small: 'NAESX', large: 'VFINX' }),
  europe: Object.freeze({ index: 'VEURX', vol: null, bond: 'FGOVX', hy: 'VWEHX', ig: 'VWESX', small: 'DFCSX', large: 'VEURX' }),
  sweden: Object.freeze({ index: 'EWD', vol: null, bond: 'FGOVX', hy: 'VWEHX', ig: 'VWESX', small: 'DFCSX', large: 'VEURX' }),
  global: Object.freeze({ index: 'ANWPX', vol: null, bond: 'FGOVX', hy: 'VWEHX', ig: 'VWESX', small: 'NAESX', large: 'VFINX' }),
  crypto: Object.freeze({
    index: Object.freeze({
      id: 'CRYPTO-BROAD-EW',
      name: 'Broad crypto equal-weight basket (research fixed 6-asset long-history membership)',
      method: 'equalWeightReturns',
      currency: 'USD',
      timezone: 'UTC',
      symbols: Object.freeze(['BTC-USD', 'ETH-USD', 'XRP-USD', 'ADA-USD', 'DOGE-USD', 'BNB-USD']),
    }),
    vol: null,
    bond: 'IEF',
    hy: 'HYG',
    ig: 'LQD',
    small: Object.freeze({
      id: 'CRYPTO-NONCORE-EW',
      name: 'Non-core crypto equal-weight basket (research fixed 4-asset long-history membership)',
      method: 'equalWeightReturns',
      currency: 'USD',
      timezone: 'UTC',
      symbols: Object.freeze(['XRP-USD', 'ADA-USD', 'DOGE-USD', 'BNB-USD']),
    }),
    large: Object.freeze({
      id: 'CRYPTO-CORE-EW',
      name: 'BTC and ETH equal-weight core basket',
      method: 'equalWeightReturns',
      currency: 'USD',
      timezone: 'UTC',
      symbols: Object.freeze(['BTC-USD', 'ETH-USD']),
    }),
  }),
});

// Cosmetic component metadata for the research crypto market (production text
// describes the 7-asset production basket; the research baskets differ).
const CRYPTO_RESEARCH_COMPONENTS = Object.freeze({
  momentum: Object.freeze({ desc: 'Research fixed 6-asset crypto index relative to its 125-observation moving average' }),
  strength: Object.freeze({ desc: 'Research fixed 6-asset crypto index distance from its trailing 252-observation high' }),
  volatility: Object.freeze({ desc: 'Research fixed 6-asset crypto index 20-observation realised volatility relative to its 50-observation average' }),
  safeHaven: Object.freeze({ desc: 'Research fixed 6-asset crypto index 20-common-session return minus 7–10 year US Treasuries', note: 'IEF is an external US Treasury proxy; on weekends its latest score is carried forward' }),
  credit: Object.freeze({ desc: 'US high-yield vs investment-grade corporate bonds, relative to 125-observation average', note: 'HYG/LQD measures external US credit conditions, not crypto-native credit' }),
  breadth: Object.freeze({ desc: 'Fixed research non-core crypto basket (XRP, ADA, DOGE, BNB) vs BTC/ETH core basket, relative to 63-observation average', note: 'daily-rebalanced equal-weight analytical baskets with fixed hindsight-selected memberships; not market-cap indices or investable portfolios' }),
});

// Yahoo meta identity contract per unique research symbol.
const EXPECTED_INSTRUMENT_TYPES = Object.freeze({
  VFINX: 'MUTUALFUND', FGOVX: 'MUTUALFUND', VWEHX: 'MUTUALFUND', VWESX: 'MUTUALFUND',
  NAESX: 'MUTUALFUND', VEURX: 'MUTUALFUND', DFCSX: 'MUTUALFUND', ANWPX: 'MUTUALFUND',
  '^IXIC': 'INDEX',
  EWD: 'ETF', IEF: 'ETF', HYG: 'ETF', LQD: 'ETF',
  'BTC-USD': 'CRYPTOCURRENCY', 'ETH-USD': 'CRYPTOCURRENCY', 'XRP-USD': 'CRYPTOCURRENCY',
  'ADA-USD': 'CRYPTOCURRENCY', 'DOGE-USD': 'CRYPTOCURRENCY', 'BNB-USD': 'CRYPTOCURRENCY',
});

// ---------------------------------------------------------------------------
// Frozen mapping. The committed canonical freeze at MAPPING_PATH must be byte-
// identical to stableJson(FROZEN_MAPPING); verifyCommittedMapping() enforces it.
// Instruments were chosen on identity plus probe-verified availability only —
// never on score outcomes or backtests — and each instrument is the sole
// whole-history primary for its slot (hard no-splice rule).
// ---------------------------------------------------------------------------
const FROZEN_MAPPING = {
  schema: MAPPING_SCHEMA,
  status: STATUS,
  variantId: VARIANT_ID,
  frozenAt: '2026-08-28',
  freezeMarker: FREEZE_MARKER,
  containsStrategyOutcomes: false,
  selectionRule: 'Instruments were selected on economic identity plus probe-verified Yahoo daily availability only; no score outcome, backtest, or performance figure was consulted for any selection.',
  noSpliceRule: 'NO SPLICING: each instrument is the sole whole-history primary for its market/role. Earlier data from any other source or instrument must never be prepended, appended, or blended into a slot series.',
  productionUntouchedRule: 'Production v2 (marketfg.js, data/config.json) and every frozen experiment are untouched. This research variant defines a separate config and separate artifacts; its history must never silently replace production history.',
  engineParams: ENGINE_PARAMS,
  cryptoBarPolicy: 'completed-utc-date',
  researchMarketSymbols: RESEARCH_MARKET_SYMBOLS,
  cryptoComponentDescriptions: CRYPTO_RESEARCH_COMPONENTS,
  mapping: [
    {
      market: 'usa',
      role: 'index',
      instrument: 'VFINX',
      firstDailyDate: '1980-01-02',
      identityCaveat: "Same S&P 500 exposure as SPY but priced at 4pm mutual-fund NAV with historical expense drag (~0.14-0.45%), and Yahoo's daily feed starts 1980-01-02 (its backfill floor) rather than the 1976-08-31 inception; adjusted-NAV total-return semantics should be spot-verified against a known dividend date.",
      alternateRejected: "^GSPC — longer (to 1927 with negative period1) but price-return only, violating the repo's adjusted-close total-return preference; SPY (KEEP) — 1993-01-29 start would bind."
    },
    {
      market: 'usa',
      role: 'vol',
      instrument: 'null (realized-vol fallback, marketfg.js:425)',
      firstDailyDate: 'n/a — bounded by index series (VFINX 1980-01-02); ~196-bar warm-up sits inside the standard ~250',
      identityCaveat: 'Replaces forward-looking option-implied ^VIX with backward-looking 20-bar realized vol of the index — lags vol spikes by days and omits the variance risk premium, so short fear episodes register later and more weakly.',
      alternateRejected: '^VIX (KEEP) — 1990-01-02 Yahoo floor would make volatility the binding component against 1980-floor legs.'
    },
    {
      market: 'usa',
      role: 'bond',
      instrument: 'FGOVX',
      firstDailyDate: '1980-01-02',
      identityCaveat: "Actively managed government-income fund holding agencies/MBS alongside Treasuries at intermediate (~5y) duration versus IEF's pure 7-10y Treasury index — MBS negative convexity damps the bond leg of compSafeHaven precisely in sharp flight-to-quality rallies; once-daily NAV, Yahoo adjusted-NAV distribution handling.",
      alternateRejected: 'VFITX (proposer primary) — purest identity but its 1991-10-28 start would bind the composite once index/credit reach the 1980 floor (its own rationale assumed a KEEP SPY index); VUSTX — pure Treasury but long-duration mismatch and 1986-05-19 start.'
    },
    {
      market: 'usa',
      role: 'hy',
      instrument: 'VWEHX',
      firstDailyDate: '1980-01-02',
      identityCaveat: 'Actively managed, quality-tilted HY (overweights BB/B, underweights CCC) at once-daily fund NAV rather than intraday ETF prices, so the hy/ig ratio understates the most severe distressed-tail credit stress relative to HYG/LQD; depends on Yahoo adjusted NAV correctly reflecting its large monthly distributions.',
      alternateRejected: 'FAGIX — same 1980-01-02 Yahoo floor but holds equities/distressed paper (impure HY identity); PRHYX — clean identity but 1984-12-31.'
    },
    {
      market: 'usa',
      role: 'ig',
      instrument: 'VWESX',
      firstDailyDate: '1980-01-02',
      identityCaveat: "Long duration (~12-14y vs LQD ~8.5y) embeds a larger rates/curve component in the hy/ig ratio than production (same direction as HYG/LQD's own mismatch, only larger) — in pure rate shocks the credit score can move on duration rather than spreads; once-daily NAV pricing.",
      alternateRejected: 'FBNDX — same 1980-01-02 floor but a core govt+corporate+securitized fund, not pure IG corporate; VFICX — duration-matched to LQD but 1993-10-29.'
    },
    {
      market: 'usa',
      role: 'small',
      instrument: 'NAESX',
      firstDailyDate: '1980-01-02',
      identityCaveat: "Actively managed (Exeter Fund) before its 1989 index conversion and tracking three different small-cap benchmarks since, so early history reflects manager behavior and a shifting small-cap definition rather than IWM's fixed Russell 2000; verify Yahoo's distribution adjustment.",
      alternateRejected: 'VEXMX — pure passive ex-S&P-500 complement from day one but 1987-12-21; IWM (KEEP) — 2000-05-26.'
    },
    {
      market: 'usa',
      role: 'large',
      instrument: 'VFINX',
      firstDailyDate: '1980-01-02',
      identityCaveat: 'Mutual-fund NAV with expense drag rather than an ETF price; because breadth is a ratio scored against its own SMA63, constant level drags largely cancel — minimal distortion vs SPY. Set explicitly (production usa has large:null → index passthrough, marketfg.js:399) to pin the S&P 500 denominator regardless of the index substitute.',
      alternateRejected: 'SPY (production passthrough target) — 1993 start; leaving null works only because the chosen index IS VFINX, but pinning is safer.'
    },
    {
      market: 'ustech',
      role: 'index',
      instrument: '^IXIC',
      firstDailyDate: '1971-02-05',
      identityCaveat: "Price-return composite of every Nasdaq listing — broader than XLK's GICS Information Technology sector and missing dividend adjustment, so momentum and the safe-haven spread versus a total-return bond fund are mildly understated; measures 'Nasdaq-listed equities' rather than pure large-cap tech. hasAdjClose true but equals close — acceptable: no multi-decade total-return tech benchmark exists.",
      alternateRejected: 'FSPTX — total-return NAV but actively managed sector fund and 1981-07-14; ^NDX — price-only and 1985-10-01; XLK (KEEP) — 1998-12-22.'
    },
    {
      market: 'ustech',
      role: 'vol',
      instrument: 'null (realized-vol fallback, marketfg.js:425)',
      firstDailyDate: 'n/a — bounded by index series (^IXIC 1971-02-05)',
      identityCaveat: 'Backward-looking 20-bar realized vol of the research tech index replaces Nasdaq-100 implied vol — lags spikes and carries no risk premium; sector-matched, unlike the ^VIX alternate.',
      alternateRejected: '^VXN (KEEP) — exact identity but 2001-01-23 floor; ^VIX — wrong universe (S&P 500) and 1990 floor.'
    },
    {
      market: 'ustech',
      role: 'bond',
      instrument: 'FGOVX',
      firstDailyDate: '1980-01-02',
      identityCaveat: "Same as usa bond: active government-income fund with agencies/MBS at ~5y duration vs IEF's pure 7-10y Treasury index — damped safe-haven leg in sharp rallies; once-daily NAV.",
      alternateRejected: 'VFITX — 1991-10-28 would bind ustech (credit/breadth at 1980, index 1971); VUSTX — 1986, long duration.'
    },
    {
      market: 'ustech',
      role: 'hy',
      instrument: 'VWEHX',
      firstDailyDate: '1980-01-02',
      identityCaveat: 'Quality-tilted active HY (underweights CCC) at once-daily NAV understates extreme distressed-credit stress relative to HYG/LQD; depends on Yahoo adjusted NAV for monthly distributions.',
      alternateRejected: 'FAGIX — same floor, impure (equities/distressed); PRHYX — 1984.'
    },
    {
      market: 'ustech',
      role: 'ig',
      instrument: 'VWESX',
      firstDailyDate: '1980-01-02',
      identityCaveat: 'Long duration (~12-14y vs LQD ~8.5y) injects a rates/curve component into the credit ratio beyond production; once-daily NAV pricing.',
      alternateRejected: 'FBNDX — aggregate govt+corp identity; VFICX — 1993.'
    },
    {
      market: 'ustech',
      role: 'small',
      instrument: 'NAESX',
      firstDailyDate: '1980-01-02',
      identityCaveat: "Substitutes broad-market small-vs-large participation for intra-tech equal-weight-vs-cap-weight concentration — the tech-specific signal (mega-cap tech dominance vs the average tech stock) is lost entirely and replaced by a general US risk-appetite proxy; plus NAESX's pre-1989 active phase.",
      alternateRejected: 'QQEW — exact-ish sector identity but 2006-05-02; RSPT (KEEP) — 2006-11-07 and Yahoo history truncated by the 2023 rename.'
    },
    {
      market: 'ustech',
      role: 'large',
      instrument: 'VFINX',
      firstDailyDate: '1980-01-02',
      identityCaveat: "Denominator becomes the S&P 500 rather than cap-weighted technology, completing this component's shift from sector-internal breadth to broad-market breadth (caveat attaches to the NAESX/VFINX pair as a whole). MUST be set explicitly: production ustech has large:null, and the null→index passthrough (marketfg.js:399) would divide broad US small caps by ^IXIC — a universe-mismatched ratio.",
      alternateRejected: 'XLK — retaining it as denominator under a broad-market numerator would be a worse universe mismatch; SPY — same identity as VFINX but 1993.'
    },
    {
      market: 'europe',
      role: 'index',
      instrument: 'VEURX',
      firstDailyDate: '1990-06-18',
      identityCaveat: "USD-denominated total-return fund replacing a EUR-denominated price index — momentum, realized volatility, and the safe-haven spread all absorb EUR/GBP/CHF-vs-USD currency moves and dividend accrual, and its MSCI Europe large/mid universe omits the STOXX 600's small-cap tail.",
      alternateRejected: "FIEUX — 1986-09-30 (+3.7y) but actively managed; passive index-tracking identity outranks the gain per the proposers' own usa precedent; IEV — 2000-07-28; ^STOXX (KEEP) — ~2004."
    },
    {
      market: 'europe',
      role: 'vol',
      instrument: 'KEEP (null — production realized-vol fallback)',
      firstDailyDate: 'n/a — bounded by index series (VEURX 1990-06-18)',
      identityCaveat: "None at the config level — production europe already runs vol:null; the realized-vol input series changes from ^STOXX to VEURX, so the component inherits the index substitute's USD-currency layer.",
      alternateRejected: 'No European implied-vol series with usable Yahoo history exists.'
    },
    {
      market: 'europe',
      role: 'bond',
      instrument: 'FGOVX',
      firstDailyDate: '1980-01-02',
      identityCaveat: 'Safe-haven leg becomes a USD US government fund (Treasuries + agencies/MBS, ~5y) replacing euro 7-10y government (SXRQ.DE) — euro-area rate dynamics (ECB easing episodes) are lost and the leg is explicitly a global/USD flight-to-quality proxy; with the USD index leg (VEURX) the 20-bar differential is USD-vs-USD but the equity leg still embeds EUR/USD translation.',
      alternateRejected: 'VFITX — 1991-10-28 would push the europe composite behind its 1990-06-18 index; VUSTX — 1986, long duration.'
    },
    {
      market: 'europe',
      role: 'hy',
      instrument: 'VWEHX',
      firstDailyDate: '1980-01-02',
      identityCaveat: 'Credit becomes a US/USD credit-stress proxy rather than euro HY: euro-specific credit episodes (e.g. 2011-12 eurozone periphery stress) register only through global spillover into US spreads, and issuer base, currency, and distressed-tail composition all differ from IHYG.L; quality-tilted active fund at once-daily NAV. Repo-sanctioned USD-substitute-with-caveat.',
      alternateRejected: 'FAGIX — impure; PRHYX — 1984; IHYG.L (KEEP) — 2010-09-03, the current europe binder.'
    },
    {
      market: 'europe',
      role: 'ig',
      instrument: 'VWESX',
      firstDailyDate: '1980-01-02',
      identityCaveat: 'US-only long-duration IG corporates in USD replace euro IG (IEAC.L): the ratio measures US credit risk appetite, not euro credit, with an added US rates/curve component (~12-14y duration).',
      alternateRejected: 'FBNDX — aggregate identity; VFICX — 1993.'
    },
    {
      market: 'europe',
      role: 'small',
      instrument: 'DFCSX',
      firstDailyDate: '1988-04-15',
      identityCaveat: "Continental universe excludes the UK while production's STOXX Europe Mid 200 includes it, USD NAVs embed currency moves absent from the EUR-quoted production pair, and DFA runs a systematic strategy rather than replicating a named index — treat as a region small-cap proxy and verify Yahoo's distribution adjustment.",
      alternateRejected: 'DFISX — broader ex-US universe but 1996-09-30; EXSE.DE (KEEP) — 2008-01-02.'
    },
    {
      market: 'europe',
      role: 'large',
      instrument: 'VEURX',
      firstDailyDate: '1990-06-18',
      identityCaveat: 'Includes UK large caps against a continental-only small leg, so the ratio carries a UK-exposure mismatch; both legs are USD NAVs of European portfolios, so FX translation enters both legs and partially cancels in the ratio but differs from the clean EUR production pair.',
      alternateRejected: 'FIEUX — 1986 (pair would bind at DFCSX 1988-04-15, +2.2y) but active management in the breadth denominator; passive identity outranks; EXSA.DE (KEEP) — 2008-01-02.'
    },
    {
      market: 'sweden',
      role: 'index',
      instrument: 'EWD',
      firstDailyDate: '1996-03-18',
      identityCaveat: 'USD ETF tracking the concentrated MSCI Sweden 25/50 large/mid universe (benchmark changed 2016-12-01) replacing the SEK all-share gross index ^OMXSBGI — embeds SEK/USD currency moves and single-name concentration; already the repo\'s audited frozen sweden proxy (five_market_proxy_data.js).',
      alternateRejected: '^OMX — probe shows Yahoo daily coverage only from 2008-11-20 despite the 1986 index inception (claimed history unverified and shorter than EWD); ^OMXSBGI (KEEP) — ~2013.'
    },
    {
      market: 'sweden',
      role: 'vol',
      instrument: 'KEEP (null — production realized-vol fallback)',
      firstDailyDate: 'n/a — bounded by index series (EWD 1996-03-18)',
      identityCaveat: 'None at the config level — production sweden already runs vol:null; the realized-vol input becomes EWD, inheriting its USD layer.',
      alternateRejected: 'No Swedish implied-vol series with usable Yahoo history exists.'
    },
    {
      market: 'sweden',
      role: 'bond',
      instrument: 'FGOVX',
      firstDailyDate: '1980-01-02',
      identityCaveat: 'USD US government fund (with agencies/MBS) replaces the SEK government/covered-bond ETF: Riksbank/SEK rate dynamics are replaced by US rates and krona-weakness episodes enter via the USD index leg — a global/USD flight-to-quality proxy, not a Swedish-duration instrument.',
      alternateRejected: 'VFITX — purer but 1991 (no span gain for sweden either way, EWD binds; FGOVX kept for cross-market bond-role consistency); VUSTX — 1986, long duration.'
    },
    {
      market: 'sweden',
      role: 'hy',
      instrument: 'VWEHX',
      firstDailyDate: '1980-01-02',
      identityCaveat: 'Credit becomes a US/USD credit-stress proxy for a market whose production instrument tracks Nordic/SEK high yield (heavily real-estate-weighted): Swedish-specific credit stress (e.g. 2022-23 SBB/property crisis) appears only insofar as it moved global HY spreads; currency, issuer base, and tail composition all differ.',
      alternateRejected: 'FAGIX — impure; PRHYX — 1984; 0P0001C87Y.ST (KEEP) — 2022-03-08, the current sweden binder.'
    },
    {
      market: 'sweden',
      role: 'ig',
      instrument: 'VWESX',
      firstDailyDate: '1980-01-02',
      identityCaveat: 'US-only long-duration IG corporates in USD replace SEK/Nordic IG: the ratio measures US credit risk appetite with an added US rates/curve component, not Swedish credit conditions.',
      alternateRejected: 'FBNDX — aggregate identity; VFICX — 1993; 0P00000KIW.ST (KEEP) — 2022.'
    },
    {
      market: 'sweden',
      role: 'small',
      instrument: 'DFCSX',
      firstDailyDate: '1988-04-15',
      identityCaveat: 'Sweden is a minor weight in continental-European small caps, so Sweden-specific breadth episodes are diluted to region-level risk appetite, and USD NAVs against the SEK production pair add a currency layer.',
      alternateRejected: "NAESX — longer (1980 floor) but US-only, and cannot extend sweden's span (EWD binds at 1996 regardless), so the sounder includes-Sweden region identity wins; XACT-SMABOLAG.ST (KEEP) — 2016-02-09."
    },
    {
      market: 'sweden',
      role: 'large',
      instrument: 'VEURX',
      firstDailyDate: '1990-06-18',
      identityCaveat: 'Europe-region large caps (UK included, USD-denominated) replace the Swedish all-market denominator, so the component measures European rather than Swedish risk appetite; legs kept as a same-family pair with DFCSX, never mixed across families.',
      alternateRejected: 'VFINX — only valid as partner to a US pair (not chosen); XACT-SVERIGE.ST (KEEP) — 2009-01-02.'
    },
    {
      market: 'global',
      role: 'index',
      instrument: 'ANWPX',
      firstDailyDate: '1980-01-02',
      identityCaveat: "Actively managed global growth fund (American Funds New Perspective: multinational-companies mandate, front-load share class) replacing cap-weighted MSCI ACWI — momentum, strength, realized vol, and safe-haven reflect manager selection and a growth tilt rather than the index; Yahoo daily feed starts 1980-01-02 though the fund dates to 1973; once-daily NAV that can lag a day (probe last bar 2026-08-27). NOTE: the global-index proposal arrived truncated — finalized by the finalizer from probe evidence under the same identity rules.",
      alternateRejected: 'VHGEX — more style-neutral multi-manager global equity but 1995-09-01 (15.7y shorter); ACWI (KEEP) — 2008-03-28; no passive global index fund predates 2008 on Yahoo.'
    },
    {
      market: 'global',
      role: 'vol',
      instrument: 'null (realized-vol fallback, marketfg.js:425)',
      firstDailyDate: 'n/a — bounded by index series (ANWPX 1980-01-02)',
      identityCaveat: "The only market where vol IDENTITY changes rather than KEEPs: production global uses ^VIX (S&P 500 implied) as a cross-market proxy; research switches to backward-looking realized 20-bar vol of the actual global index substitute — loses the forward-looking risk-premium component but gains universe match and removes ^VIX's 1990-01-02 floor.",
      alternateRejected: '^VIX (KEEP) — 1990 floor would bind against 1980-floor legs.'
    },
    {
      market: 'global',
      role: 'bond',
      instrument: 'FGOVX',
      firstDailyDate: '1980-01-02',
      identityCaveat: 'Same US-government asset class as production IEF but an active fund holding agencies/MBS at ~5y duration versus the pure 7-10y Treasury index — mutes the safe-haven leg, especially in sharp rallies (MBS negative convexity).',
      alternateRejected: 'VFITX — nearest IEF identity but 1991-10-28 would bind against the 1980 floor of index/credit/breadth; VUSTX — 1986.'
    },
    {
      market: 'global',
      role: 'hy',
      instrument: 'VWEHX',
      firstDailyDate: '1980-01-02',
      identityCaveat: 'Drops non-US issuers (European and EM high yield) from the credit gauge relative to HYLD.L, so non-US-centric credit episodes are captured only via spillover into US spreads; quality-tilted active fund at once-daily NAV. Smallest identity step of the non-US markets since production is already USD-priced and US-heavy.',
      alternateRejected: 'FAGIX — impure; PRHYX — 1984; HYLD.L (KEEP) — ~2012.'
    },
    {
      market: 'global',
      role: 'ig',
      instrument: 'VWESX',
      firstDailyDate: '1980-01-02',
      identityCaveat: 'US-only long-duration IG corporates replace the global IG universe (CORP.L), removing non-US issuers and adding a US rates/curve component (~12-14y duration) to the ratio.',
      alternateRejected: 'FBNDX — aggregate identity; VFICX — 1993.'
    },
    {
      market: 'global',
      role: 'small',
      instrument: 'NAESX',
      firstDailyDate: '1980-01-02',
      identityCaveat: "US-only small caps replace MSCI World small caps — non-US small-cap cycles (Japan, Europe episodes) vanish from the signal, which becomes a US-centric risk-appetite proxy rather than global participation breadth; plus NAESX's pre-1989 active phase.",
      alternateRejected: 'TEMGX — universe-matched global-including-US but an active value strategy that must pair with TEPLX (pair binds 1986-01-02, and injects two layers of active-manager behavior); SCZ — 2007-12-12; WSML.L (KEEP) — 2018-03-27, the current global binder.'
    },
    {
      market: 'global',
      role: 'large',
      instrument: 'VFINX',
      firstDailyDate: '1980-01-02',
      identityCaveat: "The S&P 500 replaces MSCI World large/mid (IWDA.L) as denominator, reinforcing the component's shift to a US-centric proxy; mutual-fund NAV expense drag largely cancels in the SMA63 ratio.",
      alternateRejected: 'TEPLX — only valid as partner to TEMGX (pair not chosen); IWDA.L (KEEP) — 2009-09-25.'
    },
    {
      market: 'crypto',
      role: 'index',
      instrument: 'CRYPTO-BROAD-EW(BTC-USD,ETH-USD,XRP-USD,ADA-USD,DOGE-USD,BNB-USD)',
      firstDailyDate: '2017-11-09',
      identityCaveat: "Fixed six-member equal-weight basket dropping SOL-USD from the production seven — one whole-history membership (cmbitmSolePrimaryNoSplice compliant), but the largest modern alt-L1 is absent, tilting the broad-market level toward 2017-era coins; 7-day/week bars; first date bound by the uniform 2017-11-09 Yahoo start of ETH/XRP/ADA/DOGE/BNB. NOTE: the crypto-index proposal arrived truncated — finalized to mirror the small-role proposer's drop-SOL logic.",
      alternateRejected: "BTC-USD alone — 2014-09-17 but collapses 'broad crypto market' to a single asset, and the composite would still floor at the breadth baskets' 2017-11-09 unless breadth were also degraded to single coins (LTC/BTC), an identity loss ruled disproportionate; production 7-coin basket (KEEP) — SOL-bound 2020-04-10."
    },
    {
      market: 'crypto',
      role: 'vol',
      instrument: 'KEEP (null — production realized-vol fallback)',
      firstDailyDate: 'n/a — bounded by index basket (2017-11-09)',
      identityCaveat: 'None — production config retained; realized vol computed from the research six-coin basket instead of the seven-coin production basket, inheriting the index caveat.',
      alternateRejected: 'No listed crypto implied-vol series with usable Yahoo history exists.'
    },
    {
      market: 'crypto',
      role: 'bond',
      instrument: 'KEEP',
      firstDailyDate: '2002-07-22 (IEF)',
      identityCaveat: "None — production instrument retained; IEF predates all crypto data by 15 years so bond can never bind, and keeping it preserves the config's IEF weekend carry-forward behavior.",
      alternateRejected: 'VFITX — longer (1991) but yields zero span gain for crypto; production identity retained as the strongest-identity tiebreak.'
    },
    {
      market: 'crypto',
      role: 'hy',
      instrument: 'KEEP',
      firstDailyDate: '2007-04-11 (HYG)',
      identityCaveat: "None — production instrument retained; HYG's credit component is fully warm (SMA125 + percentile) years before the 2017-11-09 basket start, so hy can never bind.",
      alternateRejected: 'VWEHX — longer (1980) but yields zero span gain for crypto; adopt only if cross-market credit-pair uniformity is preferred (then the usa hy caveat applies).'
    },
    {
      market: 'crypto',
      role: 'ig',
      instrument: 'KEEP',
      firstDailyDate: '2002-07-22 (LQD)',
      identityCaveat: 'None — production instrument retained; LQD predates any crypto series by over a decade, so ig can never bind.',
      alternateRejected: 'VWESX — longer but zero span gain; uniformity-only alternate.'
    },
    {
      market: 'crypto',
      role: 'small',
      instrument: 'CRYPTO-NONCORE-EW(XRP-USD,ADA-USD,DOGE-USD,BNB-USD)',
      firstDailyDate: '2017-11-09',
      identityCaveat: 'Dropping SOL means the ratio no longer reflects the largest modern alt-L1 and overweights 2017-era coins (XRP/ADA/DOGE/BNB), tilting recent alt-season readings toward legacy alts; single fixed membership over the whole span — no splicing.',
      alternateRejected: 'LTC-USD — 2014-09-17 but degrades breadth to one idiosyncratic legacy coin versus the core; production 5-coin basket (KEEP) — SOL-bound 2020-04-10, the current crypto binder.'
    },
    {
      market: 'crypto',
      role: 'large',
      instrument: 'KEEP',
      firstDailyDate: '2017-11-09 (CRYPTO-CORE-EW(BTC-USD,ETH-USD), ETH-bound)',
      identityCaveat: 'None — production core basket retained; its ETH-bound 2017-11-09 start exactly matches the extended non-core basket, so large is never binding once small is fixed.',
      alternateRejected: 'BTC-USD — 2014-09-17 but would drop ETH and redefine the breadth ratio as alt-vs-BTC dominance rather than alt-vs-core.'
    }
  ],
  projectedSpans: [
    {
      market: 'usa',
      currentFirstScore: '2008-04-07 (bound by HYG credit, 2007-04-11)',
      projectedBindingSeries: '1980-01-02 Yahoo backfill floor shared by VFINX (index/large), VWEHX/VWESX (credit), NAESX (small), FGOVX (bond) — slowest components are momentum/strength/credit at ~250 bars',
      projectedFirstScore: '~1980-12-24 (1980-01-02 + ~250 trading days)',
      gainYears: 27.3
    },
    {
      market: 'ustech',
      currentFirstScore: '~2008-04 (bound by HYG credit)',
      projectedBindingSeries: 'VWEHX/VWESX credit pair at the 1980-01-02 floor (index ^IXIC is warm from ~1972; breadth NAESX/VFINX warm ~1980-10)',
      projectedFirstScore: '~1980-12-24 (1980-01-02 + ~250 trading days)',
      gainYears: 27.3
    },
    {
      market: 'europe',
      currentFirstScore: '2011-08-30 (bound by IHYG.L credit, 2010-09-03)',
      projectedBindingSeries: 'VEURX (index momentum/strength; also breadth large leg), first bar 1990-06-18',
      projectedFirstScore: '~1991-06-14 (1990-06-18 + ~250 trading days)',
      gainYears: 20.2
    },
    {
      market: 'sweden',
      currentFirstScore: '2023-03-20 (bound by 0P0001C87Y.ST/0P00000KIW.ST credit, 2022-03-08)',
      projectedBindingSeries: 'EWD (index momentum/strength), first bar 1996-03-18',
      projectedFirstScore: '~1997-03-14 (1996-03-18 + ~250 trading days)',
      gainYears: 26
    },
    {
      market: 'global',
      currentFirstScore: '2018-12-20 (bound by WSML.L breadth, 2018-03-27)',
      projectedBindingSeries: '1980-01-02 floor shared by ANWPX (index), VWEHX/VWESX (credit), NAESX/VFINX (breadth), FGOVX (bond) — momentum/strength/credit at ~250 bars bind',
      projectedFirstScore: '~1980-12-24 (1980-01-02 + ~250 trading days)',
      gainYears: 38
    },
    {
      market: 'crypto',
      currentFirstScore: '2020-12-16 (bound by SOL-USD-bound baskets, 2020-04-10)',
      projectedBindingSeries: 'Six-coin broad index basket and four-coin non-core basket, both first bar 2017-11-09; index momentum at ~250 bars is slowest (credit/bond warm since ~2008)',
      projectedFirstScore: '~2018-07-17 (2017-11-09 + ~250 daily bars; crypto trades 7 days/week so 250 bars ≈ 250 calendar days)',
      gainYears: 2.4
    }
  ],
  finalizerNotes: [
    'PROPOSALS input arrived truncated: the sweden index caveat was cut mid-sentence and the global-index and crypto-index proposals were missing entirely. Both were finalized from probe evidence (ANWPX/VHGEX/ACWI probed for global; BTC/ETH/LTC probed for crypto) under the same identity-plus-verified-availability rules; flagging for the orchestrator to confirm against the proposers\' full output.',
    'Yahoo 1980-01-02 backfill floor: VWEHX, VWESX, FGOVX, FBNDX, FAGIX, NAESX, VFINX, and ANWPX all start exactly 1980-01-02 — this is Yahoo\'s mutual-fund feed floor, not fund inception (several funds date to the 1970s or earlier). Treat 1980-01-02 as the frozen research span start; do NOT splice earlier data from any other source (hard no-splice rule).',
    'Bond-role override: the finalizer replaced proposer primary VFITX with alternate FGOVX in usa/ustech/europe/global (and sweden for consistency). VFITX\'s stated rationale (\'1991 predates SPY so bond stops binding\') was written against a KEEP index and collapses once index/credit reach the 1980 floor — VFITX would itself bind usa/ustech/global at ~1992-10. FGOVX passes the identity gate as a US government-bond safe haven but is active and holds agencies/MBS (negative convexity damps flight-to-quality rallies). If government-fund purity is judged insufficient, the fallback is VUSTX (pure Treasury, 1986-05-19, long duration), which would move the usa/ustech/global composite start to ~1987-05.',
    'Mutual-fund NAV conventions: every substituted non-index leg (and three index legs) is a once-daily 4pm NAV. Before freezing, spot-verify Yahoo adjusted-NAV total-return semantics against one known distribution date per fund family (Vanguard, Fidelity, DFA, American Funds) — especially VWEHX\'s large monthly distributions. NAVs can also post a day late (ANWPX and FSPTX probes end 2026-08-27 vs 2026-08-28 for ETFs).',
    'USD substitution caveats (repo-sanctioned): europe and sweden credit and bond roles become global/USD credit-stress and flight-to-quality proxies — euro-periphery (2011-12) and Swedish property-crisis (2022-23) stress register only via spillover into US spreads. Additionally the europe/sweden research index and breadth legs are USD series, so ALL components in those markets embed FX translation absent from the EUR/SEK production series.',
    'Global vol is the only role where volatility IDENTITY changes rather than staying production-equivalent: production global uses ^VIX (verified in data/config.json line 62); research switches to vol:null realized fallback because the ANWPX index predates ^VIX\'s 1990 floor. usa/ustech also switch implied-to-realized but there the production implied series (^VIX/^VXN) measure their own universes; europe/sweden/crypto are KEEP-null.',
    'ustech breadth loses its tech-specific identity entirely (broad-market NAESX/VFINX replaces RSPT/XLK equal-weight-vs-cap-weight): no sector instrument covers the target span (QQEW/RSPT both 2006). The research config MUST set ustech large explicitly to VFINX — production\'s large:null passthrough (verified marketfg.js:399) would otherwise divide US small caps by ^IXIC, a universe-mismatched ratio.',
    '^IXIC is price-return (adjclose equals close): momentum and the safe-haven spread versus total-return FGOVX are mildly understated for ustech. Accepted because no multi-decade total-return tech benchmark exists; same acceptance NOT extended to usa, where total-return VFINX exists and beat the longer price-only ^GSPC.',
    'Roles where no candidate beat production: crypto hy/ig/bond (longer US funds exist but yield zero span gain since crypto binds on its own 2017-11-09 baskets — production kept as strongest identity), crypto large (core basket already at 2017-11-09), europe/sweden/crypto vol (already null). Sweden small NAESX alternate was longer than DFCSX but likewise could not move sweden\'s EWD-bound start, so region identity won.',
    'Cross-role consistency checks passed: one credit pair (VWEHX/VWESX, same family/era/NAV convention) across all five substituted markets; breadth always swapped as a same-family pair (NAESX/VFINX for usa/ustech/global, DFCSX/VEURX for europe/sweden, fixed-membership baskets for crypto); one bond instrument (FGOVX) across all substituted markets; europe index and large deliberately share VEURX (production has the analogous pattern via large:null passthrough in usa/ustech).',
    'Production data/config.json and marketfg.js are untouched — this mapping defines a separate research-only variant config. All selections were made on instrument identity and probe-verified availability; no score outcomes or backtests were consulted.'
  ],
};

// ---------- deterministic serialization + receipts ----------
function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const output = {};
    for (const key of Object.keys(value).sort()) output[key] = canonicalize(value[key]);
    return output;
  }
  return value;
}

// Canonical JSON: recursively key-sorted, 2-space indented, trailing newline.
function stableJson(value) {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function writeStableJson(filePath, value) {
  const absolutePath = path.resolve(filePath);
  const bytes = Buffer.from(stableJson(value), 'utf8');
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, bytes);
  const digest = sha256Buffer(bytes);
  fs.writeFileSync(`${absolutePath}.sha256`, `${digest}  ${path.basename(absolutePath)}\n`);
  return { absolutePath, bytes: bytes.length, sha256: digest };
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function runStamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/:/g, '-');
}

// ---------- disclosure ----------
// Every identityCaveat from the frozen mapping (verbatim per market/role) plus
// every finalizer note, so no consumer can read a score history without the
// full substitution disclosure attached.
function buildWarnings(mapping = FROZEN_MAPPING) {
  const warnings = [];
  for (const entry of mapping.mapping) warnings.push(`${entry.market}/${entry.role} [${entry.instrument}]: ${entry.identityCaveat}`);
  for (const note of mapping.finalizerNotes) warnings.push(`finalizer-note: ${note}`);
  return warnings;
}

// ---------- committed freeze verification ----------
function verifyCommittedMapping(mappingPath = MAPPING_PATH) {
  const expectedBytes = Buffer.from(stableJson(FROZEN_MAPPING), 'utf8');
  const actualBytes = fs.readFileSync(mappingPath);
  if (!actualBytes.equals(expectedBytes)) {
    throw new Error(`committed mapping freeze drifted from the in-code FROZEN_MAPPING: ${mappingPath}`);
  }
  const digest = sha256Buffer(actualBytes);
  const sidecar = fs.readFileSync(`${mappingPath}.sha256`, 'utf8');
  const expectedSidecar = `${digest}  ${path.basename(mappingPath)}\n`;
  if (sidecar !== expectedSidecar) {
    throw new Error(`committed mapping sidecar mismatch: ${mappingPath}.sha256`);
  }
  return { mappingPath: path.resolve(mappingPath), sha256: digest, bytes: actualBytes.length };
}

// ---------- research config (adapter over the production config shape) ----------
function assertEngineParams(marketConfig, context) {
  const expected = ENGINE_PARAMS;
  if (!marketConfig || marketConfig.modelId !== expected.modelId || Number(marketConfig.version) !== expected.version ||
      marketConfig.range !== expected.range || Number(marketConfig.window) !== expected.window ||
      Number(marketConfig.minWindowPoints) !== expected.minWindowPoints ||
      Number(marketConfig.minComponents) !== expected.minComponents || Number(marketConfig.fillDays) !== expected.fillDays) {
    throw new Error(`${context}: engine identity or parameters differ from the frozen production contract`);
  }
}

function buildResearchConfig(productionMarketConfig) {
  assertEngineParams(productionMarketConfig, 'data/config.json marketFearGreed');
  const configuredKeys = Object.keys((productionMarketConfig && productionMarketConfig.markets) || {}).sort();
  const expectedKeys = MARKET_ORDER.slice().sort();
  if (JSON.stringify(configuredKeys) !== JSON.stringify(expectedKeys)) {
    throw new Error(`configured market set drifted: ${configuredKeys.join(', ') || 'missing'}`);
  }
  const researchConfig = deepClone(productionMarketConfig);
  for (const key of MARKET_ORDER) {
    researchConfig.markets[key].symbols = deepClone(RESEARCH_MARKET_SYMBOLS[key]);
  }
  if (researchConfig.markets.crypto.barPolicy !== FROZEN_MAPPING.cryptoBarPolicy) {
    throw new Error(`crypto barPolicy drifted from ${FROZEN_MAPPING.cryptoBarPolicy}`);
  }
  researchConfig.markets.crypto.name = 'Crypto — research fixed 6-asset long-history basket';
  researchConfig.markets.crypto.components = deepClone(CRYPTO_RESEARCH_COMPONENTS);
  // The single most dangerous silent failure of this variant: ustech large must
  // never be null (null -> index passthrough would divide NAESX by ^IXIC).
  if (researchConfig.markets.ustech.symbols.large !== 'VFINX') {
    throw new Error('ustech large must be explicitly VFINX in the research config');
  }
  for (const key of MARKET_ORDER) {
    if (!('vol' in researchConfig.markets[key].symbols) || researchConfig.markets[key].symbols.vol !== null) {
      throw new Error(`${key}: research vol slot must be the literal null realized-vol fallback`);
    }
  }
  return researchConfig;
}

function loadProductionMarketConfig(configPath = CONFIG_PATH) {
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!config || !config.marketFearGreed) throw new Error(`no marketFearGreed configuration in ${configPath}`);
  return config.marketFearGreed;
}

function collectResearchSymbols(researchConfig) {
  const symbols = [...new Set(Object.values(researchConfig.markets).flatMap(market =>
    Object.values(market.symbols || {}).flatMap(spec => marketfg.collectSpecSymbols(spec))))].sort();
  const expected = Object.keys(EXPECTED_INSTRUMENT_TYPES).sort();
  if (JSON.stringify(symbols) !== JSON.stringify(expected)) {
    throw new Error(`research symbol set drifted from the frozen identity contract: ${symbols.join(', ')}`);
  }
  return symbols;
}

// ---------- Yahoo acquisition with receipts ----------
function yahooChartUrl(host, symbol, period2Seconds) {
  // 'max' must be requested as an explicit period: a literal range=max makes
  // Yahoo downgrade long mutual-fund histories to monthly bars; period1=0 keeps
  // daily ones for the whole feed history.
  return `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?period1=0&period2=${period2Seconds}&interval=1d&events=div%2Csplits`;
}

function parseYahooChartPayload(symbol, rawBytes, fetchedAt) {
  let payload;
  try { payload = JSON.parse(Buffer.from(rawBytes).toString('utf8')); }
  catch (error) { throw new Error(`${symbol}: Yahoo payload is not JSON (${error.message})`); }
  const chart = payload && payload.chart;
  const result = chart && Array.isArray(chart.result) && chart.result[0];
  if (!result || (chart && chart.error)) {
    const description = chart && chart.error && chart.error.description;
    throw new Error(`${symbol}: Yahoo chart result unavailable${description ? ` (${description})` : ''}`);
  }
  const meta = result.meta || {};
  const expectedType = EXPECTED_INSTRUMENT_TYPES[symbol];
  if (!expectedType) throw new Error(`${symbol}: symbol is not part of the frozen research mapping`);
  if (meta.symbol !== symbol) throw new Error(`${symbol}: Yahoo meta.symbol is ${meta.symbol || 'missing'}`);
  if (meta.currency !== 'USD') throw new Error(`${symbol}: Yahoo currency is ${meta.currency || 'missing'}, expected USD`);
  if (meta.instrumentType !== expectedType) throw new Error(`${symbol}: Yahoo instrumentType is ${meta.instrumentType || 'missing'}, expected ${expectedType}`);
  if (meta.dataGranularity !== '1d') throw new Error(`${symbol}: Yahoo dataGranularity is ${meta.dataGranularity || 'missing'}, expected 1d (range=max downgrade guard)`);
  const timezone = meta.exchangeTimezoneName;
  if (typeof timezone !== 'string' || !timezone) throw new Error(`${symbol}: Yahoo exchangeTimezoneName missing`);

  const timestamps = result.timestamp || [];
  const rawClose = ((((result.indicators || {}).quote || [])[0] || {}).close) || [];
  const adjustedClose = ((((result.indicators || {}).adjclose || [])[0] || {}).adjclose) || [];
  // Whole series or none — adjusted and unadjusted closes are never mixed
  // (same rule as marketfg.js). For indices and crypto adjclose equals close.
  const adjusted = adjustedClose.length === rawClose.length && rawClose.every((close, index) =>
    !(Number.isFinite(close) && close > 0) || (Number.isFinite(adjustedClose[index]) && adjustedClose[index] > 0));
  const closes = adjusted ? adjustedClose : rawClose;

  const retrievalLocalDate = new Date(fetchedAt).toLocaleDateString('sv-SE', { timeZone: timezone });
  const byDate = new Map();
  let excludedCurrentOrFutureRows = 0;
  let skippedNullRows = 0;
  for (let index = 0; index < timestamps.length; index++) {
    const value = closes[index];
    if (value === null || value === undefined) { skippedNullRows++; continue; } // provider gap padding
    const close = Number(value);
    if (!Number.isFinite(close) || close <= 0) {
      throw new Error(`${symbol}: non-finite or non-positive close at payload index ${index}: ${String(value)}`);
    }
    const date = new Date(timestamps[index] * 1000).toLocaleDateString('sv-SE', { timeZone: timezone });
    if (date >= retrievalLocalDate) { excludedCurrentOrFutureRows++; continue; } // completed source-local bars only
    byDate.set(date, { date, close });
  }
  const rows = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  if (rows.length < MIN_ROWS_PER_SERIES) throw new Error(`${symbol}: too little completed daily history (${rows.length} rows)`);

  const series = {
    symbol,
    name: String(meta.longName || meta.shortName || symbol).replace(/\s+/g, ' ').trim(),
    currency: meta.currency,
    tz: timezone,
    adjusted,
    rows,
    lastDate: rows.at(-1).date,
    intraday: false,
    fetchedAt,
  };
  const receipt = {
    symbol,
    expectedInstrumentType: expectedType,
    yahooMeta: {
      symbol: meta.symbol,
      currency: meta.currency,
      instrumentType: meta.instrumentType,
      exchangeName: meta.exchangeName || null,
      exchangeTimezoneName: timezone,
      dataGranularity: meta.dataGranularity,
    },
    adjusted,
    adjustmentMode: adjusted ? 'Yahoo adjusted close for the whole series' : 'Yahoo close; no complete adjusted-close series supplied',
    retrievalLocalDate,
    excludedCurrentOrFutureRows,
    skippedNullRows,
    rowCount: rows.length,
    firstDate: rows[0].date,
    lastDate: rows.at(-1).date,
    normalizedRowsSha256: sha256Buffer(Buffer.from(stableJson(rows), 'utf8')),
  };
  return { series, receipt };
}

async function fetchYahooSeriesWithReceipt(symbol, fetchedAt, fetchImpl = globalThis.fetch) {
  if (typeof fetchImpl !== 'function') throw new Error('fetch implementation is unavailable');
  const period2 = Math.floor(new Date(fetchedAt).getTime() / 1000) + 86400;
  const hosts = ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']; // query2 retried once on failure
  let firstError = null;
  for (const host of hosts) {
    const url = yahooChartUrl(host, symbol, period2);
    try {
      const response = await fetchImpl(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(45000),
      });
      const rawBytes = Buffer.from(await response.arrayBuffer());
      if (!response.ok) throw new Error(`${symbol}: Yahoo HTTP ${response.status}`);
      const parsed = parseYahooChartPayload(symbol, rawBytes, fetchedAt);
      return {
        series: parsed.series,
        receipt: {
          ...parsed.receipt,
          sourceUrl: url,
          retrievedAt: fetchedAt,
          rawResponseBytes: rawBytes.length,
          rawPayloadSha256: sha256Buffer(rawBytes),
          rawPayloadBase64: rawBytes.toString('base64'),
        },
      };
    } catch (error) {
      if (!firstError) firstError = error;
    }
  }
  throw firstError || new Error(`${symbol}: Yahoo chart fetch failed`);
}

// Sequential, gently paced acquisition (~1 request/second) of every unique
// research symbol. Injectable fetch/sleep keep tests fully offline.
async function acquireAllSeries({ researchConfig, fetchedAt = new Date().toISOString(), fetchImpl = globalThis.fetch, sleepMs = 1000, log = null } = {}) {
  if (!researchConfig) throw new Error('acquireAllSeries requires a researchConfig');
  const symbols = collectResearchSymbols(researchConfig);
  const seriesMap = new Map();
  const receipts = [];
  for (let index = 0; index < symbols.length; index++) {
    const symbol = symbols[index];
    const { series, receipt } = await fetchYahooSeriesWithReceipt(symbol, fetchedAt, fetchImpl);
    seriesMap.set(symbol, series);
    receipts.push(receipt);
    if (log) log(`${symbol}: ${receipt.rowCount} rows ${receipt.firstDate}..${receipt.lastDate}`);
    if (index < symbols.length - 1 && sleepMs > 0) await sleep(sleepMs);
  }
  return { fetchedAt, symbols, seriesMap, receipts };
}

// ---------- computation (marketfg pure surface, unmodified) ----------
function computeAllMarkets(researchConfig, seriesMap) {
  const computed = {};
  for (const key of MARKET_ORDER) {
    computed[key] = marketfg.computeMarket(key, researchConfig.markets[key], seriesMap, {
      window: ENGINE_PARAMS.window,
      minWindowPoints: ENGINE_PARAMS.minWindowPoints,
      minComponents: ENGINE_PARAMS.minComponents,
      fillDays: ENGINE_PARAMS.fillDays,
      includeHistoryParts: true,
      includeExpandingSignal: false, // history and spans only — never a signal
    });
  }
  return computed;
}

function achievedSpans(computed) {
  const projectedByMarket = new Map(FROZEN_MAPPING.projectedSpans.map(item => [item.market, item]));
  return MARKET_ORDER.map(key => {
    const market = computed[key];
    const projected = projectedByMarket.get(key) || {};
    return {
      market: key,
      firstScore: market.history[0].date,
      lastScore: market.history.at(-1).date,
      rows: market.history.length,
      projectedFirstScore: projected.projectedFirstScore || null,
      currentProductionFirstScore: projected.currentFirstScore || null,
    };
  });
}

function trimMarketResult(result) {
  // Component/score history and spans only; no expanding signal, no decisions.
  const { expandingSignal, ...rest } = result;
  void expandingSignal;
  return rest;
}

function buildRawArtifact({ fetchedAt, receipts }) {
  return {
    schema: `${SCHEMA}-raw`,
    status: STATUS,
    variantId: VARIANT_ID,
    containsStrategyOutcomes: false,
    fetchedAt,
    endpointTemplate: 'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?period1=0&period2={now+1d}&interval=1d&events=div%2Csplits (query2 retried once)',
    userAgent: USER_AGENT,
    receipts,
  };
}

function buildScoresArtifact({ fetchedAt, computed }) {
  return {
    schema: `${SCHEMA}-scores`,
    status: STATUS,
    variantId: VARIANT_ID,
    containsStrategyOutcomes: false,
    createdAt: fetchedAt,
    engineParams: ENGINE_PARAMS,
    warnings: buildWarnings(),
    markets: Object.fromEntries(MARKET_ORDER.map(key => [key, trimMarketResult(computed[key])])),
  };
}

function buildSummaryArtifact({ fetchedAt, computed, receipts, mappingFreeze, writes }) {
  return {
    schema: `${SCHEMA}-summary`,
    status: STATUS,
    variantId: VARIANT_ID,
    containsStrategyOutcomes: false,
    createdAt: fetchedAt,
    freezeMarker: FREEZE_MARKER,
    engineParams: ENGINE_PARAMS,
    committedMappingFreeze: {
      path: 'research/FEAR_GREED_LONG_HISTORY_PROXY_MAPPING.json',
      sha256: mappingFreeze.sha256,
      bytes: mappingFreeze.bytes,
    },
    achievedSpans: achievedSpans(computed),
    projectedSpans: FROZEN_MAPPING.projectedSpans,
    seriesReceipts: receipts.map(({ rawPayloadBase64, ...receipt }) => { void rawPayloadBase64; return receipt; }),
    artifacts: writes,
    warnings: buildWarnings(),
  };
}

// ---------- CLI ----------
function parseArgs(argv) {
  if (Array.isArray(argv) && argv.length > 0) {
    throw new Error(`fear_greed_long_history_proxy.js accepts no arguments (got: ${argv.join(' ')})`);
  }
  return {};
}

async function main(argv = process.argv.slice(2)) {
  parseArgs(argv);
  const mappingFreeze = verifyCommittedMapping();
  const researchConfig = buildResearchConfig(loadProductionMarketConfig());
  const acquisition = await acquireAllSeries({
    researchConfig,
    log: line => process.stderr.write(`${line}\n`),
  });
  const computed = computeAllMarkets(researchConfig, acquisition.seriesMap);
  const stamp = runStamp(new Date(acquisition.fetchedAt));
  const rawWrite = writeStableJson(path.join(OUTPUT_DIR, `yahoo-raw-${stamp}.json`),
    buildRawArtifact(acquisition));
  const scoresWrite = writeStableJson(path.join(OUTPUT_DIR, `scores-${stamp}.json`),
    buildScoresArtifact({ fetchedAt: acquisition.fetchedAt, computed }));
  const writes = {
    raw: { path: rawWrite.absolutePath, sha256: rawWrite.sha256, bytes: rawWrite.bytes },
    scores: { path: scoresWrite.absolutePath, sha256: scoresWrite.sha256, bytes: scoresWrite.bytes },
  };
  const summary = buildSummaryArtifact({
    fetchedAt: acquisition.fetchedAt, computed, receipts: acquisition.receipts, mappingFreeze, writes,
  });
  const summaryWrite = writeStableJson(path.join(OUTPUT_DIR, `summary-${stamp}.json`), summary);
  process.stdout.write(`${STATUS}\n`);
  for (const span of summary.achievedSpans) {
    process.stdout.write(`${span.market}: firstScore=${span.firstScore} lastScore=${span.lastScore} rows=${span.rows} projected=${span.projectedFirstScore}\n`);
  }
  process.stdout.write(`raw: ${rawWrite.absolutePath} (sha256 ${rawWrite.sha256})\n`);
  process.stdout.write(`scores: ${scoresWrite.absolutePath} (sha256 ${scoresWrite.sha256})\n`);
  process.stdout.write(`summary: ${summaryWrite.absolutePath} (sha256 ${summaryWrite.sha256})\n`);
  return { summary, writes: { ...writes, summary: { path: summaryWrite.absolutePath, sha256: summaryWrite.sha256, bytes: summaryWrite.bytes } } };
}

module.exports = {
  SCHEMA, MAPPING_SCHEMA, STATUS, VARIANT_ID, FREEZE_MARKER, USER_AGENT,
  MARKET_ORDER, ENGINE_PARAMS, RESEARCH_MARKET_SYMBOLS, CRYPTO_RESEARCH_COMPONENTS,
  EXPECTED_INSTRUMENT_TYPES, FROZEN_MAPPING,
  CONFIG_PATH, MAPPING_PATH, PROTOCOL_PATH, OUTPUT_DIR,
  deepClone, canonicalize, stableJson, sha256Buffer, writeStableJson, runStamp,
  buildWarnings, verifyCommittedMapping, assertEngineParams, buildResearchConfig,
  loadProductionMarketConfig, collectResearchSymbols,
  yahooChartUrl, parseYahooChartPayload, fetchYahooSeriesWithReceipt, acquireAllSeries,
  computeAllMarkets, achievedSpans, trimMarketResult,
  buildRawArtifact, buildScoresArtifact, buildSummaryArtifact,
  parseArgs, main,
};

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`${(error && error.stack) || error}\n`);
    process.exitCode = 1;
  });
}
