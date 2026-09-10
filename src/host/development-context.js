/**
 * NPC State Alpha — S4 Development review context and batch selection
 *
 * Uses the existing S2 source resolver and S3 host provenance primitives. No
 * second evidence store or profile authority is introduced here.
 */

import {
  DURABLE_DOSSIER_FIELDS,
  WRITERS,
} from '../contract/registry.js';
import {
  DEVELOPMENT_MAX_BATCH_EXCHANGES,
  normalizeAlphaSettings,
} from '../contract/settings.js';
import {
  captureScopeDependency,
  stripMachineTrailer,
} from '../runtime/source-resolver.js';
import {
  computeContentFingerprint,
} from './fingerprint.js';
import {
  buildPrecedingLineage,
  getMessageSwipeId,
} from './sillytavern-adapter.js';

const BLOCKING_REVIEW_STATUSES = new Set(['failed', 'unavailable', 'deferred']);
const EXTRA_DISPATCH_REVISION_FIELDS = Object.freeze([
  'relationshipEvaluation',
  'lifeState',
  'currentForm',
]);

function timestampOf(value) {
  const ms = Date.parse(value || '');
  return Number.isFinite(ms) ? ms : 0;
}

function reviewBlockTimestamp(entry) {
  const metadata = entry?.metadata || {};
  return Math.max(
    timestampOf(metadata.lastReviewAt),
    timestampOf(metadata.lastFailureAt),
    timestampOf(metadata.lastUnavailableAt),
  );
}

function isBlockedEntry(entry) {
  return BLOCKING_REVIEW_STATUSES.has(entry?.metadata?.lastReviewStatus);
}

/**
 * Selects an oldest-first automatic/manual Development batch.
 * Distinct exchange IDs, not target-entry count, consume the six-exchange cap.
 */
export function selectDevelopmentBatch(state, rawSettings = {}, options = {}) {
  const settings = normalizeAlphaSettings(rawSettings);
  const manual = options.manual === true;
  if (!manual && !settings.developmentEnabled) return [];

  const entries = Array.isArray(state?.pendingReview?.entries)
    ? [...state.pendingReview.entries]
    : [];
  entries.sort((a, b) => timestampOf(a.createdAt) - timestampOf(b.createdAt) || String(a.id || '').localeCompare(String(b.id || '')));
  if (entries.length === 0) return [];

  const byTarget = new Map();
  for (const entry of entries) {
    if (!entry?.targetId) continue;
    if (!byTarget.has(entry.targetId)) byTarget.set(entry.targetId, []);
    byTarget.get(entry.targetId).push(entry);
  }

  const eligibleTargets = new Set();
  const retryBlockedTargets = new Set();
  for (const [targetId, targetEntries] of byTarget.entries()) {
    if (manual) {
      eligibleTargets.add(targetId);
      continue;
    }

    const newestCreated = Math.max(...targetEntries.map((entry) => timestampOf(entry.createdAt)));
    const latestBlock = Math.max(0, ...targetEntries.filter(isBlockedEntry).map(reviewBlockTimestamp));
    const freshEvidenceAfterBlock = latestBlock > 0 && newestCreated > latestBlock;
    const hasNewAdmission = targetEntries.some((entry) => entry.reason === 'new_admission' && !isBlockedEntry(entry));
    const distinctExchanges = new Set(targetEntries.filter((entry) => !isBlockedEntry(entry)).map((entry) => entry.exchangeId || entry.id));

    if (hasNewAdmission || distinctExchanges.size >= settings.developmentCadence || freshEvidenceAfterBlock) {
      eligibleTargets.add(targetId);
      if (freshEvidenceAfterBlock) retryBlockedTargets.add(targetId);
    }
  }

  const selected = [];
  const exchangeIds = new Set();
  for (const entry of entries) {
    if (!eligibleTargets.has(entry.targetId)) continue;
    if (!manual && isBlockedEntry(entry) && !retryBlockedTargets.has(entry.targetId)) continue;
    const exchangeId = entry.exchangeId || entry.id;
    if (!exchangeIds.has(exchangeId) && exchangeIds.size >= DEVELOPMENT_MAX_BATCH_EXCHANGES) {
      continue;
    }
    exchangeIds.add(exchangeId);
    selected.push(entry);
  }
  return selected;
}

