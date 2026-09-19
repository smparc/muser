CREATE TABLE `room_invites` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`code_hash` text NOT NULL,
	`label` text,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`max_uses` integer NOT NULL,
	`uses` integer DEFAULT 0 NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_invites_code_hash_unique` ON `room_invites` (`code_hash`);--> statement-breakpoint
CREATE INDEX `room_invites_room` ON `room_invites` (`room_id`);--> statement-breakpoint
CREATE TABLE `room_members` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`owner_name` text NOT NULL,
	`role` text NOT NULL,
	`joined_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `room_members_room_owner` ON `room_members` (`room_id`,`owner_id`);--> statement-breakpoint
CREATE INDEX `room_members_owner` ON `room_members` (`owner_id`);--> statement-breakpoint
ALTER TABLE `rooms` ADD `name` text;--> statement-breakpoint
INSERT OR IGNORE INTO `room_members` (`id`,`room_id`,`owner_id`,`owner_name`,`role`,`joined_at`) SELECT 'mem_' || `id`, `id`, `owner_id`, '', 'host', `created_at` FROM `rooms`;