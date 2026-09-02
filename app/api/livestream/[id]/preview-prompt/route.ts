import { NextRequest, NextResponse } from 'next/server';
import { jobExists, readJob } from '@/lib/livestream/jobStore';
import { buildBackgroundPrompt } from '@/lib/livestream/backgroundGenerate';
import { buildScriptUserPrompt } from '@/lib/livestream/scriptPrompt';
import { buildPromptParamValues, fillPromptParams } from '@/lib/livestream/promptParams';
import { loadPromptSet } from '@/lib/livestream/promptStore';
import { formatProductLockBlock, pickProductLockRefPaths } from '@/lib/livestream/productLock';
import { readV2Input } from '@/lib/livestream/v2Store';
import { computeSegmentDurations } from '@/lib/livestream/segmentSanitize';
import { formatStageBibleBlock, isStageBibleStale } from '@/lib/livestream/stageBible';
import {
  findPreviousSegment,
  pickBackgroundRefEntries,
  pickRefImagePaths,
  pickScriptRefEntries,
} from '@/lib/livestream/refImages';

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
  /**
   * Dữ liệu để modal cho SỬA TẠI CHỖ trước khi chạy. step='script' có cả prompt lẫn ảnh;
   * step='segment' chỉ có ảnh (veoPrompt đã chốt sẵn trong đoạn, sửa ở ô "Xem prompt").
   */
  editable?: {
    /** Bước nào đang sửa — modal gửi lại field này khi lưu danh sách ảnh. */
    step: 'script' | 'video' | 'background';
    systemPrompt?: string;
    /** true = systemPrompt là bản người dùng đã override, false = đang dùng mặc định. */
    isCustomPrompt?: boolean;
    /** Ảnh đang tick (job.scriptRefPaths). Rỗng = server tự chọn. */
    chosenRefPaths: string[];
    /** Mọi ảnh có thể tick, kèm vai trò để hiện nhãn dưới thumbnail. */
    candidates: { rel: string; role: string }[];
  };
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
 * Query: `?step=background|script|segment` (+ `productId` tuỳ chọn, mặc định sản phẩm đầu tiên;
 * `segmentId` bắt buộc với step=segment).
 *
 * step=segment khác 2 bước kia: prompt đã chốt sẵn trong job (không ghép gì thêm), nhưng BỘ ẢNH
 * mới là thứ bị biến đổi — cắt còn 3 theo trần Veo, trừ thêm 1 suất nếu đoạn nối tiếp frame trước.
 */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }
  const job = await readJob(id);
  const step = req.nextUrl.searchParams.get('step');
  if (step !== 'background' && step !== 'script' && step !== 'segment') {
    return NextResponse.json(
      { error: 'step phải là "background", "script" hoặc "segment"' },
      { status: 400 }
    );
  }
  if (job.products.length === 0) {
    return NextResponse.json({ error: 'Job chưa có sản phẩm nào' }, { status: 400 });
  }

  const productId = req.nextUrl.searchParams.get('productId');
  const product = productId ? job.products.find((p) => p.id === productId) : job.products[0];
  if (!product) {
    return NextResponse.json({ error: 'Sản phẩm không tồn tại' }, { status: 404 });
  }

  // Prompt phải lấy từ ĐÚNG registry mà route gen dùng — 2 bên lệch nhau thì bản xem trước vô nghĩa.
  const prompts = await loadPromptSet(job.slug);
  const notes: string[] = [];
  // Ảnh mẫu bị tách khỏi gen video: bible vẫn tả ĐÚNG người (pickVisionRefEntries không lọc
  // detached), nhưng Veo KHÔNG nhận ảnh khuôn mặt nên tự vẽ người khác. Không cảnh báo thì không
  // có dấu hiệu nào trên UI — đúng ca job production 825314 (sai 4 lượt liên tiếp).
  if (
    job.selectedModelImagePath &&
    (job.detachedImagePaths ?? []).includes(job.selectedModelImagePath)
  ) {
    notes.push(
      '⚠️ Ảnh mẫu đang bị TÁCH khỏi gen video — sân khấu vẫn tả đúng người, nhưng Veo KHÔNG nhận ảnh khuôn mặt và sẽ tự vẽ người khác. Bỏ tách ở phần cấu hình ảnh đầu trang.'
    );
  }
  // Bible dùng cho preview là bible ĐANG cache. Nếu stale, lúc bấm gen thật ensureStageBible sẽ
  // chốt lại → prompt thật sẽ khác preview, phải nói rõ chứ không im lặng hiện bible sai.
  const bible = job.stageBible ?? null;
  if (!bible) {
    notes.push('Chưa chốt sân khấu — khối "sân khấu cố định" sẽ được AI sinh và ghép thêm khi bấm gen thật.');
  } else if (isStageBibleStale(job)) {
    notes.push('Sân khấu đã chốt KHÔNG còn khớp ảnh/mô tả hiện tại — khi bấm gen thật, AI sẽ chốt lại và khối này sẽ khác preview.');
  }

  if (step === 'background') {
    // Đúng bộ ảnh triggerBackgroundImageGeneration sẽ gửi: ưu tiên ảnh người dùng tự chọn.
    const entries = pickBackgroundRefEntries(job);
    // ?prompt = bản nháp đang sửa trên UI (chưa bấm lưu); không có thì dùng bản đã lưu của job.
    const basePrompt = req.nextUrl.searchParams.get('prompt')?.trim() || prompts.get('background');
    const bgNotes = [...notes];
    if ((job.backgroundRefPaths ?? []).length === 0) {
      bgNotes.push(
        'Đang để hệ thống tự chọn ảnh tham chiếu (ảnh mẫu + tối đa 3 ảnh sản phẩm + ảnh nền đang chọn). Tick chọn ảnh ở phần "Ảnh gửi kèm khi gen background" để tự quyết.'
      );
    }
    const paramValues = buildPromptParamValues({ job, product });
    const filledBase = fillPromptParams(basePrompt, paramValues);
    if (filledBase !== basePrompt) {
      bgNotes.push('Prompt có dùng params ${...} — khung bên dưới hiện bản ĐÃ thay giá trị thật.');
    }
    const result: PreviewPromptResult = {
      prompt: buildBackgroundPrompt(
        basePrompt,
        product.description || product.name,
        bible,
        entries,
        paramValues
      ),
      refImages: entries.map((e) => ({ rel: e.rel, label: e.label })),
      notes: bgNotes,
      editable: {
        step: 'background',
        // Bản GỐC còn `${...}` để sửa — khung prompt bên trên đã là bản thay rồi. Ưu tiên bản nháp
        // đang gõ trên UI (?prompt) để mở modal giữa chừng không mất thứ chưa lưu.
        systemPrompt: basePrompt,
        isCustomPrompt: prompts.scopeOf('background') !== 'default',
        chosenRefPaths: job.backgroundRefPaths ?? [],
        candidates: [
          ...(job.selectedModelImagePath
            ? [{ rel: job.selectedModelImagePath, role: 'ảnh mẫu' }]
            : []),
          ...(job.spokespersonImagePaths ?? []).map((rel) => ({
            rel,
            role: (job.selectedRefImagePaths ?? []).includes(rel)
              ? 'ảnh sản phẩm (đã chọn)'
              : 'ảnh sản phẩm',
          })),
          ...(job.backgroundImagePaths ?? []).map((rel) => ({ rel, role: 'ảnh nền' })),
        ].filter((item, i, arr) => arr.findIndex((x) => x.rel === item.rel) === i),
      },
    };
    return NextResponse.json(result);
  }

  if (step === 'segment') {
    const segmentId = req.nextUrl.searchParams.get('segmentId');
    const segment = product.segments.find((s) => s.id === segmentId);
    if (!segment) {
      return NextResponse.json({ error: 'Đoạn không tồn tại' }, { status: 404 });
    }
    // Bước gen video KHÔNG ghép thêm mảnh nào server-side: veoPrompt đã chốt sẵn lúc sinh script.
    // Thứ tự ảnh thì ngược lại — pickRefImagePaths cắt còn 3 và chừa 1 suất cho frame chain, nên
    // đây mới là chỗ duy nhất thấy được ảnh nào THỰC SỰ tới Veo.
    const prev = findPreviousSegment(job, product, segment);
    const hasPrevFrame = prev?.status === 'done' && !!prev.lastFramePath;
    const refPaths = pickRefImagePaths(job, hasPrevFrame);
    // pickVisionRefEntries chỉ gán nhãn cho top-3 ảnh sản phẩm nó chọn, còn pickRefImagePaths lấy
    // từ ĐẦU danh sách — 2 tập không trùng nhau. Suy nhãn theo vai trò thật để không rơi về
    // "ảnh tham chiếu" chung chung đúng lúc cần biết cái nào là mẫu/nền.
    const labelOf = (rel: string): string =>
      rel === job.selectedModelImagePath
        ? 'ảnh NGƯỜI MẪU/NGƯỜI DẪN'
        : rel === job.selectedBackgroundImagePath
          ? 'ảnh BỐI CẢNH/BACKGROUND'
          : 'ảnh SẢN PHẨM THẬT';
    const segNotes = [...notes];
    if (!segment.veoPrompt.trim()) {
      segNotes.push('❌ Đoạn này chưa có prompt video — phải sinh script trước khi gen.');
    }
    if (hasPrevFrame) {
      segNotes.push(
        `🔗 Đoạn này nối tiếp đoạn #${prev!.order}: khung hình cuối của đoạn đó chiếm 1 suất ảnh, nên chỉ còn ${refPaths.length} ảnh tham chiếu được gửi.`
      );
    }
    // Ảnh bị cắt vì trần 3 của Veo: im lặng thì Mr.D tưởng đã gửi đủ. Đây đúng là bug đã sửa ở
    // pickRefImagePaths (ảnh nền bị cắt mất), nhưng trần vẫn còn nên phải nói rõ ai bị bỏ lại.
    const detached = new Set(job.detachedImagePaths ?? []);
    const dropped = [
      ...(job.selectedModelImagePath ? [job.selectedModelImagePath] : []),
      ...(job.selectedBackgroundImagePath ? [job.selectedBackgroundImagePath] : []),
      ...(job.selectedRefImagePaths ?? []),
    ].filter((rel) => !detached.has(rel) && !refPaths.includes(rel));
    if (dropped.length > 0 && (job.videoRefPaths ?? []).length === 0) {
      segNotes.push(
        `⚠️ Veo chỉ nhận tối đa 3 ảnh — ${dropped.length} ảnh đã chọn bị BỎ LẠI: ${dropped.join(', ')}. Tick ảnh ở "📎 Đổi ảnh gửi cho Veo" bên dưới để tự quyết ảnh nào được gửi.`
      );
    }
    if ((job.videoRefPaths ?? []).length === 0) {
      segNotes.push('Đang để hệ thống tự xếp ưu tiên ảnh. Tick ảnh bên dưới để tự quyết.');
    }
    const result: PreviewPromptResult = {
      prompt: `===== LỜI THOẠI (đoạn #${segment.order}, ${segment.duration}s) =====\n${segment.voiceoverVi || '(trống)'}\n\n===== PROMPT VIDEO GỬI VEO =====\n${segment.veoPrompt || '(chưa có — cần sinh script trước)'}`,
      refImages: refPaths.map((rel) => ({ rel, label: labelOf(rel) })),
      notes: segNotes,
      editable: {
        step: 'video',
        chosenRefPaths: job.videoRefPaths ?? [],
        // Cùng tập ảnh mà route PUT images/script-refs chấp nhận — lệch nhau là tick xong báo lỗi.
        candidates: [
          ...(job.selectedModelImagePath
            ? [{ rel: job.selectedModelImagePath, role: 'ảnh mẫu' }]
            : []),
          ...(job.spokespersonImagePaths ?? []).map((rel) => ({
            rel,
            role: (job.selectedRefImagePaths ?? []).includes(rel)
              ? 'ảnh sản phẩm (đã chọn)'
              : 'ảnh sản phẩm',
          })),
          ...(job.backgroundImagePaths ?? []).map((rel) => ({ rel, role: 'ảnh nền' })),
        ].filter((item, i, arr) => arr.findIndex((x) => x.rel === item.rel) === i),
      },
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

  // Phải khớp CHÍNH XÁC nhánh prompt route generate sẽ dùng, nếu không bản xem trước vô nghĩa.
  const v2Input = await readV2Input(id).catch(() => null);
  // Khoá ngoại hình sản phẩm: KHÁC visualDescription ở trên, lock được cache trong job nên preview
  // hiện được bản THẬT mà không phải gọi AI. Chưa chốt lần nào (job mới) thì báo chỗ nó sẽ chèn.
  const productLockBlock =
    v2Input && job.productLock ? formatProductLockBlock(job.productLock) : undefined;
  if (v2Input && !job.productLock && pickProductLockRefPaths(job).length > 0) {
    notes.push(
      'Khoá ngoại hình sản phẩm chưa được chốt — sẽ được AI vision chốt từ ảnh sản phẩm ở lần sinh script đầu tiên rồi chèn vào đúng vị trí này.'
    );
  }
  const userPrompt = buildScriptUserPrompt({
    description: product.description,
    durations,
    v2Input,
    visualDescription: visualPlaceholder,
    stageBibleBlock: bible ? formatStageBibleBlock(bible) : undefined,
    position: {
      index,
      total: job.products.length,
      prevProductName: index > 0 ? job.products[index - 1].name : undefined,
    },
    productLockBlock,
  });

  // Ô sửa hiện BẢN GỐC còn `${...}`, còn khung "prompt gửi AI" hiện bản ĐÃ THAY — nếu hiện cùng
  // một bản thì hoặc Mr.D sửa nhầm vào chuỗi đã fill, hoặc không kiểm tra được param có ăn không.
  const systemPromptTemplate = prompts.get('script', { isV2: !!v2Input });
  const systemPromptFilled = fillPromptParams(
    systemPromptTemplate,
    buildPromptParamValues({ job, product, durations, v2Input })
  );
  if (systemPromptFilled !== systemPromptTemplate) {
    notes.push('System prompt có dùng params ${...} — khung bên dưới hiện bản ĐÃ thay giá trị thật.');
  }

  const result: PreviewPromptResult = {
    // Sinh script gửi system prompt + user prompt TÁCH RIÊNG cho AI; nối lại có nhãn để Mr.D thấy
    // trọn vẹn payload trong 1 khung, đúng thứ tự AI đọc.
    prompt: `===== SYSTEM PROMPT${v2Input ? ' (V2 — kịch bản AIDA Shopee)' : ''} =====\n${systemPromptFilled}\n\n===== USER PROMPT (sản phẩm "${product.name}") =====\n${userPrompt}`,
    // Bước sinh script KHÔNG gửi ảnh cho AI viết lời thoại — ảnh chỉ đi vào 2 lượt phụ: vision đọc
    // ngoại hình sản phẩm, và chốt sân khấu. Hiện đúng bộ ảnh của 2 lượt đó để Mr.D kiểm tra.
    refImages: pickScriptRefEntries(job).map((e) => ({ rel: e.rel, label: e.label })),
    notes: [
      ...notes,
      'Ảnh liệt kê dưới đây gửi cho AI ở 2 lượt phụ (đọc ngoại hình sản phẩm + chốt sân khấu). Lượt viết lời thoại chỉ nhận chữ.',
      ...((job.scriptRefPaths ?? []).length === 0
        ? ['Đang để hệ thống tự chọn ảnh. Tick ảnh bên dưới để tự quyết ảnh nào tới AI.']
        : []),
    ],
    editable: {
      step: 'script',
      systemPrompt: systemPromptTemplate,
      isCustomPrompt: prompts.scopeOf('script') !== 'default',
      chosenRefPaths: job.scriptRefPaths ?? [],
      // Cùng tập ảnh mà route PUT images/script-refs chấp nhận — lệch nhau là tick xong báo lỗi.
      candidates: [
        ...(job.selectedModelImagePath
          ? [{ rel: job.selectedModelImagePath, role: 'ảnh mẫu' }]
          : []),
        ...(job.spokespersonImagePaths ?? []).map((rel) => ({
          rel,
          role: (job.selectedRefImagePaths ?? []).includes(rel) ? 'ảnh sản phẩm (đã chọn)' : 'ảnh sản phẩm',
        })),
        ...(job.backgroundImagePaths ?? []).map((rel) => ({ rel, role: 'ảnh nền' })),
      ].filter((item, i, arr) => arr.findIndex((x) => x.rel === item.rel) === i),
    },
  };
  return NextResponse.json(result);
}