function parseChatSourceRef(sourceRef, chatId) {
  const prefix = `chat:${chatId}:`;
  if (typeof sourceRef !== 'string' || !sourceRef.startsWith(prefix)) return null;
  const rawPosition = sourceRef.slice(prefix.length);
  if (!/^\d+$/.test(rawPosition)) return null;
  const position = Number(rawPosition);
  return Number.isSafeInteger(position) && position >= 0 ? position : null;
}

function expectedMetadataForPosition(entry, position) {
  const metadata = entry?.metadata || {};
  if (metadata.userPosition === position) {
    return {
      role: 'user',
      fingerprint: metadata.userFingerprint,
      swipe: metadata.userSwipe,
    };
  }
  if (metadata.assistantPosition === position) {
    return {
      role: 'assistant',
      fingerprint: metadata.assistantFingerprint,
      swipe: metadata.assistantSwipe,
    };
  }
  return null;
}

function createOwnedSourceRecord(chat, chatId, sourceRef, position) {
  const message = chat[position];
  if (!message || message.is_system || typeof message.mes !== 'string') {
    return { valid: false, reason: 'source_missing_or_system' };
  }
  const role = message.is_user ? 'user' : 'assistant';
  const canonicalText = role === 'assistant' ? stripMachineTrailer(message.mes) : message.mes;
  const fingerprint = computeContentFingerprint(canonicalText);
  const swipe = getMessageSwipeId(message);
  const precedingLineage = buildPrecedingLineage(chat, position);
  return {
    valid: true,
    record: {
      sourceRef,
      text: message.mes,
      provenance: {
        chatId,
        position,
        role,
        contentFingerprint: fingerprint,
        precedingLineage,
        swipe,
      },
    },
    canonicalText,
    role,
    fingerprint,
    swipe,
  };
}

/**
 * Reacquires exact pending source refs from the current host chat.
 * At dispatch it also verifies the immutable S3 fingerprints/swipes stored in
 * pending metadata. At late commit callers can disable that convenience check;
 * captured dependency revalidation remains authoritative in CommitCoordinator.
 */
export function buildDevelopmentExchangeContext({ chat, chatId, entries, verifyPendingMetadata = true }) {
  if (!Array.isArray(chat) || typeof chatId !== 'string' || chatId.trim() === '') {
    return { valid: false, error: 'Development source context requires active chat and chatId.' };
  }
  const sources = new Map();
  const expectedLineages = {};
  const sourceTexts = new Map();
  const unavailableEntries = [];
  const usableEntries = [];

  for (const entry of entries || []) {
    let entryValid = true;
    const scopes = Array.isArray(entry?.sourceScope) ? entry.sourceScope : [];
    if (scopes.length === 0) entryValid = false;

    for (const sourceRef of scopes) {
      const position = parseChatSourceRef(sourceRef, chatId);
      if (position === null) {
        entryValid = false;
        continue;
      }
      const resolved = createOwnedSourceRecord(chat, chatId, sourceRef, position);
      if (!resolved.valid) {
        entryValid = false;
        continue;
      }
      if (verifyPendingMetadata) {
        const expected = expectedMetadataForPosition(entry, position);
        if (!expected || expected.role !== resolved.role) {
          entryValid = false;
          continue;
        }
        if (expected.fingerprint && expected.fingerprint !== resolved.fingerprint) {
          entryValid = false;
          continue;
        }
        if (expected.swipe !== undefined && expected.swipe !== null && expected.swipe !== resolved.swipe) {
          entryValid = false;
          continue;
        }
      }
      const existing = sources.get(sourceRef);
      if (existing) {
        const existingProv = existing.provenance;
        if (
          existingProv.position !== resolved.record.provenance.position ||
          existingProv.contentFingerprint !== resolved.record.provenance.contentFingerprint ||
          existingProv.swipe !== resolved.record.provenance.swipe
        ) {
          entryValid = false;
          continue;
        }
      } else {
        sources.set(sourceRef, resolved.record);
        expectedLineages[sourceRef] = [...resolved.record.provenance.precedingLineage];
        sourceTexts.set(sourceRef, {
          role: resolved.role,
          text: resolved.canonicalText,
          position,
        });
      }
    }

    if (entryValid) usableEntries.push(entry);
    else unavailableEntries.push({ entry, reason: 'owned_source_unavailable_or_changed' });
  }

  // Remove source records used exclusively by unusable entries.
  const usedByUsable = new Set(usableEntries.flatMap((entry) => entry.sourceScope || []));
  for (const sourceRef of [...sources.keys()]) {
    if (!usedByUsable.has(sourceRef)) {
      sources.delete(sourceRef);
      delete expectedLineages[sourceRef];
      sourceTexts.delete(sourceRef);
    }
  }

  return {
    valid: true,
    exchangeContext: {
      chatId,
      sources,
      expectedLineages,
    },
    sourceTexts,
    usableEntries,
    unavailableEntries,
  };
}

