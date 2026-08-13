"use client";

import { useEffect, useState } from "react";
import type { HseLiveFrame, HsePerson } from "@/lib/hse";

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

function personLabel(person: HsePerson): string {
    const parts: string[] = [];
    if (person.helmet === false) parts.push("tanpa helm");
    else if (person.helmet === true) parts.push(person.helmetColor ? `helm ${person.helmetColor}` : "helm");

    if (person.vest === false) parts.push("tanpa rompi");
    else if (person.vest === true) parts.push(person.vestColor ? `rompi ${person.vestColor}` : "rompi");

    return parts.length ? parts.join(" · ") : "APD tidak terbaca";
}

export default function HSEOverlay({ slug, videoRef, active, zoom = 1 }: Props) {
    const [frame, setFrame] = useState<HseLiveFrame | null>(null);
    const [offline, setOffline] = useState<string | null>(null);
    const [rect, setRect] = useState<ReturnType<typeof contentRect>>(null);
    // Jam dinding disimpan sebagai state, bukan dibaca saat render: render harus
    // murni, dan Date.now() di dalamnya menghasilkan umur yang berubah setiap
    // kali komponen kebetulan dirender ulang karena sebab lain.
    const [now, setNow] = useState<number | null>(null);

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
                setFrame(JSON.parse((event as MessageEvent).data));
                setOffline(null);
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

        return () => {
            observer.disconnect();
            video.removeEventListener("loadedmetadata", update);
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
    const ageMs = !frame ? Infinity : now === null ? 0 : Math.max(0, now - frame.at);
    const persons = frame && ageMs < EXPIRE_AFTER_MS ? frame.persons : [];
    const stale = ageMs > STALE_AFTER_MS;

    return (
        <div
            className="absolute inset-0 z-30 pointer-events-none"
            style={zoom === 1 ? undefined : { transform: `scale(${zoom})` }}
        >
            {rect &&
                persons.map((person, index) => {
                    const [x, y, w, h] = person.box;
                    const violating = person.violating;
                    return (
                        <div
                            key={index}
                            className={`absolute border-2 rounded-sm transition-opacity duration-500 ${
                                violating
                                    ? "border-red-500 shadow-[0_0_0_1px_rgba(0,0,0,0.5)]"
                                    : "border-emerald-400/80"
                            }`}
                            style={{
                                left: rect.left + x * rect.width,
                                top: rect.top + y * rect.height,
                                width: w * rect.width,
                                height: h * rect.height,
                                opacity: stale ? 0.35 : 1,
                            }}
                        >
                            <span
                                className={`absolute -top-4.5 left-0 px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${
                                    violating ? "bg-red-500 text-white" : "bg-emerald-500 text-white"
                                }`}
                            >
                                {personLabel(person)}
                            </span>
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
                        <span
                            className={`px-2 py-1 rounded-full border text-[10px] font-black tracking-widest uppercase ${
                                frame.violatorCount > 0
                                    ? "bg-red-500 border-red-400 text-white"
                                    : "bg-emerald-600/90 border-emerald-400 text-white"
                            }`}
                        >
                            {frame.violatorCount > 0
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
