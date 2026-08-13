/**
 * Unduh binary MediaMTX resmi ke folder ./bin.
 * Jalankan sekali dengan: npm run media:install
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const BIN_DIR = path.join(ROOT, "bin");

const OS_MAP = { win32: "windows", darwin: "darwin", linux: "linux" };
const ARCH_MAP = { x64: "amd64", arm64: "arm64", arm: "armv7" };

const targetOs = OS_MAP[process.platform];
const targetArch = ARCH_MAP[process.arch];

if (!targetOs || !targetArch) {
    console.error(`Platform tidak didukung: ${process.platform}/${process.arch}`);
    console.error("Unduh manual dari https://github.com/bluenviron/mediamtx/releases");
    process.exit(1);
}

const RELEASE_API = "https://api.github.com/repos/bluenviron/mediamtx/releases/latest";

console.log(`🔎 Mencari rilis MediaMTX untuk ${targetOs}/${targetArch}...`);

const release = await fetch(RELEASE_API, {
    headers: { "User-Agent": "cctv-publik-installer", Accept: "application/vnd.github+json" },
}).then((r) => {
    if (!r.ok) throw new Error(`GitHub API ${r.status}`);
    return r.json();
});

const asset = release.assets?.find((a) => a.name.includes(`_${targetOs}_${targetArch}.`));
if (!asset) {
    console.error(`Tidak ada asset untuk ${targetOs}_${targetArch} di rilis ${release.tag_name}`);
    console.error("Daftar asset:", release.assets?.map((a) => a.name).join(", "));
    process.exit(1);
}

console.log(`⬇️  ${release.tag_name} — ${asset.name} (${Math.round(asset.size / 1048576)} MB)`);

const archivePath = path.join(os.tmpdir(), asset.name);
const response = await fetch(asset.browser_download_url, {
    headers: { "User-Agent": "cctv-publik-installer" },
});
if (!response.ok) {
    console.error(`Gagal mengunduh: HTTP ${response.status}`);
    process.exit(1);
}
fs.writeFileSync(archivePath, Buffer.from(await response.arrayBuffer()));

fs.mkdirSync(BIN_DIR, { recursive: true });

// bsdtar (bawaan Windows 10+, macOS, dan sebagian besar distro Linux) bisa
// membuka .zip maupun .tar.gz dengan perintah yang sama.
const extract = spawnSync("tar", ["-xf", archivePath, "-C", BIN_DIR], { stdio: "inherit" });
if (extract.status !== 0) {
    console.error(`Gagal mengekstrak. Ekstrak manual: ${archivePath} -> ${BIN_DIR}`);
    process.exit(1);
}

fs.rmSync(archivePath, { force: true });

const binary = path.join(BIN_DIR, targetOs === "windows" ? "mediamtx.exe" : "mediamtx");
if (!fs.existsSync(binary)) {
    console.error(`Binary tidak ditemukan setelah ekstraksi: ${binary}`);
    process.exit(1);
}
if (targetOs !== "windows") fs.chmodSync(binary, 0o755);

// Config bawaan dari arsip tidak dipakai — kita punya mediamtx.yml sendiri.
fs.rmSync(path.join(BIN_DIR, "mediamtx.yml"), { force: true });

console.log(`✅ Terpasang di ${binary}`);
console.log("   Jalankan dengan: npm run media");
