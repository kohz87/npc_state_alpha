/**
 * NPC State Alpha — user-owned portrait upload boundary.
 *
 * Image bytes are handed to SillyTavern's own user-image helper. Alpha stores
 * only the returned host asset path in canonical state; inline image data and
 * provider credentials are never persisted in the dossier.
 */

export const SILLYTAVERN_UTILS_MODULE = '/scripts/utils.js';
export const PORTRAIT_UPLOAD_MAX_BYTES = 10 * 1024 * 1024;

const MIME_TO_EXTENSION = Object.freeze({
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
});

export class PortraitUploadError extends Error {
  constructor(message, code, options = {}) {
    super(message, options);
    this.name = 'PortraitUploadError';
    this.code = code;
  }
}

function safeName(value, fallback = 'npc') {
  const cleaned = String(value || '')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
  return cleaned || fallback;
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (typeof FileReader !== 'function') {
      reject(new PortraitUploadError('Browser FileReader is unavailable.', 'portrait_file_reader_unavailable'));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new PortraitUploadError('Could not read the selected portrait image.', 'portrait_read_failed'));
    reader.readAsDataURL(file);
  });
}

function base64Payload(dataUrl) {
  const value = String(dataUrl || '');
  const comma = value.indexOf(',');
  if (comma < 0 || !/^data:image\//i.test(value)) {
    throw new PortraitUploadError('Selected portrait did not decode as an image.', 'portrait_invalid_data');
  }
  const payload = value.slice(comma + 1);
  if (!payload) throw new PortraitUploadError('Selected portrait is empty.', 'portrait_invalid_data');
  return payload;
}

export class SillyTavernPortraitUploader {
  constructor(options = {}) {
    this.moduleLoader = options.moduleLoader || ((specifier) => import(specifier));
    this.readFileAsDataUrl = options.readFileAsDataUrl || readAsDataUrl;
    this.now = options.now || (() => Date.now());
  }

  async upload(file, { npcId, npcName } = {}) {
    if (!file || typeof file !== 'object') {
      throw new PortraitUploadError('Choose an image file to attach as the portrait.', 'portrait_file_required');
    }
    const mime = String(file.type || '').toLowerCase();
    const extension = MIME_TO_EXTENSION[mime];
    if (!extension) {
      throw new PortraitUploadError('Portrait must be a PNG, JPEG, WebP, or GIF image.', 'portrait_type_unsupported');
    }
    const size = Number(file.size);
    if (Number.isFinite(size) && size > PORTRAIT_UPLOAD_MAX_BYTES) {
      throw new PortraitUploadError('Portrait image must be 10 MB or smaller.', 'portrait_too_large');
    }

    let utils;
    try {
      utils = await this.moduleLoader(SILLYTAVERN_UTILS_MODULE);
    } catch (error) {
      throw new PortraitUploadError('Could not load SillyTavern image utilities.', 'portrait_host_unavailable', { cause: error });
    }
    if (typeof utils?.saveBase64AsFile !== 'function') {
      throw new PortraitUploadError('SillyTavern image upload helper is unavailable.', 'portrait_host_unavailable');
    }

    const dataUrl = await this.readFileAsDataUrl(file);
    const base64 = base64Payload(dataUrl);
    const stem = `${safeName(npcName || npcId)}_${safeName(npcId)}_${this.now()}`;
    let path;
    try {
      path = await utils.saveBase64AsFile(base64, 'npc_state_alpha', stem, extension);
    } catch (error) {
      throw new PortraitUploadError(`SillyTavern could not save the portrait. ${error?.message || error}`, 'portrait_upload_failed', { cause: error });
    }
    if (typeof path !== 'string' || path.trim() === '' || /^data:/i.test(path)) {
      throw new PortraitUploadError('SillyTavern did not return a usable portrait asset path.', 'portrait_upload_invalid_path');
    }
    return path.trim();
  }
}
