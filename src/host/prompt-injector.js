/**
 * NPC State Alpha — Prompt Injector & Continuity Projection
 *
 * Implements C03, C04, C06, C10, C13 and S7 selective-context optimization.
 * Assembles compact continuity from latest committed state and appends
 * the C04 immediate output contract.
 *
 * Excludes machine transport trailers from narrative history without
 * destructively mutating raw chat messages.
 */

import {
  TRAILER_TAG_OPEN,
  TRAILER_TAG_CLOSE,
  ALPHA_ONE_PASS_WIRE_VERSION,
} from '../contract/wire-schemas.js';
import {
  stripMachineTrailer,
} from '../runtime/source-resolver.js';

const AUTO_DETAIL_BUDGET = 4;

function normalizedDetailBudget(value) {
  if (Number.isInteger(value) && value > 0) return value;
  return AUTO_DETAIL_BUDGET;
}

function normalizeMentionText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function isExplicitlyMentioned(npc, currentUserText) {
  const haystack = ` ${normalizeMentionText(currentUserText)} `;
  if (haystack.trim() === '') return false;
  const labels = [npc?.name, ...(Array.isArray(npc?.aliases) ? npc.aliases : [])]
    .filter((value) => typeof value === 'string' && value.trim() !== '')
    .map(normalizeMentionText)
    .filter(Boolean);
  return labels.some((label) => haystack.includes(` ${label} `));
}

