import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";
import { streamPathFor } from "@/lib/streamAccess";

/**
 * Thumbnail kamera.
 *
 * Ini endpoint HTTP, bukan server action, karena `<img src>` butuh URL — sebuah
 * action tidak bisa melayani binary ke tag img tanpa memaksa base64 masuk ke
 * HTML. Kategorinya sama dengan proxy media: transport, bukan API data.
 *
 * Sumbernya RTSP lokal MediaMTX, bukan kamera langsung. Dua keuntungannya:
 * kredensial kamera tidak pernah muncul di argumen proses ffmpeg (yang terlihat
 * di daftar proses sistem), dan koneksi ke kamera tetap satu walau banyak yang
 * meminta thumbnail sekaligus.
 */

const RTSP_ORIGIN = process.env.MEDIA_RTSP_ORIGIN ?? "rtsp://127.0.0.1:8554";
const TTL_SECONDS = Number(process.env.THUMBNAIL_TTL_SECONDS ?? 60);
const CACHE_DIR = path.join(process.cwd(), ".thumbnails");
// Permintaan pertama harus menunggu MediaMTX membuka koneksi RTSP ke kamera
// (sourceOnDemandStartTimeout bawaannya 10 detik), jadi batas ini harus lebih
// longgar dari itu — kalau tidak, thumbnail pertama nyaris selalu gagal.
const FFMPEG_TIMEOUT_MS = 20_000;
const THUMB_HEIGHT = 270;

// Banyak kartu meminta thumbnail yang sama sekaligus; cukup satu ffmpeg.
const inFlight = new Map<string, Promise<Buffer | null>>();

export const dynamic = "force-dynamic";

function captureFrame(slug: string, target: string): Promise<Buffer | null> {
    return new Promise((resolve) => {
        const args = [
            "-nostdin",
            "-hide_banner",
            "-loglevel", "error",
            "-rtsp_transport", "tcp",
            "-i", `${RTSP_ORIGIN}/${streamPathFor(slug)}`,
            "-frames:v", "1",
            "-vf", `scale=-2:${THUMB_HEIGHT}`,
            "-q:v", "5",
            "-y", target,
        ];

        let proc;
        try {
            proc = spawn("ffmpeg", args);
        } catch {
            resolve(null);
            return;
        }

        let settled = false;
        const finish = async (ok: boolean) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            if (!ok) return resolve(null);
            try {
                resolve(await fs.readFile(target));
            } catch {
                resolve(null);
            }
        };

        const timer = setTimeout(() => {
            proc.kill("SIGKILL");
            finish(false);
        }, FFMPEG_TIMEOUT_MS);

        proc.on("error", () => finish(false));
        proc.on("close", (code) => finish(code === 0));
    });
}

async function readCached(target: string): Promise<{ body: Buffer; ageMs: number } | null> {
    try {
        const stat = await fs.stat(target);
        return { body: await fs.readFile(target), ageMs: Date.now() - stat.mtimeMs };
    } catch {
        return null;
    }
}

/** Satu ffmpeg per kamera, walau banyak kartu meminta bersamaan. */
function refresh(slug: string, target: string): Promise<Buffer | null> {
    const running = inFlight.get(slug);
    if (running) return running;

    const job = (async () => {
        await fs.mkdir(CACHE_DIR, { recursive: true });
        return captureFrame(slug, target);
    })().finally(() => inFlight.delete(slug));

    inFlight.set(slug, job);
    return job;
}

function jpeg(body: Buffer, maxAgeSeconds: number) {
    return new Response(new Uint8Array(body), {
        headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": `public, max-age=${maxAgeSeconds}`,
        },
    });
}

export async function GET(
    _request: Request,
    { params }: { params: Promise<{ slug: string }> }
) {
    const { slug } = await params;

    // Slug adalah UUID; tolak apa pun yang bisa keluar dari folder cache.
    if (!/^[A-Za-z0-9-]{8,64}$/.test(slug)) {
        return new Response("Not Found", { status: 404 });
    }

    const cctv = await prisma.cctv.findUnique({
        where: { slug },
        select: { isActive: true },
    });
    if (!cctv?.isActive) return new Response("Not Found", { status: 404 });

    const target = path.join(CACHE_DIR, `${slug}.jpg`);

    const cached = await readCached(target);

    if (cached && cached.ageMs <= TTL_SECONDS * 1000) {
        return jpeg(cached.body, TTL_SECONDS);
    }

    if (cached) {
        // Stale-while-revalidate. Kamera hanya mengirim keyframe tiap beberapa
        // detik, sehingga menangkap frame baru selalu makan waktu selama itu.
        // Tidak ada gunanya menahan pengguna: sajikan frame lama sekarang, lalu
        // segarkan di latar belakang untuk permintaan berikutnya.
        void refresh(slug, target).catch(() => undefined);
        return jpeg(cached.body, 10);
    }

    // Belum pernah ada frame untuk kamera ini — mau tidak mau menunggu.
    const frame = await refresh(slug, target);
    if (frame) return jpeg(frame, TTL_SECONDS);

    // Biarkan UI memakai placeholder-nya.
    return new Response("Unavailable", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
    });
}
