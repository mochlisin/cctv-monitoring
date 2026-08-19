"use client";

import { useState, useEffect } from "react";
import { MapContainer, TileLayer, Marker, Popup, useMapEvents, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Search, Loader2 } from "lucide-react";
import { searchLocation, type GeocodeResult } from "@/actions/geocode";
import { DEFAULT_MAP_CENTER, DEFAULT_MAP_ZOOM } from "@/lib/mapDefaults";

// Fix icons
const iconUrl = "https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon.png";
const iconRetinaUrl = "https://unpkg.com/leaflet@1.9.3/dist/images/marker-icon-2x.png";
const shadowUrl = "https://unpkg.com/leaflet@1.9.3/dist/images/marker-shadow.png";

const customIcon = new L.Icon({
    iconUrl: iconUrl,
    iconRetinaUrl: iconRetinaUrl,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowUrl: shadowUrl,
    shadowSize: [41, 41],
});

interface LocationPickerProps {
    latitude?: number | null;
    longitude?: number | null;
    onLocationSelect: (lat: number, lng: number) => void;
}

// Component to handle map clicks
function MapEvents({ onLocationSelect }: { onLocationSelect: (lat: number, lng: number) => void }) {
    useMapEvents({
        click(e) {
            onLocationSelect(e.latlng.lat, e.latlng.lng);
        },
    });
    return null;
}

// Component to fly to location
function FlyToLocation({ lat, lng }: { lat: number; lng: number }) {
    const map = useMap();
    useEffect(() => {
        if (lat && lng) {
            map.flyTo([lat, lng], 16, { duration: 1.5 });
        }
    }, [lat, lng, map]);
    return null;
}

export default function LocationPicker({ latitude, longitude, onLocationSelect }: LocationPickerProps) {
    const [searchQuery, setSearchQuery] = useState("");
    const [isSearching, setIsSearching] = useState(false);
    const [searchResults, setSearchResults] = useState<GeocodeResult[]>([]);
    const [showResults, setShowResults] = useState(false);
    
    // Default Center (Kota Baru Driyorejo) or Current Selection
    const defaultCenter: [number, number] = latitude && longitude
        ? [latitude, longitude]
        : DEFAULT_MAP_CENTER;

    const handleSearch = async (e?: React.FormEvent | React.KeyboardEvent | React.MouseEvent) => {
        if (e) e.preventDefault();
        if (!searchQuery.trim()) return;

        setIsSearching(true);
        try {
            const results = await searchLocation(searchQuery);
            setSearchResults(results);
            setShowResults(true);
        } catch (error) {
            console.error("Search failed:", error);
        } finally {
            setIsSearching(false);
        }
    };

    const selectResult = (result: GeocodeResult) => {
        onLocationSelect(result.latitude, result.longitude);
        setShowResults(false);
        setSearchQuery(result.displayName);
    };

    return (
        <div className="space-y-3">
             {/* Search Bar */}
             <div className="relative z-10">
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <input
                            type="text"
                            placeholder="Cari lokasi (e.g. Jalan Intan 2.5, Kota Baru Driyorejo)..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                    e.preventDefault(); // Prevent submitting outer form
                                    handleSearch(e);
                                }
                            }}
                            className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                        />
                        <Search className="absolute left-3 top-2.5 text-slate-400 w-5 h-5" />
                    </div>
                    <button 
                        type="button" 
                        onClick={handleSearch}
                        disabled={isSearching}
                        className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium text-sm flex items-center gap-2"
                    >
                        {isSearching ? <Loader2 className="animate-spin w-4 h-4" /> : "Cari"}
                    </button>
                </div>

                {/* Search Results Dropdown */}
                {showResults && searchResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-2 bg-white rounded-lg shadow-xl border border-slate-200 max-h-60 overflow-y-auto divide-y divide-slate-100 z-50">
                        {searchResults.map((result, idx) => (
                            <button
                                key={idx}
                                onClick={() => selectResult(result)}
                                className="w-full text-left px-4 py-3 hover:bg-slate-50 text-sm text-slate-700 transition-colors"
                            >
                                {result.displayName}
                            </button>
                        ))}
                    </div>
                )}
             </div>

             {/* Map Container */}
             <div className="h-[400px] rounded-xl overflow-hidden border-2 border-slate-200 relative z-0">
                <MapContainer center={defaultCenter} zoom={latitude ? 16 : DEFAULT_MAP_ZOOM} className="w-full h-full">
                    {/* Modern Tiles: CartoDB Positron */}
                    <TileLayer
                        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                        url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                    />
                    
                    <MapEvents onLocationSelect={onLocationSelect} />
                    
                    {/* Dynamic FlyTo when props change */}
                     {latitude && longitude && <FlyToLocation lat={latitude} lng={longitude} />}

                    {latitude && longitude && (
                        <Marker position={[latitude, longitude]} icon={customIcon}>
                            <Popup>
                                <div className="text-center">
                                    <p className="font-bold text-slate-800">Lokasi Terpilih</p>
                                    <p className="text-xs text-slate-500">{latitude.toFixed(6)}, {longitude.toFixed(6)}</p>
                                </div>
                            </Popup>
                        </Marker>
                    )}
                </MapContainer>

                {/* Info Overlay */}
                <div className="absolute bottom-4 left-4 right-4 bg-white/90 backdrop-blur px-4 py-2 rounded-lg shadow-lg text-xs text-slate-600 z-[400] pointer-events-none md:max-w-fit">
                    Klik pada peta untuk menyesuaikan titik lokasi secara presisi.
                </div>
             </div>
        </div>
    );
}
