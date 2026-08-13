import { spawn } from "child_process";
import fs from "fs/promises";
import path from "path";

/**
 * Penulisan hasil ke database dan disk.
 *
 * Dua keputusan bentuk data yang menentukan apakah sistem ini masih berjalan
 * setelah sebulan:
 *
 * 1. Deteksi mentah tidak pernah disimpan. Tiga kamera pada satu frame per
 *    lima detik menghasilkan lebih dari lima puluh ribu baris per hari, dan
 *    tidak ada satu pun pertanyaan HSE yang membutuhkannya. Yang disimpan
 *    adalah hitungan per selang waktu (HseBucket).
 *
 * 2. Event adalah periode, bukan frame. Satu orang tanpa helm selama dua menit
 *    adalah satu baris dengan durasi 120 detik — bukan dua puluh empat alarm
 *    yang harus ditutup satu per satu oleh operator.
 */

/** Awal selang, dibulatkan ke bawah ke kelipatan bucketMinutes. */
function bucketStartFor(date, minutes) {
    const ms = minutes * 60_000;
    return new Date(Math.floor(date.getTime() / ms) * ms);
}

function mergeTally(target, source) {
    if (!source) return target;
    for (const [key, value] of Object.entries(source)) {
        target[key] = (target[key] ?? 0) + value;
    }
    return target;
}

/**
 * Hitungan kepatuhan ditahan di memori lalu ditulis berkala.
 *
 * Menulis satu baris per frame berarti MySQL menerima read-modify-write untuk
 * kolom JSON warna setiap beberapa detik per kamera. Selang agregatnya sendiri
 * lima belas menit, jadi menulisnya sesering itu tidak menambah informasi apa
 * pun — hanya beban. Yang tertahan paling banyak satu periode flush, dan itu
 * hilang kalau worker dimatikan paksa; untuk statistik agregat, harga yang
 * pantas.
 */
class BucketAccumulator {
    constructor(prisma, minutes) {
        this.prisma = prisma;
        this.minutes = minutes;
        this.pending = new Map();
    }

    add(cctvId, at, tally, colors) {
        const start = bucketStartFor(at, this.minutes);
        const key = `${cctvId}:${start.getTime()}`;
        let entry = this.pending.get(key);
        if (!entry) {
            entry = {
                cctvId,
                bucketStart: start,
                frames: 0,
                personCount: 0,
                helmetOk: 0,
                helmetMissing: 0,
                vestOk: 0,
                vestMissing: 0,
                colors: { helmet: {}, vest: {} },
            };
            this.pending.set(key, entry);
        }

        entry.frames++;
        entry.personCount += tally.personCount;
        entry.helmetOk += tally.helmetOk;
        entry.helmetMissing += tally.helmetMissing;
        entry.vestOk += tally.vestOk;
        entry.vestMissing += tally.vestMissing;
        mergeTally(entry.colors.helmet, colors.helmet);
        mergeTally(entry.colors.vest, colors.vest);
    }

    async flush() {
        if (this.pending.size === 0) return;
        const entries = [...this.pending.values()];
        this.pending.clear();

        for (const entry of entries) {
            const colors = {
                ...(Object.keys(entry.colors.helmet).length ? { helmet: entry.colors.helmet } : {}),
                ...(Object.keys(entry.colors.vest).length ? { vest: entry.colors.vest } : {}),
            };

            try {
                const existing = await this.prisma.hseBucket.findUnique({
                    where: {
                        cctvId_bucketStart: { cctvId: entry.cctvId, bucketStart: entry.bucketStart },
                    },
                    select: { id: true, colors: true },
                });

                if (!existing) {
                    await this.prisma.hseBucket.create({
                        data: { ...entry, colors: Object.keys(colors).length ? colors : undefined },
                    });
                    continue;
                }

                // Warna digabung di sini, bukan lewat operator increment, karena
                // JSON tidak punya padanan increment di Prisma.
                const previous = (existing.colors ?? {});
                const merged = {
                    helmet: mergeTally({ ...(previous.helmet ?? {}) }, colors.helmet),
                    vest: mergeTally({ ...(previous.vest ?? {}) }, colors.vest),
                };

                await this.prisma.hseBucket.update({
                    where: { id: existing.id },
                    data: {
                        frames: { increment: entry.frames },
                        personCount: { increment: entry.personCount },
                        helmetOk: { increment: entry.helmetOk },
                        helmetMissing: { increment: entry.helmetMissing },
                        vestOk: { increment: entry.vestOk },
                        vestMissing: { increment: entry.vestMissing },
                        colors: {
                            ...(Object.keys(merged.helmet).length ? { helmet: merged.helmet } : {}),
                            ...(Object.keys(merged.vest).length ? { vest: merged.vest } : {}),
                        },
                    },
                });
            } catch (error) {
                console.error("[hse] gagal menulis bucket:", error.message);
            }
        }
    }
}

