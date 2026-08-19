-- Dimensi frame asli tiap kamera, untuk kamera portrait / corridor mode.
-- Nullable tanpa default: tidak ada backfill, tidak ada tabel yang ditulis ulang.
ALTER TABLE `cctv`
  ADD COLUMN `frameWidth` INT NULL,
  ADD COLUMN `frameHeight` INT NULL;
