/**
 * Konfigurasi PM2 untuk aaPanel (Website -> Node Project, atau PM2 Manager).
 *
 * Sesuaikan `cwd` dengan direktori situs Anda di aaPanel.
 */
module.exports = {
    apps: [
        {
            name: "cctv-monitoring",
            cwd: "/www/wwwroot/cctv-monitoring",
            script: "node_modules/next/dist/bin/next",
            args: "start",

            // WAJIB satu instance, mode fork — JANGAN cluster.
            //
            // Tiap proses menjalankan sinkronisasi path MediaMTX sendiri
            // (instrumentation.ts) dan punya map dedupe thumbnail sendiri.
            // Mode cluster berarti N proses menembak MediaMTX bersamaan dan
            // men-spawn N ffmpeg untuk satu thumbnail yang sama.
            instances: 1,
            exec_mode: "fork",

            env: {
                NODE_ENV: "production",
                PORT: "3000",
                // Hanya dengarkan localhost; Nginx yang menghadap internet.
                HOSTNAME: "127.0.0.1",
            },

            autorestart: true,
            max_memory_restart: "1G",
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
