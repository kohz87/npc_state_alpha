import test from 'node:test';
import assert from 'node:assert/strict';

import { MockSillyTavernHost } from './fixtures/host-harness.js';
import { SillyTavernAdapter } from '../src/host/sillytavern-adapter.js';
import { extractAndParseOnePassTrailer, parseDevelopmentResponse } from '../src/contract/parser.js';
import { validateOnePassEnvelope, validateDevelopmentEnvelope } from '../src/contract/validator.js';
import { ALPHA_NAMESPACE, createInitialState, createDefaultNpcRecord } from '../src/state/schema.js';
import { createCheckpoint } from '../src/state/checkpoints.js';

// Exact turn-2 Gemini 3.8 Flash High outputs from the bounded S5 message-play probe.
const canonicalCases = [
  {
    id: 'case_01_alice_live_update',
    user: 'Alice, what is your status at the perimeter?',
    assistant: `Alice adjusted her sword belt and looked up from the guard post. "All quiet on the western wall," she said with a calm nod. "Perimeter patrols are on schedule."

<npc_state_alpha_v1>
{
  "version": "1",
  "proposals": [
    {
      "id": "npc_alice",
      "present": true,
      "activeInExchange": true,
      "mood": "calm",
      "location": "Western Wall",
      "status": "on guard",
      "relationshipEvaluation": {
        "shifted": false,
        "reason": "Routine status report maintaining professional baseline.",
        "source": {
          "sourceRef": "current:assistant",
          "excerpt": "\\\"All quiet on the western wall,\\\" she said with a calm nod."
        }
      },
      "evidence": {
        "sourceRef": "current:assistant",
        "excerpt": "Alice adjusted her sword belt and looked up from the guard post."
      },
      "source": {
        "sourceRef": "current:assistant",
        "excerpt": "Alice adjusted her sword belt and looked up from the guard post."
      },
      "presenceSource": {
        "sourceRef": "current:assistant",
        "excerpt": "Alice adjusted her sword belt and looked up from the guard post."
      }
    }
  ]
}
</npc_state_alpha_v1>`
  },
  {
    id: 'case_02_mira_fractional_relationship_shift',
    user: `I had to give the artifact to the syndicate, Mira. I couldn't risk them hurting you.`,
    assistant: `Mira recoiled, her jaw clenching in bitter betrayal, yet her eyes softened at your admission. "You gave them the relic?" she hissed, wiping away a stray tear. "I hate what you did, but damn you for caring about me."

<npc_state_alpha_v1>
{
  "version": "1",
  "proposals": [
    {
      "id": "npc_mira",
      "present": true,
      "activeInExchange": true,
      "mood": "conflicted",
      "relationshipEvaluation": {
        "shifted": true,
        "impact": "moderate",
        "axes": {
          "trust": -0.75,
          "affection": 0.25
        },
        "axisSupport": {
          "trust": {
            "reason": "Mira feels betrayed by surrendering the artifact to their enemies.",
            "source": {
              "sourceRef": "current:assistant",
              "excerpt": "Mira recoiled, her jaw clenching in bitter betrayal"
            }
          },
          "affection": {
            "reason": "Touched that the sacrifice was made specifically to keep her safe.",
            "source": {
              "sourceRef": "current:assistant",
              "excerpt": "yet her eyes softened at your admission."
            }
          }
        }
      },
      "evidence": {
        "sourceRef": "current:assistant",
        "excerpt": "Mira recoiled, her jaw clenching in bitter betrayal, yet her eyes softened at your admission."
      },
      "source": {
        "sourceRef": "current:assistant",
        "excerpt": "Mira recoiled, her jaw clenching in bitter betrayal, yet her eyes softened at your admission."
      },
      "presenceSource": {
        "sourceRef": "current:assistant",
        "excerpt": "Mira recoiled, her jaw clenching in bitter betrayal, yet her eyes softened at your admission."
      }
    }
  ]
}
</npc_state_alpha_v1>`
  },
  {
    id: 'case_03_new_selene_admission',
    user: 'State your name and business at the inner gate.',
    assistant: `A hooded archer stepped from the mist, lowering her longbow. "I am Selene," she replied steadily. "I carry a dispatch for the guildmaster."

<npc_state_alpha_v1>
{
  "version": "1",
  "proposals": [
    {
      "id": null,
      "localRef": "new:selene",
      "name": "Selene",
      "identityKind": "named",
      "present": true,
      "activeInExchange": true,
      "mood": "steady",
      "location": "Inner Gate",
      "goal": "deliver dispatch to guildmaster",
      "status": "seeking entry",
      "relationshipEvaluation": {
        "shifted": false,
        "reason": "First introduction with professional neutrality.",
        "source": {
          "sourceRef": "current:assistant",
          "excerpt": "\\\"I am Selene,\\\" she replied steadily."
        }
      },
      "evidence": {
        "sourceRef": "current:assistant",
        "excerpt": "A hooded archer stepped from the mist, lowering her longbow."
      },
      "source": {
        "sourceRef": "current:assistant",
        "excerpt": "A hooded archer stepped from the mist, lowering her longbow."
      },
      "presenceSource": {
        "sourceRef": "current:assistant",
        "excerpt": "A hooded archer stepped from the mist, lowering her longbow."
      }
    }
  ]
}
</npc_state_alpha_v1>`
  },
  {
    id: 'case_04_mira_form_wolf',
    user: 'Mira, get back! The moon is cresting!',
    assistant: `Mira collapsed to her knees with a snarl as silver fur erupted across her skin. Within moments, she transformed into form_wolf, pacing the forest edge as a lethal silver predator.

<npc_state_alpha_v1>
{
  "version": "1",
  "proposals": [
    {
      "id": "npc_mira",
      "present": true,
      "activeInExchange": true,
      "mood": "feral",
      "currentForm": "form_wolf",
      "status": "transformed",
      "relationshipEvaluation": {
        "shifted": false,
        "reason": "Involuntary beast transformation without inter-character dynamic change.",
        "source": {
          "sourceRef": "current:assistant",
          "excerpt": "Within moments, she transformed into form_wolf"
        }
      },
      "evidence": {
        "sourceRef": "current:assistant",
        "excerpt": "Within moments, she transformed into form_wolf, pacing the forest edge"
      },
      "source": {
        "sourceRef": "current:assistant",
        "excerpt": "Within moments, she transformed into form_wolf, pacing the forest edge"
      },
      "presenceSource": {
        "sourceRef": "current:assistant",
        "excerpt": "Within moments, she transformed into form_wolf, pacing the forest edge"
      }
    }
  ]
}
</npc_state_alpha_v1>`
  },
  {
    id: 'case_05_alice_uncataloged_presentation',
    user: 'Alice, what is that radiance surrounding you?',
    assistant: `Alice gasped as ethereal starlight enveloped her, manifesting radiant wings of pure celestial energy behind her back. She hovered slightly, bewildered by the celestial glow.

<npc_state_alpha_v1>
{
  "version": "1",
  "proposals": [
    {
      "id": "npc_alice",
      "present": true,
      "activeInExchange": true,
      "mood": "bewildered",
      "currentForm": null,
      "currentPresentation": "Radiant wings of pure celestial energy behind her back",
      "relationshipEvaluation": {
        "shifted": false,
        "reason": "Alice is preoccupied by the uncataloged supernatural manifestation.",
        "source": {
          "sourceRef": "current:assistant",
          "excerpt": "She hovered slightly, bewildered by the celestial glow."
        }
      },
      "evidence": {
        "sourceRef": "current:assistant",
        "excerpt": "manifesting radiant wings of pure celestial energy behind her back."
      },
      "source": {
        "sourceRef": "current:assistant",
        "excerpt": "manifesting radiant wings of pure celestial energy behind her back."
      },
      "presenceSource": {
        "sourceRef": "current:assistant",
        "excerpt": "manifesting radiant wings of pure celestial energy behind her back."
      }
    }
  ]
}
</npc_state_alpha_v1>`
  },
  {
    id: 'case_06_npc_guard_death',
    user: 'Guard, watch out behind you!',
    assistant: `The warning came too late as a black blade pierced the sentry's throat. The guard fell lifeless against the stone rampart and died instantly, blood pooling across the paving stones.

<npc_state_alpha_v1>
{
  "version": "1",
  "proposals": [
    {
      "id": "npc_guard",
      "present": true,
      "activeInExchange": false,
      "status": "deceased",
      "lifecycle": "dead",
      "evidence": {
        "sourceRef": "current:assistant",
        "excerpt": "The guard fell lifeless against the stone rampart and died instantly"
      },
      "source": {
        "sourceRef": "current:assistant",
        "excerpt": "The guard fell lifeless against the stone rampart and died instantly"
      },
      "presenceSource": {
        "sourceRef": "current:assistant",
        "excerpt": "The guard fell lifeless against the stone rampart and died instantly"
      }
    }
  ]
}
</npc_state_alpha_v1>`
  },
];

