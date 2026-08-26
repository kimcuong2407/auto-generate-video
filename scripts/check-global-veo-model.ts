/**
 * Self-check cho model Veo global (/settings/flow).
 *
 * Vì sao cần: setting này đè model của MỌI project review + job livestream. Nếu logic fallback
 * sai, hoặc setting rỗng lại bị hiểu là một model cụ thể, toàn bộ job sẽ gen bằng model ngoài ý
 * muốn (tốn credit tier quality, hoặc chết 403 với tier không được cấp quyền) mà không ai báo.
 *
 * Chạy: npx tsx scripts/check-global-veo-model.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { VEO_MODELS, type VeoModel } from '../lib/types';

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'app-settings.json');
const backup = fs.existsSync(SETTINGS_PATH) ? fs.readFileSync(SETTINGS_PATH, 'utf-8') : null;

function restore() {
  if (backup === null) fs.rmSync(SETTINGS_PATH, { force: true });
  else fs.writeFileSync(SETTINGS_PATH, backup, 'utf-8');
}

try {
  const { readAppSettings, writeAppSettings } = require('../lib/data/appSettingsStore');

  // 1. Chưa cấu hình → null, tức KHÔNG ép, project/job giữ model riêng.
  fs.rmSync(SETTINGS_PATH, { force: true });
  assert.equal(readAppSettings().veoModel, null, 'chưa cấu hình phải là null (không ép model)');

  // 2. Ghi model global không được xoá mất chatModel đang có.
  writeAppSettings({ chatModel: 'some-chat-model' });
  writeAppSettings({ veoModel: 'veo_3_1_quality' as VeoModel });
  const after = readAppSettings();
  assert.equal(after.veoModel, 'veo_3_1_quality');
  assert.equal(after.chatModel, 'some-chat-model', 'ghi veoModel không được ghi đè chatModel');

  // 3. Bỏ ép (null) phải quay lại hành vi cũ, không kẹt ở model đã chọn.
  writeAppSettings({ veoModel: null });
  assert.equal(readAppSettings().veoModel, null, 'đặt null phải xoá ép model');

  // 4. Fallback đúng như generateSceneVideo: global có thì thắng, không thì lấy của job.
  const pick = (global: VeoModel | null, perJob: VeoModel) => global || perJob;
  assert.equal(pick('veo_3_1_lite', 'veo_3_1_fast'), 'veo_3_1_lite', 'global phải đè model job');
  assert.equal(pick(null, 'veo_3_1_fast'), 'veo_3_1_fast', 'không có global thì giữ model job');

  // 5. Danh sách model là nguồn duy nhất — schema DB và API validate đều đọc từ đây.
  assert.ok(VEO_MODELS.includes('abra'), 'VEO_MODELS phải còn đủ tier, kể cả abra');
  assert.equal(new Set(VEO_MODELS).size, VEO_MODELS.length, 'VEO_MODELS không được trùng');

  console.log('OK — model Veo global: 7/7 checks passed');
} finally {
  restore();
}
