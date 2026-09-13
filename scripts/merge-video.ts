/**
 * Gộp video THỦ CÔNG bằng ffmpeg — chạy tay, không qua UI/pipeline.
 *
 * Dùng đúng tham số encode như pipeline tự động (lib/livestream/concat.ts và
 * lib/ffmpeg/concat.ts): scale theo aspect, libx264 preset medium crf 22,
 * aac 192k, yuv420p, 30fps, +faststart.
 *
 * 3 chế độ:
 *   1) job livestream : --job <jobId>          → đọc job.json, ghép segment theo order
 *   2) project         : --project <projectId> → đọc project.json, ghép scene theo order
 *   3) thư mục bất kỳ  : --dir <path>          → ghép mọi .mp4 trong thư mục, sort theo tên
 *   4) danh sách file  : --files a.mp4 b.mp4   → ghép đúng thứ tự đã liệt kê
 *
 * Ví dụ:
 *   npx tsx scripts/merge-video.ts --job homebox-1-92724d
 *   npx tsx scripts/merge-video.ts --dir data/livestream/homebox-1-92724d/outputs/segments -o ~/Desktop/final.mp4
 *   npx tsx scripts/merge-video.ts --files a.mp4 b.mp4 c.mp4 -o out.mp4 --aspect 16:9
 *   npx tsx scripts/merge-video.ts --job xxx --dry-run      # chỉ in danh sách file, không chạy ffmpeg
 *
 * Cờ phụ:
 *   -o, --out <path>   nơi ghi file kết quả (mặc định: <outputs>/final-manual.mp4)
 *   --aspect 9:16|16:9 tỉ lệ khung (mặc định: lấy từ job/project, còn lại 9:16)
 *   --copy             thử ghép nhanh không encode lại (-c copy). CHỈ dùng khi mọi file
 *                      cùng codec/độ phân giải/fps, nếu không video sẽ lỗi tiếng/hình.
 *   --dry-run          in ra thứ tự ghép rồi dừng.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';

type Aspect = '9:16' | '16:9';

// ---------------------------------------------------------------- args

const argv = process.argv.slice(2);

function flag(name: string): boolean {
  return argv.includes(`--${name}`);
}

function opt(...names: string[]): string | null {
  for (const name of names) {
    const i = argv.indexOf(name);
    if (i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('-')) return argv[i + 1];
  }
  return null;
}

/** Lấy mọi giá trị đứng sau --files cho tới cờ tiếp theo. */
function multi(name: string): string[] {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return [];
  const out: string[] = [];
  for (let k = i + 1; k < argv.length; k++) {
    if (argv[k].startsWith('--')) break;
    out.push(argv[k]);
  }
  return out;
}

