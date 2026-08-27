import { NextRequest, NextResponse } from 'next/server';
import { jobExists, readJob } from '@/lib/livestream/jobStore';
import { buildBackgroundPrompt } from '@/lib/livestream/backgroundGenerate';
import { buildLivestreamUserPrompt, resolveScriptSystemPrompt } from '@/lib/livestream/scriptPrompt';
import { computeSegmentDurations } from '@/lib/livestream/segmentSanitize';
import { formatStageBibleBlock, isStageBibleStale } from '@/lib/livestream/stageBible';
import { pickVisionRefEntries } from '@/lib/livestream/refImages';
import { BACKGROUND_SYSTEM_PROMPT } from '@/lib/livestream/promptDefaults';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 1 ảnh trong preview: đường dẫn tương đối + nhãn vai trò để UI vẽ thumbnail có chú thích. */
export interface PreviewRefImage {
  rel: string;
  label: string;
}

export interface PreviewPromptResult {
  /** Chuỗi prompt CUỐI CÙNG server sẽ gửi cho AI, đã ghép đủ mọi mảnh. */
  prompt: string;
  /** Ảnh gửi kèm, đúng thứ tự AI nhận được. */
  refImages: PreviewRefImage[];
  /**
   * Cảnh báo về những mảnh CHƯA CÓ tại thời điểm preview (sẽ được sinh lúc bấm gen thật) — preview
   * cố tình KHÔNG gọi AI để mở bao nhiêu lần cũng miễn phí, xem README của route này.
   */
  notes: string[];
}

/**
 * Preview prompt + ảnh ref sẽ gửi cho AI, KHÔNG gọi AI và KHÔNG ghi gì vào job.
 *
 * Vì sao cần: prompt thật được ghép SERVER-SIDE từ nhiều mảnh (prompt gốc + mô tả sản phẩm + sân
 * khấu đã chốt + chú giải ảnh ref + ràng buộc số từ), trong khi UI chỉ cho xem/sửa đúng mảnh
 * "prompt gốc". Mr.D không có cách nào biết AI thực sự nhận được gì trước khi tốn lượt gen.
 *
 * Hai mảnh do AI sinh (`stageBible`, `visualDescription`) chỉ hiện khi ĐÃ có cache; thiếu thì ghi
 * vào `notes` chứ không tự gọi AI — preview phải rẻ để bấm thoải mái.
 *
 * Query: `?step=background|script` (+ `productId` tuỳ chọn, mặc định sản phẩm đầu tiên).
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }
  const job = await readJob(id);
  const step = req.nextUrl.searchParams.get('step');
  if (step !== 'background' && step !== 'script') {
    return NextResponse.json({ error: 'step phải là "background" hoặc "script"' }, { status: 400 });
  }
  if (job.products.length === 0) {
    return NextResponse.json({ error: 'Job chưa có sản phẩm nào' }, { status: 400 });
  }

  const productId = req.nextUrl.searchParams.get('productId');
  const product = productId ? job.products.find((p) => p.id === productId) : job.products[0];
  if (!product) {
    return NextResponse.json({ error: 'Sản phẩm không tồn tại' }, { status: 404 });
  }

  const notes: string[] = [];
  // Bible dùng cho preview là bible ĐANG cache. Nếu stale, lúc bấm gen thật ensureStageBible sẽ
  // chốt lại → prompt thật sẽ khác preview, phải nói rõ chứ không im lặng hiện bible sai.
  const bible = job.stageBible ?? null;
  if (!bible) {
    notes.push('Chưa chốt sân khấu — khối "sân khấu cố định" sẽ được AI sinh và ghép thêm khi bấm gen thật.');
  } else if (isStageBibleStale(job)) {
    notes.push('Sân khấu đã chốt KHÔNG còn khớp ảnh/mô tả hiện tại — khi bấm gen thật, AI sẽ chốt lại và khối này sẽ khác preview.');
  }

  if (step === 'background') {
    const entries = pickVisionRefEntries(job);
    // promptOverride của UI không được lưu vào job (chỉ gửi kèm lúc bấm gen), nên preview dùng đúng
    // mặc định; UI tự truyền bản nháp đang sửa qua ?prompt nếu muốn xem bản đã chỉnh.
    const basePrompt = req.nextUrl.searchParams.get('prompt')?.trim() || BACKGROUND_SYSTEM_PROMPT;
    const result: PreviewPromptResult = {
      prompt: buildBackgroundPrompt(basePrompt, product.description || product.name, bible, entries),
      refImages: entries.map((e) => ({ rel: e.rel, label: e.label })),
      notes,
    };
    return NextResponse.json(result);
  }

  // step === 'script'
  const index = job.products.findIndex((p) => p.id === product.id);
  const durations = computeSegmentDurations(product.targetDurationSec);
  // visualDescription do vision đọc ảnh sản phẩm, sinh MỚI mỗi lần gen (không cache trong job) —
  // preview không gọi AI nên chỉ báo chỗ nó sẽ được chèn.
  const hasRefs = (job.selectedRefImagePaths ?? []).length > 0;
  const visualPlaceholder = hasRefs
    ? '[AI vision sẽ đọc ảnh sản phẩm và chèn mô tả ngoại hình vào đây khi bấm sinh script]'
    : undefined;
  if (hasRefs) {
    notes.push('Mô tả ngoại hình sản phẩm được AI vision sinh mới mỗi lần sinh script — preview chỉ đánh dấu vị trí.');
  }

  const userPrompt = buildLivestreamUserPrompt(
    product.description,
    durations,
    visualPlaceholder,
    bible ? formatStageBibleBlock(bible) : undefined,
    {
      index,
      total: job.products.length,
      prevProductName: index > 0 ? job.products[index - 1].name : undefined,
    }
  );

  const result: PreviewPromptResult = {
    // Sinh script gửi system prompt + user prompt TÁCH RIÊNG cho AI; nối lại có nhãn để Mr.D thấy
    // trọn vẹn payload trong 1 khung, đúng thứ tự AI đọc.
    prompt: `===== SYSTEM PROMPT =====\n${resolveScriptSystemPrompt(job)}\n\n===== USER PROMPT (sản phẩm "${product.name}") =====\n${userPrompt}`,
    // Bước sinh script KHÔNG gửi ảnh cho AI viết lời thoại — ảnh chỉ đi vào 2 lượt phụ: vision đọc
    // ngoại hình sản phẩm, và chốt sân khấu. Hiện đúng bộ ảnh của 2 lượt đó để Mr.D kiểm tra.
    refImages: pickVisionRefEntries(job).map((e) => ({ rel: e.rel, label: e.label })),
    notes: [
      ...notes,
      'Ảnh liệt kê dưới đây gửi cho AI ở 2 lượt phụ (đọc ngoại hình sản phẩm + chốt sân khấu). Lượt viết lời thoại chỉ nhận chữ.',
    ],
  };
  return NextResponse.json(result);
}
