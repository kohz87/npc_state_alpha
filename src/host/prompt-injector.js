/**
 * NPC State Alpha — Prompt Injector & Continuity Projection
 *
 * Implements C03, C04, C06, C10, C13 and S3 Requirement 3.
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

export class PromptInjector {
  /**
   * Projects a compact continuity summary from the current committed state.
   * Excludes confirmed dead or tombstoned NPCs from living in-scene presence (C06).
   *
   * @param {object} state Committed state conforming to npc_state_alpha.v1 schema
   * @returns {string} Compact continuity text block
   */
  static buildContinuityProjection(state) {
    if (!state || !state.npcs || typeof state.npcs !== 'object') {
      return '[NPC State: No active continuity state]';
    }

    const npcs = Object.values(state.npcs);
    const tombstones = state.tombstones || {};

    const livingNpcs = npcs.filter(
      (npc) => !tombstones[npc.id] && npc.lifeState !== 'dead'
    );

    const deceasedNpcs = npcs.filter(
      (npc) => !tombstones[npc.id] && npc.lifeState === 'dead'
    );

    const lines = [];
    lines.push('--- NPC State Continuity (v1) ---');

    if (livingNpcs.length === 0) {
      lines.push('[No active living NPCs]');
    } else {
      for (const npc of livingNpcs) {
        const parts = [];
        parts.push(`[${npc.name}] (id: ${npc.id})`);

        if (Array.isArray(npc.aliases) && npc.aliases.length > 0) {
          parts.push(`aliases: [${npc.aliases.join(', ')}]`);
        }

        parts.push(npc.present ? 'present: in-scene' : 'present: off-screen');
        if (npc.activeInExchange) {
          parts.push('active: yes');
        }
        if (npc.offscreenActivity) {
          parts.push(`offscreenActivity: "${npc.offscreenActivity}"`);
        }
        if (npc.location) {
          parts.push(`location: "${npc.location}"`);
        }
        if (npc.mood) {
          parts.push(`mood: "${npc.mood}"`);
        }
        if (npc.status) {
          parts.push(`status: "${npc.status}"`);
        }
        if (npc.goal) {
          parts.push(`goal: "${npc.goal}"`);
        }
        if (npc.currentPresentation) {
          parts.push(`presentation: "${npc.currentPresentation}"`);
        }
        if (npc.currentForm) {
          parts.push(`form: "${npc.currentForm}"`);
        }
        if (Array.isArray(npc.appearanceForms) && npc.appearanceForms.length > 0) {
          const knownForms = npc.appearanceForms
            .filter((form) => form && typeof form.formId === 'string' && form.formId.trim() !== '')
            .map((form) => {
              const label = typeof form.name === 'string' && form.name.trim() !== ''
                ? form.name.trim()
                : (typeof form.label === 'string' && form.label.trim() !== '' ? form.label.trim() : null);
              return label ? `${form.formId}=${label}` : form.formId;
            });
          if (knownForms.length > 0) {
            parts.push(`knownForms(read-only): [${knownForms.join(', ')}]`);
          }
        }

        // Relationship scores toward PLAYER
        if (npc.relationship) {
          const { trust, affection, desire, tension } = npc.relationship;
          if (trust !== 0 || affection !== 0 || desire !== 0 || tension !== 0) {
            parts.push(`rel(player): trust=${trust}, affection=${affection}, desire=${desire}, tension=${tension}`);
          }
        }
        if (npc.relationshipDynamic) {
          parts.push(`dynamic: "${npc.relationshipDynamic}"`);
        }

        lines.push(parts.join(' | '));
      }
    }

    // Lightweight notation for deceased characters (excluded from living presence)
    if (deceasedNpcs.length > 0) {
      const deadNames = deceasedNpcs.map((n) => `${n.name} (id: ${n.id}, deceased)`).join(', ');
      lines.push(`Deceased: ${deadNames}`);
    }

    return lines.join('\n');
  }

  /**
   * Generates the concise C04 immediate output contract prompt.
   * @returns {string}
   */
  static buildImmediateOutputContract({ admissionPolicy = 'named_preferred' } = {}) {
    const identityChannel = admissionPolicy === 'manual_only'
      ? '- Identity & Admission: NEW automatic admission is disabled; target existing NPCs only by supplied stable id.'
      : `- Identity & Admission: {"id": null, "localRef": "new:<name>", "name": "<Name>", "identityKind": ${admissionPolicy === 'balanced_unique_role_label' ? '"named"|"role_label"' : '"named"'}, "aliases": ["..."], "evidence": {"sourceRef": "current:user"|"current:assistant", "excerpt": "<verbatim>"}}`;

    return `--- NPC Immediate Output Contract (v1) ---
At the very end of your response, output exactly one ${TRAILER_TAG_OPEN}...${TRAILER_TAG_CLOSE} JSON trailer.
Allowed immediate channels only:
${identityChannel}
- Presence & Activation: {"id": "<existing_id>", "present": true|false, "activeInExchange": true|false, "source": {"sourceRef": "current:user"|"current:assistant", "excerpt": "<verbatim>"}}
- Situational / Ephemeral: {"id": "<existing_id>", "mood": "...", "location": "...", "goal": "...", "status": "...", "offscreenActivity": "...", "source": {"sourceRef": "current:user"|"current:assistant", "excerpt": "<verbatim>"}}
- Presentation & Form: {"id": "<existing_id>", "currentPresentation": "...", "currentForm": "<form_id>"|null, "source": {"sourceRef": "current:user"|"current:assistant", "excerpt": "<verbatim>"}}
- Relationship Evaluation: {"id": "<existing_id>", "relationshipEvaluation": {"shifted": false, "reason": "...", "source": {"sourceRef": "current:user"|"current:assistant", "excerpt": "..."}}} OR {"id": "<existing_id>", "relationshipEvaluation": {"shifted": true, "impact": "minor"|"moderate"|"major", "axes": {"trust": 1, "affection": 0, "desire": 0, "tension": 0}, "axisSupport": {"trust": {"reason": "...", "source": {"sourceRef": "current:user"|"current:assistant", "excerpt": "..."}}}}}
- Lifecycle / Death: {"id": "<existing_id>", "lifecycle": {"lifeState": "dead", "cause": "...", "source": {"sourceRef": "current:user"|"current:assistant", "excerpt": "..."}}}
Strict boundaries:
- Every field mutation must include valid verbatim source grounding ("current:user" or "current:assistant").
- Every NPC with activeInExchange:true must include relationshipEvaluation; use shifted:false for an explicit no-shift judgment.
- currentForm may select only a knownForms(read-only) form ID supplied in continuity; use null when an observed/new form has no established ID.
- Living to dead only; automatic resurrection is strictly forbidden.
- Do NOT propose durable development fields (no relationshipDynamic, canonicalAppearance, appearanceForms, personality, behavioralProfile, speech, mannerisms, role, species, background, actualAge, apparentAge, birthday, importantMemories, nonPlayerRelationships).
- Trailer must be at the very end of your response. Example:
${TRAILER_TAG_OPEN}
{"version":"${ALPHA_ONE_PASS_WIRE_VERSION}","proposals":[]}
${TRAILER_TAG_CLOSE}`;
  }

  /**
   * Combines continuity projection and immediate output contract for prompt injection.
   *
   * @param {object} state Committed state conforming to npc_state_alpha.v1 schema
   * @returns {string} Prompt string to inject into SillyTavern
   */
  static buildExtensionPrompt(state, options = {}) {
    const continuity = PromptInjector.buildContinuityProjection(state);
    const contract = PromptInjector.buildImmediateOutputContract(options);
    return `${continuity}\n\n${contract}`;
  }

  /**
   * Projects message history with recognized Alpha machine trailers stripped
   * from assistant messages without modifying the raw chat objects.
   * Preserves malformed, duplicate, or schema-invalid trailers intact.
   *
   * @param {Array<object>} chat Array of SillyTavern message objects
   * @returns {Array<object>} Projected clean messages
   */
  static stripTrailersFromHistory(chat) {
    if (!Array.isArray(chat)) return [];
    return chat.map((msg) => {
      if (!msg || typeof msg !== 'object') return msg;
      // Restrict stripping strictly to actual assistant messages with a valid Alpha trailer
      if (!msg.is_user && !msg.is_system && typeof msg.mes === 'string') {
        const clean = stripMachineTrailer(msg.mes);
        if (clean !== msg.mes) {
          return { ...msg, mes: clean };
        }
      }
      return msg;
    });
  }
}
