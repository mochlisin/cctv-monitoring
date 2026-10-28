// Membuat database dari DATABASE_URL bila belum ada.
// Koneksi dibuka tanpa memilih database, lalu CREATE DATABASE IF NOT EXISTS.
import mysql from "mysql2/promise";

const url = new URL(process.env.DATABASE_URL);
const dbName = decodeURIComponent(url.pathname.replace(/^\//, ""));

if (!/^[A-Za-z0-9_]+$/.test(dbName)) {
  console.error(`ensure-db: nama database tidak valid: "${dbName}"`);
  process.exit(1);
}

let conn;
try {
  conn = await mysql.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
  });
  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  console.log(`ensure-db: database "${dbName}" siap.`);
} catch (err) {
  if (err.code === "ER_DBACCESS_DENIED_ERROR" || err.code === "ER_ACCESS_DENIED_ERROR") {
    // User tidak punya hak CREATE; db push yang akan menentukan apakah database sudah ada.
    console.warn(`ensure-db: user tidak punya hak CREATE DATABASE (${err.code}). Lewati.`);
    process.exit(0);
  }
  console.error(`ensure-db: gagal terhubung/membuat database: ${err.code || err.message}`);
  process.exit(1);
} finally {
  if (conn) await conn.end();
}
