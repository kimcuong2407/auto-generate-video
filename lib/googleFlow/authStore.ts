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
  /** access_token từ GET /fx/api/auth/session. Có thể null, sẽ tự refresh. */
  accessToken: string | null;
  /** Epoch ms lúc lấy accessToken — dùng để refresh trước khi Google hết hạn (~1h). */
  accessTokenAt?: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface FlowAccountPublic {
  id: string;
  label: string;
  hasCookie: boolean;
  hasAccessToken: boolean;
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
  isDefault?: boolean;
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
