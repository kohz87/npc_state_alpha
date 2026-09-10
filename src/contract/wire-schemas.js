/**
 * NPC State Alpha — Wire Schemas and Envelope Definitions
 *
 * Single behavior authority: docs/core-contract.md
 * Implements S1 contracts for:
 * - One-pass wire format and strict envelope
 * - Development review wire format and scoped receipt envelopes
 * - C03 source reference structures, identity requirements, and structured segment permissions
 * - C08 observation, disposition, accepted-support, and progress shapes
 */

import { isDurableDossierField } from './registry.js';

export const ALPHA_ONE_PASS_WIRE_VERSION = '1';
export const ALPHA_DEVELOPMENT_WIRE_VERSION = '1';

export const TRAILER_TAG_OPEN = '<npc_state_alpha_v1>';
export const TRAILER_TAG_CLOSE = '</npc_state_alpha_v1>';

export const ONE_PASS_RESERVED_SOURCES = Object.freeze([
  'current:user',
  'current:assistant',
]);

export const STRUCTURED_SEGMENT_KINDS = Object.freeze({
  NARRATIVE: 'narrative',
  WORLD_STATE: 'world_state',
  INNER_CHATTER: 'inner_chatter',
});

/**
 * C03 Source Segment Permission Matrix:
 * Generic structured-source segments have declared boundaries;
 * they cannot broaden automatic authority or act as independent writers.
 */
export const SEGMENT_PERMISSIONS = Object.freeze({
  [STRUCTURED_SEGMENT_KINDS.NARRATIVE]: {
    allowedFields: '*', // All fields permitted for the calling writer
    allowsAdmission: true,
    allowsPhysicalPresence: true,
    allowsVisibleActions: true,
    allowsDeath: true,
    allowsDurableFacts: true,
    allowsRelationshipScoring: true,
  },
  [STRUCTURED_SEGMENT_KINDS.WORLD_STATE]: {
    allowedFields: ['location', 'status', 'offscreenActivity'],
    allowsAdmission: false,       // Cannot independently admit an NPC
    allowsPhysicalPresence: false, // Cannot prove physical presence
    allowsVisibleActions: false,
    allowsDeath: false,           // Structured-only death is forbidden
    allowsDurableFacts: false,    // Cannot rewrite durable canon
    allowsRelationshipScoring: false, // Cannot support numeric relationship scoring
  },
  [STRUCTURED_SEGMENT_KINDS.INNER_CHATTER]: {
    allowedFields: ['mood', 'goal', 'relationshipDynamic'],
    allowsAdmission: false,       // Cannot independently admit an NPC
    allowsPhysicalPresence: false, // Cannot prove physical presence
    allowsVisibleActions: false,  // Cannot establish visible gestures/speech
    allowsDeath: false,           // Structured-only death is forbidden
    allowsDurableFacts: false,    // Cannot rewrite durable canon
    allowsRelationshipScoring: false, // Cannot become a numeric scoring authority (C03, C07)
  },
});

export const IDENTITY_KINDS = Object.freeze(['named', 'role_label']);

export const RELATIONSHIP_AXES = Object.freeze([
  'trust',
  'affection',
  'desire',
  'tension',
]);

export const LIFECYCLE_STATES = Object.freeze(['alive', 'dead']);

export const EVIDENCE_DISPOSITIONS = Object.freeze([
  'tentative',
  'supporting',
  'contradicting',
  'superseded',
]);

export const RECEIPT_STATUSES = Object.freeze([
  'reviewed',
  'reviewed_no_proposals',
  'deferred',
  'unavailable',
]);

export const OPERATIONS = Object.freeze([
  'establish',
  'refine',
  'replace',
  'remove',
  'add',
  'consolidate',
  'update',
  'enrich',
]);

export const SCALAR_OPERATIONS = Object.freeze([
  'establish',
  'refine',
  'replace',
  'remove',
  'update',
  'enrich',
]);

export const COLLECTION_OPERATIONS = Object.freeze([
  'establish',
  'add',
  'replace',
  'remove',
  'update',
  'consolidate',
  'enrich',
]);

export const PERSONALITY_ALLOWED_KEYS = Object.freeze([
  'traits',
  'value',
  'operation',
  'source',
]);

export const BEHAVIORAL_PROFILE_ALLOWED_KEYS = Object.freeze([
  'value',
  'operation',
  'source',
]);

export const SPEECH_ALLOWED_KEYS = Object.freeze([
  'value',
  'operation',
  'source',
]);

