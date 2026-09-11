/**
 * NPC State Alpha — read-only dossier renderer over canonical Alpha state.
 */

import { escapeHtml } from './dom-utils.js';
import { RELATIONSHIP_AXES } from '../runtime/relationship-mechanics.js';

function scalar(value, fallback = 'Unknown / unreviewed') {
  return value === null || value === undefined || value === '' ? fallback : String(value);
}

function personalityText(value) {
  if (!value) return 'Unknown / unreviewed';
  if (typeof value === 'string') return value;
  if (typeof value.value === 'string') return value.value;
  if (Array.isArray(value.traits)) return value.traits.join(', ');
  return 'Unknown / unreviewed';
}

function mannerismText(item) {
  if (typeof item === 'string') return item;
  return item?.value || item?.mannerism || item?.text || '';
}

function formText(form) {
  return [form?.label || form?.name || form?.formId, form?.description].filter(Boolean).join(': ');
}

function memoryText(memory) {
  return memory?.summary || memory?.text || memory?.memoryId || '';
}

function relationText(rel) {
  const kind = rel?.relationship || rel?.relationKind || rel?.description || 'relationship';
  return `${rel?.targetId || 'unknown target'}: ${kind}`;
}

function milestoneFor(rel, axis) {
  const milestones = Array.isArray(rel?.milestones) ? rel.milestones : [];
  return milestones.find((value) => typeof value === 'string' && value.startsWith(`${axis}:`)) || `${axis}:neutral`;
}

function developmentLabel(pendingEntries, queueStatus) {
  if (queueStatus?.inFlight) return 'Running';
  if (pendingEntries.some((entry) => ['failed', 'unavailable', 'deferred'].includes(entry?.metadata?.lastReviewStatus))) return 'Needs attention';
  if (pendingEntries.length > 0) return 'Pending';
  return 'Up to date / no pending scope';
}

export class DossierView {
  constructor(options = {}) {
    this.onSelect = options.onSelect || (() => {});
    this.onEdit = options.onEdit || (() => {});
    this.onRecheckMissing = options.onRecheckMissing || (() => {});
    this.onRefreshDossier = options.onRefreshDossier || (() => {});
    this.searchQuery = '';
    this.filterLifeState = 'all';
    this.filterPresence = 'all';
  }

  render(state, selectedNpcId = null, queueStatus = {}) {
    const all = state?.npcs ? Object.values(state.npcs) : [];
    const pendingEntries = Array.isArray(state?.pendingReview?.entries) ? state.pendingReview.entries : [];
    const filtered = all
      .filter((npc) => {
        const query = this.searchQuery.trim().toLowerCase();
        if (query) {
          const haystack = [npc.name, npc.role, ...(npc.aliases || [])].filter(Boolean).join(' ').toLowerCase();
          if (!haystack.includes(query)) return false;
        }
        if (this.filterLifeState !== 'all' && npc.lifeState !== this.filterLifeState) return false;
        if (this.filterPresence === 'present' && npc.present !== true) return false;
        if (this.filterPresence === 'offscreen' && npc.present === true) return false;
        return true;
      })
      .sort((a, b) => (Number(b.importance || 0) - Number(a.importance || 0)) || String(a.name).localeCompare(String(b.name)));

    const selected = selectedNpcId ? state?.npcs?.[selectedNpcId] : null;
    return `
      <div class="alpha-dossier-layout">
        <div class="alpha-dossier-sidebar">
          <div class="alpha-sidebar-heading">Characters <span>${all.length} total</span></div>
          <div class="alpha-filter-bar">
            <input type="search" class="alpha-search-input" aria-label="Search NPCs" placeholder="Search NPCs" value="${escapeHtml(this.searchQuery)}" />
            <div class="alpha-filter-selectors">
              <select class="alpha-filter-life" aria-label="Filter by life state">
                <option value="all" ${this.filterLifeState === 'all' ? 'selected' : ''}>All life states</option>
                <option value="alive" ${this.filterLifeState === 'alive' ? 'selected' : ''}>Alive</option>
                <option value="dead" ${this.filterLifeState === 'dead' ? 'selected' : ''}>Dead</option>
              </select>
              <select class="alpha-filter-presence" aria-label="Filter by presence">
                <option value="all" ${this.filterPresence === 'all' ? 'selected' : ''}>All presence</option>
                <option value="present" ${this.filterPresence === 'present' ? 'selected' : ''}>Present</option>
                <option value="offscreen" ${this.filterPresence === 'offscreen' ? 'selected' : ''}>Offscreen</option>
              </select>
            </div>
          </div>
          <div class="alpha-npc-list">${this._renderList(filtered, selectedNpcId, pendingEntries)}</div>
        </div>
        <div class="alpha-dossier-main">${selected ? this._renderDetail(selected, pendingEntries, queueStatus) : `<div class="alpha-empty-detail"><div class="alpha-welcome-mark" aria-hidden="true">α</div><h3>${all.length ? 'Select a character' : 'No NPCs recorded yet'}</h3><p>${all.length ? 'Choose an NPC from the list to view their current state, profile, and relationships.' : 'Dossiers appear after Alpha captures NPCs from a reply in this chat. You can configure automatic capture in Settings.'}</p></div>`}</div>
      </div>`;
  }

