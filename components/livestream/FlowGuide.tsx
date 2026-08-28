'use client';

import type { LivestreamJob } from '@/lib/livestream/types';

/**
 * Bảng tra 5 bước của luồng, kèm TRẠNG THÁI THẬT của job hiện tại: bước nào đã xong, bước nào
 * đang thiếu input, và ảnh nào đi vào bước nào.
 *
 * Vì sao không phải danh sách hướng dẫn tĩnh như trước: nguyên nhân gen sai gần như luôn nằm ở
 * "ảnh tôi tưởng đã gửi thật ra không tới bước đó" (ảnh mẫu bị tách, ảnh nền bị cắt vì trần 3 của
 * Veo). Guide chỉ mô tả thao tác thì không lộ ra điều đó; bảng có cột trạng thái thì lộ ngay.
 */
export function FlowGuide({ job }: { job: LivestreamJob }) {
  const productsWithDesc = job.products.filter((p) => p.description.trim()).length;
  const productsWithScript = job.products.filter((p) => p.segments.length > 0).length;
  const totalSegments = job.products.reduce((n, p) => n + p.segments.length, 0);
  const doneSegments = job.products.reduce(
    (n, p) => n + p.segments.filter((s) => s.status === 'done').length,
    0
  );
  const detached = new Set(job.detachedImagePaths ?? []);
  const refCount = (job.selectedRefImagePaths ?? []).filter((r) => !detached.has(r)).length;

  const rows: { step: string; input: string; images: string; state: string; ok: boolean }[] = [
    {
      step: '1. Ảnh + mô tả sản phẩm',
      input: 'Crawl Shopee / dán mô tả / tải ảnh',
      images: 'Chọn ảnh sản phẩm (✓ viền xanh) + ảnh mẫu + ảnh nền ở khối 🖼️ ngay dưới',
      state: `${productsWithDesc}/${job.products.length} sản phẩm có mô tả · ${refCount} ảnh sản phẩm đã chọn`,
      ok: productsWithDesc === job.products.length && job.products.length > 0 && refCount > 0,
    },
    {
      step: '2. Gen ảnh background (tuỳ chọn)',
      input: 'Prompt background + mô tả sản phẩm đầu + sân khấu đã chốt',
      images: 'ảnh mẫu → tối đa 3 ảnh sản phẩm → ảnh nền hiện tại',
      state: job.selectedBackgroundImagePath ? 'Đã chọn 1 ảnh nền' : 'Chưa chọn ảnh nền (bỏ qua được)',
      ok: true,
    },
    {
      step: '3. Chốt sân khấu',
      input: 'Toàn bộ mô tả sản phẩm + ảnh (AI tự chạy khi sinh script lần đầu)',
      images: 'ảnh mẫu → tối đa 3 ảnh sản phẩm → ảnh nền',
      state: job.stageBible ? `Đã chốt — người dẫn: ${job.stageBible.host}` : 'Chưa chốt',
      ok: !!job.stageBible,
    },
    {
      step: '4. Sinh kịch bản',
      input: 'System prompt + mô tả sản phẩm + sân khấu đã chốt',
      images: 'Lượt viết lời thoại chỉ nhận CHỮ — ảnh chỉ đi vào 2 lượt phụ (đọc ngoại hình + chốt sân khấu)',
      state: `${productsWithScript}/${job.products.length} sản phẩm có script · ${totalSegments} đoạn`,
      ok: job.products.length > 0 && productsWithScript === job.products.length,
    },
    {
      step: '5. Gen video từng đoạn',
      input: 'veoPrompt + lời thoại đã chốt ở bước 4',
      images: 'TỐI ĐA 3: ảnh mẫu → ảnh nền → ảnh sản phẩm (đoạn nối tiếp mất thêm 1 suất cho khung hình cuối)',
      state: `${doneSegments}/${totalSegments} đoạn đã có video`,
      ok: totalSegments > 0 && doneSegments === totalSegments,
    },
  ];

  return (
    <div className="card">
      <details open>
        <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
          📘 5 bước &amp; ảnh nào đi vào bước nào (bấm để thu gọn)
        </summary>
        <div className="banner banner-info" style={{ fontSize: 12, marginTop: 10 }}>
          Mọi nút gen đều mở <strong>bản xem trước</strong> — thấy đủ prompt cuối cùng + đúng bộ ảnh
          AI nhận, xác nhận trong đó mới thật sự tốn lượt. Ghép video ở khối cuối trang.
        </div>
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, lineHeight: 1.6 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '6px 8px', minWidth: 150 }}>Bước</th>
                <th style={{ padding: '6px 8px', minWidth: 180 }}>Prompt ghép từ</th>
                <th style={{ padding: '6px 8px', minWidth: 220 }}>Ảnh gửi kèm</th>
                <th style={{ padding: '6px 8px', minWidth: 170 }}>Trạng thái job này</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.step} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>{r.step}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{r.input}</td>
                  <td style={{ padding: '6px 8px', color: 'var(--text-muted)' }}>{r.images}</td>
                  <td style={{ padding: '6px 8px' }}>
                    {r.ok ? '✅ ' : '⏳ '}
                    {r.state}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}
