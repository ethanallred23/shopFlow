CREATE TABLE `DeviceCommand` (
    `id` VARCHAR(36) NOT NULL,
    `deviceId` VARCHAR(36) NOT NULL,
    `type` VARCHAR(40) NOT NULL,
    `payload` JSON NOT NULL,
    `status` VARCHAR(20) NOT NULL DEFAULT 'pending',
    `createdBy` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,
    `acknowledgedAt` DATETIME(3) NULL,
    `result` JSON NULL,
    `error` VARCHAR(500) NULL,
    INDEX `DeviceCommand_deviceId_status_createdAt_idx`(`deviceId`, `status`, `createdAt`),
    INDEX `DeviceCommand_expiresAt_idx`(`expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `DeviceCommand` ADD CONSTRAINT `DeviceCommand_deviceId_fkey` FOREIGN KEY (`deviceId`) REFERENCES `Device`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
