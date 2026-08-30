import { slugify } from './paths';
import type {
  IngestStatus,
  LivestreamChaining,
  LivestreamJob,
  LivestreamProduct,
  ProductSourceType,
} from './types';
import type { VeoModel } from '../types';
import { DEFAULT_STORYBOARD_MODEL } from '../constants';

let productCounter = 0;

export function buildProduct(fields: {
  order: number;
  sourceType: ProductSourceType;
  sourceLink?: string | null;
  sourceFilePath?: string | null;
  rawText?: string | null;
  ingestStatus: IngestStatus;
  ingestError?: string | null;
  name?: string;
  description?: string;
  targetDurationSec: number;
}): LivestreamProduct {
  productCounter += 1;
  const idBase = slugify(fields.name || `prod-${fields.order}`).slice(0, 30) || `prod-${fields.order}`;
  return {
    id: `${idBase}-${productCounter}`,
    order: fields.order,
    sourceType: fields.sourceType,
    sourceLink: fields.sourceLink ?? null,
    sourceFilePath: fields.sourceFilePath ?? null,
    rawText: fields.rawText ?? null,
    ingestStatus: fields.ingestStatus,
    ingestError: fields.ingestError ?? null,
    name: fields.name || `Sản phẩm ${fields.order}`,
    description: fields.description || '',
    targetDurationSec: fields.targetDurationSec,
    scriptStatus: 'idle',
    scriptError: null,
    segments: [],
  };
}

export function createNewJob(input: {
  slug: string;
  name: string;
  aspectRatio: '9:16' | '16:9';
  veoModel: VeoModel;
  chaining: LivestreamChaining;
  products: LivestreamProduct[];
}): LivestreamJob {
  const now = new Date().toISOString();
  return {
    id: input.slug,
    slug: input.slug,
    name: input.name,
    createdAt: now,
    updatedAt: now,
    aspectRatio: input.aspectRatio,
    veoModel: input.veoModel,
    chaining: input.chaining,
    status: 'draft',
    products: input.products,
    // Bộ ảnh CHUNG cả job — khởi tạo rỗng; người dùng upload/chọn ở đầu trang (JobImagePanel).
    spokespersonImagePaths: [],
    selectedRefImagePaths: [],
    selectedModelImagePath: null,
    backgroundImagePaths: [],
    selectedBackgroundImagePath: null,
    detachedImagePaths: [],
    backgroundModel: DEFAULT_STORYBOARD_MODEL,
    imageR2Urls: {},
    flowMediaIds: {},
    concat: {
      status: 'idle',
      log: [],
      outputPath: null,
      outputUrl: null,
      outputMeta: null,
      error: null,
      startedAt: null,
      finishedAt: null,
    },
    flowStatusCache: {
      flowConnected: null,
      geminiConnected: null,
      projectsError: null,
      checkedAt: null,
    },
    flowProjectId: null,
    scriptSystemPromptOverride: null,
    backgroundPromptOverride: null,
    backgroundRefPaths: [],
    scriptRefPaths: [],
    videoRefPaths: [],
    videoSeed: null,
    stageBible: null,
    productLock: null,
  };
}
