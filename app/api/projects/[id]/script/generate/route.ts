import { NextRequest, NextResponse } from 'next/server';
import { projectExists, readProject, updateProject } from '@/lib/data/projectStore';
import { generateScriptText } from '@/lib/googleFlow/flowJobs';
import { ChatApiError } from '@/lib/ai/chatClient';
import type { ChatStreamEvent } from '@/lib/ai/chatClient';
import { findScriptAngle } from '@/lib/scriptAngles';
import { evaluateScript } from '@/lib/data/veoPromptEvaluate';
import { enforceVerbatimVoiceover } from '@/lib/data/veoPromptAudit';
import { withAiCallContext } from '@/lib/ai/callLog';
import {
  buildSceneFromFields,
  mergeStoryboardWithScript,
  mergeBackgroundsWithScript,
} from '@/lib/data/projectFactory';
import path from 'node:path';
import { slugify, projectInputsDir } from '@/lib/paths';
import { extractJson } from '@/lib/ai/jsonExtract';
import { extractVisualDescription } from '@/lib/data/productVisionExtract';
import { loadPromptSet } from '@/lib/livestream/promptStore';
import { ensureLocalFile } from '@/lib/r2/client';
import type { Scene } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIN_SCENE_DURATION = 3;
const MAX_SCENE_DURATION = 25;
const DEFAULT_SCENE_DURATION = 8;


export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  if (!(await projectExists(params.id))) {
    return NextResponse.json({ error: 'Project không tồn tại' }, { status: 404 });
  }

  const project = await readProject(params.id);
  const body = (await req.json().catch(() => ({}))) as {
    productDescription?: string;
    scriptAngleId?: string;
  };

  const angleId = body.scriptAngleId || project.scriptAngleId || undefined;
  const angle = findScriptAngle(angleId);
  if (!angle) {
    return NextResponse.json(
      { error: 'Cần chọn 1 góc kịch bản (VD: Unboxing, Problem → Solution...) trước khi sinh nháp AI' },
      { status: 400 }
    );
  }

  // AI vision "chốt" đặc điểm thị giác thật của sản phẩm (màu/chất liệu/hình dạng) từ ảnh —
  // nguồn màu đáng tin cậy nhất, tránh model text tự bịa. Chạy tự động nếu chưa có
  // visualDescription và project có ảnh; lỗi vision (VD chưa cấu hình model) không chặn luồng
  // sinh kịch bản — chỉ bỏ qua phần mô tả hình ảnh.
  let visualDescription = project.product.visualDescription?.trim() || '';
  if (!visualDescription && project.inputs.productImages.length > 0) {
    try {
      const absPaths = project.inputs.productImages.map((rel) =>
        path.join(projectInputsDir(params.id), path.basename(rel))
      );
      // Khôi phục local từ R2 nếu mất (project chạy/gen ở máy khác với máy tạo project).
      await Promise.all(
        absPaths.map((abs, i) => ensureLocalFile(abs, project.inputs.productImageUrls?.[i]))
      );
      visualDescription = await extractVisualDescription(absPaths, params.id);
      if (visualDescription) {
        await updateProject(params.id, (p) => {
          p.product.visualDescription = visualDescription;
        });
      }
    } catch (err) {
      console.warn(`[script/generate] AI vision đọc ảnh thất bại, bỏ qua: ${(err as Error).message}`);
    }
  }

  const productDesc =
    body.productDescription ||
    [
      project.product.name && `Tên sản phẩm: ${project.product.name}`,
      project.product.tagline && `Tagline: ${project.product.tagline}`,
      project.product.category && `Danh mục: ${project.product.category}`,
      project.product.material && `Chất liệu: ${project.product.material}`,
      project.product.colors.length && `Màu sắc: ${project.product.colors.join(', ')}`,
      project.product.keyFeatures.length && `Tính năng nổi bật: ${project.product.keyFeatures.join('; ')}`,
    ]
      .filter(Boolean)
      .join('\n');

  if (!productDesc.trim() && !visualDescription) {
    return NextResponse.json(
      { error: 'Cần nhập mô tả sản phẩm (Bước 1) trước khi sinh kịch bản bằng AI' },
      { status: 400 }
    );
  }

  // Ghép mô tả hình ảnh thật vào cuối, đánh dấu ưu tiên tuyệt đối — system prompt buộc AI
  // dùng đúng màu/chất liệu này thay vì tự bịa.
  const productDescWithVisual = visualDescription
    ? `${productDesc}\n\nMô tả hình ảnh thật từ ảnh sản phẩm (ƯU TIÊN TUYỆT ĐỐI — dùng đúng màu/chất liệu/hình dạng này, KHÔNG được bịa khác):\n${visualDescription}`
    : productDesc;

  // Prompt gốc lấy từ registry (bảng ai_prompts) chứ không phải hằng cứng — Mr.D sửa được ở tab
  // Video Review / trang Prompt AI. Góc kịch bản vẫn nối thêm vào cuối ở đây (không đưa vào ô sửa)
  // vì nội dung nó đổi theo lựa chọn của từng lượt gen, không phải thứ chỉnh một lần.
  const prompts = await loadPromptSet();
  const systemPrompt = `${prompts.get('review_script')}\n\nGóc kịch bản được chọn: "${angle.title}".\n${angle.aiGuidance}`;

  const targetTotalDuration =
    project.template.total_duration ||
    project.script.scenes.reduce((sum, s) => sum + s.duration, 0) ||
    60;

  const userPrompt = `Mô tả sản phẩm:\n${productDescWithVisual}\n\nTổng thời lượng mục tiêu: ${targetTotalDuration} giây.\n\nDanh sách cảnh MẪU (chỉ tham khảo loại cảnh, KHÔNG bắt buộc theo đúng, có thể bỏ/gộp/thêm/đổi thứ tự):\n${JSON.stringify(
    project.template.scenes.map((s) => ({
      id: s.id,
      label: s.label,
      duration: s.duration,
      type: s.type,
      camera: s.camera,
      focus: s.focus,
      lighting: s.lighting,
    })),
    null,
    2
  )}`;

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: object) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };

      try {
        const raw = await withAiCallContext(
          {
            stepKey: 'review_script',
            projectId: params.id,
            promptScope: prompts.scopeOf('review_script'),
          },
          () =>
            generateScriptText(systemPrompt, userPrompt, (e: ChatStreamEvent) => {
            if (e.type === 'start' || e.type === 'retry') {
              send(e);
            }
            // 'delta'/'error' của chatClient chỉ dùng để log nội bộ — không forward ra
            // client vì đó là mảnh JSON kịch bản chưa hoàn chỉnh, dễ vỡ khi parse giữa
            // chừng (xem "Ranh giới dữ liệu gửi ra" trong plan).
          })
        );
        const jsonText = extractJson(raw);
        const parsed = JSON.parse(jsonText) as {
          scenes: Array<{
            id?: string;
            label?: string;
            duration?: number;
            camera?: string;
            type?: string;
            voiceoverVi?: string;
            onScreenText?: string;
            veoPrompt?: string;
          }>;
        };

        if (!Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
          throw new Error('AI không trả về danh sách cảnh hợp lệ');
        }

        const draft: Scene[] = sanitizeDraftScenes(parsed.scenes);

        const { result: saveResult } = await updateProject(params.id, (p) => {
          // Chặn ghi đè nếu có scene đang generating (job video thật đang chạy nền ở
          // Google Flow) — ghi đè sẽ làm mất scene khỏi project.json trong khi job vẫn
          // chạy, không ai poll trạng thái nữa (cùng bảo vệ như PATCH /script).
          const stillGenerating = p.script.scenes.filter((s) => s.status === 'generating');
          if (stillGenerating.length > 0) {
            return {
              conflict: true,
              message: `Không thể sinh nháp mới khi có cảnh đang generating: ${stillGenerating
                .map((s) => s.id)
                .join(', ')}. Vui lòng đợi hoặc dừng trước.`,
            };
          }
          p.scriptAngleId = angle.id;
          p.script.scenes = draft;
          p.script.totalDuration = draft.reduce((sum, s) => sum + s.duration, 0);
          p.storyboard.images = mergeStoryboardWithScript(p.storyboard.images, draft);
          p.storyboard.backgrounds = mergeBackgroundsWithScript(p.storyboard.backgrounds, draft);
          return { conflict: false, message: '' };
        });

        if (saveResult.conflict) {
          send({ type: 'error', message: saveResult.message });
          return;
        }

        send({ type: 'result', draft, scriptAngleId: angle.id });

        // Chấm điểm bộ prompt vừa sinh, TRƯỚC khi Mr.D bấm gen video (1 lượt Veo hỏng tốn tiền
        // thật, lượt chấm bằng text rẻ hơn nhiều). Nuốt mọi lỗi: kịch bản đã lưu và đã gửi về
        // client ở dòng trên rồi — để lỗi chấm điểm làm hỏng nó thì được ít mất nhiều.
        try {
          const saved = await readProject(params.id);
          const evaluation = await evaluateScript(saved);
          await updateProject(params.id, (p) => {
            p.script.evaluation = evaluation;
          });
          send({ type: 'evaluation', evaluation });
        } catch (err) {
          console.warn(`[script-eval] bỏ qua lỗi chấm điểm project ${params.id}: ${(err as Error).message}`);
        }
      } catch (err) {
        const message =
          err instanceof ChatApiError
            ? `AI API lỗi: ${err.message}`
            : `Không parse được kết quả AI: ${(err as Error).message}`;
        send({ type: 'error', message });
      } finally {
        controller.close();
      }
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

