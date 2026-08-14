-- Cakupan & blind spot HSE.
--
-- Alasannya keselamatan, bukan kelengkapan statistik. Sebelum ini, angka
-- kepatuhan disajikan tanpa cara apa pun untuk mengetahui BERAPA BANYAK yang
-- sebenarnya terlihat: kamera yang mati, orang yang terlalu jauh untuk dinilai,
-- dan APD yang tertutup semuanya menghasilkan laporan yang terlihat bersih.
-- "0 pelanggaran" pada kamera yang tidak melihat apa pun tampak identik dengan
-- lokasi yang benar-benar patuh — dan itu justru kesalahan yang paling mahal
-- pada sistem pemantauan keselamatan.

ALTER TABLE `hse_bucket`
  -- Orang terdeteksi tapi dibuang karena di bawah HSE_MIN_PERSON_HEIGHT.
  -- Bukan pelanggaran, bukan kepatuhan — terlalu jauh untuk dinilai.
  ADD COLUMN `tooSmall` INTEGER NOT NULL DEFAULT 0,
  -- APD yang tidak dapat dinilai (tertutup, membelakangi kamera). Dipisah dari
  -- Ok/Missing dengan sengaja.
  ADD COLUMN `helmetUnknown` INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN `vestUnknown` INTEGER NOT NULL DEFAULT 0,
  -- Frame mode inframerah: warna tidak dibaca, kualitas deteksi turun.
  ADD COLUMN `monoFrames` INTEGER NOT NULL DEFAULT 0,
  -- Detik yang benar-benar terwakili analisis. Dibandingkan panjang selang,
  -- inilah persentase cakupan.
  ADD COLUMN `coveredSeconds` INTEGER NOT NULL DEFAULT 0;
