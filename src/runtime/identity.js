/**
 * NPC State Alpha — Identity & Admission Primitives
 *
 * Implements C02, C04 identity resolution:
 * - Stable existing ID lookup
 * - Tombstone checks (tombstoned existing IDs cannot be recreated or mutated)
 * - NEW localRef resolution with locally assigned stable IDs
 * - Multiple NEW candidates in one transaction (no array-order fallback)
 * - Single admission policy owner
 * - Atomic dependent failure (failed admission leaves no orphan mutations)
 */

export const ADMISSION_POLICIES = Object.freeze({
  NAMED_PREFERRED: 'named_preferred',
  BALANCED_UNIQUE_ROLE_LABEL: 'balanced_unique_role_label',
  MANUAL_ONLY: 'manual_only',
});

let npcIdCounter = 0;

/**
 * Generates a locally assigned stable NPC identifier with collision retry.
 * Format: npc_<timestamp>_<counter>
 * Checks against existing npcs, tombstones, and batch-allocated IDs.
 *
 * @param {object} [currentState] Current Alpha state
 * @param {Set<string>|Array<string>} [allocatedIds] Set or array of IDs already allocated in current batch
 * @returns {string}
 */
export function generateStableNpcId(currentState = null, allocatedIds = null) {
  let candidate;
  do {
    npcIdCounter++;
    candidate = `npc_${Date.now()}_${npcIdCounter}`;
  } while (
    (currentState?.npcs && currentState.npcs[candidate]) ||
    (currentState?.tombstones && currentState.tombstones[candidate]) ||
    (allocatedIds && (allocatedIds instanceof Set ? allocatedIds.has(candidate) : Array.isArray(allocatedIds) ? allocatedIds.includes(candidate) : false))
  );

  if (allocatedIds instanceof Set) {
    allocatedIds.add(candidate);
  } else if (Array.isArray(allocatedIds)) {
    allocatedIds.push(candidate);
  }

  return candidate;
}

/**
 * Resets the NPC ID counter for deterministic testing.
 */
export function resetNpcIdCounterForTesting() {
  npcIdCounter = 0;
}

/**
 * Builds an exact, proposal-scoped identity key for history replay.
 * The key intentionally includes the wire identity fields and does not use
 * semantic similarity or proposal array position.
 */
export function buildIdentityReplayKey(proposal) {
  if (!proposal || typeof proposal !== 'object') return null;
  if (typeof proposal.localRef !== 'string' || proposal.localRef.trim() === '') return null;
  if (typeof proposal.name !== 'string' || proposal.name.trim() === '') return null;
  const aliases = Array.isArray(proposal.aliases)
    ? proposal.aliases.map((alias) => typeof alias === 'string' ? alias.trim() : alias)
    : [];
  return JSON.stringify([
    proposal.localRef.trim(),
    proposal.name.trim(),
    proposal.identityKind || 'named',
    aliases,
  ]);
}

/**
 * Resolves a batch of identity proposals (both existing IDs and NEW localRefs)
 * against current state and admission policy.
 *
 * Atomic dependent failure: If any identity check fails, the entire resolution fails.
 *
 * @param {Array<object>} proposals Array of proposals with id or localRef, name, identityKind
 * @param {object} currentState Current Alpha state object
 * @param {string} [admissionPolicy='named_preferred'] Admission policy
 * @returns {{ valid: boolean, resolvedMap?: Map<string, object>, assignedNpcs?: Array<object>, errors?: string[] }}
 */
