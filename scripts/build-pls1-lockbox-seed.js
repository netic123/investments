'use strict';

const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');
const common = require('./pls1-lockbox-common');
const model = require('../research/fear_greed_control_residual_pls1');

const USER_AGENT = 'netic123-investments-pls1-lockbox/1.0';
const SOURCE_IDENTITY_PATH = path.join(common.ROOT, 'research', 'PLS1_SOURCE_IDENTITY_CONTRACT.json');
const MIN_LIVE_SOURCE_SESSIONS = 756;
// A frozen source calendar must cover the activation decision, the fixed 756
// post-activation decision origins, and the two later sessions needed to mature
// the final origin. This is deliberately a session count, not elapsed days.
const REQUIRED_FUTURE_SOURCE_SESSIONS = 1 + 756 + 2;
// Once the activation decision close is fixed, the frozen risky-target
// calendar must still contain the 756 post-activation decision origins plus
// the two later sessions that fill and mature the final origin.
const REQUIRED_ACTIVATION_FORWARD_SESSIONS = 756 + 2;

function daysBetween(earlier, later) {
  return (Date.parse(`${later}T00:00:00.000Z`) - Date.parse(`${earlier}T00:00:00.000Z`)) / 86400000;
}

const SPECIAL_NYSE_CLOSURES = Object.freeze(new Set([
  '1994-04-27',
  '2001-09-11', '2001-09-12', '2001-09-13', '2001-09-14',
  '2004-06-11', '2007-01-02', '2012-10-29', '2012-10-30',
  '2018-12-05', '2025-01-09',
]));

function dateFromUtc(year, month, day) {
  return new Date(Date.UTC(year, month, day));
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function exactDate(value) {
  return common.isExactDate(value);
}

function nthWeekday(year, month, weekday, ordinal) {
  const date = dateFromUtc(year, month, 1);
  date.setUTCDate(1 + ((7 + weekday - date.getUTCDay()) % 7) + (7 * (ordinal - 1)));
  return isoDate(date);
}

function lastWeekday(year, month, weekday) {
  const date = dateFromUtc(year, month + 1, 0);
  date.setUTCDate(date.getUTCDate() - ((7 + date.getUTCDay() - weekday) % 7));
  return isoDate(date);
}

function observedFixedHoliday(year, month, day) {
  const date = dateFromUtc(year, month, day);
  if (date.getUTCDay() === 6) date.setUTCDate(date.getUTCDate() - 1);
  else if (date.getUTCDay() === 0) date.setUTCDate(date.getUTCDate() + 1);
  return isoDate(date);
}

function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = ((19 * a) + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + (2 * e) + (2 * i) - h - k) % 7;
  const m = Math.floor((a + (11 * h) + (22 * l)) / 451);
  const month = Math.floor((h + l - (7 * m) + 114) / 31) - 1;
  const day = ((h + l - (7 * m) + 114) % 31) + 1;
  return dateFromUtc(year, month, day);
}

function nyseHolidaySet(year) {
  const holidays = new Set([
    observedFixedHoliday(year, 0, 1),
    nthWeekday(year, 1, 1, 3),
    lastWeekday(year, 4, 1),
    observedFixedHoliday(year, 6, 4),
    nthWeekday(year, 8, 1, 1),
    nthWeekday(year, 10, 4, 4),
    observedFixedHoliday(year, 11, 25),
  ]);
  if (year >= 1998) holidays.add(nthWeekday(year, 0, 1, 3));
  if (year >= 2022) holidays.add(observedFixedHoliday(year, 5, 19));
  const goodFriday = easterSunday(year);
  goodFriday.setUTCDate(goodFriday.getUTCDate() - 2);
  holidays.add(isoDate(goodFriday));
  for (const closure of SPECIAL_NYSE_CLOSURES) if (closure.startsWith(`${year}-`)) holidays.add(closure);
  return holidays;
}

function isExpectedNyseSession(date) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  const weekday = parsed.getUTCDay();
  return weekday !== 0 && weekday !== 6 && !nyseHolidaySet(parsed.getUTCFullYear()).has(date);
}

function validateTargetCalendar(series, retrievalDateUtc) {
  if (!Array.isArray(series) || !series.length
      || series.some(item => !item || !Array.isArray(item.rows) || !item.rows.length)) {
    throw new Error('target calendar source series are incomplete');
  }
  const expectedLatest = new Date(`${retrievalDateUtc}T00:00:00.000Z`);
  do { expectedLatest.setUTCDate(expectedLatest.getUTCDate() - 1); }
  while (!isExpectedNyseSession(isoDate(expectedLatest)));
  const expectedLatestDate = isoDate(expectedLatest);
  function expectedSessions(first) {
    const result = [];
    for (let cursor = new Date(`${first}T00:00:00.000Z`);
      isoDate(cursor) <= expectedLatestDate; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      const date = isoDate(cursor);
      if (isExpectedNyseSession(date)) result.push(date);
    }
    return result;
  }
  for (const item of series) {
    const actual = item.rows.map(row => row.date);
    const expected = expectedSessions(actual[0]);
    const label = item.symbol || item.providerSymbol || 'target series';
    if (actual.at(-1) !== expectedLatestDate) {
      throw new Error(`${label}: target calendar terminal date ${actual.at(-1)} is not expected latest completed NYSE session ${expectedLatestDate}`);
    }
    const expectedSet = new Set(expected);
    const unexpected = actual.find(date => !expectedSet.has(date));
    if (unexpected) throw new Error(`${label}: target calendar contains unexpected non-session row ${unexpected}`);
    const present = new Set(actual);
    const missing = expected.find(date => !present.has(date));
    if (missing) throw new Error(`${label}: target calendar missing expected NYSE session ${missing}`);
    if (model.canonicalStringify(actual) !== model.canonicalStringify(expected)) {
      throw new Error(`${label}: target calendar is not the exact frozen session sequence`);
    }
  }
  const first = series.map(item => item.rows[0].date).sort()[0];
  return expectedSessions(first);
}

function selectedHeaders(headers) {
  const result = {};
  for (const key of ['content-type', 'content-length', 'date', 'etag', 'last-modified']) {
    const value = headers.get(key);
    if (value != null) result[key] = value;
  }
  return result;
}

function sourceRequestInitiationDeadlineUtc(retrievalDateUtc) {
  if (!exactDate(retrievalDateUtc)) throw new Error(`invalid retrieval date ${retrievalDateUtc}`);
  return `${retrievalDateUtc}T12:00:00.000Z`;
}

