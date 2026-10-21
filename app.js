// Regalo para Lu — todo el contenido del regalo llega cifrado en gift.enc.js (y las fotos en
// fotos.enc.js) y solo se puede leer con la palabra escondida en la carta.
(() => {
"use strict";

const LEN = 6;
const STORE_KEY = "regalo-lu:v2";
const TZ = "America/Argentina/Buenos_Aires";
const TURN_MS = 1150;
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const $ = (sel, root = document) => root.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, reduceMotion ? Math.min(ms, 80) : ms));
const vibrate = (pattern) => { try { navigator.vibrate?.(pattern); } catch {} };

function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v; // solo para íconos SVG propios
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  node.append(...children.flat().filter((c) => c != null));
  return node;
}

const store = {
  get() { try { return JSON.parse(sessionStorage.getItem(STORE_KEY)); } catch { return null; } },
  set(value) { try { sessionStorage.setItem(STORE_KEY, JSON.stringify(value)); } catch {} },
};

// { gift, key, revealed, answered, page } — se guarda en la sesión para sobrevivir a una recarga
let state = null;
const save = (patch) => { Object.assign(state, patch); store.set(state); hud.refresh(); };

/* ───────── Cifrado (espejo de scripts/encrypt.mjs) ───────── */

// Mayúsculas/minúsculas, tildes y espacios no importan
function normalizePassword(raw) {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();
}

const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

class NetworkError extends Error {}

async function decryptGift(password) {
  const enc = window.GIFT_ENC; // definido por gift.enc.js
  if (!enc) throw new NetworkError("gift.enc.js no cargó");
  const te = new TextEncoder();
  const baseKey = await crypto.subtle.importKey("raw", te.encode(normalizePassword(password)), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: fromB64(enc.salt), iterations: enc.iterations, hash: "SHA-256" },
    baseKey,
    { name: "AES-GCM", length: 256 },
    true, // exportable: se guarda en la sesión para descifrar las fotos tras recargar
    ["decrypt"]
  );
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(enc.iv) }, key, fromB64(enc.data));
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return { gift: JSON.parse(new TextDecoder().decode(plain)), key: btoa(String.fromCharCode(...raw)) };
}

// Las fotos pesan: viven en otro archivo que se carga recién después de desbloquear
let photosScript;
function loadPhotosScript() {
  photosScript ??= new Promise((resolve, reject) => {
    if (window.FOTOS_ENC) return resolve();
    // con la versión que trae el regalo: nunca se mezcla un archivo de fotos viejo (en caché) con uno nuevo
    const v = window.GIFT_ENC?.fotos ? `?v=${window.GIFT_ENC.fotos}` : "";
    document.head.append(el("script", { src: `fotos.enc.js${v}`, onload: resolve, onerror: reject }));
  });
  return photosScript;
}

async function decryptPhotos(keyB64) {
  await loadPhotosScript();
  const key = await crypto.subtle.importKey("raw", fromB64(keyB64), "AES-GCM", false, ["decrypt"]);
  const open = async (part, type) => {
    const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(part.iv) }, key, fromB64(part.data));
    return URL.createObjectURL(new Blob([buf], { type }));
  };
  // Las polaroids usan una versión liviana; la grande se descifra recién cuando hace falta (visor).
  // Si una foto falla, las demás se muestran igual (esa queda en null).
  const results = await Promise.allSettled((window.FOTOS_ENC || []).map(async (f) => {
    const url = await open(f.thumb ?? f, f.type);
    let full = null;
    return { url, w: f.w, h: f.h, full: () => (full ??= f.thumb ? open(f, f.type) : Promise.resolve(url)) };
  }));
  return results.map((r) => (r.status === "fulfilled" ? r.value : null));
}

/* ───────── El cuaderno: hojas apiladas que se pasan hacia adelante y atrás ───────── */

const bookEl = $("#book");
const book = { pages: [], index: 0, busy: false };

function makePage(cls, label) {
  const body = el("div", { class: "page__body" });
  const prev = el("button", { class: "page__turn page__turn--prev", type: "button", text: "◀ ATRÁS" });
  const next = el("button", { class: "page__turn page__turn--next", type: "button", text: "SIGUIENTE ▶" });
  const num = el("span", { class: "page__num" });
  // esquina doblada: se levanta sola cuando se puede pasar de hoja
  const corner = el("button", { class: "page__corner is-off", type: "button", "aria-label": "Pasar la hoja" });
  const section = el("section", { class: `notebook page ${cls}`, "aria-label": label },
    body, el("footer", { class: "page__foot" }, prev, num, next), corner);
  prev.addEventListener("click", () => turnTo(book.index - 1));
  next.addEventListener("click", () => turnTo(book.index + 1));
  corner.addEventListener("click", () => turnTo(book.index + 1));
  return { el: section, body, prev, next, num, corner, ready: true, onEnter: null };
}

function refreshNav() {
  const last = book.pages.length - 1;
  book.pages.forEach((p, i) => {
    p.num.textContent = `${i + 1}/${last + 1}`;
    p.prev.classList.toggle("is-off", i === 0);
    const blocked = i === last || !p.ready;
    p.next.classList.toggle("is-off", blocked);
    p.corner.classList.toggle("is-off", blocked);
  });
}

// "Seguir" aparece recién cuando la hoja se terminó (carta escrita, entrada raspada, "sí" dicho)
function setReady(page) {
  page.ready = true;
  refreshNav();
  page.next.classList.add("is-new");
  page.corner.classList.add("is-new");
}

// La hoja que queda arriba reproduce su animación de llegada (polaroids que se pegan, etc.) solo la
// primera vez; al dejarla queda marcada como vista y su contenido ya no se esconde ni se anima de nuevo.
function setCurrent(i) {
  book.pages.forEach((p, j) => {
    if (j === i) p.el.classList.add("is-current");
    else if (p.el.classList.contains("is-current")) p.el.classList.replace("is-current", "is-seen");
  });
}

// Solo se dibujan la hoja de arriba y la siguiente (y la última, que hace de canto del cuaderno):
// las demás están tapadas, y dibujarlas igual hace que el celular se quede sin memoria y parpadee.
function cull(i) {
  const last = book.pages.length - 1;
  book.pages.forEach((p, j) => p.el.classList.toggle("is-culled", j > i + 1 && j !== last));
}

// El cuaderno tiene tamaño fijo de diseño y se escala para entrar entero en la pantalla
let fitScale = 1;
const typing = () => document.activeElement?.matches?.("input") ?? false;
function fitBook() {
  if (typing()) return keepFieldVisible(); // el teclado no achica el cuaderno
  const W = 430;
  const H = 620;
  const reserve = document.documentElement.classList.contains("has-buddy") ? 92 + 40 : 0; // franjas para el personajito y el HUD
  fitScale = Math.min((innerWidth - 20) / W, (innerHeight - 28 - reserve) / H, 1.25);
  $("#fit").style.setProperty("--fit", fitScale.toFixed(4));
}

// Con el teclado abierto, el cuaderno sube lo justo para que las casillas queden a la vista
let shift = 0;
function keepFieldVisible() {
  const field = document.activeElement?.closest?.(".code__field");
  const vv = window.visualViewport;
  if (!field || !vv) return;
  const bottom = field.getBoundingClientRect().bottom - shift; // posición sin el corrimiento actual
  const visible = vv.offsetTop + vv.height;
  shift = Math.min(0, visible - bottom - 28);
  $(".stage").style.transform = shift ? `translateY(${shift}px)` : "";
}
addEventListener("focusin", (e) => {
  if (e.target.matches("input")) setTimeout(keepFieldVisible, 350);
});
addEventListener("focusout", () => {
  setTimeout(() => {
    if (typing()) return;
    shift = 0;
    $(".stage").style.transform = "";
    window.scrollTo(0, 0); // iOS a veces corre la página al enfocar
    fitBook();
  }, 100);
});
fitBook();
addEventListener("resize", fitBook);
window.visualViewport?.addEventListener("resize", fitBook);

/* Giro de hoja: 0 = abierta, 1 = dada vuelta sobre la espiral.
   Las hojas giradas siguen ocupando su lugar (solo se vuelven invisibles)
   para que el cuaderno no cambie de tamaño. */
const ROT = (p) => `perspective(2200px) rotateY(${(-180 * p).toFixed(2)}deg)`;

async function animateTurn(page, from, to, ms = TURN_MS, shade = true) {
  page.classList.remove("is-gone");
  page.style.transition = "none";
  page.style.transform = ROT(from);
  void page.offsetWidth;
  page.style.setProperty("--turn-ms", `${ms}ms`);
  page.style.transition = `transform ${ms}ms cubic-bezier(.45, 0, .25, 1)`;
  page.classList.add("is-turning");
  if (shade) page.classList.add("is-flipping");
  page.style.transform = ROT(to);
  await sleep(ms);
  page.classList.remove("is-turning", "is-flipping");
  page.style.transition = "none";
  page.classList.toggle("is-turned", to === 1);
  page.style.transform = "";
  page.style.removeProperty("--shade");
  void page.offsetWidth;
  page.style.transition = "";
  if (to === 1) page.classList.add("is-gone");
}

const turnAway = (page) => animateTurn(page, 0, 1);

async function turnTo(target, { from } = {}) {
  const { pages } = book;
  if (book.busy || target < 0 || target >= pages.length || target === book.index) return;
  const forward = target > book.index;
  if (forward && !pages[book.index].ready) return nudgeLocked();
  book.busy = true;
  cull(Math.min(book.index, target));
  setCurrent(target);
  window.Pixel ? window.Pixel.sfx("page") : paperSound.play();
  vibrate(8);
  const page = forward ? pages[book.index].el : pages[target].el;
  const start = from ?? (forward ? 0 : 1);
  const end = forward ? 1 : 0;
  const ms = from == null ? TURN_MS : Math.max(260, Math.abs(end - start) * TURN_MS);
  await animateTurn(page, start, end, ms, from == null);
  book.index = target;
  cull(target);
  hud.refresh();
  book.busy = false;
  save({ page: target });
  pages[target].onEnter?.();
}

// Si todavía no se puede pasar (falta resolver la hoja), la hoja hace un rebote en vez de no hacer nada
function nudgeLocked() {
  const page = book.pages[book.index]?.el;
  if (!page) return;
  page.classList.remove("is-locked");
  void page.offsetWidth;
  page.classList.add("is-locked");
  vibrate([20, 30, 20]);
}

