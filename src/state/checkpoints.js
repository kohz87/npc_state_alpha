/**
 * NPC State Alpha — Checkpoint & Snapshot Foundation
 *
 * Implements coherent commit-boundary checkpointing (C10, C11).
 * Records actual current history boundary and source dependencies.
 * Preserves user-owned metadata separation and development records.
 */

import { cloneState } from './schema.js';
import { validateOwnedSourceRecord } from '../contract/wire-schemas.js';

let checkpointCounter = 0;

// Keep full canonical snapshots, but bound their retained count tightly enough
// that persistence cost does not grow into the foreground path. Compaction
// preserves the first trustworthy base, earliest import baseline, a dense recent
// suffix, and deterministic older recovery anchors.
export const MAX_STORY_CHECKPOINTS = 32;
const RECENT_STORY_CHECKPOINTS = 16;

// Any explicit state import/migration that cannot prove pre-import story history
// establishes this neutral recovery boundary. Native restore and future legacy
// adapters use the same marker; the core never needs format-specific modes.
export const IMPORT_BASELINE_MODE = 'import_baseline';

function identityAssignmentCompactionKey(assignment) {
  return JSON.stringify([
    assignment?.localRef || null,
    assignment?.assignedId || null,
    assignment?.identityKey || null,
    assignment?.sourceProvenance || null,
  ]);
}

function collectCompactedIdentityAssignments(checkpoints) {
  const seen = new Set();
  const retained = [];
  for (const checkpoint of checkpoints || []) {
    for (const assignment of checkpoint?.identityAssignments || []) {
      const key = identityAssignmentCompactionKey(assignment);
      if (seen.has(key)) continue;
      seen.add(key);
      retained.push(cloneState(assignment));
    }
  }
  return retained;
}

/**
 * Projects a source dependency into a compact checkpoint representation.
 * Persists source identity and captured provenance only; does NOT persist raw excerpt text (C11, Item 11).
 *
 * @param {string|object} dep
 * @returns {string|object} Compact dependency projection
 */
export function toCompactDependency(dep) {
  if (typeof dep === 'string') return dep;
  if (!dep || typeof dep !== 'object') return dep;

  const compact = {
    sourceRef: dep.sourceRef,
    targetField: dep.targetField !== undefined ? dep.targetField : null,
    writer: dep.writer !== undefined ? dep.writer : null,
    segmentKind: dep.segmentKind || 'narrative',
    capturedProvenance: dep.capturedProvenance
      ? structuredClone(dep.capturedProvenance)
      : null,
  };
  return compact;
}

/**
 * Generates a stable unique checkpoint identifier.
 * @returns {string}
 */
export function generateCheckpointId() {
  checkpointCounter++;
  return `chk_${Date.now()}_${checkpointCounter}`;
}

/**
 * Resets checkpoint counter (useful for test determinism).
 */
export function resetCheckpointCounterForTesting() {
  checkpointCounter = 0;
}

/**
 * Creates a coherent checkpoint at the current commit boundary and appends it to state history.
 *
 * @param {object} state Current state
 * @param {object} metadata Commit boundary metadata
 * @param {string[]} metadata.sourceDependencies Array of source reference / exchange identifiers
 * @param {string} metadata.writer The writer performing the commit (one_pass, development, runtime, user)
 * @param {string} [metadata.mode] Operation mode
 * @param {string} [metadata.description] Optional description
 * @returns {object} The created checkpoint
 */
