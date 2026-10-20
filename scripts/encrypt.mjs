// Cifra privado/gift.json y las fotos de privado/fotos/ con la contraseña.
// Escribe gift.enc.js, fotos.enc.js y adelanto.js (lo único que se publica) y actualiza las versiones en index.html.
// Uso: node scripts/encrypt.mjs <CONTRASEÑA>
import { readFile, readdir, writeFile } from "node:fs/promises";
import { webcrypto as crypto, createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

export const ITERATIONS = 250000;
const FOTOS_DIR = process.env.FOTOS_DIR ? new URL(`file:///${process.env.FOTOS_DIR.replace(/\\/g, "/")}/`) : new URL("../privado/fotos/", import.meta.url);
const IMAGE = /\.(jpe?g|png|webp|avif|heic|heif|tiff?)$/i;
const root = (name) => new URL(`../${name}`, import.meta.url);
const photoPath = (archivo) => fileURLToPath(new URL(archivo, FOTOS_DIR));

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

const gift = JSON.parse(await readFile(root("privado/gift.json"), "utf8"));

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
// Versión de cada archivo publicado: así el celular nunca mezcla un archivo viejo (en caché) con uno nuevo
const version = (text) => createHash("sha256").update(text).digest("hex").slice(0, 10);

// Fotos: achicadas para el celular y cifradas una por una
const sealedPhotos = [];
let total = 0;
for (const f of fotos) {
  const { data, info } = await sharp(photoPath(f.archivo))
    .rotate() // respeta la orientación EXIF del celular
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 76 })
    .toBuffer({ resolveWithObject: true });
  total += data.length;
  sealedPhotos.push({ w: info.width, h: info.height, type: "image/webp", ...(await seal(data)) });
}
// Scripts clásicos (no JSON + fetch) para que la página también funcione abierta como archivo local
const fotosJs = `window.FOTOS_ENC = ${JSON.stringify(sealedPhotos)};\n`;
await writeFile(root("fotos.enc.js"), fotosJs);

// "fotos" le dice a app.js qué versión de fotos.enc.js pedir
const giftSealed = await seal(enc.encode(JSON.stringify(gift)));
const out = { v: 1, iterations: ITERATIONS, salt: b64(salt), fotos: version(fotosJs), ...giftSealed };
await writeFile(root("gift.enc.js"), `window.GIFT_ENC = ${JSON.stringify(out, null, 2)};\n`);

// Adelanto para el candado: miniaturas diminutas y desenfocadas (no se reconoce a nadie), sin cifrar
const teaser = [];
for (const i of gift.adelanto ?? [0]) {
  if (!fotos[i]) continue;
  const buf = await sharp(photoPath(fotos[i].archivo)).rotate().resize(20, 20, { fit: "cover" }).blur(1.2).webp({ quality: 50 }).toBuffer();
  teaser.push(`data:image/webp;base64,${b64(buf)}`);
}
await writeFile(root("adelanto.js"), `window.ADELANTO = ${JSON.stringify(teaser)};\n`);

// index.html pide cada archivo con su versión (?v=…)
let html = await readFile(root("index.html"), "utf8");
for (const name of ["styles.css", "app.js", "gift.enc.js", "adelanto.js"]) {
  const v = version(await readFile(root(name), "utf8"));
  const escaped = name.replace(/\./g, "\\.");
  html = html.replace(new RegExp(`${escaped}(\\?v=[0-9a-f]+)?"`, "g"), `${name}?v=${v}"`);
}
await writeFile(root("index.html"), html);

console.log(`Listo. ${sealedPhotos.length} foto(s), ${(total / 1024 / 1024).toFixed(1)} MB · adelanto: ${teaser.length} · versiones actualizadas en index.html`);
