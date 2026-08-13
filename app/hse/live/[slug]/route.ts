import { prisma } from "@/lib/prisma";
import { readSession } from "@/lib/auth";

/**
 * Aliran deteksi untuk overlay di atas video.
 *
 * Route handler, bukan server action, karena yang dibutuhkan adalah koneksi
 * yang tetap terbuka — kategorinya sama dengan endpoint thumbnail: transport,
 * bukan API data.
 *
 * Next adalah satu-satunya pintu ke worker, persis seperti perlakuan terhadap
 * MediaMTX. Worker hanya mendengarkan di 127.0.0.1, sehingga pemeriksaan akses
 * di file ini tidak bisa dilewati dengan memanggil portnya langsung.
 *
 * AKSES: wajib login. Overlay adalah alat operator, bukan bagian dari tampilan
 * publik — dan penilaian pelanggaran keselamatan lebih pantas dianggap data
 * internal daripada bagian dari siaran. Kalau nanti perlu dibuka untuk penonton
 * publik, satu-satunya baris yang perlu diubah ada di bawah ini.
 */

const WORKER_URL = process.env.HSE_WORKER_URL ?? "http://127.0.0.1:9998";
const POLL_MS = 1000;
/**
 * Worker menganalisis paling cepat sekali per detik, jadi menariknya lebih
 * sering hanya menghasilkan payload yang sama berulang kali. Polling di sisi
 * server ini murah (localhost, JSON kecil) dan menjaga browser cukup memegang
 * satu koneksi.
 */

export const dynamic = "force-dynamic";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ slug: string }> }
) {
    const session = await readSession();
    if (!session) return new Response("Unauthorized", { status: 401 });

    const { slug } = await params;
    if (!/^[A-Za-z0-9-]{8,64}$/.test(slug)) {
        return new Response("Not Found", { status: 404 });
    }

    const cctv = await prisma.cctv.findUnique({
        where: { slug },
        select: { isActive: true, hseEnabled: true },
    });
    if (!cctv?.isActive || !cctv.hseEnabled) {
        return new Response("Not Found", { status: 404 });
    }

    const encoder = new TextEncoder();
    let timer: ReturnType<typeof setInterval> | undefined;

    const stream = new ReadableStream({
        start(controller) {
            let lastAt = -1;
            let closed = false;

            const send = (event: string, data: unknown) => {
                if (closed) return;
                try {
                    controller.enqueue(
                        encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
                    );
                } catch {
                    closed = true;
                }
            };

            const poll = async () => {
                try {
                    const response = await fetch(`${WORKER_URL}/live/${slug}`, {
                        signal: AbortSignal.timeout(2500),
                        cache: "no-store",
                    });

                    if (!response.ok) {
                        send("offline", { reason: "kamera tidak sedang dipantau" });
                        return;
                    }

                    const frame = await response.json();
                    // Hanya kirim saat benar-benar ada frame baru. Worker
                    // menganalisis jauh lebih jarang daripada laju polling ini,
                    // dan mengirim ulang frame yang sama membuat overlay
                    // menggambar ulang tanpa alasan.
                    if (frame.at && frame.at !== lastAt) {
                        lastAt = frame.at;
                        send("frame", frame);
                    }
                } catch {
                    send("offline", { reason: "worker HSE tidak berjalan" });
                }
            };

            const stop = () => {
                if (closed) return;
                closed = true;
                clearInterval(timer);
                try {
                    controller.close();
                } catch {
                    /* sudah tertutup */
                }
            };

            request.signal.addEventListener("abort", stop);

            void poll();
            timer = setInterval(() => void poll(), POLL_MS);
        },
        cancel() {
            clearInterval(timer);
        },
    });

    return new Response(stream, {
        headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store, no-transform",
            Connection: "keep-alive",
            // Nginx aaPanel menyalakan buffering secara default, dan SSE yang
            // di-buffer tidak pernah sampai ke browser sampai koneksinya tutup.
            "X-Accel-Buffering": "no",
        },
    });
}
