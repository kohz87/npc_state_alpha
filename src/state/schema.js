/**
 * NPC State Alpha — Versioned Shared State Schema
 *
 * Namespace: npc_state_alpha.v1
 * Schema Version: 1
 * Authority: docs/core-contract.md (C02, C05, C06, C08, C10, C11)
 */

import {
  CANONICAL_FIELDS,
  WRITERS,
  DOMAINS,
  isDurableDossierField,
} from '../contract/registry.js';
import {
  RECEIPT_STATUSES,
  validatePersistedObservationRecord,
  validatePersistedAcceptedSupportRecord,
  validateOwnedSourceRecord,
} from '../contract/wire-schemas.js';

export const ALPHA_NAMESPACE = 'npc_state_alpha.v1';
export const ALPHA_SCHEMA_VERSION = 1;

/**
 * Creates a default canonical NPC record for a newly admitted NPC.
 * Represents the canonical persisted NPC state needed by S2 according to C02/C08,
 * with explicit transient mapping note:
 * - All durable dossier fields and canonical relationship state defined in C02 are represented.
 * - Transient wire-only fields (e.g. `localRef`, delta `relationshipEvaluation` events, transport wrappers)
 *   are deliberately mapped into their canonical persistent equivalents (`id`, `relationship` axes, and
 *   C08 audit records under `development`).
 *
 * NOTE ON CANONICAL STATE VS WIRE / TRANSIENT FIELDS:
 * - Canonical NPC records store durable dossier properties and C08 audit ledgers.
 * - Transient wire concepts such as `localRef` (temporary admission handle) and
 *   `relationshipEvaluation` (delta event with narrative explanation) are NEVER
 *   stored as top-level canonical NPC record properties:
 *   - `localRef` is resolved to a stable `id` at admission time.
 *   - `relationshipEvaluation` deltas mutate the canonical `relationship` axes
 *     object ({ trust, affection, desire, tension, lastEvaluationExchange }).
 * - Nested C08 records under `development` (`observations`, `acceptedSupport`,
 *   `reviewReceipts`) represent the durable audit trail for development proposals,
 *   supporting evidence links, and review decisions.
 *
 * @param {string} id Stable assigned NPC identifier
 * @param {string} name Canonical human-facing name
 * @param {object} options
 * @returns {object} Canonical NPC record
 */
export function createDefaultNpcRecord(id, name, options = {}) {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new Error("createDefaultNpcRecord requires non-empty string 'id'.");
  }
  if (typeof name !== 'string' || name.trim() === '') {
    throw new Error("createDefaultNpcRecord requires non-empty string 'name'.");
  }

  const initialFieldRevisions = {};
  for (const field of Object.keys(CANONICAL_FIELDS)) {
    initialFieldRevisions[field] = 1;
  }

  return {
    id,
    name,
    aliases: options.aliases || [],
    identityKind: options.identityKind || 'named',
    lifeState: options.lifeState || 'alive',
    present: options.present !== undefined ? options.present : false,
    activeInExchange: options.activeInExchange !== undefined ? options.activeInExchange : false,
    offscreenActivity: options.offscreenActivity || null,
    mood: options.mood || null,
    location: options.location || null,
    goal: options.goal || null,
    status: options.status || null,
    currentPresentation: options.currentPresentation || null,
    currentForm: options.currentForm !== undefined ? options.currentForm : null,
    relationship: options.relationship || {
      trust: 0,
      affection: 0,
      desire: 0,
      tension: 0,
      lastEvaluationExchange: null,
    },
    relationshipDynamic: options.relationshipDynamic || null,
    canonicalAppearance: options.canonicalAppearance || null,
    appearanceForms: options.appearanceForms || [],
    personality: options.personality || null,
    behavioralProfile: options.behavioralProfile || null,
    speech: options.speech || null,
    mannerisms: options.mannerisms || [],
    role: options.role || null,
    species: options.species || null,
    background: options.background || null,
    actualAge: options.actualAge || null,
    apparentAge: options.apparentAge || null,
    birthday: options.birthday || null,
    importantMemories: options.importantMemories || [],
    nonPlayerRelationships: options.nonPlayerRelationships || [],
    portrait: options.portrait || null,
    importance: options.importance !== undefined ? options.importance : null,
    locks: options.locks || {},
    manualCorrections: options.manualCorrections || {},
    fieldRevisions: options.fieldRevisions || initialFieldRevisions,
    development: {
      observations: options.development?.observations || [],
      acceptedSupport: options.development?.acceptedSupport || [],
      reviewReceipts: options.development?.reviewReceipts || [],
    },
  };
}

/**
 * Creates an empty, valid initial Alpha state object.
 *
 * @param {object} options
 * @returns {object} Initial state object
 */
export function createInitialState(options = {}) {
  return {
    namespace: ALPHA_NAMESPACE,
    schemaVersion: ALPHA_SCHEMA_VERSION,
    revision: 0,
    npcs: options.npcs || {},
    tombstones: options.tombstones || {},
    dedup: {
      processedSourceKeys: options.dedup?.processedSourceKeys || [],
    },
    pendingReview: {
      entries: options.pendingReview?.entries || [],
    },
    history: {
      checkpoints: options.history?.checkpoints || [],
    },
  };
}

