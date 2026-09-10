/**
 * NPC State Alpha — Shared Field & Domain Application Layer
 *
 * Implements C02, C05, C06, C07:
 * - Derives authority strictly from S1 registry
 * - Enforces automatic writer authority (rejection of wrong writers both ways)
 * - Omission preserves (missing fields are valid no-ops)
 * - Field-level manual locks block automatic overwriting
 * - Manual correction ownership is distinct from locks (not implicit lock)
 * - Field/domain revision token incrementing
 * - Transient currentPresentation vs durable canonicalAppearance separation
 * - currentForm selector resolution against established forms (null is valid unresolved)
 * - Terminal automatic death projection (alive -> dead only; dead -> alive forbidden)
 * - Atomic connected updates for non-player relationship graphs
 * - S2 baseline numeric relationship delta accumulator preserving finite numeric and fractional precision
 */

import {
  WRITERS,
  CANONICAL_FIELDS,
  validateWriterAuthority,
} from '../contract/registry.js';
import {
  normalizeRelationshipScore,
} from './relationship-mechanics.js';

let collectionIdCounter = 0;

/**
 * Resets the collection ID counter for deterministic testing.
 */
export function resetCollectionIdCounterForTesting() {
  collectionIdCounter = 0;
}

/**
 * Generates a stable runtime identifier for collection items (forms, memories, relationships).
 * Mechanically retries against existing collection IDs and transaction-allocated IDs (Task 7).
 *
 * @param {string} prefix
 * @param {Set<string>|Array<string>} [existingIds]
 * @param {Set<string>} [allocatedIds]
 * @returns {string}
 */
export function generateCollectionId(prefix = 'item', existingIds = new Set(), allocatedIds = new Set()) {
  let candidate;
  do {
    collectionIdCounter++;
    candidate = `${prefix}_${Date.now()}_${collectionIdCounter}`;
  } while (
    (existingIds && (existingIds.has?.(candidate) || (Array.isArray(existingIds) && existingIds.includes(candidate)))) ||
    (allocatedIds && (allocatedIds.has?.(candidate) || (Array.isArray(allocatedIds) && allocatedIds.includes(candidate))))
  );
  if (allocatedIds && typeof allocatedIds.add === 'function') {
    allocatedIds.add(candidate);
  }
  return candidate;
}

/**
 * Result of applying a single field change.
 * @typedef {object} FieldApplyResult
 * @property {boolean} applied - Whether the field was actually modified
 * @property {string} [reason] - Reason if not applied (e.g. 'locked', 'omitted', 'unchanged')
 * @property {string} [error] - Error message if application failed
 * @property {any} [oldValue] - Value before change
 * @property {any} [newValue] - Value after change
 * @property {number} [newRevision] - Updated revision token for this field
 */

/**
 * Applies a scalar or object field mutation to an NPC record.
 *
 * @param {object} npc NPC record to modify (mutated in place)
 * @param {string} fieldName Canonical field name
 * @param {any} proposalValue Proposed value or operation descriptor
 * @param {string} writer Writer performing the update (one_pass, development, runtime, user)
 * @param {object} [options]
 * @returns {FieldApplyResult}
 */
