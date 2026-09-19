DROP INDEX `rooms_owner_id_unique`;--> statement-breakpoint
CREATE INDEX `rooms_owner` ON `rooms` (`owner_id`,`created_at`);