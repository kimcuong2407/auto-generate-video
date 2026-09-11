/**
 * Dựng điều kiện WHERE dùng chung cho 2 bảng log + 3 đường (đọc danh sách, đếm thử, xoá).
 *
 * Dùng chung là bắt buộc, không phải tiện tay: nếu đường đếm thử và đường xoá dựng điều kiện
 * riêng, số hiện trong hộp xác nhận sẽ khác số thực xoá — và xác nhận kiểu đó là xác nhận giả.
 */
import { and, eq, gte, inArray, lte, or, sql, type SQL } from 'drizzle-orm';
import { aiCallLogs } from '../db/schema/aiCallLogs';
import { flowJobLogs } from '../db/schema/flowJobLogs';
import type { LogFilters } from './filters';

export type LogTable = 'ai' | 'flow';

/**
 * Danh sách điều kiện cho bảng log AI. Trả mảng (có thể rỗng) để caller tự quyết định ghép thế
 * nào — mảng rỗng nghĩa là "không thu hẹp gì", và chính caller xoá phải từ chối ca đó.
 */
export function aiLogConditions(f: LogFilters): SQL[] {
  const c: SQL[] = [];
  if (f.sourceKinds.length > 0) c.push(inArray(aiCallLogs.sourceKind, f.sourceKinds));
  if (f.steps.length > 0) c.push(inArray(aiCallLogs.stepKey, f.steps));
  if (f.model) c.push(eq(aiCallLogs.model, f.model));
  // Một ô nhập tra CẢ hai cột: Mr.D không phải nhớ id nào là job slug, id nào là project.
  if (f.owner) {
    c.push(or(eq(aiCallLogs.jobSlug, f.owner), eq(aiCallLogs.projectId, f.owner))!);
  }
  if (f.status === 'ok') c.push(sql`${aiCallLogs.errorMessage} IS NULL`);
  if (f.status === 'error') c.push(sql`${aiCallLogs.errorMessage} IS NOT NULL`);
  if (f.fromUtc) c.push(gte(aiCallLogs.createdAt, f.fromUtc));
  if (f.toUtc) c.push(lte(aiCallLogs.createdAt, f.toUtc));
  return c;
}

/** Như trên nhưng cho bảng log gen video. Thêm errorKind (quota/mcp/api). */
export function flowLogConditions(f: LogFilters): SQL[] {
  const c: SQL[] = [];
  if (f.sourceKinds.length > 0) c.push(inArray(flowJobLogs.sourceKind, f.sourceKinds));
  if (f.model) c.push(eq(flowJobLogs.model, f.model));
  if (f.owner) {
    c.push(or(eq(flowJobLogs.jobSlug, f.owner), eq(flowJobLogs.projectId, f.owner))!);
  }
  if (f.status === 'ok') c.push(sql`${flowJobLogs.errorMessage} IS NULL`);
  if (f.status === 'error') c.push(sql`${flowJobLogs.errorMessage} IS NOT NULL`);
  if (f.errorKind) c.push(eq(flowJobLogs.errorKind, f.errorKind));
  if (f.fromUtc) c.push(gte(flowJobLogs.createdAt, f.fromUtc));
  if (f.toUtc) c.push(lte(flowJobLogs.createdAt, f.toUtc));
  return c;
}

export function conditionsFor(table: LogTable, f: LogFilters): SQL[] {
  return table === 'ai' ? aiLogConditions(f) : flowLogConditions(f);
}

/** Ghép mảng điều kiện thành 1 SQL. undefined = không điều kiện (chỉ hợp lệ cho đường ĐỌC). */
export function whereOf(conditions: SQL[]): SQL | undefined {
  if (conditions.length === 0) return undefined;
  return conditions.length === 1 ? conditions[0] : and(...conditions);
}
