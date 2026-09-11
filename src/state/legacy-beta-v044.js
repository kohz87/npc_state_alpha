/**
 * NPC State Alpha — narrow legacy NPC State Beta v0.4.44 compatibility adapter.
 *
 * Authoritative compatibility evidence:
 * - kohz87/npc_state_beta commit a34f5f27385b6fba75b8ff5832015ba66ea4d0c2
 * - v03/schema.js: NPC_STATE_VERSION 0.4.44, schema version 1
 * - v03/bundle.js: npc_state_v3_bundle format version 1
 *
 * This is an Alpha-owned clean-room translation boundary. It does not import,
 * execute, or depend on Beta runtime code and never scans Beta storage.
 */

import { createInitialState, createDefaultNpcRecord, validateState, cloneState } from './schema.js';
import { createCheckpoint, IMPORT_BASELINE_MODE } from './checkpoints.js';

export const LEGACY_BETA_V044 = Object.freeze({
  appVersion: '0.4.44',
  format: 'npc_state_v3_bundle',
  formatVersion: 1,
  schemaVersion: 1,
  sourceRepository: 'kohz87/npc_state_beta',
  sourceCommit: 'a34f5f27385b6fba75b8ff5832015ba66ea4d0c2',
  schemaOwner: 'v03/schema.js',
  serializerOwner: 'v03/bundle.js',
});

export const LEGACY_BETA_V044_IMPORT_CONFIRMATION = 'IMPORT_BETA_V044_INTO_EMPTY_ALPHA';

const ROOT_KEYS = new Set(['format', 'formatVersion', 'appVersion', 'schemaVersion', 'bundleType', 'source', 'data']);
const DATA_KEYS = new Set(['npcs', 'socialGraph', 'familySlots', 'suppressedNames', 'deletedNpcIds']);
const BUNDLE_TYPES = new Set(['full-chat', 'npc']);
const UNSAFE_OBJECT_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

function compatibilityError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textOrNull(value) {
  if (typeof value !== 'string') return null;
  const valueTrimmed = value.trim();
  return valueTrimmed ? valueTrimmed : null;
}

function stringList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim());
}

function normalizedName(value) {
  return String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, ' ')
    .trim();
}

function requireArray(data, key) {
  if (!Array.isArray(data?.[key])) {
    throw compatibilityError('legacy_beta_invalid_data', `NPC State Beta v0.4.44 bundle data.${key} must be an array.`);
  }
}

function safeStableId(value) {
  const id = typeof value === 'string' ? value.trim() : '';
  if (!id) throw compatibilityError('legacy_beta_missing_id', 'Every legacy NPC requires a non-empty stable id.');
  if (UNSAFE_OBJECT_KEYS.has(id)) {
    throw compatibilityError('legacy_beta_unsafe_id', `Legacy NPC id '${id}' is not safe for Alpha object storage.`);
  }
  return id;
}

function canonicalRelationship(value) {
  const source = isObject(value) ? value : {};
  const result = {};
  for (const axis of ['trust', 'affection', 'desire', 'tension']) {
    const number = Number(source[axis]);
    if (!Number.isFinite(number)) {
      throw compatibilityError('legacy_beta_invalid_relationship', `Legacy relationship axis '${axis}' must be finite.`);
    }
    result[axis] = number;
  }
  return { ...result, lastEvaluationExchange: null };
}

function mapAppearanceForms(npcId, rawForms, requestedCurrentForm, omitted) {
  const forms = [];
  const byName = new Map();
  for (const [index, raw] of (Array.isArray(rawForms) ? rawForms : []).entries()) {
    if (!isObject(raw)) continue;
    const name = textOrNull(raw.name);
    const description = textOrNull(raw.appearance);
    if (!name || !description) continue;
    const key = normalizedName(name);
    if (!key || byName.has(key)) continue;
    const formId = `legacy-beta-v044:${encodeURIComponent(npcId)}:form:${index + 1}`;
    const form = { formId, name, description };
    byName.set(key, form);
    forms.push(form);
  }
  const currentKey = normalizedName(requestedCurrentForm);
  const currentForm = currentKey ? (byName.get(currentKey)?.formId || null) : null;
  if (currentKey && !currentForm) omitted.push(`npc:${npcId}:currentForm(unresolved legacy form name)`);
  return { forms, currentForm };
}

