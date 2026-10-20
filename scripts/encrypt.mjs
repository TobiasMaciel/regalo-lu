// Cifra privado/gift.json con la contraseña y escribe gift.enc.json (lo único que se publica).
// Uso: node scripts/encrypt.mjs <CONTRASEÑA>
import { readFile, writeFile } from "node:fs/promises";
import { webcrypto as crypto } from "node:crypto";

export const ITERATIONS = 250000;

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

const plaintext = await readFile(new URL("../privado/gift.json", import.meta.url), "utf8");
JSON.parse(plaintext); // valida antes de cifrar

const enc = new TextEncoder();
const salt = crypto.getRandomValues(new Uint8Array(16));
const iv = crypto.getRandomValues(new Uint8Array(12));
const baseKey = await crypto.subtle.importKey("raw", enc.encode(normalizePassword(password)), "PBKDF2", false, ["deriveKey"]);
const key = await crypto.subtle.deriveKey(
  { name: "PBKDF2", salt, iterations: ITERATIONS, hash: "SHA-256" },
  baseKey,
  { name: "AES-GCM", length: 256 },
  false,
  ["encrypt"]
);
const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plaintext)));

const b64 = (u8) => Buffer.from(u8).toString("base64");
const out = { v: 1, iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(ciphertext) };
await writeFile(new URL("../gift.enc.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
console.log("gift.enc.json generado.");
