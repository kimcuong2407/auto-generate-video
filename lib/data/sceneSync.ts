/**
 * Đồng bộ trạng thái các scene đang generating với Google Flow — dùng chung cho route
 * status (client-pull khi mở tab) và background poller (server-side, độc lập UI).
 *
 * Nguyên tắc "ưu tiên kết quả poll": LUÔN poll trước, chỉ timeout-check khi Flow vẫn
 * pending/running. Không bao giờ ép 'failed' một scene mà Flow đã trả SUCCESSFUL — kể cả
 * khi đã quá FLOW_JOB_TIMEOUT_MS (tránh bug: đóng tab lúc gen → mở lại sau 15' → timeout
 * giết oan video đã xong). Nếu download/copy lỗi khi đã done → GIỮ 'generating' + ghi error
 * để lần poll sau tải lại (video vẫn còn trên Flow), KHÔNG mất video.
 *
 * Reconcile done + download + upload R2 KHÔNG cần reCAPTCHA (chỉ cần accessToken refresh
 * qua cookie) → poller nền chạy được không cần extension. Nhưng cascade trigger scene kế
 * (runChainingForJustDone → generateVideo) cần extension mint reCAPTCHA trên tab labs.google;
 * nếu extension offline thì scene kế giữ idle (đã log), scene vừa done không bị ảnh hưởng.
 *
 * Mô phỏng lib/livestream/segmentSync.ts, thêm bước upload R2 (video scene lên storage online).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { readProject, updateProject } from './projectStore';
import { triggerSceneGeneration } from './sceneGenerate';
import { pollJobStatus } from '../googleFlow/flowJobs';
import { extractLastFrame } from '../ffmpeg/frame';
import { projectScenesDir, projectFramesDir, resolveWithinProject } from '../paths';
import { uploadFileToR2 } from '../r2/client';
import {
  FLOW_JOB_TIMEOUT_MS,
  FLOW_JOB_HARD_TIMEOUT_MS,
  MAX_SEGMENT_AUTO_RETRIES,
  SEGMENT_RETRY_BACKOFF_MS,
} from '../constants';
import type { Scene } from '../types';

export interface SyncResult {
  justDoneSceneIds: string[];
}

function isTimedOut(scene: Scene): boolean {
  const startedAt = scene.lastUpdatedAt ? new Date(scene.lastUpdatedAt).getTime() : 0;
  return Date.now() - startedAt > FLOW_JOB_TIMEOUT_MS;
}

/** Trần tuyệt đối khi Flow VẪN báo running — xem FLOW_JOB_HARD_TIMEOUT_MS. */
function isHardTimedOut(scene: Scene): boolean {
  const startedAt = scene.lastUpdatedAt ? new Date(scene.lastUpdatedAt).getTime() : 0;
  return startedAt > 0 && Date.now() - startedAt > FLOW_JOB_HARD_TIMEOUT_MS;
}

/**
 * Tuổi scene theo ms — để pollJobStatus biết có nên khoan dung lỗi tạm của Google không
 * (xem pollVideoStatus). Thiếu/hỏng lastUpdatedAt → 0 (coi là vừa tạo, khoan dung).
 */
function ageMs(scene: Scene): number {
  const startedAt = scene.lastUpdatedAt ? new Date(scene.lastUpdatedAt).getTime() : 0;
  if (!startedAt || Number.isNaN(startedAt)) return 0;
  return Date.now() - startedAt;
}

/**
 * Poll mọi scene đang generating của 1 project, cập nhật status trong project.json (nguyên
 * tử qua updateProject). Trả về id các scene vừa chuyển 'done' để caller chạy chaining
 * (KHÔNG nhét chaining vào đây: updateProject có write-queue tuần tự theo projectId, nested
 * sẽ deadlock).
 */
export async function syncGeneratingScenes(projectId: string): Promise<SyncResult> {
  const justDoneSceneIds: string[] = [];

  await updateProject(projectId, async (project) => {
    if (!project.flowProjectId) return;
    const generatingScenes = project.script.scenes.filter(
      (s) => s.status === 'generating' && s.jobId
    );

    await Promise.all(
      generatingScenes.map(async (scene) => {
        const before = scene.status;
        await syncOneScene(projectId, scene, project.flowProjectId as string);
        if (before !== 'done' && scene.status === 'done') justDoneSceneIds.push(scene.id);
      })
    );
  });

  return { justDoneSceneIds };
}

/**
 * Sync 1 scene với Flow, sửa TRỰC TIẾP object `scene` (đang nằm trong mutator updateProject).
 *
 * Tách khỏi syncGeneratingScenes để sync tay dùng lại được với `checkTimeout: false` — port
 * từ lib/livestream/segmentSync.ts:syncOneSegment.
 */
