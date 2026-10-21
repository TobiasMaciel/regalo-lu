/* pixel.js — personajitos pixel art + diálogo retro con blips.
   Script clásico (sin módulos). Expone window.Pixel.

   API:
     Pixel.unlockAudio()
     Pixel.sprite(who, { scale })            -> { el, talk(on), setMood(m), destroy(), blink(ms), wake() }
     Pixel.heart({ scale })                  -> { el, destroy() }
     Pixel.dialog(container, { who, lines, name, sprite, spriteScale }) -> Promise
     Pixel.bubble(anchor, text, { who, duration }) -> Promise
     Pixel.blip(who)

   Fuente: Pixelify Sans (Google Fonts), la importa pixel.css. Si preferís cargarla en el <head>:
     <link rel="preconnect" href="https://fonts.googleapis.com">
     <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
     <link href="https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400..700&display=swap" rel="stylesheet">
*/
(function () {
  "use strict";

  /* ───────── utilidades ───────── */
  var mq = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  function reduced() { return !!(mq && mq.matches); }
  function rand(a, b) { return a + Math.random() * (b - a); }
  function el(tag, cls) { var n = document.createElement(tag); if (cls) n.className = cls; return n; }

  /* ───────── arte ─────────
     Cada fila tiene 28 caracteres. "." = transparente.
     Ojos, boca y rubor se dibujan encima según el estado (mood, parpadeo, habla). */
  var W = 28, H = 28;

  var ART = {
    tobi: {
      name: "TOBI",
      pitch: 210,
      rows: [
        "............................",
        ".........oooooooooo.........",
        ".......ooHHHHHHHHHHoo.......",
        ".....ooHHHHlllhHHHHHHoo.....",
        "....oHHHHlllhhHHHHHHHHHo....",
        "...oHHHHllhhhHHHHHHHhHHHo...",
        "..oHHHHhhhhHHHHHHHhhHHHHHo..",
        "..oHHHHHHHHHHHHHhhHHHHHHHo..",
        "..oHHHHHHHHHHHHHHHHHHHHHHo..",
        "..oHHHHHHHHHHHhhhHHHHHHHHo..",
        "..oHHHHHHHHhhhHHHHHHHSSHHo..",
        "..oHHHHHhhHHHHHHSHHSSSSHHo..",
        "..oHHHHSSSSSHHSSSSSSSSSHHo..",
        "..oHHSSSBBBBSSSSBBBBSSSHHo..",
        "..osHSSSSSSSSSSSSSSSSSSHso..",
        "..ossSSSSSSSSSSSSSSSSSSsso..",
        "..ossSSSSSSSSSSSSSSSSSSsgo..",
        "...osSSSSSSSSSSSSSSSSSSso...",
        "...osSSSSSSSSSSSSSSSSSSso...",
        "....osSSSSSSSSSSSSSSSSso....",
        ".....ossSSSSSSSSSSSSsso.....",
        "......oossSSSSSSSSssoo......",
        ".........osssssssso.........",
        "....oooTTTssssssssTTTooo....",
        "..ooTTTTTTTTssssTTTTTTTToo..",
        ".oTTTTTTTTTTttttTTTTTTTTTTo.",
        ".oTTtTTTTTTTTTTTTTTTTTTtTTo.",
        "oTTTtTTTTTTTTTTTTTTTTTTtTTTo"
      ],
      eyes: [[9, 15], [17, 15]],
      mouth: [12, 19],
      nose: [14, 17],
      blush: [[6, 18], [20, 18]],
      split: 22,
      lashes: false,
      smile: "smirk",
      alwaysBlush: false,
      pal: {
        o: "#22150f", H: "#3d2920", h: "#5a3d2d", l: "#7d5840",
        S: "#f2c6a2", s: "#d99d79", B: "#2a1a13", g: "#77727d",
        T: "#29282d", t: "#45434b",
        e: "#1d130f", w: "#ffffff", m: "#8d3a3a", M: "#4a1820", k: "#e0697c",
        b: "#ee8c97", r: "#e8457a", R: "#b8264f"
      }
    },
    lu: {
      name: "LU",
      pitch: 560,
      rows: [
        "............................",
        "..........oooooooo..........",
        "........ooHHHHHHHHoo........",
        "......ooHHHHHhhHHHHHoo......",
        ".....oHHHHHHhHHhHHHHHHo.....",
        "....oHHHHHlhHHHHhlHHHHHo....",
        "...oHHHHHlhHHHHHHhlHHHHHo...",
        "...oHHHHlhHHHHHHHHhlHHHHo...",
        "...oHHHlhHHHHSSHHHHhlHHHo...",
        "...oHHlhHHHHSSSSHHHHhlHHo...",
        "..oHHlhHHSSSSSSSSSSHHhlHHo..",
        "..oHlhHHSSSSSSSSSSSSHHhlHo..",
        "..oHlHSSBBBSSSSSSBBBSSHlHo..",
        "..oHlHSSSSSSSSSSSSSSSSHlHo..",
        "..oHlHSSSSSSSSSSSSSSSSHlHo..",
        "..oHlHSSSSSSSSSSSSSSSSHlHo..",
        "..oHlHSSSSSSSSSSSSSSSSHlHo..",
        "..oHlHsSSSSSSSSSSSSSSsHlHo..",
        "..oHlHHSSSSSSSSSSSSSSHHlHo..",
        "..oHlHHHsSSSSSSSSSSsHHHlHo..",
        "..oHlHHHHssSSSSSSssHHHHlHo..",
        "..oHlHHHHHHossssoHHHHHHlHo..",
        "..oHlHHHHHHHssssHHHHHHHlHo..",
        "..oHlHHHCCssssssssCCHHHlHo..",
        ".oHHlHHCCCCCssssCCCCCHHlHHo.",
        ".oHlHHHCCCCCCccCCCCCCHHHlHo.",
        "oHHlHHCCCCCCCCCCCCCCCCHHlHHo",
        "oHlHHCCCCCCCCCCCCCCCCCCHHlHo"
      ],
      eyes: [[9, 14], [17, 14]],
      mouth: [12, 18],
      nose: [14, 16],
      blush: [[7, 17], [19, 17]],
      split: 21,
      lashes: true,
      smile: "soft",
      alwaysBlush: true,
      pal: {
        o: "#120b0e", H: "#211a1f", h: "#3a2d35", l: "#5d4a57",
        S: "#f7d4b8", s: "#e3ad8e", B: "#5a4038",
        C: "#b8a08a", c: "#8f7867",
        e: "#1a1012", w: "#ffffff", m: "#c2456b", M: "#5a1a2c", k: "#ee7d93",
        b: "#f2a0ae", r: "#e8457a", R: "#b8264f"
      }
    }
  };

  // Lu: el brillo lateral del pelo se suaviza en el medio (menos "rayas")
  ART.lu.rows = ART.lu.rows.map(function (r, i) {
    return (i >= 13 && i <= 21) ? r.replace(/l/g, "h") : r;
  });

  // validación rápida del arte
  Object.keys(ART).forEach(function (k) {
    var a = ART[k];
    if (a.rows.length !== H) throw new Error("Pixel: " + k + " tiene " + a.rows.length + " filas");
    a.rows.forEach(function (r, i) {
      if (r.length !== W) throw new Error("Pixel: " + k + " fila " + i + " mide " + r.length);
    });
  });

  var HEART = {
    rows: [
      "..ooo...ooo..",
      ".oRRRo.oRRRo.",
      "oRwwRRoRRRRRo",
      "oRwRRRRRRRRRo",
      "oRRRRRRRRRRdo",
      ".oRRRRRRRRdo.",
      "..oRRRRRRdo..",
      "...oRRRRdo...",
      "....oRRdo....",
      ".....odo.....",
      "......o......"
    ],
    pal: { o: "#6b1f37", R: "#e8578a", d: "#c2456b", w: "#ffd6e3" }
  };

  /* ───────── audio ───────── */
  var actx = null, master = null, lastBlip = 0;

  function unlockAudio() {
    try {
      if (!actx) {
        var AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        actx = new AC();
        master = actx.createGain();
        master.gain.value = 1;
        master.connect(actx.destination);
      }
      if (actx.state === "suspended" && actx.resume) actx.resume();
    } catch (e) { /* sin audio, sin drama */ }
  }

  function blip(who) {
    if (!actx || actx.state !== "running") return;
    try {
      var t = actx.currentTime;
      if (t - lastBlip < 0.018) return; // evita amontonar
      lastBlip = t;
      var a = ART[who] || ART.tobi;
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = "square";
      o.frequency.setValueAtTime(a.pitch * rand(0.9, 1.12), t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + 0.05);
    } catch (e) { /* nada */ }
  }

  /* ───────── canvas helpers ───────── */
  function makeCanvas(w, h, scale, cls) {
    var c = el("canvas", cls);
    var dpr = Math.max(1, window.devicePixelRatio || 1);
    var k = Math.max(1, Math.round(scale * dpr)); // píxeles reales por píxel de arte
    c.width = w * k; c.height = h * k;
    c.style.width = (w * scale) + "px";
    c.style.height = (h * scale) + "px";
    c._k = k;
    return c;
  }

  /* ───────── sprite ───────── */
  var MOODS = { normal: 1, happy: 1, surprised: 1, love: 1, sleep: 1 };

  function sprite(who, opts) {
    who = ART[who] ? who : "tobi";
    opts = opts || {};
    var art = ART[who], pal = art.pal;
    var scale = opts.scale || 4;
    var wrap = el("div", "px-sprite px-sprite--" + who);
    var cv = makeCanvas(W, H, scale, "px-canvas");
    wrap.appendChild(cv);
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", who === "lu" ? "Lu en pixel art" : "Tobi en pixel art");
    var ctx = cv.getContext("2d");
    var k = cv._k;

    var st = { mood: "normal", blink: false, half: false, bob: 0, talking: false, mf: 0 };
    var timers = { blink: 0, bob: 0, talk: 0, blinkEnd: 0 };
    var dead = false;

    function fill(c, x, y, dy) {
      var col = pal[c];
      if (!col) return;
      ctx.fillStyle = col;
      ctx.fillRect(x * k, (y + dy) * k, k, k);
    }
    // overlay en zona de la cabeza (sigue al respirar)
    function px(x, y, c) { fill(c, x, y, st.bob); }

    function drawEyes() {
      var mood = st.mood;
      art.eyes.forEach(function (p, i) {
        var x = p[0], y = p[1], outer = i === 0 ? x - 1 : x + 2;
        if (mood === "sleep") {
          px(x - 1, y + 1, "e"); px(x, y + 2, "e"); px(x + 1, y + 2, "e"); px(x + 2, y + 1, "e");
          return;
        }
        if (st.blink) {
          px(x, y + 2, "e"); px(x + 1, y + 2, "e"); px(outer, y + (art.lashes ? 1 : 2), "e");
          return;
        }
        if (st.half) {
          px(x, y + 1, "e"); px(x + 1, y + 1, "e"); px(x, y + 2, "e"); px(x + 1, y + 2, "e");
          px(x - 1, y + 1, "e"); px(x + 2, y + 1, "e");
          return;
        }
        if (mood === "happy") {
          px(x - 1, y + 2, "e"); px(x, y + 1, "e"); px(x + 1, y + 1, "e"); px(x + 2, y + 2, "e");
          if (art.lashes) px(outer, y + 1, "e");
          return;
        }
        if (mood === "love") {
          var cx = i === 0 ? x - 2 : x - 1; // corazones simétricos
          var hrt = [".r.r.", "rrrrr", ".rrr.", "..r.."];
          for (var r = 0; r < hrt.length; r++)
            for (var c = 0; c < 5; c++) if (hrt[r][c] === "r") px(cx + c, y + r, (r === 0 || (r === 1 && c === 0)) ? "r" : (c >= 3 && r >= 1 ? "R" : "r"));
          px(cx + 1, y + 1, "w");
          return;
        }
        if (mood === "surprised") {
          px(x, y - 1, "e"); px(x + 1, y - 1, "e");
          px(x, y, "e"); px(x + 1, y, "w");
          px(x, y + 1, "e"); px(x + 1, y + 1, "e");
          px(x, y + 2, "e"); px(x + 1, y + 2, "e");
          if (art.lashes) px(outer, y - 1, "e");
          return;
        }
        // normal
        px(x, y, "e"); px(x + 1, y, "w");
        px(x, y + 1, "e"); px(x + 1, y + 1, "e");
        px(x, y + 2, "e"); px(x + 1, y + 2, "e");
        if (art.lashes) px(outer, y, "e");
      });
    }

    function drawMouth() {
      var x = art.mouth[0], y = art.mouth[1], m = st.mood;
      if (st.talking) {
        var f = st.mf % 4;
        if (f === 0 || f === 2) { // abierta chica
          px(x + 1, y, "M"); px(x + 2, y, "M");
          px(x + 1, y + 1, "k"); px(x + 2, y + 1, "M");
          return;
        }
        if (f === 1) { // abierta grande
          px(x, y, "M"); px(x + 1, y, "M"); px(x + 2, y, "M"); px(x + 3, y, "M");
          px(x + 1, y + 1, "k"); px(x + 2, y + 1, "k");
          return;
        }
        // f === 3: cerrada (sigue el mood)
      }
      if (m === "happy") {
        px(x, y, "M"); px(x + 1, y, "M"); px(x + 2, y, "M"); px(x + 3, y, "M");
        px(x + 1, y + 1, "k"); px(x + 2, y + 1, "k");
        return;
      }
      if (m === "surprised") {
        px(x + 1, y, "M"); px(x + 2, y, "M"); px(x + 1, y + 1, "M"); px(x + 2, y + 1, "M");
        return;
      }
      if (m === "sleep") { px(x + 1, y, "m"); px(x + 2, y, "m"); return; }
      // normal / love: sonrisita
      if (art.smile === "smirk") { // media sonrisa de costado
        px(x, y, "s"); px(x + 1, y + 1, "m"); px(x + 2, y + 1, "m"); px(x + 3, y, "m");
      } else {
        px(x, y, "s"); px(x + 1, y + 1, "m"); px(x + 2, y + 1, "m"); px(x + 3, y, "s");
      }
    }

    function drawBlush() {
      var m = st.mood;
      var strong = m === "love" || m === "happy";
      if (!strong && !art.alwaysBlush) return;
      art.blush.forEach(function (p) {
        px(p[0], p[1], "b"); px(p[0] + 1, p[1], "b");
        if (m === "love") { px(p[0], p[1] - 1, "b"); px(p[0] + 1, p[1] - 1, "b"); }
      });
    }

    function render() {
      if (dead) return;
      ctx.clearRect(0, 0, cv.width, cv.height);
      var rows = art.rows, y, x, c;
      // cuerpo primero (fijo), después cabeza (se mueve con el respirar)
      for (y = art.split; y < H; y++)
        for (x = 0; x < W; x++) { c = rows[y][x]; if (c !== ".") fill(c, x, y, 0); }
      for (y = 0; y < art.split; y++)
        for (x = 0; x < W; x++) { c = rows[y][x]; if (c !== ".") fill(c, x, y, st.bob); }
      if (art.nose) px(art.nose[0], art.nose[1], "s");
      drawBlush();
      drawEyes();
      drawMouth();
    }

    function scheduleBlink() {
      clearTimeout(timers.blink);
      timers.blink = setTimeout(function () {
        if (dead) return;
        doBlink(Math.random() < 0.5 ? 90 : 150);
        // a veces doble parpadeo
        if (Math.random() < 0.15) setTimeout(function () { if (!dead) doBlink(90); }, 260);
        scheduleBlink();
      }, rand(2000, 5000));
    }
    function doBlink(ms) {
      st.blink = true; render();
      clearTimeout(timers.blinkEnd);
      timers.blinkEnd = setTimeout(function () { st.blink = false; render(); }, ms || 110);
    }

    function startBob() {
      clearInterval(timers.bob);
      if (reduced()) { st.bob = 0; return; }
      timers.bob = setInterval(function () {
        if (reduced()) { st.bob = 0; render(); return; }
        st.bob = st.bob ? 0 : 1; render();
      }, 700);
    }

    var api = {
      el: wrap,
      canvas: cv,
      who: who,
      talk: function (on) {
        on = !!on;
        if (on === st.talking) return;
        st.talking = on;
        clearInterval(timers.talk);
        if (on) {
          st.mf = 0;
          timers.talk = setInterval(function () { st.mf++; render(); }, 120);
        }
        render();
      },
      setMood: function (m) {
        st.mood = MOODS[m] ? m : "normal";
        st.half = false;
        render();
      },
      getMood: function () { return st.mood; },
      // extras
      blink: function (ms) { doBlink(ms || 110); },
      wake: function () { // ojos cerrados -> entreabiertos -> abiertos (con un parpadeo)
        return new Promise(function (res) {
          st.mood = "normal"; st.half = false;
          var seq = [["sleep", 0], ["half", 650], ["sleep", 250], ["half", 300], ["open", 350], ["blink", 900], ["open", 120]];
          var i = 0;
          (function step() {
            if (dead || i >= seq.length) { st.half = false; st.blink = false; render(); res(); return; }
            var s = seq[i++];
            st.blink = false; st.half = false;
            if (s[0] === "sleep") st.mood = "sleep";
            else { st.mood = "normal"; if (s[0] === "half") st.half = true; if (s[0] === "blink") st.blink = true; }
            render();
            setTimeout(step, s[1]);
          })();
        });
      },
      destroy: function () {
        dead = true;
        clearTimeout(timers.blink); clearTimeout(timers.blinkEnd);
        clearInterval(timers.bob); clearInterval(timers.talk);
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      }
    };

    render();
    scheduleBlink();
    startBob();
    return api;
  }

  /* ───────── corazón ───────── */
  function heart(opts) {
    opts = opts || {};
    var scale = opts.scale || 4;
    var w = HEART.rows[0].length, h = HEART.rows.length;
    var wrap = el("div", "px-heart");
    var cv = makeCanvas(w, h, scale, "px-canvas");
    var ctx = cv.getContext("2d"), k = cv._k;
    HEART.rows.forEach(function (row, y) {
      for (var x = 0; x < w; x++) {
        var c = HEART.pal[row[x]];
        if (c) { ctx.fillStyle = c; ctx.fillRect(x * k, y * k, k, k); }
      }
    });
    wrap.appendChild(cv);
    wrap.setAttribute("role", "img");
    wrap.setAttribute("aria-label", "corazón");
    return {
      el: wrap,
      destroy: function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }
    };
  }

  /* ───────── máquina de escribir ───────── */
  var SILENT = /[\s.,;:!?¡¿…\-—–"'()«»*~]/;

  // Escribe `text` dentro de `p` (spans visible + resto invisible, así no salta el renglón).
  // Devuelve { done: bool, finish() } y llama onEnd al terminar.
  function typewriter(p, text, who, onChar, onEnd) {
    p.textContent = "";
    var shown = el("span", "px-shown"), rest = el("span", "px-rest");
    rest.setAttribute("aria-hidden", "true");
    p.appendChild(shown); p.appendChild(rest);
    var chars = Array.from(text), i = 0, t = 0;
    var ctl = { done: false, finish: finish, cancel: function () { clearTimeout(t); } };

    function finish() {
      clearTimeout(t);
      if (ctl.done) return;
      shown.textContent = text; rest.textContent = "";
      ctl.done = true;
      onEnd && onEnd();
    }
    function step() {
      if (ctl.done) return;
      if (i >= chars.length) { finish(); return; }
      var ch = chars[i++];
      shown.textContent += ch;
      rest.textContent = chars.slice(i).join("");
      if (!SILENT.test(ch)) { blip(who); onChar && onChar(ch); }
      var d = 30;
      if (/[.!?…]/.test(ch)) d = 220; else if (/[,;:]/.test(ch)) d = 110;
      t = setTimeout(step, d);
    }
    if (reduced()) {
      shown.textContent = text;
      blip(who);
      ctl.done = true;
      setTimeout(function () { onEnd && onEnd(); }, 0);
    } else {
      rest.textContent = text;
      t = setTimeout(step, 60);
    }
    return ctl;
  }

  function parseLine(raw) {
    var s = String(raw == null ? "" : raw), mood = "normal";
    if (s.charAt(0) === "!") { mood = "happy"; s = s.slice(1); }
    else if (s.charAt(0) === "?") { mood = "surprised"; s = s.slice(1); }
    else if (s.charAt(0) === "*") { mood = "love"; s = s.slice(1); }
    return { text: s.replace(/^\s+/, ""), mood: mood };
  }

  function stopEvents(node) {
    ["pointerdown", "pointerup", "mousedown", "mouseup", "touchstart", "touchend"].forEach(function (ev) {
      node.addEventListener(ev, function (e) { e.stopPropagation(); }, { passive: true });
    });
  }

  /* ───────── diálogo ───────── */
  var dialogStack = [];

  function dialog(container, opts) {
    opts = opts || {};
    var who = ART[opts.who] ? opts.who : "tobi";
    var lines = (opts.lines && opts.lines.length ? opts.lines : [""]).map(parseLine);
    var name = opts.name || ART[who].name;
    var ext = opts.sprite || null;          // sprite externo (no se dibuja uno propio)
    var spr = ext || sprite(who, { scale: opts.spriteScale || 3 });
    var prevMood = ext && ext.getMood ? ext.getMood() : "normal";

    return new Promise(function (resolve) {
      var box = el("div", "px-dialog px-dialog--" + who + (ext ? " px-dialog--solo" : ""));
      box.setAttribute("role", "dialog");
      box.setAttribute("aria-label", "Diálogo de " + name);
      if (!ext) {
        var por = el("div", "px-portrait");
        por.appendChild(spr.el);
        box.appendChild(por);
      }
      var body = el("div", "px-body");
      var tag = el("div", "px-name"); tag.textContent = name;
      var p = el("p", "px-text"); p.setAttribute("aria-live", "polite");
      var next = el("span", "px-next"); next.setAttribute("aria-hidden", "true");
      body.appendChild(p); body.appendChild(next);
      box.appendChild(tag);
      box.appendChild(body);
      container.appendChild(box);
      requestAnimationFrame(function () { box.classList.add("is-in"); });

      var idx = -1, tw = null, closing = false, me = {};
      dialogStack.push(me);

      function show(n) {
        idx = n;
        var L = lines[n];
        spr.setMood(L.mood);
        box.classList.remove("is-done");
        spr.talk(true);
        tw = typewriter(p, L.text, who, null, function () {
          spr.talk(false);
          box.classList.add("is-done");
        });
      }
      function advance() {
        if (closing) return;
        if (tw && !tw.done) { tw.finish(); return; }
        if (idx + 1 < lines.length) { show(idx + 1); return; }
        close();
      }
      function close() {
        closing = true;
        if (tw) tw.cancel();
        spr.talk(false);
        document.removeEventListener("keydown", onKey, true);
        var k = dialogStack.indexOf(me); if (k >= 0) dialogStack.splice(k, 1);
        box.classList.add("is-out");
        var done = function () {
          if (box.parentNode) box.parentNode.removeChild(box);
          if (ext) ext.setMood(prevMood); else spr.destroy();
          resolve();
        };
        if (reduced()) done(); else setTimeout(done, 200);
      }
      function onKey(e) {
        if (dialogStack[dialogStack.length - 1] !== me) return;
        var tg = e.target && e.target.tagName;
        if (tg === "INPUT" || tg === "TEXTAREA" || (e.target && e.target.isContentEditable)) return;
        if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
          e.preventDefault(); e.stopPropagation();
          if (!e.repeat) advance();
        }
      }
      box.addEventListener("click", function (e) { e.stopPropagation(); advance(); });
      stopEvents(box);
      document.addEventListener("keydown", onKey, true);
      show(0);
    });
  }

  /* ───────── globo ───────── */
  var current = null; // { kill() }

  function bubble(anchor, text, opts) {
    opts = opts || {};
    var who = ART[opts.who] ? opts.who : "tobi";
    var duration = opts.duration == null ? 2600 : opts.duration;
    if (current) current.kill();

    return new Promise(function (resolve) {
      var b = el("div", "px-bubble px-bubble--" + who);
      b.setAttribute("role", "status");
      var p = el("p", "px-text");
      b.appendChild(p);
      document.body.appendChild(b);

      var raf = 0, timer = 0, gone = false;
      var self = { kill: kill };
      current = self;

      function place() {
        if (gone) return;
        if (!anchor || !anchor.isConnected) { kill(); return; }
        var r = anchor.getBoundingClientRect();
        var vw = document.documentElement.clientWidth || window.innerWidth;
        var bw = b.offsetWidth, bh = b.offsetHeight, gap = 12;
        var cx = r.left + r.width / 2;
        var left = Math.round(Math.min(Math.max(8, cx - bw / 2), vw - bw - 8));
        var top = r.top - bh - gap, below = false;
        if (top < 8) { top = r.bottom + gap; below = true; }
        b.style.left = left + "px";
        b.style.top = Math.round(top) + "px";
        b.classList.toggle("is-below", below);
        var tail = Math.min(Math.max(14, cx - left), bw - 14);
        b.style.setProperty("--tail-x", Math.round(tail) + "px");
        raf = requestAnimationFrame(place);
      }
      function kill() {
        if (gone) return;
        gone = true;
        cancelAnimationFrame(raf); clearTimeout(timer);
        if (tw) tw.cancel();
        if (current === self) current = null;
        b.classList.add("is-out");
        var rm = function () { if (b.parentNode) b.parentNode.removeChild(b); resolve(); };
        if (reduced()) rm(); else setTimeout(rm, 160);
      }

      b.addEventListener("click", function (e) { e.stopPropagation(); kill(); });
      stopEvents(b);

      var tw = typewriter(p, String(text == null ? "" : text), who, null, function () {
        timer = setTimeout(kill, duration);
      });
      place();
      requestAnimationFrame(function () { b.classList.add("is-in"); });
    });
  }

  /* ───────── íconos en pixel art (modo juego) ───────── */
  var ICONS = {
    // pistas de la búsqueda de palabras: la compu, el baño y Snoopy
    laptop: {
      rows: [
        "..oooooooooooooooo..",
        "..oSSSSSSSSSSSSSSo..",
        "..oSBBBBBBBBBBBBSo..",
        "..oSBbbbbBBBBBBBSo..",
        "..oSBBBBBbbbBBBBSo..",
        "..oSBbbBBBBBBBBBSo..",
        "..oSBBBBBBBBBBBBSo..",
        "..oSBBBBBBBBBBBBSo..",
        "..oSSSSSSSSSSSSSSo..",
        "..oooooooooooooooo..",
        "oooooooooooooooooooo",
        "oKKKKKKKKKKKKKKKKKKo",
        "oKkKkKkKkKkKkKkKkKKo",
        ".oooooooooooooooooo."
      ],
      pal: { o: "#242322", S: "#9a9a9a", B: "#2f3a6b", b: "#7fd0e8", K: "#c9c9c9", k: "#8a8a8a" }
    },
    toilet: {
      rows: [
        "..oooooooo....",
        "..oWWWWWWo....",
        "..oWWWWWWo....",
        "..oWWWWWWo....",
        "..oooooooo....",
        "...oWWWWo.....",
        "oooooooooooo..",
        "oWWWWWWWWWWWo.",
        "oWbbbbbbbbbWo.",
        "oWbbbbbbbbbWo.",
        ".oWWWWWWWWWo..",
        "..oWWWWWWWo...",
        "...oWWWWWo....",
        "...oWWWWWo....",
        "..ooooooooo..."
      ],
      pal: { o: "#242322", W: "#f4f4f4", b: "#7fd0e8" }
    },
    snoopy: {
      rows: [
        "......oooooo......",
        "....ooWWWWWWoo....",
        "...oWWWWWWWWWWo...",
        "..oWWWWWWWWWWWWo..",
        ".oKKWWWWWWWWWWWWo.",
        "oKKKKWWWWoWWWWWWo.",
        "oKKKKWWWWWWWWWWWWo",
        "oKKKKWWWWWWWWWWWKo",
        "oKKKKWWWWWWWWWWKKo",
        ".oKKKWWWWWWWWWWWo.",
        ".oKKWWWWWWoooWWo..",
        "..oKoWWWWWWWWWo...",
        "...o.oWWWWWWWo....",
        "......ooooooo....."
      ],
      pal: { o: "#242322", W: "#ffffff", K: "#242322" }
    },
    // la lata (cuerpo y tapa por separado, para que la tapa pueda salir volando)
    canBody: {
      rows: [
        ".oooooooooooo.",
        "orhhRRRRRRRrro",
        "orhRRRRRRRRrro",
        "orrrrrrrrrrrro",
        "orhRRRRRRRRrro",
        "orhRRwwwwRRrro",
        "orhRwwwwwwRrro",
        "orhRwkwwkwRrro",
        "orhRwwwwwwRrro",
        "orhRkkkkkkRrro",
        "orhRwwwwwwRrro",
        "orhRRwwwwRRrro",
        "orhRRRRRRRRrro",
        "orhRRRRRRRRrro",
        "orhRRRRRRRRrro",
        "orrrrrrrrrrrro",
        "orhRRRRRRRRrro",
        "orhRRRRRRRRrro",
        "orhhRRRRRRRrro",
        ".oooooooooooo."
      ],
      pal: { o: "#3a1414", R: "#d42a2a", r: "#9e1a1d", h: "#ff7a6b", w: "#fbe9c4", k: "#3b2313" }
    },
    canLid: {
      rows: [
        ".oooooooooooooo.",
        "oSWWWWWWWWWWWWSo",
        "oSSSSSSSSSSSSSSo",
        ".oooooooooooooo."
      ],
      pal: { o: "#3d3d3d", S: "#a9a9a9", W: "#f2f2f2" }
    },
    heart: {
      rows: [
        ".PP.PP.",
        "PWPPPPP",
        "PPPPPPP",
        ".PPPPP.",
        "..PPP..",
        "...P..."
      ],
      pal: { P: "#e0548c", W: "#ffd6e3" }
    },
    star: {
      rows: [
        "....Y....",
        "...YYY...",
        "YYYYWYYYY",
        ".YYYYYYY.",
        "..YYYYY..",
        ".YYY.YYY.",
        "YY.....YY"
      ],
      pal: { Y: "#e3b04b", W: "#fff3c4" }
    },
    sparkle: {
      rows: [
        "...P...",
        "...P...",
        "..PWP..",
        "PPWWWPP",
        "..PWP..",
        "...P...",
        "...P..."
      ],
      pal: { P: "#c2456b", W: "#ffd6e3" }
    },
    note: {
      rows: [
        "..KKKKK",
        "..K...K",
        "..K...K",
        "..K...K",
        "KKK.KKK",
        "KKK.KKK"
      ],
      pal: { K: "#242322" }
    }
  };

  function icon(name, opts) {
    opts = opts || {};
    var art = ICONS[name] || ICONS.heart;
    var scale = opts.scale || 3;
    var w = art.rows[0].length, h = art.rows.length;
    var wrap = el("span", "px-icon px-icon--" + name);
    var cv = makeCanvas(w, h, scale, "px-canvas");
    var ctx = cv.getContext("2d"), k = cv._k;
    art.rows.forEach(function (row, y) {
      for (var x = 0; x < w; x++) {
        var c = art.pal[row[x]];
        if (c) { ctx.fillStyle = c; ctx.fillRect(x * k, y * k, k, k); }
      }
    });
    wrap.appendChild(cv);
    wrap.setAttribute("aria-hidden", "true");
    return { el: wrap };
  }

  /* ───────── efectos de sonido 8-bit ───────── */
  var SFX = {
    coin: [[988, 0.07, "square"], [1319, 0.2, "square"]],
    error: [[220, 0.1, "square"], [165, 0.2, "square"]],
    page: [[520, 0.03, "triangle"], [780, 0.03, "triangle"], [1040, 0.05, "triangle"]],
    power: [[523, 0.07, "square"], [659, 0.07, "square"], [784, 0.07, "square"], [1047, 0.25, "square"]]
  };
  function sfx(name) {
    if (!actx || actx.state !== "running" || !SFX[name]) return;
    try {
      var t = actx.currentTime;
      SFX[name].forEach(function (n) {
        var o = actx.createOscillator(), g = actx.createGain();
        o.type = n[2];
        o.frequency.setValueAtTime(n[0], t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.045, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + n[1]);
        o.connect(g); g.connect(master);
        o.start(t); o.stop(t + n[1] + 0.02);
        t += n[1] * 0.85;
      });
    } catch (e) { /* nada */ }
  }

  /* ───────── canciones en 8-bit ───────── */
  var NOTE = { G3: 196, C4: 261.63, E4: 329.63, F4: 349.23, G4: 392, A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99 };
  var SONGS = {
    // Feliz cumpleaños (melodía tradicional), en 3/4
    cumple: {
      bpm: 120,
      notes: [
        ["G4", .75], ["G4", .25], ["A4", 1], ["G4", 1], ["C5", 1], ["B4", 2],
        ["G4", .75], ["G4", .25], ["A4", 1], ["G4", 1], ["D5", 1], ["C5", 2],
        ["G4", .75], ["G4", .25], ["G5", 1], ["E5", 1], ["C5", 1], ["B4", 1], ["A4", 2],
        ["F5", .75], ["F5", .25], ["E5", 1], ["C5", 1], ["D5", 1], ["C5", 3]
      ],
      // un bajo suave por compás: do, sol, do, fa, do, sol, do
      bass: [["C4", 3], ["G3", 3], ["G3", 3], ["C4", 3], ["C4", 3], ["F4", 3], ["C4", 3], ["G3", 3], ["C4", 3]]
    }
  };
  var playing = [];
  function stopSong() {
    playing.forEach(function (o) { try { o.stop(); } catch (e) { /* ya paró */ } });
    playing = [];
  }
  function voice(type, freq, t, dur, vol) {
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.setValueAtTime(vol, t + dur * 0.75);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.98);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur);
    playing.push(o);
  }
  function song(name) {
    var s = SONGS[name];
    if (!s || !actx || actx.state !== "running") return { stop: stopSong };
    stopSong();
    var beat = 60 / s.bpm, t = actx.currentTime + 0.1, total = 0;
    s.notes.forEach(function (n) {
      voice("square", NOTE[n[0]], t + total * beat, n[1] * beat, 0.035);
      total += n[1];
    });
    // el bajo arranca después del "pique" (la primera nota es anacrusa)
    var b = 1;
    s.bass.forEach(function (n) {
      voice("triangle", NOTE[n[0]] / 2, t + b * beat, n[1] * beat, 0.05);
      b += n[1];
    });
    return { stop: stopSong, duration: total * beat };
  }

  window.Pixel = {
    unlockAudio: unlockAudio,
    sprite: sprite,
    heart: heart,
    icon: icon,
    sfx: sfx,
    song: song,
    dialog: dialog,
    bubble: bubble,
    blip: function (who) { blip(ART[who] ? who : "tobi"); },
    _art: ART
  };
})();
