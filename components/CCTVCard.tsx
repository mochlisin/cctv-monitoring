"use client";

import { useState } from "react";
import Link from "next/link";
import CCTVPlayer from "./CCTVPlayer";
import { Camera } from "lucide-react";

export default function CCTVCard({
  title,
  streamName,
  slug,
  groupSlug,
  groupName,
  isPublic,
  isActive = true,
  selectionMode = false,
  isSelected = false,
  onToggleSelect,
  isPlaying = false,
  onPlay,
}: {
  title: string;
  streamName: string;
  slug?: string | null;
  groupSlug?: string | null;
  groupName?: string | null;
  isPublic?: boolean;
  isActive?: boolean;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelect?: () => void;
  isPlaying?: boolean;
  onPlay?: () => void;
}) {
  // Permintaan thumbnail pertama harus menunggu MediaMTX menyalakan koneksi
  // RTSP (sourceOnDemand), jadi kegagalan sesaat itu wajar. Coba lagi beberapa
  // kali sebelum menyerah ke placeholder.
  const [thumbnailAttempt, setThumbnailAttempt] = useState(0);
  const [thumbnailFailed, setThumbnailFailed] = useState(false);

  const handleThumbnailError = () => {
      if (thumbnailAttempt >= 2) {
          setThumbnailFailed(true);
          return;
      }
      const nextAttempt = thumbnailAttempt + 1;
      setTimeout(() => setThumbnailAttempt(nextAttempt), 2000 * nextAttempt);
  };

  const href = (!selectionMode && slug)
    ? groupSlug 
      ? `/group/${groupSlug}/${slug}`
      : `/cctv/${slug}` 
    : undefined;

  const handleCardClick = (e: React.MouseEvent) => {
      if (selectionMode && onToggleSelect) {
          onToggleSelect();
          return;
      }
      if (!selectionMode && isActive && onPlay) {
          onPlay();
      }
  };

  return (
    <div 
        onClick={selectionMode && onToggleSelect ? onToggleSelect : undefined}
        className={`group relative bg-white border rounded-3xl overflow-hidden transition-all duration-300 shadow-sm ${
            isSelected 
                ? 'ring-4 ring-blue-500 border-blue-500 scale-[1.02]' 
                : isActive 
                    ? 'border-slate-200 hover:border-blue-300 hover:scale-[1.02] hover:shadow-xl'
                    : 'border-slate-100 opacity-80'
        } ${selectionMode || isActive ? 'cursor-pointer' : 'cursor-not-allowed'}`}
    >
      {/* Header Overlay */}
      <div className="absolute top-0 left-0 right-0 z-10 p-5 bg-gradient-to-b from-white/95 to-transparent opacity-100 transition-opacity pointer-events-none">
        <div className="flex items-center justify-between">
             {/* Selection Checkbox */}
             {selectionMode && (
                 <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors pointer-events-auto ${isSelected ? 'bg-blue-500 border-blue-500' : 'bg-white border-slate-300'}`}>
                    {isSelected && <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" /></svg>}
                 </div>
             )}
        </div>
      </div>

      {/* Video Container */}
      <div 
        className="aspect-video bg-slate-900 relative cursor-pointer"
        onClick={handleCardClick}
      >
        {isActive ? (
            streamName ? (
            isPlaying ? (
                <CCTVPlayer streamName={streamName} />
            ) : (
                // Thumbnail / Placeholder State
                <div className="w-full h-full relative group/thumbnail">
                    <div className="absolute inset-0 bg-slate-800 flex items-center justify-center">
                            {slug && !thumbnailFailed ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                    key={thumbnailAttempt}
                                    src={thumbnailAttempt ? `/thumbnail/${slug}?r=${thumbnailAttempt}` : `/thumbnail/${slug}`}
                                    alt={`Pratinjau ${title}`}
                                    loading="lazy"
                                    decoding="async"
                                    className="w-full h-full object-cover"
                                    onError={handleThumbnailError}
                                />
                            ) : (
                                <Camera className="w-12 h-12 text-slate-700" />
                            )}
                    </div>

                    {/* Play Overlay */}
                    <div className="absolute inset-0 flex items-center justify-center bg-black/20 group-hover/thumbnail:bg-black/40 transition-colors">
                        <div className="w-16 h-16 rounded-full bg-white/20 backdrop-blur-sm border border-white/40 flex items-center justify-center shadow-2xl transition-transform transform group-hover/thumbnail:scale-110">
                                <svg className="w-8 h-8 text-white ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                        </div>
                    </div>
                </div>
            )
            ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-2 bg-slate-50">
                <div className="w-10 h-10 rounded-full border-2 border-slate-200 flex items-center justify-center bg-white">
                    <svg className="w-5 h-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"></path></svg>
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Offline</span>
            </div>
            )
        ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 gap-2 bg-slate-100">
                <div className="w-12 h-12 rounded-full bg-slate-200 flex items-center justify-center mb-2">
                    <Camera className="w-6 h-6 text-slate-400" />
                </div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500">Kamera Nonaktif</span>
            </div>
        )}
      </div>

      {/* Info Container */}
      <div className="p-4 bg-white">
        <div className="flex items-center justify-between gap-2">
          {!selectionMode && href ? (
              <Link href={href} className="block min-w-0 flex-1">
                  <h4 className="text-sm font-bold text-slate-900 line-clamp-1 group-hover:text-blue-600 transition-colors">
                  {title}
                  </h4>
              </Link>
          ) : (
              <h4 className="text-sm font-bold text-slate-900 line-clamp-1 group-hover:text-blue-600 transition-colors min-w-0 flex-1">
              {title}
              </h4>
          )}
          {isPublic !== undefined && (
            isPublic ? (
              <span className="shrink-0 text-[10px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
                Publik
              </span>
            ) : (
              <span className="shrink-0 text-[10px] font-bold text-indigo-600 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded-full">
                {groupName || "Grup"}
              </span>
            )
          )}
        </div>
      </div>
      
      {/* Bottom info strip */}
      <div className="h-1 bg-gradient-to-r from-blue-500 to-cyan-400 opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
    </div>
  );
}
