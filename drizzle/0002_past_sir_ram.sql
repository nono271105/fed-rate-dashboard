CREATE TABLE `ecb_snapshots` (
	`id` int AUTO_INCREMENT NOT NULL,
	`snapshotDate` varchar(10) NOT NULL,
	`source` varchar(32) NOT NULL,
	`payload` text NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ecb_snapshots_id` PRIMARY KEY(`id`),
	CONSTRAINT `ecb_snapshots_snapshotDate_unique` UNIQUE(`snapshotDate`)
);
