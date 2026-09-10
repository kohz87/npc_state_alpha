/**
 * NPC State Alpha — Canonical Field and Authority Registry
 *
 * Derived strictly from C02 in docs/core-contract.md.
 * Single behavior authority: docs/core-contract.md.
 *
 * C02 Automatic Field Ownership is strictly disjoint between
 * Immediate (one-pass) and Development (development scan) writers:
 * No field has two automatic writers.
 */

export const WRITERS = Object.freeze({
  ONE_PASS: 'one_pass',
  DEVELOPMENT: 'development',
  RUNTIME: 'runtime',
  USER: 'user',
});

export const DOMAINS = Object.freeze({
  IDENTITY: 'identity',
  PRESENCE: 'presence',
  LIVE_STATE: 'live_state',
  CURRENT_PRESENTATION: 'current_presentation',
  CURRENT_FORM: 'current_form',
  NUMERIC_RELATIONSHIP: 'numeric_relationship',
  LIFECYCLE: 'lifecycle',
  RELATIONSHIP_DYNAMIC: 'relationship_dynamic',
  CANONICAL_APPEARANCE: 'canonical_appearance',
  PERSONALITY: 'personality',
  BEHAVIORAL_PROFILE: 'behavioral_profile',
  SPEECH: 'speech',
  MANNERISMS: 'mannerisms',
  DURABLE_FACTS: 'durable_facts',
  MEMORIES: 'memories',
  NON_PLAYER_RELATIONSHIPS: 'non_player_relationships',
  OBSERVATIONS: 'observations',
  ACCEPTED_SUPPORT: 'accepted_support',
  REVIEW_RECEIPTS: 'review_receipts',
  USER_CONFIG: 'user_config',
});

/**
 * Registry mapping each canonical field to its domain, automatic writer,
 * supported operation types, and constraints.
 */
