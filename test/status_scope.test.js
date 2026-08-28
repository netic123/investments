'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('Pabrai source warnings and Fear & Greed errors use separate status scopes', () => {
  assert.match(html, /onPabrai\s*\?\s*pabraiErrs\s*:\s*marketErrs/);
  assert.match(html, /pabraiErrs\.push\(`SEC automatic refresh unavailable/);
  assert.match(html, /Official SEC filing manually verified/);
  assert.match(html, /marketErrs\.push\('Fear & Greed for the markets could not be fetched/);
  assert.doesNotMatch(html, /\berrs\.push\(/);
  assert.match(html, /STATUS_RENDER\(\);/);
});

test('browser source requests have finite deadlines', () => {
  assert.match(html, /u\.startsWith\('\/api\/marketfg'\)\?35000:45000/);
  assert.match(html, /AbortSignal\.timeout\(timeout\)/);
  assert.match(html, /CIK0001549575\.json',\{cache:'no-store',signal:AbortSignal\.timeout\(15000\)\}/);
});

test('dashboard has one research-labelled expanding binary signal and no conflicting band/rule action', () => {
  assert.match(html, /Expanding-history BUY\/SELL research signal/);
  assert.match(html, /RESEARCH SIGNAL — RETROSPECTIVE, NOT VALIDATED/);
  assert.match(html, /Uses <b>all \$\{fmt\(D\.trainingRows\)\} matured training rows/);
  assert.match(html, /Not a trusted 2× model/);
  assert.doesNotMatch(html, /const RULE_SPECS/);
  assert.doesNotMatch(html, /BUY warning zone|SELL warning zone|Extreme readings double as explicit action warnings/);
});
