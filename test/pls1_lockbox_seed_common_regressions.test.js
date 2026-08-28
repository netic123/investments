'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const common = require('../scripts/pls1-lockbox-common');
const seedBuilder = require('../scripts/build-pls1-lockbox-seed');

function temporaryRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pls1-seed-common-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function isoDates(first, count) {
  const dates = [];
  const cursor = new Date(`${first}T00:00:00.000Z`);
  while (dates.length < count) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function streamingResponse(bytes, { url = 'https://example.test/', status = 200,
  headers = {} } = {}) {
  const payload = Buffer.from(bytes);
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'ERROR',
    url,
    headers: new Headers(headers),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(payload);
        controller.close();
      },
    }),
  };
}

test('date-only identities require real Gregorian ISO calendar dates', () => {
  assert.equal(common.isExactDate('2024-02-29'), true);
  for (const invalid of ['2023-02-29', '2026-02-30', '2026-13-01', '9999-99-99',
    '2026-8-01', new Date('2026-08-01T00:00:00.000Z')]) {
    assert.equal(common.isExactDate(invalid), false, String(invalid));
    assert.throws(() => common.decisionPath('x', invalid), /invalid date/);
  }
});

test('source horizon is frozen as exactly 759 required future sessions, not elapsed days', () => {
  assert.equal(seedBuilder.REQUIRED_FUTURE_SOURCE_SESSIONS, 759);
  const historicalBoundary = ['2025-12-31'];
  const future = isoDates('2026-01-01', 759);
  const contract = { calendars: { TEST: { timezone: 'UTC',
    sessions: [...historicalBoundary, ...future] } } };
  assert.doesNotThrow(() => seedBuilder.assertSourceCalendarHorizon(contract, '2026-01-01'));
  const short = { calendars: { TEST: { timezone: 'UTC',
    sessions: [...historicalBoundary, ...future.slice(0, 758)] } } };
  assert.throws(() => seedBuilder.assertSourceCalendarHorizon(short, '2026-01-01'),
    /only 758 future sessions.*759 required/);
  assert.throws(() => seedBuilder.assertSourceCalendarHorizon(contract, '2026-02-30'),
    /exact date/);
});

test('replay target dates come only from the frozen risky-target calendar authority', () => {
  const calendarId = 'INDEPENDENT_TEST_CALENDAR';
  const frozenSessions = ['2026-08-23', '2026-08-25', '2026-08-27', '2026-08-28'];
  const identities = Object.fromEntries([...new Set(common.MARKET_ORDER
    .map(key => common.TARGETS[key].symbol))].map(symbol => [symbol, {
    calendarId, firstAdjustedDate: frozenSessions[0],
  }]));
  const contract = {
    calendars: { [calendarId]: { timezone: 'America/New_York', sessions: frozenSessions } },
    identities,
  };
  assert.equal(seedBuilder.isExpectedNyseSession('2026-08-23'), false,
    'the legacy constructed calendar treats this Sunday as closed');
  assert.deepEqual(seedBuilder.frozenTargetCalendar(contract, '2026-08-28'),
    frozenSessions.slice(0, -1),
    'the independently frozen contract, including its unusual Sunday, is the replay authority');
});

test('fetch capture records the effective Request URL and method after Request/init merging', async () => {
  let observed;
  const nativeFetch = async request => {
    observed = request;
    return streamingResponse([123, 125], { url: request.url,
      headers: { 'content-type': 'application/json' } });
  };
  const capture = seedBuilder.installFetchCapture(nativeFetch);
  capture.setPhase('COMPONENT');
  const original = new Request('https://example.test/effective?x=1', { method: 'POST' });
  await capture.capturedFetch(original, { method: 'PATCH' });
  assert.equal(observed.url, 'https://example.test/effective?x=1');
  assert.equal(observed.method, 'PATCH');
  assert.equal(observed.redirect, 'error');
  assert.equal(capture.requests[0].url, observed.url);
  assert.equal(capture.requests[0].method, observed.method);
  assert.deepEqual(capture.requests[0].bytes, Buffer.from([123, 125]));
});

test('bounded body reader preserves exact chunk bytes and hash', async () => {
  const expected = Buffer.from([0, 1, 2, 255, 128, 64]);
  const response = {
    headers: new Headers({ 'content-length': String(expected.length) }),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(expected.subarray(0, 2));
        controller.enqueue(expected.subarray(2, 5));
        controller.enqueue(expected.subarray(5));
        controller.close();
      },
    }),
  };
  const actual = await common.readResponseBodyLimited(response, expected.length, 'exact test');
  assert.deepEqual(actual, expected);
  assert.equal(common.sha256(actual), common.sha256(expected));
});

test('bounded body reader rejects Content-Length before reading a body', async () => {
  let readerRequested = false;
  const response = {
    headers: new Headers({ 'content-length': '6' }),
    body: { getReader() { readerRequested = true; throw new Error('must not read'); } },
  };
  await assert.rejects(common.readResponseBodyLimited(response, 5, 'declared-large test'),
    error => error.code === 'PLS1_RESPONSE_BODY_TOO_LARGE'
      && /Content-Length 6/.test(error.message));
  assert.equal(readerRequested, false);
});

test('bounded body reader rejects a truncated body that contradicts Content-Length', async () => {
  const response = streamingResponse([1, 2, 3], {
    headers: { 'content-length': '4' },
  });
  await assert.rejects(common.readResponseBodyLimited(response, 10, 'truncated test'),
    /Content-Length mismatch: declared 4, received 3/);
});

