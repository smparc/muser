CREATE TABLE `muse_context` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`connection_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`text_hash` text NOT NULL,
	`category` text NOT NULL,
	`text` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`hidden_at` integer,
	`hidden_by` text,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`connection_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `muse_context_fact` ON `muse_context` (`connection_id`,`text_hash`);--> statement-breakpoint
CREATE INDEX `muse_context_room` ON `muse_context` (`room_id`);