  _renderList(npcs, selectedNpcId, pendingEntries) {
    if (npcs.length === 0) return '<div class="alpha-no-npcs">No matching Alpha NPCs.</div>';
    return npcs.map((npc) => {
      const targetPending = pendingEntries.filter((entry) => entry.targetId === npc.id);
      const isDead = npc.lifeState === 'dead';
      const label = isDead ? 'Dead' : (npc.present ? 'Present' : 'Offscreen');
      const klass = isDead ? 'status-deceased' : (npc.present ? 'status-present' : 'status-offscreen');
      const portrait = npc.portrait
        ? `<img class="alpha-avatar-img" src="${escapeHtml(npc.portrait)}" alt="${escapeHtml(npc.name)}" />`
        : `<div class="alpha-avatar-fallback">${escapeHtml(String(npc.name || '?').slice(0, 1).toUpperCase())}</div>`;
      return `
        <button type="button" class="alpha-npc-card ${npc.id === selectedNpcId ? 'selected' : ''}" data-npc-id="${escapeHtml(npc.id)}">
          <span class="alpha-avatar-container">${portrait}</span>
          <span class="alpha-npc-summary">
            <span class="alpha-npc-name-row"><span class="alpha-npc-name">${escapeHtml(npc.name)}</span>${npc.importance !== null && npc.importance !== undefined ? `<span class="alpha-importance-badge">★${escapeHtml(String(npc.importance))}</span>` : ''}${targetPending.length ? '<span title="Development pending">⏳</span>' : ''}</span>
            <span class="alpha-npc-meta-row"><span class="alpha-badge ${klass}">${label}</span>${npc.role ? `<span class="alpha-role-text">${escapeHtml(npc.role)}</span>` : ''}</span>
          </span>
        </button>`;
    }).join('');
  }

