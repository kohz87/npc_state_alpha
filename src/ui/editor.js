/**
 * NPC State Alpha — thin atomic NPC editor.
 */

import { escapeHtml } from './dom-utils.js';
import { applyNpcEdit, deleteNpc } from '../runtime/user-commands.js';

export const ADDITIONAL_LOCK_FIELDS = Object.freeze([
  { key: 'relationshipEvaluation', label: 'Numeric relationship scoring' },
  { key: 'appearanceForms', label: 'Appearance forms' },
  { key: 'importantMemories', label: 'Important memories' },
  { key: 'nonPlayerRelationships', label: 'Non-player relationships' },
]);

export const EDITABLE_FIELDS = Object.freeze([
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'mood', label: 'Mood', type: 'text' },
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'goal', label: 'Goal', type: 'text' },
  { key: 'status', label: 'Status / Activity', type: 'text' },
  { key: 'currentPresentation', label: 'Current Presentation', type: 'textarea' },
  { key: 'currentForm', label: 'Current Form ID', type: 'text' },
  { key: 'role', label: 'Role', type: 'text' },
  { key: 'species', label: 'Species', type: 'text' },
  { key: 'actualAge', label: 'Actual Age', type: 'text' },
  { key: 'apparentAge', label: 'Apparent Age', type: 'text' },
  { key: 'birthday', label: 'Birthday', type: 'text' },
  { key: 'canonicalAppearance', label: 'Canonical Appearance', type: 'textarea' },
  { key: 'personality', label: 'Personality', type: 'textarea' },
  { key: 'behavioralProfile', label: 'Behavioral Profile', type: 'textarea' },
  { key: 'speech', label: 'Speech', type: 'textarea' },
  { key: 'mannerisms', label: 'Mannerisms (one per line)', type: 'textarea' },
  { key: 'background', label: 'Background', type: 'textarea' },
  { key: 'relationshipDynamic', label: 'Relationship Dynamic', type: 'textarea' },
]);

function displayValue(npc, field) {
  const value = npc?.[field];
  if (value === null || value === undefined) return '';
  if (field === 'personality' && typeof value === 'object' && !Array.isArray(value)) {
    if (typeof value.value === 'string') return value.value;
    if (Array.isArray(value.traits)) return value.traits.join(', ');
  }
  if (field === 'mannerisms' && Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') return item;
      return item?.value || item?.mannerism || item?.text || '';
    }).filter(Boolean).join('\n');
  }
  return String(value);
}

function normalizedEditorValue(field, raw) {
  const value = String(raw ?? '').trim();
  if (field === 'currentForm') return value || null;
  if (field === 'personality') return value ? { value } : null;
  if (field === 'mannerisms') {
    const items = String(raw ?? '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    return { operation: 'consolidate', items };
  }
  return value || null;
}

function comparableEditorText(field, raw) {
  const text = String(raw ?? '');
  if (field === 'mannerisms') {
    return text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean).join('\n');
  }
  return text.trim();
}

export class NpcEditor {
  constructor(options = {}) {
    this.coordinator = options.coordinator;
    this.onSaved = options.onSaved || (() => {});
    this.onCancel = options.onCancel || (() => {});
    this.onError = options.onError || (() => {});
    this.renderedNpc = null;
    this.renderedRevision = null;
  }

  render(npc, currentRevision = 0) {
    if (!npc) return '<div class="alpha-editor-empty">No NPC selected for editing.</div>';
    this.renderedNpc = structuredClone(npc);
    this.renderedRevision = currentRevision;
    const locks = npc.locks || {};

    const fieldsHtml = EDITABLE_FIELDS.map(({ key, label, type }) => {
      const value = displayValue(npc, key);
      const input = type === 'textarea'
        ? `<textarea class="alpha-edit-input" data-field="${key}" rows="3">${escapeHtml(value)}</textarea>`
        : `<input type="text" class="alpha-edit-input" data-field="${key}" value="${escapeHtml(value)}" />`;
      return `
        <div class="alpha-form-group">
          <div class="alpha-form-label-row">
            <label class="alpha-form-label">${escapeHtml(label)}</label>
            <label class="alpha-lock-toggle" title="Locks block future automatic writes; corrections do not lock implicitly.">
              <input type="checkbox" class="alpha-field-lock" data-field="${key}" ${locks[key] === true ? 'checked' : ''} /> Lock
            </label>
          </div>
          ${input}
        </div>`;
    }).join('');

    return `
      <div class="alpha-editor-container" data-npc-id="${escapeHtml(npc.id)}" data-revision="${currentRevision}">
        <div class="alpha-editor-header">
          <h3>Edit NPC: ${escapeHtml(npc.name)}</h3>
          <span class="alpha-revision-tag">Rev ${currentRevision}</span>
        </div>
        <div class="alpha-editor-section">
          <h4 class="alpha-section-heading">User-owned controls</h4>
          <div class="alpha-form-group">
            <label class="alpha-form-label">Portrait asset URL / path</label>
            <input type="text" class="alpha-portrait-input" value="${escapeHtml(npc.portrait || '')}" placeholder="Supported SillyTavern-accessible asset URL/path" />
          </div>
          <div class="alpha-form-group">
            <label class="alpha-form-label">Importance (0–10, blank = unset)</label>
            <input type="number" min="0" max="10" step="1" class="alpha-importance-input" value="${npc.importance ?? ''}" />
          </div>
          <div class="alpha-form-group">
            <label class="alpha-form-label">Lifecycle</label>
            <select class="alpha-lifecycle-select">
              <option value="alive" ${npc.lifeState === 'alive' ? 'selected' : ''}>Alive</option>
              <option value="dead" ${npc.lifeState === 'dead' ? 'selected' : ''}>Dead</option>
            </select>
            <div class="alpha-help-text">User correction may fix a mistaken death. Automatic dead→alive remains forbidden.</div>
          </div>
        </div>
        <div class="alpha-editor-section">
          <h4 class="alpha-section-heading">Corrections and locks</h4>
          <div class="alpha-help-text">A correction records user provenance. Only the separate Lock checkbox freezes future automatic writes.</div>
          ${fieldsHtml}
          <div class="alpha-form-group">
            <div class="alpha-form-label">Additional automatic domains</div>
            ${ADDITIONAL_LOCK_FIELDS.map(({ key, label }) => `<label class="alpha-lock-toggle"><input type="checkbox" class="alpha-field-lock" data-field="${key}" ${locks[key] === true ? 'checked' : ''} /> ${escapeHtml(label)}</label>`).join(' ')}
          </div>
        </div>
        <div class="alpha-form-group">
          <label class="alpha-form-label">Correction reason</label>
          <input type="text" class="alpha-correction-reason" value="User editor manual correction" />
        </div>
        <div class="alpha-editor-actions">
          <button type="button" class="alpha-btn alpha-btn-danger alpha-btn-delete">Delete NPC</button>
          <div>
            <button type="button" class="alpha-btn alpha-btn-secondary alpha-btn-cancel">Cancel</button>
            <button type="button" class="alpha-btn alpha-btn-primary alpha-btn-save">Save Changes</button>
          </div>
        </div>
        <div class="alpha-editor-status" style="display:none;"></div>
      </div>`;
  }

