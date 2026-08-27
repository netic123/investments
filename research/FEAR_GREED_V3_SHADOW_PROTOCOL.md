# Fear & Greed v3 shadow-score protocol

Status: **retrospective development only; not validated; not approved for the live dashboard**.

Implementation: `research/fear_greed_v3_shadow.js`

This protocol defines one universal, research-only challenger to production v2. It exists because the production score can assign a low percentile score to an objectively bullish observation merely because the preceding year was even stronger. It also replaces the small/large relative-return proxy with a direct check of whether several size segments are above their own trends.

The definition was written after the existing history and prior backtest outcomes had already been inspected. Running it on that history cannot create a new holdout or confirm predictive value. It must not be described as reliable, validated, historically winning, or superior to buy-and-hold.

## Immutable interpretation

- Model ID: `investments-unified-fear-greed-v3-shadow-absolute-vol-normalized-v1`.
- Output status: `RETROSPECTIVE_DEVELOPMENT_ONLY_NOT_VALIDATED_NOT_LIVE_APPROVED`.
- The score is a descriptive risk-appetite summary. A high score is not itself a buy signal, and a low score is not itself a sell signal.
- There are exactly six complete components. If any component is unavailable, no score is emitted for that date.
- Every component has weight `1/6`.
- Every lookback and scaling constant is identical in Crypto, Sweden, USA, Europe and Global.
- No trailing rank, quantile or percentile appears anywhere in the v3 shadow formula.
- The implementation performs no network request and has no path that updates production code, configuration, snapshots or static site files.

## Frozen retrospective input

The default research replay accepts only this byte-identical schema-5 snapshot:

- file: `fear-greed-v2-validation-input-2026-08-25T12-44-22Z.json`;
- collected: `2026-08-25T12:44:22.950Z`;
- SHA-256: `ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d`;
- source interpretation: `RETROSPECTIVE_DEVELOPMENT_ONLY_NO_CONFIRMATORY_OUTCOME`.

The loader verifies both the bytes and the adjacent `.sha256` sidecar. The snapshot contains adjusted-close histories and the exact fixed synthetic crypto baskets used by schema 5.

## Common observations and causality

For a score dated `t`, each input is the latest completed observation with date less than or equal to `t`. The observation may be carried for at most seven calendar days. Pair components use strict common close dates. No future fill, interpolation or same-day future outcome is used.

Any strategy or forecast that later consumes the score must treat it as known only after close `t`; the earliest permitted entry or forecast origin is the next tradable target bar `t+1`.

All prices must be positive. Dates must be strictly increasing and unique. Synthetic baskets are daily-rebalanced arithmetic equal-weight return indices built only on strict common constituent dates.

## Common constants

| Parameter | Value |
|---|---:|
| Benchmark trend SMA | 200 bars |
| Trailing high | 252 bars |
| Short realised volatility | 20 returns |
| Long realised volatility | 252 returns |
| Normalisation volatility | 63 returns |
| Relative-return horizon | 20 bars |
| Participation trend SMA | 100 bars |
| Normalisation horizon | 20 bars |
| Symmetric score anchors | -2 sigma = 0; 0 = 50; +2 sigma = 100 |
| Drawdown score anchors | -2 sigma = 0; 0 drawdown = 100 |
| Volatility-regime anchors | ratio 0.5 = 100; ratio 1 = 50; ratio 2 = 0 |
| Daily volatility floor | `0.000001` |
| Maximum carry | 7 calendar days |
| Minimum distinct participation segments | 2 |

`clip(x)` below means truncation to the inclusive interval 0–100. Daily volatility is the sample standard deviation of daily log returns. The volatility floor only prevents division by zero; it is not estimated by market.

## The six components

### 1. Benchmark trend

Let `P` be the benchmark close, `SMA200` its 200-bar simple moving average and `sigma63` its 63-return daily realised volatility.

`z_trend = ln(P / SMA200) / (sigma63 * sqrt(20))`

`trend_score = clip(50 + 25 * z_trend)`

This asks how far the benchmark is above or below its own long trend in volatility units. It does not ask where that distance ranks within the last year.

### 2. Drawdown / price strength

Let `HIGH252` be the highest benchmark close in the current and preceding 251 bars.

`z_drawdown = ln(P / HIGH252) / (sigma63 * sqrt(20))`

`strength_score = clip(100 + 50 * z_drawdown)`

The score is 100 at the trailing high, 50 one normalised sigma below the high and 0 two normalised sigmas below it. Consequently, a market only a small fraction below a record cannot become “Fear” merely because near-record observations were common during the preceding year.

### 3. Realised-volatility regime

Let `sigma20` and `sigma252` be the benchmark's 20- and 252-return daily realised volatilities.

`vol_ratio = sigma20 / sigma252`

