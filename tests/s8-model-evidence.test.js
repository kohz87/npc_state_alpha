import test from 'node:test';
import assert from 'node:assert/strict';

import { extractAndParseOnePassTrailer, parseDevelopmentResponse } from '../src/contract/parser.js';
import { validateDevelopmentEnvelope, validateOnePassEnvelope } from '../src/contract/validator.js';

const GEMINI_38_I1 = `"I have it," Alice answered directly, lifting the brass key.

<npc_state_alpha_v1>
{
  "version": "1",
  "proposals": [
    {
      "id": "npc_alice",
      "activeInExchange": true,
      "relationshipEvaluation": {
        "shifted": false,
        "reason": "Routine cooperation, not a relationship-changing event.",
        "source": {
          "sourceRef": "current:assistant",
          "excerpt": "\\"I have it,\\" Alice answered directly, lifting the brass key."
        }
      },
      "source": {
        "sourceRef": "current:assistant",
        "excerpt": "\\"I have it,\\" Alice answered directly, lifting the brass key."
      }
    }
  ]
}
</npc_state_alpha_v1>`;

const GEMINI_38_I2 = `Lucien killed Mira's attacker while Mira stumbled back, shaken but alive. Sora watched from the doorway.

<npc_state_alpha_v1>
{
  "version": "1",
  "proposals": [
    {
      "id": "npc_mira",
      "mood": "shaken",
      "source": {
        "sourceRef": "current:assistant",
        "excerpt": "Lucien killed Mira's attacker while Mira stumbled back, shaken but alive."
      }
    },
    {
      "id": "npc_sora",
      "location": "doorway",
      "source": {
        "sourceRef": "current:assistant",
        "excerpt": "Sora watched from the doorway."
      }
    }
  ]
}
</npc_state_alpha_v1>`;

const GEMINI_38_I3 = `Rain rattles on the awnings, a bottle rolls across the stones, and distant footsteps fade behind a wall.

<npc_state_alpha_v1>
{
  "version": "1",
  "proposals": []
}
</npc_state_alpha_v1>`;

const GEMINI_38_I4_AMBIGUOUS = `It remains ambiguous whether Alice or Beth is being addressed or described as furious, so no character can be bound to the statement.

<npc_state_alpha_v1>
{
  "version": "1",
  "proposals": []
}
</npc_state_alpha_v1>`;

const GEMINI_37_D1_FENCED = `\`\`\`json
{
  "version": "1",
  "reviewReceipts": [
    {
      "targetId": "npc_alice",
      "sourceScope": ["dev:s8:d1:a", "dev:s8:d1:b"],
      "status": "reviewed"
    }
  ],
  "proposals": [
    {
      "targetId": "npc_alice",
      "personality": {
        "traits": ["Reserved", "Methodical"],
        "source": {
          "sourceRef": "dev:s8:d1:a",
          "excerpt": "I have always been methodical; I plan each expedition before I leave."
        }
      }
    }
  ],
  "observations": [],
  "supportProposals": []
}
\`\`\``;

const GEMINI_37_D2R = `{"version":"1","reviewReceipts":[{"targetId":"npc_ryu","sourceScope":["dev:s8:d2:a"],"status":"reviewed"}],"proposals":[{"targetId":"npc_ryu","facts":{"actualAge":"31","role":"station cartographer","source":{"sourceRef":"dev:s8:d2:a","excerpt":"I am thirty-one years old. Mira is my older sister, and I serve as the station cartographer."}}},{"targetId":"npc_ryu","nonPlayerRelationships":{"operation":"add","relationships":[{"targetName":"Mira","relationship":"older sister","source":{"sourceRef":"dev:s8:d2:a","excerpt":"Mira is my older sister"}}]}}],"observations":[],"supportProposals":[]}`;

test('S8 Gemini 3.8 I1: routine direct interaction keeps one valid terminal trailer and explicit no-shift evaluation', () => {
  const parsed = extractAndParseOnePassTrailer(GEMINI_38_I1);
  assert.equal(parsed.success, true, parsed.errorMessage);
  const validated = validateOnePassEnvelope(parsed.payload);
  assert.equal(validated.valid, true, JSON.stringify(validated.errors));
  assert.equal(parsed.payload.proposals.length, 1);
  assert.equal(parsed.payload.proposals[0].relationshipEvaluation.shifted, false);
  assert.equal(parsed.payload.proposals[0].activeInExchange, true);
});

test('S8 Gemini 3.8 I2: possessive attacker wording preserves both named NPCs from false death', () => {
  const parsed = extractAndParseOnePassTrailer(GEMINI_38_I2);
  assert.equal(parsed.success, true, parsed.errorMessage);
  const validated = validateOnePassEnvelope(parsed.payload);
  assert.equal(validated.valid, true, JSON.stringify(validated.errors));
  assert.deepEqual(parsed.payload.proposals.map((proposal) => proposal.id), ['npc_mira', 'npc_sora']);
  assert.equal(parsed.payload.proposals.some((proposal) => proposal.lifecycle), false);
  assert.equal(parsed.payload.proposals[0].mood, 'shaken');
  assert.equal(parsed.payload.proposals[1].location, 'doorway');
});

test('S8 Gemini 3.8 I3: atmospheric narration produces a valid no-op without phantom admission', () => {
  const parsed = extractAndParseOnePassTrailer(GEMINI_38_I3);
  assert.equal(parsed.success, true, parsed.errorMessage);
  assert.equal(validateOnePassEnvelope(parsed.payload).valid, true);
  assert.deepEqual(parsed.payload.proposals, []);
});

test('S8 Gemini 3.8 I4: genuinely ambiguous pronoun remains an explicit no-op instead of guessing identity', () => {
  const parsed = extractAndParseOnePassTrailer(GEMINI_38_I4_AMBIGUOUS);
  assert.equal(parsed.success, true, parsed.errorMessage);
  assert.equal(validateOnePassEnvelope(parsed.payload).valid, true);
  assert.deepEqual(parsed.payload.proposals, []);
});

test('S8 Gemini 3.7 D1: semantically useful fenced Development output remains rejected by strict transport parser', () => {
  const parsed = parseDevelopmentResponse(GEMINI_37_D1_FENCED);
  assert.equal(parsed.success, false);
  assert.match(parsed.errorCode || parsed.errorMessage || '', /markdown|fence|invalid/i);
});

test('S8 Gemini 3.7 D2R: matched exact-wire rerun validates age, role and targetName family proposal without invented facts', () => {
  const parsed = parseDevelopmentResponse(GEMINI_37_D2R);
  assert.equal(parsed.success, true, parsed.errorMessage);
  const validated = validateDevelopmentEnvelope(parsed.payload);
  assert.equal(validated.valid, true, JSON.stringify(validated.errors));
  const facts = parsed.payload.proposals.find((proposal) => proposal.facts)?.facts;
  assert.equal(facts.actualAge, '31');
  assert.equal(facts.role, 'station cartographer');
  assert.equal(Object.hasOwn(facts, 'birthday'), false);
  const relation = parsed.payload.proposals.find((proposal) => proposal.nonPlayerRelationships)?.nonPlayerRelationships.relationships[0];
  assert.equal(relation.targetName, 'Mira');
  assert.equal(relation.relationship, 'older sister');
});
