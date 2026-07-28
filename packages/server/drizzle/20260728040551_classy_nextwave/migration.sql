CREATE TABLE `clips` (
	`id` char(26) PRIMARY KEY,
	`kind` enum('text','image') NOT NULL,
	`text` mediumtext,
	`blobKey` varchar(255),
	`mimeType` varchar(255),
	`byteSize` int unsigned,
	`fileName` varchar(255),
	`createdAt` datetime NOT NULL
);
--> statement-breakpoint
CREATE TABLE `shares` (
	`id` char(26) PRIMARY KEY,
	`tokenHash` char(64) NOT NULL,
	`clipIds` json NOT NULL,
	`expiresAt` datetime NOT NULL,
	`createdAt` datetime NOT NULL,
	CONSTRAINT `shares_tokenHash_unique` UNIQUE INDEX(`tokenHash`)
);