test('bounded body reader cancels an oversized chunked body before accumulating it', async () => {
  const chunks = [Buffer.from([1, 2, 3]), Buffer.from([4, 5, 6]), Buffer.from([7])];
  let reads = 0;
  let cancelled = false;
  let released = false;
  const response = {
    headers: new Headers(),
    body: { getReader() { return {
      async read() {
        const value = chunks[reads++];
        return value ? { done: false, value } : { done: true, value: undefined };
      },
      async cancel() { cancelled = true; },
      releaseLock() { released = true; },
    }; } },
  };
  await assert.rejects(common.readResponseBodyLimited(response, 5, 'chunked-large test'),
    error => error.code === 'PLS1_RESPONSE_BODY_TOO_LARGE'
      && /received at least 6 bytes/.test(error.message));
  assert.equal(reads, 2, 'the reader must stop before requesting another chunk');
  assert.equal(cancelled, true);
  assert.equal(released, true);
});

test('source capture rejects an oversized declared body without retaining bytes', async () => {
  let readerRequested = false;
  const nativeFetch = async request => ({
    status: 200,
    statusText: 'OK',
    url: request.url,
    headers: new Headers({ 'content-type': 'application/json',
      'content-length': String(common.MAX_RAW_BYTES + 1) }),
    body: { getReader() { readerRequested = true; throw new Error('must not read'); } },
  });
  const capture = seedBuilder.installFetchCapture(nativeFetch);
  capture.setPhase('COMPONENT');
  await assert.rejects(capture.capturedFetch('https://example.test/oversized'),
    /response-body limit/);
  assert.equal(readerRequested, false);
  assert.equal(capture.requests.length, 1);
  assert.equal(capture.requests[0].bytes, null);
  assert.match(capture.requests[0].error, /PLS1_RESPONSE_BODY_TOO_LARGE|response-body limit/);
});

test('Yahoo executable reads enforce the body ceiling on every fallback host', async t => {
  let calls = 0;
  let readerRequests = 0;
  let cancellations = 0;
  t.mock.method(globalThis, 'fetch', async () => {
    calls += 1;
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(common.MAX_RAW_BYTES + 1) }),
      body: {
        getReader() { readerRequests += 1; throw new Error('must not read'); },
        async cancel() { cancellations += 1; },
      },
    };
  });
  await assert.rejects(seedBuilder.fetchYahooChart('SPY', '5y', '2026-08-28'),
    error => error.code === 'PLS1_RESPONSE_BODY_TOO_LARGE');
  assert.equal(calls, 2, 'both frozen fallback hosts independently enforce the limit');
  assert.equal(readerRequests, 0);
  assert.equal(cancellations, 2);
});

test('deterministic zero-byte blobs are valid only for unselected failure evidence', t => {
  const root = temporaryRoot(t);
  const raw = common.createRawBlob(root, Buffer.alloc(0));
  assert.equal(raw.rawBytes, 0);
  assert.equal(common.verifyRawBlob(root, raw).length, 0);

  const contract = seedBuilder.expectedSourceContract('5y');
  const symbol = contract.componentSymbols[0];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`
    + '?range=5y&interval=1d';
  const receipt = {
    requestOrdinal: 0,
    phase: 'COMPONENT',
    method: 'GET',
    url,
    startedAtUtc: '2026-08-28T05:00:00.000Z',
    completedAtUtc: '2026-08-28T05:00:01.000Z',
    status: 500,
    responseUrl: url,
    headers: { 'content-type': 'application/json' },
    acceptedFor: [],
    error: null,
    path: raw.path,
    rawSha256: raw.rawSha256,
    rawBytes: raw.rawBytes,
    gzipSha256: raw.gzipSha256,
    gzipBytes: raw.gzipBytes,
  };
  assert.doesNotThrow(() => seedBuilder.validatePartialAcquisitionReceipts({
    receipts: [receipt], range: '5y', retrievalDateUtc: '2026-08-28',
  }));

  receipt.status = 200;
  receipt.acceptedFor = [`COMPONENT:${symbol}`];
  assert.equal(seedBuilder.isCompletedJsonReceipt(receipt), false);
  assert.throws(() => seedBuilder.validatePartialAcquisitionReceipts({
    receipts: [receipt], range: '5y', retrievalDateUtc: '2026-08-28',
  }), /selection mismatch/);
});

test('canonical JSON verification hashes and parses one immutable body read', t => {
  const root = temporaryRoot(t);
  const file = path.join(root, 'evidence.json');
  common.createCanonicalWithSidecar(file, { schema: 'single-read-test-v1', value: 7 });
  const nativeRead = fs.readFileSync.bind(fs);
  let bodyReads = 0;
  t.mock.method(fs, 'readFileSync', (target, ...args) => {
    if (path.resolve(String(target)) === path.resolve(file)) bodyReads += 1;
    return nativeRead(target, ...args);
  });
  const verified = common.verifyCanonicalJson(file);
  assert.deepEqual(verified.value, { schema: 'single-read-test-v1', value: 7 });
  assert.equal(bodyReads, 1,
    'digest verification and parsing must use the exact same body bytes');
});

test('canonical JSON verification rejects duplicate keys even with an exact sidecar', t => {
  const root = temporaryRoot(t);
  const file = path.join(root, 'duplicate.json');
  const bytes = Buffer.from('{"schema":"duplicate-test-v1","schema":"duplicate-test-v1"}');
  const digest = common.sha256(bytes);
  fs.writeFileSync(file, bytes);
  fs.writeFileSync(`${file}.sha256`, common.sidecarBytes(path.basename(file), digest));
  assert.throws(() => common.verifyCanonicalJson(file), /JSON bytes are not exact canonical bytes/);
});
