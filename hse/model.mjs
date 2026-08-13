import fs from "fs/promises";
import { buildRoleTable, describeClasses, DEFAULT_CLASSES } from "./classes.mjs";

/**
 * Inferensi ONNX Runtime di CPU.
 *
 * Tidak ada PyTorch, tidak ada Python, tidak ada ultralytics di server. Model
 * diekspor ke .onnx sekali di mesin pengembang, lalu yang berjalan di produksi
 * hanya satu berkas bobot dan runtime C++ berukuran puluhan megabyte. Di server
 * kecil ini bukan soal kerapian melainkan soal muat: tumpukan PyTorch CPU saja
 * sudah meminta RAM lebih besar daripada seluruh aplikasi ini.
 *
 * Praproses juga sudah dikerjakan ffmpeg — frame tiba dalam keadaan sudah
 * letterbox, RGB, dan tepat seukuran masukan model. Yang tersisa di JavaScript
 * hanya menyusun ulang piksel ke tata letak CHW.
 */

let ort;

/** Dimuat lambat supaya kegagalan pemasangan modul native muncul sebagai pesan yang jelas. */
async function runtime() {
    if (ort) return ort;
    try {
        ort = (await import("onnxruntime-node")).default;
    } catch (error) {
        throw new Error(
            "onnxruntime-node tidak bisa dimuat. Jalankan `npm install` di server " +
                `(modul ini berisi binary native, tidak cukup disalin dari mesin lain). Detail: ${error.message}`
        );
    }
    return ort;
}

async function loadClasses(classesPath) {
    try {
        const raw = await fs.readFile(classesPath, "utf8");
        const parsed = JSON.parse(raw);
        const list = Array.isArray(parsed) ? parsed : parsed.names;
        if (Array.isArray(list) && list.length) return list;
        throw new Error("format tidak dikenali");
    } catch {
        return DEFAULT_CLASSES;
    }
}

export class Detector {
    constructor(session, classes, config, layout) {
        this.session = session;
        this.classes = classes;
        this.roles = buildRoleTable(classes);
        this.config = config;
        this.layout = layout;
        this.inputName = session.inputNames[0];
        this.outputName = session.outputNames[0];
        this.size = config.inputSize;
        // Dipakai ulang tiap frame: mengalokasikan 2,7 MB per inferensi memberi
        // pemulung sampah pekerjaan yang tidak perlu.
        this.input = new Float32Array(3 * this.size * this.size);
    }

    static async load(config) {
        const rt = await runtime();
        const classes = await loadClasses(config.classesPath);
        const summary = describeClasses(classes);

        if (!summary.hasHelmet && !summary.hasVest) {
            throw new Error(
                `Daftar kelas model tidak memuat helm maupun rompi: [${classes.join(", ")}]. ` +
                    "Kemungkinan besar berkas .onnx-nya model umum (COCO), bukan model PPE. " +
                    "Periksa HSE_MODEL_PATH dan models/ppe.classes.json."
            );
        }

        try {
            await fs.access(config.modelPath);
        } catch {
            throw new Error(
                `Bobot model tidak ditemukan di ${config.modelPath}.\n` +
                    "Pasang dengan: npm run hse:model  (jalankan tanpa argumen untuk melihat caranya)"
            );
        }

        const session = await rt.InferenceSession.create(config.modelPath, {
            executionProviders: ["cpu"],
            graphOptimizationLevel: "all",
            // Satu thread, disengaja. Membiarkan ONNX memakai semua inti membuat
            // inferensi tunggal lebih cepat tapi menahan seluruh CPU selama
            // ratusan milidetik — dan yang tersendat adalah Next dan MediaMTX.
            intraOpNumThreads: config.threads,
            interOpNumThreads: 1,
        });

        const detector = new Detector(session, classes, config, null);
        await detector.warmup();
        return detector;
    }

    /**
     * Satu inferensi kosong saat start.
     *
     * ONNX Runtime menunda alokasi arena memorinya sampai pemakaian pertama,
     * sehingga frame sungguhan yang pertama bisa memakan waktu beberapa kali
     * lipat. Membayarnya di muka membuat pengukuran laju di menit pertama tidak
     * menyesatkan rem otomatis.
     */
    async warmup() {
        const blank = Buffer.alloc(this.size * this.size * 3, 114);
        await this.detect(blank);
    }

