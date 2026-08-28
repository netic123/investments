'use strict';

const crypto = require('node:crypto');

// The frozen runtime contract starts this module in a clean pinned Node
// process. Capture security-critical intrinsics once so later same-process
// prototype/property mutation cannot change hashes, snapshots, or gates.
const NATIVE_ARRAY_SORT = Function.prototype.call.bind(Array.prototype.sort);
const NATIVE_BUFFER_ALLOC_UNSAFE = Buffer.allocUnsafe;
const NATIVE_BUFFER_FROM = Buffer.from;
const NATIVE_BUFFER_READ_BIG_UINT64_BE = Function.prototype.call.bind(
  Buffer.prototype.readBigUInt64BE,
);
const NATIVE_BUFFER_WRITE_DOUBLE_BE = Function.prototype.call.bind(Buffer.prototype.writeDoubleBE);
const NATIVE_CRYPTO_CREATE_HASH = crypto.createHash.bind(crypto);
const NATIVE_CRYPTO_HASH_DIGEST = Function.prototype.call.bind(crypto.Hash.prototype.digest);
const NATIVE_CRYPTO_HASH_UPDATE = Function.prototype.call.bind(crypto.Hash.prototype.update);
const NATIVE_JSON_STRINGIFY = JSON.stringify;
const NATIVE_NUMBER_IS_FINITE = Number.isFinite;
const NATIVE_OBJECT_FREEZE = Object.freeze;
const NATIVE_OBJECT_IS_FROZEN = Object.isFrozen;
const NATIVE_OBJECT_VALUES = Object.values;

const MODEL_ID = 'FG-CONTROL-RESIDUAL-PLS1-PREQ-V1';
const SCHEMA_VERSION = 1;
const PROTOCOL_FREEZE_MARKER = 'FROZEN_BEFORE_PROSPECTIVE_OUTCOME_2026_08_28_V1';
const MIN_MATURED_ROWS = 252;
const CURRENT_Z_LIMIT = 5;
const MAX_CURRENT_CONTROL_MAHALANOBIS_RADIUS = 5;
const MAX_CURRENT_PLS_SCORE_Z = 5;
const EXACT_DYADIC_COMPARISON_POLICY = 'EXACT_DYADIC_FINAL_BINARY64_V1';
const NUMERIC_TOLERANCE = 1e-12;
const NORMAL_EQUATION_TOLERANCE = 1e-9;
// The fit solves a standardized normal matrix. This conservative, scale-free
// gate keeps its infinity-norm condition number below 1/sqrt(binary64 epsilon),
// so a merely finite solution cannot masquerade as a numerically stable one.
const MAX_CONTROL_NORMAL_CONDITION_INFINITY = 67108864;
const WARMUP_REASON = 'WARMUP_BUY_BASELINE';
const INVALID_REASON = 'FAIL_CLOSED_DATA_INVALID';
const ZERO_FACTOR_REASON = 'VALID_NESTED_NULL_ZERO_FACTOR';

const COMPONENT_KEYS = NATIVE_OBJECT_FREEZE([
  'momentum', 'strength', 'volatility', 'safeHaven', 'credit', 'breadth',
]);
const CONTROL_KEYS = NATIVE_OBJECT_FREEZE([
  'target_log_return_1',
  'target_log_return_5',
  'target_log_return_20',
  'target_log_return_volatility_20',
  'target_log_level_to_mean_125',
]);
const COSTS = NATIVE_OBJECT_FREEZE({
  crypto: NATIVE_OBJECT_FREEZE({ primary: 0.0025, stress: 0.0075 }),
  equity: NATIVE_OBJECT_FREEZE({ primary: 0.001, stress: 0.0025 }),
});
const NORMALIZED_MARKETS = new WeakSet();
const GENUINE_DECISIONS = new WeakSet();
const NATIVE_WEAKSET_HAS = Function.prototype.call.bind(WeakSet.prototype.has);
const NATIVE_WEAKSET_ADD = Function.prototype.call.bind(WeakSet.prototype.add);
const NATIVE_ARRAY_IS_ARRAY = Array.isArray;
const NATIVE_OBJECT_CREATE = Object.create;
const NATIVE_OBJECT_DEFINE_PROPERTY = Object.defineProperty;
const NATIVE_OBJECT_GET_PROTOTYPE_OF = Object.getPrototypeOf;
const NATIVE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR = Object.getOwnPropertyDescriptor;
const NATIVE_REFLECT_OWN_KEYS = Reflect.ownKeys;
const NATIVE_HAS_OWN = Function.prototype.call.bind(Object.prototype.hasOwnProperty);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function finite(value) {
  return typeof value === 'number' && NATIVE_NUMBER_IS_FINITE(value);
}

function exactIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return NATIVE_NUMBER_IS_FINITE(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

function exactUtc(value) {
  if (typeof value !== 'string'
      || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  return NATIVE_NUMBER_IS_FINITE(Date.parse(value)) && new Date(value).toISOString() === value;
}

function exactUtcOrNull(value) {
  return value === null || exactUtc(value);
}

function calendarDaysBetween(earlier, later) {
  return (Date.parse(`${later}T00:00:00.000Z`) - Date.parse(`${earlier}T00:00:00.000Z`)) / 86400000;
}

function canonicalizeValue(value, ancestors) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    assert(NATIVE_NUMBER_IS_FINITE(value), 'Canonical JSON rejects non-finite numbers');
    return Object.is(value, -0) ? 0 : value;
  }
  if (NATIVE_ARRAY_IS_ARRAY(value)) {
    assert(NATIVE_OBJECT_GET_PROTOTYPE_OF(value) === Array.prototype,
      'Canonical JSON requires a plain array');
    assert(!ancestors.has(value), 'Canonical JSON rejects cyclic values');
    ancestors.add(value);
    try {
      const ownKeys = NATIVE_REFLECT_OWN_KEYS(value);
      assert(ownKeys.every(key => typeof key === 'string'),
        'Canonical JSON rejects symbol properties');
      const lengthDescriptor = NATIVE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, 'length');
      assert(lengthDescriptor && NATIVE_HAS_OWN(lengthDescriptor, 'value')
        && Number.isSafeInteger(lengthDescriptor.value) && lengthDescriptor.value >= 0,
      'Canonical JSON requires an exact array length data property');
      const length = lengthDescriptor.value;
      assert(ownKeys.length === length + 1 && ownKeys.includes('length'),
        'Canonical JSON requires a dense array with no extra properties');
      const result = new Array(length);
      for (let index = 0; index < length; index += 1) {
        const key = String(index);
        const descriptor = NATIVE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
        assert(descriptor && descriptor.enumerable && NATIVE_HAS_OWN(descriptor, 'value'),
          'Canonical JSON requires dense array data properties');
        NATIVE_OBJECT_DEFINE_PROPERTY(result, key, {
          value: canonicalizeValue(descriptor.value, ancestors),
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  }
  if (value && typeof value === 'object') {
    const prototype = NATIVE_OBJECT_GET_PROTOTYPE_OF(value);
    assert(prototype === Object.prototype || prototype === null,
      'Canonical JSON requires a plain object');
    assert(!ancestors.has(value), 'Canonical JSON rejects cyclic values');
    ancestors.add(value);
    try {
      const ownKeys = NATIVE_REFLECT_OWN_KEYS(value);
      assert(ownKeys.every(key => typeof key === 'string'),
        'Canonical JSON rejects symbol properties');
      const result = NATIVE_OBJECT_CREATE(null);
      for (const key of NATIVE_ARRAY_SORT(ownKeys)) {
        assert(!['__proto__', 'constructor', 'prototype'].includes(key),
          `Canonical JSON rejects dangerous property name ${key}`);
        const descriptor = NATIVE_OBJECT_GET_OWN_PROPERTY_DESCRIPTOR(value, key);
        assert(descriptor && descriptor.enumerable && NATIVE_HAS_OWN(descriptor, 'value'),
          `Canonical JSON requires enumerable data property ${key}`);
        NATIVE_OBJECT_DEFINE_PROPERTY(result, key, {
          value: canonicalizeValue(descriptor.value, ancestors),
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      return result;
    } finally {
      ancestors.delete(value);
    }
  }
  throw new Error(`Canonical JSON rejects ${typeof value}`);
}

function canonicalize(value) {
  return canonicalizeValue(value, new WeakSet());
}

function canonicalStringify(value) {
  return `${NATIVE_JSON_STRINGIFY(canonicalize(value))}\n`;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || NATIVE_OBJECT_IS_FROZEN(value)) return value;
  for (const child of NATIVE_OBJECT_VALUES(value)) deepFreeze(child);
  return NATIVE_OBJECT_FREEZE(value);
}

function sha256Bytes(bytes) {
  return NATIVE_CRYPTO_HASH_DIGEST(
    NATIVE_CRYPTO_HASH_UPDATE(NATIVE_CRYPTO_CREATE_HASH('sha256'), bytes), 'hex',
  );
}

function hashCanonical(value) {
  return sha256Bytes(NATIVE_BUFFER_FROM(canonicalStringify(value)));
}

function populationStandardDeviation(values) {
  if (!Array.isArray(values) || values.length === 0 || !values.every(finite)) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / values.length;
  return Math.sqrt(Math.max(0, variance));
}

function extractComponents(sourceComponents) {
  if (Array.isArray(sourceComponents)) {
    if (sourceComponents.length !== COMPONENT_KEYS.length) {
      return Array(COMPONENT_KEYS.length).fill(null);
    }
    return COMPONENT_KEYS.map((unused, component) => {
      const value = sourceComponents[component];
      return finite(value) ? value : null;
    });
  }
  const source = sourceComponents && typeof sourceComponents === 'object' ? sourceComponents : {};
  assert(NATIVE_JSON_STRINGIFY(NATIVE_ARRAY_SORT(Object.keys(source)))
    === NATIVE_JSON_STRINGIFY(NATIVE_ARRAY_SORT([...COMPONENT_KEYS])),
    'components must contain exactly the six frozen component keys');
  return COMPONENT_KEYS.map(key => {
    const value = source[key];
    return finite(value) ? value : null;
  });
}

function normalizeMarket(input) {
  assert(input && typeof input === 'object', 'Market input is required');
  const sourceRows = input.rows;
  assert(Array.isArray(sourceRows) && sourceRows.length > 0, 'Market requires rows');
  const rowCount = sourceRows.length;
  const rows = [];
  for (let index = 0; index < rowCount; index += 1) {
    const source = sourceRows[index];
    assert(source && typeof source === 'object', `Row ${index} must be an object`);
    const date = source.date;
    assert(exactIsoDate(date), `Row ${index} has invalid date`);
    if (index > 0) assert(rows[index - 1].date < date, 'Rows must be strictly increasing');
    const targetClose = source.targetClose;
    assert(targetClose === null || (finite(targetClose) && targetClose > 0),
      `Row ${date} targetClose must be positive or null`);
    const cashClose = source.cashClose;
    assert(cashClose === null || (finite(cashClose) && cashClose > 0),
      `Row ${date} cashClose must be positive or null`);
    const sourceAvailableAtUtc = source.availableAtUtc;
    const availableAtUtc = sourceAvailableAtUtc == null ? null : sourceAvailableAtUtc;
    assert(exactUtcOrNull(availableAtUtc),
      `Row ${date} has invalid availableAtUtc`);
    if (availableAtUtc !== null) {
      assert(index === rowCount - 1,
        'Only the current final row may carry live availability');
    }
    const components = extractComponents(source.components);
    const hasAnyFiniteComponent = components.some(finite);
    const referenceDate = source.referenceDate;
    if (hasAnyFiniteComponent) {
      assert(exactIsoDate(referenceDate) && referenceDate <= date
        && calendarDaysBetween(referenceDate, date) <= 7,
      `Row ${date} has invalid or stale referenceDate`);
    } else {
      assert(referenceDate === null,
        `Row ${date} with no usable component vector requires null referenceDate`);
    }
    const sourceComponentAsOf = source.componentAsOf;
    assert(sourceComponentAsOf && typeof sourceComponentAsOf === 'object',
      `Row ${date} requires componentAsOf`);
    assert(NATIVE_JSON_STRINGIFY(NATIVE_ARRAY_SORT(Object.keys(sourceComponentAsOf)))
      === NATIVE_JSON_STRINGIFY(NATIVE_ARRAY_SORT([...COMPONENT_KEYS])),
    `Row ${date} componentAsOf must contain exactly the six frozen component keys`);
    const componentAsOf = {};
    COMPONENT_KEYS.forEach((key, component) => {
      const asOf = sourceComponentAsOf[key];
      if (finite(components[component])) {
        assert(exactIsoDate(asOf) && asOf <= date
          && calendarDaysBetween(asOf, date) <= 7,
        `Row ${date} ${key} has invalid, future, or stale componentAsOf`);
        componentAsOf[key] = asOf;
      } else {
        assert(asOf == null, `Row ${date} ${key} invalid component must have null componentAsOf`);
        componentAsOf[key] = null;
      }
    });
    rows.push(NATIVE_OBJECT_FREEZE({
      date,
      targetClose,
      cashClose,
      referenceDate,
      components: NATIVE_OBJECT_FREEZE(components),
      componentAsOf: NATIVE_OBJECT_FREEZE(componentAsOf),
      availableAtUtc,
    }));
  }
  const marketClass = input.marketClass;
  assert(marketClass === 'crypto' || marketClass === 'equity',
    'Market class must be exactly crypto or equity');
  const inputKey = input.key;
  const inputName = input.name;
  const inputTargetId = input.targetId;
  const inputCashId = input.cashId;
  const normalized = deepFreeze({
    schemaVersion: SCHEMA_VERSION,
    key: String(inputKey || inputTargetId || 'market'),
    name: String(inputName || inputKey || inputTargetId || 'Market'),
    targetId: String(inputTargetId || inputKey || 'target'),
    cashId: String(inputCashId || 'BIL'),
    marketClass,
    rows,
  });
  NATIVE_WEAKSET_ADD(NORMALIZED_MARKETS, normalized);
  return normalized;
}

function buildFeatureObservation(input, index, asOfIndex = null) {
  const market = NATIVE_WEAKSET_HAS(NORMALIZED_MARKETS, input) ? input : normalizeMarket(input);
  assert(Number.isInteger(index) && index >= 0 && index < market.rows.length,
    'Feature index is out of range');
  const informationEnd = asOfIndex == null ? market.rows.length - 1 : asOfIndex;
  assert(Number.isInteger(informationEnd) && informationEnd >= index
    && informationEnd < market.rows.length, 'Feature asOfIndex is out of range');
  const row = market.rows[index];
  const invalidControls = [];
  if (!(finite(row.targetClose) && row.targetClose > 0)) {
    invalidControls.push('target_close:REQUIRES_POSITIVE_COMPLETED_SESSION_VALUE');
  }

  function logReturn(lag, name) {
    if (index < lag) {
      invalidControls.push(`${name}:INSUFFICIENT_HISTORY`);
      return null;
    }
    const earlier = market.rows[index - lag].targetClose;
    if (!(finite(row.targetClose) && row.targetClose > 0 && finite(earlier) && earlier > 0)) {
      invalidControls.push(`${name}:MISSING_NONPOSITIVE_CLOSE`);
      return null;
    }
    const value = Math.log(row.targetClose / earlier);
    if (!finite(value)) invalidControls.push(`${name}:NON_FINITE`);
    return finite(value) ? value : null;
  }

  const r1 = logReturn(1, CONTROL_KEYS[0]);
  const r5 = logReturn(5, CONTROL_KEYS[1]);
  const r20 = logReturn(20, CONTROL_KEYS[2]);
  let vol20 = null;
  if (index < 20) invalidControls.push(`${CONTROL_KEYS[3]}:INSUFFICIENT_HISTORY`);
  else {
    const returns = [];
    for (let cursor = index - 19; cursor <= index; cursor += 1) {
      const currentClose = market.rows[cursor].targetClose;
      const previousClose = market.rows[cursor - 1].targetClose;
      if (!(finite(currentClose) && currentClose > 0 && finite(previousClose) && previousClose > 0)) {
        returns.push(null);
      } else returns.push(Math.log(currentClose / previousClose));
    }
    vol20 = populationStandardDeviation(returns);
    if (!finite(vol20)) invalidControls.push(`${CONTROL_KEYS[3]}:NON_FINITE`);
  }
  let trend125 = null;
  if (index < 124) invalidControls.push(`${CONTROL_KEYS[4]}:INSUFFICIENT_HISTORY`);
  else {
    let sum = 0;
    let complete = true;
    for (let cursor = index - 124; cursor <= index; cursor += 1) {
      const close = market.rows[cursor].targetClose;
      if (!(finite(close) && close > 0)) complete = false;
      else sum += close;
    }
    trend125 = complete ? Math.log(row.targetClose / (sum / 125)) : null;
    if (!finite(trend125)) invalidControls.push(`${CONTROL_KEYS[4]}:NON_FINITE`);
  }
  const controls = [r1, r5, r20, vol20, trend125];
  const invalidComponents = [];
  if (!(finite(row.cashClose) && row.cashClose > 0)) {
    invalidComponents.push('cash_close:REQUIRES_EXACT_POSITIVE_SAME_SESSION_VALUE');
  }
  row.components.forEach((value, component) => {
    if (!finite(value) || value < 0 || value > 100) {
      invalidComponents.push(`${COMPONENT_KEYS[component]}:REQUIRES_FINITE_0_TO_100`);
    }
  });
  return NATIVE_OBJECT_FREEZE({
    featureIndex: index,
    featureDate: row.date,
    maturityIndex: index + 2,
    maturityDate: index + 2 <= informationEnd ? market.rows[index + 2].date : null,
    controls: NATIVE_OBJECT_FREEZE(controls),
    components: row.components,
    controlsValid: invalidControls.length === 0 && controls.every(finite),
    componentsValid: invalidComponents.length === 0,
    valid: invalidControls.length === 0 && controls.every(finite) && invalidComponents.length === 0,
    invalidReasons: NATIVE_OBJECT_FREEZE([...invalidControls, ...invalidComponents]),
  });
}

function computeForwardLabel(input, featureIndex, asOfIndex = Infinity) {
  const market = NATIVE_WEAKSET_HAS(NORMALIZED_MARKETS, input) ? input : normalizeMarket(input);
  assert(Number.isInteger(featureIndex) && featureIndex >= 0, 'featureIndex must be non-negative');
  const maturity = featureIndex + 2;
  if (maturity >= market.rows.length || maturity > asOfIndex) return null;
  const execution = market.rows[featureIndex + 1];
  const end = market.rows[maturity];
  if (!(finite(execution.targetClose) && execution.targetClose > 0
      && finite(end.targetClose) && end.targetClose > 0
      && finite(execution.cashClose) && execution.cashClose > 0
      && finite(end.cashClose) && end.cashClose > 0)) return null;
  const value = Math.log(end.targetClose / execution.targetClose)
    - Math.log(end.cashClose / execution.cashClose);
  return finite(value) ? value : null;
}

function solveLinearSystem(matrix, vector, tolerance = NUMERIC_TOLERANCE) {
  if (!Array.isArray(matrix) || !Array.isArray(vector)
      || matrix.length !== vector.length || matrix.some(row => !Array.isArray(row)
        || row.length !== vector.length || !row.every(finite))
      || !vector.every(finite)) return null;
  const n = vector.length;
  const augmented = matrix.map((row, index) => [...row, vector[index]]);
  for (let pivot = 0; pivot < n; pivot += 1) {
    let best = pivot;
    for (let row = pivot + 1; row < n; row += 1) {
      if (Math.abs(augmented[row][pivot]) > Math.abs(augmented[best][pivot])) best = row;
    }
    if (!(Math.abs(augmented[best][pivot]) > tolerance)) return null;
    if (best !== pivot) [augmented[pivot], augmented[best]] = [augmented[best], augmented[pivot]];
    const divisor = augmented[pivot][pivot];
    for (let column = pivot; column <= n; column += 1) augmented[pivot][column] /= divisor;
    for (let row = 0; row < n; row += 1) {
      if (row === pivot) continue;
      const multiplier = augmented[row][pivot];
      for (let column = pivot; column <= n; column += 1) {
        augmented[row][column] -= multiplier * augmented[pivot][column];
      }
    }
  }
  const solution = augmented.map(row => row[n]);
  return solution.every(finite) ? solution : null;
}

function matrixInfinityNorm(matrix) {
  if (!Array.isArray(matrix) || matrix.length === 0
      || matrix.some(row => !Array.isArray(row) || row.length !== matrix.length
        || !row.every(finite))) return null;
  const norm = Math.max(...matrix.map(row => row.reduce(
    (sum, value) => sum + Math.abs(value), 0,
  )));
  return finite(norm) ? norm : null;
}

function matrixConditionInfinity(matrix) {
  const norm = matrixInfinityNorm(matrix);
  if (!(finite(norm) && norm > 0)) return null;
  const n = matrix.length;
  const inverseColumns = [];
  for (let column = 0; column < n; column += 1) {
    const basis = Array(n).fill(0);
    basis[column] = 1;
    const solution = solveLinearSystem(matrix, basis);
    if (!solution) return null;
    inverseColumns.push(solution);
  }
  const inverse = Array.from({ length: n }, (unused, row) => (
    inverseColumns.map(column => column[row])
  ));
  const inverseNorm = matrixInfinityNorm(inverse);
  const condition = norm * inverseNorm;
  return finite(condition) ? condition : null;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + (value * right[index]), 0);
}

function binary64Dyadic(value) {
  assert(finite(value), 'Exact dyadic conversion requires a finite binary64 value');
  if (value === 0) return NATIVE_OBJECT_FREEZE({ numerator: 0n, exponent: 0 });
  const bytes = NATIVE_BUFFER_ALLOC_UNSAFE(8);
  NATIVE_BUFFER_WRITE_DOUBLE_BE(bytes, value, 0);
  const bits = NATIVE_BUFFER_READ_BIG_UINT64_BE(bytes, 0);
  const negative = (bits >> 63n) !== 0n;
  const exponentBits = Number((bits >> 52n) & 0x7ffn);
  const fraction = bits & ((1n << 52n) - 1n);
  let numerator = exponentBits === 0 ? fraction : (1n << 52n) + fraction;
  let exponent = exponentBits === 0 ? -1074 : exponentBits - 1023 - 52;
  while (numerator !== 0n && (numerator & 1n) === 0n) {
    numerator >>= 1n;
    exponent += 1;
  }
  if (negative) numerator = -numerator;
  return NATIVE_OBJECT_FREEZE({ numerator, exponent });
}

function nonnegativeDyadicLessThanOrEqual(leftNumerator, leftExponent,
  rightNumerator, rightExponent) {
  assert(typeof leftNumerator === 'bigint' && leftNumerator >= 0n
    && Number.isInteger(leftExponent) && typeof rightNumerator === 'bigint'
    && rightNumerator >= 0n && Number.isInteger(rightExponent),
  'Exact dyadic comparison requires nonnegative integer significands and integer exponents');
  const commonExponent = Math.min(leftExponent, rightExponent);
  const exactLeft = leftNumerator << BigInt(leftExponent - commonExponent);
  const exactRight = rightNumerator << BigInt(rightExponent - commonExponent);
  return exactLeft <= exactRight;
}

function integerizeBinary64Values(values) {
  if (!Array.isArray(values) || !values.every(finite)) return null;
  const dyadics = values.map(binary64Dyadic);
  const nonzero = dyadics.filter(value => value.numerator !== 0n);
  const commonExponent = nonzero.length === 0
    ? 0 : Math.min(...nonzero.map(value => value.exponent));
  const integers = dyadics.map(value => (value.numerator === 0n
    ? 0n : value.numerator << BigInt(value.exponent - commonExponent)));
  return { integers, commonExponent };
}

function bareissDeterminant(integerMatrix) {
  if (!Array.isArray(integerMatrix)
      || integerMatrix.some(row => !Array.isArray(row)
        || row.length !== integerMatrix.length
        || row.some(value => typeof value !== 'bigint'))) return null;
  const n = integerMatrix.length;
  if (n === 0) return 1n;
  if (n === 1) return integerMatrix[0][0];
  const work = integerMatrix.map(row => [...row]);
  let sign = 1n;
  let previousPivot = 1n;
  for (let pivotIndex = 0; pivotIndex < n - 1; pivotIndex += 1) {
    let pivotRow = pivotIndex;
    while (pivotRow < n && work[pivotRow][pivotIndex] === 0n) pivotRow += 1;
    if (pivotRow === n) return 0n;
    if (pivotRow !== pivotIndex) {
      [work[pivotIndex], work[pivotRow]] = [work[pivotRow], work[pivotIndex]];
      sign = -sign;
    }
    const pivot = work[pivotIndex][pivotIndex];
    for (let row = pivotIndex + 1; row < n; row += 1) {
      for (let column = pivotIndex + 1; column < n; column += 1) {
        const numerator = (work[row][column] * pivot)
          - (work[row][pivotIndex] * work[pivotIndex][column]);
        if (numerator % previousPivot !== 0n) return null;
        work[row][column] = numerator / previousPivot;
      }
      work[row][pivotIndex] = 0n;
    }
    previousPivot = pivot;
  }
  return sign * work[n - 1][n - 1];
}

function integerAdjugate(integerMatrix) {
  const determinant = bareissDeterminant(integerMatrix);
  if (determinant === null || determinant === 0n) return null;
  const n = integerMatrix.length;
  const adjugate = Array.from({ length: n }, () => Array(n).fill(0n));
  for (let removedRow = 0; removedRow < n; removedRow += 1) {
    for (let removedColumn = 0; removedColumn < n; removedColumn += 1) {
      const minor = integerMatrix
        .filter((unused, row) => row !== removedRow)
        .map(row => row.filter((unused, column) => column !== removedColumn));
      const minorDeterminant = bareissDeterminant(minor);
      if (minorDeterminant === null) return null;
      adjugate[removedColumn][removedRow] = (removedRow + removedColumn) % 2 === 0
        ? minorDeterminant : -minorDeterminant;
    }
  }
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < n; column += 1) {
      let product = 0n;
      for (let inner = 0; inner < n; inner += 1) {
        product += integerMatrix[row][inner] * adjugate[inner][column];
      }
      if (product !== (row === column ? determinant : 0n)) return null;
    }
  }
  return { determinant, adjugate };
}

function maximumAbsoluteIntegerRowSum(matrix) {
  return matrix.reduce((maximum, row) => {
    const sum = row.reduce((total, value) => total + (value < 0n ? -value : value), 0n);
    return sum > maximum ? sum : maximum;
  }, 0n);
}

function certifyExactControlNormal(normal) {
  if (!Array.isArray(normal) || normal.length === 0
      || normal.some(row => !Array.isArray(row) || row.length !== normal.length
        || !row.every(finite))) {
    return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'INVALID_EXACT_CONTROL_NORMAL_INPUT' });
  }
  const flattened = integerizeBinary64Values(normal.flat());
  if (!flattened) return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'INVALID_EXACT_CONTROL_NORMAL_INPUT' });
  const dimension = normal.length;
  const integerMatrix = Array.from({ length: dimension }, (unused, row) => (
    flattened.integers.slice(row * dimension, (row + 1) * dimension)
  ));
  const inverseIdentity = integerAdjugate(integerMatrix);
  if (!inverseIdentity) {
    return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'EXACT_CONTROL_NORMAL_SINGULAR_OR_UNCERTIFIED' });
  }
  const determinant = inverseIdentity.determinant;
  const absoluteDeterminant = determinant < 0n ? -determinant : determinant;
  const matrixMaximumRowSum = maximumAbsoluteIntegerRowSum(integerMatrix);
  const adjugateMaximumRowSum = maximumAbsoluteIntegerRowSum(inverseIdentity.adjugate);
  const conditionNumerator = matrixMaximumRowSum * adjugateMaximumRowSum;
  const conditionMaximumScaledDeterminant = BigInt(MAX_CONTROL_NORMAL_CONDITION_INFINITY)
    * absoluteDeterminant;
  const conditionWithinRange = conditionNumerator <= conditionMaximumScaledDeterminant;
  const provenance = {
    schema: 'fg-control-residual-pls1-exact-control-normal-certificate-v1',
    policy: EXACT_DYADIC_COMPARISON_POLICY,
    dimension,
    finalBinary64MatrixSha256: hashCanonical(normal),
    integerMatrixSha256: hashCanonical(integerMatrix.map(row => row.map(String))),
    commonBinaryExponent: flattened.commonExponent,
    determinant: determinant.toString(),
    adjugateSha256: hashCanonical(inverseIdentity.adjugate.map(row => row.map(String))),
    inverseIdentityVerified: true,
    conditionNumerator: conditionNumerator.toString(),
    conditionMaximumScaledDeterminant: conditionMaximumScaledDeterminant.toString(),
    conditionWithinRange,
  };
  provenance.certificateSha256 = hashCanonical(provenance);
  return deepFreeze({
    ok: true,
    commonBinaryExponent: flattened.commonExponent,
    integerMatrix,
    determinant,
    adjugate: inverseIdentity.adjugate,
    conditionWithinRange,
    provenance,
  });
}

