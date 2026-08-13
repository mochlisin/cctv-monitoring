/**
 * Jalankan MediaMTX dengan konfigurasi proyek (mediamtx.yml).
 * Mencari binary di ./bin lebih dulu, lalu jatuh ke PATH.
 */
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const binaryName = process.platform === "win32" ? "mediamtx.exe" : "mediamtx";
const localBinary = path.join(ROOT, "bin", binaryName);
const command = fs.existsSync(localBinary) ? localBinary : "mediamtx";
const configPath = path.join(ROOT, "mediamtx.yml");

if (!fs.existsSync(configPath)) {
    console.error(`Konfigurasi tidak ditemukan: ${configPath}`);
    process.exit(1);
}

const child = spawn(command, [configPath], { stdio: "inherit", cwd: ROOT });

child.on("error", (err) => {
    if (err.code === "ENOENT") {
        console.error("MediaMTX belum terpasang.");
        console.error("Pasang dengan: npm run media:install");
    } else {
        console.error(err);
    }
    process.exit(1);
});

child.on("close", (code) => process.exit(code ?? 0));
