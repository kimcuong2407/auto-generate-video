/**
 * Nhập một profile Chrome CÁ NHÂN (đã đăng nhập ChatGPT sẵn) thành profile automation,
 * thay cho việc đăng nhập lại bằng tay qua scripts/chatgpt-login.ts (Google chặn đăng nhập
 * trong cửa sổ do Playwright điều khiển).
 *
 * Liệt kê profile Chrome đang có:
 *   npx tsx scripts/chatgpt-import-profile.ts
 *
 * Nhập một profile (dùng tên hiển thị hoặc thư mục "Profile 40"):
 *   npx tsx scripts/chatgpt-import-profile.ts "gpt4.0" "Tài khoản chính"
 *
 * Vì sao COPY chứ không trỏ thẳng vào profile gốc: Playwright cần userDataDir độc quyền và
 * sẽ ghi đè cấu hình trong đó. Trỏ thẳng thì (a) không mở được khi Chrome đang chạy,
 * (b) automation làm bẩn profile Mr.D dùng hằng ngày.
 *
 * Chỉ copy phần giữ phiên — cache/lịch sử/extension bỏ hết, nếu không mỗi profile tốn vài GB
 * mà chẳng thêm gì cho việc giữ session.
 *
 * ĐÓNG CHROME trước khi chạy: leveldb đang mở có thể copy ra bản dở dang.
 *
 * ⚠️ ĐÃ THỬ VÀ KHÔNG ĂN TRÊN macOS (2026-08-31). Copy đủ 13 mục (Cookies, Local Storage,
 * IndexedDB, Local State...) nhưng mở lên vẫn là trang CHƯA đăng nhập: profile đích chỉ nhận
 * được 5 cookie khách vãng lai (oai-did, __cf_bm, __cflb, oai-sc, oai-mweb-route-desktop),
 * KHÔNG có cookie session nào.
 *
 * Lý do: trên macOS, Chrome mã hoá cookie bằng khoá nằm trong KEYCHAIN, không nằm trong file
 * "Local State". Profile đích chạy dưới tiến trình khác không lấy được khoá đó nên Chrome bỏ
 * qua toàn bộ cookie đã mã hoá. Copy thêm file cũng không cứu được — vấn đề ở khoá, không ở dữ liệu.
 *
 * Script vẫn giữ lại vì trên Linux/Windows cơ chế mã hoá khác (Linux dùng khoá trong Local
 * State thật), và để lần sau không ai mất công thử lại hướng này trên macOS. Muốn có profile
 * dùng được trên VPS: đăng nhập TRỰC TIẾP trên VPS qua X11 forwarding
 * (`ssh -X` rồi `npm run chatgpt:login`), xem docs/DEPLOY.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createAccount, profileDir, listAccounts, updateAccount, hasProfileData } from '../lib/chatgptImage/accountStore';

const CHROME_DIR = path.join(
  process.env.HOME || '',
  'Library/Application Support/Google/Chrome'
);

/**
 * Những gì cần để giữ phiên ChatGPT.
 *
 * Cookie ở `Cookies` (một số bản Chrome để trong `Network/`) — copy cả hai, thiếu cái nào thì
 * bỏ qua cái đó. Token phiên còn nằm ở `Local Storage` + `IndexedDB`: doc mục 0 đã nêu cookie
 * KHÔNG đủ, thiếu 2 thứ này thì mở lên vẫn là màn hình chưa đăng nhập.
 */
const NEEDED = [
  'Cookies',
  'Cookies-journal',
  'Network',
  'Local Storage',
  'Session Storage',
  'IndexedDB',
  'Local State',
  'Preferences',
  'Secure Preferences',
  'Login Data',
  'Web Data',
  'Trust Tokens',
  'Trust Tokens-journal',
  'Origin Bound Certs',
  'Device Bound Sessions',
];

interface ChromeProfile {
  dir: string;
  name: string;
}

function listChromeProfiles(): ChromeProfile[] {
  const statePath = path.join(CHROME_DIR, 'Local State');
  const state = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as {
    profile?: { info_cache?: Record<string, { name?: string; user_name?: string }> };
  };
  const cache = state.profile?.info_cache || {};
  return Object.entries(cache)
    .filter(([dir]) => fs.existsSync(path.join(CHROME_DIR, dir)))
    .map(([dir, info]) => ({
      dir,
      name: [info.name, info.user_name].filter(Boolean).join(' · ') || dir,
    }));
}

