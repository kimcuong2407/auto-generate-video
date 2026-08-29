ALTER TABLE `livestream_jobs` ADD `background_prompt_override` mediumtext;
--> statement-breakpoint
ALTER TABLE `livestream_jobs` ADD `background_ref_paths` json;
