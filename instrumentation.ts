/**
 * Konfigurasi path MediaMTX bersifat runtime (hilang saat MediaMTX restart),
 * jadi aplikasi mendorong ulang daftarnya saat start dan secara berkala.
 */
export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;
    if (process.env.MEDIAMTX_AUTO_SYNC === "false") return;

    const { syncStreamPaths } = await import("@/actions/stream");

    const run = async () => {
        try {
            const { synced, removed } = await syncStreamPaths();
            if (synced || removed) {
                console.log(`[stream] MediaMTX sync: ${synced} diperbarui, ${removed} dihapus`);
            }
        } catch (error) {
            console.error("[stream] sync gagal:", error);
        }
    };

    await run();
    setInterval(run, 60_000).unref?.();
}
