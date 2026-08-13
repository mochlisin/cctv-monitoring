import { Suspense } from "react";
import {
    getHseCameras,
    getHseEvents,
    getHseSummary,
    getHseWorkerHealth,
} from "@/actions/hse";
import HSEDashboard from "@/components/admin/HSEDashboard";

export const dynamic = "force-dynamic";

const MAX_CAMERAS = Number(process.env.HSE_MAX_CAMERAS ?? 3);

export default async function HsePage({
    searchParams,
}: {
    searchParams: Promise<{ days?: string }>;
}) {
    const { days: daysParam } = await searchParams;
    const days = Math.min(90, Math.max(1, Number(daysParam) || 7));

    // Empat query yang saling bebas; menjalankannya berurutan hanya menambah
    // waktu muat tanpa alasan.
    const [summary, health, events, cameras] = await Promise.all([
        getHseSummary(days),
        getHseWorkerHealth(),
        getHseEvents({ days, take: 100 }),
        getHseCameras(),
    ]);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold text-gray-900">HSE Monitoring</h1>
                <p className="text-gray-600">
                    Deteksi pemakaian helm dan rompi keselamatan dari kamera yang dipantau.
                </p>
            </div>

            {/* useSearchParams di dalam dasbor membutuhkan batas Suspense. */}
            <Suspense fallback={<div className="h-64 rounded-2xl bg-slate-100 animate-pulse" />}>
                <HSEDashboard
                    summary={summary}
                    health={health}
                    events={events.rows}
                    cameras={cameras}
                    maxCameras={MAX_CAMERAS}
                    days={days}
                />
            </Suspense>
        </div>
    );
}
