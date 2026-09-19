ALTER TABLE `connections` ADD `key_of` text;--> statement-breakpoint
CREATE INDEX `connections_key_of` ON `connections` (`key_of`);