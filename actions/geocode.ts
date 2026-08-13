"use server";

export type GeocodeResult = {
    displayName: string;
    latitude: number;
    longitude: number;
};

/**
 * Pencarian lokasi lewat Nominatim. Dijalankan di server supaya browser
 * pengguna tidak menembak layanan pihak ketiga secara langsung (Nominatim
 * mewajibkan User-Agent yang jelas dan membatasi rate per klien).
 */
export async function searchLocation(query: string): Promise<GeocodeResult[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];

    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "json");
    url.searchParams.set("q", trimmed);
    url.searchParams.set("limit", "5");
    url.searchParams.set("countrycodes", "id");

    try {
        const response = await fetch(url, {
            headers: {
                "User-Agent": "cctv-publik/0.1 (monitoring app)",
                "Accept-Language": "id",
            },
            next: { revalidate: 3600 },
        });

        if (!response.ok) return [];

        const data: unknown = await response.json();
        if (!Array.isArray(data)) return [];

        return data.flatMap((item) => {
            const lat = Number(item?.lat);
            const lon = Number(item?.lon);
            if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];
            return [{
                displayName: String(item?.display_name ?? ""),
                latitude: lat,
                longitude: lon,
            }];
        });
    } catch (error) {
        console.error("Geocode failed:", error);
        return [];
    }
}
