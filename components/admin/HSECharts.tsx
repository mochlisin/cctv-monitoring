"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, HardHat, Shirt, Eye, EyeOff, WifiOff } from "lucide-react";
import type { HseSummary, HseWorkerHealth } from "@/actions/hse";
import { HSE_COLOR_HEX, complianceRate } from "@/lib/hse";

/**
 * Grafik kepatuhan.
 *
 * Semua grafik di sini satu seri. Bentuk yang paling jelas untuk data ini —
 * batang bertumpuk hijau/merah "patuh vs melanggar" — justru yang paling tidak
 * bisa dipakai: hijau dan merah hanya terpisah ΔE 4,1 di mata deuteranopia,
 * dan sekitar satu dari dua belas laki-laki tidak bisa membedakannya sama
 * sekali. Untuk dasbor keselamatan, kebutaan warna bukan kasus pinggiran.
 *
 * Jadi tiap grafik memikul satu ukuran dengan satu warna, dan yang membedakan
 * makna adalah posisi serta angkanya — bukan hue.
 */

/* Slot warna dari palet yang sudah divalidasi terhadap permukaan putih. */
const SERIES = "#2a78d6";
/** Hari dengan sampel terlalu sedikit. Sengaja abu-abu: ini bukan seri data. */
const MUTED = "#898781";
const CRITICAL = "#d03b3b";
const GOOD = "#0ca30c";

/** Ramp sequential untuk heat strip, 100 → 600. */
const RAMP = ["#e8f1fd", "#cde2fb", "#9ec5f4", "#6da7ec", "#3987e5", "#256abf", "#184f95"];

/**
 * Di bawah jumlah pengamatan ini, persentase kepatuhan tidak berarti apa-apa:
 * satu orang lewat sekali menghasilkan 0% atau 100%. Hari seperti itu tetap
 * digambar, tapi dengan warna netral dan penanda — menyembunyikannya justru
 * membuat grafik tampak lebih rapi daripada kenyataannya.
 */
const MIN_SAMPLES = 20;

function Tile({
    icon: Icon,
    label,
    value,
    sub,
    tone,
}: {
    icon: typeof HardHat;
    label: string;
    value: string;
    sub: string;
    tone?: "good" | "bad";
}) {
    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-center gap-2 mb-3">
                <Icon className="w-4 h-4 text-slate-400" />
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">
                    {label}
                </span>
            </div>
            <div
                className="text-3xl font-bold text-slate-900"
                style={tone === "bad" ? { color: CRITICAL } : tone === "good" ? { color: GOOD } : undefined}
            >
                {value}
            </div>
            <p className="text-xs text-slate-500 mt-1">{sub}</p>
        </div>
    );
}

/**
 * Batang kepatuhan harian.
 *
 * Sumbu-y dikunci 0–100%, bukan diskalakan ke rentang data. Sumbu yang
 * menyesuaikan diri akan membuat selisih 97% dan 99% terlihat seperti jurang,
 * dan itu persis kesan yang tidak boleh diberikan laporan keselamatan.
 */
