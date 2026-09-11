/**
 * NPC State Alpha - live SillyTavern generation-interceptor bridge.
 *
 * SillyTavern passes generate_interceptor a prompt-time projection of ChatMessage[]:
 * message text may already have regex transforms, file content, media titles, and
 * other prompt-only formatting applied. Those projected bytes are not canonical
 * source bytes and must not be compared directly with ctx.chat for provenance.
 *
 * This bridge uses stable host metadata copied into the projection to prove which
 * current user message triggered the interceptor. Only after that unique binding is
 * established does it give the adapter a shallow clone of authoritative ctx.chat.
 * The adapter therefore continues to own exact raw text fingerprints, swipe data,
 * preceding lineage, branch checks, validation, and commits.
 */

import { stripMachineTrailer } from '../runtime/source-resolver.js';

function timestampKey(value) {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? `date:${ms}` : `date:${String(value)}`;
  }
  return `${typeof value}:${String(value)}`;
}

function swipeValue(message) {
  if (!message || typeof message !== 'object') return undefined;
  if (message.swipe_id !== undefined && message.swipe_id !== null) return message.swipe_id;
  return undefined;
}

function findLatestUserIndex(chat) {
  if (!Array.isArray(chat)) return -1;
  for (let index = chat.length - 1; index >= 0; index--) {
    const message = chat[index];
    if (message && message.is_user && !message.is_system) return index;
  }
  return -1;
}

/**
 * Strip only a structurally recognized Alpha trailer from the actual generation
 * projection. Replacing the projected array element preserves raw ctx.chat objects.
 */
export function sanitizeGenerationProjection(coreChat) {
  if (!Array.isArray(coreChat)) return coreChat;
  for (let index = 0; index < coreChat.length; index++) {
    const message = coreChat[index];
    if (!message || message.is_user || message.is_system || typeof message.mes !== 'string') continue;
    const clean = stripMachineTrailer(message.mes);
    if (clean !== message.mes) coreChat[index] = { ...message, mes: clean };
  }
  return coreChat;
}

/**
 * Return a capture-only clone of authoritative ctx.chat when the latest projected
 * user can be bound uniquely to the latest authoritative user by stable host
 * metadata. Otherwise return null and let the adapter's conservative legacy path
 * decide whether exact byte/lineage matching is possible.
 */
export function buildAuthoritativeCaptureView(coreChat, rawChat) {
  if (!Array.isArray(coreChat) || !Array.isArray(rawChat) || rawChat.length === 0) return null;

  const coreUserIndex = findLatestUserIndex(coreChat);
  const rawUserIndex = findLatestUserIndex(rawChat);
  if (coreUserIndex < 0 || rawUserIndex < 0) return null;

  const coreUser = coreChat[coreUserIndex];
  const rawUser = rawChat[rawUserIndex];
  const coreTime = timestampKey(coreUser?.send_date);
  const rawTime = timestampKey(rawUser?.send_date);

  // send_date is copied unchanged by SillyTavern when it constructs coreChat.
  // Without it, do not synthesize a binding here; preserve the adapter's fail-closed
  // exact matching behavior for nonstandard hosts and deterministic fixtures.
  if (coreTime === null || rawTime === null || coreTime !== rawTime) return null;

  const coreSwipe = swipeValue(coreUser);
  const rawSwipe = swipeValue(rawUser);
  if (coreSwipe !== undefined && rawSwipe !== undefined && coreSwipe !== rawSwipe) return null;

  // Ensure the metadata tuple identifies exactly one authoritative USER message.
  // This avoids silently treating a timestamp collision as request identity.
  let matches = 0;
  for (const message of rawChat) {
    if (!message || !message.is_user || message.is_system) continue;
    if (timestampKey(message.send_date) !== coreTime) continue;
    const candidateSwipe = swipeValue(message);
    if (coreSwipe !== undefined && candidateSwipe !== undefined && coreSwipe !== candidateSwipe) continue;
    matches += 1;
  }
  if (matches !== 1) return null;

  // Shallow cloning is intentional. handleGenerateInterceptor may replace array
  // elements while sanitizing prompt transport; it must never replace rawChat entries.
  return rawChat.map((message) => (
    message && typeof message === 'object' ? { ...message } : message
  ));
}

/**
 * Install the production manifest hook after SillyTavernAdapter.initialize().
 * Idempotent for a given adapter instance.
 */
export function installGenerationInterceptorBridge(adapter) {
  if (!adapter?.initialized || typeof globalThis === 'undefined' || !adapter.interceptorKey) return false;

  const key = adapter.interceptorKey;
  const existing = globalThis[key];
  if (existing?.npcStateAlphaBridgeAdapter === adapter) return true;

  const bridge = async (coreChat, contextSize, abort, type = 'normal') => {
    sanitizeGenerationProjection(coreChat);

    const rawChat = adapter.getContext?.()?.chat;
    const authoritativeView = buildAuthoritativeCaptureView(coreChat, rawChat);
    const captureView = authoritativeView || coreChat;

    return adapter.handleGenerateInterceptor(captureView, contextSize, abort, type);
  };

  Object.defineProperty(bridge, 'npcStateAlphaBridgeAdapter', {
    value: adapter,
    enumerable: false,
    configurable: false,
  });

  globalThis[key] = bridge;
  return true;
}
