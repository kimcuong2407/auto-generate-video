-- Viết TAY (không dùng drizzle-kit generate) — ngoại lệ có chủ đích.
--
-- Vì sao: snapshot meta local đã lệch với DB thật. `db:generate` sinh ra file chứa CREATE TABLE
-- cho 3 bảng ĐÃ TỒN TẠI (chatgpt_image_jobs, ai_prompts, ai_call_logs) và ADD 6 cột đã có
-- (livestream_jobs.*, livestream_products.source_raw). MariaDB không có DDL transaction nên file
-- đó chạy lên production sẽ fail giữa chừng và để lại schema nửa vời.
--
-- Đối chiếu information_schema trên DB thật (2026-09-10) cho thấy chỉ 2 thứ dưới đây là thiếu.
--
-- IF NOT EXISTS: chạy lặp không hỏng, và no-op trên môi trường đã có cột.

ALTER TABLE `projects` ADD COLUMN IF NOT EXISTS `script_evaluation` json;--> statement-breakpoint
ALTER TABLE `ai_call_logs` ADD COLUMN IF NOT EXISTS `project_id` varchar(128) NOT NULL DEFAULT '';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ix_ai_call_logs_project` ON `ai_call_logs` (`project_id`,`step_key`,`row_id`);
