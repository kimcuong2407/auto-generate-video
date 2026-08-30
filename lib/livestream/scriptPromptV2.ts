/**
 * User prompt sinh kịch bản cho job V2 — áp STEP 3 (phân bổ AIDA) + form Shopee của
 * docs/shopee-livestream-script-generator-SKILL.md.
 *
 * Dùng chung ràng buộc SỐ TỪ với V1 (maxWordsFor) vì cùng đi qua sanitize/rút gọn/gen video.
 */
import { maxWordsFor } from './segmentSanitize';
import type { AidaStage, LivestreamV2Input } from './types';

const STAGE_LABEL: Record<AidaStage, string> = {
  attention: 'Attention (thu hút)',
  interest: 'Interest (quan tâm)',
  desire: 'Desire (khao khát)',
  action: 'Action (chốt đơn)',
};

const STAGE_GOAL: Record<AidaStage, string> = {
  attention: 'hook mở đầu, nêu vấn đề người xem đang gặp, cho sản phẩm xuất hiện sớm',
  interest: 'demo thật, giải thích tính năng, cho thấy cách dùng',
  desire: 'chuyển tính năng thành lợi ích, cho thấy trải nghiệm, xử lý thắc mắc của khách',
  action: 'chốt đơn, mời comment, bấm giỏ hàng / sản phẩm đang ghim',
};

/** Tỉ lệ phân bổ theo STEP 3 của skill (lấy mốc giữa của mỗi khoảng). */
const STAGE_RATIO: Array<[AidaStage, number]> = [
  ['attention', 0.2],
  ['interest', 0.3],
  ['desire', 0.3],
  ['action', 0.2],
];

/**
 * Gán giai đoạn AIDA cho từng cảnh theo tỉ lệ của skill.
 *
 * Bảo đảm: đủ đúng `sceneCount` phần tử, giữ nguyên thứ tự A→I→D→A, và khi còn đủ cảnh thì MỌI
 * giai đoạn đều có ít nhất 1 cảnh (dưới 4 cảnh thì buộc phải bỏ bớt giai đoạn giữa — ưu tiên giữ
 * attention và action vì đó là hook và CTA, thiếu chúng là hỏng cả kịch bản).
 */
export function allocateAidaStages(sceneCount: number): AidaStage[] {
  if (sceneCount <= 0) return [];
  if (sceneCount === 1) return ['attention'];
  if (sceneCount === 2) return ['attention', 'action'];
  if (sceneCount === 3) return ['attention', 'interest', 'action'];

  // >= 4 cảnh: chia theo tỉ lệ, mỗi giai đoạn tối thiểu 1 cảnh.
  const counts = STAGE_RATIO.map(([, ratio]) => Math.max(1, Math.floor(sceneCount * ratio)));
  let diff = sceneCount - counts.reduce((a, b) => a + b, 0);
  // Dư thì đắp vào interest rồi desire (phần thân, co giãn tốt nhất); thiếu thì rút ngược lại
  // nhưng không bao giờ để giai đoạn nào về 0.
  const padOrder = [1, 2, 0, 3];
  while (diff > 0) {
    for (const i of padOrder) {
      if (diff === 0) break;
      counts[i] += 1;
      diff -= 1;
    }
  }
  while (diff < 0) {
    let changed = false;
    for (const i of [...padOrder].reverse()) {
      if (diff === 0) break;
      if (counts[i] > 1) {
        counts[i] -= 1;
        diff += 1;
        changed = true;
      }
    }
    if (!changed) break;
  }

  return STAGE_RATIO.flatMap(([stage], i) => Array.from({ length: counts[i] }, () => stage));
}

/**
 * Gán mỗi USP cho đúng MỘT cảnh phải demo nó bằng hình (STEP 5 của skill).
 *
 * Vì sao cần: prompt vẫn dặn "mỗi USP phải có cảnh demo chứng minh bằng hình" nhưng không có gì
 * ràng buộc, nên LLM hay dồn 4 USP vào một câu thoại rồi các cảnh còn lại tả chung chung. Chia
 * sẵn bằng code thì mỗi cảnh biết đích danh mình phải cho thấy điều gì, không tốn thêm lượt AI.
 *
 * Chỉ rải vào cảnh Interest và Desire: Attention là hook (sản phẩm vừa xuất hiện, chưa demo được)
 * và Action là chốt đơn (đang đẩy CTA, chen demo vào là loãng). Nhiều USP hơn số cảnh khả dụng
 * thì phần dư bị bỏ — trả về `dropped` để caller nói thẳng cho LLM biết còn USP nào chưa có chỗ,
 * thay vì im lặng cắt.
 */