  _renderDetail(npc, allPending, queueStatus) {
    const pending = allPending.filter((entry) => entry.targetId === npc.id);
    const receipts = Array.isArray(npc.development?.reviewReceipts) ? npc.development.reviewReceipts : [];
    const lastReceipt = [...receipts].reverse().find((receipt) => ['reviewed', 'reviewed_no_proposals'].includes(receipt.status)) || null;
    const forms = Array.isArray(npc.appearanceForms) ? npc.appearanceForms : [];
    const currentForm = forms.find((form) => form.formId === npc.currentForm);
    const mannerisms = Array.isArray(npc.mannerisms) ? npc.mannerisms.map(mannerismText).filter(Boolean) : [];
    const memories = Array.isArray(npc.importantMemories) ? npc.importantMemories.map(memoryText).filter(Boolean) : [];
    const graph = Array.isArray(npc.nonPlayerRelationships) ? npc.nonPlayerRelationships.map(relationText).filter(Boolean) : [];
    const corrections = npc.manualCorrections && typeof npc.manualCorrections === 'object' && !Array.isArray(npc.manualCorrections)
      ? Object.entries(npc.manualCorrections)
      : [];
    const lockedFields = npc.locks && typeof npc.locks === 'object'
      ? Object.entries(npc.locks).filter(([, locked]) => locked === true).map(([field]) => field)
      : [];
    const observations = Array.isArray(npc.development?.observations) ? npc.development.observations : [];
    const support = Array.isArray(npc.development?.acceptedSupport) ? npc.development.acceptedSupport : [];
    const rel = npc.relationship || {};
    const scoringHistory = Array.isArray(rel.scoringHistory) ? rel.scoringHistory : [];

    const axes = RELATIONSHIP_AXES.map((axis) => `
      <div class="alpha-axis-card">
        <div class="alpha-axis-name">${axis.toUpperCase()}</div>
        <div class="alpha-axis-value">${Number(rel[axis] || 0).toFixed(2)}</div>
        <div class="alpha-axis-milestone">${escapeHtml(milestoneFor(rel, axis))}</div>
        <div class="alpha-axis-progress">fraction ${Number(rel.progress?.[axis] || 0).toFixed(2)}</div>
      </div>`).join('');

    const history = scoringHistory.length
      ? `<ul class="alpha-history-list">${scoringHistory.slice(-5).map((item) => {
          const shifts = Object.entries(item.appliedDeltas || {}).filter(([, delta]) => Number(delta) !== 0).map(([axis, delta]) => `${axis} ${Number(delta) > 0 ? '+' : ''}${Number(delta).toFixed(2)}`).join(', ');
          return `<li>${escapeHtml(shifts || 'no numeric movement')} · ${escapeHtml(item.reason || item.impact || 'evaluated')} · ${escapeHtml(item.timestamp || '')}</li>`;
        }).join('')}</ul>`
      : '<div class="alpha-field-val">No scored relationship shifts recorded.</div>';

    const portrait = npc.portrait ? `<img class="alpha-detail-portrait" src="${escapeHtml(npc.portrait)}" alt="${escapeHtml(npc.name)}" />` : '';
    return `
      <div class="alpha-dossier-card">
        <div class="alpha-detail-header">
          <div class="alpha-header-left">${portrait}<div><h2 class="alpha-npc-title">${escapeHtml(npc.name)}</h2><div class="alpha-npc-subtitle">${escapeHtml(npc.id)} · ${escapeHtml(npc.lifeState)}</div></div></div>
          <div class="alpha-header-actions">
            <button type="button" class="alpha-btn alpha-btn-primary alpha-btn-edit" data-npc-id="${escapeHtml(npc.id)}">Edit</button>
            <button type="button" class="alpha-btn alpha-btn-secondary alpha-btn-recheck" data-npc-id="${escapeHtml(npc.id)}">Recheck Missing</button>
            <button type="button" class="alpha-btn alpha-btn-secondary alpha-btn-refresh" data-npc-id="${escapeHtml(npc.id)}">Refresh Dossier</button>
          </div>
        </div>

        <div class="alpha-section">
          <h4 class="alpha-section-title">Live State</h4>
          <div class="alpha-grid-2">
            <div><strong>Presence:</strong> ${npc.lifeState === 'dead' ? 'Dead / archived from living presence' : (npc.present ? 'Present' : 'Offscreen')}</div>
            <div><strong>Exchange active:</strong> ${npc.activeInExchange ? 'Yes' : 'No'}</div>
            <div><strong>Mood:</strong> ${escapeHtml(scalar(npc.mood))}</div>
            <div><strong>Location:</strong> ${escapeHtml(scalar(npc.location))}</div>
            <div><strong>Goal:</strong> ${escapeHtml(scalar(npc.goal))}</div>
            <div><strong>Status:</strong> ${escapeHtml(scalar(npc.status))}</div>
            <div><strong>Current form:</strong> ${escapeHtml(currentForm ? (currentForm.label || currentForm.name || currentForm.formId) : scalar(npc.currentForm, 'Unresolved / not selected'))}</div>
            <div><strong>Offscreen activity:</strong> ${escapeHtml(scalar(npc.offscreenActivity, 'None recorded'))}</div>
          </div>
        </div>

        <div class="alpha-section">
          <h4 class="alpha-section-title">Presentation vs Durable Appearance</h4>
          <div class="alpha-field-block"><div class="alpha-field-label">Current Presentation (Immediate)</div><div class="alpha-field-val">${escapeHtml(scalar(npc.currentPresentation))}</div></div>
          <div class="alpha-field-block"><div class="alpha-field-label">Canonical Appearance (Development)</div><div class="alpha-field-val">${escapeHtml(scalar(npc.canonicalAppearance))}</div></div>
          <div class="alpha-field-block"><div class="alpha-field-label">Established Forms</div><div class="alpha-field-val">${forms.length ? forms.map((form) => escapeHtml(formText(form))).join('<br>') : 'None established'}</div></div>
        </div>

        <div class="alpha-section">
          <h4 class="alpha-section-title">Durable Dossier</h4>
          <div class="alpha-grid-2">
            <div><strong>Role:</strong> ${escapeHtml(scalar(npc.role))}</div><div><strong>Species:</strong> ${escapeHtml(scalar(npc.species))}</div>
            <div><strong>Actual age:</strong> ${escapeHtml(scalar(npc.actualAge))}</div><div><strong>Apparent age:</strong> ${escapeHtml(scalar(npc.apparentAge))}</div>
            <div><strong>Birthday:</strong> ${escapeHtml(scalar(npc.birthday))}</div><div><strong>Importance:</strong> ${escapeHtml(scalar(npc.importance, 'Unset'))}</div>
          </div>
          <div class="alpha-field-block"><div class="alpha-field-label">Background</div><div class="alpha-field-val">${escapeHtml(scalar(npc.background))}</div></div>
          <div class="alpha-field-block"><div class="alpha-field-label">Personality</div><div class="alpha-field-val">${escapeHtml(personalityText(npc.personality))}</div></div>
          <div class="alpha-field-block"><div class="alpha-field-label">Behavioral profile</div><div class="alpha-field-val">${escapeHtml(scalar(npc.behavioralProfile))}</div></div>
          <div class="alpha-field-block"><div class="alpha-field-label">Speech</div><div class="alpha-field-val">${escapeHtml(scalar(npc.speech))}</div></div>
          <div class="alpha-field-block"><div class="alpha-field-label">Mannerisms</div><div class="alpha-field-val">${mannerisms.length ? mannerisms.map(escapeHtml).join('<br>') : 'Unknown / unreviewed'}</div></div>
          <div class="alpha-field-block"><div class="alpha-field-label">Important memories</div><div class="alpha-field-val">${memories.length ? memories.map(escapeHtml).join('<br>') : 'None established'}</div></div>
          <div class="alpha-field-block"><div class="alpha-field-label">Significant non-player relationships</div><div class="alpha-field-val">${graph.length ? graph.map(escapeHtml).join('<br>') : 'None established'}</div></div>
        </div>

        <div class="alpha-section">
          <h4 class="alpha-section-title">Relationship Toward Player</h4>
          <div class="alpha-field-block"><div class="alpha-field-label">Development Dynamic</div><div class="alpha-field-val">${escapeHtml(scalar(npc.relationshipDynamic))}</div></div>
          <div class="alpha-axes-grid">${axes}</div>
          <div class="alpha-field-block"><div class="alpha-field-label">Recent scored shifts</div>${history}</div>
        </div>

        <div class="alpha-section">
          <h4 class="alpha-section-title">Development Status</h4>
          <div class="alpha-grid-2">
            <div><strong>Status:</strong> ${escapeHtml(developmentLabel(pending, queueStatus))}</div>
            <div><strong>Pending scopes:</strong> ${pending.length}</div>
            <div><strong>Last successful review:</strong> ${escapeHtml(lastReceipt?.committedAt || 'None yet')}</div>
            <div><strong>Last reviewed scope:</strong> ${lastReceipt ? `${lastReceipt.sourceScope?.length || 0} owned source(s)${lastReceipt.restricted ? `, ${lastReceipt.fieldSubset?.length || 0} field(s)` : ''}` : 'None yet'}</div>
          </div>
          ${pending.length ? `<div class="alpha-field-block"><div class="alpha-field-label">Pending state</div><div class="alpha-field-val">${pending.map((entry) => escapeHtml(entry?.metadata?.lastReviewStatus || 'pending')).join(', ')}</div></div>` : ''}
        </div>

        <div class="alpha-section">
          <h4 class="alpha-section-title">User Ownership</h4>
          <div><strong>Locked fields:</strong> ${lockedFields.length ? lockedFields.map(escapeHtml).join(', ') : 'None'}</div>
          <div><strong>Manual corrections:</strong> ${corrections.length}</div>
          ${corrections.length ? `<ul class="alpha-history-list">${corrections.slice(-5).map(([field, record]) => `<li><strong>${escapeHtml(field)}</strong>: ${escapeHtml(record?.reason || 'user correction')} · ${escapeHtml(record?.correctedAt || '')}</li>`).join('')}</ul>` : ''}
        </div>

        <div class="alpha-section alpha-observations-section">
          <h4 class="alpha-section-title">Development Evidence</h4>
          <div class="alpha-help-text">Observations below are review evidence. They are not presented as established traits unless a durable field was separately committed.</div>
          ${observations.length ? observations.slice(-8).map((obs) => `<div class="alpha-obs-item"><div class="alpha-obs-header"><span class="alpha-obs-field">${escapeHtml(obs.field)}</span><span>${escapeHtml(obs.disposition?.role || 'tentative')}</span><span>${escapeHtml(obs.source?.sourceRef || '')}</span></div><div class="alpha-obs-body">${escapeHtml(obs.observation || '')}</div></div>`).join('') : '<div class="alpha-field-val">No retained observations.</div>'}
          <div class="alpha-help-text">Accepted support links: ${support.length}</div>
        </div>
      </div>`;
  }

  bindEvents(container) {
    const search = container?.querySelector('.alpha-search-input');
    search?.addEventListener('change', (event) => {
      this.searchQuery = event.target.value;
      this.onFilterChanged?.();
    });
    container?.querySelector('.alpha-filter-life')?.addEventListener('change', (event) => {
      this.filterLifeState = event.target.value;
      this.onFilterChanged?.();
    });
    container?.querySelector('.alpha-filter-presence')?.addEventListener('change', (event) => {
      this.filterPresence = event.target.value;
      this.onFilterChanged?.();
    });
    container?.querySelectorAll('.alpha-npc-card').forEach((card) => card.addEventListener('click', () => this.onSelect(card.getAttribute('data-npc-id'))));
    for (const [selector, handler] of [
      ['.alpha-btn-edit', this.onEdit],
      ['.alpha-btn-recheck', this.onRecheckMissing],
      ['.alpha-btn-refresh', this.onRefreshDossier],
    ]) {
      const button = container?.querySelector(selector);
      button?.addEventListener('click', () => handler(button.getAttribute('data-npc-id')));
    }
  }
}
