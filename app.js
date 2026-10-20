// Regalo para Lu — todo el contenido del regalo llega cifrado en gift.enc.js
// y solo se puede leer con la palabra escondida en la carta.
(() => {
"use strict";

const LEN = 6;
const STORE_KEY = "regalo-lu:v1";
const TZ = "America/Argentina/Buenos_Aires";
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

/* ───────── Navegación entre pantallas ───────── */

async function go(fromId, toId) {
  const from = $(`#${fromId}`);
  const to = $(`#${toId}`);
  if (from && !from.hidden) {
    from.classList.add("is-leaving");
    await sleep(430);
    from.hidden = true;
    from.classList.remove("is-leaving");
  }
  window.scrollTo(0, 0);
  to.hidden = false;
  to.classList.add("is-entering");
  setTimeout(() => to.classList.remove("is-entering"), 950);
}

/* ───────── 1. Candado ───────── */

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
  const tiles = Array.from({ length: LEN }, () => el("span", { class: "tile" }));
  tilesBox.append(...tiles);

  let focused = false;
  let busy = false;
  let attempts = 0;

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
    try {
      const { gift, key } = await decryptGift(v);
      tilesBox.classList.add("is-ok");
      input.blur();
      vibrate(30);
      store.set({ gift, key, revealed: false, answered: false });
      loadPhotosScript().catch(() => {}); // precarga mientras lee la carta
      $("#envelope").classList.add("is-open");
      await sleep(1700);
      await playLetter(gift, key);
    } catch (err) {
      if (err instanceof NetworkError) {
        fail("No se pudo cargar. Probá de nuevo en un rato.", false);
      } else {
        fail(NOPE[attempts++ % NOPE.length], true);
      }
      submit.textContent = "Abrir la carta";
    } finally {
      busy = false;
      form.classList.remove("is-busy");
    }
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

/* ───────── 2. La carta ───────── */

function writeLine(box, text) {
  const STEP = 32;
  const p = el("p");
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
  return { p, duration: reduceMotion ? 0 : i * STEP + 450 };
}

const tapOn = (...targets) => new Promise((resolve) => {
  const done = () => {
    targets.forEach((t) => t.removeEventListener("click", done));
    resolve();
  };
  targets.forEach((t) => t.addEventListener("click", done));
});

async function playLetter(gift, key) {
  await go("lock", "letter");
  const paper = $("#paper");
  const lines = $("#intro-lines");
  const next = $("#intro-next");
  $("#paper-date").textContent = new Intl.DateTimeFormat("es-AR", { timeZone: TZ, day: "numeric", month: "long", year: "numeric" }).format(new Date());
  $("#paper-greeting").textContent = `${gift.nombre}:`;
  lines.textContent = "";

  for (let i = 0; i < gift.intro.length; i++) {
    const last = i === gift.intro.length - 1;
    next.disabled = true;
    next.classList.remove("is-ready");
    const { p, duration } = writeLine(lines, gift.intro[i]);
    // tocar la carta mientras escribe completa la línea al instante
    await Promise.race([sleep(duration), tapOn(paper)]);
    p.classList.add("is-instant");
    next.textContent = last ? "Abrir mi regalo" : "Seguir";
    next.disabled = false;
    next.classList.add("is-ready");
    await tapOn(paper, next);
  }

  next.disabled = true;
  await go("letter", "gift");
  showGift(gift, { key, revealed: false, answered: false });
}

/* ───────── 3. Ticket ───────── */

const fmt = (iso, opts) => new Intl.DateTimeFormat("es-AR", { timeZone: TZ, hour12: false, ...opts }).format(new Date(iso));
const hour = (iso) => fmt(iso, { hour: "2-digit", minute: "2-digit" });

function barcode(seed) {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  const rand = () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296;
  let x = 0;
  let bars = "";
  while (x < 196) {
    const w = 1 + Math.floor(rand() * 3.2);
    bars += `<rect x="${x}" width="${w}" height="54"/>`;
    x += w + 1 + Math.floor(rand() * 2.5);
  }
  return `<svg class="ticket__barcode" viewBox="0 0 200 54" preserveAspectRatio="none" fill="#2a2421" aria-hidden="true">${bars}</svg>`;
}

function buildTicket(gift) {
  const s = gift.show;
  const day = fmt(s.inicio, { day: "2-digit", month: "2-digit" }).replace("/", "");
  const item = (label, value, cls) => el("div", { class: cls }, el("dt", { text: label }), el("dd", {}, ...[].concat(value)));

  return [
    el("header", { class: "ticket__head" },
      el("div", { class: "ticket__kicker" },
        el("span", { text: `Admite ${s.cantidad}` }),
        el("span", { text: fmt(s.inicio, { year: "numeric" }) })),
      el("h2", { class: "ticket__artist", text: s.artista }),
      el("p", { class: "ticket__tour", text: `Gira «${s.gira}»` })),
    el("dl", { class: "ticket__grid" },
      item("Fecha", s.fechaTexto, "span-2"),
      item("Puertas", hour(s.puertas)),
      item("Show", el("span", { class: "big", text: hour(s.inicio) })),
      item("Lugar", [s.lugar, el("small", { text: s.direccion })], "span-2"),
      item("Sector", s.sector),
      item("Titulares", s.titulares.join(" & "))),
    el("footer", { class: "ticket__stub", html: barcode(s.artista + s.inicio) },
      el("div", { class: "ticket__code" },
        el("span", { class: "ticket__admit", text: `×${s.cantidad}` }),
        `Nº ${day}-${String(s.cantidad).padStart(2, "0")}`)),
  ];
}

/* ───────── Raspadita ───────── */

async function setupScratch(canvas, onDone) {
  try { await Promise.race([document.fonts.ready, sleep(1200)]); } catch {}
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const { width: w, height: h } = canvas.getBoundingClientRect();
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
  ctx.font = `italic 600 ${Math.round(Math.min(w / 8, 46))}px Fraunces, Georgia, serif`;
  ctx.fillText("Rascá acá", w / 2, h / 2 - 8);
  ctx.font = `500 12px "IBM Plex Mono", ui-monospace, monospace`;
  ctx.fillStyle = "rgba(74, 50, 14, .6)";
  ctx.fillText("C O N   E L   D E D O", w / 2, h / 2 + 24);
  ctx.font = `400 22px Fraunces, Georgia, serif`;
  ctx.fillText("✦", w / 2, h / 2 - 66);

  ctx.globalCompositeOperation = "destination-out";
  ctx.strokeStyle = "#000"; // opaco: borra la lámina del todo
  ctx.fillStyle = "#000";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(38, w / 9);

  let last = null;
  let moves = 0;
  let finished = false;
  const point = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
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

/* ───────── Confetti ───────── */

const confetti = (() => {
  const canvas = $("#confetti");
  const ctx = canvas.getContext("2d");
  const COLORS = ["#9b2c2c", "#c99a45", "#e9cd8f", "#1f2543", "#e7a3a6", "#fbf6ec"];
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
    ctx.clearRect(0, 0, innerWidth, innerHeight);
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

  const start = () => { if (!raf) raf = requestAnimationFrame(tick); };

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

/* ───────── Regalo: ticket → pregunta → después del sí ───────── */

function showGift(gift, state) {
  const ticket = $("#ticket");
  const shadow = $("#ticket-shadow");
  const canvas = $("#scratch");
  const skip = $("#scratch-skip");
  const eyebrow = $("#gift-eyebrow");
  ticket.replaceChildren(...buildTicket(gift));

  const save = (patch) => { Object.assign(state, patch); store.set({ gift, ...state }); };

  const onRevealed = (instant) => {
    skip.hidden = true;
    eyebrow.textContent = "Tu regalo";
    enableTilt(shadow);
    if (!instant) {
      ticket.classList.add("is-shining");
      const r = shadow.getBoundingClientRect();
      confetti.burst(r.left + r.width / 2, r.top + r.height * .35, 150);
      setTimeout(() => confetti.rain(90), 350);
      vibrate([40, 30, 90]);
    }
    save({ revealed: true });
    setTimeout(() => showQuestion(gift, state, save, instant), instant ? 0 : 1300);
  };

  if (state.revealed) {
    canvas.remove();
    onRevealed(true);
    return;
  }

  eyebrow.textContent = "Algo para vos";
  const wrap = ticket.parentElement;
  wrap.classList.add("is-covered");
  requestAnimationFrame(async () => {
    const finish = await setupScratch(canvas, () => onRevealed(false));
    wrap.classList.remove("is-covered");
    setTimeout(() => {
      if (!state.revealed) skip.hidden = false;
    }, 9000);
    skip.addEventListener("click", finish, { once: true });
  });
}

function enableTilt(target) {
  if (reduceMotion || !matchMedia("(hover: hover)").matches) return;
  target.addEventListener("pointermove", (e) => {
    const r = target.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - .5;
    const y = (e.clientY - r.top) / r.height - .5;
    target.style.setProperty("--ry", `${x * 10}deg`);
    target.style.setProperty("--rx", `${-y * 8}deg`);
  });
  target.addEventListener("pointerleave", () => {
    target.style.setProperty("--ry", "0deg");
    target.style.setProperty("--rx", "0deg");
  });
}

function showQuestion(gift, state, save, instant) {
  const rest = $("#gift-rest");
  if (state.answered) {
    rest.replaceChildren(buildAfter(gift, state.key));
    return;
  }

  const yes = el("button", { class: "btn btn--wax", type: "button", text: "¡Sí!" });
  const no = el("button", { class: "btn btn--ghost btn--no", type: "button", text: "No" });
  const actions = el("div", { class: "question__actions" }, yes, no);
  const question = el("div", { class: `question${instant ? "" : " reveal-in"}` },
    el("h2", { class: "question__text", text: gift.pregunta }),
    actions);
  rest.replaceChildren(question);
  if (!instant) question.scrollIntoView({ behavior: "smooth", block: "center" });

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
      no.classList.replace("btn--ghost", "btn--wax");
      return;
    }
    const box = actions.getBoundingClientRect();
    const b = no.getBoundingClientRect();
    const maxX = box.width - b.width;
    const maxY = box.height - b.height;
    let x;
    let y;
    do {
      x = Math.random() * maxX;
      y = Math.random() * maxY;
    } while (Math.hypot(x - (b.left - box.left), y - (b.top - box.top)) < 70);
    no.classList.add("is-running");
    no.style.left = `${x}px`;
    no.style.top = `${y}px`;
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
    const after = buildAfter(gift, state.key);
    after.classList.add("reveal-in");
    rest.replaceChildren(after);
    after.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

/* ───────── Después del sí ───────── */

const ICON = {
  pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
  cal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/></svg>',
  play: '<svg viewBox="0 0 10 12" fill="currentColor" aria-hidden="true"><path d="M0 0l10 6-10 6z"/></svg>',
};

function buildAfter(gift, key) {
  const s = gift.show;
  return el("div", { class: "after" },
    el("p", { class: "after__yes", text: gift.respuestaSi }),
    el("section", { class: "card", "aria-label": "Cuenta regresiva" },
      el("h3", { class: "card__title", text: "Faltan" }),
      countdown(s.inicio)),
    el("div", { class: "actions" },
      el("a", { class: "btn btn--ink", href: s.mapsUrl, target: "_blank", rel: "noopener", html: `${ICON.pin}<span>Cómo llegar</span>` }),
      el("button", { class: "btn btn--ghost", type: "button", html: `${ICON.cal}<span>Agendar</span>`, onclick: () => addToCalendar(gift) })),
    el("section", { class: "card" },
      el("h3", { class: "card__title", text: "Para ir escuchando" }),
      el("ol", { class: "setlist" },
        gift.canciones.map((song, i) => el("li", {},
          el("a", { href: `https://open.spotify.com/search/${encodeURIComponent(`${s.artista} ${song}`)}`, target: "_blank", rel: "noopener" },
            el("span", { class: "setlist__n", text: String(i + 1).padStart(2, "0") }),
            el("span", { class: "setlist__t", text: song }),
            el("span", { class: "setlist__play", html: ICON.play })))))),
    gift.fotos?.length && key ? photoGrid(gift, key) : null,
    el("p", { class: "closing", text: gift.final }),
    el("p", { class: "closing__sign", text: `— ${gift.firma}` }));
}

/* ───────── Fotos ───────── */

function photoGrid(gift, key) {
  const captions = gift.fotos.map((f) => f.texto || "");
  // casilleros con la proporción ya reservada, se llenan al descifrar
  const slots = (window.FOTOS_ENC || captions).map((f) => {
    const slot = el("div", { class: "photo is-loading" });
    slot.style.aspectRatio = f.w ? `${f.w} / ${f.h}` : "4 / 5";
    return slot;
  });
  const grid = el("div", { class: "photos" }, slots);
  const section = el("section", { class: "card card--photos" }, el("h3", { class: "card__title", text: "Fotos" }), grid);

  decryptPhotos(key).then((photos) => {
    grid.replaceChildren(...photos.map((p, i) => {
      const btn = el("button", { class: "photo", type: "button", "aria-label": captions[i] || `Ver foto ${i + 1}`, onclick: () => openViewer(photos, captions, i) },
        el("img", { src: p.url, width: p.w, height: p.h, alt: captions[i], loading: "lazy", decoding: "async" }));
      btn.style.animationDelay = `${Math.min(i, 12) * 60}ms`;
      return btn;
    }));
  }).catch(() => section.remove());

  return section;
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
    parts.forEach((v, i) => { nums[i].textContent = String(v).padStart(2, "0"); });
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

/* ───────── Inicio ───────── */

const saved = store.get();
if (saved?.gift) {
  $("#lock").hidden = true;
  $("#gift").hidden = false;
  showGift(saved.gift, { key: saved.key, revealed: Boolean(saved.revealed), answered: Boolean(saved.answered) });
} else {
  initLock();
}
})();
