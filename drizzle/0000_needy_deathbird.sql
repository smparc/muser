CREATE TABLE `connections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`room_id` text NOT NULL,
	`name` text NOT NULL,
	`token_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	`last_seen_at` integer,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `connections_token_hash_unique` ON `connections` (`token_hash`);--> statement-breakpoint
CREATE INDEX `connections_room` ON `connections` (`room_id`);--> statement-breakpoint
CREATE TABLE `pairings` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`invite_hash` text NOT NULL,
	`device_hash` text,
	`code` text,
	`name` text,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`connection_id` text,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pairings_invite_hash_unique` ON `pairings` (`invite_hash`);--> statement-breakpoint
CREATE INDEX `pairings_owner` ON `pairings` (`owner_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`connection_id` text PRIMARY KEY NOT NULL,
	`profile_json` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `responses` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`task_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`client_id` text NOT NULL,
	`text` text NOT NULL,
	`nonce` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `responses_task_id_unique` ON `responses` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `responses_client` ON `responses` (`connection_id`,`client_id`);--> statement-breakpoint
CREATE TABLE `rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rooms_owner_id_unique` ON `rooms` (`owner_id`);--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`prompt` text NOT NULL,
	`nonce` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`available_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tasks_inbox` ON `tasks` (`connection_id`,`status`,`available_at`);