CREATE TABLE `text_checks` (
	`kind` text NOT NULL,
	`ref_id` text NOT NULL,
	`text_hash` text NOT NULL,
	`classification` text NOT NULL,
	`ai_probability` integer,
	`confidence` text,
	`checked_at` integer NOT NULL,
	PRIMARY KEY(`kind`, `ref_id`)
);
