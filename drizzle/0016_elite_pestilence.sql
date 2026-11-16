ALTER TABLE `messages` ADD `agent` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `parentId` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `worker` text;--> statement-breakpoint
ALTER TABLE `sessions` ADD `finishedAt` integer;