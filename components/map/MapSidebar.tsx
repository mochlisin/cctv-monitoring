"use client";

import { useMemo, useState } from "react";
import { Search, MapPin } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type CCTV = {
  id: number;
  name: string;
  isActive: boolean;
  kota?: string | null;
  kecamatan?: string | null;
  [key: string]: any;
};

interface MapSidebarProps {
  cctvs: CCTV[];
  onSelect: (cctv: CCTV) => void;
  selectedId?: number | null;
}

export default function MapSidebar({ cctvs, onSelect, selectedId }: MapSidebarProps) {
  const [searchQuery, setSearchQuery] = useState("");

  const filteredCctvs = useMemo(() => {
    if (!searchQuery) return cctvs;
    const lowerQuery = searchQuery.toLowerCase();
    return cctvs.filter(
      (c) =>
        c.name.toLowerCase().includes(lowerQuery) ||
        (c.kota && c.kota.toLowerCase().includes(lowerQuery)) ||
        (c.kecamatan && c.kecamatan.toLowerCase().includes(lowerQuery))
    );
  }, [cctvs, searchQuery]);

  // Group by City -> Group by District? Or just flat list as per "Peta Lokasi" list request?
  // The request says "Peta Lokasi list... Each item should have a location icon, title (Camera Name), and address."
  // A flat list seems cleaner for the sidebar if there are many items, but grouping is also nice.
  // Let's stick to a flat list first as it's easier to search and scan quickly in a sidebar.

  return (
    <div className="w-full h-full min-h-0 bg-white flex flex-col md:border-r md:border-slate-200">
      {/* Header & Search */}
      <div className="p-4 border-b border-slate-100 space-y-3 sm:space-y-4 shrink-0">
        <div className="flex items-end justify-between gap-2">
           <div className="min-w-0">
             <h2 className="text-base sm:text-lg font-bold text-slate-900">Peta Lokasi</h2>
             <p className="text-xs text-slate-500">Cari dan pilih lokasi CCTV</p>
           </div>
           <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-1 rounded-full shrink-0">
             {filteredCctvs.length}/{cctvs.length}
           </span>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input
            placeholder="Cari jalan atau nama..."
            value={searchQuery}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
            /* text-base di ponsel: mencegah Safari iOS auto-zoom saat input difokus */
            className="pl-9 h-11 md:h-10 text-base md:text-sm bg-slate-50 border-slate-200 focus-visible:ring-blue-600"
          />
        </div>
      </div>

      {/* List */}
      <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
        <div className="p-2 space-y-1 safe-pb">
          {filteredCctvs.length === 0 ? (
             <div className="p-8 text-center text-slate-400 text-sm">
                 Tidak ada lokasi ditemukan.
             </div>
          ) : (
            filteredCctvs.map((cctv) => (
                <button
                key={cctv.id}
                onClick={() => onSelect(cctv)}
                className={cn(
                    "w-full flex items-start gap-3 p-3 rounded-xl text-left transition-all",
                    selectedId === cctv.id
                    ? "bg-blue-50 border-blue-200 shadow-sm"
                    : "hover:bg-slate-50 border border-transparent"
                )}
                >
                <div
                    className={cn(
                    "w-9 h-9 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5",
                    selectedId === cctv.id ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-400"
                    )}
                >
                    <MapPin size={16} />
                </div>
                <div className="min-w-0 flex-1">
                    <h3
                    className={cn(
                        "font-bold text-sm line-clamp-1",
                        selectedId === cctv.id ? "text-blue-700" : "text-slate-900"
                    )}
                    >
                    {cctv.name}
                    </h3>
                    <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">
                    {cctv.kecamatan || "Umum"}, {cctv.kota || "Lainnya"}
                    </p>
                    {cctv.isActive && (
                        <div className="flex items-center gap-2 mt-2">
                            <span className="flex items-center gap-1 text-[10px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded border border-green-100">
                                <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></span>
                                LIVE
                            </span>
                        </div>
                    )}
                </div>
                </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
