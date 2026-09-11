/**
 * Scoped NPC State Alpha UI styles.
 *
 * The opened dossier surface adapts the portrait-first visual language from
 * npc_state_beta 0.5.x to Alpha's own DOM and canonical state. The launcher is
 * intentionally retained. There is no runtime dependency on Beta.
 */
export const ALPHA_UI_STYLES = `
#npc-state-alpha-root {
  --alpha-bg: var(--SmartThemeBlurTintColor, #1c1c1f);
  --alpha-text: var(--SmartThemeBodyColor, #eee);
  --alpha-muted: color-mix(in srgb, var(--alpha-text) 66%, transparent);
  --alpha-paper: rgba(245, 238, 220, .075);
  --alpha-surface: rgba(255, 255, 255, .045);
  --alpha-surface-strong: rgba(255, 255, 255, .075);
  --alpha-input: rgba(0, 0, 0, .24);
  --alpha-line: rgba(216, 190, 145, .22);
  --alpha-line-strong: rgba(216, 190, 145, .5);
  --alpha-gold: #d8bc78;
  --alpha-gold-soft: #ead9ad;
  --alpha-danger: #efaaaa;
  --alpha-success: #9bd4b7;
  position: relative;
  z-index: 10000;
  color: var(--alpha-text);
  font: 400 14px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
#npc-state-alpha-root *,
#npc-state-alpha-root *::before,
#npc-state-alpha-root *::after {
  box-sizing: border-box;
  text-shadow: none;
}
#npc-state-alpha-root :is(button, input, select, textarea) {
  font: inherit;
  color: var(--alpha-text);
  background: var(--alpha-input);
  border: 1px solid var(--alpha-line);
  border-radius: 8px;
  box-shadow: none;
  filter: none;
  opacity: 1;
  margin: 0;
  min-width: 0;
  max-width: 100%;
}
#npc-state-alpha-root :is(input:not([type="checkbox"]), select, textarea) {
  width: 100%;
  min-height: 38px;
  padding: 8px 10px;
}
#npc-state-alpha-root input[type="checkbox"] {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  accent-color: var(--alpha-gold);
}
#npc-state-alpha-root textarea { resize: vertical; line-height: 1.55; }
#npc-state-alpha-root input::placeholder,
#npc-state-alpha-root textarea::placeholder { color: var(--alpha-muted); opacity: .72; }
#npc-state-alpha-root button,
#npc-state-alpha-root label.alpha-btn {
  appearance: none;
  cursor: pointer;
  min-height: 36px;
  padding: 7px 12px;
  line-height: 1.3;
  font-weight: 600;
  color: var(--alpha-text);
  background: rgba(255, 255, 255, .055);
  border: 1px solid var(--alpha-line);
  border-radius: 8px;
  box-shadow: none;
  white-space: normal;
  text-align: center;
}
#npc-state-alpha-root button:hover:not(:disabled),
#npc-state-alpha-root label.alpha-btn:hover {
  background: rgba(216, 190, 145, .11);
  border-color: var(--alpha-line-strong);
}
#npc-state-alpha-root button:disabled {
  opacity: .48;
  cursor: not-allowed;
}
#npc-state-alpha-root :is(button, input, select, textarea, a, label.alpha-btn):focus-visible {
  outline: 2px solid var(--alpha-gold);
  outline-offset: 2px;
}
#npc-state-alpha-root :is(h2, h3, h4, p) { color: inherit; padding: 0; }
#npc-state-alpha-root h2 { font-size: 1.85rem; line-height: 1.12; margin: 0; }
#npc-state-alpha-root h3 { font-size: 1.35rem; line-height: 1.25; margin: 0 0 6px; }
#npc-state-alpha-root h4 { font-size: .93rem; line-height: 1.35; margin: 0 0 12px; }
#npc-state-alpha-root p { margin: 0; }
#npc-state-alpha-root strong { font-weight: 650; }

/* Existing side launcher intentionally retained. */
#npc-state-alpha-root .alpha-launcher {
  position: fixed;
  right: 20px;
  bottom: 76px;
  border-radius: 12px;
  padding: 11px 17px;
  background: #263a55;
  border-color: #8aa3c8;
  box-shadow: 0 5px 20px #0006;
}

/* Beta 0.5-style centered dossier shell. */
#npc-state-alpha-root .alpha-extension-panel {
  position: fixed;
  z-index: 2147483500;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: min(1320px, 97vw);
  height: min(940px, 96dvh);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  color: var(--alpha-text);
  background: var(--alpha-bg);
  border: 1px solid var(--alpha-line);
  border-radius: 15px;
  box-shadow: 0 0 0 100vmax rgba(0, 0, 0, .72), 0 20px 70px rgba(0, 0, 0, .55);
}
#npc-state-alpha-root .alpha-top-bar {
  flex: 0 0 auto;
  min-height: 54px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px 8px 15px;
  border-bottom: 1px solid var(--alpha-line);
  background: color-mix(in srgb, var(--alpha-bg) 94%, black 6%);
}
#npc-state-alpha-root .alpha-brand-section,
#npc-state-alpha-root .alpha-brand-copy,
#npc-state-alpha-root .alpha-header-left,
#npc-state-alpha-root .alpha-header-actions,
#npc-state-alpha-root .alpha-diag-actions,
#npc-state-alpha-root .alpha-editor-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}
#npc-state-alpha-root .alpha-brand-copy { align-items: baseline; }
#npc-state-alpha-root .alpha-brand-copy > strong { font-size: 1.03rem; white-space: nowrap; }
#npc-state-alpha-root .alpha-kicker {
  display: inline-block;
  font-size: .68rem;
  line-height: 1.2;
  letter-spacing: .14em;
  text-transform: uppercase;
  color: var(--alpha-gold);
  opacity: .78;
}
#npc-state-alpha-root .alpha-dev-status {
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  padding: 4px 9px;
  border: 1px solid rgba(255, 255, 255, .1);
  border-radius: 999px;
  color: var(--alpha-muted);
  background: rgba(0, 0, 0, .16);
  font-size: .74rem;
  overflow-wrap: anywhere;
}
#npc-state-alpha-root .alpha-close {
  flex: 0 0 auto;
  min-width: 66px;
  border-color: var(--alpha-line);
  background: rgba(0, 0, 0, .12);
}
#npc-state-alpha-root .alpha-toolbar {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 12px;
  border-bottom: 1px solid rgba(216, 190, 145, .13);
  background: rgba(0, 0, 0, .08);
}
#npc-state-alpha-root .alpha-nav-tabs,
#npc-state-alpha-root .alpha-quick-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
#npc-state-alpha-root .alpha-tab-btn {
  min-height: 32px;
  padding: 5px 10px;
  color: var(--alpha-muted);
  background: transparent;
  border-color: transparent;
}
#npc-state-alpha-root .alpha-tab-btn.active {
  color: var(--alpha-gold-soft);
  background: rgba(216, 190, 145, .08);
  border-color: var(--alpha-line);
}
#npc-state-alpha-root .alpha-btn-primary {
  color: #201a0f;
  background: var(--alpha-gold);
  border-color: var(--alpha-gold);
}
#npc-state-alpha-root .alpha-btn-primary:hover:not(:disabled) {
  color: #17130b;
  background: var(--alpha-gold-soft);
  border-color: var(--alpha-gold-soft);
}
#npc-state-alpha-root .alpha-btn-danger {
  color: #ffd4d4;
  background: rgba(126, 48, 56, .42);
  border-color: rgba(224, 113, 122, .42);
}
#npc-state-alpha-root .alpha-panel-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  padding: 0;
  background: rgba(0, 0, 0, .025);
}
#npc-state-alpha-root .alpha-status-banner {
  flex: 0 0 auto;
  padding: 9px 14px;
  border-bottom: 1px solid var(--alpha-line);
  overflow-wrap: anywhere;
}
#npc-state-alpha-root .alpha-status-error { color: #ffd1d1; background: rgba(112, 45, 51, .42); }
#npc-state-alpha-root .alpha-status-success { color: #c8f0d9; background: rgba(42, 101, 72, .33); }
#npc-state-alpha-root .alpha-status-info { color: #e5dcc4; background: rgba(113, 93, 51, .27); }

/* Portrait-first dossier library. */
#npc-state-alpha-root .alpha-dossier-library {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  overflow: hidden;
}
#npc-state-alpha-root .alpha-dossier-stage { min-height: 0; overflow: hidden; }
#npc-state-alpha-root .alpha-dossier-spread {
  height: 100%;
  min-height: 0;
  display: grid;
  grid-template-columns: minmax(320px, 36%) minmax(0, 1fr);
  overflow: hidden;
}
#npc-state-alpha-root .alpha-dossier-hero {
  min-width: 0;
  min-height: 0;
  display: grid;
  grid-template-rows: minmax(0, 1fr) auto;
  overflow: hidden;
  border-right: 1px solid rgba(216, 190, 145, .16);
  background: rgba(0, 0, 0, .25);
}
#npc-state-alpha-root .alpha-hero-media {
  position: relative;
  min-height: 0;
  overflow: hidden;
  background: rgba(0, 0, 0, .28);
}
#npc-state-alpha-root .alpha-hero-portrait {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  object-fit: cover;
  object-position: center 18%;
}
#npc-state-alpha-root .alpha-hero-placeholder {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  background: radial-gradient(circle at 50% 30%, rgba(216, 190, 145, .16), rgba(0, 0, 0, .18));
  color: var(--alpha-gold);
  font-family: Georgia, "Times New Roman", serif;
}
#npc-state-alpha-root .alpha-hero-placeholder span { font-size: clamp(4rem, 8vw, 7rem); opacity: .62; }
#npc-state-alpha-root .alpha-hero-caption {
  position: absolute;
  z-index: 2;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 100px 24px 22px;
  background: linear-gradient(to bottom, rgba(5, 6, 8, 0), rgba(5, 6, 8, .62) 43%, rgba(5, 6, 8, .94) 100%);
  color: #f4f1e9;
  text-shadow: 0 2px 5px rgba(0, 0, 0, .92);
}
#npc-state-alpha-root .alpha-hero-caption h2 {
  margin: 4px 0 5px;
  color: #fff4d7;
  font-family: Georgia, "Times New Roman", serif;
  font-size: clamp(1.7rem, 2.4vw, 2.2rem);
}
#npc-state-alpha-root .alpha-hero-caption p { max-width: 38ch; color: rgba(244, 241, 233, .84); }
#npc-state-alpha-root .alpha-hero-badges { display: flex; flex-wrap: wrap; gap: 5px 7px; margin-top: 10px; }
#npc-state-alpha-root .alpha-hero-actions {
  position: relative;
  z-index: 3;
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 7px;
  padding: 9px;
  border-top: 1px solid rgba(216, 190, 145, .12);
  background: color-mix(in srgb, var(--alpha-bg) 90%, black 10%);
}
#npc-state-alpha-root .alpha-btn-portrait { display: grid; place-items: center; position: relative; overflow: hidden; }
#npc-state-alpha-root .alpha-btn-portrait input[type="file"] { position: absolute; inline-size: 1px; block-size: 1px; opacity: 0; pointer-events: none; padding: 0; min-height: 0; }
#npc-state-alpha-root .alpha-dossier-document {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 22px clamp(18px, 2.2vw, 30px) 34px;
  scrollbar-color: rgba(216, 190, 145, .35) transparent;
}
#npc-state-alpha-root .alpha-dossier-document-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 15px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--alpha-line);
}
#npc-state-alpha-root .alpha-dossier-document-head .alpha-btn-toggle-diagnostics { min-height: 30px; padding: 4px 9px; font-size: .72rem; color: var(--alpha-muted); }
#npc-state-alpha-root .alpha-npc-subtitle,
#npc-state-alpha-root .alpha-revision-tag { color: var(--alpha-muted); font-size: .77rem; overflow-wrap: anywhere; }
#npc-state-alpha-root .alpha-section,
#npc-state-alpha-root .alpha-settings-group,
#npc-state-alpha-root .alpha-editor-section {
  margin: 0 0 14px;
  padding: 14px 15px;
  border: 1px solid rgba(216, 190, 145, .14);
  border-radius: 10px;
  background: var(--alpha-surface);
}
#npc-state-alpha-root .alpha-diagnostic-section { border-style: dashed; background: rgba(0, 0, 0, .1); }
#npc-state-alpha-root .alpha-section-title,
#npc-state-alpha-root .alpha-group-title,
#npc-state-alpha-root .alpha-section-heading {
  color: var(--alpha-gold-soft);
  font-family: Georgia, "Times New Roman", serif;
  letter-spacing: .015em;
}
#npc-state-alpha-root .alpha-grid-2 { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px 14px; }
#npc-state-alpha-root .alpha-fact-grid > div {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 9px;
  border-radius: 7px;
  background: rgba(255, 255, 255, .028);
}
#npc-state-alpha-root .alpha-current-appearance { grid-column: 1 / -1; }
#npc-state-alpha-root .alpha-fact-grid > div > strong { color: var(--alpha-muted); font-size: .72rem; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
#npc-state-alpha-root .alpha-field-block { margin-top: 13px; }
#npc-state-alpha-root .alpha-field-label,
#npc-state-alpha-root .alpha-setting-help,
#npc-state-alpha-root .alpha-help-text { color: var(--alpha-muted); font-size: .78rem; line-height: 1.55; opacity: 1; }
#npc-state-alpha-root .alpha-field-label { margin-bottom: 4px; font-weight: 650; }
#npc-state-alpha-root .alpha-field-val,
#npc-state-alpha-root .alpha-section { overflow-wrap: anywhere; }

/* Relationship meters use the long-standing semantic -100..+100 scale.
   Stored Alpha scores may retain additional configured headroom; the label shows
   the exact stored value while the marker clamps only for this visual scale. */
#npc-state-alpha-root .alpha-relationship-meters {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
  margin: 5px 0 13px;
}
#npc-state-alpha-root .alpha-rel-meter-card {
  min-width: 0;
  padding: 10px 11px 8px;
  border: 1px solid rgba(216, 190, 145, .15);
  border-radius: 8px;
  background: rgba(0, 0, 0, .15);
}
#npc-state-alpha-root .alpha-rel-meter-head { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
#npc-state-alpha-root .alpha-rel-meter-name { color: var(--alpha-muted); font-size: .69rem; letter-spacing: .07em; text-transform: uppercase; }
#npc-state-alpha-root .alpha-rel-meter-score { color: var(--alpha-gold-soft); font-family: Georgia, "Times New Roman", serif; font-size: 1.1rem; font-weight: 600; }
#npc-state-alpha-root .alpha-rel-track {
  position: relative;
  height: 9px;
  margin-top: 7px;
  border: 1px solid rgba(216, 190, 145, .24);
  border-radius: 999px;
  background: linear-gradient(90deg, rgba(188, 93, 105, .32), rgba(255, 255, 255, .07) 50%, rgba(111, 176, 140, .32));
}
#npc-state-alpha-root .alpha-rel-zero { position: absolute; left: 50%; top: -3px; bottom: -3px; width: 1px; background: rgba(232, 222, 198, .48); }
#npc-state-alpha-root .alpha-rel-marker { position: absolute; top: 50%; width: 12px; height: 12px; transform: translate(-50%, -50%); border: 2px solid var(--alpha-gold-soft); border-radius: 999px; background: color-mix(in srgb, var(--alpha-bg) 82%, black 18%); box-shadow: 0 0 0 2px rgba(0, 0, 0, .3); }
#npc-state-alpha-root .alpha-rel-scale { display: flex; justify-content: space-between; margin-top: 3px; color: var(--alpha-muted); font-size: .58rem; opacity: .72; }
#npc-state-alpha-root .alpha-rel-milestone { margin-top: 2px; color: var(--alpha-muted); font-size: .68rem; text-align: right; text-transform: capitalize; }

#npc-state-alpha-root .alpha-axes-grid,
#npc-state-alpha-root .alpha-diag-stats-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin: 12px 0 14px; }
#npc-state-alpha-root .alpha-axis-card,
#npc-state-alpha-root .alpha-stat-card {
  min-width: 0;
  padding: 10px 7px;
  text-align: center;
  border: 1px solid rgba(216, 190, 145, .15);
  border-radius: 8px;
  background: rgba(0, 0, 0, .15);
}
#npc-state-alpha-root .alpha-axis-name,
#npc-state-alpha-root .alpha-stat-label { color: var(--alpha-muted); font-size: .67rem; letter-spacing: .06em; }
#npc-state-alpha-root .alpha-axis-value,
#npc-state-alpha-root .alpha-stat-value { color: var(--alpha-gold-soft); font-family: Georgia, "Times New Roman", serif; font-size: 1.35rem; font-weight: 600; }
#npc-state-alpha-root .alpha-axis-milestone,
#npc-state-alpha-root .alpha-axis-progress { color: var(--alpha-muted); font-size: .68rem; overflow-wrap: anywhere; }
#npc-state-alpha-root .alpha-history-list { margin: 8px 0 0; padding-left: 20px; }
#npc-state-alpha-root .alpha-history-list li { margin-bottom: 7px; }
#npc-state-alpha-root .alpha-obs-item { margin-top: 8px; padding: 10px; border: 1px solid rgba(216, 190, 145, .13); border-radius: 8px; background: rgba(0, 0, 0, .1); }
#npc-state-alpha-root .alpha-obs-header { display: flex; flex-wrap: wrap; gap: 8px; color: var(--alpha-muted); font-size: .72rem; }
#npc-state-alpha-root .alpha-obs-body { margin-top: 5px; }
#npc-state-alpha-root .alpha-badge {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  padding: 3px 7px;
  border: 1px solid rgba(255, 255, 255, .12);
  border-radius: 999px;
  color: var(--alpha-muted);
  background: rgba(0, 0, 0, .24);
  font-size: .68rem;
  font-weight: 600;
}
#npc-state-alpha-root .status-present { color: #92d7b1; }
#npc-state-alpha-root .status-offscreen { color: #aab7c6; }
#npc-state-alpha-root .status-deceased,
#npc-state-alpha-root .alpha-badge-danger { color: #e4aaa9; }
#npc-state-alpha-root .alpha-badge-pending { color: #e5ca8d; }

/* Bottom cast dock and rail. */
#npc-state-alpha-root .alpha-cast-dock {
  flex: 0 0 auto;
  min-height: 146px;
  padding: 9px 12px 11px;
  border-top: 1px solid var(--alpha-line);
  background: color-mix(in srgb, var(--alpha-bg) 93%, black 7%);
}
#npc-state-alpha-root .alpha-cast-dock-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}
#npc-state-alpha-root .alpha-cast-title { display: flex; align-items: baseline; gap: 9px; white-space: nowrap; }
#npc-state-alpha-root .alpha-cast-count { color: var(--alpha-muted); font-size: .72rem; }
#npc-state-alpha-root .alpha-filter-bar { display: flex; align-items: center; justify-content: flex-end; gap: 7px; min-width: 0; width: min(650px, 70%); }
#npc-state-alpha-root .alpha-cast-search { position: relative; flex: 1 1 260px; min-width: 150px; }
#npc-state-alpha-root .alpha-cast-search > span { position: absolute; left: 10px; top: 50%; transform: translateY(-50%); color: var(--alpha-muted); pointer-events: none; }
#npc-state-alpha-root .alpha-cast-search input { padding-left: 28px; }
#npc-state-alpha-root .alpha-filter-selectors { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; flex: 0 1 300px; }
#npc-state-alpha-root .alpha-filter-selectors select { min-height: 34px; padding: 6px 8px; font-size: .75rem; }
#npc-state-alpha-root .alpha-cast-rail {
  display: flex;
  gap: 8px;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 1px 1px 4px;
  scroll-snap-type: x proximity;
  scrollbar-color: rgba(216, 190, 145, .28) transparent;
}
#npc-state-alpha-root .alpha-npc-card {
  position: relative;
  flex: 0 0 152px;
  width: 152px;
  height: 86px;
  min-height: 86px;
  overflow: hidden;
  padding: 0;
  text-align: left;
  scroll-snap-align: start;
  border-radius: 9px;
  background: rgba(255, 255, 255, .045);
}
#npc-state-alpha-root .alpha-npc-card.selected { border-color: var(--alpha-gold); box-shadow: inset 0 0 0 1px var(--alpha-gold); }
#npc-state-alpha-root .alpha-cast-portrait,
#npc-state-alpha-root .alpha-cast-portrait-img,
#npc-state-alpha-root .alpha-cast-portrait-fallback { position: absolute; inset: 0; width: 100%; height: 100%; }
#npc-state-alpha-root .alpha-cast-portrait-img { object-fit: cover; object-position: center 22%; }
#npc-state-alpha-root .alpha-cast-portrait-fallback { display: grid; place-items: center; color: var(--alpha-gold); background: radial-gradient(circle at 50% 30%, rgba(216, 190, 145, .16), rgba(0, 0, 0, .2)); font-family: Georgia, "Times New Roman", serif; font-size: 2rem; }
#npc-state-alpha-root .alpha-cast-overlay {
  position: absolute;
  z-index: 2;
  left: 0;
  right: 0;
  bottom: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 24px 8px 7px;
  color: #f5f1e7;
  background: linear-gradient(transparent, rgba(0, 0, 0, .9));
}
#npc-state-alpha-root .alpha-npc-name-row { display: flex; align-items: center; gap: 5px; min-width: 0; max-width: 100%; }
#npc-state-alpha-root .alpha-npc-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#npc-state-alpha-root .alpha-pending-mark { color: var(--alpha-gold); font-size: .58rem; }
#npc-state-alpha-root .alpha-role-text { max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: rgba(245, 241, 231, .7); font-size: .67rem; }
#npc-state-alpha-root .alpha-cast-overlay .alpha-badge { padding: 1px 5px; border-color: rgba(255, 255, 255, .12); font-size: .6rem; }
#npc-state-alpha-root .alpha-no-npcs { flex: 1 0 100%; display: grid; place-items: center; min-height: 78px; color: var(--alpha-muted); }

/* Settings, diagnostics, editor. */
#npc-state-alpha-root .alpha-settings-container,
#npc-state-alpha-root .alpha-diagnostics-container,
#npc-state-alpha-root .alpha-editor-container {
  height: 100%;
  max-width: 980px;
  margin: 0 auto;
  padding: 22px clamp(16px, 2.5vw, 28px) 34px;
  overflow: auto;
  scrollbar-color: rgba(216, 190, 145, .3) transparent;
}
#npc-state-alpha-root .alpha-view-heading { margin-bottom: 18px; }
#npc-state-alpha-root .alpha-view-heading h3 { margin-top: 4px; font-family: Georgia, "Times New Roman", serif; color: var(--alpha-gold-soft); }
#npc-state-alpha-root .alpha-settings-desc { max-width: 70ch; color: var(--alpha-muted); }
#npc-state-alpha-root .alpha-settings-group,
#npc-state-alpha-root .alpha-editor-section { padding: 0; overflow: hidden; }
#npc-state-alpha-root .alpha-settings-group > h4,
#npc-state-alpha-root .alpha-editor-section > h4 { margin: 0; padding: 11px 14px; border-bottom: 1px solid rgba(216, 190, 145, .13); background: rgba(0, 0, 0, .1); }
#npc-state-alpha-root .alpha-setting-row {
  display: grid;
  grid-template-columns: minmax(230px, 1fr) minmax(190px, 280px);
  gap: 18px;
  align-items: center;
  padding: 12px 14px;
  border-top: 1px solid rgba(255, 255, 255, .055);
}
#npc-state-alpha-root .alpha-settings-group > .alpha-setting-row:first-of-type { border-top: 0; }
#npc-state-alpha-root .alpha-setting-label,
#npc-state-alpha-root .alpha-form-label { display: block; margin-bottom: 3px; font-weight: 650; }
#npc-state-alpha-root .alpha-switch-label { justify-self: end; display: inline-flex; align-items: center; gap: 8px; color: var(--alpha-muted); cursor: pointer; }
#npc-state-alpha-root .alpha-profile-setting-row select { border-color: rgba(216, 190, 145, .34); }
#npc-state-alpha-root .alpha-settings-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; padding: 4px 0 12px; }
#npc-state-alpha-root .alpha-settings-feedback,
#npc-state-alpha-root .alpha-editor-status { padding: 10px 12px; border-radius: 8px; }
#npc-state-alpha-root .alpha-form-group { margin: 0; padding: 12px 14px; border-top: 1px solid rgba(255, 255, 255, .05); }
#npc-state-alpha-root .alpha-editor-section .alpha-form-group:first-of-type { border-top: 0; }
#npc-state-alpha-root .alpha-form-label-row { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 5px; }
#npc-state-alpha-root .alpha-lock-toggle { display: inline-flex; align-items: center; gap: 6px; color: var(--alpha-muted); font-size: .74rem; cursor: pointer; }
#npc-state-alpha-root .alpha-editor-header,
#npc-state-alpha-root .alpha-diag-header { display: flex; justify-content: space-between; align-items: center; gap: 12px; margin-bottom: 16px; }
#npc-state-alpha-root .alpha-editor-header h3,
#npc-state-alpha-root .alpha-diag-header h3 { font-family: Georgia, "Times New Roman", serif; color: var(--alpha-gold-soft); }
#npc-state-alpha-root .alpha-editor-actions { justify-content: space-between; margin-top: 12px; }
#npc-state-alpha-root .alpha-editor-actions > div { display: flex; gap: 7px; }
#npc-state-alpha-root .alpha-diag-filters { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
#npc-state-alpha-root .alpha-diag-filters label { flex: 1 1 190px; }
#npc-state-alpha-root .alpha-diag-table-wrap { overflow: auto; border: 1px solid var(--alpha-line); border-radius: 9px; }
#npc-state-alpha-root .alpha-diag-table { width: 100%; border-collapse: collapse; font-size: .76rem; }
#npc-state-alpha-root .alpha-diag-table :is(th, td) { padding: 9px 10px; text-align: left; vertical-align: top; border-bottom: 1px solid rgba(216, 190, 145, .12); }
#npc-state-alpha-root .alpha-diag-table th { color: var(--alpha-gold-soft); background: rgba(0, 0, 0, .18); }
#npc-state-alpha-root .alpha-diag-table code { color: var(--alpha-muted); white-space: pre-wrap; overflow-wrap: anywhere; }
#npc-state-alpha-root .alpha-empty-detail,
#npc-state-alpha-root .alpha-welcome { height: 100%; min-height: 280px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 9px; padding: 28px 20px; text-align: center; color: var(--alpha-muted); }
#npc-state-alpha-root .alpha-empty-detail h3,
#npc-state-alpha-root .alpha-welcome h3 { color: var(--alpha-gold-soft); font-family: Georgia, "Times New Roman", serif; }
#npc-state-alpha-root .alpha-empty-detail p,
#npc-state-alpha-root .alpha-welcome p { max-width: 480px; }
#npc-state-alpha-root .alpha-welcome-mark { display: grid; place-items: center; width: 64px; height: 64px; margin-bottom: 4px; border: 1px solid var(--alpha-line); border-radius: 999px; color: var(--alpha-gold); background: radial-gradient(circle, rgba(216, 190, 145, .14), rgba(0, 0, 0, .1)); font-family: Georgia, "Times New Roman", serif; font-size: 1.8rem; }

@media (max-width: 900px) {
  #npc-state-alpha-root .alpha-dossier-spread { grid-template-columns: minmax(270px, 38%) minmax(0, 1fr); }
  #npc-state-alpha-root .alpha-filter-bar { width: min(600px, 74%); }
  #npc-state-alpha-root .alpha-axes-grid,
  #npc-state-alpha-root .alpha-diag-stats-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}

@media (max-width: 760px) {
  #npc-state-alpha-root .alpha-extension-panel { width: calc(100vw - 12px); height: calc(100dvh - 12px); border-radius: 11px; }
  #npc-state-alpha-root .alpha-top-bar { min-height: 48px; padding: 7px 9px; }
  #npc-state-alpha-root .alpha-brand-copy .alpha-kicker { display: none; }
  #npc-state-alpha-root .alpha-brand-section { gap: 6px; }
  #npc-state-alpha-root .alpha-dev-status { font-size: .66rem; }
  #npc-state-alpha-root .alpha-toolbar { align-items: flex-start; padding: 6px 8px; }
  #npc-state-alpha-root .alpha-quick-actions { width: 100%; }
  #npc-state-alpha-root .alpha-quick-actions button { flex: 1 1 auto; }
  #npc-state-alpha-root .alpha-dossier-spread { grid-template-columns: 1fr; grid-template-rows: minmax(220px, 38vh) minmax(0, 1fr); }
  #npc-state-alpha-root .alpha-dossier-hero { grid-template-rows: minmax(0, 1fr) auto; border-right: 0; border-bottom: 1px solid var(--alpha-line); }
  #npc-state-alpha-root .alpha-hero-caption { padding: 65px 16px 14px; }
  #npc-state-alpha-root .alpha-hero-caption h2 { font-size: 1.55rem; }
  #npc-state-alpha-root .alpha-hero-actions { grid-template-columns: repeat(2, minmax(0, 1fr)); padding: 6px; }
  #npc-state-alpha-root .alpha-hero-actions :is(button, label.alpha-btn) { min-height: 34px; padding: 5px 6px; font-size: .72rem; }
  #npc-state-alpha-root .alpha-dossier-document { padding: 14px 12px 26px; }
  #npc-state-alpha-root .alpha-relationship-meters { grid-template-columns: minmax(0, 1fr); }
  #npc-state-alpha-root .alpha-cast-dock { min-height: 150px; padding: 7px 8px 9px; }
  #npc-state-alpha-root .alpha-cast-dock-head { align-items: flex-start; flex-direction: column; gap: 5px; }
  #npc-state-alpha-root .alpha-filter-bar { width: 100%; }
  #npc-state-alpha-root .alpha-cast-title { width: 100%; }
  #npc-state-alpha-root .alpha-npc-card { flex-basis: 130px; width: 130px; }
  #npc-state-alpha-root .alpha-setting-row { grid-template-columns: minmax(0, 1fr); gap: 8px; }
  #npc-state-alpha-root .alpha-switch-label { justify-self: start; }
  #npc-state-alpha-root .alpha-grid-2 { grid-template-columns: minmax(0, 1fr); }
  #npc-state-alpha-root .alpha-current-appearance { grid-column: auto; }
  #npc-state-alpha-root .alpha-settings-container,
  #npc-state-alpha-root .alpha-diagnostics-container,
  #npc-state-alpha-root .alpha-editor-container { padding: 14px 12px 26px; }
}
`;
