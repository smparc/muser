CREATE TABLE `setup_links` (
	`id` text PRIMARY KEY NOT NULL,
	`code_hash` text NOT NULL,
	`owner_id` text NOT NULL,
	`owner_name` text NOT NULL,
	`room_id` text NOT NULL,
	`agent_name` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`claimed_at` integer,
	`connection_id` text,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `setup_links_code_hash_unique` ON `setup_links` (`code_hash`);--> statement-breakpoint
CREATE INDEX `setup_links_owner` ON `setup_links` (`owner_id`,`created_at`);