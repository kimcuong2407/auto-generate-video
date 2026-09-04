import { NextRequest, NextResponse } from 'next/server';
import { jobExists, readJob } from '@/lib/livestream/jobStore';
import { buildBackgroundPrompt } from '@/lib/livestream/backgroundGenerate';
import { buildScriptUserPrompt } from '@/lib/livestream/scriptPrompt';
import { buildPromptParamValues, fillPromptParams } from '@/lib/livestream/promptParams';
import { loadPromptSet } from '@/lib/livestream/promptStore';
import { isPromptBlockKey } from '@/lib/livestream/promptBlocks';
import {
  shiftSpans,
  spansFromSink,
  type PromptBlockSink,
  type PromptBlockSpan,
} from '@/lib/livestream/promptBlockSpans';
import {
  PRODUCT_LOCK_USER_PROMPT,
  formatProductLockBlock,
  pickProductLockRefPaths,
} from '@/lib/livestream/productLock';
import { readV2Input } from '@/lib/livestream/v2Store';
import { computeSegmentDurations } from '@/lib/livestream/segmentSanitize';
import {
  buildStageBibleUserPrompt,
  formatStageBibleBlock,
  isStageBibleStale,
} from '@/lib/livestream/stageBible';
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
   * Các khối server tự ghép đang bị TẮT (job.disabledPromptBlocks) — để modal vẽ đúng trạng thái ô
   * tick. Trả từ server chứ không để client tự đoán: đây cũng là thứ server dùng để ghép prompt.
   */
  disabledBlocks?: string[];
  /** Job V2 (có bản ghi livestream_v2_inputs) — modal hiện mờ các khối chỉ có ở V2. */
  isV2?: boolean;
  /**
   * Vị trí từng khối tự ghép TRONG `prompt` — để modal cắt prompt thành các đoạn có nhãn thay vì
   * một khối chữ 15k ký tự không biết đoạn nào của khối nào. Xem lib/livestream/promptBlockSpans.ts.
   */
  blockSpans?: PromptBlockSpan[];
  /**
   * Dữ liệu để modal cho SỬA TẠI CHỖ trước khi chạy. step='script' có cả prompt lẫn ảnh;
   * step='segment' chỉ có ảnh (veoPrompt đã chốt sẵn trong đoạn, sửa ở ô "Xem prompt").
   */
  editable?: {
    /** Bước nào đang sửa — modal gửi lại field này khi lưu danh sách ảnh. */
    step: 'script' | 'video' | 'background' | 'stage_bible' | 'product_lock' | 'product_visual' | 'script_qa';
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
  const EXTRA_STEPS = ['stage_bible', 'product_lock', 'product_visual', 'script_qa'] as const;
  type ExtraStep = (typeof EXTRA_STEPS)[number];
  const isExtra = (v: string | null): v is ExtraStep =>
    !!v && (EXTRA_STEPS as readonly string[]).includes(v);
  if (step !== 'background' && step !== 'script' && step !== 'segment' && !isExtra(step)) {
    return NextResponse.json(
      { error: `step không hợp lệ: ${step}` },
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

  // Tắt khối là tự tay bỏ ràng buộc chống AI bịa — phải nói rõ, không để im lặng.
  const disabledCount = (job.disabledPromptBlocks ?? []).filter((k) => isPromptBlockKey(k)).length;
  if (disabledCount > 0) {
    notes.push(
      `⚠️ Đang TẮT ${disabledCount} khối tự ghép — prompt ngắn lại nhưng AI có thể mô tả người dẫn/sản phẩm khác ảnh. Bật lại ở mục "Khối ghép thêm vào prompt".`
    );
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
    // Sink để builder ghi lại chuỗi THẬT của từng khối — modal cắt prompt theo đó.
    const bgSink: PromptBlockSink = {};
    const bgPrompt = buildBackgroundPrompt(
      basePrompt,
      product.description || product.name,
      bible,
      entries,
      paramValues,
      job.disabledPromptBlocks,
      bgSink
    );
    const result: PreviewPromptResult = {
      prompt: bgPrompt,
      blockSpans: spansFromSink(bgPrompt, bgSink),
      refImages: entries.map((e) => ({ rel: e.rel, label: e.label })),
      notes: bgNotes,
      disabledBlocks: job.disabledPromptBlocks ?? [],
      // Đọc riêng ở nhánh này: `v2Input` của nhánh sinh script nằm dưới, chưa có ở đây.
      isV2: !!(await readV2Input(id).catch(() => null)),
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

  // 4 bước phụ trợ chạy TRONG lượt sinh script (không có nút bấm riêng) — preview để xem trước
  // prompt + đúng bộ ảnh mỗi bước nhận, vì đây là những lượt AI quyết định chất lượng cả job.
  if (isExtra(step)) {
    // 2 bước product_lock/script_qa CHỈ chạy với job V2 — không nói rõ thì Mr.D sửa prompt xong
    // chờ mãi không thấy tác dụng vì job V1 không bao giờ gọi tới.
    const v2InputForExtra = await readV2Input(id).catch(() => null);
    const extraNotes = [...notes];
    let prompt: string;
    let refImages: PreviewRefImage[] = [];

    if (step === 'stage_bible') {
      // Đúng bộ ảnh collectStageRefImages gửi đi (pickScriptRefEntries), KHÔNG phải
      // pickVisionRefEntries — hai tập khác nhau, hiện nhầm thì preview vô nghĩa.
      const entries = pickScriptRefEntries(job);
      refImages = entries.map((e) => ({ rel: e.rel, label: e.label }));
      // visualDescription do vision sinh mới mỗi lượt, preview không gọi AI nên đánh dấu vị trí.
      const legend = entries.map((e, i) => `  ${i + 1}. ${e.label}`).join('\n');
      prompt = `===== SYSTEM PROMPT =====\n${prompts.get('stage_bible')}\n\n===== USER PROMPT =====\n${buildStageBibleUserPrompt(
        job,
        '[mô tả ngoại hình sản phẩm sẽ được chèn vào đây khi bấm sinh script]',
        entries.length > 0 ? legend : undefined
      )}`;
      if (entries.length === 0) {
        extraNotes.push('❌ Chưa có ảnh nào gửi kèm — AI sẽ tự bịa người dẫn thay vì tả đúng ảnh mẫu.');
      }
      extraNotes.push(
        'Bước này chốt người dẫn/bối cảnh/góc máy/giọng cho TOÀN BỘ job, chạy tự động trong lượt sinh script (hoặc khi bấm "Chốt lại sân khấu").'
      );
    } else if (step === 'product_lock') {
      const paths = pickProductLockRefPaths(job);
      refImages = paths.map((rel) => ({ rel, label: 'ảnh SẢN PHẨM THẬT' }));
      prompt = `===== SYSTEM PROMPT =====\n${prompts.get('product_lock')}\n\n===== USER PROMPT =====\n${PRODUCT_LOCK_USER_PROMPT}`;
      if (!v2InputForExtra) {
        extraNotes.push('⚠️ Bước này CHỈ chạy với job Livestream Shopee V2 — job hiện tại không dùng tới.');
      }
      if (paths.length === 0) {
        extraNotes.push('Chưa chọn ảnh sản phẩm nào nên bước này sẽ bị bỏ qua (script vẫn sinh bình thường).');
      }
    } else if (step === 'product_visual') {
      // Đúng phép giao route generate dùng: chỉ ảnh SẢN PHẨM trong danh sách đã tick.
      const chosen = job.scriptRefPaths ?? [];
      const paths =
        chosen.length > 0
          ? chosen.filter((rel) => (job.selectedRefImagePaths ?? []).includes(rel))
          : (job.selectedRefImagePaths ?? []);
      refImages = paths.map((rel) => ({ rel, label: 'ảnh SẢN PHẨM THẬT' }));
      prompt = `===== SYSTEM PROMPT =====\n${prompts.get('product_visual')}\n\n===== USER PROMPT =====\n(bước này chỉ gửi ẢNH, không có user prompt bằng chữ)`;
      if (paths.length === 0) {
        extraNotes.push('Chưa chọn ảnh sản phẩm nào nên bước này sẽ bị bỏ qua.');
      }
    } else {
      // script_qa: user prompt dựng từ chính kịch bản ĐÃ sinh, chưa sinh thì không có gì để chấm.
      const segs = product.segments;
      prompt = `===== SYSTEM PROMPT =====\n${prompts.get('script_qa')}\n\n===== USER PROMPT (dựng từ ${segs.length} đoạn hiện có của "${product.name}") =====\n${
        segs.length > 0
          ? segs.map((sg, i) => `Cảnh ${i + 1}: ${sg.veoPrompt || '(chưa có)'}`).join('\n')
          : '(chưa sinh script nên chưa có cảnh nào để chấm)'
      }`;
      if (!v2InputForExtra) {
        extraNotes.push('⚠️ Bước này CHỈ chạy với job Livestream Shopee V2 — job hiện tại không dùng tới.');
      }
      extraNotes.push('Chạy SAU khi sinh script: chỉ cảnh báo lỗi vật lý / lời quảng cáo quá đà, KHÔNG tự sửa kịch bản.');
    }

    const result: PreviewPromptResult = {
      prompt,
      refImages,
      notes: extraNotes,
      editable: {
        step,
        systemPrompt: prompts.raw(step, 'job') ?? prompts.raw(step, 'global') ?? prompts.get(step),
        isCustomPrompt: prompts.scopeOf(step) !== 'default',
        chosenRefPaths: job.scriptRefPaths ?? [],
        candidates: [],
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
  const scriptSink: PromptBlockSink = {};
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
    disabledBlocks: job.disabledPromptBlocks,
    blockSink: scriptSink,
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

  // Prompt hiển thị = header + system + header + user. Span tính trên CHUỖI USER (nơi khối được
  // ghép vào) rồi dịch sang toạ độ chuỗi cuối bằng offset của phần user.
  const scriptPrompt = `===== SYSTEM PROMPT${v2Input ? ' (V2 — kịch bản AIDA Shopee)' : ''} =====\n${systemPromptFilled}\n\n===== USER PROMPT (sản phẩm "${product.name}") =====\n${userPrompt}`;
  const userOffset = scriptPrompt.length - userPrompt.length;
  const result: PreviewPromptResult = {
    // Sinh script gửi system prompt + user prompt TÁCH RIÊNG cho AI; nối lại có nhãn để Mr.D thấy
    // trọn vẹn payload trong 1 khung, đúng thứ tự AI đọc.
    prompt: scriptPrompt,
    blockSpans: shiftSpans(spansFromSink(userPrompt, scriptSink), userOffset),
    // Bước sinh script KHÔNG gửi ảnh cho AI viết lời thoại — ảnh chỉ đi vào 2 lượt phụ: vision đọc
    // ngoại hình sản phẩm, và chốt sân khấu. Hiện đúng bộ ảnh của 2 lượt đó để Mr.D kiểm tra.
    refImages: pickScriptRefEntries(job).map((e) => ({ rel: e.rel, label: e.label })),
    disabledBlocks: job.disabledPromptBlocks ?? [],
    isV2: !!v2Input,
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
