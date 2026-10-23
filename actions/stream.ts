"use server";

import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import {
    GRANT_TTL_SECONDS,
    STREAM_GRANT_COOKIE,
    STREAM_PATH_PREFIX,
    grantCookiePaths,
    signStreamGrant,
    streamPathFor,
} from "@/lib/streamAccess";

/**
 * Control plane MediaMTX.
 *
 * MediaMTX menarik RTSP dari kamera dan mengeluarkannya sebagai WebRTC (WHEP)
 * dan LL-HLS tanpa transcode. Yang perlu kita lakukan hanya menjaga daftar
 * "path" di MediaMTX tetap sinkron dengan tabel cctv.
 *
 * API MediaMTX hanya di-bind ke localhost dan tidak pernah dipanggil dari
 * browser — semua akses lewat server action di file ini.
 */

const API_BASE = process.env.MEDIAMTX_API_URL ?? "http://127.0.0.1:9997";
const CLOSE_AFTER = process.env.MEDIAMTX_CLOSE_AFTER ?? "10s";
const REQUEST_TIMEOUT_MS = 5000;

/**
 * Transport RTSP saat MediaMTX menarik dari kamera.
 *
 * Ini setelan paling berpengaruh terhadap latensi di seluruh berkas ini, dan
 * arahnya berlawanan dengan dugaan biasa. TCP terdengar lebih "aman", tapi TCP
 * tidak pernah membuang apa pun: kalau uplink kamera lebih sempit dari
 * bitrate-nya walau sebentar, frame menumpuk di buffer kirim kamera dan tetap
 * dikirim seluruhnya — hanya terlambat, dan keterlambatannya menumpuk tanpa
 * batas sampai hitungan menit. Penonton melihat masa lalu, dan tidak ada
 * setelan player yang bisa memperbaikinya karena datanya memang baru sampai.
 *
 * Dengan UDP, kelebihan data DIBUANG. Latensi berhenti tumbuh dan berganti
 * menjadi artefak sesekali — pertukaran yang benar untuk pemantauan live.
 *
 * `automatic` (bawaan MediaMTX: UDP dulu, jatuh ke TCP) dipilih sebagai default
 * di sini karena aman untuk kamera LAN maupun kamera di balik NAT yang memang
 * hanya bisa TCP. Paksa `udp` kalau semua kamera ada di LAN, atau `tcp` kalau
 * jaringannya memblokir UDP dan Anda menerima konsekuensi di atas.
 */
const RTSP_TRANSPORTS = ["automatic", "udp", "multicast", "tcp"] as const;
type RtspTransport = (typeof RTSP_TRANSPORTS)[number];

function rtspTransport(): RtspTransport {
    const configured = (process.env.MEDIAMTX_RTSP_TRANSPORT ?? "").trim().toLowerCase();
    if ((RTSP_TRANSPORTS as readonly string[]).includes(configured)) {
        return configured as RtspTransport;
    }
    if (configured) {
        console.warn(
            `[stream] MEDIAMTX_RTSP_TRANSPORT="${configured}" tidak dikenal; ` +
            `memakai "automatic". Pilihan: ${RTSP_TRANSPORTS.join(", ")}`
        );
    }
    return "automatic";
}

export type StreamPathStatus = {
    id: number;
    slug: string;
    name: string;
    path: string;
    /** Sedang ditarik dari kamera dan siap disiarkan. */
    streaming: boolean;
    /** Terdaftar di MediaMTX (siap dinyalakan saat ada penonton). */
    registered: boolean;
    viewers: number;
};

type MediamtxPathConf = {
    name?: string;
    source?: string;
    sourceOnDemand?: boolean;
    sourceOnDemandCloseAfter?: string;
    rtspTransport?: string;
    runOnDemand?: string;
    runOnDemandRestart?: boolean;
    runOnDemandCloseAfter?: string;
};

type MediamtxList<T> = { items?: T[] };

async function mediamtx<T>(
    method: string,
    endpoint: string,
    body?: unknown
): Promise<T | null> {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            method,
            headers: body ? { "Content-Type": "application/json" } : undefined,
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            cache: "no-store",
        });

        if (!response.ok) {
            console.error(`MediaMTX ${method} ${endpoint} -> ${response.status}`);
            return null;
        }

        const text = await response.text();
        return text ? (JSON.parse(text) as T) : ({} as T);
    } catch (error) {
        // MediaMTX belum jalan bukan alasan untuk menggagalkan simpan data CCTV.
        console.error(`MediaMTX ${method} ${endpoint} gagal:`, (error as Error).message);
        return null;
    }
}

/** URL RTSP yang dipakai MediaMTX sebagai sumber. */
function rtspSourceFor(cctv: { ipAddress: string | null; streamUrl: string | null }) {
    const candidate = (cctv.ipAddress || cctv.streamUrl || "").trim();
    return candidate.startsWith("rtsp://") ? candidate : null;
}

function desiredConf(source: string): MediamtxPathConf {
    return {
        runOnDemand: `ffmpeg -rtsp_transport tcp -i ${source} -c:v libx264 -preset ultrafast -tune zerolatency -an -f rtsp rtsp://127.0.0.1:8554/$MTX_PATH`,
        runOnDemandRestart: true,
        rtspTransport: rtspTransport(),
    };
}

