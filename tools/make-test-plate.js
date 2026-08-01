/* Writes a placeholder PNG, so the plate-image path can be exercised without
   any image tooling installed and without hunting down real artwork first.

   Usage:  node tools/make-test-plate.js assets/plates/jungle-S.png 120 40 40

   Then switch on Menu -> Card backs -> Plate images. Delete the file to get
   the drawn plate back. See assets/plates/README.md for the real thing. */
const zlib = require('zlib');
const fs = require('fs');

function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = c ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makePng(w, h, rgb, file) {
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const row = y * (1 + w * 3);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const i = row + 1 + x * 3;
      const band = (x + y) % 40 < 20 ? 0 : 30;      // visible diagonal banding
      raw[i] = Math.min(255, rgb[0] + band);
      raw[i + 1] = Math.min(255, rgb[1] + band);
      raw[i + 2] = Math.min(255, rgb[2] + band);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
  fs.writeFileSync(file, png);
  return png.length;
}
const [,, out, r, g, b] = process.argv;
console.log(out, makePng(200, 290, [+r, +g, +b], out), 'bytes');
