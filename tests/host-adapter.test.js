/**
 * NPC State Alpha — S3 Host Integration Test Suite
 *
 * Tests the SillyTavern 1.18.0 One-Pass immediate continuity vertical end-to-end:
 * - Extension/bootstrap initialization & capability detection
 * - Generation interceptor request capture & compact prompt injection
 * - Finalized assistant event accepted
 * - Streaming fragment ignored (no state mutation during streaming progress)
 * - GENERATION_ENDED ignored as commit signal
 * - Duplicate finalized event deduped (replay protection)
 * - Chat isolation & chat switch
 * - Continuation, regeneration, swipe, and reused-position identity
 * - Extension/state reload behavior
 * - One valid trailer vs missing/malformed/duplicate/invalid JSON/schema
 * - current:user / current:assistant exact source resolution
 * - Excerpt verification against trailer-stripped narrative
 * - Immediate-owned field accepted; Development-owned field rejected
 * - Terminal death transition & living presence exclusion
 * - Atomic persistence & pending Development refs (Requirement 10)
 * - Safe failures for tombstoned / locked targets
 *
 * EVIDENCE LABEL: DETERMINISTIC HOST FIXTURE / TEST HARNESS
 * (Tests run against MockSillyTavernHost modeling ST 1.18.0 commit 8172dcd0ee672d3cd9a5e5f7af134f91a45cd2b8).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

import {
  TRAILER_TAG_OPEN,
  TRAILER_TAG_CLOSE,
  ALPHA_ONE_PASS_WIRE_VERSION,
} from '../src/contract/wire-schemas.js';
import {
  stripMachineTrailer,
} from '../src/runtime/source-resolver.js';
import {
  MockSillyTavernHost,
} from './fixtures/host-harness.js';
import {
  SillyTavernAdapter,
  detectCommittedBranchDivergence,
} from '../src/host/sillytavern-adapter.js';
import {
  SillyTavernStorageAdapter,
} from '../src/host/storage-adapter.js';
import {
  PromptInjector,
} from '../src/host/prompt-injector.js';
import {
  computeContentFingerprint,
} from '../src/host/fingerprint.js';
import {
  DiagnosticsLedger,
  DIAGNOSTIC_EVENT_TYPES,
} from '../src/host/diagnostics.js';

import {
  extractAndParseOnePassTrailer,
} from '../src/contract/parser.js';
import {
  validateOnePassEnvelope,
} from '../src/contract/validator.js';
import {
  ALPHA_NAMESPACE,
  createInitialState,
  createDefaultNpcRecord,
} from '../src/state/schema.js';

test('S3 Host: Capability detection identifies available and missing host surfaces', () => {
  const host = new MockSillyTavernHost();
  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext() });

  const caps = adapter.detectCapabilities();
  assert.equal(caps.supported, true);
  assert.equal(caps.hasContext, true);
  assert.equal(caps.hasEventSource, true);
  assert.equal(caps.hasEventTypes, true);
  assert.equal(caps.hasSetExtensionPrompt, true);
  assert.equal(caps.hasUpdateMessageBlock, true);
  assert.equal(caps.hasCheckedPersistence, true);
  assert.equal(caps.hasChat, true);
  assert.equal(caps.hasChatId, true);

  // Missing context fails closed
  const emptyAdapter = new SillyTavernAdapter({ getContext: () => null });
  const emptyCaps = emptyAdapter.detectCapabilities();
  assert.equal(emptyCaps.supported, false);
  assert.equal(emptyCaps.hasContext, false);
});

test('S3 Host: Adapter initializes listeners and global generate_interceptor, and cleans up on destroy', () => {
  const host = new MockSillyTavernHost();
  const interceptorKey = 'test_npc_state_alpha_interceptor_init';
  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });

  const initSuccess = adapter.initialize();
  assert.equal(initSuccess, true);
  assert.equal(adapter.initialized, true);
  assert.equal(typeof globalThis[interceptorKey], 'function');

  // Destroy cleans up
  adapter.destroy();
  assert.equal(adapter.initialized, false);
  assert.equal(globalThis[interceptorKey], undefined);
});

test('S5 C14: detected competing Beta owner pauses Alpha automatic capture and Development without mutating state', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_competing_owner' });
  const interceptorKey = 'test_competing_owner';
  host.interceptorKey = interceptorKey;
  let detectorCalls = 0;
  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
    ownershipConflictDetector: async () => {
      detectorCalls += 1;
      return { name: 'third-party/npc_state_beta', reason: 'known_competing_automatic_owner' };
    },
  });
  adapter.initialize();

  host.sendUserMessage('Alice waits by the gate.');
  await host.triggerGenerateInterceptor('normal');

  assert.ok(detectorCalls >= 1);
  assert.equal(adapter.inFlightRequest, null, 'Competing automatic owner must prevent Alpha request capture.');
  assert.equal(adapter.getOwnershipConflict()?.name, 'third-party/npc_state_beta');
  assert.equal(adapter.getRuntimeSettings().developmentEnabled, false, 'The same runtime settings path must pause Development.');
  assert.equal(host.extensionPrompts.get('npc_state_alpha')?.prompt ?? '', '');

  const raw = `Alice nods.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[]}\n${TRAILER_TAG_CLOSE}`;
  host.chat.push({ is_user: false, is_system: false, name: 'Assistant', mes: raw, send_date: Date.now(), swipe_id: 0 });
  await host.eventSource.emit(host.eventTypes.MESSAGE_RECEIVED, host.chat.length - 1, 'normal');
  const stored = await adapter.storage.load();
  assert.equal(stored.revision, 0);
  assert.equal(Object.keys(stored.state.npcs).length, 0);

  adapter.destroy();
});

test('S3 Host: Generation interceptor captures user request, lineage, and injects continuity prompt', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_tavern_01' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_gen';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  // 1. User sends a message
  const userText = 'Hello there, barkeep! What do you have on tap?';
  host.sendUserMessage(userText);

  // 2. Generation interceptor is invoked
  await host.triggerGenerateInterceptor('normal');

  // In-flight request was captured
  assert.ok(adapter.inFlightRequest);
  assert.equal(adapter.inFlightRequest.chatId, 'chat_tavern_01');
  assert.equal(adapter.inFlightRequest.userSource.text, userText);
  assert.equal(adapter.inFlightRequest.userSource.role, 'user');
  assert.ok(adapter.inFlightRequest.userSource.contentFingerprint.startsWith('sha256:'));
  assert.equal(adapter.inFlightRequest.precedingLineage.length, 1);

  // Extension prompt was injected via setExtensionPrompt
  const injected = host.extensionPrompts.get('npc_state_alpha');
  assert.ok(injected);
  assert.ok(injected.prompt.includes('NPC State Continuity'));
  assert.ok(injected.prompt.includes('NPC Immediate Output Contract'));
  assert.ok(injected.prompt.includes(TRAILER_TAG_OPEN));

  adapter.destroy();
});

test('S3 Host: Finalized assistant message with valid trailer commits atomically and persists pending development refs', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_scene_01' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_commit';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  host.sendUserMessage('I enter the guildhall looking for Commander Teresa.');
  await host.triggerGenerateInterceptor('normal');

  const assistantText = `Commander Teresa looked up from her war map, eyes narrowing as you approached the command table. "State your business, recruit."

${TRAILER_TAG_OPEN}
{
  "version": "${ALPHA_ONE_PASS_WIRE_VERSION}",
  "proposals": [
    {
      "id": null,
      "localRef": "new:teresa",
      "name": "Commander Teresa",
      "identityKind": "named",
      "evidence": {
        "sourceRef": "current:assistant",
        "excerpt": "Commander Teresa looked up from her war map"
      },
      "present": true,
      "activeInExchange": true,
      "mood": "stern",
      "location": "Command table, Guildhall",
      "currentPresentation": "Polished steel breastplate with lion crest, hair pulled back sharply",
      "relationshipEvaluation": {
        "shifted": true,
        "axes": {
          "trust": 1,
          "affection": 0,
          "desire": 0,
          "tension": 0
        },
        "impact": "minor",
        "axisSupport": {
          "trust": {
            "reason": "Direct eye contact acknowledging your presence",
            "source": {
              "sourceRef": "current:assistant",
              "excerpt": "looked up from her war map, eyes narrowing"
            }
          }
        }
      }
    }
  ]
}
${TRAILER_TAG_CLOSE}`;

  // Assistant message finalized
  const msgIdx = await host.receiveAssistantMessage(assistantText);

  // Storage should be updated to revision 1
  const loaded = await adapter.storage.load();
  assert.equal(loaded.revision, 1);

  const npcs = Object.values(loaded.state.npcs);
  assert.equal(npcs.length, 1);
  const teresa = npcs[0];
  assert.equal(teresa.name, 'Commander Teresa');
  assert.equal(teresa.present, true);
  assert.equal(teresa.activeInExchange, true);
  assert.equal(teresa.mood, 'stern');
  assert.equal(teresa.location, 'Command table, Guildhall');
  assert.equal(teresa.relationship.trust, 1);
  assert.equal(teresa.relationship.tension, 0);

  // Requirement 10: Pending Development reference persisted atomically
  assert.ok(loaded.state.pendingReview?.entries);
  assert.equal(loaded.state.pendingReview.entries.length, 1);
  const pendingEntry = loaded.state.pendingReview.entries[0];
  assert.equal(pendingEntry.targetId, teresa.id);
  assert.equal(pendingEntry.reason, 'new_admission');
  assert.equal(pendingEntry.exchangeId, `chat_scene_01:${msgIdx}`);

  // Diagnostics check
  const summary = adapter.diagnostics.getSummary();
  assert.equal(summary.candidatesReceived, 1);
  assert.equal(summary.candidatesAccepted, 1);
  assert.equal(summary.trailersParsedSuccess, 1);
  assert.equal(summary.commitsSuccess, 1);

  adapter.destroy();
});

test('S3 Host: Next dispatch receives committed continuity from previous fast commit', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_turn2' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_turn2';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  // Turn 1
  host.sendUserMessage('Hello, who are you?');
  await host.triggerGenerateInterceptor();
  await host.receiveAssistantMessage(`"I am Alden," said the old scholar.

${TRAILER_TAG_OPEN}
{
  "version": "${ALPHA_ONE_PASS_WIRE_VERSION}",
  "proposals": [
    {
      "id": null,
      "localRef": "new:alden",
      "name": "Alden",
      "identityKind": "named",
      "evidence": {
        "sourceRef": "current:assistant",
        "excerpt": "said the old scholar"
      },
      "present": true,
      "activeInExchange": true,
      "location": "Grand Archives",
      "mood": "scholarly",
      "relationshipEvaluation": {
        "shifted": false,
        "reason": "Scholarly greeting without relational shift",
        "source": {
          "sourceRef": "current:assistant",
          "excerpt": "said the old scholar"
        }
      }
    }
  ]
}
${TRAILER_TAG_CLOSE}`);

  const loaded1 = await adapter.storage.load();
  const aldenId = Object.keys(loaded1.state.npcs)[0];
  assert.ok(aldenId);

  // Turn 2: User asks follow-up
  host.sendUserMessage('Where are the ancient scrolls kept, Alden?');
  await host.triggerGenerateInterceptor();

  // Injected prompt now reflects Alden's committed continuity!
  const prompt2 = host.extensionPrompts.get('npc_state_alpha').prompt;
  assert.ok(prompt2.includes('[Alden]'));
  assert.ok(prompt2.includes(aldenId));
  assert.ok(prompt2.includes('Grand Archives'));
  assert.ok(prompt2.includes('mood: "scholarly"'));

  adapter.destroy();
});

test('S3 Host: Streaming tokens do NOT mutate state; only finalizeIntermediaryMessage commits', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_streaming' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_stream';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  host.sendUserMessage('Is anyone here?');
  await host.triggerGenerateInterceptor();

  // Assistant starts streaming
  const asstIndex = host.chat.length;
  await host.emitStreamToken(asstIndex, 'A guard stepped out ');
  await host.emitStreamToken(asstIndex, 'from the shadows. ');
  await host.emitStreamToken(asstIndex, `\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[]}`);

  // While streaming, storage revision remains 0! Zero state mutations!
  const midStream = await adapter.storage.load();
  assert.equal(midStream.revision, 0);
  assert.equal(adapter.diagnostics.getSummary().commitsSuccess, 0);

  // Stream finishes final token and trailer close tag
  await host.emitStreamToken(asstIndex, `\n${TRAILER_TAG_CLOSE}`);

  // Finalize streaming calls finalizeIntermediaryMessage which emits MESSAGE_RECEIVED
  await host.finalizeStreamingMessage(asstIndex);

  // Now committed!
  const finalState = await adapter.storage.load();
  assert.equal(finalState.revision, 1);
  assert.equal(adapter.diagnostics.getSummary().commitsSuccess, 1);

  adapter.destroy();
});

test('S3 Host: GENERATION_ENDED does not trigger a commit or state mutation', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_gen_ended' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_gen_ended';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  host.sendUserMessage('Hello!');
  await host.triggerGenerateInterceptor();

  // Host emits GENERATION_ENDED (e.g. from UI hideStopButton)
  await host.simulateGenerationEnded();

  // Storage revision remains untouched
  const state = await adapter.storage.load();
  assert.equal(state.revision, 0);
  assert.equal(adapter.diagnostics.getSummary().commitsSuccess, 0);

  adapter.destroy();
});

test('S3 Host: Duplicate finalized MESSAGE_RECEIVED events are cleanly deduped without double-committing', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_dedup' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_dedup';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  host.sendUserMessage('Greetings!');
  await host.triggerGenerateInterceptor();

  const msg = `"Hello," said Varis.

${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": null,
      "localRef": "new:varis",
      "name": "Varis",
      "identityKind": "named",
      "evidence": { "sourceRef": "current:assistant", "excerpt": "said Varis" },
      "present": true,
      "activeInExchange": true,
      "relationshipEvaluation": {
        "shifted": true,
        "impact": "minor",
        "axes": { "trust": 1, "affection": 0, "desire": 0, "tension": 0 },
        "axisSupport": {
          "trust": {
            "reason": "Friendly greeting",
            "source": { "sourceRef": "current:assistant", "excerpt": "said Varis" }
          }
        }
      }
    }
  ]
}
${TRAILER_TAG_CLOSE}`;

  const msgIdx = await host.receiveAssistantMessage(msg);
  const state1 = await adapter.storage.load();
  assert.equal(state1.revision, 1);

  // Host accidentally re-emits MESSAGE_RECEIVED for the exact same message
  await host.eventSource.emit(host.eventTypes.MESSAGE_RECEIVED, msgIdx, 'normal');

  // Revision remains 1, no duplicate relationship increment or state corruption
  const state2 = await adapter.storage.load();
  assert.equal(state2.revision, 1);
  const varis = Object.values(state2.state.npcs)[0];
  assert.equal(varis.relationship.trust, 1); // Not 2!

  assert.equal(adapter.diagnostics.getSummary().replaysSuppressed, 1);

  adapter.destroy();
});

test('S3 Host: Chat isolation ensures chats do not share state or leak across chat switch', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_A' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_switch';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  // Chat A: Admit Alice
  host.sendUserMessage('Hello in Chat A');
  await host.triggerGenerateInterceptor();
  await host.receiveAssistantMessage(`Alice waved.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": null,
      "localRef": "new:alice",
      "name": "Alice",
      "identityKind": "named",
      "evidence": { "sourceRef": "current:assistant", "excerpt": "Alice waved" },
      "present": true,
      "activeInExchange": false
    }
  ]
}
${TRAILER_TAG_CLOSE}`);

  const stateA = await adapter.storage.load();
  assert.equal(stateA.revision, 1);
  assert.equal(Object.values(stateA.state.npcs).some((n) => n.name === 'Alice'), true);

  // Switch to Chat B
  await host.switchChat('chat_B');

  // Chat B has fresh state with revision 0
  const stateB = await adapter.storage.load();
  assert.equal(stateB.revision, 0);
  assert.equal(Object.values(stateB.state.npcs).length, 0);

  // Switch back to Chat A
  await host.switchChat('chat_A');
  const stateAReloaded = await adapter.storage.load();
  assert.equal(stateAReloaded.revision, 1);
  assert.equal(Object.values(stateAReloaded.state.npcs).some((n) => n.name === 'Alice'), true);

  adapter.destroy();
});

test('S6 Host: committed swipe replacement reconstructs canonical state and future turns remain writable', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_swipe' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_swipe';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  host.sendUserMessage('Who is in the tavern?');
  await host.triggerGenerateInterceptor();

  // Assistant generates first response with Bob having relationship trust: 2
  const msgIdx = await host.receiveAssistantMessage(`"I am Bob," said Bob.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": null,
      "localRef": "new:bob",
      "name": "Bob",
      "identityKind": "named",
      "evidence": { "sourceRef": "current:assistant", "excerpt": "said Bob" },
      "present": true,
      "activeInExchange": false,
      "relationshipEvaluation": {
        "shifted": true,
        "axes": {
          "trust": 2,
          "affection": 0,
          "desire": 0,
          "tension": 0
        },
        "impact": "moderate",
        "axisSupport": {
          "trust": {
            "reason": "Direct spoken greeting acknowledging presence",
            "source": {
              "sourceRef": "current:assistant",
              "excerpt": "said Bob"
            }
          }
        }
      }
    }
  ]
}
${TRAILER_TAG_CLOSE}`, { swipeId: 0 });

  const state1 = await adapter.storage.load();
  assert.equal(state1.revision, 1);
  const bob1 = Object.values(state1.state.npcs).find((n) => n.name === 'Bob');
  assert.ok(bob1);
  assert.equal(bob1.relationship.trust, 2);

  // User swipes to generate alternative
  await host.swipeMessage(msgIdx, 1, 'Temporary swipe text...');
  assert.equal(adapter.inFlightRequest, null); // In-flight branch cleared

  // Swipe generation intercepts
  await host.triggerGenerateInterceptor('swipe');
  assert.equal(adapter.inFlightRequest.generationType, 'swipe');

  // Swipe completes with alternative character Charlie
  const swipe2Text = `"I am Charlie," said Charlie.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": null,
      "localRef": "new:charlie",
      "name": "Charlie",
      "identityKind": "named",
      "evidence": { "sourceRef": "current:assistant", "excerpt": "said Charlie" },
      "present": true,
      "activeInExchange": false
    }
  ]
}
${TRAILER_TAG_CLOSE}`;

  host.chat[msgIdx].mes = swipe2Text;
  host.chat[msgIdx].swipe_id = 1;
  await host.eventSource.emit(host.eventTypes.MESSAGE_RECEIVED, msgIdx, 'swipe');

  // S6 reconstructs at the selected swipe. Bob's old relationship evidence
  // disappears and Charlie becomes the only canonical admission.
  const state2 = await adapter.storage.load();
  assert.ok(state2.revision > 1);
  const npcs = Object.values(state2.state.npcs);
  assert.equal(npcs.length, 1);
  assert.equal(npcs[0].name, 'Charlie');
  assert.ok(!npcs.some((n) => n.name === 'Bob'));
  assert.ok(adapter.diagnostics.entries.some((entry) => entry.type === DIAGNOSTIC_EVENT_TYPES.HISTORY_RECOVERY_COMMITTED));

  // Future normal turn after a branch divergence:
  // User sends next message in chat (turn 2)
  host.sendUserMessage('What drinks do you have?');
  await host.triggerGenerateInterceptor('normal');

  // The recovered branch is now the canonical request lineage.
  assert.ok(adapter.inFlightRequest);
  assert.equal(Boolean(adapter.inFlightRequest.branchUnsafe), false);

  // Assistant generates turn 2 message with valid trailer
  const turn2Text = `"We have ale and mead," replied the tavernkeeper.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": null,
      "localRef": "new:keeper",
      "name": "Tavernkeeper",
      "identityKind": "named",
      "evidence": { "sourceRef": "current:assistant", "excerpt": "replied the tavernkeeper" },
      "present": true,
      "activeInExchange": false
    }
  ]
}
${TRAILER_TAG_CLOSE}`;

  await host.receiveAssistantMessage(turn2Text);

  const state3 = await adapter.storage.load();
  assert.ok(state3.revision > state2.revision);
  assert.ok(Object.values(state3.state.npcs).some((n) => n.name === 'Tavernkeeper'));
  assert.ok(!Object.values(state3.state.npcs).some((n) => n.name === 'Bob'));

  adapter.destroy();
});

test('S3 Host: Malformed / truncated / missing trailer fails extraction cleanly without modifying story or state', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_malformed' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_err';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  host.sendUserMessage('Tell me a story.');
  await host.triggerGenerateInterceptor();

  // 1. Missing trailer entirely
  const rawStory = 'Once upon a time in a faraway kingdom, there lived a dragon.';
  await host.receiveAssistantMessage(rawStory);

  let state = await adapter.storage.load();
  assert.equal(state.revision, 0); // No state mutation!
  // Story narrative is unchanged
  assert.equal(host.chat[host.chat.length - 1].mes, rawStory);

  // 2. Truncated trailer (open tag without close tag)
  host.sendUserMessage('Tell me more.');
  await host.triggerGenerateInterceptor();
  const truncatedStory = `The dragon flew away.\n\n${TRAILER_TAG_OPEN}\n{"version": "1", "proposals": [`;
  await host.receiveAssistantMessage(truncatedStory);

  state = await adapter.storage.load();
  assert.equal(state.revision, 0);
  assert.equal(host.chat[host.chat.length - 1].mes, truncatedStory);

  // 3. Malformed JSON
  host.sendUserMessage('Continue.');
  await host.triggerGenerateInterceptor();
  const malformedJsonStory = `The knight arrived.\n\n${TRAILER_TAG_OPEN}\n{NOT_VALID_JSON}\n${TRAILER_TAG_CLOSE}`;
  await host.receiveAssistantMessage(malformedJsonStory);

  state = await adapter.storage.load();
  assert.equal(state.revision, 0);
  assert.equal(host.chat[host.chat.length - 1].mes, malformedJsonStory);

  // 4. Duplicate trailers
  host.sendUserMessage('Continue.');
  await host.triggerGenerateInterceptor();
  const duplicateStory = `Scene.\n\n${TRAILER_TAG_OPEN}{}${TRAILER_TAG_CLOSE}\n${TRAILER_TAG_OPEN}{}${TRAILER_TAG_CLOSE}`;
  await host.receiveAssistantMessage(duplicateStory);

  state = await adapter.storage.load();
  assert.equal(state.revision, 0);

  // Diagnostics check
  assert.equal(adapter.diagnostics.getSummary().trailersParsedFailed, 4);
  assert.equal(adapter.diagnostics.getSummary().commitsSuccess, 0);

  adapter.destroy();
});

test('S3 Host: Terminal death transition excludes deceased NPC from future living continuity projection', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_death' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_death';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  // Turn 1: Admit Captain Raymond
  host.sendUserMessage('Who leads the guard?');
  await host.triggerGenerateInterceptor();
  await host.receiveAssistantMessage(`Captain Raymond stood vigil atop the ramparts.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": null,
      "localRef": "new:raymond",
      "name": "Captain Raymond",
      "identityKind": "named",
      "evidence": { "sourceRef": "current:assistant", "excerpt": "Captain Raymond stood vigil" },
      "present": true,
      "activeInExchange": false,
      "location": "Ramparts"
    }
  ]
}
${TRAILER_TAG_CLOSE}`);

  const state1 = await adapter.storage.load();
  const raymondId = Object.keys(state1.state.npcs)[0];
  assert.equal(state1.state.npcs[raymondId].lifeState, 'alive');

  // Turn 2: Raymond falls in battle
  host.sendUserMessage('The enemy breaches the gate!');
  await host.triggerGenerateInterceptor();
  await host.receiveAssistantMessage(`Captain Raymond took a fatal blow to the chest and collapsed lifelessly upon the stones.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": "${raymondId}",
      "present": false,
      "activeInExchange": false,
      "lifecycle": {
        "lifeState": "dead",
        "cause": "Killed defending the ramparts from the breach",
        "source": {
          "sourceRef": "current:assistant",
          "excerpt": "took a fatal blow to the chest and collapsed lifelessly"
        }
      }
    }
  ]
}
${TRAILER_TAG_CLOSE}`);

  const state2 = await adapter.storage.load();
  assert.equal(state2.state.npcs[raymondId].lifeState, 'dead');
  assert.equal(state2.state.npcs[raymondId].present, false);

  // Turn 3: Next dispatch prompt injection excludes Raymond from living presence
  host.sendUserMessage('What is the situation now?');
  await host.triggerGenerateInterceptor();
  const prompt3 = host.extensionPrompts.get('npc_state_alpha').prompt;

  assert.ok(prompt3.includes('[No active living NPCs]'));
  assert.ok(prompt3.includes('Deceased: Captain Raymond'));

  adapter.destroy();
});

test('S3 Host: Rejects Development-owned durable fields on One-Pass immediate wire', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_wrong_writer' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_ww';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  host.sendUserMessage('Tell me about the stranger.');
  await host.triggerGenerateInterceptor();

  // Model attempts to write durable personality/background on one-pass wire
  const invalidDevWire = `A stranger arrived.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": null,
      "localRef": "new:stranger",
      "name": "Stranger",
      "identityKind": "named",
      "evidence": { "sourceRef": "current:assistant", "excerpt": "A stranger arrived" },
      "personality": "Quiet and brooding",
      "background": "Former soldier"
    }
  ]
}
${TRAILER_TAG_CLOSE}`;

  await host.receiveAssistantMessage(invalidDevWire);

  // S1 Validator rejects wrong writer authority; state is not mutated!
  const state = await adapter.storage.load();
  assert.equal(state.revision, 0);
  assert.equal(adapter.diagnostics.getSummary().commitsSuccess, 0);
  assert.equal(adapter.diagnostics.getSummary().trailersParsedFailed, 1);

  adapter.destroy();
});

test('S3 Host: Excerpt verification correctly matches clean narrative with trailer stripped', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_excerpt' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_excerpt';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  host.sendUserMessage('I enter the apothecary.');
  await host.triggerGenerateInterceptor();

  // Trailer contains excerpt from the story narrative
  const validExcerptText = `The herbalist Miriel stirred a steaming cauldron of lavender broth.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": null,
      "localRef": "new:miriel",
      "name": "Miriel",
      "identityKind": "named",
      "evidence": { "sourceRef": "current:assistant", "excerpt": "herbalist Miriel stirred a steaming cauldron" },
      "present": true,
      "activeInExchange": false
    }
  ]
}
${TRAILER_TAG_CLOSE}`;

  await host.receiveAssistantMessage(validExcerptText);
  const state = await adapter.storage.load();
  assert.equal(state.revision, 1);
  assert.ok(Object.values(state.state.npcs).some((n) => n.name === 'Miriel'));

  adapter.destroy();
});

test('S3 Host: Excerpt citing the machine trailer is rejected (trailer self-citation violation C03)', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_self_cite' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_self_cite';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  host.sendUserMessage('Who is here?');
  await host.triggerGenerateInterceptor();

  const selfCiteText = `Someone is here.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": null,
      "localRef": "new:ghost",
      "name": "Ghost",
      "identityKind": "named",
      "evidence": { "sourceRef": "current:assistant", "excerpt": "<npc_state_alpha_v1>" },
      "present": true
    }
  ]
}
${TRAILER_TAG_CLOSE}`;

  await host.receiveAssistantMessage(selfCiteText);
  const state = await adapter.storage.load();
  assert.equal(state.revision, 0); // Self citation rejected!

  adapter.destroy();
});

test('S3 Host: stripTrailersFromHistory projects clean messages without mutating raw chat objects', () => {
  const rawChat = [
    { is_user: true, mes: 'Hello' },
    {
      is_user: false,
      mes: `Greetings traveller.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[]}\n${TRAILER_TAG_CLOSE}`,
    },
    { is_user: true, mes: 'Tell me more' },
  ];

  const projected = PromptInjector.stripTrailersFromHistory(rawChat);

  // Projected message has trailer stripped
  assert.equal(projected[1].mes, 'Greetings traveller.');

  // Raw chat array and object remain completely unmutated!
  assert.ok(rawChat[1].mes.includes(TRAILER_TAG_OPEN));
  assert.ok(rawChat[1].mes.includes(TRAILER_TAG_CLOSE));
});

test('S3 Host: Content fingerprinting produces standard SHA-256 digests synchronously', () => {
  const fp1 = computeContentFingerprint('Hello world');
  const fp2 = computeContentFingerprint('Hello world');
  const fp3 = computeContentFingerprint('Different content');

  assert.ok(fp1.startsWith('sha256:'));
  assert.equal(fp1, fp2);
  assert.notEqual(fp1, fp3);

  // Standard SHA-256 for 'Hello world'
  // echo -n "Hello world" | sha256sum -> 64ec88ca00b268e5ba1a35678a1b5316d212f4f366b2477232534a8aeca37f3c
  assert.equal(fp1, 'sha256:64ec88ca00b268e5ba1a35678a1b5316d212f4f366b2477232534a8aeca37f3c');
});

test('S3 Host: Extension and state reload preserves committed state across adapter re-instantiation', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_reload' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_reload';
  host.interceptorKey = interceptorKey;

  // First adapter instance
  const adapter1 = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter1.initialize();

  host.sendUserMessage('I meet Thorne the blacksmith.');
  await host.triggerGenerateInterceptor();
  await host.receiveAssistantMessage(`Thorne wiped his brow with a leather glove.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": null,
      "localRef": "new:thorne",
      "name": "Thorne",
      "identityKind": "named",
      "evidence": { "sourceRef": "current:assistant", "excerpt": "Thorne wiped his brow" },
      "present": true,
      "activeInExchange": false,
      "location": "Forge"
    }
  ]
}
${TRAILER_TAG_CLOSE}`);

  const state1 = await adapter1.storage.load();
  assert.equal(state1.revision, 1);
  const thorneId = Object.keys(state1.state.npcs)[0];
  assert.equal(state1.state.npcs[thorneId].name, 'Thorne');

  // Destroy adapter 1 (simulating extension unload or page refresh)
  adapter1.destroy();

  // Second adapter instance connecting to same host / metadata
  const adapter2 = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter2.initialize();

  const state2 = await adapter2.storage.load();
  assert.equal(state2.revision, 1);
  assert.equal(state2.state.npcs[thorneId].name, 'Thorne');
  assert.equal(state2.state.npcs[thorneId].location, 'Forge');

  adapter2.destroy();
});

test('S3 Host: Known currentForm accepted; unknown form left unresolved while presentation captured', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_forms' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_forms';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  // Turn 1: Admit shape-shifter Lyra
  host.sendUserMessage('Who approaches?');
  await host.triggerGenerateInterceptor();
  await host.receiveAssistantMessage(`Lyra stepped forward from the forest edge.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": null,
      "localRef": "new:lyra",
      "name": "Lyra",
      "identityKind": "named",
      "evidence": { "sourceRef": "current:assistant", "excerpt": "Lyra stepped forward" },
      "present": true,
      "activeInExchange": false,
      "currentPresentation": "Slender woman in leaf-green cloak"
    }
  ]
}
${TRAILER_TAG_CLOSE}`);

  let state = await adapter.storage.load();
  const lyraId = Object.keys(state.state.npcs)[0];
  assert.ok(lyraId);
  assert.equal(state.state.npcs[lyraId].currentForm, null);
  assert.equal(state.state.npcs[lyraId].currentPresentation, 'Slender woman in leaf-green cloak');

  // Simulate established appearanceForms in state (durable canon)
  state.state.npcs[lyraId].appearanceForms = [
    { formId: 'form_human', name: 'Human Form', description: 'Slender woman' },
    { formId: 'form_wolf', name: 'Wolf Form', description: 'Large silver wolf' },
  ];
  await adapter.storage.save(state.state, state.revision);

  // Turn 2: Propose known currentForm 'form_wolf'
  host.sendUserMessage('Lyra shifts her shape!');
  await host.triggerGenerateInterceptor();
  await host.receiveAssistantMessage(`Lyra shifted into a magnificent silver wolf.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": "${lyraId}",
      "present": true,
      "activeInExchange": false,
      "currentForm": "form_wolf",
      "currentPresentation": "Silver wolf with piercing amber eyes",
      "source": {
        "sourceRef": "current:assistant",
        "excerpt": "Lyra shifted into a magnificent silver wolf"
      }
    }
  ]
}
${TRAILER_TAG_CLOSE}`);

  state = await adapter.storage.load();
  assert.equal(state.state.npcs[lyraId].currentForm, 'form_wolf');
  assert.equal(state.state.npcs[lyraId].currentPresentation, 'Silver wolf with piercing amber eyes');

  // Turn 3: Unknown form 'form_bear' observed before durable definition exists
  host.sendUserMessage('Now she takes another form!');
  await host.triggerGenerateInterceptor();
  await host.receiveAssistantMessage(`Lyra shifted into a towering shadow beast.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": "${lyraId}",
      "present": true,
      "activeInExchange": false,
      "currentForm": null,
      "currentPresentation": "Towering shadow beast with smoky fur",
      "source": {
        "sourceRef": "current:assistant",
        "excerpt": "Lyra shifted into a towering shadow beast"
      }
    }
  ]
}
${TRAILER_TAG_CLOSE}`);

  state = await adapter.storage.load();
  // Form remains null / unresolved while observed presentation is captured!
  assert.equal(state.state.npcs[lyraId].currentForm, null);
  assert.equal(state.state.npcs[lyraId].currentPresentation, 'Towering shadow beast with smoky fur');

  adapter.destroy();
});

test('S3 Host: Automatic dead->alive resurrection is strictly rejected', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_resurrect' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_resurrect';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  // Turn 1: Admit Gareth
  host.sendUserMessage('Who goes there?');
  await host.triggerGenerateInterceptor();
  await host.receiveAssistantMessage(`Gareth stood watch.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": null,
      "localRef": "new:gareth",
      "name": "Gareth",
      "identityKind": "named",
      "evidence": { "sourceRef": "current:assistant", "excerpt": "Gareth stood watch" },
      "present": true,
      "activeInExchange": false
    }
  ]
}
${TRAILER_TAG_CLOSE}`);

  let state = await adapter.storage.load();
  const garethId = Object.keys(state.state.npcs)[0];

  // Turn 2: Gareth dies
  host.sendUserMessage('An arrow strikes!');
  await host.triggerGenerateInterceptor();
  await host.receiveAssistantMessage(`Gareth was struck through the heart and died instantly.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": "${garethId}",
      "present": false,
      "activeInExchange": false,
      "lifecycle": {
        "lifeState": "dead",
        "cause": "Pierced through the heart by arrow",
        "source": { "sourceRef": "current:assistant", "excerpt": "struck through the heart and died instantly" }
      }
    }
  ]
}
${TRAILER_TAG_CLOSE}`);

  state = await adapter.storage.load();
  assert.equal(state.state.npcs[garethId].lifeState, 'dead');

  // Turn 3: Attempted narrative resurrection (dead -> alive)
  host.sendUserMessage('A cleric casts a spell!');
  await host.triggerGenerateInterceptor();
  await host.receiveAssistantMessage(`Gareth opened his eyes, breathing again.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": "${garethId}",
      "present": true,
      "activeInExchange": false,
      "lifecycle": {
        "lifeState": "alive",
        "source": { "sourceRef": "current:assistant", "excerpt": "opened his eyes, breathing again" }
      }
    }
  ]
}
${TRAILER_TAG_CLOSE}`);

  // Resurrection rejected by S1 validator / C06 rules!
  const stateAfter = await adapter.storage.load();
  assert.equal(stateAfter.state.npcs[garethId].lifeState, 'dead'); // Still dead!

  adapter.destroy();
});

test('S3 Host: Safe failures for locked fields and tombstoned targets', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_safety' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_safety';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  // Admit Sarah
  host.sendUserMessage('I see Sarah.');
  await host.triggerGenerateInterceptor();
  await host.receiveAssistantMessage(`Sarah sat quietly.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": null,
      "localRef": "new:sarah",
      "name": "Sarah",
      "identityKind": "named",
      "evidence": { "sourceRef": "current:assistant", "excerpt": "Sarah sat quietly" },
      "present": true,
      "activeInExchange": false,
      "mood": "calm",
      "location": "Garden"
    }
  ]
}
${TRAILER_TAG_CLOSE}`);

  let state = await adapter.storage.load();
  const sarahId = Object.keys(state.state.npcs)[0];

  // Lock Sarah's location
  state.state.npcs[sarahId].locks.location = true;
  await adapter.storage.save(state.state, state.revision);

  // Model attempts to overwrite locked location
  host.sendUserMessage('Sarah runs to the castle.');
  await host.triggerGenerateInterceptor();
  await host.receiveAssistantMessage(`Sarah ran quickly to the castle courtyard.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": "${sarahId}",
      "present": true,
      "activeInExchange": false,
      "location": "Castle courtyard",
      "mood": "hurried",
      "source": {
        "sourceRef": "current:assistant",
        "excerpt": "Sarah ran quickly to the castle courtyard"
      }
    }
  ]
}
${TRAILER_TAG_CLOSE}`);

  state = await adapter.storage.load();
  // Location was locked so it remains "Garden", while unlocked mood updated to "hurried"!
  assert.equal(state.state.npcs[sarahId].location, 'Garden');
  assert.equal(state.state.npcs[sarahId].mood, 'hurried');

  // Now tombstone Sarah (manual deletion tombstone)
  state.state.tombstones[sarahId] = {
    deletedAt: new Date().toISOString(),
    reason: 'manual_deletion',
  };
  delete state.state.npcs[sarahId];
  await adapter.storage.save(state.state, state.revision);

  // Model attempts proposal on tombstoned NPC -> rejected
  host.sendUserMessage('Is Sarah here?');
  await host.triggerGenerateInterceptor();
  await host.receiveAssistantMessage(`Sarah was seen again.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": "${sarahId}",
      "present": true,
      "activeInExchange": false,
      "mood": "calm",
      "source": {
        "sourceRef": "current:assistant",
        "excerpt": "Sarah was seen again"
      }
    }
  ]
}
${TRAILER_TAG_CLOSE}`);

  const postTombstone = await adapter.storage.load();
  assert.equal(postTombstone.state.npcs[sarahId], undefined); // Not re-admitted!

  adapter.destroy();
});

test('S3 Host: CAS persistence failure produces no false success receipt or checkpoint', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_cas' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_cas';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  host.sendUserMessage('Hello!');
  await host.triggerGenerateInterceptor();

  // Simulate CAS storage save failure
  adapter.storage.setFailNextSave(true);

  await host.receiveAssistantMessage(`A herald arrived.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": null,
      "localRef": "new:herald",
      "name": "Herald",
      "identityKind": "named",
      "evidence": { "sourceRef": "current:assistant", "excerpt": "A herald arrived" },
      "present": true,
      "activeInExchange": false
    }
  ]
}
${TRAILER_TAG_CLOSE}`);

  // Persistence failure recorded in diagnostics
  const summary = adapter.diagnostics.getSummary();
  assert.equal(summary.commitsFailed, 1);
  assert.equal(summary.commitsSuccess, 0);

  // State revision was NOT bumped
  const state = await adapter.storage.load();
  assert.equal(state.revision, 0);
  assert.equal(Object.keys(state.state.npcs).length, 0);

  adapter.destroy();
});

test('S3 Host: Wrong chat ID, wrong role, and excerpt mismatch fail closed safely', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_guard_tests' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_guards';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  // 1. Candidate is user message, not assistant -> rejected
  host.sendUserMessage(`User message containing fake trailer ${TRAILER_TAG_OPEN}{"version":"1","proposals":[]}${TRAILER_TAG_CLOSE}`);
  const userMsgIdx = host.chat.length - 1;
  await host.eventSource.emit(host.eventTypes.MESSAGE_RECEIVED, userMsgIdx, 'normal');

  assert.equal(adapter.diagnostics.getSummary().candidatesRejected, 1);
  let state = await adapter.storage.load();
  assert.equal(state.revision, 0);

  // 2. In-flight request belongs to different chat -> rejected
  host.sendUserMessage('Hi in chat_guard_tests');
  await host.triggerGenerateInterceptor();
  // Tamper in-flight request to simulate different chat
  adapter.inFlightRequest.chatId = 'other_chat_999';

  await host.receiveAssistantMessage(`Narrative. ${TRAILER_TAG_OPEN}{"version":"1","proposals":[]}${TRAILER_TAG_CLOSE}`);
  assert.equal(adapter.diagnostics.getSummary().candidatesRejected, 2);

  state = await adapter.storage.load();
  assert.equal(state.revision, 0);

  adapter.destroy();
});

test('S3 Host: first_message event type is rejected as candidate without generation', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_first_message' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_first_msg';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  // Fresh chat first message path in SillyTavern 1.18.0
  await host.emitFirstMessage();

  assert.equal(adapter.diagnostics.getSummary().candidatesRejected, 1);
  const state = await adapter.storage.load();
  assert.equal(state.revision, 0);

  adapter.destroy();
});

test('S3 Host: Branch invalidation on MESSAGE_EDITED, MESSAGE_DELETED, and MESSAGE_SWIPE_DELETED clears in-flight state', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_branch_invalidation' });
  const interceptorKey = 'test_npc_state_alpha_interceptor_branch_inv';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  // 1. User message edited invalidates in-flight request
  host.sendUserMessage('Initial user prompt');
  await host.triggerGenerateInterceptor();
  assert.notEqual(adapter.inFlightRequest, null);
  await host.editMessage(0, 'Edited user prompt');
  assert.equal(adapter.inFlightRequest, null);

  // 2. Message deleted invalidates in-flight request
  await host.triggerGenerateInterceptor();
  assert.notEqual(adapter.inFlightRequest, null);
  await host.deleteMessage(0);
  assert.equal(adapter.inFlightRequest, null);

  // 3. Swipe deleted invalidates in-flight request
  host.sendUserMessage('New message');
  await host.triggerGenerateInterceptor();
  assert.notEqual(adapter.inFlightRequest, null);
  await host.deleteSwipe(0);
  assert.equal(adapter.inFlightRequest, null);

  adapter.destroy();
});

test('S3 Regression: no-request + invalid messageId fails closed without mutating state', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_no_req' });
  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey: 'test_no_req' });
  adapter.initialize();

  // Host emits MESSAGE_RECEIVED with non-number or out-of-bounds messageId when no request is in-flight
  await host.eventSource.emit(host.eventTypes.MESSAGE_RECEIVED, -1, 'normal');
  await host.eventSource.emit(host.eventTypes.MESSAGE_RECEIVED, 'invalid_id', 'normal');
  await host.eventSource.emit(host.eventTypes.MESSAGE_RECEIVED, 999, 'normal');

  const summary = adapter.diagnostics.getSummary();
  assert.equal(summary.commitsSuccess, 0);
  assert.equal(summary.candidatesAccepted, 0);
  assert.ok(summary.candidatesRejected >= 2);

  const loaded = await adapter.storage.load();
  assert.equal(loaded.revision, 0);
  assert.deepEqual(Object.keys(loaded.state.npcs), []);
  adapter.destroy();
});

test('S3 Regression: exact lineage mismatch rejects candidate when history diverges', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_lineage_mismatch' });
  const interceptorKey = 'test_lineage_mismatch';
  host.interceptorKey = interceptorKey;
  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey });
  adapter.initialize();

  host.sendUserMessage('Hello!');
  await host.triggerGenerateInterceptor();

  // Interfere with history before assistant message arrives (e.g. user edits user message)
  host.chat[0].mes = 'Modified user prompt after generation started';

  const asstText = `Reply text.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": null,
      "localRef": "new:guard",
      "name": "Guard",
      "identityKind": "named",
      "evidence": { "sourceRef": "current:assistant", "excerpt": "Reply text." },
      "present": true,
      "activeInExchange": false
    }
  ]
}
${TRAILER_TAG_CLOSE}`;

  await host.receiveAssistantMessage(asstText);

  const summary = adapter.diagnostics.getSummary();
  assert.equal(summary.commitsSuccess, 0);
  assert.equal(summary.candidatesAccepted, 0);
  assert.ok(summary.candidatesRejected >= 1);
  const rejEntry = adapter.diagnostics.entries.find((e) => e.type === DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED && e.reason?.includes('Preceding lineage mismatch'));
  assert.ok(rejEntry);

  const loaded = await adapter.storage.load();
  assert.equal(loaded.revision, 0);
  adapter.destroy();
});

test('S3 Regression: current:user evidence cited in trailer resolves and commits atomically', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_user_ev' });
  const interceptorKey = 'test_user_ev';
  host.interceptorKey = interceptorKey;
  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey });
  adapter.initialize();

  const userText = 'I am looking for Captain Miller near the harbor.';
  host.sendUserMessage(userText);
  await host.triggerGenerateInterceptor();

  const asstText = `"Captain Miller is right there," the sailor points.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": null,
      "localRef": "new:miller",
      "name": "Captain Miller",
      "identityKind": "named",
      "evidence": { "sourceRef": "current:user", "excerpt": "Captain Miller near the harbor." },
      "present": true,
      "activeInExchange": false,
      "location": "Harbor"
    }
  ]
}
${TRAILER_TAG_CLOSE}`;

  await host.receiveAssistantMessage(asstText);

  const summary = adapter.diagnostics.getSummary();
  assert.equal(summary.commitsSuccess, 1);
  assert.equal(summary.candidatesAccepted, 1);

  const loaded = await adapter.storage.load();
  assert.equal(loaded.revision, 1);
  const npcs = Object.values(loaded.state.npcs);
  assert.equal(npcs.length, 1);
  assert.equal(npcs[0].name, 'Captain Miller');
  assert.equal(npcs[0].location, 'Harbor');
  adapter.destroy();
});

test('S3 Regression: wrong role candidate rejected even with captured generation request', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_wrong_role' });
  const interceptorKey = 'test_wrong_role';
  host.interceptorKey = interceptorKey;
  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey });
  adapter.initialize();

  host.sendUserMessage('Hello there');
  await host.triggerGenerateInterceptor();

  // Host sends a second message marked as is_user: true
  const injectedMsgIdx = host.sendUserMessage('Injected user message instead of assistant');
  await host.eventSource.emit(host.eventTypes.MESSAGE_RECEIVED, injectedMsgIdx, 'normal');

  const summary = adapter.diagnostics.getSummary();
  assert.equal(summary.commitsSuccess, 0);
  assert.equal(summary.candidatesAccepted, 0);
  const rejEntry = adapter.diagnostics.entries.find((e) => e.type === DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED && e.reason?.includes('not assistant'));
  assert.ok(rejEntry);
  adapter.destroy();
});

test('S3 Regression: fingerprint mismatch on reused-position rejected cleanly', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_reused_pos' });
  const interceptorKey = 'test_reused_pos';
  host.interceptorKey = interceptorKey;
  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey });
  adapter.initialize();

  host.sendUserMessage('Initial prompt');
  await host.triggerGenerateInterceptor();

  // Tamper with inFlightRequest user fingerprint so position matches but fingerprint mismatches
  adapter.inFlightRequest.userSource.contentFingerprint = 'tampered_fingerprint_hash';
  adapter.inFlightRequest.precedingLineage = ['tampered_fingerprint_hash'];

  const asstText = `Assistant reply.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": []
}
${TRAILER_TAG_CLOSE}`;

  await host.receiveAssistantMessage(asstText);

  const summary = adapter.diagnostics.getSummary();
  assert.equal(summary.commitsSuccess, 0);
  assert.equal(summary.candidatesAccepted, 0);
  const rej = adapter.diagnostics.entries.find((e) => e.type === DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED);
  assert.ok(rej);
  adapter.destroy();
});

test('S3 Regression: swipe and chat ID mismatch rejected cleanly', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_alpha' });
  const interceptorKey = 'test_chat_mismatch';
  host.interceptorKey = interceptorKey;
  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey });
  adapter.initialize();

  host.sendUserMessage('Hello chat alpha');
  await host.triggerGenerateInterceptor();

  // Simulate chat switch on host without adapter reset
  host.chatId = 'chat_beta';

  const asstText = `Message in beta.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": []
}
${TRAILER_TAG_CLOSE}`;

  await host.receiveAssistantMessage(asstText);

  const summary = adapter.diagnostics.getSummary();
  assert.equal(summary.commitsSuccess, 0);
  const rej = adapter.diagnostics.entries.find((e) => e.type === DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED && e.reason?.includes('Chat ID mismatch'));
  assert.ok(rej);
  adapter.destroy();
});

test('S3 Regression: invalid schema and trailer-not-at-end fail extraction and preserve narrative', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_trailer_not_end' });
  const interceptorKey = 'test_trailer_not_end';
  host.interceptorKey = interceptorKey;
  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey });
  adapter.initialize();

  host.sendUserMessage('Tell me a tale');
  await host.triggerGenerateInterceptor();

  // Trailer followed by additional narrative prose (not at end)
  const notEndText = `Narrative beginning.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": []
}
${TRAILER_TAG_CLOSE}
And then they continued talking after the trailer tag!`;

  await host.receiveAssistantMessage(notEndText);

  const summary = adapter.diagnostics.getSummary();
  assert.equal(summary.commitsSuccess, 0);
  assert.equal(summary.trailersParsedSuccess, 0);
  assert.equal(summary.trailersParsedFailed, 1);
  const failEntry = adapter.diagnostics.entries.find((e) => e.type === DIAGNOSTIC_EVENT_TYPES.TRAILER_PARSE_FAILURE);
  assert.ok(failEntry);
  assert.equal(failEntry.errorCode, 'trailer_not_at_end');

  // Narrative in host is completely preserved without corruption
  assert.equal(host.chat[1].mes, notEndText);
  adapter.destroy();
});

test('S3 Regression: durable replay across NEW adapter instance suppresses duplicate replay', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_durable_replay' });
  const interceptorKey = 'test_durable_replay';
  host.interceptorKey = interceptorKey;

  // First adapter commits message
  const adapter1 = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey });
  adapter1.initialize();

  host.sendUserMessage('Hello');
  await host.triggerGenerateInterceptor();

  const asstText = `Greeting.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": null,
      "localRef": "new:sam",
      "name": "Sam",
      "identityKind": "named",
      "evidence": { "sourceRef": "current:assistant", "excerpt": "Greeting." },
      "present": true,
      "activeInExchange": false
    }
  ]
}
${TRAILER_TAG_CLOSE}`;

  const msgIdx = await host.receiveAssistantMessage(asstText);
  assert.equal(adapter1.diagnostics.getSummary().commitsSuccess, 1);
  adapter1.destroy();

  // Second adapter simulates page reload / new extension instance
  const adapter2 = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey });
  adapter2.initialize();

  // Host re-emits MESSAGE_RECEIVED for already-committed message
  await host.eventSource.emit(host.eventTypes.MESSAGE_RECEIVED, msgIdx, 'normal');

  const summary2 = adapter2.diagnostics.getSummary();
  assert.equal(summary2.commitsSuccess, 0);
  assert.equal(summary2.replaysSuppressed, 1);
  const repEntry = adapter2.diagnostics.entries.find((e) => e.type === DIAGNOSTIC_EVENT_TYPES.REPLAY_SUPPRESSED);
  assert.ok(repEntry);
  assert.equal(repEntry.reason, 'durable_dedup_exact_replay');

  adapter2.destroy();
});

test('S3 Regression: host persistence throw triggers rollback without corrupting cache', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_throw_save' });
  const interceptorKey = 'test_throw_save';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey });
  adapter.initialize();

  host.sendUserMessage('Hello throw');
  await host.triggerGenerateInterceptor();

  // Force storage save to throw
  adapter.storage._failNextSave = true;

  const asstText = `Hero enters.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": null,
      "localRef": "new:hero",
      "name": "Hero",
      "identityKind": "named",
      "evidence": { "sourceRef": "current:assistant", "excerpt": "Hero enters." },
      "present": true,
      "activeInExchange": false
    }
  ]
}
${TRAILER_TAG_CLOSE}`;

  await host.receiveAssistantMessage(asstText);

  const summary = adapter.diagnostics.getSummary();
  assert.equal(summary.commitsSuccess, 0);
  assert.equal(summary.commitsFailed, 1);

  // Storage remains uncorrupted at revision 0
  adapter.storage._failNextSave = false;
  const loaded = await adapter.storage.load();
  assert.equal(loaded.revision, 0);
  assert.deepEqual(Object.keys(loaded.state.npcs), []);
  adapter.destroy();
});

test('S3 Regression: missing host capabilities fail closed safely', () => {
  // Context missing checked persistence (e.g. no fetch / getRequestHeaders / target identity)
  const brokenCtx1 = {
    chat: [],
    chatId: 'c1',
    eventSource: new MockSillyTavernHost().eventSource,
    eventTypes: new MockSillyTavernHost().eventTypes,
    setExtensionPrompt: () => {},
    updateMessageBlock: () => {},
  };
  const adapter1 = new SillyTavernAdapter({ getContext: () => brokenCtx1 });
  const caps1 = adapter1.detectCapabilities();
  assert.equal(caps1.supported, false);
  assert.equal(caps1.hasCheckedPersistence, false);

  // Context missing eventSource
  const brokenCtx2 = {
    chat: [],
    chatId: 'c2',
    eventTypes: {},
    setExtensionPrompt: () => {},
    updateMessageBlock: () => {},
  };
  const adapter2 = new SillyTavernAdapter({ getContext: () => brokenCtx2 });
  const caps2 = adapter2.detectCapabilities();
  assert.equal(caps2.supported, false);
  assert.equal(caps2.hasEventSource, false);
});

test('S3 Regression: malformed streaming final candidate produces no commit', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_stream_malformed' });
  const interceptorKey = 'test_stream_malformed';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey });
  adapter.initialize();

  host.sendUserMessage('Tell me about the castle');
  await host.triggerGenerateInterceptor();

  const msgIdx = 1;
  await host.emitStreamToken(msgIdx, 'The castle stood high upon the hill.\n');
  await host.emitStreamToken(msgIdx, TRAILER_TAG_OPEN + '\n{"invalid_json": true, incomplete');

  // Finalize streaming
  await host.finalizeStreamingMessage(msgIdx);

  const summary = adapter.diagnostics.getSummary();
  assert.equal(summary.commitsSuccess, 0);
  assert.equal(summary.trailersParsedSuccess, 0);
  assert.equal(summary.trailersParsedFailed, 1);

  const loaded = await adapter.storage.load();
  assert.equal(loaded.revision, 0);
  adapter.destroy();
});

test('S3 Regression: initialize() retries and recovers when host capabilities become ready', () => {
  let contextReady = false;
  const host = new MockSillyTavernHost();
  const interceptorKey = 'test_init_retry';

  const adapter = new SillyTavernAdapter({
    getContext: () => (contextReady ? host.getContext() : null),
    interceptorKey,
  });

  // 1. Initial attempt when context is not ready
  const attempt1 = adapter.initialize();
  assert.equal(attempt1, false);
  assert.equal(adapter.initialized, false);
  assert.equal(typeof globalThis[interceptorKey], 'undefined');

  // 2. Host becomes ready, second attempt succeeds
  contextReady = true;
  const attempt2 = adapter.initialize();
  assert.equal(attempt2, true);
  assert.equal(adapter.initialized, true);
  assert.equal(typeof globalThis[interceptorKey], 'function');

  // 3. Subsequent initialize call is idempotent
  const attempt3 = adapter.initialize();
  assert.equal(attempt3, true);

  adapter.destroy();
  assert.equal(adapter.initialized, false);
  assert.equal(typeof globalThis[interceptorKey], 'undefined');
});

test('S3 Regression: coreChat truncation maps back to exact ctx.chat position and preserves full provenance', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_core_truncation' });
  const interceptorKey = 'test_core_truncation';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey });
  adapter.initialize();

  // Multi-turn history in ctx.chat
  // Position 0: user
  host.sendUserMessage('Turn 1 user message: Hello world');
  // Position 1: assistant
  await host.receiveAssistantMessage('Turn 1 assistant reply: Welcome');
  // Position 2: user
  host.sendUserMessage('Turn 2 user message: Looking for the guildmaster');
  // Position 3: assistant
  await host.receiveAssistantMessage('Turn 2 assistant reply: He is inside');
  // Position 4: current user turn
  host.sendUserMessage('Turn 3 user message: I see Master Dylan standing by the hearth.');

  assert.equal(host.chat.length, 5);
  // Authoritative current user position in ctx.chat is 4

  // Simulate SillyTavern preparing coreChat with earlier messages truncated/windowed
  // coreChat only has the last 3 messages (indices 2, 3, 4 of host.chat)
  const coreChat = host.chat.slice(2);
  assert.equal(coreChat.length, 3);
  // In coreChat, the current user message is at local index 2

  // Trigger generate_interceptor with truncated coreChat
  await host.triggerGenerateInterceptor('normal', coreChat);

  // Assert inFlightRequest mapped back to authoritative ctx.chat position 4, NOT local index 2
  assert.ok(adapter.inFlightRequest);
  assert.equal(adapter.inFlightRequest.userSource.position, 4);
  assert.equal(adapter.inFlightRequest.userSource.text, 'Turn 3 user message: I see Master Dylan standing by the hearth.');
  // Lineage includes all 4 preceding messages from raw ctx.chat
  assert.equal(adapter.inFlightRequest.userSource.precedingLineage.length, 4);
  assert.equal(adapter.inFlightRequest.precedingLineage.length, 5); // 4 preceding + user message fingerprint

  // Assistant generates finalized response with valid one-pass trailer
  const asstText = `"Greetings, traveler," said Dylan warmly.
${TRAILER_TAG_OPEN}
{
  "version": "1",
  "proposals": [
    {
      "id": null,
      "localRef": "new:dylan",
      "name": "Master Dylan",
      "identityKind": "named",
      "evidence": { "sourceRef": "current:assistant", "excerpt": "said Dylan warmly" },
      "present": true,
      "activeInExchange": true,
      "location": "By the hearth",
      "relationshipEvaluation": {
        "shifted": true,
        "axes": { "trust": 1, "affection": 0, "desire": 0, "tension": 0 },
        "impact": "minor",
        "axisSupport": {
          "trust": {
            "reason": "Warm spoken greeting",
            "source": { "sourceRef": "current:assistant", "excerpt": "said Dylan warmly" }
          }
        }
      }
    }
  ]
}
${TRAILER_TAG_CLOSE}`;

  // Assistant message received at position 5 in ctx.chat
  const msgIdx = await host.receiveAssistantMessage(asstText);
  assert.equal(msgIdx, 5);

  const summary = adapter.diagnostics.getSummary();
  assert.equal(summary.candidatesAccepted, 1);
  assert.equal(summary.trailersParsedSuccess, 1);
  assert.equal(summary.commitsSuccess, 1);

  // Verify storage state and pending review entries
  const loaded = await adapter.storage.load();
  assert.equal(loaded.revision, 1);
  const npcs = Object.values(loaded.state.npcs);
  assert.equal(npcs.length, 1);
  const dylan = npcs[0];
  assert.equal(dylan.name, 'Master Dylan');
  assert.equal(dylan.location, 'By the hearth');
  assert.equal(dylan.relationship.trust, 1);

  // Pending review entry carries exact raw chat positions and immutable scope
  assert.equal(loaded.state.pendingReview.entries.length, 1);
  const pendingEntry = loaded.state.pendingReview.entries[0];
  assert.equal(pendingEntry.targetId, dylan.id);
  assert.equal(pendingEntry.metadata.userPosition, 4);
  assert.equal(pendingEntry.metadata.assistantPosition, 5);
  assert.deepEqual(pendingEntry.sourceScope, [
    'chat:chat_core_truncation:4',
    'chat:chat_core_truncation:5',
  ]);
  assert.equal(pendingEntry.exchangeId, 'chat_core_truncation:5');

  adapter.destroy();
});

test('S3 Regression: ambiguous coreChat user mapping fails closed without in-flight generation', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_ambiguous_core' });
  const interceptorKey = 'test_ambiguous_core';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey });
  adapter.initialize();

  // Create two identical user messages in ctx.chat
  host.sendUserMessage('Yes');
  await host.receiveAssistantMessage('Understood');
  host.sendUserMessage('Yes');

  // coreChat passes detached copy with no preceding context to disambiguate
  const coreChat = [
    { is_user: true, is_system: false, name: 'User', mes: 'Yes' },
  ];

  await host.triggerGenerateInterceptor('normal', coreChat);

  // Must fail closed because multiple candidates match and mapping is ambiguous
  assert.equal(adapter.inFlightRequest, null);
  const summary = adapter.diagnostics.getSummary();
  assert.equal(summary.generationsIntercepted, 0);
  const rej = adapter.diagnostics.entries.find(
    (e) => e.type === DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED && e.reason?.includes('Ambiguous mapping')
  );
  assert.ok(rej);

  adapter.destroy();
});

test('S3 Host: Continuation appends to same last assistant message, strips prior valid trailer, and commits at same position', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_continuation_valid' });
  const interceptorKey = 'test_continuation_valid';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  // 1. Initial turn
  host.sendUserMessage('Tell me about Elena.');
  await host.triggerGenerateInterceptor();

  const initialNarrative = 'Elena looked up from her parchment.';
  const initialText = `${initialNarrative}\n\n${TRAILER_TAG_OPEN}\n{\n  "version": "1",\n  "proposals": [\n    {\n      "id": null,\n      "localRef": "new:elena",\n      "name": "Elena",\n      "identityKind": "named",\n      "evidence": { "sourceRef": "current:assistant", "excerpt": "Elena looked up from her parchment." },\n      "present": true,\n      "activeInExchange": false,\n      "mood": "focused"\n    }\n  ]\n}\n${TRAILER_TAG_CLOSE}`;

  const msgIdx = await host.receiveAssistantMessage(initialText, { swipeId: 0 });
  assert.equal(msgIdx, 1);

  let state = await adapter.storage.load();
  assert.equal(state.revision, 1);
  const elenaId = Object.keys(state.state.npcs)[0];
  assert.ok(elenaId);
  assert.equal(state.state.npcs[elenaId].mood, 'focused');

  // Verify hideCommittedTransport performs render-only hiding without destroying raw evidence in host.chat[msgIdx].mes
  assert.equal(host.chat[msgIdx].mes, initialText);
  assert.equal(host.updateMessageBlockCalls.length, 1);
  assert.equal(host.updateMessageBlockCalls[0].message.extra?.display_text, initialNarrative);

  // 2. Host / user triggers continue
  await host.triggerGenerateInterceptor('continue');
  assert.ok(adapter.inFlightRequest);
  assert.equal(adapter.inFlightRequest.generationType, 'continue');
  assert.equal(adapter.inFlightRequest.continuationPosition, msgIdx);
  // Continuation base stripped prior trailer from raw mes and cleared display_text override
  assert.equal(host.chat[msgIdx].mes, initialNarrative);
  assert.equal(host.chat[msgIdx].extra?.display_text, undefined);

  // Continuation appends new narrative + exactly one new valid trailer
  const continuationAppend = ` "And what brings you here?" she asked calmly.\n\n${TRAILER_TAG_OPEN}\n{\n  "version": "1",\n  "proposals": [\n    {\n      "id": "${elenaId}",\n      "present": true,\n      "activeInExchange": false,\n      "mood": "inquiring",\n      "source": { "sourceRef": "current:assistant", "excerpt": "she asked calmly" }\n    }\n  ]\n}\n${TRAILER_TAG_CLOSE}`;

  await host.continueAssistantMessage(continuationAppend);

  // Verified: committed at same position (1), storage revision incremented to 2
  state = await adapter.storage.load();
  assert.equal(state.revision, 2);
  assert.equal(state.state.npcs[elenaId].mood, 'inquiring');

  // Verified: render-only hiding updates display_text without discarding raw continued mes
  const combinedNarrative = 'Elena looked up from her parchment. "And what brings you here?" she asked calmly.';
  assert.equal(host.chat[msgIdx].mes, `${initialNarrative}${continuationAppend}`);
  assert.equal(host.updateMessageBlockCalls.length, 2);
  assert.equal(host.updateMessageBlockCalls[1].message.extra?.display_text, combinedNarrative);

  adapter.destroy();
});

test('S3 Host: Continuation on message with malformed trailer leaves malformed trailer intact and fails closed', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_continue_malformed' });
  const interceptorKey = 'test_continuation_malformed';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  host.sendUserMessage('Tell me about the cave.');
  await host.triggerGenerateInterceptor();

  // Assistant response with malformed trailer
  const malformedMsg = `The cave was dark.\n\n${TRAILER_TAG_OPEN}\n{broken_json\n${TRAILER_TAG_CLOSE}`;
  const msgIdx = await host.receiveAssistantMessage(malformedMsg);

  // Initial commit failed, state is revision 0
  let state = await adapter.storage.load();
  assert.equal(state.revision, 0);
  assert.equal(host.chat[msgIdx].mes, malformedMsg); // Malformed trailer remains untouched

  // User triggers continue
  await host.triggerGenerateInterceptor('continue');

  // Base message must still retain the malformed trailer!
  assert.ok(host.chat[msgIdx].mes.includes('{broken_json'));

  // Continuation appends text + new trailer
  const appendText = ` A breeze stirred.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[]}\n${TRAILER_TAG_CLOSE}`;
  await host.continueAssistantMessage(appendText);

  // State is NOT mutated!
  state = await adapter.storage.load();
  assert.equal(state.revision, 0);

  // Extraction failure recorded
  const fail = adapter.diagnostics.entries.find(
    (e) => e.type === DIAGNOSTIC_EVENT_TYPES.TRAILER_PARSE_FAILURE || e.type === DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED
  );
  assert.ok(fail);

  adapter.destroy();
});

test('S3 Host: Continuation on uncommitted trailer leaves trailer intact and blocks fast mutation', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_continue_uncommitted' });
  const interceptorKey = 'test_continuation_uncommitted';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  host.sendUserMessage('Hello');
  // Inject an assistant message directly that has a valid trailer but was NEVER committed
  const uncommittedMsg = `Uncommitted assistant narrative.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[]}\n${TRAILER_TAG_CLOSE}`;
  host.chat.push({
    is_user: false,
    is_system: false,
    name: 'Assistant',
    mes: uncommittedMsg,
    send_date: Date.now(),
    swipe_id: 0,
    swipes: [uncommittedMsg],
  });
  const asstIdx = host.chat.length - 1;

  // Interceptor for continue
  await host.triggerGenerateInterceptor('continue');

  // Interceptor detects prior transport not committed -> branchUnsafe
  assert.ok(adapter.inFlightRequest);
  assert.ok(adapter.inFlightRequest.branchUnsafe);
  assert.equal(adapter.inFlightRequest.branchUnsafe.reason, 'continuation_prior_transport_not_committed');

  // Uncommitted trailer was NOT stripped from base message!
  assert.equal(host.chat[asstIdx].mes, uncommittedMsg);

  // Continuation appended
  const appendText = ` Additional story.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[]}\n${TRAILER_TAG_CLOSE}`;
  await host.continueAssistantMessage(appendText);

  // State remains revision 0
  const state = await adapter.storage.load();
  assert.equal(state.revision, 0);

  adapter.destroy();
});

test('S3 Host: Transport removal and updateMessageBlock occur only after successful commit; untouched on failure', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_transport_hiding' });
  const interceptorKey = 'test_transport_hiding';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  // Case A: Missing trailer leaves raw story untouched, updateMessageBlock not called
  host.sendUserMessage('Tell me a joke');
  await host.triggerGenerateInterceptor();
  const rawJoke = 'Why did the chicken cross the road? To get to the other side.';
  await host.receiveAssistantMessage(rawJoke);
  assert.equal(host.chat[1].mes, rawJoke);
  assert.equal(host.updateMessageBlockCalls.length, 0);

  // Case B: Malformed trailer leaves raw story untouched, updateMessageBlock not called
  host.sendUserMessage('Tell me another');
  await host.triggerGenerateInterceptor();
  const malformed = `A broken trailer.\n\n${TRAILER_TAG_OPEN}\n{bad_json}\n${TRAILER_TAG_CLOSE}`;
  await host.receiveAssistantMessage(malformed);
  assert.equal(host.chat[3].mes, malformed);
  assert.equal(host.updateMessageBlockCalls.length, 0);

  // Case C: Duplicate trailer leaves raw story untouched, updateMessageBlock not called
  host.sendUserMessage('Tell me another');
  await host.triggerGenerateInterceptor();
  const duplicate = `Duplicate trailers.\n\n${TRAILER_TAG_OPEN}{}${TRAILER_TAG_CLOSE}\n${TRAILER_TAG_OPEN}{}${TRAILER_TAG_CLOSE}`;
  await host.receiveAssistantMessage(duplicate);
  assert.equal(host.chat[5].mes, duplicate);
  assert.equal(host.updateMessageBlockCalls.length, 0);

  // Case D: Failed commit (e.g. server 500) leaves raw story untouched, updateMessageBlock not called
  host.sendUserMessage('Tell me about the hero');
  await host.triggerGenerateInterceptor();
  host.setFetchStatus(500); // Fail checked save on server
  const validTrailerMsg = `The hero arrived in glory.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[{"id":null,"localRef":"new:hero","name":"Hero","identityKind":"named","evidence":{"sourceRef":"current:assistant","excerpt":"The hero arrived in glory."},"present":true,"activeInExchange":false}]}\n${TRAILER_TAG_CLOSE}`;
  await host.receiveAssistantMessage(validTrailerMsg);
  // Commit failed: story untouched, updateMessageBlock NOT called!
  assert.equal(host.chat[7].mes, validTrailerMsg);
  assert.equal(host.updateMessageBlockCalls.length, 0);

  // Case E: Successful commit removes trailer via render-only display_text without mutating raw message.mes or swipes
  host.setFetchStatus(200); // Restore server success
  host.sendUserMessage('Try again for the hero');
  await host.triggerGenerateInterceptor();
  const validSuccessMsg = `The champion entered the hall.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[{"id":null,"localRef":"new:champ","name":"Champion","identityKind":"named","evidence":{"sourceRef":"current:assistant","excerpt":"The champion entered the hall."},"present":true,"activeInExchange":false}]}\n${TRAILER_TAG_CLOSE}`;
  const successIdx = await host.receiveAssistantMessage(validSuccessMsg, { swipeId: 0, swipes: [validSuccessMsg] });

  // Commit succeeded!
  // 1. Raw message.mes is untouched (evidence preserved)
  assert.equal(host.chat[successIdx].mes, validSuccessMsg);
  // 2. Swipes remain untouched
  assert.equal(host.chat[successIdx].swipes[0], validSuccessMsg);
  // 3. updateMessageBlock called with cloned message having extra.display_text = canonicalNarrative
  assert.equal(host.updateMessageBlockCalls.length, 1);
  assert.equal(host.updateMessageBlockCalls[0].messageId, successIdx);
  assert.equal(host.updateMessageBlockCalls[0].message.extra?.display_text, 'The champion entered the hall.');
  assert.deepEqual(host.updateMessageBlockCalls[0].options, { rerenderMessage: true });

  adapter.destroy();
});

test('S3 Host: Checked persistence adapter verifies official /api/chats/save and group save without saveChat reliance', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_checked_persistence' });
  const interceptorKey = 'test_checked_persistence';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  host.sendUserMessage('Greetings');
  await host.triggerGenerateInterceptor();

  const text = `A merchant stepped forward.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[{"id":null,"localRef":"new:merchant","name":"Merchant","identityKind":"named","evidence":{"sourceRef":"current:assistant","excerpt":"A merchant stepped forward."},"present":true,"activeInExchange":false}]}\n${TRAILER_TAG_CLOSE}`;
  await host.receiveAssistantMessage(text);

  // Commit succeeded
  const state = await adapter.storage.load();
  assert.equal(state.revision, 1);

  // Proves Alpha performed checked save directly to /api/chats/save
  assert.equal(host.checkedSaveCalls.length, 1);
  const saveCall = host.checkedSaveCalls[0];
  assert.equal(saveCall.url, '/api/chats/save');
  assert.equal(saveCall.method, 'POST');
  assert.equal(saveCall.body.ch_name, 'TestCharacter');
  assert.equal(saveCall.body.file_name, 'chat_checked_persistence');
  assert.equal(saveCall.body.avatar_url, 'test_character.png');
  assert.equal(saveCall.body.force, false);
  assert.ok(Array.isArray(saveCall.body.chat));
  // chat[0] is header containing chat_metadata with ALPHA_NAMESPACE
  assert.ok(saveCall.body.chat[0].chat_metadata);
  assert.ok(saveCall.body.chat[0].chat_metadata['npc_state_alpha.v1']);

  // Proves Alpha did NOT rely on public saveChat() wrapper
  assert.equal(host.saveChatCalls, 0);

  // Now verify Group chat persistence format
  const groupHost = new MockSillyTavernHost({
    chatId: 'group_chat_file_01',
    groupId: 'group_entity_01',
    groups: [{ id: 'group_entity_01', chat_id: 'group_chat_file_01' }],
    interceptorKey: 'test_group_persistence',
  });
  groupHost.interceptorKey = 'test_group_persistence';
  const groupAdapter = new SillyTavernAdapter({
    getContext: () => groupHost.getContext(),
    interceptorKey: 'test_group_persistence',
  });
  groupAdapter.initialize();

  groupHost.sendUserMessage('Hello group');
  await groupHost.triggerGenerateInterceptor();

  const groupText = `The counselor spoke.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[{"id":null,"localRef":"new:counselor","name":"Counselor","identityKind":"named","evidence":{"sourceRef":"current:assistant","excerpt":"The counselor spoke."},"present":true,"activeInExchange":false}]}\n${TRAILER_TAG_CLOSE}`;
  await groupHost.receiveAssistantMessage(groupText);

  assert.equal(groupHost.checkedSaveCalls.length, 1);
  const groupCall = groupHost.checkedSaveCalls[0];
  assert.equal(groupCall.url, '/api/chats/group/save');
  assert.equal(groupCall.method, 'POST');
  assert.equal(groupCall.body.id, 'group_chat_file_01');
  assert.equal(groupCall.body.force, false);
  assert.ok(Array.isArray(groupCall.body.chat));

  adapter.destroy();
  groupAdapter.destroy();
});

test('S3 Host: Checked persistence fails closed on HTTP non-2xx and network failure', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_fail_checked' });
  const interceptorKey = 'test_fail_checked';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  // 1. HTTP 500 failure
  host.setFetchStatus(500);
  host.sendUserMessage('Test 500');
  await host.triggerGenerateInterceptor();

  const text1 = `Story 1.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[]}\n${TRAILER_TAG_CLOSE}`;
  await host.receiveAssistantMessage(text1);

  let state = await adapter.storage.load();
  assert.equal(state.revision, 0); // Not saved
  const failDiag1 = adapter.diagnostics.entries.find((e) => e.type === DIAGNOSTIC_EVENT_TYPES.COMMIT_FAILURE && e.error?.includes('HTTP 500'));
  assert.ok(failDiag1);

  // 2. Network failure (fetch throws)
  host.setFetchStatus(200);
  host.setFetchNetworkFailure(true);
  host.sendUserMessage('Test network error');
  await host.triggerGenerateInterceptor();

  const text2 = `Story 2.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[]}\n${TRAILER_TAG_CLOSE}`;
  await host.receiveAssistantMessage(text2);

  state = await adapter.storage.load();
  assert.equal(state.revision, 0); // Not saved
  const failDiag2 = adapter.diagnostics.entries.find((e) => e.type === DIAGNOSTIC_EVENT_TYPES.COMMIT_FAILURE && e.error?.includes('network failure'));
  assert.ok(failDiag2);

  // Proves saveChat was never called despite network/HTTP failures
  assert.equal(host.saveChatCalls, 0);

  adapter.destroy();
});

test('S3 Host: public saveChat wrapper that swallows failure is never used to report false success', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_swallow' });
  const interceptorKey = 'test_swallow';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  // Server returns { ok: false } from checked save
  host.setFetchResponseBody({ ok: false, error: 'disk_full' });

  host.sendUserMessage('Hello');
  await host.triggerGenerateInterceptor();

  const text = `A traveller arrived.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[]}\n${TRAILER_TAG_CLOSE}`;
  await host.receiveAssistantMessage(text);

  // Commit failed closed!
  const state = await adapter.storage.load();
  assert.equal(state.revision, 0);
  // host.saveChatCalls remains 0 (Alpha did not call saveChat)
  assert.equal(host.saveChatCalls, 0);

  const diag = adapter.diagnostics.entries.find((e) => e.type === DIAGNOSTIC_EVENT_TYPES.COMMIT_FAILURE && e.error?.includes('explicit ok'));
  assert.ok(diag);

  adapter.destroy();
});

test('S3 Host: MESSAGE_SWIPE_DELETED with object payload {messageId, swipeId, newSwipeId} clears in-flight request safely', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_swipe_del_obj' });
  const interceptorKey = 'test_swipe_del_obj';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  host.sendUserMessage('Hello');
  await host.triggerGenerateInterceptor();
  assert.notEqual(adapter.inFlightRequest, null);

  // Host emits MESSAGE_SWIPE_DELETED with object payload
  await host.deleteSwipe(0, 1, 0);

  assert.equal(adapter.inFlightRequest, null);
  const diag = adapter.diagnostics.entries.find((e) => e.type === DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED && e.eventName === 'MESSAGE_SWIPE_DELETED');
  assert.ok(diag);
  assert.equal(diag.messageId, 0);

  adapter.destroy();
});

test('S3 Contract Regression: PromptInjector does NOT advertise Development-owned fields and immediate shapes parse/validate', () => {
  const contractPrompt = PromptInjector.buildImmediateOutputContract();

  const devOwnedFields = [
    'relationshipDynamic',
    'canonicalAppearance',
    'appearanceForms',
    'personality',
    'behavioralProfile',
    'speech',
    'mannerisms',
    'role',
    'species',
    'background',
    'actualAge',
    'apparentAge',
    'birthday',
    'importantMemories',
    'nonPlayerRelationships',
  ];

  // Verify none of the 15 Development-owned fields are advertised in allowed immediate proposal shapes
  const allowedSection = contractPrompt.split('Strict boundaries:')[0];
  for (const field of devOwnedFields) {
    // Must not advertise as an immediate channel or proposal property in allowedSection
    assert.ok(
      !allowedSection.includes(`"${field}":`),
      `Immediate output contract must not advertise Development-owned field '${field}' as allowed channel`
    );
  }

  // Construct representative assistant response strictly following the advertised immediate channels
  const representativeResponse = `Commander Vane drew his cloak tight against the biting frost. "We move at dawn," he whispered to the scouts.

${TRAILER_TAG_OPEN}
{
  "version": "${ALPHA_ONE_PASS_WIRE_VERSION}",
  "proposals": [
    {
      "id": null,
      "localRef": "new:vane",
      "name": "Commander Vane",
      "identityKind": "named",
      "aliases": ["Vane of the North"],
      "evidence": {
        "sourceRef": "current:assistant",
        "excerpt": "Commander Vane drew his cloak tight"
      },
      "present": true,
      "activeInExchange": true,
      "mood": "resolute",
      "location": "North Outpost",
      "goal": "Prepare dawn departure",
      "status": "alert",
      "currentPresentation": "Heavy fur-lined cloak with iron clasp",
      "currentForm": null,
      "relationshipEvaluation": {
        "shifted": true,
        "impact": "minor",
        "axes": {
          "trust": 1,
          "affection": 0,
          "desire": 0,
          "tension": 0
        },
        "axisSupport": {
          "trust": {
            "reason": "Direct tactical briefing shared with player",
            "source": {
              "sourceRef": "current:assistant",
              "excerpt": "whispered to the scouts"
            }
          }
        }
      }
    },
    {
      "id": "npc_fallen_guard",
      "present": false,
      "activeInExchange": false,
      "lifecycle": {
        "lifeState": "dead",
        "cause": "Frozen in the snowstorm",
        "source": {
          "sourceRef": "current:assistant",
          "excerpt": "biting frost"
        }
      }
    }
  ]
}
${TRAILER_TAG_CLOSE}`;

  // Pass through production extraction parser
  const parseRes = extractAndParseOnePassTrailer(representativeResponse);
  assert.equal(parseRes.success, true);
  assert.equal(parseRes.payload.proposals.length, 2);

  // Pass through production validator without weakening validators
  const valRes = validateOnePassEnvelope(parseRes.payload);
  assert.equal(valRes.valid, true, `Representative immediate output failed validation: ${JSON.stringify(valRes.errors)}`);
});

test('S3 Packaging: dist contains valid manifest, runtime entrypoint, and excludes non-runtime files', async () => {
  const { buildPackage } = await import('../scripts/package.js');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'npc-state-alpha-s3-package-'));
  try {
    const built = buildPackage({
      distDir: path.join(tempRoot, 'dist'),
      releaseDir: path.join(tempRoot, 'release'),
    });
    const distDir = built.distDir;
    const manifestPath = path.join(distDir, 'manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'dist/manifest.json must exist');

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(manifest.js, 'index.js');
    assert.equal(manifest.generate_interceptor, 'npc_state_alpha_generate_interceptor');
    assert.ok(
      !manifest.author || !manifest.author.toLowerCase().includes('google'),
      'Author attribution must not reference Google'
    );

    const indexPath = path.join(distDir, 'index.js');
    assert.ok(fs.existsSync(indexPath), 'dist/index.js must exist');

    const distModule = await import(`file://${indexPath.replace(/\\/g, '/')}`);
    assert.equal(typeof distModule.initExtension, 'function');
    assert.equal(typeof distModule.getActiveAdapter, 'function');

    assert.ok(fs.existsSync(path.join(distDir, 'src', 'contract')));
    assert.ok(fs.existsSync(path.join(distDir, 'src', 'runtime')));
    assert.ok(fs.existsSync(path.join(distDir, 'src', 'state')));
    assert.ok(fs.existsSync(path.join(distDir, 'src', 'host')));

    assert.ok(!fs.existsSync(path.join(distDir, 'tests')), 'dist must not include tests/');
    assert.ok(!fs.existsSync(path.join(distDir, 'docs')), 'dist must not include docs/');
    assert.ok(!fs.existsSync(path.join(distDir, 'scripts')), 'dist must not include scripts/');
    assert.ok(!fs.existsSync(path.join(distDir, '.git')), 'dist must not include .git/');
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
});

test('S3 Host Regression: Streaming error candidate with valid trailer is rejected and does not commit; successful streaming commits', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_stream_guard' });
  const interceptorKey = 'test_stream_guard';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  // 1. Error path: candidate contains complete valid trailer, but streamingProcessor errored
  host.sendUserMessage('Hello streaming error test');
  await host.triggerGenerateInterceptor();

  const validTrailerMsg = `The wizard spoke before the connection failed.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[{"id":null,"localRef":"new:wizard","name":"Wizard","identityKind":"named","evidence":{"sourceRef":"current:assistant","excerpt":"The wizard spoke"},"present":true,"activeInExchange":false}]}\n${TRAILER_TAG_CLOSE}`;

  // Assistant message inserted into chat
  host.chat.push({
    is_user: false,
    is_system: false,
    name: 'Assistant',
    mes: validTrailerMsg,
    send_date: Date.now(),
  });
  const asstIdx = host.chat.length - 1;

  // Simulate exact SillyTavern 1.18.0 onErrorStreaming state:
  // sets isStopped=true, aborts controller, then emits MESSAGE_RECEIVED
  const abortCtrl = new AbortController();
  abortCtrl.abort();
  host.setStreamingProcessor({
    messageId: asstIdx,
    isFinished: false,
    isStopped: true,
    abortController: abortCtrl,
  });

  // Emit MESSAGE_RECEIVED on error path
  await host.eventSource.emit(host.eventTypes.MESSAGE_RECEIVED, asstIdx, 'streaming');

  // Must NOT commit!
  let state = await adapter.storage.load();
  assert.equal(state.revision, 0);
  assert.equal(Object.keys(state.state.npcs).length, 0);

  const errorDiag = adapter.diagnostics.entries.find(
    (e) => e.type === DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED && e.reason?.includes('Streaming candidate rejected')
  );
  assert.ok(errorDiag, 'Diagnostics must record streaming candidate rejection on error');

  // 2. Successful streaming path: streamingProcessor sets isFinished=true
  host.sendUserMessage('Hello streaming success test');
  await host.triggerGenerateInterceptor();

  const successStreamMsg = `The wizard returned in triumph.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[{"id":null,"localRef":"new:wizard","name":"Wizard","identityKind":"named","evidence":{"sourceRef":"current:assistant","excerpt":"The wizard returned"},"present":true,"activeInExchange":false}]}\n${TRAILER_TAG_CLOSE}`;

  host.chat.push({
    is_user: false,
    is_system: false,
    name: 'Assistant',
    mes: successStreamMsg,
    send_date: Date.now(),
  });
  const successIdx = host.chat.length - 1;

  host.setStreamingProcessor({
    messageId: successIdx,
    isFinished: true,
    isStopped: false,
    abortController: new AbortController(),
  });

  await host.eventSource.emit(host.eventTypes.MESSAGE_RECEIVED, successIdx, 'streaming');

  // Must commit successfully!
  state = await adapter.storage.load();
  assert.equal(state.revision, 1);
  assert.equal(Object.keys(state.state.npcs).length, 1);

  // 3. Non-streaming with no processor remains allowed
  host.setStreamingProcessor(null);
  host.sendUserMessage('Hello non-streaming test');
  await host.triggerGenerateInterceptor();

  const nonStreamMsg = `The knight nodded.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[{"id":null,"localRef":"new:knight","name":"Knight","identityKind":"named","evidence":{"sourceRef":"current:assistant","excerpt":"The knight nodded"},"present":true,"activeInExchange":false}]}\n${TRAILER_TAG_CLOSE}`;
  await host.receiveAssistantMessage(nonStreamMsg);

  state = await adapter.storage.load();
  assert.equal(state.revision, 2);

  adapter.destroy();
});

test('S3 Host Regression: Raw mes contains committed trailer while rerender clone is clean, reload reconciliation re-hides committed transport, and malformed/uncommitted remains untouched', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_transport_recon' });
  const interceptorKey = 'test_transport_recon';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  // 1. Commit an assistant message with valid terminal trailer
  host.sendUserMessage('Tell me about the archer.');
  await host.triggerGenerateInterceptor();

  const narrativeText = 'The archer drew her bowstring back with steady breath.';
  const validTrailer = `\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[{"id":null,"localRef":"new:archer","name":"Archer","identityKind":"named","evidence":{"sourceRef":"current:assistant","excerpt":"The archer drew her bowstring"},"present":true,"activeInExchange":false}]}\n${TRAILER_TAG_CLOSE}`;
  const fullRawMessage = `${narrativeText}${validTrailer}`;

  const asstIdx = await host.receiveAssistantMessage(fullRawMessage);

  // Assert raw mes in host.chat STILL contains the complete trailer verbatim (raw evidence preserved)
  assert.equal(host.chat[asstIdx].mes, fullRawMessage);

  // Assert updateMessageBlock received clone with display_text set to clean narrative
  assert.equal(host.updateMessageBlockCalls.length, 1);
  assert.equal(host.updateMessageBlockCalls[0].messageId, asstIdx);
  assert.equal(host.updateMessageBlockCalls[0].message.extra?.display_text, narrativeText);
  // Ensure the actual message object in chat did not have its raw mes mutated
  assert.equal(host.chat[asstIdx].mes, fullRawMessage);

  // 2. Add uncommitted message with valid trailer, and a message with malformed trailer
  const uncommittedValidMsg = `Uncommitted valid story.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[{"id":null,"localRef":"new:scout","name":"Scout","identityKind":"named","evidence":{"sourceRef":"current:assistant","excerpt":"Uncommitted valid story"},"present":true,"activeInExchange":false}]}\n${TRAILER_TAG_CLOSE}`;
  host.chat.push({
    is_user: false,
    is_system: false,
    name: 'Assistant',
    mes: uncommittedValidMsg,
    send_date: Date.now(),
  });
  const uncommittedIdx = host.chat.length - 1;

  const malformedMsg = `Malformed story.\n\n${TRAILER_TAG_OPEN}\n{bad_json}\n${TRAILER_TAG_CLOSE}`;
  host.chat.push({
    is_user: false,
    is_system: false,
    name: 'Assistant',
    mes: malformedMsg,
    send_date: Date.now(),
  });
  const malformedIdx = host.chat.length - 1;

  // Clear updateMessageBlock calls
  host.updateMessageBlockCalls = [];

  // 3. Reconcile display (simulating reload or CHAT_LOADED)
  await adapter.reconcileCommittedTransportDisplay();

  // updateMessageBlock should be called ONLY for the durably committed message (asstIdx)
  assert.equal(host.updateMessageBlockCalls.length, 1);
  assert.equal(host.updateMessageBlockCalls[0].messageId, asstIdx);
  assert.equal(host.updateMessageBlockCalls[0].message.extra?.display_text, narrativeText);

  // Uncommitted and malformed messages remain completely untouched and un-hidden
  assert.equal(host.chat[uncommittedIdx].mes, uncommittedValidMsg);
  assert.equal(host.chat[malformedIdx].mes, malformedMsg);

  // Calling reconcile again is idempotent
  host.updateMessageBlockCalls = [];
  await adapter.reconcileCommittedTransportDisplay();
  assert.equal(host.updateMessageBlockCalls.length, 1);
  assert.equal(host.updateMessageBlockCalls[0].messageId, asstIdx);

  adapter.destroy();
});

test('S3 Host Regression: Switching active chat while checked save is pending preserves server target to old chat and never leaks state to new chat metadata', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_old_room' });
  const interceptorKey = 'test_chat_switch_save';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  host.sendUserMessage('Greeting in old room');
  await host.triggerGenerateInterceptor();

  const assistantMsg = `The innkeeper bowed.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[{"id":null,"localRef":"new:innkeeper","name":"Innkeeper","identityKind":"named","evidence":{"sourceRef":"current:assistant","excerpt":"The innkeeper bowed"},"present":true,"activeInExchange":false}]}\n${TRAILER_TAG_CLOSE}`;

  // Install delayed fetch hook: when save is sent to server, switch active chat before resolving
  host.setFetchHook(async (url, options) => {
    // Switch active chat in the host while save HTTP request is pending
    await host.switchChat('chat_new_room');
  });

  // Assistant message finalized, triggers checked save
  await host.receiveAssistantMessage(assistantMsg);

  // Verify server save call was sent and strictly targeted old chat
  assert.equal(host.checkedSaveCalls.length, 1);
  const saveCall = host.checkedSaveCalls[0];
  assert.equal(saveCall.url, '/api/chats/save');
  assert.equal(saveCall.body.file_name, 'chat_old_room');

  // Verify internal store for old chat was updated
  const oldStore = adapter.storage._chatStores.get('chat_old_room');
  assert.ok(oldStore);
  assert.equal(oldStore.revision, 1);
  assert.equal(Object.keys(oldStore.npcs).length, 1);

  // Critical check: new chat metadata NEVER received old Alpha state!
  const newChatMetadata = host.metadataByChatId.get('chat_new_room') || {};
  assert.equal(newChatMetadata[ALPHA_NAMESPACE], undefined);

  // Active context metadata is also clean for chat_new_room
  const currentCtx = host.getContext();
  assert.equal(currentCtx.chatId, 'chat_new_room');
  assert.equal(currentCtx.chatMetadata[ALPHA_NAMESPACE], undefined);
  // The host emits CHARACTER_MESSAGE_RENDERED after MESSAGE_RECEIVED returns. Because
  // the active chat switched during the checked save, Alpha must not repaint the new
  // chat at the old chat's numeric message position.
  assert.equal(host.updateMessageBlockCalls.length, 0);

  adapter.destroy();
});

test('S3 Host Regression: Concurrent duplicate MESSAGE_RECEIVED events serialize so exactly one commits, avoiding duplicate relationship shift', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_concurrent_events' });
  const interceptorKey = 'test_concurrent_events';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  host.sendUserMessage('Hello concurrent');
  await host.triggerGenerateInterceptor();

  const candidateText = `The mentor smiled warmly.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[{"id":null,"localRef":"new:mentor","name":"Mentor","identityKind":"named","evidence":{"sourceRef":"current:assistant","excerpt":"The mentor smiled"},"present":true,"activeInExchange":true,"relationshipEvaluation":{"shifted":true,"impact":"minor","axes":{"trust":1,"affection":0,"desire":0,"tension":0},"axisSupport":{"trust":{"reason":"warm smile","source":{"sourceRef":"current:assistant","excerpt":"smiled warmly"}}}}}]}\n${TRAILER_TAG_CLOSE}`;

  // Insert message into chat
  host.chat.push({
    is_user: false,
    is_system: false,
    name: 'Assistant',
    mes: candidateText,
    send_date: Date.now(),
  });
  const asstPos = host.chat.length - 1;

  // Race two concurrent MESSAGE_RECEIVED calls for the same message
  await Promise.all([
    adapter.handleMessageReceived(asstPos, 'normal'),
    adapter.handleMessageReceived(asstPos, 'normal'),
  ]);

  // Verify exactly one state commit and revision increment (revision 1, not 2)
  const state = await adapter.storage.load();
  assert.equal(state.revision, 1);

  const npcs = Object.values(state.state.npcs);
  assert.equal(npcs.length, 1);
  const mentor = npcs[0];
  // Verify relationship trust shifted exactly once to 1, NO double relationship shift!
  assert.equal(mentor.relationship.trust, 1);

  // Verify diagnostic entries show exactly one commit and one replay suppression or rejection
  const summary = adapter.diagnostics.getSummary();
  assert.equal(summary.commitsSuccess, 1);
  assert.ok(summary.replaysSuppressed >= 1 || summary.candidatesRejected >= 1);

  adapter.destroy();
});

test('S3 Host Regression: Active chat switch between generation capture/storage-load and commit fails closed to prevent cross-chat mutation', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_source_a' });
  const interceptorKey = 'test_post_await_chat_safety';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  host.sendUserMessage('Message in chat A');
  await host.triggerGenerateInterceptor();

  const candidateText = `Action in chat A.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[{"id":null,"localRef":"new:scout","name":"Scout A","identityKind":"named","evidence":{"sourceRef":"current:assistant","excerpt":"Action in chat A"},"present":true,"activeInExchange":false}]}\n${TRAILER_TAG_CLOSE}`;

  host.chat.push({
    is_user: false,
    is_system: false,
    name: 'Assistant',
    mes: candidateText,
    send_date: Date.now(),
  });
  const asstPos = host.chat.length - 1;

  // Hook storage.load to switch active chat right after load finishes
  const originalLoad = adapter.storage.load.bind(adapter.storage);
  adapter.storage.load = async (...args) => {
    const res = await originalLoad(...args);
    // Switch active chat right after storage load
    host.chatId = 'chat_source_b';
    return res;
  };

  await adapter.handleMessageReceived(asstPos, 'normal');

  // Verify commit was aborted (fail closed) due to post-await chat mismatch
  const diag = adapter.diagnostics.entries.find(
    (e) => e.type === DIAGNOSTIC_EVENT_TYPES.HOST_EVENT_REJECTED && e.reason?.includes('Post-await chat switch detected')
  );
  assert.ok(diag, 'Diagnostics must record post-await chat switch rejection');

  // State in chat A remains revision 0 (no mutation)
  adapter.storage.setChatId('chat_source_a');
  const stateA = await adapter.storage.load();
  assert.equal(stateA.revision, 0);

  // Chat B also has revision 0
  adapter.storage.setChatId('chat_source_b');
  const stateB = await adapter.storage.load();
  assert.equal(stateB.revision, 0);

  adapter.destroy();
});

test('S3 Host Regression: Continuity projection includes canonical status/offscreenActivity and read-only relationshipDynamic', () => {
  const state = createInitialState();
  const npcLiving = createDefaultNpcRecord('npc_captain', 'Captain Ryan', {
    present: true,
    activeInExchange: true,
    offscreenActivity: null,
    relationshipDynamic: 'trusted ally',
  });
  npcLiving.status = 'inspecting the rigging';
  const npcOffscreen = createDefaultNpcRecord('npc_lookout', 'Lookout Sam', {
    present: false,
    activeInExchange: false,
    offscreenActivity: 'scanning the fog from the crow\'s nest',
    relationshipDynamic: 'cautious acquaintance',
  });
  state.npcs = {
    [npcLiving.id]: npcLiving,
    [npcOffscreen.id]: npcOffscreen,
  };

  const projection = PromptInjector.buildContinuityProjection(state);

  // Canonical status carries current activity/status; offscreenActivity remains separate.
  assert.ok(projection.includes('status: "inspecting the rigging"'));
  assert.ok(projection.includes('offscreenActivity: "scanning the fog from the crow\'s nest"'));
  assert.ok(!projection.includes('activity: "inspecting the rigging"'));

  // Verify read-only relationshipDynamic is projected as continuity input
  assert.ok(projection.includes('dynamic: "trusted ally"'));
  assert.ok(projection.includes('dynamic: "cautious acquaintance"'));

  // Verify immediate output contract does NOT advertise any Development-owned fields
  const contract = PromptInjector.buildImmediateOutputContract();
  const allowedSection = contract.split('Strict boundaries:')[0];
  assert.ok(!allowedSection.includes('"relationshipDynamic":'));
  assert.ok(!allowedSection.includes('"personality":'));
  assert.ok(!allowedSection.includes('"canonicalAppearance":'));
});

test('S6 Host Regression: pre-generation history check reconstructs an offline lineage edit before the next turn', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_lineage_tamper' });
  const interceptorKey = 'test_lineage_tamper_interceptor';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  // Turn 0: User sends message
  host.sendUserMessage('Hello Bob the Builder');
  await host.triggerGenerateInterceptor('normal');

  // Turn 1: Assistant generates and commits
  const candidate1Text = `"I can fix it," replied Bob.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[{"id":null,"localRef":"new:bob","name":"Bob","identityKind":"named","evidence":{"sourceRef":"current:assistant","excerpt":"replied Bob"},"present":true,"activeInExchange":false}]}\n${TRAILER_TAG_CLOSE}`;

  await host.receiveAssistantMessage(candidate1Text);

  // Verify Turn 1 committed successfully at revision 1
  const state1 = await adapter.storage.load();
  assert.equal(state1.revision, 1);
  const npcs1 = Object.values(state1.state.npcs);
  assert.equal(npcs1.length, 1);
  assert.equal(npcs1[0].name, 'Bob');

  // Verify committed assistant message text and swipe in chat
  assert.equal(host.chat[1].is_user, false);
  const originalAssistantMes = host.chat[1].mes;
  const originalAssistantSwipe = host.chat[1].swipe_id ?? 0;

  // Verify direct detectCommittedBranchDivergence returns null on untampered chat
  const divBefore = detectCommittedBranchDivergence(state1.state, host.chat);
  assert.equal(divBefore, null);

  // Now, edit/tamper an earlier user message (Turn 0) after commit
  host.chat[0].mes = 'I am completely replacing what the user originally said!';

  // Confirm that committed assistant text and swipe are strictly UNCHANGED
  assert.equal(host.chat[1].mes, originalAssistantMes);
  assert.equal(host.chat[1].swipe_id ?? 0, originalAssistantSwipe);

  // Verify direct detectCommittedBranchDivergence immediately catches the preceding lineage divergence
  const divAfter = detectCommittedBranchDivergence(state1.state, host.chat);
  assert.ok(divAfter, 'detectCommittedBranchDivergence must detect divergence');
  assert.equal(divAfter.reason, 'committed_source_preceding_lineage_changed');
  assert.equal(divAfter.position, 1);

  // Turn 2: Next generation begins - User sends next message
  host.sendUserMessage('Can we fix it?');
  await host.triggerGenerateInterceptor('normal');

  // S6 reconstructs the selected canonical history before capturing this request.
  assert.ok(adapter.inFlightRequest, 'inFlightRequest should be created');
  assert.equal(Boolean(adapter.inFlightRequest.branchUnsafe), false);
  const recoveredBeforeTurn2 = await adapter.storage.load();
  assert.ok(recoveredBeforeTurn2.revision > state1.revision);
  assert.equal(Object.values(recoveredBeforeTurn2.state.npcs).filter((npc) => npc.name === 'Bob').length, 1);

  // Turn 2: Assistant generates next turn with a new proposal
  const candidate2Text = `"Yes we can!" shouted Wendy.\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[{"id":null,"localRef":"new:wendy","name":"Wendy","identityKind":"named","evidence":{"sourceRef":"current:assistant","excerpt":"shouted Wendy"},"present":true,"activeInExchange":false}]}\n${TRAILER_TAG_CLOSE}`;

  await host.receiveAssistantMessage(candidate2Text);

  const state2 = await adapter.storage.load();
  assert.ok(state2.revision > recoveredBeforeTurn2.revision);
  const npcs2 = Object.values(state2.state.npcs);
  assert.equal(npcs2.length, 2);
  assert.ok(npcs2.some((n) => n.name === 'Bob'));
  assert.ok(npcs2.some((n) => n.name === 'Wendy'));
  assert.ok(adapter.diagnostics.entries.some((entry) => entry.type === DIAGNOSTIC_EVENT_TYPES.HISTORY_RECOVERY_COMMITTED));

  adapter.destroy();
});

test('S3 Host Regression: MESSAGE_RECEIVED commits before CHARACTER_MESSAGE_RENDERED performs transport concealment', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_render_boundary' });
  const interceptorKey = 'test_render_boundary';
  host.interceptorKey = interceptorKey;
  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey });
  adapter.initialize();

  host.sendUserMessage('Give me a short reply.');
  await host.triggerGenerateInterceptor('normal');

  const narrative = 'The sentry nodded once.';
  const raw = `${narrative}\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[]}\n${TRAILER_TAG_CLOSE}`;
  host.chat.push({
    is_user: false,
    is_system: false,
    name: 'Assistant',
    mes: raw,
    send_date: Date.now(),
    swipe_id: 0,
    swipes: [raw],
    extra: {},
  });
  const messageId = host.chat.length - 1;

  // Exact ST 1.18.0 order: commit event is awaited before the host renders the message.
  await host.eventSource.emit(host.eventTypes.MESSAGE_RECEIVED, messageId, 'normal');
  const committed = await adapter.storage.load();
  assert.equal(committed.revision, 1);
  assert.equal(host.updateMessageBlockCalls.length, 0, 'state commit must not pretend the message has already rendered');
  assert.equal(host.chat[messageId].mes, raw, 'raw extraction bytes remain recoverable');
  assert.equal(
    host.chat[messageId].extra?.display_text,
    narrative,
    'after durable commit, the temporary display override must be armed before SillyTavern first renders the message'
  );

  await host.eventSource.emit(host.eventTypes.CHARACTER_MESSAGE_RENDERED, messageId, 'normal');
  assert.equal(host.updateMessageBlockCalls.length, 1);
  assert.equal(host.updateMessageBlockCalls[0].message.extra?.display_text, narrative);
  assert.equal(host.chat[messageId].mes, raw, 'presentation concealment must not rewrite raw message text');
  assert.equal(host.chat[messageId].extra?.display_text, undefined, 'temporary Alpha display metadata must be restored after render');

  adapter.destroy();
});

test('S3 C03 Regression: recognized failed Alpha transport stays raw but is excluded from later prompt lineage', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_failed_transport_projection' });
  const interceptorKey = 'test_failed_transport_projection';
  host.interceptorKey = interceptorKey;
  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey });
  adapter.initialize();

  host.sendUserMessage('First turn.');
  await host.triggerGenerateInterceptor('normal');
  const narrative = 'The archivist closed the ledger.';
  const invalidEnvelope = `${narrative}\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[],"unknownRootKey":true}\n${TRAILER_TAG_CLOSE}`;
  const messageId = await host.receiveAssistantMessage(invalidEnvelope);

  const afterFailure = await adapter.storage.load();
  assert.equal(afterFailure.revision, 0, 'schema-invalid extraction must not commit');
  assert.equal(host.chat[messageId].mes, invalidEnvelope, 'failed transport bytes must remain raw/recoverable');
  assert.equal(host.updateMessageBlockCalls.length, 0, 'uncommitted transport must not be hidden as synchronized success');

  host.sendUserMessage('Second turn.');
  await host.triggerGenerateInterceptor('normal');

  assert.ok(adapter.inFlightRequest, 'failed prior extraction must not poison mapping of the next owned request');
  assert.equal(host.chat[messageId].mes, invalidEnvelope, 'prompt projection must be non-destructive');
  assert.equal(host.lastInterceptorChat[messageId].mes, narrative, 'recognized terminal Alpha transport must not replay as narrative context');
  assert.ok(!host.lastInterceptorChat[messageId].mes.includes(TRAILER_TAG_OPEN));

  adapter.destroy();
});

test('S3 Host Regression: extension can initialize on welcome screen before a chat is selected and later activates normally', async () => {
  const host = new MockSillyTavernHost({ chatId: 'placeholder_chat' });
  const interceptorKey = 'test_welcome_screen_init';
  host.interceptorKey = interceptorKey;
  host.chatId = null;
  host.characters[0].chat = null;

  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey });
  const caps = adapter.detectCapabilities();
  assert.equal(caps.hasChatId, false);
  assert.equal(caps.supported, true, 'stable extension/event/persistence surfaces are sufficient before chat selection');
  assert.equal(adapter.initialize(), true);
  assert.equal(typeof globalThis[interceptorKey], 'function');

  await host.switchChat('chat_after_welcome');
  host.sendUserMessage('Now a real chat is selected.');
  await host.triggerGenerateInterceptor('normal');
  assert.ok(adapter.inFlightRequest);
  assert.equal(adapter.inFlightRequest.chatId, 'chat_after_welcome');

  adapter.destroy();
});

test('S3 Host Regression: committed Alpha transport concealment preserves an existing foreign display_text override', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_foreign_display' });
  const interceptorKey = 'test_foreign_display';
  host.interceptorKey = interceptorKey;
  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey });
  adapter.initialize();

  host.sendUserMessage('Hello.');
  await host.triggerGenerateInterceptor('normal');
  const narrative = 'The interpreter bowed.';
  const raw = `${narrative}\n\n${TRAILER_TAG_OPEN}\n{"version":"1","proposals":[]}\n${TRAILER_TAG_CLOSE}`;
  const messageId = await host.receiveAssistantMessage(raw, {
    extra: { display_text: 'Translated display owned by another extension.' },
  });

  const committed = await adapter.storage.load();
  assert.equal(committed.revision, 1);
  assert.equal(host.chat[messageId].mes, raw);
  assert.equal(host.chat[messageId].extra.display_text, 'Translated display owned by another extension.');
  assert.equal(host.updateMessageBlockCalls.length, 1);
  assert.equal(
    host.updateMessageBlockCalls[0].message.extra.display_text,
    'Translated display owned by another extension.',
    'Alpha must not overwrite another extension\'s presentation override'
  );

  adapter.destroy();
});
