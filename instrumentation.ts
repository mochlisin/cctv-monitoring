/**
 * Konfigurasi path MediaMTX bersifat runtime (hilang saat MediaMTX restart),
 * jadi aplikasi mendorong ulang daftarnya saat start dan secara berkala.
 */
export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;
    // Dimatikan total untuk mencegah intervensi timer periodik yang menyebabkan pause/reconnect tiap 60 detik.
}
