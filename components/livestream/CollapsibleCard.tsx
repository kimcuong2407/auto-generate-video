'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { resolveCardOpen } from '@/lib/livestream/cardState';

/**
 * Gấp một card cấu hình (dùng 1 lần / hiếm khi động tới) lại để trang detail không dài 5000px.
 * Dùng <details> native — không cần state animation, không cần thư viện.
 *
 * Card con bên trong (V2InputPanel, PromptSettingsPanel...) tự render .card của nó, nên ở đây
 * .collapsible-card gỡ viền + padding của card lồng bằng CSS thay vì sửa cả 3 panel.
 */
export function CollapsibleCard({
  id,
  title,
  defaultOpen = false,
  children,
}: {
  /** Khoá localStorage — nhớ trạng thái gấp/mở qua F5. */
  id: string;
  title: string;
  defaultOpen?: boolean;
  /** Hàm chứ không phải node: card đóng thì con KHÔNG mount, tránh fetch thừa (AiRunTimeline
      gọi API lấy toàn bộ lượt AI ngay lúc mount — gấp lại mà vẫn gọi là phí mỗi lần vào trang). */
  children: () => ReactNode;
}) {
  // Đọc localStorage sau khi mount: đọc ngay lúc render đầu sẽ lệch HTML server sinh ra (hydration).
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    setOpen(resolveCardOpen(localStorage.getItem(`lscard:${id}`), defaultOpen));
  }, [id, defaultOpen]);

  return (
    <details
      className="card collapsible-card"
      open={open}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open;
        setOpen(next);
        localStorage.setItem(`lscard:${id}`, next ? '1' : '0');
      }}
    >
      <summary className="collapsible-card-summary">{title}</summary>
      {open && children()}
    </details>
  );
}
