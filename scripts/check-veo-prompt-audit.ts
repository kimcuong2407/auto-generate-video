/**
 * Self-check cho auditVeoPrompts() — soát ràng buộc cứng của veoPrompt.
 *
 * Vì sao cần: audit này là thứ DUY NHẤT kiểm lại các ràng buộc mà system prompt chỉ dặn miệng.
 * Nếu nó báo sai thì tệ hơn không có: báo nhầm lỗi khiến Mr.D sửa cái không hỏng, bỏ sót lỗi
 * khiến lượt Veo bị đốt oan. Đo trên kịch bản thật (project hop-dung-do-nha-bep-...-2fa916) nó
 * bắt đúng 4 lỗi: 1 mâu thuẫn ảnh-vs-tên và 3 cảnh lời thoại đọc sai con vật.
 *
 * Chạy: npx tsx scripts/check-veo-prompt-audit.ts
 */
import assert from 'node:assert/strict';
import { auditVeoPrompts, extractVoiceDescription, summarizeAudit } from '../lib/data/veoPromptAudit';
import type { Scene } from '../lib/types';

const VOICE = 'giọng nữ trẻ trung khoảng 25-30 tuổi, âm vực vừa, cheerful upbeat voice';

/** Dựng veoPrompt hợp lệ đủ mọi ràng buộc — mốc "đúng" để các case sau đục lỗ từng cái. */
function goodPrompt(line: string, voice = VOICE): string {
  return (
    `một cô gái 25-30 tuổi tóc đuôi ngựa, đứng tại bếp; cầm sản phẩm; ` +
    `Người này có ${voice}, nói tiếng Việt vui vẻ, nói rằng: "${line}"; ` +
    `Âm thanh: tiếng bếp ấm áp, nhạc nền nhỏ; ` +
    `giải phẫu tay tự nhiên, không phụ đề, không caption, không chữ trên màn hình.`
  );
}

function scene(over: Partial<Scene> & { id: string; order: number }): Scene {
  return {
    label: '', duration: 8, camera: 'static', voiceoverVi: '', onScreenText: '',
    veoPrompt: '', negativePrompt: '', status: 'idle', jobId: null, videoPath: null,
    videoUrl: null, error: null, attempts: 0, lastUpdatedAt: null, lastFramePath: null,
    chainedFromPrevious: false, ...over,
  } as Scene;
}

const CLEAN = { name: 'Hộp đựng đồ', visualDescription: 'hộp nhựa trắng gắn tường' };

// 1. Kịch bản hợp lệ → KHÔNG được báo gì. Sai chiều này là Mr.D đi sửa cái không hỏng.
{
  const s = scene({ id: 'a', order: 1, voiceoverVi: 'Xin chào', veoPrompt: goodPrompt('Xin chào') });
  assert.deepEqual(auditVeoPrompts([s], CLEAN), []);
  assert.equal(summarizeAudit([]), 'Không phát hiện vi phạm ràng buộc nào');
}

// 2. Mất "không phụ đề" → error. Đây là hồi quy đắt: Veo tự vẽ phụ đề đè lên video.
{
  const p = goodPrompt('Xin chào').replace('không phụ đề, ', '');
  const f = auditVeoPrompts([scene({ id: 'a', order: 1, voiceoverVi: 'Xin chào', veoPrompt: p })], CLEAN);
  assert.equal(f.length, 1);
  assert.equal(f[0].code, 'missing_no_subtitle');
  assert.equal(f[0].severity, 'error');
}

// 3. Mất cú pháp colon → error (dùng ngoặc kép mà thiếu "nói rằng:" là kích hoạt phụ đề).
{
  const p = goodPrompt('Xin chào').replace('nói rằng: "Xin chào"', '"Xin chào"');
  const codes = auditVeoPrompts([scene({ id: 'a', order: 1, voiceoverVi: 'Xin chào', veoPrompt: p })], CLEAN).map((x) => x.code);
  assert.ok(codes.includes('missing_colon_syntax'), `phải bắt colon, nhận: ${codes}`);
}

// 4. Lời thoại trong prompt KHÁC voiceoverVi → error (Veo đọc bản trong prompt, không phải field).
{
  const s = scene({ id: 'a', order: 1, voiceoverVi: 'Câu gốc', veoPrompt: goodPrompt('Câu đã bị đổi') });
  const codes = auditVeoPrompts([s], CLEAN).map((x) => x.code);
  assert.ok(codes.includes('voiceover_not_verbatim'));
}

