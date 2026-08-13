import { ROLE } from "./classes.mjs";
import { confidentColor } from "./color.mjs";

/**
 * Dari kotak-kotak deteksi menjadi kesimpulan "APD ini dipakai atau tidak".
 *
 * Ini bagian yang paling sering dilewatkan sistem PPE, dan yang paling
 * menentukan apakah laporannya layak dipercaya. Detektor objek hanya menjawab
 * "ada helm di dalam frame". Helm yang tergeletak di meja, tersangkut di pagar,
 * atau dijinjing di tangan menghasilkan kotak yang sama persis dengan helm yang
 * dipakai — dan sistem yang berhenti di situ akan melaporkan kepatuhan 100% di
 * lokasi yang seluruh pekerjanya bertelanjang kepala.
 *
 * Dua lapis penjagaannya:
 *
 * 1. Kelas negatif. Model PPE yang dipakai punya kelas "NO-Hardhat" yang
 *    menandai kepala telanjang, bukan sekadar ketiadaan kotak helm. Jadi
 *    "tidak memakai helm" adalah sesuatu yang benar-benar terlihat, bukan
 *    disimpulkan dari ketiadaan bukti.
 *
 * 2. Geometri. Kotak APD harus jatuh di bagian tubuh yang benar dari orang yang
 *    sama — helm di sepertiga atas, rompi di badan. Helm yang dijinjing setinggi
 *    pinggang tetap terdeteksi sebagai helm, tapi tidak pernah dihitung dipakai.
 */

/**
 * Zona kepala: 38% teratas kotak orang, dilebarkan sedikit ke samping.
 *
 * Pelebaran horizontalnya perlu karena kotak orang biasanya rapat di bahu
 * sementara helm menonjol keluar, terutama saat kepala menoleh.
 */
function headZone([x1, y1, x2, y2]) {
    const w = x2 - x1;
    const h = y2 - y1;
    return [x1 - w * 0.15, y1 - h * 0.05, x2 + w * 0.15, y1 + h * 0.38];
}

/** Zona badan: dari bawah bahu sampai pinggang. */
function torsoZone([x1, y1, x2, y2]) {
    const w = x2 - x1;
    const h = y2 - y1;
    return [x1 - w * 0.1, y1 + h * 0.15, x2 + w * 0.1, y1 + h * 0.72];
}

const centerOf = ([x1, y1, x2, y2]) => [(x1 + x2) / 2, (y1 + y2) / 2];

function centerInside(box, zone) {
    const [cx, cy] = centerOf(box);
    return cx >= zone[0] && cx <= zone[2] && cy >= zone[1] && cy <= zone[3];
}

/** Jarak kuadrat antar titik pusat — hanya dipakai untuk mengurutkan. */
function centerDistance(a, b) {
    const [ax, ay] = centerOf(a);
    const [bx, by] = centerOf(b);
    return (ax - bx) ** 2 + (ay - by) ** 2;
}

const HELMET_ROLES = [ROLE.HELMET, ROLE.NO_HELMET];
const VEST_ROLES = [ROLE.VEST, ROLE.NO_VEST];

/**
 * Berikan tiap kotak APD kepada satu orang saja.
 *
 * Tanpa ini, dua pekerja yang berdiri berdempetan akan sama-sama mengklaim satu
 * helm yang terlihat di antara mereka: yang tidak memakai helm ikut terhitung
 * patuh. Pemberiannya rakus — deteksi paling meyakinkan memilih lebih dulu, dan
 * di antara orang yang zonanya memuat kotak itu, yang pusatnya terdekat menang.
 */
function assign(persons, detections, roles, zoneFor) {
    const zones = persons.map((p) => zoneFor(p.box));
    const claimed = persons.map(() => null);

    const candidates = detections
        .filter((d) => roles.includes(d.role))
        .sort((a, b) => b.score - a.score);

    for (const det of candidates) {
        let bestIndex = -1;
        let bestDistance = Infinity;

        for (let i = 0; i < persons.length; i++) {
            if (claimed[i]) continue;
            if (!centerInside(det.box, zones[i])) continue;
            const distance = centerDistance(det.box, persons[i].box);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = i;
            }
        }

        if (bestIndex >= 0) claimed[bestIndex] = det;
    }

    return claimed;
}