function targetComparisonRecord(npc, fieldSubset = null, allowedSourceScope = null) {
  const restrictedFields = Array.isArray(fieldSubset) && fieldSubset.length > 0
    ? new Set(fieldSubset.map((field) => String(field).split('.')[0]))
    : null;
  const allowedSources = Array.isArray(allowedSourceScope) ? new Set(allowedSourceScope) : null;
  const fieldAllowed = (field) => !restrictedFields || restrictedFields.has(String(field).split('.')[0]);

  const current = {};
  for (const field of DURABLE_DOSSIER_FIELDS) {
    if (!fieldAllowed(field)) continue;
    const value = npc?.[field];
    if (value === null || value === undefined) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    current[field] = structuredClone(value);
  }
  const locked = Object.entries(npc?.locks || {})
    .filter(([field, value]) => value === true && fieldAllowed(field))
    .map(([field]) => field);
  const observations = Array.isArray(npc?.development?.observations)
    ? npc.development.observations
        .filter((obs) => fieldAllowed(obs.field))
        .filter((obs) => !allowedSources || allowedSources.has(obs?.source?.sourceRef))
        .slice(-12)
        .map((obs) => ({
          id: obs.id,
          field: obs.field,
          observation: obs.observation,
          disposition: obs.disposition,
          source: obs.source,
        }))
    : [];
  const acceptedSupport = Array.isArray(npc?.development?.acceptedSupport)
    ? npc.development.acceptedSupport
        .filter((support) => fieldAllowed(support.field))
        .slice(-12)
        .map((support) => ({
          field: support.field,
          fieldRevision: support.fieldRevision,
          supportingObservationIds: support.supportingObservationIds,
          sourceRefs: support.sourceRefs,
        }))
    : [];
  return {
    id: npc.id,
    name: npc.name,
    lifeState: npc.lifeState,
    current,
    relationshipAxesReadOnly: !restrictedFields || restrictedFields.has('relationshipDynamic') ? npc.relationship : undefined,
    currentFormReadOnly: !restrictedFields || restrictedFields.has('canonicalAppearance') || restrictedFields.has('appearanceForms')
      ? npc.currentForm
      : undefined,
    locks: locked,
    observations,
    acceptedSupport,
  };
}

function buildRevisionSnapshot(state, targetIds) {
  const snapshot = {};
  for (const targetId of targetIds) {
    const npc = state.npcs?.[targetId];
    if (!npc) continue;
    snapshot[targetId] = {};
    for (const field of [...DURABLE_DOSSIER_FIELDS, ...EXTRA_DISPATCH_REVISION_FIELDS]) {
      const revision = npc.fieldRevisions?.[field];
      if (Number.isInteger(revision) && revision > 0) snapshot[targetId][field] = revision;
    }
  }
  return snapshot;
}

/**
 * Builds a provider dispatch from a frozen durable state snapshot plus current
 * owned host sources. Captured dependencies and revisions are frozen BEFORE the
 * provider call; provider work can then run with no state lock held.
 */