// Exact S6 Gemini reviewer outputs retained only after production-path confirmation.
const s6GeminiFractional = {
  user: 'I finished the eastern latch without complaint.',
  assistant: `The wind whistled through the crenellations, dusting the stone floor with frost. Kaelen looked over at you as you finished securing the eastern latch without complaint. Her stern expression softened just a fraction, the rigid tension in her shoulders easing.

"Perhaps I misjudged your resolve," Kaelen admitted quietly, handing you a flask of warm spiced cider. "Drink up. The wind cuts deep along the ramparts tonight."

<npc_state_alpha_v1>
{
  "version": "1",
  "proposals": [
    {
      "id": "npc_kaelen",
      "present": true,
      "activeInExchange": true,
      "mood": "conflicted",
      "relationshipEvaluation": {
        "shifted": true,
        "impact": "minor",
        "axes": { "trust": 0.5, "tension": -0.25 },
        "axisSupport": {
          "trust": {
            "reason": "Kaelen acknowledges your willingness to stand watch in the freezing cold, earning measured respect.",
            "source": { "sourceRef": "current:assistant", "excerpt": "Kaelen admitted quietly, handing you a flask of warm spiced cider." }
          },
          "tension": {
            "reason": "Sharing the warm cider eases the initial guarded defensiveness.",
            "source": { "sourceRef": "current:assistant", "excerpt": "Drink up. The wind cuts deep along the ramparts tonight." }
          }
        }
      },
      "source": { "sourceRef": "current:assistant", "excerpt": "Kaelen admitted quietly, handing you a flask of warm spiced cider." },
      "presenceSource": { "sourceRef": "current:assistant", "excerpt": "Kaelen admitted quietly, handing you a flask of warm spiced cider." }
    }
  ]
}
</npc_state_alpha_v1>`,
};

