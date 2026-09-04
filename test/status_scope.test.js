'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('Pabrai source warnings and Fear & Greed errors use separate status scopes', () => {
  assert.match(html, /onPabrai\?SNAPSHOT\.pabraiErrs:SNAPSHOT\.marketErrs/);
  assert.match(html, /pabraiErrs\.push\(`SEC automatic refresh unavailable/);
  assert.match(html, /Official SEC filing manually verified/);
  assert.match(html, /marketErrs\.push\('Fear & Greed for the markets could not be fetched/);
  assert.doesNotMatch(html, /\berrs\.push\(/);
  assert.match(html, /STATUS_RENDER\(\);/);
  // the scopes live with the set they describe, so a kept set keeps its own warnings
  assert.match(html, /const \{data,errors,pabraiErrs,marketErrs\}=set;/);
  // the SEC-unavailable messages state the build's reason field and blame nothing else
  assert.match(html, /SEC automatic refresh unavailable at \$\{STATIC_BUILD\?'build':'update'\} time \(\$\{data\.dalal\.fetchError\|\|'no reason given'\}\)/);
  assert.match(html, /SEC automatic refresh failed \(\$\{errMsg\(errors\.dalal\)\}\)/);
  assert.doesNotMatch(html, /SEC_USER_AGENT|User-Agent/);
});

test('the status line records the page load once and draws the shared warnings per render', () => {
  assert.match(html, /const PAGE_LOADED_AT=timeStr\(\);/);
  assert.match(html, /' · page loaded '\+PAGE_LOADED_AT/);
  assert.doesNotMatch(html, /page loaded '\+timeStr\(\)/);
  assert.match(html, /LAST_CHECK=\{at:timeStr\(\),mode,note\};/);
  assert.match(html, /' · checked '\+LAST_CHECK\.at/);
  assert.match(html, /const shared=sharedWarnings\(\)/);
  assert.match(html, /st\.className = scoped\.length\|\|shared\.some\(w=>w\.level==='err'\) \? 'err' : shared\.length\|\|LAST_CHECK\.failed \? 'warn' : '';/);
  assert.match(html, /#status\.warn\{color:var\(--warn\)\}/);
  // the live update owns the line while it runs
  assert.match(html, /const say=\(msg,err\)=>\{ st\.className=err\?'err':''; st\.textContent='live update: '\+msg; STATUS_RENDER=/);
});

test('browser source requests have finite deadlines', () => {
  assert.match(html, /u\.startsWith\('\/api\/marketfg'\)\?35000:45000/);
  assert.match(html, /AbortSignal\.timeout\(timeout\)/);
  assert.match(html, /CIK0001549575\.json',\{cache:'no-store',signal:AbortSignal\.timeout\(15000\)\}/);
  assert.match(html, /signal:AbortSignal\.timeout\(20000\)/, 'GitHub API calls of the live update');
  assert.match(html, /signal:AbortSignal\.timeout\(15000\)\}\);\r?\n\s+if\(r\.status===403\|\|r\.status===429\)/, 'the Build history read');
});

test('dashboard has one research-labelled expanding binary signal and no conflicting band/rule action', () => {
  assert.match(html, /Expanding-history BUY\/SELL research signal/);
  assert.match(html, /RESEARCH SIGNAL — RETROSPECTIVE, NOT VALIDATED/);
  assert.match(html, /Uses <b>all \$\{fmt\(D\.trainingRows\)\} matured training rows/);
  assert.match(html, /Not a trusted 2× model/);
  assert.doesNotMatch(html, /const RULE_SPECS/);
  assert.doesNotMatch(html, /BUY warning zone|SELL warning zone|Extreme readings double as explicit action warnings/);
  // the explanation and footer mention the learner only where it is rendered (owner mode: "above"; visitors: JSON only)
  assert.match(html, /\$\{SHOW_RESEARCH_SIGNAL\?' The BUY\/SELL research learner shown above is a separate model/);
  assert.match(html, /SHOW_RESEARCH_SIGNAL\?'The BUY\/SELL research card above is an unvalidated research model shown in the local app and to the owner only\.'/);
  assert.doesNotMatch(html, /learner below/);
  assert.ok(html.indexOf('Expanding-history BUY/SELL research signal') < html.indexOf('<h2>Indicators</h2>'), 'the research card sits above the indicators, so "above" is true when it is shown');
});

test('the Fear & Greed header and notes describe the last completed bar, one decimal, and the studied score versions', () => {
  assert.match(html, /Fear &amp; Greed · latest close/);
  assert.doesNotMatch(html, /Fear &amp; Greed now/);
  assert.match(html, /composite of the last completed benchmark bar; \$\{carried\.length\} of \$\{total\} indicators carried from \$\{carriedDates\.length>1\?carriedDates\.map\(fmtDate\)\.join\(" \/ "\):fmtDate\(oldest\)\}/);
  assert.match(html, /all \$\{total\} indicators as of that date/);
  assert.match(html, /0–100, one decimal/);
  assert.match(html, /has had no rule search and no prospective test, so no buy\/sell signal is shown here/);
  assert.match(html, /earlier v1 and v2 scores \(trailing-window percentiles, since replaced by this v3 score\)/);
  assert.match(html, /M\.key==='ustech'\r?\n\s+\? 'US Tech was added on 27 Aug 2026, after the owner’s back-tests: no rule search, replication, diagnostic battery or lockbox covers it\./);
  assert.doesNotMatch(html, /none of them covers this tab/, 'a fitted study in research\/ does include US Tech');
});