function mappedMemoryId(npcId, index) {
  return `legacy-beta-v044:${encodeURIComponent(npcId)}:memory:${index + 1}`;
}

function mappedRelationId(kind, ownerId, index) {
  return `legacy-beta-v044:${kind}:${encodeURIComponent(ownerId)}:${index + 1}`;
}

function addRelation(npc, relation, seen) {
  const relationText = textOrNull(relation.relationship);
  const description = textOrNull(relation.description);
  if (!relationText && !description) return false;
  const key = `${npc.id}\0${relation.targetId}\0${normalizedName(relationText || description)}`;
  if (seen.has(key)) return false;
  seen.add(key);
  npc.nonPlayerRelationships.push({
    relationId: relation.relationId,
    targetId: relation.targetId,
    ...(relationText ? { relationship: relationText } : {}),
    ...(description ? { description } : {}),
  });
  return true;
}

function inspectUnsupportedNpcData(raw, npcId, omitted) {
  const listCounts = [
    ['keyRelationships', raw.keyRelationships],
    ['relationshipHistory', raw.relationshipHistory],
    ['relationshipEvidenceHistory', raw.relationshipEvidenceHistory],
    ['relationshipDiagnostics', raw.relationshipDiagnostics],
    ['relationshipMilestones', raw.relationshipMilestones],
    ['profileEvolutionEvidence', raw.profileEvolutionEvidence],
    ['lifeStateDiagnostics', raw.lifeStateDiagnostics],
    ['manualProfileFields', raw.manualProfileFields],
  ];
  for (const [field, value] of listCounts) {
    if (Array.isArray(value) && value.length > 0) omitted.push(`npc:${npcId}:${field}(${value.length})`);
  }
  if (raw.lastRelationshipChange && isObject(raw.lastRelationshipChange)) omitted.push(`npc:${npcId}:lastRelationshipChange`);
  if (raw.relationshipProgress && isObject(raw.relationshipProgress) && Object.values(raw.relationshipProgress).some((value) => Number(value) !== 0)) {
    omitted.push(`npc:${npcId}:relationshipProgress`);
  }
  if (raw.relationshipEvidence && isObject(raw.relationshipEvidence)) omitted.push(`npc:${npcId}:relationshipEvidence`);
  if (raw.relationshipVerifiedSources && isObject(raw.relationshipVerifiedSources)) omitted.push(`npc:${npcId}:relationshipVerifiedSources`);
  if (raw.portrait && isObject(raw.portrait)) omitted.push(`npc:${npcId}:portrait(object shape unsupported)`);
  if (raw.archived === true && raw.lifeState !== 'dead') omitted.push(`npc:${npcId}:archived(non-death archive state)`);
  for (const key of ['birthdayProvenance', 'ageProgressionBaselineAge', 'lifeStateCertainty', 'lifeStateReason', 'retentionProtected', 'minor', 'manual', 'createdAt', 'updatedAt', 'firstSeenMessageId', 'lastSeenMessageId', 'lastInteractionMessageId', 'lastActivityTurn', 'lastActivityMessageId', 'lastActivityReason', 'seenCount', 'worldActive']) {
    const value = raw[key];
    const meaningful = value !== undefined && value !== null && value !== '' && value !== false && value !== 0;
    if (meaningful) omitted.push(`npc:${npcId}:${key}`);
  }
}

/**
 * Parse and strictly identify the one authoritative legacy format supported by
 * Alpha 0.1.2. Unknown app/schema/format combinations fail closed.
 */
