import path from "path";

/**
 * Muat .env sendiri.
 *
 * Next memuat .env secara otomatis; skrip Node biasa tidak. Worker ini
 * dijalankan langsung (`node hse/index.mjs`) oleh PM2 dan Supervisor aaPanel,
 * jadi tanpa baris ini ia akan start dengan DATABASE_URL kosong dan gagal
 * dengan pesan tentang koneksi database — jauh dari penyebab sebenarnya.
 *
 * Memakai loadEnvFile bawaan Node, bukan paket dotenv: tidak menambah
 * dependensi, dan variabel yang sudah ada di environment tetap menang
 * (systemd EnvironmentFile, env PM2, atau export di shell tidak tertimpa).
 */
try {
    process.loadEnvFile?.(path.join(process.cwd(), ".env"));
} catch {
    // Tidak ada .env itu sah — semua nilai punya bawaan, dan di systemd
    // environment-nya memang diisi lewat EnvironmentFile.
}

/**
 * Semua tombol yang menentukan berapa besar worker ini membebani server.
 *
 * Nilai bawaannya dipilih untuk server kecil (2 vCPU / 2 GB) yang juga
 * menjalankan Next, MySQL, dan MediaMTX — bukan untuk kecepatan maksimum.
 * Prinsipnya: pemantauan APD tidak butuh frame rate, ia butuh keandalan.
 * Orang tidak melepas helm dalam 60 milidetik, jadi satu frame tiap beberapa
 * detik sudah cukup untuk menangkap pelanggaran yang berlangsung puluhan detik.
 */

const num = (key, fallback) => {
    const raw = process.env[key];
    if (raw === undefined || raw === "") return fallback;
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
};

const bool = (key, fallback) => {
    const raw = process.env[key];
    if (raw === undefined || raw === "") return fallback;
    return raw === "true" || raw === "1" || raw === "yes";
};

const root = process.cwd();

