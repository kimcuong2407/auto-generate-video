import { NextRequest, NextResponse } from 'next/server';
import { jobExists, readJob } from '@/lib/livestream/jobStore';
import { loadPromptSet } from '@/lib/livestream/promptStore';
import { describeProductAppearance } from '@/lib/livestream/productVision';
import { ensureProductLock, pickProductLockRefPaths } from '@/lib/livestream/productLock';
import { ensureStageBible } from '@/lib/livestream/stageBible';
import { ensureLocalImage } from '@/lib/livestream/imageR2';
import { resolveWithinJob } from '@/lib/livestream/paths';
import { readV2Input } from '@/lib/livestream/v2Store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Các bước chạy lẻ được từ job detail. Bước khác cố tình KHÔNG nhận — xem lý do bên dưới. */
const RUNNABLE_STEPS = ['product_visual', 'product_lock', 'stage_bible'] as const;
type RunnableStep = (typeof RUNNABLE_STEPS)[number];

const isRunnable = (v: string): v is RunnableStep =>
  (RUNNABLE_STEPS as readonly string[]).includes(v);

/**
 * Chạy RIÊNG một bước AI cấp job, không kéo theo cả pipeline sinh script.
 *
 * Vì sao cần: 3 bước này trước đây chỉ chạy ngầm bên trong `script/generate`. Muốn chốt lại sân
 * khấu thôi thì phải bấm "Chốt lại sân khấu" — nút đó sinh lại luôn script của MỌI sản phẩm
 * (xem forceStageBible ở route generate), tức đốt cả chục lượt AI cho một việc đáng lẽ tốn một.
 *
 * Vì sao gộp 3 bước vào 1 route thay vì 3 route: cả ba cùng hình dạng (POST, không body, chạy 1
 * lượt AI cấp job rồi trả kết quả) — tách ra chỉ nhân ba phần boilerplate guard/try-catch.
 *
 * KHÔNG nhận `script`/`shorten`/`script_qa`: chúng chạy theo TỪNG SẢN PHẨM và `script` còn ghi đè
 * segments, nên thuộc luồng `script/generate` (có SSE báo tiến độ + cổng duyệt), không phải chỗ này.
 *
 * Cả 3 bước đều chạy với `force: true` — Mr.D bấm nút là muốn chốt LẠI, không phải "dùng bản cache
 * nếu có". Nhờ force, ensureStageBible/ensureProductLock ném lỗi thật thay vì trả null im lặng.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: { id: string; step: string } }
) {
  const { id, step } = params;

  if (!isRunnable(step)) {
    return NextResponse.json(
      { error: `Bước không chạy lẻ được: ${step}. Chỉ nhận: ${RUNNABLE_STEPS.join(', ')}` },
      { status: 400 }
    );
  }
  if (!(await jobExists(id))) {
    return NextResponse.json({ error: 'Job không tồn tại' }, { status: 404 });
  }

  try {
    const job = await readJob(id);

    if (step === 'stage_bible') {
      const stageBible = await ensureStageBible(id, { force: true });
      return NextResponse.json({ step, stageBible });
    }

    if (step === 'product_lock') {
      // Chặn sớm với job V1: prompt V1 không có chỗ nhận khối lock nên chốt xong cũng không dùng
      // vào đâu — báo thẳng còn hơn để Mr.D đốt 1 lượt vision rồi thắc mắc sao script không đổi.
      const v2Input = await readV2Input(id).catch(() => null);
      if (!v2Input) {
        return NextResponse.json(
          { error: 'Bước này chỉ áp dụng cho job Livestream Shopee V2 — job V1 không dùng khối khoá ngoại hình.' },
          { status: 400 }
        );
      }
      const lock = await ensureProductLock(id, { force: true });
      return NextResponse.json({ step, lock });
    }

    // product_visual — bước DUY NHẤT trong 3 bước này không lưu kết quả vào job: nó vốn là biến
    // tạm trong một lượt sinh script (xem describeProductAppearance). Chạy lẻ ở đây chỉ để Mr.D
    // đọc xem AI nhìn ra gì từ ảnh; lượt sinh script sau vẫn đọc lại từ đầu như cũ.
    //
    // Dùng pickProductLockRefPaths thay vì tự viết lại phép giao: cùng một quy tắc "ảnh đã tick
    // cho bước script ∩ ảnh sản phẩm đã chọn", và nó đã bị copy-paste ở 3 chỗ rồi.
    const refPaths = pickProductLockRefPaths(job);
    if (refPaths.length === 0) {
      return NextResponse.json(
        { error: 'Chưa chọn ảnh sản phẩm nào cho bước này — hãy tick ảnh sản phẩm ở phần cấu hình ảnh của job rồi chạy lại.' },
        { status: 400 }
      );
    }

    await Promise.all(
      refPaths.map((rel) => ensureLocalImage(job.id, rel, job.imageR2Urls?.[rel]).catch(() => {}))
    );
    const prompts = await loadPromptSet(job.slug);
    const description = await describeProductAppearance(
      refPaths.map((rel) => resolveWithinJob(job.id, rel)),
      prompts.get('product_visual'),
      { jobSlug: job.slug, promptScope: prompts.scopeOf('product_visual') }
    );

    return NextResponse.json({ step, description, refPaths });
  } catch (err) {
    console.error(`[livestream] chạy bước ${step} cho job ${id} thất bại:`, err);
    // Drizzle (và một số lớp bọc khác) giấu lỗi thật trong `cause` — message ngoài chỉ là câu query.
    const real = (err as { cause?: Error }).cause ?? (err as Error);
    return NextResponse.json({ error: `Chạy bước thất bại: ${real.message}` }, { status: 500 });
  }
}