// 5. Thiếu "Âm thanh:" → warn, KHÔNG phải error (video vẫn chạy, chỉ dễ bịa âm thanh).
{
  const p = goodPrompt('Xin chào').replace(/Âm thanh:[^;]*; /, '');
  const f = auditVeoPrompts([scene({ id: 'a', order: 1, voiceoverVi: 'Xin chào', veoPrompt: p })], CLEAN);
  assert.equal(f[0].code, 'missing_audio');
  assert.equal(f[0].severity, 'warn', 'thiếu Âm thanh không chặn được video → chỉ cảnh báo');
}

// 6. Hai cảnh mô tả giọng KHÁC nhau → error cấp kịch bản. Veo không nhớ giọng cảnh trước.
{
  const f = auditVeoPrompts(
    [
      scene({ id: 'a', order: 1, voiceoverVi: 'Câu 1', veoPrompt: goodPrompt('Câu 1', 'giọng nữ trẻ') }),
      scene({ id: 'b', order: 2, voiceoverVi: 'Câu 2', veoPrompt: goodPrompt('Câu 2', 'giọng nam trầm') }),
    ],
    CLEAN
  );
  const hit = f.find((x) => x.code === 'voice_inconsistent');
  assert.ok(hit, 'phải bắt giọng không nhất quán');
  assert.equal(hit!.sceneId, '', 'lỗi cấp kịch bản, không thuộc cảnh nào');
}

// 7. Cảnh KHÔNG thoại → không được đòi colon/voiceover (cảnh im lặng là hợp lệ).
{
  const p = 'cận cảnh sản phẩm; Âm thanh: tiếng phòng; không phụ đề, không caption.';
  assert.deepEqual(auditVeoPrompts([scene({ id: 'a', order: 1, veoPrompt: p })], CLEAN), []);
}

// 8. Ảnh thật "mèo" vs tên listing "Gấu" → bắt mâu thuẫn + bắt đúng cảnh đọc sai.
//    Đây là ca THẬT từ production, và là lỗi mà mọi kiểm hình thức khác đều bỏ lọt.
{
  const product = { name: 'Hộp Đựng Đồ Hình Gấu Homebox', visualDescription: 'hộp hình mèo màu trắng, hai tai mèo nổi' };
  const f = auditVeoPrompts(
    [
      scene({ id: 'hook', order: 1, voiceoverVi: 'Thiết kế hình gấu siêu đáng yêu', veoPrompt: goodPrompt('Thiết kế hình gấu siêu đáng yêu') }),
      scene({ id: 'mid', order: 2, voiceoverVi: 'Treo tường siêu gọn', veoPrompt: goodPrompt('Treo tường siêu gọn') }),
    ],
    product
  );
  const codes = f.map((x) => x.code);
  assert.ok(codes.includes('product_identity_conflict'), 'phải bắt ảnh-vs-tên mâu thuẫn');
  const wrong = f.filter((x) => x.code === 'voiceover_wrong_creature');
  assert.equal(wrong.length, 1, 'chỉ cảnh NÓI sai mới bị bắt');
  assert.equal(wrong[0].sceneId, 'hook', 'cảnh "mid" không nhắc con vật → không được báo');
}

// 9. Tên và ảnh CÙNG nói một con vật → không báo (đừng bắt nhầm khi listing đúng).
{
  const product = { name: 'Hộp Hình Mèo', visualDescription: 'hộp hình mèo trắng' };
  const s = scene({ id: 'a', order: 1, voiceoverVi: 'Hình mèo dễ thương', veoPrompt: goodPrompt('Hình mèo dễ thương') });
  assert.deepEqual(auditVeoPrompts([s], product), []);
}

// 10. veoPrompt rỗng → error và KHÔNG đổ thêm lỗi phụ (tránh 1 cảnh chưa sinh đẻ ra 5 dòng nhiễu).
{
  const f = auditVeoPrompts([scene({ id: 'a', order: 1, voiceoverVi: 'Xin chào', veoPrompt: '' })], CLEAN);
  assert.equal(f.length, 1);
  assert.equal(f[0].code, 'empty_prompt');
}

// 11. extractVoiceDescription: lấy đúng đoạn giữa, trả null khi sai cú pháp.
assert.equal(extractVoiceDescription(goodPrompt('x')), VOICE);
assert.equal(extractVoiceDescription('không có cú pháp giọng'), null);

console.log('✅ check-veo-prompt-audit: 11/11 pass');