function die(msg: string): never {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

// ---------------------------------------------------------------- helpers

function run(cmd: string, args: string[], quiet = false): Promise<string> {
  return new Promise((resolve, reject) => {
    // stdio inherit cho ffmpeg để Mr.D thấy tiến độ thật thời gian thực.
    const child = spawn(cmd, args, { stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit' });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (d) => (stdout += d.toString()));
    child.stderr?.on('data', (d) => (stderr += d.toString()));
    child.on('error', (err) =>
      reject(new Error(`Không chạy được "${cmd}": ${err.message}. Cài ffmpeg chưa? (brew install ffmpeg)`))
    );
    child.on('close', (code) =>
      code === 0
        ? resolve(stdout)
        : reject(new Error(stderr.slice(-800) || `${cmd} thoát với mã lỗi ${code}`))
    );
  });
}

function fmtBytes(n: number): string {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${(n / 1024).toFixed(0)} KB`;
}

function assertExists(p: string, what: string): void {
  if (!fs.existsSync(p)) die(`Không thấy ${what}: ${p}`);
}

function aspectDimensions(aspect: Aspect): { width: number; height: number } {
  return aspect === '9:16' ? { width: 720, height: 1280 } : { width: 1280, height: 720 };
}

// ---------------------------------------------------------------- thu thập input

interface Plan {
  files: string[];       // đường dẫn tuyệt đối, ĐÚNG thứ tự ghép
  labels: string[];      // nhãn in ra cho dễ đọc
  defaultOut: string;    // nơi ghi mặc định nếu Mr.D không truyền -o
  aspect: Aspect | null; // aspect lấy được từ job/project (nếu có)
}

function planFromJob(jobId: string): Plan {
  const jobDir = path.resolve('data/livestream', jobId);
  const jsonPath = path.join(jobDir, 'job.json');
  assertExists(jsonPath, `job.json của job "${jobId}"`);

  const job = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as {
    aspectRatio?: Aspect;
    products?: Array<{ segments?: Array<{ id: string; order: number; status: string; videoPath: string | null }> }>;
  };

  const segments = (job.products ?? [])
    .flatMap((p) => p.segments ?? [])
    .sort((a, b) => a.order - b.order);
  if (segments.length === 0) die(`Job "${jobId}" không có đoạn nào trong job.json`);

  const files: string[] = [];
  const labels: string[] = [];
  const skipped: string[] = [];

  for (const s of segments) {
    if (s.status !== 'done' || !s.videoPath) {
      skipped.push(`${s.id} (status=${s.status}, videoPath=${s.videoPath ?? 'null'})`);
      continue;
    }
    const abs = path.resolve(jobDir, s.videoPath);
    if (!fs.existsSync(abs)) {
      // File local đã bị xoá sau lần concat trước (pipeline chỉ giữ bản trên R2).
      skipped.push(`${s.id} (mất file local: ${s.videoPath})`);
      continue;
    }
    files.push(abs);
    labels.push(`#${s.order} ${s.id}`);
  }

  if (skipped.length > 0) {
    console.warn(`⚠️  Bỏ qua ${skipped.length} đoạn:`);
    for (const s of skipped) console.warn(`    - ${s}`);
    console.warn('    (đoạn mất file local chỉ còn bản trên R2 — tải về rồi dùng --files nếu cần ghép đủ)');
  }

  return {
    files,
    labels,
    defaultOut: path.join(jobDir, 'outputs', 'final-manual.mp4'),
    aspect: job.aspectRatio ?? null,
  };
}

function planFromProject(projectId: string): Plan {
  const projDir = path.resolve('data/projects', projectId);
  const jsonPath = path.join(projDir, 'project.json');
  assertExists(jsonPath, `project.json của project "${projectId}"`);

  const project = JSON.parse(fs.readFileSync(jsonPath, 'utf-8')) as {
    aspectRatio?: Aspect;
    script?: { scenes?: Array<{ id: string; order: number; status: string; videoPath: string | null }> };
  };

  const scenes = [...(project.script?.scenes ?? [])].sort((a, b) => a.order - b.order);
  if (scenes.length === 0) die(`Project "${projectId}" không có cảnh nào trong project.json`);

  const files: string[] = [];
  const labels: string[] = [];
  const skipped: string[] = [];

  for (const s of scenes) {
    if (s.status !== 'done' || !s.videoPath) {
      skipped.push(`${s.id} (status=${s.status}, videoPath=${s.videoPath ?? 'null'})`);
      continue;
    }
    const abs = path.resolve(projDir, s.videoPath);
    if (!fs.existsSync(abs)) {
      skipped.push(`${s.id} (mất file local: ${s.videoPath})`);
      continue;
    }
    files.push(abs);
    labels.push(`#${s.order} ${s.id}`);
  }

  if (skipped.length > 0) {
    console.warn(`⚠️  Bỏ qua ${skipped.length} cảnh:`);
    for (const s of skipped) console.warn(`    - ${s}`);
  }

  return {
    files,
    labels,
    defaultOut: path.join(projDir, 'outputs', 'final-manual.mp4'),
    aspect: project.aspectRatio ?? null,
  };
}

function planFromDir(dir: string): Plan {
  const abs = path.resolve(dir);
  assertExists(abs, `thư mục`);
  const entries = fs
    .readdirSync(abs)
    .filter((f) => f.toLowerCase().endsWith('.mp4'))
    // sort theo tên có nhận biết số: 002_x.mp4 đứng trước 010_x.mp4
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  if (entries.length === 0) die(`Thư mục không có file .mp4 nào: ${abs}`);
  return {
    files: entries.map((f) => path.join(abs, f)),
    labels: entries,
    defaultOut: path.join(abs, 'final-manual.mp4'),
    aspect: null,
  };
}

function planFromFiles(list: string[]): Plan {
  const files = list.map((f) => {
    const abs = path.resolve(f);
    assertExists(abs, `file video`);
    return abs;
  });
  return {
    files,
    labels: files.map((f) => path.basename(f)),
    defaultOut: path.resolve('final-manual.mp4'),
    aspect: null,
  };
}

// ---------------------------------------------------------------- main

async function main(): Promise<void> {
  if (flag('help') || argv.length === 0) {
    console.log(fs.readFileSync(__filename, 'utf-8').split('*/')[0].replace(/^\/\*\*|^ \* ?/gm, ''));
    process.exit(0);
  }

  const jobId = opt('--job');
  const projectId = opt('--project');
  const dir = opt('--dir', '-d');
  const fileList = multi('files');

  const chosen = [jobId, projectId, dir, fileList.length > 0 ? 'files' : null].filter(Boolean);
  if (chosen.length === 0) die('Phải chọn 1 nguồn: --job | --project | --dir | --files');
  if (chosen.length > 1) die('Chỉ được chọn 1 nguồn trong: --job | --project | --dir | --files');

  const plan = jobId
    ? planFromJob(jobId)
    : projectId
      ? planFromProject(projectId)
      : dir
        ? planFromDir(dir)
        : planFromFiles(fileList);

  if (plan.files.length === 0) die('Không còn file nào hợp lệ để ghép');

  const aspectArg = opt('--aspect');
  if (aspectArg && aspectArg !== '9:16' && aspectArg !== '16:9') {
    die(`--aspect chỉ nhận 9:16 hoặc 16:9, nhận được: ${aspectArg}`);
  }
  const aspect: Aspect = (aspectArg as Aspect) ?? plan.aspect ?? '9:16';
  const outPath = path.resolve(opt('-o', '--out') ?? plan.defaultOut);
  const copyMode = flag('copy');

  console.log(`\n📋 Sẽ ghép ${plan.files.length} file theo thứ tự:`);
  let totalIn = 0;
  plan.files.forEach((f, i) => {
    const size = fs.statSync(f).size;
    totalIn += size;
    console.log(`   ${String(i + 1).padStart(3, ' ')}. ${plan.labels[i]}  [${fmtBytes(size)}]  ${f}`);
  });
  console.log(`   Tổng input: ${fmtBytes(totalIn)}`);
  console.log(`\n🎬 Aspect : ${aspect} (${aspectDimensions(aspect).width}x${aspectDimensions(aspect).height})`);
  console.log(`💾 Output : ${outPath}`);
  console.log(`⚙️  Chế độ : ${copyMode ? '-c copy (ghép nhanh, KHÔNG encode lại)' : 'encode lại libx264/aac'}`);

  if (flag('dry-run')) {
    console.log('\n🟡 --dry-run: dừng tại đây, chưa chạy ffmpeg.');
    return;
  }

  await fsp.mkdir(path.dirname(outPath), { recursive: true });

  // concat demuxer cần file list; đặt cạnh output để Mr.D xem lại được khi cần điều tra.
  const listPath = path.join(path.dirname(outPath), `.concat-list-${Date.now()}.txt`);
  const listContent = plan.files.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join('\n');
  await fsp.writeFile(listPath, listContent, 'utf-8');

  const { width, height } = aspectDimensions(aspect);
  const ffmpegArgs = copyMode
    ? ['-f', 'concat', '-safe', '0', '-i', listPath, '-c', 'copy', '-movflags', '+faststart', outPath, '-y']
    : [
        '-f', 'concat', '-safe', '0', '-i', listPath,
        '-vf', `scale=${width}:${height}`,
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '22',
        '-c:a', 'aac', '-b:a', '192k',
        '-pix_fmt', 'yuv420p', '-r', '30',
        '-movflags', '+faststart',
        outPath, '-y',
      ];

  console.log(`\n▶️  ffmpeg ${ffmpegArgs.join(' ')}\n`);
  const startedAt = Date.now();
  try {
    await run('ffmpeg', ffmpegArgs);
  } finally {
    await fsp.rm(listPath, { force: true });
  }
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);

  // Verify bằng ffprobe: đủ số liệu để phát hiện video ra bị cụt so với input.
  const probeRaw = await run(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,r_frame_rate:format=duration', '-of', 'json', outPath],
    true
  );
  const probe = JSON.parse(probeRaw) as {
    streams?: Array<{ width: number; height: number; r_frame_rate: string }>;
    format?: { duration: string };
  };
  const st = probe.streams?.[0];
  const [num, den] = (st?.r_frame_rate ?? '30/1').split('/').map(Number);
  const fps = den ? Math.round(num / den) : Math.round(num);
  const durationSec = Number(probe.format?.duration ?? 0);
  const size = fs.statSync(outPath).size;

  console.log(`\n🎉 Xong sau ${elapsed}s`);
  console.log(`   File      : ${outPath}`);
  console.log(`   Dung lượng: ${fmtBytes(size)}`);
  console.log(`   Thời lượng: ${durationSec.toFixed(1)}s (${Math.floor(durationSec / 60)}p${String(Math.round(durationSec % 60)).padStart(2, '0')})`);
  console.log(`   Khung hình: ${st?.width ?? '?'}x${st?.height ?? '?'} @ ${fps}fps`);
}

main().catch((err) => {
  console.error(`\n✗ Lỗi: ${(err as Error).message}`);
  process.exit(1);
});
