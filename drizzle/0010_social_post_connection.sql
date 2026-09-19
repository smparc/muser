ALTER TABLE `social_posts` ADD COLUMN `selected_connection_id` text REFERENCES `connections`(`id`);
CREATE INDEX `social_posts_connection` ON `social_posts` (`selected_connection_id`);
