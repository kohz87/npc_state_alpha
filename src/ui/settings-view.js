/**
 * NPC State Alpha — thin settings view bound to the single contract registry.
 */

import { escapeHtml } from './dom-utils.js';
import {
  ALPHA_SETTINGS_DEFAULTS,
  ALPHA_ADMISSION_POLICIES,
  normalizeAlphaSettings,
  validateAlphaSettings,
  DEVELOPMENT_MIN_CADENCE,
  DEVELOPMENT_MAX_CADENCE,
  ROUTINE_DOSSIER_BUDGET_MIN,
  ROUTINE_DOSSIER_BUDGET_MAX,
  DEVELOPMENT_MIN_RESPONSE_LIMIT,
  DEVELOPMENT_MAX_RESPONSE_LIMIT,
  RELATIONSHIP_SCORE_CAP_MIN,
  RELATIONSHIP_SCORE_CAP_MAX,
  RELATIONSHIP_INERTIA_MIN,
  RELATIONSHIP_INERTIA_MAX,
  RELATIONSHIP_HISTORY_LIMIT_MIN,
  RELATIONSHIP_HISTORY_LIMIT_MAX,
} from '../contract/settings.js';

function numberValue(container, selector) {
  const raw = container.querySelector(selector)?.value;
  return raw === undefined || raw === '' ? Number.NaN : Number(raw);
}

export class SettingsView {
  constructor(options = {}) {
    this.getContext = options.getContext || (() => globalThis.SillyTavern?.getContext?.());
    this.onSaved = options.onSaved || (() => {});
    this.onError = options.onError || (() => {});
  }

  loadSettings() {
    const ctx = this.getContext?.();
    return normalizeAlphaSettings(ctx?.extensionSettings?.npc_state_alpha || {});
  }

  /** Strict user-facing save. Invalid explicit values are rejected, never silently clamped. */
  saveSettings(updatedSettings) {
    const current = this.loadSettings();
    const candidate = {
      ...current,
      ...(updatedSettings || {}),
    };
    const validation = validateAlphaSettings(candidate, { partial: false });
    if (!validation.valid) {
      const error = validation.errors.join(' ');
      this.onError(error);
      return { success: false, error, errors: validation.errors };
    }

    const ctx = this.getContext?.();
    if (!ctx) {
      const error = 'SillyTavern settings context is unavailable.';
      this.onError(error);
      return { success: false, error };
    }
    if (!ctx.extensionSettings) ctx.extensionSettings = {};
    const normalized = normalizeAlphaSettings(candidate);
    ctx.extensionSettings.npc_state_alpha = { ...normalized };
    ctx.saveSettingsDebounced?.();
    this.onSaved(normalized);
    return { success: true, settings: normalized };
  }