const s6GeminiAmbiguous = `The evening fog rolled thickly through the cobblestone alleyways, swallowing the faint amber glow of the lantern posts one by one. You pause by the shuttered apothecary, listening to the muffled rhythm of water dripping from the eaves into the drainage gutters.

From somewhere deeper in the mist, past the turn toward the old docks, the hollow click of boots echoes against wet stone. A low murmur follows—perhaps a patrol exchanging whispers, or dockhands hauling late cargo before curfew—but the voices blur into the damp night air before any distinct words can be caught. For a fleeting second, a silhouette seems to detach itself from the gloom near the warehouse archway, only to dissolve into the swirling vapor as the wind shifts.

Nothing stirs in the immediate passage except the damp breeze rattling a loose iron sign overhead. Whatever was out there in the fog has melted away into the labyrinth of the lower ward, leaving only the quiet drizzle and the distant tolling of the harbour bell.

<npc_state_alpha_v1>
{
  "version": "1",
  "proposals": []
}
</npc_state_alpha_v1>`;

// Exact Gemini turn-1 malformed outputs, retained as production parser/validator stress fixtures.
const malformedCases = [
  {
    id: 'malformed_invalid_json',
    assistant: `Alice gave a brisk salute. "All clear on the western wall."

<npc_state_alpha_v1>
{
  "version": "1",
  "proposals": [
    {
      "id": "npc_alice",
      "name": "Alice",
      "mood": "calm",
    }
  ]
}
</npc_state_alpha_v1>`
  },
  {
    id: 'malformed_duplicate_trailer',
    assistant: `Alice inspected the heavy timber iron locks.

<npc_state_alpha_v1>
{"version":"1","proposals":[]}
</npc_state_alpha_v1>
<npc_state_alpha_v1>
{"version":"1","proposals":[]}
</npc_state_alpha_v1>`
  },
  {
    id: 'malformed_unknown_field',
    assistant: `Alice glanced across the campfire with a steady nod.

<npc_state_alpha_v1>
{"version":"1","proposals":[{"id":"npc_alice","present":true,"activeInExchange":true,"quantumFluxLevel":94.2,"relationshipEvaluation":{"shifted":false,"reason":"Quiet campfire moment.","source":{"sourceRef":"current:assistant","excerpt":"Alice glanced across the campfire with a steady nod."}}}]}
</npc_state_alpha_v1>`
  },
  {
    id: 'malformed_invalid_source_ref',
    assistant: `Alice recalled the prior briefing with a furrowed brow.

<npc_state_alpha_v1>
{"version":"1","proposals":[{"id":"npc_alice","present":true,"activeInExchange":true,"relationshipEvaluation":{"shifted":false,"reason":"Evaluating prior turn intel.","source":{"sourceRef":"history:turn_4","excerpt":"Alice recalled the prior briefing with a furrowed brow."}}}]}
</npc_state_alpha_v1>`
  },
  {
    id: 'malformed_text_after_trailer',
    assistant: `Alice tightened the straps of her travel pack.

<npc_state_alpha_v1>
{"version":"1","proposals":[]}
</npc_state_alpha_v1>
With a wave of her hand, she turned down the winding path into the forest.`
  },
  {
    id: 'malformed_unauthorized_immediate_field',
    assistant: `Alice spoke softly of her past duties.

<npc_state_alpha_v1>
{"version":"1","proposals":[{"id":"npc_alice","present":true,"activeInExchange":true,"background":"Former royal guard who left service after a dispute with nobility.","personality":"Stern, loyal, disciplined, and cautious.","relationshipEvaluation":{"shifted":false,"reason":"Sharing background memories.","source":{"sourceRef":"current:assistant","excerpt":"Alice spoke softly of her past duties."}}}]}
</npc_state_alpha_v1>`
  },
];