function certifyExactCurrentControlMahalanobisFromNormal(controlCertificate, currentDesign) {
  if (!controlCertificate || controlCertificate.ok !== true
      || !Array.isArray(currentDesign)
      || currentDesign.length !== controlCertificate.integerMatrix.length
      || !currentDesign.every(finite)) {
    return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'INVALID_EXACT_CURRENT_CONTROL_INPUT' });
  }
  const integerized = integerizeBinary64Values(currentDesign);
  if (!integerized) return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'INVALID_EXACT_CURRENT_CONTROL_INPUT' });
  let quadraticNumerator = 0n;
  for (let row = 0; row < integerized.integers.length; row += 1) {
    for (let column = 0; column < integerized.integers.length; column += 1) {
      quadraticNumerator += integerized.integers[row]
        * controlCertificate.adjugate[row][column] * integerized.integers[column];
    }
  }
  let positiveDeterminant = controlCertificate.determinant;
  if (positiveDeterminant < 0n) {
    positiveDeterminant = -positiveDeterminant;
    quadraticNumerator = -quadraticNumerator;
  }
  const quadraticBinaryExponent = (2 * integerized.commonExponent)
    - controlCertificate.commonBinaryExponent;
  const nonnegative = quadraticNumerator >= 0n;
  const withinRange = nonnegative && nonnegativeDyadicLessThanOrEqual(
    quadraticNumerator,
    quadraticBinaryExponent,
    BigInt(MAX_CURRENT_CONTROL_MAHALANOBIS_RADIUS ** 2) * positiveDeterminant,
    0,
  );
  const provenance = {
    schema: 'fg-control-residual-pls1-exact-current-control-certificate-v1',
    policy: EXACT_DYADIC_COMPARISON_POLICY,
    controlNormalCertificateSha256: controlCertificate.provenance.certificateSha256,
    finalBinary64CurrentDesignSha256: hashCanonical(currentDesign),
    integerCurrentDesignSha256: hashCanonical(integerized.integers.map(String)),
    commonBinaryExponent: integerized.commonExponent,
    quadraticNumerator: quadraticNumerator.toString(),
    quadraticBinaryExponent,
    positiveDeterminant: positiveDeterminant.toString(),
    nonnegative,
    maximumSquaredRadius: MAX_CURRENT_CONTROL_MAHALANOBIS_RADIUS ** 2,
    withinRange,
  };
  provenance.certificateSha256 = hashCanonical(provenance);
  return deepFreeze({ ok: true, withinRange, nonnegative, provenance });
}