export function applyFieldProposal(npc, fieldName, proposalValue, writer, options = {}) {
  // Direct field proposal for runtime bookkeeping or development containers is forbidden (Item 9)
  if (
    fieldName === 'observations' ||
    fieldName === 'acceptedSupport' ||
    fieldName === 'reviewReceipts' ||
    fieldName === 'development'
  ) {
    return {
      applied: false,
      reason: 'bookkeeping_field_reserved',
      error: `Direct field proposal for '${fieldName}' is forbidden; managed via dedicated runtime bookkeeping.`,
    };
  }

  // 1. Authority validation
  const authVal = validateWriterAuthority(fieldName, writer);
  if (!authVal.valid) {
    return { applied: false, error: authVal.error };
  }

  // 2. Lock check: field-level manual lock blocks automatic writers (C02, C05)
  if ((writer === WRITERS.ONE_PASS || writer === WRITERS.DEVELOPMENT) && npc.locks && npc.locks[fieldName] === true) {
    return { applied: false, reason: 'locked' };
  }

  // 3. Omission preserves: undefined means omitted, untouched no-op (C05)
  if (proposalValue === undefined) {
    return { applied: false, reason: 'omitted' };
  }

  const oldValue = npc[fieldName];
  let newValue;

  // 4. Domain-specific application logic
  if (fieldName === 'lifeState') {
    const targetState = typeof proposalValue === 'object' && proposalValue !== null ? proposalValue.value : proposalValue;
    if (targetState === 'alive' && npc.lifeState === 'dead') {
      // Automatic dead -> alive is strictly forbidden (C06)
      if (writer === WRITERS.ONE_PASS || writer === WRITERS.DEVELOPMENT) {
        return {
          applied: false,
          error: 'Automatic dead->alive lifecycle transition is forbidden (C06 terminal death). Automatic resurrection cannot occur.',
        };
      }
    }
    newValue = targetState;

    if (newValue === 'dead') {
      // Death projection: immediately clear active/living presence (C06)
      // Revisions are bumped ONLY if the field values actually changed (F)
      if (npc.present !== false) {
        npc.present = false;
        npc.fieldRevisions.present = (npc.fieldRevisions.present || 0) + 1;
      }
      if (npc.activeInExchange !== false) {
        npc.activeInExchange = false;
        npc.fieldRevisions.activeInExchange = (npc.fieldRevisions.activeInExchange || 0) + 1;
      }
      if (npc.offscreenActivity !== null) {
        npc.offscreenActivity = null;
        npc.fieldRevisions.offscreenActivity = (npc.fieldRevisions.offscreenActivity || 0) + 1;
      }
    }
  } else if (fieldName === 'currentForm') {
    const targetForm = typeof proposalValue === 'object' && proposalValue !== null && 'value' in proposalValue
      ? proposalValue.value
      : proposalValue;

    if (targetForm === null) {
      // Null is valid unresolved form selector (C02, C04)
      newValue = null;
    } else if (typeof targetForm === 'string') {
      // Must match an established form in appearanceForms by formId (A)
      const knownForms = Array.isArray(npc.appearanceForms) ? npc.appearanceForms : [];
      const formExists = knownForms.some((f) => (typeof f === 'string' ? f === targetForm : f.formId === targetForm));
      if (!formExists) {
        // Unknown form remains unresolved rather than inventing a form ID (C02)
        newValue = null;
      } else {
        newValue = targetForm;
      }
    } else {
      return { applied: false, error: 'currentForm must be a string form ID or null.' };
    }
  } else if (fieldName === 'currentPresentation') {
    // Current presentation captures transient clothing/condition; does NOT rewrite canonicalAppearance (C02)
    newValue = typeof proposalValue === 'object' && proposalValue !== null && 'value' in proposalValue
      ? proposalValue.value
      : proposalValue;
  } else if (fieldName === 'relationshipEvaluation') {
    // Numeric relationship evaluation
    const relResult = applyRelationshipEvaluation(npc, proposalValue);
    if (!relResult.applied) {
      return relResult;
    }
    return relResult;
  } else if (fieldName === 'personality') {
    // Item E: personality operation remove clears to null; other ops set normalized canonical traits/value only
    if (typeof proposalValue === 'object' && proposalValue !== null && !Array.isArray(proposalValue)) {
      const op = proposalValue.operation || 'update';
      if (op === 'remove') {
        newValue = null;
      } else {
        const clean = {};
        if (proposalValue.traits !== undefined) {
          clean.traits = Array.isArray(proposalValue.traits)
            ? [...proposalValue.traits]
            : proposalValue.traits;
        }
        if (proposalValue.value !== undefined) {
          clean.value = proposalValue.value;
        }
        if (clean.traits === undefined && clean.value === undefined) {
          for (const [k, v] of Object.entries(proposalValue)) {
            if (k !== 'source' && k !== 'operation' && k !== 'evidence') {
              clean[k] = v;
            }
          }
        }
        newValue = clean;
      }
    } else {
      newValue = proposalValue;
    }
  } else if (CANONICAL_FIELDS[fieldName]?.isCollection) {
    // Collection application (aliases, mannerisms, appearanceForms, importantMemories, nonPlayerRelationships)
    const collResult = applyCollectionOperation(npc, fieldName, proposalValue, options);
    if (!collResult.applied) {
      return collResult;
    }
    newValue = collResult.newValue;
  } else {
    // Standard scalar or object field: strip wire metadata if present
    if (typeof proposalValue === 'object' && proposalValue !== null && 'value' in proposalValue) {
      const op = proposalValue.operation || 'update';
      if (op === 'remove') {
        newValue = null;
      } else {
        newValue = proposalValue.value;
      }
    } else if (typeof proposalValue === 'object' && proposalValue !== null && !Array.isArray(proposalValue)) {
      const clean = { ...proposalValue };
      delete clean.source;
      delete clean.operation;
      delete clean.evidence;
      newValue = clean;
    } else {
      newValue = proposalValue;
    }
  }

  // Check if value actually changed
  if (JSON.stringify(oldValue) === JSON.stringify(newValue)) {
    return { applied: false, reason: 'unchanged', oldValue, newValue };
  }

  // Update field and increment revision token
  npc[fieldName] = newValue;
  const currentRev = npc.fieldRevisions[fieldName] || 0;
  const nextRev = currentRev + 1;
  npc.fieldRevisions[fieldName] = nextRev;

  return {
    applied: true,
    oldValue,
    newValue,
    newRevision: nextRev,
  };
}