/** Chuẩn hoá danh sách cảnh thô từ AI: id duy nhất/hợp lệ, duration trong khoảng cho phép, camera fallback. */
function sanitizeDraftScenes(
  raw: Array<{
    id?: string;
    label?: string;
    duration?: number;
    camera?: string;
    type?: string;
    voiceoverVi?: string;
    onScreenText?: string;
    veoPrompt?: string;
  }>
): Scene[] {
  const usedIds = new Set<string>();

  return raw.map((item, index) => {
    let id = slugify(item.id || item.label || `scene-${index + 1}`);
    if (!id) id = `scene-${index + 1}`;
    if (usedIds.has(id)) {
      let suffix = 2;
      while (usedIds.has(`${id}-${suffix}`)) suffix++;
      id = `${id}-${suffix}`;
    }
    usedIds.add(id);

    const duration = clampDuration(item.duration);
    const camera = (item.camera || 'static').trim();
    const label = (item.label || `Cảnh ${index + 1}`).trim();
    const voiceoverVi = item.voiceoverVi || '';

    return buildSceneFromFields(
      {
        id,
        label,
        duration,
        camera,
        type: item.type,
        voiceoverVi,
        onScreenText: item.onScreenText || '',
        // AI hay tự thêm/bớt chữ ở câu thoại nhúng trong veoPrompt dù prompt đã dặn lấy nguyên
        // văn — ép về đúng voiceoverVi để Veo đọc trùng khớp lời đã duyệt.
        veoPrompt: enforceVerbatimVoiceover(item.veoPrompt || '', voiceoverVi),
      },
      index + 1
    );
  });
}

function clampDuration(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_SCENE_DURATION;
  return Math.min(MAX_SCENE_DURATION, Math.max(MIN_SCENE_DURATION, Math.round(n)));
}
