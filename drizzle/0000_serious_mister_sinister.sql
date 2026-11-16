CREATE TABLE `databases` (
	`id` text PRIMARY KEY NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`family` text NOT NULL,
	`mark` text NOT NULL,
	`purpose` text NOT NULL,
	`recordCount` text NOT NULL,
	`access` text NOT NULL,
	`state` text NOT NULL,
	`authorization` text NOT NULL,
	`endpoint` text NOT NULL,
	`defaultPath` text NOT NULL,
	`defaultMethod` text NOT NULL,
	`methods` text NOT NULL,
	`takesBody` integer NOT NULL,
	`defaultHeaders` text NOT NULL,
	`holds` text NOT NULL,
	`updateCadence` text NOT NULL,
	`licence` text NOT NULL,
	`docsUrl` text NOT NULL,
	`body` text NOT NULL,
	`sample` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `inboxEntries` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`position` integer NOT NULL,
	`kind` text NOT NULL,
	`taskId` text,
	`studyId` text,
	`actorId` text NOT NULL,
	`body` text NOT NULL,
	`createdAt` integer NOT NULL,
	`read` integer NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`state` text NOT NULL,
	`study` text NOT NULL,
	`studyId` text,
	`targetId` text NOT NULL,
	`startedMinutesAgo` integer,
	`duration` text NOT NULL,
	`progress` integer,
	`cpuHours` integer,
	`gpuHours` integer,
	`cost` text NOT NULL,
	`error` text,
	`command` text NOT NULL,
	`inputs` text NOT NULL,
	`outputs` text NOT NULL,
	`resources` text NOT NULL,
	`logTail` text NOT NULL,
	`history` text NOT NULL,
	`taskKeys` text NOT NULL,
	`objective` text NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`color` text NOT NULL,
	`group` text NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `members` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`initials` text NOT NULL,
	`role` text NOT NULL,
	`email` text NOT NULL,
	`color` text NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`sessionId` text NOT NULL,
	`position` integer NOT NULL,
	`role` text NOT NULL,
	`blocks` text NOT NULL,
	`createdAt` integer NOT NULL,
	`tokens` integer,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`sessionId`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `messages_session` ON `messages` (`sessionId`,`position`);--> statement-breakpoint
CREATE TABLE `notes` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`studyId` text,
	`programId` text,
	`authorId` text NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `paperMeta` (
	`paperId` text PRIMARY KEY NOT NULL,
	`meta` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `papers` (
	`id` text PRIMARY KEY NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`authors` text NOT NULL,
	`venue` text NOT NULL,
	`year` integer NOT NULL,
	`doi` text,
	`abstract` text NOT NULL,
	`seed` text,
	`extraction` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `programs` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`summary` text NOT NULL,
	`status` text NOT NULL,
	`leadId` text NOT NULL,
	`startDate` text NOT NULL,
	`targetDate` text NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`icon` text NOT NULL,
	`createdAt` integer NOT NULL,
	`lastOpenedAt` integer NOT NULL,
	`activeSessionId` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_path_unique` ON `projects` (`path`);--> statement-breakpoint
CREATE TABLE `providers` (
	`id` text PRIMARY KEY NOT NULL,
	`position` integer NOT NULL,
	`label` text NOT NULL,
	`protocol` text NOT NULL,
	`defaultBaseUrl` text,
	`requiresKey` integer NOT NULL,
	`docsUrl` text,
	`summary` text NOT NULL,
	`fields` text NOT NULL,
	`models` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `records` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`position` integer NOT NULL,
	`source` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`authors` text NOT NULL,
	`year` integer,
	`venue` text,
	`doi` text,
	`url` text,
	`abstract` text,
	`extra` text,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `results` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`path` text NOT NULL,
	`sessionId` text,
	`createdAt` integer NOT NULL,
	`pinned` integer NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `reviewContent` (
	`reviewId` text PRIMARY KEY NOT NULL,
	`content` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`position` integer NOT NULL,
	`question` text NOT NULL,
	`short` text NOT NULL,
	`state` text NOT NULL,
	`total` integer NOT NULL,
	`protocol` text NOT NULL,
	`lastTouched` integer NOT NULL,
	`paperIds` text NOT NULL,
	`seed` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`position` integer NOT NULL,
	`title` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`phase` text NOT NULL,
	`branch` text,
	`pullRequest` text,
	`pinned` integer,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text
);
--> statement-breakpoint
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`databaseId` text NOT NULL,
	`filters` text NOT NULL,
	`preview` text NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `studies` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`question` text NOT NULL,
	`status` text NOT NULL,
	`health` text NOT NULL,
	`leadId` text NOT NULL,
	`memberIds` text NOT NULL,
	`programId` text,
	`labels` text NOT NULL,
	`priority` integer NOT NULL,
	`startDate` text NOT NULL,
	`targetDate` text NOT NULL,
	`milestones` text NOT NULL,
	`folder` text,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `targets` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`host` text NOT NULL,
	`summary` text NOT NULL,
	`readiness` text NOT NULL,
	`cores` integer NOT NULL,
	`memoryGb` integer NOT NULL,
	`gpus` text,
	`concurrency` integer NOT NULL,
	`allocation` text,
	`needs` text NOT NULL,
	`cost` text NOT NULL,
	`credentials` text NOT NULL,
	`check` text NOT NULL,
	`recentJobs` text NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`position` integer NOT NULL,
	`key` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`priority` integer NOT NULL,
	`studyId` text,
	`waveId` text,
	`milestoneId` text,
	`parentId` text,
	`assigneeId` text,
	`labels` text NOT NULL,
	`estimate` integer,
	`dueDate` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`relations` text NOT NULL,
	`evidence` text NOT NULL,
	`comments` text NOT NULL,
	`subtasks` text NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `views` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`ownerId` text,
	`layout` text NOT NULL,
	`filters` text NOT NULL,
	`starred` integer NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `waves` (
	`id` text PRIMARY KEY NOT NULL,
	`projectId` text NOT NULL,
	`position` integer NOT NULL,
	`number` integer NOT NULL,
	`name` text NOT NULL,
	`startDate` text NOT NULL,
	`endDate` text NOT NULL,
	`goal` text NOT NULL,
	FOREIGN KEY (`projectId`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