/**
 * Helper to extract identity/identifier from a collection item.
 * Strictly uses S1 identifiers (Item A).
 * @param {any} item
 * @param {string} fieldName
 * @returns {string|undefined}
 */
function getItemId(item, fieldName) {
  if (item === null || item === undefined) return undefined;
  if (typeof item !== 'object') return String(item);
  if (fieldName === 'appearanceForms') {
    return item.formId || item.localFormRef;
  }
  if (fieldName === 'importantMemories') {
    return item.memoryId || item.localMemoryRef;
  }
  if (fieldName === 'nonPlayerRelationships') {
    return item.relationId || item.targetId || item.targetRef;
  }
  return item.id || item.targetId || item.key;
}

/**
 * Strips wire-only metadata (source, operation, evidence) from persisted
 * collection items in canonical state (Item B).
 * @param {any} item
 * @returns {any}
 */
function sanitizeCollectionItem(item) {
  if (item === null || typeof item !== 'object' || Array.isArray(item)) {
    return item;
  }
  const clean = { ...item };
  delete clean.source;
  delete clean.operation;
  delete clean.evidence;
  delete clean.localFormRef;
  delete clean.localMemoryRef;
  delete clean.targetRef;
  return clean;
}

/**
 * Applies collection operations (add, establish, replace, update, enrich, remove, consolidate).
 * Never evicts unrelated items merely to make room (C05).
 * Fail-closed collection semantics (Item B & Item 7):
 * - replace of missing item does NOT append (fails closed).
 * - add/establish against existing ID does NOT replace (fails closed).
 * - remove of missing target returns applied: false.
 * - generic whole-array overwrite rejected except authorized S1 consolidate.
 * - appearanceForms add with localFormRef receives stable runtime formId; localFormRef stripped.
 * - importantMemories add with localMemoryRef receives stable runtime memoryId; localMemoryRef stripped.
 * - nonPlayerRelationships establish/add without relationId receives stable runtime relationId.
 * - NPR targetRef pointing to a NEW NPC in the same transaction resolves to assigned stable targetId.
 * - strips wire metadata (source, operation, evidence) before persisting.
 *
 * @param {object} npc
 * @param {string} fieldName
 * @param {any} proposalValue
 * @param {object} [options]
 * @returns {{ applied: boolean, newValue?: any, reason?: string, error?: string }}
 */
