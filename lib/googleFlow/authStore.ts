/**
 * Lưu trữ tài khoản Google Flow (multi-account) vào data/flow-auth/accounts.json
 * (thư mục data/ đã bị .gitignore — cookie/accessToken nhạy cảm KHÔNG commit).
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface FlowAccount {
  id: string;
  label: string;
  /** Full Cookie header của labs.google (chứa __Secure-1PSID...). */
  cookie: string;
  /**
   * @deprecated Kiến trúc Bearer + aisandbox-pa.googleapis.com đã bị Google gỡ (2026-09).
   * Giữ field để account cũ đọc lên không mất dữ liệu; không còn code nào gửi nó đi.
   */
  accessToken: string | null;
  accessTokenAt?: number;
  /** XSRF token (WIZ_global_data.SNlM0e) — bắt buộc cho mọi call batchexecute. */
  at?: string | null;
  /** Session id BOQ (WIZ_global_data.FdrFJe) → query f.sid. */
  fsid?: string | null;
  /** Build label (WIZ_global_data.cfb2h) → query bl. Google đổi vài ngày/lần. */
  bl?: string | null;
  /** Base path RPC (WIZ_global_data.Im6cmf), vd /_/AiSandboxAngularFrontend. */
  rpcPath?: string | null;
  /** Origin thu được (https://flow.google.com). */
  origin?: string | null;
  /** Epoch ms lúc thu at — at gắn với phiên, cũ quá thì phải xin lại từ extension. */
  atAt?: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FlowAccountPublic {
  id: string;
  label: string;
  hasCookie: boolean;
  hasAccessToken: boolean;
  hasAt: boolean;
  bl: string | null;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

const ACCOUNTS_PATH = path.join(process.cwd(), 'data', 'flow-auth', 'accounts.json');

function readAll(): FlowAccount[] {
  try {
    const raw = fs.readFileSync(ACCOUNTS_PATH, 'utf-8');
    const data = JSON.parse(raw) as { accounts?: FlowAccount[] };
    return Array.isArray(data.accounts) ? data.accounts : [];
  } catch {
    return [];
  }
}

function writeAll(accounts: FlowAccount[]): void {
  fs.mkdirSync(path.dirname(ACCOUNTS_PATH), { recursive: true });
  const tmp = `${ACCOUNTS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ accounts }, null, 2), 'utf-8');
  fs.renameSync(tmp, ACCOUNTS_PATH);
}

export function listAccounts(): FlowAccount[] {
  return readAll();
}

export function listAccountsPublic(): FlowAccountPublic[] {
  return readAll().map(toPublic);
}

export function toPublic(a: FlowAccount): FlowAccountPublic {
  return {
    id: a.id,
    label: a.label,
    hasCookie: !!a.cookie,
    hasAccessToken: !!a.accessToken,
    hasAt: !!a.at,
    bl: a.bl ?? null,
    isDefault: a.isDefault,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export function getAccount(id: string): FlowAccount | null {
  return readAll().find((a) => a.id === id) || null;
}

/** Tài khoản đang dùng cho generate: default trước, nếu không thì tài khoản đầu tiên. */
export function getActiveAccount(): FlowAccount | null {
  const accounts = readAll();
  if (accounts.length === 0) return null;
  return accounts.find((a) => a.isDefault) || accounts[0];
}

export interface UpsertAccountInput {
  id?: string;
  label: string;
  cookie: string;
  accessToken?: string | null;
  at?: string | null;
  fsid?: string | null;
  bl?: string | null;
  rpcPath?: string | null;
  origin?: string | null;
  isDefault?: boolean;
}

/**
 * Gán các field batchexecute lên account. Chỉ ghi đè khi input thực sự mang giá trị:
 * refresh session một phần (vd trang chưa kịp lộ cfb2h) không được xoá `bl` đang dùng tốt.
 */
function applyFlowFields(target: FlowAccount, input: UpsertAccountInput): void {
  if (input.at) {
    target.at = input.at;
    target.atAt = Date.now();
  }
  if (input.fsid) target.fsid = input.fsid;
  if (input.bl) target.bl = input.bl;
  if (input.rpcPath) target.rpcPath = input.rpcPath;
  if (input.origin) target.origin = input.origin;
}

export function upsertAccount(input: UpsertAccountInput): FlowAccount {
  const accounts = readAll();
  const now = new Date().toISOString();
  // Khớp theo id, hoặc (khi không có id) theo label để session refresh không tạo mới liên tục.
  const existing = input.id
    ? accounts.find((a) => a.id === input.id)
    : accounts.find((a) => input.label && a.label === input.label);

  if (existing) {
    existing.label = input.label || existing.label;
    if (input.cookie) existing.cookie = input.cookie;
    if (input.accessToken !== undefined) existing.accessToken = input.accessToken || null;
    applyFlowFields(existing, input);
    if (input.isDefault !== undefined) existing.isDefault = input.isDefault;
    existing.updatedAt = now;
    if (existing.isDefault) {
      for (const a of accounts) if (a.id !== existing.id) a.isDefault = false;
    }
    writeAll(accounts);
    return existing;
  }

  const isDefault = input.isDefault ?? accounts.length === 0;
  const account: FlowAccount = {
    id: input.id || `acc-${crypto.randomBytes(4).toString('hex')}`,
    label: input.label || 'Tài khoản Google Flow',
    cookie: input.cookie,
    accessToken: input.accessToken ?? null,
    isDefault,
    createdAt: now,
    updatedAt: now,
  };
  applyFlowFields(account, input);
  if (isDefault) {
    for (const a of accounts) a.isDefault = false;
  }
  accounts.push(account);
  writeAll(accounts);
  return account;
}

export function deleteAccount(id: string): boolean {
  const accounts = readAll();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx === -1) return false;
  const [removed] = accounts.splice(idx, 1);
  // Nếu xoá tài khoản default, gán default cho tài khoản đầu tiên còn lại.
  if (removed.isDefault && accounts.length > 0) accounts[0].isDefault = true;
  writeAll(accounts);
  return true;
}

export function setDefaultAccount(id: string): FlowAccount | null {
  const accounts = readAll();
  const target = accounts.find((a) => a.id === id);
  if (!target) return null;
  for (const a of accounts) a.isDefault = a.id === id;
  const now = new Date().toISOString();
  target.updatedAt = now;
  writeAll(accounts);
  return target;
}

/** Cập nhật accessToken (không đổi cookie) — gọi khi refresh access token thành công. */
export function updateAccessToken(id: string, accessToken: string | null): void {
  const accounts = readAll();
  const a = accounts.find((x) => x.id === id);
  if (!a) return;
  a.accessToken = accessToken;
  a.accessTokenAt = accessToken ? Date.now() : undefined;
  a.updatedAt = new Date().toISOString();
  writeAll(accounts);
}

/** Credential đủ để gọi batchexecute. */
export interface FlowBatchCreds {
  cookie: string;
  at: string;
  fsid: string | null;
  bl: string | null;
  rpcPath: string;
  origin: string;
}

/**
 * Rút credential batchexecute từ account, hoặc trả lý do vì sao chưa dùng được.
 * Trả { creds } | { error } thay vì throw để caller (route status / client) chọn cách báo.
 */
export function batchCredsOf(a: FlowAccount): { creds: FlowBatchCreds } | { error: string } {
  if (!a.cookie) return { error: `Tài khoản "${a.label}" chưa có cookie — bấm gửi session từ extension.` };
  if (!a.at) {
    return {
      error:
        `Tài khoản "${a.label}" chưa có at token (WIZ_global_data.SNlM0e). Google đã bỏ ` +
        `kiến trúc access_token cũ; mở tab https://flow.google.com đã đăng nhập rồi bấm ` +
        `gửi session ở popup extension (bản 2.0.0 trở lên).`,
    };
  }
  return {
    creds: {
      cookie: a.cookie,
      at: a.at,
      fsid: a.fsid ?? null,
      bl: a.bl ?? null,
      rpcPath: a.rpcPath || '/_/AiSandboxAngularFrontend',
      origin: a.origin || 'https://flow.google.com',
    },
  };
}
