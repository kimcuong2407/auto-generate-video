import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_ROOT, PROJECT_ID_REGEX } from './constants';

export function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'project';
}

export function generateProjectId(name: string): string {
  const base = slugify(name).slice(0, 40);
  const suffix = crypto.randomBytes(4).toString('hex').slice(0, 6);
  return `${base}-${suffix}`;
}

export function assertValidProjectId(id: string): void {
  if (!PROJECT_ID_REGEX.test(id)) {
    throw new Error(`Project id không hợp lệ: ${id}`);
  }
}

export function projectDir(id: string): string {
  assertValidProjectId(id);
  return path.join(DATA_ROOT, id);
}

export function projectJsonPath(id: string): string {
  return path.join(projectDir(id), 'project.json');
}

export function projectInputsDir(id: string): string {
  return path.join(projectDir(id), 'inputs');
}

export function projectOutputsDir(id: string): string {
  return path.join(projectDir(id), 'outputs');
}

export function projectScenesDir(id: string): string {
  return path.join(projectOutputsDir(id), 'scenes');
}

export function projectTmpDir(id: string): string {
  return path.join(projectOutputsDir(id), 'tmp');
}

export function projectFramesDir(id: string): string {
  return path.join(projectOutputsDir(id), 'frames');
}

export function projectStoryboardDir(id: string): string {
  return path.join(projectOutputsDir(id), 'storyboard');
}

export function projectBackgroundsDir(id: string): string {
  return path.join(projectOutputsDir(id), 'backgrounds');
}

/**
 * Resolve 1 đường dẫn tương đối bên trong project, chặn path traversal.
 * Trả về đường dẫn tuyệt đối nếu hợp lệ, throw nếu không.
 */
export function resolveWithinProject(id: string, relPath: string): string {
  const base = projectDir(id);
  const normalized = path.normalize(relPath).replace(/^([.]{2}[/\\])+/, '');
  const resolved = path.resolve(base, normalized);
  const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
  if (!resolved.startsWith(baseWithSep) && resolved !== base) {
    throw new Error('Đường dẫn không hợp lệ (path traversal bị chặn)');
  }
  return resolved;
}
