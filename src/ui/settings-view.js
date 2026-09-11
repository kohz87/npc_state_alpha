/**
 * NPC State Alpha — thin settings view bound to the single contract registry.
 *
 * Connection-profile discovery follows the proven NPC State Beta 0.5.x UX
 * pattern, adapted to Alpha's own Development provider boundary. Alpha has no
 * runtime dependency on Beta and never reads provider credentials.
 */

import { escapeHtml } from './dom-utils.js';
import {
  ALPHA_SETTINGS_DEFAULTS,
  ALPHA_ADMISSION_POLICIES,
  normalizeAlphaSettings,
  validateAlphaSettings,
  DEVELOPMENT_MIN_CADENCE,
  DEVELOPMENT_MAX_CADENCE,
  DEVELOPMENT_REASONING_EFFORTS,
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

function profileLabel(profile) {
  const name = String(profile?.name || profile?.id || '').trim();
  const model = String(profile?.model || '').trim();
  return model && !name.toLocaleLowerCase().includes(model.toLocaleLowerCase()) ? `${name} · ${model}` : name;
}

export class SettingsView {
  constructor(options = {}) {
    this.getContext = options.getContext || (() => globalThis.SillyTavern?.getContext?.());
    this.getConnectionProfiles = options.getConnectionProfiles || (async () => ({
      available: false,
      profiles: [],
      error: 'Connection Profile listing is unavailable.',
    }));
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
    const selectedProfile = String(s.developmentConnectionProfile || '').trim();
    const initialProfileOptions = [
      '<option value="">Select a Connection Profile</option>',
      selectedProfile ? `<option value="${escapeHtml(selectedProfile)}" selected>Loading selected profile…</option>` : '',
    ].join('');
    const reasoningOptions = DEVELOPMENT_REASONING_EFFORTS.map((value) => {
      const label = value === 'auto' ? 'Profile / provider default' : `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
      return `<option value="${value}" ${s.developmentReasoningEffort === value ? 'selected' : ''}>${label}</option>`;
    }).join('');

    return `
      <div class="alpha-settings-container">
        <div class="alpha-view-heading">
          <span class="alpha-kicker">CONFIGURATION</span>
          <h3 class="alpha-settings-title">NPC State Alpha Settings</h3>
          <p class="alpha-settings-desc">Choose how NPCs are admitted, reviewed, displayed, and scored. Changes apply after Save Settings.</p>
        </div>

        <div class="alpha-settings-group">
          <h4 class="alpha-group-title">General</h4>
          <div class="alpha-setting-row alpha-setting-row-toggle">
            <div><strong>Enable NPC State Alpha</strong><div class="alpha-setting-help">Controls automatic One-Pass capture and Development scheduling for Alpha.</div></div>
            <label class="alpha-switch-label"><input type="checkbox" class="alpha-setting-enabled" ${s.enabled ? 'checked' : ''} /><span>Enabled</span></label>
          </div>
          <div class="alpha-setting-row">
            <div><label class="alpha-setting-label" for="alpha-setting-admission">Admission Policy</label><div class="alpha-setting-help">Controls which newly observed identities Alpha may admit automatically.</div></div>
            <select id="alpha-setting-admission" class="alpha-setting-admission">
              <option value="${ALPHA_ADMISSION_POLICIES.NAMED_PREFERRED}" ${s.admissionPolicy === ALPHA_ADMISSION_POLICIES.NAMED_PREFERRED ? 'selected' : ''}>Named preferred</option>
              <option value="${ALPHA_ADMISSION_POLICIES.BALANCED_UNIQUE_ROLE_LABEL}" ${s.admissionPolicy === ALPHA_ADMISSION_POLICIES.BALANCED_UNIQUE_ROLE_LABEL ? 'selected' : ''}>Balanced unique role-label</option>
              <option value="${ALPHA_ADMISSION_POLICIES.MANUAL_ONLY}" ${s.admissionPolicy === ALPHA_ADMISSION_POLICIES.MANUAL_ONLY ? 'selected' : ''}>Manual only</option>
            </select>
          </div>
          <div class="alpha-setting-row">
            <div><label class="alpha-setting-label" for="alpha-setting-budget">Routine dossier detail budget</label><div class="alpha-setting-help">Auto aims near four detailed existing dossiers but may expand for correctness. Numeric preference: ${ROUTINE_DOSSIER_BUDGET_MIN}–${ROUTINE_DOSSIER_BUDGET_MAX}.</div></div>
            <select id="alpha-setting-budget" class="alpha-setting-budget">${budgetOptions}</select>
          </div>
          <div class="alpha-setting-row alpha-setting-row-toggle">
            <div><strong>Show dossier diagnostics</strong><div class="alpha-setting-help">Shows technical Development status, ownership, source observations, and bookkeeping inside the dossier. Off keeps the dossier compact; diagnostics remain recorded.</div></div>
            <label class="alpha-switch-label"><input type="checkbox" class="alpha-setting-show-diagnostics" ${s.showDossierDiagnostics ? 'checked' : ''} /><span>${s.showDossierDiagnostics ? 'Shown' : 'Hidden'}</span></label>
          </div>
        </div>

        <div class="alpha-settings-group">
          <h4 class="alpha-group-title">Development Review</h4>
          <div class="alpha-setting-row alpha-setting-row-toggle">
            <div><strong>Enable Development review</strong><div class="alpha-setting-help">Runs focused asynchronous durable-profile review from owned evidence.</div></div>
            <label class="alpha-switch-label"><input type="checkbox" class="alpha-setting-dev-enabled" ${s.developmentEnabled ? 'checked' : ''} /><span>Enabled</span></label>
          </div>
          <div class="alpha-setting-row">
            <div><label class="alpha-setting-label" for="alpha-setting-cadence">Review cadence</label><div class="alpha-setting-help">Accepted immediate exchanges between ordinary existing-NPC reviews. Default ${ALPHA_SETTINGS_DEFAULTS.developmentCadence}; valid ${DEVELOPMENT_MIN_CADENCE}–${DEVELOPMENT_MAX_CADENCE}.</div></div>
            <input id="alpha-setting-cadence" type="number" min="${DEVELOPMENT_MIN_CADENCE}" max="${DEVELOPMENT_MAX_CADENCE}" class="alpha-setting-cadence" value="${s.developmentCadence}" />
          </div>
          <div class="alpha-setting-row alpha-profile-setting-row">
            <div><label class="alpha-setting-label" for="alpha-setting-profile">Development connection profile</label><div class="alpha-setting-help alpha-profile-help">Choose a supported SillyTavern Connection Manager profile. Alpha uses it only for Development review and never falls back silently.</div></div>
            <select id="alpha-setting-profile" class="alpha-setting-profile" data-selected-profile="${escapeHtml(selectedProfile)}">${initialProfileOptions}</select>
          </div>
          <div class="alpha-setting-row">
            <div><label class="alpha-setting-label" for="alpha-setting-reasoning">Development reasoning effort</label><div class="alpha-setting-help">Routine extraction defaults to Low to avoid runaway hidden reasoning. The request is sent through SillyTavern's supported reasoning-effort override; Auto leaves the profile/provider default untouched.</div></div>
            <select id="alpha-setting-reasoning" class="alpha-setting-reasoning">${reasoningOptions}</select>
          </div>
          <div class="alpha-setting-row">
            <div><label class="alpha-setting-label" for="alpha-setting-limit">Response allowance</label><div class="alpha-setting-help">Requested Development response-token allowance. Default ${ALPHA_SETTINGS_DEFAULTS.developmentResponseLimit}; valid ${DEVELOPMENT_MIN_RESPONSE_LIMIT}–${DEVELOPMENT_MAX_RESPONSE_LIMIT}.</div></div>
            <input id="alpha-setting-limit" type="number" min="${DEVELOPMENT_MIN_RESPONSE_LIMIT}" max="${DEVELOPMENT_MAX_RESPONSE_LIMIT}" class="alpha-setting-limit" value="${s.developmentResponseLimit}" />
          </div>
        </div>

        <div class="alpha-settings-group">
          <h4 class="alpha-group-title">Relationship Mechanics</h4>
          <div class="alpha-setting-row">
            <div><label class="alpha-setting-label" for="alpha-setting-score-cap">Per-axis absolute score cap</label><div class="alpha-setting-help">Maximum magnitude of each relationship score. Default ${ALPHA_SETTINGS_DEFAULTS.relationshipScoreCap}; valid ${RELATIONSHIP_SCORE_CAP_MIN}–${RELATIONSHIP_SCORE_CAP_MAX}.</div></div>
            <input id="alpha-setting-score-cap" type="number" min="${RELATIONSHIP_SCORE_CAP_MIN}" max="${RELATIONSHIP_SCORE_CAP_MAX}" class="alpha-setting-score-cap" value="${s.relationshipScoreCap}" />
          </div>
          <div class="alpha-setting-row">
            <div><label class="alpha-setting-label" for="alpha-setting-inertia">Inertia</label><div class="alpha-setting-help">Resistance to large score changes near the limit. Default ${ALPHA_SETTINGS_DEFAULTS.relationshipInertia}; valid ${RELATIONSHIP_INERTIA_MIN}–${RELATIONSHIP_INERTIA_MAX}.</div></div>
            <input id="alpha-setting-inertia" type="number" min="${RELATIONSHIP_INERTIA_MIN}" max="${RELATIONSHIP_INERTIA_MAX}" step="0.05" class="alpha-setting-inertia" value="${s.relationshipInertia}" />
          </div>
          <div class="alpha-setting-row">
            <div><label class="alpha-setting-label" for="alpha-setting-history-limit">Scoring history limit</label><div class="alpha-setting-help">Bounded retained scored-shift history. Default ${ALPHA_SETTINGS_DEFAULTS.relationshipHistoryLimit}; valid ${RELATIONSHIP_HISTORY_LIMIT_MIN}–${RELATIONSHIP_HISTORY_LIMIT_MAX}.</div></div>
            <input id="alpha-setting-history-limit" type="number" min="${RELATIONSHIP_HISTORY_LIMIT_MIN}" max="${RELATIONSHIP_HISTORY_LIMIT_MAX}" class="alpha-setting-history-limit" value="${s.relationshipHistoryLimit}" />
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

  async refreshConnectionProfiles(container) {
    const select = container?.querySelector?.('.alpha-setting-profile');
    if (!select) return { available: false, profiles: [], error: 'Profile selector is not mounted.' };

    const savedProfile = String(this.loadSettings().developmentConnectionProfile || '').trim();
    const selected = String(select.value || select.dataset?.selectedProfile || savedProfile || '').trim();
    const help = container.querySelector?.('.alpha-profile-help');
    if (help) help.textContent = 'Loading supported SillyTavern Connection Manager profiles…';

    let info;
    try {
      info = await this.getConnectionProfiles();
    } catch (error) {
      info = { available: false, profiles: [], error: error?.message || String(error) };
    }

    const profiles = Array.isArray(info?.profiles) ? info.profiles.filter((profile) => profile?.id && profile?.name) : [];
    const rows = profiles.map((profile) => ({ ...profile, id: String(profile.id), name: String(profile.name) }));
    if (selected && !rows.some((profile) => profile.id === selected)) {
      rows.push({ id: selected, name: `Unavailable profile · ${selected}`, model: null, unavailable: true });
    }

    const signature = JSON.stringify(rows.map((profile) => [profile.id, profile.name, profile.model || '', Boolean(profile.unavailable)]));
    if (select.dataset?.profileSignature !== signature) {
      select.innerHTML = [
        '<option value="">Select a Connection Profile</option>',
        ...rows.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profileLabel(profile))}</option>`),
      ].join('');
      if (select.dataset) select.dataset.profileSignature = signature;
    }
    select.value = selected && rows.some((profile) => profile.id === selected) ? selected : '';
    if (select.dataset) select.dataset.selectedProfile = select.value;
    select.disabled = info?.available === false && rows.length === 0;
    select.title = info?.available === false ? String(info?.error || 'Connection Profiles are unavailable.') : '';

    if (help) {
      if (info?.available === false) {
        help.textContent = `Connection Profiles unavailable: ${info?.error || 'SillyTavern did not expose a supported profile list.'}`;
      } else if (selected && !profiles.some((profile) => profile.id === selected)) {
        help.textContent = 'The saved Development profile is no longer available. Choose another profile and Save Settings.';
      } else if (profiles.length === 0) {
        help.textContent = 'No supported Connection Manager profiles were found. Create one in SillyTavern, then focus this selector to refresh it.';
      } else {
        help.textContent = `${profiles.length} supported Connection Manager profile${profiles.length === 1 ? '' : 's'} available. Alpha uses the selected profile only for Development review.`;
      }
    }
    return { ...info, profiles };
  }

  bindEvents(container) {
    if (!container) return;
    const profileSelect = container.querySelector('.alpha-setting-profile');
    profileSelect?.addEventListener('focus', () => { void this.refreshConnectionProfiles(container); });
    profileSelect?.addEventListener('change', (event) => {
      if (event.target?.dataset) event.target.dataset.selectedProfile = event.target.value || '';
    });
    void this.refreshConnectionProfiles(container);

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
        developmentReasoningEffort: container.querySelector('.alpha-setting-reasoning')?.value,
        routineDossierDetailBudget: budgetRaw === 'auto' ? 'auto' : Number(budgetRaw),
        showDossierDiagnostics: Boolean(container.querySelector('.alpha-setting-show-diagnostics')?.checked),
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
