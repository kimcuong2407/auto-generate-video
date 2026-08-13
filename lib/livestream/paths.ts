import path from 'node:path';
import crypto from 'node:crypto';
import { slugify } from '../paths';
import { LIVESTREAM_DATA_ROOT, LIVESTREAM_JOB_ID_REGEX } from './constants';

export { slugify } from '../paths';

export function generateJobId(name: string): string {
  const base = slugify(name).slice(0, 40);
  const suffix = crypto.randomBytes(4).toString('hex').slice(0, 6);
  return `${base}-${suffix}`;
}

export function assertValidJobId(id: string): void {
  if (!LIVESTREAM_JOB_ID_REGEX.test(id)) {
    throw new Error(`Job id không hợp lệ: ${id}`);
  }
}

export function jobDir(id: string): string {
  assertValidJobId(id);
  return path.join(LIVESTREAM_DATA_ROOT, id);
}

export function jobJsonPath(id: string): string {
  return path.join(jobDir(id), 'job.json');
}

export function jobInputsDir(id: string): string {
  return path.join(jobDir(id), 'inputs');
}

export function jobOutputsDir(id: string): string {
  return path.join(jobDir(id), 'outputs');
}

export function jobSegmentsDir(id: string): string {
  return path.join(jobOutputsDir(id), 'segments');
}

export function jobFramesDir(id: string): string {
  return path.join(jobOutputsDir(id), 'frames');
}

export function jobTmpDir(id: string): string {
  return path.join(jobOutputsDir(id), 'tmp');
}

/**
 * Resolve 1 đường dẫn tương đối bên trong job dir, chặn path traversal.
 * Trả về đường dẫn tuyệt đối nếu hợp lệ, throw nếu không.
 */
export function resolveWithinJob(id: string, relPath: string): string {
  const base = jobDir(id);
  const normalized = path.normalize(relPath).replace(/^([.]{2}[/\\])+/, '');
  const resolved = path.resolve(base, normalized);
  const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
  if (!resolved.startsWith(baseWithSep) && resolved !== base) {
    throw new Error('Đường dẫn không hợp lệ (path traversal bị chặn)');
  }
  return resolved;
}