export function createCheckpoint(state, metadata = {}) {
  if (!state || typeof state !== 'object') {
    throw new Error('createCheckpoint requires valid state object.');
  }

  const checkpointId = metadata.checkpointId || generateCheckpointId();
  const timestamp = metadata.timestamp || new Date().toISOString();

  // Extract separate user-owned metadata map to guarantee separation and rollback preservation (C11)
  const userMetadata = {};
  for (const [npcId, npc] of Object.entries(state.npcs || {})) {
    userMetadata[npcId] = {
      locks: structuredClone(npc.locks || {}),
      manualCorrections: structuredClone(npc.manualCorrections || {}),
      importance: npc.importance,
      portrait: npc.portrait,
    };
  }

  // Compact dependency projection: do not persist raw excerpt text in checkpoints (Task 11)
  const compactDependencies = (metadata.sourceDependencies || []).map(toCompactDependency);
  const priorCheckpoint = Array.isArray(state.history?.checkpoints)
    ? state.history.checkpoints.at(-1)
    : null;
  // User/runtime commits can occur without a fresh story source. They inherit
  // the last proven story boundary so checkpoint compaction cannot make a
  // snapshot containing invalidated story effects appear independently valid.
  const effectiveHistoryBoundary = metadata.historyBoundary || priorCheckpoint?.historyBoundary || null;

  const checkpoint = {
    id: checkpointId,
    commitRevision: state.revision,
    timestamp,
    sourceDependencies: compactDependencies,
    // Exact canonical story boundary at the real commit time. Older S1-S5
    // checkpoints may omit this field and are handled conservatively by S6.
    historyBoundary: effectiveHistoryBoundary
      ? cloneState(effectiveHistoryBoundary)
      : null,
    // Runtime identity assignments make NEW replay deterministic without using
    // array position or semantic name similarity.
    identityAssignments: Array.isArray(metadata.identityAssignments)
      ? cloneState(metadata.identityAssignments)
      : [],
    operation: {
      writer: metadata.writer || 'runtime',
      mode: metadata.mode || 'commit',
      description: metadata.description || null,
    },
    // Complete snapshot of NPCs (including development records and field revisions)
    npcs: cloneState(state.npcs || {}),
    tombstones: cloneState(state.tombstones || {}),
    dedup: cloneState(state.dedup || { processedSourceKeys: [] }),
    pendingReview: cloneState(state.pendingReview || { entries: [] }),
    // Explicit user-owned metadata tracking
    userMetadata,
  };

  if (!state.history) {
    state.history = { checkpoints: [] };
  }
  if (!Array.isArray(state.history.checkpoints)) {
    state.history.checkpoints = [];
  }

  state.history.checkpoints.push(checkpoint);
  if (state.history.checkpoints.length > MAX_STORY_CHECKPOINTS) {
    const allCheckpoints = state.history.checkpoints;
    const firstTrustworthyBase = allCheckpoints[0];
    // Full checkpoints are compacted, but exact NEW identity replay metadata is
    // much smaller and must survive even when its original admission snapshot
    // is discarded. Carry the deduplicated historical assignment ledger on the
    // protected first base; each assignment retains its own source provenance.
    firstTrustworthyBase.identityAssignments = collectCompactedIdentityAssignments(allCheckpoints);
    const firstImportBaseline = allCheckpoints.find(
      (candidate) => candidate?.operation?.mode === IMPORT_BASELINE_MODE,
    );
    const protectedCheckpoints = [firstTrustworthyBase];
    if (firstImportBaseline && firstImportBaseline.id !== firstTrustworthyBase.id) {
      protectedCheckpoints.push(firstImportBaseline);
    }
    const protectedIds = new Set(protectedCheckpoints.map((item) => item.id));
    const ordinary = allCheckpoints.filter((item) => !protectedIds.has(item.id));
    const recentCapacity = Math.min(
      RECENT_STORY_CHECKPOINTS,
      Math.max(0, MAX_STORY_CHECKPOINTS - protectedCheckpoints.length),
    );
    const recentSuffix = ordinary.slice(-recentCapacity);
    const recentIds = new Set(recentSuffix.map((item) => item.id));
    const older = ordinary.filter((item) => !recentIds.has(item.id));
    const historicalCapacity = Math.max(
      0,
      MAX_STORY_CHECKPOINTS - protectedCheckpoints.length - recentSuffix.length,
    );
    let historicalAnchors = older;
    if (older.length > historicalCapacity) {
      historicalAnchors = [];
      if (historicalCapacity === 1) {
        historicalAnchors.push(older[Math.floor((older.length - 1) / 2)]);
      } else if (historicalCapacity > 1) {
        for (let slot = 0; slot < historicalCapacity; slot++) {
          const index = Math.round(slot * (older.length - 1) / (historicalCapacity - 1));
          const candidate = older[index];
          if (candidate && !historicalAnchors.some((item) => item.id === candidate.id)) {
            historicalAnchors.push(candidate);
          }
        }
      }
    }
    const retainedIds = new Set([
      ...protectedIds,
      ...historicalAnchors.map((item) => item.id),
      ...recentSuffix.map((item) => item.id),
    ]);
    state.history.checkpoints = allCheckpoints.filter((item) => retainedIds.has(item.id));
  }
  return checkpoint;
}

