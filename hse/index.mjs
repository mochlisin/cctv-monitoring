import http from "http";
import { PrismaClient } from "@prisma/client";

import { config } from "./config.mjs";
import { Detector } from "./model.mjs";
import { FrameSource } from "./frames.mjs";
import { Store } from "./store.mjs";
import { assessFrame, toNormalized } from "./assess.mjs";
import { isMonochrome } from "./color.mjs";

/**
 * Worker HSE — proses terpisah, sengaja.
 *
 * Bukan bagian dari Next. Inferensi adalah pekerjaan CPU yang menahan event
 * loop ratusan milidetik; menjalankannya di dalam proses yang sama dengan
 * server web berarti setiap deteksi membekukan setiap permintaan HTTP yang
 * sedang berjalan. Dipisah, hubungan keduanya menjadi satu arah dan aman:
 * worker menulis ke database dan menyediakan API lokal; kalau ia mati, halaman
 * dan streaming tetap hidup, hanya overlay yang berhenti diperbarui.
 *
 * Pola pemisahannya persis sama dengan MediaMTX di aplikasi ini — proses
 * sendiri, API yang hanya mendengarkan di 127.0.0.1, dan Next sebagai
 * satu-satunya pintu ke browser.
 */

const prisma = new PrismaClient();
const store = new Store(prisma, config);

/** State per kamera yang sedang dipantau. */
const cameras = new Map();

let detector = null;
let running = false;
let shuttingDown = false;

/** Rata-rata bergerak waktu inferensi, dasar pengambilan keputusan rem otomatis. */
let averageInferenceMs = 0;
let effectiveInterval = config.intervalSeconds;

const CAMERA_SELECT = {
    id: true,
    slug: true,
    name: true,
    hseRequireHelm: true,
    hseRequireVest: true,
    hseMinDuration: true,
};

/* ------------------------------------------------------------------ kamera */

async function reloadCameras() {
    let rows;
    try {
        rows = await prisma.cctv.findMany({
            where: { hseEnabled: true, isActive: true },
            orderBy: { id: "asc" },
            select: CAMERA_SELECT,
        });
    } catch (error) {
        console.error("[hse] gagal membaca daftar kamera:", error.message);
        return;
    }

    // Batas keras. Melewatinya di server kecil tidak memunculkan error apa pun —
    // gejalanya adalah antrean inferensi yang tidak pernah habis, dan deteksi
    // yang diam-diam tertinggal beberapa menit. Lebih baik menolak dengan
    // lantang di sini daripada diam-diam menjadi tidak akurat.
    if (rows.length > config.maxCameras) {
        const dropped = rows.slice(config.maxCameras);
        console.warn(
            `[hse] ${rows.length} kamera diaktifkan tapi batasnya ${config.maxCameras}. ` +
                `Tidak dipantau: ${dropped.map((c) => c.name).join(", ")}. ` +
                "Naikkan HSE_MAX_CAMERAS hanya kalau CPU memang cukup."
        );
        rows = rows.slice(0, config.maxCameras);
    }

    const wanted = new Set(rows.map((c) => c.id));

    for (const [id, entry] of cameras) {
        if (wanted.has(id)) continue;
        entry.source.stop();
        cameras.delete(id);
        console.log(`[hse] berhenti memantau ${entry.camera.name}`);
    }

    for (const camera of rows) {
        const existing = cameras.get(camera.id);
        if (existing) {
            // Slug bisa diregenerasi dari admin; itu mengubah path RTSP.
            if (existing.camera.slug !== camera.slug) {
                existing.source.stop();
                cameras.delete(camera.id);
            } else {
                existing.camera = camera;
                continue;
            }
        }

        const entry = {
            camera,
            source: null,
            /** Frame terbaru yang belum dianalisis. Hanya satu — lihat onFrame. */
            pending: null,
            lastInferenceAt: 0,
            live: null,
            boostUntil: 0,
        };

        entry.source = new FrameSource(camera, config, (frame) => onFrame(entry, frame));
        cameras.set(camera.id, entry);
        await entry.source.start();
        console.log(`[hse] mulai memantau ${camera.name}`);
    }
}

