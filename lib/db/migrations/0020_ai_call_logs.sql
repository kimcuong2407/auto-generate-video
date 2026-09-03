CREATE TABLE `ai_call_logs` (
	`row_id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`step_key` varchar(64) NOT NULL,
	`job_slug` varchar(191) NOT NULL,
	`product_id` varchar(64) NOT NULL,
	`model` varchar(191) NOT NULL,
	`prompt_scope` varchar(16) NOT NULL,
	`system_prompt` mediumtext NOT NULL,
	`user_prompt` mediumtext NOT NULL,
	`output` mediumtext,
	`error_message` mediumtext,
	`image_count` int NOT NULL DEFAULT 0,
	`image_paths` json,
	`duration_ms` int NOT NULL,
	`attempts` int NOT NULL DEFAULT 1,
	`created_at` datetime(3) NOT NULL,
	CONSTRAINT `ai_call_logs_row_id` PRIMARY KEY(`row_id`)
);
--> statement-breakpoint
CREATE INDEX `ix_ai_call_logs_lookup` ON `ai_call_logs` (`job_slug`,`step_key`,`row_id`);
