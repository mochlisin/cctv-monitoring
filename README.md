# CCTV Monitoring

Aplikasi pemantauan CCTV publik: Next.js 16 + Prisma/MySQL, dengan MediaMTX
sebagai media server (WebRTC sub-detik, LL-HLS sebagai fallback).

```
Kamera RTSP ──> MediaMTX ──WebRTC/WHEP──> Browser   (~0,3 detik)
   (LAN)           │
                   └──LL-HLS───────────> Browser   (fallback)
```

Semua trafik browser masuk lewat Next.js. MediaMTX hanya mendengarkan di
`127.0.0.1` dan tidak pernah diakses langsung dari luar.

---

## Prasyarat

| Kebutuhan | Keterangan |
|---|---|
| Node.js 20+ | |
| MySQL 8 | |
| ffmpeg | Untuk thumbnail. Cek: `ffmpeg -version` |
| MediaMTX | Dipasang lewat `npm run media:install` |
| Jaringan | Server **harus bisa menjangkau IP kamera**. Kalau kamera di LAN privat dan server di cloud, perlu VPN (WireGuard/Tailscale) |

---

## Development

```bash
npm install
cp .env.example .env      # lalu sesuaikan isinya
npx prisma generate
npx prisma migrate deploy
npx prisma db seed        # hanya untuk database baru
npm run media:install     # sekali saja

# dua terminal
npm run media
npm run dev
```

Login awal: `admin` / `admin123`. Ganti setelah login pertama.

---

## Produksi (aaPanel + Ubuntu/Debian)

### 1. Siapkan direktori & dependensi

```bash
cd /www/wwwroot
git clone <repo> cctv-monitoring
cd cctv-monitoring
npm ci
```

Pastikan versi Node di aaPanel (App Store → Node.js Version Manager) **20 ke
atas**, dan ffmpeg terpasang:

```bash
apt install -y ffmpeg
```

### 2. Database

Buat database via aaPanel → Databases. Lalu:

```bash
npx prisma generate
npx prisma migrate status    # periksa dulu
npx prisma migrate deploy
npx prisma db seed           # HANYA kalau database masih kosong
```

> **Peringatan.** Di database development yang sudah ada, `prisma migrate dev`
> mendeteksi drift antara riwayat migrasi dan kondisi tabel, lalu menawarkan
> `migrate reset` — yang **menghapus seluruh data**. Jangan pernah jalankan
> `migrate dev` di server. Gunakan `migrate deploy` saja. Kalau `migrate status`
> melaporkan masalah, selesaikan itu di database uji coba lebih dulu.

### 3. Konfigurasi `.env`

```env
DATABASE_URL="mysql://user:password@localhost:3306/cctv_monitoring?connection_limit=5"

# WAJIB diganti. String ini melindungi sesi login DAN izin menonton stream.
# Buat dengan: openssl rand -base64 48
JWT_SECRET="<acak-panjang>"

NEXT_PUBLIC_BASE_URL=https://cctv.domain-anda.id

MEDIAMTX_API_URL=http://127.0.0.1:9997
MEDIAMTX_CLOSE_AFTER=10s
MEDIAMTX_AUTO_SYNC=true

MEDIA_HLS_ORIGIN=http://127.0.0.1:8888
MEDIA_WEBRTC_ORIGIN=http://127.0.0.1:8889
MEDIA_RTSP_ORIGIN=rtsp://127.0.0.1:8554

NEXT_PUBLIC_STREAM_TRANSPORT=auto
THUMBNAIL_TTL_SECONDS=120
```

> **Variabel `NEXT_PUBLIC_*` dibekukan saat build, bukan saat start.** Isi
> `.env` sampai benar **sebelum** menjalankan `npm run build`. Mengubahnya
> setelah build tidak berpengaruh apa pun sampai di-build ulang.

### 4. MediaMTX

```bash
npm run media:install
```

Lalu edit [`mediamtx.yml`](mediamtx.yml) — satu baris yang wajib diubah:

```yaml
webrtcAdditionalHosts: [cctv.domain-anda.id]
```

Tanpa ini MediaMTX hanya mengiklankan IP lokal sebagai kandidat ICE, dan
penonton dari internet tidak akan pernah tersambung.

