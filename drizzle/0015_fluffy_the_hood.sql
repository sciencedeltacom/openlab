CREATE TABLE `syncPairs` (
	`id` text PRIMARY KEY NOT NULL,
	`position` integer NOT NULL,
	`connectionId` text NOT NULL,
	`label` text NOT NULL,
	`remotePath` text NOT NULL,
	`remoteName` text NOT NULL,
	`localPath` text NOT NULL,
	`createdAt` integer NOT NULL
);
