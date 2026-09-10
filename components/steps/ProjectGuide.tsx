'use client';

import { planVideoInputs } from '@/lib/data/videoInputs';
import type { Project } from '@/lib/types';

export interface FlowRow {
  step: string;
  input: string;
  images: string;
  state: string;
  ok: boolean;
}

/**
 * Mô tả ảnh đi vào bước 4 (gen video) — đọc từ chính planVideoInputs() thay vì UI tự suy diễn
 * lại luật, để bảng không bao giờ nói khác backend.
 *
 * Vì sao dòng này quan trọng nhất bảng: generateVideo() ưu tiên endpoint referenceImages (r2v)
 * bất cứ khi nào refImages không rỗng và ÂM THẦM BỎ QUA startImage — video ra khác hẳn sản phẩm
 * mà không có lỗi nào được ném. Người dùng chỉ thấy "video sai" chứ không thấy vì sao. Ghi rõ
 * cảnh đầu tiên đang dùng khung khởi điểm (i2v) hay ref images (r2v) thì lộ ngay.
 */
function describeVideoInputs(project: Project): string {
  const first = project.script.scenes.find((s) => s.order === 1) ?? project.script.scenes[0];
  if (!first) return 'Chưa có cảnh nào — duyệt kịch bản ở Bước 2 trước';

  const plan = planVideoInputs(project, first);
  if (plan.chained) {
    return 'Khung khởi điểm (i2v) = khung hình cuối cảnh trước — nối liền mạch';
  }
  if (plan.startRelPath) {
    return 'Khung khởi điểm (i2v) = ảnh storyboard của chính cảnh (Bước 3)';
  }
  if (plan.refRelPaths.length > 0) {
    return `Không có khung khởi điểm → ref images (r2v), ${plan.refRelPaths.length} ảnh — model tự diễn giải lại hình dáng, dễ lệch sản phẩm`;
  }
  return 'CHƯA CÓ ẢNH NÀO — gen video chỉ bằng chữ, sản phẩm gần như chắc chắn sai';
}

/** Ảnh nào thật sự được gửi khi gen storyboard — 2 nguồn đều bị gate bởi toggle ở Bước 3. */
function describeStoryboardRefs(project: Project): string {
  const refs: string[] = [];
  if (project.storyboard.useProductReference) refs.push('1 ảnh sản phẩm đã chọn');
  if (project.storyboard.useSpokespersonReference && project.inputs.spokespersonImagePath) {
    refs.push('ảnh người review');
  }
  return refs.length > 0
    ? `${refs.join(' + ')} (bật ở Bước 3)`
    : 'KHÔNG gửi ảnh nào — AI vẽ thuần bằng chữ, dễ sai màu/hình dạng';
}

/**
 * Tính 6 dòng của bảng luồng từ trạng thái THẬT của project.
 *
 * Tách khỏi phần render để self-check (scripts/check-project-guide.ts) assert được logic mà
 * không cần dựng React.
 */
