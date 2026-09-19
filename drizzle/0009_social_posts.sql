CREATE TABLE `social_posts` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL REFERENCES `owners`(`id`),
	`room_id` text NOT NULL REFERENCES `rooms`(`id`),
	`media_key` text NOT NULL UNIQUE,
	`content_type` text NOT NULL,
	`byte_size` integer NOT NULL,
	`uploaded_at` integer,
	`caption_draft` text,
	`caption_status` text NOT NULL DEFAULT 'pending',
	`status` text NOT NULL DEFAULT 'pending',
	`task_id` text UNIQUE,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`approved_at` integer,
	`rejected_at` integer
);
CREATE INDEX `social_posts_feed` ON `social_posts` (`status`,`approved_at`,`created_at`);
CREATE INDEX `social_posts_owner` ON `social_posts` (`owner_id`,`status`,`created_at`);
