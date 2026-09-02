'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useLivestreamPolling } from '@/hooks/useLivestreamPolling';
import { ProductPanel } from '@/components/livestream/ProductPanel';
import { ConcatPanel } from '@/components/livestream/ConcatPanel';
import { FlowGuide } from '@/components/livestream/FlowGuide';
import { PromptSettingsPanel } from '@/components/livestream/PromptSettingsPanel';
import { JobImagePanel } from '@/components/livestream/JobImagePanel';
import { PromptPreviewModal } from '@/components/livestream/PromptPreviewModal';
import { V2InputPanel } from '@/components/livestream/V2InputPanel';
import type { LivestreamV2Input } from '@/lib/livestream/types';

/** Đọc SSE response của route script/generate (fetch thường, không dùng EventSource vì cần POST). */
async function streamScriptGeneration(
  jobId: string,
  productId: string | undefined,
  forceStageBible: boolean,
  onEvent: (event: {
    type: string;
    productId?: string;
    message?: string;
    overlong?: Array<{ id: string; words: number; duration: number; maxWords: number }>;
    qaIssues?: Array<{
      scene: number;
      group: string;
      severity: string;
      reason: string;
      fix: string;
    }>;
  }) => void
): Promise<void> {
  const res = await fetch(`/api/livestream/${jobId}/script/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...(productId ? { productId } : {}),
      ...(forceStageBible ? { forceStageBible: true } : {}),
    }),
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf('\n\n')) >= 0) {
      const chunk = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      const line = chunk.split('\n').find((l) => l.startsWith('data:'));
      if (!line) continue;
      try {
        onEvent(JSON.parse(line.slice(5).trim()));
      } catch {
        // bỏ qua chunk không parse được
      }
    }
  }
}

export default function LivestreamDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const jobId = params.id;
  const { job, loading, error, refresh, busy } = useLivestreamPolling(jobId);

  const [scriptingProductIds, setScriptingProductIds] = useState<Set<string>>(new Set());
  const [scriptingAll, setScriptingAll] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // Sản phẩm đang xem trước prompt sinh script (null = không mở modal). Preview theo TỪNG sản phẩm
  // vì user prompt chứa mô tả + vị trí trong buổi live riêng của sản phẩm đó.
  const [previewScriptProductId, setPreviewScriptProductId] = useState<string | null>(null);
  // Hành động HÀNG LOẠT cũng phải qua preview: chúng chạy trên nhiều sản phẩm/đoạn nên preview chỉ
  // hiện được payload của cái ĐẦU TIÊN — đủ để bắt lỗi sân khấu/ảnh, vì mọi sản phẩm dùng chung
  // bible + bộ ảnh của job. Nhãn nói rõ số lượng sẽ chạy để không hiểu nhầm là chạy 1 cái.
  const [bulkPreview, setBulkPreview] = useState<
    null | { kind: 'script-all' | 'restage' | 'gen-all' }
  >(null);
  // Input Shopee của job V2 — null = job V1 (tab Livestream Script cũ), khi đó không hiện panel V2
  // và mọi thứ giữ nguyên hành vi cũ. undefined = chưa tải xong.
  const [v2Input, setV2Input] = useState<LivestreamV2Input | null | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    fetch(`/api/livestream/${jobId}/v2-input`)
      .then((r) => (r.ok ? r.json() : { input: null }))
      .then((data) => {
        if (alive) setV2Input(data.input ?? null);
      })
      .catch(() => {
        if (alive) setV2Input(null);
      });
    return () => {
      alive = false;
    };
  }, [jobId]);

  /**
   * @param forceStageBible chốt LẠI sân khấu (người dẫn/bối cảnh/giọng) dù input chưa đổi. Cần
   * khi bible cũ sai về CHẤT chứ không phải về input — VD bible chốt bằng bản prompt tiếng Anh
   * cũ nên veoPrompt sinh ra vẫn dính tiếng Anh dù prompt hiện tại đã là tiếng Việt.
   */
  async function handleGenerateScript(productId?: string, forceStageBible = false) {
    setActionError(null);
    if (productId) {
      setScriptingProductIds((prev) => new Set(prev).add(productId));
    } else {
      setScriptingAll(true);
    }
    const overlongAll: string[] = [];
    const qaAll: string[] = [];
    // LỖI phải nổi lên UI. Trước đây chỉ bắt 'stage_bible_stale' và 'product_done', nên khi server
    // gửi 'product_error'/'fatal' thì stream vẫn đóng bình thường và UI báo THÀNH CÔNG dù không có
    // đoạn nào được sinh — đúng thứ khiến Mr.D bấm "Chốt lại sân khấu" 3 lần mà script không đổi.
    const failures: string[] = [];
    let fatal: string | null = null;
    let bibleRechecked = false;
    try {
      await streamScriptGeneration(jobId, productId, forceStageBible, (e) => {
        // Ảnh/mô tả sản phẩm đã đổi từ lần chốt trước → server đang chốt lại sân khấu. Báo cho
        // Mr.D biết vì sao lần này chậm hơn và vì sao người dẫn có thể khác lần trước.
        if (e.type === 'stage_bible_stale') bibleRechecked = true;
        if (e.type === 'fatal') fatal = e.message ?? 'Sinh script dừng giữa chừng';
        if (e.type === 'stage_bible_missing' && e.message) failures.push(e.message);
        if (e.type === 'product_error') {
          failures.push(`${e.productId ?? 'sản phẩm'}: ${e.message ?? 'lỗi không rõ'}`);
        }
        // Trạng thái sản phẩm đã được server ghi vào job nên chỉ refresh() sau khi stream đóng;
        // riêng cảnh báo lời thoại quá dài không lưu vào job nên phải bắt tại đây.
        if (e.type === 'product_done' && e.overlong?.length) {
          overlongAll.push(
            ...e.overlong.map((o) => `${o.id}: ${o.words}/${o.maxWords} từ (${o.duration}s)`)
          );
        }
        // Cảnh báo QA (lỗi vật lý/claim) cũng không lưu vào job — bắt tại đây như overlong.
        // Chỉ hiện lỗi mức "cao": mức "thấp" chỉ là nguy cơ tuỳ cách Veo diễn giải, đẩy hết lên
        // thì cảnh báo dài tới mức không ai đọc, mà đọc không hết thì bằng không có.
        if (e.type === 'product_done' && e.qaIssues?.length) {
          qaAll.push(
            ...e.qaIssues
              .filter((q) => q.severity === 'cao')
              .map((q) => `Cảnh ${q.scene} (${q.group}): ${q.reason}${q.fix ? ` → ${q.fix}` : ''}`)
          );
        }
      });
      await refresh();
      // Lỗi ưu tiên hiển thị trước mọi cảnh báo khác — đây là thứ Mr.D cần biết ngay.
      if (fatal) {
        setActionError(`❌ ${fatal}`);
        return;
      }
      if (failures.length > 0) {
        setActionError(`❌ Sinh script thất bại ${failures.length} chỗ:\n${failures.join('\n')}`);
        return;
      }
      // Gom MỌI cảnh báo vào 1 lần setActionError. Trước đây mỗi loại gọi setActionError riêng
      // nên loại sau ghi đè loại trước — chốt lại sân khấu mà đồng thời có đoạn quá dài thì
      // Mr.D chỉ thấy đúng cảnh báo cuối cùng.
      const warnings: string[] = [];
      if (bibleRechecked) {
        warnings.push(
          forceStageBible
            ? 'Đã chốt lại sân khấu (người dẫn/bối cảnh/giọng) và sinh lại script cho toàn bộ sản phẩm. Video đã gen trước đó vẫn theo sân khấu cũ — gen lại đoạn nếu muốn đồng bộ.'
            : 'Ảnh hoặc mô tả sản phẩm đã đổi so với lần trước — sân khấu (người dẫn/bối cảnh/giọng) đã được chốt lại theo dữ liệu mới. Các sản phẩm đã sinh script trước đó vẫn giữ sân khấu cũ, bấm "Sinh lại script" cho từng sản phẩm nếu muốn đồng bộ.'
        );
      }
      if (overlongAll.length > 0) {
        warnings.push(
          `Cảnh báo: ${overlongAll.length} đoạn vẫn dài hơn thời lượng cho phép sau khi đã tự rút gọn — Veo có thể đọc không kịp và cắt cụt câu. Bấm sinh lại script cho sản phẩm đó nếu cần: ${overlongAll.join('; ')}`
        );
      }
      if (qaAll.length > 0) {
        warnings.push(
          `⚠️ Soát kịch bản thấy ${qaAll.length} chỗ nên sửa TRƯỚC khi gen video:\n${qaAll.join('\n')}`
        );
      }
      if (warnings.length > 0) setActionError(warnings.join('\n\n'));
    } catch (err) {
      setActionError((err as Error).message);
    } finally {
      if (productId) {
        setScriptingProductIds((prev) => {
          const next = new Set(prev);
          next.delete(productId);
          return next;
        });
      } else {
        setScriptingAll(false);
      }
    }
  }

  async function handleGenerateAllSegments() {
    setActionBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/livestream/${jobId}/segments/generate-all`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) setActionError(data.error || 'Chạy toàn bộ thất bại');
      await refresh();
    } finally {
      setActionBusy(false);
    }
  }

  /**
   * Bật/tắt chế độ auto-gen nối tiếp (cascade). Cascade đã có sẵn ở lib/livestream/segmentSync.ts
   * nhưng trước đây `chaining` chỉ đặt được lúc TẠO job — không có chỗ nào sửa lại, nên người dùng
   * không biết nó tồn tại lẫn không tắt được khi muốn gen song song cho nhanh.
   */
  async function handleChangeChaining(value: string) {
    setActionBusy(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/livestream/${jobId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chaining: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error || 'Đổi chế độ auto thất bại');
      }
      await refresh();
    } finally {
      setActionBusy(false);
    }
  }

  async function handleStopAllSegments() {
    setActionBusy(true);
    try {
      const res = await fetch(`/api/livestream/${jobId}/segments/stop-all`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setActionError(data.error || 'Dừng tất cả thất bại');
      }
      await refresh();
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDeleteJob() {
    if (!confirm('Xoá job này? Toàn bộ dữ liệu (script, video đã gen) sẽ bị xoá vĩnh viễn.')) return;
    const res = await fetch(`/api/livestream/${jobId}`, { method: 'DELETE' });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      alert(data.error || 'Xoá job thất bại');
      return;
    }
    router.push('/livestream');
  }

  if (loading) {
    return <div className="content">Đang tải...</div>;
  }
  if (error || !job) {
    return (
      <div className="content">
        <div className="banner">{error || 'Job không tồn tại'}</div>
        <Link href="/livestream" className="back-link">← Về danh sách job</Link>
      </div>
    );
  }

  const hasGeneratingSegment = job.products.some((p) => p.segments.some((s) => s.status === 'generating'));
  // Có ảnh sản phẩm trong kho CHUNG cả job nhưng chưa chọn ảnh tham chiếu → chặn "Gen tất cả".
  const jobNeedsRef = job.spokespersonImagePaths.length > 0 && job.selectedRefImagePaths.length === 0;
  // Đoạn ĐẦU TIÊN chưa gen — đại diện cho preview "Gen tất cả". Mọi đoạn dùng chung bộ ảnh của job
  // nên xem 1 đoạn là đủ thấy ảnh nào tới Veo; prompt thì mỗi đoạn một khác, nêu rõ ở nhãn nút.
  const firstSegmentRef = job.products
    .flatMap((p) => p.segments.map((s) => ({ productId: p.id, segment: s })))
    .sort((a, b) => a.segment.order - b.segment.order)
    .find((x) => x.segment.status === 'idle' || x.segment.status === 'failed');

  const totalSegments = job.products.reduce((n, p) => n + p.segments.length, 0);

  return (
    <div style={{ display: 'flex', width: '100%' }}>
      <main>
        <div className="topbar">
          <h1>{job.name}</h1>
          <div className="topbar-actions">
            <Link href={v2Input ? '/livestream-v2' : '/livestream'} className="btn btn-ghost">
              ← Danh sách
            </Link>
            <button className="btn btn-ghost" onClick={handleDeleteJob} disabled={hasGeneratingSegment}>
              🗑 Xoá job
            </button>
            <button className="btn btn-ghost" onClick={handleStopAllSegments} disabled={actionBusy || !hasGeneratingSegment}>
              ⏹ Dừng tất cả
            </button>
            <button
              className="btn"
              onClick={() => setBulkPreview({ kind: 'script-all' })}
              disabled={scriptingAll || busy || !job.products.length}
              title="Mở bản xem trước prompt + ảnh (sản phẩm đầu tiên); xác nhận trong đó mới sinh cho toàn bộ sản phẩm"
            >
              {scriptingAll ? 'Đang sinh script...' : '👁 Xem trước → Sinh script tất cả'}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => setBulkPreview({ kind: 'restage' })}
              disabled={scriptingAll || busy || !job.products.length}
              title="Dùng khi sân khấu đã chốt bị sai (VD prompt còn tiếng Anh từ bản cũ) — xem trước rồi ép AI chốt lại từ ảnh + mô tả hiện tại và sinh lại toàn bộ script"
            >
              🎬 Xem trước → Chốt lại sân khấu
            </button>
            <button
              className="btn btn-primary"
              onClick={() => setBulkPreview({ kind: 'gen-all' })}
              disabled={actionBusy || jobNeedsRef || !firstSegmentRef}
              title={
                jobNeedsRef
                  ? 'Chưa chọn ảnh sản phẩm tham chiếu — chọn 1 ảnh ở phần cấu hình ảnh đầu trang'
                  : !firstSegmentRef
                    ? 'Chưa có đoạn nào — sinh script trước'
                    : 'Mở bản xem trước prompt + ảnh của đoạn đầu; xác nhận trong đó mới gen toàn bộ đoạn'
              }
            >
              👁 Xem trước → Gen tất cả đoạn
            </button>
          </div>
        </div>

        <div className="content">
          {job.flowStatusCache.flowConnected === false && (
            <div className="banner">
              ⚠️ Chưa kết nối được Google Flow — vào <a href="/settings/flow">Cài đặt → Flow</a> để đăng nhập trước khi
              gen video.
            </div>
          )}
          {actionError && <div className="banner">{actionError}</div>}
          {/* Công tắc cascade. Ảnh ref là cấp JOB (selectedRefImagePaths) nên mọi đoạn tự dùng
              chung đúng bộ ảnh đã chọn — chỉ thứ tự chạy là do chaining quyết. */}
          <div
            className="banner"
            style={{ background: '#f6f8fa', color: '#444', display: 'flex', alignItems: 'center', gap: 8 }}
          >
            <label htmlFor="chaining-select">
              <b>🔁 Tự động gen đoạn tiếp theo:</b>
            </label>
            <select
              id="chaining-select"
              value={job.chaining}
              disabled={actionBusy}
              onChange={(e) => handleChangeChaining(e.target.value)}
            >
              <option value="continuous">Bật — chạy nối tiếp toàn bộ job</option>
              <option value="per_product">Bật — chỉ nối tiếp trong cùng sản phẩm</option>
              <option value="off">Tắt — gen song song, tự bấm từng đoạn</option>
            </select>
            <span style={{ fontSize: 13, opacity: 0.75 }}>
              {job.chaining === 'off'
                ? 'Các đoạn chạy song song, không dùng khung hình cuối của đoạn trước.'
                : 'Gen xong 1 đoạn sẽ tự kích đoạn kế (cùng ảnh tham chiếu, prompt riêng từng đoạn) và nối khung hình cuối.'}
            </span>
          </div>
          {/* Sân khấu đã chốt: hiện ra để phát hiện sai NGAY lúc sinh script (VD ảnh mẫu nam mà
              host tả "woman"), thay vì chỉ biết sau khi gen video hỏng. Bible tự chốt lại khi ảnh
              hoặc mô tả sản phẩm đổi — xem isStageBibleStale ở lib/livestream/stageBible.ts. */}
          {job.stageBible && (
            <div className="banner" style={{ background: '#f6f8fa', color: '#444' }}>
              🎬 Sân khấu đã chốt — <b>Người dẫn:</b> {job.stageBible.host}
              <br />
              <b>Giọng:</b> {job.stageBible.voice}
            </div>
          )}

          <FlowGuide job={job} />
          {v2Input && (
            <V2InputPanel jobId={jobId} input={v2Input} busy={busy} onRefresh={refresh} />
          )}
          <PromptSettingsPanel jobId={jobId} isV2={!!v2Input} onRefresh={refresh} />
          <JobImagePanel job={job} onRefresh={refresh} />

          {job.products.map((product) => (
            <ProductPanel
              key={product.id}
              jobId={jobId}
              job={job}
              product={product}
              onRefresh={refresh}
              onGenerateScript={(productId) => handleGenerateScript(productId)}
              scriptBusy={scriptingAll || scriptingProductIds.has(product.id)}
            />
          ))}

          <ConcatPanel job={job} onRefresh={refresh} />
        </div>
      </main>

      {previewScriptProductId && (
        <PromptPreviewModal
          jobId={jobId}
          step="script"
          productId={previewScriptProductId}
          imageR2Urls={job.imageR2Urls ?? undefined}
          onSaved={refresh}
          onClose={() => setPreviewScriptProductId(null)}
        />
      )}

      {/* Preview cho 3 hành động hàng loạt. Payload hiện là của sản phẩm/đoạn ĐẦU TIÊN — sân khấu
          và bộ ảnh dùng chung cả job nên đủ để bắt lỗi trước khi đốt lượt cho toàn bộ. */}
      {bulkPreview?.kind === 'script-all' && (
        <PromptPreviewModal
          jobId={jobId}
          step="script"
          productId={job.products[0]?.id}
          imageR2Urls={job.imageR2Urls ?? undefined}
          confirmLabel={`✍️ Sinh script cho cả ${job.products.length} sản phẩm`}
          onConfirm={() => handleGenerateScript()}
          onSaved={refresh}
          onClose={() => setBulkPreview(null)}
        />
      )}
      {bulkPreview?.kind === 'restage' && (
        <PromptPreviewModal
          jobId={jobId}
          step="script"
          productId={job.products[0]?.id}
          imageR2Urls={job.imageR2Urls ?? undefined}
          confirmLabel={`🎬 Chốt lại sân khấu + sinh lại ${job.products.length} sản phẩm (ghi đè script)`}
          onConfirm={() => handleGenerateScript(undefined, true)}
          onSaved={refresh}
          onClose={() => setBulkPreview(null)}
        />
      )}
      {bulkPreview?.kind === 'gen-all' && firstSegmentRef && (
        <PromptPreviewModal
          jobId={jobId}
          step="segment"
          productId={firstSegmentRef.productId}
          segmentId={firstSegmentRef.segment.id}
          imageR2Urls={job.imageR2Urls ?? undefined}
          confirmLabel={`▶ Gen toàn bộ ${totalSegments} đoạn (prompt mỗi đoạn khác nhau)`}
          onConfirm={handleGenerateAllSegments}
          onSaved={refresh}
          onClose={() => setBulkPreview(null)}
        />
      )}
    </div>
  );
}
