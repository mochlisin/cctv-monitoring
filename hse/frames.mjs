import { spawn } from "child_process";
import { streamPathFor } from "./config.mjs";

/**
 * Pemasok frame: satu ffmpeg berumur panjang per kamera.
 *
 * Kenapa berumur panjang, bukan satu proses per frame seperti endpoint
 * thumbnail: memulai ffmpeg berarti membuka koneksi RTSP baru dan menunggu
 * keyframe berikutnya, yang di kamera dengan GOP 4 detik memakan waktu lebih
 * lama daripada seluruh inferensi. Untuk sesuatu yang berjalan sepanjang hari,
 * biaya itu akan mendominasi segalanya.
 *
 * Konsekuensinya jujur disebutkan: kamera dengan HSE aktif ditarik terus-
 * menerus, jadi `sourceOnDemand` MediaMTX tidak lagi berlaku untuknya. Memang
 * begitu seharusnya — pemantauan keselamatan yang hanya berjalan saat ada yang
 * menonton bukan pemantauan.
 *
 * Dua pekerjaan berat diserahkan ke ffmpeg, bukan JavaScript:
 *
 * - Letterbox. Penskalaan dan pad dilakukan di C dengan angka yang kita hitung
 *   sendiri, sehingga frame tiba tepat seukuran masukan model dan pemetaan
 *   kotak kembali ke koordinat asli menjadi aritmetika biasa.
 * - Dekode hanya keyframe (`-skip_frame nokey`). Seluruh P-frame dilewatkan,
 *   dan inilah penghematan CPU terbesar di worker ini.
 */

const BACKOFF_START_MS = 2000;
const BACKOFF_MAX_MS = 60_000;

/** Hitung penskalaan letterbox yang sama persis dengan yang diminta ke ffmpeg. */
export function letterboxFor(sourceWidth, sourceHeight, size) {
    const scale = Math.min(size / sourceWidth, size / sourceHeight);
    const width = Math.max(2, Math.round((sourceWidth * scale) / 2) * 2);
    const height = Math.max(2, Math.round((sourceHeight * scale) / 2) * 2);
    return {
        sourceWidth,
        sourceHeight,
        width,
        height,
        padX: Math.floor((size - width) / 2),
        padY: Math.floor((size - height) / 2),
    };
}

/** Resolusi stream, dibutuhkan untuk menghitung letterbox. */
function probe(url, ffprobePath) {
    return new Promise((resolve) => {
        const proc = spawn(ffprobePath, [
            "-v", "error",
            "-rtsp_transport", "tcp",
            "-select_streams", "v:0",
            "-show_entries", "stream=width,height",
            "-of", "json",
            url,
        ]);

        let out = "";
        const timer = setTimeout(() => proc.kill("SIGKILL"), 20_000);

        proc.stdout.on("data", (chunk) => (out += chunk));
        proc.on("error", () => {
            clearTimeout(timer);
            resolve(null);
        });
        proc.on("close", () => {
            clearTimeout(timer);
            try {
                const stream = JSON.parse(out).streams?.[0];
                if (stream?.width > 0 && stream?.height > 0) {
                    resolve({ width: stream.width, height: stream.height });
                    return;
                }
            } catch {
                /* jatuh ke null */
            }
            resolve(null);
        });
    });
}

/**
 * Sidik jari murah sebuah frame.
 *
 * Saat hanya keyframe yang didekode sementara filter fps meminta laju tetap,
 * ffmpeg menggandakan frame terakhir untuk menutupi selisihnya. Tanpa
 * pemeriksaan ini, kamera ber-GOP 4 detik akan membuat kita menginferensi
 * gambar yang sama persis empat kali — membakar CPU untuk jawaban yang sudah
 * kita punya. Membandingkan beberapa ratus piksel jauh lebih murah daripada
 * satu inferensi, jadi bahkan kalau salah sesekali, taruhannya menguntungkan.
 */
