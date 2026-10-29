ALTER TABLE `User` ADD COLUMN `areaId` VARCHAR(36) NULL;
UPDATE `User` AS u JOIN `Workstation` AS w ON u.`workstationId` = w.`id` AND u.`orgId` = w.`orgId` SET u.`areaId` = w.`areaId`;
CREATE INDEX `User_areaId_idx` ON `User`(`areaId`);
ALTER TABLE `User` ADD CONSTRAINT `User_areaId_fkey` FOREIGN KEY (`areaId`) REFERENCES `Area`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
