# Schema 9 core-overlay audit — 25 August 2026

## Conclusion

`S9_CORE_50_STEP_50` is **not** a historical winner against matched
buy-and-hold. The frozen rule lost in all five complete market histories and
in nine of ten independently restarted chronological halves. It must not be
used to claim that Extreme Fear is a reliable buy signal or Extreme Greed is a
reliable sell signal.

This result rejects only the one tested policy: 150% target exposure at scores
`<=24`, 100% at `25..74`, and 50% at `>=75`, rebalanced on the next target close
with 0.50% one-way notional cost and a fixed 5% annual borrowing stress. It does
not prove that every sentiment model is useless.

## Frozen identity

- Freeze: `2026-08-25T17:10:40.436Z`
- Protocol SHA-256:
  `32ab0b0cda448a723d18e4729e32db3c969e3d89c9a1157dc185c1e14241c4b0`
- Normalized runner SHA-256:
  `3c493629894265b3bbc0de4aaa2fab85b3a0ae7934c280afe95cf975ca9c2b63`
- Synthetic-test SHA-256:
  `cc04066c384a81f6e88629a83e87962387e76d480194afed685a62ac6f828ec7`
- Input snapshot SHA-256:
  `ac025aec6096147aeabba61f270e2fdd9e1032068b10c474fea73cbf4999444d`
- Analysis fingerprint:
  `c16c3508b1ad512f82ef4c775b5555116b4ea1991eb784936dc288e2e6398da4`

The policy, implementation, tests, thresholds, costs and gates were frozen
before the first real-snapshot execution. The targeted synthetic tests passed
10/10 and the complete repository suite passed 83/83 before the outcome was
opened. The post-run audit nevertheless found a boundary-semantics discrepancy
between the written integer-label policy and the frozen implementation; it is
quantified below rather than concealed or silently patched.

## Complete native histories after friction

| Market | Dates | Strategy | Buy-and-hold | Wealth ratio | Annualized log excess | Max-DD improvement |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| Crypto | 2020-12-16..2026-08-24 | 10.087 | 24.229 | 0.416 | -15.409% | -2.010 pp |
| Sweden | 2023-03-20..2026-08-24 | 1.556 | 1.605 | 0.969 | -0.905% | -2.589 pp |
| USA | 2008-04-07..2026-08-24 | 2.156 | 7.788 | 0.277 | -6.988% | -10.548 pp |
| Europe | 2011-08-30..2026-08-24 | 1.572 | 2.836 | 0.554 | -3.938% | -20.062 pp |
| Global | 2018-12-20..2026-08-24 | 1.727 | 2.889 | 0.598 | -6.701% | -11.755 pp |

Full-history wins were 0/5. Maximum drawdown was worse in 5/5. Every market
contained executed fear and greed targets, so the negative result is not a
no-signal artifact.

The only winning half was Sweden's second half, 2024-11-20..2026-08-24:
1.387 versus 1.305. All other halves lost, producing 1/10 total.

## Common five-market calendar

For 830 shared dates from 2023-03-20 through 2026-08-24, five equal initial
capital sleeves produced:

- strategy terminal wealth: `1.7296873360`;
- buy-and-hold terminal wealth: `1.9383700171`;
- strategy/B&H ratio: `0.8923411530`;
- excess CAGR: `-3.9607` percentage points;
- annualized log excess: `-3.3203` percentage points; and
- maximum drawdown: `-33.2118%` versus B&H `-29.4285%`.

## Cost and timing diagnostics

Removing only transaction costs while retaining the predeclared 5% borrowing
stress gives approximate full-history terminal wealth of:

| Market | Zero-transaction-cost strategy | Buy-and-hold | Win? |
| --- | ---: | ---: | --- |
| Crypto | 14.285 | 24.229 | no |
| Sweden | 1.715 | 1.605 | yes |
| USA | 7.082 | 7.788 | no |
| Europe | 3.113 | 2.836 | yes |
| Global | 2.883 | 2.889 | no |

