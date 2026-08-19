/**
 * Membaca dimensi JPEG langsung dari byte-nya.
 *
 * Dipakai route thumbnail untuk tahu rasio frame kamera. Alternatifnya menjalankan
 * ffprobe, tapi itu berarti satu proses tambahan per kamera per siklus thumbnail —
 * padahal buffer JPEG-nya sudah ada di tangan dan dimensinya tertulis di dalamnya.
 *
 * Yang dibaca hanya header segmen, bukan data gambar, jadi biayanya beberapa
 * puluh byte pertama saja.
 */

/** Marker yang berdiri sendiri tanpa segmen panjang: SOI, EOI, TEM, RST0-7. */
function isStandalone(marker: number): boolean {
    return marker === 0xd8 || marker === 0xd9 || marker === 0x01 ||
        (marker >= 0xd0 && marker <= 0xd7);
}

/**
 * Start Of Frame — satu-satunya segmen yang memuat dimensi. Rentang C0-CF, tapi
 * tiga di antaranya bukan SOF: C4 (Huffman table), C8 (extension), CC (arithmetic
 * coding table). Ketiganya punya struktur berbeda dan akan menghasilkan angka
 * sampah kalau ikut dibaca.
 */
function isStartOfFrame(marker: number): boolean {
    return marker >= 0xc0 && marker <= 0xcf &&
        marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

export function readJpegSize(buf: Buffer): { width: number; height: number } | null {
    if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;

    let offset = 2;
    while (offset + 3 < buf.length) {
        if (buf[offset] !== 0xff) return null;

        // Padding antar segmen boleh berupa 0xFF berulang.
        let marker = buf[offset + 1];
        while (marker === 0xff && offset + 2 < buf.length) {
            offset += 1;
            marker = buf[offset + 1];
        }

        if (isStandalone(marker)) {
            offset += 2;
            continue;
        }

        const length = buf.readUInt16BE(offset + 2);
        // Panjang segmen sudah termasuk dua byte panjang itu sendiri; di bawah 2
        // berarti berkasnya rusak dan penelusuran tidak akan pernah maju.
        if (length < 2) return null;

        if (isStartOfFrame(marker)) {
            if (offset + 9 > buf.length) return null;
            return {
                height: buf.readUInt16BE(offset + 5),
                width: buf.readUInt16BE(offset + 7),
            };
        }

        offset += 2 + length;
    }

    return null;
}
