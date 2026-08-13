/**
 * Kosakata bersama HSE monitoring.
 *
 * File ini sengaja tidak berisi logika deteksi. Pembagian tugasnya tegas:
 * worker (`hse/`) adalah satu-satunya yang menafsirkan piksel dan menulis
 * kesimpulan ke database; aplikasi Next hanya membaca hasilnya. Jadi yang perlu
 * dibagi hanya nama-nama — jenis pelanggaran, status, dan warna — supaya string
 * yang sama tidak diketik ulang di dua tempat dan diam-diam berbeda.
 */

/* ---------------------------------------------------------------- pelanggaran */

export const HSE_VIOLATION = {
    NO_HELMET: "NO_HELMET",
    NO_VEST: "NO_VEST",
    NO_HELMET_NO_VEST: "NO_HELMET_NO_VEST",
} as const;

export type HseViolation = (typeof HSE_VIOLATION)[keyof typeof HSE_VIOLATION];

export const HSE_VIOLATION_LABEL: Record<string, string> = {
    NO_HELMET: "Tanpa helm",
    NO_VEST: "Tanpa rompi",
    NO_HELMET_NO_VEST: "Tanpa helm & rompi",
};

/** Kelas Tailwind untuk badge jenis pelanggaran. */
export const HSE_VIOLATION_TONE: Record<string, string> = {
    NO_HELMET: "bg-amber-100 text-amber-800 border-amber-200",
    NO_VEST: "bg-orange-100 text-orange-800 border-orange-200",
    NO_HELMET_NO_VEST: "bg-red-100 text-red-800 border-red-200",
};

/* ---------------------------------------------------------------- status event */

export const HSE_STATUS = {
    /** Masih berlangsung — worker terakhir kali masih melihat pelanggarannya. */
    OPEN: "OPEN",
    /** Sudah berhenti terlihat, menunggu ditinjau operator. */
    CLOSED: "CLOSED",
    /** Operator membenarkan dan menindaklanjuti. */
    ACKNOWLEDGED: "ACKNOWLEDGED",
    /** Operator menyatakan salah deteksi. Dikeluarkan dari statistik kepatuhan. */
    FALSE_POSITIVE: "FALSE_POSITIVE",
} as const;

export type HseStatus = (typeof HSE_STATUS)[keyof typeof HSE_STATUS];

export const HSE_STATUS_LABEL: Record<string, string> = {
    OPEN: "Berlangsung",
    CLOSED: "Selesai",
    ACKNOWLEDGED: "Ditindaklanjuti",
    FALSE_POSITIVE: "Salah deteksi",
};

export const HSE_STATUS_TONE: Record<string, string> = {
    OPEN: "bg-red-100 text-red-800 border-red-200",
    CLOSED: "bg-slate-100 text-slate-700 border-slate-200",
    ACKNOWLEDGED: "bg-emerald-100 text-emerald-800 border-emerald-200",
    FALSE_POSITIVE: "bg-slate-100 text-slate-500 border-slate-200 line-through",
};

/**
 * Status yang dihitung dalam statistik kepatuhan.
 *
 * FALSE_POSITIVE dikecualikan dengan sengaja: kalau salah deteksi ikut dihitung,
 * angka kepatuhan menghukum lokasi yang pencahayaannya buruk, bukan yang
 * pekerjanya lalai — dan operator kehilangan insentif untuk mengoreksi.
 */
export const HSE_COUNTED_STATUSES: string[] = [
    HSE_STATUS.OPEN,
    HSE_STATUS.CLOSED,
    HSE_STATUS.ACKNOWLEDGED,
];

/* ---------------------------------------------------------------- warna APD */

/**
 * Ember warna yang dikenali worker. Nama helm biasanya menandai peran di
 * lapangan, jadi warnanya dicatat — tapi pemetaan peran sengaja tidak
 * di-hardcode karena tiap perusahaan punya aturan sendiri.
 */
export const HSE_COLOR_HEX: Record<string, string> = {
    putih: "#f8fafc",
    kuning: "#facc15",
    oranye: "#fb923c",
    merah: "#ef4444",
    hijau: "#22c55e",
    biru: "#3b82f6",
    coklat: "#a16207",
    "abu-abu": "#94a3b8",
    hitam: "#1e293b",
};

export type HseColorTally = Record<string, number>;

/** Bentuk kolom `colors` pada HseEvent dan HseBucket. */
export type HseColors = {
    helmet?: HseColorTally;
    vest?: HseColorTally;
};

/** Baca kolom Json Prisma menjadi HseColors tanpa mempercayai isinya. */
export function parseHseColors(value: unknown): HseColors {
    if (!value || typeof value !== "object") return {};
    const raw = value as Record<string, unknown>;
    const pick = (key: string): HseColorTally | undefined => {
        const entry = raw[key];
        if (!entry || typeof entry !== "object") return undefined;
        const out: HseColorTally = {};
        for (const [color, count] of Object.entries(entry as Record<string, unknown>)) {
            if (typeof count === "number" && count > 0) out[color] = count;
        }
        return Object.keys(out).length ? out : undefined;
    };
    return { helmet: pick("helmet"), vest: pick("vest") };
}

/* ---------------------------------------------------------------- data live */

/** Satu orang pada frame terakhir yang dianalisis. */
export type HsePerson = {
    /** [x, y, w, h] ternormalisasi 0..1 terhadap frame asli kamera. */
    box: [number, number, number, number];
    /** true = terdeteksi dipakai, false = terdeteksi tidak dipakai, null = tak terbaca. */
    helmet: boolean | null;
    vest: boolean | null;
    helmetColor: string | null;
    vestColor: string | null;
    confidence: number;
    /** Melanggar aturan kamera ini (memperhitungkan hseRequireHelm/Vest). */
    violating: boolean;
};

/** Payload yang dikirim worker ke overlay lewat SSE. */
export type HseLiveFrame = {
    slug: string;
    /** Epoch ms saat frame dianalisis. */
    at: number;
    persons: HsePerson[];
    personCount: number;
    violatorCount: number;
    /** Milidetik yang dihabiskan inferensi — dipakai badge diagnostik. */
    inferenceMs: number;
};

/* ---------------------------------------------------------------- format */

export function formatHseDuration(seconds: number): string {
    if (seconds < 60) return `${seconds} dtk`;
    const minutes = Math.floor(seconds / 60);
    const rest = seconds % 60;
    if (minutes < 60) return rest ? `${minutes} mnt ${rest} dtk` : `${minutes} mnt`;
    const hours = Math.floor(minutes / 60);
    return `${hours} jam ${minutes % 60} mnt`;
}

/**
 * Tingkat kepatuhan dalam persen, atau null kalau tidak ada orang terdeteksi.
 *
 * null penting dibedakan dari 100: kamera yang tidak pernah melihat orang bukan
 * kamera dengan kepatuhan sempurna, dan menampilkannya sebagai 100% membuat
 * rata-rata seluruh lokasi terlihat lebih baik dari kenyataan.
 */
export function complianceRate(ok: number, missing: number): number | null {
    const total = ok + missing;
    if (total === 0) return null;
    return Math.round((ok / total) * 1000) / 10;
}