// Arrastrar la hoja con el dedo: sigue al dedo en 3D y al soltar termina de girar o vuelve
(() => {
  // se puede arrastrar desde cualquier lado (fotos y botones incluidos: si fue arrastre, el toque no cuenta),
  // salvo donde el dedo ya hace otra cosa: raspar, escribir o perseguir al "No"
  const NO_DRAG = "input, .scratch, .btn--no, dialog, .runner-box";
  const clamp = (v) => Math.min(1, Math.max(0, v));
  let d = null;
  let draggedAt = -1e9; // el "click" que el navegador dispara al soltar un arrastre no debe contar como toque

  bookEl.addEventListener("pointerdown", (e) => {
    if (book.busy || !book.pages.length || e.button > 0 || e.target.closest(NO_DRAG)) return;
    d = { x0: e.clientX, y0: e.clientY, id: e.pointerId, active: false };
  });

  bookEl.addEventListener("pointermove", (e) => {
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.active) {
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) { d = null; return; } // está scrolleando
      if (Math.abs(dx) < 10) return;
      const i = book.index;
      const forward = dx < 0;
      if (forward && i < book.pages.length - 1 && !book.pages[i].ready) { d = null; nudgeLocked(); return; }
      if (forward ? i >= book.pages.length - 1 : i === 0) { d = null; return; }
      // ancho en pantalla (ya escalado), para que la hoja siga al dedo 1 a 1
      Object.assign(d, { active: true, forward, page: (forward ? book.pages[i] : book.pages[i - 1]).el, width: bookEl.offsetWidth * fitScale });
      book.busy = true;
      d.page.classList.remove("is-gone");
      d.page.classList.add("is-dragging");
      d.page.style.transition = "none";
      setCurrent(forward ? i + 1 : i - 1);
      try { bookEl.setPointerCapture(e.pointerId); } catch {}
    }
    d.p = d.forward ? clamp(-dx / d.width) : clamp(1 - dx / d.width);
    d.page.style.transform = ROT(d.p);
    d.page.style.setProperty("--shade", Math.sin(Math.PI * d.p).toFixed(3));
  });

  const end = async (e) => {
    if (!d || e.pointerId !== d.id) return;
    const drag = d;
    d = null;
    if (!drag.active || drag.p == null) { book.busy = false; return; }
    draggedAt = performance.now();
    drag.page.classList.remove("is-dragging");
    const i = book.index;
    const done = drag.forward ? drag.p > .28 : drag.p < .72;
    book.busy = false;
    if (done) {
      await turnTo(drag.forward ? i + 1 : i - 1, { from: drag.p });
    } else {
      setCurrent(i);
      book.busy = true;
      const back = drag.forward ? 0 : 1;
      await animateTurn(drag.page, drag.p, back, Math.max(220, Math.abs(back - drag.p) * TURN_MS), false);
      book.busy = false;
    }
  };
  bookEl.addEventListener("pointerup", end);
  bookEl.addEventListener("pointercancel", end);
  // si el celular pierde el toque a mitad del gesto, la hoja no queda trabada
  // (solo cuando la pierde el cuaderno: al capturarla, el elemento tocado también "la pierde" y eso es normal)
  bookEl.addEventListener("lostpointercapture", (e) => { if (e.target === bookEl) end(e); });
  bookEl.addEventListener("click", (e) => {
    if (performance.now() - draggedAt > 350) return;
    e.preventDefault();
    e.stopPropagation();
  }, true);
})();

// Sonido de papel sintetizado (sin archivos); solo suena después de que ella toque la pantalla
const paperSound = (() => {
  let ctx = null;
  addEventListener("pointerdown", () => {
    try {
      ctx ??= new (window.AudioContext || window.webkitAudioContext)();
      ctx.resume?.();
    } catch {}
  }, { once: true, capture: true });
  return {
    play() {
      if (!ctx || ctx.state !== "running") return;
      const t = ctx.currentTime;
      const dur = .42;
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) ** 2;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.Q.value = .7;
      band.frequency.setValueAtTime(900, t);
      band.frequency.exponentialRampToValueAtTime(3800, t + dur);
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(.16, t + .05);
      gain.gain.exponentialRampToValueAtTime(.001, t + dur);
      src.connect(band).connect(gain).connect(ctx.destination);
      src.start(t);
    },
  };
})();

// En la compu, el cuaderno se inclina apenas siguiendo el mouse (en el celular queda quieto)
(() => {
  if (reduceMotion || !matchMedia("(hover: hover)").matches) return;
  addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse") return;
    bookEl.style.setProperty("--ty", `${((e.clientX / innerWidth - .5) * 6).toFixed(2)}deg`);
    bookEl.style.setProperty("--tx", `${(-(e.clientY / innerHeight - .5) * 5).toFixed(2)}deg`);
  });
})();

// Dónde va cada foto a lo largo del cuaderno (índice = orden de privado/fotos por nombre).
// Las que no figuran acá van a los collages, de a 4 por hoja.
const PLAN = { letter: [0, 2], number: [3, 4], ticket: [1, 8], question: [5, 15], setlist: [13], final: 25 };

function buildBook(gift, restoring) {
  const photos = photoSlots(gift);
  const n = photos.frames.length;
  const used = new Set(gift.detalle ? [gift.detalle.foto] : []);
  const take = (idx) => [].concat(idx).filter((i) => i < n && !used.has(i)).map((i) => {
    used.add(i);
    return photos.frames[i];
  });
  const letterFrames = take(PLAN.letter);
  const numberFrames = take(PLAN.number);
  const ticketFrames = take(PLAN.ticket);
  const questionFrames = take(PLAN.question);
  const setlistFrames = take(PLAN.setlist);
  let finalFrame = take(PLAN.final)[0];
  const rest = photos.frames.filter((_, i) => !used.has(i));
  finalFrame ??= rest.pop();
  const collages = [];
  for (let i = 0; i < rest.length; i += 4) collages.push(rest.slice(i, i + 4));

  const pages = [
    letterPage(gift, letterFrames, restoring),
    gift.numero?.codigo ? numberPage(gift, numberFrames) : null,
    runnerPage(gift),
    gift.misiones?.invisible ? missionPage(gift.misiones.invisible, "invisible") : null,
    gift.detalle ? detailPage(gift, photos) : null,
    gift.misiones?.escondite ? missionPage(gift.misiones.escondite, "escondite") : null,
    gift.adivinaCancion?.rondas?.length ? songPage(gift) : null,
    gift.adivinanza ? guessPage(gift) : null,
    gift.nota ? notePage(gift) : null,
    pinataPage(gift),
    ticketPage(gift, ticketFrames),
    questionPage(gift, questionFrames),
    setlistPage(gift, setlistFrames),
    ...collages.map((frames) => photoPage(frames)),
    finalPage(gift, finalFrame),
    showPage(gift),
  ].filter(Boolean);

  // cada hoja nueva va debajo de la anterior (en el DOM, antes = más abajo)
  let above = $("#page-lock");
  for (const p of pages) {
    bookEl.insertBefore(p.el, above);
    above = p.el;
  }
  bookEl.querySelectorAll(".page").forEach((p) => p.classList.toggle("is-bottom", p === above));
  book.pages = pages;
  refreshNav();
  cull(0);
  photos.load(state.key);
  return pages;
}

/* ───────── Candado ───────── */

const NOPE = [
  "No es esa. Mirá la carta de nuevo.",
  "Tampoco. Las letras van en orden.",
  "Seguí buscando.",
  "Son seis letras, en el orden en que aparecen.",
];

function initLock() {
  const form = $("#code-form");
  const input = $("#code-input");
  const tilesBox = $("#code-tiles");
  const submit = $("#code-submit");
  const msg = $("#code-msg");
  const tiles = Array.from({ length: LEN }, (_, i) => {
    const t = el("span", { class: "tile" });
    t.style.setProperty("--i", i); // para la ola de letras al acertar
    return t;
  });
  tilesBox.append(...tiles);

  let focused = false;
  let busy = false;
  let attempts = 0;

  const hintBtn = $("#hint-btn");
  const hint = $("#lock-hint");
  hintBtn.addEventListener("click", () => {
    hint.hidden = !hint.hidden;
    hintBtn.setAttribute("aria-expanded", String(!hint.hidden));
  });

  // Un único input real: cada letra queda sí o sí en su propia casilla.
  const clean = (v) => normalizePassword(v).replace(/[^A-Z]/g, "").slice(0, LEN);

  function render() {
    const v = input.value;
    const active = Math.min(v.length, LEN - 1);
    tiles.forEach((t, i) => {
      t.textContent = v[i] ?? "";
      t.classList.toggle("is-filled", Boolean(v[i]));
      t.classList.toggle("is-active", focused && i === active);
    });
  }
  const caretToEnd = () => {
    const n = input.value.length;
    try { input.setSelectionRange(n, n); } catch {}
  };

  input.addEventListener("input", () => {
    const v = clean(input.value);
    if (v !== input.value) input.value = v;
    caretToEnd();
    tilesBox.classList.remove("is-error");
    if (msg.textContent) msg.textContent = "";
    render();
    if (v.length === LEN) setTimeout(() => form.requestSubmit(), 220);
  });
  input.addEventListener("focus", () => { focused = true; caretToEnd(); render(); });
  input.addEventListener("blur", () => { focused = false; render(); });
  input.addEventListener("click", caretToEnd);
  input.addEventListener("keydown", (e) => {
    if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) e.preventDefault();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    if (busy) return;
    const v = input.value;
    if (v.length < LEN) {
      const left = LEN - v.length;
      fail(`Te falta${left > 1 ? "n" : ""} ${left} letra${left > 1 ? "s" : ""}`, false);
      input.focus();
      return;
    }

    busy = true;
    form.classList.add("is-busy");
    submit.textContent = "Abriendo…";
    let unlocked;
    try {
      unlocked = await decryptGift(v);
    } catch (err) {
      if (err instanceof NetworkError) {
        fail("No se pudo cargar. Probá de nuevo en un rato.", false);
      } else {
        fail(NOPE[attempts++ % NOPE.length], true);
        if (attempts === 2) buddy.say("Mirá bien la carta… hay letras que no son como las otras.");
        if (attempts === 4) buddy.say("Fijate en las letras de otro color.");
      }
      submit.textContent = "Abrir";
      busy = false;
      form.classList.remove("is-busy");
      return;
    }

    tilesBox.classList.add("is-ok");
    buddy.say("¡Esa era! Vamos.", "happy");
    window.Pixel?.sfx("power");
    msg.textContent = "";
    input.blur();
    vibrate(30);
    state = { gift: unlocked.gift, key: unlocked.key, revealed: false, answered: false, page: 0 };
    store.set(state);
    loadPhotosScript().catch(() => {}); // precarga mientras gira la hoja
    const pages = buildBook(state.gift, false);
    await sleep(900); // deja ver la ola de letras
    setCurrent(0);
    window.Pixel ? window.Pixel.sfx("page") : paperSound.play();
    await turnAway($("#page-lock"));
    pages[0].onEnter();
  });

  function fail(text, clear) {
    window.Pixel?.sfx("error");
    msg.textContent = text;
    tilesBox.classList.remove("is-error");
    void tilesBox.offsetWidth; // reinicia la animación
    tilesBox.classList.add("is-error");
    vibrate([60, 40, 60]);
    if (clear) {
      setTimeout(() => {
        input.value = "";
        tilesBox.classList.remove("is-error");
        render();
        input.focus();
      }, 650);
    }
  }

  render();
}

/* ───────── Hoja: la carta ───────── */

function writeLine(box, text, instant) {
  const STEP = 32;
  const p = el("p", { class: instant ? "is-instant" : null });
  const visual = el("span", { "aria-hidden": "true" });
  let i = 0;
  for (const word of text.split(" ")) {
    const w = el("span", { class: "ink__w" });
    for (const ch of word) {
      const c = el("span", { class: "ink__c", text: ch });
      c.style.animationDelay = `${i++ * STEP}ms`;
      w.append(c);
    }
    visual.append(w, " ");
    i++;
  }
  p.append(el("span", { class: "sr-only", text }), visual);
  box.append(p);
  // un "blip" por letra, como el texto de un videojuego (se corta si la completa tocando)
  if (!instant && !reduceMotion && window.Pixel) {
    const timers = [...text].map((ch, k) => (/s/.test(ch) ? 0 : setTimeout(() => window.Pixel.blip("tobi"), k * STEP)));
    new MutationObserver((_, obs) => {
      if (!p.classList.contains("is-instant")) return;
      timers.forEach(clearTimeout);
      obs.disconnect();
    }).observe(p, { attributes: true, attributeFilter: ["class"] });
  }
  return { p, duration: reduceMotion || instant ? 0 : i * STEP + 450 };
}

const tapOn = (target) => new Promise((resolve) => target.addEventListener("click", () => resolve(), { once: true }));

// Pega una polaroid en la hoja: clase de posición, giro y orden en que cae
function stick(frame, cls, tilt, i = 0) {
  if (!frame) return null;
  frame.style.setProperty("--tilt", `${tilt}deg`);
  frame.style.setProperty("--i", i);
  return el("div", { class: `stuck ${cls}` }, frame);
}

// Iconitos en pixel art (corazón, estrella, chispita, nota) que aparecen la primera vez que se llega a la hoja
function doodle(kind, cls) {
  const ICON = { heart: "heart", star: "star", sparkle: "sparkle", swirl: "note", arrow: "sparkle" };
  const node = window.Pixel?.icon(ICON[kind] ?? "sparkle", { scale: 3 }).el ?? el("span");
  node.classList.add("doodle", ...cls.split(" "));
  return node;
}

