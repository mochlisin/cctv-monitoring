"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getUserId, getUserWithMemberships } from "@/lib/auth";
import { HSE_COUNTED_STATUSES, HSE_STATUS, parseHseColors, type HseColors } from "@/lib/hse";

/**
 * Sisi baca HSE monitoring.
 *
 * Aplikasi tidak pernah menganalisis gambar — itu sepenuhnya pekerjaan worker
 * di `hse/`. Di sini hanya ada pertanyaan-pertanyaan yang diajukan ke hasil
 * kerjanya, plus dua hal yang memang keputusan manusia: kamera mana yang
 * dipantau, dan apakah sebuah deteksi benar.
 */

const WORKER_URL = process.env.HSE_WORKER_URL ?? "http://127.0.0.1:9998";
const MAX_CAMERAS = Number(process.env.HSE_MAX_CAMERAS ?? 3);

/* ---------------------------------------------------------------- akses */

/**
 * Batasi query ke CCTV yang boleh dilihat pengguna ini.
 *
 * Aturannya sama persis dengan getCctvs: super admin sistem melihat semuanya,
 * sisanya melihat kamera buatannya sendiri dan kamera milik grupnya. Event HSE
 * mewarisi kepemilikan kameranya — kalau tidak, laporan pelanggaran satu
 * perusahaan akan terbaca oleh perusahaan lain di instalasi yang sama.
 */
async function cctvScope(): Promise<Prisma.CctvWhereInput | null> {
    const userId = await getUserId();
    if (!userId) return null;

    const user = await getUserWithMemberships();
    const isSystemSuperAdmin =
        user?.memberships.some(
            (m) =>
                (m.groupSlug === "default" || m.groupId === 1) &&
                m.roleName.toLowerCase().includes("super")
        ) ?? false;

    if (isSystemSuperAdmin) return {};

    const groupIds = user?.memberships.map((m) => m.groupId) ?? [];
    return { OR: [{ createdById: userId }, { groupId: { in: groupIds } }] };
}

/** Boleh mengubah pengaturan / meninjau event kamera ini? */
async function canManage(cctvId: number): Promise<boolean> {
    const userId = await getUserId();
    if (!userId) return false;

    const cctv = await prisma.cctv.findUnique({
        where: { id: cctvId },
        select: { createdById: true, groupId: true },
    });
    if (!cctv) return false;

    const user = await getUserWithMemberships();
    const isSystemSuperAdmin =
        user?.memberships.some(
            (m) =>
                (m.groupSlug === "default" || m.groupId === 1) &&
                m.roleName.toLowerCase().includes("super")
        ) ?? false;
    if (isSystemSuperAdmin || cctv.createdById === userId) return true;

    return (
        user?.memberships.some(
            (m) =>
                m.groupId === cctv.groupId &&
                (m.roleName.toLowerCase().includes("admin") ||
                    m.roleName.toLowerCase().includes("operator"))
        ) ?? false
    );
}

/* ---------------------------------------------------------------- event */

export type HseEventRow = {
    id: number;
    cctvId: number;
    cctvName: string;
    cctvSlug: string;
    type: string;
    status: string;
    startedAt: Date;
    endedAt: Date;
    duration: number;
    personCount: number;
    violatorCount: number;
    maxConfidence: number;
    colors: HseColors;
    snapshot: string | null;
    note: string | null;
};

export type HseEventFilter = {
    cctvId?: number;
    status?: string;
    type?: string;
    /** Jumlah hari ke belakang. */
    days?: number;
    take?: number;
    skip?: number;
};

