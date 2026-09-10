/**
 * NPC State Alpha — UI DOM Utilities
 * Safe HTML escaping and element helpers.
 */

export function escapeHtml(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export function createElement(tag, attributes = {}, innerHtml = '') {
  if (typeof document === 'undefined') return null;
  const el = document.createElement(tag);
  for (const [key, val] of Object.entries(attributes)) {
    if (key === 'className') {
      el.className = val;
    } else if (key.startsWith('on') && typeof val === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (val !== null && val !== undefined) {
      el.setAttribute(key, String(val));
    }
  }
  if (innerHtml) {
    el.innerHTML = innerHtml;
  }
  return el;
}
