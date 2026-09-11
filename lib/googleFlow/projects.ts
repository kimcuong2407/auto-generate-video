/**
 * Tạo Flow project qua batchexecute trên flow.google.com.
 *
 * LỊCH SỬ (2026-09-11): trước đây file này gọi POST labs.google/fx/api/trpc/project.createProject.
 * Google đã gỡ endpoint đó — probe thật với cookie CÒN HIỆU LỰC (cùng cookie mà
 * GET flow.google.com/ trả 200 kèm SNlM0e, không có link signin) vẫn nhận:
 *   401 {"error":{"json":{"message":"UNAUTHORIZED","code":-32001,
 *        "data":{"code":"UNAUTHORIZED","httpStatus":401,"path":"project.createProject"}}}}
 * và labs.google/fx/* nay 308 redirect sang flow.google.com/. Tức 401 ở đây KHÔNG phải phiên
 * chết, mà là endpoint đã biến mất — triệu chứng nhìn từ ngoài giống hệt nhau nên
 * resolveFlowProjectIdSafe đổ nhầm cho "cookie hết hạn" suốt, gửi lại session bao nhiêu lần
 * cũng vô ích.
 *
 * Đường mới đọc từ docs/create-project-flow.google.com.har (2026-09-11), đã gọi thật và
 * nhận 200 + projectId. Cùng kiến trúc với flowRpc.ts: cookie + `at`, payload là MẢNG LỒNG
 * không tên trường.
 */

import { batchExecute } from './client';
import { FlowApiError } from './errors';
import { flowCredsOf } from './recaptcha';
import type { FlowAccount } from './authStore';

export interface CreateProjectResult {
  id: string;
  title: string;
}

/** rpcid tạo project, quan sát trong HAR 2026-09-11. */
export const RPC_CREATE_PROJECT = 'jHPbke';

/**
 * Hằng `22` ở [1] của phần tử cuối — cùng giá trị CLIENT_TOOL_CODE của flowRpc.ts
 * (mã tool PINHOLE). Lặp lại y hệt trong maseQ, eb1hJf và jHPbke của HAR.
 */
const CLIENT_TOOL_CODE = 22;

/**
 * Payload HAR: ["projects/*",[null,["<title>"]],[null,22]]
 *
 * Title nằm LỒNG HAI LỚP ([1][1][0]), không phải chuỗi phẳng ở [1] — đặt sai lớp thì Google
 * vẫn trả 200 nhưng project mang tên rỗng, và không có lỗi nào chỉ ra chỗ hỏng.
 */
export function buildCreateProjectPayload(title: string): unknown[] {
  return ['projects/*', [null, [title]], [null, CLIENT_TOOL_CODE]];
}

/**
 * Response HAR: ["<projectId>",["<title>"]] — id ở [0], title ở [1][0].
 */
export function parseCreateProjectResponse(res: unknown, fallbackTitle: string): CreateProjectResult {
  const id = Array.isArray(res) ? res[0] : null;
  if (typeof id !== 'string' || !id) {
    throw new FlowApiError(
      `Tạo Flow project (${RPC_CREATE_PROJECT}) không trả về projectId. Response: ${JSON.stringify(res).slice(0, 300)}`
    );
  }
  const titleNode = Array.isArray(res) && Array.isArray(res[1]) ? res[1][0] : null;
  return { id, title: typeof titleNode === 'string' && titleNode ? titleNode : fallbackTitle };
}

/** Tạo project mới trên Flow → trả projectId. */
export async function createProject(account: FlowAccount, title: string): Promise<CreateProjectResult> {
  const res = await batchExecute(RPC_CREATE_PROJECT, buildCreateProjectPayload(title), {
    creds: flowCredsOf(account),
  });
  return parseCreateProjectResponse(res, title);
}
