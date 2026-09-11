import test from 'node:test';
import assert from 'node:assert/strict';
import { SettingsView } from '../src/ui/settings-view.js';
import { DossierView } from '../src/ui/dossier-view.js';
import { UIController } from '../src/ui/controller.js';
import { createDefaultNpcRecord } from '../src/state/schema.js';
import { ALPHA_SETTINGS_DEFAULTS } from '../src/contract/settings.js';

function settingsContext(profileId = null) {
  return {
    extensionSettings: {
      npc_state_alpha: {
        ...ALPHA_SETTINGS_DEFAULTS,
        developmentConnectionProfile: profileId,
      },
    },
    saveSettingsDebounced() {},
  };
}

test('SettingsView: Development profile is a real select instead of free-form text', () => {
  const view = new SettingsView({ getContext: () => settingsContext('profile-a') });
  const html = view.render();
  assert.match(html, /<select id="alpha-setting-profile" class="alpha-setting-profile"/);
  assert.doesNotMatch(html, /<input id="alpha-setting-profile"/);
  assert.match(html, /Loading selected profile/);
});

test('SettingsView: routine Development defaults to low reasoning and dossier diagnostics default hidden', () => {
  const view = new SettingsView({ getContext: () => settingsContext() });
  const settings = view.loadSettings();
  const html = view.render(settings);
  assert.equal(settings.developmentReasoningEffort, 'low');
  assert.equal(settings.showDossierDiagnostics, false);
  assert.match(html, /Development reasoning effort/);
  assert.match(html, /value="low" selected/);
  assert.match(html, /Show dossier diagnostics/);
});

test('SettingsView: supported Connection Manager profiles populate selector and preserve selection', async () => {
  const context = settingsContext('profile-b');
  const select = {
    value: 'profile-b',
    dataset: { selectedProfile: 'profile-b' },
    innerHTML: '',
    disabled: false,
    title: '',
  };
  const help = { textContent: '' };
  const container = {
    querySelector(selector) {
      if (selector === '.alpha-setting-profile') return select;
      if (selector === '.alpha-profile-help') return help;
      return null;
    },
  };
  const view = new SettingsView({
    getContext: () => context,
    getConnectionProfiles: async () => ({
      available: true,
      profiles: [
        { id: 'profile-b', name: 'Fast Review', model: 'gemini-3.8-flash' },
        { id: 'profile-a', name: 'Deep Review', model: 'gpt-5.6-sol' },
      ],
      error: '',
    }),
  });

  const result = await view.refreshConnectionProfiles(container);
  assert.equal(result.available, true);
  assert.match(select.innerHTML, /Deep Review · gpt-5\.6-sol/);
  assert.match(select.innerHTML, /Fast Review · gemini-3\.8-flash/);
  assert.equal(select.value, 'profile-b');
  assert.equal(select.disabled, false);
  assert.match(help.textContent, /2 supported Connection Manager profiles/);
});

test('SettingsView: stale saved profile remains visible as unavailable until user replaces it', async () => {
  const context = settingsContext('deleted-profile');
  const select = {
    value: 'deleted-profile',
    dataset: { selectedProfile: 'deleted-profile' },
    innerHTML: '',
    disabled: false,
    title: '',
  };
  const help = { textContent: '' };
  const container = {
    querySelector(selector) {
      if (selector === '.alpha-setting-profile') return select;
      if (selector === '.alpha-profile-help') return help;
      return null;
    },
  };
  const view = new SettingsView({
    getContext: () => context,
    getConnectionProfiles: async () => ({ available: true, profiles: [], error: '' }),
  });

  await view.refreshConnectionProfiles(container);
  assert.match(select.innerHTML, /Unavailable profile · deleted-profile/);
  assert.equal(select.value, 'deleted-profile');
  assert.match(help.textContent, /saved Development profile is no longer available/);
});

test('UIController: Settings profile discovery uses the active Development provider boundary', async () => {
  let calls = 0;
  const queue = {
    provider: {
      async listSupportedProfiles() {
        calls += 1;
        return { available: true, profiles: [{ id: 'p1', name: 'Profile One', model: 'model-1' }], error: '' };
      },
    },
  };
  const controller = new UIController({
    adapter: { getContext: () => settingsContext() },
    developmentQueue: queue,
  });
  const result = await controller.settingsView.getConnectionProfiles();
  assert.equal(calls, 1);
  assert.equal(result.profiles[0].id, 'p1');
});

test('DossierView: compact default surface uses portrait-first layout and real relationship meters', () => {
  const npc = createDefaultNpcRecord('mirelle', 'Mirelle');
  npc.role = 'Waystation clerk';
  npc.currentPresentation = 'Ink-stained sleeves';
  npc.activeInExchange = true;
  npc.offscreenActivity = 'Sorting manifests';
  npc.relationship.trust = 25;
  const html = new DossierView().render({ npcs: { mirelle: npc }, pendingReview: { entries: [] } }, 'mirelle');
  assert.match(html, /alpha-dossier-hero/);
  assert.match(html, /alpha-hero-media/);
  assert.match(html, /alpha-dossier-document/);
  assert.match(html, /alpha-cast-dock/);
  assert.match(html, /DOSSIER LIBRARY/);
  assert.match(html, /Attach Portrait/);
  assert.match(html, /type="file"/);
  assert.match(html, /alpha-rel-track/);
  assert.match(html, /role="meter"/);
  assert.match(html, /25\.00/);
  assert.match(html, /Ink-stained sleeves/);
  assert.match(html, /Show Diagnostics/);
  assert.doesNotMatch(html, />Exchange active</);
  assert.doesNotMatch(html, />Current form ID</);
  assert.doesNotMatch(html, />Development Status</);
  assert.doesNotMatch(html, />Development Evidence</);
});

test('DossierView: dossier-local diagnostics are opt-in and reveal technical bookkeeping without changing state', () => {
  const npc = createDefaultNpcRecord('mirelle', 'Mirelle');
  npc.activeInExchange = true;
  const html = new DossierView().render(
    { npcs: { mirelle: npc }, pendingReview: { entries: [] } },
    'mirelle',
    {},
    { showDiagnostics: true },
  );
  assert.match(html, /Hide Diagnostics/);
  assert.match(html, />Technical State</);
  assert.match(html, />Exchange active</);
  assert.match(html, />Development Status</);
  assert.match(html, />User Ownership</);
  assert.match(html, />Development Evidence</);
});
