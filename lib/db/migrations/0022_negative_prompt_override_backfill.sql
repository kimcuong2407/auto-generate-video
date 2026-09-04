-- Tạo hai cột của `livestream_jobs` mà KHÔNG migration nào (0000..0021) từng tạo ra.
--
-- Vì sao chúng thiếu: cả hai được thêm TAY thẳng vào DB production từ sớm, không qua migration.
-- Trên production mọi thứ chạy bình thường nên không ai phát hiện; nhưng DB dựng sạch từ
-- migration thì thiếu cột, và:
--   - `negative_prompt_override`: 0018_ai_prompts.sql SELECT thẳng cột này → lỗi 1054, 0018 chết
--     và chặn luôn 0019/0020/0021.
--   - `video_seed`: INSERT job nào cũng lỗi "Unknown column" → tạo job trả 500.
--
-- Không sửa 0018 vì file đó đã áp trên production: đổi nội dung là đổi sha256 và
-- verify-migrations.ts sẽ chặn deploy (nó so hash, xem doc-comment ở đầu file đó).
--
-- `IF NOT EXISTS` để chạy được cả hai phía: production đã có sẵn 2 cột thì đây là no-op.
-- MariaDB hỗ trợ cú pháp này từ 10.0.2.
ALTER TABLE `livestream_jobs` ADD COLUMN IF NOT EXISTS `negative_prompt_override` mediumtext;
--> statement-breakpoint
ALTER TABLE `livestream_jobs` ADD COLUMN IF NOT EXISTS `video_seed` int;