export function parseLegacyBetaV044Bundle(input) {
  let raw = input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) throw compatibilityError('legacy_beta_empty', 'Legacy bundle is empty.');
    try {
      raw = JSON.parse(trimmed);
    } catch (error) {
      throw compatibilityError('legacy_beta_invalid_json', `Legacy bundle is not valid JSON: ${error.message}`);
    }
  }
  if (!isObject(raw)) throw compatibilityError('legacy_beta_invalid_root', 'Legacy bundle root must be a JSON object.');
  const cloned = cloneState(raw);
  if (cloned.format !== LEGACY_BETA_V044.format) {
    throw compatibilityError('legacy_beta_unsupported_format', `Unsupported legacy bundle format '${String(cloned.format || 'missing')}'.`);
  }
  if (Number(cloned.formatVersion) !== LEGACY_BETA_V044.formatVersion) {
    throw compatibilityError('legacy_beta_unsupported_format_version', `Unsupported legacy bundle format version '${String(cloned.formatVersion)}'.`);
  }
  if (String(cloned.appVersion || '') !== LEGACY_BETA_V044.appVersion) {
    throw compatibilityError('legacy_beta_unsupported_app_version', `Unsupported legacy Beta app version '${String(cloned.appVersion || 'missing')}'. Alpha 0.1.2 supports only 0.4.44.`);
  }
  if (Number(cloned.schemaVersion) !== LEGACY_BETA_V044.schemaVersion) {
    throw compatibilityError('legacy_beta_unsupported_schema_version', `Unsupported legacy Beta schema version '${String(cloned.schemaVersion)}'.`);
  }
  if (!BUNDLE_TYPES.has(String(cloned.bundleType || ''))) {
    throw compatibilityError('legacy_beta_unsupported_bundle_type', `Unsupported legacy bundle type '${String(cloned.bundleType || 'missing')}'.`);
  }
  if (!isObject(cloned.data)) throw compatibilityError('legacy_beta_invalid_data', 'Legacy bundle data must be an object.');
  for (const key of ['npcs', 'socialGraph', 'suppressedNames', 'deletedNpcIds']) requireArray(cloned.data, key);
  if (cloned.data.familySlots !== undefined && !Array.isArray(cloned.data.familySlots)) {
    throw compatibilityError('legacy_beta_invalid_data', 'Legacy bundle data.familySlots must be an array when supplied.');
  }
  if (cloned.bundleType === 'npc' && cloned.data.npcs.length !== 1) {
    throw compatibilityError('legacy_beta_invalid_npc_bundle', 'A legacy selected-NPC bundle must contain exactly one NPC dossier.');
  }

  const ids = new Set();
  const names = new Set();
  for (const npc of cloned.data.npcs) {
    if (!isObject(npc)) throw compatibilityError('legacy_beta_invalid_npc', 'Legacy bundle contains a non-object NPC dossier.');
    const id = safeStableId(npc.id);
    const name = textOrNull(npc.name);
    if (!name) throw compatibilityError('legacy_beta_missing_name', `Legacy NPC '${id}' is missing its canonical name.`);
    if (ids.has(id)) throw compatibilityError('legacy_beta_duplicate_id', `Legacy bundle contains duplicate stable NPC id '${id}'.`);
    ids.add(id);
    const nameKey = normalizedName(name);
    if (names.has(nameKey)) throw compatibilityError('legacy_beta_duplicate_name', `Legacy bundle contains duplicate canonical NPC name '${name}'.`);
    names.add(nameKey);
    if (!['alive', 'dead'].includes(String(npc.lifeState || ''))) {
      throw compatibilityError('legacy_beta_unknown_lifecycle', `Legacy NPC '${id}' has lifecycle '${String(npc.lifeState || 'missing')}', which Alpha cannot import without guessing alive/dead state.`);
    }
    canonicalRelationship(npc.relationship);
  }

  const allowedRootExtras = Object.keys(cloned).filter((key) => !ROOT_KEYS.has(key));
  const allowedDataExtras = Object.keys(cloned.data).filter((key) => !DATA_KEYS.has(key));
  return {
    format: cloned.format,
    formatVersion: Number(cloned.formatVersion),
    appVersion: String(cloned.appVersion),
    schemaVersion: Number(cloned.schemaVersion),
    bundleType: String(cloned.bundleType),
    source: isObject(cloned.source) ? cloneState(cloned.source) : {},
    data: {
      npcs: cloneState(cloned.data.npcs),
      socialGraph: cloneState(cloned.data.socialGraph),
      familySlots: cloneState(cloned.data.familySlots || []),
      suppressedNames: cloneState(cloned.data.suppressedNames),
      deletedNpcIds: cloneState(cloned.data.deletedNpcIds),
    },
    ignoredRootKeys: allowedRootExtras,
    ignoredDataKeys: allowedDataExtras,
  };
}

