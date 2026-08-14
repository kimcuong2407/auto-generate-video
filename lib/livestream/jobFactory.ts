import { slugify } from './paths';
import type {
  IngestStatus,
  LivestreamChaining,
  LivestreamJob,
  LivestreamProduct,
  ProductSourceType,
} from './types';
import type { VeoModel } from '../types';

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
    spokespersonImagePath: null,
    scriptStatus: 'idle',
    scriptError: null,
    segments: [],
  };
}

export function createNewJob(input: {
  id: string;
  name: string;
  aspectRatio: '9:16' | '16:9';
  veoModel: VeoModel;
  chaining: LivestreamChaining;
  products: LivestreamProduct[];
}): LivestreamJob {
  const now = new Date().toISOString();
  return {
    id: input.id,
    name: input.name,
    createdAt: now,
    updatedAt: now,
    aspectRatio: input.aspectRatio,
    veoModel: input.veoModel,
    chaining: input.chaining,
    status: 'draft',
    products: input.products,
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
  };
}
