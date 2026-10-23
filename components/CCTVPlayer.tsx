"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Hls, { type ErrorData } from "hls.js";
import { requestStreamAccess } from "@/actions/stream";
import HSEOverlay from "@/components/HSEOverlay";

// Custom Icon Components
const VolumeX = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg>
);
const Volume2 = () => (
     <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>
);
const Maximize = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"></path></svg>
);
const Minimize = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"></path></svg>
);
const CameraIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle></svg>
);
const RecordIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="7"></circle></svg>
);
const StopIcon = () => (
    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
);

const WEBRTC_BASE = process.env.NEXT_PUBLIC_WEBRTC_BASE ?? "/webrtc-proxy";
const HLS_BASE = process.env.NEXT_PUBLIC_HLS_BASE ?? "/stream-proxy";
const STUN_URL = process.env.NEXT_PUBLIC_WEBRTC_STUN;
// "auto" (WebRTC dulu, jatuh ke HLS) | "hls" (paksa HLS) | "webrtc" (tanpa fallback)
const TRANSPORT_MODE = process.env.NEXT_PUBLIC_STREAM_TRANSPORT ?? "auto";

// Batas tunggu sampai WebRTC benar-benar tersambung sebelum menyerah ke HLS.
const WEBRTC_CONNECT_TIMEOUT_MS = 8000;
// Waktu maksimal menunggu ICE gathering sebelum offer dikirim apa adanya.
const ICE_GATHER_TIMEOUT_MS = 1500;
// Seberapa jauh playback HLS boleh tertinggal dari live edge sebelum lompat maju.
const MAX_DRIFT_SECONDS = 6;

// ---------------------------------------------------------------------------
// Pengawas latensi WebRTC
// ---------------------------------------------------------------------------
// Jalur HLS punya dua pengaman terhadap ketertinggalan (liveSyncPosition dan
// seek berkala di bawah). Jalur WebRTC — yang justru dipakai secara default —
// dulu tidak punya apa pun: browser boleh menumpuk jitter buffer sedalam apa
// pun, dan siaran yang tertinggal tetap terlihat mulus dan tetap berlabel
// "LIVE". Yang di bawah ini memberinya batas.
//
// Jitter buffer normal berkisar 50–200 ms. Di atas satu detik, ada frame yang
// menumpuk di suatu tempat.
const WEBRTC_MAX_DELAY_SECONDS = 1.2;
// Batas yang diminta ke browser di muka (Chrome 114+ `jitterBufferTarget`).
const WEBRTC_TARGET_DELAY_MS = 150;
const WEBRTC_STATS_INTERVAL_MS = 4000;
// Berapa kali menyambung ulang sebelum menyerah dan mengatakannya terus terang.
//
// Batas ini penting: kalau timbunan frame ada di HULU (uplink kamera lebih
// sempit dari bitrate-nya, sehingga RTSP over TCP mengantre alih-alih
// membuang), menyambung ulang browser tidak memperbaiki apa pun — dan tanpa
// batas, player akan berkedip menyambung ulang setiap beberapa detik selamanya.
// Lebih baik berhenti dan memberi tahu ke mana harus melihat.
const MAX_LATENCY_RECONNECTS = 3;

type LatencySample = { delay: number; emitted: number };

/** Rerata kedalaman jitter buffer sejak sampel sebelumnya, dalam detik. */
function readLatencySample(report: RTCStatsReport): LatencySample | null {
    for (const entry of Array.from(report.values())) {
        const stat = entry as {
            type?: string;
            kind?: string;
            jitterBufferDelay?: number;
            jitterBufferEmittedCount?: number;
        };
        if (
            stat.type === "inbound-rtp" &&
            stat.kind === "video" &&
            typeof stat.jitterBufferDelay === "number" &&
            typeof stat.jitterBufferEmittedCount === "number"
        ) {
            return { delay: stat.jitterBufferDelay, emitted: stat.jitterBufferEmittedCount };
        }
    }
    return null;
}

type Transport = "webrtc" | "hls";

type FullscreenVideo = HTMLVideoElement & {
    webkitEnterFullscreen?: () => void;
};

type CapturableVideo = HTMLVideoElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
};

// lock/unlock belum ada di lib.dom bawaan TypeScript.
type LockableOrientation = ScreenOrientation & {
    lock?: (orientation: "landscape" | "portrait" | "natural" | "any") => Promise<void>;
    unlock?: () => void;
};

const initialTransport: Transport = "webrtc";

