/**
 * Đăng nhập ChatGPT một lần để tạo profile Chromium cho automation.
 *
 * Chạy trên MÁY CÓ MÀN HÌNH (Mac của Mr.D), không chạy trên VPS:
 *   npx tsx scripts/chatgpt-login.ts "Tài khoản chính"
 *
 * Script mở Chromium thật, Mr.D tự đăng nhập bằng tay (email, mật khẩu, 2FA — không tự động
 * phần này). Khi thấy ô chat của ChatGPT xuất hiện, script tự đánh dấu account connected rồi
 * đóng browser. Profile nằm ở data/chatgpt-profiles/<id>/.
 *
 * Sau đó copy profile lên VPS:
 *   tar czf profile.tgz -C data/chatgpt-profiles <id>
 *   scp profile.tgz deploy@<VPS>:~/apps/auto-generate-review-product/data/chatgpt-profiles/
 *   # trên VPS: tar xzf profile.tgz && rm profile.tgz
 * Nhớ copy cả data/chatgpt-auth/accounts.json (hoặc tạo lại account cùng id trên VPS).
 *
 * LƯU Ý fingerprint: profile mở lại trên VPS phải dùng đúng viewport/locale/timezone như lúc
 * login — runner.ts và script này dùng chung BROWSER_FINGERPRINT nên đã khớp sẵn. Nhưng IP
 * vẫn khác (Mac ở VN, VPS ở nơi khác); nếu ChatGPT đá phiên ra thì phải login lại trực tiếp
 * trên VPS qua VNC/X11 forwarding.
 */
import { chromium } from 'playwright';
import { createAccount, markOk, profileDir, listAccounts } from '../lib/chatgptImage/accountStore';
import { BROWSER_FINGERPRINT } from '../lib/chatgptImage/runner';
import { COMPOSER_SELECTOR } from '../lib/chatgptImage/domScript';

async function main() {
  const label = process.argv[2] || 'Tài khoản ChatGPT';
  const reuseId = process.argv[3];

  const account = reuseId
    ? listAccounts().find((a) => a.id === reuseId)
    : createAccount(label);
  if (!account) {
    console.error(`Không tìm thấy account id ${reuseId}`);
    process.exit(1);
  }

  console.log(`Account: ${account.id} (${account.label})`);
  console.log(`Profile: ${profileDir(account.id)}`);
  console.log('Đang mở Chromium — hãy đăng nhập ChatGPT bằng tay...\n');

  const context = await chromium.launchPersistentContext(profileDir(account.id), {
    headless: false,
    ...BROWSER_FINGERPRINT,
  });
  const page = context.pages()[0] || (await context.newPage());
  await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });

  // Chờ ô chat thật xuất hiện = đã vào được giao diện chat. Chỉ dùng selector composer thật,
  // KHÔNG dùng selector textarea chung — trang landing chưa login có phần tử trông giống, nhận
  // nhầm sẽ lưu phiên giả rồi automation chết ở lần gen đầu mà không rõ lý do.
  console.log('Đang chờ đăng nhập (tối đa 10 phút)...');
  try {
    await page.waitForSelector(COMPOSER_SELECTOR, { timeout: 10 * 60_000 });
  } catch {
    console.error('\nHết thời gian chờ — chưa thấy ô chat ChatGPT. Chưa lưu gì cả.');
    await context.close();
    process.exit(1);
  }

  // Ô chat đã hiện, nhưng lúc này cookie/localStorage có thể chưa được Chromium ghi xuống đĩa.
  // Đợi thêm rồi mới đóng, nếu không profile lưu ra sẽ thiếu phiên.
  await page.waitForTimeout(3000);
  markOk(account.id);
  await context.close();

  console.log(`\n✓ Đã lưu phiên cho account ${account.id}.`);
  console.log(`  Copy lên VPS: tar czf profile.tgz -C data/chatgpt-profiles ${account.id}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
