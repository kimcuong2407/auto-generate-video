'use client';

import { paramsForStep } from '@/lib/livestream/promptParamsDefs';

/**
 * Bảng gợi ý params dùng được trong system prompt sinh kịch bản.
 *
 * Dùng chung ở 2 chỗ sửa prompt (modal preview + panel ⚙️ đầu trang) và đọc thẳng PROMPT_PARAMS
 * — cùng danh sách server dùng để thay giá trị, nên thêm param mới không bao giờ quên cập nhật UI.
 * Bấm 1 param là copy luôn, khỏi gõ tay sai tên rồi ngồi tìm vì sao prompt không đổi.
 */
export function PromptParamsHint({ step = 'script' }: { step?: 'script' | 'background' }) {
  const params = paramsForStep(step);
  return (
    <details style={{ margin: '6px 0 10px' }}>
      <summary style={{ cursor: 'pointer', fontSize: 12, fontWeight: 600 }}>
        🔤 Params dùng được trong prompt ({params.length}) — bấm để copy
      </summary>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', margin: '6px 0' }}>
        Viết {'${ten_param}'} vào bất kỳ đâu trong prompt, hệ thống tự thay bằng giá trị thật của
        sản phẩm đang sinh. Gõ sai tên thì param được giữ nguyên trong prompt (nhìn khung &quot;Prompt
        gửi AI&quot; bên dưới là thấy ngay).
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {params.map((p) => (
          <button
            key={p.key}
            type="button"
            className="btn btn-ghost"
            title={`${p.label} — bấm để copy`}
            onClick={() => navigator.clipboard?.writeText('${' + p.key + '}')}
            style={{ fontSize: 11, padding: '3px 7px', fontFamily: 'monospace' }}
          >
            {'${' + p.key + '}'}
            <span style={{ fontFamily: 'inherit', opacity: 0.6, marginLeft: 5 }}>{p.label}</span>
          </button>
        ))}
      </div>
    </details>
  );
}
