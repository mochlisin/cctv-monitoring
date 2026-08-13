"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import HSECharts from "@/components/admin/HSECharts";
import HSEEventTable from "@/components/admin/HSEEventTable";
import HSECameraSettings from "@/components/admin/HSECameraSettings";
import type { HseEventRow, HseSummary, HseWorkerHealth } from "@/actions/hse";

type Camera = Parameters<typeof HSECameraSettings>[0]["cameras"][number];

/**
 * Perekat dasbor HSE.
 *
 * Rentang waktu dan tab disimpan di URL, bukan di state komponen. Efeknya:
 * halaman tetap server-rendered — datanya diambil ulang oleh server saat
 * rentangnya berubah, bukan ditarik ulang oleh browser — dan tautan ke tampilan
 * tertentu bisa dikirim ke orang lain apa adanya.
 */
export default function HSEDashboard({
    summary,
    health,
    events,
    cameras,
    maxCameras,
    days,
}: {
    summary: HseSummary;
    health: HseWorkerHealth;
    events: HseEventRow[];
    cameras: Camera[];
    maxCameras: number;
    days: number;
}) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [tab, setTab] = useState<"ringkasan" | "kejadian" | "kamera">("ringkasan");

    const setDays = (value: number) => {
        const params = new URLSearchParams(searchParams.toString());
        params.set("days", String(value));
        router.push(`/admin/hse?${params.toString()}`);
    };

    const openCount = events.filter((e) => e.status === "OPEN").length;

    const tabs = [
        { id: "ringkasan" as const, label: "Ringkasan" },
        { id: "kejadian" as const, label: "Kejadian", badge: openCount },
        { id: "kamera" as const, label: "Kamera" },
    ];

    return (
        <div className="space-y-5">
            <div className="flex items-center gap-1 border-b border-slate-200">
                {tabs.map((item) => (
                    <button
                        key={item.id}
                        onClick={() => setTab(item.id)}
                        className={`relative px-4 py-2.5 text-sm font-semibold transition-colors ${
                            tab === item.id
                                ? "text-blue-600 border-b-2 border-blue-600 -mb-px"
                                : "text-slate-500 hover:text-slate-800"
                        }`}
                    >
                        {item.label}
                        {item.badge ? (
                            <span className="ml-2 px-1.5 py-0.5 rounded-full bg-red-500 text-white text-[10px] font-bold tabular-nums">
                                {item.badge}
                            </span>
                        ) : null}
                    </button>
                ))}
            </div>

            {tab === "ringkasan" && (
                <HSECharts summary={summary} health={health} days={days} onDaysChange={setDays} />
            )}

            {tab === "kejadian" && <HSEEventTable rows={events} />}

            {tab === "kamera" && (
                <HSECameraSettings cameras={cameras} maxCameras={maxCameras} />
            )}
        </div>
    );
}