function letterPage(gift, frames, restoring) {
  const page = makePage("notebook--lined page--letter", "Carta");
  const lines = el("div", { class: "paper__lines", "aria-live": "polite" });
  page.body.append(
    el("p", { class: "paper__date", text: gift.fecha }),
    // el saludo y las líneas comparten renglones: cada línea queda apoyada sobre el suyo
    el("div", { class: "paper__ruled ruled" },
      el("p", { class: "paper__greeting", text: `${gift.nombre}:` }),
      lines));
  page.el.append(
    stick(frames[1], "stuck--letter-b", -7, 0),
    stick(frames[0], "stuck--letter", 5, 1),
    doodle("heart", "doodle--letter"));

  if (restoring) {
    gift.intro.forEach((t) => writeLine(lines, t, true));
    return page;
  }

  page.ready = false;
  let played = false;
  page.onEnter = async () => {
    if (played) return;
    played = true;
    // las líneas se escriben solas; tocar la hoja completa la que se está escribiendo
    for (const text of gift.intro) {
      const { p, duration } = writeLine(lines, text, false);
      await Promise.race([sleep(duration + 500), tapOn(page.el)]);
      p.classList.add("is-instant");
    }
    setReady(page);
  };
  return page;
}

/* ───────── Hoja: la entrada pegada ───────── */

const fmt = (iso, opts) => new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour12: false, ...opts }).format(new Date(iso));
const hour = (iso) => fmt(iso, { hour: "2-digit", minute: "2-digit" });

// código de barras vertical para el talón
function barcode(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rand = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
  let y = 0;
  let bars = "";
  while (y < 62) {
    const t = .6 + Math.floor(rand() * 3) * .6;
    bars += `<rect y="${y.toFixed(1)}" width="34" height="${t.toFixed(1)}"/>`;
    y += t + .6 + Math.floor(rand() * 2) * .6;
  }
  return `<svg class="ticket__barcode" viewBox="0 0 34 64" preserveAspectRatio="none" fill="#1d1c1b" aria-hidden="true">${bars}</svg>`;
}

function buildTicket(gift) {
  const s = gift.show;
  const date = fmt(s.inicio, { weekday: "short", day: "2-digit", month: "short" }).replace(/[.,]/g, "");
  const number = `Nº ${fmt(s.inicio, { day: "2-digit", month: "2-digit" }).replace("/", "")}${String(s.cantidad).padStart(2, "0")}`;
  const row = (label, ...value) => [el("dt", { text: label }), el("dd", {}, ...value)];

  return el("div", { class: "ticket" },
    el("div", { class: "ticket__main" },
      el("div", { class: "ticket__top" },
        el("span", { text: "Entrada" }),
        el("span", { text: `Gira ${fmt(s.inicio, { year: "numeric" })}` })),
      el("h2", { class: "ticket__artist", text: s.artista }),
      el("p", { class: "ticket__tour", text: s.gira }),
      el("div", { class: "ticket__when" },
        el("span", { text: date }),
        el("span", { text: `${hour(s.inicio)} hs` })),
      el("dl", { class: "ticket__rows" },
        row("Lugar", s.lugar, el("br"), s.direccion),
        row("Puertas", `${hour(s.puertas)} hs`),
        row("Sector", s.sector),
        row("Titular", s.titulares.join(" & ")))),
    el("div", { class: "ticket__stub" },
      el("span", { class: "ticket__admit", text: "Admite" }),
      el("span", { class: "ticket__qty", text: String(s.cantidad) }),
      el("span", { class: "ticket__code", text: number }),
      el("span", { html: barcode(s.artista + s.inicio) })));
}

function ticketPage(gift, frames) {
  const page = makePage("page--gift", "Tu regalo");
  page.key = "revealed";
  const ticket = buildTicket(gift);
  const canvas = el("canvas", { class: "scratch", "aria-hidden": "true" });
  const wrap = el("div", { class: "ticket-wrap is-covered" }, ticket, canvas);
  const skip = el("button", { class: "skip-btn", type: "button", text: "¿No te deja rascar? Tocá acá", hidden: true });
  page.body.append(
    el("div", { class: "glued" }, wrap,
      el("span", { class: "tape tape--tl", "aria-hidden": "true" }),
      el("span", { class: "tape tape--br", "aria-hidden": "true" })),
    skip,
    frames.length ? el("div", { class: "stuck-row" },
      stick(frames[0], "stuck--gift", -5, 0),
      stick(frames[1], "stuck--gift-b", 6, 1)) : null);
  page.el.append(doodle("star", "doodle--gift"), doodle("sparkle", "doodle--gift-b"));

  if (state.revealed) {
    canvas.remove();
    wrap.classList.remove("is-covered");
    return page;
  }

  page.ready = false;
  let finish = null;
  const onRevealed = () => {
    skip.hidden = true;
    ticket.classList.add("is-shining");
    const r = wrap.getBoundingClientRect();
    confetti.burst(r.left + r.width / 2, r.top + r.height / 2, 150);
    setTimeout(() => confetti.rain(90), 350);
    vibrate([40, 30, 90]);
    save({ revealed: true });
    buddy.say("¿Querés ir a ver a Tan Biónica conmigo?", "love", 7000);
    window.Pixel?.sfx("power");
    setTimeout(() => setReady(page), 900);
  };
  // la lámina se pinta ya, con la hoja todavía tapada: nunca se ve la entrada antes de tiempo
  requestAnimationFrame(() => {
    setupScratch(canvas, onRevealed).then((f) => {
      finish = f;
      wrap.classList.remove("is-covered");
    });
  });
  skip.addEventListener("click", () => finish?.());
  // ya raspada, tocarla le vuelve a pasar el brillo
  wrap.addEventListener("click", () => {
    if (!state.revealed) return;
    ticket.classList.remove("is-shining");
    void ticket.offsetWidth;
    ticket.classList.add("is-shining");
  });
  page.onEnter = () => {
    setTimeout(() => { if (!state.revealed) skip.hidden = false; }, 12000);
  };
  return page;
}

async function setupScratch(canvas, onDone) {
  try { await Promise.race([document.fonts.ready, sleep(1200)]); } catch {}
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // offsetWidth/Height: tamaño real sin la rotación de la entrada pegada
  const w = canvas.offsetWidth;
  const h = canvas.offsetHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.scale(dpr, dpr);

  // lámina dorada pixelada (cuadritos de 6 px en dos tonos)
  const P = 6;
  for (let y = 0; y < h; y += P) {
    for (let x = 0; x < w; x += P) {
      const shade = ((x / P + y / P) % 2) ? "#d9b25c" : "#c99a45";
      ctx.fillStyle = Math.random() < .06 ? "#f3dc9a" : shade;
      ctx.fillRect(x, y, P, P);
    }
  }
  ctx.textAlign = "center";
  ctx.fillStyle = "#3b2610";
  ctx.font = `700 ${Math.round(Math.min(w / 9, 32))}px "Pixelify Sans", "VT323", monospace`;
  ctx.fillText("RASCÁ ACÁ", w / 2, h / 2 + 6);
  ctx.font = `400 14px "Pixelify Sans", "VT323", monospace`;
  ctx.fillStyle = "rgba(59, 38, 16, .75)";
  ctx.fillText("con el dedo", w / 2, h / 2 + 30);
  ctx.fillText("★", w / 2, h / 2 - 28);

  ctx.globalCompositeOperation = "destination-out";
  ctx.strokeStyle = "#000"; // opaco: borra la lámina del todo
  ctx.fillStyle = "#000";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(30, w / 10);

  let last = null;
  let moves = 0;
  let finished = false;
  // offsetX/Y ya vienen en coordenadas locales (descuentan la rotación)
  const point = (e) => ({ x: e.offsetX, y: e.offsetY });
  const cleared = () => {
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let clear = 0;
    let total = 0;
    for (let i = 3; i < data.length; i += 4 * 24) {
      total++;
      if (data[i] < 40) clear++;
    }
    return clear / total;
  };
  const finish = () => {
    if (finished) return;
    finished = true;
    canvas.classList.add("is-clearing");
    setTimeout(() => canvas.remove(), 750);
    onDone();
  };

  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    last = point(e);
    ctx.beginPath();
    ctx.arc(last.x, last.y, ctx.lineWidth / 2, 0, Math.PI * 2);
    ctx.fill();
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!last || finished) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
    if (++moves % 6 === 0) {
      if (moves % 18 === 0) vibrate(4);
      if (cleared() > .52) finish();
    }
  });
  const up = () => { last = null; };
  canvas.addEventListener("pointerup", up);
  canvas.addEventListener("pointercancel", up);

  return finish;
}

/* ───────── Hoja: ¿Vamos? ───────── */

const ICON = {
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  play: '<svg viewBox="0 0 10 12" fill="currentColor" aria-hidden="true"><path d="M0 0l10 6-10 6z"/></svg>',
};

function questionPage(gift, frames = []) {
  const page = makePage("page--question", "Pregunta");
  page.el.append(
    stick(frames[0], "stuck--q-a", -8, 0),
    stick(frames[1], "stuck--q-b", 7, 1),
    doodle("heart", "doodle--question"));
  if (state.answered) {
    page.body.append(answerBlock(gift));
    return page;
  }

  page.ready = false;
  const yes = el("button", { class: "btn btn--wax", type: "button", text: "¡Sí!" });
  const no = el("button", { class: "btn btn--outline btn--no", type: "button", text: "No" });
  const actions = el("div", { class: "question__actions" }, yes, no);
  // la pregunta aparece letra por letra cuando la hoja queda arriba
  const letters = [...gift.pregunta].map((ch, i) => {
    const s = el("span", { class: "q-ch", "aria-hidden": "true", text: ch === " " ? " " : ch });
    s.style.setProperty("--i", i);
    return s;
  });
  const question = el("div", { class: "question" },
    el("h2", { class: "question__text", "aria-label": gift.pregunta }, letters), actions);
  page.body.append(question);

  let escapes = 0;
  let lastRun = -1e9;
  const sameGesture = () => performance.now() - lastRun < 400;
  const run = (e) => {
    if (no.dataset.surrender) return;
    e?.preventDefault();
    if (sameGesture()) return; // pointerenter/pointerdown/click de un mismo toque cuentan una vez
    lastRun = performance.now();
    escapes++;
    if (escapes >= 5) {
      no.dataset.surrender = "1";
      no.textContent = "Bueno, dale";
      no.classList.replace("btn--outline", "btn--wax");
      return;
    }
    const box = actions.getBoundingClientRect();
    const b = no.getBoundingClientRect();
    const s = yes.getBoundingClientRect();
    const maxX = box.width - b.width;
    const maxY = box.height - b.height;
    // nunca encima del "Sí" y siempre lejos de donde estaba
    const overYes = (x, y) => x < s.right - box.left + 8 && x + b.width > s.left - box.left - 8 &&
                              y < s.bottom - box.top + 8 && y + b.height > s.top - box.top - 8;
    let x;
    let y;
    let tries = 0;
    do {
      x = Math.random() * maxX;
      y = Math.random() * maxY;
    } while (++tries < 200 && (overYes(x, y) || Math.hypot(x - (b.left - box.left), y - (b.top - box.top)) < 70));
    no.classList.add("is-running");
    // las medidas son de pantalla; el cuaderno está escalado
    no.style.left = `${x / fitScale}px`;
    no.style.top = `${y / fitScale}px`;
    vibrate(12);
  };
  no.addEventListener("pointerenter", (e) => { if (e.pointerType === "mouse") run(e); });
  no.addEventListener("pointerdown", run);
  no.addEventListener("click", (e) => {
    if (!no.dataset.surrender) run(e);
    else if (!sameGesture()) accept();
  });
  yes.addEventListener("click", accept);

  function accept() {
    save({ answered: true });
    const r = yes.getBoundingClientRect();
    confetti.burst(r.left + r.width / 2, r.top, 160);
    setTimeout(() => confetti.rain(160), 250);
    vibrate([30, 40, 30, 40, 120]);
    question.replaceWith(answerBlock(gift, true));
    setReady(page);
  }
  return page;
}

