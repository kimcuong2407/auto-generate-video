CREATE TABLE `livestream_jobs` (
	`id` varchar(128) NOT NULL,
	`name` varchar(512) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`aspect_ratio` enum('9:16','16:9') NOT NULL,
	`veo_model` enum('veo_3_1_quality','veo_3_1_fast','veo_3_1_lite','veo_3_1_lite_low_priority','abra') NOT NULL,
	`chaining` enum('off','per_product','continuous') NOT NULL,
	`status` enum('draft','scripting','generating','concatenating','done','failed') NOT NULL,
	`spokesperson_image_paths` json NOT NULL,
	`selected_ref_image_path` varchar(1024),
	`selected_model_image_path` varchar(1024),
	`background_image_paths` json NOT NULL,
	`selected_background_image_path` varchar(1024),
	`image_r2_urls` json NOT NULL,
	`concat` json NOT NULL,
	`flow_status_cache` json NOT NULL,
	`flow_project_id` varchar(255),
	`script_system_prompt_override` mediumtext,
	CONSTRAINT `livestream_jobs_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `livestream_products` (
	`row_id` int AUTO_INCREMENT NOT NULL,
	`job_id` varchar(128) NOT NULL,
	`product_key` varchar(191) NOT NULL,
	`order` int NOT NULL,
	`source_type` enum('link','file_text','file_image','manual') NOT NULL,
	`source_link` text,
	`source_file_path` varchar(1024),
	`raw_text` mediumtext,
	`ingest_status` enum('pending','fetched','needs_manual','ready','failed') NOT NULL,
	`ingest_error` text,
	`name` varchar(512) NOT NULL,
	`description` mediumtext NOT NULL,
	`target_duration_sec` int NOT NULL,
	`script_status` enum('idle','generating','done','failed') NOT NULL,
	`script_error` text,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `livestream_products_row_id` PRIMARY KEY(`row_id`),
	CONSTRAINT `uq_products_job_key` UNIQUE(`job_id`,`product_key`)
);
--> statement-breakpoint
CREATE TABLE `livestream_segments` (
	`row_id` int AUTO_INCREMENT NOT NULL,
	`product_row_id` int NOT NULL,
	`job_id` varchar(128) NOT NULL,
	`segment_key` varchar(191) NOT NULL,
	`order` int NOT NULL,
	`voiceover_vi` mediumtext NOT NULL,
	`veo_prompt` mediumtext NOT NULL,
	`duration` int NOT NULL,
	`status` enum('idle','generating','done','failed') NOT NULL,
	`flow_job_id` varchar(255),
	`video_path` varchar(1024),
	`video_url` varchar(2048),
	`last_frame_path` varchar(1024),
	`error` text,
	`attempts` int NOT NULL DEFAULT 0,
	`last_updated_at` datetime(3),
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `livestream_segments_row_id` PRIMARY KEY(`row_id`),
	CONSTRAINT `uq_segments_product_key` UNIQUE(`product_row_id`,`segment_key`)
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` varchar(128) NOT NULL,
	`name` varchar(512) NOT NULL,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	`current_step` int NOT NULL,
	`aspect_ratio` enum('9:16','16:9') NOT NULL,
	`veo_model` enum('veo_3_1_quality','veo_3_1_fast','veo_3_1_lite','veo_3_1_lite_low_priority','abra') NOT NULL,
	`scene_chaining` boolean NOT NULL,
	`burn_on_screen_text` boolean NOT NULL,
	`flow_project_id` varchar(255),
	`script_angle_id` varchar(255),
	`template` json NOT NULL,
	`product` json NOT NULL,
	`inputs` json NOT NULL,
	`music` json NOT NULL,
	`concat` json NOT NULL,
	`flow_status_cache` json NOT NULL,
	`storyboard_model` varchar(128) NOT NULL,
	`storyboard_use_product_reference` boolean NOT NULL,
	`storyboard_use_spokesperson_reference` boolean NOT NULL,
	`script_total_duration` int NOT NULL,
	`script_aspect_ratio` enum('9:16','16:9') NOT NULL,
	CONSTRAINT `projects_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `scenes` (
	`row_id` int AUTO_INCREMENT NOT NULL,
	`project_id` varchar(128) NOT NULL,
	`scene_key` varchar(191) NOT NULL,
	`order` int NOT NULL,
	`label` varchar(512) NOT NULL,
	`duration` int NOT NULL,
	`camera` text NOT NULL,
	`type` varchar(128),
	`voiceover_vi` mediumtext NOT NULL,
	`on_screen_text` mediumtext NOT NULL,
	`veo_prompt` mediumtext NOT NULL,
	`negative_prompt` mediumtext NOT NULL,
	`status` enum('idle','queued','generating','done','failed') NOT NULL,
	`flow_job_id` varchar(255),
	`video_path` varchar(1024),
	`video_url` varchar(2048),
	`error` text,
	`attempts` int NOT NULL DEFAULT 0,
	`last_updated_at` datetime(3),
	`last_frame_path` varchar(1024),
	`chained_from_previous` boolean NOT NULL DEFAULT false,
	`created_at` datetime(3) NOT NULL,
	`updated_at` datetime(3) NOT NULL,
	CONSTRAINT `scenes_row_id` PRIMARY KEY(`row_id`),
	CONSTRAINT `uq_scenes_project_key` UNIQUE(`project_id`,`scene_key`)
);
--> statement-breakpoint
CREATE TABLE `storyboard_images` (
	`row_id` int AUTO_INCREMENT NOT NULL,
	`project_id` varchar(128) NOT NULL,
	`kind` enum('image','background') NOT NULL,
	`scene_id` varchar(191) NOT NULL,
	`order` int NOT NULL,
	`prompt` mediumtext NOT NULL,
	`image_path` varchar(1024),
	`status` enum('idle','generating','done','failed') NOT NULL,
	`error` text,
	`attempts` int NOT NULL DEFAULT 0,
	`last_updated_at` datetime(3),
	CONSTRAINT `storyboard_images_row_id` PRIMARY KEY(`row_id`)
);
--> statement-breakpoint
CREATE INDEX `idx_products_job_order` ON `livestream_products` (`job_id`,`order`);--> statement-breakpoint
CREATE INDEX `idx_segments_job_order` ON `livestream_segments` (`job_id`,`order`);--> statement-breakpoint
CREATE INDEX `idx_segments_product` ON `livestream_segments` (`product_row_id`);--> statement-breakpoint
CREATE INDEX `idx_scenes_project_order` ON `scenes` (`project_id`,`order`);--> statement-breakpoint
CREATE INDEX `idx_storyboard_project_kind_order` ON `storyboard_images` (`project_id`,`kind`,`order`);