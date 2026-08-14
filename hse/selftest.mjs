import { roleOf, ROLE, describeClasses, DEFAULT_CLASSES } from "./classes.mjs";
import { assessFrame, toNormalized } from "./assess.mjs";
import { dominantColor, isMonochrome } from "./color.mjs";
import { letterboxFor } from "./frames.mjs";

/**
 * Uji mandiri logika HSE. Jalankan: npm run hse:test
 *
 * Tidak memerlukan model, kamera, maupun database — semua yang diuji di sini
 * adalah fungsi murni. Justru di situlah kesalahan paling mahal bersembunyi:
 * salah memetakan "NO-Hardhat" ke helm terpakai, atau membiarkan helm yang
 * dijinjing dihitung sebagai helm yang dipakai, menghasilkan laporan kepatuhan
 * yang rapi dan sepenuhnya salah. Kesalahan seperti itu tidak pernah muncul
 * sebagai error — hanya sebagai angka yang terlihat wajar.
 *
 * Kalau nanti mengganti model atau mengubah zona geometri, jalankan ini dulu.
 */

let failed = 0;
const eq = (label, actual, expected) => {
    const ok = JSON.stringify(actual) === JSON.stringify(expected);
    if (!ok) failed++;
    console.log(`${ok ? "  ok  " : "FAIL  "} ${label}${ok ? "" : ` — dapat ${JSON.stringify(actual)}, harusnya ${JSON.stringify(expected)}`}`);
};

console.log("\n== pemetaan kelas ==");
eq("Hardhat -> HELMET", roleOf("Hardhat"), ROLE.HELMET);
eq("NO-Hardhat -> NO_HELMET (bukan HELMET!)", roleOf("NO-Hardhat"), ROLE.NO_HELMET);
eq("NO-Safety Vest -> NO_VEST", roleOf("NO-Safety Vest"), ROLE.NO_VEST);
eq("Safety Vest -> VEST", roleOf("Safety Vest"), ROLE.VEST);
eq("head -> NO_HELMET (SHWD)", roleOf("head"), ROLE.NO_HELMET);
eq("no_helmet -> NO_HELMET", roleOf("no_helmet"), ROLE.NO_HELMET);
eq("Person -> PERSON", roleOf("Person"), ROLE.PERSON);
eq("vehicle -> IGNORE", roleOf("vehicle"), ROLE.IGNORE);
eq("Mask -> IGNORE", roleOf("Mask"), ROLE.IGNORE);
const summary = describeClasses(DEFAULT_CLASSES);
eq("daftar bawaan punya person/helm/vest", [summary.hasPerson, summary.hasHelmet, summary.hasVest], [true, true, true]);

// -------------------------------------------------------------------
const SIZE = 480;
const blank = Buffer.alloc(SIZE * SIZE * 3, 100);
const rules = { requireHelm: true, requireVest: true, minPersonHeight: 0.12, readColors: false };
const det = (role, box, score = 0.9) => ({ role, box, score });

// Orang berdiri: x 200..280, y 100..400 (tinggi 300 = 62% frame)
const person = det(ROLE.PERSON, [200, 100, 280, 400]);

