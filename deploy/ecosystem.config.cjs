/**
 * Konfigurasi PM2 untuk aaPanel (Website -> Node Project, atau PM2 Manager).
 *
 * Sesuaikan `cwd` dengan direktori situs Anda di aaPanel.
 */
module.exports = {
    apps: [
        /**
         * MediaMTX — media server. Harus hidup lebih dulu dari yang lain.
         *
         * Aplikasi ini tidak pernah menyentuh kamera secara langsung: Next
         * mendorong daftar path ke MediaMTX lewat Control API, thumbnail
         * membaca RTSP lokalnya, dan worker HSE mengambil frame dari sana juga.
         * Tanpa MediaMTX, ketiganya gagal sekaligus — dan gejalanya menyesatkan,
         * karena yang terlihat adalah thumbnail 503 dan daftar path kosong,
         * bukan pesan "media server mati".
         *
         * Ini binary, bukan skrip Node, jadi `interpreter: "none"` wajib —
         * tanpanya PM2 akan mencoba menjalankannya dengan `node` dan gagal
         * dengan galat sintaks yang membingungkan.
         */
        {
            name: "mediamtx",
            cwd: "/www/wwwroot/cctv-monitoring",
            script: "./bin/mediamtx",
            args: "./mediamtx.yml",
            interpreter: "none",

            // Satu instance. Dua MediaMTX akan berebut port yang sama, dan yang
            // kalah mati diam-diam lalu di-restart terus oleh PM2.
            instances: 1,
            exec_mode: "fork",

            autorestart: true,
            restart_delay: 5000,
            time: true,
        },

        /**
         * Worker HSE — proses terpisah, dan itu bukan kerapian melainkan
         * pembatas kerusakan. Inferensi menahan event loop ratusan milidetik;
         * di dalam proses Next, setiap deteksi akan membekukan setiap
         * permintaan HTTP yang sedang berjalan. Terpisah, worker yang mati
         * hanya berarti overlay berhenti diperbarui — halaman dan streaming
         * tetap hidup.
         *
         * Hapus blok ini kalau HSE tidak dipakai; tidak ada yang bergantung
         * padanya selain halaman /admin/hse (yang akan menampilkan peringatan
         * "worker tidak berjalan", bukan gagal).
         */
        {
            name: "cctv-hse",
            cwd: "/www/wwwroot/cctv-monitoring",
            script: "hse/index.mjs",

            // Satu instance. Dua worker akan menganalisis kamera yang sama dua
            // kali dan saling menimpa event yang sedang terbuka.
            instances: 1,
            exec_mode: "fork",

            env: {
                NODE_ENV: "production",
            },

            autorestart: true,
            // ONNX Runtime memegang arena memorinya sendiri; 700 MB sudah jauh
            // di atas pemakaian wajar model nano pada 480 piksel (~350 MB).
            max_memory_restart: "700M",
            // Model gagal dimuat berarti berkasnya salah, dan mencoba ulang
            // secepat mungkin hanya membanjiri log. Beri jeda.
            restart_delay: 5000,
            time: true,
        },
    ],
};