  render(currentSettings = null) {
    const s = currentSettings ? normalizeAlphaSettings(currentSettings) : this.loadSettings();
    const budgetOptions = [
      `<option value="auto" ${s.routineDossierDetailBudget === 'auto' ? 'selected' : ''}>Auto</option>`,
      ...Array.from({ length: ROUTINE_DOSSIER_BUDGET_MAX - ROUTINE_DOSSIER_BUDGET_MIN + 1 }, (_, i) => {
        const value = ROUTINE_DOSSIER_BUDGET_MIN + i;
        return `<option value="${value}" ${s.routineDossierDetailBudget === value ? 'selected' : ''}>${value}</option>`;
      }),
    ].join('');

    return `
      <div class="alpha-settings-container">
        <h3 class="alpha-settings-title">NPC State Alpha Settings</h3>
        <p class="alpha-settings-desc">Choose how NPCs are tracked and when their profiles are reviewed.</p>

        <div class="alpha-settings-group">
          <h4 class="alpha-group-title">General</h4>
          <div class="alpha-setting-row">
            <label class="alpha-checkbox-label"><input type="checkbox" class="alpha-setting-enabled" ${s.enabled ? 'checked' : ''} /> <strong>Enable NPC State Alpha</strong></label>
            <div class="alpha-setting-help">Controls automatic One-Pass capture and Development scheduling for Alpha.</div>
          </div>
          <div class="alpha-setting-row">
            <label class="alpha-setting-label" for="alpha-setting-admission">Admission Policy</label>
            <select id="alpha-setting-admission" class="alpha-setting-admission">
              <option value="${ALPHA_ADMISSION_POLICIES.NAMED_PREFERRED}" ${s.admissionPolicy === ALPHA_ADMISSION_POLICIES.NAMED_PREFERRED ? 'selected' : ''}>Named preferred</option>
              <option value="${ALPHA_ADMISSION_POLICIES.BALANCED_UNIQUE_ROLE_LABEL}" ${s.admissionPolicy === ALPHA_ADMISSION_POLICIES.BALANCED_UNIQUE_ROLE_LABEL ? 'selected' : ''}>Balanced unique role-label</option>
              <option value="${ALPHA_ADMISSION_POLICIES.MANUAL_ONLY}" ${s.admissionPolicy === ALPHA_ADMISSION_POLICIES.MANUAL_ONLY ? 'selected' : ''}>Manual only</option>
            </select>
          </div>
          <div class="alpha-setting-row">
            <label class="alpha-setting-label" for="alpha-setting-budget">Routine dossier detail budget</label>
            <select id="alpha-setting-budget" class="alpha-setting-budget">${budgetOptions}</select>
            <div class="alpha-setting-help">Auto aims near four detailed existing dossiers but may expand for correctness. Numeric preference: ${ROUTINE_DOSSIER_BUDGET_MIN}–${ROUTINE_DOSSIER_BUDGET_MAX}.</div>
          </div>
        </div>

        <div class="alpha-settings-group">
          <h4 class="alpha-group-title">Development Review</h4>
          <div class="alpha-setting-row">
            <label class="alpha-checkbox-label"><input type="checkbox" class="alpha-setting-dev-enabled" ${s.developmentEnabled ? 'checked' : ''} /> <strong>Enable Development review</strong></label>
          </div>
          <div class="alpha-setting-row">
            <label class="alpha-setting-label" for="alpha-setting-cadence">Review cadence</label>
            <input id="alpha-setting-cadence" type="number" min="${DEVELOPMENT_MIN_CADENCE}" max="${DEVELOPMENT_MAX_CADENCE}" class="alpha-setting-cadence" value="${s.developmentCadence}" />
            <div class="alpha-setting-help">Accepted immediate exchanges between ordinary existing-NPC reviews. Default ${ALPHA_SETTINGS_DEFAULTS.developmentCadence}; valid ${DEVELOPMENT_MIN_CADENCE}–${DEVELOPMENT_MAX_CADENCE}.</div>
          </div>
          <div class="alpha-setting-row">
            <label class="alpha-setting-label" for="alpha-setting-profile">Development connection profile</label>
            <input id="alpha-setting-profile" type="text" class="alpha-setting-profile" value="${escapeHtml(s.developmentConnectionProfile || '')}" placeholder="Select/configure an explicit host profile" />
            <div class="alpha-setting-help">Blank leaves Development paused when the provider requires an explicit profile. Alpha does not silently fall back to another route.</div>
          </div>
          <div class="alpha-setting-row">
            <label class="alpha-setting-label" for="alpha-setting-limit">Response allowance</label>
            <input id="alpha-setting-limit" type="number" min="${DEVELOPMENT_MIN_RESPONSE_LIMIT}" max="${DEVELOPMENT_MAX_RESPONSE_LIMIT}" class="alpha-setting-limit" value="${s.developmentResponseLimit}" />
            <div class="alpha-setting-help">Requested Development response-token allowance. Default ${ALPHA_SETTINGS_DEFAULTS.developmentResponseLimit}; valid ${DEVELOPMENT_MIN_RESPONSE_LIMIT}–${DEVELOPMENT_MAX_RESPONSE_LIMIT}.</div>
          </div>
        </div>

        <div class="alpha-settings-group">
          <h4 class="alpha-group-title">Relationship Mechanics</h4>
          <div class="alpha-setting-row">
            <label class="alpha-setting-label" for="alpha-setting-score-cap">Per-axis absolute score cap</label>
            <input id="alpha-setting-score-cap" type="number" min="${RELATIONSHIP_SCORE_CAP_MIN}" max="${RELATIONSHIP_SCORE_CAP_MAX}" class="alpha-setting-score-cap" value="${s.relationshipScoreCap}" />
            <div class="alpha-setting-help">Maximum magnitude of each relationship score. Default ${ALPHA_SETTINGS_DEFAULTS.relationshipScoreCap}; valid ${RELATIONSHIP_SCORE_CAP_MIN}–${RELATIONSHIP_SCORE_CAP_MAX}.</div>
          </div>
          <div class="alpha-setting-row">
            <label class="alpha-setting-label" for="alpha-setting-inertia">Inertia</label>
            <input id="alpha-setting-inertia" type="number" min="${RELATIONSHIP_INERTIA_MIN}" max="${RELATIONSHIP_INERTIA_MAX}" step="0.05" class="alpha-setting-inertia" value="${s.relationshipInertia}" />
            <div class="alpha-setting-help">Resistance to large score changes near the limit. Default ${ALPHA_SETTINGS_DEFAULTS.relationshipInertia}; valid ${RELATIONSHIP_INERTIA_MIN}–${RELATIONSHIP_INERTIA_MAX}.</div>
          </div>
          <div class="alpha-setting-row">
            <label class="alpha-setting-label" for="alpha-setting-history-limit">Scoring history limit</label>
            <input id="alpha-setting-history-limit" type="number" min="${RELATIONSHIP_HISTORY_LIMIT_MIN}" max="${RELATIONSHIP_HISTORY_LIMIT_MAX}" class="alpha-setting-history-limit" value="${s.relationshipHistoryLimit}" />
            <div class="alpha-setting-help">Bounded retained scored-shift history. Default ${ALPHA_SETTINGS_DEFAULTS.relationshipHistoryLimit}; valid ${RELATIONSHIP_HISTORY_LIMIT_MIN}–${RELATIONSHIP_HISTORY_LIMIT_MAX}.</div>
          </div>
        </div>

        <div class="alpha-settings-actions">
          <button type="button" class="alpha-btn alpha-btn-secondary alpha-btn-reset-settings">Reset to Defaults</button>
          <button type="button" class="alpha-btn alpha-btn-primary alpha-btn-save-settings">Save Settings</button>
        </div>
        <div class="alpha-settings-feedback" style="display:none;"></div>
      </div>
    `;
  }

