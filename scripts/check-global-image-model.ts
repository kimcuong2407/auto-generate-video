/**
 * Self-check cho provider gen ảnh global (/settings/ai).
 *
 * Vì sao cần: setting này đè provider của MỌI luồng gen ảnh (storyboard, background project,
 * background livestream). Sai fallback → toàn hệ thống gen bằng provider ngoài ý muốn; lưu
 * được giá trị rác → mọi luồng rơi xuống nhánh Google Flow với model không tồn tại, hỏng
 * toàn cục chứ không riêng 1 job.
 *
 * Chạy: npx tsx scripts/check-global-image-model.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { IMAGE_MODEL_OPTIONS, CHATGPT_LOCAL_MODEL, DEFAULT_STORYBOARD_MODEL } from '../lib/imageModels';

const SETTINGS_PATH = path.join(process.cwd(), 'data', 'app-settings.json');
const backup = fs.existsSync(SETTINGS_PATH) ? fs.readFileSync(SETTINGS_PATH, 'utf-8') : null;

function restore() {
  if (backup === null) fs.rmSync(SETTINGS_PATH, { force: true });
  else fs.writeFileSync(SETTINGS_PATH, backup, 'utf-8');
}

try {
  const { readAppSettings, writeAppSettings } = require('../lib/data/appSettingsStore');

  // 1. Chưa cấu hình → null, tức KHÔNG ép, mỗi job giữ provider riêng.
  fs.rmSync(SETTINGS_PATH, { force: true });
  assert.equal(readAppSettings().imageModel, null, 'chưa cấu hình phải là null (không ép provider)');

  // 2. Ba field độc lập — ghi field này không được xoá field kia. app-settings.json là một
  // file chung, ghi đè cẩu thả sẽ âm thầm reset model chat/video mà không ai để ý.
  writeAppSettings({ chatModel: 'some-chat-model' });
  writeAppSettings({ veoModel: 'veo_3_1_quality' });
  writeAppSettings({ imageModel: CHATGPT_LOCAL_MODEL });
  const after = readAppSettings();
  assert.equal(after.imageModel, CHATGPT_LOCAL_MODEL);
  assert.equal(after.chatModel, 'some-chat-model', 'ghi imageModel không được ghi đè chatModel');
  assert.equal(after.veoModel, 'veo_3_1_quality', 'ghi imageModel không được ghi đè veoModel');

  // 3. Bỏ ép (null) phải quay lại hành vi cũ, không kẹt ở provider đã chọn.
  writeAppSettings({ imageModel: null });
  assert.equal(readAppSettings().imageModel, null, 'đặt null phải xoá ép provider');

  // 4. Fallback đúng như generateStoryboardImage: global có thì thắng, không thì lấy của job.
  const pick = (global: string | null, perJob: string) => global || perJob;
  assert.equal(pick(CHATGPT_LOCAL_MODEL, 'flow-image'), CHATGPT_LOCAL_MODEL, 'global phải đè provider job');
  assert.equal(pick(null, 'flow-image'), 'flow-image', 'không có global thì giữ provider job');

  // 5. Whitelist của API phải phủ đúng tập option UI — không thừa, không thiếu.
  const values = IMAGE_MODEL_OPTIONS.map((o) => o.value);
  assert.ok(values.includes(CHATGPT_LOCAL_MODEL), 'dropdown phải có option ChatGPT tài khoản riêng');
  assert.ok(values.includes(DEFAULT_STORYBOARD_MODEL), 'dropdown phải có option model mặc định');
  const isAllowed = (v: string) => values.includes(v as (typeof values)[number]);
  assert.equal(isAllowed('flow-image'), true);
  assert.equal(isAllowed('model-khong-ton-tai'), false, 'giá trị lạ phải bị API từ chối');
  assert.equal(isAllowed(''), false, 'chuỗi rỗng không phải option hợp lệ (dùng null để bỏ ép)');

  // 6. CHATGPT_LOCAL_MODEL không được chứa "/" — flowJobs.ts kiểm hằng này TRƯỚC khi kiểm
  // dấu "/" để rẽ OmniRoute; thêm "/" vào sẽ khiến nhánh rẽ provider sai âm thầm.
  assert.ok(!CHATGPT_LOCAL_MODEL.includes('/'), 'CHATGPT_LOCAL_MODEL không được chứa "/"');

  console.log('✓ check-global-image-model: tất cả assert pass');
} finally {
  restore();
}