`volatility_score = clip(50 - 50 * log2(vol_ratio))`

Short volatility equal to long volatility is neutral. Half the long regime maps to 100, and double maps to 0. Using realised volatility for every tab removes the old semantic split in which some markets had an implied-volatility series and others used a fallback.

### 4. Safe-haven relative performance

On strict common dates, calculate the 20-bar benchmark-minus-bond log return. Divide it by the 63-return sample volatility of daily benchmark-minus-bond log returns and by `sqrt(20)`.

`z_safe = relative_log_return20 / (relative_sigma63 * sqrt(20))`

`safe_haven_score = clip(50 + 25 * z_safe)`

Zero relative performance is neutral. Positive risk-asset performance is greed; bond outperformance is fear.

### 5. Credit appetite

Apply the same relative formula and scaling to high-yield minus investment-grade credit:

`z_credit = relative_credit_log_return20 / (relative_credit_sigma63 * sqrt(20))`

`credit_score = clip(50 + 25 * z_credit)`

Zero high-yield/IG relative performance is neutral. No market-specific credit threshold or percentile is fitted.

### 6. Participation proxy (the breadth slot)

Resolve each distinct available broad, large and small segment. For each segment `j`:

`z_j = ln(P_j / SMA100_j) / (sigma63_j * sqrt(20))`

`segment_score_j = clip(50 + 25 * z_j)`

The breadth-slot score is the arithmetic mean of the segment scores. The output also records the literal fraction of segments above their own SMA100. At least two distinct segments are required.

This is not the small/large return ratio. Small caps can lag large caps and still count as participating when both are above their own trends. It is also not constituent-level advance/decline breadth. It must be displayed and discussed as a **participation proxy**, not as actual market breadth.

## Frozen market mappings and limitations

The shadow replay inherits the schema-5 source mappings solely because those are the byte-frozen retrospective inputs:

| Tab | Benchmark | Participation segments |
|---|---|---|
| Crypto | fixed seven-coin equal-weight basket | broad basket, BTC/ETH core, five-coin non-core basket |
| Sweden | `^OMXSBGI` | `^OMXSBGI`, `XACT-SVERIGE.ST`, `XACT-SMABOLAG.ST` |
| USA | `SPY` | `SPY`, `IWM` |
| Europe | `^STOXX` | `^STOXX`, `EXSA.DE`, `EXSE.DE` |
| Global | `ACWI` | `ACWI`, `IWDA.L`, `WSML.L` |

Important consequences:

1. The frozen USA history does **not** contain the Dow Jones U.S. Index (`DJUS`/`^DJUS`). This replay therefore cannot validate a claim about that exact index. Replacing SPY with DJUS requires a new, separately frozen input version.
2. USA has only two distinct participation proxies because the old `large=null` mapping falls back to SPY. This is better aligned than an IWM/SPY relative ratio, but still weak breadth coverage.
3. The crypto constituents were fixed with August 2026 knowledge. That creates survivorship and selection risk in retrospective history and is not an “all coins” market index.
4. ETF/fund proxies can differ in trading calendar, currency, fees, distributions and inception date. Strict common dates and adjusted closes reduce but do not remove those limitations.
5. A broad cap-weighted index near a record shows strong price trend. It does not by itself prove sentiment euphoria or broad constituent participation.

The preferred mapping for a later, separately frozen input is not the same as the old snapshot mapping. The current benchmark audit recommends `^DJUS` as the broad USA reference with `IYY` as an investable return target and `IWB`/`IWM` participation proxies; `^OMXSBGI` remains the operational Sweden reference; Europe should evaluate the audited `EXSC.DE`/`EXSE.DE` participation pair; and `SPGM` is a broader Global candidate but still does not supply true constituent breadth. Crypto requires a point-in-time broad-market construction rather than the fixed seven-coin survivorship backcast. These are input-design requirements for a future version, not silent substitutions permitted in this frozen replay.

## Research and promotion gates

The code and tests establish formula identity, arithmetic, input integrity and absence of simple lookahead. They do not establish forecasting value.

Before any production use:

1. keep this exact candidate unchanged during evaluation;
2. score at close `t` and trade or forecast no earlier than `t+1`;
3. compare it with the identical score-free baseline and 100% buy-and-hold after symmetric costs;
4. use one common rule and common parameters in all five markets;
5. report each market, the common calendar, turnover, drawdown and cost stress, not only an average;
6. treat all data through 24 August 2026 as development data because it has already been inspected repeatedly;
7. obtain confirmation only from an append-only, point-in-time prospective dataset collected after the candidate is locked;
8. do not wire the score into `marketfg.js`, `data/config.json`, the API, the static build or the live site unless the separate validation and approval gates are met.

Failure to beat buy-and-hold in a test is evidence against that use of the model; it is not permission to keep retuning the six indicators until the same history passes.
