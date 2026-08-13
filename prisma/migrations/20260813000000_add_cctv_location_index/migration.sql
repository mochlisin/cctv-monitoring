-- Index untuk query bounding-box peta (getPublicCctvsInBounds)
ALTER TABLE `cctv` ADD INDEX `cctv_latitude_longitude_idx` (`latitude`, `longitude`);