function compareTextStable(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareNpcStable(a, b) {
  return compareTextStable(a?.id, b?.id) || compareTextStable(a?.name, b?.name);
}

function identityParts(npc) {
  const parts = [`[${npc.name}] (id: ${npc.id})`];
  if (Array.isArray(npc.aliases) && npc.aliases.length > 0) {
    parts.push(`aliases: [${npc.aliases.join(', ')}]`);
  }
  return parts;
}

function detailedNpcLine(npc) {
  const parts = identityParts(npc);
  parts.push(npc.present ? 'present: in-scene' : 'present: off-screen');
  if (npc.activeInExchange) parts.push('active: yes');
  if (npc.offscreenActivity) parts.push(`offscreenActivity: "${npc.offscreenActivity}"`);
  if (npc.location) parts.push(`location: "${npc.location}"`);
  if (npc.mood) parts.push(`mood: "${npc.mood}"`);
  if (npc.status) parts.push(`status: "${npc.status}"`);
  if (npc.goal) parts.push(`goal: "${npc.goal}"`);
  if (npc.currentPresentation) parts.push(`presentation: "${npc.currentPresentation}"`);
  if (npc.currentForm) parts.push(`form: "${npc.currentForm}"`);

  if (Array.isArray(npc.appearanceForms) && npc.appearanceForms.length > 0) {
    const knownForms = npc.appearanceForms
      .filter((form) => form && typeof form.formId === 'string' && form.formId.trim() !== '')
      .map((form) => {
        const label = typeof form.name === 'string' && form.name.trim() !== ''
          ? form.name.trim()
          : (typeof form.label === 'string' && form.label.trim() !== '' ? form.label.trim() : null);
        return label ? `${form.formId}=${label}` : form.formId;
      });
    if (knownForms.length > 0) parts.push(`knownForms(read-only): [${knownForms.join(', ')}]`);
  }

  if (npc.relationship) {
    const { trust, affection, desire, tension } = npc.relationship;
    if (trust !== 0 || affection !== 0 || desire !== 0 || tension !== 0) {
      parts.push(`rel(player): trust=${trust}, affection=${affection}, desire=${desire}, tension=${tension}`);
    }
  }
  if (npc.relationshipDynamic) parts.push(`dynamic: "${npc.relationshipDynamic}" (read-only)`);
  return parts.join(' | ');
}

export class PromptInjector {
  /**
   * Projects compact continuity from current committed state.
   *
   * S7 keeps all living/deceased identities visible but spends detailed context
   * only on NPCs that are in-scene/active, explicitly named by the current user,
   * or selected to fill the soft detail budget. The budget is never a correctness
   * cap: required in-scene/mentioned identities stay detailed even when they exceed it.
   *
   * @param {object} state Committed state conforming to npc_state_alpha.v1 schema
   * @param {object} [options]
   * @param {number|'auto'} [options.routineDossierDetailBudget]
   * @param {string} [options.currentUserText]
   * @returns {string} Compact continuity text block
   */
  static buildContinuityProjection(state, options = {}) {
    if (!state || !state.npcs || typeof state.npcs !== 'object') {
      return '[NPC State: No active continuity state]';
    }

    const npcs = Object.values(state.npcs).sort(compareNpcStable);
    const tombstones = state.tombstones || {};
    const livingNpcs = npcs.filter((npc) => !tombstones[npc.id] && npc.lifeState !== 'dead');
    const deceasedNpcs = npcs.filter((npc) => !tombstones[npc.id] && npc.lifeState === 'dead');

    const requiredDetail = new Set();
    for (const npc of livingNpcs) {
      if (npc.present || npc.activeInExchange || isExplicitlyMentioned(npc, options.currentUserText)) {
        requiredDetail.add(npc.id);
      }
    }

    const targetDetailCount = normalizedDetailBudget(options.routineDossierDetailBudget);
    if (requiredDetail.size < targetDetailCount) {
      const fillCandidates = livingNpcs
        .filter((npc) => !requiredDetail.has(npc.id))
        .sort((a, b) => Number(Boolean(b.importance)) - Number(Boolean(a.importance)) || compareNpcStable(a, b));
      for (const npc of fillCandidates) {
        if (requiredDetail.size >= targetDetailCount) break;
        requiredDetail.add(npc.id);
      }
    }

    const lines = ['--- NPC State Continuity (v1) ---'];
    if (livingNpcs.length === 0) {
      lines.push('[No active living NPCs]');
    } else {
      for (const npc of livingNpcs) {
        if (requiredDetail.has(npc.id)) {
          lines.push(detailedNpcLine(npc));
        } else {
          lines.push(`${identityParts(npc).join(' | ')} | identity-only`);
        }
      }
    }

    if (deceasedNpcs.length > 0) {
      lines.push(`Deceased: ${deceasedNpcs.map((npc) => `${npc.name} (id: ${npc.id})`).join(', ')}`);
    }
    return lines.join('\n');
  }

  /** Generates the compact C04 immediate output contract prompt. */
  static buildImmediateOutputContract({ admissionPolicy = 'named_preferred' } = {}) {
    const identityRule = admissionPolicy === 'manual_only'
      ? 'Identity: existing stable ids only; automatic NEW admission is disabled.'
      : `Identity: existing ids for known NPCs. NEW: {"id":null,"localRef":"new:<name>","name":"<Name>","identityKind":${admissionPolicy === 'balanced_unique_role_label' ? '"named"|"role_label"' : '"named"'},"evidence":{"sourceRef":"current:user"|"current:assistant","excerpt":"<verbatim>"}}; include aliases only when directly supported, as a non-empty string array. Existing name/alias corrections also require direct evidence.`;

    return `--- NPC Immediate Output Contract v1 ---
Append exactly one terminal ${TRAILER_TAG_OPEN} JSON trailer ${TRAILER_TAG_CLOSE}; no markdown wrapper and nothing after it.
Root: {"version":"${ALPHA_ONE_PASS_WIRE_VERSION}","proposals":[]}.
${identityRule}
Writable Immediate fields: present, activeInExchange, offscreenActivity, mood, location, goal, status, currentPresentation, currentForm, relationshipEvaluation, lifecycle(death only).
Ordinary fields are direct proposal scalars (e.g. "present":true), with one sibling source={"sourceRef":"current:user"|"current:assistant","excerpt":"<verbatim>"}; the evidence key is literally source, never invented <field>Source keys. Never wrap a field as {value,source}. Omit unsupported or unchanged fields; omission preserves. Never guess.
Relationship (NPC->PLAYER): every activeInExchange:true NPC needs relationshipEvaluation. No shift: {"shifted":false,"reason":"...","source":{...}}. Shift: {"shifted":true,"impact":"minor"|"moderate"|"major","axes":{"trust":n,"affection":n,"desire":n,"tension":n},"axisSupport":{"<changed-axis>":{"reason":"...","source":{...}}}}. Axis numbers occur only inside axes; include only supported changed axes.
Form: currentForm selects only a supplied knownForms(read-only) id; use null for an observed form with no established id.
Lifecycle: living->dead only via lifecycle={"lifeState":"dead","cause":"...","source":{...}}. Target the actual victim; possessive/adjacent wording or explicit survival is not death. automatic resurrection is forbidden.
Known NPC aliases: alternate names/identifiers, not alternate forms.
Development-owned dossier fields are read-only here: relationshipDynamic, canonicalAppearance, appearanceForms, personality, behavioralProfile, speech, mannerisms, role, species, background, actualAge, apparentAge, birthday, importantMemories, nonPlayerRelationships.`;
  }

  /** Combines continuity projection and immediate output contract for prompt injection. */
  static buildExtensionPrompt(state, options = {}) {
    const continuity = PromptInjector.buildContinuityProjection(state, options);
    const contract = PromptInjector.buildImmediateOutputContract(options);
    return `${continuity}\n\n${contract}`;
  }

  /**
   * Projects message history with recognized Alpha machine trailers stripped
   * from assistant messages without modifying the raw chat objects.
   */
  static stripTrailersFromHistory(chat) {
    if (!Array.isArray(chat)) return [];
    return chat.map((msg) => {
      if (!msg || typeof msg !== 'object') return msg;
      if (!msg.is_user && !msg.is_system && typeof msg.mes === 'string') {
        const clean = stripMachineTrailer(msg.mes);
        if (clean !== msg.mes) return { ...msg, mes: clean };
      }
      return msg;
    });
  }
}
