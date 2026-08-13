-- HSE monitoring: deteksi helm & rompi keselamatan.

-- Opt-in per kamera. Menyalakan ini membuat worker menarik RTSP kamera
-- terus-menerus (bukan on-demand lagi), jadi defaultnya mati.
ALTER TABLE `cctv`
  ADD COLUMN `hseEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `hseRequireHelm` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `hseRequireVest` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `hseMinDuration` INTEGER NOT NULL DEFAULT 10;

ALTER TABLE `cctv` ADD INDEX `cctv_hseEnabled_isActive_idx` (`hseEnabled`, `isActive`);

-- Satu baris = satu periode pelanggaran berkelanjutan, bukan satu frame.
CREATE TABLE `hse_event` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cctvId` INTEGER NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `startedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `endedAt` DATETIME(3) NOT NULL,
    `duration` INTEGER NOT NULL DEFAULT 0,
    `personCount` INTEGER NOT NULL DEFAULT 0,
    `violatorCount` INTEGER NOT NULL DEFAULT 0,
    `maxConfidence` DOUBLE NOT NULL DEFAULT 0,
    `colors` JSON NULL,
    `snapshot` VARCHAR(255) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'OPEN',
    `acknowledgedById` INTEGER NULL,
    `acknowledgedAt` DATETIME(3) NULL,
    `note` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    INDEX `hse_event_cctvId_startedAt_idx`(`cctvId`, `startedAt`),
    INDEX `hse_event_cctvId_status_idx`(`cctvId`, `status`),
    INDEX `hse_event_startedAt_idx`(`startedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Agregat per selang waktu — sumber angka kepatuhan di dasbor.
CREATE TABLE `hse_bucket` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `cctvId` INTEGER NOT NULL,
    `bucketStart` DATETIME(3) NOT NULL,
    `frames` INTEGER NOT NULL DEFAULT 0,
    `personCount` INTEGER NOT NULL DEFAULT 0,
    `helmetOk` INTEGER NOT NULL DEFAULT 0,
    `helmetMissing` INTEGER NOT NULL DEFAULT 0,
    `vestOk` INTEGER NOT NULL DEFAULT 0,
    `vestMissing` INTEGER NOT NULL DEFAULT 0,
    `colors` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `hse_bucket_cctvId_bucketStart_key`(`cctvId`, `bucketStart`),
    INDEX `hse_bucket_bucketStart_idx`(`bucketStart`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `hse_event` ADD CONSTRAINT `hse_event_cctvId_fkey`
  FOREIGN KEY (`cctvId`) REFERENCES `cctv`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `hse_bucket` ADD CONSTRAINT `hse_bucket_cctvId_fkey`
  FOREIGN KEY (`cctvId`) REFERENCES `cctv`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