  bindEvents(container) {
    const editor = container?.querySelector('.alpha-editor-container');
    if (!editor) return;
    const npcId = editor.getAttribute('data-npc-id');
    const expectedRevision = Number(editor.getAttribute('data-revision'));

    editor.querySelector('.alpha-btn-cancel')?.addEventListener('click', () => this.onCancel());
    editor.querySelector('.alpha-btn-delete')?.addEventListener('click', async () => {
      const confirmed = typeof confirm === 'function' ? confirm(`Delete NPC '${npcId}'?`) : true;
      if (!confirmed) return;
      const result = await deleteNpc(this.coordinator, { npcId, expectedRevision, reason: 'Manual user deletion' });
      if (!result.success) {
        this._showError(editor, result.error || 'Delete failed.');
        return;
      }
      this.onSaved({ deleted: true, npcId });
    });
    editor.querySelector('.alpha-btn-save')?.addEventListener('click', () => this._handleSave(editor, npcId, expectedRevision));
  }

  async _handleSave(editor, npcId, expectedRevision) {
    const original = this.renderedNpc;
    if (!original || original.id !== npcId || this.renderedRevision !== expectedRevision) {
      this._showError(editor, 'Editor state is stale. Close and reopen this NPC.');
      return;
    }

    const fields = {};
    const locks = {};
    for (const input of editor.querySelectorAll('.alpha-edit-input')) {
      const field = input.getAttribute('data-field');
      const originalText = displayValue(original, field);
      if (comparableEditorText(field, input.value) !== comparableEditorText(field, originalText)) {
        fields[field] = normalizedEditorValue(field, input.value);
      }

      const checkbox = editor.querySelector(`.alpha-field-lock[data-field="${field}"]`);
      const nextLock = Boolean(checkbox?.checked);
      const currentLock = original.locks?.[field] === true;
      if (nextLock !== currentLock) locks[field] = nextLock;
    }
    for (const { key } of ADDITIONAL_LOCK_FIELDS) {
      const checkbox = editor.querySelector(`.alpha-field-lock[data-field="${key}"]`);
      const nextLock = Boolean(checkbox?.checked);
      const currentLock = original.locks?.[key] === true;
      if (nextLock !== currentLock) locks[key] = nextLock;
    }

    const portraitRaw = editor.querySelector('.alpha-portrait-input')?.value ?? '';
    const portrait = portraitRaw.trim() || null;
    const importanceRaw = editor.querySelector('.alpha-importance-input')?.value ?? '';
    const importance = importanceRaw === '' ? null : Number(importanceRaw);
    const lifeState = editor.querySelector('.alpha-lifecycle-select')?.value;
    const reason = editor.querySelector('.alpha-correction-reason')?.value?.trim() || 'User editor manual correction';

    const args = { npcId, fields, locks, expectedRevision, reason };
    if (portrait !== (original.portrait ?? null)) args.portrait = portrait;
    if (importance !== (original.importance ?? null)) args.importance = importance;
    if (lifeState !== original.lifeState) args.lifeState = lifeState;

    if (Object.keys(fields).length === 0 && Object.keys(locks).length === 0 && args.portrait === undefined && args.importance === undefined && args.lifeState === undefined) {
      this._showInfo(editor, 'No changes to save.');
      return;
    }

    try {
      const result = await applyNpcEdit(this.coordinator, args);
      if (!result.success) {
        const message = result.casConflict
          ? 'State changed while this editor was open. Reopen the NPC before saving.'
          : (result.error || 'Save rejected by the shared runtime.');
        this._showError(editor, message);
        return;
      }
      this.onSaved({ npcId, commitRevision: result.commitRevision });
    } catch (error) {
      this._showError(editor, error?.message || 'Unexpected save failure.');
    }
  }

  _showInfo(editor, message) {
    const status = editor?.querySelector('.alpha-editor-status');
    if (!status) return;
    status.style.display = 'block';
    status.className = 'alpha-editor-status alpha-status-info';
    status.textContent = message;
  }

  _showError(editor, message) {
    const status = editor?.querySelector('.alpha-editor-status');
    if (status) {
      status.style.display = 'block';
      status.className = 'alpha-editor-status alpha-status-error';
      status.textContent = message;
    }
    this.onError(message);
  }
}