export function buildFlowRows(project: Project): FlowRow[] {
  const { productImages, spokespersonImagePath } = project.inputs;
  const scenes = project.script.scenes;
  const storyboardImages = project.storyboard.images;

  const hasProductDesc = !!(
    project.product.name.trim() ||
    project.product.keyFeatures.length > 0 ||
    project.product.visualDescription.trim()
  );
  const promptReady = scenes.filter((s) => s.veoPrompt.trim()).length;
  const doneStoryboard = storyboardImages.filter((img) => img.status === 'done').length;
  const doneScenes = scenes.filter((s) => s.status === 'done').length;
  // Cùng điều kiện với DownloadStep/ConcatStep: done mà mất file thì không tải/ghép được.
  const readyScenes = scenes.filter((s) => s.status === 'done' && s.videoPath).length;

  return [
    {
      step: '1. Ảnh + mô tả sản phẩm',
      input: 'Nhập tay / Shopee Crawl',
      images: 'Ảnh sản phẩm + ảnh người review (khoá ngoại hình xuyên suốt mọi cảnh)',
      state: `${productImages.length} ảnh sản phẩm · ${spokespersonImagePath ? 'có' : 'chưa có'} ảnh người review · ${hasProductDesc ? 'đã có mô tả' : 'chưa có mô tả'}`,
      ok: productImages.length > 0 && hasProductDesc,
    },
    {
      step: '2. Duyệt kịch bản',
      input: 'Mô tả sản phẩm + góc kịch bản + mô tả hình ảnh do AI vision đọc từ ảnh',
      images: 'Vision đọc ảnh sản phẩm 1 lượt để lấy màu/chất liệu thật — lượt viết lời thoại chỉ nhận CHỮ',
      state: `${promptReady}/${scenes.length} cảnh có prompt · góc: ${project.scriptAngleId || 'chưa chọn'}`,
      ok: scenes.length > 0 && promptReady === scenes.length,
    },
    {
      step: '3. Storyboard ảnh',
      input: 'Prompt riêng từng cảnh (sinh từ kịch bản đã duyệt)',
      images: describeStoryboardRefs(project),
      state: `${doneStoryboard}/${storyboardImages.length} ảnh đã gen`,
      ok: storyboardImages.length > 0 && doneStoryboard === storyboardImages.length,
    },
    {
      step: '4. Gen video (Veo Flow)',
      input: 'veoPrompt + lời thoại + negative prompt của từng cảnh',
      images: describeVideoInputs(project),
      state: `${doneScenes}/${scenes.length} cảnh có video · nối cảnh: ${project.sceneChaining ? 'BẬT' : 'tắt'}`,
      ok: scenes.length > 0 && doneScenes === scenes.length,
    },
    {
      step: '5. Tải output về máy',
      input: '—',
      images: '—',
      state: `${readyScenes}/${scenes.length} cảnh sẵn sàng tải`,
      ok: scenes.length > 0 && readyScenes === scenes.length,
    },
    {
      step: '6. Ghép video hoàn chỉnh',
      input: '—',
      images: '—',
      state:
        project.concat.status === 'done'
          ? 'Đã ghép xong'
          : `${project.concat.status} · còn ${scenes.length - readyScenes} cảnh chưa sẵn sàng`,
      ok: project.concat.status === 'done',
    },
  ];
}

/**
 * Bảng tra 6 bước của luồng video review, kèm TRẠNG THÁI THẬT của project hiện tại — cùng khuôn
 * components/livestream/FlowGuide.tsx.
 *
 * Vì sao không phải danh sách hướng dẫn tĩnh như trước: nguyên nhân gen sai gần như luôn nằm ở
 * "ảnh tôi tưởng đã gửi thật ra không tới bước đó" (toggle ref ở Bước 3 đang tắt, storyboard chưa
 * gen nên bước 4 lặng lẽ rơi về r2v). Guide chỉ mô tả thao tác thì không lộ ra điều đó; bảng có
 * cột trạng thái thì lộ ngay.
 */
export function ProjectGuide({ project }: { project: Project }) {
  const rows = buildFlowRows(project);

  return (
    <div className="card">
      <details open>
        <summary style={{ cursor: 'pointer', fontSize: 14, fontWeight: 600 }}>
          📘 6 bước &amp; ảnh nào đi vào bước nào (bấm để thu gọn)
        </summary>
        <div className="banner banner-info" style={{ fontSize: 12, marginTop: 10 }}>
          Video review &quot;thật&quot; cần trông chưa qua dàn dựng — tránh chọn nhiều cảnh quá bóng
          bẩy/mượt mà. Muốn tự viết prompt tay, xem{' '}
          <code>docs/huong-dan-prompt-video-review-san-pham.md</code>.
        </div>
        <div style={{ overflowX: 'auto', marginTop: 10 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, lineHeight: 1.6 }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                <th style={{ padding: '6px 8px', minWidth: 150 }}>Bước</th>
                <th style={{ padding: '6px 8px', minWidth: 180 }}>Prompt ghép từ</th>
                <th style={{ padding: '6px 8px', minWidth: 220 }}>Ảnh gửi kèm</th>
                <th style={{ padding: '6px 8px', minWidth: 170 }}>Trạng thái project này</th>
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