function buildAlphaState(parsed, importedAt, historyBoundary = null) {
  const state = createInitialState();
  const omitted = [];
  const mapped = [];

  for (const raw of parsed.data.npcs) {
    const id = safeStableId(raw.id);
    const name = textOrNull(raw.name);
    const aliases = stringList(raw.aliases).filter((alias) => normalizedName(alias) !== normalizedName(name));
    const { forms, currentForm } = mapAppearanceForms(id, raw.appearanceForms, raw.currentForm, omitted);
    const behavior = stringList(raw.behaviorProfile);
    const memories = stringList(raw.memories).map((summary, index) => ({
      memoryId: mappedMemoryId(id, index),
      summary,
    }));
    const npc = createDefaultNpcRecord(id, name, {
      aliases,
      identityKind: 'named',
      lifeState: raw.lifeState,
      present: raw.lifeState === 'alive' && raw.present === true,
      activeInExchange: false,
      mood: textOrNull(raw.mood),
      location: textOrNull(raw.location),
      goal: textOrNull(raw.goal),
      status: textOrNull(raw.status),
      currentForm,
      relationship: canonicalRelationship(raw.relationship),
      relationshipDynamic: textOrNull(raw.relationshipSummary),
      canonicalAppearance: textOrNull(raw.appearance),
      appearanceForms: forms,
      personality: textOrNull(raw.personality) ? { value: textOrNull(raw.personality) } : null,
      behavioralProfile: behavior.length ? behavior.join('\n') : null,
      speech: textOrNull(raw.speech),
      mannerisms: stringList(raw.mannerisms),
      role: textOrNull(raw.role),
      species: textOrNull(raw.species),
      background: textOrNull(raw.background),
      actualAge: textOrNull(raw.age),
      apparentAge: textOrNull(raw.apparentAge),
      birthday: textOrNull(raw.birthday),
      importantMemories: memories,
      nonPlayerRelationships: [],
      importance: Number.isFinite(Number(raw.importance)) ? Number(raw.importance) : null,
      locks: {},
      manualCorrections: {},
      development: { observations: [], acceptedSupport: [], reviewReceipts: [] },
    });
    state.npcs[id] = npc;
    inspectUnsupportedNpcData(raw, id, omitted);
    mapped.push(id);
  }

  const importedIds = new Set(mapped);
  const relationSeen = new Set();
  let socialIndex = 0;
  for (const edge of parsed.data.socialGraph) {
    if (!isObject(edge)) continue;
    const fromId = typeof edge.fromId === 'string' ? edge.fromId.trim() : '';
    const toId = typeof edge.toId === 'string' ? edge.toId.trim() : '';
    const relationship = textOrNull(edge.relation);
    if (!fromId || !toId || !relationship) continue;
    if (!importedIds.has(fromId) || !importedIds.has(toId) || fromId === toId) {
      omitted.push(`socialGraph:${fromId || '?'}->${toId || '?'}(endpoint unavailable)`);
      continue;
    }
    socialIndex++;
    addRelation(state.npcs[fromId], {
      relationId: mappedRelationId('social', fromId, socialIndex),
      targetId: toId,
      relationship,
      description: textOrNull(edge.summary),
    }, relationSeen);
  }

  let familyIndex = 0;
  for (const slot of parsed.data.familySlots) {
    if (!isObject(slot)) continue;
    const ownerId = typeof slot.ownerId === 'string' ? slot.ownerId.trim() : '';
    const relationship = textOrNull(slot.relation);
    if (!importedIds.has(ownerId) || !relationship) continue;
    for (const targetId of stringList(slot.resolvedNpcIds)) {
      if (!importedIds.has(targetId) || targetId === ownerId) {
        omitted.push(`familySlot:${ownerId}->${targetId || '?'}(endpoint unavailable)`);
        continue;
      }
      familyIndex++;
      addRelation(state.npcs[ownerId], {
        relationId: mappedRelationId('family', ownerId, familyIndex),
        targetId,
        relationship,
        description: textOrNull(slot.descriptor),
      }, relationSeen);
    }
    const unresolvedNames = stringList(slot.memberNames);
    if (unresolvedNames.length) omitted.push(`familySlot:${ownerId}:memberNames(${unresolvedNames.length}, no stable target id)`);
    if (textOrNull(slot.evidence)) omitted.push(`familySlot:${ownerId}:evidence(untrusted legacy provenance)`);
  }

  if (parsed.data.suppressedNames.length) omitted.push(`suppressedNames(${parsed.data.suppressedNames.length}, no Alpha canonical analogue)`);
  if (parsed.data.deletedNpcIds.length) omitted.push(`deletedNpcIds(${parsed.data.deletedNpcIds.length}, no historical delete metadata)`);
  if (parsed.ignoredRootKeys.length) omitted.push(`unknownRootKeys(${parsed.ignoredRootKeys.join(',')})`);
  if (parsed.ignoredDataKeys.length) omitted.push(`unknownDataKeys(${parsed.ignoredDataKeys.join(',')})`);

  createCheckpoint(state, {
    checkpointId: 'import_baseline_beta_v044',
    timestamp: importedAt,
    writer: 'runtime',
    mode: IMPORT_BASELINE_MODE,
    description: 'Explicit NPC State Beta v0.4.44 import baseline.',
    sourceDependencies: [],
    identityAssignments: [],
    historyBoundary: historyBoundary ? cloneState(historyBoundary) : null,
  });

  const validation = validateState(state);
  if (!validation.valid) {
    throw compatibilityError('legacy_beta_conversion_invalid', `Converted Alpha state is invalid: ${validation.errors.join('; ')}`);
  }
  return { state, omitted: [...new Set(omitted)].sort(), mappedNpcIds: mapped };
}