/**
 * Susun orang-orang tiruan saat model tidak punya kelas "Person", atau tidak
 * mendeteksi seorang pun padahal APD terlihat.
 *
 * Terjadi pada model yang hanya dilatih pada kepala (SHWD dan turunannya), dan
 * pada frame di mana tubuh tertutup mesin sementara kepala masih terlihat.
 * Tiap kotak helm/kepala dianggap satu orang; keadaan rompinya tidak diketahui,
 * dan memang dilaporkan tidak diketahui — bukan diasumsikan patuh.
 */
function personsFromHeads(detections) {
    return detections
        .filter((d) => HELMET_ROLES.includes(d.role))
        .map((d) => {
            const [x1, y1, x2, y2] = d.box;
            const w = x2 - x1;
            const h = y2 - y1;
            // Perkiraan kasar tubuh di bawah kepala, sekadar untuk digambar
            // sebagai kotak overlay. Tidak dipakai untuk keputusan apa pun.
            return {
                box: [x1 - w * 0.6, y1, x2 + w * 0.6, y2 + h * 6],
                score: d.score,
                helmetDet: d,
                vestDet: null,
                inferred: true,
            };
        });
}

/**
 * @param {Array<{role:string, score:number, box:[number,number,number,number]}>} detections
 * @param {Buffer} frame RGB24 letterbox, ukuran size x size
 * @param {number} size sisi frame
 * @param {{requireHelm:boolean, requireVest:boolean, minPersonHeight:number, readColors:boolean}} rules
 */
export function assessFrame(detections, frame, size, rules) {
    const minHeight = rules.minPersonHeight * size;

    const detectedPersons = detections.filter((d) => d.role === ROLE.PERSON);
    let persons = detectedPersons
        .filter((d) => d.box[3] - d.box[1] >= minHeight)
        .map((d) => ({ box: d.box, score: d.score, helmetDet: null, vestDet: null, inferred: false }));

    // Jalur cadangan hanya untuk model yang memang tidak punya kelas orang.
    // Syaratnya tidak ada deteksi orang sama sekali — bukan sekadar tidak ada
    // yang lolos ambang ukuran. Kalau model melihat orang tapi semuanya terlalu
    // jauh untuk dinilai, menyusun orang tiruan dari kotak kepala hanya
    // memasukkan kembali deteksi yang baru saja kita putuskan terlalu kecil
    // untuk dipercaya.
    if (persons.length === 0 && detectedPersons.length === 0) {
        persons = personsFromHeads(detections).filter((p) => p.box[3] - p.box[1] >= minHeight);
    } else if (persons.length > 0) {
        const helmets = assign(persons, detections, HELMET_ROLES, headZone);
        const vests = assign(persons, detections, VEST_ROLES, torsoZone);
        persons.forEach((p, i) => {
            p.helmetDet = helmets[i];
            p.vestDet = vests[i];
        });
    }

    const tally = {
        personCount: 0,
        helmetOk: 0,
        helmetMissing: 0,
        vestOk: 0,
        vestMissing: 0,
        violatorCount: 0,
        maxConfidence: 0,
        helmetMissingSeen: false,
        vestMissingSeen: false,
    };

    const colors = { helmet: {}, vest: {} };

    const assessed = persons.map((p) => {
        // null berarti "tidak terbaca", dan sengaja tidak sama dengan false.
        // Kepala yang tertutup tiang bukan kepala tanpa helm; menghitungnya
        // sebagai pelanggaran akan membanjiri operator dengan alarm palsu,
        // sementara menghitungnya sebagai patuh menyembunyikan pelanggaran.
        // Satu-satunya jawaban jujur adalah tidak menghitungnya sama sekali.
        const helmet = p.helmetDet ? p.helmetDet.role === ROLE.HELMET : null;
        const vest = p.vestDet ? p.vestDet.role === ROLE.VEST : null;

        const helmetColor =
            rules.readColors && helmet === true
                ? confidentColor(frame, size, size, p.helmetDet.box)
                : null;
        const vestColor =
            rules.readColors && vest === true
                ? confidentColor(frame, size, size, p.vestDet.box)
                : null;

        if (helmetColor) colors.helmet[helmetColor] = (colors.helmet[helmetColor] ?? 0) + 1;
        if (vestColor) colors.vest[vestColor] = (colors.vest[vestColor] ?? 0) + 1;

        const violatesHelm = rules.requireHelm && helmet === false;
        const violatesVest = rules.requireVest && vest === false;
        const violating = violatesHelm || violatesVest;

        tally.personCount++;
        if (helmet === true) tally.helmetOk++;
        if (helmet === false) tally.helmetMissing++;
        if (vest === true) tally.vestOk++;
        if (vest === false) tally.vestMissing++;
        if (violatesHelm) tally.helmetMissingSeen = true;
        if (violatesVest) tally.vestMissingSeen = true;
        if (violating) {
            tally.violatorCount++;
            const worst = Math.max(p.helmetDet?.score ?? 0, p.vestDet?.score ?? 0);
            tally.maxConfidence = Math.max(tally.maxConfidence, worst);
        }

        return {
            box: p.box,
            helmet,
            vest,
            helmetColor,
            vestColor,
            confidence: p.score,
            violating,
            inferred: p.inferred,
        };
    });

    return {
        persons: assessed,
        tally,
        colors: {
            helmet: Object.keys(colors.helmet).length ? colors.helmet : undefined,
            vest: Object.keys(colors.vest).length ? colors.vest : undefined,
        },
        violationType: violationTypeOf(tally),
    };
}

