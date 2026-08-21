import { NextRequest, NextResponse } from 'next/server';
import { projectExists, readProject, updateProject } from '@/lib/data/projectStore';
import { generateScriptText } from '@/lib/googleFlow/flowJobs';
import { ChatApiError } from '@/lib/ai/chatClient';
import type { ChatStreamEvent } from '@/lib/ai/chatClient';
import { findScriptAngle } from '@/lib/scriptAngles';
import {
  buildSceneFromFields,
  mergeStoryboardWithScript,
  mergeBackgroundsWithScript,
} from '@/lib/data/projectFactory';
import path from 'node:path';
import { slugify, projectInputsDir } from '@/lib/paths';
import { extractJson } from '@/lib/ai/jsonExtract';
import { extractVisualDescription } from '@/lib/data/productVisionExtract';
import type { Scene } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MIN_SCENE_DURATION = 3;
const MAX_SCENE_DURATION = 25;
const DEFAULT_SCENE_DURATION = 8;

const BASE_SYSTEM_PROMPT = `Bạn là chuyên gia viết kịch bản video review sản phẩm ngắn (TikTok/Reels/TikTok Shop),
đồng thời là đạo diễn hình ảnh đảm bảo các cảnh quay liền mạch và chân thực như quay bằng máy thật.

BƯỚC 1 — Trước khi thiết kế cảnh, hãy tự xác định các yếu tố CỐ ĐỊNH dùng chung cho toàn bộ video, ghi nhớ
xuyên suốt khi viết từng cảnh:

a. 1 "bối cảnh quay" (shoot setup) DUY NHẤT: 1 không gian cụ thể (VD: phòng khách nhỏ có ánh sáng cửa sổ,
   bàn gỗ trong bếp, góc làm việc tại nhà...), 1 kiểu ánh sáng nhất quán (VD: ánh sáng tự nhiên buổi chiều
   từ cửa sổ bên trái), 1 phong cách máy quay nhất quán (VD: cầm tay nhẹ, hơi rung tự nhiên như quay bằng
   điện thoại/handheld thật — KHÔNG phải chuyển động máy quá mượt mà kiểu dựng 3D).

b. NẾU kịch bản có người (reviewer/người dẫn) xuất hiện trong bất kỳ cảnh nào: chốt cố định 1 "nhân vật
   review" DUY NHẤT — giới tính, độ tuổi ước lượng, kiểu tóc/màu tóc, vóc dáng, trang phục (kiểu dáng + màu
   sắc cụ thể), đặc điểm nhận diện riêng (kính, hình xăm, trang sức...) nếu có, và tư thế cố định (VD: luôn
   ngồi tại bàn, chỉ tay và thân trên chuyển động). Mô tả này PHẢI giống hệt nhau (giữ nguyên từ ngữ, KHÔNG
   diễn đạt lại khác đi) ở MỌI cảnh có người xuất hiện — TUYỆT ĐỐI KHÔNG đổi trang phục, kiểu tóc, hay đặc
   điểm ngoại hình giữa các cảnh dù video dài. Nếu có ảnh reference người mẫu, mô tả PHẢI khớp đúng người
   trong ảnh và giữ y hệt xuyên suốt. Nếu kịch bản KHÔNG có người lộ mặt (VD góc "chỉ tay + voiceover"), bỏ
   qua mục này — chỉ cần giữ nhất quán đặc điểm bàn tay (tông da, không trang sức lạ) nếu có tay xuất hiện
   trong khung.

c. NẾU có lời thoại (voiceoverVi khác rỗng ở bất kỳ cảnh nào): chốt cố định 1 "chất giọng" DUY NHẤT — giới
   tính giọng, quãng tuổi giọng, âm vực (trầm/cao/vừa), tốc độ nói, và tông cảm xúc chủ đạo. Mô tả này PHẢI
   giống hệt nhau ở MỌI cảnh có thoại — Google Veo tự chọn giọng dựa theo mô tả trong prompt mỗi lần tạo
   video riêng biệt nên KHÔNG tự nhớ giọng đã dùng ở cảnh trước; chỉ có nhắc lại đúng 1 mô tả giọng cố định
   trong veoPrompt của mọi cảnh mới giúp giọng nghe nhất quán xuyên suốt.

Bối cảnh (a), nhân vật (b nếu có), và giọng (c nếu có) PHẢI được nhắc lại nhất quán trong veoPrompt của
MỌI cảnh liên quan để khi ghép nối các cảnh lại, người xem cảm giác đây là 1 buổi quay liên tục do đúng 1
người ở đúng 1 chỗ, không phải các đoạn clip rời rạc ghép từ nhiều nơi/nhiều người khác nhau.

Ngoài ra, hệ thống sẽ tự động lấy khung hình CUỐI CÙNG của video cảnh trước làm khung hình
BẮT ĐẦU khi tạo video thật cho cảnh kế tiếp (image-to-video chaining) — nghĩa là hành động mở
đầu của mọi cảnh từ thứ 2 trở đi PHẢI là phần TIẾP NỐI TRỰC TIẾP, không gián đoạn, từ đúng tư
thế/vị trí/hành động mà cảnh ngay trước đó vừa kết thúc (giống 1 cú cắt cảnh trong cùng 1 pha
quay liên tục, KHÔNG phải mở đầu bằng 1 tư thế/vị trí/hành động khác biệt hay mâu thuẫn với
kết cảnh trước). Khi thiết kế từng cảnh, hãy luôn hình dung rõ cảnh sẽ KẾT THÚC ở tư thế/vị
trí nào, để veoPrompt của cảnh kế tiếp mô tả đúng phần tiếp nối đó ngay từ câu đầu.

BƯỚC 2 — Tự THIẾT KẾ danh sách cảnh (scenes) phù hợp nhất với góc kịch bản đã chọn bên dưới. KHÔNG bắt buộc
phải theo đúng danh sách cảnh mẫu được cung cấp — danh sách mẫu chỉ mang tính tham khảo về loại cảnh, không
phải khung cố định. Được phép bỏ bớt, gộp, thêm mới, đổi thứ tự cảnh miễn là phù hợp nhất với góc kịch bản
và tổng thời lượng mục tiêu. Số lượng cảnh hợp lý thường 4-8 cảnh tuỳ góc kịch bản và tổng thời lượng.

Với mỗi cảnh tự thiết kế, xác định:
- id: định danh ngắn viết thường không dấu, dùng gạch nối (VD: "hook", "feature-1", "cta")
- label: tên cảnh ngắn gọn tiếng Việt
- duration: thời lượng cảnh (giây), tổng các cảnh nên xấp xỉ tổng thời lượng mục tiêu
- camera: kiểu chuyển động máy quay (VD: "static", "zoom_in", "dolly_in", "top_down", "macro_pan"...)
- type: loại cảnh (VD: "hook", "reveal", "demo", "feature", "comparison", "outro"...)
- voiceoverVi: lời thoại tiếng Việt tự nhiên, thân thiện, đúng thời lượng scene (khoảng 2-3 từ/giây)
- onScreenText: câu chữ ngắn overlay lên màn hình (dưới 8 từ)
- veoPrompt: mô tả cảnh quay bằng tiếng Anh, chi tiết, dùng cho AI tạo video (Google Veo). veoPrompt phải là
  1 đoạn văn liền mạch nhưng BẮT BUỘC bao phủ đủ 7 thành phần chuyên nghiệp sau (không cần ghi nhãn từng
  phần ra prompt, chỉ cần nội dung có mặt):
  (1) Subject — NẾU cảnh có người: dùng ĐÚNG mô tả "nhân vật review" đã chốt ở Bước 1.b (giữ nguyên từ ngữ,
      KHÔNG viết lại khác đi giữa các cảnh); luôn kèm mô tả sản phẩm (chất liệu, màu sắc, kích thước) khi
      sản phẩm xuất hiện trong cảnh đó.
      QUAN TRỌNG về màu sắc/chất liệu/hình dạng sản phẩm: nếu phần "Mô tả hình ảnh thật từ ảnh sản phẩm"
      được cung cấp bên dưới, BẮT BUỘC dùng ĐÚNG màu sắc/chất liệu/hình dạng nêu trong đó, giữ nhất quán
      xuyên suốt MỌI cảnh. TUYỆT ĐỐI KHÔNG tự bịa/suy diễn/đổi màu, chất liệu, chi tiết không có trong mô tả
      đó. Nếu KHÔNG có thông tin màu/chất liệu đáng tin cậy, dùng cụm trung tính "the product shown in the
      reference image" thay vì tự đặt tên một màu cụ thể (đặt sai màu sẽ làm video mất đồng nhất với sản phẩm thật);
  (2) Action — hành động/cử chỉ/micro-expression cụ thể đang diễn ra; với cảnh thứ 2 trở đi,
      câu mô tả hành động mở đầu PHẢI tiếp nối trực tiếp từ tư thế/vị trí/hành động kết thúc
      của cảnh ngay trước (xem chỉ dẫn image-to-video chaining ở trên).
      RÀNG BUỘC TAY/CHÂN (bắt buộc, áp dụng mọi cảnh có người):
      - Mỗi người CHỈ có đúng 2 tay và 2 chân. TUYỆT ĐỐI KHÔNG mô tả người cầm/giữ/nắm cùng lúc
        nhiều vật bằng quá 2 tay, KHÔNG để 1 vật được nhiều hơn 2 tay giữ, KHÔNG mô tả thao tác
        cần quá nhiều tay để thực hiện.
      - Giữ cử động tay/chân TỐI GIẢN và gần với thân người: ưu tiên tay đặt trên bàn/trên sản
        phẩm, cầm vật đơn giản bằng 1 tay hoặc 2 tay, hạn chế tối đa tay giơ cao/vung/đan chéo/
        đưa qua lại khỏi khung hình. KHÔNG mô tả cử chỉ phức tạp nhiều khớp (đếm ngón tay, xoè
        từng ngón, bắt chéo ngón, động tác múa/ký hiệu tay...).
      - Với cảnh dùng image-to-video chaining, mô tả rõ ràng TƯ THẾ TAY TĨNH ổn định khi bắt đầu
        cảnh (tay đang đặt ở đâu, cầm gì) để Veo không tự "bịa thêm" 1 bàn tay thứ ba trong lúc
        tiếp nối chuyển động.
      - Trong phần Technical của veoPrompt, thêm cụm "natural hand anatomy, exactly two hands,
        exactly two arms, no extra limbs" để nhấn mạnh giải phẫu tay chuẩn, không thừa chi.
  (3) Scene — bối cảnh quay chung đã xác định ở Bước 1 (không gian, ánh sáng, phong cách máy quay), PHẢI
      nhắc lại nhất quán để liền mạch với các scene khác;
  (4) Style — loại cảnh quay (wide/medium/close-up...), góc máy, chuyển động máy quay, phong cách ánh sáng;
  (5) Dialogue — Google Veo tự sinh giọng nói dựa theo mô tả trong prompt, nên veoPrompt BẮT BUỘC nhúng mô
      tả chất giọng cố định đã chốt ở Bước 1.c (giữ nguyên từ ngữ, KHÔNG diễn đạt lại khác đi giữa các cảnh)
      ngay trước câu thoại, rồi mới đến đoạn lời thoại lấy NGUYÊN VĂN từ voiceoverVi của chính scene đó,
      dùng ĐÚNG cú pháp có dấu hai chấm trước dấu ngoặc kép (colon syntax — cú pháp đã được cộng đồng kiểm
      chứng giúp ngăn Veo tự sinh phụ đề/subtitle đè lên video): The person has <mô tả giọng cố định>,
      speaks in Vietnamese, saying: "<nguyên văn voiceoverVi>". Không dịch câu thoại sang tiếng Anh, không
      dùng dấu ngoặc kép mà thiếu dấu hai chấm phía trước (dễ kích hoạt phụ đề không mong muốn), không được
      bỏ qua chỉ dẫn giọng/ngôn ngữ này. Nếu scene không có voiceoverVi (cảnh im lặng) thì bỏ qua phần
      Dialogue, không bịa lời thoại;
  (6) Sounds — BẮT BUỘC có 1 câu bắt đầu bằng "Audio:" mô tả rõ âm thanh nền/hiệu ứng/nhạc phù hợp bối cảnh
      (VD: "Audio: quiet room tone, soft fabric rustling, no background music") để tránh Veo tự bịa âm thanh
      sai bối cảnh (audio hallucination) — không được bỏ qua câu Audio này ở bất kỳ scene nào;
  (7) Technical — luôn thêm cụm "no subtitles, no captions, no on-screen text" vào cuối veoPrompt để chặn
      Veo tự sinh phụ đề chồng lên video (on-screen text hiển thị đã được xử lý riêng qua trường onScreenText,
      không cần và không được để Veo tự vẽ chữ).

  Yêu cầu bổ sung bắt buộc:
  a. Nếu cảnh quay theo góc chủ quan (POV, cầm điện thoại/selfie, handheld, over-the-shoulder), PHẢI dùng
     đúng cú pháp "(thats where the camera is)" ngay sau vị trí camera được mô tả — kỹ thuật này giúp Veo
     bám đúng vị trí máy quay đã yêu cầu, ví dụ: "holding the phone at arm's length (thats where the camera
     is)" hoặc "camera held at chest height (thats where the camera is)". Nếu là dạng video selfie thực sự
     (người nói tự cầm máy quay chính mình), áp dụng công thức: bắt đầu bằng "A selfie video of...", nêu rõ
     tay cầm máy dài ra ("holds the camera at arm's length"), tay/cánh tay hiện rõ trong khung hình, thỉnh
     thoảng liếc nhìn vào camera, và thêm "slightly grainy, film-like" để tránh cảm giác quá sạch/giả tạo AI.
  b. Ưu tiên hình ảnh CHÂN THỰC như quay bằng máy ảnh/điện thoại thật, KHÔNG được tạo cảm giác giả tạo hay
     lộ dấu hiệu AI-generated: mô tả kết cấu da/vật liệu tự nhiên có chi tiết nhỏ không hoàn hảo (texture,
     lỗ chân lông, nếp nhăn vải tự nhiên), ánh sáng tự nhiên không đối xứng hoàn hảo, chuyển động camera hơi
     có độ rung/imperfect như tay người cầm quay, tránh mọi mô tả kiểu "perfect/flawless/glossy/pristine/
     studio-perfect/hyper-smooth/CGI/3D render/waxy skin". Dùng các từ khoá gợi chân thực: "shot on iPhone",
     "handheld", "natural imperfections", "authentic", "unretouched", "realistic skin texture", "candid".
  c. Dùng từ khoá kiểm soát chất lượng chuyển động phù hợp diễn biến cảnh (VD: "natural movement",
     "confident movement", "graceful movement", "energetic movement") thay vì để chuyển động chung chung.

Cấu trúc chung bắt buộc dù theo góc kịch bản nào: cảnh đầu tiên phải là hook gây chú ý trong 3 giây đầu
(nội dung cảnh hook do góc kịch bản quyết định — xem chỉ dẫn góc bên dưới), các cảnh giữa là nội dung chính
đúng tinh thần góc kịch bản được chọn, cảnh cuối cùng phải chốt bằng lời kêu gọi hành động (CTA) rõ ràng —
ví dụ mời chốt đơn, ghim giỏ hàng, để lại bình luận.

Trả về DUY NHẤT 1 JSON object hợp lệ, không kèm markdown/giải thích, đúng format:
{"scenes":[{"id":"...","label":"...","duration":8,"camera":"...","type":"...","voiceoverVi":"...","onScreenText":"...","veoPrompt":"..."}]}`;

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
      visualDescription = await extractVisualDescription(absPaths);
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

  const systemPrompt = `${BASE_SYSTEM_PROMPT}\n\nGóc kịch bản được chọn: "${angle.title}".\n${angle.aiGuidance}`;

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
        const raw = await generateScriptText(systemPrompt, userPrompt, (e: ChatStreamEvent) => {
          if (e.type === 'start' || e.type === 'retry') {
            send(e);
          }
          // 'delta'/'error' của chatClient chỉ dùng để log nội bộ — không forward ra
          // client vì đó là mảnh JSON kịch bản chưa hoàn chỉnh, dễ vỡ khi parse giữa
          // chừng (xem "Ranh giới dữ liệu gửi ra" trong plan).
        });
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

    return buildSceneFromFields(
      {
        id,
        label,
        duration,
        camera,
        type: item.type,
        voiceoverVi: item.voiceoverVi || '',
        onScreenText: item.onScreenText || '',
        veoPrompt: item.veoPrompt || '',
      },
      index + 1
    );
  });
}

function clampDuration(value: unknown): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_SCENE_DURATION;
  return Math.min(MAX_SCENE_DURATION, Math.max(MIN_SCENE_DURATION, Math.round(n)));
}