Jalankan sebagai service — aaPanel → App Store → **Supervisor Manager**:

| Kolom | Nilai |
|---|---|
| Name | `mediamtx` |
| Run User | `www` |
| Run Dir | `/www/wwwroot/cctv-monitoring` |
| Start Command | `/www/wwwroot/cctv-monitoring/bin/mediamtx /www/wwwroot/cctv-monitoring/mediamtx.yml` |
| Processes | `1` |

Alternatif tanpa aaPanel: [`deploy/mediamtx.service`](deploy/mediamtx.service).

### 5. Build & jalankan aplikasi

```bash
npm run build
```

aaPanel → Website → Node Project, atau PM2 Manager dengan
[`deploy/ecosystem.config.cjs`](deploy/ecosystem.config.cjs):

```bash
pm2 start deploy/ecosystem.config.cjs
pm2 save
```

> **Satu instance, mode fork — jangan cluster.** Tiap proses menjalankan
> sinkronisasi MediaMTX sendiri dan punya cache thumbnail sendiri; mode cluster
> berarti N proses men-spawn N ffmpeg untuk thumbnail yang sama.

Pastikan direktori kerja bisa ditulis (aplikasi menyimpan cache thumbnail di
`.thumbnails/`):

```bash
chown -R www:www /www/wwwroot/cctv-monitoring
```

### 6. Nginx

aaPanel → Website → (domain) → Config File. Tempel isi
[`deploy/nginx-cctv.conf`](deploy/nginx-cctv.conf), menggantikan blok
`location /` bawaan.

Dua hal yang sering salah:

1. **Jangan arahkan `/stream-proxy` atau `/webrtc-proxy` langsung ke MediaMTX.**
   Itu membypass middleware yang memeriksa izin menonton, dan kamera privat
   jadi terbuka. Semua harus lewat `127.0.0.1:3000`.
2. **Matikan `proxy_buffering` dan `proxy_cache` untuk jalur media.** Template
   reverse proxy bawaan aaPanel menyalakan keduanya; playlist HLS berubah tiap
   detik dan buffering menambah latensi.

### 7. Firewall

| Port | Protokol | Buka? | Untuk |
|---|---|---|---|
| 443 | TCP | ✅ | Web app |
| **8189** | **UDP** | ✅ | **Media WebRTC — ini yang paling sering terlupa** |
| 8189 | TCP | ✅ | Cadangan kalau jaringan penonton memblokir UDP |
| 8888, 8889, 9997, 8554 | TCP | ❌ | Sudah di-bind ke `127.0.0.1`, jangan diekspos |

Buka di aaPanel → Security **dan** di security group penyedia cloud Anda.
Firewall aaPanel default hanya membuka TCP — aturan UDP 8189 harus dibuat
manual, kalau tidak WebRTC selalu gagal dan jatuh ke HLS.

### 8. Pengaturan kamera

Ini di luar kode, tapi paling berpengaruh ke kualitas hasil:

- **I-frame interval = fps** (keyframe tiap 1 detik). Kalau kamera mengirim
  keyframe tiap 4 detik, thumbnail pertama butuh ~4 detik dan segmen LL-HLS
  tidak akan pernah lebih pendek dari 4 detik betapapun kecil setelannya.
- **Substream H.264**, bukan H.265 — sebagian besar browser tidak bisa memutar
  H.265 lewat WebRTC.
- Substream ~512×288 sampai 704×576, 10–15 fps, cap bitrate ~512 kbps.

Isi kolom alamat kamera dengan **URL RTSP lengkap**, misalnya
`rtsp://user:pass@10.5.41.18:554/h264/ch1/sub/av_stream`.

### 9. HSE monitoring (opsional)

