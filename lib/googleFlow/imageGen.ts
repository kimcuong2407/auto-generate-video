/**
 * Sinh ảnh qua batchGenerateImages (aisandbox-pa.googleapis.com).
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { apiRequest, readJson, RECAPTCHA_ACTION_IMAGE } from './client';
import { acquireRecaptchaContext } from './recaptcha';
import { uploadImageFile } from './upload';
import { downloadUrlTo } from './download';
import { FlowApiError } from './errors';
import type { FlowAccount } from './authStore';
import type { RefImageInput } from './videoGen';

export type ImageAspect = '16:9' | '9:16' | '1:1' | '3:4' | '4:3';

const ASPECT_MAP: Record<ImageAspect, string> = {
  '16:9': 'IMAGE_ASPECT_RATIO_LANDSCAPE',
  '9:16': 'IMAGE_ASPECT_RATIO_PORTRAIT',
  '1:1': 'IMAGE_ASPECT_RATIO_SQUARE',
  '3:4': 'IMAGE_ASPECT_RATIO_PORTRAIT_THREE_FOUR',
  '4:3': 'IMAGE_ASPECT_RATIO_LANDSCAPE_FOUR_THREE',
};

const KNOWN_IMAGE_MODELS = ['flow-image', 'HARBOR_SEAL', 'GEM_PIX_2', 'NARWHAL'];

/** Model ảnh mặc định của Google Flow (batchGenerateImages). */
function resolveImageModel(model?: string): string {
  if (model && KNOWN_IMAGE_MODELS.includes(model) && model !== 'flow-image') return model;
  return 'NARWHAL';
}

export interface GenerateImageParams {
  account: FlowAccount;
  accessToken: string;
  prompt: string;
  aspect: ImageAspect;
  model?: string;
  projectId: string;
  refImages?: RefImageInput[];
  count?: number;
}

export interface GenerateImageResult {
  dir: string;
  paths: string[];
  uploadedMediaIds: Record<string, string>;
}

const TMP_DIR = path.join(process.cwd(), 'data', 'tmp', 'flow-image');

/**
 * Sinh ảnh (đồng bộ). Upload ref images, gọi batchGenerateImages, tải các ảnh kết
 * quả về thư mục tmp rồi trả đường dẫn tuyệt đối.
 */
export async function generateImage(params: GenerateImageParams): Promise<GenerateImageResult> {
  const imageAspectRatio = ASPECT_MAP[params.aspect] ?? ASPECT_MAP['16:9'];
  const imageInputs: Array<{ imageInputType: string; name: string }> = [];
  const uploadedMediaIds: Record<string, string> = {};

  for (const ref of params.refImages || []) {
    const mediaId =
      ref.mediaId ?? (await uploadImageFile(params.accessToken, params.projectId, ref.path));
    if (!ref.mediaId) uploadedMediaIds[ref.path] = mediaId;
    imageInputs.push({ imageInputType: 'IMAGE_INPUT_TYPE_REFERENCE', name: mediaId });
  }

  const recaptchaContext = await acquireRecaptchaContext(params.account.id, RECAPTCHA_ACTION_IMAGE);
  const sessionId = `;${Date.now()}`;
  const batchId = crypto.randomUUID();

  const body = {
    clientContext: {
      ...recaptchaContext,
      projectId: params.projectId,
      tool: 'PINHOLE',
      sessionId,
    },
    mediaGenerationContext: { batchId },
    useNewMedia: true,
    requests: [
      {
        clientContext: {
          ...recaptchaContext,
          projectId: params.projectId,
          tool: 'PINHOLE',
          sessionId,
        },
        imageModelName: resolveImageModel(params.model),
        imageAspectRatio,
        structuredPrompt: { parts: [{ text: params.prompt }] },
        seed: Math.floor(Math.random() * 1_000_000),
        imageInputs,
      },
    ],
  };

  const res = await apiRequest(`/v1/projects/${params.projectId}/flowMedia:batchGenerateImages`, {
    accessToken: params.accessToken,
    json: body,
    timeoutMs: 10 * 60_000,
  });

  const data = await readJson<{
    media?: Array<{ name?: string; image?: { generatedImage?: { fifeUrl?: string } } }>;
  }>(res);

  const urls = (data.media || [])
    .map((m) => m.image?.generatedImage?.fifeUrl)
    .filter((u): u is string => !!u);

  if (urls.length === 0) {
    throw new FlowApiError('batchGenerateImages không trả về ảnh nào');
  }

  await fs.mkdir(TMP_DIR, { recursive: true });
  const paths: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    const dest = path.join(TMP_DIR, `img-${crypto.randomBytes(6).toString('hex')}-${i}.png`);
    await downloadUrlTo(urls[i], dest);
    paths.push(dest);
  }

  return { dir: TMP_DIR, paths, uploadedMediaIds };
}
