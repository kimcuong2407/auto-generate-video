'use client';

import { PROMPT_BLOCKS, type PromptBlockKey } from '@/lib/livestream/promptBlocks';

/** Vị trí 1 khối trong prompt — khớp PromptBlockSpan của route preview-prompt. */
interface Span {
  key: string;
  start: number;
  end: number;
}

/** Màu viền/nền theo khối, xoay vòng — chỉ để phân biệt bằng mắt, không mang ý nghĩa. */
const TINTS = [
  '#7c5cff',
  '#2ea8a0',
  '#c9772b',
  '#c2456b',
  '#3a7bd5',
  '#8a9a2b',
];

/**
 * Khung "Prompt gửi AI" đã CẮT THEO KHỐI: mỗi đoạn server tự ghép được bọc khung riêng, có nhãn +
 * số ký tự, phần còn lại (prompt do người dùng viết + ràng buộc kỹ thuật) để trần.
 *
 * Vì sao cần: prompt cuối 15k ký tự hiện ra một cục, không cách nào biết đoạn nào là của khối nào
 * để quyết định bỏ tick khối đó. Ô tick ở trên nói "khối này chặn lỗi gì", khung này nói "khối này
 * THỰC SỰ chèn chữ gì vào".
 *
 * Toạ độ span do SERVER tính từ chính chuỗi prompt thật (xem promptBlockSpans.ts) — client chỉ cắt
 * chuỗi theo offset, không tự dò text, nên không có đường nào để preview lệch prompt thật.
 */
export function PromptWithBlocks({
  prompt,
  spans,
  boxRef,
  highlight,
}: {
  prompt: string;
  spans: Span[];
  boxRef?: React.Ref<HTMLPreElement>;
  /** Viền sáng khi vừa lưu — giữ nguyên hành vi cũ của khung prompt. */
  highlight?: boolean;
}) {
  // Không có span (bước không có khối ghép, hoặc tắt hết) → về đúng khung phẳng như trước.
  if (spans.length === 0) {
    return <PlainBox prompt={prompt} boxRef={boxRef} highlight={highlight} />;
  }

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  spans.forEach((sp, i) => {
    // Span chồng lấn/ngược thứ tự (dữ liệu lạ) → bỏ qua thay vì cắt ra chuỗi rác.
    if (sp.start < cursor || sp.end > prompt.length) return;
    if (sp.start > cursor) {
      parts.push(<span key={`t${cursor}`}>{prompt.slice(cursor, sp.start)}</span>);
    }
    const def = PROMPT_BLOCKS.find((b) => b.key === (sp.key as PromptBlockKey));
    const tint = TINTS[i % TINTS.length];
    const text = prompt.slice(sp.start, sp.end);
    parts.push(
      <span
        key={sp.key}
        style={{
          display: 'block',
          borderLeft: `3px solid ${tint}`,
          background: `${tint}1a`,
          borderRadius: 4,
          padding: '4px 8px',
          margin: '4px 0',
        }}
        title={def?.hint}
      >
        <span
          style={{
            display: 'block',
            fontSize: 10,
            fontWeight: 700,
            color: tint,
            letterSpacing: 0.3,
            marginBottom: 2,
          }}
        >
          🧩 {def?.label ?? sp.key} · {text.trim().length.toLocaleString('vi-VN')} ký tự
        </span>
        {text}
      </span>
    );
    cursor = sp.end;
  });
  if (cursor < prompt.length) {
    parts.push(<span key="tail">{prompt.slice(cursor)}</span>);
  }

  return (
    <pre ref={boxRef} style={boxStyle(highlight)}>
      {parts}
    </pre>
  );
}

function PlainBox({
  prompt,
  boxRef,
  highlight,
}: {
  prompt: string;
  boxRef?: React.Ref<HTMLPreElement>;
  highlight?: boolean;
}) {
  return (
    <pre ref={boxRef} style={boxStyle(highlight)}>
      {prompt}
    </pre>
  );
}

function boxStyle(highlight?: boolean): React.CSSProperties {
  return {
    outline: highlight ? '2px solid var(--accent-glow)' : undefined,
    whiteSpace: 'pre-wrap',
    fontSize: 12,
    lineHeight: 1.5,
    background: 'var(--bg)',
    padding: 10,
    borderRadius: 8,
    // KHÔNG giới hạn chiều cao riêng: khối cha (.prompt-preview-body) đã cuộn rồi, thêm vùng cuộn
    // lồng bên trong khiến lăn chuột mắc kẹt giữa 2 tầng.
    wordBreak: 'break-word',
  };
}