function certifyExactCurrentControlMahalanobis(normal, currentDesign) {
  const controlCertificate = certifyExactControlNormal(normal);
  if (!controlCertificate.ok) return controlCertificate;
  return certifyExactCurrentControlMahalanobisFromNormal(controlCertificate, currentDesign);
}

function currentPlsScoreWithinRange(currentScore, scoreVariance) {
  if (!finite(currentScore) || !finite(scoreVariance) || scoreVariance < 0) return false;
  const score = binary64Dyadic(Math.abs(currentScore));
  const variance = binary64Dyadic(scoreVariance);
  return nonnegativeDyadicLessThanOrEqual(
    score.numerator * score.numerator,
    2 * score.exponent,
    BigInt(MAX_CURRENT_PLS_SCORE_Z ** 2) * variance.numerator,
    variance.exponent,
  );
}

function calculateCurrentControlMahalanobisRadius(normal, currentDesign) {
  const inverseProduct = solveLinearSystem(normal, currentDesign);
  if (!inverseProduct) return null;
  const squaredRadius = dot(currentDesign, inverseProduct);
  if (!finite(squaredRadius)) return null;
  const radius = Math.sqrt(Math.max(0, squaredRadius));
  return finite(radius) ? radius : null;
}

function currentControlMahalanobisWithinRange(radius) {
  return finite(radius) && radius >= 0
    && radius <= MAX_CURRENT_CONTROL_MAHALANOBIS_RADIUS;
}