export async function getHseEvents(
    filter: HseEventFilter = {}
): Promise<{ rows: HseEventRow[]; total: number }> {
    const scope = await cctvScope();
    if (!scope) return { rows: [], total: 0 };

    const where: Prisma.HseEventWhereInput = { cctv: scope };
    if (filter.cctvId) where.cctvId = filter.cctvId;
    if (filter.status) where.status = filter.status;
    if (filter.type) where.type = filter.type;
    if (filter.days) {
        where.startedAt = { gte: new Date(Date.now() - filter.days * 86_400_000) };
    }

    const take = Math.min(filter.take ?? 50, 200);

    const [rows, total] = await Promise.all([
        prisma.hseEvent.findMany({
            where,
            orderBy: { startedAt: "desc" },
            take,
            skip: filter.skip ?? 0,
            select: {
                id: true,
                cctvId: true,
                type: true,
                status: true,
                startedAt: true,
                endedAt: true,
                duration: true,
                personCount: true,
                violatorCount: true,
                maxConfidence: true,
                colors: true,
                snapshot: true,
                note: true,
                cctv: { select: { name: true, slug: true } },
            },
        }),
        prisma.hseEvent.count({ where }),
    ]);

    // Yang sedang berlangsung naik ke atas, sisanya terbaru dulu.
    //
    // Diurutkan di sini, bukan di ORDER BY: status disimpan sebagai string, dan
    // secara alfabet "OPEN" justru jatuh paling akhir — di belakang
    // ACKNOWLEDGED, CLOSED, dan FALSE_POSITIVE. Operator membuka halaman ini
    // untuk menangani yang sedang terjadi, bukan mengarsip.
    const ordered = rows.sort((a, b) => {
        const open = Number(b.status === HSE_STATUS.OPEN) - Number(a.status === HSE_STATUS.OPEN);
        return open !== 0 ? open : b.startedAt.getTime() - a.startedAt.getTime();
    });

    return {
        rows: ordered.map((r) => ({
            id: r.id,
            cctvId: r.cctvId,
            cctvName: r.cctv.name,
            cctvSlug: r.cctv.slug,
            type: r.type,
            status: r.status,
            startedAt: r.startedAt,
            endedAt: r.endedAt,
            duration: r.duration,
            personCount: r.personCount,
            violatorCount: r.violatorCount,
            maxConfidence: r.maxConfidence,
            colors: parseHseColors(r.colors),
            snapshot: r.snapshot,
            note: r.note,
        })),
        total,
    };
}

/**
 * Tandai sebuah event sudah ditindaklanjuti, atau salah deteksi.
 *
 * Menandai salah deteksi bukan sekadar merapikan tampilan: event seperti itu
 * dikeluarkan dari perhitungan kepatuhan, sehingga angka di dasbor mengukur
 * perilaku pekerja, bukan keterbatasan model. Kumpulan event FALSE_POSITIVE
 * beserta snapshot-nya juga persis bahan yang dibutuhkan untuk melatih ulang
 * model dengan data lokasi sendiri.
 */
export async function reviewHseEvent(id: number, status: string, note?: string) {
    if (status !== HSE_STATUS.ACKNOWLEDGED && status !== HSE_STATUS.FALSE_POSITIVE) {
        throw new Error("Status tidak valid");
    }

    const event = await prisma.hseEvent.findUnique({ where: { id }, select: { cctvId: true } });
    if (!event) throw new Error("Event tidak ditemukan");
    if (!(await canManage(event.cctvId))) throw new Error("Forbidden");

    await prisma.hseEvent.update({
        where: { id },
        data: {
            status,
            note: note?.trim() || null,
            acknowledgedById: await getUserId(),
            acknowledgedAt: new Date(),
        },
    });

    revalidatePath("/admin/hse");
}

/* ---------------------------------------------------------------- statistik */

export type HseSummary = {
    /** Total per jenis APD sepanjang rentang. */
    helmetOk: number;
    helmetMissing: number;
    vestOk: number;
    vestMissing: number;
    personCount: number;
    frames: number;
    eventCount: number;
    openCount: number;
    colors: HseColors;
    /**
     * Cakupan pemantauan — wajib dibaca bersama angka kepatuhan, bukan sebagai
     * pelengkap.
     *
     * "0 pelanggaran" pada kamera yang tidak melihat apa pun tampak identik
     * dengan lokasi yang benar-benar patuh, dan pada sistem keselamatan itu
     * kesalahan yang paling mahal. Angka-angka di bawah adalah satu-satunya cara
     * membedakan keduanya.
     */
    coverage: {
        /** Detik yang benar-benar terwakili analisis. */
        coveredSeconds: number;
        /**
         * Detik yang seharusnya terpantau: jumlah kamera HSE x panjang rentang.
         *
         * Sengaja konservatif — kamera yang baru diaktifkan di tengah rentang
         * tetap dihitung penuh, sehingga persentasenya cenderung LEBIH RENDAH
         * dari kenyataan. Untuk angka keselamatan, meleset ke arah "mengaku
         * kurang terpantau" jauh lebih aman daripada sebaliknya.
         */
        expectedSeconds: number;
        /** Persen 0..100, null kalau tidak ada kamera HSE sama sekali. */
        percent: number | null;
        /** Frame dalam mode inframerah — deteksi lebih lemah di sini. */
        monoFrames: number;
        /**
         * Total frame dianalisis, disalin ke sini supaya porsi inframerah bisa
         * dihitung tanpa pemakainya perlu tahu medan mana pembaginya.
         */
        framesTotal: number;
        /** Orang yang terlihat tapi terlalu jauh/kecil untuk dinilai. */
        tooSmall: number;
        /** Penilaian APD yang tidak dapat dibaca (tertutup, membelakangi kamera). */
        helmetUnknown: number;
        vestUnknown: number;
    };
    /** Deret waktu untuk grafik, satu titik per hari. */
    daily: {
        day: string;
        helmetOk: number;
        helmetMissing: number;
        vestOk: number;
        vestMissing: number;
    }[];
    /** Sebaran jam kejadian 0..23 — memperlihatkan kapan pelanggaran menumpuk. */
    hourly: number[];
    perCamera: {
        cctvId: number;
        name: string;
        slug: string;
        helmetOk: number;
        helmetMissing: number;
        vestOk: number;
        vestMissing: number;
        eventCount: number;
        /** Cakupan per kamera — memperlihatkan kamera mana yang sedang buta. */
        coveredSeconds: number;
        tooSmall: number;
    }[];
};

