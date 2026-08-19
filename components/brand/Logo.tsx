import { cn } from "@/lib/utils";

/**
 * Logo MINS CCTV: kamera dome tergantung di plat plafon, dengan lensa sebagai
 * lubang (fill-rule evenodd) supaya latar apa pun bisa menembus.
 *
 * Digambar di grid 32x32 dan sengaja dioptical-center — tinggi glyph 14.6 unit
 * dengan sisa 8.7 unit di atas dan di bawah — supaya tetap seimbang saat dipakai
 * sebagai kotak ikon. Bentuknya dijaga solid (dua bidang besar + satu lubang)
 * supaya masih terbaca di favicon 16px, di mana ikon bergaris tipis jadi bubur.
 *
 * PENTING: geometri yang sama diduplikasi di app/icon.svg karena file itu sumber
 * untuk favicon.ico dan apple-icon.png (lihat scripts/build-icons.mjs). Kalau
 * salah satu diubah, ubah keduanya lalu jalankan `npm run icons`.
 */
const GLYPH_PATH =
    // plat plafon
    "M10.75 8.7H21.25A1.5 1.5 0 0 1 22.75 10.2V12.8H9.25V10.2A1.5 1.5 0 0 1 10.75 8.7Z" +
    // kubah
    "M5.5 12.8H26.5A10.5 10.5 0 0 1 5.5 12.8Z" +
    // lensa (lubang) — r 4 dipilih setelah uji render: di favicon 16px lubang
    // dengan r 3.6 hampir tertutup, sedangkan r 4.3 membuat dinding kubah tipis
    "M16 14.05A4 4 0 1 0 16 22.05A4 4 0 1 0 16 14.05Z";

interface MarkProps {
    className?: string;
    /** Isi kalau logo berdiri sendiri tanpa teks "MINS CCTV" di sebelahnya. */
    label?: string;
}

/** Glyph saja, mewarisi warna teks — untuk dipakai di atas latar buatan sendiri. */
export function LogoMark({ className, label }: MarkProps) {
    return (
        <svg
            viewBox="0 0 32 32"
            className={cn("w-5 h-5", className)}
            fill="currentColor"
            role={label ? "img" : undefined}
            aria-label={label}
            aria-hidden={label ? undefined : true}
        >
            <path fillRule="evenodd" clipRule="evenodd" d={GLYPH_PATH} />
        </svg>
    );
}

/**
 * Kotak logo biru — proporsinya sama dengan app/icon.svg (radius 25% = rx 8 pada
 * grid 32, glyph mengisi penuh karena margin sudah ada di dalam viewBox-nya),
 * jadi ikon di dalam aplikasi dan di tab browser benar-benar bentuk yang sama.
 * Sudut & bayangan lewat CSS supaya shadow mengikuti lengkung kotaknya.
 */
export function LogoTile({ className, label }: MarkProps) {
    return (
        <span
            className={cn(
                "inline-flex items-center justify-center bg-blue-600 rounded-[25%] w-9 h-9 shrink-0",
                className
            )}
        >
            <LogoMark className="w-full h-full text-white" label={label} />
        </span>
    );
}

/** Lockup: kotak logo + wordmark. Dipakai di header publik dan halaman login. */
export function Logo({
    className,
    tagline = true,
    tileClassName,
}: {
    className?: string;
    tagline?: boolean;
    tileClassName?: string;
}) {
    return (
        <div className={cn("flex items-center gap-2.5 sm:gap-3 min-w-0", className)}>
            <LogoTile className={cn("w-9 h-9 shadow-lg shadow-blue-200", tileClassName)} />
            <div className="min-w-0">
                <span className="block text-base sm:text-lg font-bold tracking-tight text-slate-900 truncate">
                    MINS CCTV
                </span>
                {tagline && (
                    <span className="block text-[10px] font-bold text-blue-600 uppercase tracking-widest truncate">
                        CCTV Masyarakat
                    </span>
                )}
            </div>
        </div>
    );
}