export function assignUspToScenes(
  stages: AidaStage[],
  advantages: string[]
): { byScene: Array<string | null>; dropped: string[] } {
  const byScene: Array<string | null> = stages.map(() => null);
  const slots = stages
    .map((stage, i) => ({ stage, i }))
    .filter(({ stage }) => stage === 'interest' || stage === 'desire')
    .map(({ i }) => i);

  if (slots.length === 0 || advantages.length === 0) {
    return { byScene, dropped: advantages.length > slots.length ? advantages.slice(slots.length) : [] };
  }

  // Rải đều thay vì dồn vào các cảnh đầu: 2 USP trên 6 cảnh demo mà dồn hết vào cảnh 3-4 thì
  // nửa sau của phần thân không còn gì để cho thấy.
  const step = slots.length / Math.min(advantages.length, slots.length);
  advantages.slice(0, slots.length).forEach((usp, k) => {
    byScene[slots[Math.floor(k * step)]] = usp;
  });

  return { byScene, dropped: advantages.slice(slots.length) };
}

/** Mốc thời gian tích luỹ của từng cảnh, dùng để ghi "0-8s" như format output của skill. */
export function sceneTimeRanges(durations: number[]): Array<{ from: number; to: number }> {
  let acc = 0;
  return durations.map((d) => {
    const from = acc;
    acc += d;
    return { from, to: acc };
  });
}

/** Khối form Shopee (INPUT_9..14) — chỉ liệt kê field CÓ dữ liệu để LLM không bịa phần bỏ trống. */
export function formatV2InputBlock(input: LivestreamV2Input): string {
  const lines: string[] = [`- Nền tảng/phong cách: ${input.platform || 'Shopee Live'}`];
  if (input.channelName.trim()) lines.push(`- Tên kênh: ${input.channelName.trim()}`);
  if (input.followerCount.trim()) lines.push(`- Số follower: ${input.followerCount.trim()}`);
  if (input.viewerCount.trim()) lines.push(`- Số người đang xem: ${input.viewerCount.trim()}`);

  if (input.promotion.trim()) {
    lines.push(`- Khuyến mãi ĐƯỢC PHÉP nhắc (chỉ đúng nội dung này): ${input.promotion.trim()}`);
  } else {
    lines.push(
      '- Khuyến mãi: KHÔNG có dữ liệu → TUYỆT ĐỐI KHÔNG nhắc tới giá, mức giảm, voucher hay freeship.'
    );
  }
  if (input.cta.trim()) {
    lines.push(`- CTA mong muốn: ${input.cta.trim()}`);
  } else {
    lines.push('- CTA: tự tạo CTA hợp Shopee Live (comment, bấm giỏ hàng, sản phẩm đang ghim).');
  }
  if (!input.channelName.trim() && !input.followerCount.trim() && !input.viewerCount.trim()) {
    lines.push('- KHÔNG có dữ liệu kênh/follower/người xem → không bịa số, không nhắc tên kênh.');
  }
  return `THÔNG TIN BUỔI LIVE:\n${lines.join('\n')}`;
}

