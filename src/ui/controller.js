/**
 * NPC State Alpha — thin S5 UI controller.
 *
 * The controller owns DOM lifecycle only. All mutations flow through the shared
 * adapter, Development queue, or user-command/CommitCoordinator path.
 */

import { DossierView } from './dossier-view.js';
import { NpcEditor } from './editor.js';
import { SettingsView } from './settings-view.js';
import { DiagnosticsView } from './diagnostics-view.js';
import { escapeHtml } from './dom-utils.js';
import { ALPHA_UI_STYLES } from './styles.js';
import { setPortrait } from '../runtime/user-commands.js';
import { SillyTavernPortraitUploader } from '../host/portrait-upload.js';

export class UIController {
  constructor(options = {}) {
    this.adapter = options.adapter || null;
    this.storage = options.storage || this.adapter?.storage || null;
    this.coordinator = options.coordinator || this.adapter?.coordinator || null;
    this.developmentQueue = options.developmentQueue || this.adapter?.developmentReview || null;
    this.diagnostics = options.diagnostics || this.adapter?.diagnostics || null;
    this.portraitUploader = options.portraitUploader || new SillyTavernPortraitUploader();

    this.dossierView = new DossierView({
      onSelect: (id) => this.selectNpc(id),
      onEdit: (id) => this.startEditing(id),
      onRecheckMissing: (id) => this.recheckMissing(id),
      onRefreshDossier: (id) => this.refreshDossier(id),
      onPortraitFile: (id, file) => this.uploadPortrait(id, file),
      onToggleDiagnostics: () => this.toggleDossierDiagnostics(),
    });
    this.dossierView.onFilterChanged = () => this.render();
    this.editor = new NpcEditor({
      coordinator: this.coordinator,
      onSaved: ({ deleted, npcId } = {}) => {
        if (deleted) this.selectedNpcId = null;
        this.editingNpcId = null;
        this.showStatus(deleted ? `NPC '${npcId}' deleted.` : `NPC '${npcId}' updated.`, 'success');
        this.reloadAndRender();
      },
      onCancel: () => { this.editingNpcId = null; this.render(); },
      onError: (error) => this.showStatus(error, 'error'),
    });
    this.settingsView = new SettingsView({
      getContext: () => this.adapter?.getContext?.(),
      getConnectionProfiles: async () => {
        const provider = this.developmentQueue?.provider;
        if (typeof provider?.listSupportedProfiles === 'function') return provider.listSupportedProfiles();
        return {
          available: false,
          profiles: [],
          error: 'Development Connection Profile provider is unavailable.',
        };
      },
      onSaved: (settings) => {
        this.adapter?.applyRuntimeSettings?.(settings);
        this.showStatus('Settings saved.', 'success');
      },
      onError: (error) => this.showStatus(error, 'error'),
    });
    this.diagnosticsView = new DiagnosticsView({ diagnostics: this.diagnostics, onRefresh: () => this.render() });

    this.activeTab = 'dossier';
    this.selectedNpcId = null;
    this.editingNpcId = null;
    this.cachedState = null;
    this.cachedRevision = 0;
    this.statusMessage = null;
    this.rootElement = null;
    this.mounted = false;
    this.panelOpen = false;
    this.dirtyWhileClosed = true;
    this._listeners = [];
    this._queueUnsubscribe = null;
  }

  mount(parentContainer = null) {
    if (typeof document === 'undefined' || this.mounted) return;
    this._injectStyles();
    let root = document.getElementById('npc-state-alpha-root');
    if (!root) {
      root = document.createElement('div');
      root.id = 'npc-state-alpha-root';
      (parentContainer || document.body).appendChild(root);
    }
    this.rootElement = root;
    this.mounted = true;
    this._bindHostEvents();
    this._bindDevelopmentEvents();
    this.render();
  }

  unmount() {
    this._unbindListeners();
    this._unbindDevelopmentEvents();
    this.rootElement?.remove?.();
    this.rootElement = null;
    this.mounted = false;
  }

  destroy() {
    this.unmount();
    this.cachedState = null;
    this.selectedNpcId = null;
    this.editingNpcId = null;
    this.panelOpen = false;
  }

  async open() {
    this.panelOpen = true;
    await this.reloadAndRender();
  }

  close() {
    this.panelOpen = false;
    this.editingNpcId = null;
    this.render();
  }