/** Tunggu ICE gathering selesai, tapi jangan sampai menahan koneksi terlalu lama. */
function waitForIceGathering(pc: RTCPeerConnection, timeoutMs: number) {
    if (pc.iceGatheringState === "complete") return Promise.resolve();

    return new Promise<void>((resolve) => {
        const finish = () => {
            pc.removeEventListener("icegatheringstatechange", onChange);
            clearTimeout(timer);
            resolve();
        };
        const onChange = () => {
            if (pc.iceGatheringState === "complete") finish();
        };
        const timer = setTimeout(finish, timeoutMs);
        pc.addEventListener("icegatheringstatechange", onChange);
    });
}

/** Format container terbaik yang didukung browser untuk hasil rekaman. */
function pickRecordingMimeType(): string | undefined {
    const candidates = [
        "video/mp4;codecs=avc1",
        "video/mp4",
        "video/webm;codecs=h264",
        "video/webm;codecs=vp9",
        "video/webm;codecs=vp8",
        "video/webm",
    ];
    return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

/** Simpan blob ke perangkat pengguna. Tidak ada apa pun yang dikirim ke server. */
function saveToDevice(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function fileStamp() {
    return new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
}

function formatDuration(totalSeconds: number) {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export default function CCTVPlayer({
  streamName,
  // Overlay HSE hanya digambar kalau kamera ini memang dipantau. Endpoint-nya
  // tetap memeriksa sendiri (dan mewajibkan sesi), jadi prop ini semata-mata
  // menghindari membuka koneksi yang sudah pasti ditolak.
  hse = false,
}: {
  streamName: string;
  hse?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(true);
  const [transport, setTransport] = useState<Transport>(initialTransport);
  const [zoom, setZoom] = useState(1);
  const [showControls, setShowControls] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [canRecord, setCanRecord] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordSeconds, setRecordSeconds] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  // Lebar container, bukan lebar viewport: player yang sama bisa tampil sebagai
  // kartu 280px di monitor lebar, jadi breakpoint `sm:` justru salah di sini.
  const [width, setWidth] = useState(0);
  // Player dimatikan total saat tab disembunyikan atau ter-scroll keluar layar.
  const [active, setActive] = useState(true);
  // Dinaikkan oleh pengawas latensi untuk memaksa sesi dibangun ulang.
  const [reconnectNonce, setReconnectNonce] = useState(0);

  const onScreenRef = useRef(true);
  const recordingRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const lastTapRef = useRef<number>(0);
  const latencyReconnectsRef = useRef(0);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showNotice = useCallback((message: string) => {
      setNotice(message);
      if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
      noticeTimeoutRef.current = setTimeout(() => setNotice(null), 2500);
  }, []);

  const revealControls = useCallback(() => {
      setShowControls(true);
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  // Perekaman tidak boleh terputus hanya karena player ter-scroll keluar layar.
  const syncActive = useCallback(() => {
      setActive(recordingRef.current || (!document.hidden && onScreenRef.current));
  }, []);

  useEffect(() => {
    setCanRecord(typeof MediaRecorder !== "undefined");
  }, []);

  // Hemat CPU/baterai: jangan pernah decode video yang tidak dilihat siapa pun.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
        ([entry]) => {
            onScreenRef.current = entry.isIntersecting;
            syncActive();
        },
        { threshold: 0.05 }
    );
    observer.observe(el);

    const resizeObserver = new ResizeObserver(([entry]) => {
        setWidth(entry.contentRect.width);
    });
    resizeObserver.observe(el);

    document.addEventListener("visibilitychange", syncActive);

    return () => {
        observer.disconnect();
        resizeObserver.disconnect();
        document.removeEventListener("visibilitychange", syncActive);
    };
  }, [syncActive]);

  // Fullscreen di HP: putar otomatis ke landscape seperti YouTube.
  useEffect(() => {
    const onFullscreenChange = () => {
        const entered = Boolean(
            document.fullscreenElement &&
            containerRef.current?.contains(document.fullscreenElement as Node | null)
        ) || document.fullscreenElement === containerRef.current;
        setIsFullscreen(entered);

        const orientation = window.screen?.orientation as LockableOrientation | undefined;
        if (!orientation) return;

        if (entered) {
            // Hanya di perangkat sentuh — jangan paksa rotasi layar desktop.
            if (window.matchMedia("(pointer: coarse)").matches) {
                orientation.lock?.("landscape")?.catch(() => undefined);
            }
        } else {
            orientation.unlock?.();
        }
    };

    document.addEventListener("fullscreenchange", onFullscreenChange);
    // Safari lama masih memakai event berprefiks.
    document.addEventListener("webkitfullscreenchange", onFullscreenChange);
    return () => {
        document.removeEventListener("fullscreenchange", onFullscreenChange);
        document.removeEventListener("webkitfullscreenchange", onFullscreenChange);
        (window.screen?.orientation as LockableOrientation | undefined)?.unlock?.();
    };
  }, []);

  useEffect(() => {
    if (!isRecording) return;
    const timer = setInterval(() => setRecordSeconds((s) => s + 1), 1000);
    return () => clearInterval(timer);
  }, [isRecording]);

  useEffect(() => {
    const video = videoRef.current;
    if (!isPlaying || !active || !video) return;

    let cancelled = false;
    const timers: ReturnType<typeof setTimeout>[] = [];
    let teardown: () => void = () => undefined;

    const fallbackToHls = (reason: string) => {
        if (cancelled || TRANSPORT_MODE === "webrtc") return;
        console.warn(`[CCTVPlayer] ${reason} — beralih ke HLS`);
        setTransport("hls");
    };

    // ---------------------------------------------------------------
    // WebRTC (WHEP) — latensi sub-detik
    // ---------------------------------------------------------------
    const startWebRTC = () => {
      setLoading(true);
      setError(null);

      const pc = new RTCPeerConnection({
        iceServers: STUN_URL ? [{ urls: STUN_URL }] : [],
        bundlePolicy: "max-bundle",
      });
      let sessionUrl: string | null = null;
      let statsTimer: ReturnType<typeof setInterval> | null = null;

      const stopWatching = () => {
        if (statsTimer) clearInterval(statsTimer);
        statsTimer = null;
      };

      teardown = () => {
        stopWatching();
        pc.onconnectionstatechange = null;
        pc.ontrack = null;
        pc.close();
        video.srcObject = null;
        if (sessionUrl) {
            // Lepaskan sesi di server; kalau gagal, MediaMTX tetap
            // membersihkannya saat PeerConnection tertutup.
            fetch(sessionUrl, { method: "DELETE", keepalive: true }).catch(() => undefined);
        }
      };

      /**
       * Minta browser menahan playout sesingkat mungkin.
       *
       * Bawaan Chrome adalah menumbuhkan jitter buffer secara adaptif demi
       * kemulusan, dan pada aliran yang datang bergelombang ia bisa menetap di
       * beberapa detik lalu tidak pernah menyusut lagi. Untuk CCTV, gambar
       * tepat waktu lebih berharga daripada gambar mulus.
       */
      const capPlayoutDelay = () => {
        for (const receiver of pc.getReceivers()) {
            const tunable = receiver as RTCRtpReceiver & {
                jitterBufferTarget?: number | null;
                playoutDelayHint?: number | null;
            };
            try {
                // Chrome 114+ — milidetik.
                tunable.jitterBufferTarget = WEBRTC_TARGET_DELAY_MS;
                // Nama lama untuk hal yang sama — detik.
                tunable.playoutDelayHint = WEBRTC_TARGET_DELAY_MS / 1000;
            } catch {
                // Browser tanpa dukungan: pengawas di bawah tetap menjaga batas.
            }
        }
      };

      const remote = new MediaStream();
      pc.addTransceiver("video", { direction: "recvonly" });
      pc.addTransceiver("audio", { direction: "recvonly" });

      pc.ontrack = (event) => {
        remote.addTrack(event.track);
        video.srcObject = remote;
        // Receiver baru lahir dengan batas playout bawaan browser; pasang
        // batas kita sebelum ia mulai menumbuhkan buffernya sendiri.
        capPlayoutDelay();
      };

      const restartForLatency = (delaySeconds: number) => {
        stopWatching();

        if (latencyReconnectsRef.current >= MAX_LATENCY_RECONNECTS) {
            // Sudah dicoba dan tidak membaik. Menyambung ulang lagi hanya akan
            // membuat player berkedip tanpa akhir, jadi berhenti di sini dan
            // katakan apa adanya — sisa masalahnya bukan di browser.
            console.warn(
                `[CCTVPlayer] latensi ${delaySeconds.toFixed(1)}s bertahan setelah ` +
                `${MAX_LATENCY_RECONNECTS} kali sambung ulang — kemungkinan timbunan di sisi kamera`
            );
            showNotice("Siaran tertinggal dari waktu nyata");
            return;
        }

        latencyReconnectsRef.current += 1;
        console.warn(`[CCTVPlayer] latensi WebRTC ${delaySeconds.toFixed(1)}s — menyambung ulang`);
        setReconnectNonce((n) => n + 1);
      };

      const watchLatency = () => {
        stopWatching();
        let previous: LatencySample | null = null;
        let breaches = 0;

        statsTimer = setInterval(() => {
            if (cancelled) return;

            pc.getStats().then((report) => {
                if (cancelled) return;

                const sample = readLatencySample(report);
                if (!sample) return;

                const prior = previous;
                previous = sample;
                if (!prior) return;

                // Selisih antar sampel, bukan rerata seumur sesi: yang terakhir
                // itu bergerak terlalu lambat untuk dipakai sebagai alarm, dan
                // akan menutupi lonjakan yang baru saja terjadi.
                const emitted = sample.emitted - prior.emitted;
                // Tidak ada frame keluar sama sekali berarti siaran macet, bukan
                // tertinggal — itu urusan penanganan galat, bukan pengawas ini.
                if (emitted <= 0) return;

                const delaySeconds = (sample.delay - prior.delay) / emitted;
                if (delaySeconds <= WEBRTC_MAX_DELAY_SECONDS) {
                    breaches = 0;
                    return;
                }

                // Dua pelanggaran berturut-turut. Satu sampel bisa saja hanya
                // sendatan jaringan sesaat yang pulih sendiri; menyambung ulang
                // karenanya justru merugikan.
                breaches += 1;
                if (breaches >= 2) restartForLatency(delaySeconds);
            }).catch(() => undefined);
        }, WEBRTC_STATS_INTERVAL_MS);
      };

      pc.onconnectionstatechange = () => {
        if (cancelled) return;
        if (pc.connectionState === "connected") {
            setLoading(false);
            setError(null);
            capPlayoutDelay();
            watchLatency();
            video.play().catch(() => {
                video.muted = true;
                setIsMuted(true);
                video.play().catch(() => undefined);
            });
        } else if (pc.connectionState === "failed") {
            stopWatching();
            fallbackToHls("Koneksi WebRTC gagal");
        }
      };

      timers.push(setTimeout(() => {
        if (!cancelled && pc.connectionState !== "connected") {
            fallbackToHls("WebRTC tidak tersambung dalam batas waktu");
        }
      }, WEBRTC_CONNECT_TIMEOUT_MS));

      (async () => {
        try {
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          await waitForIceGathering(pc, ICE_GATHER_TIMEOUT_MS);
          if (cancelled) return;

          const response = await fetch(`${WEBRTC_BASE}/cctv_${streamName}/whep`, {
            method: "POST",
            headers: { "Content-Type": "application/sdp" },
            body: pc.localDescription?.sdp ?? "",
          });

          if (!response.ok) throw new Error(`WHEP menjawab ${response.status}`);

          const location = response.headers.get("Location");
          if (location) {
            // Location bisa absolut ke host MediaMTX; pakai path-nya saja agar
            // tetap lewat proxy satu origin.
            try {
                const resolved = new URL(location, window.location.origin).pathname;
                sessionUrl = resolved.startsWith(WEBRTC_BASE)
                    ? resolved
                    : `${WEBRTC_BASE}${resolved}`;
            } catch {
                sessionUrl = null;
            }
          }

          const answer = await response.text();
          if (cancelled) return;
          await pc.setRemoteDescription({ type: "answer", sdp: answer });
        } catch (err) {
          if (!cancelled) fallbackToHls((err as Error).message);
        }
      })();
    };

    // ---------------------------------------------------------------
    // HLS — fallback
    // ---------------------------------------------------------------
    const startHLS = () => {
      setLoading(true);
      setError(null);
      video.srcObject = null;

      const streamUrl = `${HLS_BASE}/cctv_${streamName}/index.m3u8`;

      const seekToLiveEdge = () => {
        const target = hlsRef.current?.liveSyncPosition;
        if (typeof target === "number" && target - video.currentTime > MAX_DRIFT_SECONDS) {
            video.currentTime = target;
        } else if (video.buffered.length) {
            const end = video.buffered.end(video.buffered.length - 1);
            if (end - video.currentTime > MAX_DRIFT_SECONDS) video.currentTime = end - 1;
        }
        if (video.paused) video.play().catch(() => undefined);
      };

      if (Hls.isSupported()) {
        // MediaMTX menyajikan LL-HLS: segmen 1 detik dengan part 200 ms.
        // Angka buffer di bawah harus konsisten satu sama lain — target posisi
        // playback tidak boleh lebih jauh dari yang sanggup dibuffer, kalau
        // tidak player akan terus kehabisan data lalu nudge/seek (nyendet).
        const hls = new Hls({
          enableWorker: true,
          lowLatencyMode: true,
          liveSyncDurationCount: 3,
          liveMaxLatencyDurationCount: 10,
          liveDurationInfinity: true,
          // Mengejar ketertinggalan kecil dengan mempercepat pemutaran sedikit,
          // bukan dengan melompat. Tanpa ini hls.js hanya punya satu alat —
          // seek keras saat ambang maksimum terlampaui — sehingga playback
          // boleh berkeliaran beberapa detik di belakang live edge tanpa
          // dikoreksi sama sekali, dan setiap sendatan menambah jaraknya.
          maxLiveSyncPlaybackRate: 1.5,
          maxBufferLength: 8,
          maxMaxBufferLength: 20,
          maxBufferSize: 20 * 1000 * 1000,
          backBufferLength: 6,
          capLevelToPlayerSize: true,
          manifestLoadingMaxRetry: 4,
          levelLoadingMaxRetry: 4,
          fragLoadingMaxRetry: 6,
          nudgeMaxRetry: 10,
          debug: false,
        });

        hlsRef.current = hls;
        hls.loadSource(streamUrl);
        hls.attachMedia(video);

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
            video.play().catch(() => {
                video.muted = true;
                setIsMuted(true);
                video.play().catch(() => undefined);
            });
        });

        hls.on(Hls.Events.FRAG_BUFFERED, () => {
            setLoading(false);
            setError(null);
        });

        hls.on(Hls.Events.ERROR, (_event, data: ErrorData) => {
          if (!data.fatal) {
            if (data.details === Hls.ErrorDetails.BUFFER_STALLED_ERROR) seekToLiveEdge();
            return;
          }

          console.error("Fatal HLS error:", data.type, data.details);
          switch (data.type) {
            case Hls.ErrorTypes.NETWORK_ERROR:
              // Bisa jadi grant menonton sudah kedaluwarsa; perbarui lalu ulangi.
              requestStreamAccess(streamName)
                .catch(() => undefined)
                .then(() => { if (!cancelled) hls.startLoad(); });
              break;
            case Hls.ErrorTypes.MEDIA_ERROR:
              hls.recoverMediaError();
              break;
            default:
              setError("Gagal memuat siaran");
              setLoading(false);
              break;
          }
        });

        const driftTimer = setInterval(seekToLiveEdge, 5000);
        teardown = () => {
            clearInterval(driftTimer);
            hls.destroy();
            if (hlsRef.current === hls) hlsRef.current = null;
        };
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari: HLS native.
        video.src = streamUrl;
        video.play().catch(() => {
            video.muted = true;
            setIsMuted(true);
            video.play().catch(() => undefined);
        });
        setLoading(false);

        // Pemutar bawaan tidak mengekspos pengendali latensi apa pun, dan tidak
        // punya kewajiban mengejar live edge: sekali tertinggal — biasanya
        // setelah jaringan tersendat — ia akan terus memutar dari posisi lama
        // sampai halaman dimuat ulang. Ini padanan seek berkala di jalur
        // hls.js, hanya memakai `seekable` (ujung live menurut Safari) karena
        // liveSyncPosition tidak ada di sini.
        const nudgeNative = () => {
            const live = video.seekable.length
                ? video.seekable.end(video.seekable.length - 1)
                : video.buffered.length
                    ? video.buffered.end(video.buffered.length - 1)
                    : null;
            if (live !== null && live - video.currentTime > MAX_DRIFT_SECONDS) {
                video.currentTime = live - 1;
            }
            if (video.paused) video.play().catch(() => undefined);
        };

        const driftTimer = setInterval(nudgeNative, 5000);
        teardown = () => {
            clearInterval(driftTimer);
            video.removeAttribute("src");
            video.load();
        };
      } else {
        setError("Browser tidak mendukung pemutaran siaran ini");
        setLoading(false);
      }
    };

    // Minta izin menonton lebih dulu. Middleware menolak setiap permintaan ke
    // proxy media yang tidak membawa grant, termasuk segmen HLS.
    setLoading(true);
    (async () => {
        const access = await requestStreamAccess(streamName).catch(() => ({
            ok: false,
            reason: "Gagal meminta izin siaran",
        }));
        if (cancelled) return;

        if (!access.ok) {
            setError(access.reason ?? "Tidak punya akses ke kamera ini");
            setLoading(false);
            return;
        }

        if (transport === "webrtc" && typeof RTCPeerConnection !== "undefined") {
            startWebRTC();
        } else {
            startHLS();
        }
    })();

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      // Simpan rekaman yang sedang berjalan sebelum stream dibongkar.
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      teardown();
      video.pause();
    };
  }, [streamName, isPlaying, active, transport, reconnectNonce, showNotice]);

  useEffect(() => () => {
      if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      if (noticeTimeoutRef.current) clearTimeout(noticeTimeoutRef.current);
  }, []);

  const handlePlay = () => {
      // Jatah sambung-ulang otomatis dihitung per sesi tontonan, bukan per umur
      // komponen. Kalau tidak, kartu yang sudah pernah menyerah pada latensi
      // tidak akan pernah mencobanya lagi walau ditekan play berkali-kali.
      latencyReconnectsRef.current = 0;
      setTransport(initialTransport);
      setIsPlaying(true);
  };

  const handleStop = (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      setIsPlaying(false);
      setLoading(false);
      setError(null);
      setZoom(1);
  };

  const handleRetry = (e: React.MouseEvent) => {
      e.stopPropagation();
      latencyReconnectsRef.current = 0;
      setError(null);
      setLoading(true);
      setTransport(initialTransport);
      // Paksa effect berjalan ulang walau transport-nya sama.
      setIsPlaying(false);
      setTimeout(() => setIsPlaying(true), 50);
  };

  /* ======================
     CAPTURE — simpan frame sebagai PNG di perangkat pengguna
  ====================== */
  const handleCapture = (e: React.MouseEvent) => {
      e.stopPropagation();
      revealControls();

      const video = videoRef.current;
      if (!video?.videoWidth) {
          showNotice("Siaran belum siap");
          return;
      }

      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;

      const context = canvas.getContext("2d");
      if (!context) {
          showNotice("Gagal mengambil gambar");
          return;
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
          if (!blob) {
              showNotice("Gagal mengambil gambar");
              return;
          }
          saveToDevice(blob, `cctv-${streamName}-${fileStamp()}.png`);
          showNotice("Gambar tersimpan");
      }, "image/png");
  };

  /* ======================
     RECORD — rekam ke perangkat pengguna, tidak ada upload ke server
  ====================== */
  const getRecordableStream = (): MediaStream | null => {
      const video = videoRef.current as CapturableVideo | null;
      if (!video) return null;
      // WebRTC: MediaStream-nya sudah ada. HLS: ambil dari elemen video.
      if (video.srcObject instanceof MediaStream) return video.srcObject;
      return video.captureStream?.() ?? video.mozCaptureStream?.() ?? null;
  };

  const startRecording = () => {
      const stream = getRecordableStream();
      if (!stream) {
          showNotice("Perekaman tidak didukung browser ini");
          return;
      }

      const mimeType = pickRecordingMimeType();
      let recorder: MediaRecorder;
      try {
          recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      } catch {
          showNotice("Perekaman tidak didukung browser ini");
          return;
      }

      const chunks: Blob[] = [];
      recorder.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data);
      };

      recorder.onstop = () => {
          recordingRef.current = false;
          recorderRef.current = null;
          setIsRecording(false);
          syncActive();

          if (!chunks.length) {
              showNotice("Rekaman kosong");
              return;
          }

          const type = recorder.mimeType || mimeType || "video/webm";
          const extension = type.startsWith("video/mp4") ? "mp4" : "webm";
          saveToDevice(new Blob(chunks, { type }), `cctv-${streamName}-${fileStamp()}.${extension}`);
          showNotice("Rekaman tersimpan");
      };

      recorder.onerror = () => {
          showNotice("Perekaman gagal");
          if (recorder.state === "recording") recorder.stop();
      };

      recorderRef.current = recorder;
      recordingRef.current = true;
      setRecordSeconds(0);
      setIsRecording(true);
      recorder.start(1000);
      showNotice("Mulai merekam");
  };

  const toggleRecording = (e: React.MouseEvent) => {
      e.stopPropagation();
      revealControls();

      if (recorderRef.current?.state === "recording") {
          recorderRef.current.stop();
      } else {
          startRecording();
      }
  };

  const toggleMute = (e: React.MouseEvent) => {
      e.stopPropagation();
      if (videoRef.current) {
          videoRef.current.muted = !videoRef.current.muted;
          setIsMuted(videoRef.current.muted);
      }
  };

  const toggleFullscreen = (e?: React.MouseEvent) => {
      e?.stopPropagation();
      const container = containerRef.current;
      const video = videoRef.current as FullscreenVideo | null;
      if (!container) return;

      if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => undefined);
          return;
      }

      if (container.requestFullscreen) {
          container.requestFullscreen().catch(() => video?.webkitEnterFullscreen?.());
      } else {
          // iPhone Safari tidak mendukung Element.requestFullscreen; pemutar
          // native-nya sudah menangani rotasi landscape sendiri.
          video?.webkitEnterFullscreen?.();
      }
  };

  const handleContainerClick = () => {
      const now = Date.now();
      const DOUBLE_TAP_DELAY = 300;

      if (now - lastTapRef.current < DOUBLE_TAP_DELAY) {
          lastTapRef.current = 0;
          toggleFullscreen();
          return;
      }

      lastTapRef.current = now;
      if (showControls) {
          setShowControls(false);
          if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
      } else {
          revealControls();
      }
  };

  const adjustZoom = (e: React.MouseEvent, factor: number) => {
      e.stopPropagation();
      setZoom(prev => Math.min(Math.max(1, prev + factor), 3)); // Limit zoom 1x to 3x
      revealControls();
  };

  // Hover hanya untuk perangkat dengan pointer presisi; di layar sentuh,
  // mouseenter palsu bikin kontrol berkedip.
  const hoverProps = {
      onPointerEnter: (e: React.PointerEvent) => {
          if (e.pointerType === "mouse") revealControls();
      },
      onPointerLeave: (e: React.PointerEvent) => {
          if (e.pointerType === "mouse") setShowControls(false);
      },
  };

  // Ambang berdasarkan lebar player, bukan lebar layar.
  const measured = width > 0;
  const tiny = measured && width < 260;
  const compact = measured && width < 380;
  const showZoom = !measured || width >= 480;

  // Badge status: harus mencerminkan keadaan sebenarnya, bukan selalu "LIVE".
  const status = error ? "offline" : loading ? "connecting" : "live";
  const statusLabel =
      status === "offline" ? "TERPUTUS"
      : status === "connecting" ? "MENYAMBUNG"
      : transport === "hls" && !compact ? "LIVE · HLS"
      : "LIVE";
  const statusStyle =
      status === "offline" ? "bg-slate-700/90 border-slate-500"
      : status === "connecting" ? "bg-amber-500 border-amber-400"
      : "bg-red-500 border-red-400 shadow-[0_0_15px_rgba(239,68,68,0.4)]";

  const buttonSize = tiny ? "w-9 h-9" : "w-11 h-11";

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 w-full h-full bg-black overflow-hidden select-none touch-manipulation"
      onClick={handleContainerClick}
      {...hoverProps}
    >
      {/* Loading Overlay */}
      {loading && isPlaying && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 z-20 backdrop-blur-sm pointer-events-none">
          <div className="flex flex-col items-center">
            <div className="animate-spin rounded-full h-10 w-10 border-4 border-slate-700 border-t-blue-500 mb-3"></div>
            <p className="text-xs font-bold text-white tracking-wider uppercase">Menyambungkan...</p>
          </div>
        </div>
      )}

      {/* Error Overlay */}
      {error && isPlaying && (
           <div className="absolute inset-0 flex items-center justify-center bg-slate-900/90 z-20 backdrop-blur-sm pointer-events-auto">
             <div className="flex flex-col items-center gap-3 px-4 text-center">
                 <div className="w-12 h-12 rounded-full bg-red-500/20 flex items-center justify-center border border-red-500/50">
                    <svg className="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path></svg>
                 </div>
                 <p className="text-xs font-bold text-white uppercase tracking-tight">{error}</p>
                 <button onClick={handleRetry} className="text-xs font-bold text-blue-400 border border-blue-400/30 px-4 py-2 rounded-full hover:bg-blue-400/10 transition-colors uppercase tracking-widest">Coba Lagi</button>
             </div>
          </div>
      )}

      {/* Status siaran & rekaman — pojok kiri atas, selalu terlihat walau
          kontrol tersembunyi, dan mengikuti keadaan koneksi yang sebenarnya. */}
      {isPlaying && (
        <div className="absolute top-2 left-2 z-40 flex items-center gap-1.5 pointer-events-none">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${statusStyle}`}>
                <span className="relative flex h-2 w-2">
                    {status === "live" && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                    )}
                    <span className={`relative inline-flex rounded-full h-2 w-2 bg-white ${status === "connecting" ? "animate-pulse" : ""}`}></span>
                </span>
                <span className="text-[10px] font-black text-white tracking-widest uppercase whitespace-nowrap">
                    {statusLabel}
                </span>
            </div>

            {isRecording && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600 border border-red-400 shadow-lg">
                    <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
                    <span className="text-[10px] font-black text-white tracking-widest tabular-nums whitespace-nowrap">
                        REC {formatDuration(recordSeconds)}
                    </span>
                </div>
            )}
        </div>
      )}

      {/* Notifikasi singkat (capture/record) */}
      {notice && (
        <div className="absolute top-2 left-1/2 -translate-x-1/2 z-40 px-3 py-1.5 rounded-full bg-black/80 backdrop-blur text-[10px] font-bold text-white tracking-wide pointer-events-none whitespace-nowrap">
            {notice}
        </div>
      )}

      {/* Start Overlay */}
      {!isPlaying && (
           <div className="absolute inset-0 flex items-center justify-center bg-slate-100 z-20 cursor-pointer group/play overflow-hidden" onClick={handlePlay}>
               <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-white"></div>
               <div className="relative flex flex-col items-center gap-3 sm:gap-4">
                    <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-full bg-blue-600 flex items-center justify-center group-hover/play:scale-110 group-hover/play:shadow-2xl group-hover/play:shadow-blue-500/40 transition-all duration-300 shadow-xl shadow-blue-500/20">
                        <svg className="w-7 h-7 sm:w-10 sm:h-10 text-white ml-1" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    </div>
                   <p className="text-[10px] sm:text-xs font-black text-blue-600 tracking-[0.2em] uppercase">Tonton Live</p>
               </div>

               <div className="absolute -bottom-4 -right-4 w-24 h-24 bg-blue-100 rounded-full opacity-50 blur-2xl"></div>
               <div className="absolute -top-4 -left-4 w-24 h-24 bg-blue-50 rounded-full opacity-50 blur-2xl"></div>
          </div>
      )}

      <video
        ref={videoRef}
        muted={isMuted}
        playsInline
        preload="none"
        disablePictureInPicture
        className="w-full h-full object-contain pointer-events-none"
        style={{ transform: zoom === 1 ? undefined : `scale(${zoom})` }}
      />

      {/* Overlay HSE — di atas video, di bawah kontrol. Hanya hidup saat player
          benar-benar diputar dan terlihat, sama seperti dekoder videonya. */}
      {hse && (
        <HSEOverlay
          slug={streamName}
          videoRef={videoRef}
          active={isPlaying && active && !error}
          zoom={zoom}
        />
      )}

      {/* Controls Overlay */}
      {isPlaying && (
        <div className={`absolute bottom-0 left-0 right-0 ${tiny ? "p-1.5" : "p-2 sm:p-3"} bg-gradient-to-t from-black/80 to-transparent flex items-center justify-between gap-1 z-30 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
            <button aria-label="Berhenti" onClick={handleStop} className="shrink-0 text-white hover:text-red-400 transition active:scale-95 flex items-center">
                <div className={`${buttonSize} flex items-center justify-center rounded-xl bg-white/10 backdrop-blur-md border border-white/20 hover:bg-red-500/20 hover:border-red-500/40`}>
                   <StopIcon />
                </div>
            </button>

            {/* Tombol fullscreen selalu ikut, apa pun lebar player-nya —
                kontrol lain yang mengalah lebih dulu saat ruang menyempit. */}
            <div className="flex items-center gap-0.5 shrink-0">
                {showZoom && (
                    <div className="flex items-center bg-white/10 backdrop-blur rounded-lg border border-white/20 overflow-hidden mr-1">
                        <button aria-label="Perkecil" onClick={(e) => adjustZoom(e, -0.2)} className="w-9 h-11 flex items-center justify-center text-white hover:bg-white/20">-</button>
                        <span className="text-[10px] font-bold text-white w-9 text-center">{Math.round(zoom * 100)}%</span>
                        <button aria-label="Perbesar" onClick={(e) => adjustZoom(e, 0.2)} className="w-9 h-11 flex items-center justify-center text-white hover:bg-white/20">+</button>
                    </div>
                )}

                {!tiny && (
                    <button
                        aria-label="Ambil gambar"
                        title="Ambil gambar (tersimpan di perangkat)"
                        onClick={handleCapture}
                        className={`${buttonSize} flex items-center justify-center text-white hover:text-blue-400 transition active:scale-95`}
                    >
                        <CameraIcon />
                    </button>
                )}

                {!tiny && canRecord && (
                    <button
                        aria-label={isRecording ? "Hentikan rekaman" : "Rekam ke perangkat"}
                        title={isRecording ? "Hentikan & simpan rekaman" : "Rekam (tersimpan di perangkat)"}
                        onClick={toggleRecording}
                        className={`${buttonSize} flex items-center justify-center transition active:scale-95 ${isRecording ? "text-red-500" : "text-white hover:text-red-400"}`}
                    >
                        {isRecording ? <StopIcon /> : <RecordIcon />}
                    </button>
                )}

                {!compact && (
                    <button aria-label={isMuted ? "Bunyikan" : "Bisukan"} onClick={toggleMute} className={`${buttonSize} flex items-center justify-center text-white hover:text-blue-400 transition active:scale-95`}>
                        {isMuted ? <VolumeX /> : <Volume2 />}
                    </button>
                )}

                <button aria-label={isFullscreen ? "Keluar layar penuh" : "Layar penuh"} onClick={toggleFullscreen} className={`${buttonSize} flex items-center justify-center text-white hover:text-blue-400 transition active:scale-95`}>
                    {isFullscreen ? <Minimize /> : <Maximize />}
                </button>
            </div>
        </div>
      )}
    </div>
  );
}
