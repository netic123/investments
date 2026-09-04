'use strict';

// Guards for the public-site trust fixes: the published page must compile, carry
// a hash-based Content-Security-Policy, label snapshot data as such, and show
// share changes as plain differences in shares held.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const build = require('../scripts/build-pages');

test('the inline script compiles and the static page gets a matching hash-based CSP', () => {
  const script = build.checkInlineScript(html);
  assert.ok(script.length > 1000);
  const page = build.staticPageHtml(html);
  build.verifyStaticPage(page);
  const csp = /<meta http-equiv="Content-Security-Policy" content="([^"]+)">/.exec(page)[1];
  // the published page is normalised to LF, the form a browser hashes before checking the policy
  const hash = crypto.createHash('sha256').update(script.replace(/\r\n/g, '\n'), 'utf8').digest('base64');
  assert.ok(csp.includes(`script-src 'sha256-${hash}'`));
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'self' https:\/\/data\.sec\.gov https:\/\/api\.github\.com;/);
  assert.doesNotMatch(csp, /script-src[^;]*'unsafe-inline'/);
  assert.ok(page.includes('<meta name="investments-mode" content="static">'));
  assert.ok(!page.includes('<meta name="investments-mode" content="local">'));
  // a page whose script changed after the CSP was computed must be rejected
  assert.throws(() => build.verifyStaticPage(page.replace('</script>', ';\n</script>')), /does not match the inline script/);
  // a syntax error must be caught before deployment
  assert.throws(() => build.checkInlineScript(html.replace('</script>', 'const = ;</script>')), /does not compile/);
  assert.throws(() => build.staticPageHtml(html + '<script></script>'), /exactly one inline/);
});

test('the page labels snapshot data, times and changes truthfully', () => {
  // no "Price now" on the static site; quotes carry their time, zone and age
  assert.match(html, /STATIC_BUILD \? 'Price at snapshot'/);
  assert.match(html, /timeZoneName:'short'/);
  assert.match(html, /vs previous close/);
  assert.doesNotMatch(html, /' · day change'/);
  // the snapshot-age, missing-weekday-file and mixed-build warnings are shared by both status scopes and are
  // evaluated when the line is drawn (the age advances while the tab stays open); no threshold is hard-coded
  assert.doesNotMatch(html, /SNAPSHOT_STALE_AFTER_HOURS/);
  assert.match(html, /function sharedWarnings\(\)/);
  assert.match(html, /const errs=\[\.\.\.shared\.map\(w=>w\.text\),\.\.\.scoped\];/);
  assert.match(html, /older than the \$\{th\.hours\} h expected\$\{window\}/);
  // the window clause is only claimed when build.json publishes one
  assert.match(html, /const window=th\.window\?\(th\.inWindow\?' while the weekday schedule is active':' outside the weekday schedule'\):'';/);
  // the page can only see what the CDN served it, and it must not claim schedules are the only trigger
  assert.match(html, /no newer build has been served to this page since/);
  assert.doesNotMatch(html, /no build has published since/);
  assert.match(html, /Nothing on this page can start a build; a new snapshot appears after a push, after a requested build, or when GitHub starts one of the scheduled slots/);
  assert.doesNotMatch(html, /builds happen only when GitHub starts a scheduled run/);
  // the run count is a lower bound when every listed run falls inside the window (only 20 are read)
  assert.match(html, /BUILD_RUNS_24H=\{n:started24h,atLeast:started24h===runs\.length\}/);
  assert.match(html, /'at least ':''\)\+BUILD_RUNS_24H\.n/);
  assert.match(html, /is normally published by \$\{B\.holdingsFileExpectedByUtc\} UTC; this snapshot was built before it and shows the \$\{fmtDate\(fileDate\)\} file/);
  assert.match(html, /a US market holiday would explain that and is not modelled here/);
  assert.match(html, /a file’s bytes do not match the SHA-256 that build\.json publishes for it/);
  assert.match(html, /this page’s code is from build \$\{SNAPSHOT\.codeBuild\.slice\(0,7\)\} while its data is from build/);
  assert.match(html, /meta\[name="investments-build-commit"\]/);
  assert.doesNotMatch(html, /no scheduled rebuild has succeeded/, 'the page never promises a rebuild');
  // build.json publishes both thresholds: 3 h while the weekday half-hourly
  // schedule is active, 30 h outside that window; the window agrees with the crons
  assert.equal(build.SNAPSHOT_STALE_AFTER_HOURS, 3);
  assert.equal(build.SNAPSHOT_STALE_AFTER_HOURS_OFF_SCHEDULE, 30);
  assert.deepEqual(build.SCHEDULE_WINDOW_UTC, { days: 'Mon-Fri', from: '05:20', to: '23:20' });
  assert.equal(build.HOLDINGS_FILE_EXPECTED_BY_UTC, '00:30');
  // the reload skips only the browser cache: no cache-busting query (the Pages CDN ignores it), the CDN copy's
  // age is read from the same-origin Age header, and the verdict says what was served
  assert.doesNotMatch(html, /'\?reload='/);
  assert.doesNotMatch(html, /bypassing caches|bypasses the Pages CDN/);
  assert.match(html, /fetch\(apiUrl\(u\),\{cache:'no-store',\.\.\.opt,signal\}\)/);
  assert.match(html, /r\.headers\.get\('age'\)/);
  assert.match(html, /' · CDN copy '\+Math\.round\(SNAPSHOT\.cdnAge\+\(Date\.now\(\)-\(SNAPSHOT\.cdnAgeAt\|\|Date\.now\(\)\)\)\/1000\)\+' s old'/);
  assert.match(html, /this check failed \('\+errMsg\(e\)\+'\)/, 'a failed re-check keeps the loaded set and its status');
  assert.match(html, /' · no newer snapshot was served \(the CDN may hold a copy for up to 10 min\)'/);
  assert.match(html, /' · newer snapshot loaded'/);
  assert.match(html, /' · first snapshot loaded'/);
  assert.doesNotMatch(html, /no newer snapshot has been published/);
  // every JSON file is hashed from the bytes that are parsed and compared with build.json.files; a mismatch is
  // retried once and otherwise labelled; an older build.json never replaces the loaded set
  assert.match(html, /crypto\.subtle\.digest\('SHA-256',buf\)/);
  assert.match(html, /const buf=await r\.arrayBuffer\(\);.*JSON\.parse\(new TextDecoder\(\)\.decode\(buf\)\)/);
  assert.match(html, /filesMatch\(build&&build\.files,'api\/'\+n\+'\.json',got\[n\]\.digest\)==='mismatch'/);
  assert.match(html, /if\(bad\.length\)\{ retried=true; const b=await fetchApi\('\/api\/build'\);/);
  assert.match(html, /const older=Date\.parse\(set\.build\.generatedAt\)<Date\.parse\(prev\.build\.generatedAt\);/);
  assert.match(html, /kept the consistent set already loaded/);
  assert.match(html, /index\.html itself cannot check its own hash/);
  // timestamps carry the zone of their own instant, never a global label computed from "now"
  assert.match(html, /new Intl\.DateTimeFormat\('en-GB',\{\.\.\.opts,timeZoneName:'short'\}\)\.format\(d\)/);
  assert.doesNotMatch(html, /TZ_SHORT|zone\(\)/);
  // pricing date: exact and per-share proofs, and a stated reason otherwise
  assert.match(html, /mode:'per-share'/);
  assert.match(html, /Pricing date not asserted:/);
  // changes are share differences; dilution by a cash creation is explained, not listed as a trade
  assert.match(html, /WAGN units were \$\{flow\.delta>0\?'created':'redeemed'\}/);
  assert.match(html, /vs pro-rata/);
  assert.doesNotMatch(html, /WAGN flow-adjusted signal/);
  // SEC: the browser-side recency check reports when it could not run
  assert.match(html, /Filing recency unconfirmed/);
  // the research signal is introduced as not a recommendation before the BUY/SELL state
  assert.ok(html.indexOf('Not a recommendation.') < html.indexOf('model target: <b>${D.action}'));
  // the visitor is told which third parties the browser contacts
  assert.match(html, /Google Fonts for the typefaces/);
});

