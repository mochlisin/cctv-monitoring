/**
 * Titik awal peta kalau belum ada koordinat sama sekali: Jalan Intan 2.5,
 * Kota Baru Driyorejo (Petiken, Driyorejo, Gresik, Jawa Timur 61177).
 *
 * Jalan Intan 2.5 sendiri belum terdaftar di OpenStreetMap, jadi koordinat ini
 * diinterpolasi dari gang tetangga yang sudah termapping:
 *   Jalan Intan 2.6  -> -7.3334413, 112.6356639
 *   Jalan Intan 2.10 -> -7.3342861, 112.6354625
 * Jarak antar gang ~0.00021 derajat lintang (~23 m), jadi 2.5 berada satu baris
 * di utara 2.6. Kalau nanti ada titik GPS lapangan, ganti nilai di sini saja.
 */
export const DEFAULT_MAP_CENTER: [number, number] = [-7.33323, 112.63566];

/** Zoom default: level gang supaya nama jalan di KBD langsung kebaca. */
export const DEFAULT_MAP_ZOOM = 17;

/** Kotak kasar wilayah Indonesia: [latMin, latMax, lngMin, lngMax]. */
const ID_BBOX = { latMin: -11.5, latMax: 6.5, lngMin: 94.5, lngMax: 141.5 };

/**
 * Koordinat masuk akal untuk CCTV di Indonesia? Data uji sering berisi angka
 * placeholder (mis. 1,1 atau 12,12) yang kalau ikut dirata-rata akan menarik
 * titik tengah peta ke tengah laut, jadi nilai seperti itu diabaikan saat
 * menghitung center dan peta jatuh ke DEFAULT_MAP_CENTER.
 */
export function isPlausibleIdCoord(lat?: number | null, lng?: number | null): boolean {
    if (typeof lat !== "number" || typeof lng !== "number") return false;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    return (
        lat >= ID_BBOX.latMin && lat <= ID_BBOX.latMax &&
        lng >= ID_BBOX.lngMin && lng <= ID_BBOX.lngMax
    );
}