export function buildLivestreamV2UserPrompt(
  description: string,
  durations: number[],
  input: LivestreamV2Input,
  visualDescription?: string,
  /** Khối "sân khấu cố định" (formatStageBibleBlock) — bỏ trống nếu chưa chốt được. */
  stageBibleBlock?: string,
  position?: { index: number; total: number; prevProductName?: string },
  /** Khối "khoá ngoại hình sản phẩm" (formatProductLockBlock) — bỏ trống nếu chưa chốt được. */
  productLockBlock?: string
): string {
  const stages = allocateAidaStages(durations.length);
  const ranges = sceneTimeRanges(durations);
  const { byScene: uspByScene, dropped: uspDropped } = assignUspToScenes(stages, input.advantages);

  const bibleBlock = stageBibleBlock ? `${stageBibleBlock}\n\n` : '';

  const positionBlock = position
    ? position.index === 0
      ? `Đây là sản phẩm MỞ ĐẦU (1/${position.total}) của buổi live — được phép chào khán giả.\n\n`
      : `Đây là sản phẩm thứ ${position.index + 1}/${position.total} trong buổi live ĐANG diễn ra${
          position.prevProductName ? ` (vừa giới thiệu xong "${position.prevProductName}")` : ''
        }.\nTUYỆT ĐỐI KHÔNG chào lại khán giả, KHÔNG mở màn lại buổi live. Cảnh đầu tiên PHẢI là câu CHUYỂN TIẾP tự nhiên sang sản phẩm mới (VD "tiếp theo đây mình có...", "còn món này nữa nè...").${
          position.index === position.total - 1
            ? '\nĐây cũng là sản phẩm CUỐI — cảnh cuối khép lại cả buổi live.'
            : '\nĐây CHƯA phải sản phẩm cuối — cảnh cuối chốt đơn ngắn gọn rồi dẫn sang sản phẩm kế, KHÔNG chào tạm biệt kết thúc live.'
        }\n\n`
    : '';

  const advantagesBlock = input.advantages.length
    ? `\n\nƯU ĐIỂM SẢN PHẨM (do người bán cung cấp):\n${input.advantages
        .map((a) => `- ${a}`)
        .join('\n')}\nMỗi ưu điểm ĐÃ ĐƯỢC GÁN SẴN cho một cảnh cụ thể ở bảng cảnh bên dưới — cảnh nào có ghi "USP phải demo" thì hành động trong veoPrompt PHẢI cho THẤY RÕ điều đó bằng hình, không được chỉ nói suông.${
        uspDropped.length
          ? `\nCác ưu điểm sau KHÔNG đủ cảnh để demo riêng, chỉ nhắc thoáng qua trong lời thoại, KHÔNG dựng cảnh demo cho chúng: ${uspDropped.join('; ')}.`
          : ''
      }`
    : '';

  // Product lock THAY THẾ visualDescription khi có: cùng nguồn (ảnh thật) nhưng lock là bản đã
  // chốt cố định, đưa cả hai vào là cho LLM hai mô tả cùng món hàng để tự chọn — đúng thứ khoá
  // sản phẩm sinh ra để loại bỏ.
  const lockBlock = productLockBlock ? `\n\n${productLockBlock}` : '';
  const visualBlock =
    !productLockBlock && visualDescription
      ? `\n\nMô tả ngoại hình sản phẩm (từ ảnh thật, dùng để mô tả cầm/thao tác chân thực):\n${visualDescription}`
      : '';

  // Bảng cảnh: giai đoạn AIDA + mốc thời gian + trần số từ, gộp 1 dòng/cảnh cho LLM dễ bám.
  const scenePlan = durations
    .map((d, i) => {
      const stage = stages[i];
      const usp = uspByScene[i] ? ` | USP phải demo bằng hình: ${uspByScene[i]}` : '';
      return `  - Cảnh ${i + 1} — ${STAGE_LABEL[stage]} | ${ranges[i].from}-${ranges[i].to}s | ${d}s | mục tiêu: ${STAGE_GOAL[stage]}${usp} | tối đa ${maxWordsFor(d)} từ (lý tưởng ${Math.round(maxWordsFor(d) * 0.9)} từ)`;
    })
    .join('\n');

  return `${bibleBlock}${positionBlock}${formatV2InputBlock(input)}\n\nMô tả sản phẩm:\n${description}${lockBlock}${advantagesBlock}${visualBlock}\n\nKỊCH BẢN GỒM ĐÚNG ${durations.length} CẢNH, phân bổ AIDA và thời lượng như sau (BÁM ĐÚNG, không tự đổi giai đoạn của cảnh):\n${scenePlan}\n\nMỗi cảnh viết ĐÚNG ${input.dialoguesPerScene} câu thoại MC trong voiceoverVi (câu 1 hook/nối tiếp, câu giữa thông tin chính, câu cuối lợi ích/tương tác/dẫn sang cảnh sau), viết liền thành một đoạn văn nói tự nhiên.\n\nGIỚI HẠN SỐ TỪ BẮT BUỘC cho voiceoverVi từng cảnh đã ghi ở bảng trên — đếm từ, KHÔNG được vượt (vượt là video bị cắt cụt câu). Thà thiếu vài từ còn hơn thừa: ưu tiên câu ngắn, mỗi câu khoảng 5-10 từ.\n\nTrả về đúng ${durations.length} phần tử trong "segments", đúng thứ tự tương ứng bảng cảnh ở trên.`;
}
