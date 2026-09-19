CREATE TABLE `events` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`connection_id` text,
	`type` text NOT NULL,
	`detail` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `events_room` ON `events` (`room_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `events_connection` ON `events` (`connection_id`,`type`,`created_at`);--> statement-breakpoint
CREATE TABLE `owners` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`password_salt` text NOT NULL,
	`created_at` integer NOT NULL,
	`failed_logins` integer DEFAULT 0 NOT NULL,
	`locked_until` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `owners_email_unique` ON `owners` (`email`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id_hash` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `owners`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `sessions_owner` ON `sessions` (`owner_id`);--> statement-breakpoint
ALTER TABLE `connections` ADD `source` text DEFAULT 'pairing' NOT NULL;--> statement-breakpoint
ALTER TABLE `connections` ADD `first_used_at` integer;--> statement-breakpoint
ALTER TABLE `connections` ADD `last_inbox_at` integer;--> statement-breakpoint
ALTER TABLE `connections` ADD `last_reply_at` integer;--> statement-breakpoint
ALTER TABLE `connections` ADD `key_issued_at` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `fetched_at` integer;--> statement-breakpoint
ALTER TABLE `tasks` ADD `round_id` text;--> statement-breakpoint
UPDATE `connections` SET `first_used_at` = `last_seen_at`, `key_issued_at` = `created_at` WHERE `first_used_at` IS NULL;