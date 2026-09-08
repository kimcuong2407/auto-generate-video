/**
 * Export storageState (Playwright) từ profile automation đã đăng nhập.
 *
 *   npx tsx scripts/chatgpt-export-state.ts                 # account mặc định → stdout
 *   npx tsx scripts/chatgpt-export-state.ts cgpt-119a0676   # account cụ thể
 *   npx tsx scripts/chatgpt-export-state.ts --out state.json
 *
 * Chỉ chạy được trên profile do scripts/chatgpt-login.ts tạo (đăng nhập TRỰC TIẾP trong
 * Playwright). Profile Chrome cá nhân trên macOS KHÔNG export được — khoá giải mã cookie nằm
 * trong Keychain, xem ghi chú đầu scripts/chatgpt-import-profile.ts.
 *
 * Dùng chung openContext với lúc login để fingerprint khớp; lệch tham số là phiên bị đá ra.
 *
 * ⚠️ File kết quả chứa cookie đăng nhập — ai cầm được là vào thẳng tài khoản ChatGPT.
 * Đừng commit, đừng gửi qua chat/email. Đổi mật khẩu ChatGPT sẽ vô hiệu hoá nó.
 */
import fs from 'node:fs';
import { listAccounts, getActiveAccount } from '../lib/chatgptImage/accountStore';
import { openContext } from '../lib/chatgptImage/runner';

/** Cookie chứng minh phiên còn sống. Thiếu hết → profile chưa đăng nhập. */
const SESSION_COOKIES = ['__Secure-next-auth.session-token', '__Session', 'oai-sc'];

async function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf('--out');
  const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
  const wantId = args.filter((a, i) => !a.startsWith('--') && i !== outIdx + 1)[0];

  const account = wantId
    ? listAccounts().find((a) => a.id === wantId)
    : getActiveAccount() || listAccounts()[0];
  if (!account) {
    console.error('Không tìm thấy account. Chạy `npm run chatgpt:login` trước.');
    process.exit(1);
  }

  console.error(`Account: ${account.id} (${account.label})`);
  const context = await openContext(account.id, false);
  try {
    const state = await context.storageState();
    const cookies = state.cookies.filter((c) => /chatgpt\.com|openai\.com/.test(c.domain));
    const hasSession = cookies.some((c) => SESSION_COOKIES.includes(c.name));

    console.error(`Cookie chatgpt/openai: ${cookies.length}`);
    console.error(`Origin có localStorage: ${state.origins.length}`);
    if (!hasSession) {
      console.error(
        '\n✗ KHÔNG thấy cookie phiên — profile chưa đăng nhập hoặc phiên đã chết.' +
          '\n  Chạy `npx tsx scripts/chatgpt-login.ts --open` để đăng nhập lại.'
      );
      process.exit(2);
    }
    console.error('✓ Phiên hợp lệ.\n');

    const json = JSON.stringify(state, null, 2);
    if (outFile) {
      fs.writeFileSync(outFile, json, { mode: 0o600 });
      console.error(`Đã ghi ${outFile} (chmod 600). KHÔNG commit file này.`);
    } else {
      console.log(json);
    }
  } finally {
    await context.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