function installFetchCapture(nativeFetch = global.fetch, requestInitiationDeadlineUtc = null) {
  if (typeof nativeFetch !== 'function') throw new Error('Node global fetch is unavailable');
  if (requestInitiationDeadlineUtc !== null && !exactUtc(requestInitiationDeadlineUtc)) {
    throw new Error('request initiation deadline must be exact millisecond UTC');
  }
  const requests = [];
  let phase = 'UNSPECIFIED';
  async function capturedFetch(input, init = {}) {
    const effectiveRequest = new Request(input, { ...init, redirect: 'error' });
    const url = effectiveRequest.url;
    const requestOrdinal = requests.length;
    const startedAtUtc = new Date().toISOString();
    if (requestInitiationDeadlineUtc !== null && startedAtUtc >= requestInitiationDeadlineUtc) {
      throw new Error(`source request ${requestOrdinal} initiation at ${startedAtUtc} is at or past the frozen deadline ${requestInitiationDeadlineUtc}`);
    }
    const record = {
      requestOrdinal,
      phase,
      method: effectiveRequest.method,
      url,
      startedAtUtc,
      completedAtUtc: null,
      status: null,
      responseUrl: null,
      headers: {},
      bytes: null,
      error: null,
      acceptedFor: [],
    };
    requests.push(record);
    try {
      const response = await nativeFetch(effectiveRequest);
      record.status = response.status;
      record.responseUrl = response.url;
      record.headers = selectedHeaders(response.headers);
      record.bytes = await common.readResponseBodyLimited(response, common.MAX_RAW_BYTES,
        `source request ${requestOrdinal}`);
      record.completedAtUtc = new Date().toISOString();
      const replay = new Response(record.bytes, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
      Object.defineProperty(replay, '__captureOrdinal', {
        value: requestOrdinal, enumerable: false, writable: false,
      });
      return replay;
    } catch (error) {
      record.completedAtUtc = new Date().toISOString();
      record.error = String(error && (error.stack || error.message) || error);
      throw error;
    }
  }
  return {
    requests,
    capturedFetch,
    setPhase(value) { phase = String(value); },
  };
}

function parseYahooChart(bytes, symbol, retrievalDateUtc) {
  const json = JSON.parse(bytes.toString('utf8'));
  const chart = json && json.chart;
  const result = chart && Array.isArray(chart.result) && chart.result.length === 1
    ? chart.result[0] : null;
  if (!result || chart.error !== null) {
    const error = json.chart && json.chart.error;
    throw new Error(`${symbol}: Yahoo chart requires exactly one result and null error${error ? `: ${JSON.stringify(error)}` : ''}`);
  }
  const meta = result.meta;
  if (!meta || !Number.isInteger(meta.firstTradeDate) || meta.firstTradeDate <= 0) {
    throw new Error(`${symbol}: Yahoo firstTradeDate metadata missing or invalid`);
  }
  const timezone = meta.exchangeTimezoneName;
  if (!timezone) throw new Error(`${symbol}: Yahoo timezone missing`);
  try { new Intl.DateTimeFormat('sv-SE', { timeZone: timezone }).format(new Date()); }
  catch { throw new Error(`${symbol}: Yahoo timezone is not a valid IANA timezone`); }
  const currentLocalDate = new Date(`${retrievalDateUtc}T12:00:00.000Z`).toLocaleDateString(
    'sv-SE', { timeZone: timezone },
  );
  const timestamps = result.timestamp || [];
  const quoteSets = (result.indicators || {}).quote;
  const adjustedSets = (result.indicators || {}).adjclose;
  if (!Array.isArray(quoteSets) || quoteSets.length !== 1
      || !Array.isArray(adjustedSets) || adjustedSets.length !== 1) {
    throw new Error(`${symbol}: Yahoo requires exactly one quote and adjusted-close indicator set`);
  }
  const quote = quoteSets[0].close;
  const adjusted = adjustedSets[0].adjclose;
  if (!Array.isArray(timestamps) || !Array.isArray(quote) || !Array.isArray(adjusted)
      || timestamps.length !== quote.length || adjusted.length !== quote.length) {
    throw new Error(`${symbol}: timestamp/close/adjusted-close coverage is incomplete`);
  }
  const byDate = new Map();
  for (let index = 0; index < timestamps.length; index += 1) {
    if (!Number.isFinite(timestamps[index]) || (index > 0 && timestamps[index] <= timestamps[index - 1])) {
      throw new Error(`${symbol}: timestamps are not finite and strictly increasing at row ${index}`);
    }
    const close = quote[index];
    const adjClose = adjusted[index];
    const closeValid = Number.isFinite(close) && close > 0;
    const adjustedValid = Number.isFinite(adjClose) && adjClose > 0;
    if (!closeValid && !adjustedValid) continue;
    if (!adjustedValid) {
      throw new Error(`${symbol}: positive close without adjusted close at row ${index}`);
    }
    const date = new Date(timestamps[index] * 1000).toLocaleDateString('sv-SE', { timeZone: timezone });
    if (date >= currentLocalDate) continue;
    if (byDate.has(date)) throw new Error(`${symbol}: duplicate exchange-local date ${date}`);
    byDate.set(date, { date, close: closeValid ? close : null, adjustedClose: adjClose });
  }
  const rows = [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  if (rows.length < 2) throw new Error(`${symbol}: fewer than two completed adjusted-close rows`);
  return {
    symbol,
    providerSymbol: meta.symbol || null,
    name: String(meta.longName || meta.shortName || symbol).replace(/\s+/g, ' ').trim(),
    currency: meta.currency || null,
    exchange: meta.exchangeName || null,
    timezone,
    instrumentType: meta.instrumentType || null,
    firstTradeDate: meta.firstTradeDate,
    adjusted: true,
    rows,
  };
}

function validateMaximumHistory(series, symbol, identity) {
  const firstTradeDate = new Date(series.firstTradeDate * 1000)
    .toLocaleDateString('sv-SE', { timeZone: series.timezone });
  const firstRowDate = series.rows[0].date;
  if (!identity || series.firstTradeDate !== identity.firstTradeDate
      || firstTradeDate !== identity.firstTradeDateLocal
      || firstRowDate !== identity.firstAdjustedDate) {
    throw new Error(`${symbol}: max history boundary does not match the independently frozen identity contract`);
  }
  return { firstTradeDate, firstRowDate };
}

function requiredSourceSymbols() {
  const contract = expectedSourceContract('max');
  return [...new Set([...contract.componentSymbols, ...contract.executableSymbols])];
}

function validateSourceIdentityContract(contract) {
  const required = requiredSourceSymbols();
  if (!contract || contract.schema !== 'fg-control-residual-pls1-source-identities-v1'
      || contract.status !== 'INDEPENDENTLY_VERIFIED_LICENSED_SOURCE_IDENTITIES'
      || typeof contract.evidenceReference !== 'string' || !contract.evidenceReference
      || model.canonicalStringify(contract.requiredSymbols) !== model.canonicalStringify(required)
      || !contract.calendars || typeof contract.calendars !== 'object'
      || !contract.identities || typeof contract.identities !== 'object'
      || model.canonicalStringify(Object.keys(contract.identities).sort())
        !== model.canonicalStringify([...required].sort())) {
    throw new Error('source identity contract is pending, incomplete, or not independently evidenced');
  }
  const usedCalendars = new Set();
  for (const symbol of required) {
    const identity = contract.identities[symbol];
    const keys = Object.keys(identity || {}).sort();
    const expectedKeys = ['calendarId', 'currency', 'exchange', 'firstAdjustedDate', 'firstTradeDate',
      'firstTradeDateLocal', 'instrumentType', 'providerSymbol', 'timezone'].sort();
    if (model.canonicalStringify(keys) !== model.canonicalStringify(expectedKeys)
        || identity.providerSymbol !== symbol || typeof identity.currency !== 'string' || !identity.currency
        || typeof identity.exchange !== 'string' || !identity.exchange
        || typeof identity.timezone !== 'string' || !identity.timezone
        || typeof identity.instrumentType !== 'string' || !identity.instrumentType
        || typeof identity.calendarId !== 'string' || !identity.calendarId
        || !Number.isInteger(identity.firstTradeDate) || identity.firstTradeDate <= 0
        || !exactDate(identity.firstTradeDateLocal)
        || !exactDate(identity.firstAdjustedDate)) {
      throw new Error(`${symbol}: frozen source identity is incomplete`);
    }
    try { new Intl.DateTimeFormat('sv-SE', { timeZone: identity.timezone }).format(new Date()); }
    catch { throw new Error(`${symbol}: frozen source timezone is not valid IANA data`); }
    usedCalendars.add(identity.calendarId);
  }
  if (model.canonicalStringify(Object.keys(contract.calendars).sort())
      !== model.canonicalStringify([...usedCalendars].sort())) {
    throw new Error('source calendar inventory does not exactly match referenced calendars');
  }
  for (const calendarId of usedCalendars) {
    const calendar = contract.calendars[calendarId];
    const keys = Object.keys(calendar || {}).sort();
    const expectedKeys = ['evidenceReference', 'horizonDate', 'sessions', 'sessionsSha256', 'timezone'].sort();
    if (model.canonicalStringify(keys) !== model.canonicalStringify(expectedKeys)
        || typeof calendar.evidenceReference !== 'string' || !calendar.evidenceReference
        || typeof calendar.timezone !== 'string' || !calendar.timezone
        || !Array.isArray(calendar.sessions) || calendar.sessions.length < MIN_LIVE_SOURCE_SESSIONS
        || calendar.sessionsSha256 !== model.hashCanonical(calendar.sessions)
        || calendar.horizonDate !== calendar.sessions.at(-1)
        || !exactDate(calendar.horizonDate)) {
      throw new Error(`${calendarId}: independently frozen source calendar is incomplete`);
    }
    calendar.sessions.forEach((date, index) => {
      if (!exactDate(date)
          || index > 0 && calendar.sessions[index - 1] >= date) {
        throw new Error(`${calendarId}: source sessions are not exact increasing ISO dates`);
      }
    });
    try { new Intl.DateTimeFormat('sv-SE', { timeZone: calendar.timezone }).format(new Date()); }
    catch { throw new Error(`${calendarId}: source calendar timezone is not valid IANA data`); }
  }
  for (const symbol of required) {
    const identity = contract.identities[symbol];
    const calendar = contract.calendars[identity.calendarId];
    if (identity.timezone !== calendar.timezone || !calendar.sessions.includes(identity.firstAdjustedDate)) {
      throw new Error(`${symbol}: source identity is inconsistent with its frozen calendar`);
    }
  }
  return contract;
}

function loadSourceIdentityContract() {
  const bytes = fs.readFileSync(SOURCE_IDENTITY_PATH);
  const contract = JSON.parse(bytes.toString('utf8'));
  if (!bytes.equals(Buffer.from(model.canonicalStringify(contract)))) {
    throw new Error('source identity contract bytes are not canonical');
  }
  return validateSourceIdentityContract(contract);
}

function validateSourceIdentity(series, symbol, contract, requireMaximumHistory) {
  const expected = contract.identities[symbol];
  if (!expected) throw new Error(`${symbol}: no independently frozen source identity`);
  for (const key of ['providerSymbol', 'currency', 'exchange', 'timezone', 'instrumentType', 'firstTradeDate']) {
    if (series[key] !== expected[key]) {
      throw new Error(`${symbol}: provider ${key} ${series[key]} does not match frozen ${expected[key]}`);
    }
  }
  if (requireMaximumHistory) validateMaximumHistory(series, symbol, expected);
}

function validateSourceCalendar(series, symbol, contract, range, retrievalDateUtc) {
  const identity = contract.identities[symbol];
  const calendar = contract.calendars[identity.calendarId];
  const currentLocalDate = new Date(`${retrievalDateUtc}T12:00:00.000Z`)
    .toLocaleDateString('sv-SE', { timeZone: identity.timezone });
  const eligible = calendar.sessions.filter(date => date >= identity.firstAdjustedDate
    && date < currentLocalDate);
  if (!eligible.length) throw new Error(`${symbol}: frozen calendar has no completed sessions`);
  const actual = series.rows.map(row => row.date);
  if (actual.at(-1) !== eligible.at(-1)) {
    throw new Error(`${symbol}: source terminal date does not match its independently frozen calendar`);
  }
  const start = range === 'max' ? 0 : eligible.indexOf(actual[0]);
  if (start < 0 || model.canonicalStringify(actual)
      !== model.canonicalStringify(eligible.slice(start))) {
    throw new Error(`${symbol}: source dates are not an exact contiguous frozen-calendar suffix`);
  }
  if (range !== 'max' && actual.length < MIN_LIVE_SOURCE_SESSIONS) {
    throw new Error(`${symbol}: bounded live source has only ${actual.length} sessions; ${MIN_LIVE_SOURCE_SESSIONS} required`);
  }
}

function calendarLocalDate(calendar, retrievalDateUtc) {
  if (!exactDate(retrievalDateUtc) || !calendar || typeof calendar.timezone !== 'string') {
    throw new Error('frozen calendar and exact retrieval date are required');
  }
  return new Date(`${retrievalDateUtc}T12:00:00.000Z`)
    .toLocaleDateString('sv-SE', { timeZone: calendar.timezone });
}

function frozenTargetCalendarAuthority(contract) {
  if (!contract || !contract.identities || !contract.calendars) {
    throw new Error('frozen source contract is required for target calendar');
  }
  const targetSymbols = [...new Set(common.MARKET_ORDER.map(key => common.TARGETS[key].symbol))];
  const targetIdentities = targetSymbols.map(symbol => {
    const identity = contract.identities[symbol];
    if (!identity || !contract.calendars[identity.calendarId]) {
      throw new Error(`${symbol}: frozen risky-target calendar is missing`);
    }
    return identity;
  });
  const calendarIds = [...new Set(targetIdentities.map(identity => identity.calendarId))];
  if (calendarIds.length !== 1) {
    throw new Error('risky targets do not share one frozen source calendar authority');
  }
  return {
    calendar: contract.calendars[calendarIds[0]],
    firstAdjustedDate: targetIdentities.map(identity => identity.firstAdjustedDate).sort()[0],
  };
}

function frozenTargetCalendarSessions(contract) {
  const { calendar, firstAdjustedDate } = frozenTargetCalendarAuthority(contract);
  const sessions = calendar.sessions.filter(date => date >= firstAdjustedDate);
  if (!sessions.length) throw new Error('frozen risky-target calendar has no sessions');
  return sessions;
}

function frozenTargetCalendar(contract, retrievalDateUtc) {
  if (!contract || !contract.identities || !contract.calendars || !exactDate(retrievalDateUtc)) {
    throw new Error('frozen source contract and exact retrieval date are required for target calendar');
  }
  const { calendar, firstAdjustedDate } = frozenTargetCalendarAuthority(contract);
  const currentLocalDate = calendarLocalDate(calendar, retrievalDateUtc);
  const sessions = calendar.sessions.filter(date => date >= firstAdjustedDate && date < currentLocalDate);
  if (!sessions.length) throw new Error('frozen risky-target calendar has no completed sessions');
  return sessions;
}

function assertActivationForwardHorizon(contract, activationDecisionDate,
  minimumForwardSessions = REQUIRED_ACTIVATION_FORWARD_SESSIONS) {
  if (!exactDate(activationDecisionDate) || !Number.isInteger(minimumForwardSessions)
      || minimumForwardSessions < 1) {
    throw new Error('activation forward horizon requires an exact decision date and positive forward-session count');
  }
  const sessions = frozenTargetCalendarSessions(contract);
  if (!sessions.includes(activationDecisionDate)) {
    throw new Error(`activation decision ${activationDecisionDate} is not a frozen risky-target calendar session`);
  }
  const forwardSessions = sessions.filter(date => date > activationDecisionDate);
  if (forwardSessions.length < minimumForwardSessions) {
    throw new Error(`frozen risky-target calendar has only ${forwardSessions.length} sessions after activation decision ${activationDecisionDate}; ${minimumForwardSessions} required`);
  }
}

function assertSourceCalendarHorizon(contract, retrievalDateUtc,
  minimumFutureSessions = REQUIRED_FUTURE_SOURCE_SESSIONS) {
  if (!contract || !contract.calendars || !exactDate(retrievalDateUtc)
      || !Number.isInteger(minimumFutureSessions) || minimumFutureSessions < 1) {
    throw new Error('source-calendar horizon requires an exact date and positive future-session count');
  }
  for (const [calendarId, calendar] of Object.entries(contract.calendars)) {
    const currentLocalDate = calendarLocalDate(calendar, retrievalDateUtc);
    const completed = calendar.sessions.filter(date => date < currentLocalDate);
    if (!completed.length) throw new Error(`${calendarId}: frozen source calendar has no completed boundary session`);
    const boundary = completed.at(-1);
    const futureSessions = calendar.sessions.filter(date => date > boundary);
    if (futureSessions.length < minimumFutureSessions) {
      throw new Error(`${calendarId}: frozen source calendar has only ${futureSessions.length} future sessions after ${boundary}; ${minimumFutureSessions} required`);
    }
  }
}

function fearGreedProjection(markets) {
  return Object.fromEntries(common.MARKET_ORDER.map(key => {
    const market = markets[key];
    return [key, {
      key: market.key,
      name: market.name,
      currency: market.currency,
      indexSymbol: market.indexSymbol,
      history: market.history.map(row => ({
        date: row.date,
        n: row.n,
        parts: Object.fromEntries(model.COMPONENT_KEYS.map(component => [component, {
          score: row.parts[component].score,
          raw: row.parts[component].raw,
          asOf: row.parts[component].asOf,
        }])),
      })),
    }];
  }));
}

async function fetchYahooChart(symbol, range, retrievalDateUtc) {
  const period2 = Math.floor(Date.parse(`${retrievalDateUtc}T00:00:00.000Z`) / 1000) + 86400;
  const query = range === 'max'
    ? `period1=0&period2=${period2}&interval=1d&events=div%2Csplits`
    : `range=${encodeURIComponent(range)}&interval=1d&events=div%2Csplits`;
  let lastError;
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const response = await fetch(`https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`, {
        headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
        signal: AbortSignal.timeout(25000),
      });
      if (!response.ok) throw new Error(`${symbol}: Yahoo HTTP ${response.status}`);
      const bytes = await common.readResponseBodyLimited(response, common.MAX_RAW_BYTES,
        `${symbol} Yahoo chart`);
      return { ...parseYahooChart(bytes, symbol, retrievalDateUtc),
        acceptedRequestOrdinal: response.__captureOrdinal };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function alignMarketRows(market, target, cash, maxCarryDays = 7,
  minimumRows = model.MIN_MATURED_ROWS + 126, targetCalendar = null) {
  if (!market || !Array.isArray(market.history)) throw new Error('market history is missing');
  const histories = market.history.filter(row => row && row.n === 6 && row.parts
    && model.COMPONENT_KEYS.every(key => row.parts[key] && Number.isFinite(row.parts[key].score)));
  if (!histories.length) throw new Error(`${market.key || market.name}: no six-component history`);
  const cashByDate = new Map(cash.rows.map(row => [row.date, row]));
  const targetByDate = new Map(target.rows.map(row => [row.date, row]));
  let pointer = 0;
  let latest = null;
  const rows = [];
  const calendar = targetCalendar || target.rows.map(row => row.date);
  for (const targetDate of calendar) {
    const targetRow = targetByDate.get(targetDate) || { date: targetDate, adjustedClose: null };
    while (pointer < histories.length && histories[pointer].date <= targetRow.date) {
      latest = histories[pointer];
      pointer += 1;
    }
    if (!latest) continue;
    const cashRow = cashByDate.get(targetRow.date);
    let components = Object.fromEntries(model.COMPONENT_KEYS.map(key => [key, null]));
    let componentAsOf = Object.fromEntries(model.COMPONENT_KEYS.map(key => [key, null]));
    const candidateComponents = {};
    const candidateComponentAsOf = {};
    let componentVectorValid = daysBetween(latest.date, targetRow.date) <= maxCarryDays;
    for (const key of model.COMPONENT_KEYS) {
      const part = latest.parts[key];
      if (!part || !Number.isFinite(part.score) || part.score < 0 || part.score > 100
          || typeof part.asOf !== 'string' || part.asOf > targetRow.date
          || daysBetween(part.asOf, targetRow.date) > maxCarryDays) {
        componentVectorValid = false;
        break;
      }
      candidateComponents[key] = part.score;
      candidateComponentAsOf[key] = part.asOf;
    }
    if (componentVectorValid) {
      components = candidateComponents;
      componentAsOf = candidateComponentAsOf;
    }
    rows.push({
      date: targetRow.date,
      targetClose: Number.isFinite(targetRow.adjustedClose) && targetRow.adjustedClose > 0
        ? targetRow.adjustedClose : null,
      cashClose: cashRow ? cashRow.adjustedClose : null,
      referenceDate: componentVectorValid ? latest.date : null,
      components,
      componentAsOf,
      availableAtUtc: null,
    });
  }
  if (rows.length < minimumRows) {
    throw new Error(`${market.key || market.name}: only ${rows.length} aligned rows`);
  }
  return rows;
}

function persistCapturedRequests(lockboxRoot, requests) {
  const receipts = [];
  try {
    for (const request of requests) {
      const receipt = {
        requestOrdinal: request.requestOrdinal,
        phase: request.phase,
        method: request.method,
        url: request.url,
        startedAtUtc: request.startedAtUtc,
        completedAtUtc: request.completedAtUtc,
        status: request.status,
        responseUrl: request.responseUrl,
        headers: request.headers,
        acceptedFor: [...(request.acceptedFor || [])],
        error: request.error,
      };
      if (Buffer.isBuffer(request.bytes)) {
        const raw = common.createRawBlob(lockboxRoot, request.bytes);
        Object.assign(receipt, {
          path: raw.path,
          rawSha256: raw.rawSha256,
          rawBytes: raw.rawBytes,
          gzipSha256: raw.gzipSha256,
          gzipBytes: raw.gzipBytes,
        });
      }
      receipts.push(receipt);
    }
    return receipts;
  } catch (error) {
    error.persistedReceipts = receipts;
    throw error;
  }
}

async function acquireAlignedData({ range = 'max', retrievalDateUtc = null,
  sourceIdentityContract = null } = {}) {
  const date = retrievalDateUtc || new Date().toISOString().slice(0, 10);
  if (!exactDate(date)) throw new Error(`invalid retrieval date ${date}`);
  const frozenSources = validateSourceIdentityContract(
    sourceIdentityContract || loadSourceIdentityContract(),
  );
  const nativeFetch = global.fetch;
  const capture = installFetchCapture(nativeFetch,
    range === '5y' ? sourceRequestInitiationDeadlineUtc(date) : null);
  global.fetch = capture.capturedFetch;
  try {
    const config = JSON.parse(fs.readFileSync(path.join(common.ROOT, 'data', 'config.json'), 'utf8'));
    const frozenScore = frozenV2ScoreConfig(config.marketFearGreed, range);
    const marketfg = require('../marketfg');
    const componentSymbols = [...new Set(Object.values(frozenScore.markets)
      .flatMap(market => Object.values(market.symbols || {})
        .flatMap(spec => marketfg.collectSpecSymbols(spec))))];
    capture.setPhase('COMPONENT');
    marketfg.clearCache();
    const result = await marketfg.getMarketFearGreedResearchHistory({
      ...frozenScore,
      includeHistoryParts: true,
    });
    const returnedKeys = Object.keys(result.markets || {}).sort();
    if (!result.ok || JSON.stringify(returnedKeys) !== JSON.stringify([...common.MARKET_ORDER].sort())
        || Object.keys(result.failed || {}).length || Object.keys(result.symbolErrors || {}).length) {
      throw new Error(`Fear & Greed acquisition incomplete: ${JSON.stringify({
        returnedKeys, failed: result.failed, symbolErrors: result.symbolErrors,
      })}`);
    }
    for (const key of common.MARKET_ORDER) {
      const market = result.markets[key];
      if (market.n !== 6 || market.total !== 6 || market.stale || market.intraday
          || !market.history.every(row => !row.parts || model.COMPONENT_KEYS.every(
            component => row.parts[component] && Number.isFinite(row.parts[component].score),
          ))) throw new Error(`${key}: incomplete, stale, or intraday Fear & Greed result`);
    }
    const uniqueSymbols = [...new Set([
      ...common.MARKET_ORDER.map(key => common.TARGETS[key].symbol), common.CASH.symbol,
    ])];
    const targetRange = range;
    const componentSelections = componentSymbols.map(symbol => {
      const matches = capture.requests.filter(request => request.phase === 'COMPONENT'
        && receiptSymbol(request) === symbol);
      if (matches.length !== 1 || !(matches[0].status >= 200 && matches[0].status < 300)
          || !Buffer.isBuffer(matches[0].bytes)) {
        throw new Error(`${symbol}: component source request identity is not unique and successful`);
      }
      const acceptedFor = `COMPONENT:${symbol}`;
      matches[0].acceptedFor.push(acceptedFor);
      return { role: 'COMPONENT', symbol, requestedRange: range,
        requestOrdinal: matches[0].requestOrdinal, acceptedFor };
    });
    capture.setPhase('EXECUTABLE');
    const settlements = await Promise.allSettled(
      uniqueSymbols.map(symbol => fetchYahooChart(symbol, targetRange, date)),
    );
    const failures = settlements.map((settlement, index) => ({ settlement, symbol: uniqueSymbols[index] }))
      .filter(item => item.settlement.status === 'rejected');
    if (failures.length) {
      throw new AggregateError(failures.map(item => item.settlement.reason),
        `executable acquisition failed after all requests settled: ${failures.map(item => item.symbol).join(',')}`);
    }
    const series = settlements.map(settlement => settlement.value);
    const seriesBySymbol = new Map(series.map(item => [item.symbol, item]));
    const cash = seriesBySymbol.get(common.CASH.symbol);
    const targetCalendar = frozenTargetCalendar(frozenSources, date);
    const executableSelections = series.map(item => {
      const request = capture.requests[item.acceptedRequestOrdinal];
      if (!request) throw new Error(`${item.symbol}: accepted executable receipt is missing`);
      const acceptedFor = item.symbol === common.CASH.symbol
        ? `CASH:${item.symbol}` : `TARGET:${item.symbol}`;
      request.acceptedFor.push(acceptedFor);
      return { role: item.symbol === common.CASH.symbol ? 'CASH' : 'TARGET',
        symbol: item.symbol, requestedRange: targetRange,
        requestOrdinal: item.acceptedRequestOrdinal, acceptedFor };
    });
    const markets = {};
    for (const key of common.MARKET_ORDER) {
      const mapping = common.TARGETS[key];
      const target = seriesBySymbol.get(mapping.symbol);
      const rows = alignMarketRows(
        result.markets[key], target, cash, 7,
        range === 'max' ? model.MIN_MATURED_ROWS + 126 : 2,
        targetCalendar.filter(targetDate => targetDate >= target.rows[0].date),
      );
      markets[key] = {
        key,
        name: result.markets[key].name,
        marketClass: mapping.marketClass,
        sentimentReferenceId: result.markets[key].indexSymbol,
        targetId: mapping.symbol,
        targetName: mapping.name,
        cashId: common.CASH.symbol,
        targetMetadata: {
          providerSymbol: target.providerSymbol,
          currency: target.currency,
          exchange: target.exchange,
          timezone: target.timezone,
          instrumentType: target.instrumentType,
          firstTradeDate: target.firstTradeDate,
          adjusted: target.adjusted,
          sourceRows: target.rows.length,
        },
        rows,
      };
    }
    return {
      acquiredAtUtc: new Date().toISOString(),
      retrievalDateUtc: date,
      range,
      markets,
      requests: capture.requests,
      sourceSelections: [...componentSelections, ...executableSelections],
      cashMetadata: {
        providerSymbol: cash.providerSymbol,
        currency: cash.currency,
        exchange: cash.exchange,
        timezone: cash.timezone,
        instrumentType: cash.instrumentType,
        firstTradeDate: cash.firstTradeDate,
        adjusted: cash.adjusted,
        sourceRows: cash.rows.length,
      },
      targetCalendarSha256: model.hashCanonical(targetCalendar),
      marketfgNormalizedSha256: model.hashCanonical(fearGreedProjection(result.markets)),
    };
  } catch (error) {
    error.capturedRequests = capture.requests;
    error.acquiredAtUtc = new Date().toISOString();
    throw error;
  } finally {
    global.fetch = nativeFetch;
  }
}

function receiptSymbol(receipt) {
  let url;
  try { url = new URL(receipt.url); } catch { return null; }
  const match = url.pathname.match(/^\/v8\/finance\/chart\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function requestMatchesRange(receipt, range) {
  const url = new URL(receipt.url);
  return range === 'max' ? url.searchParams.get('period1') === '0'
    : url.searchParams.get('range') === range;
}

function exactUtc(value) {
  return typeof value === 'string'
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && new Date(value).toISOString() === value;
}

function isCompletedJsonReceipt(receipt) {
  return receipt && receipt.status === 200 && receipt.error === null
    && typeof receipt.path === 'string' && receipt.responseUrl === receipt.url
    && Number.isInteger(receipt.rawBytes) && receipt.rawBytes > 0
    && receipt.headers && typeof receipt.headers['content-type'] === 'string'
    && /^application\/json(?:\s*;|$)/i.test(receipt.headers['content-type']);
}

function expectedSourceContract(range) {
  const config = JSON.parse(fs.readFileSync(path.join(common.ROOT, 'data', 'config.json'), 'utf8'));
  const marketfg = require('../marketfg');
  const componentSymbols = [...new Set(Object.values(config.marketFearGreed.markets)
    .flatMap(market => Object.values(market.symbols || {})
      .flatMap(spec => marketfg.collectSpecSymbols(spec))))];
  const executableSymbols = [...new Set([
    ...common.MARKET_ORDER.map(key => common.TARGETS[key].symbol), common.CASH.symbol,
  ])];
  const targetRange = range;
  return {
    config,
    marketfg,
    componentSymbols,
    executableSymbols,
    targetRange,
    selections: [
      ...componentSymbols.map(symbol => ({ role: 'COMPONENT', symbol, requestedRange: range,
        acceptedFor: `COMPONENT:${symbol}` })),
      ...executableSymbols.map(symbol => ({ role: symbol === common.CASH.symbol ? 'CASH' : 'TARGET',
        symbol, requestedRange: targetRange,
        acceptedFor: symbol === common.CASH.symbol ? `CASH:${symbol}` : `TARGET:${symbol}` })),
    ],
  };
}

function validateReceiptUrl(receipt, requestedRange, retrievalDateUtc) {
  if (receipt.method !== 'GET') throw new Error(`receipt ${receipt.requestOrdinal}: method is not GET`);
  let url;
  try { url = new URL(receipt.url); } catch { throw new Error(`receipt ${receipt.requestOrdinal}: invalid URL`); }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.port !== ''
      || url.hash !== '' || !['query1.finance.yahoo.com', 'query2.finance.yahoo.com'].includes(url.hostname)) {
    throw new Error(`receipt ${receipt.requestOrdinal}: unexpected Yahoo host/protocol`);
  }
  const symbol = receiptSymbol(receipt);
  if (!symbol) throw new Error(`receipt ${receipt.requestOrdinal}: invalid chart path`);
  if (url.pathname !== `/v8/finance/chart/${encodeURIComponent(symbol)}`) {
    throw new Error(`receipt ${receipt.requestOrdinal}: non-canonical chart path`);
  }
  if (Number.isInteger(receipt.status)) {
    if (receipt.responseUrl !== receipt.url) {
      throw new Error(`receipt ${receipt.requestOrdinal}: redirected or unbound final response URL`);
    }
  } else if (receipt.responseUrl !== null) {
    throw new Error(`receipt ${receipt.requestOrdinal}: network failure has a response URL`);
  }
  const allowed = new Set(requestedRange === 'max'
    ? ['period1', 'period2', 'interval', ...(receipt.phase === 'EXECUTABLE' ? ['events'] : [])]
    : ['range', 'interval', ...(receipt.phase === 'EXECUTABLE' ? ['events'] : [])]);
  const keys = [...url.searchParams.keys()];
  if (keys.length !== allowed.size || keys.some(key => !allowed.has(key))) {
    throw new Error(`receipt ${receipt.requestOrdinal}: unexpected query contract`);
  }
  if (url.searchParams.get('interval') !== '1d' || !requestMatchesRange(receipt, requestedRange)) {
    throw new Error(`receipt ${receipt.requestOrdinal}: range/interval mismatch`);
  }
  if (requestedRange === 'max') {
    const period2 = Number(url.searchParams.get('period2'));
    const lower = Date.parse(`${retrievalDateUtc}T00:00:00.000Z`) / 1000;
    const exactExecutable = lower + 86400;
    const expectedComponent = Math.floor(Date.parse(receipt.startedAtUtc) / 1000) + 86400;
    const validPeriod2 = receipt.phase === 'EXECUTABLE'
      ? period2 === exactExecutable : Math.abs(period2 - expectedComponent) <= 1;
    if (!Number.isInteger(period2) || !validPeriod2) {
      throw new Error(`receipt ${receipt.requestOrdinal}: max period2 is outside retrieval window`);
    }
  }
  if (receipt.phase === 'EXECUTABLE') {
    if (url.searchParams.get('events') !== 'div,splits') {
      throw new Error(`receipt ${receipt.requestOrdinal}: executable events query mismatch`);
    }
  } else if (url.searchParams.has('events')) {
    throw new Error(`receipt ${receipt.requestOrdinal}: component query unexpectedly requests events`);
  }
  const query = requestedRange === 'max'
    ? `period1=0&period2=${url.searchParams.get('period2')}&interval=1d`
    : `range=${encodeURIComponent(requestedRange)}&interval=1d`;
  const expectedUrl = `https://${url.hostname}/v8/finance/chart/${encodeURIComponent(symbol)}?${query}`
    + (receipt.phase === 'EXECUTABLE' ? '&events=div%2Csplits' : '');
  if (receipt.url !== expectedUrl) {
    throw new Error(`receipt ${receipt.requestOrdinal}: URL bytes are not the exact canonical request`);
  }
  return { url, symbol };
}

function replayAlignedDataFromReceipts({ receipts, sourceSelections, loadRaw, range, retrievalDateUtc,
  sourceIdentityContract }) {
  if (!Array.isArray(receipts) || !receipts.length || !Array.isArray(sourceSelections)
      || typeof loadRaw !== 'function' || !['max', '5y'].includes(range)
      || !exactDate(retrievalDateUtc)) {
    throw new Error('raw receipts, role selections, range, retrieval date, and loader are required');
  }
  const identities = validateSourceIdentityContract(sourceIdentityContract);
  const contract = expectedSourceContract(range);
  let previousStartedAtUtc = null;
  let executablePhaseStarted = false;
  for (let ordinal = 0; ordinal < receipts.length; ordinal += 1) {
    const receipt = receipts[ordinal];
    if (!receipt || receipt.requestOrdinal !== ordinal || !['COMPONENT', 'EXECUTABLE'].includes(receipt.phase)) {
      throw new Error(`raw receipt ordinal/phase mismatch at ${ordinal}`);
    }
    if (!exactUtc(receipt.startedAtUtc) || !exactUtc(receipt.completedAtUtc)
        || receipt.completedAtUtc < receipt.startedAtUtc) {
      throw new Error(`receipt ${ordinal}: invalid request timing`);
    }
    if (receipt.startedAtUtc.slice(0, 10) !== retrievalDateUtc
        || receipt.completedAtUtc.slice(0, 10) !== retrievalDateUtc) {
      throw new Error(`receipt ${ordinal}: request timing is outside retrieval UTC date`);
    }
    if (previousStartedAtUtc !== null && receipt.startedAtUtc < previousStartedAtUtc) {
      throw new Error(`receipt ${ordinal}: request starts are not ordinal-monotone`);
    }
    previousStartedAtUtc = receipt.startedAtUtc;
    if (receipt.phase === 'EXECUTABLE') executablePhaseStarted = true;
    else if (executablePhaseStarted) throw new Error(`receipt ${ordinal}: component phase resumed after executable phase`);
    if (!Array.isArray(receipt.acceptedFor)) throw new Error(`receipt ${ordinal}: acceptedFor must be an array`);
  }
  const expectedSelections = contract.selections;
  if (sourceSelections.length !== expectedSelections.length) throw new Error('source selection count mismatch');
  const selectedByIdentity = new Map();
  const selectedOrdinals = new Set();
  for (let index = 0; index < expectedSelections.length; index += 1) {
    const expected = expectedSelections[index];
    const actual = sourceSelections[index];
    for (const key of ['role', 'symbol', 'requestedRange', 'acceptedFor']) {
      if (!actual || actual[key] !== expected[key]) throw new Error(`source selection ${index}: ${key} mismatch`);
    }
    if (!Number.isInteger(actual.requestOrdinal) || !receipts[actual.requestOrdinal]) {
      throw new Error(`source selection ${index}: invalid request ordinal`);
    }
    const receipt = receipts[actual.requestOrdinal];
    if (selectedOrdinals.has(actual.requestOrdinal)) {
      throw new Error(`source selection ${index}: response ordinal is selected more than once`);
    }
    if (!isCompletedJsonReceipt(receipt)
        || receipt.acceptedFor.length !== 1 || receipt.acceptedFor[0] !== expected.acceptedFor) {
      throw new Error(`source selection ${index}: selected response is not uniquely accepted and archived`);
    }
    selectedOrdinals.add(actual.requestOrdinal);
    selectedByIdentity.set(`${expected.role}:${expected.symbol}`, receipt);
  }
  const componentReceipts = receipts.filter(receipt => receipt.phase === 'COMPONENT');
  if (componentReceipts.length !== contract.componentSymbols.length) {
    throw new Error('component request inventory count mismatch');
  }
  for (let index = 0; index < componentReceipts.length; index += 1) {
    const receipt = componentReceipts[index];
    const expectedSymbol = contract.componentSymbols[index];
    const parsedUrl = validateReceiptUrl(receipt, range, retrievalDateUtc);
    if (parsedUrl.url.hostname !== 'query1.finance.yahoo.com' || parsedUrl.symbol !== expectedSymbol
        || !isCompletedJsonReceipt(receipt)
        || receipt.acceptedFor[0] !== `COMPONENT:${expectedSymbol}`) {
      throw new Error(`component receipt ${index}: inventory/order/success mismatch`);
    }
  }
  const executableReceipts = receipts.filter(receipt => receipt.phase === 'EXECUTABLE');
  const latestComponentCompletion = componentReceipts.reduce((latest, receipt) => (
    receipt.completedAtUtc > latest ? receipt.completedAtUtc : latest
  ), '0000-01-01T00:00:00.000Z');
  const firstExecutableStart = executableReceipts.reduce((earliest, receipt) => (
    receipt.startedAtUtc < earliest ? receipt.startedAtUtc : earliest
  ), '9999-12-31T23:59:59.999Z');
  if (latestComponentCompletion > firstExecutableStart) {
    throw new Error('executable acquisition began before every component request completed');
  }
  const executableBySymbol = new Map(contract.executableSymbols.map(symbol => [symbol, []]));
  for (const receipt of executableReceipts) {
    const symbol = receiptSymbol(receipt);
    if (!executableBySymbol.has(symbol)) throw new Error(`unexpected executable receipt symbol ${symbol}`);
    executableBySymbol.get(symbol).push(receipt);
  }
  for (const symbol of contract.executableSymbols) {
    const group = executableBySymbol.get(symbol);
    if (group.length < 1 || group.length > 2) throw new Error(`${symbol}: executable attempt count mismatch`);
    group.forEach((receipt, index) => {
      const parsedUrl = validateReceiptUrl(receipt, contract.targetRange, retrievalDateUtc);
      const expectedHost = index === 0 ? 'query1.finance.yahoo.com' : 'query2.finance.yahoo.com';
      if (parsedUrl.symbol !== symbol || parsedUrl.url.hostname !== expectedHost) {
        throw new Error(`${symbol}: executable fallback order mismatch`);
      }
    });
    if (group.length === 2 && group[1].startedAtUtc < group[0].completedAtUtc) {
      throw new Error(`${symbol}: query2 fallback started before query1 completed`);
    }
    const selected = selectedByIdentity.get(`${symbol === common.CASH.symbol ? 'CASH' : 'TARGET'}:${symbol}`);
    if (selected !== group.at(-1) || !isCompletedJsonReceipt(selected)) {
      throw new Error(`${symbol}: selected executable response is not the final successful attempt`);
    }
    for (const earlier of group.slice(0, -1)) {
      if (isCompletedJsonReceipt(earlier)) throw new Error(`${symbol}: fallback followed a success`);
      if (earlier.acceptedFor.length) throw new Error(`${symbol}: failed fallback attempt was selected`);
    }
  }

  const parsedCache = new Map();
  function parsed(role, symbol) {
    const cacheKey = `${role}:${symbol}`;
    if (parsedCache.has(cacheKey)) return parsedCache.get(cacheKey);
    const receipt = selectedByIdentity.get(`${role}:${symbol}`);
    if (!receipt) throw new Error(`raw replay missing ${role}:${symbol}`);
    const series = parseYahooChart(loadRaw(receipt), symbol, retrievalDateUtc);
    if (series.providerSymbol !== symbol) throw new Error(`${symbol}: provider symbol mismatch ${series.providerSymbol}`);
    validateSourceIdentity(series, symbol, identities, range === 'max');
    validateSourceCalendar(series, symbol, identities, range, retrievalDateUtc);
    parsedCache.set(cacheKey, series);
    return series;
  }
  const { config, marketfg, componentSymbols } = contract;
  const sourceMap = new Map();
  const componentSeries = new Map();
  for (const symbol of componentSymbols) {
    const source = parsed('COMPONENT', symbol);
    componentSeries.set(symbol, source);
    sourceMap.set(symbol, {
      symbol,
      name: source.name,
      currency: source.currency,
      tz: source.timezone,
      rows: source.rows.map(row => ({ date: row.date, close: row.adjustedClose })),
      adjusted: true,
      intraday: false,
      stale: false,
      completedBeforeLocalDate: retrievalDateUtc,
    });
  }
  const computedMarkets = {};
  const opt = {
    ...frozenV2ScoreConfig(config.marketFearGreed, range),
    includeHistoryParts: true,
    includeExpandingSignal: false,
  };
  for (const key of common.MARKET_ORDER) {
    computedMarkets[key] = marketfg.computeMarket(
      key, config.marketFearGreed.markets[key], sourceMap, opt,
    );
  }
  const targetSeries = new Map();
  for (const symbol of [...new Set([...common.MARKET_ORDER.map(key => common.TARGETS[key].symbol),
    common.CASH.symbol])]) targetSeries.set(symbol,
    parsed(symbol === common.CASH.symbol ? 'CASH' : 'TARGET', symbol));
  const cash = targetSeries.get(common.CASH.symbol);
  for (const symbol of componentSymbols.filter(value => targetSeries.has(value))) {
    assertEquivalentSeriesOverlap(componentSeries.get(symbol), targetSeries.get(symbol), symbol);
  }
  const targetCalendar = frozenTargetCalendar(identities, retrievalDateUtc);
  const markets = {};
  for (const key of common.MARKET_ORDER) {
    const mapping = common.TARGETS[key];
    const target = targetSeries.get(mapping.symbol);
    markets[key] = {
      key,
      name: computedMarkets[key].name,
      marketClass: mapping.marketClass,
      sentimentReferenceId: computedMarkets[key].indexSymbol,
      targetId: mapping.symbol,
      targetName: mapping.name,
      cashId: common.CASH.symbol,
        targetMetadata: {
        providerSymbol: target.providerSymbol,
        currency: target.currency,
        exchange: target.exchange,
          timezone: target.timezone,
          instrumentType: target.instrumentType,
          firstTradeDate: target.firstTradeDate,
        adjusted: target.adjusted,
        sourceRows: target.rows.length,
      },
      rows: alignMarketRows(computedMarkets[key], target, cash, 7,
        range === 'max' ? model.MIN_MATURED_ROWS + 126 : 2,
        targetCalendar.filter(targetDate => targetDate >= target.rows[0].date)),
    };
  }
  return {
    range,
    retrievalDateUtc,
    marketfgNormalizedSha256: model.hashCanonical(fearGreedProjection(computedMarkets)),
    sourceSelections,
    cashMetadata: {
      providerSymbol: cash.providerSymbol,
      currency: cash.currency,
      exchange: cash.exchange,
      timezone: cash.timezone,
      instrumentType: cash.instrumentType,
      firstTradeDate: cash.firstTradeDate,
      adjusted: cash.adjusted,
      sourceRows: cash.rows.length,
    },
    targetCalendarSha256: model.hashCanonical(targetCalendar),
    markets,
  };
}

function validatePartialAcquisitionReceipts({ receipts, range, retrievalDateUtc }) {
  if (!Array.isArray(receipts) || !['max', '5y'].includes(range) || !exactDate(retrievalDateUtc)) {
    throw new Error('partial acquisition requires receipts, frozen range, and retrieval date');
  }
  const contract = expectedSourceContract(range);
  let previousStart = null;
  let executableStarted = false;
  receipts.forEach((receipt, ordinal) => {
    if (!receipt || receipt.requestOrdinal !== ordinal || !exactUtc(receipt.startedAtUtc)
        || !exactUtc(receipt.completedAtUtc) || receipt.completedAtUtc < receipt.startedAtUtc
        || receipt.startedAtUtc.slice(0, 10) !== retrievalDateUtc
        || receipt.completedAtUtc.slice(0, 10) !== retrievalDateUtc
        || previousStart !== null && receipt.startedAtUtc < previousStart
        || !Array.isArray(receipt.acceptedFor)) {
      throw new Error(`partial receipt ${ordinal}: ordinal/timing/state mismatch`);
    }
    previousStart = receipt.startedAtUtc;
    if (receipt.phase === 'EXECUTABLE') executableStarted = true;
    else if (receipt.phase !== 'COMPONENT' || executableStarted) {
      throw new Error(`partial receipt ${ordinal}: invalid phase transition`);
    }
  });
  const components = receipts.filter(receipt => receipt.phase === 'COMPONENT');
  if (components.length > contract.componentSymbols.length) throw new Error('partial component inventory is too large');
  components.forEach((receipt, index) => {
    const parsedUrl = validateReceiptUrl(receipt, range, retrievalDateUtc);
    const symbol = contract.componentSymbols[index];
    const expectedLabel = `COMPONENT:${symbol}`;
    if (parsedUrl.symbol !== symbol || parsedUrl.url.hostname !== 'query1.finance.yahoo.com'
        || !(receipt.acceptedFor.length === 0
          || receipt.acceptedFor.length === 1 && receipt.acceptedFor[0] === expectedLabel
            && isCompletedJsonReceipt(receipt))) {
      throw new Error(`partial component receipt ${index}: symbol/host/selection mismatch`);
    }
  });
  const executable = receipts.filter(receipt => receipt.phase === 'EXECUTABLE');
  if (executable.length) {
    if (components.length !== contract.componentSymbols.length
        || components.some((receipt, index) => receipt.acceptedFor[0]
          !== `COMPONENT:${contract.componentSymbols[index]}`)) {
      throw new Error('partial executable phase lacks a complete selected component phase');
    }
    const groups = new Map(contract.executableSymbols.map(symbol => [symbol, []]));
    for (const receipt of executable) {
      const parsedUrl = validateReceiptUrl(receipt, contract.targetRange, retrievalDateUtc);
      if (!groups.has(parsedUrl.symbol)) throw new Error(`partial executable symbol ${parsedUrl.symbol} is not frozen`);
      groups.get(parsedUrl.symbol).push({ receipt, parsedUrl });
    }
    const q1Symbols = executable.filter(receipt => new URL(receipt.url).hostname === 'query1.finance.yahoo.com')
      .map(receiptSymbol);
    if (model.canonicalStringify(q1Symbols)
        !== model.canonicalStringify(contract.executableSymbols.slice(0, q1Symbols.length))) {
      throw new Error('partial executable query1 launch order is not a frozen prefix');
    }
    const acceptedCounts = [];
    for (const symbol of contract.executableSymbols) {
      const group = groups.get(symbol);
      if (group.length > 2) throw new Error(`${symbol}: too many partial executable attempts`);
      group.forEach((item, index) => {
        const expectedHost = index === 0 ? 'query1.finance.yahoo.com' : 'query2.finance.yahoo.com';
        if (item.parsedUrl.url.hostname !== expectedHost) throw new Error(`${symbol}: partial fallback order mismatch`);
      });
      if (group.length === 2 && group[1].receipt.startedAtUtc < group[0].receipt.completedAtUtc) {
        throw new Error(`${symbol}: partial fallback began before query1 completed`);
      }
      const labels = group.filter(item => item.receipt.acceptedFor.length);
      acceptedCounts.push(labels.length);
      if (labels.length > 1) throw new Error(`${symbol}: multiple partial executable selections`);
      if (labels.length === 1) {
        const selected = labels[0].receipt;
        const expectedLabel = symbol === common.CASH.symbol ? `CASH:${symbol}` : `TARGET:${symbol}`;
        if (group.at(-1).receipt !== selected || selected.acceptedFor[0] !== expectedLabel
            || !isCompletedJsonReceipt(selected)) {
          throw new Error(`${symbol}: partial executable selection is not its final JSON response`);
        }
      }
    }
    const selectedTotal = acceptedCounts.reduce((sum, value) => sum + value, 0);
    if (selectedTotal !== 0 && selectedTotal !== contract.executableSymbols.length) {
      throw new Error('partial executable selections must be none or a complete frozen set');
    }
  }
  return true;
}

function assertEquivalentSeriesOverlap(left, right, symbol) {
  const start = left.rows[0].date > right.rows[0].date ? left.rows[0].date : right.rows[0].date;
  const end = left.rows.at(-1).date < right.rows.at(-1).date
    ? left.rows.at(-1).date : right.rows.at(-1).date;
  if (start > end) throw new Error(`${symbol}: duplicated roles have no common date range`);
  for (const key of ['providerSymbol', 'currency', 'exchange', 'timezone', 'instrumentType',
    'firstTradeDate', 'adjusted']) {
    if (left[key] !== right[key]) throw new Error(`${symbol}: duplicated roles disagree on ${key}`);
  }
  const projection = series => series.rows.filter(row => row.date >= start && row.date <= end)
    .map(row => ({ date: row.date, adjustedClose: row.adjustedClose }));
  if (model.canonicalStringify(projection(left)) !== model.canonicalStringify(projection(right))) {
    throw new Error(`${symbol}: duplicated component/target roles disagree over their exact overlap`);
  }
}

function gitValue(args) {
  return childProcess.execFileSync('git', args, { cwd: common.ROOT, encoding: 'utf8' }).trim();
}

function assertCleanCommittedFiles(relativePaths) {
  const status = gitValue(['status', '--porcelain=v1', '--untracked-files=all']);
  if (status !== '') throw new Error('seed creation requires a completely clean worktree');
  for (const relativePath of relativePaths) {
    gitValue(['ls-files', '--error-unmatch', '--', relativePath]);
    const committed = childProcess.execFileSync('git', ['show', `HEAD:${relativePath}`], { cwd: common.ROOT });
    const current = fs.readFileSync(path.join(common.ROOT, relativePath));
    if (!committed.equals(current)) throw new Error(`${relativePath}: committed bytes differ from worktree`);
  }
}

const FROZEN_UPSTREAM_MARKET_MAPPINGS = Object.freeze({
  crypto: Object.freeze({
    barPolicy: 'completed-utc-date',
    symbols: Object.freeze({
      index: Object.freeze({ id: 'CRYPTO-BROAD-EW', name: 'Broad crypto equal-weight basket', method: 'equalWeightReturns', currency: 'USD', timezone: 'UTC', symbols: Object.freeze(['BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'ADA-USD', 'DOGE-USD', 'BNB-USD']) }),
      vol: null, bond: 'IEF', hy: 'HYG', ig: 'LQD',
      small: Object.freeze({ id: 'CRYPTO-NONCORE-EW', name: 'Non-core crypto equal-weight basket', method: 'equalWeightReturns', currency: 'USD', timezone: 'UTC', symbols: Object.freeze(['SOL-USD', 'XRP-USD', 'ADA-USD', 'DOGE-USD', 'BNB-USD']) }),
      large: Object.freeze({ id: 'CRYPTO-CORE-EW', name: 'BTC and ETH equal-weight core basket', method: 'equalWeightReturns', currency: 'USD', timezone: 'UTC', symbols: Object.freeze(['BTC-USD', 'ETH-USD']) }),
    }),
  }),
  sweden: Object.freeze({ barPolicy: null, symbols: Object.freeze({ index: '^OMXSBGI', vol: null, bond: 'XACT-OBLIGATION.ST', hy: '0P0001C87Y.ST', ig: '0P00000KIW.ST', small: 'XACT-SMABOLAG.ST', large: 'XACT-SVERIGE.ST' }) }),
  usa: Object.freeze({ barPolicy: null, symbols: Object.freeze({ index: 'SPY', vol: '^VIX', bond: 'IEF', hy: 'HYG', ig: 'LQD', small: 'IWM', large: null }) }),
  ustech: Object.freeze({ barPolicy: null, symbols: Object.freeze({ index: 'XLK', vol: '^VXN', bond: 'IEF', hy: 'HYG', ig: 'LQD', small: 'RSPT', large: null }) }),
  europe: Object.freeze({ barPolicy: null, symbols: Object.freeze({ index: '^STOXX', vol: null, bond: 'SXRQ.DE', hy: 'IHYG.L', ig: 'IEAC.L', small: 'EXSE.DE', large: 'EXSA.DE' }) }),
  global: Object.freeze({ barPolicy: null, symbols: Object.freeze({ index: 'ACWI', vol: '^VIX', bond: 'IEF', hy: 'HYLD.L', ig: 'CORP.L', small: 'WSML.L', large: 'IWDA.L' }) }),
});

function upstreamMappingProjection(markets) {
  return Object.fromEntries(common.MARKET_ORDER.map(key => [key, {
    barPolicy: (markets && markets[key] && markets[key].barPolicy) || null,
    symbols: markets && markets[key] && markets[key].symbols,
  }]));
}

function frozenV2ScoreConfig(score, range = 'max') {
  if (!score || !['max', '5y'].includes(range)
      || model.hashCanonical(upstreamMappingProjection(score.markets))
        !== model.hashCanonical(FROZEN_UPSTREAM_MARKET_MAPPINGS)) {
    throw new Error('PLS1_UPSTREAM_SCORE_MODEL_V2_REQUIRED: frozen upstream market mapping drift');
  }
  return {
    modelId: 'investments-unified-fear-greed',
    version: 2,
    range,
    window: 252,
    minWindowPoints: 126,
    // computeMarket prefers these newer aliases when present in module defaults;
    // pin both names so a future public default cannot alter frozen v2 replay.
    strengthWindow: 252,
    percentileMinPoints: 126,
    minComponents: 6,
    fillDays: 7,
    markets: score.markets,
  };
}

function assertFrozenUpstreamScoreModel(scoreOverride = null) {
  const score = scoreOverride || (JSON.parse(fs.readFileSync(path.join(common.ROOT, 'data', 'config.json'), 'utf8')).marketFearGreed || {});
  const hasNewAliases = ['percentileMode', 'strengthWindow', 'percentileMinPoints']
    .some(key => Object.prototype.hasOwnProperty.call(score, key));
  if (score.modelId !== 'investments-unified-fear-greed'
      || Number(score.version) !== 2
      || hasNewAliases
      || score.range !== 'max'
      || Number(score.window) !== 252
      || Number(score.minWindowPoints) !== 126
      || Number(score.minComponents) !== 6
      || Number(score.fillDays) !== 7
      || model.hashCanonical(upstreamMappingProjection(score.markets))
        !== model.hashCanonical(FROZEN_UPSTREAM_MARKET_MAPPINGS)) {
    throw new Error('PLS1_UPSTREAM_SCORE_MODEL_V2_REQUIRED: the frozen PLS1 protocol cannot ingest production Fear & Greed v3');
  }
  return true;
}

async function buildSeed({ lockboxRoot = common.LOCKBOX_ROOT, retrievalDateUtc = null } = {}) {
  const seedPath = path.join(lockboxRoot, 'freeze', 'seed.json');
  if (fs.existsSync(seedPath)) throw new Error('seed already exists; it is immutable');
  assertFrozenUpstreamScoreModel();
  if (common.isProductionLockboxRoot(lockboxRoot)) {
    if (process.env.PLS1_RAW_ARCHIVE_RIGHTS_CONFIRMED !== 'YES') {
      throw new Error('raw-response archival is blocked until source storage/redistribution rights are confirmed');
    }
    const { PINNED_FILES } = require('./create-pls1-lockbox-manifest');
    assertCleanCommittedFiles(PINNED_FILES);
    common.assertRequiredRuntime();
  }
  const sourceIdentityContract = loadSourceIdentityContract();
  const effectiveRetrievalDate = retrievalDateUtc || new Date().toISOString().slice(0, 10);
  assertSourceCalendarHorizon(sourceIdentityContract, effectiveRetrievalDate);
  const acquired = await acquireAlignedData({ range: 'max', retrievalDateUtc: effectiveRetrievalDate,
    sourceIdentityContract });
  const sourceReceipts = persistCapturedRequests(lockboxRoot, acquired.requests);
  const replay = replayAlignedDataFromReceipts({
    receipts: sourceReceipts,
    sourceSelections: acquired.sourceSelections,
    loadRaw: receipt => common.verifyRawBlob(lockboxRoot, receipt),
    range: acquired.range,
    retrievalDateUtc: acquired.retrievalDateUtc,
    sourceIdentityContract,
  });
  if (model.canonicalStringify(replay.markets) !== model.canonicalStringify(acquired.markets)
      || replay.marketfgNormalizedSha256 !== acquired.marketfgNormalizedSha256
      || replay.targetCalendarSha256 !== acquired.targetCalendarSha256
      || model.canonicalStringify(replay.cashMetadata) !== model.canonicalStringify(acquired.cashMetadata)) {
    throw new Error('live acquisition does not byte-replay from role-bound response receipts');
  }
  const markets = acquired.markets;
  const firstProspectiveDecisionMustBeAfter = Object.fromEntries(common.MARKET_ORDER.map(key => [
    key, markets[key].rows.at(-1).date,
  ]));
  const seed = {
    schema: 'fg-control-residual-pls1-seed-v1',
    status: 'PRE_ACTIVATION_WARMUP_ONLY_NOT_VALIDATION_EVIDENCE',
    lockboxId: common.LOCKBOX_ID,
    modelId: model.MODEL_ID,
    createdAtUtc: acquired.acquiredAtUtc,
    retrievalDateUtc: acquired.retrievalDateUtc,
    sourceCommitSha: gitValue(['rev-parse', 'HEAD']),
    sourceTreeSha: gitValue(['rev-parse', 'HEAD^{tree}']),
    sourceRuntime: common.runtimeIdentity(),
    sourceIdentityContract,
    sourceIdentityContractSha256: model.hashCanonical(sourceIdentityContract),
    marketOrder: common.MARKET_ORDER,
    componentOrder: model.COMPONENT_KEYS,
    cash: common.CASH,
    cashMetadata: acquired.cashMetadata,
    marketfgNormalizedSha256: acquired.marketfgNormalizedSha256,
    targetCalendarSha256: acquired.targetCalendarSha256,
    firstProspectiveDecisionMustBeAfter,
    sourceSelections: acquired.sourceSelections,
    sourceReceipts,
    markets,
  };
  const written = common.createCanonicalWithSidecar(seedPath, seed);
  process.stdout.write(`${JSON.stringify({
    seedPath: path.relative(common.ROOT, seedPath).replace(/\\/g, '/'),
    seedSha256: written.sha256,
    markets: Object.fromEntries(common.MARKET_ORDER.map(key => [key, {
      rows: markets[key].rows.length,
      first: markets[key].rows[0].date,
      last: markets[key].rows.at(-1).date,
    }])),
    rawResponses: sourceReceipts.length,
  }, null, 2)}\n`);
  return { seed, written };
}

async function main() {
  const dateArg = process.argv.find(value => value.startsWith('--retrieval-date='));
  await buildSeed({ retrievalDateUtc: dateArg ? dateArg.split('=')[1] : null });
}

module.exports = Object.freeze({
  USER_AGENT,
  SOURCE_IDENTITY_PATH,
  MIN_LIVE_SOURCE_SESSIONS,
  REQUIRED_FUTURE_SOURCE_SESSIONS,
  REQUIRED_ACTIVATION_FORWARD_SESSIONS,
  daysBetween,
  exactDate,
  SPECIAL_NYSE_CLOSURES,
  nyseHolidaySet,
  isExpectedNyseSession,
  validateTargetCalendar,
  installFetchCapture,
  parseYahooChart,
  validateMaximumHistory,
  requiredSourceSymbols,
  validateSourceIdentityContract,
  loadSourceIdentityContract,
  validateSourceIdentity,
  validateSourceCalendar,
  frozenTargetCalendar,
  frozenTargetCalendarSessions,
  assertSourceCalendarHorizon,
  assertActivationForwardHorizon,
  sourceRequestInitiationDeadlineUtc,
  fetchYahooChart,
  alignMarketRows,
  fearGreedProjection,
  persistCapturedRequests,
  acquireAlignedData,
  receiptSymbol,
  requestMatchesRange,
  exactUtc,
  isCompletedJsonReceipt,
  expectedSourceContract,
  validateReceiptUrl,
  assertEquivalentSeriesOverlap,
  replayAlignedDataFromReceipts,
  validatePartialAcquisitionReceipts,
  assertCleanCommittedFiles,
  assertFrozenUpstreamScoreModel,
  frozenV2ScoreConfig,
  buildSeed,
});

if (require.main === module) {
  main().catch(error => {
    process.stderr.write(`PLS1 seed failed: ${error.stack || error.message}\n`);
    process.exit(1);
  });
}