function answerBlock(gift, animate) {
  const s = gift.show;
  return el("div", { class: `answer${animate ? " reveal-in" : ""}` },
    el("p", { class: "answer__yes", text: gift.respuestaSi }),
    el("p", { class: "answer__label", text: "Faltan" }),
    countdown(s.inicio),
    el("div", { class: "actions" },
      el("a", { class: "btn btn--ink", href: s.mapsUrl, target: "_blank", rel: "noopener", html: `${ICON.pin}<span>Cómo llegar</span>` }),
      el("button", { class: "btn btn--outline", type: "button", html: `${ICON.cal}<span>Agendar</span>`, onclick: () => addToCalendar(gift) })));
}

function countdown(iso) {
  const target = new Date(iso).getTime();
  const labels = ["días", "horas", "min", "seg"];
  const nums = labels.map(() => el("span", { class: "countdown__num" }));
  const box = el("div", { class: "countdown", role: "timer" },
    labels.map((l, i) => el("div", { class: "countdown__cell" }, nums[i], el("span", { class: "countdown__label", text: l }))));

  const tick = () => {
    const d = target - Date.now();
    if (d <= 0) {
      clearInterval(timer);
      const text = d > -6 * 3600e3 ? "Es hoy." : "Ya fue.";
      box.replaceWith(el("p", { class: "countdown__done", text }));
      return;
    }
    const parts = [Math.floor(d / 864e5), Math.floor(d / 36e5) % 24, Math.floor(d / 6e4) % 60, Math.floor(d / 1e3) % 60];
    parts.forEach((v, i) => {
      const text = String(v).padStart(2, "0");
      if (nums[i].textContent === text) return;
      nums[i].textContent = text;
      nums[i].classList.remove("flip"); // cada número que cambia da un saltito
      void nums[i].offsetWidth;
      nums[i].classList.add("flip");
    });
  };
  const timer = setInterval(tick, 1000);
  tick();
  return box;
}

function addToCalendar(gift) {
  const s = gift.show;
  const start = new Date(s.puertas);
  const end = new Date(new Date(s.inicio).getTime() + 150 * 60e3);
  const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const title = `${s.artista} · ${s.gira}`;
  const where = `${s.lugar}, ${s.direccion}`;
  const details = `Puertas ${hour(s.puertas)} · Show ${hour(s.inicio)} · ${s.sector}`;

  const ua = navigator.userAgent;
  const apple = /iPad|iPhone|iPod|Macintosh/.test(ua) && !/Android/.test(ua);
  if (!apple) {
    const url = new URL("https://calendar.google.com/calendar/render");
    url.search = new URLSearchParams({ action: "TEMPLATE", text: title, dates: `${stamp(start)}/${stamp(end)}`, location: where, details });
    window.open(url, "_blank", "noopener");
    return;
  }

  const esc = (t) => t.replace(/[\\,;]/g, (m) => `\\${m}`);
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Regalo Lu//ES", "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${stamp(start)}-regalo-lu`,
    `DTSTAMP:${stamp(new Date())}`,
    `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(title)}`,
    `LOCATION:${esc(where)}`,
    `DESCRIPTION:${esc(details)}`,
    "BEGIN:VALARM", "ACTION:DISPLAY", "DESCRIPTION:Mañana es el show", "TRIGGER:-P1D", "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const link = el("a", { href: URL.createObjectURL(new Blob([ics], { type: "text/calendar" })), download: "show.ics" });
  document.body.append(link);
  link.click();
  link.remove();
}

/* ───────── Hoja: el número escondido ───────── */

// Casillas de código (una por carácter) sobre un único input real, como las del candado
function codeField(len, numeric) {
  const tilesBox = el("div", { class: "code__tiles", "aria-hidden": "true" });
  tilesBox.style.setProperty("--n", len);
  const tiles = Array.from({ length: len }, (_, i) => {
    const t = el("span", { class: "tile" });
    t.style.setProperty("--i", i);
    return t;
  });
  tilesBox.append(...tiles);
  const input = el("input", {
    class: "code__input", type: "text", inputmode: numeric ? "numeric" : "text", maxlength: len,
    autocomplete: "off", autocapitalize: "characters", autocorrect: "off", spellcheck: "false", "aria-label": "Código",
  });
  const wrap = el("div", { class: "code__field number__field" }, tilesBox, input);
  wrap.style.setProperty("--w", `${Math.min(300, len * 52)}px`);

  let focused = false;
  const clean = (v) => normalizePassword(v).replace(numeric ? /[^0-9]/g : /[^A-Z0-9]/g, "").slice(0, len);
  const render = () => {
    const v = input.value;
    tiles.forEach((t, i) => {
      t.textContent = v[i] ?? "";
      t.classList.toggle("is-filled", Boolean(v[i]));
      t.classList.toggle("is-active", focused && i === Math.min(v.length, len - 1));
    });
  };
  const api = {
    el: wrap,
    tilesBox,
    input,
    onComplete: null,
    set(v) { input.value = v; render(); },
  };
  input.addEventListener("input", () => {
    const v = clean(input.value);
    if (v !== input.value) input.value = v;
    tilesBox.classList.remove("is-error");
    render();
    if (v.length === len) setTimeout(() => api.onComplete?.(v), 200);
  });
  input.addEventListener("focus", () => { focused = true; render(); });
  input.addEventListener("blur", () => { focused = false; render(); });
  render();
  return api;
}

// Hoja "Te falta algo": el regalo todavía no; primero hay que encontrar un número
function numberPage(gift, frames = []) {
  const page = makePage("page--number", "Te falta algo");
  page.key = "numero";
  const cfg = gift.numero;
  const code = normalizePassword(String(cfg.codigo)).replace(/[^A-Z0-9]/g, "");
  // la lata en 3D: flota, la etiqueta gira; al tocarla da una vuelta rápida y salta
  const box = el("button", { class: "can", type: "button", "aria-label": "La lata" },
    el("span", { class: "can__glow" }),
    el("span", { class: "can__body" }, window.Pixel?.icon("canBody", { scale: 7 }).el ?? null),
    el("span", { class: "can__lid" }, window.Pixel?.icon("canLid", { scale: 7 }).el ?? null));
  // la lata va flanqueada por dos fotos y unas chispitas dibujadas
  const canWrap = el("div", { class: "can-wrap" },
    stick(frames[0], "stuck--flank-l", -9, 0),
    stick(frames[1], "stuck--flank-r", 8, 1),
    box, el("span", { class: "can__shadow" }),
    doodle("sparkle", "doodle--can"), doodle("sparkle", "doodle--can-b"));
  box.addEventListener("click", () => {
    if (box.classList.contains("is-open")) return;
    box.classList.remove("is-spinning");
    void box.offsetWidth;
    box.classList.add("is-spinning");
    vibrate(15);
  });
  const field = codeField(code.length, /^\d+$/.test(code));
  const msg = el("p", { class: "code__msg", role: "status", "aria-live": "polite" });
  const hint = el("p", { class: "lock__hint", text: cfg.pista, hidden: true });
  const hintBtn = el("button", { class: "hint-btn", type: "button", text: "¿Pista?" });
  hintBtn.addEventListener("click", () => { hint.hidden = !hint.hidden; });
  page.body.append(
    el("h2", { class: "number__title", text: cfg.titulo }),
    el("p", { class: "number__text", text: cfg.texto }),
    canWrap, field.el, msg, cfg.pista ? hintBtn : null, hint);

  const solved = () => {
    field.set(code);
    field.input.disabled = true;
    field.tilesBox.classList.add("is-ok");
    box.classList.add("is-open");
    box.setAttribute("aria-label", "La lata, abierta");
    msg.remove();
    hintBtn.remove();
    hint.remove();
    page.body.append(el("p", { class: "number__ok", text: cfg.ok }));
  };
  if (state.numero) {
    solved();
    return page;
  }

  page.ready = false;
  const NOPE = ["Ese no es. Buscá bien.", "Tampoco. Seguí buscando.", "Casi… mirá con más atención."];
  let tries = 0;
  field.onComplete = (v) => {
    if (v === code) {
      field.input.blur();
      save({ numero: true });
      buddy.say("¡Bien! Pero todavía no terminó…", "happy");
      window.Pixel?.sfx("coin");
      solved();
      const r = box.getBoundingClientRect();
      confetti.burst(r.left + r.width / 2, r.top, 140);
      vibrate([30, 40, 90]);
      setReady(page);
      return;
    }
    msg.textContent = NOPE[tries++ % NOPE.length];
    window.Pixel?.sfx("error");
    if (tries === 2) buddy.say("¿Revisaste bien debajo de las latas?");
    field.tilesBox.classList.remove("is-error");
    void field.tilesBox.offsetWidth;
    field.tilesBox.classList.add("is-error");
    vibrate([60, 40, 60]);
    setTimeout(() => { field.set(""); field.input.focus(); }, 650);
  };
  return page;
}

/* ───────── Hoja: el detalle escondido en una foto ───────── */

// "Todavía no.": en una de las fotos hay un corazoncito camuflado; hay que encontrarlo y tocarlo
function detailPage(gift, photos) {
  const page = makePage("page--detail", "Todavía no");
  page.key = "detalle";
  const cfg = gift.detalle;
  const img = el("img", { class: "detail__img", alt: "", decoding: "async" });
  const heart = el("button", { class: "detail__heart", type: "button", "aria-label": "Algo escondido" },
    el("span", {}, window.Pixel?.icon("heart", { scale: 2 }).el ?? "♥"));
  heart.style.left = `${cfg.x}%`;
  heart.style.top = `${cfg.y}%`;
  const photo = el("div", { class: "detail__photo is-loading" }, img, heart);
  const msg = el("p", { class: "code__msg", role: "status", "aria-live": "polite" });
  const hintBtn = el("button", { class: "hint-btn", type: "button", text: "¿Pista?" });
  const hint = el("p", { class: "lock__hint", text: cfg.pista, hidden: true });
  hintBtn.addEventListener("click", () => {
    hint.hidden = !hint.hidden;
    heart.classList.add("is-hinting");
  });
  page.body.append(
    el("h2", { class: "number__title", text: cfg.titulo }),
    el("p", { class: "number__text", text: cfg.texto }),
    el("div", { class: "detail__frame" }, el("span", { class: "tape tape--polaroid", "aria-hidden": "true" }), photo),
    msg, cfg.pista ? hintBtn : null, hint);

  photos.whenLoaded((list) => {
    const p = list[cfg.foto] ?? list[0];
    if (!p) return;
    photo.style.aspectRatio = `${p.w} / ${p.h}`;
    img.src = p.url;
    photo.classList.remove("is-loading");
    p.full().then((u) => { img.src = u; }).catch(() => {}); // acá hace falta nitidez para buscar el corazón
  });

  const found = () => {
    heart.classList.add("is-found");
    heart.disabled = true;
    msg.remove();
    hintBtn.remove();
    hint.remove();
    page.body.append(el("p", { class: "number__ok", text: cfg.ok }));
  };
  if (state.detalle) {
    found();
    return page;
  }

  page.ready = false;
  let misses = 0;
  photo.addEventListener("click", (e) => {
    if (e.target.closest(".detail__heart") || heart.disabled) return;
    // tocó en otro lado: una marquita y vibra; a los 4 intentos el corazón late para ayudar
    const mark = el("span", { class: "detail__miss", "aria-hidden": "true" });
    mark.style.left = `${e.offsetX}px`;
    mark.style.top = `${e.offsetY}px`;
    photo.append(mark);
    setTimeout(() => mark.remove(), 700);
    vibrate(25);
    if (++misses >= 4) heart.classList.add("is-hinting");
    if (misses === 6) buddy.say("Está entre las flores…");
  });
  page.onEnter = () => buddy.say("Mirá bien esta foto…");
  heart.addEventListener("click", () => {
    save({ detalle: true });
    buddy.say("¡Lo encontraste!", "happy");
    window.Pixel?.sfx("coin");
    found();
    const r = heart.getBoundingClientRect();
    confetti.burst(r.left + r.width / 2, r.top + r.height / 2, 150);
    vibrate([30, 40, 90]);
    setReady(page);
  });
  return page;
}