export function resolveIdentityBatch(
  proposals,
  currentState,
  admissionPolicy = ADMISSION_POLICIES.NAMED_PREFERRED,
  options = {}
) {
  let policy = admissionPolicy;
  let opts = options;
  if (typeof admissionPolicy === 'object' && admissionPolicy !== null) {
    opts = admissionPolicy;
    policy = opts.policy || opts.admissionPolicy || ADMISSION_POLICIES.NAMED_PREFERRED;
  }

  const errors = [];
  const resolvedMap = new Map(); // localRef or id -> resolved identity descriptor
  const seenLocalRefs = new Set();
  const seenRoleLabels = new Set();
  const seenIds = new Set();
  const assignedNpcs = [];

  if (!Array.isArray(proposals)) {
    return { valid: false, errors: ['Proposals must be an array.'] };
  }

  for (let i = 0; i < proposals.length; i++) {
    const p = proposals[i];
    if (!p || typeof p !== 'object') {
      errors.push(`Proposal at index ${i} must be an object.`);
      continue;
    }

    const { id, localRef, name, identityKind = 'named' } = p;

    // Must have either id or localRef, but not both
    if (!id && !localRef) {
      errors.push(`Proposal at index ${i} must supply either 'id' or 'localRef'.`);
      continue;
    }

    if (id && localRef) {
      errors.push(`Proposal at index ${i} cannot supply both 'id' and 'localRef'.`);
      continue;
    }

    // Existing NPC ID handling
    if (id) {
      if (typeof id !== 'string' || id.trim() === '') {
        errors.push(`Proposal at index ${i} has empty or non-string 'id'.`);
        continue;
      }

      // Tombstone check
      if (currentState.tombstones && currentState.tombstones[id]) {
        errors.push(`Target NPC '${id}' has been tombstoned (manually deleted) and cannot be modified or recreated.`);
        continue;
      }

      // Check existence in current state
      const existingNpc = currentState.npcs ? currentState.npcs[id] : null;
      if (!existingNpc) {
        errors.push(`Target NPC ID '${id}' not found in current state.`);
        continue;
      }

      resolvedMap.set(id, {
        isNew: false,
        assignedId: id,
        name: existingNpc.name,
        identityKind: existingNpc.identityKind,
        npc: existingNpc,
      });
      seenIds.add(id);
    }

    // NEW localRef handling
    if (localRef) {
      if (typeof localRef !== 'string' || localRef.trim() === '') {
        errors.push(`Proposal at index ${i} has empty or non-string 'localRef'.`);
        continue;
      }

      if (seenLocalRefs.has(localRef)) {
        errors.push(`Duplicate localRef '${localRef}' in the same transaction envelope.`);
        continue;
      }
      seenLocalRefs.add(localRef);

      if (typeof name !== 'string' || name.trim() === '') {
        errors.push(`NEW NPC candidate with localRef '${localRef}' requires non-empty string name.`);
        continue;
      }

      // Admission policy enforcement
      if (policy === ADMISSION_POLICIES.MANUAL_ONLY) {
        errors.push(`Automatic admission of NEW NPC '${name}' (${localRef}) rejected: admission policy is 'manual_only'.`);
        continue;
      }

      if (policy === ADMISSION_POLICIES.NAMED_PREFERRED) {
        if (identityKind === 'role_label' && !opts.allowRoleLabels) {
          errors.push(`Role label NPC candidate '${name}' (${localRef}) rejected under 'named_preferred' policy: role labels are not admitted unless explicitly enabled.`);
          continue;
        }
      }

      if (policy === ADMISSION_POLICIES.BALANCED_UNIQUE_ROLE_LABEL) {
        if (identityKind === 'role_label') {
          const normRole = name.trim().toLowerCase();
          if (seenRoleLabels.has(normRole)) {
            errors.push(`Duplicate role label candidate '${name}' in same transaction envelope under 'balanced_unique_role_label' policy.`);
            continue;
          }
          seenRoleLabels.add(normRole);

          const existingConflict = Object.values(currentState.npcs || {}).find(
            npc => npc && npc.name && npc.name.trim().toLowerCase() === normRole
          );
          if (existingConflict) {
            errors.push(`Role label candidate '${name}' conflicts with existing NPC '${existingConflict.name}' in state under 'balanced_unique_role_label' policy.`);
            continue;
          }
        }
      }

      // Recovery may replay a previously accepted exact source. In that narrow
      // path the coordinator supplies its original runtime ID; normal admission
      // still allocates locally. Preferred IDs are never inferred by array order.
      const preferredIds = opts.preferredIds instanceof Map
        ? opts.preferredIds
        : (opts.preferredIds && typeof opts.preferredIds === 'object' ? new Map(Object.entries(opts.preferredIds)) : null);
      const preferredId = preferredIds?.get(localRef);
      let assignedId;
      if (preferredId !== undefined) {
        if (typeof preferredId !== 'string' || preferredId.trim() === '') {
          errors.push(`Recovery preferred ID for '${localRef}' must be a non-empty string.`);
          continue;
        }
        assignedId = preferredId.trim();
        if (currentState.npcs?.[assignedId] || currentState.tombstones?.[assignedId] || seenIds.has(assignedId)) {
          errors.push(`Recovery preferred ID '${assignedId}' for '${localRef}' collides with current state or batch identity.`);
          continue;
        }
        seenIds.add(assignedId);
      } else {
        assignedId = generateStableNpcId(currentState, seenIds);
      }
      const descriptor = {
        isNew: true,
        localRef,
        assignedId,
        name: name.trim(),
        identityKind,
        aliases: p.aliases || [],
      };

      resolvedMap.set(localRef, descriptor);
      assignedNpcs.push(descriptor);
    }
  }

  // Atomic dependent failure: if any error occurred, return failed without resolving partial state
  if (errors.length > 0) {
    return {
      valid: false,
      errors,
    };
  }

  return {
    valid: true,
    resolvedMap,
    assignedNpcs,
  };
}
