CREATE TABLE `researchTopics` (
	`id` text PRIMARY KEY NOT NULL,
	`position` integer NOT NULL,
	`question` text NOT NULL,
	`databaseIds` text NOT NULL,
	`agentIds` text NOT NULL,
	`status` text NOT NULL,
	`findings` text NOT NULL,
	`recordCount` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
