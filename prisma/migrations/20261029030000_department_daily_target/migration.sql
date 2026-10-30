ALTER TABLE `Area` ADD COLUMN `dailyTarget` INTEGER NOT NULL DEFAULT 0;

-- Preserve each department's existing combined goal when introducing one
-- shared target. The station share is calculated from this value at read time.
UPDATE `Area` AS a
SET a.`dailyTarget` = (
  SELECT COALESCE(SUM(w.`target`), 0)
  FROM `Workstation` AS w
  WHERE w.`areaId` = a.`id`
);
