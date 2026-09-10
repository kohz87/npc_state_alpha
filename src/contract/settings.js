/**
 * NPC State Alpha — single settings registry
 *
 * This module is the only owner of Alpha setting names, defaults, bounds,
 * validation, and normalization. Host/UI code may persist or render settings,
 * but must not duplicate the domain rules defined here.
 */

export const ALPHA_SETTINGS_SCHEMA_VERSION = 1;
export const ALPHA_ADMISSION_POLICIES = Object.freeze({
  NAMED_PREFERRED: 'named_preferred',
  BALANCED_UNIQUE_ROLE_LABEL: 'balanced_unique_role_label',
  MANUAL_ONLY: 'manual_only',
});

export const DEVELOPMENT_MIN_CADENCE = 1;
export const DEVELOPMENT_MAX_CADENCE = 10;
export const DEVELOPMENT_MAX_BATCH_EXCHANGES = 6;
export const DEVELOPMENT_DEFAULT_RESPONSE_LIMIT = 1600;
export const DEVELOPMENT_MIN_RESPONSE_LIMIT = 128;
export const DEVELOPMENT_MAX_RESPONSE_LIMIT = 32768;

export const ROUTINE_DOSSIER_BUDGET_MIN = 1;
export const ROUTINE_DOSSIER_BUDGET_MAX = 20;

export const RELATIONSHIP_DEFAULT_SCORE_CAP = 1000;
export const RELATIONSHIP_MIN_SCORE_CAP = 10;
export const RELATIONSHIP_MAX_SCORE_CAP = 1000;
export const RELATIONSHIP_DEFAULT_INERTIA = 0;
export const RELATIONSHIP_MIN_INERTIA = 0;
export const RELATIONSHIP_MAX_INERTIA = 1;
export const RELATIONSHIP_DEFAULT_HISTORY_LIMIT = 20;
export const RELATIONSHIP_MIN_HISTORY_LIMIT = 1;
export const RELATIONSHIP_MAX_HISTORY_LIMIT = 100;

// Compatibility aliases used by the S5 UI/tests. They intentionally point to
// the same registry values rather than defining a second settings system.
export const RELATIONSHIP_SCORE_CAP_DEFAULT = RELATIONSHIP_DEFAULT_SCORE_CAP;
export const RELATIONSHIP_SCORE_CAP_MIN = RELATIONSHIP_MIN_SCORE_CAP;
export const RELATIONSHIP_SCORE_CAP_MAX = RELATIONSHIP_MAX_SCORE_CAP;
export const RELATIONSHIP_INERTIA_DEFAULT = RELATIONSHIP_DEFAULT_INERTIA;
export const RELATIONSHIP_INERTIA_MIN = RELATIONSHIP_MIN_INERTIA;
export const RELATIONSHIP_INERTIA_MAX = RELATIONSHIP_MAX_INERTIA;
export const RELATIONSHIP_HISTORY_LIMIT_DEFAULT = RELATIONSHIP_DEFAULT_HISTORY_LIMIT;
export const RELATIONSHIP_HISTORY_LIMIT_MIN = RELATIONSHIP_MIN_HISTORY_LIMIT;
export const RELATIONSHIP_HISTORY_LIMIT_MAX = RELATIONSHIP_MAX_HISTORY_LIMIT;

export const ALPHA_SETTINGS_DEFAULTS = Object.freeze({
  enabled: true,
  admissionPolicy: ALPHA_ADMISSION_POLICIES.NAMED_PREFERRED,
  developmentEnabled: true,
  developmentCadence: 3,
  developmentConnectionProfile: null,
  developmentResponseLimit: DEVELOPMENT_DEFAULT_RESPONSE_LIMIT,
  routineDossierDetailBudget: 'auto',
  relationshipScoreCap: RELATIONSHIP_DEFAULT_SCORE_CAP,
  relationshipInertia: RELATIONSHIP_DEFAULT_INERTIA,
  relationshipHistoryLimit: RELATIONSHIP_DEFAULT_HISTORY_LIMIT,
});

