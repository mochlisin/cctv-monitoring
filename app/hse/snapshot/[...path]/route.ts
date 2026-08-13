import fs from "fs/promises";
import path from "path";
import { readSession } from "@/lib/auth";

/**
 * Melayani frame bukti pelanggaran.
 *
 * Berkasnya ditulis worker ke luar direktori `public/`, dan itu disengaja:
 * apa pun di `public/` dilayani Next tanpa pemeriksaan apa pun, sehingga
 * seluruh riwayat pelanggaran akan bisa diambil siapa saja yang menebak nama
 * berkasnya. Snapshot memuat orang yang dapat dikenali di lokasi kerja mereka —
 * ia harus melewati pemeriksaan sesi, dan itulah alasan file ini ada.
 */

const SNAPSHOT_DIR = process.env.HSE_SNAPSHOT_DIR ?? path.join(process.cwd(), ".hse", "snapshots");

export const dynamic = "force-dynamic";

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ path: string[] }> }
) {
    const session = await readSession();
    if (!session) return new Response("Unauthorized", { status: 401 });

    const { path: segments } = await params;

    // Bentuk yang ditulis worker: <YYYY-MM-DD>/<cctvId>-<epoch>.jpg. Pola ketat
    // ini sekaligus menutup traversal — ".." tidak pernah cocok.
    if (
        segments.length !== 2 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(segments[0]) ||
        !/^\d+-\d+\.jpg$/.test(segments[1])
    ) {
        return new Response("Not Found", { status: 404 });
    }

    const target = path.join(SNAPSHOT_DIR, segments[0], segments[1]);

    try {
        const body = await fs.readFile(target);
        return new Response(new Uint8Array(body), {
            headers: {
                "Content-Type": "image/jpeg",
                // Berkas bukti tidak pernah berubah setelah ditulis, tapi
                // cache-nya harus privat: ia sudah melewati pemeriksaan sesi,
                // dan proxy bersama tidak boleh menyimpannya untuk orang lain.
                "Cache-Control": "private, max-age=86400",
            },
        });
    } catch {
        return new Response("Not Found", { status: 404 });
    }
}