function DailyChart({
    title,
    icon: Icon,
    data,
}: {
    title: string;
    icon: typeof HardHat;
    data: { day: string; ok: number; missing: number }[];
}) {
    const [hover, setHover] = useState<number | null>(null);

    if (!data.length) {
        return (
            <div className="bg-white rounded-2xl border border-slate-200 p-5">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2 mb-4">
                    <Icon className="w-4 h-4 text-slate-400" />
                    {title}
                </h3>
                <p className="text-xs text-slate-400 py-8 text-center">Belum ada data</p>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-baseline justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <Icon className="w-4 h-4 text-slate-400" />
                    {title}
                </h3>
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    kepatuhan harian
                </span>
            </div>

            <div className="relative h-40 flex items-end gap-1">
                {/* Garis bantu 100% dan 50% — tipis, di belakang batang. */}
                <div className="absolute inset-x-0 top-0 border-t border-dashed border-slate-200" />
                <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-slate-100" />

                {data.map((point, index) => {
                    const total = point.ok + point.missing;
                    const rate = complianceRate(point.ok, point.missing);
                    const thin = total < MIN_SAMPLES;
                    const height = rate === null ? 0 : Math.max(2, rate);

                    return (
                        <div
                            key={point.day}
                            className="relative flex-1 h-full flex items-end min-w-0"
                            onMouseEnter={() => setHover(index)}
                            onMouseLeave={() => setHover(null)}
                        >
                            <div
                                className="w-full rounded-t transition-opacity"
                                style={{
                                    height: `${height}%`,
                                    background: thin ? MUTED : SERIES,
                                    opacity: hover === null || hover === index ? 1 : 0.45,
                                }}
                            />

                            {hover === index && (
                                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-10 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] whitespace-nowrap shadow-lg">
                                    <div className="font-bold tabular-nums">
                                        {rate === null ? "tidak ada data" : `${rate}% patuh`}
                                    </div>
                                    <div className="text-slate-300 tabular-nums">
                                        {point.ok} patuh · {point.missing} melanggar
                                    </div>
                                    <div className="text-slate-400">{point.day}</div>
                                    {thin && total > 0 && (
                                        <div className="text-amber-300 mt-0.5">sampel terlalu sedikit</div>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="flex items-center justify-between mt-2 text-[10px] text-slate-400 tabular-nums">
                <span>{data[0]?.day.slice(5)}</span>
                <span className="flex items-center gap-3">
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm" style={{ background: SERIES }} />
                        cukup sampel
                    </span>
                    <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-sm" style={{ background: MUTED }} />
                        &lt;{MIN_SAMPLES} pengamatan
                    </span>
                </span>
                <span>{data[data.length - 1]?.day.slice(5)}</span>
            </div>
        </div>
    );
}

/**
 * Sebaran jam kejadian.
 *
 * Ini pertanyaan HSE yang paling sering ditanyakan setelah "berapa banyak":
 * kapan pelanggaran menumpuk. Biasanya jawabannya jam-jam pergantian shift dan
 * menjelang istirahat — dan itu memberi tahu kapan pengawasan perlu ditambah,
 * sesuatu yang tidak bisa disimpulkan dari angka total.
 */
function HourlyStrip({ hourly }: { hourly: number[] }) {
    const [hover, setHover] = useState<number | null>(null);
    const max = Math.max(1, ...hourly);

    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <div className="flex items-baseline justify-between mb-4">
                <h3 className="text-sm font-bold text-slate-900">Jam rawan pelanggaran</h3>
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                    jumlah kejadian
                </span>
            </div>

            <div className="flex gap-[3px]">
                {hourly.map((count, hour) => {
                    // Nol tetap digambar sebagai sel, bukan ruang kosong: pola
                    // "sepi jam 2 pagi" adalah informasi, bukan ketiadaan data.
                    const step = count === 0 ? 0 : Math.ceil((count / max) * (RAMP.length - 1));
                    return (
                        <div
                            key={hour}
                            className="relative flex-1 group"
                            onMouseEnter={() => setHover(hour)}
                            onMouseLeave={() => setHover(null)}
                        >
                            <div
                                className="h-9 rounded border border-slate-200/70 cursor-default"
                                style={{ background: RAMP[step] }}
                            />
                            {hover === hour && (
                                <div className="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 z-10 px-2.5 py-1.5 rounded-lg bg-slate-900 text-white text-[11px] whitespace-nowrap shadow-lg tabular-nums">
                                    {String(hour).padStart(2, "0")}:00 — {count} kejadian
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="flex justify-between mt-1.5 text-[10px] text-slate-400 tabular-nums">
                <span>00</span>
                <span>06</span>
                <span>12</span>
                <span>18</span>
                <span>23</span>
            </div>
        </div>
    );
}

/** Peringkat kamera. Diurutkan pelanggaran terbanyak — itu daftar kerja operator. */
function CameraRanking({ perCamera }: { perCamera: HseSummary["perCamera"] }) {
    const worst = Math.max(1, ...perCamera.map((c) => c.helmetMissing + c.vestMissing));

    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-4">Kamera</h3>

            {perCamera.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">
                    Belum ada kamera dengan HSE aktif
                </p>
            ) : (
                <div className="space-y-3">
                    {perCamera.map((camera) => {
                        const missing = camera.helmetMissing + camera.vestMissing;
                        const ok = camera.helmetOk + camera.vestOk;
                        const rate = complianceRate(ok, missing);
                        return (
                            <div key={camera.cctvId}>
                                <div className="flex items-baseline justify-between gap-3 mb-1">
                                    <span className="text-xs font-semibold text-slate-700 truncate">
                                        {camera.name}
                                    </span>
                                    <span className="text-[11px] text-slate-500 tabular-nums shrink-0">
                                        {rate === null ? "tidak ada orang" : `${rate}% patuh`}
                                        {camera.eventCount > 0 && ` · ${camera.eventCount} event`}
                                    </span>
                                </div>
                                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                                    <div
                                        className="h-full rounded-full"
                                        style={{
                                            width: `${Math.max(2, (missing / worst) * 100)}%`,
                                            background: missing > 0 ? CRITICAL : "transparent",
                                        }}
                                    />
                                </div>
                                <p className="text-[10px] text-slate-400 mt-0.5 tabular-nums">
                                    {missing} deteksi tanpa APD
                                </p>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

/**
 * Sebaran warna APD.
 *
 * Satu-satunya tempat di dasbor ini yang warnanya bukan pilihan desain: petak
 * warnanya adalah datanya sendiri. Berguna karena warna helm menandai peran —
 * "sepuluh helm kuning, satu putih" memberi tahu siapa saja yang ada di area
 * itu tanpa menyimpan identitas siapa pun.
 */
function ColorTally({ colors }: { colors: HseSummary["colors"] }) {
    const groups = [
        { key: "helmet" as const, label: "Helm", tally: colors.helmet },
        { key: "vest" as const, label: "Rompi", tally: colors.vest },
    ].filter((g) => g.tally && Object.keys(g.tally).length);

    if (!groups.length) return null;

    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="text-sm font-bold text-slate-900 mb-1">Warna APD terpakai</h3>
            <p className="text-[11px] text-slate-400 mb-4">
                Tidak terbaca saat kamera dalam mode malam (inframerah)
            </p>

            <div className="space-y-4">
                {groups.map((group) => {
                    const entries = Object.entries(group.tally!).sort((a, b) => b[1] - a[1]);
                    const total = entries.reduce((sum, [, count]) => sum + count, 0);
                    return (
                        <div key={group.key}>
                            <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                                {group.label}
                            </p>
                            <div className="flex flex-wrap gap-2">
                                {entries.map(([name, count]) => (
                                    <span
                                        key={name}
                                        className="inline-flex items-center gap-1.5 pl-1.5 pr-2.5 py-1 rounded-full border border-slate-200 bg-slate-50"
                                    >
                                        <span
                                            className="w-3.5 h-3.5 rounded-full border border-slate-300 shrink-0"
                                            style={{ background: HSE_COLOR_HEX[name] ?? "#cbd5e1" }}
                                        />
                                        <span className="text-[11px] font-semibold text-slate-700">
                                            {name}
                                        </span>
                                        <span className="text-[11px] text-slate-400 tabular-nums">
                                            {Math.round((count / total) * 100)}%
                                        </span>
                                    </span>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

/**
 * Status worker.
 *
 * Ditempatkan paling atas dan tidak bisa dilewatkan. Sistem pemantauan
 * keselamatan yang diam-diam berhenti bekerja lebih berbahaya daripada tidak
 * ada sistem sama sekali: layar tetap menunjukkan nol pelanggaran, dan nol itu
 * dibaca sebagai aman.
 */
function WorkerBanner({ health }: { health: HseWorkerHealth }) {
    if (health.ok) {
        // Tiga kegagalan berbeda, dan ketiganya menghasilkan gejala yang sama di
        // layar — nol pelanggaran — jadi ketiganya harus disebut terpisah:
        // tidak ada sinyal sama sekali, mengaku hidup tapi frame-nya basi, dan
        // dinyalakan di database tapi tidak dipantau siapa pun.
        const offline = health.cameras?.filter((c) => !c.online) ?? [];
        const stale = health.cameras?.filter((c) => c.online && c.stale) ?? [];
        const unmonitored = health.unmonitored ?? [];
        const blind = offline.length + stale.length + unmonitored.length;

        return (
            <div
                className="rounded-2xl border bg-white px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2"
                style={blind > 0 ? { borderColor: CRITICAL } : { borderColor: "#e2e8f0" }}
            >
                <span className="inline-flex items-center gap-2 text-xs font-bold" style={{ color: GOOD }}>
                    <CheckCircle2 className="w-4 h-4" />
                    Worker HSE berjalan
                </span>
                <span className="text-[11px] text-slate-500 tabular-nums">
                    {health.cameras?.length ?? 0} kamera · inferensi ~{health.averageInferenceMs} ms ·
                    interval {health.intervalSeconds} dtk
                </span>

                {offline.length > 0 && (
                    <span
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold"
                        style={{ color: CRITICAL }}
                    >
                        <WifiOff className="w-3.5 h-3.5" />
                        Tidak ada sinyal: {offline.map((c) => c.name).join(", ")}
                    </span>
                )}

                {stale.length > 0 && (
                    <span
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold"
                        style={{ color: CRITICAL }}
                    >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Frame berhenti masuk: {stale.map((c) => c.name).join(", ")}
                    </span>
                )}

                {unmonitored.length > 0 && (
                    <span
                        className="inline-flex items-center gap-1.5 text-[11px] font-semibold"
                        style={{ color: CRITICAL }}
                    >
                        <AlertTriangle className="w-3.5 h-3.5" />
                        Dinyalakan tapi tidak dipantau: {unmonitored.map((c) => c.name).join(", ")}
                    </span>
                )}

                {blind > 0 && (
                    <span className="text-[11px] text-slate-600 basis-full">
                        Untuk kamera di atas, <strong>nol pelanggaran tidak berarti aman</strong> —
                        tidak ada yang menganalisisnya.
                    </span>
                )}
            </div>
        );
    }

    return (
        <div
            className="rounded-2xl border px-5 py-4 flex items-start gap-3"
            style={{ borderColor: CRITICAL, background: "#fef2f2" }}
        >
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" style={{ color: CRITICAL }} />
            <div>
                <p className="text-sm font-bold" style={{ color: CRITICAL }}>
                    {health.reason ?? "Worker HSE tidak berjalan"}
                </p>
                <p className="text-xs text-slate-600 mt-0.5">
                    Tidak ada frame yang dianalisis. Angka di bawah ini adalah data lama —
                    nol pelanggaran <strong>bukan</strong> berarti aman. Jalankan{" "}
                    <code className="px-1 py-0.5 rounded bg-white border border-slate-200 text-[11px]">
                        npm run hse
                    </code>{" "}
                    di server.
                </p>
            </div>
        </div>
    );
}

/**
 * Apa yang TIDAK terlihat sistem.
 *
 * Panel ini ada karena alasan keselamatan, bukan kelengkapan. Angka kepatuhan
 * sendirian menyesatkan: "0 pelanggaran" pada kamera yang tidak melihat apa pun
 * tampak identik dengan lokasi yang benar-benar patuh. Yang di bawah ini adalah
 * satu-satunya cara operator bisa membedakannya — dan tiap baris menunjuk ke
 * tindakan yang berbeda, jadi tidak digabung jadi satu angka mutu.
 */
function BlindSpots({
    coverage,
    days,
    helmetRate,
}: {
    coverage: HseSummary["coverage"];
    days: number;
    helmetRate: number | null;
}) {
    const monoShare =
        coverage.monoFrames > 0 && coverage.framesTotal > 0
            ? Math.round((coverage.monoFrames / coverage.framesTotal) * 100)
            : 0;

    const rows = [
        {
            show: coverage.percent !== null && coverage.percent < 100,
            label: "Waktu tidak terpantau",
            value: coverage.percent === null ? "—" : `${Math.round((100 - coverage.percent) * 10) / 10}%`,
            why: `Dari ${days} hari terakhir. Lubang waktu berasal dari kamera mati, worker berhenti, atau interval yang melebar sendiri karena CPU sibuk.`,
        },
        {
            show: coverage.tooSmall > 0,
            label: "Orang terlalu jauh untuk dinilai",
            value: coverage.tooSmall.toLocaleString("id-ID"),
            why: "Terlihat model tapi di bawah ambang ukuran, jadi tidak dihitung patuh maupun melanggar. Angka besar berarti sudut atau resolusi kameranya, bukan modelnya.",
        },
        {
            show: coverage.helmetUnknown > 0 || coverage.vestUnknown > 0,
            label: "APD tidak terbaca",
            value: `${coverage.helmetUnknown.toLocaleString("id-ID")} helm · ${coverage.vestUnknown.toLocaleString("id-ID")} rompi`,
            why: "Tertutup tiang, atau orangnya membelakangi kamera. Tidak dihitung sebagai apa pun — menghitungnya patuh menyembunyikan pelanggaran, menghitungnya pelanggaran membanjiri operator dengan alarm palsu.",
        },
        {
            show: monoShare > 0,
            label: "Frame mode inframerah",
            value: `${monoShare}%`,
            why: "Malam hari. Warna APD tidak dibaca dan deteksi lebih lemah, jadi porsi ini menurunkan keandalan angka di atas.",
        },
    ].filter((row) => row.show);

    if (!rows.length) return null;

    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-5">
            <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <EyeOff className="w-4 h-4 text-slate-400" />
                Yang tidak terlihat sistem
            </h3>

            {coverage.percent !== null && helmetRate !== null && (
                <p className="text-xs text-slate-600 mt-2">
                    Angka kepatuhan di atas berlaku untuk bagian yang terlihat saja:{" "}
                    <strong>
                        {helmetRate}% patuh dari {coverage.percent}% waktu terpantau
                    </strong>
                    . Menyebut keduanya bersama adalah satu-satunya bentuk yang bisa
                    dipertanggungjawabkan.
                </p>
            )}

            <div className="mt-4 divide-y divide-slate-100">
                {rows.map((row) => (
                    <div key={row.label} className="py-3 flex items-baseline gap-4">
                        <span className="text-sm font-bold text-slate-900 tabular-nums shrink-0 min-w-24">
                            {row.value}
                        </span>
                        <div>
                            <p className="text-xs font-semibold text-slate-700">{row.label}</p>
                            <p className="text-[11px] text-slate-500 mt-0.5">{row.why}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default function HSECharts({
    summary,
    health,
    days,
    onDaysChange,
}: {
    summary: HseSummary;
    health: HseWorkerHealth;
    days: number;
    onDaysChange: (days: number) => void;
}) {
    const helmetRate = complianceRate(summary.helmetOk, summary.helmetMissing);
    const vestRate = complianceRate(summary.vestOk, summary.vestMissing);
    const coverage = summary.coverage;

    return (
        <div className="space-y-5">
            <WorkerBanner health={health} />

            {/* Filter rentang — satu baris di atas semua grafik. */}
            <div className="flex items-center gap-2">
                {[
                    { value: 1, label: "24 jam" },
                    { value: 7, label: "7 hari" },
                    { value: 30, label: "30 hari" },
                    { value: 90, label: "90 hari" },
                ].map((option) => (
                    <button
                        key={option.value}
                        onClick={() => onDaysChange(option.value)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                            days === option.value
                                ? "bg-slate-900 text-white"
                                : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
                        }`}
                    >
                        {option.label}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Tile
                    icon={HardHat}
                    label="Kepatuhan helm"
                    value={helmetRate === null ? "—" : `${helmetRate}%`}
                    sub={
                        helmetRate === null
                            ? "belum ada orang terdeteksi"
                            : `${summary.helmetMissing} dari ${summary.helmetOk + summary.helmetMissing} deteksi tanpa helm`
                    }
                    tone={helmetRate === null ? undefined : helmetRate >= 95 ? "good" : "bad"}
                />
                <Tile
                    icon={Shirt}
                    label="Kepatuhan rompi"
                    value={vestRate === null ? "—" : `${vestRate}%`}
                    sub={
                        vestRate === null
                            ? "belum ada orang terdeteksi"
                            : `${summary.vestMissing} dari ${summary.vestOk + summary.vestMissing} deteksi tanpa rompi`
                    }
                    tone={vestRate === null ? undefined : vestRate >= 95 ? "good" : "bad"}
                />
                <Tile
                    icon={AlertTriangle}
                    label="Kejadian"
                    value={String(summary.eventCount)}
                    sub={`${summary.openCount} sedang berlangsung`}
                    tone={summary.openCount > 0 ? "bad" : undefined}
                />
                <Tile
                    icon={Eye}
                    label="Waktu terpantau"
                    value={coverage.percent === null ? "—" : `${coverage.percent}%`}
                    sub={
                        coverage.percent === null
                            ? "belum ada kamera HSE"
                            : `${summary.frames.toLocaleString("id-ID")} frame · ${summary.personCount.toLocaleString("id-ID")} deteksi orang`
                    }
                    // Ambangnya sengaja rendah. Ini bukan nilai mutu, tapi
                    // peringatan: di bawah 80% ada lubang waktu yang cukup besar
                    // untuk menyembunyikan pelanggaran sepenuhnya.
                    tone={coverage.percent === null ? undefined : coverage.percent >= 80 ? "good" : "bad"}
                />
            </div>

            <BlindSpots coverage={coverage} days={days} helmetRate={helmetRate} />

            {/* Dua grafik terpisah, bukan satu grafik dua sumbu: helm dan rompi
                adalah dua ukuran berbeda, dan menumpuknya di satu bidang membuat
                keduanya lebih sulit dibaca, bukan lebih mudah. */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <DailyChart
                    title="Helm"
                    icon={HardHat}
                    data={summary.daily.map((d) => ({
                        day: d.day,
                        ok: d.helmetOk,
                        missing: d.helmetMissing,
                    }))}
                />
                <DailyChart
                    title="Rompi"
                    icon={Shirt}
                    data={summary.daily.map((d) => ({
                        day: d.day,
                        ok: d.vestOk,
                        missing: d.vestMissing,
                    }))}
                />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <HourlyStrip hourly={summary.hourly} />
                <CameraRanking perCamera={summary.perCamera} />
            </div>

            <ColorTally colors={summary.colors} />
        </div>
    );
}