/**
 * Returns a non-mutating import summary. The target-state check is optional so
 * callers can preview the bundle before choosing a chat.
 */
export function previewLegacyBetaV044Import(input, { existingState = null } = {}) {
  const parsed = parseLegacyBetaV044Bundle(input);
  const conflict = existingState && !isEmptyAlphaImportTarget(existingState)
    ? 'alpha_state_not_empty'
    : null;
  const converted = buildAlphaState(parsed, '2000-01-01T00:00:00.000Z');
  return {
    success: !conflict,
    conflict,
    detected: {
      format: parsed.format,
      formatVersion: parsed.formatVersion,
      appVersion: parsed.appVersion,
      schemaVersion: parsed.schemaVersion,
      bundleType: parsed.bundleType,
    },
    authoritativeSource: cloneState(LEGACY_BETA_V044),
    npcCount: converted.mappedNpcIds.length,
    mappedNpcIds: [...converted.mappedNpcIds],
    omitted: [...converted.omitted],
    establishesImportBaseline: true,
    requiresEmptyAlphaState: true,
    requiresConfirmation: LEGACY_BETA_V044_IMPORT_CONFIRMATION,
  };
}

export function isEmptyAlphaImportTarget(state) {
  const validation = validateState(state);
  if (!validation.valid) return false;
  return Object.keys(state.npcs || {}).length === 0 &&
    Object.keys(state.tombstones || {}).length === 0 &&
    (state.dedup?.processedSourceKeys || []).length === 0 &&
    (state.pendingReview?.entries || []).length === 0 &&
    (state.history?.checkpoints || []).length === 0;
}