/**
 * Frame baru dari ffmpeg.
 *
 * Hanya frame terbaru yang disimpan; yang belum sempat dianalisis dibuang tanpa
 * penyesalan. Mengantrekannya adalah kesalahan klasik pada pipeline video: saat
 * server sedang sibuk, antrean tumbuh lebih cepat daripada dikosongkan, dan
 * yang akhirnya dianalisis adalah keadaan beberapa menit lalu. Frame basi tidak
 * ada gunanya bagi pemantauan keselamatan.
 */
function onFrame(entry, frame) {
    entry.pending = frame;
    void tick();
}

/* --------------------------------------------------------------- penjadwal */

function intervalFor(entry) {
    const boosted = entry.boostUntil > Date.now();
    return boosted ? config.boostIntervalSeconds : effectiveInterval;
}

/** Kamera yang paling lama menunggu giliran, di antara yang sudah jatuh tempo. */
function nextDue() {
    const now = Date.now();
    let best = null;
    let bestOverdue = 0;

    for (const entry of cameras.values()) {
        if (!entry.pending) continue;
        const overdue = now - entry.lastInferenceAt - intervalFor(entry) * 1000;
        if (overdue < 0) continue;
        if (overdue > bestOverdue || !best) {
            best = entry;
            bestOverdue = overdue;
        }
    }

    return best;
}

/**
 * Satu inferensi pada satu waktu, untuk seluruh kamera.
 *
 * Menjalankannya paralel akan menyelesaikan tiap frame lebih cepat, tapi lonjakan
 * CPU-nya berbanding lurus dengan jumlah kamera — dan yang tersendat justru
 * streaming yang menjadi alasan aplikasi ini ada. Serial membuat beban puncak
 * worker ini bisa dihitung di muka: satu inferensi, berapa pun kameranya.
 */
async function tick() {
    if (running || shuttingDown || !detector) return;

    const entry = nextDue();
    if (!entry) return;

    running = true;
    const frame = entry.pending;
    entry.pending = null;
    entry.lastInferenceAt = Date.now();

    try {
        await analyze(entry, frame);
    } catch (error) {
        console.error(`[hse] ${entry.camera.name}: analisis gagal:`, error.message);
    } finally {
        running = false;
        // Kamera lain mungkin sudah jatuh tempo selama inferensi tadi berjalan.
        if (nextDue()) setImmediate(tick);
    }
}

async function analyze(entry, frame) {
    const { detections, inferenceMs } = await detector.detect(frame);

    const assessment = assessFrame(detections, frame, config.inputSize, {
        requireHelm: entry.camera.hseRequireHelm,
        requireVest: entry.camera.hseRequireVest,
        minPersonHeight: config.minPersonHeight,
        // Kamera dalam mode inframerah malam hari tidak punya warna untuk
        // dibaca; memaksakannya hanya menghasilkan "abu-abu" yang menumpuk
        // jadi pola palsu di laporan.
        readColors: !isMonochrome(frame, config.inputSize, config.inputSize),
    });

    const letterbox = entry.source.letterbox;
    entry.live = {
        slug: entry.camera.slug,
        at: Date.now(),
        persons: assessment.persons.map((p) => ({
            box: toNormalized(p.box, letterbox),
            helmet: p.helmet,
            vest: p.vest,
            helmetColor: p.helmetColor,
            vestColor: p.vestColor,
            confidence: Math.round(p.confidence * 100) / 100,
            violating: p.violating,
        })),
        personCount: assessment.tally.personCount,
        violatorCount: assessment.tally.violatorCount,
        inferenceMs: Math.round(inferenceMs),
    };

    await store.record(entry.camera, assessment, frame);
    adapt(inferenceMs);
}

/**
 * Rem otomatis.
 *
 * Kalau inferensi melambat — CPU dipakai proses lain, kamera bertambah, server
 * kepanasan — worker mengurangi frekuensinya sendiri alih-alih ikut menyeret
 * server turun. Pemantauan yang lebih jarang masih berguna; server yang tidak
 * responsif tidak berguna sama sekali.
 */
