ALTER TABLE `articles` ADD `featured` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `articles` ADD `deleted_at` integer;