export const MANNERISMS_ALLOWED_KEYS = Object.freeze([
  'value',
  'items',
  'operation',
  'source',
]);

export const MANNERISM_ITEM_KEYS = Object.freeze([
  'value',
  'operation',
  'source',
]);

export const CANONICAL_APPEARANCE_ALLOWED_KEYS = Object.freeze([
  'value',
  'operation',
  'source',
]);

export const RELATIONSHIP_DYNAMIC_ALLOWED_KEYS = Object.freeze([
  'value',
  'operation',
  'source',
]);

export const APPEARANCE_FORMS_CONTAINER_KEYS = Object.freeze([
  'forms',
  'items',
  'operation',
  'source',
]);

export const APPEARANCE_FORM_ITEM_KEYS = Object.freeze([
  'formId',
  'localFormRef',
  'name',
  'label',
  'description',
  'operation',
  'source',
]);

export const IMPORTANT_MEMORIES_CONTAINER_KEYS = Object.freeze([
  'memories',
  'items',
  'operation',
  'source',
]);

export const IMPORTANT_MEMORY_ITEM_KEYS = Object.freeze([
  'memoryId',
  'localMemoryRef',
  'text',
  'summary',
  'operation',
  'source',
  'sameEventLinks',
]);

export const NON_PLAYER_RELATIONSHIPS_CONTAINER_KEYS = Object.freeze([
  'relationships',
  'items',
  'operation',
  'source',
]);

export const NON_PLAYER_RELATIONSHIP_ITEM_KEYS = Object.freeze([
  'targetId',
  'targetRef',
  'targetName',
  'relationship',
  'relationKind',
  'description',
  'operation',
  'source',
  'relationId',
]);

export const DURABLE_FACT_KEYS = Object.freeze([
  'role',
  'species',
  'background',
  'actualAge',
  'apparentAge',
  'birthday',
  'operation',
  'source',
]);

export const ONE_PASS_TOP_LEVEL_KEYS = Object.freeze([
  'version',
  'proposals',
]);

export const ONE_PASS_PROPOSAL_KEYS = Object.freeze([
  'id',
  'localRef',
  'name',
  'aliases',
  'identityKind',
  'evidence',
  'present',
  'activeInExchange',
  'offscreenActivity',
  'presenceSource',
  'mood',
  'location',
  'goal',
  'status',
  'currentPresentation',
  'currentForm',
  'relationshipEvaluation',
  'lifecycle',
  'source',
]);

export const DEVELOPMENT_TOP_LEVEL_KEYS = Object.freeze([
  'version',
  'targetAcknowledgments',
  'reviewReceipts',
  'proposals',
  'observations',
  'supportProposals',
]);

export const DEVELOPMENT_PROPOSAL_KEYS = Object.freeze([
  'targetId',
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
  'facts',
]);

export const PERSISTED_OBSERVATION_KEYS = Object.freeze([
  'id',
  'targetId',
  'field',
  'observation',
  'source',
  'disposition',
  'sameEventLinks',
  'sameEventRef',
]);

export const PERSISTED_ACCEPTED_SUPPORT_KEYS = Object.freeze([
  'targetId',
  'field',
  'fieldRevision',
  'supportingObservationIds',
  'sourceRefs',
  'notes',
  'reason',
]);

export const DISPOSITION_ALLOWED_KEYS = Object.freeze([
  'role',
  'linkedFieldRevision',
  'linkedObservationRefs',
  'linkedObservationIds',
  'reason',
  'notes',
]);

export const PERSISTED_DISPOSITION_ALLOWED_KEYS = Object.freeze([
  'role',
  'linkedFieldRevision',
  'linkedObservationIds',
  'reason',
  'notes',
]);

export const SOURCE_REFERENCE_ALLOWED_KEYS = Object.freeze([
  'sourceRef',
  'excerpt',
  'segmentKind',
  'sameEventRef',
  'copiedFrom',
  'derivedFrom',
]);

export const RELATIONSHIP_EVALUATION_ALLOWED_KEYS = Object.freeze([
  'shifted',
  'axes',
  'impact',
  'reason',
  'source',
  'axisSupport',
]);

export const AXIS_SUPPORT_ENTRY_KEYS = Object.freeze([
  'source',
  'reason',
]);

export const LIFECYCLE_ALLOWED_KEYS = Object.freeze([
  'lifeState',
  'cause',
  'source',
  'livingReturn',
]);