console.log("\n== asosiasi APD ke orang ==");
{
    // Helm di kepala (y 95..130, dalam 38% teratas = sampai y=214)
    const helmet = det(ROLE.HELMET, [215, 95, 265, 130]);
    const r = assessFrame([person, helmet], blank, SIZE, rules);
    eq("helm di kepala -> dipakai", [r.persons[0].helmet, r.tally.helmetOk], [true, 1]);
    eq("rompi tak terlihat -> null, bukan pelanggaran", [r.persons[0].vest, r.persons[0].violating], [null, false]);
    // Overlay menggambar kotak ini, jadi ia harus kotak deteksi yang benar-benar
    // dipakai memutuskan — bukan hasil perhitungan ulang dari zona kepala.
    eq("  helmetBox = kotak deteksinya", r.persons[0].helmetBox, helmet.box);
    eq("  vestBox null saat rompi tak terbaca", r.persons[0].vestBox, null);
}
{
    // Helm dijinjing setinggi pinggang (y 300..335) — di luar zona kepala
    const r = assessFrame([person, det(ROLE.HELMET, [215, 300, 265, 335])], blank, SIZE, rules);
    eq("helm dijinjing -> TIDAK dihitung dipakai", r.persons[0].helmet, null);
    eq("  dan tidak masuk helmetOk", r.tally.helmetOk, 0);
    // Kotak yang tidak diberikan ke siapa pun tidak boleh sampai ke overlay:
    // menggambarnya akan menandai helm yang dijinjing sebagai helm yang dipakai.
    eq("  helmetBox null -> tidak digambar", r.persons[0].helmetBox, null);
}
{
    const bareHead = det(ROLE.NO_HELMET, [215, 95, 265, 130]);
    const r = assessFrame([person, bareHead], blank, SIZE, rules);
    eq("kepala telanjang -> pelanggaran", [r.persons[0].helmet, r.persons[0].violating, r.violationType], [false, true, "NO_HELMET"]);
    // helmetBox saat helmet === false berarti kepala telanjang, dan justru itu
    // yang perlu digambar merah supaya penanda menunjuk ke kepalanya.
    eq("  helmetBox = kotak kepala telanjang", r.persons[0].helmetBox, bareHead.box);
}
{
    const r = assessFrame([
        person,
        det(ROLE.NO_HELMET, [215, 95, 265, 130]),
        det(ROLE.NO_VEST, [205, 160, 275, 300]),
    ], blank, SIZE, rules);
    eq("tanpa helm + tanpa rompi", r.violationType, "NO_HELMET_NO_VEST");
    eq("  hanya 1 pelanggar (orang yang sama)", r.tally.violatorCount, 1);
}
{
    // Helm tergeletak di lantai, jauh dari siapa pun
    const r = assessFrame([person, det(ROLE.HELMET, [50, 440, 90, 470])], blank, SIZE, rules);
    eq("helm tergeletak -> diabaikan", [r.persons[0].helmet, r.tally.helmetOk], [null, 0]);
}
{
    // Dua orang berdempetan, hanya satu helm terlihat
    const p2 = det(ROLE.PERSON, [285, 100, 365, 400]);
    const r = assessFrame([person, p2, det(ROLE.HELMET, [280, 95, 320, 130])], blank, SIZE, rules);
    const worn = r.persons.filter((p) => p.helmet === true).length;
    eq("satu helm tidak diklaim dua orang", worn, 1);
}
{
    // Orang terlalu jauh/kecil (tinggi 40px = 8% frame)
    const tiny = det(ROLE.PERSON, [10, 10, 30, 50]);
    const r = assessFrame([tiny, det(ROLE.NO_HELMET, [12, 8, 28, 20])], blank, SIZE, rules);
    eq("orang terlalu kecil -> tidak dihitung", r.tally.personCount, 0);
    // Tapi HARUS tercatat sebagai blind spot. Sebelumnya orang ini hilang tanpa
    // jejak, sehingga area jauh dari kamera dilaporkan "tidak ada pelanggaran"
    // padahal yang sebenarnya terjadi adalah "tidak terlihat".
    eq("  dan tercatat sebagai tooSmall", r.tally.tooSmall, 1);
}

console.log("\n== blind spot: yang tidak terlihat sistem ==");
{
    const r = assessFrame([person], blank, SIZE, rules);
    eq(
        "tak ada APD terdeteksi -> unknown, bukan ok/missing",
        [r.tally.helmetUnknown, r.tally.vestUnknown, r.tally.helmetOk, r.tally.helmetMissing],
        [1, 1, 0, 0]
    );
    eq("  dan bukan pelanggaran", r.violationType, null);
}
{
    // Helm terbaca, rompi tertutup: hanya rompinya yang unknown.
    const r = assessFrame([person, det(ROLE.HELMET, [215, 95, 265, 130])], blank, SIZE, rules);
    eq("sebagian terbaca -> unknown hanya yang tertutup", [r.tally.helmetUnknown, r.tally.vestUnknown], [0, 1]);
}
{
    // Semua orang terdeteksi tapi tidak ada yang lolos ambang ukuran: jalur
    // cadangan TIDAK boleh jalan, dan seluruhnya harus terhitung tooSmall.
    const a = det(ROLE.PERSON, [10, 10, 30, 50]);
    const b = det(ROLE.PERSON, [40, 10, 60, 50]);
    const r = assessFrame([a, b], blank, SIZE, rules);
    eq("semua orang terlalu kecil -> tooSmall menghitung semuanya", [r.tally.personCount, r.tally.tooSmall], [0, 2]);
}
{
    // Orang tiruan dari kepala yang juga terlalu kecil harus ikut terhitung —
    // jalur cadangan punya saringan ukurannya sendiri, dan dulu buangannya
    // tidak dilaporkan ke mana pun.
    const r = assessFrame([det(ROLE.NO_HELMET, [200, 100, 206, 104])], blank, SIZE, rules);
    eq("kepala tiruan terlalu kecil -> tooSmall", [r.tally.personCount, r.tally.tooSmall], [0, 1]);
}
{
    // Aturan per kamera: area hanya wajib rompi
    const vestOnly = { ...rules, requireHelm: false };
    const r = assessFrame([person, det(ROLE.NO_HELMET, [215, 95, 265, 130])], blank, SIZE, vestOnly);
    eq("helm tidak wajib -> bukan pelanggaran", [r.persons[0].helmet, r.persons[0].violating, r.violationType], [false, false, null]);
}
{
    // Model tanpa kelas Person (SHWD): kepala telanjang saja
    const head = det(ROLE.NO_HELMET, [200, 100, 260, 160]);
    const r = assessFrame([head], blank, SIZE, rules);
    eq("tanpa kelas Person -> orang disimpulkan dari kepala", [r.tally.personCount, r.violationType], [1, "NO_HELMET"]);
    // Kotak orangnya tebakan geometri (tinggi 6x kepala). Flag ini harus terbawa
    // sampai overlay, yang menggambarnya putus-putus — kotak solid akan
    // mengklaim ketepatan yang tidak dimiliki angka itu.
    eq("  ditandai inferred", r.persons[0].inferred, true);
    eq("  helmetBox tetap kotak kepala aslinya", r.persons[0].helmetBox, head.box);
}

