CREATE TABLE `chatgpt_image_jobs` (
	`id` varchar(128) NOT NULL,
	`prompt` mediumtext NOT NULL,
	`aspect` enum('9:16','16:9') NOT NULL,
	`ref_image_paths` json,
	`status` enum('queued','running','done','failed') NOT NULL,
	`account_id` varchar(128),
	`image_path` varchar(1024),
	`error` text,
	`attempts` int NOT NULL DEFAULT 0,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`started_at` datetime(3),
	`finished_at` datetime(3),
	CONSTRAINT `chatgpt_image_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `idx_chatgpt_image_status_created` ON `chatgpt_image_jobs` (`status`,`created_at`);