function signature(frame) {
    let hash = 2166136261;
    const step = Math.max(3, Math.floor(frame.length / 512 / 3) * 3);
    for (let i = 0; i < frame.length; i += step) {
        hash ^= frame[i];
        hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
}

export class FrameSource {
    /**
     * @param {{slug: string, name: string}} camera
     * @param {object} config
     * @param {(frame: Buffer, source: FrameSource) => void} onFrame
     */
    constructor(camera, config, onFrame) {
        this.camera = camera;
        this.config = config;
        this.onFrame = onFrame;
        this.size = config.inputSize;
        this.frameBytes = this.size * this.size * 3;
        this.letterbox = null;
        this.proc = null;
        this.stopped = false;
        this.backoffMs = BACKOFF_START_MS;
        this.lastSignature = null;
        this.lastFrameAt = 0;
        this.online = false;
        this.buffer = Buffer.alloc(0);
        this.restartTimer = null;
    }

    get url() {
        return `${this.config.rtspOrigin}/${streamPathFor(this.camera.slug)}`;
    }

    async start() {
        this.stopped = false;
        await this.#spawn();
    }

    stop() {
        this.stopped = true;
        this.online = false;
        clearTimeout(this.restartTimer);
        this.proc?.kill("SIGKILL");
        this.proc = null;
        this.buffer = Buffer.alloc(0);
    }

    #scheduleRestart() {
        if (this.stopped) return;
        clearTimeout(this.restartTimer);
        this.restartTimer = setTimeout(() => this.#spawn(), this.backoffMs);
        this.backoffMs = Math.min(this.backoffMs * 2, BACKOFF_MAX_MS);
    }

    async #spawn() {
        if (this.stopped) return;

        if (!this.letterbox) {
            const dims = await probe(this.url, this.config.ffprobePath);
            if (!dims) {
                console.warn(`[hse] ${this.camera.name}: stream belum bisa dibaca, coba lagi nanti`);
                this.#scheduleRestart();
                return;
            }
            this.letterbox = letterboxFor(dims.width, dims.height, this.size);
        }

        const { width, height, padX, padY } = this.letterbox;
        // Laju pipa dikunci di laju tertinggi yang mungkin diminta (mode boost).
        // Penjadwal-lah yang memutuskan frame mana yang benar-benar dianalisis,
        // sehingga mengubah interval tidak perlu menyalakan ulang ffmpeg.
        const fps = Math.max(0.1, 1 / Math.max(0.2, this.config.boostIntervalSeconds));

        const args = [
            "-nostdin",
            "-hide_banner",
            "-loglevel", "error",
            ...(this.config.keyframesOnly ? ["-skip_frame", "nokey"] : []),
            "-rtsp_transport", "tcp",
            "-i", this.url,
            "-an",
            "-sn",
            "-vf", `fps=${fps},scale=${width}:${height},pad=${this.size}:${this.size}:${padX}:${padY}:color=black`,
            "-pix_fmt", "rgb24",
            "-f", "rawvideo",
            "-",
        ];

        let proc;
        try {
            proc = spawn(this.config.ffmpegPath, args);
        } catch (error) {
            console.error(`[hse] ${this.camera.name}: ffmpeg gagal dijalankan:`, error.message);
            this.#scheduleRestart();
            return;
        }

        this.proc = proc;
        this.buffer = Buffer.alloc(0);

        proc.stdout.on("data", (chunk) => this.#consume(chunk));
        proc.stderr.on("data", (chunk) => {
            const message = chunk.toString().trim();
            if (message) console.warn(`[hse] ${this.camera.name}: ${message}`);
        });
        proc.on("error", () => this.#handleExit());
        proc.on("close", () => this.#handleExit());
    }

    #handleExit() {
        this.online = false;
        if (this.proc) this.proc = null;
        if (this.stopped) return;
        console.warn(`[hse] ${this.camera.name}: aliran terputus, menyambung ulang`);
        this.#scheduleRestart();
    }

    #consume(chunk) {
        this.buffer = this.buffer.length ? Buffer.concat([this.buffer, chunk]) : chunk;

        while (this.buffer.length >= this.frameBytes) {
            const frame = this.buffer.subarray(0, this.frameBytes);
            this.buffer = this.buffer.subarray(this.frameBytes);

            // Frame pertama yang utuh membuktikan jalurnya sehat: reset backoff.
            this.online = true;
            this.backoffMs = BACKOFF_START_MS;
            this.lastFrameAt = Date.now();

            const sig = signature(frame);
            if (sig === this.lastSignature) continue;
            this.lastSignature = sig;

            // Salin: subarray masih menunjuk ke buffer yang akan ditimpa chunk
            // berikutnya, sementara inferensi berjalan asinkron.
            this.onFrame(Buffer.from(frame), this);
        }
    }
}
