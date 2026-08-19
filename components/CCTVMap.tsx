"use client";

import { useEffect, useState, useRef } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMap, useMapEvents } from "react-leaflet";
import { frameAspect, frameRatio, type CctvBounds } from "@/lib/cctv";
import "leaflet/dist/leaflet.css";
import L from "leaflet";
import Link from "next/link";
import { Camera, Maximize2 } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import CCTVPlayer from "@/components/CCTVPlayer"; // Ensure this import path is correct

// Use DivIcon for custom marker styling with Tailwind classes
const createCustomIcon = (isActive: boolean) => {
    const iconHtml = renderToStaticMarkup(
        <div className={`w-10 h-10 rounded-full border-2 border-white shadow-lg flex items-center justify-center transition-transform ${isActive ? 'bg-blue-600' : 'bg-slate-500'}`}>
            <Camera size={20} className="text-white" />
            {isActive && (
                <span className="absolute -top-1 -right-1 flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-green-500"></span>
                </span>
            )}
        </div>
    );

    return L.divIcon({
        html: iconHtml,
        className: "", // Remove default class to avoid conflicts
        iconSize: [40, 40],
        iconAnchor: [20, 40], // Center bottom anchor
        popupAnchor: [0, -40], // Popup above the icon
    });
};

type CCTV = {
    id: number;
    name: string;
    isActive: boolean;
    isPublic?: boolean;
    /** Slug UUID: dipakai sebagai nama path stream, bukan ID numerik. */
    slug: string;
    group?: { name: string; slug: string } | null;
    latitude?: number | null;
    longitude?: number | null;
    kecamatan?: string | null;
    kota?: string | null;
    frameWidth?: number | null;
    frameHeight?: number | null;
    [key: string]: any;
};

function MapController({ selectedId, data }: { selectedId?: number | null, data: CCTV[] }) {
    const map = useMap();
    
    useEffect(() => {
        if (selectedId) {
            const target = data.find(c => c.id === selectedId);
            if (target && target.latitude && target.longitude) {
                map.flyTo([Number(target.latitude), Number(target.longitude)], 16, {
                    animate: true,
                    duration: 1.5
                });
            }
        }
    }, [selectedId, data, map]);

    return null;
}

function getCoordinates(cctv: CCTV, index: number): [number, number] {
    if (cctv.latitude && cctv.longitude) {
        return [Number(cctv.latitude), Number(cctv.longitude)];
    }
    // Fallback Mock: Center of Jakarta approx -6.2088, 106.8456
    const baseLat = -6.2088;
    const baseLng = 106.8456;
    const offset = 0.01;
    return [
        baseLat + (Math.random() - 0.5) * offset * (index + 1), 
        baseLng + (Math.random() - 0.5) * offset * (index + 1)
    ];
}

interface CCTVMapProps {
    data: CCTV[];
    onPlay?: (id: number) => void;
    selectedId?: number | null;
    onMarkerClick?: (id: number) => void;
    /**
     * Dipasang hanya kalau jumlah kamera melewati MAP_BOUNDS_THRESHOLD. Di
     * bawah ambang itu semua penanda sudah ada di klien, jadi memanggil server
     * setiap kali peta digeser hanya menambah beban tanpa manfaat.
     */
    onBoundsChange?: (bounds: CctvBounds) => void;
}

/** Laporkan viewport peta ke pemanggil, dengan jeda agar pan tidak membanjiri server. */
function BoundsWatcher({ onChange }: { onChange: (bounds: CctvBounds) => void }) {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const report = (map: L.Map) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            const bounds = map.getBounds();
            onChange({
                north: bounds.getNorth(),
                south: bounds.getSouth(),
                east: bounds.getEast(),
                west: bounds.getWest(),
            });
        }, 400);
    };

    const map = useMapEvents({
        moveend: () => report(map),
        zoomend: () => report(map),
    });

    useEffect(() => () => {
        if (timerRef.current) clearTimeout(timerRef.current);
    }, []);

    return null;
}