  _bindHostEvents() {
    this._unbindListeners();
    const ctx = this.adapter?.getContext?.();
    const source = ctx?.eventSource;
    const types = ctx?.eventTypes;
    if (!source?.on || !types) return;

    const chatEvent = types.CHAT_CHANGED || types.CHAT_LOADED;
    if (chatEvent) {
      const handler = () => this.onChatChanged();
      source.on(chatEvent, handler);
      this._listeners.push({ target: source, event: chatEvent, handler });
    }
    if (types.CHARACTER_MESSAGE_RENDERED) {
      const handler = () => {
        if (this.panelOpen) this.reloadAndRender();
        else this.dirtyWhileClosed = true;
      };
      source.on(types.CHARACTER_MESSAGE_RENDERED, handler);
      this._listeners.push({ target: source, event: types.CHARACTER_MESSAGE_RENDERED, handler });
    }
  }

  _bindDevelopmentEvents() {
    this._unbindDevelopmentEvents();
    if (typeof this.developmentQueue?.subscribe !== 'function') return;
    this._queueUnsubscribe = this.developmentQueue.subscribe(({ chatId } = {}) => {
      const activeChatId = this.storage?.getChatId?.() || null;
      if (chatId && activeChatId && chatId !== activeChatId) return;
      if (this.panelOpen) this.reloadAndRender().catch(() => {});
      else this.dirtyWhileClosed = true;
    });
  }

  _unbindDevelopmentEvents() {
    try { this._queueUnsubscribe?.(); } catch {}
    this._queueUnsubscribe = null;
  }

  _unbindListeners() {
    for (const { target, event, handler } of this._listeners) {
      try { target?.off?.(event, handler); } catch {}
    }
    this._listeners = [];
  }

  async onChatChanged() {
    this.selectedNpcId = null;
    this.editingNpcId = null;
    this.statusMessage = null;
    this.cachedState = null;
    this.cachedRevision = 0;
    this.dirtyWhileClosed = true;
    if (this.panelOpen) await this.reloadAndRender();
    else this.render();
  }

  hasActiveChat() {
    return typeof this.storage?.getChatId === 'function' ? Boolean(this.storage.getChatId()) : false;
  }

  _requireActiveChat() {
    if (this.hasActiveChat()) return true;
    this.showStatus('Open a character or group chat to review NPCs. Settings are available now.', 'info');
    return false;
  }

  async reloadAndRender() {
    if (!this.storage) return;
    if (!this.hasActiveChat()) {
      this.cachedState = null;
      this.cachedRevision = 0;
      this.selectedNpcId = null;
      this.editingNpcId = null;
      this.statusMessage = null;
      this.render();
      return;
    }
    try {
      const loaded = await this.storage.load();
      this.cachedState = loaded.state;
      this.cachedRevision = loaded.revision;
      this.dirtyWhileClosed = false;
    } catch (error) {
      this.statusMessage = { text: `Failed to load Alpha state: ${error?.message || error}`, type: 'error' };
    }
    this.render();
  }

  selectNpc(id) { this.selectedNpcId = id; this.editingNpcId = null; this.render(); }
  startEditing(id) { this.editingNpcId = id; this.render(); }
  showStatus(text, type = 'info') { this.statusMessage = { text: String(text), type }; this.render(); }

  async uploadPortrait(id, file) {
    if (!this._requireActiveChat()) return;
    if (!id || !file || !this.coordinator || !this.storage) {
      this.showStatus('Portrait upload is unavailable.', 'error');
      return;
    }
    const npcName = this.cachedState?.npcs?.[id]?.name || id;
    this.showStatus(`Uploading portrait for ${npcName}…`, 'info');
    try {
      const portrait = await this.portraitUploader.upload(file, { npcId: id, npcName });
      const loaded = await this.storage.load();
      if (!loaded.state?.npcs?.[id]) throw new Error(`NPC '${id}' no longer exists.`);
      const result = await setPortrait(this.coordinator, {
        npcId: id,
        portrait,
        expectedRevision: loaded.revision,
      });
      if (result?.success === false) throw new Error(result.error || 'Portrait update was rejected.');
      this.showStatus(`Portrait updated for ${npcName}.`, 'success');
      await this.reloadAndRender();
    } catch (error) {
      this.showStatus(`Portrait upload failed: ${error?.message || error}`, 'error');
    }
  }

