ALTER TABLE `User` ADD COLUMN `workstationId` VARCHAR(36) NULL;
CREATE INDEX `User_workstationId_idx` ON `User`(`workstationId`);
ALTER TABLE `User` ADD CONSTRAINT `User_workstationId_fkey` FOREIGN KEY (`workstationId`) REFERENCES `Workstation`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
