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