  bindEvents(container) {
    if (!container) return;
    const saveBtn = container.querySelector('.alpha-btn-save-settings');
    saveBtn?.addEventListener('click', () => {
      const budgetRaw = container.querySelector('.alpha-setting-budget')?.value;
      const payload = {
        enabled: Boolean(container.querySelector('.alpha-setting-enabled')?.checked),
        admissionPolicy: container.querySelector('.alpha-setting-admission')?.value,
        developmentEnabled: Boolean(container.querySelector('.alpha-setting-dev-enabled')?.checked),
        developmentCadence: numberValue(container, '.alpha-setting-cadence'),
        developmentConnectionProfile: container.querySelector('.alpha-setting-profile')?.value?.trim() || null,
        developmentResponseLimit: numberValue(container, '.alpha-setting-limit'),
        routineDossierDetailBudget: budgetRaw === 'auto' ? 'auto' : Number(budgetRaw),
        relationshipScoreCap: numberValue(container, '.alpha-setting-score-cap'),
        relationshipInertia: numberValue(container, '.alpha-setting-inertia'),
        relationshipHistoryLimit: numberValue(container, '.alpha-setting-history-limit'),
      };
      const result = this.saveSettings(payload);
      this._showFeedback(container, result.success ? 'Settings saved.' : result.error, result.success ? 'success' : 'error');
    });

    container.querySelector('.alpha-btn-reset-settings')?.addEventListener('click', () => {
      const result = this.saveSettings(ALPHA_SETTINGS_DEFAULTS);
      if (!result.success) {
        this._showFeedback(container, result.error, 'error');
        return;
      }
      container.innerHTML = this.render(result.settings);
      this.bindEvents(container);
      this._showFeedback(container, 'Settings reset to canonical defaults.', 'info');
    });
  }

  _showFeedback(container, msg, type = 'info') {
    const feedback = container?.querySelector('.alpha-settings-feedback');
    if (!feedback) return;
    feedback.style.display = 'block';
    feedback.className = `alpha-settings-feedback alpha-status-${type}`;
    feedback.textContent = msg;
  }
}
