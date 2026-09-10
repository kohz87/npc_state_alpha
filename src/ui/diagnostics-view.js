/**
 * NPC State Alpha — Diagnostics View Component
 *
 * Inspects runtime operations using the existing bounded DiagnosticsLedger.
 * Displays operational event timeline, usage stats, and failure records.
 */

import { escapeHtml } from './dom-utils.js';

export class DiagnosticsView {
  /**
   * @param {object} [options]
   * @param {import('../host/diagnostics.js').DiagnosticsLedger} options.diagnostics Shared ledger
   * @param {Function} [options.onRefresh] Callback when refresh is clicked
   */
  constructor(options = {}) {
    this.diagnostics = options.diagnostics;
    this.onRefresh = options.onRefresh || (() => {});
    this.filterType = 'all';
    this.filterChatId = '';
  }

  /**
   * Renders the diagnostics view HTML markup.
   * @param {Array<object>} [events] Optional pre-loaded events array
   * @returns {string} HTML markup
   */
  render(events = null) {
    const rawEvents = events || this.diagnostics?.getEntries?.() || this.diagnostics?.getEvents?.() || [];

    // Filter events
    const filtered = rawEvents.filter((ev) => {
      if (this.filterType !== 'all' && ev.type !== this.filterType) return false;
      if (this.filterChatId && ev.chatId && !String(ev.chatId).includes(this.filterChatId)) return false;
      return true;
    });

    // Summary stats
    const totalCount = rawEvents.length;
    const failureCount = rawEvents.filter((e) => (e.type || '').includes('failed') || (e.type || '').includes('failure')).length;
    const commitCount = rawEvents.filter((e) => (e.type || '').includes('commit')).length;
    const devCount = rawEvents.filter((e) => (e.type || '').includes('development')).length;

    // Unique types for filter dropdown
    const uniqueTypes = [...new Set(rawEvents.map((e) => e.type).filter(Boolean))].sort();

    const rowsHtml = filtered.length === 0
      ? '<tr><td colspan="4" class="alpha-empty-table">No diagnostic events recorded.</td></tr>'
      : filtered.slice(-100).reverse().map((ev) => {
          const time = ev.timestamp ? new Date(ev.timestamp).toLocaleTimeString() : 'Unknown';
          const isFailure = (ev.type || '').includes('failed') || (ev.type || '').includes('failure');
          const typeBadge = `<span class="alpha-badge ${isFailure ? 'alpha-badge-danger' : 'alpha-badge-info'}">${escapeHtml(ev.type)}</span>`;
          const details = { ...ev };
          delete details.type;
          delete details.timestamp;
          delete details.id;

          return `
            <tr>
              <td class="alpha-td-time">${escapeHtml(time)}</td>
              <td class="alpha-td-type">${typeBadge}</td>
              <td class="alpha-td-chat">${escapeHtml(ev.chatId || '-')}</td>
              <td class="alpha-td-details"><code>${escapeHtml(JSON.stringify(details))}</code></td>
            </tr>
          `;
        }).join('');

    return `
      <div class="alpha-diagnostics-container">
        <div class="alpha-diag-header">
          <h3 class="alpha-diag-title">Diagnostics Ledger</h3>
          <div class="alpha-diag-actions">
            <button type="button" class="alpha-btn alpha-btn-secondary alpha-btn-refresh-diag">🔄 Refresh</button>
            <button type="button" class="alpha-btn alpha-btn-secondary alpha-btn-export-diag">📥 Export JSON</button>
            <button type="button" class="alpha-btn alpha-btn-danger alpha-btn-clear-diag">🗑️ Clear</button>
          </div>
        </div>

        <!-- Summary Stat Cards -->
        <div class="alpha-diag-stats-grid">
          <div class="alpha-stat-card">
            <div class="alpha-stat-label">Total Events</div>
            <div class="alpha-stat-value">${totalCount}</div>
          </div>
          <div class="alpha-stat-card">
            <div class="alpha-stat-label">Commits</div>
            <div class="alpha-stat-value">${commitCount}</div>
          </div>
          <div class="alpha-stat-card">
            <div class="alpha-stat-label">Development Events</div>
            <div class="alpha-stat-value">${devCount}</div>
          </div>
          <div class="alpha-stat-card">
            <div class="alpha-stat-label">Failures / Errors</div>
            <div class="alpha-stat-value ${failureCount > 0 ? 'text-danger' : ''}">${failureCount}</div>
          </div>
        </div>

        <!-- Filter bar -->
        <div class="alpha-diag-filters">
          <label>Filter Type:
            <select class="alpha-diag-filter-type">
              <option value="all" ${this.filterType === 'all' ? 'selected' : ''}>All Events</option>
              ${uniqueTypes.map((t) => `<option value="${escapeHtml(t)}" ${this.filterType === t ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}
            </select>
          </label>
          <label>Chat ID:
            <input type="text" class="alpha-diag-filter-chat" value="${escapeHtml(this.filterChatId)}" placeholder="Filter by chat ID..." />
          </label>
        </div>

        <!-- Event table -->
        <div class="alpha-diag-table-wrap">
          <table class="alpha-diag-table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Event Type</th>
                <th>Chat</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              ${rowsHtml}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }

  /**
   * Binds DOM events for the diagnostics view.
   * @param {HTMLElement} container DOM container
   */
  bindEvents(container) {
    if (!container) return;

    // Refresh
    const refreshBtn = container.querySelector('.alpha-btn-refresh-diag');
    if (refreshBtn) {
      refreshBtn.addEventListener('click', () => {
        this.onRefresh();
      });
    }

    // Export
    const exportBtn = container.querySelector('.alpha-btn-export-diag');
    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const events = this.diagnostics?.getEntries?.() || this.diagnostics?.getEvents?.() || [];
        const jsonStr = JSON.stringify(events, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `npc_alpha_diagnostics_${Date.now()}.json`;
        a.click();
        URL.revokeObjectURL(url);
      });
    }

    // Clear
    const clearBtn = container.querySelector('.alpha-btn-clear-diag');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        this.diagnostics?.clear?.();
        this.onRefresh();
      });
    }

    // Filters
    const typeSelect = container.querySelector('.alpha-diag-filter-type');
    if (typeSelect) {
      typeSelect.addEventListener('change', (e) => {
        this.filterType = e.target.value;
        this.onRefresh();
      });
    }

    const chatInput = container.querySelector('.alpha-diag-filter-chat');
    if (chatInput) {
      chatInput.addEventListener('input', (e) => {
        this.filterChatId = e.target.value;
        this.onRefresh();
      });
    }
  }
}