export async function getHseSummary(days = 7): Promise<HseSummary> {
    const scope = await cctvScope();
    const empty: HseSummary = {
        helmetOk: 0, helmetMissing: 0, vestOk: 0, vestMissing: 0,
        personCount: 0, frames: 0, eventCount: 0, openCount: 0,
        colors: {}, daily: [], hourly: Array(24).fill(0), perCamera: [],
        coverage: {
            coveredSeconds: 0, expectedSeconds: 0, percent: null,
            monoFrames: 0, framesTotal: 0, tooSmall: 0, helmetUnknown: 0, vestUnknown: 0,
        },
    };
    if (!scope) return empty;

    const since = new Date(Date.now() - days * 86_400_000);

    const [buckets, events, cameras] = await Promise.all([
        prisma.hseBucket.findMany({
            where: { bucketStart: { gte: since }, cctv: scope },
            select: {
                cctvId: true, bucketStart: true, frames: true, personCount: true,
                helmetOk: true, helmetMissing: true, vestOk: true, vestMissing: true, colors: true,
                tooSmall: true, helmetUnknown: true, vestUnknown: true,
                monoFrames: true, coveredSeconds: true,
            },
        }),
        prisma.hseEvent.findMany({
            where: {
                startedAt: { gte: since },
                cctv: scope,
                // Salah deteksi tidak ikut membentuk angka apa pun.
                status: { in: HSE_COUNTED_STATUSES },
            },
            select: { cctvId: true, startedAt: true, status: true },
        }),
        prisma.cctv.findMany({
            where: { hseEnabled: true, ...scope },
            select: { id: true, name: true, slug: true },
        }),
    ]);

    const summary: HseSummary = {
        ...empty,
        colors: { helmet: {}, vest: {} },
        hourly: Array(24).fill(0),
        coverage: { ...empty.coverage },
    };
    const daily = new Map<string, HseSummary["daily"][number]>();
    const perCamera = new Map<number, HseSummary["perCamera"][number]>();

    for (const camera of cameras) {
        perCamera.set(camera.id, {
            cctvId: camera.id, name: camera.name, slug: camera.slug,
            helmetOk: 0, helmetMissing: 0, vestOk: 0, vestMissing: 0, eventCount: 0,
            coveredSeconds: 0, tooSmall: 0,
        });
    }

    // Dihitung dari jumlah kamera HSE, bukan dari data yang ada: kalau seluruh
    // worker mati sepanjang rentang, tidak akan ada satu bucket pun — dan
    // cakupan yang diturunkan dari bucket akan melaporkan 100% dari nol data.
    summary.coverage.expectedSeconds = cameras.length * days * 86_400;

    for (const bucket of buckets) {
        summary.frames += bucket.frames;
        summary.personCount += bucket.personCount;
        summary.helmetOk += bucket.helmetOk;
        summary.helmetMissing += bucket.helmetMissing;
        summary.vestOk += bucket.vestOk;
        summary.vestMissing += bucket.vestMissing;
        summary.coverage.coveredSeconds += bucket.coveredSeconds;
        summary.coverage.monoFrames += bucket.monoFrames;
        summary.coverage.tooSmall += bucket.tooSmall;
        summary.coverage.helmetUnknown += bucket.helmetUnknown;
        summary.coverage.vestUnknown += bucket.vestUnknown;

        const day = bucket.bucketStart.toISOString().slice(0, 10);
        const entry = daily.get(day) ?? { day, helmetOk: 0, helmetMissing: 0, vestOk: 0, vestMissing: 0 };
        entry.helmetOk += bucket.helmetOk;
        entry.helmetMissing += bucket.helmetMissing;
        entry.vestOk += bucket.vestOk;
        entry.vestMissing += bucket.vestMissing;
        daily.set(day, entry);

        const camera = perCamera.get(bucket.cctvId);
        if (camera) {
            camera.helmetOk += bucket.helmetOk;
            camera.helmetMissing += bucket.helmetMissing;
            camera.vestOk += bucket.vestOk;
            camera.vestMissing += bucket.vestMissing;
            camera.coveredSeconds += bucket.coveredSeconds;
            camera.tooSmall += bucket.tooSmall;
        }

        const colors = parseHseColors(bucket.colors);
        for (const kind of ["helmet", "vest"] as const) {
            for (const [name, count] of Object.entries(colors[kind] ?? {})) {
                const target = summary.colors[kind]!;
                target[name] = (target[name] ?? 0) + count;
            }
        }
    }

    for (const event of events) {
        summary.eventCount++;
        if (event.status === HSE_STATUS.OPEN) summary.openCount++;
        summary.hourly[event.startedAt.getHours()]++;
        const camera = perCamera.get(event.cctvId);
        if (camera) camera.eventCount++;
    }

    summary.daily = [...daily.values()].sort((a, b) => a.day.localeCompare(b.day));
    summary.perCamera = [...perCamera.values()].sort(
        (a, b) => b.helmetMissing + b.vestMissing - (a.helmetMissing + a.vestMissing)
    );

    if (!Object.keys(summary.colors.helmet ?? {}).length) delete summary.colors.helmet;
    if (!Object.keys(summary.colors.vest ?? {}).length) delete summary.colors.vest;

    // Dibatasi 100%: interval yang berlaku saat analisis dijalankan adalah
    // perkiraan lama waktu yang diwakilinya, dan pada mode boost perkiraan itu
    // bisa sedikit melebihi panjang selang sebenarnya. Melaporkan "104% terpantau"
    // hanya akan membuat seluruh angka diragukan.
    summary.coverage.framesTotal = summary.frames;
    summary.coverage.percent =
        summary.coverage.expectedSeconds > 0
            ? Math.min(
                  100,
                  Math.round((summary.coverage.coveredSeconds / summary.coverage.expectedSeconds) * 1000) / 10
              )
            : null;

    return summary;
}