function applyCollectionOperation(npc, fieldName, proposalValue, options = {}) {
  let list = Array.isArray(npc[fieldName]) ? [...npc[fieldName]] : [];
  let changed = false;

  const existingIds = new Set(list.map((i) => getItemId(i, fieldName)).filter(Boolean));
  const allocatedIds = options.allocatedCollectionIds || new Set();

  let containerOp = 'add';
  let itemsToProcess = [];

  if (Array.isArray(proposalValue)) {
    // Array of items proposes additions by default; whole-array overwrite is rejected (Item B)
    itemsToProcess = proposalValue;
    containerOp = 'add';
  } else if (typeof proposalValue === 'object' && proposalValue !== null) {
    containerOp = proposalValue.operation || 'add';
    const rawItems =
      proposalValue.items ||
      proposalValue.forms ||
      proposalValue.memories ||
      proposalValue.relationships ||
      proposalValue.mannerisms ||
      proposalValue.aliases;

    if (Array.isArray(rawItems)) {
      itemsToProcess = rawItems;
    } else if (proposalValue.value !== undefined) {
      itemsToProcess = Array.isArray(proposalValue.value) ? proposalValue.value : [proposalValue.value];
    } else if (
      proposalValue.targetId !== undefined ||
      proposalValue.targetRef !== undefined ||
      proposalValue.formId !== undefined ||
      proposalValue.localFormRef !== undefined ||
      proposalValue.memoryId !== undefined ||
      proposalValue.localMemoryRef !== undefined ||
      proposalValue.relationId !== undefined ||
      proposalValue.id !== undefined
    ) {
      itemsToProcess = [proposalValue];
    }
  }

  // Validate allowed collection operations
  const allowedOps = ['add', 'establish', 'replace', 'remove', 'update', 'enrich', 'consolidate'];
  if (!allowedOps.includes(containerOp)) {
    return {
      applied: false,
      error: `Unauthorized collection operation '${containerOp}' for ${fieldName}.`,
    };
  }

  if (containerOp === 'consolidate') {
    const cleaned = itemsToProcess.map(sanitizeCollectionItem);
    if (JSON.stringify(list) === JSON.stringify(cleaned)) {
      return { applied: false, reason: 'unchanged' };
    }
    return {
      applied: true,
      newValue: cleaned,
    };
  }

  for (const item of itemsToProcess) {
    const op = (item && typeof item === 'object' && item.operation) ? item.operation : containerOp;
    const itemId = getItemId(item, fieldName);

    if (op === 'remove') {
      const removeTargetId = itemId || (item && typeof item === 'object' ? item.targetId || item.formId || item.memoryId || item.relationId || item.value : item);
      const initialLen = list.length;
      list = list.filter((existing) => {
        const existingId = getItemId(existing, fieldName);
        if (existingId && removeTargetId && existingId === removeTargetId) return false;
        if (typeof existing === 'string' && (existing === removeTargetId || existing === item)) return false;
        if (typeof removeTargetId === 'object' && JSON.stringify(existing) === JSON.stringify(removeTargetId)) return false;
        return true;
      });
      if (list.length === initialLen) {
        // Missing remove target must NOT be advertised as success (Item B)
        return {
          applied: false,
          reason: 'not_found',
          error: `Remove target '${removeTargetId}' not found in ${fieldName}.`,
        };
      }
      changed = true;
    } else if (op === 'replace') {
      const replaceId = itemId || (item && typeof item === 'object' ? item.targetId || item.formId || item.memoryId || item.relationId : null);
      if (!replaceId) {
        return {
          applied: false,
          error: `Replace operation on ${fieldName} requires an identifiable target ID.`,
        };
      }
      const idx = list.findIndex((existing) => getItemId(existing, fieldName) === replaceId);
      if (idx === -1) {
        // Missing item must NOT silently append! (Item B fail-closed)
        return {
          applied: false,
          reason: 'target_not_found',
          error: `Cannot replace missing item '${replaceId}' in ${fieldName}. Target not found.`,
        };
      }
      const rawVal = (item && typeof item === 'object' && item.value !== undefined) ? item.value : item;
      let valToSet = sanitizeCollectionItem(rawVal);
      // NPR replace bug fix (Task 6): preserve existing target endpoint on replace while changing relationship value
      if (fieldName === 'nonPlayerRelationships') {
        const existingNpr = list[idx];
        if (typeof valToSet === 'object' && valToSet !== null) {
          if (valToSet.targetId === undefined && existingNpr && existingNpr.targetId !== undefined) {
            valToSet.targetId = existingNpr.targetId;
          }
          if (valToSet.relationId === undefined) {
            valToSet.relationId = replaceId;
          }
        }
      }
      list[idx] = valToSet;
      changed = true;
    } else if (op === 'update' || op === 'enrich') {
      const updateId = itemId || (item && typeof item === 'object' ? item.targetId || item.formId || item.memoryId || item.relationId : null);
      if (!updateId) {
        return {
          applied: false,
          error: `Update operation on ${fieldName} requires an identifiable target ID.`,
        };
      }
      const idx = list.findIndex((existing) => getItemId(existing, fieldName) === updateId);
      if (idx === -1) {
        return {
          applied: false,
          reason: 'target_not_found',
          error: `Cannot update missing item '${updateId}' in ${fieldName}. Target not found.`,
        };
      }
      const rawVal = (item && typeof item === 'object' && item.value !== undefined) ? item.value : item;
      const valToMerge = sanitizeCollectionItem(rawVal);
      if (typeof list[idx] === 'object' && typeof valToMerge === 'object') {
        list[idx] = { ...list[idx], ...valToMerge };
      } else {
        list[idx] = valToMerge;
      }
      changed = true;
    } else if (op === 'add' || op === 'establish') {
      const rawVal = (item && typeof item === 'object' && item.value !== undefined && Object.keys(item).length === 2 && 'operation' in item)
        ? item.value
        : item;

      let itemObj = (typeof rawVal === 'object' && rawVal !== null && !Array.isArray(rawVal)) ? { ...rawVal } : rawVal;

      // Stable runtime collection identity and reference resolution (Item 7)
      if (typeof itemObj === 'object' && itemObj !== null && !Array.isArray(itemObj)) {
        if (fieldName === 'appearanceForms') {
          if (!itemObj.formId && itemObj.localFormRef) {
            itemObj.formId = generateCollectionId('form', existingIds, allocatedIds);
          }
        } else if (fieldName === 'importantMemories') {
          if (!itemObj.memoryId && itemObj.localMemoryRef) {
            itemObj.memoryId = generateCollectionId('mem', existingIds, allocatedIds);
          }
        } else if (fieldName === 'nonPlayerRelationships') {
          if (!itemObj.relationId) {
            itemObj.relationId = generateCollectionId('rel', existingIds, allocatedIds);
          }
          if (!itemObj.targetId && itemObj.targetRef) {
            const idMap = options.resolvedIdentityMap || options.identityMap;
            const resolved = idMap instanceof Map ? idMap.get(itemObj.targetRef) : idMap?.[itemObj.targetRef];
            const resolvedId = resolved?.assignedId || resolved?.id || (typeof resolved === 'string' ? resolved : null);
            if (resolvedId) {
              itemObj.targetId = resolvedId;
            } else {
              return {
                applied: false,
                reason: 'unresolved_target_ref',
                error: `Unresolved targetRef '${itemObj.targetRef}' in nonPlayerRelationships.`,
              };
            }
          }
        }
      }

      const valToAdd = sanitizeCollectionItem(itemObj);
      const addId = getItemId(valToAdd, fieldName);
      if (addId) {
        const idx = list.findIndex((existing) => getItemId(existing, fieldName) === addId);
        if (idx !== -1) {
          // add/establish against an existing stable ID must NOT silently replace! (Item B fail-closed)
          return {
            applied: false,
            reason: 'already_exists',
            error: `Cannot add item '${addId}' to ${fieldName}; item already exists.`,
          };
        }
        list.push(valToAdd);
        changed = true;
      } else {
        const itemStr = JSON.stringify(valToAdd);
        if (list.some((existing) => JSON.stringify(existing) === itemStr)) {
          return {
            applied: false,
            reason: 'already_exists',
            error: `Item already exists in ${fieldName}.`,
          };
        }
        list.push(valToAdd);
        changed = true;
      }
    } else {
      return {
        applied: false,
        error: `Unsupported collection item operation '${op}' on ${fieldName}.`,
      };
    }
  }

  if (!changed) {
    return { applied: false, reason: 'unchanged' };
  }

  return {
    applied: true,
    newValue: list,
  };
}