/**
 * Retrieves the latest checkpoint from state history.
 *
 * @param {object} state
 * @returns {object|null}
 */
export function getLatestCheckpoint(state) {
  if (!state?.history?.checkpoints || state.history.checkpoints.length === 0) {
    return null;
  }
  return state.history.checkpoints[state.history.checkpoints.length - 1];
}

/**
 * Validates a checkpoint object.
 *
 * @param {object} checkpoint
 * @returns {{ valid: boolean, errors: string[] }}
 */
export function validateCheckpoint(checkpoint) {
  const errors = [];
  if (!checkpoint || typeof checkpoint !== 'object') {
    return { valid: false, errors: ['Checkpoint must be an object.'] };
  }

  const ALLOWED_CHECKPOINT_KEYS = [
    'id',
    'commitRevision',
    'timestamp',
    'sourceDependencies',
    'historyBoundary',
    'identityAssignments',
    'operation',
    'npcs',
    'tombstones',
    'dedup',
    'pendingReview',
    'userMetadata',
  ];

  for (const k of Object.keys(checkpoint)) {
    if (!ALLOWED_CHECKPOINT_KEYS.includes(k)) {
      errors.push(`Checkpoint contains unknown key '${k}'.`);
    }
  }

  if (typeof checkpoint.id !== 'string' || checkpoint.id.trim() === '') {
    errors.push("Checkpoint requires non-empty string 'id'.");
  }

  if (typeof checkpoint.commitRevision !== 'number' || !Number.isInteger(checkpoint.commitRevision)) {
    errors.push("Checkpoint requires integer 'commitRevision'.");
  }

  if (typeof checkpoint.timestamp !== 'string' || checkpoint.timestamp.trim() === '') {
    errors.push("Checkpoint requires non-empty string 'timestamp'.");
  }

  if (!Array.isArray(checkpoint.sourceDependencies)) {
    errors.push("Checkpoint requires 'sourceDependencies' array.");
  } else {
    const ALLOWED_DEP_KEYS = ['sourceRef', 'targetField', 'writer', 'segmentKind', 'capturedProvenance'];
    for (let dIdx = 0; dIdx < checkpoint.sourceDependencies.length; dIdx++) {
      const dep = checkpoint.sourceDependencies[dIdx];
      if (typeof dep === 'string') {
        if (dep.trim() === '') {
          errors.push(`Checkpoint sourceDependencies[${dIdx}] cannot be an empty string.`);
        }
      } else if (dep && typeof dep === 'object' && !Array.isArray(dep)) {
        if (dep.excerpt !== undefined) {
          errors.push(`Checkpoint sourceDependencies[${dIdx}] cannot persist raw excerpt (compactness violation).`);
        }
        for (const dk of Object.keys(dep)) {
          if (!ALLOWED_DEP_KEYS.includes(dk)) {
            errors.push(`Checkpoint sourceDependencies[${dIdx}] contains unknown key '${dk}'.`);
          }
        }
        if (typeof dep.sourceRef !== 'string' || dep.sourceRef.trim() === '') {
          errors.push(`Checkpoint sourceDependencies[${dIdx}] requires non-empty string 'sourceRef'.`);
        }
        if (!dep.capturedProvenance || typeof dep.capturedProvenance !== 'object' || Array.isArray(dep.capturedProvenance)) {
          errors.push(`Checkpoint sourceDependencies[${dIdx}] requires 'capturedProvenance' object.`);
        } else {
          const prov = { ...dep.capturedProvenance };
          if (prov.swipe === null) delete prov.swipe;
          if (prov.revision === null) delete prov.revision;
          const pVal = validateOwnedSourceRecord(prov);
          if (!pVal.valid) {
            errors.push(`Checkpoint sourceDependencies[${dIdx}].capturedProvenance invalid: ${pVal.error}`);
          }
        }
      } else {
        errors.push(`Checkpoint sourceDependencies[${dIdx}] must be a non-empty string or captured dependency object.`);
      }
    }
  }

  if (checkpoint.historyBoundary !== undefined && checkpoint.historyBoundary !== null) {
    if (!checkpoint.historyBoundary || typeof checkpoint.historyBoundary !== 'object' || Array.isArray(checkpoint.historyBoundary)) {
      errors.push("Checkpoint 'historyBoundary' must be null or an owned source record.");
    } else {
      const boundaryValidation = validateOwnedSourceRecord(checkpoint.historyBoundary);
      if (!boundaryValidation.valid) {
        errors.push(`Checkpoint historyBoundary invalid: ${boundaryValidation.error}`);
      }
    }
  }

  if (checkpoint.identityAssignments !== undefined) {
    if (!Array.isArray(checkpoint.identityAssignments)) {
      errors.push("Checkpoint 'identityAssignments' must be an array.");
    } else {
      const allowedAssignmentKeys = ['localRef', 'assignedId', 'name', 'identityKind', 'identityKey', 'sourceProvenance'];
      for (let i = 0; i < checkpoint.identityAssignments.length; i++) {
        const assignment = checkpoint.identityAssignments[i];
        if (!assignment || typeof assignment !== 'object' || Array.isArray(assignment)) {
          errors.push(`Checkpoint identityAssignments[${i}] must be an object.`);
          continue;
        }
        for (const key of Object.keys(assignment)) {
          if (!allowedAssignmentKeys.includes(key)) errors.push(`Checkpoint identityAssignments[${i}] contains unknown key '${key}'.`);
        }
        if (typeof assignment.localRef !== 'string' || assignment.localRef.trim() === '' ||
            typeof assignment.assignedId !== 'string' || assignment.assignedId.trim() === '') {
          errors.push(`Checkpoint identityAssignments[${i}] requires non-empty localRef and assignedId.`);
        }
        if (assignment.identityKey !== undefined &&
            (typeof assignment.identityKey !== 'string' || assignment.identityKey.trim() === '')) {
          errors.push(`Checkpoint identityAssignments[${i}].identityKey must be a non-empty string when supplied.`);
        }
        if (assignment.sourceProvenance !== undefined) {
          const sourceValidation = validateOwnedSourceRecord(assignment.sourceProvenance);
          if (!sourceValidation.valid) {
            errors.push(`Checkpoint identityAssignments[${i}].sourceProvenance invalid: ${sourceValidation.error}`);
          }
        }
      }
    }
  }

  if (!checkpoint.operation || typeof checkpoint.operation !== 'object' || typeof checkpoint.operation.writer !== 'string') {
    errors.push("Checkpoint requires valid 'operation' object with 'writer'.");
  }

  if (!checkpoint.npcs || typeof checkpoint.npcs !== 'object' || Array.isArray(checkpoint.npcs)) {
    errors.push("Checkpoint requires 'npcs' snapshot object.");
  }

  if (!checkpoint.tombstones || typeof checkpoint.tombstones !== 'object' || Array.isArray(checkpoint.tombstones)) {
    errors.push("Checkpoint requires 'tombstones' snapshot object.");
  }

  if (!checkpoint.dedup || typeof checkpoint.dedup !== 'object' || !Array.isArray(checkpoint.dedup.processedSourceKeys)) {
    errors.push("Checkpoint requires 'dedup' snapshot object.");
  }

  if (!checkpoint.pendingReview || typeof checkpoint.pendingReview !== 'object' || !Array.isArray(checkpoint.pendingReview.entries)) {
    errors.push("Checkpoint requires 'pendingReview' snapshot object.");
  }

  if (!checkpoint.userMetadata || typeof checkpoint.userMetadata !== 'object' || Array.isArray(checkpoint.userMetadata)) {
    errors.push("Checkpoint requires 'userMetadata' snapshot object.");
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