function adapt(inferenceMs) {
    averageInferenceMs = averageInferenceMs
        ? averageInferenceMs * 0.8 + inferenceMs * 0.2
        : inferenceMs;

    const previous = effectiveInterval;

    if (averageInferenceMs > config.slowInferenceMs) {
        effectiveInterval = Math.min(config.maxIntervalSeconds, effectiveInterval * 1.5);
    } else if (averageInferenceMs < config.slowInferenceMs * 0.5) {
        effectiveInterval = Math.max(config.intervalSeconds, effectiveInterval * 0.9);
    }

    if (Math.abs(effectiveInterval - previous) > 0.5) {
        console.log(
            `[hse] interval disesuaikan ${previous.toFixed(1)}s → ${effectiveInterval.toFixed(1)}s ` +
                `(rata-rata inferensi ${Math.round(averageInferenceMs)} ms)`
        );
    }
}

/* ------------------------------------------------------------- API lokal */

function findBySlug(slug) {
    for (const entry of cameras.values()) {
        if (entry.camera.slug === slug) return entry;
    }
    return null;
}

function json(res, status, body) {
    const payload = JSON.stringify(body);
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "Cache-Control": "no-store",
    });
    res.end(payload);
}

/**
 * Hanya mendengarkan di 127.0.0.1. Browser tidak pernah menyentuhnya — route
 * handler Next yang meneruskannya, sekaligus tempat pemeriksaan akses.
 */
const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const [, scope, slug] = url.pathname.split("/");

    if (scope === "health") {
        return json(res, 200, {
            ok: true,
            model: config.modelPath,
            averageInferenceMs: Math.round(averageInferenceMs),
            intervalSeconds: Math.round(effectiveInterval * 10) / 10,
            cameras: [...cameras.values()].map((e) => ({
                id: e.camera.id,
                name: e.camera.name,
                slug: e.camera.slug,
                online: e.source.online,
                lastFrameAt: e.source.lastFrameAt || null,
                lastInferenceAt: e.lastInferenceAt || null,
                boosted: e.boostUntil > Date.now(),
                violatorCount: e.live?.violatorCount ?? 0,
            })),
        });
    }

    if (!slug) return json(res, 404, { error: "not found" });

    const entry = findBySlug(slug);
    if (!entry) return json(res, 404, { error: "kamera tidak dipantau" });

    if (scope === "live") {
        // Permintaan overlay sekaligus menyalakan mode boost: selama ada yang
        // menonton, kamera itu dianalisis lebih sering. Persis pola
        // sourceOnDemand MediaMTX — beban tambahan hanya saat benar-benar dilihat.
        entry.boostUntil = Date.now() + config.boostTtlSeconds * 1000;
        return json(res, 200, entry.live ?? { slug, at: 0, persons: [], personCount: 0, violatorCount: 0, inferenceMs: 0 });
    }

    return json(res, 404, { error: "not found" });
});

/* ---------------------------------------------------------------- daur hidup */

async function main() {
    console.log("[hse] memuat model...");
    detector = await Detector.load(config);
    console.log(
        `[hse] model siap: ${detector.classes.length} kelas, masukan ${config.inputSize}px, ` +
            `${config.threads} thread`
    );

    await store.closeStaleEvents();
    await reloadCameras();

    server.listen(config.port, config.host, () => {
        console.log(`[hse] API lokal di http://${config.host}:${config.port}`);
    });

    setInterval(() => void reloadCameras(), config.reloadSeconds * 1000).unref?.();
    setInterval(() => void store.flush(), 30_000).unref?.();
    setInterval(() => void store.prune(), 24 * 3600_000).unref?.();
    void store.prune();

    // Frame bisa saja berhenti berdatangan (kamera mati); denyut ini memastikan
    // penjadwal tetap memeriksa kamera lain yang masih punya frame menunggu.
    setInterval(() => void tick(), 1000).unref?.();
}

async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[hse] ${signal} diterima, menutup...`);

    for (const entry of cameras.values()) entry.source.stop();
    server.close();

    try {
        await store.closeAll();
    } catch (error) {
        console.error("[hse] gagal menutup event:", error.message);
    }

    await prisma.$disconnect();
    process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

main().catch(async (error) => {
    console.error("[hse] gagal start:", error.message);
    await prisma.$disconnect();
    process.exit(1);
});
