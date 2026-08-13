import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { DATA_ROOT, DEFAULT_STORYBOARD_MODEL } from '../constants';
import { projectDir, projectJsonPath, assertValidProjectId } from '../paths';
import type { Project, ProjectSummary } from '../types';

// Chain các thao tác đọc-sửa-ghi trên cùng 1 project-id để tránh lost-update
// khi nhiều request (poll, generate, patch script...) chồng nhau.
const writeQueues = new Map<string, Promise<void>>();

function enqueue<T>(projectId: string, task: () => Promise<T>): Promise<T> {
  const prev = writeQueues.get(projectId) || Promise.resolve();
  const result = prev.then(task, task);
  const settled = result.then(
    () => undefined,
    () => undefined
  );
  writeQueues.set(projectId, settled);
  return result;
}

export async function readProject(projectId: string): Promise<Project> {
  assertValidProjectId(projectId);
  const raw = await fs.readFile(projectJsonPath(projectId), 'utf-8');
  const project = JSON.parse(raw) as Project;
  // Backfill cho project cũ tạo trước khi có tính năng chain khung hình giữa các cảnh.
  if (project.sceneChaining === undefined) {
    project.sceneChaining = true;
  }
  // Backfill cho project cũ tạo trước khi có tuỳ chọn tắt text overlay khi ghép video.
  if (project.burnOnScreenText === undefined) {
    project.burnOnScreenText = false;
  }
  for (const scene of project.script?.scenes || []) {
    if (scene.lastFramePath === undefined) scene.lastFramePath = null;
    if (scene.chainedFromPrevious === undefined) scene.chainedFromPrevious = false;
  }
  // Backfill cho project cũ tạo trước khi có tính năng Storyboard ảnh (Bước 2).
  if (!project.storyboard) {
    project.storyboard = {
      model: DEFAULT_STORYBOARD_MODEL,
      useProductReference: true,
      useSpokespersonReference: true,
      images: (project.template?.scenes || []).map((s, i) => ({
        sceneId: s.id,
        order: i + 1,
        prompt: '',
        imagePath: null,
        status: 'idle' as const,
        error: null,
        attempts: 0,
        lastUpdatedAt: null,
      })),
      backgrounds: [],
    };
  }
  // Backfill cho project cũ tạo trước khi có checkbox riêng cho ảnh tham chiếu nhân vật ở storyboard.
  if (project.storyboard.useSpokespersonReference === undefined) {
    project.storyboard.useSpokespersonReference = true;
  }
  // Backfill cho project cũ tạo trước khi có tính năng ảnh background riêng / scene.
  if (!project.storyboard.backgrounds) {
    project.storyboard.backgrounds = project.storyboard.images.map((img) => ({
      sceneId: img.sceneId,
      order: img.order,
      prompt: '',
      imagePath: null,
      status: 'idle' as const,
      error: null,
      attempts: 0,
      lastUpdatedAt: null,
    }));
  }
  return project;
}

export function projectExists(projectId: string): boolean {
  try {
    assertValidProjectId(projectId);
  } catch {
    return false;
  }
  return existsSync(projectJsonPath(projectId));
}

async function writeProjectRaw(project: Project): Promise<void> {
  project.updatedAt = new Date().toISOString();
  const jsonPath = projectJsonPath(project.id);
  const tmpPath = `${jsonPath}.tmp`;
  await fs.writeFile(tmpPath, JSON.stringify(project, null, 2), 'utf-8');
  await fs.rename(tmpPath, jsonPath);
}

export async function writeProject(project: Project): Promise<void> {
  return enqueue(project.id, () => writeProjectRaw(project));
}

/**
 * Đọc → sửa → ghi trong 1 thao tác nguyên tử (theo hàng đợi của project-id đó).
 */
export async function updateProject<T = void>(
  projectId: string,
  mutator: (project: Project) => T | Promise<T>
): Promise<{ project: Project; result: T }> {
  return enqueue(projectId, async () => {
    const project = await readProject(projectId);
    const result = await mutator(project);
    await writeProjectRaw(project);
    return { project, result };
  });
}

export async function ensureDataRoot(): Promise<void> {
  await fs.mkdir(DATA_ROOT, { recursive: true });
}

export async function listProjects(): Promise<ProjectSummary[]> {
  await ensureDataRoot();
  const entries = await fs.readdir(DATA_ROOT, { withFileTypes: true });
  const summaries: ProjectSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const project = await readProject(entry.name);
      summaries.push({
        id: project.id,
        name: project.name,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        currentStep: project.currentStep,
        aspectRatio: project.aspectRatio,
        productName: project.product.name,
        scriptAngleId: project.scriptAngleId,
        sceneCount: project.script.scenes.length,
        promptReadyCount: project.script.scenes.filter((s) => s.veoPrompt.trim().length > 0).length,
        hasGeneratingScene: project.script.scenes.some((s) => s.status === 'generating'),
      });
    } catch {
      // bỏ qua thư mục hỏng/không phải project hợp lệ
    }
  }
  summaries.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  return summaries;
}

export async function createProjectDirs(projectId: string): Promise<void> {
  const dir = projectDir(projectId);
  await fs.mkdir(path.join(dir, 'inputs'), { recursive: true });
  await fs.mkdir(path.join(dir, 'outputs', 'scenes'), { recursive: true });
  await fs.mkdir(path.join(dir, 'outputs', 'tmp'), { recursive: true });
  await fs.mkdir(path.join(dir, 'outputs', 'frames'), { recursive: true });
  await fs.mkdir(path.join(dir, 'outputs', 'storyboard'), { recursive: true });
  await fs.mkdir(path.join(dir, 'outputs', 'backgrounds'), { recursive: true });
}
