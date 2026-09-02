CREATE TABLE `ai_prompts` (
	`row_id` int AUTO_INCREMENT NOT NULL,
	`step_key` varchar(64) NOT NULL,
	`job_slug` varchar(191) NOT NULL,
	`body` mediumtext NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `ai_prompts_row_id` PRIMARY KEY(`row_id`),
	CONSTRAINT `uq_ai_prompts_step_scope` UNIQUE(`step_key`,`job_slug`)
);
--> statement-breakpoint
INSERT INTO `ai_prompts` (`step_key`, `job_slug`, `body`, `created_at`, `updated_at`)
SELECT 'script', `slug`, `script_system_prompt_override`, NOW(3), NOW(3)
FROM `livestream_jobs` WHERE `script_system_prompt_override` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `ai_prompts` (`step_key`, `job_slug`, `body`, `created_at`, `updated_at`)
SELECT 'background', `slug`, `background_prompt_override`, NOW(3), NOW(3)
FROM `livestream_jobs` WHERE `background_prompt_override` IS NOT NULL;
--> statement-breakpoint
INSERT INTO `ai_prompts` (`step_key`, `job_slug`, `body`, `created_at`, `updated_at`)
SELECT 'negative_video', `slug`, `negative_prompt_override`, NOW(3), NOW(3)
FROM `livestream_jobs` WHERE `negative_prompt_override` IS NOT NULL;
