-- Viết TAY (không dùng drizzle-kit generate) — ngoại lệ có chủ đích, cùng lý do 0023/0024.
--
-- Vì sao: thư mục meta/ chỉ có snapshot tới 0011 (12 file) trong khi đã có 24 migration. Snapshot
-- 0011 KHÔNG biết 3 bảng ai_call_logs / ai_prompts / chatgpt_image_jobs (tạo ở 0015/0018/0020),
-- nên `db:generate` sinh ra CREATE TABLE cho cả 3 bảng ĐÃ TỒN TẠI. MariaDB không có DDL
-- transaction → file đó chạy lên production fail ngay câu đầu và để lại schema nửa vời.
--
-- Đối chiếu information_schema trên DB thật (2026-09-11, database `video`): có đúng 11 bảng,
-- ai_call_logs có 16 cột và KHÔNG có source_kind; shopee_ingests và flow_job_logs chưa tồn tại.
-- check-schema-columns báo 183 cột / 11 bảng đều khớp schema Drizzle trước thay đổi này.
--
-- IF NOT EXISTS ở mọi câu: chạy lặp không hỏng, no-op trên môi trường đã có sẵn.

ALTER TABLE `ai_call_logs` ADD COLUMN IF NOT EXISTS `source_kind` varchar(24) NOT NULL DEFAULT '';--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ix_ai_call_logs_source` ON `ai_call_logs` (`source_kind`,`row_id`);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `shopee_ingests` (
	`item_id` varchar(64) NOT NULL,
	`shop_id` varchar(64) NOT NULL DEFAULT '',
	`name` varchar(512) NOT NULL,
	`product_url` varchar(1024) NOT NULL DEFAULT '',
	`product` json NOT NULL,
	`source_raw` json,
	`received_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `shopee_ingests_item_id` PRIMARY KEY(`item_id`)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ix_shopee_ingests_recent` ON `shopee_ingests` (`updated_at`);--> statement-breakpoint

CREATE TABLE IF NOT EXISTS `flow_job_logs` (
	`row_id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`source_kind` varchar(24) NOT NULL,
	`job_slug` varchar(191) NOT NULL DEFAULT '',
	`project_id` varchar(128) NOT NULL DEFAULT '',
	`unit_id` varchar(128) NOT NULL,
	`unit_order` int NOT NULL DEFAULT 0,
	`flow_job_id` varchar(191) NOT NULL DEFAULT '',
	`flow_project_id` varchar(255) NOT NULL DEFAULT '',
	`model` varchar(64) NOT NULL,
	`aspect` varchar(8) NOT NULL,
	`duration_sec` int NOT NULL DEFAULT 0,
	`veo_prompt` mediumtext NOT NULL,
	`prompt_is_raw` boolean NOT NULL DEFAULT false,
	`voiceover_vi` mediumtext,
	`negative_prompt` mediumtext,
	`ref_image_paths` json,
	`start_image_path` varchar(1024) NOT NULL DEFAULT '',
	`chained` boolean NOT NULL DEFAULT false,
	`error_message` mediumtext,
	`error_kind` varchar(16) NOT NULL DEFAULT '',
	`attempts` int NOT NULL DEFAULT 0,
	`duration_ms` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `flow_job_logs_row_id` PRIMARY KEY(`row_id`)
);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ix_flow_job_logs_owner` ON `flow_job_logs` (`job_slug`,`project_id`,`row_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `ix_flow_job_logs_source` ON `flow_job_logs` (`source_kind`,`row_id`);
