/**
 * NPC State Alpha — native portable state envelope.
 *
 * This is a deterministic transport wrapper around the canonical Alpha state.
 * It does not create provenance, checkpoints, source history, timestamps, or
 * compatibility mappings. Applying a parsed bundle to a live chat is a separate
 * explicit restore/import operation because source/history ownership must first
 * be reconciled against that host.
 */

import {
  ALPHA_NAMESPACE,
  ALPHA_SCHEMA_VERSION,
  cloneState,
  validateState,
} from './schema.js';

export const ALPHA_NATIVE_BUNDLE_FORMAT = 'npc_state_alpha.native_state';
export const ALPHA_NATIVE_BUNDLE_VERSION = 1;

const ALLOWED_BUNDLE_KEYS = Object.freeze(['format', 'formatVersion', 'state']);

function canonicalizeJson(value) {
  if (Array.isArray(value)) return value.map(canonicalizeJson);
  if (!value || typeof value !== 'object') return value;
  const result = Object.create(null);
  for (const key of Object.keys(value).sort()) {
    result[key] = canonicalizeJson(value[key]);
  }
  return result;
}

function findNonPortableJsonValue(value, path = '$', stack = new WeakSet()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? null : `${path} contains a non-finite number.`;
  }
  if (['undefined', 'function', 'symbol', 'bigint'].includes(typeof value)) {
    return `${path} contains unsupported JSON value type '${typeof value}'.`;
  }
  if (typeof value !== 'object') return `${path} contains an unsupported value.`;
  if (stack.has(value)) return `${path} contains a cyclic reference.`;
  stack.add(value);

  let error = null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        error = `${path}[${index}] is a sparse array slot.`;
        break;
      }
      error = findNonPortableJsonValue(value[index], `${path}[${index}]`, stack);
      if (error) break;
    }
  } else {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      error = `${path} contains non-plain object type '${value.constructor?.name || 'unknown'}'.`;
    } else if (Reflect.ownKeys(value).some((key) => typeof key === 'symbol')) {
      error = `${path} contains a symbol-keyed property.`;
    } else {
      for (const key of Object.keys(value)) {
        error = findNonPortableJsonValue(value[key], `${path}.${key}`, stack);
        if (error) break;
      }
    }
  }

  stack.delete(value);
  return error;
}

/**
 * Validates one native Alpha portable bundle without mutating it.
 */
export function validateAlphaNativeBundle(bundle) {
  const errors = [];
  if (!bundle || typeof bundle !== 'object' || Array.isArray(bundle)) {
    return { valid: false, errors: ['Native bundle root must be a non-null object.'] };
  }

  const portableJsonError = findNonPortableJsonValue(bundle);
  if (portableJsonError) errors.push(`Native bundle is not lossless JSON: ${portableJsonError}`);

  for (const key of Object.keys(bundle)) {
    if (!ALLOWED_BUNDLE_KEYS.includes(key)) {
      errors.push(`Native bundle contains unknown root key '${key}'.`);
    }
  }
  for (const key of ALLOWED_BUNDLE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(bundle, key)) {
      errors.push(`Native bundle is missing required root key '${key}'.`);
    }
  }

  if (bundle.format !== ALPHA_NATIVE_BUNDLE_FORMAT) {
    errors.push(`Unsupported native bundle format '${bundle.format}'. Expected '${ALPHA_NATIVE_BUNDLE_FORMAT}'.`);
  }
  if (bundle.formatVersion !== ALPHA_NATIVE_BUNDLE_VERSION) {
    errors.push(`Unsupported native bundle formatVersion '${bundle.formatVersion}'. Expected ${ALPHA_NATIVE_BUNDLE_VERSION}.`);
  }

  if (bundle.state && typeof bundle.state === 'object' && !Array.isArray(bundle.state)) {
    if (bundle.state.namespace !== ALPHA_NAMESPACE) {
      errors.push(`Native bundle state namespace must be '${ALPHA_NAMESPACE}'.`);
    }
    if (bundle.state.schemaVersion !== ALPHA_SCHEMA_VERSION) {
      errors.push(`Native bundle state schemaVersion must be ${ALPHA_SCHEMA_VERSION}.`);
    }
    const stateValidation = validateState(bundle.state);
    if (!stateValidation.valid) {
      errors.push(...stateValidation.errors.map((error) => `Native bundle state invalid: ${error}`));
    }
  } else {
    errors.push("Native bundle 'state' must be a canonical Alpha state object.");
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Wraps one already-valid canonical state without adding synthetic metadata.
 */
export function createAlphaNativeBundle(state) {
  const validation = validateState(state);
  if (!validation.valid) {
    throw new Error(`Cannot create Alpha native bundle from invalid state: ${validation.errors.join('; ')}`);
  }
  const portableJsonError = findNonPortableJsonValue(state);
  if (portableJsonError) {
    throw new Error(`Cannot create Alpha native bundle from non-portable state: ${portableJsonError}`);
  }
  return {
    format: ALPHA_NATIVE_BUNDLE_FORMAT,
    formatVersion: ALPHA_NATIVE_BUNDLE_VERSION,
    state: cloneState(state),
  };
}

/**
 * Produces stable JSON bytes for the same canonical state. No generated time or
 * source metadata is added, so serialization is deterministic.
 */
export function serializeAlphaNativeBundle(state) {
  return JSON.stringify(canonicalizeJson(createAlphaNativeBundle(state)));
}

/**
 * Parses and validates a native Alpha bundle. The returned state is a clone and
 * is not persisted automatically.
 */
export function parseAlphaNativeBundle(input) {
  let bundle;
  try {
    bundle = typeof input === 'string' ? JSON.parse(input) : cloneState(input);
  } catch (error) {
    return {
      success: false,
      errorCode: 'native_bundle_parse_error',
      error: error?.message || 'Native bundle JSON could not be parsed.',
    };
  }

  if (bundle?.format !== ALPHA_NATIVE_BUNDLE_FORMAT) {
    return {
      success: false,
      errorCode: 'unsupported_native_bundle_format',
      error: `Unsupported native bundle format '${bundle?.format}'.`,
    };
  }
  if (bundle?.formatVersion !== ALPHA_NATIVE_BUNDLE_VERSION) {
    return {
      success: false,
      errorCode: 'unsupported_native_bundle_version',
      error: `Unsupported native bundle formatVersion '${bundle?.formatVersion}'.`,
    };
  }

  const validation = validateAlphaNativeBundle(bundle);
  if (!validation.valid) {
    return {
      success: false,
      errorCode: 'invalid_native_bundle',
      error: validation.errors.join('; '),
      errors: validation.errors,
    };
  }

  return {
    success: true,
    format: ALPHA_NATIVE_BUNDLE_FORMAT,
    formatVersion: ALPHA_NATIVE_BUNDLE_VERSION,
    state: cloneState(bundle.state),
  };
}