async function syncOneScene(
  projectId: string,
  scene: Scene,
  flowProjectId: string,
  opts: { checkTimeout?: boolean } = {}
): Promise<void> {
  const checkTimeout = opts.checkTimeout !== false;
  try {
    const jobStatus = await pollJobStatus(
      scene.jobId as string,
      flowProjectId,
      ageMs(scene)
    );

    if (jobStatus.status === 'done') {
      // Ưu tiên kết quả poll: đã SUCCESSFUL thì set 'done' bất kể quá hạn hay chưa.
      // Nếu copy/download/upload lỗi → GIỮ 'generating' + ghi error để lần poll sau
      // tải lại (video vẫn còn trên Flow), KHÔNG ép 'failed' làm mất video đã xong.
      if (jobStatus.video_path) {
        const destFileName = `${scene.order.toString().padStart(2, '0')}_${scene.id}.mp4`;
        const destPath = path.join(projectScenesDir(projectId), destFileName);
        // fs.copyFile không tự tạo thư mục đích — cần có sẵn outputs/scenes. Bình
        // thường thư mục này được tạo lúc project creation (projectStore.ts), nhưng
        // thiếu nếu project chạy trên máy khác máy tạo (share chung DB/R2, xem
        // ensureLocalFile) — lúc đó dir chưa từng được scaffold ở đây, copyFile báo
        // nhầm "source ENOENT" dù file tmp vừa tải về có thật.
        await fs.mkdir(path.dirname(destPath), { recursive: true });
        await fs.copyFile(jobStatus.video_path, destPath);
        scene.videoPath = path.join('outputs', 'scenes', destFileName);
        // Upload lên R2 để xem/tải online không phụ thuộc route stream local — vẫn giữ
        // file local vì Bước ghép video (concat) cần đọc trực tiếp bằng ffmpeg.
        scene.videoUrl = await uploadFileToR2(
          destPath,
          `projects/${projectId}/scenes/${destFileName}`,
          'video/mp4'
        );
      }
      scene.status = 'done';
      scene.error = null;
      scene.lastUpdatedAt = new Date().toISOString();
    } else if (jobStatus.status === 'error' || jobStatus.status === 'cancelled') {
      scene.status = 'failed';
      scene.error = jobStatus.error || `Job ${jobStatus.status}`;
      scene.lastUpdatedAt = new Date().toISOString();
    } else {
      // pending/running: Flow khẳng định job còn chạy → KHÔNG giết theo timeout mềm.
      // Veo tier low_priority render lâu hơn 15 phút là bình thường; giết ở đây đẩy
      // người dùng vào vòng gen lại → tốn quota → lại timeout (xem segmentSync).
      if (checkTimeout && isHardTimedOut(scene)) {
        scene.status = 'failed';
        scene.error = `Timeout: job vẫn 'running' sau ${Math.round(FLOW_JOB_HARD_TIMEOUT_MS / 60000)} phút — nhiều khả năng kẹt phía Google`;
        scene.lastUpdatedAt = new Date().toISOString();
      }
      // chưa quá hạn → giữ 'generating', chờ lần poll sau
    }
  } catch (err) {
    // Poll (hoặc download/upload khi done) lỗi tạm thời: ghi error để chẩn đoán. Chỉ
    // ép 'failed' nếu đã quá hạn — chưa quá thì giữ 'generating' để lần sau thử lại,
    // không kẹt vô hạn cũng không giết oan.
    scene.error = `Poll lỗi tạm thời: ${(err as Error).message}`;
    if (checkTimeout && isTimedOut(scene)) {
      scene.status = 'failed';
      scene.error = 'Timeout: chờ job quá lâu';
      scene.lastUpdatedAt = new Date().toISOString();
    }
  }
}

export interface ManualSyncResult {
  ok: boolean;
  status?: Scene['status'];
  error?: string;
}

/**
 * Sync tay 1 scene theo yêu cầu người dùng (nút "Đồng bộ" trên UI).
 *
 * Khác vòng poll tự động ở hai chỗ, đều cố ý — port từ livestream:syncSegmentManually:
 * - Chỉ cần còn `jobId`, KHÔNG đòi status phải 'generating': scene bị timeout giết oan (hoặc
 *   người dùng bấm Dừng) vẫn còn job chạy thật bên Google, sync tay là đường để lấy lại video.
 * - `checkTimeout: false`: người dùng chủ động bấm thì đừng để đồng hồ giết ngay lần sync này.
 */