/**
 * Simpan frame bukti dengan kotak deteksi tergambar di atasnya.
 *
 * Yang disimpan adalah frame yang persis dilihat model — sudah letterbox, sudah
 * seukuran masukan. Bisa saja mengambil frame beresolusi penuh yang baru dari
 * RTSP, tapi frame itu bukan frame yang menghasilkan keputusan ini: orangnya
 * sudah bergerak, dan kotaknya akan meleset. Untuk bukti yang gunanya justru
 * meninjau apakah deteksinya benar, gambar yang cocok dengan kotaknya lebih
 * berharga daripada gambar yang lebih tajam.
 *
 * Kotak digambar oleh ffmpeg, bukan JavaScript. Tidak ada label teks: drawtext
 * membutuhkan berkas font yang keberadaannya berbeda-beda antar distribusi, dan
 * merah untuk pelanggar / hijau untuk yang patuh sudah cukup terbaca.
 */
async function writeSnapshot(config, frame, persons, relativePath) {
    const target = path.join(config.snapshotDir, relativePath);
    await fs.mkdir(path.dirname(target), { recursive: true });

    const size = config.inputSize;
    const boxes = persons
        .slice(0, 20)
        .map((p) => {
            const [x1, y1, x2, y2] = p.box;
            const x = Math.max(0, Math.round(x1));
            const y = Math.max(0, Math.round(y1));
            const w = Math.min(size - x, Math.round(x2 - x1));
            const h = Math.min(size - y, Math.round(y2 - y1));
            if (w <= 1 || h <= 1) return null;
            const color = p.violating ? "red" : "lime";
            return `drawbox=x=${x}:y=${y}:w=${w}:h=${h}:color=${color}:t=3`;
        })
        .filter(Boolean);

    const args = [
        "-nostdin", "-hide_banner", "-loglevel", "error",
        "-f", "rawvideo",
        "-pix_fmt", "rgb24",
        "-s", `${size}x${size}`,
        "-i", "pipe:0",
        ...(boxes.length ? ["-vf", boxes.join(",")] : []),
        "-frames:v", "1",
        "-q:v", "4",
        "-y", target,
    ];

    return new Promise((resolve) => {
        let proc;
        try {
            proc = spawn(config.ffmpegPath, args);
        } catch {
            resolve(null);
            return;
        }

        const timer = setTimeout(() => proc.kill("SIGKILL"), 10_000);
        proc.on("error", () => {
            clearTimeout(timer);
            resolve(null);
        });
        proc.on("close", (code) => {
            clearTimeout(timer);
            resolve(code === 0 ? relativePath : null);
        });
        proc.stdin.on("error", () => undefined);
        proc.stdin.end(frame);
    });
}

export class Store {
    constructor(prisma, config) {
        this.prisma = prisma;
        this.config = config;
        this.buckets = new BucketAccumulator(prisma, config.bucketMinutes);
        /** Keadaan event yang sedang berjalan, satu per kamera. */
        this.state = new Map();
    }

    /**
     * Tutup event yang tertinggal terbuka dari proses sebelumnya.
     *
     * Worker yang dimatikan di tengah pelanggaran meninggalkan baris berstatus
     * OPEN selamanya, dan dasbor akan menampilkannya sebagai "sedang
     * berlangsung" berbulan-bulan kemudian.
     */
    async closeStaleEvents() {
        const { count } = await this.prisma.hseEvent.updateMany({
            where: { status: "OPEN" },
            data: { status: "CLOSED" },
        });
        if (count) console.log(`[hse] ${count} event tertinggal dari sesi sebelumnya ditutup`);
    }