export const RECEIPT_ALLOWED_KEYS = Object.freeze([
  'targetId',
  'sourceScope',
  'status',
  'restricted',
  'fieldSubset',
  'reason',
]);

export const OBSERVATION_ALLOWED_KEYS = Object.freeze([
  'localObservationRef',
  'localRef',
  'targetId',
  'field',
  'observation',
  'source',
  'disposition',
  'sameEventLinks',
  'sameEventRef',
]);

export const SUPPORT_PROPOSAL_ALLOWED_KEYS = Object.freeze([
  'targetId',
  'field',
  'supportingObservationRefs',
  'supportingObservationIds',
  'sourceRefs',
  'notes',
  'reason',
]);

export const OWNED_SOURCE_RECORD_ALLOWED_KEYS = Object.freeze([
  'chatId',
  'sidecarId',
  'position',
  'role',
  'contentFingerprint',
  'precedingLineage',
  'swipe',
  'revision',
]);

/**
 * Validates whether a segment kind is permitted to support a given field.
 * @param {string} segmentKind
 * @param {string} fieldName
 * @returns {boolean}
 */
export function isSegmentKindPermittedForField(segmentKind, fieldName) {
  const perms = SEGMENT_PERMISSIONS[segmentKind];
  if (!perms) return false;
  if (perms.allowedFields === '*') return true;
  const baseField = fieldName.split('.')[0];
  return perms.allowedFields.includes(baseField);
}

/**
 * Validates whether a source's segmentKind is permitted to support a given target field (C03).
 * Centralizes segment permission enforcement for one-pass and development fields.
 * @param {object} source
 * @param {string} targetField
 * @returns {{ valid: boolean, error?: string, unsupportedSegment?: boolean }}
 */
export function validateSegmentFieldPermission(source, targetField) {
  if (!source || typeof source !== 'object') {
    return { valid: false, error: 'Source must be an object.' };
  }
  const segmentKind = source.segmentKind || STRUCTURED_SEGMENT_KINDS.NARRATIVE;
  const perms = SEGMENT_PERMISSIONS[segmentKind];
  if (!perms) {
    return {
      valid: false,
      error: `Unsupported structured segment kind '${segmentKind}'.`,
      unsupportedSegment: true,
    };
  }

  const baseField = targetField.split('.')[0];

  if (baseField === 'evidence' || baseField === 'admission') {
    if (!perms.allowsAdmission) {
      return {
        valid: false,
        error: `Structured segment '${segmentKind}' cannot independently admit an NPC (C03).`,
      };
    }
  }

  if (baseField === 'present' || baseField === 'presence') {
    if (!perms.allowsPhysicalPresence) {
      return {
        valid: false,
        error: `Structured segment '${segmentKind}' cannot prove physical in-scene presence (C03).`,
      };
    }
  }

  if (baseField === 'relationshipEvaluation' || baseField === 'relationshipScoring') {
    if (!perms.allowsRelationshipScoring) {
      return {
        valid: false,
        error: `Structured segment '${segmentKind}' cannot support numeric relationship scoring (C03, C07).`,
      };
    }
  }

  if (baseField === 'lifecycle' || baseField === 'death') {
    if (!perms.allowsDeath) {
      return {
        valid: false,
        error: `Structured segment '${segmentKind}' cannot establish death; death requires owned narrative evidence (C03, C06).`,
      };
    }
  }

  if (perms.allowedFields !== '*' && !perms.allowedFields.includes(baseField)) {
    return {
      valid: false,
      error: `Structured segment '${segmentKind}' cannot support field '${targetField}' (C03). Permitted fields for '${segmentKind}': ${perms.allowedFields.join(', ')}.`,
    };
  }

  return { valid: true };
}

