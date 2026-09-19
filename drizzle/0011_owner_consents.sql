CREATE TABLE `owner_consents` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`sources_json` text DEFAULT '[]' NOT NULL,
	`authorized_at` integer,
	`onboarding_completed_at` integer,
	`updated_at` integer NOT NULL
);
