CREATE TABLE `master_questions` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`round_id` text NOT NULL,
	`question` text NOT NULL,
	`rationale` text,
	`deliberation_json` text NOT NULL,
	`providers` text NOT NULL,
	`created_at` integer NOT NULL,
	`evaluated_at` integer,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `master_questions_round_id_unique` ON `master_questions` (`round_id`);--> statement-breakpoint
CREATE INDEX `master_questions_room` ON `master_questions` (`room_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `matches` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`a_id` text NOT NULL,
	`b_id` text NOT NULL,
	`verdict` text NOT NULL,
	`summary` text NOT NULL,
	`evidence_json` text NOT NULL,
	`votes_json` text NOT NULL,
	`round_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `rooms`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `matches_pair` ON `matches` (`room_id`,`a_id`,`b_id`);--> statement-breakpoint
ALTER TABLE `rooms` ADD `master_mode` text DEFAULT 'off' NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `master_rounds_left` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `rooms` ADD `master_status` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `master_error` text;--> statement-breakpoint
ALTER TABLE `rooms` ADD `master_lock_until` integer;--> statement-breakpoint
ALTER TABLE `rooms` ADD `master_updated_at` integer;