/**
 * Validates deterministic owned-source identity and provenance metadata shape (C03).
 * Runtime-owned contract; no resolver or runtime storage implementation in S1.
 * @param {object} record
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateOwnedSourceRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, error: 'Owned source record must be an object.' };
  }

  for (const key of Object.keys(record)) {
    if (!OWNED_SOURCE_RECORD_ALLOWED_KEYS.includes(key)) {
      return { valid: false, error: `Unknown key '${key}' in owned source record. Allowed: ${OWNED_SOURCE_RECORD_ALLOWED_KEYS.join(', ')}.` };
    }
  }

  const { chatId, sidecarId, position, role, contentFingerprint, precedingLineage, swipe, revision } = record;

  if (chatId === undefined && sidecarId === undefined) {
    return { valid: false, error: "Owned source record requires at least one of 'chatId' or 'sidecarId'." };
  }

  if (chatId !== undefined && (typeof chatId !== 'string' || chatId.trim() === '')) {
    return { valid: false, error: "Owned source record 'chatId', if provided, must be a non-empty string." };
  }

  if (sidecarId !== undefined && (typeof sidecarId !== 'string' || sidecarId.trim() === '')) {
    return { valid: false, error: "Owned source record 'sidecarId', if provided, must be a non-empty string." };
  }

  if (typeof position !== 'number' || !Number.isInteger(position) || position < 0) {
    return { valid: false, error: "Owned source record must have non-negative integer 'position'." };
  }

  if (!['user', 'assistant', 'system'].includes(role)) {
    return { valid: false, error: "Owned source record must have role in ['user', 'assistant', 'system']." };
  }

  if (typeof contentFingerprint !== 'string' || contentFingerprint.trim() === '') {
    return { valid: false, error: "Owned source record must have non-empty string 'contentFingerprint'." };
  }

  if (precedingLineage === undefined || precedingLineage === null) {
    return { valid: false, error: "Owned source record requires explicit 'precedingLineage'." };
  }

  if (!Array.isArray(precedingLineage)) {
    return { valid: false, error: "Owned source record 'precedingLineage' must be an array of non-empty strings (deterministic lineage representation)." };
  }

  if (position === 0) {
    if (precedingLineage.length !== 0) {
      return { valid: false, error: "Root owned source record (position 0) must have explicit empty precedingLineage []." };
    }
  } else {
    // Non-root (position > 0)
    if (precedingLineage.length === 0) {
      return { valid: false, error: "Non-root owned source record (position > 0) must carry actual preceding lineage." };
    }
    if (!precedingLineage.every((l) => typeof l === 'string' && l.trim() !== '')) {
      return { valid: false, error: "Owned source record 'precedingLineage' array must contain non-empty strings." };
    }
  }

  function isValidNumericOrStringId(val) {
    if (typeof val === 'number') {
      return Number.isInteger(val) && val >= 0;
    }
    if (typeof val === 'string') {
      return val.trim() !== '';
    }
    return false;
  }

  if (swipe !== undefined && !isValidNumericOrStringId(swipe)) {
    return { valid: false, error: "Owned source record 'swipe', if provided, must be a non-negative integer or non-empty string." };
  }

  if (revision !== undefined && !isValidNumericOrStringId(revision)) {
    return { valid: false, error: "Owned source record 'revision', if provided, must be a non-negative integer or non-empty string." };
  }

  return { valid: true };
}

/**
 * Validates a persisted runtime observation record shape (C08).
 * Unlike development wire proposals, the persisted observation has a runtime-assigned stable ID.
 * @param {object} record
 * @returns {{ valid: boolean, error?: string }}
 */
