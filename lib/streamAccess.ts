import { SignJWT, jwtVerify } from "jose";

/**
 * Kontrol akses lapisan proxy media.
 *
 * MediaMTX hanya mendengarkan di 127.0.0.1, jadi satu-satunya jalan masuk ke
 * stream adalah /stream-proxy dan /webrtc-proxy milik Next. Middleware menjaga
 * kedua jalur itu dengan grant bertanda tangan.
 *
 * File ini sengaja hanya bergantung pada `jose` (tanpa Prisma) agar bisa
 * dipakai di middleware yang berjalan di Edge runtime.
 */

const secret = new TextEncoder().encode(
    process.env.JWT_SECRET || "your-secret-key-change-in-production"
);

export const STREAM_GRANT_COOKIE = "stream-grant";
export const STREAM_PATH_PREFIX = "cctv_";
export const GRANT_TTL_SECONDS = 4 * 60 * 60;
export const PROXY_PREFIXES = ["/stream-proxy", "/webrtc-proxy"] as const;

/**
 * Nama path di MediaMTX. Memakai slug UUID, bukan ID numerik berurutan —
 * dengan ID numerik siapa pun bisa menghitung cctv_1, cctv_2, ... dan menonton
 * kamera privat tanpa pernah tahu slug-nya.
 */
export function streamPathFor(slug: string) {
    return `${STREAM_PATH_PREFIX}${slug}`;
}

const PROXY_PATH = /^\/(?:stream|webrtc)-proxy\/cctv_([A-Za-z0-9._~-]+)(?:\/|$)/;

/** Ambil slug kamera dari path proxy, atau null kalau bukan path stream. */
export function slugFromProxyPath(pathname: string): string | null {
    return pathname.match(PROXY_PATH)?.[1] ?? null;
}

export function isProxyPath(pathname: string): boolean {
    return PROXY_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export async function signStreamGrant(slug: string): Promise<string> {
    return new SignJWT({ slug })
        .setProtectedHeader({ alg: "HS256" })
        .setIssuedAt()
        .setExpirationTime(`${GRANT_TTL_SECONDS}s`)
        .sign(secret);
}

export async function verifyStreamGrant(
    token: string | undefined,
    slug: string
): Promise<boolean> {
    if (!token) return false;
    try {
        const { payload } = await jwtVerify(token, secret);
        return payload.slug === slug;
    } catch {
        return false;
    }
}

/**
 * Grant disimpan sebagai cookie ber-Path spesifik per kamera per proxy.
 * Efeknya: browser hanya mengirim grant yang relevan untuk request itu, jadi
 * multiview 9 kamera tidak membebani setiap segmen HLS dengan 9 token, dan
 * penulisan grant paralel tidak saling menimpa.
 */
export function grantCookiePaths(slug: string): string[] {
    const path = streamPathFor(slug);
    return PROXY_PREFIXES.map((prefix) => `${prefix}/${path}`);
}
