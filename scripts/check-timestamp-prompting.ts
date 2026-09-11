/**
 * Self-check: chỉ dẫn CHIA MỐC THỜI GIAN (timestamp prompting) phải đủ đôi rào.
 *
 * Vì sao cần: chia mốc là con dao hai lưỡi. Chia đúng thì Veo có nhịp rõ, hết cảnh lặp động tác
 * hoặc đứng hình giữa chừng. Nhưng nếu prompt chỉ dạy "hãy chia mốc" mà quên hai cái rào đi kèm
 * thì nó làm hỏng nhiều hơn làm được:
 *
 *   Rào 1 — MỖI MỐC ĐÚNG 1 HÀNH ĐỘNG. Doc chính thức Veo 3.1 nói thẳng: nhồi nhiều hành động
 *   xảy ra cùng lúc vào một khoảng thì hình bị nhoè/méo/nhân bản tay ("complex multi-action
 *   scenes may fragment"). Chia mốc mà không có rào này thì AI sinh kịch bản rất dễ hiểu ngược
 *   thành "có thêm chỗ để nhét việc" — tức biến cải tiến thành đúng cái lỗi cần tránh.
 *
 *   Rào 2 — KHÔNG CẮT LỜI THOẠI THEO MỐC. veoPromptAudit bắt ở mức error hai thứ: cú pháp
 *   `nói rằng: "` và lời thoại phải khớp NGUYÊN VĂN voiceoverVi. Nếu AI rải thoại ra nhiều mốc
 *   thì cả hai rule đó gãy, mỗi kịch bản sinh ra đều đỏ lòm dù nội dung không sai.
 *
 * Check này canh NỘI DUNG CHỮ trong prompt (không phải hành vi runtime), nên đọc file dạng text
 * — cùng cách làm với check-aspect-consistency.ts.
 *
 * Chạy: npx tsx scripts/check-timestamp-prompting.ts
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { REVIEW_SCRIPT_SYSTEM_PROMPT, VEO_PROMPT_EVAL_SYSTEM_PROMPT } from '../lib/livestream/promptDefaults';

let passed = 0;
function check(label: string, cond: boolean, detail = '') {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ''}`);
  passed++;
}

// ---------------------------------------------------------------------------
// 1. Prompt sinh kịch bản phải DẠY cú pháp mốc, kèm ví dụ dùng được.
// ---------------------------------------------------------------------------
{
  const p = REVIEW_SCRIPT_SYSTEM_PROMPT;

  check('dạy cú pháp mốc', /\[00:00-00:\d\d\]/.test(p), 'thiếu ví dụ dạng [00:00-00:03]');

  // Ít nhất 2 mốc trong ví dụ — 1 mốc thì không còn là chia nhịp.
  const stamps = p.match(/\[\d\d:\d\d-\d\d:\d\d\]/g) ?? [];
  check('ví dụ có nhiều mốc', stamps.length >= 3, `chỉ thấy ${stamps.length} mốc`);

  check(
    'nêu ràng buộc tổng mốc = duration',
    /tổng các mốc/i.test(p),
    'AI sẽ chia mốc vượt quá độ dài cảnh'
  );
}

// ---------------------------------------------------------------------------
// 2. RÀO 1 — mỗi mốc đúng 1 hành động. Mất rào này là chia mốc phản tác dụng.
// ---------------------------------------------------------------------------
{
  const p = REVIEW_SCRIPT_SYSTEM_PROMPT;

  check(
    'rào 1 tồn tại: mỗi mốc 1 hành động',
    /ĐÚNG 1 HÀNH ĐỘNG CHÍNH/.test(p),
    'thiếu câu giới hạn 1 hành động mỗi mốc'
  );
  check(
    'rào 1 nêu hậu quả khi nhồi',
    /CÙNG\s*\n?\s*LÚC|cùng lúc/i.test(p) && /(nhoè|méo|nhân bản)/i.test(p),
    'phải nói rõ nhồi hành động đồng thời thì Veo vỡ hình, nếu không AI không hiểu vì sao'
  );
  check(
    'rào 1 có ví dụ sai/đúng',
    /Sai:/.test(p) && /Đúng:/.test(p),
    'cần cặp ví dụ sai-đúng, chữ suông dễ bị hiểu ngược'
  );
}

// ---------------------------------------------------------------------------
// 3. RÀO 2 — không cắt thoại. Mất rào này là mọi kịch bản đều fail audit.
// ---------------------------------------------------------------------------
{
  const p = REVIEW_SCRIPT_SYSTEM_PROMPT;

  check(
    'rào 2 tồn tại: cấm chia nhỏ lời thoại',
    /LỜI THOẠI KHÔNG ĐƯỢC CHIA NHỎ/.test(p),
    'thiếu lệnh cấm rải thoại ra nhiều mốc'
  );
  check(
    'rào 2 gắn với cú pháp colon đang được audit',
    /nguyên văn voiceoverVi|NGUYÊN VĂN voiceoverVi/i.test(p),
    'phải nhắc giữ nguyên văn — veoPromptAudit bắt voiceover_not_verbatim ở mức error'
  );
}

// ---------------------------------------------------------------------------
// 4. Cú pháp mốc KHÔNG được phá cú pháp colon của phần Dialogue.
//    Đây là thứ đắt nhất nếu hỏng: phụ đề tự sinh đè lên video.
// ---------------------------------------------------------------------------
{
  const p = REVIEW_SCRIPT_SYSTEM_PROMPT;
  check(
    'vẫn giữ chỉ dẫn cú pháp colon',
    /nói rằng:\s*"/.test(p),
    'chia mốc không được làm mất cú pháp `nói rằng: "..."`'
  );
  check(
    'vẫn giữ chỉ dẫn chặn phụ đề',
    /không phụ đề/.test(p),
    'Technical phải còn cụm "không phụ đề"'
  );
}

// ---------------------------------------------------------------------------
// 5. Bộ chấm điểm phải soi được đúng những gì prompt vừa dạy.
//    Dạy mà không chấm = không ai biết AI có tuân thủ hay không.
// ---------------------------------------------------------------------------
{
  const e = VEO_PROMPT_EVAL_SYSTEM_PROMPT;

  check('eval soi việc thiếu mốc', /\[00:00-00:\d\d\]/.test(e), 'eval không nhắc cú pháp mốc');
  check(
    'eval soi việc nhồi hành động vào 1 mốc',
    /NHỒI|nhồi/.test(e) && /vừa\.\.\. vừa|vừa\.\.\./.test(e),
    'eval phải bắt được dấu hiệu "vừa... vừa..." trong một mốc'
  );
  check(
    'eval xếp nhồi mốc NẶNG hơn không chia mốc',
    /NẶNG hơn/.test(e),
    'thiếu thứ tự ưu tiên thì eval trừ điểm ngang nhau cho hai lỗi nặng nhẹ khác nhau'
  );
  check(
    'eval soi việc cắt thoại theo mốc',
    /lời thoại bị cắt nhỏ/i.test(e),
    'eval phải bắt lỗi rải thoại ra nhiều mốc'
  );
}

// ---------------------------------------------------------------------------
// 6. Hồi quy: những thứ có trước KHÔNG được mất khi thêm timestamp.
// ---------------------------------------------------------------------------
{
  const p = REVIEW_SCRIPT_SYSTEM_PROMPT;
  check('giữ ràng buộc tay/chân', /Mỗi người CHỈ có đúng 2 tay/.test(p));
  // \s+ chứ không phải dấu cách: prompt xuống dòng giữa cụm này để giữ độ rộng dòng.
  check('giữ chỉ dẫn vật lý', /vật lý chân thực chi phối\s+chuyển động/.test(p));
  check('giữ chaining cảnh 2+', /tiếp nối trực tiếp/.test(p));
  check('giữ câu "Âm thanh:" bắt buộc', /Âm thanh:/.test(p));
  check(
    'SFX theo mốc là BỔ SUNG, không thay câu "Âm thanh:"',
    /KHÔNG thay thế nó/.test(p),
    'thiếu câu này thì AI bỏ luôn câu Âm thanh tổng thể → audit báo missing_audio'
  );
}

// ---------------------------------------------------------------------------
// 7. CẤM BỊA BIẾN THỂ SẢN PHẨM.
//
// Ca lỗi thật (kịch bản gen 11/09/2026, cảnh tidy-result + cta): ảnh thật chỉ có hộp TRẮNG,
// AI tự thêm "chiếc hộp gấu thứ hai màu nâu" và cho người dẫn nói "có sẵn hai màu trắng và
// nâu". Biến thể bịa không có ảnh reference để model bám → chắc chắn vẽ sai; nặng hơn là video
// quảng cáo một phiên bản có thể không tồn tại. Chỉ dẫn cũ chỉ cấm "đổi màu" nên không chặn
// được việc THÊM một chiếc khác màu, và không đụng gì tới lời thoại.
// ---------------------------------------------------------------------------
{
  const p = REVIEW_SCRIPT_SYSTEM_PROMPT;
  check('cấm bịa biến thể', /CẤM BỊA BIẾN THỂ SẢN PHẨM/.test(p));
  check(
    'cấm cả trong LỜI THOẠI',
    /có nhiều màu|có sẵn màu/.test(p),
    'phải cấm nói biến thể trong thoại, không chỉ cấm mô tả hình'
  );
  check(
    'nêu lý do thiếu ảnh reference',
    /không có\s+ảnh reference/i.test(p),
    'không nêu lý do thì AI coi là luật tuỳ tiện và bỏ qua'
  );
  check(
    'chừa lối nói chung chung',
    /nhiều lựa chọn/.test(p),
    'cấm mà không chừa lối thay thế thì AI vẫn bịa để có cái mà nói'
  );

  const e = VEO_PROMPT_EVAL_SYSTEM_PROMPT;
  check('eval soi việc bịa biến thể', /BỊA BIẾN THỂ/.test(e));
  check(
    'eval xếp bịa biến thể là error',
    /là "error"/.test(e),
    'phải nói rõ mức error, nếu không AI chấm thành warn rồi Mr.D bỏ qua'
  );
}

// ---------------------------------------------------------------------------
// 8. Vật lý xét THEO MỐC, phủ cả tương tác nhẹ.
//
// Ca lỗi thật (cùng kịch bản): chỉ 2/7 cảnh có từ khoá vật lý. Eval bắt đúng hai chỗ thiếu —
// "đặt bọt biển xuống bàn, nước loang" và "dựng chai đứng vững, thả tỏi gừng". Chỉ dẫn cũ nói
// "khi cảnh có tương tác vật chất" nên AI tự phán cảnh nào đủ nặng để tính; nay xét từng mốc.
// ---------------------------------------------------------------------------
{
  const p = REVIEW_SCRIPT_SYSTEM_PROMPT;
  check('vật lý xét theo mốc', /XÉT THEO TỪNG MỐC/.test(p));
  check(
    'phủ tương tác nhẹ',
    /kể cả khi nghe rất nhẹ nhàng|kể cả nhẹ như/.test(p),
    'không nói rõ thì AI bỏ qua việc đặt vật nhẹ xuống bàn'
  );
  check(
    'chặn thói tự phán "cảnh này đơn giản"',
    /Đừng tự phán/.test(p),
    'đây đúng là cách AI đã bỏ sót ở kịch bản thật'
  );
  check(
    'có từ khoá cho vật đặt xuống',
    /vật đặt xuống có trọng lượng thật/.test(p),
    'thiếu từ khoá sẵn thì AI không biết chèn gì'
  );

  const e = VEO_PROMPT_EVAL_SYSTEM_PROMPT;
  check('eval soi vật lý theo mốc', /Soi TỪNG MỐC/.test(e));
  check(
    'eval nêu ví dụ tương tác nhẹ',
    /bọt biển|tép tỏi/.test(e),
    'ví dụ cụ thể giúp AI chấm không bỏ sót loại nhẹ'
  );
}

console.log(`✅ check-timestamp-prompting: ${passed}/${passed} pass`);
