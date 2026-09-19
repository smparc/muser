CREATE TABLE `master_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`through_turn` integer NOT NULL,
	`result_json` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `master_observations_turn` ON `master_observations` (`conversation_id`,`through_turn`);--> statement-breakpoint
CREATE INDEX `master_observations_room` ON `master_observations` (`room_id`,`created_at`);