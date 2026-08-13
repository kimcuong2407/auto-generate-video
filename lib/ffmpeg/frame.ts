import { run } from './run';

/**
 * Extract khung hình cuối cùng của 1 video, dùng làm start_path (image-to-video)
 * cho scene kế tiếp — tạo continuity thị giác thật giữa các cảnh. Seek từ cuối
 * video 1 giây rồi lấy khung hình cuối cùng đọc được (an toàn vì duration tối
 * thiểu của 1 clip Veo là 4s).
 */
export async function extractLastFrame(videoAbsPath: string, outAbsPath: string): Promise<void> {
  await run('ffmpeg', [
    '-sseof', '-1',
    '-i', videoAbsPath,
    '-update', '1',
    '-q:v', '2',
    outAbsPath,
    '-y',
  ]);
}
