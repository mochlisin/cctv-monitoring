import { syncStreamPaths } from "@/actions/stream";

export async function register() {
    if (process.env.NEXT_RUNTIME !== "nodejs") return;
    
    // Daftarkan path ke MediaMTX SEKALI saat server start, tanpa interval berkala.
    try {
        console.log("[instrumentation] Mendaftarkan path stream ke MediaMTX...");
        await syncStreamPaths();
        console.log("[instrumentation] Selesai mendaftarkan path stream.");
    } catch (err) {
        console.error("[instrumentation] Gagal mendaftarkan path:", err);
    }
}