  toggleDossierDiagnostics() {
    const current = this.settingsView.loadSettings();
    const result = this.settingsView.saveSettings({ showDossierDiagnostics: !current.showDossierDiagnostics });
    if (!result.success) return;
    this.render();
  }

  async reviewPending() { await this._runDevelopmentAction('Review pending', () => this.developmentQueue?.reviewPending?.()); }
  async retryFailed() { await this._runDevelopmentAction('Retry failed review', () => this.developmentQueue?.retryFailed?.()); }
  async recheckMissing(id) { await this._runDevelopmentAction('Recheck missing', () => this.developmentQueue?.recheckMissingDetails?.(id)); }
  async refreshDossier(id) { await this._runDevelopmentAction('Refresh dossier', () => this.developmentQueue?.refreshDossier?.(id)); }

  async _runDevelopmentAction(label, action) {
    if (!this._requireActiveChat()) return;
    const ownershipConflict = this.adapter?.getOwnershipConflict?.();
    if (ownershipConflict) {
      this.showStatus(`Development review is paused while competing continuity owner '${ownershipConflict.name || 'unknown'}' is enabled.`, 'error');
      return;
    }
    if (!this.developmentQueue || typeof action !== 'function') {
      this.showStatus('Development review queue is unavailable.', 'error');
      return;
    }
    this.showStatus(`${label} started…`, 'info');
    try {
      const result = await action();
      const status = result?.status || 'unknown';
      const failed = result?.success === false || ['provider_failed', 'scheduler_error', 'commit_failed', 'source_unavailable', 'target_not_found', 'target_tombstoned', 'enqueue_failed'].includes(status);
      this.showStatus(failed ? `${label} failed: ${result?.error || status}` : `${label}: ${status}.`, failed ? 'error' : (status === 'committed' ? 'success' : 'info'));
      await this.reloadAndRender();
    } catch (error) {
      this.showStatus(`${label} failed: ${error?.message || error}`, 'error');
    }
  }

  async retryImmediate() {
    if (!this._requireActiveChat()) return;
    if (!this.adapter?.retryImmediate) { this.showStatus('Retry Immediate is unavailable.', 'error'); return; }
    this.showStatus('Retrying the exact failed exchange…', 'info');
    try {
      const result = await this.adapter.retryImmediate();
      this.showStatus(result.success ? 'Immediate extraction committed.' : `Retry Immediate failed: ${result.errorMessage || result.error || result.status}`, result.success ? 'success' : 'error');
      await this.reloadAndRender();
    } catch (error) {
      this.showStatus(`Retry Immediate failed: ${error?.message || error}`, 'error');
    }
  }

