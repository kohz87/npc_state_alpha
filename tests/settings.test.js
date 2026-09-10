import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ALPHA_SETTINGS_DEFAULTS,
  ALPHA_ADMISSION_POLICIES,
  ALPHA_SETTING_KEYS,
  normalizeAlphaSettings,
  validateAlphaSettings,
  RELATIONSHIP_SCORE_CAP_DEFAULT,
  RELATIONSHIP_INERTIA_DEFAULT,
  RELATIONSHIP_HISTORY_LIMIT_DEFAULT,
} from '../src/contract/settings.js';

test('Settings Contract: single registry contains the complete S5 defaults', () => {
  assert.equal(ALPHA_SETTINGS_DEFAULTS.enabled, true);
  assert.equal(ALPHA_SETTINGS_DEFAULTS.admissionPolicy, ALPHA_ADMISSION_POLICIES.NAMED_PREFERRED);
  assert.equal(ALPHA_SETTINGS_DEFAULTS.developmentEnabled, true);
  assert.equal(ALPHA_SETTINGS_DEFAULTS.developmentCadence, 3);
  assert.equal(ALPHA_SETTINGS_DEFAULTS.routineDossierDetailBudget, 'auto');
  assert.equal(ALPHA_SETTINGS_DEFAULTS.developmentConnectionProfile, null);
  assert.equal(ALPHA_SETTINGS_DEFAULTS.developmentResponseLimit, 1600);
  assert.equal(ALPHA_SETTINGS_DEFAULTS.relationshipScoreCap, RELATIONSHIP_SCORE_CAP_DEFAULT);
  assert.equal(ALPHA_SETTINGS_DEFAULTS.relationshipScoreCap, 1000);
  assert.equal(ALPHA_SETTINGS_DEFAULTS.relationshipInertia, RELATIONSHIP_INERTIA_DEFAULT);
  assert.equal(ALPHA_SETTINGS_DEFAULTS.relationshipInertia, 0);
  assert.equal(ALPHA_SETTINGS_DEFAULTS.relationshipHistoryLimit, RELATIONSHIP_HISTORY_LIMIT_DEFAULT);
  assert.equal(ALPHA_SETTINGS_DEFAULTS.relationshipHistoryLimit, 20);
  assert.ok(ALPHA_SETTING_KEYS.includes('routineDossierDetailBudget'));
  assert.ok(!ALPHA_SETTING_KEYS.includes('routineDossierBudget'));
});

test('Settings Contract: load/runtime normalization is fail-safe and bounded', () => {
  assert.equal(normalizeAlphaSettings({ developmentCadence: -2 }).developmentCadence, 1);
  assert.equal(normalizeAlphaSettings({ developmentCadence: 99 }).developmentCadence, 10);
  assert.equal(normalizeAlphaSettings({ relationshipScoreCap: 5 }).relationshipScoreCap, 10);
  assert.equal(normalizeAlphaSettings({ relationshipScoreCap: 5000 }).relationshipScoreCap, 1000);
  assert.equal(normalizeAlphaSettings({ relationshipScoreCap: 'invalid' }).relationshipScoreCap, 1000);
  assert.equal(normalizeAlphaSettings({ relationshipInertia: -0.5 }).relationshipInertia, 0);
  assert.equal(normalizeAlphaSettings({ relationshipInertia: 1.5 }).relationshipInertia, 1);
  assert.equal(normalizeAlphaSettings({ relationshipInertia: 'bad' }).relationshipInertia, 0);
  assert.equal(normalizeAlphaSettings({ relationshipHistoryLimit: 0 }).relationshipHistoryLimit, 1);
  assert.equal(normalizeAlphaSettings({ relationshipHistoryLimit: 500 }).relationshipHistoryLimit, 100);
  assert.equal(normalizeAlphaSettings({ routineDossierDetailBudget: 99 }).routineDossierDetailBudget, 20);
});

test('Settings Contract: explicit user input is rejected rather than silently normalized', () => {
  const invalid = validateAlphaSettings({
    ...ALPHA_SETTINGS_DEFAULTS,
    developmentCadence: 99,
    routineDossierDetailBudget: 0,
    relationshipInertia: -1,
  }, { partial: false });
  assert.equal(invalid.valid, false);
  assert.ok(invalid.errors.some((error) => error.includes('developmentCadence')));
  assert.ok(invalid.errors.some((error) => error.includes('routineDossierDetailBudget')));
  assert.ok(invalid.errors.some((error) => error.includes('relationshipInertia')));

  const valid = validateAlphaSettings({
    ...ALPHA_SETTINGS_DEFAULTS,
    routineDossierDetailBudget: 7,
    developmentCadence: 5,
  }, { partial: false });
  assert.equal(valid.valid, true, valid.errors.join('; '));
});
