/**
 * Cửa public sinh ảnh qua ChatGPT web — chữ ký khớp generateOmniImage() để nhánh rẽ provider
 * ở lib/googleFlow/flowJobs.ts:generateStoryboardImage dùng được y hệt.
 *
 * Luồng: đẩy job vào bảng (bền qua PM2 reload) → worker giành và chạy Playwright → poll DB
 * chờ kết quả. Call-site vẫn `await` tới khi có ảnh nên 3 nơi gọi không phải đổi gì; bảng job
 * ở đây phục vụ tính bền và chẩn đoán, chưa phải để chạy bất đồng bộ.
 */

import { createJob, readJob } from './jobStore';
import { getActiveAccount } from './accountStore';
import { runQueueOnce } from './worker';

export interface GenerateChatgptImageParams {
  prompt: string;
  refImagePaths?: string[];
  aspect?: '9:16' | '16:9';
  timeoutMs?: number;
}

/** Trả mảng đường dẫn file local — cùng contract với generateOmniImage(). */
export async function generateChatgptImage(params: GenerateChatgptImageParams): Promise<string[]> {
  const account = getActiveAccount();
  if (!account) {
    throw new Error(
      'Chưa có tài khoản ChatGPT nào sẵn sàng. Chạy `npm run chatgpt:login` để đăng nhập, ' +
        'hoặc kiểm tra ở Cài đặt → ChatGPT xem phiên có bị hết hạn không.'
    );
  }

  const jobId = await createJob({
    prompt: params.prompt,
    aspect: params.aspect || '9:16',
    refImagePaths: params.refImagePaths,
  });

  const timeoutMs = params.timeoutMs || 11 * 60_000;
  const deadline = Date.now() + timeoutMs;

  // Đá worker chạy ngay thay vì đợi tới nhịp poll kế — gen ảnh vốn là thao tác người dùng
  // đang ngồi chờ, thêm vài giây trống không có lý do gì.
  void runQueueOnce();

  while (Date.now() < deadline) {
    const job = await readJob(jobId);
    if (job?.status === 'done' && job.imagePath) return [job.imagePath];
    if (job?.status === 'failed') throw new Error(job.error || 'Gen ảnh ChatGPT thất bại');
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Hết thời gian chờ ChatGPT trả ảnh');
}
