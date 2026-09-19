CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`first_id` text NOT NULL,
	`second_id` text NOT NULL,
	`topic` text NOT NULL,
	`current_task_id` text NOT NULL,
	`turn_count` integer DEFAULT 0 NOT NULL,
	`max_turns` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`first_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`second_id`) REFERENCES `connections`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `conversations_room` ON `conversations` (`room_id`,`created_at`);