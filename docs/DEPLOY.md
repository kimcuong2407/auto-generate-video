# Deploy lên VPS qua GitHub Actions (SSH + PM2)

Tài liệu vận hành cho CI/CD ở `.github/workflows/deploy.yml`.

- **CI** (mọi push / PR): `npm ci` → `typecheck` → `lint` → `build`.
- **CD** (chỉ khi push vào `master`, sau khi CI pass): SSH vào VPS, `git reset --hard origin/master`, `npm ci`, `npm run build`, `pm2 reload`.

## Vì sao là VPS chứ không phải Vercel/serverless

App này **stateful + nặng I/O**, không chạy được trên serverless:

| Ràng buộc | Nơi trong code |
|---|---|
| Gọi `ffmpeg` (spawn) để ghép video | `lib/ffmpeg/run.ts`, `concat.ts`, `frame.ts` |
| Playwright/Chromium để fetch link render JS | `lib/livestream/productFetchBrowser.ts` |
| Ghi file vào `data/` (project, job, media, `accounts.json`) | `lib/googleFlow/authStore.ts`, project/job store |
| State in-memory qua `globalThis` (reCAPTCHA pending) | `lib/googleFlow/recaptchaState.ts` |

→ Phải chạy **1 process Node bền** với ffmpeg + chromium + **disk bền** cho `data/`.

---

## 1. Chuẩn bị VPS (làm một lần)

Khuyến nghị Ubuntu 22.04+. Đăng nhập VPS bằng user thường (vd `deploy`), không dùng root.

```bash
# 1) Node 20 LTS (qua nvm)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20 && nvm alias default 20

# 2) ffmpeg (bắt buộc — ghép video)
sudo apt update && sudo apt install -y ffmpeg

# 3) pm2 (quản lý process)
npm install -g pm2

# 4) Clone repo về đúng thư mục sẽ dùng cho VPS_APP_DIR
mkdir -p ~/apps && cd ~/apps
git clone <URL_REPO_GIT> auto-generate-review-product
cd auto-generate-review-product

# 5) Chromium cho Playwright (fetch link render JS)
npx playwright install --with-deps chromium

# 6) Tạo .env.local trên VPS (KHÔNG commit) — copy từ .env.example rồi điền giá trị thật
cp .env.example .env.local
nano .env.local     # điền AI_CHAT_API_*, các timeout, v.v.

# 7) Build + chạy lần đầu bằng PM2
npm ci
npm run build
pm2 start npm --name review-app -- start
pm2 save
pm2 startup          # chạy dòng lệnh nó in ra để PM2 tự khởi động lại sau reboot
```

App chạy ở `http://127.0.0.1:3000`. `PM2_APP_NAME` ở bước trên là `review-app`.

> **`data/` là dữ liệu bền** — nằm trong app-dir, đã `.gitignore` nên `git reset --hard` khi deploy **không xoá** nó. Session/token/project giữ nguyên qua mỗi lần deploy.

---

## 2. Tạo SSH deploy key cho GitHub Actions

Tạo cặp key riêng cho CI (đừng dùng key cá nhân):

```bash
# Trên máy của bạn (hoặc bất kỳ đâu)
ssh-keygen -t ed25519 -C "github-actions-deploy" -f ./gh_deploy_key -N ""
```

- **Public key** (`gh_deploy_key.pub`): thêm vào VPS:
  ```bash
  # trên VPS, với user deploy
  cat >> ~/.ssh/authorized_keys < <(echo "<nội dung gh_deploy_key.pub>")
  chmod 600 ~/.ssh/authorized_keys
  ```
- **Private key** (`gh_deploy_key`): bỏ nguyên nội dung vào GitHub Secret `VPS_SSH_KEY` (mục 3).

Kiểm tra trước: `ssh -i gh_deploy_key deploy@<VPS_HOST>` phải vào được không hỏi mật khẩu.

---

## 3. GitHub Secrets cần tạo

repo GitHub → **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Ví dụ | Ghi chú |
|---|---|---|
| `VPS_HOST` | `1.2.3.4` | IP hoặc hostname VPS |
| `VPS_USER` | `deploy` | user SSH |
| `VPS_PORT` | `22` | tùy chọn; bỏ trống = 22 |
| `VPS_SSH_KEY` | `-----BEGIN OPENSSH PRIVATE KEY-----...` | **toàn bộ** private key `gh_deploy_key` |
| `VPS_APP_DIR` | `/home/deploy/apps/auto-generate-review-product` | thư mục đã clone ở mục 1 |
| `PM2_APP_NAME` | `review-app` | tên process PM2 |

---

## 4. Reverse proxy + HTTPS (Nginx + Let's Encrypt)

App cần origin HTTPS ổn định để extension trỏ về. Dùng Nginx proxy `:3000`:

```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

`/etc/nginx/sites-available/review-app`:

```nginx
server {
    server_name your-domain.com;

    client_max_body_size 200M;   # upload ảnh/video sản phẩm

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 900s;   # job gen video có thể chạy lâu
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/review-app /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d your-domain.com   # tự cấp SSL + chuyển sang 443
```

---

## 5. Cập nhật extension trỏ về domain

Extension Chrome chạy trên **máy cá nhân của bạn** (không trên VPS). Sau khi có domain HTTPS:

1. `extension-flow/manifest.json` → thêm domain vào `host_permissions`:
   ```json
   "host_permissions": ["https://labs.google/*", "https://your-domain.com/*", ...]
   ```
2. Reload extension ở `chrome://extensions`.
3. Mở popup extension → đổi **Endpoint URL** thành `https://your-domain.com/api/flow-auth/session` → **Gửi session ngay**.
4. Giữ tab `https://labs.google` mở để mint reCAPTCHA token on-demand như thường lệ.

---

## 6. Quy trình deploy hằng ngày

- Push vào `master` → Actions tự chạy CI, pass thì tự deploy.
- Bấm tay: tab **Actions** → workflow **CI/CD** → **Run workflow** (nhánh master).
- Xem log: nếu deploy fail, mở step "Deploy lên VPS" để đọc lỗi SSH.

Kiểm tra trên VPS:

```bash
pm2 list                    # review-app phải "online"
pm2 logs review-app         # xem log runtime
```

---

## 7. Sao lưu dữ liệu quan trọng

`data/flow-auth/accounts.json` chứa cookie + access_token labs.google (nhạy cảm, không commit). Nên backup định kỳ:

```bash
# ví dụ cron hằng ngày
cp ~/apps/auto-generate-review-product/data/flow-auth/accounts.json ~/backup/accounts.$(date +%F).json
```
