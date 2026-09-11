import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PORTRAIT_UPLOAD_MAX_BYTES,
  PortraitUploadError,
  SillyTavernPortraitUploader,
} from '../src/host/portrait-upload.js';

test('Portrait uploader: saves image through SillyTavern and returns only host asset path', async () => {
  let captured = null;
  const uploader = new SillyTavernPortraitUploader({
    now: () => 123456,
    readFileAsDataUrl: async () => 'data:image/png;base64,QUJDRA==',
    moduleLoader: async () => ({
      async saveBase64AsFile(base64, folder, name, extension) {
        captured = { base64, folder, name, extension };
        return 'user/images/npc_state_alpha/vaelia.png';
      },
    }),
  });

  const path = await uploader.upload(
    { type: 'image/png', size: 4, name: 'portrait.png' },
    { npcId: 'npc_1', npcName: 'Vaelia Morne' },
  );

  assert.equal(path, 'user/images/npc_state_alpha/vaelia.png');
  assert.deepEqual(captured, {
    base64: 'QUJDRA==',
    folder: 'npc_state_alpha',
    name: 'Vaelia_Morne_npc_1_123456',
    extension: 'png',
  });
  assert.equal(path.startsWith('data:'), false);
});

test('Portrait uploader: rejects unsupported and oversized files before upload', async () => {
  let loadCalls = 0;
  const uploader = new SillyTavernPortraitUploader({
    moduleLoader: async () => {
      loadCalls += 1;
      return { saveBase64AsFile() {} };
    },
  });

  await assert.rejects(
    uploader.upload({ type: 'text/plain', size: 10 }, { npcId: 'npc_1' }),
    (error) => error instanceof PortraitUploadError && error.code === 'portrait_type_unsupported',
  );
  await assert.rejects(
    uploader.upload({ type: 'image/jpeg', size: PORTRAIT_UPLOAD_MAX_BYTES + 1 }, { npcId: 'npc_1' }),
    (error) => error instanceof PortraitUploadError && error.code === 'portrait_too_large',
  );
  assert.equal(loadCalls, 0);
});

test('Portrait uploader: rejects data returned as a canonical path', async () => {
  const uploader = new SillyTavernPortraitUploader({
    readFileAsDataUrl: async () => 'data:image/webp;base64,QUJDRA==',
    moduleLoader: async () => ({
      async saveBase64AsFile() { return 'data:image/webp;base64,QUJDRA=='; },
    }),
  });
  await assert.rejects(
    uploader.upload({ type: 'image/webp', size: 4 }, { npcId: 'npc_1' }),
    (error) => error instanceof PortraitUploadError && error.code === 'portrait_upload_invalid_path',
  );
});