function copyProfile(srcDir: string, destDir: string): { copied: string[]; skipped: string[] } {
  const copied: string[] = [];
  const skipped: string[] = [];

  // Chrome mong userDataDir có 1 thư mục profile con; Playwright dùng "Default".
  const profileDest = path.join(destDir, 'Default');
  fs.mkdirSync(profileDest, { recursive: true });

  for (const item of NEEDED) {
    const src = path.join(srcDir, item);
    if (!fs.existsSync(src)) {
      skipped.push(item);
      continue;
    }
    fs.cpSync(src, path.join(profileDest, item), { recursive: true });
    copied.push(item);
  }

  // "Local State" nằm ở thư mục CHA của profile, không nằm trong profile. Nó giữ khoá mã hoá
  // cookie (os_crypt) — thiếu file này thì cookie copy sang giải mã không ra, mở lên vẫn là
  // trạng thái chưa đăng nhập.
  const parentState = path.join(CHROME_DIR, 'Local State');
  if (fs.existsSync(parentState)) {
    fs.copyFileSync(parentState, path.join(destDir, 'Local State'));
    copied.push('Local State (gốc)');
  }

  return { copied, skipped };
}

function main(): void {
  const profiles = listChromeProfiles();
  const query = process.argv[2];

  if (!query) {
    console.log('Các profile Chrome đang có:\n');
    for (const p of profiles) console.log(`  ${p.dir.padEnd(12)} ${p.name}`);
    console.log('\nNhập:  npx tsx scripts/chatgpt-import-profile.ts "<tên hoặc thư mục>" "<nhãn account>"');
    return;
  }

  const q = query.toLowerCase();
  const matches = profiles.filter(
    (p) => p.dir.toLowerCase() === q || p.name.toLowerCase().includes(q)
  );
  if (matches.length === 0) {
    console.error(`Không tìm thấy profile khớp "${query}". Chạy không tham số để xem danh sách.`);
    process.exit(1);
  }
  // Khớp nhiều thì dừng lại hỏi — copy nhầm profile sẽ nhập sai tài khoản ChatGPT mà không
  // có dấu hiệu gì cho tới lúc gen ảnh bằng account lạ.
  if (matches.length > 1) {
    console.error(`"${query}" khớp nhiều profile, ghi rõ hơn:`);
    for (const p of matches) console.error(`  ${p.dir.padEnd(12)} ${p.name}`);
    process.exit(1);
  }

  const src = matches[0];
  const label = process.argv[3] || src.name;

  // Nhập lại cùng nhãn thì dùng lại account cũ, tránh đẻ account trùng mỗi lần chạy.
  const existing = listAccounts().find((a) => a.label === label);
  const account = existing || createAccount(label);
  const dest = profileDir(account.id);

  console.log(`Nguồn : ${src.dir} (${src.name})`);
  console.log(`Đích  : ${dest}`);
  console.log('Đang copy dữ liệu phiên...\n');

  fs.rmSync(dest, { recursive: true, force: true });
  const { copied, skipped } = copyProfile(path.join(CHROME_DIR, src.dir), dest);

  console.log(`Đã copy (${copied.length}): ${copied.join(', ')}`);
  if (skipped.length > 0) console.log(`Không có, bỏ qua: ${skipped.join(', ')}`);

  if (!hasProfileData(account.id)) {
    console.error('\n✗ Profile đích vẫn rỗng — không copy được gì. Kiểm tra lại quyền đọc thư mục Chrome.');
    process.exit(1);
  }

  // connected=true là LẠC QUAN: mới chắc đã copy được dữ liệu, chưa chắc ChatGPT còn nhận
  // phiên. Kiểm chứng bằng lệnh --open ở dưới rồi mới tin.
  updateAccount(account.id, { connected: true, lastError: null });

  console.log(`\n✓ Đã nhập vào account ${account.id} (${label}).`);
  console.log('\nBước tiếp theo:');
  console.log('  1. Kiểm tra phiên còn sống:');
  console.log('     npm run chatgpt:login -- --open');
  console.log('  2. Đưa lên VPS:');
  console.log(`     tar czf profile.tgz -C data/chatgpt-profiles ${account.id}`);
  console.log('     scp profile.tgz homebox-production-worker-2:/tmp/');
  console.log('     scp data/chatgpt-auth/accounts.json homebox-production-worker-2:/tmp/');
  console.log('     ssh homebox-production-worker-2 "cd /var/www/video.homebox.vn/public_html \\');
  console.log('       && tar xzf /tmp/profile.tgz -C data/chatgpt-profiles \\');
  console.log('       && cp /tmp/accounts.json data/chatgpt-auth/ && rm /tmp/profile.tgz /tmp/accounts.json"');
}

main();
