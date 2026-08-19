"use client";

import { useSearchParams } from "next/navigation";
import  {Suspense, useCallback, useState} from "react";
import CCTVPlayer from "@/components/CCTVPlayer";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

function MultiViewContent() {
    const searchParams = useSearchParams();
    // Berisi slug kamera (UUID), bukan ID numerik.
    const slugs = searchParams.get("ids")?.split(",").filter(Boolean) || [];
    const ids = slugs;

    // Halaman ini hanya menerima slug dari query string dan tidak pernah query DB,
    // jadi rasio tiap tile datang dari pemutarnya sendiri saat metadata stream
    // sampai. Sebelum itu 16:9 — bentuk mayoritas kamera.
    const [aspects, setAspects] = useState<Record<string, string>>({});
    const recordAspect = useCallback((slug: string, aspect: string) => {
        setAspects((prev) => (prev[slug] === aspect ? prev : { ...prev, [slug]: aspect }));
    }, []);

    return (
        <div className="min-h-screen bg-slate-950 text-white">
            {/* Header */}
            <div className="h-16 border-b border-slate-800 flex items-center justify-between px-6 bg-slate-950/80 backdrop-blur-md sticky top-0 z-50">
                <div className="flex items-center gap-4">
                    <Link href="/">
                        <Button variant="ghost" size="icon" className="hover:bg-slate-800 hover:text-white">
                            <ArrowLeft />
                        </Button>
                    </Link>
                    <h1 className="font-bold text-lg">Multi-View Monitor</h1>
                </div>
                <div className="text-xs font-mono text-slate-400">
                    {ids.length} Screen(s) Active
                </div>
            </div>

            {/* Grid */}
            {/* Di layar kecil selalu 1 kolom: tile 4 kolom di HP tidak terbaca
                dan memaksa decoding video sebanyak jumlah tile sekaligus. */}
            {/* items-start: satu tile portrait setinggi dua kali tidak boleh
                meregangkan tile landscape di barisnya. */}
            <div className={`p-2 sm:p-4 grid gap-2 sm:gap-4 h-[calc(100dvh-64px)] overflow-y-auto auto-rows-min items-start
                ${ids.length === 1 ? 'grid-cols-1' : ''}
                ${ids.length === 2 ? 'grid-cols-1 md:grid-cols-2' : ''}
                ${ids.length >= 3 && ids.length <= 4 ? 'grid-cols-1 sm:grid-cols-2' : ''}
                ${ids.length > 4 && ids.length <= 9 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3' : ''}
                ${ids.length > 9 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4' : ''}
            `}>
                {ids.map((slug, index) => (
                    <div key={slug} className="relative bg-black rounded-xl overflow-hidden border border-slate-800 group">
                        <div className="relative" style={{ aspectRatio: aspects[slug] ?? "16/9" }}>
                            <CCTVPlayer
                                streamName={slug}
                                onAspect={(aspect) => recordAspect(slug, aspect)}
                            />
                        </div>
                        <div className="absolute top-2 right-2 bg-black/60 backdrop-blur px-2 py-1 rounded text-xs font-mono font-bold z-40 pointer-events-none">
                            CAM {index + 1}
                        </div>
                    </div>
                ))}
                
                {ids.length === 0 && (
                    <div className="col-span-full flex flex-col items-center justify-center text-slate-500 h-full">
                         <p>No camera selected</p>
                         <Link href="/">
                            <Button variant="link" className="text-blue-400">Back to Home</Button>
                         </Link>
                    </div>
                )}
            </div>
        </div>
    );
}

export default function MultiViewPage() {
    return (
        <Suspense fallback={<div className="min-h-screen bg-slate-950 flex items-center justify-center text-white">Loading...</div>}>
            <MultiViewContent />
        </Suspense>
    );
}
