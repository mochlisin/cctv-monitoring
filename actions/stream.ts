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
        source,
        // Kamera baru dihubungi saat ada penonton, dan diputus lagi setelah sepi.
        sourceOnDemand: true,
        sourceOnDemandCloseAfter: CLOSE_AFTER,
        rtspTransport: "tcp",
    };
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
        } else if (current.source !== source) {
            await mediamtx("PATCH", `/v3/config/paths/patch/${name}`, desiredConf(source));
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
            secure: process.env.NODE_ENV === "production",
            maxAge: GRANT_TTL_SECONDS,
        });
    }

    return { ok: true };
}
