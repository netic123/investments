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
  const hash = crypto.createHash('sha256').update(script, 'utf8').digest('base64');
  assert.ok(csp.includes(`script-src 'sha256-${hash}'`));
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /connect-src 'self' https:\/\/data\.sec\.gov/);
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
  // the snapshot age warning reaches both status scopes
  assert.match(html, /SNAPSHOT_STALE_AFTER_HOURS=30/);
  assert.match(html, /pabraiErrs\.push\(warning\); marketErrs\.push\(warning\);/);
  assert.equal(build.SNAPSHOT_STALE_AFTER_HOURS, 30);
  // reload really bypasses the CDN cache and reports the outcome
  assert.match(html, /'\?reload='\+Date\.now\(\)/);
  assert.match(html, /no newer snapshot has been published/);
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
  const end = html.indexOf('function unitFlowBetween(a,b){');
  assert.ok(start > 0 && end > start, 'holdingsNavCheck must precede unitFlowBetween in index.html');
  const context = { fmt: (n, d = 0) => (typeof n === 'number' ? n.toFixed(d) : String(n)), fmtDate: iso => iso, Date, Number, Math };
  require('node:vm').runInNewContext(html.slice(start, end), context);
  const cases = [
    [{ date: '2026-09-01', netAssets: 296613978.66, sharesOutstanding: 18320814 }, { date: '2026-08-31', nav: 16.19, sharesOut: 18170814 }],
    [{ date: '2026-08-28', netAssets: 289824483.3, sharesOutstanding: 18170814 }, { date: '2026-08-27', nav: 15.95, sharesOut: 18170814 }],
    [{ date: '2026-09-01', netAssets: 296613978.66, sharesOutstanding: 18320814 }, { date: '2026-08-31', nav: 16.19, sharesOut: null }],
    [{ date: '2026-09-02', netAssets: 294400000, sharesOutstanding: 18320814 }, { date: '2026-08-31', nav: 16.19, sharesOut: 18170814 }],
    [{ date: '2026-09-01', netAssets: 296613978.66, sharesOutstanding: 18320814 }, { date: '2026-09-02', nav: 16.19, sharesOut: 18320814 }],
    [{ date: '2026-09-01', netAssets: 296613978.66, sharesOutstanding: 18320814 }, null],
  ];
  for (const [latest, nav] of cases) {
    const page = context.holdingsNavCheck({ latest }, nav);
    const node = reconcileWagnHoldingsToNav(latest, nav);
    assert.equal(page.matched, node.matched, JSON.stringify([latest, nav]));
    assert.equal(page.mode, node.mode, JSON.stringify([latest, nav]));
    assert.equal(page.unitChange, node.unitChange, JSON.stringify([latest, nav]));
  }
});

test('config names every current holding and cash currency', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'config.json'), 'utf8'));
  assert.ok(config.names['ODL NO'] && config.names['ODL NO'].flag === '🇳🇴');
  assert.ok(config.cashTickers.includes('NOK'));
});

test('the Pages workflow builds twice a day and passes only a validated SEC contact', () => {
  const workflow = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
  assert.match(workflow, /- cron: '15 9 \* \* \*'/);
  assert.match(workflow, /- cron: '35 21 \* \* 1-5'/);
  assert.match(workflow, /SEC_USER_AGENT: \$\{\{ vars\.SEC_USER_AGENT \}\}/);
});
