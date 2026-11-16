CREATE TABLE `experimentDomains` (
	`id` text PRIMARY KEY NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`summary` text NOT NULL,
	`mark` text NOT NULL,
	`fields` text NOT NULL,
	`builtIn` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `experiments` (
	`id` text PRIMARY KEY NOT NULL,
	`position` integer NOT NULL,
	`domainId` text,
	`objective` text NOT NULL,
	`hypothesis` text NOT NULL,
	`design` text NOT NULL,
	`designKind` text NOT NULL,
	`stage` text NOT NULL,
	`criterion` text,
	`checks` text NOT NULL,
	`designSpec` text NOT NULL,
	`outcome` text NOT NULL,
	`outcomeSummary` text NOT NULL,
	`lesson` text NOT NULL,
	`studyId` text,
	`trials` text NOT NULL,
	`evidence` text NOT NULL,
	`links` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
