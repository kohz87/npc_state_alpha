import test from 'node:test';
import assert from 'node:assert/strict';
import { MockSillyTavernHost } from './fixtures/host-harness.js';
import { SillyTavernAdapter } from '../src/host/sillytavern-adapter.js';
import {
  TRAILER_TAG_OPEN,
  TRAILER_TAG_CLOSE,
  ALPHA_ONE_PASS_WIRE_VERSION,
} from '../src/contract/wire-schemas.js';

test('Retry Immediate: Captures failure descriptor on trailer parse error', async () => {
  const host = new MockSillyTavernHost();
  const interceptorKey = 'test_interceptor_retry_1';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  // Send user message and trigger generation interceptor
  host.sendUserMessage('Hello Alice!');
  await host.triggerGenerateInterceptor();

  // Receive assistant message with corrupted trailer
  await host.receiveAssistantMessage(`Greetings traveler! ${TRAILER_TAG_OPEN}{invalid_json}`);

  const failure = adapter.getImmediateFailure(host.chatId);
  assert.ok(failure, 'Failure descriptor should be captured in lastImmediateFailureByChat');
  assert.equal(failure.chatId, host.chatId);
  assert.equal(failure.messageId, 1);
  assert.equal(failure.errorCode, 'truncated_trailer');

  adapter.destroy();
});

test('Retry Immediate: Successfully retries when trailer is corrected, clears failure, and avoids duplicate scoring', async () => {
  const host = new MockSillyTavernHost();
  const interceptorKey = 'test_interceptor_retry_2';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  adapter.initialize();

  host.sendUserMessage('Hello Alice!');
  await host.triggerGenerateInterceptor();
  await host.receiveAssistantMessage(`Greetings traveler! ${TRAILER_TAG_OPEN}{invalid_json}`);

  const initialFailure = adapter.getImmediateFailure(host.chatId);
  assert.ok(initialFailure);
  assert.equal(initialFailure.errorCode, 'truncated_trailer');

  // Correct the message text in host chat
  host.chat[1].mes = `"I am Alice," she said.\n\n${TRAILER_TAG_OPEN}\n{\n  "version": "${ALPHA_ONE_PASS_WIRE_VERSION}",\n  "proposals": [\n    {\n      "id": null,\n      "localRef": "new:alice",\n      "name": "Alice",\n      "identityKind": "named",\n      "evidence": {\n        "sourceRef": "current:assistant",\n        "excerpt": "she said"\n      },\n      "present": true,\n      "activeInExchange": true,\n      "mood": "happy",\n      "relationshipEvaluation": {\n        "shifted": false,\n        "reason": "Friendly greeting without relational shift",\n        "source": {\n          "sourceRef": "current:assistant",\n          "excerpt": "she said"\n        }\n      }\n    }\n  ]\n}\n${TRAILER_TAG_CLOSE}`;

  // Call retryImmediate
  const res = await adapter.retryImmediate({ chatId: host.chatId });
  assert.equal(res.success, true);
  assert.equal(res.status, 'committed');

  // Verify failure descriptor was cleared
  assert.equal(adapter.getImmediateFailure(host.chatId), null);

  // Verify state was committed
  const loaded = await adapter.storage.load();
  const alice = Object.values(loaded.state.npcs).find((n) => n.name === 'Alice');
  assert.ok(alice);
  assert.equal(alice.mood, 'happy');

  // Attempting to retry again suppresses duplicate retry / returns no_failed_exchange
  const secondRes = await adapter.retryImmediate({ chatId: host.chatId });
  assert.equal(secondRes.success, false);
  assert.equal(secondRes.status, 'no_failed_exchange');

  adapter.destroy();
});

test('Retry Immediate: rejects caller-supplied replacement text', async () => {
  const host = new MockSillyTavernHost();
  host.interceptorKey = 'test_interceptor_retry_override';
  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey: host.interceptorKey });
  adapter.initialize();
  host.sendUserMessage('Hello Alice!');
  await host.triggerGenerateInterceptor();
  await host.receiveAssistantMessage(`Greetings traveler! ${TRAILER_TAG_OPEN}{invalid_json}`);

  const result = await adapter.retryImmediate({ rawText: 'invented replacement' });
  assert.equal(result.success, false);
  assert.equal(result.status, 'raw_override_forbidden');
  assert.ok(adapter.getImmediateFailure(host.chatId));
  adapter.destroy();
});

test('Retry Immediate: rejects changed assistant swipe identity', async () => {
  const host = new MockSillyTavernHost();
  host.interceptorKey = 'test_interceptor_retry_swipe';
  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey: host.interceptorKey });
  adapter.initialize();
  host.sendUserMessage('Hello Alice!');
  await host.triggerGenerateInterceptor();
  await host.receiveAssistantMessage(`Greetings traveler! ${TRAILER_TAG_OPEN}{invalid_json}`);

  host.chat[1].swipe_id = 1;
  const result = await adapter.retryImmediate();
  assert.equal(result.success, false);
  assert.equal(result.status, 'branch_changed');
  assert.equal((await adapter.storage.load()).state.revision, 0);
  adapter.destroy();
});

test('Retry Immediate: rejects changed prior lineage instead of reusing stale ownership', async () => {
  const host = new MockSillyTavernHost();
  host.interceptorKey = 'test_interceptor_retry_lineage';
  const adapter = new SillyTavernAdapter({ getContext: () => host.getContext(), interceptorKey: host.interceptorKey });
  adapter.initialize();
  host.sendUserMessage('Hello Alice!');
  await host.triggerGenerateInterceptor();
  await host.receiveAssistantMessage(`Greetings traveler! ${TRAILER_TAG_OPEN}{invalid_json}`);

  host.chat[0].mes = 'Edited earlier user message';
  const result = await adapter.retryImmediate();
  assert.equal(result.success, false);
  assert.equal(result.status, 'lineage_changed');
  assert.equal((await adapter.storage.load()).state.revision, 0);
  adapter.destroy();
});
