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

export class UIController {
  constructor(options = {}) {
    this.adapter = options.adapter || null;
    this.storage = options.storage || this.adapter?.storage || null;
    this.coordinator = options.coordinator || this.adapter?.coordinator || null;
    this.developmentQueue = options.developmentQueue || this.adapter?.developmentReview || null;
    this.diagnostics = options.diagnostics || this.adapter?.diagnostics || null;

    this.dossierView = new DossierView({
      onSelect: (id) => this.selectNpc(id),
      onEdit: (id) => this.startEditing(id),
      onRecheckMissing: (id) => this.recheckMissing(id),
      onRefreshDossier: (id) => this.refreshDossier(id),
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

  async reloadAndRender() {
    if (!this.storage) return;
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

  async reviewPending() { await this._runDevelopmentAction('Review pending', () => this.developmentQueue?.reviewPending?.()); }
  async retryFailed() { await this._runDevelopmentAction('Retry failed review', () => this.developmentQueue?.retryFailed?.()); }
  async recheckMissing(id) { await this._runDevelopmentAction('Recheck missing', () => this.developmentQueue?.recheckMissingDetails?.(id)); }
  async refreshDossier(id) { await this._runDevelopmentAction('Refresh dossier', () => this.developmentQueue?.refreshDossier?.(id)); }

  async _runDevelopmentAction(label, action) {
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
      this.rootElement.innerHTML = '<button type="button" class="alpha-launcher" title="Open NPC State Alpha">NPC α</button>';
      this.rootElement.querySelector('.alpha-launcher')?.addEventListener('click', () => this.open());
      return;
    }

    const devStatus = this.developmentQueue?.getStatus?.() || {};
    const ownershipConflict = this.adapter?.getOwnershipConflict?.() || null;
    const immediateFailure = this.adapter?.getImmediateFailure?.() || null;
    const pending = Array.isArray(this.cachedState?.pendingReview?.entries) ? this.cachedState.pendingReview.entries : [];
    const failedPending = pending.filter((entry) => ['failed', 'unavailable', 'deferred'].includes(entry?.metadata?.lastReviewStatus)).length;
    const devLabel = ownershipConflict
      ? 'Paused: competing owner'
      : (devStatus.inFlight ? 'Running' : (failedPending ? `${failedPending} need attention` : (pending.length ? `${pending.length} pending` : 'Idle')));

    let content = '';
    if (this.activeTab === 'settings') content = this.settingsView.render();
    else if (this.activeTab === 'diagnostics') content = this.diagnosticsView.render();
    else if (this.editingNpcId && this.cachedState?.npcs?.[this.editingNpcId]) content = this.editor.render(this.cachedState.npcs[this.editingNpcId], this.cachedRevision);
    else content = this.dossierView.render(this.cachedState, this.selectedNpcId, devStatus);

    this.rootElement.innerHTML = `
      <div class="alpha-extension-panel">
        <div class="alpha-top-bar">
          <div class="alpha-brand-section"><strong>NPC State Alpha</strong><span class="alpha-dev-status">Development: ${escapeHtml(devLabel)}</span></div>
          <div class="alpha-nav-tabs">
            <button type="button" class="alpha-tab-btn ${this.activeTab === 'dossier' ? 'active' : ''}" data-tab="dossier">Dossiers</button>
            <button type="button" class="alpha-tab-btn ${this.activeTab === 'settings' ? 'active' : ''}" data-tab="settings">Settings</button>
            <button type="button" class="alpha-tab-btn ${this.activeTab === 'diagnostics' ? 'active' : ''}" data-tab="diagnostics">Diagnostics</button>
          </div>
          <div class="alpha-quick-actions">
            <button type="button" class="alpha-btn alpha-btn-review" ${(devStatus.inFlight || ownershipConflict) ? 'disabled' : ''}>Review Pending</button>
            <button type="button" class="alpha-btn alpha-btn-retry" ${(devStatus.inFlight || ownershipConflict) ? 'disabled' : ''}>Retry Failed</button>
            ${immediateFailure ? '<button type="button" class="alpha-btn alpha-btn-retry-imm">Retry Immediate</button>' : ''}
            <button type="button" class="alpha-btn alpha-close">Close</button>
          </div>
        </div>
        ${ownershipConflict ? `<div class="alpha-status-banner alpha-status-error">Automatic Alpha capture and Development review are paused because competing continuity owner '${escapeHtml(ownershipConflict.name || 'unknown')}' is enabled. Disable one automatic owner, then reload.</div>` : ''}
        ${this.statusMessage ? `<div class="alpha-status-banner alpha-status-${escapeHtml(this.statusMessage.type)}">${escapeHtml(this.statusMessage.text)}</div>` : ''}
        <div class="alpha-panel-content">${content}</div>
      </div>`;
    this._bindControllerEvents();
  }

  _bindControllerEvents() {
    if (!this.rootElement) return;
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
    style.textContent = `
      #npc-state-alpha-root{position:relative;z-index:50;font:13px system-ui,sans-serif}.alpha-launcher{position:fixed;right:14px;bottom:72px;padding:7px 10px;border-radius:999px;cursor:pointer}.alpha-extension-panel{position:fixed;right:14px;bottom:110px;width:min(900px,92vw);height:min(720px,78vh);display:flex;flex-direction:column;background:var(--SmartThemeBlurTintColor,#202020);color:var(--SmartThemeBodyColor,#ddd);border:1px solid var(--SmartThemeBorderColor,#555);border-radius:8px;box-shadow:0 8px 30px #0008;overflow:hidden}.alpha-top-bar{display:flex;align-items:center;gap:10px;padding:8px;border-bottom:1px solid #7776}.alpha-brand-section{display:flex;gap:8px;align-items:center;min-width:190px}.alpha-dev-status{font-size:11px;opacity:.8}.alpha-nav-tabs,.alpha-quick-actions{display:flex;gap:5px}.alpha-nav-tabs{flex:1}.alpha-btn,.alpha-tab-btn{cursor:pointer;padding:4px 8px}.alpha-tab-btn.active{font-weight:700}.alpha-panel-content{overflow:auto;flex:1;padding:8px}.alpha-status-banner{padding:6px 10px}.alpha-status-error{color:#ff9e9e}.alpha-status-success{color:#9ee6a3}.alpha-dossier-layout{display:flex;min-height:100%}.alpha-dossier-sidebar{width:240px;flex:0 0 240px;border-right:1px solid #7776}.alpha-filter-bar{padding:6px;display:grid;gap:5px}.alpha-filter-selectors{display:flex;gap:4px}.alpha-npc-list{display:grid}.alpha-npc-card{display:flex;gap:7px;text-align:left;padding:7px;border:0;border-bottom:1px solid #7773;background:transparent;color:inherit;cursor:pointer}.alpha-npc-card.selected{outline:1px solid #7aa2f7}.alpha-avatar-container{width:34px;height:34px;border-radius:50%;overflow:hidden;display:grid;place-items:center;background:#7773;flex:0 0 34px}.alpha-avatar-img{width:100%;height:100%;object-fit:cover}.alpha-npc-summary,.alpha-npc-name-row,.alpha-npc-meta-row{display:flex}.alpha-npc-summary{min-width:0;flex-direction:column}.alpha-npc-name-row,.alpha-npc-meta-row{gap:5px;align-items:center}.alpha-dossier-main{flex:1;min-width:0;padding:8px}.alpha-detail-header,.alpha-editor-header,.alpha-form-label-row,.alpha-editor-actions{display:flex;justify-content:space-between;gap:8px;align-items:center}.alpha-header-left,.alpha-header-actions{display:flex;gap:8px;align-items:center}.alpha-detail-portrait{width:54px;height:54px;object-fit:cover;border-radius:5px}.alpha-section,.alpha-settings-group,.alpha-editor-section{border:1px solid #7775;border-radius:6px;padding:8px;margin-bottom:8px}.alpha-section-title,.alpha-group-title{margin:0 0 6px}.alpha-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:5px}.alpha-field-block{margin-top:6px}.alpha-field-label,.alpha-setting-help,.alpha-help-text{font-size:11px;opacity:.75}.alpha-axes-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:5px}.alpha-axis-card{text-align:center;border:1px solid #7775;border-radius:5px;padding:5px}.alpha-axis-name{font-size:10px}.alpha-axis-value{font-weight:700}.alpha-history-list{margin:4px 0;padding-left:18px}.alpha-obs-item{border:1px solid #7774;border-radius:4px;padding:5px;margin-top:4px}.alpha-obs-header{display:flex;gap:8px;font-size:10px;opacity:.8}.alpha-editor-container,.alpha-settings-container,.alpha-diagnostics-container{max-width:720px;margin:auto}.alpha-form-group,.alpha-setting-row{margin-bottom:9px}.alpha-edit-input,.alpha-portrait-input,.alpha-importance-input,.alpha-lifecycle-select,.alpha-settings-container input,.alpha-settings-container select,.alpha-search-input{box-sizing:border-box;max-width:100%}.alpha-edit-input,.alpha-portrait-input{width:100%}.alpha-lock-toggle{font-size:11px}.alpha-settings-actions{display:flex;gap:7px;justify-content:flex-end}@media(max-width:720px){.alpha-extension-panel{right:2vw;width:96vw}.alpha-dossier-layout{display:block}.alpha-dossier-sidebar{width:auto;border-right:0;border-bottom:1px solid #7776}.alpha-axes-grid{grid-template-columns:1fr 1fr}.alpha-top-bar{flex-wrap:wrap}}`;
    document.head.appendChild(style);
  }
}
