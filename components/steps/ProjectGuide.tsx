'use client';

const stepStyle: React.CSSProperties = {
  fontSize: 13,
  lineHeight: 1.7,
  color: 'var(--text-muted)',
};

/**
 * Guide tổng quan luồng tạo video review sản phẩm (6 bước), đặt ở Bước 1 (Upload) trước khi
 * người dùng bắt đầu nhập liệu — cùng cấu trúc <details> với components/livestream/FlowGuide.tsx.
 * Đúc kết từ docs/huong-dan-prompt-video-review-san-pham.md (REVIEWER_LOCK, chọn góc kịch bản,
 * từ khoá chống "giả trân") để người dùng hiểu vì sao ảnh người review + chọn góc lại quan trọng.
 */
export function ProjectGuide() {
  return (
    <div className="card">
      <details open>
        <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
          📘 Cách hoạt động (bấm để thu gọn)
        </summary>
        <ol style={{ ...stepStyle, margin: '10px 0 0', paddingLeft: 20 }}>
          <li>
            <strong>Nhập sản phẩm</strong> — Tải ảnh sản phẩm + mô tả. Nếu video có người xuất hiện, tải
            thêm &quot;ảnh người review&quot; — AI sẽ khoá cố định ngoại hình người này xuyên suốt mọi cảnh,
            không đổi trang phục/kiểu tóc giữa chừng.
          </li>
          <li>
            <strong>Chọn góc kịch bản &amp; duyệt kịch bản</strong> — Chọn 1 trong các góc (Unboxing, Problem
            → Solution, Review trung thực, So sánh, Before-After...). Mỗi góc quyết định cấu trúc cảnh khác
            nhau. AI tự viết lời thoại + prompt video, giữ nhất quán bối cảnh/người/giọng nói qua mọi cảnh.
          </li>
          <li>
            <strong>Sinh ảnh storyboard</strong> — AI tạo ảnh tham chiếu cho từng cảnh, dùng để giữ đúng màu/
            hình dạng sản phẩm và ngoại hình người review khi gen video thật.
          </li>
          <li>
            <strong>Gen video</strong> — Tạo video cho từng cảnh (Google Flow). Khung hình cuối của cảnh
            trước tự động làm khung hình đầu cảnh sau, để các cảnh nối liền mạch như 1 lần quay liên tục.
          </li>
          <li>
            <strong>Tải video</strong> — Xem lại và tải video từng cảnh đã gen xong.
          </li>
          <li>
            <strong>Ghép video</strong> — Ghép các cảnh thành 1 video review hoàn chỉnh.
          </li>
        </ol>
        <p style={{ ...stepStyle, margin: '10px 0 0' }}>
          💡 Video review &quot;thật&quot; cần trông chưa qua dàn dựng — tránh chọn nhiều cảnh quá bóng
          bẩy/mượt mà. Muốn tự viết prompt tay hoặc hiểu sâu hơn, xem{' '}
          <code>docs/huong-dan-prompt-video-review-san-pham.md</code>.
        </p>
      </details>
    </div>
  );
}