/* ───────── Hoja: ¿qué creés que es? ───────── */

// Adivinanza en joda antes del regalo: cada opción boluda tiene su respuesta; la buena habilita seguir
function guessPage(gift) {
  const page = makePage("page--guess", "¿Qué es?");
  page.key = "adivinanza";
  const cfg = gift.adivinanza;
  const reply = el("p", { class: "guess__reply", "aria-live": "polite" });
  const buttons = cfg.opciones.map((o) => el("button", { class: "guess__opt", type: "button", text: o.texto }));
  page.body.append(
    el("h2", { class: "number__title", text: cfg.titulo }),
    el("p", { class: "number__text", text: cfg.pregunta }),
    el("div", { class: "guess__opts" }, buttons),
    reply);
  page.el.append(doodle("star", "doodle--guess"), doodle("sparkle", "doodle--guess-b"));

  const right = cfg.opciones.findIndex((o) => o.correcta);
  if (state.adivinanza) return page;

  page.ready = false;
  // todas las opciones se comportan igual (la buena no se marca): cada una tiene su comentario en joda
  // y, cuando toca la buena, simplemente aparece "Seguir"
  buttons.forEach((b, i) => b.addEventListener("click", () => {
    b.classList.remove("is-picked");
    void b.offsetWidth;
    b.classList.add("is-picked");
    reply.classList.remove("is-shown");
    void reply.offsetWidth;
    reply.textContent = buddy.say(cfg.opciones[i].respuesta, i === right ? "happy" : "normal") ? "" : cfg.opciones[i].respuesta;
    reply.classList.add("is-shown");
    vibrate(20);
    if (i === right && !state.adivinanza) {
      window.Pixel?.sfx("coin");
      save({ adivinanza: true });
      setReady(page);
    }
  }));
  return page;
}

/* ───────── Hoja: la nota antes de raspar ───────── */

// "Bueno, ahora sí…": se escribe sola sobre los renglones, como la carta
function notePage(gift) {
  const page = makePage("page--note", "Ahora sí");
  const cfg = gift.nota;
  const lines = el("div", { class: "paper__lines", "aria-live": "polite" });
  page.body.append(
    el("div", { class: "paper__ruled ruled" }, lines),
    el("p", { class: "note__sign", text: cfg.firma }));
  page.el.append(doodle("heart", "doodle--note"));

  if (state.nota) {
    cfg.lineas.forEach((t) => writeLine(lines, t, true));
    page.el.classList.add("is-signed");
    return page;
  }
  page.ready = false;
  let played = false;
  page.onEnter = async () => {
    if (played) return;
    played = true;
    for (const text of cfg.lineas) {
      const { p, duration } = writeLine(lines, text, false);
      await Promise.race([sleep(duration + 450), tapOn(page.el)]);
      p.classList.add("is-instant");
    }
    page.el.classList.add("is-signed");
    save({ nota: true });
    setReady(page);
  };
  return page;
}

/* ───────── Nivel: Lu en salchicha (runner tipo dinosaurio de Chrome) ───────── */

// Ella arriba de un salchicha saltando obstáculos. No importa hasta dónde llegue: después del primer intento ya puede seguir.
function runnerPage(gift) {
  const page = makePage("page--runner", "Nivel salchicha");
  page.key = "runner";
  const cfg = gift.salchicha ?? {};
  const box = el("div", { class: "runner-box" });
  const score = el("p", { class: "number__ok runner__score", "aria-live": "polite" });
  page.body.append(
    el("h2", { class: "number__title", text: cfg.titulo ?? "¡A correr!" }),
    el("p", { class: "number__text", text: cfg.texto ?? "Ayudá a Lu y al salchicha a llegar lo más lejos posible." }),
    box, score);
  page.el.append(doodle("star", "doodle--runner"));
  if (!state.runner) page.ready = false;
  if (state.runnerBest) score.textContent = `RÉCORD: ${state.runnerBest}`;

  let game = null;
  page.onEnter = () => {
    if (game || !window.Runner) return;
    game = window.Runner.create(box, {
      best: state.runnerBest || 0,
      onEnd(points, best) {
        score.textContent = `RÉCORD: ${best}`;
        const first = !state.runner;
        save({ runner: true, runnerBest: best });
        if (first) {
          buddy.say(`¡${points}! Nada mal. Podés seguir… o intentarlo de nuevo.`, "happy");
          setReady(page);
        } else if (points >= best) {
          buddy.say("¡Nuevo récord!", "happy");
        }
      },
    });
    buddy.say("Tocá la pantalla para saltar.");
  };
  return page;
}

/* ───────── Misiones físicas (mensaje invisible, escondite…) ───────── */

// Una hoja que la manda a hacer algo en el mundo real y le pide la palabra que encontró
function missionPage(cfg, key) {
  const page = makePage("page--mission", cfg.titulo);
  page.key = key;
  const code = normalizePassword(String(cfg.codigo)).replace(/[^A-Z0-9]/g, "");
  const field = codeField(code.length, /^\d+$/.test(code));
  const msg = el("p", { class: "code__msg", role: "status", "aria-live": "polite" });
  const hint = el("p", { class: "lock__hint", text: cfg.pista, hidden: true });
  const hintBtn = el("button", { class: "hint-btn", type: "button", text: "¿Pista?" });
  hintBtn.addEventListener("click", () => { hint.hidden = !hint.hidden; });
  const icon = el("div", { class: "mission__icon" }, window.Pixel?.icon(cfg.icono ?? "star", { scale: 7 }).el ?? null);
  page.body.append(
    el("p", { class: "mission__tag", text: cfg.etiqueta ?? "MISIÓN" }),
    el("h2", { class: "number__title", text: cfg.titulo }),
    el("p", { class: "number__text", text: cfg.texto }),
    icon, field.el, msg, cfg.pista ? hintBtn : null, hint);
  page.el.append(doodle("sparkle", "doodle--mission"), doodle("star", "doodle--mission-b"));

  const solved = () => {
    field.set(code);
    field.input.disabled = true;
    field.tilesBox.classList.add("is-ok");
    icon.classList.add("is-done");
    msg.remove();
    hintBtn.remove();
    hint.remove();
    page.body.append(el("p", { class: "number__ok", text: cfg.ok ?? "¡Misión cumplida!" }));
  };
  if (state[key]) {
    solved();
    return page;
  }

  page.ready = false;
  const NOPE = ["Esa no es.", "Tampoco… mirá bien.", "Casi. Probá de nuevo."];
  let tries = 0;
  field.onComplete = (v) => {
    if (v === code) {
      field.input.blur();
      save({ [key]: true });
      solved();
      window.Pixel?.sfx("coin");
      const r = icon.getBoundingClientRect();
      confetti.burst(r.left + r.width / 2, r.top + r.height / 2, 140);
      vibrate([30, 40, 90]);
      buddy.say(cfg.festejo ?? "¡Misión cumplida!", "happy");
      setReady(page);
      return;
    }
    msg.textContent = NOPE[tries++ % NOPE.length];
    window.Pixel?.sfx("error");
    if (tries === 2 && cfg.ayuda) buddy.say(cfg.ayuda);
    field.tilesBox.classList.remove("is-error");
    void field.tilesBox.offsetWidth;
    field.tilesBox.classList.add("is-error");
    vibrate([60, 40, 60]);
    setTimeout(() => { field.set(""); field.input.focus(); }, 650);
  };
  page.onEnter = () => { if (cfg.alEntrar) buddy.say(cfg.alEntrar); };
  return page;
}

/* ───────── Nivel: adiviná la canción ───────── */

// Los fragmentos vienen cifrados en audio.enc.js (se cargan recién al llegar a esta hoja)
let audioScript;
function loadAudioScript() {
  audioScript ??= new Promise((resolve, reject) => {
    if (window.AUDIO_ENC) return resolve();
    const v = window.GIFT_ENC?.audio ? `?v=${window.GIFT_ENC.audio}` : "";
    document.head.append(el("script", { src: `audio.enc.js${v}`, onload: resolve, onerror: reject }));
  });
  return audioScript;
}
async function decryptAudio(i) {
  await loadAudioScript();
  const part = window.AUDIO_ENC?.[i];
  if (!part) throw new Error("sin audio");
  const key = await crypto.subtle.importKey("raw", fromB64(state.key), "AES-GCM", false, ["decrypt"]);
  const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(part.iv) }, key, fromB64(part.data));
  return URL.createObjectURL(new Blob([buf], { type: part.type }));
}

function songPage(gift) {
  const page = makePage("page--song", "Adiviná la canción");
  page.key = "cancion";
  const rondas = gift.adivinaCancion.rondas;
  const dots = rondas.map(() => el("span", { class: "quiz__dot" }));
  const play = el("button", { class: "btn btn--wax song__play", type: "button", text: "▶ ESCUCHAR" });
  const eq = el("span", { class: "song__eq", "aria-hidden": "true" }, [1, 2, 3, 4, 5].map(() => el("i")));
  const opts = el("div", { class: "guess__opts" });
  const msg = el("p", { class: "guess__reply", "aria-live": "polite" });
  page.body.append(
    el("h2", { class: "number__title", text: "Adiviná la canción" }),
    el("p", { class: "number__text", text: "Subí el volumen y escuchá." }),
    el("div", { class: "quiz__progress" }, dots),
    el("div", { class: "song__player" }, play, eq),
    opts, msg);

  const done = () => {
    dots.forEach((d) => d.classList.add("is-done"));
    play.disabled = true;
    opts.replaceChildren();
    msg.textContent = "¡Las adivinaste todas!";
  };
  if (state.cancion) {
    done();
    return page;
  }
  page.ready = false;

  let ronda = 0;
  let audio = null;
  const stop = () => {
    audio?.pause();
    eq.classList.remove("is-on");
  };
  const show = () => {
    const r = rondas[ronda];
    dots.forEach((d, i) => {
      d.classList.toggle("is-done", i < ronda);
      d.classList.toggle("is-now", i === ronda);
    });
    msg.textContent = "";
    audio = null;
    play.textContent = "▶ ESCUCHAR";
    opts.replaceChildren(...r.opciones.map((texto, i) => {
      const b = el("button", { class: "guess__opt", type: "button", text: texto });
      b.addEventListener("click", () => {
        if (b.disabled) return;
        if (i === r.correcta) {
          stop();
          window.Pixel?.sfx("coin");
          b.classList.add("is-picked");
          msg.textContent = r.respuesta ?? "¡Sí!";
          buddy.say(r.respuesta ?? "¡Esa era!", "happy");
          [...opts.children].forEach((o) => { o.disabled = true; });
          setTimeout(() => {
            ronda++;
            if (ronda < rondas.length) return show();
            done();
            save({ cancion: true });
            window.Pixel?.sfx("power");
            setReady(page);
          }, 1500);
        } else {
          b.disabled = true;
          b.classList.add("is-picked");
          window.Pixel?.sfx("error");
          msg.textContent = "Nop. Escuchá de nuevo.";
        }
      });
      return b;
    }));
  };
  play.addEventListener("click", async () => {
    try {
      if (!audio) {
        play.textContent = "…";
        audio = new Audio(await decryptAudio(ronda));
        audio.addEventListener("ended", () => eq.classList.remove("is-on"));
      }
      audio.currentTime = 0;
      await audio.play();
      eq.classList.add("is-on");
      play.textContent = "↻ OTRA VEZ";
    } catch {
      play.textContent = "▶ ESCUCHAR";
      msg.textContent = "No se pudo reproducir. Probá de nuevo.";
    }
  });
  page.onEnter = () => buddy.say("¡Subí el volumen!");
  show();
  return page;
}

/* ───────── Nivel: la piñata ───────── */

