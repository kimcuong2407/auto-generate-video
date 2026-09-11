/**
 * Soát ràng buộc CỨNG của veoPrompt sau khi AI sinh kịch bản — thuần, không I/O.
 *
 * Vì sao cần: system prompt ở app/api/projects/[id]/script/generate/route.ts dặn rất nhiều ràng
 * buộc bắt buộc (cú pháp colon chống phụ đề, câu "Âm thanh:", mô tả giọng/nhân vật giống hệt mọi
 * cảnh, ưu tiên tuyệt đối cho mô tả ảnh thật). Nhưng chúng chỉ được DẶN, không ai KIỂM LẠI. Model
 * quên hoặc mâu thuẫn một cái thì không có tín hiệu nào — chỉ lộ ra sau khi đã đốt lượt Veo.
 *
 * Đo trên dữ liệu thật (project hop-dung-do-nha-bep-...-2fa916, 7 cảnh) cho thấy các ràng buộc
 * hình thức (colon, "Âm thanh:", đuôi Technical, nhất quán giọng/nhân vật) model làm ĐÚNG 7/7 —
 * nên kiểm chúng gần như không bắt được gì, nhưng vẫn giữ vì đó là hồi quy đắt: mất cú pháp colon
 * là Veo tự vẽ phụ đề đè lên video.
 *
 * Cái THẬT SỰ bắt được lỗi là mâu thuẫn nguồn sự thật: vision đọc ảnh ra "mèo", tên listing Shopee
 * ghi "Gấu", veoPrompt né sang "hình thú" nhưng LỜI THOẠI vẫn nói "hình gấu" ở 3/7 cảnh. Prompt
 * bảo visualDescription là "ƯU TIÊN TUYỆT ĐỐI" mà không có gì cưỡng chế.
 *
 * Chỉ BÁO CÁO, không tự sửa: đây là dữ liệu cho bước chấm điểm và cho UI cảnh báo.
 */
import type { Scene, Project } from '../types';

export type AuditSeverity = 'error' | 'warn';

/**
 * Dưới ngưỡng này thì UI cảnh báo đỏ trước khi cho gen video.
 *
 * Đặt ở file THUẦN này (chỉ import type) chứ không ở veoPromptEvaluate.ts: client component
 * ScriptEvaluationPanel cần đọc nó, mà veoPromptEvaluate kéo theo promptStore/flowJobs/callLog
 * → node:fs + mysql2. Import từ 'use client' là Next bundle cả cây server-side vào browser và vỡ
 * build ở fsevents (đã xảy ra thật với planVideoInputs, xem lib/data/videoInputs.ts).
 */
export const EVAL_WARN_THRESHOLD = 6;

export interface AuditFinding {
  /** Khoá ổn định để UI/self-check bám vào, không phụ thuộc câu chữ tiếng Việt. */
  code: string;
  severity: AuditSeverity;
  /** '' = vi phạm ở cấp toàn kịch bản, không thuộc cảnh nào. */
  sceneId: string;
  message: string;
}

/** Đuôi bắt buộc chặn Veo tự sinh phụ đề — xem (7) Technical trong BASE_SYSTEM_PROMPT. */
const NO_SUBTITLE = 'không phụ đề';

/**
 * Danh từ chỉ con vật/hình dáng chủ thể sản phẩm.
 *
 * Vì sao cần: nguồn sự thật về hình dáng là ẢNH THẬT (visualDescription do vision đọc). Tên trên
 * listing sàn TMĐT thường sai/khác (người bán đặt tên cho dễ bán). Khi hai nguồn nói hai con vật
 * khác nhau mà lời thoại đọc theo tên listing, video sẽ nói sai thứ người xem đang nhìn thấy.
 */
const CREATURE_WORDS = ['gấu', 'mèo', 'thỏ', 'heo', 'lợn', 'cún', 'chó', 'vịt', 'cừu', 'hổ', 'voi', 'khủng long'];

