CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`summary` text NOT NULL,
	`team` text NOT NULL,
	`instructions` text NOT NULL,
	`modelRef` text NOT NULL,
	`packs` text NOT NULL,
	`readOnly` integer NOT NULL,
	`builtIn` integer NOT NULL,
	`active` integer NOT NULL
);