/**
 * Validates a state object against Alpha schema rules.
 *
 * @param {object} state
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateState(state) {
  const errors = [];

  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { valid: false, errors: ['State root must be a non-null object.'] };
  }

  const ALLOWED_STATE_ROOT_KEYS = [
    'namespace',
    'schemaVersion',
    'revision',
    'npcs',
    'tombstones',
    'dedup',
    'pendingReview',
    'history',
  ];
  for (const rootKey of Object.keys(state)) {
    if (!ALLOWED_STATE_ROOT_KEYS.includes(rootKey)) {
      errors.push(`Unknown key '${rootKey}' at state root.`);
    }
  }

  if (state.namespace !== ALPHA_NAMESPACE) {
    errors.push(`Invalid namespace '${state.namespace}'. Expected '${ALPHA_NAMESPACE}'.`);
  }

  if (state.schemaVersion !== ALPHA_SCHEMA_VERSION) {
    errors.push(`Invalid schemaVersion '${state.schemaVersion}'. Expected ${ALPHA_SCHEMA_VERSION}.`);
  }

  if (typeof state.revision !== 'number' || !Number.isInteger(state.revision) || state.revision < 0) {
    errors.push("State 'revision' must be a non-negative integer.");
  }

  const ALLOWED_NPC_RECORD_KEYS = [
    'id',
    'name',
    'aliases',
    'identityKind',
    'lifeState',
    'present',
    'activeInExchange',
    'offscreenActivity',
    'mood',
    'location',
    'goal',
    'status',
    'currentPresentation',
    'currentForm',
    'relationship',
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
    'portrait',
    'importance',
    'locks',
    'manualCorrections',
    'fieldRevisions',
    'development',
  ];

  if (!state.npcs || typeof state.npcs !== 'object' || Array.isArray(state.npcs)) {
    errors.push("State 'npcs' must be an object map.");
  } else {
    for (const [npcId, npc] of Object.entries(state.npcs)) {
      if (!npc || typeof npc !== 'object' || Array.isArray(npc)) {
        errors.push(`NPC record '${npcId}' must be an object.`);
        continue;
      }

      for (const k of Object.keys(npc)) {
        if (!ALLOWED_NPC_RECORD_KEYS.includes(k)) {
          errors.push(`NPC '${npcId}' contains unknown top-level key '${k}'.`);
        }
      }

      if (npc.id !== npcId) {
        errors.push(`NPC record key '${npcId}' does not match npc.id '${npc.id}'.`);
      }

      if (typeof npc.name !== 'string' || npc.name.trim() === '') {
        errors.push(`NPC '${npcId}' must have non-empty string name.`);
      }

      if (!['alive', 'dead'].includes(npc.lifeState)) {
        errors.push(`NPC '${npcId}' has invalid lifeState '${npc.lifeState}'. Must be 'alive' or 'dead'.`);
      }

      if (npc.lifeState === 'dead') {
        if (npc.present === true) {
          errors.push(`NPC '${npcId}' is dead but has present: true (contradictory lifecycle state).`);
        }
        if (npc.activeInExchange === true) {
          errors.push(`NPC '${npcId}' is dead but has activeInExchange: true (contradictory lifecycle state).`);
        }
      }

      // Validate canonical stored field types (Item 10)
      if (npc.aliases !== undefined && (!Array.isArray(npc.aliases) || !npc.aliases.every(a => typeof a === 'string'))) {
        errors.push(`NPC '${npcId}' aliases must be an array of strings.`);
      }
      if (npc.identityKind !== undefined && !['named', 'role_label'].includes(npc.identityKind)) {
        errors.push(`NPC '${npcId}' identityKind must be 'named' or 'role_label'.`);
      }
      if (npc.present !== undefined && typeof npc.present !== 'boolean') {
        errors.push(`NPC '${npcId}' present must be a boolean.`);
      }
      if (npc.activeInExchange !== undefined && typeof npc.activeInExchange !== 'boolean') {
        errors.push(`NPC '${npcId}' activeInExchange must be a boolean.`);
      }
      if (npc.offscreenActivity !== undefined && npc.offscreenActivity !== null && typeof npc.offscreenActivity !== 'string') {
        errors.push(`NPC '${npcId}' offscreenActivity must be a string or null.`);
      }
      if (npc.mood !== undefined && npc.mood !== null && typeof npc.mood !== 'string') {
        errors.push(`NPC '${npcId}' mood must be a string or null.`);
      }
      if (npc.location !== undefined && npc.location !== null && typeof npc.location !== 'string') {
        errors.push(`NPC '${npcId}' location must be a string or null.`);
      }
      if (npc.goal !== undefined && npc.goal !== null && typeof npc.goal !== 'string') {
        errors.push(`NPC '${npcId}' goal must be a string or null.`);
      }
      if (npc.status !== undefined && npc.status !== null && typeof npc.status !== 'string') {
        errors.push(`NPC '${npcId}' status must be a string or null.`);
      }
      if (npc.currentPresentation !== undefined && npc.currentPresentation !== null && typeof npc.currentPresentation !== 'string') {
        errors.push(`NPC '${npcId}' currentPresentation must be a string or null.`);
      }
      if (npc.currentForm !== undefined && npc.currentForm !== null && typeof npc.currentForm !== 'string') {
        errors.push(`NPC '${npcId}' currentForm must be a string or null.`);
      }
      if (npc.relationshipDynamic !== undefined && npc.relationshipDynamic !== null && typeof npc.relationshipDynamic !== 'string') {
        errors.push(`NPC '${npcId}' relationshipDynamic must be a string or null.`);
      }
      if (npc.canonicalAppearance !== undefined && npc.canonicalAppearance !== null && typeof npc.canonicalAppearance !== 'string') {
        errors.push(`NPC '${npcId}' canonicalAppearance must be a string or null.`);
      }
      if (npc.appearanceForms !== undefined) {
        if (!Array.isArray(npc.appearanceForms)) {
          errors.push(`NPC '${npcId}' appearanceForms must be an array.`);
        } else {
          const ALLOWED_FORM_KEYS = ['formId', 'name', 'label', 'description'];
          for (let i = 0; i < npc.appearanceForms.length; i++) {
            const form = npc.appearanceForms[i];
            if (!form || typeof form !== 'object' || Array.isArray(form)) {
              errors.push(`NPC '${npcId}' appearanceForms[${i}] must be an object.`);
              continue;
            }
            if (typeof form.formId !== 'string' || form.formId.trim() === '') {
              errors.push(`NPC '${npcId}' appearanceForms[${i}] requires non-empty string 'formId'.`);
            }
            for (const fk of Object.keys(form)) {
              if (!ALLOWED_FORM_KEYS.includes(fk)) {
                errors.push(`NPC '${npcId}' appearanceForms[${i}] contains forbidden or unknown key '${fk}'.`);
              }
            }
          }
        }
      }
      if (npc.personality !== undefined && npc.personality !== null) {
        if (typeof npc.personality !== 'object' || Array.isArray(npc.personality)) {
          errors.push(`NPC '${npcId}' personality must be an object or null; string format is not permitted in canonical state.`);
        } else {
          if (npc.personality.source !== undefined || npc.personality.operation !== undefined || npc.personality.evidence !== undefined) {
            errors.push(`NPC '${npcId}' personality contains forbidden wire metadata (source/operation/evidence).`);
          }
          const ALLOWED_PERSONALITY_KEYS = ['traits', 'value'];
          for (const pk of Object.keys(npc.personality)) {
            if (!ALLOWED_PERSONALITY_KEYS.includes(pk)) {
              errors.push(`NPC '${npcId}' personality contains unknown canonical key '${pk}'. Allowed: ${ALLOWED_PERSONALITY_KEYS.join(', ')}.`);
            }
          }
          if (npc.personality.traits !== undefined) {
            if (!Array.isArray(npc.personality.traits) || !npc.personality.traits.every((t) => typeof t === 'string' && t.trim() !== '')) {
              errors.push(`NPC '${npcId}' personality.traits must be an array of non-empty strings.`);
            }
          }
          if (npc.personality.value !== undefined) {
            if (typeof npc.personality.value !== 'string' || npc.personality.value.trim() === '') {
              errors.push(`NPC '${npcId}' personality.value must be a non-empty string.`);
            }
          }
          if (npc.personality.traits === undefined && npc.personality.value === undefined) {
            errors.push(`NPC '${npcId}' personality object must contain at least 'traits' or 'value'.`);
          }
        }
      }
      if (npc.behavioralProfile !== undefined && npc.behavioralProfile !== null && typeof npc.behavioralProfile !== 'string') {
        errors.push(`NPC '${npcId}' behavioralProfile must be a string or null.`);
      }
      if (npc.speech !== undefined && npc.speech !== null && typeof npc.speech !== 'string') {
        errors.push(`NPC '${npcId}' speech must be a string or null.`);
      }
      if (npc.mannerisms !== undefined) {
        if (!Array.isArray(npc.mannerisms)) {
          errors.push(`NPC '${npcId}' mannerisms must be an array.`);
        } else {
          for (let i = 0; i < npc.mannerisms.length; i++) {
            const m = npc.mannerisms[i];
            if (typeof m === 'string') {
              if (m.trim() === '') {
                errors.push(`NPC '${npcId}' mannerisms[${i}] cannot be an empty string.`);
              }
            } else if (m && typeof m === 'object' && !Array.isArray(m)) {
              if (m.source !== undefined || m.operation !== undefined || m.evidence !== undefined) {
                errors.push(`NPC '${npcId}' mannerisms[${i}] contains forbidden wire metadata (source/operation/evidence).`);
              }
              const hasVal = (typeof m.value === 'string' && m.value.trim() !== '') ||
                (typeof m.mannerism === 'string' && m.mannerism.trim() !== '') ||
                (typeof m.text === 'string' && m.text.trim() !== '');
              if (!hasVal) {
                errors.push(`NPC '${npcId}' mannerisms[${i}] object must contain non-empty value, mannerism, or text.`);
              }
            } else {
              errors.push(`NPC '${npcId}' mannerisms[${i}] must be a non-empty string or canonical object.`);
            }
          }
        }
      }
      if (npc.role !== undefined && npc.role !== null && typeof npc.role !== 'string') {
        errors.push(`NPC '${npcId}' role must be a string or null.`);
      }
      if (npc.species !== undefined && npc.species !== null && typeof npc.species !== 'string') {
        errors.push(`NPC '${npcId}' species must be a string or null.`);
      }
      if (npc.background !== undefined && npc.background !== null && typeof npc.background !== 'string') {
        errors.push(`NPC '${npcId}' background must be a string or null.`);
      }
      if (npc.actualAge !== undefined && npc.actualAge !== null && typeof npc.actualAge !== 'string') {
        errors.push(`NPC '${npcId}' actualAge must be a string or null.`);
      }
      if (npc.apparentAge !== undefined && npc.apparentAge !== null && typeof npc.apparentAge !== 'string') {
        errors.push(`NPC '${npcId}' apparentAge must be a string or null.`);
      }
      if (npc.birthday !== undefined && npc.birthday !== null && typeof npc.birthday !== 'string') {
        errors.push(`NPC '${npcId}' birthday must be a string or null.`);
      }
      if (npc.importantMemories !== undefined) {
        if (!Array.isArray(npc.importantMemories)) {
          errors.push(`NPC '${npcId}' importantMemories must be an array.`);
        } else {
          const ALLOWED_MEMORY_KEYS = ['memoryId', 'text', 'summary', 'sameEventLinks'];
          for (let i = 0; i < npc.importantMemories.length; i++) {
            const mem = npc.importantMemories[i];
            if (!mem || typeof mem !== 'object' || Array.isArray(mem)) {
              errors.push(`NPC '${npcId}' importantMemories[${i}] must be an object.`);
              continue;
            }
            if (typeof mem.memoryId !== 'string' || mem.memoryId.trim() === '') {
              errors.push(`NPC '${npcId}' importantMemories[${i}] requires non-empty string 'memoryId'.`);
            }
            const hasText = typeof mem.text === 'string' && mem.text.trim() !== '';
            const hasSummary = typeof mem.summary === 'string' && mem.summary.trim() !== '';
            if (!hasText && !hasSummary) {
              errors.push(`NPC '${npcId}' importantMemories[${i}] requires non-empty string 'text' or 'summary'.`);
            }
            if (mem.sameEventLinks !== undefined && (!Array.isArray(mem.sameEventLinks) || !mem.sameEventLinks.every((s) => typeof s === 'string' && s.trim() !== ''))) {
              errors.push(`NPC '${npcId}' importantMemories[${i}] sameEventLinks must be an array of non-empty strings.`);
            }
            for (const mk of Object.keys(mem)) {
              if (!ALLOWED_MEMORY_KEYS.includes(mk)) {
                errors.push(`NPC '${npcId}' importantMemories[${i}] contains forbidden or unknown key '${mk}'.`);
              }
            }
          }
        }
      }
      if (npc.nonPlayerRelationships !== undefined) {
        if (!Array.isArray(npc.nonPlayerRelationships)) {
          errors.push(`NPC '${npcId}' nonPlayerRelationships must be an array.`);
        } else {
          const ALLOWED_NPR_KEYS = ['relationId', 'targetId', 'relationship', 'relationKind', 'description'];
          for (let i = 0; i < npc.nonPlayerRelationships.length; i++) {
            const rel = npc.nonPlayerRelationships[i];
            if (!rel || typeof rel !== 'object' || Array.isArray(rel)) {
              errors.push(`NPC '${npcId}' nonPlayerRelationships[${i}] must be an object.`);
              continue;
            }
            if (typeof rel.relationId !== 'string' || rel.relationId.trim() === '') {
              errors.push(`NPC '${npcId}' nonPlayerRelationships[${i}] requires non-empty string 'relationId'.`);
            }
            if (typeof rel.targetId !== 'string' || rel.targetId.trim() === '') {
              errors.push(`NPC '${npcId}' nonPlayerRelationships[${i}] requires non-empty string 'targetId'.`);
            }
            const hasDesc = (typeof rel.relationship === 'string' && rel.relationship.trim() !== '') ||
              (typeof rel.relationKind === 'string' && rel.relationKind.trim() !== '') ||
              (typeof rel.description === 'string' && rel.description.trim() !== '');
            if (!hasDesc) {
              errors.push(`NPC '${npcId}' nonPlayerRelationships[${i}] requires non-empty 'relationship', 'relationKind', or 'description'.`);
            }
            for (const rk of Object.keys(rel)) {
              if (!ALLOWED_NPR_KEYS.includes(rk)) {
                errors.push(`NPC '${npcId}' nonPlayerRelationships[${i}] contains forbidden or unknown key '${rk}'.`);
              }
            }
          }
        }
      }
      if (npc.portrait !== undefined && npc.portrait !== null && typeof npc.portrait !== 'string') {
        errors.push(`NPC '${npcId}' portrait must be a string or null.`);
      }
      if (npc.importance !== undefined && npc.importance !== null && (typeof npc.importance !== 'number' || !Number.isFinite(npc.importance))) {
        errors.push(`NPC '${npcId}' importance must be a finite number or null.`);
      }

      if (!npc.fieldRevisions || typeof npc.fieldRevisions !== 'object' || Array.isArray(npc.fieldRevisions)) {
        errors.push(`NPC '${npcId}' must have a fieldRevisions map.`);
      } else {
        const canonicalKeys = Object.keys(CANONICAL_FIELDS);
        for (const field of canonicalKeys) {
          const rev = npc.fieldRevisions[field];
          if (rev === undefined) {
            errors.push(`NPC '${npcId}' fieldRevisions is missing canonical field '${field}'.`);
          } else if (typeof rev !== 'number' || !Number.isInteger(rev) || rev <= 0) {
            errors.push(`NPC '${npcId}' fieldRevisions['${field}'] must be a positive integer.`);
          }
        }
        for (const field of Object.keys(npc.fieldRevisions)) {
          if (!CANONICAL_FIELDS[field]) {
            errors.push(`NPC '${npcId}' fieldRevisions contains unknown canonical field '${field}'.`);
          }
        }
      }

      if (npc.locks !== undefined) {
        if (!npc.locks || typeof npc.locks !== 'object' || Array.isArray(npc.locks)) {
          errors.push(`NPC '${npcId}' locks must be an object map.`);
        } else {
          for (const [field, locked] of Object.entries(npc.locks)) {
            if (!CANONICAL_FIELDS[field]) {
              errors.push(`NPC '${npcId}' locks contains unknown canonical field '${field}'.`);
            }
            if (typeof locked !== 'boolean') {
              errors.push(`NPC '${npcId}' locks['${field}'] must be a boolean.`);
            }
          }
        }
      }

      if (npc.manualCorrections !== undefined) {
        if (!npc.manualCorrections || typeof npc.manualCorrections !== 'object' || Array.isArray(npc.manualCorrections)) {
          errors.push(`NPC '${npcId}' manualCorrections must be an object map.`);
        } else {
          const ALLOWED_MANUAL_CORRECTION_KEYS = ['correctedAt', 'writer', 'notes', 'reason', 'previousValue', 'value'];
          for (const [field, corr] of Object.entries(npc.manualCorrections)) {
            if (!CANONICAL_FIELDS[field]) {
              errors.push(`NPC '${npcId}' manualCorrections contains unknown canonical field '${field}'.`);
            }
            if (!corr || typeof corr !== 'object' || Array.isArray(corr)) {
              errors.push(`NPC '${npcId}' manualCorrections['${field}'] must be an object.`);
            } else {
              for (const ck of Object.keys(corr)) {
                if (!ALLOWED_MANUAL_CORRECTION_KEYS.includes(ck)) {
                  errors.push(`NPC '${npcId}' manualCorrections['${field}'] contains unknown key '${ck}'.`);
                }
              }
              if (typeof corr.correctedAt !== 'string' || corr.correctedAt.trim() === '') {
                errors.push(`NPC '${npcId}' manualCorrections['${field}'] requires non-empty string 'correctedAt'.`);
              }
              if (typeof corr.writer !== 'string' || corr.writer.trim() === '') {
                errors.push(`NPC '${npcId}' manualCorrections['${field}'] requires non-empty string 'writer'.`);
              } else if (![WRITERS.USER, WRITERS.RUNTIME].includes(corr.writer)) {
                errors.push(`NPC '${npcId}' manualCorrections['${field}'] writer '${corr.writer}' is invalid. Allowed: ${WRITERS.USER}, ${WRITERS.RUNTIME}.`);
              }
              if (corr.notes !== undefined && (typeof corr.notes !== 'string' || corr.notes.trim() === '')) {
                errors.push(`NPC '${npcId}' manualCorrections['${field}'].notes must be a non-empty string when supplied.`);
              }
              if (corr.reason !== undefined && (typeof corr.reason !== 'string' || corr.reason.trim() === '')) {
                errors.push(`NPC '${npcId}' manualCorrections['${field}'].reason must be a non-empty string when supplied.`);
              }
            }
          }
        }
      }

      if (npc.relationship !== undefined) {
        if (!npc.relationship || typeof npc.relationship !== 'object' || Array.isArray(npc.relationship)) {
          errors.push(`NPC '${npcId}' relationship must be an object.`);
        } else {
          const allowedAxes = ['trust', 'affection', 'desire', 'tension', 'lastEvaluationExchange', 'progress', 'milestones', 'scoringHistory'];
          for (const key of Object.keys(npc.relationship)) {
            if (!allowedAxes.includes(key)) {
              errors.push(`NPC '${npcId}' relationship contains unknown axis or key '${key}'.`);
            }
          }
          for (const axis of ['trust', 'affection', 'desire', 'tension']) {
            const val = npc.relationship[axis];
            if (val === undefined || typeof val !== 'number' || !Number.isFinite(val)) {
              errors.push(`NPC '${npcId}' relationship['${axis}'] must be a finite number.`);
            }
          }
          if (npc.relationship.lastEvaluationExchange !== undefined && npc.relationship.lastEvaluationExchange !== null) {
            const lex = npc.relationship.lastEvaluationExchange;
            if (typeof lex !== 'string' && (typeof lex !== 'number' || !Number.isInteger(lex) || lex < 0)) {
              errors.push(`NPC '${npcId}' relationship.lastEvaluationExchange must be null, a string, or a non-negative integer.`);
            }
          }
          if (npc.relationship.progress !== undefined) {
            if (!npc.relationship.progress || typeof npc.relationship.progress !== 'object' || Array.isArray(npc.relationship.progress)) {
              errors.push(`NPC '${npcId}' relationship.progress must be an object.`);
            } else {
              for (const axis of ['trust', 'affection', 'desire', 'tension']) {
                if (npc.relationship.progress[axis] !== undefined && (
                  typeof npc.relationship.progress[axis] !== 'number' ||
                  !Number.isFinite(npc.relationship.progress[axis]) ||
                  npc.relationship.progress[axis] < 0 ||
                  npc.relationship.progress[axis] >= 1
                )) {
                  errors.push(`NPC '${npcId}' relationship.progress['${axis}'] must be a finite fraction from 0 (inclusive) to 1 (exclusive).`);
                }
              }
            }
          }
          if (npc.relationship.milestones !== undefined) {
            if (!Array.isArray(npc.relationship.milestones) || !npc.relationship.milestones.every((m) => typeof m === 'string' && m.trim() !== '')) {
              errors.push(`NPC '${npcId}' relationship.milestones must be an array of non-empty strings.`);
            }
          }
          if (npc.relationship.scoringHistory !== undefined) {
            if (!Array.isArray(npc.relationship.scoringHistory)) {
              errors.push(`NPC '${npcId}' relationship.scoringHistory must be an array.`);
            } else {
              const HISTORY_KEYS = ['exchangeId', 'timestamp', 'shifted', 'reason', 'impact', 'source', 'rawDeltas', 'appliedDeltas', 'resultingScores', 'milestones', 'axisSupport'];
              const REL_AXES = ['trust', 'affection', 'desire', 'tension'];
              for (let i = 0; i < npc.relationship.scoringHistory.length; i++) {
                const h = npc.relationship.scoringHistory[i];
                if (!h || typeof h !== 'object' || Array.isArray(h)) {
                  errors.push(`NPC '${npcId}' relationship.scoringHistory[${i}] must be an object.`);
                  continue;
                }
                for (const key of Object.keys(h)) {
                  if (!HISTORY_KEYS.includes(key)) errors.push(`NPC '${npcId}' relationship.scoringHistory[${i}] contains unknown key '${key}'.`);
                }
                if (h.exchangeId !== null && (typeof h.exchangeId !== 'string' || h.exchangeId.trim() === '')) {
                  errors.push(`NPC '${npcId}' relationship.scoringHistory[${i}].exchangeId must be null or a non-empty string.`);
                }
                if (typeof h.timestamp !== 'string' || h.timestamp.trim() === '') {
                  errors.push(`NPC '${npcId}' relationship.scoringHistory[${i}].timestamp must be a non-empty string.`);
                }
                if (typeof h.shifted !== 'boolean') errors.push(`NPC '${npcId}' relationship.scoringHistory[${i}].shifted must be boolean.`);
                for (const textKey of ['reason', 'impact']) {
                  if (h[textKey] !== null && h[textKey] !== undefined && (typeof h[textKey] !== 'string' || h[textKey].trim() === '')) {
                    errors.push(`NPC '${npcId}' relationship.scoringHistory[${i}].${textKey} must be null or a non-empty string.`);
                  }
                }
                if (h.source !== null && h.source !== undefined) {
                  if (!h.source || typeof h.source !== 'object' || Array.isArray(h.source) || typeof h.source.sourceRef !== 'string' || typeof h.source.excerpt !== 'string' || h.source.sourceRef.trim() === '' || h.source.excerpt.trim() === '') {
                    errors.push(`NPC '${npcId}' relationship.scoringHistory[${i}].source must be null or a concrete SourceReference.`);
                  }
                }
                for (const mapKey of ['rawDeltas', 'appliedDeltas', 'resultingScores']) {
                  const map = h[mapKey];
                  if (!map || typeof map !== 'object' || Array.isArray(map)) {
                    errors.push(`NPC '${npcId}' relationship.scoringHistory[${i}].${mapKey} must be an axis map.`);
                    continue;
                  }
                  for (const key of Object.keys(map)) {
                    if (!REL_AXES.includes(key)) errors.push(`NPC '${npcId}' relationship.scoringHistory[${i}].${mapKey} contains unknown axis '${key}'.`);
                  }
                  for (const axis of REL_AXES) {
                    if (typeof map[axis] !== 'number' || !Number.isFinite(map[axis])) {
                      errors.push(`NPC '${npcId}' relationship.scoringHistory[${i}].${mapKey}.${axis} must be a finite number.`);
                    }
                  }
                }
                if (!Array.isArray(h.milestones) || !h.milestones.every((m) => typeof m === 'string' && m.trim() !== '')) {
                  errors.push(`NPC '${npcId}' relationship.scoringHistory[${i}].milestones must be an array of non-empty strings.`);
                }
                if (h.axisSupport !== null && h.axisSupport !== undefined && (!h.axisSupport || typeof h.axisSupport !== 'object' || Array.isArray(h.axisSupport))) {
                  errors.push(`NPC '${npcId}' relationship.scoringHistory[${i}].axisSupport must be null or an object.`);
                }
              }
            }
          }
        }
      }

      if (!npc.development || typeof npc.development !== 'object' || Array.isArray(npc.development)) {
        errors.push(`NPC '${npcId}' must have a development container.`);
      } else {
        const { observations, acceptedSupport, reviewReceipts } = npc.development;
        if (!Array.isArray(observations)) {
          errors.push(`NPC '${npcId}' development.observations must be an array.`);
        } else {
          for (let i = 0; i < observations.length; i++) {
            const obsVal = validatePersistedObservationRecord(observations[i]);
            if (!obsVal.valid) {
              errors.push(`NPC '${npcId}' development.observations[${i}]: ${obsVal.error}`);
            }
          }
        }

        if (!Array.isArray(acceptedSupport)) {
          errors.push(`NPC '${npcId}' development.acceptedSupport must be an array.`);
        } else {
          for (let i = 0; i < acceptedSupport.length; i++) {
            const suppVal = validatePersistedAcceptedSupportRecord(acceptedSupport[i]);
            if (!suppVal.valid) {
              errors.push(`NPC '${npcId}' development.acceptedSupport[${i}]: ${suppVal.error}`);
            }
          }
        }

        if (!Array.isArray(reviewReceipts)) {
          errors.push(`NPC '${npcId}' development.reviewReceipts must be an array.`);
        } else {
          const ALLOWED_PERSISTED_RECEIPT_KEYS = [
            'targetId',
            'status',
            'sourceScope',
            'committedAt',
            'reason',
            'notes',
            'summary',
            'restricted',
            'fieldSubset',
          ];
          for (let i = 0; i < reviewReceipts.length; i++) {
            const r = reviewReceipts[i];
            if (!r || typeof r !== 'object' || Array.isArray(r)) {
              errors.push(`NPC '${npcId}' development.reviewReceipts[${i}] must be an object.`);
              continue;
            }
            for (const k of Object.keys(r)) {
              if (!ALLOWED_PERSISTED_RECEIPT_KEYS.includes(k)) {
                errors.push(`NPC '${npcId}' development.reviewReceipts[${i}] contains unknown key '${k}'.`);
              }
            }
            if (typeof r.targetId !== 'string' || r.targetId.trim() === '') {
              errors.push(`NPC '${npcId}' development.reviewReceipts[${i}] requires non-empty string 'targetId'.`);
            }
            if (!RECEIPT_STATUSES.includes(r.status)) {
              errors.push(`NPC '${npcId}' development.reviewReceipts[${i}] invalid status '${r.status}'. Allowed: ${RECEIPT_STATUSES.join(', ')}.`);
            }
            if (!Array.isArray(r.sourceScope) || r.sourceScope.length === 0 || !r.sourceScope.every((s) => typeof s === 'string' && s.trim() !== '')) {
              errors.push(`NPC '${npcId}' development.reviewReceipts[${i}] 'sourceScope' must be a non-empty array of non-empty strings.`);
            }
            if (typeof r.committedAt !== 'string' || r.committedAt.trim() === '') {
              errors.push(`NPC '${npcId}' development.reviewReceipts[${i}] 'committedAt' must be a non-empty string.`);
            }
            if (r.restricted !== undefined && typeof r.restricted !== 'boolean') {
              errors.push(`NPC '${npcId}' development.reviewReceipts[${i}] 'restricted' must be a boolean.`);
            }
            if (r.restricted === true) {
              if (!Array.isArray(r.fieldSubset) || r.fieldSubset.length === 0 || !r.fieldSubset.every((f) => isDurableDossierField(f))) {
                errors.push(`NPC '${npcId}' development.reviewReceipts[${i}] restricted receipt requires non-empty 'fieldSubset' array of eligible durable fields.`);
              }
            } else if (r.fieldSubset !== undefined) {
              if (!Array.isArray(r.fieldSubset) || !r.fieldSubset.every((f) => isDurableDossierField(f))) {
                errors.push(`NPC '${npcId}' development.reviewReceipts[${i}] 'fieldSubset' must be an array of eligible durable fields.`);
              }
            }
            if (r.reason !== undefined && (typeof r.reason !== 'string' || r.reason.trim() === '')) {
              errors.push(`NPC '${npcId}' development.reviewReceipts[${i}] 'reason' must be a non-empty string when supplied.`);
            }
            if (r.notes !== undefined && (typeof r.notes !== 'string' || r.notes.trim() === '')) {
              errors.push(`NPC '${npcId}' development.reviewReceipts[${i}] 'notes' must be a non-empty string when supplied.`);
            }
            if (r.summary !== undefined && (typeof r.summary !== 'string' || r.summary.trim() === '')) {
              errors.push(`NPC '${npcId}' development.reviewReceipts[${i}] 'summary' must be a non-empty string when supplied.`);
            }
          }
        }
      }
    }

    // Check tombstone and active NPC overlap (Item 10)
    if (state.tombstones && typeof state.tombstones === 'object') {
      for (const tId of Object.keys(state.tombstones)) {
        if (state.npcs[tId]) {
          errors.push(`NPC '${tId}' cannot exist simultaneously in active state.npcs and state.tombstones.`);
        }
      }
    }
  }

  if (!state.tombstones || typeof state.tombstones !== 'object' || Array.isArray(state.tombstones)) {
    errors.push("State 'tombstones' must be an object map.");
  } else {
    for (const [tId, tomb] of Object.entries(state.tombstones)) {
      if (!tomb || typeof tomb !== 'object' || Array.isArray(tomb)) {
        errors.push(`State tombstones['${tId}'] must be an object.`);
        continue;
      }
      if (typeof tomb.deletedAt !== 'string' || tomb.deletedAt.trim() === '') {
        errors.push(`State tombstones['${tId}'] requires non-empty string 'deletedAt'.`);
      }
      if (typeof tomb.reason !== 'string' || tomb.reason.trim() === '') {
        errors.push(`State tombstones['${tId}'] requires non-empty string 'reason'.`);
      }
    }
  }

  if (!state.dedup || typeof state.dedup !== 'object' || Array.isArray(state.dedup)) {
    errors.push("State 'dedup' must be an object.");
  } else if (!Array.isArray(state.dedup.processedSourceKeys)) {
    errors.push("State 'dedup.processedSourceKeys' must be an array.");
  } else {
    for (let i = 0; i < state.dedup.processedSourceKeys.length; i++) {
      const key = state.dedup.processedSourceKeys[i];
      if (typeof key !== 'string' || key.trim() === '') {
        errors.push(`State dedup.processedSourceKeys[${i}] must be a non-empty string.`);
      }
    }
  }

  if (!state.pendingReview || typeof state.pendingReview !== 'object' || Array.isArray(state.pendingReview)) {
    errors.push("State 'pendingReview' must be an object.");
  } else if (!Array.isArray(state.pendingReview.entries)) {
    errors.push("State 'pendingReview.entries' must be an array.");
  } else {
    const ALLOWED_PENDING_ENTRY_KEYS = [
      'id',
      'targetId',
      'sourceScope',
      'exchangeId',
      'reason',
      'createdAt',
      'priority',
      'fieldSubset',
      'metadata',
    ];
    for (let i = 0; i < state.pendingReview.entries.length; i++) {
      const e = state.pendingReview.entries[i];
      if (!e || typeof e !== 'object' || Array.isArray(e)) {
        errors.push(`State pendingReview.entries[${i}] must be an object.`);
        continue;
      }
      for (const ek of Object.keys(e)) {
        if (!ALLOWED_PENDING_ENTRY_KEYS.includes(ek)) {
          errors.push(`State pendingReview.entries[${i}] contains unknown key '${ek}'.`);
        }
      }
      if (typeof e.targetId !== 'string' || e.targetId.trim() === '') {
        errors.push(`State pendingReview.entries[${i}] requires non-empty string 'targetId'.`);
      }
      const hasSourceScope = Array.isArray(e.sourceScope) && e.sourceScope.length > 0 && e.sourceScope.every((s) => typeof s === 'string' && s.trim() !== '');
      const hasExchangeId = typeof e.exchangeId === 'string' && e.exchangeId.trim() !== '';
      if (!hasSourceScope && !hasExchangeId) {
        errors.push(`State pendingReview.entries[${i}] requires non-empty 'sourceScope' array or 'exchangeId' string.`);
      }
    }
  }

  if (!state.history || typeof state.history !== 'object' || Array.isArray(state.history)) {
    errors.push("State 'history' must be an object.");
  } else if (!Array.isArray(state.history.checkpoints)) {
    errors.push("State 'history.checkpoints' must be an array.");
  } else {
    const ALLOWED_CHECKPOINT_KEYS = [
      'id',
      'commitRevision',
      'timestamp',
      'sourceDependencies',
      'operation',
      'npcs',
      'tombstones',
      'dedup',
      'pendingReview',
      'userMetadata',
    ];
    for (let i = 0; i < state.history.checkpoints.length; i++) {
      const chk = state.history.checkpoints[i];
      if (!chk || typeof chk !== 'object' || Array.isArray(chk)) {
        errors.push(`State history.checkpoints[${i}] must be an object.`);
        continue;
      }
      for (const ck of Object.keys(chk)) {
        if (!ALLOWED_CHECKPOINT_KEYS.includes(ck)) {
          errors.push(`State history.checkpoints[${i}] contains unknown key '${ck}'.`);
        }
      }
      if (typeof chk.id !== 'string' || chk.id.trim() === '') {
        errors.push(`State history.checkpoints[${i}] requires non-empty string 'id'.`);
      }
      if (typeof chk.commitRevision !== 'number' || !Number.isInteger(chk.commitRevision) || chk.commitRevision < 0) {
        errors.push(`State history.checkpoints[${i}] requires non-negative integer 'commitRevision'.`);
      }
      if (typeof chk.timestamp !== 'string' || chk.timestamp.trim() === '') {
        errors.push(`State history.checkpoints[${i}] requires non-empty string 'timestamp'.`);
      }
      if (!Array.isArray(chk.sourceDependencies)) {
        errors.push(`State history.checkpoints[${i}] requires 'sourceDependencies' array.`);
      } else {
        const ALLOWED_DEP_KEYS = ['sourceRef', 'targetField', 'writer', 'segmentKind', 'capturedProvenance'];
        for (let dIdx = 0; dIdx < chk.sourceDependencies.length; dIdx++) {
          const dep = chk.sourceDependencies[dIdx];
          if (typeof dep === 'string') {
            if (dep.trim() === '') {
              errors.push(`State history.checkpoints[${i}].sourceDependencies[${dIdx}] cannot be an empty string.`);
            }
          } else if (dep && typeof dep === 'object' && !Array.isArray(dep)) {
            if (dep.excerpt !== undefined) {
              errors.push(`State history.checkpoints[${i}].sourceDependencies[${dIdx}] cannot persist raw excerpt (compactness violation).`);
            }
            for (const dk of Object.keys(dep)) {
              if (!ALLOWED_DEP_KEYS.includes(dk)) {
                errors.push(`State history.checkpoints[${i}].sourceDependencies[${dIdx}] contains unknown key '${dk}'.`);
              }
            }
            if (typeof dep.sourceRef !== 'string' || dep.sourceRef.trim() === '') {
              errors.push(`State history.checkpoints[${i}].sourceDependencies[${dIdx}] requires non-empty string 'sourceRef'.`);
            }
            if (!dep.capturedProvenance || typeof dep.capturedProvenance !== 'object' || Array.isArray(dep.capturedProvenance)) {
              errors.push(`State history.checkpoints[${i}].sourceDependencies[${dIdx}] requires 'capturedProvenance' object.`);
            } else {
              const prov = { ...dep.capturedProvenance };
              if (prov.swipe === null) delete prov.swipe;
              if (prov.revision === null) delete prov.revision;
              const pVal = validateOwnedSourceRecord(prov);
              if (!pVal.valid) {
                errors.push(`State history.checkpoints[${i}].sourceDependencies[${dIdx}].capturedProvenance invalid: ${pVal.error}`);
              }
            }
          } else {
            errors.push(`State history.checkpoints[${i}].sourceDependencies[${dIdx}] must be a non-empty string or captured dependency object.`);
          }
        }
      }
      if (!chk.operation || typeof chk.operation !== 'object' || typeof chk.operation.writer !== 'string') {
        errors.push(`State history.checkpoints[${i}] requires valid 'operation' object with 'writer'.`);
      }
      if (!chk.npcs || typeof chk.npcs !== 'object' || Array.isArray(chk.npcs)) {
        errors.push(`State history.checkpoints[${i}] requires 'npcs' snapshot object.`);
      }
      if (!chk.tombstones || typeof chk.tombstones !== 'object' || Array.isArray(chk.tombstones)) {
        errors.push(`State history.checkpoints[${i}] requires 'tombstones' snapshot object.`);
      }
      if (!chk.dedup || typeof chk.dedup !== 'object' || !Array.isArray(chk.dedup.processedSourceKeys)) {
        errors.push(`State history.checkpoints[${i}] requires 'dedup' snapshot object.`);
      }
      if (!chk.pendingReview || typeof chk.pendingReview !== 'object' || !Array.isArray(chk.pendingReview.entries)) {
        errors.push(`State history.checkpoints[${i}] requires 'pendingReview' snapshot object.`);
      }
      if (!chk.userMetadata || typeof chk.userMetadata !== 'object' || Array.isArray(chk.userMetadata)) {
        errors.push(`State history.checkpoints[${i}] requires 'userMetadata' snapshot object.`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Deep clones a state object deterministically.
 *
 * @param {object} state
 * @returns {object} Deep copy of state
 */
export function cloneState(state) {
  return structuredClone(state);
}
