-- Đổi selected_ref_image_path (varchar, 1 ảnh) -> selected_ref_image_paths (json, mảng, NOT NULL)
-- và thêm flow_media_ids (json, NOT NULL). Convert data cũ: path đơn -> mảng 1 phần tử, NULL -> [].
ALTER TABLE `livestream_jobs` ADD `selected_ref_image_paths` json;
--> statement-breakpoint
UPDATE `livestream_jobs`
SET `selected_ref_image_paths` = IF(
  `selected_ref_image_path` IS NULL,
  JSON_ARRAY(),
  JSON_ARRAY(`selected_ref_image_path`)
);
--> statement-breakpoint
ALTER TABLE `livestream_jobs` MODIFY `selected_ref_image_paths` json NOT NULL;
--> statement-breakpoint
ALTER TABLE `livestream_jobs` DROP COLUMN `selected_ref_image_path`;
--> statement-breakpoint
ALTER TABLE `livestream_jobs` ADD `flow_media_ids` json;
--> statement-breakpoint
UPDATE `livestream_jobs` SET `flow_media_ids` = JSON_OBJECT();
--> statement-breakpoint
ALTER TABLE `livestream_jobs` MODIFY `flow_media_ids` json NOT NULL;