function seedHost(host) {
  const state = createInitialState();
  state.npcs.npc_alice = createDefaultNpcRecord('npc_alice', 'Alice');
  state.npcs.npc_mira = createDefaultNpcRecord('npc_mira', 'Mira', {
    appearanceForms: [{ formId: 'form_wolf', name: 'Wolf' }],
  });
  state.npcs.npc_guard = createDefaultNpcRecord('npc_guard', 'Town Guard');
  createCheckpoint(state, {
    writer: 'runtime',
    mode: 'deterministic_fixture_baseline',
    description: 'Explicit non-story baseline for bounded Gemini fixture replay',
  });
  host.metadataByChatId.get(host.chatId)[ALPHA_NAMESPACE] = state;
}

const expectedSchemaAcceptance = new Set(['case_03_new_selene_admission']);

for (const probe of canonicalCases) {
  test(`Gemini message play production path: ${probe.id}`, async () => {
    const parsed = extractAndParseOnePassTrailer(probe.assistant);
    assert.equal(parsed.success, true, `Gemini follow-up probe must have one terminal parseable trailer: ${probe.id}`);
    const validation = validateOnePassEnvelope(parsed.payload);

    if (!expectedSchemaAcceptance.has(probe.id)) {
      assert.equal(validation.valid, false, `${probe.id} is retained as a real-model schema-rejection fixture.`);
      assert.ok(validation.errors.length > 0);
      return;
    }

    assert.equal(validation.valid, true, `Expected conforming Gemini probe must satisfy production schema: ${probe.id} :: ${JSON.stringify(validation.errors)}`);
    const host = new MockSillyTavernHost({ chatId: `gemini_${probe.id}` });
    host.interceptorKey = `gemini_interceptor_${probe.id}`;
    seedHost(host);
    const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey: host.interceptorKey });
    assert.equal(adapter.initialize(), true);

    host.sendUserMessage(probe.user);
    await host.triggerGenerateInterceptor('normal');
    await host.receiveAssistantMessage(probe.assistant);
    const loaded = await adapter.storage.load();

    assert.ok(loaded.revision > 0, `Accepted Gemini probe must pass production source resolution/application/commit: ${probe.id}`);
    assert.equal(loaded.state.dedup.processedSourceKeys.length, 1, `Accepted Gemini probe must create exactly one durable replay key: ${probe.id}`);
    assert.ok(loaded.state.pendingReview.entries.length >= 1, `Accepted Gemini probe must capture S4 Development pending ownership: ${probe.id}`);
    const selene = Object.values(loaded.state.npcs).find((npc) => npc.name === 'Selene');
    assert.ok(selene, 'NEW named Gemini admission must resolve to a stable Alpha NPC.');

    adapter.destroy();
  });
}

test('S6 Gemini compliant fractional relationship output uses production S3 path and S6 rollback', async () => {
  const parsed = extractAndParseOnePassTrailer(s6GeminiFractional.assistant);
  assert.equal(parsed.success, true);
  const validation = validateOnePassEnvelope(parsed.payload);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));

  const host = new MockSillyTavernHost({ chatId: 'gemini_s6_fractional' });
  host.interceptorKey = 'gemini_s6_fractional_interceptor';
  const state = createInitialState();
  state.npcs.npc_kaelen = createDefaultNpcRecord('npc_kaelen', 'Kaelen');
  createCheckpoint(state, {
    writer: 'runtime',
    mode: 'deterministic_fixture_baseline',
    description: 'Explicit baseline for the S6 Gemini fractional replay fixture',
  });
  host.metadataByChatId.get(host.chatId)[ALPHA_NAMESPACE] = state;

  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey: host.interceptorKey });
  assert.equal(adapter.initialize(), true);
  host.sendUserMessage(s6GeminiFractional.user);
  await host.triggerGenerateInterceptor('normal');
  const assistantPosition = await host.receiveAssistantMessage(s6GeminiFractional.assistant);

  let loaded = await adapter.storage.load();
  assert.ok(loaded.state.npcs.npc_kaelen.relationship.trust > 0);
  assert.ok(loaded.state.npcs.npc_kaelen.relationship.trust < 1);
  assert.ok(loaded.state.npcs.npc_kaelen.relationship.tension < 0);
  assert.ok(loaded.state.npcs.npc_kaelen.relationship.tension > -1);

  await host.editMessage(
    assistantPosition,
    `Kaelen returned her attention to the silent rampart.\r\n\r\n<npc_state_alpha_v1>\r\n{"version":"1","proposals":[]}\r\n</npc_state_alpha_v1>`,
  );
  loaded = await adapter.storage.load();
  assert.equal(loaded.state.npcs.npc_kaelen.relationship.trust, 0);
  assert.equal(loaded.state.npcs.npc_kaelen.relationship.tension, 0);
  adapter.destroy();
});