/* ---------------------------------------------------------------- pengaturan */

export type HseCameraSettings = {
    hseEnabled: boolean;
    hseRequireHelm: boolean;
    hseRequireVest: boolean;
    hseMinDuration: number;
};

/**
 * Nyalakan / matikan pemantauan HSE untuk satu kamera.
 *
 * Batas jumlah kamera ditegakkan di sini, bukan hanya di worker. Kalau hanya
 * worker yang menolak, admin akan melihat kamera keempat tampak menyala di
 * tabel padahal tidak ada yang menganalisisnya — kegagalan diam-diam yang
 * paling berbahaya di sistem keselamatan.
 */
export async function setHseSettings(cctvId: number, settings: HseCameraSettings) {
    if (!(await canManage(cctvId))) throw new Error("Forbidden");

    if (settings.hseEnabled) {
        const enabled = await prisma.cctv.count({
            where: { hseEnabled: true, isActive: true, id: { not: cctvId } },
        });
        if (enabled >= MAX_CAMERAS) {
            throw new Error(
                `Batas ${MAX_CAMERAS} kamera HSE sudah tercapai. Matikan kamera lain lebih dulu, ` +
                    "atau naikkan HSE_MAX_CAMERAS kalau CPU server memang mencukupi."
            );
        }

        if (!settings.hseRequireHelm && !settings.hseRequireVest) {
            throw new Error("Pilih minimal satu APD yang diwajibkan");
        }
    }

    await prisma.cctv.update({
        where: { id: cctvId },
        data: {
            hseEnabled: settings.hseEnabled,
            hseRequireHelm: settings.hseRequireHelm,
            hseRequireVest: settings.hseRequireVest,
            // Di bawah beberapa detik, ambang ini tidak lagi menyaring apa pun:
            // interval sampling worker sendiri sudah beberapa detik.
            hseMinDuration: Math.max(3, Math.min(300, Math.round(settings.hseMinDuration))),
        },
    });

    revalidatePath("/admin/hse");
    revalidatePath("/admin/cctv");
}