function fitControlResidualPls1(trainingRows, currentControls, currentComponents) {
  if (!Array.isArray(trainingRows) || trainingRows.length === 0) {
    return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'NO_TRAINING_ROWS' });
  }
  if (!Array.isArray(currentControls) || currentControls.length !== CONTROL_KEYS.length
      || !Array.isArray(currentComponents) || currentComponents.length !== COMPONENT_KEYS.length) {
    return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'INVALID_CURRENT_FEATURES' });
  }
  currentControls = CONTROL_KEYS.map((unused, column) => currentControls[column]);
  currentComponents = COMPONENT_KEYS.map((unused, column) => currentComponents[column]);
  if (!currentControls.every(finite)
      || !currentComponents.every(value => finite(value) && value >= 0 && value <= 100)) {
    return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'INVALID_CURRENT_FEATURES' });
  }
  const normalizedRows = [];
  for (const row of trainingRows) {
    const sourceControls = row ? row.controls : null;
    const sourceComponents = row ? row.components : null;
    const outcome = row ? row.outcome : null;
    if (!Array.isArray(sourceControls) || sourceControls.length !== CONTROL_KEYS.length
        || !Array.isArray(sourceComponents) || sourceComponents.length !== COMPONENT_KEYS.length
        || !finite(outcome)) return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'INVALID_TRAINING_ROW' });
    const controls = CONTROL_KEYS.map((unused, column) => sourceControls[column]);
    const components = COMPONENT_KEYS.map((unused, column) => sourceComponents[column]);
    if (!controls.every(finite)
        || !components.every(value => finite(value) && value >= 0 && value <= 100)) {
      return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'INVALID_TRAINING_ROW' });
    }
    normalizedRows.push({ controls, components, outcome });
  }
  const n = normalizedRows.length;
  const controlMeans = CONTROL_KEYS.map((unused, column) => normalizedRows.reduce(
    (sum, row) => sum + row.controls[column], 0,
  ) / n);
  const componentMeans = COMPONENT_KEYS.map((unused, column) => normalizedRows.reduce(
    (sum, row) => sum + row.components[column], 0,
  ) / n);
  const controlSds = controlMeans.map((mean, column) => Math.sqrt(normalizedRows.reduce(
    (sum, row) => sum + ((row.controls[column] - mean) ** 2), 0,
  ) / n));
  if (controlSds.some(sd => !finite(sd) || sd <= NUMERIC_TOLERANCE)) {
    return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'CONTROL_VARIANCE_OR_RANK_INVALID' });
  }
  const componentSds = componentMeans.map((mean, column) => Math.sqrt(normalizedRows.reduce(
    (sum, row) => sum + ((row.components[column] - mean) ** 2), 0,
  ) / n));
  if (componentSds.some(sd => !finite(sd))) {
    return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'COMPONENT_VARIANCE_INVALID' });
  }
  const zControls = normalizedRows.map(row => row.controls.map(
    (value, column) => (value - controlMeans[column]) / controlSds[column],
  ));
  const zComponents = normalizedRows.map(row => row.components.map(
    (value, column) => (componentSds[column] <= NUMERIC_TOLERANCE
      ? 0 : (value - componentMeans[column]) / componentSds[column]),
  ));
  const design = zControls.map(row => [1, ...row]);
  const outcomes = normalizedRows.map(row => row.outcome);
  const p = design[0].length;
  const normal = Array.from({ length: p }, () => Array(p).fill(0));
  const rhsY = Array(p).fill(0);
  const rhsX = Array.from({ length: COMPONENT_KEYS.length }, () => Array(p).fill(0));
  for (let row = 0; row < n; row += 1) {
    for (let left = 0; left < p; left += 1) {
      rhsY[left] += design[row][left] * outcomes[row] / n;
      for (let component = 0; component < COMPONENT_KEYS.length; component += 1) {
        rhsX[component][left] += design[row][left] * zComponents[row][component] / n;
      }
      for (let right = 0; right < p; right += 1) {
        normal[left][right] += design[row][left] * design[row][right] / n;
      }
    }
  }
  const exactControlNormalCertificate = certifyExactControlNormal(normal);
  if (!exactControlNormalCertificate.ok) {
    return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'CONTROL_VARIANCE_OR_RANK_INVALID' });
  }
  if (!exactControlNormalCertificate.conditionWithinRange) {
    return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'CONTROL_MATRIX_ILL_CONDITIONED' });
  }
  const controlNormalConditionInfinity = matrixConditionInfinity(normal);
  if (!finite(controlNormalConditionInfinity)) {
    return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'CONTROL_VARIANCE_OR_RANK_INVALID' });
  }
  const alpha = solveLinearSystem(normal, rhsY);
  if (!alpha) return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'CONTROL_VARIANCE_OR_RANK_INVALID' });
  const gammaColumns = rhsX.map(rhs => solveLinearSystem(normal, rhs));
  if (gammaColumns.some(solution => !solution)) {
    return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'CONTROL_VARIANCE_OR_RANK_INVALID' });
  }
  const gamma = Array.from({ length: p }, (unused, row) => gammaColumns.map(column => column[row]));
  const residualY = [];
  const residualX = [];
  for (let row = 0; row < n; row += 1) {
    residualY.push(outcomes[row] - dot(design[row], alpha));
    residualX.push(zComponents[row].map((value, component) => (
      value - dot(design[row], gammaColumns[component])
    )));
  }
  const normalResidualY = Array(p).fill(0);
  const normalResidualX = Array.from({ length: COMPONENT_KEYS.length }, () => Array(p).fill(0));
  for (let row = 0; row < n; row += 1) {
    for (let column = 0; column < p; column += 1) {
      normalResidualY[column] += design[row][column] * residualY[row] / n;
      for (let component = 0; component < COMPONENT_KEYS.length; component += 1) {
        normalResidualX[component][column] += design[row][column] * residualX[row][component] / n;
      }
    }
  }
  const maxNormalError = Math.max(0, ...normalResidualY.map(Math.abs),
    ...normalResidualX.flat().map(Math.abs));
  if (!finite(maxNormalError) || maxNormalError > NORMAL_EQUATION_TOLERANCE) {
    return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'NORMAL_EQUATION_CHECK_FAILED' });
  }
  const g = COMPONENT_KEYS.map((unused, component) => residualX.reduce(
    (sum, row, index) => sum + (row[component] * residualY[index]), 0,
  ) / n);
  const normG = Math.sqrt(dot(g, g));
  if (!finite(normG)) return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'NON_FINITE_PLS_DIRECTION' });
  let weights;
  let q;
  let scoreVariance;
  let zeroFactor = false;
  if (normG === 0) {
    weights = Array(COMPONENT_KEYS.length).fill(0);
    q = 0;
    scoreVariance = 0;
    zeroFactor = true;
  } else {
    weights = g.map(value => value / normG);
    const scores = residualX.map(row => dot(row, weights));
    scoreVariance = scores.reduce((sum, value) => sum + (value ** 2), 0) / n;
    if (scoreVariance < 0 && scoreVariance >= -NUMERIC_TOLERANCE) scoreVariance = 0;
    if (!finite(scoreVariance) || scoreVariance < -NUMERIC_TOLERANCE) {
      return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'INVALID_PLS_SCORE_VARIANCE' });
    }
    if (scoreVariance <= NUMERIC_TOLERANCE) {
      weights = Array(COMPONENT_KEYS.length).fill(0);
      q = 0;
      zeroFactor = true;
    } else {
      const scoreOutcomeCovariance = scores.reduce(
        (sum, score, index) => sum + (score * residualY[index]), 0,
      ) / n;
      q = scoreOutcomeCovariance / scoreVariance;
      if (!finite(q)) return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'NON_FINITE_PLS_COEFFICIENT' });
    }
  }
  const standardizedCurrentControls = currentControls.map((value, column) => clamp(
    (value - controlMeans[column]) / controlSds[column], -CURRENT_Z_LIMIT, CURRENT_Z_LIMIT,
  ));
  const currentDesign = [1, ...standardizedCurrentControls];
  const exactCurrentControlCertificate = certifyExactCurrentControlMahalanobisFromNormal(
    exactControlNormalCertificate, currentDesign,
  );
  if (!exactCurrentControlCertificate.ok || !exactCurrentControlCertificate.withinRange) {
    return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'CURRENT_CONTROL_MAHALANOBIS_OUT_OF_RANGE' });
  }
  const currentControlMahalanobisRadius = calculateCurrentControlMahalanobisRadius(
    normal, currentDesign,
  );
  if (!finite(currentControlMahalanobisRadius) || currentControlMahalanobisRadius < 0) {
    return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'CURRENT_CONTROL_MAHALANOBIS_OUT_OF_RANGE' });
  }
  const standardizedCurrentComponents = currentComponents.map((value, column) => (
    componentSds[column] <= NUMERIC_TOLERANCE ? 0 : clamp(
      (value - componentMeans[column]) / componentSds[column], -CURRENT_Z_LIMIT, CURRENT_Z_LIMIT,
    )
  ));
  const residualCurrentComponents = standardizedCurrentComponents.map((value, component) => (
    value - dot(currentDesign, gammaColumns[component])
  ));
  const predictionM0 = dot(currentDesign, alpha);
  const currentScore = dot(residualCurrentComponents, weights);
  if (!currentPlsScoreWithinRange(currentScore, scoreVariance)) {
    return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'CURRENT_PLS_SCORE_OUT_OF_RANGE' });
  }
  const currentScoreZ = scoreVariance === 0 ? 0 : currentScore / Math.sqrt(scoreVariance);
  const predictionM1 = predictionM0 + (q * currentScore);
  if (![predictionM0, predictionM1, currentScoreZ].every(finite)) {
    return NATIVE_OBJECT_FREEZE({ ok: false, reason: 'NON_FINITE_PREDICTION' });
  }
  const result = {
    ok: true,
    trainingRowCount: n,
    controlMeans,
    controlPopulationStandardDeviations: controlSds,
    componentMeans,
    componentPopulationStandardDeviations: componentSds,
    alpha,
    gamma,
    crossCovariance: g,
    crossCovarianceNorm: normG,
    weights,
    scoreVariance,
    q,
    zeroFactor,
    standardizedCurrentControls,
    currentControlMahalanobisRadius,
    maximumCurrentControlMahalanobisRadius: MAX_CURRENT_CONTROL_MAHALANOBIS_RADIUS,
    exactDyadicComparisonPolicy: EXACT_DYADIC_COMPARISON_POLICY,
    exactControlNormalCertificate: exactControlNormalCertificate.provenance,
    exactCurrentControlMahalanobisCertificate: exactCurrentControlCertificate.provenance,
    standardizedCurrentComponents,
    residualCurrentComponents,
    currentScore,
    currentScoreZ,
    maximumCurrentPlsScoreZ: MAX_CURRENT_PLS_SCORE_Z,
    currentPlsScoreExactSquaredWithinRange: true,
    predictionM0,
    predictionM1,
    controlNormalConditionInfinity,
    maximumNormalEquationResidual: maxNormalError,
  };
  result.fitSha256 = hashCanonical(result);
  return deepFreeze(canonicalize(result));
}

