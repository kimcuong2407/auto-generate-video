-- Viết TAY (không dùng drizzle-kit generate) — ngoại lệ có chủ đích, cùng lý do 0023.
--
-- `npm run db:generate` (2026-09-11) sinh ra file chứa CREATE TABLE cho 3 bảng ĐÃ TỒN TẠI
-- (chatgpt_image_jobs, ai_prompts, ai_call_logs) và ADD 8 cột đã có (livestream_jobs.*,
-- livestream_products.source_raw, projects.script_evaluation) — snapshot meta local vẫn lệch
-- với DB thật. MariaDB không có DDL transaction nên file đó chạy lên production sẽ fail ngay ở
-- CREATE TABLE đầu tiên và để lại schema nửa vời.
--
-- Đối chiếu information_schema trên DB thật (2026-09-11): chỉ đúng cột dưới đây là thiếu.
-- scripts/check-schema-columns.ts cũng chỉ báo mỗi projects.flow_media_ids.
--
-- IF NOT EXISTS: chạy lặp không hỏng, no-op trên môi trường đã có cột.

ALTER TABLE `projects` ADD COLUMN IF NOT EXISTS `flow_media_ids` json;
