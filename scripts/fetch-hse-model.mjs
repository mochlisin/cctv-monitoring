import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { pipeline } from "stream/promises";
import { Readable } from "stream";

/**
 * Memasang bobot model PPE.
 *
 * Berkas .onnx tidak ikut di repositori (puluhan megabyte), dan sengaja tidak
 * ada URL bawaan yang di-hardcode di sini. Model deteksi APD menentukan apakah
 * seorang pekerja dilaporkan melanggar atau tidak — asalnya harus merupakan
 * keputusan sadar yang tercatat di .env, bukan alamat yang kebetulan tertulis
 * di skrip dan bisa berubah isi tanpa ada yang menyadarinya.
 *
 *   npm run hse:model                  # memakai HSE_MODEL_URL dari .env
 *   npm run hse:model -- <url>         # atau URL langsung
 */

const INSTRUCTIONS = `
Belum ada URL model. Dua cara memasangnya:

1) Ekspor sendiri dari ultralytics (paling terkendali, di mesin pengembang —
   bukan di server; server tidak perlu Python sama sekali):

     pip install ultralytics
     yolo export model=<bobot-ppe-anda>.pt format=onnx imgsz=480 opset=12 simplify=True

   Bobot PPE siap pakai yang umum: hasil latihan YOLO pada dataset Roboflow
   "Construction Site Safety" (css-data) atau SH17. Salin hasilnya ke
   models/ppe.onnx, lalu samakan models/ppe.classes.json dengan urutan kelas
   yang tercetak saat latihan (kunci "names" pada data.yaml).

2) Unduh dari URL yang Anda tentukan:

     HSE_MODEL_URL="https://..." npm run hse:model
     npm run hse:model -- https://...

Setelah terpasang, jalankan "npm run hse". Worker akan menolak start kalau
daftar kelasnya tidak memuat helm maupun rompi — itu penjaga terhadap
tertukarnya berkas dengan model umum (COCO).

CATATAN PENTING soal imgsz: nilai saat ekspor harus sama dengan HSE_INPUT_SIZE.
Ekspor YOLO menghasilkan graf berukuran tetap, jadi model imgsz=640 yang diberi
masukan 480 akan ditolak ONNX Runtime saat start.
`;

const url = process.argv[2] || process.env.HSE_MODEL_URL;
const target = process.env.HSE_MODEL_PATH || path.join(process.cwd(), "models", "ppe.onnx");

if (!url) {
    console.log(INSTRUCTIONS);
    process.exit(1);
}

async function main() {
    await fsp.mkdir(path.dirname(target), { recursive: true });

    console.log(`Mengunduh model dari ${url}`);
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok || !response.body) {
        throw new Error(`Server menjawab ${response.status} ${response.statusText}`);
    }

    // Ditulis ke berkas sementara lebih dulu. Unduhan yang putus di tengah akan
    // menghasilkan .onnx yang rusak tapi berukuran wajar, dan worker baru akan
    // gagal saat start berikutnya — jauh dari penyebabnya.
    const temporary = `${target}.download`;
    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(temporary));

    const { size } = await fsp.stat(temporary);
    if (size < 1_000_000) {
        await fsp.rm(temporary, { force: true });
        throw new Error(
            `Berkas hanya ${size} byte — hampir pasti halaman error, bukan model. ` +
                "Periksa URL-nya (tautan Google Drive/GitHub harus versi unduh langsung)."
        );
    }

    await fsp.rename(temporary, target);
    console.log(`Model tersimpan di ${target} (${(size / 1_048_576).toFixed(1)} MB)`);
    console.log(
        "Pastikan models/ppe.classes.json cocok dengan urutan kelas model ini, lalu jalankan: npm run hse"
    );
}

main().catch((error) => {
    console.error(`Gagal: ${error.message}`);
    process.exit(1);
});