/**
 * Convert a supported bundle into a complete Alpha-native state plus a real
 * format-neutral import baseline. No storage is modified by this function.
 */
export function convertLegacyBetaV044ToAlpha(input, { importedAt = new Date().toISOString(), historyBoundary = null } = {}) {
  const timestamp = new Date(importedAt);
  if (!Number.isFinite(timestamp.getTime())) {
    throw compatibilityError('legacy_beta_invalid_import_time', 'Legacy import timestamp must be a valid date/time.');
  }
  const parsed = parseLegacyBetaV044Bundle(input);
  const converted = buildAlphaState(parsed, timestamp.toISOString(), historyBoundary);
  return {
    success: true,
    state: converted.state,
    preview: {
      success: true,
      conflict: null,
      detected: {
        format: parsed.format,
        formatVersion: parsed.formatVersion,
        appVersion: parsed.appVersion,
        schemaVersion: parsed.schemaVersion,
        bundleType: parsed.bundleType,
      },
      authoritativeSource: cloneState(LEGACY_BETA_V044),
      npcCount: converted.mappedNpcIds.length,
      mappedNpcIds: [...converted.mappedNpcIds],
      omitted: [...converted.omitted],
      establishesImportBaseline: true,
      requiresEmptyAlphaState: true,
      requiresConfirmation: LEGACY_BETA_V044_IMPORT_CONFIRMATION,
    },
  };
}

/**
 * Explicit, user-confirmed installation into an empty Alpha state. The source
 * bundle is never modified, and CAS/persistence semantics remain owned by the
 * supplied Alpha storage adapter.
 */
export async function installLegacyBetaV044Bundle({ storage, input, confirmation, importedAt = new Date().toISOString(), historyBoundary = null, emptyHostHistory = false }) {
  if (!storage || typeof storage.load !== 'function' || typeof storage.save !== 'function') {
    return { success: false, errorCode: 'legacy_beta_storage_required', error: 'A canonical Alpha storage adapter is required.' };
  }
  if (confirmation !== LEGACY_BETA_V044_IMPORT_CONFIRMATION) {
    return {
      success: false,
      errorCode: 'legacy_beta_confirmation_required',
      error: `Explicit confirmation '${LEGACY_BETA_V044_IMPORT_CONFIRMATION}' is required.`,
    };
  }
  if (!historyBoundary && emptyHostHistory !== true) {
    return {
      success: false,
      errorCode: 'legacy_beta_history_boundary_required',
      error: 'Legacy installation requires the current canonical host history boundary, or explicit emptyHostHistory=true for a genuinely empty chat.',
    };
  }
  let loaded;
  try {
    loaded = await storage.load();
  } catch (error) {
    return { success: false, errorCode: 'legacy_beta_storage_load_failed', error: error?.message || String(error) };
  }
  if (!isEmptyAlphaImportTarget(loaded.state)) {
    return {
      success: false,
      errorCode: 'legacy_beta_alpha_state_not_empty',
      error: 'Legacy import requires an empty Alpha state; existing Alpha NPC/history data is never silently merged or overwritten.',
    };
  }
  let converted;
  try {
    converted = convertLegacyBetaV044ToAlpha(input, { importedAt, historyBoundary });
  } catch (error) {
    return { success: false, errorCode: error?.code || 'legacy_beta_conversion_failed', error: error?.message || String(error) };
  }
  const saved = await storage.save(converted.state, loaded.revision);
  if (!saved?.success) {
    return {
      success: false,
      errorCode: saved?.conflict ? 'legacy_beta_cas_conflict' : 'legacy_beta_persistence_failed',
      conflict: saved?.conflict === true,
      error: saved?.error || 'Legacy import persistence failed.',
    };
  }
  return {
    success: true,
    revision: saved.revision,
    preview: converted.preview,
    importedNpcIds: [...converted.preview.mappedNpcIds],
    importBaselineMode: IMPORT_BASELINE_MODE,
  };
}
