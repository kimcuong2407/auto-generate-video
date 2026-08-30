/**
 * Lưu tài khoản ChatGPT web (multi-account) vào data/chatgpt-auth/accounts.json —
 * cùng pattern lib/googleFlow/authStore.ts (data/ đã .gitignore).
 *
 * Khác Google Flow ở chỗ QUAN TRỌNG: ở đây KHÔNG lưu cookie/token trong JSON. Credential
 * thật nằm trong thư mục profile Playwright (data/chatgpt-profiles/<id>/) do Chromium tự
 * quản lý — file này chỉ giữ metadata trỏ tới profile đó. Lý do: ChatGPT dùng nhiều lớp
 * storage (cookie HttpOnly + localStorage + IndexedDB), copy tay từng cookie như Flow là
 * không đủ để giữ phiên.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface ChatgptAccount {
  id: string;
  label: string;
  /**
   * Phiên còn sống hay đã bị ChatGPT đá ra. Đặt false khi automation gặp màn hình login
   * (xem runner.ts) — worker sẽ bỏ qua account này thay vì retry vô ích tới hết timeout.
   */
  connected: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
  /** Thời điểm gen ảnh thành công gần nhất — để Mr.D biết account nào còn thật sự dùng được. */
  lastOkAt?: string | null;
  /** Lỗi khiến connected bị tắt, hiển thị ở UI Cài đặt để biết cần login lại. */
  lastError?: string | null;
}

const ACCOUNTS_PATH = path.join(process.cwd(), 'data', 'chatgpt-auth', 'accounts.json');
const PROFILES_DIR = path.join(process.cwd(), 'data', 'chatgpt-profiles');

/** Thư mục userDataDir Playwright của 1 account — nơi Chromium giữ cookie/localStorage. */
export function profileDir(accountId: string): string {
  return path.join(PROFILES_DIR, accountId);
}

function readAll(): ChatgptAccount[] {
  try {
    const raw = fs.readFileSync(ACCOUNTS_PATH, 'utf-8');
    const data = JSON.parse(raw) as { accounts?: ChatgptAccount[] };
    return Array.isArray(data.accounts) ? data.accounts : [];
  } catch {
    return [];
  }
}

function writeAll(accounts: ChatgptAccount[]): void {
  fs.mkdirSync(path.dirname(ACCOUNTS_PATH), { recursive: true });
  const tmp = `${ACCOUNTS_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ accounts }, null, 2), 'utf-8');
  fs.renameSync(tmp, ACCOUNTS_PATH);
}

export function listAccounts(): ChatgptAccount[] {
  return readAll();
}

export function getAccount(id: string): ChatgptAccount | null {
  return readAll().find((a) => a.id === id) || null;
}

/**
 * Account dùng để gen: chỉ xét account còn `connected` VÀ profile còn tồn tại trên đĩa
 * (deploy sang VPS mới mà quên copy profile → thư mục trống, phải coi như chưa login chứ
 * không để Playwright mở profile rỗng rồi chết ở bước chờ composer).
 */
export function getActiveAccount(): ChatgptAccount | null {
  const usable = readAll().filter((a) => a.connected && fs.existsSync(profileDir(a.id)));
  if (usable.length === 0) return null;
  return usable.find((a) => a.isDefault) || usable[0];
}

export function createAccount(label: string): ChatgptAccount {
  const accounts = readAll();
  const now = new Date().toISOString();
  const account: ChatgptAccount = {
    id: `cgpt-${crypto.randomBytes(4).toString('hex')}`,
    label: label.trim() || 'Tài khoản ChatGPT',
    // Chưa login thật (chưa chạy script login) → không được coi là dùng được ngay.
    connected: false,
    isDefault: accounts.length === 0,
    createdAt: now,
    updatedAt: now,
    lastOkAt: null,
    lastError: null,
  };
  accounts.push(account);
  writeAll(accounts);
  fs.mkdirSync(profileDir(account.id), { recursive: true });
  return account;
}

export function updateAccount(
  id: string,
  patch: Partial<Pick<ChatgptAccount, 'label' | 'connected' | 'isDefault' | 'lastOkAt' | 'lastError'>>
): ChatgptAccount | null {
  const accounts = readAll();
  const account = accounts.find((a) => a.id === id);
  if (!account) return null;
  Object.assign(account, patch);
  account.updatedAt = new Date().toISOString();
  if (patch.isDefault) {
    for (const a of accounts) if (a.id !== id) a.isDefault = false;
  }
  writeAll(accounts);
  return account;
}

/** Đánh dấu phiên chết — gọi khi automation thấy màn hình login. */
export function markNeedsLogin(id: string, reason: string): void {
  updateAccount(id, { connected: false, lastError: reason });
}

export function markOk(id: string): void {
  updateAccount(id, { connected: true, lastOkAt: new Date().toISOString(), lastError: null });
}

export function deleteAccount(id: string): boolean {
  const accounts = readAll();
  const idx = accounts.findIndex((a) => a.id === id);
  if (idx < 0) return false;
  const [removed] = accounts.splice(idx, 1);
  // Xoá account mà giữ lại profile thì lần tạo account mới sẽ sinh id khác, profile cũ thành
  // rác vĩnh viễn — dọn luôn cho khỏi phình đĩa (mỗi profile Chromium vài chục MB).
  fs.rmSync(profileDir(removed.id), { recursive: true, force: true });
  if (removed.isDefault && accounts.length > 0) accounts[0].isDefault = true;
  writeAll(accounts);
  return true;
}