/**
 * Jenis pelanggaran yang mewakili satu frame.
 *
 * Menggambarkan frame, bukan orang per orang: satu orang tanpa helm berdiri di
 * sebelah orang lain tanpa rompi tetap menghasilkan NO_HELMET_NO_VEST. Itu
 * disengaja — event adalah catatan tentang kondisi di kamera pada rentang
 * waktu tertentu, dan operator yang membukanya perlu tahu keduanya terjadi.
 */
function violationTypeOf(tally) {
    if (tally.helmetMissingSeen && tally.vestMissingSeen) return "NO_HELMET_NO_VEST";
    if (tally.helmetMissingSeen) return "NO_HELMET";
    if (tally.vestMissingSeen) return "NO_VEST";
    return null;
}

/**
 * Ubah kotak dari ruang letterbox model ke koordinat ternormalisasi frame asli.
 *
 * Overlay menggambar di atas elemen video yang menampilkan gambar asli, dan
 * ukurannya berubah-ubah mengikuti lebar layar. Koordinat 0..1 membuat overlay
 * tidak perlu tahu resolusi apa pun — cukup dikalikan ukuran tampilnya.
 *
 * Perhitungannya langsung terhadap kotak isi hasil letterbox, bukan lewat satu
 * faktor skala. Lebar dan tinggi hasil penskalaan dibulatkan ke bilangan genap
 * secara terpisah (syarat encoder), sehingga skala efektif sumbu x dan y tidak
 * pernah persis sama — memakai satu faktor untuk keduanya menggeser kotak
 * sekitar satu piksel ke arah vertikal.
 */
export function toNormalized(box, letterbox) {
    const { padX, padY, width, height } = letterbox;
    const clamp = (v) => Math.min(1, Math.max(0, v));

    const nx = clamp((box[0] - padX) / width);
    const ny = clamp((box[1] - padY) / height);
    return [
        nx,
        ny,
        clamp((box[2] - padX) / width) - nx,
        clamp((box[3] - padY) / height) - ny,
    ];
}
