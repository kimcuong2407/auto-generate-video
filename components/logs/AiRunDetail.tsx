'use client';

import { shortTimeVn } from '@/lib/format/datetime';

/**
 * Khối chi tiết 1 lượt gọi AI: 3 cột system / user / output + dòng metadata.
 *
 * Tách ra vì khối này vốn bị COPY-PASTE ở cả AiCallLogView và AiRunTimeline — thêm chỗ thứ ba
 * (tab /logs) là ba bản phải sửa cùng lúc, và kiểu gì cũng có bản bị quên.
 */

export interface AiRunDetailData {
  systemPrompt: string;
  userPrompt: string;
  output: string | null;
  errorMessage: string | null;
  imagePaths: string[] | null;
  imageCount: number;
  model: string;
  promptScope: string;
  durationMs: number;
  attempts: number;
}

export const SCOPE_LABEL: Record<string, string> = {
  job: 'riêng job này',
  global: 'mặc định đã tuỳ chỉnh',
  default: 'mặc định hệ thống',
};

export function AiRunDetail({ detail }: { detail: AiRunDetailData }) {
  return (
    <>
      <div className="source-compare">
        <div className="source-compare-col">
          {/* Điểm giá trị nhất: ô sửa prompt còn nguyên ${params}, đây là bản AI thật sự nhận. */}
          <div className="source-compare-head">① INPUT — system prompt (đã ghép ${'${params}'})</div>
          <pre>{detail.systemPrompt}</pre>
        </div>
        <div className="source-compare-col">
          <div className="source-compare-head">② INPUT — user prompt (dữ liệu sản phẩm)</div>
          <pre>{detail.userPrompt}</pre>
        </div>
        <div className="source-compare-col">
          <div className="source-compare-head">③ OUTPUT — AI trả về (thô, chưa parse)</div>
          <pre>{detail.output ?? '(lượt này lỗi — không có output)'}</pre>
        </div>
      </div>

      {detail.errorMessage && (
        <div className="banner banner-error" style={{ marginTop: 8 }}>
          {detail.errorMessage}
        </div>
      )}

      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
        {detail.model} · {(detail.durationMs / 1000).toFixed(1)}s · {detail.attempts} lần thử ·
        prompt {SCOPE_LABEL[detail.promptScope] ?? detail.promptScope}
        {detail.imageCount > 0 && ` · ${detail.imageCount} ảnh đính kèm`}
        {detail.imagePaths && detail.imagePaths.length > 0 && `: ${detail.imagePaths.join(', ')}`}
      </div>
    </>
  );
}

/** Nhãn thời gian ngắn dùng chung cho mọi bảng log. Giờ hiển thị theo UTC+7. */
export { shortTimeVn };