function logCostHurdle(oneWayCost) {
  assert(finite(oneWayCost) && oneWayCost >= 0 && oneWayCost < 1,
    'One-way cost must be in [0,1)');
  return -Math.log(1 - oneWayCost);
}

function chooseBinaryTarget(filledPosition, prediction, stressCost) {
  assert(filledPosition === 'LONG' || filledPosition === 'CASH',
    'Filled position must be LONG or CASH');
  assert(finite(prediction), 'Prediction must be finite');
  const hurdle = logCostHurdle(stressCost);
  if (filledPosition === 'CASH' && prediction > hurdle) return 'LONG';
  if (filledPosition === 'LONG' && prediction < -hurdle) return 'CASH';
  return filledPosition;
}

function buildLatestDecision(input, positions = { M0: 'LONG', M1: 'LONG' }, decisionIndex = null) {
  const market = NATIVE_WEAKSET_HAS(NORMALIZED_MARKETS, input) ? input : normalizeMarket(input);
  const index = decisionIndex == null ? market.rows.length - 1 : decisionIndex;
  assert(Number.isInteger(index) && index >= 0 && index < market.rows.length,
    'decisionIndex is out of range');
  assert(positions, 'Both prior model positions are required');
  const priorPositions = NATIVE_OBJECT_FREEZE({ M0: positions.M0, M1: positions.M1 });
  assert(['LONG', 'CASH'].includes(priorPositions.M0)
    && ['LONG', 'CASH'].includes(priorPositions.M1), 'Both prior model positions are required');
  const current = buildFeatureObservation(market, index, index);
  const trainingRows = [];
  let trainingStartDate = null;
  let trainingEndDate = null;
  let latestMaturedOutcomeClose = null;
  for (let featureIndex = 0; featureIndex + 2 <= index; featureIndex += 1) {
    const feature = buildFeatureObservation(market, featureIndex, index);
    if (!feature.valid) continue;
    const outcome = computeForwardLabel(market, featureIndex, index);
    if (!finite(outcome)) continue;
    trainingRows.push({
      featureIndex,
      featureDate: feature.featureDate,
      executionIndex: featureIndex + 1,
      executionDate: market.rows[featureIndex + 1].date,
      maturityIndex: featureIndex + 2,
      maturityDate: market.rows[featureIndex + 2].date,
      controls: feature.controls,
      components: feature.components,
      outcome,
      featureRowSha256: hashCanonical(market.rows[featureIndex]),
      executionRowSha256: hashCanonical(market.rows[featureIndex + 1]),
      maturityRowSha256: hashCanonical(market.rows[featureIndex + 2]),
    });
    if (trainingStartDate === null) trainingStartDate = feature.featureDate;
    trainingEndDate = feature.featureDate;
    latestMaturedOutcomeClose = market.rows[featureIndex + 2].date;
  }
  let fit = null;
  let fallbackReason = null;
  let predictions = { M0: null, M1: null };
  let targets;
  if (!current.valid) {
    fallbackReason = INVALID_REASON;
    targets = { M0: 'CASH', M1: 'CASH' };
  } else if (trainingRows.length < MIN_MATURED_ROWS) {
    fallbackReason = WARMUP_REASON;
    targets = { M0: 'LONG', M1: 'LONG' };
  } else {
    fit = fitControlResidualPls1(trainingRows, current.controls, current.components);
    if (!fit.ok) {
      fallbackReason = INVALID_REASON;
      targets = { M0: 'CASH', M1: 'CASH' };
    } else {
      predictions = { M0: fit.predictionM0, M1: fit.predictionM1 };
      targets = {
        M0: chooseBinaryTarget(priorPositions.M0, predictions.M0, COSTS[market.marketClass].stress),
        M1: chooseBinaryTarget(priorPositions.M1, predictions.M1, COSTS[market.marketClass].stress),
      };
      if (fit.zeroFactor) fallbackReason = ZERO_FACTOR_REASON;
    }
  }
  const trainingIdentity = hashCanonical(trainingRows);
  function record(model) {
    const targetPosition = targets[model];
    const learnedFromHistory = Boolean(fit && fit.ok);
    const decisionBasis = learnedFromHistory
      ? 'LEARNED_FORECAST_WITH_STATEFUL_COST_HURDLE'
      : fallbackReason === WARMUP_REASON
        ? 'PRE_REGISTERED_WARMUP_POLICY'
        : 'PRE_REGISTERED_FAIL_CLOSED_POLICY';
    const data = {
      schema: 'fg-control-residual-pls1-decision-v1',
      modelId: MODEL_ID,
      modelVersion: SCHEMA_VERSION,
      model,
      market: market.key,
      marketName: market.name,
      marketClass: market.marketClass,
      targetId: market.targetId,
      cashId: market.cashId,
      decisionDate: market.rows[index].date,
      decisionRowIndex: index,
      signalAvailableAtUtc: market.rows[index].availableAtUtc,
      earliestExecutionRule: 'FIRST_TARGET_CLOSE_STRICTLY_AFTER_FEATURE_CLOSE_AND_RECORDED_AVAILABILITY',
      action: targetPosition === 'LONG' ? 'BUY' : 'SELL',
      targetPosition,
      filledPosition: priorPositions[model],
      tradeRequired: targetPosition !== priorPositions[model],
      prediction: predictions[model],
      fallbackReason,
      fitFailureReason: fit && !fit.ok ? fit.reason : null,
      learnedFromHistory,
      decisionBasis,
      currentFeaturesValid: current.valid,
      currentFeatureInvalidReasons: current.invalidReasons,
      trainingRowCount: trainingRows.length,
      trainingStartDate,
      trainingEndDate,
      latestMaturedOutcomeClose,
      allHistoryStart: market.rows[0].date,
      allHistoryEnd: market.rows[index].date,
      allHistoryRows: index + 1,
      learnerTruncatedSuppliedLedger: false,
      sourceHistoryCompleteness: 'REQUIRES_EXTERNAL_LOCKBOX_VERIFICATION',
      trainingRowsSha256: trainingIdentity,
      currentRowSha256: hashCanonical(market.rows[index]),
      fitSha256: fit && fit.ok ? fit.fitSha256 : null,
      zeroFactor: Boolean(fit && fit.ok && fit.zeroFactor),
      evidenceStatus: 'PROSPECTIVE_CANDIDATE_NOT_YET_TRUSTED',
    };
    data.decisionSha256 = hashCanonical(data);
    const decision = deepFreeze(data);
    NATIVE_WEAKSET_ADD(GENUINE_DECISIONS, decision);
    return decision;
  }
  return deepFreeze({
    market,
    feature: current,
    fit,
    trainingRows: NATIVE_OBJECT_FREEZE(trainingRows.map(NATIVE_OBJECT_FREEZE)),
    M0: record('M0'),
    M1: record('M1'),
  });
}

