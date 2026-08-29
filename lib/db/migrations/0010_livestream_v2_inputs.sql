CREATE TABLE IF NOT EXISTS `livestream_v2_inputs` (
	`job_id` bigint unsigned NOT NULL,
	`platform` varchar(128) NOT NULL,
	`channel_name` varchar(255) NOT NULL,
	`follower_count` varchar(64) NOT NULL,
	`viewer_count` varchar(64) NOT NULL,
	`promotion` text NOT NULL,
	`cta` text NOT NULL,
	`advantages` json NOT NULL,
	`dialogues_per_scene` int NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `livestream_v2_inputs_job_id` PRIMARY KEY(`job_id`)
);