export async function syncSceneManually(
  projectId: string,
  sceneId: string
): Promise<ManualSyncResult> {
  const project = await readProject(projectId);
  const scene = project.script.scenes.find((s) => s.id === sceneId);
  if (!scene) return { ok: false, error: 'Scene không tồn tại' };
  if (!scene.jobId) return { ok: false, error: 'Scene chưa từng generate — không có gì để đồng bộ' };
  if (scene.status === 'done') return { ok: true, status: 'done' };
  if (!project.flowProjectId) return { ok: false, error: 'Project chưa có flowProjectId' };

  let resultStatus: Scene['status'] = scene.status;
  let justDone = false;
  await updateProject(projectId, async (p) => {
    const s = p.script.scenes.find((x) => x.id === sceneId);
    if (!s || !s.jobId) return;
    await syncOneScene(projectId, s, p.flowProjectId as string, { checkTimeout: false });
    resultStatus = s.status;
    justDone = s.status === 'done';
  });

  // Vừa done thì chain luôn, y như vòng poll — nếu không, frame cuối không được extract và
  // cảnh kế đứng im cho tới vòng poll sau.
  if (justDone) await runChainingForJustDone(projectId, [sceneId]);

  return { ok: true, status: resultStatus };
}

/**
 * Scene này có được tự động trigger lại không.
 *
 * Port từ lib/livestream/segmentSync.ts:shouldAutoTrigger — cùng lý do đã trả giá bên đó: một
 * lỗi tạm thời (mint reCAPTCHA timeout, Flow 5xx) làm đứt dây chuyền vĩnh viễn, người dùng bấm
 * gen cả loạt mà chỉ chạy tới cảnh hỏng rồi nằm im, phải ngồi bấm tay từng cảnh còn lại.
 *
 * Trần theo `attempts` (tăng mỗi lần trigger) để lỗi THẬT không quay vòng vô hạn đốt quota Veo.
 */
export function shouldAutoTrigger(scene: Scene, now = Date.now()): boolean {
  if (!scene.veoPrompt.trim()) return false;
  if (scene.status === 'idle') return true;
  if (scene.status !== 'failed') return false;
  if (scene.attempts >= MAX_SEGMENT_AUTO_RETRIES) return false;
  // Lùi lại trước khi thử lại: poller chạy mỗi 15s, thử lại ngay thì cảnh lỗi vì hết quota Veo
  // bị đập 240 lần/giờ. Lỗi hết quota KHÔNG tăng attempts (xem triggerSceneGeneration) nên
  // backoff theo thời gian là thứ DUY NHẤT chặn vòng lặp đó.
  const lastAt = scene.lastUpdatedAt ? new Date(scene.lastUpdatedAt).getTime() : 0;
  return now - lastAt >= SEGMENT_RETRY_BACKOFF_MS;
}

/**
 * Nối lại dây chuyền cho 1 project khi nó đứt giữa chừng — độc lập với `justDoneSceneIds`.
 *
 * Port từ lib/livestream/segmentSync.ts:resumeStalledJob. Vì sao cần dù đã có cascade trong
 * runChainingForJustDone: cascade CHỈ chạy khi có cảnh VỪA chuyển done. Cảnh đang generating mà
 * hỏng thì không cảnh nào done trong vòng poll đó → không ai trigger tiếp, project nằm chết với
 * hàng loạt cảnh idle phía sau dù người dùng đã bấm gen cả loạt.
 *
 * Chi phí gần như bằng 0 khi không có việc (chỉ đọc project):
 * - Còn cảnh đang generating → không đụng, chờ nó xong (giữ đúng thứ tự chain).
 * - Không còn cảnh nào chạy mà vẫn còn việc → trigger cảnh hợp lệ đầu tiên.
 *
 * Trả id cảnh vừa trigger lại (null nếu không làm gì) để caller log.
 */
export async function resumeStalledProject(projectId: string): Promise<string | null> {
  const project = await readProject(projectId);

  const scenes = project.script.scenes;
  // Còn cảnh đang chạy → dây chuyền chưa đứt, để yên (trigger thêm sẽ gen chồng, lệch thứ tự).
  if (scenes.some((s) => s.status === 'generating')) return null;
  // CHỈ nối tiếp việc người dùng đã bắt đầu: phải có cảnh từng được trigger (attempts > 0).
  // Thiếu điều kiện này thì poller tự khởi động MỌI project nháp chưa ai bấm gen, đốt quota Veo.
  if (!scenes.some((s) => s.attempts > 0)) return null;

  const candidate = scenes.find((scene) => {
    if (!shouldAutoTrigger(scene)) return false;
    // Tôn trọng ràng buộc tuần tự của chaining: cảnh liền trước phải xong đã.
    if (!project.sceneChaining) return true;
    if (scene.order <= 1) return true;
    const prev = scenes.find((s) => s.order === scene.order - 1);
    return !prev || prev.status === 'done';
  });
  if (!candidate) return null;

  try {
    const res = await triggerSceneGeneration(projectId, candidate.id, { requireFailed: false });
    if (!res.ok) {
      // Hết quota là trạng thái CHỜ, không phải hỏng — log gọn để khỏi ngập log mỗi vòng poll.
      if (res.quotaExceeded) {
        console.warn(`[project resume] ${projectId}: hết quota Veo, chờ quota reset rồi tự chạy tiếp`);
      } else if (res.mcpUnavailable) {
        console.warn(
          `[project resume] ${projectId}: không gọi được Orino MCP — bật app Orino Flow + công tắc ` +
            `"MCP Server" rồi dây chuyền tự chạy tiếp. Lý do: ${res.error}`
        );
      } else {
        console.error(`[project resume] trigger lại ${candidate.id} thất bại: ${res.error}`);
      }
      return null;
    }
    console.log(`[project resume] nối lại dây chuyền ${projectId} từ cảnh ${candidate.id}`);
    return candidate.id;
  } catch (err) {
    console.error(`[project resume] trigger lại ${candidate.id} lỗi:`, err);
    return null;
  }
}