function stampDecisionAvailability(decision, signalAvailableAtUtc) {
  assert(decision && NATIVE_WEAKSET_HAS(GENUINE_DECISIONS, decision),
    'A genuine PLS1 decision record is required');
  assert(exactUtc(signalAvailableAtUtc), 'Stamped signal availability must be exact UTC');
  const data = { ...decision, signalAvailableAtUtc };
  delete data.decisionSha256;
  data.decisionSha256 = hashCanonical(data);
  const stamped = deepFreeze(canonicalize(data));
  NATIVE_WEAKSET_ADD(GENUINE_DECISIONS, stamped);
  return stamped;
}

module.exports = NATIVE_OBJECT_FREEZE({
  MODEL_ID,
  SCHEMA_VERSION,
  PROTOCOL_FREEZE_MARKER,
  MIN_MATURED_ROWS,
  CURRENT_Z_LIMIT,
  MAX_CURRENT_CONTROL_MAHALANOBIS_RADIUS,
  MAX_CURRENT_PLS_SCORE_Z,
  EXACT_DYADIC_COMPARISON_POLICY,
  NUMERIC_TOLERANCE,
  NORMAL_EQUATION_TOLERANCE,
  MAX_CONTROL_NORMAL_CONDITION_INFINITY,
  WARMUP_REASON,
  INVALID_REASON,
  ZERO_FACTOR_REASON,
  COMPONENT_KEYS,
  CONTROL_KEYS,
  COSTS,
  canonicalize,
  canonicalStringify,
  deepFreeze,
  sha256Bytes,
  hashCanonical,
  populationStandardDeviation,
  normalizeMarket,
  buildFeatureObservation,
  computeForwardLabel,
  solveLinearSystem,
  matrixInfinityNorm,
  matrixConditionInfinity,
  binary64Dyadic,
  nonnegativeDyadicLessThanOrEqual,
  bareissDeterminant,
  certifyExactControlNormal,
  certifyExactCurrentControlMahalanobis,
  calculateCurrentControlMahalanobisRadius,
  currentControlMahalanobisWithinRange,
  currentPlsScoreWithinRange,
  fitControlResidualPls1,
  logCostHurdle,
  chooseBinaryTarget,
  buildLatestDecision,
  stampDecisionAvailability,
});
