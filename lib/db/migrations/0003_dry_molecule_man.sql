CREATE TABLE `livestream_merges` (
	`id` bigint unsigned AUTO_INCREMENT NOT NULL,
	`slug` varchar(191) NOT NULL,
	`name` varchar(512) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`job_slugs` json NOT NULL,
	`concat` json NOT NULL,
	CONSTRAINT `livestream_merges_id` PRIMARY KEY(`id`),
	CONSTRAINT `uq_merges_slug` UNIQUE(`slug`)
);
