-- Consolidate the existing floor under one shop without deleting departments or measurements.
INSERT INTO `Shop` (`id`, `orgId`, `name`)
SELECT UUID(), o.`id`, 'Quality Craft Wood Works' FROM `Organization` o
WHERE NOT EXISTS (SELECT 1 FROM `Shop` s WHERE s.`orgId` = o.`id`);
CREATE TEMPORARY TABLE `CanonicalShop` AS SELECT `orgId`, MIN(`id`) AS `id` FROM `Shop` GROUP BY `orgId`;
UPDATE `Area` a JOIN `CanonicalShop` s ON a.`orgId` = s.`orgId` SET a.`shopId` = s.`id`;
DELETE s FROM `Shop` s JOIN `CanonicalShop` c ON s.`orgId` = c.`orgId` WHERE s.`id` <> c.`id`;
UPDATE `Shop` SET `name` = 'Quality Craft Wood Works';
DROP TEMPORARY TABLE `CanonicalShop`;
CREATE UNIQUE INDEX `Shop_orgId_key` ON `Shop` (`orgId`);

CREATE TABLE `OperatorAssignment` (
  `id` VARCHAR(36) NOT NULL,
  `orgId` VARCHAR(36) NOT NULL,
  `workstationId` VARCHAR(36) NOT NULL,
  `userId` VARCHAR(36) NOT NULL,
  `operatorName` VARCHAR(191) NOT NULL,
  `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `endedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  INDEX `OperatorAssignment_orgId_workstationId_startedAt_idx` (`orgId`, `workstationId`, `startedAt`),
  INDEX `OperatorAssignment_userId_startedAt_idx` (`userId`, `startedAt`),
  CONSTRAINT `OperatorAssignment_orgId_fkey` FOREIGN KEY (`orgId`) REFERENCES `Organization` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `OperatorAssignment_workstationId_fkey` FOREIGN KEY (`workstationId`) REFERENCES `Workstation` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `OperatorAssignment_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
INSERT INTO `OperatorAssignment` (`id`, `orgId`, `workstationId`, `userId`, `operatorName`)
SELECT UUID(), `orgId`, `workstationId`, `id`, `name` FROM `User` WHERE `workstationId` IS NOT NULL;
-- If an old workstation has multiple people, retain a deterministic current operator.
-- Preserve the other associations as closed history; their department memberships remain.
CREATE TEMPORARY TABLE `CurrentOperator` AS SELECT `workstationId`, MIN(`id`) AS `id` FROM `User` WHERE `workstationId` IS NOT NULL GROUP BY `workstationId`;
UPDATE `OperatorAssignment` a JOIN `CurrentOperator` c ON a.`workstationId` = c.`workstationId`
SET a.`endedAt` = a.`startedAt` WHERE a.`userId` <> c.`id`;
UPDATE `User` u JOIN `CurrentOperator` c ON u.`workstationId` = c.`workstationId` SET u.`workstationId` = NULL WHERE u.`id` <> c.`id`;
DROP TEMPORARY TABLE `CurrentOperator`;
CREATE UNIQUE INDEX `User_workstationId_key` ON `User` (`workstationId`);
