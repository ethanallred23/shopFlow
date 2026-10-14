-- Event and boot identifiers are opaque case-sensitive protocol identifiers.
ALTER TABLE `RawEvent`
  MODIFY `eventId` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
  MODIFY `bootId` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
ALTER TABLE `BootState`
  MODIFY `bootId` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL;
ALTER TABLE `ProcessingState`
  MODIFY `activeBoot` VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL;
