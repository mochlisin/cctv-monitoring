import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";
import { prisma } from "@/lib/prisma";

const TTL_SECONDS = Number(process.env.THUMBNAIL_TTL_SECONDS ?? 300);
const CACHE_DIR = path.join(process.cwd(), ".thumbnails");
const FFMPEG_TIMEOUT_MS = 10_000;
const THUMB_HEIGHT = 270;

const inFlight = new Map<string, Promise<Buffer | null>>();

export const dynamic = "force-dynamic";

function rtspSourceFor(cctv: { ipAddress: string | null; streamUrl: string | null }) {
    const candidate = (cctv.ipAddress || cctv.streamUrl || "").trim();
    return candidate.startsWith("rtsp://") ? candidate : null;
}

function captureFrame(source: string, target: string): Promise<Buffer | null> {
    return new Promise((resolve) => {
        const args = [
            "-nostdin",
            "-hide_banner",
            "-loglevel", "error",
            "-rtsp_transport", "tcp",
            "-i", source,
            "-frames:v", "1",
            "-vf", `scale=-2:${THUMB_HEIGHT}`,
            "-threads", "1",
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
function refresh(slug: string, source: string, target: string): Promise<Buffer | null> {
    const running = inFlight.get(slug);
    if (running) return running;

    const job = (async () => {
        await fs.mkdir(CACHE_DIR, { recursive: true });
        return captureFrame(source, target);
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
        select: { isActive: true, ipAddress: true, streamUrl: true },
    });
    if (!cctv?.isActive) return new Response("Not Found", { status: 404 });

    const source = rtspSourceFor(cctv);
    if (!source) return new Response("Not Found", { status: 404 });

    const target = path.join(CACHE_DIR, `${slug}.jpg`);

    const cached = await readCached(target);

    if (cached && cached.ageMs <= TTL_SECONDS * 1000) {
        return jpeg(cached.body, TTL_SECONDS);
    }

    if (cached) {
        // Stale-while-revalidate.
        void refresh(slug, source, target).catch(() => undefined);
        return jpeg(cached.body, 10);
    }

    // Belum pernah ada frame untuk kamera ini — tunggu sebentar.
    const frame = await refresh(slug, source, target);
    if (frame) return jpeg(frame, TTL_SECONDS);

    // Biarkan UI memakai placeholder-nya.
    return new Response("Unavailable", {
        status: 503,
        headers: { "Cache-Control": "no-store" },
    });
}
