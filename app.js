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
const save = (patch) => { Object.assign(state, patch); store.set(state); };

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
    document.head.append(el("script", { src: "fotos.enc.js", onload: resolve, onerror: reject }));
  });
  return photosScript;
}

async function decryptPhotos(keyB64) {
  await loadPhotosScript();
  const key = await crypto.subtle.importKey("raw", fromB64(keyB64), "AES-GCM", false, ["decrypt"]);
  return Promise.all((window.FOTOS_ENC || []).map(async (f) => {
    const buf = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(f.iv) }, key, fromB64(f.data));
    return { url: URL.createObjectURL(new Blob([buf], { type: f.type })), w: f.w, h: f.h };
  }));
}

/* ───────── El cuaderno: hojas apiladas que se pasan hacia adelante y atrás ───────── */

const bookEl = $("#book");
const book = { pages: [], index: 0, busy: false };

function makePage(cls, label) {
  const body = el("div", { class: "page__body" });
  const prev = el("button", { class: "page__turn page__turn--prev", type: "button", text: "‹ Volver" });
  const next = el("button", { class: "page__turn page__turn--next", type: "button", text: "Seguir ›" });
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
    p.num.textContent = String(i + 1);
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

// El cuaderno tiene tamaño fijo de diseño y se escala para entrar entero en la pantalla
let fitScale = 1;
const typing = () => document.activeElement?.matches?.("input") ?? false;
function fitBook() {
  if (typing()) return keepFieldVisible(); // el teclado no achica el cuaderno
  const W = 392;
  const H = 680;
  fitScale = Math.min((innerWidth - 20) / W, (innerHeight - 28) / H, 1.25);
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
  if (forward && !pages[book.index].ready) return;
  book.busy = true;
  setCurrent(target);
  paperSound.play();
  vibrate(8);
  const page = forward ? pages[book.index].el : pages[target].el;
  const start = from ?? (forward ? 0 : 1);
  const end = forward ? 1 : 0;
  const ms = from == null ? TURN_MS : Math.max(260, Math.abs(end - start) * TURN_MS);
  await animateTurn(page, start, end, ms, from == null);
  book.index = target;
  book.busy = false;
  save({ page: target });
  pages[target].onEnter?.();
}

// Arrastrar la hoja con el dedo: sigue al dedo en 3D y al soltar termina de girar o vuelve
(() => {
  const NO_DRAG = "button, a, input, .scratch, .glued, .question__actions, .code, .code__field, .detail__photo, dialog";
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
      if (forward ? i >= book.pages.length - 1 || !book.pages[i].ready : i === 0) { d = null; return; }
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

function buildBook(gift, restoring) {
  const photos = photoSlots(gift);
  const n = photos.frames.length;
  // 1 foto en la carta, 1 bajo la entrada, la última en el cierre y las del medio en collages de hasta 4
  const middle = [];
  for (let i = 2; i < n - 1; i += 4) middle.push(photos.frames.slice(i, Math.min(i + 4, n - 1)));

  const pages = [
    letterPage(gift, photos.frames[0], restoring),
    gift.numero?.codigo ? numberPage(gift) : null,
    gift.detalle ? detailPage(gift, photos) : null,
    ticketPage(gift, photos.frames[1]),
    questionPage(gift),
    setlistPage(gift),
    ...middle.map((frames) => photoPage(frames)),
    finalPage(gift, n > 2 ? photos.frames[n - 1] : null),
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
      }
      submit.textContent = "Abrir";
      busy = false;
      form.classList.remove("is-busy");
      return;
    }

    tilesBox.classList.add("is-ok");
    msg.textContent = "";
    input.blur();
    vibrate(30);
    state = { gift: unlocked.gift, key: unlocked.key, revealed: false, answered: false, page: 0 };
    store.set(state);
    loadPhotosScript().catch(() => {}); // precarga mientras gira la hoja
    const pages = buildBook(state.gift, false);
    await sleep(900); // deja ver la ola de letras
    setCurrent(0);
    paperSound.play();
    await turnAway($("#page-lock"));
    pages[0].onEnter();
  });

  function fail(text, clear) {
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
  return { p, duration: reduceMotion || instant ? 0 : i * STEP + 450 };
}

const tapOn = (target) => new Promise((resolve) => target.addEventListener("click", () => resolve(), { once: true }));

function letterPage(gift, frame, restoring) {
  const page = makePage("notebook--lined page--letter", "Carta");
  const lines = el("div", { class: "paper__lines", "aria-live": "polite" });
  page.body.append(
    el("p", { class: "paper__date", text: gift.fecha }),
    // el saludo y las líneas comparten renglones: cada línea queda apoyada sobre el suyo
    el("div", { class: "paper__ruled ruled" },
      el("p", { class: "paper__greeting", text: `${gift.nombre}:` }),
      lines));
  if (frame) page.el.append(el("div", { class: "stuck stuck--letter" }, frame));

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

function ticketPage(gift, frame) {
  const page = makePage("page--gift", "Tu regalo");
  const ticket = buildTicket(gift);
  const canvas = el("canvas", { class: "scratch", "aria-hidden": "true" });
  const wrap = el("div", { class: "ticket-wrap is-covered" }, ticket, canvas);
  const skip = el("button", { class: "skip-btn", type: "button", text: "¿No te deja rascar? Tocá acá", hidden: true });
  page.body.append(
    el("div", { class: "glued" }, wrap,
      el("span", { class: "tape tape--tl", "aria-hidden": "true" }),
      el("span", { class: "tape tape--br", "aria-hidden": "true" })),
    skip,
    frame ? el("div", { class: "stuck stuck--gift" }, frame) : null);

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

  // lámina dorada
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#b48c3c");
  g.addColorStop(.28, "#ead199");
  g.addColorStop(.52, "#c49b4b");
  g.addColorStop(.78, "#f0dcaa");
  g.addColorStop(1, "#a88130");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(110, 78, 25, .1)";
  ctx.lineWidth = 1;
  for (let x = -h; x < w; x += 6) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + h, h);
    ctx.stroke();
  }
  for (let i = 0; i < (w * h) / 60; i++) {
    ctx.fillStyle = Math.random() < .5 ? `rgba(255,255,255,${Math.random() * .35})` : `rgba(90,60,15,${Math.random() * .18})`;
    ctx.fillRect(Math.random() * w, Math.random() * h, 1.2, 1.2);
  }
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(74, 50, 14, .82)";
  ctx.font = `italic 600 ${Math.round(Math.min(w / 7, 46))}px "Cormorant Garamond", Garamond, Georgia, serif`;
  ctx.fillText("Rascá acá", w / 2, h / 2 + 4);
  ctx.font = `500 10px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.fillStyle = "rgba(74, 50, 14, .6)";
  ctx.fillText("C O N   E L   D E D O", w / 2, h / 2 + 30);
  ctx.font = `400 18px Georgia, serif`;
  ctx.fillText("✦", w / 2, h / 2 - 34);

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

function questionPage(gift) {
  const page = makePage("page--question", "Pregunta");
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
function numberPage(gift) {
  const page = makePage("page--number", "Te falta algo");
  const cfg = gift.numero;
  const code = normalizePassword(String(cfg.codigo)).replace(/[^A-Z0-9]/g, "");
  // la lata en 3D: flota, la etiqueta gira; al tocarla da una vuelta rápida y salta
  const box = el("button", { class: "can", type: "button", "aria-label": "La lata" },
    el("span", { class: "can__glow" }), el("span", { class: "can__body" }), el("span", { class: "can__lid" }));
  const canWrap = el("div", { class: "can-wrap" }, box, el("span", { class: "can__shadow" }));
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
      solved();
      const r = box.getBoundingClientRect();
      confetti.burst(r.left + r.width / 2, r.top, 140);
      vibrate([30, 40, 90]);
      setReady(page);
      return;
    }
    msg.textContent = NOPE[tries++ % NOPE.length];
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
  const cfg = gift.detalle;
  const img = el("img", { class: "detail__img", alt: "", decoding: "async" });
  const heart = el("button", { class: "detail__heart", type: "button", "aria-label": "Algo escondido" }, el("span", { text: "♥" }));
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
  });
  heart.addEventListener("click", () => {
    save({ detalle: true });
    found();
    const r = heart.getBoundingClientRect();
    confetti.burst(r.left + r.width / 2, r.top + r.height / 2, 150);
    vibrate([30, 40, 90]);
    setReady(page);
  });
  return page;
}

/* ───────── Hojas: canciones, fotos y cierre ───────── */

function setlistPage(gift) {
  const page = makePage("page--setlist", "Canciones");
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
  3: [[2, 0, 58, -6], [40, 24, 56, 6], [6, 56, 56, 3]],
  4: [[0, 0, 56, -6], [44, 4, 54, 5], [4, 50, 54, 4], [46, 52, 52, -5]],
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
    frame ? el("div", { class: "stuck stuck--final" }, frame) : null,
    el("p", { class: "closing", text: gift.final }),
    el("p", { class: "closing__sign", text: `— ${gift.firma}` }));

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
      onclick: () => photos && openViewer(photos, captions, i) },
      el("span", { class: "tape tape--polaroid", "aria-hidden": "true" }),
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
        if (!frame) return;
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
    img.src = photos[i].url;
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
      w: 6 + Math.random() * 6,
      h: 9 + Math.random() * 9,
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - .5) * .25,
      flip: Math.random() * Math.PI,
      color: COLORS[(Math.random() * COLORS.length) | 0],
      round: Math.random() < .18,
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
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.flip));
      ctx.fillStyle = p.color;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.w / 2, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
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

/* ───────── Inicio ───────── */

// el cuaderno aparece recién con las fuentes cargadas: nada de saltos ni letras que cambian
const ready = Promise.race([document.fonts.ready, sleep(2000)]).then(() => {
  document.documentElement.classList.remove("is-loading");
});

const saved = store.get();
if (saved?.gift) {
  // recarga: el cuaderno se rearma ya abierto en la hoja donde estaba
  state = saved;
  $("#page-intro").classList.add("is-turned", "is-gone");
  $("#page-lock").classList.add("is-turned", "is-gone");
  const pages = buildBook(state.gift, true);
  const at = Math.min(state.page || 0, pages.length - 1);
  pages.slice(0, at).forEach((p) => p.el.classList.add("is-turned", "is-gone", "is-seen"));
  book.index = at;
  setCurrent(at);
  pages[at].onEnter?.();
} else {
  initLock();
  // al entrar se ve la carta; al segundo la hoja gira sola (o antes, si la toca)
  const intro = $("#page-intro");
  let turned = false;
  const turnIntro = () => {
    if (turned) return;
    turned = true;
    turnAway(intro);
  };
  intro.addEventListener("click", turnIntro);
  ready.then(() => sleep(1800)).then(turnIntro);
}
})();
