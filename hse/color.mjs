/**
 * Warna dominan sebuah kotak deteksi.
 *
 * Warna helm hampir selalu menandai peran di lapangan — putih pengawas, kuning
 * pekerja, biru teknisi, merah pemadam — jadi mencatatnya membuat laporan bisa
 * menjawab "siapa yang melanggar" tanpa menyimpan wajah siapa pun. Ini bukan
 * pekerjaan model: mengklasifikasi warna dengan jaringan saraf berarti membayar
 * inferensi kedua untuk sesuatu yang bisa dijawab beberapa ribu piksel.
 *
 * Bekerja di ruang HSV, bukan RGB. Alasannya praktis: di RGB, helm kuning
 * terang dan helm kuning yang teduh adalah dua titik yang berjauhan; di HSV
 * keduanya berbagi hue yang sama dan hanya berbeda value.
 */

/** Ember hue dalam derajat, [batas bawah, batas atas, nama]. */
const HUE_BUCKETS = [
    [0, 12, "merah"],
    [12, 40, "oranye"],
    [40, 70, "kuning"],
    [70, 165, "hijau"],
    [165, 265, "biru"],
    // Magenta sampai merah muda dilipat ke merah: tidak ada APD ungu, dan yang
    // sebenarnya muncul di rentang ini adalah merah di bawah cahaya dingin.
    [265, 360, "merah"],
];

function rgbToHsv(r, g, b) {
    const rf = r / 255;
    const gf = g / 255;
    const bf = b / 255;
    const max = Math.max(rf, gf, bf);
    const min = Math.min(rf, gf, bf);
    const delta = max - min;

    let h = 0;
    if (delta > 0) {
        if (max === rf) h = 60 * (((gf - bf) / delta) % 6);
        else if (max === gf) h = 60 * ((bf - rf) / delta + 2);
        else h = 60 * ((rf - gf) / delta + 4);
        if (h < 0) h += 360;
    }

    return { h, s: max === 0 ? 0 : delta / max, v: max };
}

function bucketFor(h, s, v) {
    // Urutan pemeriksaan penting: piksel gelap tidak punya warna yang berarti,
    // dan piksel pucat lebih menggambarkan pencahayaan daripada cat helm.
    if (v < 0.18) return "hitam";
    if (s < 0.16) {
        if (v > 0.72) return "putih";
        if (v > 0.32) return "abu-abu";
        return "hitam";
    }
    // Oranye yang redup adalah coklat — membedakannya mencegah helm kotor
    // dilaporkan sebagai helm oranye hi-vis.
    if (v < 0.42 && h >= 12 && h < 45) return "coklat";

    for (const [lo, hi, name] of HUE_BUCKETS) {
        if (h >= lo && h < hi) return name;
    }
    return "abu-abu";
}

/**
 * Apakah frame ini praktis tanpa warna (kamera sedang mode IR malam hari).
 *
 * Tanpa pemeriksaan ini, setiap helm di malam hari akan dilaporkan "abu-abu"
 * atau "putih" dan menumpuk jadi pola palsu di laporan — seolah shift malam
 * memakai helm berbeda. Lebih jujur tidak melaporkan warna sama sekali.
 */
export function isMonochrome(frame, width, height) {
    const total = width * height;
    // Cukup beberapa ratus titik tersebar untuk menilai seluruh frame.
    const step = Math.max(1, Math.floor(total / 400));
    let chromatic = 0;
    let counted = 0;

    for (let i = 0; i < total; i += step) {
        const p = i * 3;
        const r = frame[p];
        const g = frame[p + 1];
        const b = frame[p + 2];
        const max = Math.max(r, g, b);
        if (max < 20) continue; // piksel hitam tidak memberi informasi
        counted++;
        if ((max - Math.min(r, g, b)) / max > 0.18) chromatic++;
    }

    if (counted < 50) return true;
    return chromatic / counted < 0.06;
}

/**
 * Warna dominan di dalam sebuah kotak.
 *
 * Hanya 60% bagian tengah kotak yang dibaca. Tepi kotak deteksi hampir selalu
 * memuat latar belakang, dan latar belakang inilah yang paling sering merebut
 * suara mayoritas — helm kuning di depan dinding krem terbaca "putih" kalau
 * seluruh kotak ikut dihitung.
 *
 * @param {Buffer} frame RGB24 rapat, panjang width*height*3
 * @param {[number,number,number,number]} box [x1, y1, x2, y2] dalam piksel frame
 * @returns {{name: string, share: number}|null}
 */
export function dominantColor(frame, width, height, box) {
    const [x1, y1, x2, y2] = box;
    const insetX = (x2 - x1) * 0.2;
    const insetY = (y2 - y1) * 0.2;

    const left = Math.max(0, Math.round(x1 + insetX));
    const top = Math.max(0, Math.round(y1 + insetY));
    const right = Math.min(width - 1, Math.round(x2 - insetX));
    const bottom = Math.min(height - 1, Math.round(y2 - insetY));

    if (right <= left || bottom <= top) return null;

    // Ambil sampel dengan langkah, bukan setiap piksel: kotak helm sedekat apa
    // pun tidak memberi informasi warna lebih dari beberapa ratus titik.
    const cols = right - left + 1;
    const rows = bottom - top + 1;
    const step = Math.max(1, Math.round(Math.sqrt((cols * rows) / 400)));

    const weights = new Map();
    let total = 0;

    for (let y = top; y <= bottom; y += step) {
        for (let x = left; x <= right; x += step) {
            const p = (y * width + x) * 3;
            const { h, s, v } = rgbToHsv(frame[p], frame[p + 1], frame[p + 2]);
            const name = bucketFor(h, s, v);
            // Piksel jenuh lebih menentukan warna cat daripada piksel pucat,
            // jadi suaranya diberi bobot lebih besar.
            const weight = s < 0.16 ? 1 : 1 + s * 2;
            weights.set(name, (weights.get(name) ?? 0) + weight);
            total += weight;
        }
    }

    if (total === 0) return null;

    let best = null;
    let bestWeight = 0;
    for (const [name, weight] of weights) {
        if (weight > bestWeight) {
            best = name;
            bestWeight = weight;
        }
    }

    return best ? { name: best, share: bestWeight / total } : null;
}

/**
 * Warna dominan, atau null kalau tidak ada warna yang benar-benar menonjol.
 *
 * Kotak yang terbagi rata antara tiga warna berarti kotaknya memang tidak
 * berisi satu helm — melaporkan pemenang tipis dari kotak seperti itu hanya
 * menambah derau ke laporan.
 */
export function confidentColor(frame, width, height, box, minShare = 0.38) {
    const result = dominantColor(frame, width, height, box);
    if (!result || result.share < minShare) return null;
    return result.name;
}