export const CANONICAL_FIELDS = Object.freeze({
  // --- One-Pass Automatic Writers ---
  id: {
    domain: DOMAINS.IDENTITY,
    automaticWriter: WRITERS.ONE_PASS,
    allowedWriters: [WRITERS.ONE_PASS, WRITERS.RUNTIME],
    type: 'string',
    description: 'Stable assigned NPC identifier, or null/empty for NEW candidates',
  },
  localRef: {
    domain: DOMAINS.IDENTITY,
    automaticWriter: WRITERS.ONE_PASS,
    allowedWriters: [WRITERS.ONE_PASS],
    type: 'string',
    description: 'Explicit per-envelope local identifier for NEW candidates; array-order fallback forbidden',
  },
  name: {
    domain: DOMAINS.IDENTITY,
    automaticWriter: WRITERS.ONE_PASS,
    allowedWriters: [WRITERS.ONE_PASS, WRITERS.USER],
    type: 'string',
    description: 'Canonical human-facing name of the individual',
  },
  aliases: {
    domain: DOMAINS.IDENTITY,
    automaticWriter: WRITERS.ONE_PASS,
    allowedWriters: [WRITERS.ONE_PASS, WRITERS.USER],
    type: 'array',
    isCollection: true,
    description: 'Alternative names or monikers for the individual',
  },
  identityKind: {
    domain: DOMAINS.IDENTITY,
    automaticWriter: WRITERS.ONE_PASS,
    allowedWriters: [WRITERS.ONE_PASS],
    type: 'string',
    description: 'Admission classification: "named" or "role_label"',
  },
  present: {
    domain: DOMAINS.PRESENCE,
    automaticWriter: WRITERS.ONE_PASS,
    allowedWriters: [WRITERS.ONE_PASS],
    type: 'boolean',
    description: 'Final in-scene presence at the end of the exchange',
  },
  activeInExchange: {
    domain: DOMAINS.PRESENCE,
    automaticWriter: WRITERS.ONE_PASS,
    allowedWriters: [WRITERS.ONE_PASS],
    type: 'boolean',
    description: 'Whether the NPC actively participated in speech/action this exchange',
  },
  offscreenActivity: {
    domain: DOMAINS.PRESENCE,
    automaticWriter: WRITERS.ONE_PASS,
    allowedWriters: [WRITERS.ONE_PASS],
    type: 'string',
    description: 'Semantic summary of off-screen action when not present',
  },
  mood: {
    domain: DOMAINS.LIVE_STATE,
    automaticWriter: WRITERS.ONE_PASS,
    allowedWriters: [WRITERS.ONE_PASS, WRITERS.USER],
    type: 'string',
    description: 'Current emotional state; changed fields only',
  },
  location: {
    domain: DOMAINS.LIVE_STATE,
    automaticWriter: WRITERS.ONE_PASS,
    allowedWriters: [WRITERS.ONE_PASS, WRITERS.USER],
    type: 'string',
    description: 'Current physical location; changed fields only',
  },
  goal: {
    domain: DOMAINS.LIVE_STATE,
    automaticWriter: WRITERS.ONE_PASS,
    allowedWriters: [WRITERS.ONE_PASS, WRITERS.USER],
    type: 'string',
    description: 'Current immediate objective; changed fields only',
  },
  status: {
    domain: DOMAINS.LIVE_STATE,
    automaticWriter: WRITERS.ONE_PASS,
    allowedWriters: [WRITERS.ONE_PASS, WRITERS.USER],
    type: 'string',
    description: 'Current activity or physical condition; changed fields only',
  },
  currentPresentation: {
    domain: DOMAINS.CURRENT_PRESENTATION,
    automaticWriter: WRITERS.ONE_PASS,
    allowedWriters: [WRITERS.ONE_PASS, WRITERS.USER],
    type: 'string',
    description: 'Transient observed visual presentation (clothing, condition); does not rewrite canonical anatomy',
  },
  currentForm: {
    domain: DOMAINS.CURRENT_FORM,
    automaticWriter: WRITERS.ONE_PASS,
    allowedWriters: [WRITERS.ONE_PASS, WRITERS.USER],
    type: 'string',
    nullable: true,
    description: 'Established form selector identifier; unresolved/null when form definition is unknown or new',
  },
  relationshipEvaluation: {
    domain: DOMAINS.NUMERIC_RELATIONSHIP,
    automaticWriter: WRITERS.ONE_PASS,
    allowedWriters: [WRITERS.ONE_PASS],
    type: 'object',
    description: 'Numeric relationship shift toward PLAYER (Trust/Affection/Desire/Tension axes or explicit zero)',
  },
  lifeState: {
    domain: DOMAINS.LIFECYCLE,
    automaticWriter: WRITERS.ONE_PASS,
    allowedWriters: [WRITERS.ONE_PASS, WRITERS.USER],
    type: 'string',
    description: 'Terminal lifecycle state ("alive" | "dead"); automatic dead->alive forbidden; no livingReturn',
  },

  // --- Development Scan Automatic Writers ---
  relationshipDynamic: {
    domain: DOMAINS.RELATIONSHIP_DYNAMIC,
    automaticWriter: WRITERS.DEVELOPMENT,
    allowedWriters: [WRITERS.DEVELOPMENT, WRITERS.USER],
    type: 'string',
    description: 'Source-grounded NPC-to-player qualitative interpretation; does not score relationship',
  },
  canonicalAppearance: {
    domain: DOMAINS.CANONICAL_APPEARANCE,
    automaticWriter: WRITERS.DEVELOPMENT,
    allowedWriters: [WRITERS.DEVELOPMENT, WRITERS.USER],
    type: 'string',
    description: 'Durable anatomical and canonical visual baseline',
  },
  appearanceForms: {
    domain: DOMAINS.CANONICAL_APPEARANCE,
    automaticWriter: WRITERS.DEVELOPMENT,
    allowedWriters: [WRITERS.DEVELOPMENT, WRITERS.USER],
    type: 'array',
    isCollection: true,
    description: 'Defined durable appearance forms available for selection by currentForm',
  },
  personality: {
    domain: DOMAINS.PERSONALITY,
    automaticWriter: WRITERS.DEVELOPMENT,
    allowedWriters: [WRITERS.DEVELOPMENT, WRITERS.USER],
    type: 'object',
    description: 'Core traits and psychological disposition',
  },
  behavioralProfile: {
    domain: DOMAINS.BEHAVIORAL_PROFILE,
    automaticWriter: WRITERS.DEVELOPMENT,
    allowedWriters: [WRITERS.DEVELOPMENT, WRITERS.USER],
    type: 'string',
    description: 'Observed behavioral patterns and typical reactions',
  },
  speech: {
    domain: DOMAINS.SPEECH,
    automaticWriter: WRITERS.DEVELOPMENT,
    allowedWriters: [WRITERS.DEVELOPMENT, WRITERS.USER],
    type: 'string',
    description: 'Characteristic speech patterns, dialect, and verbal habits',
  },
  mannerisms: {
    domain: DOMAINS.MANNERISMS,
    automaticWriter: WRITERS.DEVELOPMENT,
    allowedWriters: [WRITERS.DEVELOPMENT, WRITERS.USER],
    type: 'array',
    isCollection: true,
    description: 'Physical habits, gestures, and behavioral tics',
  },
  role: {
    domain: DOMAINS.DURABLE_FACTS,
    automaticWriter: WRITERS.DEVELOPMENT,
    allowedWriters: [WRITERS.DEVELOPMENT, WRITERS.USER],
    type: 'string',
    description: 'Durable occupation or station in world',
  },
  species: {
    domain: DOMAINS.DURABLE_FACTS,
    automaticWriter: WRITERS.DEVELOPMENT,
    allowedWriters: [WRITERS.DEVELOPMENT, WRITERS.USER],
    type: 'string',
    description: 'Biological or metaphysical species/ancestry',
  },
  background: {
    domain: DOMAINS.DURABLE_FACTS,
    automaticWriter: WRITERS.DEVELOPMENT,
    allowedWriters: [WRITERS.DEVELOPMENT, WRITERS.USER],
    type: 'string',
    description: 'History, lineage, origin, or formative events',
  },
  actualAge: {
    domain: DOMAINS.DURABLE_FACTS,
    automaticWriter: WRITERS.DEVELOPMENT,
    allowedWriters: [WRITERS.DEVELOPMENT, WRITERS.USER],
    type: 'string',
    description: 'Chronological age as supported by narrative; no invented arithmetic',
  },
  apparentAge: {
    domain: DOMAINS.DURABLE_FACTS,
    automaticWriter: WRITERS.DEVELOPMENT,
    allowedWriters: [WRITERS.DEVELOPMENT, WRITERS.USER],
    type: 'string',
    description: 'Visual age estimate as perceived by observers',
  },
  birthday: {
    domain: DOMAINS.DURABLE_FACTS,
    automaticWriter: WRITERS.DEVELOPMENT,
    allowedWriters: [WRITERS.DEVELOPMENT, WRITERS.USER],
    type: 'string',
    description: 'Calendar birth date if explicitly stated in narrative',
  },
  importantMemories: {
    domain: DOMAINS.MEMORIES,
    automaticWriter: WRITERS.DEVELOPMENT,
    allowedWriters: [WRITERS.DEVELOPMENT, WRITERS.USER],
    type: 'array',
    isCollection: true,
    description: 'Consequential promises, rescues, betrayals, discoveries, obligations, registrations',
  },
  nonPlayerRelationships: {
    domain: DOMAINS.NON_PLAYER_RELATIONSHIPS,
    automaticWriter: WRITERS.DEVELOPMENT,
    allowedWriters: [WRITERS.DEVELOPMENT, WRITERS.USER],
    type: 'array',
    isCollection: true,
    description: 'Directional graph of non-player ties, family, alliances, rivalries; no player scoring',
  },
  observations: {
    domain: DOMAINS.OBSERVATIONS,
    automaticWriter: WRITERS.DEVELOPMENT,
    allowedWriters: [WRITERS.DEVELOPMENT, WRITERS.RUNTIME],
    type: 'array',
    isCollection: true,
    description: 'Tentative evidence records (C08); not accepted durable traits',
  },
  acceptedSupport: {
    domain: DOMAINS.ACCEPTED_SUPPORT,
    automaticWriter: WRITERS.RUNTIME,
    allowedWriters: [WRITERS.RUNTIME],
    type: 'array',
    isCollection: true,
    description: 'Committed links between field revisions and supporting evidence; owned by runtime/shared commit coordinator (C08)',
  },
  reviewReceipts: {
    domain: DOMAINS.REVIEW_RECEIPTS,
    automaticWriter: WRITERS.RUNTIME,
    allowedWriters: [WRITERS.RUNTIME],
    type: 'array',
    isCollection: true,
    description: 'Runtime-owned review progress and receipt records; not a model-authored canonical field (C02, C08)',
  },

  // --- Runtime and User Owned Only ---
  portrait: {
    domain: DOMAINS.USER_CONFIG,
    automaticWriter: null,
    allowedWriters: [WRITERS.USER, WRITERS.RUNTIME],
    type: 'string',
    description: 'Portrait image attachment or asset reference; never model-inferred',
  },
  importance: {
    domain: DOMAINS.USER_CONFIG,
    automaticWriter: null,
    allowedWriters: [WRITERS.USER, WRITERS.RUNTIME],
    type: 'number',
    description: 'User-specified priority or tracking tier; never model-inferred',
  },
  locks: {
    domain: DOMAINS.USER_CONFIG,
    automaticWriter: null,
    allowedWriters: [WRITERS.USER, WRITERS.RUNTIME],
    type: 'object',
    description: 'Field-level manual locks preventing automatic overwrite; never model-inferred',
  },
  manualCorrections: {
    domain: DOMAINS.USER_CONFIG,
    automaticWriter: null,
    allowedWriters: [WRITERS.USER, WRITERS.RUNTIME],
    type: 'object',
    description: 'Explicit user edits surviving rollback; distinct from automatic writes',
  },
});