/**
 * Bỏ dấu tiếng Việt về ASCII: "gấu"/"gáu" → "gau", "chó" → "cho".
 *
 * Vì sao cần (ca lỗi thật, project hop-dung-do-nha-bep-hinh-gau-...): AI vision gõ "hộp gáu"
 * (sai dấu) thay vì "hộp gấu". So khớp theo chữ có dấu thì vế ảnh trượt hoàn toàn, chỉ còn vế
 * tên listing khớp "gấu" → audit kết luận ngược là hai nguồn mâu thuẫn. Bỏ dấu trước khi so
 * khiến "gáu" và "gấu" gặp nhau ở "gau".
 *
 * đ→d xử riêng vì NFD không tách được nó thành d + dấu.
 */
function stripDiacritics(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

/**
 * Ranh giới từ cho tiếng Việt.
 *
 * Vì sao KHÔNG dùng `\b` (ca lỗi thật, cùng project trên): `\b` của JS chỉ coi [A-Za-z0-9_] là
 * ký tự-từ, nên chữ có dấu nằm ngay sau nó bị tính là ranh giới. `\bchó\b` khớp vào "chó" bên
 * trong "nhanh chóng" (ó = U+00F3 không thuộc \w → JS thấy ranh giới ngay sau ó) và audit báo
 * sản phẩm là con chó. Sau khi bỏ dấu thì "chong" toàn ASCII nên `\b` chạy đúng trở lại — nhưng
 * vẫn dùng lookaround tường minh cho chắc, không phụ thuộc đặc thù của \b.
 */
function findCreatures(text: string): string[] {
  const plain = stripDiacritics(text);
  return CREATURE_WORDS.filter((w) => {
    const needle = stripDiacritics(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(?<![a-z0-9])${needle}(?![a-z0-9])`, 'i').test(plain);
  });
}

/** Mô tả giọng đã chốt, trích từ cú pháp colon. null = cảnh không có thoại hoặc sai cú pháp. */
export function extractVoiceDescription(veoPrompt: string): string | null {
  const m = veoPrompt.match(/Người này có (.*?), nói tiếng Việt/s);
  return m ? m[1].trim() : null;
}

/**
 * Soát toàn bộ kịch bản. Trả mảng rỗng = không phát hiện vi phạm nào.
 *
 * `project` chỉ dùng để lấy nguồn sự thật về sản phẩm (visualDescription + name); truyền phần tối
 * thiểu để hàm test được mà không cần dựng cả Project.
 */
/**
 * Ép câu thoại trong veoPrompt về ĐÚNG NGUYÊN VĂN voiceoverVi.
 *
 * Vì sao cần (ca lỗi thật, kịch bản gen 11/09/2026 cảnh "reveal"): system prompt đã dặn "lấy
 * NGUYÊN VĂN từ voiceoverVi" ở nhiều chỗ, AI vẫn tự thêm chữ — voiceoverVi kết thúc bằng
 * "...đó mọi người." còn trong veoPrompt thành "...đó mọi người ơi". 1/7 cảnh lệch.
 *
 * Vì sao sửa veoPrompt theo voiceoverVi mà KHÔNG phải chiều ngược lại: voiceoverVi là nguồn
 * được dùng để đo độ dài thoại và hiển thị cho người duyệt; veoPrompt chỉ là chỗ nhúng lại câu
 * đó cho Veo đọc. Đồng bộ ngược sẽ hợp thức hoá việc AI tự sửa lời thoại đã duyệt.
 *
 * Chỉ thay phần trong cặp ngoặc kép ngay sau `nói rằng:` — giữ nguyên toàn bộ phần còn lại
 * (mô tả giọng, mốc thời gian, Âm thanh, Technical). Không tìm thấy cú pháp đó thì trả nguyên
 * veoPrompt: khi ấy lỗi thuộc về cú pháp colon, đã có `missing_colon_syntax` báo riêng.
 */
export function enforceVerbatimVoiceover(veoPrompt: string, voiceoverVi: string): string {
  const line = voiceoverVi.trim();
  if (!line || !veoPrompt.trim()) return veoPrompt;

  const re = /(nói rằng:\s*")([^"]*)(")/;
  const m = veoPrompt.match(re);
  if (!m) return veoPrompt;
  if (m[2] === line) return veoPrompt;

  return veoPrompt.replace(re, (_all, head: string, _old: string, tail: string) => `${head}${line}${tail}`);
}

export function auditVeoPrompts(
  scenes: Scene[],
  product: Pick<Project['product'], 'name' | 'visualDescription'>
): AuditFinding[] {
  const out: AuditFinding[] = [];
  const add = (code: string, severity: AuditSeverity, sceneId: string, message: string) =>
    out.push({ code, severity, sceneId, message });

  for (const s of scenes) {
    const p = s.veoPrompt;
    if (!p.trim()) {
      add('empty_prompt', 'error', s.id, 'Cảnh chưa có veoPrompt — không gen video được');
      continue;
    }

    if (!p.toLowerCase().includes(NO_SUBTITLE)) {
      add('missing_no_subtitle', 'error', s.id, 'Thiếu "không phụ đề" — Veo sẽ tự vẽ phụ đề đè lên video');
    }
    if (!/Âm thanh:/.test(p)) {
      add('missing_audio', 'warn', s.id, 'Thiếu câu "Âm thanh:" — Veo dễ tự bịa âm thanh sai bối cảnh');
    }

    // Cảnh có thoại: cú pháp colon là thứ chặn Veo sinh phụ đề, và lời thoại phải vào NGUYÊN VĂN.
    if (s.voiceoverVi.trim()) {
      if (!/nói rằng:\s*"/.test(p)) {
        add('missing_colon_syntax', 'error', s.id, 'Thiếu cú pháp `nói rằng: "..."` — dễ kích hoạt phụ đề tự sinh');
      }
      if (!p.includes(s.voiceoverVi.trim())) {
        add('voiceover_not_verbatim', 'error', s.id, 'Lời thoại trong veoPrompt không khớp NGUYÊN VĂN voiceoverVi');
      }
    }
  }

  // --- Nhất quán xuyên cảnh: Veo không nhớ cảnh trước, chỉ lặp lại y hệt mới ra cùng giọng/người ---
  const voices = new Set(
    scenes.filter((s) => s.voiceoverVi.trim()).map((s) => extractVoiceDescription(s.veoPrompt)).filter(Boolean)
  );
  if (voices.size > 1) {
    add('voice_inconsistent', 'error', '', `Có ${voices.size} bản mô tả giọng khác nhau — giọng sẽ đổi giữa các cảnh`);
  }

  // --- Nguồn sự thật về sản phẩm: ảnh thật thắng tên listing ---
  const fromImage = findCreatures(product.visualDescription);
  const fromName = findCreatures(product.name);
  const conflict = fromName.filter((w) => !fromImage.includes(w));
  if (fromImage.length > 0 && conflict.length > 0) {
    add(
      'product_identity_conflict',
      'error',
      '',
      `Ảnh thật cho thấy "${fromImage.join('/')}" nhưng tên sản phẩm ghi "${conflict.join('/')}" — ảnh là nguồn đúng`
    );
    // Lời thoại đọc theo tên listing thì người xem nghe một đằng, nhìn một nẻo.
    for (const s of scenes) {
      const said = findCreatures(s.voiceoverVi).filter((w) => conflict.includes(w));
      if (said.length > 0) {
        add('voiceover_wrong_creature', 'error', s.id, `Lời thoại nói "${said.join('/')}" trong khi ảnh thật là "${fromImage.join('/')}"`);
      }
    }
  }

  return out;
}

/** Gộp kết quả thành 1 dòng cho UI/log. */
export function summarizeAudit(findings: AuditFinding[]): string {
  if (findings.length === 0) return 'Không phát hiện vi phạm ràng buộc nào';
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warns = findings.length - errors;
  return `${errors} lỗi${warns > 0 ? `, ${warns} cảnh báo` : ''}`;
}
