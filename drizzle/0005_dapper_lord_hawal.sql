CREATE TABLE `cloudConnections` (
	`id` text PRIMARY KEY NOT NULL,
	`position` integer NOT NULL,
	`providerId` text NOT NULL,
	`label` text NOT NULL,
	`config` text NOT NULL,
	`createdAt` integer NOT NULL
);