test('the pure page helpers apply build.json thresholds, the expected weekday file, the digest map and the schedule text', () => {
  const start = html.indexOf('const hhmmUtc=');
  const end = html.indexOf('// ---- end pure helpers');
  assert.ok(start > 0 && end > start, 'the pure helper block must be delimited in index.html');
  const helpers = require('node:vm').runInNewContext(`${html.slice(start, end)}\n;({staleThreshold,expectedHoldingsFileDate,filesMatch,describeSchedules,CRON_LABELS})`, {});
  const published = {
    snapshotStaleAfterHours: build.SNAPSHOT_STALE_AFTER_HOURS,
    snapshotStaleAfterHoursOffSchedule: build.SNAPSHOT_STALE_AFTER_HOURS_OFF_SCHEDULE,
    scheduleWindowUtc: { ...build.SCHEDULE_WINDOW_UTC },
    holdingsFileExpectedByUtc: build.HOLDINGS_FILE_EXPECTED_BY_UTC,
  };
  const at = iso => Date.parse(iso);
  // staleness: the on-schedule threshold inside the weekday window (UTC), the off-schedule one otherwise
  assert.deepEqual([helpers.staleThreshold(published, at('2026-09-04T13:31:00Z')).hours, helpers.staleThreshold(published, at('2026-09-04T13:31:00Z')).inWindow], [3, true], 'Friday afternoon');
  assert.equal(helpers.staleThreshold(published, at('2026-09-04T23:30:00Z')).hours, 30, 'Friday after the last slot');
  assert.equal(helpers.staleThreshold(published, at('2026-09-05T10:00:00Z')).hours, 30, 'Saturday');
  assert.equal(helpers.staleThreshold(published, at('2026-09-07T05:19:00Z')).hours, 30, 'Monday before the first slot');
  assert.equal(helpers.staleThreshold(published, at('2026-09-07T05:20:00Z')).hours, 3, 'Monday at the first slot');
  const single = helpers.staleThreshold({ snapshotStaleAfterHours: 30 }, at('2026-09-05T10:00:00Z'));
  assert.deepEqual([single.hours, single.inWindow, single.window], [30, null, null], 'an older build.json with one threshold claims no window');
  assert.equal(helpers.staleThreshold({}, at('2026-09-05T10:00:00Z')).hours, null, 'no threshold means no age warning');
  // the newest weekday file that should exist: that day's after 00:30 UTC, the previous weekday's before, Friday's at the weekend
  assert.equal(helpers.expectedHoldingsFileDate(published, at('2026-09-04T13:31:00Z')), '2026-09-04');
  assert.equal(helpers.expectedHoldingsFileDate(published, at('2026-09-04T00:29:00Z')), '2026-09-03');
  assert.equal(helpers.expectedHoldingsFileDate(published, at('2026-09-04T00:30:00Z')), '2026-09-04');
  assert.equal(helpers.expectedHoldingsFileDate(published, at('2026-09-05T10:00:00Z')), '2026-09-04', 'Saturday');
  assert.equal(helpers.expectedHoldingsFileDate(published, at('2026-09-06T23:59:00Z')), '2026-09-04', 'Sunday');
  assert.equal(helpers.expectedHoldingsFileDate(published, at('2026-09-07T00:10:00Z')), '2026-09-04', 'Monday before the file time');
  assert.equal(helpers.expectedHoldingsFileDate(published, at('2026-09-07T00:40:00Z')), '2026-09-07', 'Monday after the file time');
  assert.equal(helpers.expectedHoldingsFileDate({}, at('2026-09-07T00:40:00Z')), null, 'no published time means no expectation');
  // digest map: match, mismatch, unknown
  const hex = 'a'.repeat(64);
  assert.equal(helpers.filesMatch({ 'api/quotes.json': hex }, 'api/quotes.json', hex), 'match');
  assert.equal(helpers.filesMatch({ 'api/quotes.json': hex }, 'api/quotes.json', 'b'.repeat(64)), 'mismatch');
  assert.equal(helpers.filesMatch({ 'api/quotes.json': hex }, 'api/nav.json', hex), 'unknown', 'no entry');
  assert.equal(helpers.filesMatch(null, 'api/quotes.json', hex), 'unknown', 'no map (local mode)');
  assert.equal(helpers.filesMatch({ 'api/quotes.json': hex }, 'api/quotes.json', null), 'unknown', 'no digest (no secure context)');
  assert.equal(helpers.filesMatch({ 'api/quotes.json': 'not-hex' }, 'api/quotes.json', hex), 'unknown', 'a malformed published digest proves nothing');
  // schedule text: every cron of pages.yml has a label, the three together read as one half-hourly weekday series,
  // and an unfamiliar cron is printed verbatim
  const crons = build.workflowSchedules(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8'));
  for (const cron of crons) assert.ok(cron in helpers.CRON_LABELS, `index.html CRON_LABELS lacks '${cron}'`);
  assert.equal(helpers.describeSchedules(crons), 'every 30 min 05:20–22:50 UTC Mon–Fri; 09:20 UTC daily, with the test suite');
  assert.equal(helpers.describeSchedules(['20 9 * * *', '0 0 1 * *']), "09:20 UTC daily, with the test suite; cron '0 0 1 * *' (UTC)");
  assert.equal(helpers.describeSchedules([]), '');
  assert.equal(helpers.describeSchedules(null), '');
});

test('published-history import requires provenance and keeps the newest capture of a date', () => {
  const legacy = { date: '2026-08-20', rows: { HCC: { shares: 1 } } };
  const receipt = (date, capturedAt, sha = 'a'.repeat(64)) => ({ date, rows: { HCC: { shares: 1 } }, source: { sha256: sha, fileDate: date, capturedAt } });
  assert.deepEqual(build.usableSnapshots({ snapshots: [legacy, receipt('2026-08-25', '2026-08-25T23:28:20Z')] }).map(s => s.date), ['2026-08-20', '2026-08-25'], 'the committed copy may carry legacy receipts');
  assert.deepEqual(build.usableSnapshots({ snapshots: [legacy, receipt('2026-08-25', '2026-08-25T23:28:20Z')] }, { requireProvenance: true }).map(s => s.date), ['2026-08-25'], 'the published copy may not');
  assert.deepEqual(build.usableSnapshots({ snapshots: [{ ...receipt('2026-08-25', '2026-08-25T23:28:20Z'), source: { sha256: 'zz', fileDate: '2026-08-25' } }] }), [], 'a malformed digest is rejected');
  assert.deepEqual(build.usableSnapshots({ snapshots: [{ ...receipt('2026-08-25', '2026-08-25T23:28:20Z'), source: { sha256: 'a'.repeat(64), fileDate: '2026-08-24' } }] }), [], 'provenance must name the same file date');
  const committed = receipt('2026-08-27', '2026-08-27T00:12:16Z', 'b'.repeat(64));
  const published = receipt('2026-08-27', '2026-08-27T14:12:35Z', 'c'.repeat(64));
  assert.equal(build.mergeSnapshots([committed], [published])[0].source.sha256, 'c'.repeat(64), 'the later capture wins');
  assert.equal(build.mergeSnapshots([published], [committed])[0].source.sha256, 'c'.repeat(64), 'regardless of list order');
  assert.deepEqual(build.mergeSnapshots([legacy], [receipt('2026-08-25', '2026-08-25T23:28:20Z')]).map(s => s.date), ['2026-08-20', '2026-08-25']);
});

test('the browser copy of the pricing-date rule agrees with pabrai.js', () => {
  const { reconcileWagnHoldingsToNav } = require('../pabrai');
  const start = html.indexOf('function holdingsNavCheck(H,N){');
  const end = html.indexOf('// ---- unit counts of saved files');
  assert.ok(start > 0 && end > start, 'holdingsNavCheck must precede the unit-count helpers in index.html');
  const context = { fmt: (n, d = 0) => (typeof n === 'number' ? n.toFixed(d) : String(n)), fmtDate: iso => iso, Date, Number, Math };
  require('node:vm').runInNewContext(html.slice(start, end), context);
  const cases = [
    [{ date: '2026-09-01', netAssets: 296613978.66, sharesOutstanding: 18320814 }, { date: '2026-08-31', nav: 16.19, sharesOut: 18170814 }],
    [{ date: '2026-08-28', netAssets: 289824483.3, sharesOutstanding: 18170814 }, { date: '2026-08-27', nav: 15.95, sharesOut: 18170814 }],
    [{ date: '2026-09-01', netAssets: 296613978.66, sharesOutstanding: 18320814 }, { date: '2026-08-31', nav: 16.19, sharesOut: null }],
    [{ date: '2026-09-02', netAssets: 294400000, sharesOutstanding: 18320814 }, { date: '2026-08-31', nav: 16.19, sharesOut: 18170814 }],
    [{ date: '2026-09-01', netAssets: 296613978.66, sharesOutstanding: 18320814 }, { date: '2026-09-02', nav: 16.19, sharesOut: 18320814 }],
    [{ date: '2026-09-01', netAssets: 296613978.66, sharesOutstanding: 18320814 }, null],
    // the NAV file's own net assets: comparable only when both files carry the same unit count (4 Sep 2026: 80,000 units
    // were created after the NAV file, so not comparable; with equal counts the +73,710.23 difference is reported)
    [{ date: '2026-09-04', netAssets: 296253105.4, sharesOutstanding: 18400814 }, { date: '2026-09-03', nav: 16.1, sharesOut: 18320814, netAssets: 294891395.17 }],
    [{ date: '2026-09-04', netAssets: 294965105.4, sharesOutstanding: 18320814 }, { date: '2026-09-03', nav: 16.1, sharesOut: 18320814, netAssets: 294891395.17 }],
  ];
  for (const [latest, nav] of cases) {
    const page = context.holdingsNavCheck({ latest }, nav);
    const node = reconcileWagnHoldingsToNav(latest, nav);
    assert.equal(page.matched, node.matched, JSON.stringify([latest, nav]));
    assert.equal(page.mode, node.mode, JSON.stringify([latest, nav]));
    assert.equal(page.unitChange, node.unitChange, JSON.stringify([latest, nav]));
    assert.equal(page.navFileNetAssets ?? null, node.navFileNetAssets ?? null, JSON.stringify([latest, nav]));
    assert.equal(page.netAssetsComparable ?? false, node.netAssetsComparable ?? false, JSON.stringify([latest, nav]));
    assert.equal(page.netAssetsDifference == null ? null : page.netAssetsDifference.toFixed(2), node.netAssetsDifference == null ? null : node.netAssetsDifference.toFixed(2), JSON.stringify([latest, nav]));
  }
  const equalUnits = context.holdingsNavCheck({ latest: cases[7][0] }, cases[7][1]);
  assert.equal(equalUnits.netAssetsDifference.toFixed(2), '73710.23');
  assert.equal(context.holdingsNavCheck({ latest: cases[6][0] }, cases[6][1]).netAssetsDifference, null, 'different unit counts: the totals are not compared');
});

test('the browser copy of the implied-unit rule agrees with pabrai.js and labels implied counts', () => {
  const { impliedUnitsFromNav } = require('../pabrai');
  const start = html.indexOf('function impliedUnitsFromNav(netAssets,nav){');
  const end = html.indexOf('// ---- end unit counts');
  assert.ok(start > 0 && end > start, 'the unit-count helper block must be delimited in index.html');
  const context = { fmtDate: iso => iso, Date, Number, Math, Array, String };
  require('node:vm').runInNewContext(html.slice(start, end), context);
  for (const [netAssets, nav] of [[277772617, 15.5], [282432028.64, 15.76], [277772617, 15.67], [294891395.17, 16.1], [296253105.4, 16.1], [null, 16.1]]) {
    const page = context.impliedUnitsFromNav(netAssets, nav), node = impliedUnitsFromNav(netAssets, nav);
    assert.equal(page.units, node.units, `${netAssets} / ${nav}`);
    assert.equal(page.implied, node.implied, `${netAssets} / ${nav}`);
    assert.equal(page.nav, node.nav, `${netAssets} / ${nav}`);
  }
  assert.equal(context.impliedUnitsFromNav(277772617, 15.5).units, 17920814);
  assert.equal(context.impliedUnitsFromNav(277772617, 15.67).implied, false, 'the wrong NAV gives no count');
  // the 20 Aug 2026 file (no SharesOutstanding) is priced at the 19 Aug NAV, not the 20 Aug one
  const N = { history: [{ date: '2026-08-18', nav: 15.11 }, { date: '2026-08-19', nav: 15.5 }, { date: '2026-08-20', nav: 15.67 }, { date: '2026-08-21', nav: 15.76 }, { date: '2026-09-03', nav: 16.1 }] };
  const legacy = { date: '2026-08-20', netAssets: 277772617 };
  assert.equal(context.navBefore('2026-08-20', N).date, '2026-08-19');
  assert.equal(context.navBefore('2026-08-24', N).date, '2026-08-21', 'Monday file: the Friday NAV');
  assert.equal(context.navBefore('2026-09-03', N), null, 'no NAV within four days before the file date');
  const plain = value => JSON.parse(JSON.stringify(value)); // vm objects have another realm's prototype
  assert.deepEqual(plain(context.unitsOf(legacy, N)), { units: 17920814, implied: true, navDate: '2026-08-19', nav: 15.5, reason: null });
  assert.deepEqual(plain(context.unitsOf({ date: '2026-08-25', netAssets: 281177571.66, sharesOutstanding: 17920814 }, N)), { units: 17920814, implied: false, reason: null }, 'a reported count is never replaced');
  assert.equal(context.unitsOf({ date: '2026-08-20', netAssets: 277772617 }, { history: [] }).units, null);
  assert.match(context.unitsOf({ date: '2026-08-20', netAssets: 277772617 }, { history: [] }).reason, /reports no unit count and no NAV history is loaded/);
  assert.match(context.unitsOf({ date: '2026-08-20', netAssets: 277772618.5 }, N).reason, /not a whole number of units/);
  assert.equal(context.pricingOf({ date: '2026-08-20', netAssets: 277772617, sharesOutstanding: 17000000 }, N), null, 'a reported count that contradicts the arithmetic proves nothing');
  const latest = { date: '2026-09-04', netAssets: 296253105.4, sharesOutstanding: 18400814 };
  const flow = context.unitFlowWithImplied(legacy, latest, N);
  assert.deepEqual([flow.known, flow.unitsFrom, flow.unitsTo, flow.delta, flow.implied, flow.kind], [true, 17920814, 18400814, 480000, true, 'creation']);
  assert.ok(Math.abs(flow.pct - 2.678) < 0.001);
  const unknown = context.unitFlowWithImplied(legacy, latest, { history: [] });
  assert.equal(unknown.known, false);
  assert.match(unknown.reason, /20 Aug|2026-08-20/);
  // the page says what it shows: implied counts are labelled, and an unknown first-file count is stated, never guessed
  assert.match(html, /first-file units implied/);
  assert.match(html, /first-file unit count unknown/);
  assert.match(html, /so its count is implied from NetAssets ÷ NAV/);
  assert.match(html, /= NAV \$\{pct\(ratio\(pL\.nav,pF\.nav\),1\)\}/, 'the fund-assets change is split into NAV change x unit flow');
  assert.match(html, /vs pro-rata \$\{adj>0\?'\+':''\}\$\{fmt\(adj\)\}/);
  assert.doesNotMatch(html, /function unitFlowBetween\(/);
});

test('the Pabrai tab states file capture and confirmation, cash rows, currencies and 13F facts truthfully', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
  // two stamps on the holdings file: first capture and the confirmation by the fetch behind the snapshot; never "Retrieved"
  assert.match(html, /File first captured \$\{receipt\}\$\{confirm\}/);
  assert.match(html, /confirmed unchanged at \$\{whenFull\(S\.lastConfirmedAt\)\}/);
  assert.match(html, /outcome==='accepted new file'&&S\.lastConfirmedAt/);
  assert.match(html, /not re-confirmed: the fetch at \$\{whenFull\(H\.upstreamCheckedAt\)\}/);
  assert.doesNotMatch(html, /Retrieved \$\{receipt\}/);
  // NetAssets = rounded NAV x units is a pricing-date proof; the NAV file's own figure is shown next to it
  assert.match(html, /a pricing-date proof, not an independent asset total/);
  assert.match(html, /const navFileNetAssetsText=checked=>/);
  assert.match(html, /reports net assets of <b>\$\$\{fmt\(checked\.navFileNetAssets\)\}<\/b>/);
  // cash: the currency row excludes the money-market fund, explains a negative figure without asserting a cause, and a
  // net-cash row includes the fund; cash-like changes are stated under the changes table, never listed as trades
  assert.match(html, /Currency balances &amp; other \(net\)/);
  assert.match(html, /excludes the '\+cashLikeNames\+' money-market row above/);
  assert.match(html, /Net cash incl\. the \$\{cashLikeNames\} money-market fund/);
  assert.match(html, /it does not state the cause/);
  assert.match(html, /Cash-like rows are not listed as trades: \$\{cashChange\(CASH\)\}/);
  assert.doesNotMatch(html, /Cash \/ currencies \(net\)/);
  // prices carry their listing currency; every ticker suffix in the configuration has a currency
  assert.match(html, /Price \(listing currency\)/);
  const suffixes = /const SUFFIX_CCY=\{([^}]*)\}/.exec(html)[1].split(',').map(x => x.split(':')[0].trim());
  for (const ticker of Object.keys(config.names)) { const suffix = ticker.split(' ')[1]; if (suffix) assert.ok(suffixes.includes(suffix), `index.html SUFFIX_CCY lacks '${suffix}' (${ticker})`); }
  assert.match(html, /const money = \(n,cur='USD'\)=> n==null \? '—' : fmt\(n,2\)\+' '\+cur;/);
  // the badge column is a kind of change, Avanza is explained, the NAV change is dated as a one-day change, the market
  // price is a close, and the watchlist note names the files compared
  assert.doesNotMatch(html, /<th>Signal<\/th>/);
  assert.match(html, /<th title="Kind of share-count change between the two files">Change<\/th>/);
  assert.match(html, /Avanza \(SE broker\)<\/th>/);
  assert.match(html, /Swedish retail broker Avanza/);
  assert.match(html, /for the day\$\{prev\?' \(vs '\+fmtDate\(prev\.date\)\+'\)':''\}/);
  assert.match(html, /'closing market price · '/);
  assert.match(html, /watched holdings · WAGN file dated '\+fmtDate\(L\.date\)/);
  // the performance basis is what the file carries; "total return" is claimed only for the rows the file names so
  assert.match(html, /the file does not state the return basis of the fund rows/);
  assert.doesNotMatch(html, /is total return\)/);
  assert.match(html, /carries no market price before \$\{fmtDate\(firstPx\.date\)\}/);
  // 13F: labels never overstate what a filing proves, the prior filing is named, the deadline is computed, and a listing
  // outside the 13(f) list is said to be structurally absent
  assert.doesNotMatch(html, /SEC auto-verified/);
  assert.match(html, /fetched from SEC EDGAR and validated by this /);
  assert.doesNotMatch(html, /NEW in latest filing|sold out \(-100%\)|'<span class="up">new<\/span>'/);
  assert.match(html, /first reported \(not in the prior 13F\)/);
  assert.match(html, /D\.changeByCusip/);
  assert.match(html, /Changes in the quarter are versus the 13F for \$\{fmtDate\(D\.previous\.asOf\)\}/);
  assert.match(html, /D\.nextFilingSource==='computed'/);
  assert.match(html, /a date typed into the configuration, used because SEC could not be fetched/);
  assert.match(html, /that date has passed, so a newer 13F may exist/);
  assert.match(html, /sec13f&&sec13f\.reportable===false \? `<span class="muted">not in the 13F — \$\{esc\(sec13f\.note\)\}<\/span>`/);
  assert.match(html, /no 13F data exists for this listing/);
  for (const [ticker, entry] of Object.entries(config.names)) {
    assert.ok(entry.sec13f && typeof entry.sec13f.reportable === 'boolean' && typeof entry.sec13f.note === 'string' && entry.sec13f.note.length > 0, `config.names['${ticker}'].sec13f`);
  }
  assert.equal(config.names['CSU CN'].sec13f.reportable, false);
  assert.ok(!config.dates.some(d => /N-CSR/.test(d.label)), 'the N-CSR is read from SEC, not typed into the dates list');
  // N-PORT: the release rule, the capped candidate list, the NAV-proof selection and the issuer-name method are rendered
  // from the build's own fields, and the weekend rule is applied even to an older snapshot
  assert.doesNotMatch(html, /becomes public,? about 60 days/);
  assert.doesNotMatch(html, /expected public by \$\{fmtDate\(nx\.publicBy\)\}/);
  assert.match(html, /N\.candidateCount/);
  assert.match(html, /walk limit '\+fmt\(N\.maxDocuments\)/);
  assert.match(html, /C\.snapshotSelection/);
  assert.match(html, /SEL&&SEL\.rule==='nav-reconciled'&&proof/);
  assert.match(html, /its pricing date is not proven/);
  assert.match(html, /name:'issuer name \(first two words\)'/);
  assert.match(html, /r\.methodLabel \? esc\(r\.methodLabel\)/);
  assert.match(html, /filed as “\$\{esc\(h\.secName\)\}”/);
  // the shareholder reports (N-CSR / N-CSRS) come from nport.shareholderReports; the fund-site date is tied to one accession
  assert.match(html, /N&&N\.shareholderReports/);
  assert.match(html, /filed on EDGAR \$\{fmtDate\(rep\.filed\)\}/);
  // the hand-checked fund-site fact is its own sentence, with its own check date, outside the SEC-sourced one
  assert.match(html, /rep\.accession==='0001133228-26-012211' \? ' Separately: the report PDF was on the fund’s own site/);
  assert.match(html, /checked by hand on 4 Sept 2026; this page does not fetch that site/);
  assert.match(html, /due on EDGAR within \$\{fmt\(SR\.annualDueWithinDays\|\|70\)\} days/);
  assert.match(html, /renderDates\(NPORT\);/);
  assert.equal((html.match(/renderDates\(/g) || []).length, 2, 'renderDates is defined once and called once, after the N-PORT data is known');
  // the page keeps no date arithmetic of its own here: pabrai.js computes the deadline (weekends and federal holidays)
  // and the build publishes the sentence, so the page and the module cannot drift apart
  assert.doesNotMatch(html, /function rollToBusinessDay/);
});

test('the owner live update only ever talks to api.github.com and keeps the token in local storage', () => {
  assert.match(html, /const LIVE_REPO='netic123\/investments', LIVE_WORKFLOW='pages\.yml', LIVE_TOKEN_KEY='investments\.liveUpdateToken';/);
  assert.match(html, /\/actions\/workflows\/'\+LIVE_WORKFLOW\+'\/dispatches'/);
  assert.match(html, /inputs:\{skip_tests:'true',reason:opts\.auto\?'automatic live update from the page \(snapshot older than '\+liveAutoMinutes\(\)\+' min\)':'live update requested from the page'\}/);
  assert.match(html, /fetch\('https:\/\/api\.github\.com\/repos\/'\+LIVE_REPO\+path/);
  // the token is never rendered or logged, only its last four characters are shown
  assert.doesNotMatch(html, /console\.(log|warn|error)\([^)]*token/i);
  assert.match(html, /esc\(token\.slice\(-4\)\)/);
  assert.match(html, /type="password" id="liveTokenInput"/);
  // visitors never see the button: it needs #owner (remembered per session) or a stored token
  assert.match(html, /const OWNER_MODE=/);
  assert.match(html, /btn\.hidden=!\(token\|\|OWNER_MODE\);/);
  assert.match(html, /sessionStorage\.setItem\('investments\.owner','1'\)/);
  // and the disclosure names it
  assert.match(html, /api\.github\.com, only when you open Build history \(an unauthenticated read of the last 20 runs\) or when the owner’s live update runs with a stored token/);
  // the token panel states the real storage boundary and what an Actions read-and-write token allows
  assert.match(html, /every page served from https:\/\/netic123\.github\.io \(all of this account’s Pages sites\) and any browser extension with page access can read/);
  assert.match(html, /cancelling, re-running and approving workflow runs and deleting runs, logs, artifacts and caches/);
  assert.doesNotMatch(html, /nothing more/);
  assert.doesNotMatch(html, /stored only in this browser/);
  // the button promises only what happens: wait for the served build.json to come from the followed run, then reload
  assert.match(html, /wait until the CDN serves its snapshot, then reload this page/);
  assert.doesNotMatch(html, /reload this page when it is deployed/);
  assert.match(html, /if\(j&&\(String\(j\.runId\)===String\(run\.id\)\|\|\(Number\.isFinite\(Date\.parse\(j\.generatedAt\)\)&&Date\.parse\(j\.generatedAt\)>sinceMs\)\)\)\{ say\('the new snapshot is served — reloading this page…'\); location\.reload\(\); return; \}/);
  assert.match(html, /while\(Date\.now\(\)-waitStart<10\*60\*1000\)\{/);
  assert.match(html, /await sleep\(20000\);/);
  assert.doesNotMatch(html, /await load\('manual'\)/, 'the live update never mixes new JSON into old page code');
  // error paths are told apart by status, a poll failure keeps the last good run object, and the poll gives up at 15 min
  assert.match(html, /function explainGithub\(r\)/);
  for (const status of ['401', '403', '404', '429']) assert.match(html, new RegExp(`r\\.status===${status}`));
  assert.match(html, /r\.status>=500/);
  assert.match(html, /x-ratelimit-remaining/);
  assert.match(html, /x-ratelimit-reset/);
  assert.match(html, /if\(!activeList\.ok\) throw new Error\(explainGithub\(activeList\)\);/);
  assert.match(html, /if\(r&&r\.ok\)\{ run=await r\.json\(\); pollFailures=0; continue; \}/);
  assert.match(html, /if\(\+\+pollFailures>=4\) throw new Error\(lastProblem\+' while following '\+run\.html_url\);/);
  assert.match(html, /gave up after 15 minutes/);
  assert.match(html, /could not reach api\.github\.com/);
  // the 10-minute timer and the Reload button stay out of the way while a live update runs
  assert.match(html, /setInterval\(\(\)=>\{ if\(!LIVE_RUNNING\) load\('auto'\); \}, 10\*60\*1000\);/);
  assert.match(html, /\$\('#btnRefresh'\)\.disabled=LIVE_RUNNING;/);
  assert.match(html, /async function load\(mode\)\{[^\n]*\n\s*if\(LIVE_RUNNING\) return;/);
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.match(workflow, /skip_tests:\n\s+#[^\n]*\n(\s+#[^\n]*\n)*\s+description:/);
  assert.match(workflow, /INVESTMENTS_BUILD_TRIGGER: \$\{\{ github\.event_name \}\}/);
});

test('the page shows its provenance and reads the build history from GitHub only when asked', () => {
  assert.match(html, /gh attestation verify/);
  assert.match(html, /with a GitHub account \(after <span class="mono">gh auth login<\/span>\)/);
  assert.match(html, /href="https:\/\/github\.com\/netic123\/investments\/attestations"/);
  assert.match(html, /api\.github\.com\/repos\/netic123\/investments\/actions\/workflows\/pages\.yml\/runs\?per_page=20/);
  assert.match(html, /nothing published/);
  // Build history is read only on the visitor's click, at most every 5 minutes, and is not hidden behind a tab
  assert.match(html, /id="btnBuilds">Show build history — contacts api\.github\.com</);
  assert.equal((html.match(/renderBuildHistory\(\);/g) || []).length, 1, 'renderBuildHistory is called from the button only');
  assert.match(html, /if\(e\.target\.closest\('#btnBuilds'\)\) renderBuildHistory\(\);/);
  assert.match(html, /if\(Date\.now\(\)-BUILDS_LOADED_AT<5\*60\*1000\)/);
  assert.doesNotMatch(html, /id="buildsSection" hidden/);
  // the queue time and GitHub's run start are separate columns, the list is described as the last 20 runs, and the
  // count of runs started in the last 24 h feeds the age warning
  assert.match(html, /<th>Queued<\/th><th>Trigger<\/th><th>Result<\/th><th class="num">Duration<\/th><th>Run<\/th>/);
  assert.match(html, /The last \$\{runs\.length\} runs of the build workflow/);
  assert.doesNotMatch(html, /Every attempt to rebuild/);
  assert.match(html, /BUILD_RUNS_24H=\{n:started24h,atLeast:started24h===runs\.length\}/);
  assert.match(html, /started in the last 24 h/);
  assert.match(html, /A newer build finished at \$\{whenFull\(newer\.updated_at\)\}; the CDN had not served it/);
  // the site-level disclosures sit outside the tab panels, so every tab carries them
  const fgPanels = html.indexOf('id="fgPanels"');
  for (const id of ['id="buildsSection"', 'id="siteFooter"', 'id="about"', 'id="aboutBuild"', 'Not investment advice.']) assert.ok(html.indexOf(id) > fgPanels, `${id} must follow the tab panels`);
  assert.ok(html.indexOf('</div><!-- /panel-pabrai -->') < html.indexOf('id="buildsSection"'));
  // the About line is plain text through textContent (no esc() into textContent, no raw cron as a time) and shows
  // the build record truthfully; testsVerifiedBy is a link
  assert.match(html, /\$\('#aboutBuild'\)\.textContent=parts\.join\(' '\);/);
  assert.doesNotMatch(html, /esc\(BUILD_META\.(ref|reason|schedule)\)|esc\(B\.(ref|reason|schedule)\)/);
  assert.match(html, /describeSchedules\(B\.schedules\)/);
  assert.match(html, /GitHub starts such runs late, so the slot is not the build time/);
  for (const field of ['scheduleNote', 'secContact', 'historyDurability', 'yahooRequests', 'testsVerifiedBy', 'testsSkipped']) assert.match(html, new RegExp('B\\.' + field), field);
  assert.match(html, /<a href="\$\{esc\(B\.testsVerifiedBy\)\}" target="_blank" rel="noopener">/);
  assert.match(html, /String\(B\.reason\)\.slice\(0,80\)/);
  // the contact disclosure names every connect-src host of the CSP and says when each is contacted
  const disclosure = /<p id="contacts"><b>Not investment advice\.<\/b>([\s\S]*?)<\/p>/.exec(html)[1];
  const connect = build.STATIC_CSP_DIRECTIVES.find(d => d.startsWith('connect-src ')).split(/\s+/).slice(1).filter(h => h !== "'self'");
  assert.deepEqual(connect, ['https://data.sec.gov', 'https://api.github.com']);
  for (const host of connect) assert.ok(disclosure.includes(host.replace('https://', '')), `${host} must be named in the disclosure`);
  assert.match(disclosure, /this site’s own JSON files/);
  assert.match(disclosure, /Google Fonts/);
  // the SEC check runs on every load while the fallback is published, whichever tab is open
  assert.match(disclosure, /data\.sec\.gov \(SEC’s EDGAR submissions index\), on a page load and, at most once an hour, on a re-check that loads a newer snapshot, while the published snapshot carries the manually verified 13F fallback — whichever tab you have open/);
  // the owner's token and interval are the exception to "nothing you type is sent"
  assert.match(disclosure, /Nothing you type on this page is sent anywhere, except the owner’s token and rebuild interval, which the live update sends to api\.github\.com/);
  assert.match(disclosure, /automatic rebuilds, by itself on load and on the 10-minute re-check/);
  // the Dates note matches renderDates (an entry stays through day +3)
  assert.match(html, /a configured entry stays listed until three days after its date; a filed shareholder report stays for 45 days after its filing date, and a due date appears up to 120 days ahead/);
  assert.match(html, /if\(days<-3\) return null;/);
  assert.match(html, /daysFrom\(rep\.filed\)<-45/);
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.match(workflow, /attestations: write/);
  assert.match(workflow, /uses: actions\/attest-build-provenance@[0-9a-f]{40} # v4/);
  assert.match(workflow, /subject-path: \|\n\s+_site\/index\.html\n\s+_site\/api\/\*\.json/);
});

test('the external dispatch script sends the same request as the page and refuses to run without a token', () => {
  const script = fs.readFileSync(path.join(ROOT, 'scripts', 'dispatch-build.js'), 'utf8');
  assert.match(script, /\/actions\/workflows\/pages\.yml\/dispatches/);
  assert.match(script, /inputs: \{ skip_tests: 'true', reason \}/);
  assert.match(script, /process\.env\.GITHUB_DISPATCH_TOKEN/);
  assert.doesNotMatch(script, /github_pat_[A-Za-z0-9_]{10,}/, 'no real token in the repository');
  // the comment states what an Actions read-and-write token really allows
  assert.match(script, /cancel, re-run and approve this repository's workflow runs, delete its runs,\n\/\/ logs, artifacts and caches, and enable or disable its workflows/);
  assert.doesNotMatch(script, /nothing more/);
  const { spawnSync } = require('node:child_process');
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'dispatch-build.js')], { env: { ...process.env, GITHUB_DISPATCH_TOKEN: '' }, encoding: 'utf8' });
  assert.equal(run.status, 2);
  assert.match(run.stderr, /GITHUB_DISPATCH_TOKEN is not set/);
});

test('the research BUY/SELL card is hidden from visitors and the tab says why', () => {
  assert.match(html, /const SHOW_RESEARCH_SIGNAL = !STATIC_BUILD \|\| OWNER_MODE;/);
  assert.match(html, /<section class="fg-data"\$\{SHOW_RESEARCH_SIGNAL\?'':' hidden'\}>/);
  assert.match(html, /no buy\/sell signal is shown here/);
  assert.ok(html.indexOf('const OWNER_MODE=') < html.indexOf('const SHOW_RESEARCH_SIGNAL'), 'OWNER_MODE must be defined before the panels are built');
});

// The Fear & Greed tabs: every sentence is built from what marketfg.js publishes and attributes the research to the score
// version it covered. normMarket is run in vm on a full new-shape market and on an older snapshot without the new fields.
function fgContext(overrides = {}) {
  const helpers = html.slice(html.indexOf('const MARKET_BANDS='), html.indexOf('// Shared pointer/keyboard explorer'));
  const start = html.indexOf('// ---- fear-greed normaliser'), end = html.indexOf('// ---- end fear-greed normaliser');
  assert.ok(start > 0 && end > start, 'the Fear & Greed normaliser must be delimited in index.html');
  const context = {
    fmt: (n, d = 0) => (n == null || !isFinite(n) ? '—' : d ? n.toFixed(d) : String(Math.round(n))), esc: s => String(s ?? ''), fmtDate: iso => iso || '—',
    humanDates: s => String(s ?? '').replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, 'D$3'), cls: () => '', whenFull: iso => iso, SHOW_RESEARCH_SIGNAL: false, BUILD_META: null,
    Date, Math, Number, Array, Object, String, isFinite, ...overrides,
  };
  // const bindings of a vm script are not context properties, so the two functions the test needs are returned explicitly
  return require('node:vm').runInNewContext(`${helpers}\n${html.slice(start, end)}\n;({normMarket,fgBand})`, context);
}
const fgComponent = (key, name, symbols, extra = {}) => ({ key, name, desc: 'd', unit: '%', dir: 1, score: 50.5, label: 'Neutral', raw: 1, asOf: '2026-09-03', symbols, names: symbols.map(s => 'Yahoo ' + s), note: null, stale: false, lag: false, lagDetail: null, ...extra });
const fgModel = () => ({
  id: 'investments-unified-fear-greed', version: 3, percentileMinPoints: 126, strengthWindow: 252, minComponents: 6, fillDays: 7, providerHistoryCompleteness: 'UNVERIFIED',
  labels: [[0, 24.9, 'Extreme Fear'], [25, 44.9, 'Fear'], [45, 55.9, 'Neutral'], [56, 74.9, 'Greed'], [75, 100, 'Extreme Greed']],
  bands: [{ min: 0, max: 24.9, label: 'Extreme Fear' }, { min: 25, max: 44.9, label: 'Fear' }, { min: 45, max: 55.9, label: 'Neutral' }, { min: 56, max: 74.9, label: 'Greed' }, { min: 75, max: 100, label: 'Extreme Greed' }],
  warmup: { strengthWindow: 252, percentileMinPoints: 126, description: 'strength is computed from the 126th benchmark observation onward (the published rule)' },
});
const fgMarket = key => ({
  key, name: key === 'ustech' ? 'US Tech' : key === 'europe' ? 'Europe' : 'USA', indexSymbol: '^STOXX', indexName: 'STOXX Europe 600', asOf: '2026-09-03', score: 24.95, label: 'Fear', n: 6, total: 6, warnings: [],
  previous: { close: 68, closeDate: '2026-09-02' }, history: [{ date: '2026-09-02', score: 68, label: 'Greed', n: 6 }, { date: '2026-09-03', score: 24.95, label: 'Fear', n: 6 }],
  components: {
    momentum: fgComponent('momentum', 'Momentum', ['^STOXX'], { seriesNames: [{ symbol: '^STOXX', name: 'STOXX Europe 600', type: 'price index (dividends excluded)', providerName: 'STXE 600 I' }] }),
    strength: fgComponent('strength', 'Strength', ['^STOXX']), volatility: fgComponent('volatility', 'Volatility', ['^STOXX'], { note: 'realised 20-observation volatility vs its 50-observation average' }),
    safeHaven: fgComponent('safeHaven', 'Safe-haven demand', ['^STOXX', 'SXRQ.DE'], { asOf: '2026-09-02', lag: true, lagDetail: 'SXRQ.DE: Yahoo listed 2026-09-03 with no close (feed gap)' }),
    credit: fgComponent('credit', 'Credit appetite', ['IHYG.L', 'IEAC.L'], { asOf: '2026-08-28', lag: true, lagDetail: 'IHYG.L: no 2026-08-31 bar on any of the 4 London-listed series (exchange holiday or feed gap; the model cannot tell which)' }),
    breadth: fgComponent('breadth', 'Breadth', ['EXSE.DE', 'EXSA.DE']),
  },
  asOfMeaning: 'last benchmark bar dated before the retrieval date at the exchange (a same-day close is excluded until the next day); carried components are older',
  carriedComponents: [
    { component: 'safeHaven', symbol: 'SXRQ.DE', asOf: '2026-09-02', benchmarkDate: '2026-09-03', detail: 'SXRQ.DE: Yahoo listed 2026-09-03 with no close (feed gap)' },
    { component: 'credit', symbol: 'IHYG.L', asOf: '2026-08-28', benchmarkDate: '2026-09-03', detail: 'IHYG.L: no 2026-08-31 bar on any of the 4 London-listed series (exchange holiday or feed gap; the model cannot tell which)' },
  ],
  oldestComponentAsOf: '2026-08-28', firstScoredDate: '2011-08-30',
  disclosure: { benchmarkType: 'price index (STOXX Europe 600, dividends excluded)', verified: 'all six series were among the 23 series checked on 24 Aug 2026; no later check', note: 'every ex-dividend drop lowers the price index' },
});

test('the Fear & Greed tabs state carried indicators, series names, verification and research scope from the published fields', () => {
  const strip = h => String(h).replace(/<[^>]+>/g, '');
  const ctx = fgContext({ BUILD_META: { yahooRequests: { requests: 66, symbols: 33, fullHistoryRequests: 33, topUpRequests: 33, retries: 0 } } });
  const N = ctx.normMarket(fgMarket('europe'), fgModel(), '2026-09-04T09:31:19Z');
  // as-of stamps name the benchmark bar and the carried indicators, with the oldest component date
  // two carried components with different dates are listed with both dates, not dated to the older one
  const stamp = 'as of 2026-09-03 — composite of the benchmark’s last bar dated before the build day; 2 of 6 indicators carried from 2026-08-28 / 2026-09-02';
  assert.equal(N.kpiSub, 'Fear · ' + stamp);
  assert.equal(N.compnote, '6 of 6 indicators scored · ' + stamp);
  assert.ok(strip(N.note).includes(stamp));
  assert.equal(N.oldestComponentAsOf, '2026-08-28');
  // the carried callout quotes lagDetail verbatim (dates humanised) and promises no later bar
  const carried = strip(N.callouts.find(c => /carried from an earlier completed bar/.test(c)));
  assert.match(carried, /^2 of 6 indicators are carried/);
  assert.match(carried, /Safe-haven demand as of 2 Sept — SXRQ\.DE: Yahoo listed D03 with no close \(feed gap\)/);
  assert.match(carried, /Credit appetite as of 28 Aug — IHYG\.L: no D31 bar on any of the 4 London-listed series \(exchange holiday or feed gap; the model cannot tell which\)/);
  assert.match(carried, /an exchange holiday leaves no bar to publish, so nothing here promises that a missing bar will appear/);
  assert.doesNotMatch(carried, /when Yahoo publishes/);
  // series list: curated names and types with the symbol, Yahoo's own name only in a title
  assert.match(N.explain, /STOXX Europe 600<\/span> <span class="mono muted">\(\^STOXX\)<\/span> <span class="muted">— price index \(dividends excluded\)<\/span>/);
  assert.match(N.explain, /title="Yahoo’s own name for this series: STXE 600 I"/);
  assert.match(N.explain, /Yahoo IHYG\.L <span class="mono muted">\(IHYG\.L\)/, 'a component without seriesNames falls back to names/symbols');
  // the disclosure is quoted, the Europe price-index caveat is on the tab, the first scored date is the market's own
  const explain = strip(N.explain);
  assert.match(explain, /Benchmark: price index \(STOXX Europe 600, dividends excluded\)\. What was checked about the raw series: all six series were among the 23 series checked on 24 Aug 2026; no later check\. Note: every ex-dividend drop lowers the price index\./);
  assert.match(explain, /Its benchmark \^STOXX is a price index \(dividends excluded\), unlike the Sweden tab’s gross total return \^OMXSBGI/);
  assert.match(explain, /first scored date is 2011-08-30/);
  assert.match(explain, /an open data source for Europe, hence the own computation/);
  // plain-language explanation first, the exact rules and the warm-up quoted from model.warmup, no learner "below"
  assert.match(explain, /Each of the six indicators listed below is turned into a rank from 0 to 100 against all of its own past values/);
  assert.match(explain, /\(a rank starts only once 126 past values exist\)/);
  assert.match(explain, /on a shorter window \(from 126 observations\) until 252 exist/);
  assert.match(explain, /Warm-up: strength is computed from the 126th benchmark observation onward \(the published rule\)\./);
  assert.match(explain, /A separate research learner is computed and published in api\/marketfg\.json only; it is not shown on this page\./);
  assert.doesNotMatch(explain, /learner below|rule families|residual candidate|prospective test/);
  // the footer attributes the searches and the lockbox to v1/v2 and denies v3 any test; the request count comes from build.json
  const footer = strip(N.footer);
  assert.match(footer, /back-tests of the earlier v1 and v2 scores \(trailing-window percentiles, since replaced by this v3 score\) found no reliable buy\/sell timing rule/);
  assert.match(footer, /one Europe candidate found on the v2 score failed a replication test on three other markets and is still being tracked in real time, on v2/);
  assert.match(footer, /This v3 score \(expanding percentiles\) has had no rule search and no prospective test, so no buy\/sell signal is shown here/);
  assert.match(footer, /sent 66 Yahoo chart requests for 33 series \(33 full-history, 33 top-up, 0 retries\)/);
  assert.doesNotMatch(footer, /seven rule families|under prospective test|in this score/);
  // bands come from model.bands; a 24.95 score is Fear on the one-decimal scale (the page shows one decimal, so 25.0 · Fear)
  assert.deepEqual(N.bands.map(b => b[2]), ['Extreme Fear', 'Fear', 'Neutral', 'Greed', 'Extreme Greed']);
  assert.equal(N.bands[0][1], 24.9);
  assert.equal(N.bands[ctx.fgBand(24.95, N.bands)][2], 'Fear');
  assert.equal(N.stats[0][0], 'Latest');
  // US Tech: the footer does not inherit the five-market studies; the disclosure states the unverified series
  const T = ctx.normMarket({ ...fgMarket('ustech'), carriedComponents: [], oldestComponentAsOf: '2026-09-03', disclosure: { benchmarkType: 'ETF total-return proxy (XLK)', verified: 'XLK, ^VXN and RSPT were added after the 24 Aug 2026 check and have not had it or any other second-source check', note: 'US Tech was added after the research programme: no rule search, replication, diagnostic battery or lockbox in research/ covers it' } }, fgModel(), null);
  assert.match(strip(T.footer), /US Tech was added on 27 Aug 2026, after the owner’s back-tests: no rule search, replication, diagnostic battery or lockbox covers it\./);
  assert.doesNotMatch(strip(T.footer), /seven kinds of rule/);
  assert.match(strip(T.explain), /XLK, \^VXN and RSPT were added after the 24 Aug 2026 check and have not had it or any other second-source check/);
  assert.equal(T.kpiSub, 'Fear · as of 2026-09-03 — all 6 indicators as of that date');
  assert.doesNotMatch(strip(fgContext().normMarket(fgMarket('ustech'), fgModel(), null).footer), /Yahoo chart requests/, 'no build record (local mode), no request count');
  // USA: CNN publishes a number, not an open source; the 23 Aug 2026 comparison was manual, on v1, and validates nothing
  const U = ctx.normMarket({ ...fgMarket('usa'), carriedComponents: [] }, fgModel(), null);
  assert.match(strip(U.explain), /for USA — CNN publishes a US index number but no open feed and no component data — hence the own computation/);
  assert.match(strip(U.explain), /compared, once and by hand \(there is no feed\), the earlier rolling-window model v1 with CNN’s published number; that is historical context only and says nothing about this v3 score/);
  // crypto: the warm-up is the published arithmetic, never "252 + 126"
  const C = ctx.normMarket({ ...fgMarket('crypto'), key: 'crypto', name: 'Crypto', carriedComponents: [], firstScoredDate: '2020-12-16' }, fgModel(), null);
  assert.match(strip(C.explain), /the warm-up has passed — about 251 observations after the latest-starting source series \(the rule is quoted under “Exact scoring rules” above\); on crypto’s seven-day calendar 251 observations is roughly 8 months\. For this market the first scored date is 2020-12-16\./);
  assert.doesNotMatch(strip(C.explain), /252-observation high for strength and 126 scored values/);
  // owner mode: the learner is described as shown above, and the footer says what the card is
  const O = fgContext({ SHOW_RESEARCH_SIGNAL: true }).normMarket(fgMarket('europe'), fgModel(), null);
  assert.match(strip(O.explain), /The BUY\/SELL research learner shown above is a separate model/);
  assert.match(strip(O.footer), /The BUY\/SELL research card above is an unvalidated research model shown in the local app and to the owner only\./);
  // an older snapshot without the new fields: carried indicators from components[*], no verification sentence, no warm-up length
  const old = fgMarket('europe');
  for (const k of ['asOfMeaning', 'carriedComponents', 'oldestComponentAsOf', 'firstScoredDate', 'disclosure']) delete old[k];
  for (const c of Object.values(old.components)) delete c.seriesNames;
  const oldModel = fgModel(); delete oldModel.bands; delete oldModel.warmup;
  const L = ctx.normMarket(old, oldModel, null);
  assert.equal(L.kpiSub, 'Fear · as of 2026-09-03 — composite of the benchmark’s last bar dated before the build day; 2 of 6 indicators carried from 2026-08-28 / 2026-09-02');
  assert.match(strip(L.callouts[0]), /2 of 6 indicators are carried .* IHYG\.L: no D31 bar/);
  assert.doesNotMatch(strip(L.explain), /What was checked|Benchmark:|first scored date|Warm-up:/);
  assert.equal(L.bands[1][1], 44.9, 'model.labels still supplies the bands');
  const LC = ctx.normMarket({ ...old, key: 'crypto', name: 'Crypto' }, oldModel, null);
  assert.match(strip(LC.explain), /the warm-up has passed \(this snapshot does not carry the rule, so its length is not stated here\)/);
  // source: one decimal wherever a score sits next to a label, and no stale wording anywhere on the page
  assert.match(html, /<text class="n" x="100" y="98" text-anchor="middle">\$\{fmt\(v,1\)\}<\/text>/);
  assert.match(html, /\$\{fmt\(r\.value,1\)\}<\/div><div class="s">\$\{esc\(r\.label\)\}/);
  assert.match(html, /\$\{c\.score==null\?'—':fmt\(c\.score,1\)\}/);
  assert.match(html, /\$\{fmt\(N\.value,1\)\}<\/span>`; \$\('#kFgSub'\)/);
  assert.match(html, /\$\{fmt\(p\.value,1\)\}<\/span>` : '—';/);
  assert.match(html, /value=fmt\(row\.value,1\)\+' · '\+label/);
  assert.match(html, /Low \$\{fmt\(mn,1\)\} · high \$\{fmt\(mx,1\)\}/);
  assert.match(html, /const bandsOf=model=> Array\.isArray\(model&&model\.bands\)/);
  assert.match(html, /Fear &amp; Greed · latest close/);
  assert.doesNotMatch(html, /Fear &amp; Greed now/);
  assert.doesNotMatch(html, /one shared six-component repository model/);
  assert.match(html, /the score is that of the benchmark’s last daily bar dated before the build day at its exchange/);
  for (const stale of ['seven rule families', 'under prospective test', 'learner below', 'a later build picks the bars up', 'Yahoo has no bar', '252-observation high for strength and 126 scored', 'apart from CNN', 'about 2–4 minutes', 'about two minutes', 'found no reliable timing edge in this score']) {
    assert.ok(!html.includes(stale), `index.html still says "${stale}"`);
  }
  assert.match(html, /about a minute of build and deploy when the test suite is skipped, four to five minutes with it/);
  for (const field of ['M.carriedComponents', 'M.oldestComponentAsOf', 'M.disclosure', 'M.firstScoredDate', 'c.seriesNames', 'model.warmup', 'BUILD_META.yahooRequests']) assert.ok(html.includes(field), `index.html must read ${field}`);
});

test('config names every current holding and cash currency', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
  assert.ok(config.names['ODL NO'] && config.names['ODL NO'].flag === '🇳🇴');
  assert.ok(config.cashTickers.includes('NOK'));
});

const workflowText = () => fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');

test('the Pages workflow asks for half-hourly weekday slots and a daily tested slot, and passes only a validated SEC contact', () => {
  const workflow = workflowText();
  assert.match(workflow, /- cron: '20 9 \* \* \*'/);
  assert.match(workflow, /- cron: '20,50 5-8,10-22 \* \* 1-5'/);
  assert.match(workflow, /- cron: '50 9 \* \* 1-5'/);
  assert.deepEqual(build.workflowSchedules(workflow), ['20 9 * * *', '20,50 5-8,10-22 * * 1-5', '50 9 * * 1-5']);
  assert.equal(build.testedScheduleSlot(workflow), '20 9 * * *');
  assert.match(workflow, /INVESTMENTS_BUILD_SCHEDULE: \$\{\{ github\.event\.schedule \}\}/);
  assert.match(workflow, /SEC_USER_AGENT: \$\{\{ vars\.SEC_USER_AGENT \}\}/);
  // the comments no longer promise what GitHub does not deliver
  assert.doesNotMatch(workflow, /even a late start lands within the half hour/);
  assert.doesNotMatch(workflow, /usually falls back to/);
  assert.doesNotMatch(workflow, /not reliably by www\.sec\.gov/);
  assert.match(workflow, /skips most slots/);
  // the staleness window published by build.json covers every weekday slot
  const [hoursStart, hoursEnd] = ['5', '22'];
  assert.match(workflow, new RegExp(`- cron: '20,50 ${hoursStart}-8,10-${hoursEnd} \\* \\* 1-5'`));
  assert.equal(build.SCHEDULE_WINDOW_UTC.from, `0${hoursStart}:20`);
  assert.ok(build.SCHEDULE_WINDOW_UTC.to > `${hoursEnd}:50`, 'the window ends after the last weekday slot');
});

test('build.json describes the schedule from the workflow itself, in words that match the cron lines', () => {
  assert.equal(build.describeCron('20 9 * * *'), '09:20 UTC every day');
  assert.equal(build.describeCron('50 9 * * 1-5'), '09:50 UTC Mon-Fri');
  assert.equal(build.describeCron('20,50 5-8,10-22 * * 1-5'), ':20 and :50 past 05-08 and 10-22 UTC Mon-Fri');
  assert.equal(build.describeCron('0 0 1 * *'), "cron '0 0 1 * *' (UTC)", 'an unfamiliar shape is printed verbatim, never guessed');
  const sentence = build.refreshTriggerSentence(build.workflowSchedules(workflowText()), '20 9 * * *');
  assert.match(sentence, /09:20 UTC every day \(with the test suite\)/);
  assert.match(sentence, /:20 and :50 past 05-08 and 10-22 UTC Mon-Fri/);
  assert.match(sentence, /skips most slots/);
  assert.doesNotMatch(sentence, /every 30 minutes/, 'the sentence must not promise a cadence GitHub does not keep');
  assert.match(build.SCHEDULE_NOTE, /3 Sep 2026 it started 7 of the 36 weekday slots/);
});

test('the test suite is skipped only when a successful tested run of the same commit exists, and build.json records the real outcome', () => {
  const workflow = workflowText();
  assert.match(workflow, /permissions:\n\s+contents: read\n(\s+#[^\n]*\n)*\s+actions: read\n/);
  assert.match(workflow, /id: gate\n(\s+#[^\n]*\n)*\s+env:\n\s+GITHUB_TOKEN: \$\{\{ github\.token \}\}\n\s+EVENT_SCHEDULE: \$\{\{ github\.event\.schedule \}\}\n\s+TESTED_SCHEDULE: '20 9 \* \* \*'\n\s+SKIP_TESTS: \$\{\{ inputs\.skip_tests \}\}\n\s+TEST_STEP_NAME: Test repository-owned market models\n\s+run: node scripts\/tests-gate\.js/);
  assert.match(workflow, /- name: Test repository-owned market models\n\s+id: tests\n\s+if: steps\.gate\.outputs\.run_tests == 'true'\n/);
  assert.match(workflow, /INVESTMENTS_BUILD_TESTS_SKIPPED: \$\{\{ steps\.tests\.outcome == 'skipped' \}\}/);
  assert.match(workflow, /INVESTMENTS_BUILD_TESTS_VERIFIED_BY: \$\{\{ steps\.gate\.outputs\.tests_verified_by \}\}/);
  assert.ok(workflow.indexOf('id: gate') < workflow.indexOf('id: tests') && workflow.indexOf('id: tests') < workflow.indexOf('run: node scripts/build-pages.js'));
  assert.match(workflow, /timeout-minutes: 15\n\s+permissions:\n\s+contents: read/);
  assert.match(workflow, /3 attempts with a 120 s timeout per endpoint/);
});

test('the gate runs the suite unless GitHub proves this exact commit passed it', async () => {
  const { decideTests, testsRequired } = require('../scripts/tests-gate');
  const tested = '20 9 * * *';
  assert.ok(testsRequired({ event: 'push', testedSchedule: tested }));
  assert.ok(testsRequired({ event: 'schedule', schedule: tested, testedSchedule: tested }));
  assert.ok(testsRequired({ event: 'workflow_dispatch', skipTests: 'false', testedSchedule: tested }));
  assert.ok(testsRequired({ event: 'workflow_dispatch', skipTests: '', testedSchedule: tested }));
  assert.equal(testsRequired({ event: 'workflow_dispatch', skipTests: 'true', testedSchedule: tested }), null);
  assert.equal(testsRequired({ event: 'schedule', schedule: '20,50 5-8,10-22 * * 1-5', testedSchedule: tested }), null);
  const sha = 'a'.repeat(40);
  const stepName = 'Test repository-owned market models';
  const api = (runs, jobsByRun) => async url => {
    const runsMatch = /\/actions\/workflows\/pages\.yml\/runs\?head_sha=([0-9a-f]{40})&status=success/.exec(url);
    if (runsMatch) return { ok: true, json: async () => ({ workflow_runs: runs.filter(run => run.head_sha === runsMatch[1]) }) };
    const jobsMatch = /\/actions\/runs\/(\d+)\/jobs/.exec(url);
    if (jobsMatch) return { ok: true, json: async () => ({ jobs: jobsByRun[jobsMatch[1]] || [] }) };
    return { ok: false, status: 404 };
  };
  const base = { event: 'schedule', schedule: '20,50 5-8,10-22 * * 1-5', testedSchedule: tested, repo: 'netic123/investments', sha, token: 't', stepName };
  const proved = { id: 1, head_sha: sha, conclusion: 'success', event: 'push', html_url: 'https://github.com/netic123/investments/actions/runs/1' };
  const skipped = { id: 2, head_sha: sha, conclusion: 'success', event: 'schedule', html_url: 'https://github.com/netic123/investments/actions/runs/2' };
  const jobs = {
    1: [{ conclusion: 'success', steps: [{ name: stepName, conclusion: 'success' }] }],
    2: [{ conclusion: 'success', steps: [{ name: stepName, conclusion: 'skipped' }] }],
  };
  let decision = await decideTests({ ...base, fetchImpl: api([skipped, proved], jobs) });
  assert.deepEqual([decision.runTests, decision.verifiedBy], [false, proved.html_url], 'a successful run whose test step passed allows the skip');
  decision = await decideTests({ ...base, fetchImpl: api([skipped], jobs) });
  assert.equal(decision.runTests, true, 'a successful run that itself skipped the suite proves nothing');
  decision = await decideTests({ ...base, fetchImpl: api([], jobs) });
  assert.equal(decision.runTests, true, 'no run for the commit (a failed push run, or [skip ci]) means the suite runs');
  decision = await decideTests({ ...base, fetchImpl: async () => { throw new Error('offline'); } });
  assert.deepEqual([decision.runTests, decision.verifiedBy], [true, null], 'an API failure runs the suite');
  decision = await decideTests({ ...base, token: '', fetchImpl: api([proved], jobs) });
  assert.equal(decision.runTests, true, 'no token means the suite runs');
  decision = await decideTests({ ...base, event: 'push', fetchImpl: api([proved], jobs) });
  assert.equal(decision.runTests, true, 'a push runs the suite even when an older run of the commit passed');
  const script = fs.readFileSync(path.join(ROOT, 'scripts', 'tests-gate.js'), 'utf8');
  assert.doesNotMatch(script, /console\.(log|error)\([^)]*token/i);
});

test('build.json digests are the SHA-256 of the exact bytes written, for index.html and every api file except build.json', () => {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'investments-digests-'));
  try {
    fs.mkdirSync(path.join(dir, 'api'));
    fs.writeFileSync(path.join(dir, 'index.html'), '<p>x</p>');
    for (const name of build.ENDPOINTS) fs.writeFileSync(path.join(dir, 'api', `${name}.json`), `{"name":"${name}"}\n`);
    fs.writeFileSync(path.join(dir, 'api', 'build.json'), '{}\n');
    const files = build.artifactDigests(dir, build.DIGESTED_FILES);
    assert.deepEqual(Object.keys(files), ['index.html', 'api/config.json', 'api/holdings.json', 'api/dalal.json', 'api/nport.json', 'api/nav.json', 'api/perf.json', 'api/quotes.json', 'api/marketfg.json']);
    for (const [relative, digest] of Object.entries(files)) {
      assert.equal(digest, crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, relative))).digest('hex'));
    }
    assert.ok(!('api/build.json' in files) && !('.nojekyll' in files));
    const source = fs.readFileSync(path.join(ROOT, 'scripts', 'build-pages.js'), 'utf8');
    assert.ok(source.indexOf('build.files = artifactDigests(OUT, DIGESTED_FILES)') > source.indexOf("writeJson(path.join(API_OUT, `${name}.json`), data[name])"), 'digests are taken after the files are written');
    assert.ok(source.indexOf('build.files = artifactDigests(OUT, DIGESTED_FILES)') < source.indexOf("writeJson(path.join(API_OUT, 'build.json'), build)"), 'and before build.json is written');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the record script keeps a durable copy of the published receipts and writes only when something is new', async () => {
  const os = require('node:os');
  const { recordHoldingsHistory } = require('../scripts/record-holdings-history');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'investments-record-'));
  try {
    const receipt = (date, capturedAt, sha) => ({ date, rows: { HCC: { shares: 1 } }, source: { sha256: sha.repeat(64), fileDate: date, capturedAt } });
    const legacy = { date: '2026-08-20', rows: { HCC: { shares: 1 } } };
    const target = path.join(dir, 'snapshots.json');
    fs.writeFileSync(target, JSON.stringify([legacy, receipt('2026-08-25', '2026-08-25T23:28:20Z', 'a')], null, 1));
    const source = path.join(dir, 'holdings.json');
    const published = {
      latest: receipt('2026-09-04', '2026-09-04T00:12:00Z', 'd'),
      snapshots: [
        { date: '2026-08-24', rows: { HCC: { shares: 1 } } }, // no provenance: never imported from the CDN
        receipt('2026-08-25', '2026-08-25T14:00:00Z', 'b'), // captured earlier than the committed one: committed wins
        receipt('2026-09-03', '2026-09-03T00:12:00Z', 'c'),
        receipt('2026-09-04', '2026-09-04T00:12:00Z', 'd'),
      ],
    };
    fs.writeFileSync(source, JSON.stringify(published));
    let result = await recordHoldingsHistory({ source, target });
    assert.deepEqual([result.written, result.added, result.replaced, result.total], [true, ['2026-09-03', '2026-09-04'], [], 4]);
    const saved = JSON.parse(fs.readFileSync(target, 'utf8'));
    assert.deepEqual(saved.map(s => s.date), ['2026-08-20', '2026-08-25', '2026-09-03', '2026-09-04'], 'legacy rows stay, unprovenanced published rows are not imported');
    assert.equal(saved[1].source.sha256, 'a'.repeat(64), 'the later capture of a date wins');
    assert.equal(fs.readFileSync(target, 'utf8'), JSON.stringify(saved, null, 1), 'same one-space form as server.js writes');
    const stat = fs.statSync(target).mtimeMs;
    result = await recordHoldingsHistory({ source, target });
    assert.deepEqual([result.written, result.added, result.replaced], [false, [], []], 'nothing new: nothing written');
    assert.equal(fs.statSync(target).mtimeMs, stat);
    // a later re-capture of a date replaces the row
    published.snapshots.push(receipt('2026-09-04', '2026-09-04T14:00:00Z', 'e'));
    fs.writeFileSync(source, JSON.stringify(published));
    result = await recordHoldingsHistory({ source, target });
    assert.deepEqual([result.written, result.replaced], [true, ['2026-09-04']]);
    // only the approved published URL may be fetched
    await assert.rejects(recordHoldingsHistory({ source: 'https://example.com/holdings.json', target, fetchImpl: async () => { throw new Error('must not be called'); } }), /approved GitHub Pages endpoint/);
    const fetched = await recordHoldingsHistory({ source: build.PUBLISHED_HOLDINGS_URL, target, fetchImpl: async (url, init) => {
      assert.equal(init.headers['Cache-Control'], 'no-cache');
      return { ok: true, json: async () => published };
    } });
    assert.equal(fetched.written, false);
    // the CLI exits 0 whether or not it wrote
    const { spawnSync } = require('node:child_process');
    const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'record-holdings-history.js'), source, '--target', target], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.match(run.stdout, /^unchanged .*: 4 receipts/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the record job is the only writer, runs after the tested builds, waits for the CDN and commits with [skip ci]', () => {
  const workflow = workflowText();
  const jobs = workflow.split(/\n  (?=[a-z]+:\n)/);
  const record = jobs.find(job => job.startsWith('record:'));
  assert.ok(record, 'record job exists');
  assert.match(record, /needs: deploy\n\s+if: github\.event_name == 'push' \|\| github\.event\.schedule == '20 9 \* \* \*'\n/);
  assert.match(record, /permissions:\n\s+contents: write\n/);
  for (const job of jobs.filter(job => !job.startsWith('record:'))) assert.doesNotMatch(job, /contents: write/, 'no other job may write to the repository');
  assert.match(record, /EXPECTED_COMMIT: \$\{\{ github\.sha \}\}/);
  assert.match(record, /for attempt in 1 2 3 4 5 6 7 8 9 10; do/);
  assert.match(record, /sleep 30/);
  assert.match(record, /-H 'Cache-Control: no-cache' -H 'Pragma: no-cache' -o published-holdings\.json "\$PUBLISHED_API\/holdings\.json"/);
  assert.match(record, /node scripts\/record-holdings-history\.js published-holdings\.json --target data\/snapshots\.json/);
  assert.match(record, /git add data\/snapshots\.json/);
  assert.match(record, /git commit -m "Record WAGN holdings history \$\(date -u \+%F\) \[skip ci\]"/);
  assert.match(record, /git pull --rebase origin main/);
  // every action is pinned by a full SHA with a version comment
  for (const uses of workflow.matchAll(/uses: ([^\s@]+)@(\S+)(.*)/g)) assert.match(`${uses[2]}${uses[3]}`, /^[0-9a-f]{40} # v\d/, uses[0]);
});

test('build.json states the SEC contact kind, the attestation prerequisite and the history durability', () => {
  // read with LF endings so line-anchored patterns do not depend on the checkout's line endings
  const source = fs.readFileSync(path.join(ROOT, 'scripts', 'build-pages.js'), 'utf8').split('\r\n').join('\n');
  assert.match(source, /'repository variable SEC_USER_AGENT'\s*\n\s*: 'built-in default \(no e-mail contact\)'/);
  assert.match(source, /\n\s+secContact,\n/, 'only the kind of contact is published, never the value');
  assert.doesNotMatch(source, /secContact: process\.env/);
  assert.match(source, /attestation: process\.env\.GITHUB_RUN_ID \? 'GitHub artifact attestation \(SLSA provenance\) signed for this run; with a GitHub account: gh attestation verify <file> --owner netic123' : null/);
  assert.ok(source.includes("historyDurability: 'push builds and the daily 09:20 UTC slot (when GitHub runs it) commit new receipts to data/snapshots.json, but only bytes that match the digest this build published for them;"), 'build.json says what the record job actually commits');
  assert.match(source, /testsVerifiedBy,\n/);
  assert.match(source, /yahooRequests: \(data\.marketfg && data\.marketfg\.fetchStats\) \?\? null/);
  assert.match(source, /INVESTMENTS_ALLOW_SNAPSHOT_HISTORY_SHRINK/);
  assert.throws(() => build.assertPublishedHoldingsUrl('https://example.com/investments/api/holdings.json'), /approved GitHub Pages endpoint/);
  assert.equal(build.assertPublishedHoldingsUrl(build.PUBLISHED_HOLDINGS_URL).origin, 'https://netic123.github.io');
});

test('the owner auto mode is opt-in, rate-limited, and follows an existing build instead of starting another', () => {
  assert.match(html, /LIVE_AUTO_KEY='investments\.liveUpdateAutoMinutes'/);
  assert.match(html, /document\.visibilityState!=='visible'/);
  assert.match(html, /Date\.now\(\)-LIVE_LAST_AUTO<15\*60\*1000/);
  assert.match(html, /const ACTIVE=\['queued','in_progress','waiting','pending','requested'\];/);
  assert.match(html, /runs\.find\(x=>ACTIVE\.includes\(x\.status\)\)/);
  assert.match(html, /if\(mode!=='manual'\) maybeAutoLiveUpdate\(\);/);
  // the age is judged as of the CDN copy of build.json, a build that finished after the loaded snapshot is followed
  // instead of dispatching another, and a failed automatic build pauses auto mode until a newer snapshot or a click
  assert.match(html, /const cdnMs=\(SNAPSHOT&&SNAPSHOT\.cdnAge\|\|0\)\*1000;/);
  assert.match(html, /\(Date\.now\(\)-cdnMs-new Date\(BUILD_META\.generatedAt\)\.getTime\(\)\)\/60000/);
  assert.match(html, /x\.status==='completed'&&x\.conclusion==='success'&&loadedBuild&&Date\.parse\(x\.updated_at\)>Date\.parse\(loadedBuild\)&&String\(x\.id\)!==String\(BUILD_META\.runId\)/);
  assert.match(html, /LIVE_AUTO_BLOCKED_BUILD/);
  assert.match(html, /if\(liveToken\(\)\)\{ LIVE_AUTO_BLOCKED_BUILD=null; runLiveUpdate\(\); \}/);
});
