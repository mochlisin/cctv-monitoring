"use client";

import { useEffect, useState } from "react";
import { HSE_COLOR_HEX, type HseBox, type HseLiveFrame } from "@/lib/hse";

/**
 * Kotak deteksi APD di atas video.
 *
 * Yang perlu dipahami sebelum membaca kode ini: overlay tidak pernah benar-benar
 * sinkron dengan video, dan itu tidak bisa diperbaiki. Worker menganalisis satu
 * frame tiap beberapa detik, sementara video mengalir tiga puluh kali per detik;
 * kotak yang digambar selalu menggambarkan keadaan beberapa saat lalu. Karena
 * itu tampilannya sengaja dibuat jujur — kotaknya diberi label umur, dan memudar
 * ketika sudah basi, alih-alih berpura-pura mengikuti orang yang bergerak.
 *
 * Menutupinya dengan interpolasi atau tracking di sisi klien justru berbahaya:
 * kotak yang meluncur mulus meyakinkan operator bahwa sistem melihat setiap
 * detik, padahal tidak.
 */

/** Setelah sekian detik tanpa frame baru, kotak dianggap basi dan dipudarkan. */
const STALE_AFTER_MS = 8000;
/** Batas sebelum kotak dihapus sama sekali. */
const EXPIRE_AFTER_MS = 20_000;

type Props = {
    slug: string;
    videoRef: React.RefObject<HTMLVideoElement | null>;
    /** Overlay ikut mati saat player berhenti — tidak ada koneksi menganggur. */
    active: boolean;
    /** Zoom player, supaya kotak ikut membesar bersama gambar. */
    zoom?: number;
};

/**
 * Kotak video yang benar-benar terlihat di dalam elemen.
 *
 * Elemen video memakai object-contain, jadi ada bilah kosong di sisi atas-bawah
 * atau kiri-kanan tergantung rasio. Menggambar kotak relatif terhadap elemen —
 * bukan terhadap gambar di dalamnya — membuat semua kotak meleset persis
 * setebal bilah itu.
 */
function contentRect(video: HTMLVideoElement) {
    const { clientWidth: boxW, clientHeight: boxH, videoWidth, videoHeight } = video;
    if (!videoWidth || !videoHeight || !boxW || !boxH) return null;

    const scale = Math.min(boxW / videoWidth, boxH / videoHeight);
    const width = videoWidth * scale;
    const height = videoHeight * scale;
    return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height };
}

type ContentRect = NonNullable<ReturnType<typeof contentRect>>;

/**
 * Teks satu penanda APD.
 *
 * Tiga keadaan yang sebelumnya tertulis sama persis ("helm") dan karenanya tidak
 * bisa dibedakan operator: dipakai dengan warna terbaca, dipakai tapi warnanya
 * tidak menonjol, dan terdeteksi tidak dipakai. Yang kedua bukan kegagalan —
 * pada helm berukuran belasan piksel, `confidentColor` menolak menebak — tapi
 * menyembunyikannya membuat fitur warna terlihat seperti tidak berfungsi.
 */
function apdLabel(kind: "helm" | "rompi", worn: boolean, color: string | null): string {
    if (!worn) return kind === "helm" ? "TANPA HELM" : "TANPA ROMPI";
    return color ? `${kind} ${color}` : `${kind} · warna tak terbaca`;
}

/**
 * Kotak pada satu APD, bukan pada orangnya.
 *
 * Inilah penanda utama overlay: kotak orang hanya konteks. Menggambar keduanya
 * dengan bobot yang sama membuat mata tidak tahu mana yang dinilai.
 */
function ApdMarker({
    box,
    rect,
    kind,
    worn,
    color,
    faded,
}: {
    box: HseBox;
    rect: ContentRect;
    kind: "helm" | "rompi";
    worn: boolean;
    color: string | null;
    faded: boolean;
}) {
    const [x, y, w, h] = box;
    const swatch = worn && color ? HSE_COLOR_HEX[color] : undefined;

    return (
        <div
            className={`absolute border-2 rounded transition-opacity duration-500 ${
                worn
                    ? "border-emerald-400 shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
                    : "border-red-500 shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
            }`}
            style={{
                left: rect.left + x * rect.width,
                top: rect.top + y * rect.height,
                width: w * rect.width,
                height: h * rect.height,
                opacity: faded ? 0.35 : 1,
            }}
        >
            {/* Label sengaja dibiarkan melimpah keluar kotak. Kotak helm sering
                hanya belasan piksel di layar, jadi memaksa teks masuk ke dalamnya
                hanya menghasilkan label yang tidak terbaca. */}
            <span
                className={`absolute -top-4.5 left-0 flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
                    worn ? "bg-emerald-500 text-white" : "bg-red-500 text-white"
                }`}
            >
                {swatch && (
                    <span
                        className="w-2 h-2 rounded-full ring-1 ring-white/70 shrink-0"
                        style={{ backgroundColor: swatch }}
                    />
                )}
                {apdLabel(kind, worn, color)}
            </span>
        </div>
    );
}

