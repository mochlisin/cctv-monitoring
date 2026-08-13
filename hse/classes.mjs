/**
 * Menerjemahkan nama kelas model menjadi peran yang dimengerti worker.
 *
 * Model PPE publik tidak sepakat soal penamaan. Dataset Roboflow "Construction
 * Site Safety" memakai `NO-Hardhat`, SHWD memakai `head` untuk kepala telanjang,
 * yang lain memakai `no_helmet` atau `person_no_helmet`. Daripada mengunci satu
 * dataset, worker hanya butuh tahu satu hal dari tiap kelas: ini orang, helm
 * terpakai, kepala tanpa helm, rompi terpakai, atau badan tanpa rompi.
 *
 * Efeknya: mengganti model cukup mengganti file .onnx dan daftar kelasnya —
 * tidak ada kode yang perlu disentuh selama namanya masih masuk akal.
 */

export const ROLE = {
    PERSON: "PERSON",
    HELMET: "HELMET",
    NO_HELMET: "NO_HELMET",
    VEST: "VEST",
    NO_VEST: "NO_VEST",
    IGNORE: "IGNORE",
};

/**
 * Urutan kelas bawaan: dataset Roboflow "Construction Site Safety" (css-data),
 * yang paling banyak dipakai untuk YOLO PPE dan urut alfabetis.
 *
 * PENTING: urutan ini harus persis sama dengan urutan saat model dilatih.
 * Salah urutan tidak memunculkan error — ia memunculkan deteksi yang meyakinkan
 * tapi salah label ("vehicle" dilaporkan sebagai orang tanpa helm). Kalau
 * memakai model lain, ganti lewat models/ppe.classes.json.
 */
export const DEFAULT_CLASSES = [
    "Hardhat",
    "Mask",
    "NO-Hardhat",
    "NO-Mask",
    "NO-Safety Vest",
    "Person",
    "Safety Cone",
    "Safety Vest",
    "machinery",
    "vehicle",
];

const normalize = (name) => String(name).toLowerCase().replace(/[\s_-]+/g, " ").trim();

/** Kelas yang menyatakan ketiadaan APD. Diperiksa lebih dulu — lihat di bawah. */
const NEGATIVE = [
    { role: ROLE.NO_HELMET, test: /(no|non|without|tanpa|missing) ?(hardhat|hard hat|helmet|helm)/ },
    { role: ROLE.NO_VEST, test: /(no|non|without|tanpa|missing) ?(safety )?(vest|rompi)/ },
    // SHWD dan turunannya memakai "head" untuk kepala tanpa helm — satu-satunya
    // kelas negatif yang namanya tidak mengandung kata "no".
    { role: ROLE.NO_HELMET, test: /^(head|bare head|kepala)$/ },
];

const POSITIVE = [
    { role: ROLE.PERSON, test: /^(person|people|worker|pekerja|orang)$/ },
    { role: ROLE.HELMET, test: /(hardhat|hard hat|helmet|helm)/ },
    { role: ROLE.VEST, test: /(vest|rompi)/ },
];

/**
 * Peran satu nama kelas.
 *
 * Kelas negatif diuji lebih dulu karena namanya memuat nama positif:
 * "NO-Hardhat" mengandung "hardhat", jadi urutan sebaliknya akan melabeli
 * pelanggaran sebagai kepatuhan — kesalahan yang paling mahal di sistem ini.
 */
export function roleOf(className) {
    const name = normalize(className);
    for (const { role, test } of NEGATIVE) if (test.test(name)) return role;
    for (const { role, test } of POSITIVE) if (test.test(name)) return role;
    return ROLE.IGNORE;
}

/** Petakan seluruh daftar kelas sekali saat worker start. */
export function buildRoleTable(classes) {
    return classes.map(roleOf);
}

/**
 * Periksa daftar kelas masuk akal sebelum worker mulai bekerja.
 *
 * Model tanpa kelas helm sama sekali biasanya berarti file .onnx yang salah
 * (misalnya YOLO COCO bawaan). Lebih baik ketahuan saat start daripada
 * menghasilkan laporan kepatuhan 100% yang kosong maknanya.
 */
export function describeClasses(classes) {
    const roles = buildRoleTable(classes);
    const has = (role) => roles.includes(role);
    return {
        roles,
        hasPerson: has(ROLE.PERSON),
        hasHelmet: has(ROLE.HELMET) || has(ROLE.NO_HELMET),
        hasVest: has(ROLE.VEST) || has(ROLE.NO_VEST),
        recognized: roles.filter((r) => r !== ROLE.IGNORE).length,
    };
}
