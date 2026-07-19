CREATE TABLE `site_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`maintenance_mode` integer DEFAULT false NOT NULL,
	`maintenance_message` text,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
