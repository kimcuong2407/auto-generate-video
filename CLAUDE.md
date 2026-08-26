# Rule project: auto-generate-review-product

## Auto commit + push sau khi hoàn thành task

Mr.D KHÔNG test ở local — code phải lên `master` mới chạy được trên VPS production.
Vì vậy sau khi hoàn thành mỗi task code, TỰ ĐỘNG commit + push lên `master`, KHÔNG hỏi lại.

Trước khi push, bắt buộc chạy và phải pass:

```bash
npx tsc --noEmit
```

Nếu task đụng vào logic có self-check tương ứng trong `scripts/check-*.ts`, chạy luôn script đó.
Typecheck hoặc self-check fail → DỪNG, sửa xong mới push, KHÔNG push code lỗi.

Quy trình:

```bash
npx tsc --noEmit          # bắt buộc pass
git add -A
git commit -m "<mô tả>"   # kèm trailer Co-Authored-By như thường lệ
git push origin master
```

Ngoại lệ — KHÔNG auto push, phải hỏi Mr.D trước:
- Thay đổi liên quan migration/schema DB (`lib/db/`, `drizzle/`).
- Xoá file/thư mục dữ liệu, đổi biến môi trường trong `.env*`.
- Task Mr.D nói rõ là thử nghiệm/nháp.

## Self-check

Logic không tầm thường phải để lại 1 script chạy được trong `scripts/check-*.ts`
(assert thuần, không framework) + đăng ký vào `package.json` dạng `check:*`.
