/**
 * Đăng nhập ChatGPT một lần để tạo profile Chromium cho automation.
 *
 * Chạy trên MÁY CÓ MÀN HÌNH (Mac của Mr.D), không chạy trên VPS:
 *   npx tsx scripts/chatgpt-login.ts "Tài khoản chính"
 *
 * Mở lại profile đã có (không tạo account mới) để login tiếp hoặc kiểm tra phiên còn sống:
 *   npx tsx scripts/chatgpt-login.ts --open
 *
 * Script mở Google Chrome thật (không phải Chromium bundle của Playwright — Google từ chối
 * đăng nhập trên đó). Mr.D tự đăng nhập bằng tay (email, mật khẩu, 2FA). Khi thấy ô chat của
 * ChatGPT xuất hiện, script tự đánh dấu account connected rồi đóng browser.
 * Profile nằm ở data/chatgpt-profiles/<id>/.
 *
 * Nếu Google VẪN chặn: đăng nhập ChatGPT bằng email/mật khẩu OpenAI thay vì nút "Continue with
 * Google" — luồng đó không đi qua màn hình chặn của Google.
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
import { createAccount, markOk, profileDir, listAccounts } from '../lib/chatgptImage/accountStore';
import { openContext } from '../lib/chatgptImage/runner';
import { COMPOSER_SELECTOR } from '../lib/chatgptImage/domScript';

async function main() {
  const args = process.argv.slice(2);
  // --open: mở lại profile đã có để login tiếp / kiểm tra phiên, KHÔNG tạo account mới.
  // Mỗi lần chạy mà tạo account mới sẽ đẻ ra một profile Chrome rỗng vài chục MB, và
  // account cũ đã login dở thì không bao giờ quay lại được.
  const openOnly = args.includes('--open');
  const rest = args.filter((a) => a !== '--open');
  const label = rest[0] || 'Tài khoản ChatGPT';
  const reuseId = rest[1];

  const existing = listAccounts();
  const account = reuseId
    ? existing.find((a) => a.id === reuseId)
    : openOnly
      ? existing.find((a) => a.isDefault) || existing[0]
      : createAccount(label);
  if (!account) {
    console.error(
      reuseId
        ? `Không tìm thấy account id ${reuseId}`
        : 'Chưa có account nào — bỏ --open để tạo mới.'
    );
    process.exit(1);
  }

  console.log(`Account: ${account.id} (${account.label})`);
  console.log(`Profile: ${profileDir(account.id)}`);
  console.log(
    openOnly
      ? 'Đang mở lại profile — kiểm tra xem còn đăng nhập không...\n'
      : 'Đang mở Chrome — hãy đăng nhập ChatGPT bằng tay...\n'
  );

  // Dùng chung openContext với lúc gen: cùng browser, cùng fingerprint, cùng cờ chống dò
  // automation. Lệch một tham số giữa 2 pha là phiên bị đá ra ở lần gen đầu.
  const context = await openContext(account.id, true);
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
