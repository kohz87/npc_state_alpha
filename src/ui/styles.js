/** Scoped UI styles: host text shadows and native control colors must not reduce readability. */
export const ALPHA_UI_STYLES = `
#npc-state-alpha-root {
  --alpha-bg: #151b24;
  --alpha-surface: #1e2733;
  --alpha-input: #111822;
  --alpha-border: #455368;
  --alpha-text: #edf2f8;
  --alpha-muted: #b9c5d5;
  --alpha-accent: #a9c8ff;
  position: relative;
  z-index: 10000;
  color-scheme: dark;
  color: var(--alpha-text);
  font: 400 15px/1.55 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
#npc-state-alpha-root *, #npc-state-alpha-root *::before, #npc-state-alpha-root *::after {
  box-sizing: border-box;
  text-shadow: none;
}
#npc-state-alpha-root :is(button, input, select, textarea) {
  font: inherit;
  color: var(--alpha-text);
  background: var(--alpha-input);
  border: 1px solid var(--alpha-border);
  border-radius: 8px;
  box-shadow: none;
  filter: none;
  opacity: 1;
  margin: 0;
  min-width: 0;
  max-width: 100%;
}
#npc-state-alpha-root button {
  appearance: none;
  cursor: pointer;
  padding: 8px 13px;
  min-height: 40px;
  line-height: 1.4;
  font-weight: 600;
  background: #293649;
  white-space: normal;
}
#npc-state-alpha-root button:hover:not(:disabled) { background: #354761; border-color: #8aa3c8; }
#npc-state-alpha-root button:disabled { color: #a5b0bf; background: #202833; border-color: #3a4656; cursor: not-allowed; }
#npc-state-alpha-root :is(button, input, select, textarea, a):focus-visible { outline: 2px solid #a9c8ff; outline-offset: 3px; }
#npc-state-alpha-root :is(input:not([type="checkbox"]), select, textarea) { padding: 9px 11px; min-height: 42px; width: 100%; }
#npc-state-alpha-root input[type="checkbox"] { width: 18px; height: 18px; flex: 0 0 18px; accent-color: #a9c8ff; vertical-align: middle; }
#npc-state-alpha-root textarea { resize: vertical; line-height: 1.6; }
#npc-state-alpha-root input::placeholder, #npc-state-alpha-root textarea::placeholder { color: #9daec2; opacity: 1; }
#npc-state-alpha-root :is(h2, h3, h4, p) { color: inherit; padding: 0; }
#npc-state-alpha-root h2 { font-size: 24px; line-height: 1.25; margin: 0 0 6px; }
#npc-state-alpha-root h3 { font-size: 22px; line-height: 1.35; margin: 0 0 8px; }
#npc-state-alpha-root h4 { font-size: 16px; line-height: 1.4; margin: 0 0 14px; }
#npc-state-alpha-root p { margin: 0 0 18px; }
#npc-state-alpha-root strong { font-weight: 650; }
#npc-state-alpha-root .alpha-launcher { position: fixed; right: 20px; bottom: 76px; border-radius: 12px; padding: 11px 17px; background: #263a55; border-color: #8aa3c8; box-shadow: 0 5px 20px #0006; }
#npc-state-alpha-root .alpha-extension-panel { position: fixed; right: 20px; bottom: 24px; width: min(1060px, calc(100vw - 40px)); height: min(820px, calc(100dvh - 64px)); display: flex; flex-direction: column; background: var(--alpha-bg); color: var(--alpha-text); border: 1px solid var(--alpha-border); border-radius: 16px; box-shadow: 0 18px 70px #0009; overflow: hidden; }
#npc-state-alpha-root .alpha-top-bar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px; padding: 18px 22px; border-bottom: 1px solid var(--alpha-border); background: var(--alpha-surface); }
#npc-state-alpha-root .alpha-brand-section { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; min-width: 0; }
#npc-state-alpha-root .alpha-brand-section > strong { font-size: 20px; letter-spacing: -.3px; }
#npc-state-alpha-root .alpha-dev-status { font-size: 13px; color: #c5d8f6; background: #29384d; padding: 4px 10px; border-radius: 20px; }
#npc-state-alpha-root .alpha-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; padding: 12px 22px; border-bottom: 1px solid var(--alpha-border); }
#npc-state-alpha-root .alpha-nav-tabs, #npc-state-alpha-root .alpha-quick-actions { display: flex; flex-wrap: wrap; gap: 8px; }
#npc-state-alpha-root .alpha-tab-btn { background: transparent; border-color: transparent; color: var(--alpha-muted); }
#npc-state-alpha-root .alpha-tab-btn.active { background: #2b4160; color: #f1f6ff; border-color: #86a8db; }
#npc-state-alpha-root .alpha-btn-primary { background: #adcaff; border-color: #adcaff; color: #13223a; }
#npc-state-alpha-root .alpha-btn-primary:hover:not(:disabled) { background: #c6daff; color: #13223a; }
#npc-state-alpha-root .alpha-btn-danger { color: #ffc3c3; background: #46272f; border-color: #965360; }
#npc-state-alpha-root .alpha-panel-content { overflow: auto; flex: 1; min-height: 0; padding: 22px; scrollbar-color: #657b99 var(--alpha-bg); }
#npc-state-alpha-root .alpha-status-banner { padding: 12px 22px; border-bottom: 1px solid var(--alpha-border); overflow-wrap: anywhere; }
#npc-state-alpha-root .alpha-status-error { color: #ffc3c3; background: #3b252d; }
#npc-state-alpha-root .alpha-status-success { color: #b7efd1; background: #20382f; }
#npc-state-alpha-root .alpha-status-info { color: #cadcfa; background: #24334a; }
#npc-state-alpha-root .alpha-dossier-layout { display: grid; grid-template-columns: 260px minmax(0, 1fr); gap: 22px; min-height: 100%; }
#npc-state-alpha-root .alpha-dossier-sidebar { border-right: 1px solid var(--alpha-border); padding-right: 18px; min-width: 0; }
#npc-state-alpha-root .alpha-filter-bar { display: grid; gap: 10px; margin-bottom: 14px; }
#npc-state-alpha-root .alpha-filter-selectors { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
#npc-state-alpha-root .alpha-filter-selectors select { font-size: 13px; padding: 8px 5px; }
#npc-state-alpha-root .alpha-sidebar-heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; font-weight: 650; }
#npc-state-alpha-root .alpha-sidebar-heading span { color: var(--alpha-muted); font-size: 13px; font-weight: 400; }
#npc-state-alpha-root .alpha-npc-list { display: grid; gap: 8px; }
#npc-state-alpha-root .alpha-npc-card { display: flex; align-items: center; gap: 11px; text-align: left; padding: 12px; background: var(--alpha-surface); width: 100%; }
#npc-state-alpha-root .alpha-npc-card.selected { background: #293c56; border-color: #9dbef1; }
#npc-state-alpha-root .alpha-avatar-container { width: 38px; height: 38px; border-radius: 10px; overflow: hidden; display: grid; place-items: center; background: #354964; color: #e0ebff; flex: 0 0 38px; }
#npc-state-alpha-root .alpha-avatar-img { width: 100%; height: 100%; object-fit: cover; }
#npc-state-alpha-root .alpha-npc-summary { display: flex; min-width: 0; flex-direction: column; gap: 5px; }
#npc-state-alpha-root .alpha-npc-name-row, #npc-state-alpha-root .alpha-npc-meta-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; overflow-wrap: anywhere; }
#npc-state-alpha-root .alpha-role-text { font-size: 13px; color: var(--alpha-muted); font-weight: 400; }
#npc-state-alpha-root .alpha-badge { display: inline-block; font-size: 12px; font-weight: 600; border-radius: 5px; padding: 2px 6px; color: #cbdaf2; background: #2c3c53; }
#npc-state-alpha-root .status-present { background: #234338; color: #b9f3d4; }
#npc-state-alpha-root .status-deceased, #npc-state-alpha-root .alpha-badge-danger { background: #4a2b33; color: #ffd1d1; }
#npc-state-alpha-root .alpha-dossier-main { min-width: 0; }
#npc-state-alpha-root .alpha-empty-detail, #npc-state-alpha-root .alpha-welcome { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; min-height: 280px; height: 100%; padding: 32px 20px; color: var(--alpha-muted); }
#npc-state-alpha-root .alpha-empty-detail h3, #npc-state-alpha-root .alpha-welcome h3 { color: var(--alpha-text); }
#npc-state-alpha-root .alpha-empty-detail p, #npc-state-alpha-root .alpha-welcome p { max-width: 460px; }
#npc-state-alpha-root .alpha-welcome-mark { color: #bfd5fc; background: #293e5b; border: 1px solid #5c789c; border-radius: 18px; padding: 12px 21px; margin-bottom: 20px; font-size: 28px; font-weight: 600; }
#npc-state-alpha-root .alpha-no-npcs { color: var(--alpha-muted); padding: 16px 4px; font-size: 14px; }
#npc-state-alpha-root .alpha-detail-header, #npc-state-alpha-root .alpha-editor-header, #npc-state-alpha-root .alpha-diag-header { display: flex; justify-content: space-between; gap: 14px; align-items: center; flex-wrap: wrap; margin-bottom: 20px; }
#npc-state-alpha-root .alpha-header-left, #npc-state-alpha-root .alpha-header-actions, #npc-state-alpha-root .alpha-diag-actions, #npc-state-alpha-root .alpha-editor-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
#npc-state-alpha-root .alpha-detail-portrait { width: 56px; height: 56px; object-fit: cover; border-radius: 10px; }
#npc-state-alpha-root .alpha-npc-subtitle, #npc-state-alpha-root .alpha-revision-tag { color: var(--alpha-muted); font-size: 13px; overflow-wrap: anywhere; }
#npc-state-alpha-root .alpha-section, #npc-state-alpha-root .alpha-settings-group, #npc-state-alpha-root .alpha-editor-section { border: 1px solid var(--alpha-border); border-radius: 12px; background: var(--alpha-surface); padding: 18px; margin-bottom: 18px; }
#npc-state-alpha-root .alpha-grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 18px; }
#npc-state-alpha-root .alpha-field-block { margin-top: 16px; }
#npc-state-alpha-root .alpha-field-label, #npc-state-alpha-root .alpha-setting-help, #npc-state-alpha-root .alpha-help-text { font-size: 13px; line-height: 1.6; color: var(--alpha-muted); opacity: 1; }
#npc-state-alpha-root .alpha-field-label { margin-bottom: 5px; font-weight: 600; }
#npc-state-alpha-root .alpha-field-val, #npc-state-alpha-root .alpha-section { overflow-wrap: anywhere; }
#npc-state-alpha-root .alpha-axes-grid, #npc-state-alpha-root .alpha-diag-stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }
#npc-state-alpha-root .alpha-axis-card, #npc-state-alpha-root .alpha-stat-card { border: 1px solid var(--alpha-border); border-radius: 9px; padding: 12px 8px; text-align: center; background: var(--alpha-input); }
#npc-state-alpha-root .alpha-axis-name, #npc-state-alpha-root .alpha-stat-label { font-size: 12px; color: var(--alpha-muted); }
#npc-state-alpha-root .alpha-axis-value, #npc-state-alpha-root .alpha-stat-value { font-size: 23px; font-weight: 650; color: #dce8ff; }
#npc-state-alpha-root .alpha-axis-milestone, #npc-state-alpha-root .alpha-axis-progress { font-size: 12px; color: var(--alpha-muted); overflow-wrap: anywhere; }
#npc-state-alpha-root .alpha-history-list { margin: 10px 0; padding-left: 22px; }
#npc-state-alpha-root .alpha-history-list li { margin-bottom: 10px; }
#npc-state-alpha-root .alpha-obs-item { border: 1px solid var(--alpha-border); border-radius: 8px; padding: 12px; margin-top: 10px; }
#npc-state-alpha-root .alpha-obs-header { display: flex; flex-wrap: wrap; gap: 10px; font-size: 13px; color: var(--alpha-muted); }
#npc-state-alpha-root .alpha-editor-container, #npc-state-alpha-root .alpha-settings-container, #npc-state-alpha-root .alpha-diagnostics-container { max-width: 900px; margin: auto; }
#npc-state-alpha-root .alpha-settings-desc { color: var(--alpha-muted); }
#npc-state-alpha-root .alpha-setting-row { display: grid; grid-template-columns: minmax(190px, 1fr) minmax(160px, 1fr); column-gap: 24px; row-gap: 7px; padding: 16px 0; border-top: 1px solid #354255; align-items: center; }
#npc-state-alpha-root .alpha-setting-row .alpha-setting-help { grid-column: 1 / -1; max-width: 720px; }
#npc-state-alpha-root .alpha-checkbox-label { display: flex; align-items: center; gap: 10px; grid-column: 1 / -1; cursor: pointer; }
#npc-state-alpha-root .alpha-form-group { margin-bottom: 18px; }
#npc-state-alpha-root .alpha-form-label, #npc-state-alpha-root .alpha-setting-label { font-weight: 600; display: block; }
#npc-state-alpha-root .alpha-form-label-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 7px; }
#npc-state-alpha-root .alpha-lock-toggle { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; color: var(--alpha-muted); margin: 4px 8px 4px 0; }
#npc-state-alpha-root .alpha-settings-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 10px; padding: 12px 0; }
#npc-state-alpha-root .alpha-settings-feedback { padding: 12px; border-radius: 8px; }
#npc-state-alpha-root .alpha-diag-filters { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 18px; }
#npc-state-alpha-root .alpha-diag-filters label { flex: 1; min-width: 180px; }
#npc-state-alpha-root .alpha-diag-table-wrap { overflow: auto; border: 1px solid var(--alpha-border); border-radius: 10px; }
#npc-state-alpha-root .alpha-diag-table { width: 100%; border-collapse: collapse; font-size: 13px; }
#npc-state-alpha-root .alpha-diag-table :is(th, td) { padding: 12px; text-align: left; vertical-align: top; border-bottom: 1px solid var(--alpha-border); }
#npc-state-alpha-root .alpha-diag-table th { background: #263246; color: #e3ecfa; }
#npc-state-alpha-root .alpha-diag-table code { color: #cad8ed; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 760px) {
  #npc-state-alpha-root .alpha-extension-panel { inset: 10px; width: auto; height: auto; border-radius: 12px; }
  #npc-state-alpha-root .alpha-top-bar, #npc-state-alpha-root .alpha-toolbar { padding: 12px; gap: 10px; }
  #npc-state-alpha-root .alpha-panel-content { padding: 14px; }
  #npc-state-alpha-root .alpha-dossier-layout { grid-template-columns: minmax(0, 1fr); }
  #npc-state-alpha-root .alpha-dossier-sidebar { border-right: 0; border-bottom: 1px solid var(--alpha-border); padding: 0 0 16px; }
  #npc-state-alpha-root .alpha-npc-list { max-height: 220px; overflow: auto; }
  #npc-state-alpha-root .alpha-setting-row { grid-template-columns: minmax(0, 1fr); }
  #npc-state-alpha-root .alpha-axes-grid, #npc-state-alpha-root .alpha-diag-stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  #npc-state-alpha-root .alpha-grid-2 { grid-template-columns: minmax(0, 1fr); }
  #npc-state-alpha-root .alpha-brand-section > strong { font-size: 18px; }
  #npc-state-alpha-root .alpha-dev-status { font-size: 12px; }
  #npc-state-alpha-root .alpha-quick-actions { width: 100%; }
}
`;
