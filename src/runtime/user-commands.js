/**
 * NPC State Alpha — canonical S5 user command/action layer.
 *
 * UI code calls these commands; commands call the one shared CommitCoordinator.
 * No command mutates storage/state directly.
 */

import { WRITERS, CANONICAL_FIELDS, validateWriterAuthority } from '../contract/registry.js';

export const IMPORTANCE_MIN = 0;
export const IMPORTANCE_MAX = 10;
export const PORTRAIT_REFERENCE_MAX_LENGTH = 4096;

function invalid(error, errorCode = 'invalid_user_command') {
  return { success: false, error, errorCode };
}

function validateNpcId(npcId) {
  return typeof npcId === 'string' && npcId.trim() !== '';
}

function validatePortraitReference(portrait) {
  if (portrait === null) return null;
  if (typeof portrait !== 'string') return 'Portrait must be a string asset path/URL or null.';
  const trimmed = portrait.trim();
  if (trimmed === '') return null;
  if (trimmed.length > PORTRAIT_REFERENCE_MAX_LENGTH) {
    return `Portrait reference must be at most ${PORTRAIT_REFERENCE_MAX_LENGTH} characters.`;
  }
  if (/^data:/i.test(trimmed)) {
    return 'Inline data URLs are not stored as portraits; use a supported asset path or URL.';
  }
  return null;
}

/**
 * Applies one atomic S5 user edit to a single NPC.
 * Corrections and locks are deliberately separate. Supplying a correction does
 * not imply a lock, and lock-only updates do not create correction records.
 */
export async function applyNpcEdit(coordinator, {
  npcId,
  fields = {},
  locks = {},
  portrait = undefined,
  importance = undefined,
  lifeState = undefined,
  expectedRevision,
  reason = 'User editor manual correction',
  notes,
} = {}) {
  if (!coordinator) return invalid('CommitCoordinator is required.', 'coordinator_required');
  if (!validateNpcId(npcId)) return invalid("Non-empty string 'npcId' is required.", 'invalid_target');
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return invalid("'fields' must be an object map.", 'invalid_fields');
  }
  if (!locks || typeof locks !== 'object' || Array.isArray(locks)) {
    return invalid("'locks' must be an object map.", 'invalid_locks');
  }
  if (typeof reason !== 'string' || reason.trim() === '') {
    return invalid('Correction reason must be a non-empty string.', 'invalid_reason');
  }
  if (notes !== undefined && (typeof notes !== 'string' || notes.trim() === '')) {
    return invalid('Correction notes must be a non-empty string when supplied.', 'invalid_notes');
  }

  const proposal = {};
  for (const [fieldName, value] of Object.entries(fields)) {
    if (!CANONICAL_FIELDS[fieldName]) return invalid(`Field '${fieldName}' is not a recognized canonical field.`, 'invalid_field');
    if (['locks', 'manualCorrections', 'portrait', 'importance', 'lifeState'].includes(fieldName)) {
      return invalid(`Field '${fieldName}' must use its dedicated S5 edit control.`, 'reserved_edit_field');
    }
    const auth = validateWriterAuthority(fieldName, WRITERS.USER);
    if (!auth.valid) return invalid(auth.error, 'unauthorized_field');
    proposal[fieldName] = value;
  }

  const normalizedLocks = {};
  for (const [fieldName, locked] of Object.entries(locks)) {
    if (!CANONICAL_FIELDS[fieldName]) return invalid(`Lock field '${fieldName}' is not canonical.`, 'invalid_lock_field');
    if (typeof locked !== 'boolean') return invalid(`Lock '${fieldName}' must be boolean.`, 'invalid_lock_value');
    normalizedLocks[fieldName] = locked;
  }
  if (Object.keys(normalizedLocks).length > 0) proposal.locks = normalizedLocks;

  if (portrait !== undefined) {
    const portraitError = validatePortraitReference(portrait);
    if (portraitError) return invalid(portraitError, 'invalid_portrait');
    proposal.portrait = typeof portrait === 'string' && portrait.trim() === '' ? null : portrait;
  }

  if (importance !== undefined) {
    if (
      importance !== null &&
      (typeof importance !== 'number' || !Number.isFinite(importance) || importance < IMPORTANCE_MIN || importance > IMPORTANCE_MAX)
    ) {
      return invalid(`Importance must be null or a finite number from ${IMPORTANCE_MIN} to ${IMPORTANCE_MAX}.`, 'invalid_importance');
    }
    proposal.importance = importance;
  }

  if (lifeState !== undefined) {
    if (!['alive', 'dead'].includes(lifeState)) return invalid("lifeState must be 'alive' or 'dead'.", 'invalid_lifecycle');
    proposal.lifeState = lifeState;
  }

  if (Object.keys(proposal).length === 0) return invalid('No user edit was supplied.', 'no_changes');

  const result = await coordinator.commit({
    writer: WRITERS.USER,
    expectedRevision,
    fieldProposals: { [npcId]: proposal },
    userOptions: {
      reason: reason.trim(),
      ...(notes !== undefined ? { notes: notes.trim() } : {}),
    },
    operationMode: 'user_edit',
  });

  return {
    ...result,
    casConflict: result.conflict === true || result.conflictType === 'storage_cas_conflict',
  };
}

