-- CreateTable
CREATE TABLE `Organization` (
    `id` VARCHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `timezone` VARCHAR(191) NOT NULL DEFAULT 'America/Denver',
    `demo` BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Shop` (
    `id` VARCHAR(36) NOT NULL,
    `orgId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,

    INDEX `Shop_orgId_idx`(`orgId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Area` (
    `id` VARCHAR(36) NOT NULL,
    `orgId` VARCHAR(36) NOT NULL,
    `shopId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,

    INDEX `Area_orgId_shopId_idx`(`orgId`, `shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Workstation` (
    `id` VARCHAR(36) NOT NULL,
    `orgId` VARCHAR(36) NOT NULL,
    `areaId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `product` VARCHAR(191) NOT NULL DEFAULT '',
    `job` VARCHAR(191) NOT NULL DEFAULT '',
    `target` INTEGER NOT NULL DEFAULT 400,
    `minIntervalMs` INTEGER NOT NULL DEFAULT 500,

    INDEX `Workstation_orgId_areaId_idx`(`orgId`, `areaId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Shift` (
    `id` VARCHAR(36) NOT NULL,
    `orgId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `startMinute` INTEGER NOT NULL,
    `endMinute` INTEGER NOT NULL,
    `breaks` JSON NOT NULL,

    INDEX `Shift_orgId_idx`(`orgId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `User` (
    `id` VARCHAR(36) NOT NULL,
    `orgId` VARCHAR(36) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NOT NULL DEFAULT 'viewer',

    UNIQUE INDEX `User_email_key`(`email`),
    INDEX `User_orgId_idx`(`orgId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` VARCHAR(64) NOT NULL,
    `userId` VARCHAR(36) NOT NULL,
    `csrf` VARCHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,

    INDEX `Session_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Device` (
    `id` VARCHAR(36) NOT NULL,
    `orgId` VARCHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `workstationId` VARCHAR(36) NULL,
    `capabilities` JSON NOT NULL,
    `firmware` VARCHAR(191) NOT NULL DEFAULT 'unknown',
    `disabled` BOOLEAN NOT NULL DEFAULT false,
    `archived` BOOLEAN NOT NULL DEFAULT false,
    `lastHeartbeat` DATETIME(3) NULL,
    `lastEvent` DATETIME(3) NULL,

    INDEX `Device_orgId_idx`(`orgId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Credential` (
    `id` VARCHAR(36) NOT NULL,
    `deviceId` VARCHAR(36) NOT NULL,
    `tokenHash` VARCHAR(64) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `revokedAt` DATETIME(3) NULL,

    UNIQUE INDEX `Credential_tokenHash_key`(`tokenHash`),
    INDEX `Credential_deviceId_idx`(`deviceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Assignment` (
    `id` VARCHAR(36) NOT NULL,
    `deviceId` VARCHAR(36) NOT NULL,
    `workstationId` VARCHAR(36) NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NULL,

    INDEX `Assignment_deviceId_startedAt_idx`(`deviceId`, `startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RawEvent` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `orgId` VARCHAR(36) NOT NULL,
    `deviceId` VARCHAR(36) NOT NULL,
    `eventId` VARCHAR(100) NOT NULL,
    `workstationId` VARCHAR(36) NULL,
    `bootId` VARCHAR(100) NOT NULL,
    `sequence` INTEGER NOT NULL,
    `uptimeMs` BIGINT NOT NULL,
    `type` VARCHAR(80) NOT NULL,
    `schemaVersion` INTEGER NOT NULL,
    `data` JSON NOT NULL,
    `occurredAt` DATETIME(3) NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `timeQuality` VARCHAR(191) NOT NULL,
    `minIntervalMs` INTEGER NOT NULL,
    `product` VARCHAR(191) NOT NULL,
    `job` VARCHAR(191) NOT NULL,

    INDEX `RawEvent_orgId_workstationId_receivedAt_idx`(`orgId`, `workstationId`, `receivedAt`),
    INDEX `RawEvent_deviceId_id_idx`(`deviceId`, `id`),
    UNIQUE INDEX `RawEvent_deviceId_eventId_key`(`deviceId`, `eventId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ProcessingState` (
    `deviceId` VARCHAR(36) NOT NULL,
    `ruleVersion` INTEGER NOT NULL,
    `activeBoot` VARCHAR(100) NULL,
    `lastRawId` BIGINT NOT NULL DEFAULT 0,

    PRIMARY KEY (`deviceId`, `ruleVersion`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `BootState` (
    `deviceId` VARCHAR(36) NOT NULL,
    `ruleVersion` INTEGER NOT NULL,
    `bootId` VARCHAR(100) NOT NULL,
    `sequence` INTEGER NOT NULL DEFAULT -1,
    `detected` BOOLEAN NULL,
    `lastCountUptime` BIGINT NULL,
    `lastUptime` BIGINT NOT NULL DEFAULT 0,

    PRIMARY KEY (`deviceId`, `ruleVersion`, `bootId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Measurement` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `rawId` BIGINT NOT NULL,
    `orgId` VARCHAR(36) NOT NULL,
    `workstationId` VARCHAR(36) NULL,
    `ruleVersion` INTEGER NOT NULL,
    `count` INTEGER NOT NULL DEFAULT 0,
    `durationMs` INTEGER NULL,
    `notice` VARCHAR(191) NULL,
    `at` DATETIME(3) NULL,
    `product` VARCHAR(191) NOT NULL,
    `job` VARCHAR(191) NOT NULL,

    INDEX `Measurement_orgId_workstationId_ruleVersion_at_idx`(`orgId`, `workstationId`, `ruleVersion`, `at`),
    UNIQUE INDEX `Measurement_rawId_ruleVersion_key`(`rawId`, `ruleVersion`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Note` (
    `id` VARCHAR(36) NOT NULL,
    `orgId` VARCHAR(36) NOT NULL,
    `workstationId` VARCHAR(36) NOT NULL,
    `author` VARCHAR(191) NOT NULL,
    `text` TEXT NOT NULL,
    `reason` VARCHAR(191) NULL,
    `minutes` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Note_orgId_workstationId_createdAt_idx`(`orgId`, `workstationId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