console.log("\n== warna ==");
{
    const frame = Buffer.alloc(SIZE * SIZE * 3);
    // Isi kotak 100..200 dengan kuning (250,204,21)
    for (let y = 100; y < 200; y++) for (let x = 100; x < 200; x++) {
        const p = (y * SIZE + x) * 3;
        frame[p] = 250; frame[p + 1] = 204; frame[p + 2] = 21;
    }
    eq("helm kuning terbaca kuning", dominantColor(frame, SIZE, SIZE, [100, 100, 200, 200])?.name, "kuning");
}
{
    const frame = Buffer.alloc(SIZE * SIZE * 3);
    for (let y = 100; y < 200; y++) for (let x = 100; x < 200; x++) {
        const p = (y * SIZE + x) * 3;
        frame[p] = 245; frame[p + 1] = 245; frame[p + 2] = 245;
    }
    eq("helm putih terbaca putih", dominantColor(frame, SIZE, SIZE, [100, 100, 200, 200])?.name, "putih");
}
{
    const frame = Buffer.alloc(SIZE * SIZE * 3);
    for (let y = 100; y < 200; y++) for (let x = 100; x < 200; x++) {
        const p = (y * SIZE + x) * 3;
        frame[p] = 251; frame[p + 1] = 146; frame[p + 2] = 60;
    }
    eq("rompi oranye terbaca oranye", dominantColor(frame, SIZE, SIZE, [100, 100, 200, 200])?.name, "oranye");
}
{
    // Frame abu-abu penuh = mode inframerah
    const gray = Buffer.alloc(SIZE * SIZE * 3, 130);
    eq("frame IR terdeteksi monokrom", isMonochrome(gray, SIZE, SIZE), true);
    const color = Buffer.alloc(SIZE * SIZE * 3);
    for (let i = 0; i < SIZE * SIZE; i++) { color[i * 3] = 250; color[i * 3 + 1] = 204; color[i * 3 + 2] = 21; }
    eq("frame berwarna bukan monokrom", isMonochrome(color, SIZE, SIZE), false);
}

console.log("\n== letterbox & pemetaan koordinat ==");
{
    const lb = letterboxFor(704, 576, 480);   // 4:3-ish
    eq("tinggi terisi penuh", lb.height, 392);
    eq("pad kiri-kanan nol untuk sumber lebih lebar", lb.padX, 0);
    // Kotak yang tepat menutupi seluruh gambar harus memetakan ke 0,0,1,1
    const full = toNormalized([lb.padX, lb.padY, lb.padX + lb.width, lb.padY + lb.height], lb);
    const round = (v) => Math.round(v * 1000) / 1000;
    eq("kotak penuh -> 0,0,1,1", full.map(round), [0, 0, 1, 1]);
    // Kotak di tengah gambar
    const mid = toNormalized([lb.padX + lb.width / 2, lb.padY + lb.height / 2, lb.padX + lb.width, lb.padY + lb.height], lb);
    eq("kotak kuadran kanan-bawah -> 0.5,0.5,0.5,0.5", mid.map(round), [0.5, 0.5, 0.5, 0.5]);
}
{
    const lb = letterboxFor(1920, 1080, 480);
    eq("16:9 -> lebar penuh", [lb.width, lb.padX], [480, 0]);
    eq("16:9 -> ada pad atas-bawah", lb.padY > 0, true);
}

console.log(failed === 0 ? "\nSEMUA LULUS\n" : `\n${failed} GAGAL\n`);
process.exit(failed === 0 ? 0 : 1);