Costs therefore amplify the loss but do not create the central 0/5 conclusion:
even the zero-transaction-cost diagnostic wins only two markets.

Against up to 199 frozen circular timing shifts per market, only Sweden placed
at or above the 90th percentile. Actual percentiles were Crypto 18.1%, Sweden
93.5%, USA 35.2%, Europe 78.4%, and Global 59.8%. The original signal alignment
therefore lacked broad timing superiority even relative to shifted versions of
its own score sequence.

## Reproduction and audit

Canonical and replay artifacts are byte-identical:

- JSON SHA-256:
  `ec96c26b2770cdfcd0cdfc7aa4f25ff527be8c2f375306c952ea9137693e50ba`
- Markdown SHA-256:
  `95b474f92f98a5d3449cf174719b9c11cbf727e0fa681ce2d6d9fbfc8f932fda`

An independent implementation review reproduced 2,106 aggregate identities
and 311,480 event, cost and score-mapping identities without an arithmetic or
event-timing mismatch. The next-close timing, post-cost target equations,
negative-cash financing, output arithmetic and reported gate counts are
internally consistent.

Three control/reporting defects remain documented. None reverses 0/5:

1. **Dashboard-label boundary discrepancy.** The protocol says the already
   published integer dashboard label controls exposure. Production first
   rounds its one-decimal displayed score to the nearest integer and then
   labels it. The frozen runner instead compares the raw one-decimal score
   directly with 24 and 75. This changes 131 signal days: Crypto 22, Sweden 5,
   USA 48, Europe 35 and Global 21. A read-only correction applying the exact
   production rounding still gives 0/5 full-history wins and 1/10 half wins:

   | Market | Corrected strategy | Buy-and-hold | Corrected ratio | Corrected annualized log excess |
   | --- | ---: | ---: | ---: | ---: |
   | Crypto | 10.488 | 24.229 | 0.433 | -14.725% |
   | Sweden | 1.560 | 1.605 | 0.972 | -0.839% |
   | USA | 2.124 | 7.788 | 0.273 | -7.070% |
   | Europe | 1.491 | 2.836 | 0.526 | -4.292% |
   | Global | 1.753 | 2.889 | 0.607 | -6.507% |

   Corrected common-calendar wealth is 1.744927 versus B&H 1.938370,
   with annualized log excess -3.0646 percentage points. Therefore the frozen
   artifact is not an exact dashboard-label replication, but the exact-label
   correction cannot create a historical winner.

2. **Replay-gate timing.** The canonical runner labels
   `deterministicHashReplay` true after two in-process calculations, before a
   saved artifact replay is supplied. A genuine byte-identical saved replay
   was subsequently completed, so the final evidence satisfies the intended
   requirement; the first-run flag alone must not be treated as proof of a
   saved replay.

3. **Incomplete zero-cost output.** The runner computes the complete
   zero-transaction-cost path but retains only absolute and relative terminal
   cost haircuts in the canonical JSON. Terminal values can be reconstructed,
   as above, but the full zero-cost drawdown, volatility and wealth path are
   not reported.

The frozen runner is preserved rather than silently rewritten after its
outcome was observed. Any future study must correct these controls before its
own freeze.

## Evidence boundary and next honest step

The exact 50/100/150 policy is a preregistered stress test, not a replication
of an academic rule. Published near-matches use different signals, portfolio
optimizers, continuous forecast-to-weight mappings, binary futures positions,
or no retained core. No verified primary study located by the literature
review supplies the same exact rule across USA, Sweden, Europe, Global and
Crypto with genuine out-of-sample, after-cost superiority to buy-and-hold.

The same historical endpoint has now been repeatedly reused. Trying another
weight, threshold, lag or filter and reporting only a winner would be data
mining. New evidence now requires either a genuinely new forward period frozen
before observation or an independently published exact rule that can be
replicated without adapting it to these outcomes.
