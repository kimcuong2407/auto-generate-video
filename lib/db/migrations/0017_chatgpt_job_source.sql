ALTER TABLE `chatgpt_image_jobs` ADD `source` enum('playwright','extension') NOT NULL DEFAULT 'playwright';
--> statement-breakpoint
CREATE INDEX `idx_chatgpt_image_source_status` ON `chatgpt_image_jobs` (`source`,`status`,`created_at`);
