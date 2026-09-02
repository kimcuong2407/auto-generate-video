import { NextRequest, NextResponse } from 'next/server';
import { jobExists, readJob, updateJob } from '@/lib/livestream/jobStore';
import { generateScriptText } from '@/lib/googleFlow/flowJobs';
import { ChatApiError } from '@/lib/ai/chatClient';
import type { ChatStreamEvent } from '@/lib/ai/chatClient';
import { extractJson } from '@/lib/ai/jsonExtract';
import { buildScriptUserPrompt } from '@/lib/livestream/scriptPrompt';
import { buildPromptParamValues, fillPromptParams } from '@/lib/livestream/promptParams';
import { loadPromptSet } from '@/lib/livestream/promptStore';
import { readV2Input } from '@/lib/livestream/v2Store';
import {
  computeSegmentDurations,
  findOverlongSegments,
  sanitizeSegments,
  mergeSegmentsKeepingVideos,
} from '@/lib/livestream/segmentSanitize';
import { shortenOverlongSegments } from '@/lib/livestream/shortenVoiceover';
import { recomputeSegmentOrder } from '@/lib/livestream/reorder';
import { describeProductAppearance } from '@/lib/livestream/productVision';
import {
  ensureStageBible,
  formatStageBibleBlock,
  isStageBibleStale,
} from '@/lib/livestream/stageBible';
import { ensureProductLock, formatProductLockBlock } from '@/lib/livestream/productLock';
import { reviewScriptQuality } from '@/lib/livestream/scriptQa';
import { ensureLocalImage } from '@/lib/livestream/imageR2';
import { resolveWithinJob } from '@/lib/livestream/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const { id } = params;
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  const job = await readJob(id);
  const body = (await req.json().catch(() => ({}))) as {
    productId?: string;
    /** Ép chốt lại sân khấu dù bible cũ còn "khớp" fingerprint — dùng khi bible cũ sai về chất
     *  (VD gen bằng bản prompt tiếng Anh cũ) mà fingerprint không thể phát hiện. */
    forceStageBible?: boolean;
  };

  // forceStageBible = chốt lại sân khấu rồi sinh lại script cho MỌI sản phẩm hợp lệ, kể cả
  // scriptStatus='done' — chốt bible mới mà giữ nguyên script cũ thì bible mới không có tác dụng gì.
  const targets = body.productId
    ? job.products.filter((p) => p.id === body.productId)
    : job.products.filter(
        (p) =>
          (body.forceStageBible || p.scriptStatus !== 'done') &&
          p.ingestStatus !== 'needs_manual' &&
          p.description.trim()
      );

  if (targets.length === 0) {
    return NextResponse.json(
      {
        error: body.productId
          ? 'Sản phẩm không tồn tại hoặc không hợp lệ'
          : 'Không có sản phẩm nào sẵn sàng sinh script (kiểm tra đã điền mô tả/ingest xong chưa)',
      },
      { status: 400 }
    );
  }

  const stillGenerating = targets.flatMap((p) => p.segments.filter((s) => s.status === 'generating'));
  if (stillGenerating.length > 0) {
    return NextResponse.json(
      {
        error: `Không thể sinh script khi có đoạn đang generating: ${stillGenerating
          .map((s) => s.id)
          .join(', ')}. Vui lòng đợi hoặc dừng trước.`,
      },
      { status: 409 }
    );
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      // Job V2 (tab Livestream Shopee) có bản ghi input riêng → dùng bộ prompt AIDA theo skill.
      // Đọc 1 lần cho cả lượt chạy; null = job V1, mọi thứ giữ nguyên như cũ.
      const v2Input = await readV2Input(id).catch(() => null);
      // Nạp prompt MỘT LẦN cho cả lượt chạy: lượt này chạm 6 bước AI khác nhau (product_visual →
      // product_lock → stage_bible → script → script_qa → shorten) nằm rải ở 6 module, resolve lẻ
      // là 6 round-trip DB cho dữ liệu không đổi. Chốt snapshot ở đây cũng đúng ngữ nghĩa: sửa
      // prompt giữa lúc đang gen 32 đoạn thì kết quả không bị lai 2 phiên bản.
      const prompts = await loadPromptSet(job.slug);
      // Params `${...}` PHẢI fill trong vòng lặp bên dưới: giá trị khác nhau theo từng sản phẩm.
      const systemPromptTemplate = prompts.get('script', { isV2: !!v2Input });

      // Mô tả ngoại hình vật lý sản phẩm (đọc ảnh ref thật) — tính 1 lần cho cả job vì
      // selectedRefImagePaths dùng chung cho mọi sản phẩm. Đọc TẤT CẢ ảnh đã chọn, không chỉ ảnh
      // đầu: các góc còn lại mới cho thấy mặt sau/ngăn/cách đeo. Best-effort: thiếu
      // AI_VISION_MODEL, chưa chọn ảnh ref, hay lỗi mạng đều bỏ qua, KHÔNG chặn sinh script.
      let visualDescription: string | undefined;
      // Mr.D tick ảnh trong modal sinh script → chỉ đọc ĐÚNG ảnh sản phẩm trong danh sách đó;
      // rỗng = giữ hành vi cũ (đọc mọi ảnh ref đã chọn). Giao với selectedRefImagePaths vì lượt
      // này chỉ tả NGOẠI HÌNH SẢN PHẨM — đưa ảnh mẫu/ảnh nền vào sẽ ra mô tả người/căn phòng.
      const chosenForScript = job.scriptRefPaths ?? [];
      const refPaths =
        chosenForScript.length > 0
          ? chosenForScript.filter((rel) => (job.selectedRefImagePaths ?? []).includes(rel))
          : (job.selectedRefImagePaths ?? []);
      if (refPaths.length > 0) {
        try {
          await Promise.all(
            refPaths.map((rel) => ensureLocalImage(job.id, rel, job.imageR2Urls?.[rel]))
          );
          visualDescription = await describeProductAppearance(
            refPaths.map((rel) => resolveWithinJob(job.id, rel)),
            prompts.get('product_visual')
          );
        } catch {
          // bỏ qua — script vẫn sinh bình thường không có mô tả ngoại hình bổ sung.
        }
      }

      // Khoá ngoại hình sản phẩm cấp job — chốt 1 lần từ ảnh thật rồi ép mọi cảnh tả đúng món
      // hàng đó. Chỉ áp cho job V2: prompt V1 không có chỗ nhận khối này, và V1 đang chạy
      // production với override theo job nên không đổi hành vi.
      // Best-effort: null (chưa chọn ảnh / thiếu AI_VISION_MODEL / lỗi) thì user prompt rơi về
      // dùng visualDescription như cũ, không chặn sinh script.
      let productLockBlock: string | undefined;
      if (v2Input) {
        const lock = await ensureProductLock(id);
        if (lock) {
          productLockBlock = formatProductLockBlock(lock);
          send({ type: 'product_lock_done', productLock: lock });
        }
      }

      // Sân khấu cố định cấp job (người dẫn/bối cảnh/góc máy/giọng) — chốt 1 lần rồi ép dùng lại
      // cho MỌI sản phẩm, nếu không mỗi lần gọi LLM (1 lần/sản phẩm) sẽ tự bịa 1 buổi live khác.
      // Sinh lại 1 sản phẩm lẻ vẫn dùng bible đã cache để khớp các sản phẩm đã gen trước đó —
      // TRỪ khi input đã đổi (ensureStageBible tự phát hiện qua fingerprint và chốt lại, xem ở đó).
      // Báo trước cho UI biết vì sao sắp tốn 1 lượt AI: bible cũ không còn khớp ảnh/mô tả hiện tại.
      if (body.forceStageBible || isStageBibleStale(job)) send({ type: 'stage_bible_stale' });
      send({ type: 'stage_bible_start' });
      let bible: Awaited<ReturnType<typeof ensureStageBible>>;
      try {
        bible = await ensureStageBible(id, {
          visualDescription,
          force: body.forceStageBible,
        });
      } catch (err) {
        // Chỉ tới được đây khi forceStageBible=true (ensureStageBible chỉ ném khi force).
        // DỪNG HẲN: sinh script tiếp với prompt THIẾU khối sân khấu thì LLM tự bịa người dẫn khác
        // và ghi đè 32 đoạn bằng nội dung sai — tệ hơn hẳn việc không làm gì.
        send({
          type: 'fatal',
          message: `Chốt lại sân khấu thất bại nên KHÔNG sinh script (tránh ghi đè script bằng người dẫn bịa): ${(err as Error).message}`,
        });
        controller.close();
        return;
      }
      // Không force mà bible null = lỗi đã được log, chạy tiếp theo hành vi best-effort cũ nhưng
      // phải báo cho UI: script sắp sinh ra sẽ KHÔNG khớp sân khấu đã chốt.
      if (!bible) {
        send({
          type: 'stage_bible_missing',
          message: 'Không lấy được sân khấu cố định — các đoạn sinh ra có thể mô tả người dẫn/bối cảnh khác nhau.',
        });
      }
      const stageBibleBlock = bible ? formatStageBibleBlock(bible) : undefined;
      send({ type: 'stage_bible_done', stageBible: bible });

      for (const product of targets) {
        send({ type: 'product_start', productId: product.id, name: product.name });
        await updateJob(id, (j) => {
          const p = j.products.find((x) => x.id === product.id);
          if (p) p.scriptStatus = 'generating';
        });

        try {
          const durations = computeSegmentDurations(product.targetDurationSec);
          // Vị trí tính trên TOÀN BỘ sản phẩm của job (không phải trong `targets`) — gen lại 1 sản
          // phẩm lẻ vẫn phải biết nó nằm giữa buổi live để viết câu chuyển tiếp, không chào lại.
          const index = job.products.findIndex((p) => p.id === product.id);
          const userPrompt = buildScriptUserPrompt({
            description: product.description,
            durations,
            v2Input,
            visualDescription,
            stageBibleBlock,
            position: {
              index,
              total: job.products.length,
              prevProductName: index > 0 ? job.products[index - 1].name : undefined,
            },
            productLockBlock,
          });
          const systemPrompt = fillPromptParams(
            systemPromptTemplate,
            buildPromptParamValues({ job, product, durations, v2Input })
          );

          const raw = await generateScriptText(systemPrompt, userPrompt, (e: ChatStreamEvent) => {
            if (e.type === 'start' || e.type === 'retry') {
              send({ ...e, productId: product.id });
            }
          });

          const parsed = JSON.parse(extractJson(raw)) as {
            segments?: Array<{ voiceoverVi?: string; veoPrompt?: string }>;
          };
          if (!Array.isArray(parsed.segments)) {
            throw new Error('AI không trả về danh sách đoạn hợp lệ');
          }
          const rawSegments = sanitizeSegments(parsed.segments, durations);
          // Lời thoại dài quá nhịp nói → Veo đọc không kịp, cắt cụt câu cuối. Ép AI viết lại NGAY
          // tại đây thay vì chỉ cảnh báo rồi bắt người dùng bấm sinh lại (lần sinh lại vẫn hay dư).
          const segments = await shortenOverlongSegments(rawSegments, prompts.get('shorten'), (round, remaining) => {
            send({ type: 'shorten_start', productId: product.id, round, remaining });
          });

          const { result } = await updateJob(id, (j) => {
            const p = j.products.find((x) => x.id === product.id);
            if (!p) {
              return { conflict: true, message: 'Sản phẩm không tồn tại (có thể đã bị xoá)' };
            }
            const stillGen = p.segments.filter((s) => s.status === 'generating');
            if (stillGen.length > 0) {
              return {
                conflict: true,
                message: `Có đoạn đang generating giữa chừng: ${stillGen.map((s) => s.id).join(', ')}`,
              };
            }
            // Giữ video của các đoạn AI viết ra y hệt cũ — gán thẳng `segments` sẽ đưa mọi
            // đoạn về idle và mất sạch video đã gen, buộc gen lại và đốt thêm quota Veo.
            p.segments = mergeSegmentsKeepingVideos(segments, p.segments);
            p.scriptStatus = 'done';
            p.scriptError = null;
            recomputeSegmentOrder(j);
            return { conflict: false, message: '' };
          });

          if (result.conflict) {
            send({ type: 'product_error', productId: product.id, message: result.message });
            continue;
          }

          // Phần còn sót sau khi đã tự rút gọn (AI lỗi / viết lại vẫn dư) — chỉ cảnh báo, không
          // chặn: video vẫn gen được, người dùng tự sửa tay hoặc bấm sinh lại.
          const overlong = findOverlongSegments(segments);

          // QA lỗi vật lý + claim. CHỈ CẢNH BÁO: kịch bản đã ghi vào job ở trên rồi, đây là lớp
          // soát cuối để Mr.D biết cảnh nào đáng sửa TRƯỚC khi đốt quota Veo — chặn đúng chỗ tốn
          // tiền nhất. Chỉ chạy cho job V2; best-effort, lỗi thì trả mảng rỗng.
          const qaIssues = v2Input ? await reviewScriptQuality(segments, prompts.get('script_qa')) : [];
          send({ type: 'product_done', productId: product.id, segments, overlong, qaIssues });
        } catch (err) {
          const message =
            err instanceof ChatApiError
              ? `AI API lỗi: ${err.message}`
              : `Sinh script thất bại: ${(err as Error).message}`;
          await updateJob(id, (j) => {
            const p = j.products.find((x) => x.id === product.id);
            if (!p) return;
            p.scriptStatus = 'failed';
            p.scriptError = message;
          });
          send({ type: 'product_error', productId: product.id, message });
        }
      }

      send({ type: 'all_done' });
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  });
}