export default function CCTVMap({ data, onPlay, selectedId, onMarkerClick, onBoundsChange }: CCTVMapProps) {
    // Calculate center based on average of points if available, else default
    const validCoords = data.filter(c => c.latitude && c.longitude);
    const center: [number, number] = validCoords.length > 0
        ? [validCoords.reduce((acc, c) => acc + (c.latitude || 0), 0) / validCoords.length, validCoords.reduce((acc, c) => acc + (c.longitude || 0), 0) / validCoords.length]
        : [-6.2088, 106.8456];

    // Ref to track if we should open popup programmatically
    const markerRefs = useRef<Record<number, L.Marker | null>>({});

    useEffect(() => {
        if (selectedId && markerRefs.current[selectedId]) {
            markerRefs.current[selectedId]?.openPopup();
        }
    }, [selectedId]);

    return (
        <div className="w-full h-full z-0 relative bg-slate-100">
             <MapContainer center={center} zoom={13} scrollWheelZoom={true} className="w-full h-full z-0 outline-none">
                <TileLayer
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                />
                
                <MapController selectedId={selectedId} data={data} />
                {onBoundsChange && <BoundsWatcher onChange={onBoundsChange} />}

                {data.map((cctv, idx) => {
                    const position = getCoordinates(cctv, idx);
                    return (
                        <Marker 
                            key={cctv.id} 
                            position={position} 
                            icon={createCustomIcon(cctv.isActive)}
                            ref={(ref) => {
                                if (ref) markerRefs.current[cctv.id] = ref;
                            }}
                            eventHandlers={{
                                click: () => onMarkerClick && onMarkerClick(cctv.id)
                            }}
                        >
                            <Popup className="custom-popup" minWidth={300} maxWidth={300}>
                                <div className="p-0 overflow-hidden rounded-xl">
                                    {/* Video Preview Section.
                                        Popup peta lebarnya terkunci 300px, jadi
                                        kamera portrait dibatasi lewat tinggi
                                        (maxWidth diturunkan dari 13rem) supaya
                                        popup-nya tidak menjulang menutupi peta. */}
                                    <div
                                        className="relative bg-black mx-auto"
                                        style={{
                                            aspectRatio: frameAspect(cctv),
                                            width: "100%",
                                            maxWidth: `calc(13rem * ${frameRatio(cctv)})`,
                                        }}
                                    >
                                        {cctv.isActive ? (
                                            <CCTVPlayer streamName={cctv.slug} />
                                        ) : (
                                            <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 bg-slate-100">
                                                <Camera size={32} className="mb-2 opacity-50" />
                                                <span className="text-xs font-bold uppercase">Offline</span>
                                            </div>
                                        )}
                                        
                                        {cctv.isActive && (
                                            <div className="absolute top-2 right-2 flex items-center gap-1 bg-red-600/90 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-0.5 rounded-full z-10">
                                                <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span>
                                                LIVE
                                            </div>
                                        )}
                                    </div>

                                    {/* Content Section */}
                                    <div className="p-4 bg-white">
                                        <h3 className="font-bold text-slate-900 text-lg mb-1">{cctv.name}</h3>
                                        <p className="text-xs text-slate-500 mb-4 flex items-center gap-1">
                                            <span className="w-1.5 h-1.5 rounded-full bg-blue-500"></span>
                                            {cctv.kecamatan}, {cctv.kota}
                                        </p>
                                        
                                        {cctv.isActive ? (
                                            <Link href={`/multiview?ids=${cctv.slug}`}>
                                                <button 
                                                    className="w-full py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-lg transition-colors flex items-center justify-center gap-2 shadow-lg shadow-blue-200"
                                                >
                                                    <Maximize2 size={14} />
                                                    LIHAT LAYAR PENUH
                                                </button>
                                            </Link>
                                        ) : (
                                            <button 
                                                disabled
                                                className="w-full py-2.5 bg-slate-100 text-slate-400 text-xs font-bold rounded-lg cursor-not-allowed flex items-center justify-center gap-2"
                                            >
                                                <Camera size={14} />
                                                KAMERA OFFLINE
                                            </button>
                                        )}
                                    </div>
                                </div>
                            </Popup>
                        </Marker>
                    );
                })}
            </MapContainer>
            
            <style jsx global>{`
                .leaflet-popup-content-wrapper {
                    padding: 0;
                    border-radius: 12px;
                    overflow: hidden;
                    box-shadow: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
                }
                .leaflet-popup-content {
                    margin: 0;
                    width: 300px !important;
                }
                .leaflet-popup-tip-container {
                    margin-top: -2px;
                }
            `}</style>
        </div>
    );
}

