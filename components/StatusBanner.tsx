'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

/**
 * Băng thông báo dùng chung của trang project — hiện CỐ ĐỊNH ở header, ngang hàng .topbar.
 *
 * Vì sao ở header chứ không nằm trong từng bước: chỉ `.content` cuộn (xem app/globals.css —
 * main là flex-column, .topbar/.pipeline-progress flex-shrink:0). Banner đặt trong .content sẽ
 * TRÔI theo nội dung, nên bấm một nút ở đầu trang mà thông báo nằm dưới danh sách 7 cảnh thì nó
 * hiện ngoài màn hình — nhìn hệt như nút không phản hồi. Đó đúng là ca "bấm gen background tất cả
 * nhưng không có gì xảy ra".
 *
 * Vì sao context chứ không truyền prop: 4 bước (Upload/ScriptReview/Storyboard/Concat) đều có
 * banner riêng của mình. Truyền prop qua từng bước là sửa 4 chỗ cho cùng một việc, và bước nào
 * quên nối thì lỗi của nó lại im lặng — đúng lớp bug vừa sửa.
 */

export type BannerKind = 'error' | 'info' | 'success';

interface BannerState {
  kind: BannerKind;
  text: string;
}

interface StatusBannerApi {
  /** Hiện thông báo ở header. text rỗng/null = ẩn (tiện cho `setError(null)` quen tay). */
  show: (text: string | null, kind?: BannerKind) => void;
  clear: () => void;
}

const Ctx = createContext<StatusBannerApi | null>(null);

/**
 * Dùng trong các bước để báo lỗi/trạng thái lên header.
 *
 * Ngoài provider (VD component render riêng trong test) trả về no-op thay vì ném lỗi: một cái
 * banner không hiện được KHÔNG đáng làm vỡ cả trang đang chạy.
 */
export function useStatusBanner(): StatusBannerApi {
  const ctx = useContext(Ctx);
  return useMemo(
    () => ctx ?? { show: () => {}, clear: () => {} },
    [ctx]
  );
}

const KIND_CLASS: Record<BannerKind, string> = {
  error: 'banner-error',
  info: 'banner-info',
  success: 'banner-success',
};

/** Chỗ đọc nội dung banner để RENDER — tách khỏi `useStatusBanner` (chỉ để ghi). */
const ValueCtx = createContext<BannerState | null>(null);

export function StatusBannerProvider({
  children,
  /** Đổi giá trị này = tự xoá banner. Truyền số bước đang mở: lỗi của Bước 3 không được dính
   *  lại khi Mr.D sang Bước 4, mà bắt từng bước tự nhớ gọi clear() thì sớm muộn có bước quên. */
  resetKey,
}: {
  children: React.ReactNode;
  resetKey?: string | number;
}) {
  const [banner, setBanner] = useState<BannerState | null>(null);

  // Xoá theo resetKey. Dùng state-during-render (không phải useEffect) để banner cũ KHÔNG kịp
  // nháy một khung hình ở bước mới.
  const [prevKey, setPrevKey] = useState(resetKey);
  if (prevKey !== resetKey) {
    setPrevKey(resetKey);
    if (banner) setBanner(null);
  }

  const show = useCallback((text: string | null, kind: BannerKind = 'error') => {
    setBanner(text && text.trim() ? { kind, text } : null);
  }, []);
  const clear = useCallback(() => setBanner(null), []);

  // `api` phải ổn định: các bước đưa `show` vào deps của useCallback/useEffect, đổi định danh mỗi
  // lần render sẽ kéo theo chuỗi re-render không cần thiết.
  const api = useMemo(() => ({ show, clear }), [show, clear]);

  return (
    <Ctx.Provider value={api}>
      <ValueCtx.Provider value={banner}>{children}</ValueCtx.Provider>
    </Ctx.Provider>
  );
}

/**
 * Chỗ HIỆN banner. Đặt ngay dưới <Topbar/>, NGOÀI .content — chỉ .content cuộn, nên đặt trong đó
 * là banner trôi mất khi Mr.D cuộn xuống xem danh sách cảnh.
 */
export function StatusBannerSlot() {
  const banner = useContext(ValueCtx);
  const { clear } = useStatusBanner();
  if (!banner) return null;
  return (
    <div className={`status-banner ${KIND_CLASS[banner.kind]}`} role="status" aria-live="polite">
      <span className="status-banner-text">{banner.text}</span>
      <button className="status-banner-close" onClick={clear} title="Đóng thông báo">
        ✕
      </button>
    </div>
  );
}