export function buildDevelopmentDispatch({ state, chat, chatId, entries, settings: rawSettings = {} }) {
  const settings = normalizeAlphaSettings(rawSettings);
  const sourceResult = buildDevelopmentExchangeContext({
    chat,
    chatId,
    entries,
    verifyPendingMetadata: true,
  });
  if (!sourceResult.valid) return sourceResult;

  const usableTargetIds = new Set();
  const additionallyUnavailable = [];
  const finalEntries = [];
  for (const entry of sourceResult.usableEntries) {
    const npc = state?.npcs?.[entry.targetId];
    if (!npc || state?.tombstones?.[entry.targetId]) {
      additionallyUnavailable.push({ entry, reason: 'target_missing_or_tombstoned' });
      continue;
    }
    usableTargetIds.add(entry.targetId);
    finalEntries.push(entry);
  }

  const usedScopes = new Set(finalEntries.flatMap((entry) => entry.sourceScope || []));
  const filteredSources = new Map();
  const filteredTexts = new Map();
  const expectedLineages = {};
  for (const sourceRef of usedScopes) {
    const source = sourceResult.exchangeContext.sources.get(sourceRef);
    if (!source) continue;
    filteredSources.set(sourceRef, source);
    filteredTexts.set(sourceRef, sourceResult.sourceTexts.get(sourceRef));
    expectedLineages[sourceRef] = sourceResult.exchangeContext.expectedLineages[sourceRef];
  }
  const exchangeContext = { chatId, sources: filteredSources, expectedLineages };

  const capturedDependencies = [];
  for (const sourceRef of usedScopes) {
    const captured = captureScopeDependency(sourceRef, exchangeContext, { writer: WRITERS.DEVELOPMENT });
    if (!captured.valid) {
      return {
        valid: false,
        error: `Failed to capture Development source '${sourceRef}': ${captured.error}`,
        errorCode: captured.errorCode,
      };
    }
    capturedDependencies.push(captured.capturedDependency);
  }

  const targetIds = [...usableTargetIds];
  const targetSourceScope = {};
  const targetFieldSubset = {};
  for (const targetId of targetIds) {
    const targetEntries = finalEntries.filter((entry) => entry.targetId === targetId);
    targetSourceScope[targetId] = [...new Set(targetEntries.flatMap((entry) => entry.sourceScope || []))];
    const allRestricted = targetEntries.length > 0 && targetEntries.every(
      (entry) => Array.isArray(entry.fieldSubset) && entry.fieldSubset.length > 0,
    );
    targetFieldSubset[targetId] = allRestricted
      ? [...new Set(targetEntries.flatMap((entry) => entry.fieldSubset || []).map((field) => String(field).split('.')[0]))]
      : null;
  }

  const targets = targetIds.map((targetId) => targetComparisonRecord(
    state.npcs[targetId],
    targetFieldSubset[targetId],
    targetSourceScope[targetId],
  ));
  const targetObservationIds = {};
  const targetAcceptedFields = {};
  for (const target of targets) {
    targetObservationIds[target.id] = (target.observations || []).map((observation) => observation.id);
    targetAcceptedFields[target.id] = Object.keys(target.current || {});
  }

  const sourcesForPrompt = [...filteredTexts.entries()].map(([sourceRef, source]) => ({
    sourceRef,
    role: source.role,
    text: source.text,
  }));
  const prompt = buildDevelopmentPrompt({
    targets,
    targetSourceScope,
    targetFieldSubset,
    sources: sourcesForPrompt,
    settings,
  });

  return {
    valid: true,
    stateRevision: state.revision,
    entries: finalEntries,
    unavailableEntries: [...sourceResult.unavailableEntries, ...additionallyUnavailable],
    targetIds,
    targetSourceScope,
    targetFieldSubset,
    targetObservationIds,
    targetAcceptedFields,
    exchangeContext,
    capturedDependencies,
    revisionSnapshot: buildRevisionSnapshot(state, targetIds),
    prompt,
    settings,
  };
}

/**
 * Compact Development prompt. The complete durable-domain menu remains visible
 * so new facts are discoverable without keyword preclassification.
 */
export function buildDevelopmentPrompt({ targets, targetSourceScope, targetFieldSubset = {}, sources, settings }) {
  const domainMenu = DURABLE_DOSSIER_FIELDS.join(', ');
  const targetPayload = targets.map((target) => {
    const fieldSubset = Array.isArray(targetFieldSubset[target.id]) && targetFieldSubset[target.id].length > 0
      ? [...targetFieldSubset[target.id]]
      : null;
    return {
      ...target,
      requiredSourceScope: targetSourceScope[target.id] || [],
      restricted: Boolean(fieldSubset),
      ...(fieldSubset ? { requiredFieldSubset: fieldSubset } : {}),
    };
  });
  return [
    'You are NPC State Alpha Development Review. Return exactly one valid JSON object and no markdown/commentary.',
    'Use only the supplied owned narrative sources as evidence. Exact excerpts must occur in the labeled source text.',
    `Wire version: "1". Eligible durable domains: ${domainMenu}.`,
    'Never write immediate-owned fields: name, aliases, identityKind, present, activeInExchange, offscreenActivity, mood, location, goal, status, currentPresentation, currentForm, relationshipEvaluation, lifeState.',
    'For every supplied target, return one reviewReceipts entry whose targetId matches and whose sourceScope covers that target requiredSourceScope. Use status "reviewed_no_proposals" when no durable proposal is warranted.',
    'If a target has restricted=true, review only its requiredFieldSubset and return restricted=true with a fieldSubset covering those fields. Never propose or observe another durable field for that restricted target.',
    'Proposals may establish/refine only grounded durable values. First-contact explicit facts may be established directly. One-off or uncertain evidence should become observations instead of accepted traits.',
    'Observations use localObservationRef, targetId, field, observation, source, and optional disposition. supportProposals may bind accepted fields to observation refs or supplied source refs in the same response.',
    'Retained observation IDs are usable only when that observation is supplied in the target context with its original source also present in SOURCES; do not reference any other stored observation ID.',
    'Do not invent evidence, IDs, missing family members, recurrence, or values merely to fill unknown fields. Omission preserves existing values.',
    `Response allowance requested by host: ${settings.developmentResponseLimit} tokens.`,
    `TARGETS=${JSON.stringify(targetPayload)}`,
    `SOURCES=${JSON.stringify(sources)}`,
    'RESPONSE_SHAPE={"version":"1","reviewReceipts":[],"proposals":[],"observations":[],"supportProposals":[]}',
  ].join('\n');
}