/**
 * Với mỗi scene vừa done: extract khung hình cuối rồi tự trigger scene kế tiếp (nếu đang
 * idle) — cascade tuần tự qua các lần poll. Tách updateProject riêng, KHÔNG nested trong
 * mutator của syncGeneratingScenes (write-queue theo projectId tuần tự, nested sẽ deadlock).
 *
 * Ràng buộc: cascade trigger scene kế gọi generateVideo → cần reCAPTCHA mint từ extension
 * trên tab labs.google. Nếu extension offline, trigger sẽ fail (scene kế giữ idle) nhưng
 * scene vừa done KHÔNG bị ảnh hưởng — reconcile done/download không cần reCAPTCHA.
 */
export async function runChainingForJustDone(
  projectId: string,
  justDoneSceneIds: string[]
): Promise<void> {
  if (justDoneSceneIds.length === 0) return;

  let project = await readProject(projectId);
  if (!project.sceneChaining) return;

  await fs.mkdir(projectFramesDir(projectId), { recursive: true });

  for (const sceneId of justDoneSceneIds) {
    const scene = project.script.scenes.find((s) => s.id === sceneId);
    if (!scene?.videoPath) continue;

    const frameFileName = `${scene.order.toString().padStart(2, '0')}_${scene.id}_last.jpg`;
    const frameAbsPath = path.join(projectFramesDir(projectId), frameFileName);
    const framePath = path.join('outputs', 'frames', frameFileName);

    try {
      const videoAbsPath = resolveWithinProject(projectId, scene.videoPath);
      await extractLastFrame(videoAbsPath, frameAbsPath);
      const { project: afterFrame } = await updateProject(projectId, (p) => {
        const s = p.script.scenes.find((x) => x.id === sceneId);
        if (s) s.lastFramePath = framePath;
      });
      project = afterFrame;
    } catch (err) {
      // Lỗi extract frame chỉ log server-side — scene đã gen thành công, chỉ bước chain phụ
      // trợ thất bại, không hiển thị như lỗi scene.
      console.error(`[project chaining] extract last frame thất bại cho scene ${sceneId}:`, err);
      continue;
    }

    const nextScene = project.script.scenes.find((s) => s.order === scene.order + 1);
    // shouldAutoTrigger thay cho `status === 'idle'`: cảnh kế từng fail vì lỗi tạm thời cũng
    // được thử lại (trong trần attempts + backoff), thay vì đứng im chờ người dùng bấm tay.
    if (nextScene && shouldAutoTrigger(nextScene)) {
      try {
        const res = await triggerSceneGeneration(projectId, nextScene.id);
        // Hết quota Veo → dừng cascade cả vòng này: các cảnh sau chắc chắn cũng 429, thử tiếp
        // chỉ đập vào API vô ích. Cảnh vẫn ở 'failed' nên vòng poll sau (khi quota đã reset)
        // tự chạy lại.
        if (res.quotaExceeded) {
          console.warn(`[project chaining] ${projectId}: hết quota Veo, tạm dừng cascade`);
          return;
        }
        // MCP chết → dừng cả vòng, cùng lý do quota: mọi cảnh sau cũng không gọi được, thử tiếp
        // chỉ sinh log rác. Cảnh giữ 'failed' + attempts KHÔNG tăng nên vòng poll sau (khi Mr.D
        // bật lại app Orino) tự nối lại dây chuyền, không cần bấm tay.
        if (res.mcpUnavailable) {
          console.warn(
            `[project chaining] ${projectId}: không gọi được Orino MCP, tạm dừng cascade — ` +
              `bật app Orino Flow + công tắc "MCP Server" rồi dây chuyền tự chạy tiếp. Lý do: ${res.error}`
          );
          return;
        }
      } catch (err) {
        console.error(`[project chaining] trigger scene kế ${nextScene.id} thất bại:`, err);
      }
      project = await readProject(projectId);
    }
  }
}