export function validatePersistedObservationRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, error: 'Persisted observation record must be an object.' };
  }

  // Reject unknown keys (MEDIUM 4, MEDIUM 5)
  for (const key of Object.keys(record)) {
    if (!PERSISTED_OBSERVATION_KEYS.includes(key)) {
      return { valid: false, error: `Unknown key '${key}' in persisted observation record. Allowed: ${PERSISTED_OBSERVATION_KEYS.join(', ')}.` };
    }
  }

  if (typeof record.id !== 'string' || record.id.trim() === '') {
    return { valid: false, error: "Persisted observation requires runtime-assigned non-empty string 'id'." };
  }

  if (typeof record.targetId !== 'string' || record.targetId.trim() === '') {
    return { valid: false, error: "Persisted observation requires non-empty string 'targetId'." };
  }

  if (typeof record.field !== 'string' || record.field.trim() === '') {
    return { valid: false, error: "Persisted observation requires non-empty string 'field'." };
  }

  // MEDIUM 5 & LOW 9: Field must be eligible durable development field only; observations ledger is NOT valid target
  if (!isDurableDossierField(record.field)) {
    return { valid: false, error: `Persisted observation field '${record.field}' must target an eligible Development durable field; observations ledger is not a valid target.` };
  }

  if (typeof record.observation !== 'string' || record.observation.trim() === '') {
    return { valid: false, error: "Persisted observation requires non-empty string 'observation'." };
  }

  if (!record.source || typeof record.source !== 'object' || Array.isArray(record.source)) {
    return { valid: false, error: "Persisted observation requires 'source' object." };
  }

  // Validate full source-reference shape for persisted observation (MEDIUM 5)
  for (const key of Object.keys(record.source)) {
    if (!SOURCE_REFERENCE_ALLOWED_KEYS.includes(key)) {
      return { valid: false, error: `Unknown key '${key}' in persisted observation source reference.` };
    }
  }

  if (typeof record.source.sourceRef !== 'string' || record.source.sourceRef.trim() === '') {
    return { valid: false, error: "Persisted observation source requires non-empty string 'sourceRef'." };
  }

  if (typeof record.source.excerpt !== 'string' || record.source.excerpt.trim() === '') {
    return { valid: false, error: "Persisted observation source requires non-empty string 'excerpt'." };
  }

  if (record.source.excerpt.includes(TRAILER_TAG_OPEN) || record.source.excerpt.includes(TRAILER_TAG_CLOSE)) {
    return { valid: false, error: 'Persisted observation source excerpt cannot cite the machine trailer (C03 transport exclusion violation).' };
  }

  const segmentKind = record.source.segmentKind || STRUCTURED_SEGMENT_KINDS.NARRATIVE;
  if (!Object.values(STRUCTURED_SEGMENT_KINDS).includes(segmentKind)) {
    return { valid: false, error: `Unsupported structured segment kind '${segmentKind}' in persisted observation source.` };
  }

  for (const linkProp of ['sameEventRef', 'copiedFrom', 'derivedFrom']) {
    if (record.source[linkProp] !== undefined) {
      if (typeof record.source[linkProp] !== 'string' || record.source[linkProp].trim() === '') {
        return { valid: false, error: `Linkage reference '${linkProp}' in persisted observation source, if provided, must be a non-empty string.` };
      }
    }
  }

  const permVal = validateSegmentFieldPermission(record.source, record.field);
  if (!permVal.valid) {
    return { valid: false, error: `Persisted observation source: ${permVal.error}` };
  }

  if (record.disposition !== undefined) {
    if (!record.disposition || typeof record.disposition !== 'object' || Array.isArray(record.disposition)) {
      return { valid: false, error: "Persisted observation 'disposition' must be an object." };
    }

    if (record.disposition.linkedObservationRefs !== undefined) {
      return {
        valid: false,
        error: "Persisted observation disposition cannot contain request-local 'linkedObservationRefs'; persisted records permit only resolved 'linkedObservationIds' or 'linkedFieldRevision' (C08).",
      };
    }

    for (const key of Object.keys(record.disposition)) {
      if (!PERSISTED_DISPOSITION_ALLOWED_KEYS.includes(key)) {
        return { valid: false, error: `Unknown or disallowed key '${key}' in persisted observation disposition. Allowed: ${PERSISTED_DISPOSITION_ALLOWED_KEYS.join(', ')}.` };
      }
    }
    if (!EVIDENCE_DISPOSITIONS.includes(record.disposition.role)) {
      return { valid: false, error: `Invalid disposition role '${record.disposition.role}'. Allowed: ${EVIDENCE_DISPOSITIONS.join(', ')}.` };
    }

    let hasValidFieldRev = false;
    if (record.disposition.linkedFieldRevision !== undefined) {
      if (typeof record.disposition.linkedFieldRevision !== 'string' || record.disposition.linkedFieldRevision.trim() === '') {
        return { valid: false, error: "Persisted observation disposition 'linkedFieldRevision', if provided, must be a non-empty string." };
      }
      hasValidFieldRev = true;
    }

    let hasValidObsIds = false;
    if (record.disposition.linkedObservationIds !== undefined) {
      const ids = record.disposition.linkedObservationIds;
      if (!Array.isArray(ids) || ids.length === 0 || !ids.every((id) => typeof id === 'string' && id.trim() !== '')) {
        return { valid: false, error: "Persisted observation disposition 'linkedObservationIds' must be a non-empty array of non-empty strings." };
      }
      hasValidObsIds = true;
    }

    if (record.disposition.reason !== undefined && (typeof record.disposition.reason !== 'string' || record.disposition.reason.trim() === '')) {
      return { valid: false, error: "Persisted observation disposition 'reason', if provided, must be a non-empty string." };
    }

    if (record.disposition.notes !== undefined && (typeof record.disposition.notes !== 'string' || record.disposition.notes.trim() === '')) {
      return { valid: false, error: "Persisted observation disposition 'notes', if provided, must be a non-empty string." };
    }

    // supporting/contradicting/superseded dispositions require their linkage structure (MEDIUM 5)
    const role = record.disposition.role;
    if (role === 'supporting' || role === 'contradicting' || role === 'superseded') {
      if (!hasValidFieldRev && !hasValidObsIds) {
        return { valid: false, error: `Persisted observation disposition role '${role}' requires linked reference ('linkedFieldRevision' or 'linkedObservationIds').` };
      }
    }
  }

  if (record.sameEventLinks !== undefined) {
    const links = record.sameEventLinks;
    if (typeof links === 'string') {
      if (links.trim() === '') {
        return { valid: false, error: "Persisted observation 'sameEventLinks' string cannot be empty." };
      }
    } else if (Array.isArray(links)) {
      if (links.length === 0 || !links.every((link) => typeof link === 'string' && link.trim() !== '')) {
        return { valid: false, error: "Persisted observation 'sameEventLinks' array must contain non-empty strings." };
      }
    } else {
      return { valid: false, error: "Persisted observation 'sameEventLinks' must be an array or string." };
    }
  }

  if (record.sameEventRef !== undefined) {
    if (typeof record.sameEventRef !== 'string' || record.sameEventRef.trim() === '') {
      return { valid: false, error: "Persisted observation 'sameEventRef', if provided, must be a non-empty string." };
    }
  }

  return { valid: true };
}