/**
 * Applies S2 baseline numeric relationship axis deltas to player (Item E).
 * Strictly accepts S1 axes object ({ trust, affection, desire, tension }). Legacy shifts removed (Item A).
 * Preserves finite numeric and fractional delta precision without bounds clamping.
 * Note: S2 provides the mechanical delta foundation; high-level relationship mechanics
 * and narrative dynamics belong to later stages (e.g. S5).
 *
 * @param {object} npc
 * @param {object} evalProposal
 * @returns {FieldApplyResult}
 */
function applyRelationshipEvaluation(npc, evalProposal) {
  if (!evalProposal || typeof evalProposal !== 'object') {
    return { applied: false, error: 'relationshipEvaluation must be an object.' };
  }

  if (!npc.relationship) {
    npc.relationship = {
      trust: 0,
      affection: 0,
      desire: 0,
      tension: 0,
      lastEvaluationExchange: null,
    };
  }

  const { shifted, axes } = evalProposal;
  if (shifted === false) {
    // Explicit no-shift: records evaluation without numeric change (Task 14, C04, C05, C07)
    return {
      applied: false,
      reason: 'explicit_zero_shift',
      oldValue: { ...npc.relationship },
      newValue: { ...npc.relationship },
    };
  }

  const deltaAxes = axes;
  let anyDelta = false;
  if (deltaAxes && typeof deltaAxes === 'object') {
    for (const axis of ['trust', 'affection', 'desire', 'tension']) {
      if (typeof deltaAxes[axis] === 'number' && Number.isFinite(deltaAxes[axis])) {
        if (deltaAxes[axis] !== 0) {
          anyDelta = true;
        }
        const currentVal = npc.relationship[axis] || 0;
        npc.relationship[axis] = normalizeRelationshipScore(currentVal + deltaAxes[axis]);
      }
    }
  }

  if (!anyDelta) {
    return {
      applied: false,
      reason: 'unchanged',
      oldValue: { ...npc.relationship },
      newValue: { ...npc.relationship },
    };
  }

  const currentRev = npc.fieldRevisions.relationshipEvaluation || 0;
  const nextRev = currentRev + 1;
  npc.fieldRevisions.relationshipEvaluation = nextRev;

  return {
    applied: true,
    newValue: { ...npc.relationship },
    newRevision: nextRev,
  };
}

