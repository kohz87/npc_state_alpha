import test from 'node:test';
import assert from 'node:assert/strict';

import { SillyTavernAdapter } from '../src/host/sillytavern-adapter.js';
import {
  buildAuthoritativeCaptureView,
  installGenerationInterceptorBridge,
} from '../src/host/generation-interceptor-bridge.js';
import { MockSillyTavernHost } from './fixtures/host-harness.js';

test('host bridge binds prompt-transformed current user to authoritative raw chat', async () => {
  const host = new MockSillyTavernHost({ chatId: 'chat_transformed_projection' });
  const interceptorKey = 'test_npc_state_alpha_transformed_projection';
  host.interceptorKey = interceptorKey;

  const adapter = new SillyTavernAdapter({
    getContext: () => host.getContext(),
    interceptorKey,
  });
  assert.equal(adapter.initialize(), true);
  assert.equal(installGenerationInterceptorBridge(adapter), true);

  host.sendUserMessage('Tell Mara I have arrived at the north gate.');
  const rawUser = host.chat.at(-1);
  const projected = host.chat.map((message, index) => ({
    ...message,
    mes: message.is_user
      ? `[prompt-regex-prefix]\n${message.mes}\n[file-derived prompt text]`
      : message.mes,
    index,
  }));

  await host.triggerGenerateInterceptor('normal', projected);

  assert.ok(adapter.inFlightRequest, 'Transformed prompt bytes must not prevent request capture.');
  assert.equal(adapter.inFlightRequest.chatId, host.chatId);
  assert.equal(adapter.inFlightRequest.userSource.position, host.chat.length - 1);
  assert.equal(adapter.inFlightRequest.userSource.text, rawUser.mes);
  assert.notEqual(adapter.inFlightRequest.userSource.text, projected.at(-1).mes);
  assert.ok(adapter.inFlightRequest.userSource.contentFingerprint.startsWith('sha256:'));

  adapter.destroy();
});

test('authoritative capture view fails closed when send_date metadata is ambiguous', () => {
  const sendDate = 1770000000000;
  const rawChat = [
    { is_user: true, is_system: false, mes: 'older', send_date: sendDate },
    { is_user: false, is_system: false, mes: 'reply', send_date: sendDate + 1 },
    { is_user: true, is_system: false, mes: 'latest', send_date: sendDate },
  ];
  const projected = rawChat.map((message, index) => ({
    ...message,
    mes: message.is_user ? `TRANSFORMED:${message.mes}` : message.mes,
    index,
  }));

  assert.equal(buildAuthoritativeCaptureView(projected, rawChat), null);
});

test('authoritative capture view fails closed when projected user metadata no longer matches raw current user', () => {
  const rawChat = [
    { is_user: true, is_system: false, mes: 'raw request', send_date: 1770000000100 },
  ];
  const projected = [
    { ...rawChat[0], mes: 'transformed request', send_date: 1770000000999, index: 0 },
  ];

  assert.equal(buildAuthoritativeCaptureView(projected, rawChat), null);
});