/**
 * Validates a persisted accepted-support record shape (C08).
 * Owned by shared commit coordinator; must include committed fieldRevision reference.
 * @param {object} record
 * @returns {{ valid: boolean, error?: string }}
 */
export function validatePersistedAcceptedSupportRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    return { valid: false, error: 'Persisted accepted-support record must be an object.' };
  }

  // Reject unknown keys (MEDIUM 4, MEDIUM 5)
  for (const key of Object.keys(record)) {
    if (!PERSISTED_ACCEPTED_SUPPORT_KEYS.includes(key)) {
      return { valid: false, error: `Unknown key '${key}' in persisted accepted-support record. Allowed: ${PERSISTED_ACCEPTED_SUPPORT_KEYS.join(', ')}.` };
    }
  }

  if (typeof record.targetId !== 'string' || record.targetId.trim() === '') {
    return { valid: false, error: "Persisted accepted-support requires non-empty string 'targetId'." };
  }

  if (typeof record.field !== 'string' || record.field.trim() === '') {
    return { valid: false, error: "Persisted accepted-support requires non-empty string 'field'." };
  }

  // MEDIUM 5: Field must be eligible durable development field
  if (!isDurableDossierField(record.field)) {
    return { valid: false, error: `Persisted accepted-support field '${record.field}' must target an eligible Development durable field.` };
  }

  // C08: Committed field revision reference is strictly required for persisted accepted-support
  if (typeof record.fieldRevision !== 'string' || record.fieldRevision.trim() === '') {
    return { valid: false, error: "Persisted accepted-support requires committed non-empty string 'fieldRevision' reference (C08)." };
  }

  let hasObsIds = false;
  if (record.supportingObservationIds !== undefined) {
    if (!Array.isArray(record.supportingObservationIds) || record.supportingObservationIds.length === 0 || !record.supportingObservationIds.every(id => typeof id === 'string' && id.trim() !== '')) {
      return { valid: false, error: "Persisted accepted-support 'supportingObservationIds' must be an array of non-empty strings." };
    }
    hasObsIds = true;
  }

  let hasSourceRefs = false;
  if (record.sourceRefs !== undefined) {
    if (!Array.isArray(record.sourceRefs) || record.sourceRefs.length === 0 || !record.sourceRefs.every(ref => typeof ref === 'string' && ref.trim() !== '')) {
      return { valid: false, error: "Persisted accepted-support 'sourceRefs' must be an array of non-empty strings." };
    }
    hasSourceRefs = true;
  }

  if (!hasObsIds && !hasSourceRefs) {
    return { valid: false, error: "Persisted accepted-support requires non-empty 'supportingObservationIds' or 'sourceRefs' array." };
  }

  if (record.notes !== undefined && (typeof record.notes !== 'string' || record.notes.trim() === '')) {
    return { valid: false, error: "Persisted accepted-support 'notes', if provided, must be a non-empty string." };
  }

  if (record.reason !== undefined && (typeof record.reason !== 'string' || record.reason.trim() === '')) {
    return { valid: false, error: "Persisted accepted-support 'reason', if provided, must be a non-empty string." };
  }

  return { valid: true };
}