// Golpear la piñata (tocándola; si el celular tiene sensor, sacudirlo también cuenta) hasta que se rompe,
// cae un regalo y, al tocarlo, se abre y pasa a la entrada para raspar.
function pinataPage(gift) {
  const page = makePage("page--pinata", "La piñata");
  page.key = "pinata";
  const HITS = 9;
  const pinata = el("button", { class: "pinata", type: "button", "aria-label": "Pegale a la piñata" },
    el("span", { class: "pinata__rope" }),
    el("span", { class: "pinata__body" }, window.Pixel?.icon("pinata", { scale: 6 }).el ?? null));
  const present = el("button", { class: "gift-drop", type: "button", "aria-label": "Tu regalo", hidden: true },
    el("span", { class: "gift-drop__lid" }, window.Pixel?.icon("giftLid", { scale: 7 }).el ?? null),
    el("span", { class: "gift-drop__base" }, window.Pixel?.icon("giftBase", { scale: 7 }).el ?? null),
    el("span", { class: "gift-drop__tap", text: "TOCALO" }));
  const stage = el("div", { class: "pinata-stage" }, pinata, present);
  const bar = el("span", { class: "shake__fill" });
  const title = el("h2", { class: "number__title", text: "¡Pegale a la piñata!" });
  const text = el("p", { class: "number__text", text: "Tocala fuerte. No se rompe tan fácil…" });
  page.body.append(title, text, stage, el("div", { class: "shake__bar" }, bar));
  page.el.append(doodle("star", "doodle--shake"), doodle("sparkle", "doodle--shake-b"));

  const opened = () => {
    pinata.hidden = true;
    present.hidden = false;
    present.classList.add("is-open");
    bar.style.width = "100%";
    title.textContent = "¡Tu regalo!";
    text.textContent = "Pasá la hoja.";
  };
  if (state.pinata) {
    opened();
    return page;
  }
  page.ready = false;

  let hits = 0;
  let last = 0;
  const hit = () => {
    if (hits >= HITS) return;
    hits++;
    bar.style.width = `${(hits / HITS) * 100}%`;
    pinata.classList.remove("is-hit");
    void pinata.offsetWidth;
    pinata.classList.add("is-hit");
    window.Pixel?.sfx("hit");
    vibrate(20);
    const r = pinata.getBoundingClientRect();
    confetti.burst(r.left + r.width / 2, r.top + r.height * .65, 10); // caramelitos que saltan
    if (hits === 3) buddy.say("¡Más fuerte!");
    if (hits === 6) buddy.say("¡Ya casi!");
    if (hits < HITS) return;
    // se rompe: explota y cae el regalo
    removeEventListener("devicemotion", onMotion);
    setTimeout(() => {
      window.Pixel?.sfx("power");
      confetti.burst(r.left + r.width / 2, r.top + r.height / 2, 200);
      pinata.classList.add("is-broken");
      setTimeout(() => {
        pinata.hidden = true;
        present.hidden = false;
        present.classList.add("is-falling");
        window.Pixel?.sfx("hit");
        title.textContent = "¿Y eso?";
        text.textContent = "";
        buddy.say("¿Qué es eso que cayó?", "surprised", 2200);
        setTimeout(() => buddy.say("¡Ah! Es tu regalo.", "love", 3500), 2600);
      }, 450);
    }, 250);
  };
  pinata.addEventListener("click", hit);
  // si el celular tiene sensor (y no pide permiso), sacudirlo también le pega
  const onMotion = (e) => {
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (!a) return;
    const now = performance.now();
    if (Math.abs(a.x || 0) + Math.abs(a.y || 0) + Math.abs(a.z || 0) > 34 && now - last > 350) {
      last = now;
      hit();
    }
  };
  present.addEventListener("click", async () => {
    if (state.pinata) return;
    save({ pinata: true });
    present.classList.remove("is-falling");
    present.classList.add("is-open");
    window.Pixel?.sfx("coin");
    const r = present.getBoundingClientRect();
    confetti.burst(r.left + r.width / 2, r.top, 160);
    vibrate([30, 40, 90]);
    title.textContent = "¡Tu regalo!";
    setReady(page);
    await sleep(1300);
    turnTo(book.index + 1); // y aparece la entrada para raspar
  });
  page.onEnter = () => {
    buddy.say("¡Pegale a la piñata!", "happy");
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission !== "function") {
      addEventListener("devicemotion", onMotion);
    }
  };
  return page;
}

/* ───────── Nivel: sacudí el celular ───────── */

// Algo físico antes de la entrada: sacudir el teléfono (o, si el sensor no anda, tocar muchas veces)
function shakePage(gift) {
  const page = makePage("page--shake", "Sacudí el celular");
  page.key = "sacudir";
  const NEED = 12;
  const bar = el("span", { class: "shake__fill" });
  const box = el("div", { class: "shake__gift" }, window.Pixel?.icon("canBody", { scale: 5 }).el ?? null);
  const perm = el("button", { class: "btn btn--ink", type: "button", text: "ACTIVAR SENSOR", hidden: true });
  const tapAlt = el("button", { class: "skip-btn", type: "button", text: "¿No anda? Tocá la lata muchas veces", hidden: true });
  page.body.append(
    el("h2", { class: "number__title", text: "Desbloqueá tu regalo" }),
    el("p", { class: "number__text", text: "Sacudí el celular." }),
    box,
    el("div", { class: "shake__bar" }, bar),
    perm, tapAlt);
  page.el.append(doodle("sparkle", "doodle--shake"), doodle("star", "doodle--shake-b"));

  if (state.sacudir) {
    bar.style.width = "100%";
    return page;
  }
  page.ready = false;
  let level = 0;
  let last = 0;
  let listening = false;
  const bump = () => {
    if (state.sacudir) return;
    level = Math.min(NEED, level + 1);
    bar.style.width = `${(level / NEED) * 100}%`;
    box.classList.remove("is-shaking");
    void box.offsetWidth;
    box.classList.add("is-shaking");
    window.Pixel?.blip("tobi");
    vibrate(15);
    if (level < NEED) return;
    save({ sacudir: true });
    window.Pixel?.sfx("power");
    const r = box.getBoundingClientRect();
    confetti.burst(r.left + r.width / 2, r.top + r.height / 2, 160);
    buddy.say("¡Ahí está! Ahora raspá.", "love");
    setReady(page);
  };
  const onMotion = (e) => {
    const a = e.accelerationIncludingGravity || e.acceleration;
    if (!a) return;
    const force = Math.abs(a.x || 0) + Math.abs(a.y || 0) + Math.abs(a.z || 0);
    const now = performance.now();
    if (force > 32 && now - last > 160) {
      last = now;
      bump();
    }
  };
  const listen = () => {
    if (listening) return;
    listening = true;
    addEventListener("devicemotion", onMotion);
  };
  box.addEventListener("click", () => { if (!tapAlt.hidden) bump(); });
  tapAlt.addEventListener("click", () => {
    tapAlt.textContent = "Tocá la lata hasta llenar la barra";
  });
  perm.addEventListener("click", async () => {
    try {
      if ((await DeviceMotionEvent.requestPermission()) === "granted") {
        perm.hidden = true;
        listen();
      }
    } catch {}
  });
  page.onEnter = () => {
    // iPhone pide permiso para el sensor (con un toque); Android no
    if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") perm.hidden = false;
    else listen();
    setTimeout(() => { if (!state.sacudir) tapAlt.hidden = false; }, 6000);
    buddy.say("¡Sacudilo fuerte!");
  };
  return page;
}

/* ───────── Hojas: canciones, fotos y cierre ───────── */

function setlistPage(gift, frames = []) {
  const page = makePage("page--setlist", "Canciones");
  page.el.append(stick(frames[0], "stuck--setlist", 6, 0), doodle("sparkle", "doodle--setlist"));
  const s = gift.show;
  page.body.append(
    el("h2", { class: "page__title", text: "Para ir escuchando" }),
    el("ol", { class: "setlist" },
      gift.canciones.map((song, i) => el("li", {},
        el("a", { href: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${s.artista} ${song}`)}`, target: "_blank", rel: "noopener" },
          el("span", { class: "setlist__n", text: String(i + 1).padStart(2, "0") }),
          el("span", { class: "setlist__t", text: song }),
          el("span", { class: "setlist__play", html: ICON.play }))))));
  return page;
}

// posiciones del collage según cuántas fotos entran en la hoja (x, y, ancho en %; giro en grados)
const COLLAGE = {
  1: [[16, 14, 70, -3]],
  2: [[2, 2, 62, -5], [34, 46, 62, 5]],
  3: [[2, 1, 54, -6], [42, 28, 52, 6], [6, 58, 52, 3]],
  4: [[2, 1, 50, -6], [48, 4, 48, 5], [5, 53, 48, 4], [49, 56, 46, -5]],
};

function photoPage(frames) {
  const page = makePage("page--photos", "Fotos");
  frames.forEach((frame, i) => {
    const [x, y, w, tilt] = COLLAGE[frames.length][i];
    frame.style.setProperty("--x", `${x}%`);
    frame.style.setProperty("--y", `${y}%`);
    frame.style.setProperty("--w", `${w}%`);
    frame.style.setProperty("--tilt", `${tilt}deg`);
    frame.style.setProperty("--i", i); // se pegan una por una
  });
  page.body.append(el("div", { class: "collage" }, frames));
  return page;
}

function finalPage(gift, frame) {
  const page = makePage("page--final", "Final");
  page.body.append(
    stick(frame, "stuck--final", -3, 0),
    el("p", { class: "closing", text: gift.final }),
    el("p", { class: "closing__sign", text: `— ${gift.firma}` }));
  page.el.append(doodle("heart", "doodle--final"), doodle("sparkle", "doodle--final-b"), doodle("star", "doodle--final-c"));
  if (window.Pixel) {
    const yo = window.Pixel.sprite("tobi", { scale: 3 });
    const ella = window.Pixel.sprite("lu", { scale: 3 });
    yo.setMood("love");
    ella.setMood("love");
    page.body.append(el("div", { class: "duo", "aria-hidden": "true" }, yo.el, window.Pixel.heart({ scale: 3 }).el, ella.el));
    page.body.append(el("button", { class: "scene__btn final__song", type: "button", text: "♪ CANCIÓN", onclick: () => window.Pixel.song("cumple") }));
  }

  // corazoncitos que suben mientras la última hoja está a la vista
  const HEARTS = ["#c2456b", "#e07a9a", "#f4b6c8", "#d81e1e"];
  const spawn = () => {
    const h = el("span", { class: "heart", "aria-hidden": "true", text: "♥" });
    h.style.left = `${8 + Math.random() * 84}%`;
    h.style.color = HEARTS[(Math.random() * HEARTS.length) | 0];
    h.style.setProperty("--d", `${3.2 + Math.random() * 2.6}s`);
    h.style.setProperty("--s", (.6 + Math.random() * .9).toFixed(2));
    h.style.setProperty("--x", `${((Math.random() - .5) * 70).toFixed(0)}px`);
    page.el.append(h);
    setTimeout(() => h.remove(), 6500);
  };
  let timer = 0;
  page.onEnter = () => {
    buddy.say("Feliz cumple, Lu.", "love");
    window.Pixel?.song("cumple");
    if (reduceMotion) return;
    for (let i = 0; i < 10; i++) setTimeout(spawn, i * 140);
    clearInterval(timer);
    timer = setInterval(() => {
      if (!page.el.classList.contains("is-current")) return clearInterval(timer);
      spawn();
    }, 800);
  };
  return page;
}

/* ───────── Última hoja: nosotros en el show (pixel art animado) ───────── */

