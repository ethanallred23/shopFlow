-- AlterTable
ALTER TABLE `ProcessingState` ADD COLUMN `activeCounterId` VARCHAR(100) NULL;

-- CreateTable
CREATE TABLE `DetectionCounter` (
    `deviceId` VARCHAR(36) NOT NULL,
    `ruleVersion` INTEGER NOT NULL,
    `counterId` VARCHAR(100) NOT NULL,
    `bootId` VARCHAR(100) NOT NULL,
    `totalDetectedMs` BIGINT NOT NULL,
    `detected` BOOLEAN NOT NULL,
    `sequence` INTEGER NOT NULL,
    `uptimeMs` BIGINT NOT NULL,
    `occurredAt` DATETIME(3) NULL,
    `receivedAt` DATETIME(3) NOT NULL,
    `workstationId` VARCHAR(36) NULL,

    PRIMARY KEY (`deviceId`, `ruleVersion`, `counterId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `DetectionMeasurement` (
    `id` BIGINT NOT NULL AUTO_INCREMENT,
    `rawId` BIGINT NOT NULL,
    `deviceId` VARCHAR(36) NOT NULL,
    `orgId` VARCHAR(36) NOT NULL,
    `workstationId` VARCHAR(36) NULL,
    `ruleVersion` INTEGER NOT NULL,
    `deltaMs` BIGINT NOT NULL,
    `accepted` BOOLEAN NOT NULL,
    `notice` VARCHAR(191) NULL,
    `intervalStart` DATETIME(3) NULL,
    `intervalEnd` DATETIME(3) NULL,

    INDEX `DetectionMeasurement_orgId_deviceId_ruleVersion_idx`(`orgId`, `deviceId`, `ruleVersion`),
    INDEX `DetectionMeasurement_orgId_workstationId_ruleVersion_interva_idx`(`orgId`, `workstationId`, `ruleVersion`, `intervalEnd`),
    UNIQUE INDEX `DetectionMeasurement_rawId_ruleVersion_key`(`rawId`, `ruleVersion`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DetectionCounter` MODIFY `counterId` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL, MODIFY `bootId` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
ALTER TABLE `ProcessingState` MODIFY `activeCounterId` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;
