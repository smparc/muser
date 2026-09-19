CREATE TABLE `owner_profiles` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`profile_json` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE `room_members` ADD `profile_shared` integer DEFAULT 1 NOT NULL;