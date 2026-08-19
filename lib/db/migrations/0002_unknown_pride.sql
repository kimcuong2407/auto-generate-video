-- Đổi PK livestream_jobs.id từ varchar(128) (slug ngẫu nhiên) sang bigint unsigned autoincrement,
-- để join sạch (số) với livestream_products.job_id / livestream_segments.job_id (cũng đổi theo).
-- Giá trị id cũ (dùng làm tên thư mục filesystem thật data/livestream/{id}/ và 1 phần R2 key
-- livestream/{id}/...) được giữ nguyên trong cột mới `slug` — filesystem/R2 KHÔNG bị rename/re-key.
--
-- Chiến lược: id cũ là chuỗi (vd "a2208-...-3733f0") không convert được thành số, không thể ALTER
-- MODIFY trực tiếp. Thêm cột bigint mới song song → backfill qua JOIN trên slug (bản sao id cũ) →
-- xoá cột varchar cũ → đổi tên cột mới thành tên chính thức. Không có FK constraint thật trong DB
-- (đúng convention hiện tại) nên không bị chặn bởi FK, nhưng phải backfill đúng thứ tự (jobs trước,
-- rồi products/segments) để còn tham chiếu được slug.

-- === BƯỚC 1: livestream_jobs — thêm cột slug, backfill = id cũ ===
ALTER TABLE `livestream_jobs` ADD `slug` varchar(191);
--> statement-breakpoint
UPDATE `livestream_jobs` SET `slug` = `id`;
--> statement-breakpoint
ALTER TABLE `livestream_jobs` MODIFY `slug` varchar(191) NOT NULL;
--> statement-breakpoint
ALTER TABLE `livestream_jobs` ADD UNIQUE INDEX `uq_jobs_slug` (`slug`);
--> statement-breakpoint

-- === BƯỚC 2: thêm cột id_new bigint autoincrement song song với id (varchar) ===
-- MariaDB yêu cầu cột AUTO_INCREMENT phải có key ngay trong ALTER thêm cột đó — dùng UNIQUE KEY tạm
-- (PRIMARY KEY vẫn đang là `id` varchar ở bước này).
ALTER TABLE `livestream_jobs` ADD `id_new` bigint unsigned AUTO_INCREMENT UNIQUE;
--> statement-breakpoint

-- === BƯỚC 3: livestream_products / livestream_segments — thêm job_id_new, backfill qua JOIN slug ===
ALTER TABLE `livestream_products` ADD `job_id_new` bigint unsigned;
--> statement-breakpoint
UPDATE `livestream_products` p
JOIN `livestream_jobs` j ON j.`slug` = p.`job_id`
SET p.`job_id_new` = j.`id_new`;
--> statement-breakpoint
ALTER TABLE `livestream_segments` ADD `job_id_new` bigint unsigned;
--> statement-breakpoint
UPDATE `livestream_segments` s
JOIN `livestream_jobs` j ON j.`slug` = s.`job_id`
SET s.`job_id_new` = j.`id_new`;
--> statement-breakpoint

-- === BƯỚC 4: livestream_jobs — chốt id_new thành PRIMARY KEY, xoá id (varchar) cũ ===
-- Gộp trong 1 ALTER: drop PRIMARY KEY cũ + drop cột id varchar + đổi tên id_new thành id (giữ
-- AUTO_INCREMENT) + gắn PRIMARY KEY mới — atomic, để cột AUTO_INCREMENT luôn có key đi kèm.
ALTER TABLE `livestream_jobs`
  DROP PRIMARY KEY,
  DROP COLUMN `id`,
  CHANGE COLUMN `id_new` `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  ADD PRIMARY KEY (`id`);
--> statement-breakpoint

-- === BƯỚC 5: livestream_products — xoá job_id (varchar) cũ, đổi tên job_id_new -> job_id ===
-- Drop 2 index cũ tham chiếu job_id (varchar) trước khi drop cột, tạo lại trên cột bigint sau.
ALTER TABLE `livestream_products` DROP INDEX `idx_products_job_order`;
--> statement-breakpoint
ALTER TABLE `livestream_products` DROP INDEX `uq_products_job_key`;
--> statement-breakpoint
ALTER TABLE `livestream_products` DROP COLUMN `job_id`;
--> statement-breakpoint
ALTER TABLE `livestream_products` CHANGE COLUMN `job_id_new` `job_id` bigint unsigned NOT NULL;
--> statement-breakpoint
ALTER TABLE `livestream_products` ADD INDEX `idx_products_job_order` (`job_id`, `order`);
--> statement-breakpoint
ALTER TABLE `livestream_products` ADD UNIQUE INDEX `uq_products_job_key` (`job_id`, `product_key`);
--> statement-breakpoint

-- === BƯỚC 6: livestream_segments — tương tự ===
ALTER TABLE `livestream_segments` DROP INDEX `idx_segments_job_order`;
--> statement-breakpoint
ALTER TABLE `livestream_segments` DROP COLUMN `job_id`;
--> statement-breakpoint
ALTER TABLE `livestream_segments` CHANGE COLUMN `job_id_new` `job_id` bigint unsigned NOT NULL;
--> statement-breakpoint
ALTER TABLE `livestream_segments` ADD INDEX `idx_segments_job_order` (`job_id`, `order`);
