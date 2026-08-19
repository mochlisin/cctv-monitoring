"use client";

import { useState, useEffect } from "react";
import dynamic from "next/dynamic";
import CCTVCard from "@/components/CCTVCard";
import { getPublicCctvsInBounds, type PublicCctv } from "@/actions/cctv";
import { MAP_BOUNDS_THRESHOLD, type CctvBounds } from "@/lib/cctv";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Map, List, Grid, MonitorPlay, X, LayoutList } from "lucide-react";
import MapSidebar from "@/components/map/MapSidebar";
import { LogoMark, LogoTile } from "@/components/brand/Logo";
import { cn } from "@/lib/utils";
import {
    Sheet, 
    SheetContent, 
    SheetHeader, 
    SheetTitle, 
} from "@/components/ui/sheet";

// Dynamic imports
const CCTVMap = dynamic(() => import("@/components/CCTVMap"), {
  ssr: false,
  loading: () => <div className="w-full h-full bg-slate-100 animate-pulse flex items-center justify-center text-slate-400">Loading Map...</div>
});
const BottomNav = dynamic(() => import("@/components/BottomNav"), { ssr: false });

type Cctv = PublicCctv;

export default function HomeClient({ cctvs, total = 0 }: { cctvs: Cctv[]; total?: number }) {
  // Di bawah ambang, semua penanda sudah ada di klien dan peta cukup memfilter
  // sendiri. Di atas ambang, peta meminta hanya kamera di dalam viewport.
  const useBoundsFetching = total > MAP_BOUNDS_THRESHOLD;
  const [mapCctvs, setMapCctvs] = useState<Cctv[]>(cctvs);

  const handleBoundsChange = async (bounds: CctvBounds) => {
      try {
          setMapCctvs(await getPublicCctvsInBounds(bounds));
      } catch (error) {
          console.error("Gagal memuat kamera pada area ini:", error);
      }
  };

  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  
  // Map Selection State
  const [selectedMapCctvId, setSelectedMapCctvId] = useState<number | null>(null);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  // Single-Player Logic
  const [activeStreamId, setActiveStreamId] = useState<number | null>(null);

  // Grouping Logic for List View
  const groupedCctvs = cctvs.reduce((acc, cctv) => {
    const kota = cctv.kota || "Lainnya";
    const kecamatan = cctv.kecamatan || "Umum";

    if (!acc[kota]) acc[kota] = {};
    if (!acc[kota][kecamatan]) acc[kota][kecamatan] = [];

    acc[kota][kecamatan].push(cctv);
    return acc;
  }, {} as Record<string, Record<string, Cctv[]>>);

  // Multiview memakai slug, bukan ID numerik — path stream sekarang berbasis slug.
  const selectedSlugs = selectedIds
      .map((id) => cctvs.find((c) => c.id === id)?.slug)
      .filter((slug): slug is string => Boolean(slug));

  const handleToggleSelect = (id: number) => {
    setSelectedIds(prev => 
        prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleSelectionMode = () => {
    if (selectionMode) {
        setSelectionMode(false);
        setSelectedIds([]);
    } else {
        setSelectionMode(true);
        setActiveStreamId(null); // Stop exclusive playback when entering selection mode
    }
  };

  const handlePlayLoop = (id: number) => {
      // Logic: If already playing, do nothing? Or seek?
      // Requirement: "Click new -> Stop old".
      setActiveStreamId(id);
  };

  // Sync View Mode from URL
  const searchParams = useSearchParams();
  useEffect(() => {
      const view = searchParams.get('view');
      if (view === 'map') setViewMode('map');
      if (view === 'list') setViewMode('list');
  }, [searchParams]);

  // Handler for Sidebar Selection
  const handleSidebarSelect = (cctv: any) => {
      setSelectedMapCctvId(cctv.id);
      setIsMobileSidebarOpen(false);
      // We rely on CCTVMap to react to this prop change and flyTo the location
  };

  const handleMapMarkerClick = (id: number) => {
      setSelectedMapCctvId(id);
  };

  return (
    <main
      className={cn(
        "bg-slate-50 text-slate-900 selection:bg-blue-100 flex flex-col",
        // Mode peta dikunci setinggi viewport (dvh ikut menyusut saat toolbar
        // browser ponsel muncul) supaya peta tidak ikut men-scroll halaman.
        // Mode daftar tetap tumbuh sesuai isi.
        viewMode === "map" ? "h-dvh overflow-hidden" : "min-h-dvh"
      )}
    >
      {/* Modern Sticky Header */}
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur-xl supports-[backdrop-filter]:bg-white/60 shrink-0">
        <div className="max-w-[1920px] mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
                 <LogoTile className="w-9 h-9 shadow-lg shadow-blue-200" />
                 <div className="min-w-0">
                    <h1 className="text-base sm:text-lg font-bold tracking-tight text-slate-900 truncate">MINS CCTV</h1>
                    <p className="text-[10px] font-bold text-blue-600 uppercase tracking-widest truncate">CCTV Masyarakat</p>
                 </div>
            </div>

            {/* View Controls - Tablet & Desktop */}
            <div className="hidden md:flex items-center gap-2 shrink-0">
                 <div className="bg-slate-100 p-1 rounded-lg flex items-center">
                    <button 
                        onClick={() => setViewMode("list")}
                        className={`p-2 rounded-md transition-all ${viewMode === "list" ? "bg-white shadow-sm text-blue-600" : "text-slate-500 hover:text-slate-900"}`}
                        title="List View"
                    >
                        <List size={18} />
                    </button>
                    <button 
                        onClick={() => setViewMode("map")}
                        className={`p-2 rounded-md transition-all ${viewMode === "map" ? "bg-white shadow-sm text-blue-600" : "text-slate-500 hover:text-slate-900"}`}
                        title="Map View"
                    >
                        <Map size={18} />
                    </button>
                 </div>

                 {viewMode === 'list' && (
                     <Button 
                        onClick={toggleSelectionMode}
                        variant={selectionMode ? "destructive" : "outline"}
                        size="sm"
                        className="gap-2"
                     >
                        {selectionMode ? (
                            <>
                                <X size={16} />
                                Cancel Selection
                            </>
                        ) : (
                            <>
                                <Grid size={16} />
                                Multi-View
                            </>
                        )}
                     </Button>
                 )}
            </div>

            {/* Mobile Selection Toggle */}
             <div className="flex md:hidden">
                 {viewMode === 'list' && (
                     <Button 
                        onClick={toggleSelectionMode}
                        variant={selectionMode ? "destructive" : "ghost"}
                        size="icon"
                     >
                        {selectionMode ? <X size={20} /> : <Grid size={20} />}
                     </Button>
                 )}
            </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex min-h-0 overflow-hidden">

        {/* Map View Layout */}
        {viewMode === "map" && (
             <div className="w-full h-full flex min-h-0 animate-in fade-in duration-300">
                {/* Sidebar: tampil sejak tablet; di ponsel diganti bottom sheet */}
                <aside className="w-70 lg:w-82.5 xl:w-95 shrink-0 h-full hidden md:block z-20 shadow-xl">
                    <MapSidebar
                        cctvs={cctvs}
                        onSelect={handleSidebarSelect}
                        selectedId={selectedMapCctvId}
                    />
                </aside>
                {/* Map Container */}
                <div className="flex-1 min-w-0 relative bg-slate-100">
                     <CCTVMap
                        data={useBoundsFetching ? mapCctvs : cctvs}
                        selectedId={selectedMapCctvId}
                        onMarkerClick={handleMapMarkerClick}
                        onBoundsChange={useBoundsFetching ? handleBoundsChange : undefined}
                     />
                     {/* Ponsel: daftar lokasi lewat bottom sheet. Posisi tombol
                         dihitung agar duduk di atas BottomNav + home indicator. */}
                     <div
                        className="absolute left-1/2 -translate-x-1/2 z-20 md:hidden"
                        style={{ bottom: "calc(6.5rem + env(safe-area-inset-bottom))" }}
                     >
                        <Sheet open={isMobileSidebarOpen} onOpenChange={setIsMobileSidebarOpen}>
                            <button
                                onClick={() => setIsMobileSidebarOpen(true)}
                                className="bg-blue-600/90 text-white backdrop-blur-md px-5 py-3 rounded-full shadow-2xl border border-blue-400/20 active:scale-95 transition-all flex items-center gap-2 ring-4 ring-blue-600/10"
                            >
                                <LayoutList size={20} />
                                <span className="text-sm font-bold tracking-tight whitespace-nowrap">Daftar Lokasi</span>
                            </button>
                            <SheetContent side="bottom" className="p-0 h-[85dvh] max-h-[85dvh] rounded-t-3xl border-t-0 bg-transparent flex flex-col">
                                <SheetHeader className="sr-only">
                                    <SheetTitle>Daftar Lokasi CCTV</SheetTitle>
                                </SheetHeader>
                                <div className="w-12 h-1.5 bg-slate-300 rounded-full mx-auto my-3 shrink-0" />
                                <div className="flex-1 min-h-0 bg-white rounded-t-3xl overflow-hidden">
                                    <MapSidebar
                                        cctvs={cctvs}
                                        onSelect={handleSidebarSelect}
                                        selectedId={selectedMapCctvId}
                                    />
                                </div>
                            </SheetContent>
                        </Sheet>
                     </div>
                </div>
             </div>
        )}

        {/* List View Layout */}
        {viewMode === "list" && (
            <div className="flex-1 overflow-y-auto"> {/* Scrollable Container for List */}
                <section className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-16 pb-20">
                    <div className="animate-in fade-in slide-in-from-bottom-8 duration-500">
                        {Object.entries(groupedCctvs).map(([kota, kecamatans]) => (
                        <div key={kota} className="relative mb-10 sm:mb-16 last:mb-0">
                            {/* Kota Header */}
                            <div className="flex items-center gap-3 sm:gap-4 mb-6 sm:mb-8">
                                <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-950 truncate">{kota}</h2>
                                <div className="h-1 flex-1 bg-gradient-to-r from-blue-100 to-transparent rounded-full"></div>
                            </div>

                            <div className="space-y-8 sm:space-y-12 sm:pl-2">
                            {Object.entries(kecamatans).map(([kecamatan, locationCctvs]) => (
                                <div key={kecamatan} className="group/kecamatan">
                                {/* Kecamatan Sub-header */}
                                <div className="flex items-center gap-2 sm:gap-3 mb-4 sm:mb-5">
                                        <div className="w-2 h-2 rounded-full bg-blue-600 shrink-0"></div>
                                        <h3 className="text-base sm:text-lg font-bold text-slate-800 group-hover/kecamatan:text-blue-600 transition-colors truncate">
                                            {kecamatan}
                                        </h3>
                                        <span className="text-[10px] font-bold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-100 shrink-0">
                                            {locationCctvs.length} UNIT
                                        </span>
                                </div>

                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-5 sm:gap-8">
                                    {locationCctvs.map((cctv) => (
                                     <div id={`cctv-card-${cctv.id}`} key={cctv.id}>
                                        <CCTVCard
                                            title={cctv.name || `CCTV ${cctv.id}`}
                                            streamName={cctv.slug}
                                            slug={cctv.slug}
                                            groupSlug={cctv.group?.slug}
                                            isActive={cctv.isActive}
                                            
                                            selectionMode={selectionMode}
                                            isSelected={selectedIds.includes(cctv.id)}
                                            onToggleSelect={() => handleToggleSelect(cctv.id)}
                                            
                                            isPlaying={activeStreamId === cctv.id}
                                            onPlay={() => handlePlayLoop(cctv.id)}
                                        />
                                     </div>
                                    ))}
                                </div>
                                </div>
                            ))}
                            </div>
                        </div>
                        ))}
                    </div>

                    {cctvs.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-24 text-slate-400 bg-white rounded-3xl border-2 border-dashed border-slate-200">
                            <LogoMark className="w-12 h-12 mb-4 opacity-20" />
                            <p className="font-medium">Belum ada kamera CCTV aktif.</p>
                        </div>
                    )}
                </section>
                
                 {/* Footer - Only in List Mode or scrolled bottom */}
                 <footer className="border-t border-slate-200 py-12 mt-auto bg-white pb-28 md:pb-12">
                     <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col items-center gap-6 text-sm text-slate-500">
                         <div className="flex items-center gap-2">
                             <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center">
                                 {/* Mengisi penuh kotaknya: jarak tepi sudah ada di dalam viewBox glyph. */}
                                 <LogoMark className="w-8 h-8 text-slate-400" />
                             </div>
                             <span className="font-bold text-slate-900">MINS CCTV</span>
                         </div>
                         <p className="text-center max-w-2xl">© 2026 MINS. Tayangan CCTV ini bersifat publik untuk keamanan bersama. Pantau lingkungan kita untuk masa depan yang lebih aman.</p>
                     </div>
                 </footer>
            </div>
        )}
        
      </div>

      {/* Floating Action Bar for Selection */}
      {selectionMode && selectedIds.length > 0 && (
          <div className="fixed bottom-24 md:bottom-8 left-1/2 -translate-x-1/2 z-[60] animate-in slide-in-from-bottom-10 fade-in duration-300">
              <div className="bg-slate-900 text-white p-2 rounded-full shadow-2xl flex items-center gap-4 pl-6 pr-2 border border-slate-700/50">
                  <span className="font-bold text-sm">{selectedIds.length} Selected</span>
                  <Link href={`/multiview?ids=${selectedSlugs.join(",")}`}>
                    <Button size="sm" className="rounded-full bg-blue-600 hover:bg-blue-500 font-bold">
                        <MonitorPlay className="w-4 h-4 mr-2" />
                        Watch Live View
                    </Button>
                  </Link>
              </div>
          </div>
      )}

      {/* Mobile Bottom Nav */}
      <BottomNav />
    </main>
  );
}