// Escena nocturna del recital: escenario con el cartel, la banda, luces que barren, el público saltando
// y, adelante, los dos personajitos como en una selfie.
function showPage(gift) {
  const page = makePage("page--show", "En el show");
  const W = 160;
  const H = 104;
  const canvas = el("canvas", { class: "show__canvas", "aria-label": "Nosotros en el show de Tan Biónica" });
  const duo = el("div", { class: "show__duo", "aria-hidden": "true" });
  if (window.Pixel) {
    const yo = window.Pixel.sprite("tobi", { scale: 2 });
    const ella = window.Pixel.sprite("lu", { scale: 2 });
    yo.setMood("happy");
    ella.setMood("happy");
    duo.append(yo.el, window.Pixel.heart({ scale: 2 }).el, ella.el);
  }
  page.body.append(
    el("h2", { class: "number__title", text: gift.show.fechaTexto.replace(/ de \d{4}$/, "") }),
    el("p", { class: "number__text", text: "Nosotros, ahí." }),
    el("div", { class: "show" }, canvas, duo));

  const ctx = canvas.getContext("2d");
  let k = 1;
  const resize = () => {
    const css = canvas.parentElement.clientWidth || 320;
    k = Math.max(1, Math.floor((css * (window.devicePixelRatio || 1)) / W));
    canvas.width = W * k;
    canvas.height = H * k;
  };
  const px = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x) * k, Math.round(y) * k, w * k, h * k); };

  // la banda: 4 siluetas con instrumentos (guitarra, voz, bajo, batería)
  const band = [
    { x: 46, kind: "guitar" }, { x: 70, kind: "mic" }, { x: 92, kind: "bass" }, { x: 114, kind: "drums" },
  ];
  const crowd = Array.from({ length: 22 }, (_, i) => ({ x: i * 7.5 - 2, phase: Math.random() * 6, hue: i % 3 }));
  const bits = Array.from({ length: 26 }, () => ({ x: Math.random() * W, y: Math.random() * H, v: 6 + Math.random() * 10, c: ["#e0548c", "#e3b04b", "#fbe9c4", "#7fd0e8"][(Math.random() * 4) | 0] }));

  let raf = 0;
  let t0 = 0;
  const draw = (now) => {
    if (!page.el.classList.contains("is-current")) { raf = 0; return; }
    const t = (now - t0) / 1000;
    // cielo de noche
    px(0, 0, W, H, "#1b1630");
    for (let y = 0; y < 30; y += 2) px(0, y, W, 1, "rgba(80, 50, 120, .12)");
    // luces que barren (triángulos de colores desde arriba)
    const beams = [["rgba(224, 84, 140, .22)", 0], ["rgba(127, 208, 232, .2)", 2], ["rgba(227, 176, 75, .2)", 4]];
    beams.forEach(([c, ph], i) => {
      const sx = 30 + i * 50;
      const ex = sx + Math.sin(t * 1.3 + ph) * 40;
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(sx * k, 8 * k);
      ctx.lineTo((ex - 14) * k, 70 * k);
      ctx.lineTo((ex + 14) * k, 70 * k);
      ctx.closePath();
      ctx.fill();
    });
    // escenario y estructura
    px(20, 12, 120, 3, "#3a3550");
    px(20, 12, 3, 52, "#3a3550");
    px(137, 12, 3, 52, "#3a3550");
    for (let x = 26; x < 136; x += 12) px(x, 15, 3, 2, ["#e0548c", "#7fd0e8", "#e3b04b"][((x / 12) + Math.floor(t * 3)) % 3 | 0]);
    // cartel
    px(46, 19, 68, 11, "#0f0c1d");
    px(46, 19, 68, 1, "#e0548c");
    px(46, 29, 68, 1, "#e0548c");
    ctx.fillStyle = "#fbe9c4";
    ctx.font = `${7 * k}px "Pixelify Sans", monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("TAN BIÓNICA", 80 * k, 25 * k);
    // tarima
    px(20, 58, 120, 6, "#2a2440");
    px(20, 58, 120, 1, "#4c4468");
    // la banda (siluetas que se mueven al ritmo)
    band.forEach((m, i) => {
      const bob = Math.round(Math.abs(Math.sin(t * 4 + i)) * 1.5);
      const x = m.x;
      const y = 40 - bob;
      px(x + 2, y, 4, 4, "#0b0914");          // cabeza
      px(x + 1, y + 4, 6, 9, "#0b0914");      // cuerpo
      px(x + 1, y + 13, 2, 5, "#0b0914");     // piernas
      px(x + 5, y + 13, 2, 5, "#0b0914");
      if (m.kind === "guitar" || m.kind === "bass") px(x - 1, y + 7, 9, 2, "#6b3f2a");
      if (m.kind === "mic") px(x + 8, y + 3, 1, 15, "#888");
      if (m.kind === "drums") { px(x - 3, y + 12, 12, 6, "#2f2a44"); px(x - 3, y + 12, 12, 1, "#e3b04b"); }
    });
    // público saltando (cabezas y brazos)
    crowd.forEach((c, i) => {
      const jump = Math.max(0, Math.sin(t * 5 + c.phase)) * 3;
      const y = 74 - jump;
      const col = ["#120f22", "#17132b", "#0e0b1b"][c.hue];
      px(c.x, y, 6, 6, col);
      px(c.x - 1, y + 6, 8, 30, col);
      if (i % 4 === 0) { px(c.x - 2, y - 6 + jump, 2, 7, col); px(c.x + 6, y - 6 + jump, 2, 7, col); }
      if (i % 7 === 3) px(c.x + 1, y - 9 + jump, 3, 3, "#fff6c4"); // una lucecita de celular
    });
    // papelitos
    bits.forEach((b) => {
      b.y += b.v / 60;
      if (b.y > H) { b.y = -2; b.x = Math.random() * W; }
      px(b.x, b.y, 1, 1, b.c);
    });
    raf = requestAnimationFrame(draw);
  };

  page.onEnter = () => {
    resize();
    if (!raf) {
      t0 = performance.now();
      raf = requestAnimationFrame(draw);
    }
    buddy.say("El 31 nos vemos ahí.", "love");
    setTimeout(() => confetti.rain(120), 400);
    window.Pixel?.sfx("power");
  };
  addEventListener("resize", () => { if (raf) resize(); });
  return page;
}

/* ───────── Fotos: polaroids pegadas en las hojas ───────── */

const TILTS = [5, -4, -6, 4, 3, -5, 4];

// Arma los marcos ya (la cantidad viene en el regalo) y los llena cuando se descifran las fotos
function photoSlots(gift) {
  const captions = (gift.fotos || []).map((f) => f.texto || "");
  let photos = null;
  const waiting = []; // hojas que necesitan las fotos ya descifradas (la del detalle escondido)
  const frames = captions.map((caption, i) => {
    const img = el("img", { alt: caption, decoding: "async" });
    const btn = el("button", { class: "polaroid is-loading", type: "button", "aria-label": caption || `Ver foto ${i + 1}`,
      onclick: () => {
        if (!photos?.[i]) return;
        // el visor recorre solo las fotos que se pudieron descifrar
        const ok = photos.map((p, j) => (p ? j : -1)).filter((j) => j >= 0);
        openViewer(ok.map((j) => photos[j]), ok.map((j) => captions[j]), ok.indexOf(i));
      } },
      el("span", { class: `tape tape--polaroid${i % 2 ? " tape--washi" : ""}`, "aria-hidden": "true" }),
      img,
      el("span", { class: "polaroid__cap", text: caption }));
    btn.style.setProperty("--tilt", `${TILTS[i % TILTS.length]}deg`);
    return btn;
  });

  return {
    frames,
    whenLoaded(cb) {
      if (photos) cb(photos);
      else waiting.push(cb);
    },
    async load(key) {
      if (!frames.length || !key) return;
      try { photos = await decryptPhotos(key); } catch { return; }
      photos.forEach((p, i) => {
        const frame = frames[i];
        if (!frame || !p) return;
        frame.querySelector("img").src = p.url;
        frame.classList.remove("is-loading");
        // las verticales van en marco vertical (tipo Instax) para no cortar caras
        if (p.h > p.w) frame.classList.add("polaroid--tall");
      });
      waiting.splice(0).forEach((cb) => cb(photos));
    },
  };
}

function openViewer(photos, captions, start) {
  let i = start;
  const img = el("img", { class: "viewer__img", alt: "" });
  const caption = el("p", { class: "viewer__caption" });
  const count = el("span", { class: "viewer__count" });
  const prev = el("button", { class: "viewer__nav viewer__nav--prev", type: "button", "aria-label": "Anterior", text: "‹" });
  const next = el("button", { class: "viewer__nav viewer__nav--next", type: "button", "aria-label": "Siguiente", text: "›" });
  const close = el("button", { class: "viewer__close", type: "button", "aria-label": "Cerrar", text: "×" });
  const stage = el("div", { class: "viewer__stage" }, img);
  const dialog = el("dialog", { class: "viewer", "aria-label": "Fotos" },
    el("div", { class: "viewer__bar" }, count, close), stage, prev, next, caption);

  const show = (n, dir = 0) => {
    i = (n + photos.length) % photos.length;
    const shown = i;
    img.src = photos[i].url;
    photos[i].full().then((u) => { if (i === shown) img.src = u; }).catch(() => {});
    img.alt = captions[i];
    caption.textContent = captions[i];
    caption.hidden = !captions[i];
    count.textContent = `${i + 1} / ${photos.length}`;
    img.classList.remove("from-left", "from-right");
    if (dir) {
      void img.offsetWidth;
      img.classList.add(dir > 0 ? "from-right" : "from-left");
    }
  };
  const single = photos.length < 2;
  prev.hidden = next.hidden = single;
  prev.addEventListener("click", () => show(i - 1, -1));
  next.addEventListener("click", () => show(i + 1, 1));
  close.addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", (e) => { if (e.target === dialog || e.target === stage) dialog.close(); });
  dialog.addEventListener("keydown", (e) => {
    if (e.key === "ArrowLeft" && !single) show(i - 1, -1);
    if (e.key === "ArrowRight" && !single) show(i + 1, 1);
  });
  dialog.addEventListener("close", () => { dialog.remove(); document.documentElement.classList.remove("no-scroll"); });

  // deslizar para pasar de foto
  let x0 = null;
  stage.addEventListener("pointerdown", (e) => { x0 = e.clientX; });
  stage.addEventListener("pointerup", (e) => {
    if (x0 == null || single) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 45) show(i + (dx < 0 ? 1 : -1), dx < 0 ? 1 : -1);
  });

  document.body.append(dialog);
  document.documentElement.classList.add("no-scroll");
  show(start);
  dialog.showModal();
}

/* ───────── Confetti ───────── */

const confetti = (() => {
  const canvas = $("#confetti");
  const ctx = canvas.getContext("2d");
  const COLORS = ["#c2456b", "#e07a9a", "#f4b6c8", "#ffffff", "#fbeef1", "#e3c47e"];
  let parts = [];
  let raf = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = innerWidth * dpr;
    canvas.height = innerHeight * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  addEventListener("resize", resize);
  resize();

  function piece(x, y, vx, vy) {
    return {
      x, y, vx, vy,
      w: 6 + ((Math.random() * 3) | 0) * 3,
      h: 0,
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - .5) * .25,
      flip: Math.random() * Math.PI,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      round: false,
    };
  }

  function tick() {
    // borrar el canvas entero (no solo innerWidth×innerHeight): si la ventana cambió, no quedan restos en los bordes
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    parts = parts.filter((p) => p.y < innerHeight + 30);
    for (const p of parts) {
      p.vx *= .985;
      p.vy = p.vy * .985 + .28;
      p.x += p.vx + Math.sin(p.flip) * .6;
      p.y += p.vy;
      p.rot += p.vrot;
      p.flip += .14;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(Math.round(-p.w / 2), Math.round(-p.w / 2), p.w, p.w); // cuadradito: confeti de píxeles
      }
      ctx.restore();
    }
    raf = parts.length ? requestAnimationFrame(tick) : 0;
  }

  const start = () => {
    if (raf) return;
    resize(); // por si la ventana cambió desde la última vez
    raf = requestAnimationFrame(tick);
  };

  return {
    burst(x = innerWidth / 2, y = innerHeight / 2, count = 120) {
      if (reduceMotion) return;
      for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const v = 4 + Math.random() * 10;
        parts.push(piece(x, y, Math.cos(a) * v, Math.sin(a) * v - 6));
      }
      start();
    },
    rain(count = 140) {
      if (reduceMotion) return;
      for (let i = 0; i < count; i++) {
        parts.push(piece(Math.random() * innerWidth, -20 - Math.random() * innerHeight * .6, (Math.random() - .5) * 2, Math.random() * 3));
      }
      start();
    },
  };
})();

/* ───────── El personajito y la búsqueda de QRs ───────── */

// La bienvenida: el QR de atrás de la carta abre esto; después viene el cuaderno
const ESCENAS = {
  inicio: [
    "?¡Hola, Lu!",
    "Soy yo… bueno, una versión mía en píxeles.",
    "!Te preparé algo.",
    "Pensaste que era solo una carta, ¿no?",
    "Pero no te la voy a hacer tan fácil.",
    "Dentro de tu pieza escondí algunas palabras.",
    "Vas a tener que encontrarlas.",
    "Cada una te lleva a la siguiente.",
    "!¡Empecemos!",
  ],
};

/* ───────── Búsqueda de palabras (antes del candado) ───────── */

// Cada pista es solo una imagen: la compu, el baño y Snoopy. Las palabras no están en el código:
// se comparan por su huella (SHA-256), así no se pueden espiar.
const PALABRAS = [
  { icono: "laptop", largo: 9, huella: "2f52026cd52dd911992e55ec8d3b20db79c6aadfa2ea6b5b9163fa481eb18d1a", pista: "Donde paso horas…", dice: "La primera palabra está escondida acá:" },
  { icono: "toilet", largo: 8, huella: "d0177aafe46113976e5de3d9b046dd334ca50afb626ca08b85fa1e01b5e759f6", pista: "Donde te lavás los dientes…", dice: "¡Bien! La siguiente está acá:" },
  { icono: "snoopy", largo: 4, huella: "028f9e382a4b60276de62e97564b261b1ec61bc340857a5331de0a5efb03325c", pista: "Lo cuida alguien que te regalé.", dice: "¡Una más! Buscala acá:" },
];
const PALABRAS_KEY = "regalo-lu:palabras";
const palabrasHechas = () => { try { return Number(sessionStorage.getItem(PALABRAS_KEY)) || 0; } catch { return 0; } };

async function huella(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`regalo-lu:${text}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Arma las 3 hojas entre la carta de la portada y el candado; devuelve una función que arranca la búsqueda
function buildWordHunt() {
  const done = palabrasHechas();
  const pages = PALABRAS.map((p, i) => {
    const field = codeField(p.largo, false);
    const msg = el("p", { class: "code__msg", role: "status", "aria-live": "polite" });
    const hint = el("p", { class: "lock__hint", text: p.pista, hidden: true });
    const hintBtn = el("button", { class: "hint-btn", type: "button", text: "¿Pista?" });
    hintBtn.addEventListener("click", () => { hint.hidden = !hint.hidden; });
    const icon = el("div", { class: "word__icon" }, window.Pixel?.icon(p.icono, { scale: 8 }).el ?? null);
    const section = el("section", { class: "notebook page page--word", "aria-label": `Palabra ${i + 1}` },
      el("p", { class: "mission__tag", text: `PALABRA ${i + 1}/${PALABRAS.length}` }),
      icon, field.el, msg, hintBtn, hint);
    let tries = 0;
    field.onComplete = async (v) => {
      if ((await huella(v)) === p.huella) {
        field.input.blur();
        field.input.disabled = true;
        field.tilesBox.classList.add("is-ok");
        icon.classList.add("is-done");
        window.Pixel?.sfx("coin");
        const r = icon.getBoundingClientRect();
        confetti.burst(r.left + r.width / 2, r.top + r.height / 2, 120);
        vibrate([30, 40, 90]);
        try { sessionStorage.setItem(PALABRAS_KEY, String(i + 1)); } catch {}
        await sleep(1300);
        window.Pixel?.sfx("page");
        await turnAway(section);
        if (i + 1 < PALABRAS.length) buddy.say(PALABRAS[i + 1].dice, "happy", 4000);
        else buddy.say("¡Las encontraste todas! Ahora, la última: está en la carta…", "happy", 5000);
        return;
      }
      msg.textContent = ["Esa no es.", "Tampoco… mirá bien.", "Casi. Probá de nuevo."][tries++ % 3];
      window.Pixel?.sfx("error");
      field.tilesBox.classList.remove("is-error");
      void field.tilesBox.offsetWidth;
      field.tilesBox.classList.add("is-error");
      vibrate([60, 40, 60]);
      setTimeout(() => { field.set(""); field.input.focus(); }, 650);
    };
    if (i < done) section.classList.add("is-turned", "is-gone");
    return section;
  });
  // en el DOM, antes = más abajo: candado, palabra 3, palabra 2, palabra 1, carta de la portada
  const intro = $("#page-intro");
  [...pages].reverse().forEach((section) => bookEl.insertBefore(section, intro));
  return () => buddy.say(done < PALABRAS.length ? PALABRAS[done].dice : "La última palabra está escondida en la carta…", "normal", 4000);
}

const FIN_ESCENA = {
  inicio: ["MISIÓN", "Encontrá el QR correcto", "Buscá los QR escondidos y escanealos con la cámara del celular. Esta página ya la podés cerrar."],
  señuelo: ["¿CONTINUAR?", "Escaneá otro QR", "Seguí buscando: el correcto está escondido en otro lado."],
};

// Pantalla retro: "TOCÁ PARA EMPEZAR" (ese toque habilita el sonido) → el personajito habla → fin o cuaderno
async function runScene(kind, lines) {
  document.documentElement.classList.add("is-scene");
  const scene = $("#scene");
  scene.hidden = false;
  const sprite = window.Pixel?.sprite("tobi", { scale: 7 });
  sprite?.setMood("sleep"); // arranca dormido y se despierta al tocar "empezar"
  const start = el("button", { class: "scene__start", type: "button", text: { inicio: "▶ EMPEZAR JUEGO", señuelo: "▶ CONTINUAR", correcto: "▶ EMPEZAR JUEGO" }[kind] });
  const dialogBox = el("div", { class: "scene__dialog" });
  const end = el("div", { class: "scene__end", hidden: true });
  scene.replaceChildren(el("div", { class: "scene__inner" },
    el("p", { class: "scene__title", text: "PARA LU" }),
    el("div", { class: "scene__sprite" }, sprite?.el ?? null),
    start, dialogBox, end));

  await new Promise((resolve) => start.addEventListener("click", resolve, { once: true }));
  window.Pixel?.unlockAudio();
  start.remove();
  scene.classList.add("is-talking");
  await sprite?.wake(); // va abriendo los ojos
  if (window.Pixel) {
    await window.Pixel.dialog(dialogBox, { who: "tobi", lines, name: "TOBI", sprite });
  } else {
    // sin el módulo de píxeles: las líneas de a una, tocando para seguir
    for (const line of lines) {
      dialogBox.textContent = line.replace(/^[!?]/, "");
      await tapOn(dialogBox);
    }
  }
  if (kind === "correcto") {
    // antes de abrir el cuaderno: subir el volumen (hay música, sonidos y una canción para adivinar)
    end.hidden = false;
    const test = el("button", { class: "scene__btn", type: "button", text: "♪ PROBAR SONIDO" });
    const go = el("button", { class: "scene__start scene__start--go", type: "button", text: "LISTO ▶" });
    end.append(
      el("strong", { text: "¡SUBÍ EL VOLUMEN!" }),
      el("span", { text: "Este juego tiene sonido. Ponelo al máximo." }),
      el("div", { class: "scene__btns" }, test, go));
    sprite?.setMood("surprised");
    test.addEventListener("click", () => window.Pixel?.sfx("power"));
    await new Promise((resolve) => go.addEventListener("click", resolve, { once: true }));
    sprite?.setMood("happy");
    scene.classList.add("is-leaving");
    await sleep(700);
    scene.hidden = true;
    scene.replaceChildren();
    sprite?.destroy();
    document.documentElement.classList.remove("is-scene");
    return;
  }
  const [title, sub, help] = FIN_ESCENA[kind];
  end.append(el("strong", { text: title }), el("span", { text: sub }), el("small", { text: help }));
  end.hidden = false;
  sprite?.setMood(kind === "inicio" ? "happy" : "normal");
}

// El personajito acompaña chiquito abajo del cuaderno y comenta en los momentos clave
const buddy = (() => {
  let sprite = null;
  let anchor = null;
  return {
    show() {
      if (!window.Pixel || sprite) return;
      document.documentElement.classList.add("has-buddy");
      sprite = window.Pixel.sprite("tobi", { scale: 3 });
      anchor = el("div", { class: "buddy" }, sprite.el);
      anchor.addEventListener("click", () => window.Pixel.blip("tobi"));
      document.body.append(anchor);
      hud.show();
      fitBook();
    },
    say(text, mood = "normal", duration = 3200) {
      if (!sprite) return false;
      sprite.setMood(mood);
      window.Pixel.bubble(anchor, text, { who: "tobi", duration })
        .then(() => sprite?.setMood("normal"))
        .catch(() => {});
      return true;
    },
  };
})();

// HUD del juego: nivel (hoja actual) y un corazón por cada prueba superada
const hud = (() => {
  let box = null;
  const pruebas = () => [true, ...book.pages.filter((p) => p.key).map((p) => Boolean(state?.[p.key]))];
  return {
    show() {
      if (box || !window.Pixel) return;
      box = el("div", { class: "hud", "aria-hidden": "true" });
      document.body.append(box);
      this.refresh();
    },
    refresh() {
      if (!box) return;
      const hearts = pruebas().map((ok) => {
        const icon = window.Pixel.icon("heart", { scale: 2 }).el;
        if (!ok) icon.classList.add("is-empty");
        return icon;
      });
      box.replaceChildren(
        el("span", { class: "hud__lvl", text: `NIVEL ${book.index + 1}` }),
        el("span", { class: "hud__hearts" }, hearts));
    },
  };
})();

/* ───────── Inicio ───────── */

// el cuaderno aparece recién con las fuentes cargadas: nada de saltos ni letras que cambian
const ready = Promise.race([document.fonts.ready, sleep(2000)]).then(() => {
  document.documentElement.classList.remove("is-loading");
});

const saved = store.get();
if (saved?.gift) {
  // recarga: el cuaderno se rearma ya abierto en la hoja donde estaba
  state = saved;
  buddy.show();
  $("#page-intro").classList.add("is-turned", "is-gone");
  $("#page-lock").classList.add("is-turned", "is-gone");
  const pages = buildBook(state.gift, true);
  const at = Math.min(state.page || 0, pages.length - 1);
  pages.slice(0, at).forEach((p) => p.el.classList.add("is-turned", "is-gone", "is-seen"));
  book.index = at;
  cull(at);
  setCurrent(at);
  pages[at].onEnter?.();
} else {
  initLock();
  // adelanto en el candado: polaroids desenfocadas (miniaturas diminutas, sin cifrar; no se reconoce a nadie)
  const TEASE = [[-10, 0], [3, 1], [12, 2]];
  $("#teaser").append(...(window.ADELANTO || []).slice(0, 3).map((src, i) => {
    const p = el("span", { class: "teaser__photo" }, el("span", { class: "teaser__img" }));
    p.firstChild.style.backgroundImage = `url("${src}")`;
    p.style.setProperty("--tilt", `${TEASE[i][0]}deg`);
    p.style.setProperty("--i", TEASE[i][1]);
    return p;
  }));
  // primero el personajito la recibe; después aparece el cuaderno con la carta, que gira sola al rato
  const intro = $("#page-intro");
  let turned = false;
  const turnIntro = () => {
    if (turned) return;
    turned = true;
    turnAway(intro);
  };
  intro.addEventListener("click", turnIntro);
  const startHunt = buildWordHunt();
  ready
    .then(() => runScene("correcto", ESCENAS.inicio))
    .then(() => {
      buddy.show();
      return sleep(2600);
    })
    .then(turnIntro)
    .then(() => sleep(1400))
    .then(startHunt);
}
})();
