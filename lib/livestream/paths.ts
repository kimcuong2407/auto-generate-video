import path from 'node:path';
import crypto from 'node:crypto';
import { slugify } from '../paths';
import { LIVESTREAM_DATA_ROOT, LIVESTREAM_JOB_ID_REGEX } from './constants';

export { slugify } from '../paths';

export function generateJobSlug(name: string): string {
  const base = slugify(name).slice(0, 40);
  const suffix = crypto.randomBytes(4).toString('hex').slice(0, 6);
  return `${base}-${suffix}`;
}

export function assertValidJobId(slug: string): void {
  if (!LIVESTREAM_JOB_ID_REGEX.test(slug)) {
    throw new Error(`Job id không hợp lệ: ${slug}`);
  }
}

export function jobDir(slug: string): string {
  assertValidJobId(slug);
  return path.join(LIVESTREAM_DATA_ROOT, slug);
}

export function jobJsonPath(slug: string): string {
  return path.join(jobDir(slug), 'job.json');
}

export function jobInputsDir(slug: string): string {
  return path.join(jobDir(slug), 'inputs');
}

export function jobOutputsDir(slug: string): string {
  return path.join(jobDir(slug), 'outputs');
}

export function jobSegmentsDir(slug: string): string {
  return path.join(jobOutputsDir(slug), 'segments');
}

export function jobFramesDir(slug: string): string {
  return path.join(jobOutputsDir(slug), 'frames');
}

export function jobTmpDir(slug: string): string {
  return path.join(jobOutputsDir(slug), 'tmp');
}

/**
 * Resolve 1 đường dẫn tương đối bên trong job dir, chặn path traversal.
 * Trả về đường dẫn tuyệt đối nếu hợp lệ, throw nếu không.
 */
export function resolveWithinJob(slug: string, relPath: string): string {
  const base = jobDir(slug);
  const normalized = path.normalize(relPath).replace(/^([.]{2}[/\\])+/, '');
  const resolved = path.resolve(base, normalized);
  const baseWithSep = base.endsWith(path.sep) ? base : base + path.sep;
  if (!resolved.startsWith(baseWithSep) && resolved !== base) {
    throw new Error('Đường dẫn không hợp lệ (path traversal bị chặn)');
  }
  return resolved;
}