/**
 * Returns the field definition for a given field name.
 * @param {string} fieldName
 * @returns {object|null}
 */
export function getFieldDefinition(fieldName) {
  return CANONICAL_FIELDS[fieldName] || null;
}

/**
 * Returns all registered canonical field names.
 * @returns {string[]}
 */
export function getAllFieldNames() {
  return Object.keys(CANONICAL_FIELDS);
}

/**
 * Returns all field names owned automatically by a specific writer.
 * @param {string} writer
 * @returns {string[]}
 */
export function getFieldsByWriter(writer) {
  return Object.entries(CANONICAL_FIELDS)
    .filter(([_, def]) => def.automaticWriter === writer)
    .map(([name]) => name);
}

/**
 * Checks whether a given field can be written by a given writer.
 * @param {string} fieldName
 * @param {string} writer
 * @returns {boolean}
 */
export function isFieldAllowedForWriter(fieldName, writer) {
  const def = CANONICAL_FIELDS[fieldName];
  if (!def) return false;
  return def.allowedWriters.includes(writer);
}

/**
 * Validates authority of a writer for a field.
 * Returns { valid: true } or { valid: false, error: string }.
 * @param {string} fieldName
 * @param {string} writer
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateWriterAuthority(fieldName, writer) {
  const def = CANONICAL_FIELDS[fieldName];
  if (!def) {
    return {
      valid: false,
      error: `Unrecognized field '${fieldName}' not present in canonical C02 registry.`,
    };
  }

  if (def.automaticWriter === null && (writer === WRITERS.ONE_PASS || writer === WRITERS.DEVELOPMENT)) {
    return {
      valid: false,
      error: `Field '${fieldName}' is strictly ${def.allowedWriters.join('/')}-owned and cannot be modified by automatic model writer '${writer}'.`,
    };
  }

  if (def.automaticWriter !== writer && !def.allowedWriters.includes(writer)) {
    return {
      valid: false,
      error: `Wrong-writer rejection: Field '${fieldName}' (domain: '${def.domain}') is owned by '${def.automaticWriter}', cannot be written by '${writer}'.`,
    };
  }

  return { valid: true };
}

/**
 * Strict assertion of writer authority for a field; throws on violation.
 * @param {string} fieldName
 * @param {string} writer
 */
export function assertWriterAuthority(fieldName, writer) {
  const result = validateWriterAuthority(fieldName, writer);
  if (!result.valid) {
    throw new Error(result.error);
  }
}

/**
 * Eligible Development durable dossier fields (excludes observations and runtime bookkeeping).
 */
export const DURABLE_DOSSIER_FIELDS = Object.freeze([
  'relationshipDynamic',
  'canonicalAppearance',
  'appearanceForms',
  'personality',
  'behavioralProfile',
  'speech',
  'mannerisms',
  'role',
  'species',
  'background',
  'actualAge',
  'apparentAge',
  'birthday',
  'importantMemories',
  'nonPlayerRelationships',
]);

/**
 * Checks whether a field is an eligible Development durable dossier field.
 * @param {string} fieldName
 * @returns {boolean}
 */
export function isDurableDossierField(fieldName) {
  // Support dotted fields like personality.traits, speech.accent, etc.
  const baseField = fieldName.split('.')[0];
  return DURABLE_DOSSIER_FIELDS.includes(baseField);
}
