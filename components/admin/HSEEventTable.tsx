"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, X, ImageOff, ChevronDown } from "lucide-react";
import { reviewHseEvent, type HseEventRow } from "@/actions/hse";
import {
    HSE_COLOR_HEX,
    HSE_STATUS,
    HSE_STATUS_LABEL,
    HSE_STATUS_TONE,
    HSE_VIOLATION_LABEL,
    HSE_VIOLATION_TONE,
    formatHseDuration,
} from "@/lib/hse";

/**
 * Daftar kejadian pelanggaran APD.
 *
 * Snapshot ditampilkan sebagai kolom pertama, bukan sebagai tautan yang harus
 * diklik. Alasannya sederhana: satu-satunya cara operator bisa menilai apakah
 * deteksi ini benar adalah dengan melihat gambarnya, dan meletakkan gambar itu
 * di balik satu klik berarti sebagian besar kejadian tidak akan pernah ditinjau.
 */

function timestamp(date: Date) {
    return new Date(date).toLocaleString("id-ID", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
    });
}

function ColorDots({ colors }: { colors: HseEventRow["colors"] }) {
    const entries = [
        ...Object.entries(colors.helmet ?? {}).map(([name, count]) => ({ name, count, kind: "helm" })),
        ...Object.entries(colors.vest ?? {}).map(([name, count]) => ({ name, count, kind: "rompi" })),
    ];
    if (!entries.length) return <span className="text-slate-300">—</span>;

    return (
        <div className="flex flex-wrap gap-1">
            {entries.map((entry) => (
                <span
                    key={`${entry.kind}-${entry.name}`}
                    title={`${entry.count} ${entry.kind} ${entry.name}`}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-slate-50 border border-slate-200"
                >
                    <span
                        className="w-2.5 h-2.5 rounded-full border border-slate-300"
                        style={{ background: HSE_COLOR_HEX[entry.name] ?? "#cbd5e1" }}
                    />
                    <span className="text-[10px] text-slate-500 tabular-nums">{entry.count}</span>
                </span>
            ))}
        </div>
    );
}

function Snapshot({ path, alt }: { path: string | null; alt: string }) {
    const [failed, setFailed] = useState(false);

    if (!path || failed) {
        return (
            <div className="w-28 h-20 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center shrink-0">
                <ImageOff className="w-4 h-4 text-slate-300" />
            </div>
        );
    }

    return (
        <a
            href={`/hse/snapshot/${path}`}
            target="_blank"
            rel="noreferrer"
            className="block w-28 h-20 rounded-lg overflow-hidden border border-slate-200 shrink-0 hover:ring-2 hover:ring-blue-500 transition"
        >
            {/* Bukan next/image: berkas ini dilayani route handler yang memeriksa
                sesi, dan pengoptimal gambar Next tidak membawa cookie itu. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                src={`/hse/snapshot/${path}`}
                alt={alt}
                className="w-full h-full object-cover"
                onError={() => setFailed(true)}
            />
        </a>
    );
}

function ReviewButtons({ event }: { event: HseEventRow }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [noteOpen, setNoteOpen] = useState(false);
    const [note, setNote] = useState(event.note ?? "");
    const [error, setError] = useState<string | null>(null);

    const submit = (status: string) => {
        setError(null);
        startTransition(async () => {
            try {
                await reviewHseEvent(event.id, status, note);
                setNoteOpen(false);
                router.refresh();
            } catch (err) {
                setError((err as Error).message);
            }
        });
    };

    const reviewed =
        event.status === HSE_STATUS.ACKNOWLEDGED || event.status === HSE_STATUS.FALSE_POSITIVE;

    return (
        <div className="flex flex-col items-end gap-1.5">
            {!reviewed && (
                <div className="flex items-center gap-1.5">
                    <button
                        onClick={() => submit(HSE_STATUS.ACKNOWLEDGED)}
                        disabled={pending}
                        title="Benar, sudah ditindaklanjuti"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-700 text-[11px] font-semibold hover:bg-emerald-100 disabled:opacity-50"
                    >
                        <Check className="w-3.5 h-3.5" />
                        Ditindak
                    </button>
                    <button
                        onClick={() => submit(HSE_STATUS.FALSE_POSITIVE)}
                        disabled={pending}
                        title="Salah deteksi — dikeluarkan dari statistik kepatuhan"
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 text-[11px] font-semibold hover:bg-slate-50 disabled:opacity-50"
                    >
                        <X className="w-3.5 h-3.5" />
                        Salah deteksi
                    </button>
                </div>
            )}

            <button
                onClick={() => setNoteOpen((open) => !open)}
                className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-400 hover:text-slate-600"
            >
                <ChevronDown className={`w-3 h-3 transition-transform ${noteOpen ? "rotate-180" : ""}`} />
                Catatan
            </button>

            {noteOpen && (
                <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Tindakan yang diambil, atau alasan ini salah deteksi"
                    rows={2}
                    className="w-56 text-[11px] rounded-lg border border-slate-200 px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
            )}

            {error && <span className="text-[10px] text-red-600 max-w-[220px] text-right">{error}</span>}
        </div>
    );
}

export default function HSEEventTable({ rows }: { rows: HseEventRow[] }) {
    if (!rows.length) {
        return (
            <div className="bg-white rounded-2xl border border-slate-200 p-10 text-center">
                <p className="text-sm font-semibold text-slate-500">Belum ada kejadian tercatat</p>
                <p className="text-xs text-slate-400 mt-1">
                    Kalau worker berjalan dan ada kamera aktif, kosong berarti tidak ada pelanggaran
                    yang bertahan cukup lama untuk dicatat.
                </p>
            </div>
        );
    }

    return (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="divide-y divide-slate-100">
                {rows.map((event) => (
                    <div key={event.id} className="p-4 flex gap-4 items-start hover:bg-slate-50/50">
                        <Snapshot
                            path={event.snapshot}
                            alt={`Pelanggaran di ${event.cctvName} pada ${timestamp(event.startedAt)}`}
                        />

                        <div className="flex-1 min-w-0">
                            <div className="flex flex-wrap items-center gap-2 mb-1.5">
                                <span
                                    className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${
                                        HSE_VIOLATION_TONE[event.type] ?? "bg-slate-100 text-slate-700 border-slate-200"
                                    }`}
                                >
                                    {HSE_VIOLATION_LABEL[event.type] ?? event.type}
                                </span>
                                <span
                                    className={`px-2 py-0.5 rounded-full border text-[10px] font-bold uppercase tracking-wide ${
                                        HSE_STATUS_TONE[event.status] ?? "bg-slate-100 text-slate-700 border-slate-200"
                                    }`}
                                >
                                    {HSE_STATUS_LABEL[event.status] ?? event.status}
                                </span>
                                <span className="text-xs font-semibold text-slate-700 truncate">
                                    {event.cctvName}
                                </span>
                            </div>

                            <p className="text-[11px] text-slate-500 tabular-nums">
                                {timestamp(event.startedAt)} · {formatHseDuration(event.duration)} ·{" "}
                                {event.violatorCount} dari {event.personCount} orang melanggar ·
                                keyakinan {Math.round(event.maxConfidence * 100)}%
                            </p>

                            <div className="mt-2">
                                <ColorDots colors={event.colors} />
                            </div>

                            {event.note && (
                                <p className="mt-2 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2 py-1.5">
                                    {event.note}
                                </p>
                            )}
                        </div>

                        <ReviewButtons event={event} />
                    </div>
                ))}
            </div>
        </div>
    );
}