export default function HSEOverlay({ slug, videoRef, active, zoom = 1 }: Props) {
    const [frame, setFrame] = useState<HseLiveFrame | null>(null);
    const [offline, setOffline] = useState<string | null>(null);
    const [rect, setRect] = useState<ReturnType<typeof contentRect>>(null);
    // Jam dinding disimpan sebagai state, bukan dibaca saat render: render harus
    // murni, dan Date.now() di dalamnya menghasilkan umur yang berubah setiap
    // kali komponen kebetulan dirender ulang karena sebab lain.
    const [now, setNow] = useState<number | null>(null);
    /**
     * Selisih jam browser terhadap jam server.
     *
     * `frame.at` dicap oleh worker memakai jam SERVER, sementara umur dihitung
     * dengan jam BROWSER. Tanpa koreksi, penonton yang jamnya maju lebih dari
     * EXPIRE_AFTER_MS membuat setiap frame terlihat kedaluwarsa begitu tiba —
     * overlay kosong selamanya, sementara snapshot yang ditulis server-side tetap
     * sempurna. Gejala itu menyesatkan justru karena separuh sistemnya benar.
     *
     * Yang dipakai adalah selisih TERKECIL yang pernah teramati, bukan yang
     * pertama: sampel pertama bisa kebetulan diambil saat worker sedang tersendat
     * dan frame-nya memang sudah tua, dan mengunci angka itu akan membuat semua
     * frame berikutnya terlihat lebih segar daripada kenyataan.
     */
    const [clockOffset, setClockOffset] = useState<number | null>(null);

    // Frame terakhir sengaja tidak dibuang saat player berhenti. Kalau player
    // menyala lagi dalam beberapa detik, analisis itu memang masih berlaku; dan
    // kalau sudah lama, penyaring umur di bawah yang membuangnya. Membersihkannya
    // di sini hanya akan membuat overlay berkedip kosong setiap kali player
    // ter-scroll keluar layar sebentar.
    useEffect(() => {
        if (!active) return;

        const source = new EventSource(`/hse/live/${slug}`);

        source.addEventListener("frame", (event) => {
            try {
                const parsed: HseLiveFrame = JSON.parse((event as MessageEvent).data);
                setFrame(parsed);
                setOffline(null);
                setClockOffset((prev) => {
                    const sample = Date.now() - parsed.at;
                    return prev === null ? sample : Math.min(prev, sample);
                });
            } catch {
                /* payload rusak — abaikan, frame berikutnya menyusul */
            }
        });

        source.addEventListener("offline", (event) => {
            try {
                setOffline(JSON.parse((event as MessageEvent).data).reason ?? "tidak tersedia");
            } catch {
                setOffline("tidak tersedia");
            }
        });

        // Koneksi yang gagal (401, worker mati) tidak perlu dicoba terus oleh
        // browser: overlay adalah tambahan, bukan syarat menonton.
        source.onerror = () => {
            setOffline("analisis tidak tersedia");
            source.close();
        };

        return () => source.close();
    }, [slug, active]);

    // Posisi gambar di dalam elemen berubah saat ukuran player berubah dan saat
    // metadata video baru tiba (sebelum itu videoWidth masih nol).
    //
    // Tidak ada pengukuran awal yang dipanggil langsung: observe() selalu
    // mengirim satu notifikasi pertama begitu dipasang, jadi memanggil update()
    // sendiri hanya menambah satu render tanpa menambah informasi.
    useEffect(() => {
        const video = videoRef.current;
        if (!video || !active) return;

        const update = () => setRect(contentRect(video));

        const observer = new ResizeObserver(update);
        observer.observe(video);
        video.addEventListener("loadedmetadata", update);
        // ResizeObserver hanya memantau kotak ELEMEN; event `resize` pada elemen
        // video adalah satu-satunya yang menandai perubahan ukuran INTRINSIK.
        // Bedanya menentukan pada WebRTC: srcObject bisa mendapat dimensi setelah
        // loadedmetadata, dan saat itu ukuran elemennya tidak berubah sama sekali
        // — contentRect tetap null, dan tanpa rect tidak ada satu kotak pun yang
        // digambar.
        video.addEventListener("resize", update);

        return () => {
            observer.disconnect();
            video.removeEventListener("loadedmetadata", update);
            video.removeEventListener("resize", update);
        };
    }, [videoRef, active, frame]);

    useEffect(() => {
        if (!active) return;
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [active]);

    if (!active) return null;

    // Sebelum detak pertama, umur dianggap nol — frame yang baru saja tiba
    // tidak boleh terlihat basi hanya karena jamnya belum berdetak.
    const ageMs = !frame
        ? Infinity
        : now === null
          ? 0
          : Math.max(0, now - frame.at - (clockOffset ?? 0));
    const expired = ageMs >= EXPIRE_AFTER_MS;
    const persons = frame && !expired ? frame.persons : [];
    const stale = ageMs > STALE_AFTER_MS;

    return (
        <div
            className="absolute inset-0 z-30 pointer-events-none"
            style={zoom === 1 ? undefined : { transform: `scale(${zoom})` }}
        >
            {rect &&
                persons.map((person, index) => {
                    const [x, y, w, h] = person.box;
                    // Tidak satu pun APD terbaca: kotak orang jadi satu-satunya
                    // yang bisa digambar, jadi ia yang membawa keterangannya.
                    const nothingRead = !person.helmetBox && !person.vestBox;

                    return (
                        <div key={index}>
                            {/* Kotak orang — konteks, bukan penanda utama. Tipis
                                dan pudar supaya kotak APD yang menonjol. */}
                            <div
                                className={`absolute rounded-sm transition-opacity duration-500 ${
                                    person.inferred
                                        ? "border border-dashed border-slate-300/70"
                                        : "border border-white/45"
                                }`}
                                style={{
                                    left: rect.left + x * rect.width,
                                    top: rect.top + y * rect.height,
                                    width: w * rect.width,
                                    height: h * rect.height,
                                    opacity: stale ? 0.3 : 0.75,
                                }}
                            >
                                {(nothingRead || person.inferred) && (
                                    <span className="absolute -top-4.5 left-0 px-1.5 py-0.5 rounded bg-slate-800/85 text-[10px] font-bold text-slate-200 whitespace-nowrap">
                                        {person.inferred
                                            ? nothingRead
                                                ? "posisi perkiraan · APD tak terbaca"
                                                : "posisi perkiraan"
                                            : "APD tidak terbaca"}
                                    </span>
                                )}
                            </div>

                            {/* Kotak helm. Saat helmet === false, kotak ini adalah
                                kepala telanjang — dan menunjuk tepat ke sana jauh
                                lebih berguna daripada kotak merah keliling tubuh. */}
                            {person.helmetBox && person.helmet !== null && (
                                <ApdMarker
                                    box={person.helmetBox}
                                    rect={rect}
                                    kind="helm"
                                    worn={person.helmet}
                                    color={person.helmetColor}
                                    faded={stale}
                                />
                            )}

                            {person.vestBox && person.vest !== null && (
                                <ApdMarker
                                    box={person.vestBox}
                                    rect={rect}
                                    kind="rompi"
                                    worn={person.vest}
                                    color={person.vestColor}
                                    faded={stale}
                                />
                            )}
                        </div>
                    );
                })}

            {/* Ringkasan pojok kanan atas. Umur analisis ditampilkan terus-menerus
                karena tanpa itu overlay kosong tampak sama saja dengan overlay
                yang melaporkan "tidak ada pelanggaran". */}
            <div className="absolute top-2 right-2 flex flex-col items-end gap-1">
                {offline ? (
                    <span className="px-2 py-1 rounded-full bg-slate-800/90 border border-slate-600 text-[10px] font-bold text-slate-300 tracking-wide uppercase">
                        HSE {offline}
                    </span>
                ) : frame ? (
                    <>
                        {/* Ringkasan harus ikut kedaluwarsa bersama kotaknya.
                            Sebelumnya angka ini tetap tampil setelah kotaknya
                            dibuang, sehingga badge "3 orang · APD lengkap"
                            berdampingan dengan video tanpa kotak sama sekali —
                            lebih buruk daripada tidak menampilkan apa pun, karena
                            operator menyimpulkan "aman" dari overlay yang sudah
                            mati. */}
                        <span
                            className={`px-2 py-1 rounded-full border text-[10px] font-black tracking-widest uppercase ${
                                expired
                                    ? "bg-slate-800/90 border-slate-600 text-slate-300"
                                    : frame.violatorCount > 0
                                      ? "bg-red-500 border-red-400 text-white"
                                      : "bg-emerald-600/90 border-emerald-400 text-white"
                            }`}
                        >
                            {expired
                                ? "analisis kedaluwarsa"
                                : frame.violatorCount > 0
                                  ? `${frame.violatorCount} pelanggaran`
                                  : frame.personCount > 0
                                    ? `${frame.personCount} orang · APD lengkap`
                                    : "tidak ada orang"}
                        </span>
                        <span className="px-2 py-0.5 rounded-full bg-black/70 text-[9px] font-semibold text-slate-300 tabular-nums">
                            analisis {ageMs < 1000 ? "baru saja" : `${Math.round(ageMs / 1000)} dtk lalu`}
                        </span>
                    </>
                ) : (
                    <span className="px-2 py-1 rounded-full bg-slate-800/90 border border-slate-600 text-[10px] font-bold text-slate-300 tracking-wide uppercase">
                        HSE menunggu frame
                    </span>
                )}
            </div>
        </div>
    );
}
