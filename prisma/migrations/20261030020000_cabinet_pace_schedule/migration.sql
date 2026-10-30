ALTER TABLE `Area` ADD COLUMN `cabinetPaceMs` INTEGER NOT NULL DEFAULT 600000;

CREATE TABLE `ShiftDaySchedule` (
  `id` VARCHAR(36) NOT NULL,
  `orgId` VARCHAR(36) NOT NULL,
  `shiftId` VARCHAR(36) NOT NULL,
  `date` VARCHAR(10) NOT NULL,
  `startMinute` INTEGER NOT NULL,
  `endMinute` INTEGER NOT NULL,
  `breaks` JSON NOT NULL,
  UNIQUE INDEX `ShiftDaySchedule_shiftId_date_key` (`shiftId`, `date`),
  INDEX `ShiftDaySchedule_orgId_date_idx` (`orgId`, `date`),
  PRIMARY KEY (`id`),
  CONSTRAINT `ShiftDaySchedule_shiftId_fkey` FOREIGN KEY (`shiftId`) REFERENCES `Shift`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
);