export async function updateNpcField(coordinator, {
  npcId,
  fieldName,
  value,
  expectedRevision,
  reason = 'User manual correction',
  notes,
  lock,
} = {}) {
  const locks = lock === undefined ? {} : { [fieldName]: Boolean(lock) };
  if (fieldName === 'portrait') {
    return applyNpcEdit(coordinator, { npcId, portrait: value, locks, expectedRevision, reason, notes });
  }
  if (fieldName === 'importance') {
    return applyNpcEdit(coordinator, { npcId, importance: value, locks, expectedRevision, reason, notes });
  }
  if (fieldName === 'lifeState') {
    return applyNpcEdit(coordinator, { npcId, lifeState: value, locks, expectedRevision, reason, notes });
  }
  return applyNpcEdit(coordinator, {
    npcId,
    fields: { [fieldName]: value },
    locks,
    expectedRevision,
    reason,
    notes,
  });
}

export async function setFieldLock(coordinator, { npcId, fieldName, locked, expectedRevision } = {}) {
  return applyNpcEdit(coordinator, {
    npcId,
    locks: { [fieldName]: locked },
    expectedRevision,
    reason: 'User lock update',
  });
}

export async function setImportance(coordinator, { npcId, importance, expectedRevision } = {}) {
  return applyNpcEdit(coordinator, {
    npcId,
    importance,
    expectedRevision,
    reason: 'User importance update',
  });
}

export async function setPortrait(coordinator, { npcId, portrait, expectedRevision } = {}) {
  return applyNpcEdit(coordinator, {
    npcId,
    portrait,
    expectedRevision,
    reason: 'User portrait update',
  });
}

export async function correctLifecycle(coordinator, {
  npcId,
  lifeState,
  expectedRevision,
  reason = 'User lifecycle correction',
  notes,
} = {}) {
  return applyNpcEdit(coordinator, { npcId, lifeState, expectedRevision, reason, notes });
}

/** Manual deletion is user-owned. Restoration/reconstruction is intentionally S6. */
export async function deleteNpc(coordinator, {
  npcId,
  expectedRevision,
  reason = 'User manual deletion',
} = {}) {
  if (!coordinator) return invalid('CommitCoordinator is required.', 'coordinator_required');
  if (!validateNpcId(npcId)) return invalid("Non-empty string 'npcId' is required.", 'invalid_target');
  if (typeof reason !== 'string' || reason.trim() === '') return invalid('Deletion reason must be a non-empty string.', 'invalid_reason');

  const result = await coordinator.commit({
    writer: WRITERS.USER,
    expectedRevision,
    tombstoneProposals: [{ targetId: npcId, reason: reason.trim() }],
    operationMode: 'user_delete',
  });
  return {
    ...result,
    casConflict: result.conflict === true || result.conflictType === 'storage_cas_conflict',
  };
}
