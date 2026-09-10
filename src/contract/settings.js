/**
 * NPC State Alpha — single settings registry
 *
 * S4 establishes the runtime-owned settings source used by development review.
 * S5 may add UI controls, but defaults/normalization continue to come from here.
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

export const ALPHA_SETTINGS_DEFAULTS = Object.freeze({
  enabled: true,
  admissionPolicy: ALPHA_ADMISSION_POLICIES.NAMED_PREFERRED,
  developmentEnabled: true,
  developmentCadence: 3,
  developmentConnectionProfile: null,
  developmentResponseLimit: DEVELOPMENT_DEFAULT_RESPONSE_LIMIT,
  routineDossierDetailBudget: 'auto',
});

function normalizeBoolean(value, fallback) {
  return typeof value === 'boolean' ? value : fallback;
}

function normalizeInteger(value, fallback, min, max) {
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Normalizes Alpha settings without mutating caller-owned objects.
 * Unknown keys are deliberately ignored so one registry remains authoritative.
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
      ? Math.min(20, Math.max(1, source.routineDossierDetailBudget))
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
      128,
      32768,
    ),
    routineDossierDetailBudget: budget,
  };
}
