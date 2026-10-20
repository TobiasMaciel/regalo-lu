// Cifra privado/gift.json y las fotos de privado/fotos/ con la contraseña.
// Escribe gift.enc.js y fotos.enc.js (lo único que se publica).
// Uso: node scripts/encrypt.mjs <CONTRASEÑA>
import { readFile, readdir, writeFile } from "node:fs/promises";
import { webcrypto as crypto } from "node:crypto";
import sharp from "sharp";

export const ITERATIONS = 250000;
const FOTOS_DIR = process.env.FOTOS_DIR ? new URL(`file:///${process.env.FOTOS_DIR.replace(/\\/g, "/")}/`) : new URL("../privado/fotos/", import.meta.url);
const IMAGE = /\.(jpe?g|png|webp|avif|heic|heif|tiff?)$/i;

// Debe coincidir con normalizePassword() en app.js
export function normalizePassword(raw) {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

const password = process.argv[2];
if (!password) {
  console.error("Uso: node scripts/encrypt.mjs <CONTRASEÑA>");
  process.exit(1);
}

const gift = JSON.parse(await readFile(new URL("../privado/gift.json", import.meta.url), "utf8"));

// Fotos: si gift.json trae "fotos": [{ "archivo": "...", "texto": "..." }] se respeta ese orden;
// si no, entran todas las de la carpeta ordenadas por nombre.
let files = [];
try {
  files = (await readdir(FOTOS_DIR)).filter((f) => IMAGE.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
} catch {}
const fotos = Array.isArray(gift.fotos)
  ? gift.fotos.map((f) => (typeof f === "string" ? { archivo: f } : f))
  : files.map((archivo) => ({ archivo }));
for (const f of fotos) {
  if (!files.includes(f.archivo)) throw new Error(`No encuentro la foto "${f.archivo}" en privado/fotos/`);
}
gift.fotos = fotos.map((f) => ({ texto: f.texto ?? "" }));

const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const baseKey = await crypto.subtle.importKey("raw", enc.encode(normalizePassword(password)), "PBKDF2", false, ["deriveKey"]);
const key = await crypto.subtle.deriveKey(
  { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
  baseKey,
  { name: "AES-GCM", length: 256 },
  false,
  ["encrypt"]
);
const b64 = (u8) => Buffer.from(u8).toString("base64");
async function seal(bytes) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, bytes));
  return { iv: b64(iv), data: b64(data) };
}

const giftSealed = await seal(enc.encode(JSON.stringify(gift)));
const out = { v: 1, iterations: ITERATIONS, salt: b64(salt), ...giftSealed };
// Scripts clásicos (no JSON + fetch) para que la página también funcione abierta como archivo local
await writeFile(new URL("../gift.enc.js", import.meta.url), `window.GIFT_ENC = ${JSON.stringify(out, null, 2)};\n`);

const sealedPhotos = [];
let total = 0;
for (const f of fotos) {
  const { data, info } = await sharp(new URL(f.archivo, FOTOS_DIR).pathname.replace(/^\/([A-Za-z]:)/, "$1"))
    .rotate() // respeta la orientación EXIF del celular
    .resize({ width: 1400, height: 1400, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer({ resolveWithObject: true });
  total += data.length;
  sealedPhotos.push({ w: info.width, h: info.height, type: "image/webp", ...(await seal(data)) });
}
await writeFile(new URL("../fotos.enc.js", import.meta.url), `window.FOTOS_ENC = ${JSON.stringify(sealedPhotos)};\n`);

console.log(`gift.enc.js generado. fotos.enc.js: ${sealedPhotos.length} foto(s), ${(total / 1024 / 1024).toFixed(1)} MB.`);
