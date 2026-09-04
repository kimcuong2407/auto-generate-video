import type { PromptBlockKey } from './promptBlocks';

/** Một khối tự ghép nằm ở đâu trong prompt cuối — để UI tô màu + gắn nhãn từng đoạn. */
export interface PromptBlockSpan {
  key: PromptBlockKey;
  /** Chỉ số ký tự trong prompt (nửa mở: [start, end)). */
  start: number;
  end: number;
}

/**
 * Sổ ghi chuỗi THẬT của từng khối tự ghép, do chính builder điền vào lúc ghép prompt.
 *
 * Vì sao builder tự ghi thay vì bên ngoài dò ra: cách rẻ nhất tưởng là dựng prompt 2 lần (bật/tắt
 * 1 khối) rồi diff — nhưng nó SAI ở 2 chỗ đã đo được: (1) hai khối liền nhau cùng mở đầu bằng
 * "\n\n" khiến ranh giới trượt, span khối trước lấn sang khối sau; (2) ở V2 tắt `sc_lock` làm
 * `sc_visual` hiện lại (quan hệ thay thế), nên diff đọc ra một đoạn lai không tồn tại. Builder thì
 * biết chính xác nó vừa ghép chuỗi nào.
 *
 * Truyền vào builder là TUỲ CHỌN: route gen thật không truyền gì và không tốn thêm việc.
 */
export type PromptBlockSink = Partial<Record<PromptBlockKey, string>>;

/** Ghi lại chuỗi của 1 khối (bỏ qua khi không có sink hoặc khối rỗng). */
export function recordBlock(
  sink: PromptBlockSink | undefined,
  key: PromptBlockKey,
  text: string
): string {
  if (sink && text) sink[key] = text;
  return text;
}

/**
 * Đổi sổ ghi thành danh sách span trong prompt cuối, bằng cách tìm vị trí từng chuỗi.
 *
 * Tìm TUẦN TỰ (mỗi lần dò tiếp từ chỗ khối trước kết thúc) nên hai khối có nội dung giống nhau
 * không thể trỏ chung một chỗ. Khối không tìm thấy bị bỏ qua — thà không tô màu còn hơn đóng nhãn
 * lên nhầm đoạn.
 */
export function spansFromSink(prompt: string, sink: PromptBlockSink): PromptBlockSpan[] {
  const spans: PromptBlockSpan[] = [];
  for (const [key, text] of Object.entries(sink) as [PromptBlockKey, string][]) {
    const start = prompt.indexOf(text);
    if (start >= 0) spans.push({ key, start, end: start + text.length });
  }
  spans.sort((a, b) => a.start - b.start);
  // Chồng lấn = một khối là chuỗi con của khối khác; giữ khối đứng trước, bỏ khối chồng lên nó.
  return spans.filter((sp, i) => i === 0 || sp.start >= spans[i - 1].end);
}

/** Dịch span sang toạ độ chuỗi khác — dùng khi prompt hiển thị có thêm header ở đầu. */
export function shiftSpans(spans: PromptBlockSpan[], offset: number): PromptBlockSpan[] {
  return spans.map((sp) => ({ ...sp, start: sp.start + offset, end: sp.end + offset }));
}