  render() {
    if (!this.rootElement) return;
    if (!this.panelOpen) {
      this.rootElement.innerHTML = '<button type="button" class="alpha-launcher" title="Open NPC State Alpha">NPC State α</button>';
      this.rootElement.querySelector('.alpha-launcher')?.addEventListener('click', () => this.open());
      return;
    }

    const hasChat = this.hasActiveChat();
    const devStatus = this.developmentQueue?.getStatus?.() || {};
    const ownershipConflict = this.adapter?.getOwnershipConflict?.() || null;
    const immediateFailure = this.adapter?.getImmediateFailure?.() || null;
    const settings = this.settingsView.loadSettings();
    const pending = Array.isArray(this.cachedState?.pendingReview?.entries) ? this.cachedState.pendingReview.entries : [];
    const failedPending = pending.filter((entry) => ['failed', 'unavailable', 'deferred'].includes(entry?.metadata?.lastReviewStatus)).length;
    const devLabel = !hasChat ? 'No chat open' : ownershipConflict
      ? 'Paused: competing owner'
      : (devStatus.inFlight ? 'Running' : (failedPending ? `${failedPending} need attention` : (pending.length ? `${pending.length} pending` : 'Idle')));

    let content = '';
    if (this.activeTab === 'settings') content = this.settingsView.render(settings);
    else if (this.activeTab === 'diagnostics') content = this.diagnosticsView.render();
    else if (!hasChat) content = '<div class="alpha-welcome"><div class="alpha-welcome-mark" aria-hidden="true">α</div><h3>Open a chat to get started</h3><p>NPC dossiers belong to the current conversation. Open a character or group chat in SillyTavern to view its NPCs.</p><button type="button" class="alpha-btn alpha-btn-primary alpha-open-settings">Configure settings</button></div>';
    else if (this.editingNpcId && this.cachedState?.npcs?.[this.editingNpcId]) content = this.editor.render(this.cachedState.npcs[this.editingNpcId], this.cachedRevision);
    else content = this.dossierView.render(this.cachedState, this.selectedNpcId, devStatus, { showDiagnostics: settings.showDossierDiagnostics });

    this.rootElement.innerHTML = `
      <section class="alpha-extension-panel" role="region" aria-label="NPC State Alpha">
        <div class="alpha-top-bar">
          <div class="alpha-brand-section"><div class="alpha-brand-copy"><span class="alpha-kicker">NPC DOSSIER</span><strong>NPC State Alpha</strong></div><span class="alpha-dev-status">${hasChat ? 'Development: ' : ''}${escapeHtml(devLabel)}</span></div>
          <button type="button" class="alpha-btn alpha-close" aria-label="Close NPC State Alpha">Close</button>
        </div>
        <div class="alpha-toolbar">
          <nav class="alpha-nav-tabs" aria-label="NPC State views">
            <button type="button" class="alpha-tab-btn ${this.activeTab === 'dossier' ? 'active' : ''}" data-tab="dossier" aria-pressed="${this.activeTab === 'dossier'}">Dossiers</button>
            <button type="button" class="alpha-tab-btn ${this.activeTab === 'settings' ? 'active' : ''}" data-tab="settings" aria-pressed="${this.activeTab === 'settings'}">Settings</button>
            <button type="button" class="alpha-tab-btn ${this.activeTab === 'diagnostics' ? 'active' : ''}" data-tab="diagnostics" aria-pressed="${this.activeTab === 'diagnostics'}">Diagnostics</button>
          </nav>
          <div class="alpha-quick-actions">
            <button type="button" class="alpha-btn alpha-btn-review" ${(!hasChat || devStatus.inFlight || ownershipConflict) ? 'disabled' : ''}>Review Pending</button>
            <button type="button" class="alpha-btn alpha-btn-retry" ${(!hasChat || devStatus.inFlight || ownershipConflict) ? 'disabled' : ''}>Retry Failed</button>
            ${hasChat && immediateFailure ? '<button type="button" class="alpha-btn alpha-btn-retry-imm">Retry Immediate</button>' : ''}
          </div>
        </div>
        ${ownershipConflict ? `<div class="alpha-status-banner alpha-status-error">Automatic Alpha capture and Development review are paused because competing continuity owner '${escapeHtml(ownershipConflict.name || 'unknown')}' is enabled. Disable one automatic owner, then reload.</div>` : ''}
        ${this.statusMessage ? `<div class="alpha-status-banner alpha-status-${escapeHtml(this.statusMessage.type)}">${escapeHtml(this.statusMessage.text)}</div>` : ''}
        <div class="alpha-panel-content">${content}</div>
      </section>`;
    this._bindControllerEvents();
  }

  _bindControllerEvents() {
    if (!this.rootElement) return;
    this.rootElement.querySelector('.alpha-open-settings')?.addEventListener('click', () => {
      this.activeTab = 'settings';
      this.render();
    });
    this.rootElement.querySelector('.alpha-close')?.addEventListener('click', () => this.close());
    this.rootElement.querySelectorAll('.alpha-tab-btn').forEach((button) => button.addEventListener('click', () => {
      this.activeTab = button.getAttribute('data-tab') || 'dossier';
      this.editingNpcId = null;
      this.render();
    }));
    this.rootElement.querySelector('.alpha-btn-review')?.addEventListener('click', () => this.reviewPending());
    this.rootElement.querySelector('.alpha-btn-retry')?.addEventListener('click', () => this.retryFailed());
    this.rootElement.querySelector('.alpha-btn-retry-imm')?.addEventListener('click', () => this.retryImmediate());

    if (this.activeTab === 'settings') this.settingsView.bindEvents(this.rootElement);
    else if (this.activeTab === 'diagnostics') this.diagnosticsView.bindEvents(this.rootElement);
    else if (this.editingNpcId) this.editor.bindEvents(this.rootElement);
    else this.dossierView.bindEvents(this.rootElement);
  }

  _injectStyles() {
    if (typeof document === 'undefined' || document.getElementById('npc-state-alpha-styles')) return;
    const style = document.createElement('style');
    style.id = 'npc-state-alpha-styles';
    style.textContent = ALPHA_UI_STYLES;
    document.head.appendChild(style);
  }
}
