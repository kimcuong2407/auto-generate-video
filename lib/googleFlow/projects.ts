/**
 * Project/entity tRPC endpoints trên labs.google (auth = cookie).
 */

import { labsRequest, readJson } from './client';
import { FlowApiError } from './errors';

export interface CreateProjectResult {
  id: string;
  title: string;
}

/** POST /fx/api/trpc/project.createProject → trả projectId. */
export async function createProject(cookie: string, title: string): Promise<CreateProjectResult> {
  const res = await labsRequest('/fx/api/trpc/project.createProject', {
    cookie,
    json: { json: { projectTitle: title, toolName: 'PINHOLE' } },
  });
  const data = await readJson<{
    result?: { data?: { json?: { result?: { projectId?: string; projectTitle?: string } } } };
  }>(res);
  const result = data.result?.data?.json?.result;
  if (!result?.projectId) {
    throw new FlowApiError('createProject không trả về projectId');
  }
  return { id: result.projectId, title: result.projectTitle || title };
}

/** GET /fx/api/trpc/flow.projectInitialData?input=... → snapshot project. */
export async function getProjectData(cookie: string, projectId: string): Promise<unknown> {
  const input = encodeURIComponent(JSON.stringify({ json: { projectId } }));
  const res = await labsRequest(`/fx/api/trpc/flow.projectInitialData?input=${input}`, { cookie });
  return readJson(res);
}