export const ALPHA_SETTING_KEYS = Object.freeze([
  'schemaVersion',
  ...Object.keys(ALPHA_SETTINGS_DEFAULTS),
]);

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeInteger(value, fallback, min, max) {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function validateInteger(value, name, min, max, errors) {
  if (!Number.isInteger(value) || value < min || value > max) {
    errors.push(`${name} must be an integer from ${min} to ${max}.`);
  }
}

/**
 * Strictly validates explicit settings supplied by a user-facing command/UI.
 * Unlike normalizeAlphaSettings(), this never repairs a bad explicit value.
 * Stored/older settings may still be normalized fail-safe on load.
 *
 * @param {object} input
 * @param {object} [options]
 * @param {boolean} [options.partial=true] When false, every setting key is required.
 * @returns {{valid:boolean, errors:string[]}}
 */
export function validateAlphaSettings(input, { partial = true } = {}) {
  const errors = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { valid: false, errors: ['Settings must be an object.'] };
  }

  for (const key of Object.keys(input)) {
    if (!ALPHA_SETTING_KEYS.includes(key)) errors.push(`Unknown Alpha setting '${key}'.`);
  }

  if (!partial) {
    for (const key of Object.keys(ALPHA_SETTINGS_DEFAULTS)) {
      if (!Object.prototype.hasOwnProperty.call(input, key)) {
        errors.push(`Missing required Alpha setting '${key}'.`);
      }
    }
  }

  if (Object.prototype.hasOwnProperty.call(input, 'schemaVersion') && input.schemaVersion !== ALPHA_SETTINGS_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${ALPHA_SETTINGS_SCHEMA_VERSION}.`);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'enabled') && typeof input.enabled !== 'boolean') {
    errors.push('enabled must be a boolean.');
  }
  if (Object.prototype.hasOwnProperty.call(input, 'admissionPolicy') && !Object.values(ALPHA_ADMISSION_POLICIES).includes(input.admissionPolicy)) {
    errors.push(`admissionPolicy must be one of: ${Object.values(ALPHA_ADMISSION_POLICIES).join(', ')}.`);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'developmentEnabled') && typeof input.developmentEnabled !== 'boolean') {
    errors.push('developmentEnabled must be a boolean.');
  }
  if (Object.prototype.hasOwnProperty.call(input, 'developmentCadence')) {
    validateInteger(input.developmentCadence, 'developmentCadence', DEVELOPMENT_MIN_CADENCE, DEVELOPMENT_MAX_CADENCE, errors);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'developmentConnectionProfile')) {
    const value = input.developmentConnectionProfile;
    if (value !== null && (typeof value !== 'string' || value.trim() === '')) {
      errors.push('developmentConnectionProfile must be a non-empty string or null.');
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'developmentResponseLimit')) {
    validateInteger(input.developmentResponseLimit, 'developmentResponseLimit', DEVELOPMENT_MIN_RESPONSE_LIMIT, DEVELOPMENT_MAX_RESPONSE_LIMIT, errors);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'routineDossierDetailBudget')) {
    const value = input.routineDossierDetailBudget;
    if (value !== 'auto') {
      validateInteger(value, 'routineDossierDetailBudget', ROUTINE_DOSSIER_BUDGET_MIN, ROUTINE_DOSSIER_BUDGET_MAX, errors);
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'relationshipScoreCap')) {
    validateInteger(input.relationshipScoreCap, 'relationshipScoreCap', RELATIONSHIP_MIN_SCORE_CAP, RELATIONSHIP_MAX_SCORE_CAP, errors);
  }
  if (Object.prototype.hasOwnProperty.call(input, 'relationshipInertia')) {
    const value = input.relationshipInertia;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < RELATIONSHIP_MIN_INERTIA || value > RELATIONSHIP_MAX_INERTIA) {
      errors.push(`relationshipInertia must be a finite number from ${RELATIONSHIP_MIN_INERTIA} to ${RELATIONSHIP_MAX_INERTIA}.`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(input, 'relationshipHistoryLimit')) {
    validateInteger(input.relationshipHistoryLimit, 'relationshipHistoryLimit', RELATIONSHIP_MIN_HISTORY_LIMIT, RELATIONSHIP_MAX_HISTORY_LIMIT, errors);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Normalizes Alpha settings without mutating caller-owned objects.
 * Unknown keys are deliberately ignored so one registry remains authoritative.
 * Explicit UI/command input should call validateAlphaSettings() before this.
 */
export function normalizeAlphaSettings(input = {}) {
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const admissionValues = new Set(Object.values(ALPHA_ADMISSION_POLICIES));
  const profile = typeof source.developmentConnectionProfile === 'string' && source.developmentConnectionProfile.trim() !== ''
    ? source.developmentConnectionProfile.trim()
    : null;
  const budget = source.routineDossierDetailBudget === 'auto'
    ? 'auto'
    : (Number.isInteger(source.routineDossierDetailBudget)
      ? Math.min(ROUTINE_DOSSIER_BUDGET_MAX, Math.max(ROUTINE_DOSSIER_BUDGET_MIN, source.routineDossierDetailBudget))
      : ALPHA_SETTINGS_DEFAULTS.routineDossierDetailBudget);

  return {
    schemaVersion: ALPHA_SETTINGS_SCHEMA_VERSION,
    enabled: normalizeBoolean(source.enabled, ALPHA_SETTINGS_DEFAULTS.enabled),
    admissionPolicy: admissionValues.has(source.admissionPolicy)
      ? source.admissionPolicy
      : ALPHA_SETTINGS_DEFAULTS.admissionPolicy,
    developmentEnabled: normalizeBoolean(source.developmentEnabled, ALPHA_SETTINGS_DEFAULTS.developmentEnabled),
    developmentCadence: normalizeInteger(
      source.developmentCadence,
      ALPHA_SETTINGS_DEFAULTS.developmentCadence,
      DEVELOPMENT_MIN_CADENCE,
      DEVELOPMENT_MAX_CADENCE,
    ),
    developmentConnectionProfile: profile,
    developmentResponseLimit: normalizeInteger(
      source.developmentResponseLimit,
      ALPHA_SETTINGS_DEFAULTS.developmentResponseLimit,
      DEVELOPMENT_MIN_RESPONSE_LIMIT,
      DEVELOPMENT_MAX_RESPONSE_LIMIT,
    ),
    routineDossierDetailBudget: budget,
    relationshipScoreCap: normalizeInteger(
      source.relationshipScoreCap,
      ALPHA_SETTINGS_DEFAULTS.relationshipScoreCap,
      RELATIONSHIP_MIN_SCORE_CAP,
      RELATIONSHIP_MAX_SCORE_CAP,
    ),
    relationshipInertia: typeof source.relationshipInertia === 'number' && Number.isFinite(source.relationshipInertia)
      ? Math.min(RELATIONSHIP_MAX_INERTIA, Math.max(RELATIONSHIP_MIN_INERTIA, source.relationshipInertia))
      : ALPHA_SETTINGS_DEFAULTS.relationshipInertia,
    relationshipHistoryLimit: normalizeInteger(
      source.relationshipHistoryLimit,
      ALPHA_SETTINGS_DEFAULTS.relationshipHistoryLimit,
      RELATIONSHIP_MIN_HISTORY_LIMIT,
      RELATIONSHIP_MAX_HISTORY_LIMIT,
    ),
  };
}
