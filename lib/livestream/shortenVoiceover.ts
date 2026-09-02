import { chatCompletion } from '../ai/chatClient';
import { extractJson } from '../ai/jsonExtract';
import { countWords, findOverlongSegments } from './segmentSanitize';
import type { LivestreamSegment } from './types';
import { SHORTEN_SYSTEM_PROMPT } from './promptDefaults';

export { SHORTEN_SYSTEM_PROMPT } from './promptDefaults';


/** Số lượt gọi AI tối đa để ép các đoạn về đúng giới hạn từ (mỗi lượt chỉ gửi đoạn còn vượt). */
const MAX_SHORTEN_ROUNDS = 2;

/**
 * Thay câu thoại cũ bằng câu đã rút gọn NGAY TRONG veoPrompt — Veo đọc veoPrompt chứ không đọc
 * voiceoverVi, nên bỏ qua bước này thì video vẫn dài đúng như bản gốc.
 *
 * Thay MỌI lần xuất hiện của câu cũ (LLM hay lặp lại câu thoại cả trong phần mô tả lẫn trong cụm
 * `saying: "..."`; sót 1 bản là Veo vẫn đọc bản dài). Không tìm thấy câu cũ (model paraphrase hoặc
 * đổi dấu câu khi nhúng) → thay nội dung trong cặp ngoặc kép ngay sau `saying:`. Bí nữa thì trả
 * nguyên bản: veoPrompt chưa rút gọn còn hơn veoPrompt vỡ cấu trúc.
 */
export function replaceSpokenLine(veoPrompt: string, oldLine: string, newLine: string): string {
  const oldTrim = oldLine.trim();
  if (oldTrim && veoPrompt.includes(oldTrim)) return veoPrompt.split(oldTrim).join(newLine);
  const sayingAny = /(saying:\s*")[^"]*(")/i;
  if (sayingAny.test(veoPrompt)) return veoPrompt.replace(sayingAny, `$1${newLine}$2`);
  return veoPrompt;
}

/**
 * Rút gọn lời thoại các đoạn vượt giới hạn số từ, bằng cách gọi AI viết lại NGAY trong lượt sinh
 * script — thay vì chỉ cảnh báo rồi để người dùng tự bấm sinh lại (lần sinh lại cũng hay vượt tiếp).
 *
 * Trả về mảng segment mới (đoạn không vượt giữ nguyên object cũ). Best-effort: AI lỗi/JSON hỏng/
 * viết lại vẫn dài thì giữ nguyên đoạn đó — caller vẫn cảnh báo qua findOverlongSegments().
 */
export async function shortenOverlongSegments(
  segments: LivestreamSegment[],
  onRound?: (round: number, remaining: number) => void
): Promise<LivestreamSegment[]> {
  let current = segments;

  for (let round = 1; round <= MAX_SHORTEN_ROUNDS; round++) {
    const overlong = findOverlongSegments(current);
    if (overlong.length === 0) break;
    onRound?.(round, overlong.length);

    const byId = new Map(current.map((s) => [s.id, s]));
    const user = overlong
      .map((o) => {
        const seg = byId.get(o.id)!;
        return `- id: ${o.id} | thời lượng ${o.duration}s | TỐI ĐA ${o.maxWords} từ (bản hiện tại ${o.words} từ — phải cắt bớt ít nhất ${o.words - o.maxWords} từ)\n  Lời thoại hiện tại: ${seg.voiceoverVi}`;
      })
      .join('\n');

    let rewritten: Map<string, string>;
    try {
      const raw = await chatCompletion(
        SHORTEN_SYSTEM_PROMPT,
        `Rút gọn các đoạn sau cho đúng giới hạn số từ:\n\n${user}`
      );
      const parsed = JSON.parse(extractJson(raw)) as {
        segments?: Array<{ id?: string; voiceoverVi?: string }>;
      };
      if (!Array.isArray(parsed.segments)) break;
      rewritten = new Map(
        parsed.segments
          .filter((s) => s.id && s.voiceoverVi?.trim())
          .map((s) => [s.id!, s.voiceoverVi!.trim()])
      );
    } catch {
      break; // AI lỗi/JSON hỏng → giữ nguyên, caller vẫn cảnh báo.
    }

    // Chỉ nhận bản viết lại thực sự NGẮN HƠN — model đôi khi trả về bản dài bằng hoặc dài hơn,
    // nhận bừa sẽ làm mất lời thoại gốc mà chẳng giải quyết được gì.
    current = current.map((s) => {
      const next = rewritten.get(s.id);
      if (!next || countWords(next) >= countWords(s.voiceoverVi)) return s;
      // veoPrompt nhúng NGUYÊN VĂN voiceoverVi trong cú pháp `saying: "..."` — thứ Veo thực sự đọc
      // là veoPrompt, nên chỉ sửa voiceoverVi thôi thì video vẫn dài y như cũ.
      return { ...s, voiceoverVi: next, veoPrompt: replaceSpokenLine(s.veoPrompt, s.voiceoverVi, next) };
    });
  }

  return current;
}