Sampai langkah 8 aplikasinya sudah utuh dan berfungsi. Kalau ingin deteksi
pemakaian helm dan rompi, lanjutkan ke [HSE Monitoring →
Produksi](#produksi-1) — ada satu service tambahan di Supervisor, satu berkas
model, dan satu migrasi database. Melewatinya tidak merusak apa pun: halaman
`/admin/hse` hanya akan menampilkan peringatan "worker tidak berjalan".

---

## Verifikasi setelah deploy

```bash
# 1. MediaMTX hidup dan path tersinkron dengan database
curl -s http://127.0.0.1:9997/v3/config/paths/list | head -c 300

# 2. Port media terbuka dari luar (jalankan dari mesin lain)
nc -vzu <ip-server> 8189

# 3. Thumbnail jalan
curl -o /dev/null -w "%{http_code} %{time_total}s\n" https://cctv.domain-anda.id/thumbnail/<slug>

# 4. Kontrol akses bekerja — harus 403, bukan 200
curl -o /dev/null -w "%{http_code}\n" https://cctv.domain-anda.id/stream-proxy/cctv_<slug>/index.m3u8
```

Yang nomor 4 penting: tanpa grant, permintaan langsung ke proxy media harus
ditolak. Kalau jawabannya 200, berarti Nginx melewati Next dan langsung menuju
MediaMTX — periksa lagi langkah 6.

Di browser, badge di pojok kiri atas video menunjukkan jalur yang dipakai:
**LIVE** berarti WebRTC, **LIVE · HLS** berarti WebRTC gagal dan sedang memakai
fallback — biasanya pertanda UDP 8189 tertutup atau `webrtcAdditionalHosts`
belum diisi.

---

## HSE Monitoring (deteksi helm & rompi)

Fitur opsional: mendeteksi apakah orang di area kerja **memakai** helm dan rompi
keselamatan, mencatat pelanggarannya beserta frame bukti, dan melaporkan tingkat
kepatuhan. Warna APD ikut dicatat karena warna helm biasanya menandai peran.

```
MediaMTX ──RTSP lokal──> ffmpeg ──frame──> worker HSE ──> MySQL
 (sudah ada)              (keyframe,        (ONNX/CPU)      │
                          letterbox)                        └──> /admin/hse
                                                 │
                                                 └──API lokal──> Next ──SSE──> overlay di player
```

Worker adalah **proses terpisah** dari Next. Inferensi menahan event loop
ratusan milidetik; di dalam proses yang sama, setiap deteksi akan membekukan
setiap permintaan HTTP. Terpisah, worker yang mati hanya membuat overlay
berhenti diperbarui — halaman dan streaming tetap hidup.

### Yang membedakannya dari deteksi objek biasa

Detektor objek hanya menjawab "ada helm di frame". Helm yang tergeletak di meja
atau dijinjing di tangan menghasilkan kotak yang sama persis dengan helm yang
dipakai — dan sistem yang berhenti di situ akan melaporkan kepatuhan 100% di
lokasi yang seluruh pekerjanya bertelanjang kepala. Dua lapis penjagaannya:

1. **Kelas negatif.** Model memakai kelas `NO-Hardhat` yang menandai kepala
   telanjang. "Tidak memakai helm" jadi sesuatu yang benar-benar terlihat,
   bukan disimpulkan dari ketiadaan bukti.
2. **Geometri.** Kotak APD harus jatuh di bagian tubuh yang benar dari orang
   yang sama — helm di sepertiga atas, rompi di badan. Helm yang dijinjing
   setinggi pinggang tetap terdeteksi, tapi tidak pernah dihitung dipakai.

Aturan ini diuji: `npm run hse:test` (tanpa model, kamera, atau database).

### Biaya, sebelum Anda menyalakannya

| Hal | Konsekuensi |
|---|---|
| Kamera HSE ditarik **terus-menerus** | `sourceOnDemand` MediaMTX tidak berlaku untuknya. Beban tetap ke kamera dan jaringan — tidak bisa dihindari, pemantauan keselamatan yang hanya jalan saat ditonton bukan pemantauan |
| ~0,5 detik CPU per inferensi | Pada `HSE_INTERVAL_SECONDS=5` dan 3 kamera ≈ 10–20% satu vCPU |
| RAM | ~350 MB untuk worker, ~30 MB per ffmpeg kamera |
| Batas kamera | `HSE_MAX_CAMERAS` (bawaan 3). Melewatinya **tidak memunculkan error** — deteksi diam-diam tertinggal beberapa menit. Batasnya ditegakkan di admin dan di worker |

Kalau inferensi melambat, worker menaikkan intervalnya sendiri sampai
`HSE_MAX_INTERVAL_SECONDS` — mengalah pada beban server alih-alih ikut
menyeretnya turun.

### Pemasangan

**1. Model.** Bobot `.onnx` tidak ikut di repositori. Ekspor sekali di mesin
pengembang (server tidak perlu Python sama sekali):

```bash
pip install ultralytics
yolo export model=<bobot-ppe-anda>.pt format=onnx imgsz=480 opset=12 simplify=True
```

Bobot PPE siap pakai yang umum: hasil latihan YOLO pada dataset Roboflow
*Construction Site Safety* (css-data) atau SH17. Salin hasilnya ke
`models/ppe.onnx`. Atau unduh dari URL Anda sendiri:

```bash
npm run hse:model -- https://...
```

> **`imgsz` saat ekspor harus sama dengan `HSE_INPUT_SIZE`.** Ekspor YOLO
> menghasilkan graf berukuran tetap; model `imgsz=640` yang diberi masukan 480
> ditolak ONNX Runtime saat start.

**2. Daftar kelas.** Samakan `models/ppe.classes.json` dengan urutan kelas saat
latihan (kunci `names` di `data.yaml`). Ini yang paling sering salah dan paling
sulit disadari: **urutan yang keliru tidak memunculkan error**, ia memunculkan
deteksi yang meyakinkan tapi salah label — `vehicle` dilaporkan sebagai orang
tanpa helm. Nama tidak perlu persis; `helmet`, `no_helmet`, dan `head` juga
dikenali.

**3. Migrasi & jalankan.**

```bash
npx prisma migrate deploy
npm run hse
```

**4. Nyalakan per kamera** di `/admin/hse` → tab **Kamera**. Di situ juga diatur
APD apa yang diwajibkan (beberapa area hanya wajib rompi) dan berapa lama
pelanggaran harus bertahan sebelum dicatat.

### Produksi

PM2: blok `cctv-hse` sudah ada di
[`deploy/ecosystem.config.cjs`](deploy/ecosystem.config.cjs). Tanpa PM2:
[`deploy/cctv-hse.service`](deploy/cctv-hse.service) — unit-nya sengaja diberi
`Nice=10` dan `CPUWeight=30` supaya deteksi APD selalu mengalah pada streaming.

Di aaPanel → App Store → **Supervisor Manager** → Add Daemon:

| Kolom | Nilai |
|---|---|
| Name | `cctv-hse` |
| Run User | `www` — **harus sama dengan pemilik direktori situs**, worker menulis snapshot ke `.hse/` |
| Run Dir | `/www/wwwroot/cctv-monitoring` |
| Start Command | `node hse/index.mjs` |
| Processes | `1` |

**Satu instance saja.** Dua worker akan menganalisis kamera yang sama dua kali
dan saling menimpa event yang sedang terbuka.

Tiga hal yang menggagalkan langkah ini di aaPanel, semuanya dengan pesan error
yang tidak menunjuk ke penyebabnya:

1. **`node` tidak ditemukan.** Supervisor tidak memakai PATH yang sama dengan
   shell Anda. Kalau gagal, isi Start Command dengan path absolutnya:

   ```bash
   which node    # mis. /www/server/nodejs/v20.19.0/bin/node
   ```

   lalu pakai `/www/server/nodejs/v20.19.0/bin/node hse/index.mjs`.

2. **`node_modules` disalin dari mesin lain.** `onnxruntime-node` berisi binary
   native per-platform. Wajib `npm ci` **di server**, bukan hasil salinan dari
   laptop Windows.

3. **Izin tulis snapshot.** Sekali saja setelah deploy pertama:

   ```bash
   mkdir -p /www/wwwroot/cctv-monitoring/.hse
   chown -R www:www /www/wwwroot/cctv-monitoring/.hse
   ```

Worker membaca `.env` dari Run Dir sendiri, jadi tidak ada variabel yang perlu
diisi ulang di Supervisor. Variabel yang sudah ada di environment tetap menang
atas isi `.env`.

Tidak ada port baru yang perlu dibuka di firewall — worker hanya mendengarkan di
`127.0.0.1:9998`, dan Next satu-satunya yang memanggilnya. Nginx juga tidak
perlu disentuh lagi kalau Anda sudah menempelkan
[`deploy/nginx-cctv.conf`](deploy/nginx-cctv.conf) di langkah 6: blok
`/hse/live/` untuk aliran SSE sudah ada di dalamnya.

### Batas yang perlu diketahui

- **Overlay tidak sinkron dengan video, dan tidak bisa dibuat sinkron.** Worker
  menganalisis satu frame tiap beberapa detik. Kotaknya diberi label umur dan
  memudar saat basi — sengaja, karena kotak yang meluncur mulus akan meyakinkan
  operator bahwa sistem melihat setiap detik.
- **Warna tidak terbaca saat kamera mode malam (inframerah).** Frame monokrom
  terdeteksi dan warnanya tidak dilaporkan sama sekali, bukan dilaporkan
  "abu-abu" — kalau tidak, shift malam akan tampak memakai helm berbeda.
- **Tidak ada pelacakan identitas.** "5 orang" berarti lima deteksi orang, bukan
  lima orang unik. Sistem ini sengaja tidak menyimpan wajah siapa pun.
- **Snapshot memuat orang yang dapat dikenali.** Disimpan di luar `public/` dan
  dilayani route handler yang memeriksa sesi. Jangan pindahkan ke `public/`.
- **Model bawaan belum pernah melihat lokasi Anda.** Akurasi awal biasanya
  85–90%. Tandai salah deteksi di tab Kejadian: event `FALSE_POSITIVE` keluar
  dari statistik kepatuhan, dan kumpulan snapshot-nya adalah bahan untuk
  melatih ulang model dengan data lokasi sendiri.

### Verifikasi

```bash
# 1. Worker hidup dan modelnya termuat
curl -s http://127.0.0.1:9998/health | head -c 400

# 2. Uji logika (tidak butuh model/kamera)
npm run hse:test

# 3. Snapshot terlindungi — harus 401, bukan 200
curl -o /dev/null -w "%{http_code}\n" https://cctv.domain-anda.id/hse/snapshot/2026-01-01/1-1.jpg
```

Kalau `/health` menjawab tapi semua kamera `"online": false`, sumbernya bukan
HSE — periksa MediaMTX dan jangkauan jaringan ke kamera lebih dulu.

---

## Perintah

| Perintah | Fungsi |
|---|---|
| `npm run dev` | Development server |
| `npm run build` | Build produksi (membekukan variabel `NEXT_PUBLIC_*`) |
| `npm run start` | Jalankan hasil build |
| `npm run media` | Jalankan MediaMTX dengan `mediamtx.yml` |
| `npm run media:install` | Unduh binary MediaMTX ke `bin/` |
| `npm run hse` | Jalankan worker HSE |
| `npm run hse:model` | Pasang bobot model PPE ke `models/` |
| `npm run hse:test` | Uji mandiri logika HSE (tanpa model/kamera/database) |
| `npm run lint` | ESLint |

## Struktur

| Path | Isi |
|---|---|
| [`actions/`](actions/) | Server actions — aplikasi ini tidak punya API route untuk data |
| [`actions/stream.ts`](actions/stream.ts) | Control plane MediaMTX + penerbitan izin menonton |
| [`lib/streamAccess.ts`](lib/streamAccess.ts) | Grant bertanda tangan (dipakai middleware, Edge-safe) |
| [`middleware.ts`](middleware.ts) | Gerbang akses proxy media + proteksi area admin |
| [`app/thumbnail/[slug]/`](app/thumbnail/) | Endpoint thumbnail (butuh URL, jadi route handler) |
| [`mediamtx.yml`](mediamtx.yml) | Konfigurasi media server |
| [`hse/`](hse/) | Worker HSE — proses terpisah, satu-satunya yang menafsirkan piksel |
| [`hse/assess.mjs`](hse/assess.mjs) | Aturan "APD ini dipakai atau tidak" — inti fitur HSE |
| [`lib/hse.ts`](lib/hse.ts) | Kosakata HSE untuk sisi aplikasi (tanpa logika deteksi) |
| [`app/hse/`](app/hse/) | Aliran deteksi (SSE) dan penyajian frame bukti |
| [`deploy/`](deploy/) | Unit systemd, konfigurasi PM2, dan snippet Nginx |
