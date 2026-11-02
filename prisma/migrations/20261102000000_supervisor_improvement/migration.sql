CREATE TABLE `AreaPaceRevision` (
  `id` VARCHAR(36) NOT NULL,
  `orgId` VARCHAR(36) NOT NULL,
  `areaId` VARCHAR(36) NOT NULL,
  `paceMs` INTEGER NOT NULL,
  `effectiveAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `AreaPaceRevision_orgId_areaId_effectiveAt_idx` (`orgId`, `areaId`, `effectiveAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `AreaPaceRevision_orgId_fkey` FOREIGN KEY (`orgId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `AreaPaceRevision_areaId_fkey` FOREIGN KEY (`areaId`) REFERENCES `Area`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ShiftScheduleRevision` (
  `id` VARCHAR(36) NOT NULL,
  `orgId` VARCHAR(36) NOT NULL,
  `shiftId` VARCHAR(36) NOT NULL,
  `scope` VARCHAR(191) NOT NULL,
  `date` VARCHAR(10) NULL,
  `startMinute` INTEGER NOT NULL,
  `endMinute` INTEGER NOT NULL,
  `breaks` JSON NOT NULL,
  `effectiveAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `ShiftScheduleRevision_orgId_shiftId_effectiveAt_idx` (`orgId`, `shiftId`, `effectiveAt`),
  INDEX `ShiftScheduleRevision_shiftId_date_idx` (`shiftId`, `date`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ShiftScheduleRevision_orgId_fkey` FOREIGN KEY (`orgId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ShiftScheduleRevision_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `Shift`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `ImprovementAction` (
  `id` VARCHAR(36) NOT NULL,
  `orgId` VARCHAR(36) NOT NULL,
  `areaId` VARCHAR(36) NOT NULL,
  `workstationId` VARCHAR(36) NOT NULL,
  `reason` VARCHAR(191) NOT NULL,
  `description` TEXT NOT NULL,
  `nextStep` TEXT NOT NULL,
  `owner` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'open',
  `outcome` TEXT NULL,
  `dueDate` VARCHAR(10) NULL,
  `createdBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `closedAt` DATETIME(3) NULL,
  INDEX `ImprovementAction_orgId_areaId_status_createdAt_idx` (`orgId`, `areaId`, `status`, `createdAt`),
  INDEX `ImprovementAction_workstationId_createdAt_idx` (`workstationId`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ImprovementAction_orgId_fkey` FOREIGN KEY (`orgId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ImprovementAction_areaId_fkey` FOREIGN KEY (`areaId`) REFERENCES `Area`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ImprovementAction_workstationId_fkey` FOREIGN KEY (`workstationId`) REFERENCES `Workstation`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `TeamWin` (
  `id` VARCHAR(36) NOT NULL,
  `orgId` VARCHAR(36) NOT NULL,
  `areaId` VARCHAR(36) NOT NULL,
  `title` VARCHAR(191) NOT NULL,
  `detail` TEXT NOT NULL,
  `active` BOOLEAN NOT NULL DEFAULT true,
  `createdBy` VARCHAR(191) NOT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  INDEX `TeamWin_orgId_areaId_active_createdAt_idx` (`orgId`, `areaId`, `active`, `createdAt`),
  PRIMARY KEY (`id`),
  CONSTRAINT `TeamWin_orgId_fkey` FOREIGN KEY (`orgId`) REFERENCES `Organization`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `TeamWin_areaId_fkey` FOREIGN KEY (`areaId`) REFERENCES `Area`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `RawEvent_improvement_history_idx` ON `RawEvent` (`orgId`, `workstationId`, `type`, `occurredAt`);
