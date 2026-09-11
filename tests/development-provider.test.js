import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DevelopmentProviderError,
  SillyTavernDevelopmentProvider,
} from '../src/host/development-provider.js';

test('Development provider: throwing SillyTavern profile lookup maps to development_profile_missing', async () => {
  let sendCalls = 0;
  const provider = new SillyTavernDevelopmentProvider({
    moduleLoader: async () => ({
      ConnectionManagerRequestService: {
        getProfile(profileId) {
          throw new Error(`Profile not found (ID: ${profileId})`);
        },
        async sendRequest() {
          sendCalls += 1;
          return { content: '{}' };
        },
      },
    }),
  });

  await assert.rejects(
    provider.sendReview({
      profileId: 'stale-profile-id',
      prompt: 'Review this NPC.',
      maxTokens: 1024,
    }),
    (error) => {
      assert.ok(error instanceof DevelopmentProviderError);
      assert.equal(error.code, 'development_profile_missing');
      assert.match(error.message, /no longer exists/i);
      assert.match(error.cause?.message || '', /Profile not found/);
      return true;
    },
  );
  assert.equal(sendCalls, 0, 'A missing profile must fail before any provider request is attempted.');
});

test('Development provider: null profile lookup maps to the same stable missing-profile code', async () => {
  const provider = new SillyTavernDevelopmentProvider({
    moduleLoader: async () => ({
      ConnectionManagerRequestService: {
        getProfile() {
          return null;
        },
        async sendRequest() {
          throw new Error('sendRequest should not run');
        },
      },
    }),
  });

  await assert.rejects(
    provider.sendReview({
      profileId: 'missing-profile-id',
      prompt: 'Review this NPC.',
      maxTokens: 1024,
    }),
    (error) => error instanceof DevelopmentProviderError && error.code === 'development_profile_missing',
  );
});
