import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DevelopmentProviderError,
  SillyTavernDevelopmentProvider,
} from '../src/host/development-provider.js';

test('Development provider: lists only host-supported profiles as sorted UI metadata', async () => {
  let listCalls = 0;
  const provider = new SillyTavernDevelopmentProvider({
    moduleLoader: async () => ({
      ConnectionManagerRequestService: {
        getSupportedProfiles() {
          listCalls += 1;
          return [
            { id: 'zeta', name: 'Zeta Fast', api: 'openai', model: 'gemini-3.8-flash', secret: 'must-not-leak' },
            { id: 'alpha', name: 'Alpha Deep', api: 'openai', model: 'gpt-5.6-sol' },
            { id: '', name: 'Broken' },
          ];
        },
        getProfile() { return null; },
        async sendRequest() { return { content: '{}' }; },
      },
    }),
  });

  const result = await provider.listSupportedProfiles();
  assert.equal(result.available, true);
  assert.equal(listCalls, 1);
  assert.deepEqual(result.profiles, [
    { id: 'alpha', name: 'Alpha Deep', api: 'openai', model: 'gpt-5.6-sol' },
    { id: 'zeta', name: 'Zeta Fast', api: 'openai', model: 'gemini-3.8-flash' },
  ]);
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false, 'Profile UI metadata must not expose unrelated host fields.');
});

test('Development provider: profile listing fails visibly when Connection Manager listing is unavailable', async () => {
  const provider = new SillyTavernDevelopmentProvider({
    moduleLoader: async () => ({
      ConnectionManagerRequestService: {
        getProfile() { return null; },
        async sendRequest() { return { content: '{}' }; },
      },
    }),
  });

  const result = await provider.listSupportedProfiles();
  assert.equal(result.available, false);
  assert.deepEqual(result.profiles, []);
  assert.equal(result.reason, 'connection_manager_profile_listing_unavailable');
  assert.match(result.error, /profile listing/i);
});

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