export const config = {
    /* ---------------------------------------------------------- sumber video */

    /**
     * Frame diambil dari RTSP lokal MediaMTX, bukan langsung dari kamera —
     * alasan yang sama dengan endpoint thumbnail: kredensial kamera tidak
     * pernah muncul di argumen proses ffmpeg, dan koneksi ke kamera tetap satu
     * walaupun thumbnail, penonton, dan worker HSE menariknya bersamaan.
     */
    rtspOrigin: process.env.MEDIA_RTSP_ORIGIN ?? "rtsp://127.0.0.1:8554",

    /**
     * Hanya mendekode keyframe. Ini penghematan CPU terbesar di seluruh worker:
     * ffmpeg melewatkan seluruh P-frame, sehingga biaya dekode turun sekitar
     * sepersepuluh. Konsekuensinya laju frame maksimum terikat pada interval
     * I-frame kamera — README sudah menganjurkan I-frame interval = fps, jadi
     * praktisnya ~1 frame/detik. Matikan hanya kalau kamera ber-GOP panjang.
     */
    keyframesOnly: bool("HSE_DECODE_KEYFRAMES_ONLY", true),

    /* ---------------------------------------------------------- laju analisis */

    /** Detik antar inferensi untuk kamera yang tidak sedang ditonton. */
    intervalSeconds: num("HSE_INTERVAL_SECONDS", 5),
    /**
     * Saat ada yang membuka halaman kamera, overlay perlu kotak yang bergerak.
     * Kamera itu dinaikkan sementara ke laju ini — meniru pola sourceOnDemand
     * MediaMTX: beban tambahan hanya muncul selama benar-benar dilihat.
     */
    boostIntervalSeconds: num("HSE_BOOST_INTERVAL_SECONDS", 1),
    /** Boost padam sendiri kalau overlay berhenti memperbarui langganannya. */
    boostTtlSeconds: num("HSE_BOOST_TTL_SECONDS", 30),

    /**
     * Batas keras jumlah kamera HSE. Bukan formalitas: melewati batas ini di
     * server kecil membuat antrean inferensi tidak pernah habis, dan gejalanya
     * di layar adalah "deteksi telat 2 menit", bukan pesan error. Lebih baik
     * menolak di admin dengan alasan jelas.
     */
    maxCameras: num("HSE_MAX_CAMERAS", 3),

    /**
     * Rem otomatis. Kalau rata-rata inferensi melewati ambang ini, interval
     * digandakan sampai batas maksimum — worker mengalah pada beban server
     * alih-alih ikut menyeretnya turun.
     */
    slowInferenceMs: num("HSE_SLOW_INFERENCE_MS", 1500),
    maxIntervalSeconds: num("HSE_MAX_INTERVAL_SECONDS", 30),

    /* ---------------------------------------------------------- model */

    modelPath: process.env.HSE_MODEL_PATH ?? path.join(root, "models", "ppe.onnx"),
    classesPath: process.env.HSE_CLASSES_PATH ?? path.join(root, "models", "ppe.classes.json"),
    /**
     * Sisi masukan model. Harus kelipatan 32.
     *
     * INI BUKAN TOMBOL AKURASI, dan mengubahnya sendiri tidak akan bekerja:
     * ekspor YOLO menghasilkan graf berukuran TETAP, jadi menaikkan angka ini
     * tanpa mengekspor ulang model pada imgsz yang sama membuat ONNX Runtime
     * menolak masukan saat worker start. Lihat scripts/fetch-hse-model.mjs.
     *
     * Angka ini juga BATAS ATAS seluruh sistem, dan itu punya akibat yang
     * berlawanan dengan dugaan: karena setiap frame diperkecil ke 480 sebelum
     * masuk model, menaikkan resolusi kamera di atas itu tidak menambah satu
     * piksel pun pada orangnya — hanya menambah bandwidth dan beban dekode.
     *
     * Pada server 2 core / 2 GB, menaikkannya ke 640 justru MENURUNKAN
     * keselamatan: inferensi ~75% lebih lambat, adapt() melebarkan intervalnya
     * sendiri, dan cakupan waktu (kolom coveredSeconds) turun — lebih banyak
     * detik yang tidak terlihat siapa pun. Yang benar-benar menaikkan piksel di
     * badan orang tanpa biaya inferensi adalah membuat orangnya lebih besar di
     * dalam frame: penempatan/zoom kamera, atau crop area kerja. Lihat README.
     */
    inputSize: num("HSE_INPUT_SIZE", 480),
    /** Jumlah thread ONNX Runtime. 1 disengaja: sisakan CPU untuk Next & MySQL. */
    threads: num("HSE_THREADS", 1),
    confThreshold: num("HSE_CONF_THRESHOLD", 0.35),
    iouThreshold: num("HSE_IOU_THRESHOLD", 0.45),

    /**
     * Orang yang terlalu kecil di frame diabaikan. Pada tinggi di bawah ~12%
     * frame, kotak helm hanya beberapa piksel — model menebak, dan tebakannya
     * masuk statistik sebagai fakta. Lebih jujur tidak menghitungnya.
     */
    minPersonHeight: num("HSE_MIN_PERSON_HEIGHT", 0.12),

    /* ---------------------------------------------------------- event & data */

    /**
     * Detik bersih sebelum sebuah event ditutup. Menahan event agar tidak
     * pecah menjadi puluhan baris saat orang yang sama sesekali tertutup tiang
     * atau membelakangi kamera.
     */
    eventGapSeconds: num("HSE_EVENT_GAP_SECONDS", 20),
    /** Lebar selang agregat kepatuhan. */
    bucketMinutes: num("HSE_BUCKET_MINUTES", 15),

    snapshotDir: process.env.HSE_SNAPSHOT_DIR ?? path.join(root, ".hse", "snapshots"),
    /** Jarak minimum antar snapshot per kamera, supaya disk tidak dibanjiri. */
    snapshotMinIntervalSeconds: num("HSE_SNAPSHOT_MIN_INTERVAL_SECONDS", 60),

    /** Event, bucket, dan snapshot yang lebih tua dari ini dihapus tiap hari. */
    retentionDays: num("HSE_RETENTION_DAYS", 30),

    /* ---------------------------------------------------------- kontrol */

    /**
     * API lokal worker. Sama seperti MediaMTX, hanya 127.0.0.1 — browser tidak
     * pernah menyentuhnya, semua akses lewat route handler Next.
     */
    host: process.env.HSE_HOST ?? "127.0.0.1",
    port: num("HSE_PORT", 9998),

    /** Selang worker memuat ulang daftar kamera dari database. */
    reloadSeconds: num("HSE_RELOAD_SECONDS", 30),
    ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
    ffprobePath: process.env.FFPROBE_PATH ?? "ffprobe",
};

export const STREAM_PATH_PREFIX = "cctv_";
export const streamPathFor = (slug) => `${STREAM_PATH_PREFIX}${slug}`;