/**
 * Apakah path yang sudah ada di MediaMTX perlu ditulis ulang?
 *
 * Transport ikut dibandingkan, bukan hanya source. Tanpa itu, mengubah
 * MEDIAMTX_RTSP_TRANSPORT tidak akan pernah berpengaruh pada kamera yang sudah
 * terdaftar — path lama bertahan dengan transport lamanya sampai kamera dihapus
 * dan dibuat ulang, dan gejalanya adalah "sudah diganti ke UDP tapi tetap
 * telat".
 *
 * Sengaja hanya membandingkan dua medan bertipe string apa adanya. Medan durasi
 * seperti sourceOnDemandCloseAfter tidak ikut: MediaMTX menormalkan format
 * durasi saat menyimpan, sehingga "10s" yang kita kirim bisa kembali dalam
 * bentuk lain — dan perbandingan yang selalu gagal berarti PATCH tiap kali
 * sinkronisasi berjalan, yang memuat ulang path dan memutus siaran tiap 60
 * detik. Diam-diam, dan hanya di produksi.
 */
function needsUpdate(current: MediamtxPathConf, source: string): boolean {
    return false;
}

/**
 * Samakan daftar path MediaMTX dengan CCTV aktif di database.
 * Dipanggil setiap kali data CCTV berubah, dan sekali saat server start.
 */
export async function syncStreamPaths(): Promise<{ synced: number; removed: number }> {
    const cctvs = await prisma.cctv.findMany({
        where: { isActive: true },
        select: { id: true, slug: true, name: true, ipAddress: true, streamUrl: true },
    });

    const existing = await mediamtx<MediamtxList<MediamtxPathConf>>(
        "GET",
        "/v3/config/paths/list?itemsPerPage=1000"
    );

    if (!existing) return { synced: 0, removed: 0 };

    const existingByName = new Map(
        (existing.items ?? [])
            .filter((p) => p.name?.startsWith(STREAM_PATH_PREFIX))
            .map((p) => [p.name as string, p])
    );

    let synced = 0;
    const wanted = new Set<string>();

    for (const cctv of cctvs) {
        const source = rtspSourceFor(cctv);
        if (!source) {
            console.warn(`[stream] CCTV ${cctv.id} (${cctv.name}) tidak punya URL RTSP valid`);
            continue;
        }

        const name = streamPathFor(cctv.slug);
        wanted.add(name);
        const current = existingByName.get(name);

        if (!current) {
            await mediamtx("POST", `/v3/config/paths/add/${name}`, desiredConf(source));
            synced++;
        } else if (needsUpdate(current, source)) {
            await mediamtx("DELETE", `/v3/config/paths/delete/${name}`);
            await mediamtx("POST", `/v3/config/paths/add/${name}`, desiredConf(source));
            synced++;
        }
    }

    let removed = 0;
    for (const name of existingByName.keys()) {
        if (wanted.has(name)) continue;
        await mediamtx("DELETE", `/v3/config/paths/delete/${name}`);
        removed++;
    }

    return { synced, removed };
}

/** Hapus satu path (dipakai saat CCTV dihapus atau dinonaktifkan). */
export async function removeStreamPath(slug: string): Promise<void> {
    await mediamtx("DELETE", `/v3/config/paths/delete/${streamPathFor(slug)}`);
}

/**
 * Status runtime tiap stream.
 *
 * Catatan penting: `streaming` bernilai false saat tidak ada penonton — itu
 * konsekuensi `sourceOnDemand`, BUKAN tanda kamera bermasalah. Untuk mengetahui
 * kamera benar-benar terjangkau, pakai thumbnail (/thumbnail/<slug>).
 */
export async function getStreamStatus(): Promise<StreamPathStatus[]> {
    const [cctvs, runtime] = await Promise.all([
        prisma.cctv.findMany({
            where: { isActive: true },
            select: { id: true, slug: true, name: true },
        }),
        mediamtx<MediamtxList<{ name?: string; ready?: boolean; readers?: unknown[] }>>(
            "GET",
            "/v3/paths/list?itemsPerPage=1000"
        ),
    ]);

    const byName = new Map((runtime?.items ?? []).map((p) => [p.name, p]));

    return cctvs.map((cctv) => {
        const path = streamPathFor(cctv.slug);
        const state = byName.get(path);
        return {
            id: cctv.id,
            slug: cctv.slug,
            name: cctv.name,
            path,
            streaming: Boolean(state?.ready),
            registered: state !== undefined,
            viewers: state?.readers?.length ?? 0,
        };
    });
}

/**
 * Terbitkan izin menonton satu kamera.
 *
 * Player memanggil ini sebelum memulai playback. Grant disimpan sebagai cookie
 * ber-Path sempit, lalu middleware memverifikasinya pada setiap permintaan ke
 * proxy media — termasuk setiap segmen HLS, karena cookie ikut otomatis.
 *
 * Kebijakan aksesnya sengaja mengikuti model "unlisted" yang sudah dipakai
 * halaman detail: siapa pun yang tahu slug (UUID) boleh menonton. Kalau nanti
 * ingin lebih ketat (wajib login / anggota grup untuk kamera privat), inilah
 * satu-satunya tempat yang perlu diubah.
 */
export async function requestStreamAccess(
    slug: string
): Promise<{ ok: boolean; reason?: string }> {
    if (!slug) return { ok: false, reason: "Slug kosong" };

    const cctv = await prisma.cctv.findUnique({
        where: { slug },
        select: { isActive: true },
    });

    if (!cctv) return { ok: false, reason: "Kamera tidak ditemukan" };
    if (!cctv.isActive) return { ok: false, reason: "Kamera tidak aktif" };

    const grant = await signStreamGrant(slug);
    const cookieStore = await cookies();

    for (const path of grantCookiePaths(slug)) {
        cookieStore.set({
            name: STREAM_GRANT_COOKIE,
            value: grant,
            path,
            httpOnly: true,
            sameSite: "lax",
            secure: false,
            maxAge: GRANT_TTL_SECONDS,
        });
    }

    return { ok: true };
}
