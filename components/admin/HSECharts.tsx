"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, HardHat, Shirt, Activity, WifiOff } from "lucide-react";
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
        const offline = health.cameras?.filter((c) => !c.online) ?? [];
        return (
            <div className="rounded-2xl border border-slate-200 bg-white px-5 py-3 flex flex-wrap items-center gap-x-6 gap-y-2">
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
                    icon={Activity}
                    label="Frame dianalisis"
                    value={summary.frames.toLocaleString("id-ID")}
                    sub={`${summary.personCount.toLocaleString("id-ID")} deteksi orang`}
                />
            </div>

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