    /** Susun ulang RGB24 rapat menjadi CHW ternormalisasi. */
    #fill(frame) {
        const size = this.size;
        const plane = size * size;
        const data = this.input;
        for (let i = 0; i < plane; i++) {
            const p = i * 3;
            data[i] = frame[p] / 255;
            data[plane + i] = frame[p + 1] / 255;
            data[plane * 2 + i] = frame[p + 2] / 255;
        }
        return data;
    }

    /**
     * @param {Buffer} frame RGB24 rapat, size x size (sudah letterbox oleh ffmpeg)
     * @returns {Promise<{detections: Array, inferenceMs: number}>}
     */
    async detect(frame) {
        const rt = await runtime();
        const started = process.hrtime.bigint();

        const tensor = new rt.Tensor("float32", this.#fill(frame), [1, 3, this.size, this.size]);
        const output = await this.session.run({ [this.inputName]: tensor });
        const result = output[this.outputName];

        const raw = this.#decode(result);
        const detections = nms(raw, this.config.iouThreshold).map((d) => ({
            ...d,
            role: this.roles[d.classId] ?? "IGNORE",
            className: this.classes[d.classId] ?? String(d.classId),
        }));

        return {
            detections,
            inferenceMs: Number(process.hrtime.bigint() - started) / 1e6,
        };
    }

    /**
     * Baca keluaran mentah menjadi daftar kotak.
     *
     * Tata letaknya diraba dari bentuk tensor, bukan diasumsikan. Ekspor YOLO
     * menghasilkan tiga bentuk yang berbeda tergantung versi dan flag ekspor,
     * dan menebak salah tidak menimbulkan error — ia menghasilkan deteksi yang
     * tampak wajar di posisi yang keliru, yang jauh lebih sulit disadari.
     */
    #decode(tensor) {
        const dims = tensor.dims;
        const data = tensor.data;
        const nc = this.classes.length;
        const conf = this.config.confThreshold;
        const out = [];

        // [1, 300, 6] — model diekspor bersama NMS: x1,y1,x2,y2,score,class.
        if (dims.length === 3 && dims[2] === 6 && 4 + nc !== 6) {
            this.layout ??= "nms";
            for (let i = 0; i < dims[1]; i++) {
                const p = i * 6;
                const score = data[p + 4];
                if (score < conf) continue;
                out.push({
                    box: [data[p], data[p + 1], data[p + 2], data[p + 3]],
                    score,
                    classId: data[p + 5] | 0,
                });
            }
            return out;
        }

        // [1, 4+nc, N] (bawaan YOLOv8/11) atau [1, N, 4+nc] (hasil transpose).
        const channelsFirst = dims[1] === 4 + nc;
        const anchorsFirst = dims[2] === 4 + nc;

        // Kalau tidak satu pun sumbu berukuran 4+nc, daftar kelas dan berkas
        // model berasal dari latihan yang berbeda. Menebak salah satu tata
        // letak tetap akan menghasilkan angka — angka yang seluruhnya sampah,
        // dan tidak ada yang akan menyadarinya sampai laporan sudah dipakai.
        if (!channelsFirst && !anchorsFirst) {
            throw new Error(
                `Bentuk keluaran ${JSON.stringify(dims)} tidak cocok dengan ${nc} kelas ` +
                    `(mengharapkan salah satu sumbu berukuran ${4 + nc}). ` +
                    "Samakan models/ppe.classes.json dengan kelas saat model dilatih."
            );
        }

        const transposed = !channelsFirst;
        const anchors = transposed ? dims[1] : dims[2];
        const stride = transposed ? 4 + nc : 1;
        const channelStride = transposed ? 1 : anchors;
        this.layout ??= transposed ? "anchors-first" : "channels-first";

        const at = (channel, anchor) => data[anchor * stride + channel * channelStride];

        for (let a = 0; a < anchors; a++) {
            let best = -1;
            let bestScore = conf;
            for (let c = 0; c < nc; c++) {
                const score = at(4 + c, a);
                if (score > bestScore) {
                    bestScore = score;
                    best = c;
                }
            }
            if (best < 0) continue;

            // Keluaran YOLO memakai pusat + ukuran; sisa pipeline memakai sudut.
            const cx = at(0, a);
            const cy = at(1, a);
            const w = at(2, a);
            const h = at(3, a);
            out.push({
                box: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2],
                score: bestScore,
                classId: best,
            });
        }

        return out;
    }
}

function iou(a, b) {
    const x1 = Math.max(a[0], b[0]);
    const y1 = Math.max(a[1], b[1]);
    const x2 = Math.min(a[2], b[2]);
    const y2 = Math.min(a[3], b[3]);
    const overlap = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
    if (overlap <= 0) return 0;
    const areaA = (a[2] - a[0]) * (a[3] - a[1]);
    const areaB = (b[2] - b[0]) * (b[3] - b[1]);
    return overlap / (areaA + areaB - overlap);
}

/**
 * Non-maximum suppression per kelas.
 *
 * Per kelas, bukan global: orang dan rompi yang dipakainya nyaris selalu punya
 * IoU tinggi, dan penekanan global akan membuang salah satunya — persis dua
 * kotak yang dibutuhkan tahap asosiasi untuk memutuskan rompi itu dipakai.
 */
function nms(detections, threshold) {
    const byClass = new Map();
    for (const det of detections) {
        const list = byClass.get(det.classId);
        if (list) list.push(det);
        else byClass.set(det.classId, [det]);
    }

    const kept = [];
    for (const list of byClass.values()) {
        list.sort((a, b) => b.score - a.score);
        const survivors = [];
        for (const det of list) {
            if (survivors.some((s) => iou(s.box, det.box) > threshold)) continue;
            survivors.push(det);
            // Frame CCTV yang wajar tidak memuat 50 helm; sisanya pasti derau.
            if (survivors.length >= 50) break;
        }
        kept.push(...survivors);
    }

    return kept;
}