    /**
     * Catat satu frame yang sudah dianalisis.
     *
     * @param {{id:number, name:string, hseMinDuration:number}} camera
     * @param {object} assessment hasil assessFrame
     * @param {Buffer} frame untuk snapshot
     */
    async record(camera, assessment, frame) {
        const now = new Date();
        this.buckets.add(camera.id, now, assessment.tally, assessment.colors);

        if (assessment.violationType) {
            await this.#onViolation(camera, assessment, frame, now);
        } else {
            await this.#onClean(camera.id, now);
        }
    }

    #stateFor(cctvId) {
        let state = this.state.get(cctvId);
        if (!state) {
            state = { pendingSince: null, eventId: null, lastViolationAt: null, peak: null, type: null };
            this.state.set(cctvId, state);
        }
        return state;
    }

    async #onViolation(camera, assessment, frame, now) {
        const state = this.#stateFor(camera.id);
        const { tally } = assessment;

        // Rentang bersih yang panjang memutus rangkaian: pelanggaran setelahnya
        // adalah kejadian baru, bukan lanjutan dari yang tadi.
        if (state.lastViolationAt && now - state.lastViolationAt > this.config.eventGapSeconds * 1000) {
            await this.#closeEvent(camera.id, state.lastViolationAt);
            state.pendingSince = null;
        }

        state.lastViolationAt = now;
        state.pendingSince ??= now;

        const worse = !state.peak || tally.violatorCount > state.peak.violatorCount;
        if (worse) {
            state.peak = {
                violatorCount: tally.violatorCount,
                personCount: tally.personCount,
                maxConfidence: tally.maxConfidence,
                colors: assessment.colors,
                persons: assessment.persons,
                frame,
            };
        }
        state.type = assessment.violationType;

        // Ambang durasi ditegakkan di sini: pelanggaran yang hanya terlihat pada
        // satu frame belum pernah menyentuh database. Ini penyaring alarm palsu
        // paling efektif di seluruh sistem — orang yang lewat sekilas di tepi
        // frame tidak pernah menjadi laporan.
        const heldMs = now - state.pendingSince;
        if (heldMs < camera.hseMinDuration * 1000) return;

        if (state.eventId) {
            await this.#extendEvent(camera, state, now);
        } else {
            await this.#openEvent(camera, state, now);
        }
    }

    async #openEvent(camera, state, now) {
        const peak = state.peak;
        const snapshot = await this.#snapshot(camera, peak);

        try {
            const event = await this.prisma.hseEvent.create({
                data: {
                    cctvId: camera.id,
                    type: state.type,
                    startedAt: state.pendingSince,
                    endedAt: now,
                    duration: Math.round((now - state.pendingSince) / 1000),
                    personCount: peak.personCount,
                    violatorCount: peak.violatorCount,
                    maxConfidence: peak.maxConfidence,
                    colors: Object.keys(peak.colors).length ? peak.colors : undefined,
                    snapshot,
                    status: "OPEN",
                },
                select: { id: true },
            });
            state.eventId = event.id;
            state.snapshotAt = now;
            console.log(
                `[hse] ${camera.name}: ${state.type} (${peak.violatorCount} orang) → event #${event.id}`
            );
        } catch (error) {
            console.error("[hse] gagal membuat event:", error.message);
        }
    }

    async #extendEvent(camera, state, now) {
        const peak = state.peak;
        // Snapshot diganti hanya kalau frame yang lebih buruk muncul dan jeda
        // minimumnya sudah lewat — tanpa rem ini, satu event ramai bisa menulis
        // ratusan berkas JPEG.
        const dueSnapshot =
            !state.snapshotAt ||
            now - state.snapshotAt >= this.config.snapshotMinIntervalSeconds * 1000;

        let snapshot;
        if (dueSnapshot && peak.frame) {
            snapshot = await this.#snapshot(camera, peak);
            if (snapshot) state.snapshotAt = now;
        }

        try {
            await this.prisma.hseEvent.update({
                where: { id: state.eventId },
                data: {
                    type: state.type,
                    endedAt: now,
                    duration: Math.round((now - state.pendingSince) / 1000),
                    personCount: peak.personCount,
                    violatorCount: peak.violatorCount,
                    maxConfidence: peak.maxConfidence,
                    colors: Object.keys(peak.colors).length ? peak.colors : undefined,
                    ...(snapshot ? { snapshot } : {}),
                },
            });
        } catch (error) {
            console.error("[hse] gagal memperbarui event:", error.message);
            // Barisnya mungkin sudah dihapus operator; lepaskan supaya frame
            // berikutnya membuat event baru alih-alih gagal terus-menerus.
            state.eventId = null;
        }
    }

    async #snapshot(camera, peak) {
        if (!peak?.frame) return null;
        const stamp = new Date();
        const day = stamp.toISOString().slice(0, 10);
        const name = `${camera.id}-${stamp.getTime()}.jpg`;
        try {
            return await writeSnapshot(
                this.config,
                peak.frame,
                peak.persons,
                path.posix.join(day, name)
            );
        } catch (error) {
            console.error("[hse] gagal menulis snapshot:", error.message);
            return null;
        }
    }

    async #onClean(cctvId, now) {
        const state = this.state.get(cctvId);
        if (!state?.lastViolationAt) return;

        // Jeda pendek belum menutup apa pun: orang yang sebentar terhalang tiang
        // masih pelanggaran yang sama, bukan dua kejadian terpisah.
        if (now - state.lastViolationAt <= this.config.eventGapSeconds * 1000) return;

        await this.#closeEvent(cctvId, state.lastViolationAt);
        state.pendingSince = null;
        state.lastViolationAt = null;
        state.peak = null;
        state.type = null;
    }

    async #closeEvent(cctvId, endedAt) {
        const state = this.state.get(cctvId);
        if (!state?.eventId) {
            if (state) state.eventId = null;
            return;
        }

        try {
            const event = await this.prisma.hseEvent.findUnique({
                where: { id: state.eventId },
                select: { startedAt: true },
            });
            if (event) {
                await this.prisma.hseEvent.update({
                    where: { id: state.eventId },
                    data: {
                        status: "CLOSED",
                        endedAt,
                        duration: Math.max(0, Math.round((endedAt - event.startedAt) / 1000)),
                    },
                });
            }
        } catch (error) {
            console.error("[hse] gagal menutup event:", error.message);
        }

        state.eventId = null;
        state.snapshotAt = null;
        state.peak = null;
    }

    /** Tutup semua event yang masih terbuka — dipanggil saat worker berhenti. */
    async closeAll() {
        for (const [cctvId, state] of this.state) {
            if (state.eventId) await this.#closeEvent(cctvId, state.lastViolationAt ?? new Date());
        }
        await this.buckets.flush();
    }

    async flush() {
        await this.buckets.flush();
    }

    /**
     * Buang data lampau. Tanpa ini, tabel event dan folder snapshot tumbuh
     * selamanya — dan yang lebih dulu penuh biasanya disk, bukan database.
     */
    async prune() {
        const cutoff = new Date(Date.now() - this.config.retentionDays * 86_400_000);

        try {
            const [events, buckets] = await Promise.all([
                this.prisma.hseEvent.deleteMany({ where: { startedAt: { lt: cutoff } } }),
                this.prisma.hseBucket.deleteMany({ where: { bucketStart: { lt: cutoff } } }),
            ]);
            if (events.count || buckets.count) {
                console.log(`[hse] pembersihan: ${events.count} event, ${buckets.count} bucket dihapus`);
            }
        } catch (error) {
            console.error("[hse] pembersihan database gagal:", error.message);
        }

        // Snapshot dikelompokkan per tanggal, jadi cukup menghapus foldernya.
        try {
            const days = await fs.readdir(this.config.snapshotDir);
            const cutoffDay = cutoff.toISOString().slice(0, 10);
            for (const day of days) {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day >= cutoffDay) continue;
                await fs.rm(path.join(this.config.snapshotDir, day), { recursive: true, force: true });
            }
        } catch {
            /* folder belum ada — tidak ada yang perlu dibersihkan */
        }
    }
}