function addField(map, targetId, field) {
  if (!targetId || !field) return;
  const base = String(field).split('.')[0];
  if (!DURABLE_DOSSIER_FIELDS.includes(base)) return;
  if (!map.has(targetId)) map.set(targetId, new Set());
  map.get(targetId).add(base);
}

/** Returns durable fields touched or depended upon by a Development response. */
export function collectDevelopmentResponseFields(envelope) {
  const byTarget = new Map();
  for (const proposal of envelope?.proposals || []) {
    const targetId = proposal?.targetId || proposal?.id;
    for (const [key, value] of Object.entries(proposal || {})) {
      if (['targetId', 'id', 'localRef', 'source', 'evidence'].includes(key)) continue;
      if (key === 'facts' && value && typeof value === 'object') {
        for (const factKey of Object.keys(value)) {
          if (!['source', 'operation', 'evidence'].includes(factKey)) addField(byTarget, targetId, factKey);
        }
      } else {
        addField(byTarget, targetId, key);
      }
    }
  }
  for (const observation of envelope?.observations || []) addField(byTarget, observation?.targetId, observation?.field);
  for (const support of envelope?.supportProposals || []) addField(byTarget, support?.targetId, support?.field);
  return byTarget;
}

/**
 * Selects only dispatch-time revisions relevant to the returned Development
 * work. Cross-field dependencies are attached to the proposed field they guard,
 * so a changed live dependency defers that field rather than poisoning siblings.
 */
export function deriveDevelopmentReadDependencies(revisionSnapshot, envelope) {
  const responseFields = collectDevelopmentResponseFields(envelope);
  const readFieldRevisions = {};
  const readFieldDependencies = {};
  for (const [targetId, fields] of responseFields.entries()) {
    const frozen = revisionSnapshot?.[targetId];
    if (!frozen) continue;
    readFieldRevisions[targetId] = {};
    readFieldDependencies[targetId] = {};
    for (const field of fields) {
      if (frozen[field] !== undefined) readFieldRevisions[targetId][field] = frozen[field];
      const dependencies = {};
      if (field === 'relationshipDynamic' && frozen.relationshipEvaluation !== undefined) {
        dependencies.relationshipEvaluation = frozen.relationshipEvaluation;
      }
      if ((field === 'canonicalAppearance' || field === 'appearanceForms') && frozen.currentForm !== undefined) {
        dependencies.currentForm = frozen.currentForm;
      }
      if (
        !['importantMemories', 'background', 'role', 'species', 'actualAge', 'apparentAge', 'birthday'].includes(field) &&
        frozen.lifeState !== undefined
      ) {
        dependencies.lifeState = frozen.lifeState;
      }
      if (Object.keys(dependencies).length > 0) readFieldDependencies[targetId][field] = dependencies;
    }
    if (Object.keys(readFieldRevisions[targetId]).length === 0) delete readFieldRevisions[targetId];
    if (Object.keys(readFieldDependencies[targetId]).length === 0) delete readFieldDependencies[targetId];
  }
  return { readFieldRevisions, readFieldDependencies };
}

export function deriveDevelopmentReadFieldRevisions(revisionSnapshot, envelope) {
  return deriveDevelopmentReadDependencies(revisionSnapshot, envelope).readFieldRevisions;
}
