"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { HardHat, Shirt, AlertTriangle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { setHseSettings } from "@/actions/hse";

type Camera = {
    id: number;
    name: string;
    slug: string;
    isActive: boolean;
    hseEnabled: boolean;
    hseRequireHelm: boolean;
    hseRequireVest: boolean;
    hseMinDuration: number;
};

/**
 * Pemilihan kamera yang dipantau.
 *
 * Dua hal yang sengaja dinyatakan terang-terangan di UI ini, karena keduanya
 * berkonsekuensi nyata dan tidak akan pernah dibaca dari dokumentasi:
 *
 * 1. Menyalakan HSE membuat kamera ditarik terus-menerus, bukan lagi hanya saat
 *    ditonton. Itu beban tetap ke kamera, jaringan, dan CPU server.
 * 2. Ada batas jumlah kamera. Melewatinya tidak akan memunculkan error apa pun
 *    di layar — yang terjadi adalah deteksi diam-diam tertinggal beberapa menit.
 */
export default function HSECameraSettings({
    cameras,
    maxCameras,
}: {
    cameras: Camera[];
    maxCameras: number;
}) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<number | null>(null);

    const enabledCount = cameras.filter((c) => c.hseEnabled && c.isActive).length;

    const update = (camera: Camera, patch: Partial<Camera>) => {
        setError(null);
        setBusyId(camera.id);
        startTransition(async () => {
            try {
                await setHseSettings(camera.id, {
                    hseEnabled: patch.hseEnabled ?? camera.hseEnabled,
                    hseRequireHelm: patch.hseRequireHelm ?? camera.hseRequireHelm,
                    hseRequireVest: patch.hseRequireVest ?? camera.hseRequireVest,
                    hseMinDuration: patch.hseMinDuration ?? camera.hseMinDuration,
                });
                router.refresh();
            } catch (err) {
                setError((err as Error).message);
            } finally {
                setBusyId(null);
            }
        });
    };

    return (
        <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
                <div className="flex items-baseline justify-between gap-3">
                    <h3 className="text-sm font-bold text-slate-900">Kamera yang dipantau</h3>
                    <span className="text-[11px] font-semibold text-slate-500 tabular-nums">
                        {enabledCount} / {maxCameras} terpakai
                    </span>
                </div>
                <p className="text-[11px] text-slate-500 mt-1.5 leading-relaxed">
                    Kamera dengan HSE aktif ditarik RTSP-nya <strong>terus-menerus</strong>, tidak
                    lagi hanya saat ada yang menonton — itu konsekuensi yang tidak bisa dihindari
                    dari pemantauan keselamatan. Batasnya ada karena setiap kamera tambahan memakai
                    CPU yang sama dengan yang melayani streaming.
                </p>
            </div>

            {error && (
                <div className="px-5 py-3 bg-red-50 border-b border-red-100 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <p className="text-xs text-red-700">{error}</p>
                </div>
            )}

            <div className="divide-y divide-slate-100">
                {cameras.map((camera) => {
                    const busy = pending && busyId === camera.id;
                    return (
                        <div key={camera.id} className="px-5 py-4">
                            <div className="flex items-center justify-between gap-4">
                                <div className="min-w-0">
                                    <p className="text-sm font-semibold text-slate-800 truncate">
                                        {camera.name}
                                    </p>
                                    {!camera.isActive && (
                                        <p className="text-[11px] text-amber-600 font-medium">
                                            Kamera nonaktif — tidak akan dianalisis walau HSE menyala
                                        </p>
                                    )}
                                </div>

                                <Switch
                                    checked={camera.hseEnabled}
                                    disabled={busy}
                                    onCheckedChange={(checked) =>
                                        update(camera, { hseEnabled: checked })
                                    }
                                />
                            </div>

                            {camera.hseEnabled && (
                                <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-x-6 gap-y-3">
                                    <label className="inline-flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={camera.hseRequireHelm}
                                            disabled={busy}
                                            onChange={(e) =>
                                                update(camera, { hseRequireHelm: e.target.checked })
                                            }
                                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        <HardHat className="w-4 h-4 text-slate-400" />
                                        <span className="text-xs font-medium text-slate-700">
                                            Wajib helm
                                        </span>
                                    </label>

                                    <label className="inline-flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={camera.hseRequireVest}
                                            disabled={busy}
                                            onChange={(e) =>
                                                update(camera, { hseRequireVest: e.target.checked })
                                            }
                                            className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                                        />
                                        <Shirt className="w-4 h-4 text-slate-400" />
                                        <span className="text-xs font-medium text-slate-700">
                                            Wajib rompi
                                        </span>
                                    </label>

                                    <label className="inline-flex items-center gap-2">
                                        <span className="text-xs font-medium text-slate-700">
                                            Catat setelah
                                        </span>
                                        <select
                                            value={camera.hseMinDuration}
                                            disabled={busy}
                                            onChange={(e) =>
                                                update(camera, {
                                                    hseMinDuration: Number(e.target.value),
                                                })
                                            }
                                            className="text-xs rounded-lg border border-slate-200 px-2 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                        >
                                            {[5, 10, 20, 30, 60].map((seconds) => (
                                                <option key={seconds} value={seconds}>
                                                    {seconds} detik
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {cameras.length > 0 && (
                <p className="px-5 py-3 bg-slate-50 border-t border-slate-100 text-[11px] text-slate-500 leading-relaxed">
                    <strong>Catat setelah</strong> adalah lama pelanggaran harus bertahan sebelum
                    tercatat sebagai kejadian. Ini penyaring alarm palsu yang paling efektif: orang
                    yang lewat sekilas di tepi frame tidak pernah menjadi laporan. Menurunkannya di
                    bawah 5 detik tidak ada gunanya — worker sendiri hanya menganalisis satu frame
                    tiap beberapa detik.
                </p>
            )}
        </div>
    );
}