export async function getHseCameras() {
    const scope = await cctvScope();
    if (!scope) return [];

    return prisma.cctv.findMany({
        where: { ...scope },
        orderBy: [{ hseEnabled: "desc" }, { name: "asc" }],
        select: {
            id: true, name: true, slug: true, isActive: true,
            hseEnabled: true, hseRequireHelm: true, hseRequireVest: true, hseMinDuration: true,
        },
    });
}

/* ---------------------------------------------------------------- kesehatan */

/**
 * Berapa lama tanpa frame sebelum kamera dianggap tidak mengirim apa pun lagi.
 *
 * Dibutuhkan karena `online` milik worker hanya menjadi false ketika proses
 * ffmpeg-nya keluar. RTSP yang menggantung — kamera hidup, TCP tersambung, tapi
 * tidak ada data — meninggalkan `online: true` selamanya dengan `lastFrameAt`
 * yang tidak pernah maju. Itu kegagalan diam-diam: dasbor tampak sehat sementara
 * lokasi itu tidak terlihat sama sekali.
 */
const STALE_FRAME_MS = 60_000;

export type HseWorkerHealth = {
    ok: boolean;
    reason?: string;
    averageInferenceMs?: number;
    intervalSeconds?: number;
    cameras?: {
        id: number;
        name: string;
        slug: string;
        online: boolean;
        lastFrameAt: number | null;
        lastInferenceAt: number | null;
        boosted: boolean;
        violatorCount: number;
        /** Masih diklaim online tapi frame terakhirnya sudah lama sekali. */
        stale: boolean;
    }[];
    /**
     * Kamera yang hseEnabled di database tapi TIDAK dipantau worker sama sekali.
     *
     * Terjadi saat jumlah kamera melewati HSE_MAX_CAMERAS, atau saat batas di
     * Next dan di worker berbeda. Sebelum ini kamera seperti itu tidak muncul di
     * mana pun: tabel kamera menampilkannya menyala, dasbor tidak menyebutnya,
     * dan tidak ada satu pun angka yang mengaku tidak mencakupnya.
     */
    unmonitored?: { id: number; name: string }[];
};

/**
 * Keadaan worker.
 *
 * Wajib ditampilkan di dasbor. Sistem pemantauan keselamatan yang diam-diam
 * berhenti bekerja lebih berbahaya daripada tidak punya sistem sama sekali:
 * layar tetap menunjukkan nol pelanggaran, dan nol itu dibaca sebagai aman.
 */
export async function getHseWorkerHealth(): Promise<HseWorkerHealth> {
    let reported: HseWorkerHealth;
    try {
        const response = await fetch(`${WORKER_URL}/health`, {
            signal: AbortSignal.timeout(3000),
            cache: "no-store",
        });
        if (!response.ok) return { ok: false, reason: `Worker menjawab ${response.status}` };
        reported = { ok: true, ...(await response.json()) };
    } catch {
        return { ok: false, reason: "Worker HSE tidak berjalan" };
    }

    // Tandai kamera yang mengaku online tapi frame terakhirnya sudah basi.
    const now = Date.now();
    const cameras = (reported.cameras ?? []).map((camera) => ({
        ...camera,
        stale: Boolean(camera.lastFrameAt) && now - camera.lastFrameAt! > STALE_FRAME_MS,
    }));

    // Bandingkan dengan database: kamera yang dinyalakan tapi tidak ada dalam
    // daftar worker adalah blind spot, dan sebelum ini tidak dilaporkan ke mana
    // pun. Kegagalan pada query ini tidak boleh menjatuhkan seluruh panel status,
    // jadi hasilnya sekadar dikosongkan.
    let unmonitored: HseWorkerHealth["unmonitored"] = [];
    try {
        const scope = await cctvScope();
        if (scope) {
            const enabled = await prisma.cctv.findMany({
                where: { hseEnabled: true, isActive: true, ...scope },
                select: { id: true, name: true },
            });
            const monitored = new Set(cameras.map((c) => c.id));
            unmonitored = enabled.filter((c) => !monitored.has(c.id));
        }
    } catch (error) {
        console.error("[hse] gagal memeriksa kamera tak terpantau:", (error as Error).message);
    }

    return { ...reported, cameras, unmonitored };
}
