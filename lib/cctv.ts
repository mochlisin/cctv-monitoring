/**
 * Konstanta & tipe bersama seputar CCTV.
 *
 * Sengaja bukan di actions/cctv.ts: file bertanda "use server" hanya boleh
 * meng-export fungsi async, jadi satu `export const` di sana membuat seluruh
 * modulnya kehilangan export.
 */

export const CCTV_CACHE_TAG = "cctv";

/**
 * Di atas jumlah ini, peta berhenti memuat semua penanda sekaligus dan mulai
 * meminta hanya yang berada di dalam viewport. Di bawahnya, semua penanda sudah
 * ada di klien sehingga memanggil server tiap kali peta digeser hanya menambah
 * beban tanpa manfaat.
 */
export const MAP_BOUNDS_THRESHOLD = 200;

export type CctvBounds = {
    north: number;
    south: number;
    east: number;
    west: number;
};

/** Kamera yang dimensi framenya sudah (atau belum) diketahui. */
export type CctvFrame = {
    frameWidth?: number | null;
    frameHeight?: number | null;
};

/**
 * Nilai untuk properti CSS `aspect-ratio`, mis. "152/270".
 *
 * WAJIB dipakai sebagai inline style, BUKAN dirangkai jadi class Tailwind
 * `aspect-[${w}/${h}]`. Tailwind memindai source secara statis, jadi class yang
 * dibentuk saat runtime tidak pernah ikut ter-generate — dan gagalnya diam-diam,
 * tanpa error, hanya elemen yang kehilangan rasionya.
 *
 * 16/9 selama kamera belum pernah ter-probe: itu bentuk mayoritas kamera, jadi
 * tebakan yang salah pun hanya berlaku sampai thumbnail pertama selesai.
 */
export function frameAspect(cctv: CctvFrame): string {
    return cctv.frameWidth && cctv.frameHeight
        ? `${cctv.frameWidth}/${cctv.frameHeight}`
        : "16/9";
}

/**
 * Rasio sebagai angka (lebar ÷ tinggi).
 *
 * Dipakai untuk membatasi lebar lewat tinggi: `aspect-ratio` saja tidak cukup di
 * container yang lebarnya ditentukan induk, karena lebar eksplisit selalu menang
 * dan tingginya ikut membengkak. `maxWidth: calc(<tinggi maks> * ratio)` membuat
 * lebarnya yang mengalah sehingga rasionya tetap terjaga.
 */
export function frameRatio(cctv: CctvFrame): number {
    return cctv.frameWidth && cctv.frameHeight
        ? cctv.frameWidth / cctv.frameHeight
        : 16 / 9;
}

/** Kamera corridor mode / rotasi 90°, framenya lebih tinggi daripada lebar. */
export function isPortrait(cctv: CctvFrame): boolean {
    return Boolean(
        cctv.frameWidth && cctv.frameHeight && cctv.frameHeight > cctv.frameWidth
    );
}