/**
 * Applies a batch of field proposals to an NPC record.
 * Uses strict transaction containment: if any proposal fails, caller's NPC object
 * is left completely untouched.
 * Rejects contradictory lifecycle states (e.g. dead but present).
 *
 * @param {object} npc NPC record
 * @param {object} proposals Map of field proposals
 * @param {string} writer Writer name
 * @param {object} [options]
 * @returns {{ applied: boolean, appliedFields: string[], errors: string[] }}
 */
export function applyNpcProposals(npc, proposals, writer, options = {}) {
  const appliedFields = [];
  const errors = [];

  // Transaction containment: work on clone
  const workingNpc = JSON.parse(JSON.stringify(npc));

  // Check for lifecycle contradictions in proposal before applying
  if (proposals.lifeState === 'dead' || proposals.lifeState?.value === 'dead') {
    if (proposals.present === true || proposals.activeInExchange === true) {
      return {
        applied: false,
        appliedFields: [],
        errors: ['Contradictory proposal: NPC cannot be proposed as dead and simultaneously present or activeInExchange.'],
      };
    }
  }

  // If NPC is already dead in state, reject living presence/activity updates
  if (workingNpc.lifeState === 'dead' && (writer === WRITERS.ONE_PASS || writer === WRITERS.DEVELOPMENT)) {
    if (proposals.present === true || proposals.activeInExchange === true) {
      return {
        applied: false,
        appliedFields: [],
        errors: [`Target NPC '${npc.id}' is confirmed dead; incompatible present or activeInExchange update rejected.`],
      };
    }
  }

  const lockedFields = [];

  for (const [fieldName, proposalValue] of Object.entries(proposals)) {
    if (fieldName === 'id' || fieldName === 'localRef') {
      continue; // Handled by identity resolver
    }

    const res = applyFieldProposal(workingNpc, fieldName, proposalValue, writer, options);
    if (res.error) {
      errors.push(`${fieldName}: ${res.error}`);
    } else if (res.applied) {
      appliedFields.push(fieldName);
    } else if (res.reason === 'locked') {
      lockedFields.push(fieldName);
    }
  }

  if (errors.length > 0) {
    return {
      applied: false,
      appliedFields: [],
      lockedFields,
      errors,
    };
  }

  // Full batch succeeded: commit cloned changes back to caller's object
  Object.assign(npc, workingNpc);

  return {
    applied: appliedFields.length > 0,
    appliedFields,
    lockedFields,
    errors: [],
  };
}