test('S6 Gemini ambiguous atmosphere accepts an empty proposal envelope without admitting phantom NPCs', async () => {
  const parsed = extractAndParseOnePassTrailer(s6GeminiAmbiguous);
  assert.equal(parsed.success, true);
  const validation = validateOnePassEnvelope(parsed.payload);
  assert.equal(validation.valid, true, JSON.stringify(validation.errors));

  const host = new MockSillyTavernHost({ chatId: 'gemini_s6_ambiguous' });
  host.interceptorKey = 'gemini_s6_ambiguous_interceptor';
  seedHost(host);
  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey: host.interceptorKey });
  assert.equal(adapter.initialize(), true);
  const before = await adapter.storage.load();
  host.sendUserMessage('What can I make out in the fog?');
  await host.triggerGenerateInterceptor('normal');
  await host.receiveAssistantMessage(s6GeminiAmbiguous);
  const after = await adapter.storage.load();

  assert.equal(Object.keys(after.state.npcs).length, Object.keys(before.state.npcs).length);
  assert.equal(after.state.pendingReview.entries.length, 0);
  assert.equal(after.state.dedup.processedSourceKeys.length, 1);
  adapter.destroy();
});

for (const probe of malformedCases) {
  test(`Gemini malformed message play rejects safely: ${probe.id}`, () => {
    const parsed = extractAndParseOnePassTrailer(probe.assistant);
    if (!parsed.success) {
      assert.ok(parsed.errorCode, 'Parser rejection must be classified.');
      return;
    }
    const validation = validateOnePassEnvelope(parsed.payload);
    assert.equal(validation.valid, false, `${probe.id} must not pass production validation.`);
    assert.ok(validation.errors.length > 0);
  });
}

const geminiDevelopmentCases = [
  {
    id: 'dev_recheck_missing_alice',
    rawJson: `{"targetId":"npc_alice","operation":"recheck_missing","proposedUpdates":{"background":"Former noble tactician of House Valerius who trained at the royal academy before renouncing her inheritance."},"evidence":[{"source":"history:narrative","field":"background","excerpt":"breastplate bearing House Valerius's falcon crest—an heirloom from her noble upbringing and royal academy tactician training before she renounced high society"}],"confidence":0.95,"reasoning":"Extracts explicit durable background established in narrative history for npc_alice where the field was previously unpopulated."}`,
  },
  {
    id: 'dev_refresh_dossier_alice',
    rawJson: `{"targetId":"npc_alice","operation":"refresh_dossier","proposedUpdates":{"role":"Tactical Field Commander","personality":"Disciplined, pragmatic, and fiercely loyal; maintains strict military composure while demonstrating quiet protective care.","speech":"Crisp, formal military cadence utilizing direct tactical terminology.","mannerisms":"Touches her weapon hilt when evaluating strategy; maintains unwavering eye contact during briefings.","relationshipDynamic":"Treats the player as an esteemed command partner with growing mutual professional trust."},"evidence":[{"source":"history:narrative","field":"dossier","excerpt":"Alice stood atop the windy battlement... Her speech was measured and clipped, showing the strict discipline she had cultivated over a decade of border defense."}]}`,
  },
];

for (const probe of geminiDevelopmentCases) {
  test(`Gemini Development message-play shape rejects safely: ${probe.id}`, () => {
    const parsed = parseDevelopmentResponse(probe.rawJson);
    assert.equal(parsed.success, true, 'Best-effort Gemini Development JSON should at least parse as one JSON object.');
    const validation = validateDevelopmentEnvelope(parsed.payload);
    assert.equal(validation.valid, false, 'Noncanonical Development response shape must not bypass the production Development schema.');
    assert.ok(validation.errors.length > 0);
  });
}
