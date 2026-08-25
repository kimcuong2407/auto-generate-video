'use client';

const stepStyle: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.7,
  color: 'var(--text-muted)',
};

/**
 * Guide tổng quan luồng tạo video livestream, đặt đầu trang chi tiết job. Dùng <details> gốc
 * (mặc định mở) để người mới hiểu 6 bước, người quen có thể thu gọn.
 */
export function FlowGuide() {
  return (
    <div className="card">
      <details open>
        <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
          📘 Cách hoạt động (bấm để thu gọn)
        </summary>
        <ol style={{ ...stepStyle, margin: '10px 0 0', paddingLeft: 20 }}>
          <li>
            <strong>Lấy sản phẩm</strong> — Crawl Shopee bằng Chrome extension ở trang{' '}
            <code>/shopee-crawl</code>, hoặc bấm &quot;Tạo job&quot; và nhập tay (link / dán mô tả / tải
            ảnh). AI tự chuẩn hoá tên + mô tả.
          </li>
          <li>
            <strong>Kiểm tra &amp; bổ sung mô tả</strong> — Với mỗi sản phẩm, xem lại ô &quot;Mô tả sản
            phẩm&quot;. Nếu báo <code>needs_manual</code>, dán mô tả hoặc tải ảnh chụp màn hình để AI đọc.
            Có thể tải &quot;ảnh người mẫu&quot; để giữ nhất quán ngoại hình.
          </li>
          <li>
            <strong>(Nâng cao) Chỉnh system prompt</strong> — Mở phần ⚙️ để xem/chỉnh chỉ dẫn AI viết kịch
            bản (giọng nói, phong cách). Bỏ qua nếu muốn dùng mặc định.
          </li>
          <li>
            <strong>Sinh kịch bản</strong> — Bấm &quot;✍️ Sinh script&quot; (từng sản phẩm) hoặc &quot;✍️
            Sinh script tất cả&quot;. AI tạo lời thoại + prompt video cho từng đoạn ~8s.
          </li>
          <li>
            <strong>Gen video</strong> — Bấm &quot;▶ Gen&quot; từng đoạn hoặc &quot;▶ Gen tất cả
            đoạn&quot;. Cần tài khoản Google Flow đã đăng nhập ở Cài đặt → Flow.
          </li>
          <li>
            <strong>Ghép video</strong> — Ở phần cuối trang, ghép các đoạn đã gen xong thành 1 video
            livestream hoàn chỉnh.
          </li>
        </ol>
      </details>
    </div>
  );
}
