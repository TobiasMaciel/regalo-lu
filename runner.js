/* runner.js — mini-juego "runner" pixel art: Lu montada en un salchicha.
   Script clásico (sin módulos). Expone window.Runner.

   API:
     var game = Runner.create(container, { best: 0, onEnd: function (score, best) {} });
     game.destroy();

   Toque / click en el canvas, Espacio o Flecha arriba = saltar.
*/
(function () {
  "use strict";

  /* ───────── paleta ───────── */
  var C = {
    paper: "#ebe5d8", ink: "#242322", pen: "#c2456b", red: "#d81e1e",
    gold: "#c99a45", brown: "#8b6342", faint: "#d6cdbb", faint2: "#cbc1ad",
    cloud: "#f8f4ea", cloudEdge: "#d9d0bf"
  };
  var FONT = '"Pixelify Sans", ui-monospace, monospace';

  /* ───────── arte (matrices de caracteres, "." = transparente) ───────── */
  // Salchicha mirando a la derecha. Patas aparte (frames).
  var DOG = [
    "............................oooo.....",
    "...........................oDDDDo....",
    "..........................oDDDDDDo...",
    "o........................oEDDDDeDDoo.",
    "Do......................oEEEDDDDDDDDo",
    ".Do..ooooooooooooooooooorEEEDDDDDDDDn",
    "..DooDDDDDDDDDDDDDDDDDDDrEEEEDDDDDDo.",
    "...oDDDDDDDDDDDDDDDDDDDDrEEEEoDDmoo..",
    "...oDDDDDDDDDDDDDDDDDDDDDdEEEoooo....",
    "...oDDDDDDDDDDDDDDDDDDDDDDdEEo.......",
    "....oLLLLLLLLLLLLLLLLLLLLLLDDo.......",
    ".....oooooooooooooooooooooooo........"
  ];
  // patitas (2 px de ancho): x de [trasera lejos, trasera cerca, delantera lejos, delantera cerca] por frame
  var LEGS = [
    [6, 9, 23, 26],
    [5, 10, 22, 27],
    [4, 9, 24, 28]
  ];
  var DOG_PAL = {
    o: "#3a2414", D: "#8b6342", d: "#76522f", L: "#b08458", E: "#5e3d22",
    e: "#1a1012", n: "#1a1012", r: "#d81e1e", m: "#5e3d22"
  };

  // Lu chibi, de frente, sentada.
  var LU = [
    "....oooooo....",
    "..ooHHHHHHoo..",
    ".oHHHHhhHHHHo.",
    "oHHHHSSSSHHHHo",
    "oHHHSSSSSSHHHo",
    "oHHSSSSSSSSHHo",
    "oHHSeSSSSeSHHo",
    "oHHkSSSSSSkHHo",
    "oHHHSSmmSSHHHo",
    "oHHHHCSSCHHHHo",
    "oHHCCCCCCCCHHo",
    "oHHSCCCCCCSHHo",
    ".oHCCCcCCCCHo.",
    "..ojjjjjjjjo..",
    "...jj....jj...",
    "...zz....zz..."
  ];
  var LU_PAL = {
    o: "#120b0e", H: "#211a1f", h: "#4a3a45", S: "#f7d4b8", s: "#e3ad8e",
    e: "#1a1012", k: "#f2a0ae", m: "#c2456b", C: "#b8a08a", c: "#8f7867",
    j: "#4d5b78", z: "#242322"
  };

  var OBST = {
    cone: {
      rows: [
        "...o...",
        "..oOo..",
        "..oOo..",
        ".owwwo.",
        ".oOOOo.",
        "oOOOOOo",
        "owwwwwo",
        "oooooooo".slice(0, 7)
      ],
      pal: { o: "#5a2a10", O: "#e8762c", w: "#f8f4ea" },
      box: [1, 2, 5, 6]
    },
    puddle: {
      rows: [
        "..bbbbbbbbbb..",
        ".bBBBwBBBBBBb.",
        "bBBBBBBBBwBBBb"
      ],
      pal: { b: "#4f7fa3", B: "#7fb2d4", w: "#e6f3fb" },
      box: [2, 1, 10, 2],
      sink: 1
    },
    cat: {
      rows: [
        "o...o......",
        "oKoKo......",
        "oKKKo......",
        "KgKgK......",
        "oKpKo......",
        ".oKKo......",
        ".oKKKo.....",
        "oKKKKKo.ooo",
        "oKKKKKo...o",
        "oKKKKKKo..o",
        "oKwKKwKKooo"
      ],
      pal: { o: "#141313", K: "#2e2b2b", g: "#e2c94a", p: "#ee8c97", w: "#4a4646" },
      box: [1, 2, 6, 9]
    },
    bone: {
      rows: [
        ".oo........oo.",
        "oWWo......oWWo",
        "oWWWooooooWWWo",
        ".oWWWWWWWWWWo.",
        "oWWWooooooWWWo",
        "oWWo......oWWo",
        ".oo........oo."
      ],
      pal: { o: "#8a7e68", W: "#fbf6e8" },
      box: [2, 1, 11, 5]
    },
    cactus: {
      rows: [
        "...oo...",
        "..oGGo..",
        "o.oGgo..",
        "GooGGo.o",
        "GGGGgoGG",
        ".ooGGGGo",
        "..oGgo..",
        "..oGGo..",
        "oooooooo",
        "oPPPPPPo",
        ".oPpPPo.",
        ".oPPPPo.",
        "..oooo.."
      ],
      pal: { o: "#2c3a22", G: "#5c8a4a", g: "#7fb066", P: "#b5603a", p: "#d4835a" },
      box: [1, 2, 6, 12]
    },
    pigeon: {
      frames: [
        [
          "...oo.....",
          "..oGGo....",
          ".oGGGGooo.",
          "oGWWGGGGRo",
          ".oGGGGGGo.",
          "..ooooo..."
        ],
        [
          "..........",
          "....ooo...",
          ".ooGGGGoo.",
          "oGGGGGGGRo",
          ".oGWWWGGo.",
          "..oWWo..."  + "."
        ]
      ],
      pal: { o: "#3d3c45", G: "#9a9aa8", W: "#c9c9d4", R: "#e8762c" },
      box: [1, 1, 8, 4]
    }
  };

  var HEART_S = [".o.o.", "ooooo", "ooooo", ".ooo.", "..o.."];
  var CLOUD = [
    "....xxxx......",
    "..xxwwwwxx.xx.",
    ".xwwwwwwwwxwwx",
    "xwwwwwwwwwwwwx",
    ".xxxxxxxxxxxx."
  ];
  var SPARK = ["..y..", ".yYy.", "yYYYy", ".yYy.", "..y.."];

  /* pre-renderiza una matriz en un canvas chico (1 px de arte = 1 px) */
  function bake(rows, pal) {
    var h = rows.length, w = 0, i;
    for (i = 0; i < h; i++) w = Math.max(w, rows[i].length);
    var c = document.createElement("canvas");
    c.width = w; c.height = h;
    var x = c.getContext("2d");
    for (var y = 0; y < h; y++) {
      for (var xx = 0; xx < rows[y].length; xx++) {
        var ch = rows[y][xx];
        if (ch === "." || !pal[ch]) continue;
        x.fillStyle = pal[ch];
        x.fillRect(xx, y, 1, 1);
      }
    }
    return c;
  }

  var baked = null;
  function bakeAll() {
    if (baked) return baked;
    baked = {
      dog: bake(DOG, DOG_PAL),
      lu: bake(LU, LU_PAL),
      cloud: bake(CLOUD, { x: C.cloudEdge, w: C.cloud }),
      heart: bake(HEART_S, { o: "#e3b3bf" }),
      spark: bake(SPARK, { y: C.gold, Y: "#f5d98a" }),
      obst: {}
    };
    Object.keys(OBST).forEach(function (k) {
      var o = OBST[k];
      if (o.frames) baked.obst[k] = o.frames.map(function (f) { return bake(f, o.pal); });
      else baked.obst[k] = [bake(o.rows, o.pal)];
    });
    return baked;
  }

  function rand(a, b) { return a + Math.random() * (b - a); }
  function pick(arr) { return arr[(Math.random() * arr.length) | 0]; }

  /* ───────── juego ───────── */
  function create(container, opts) {
    opts = opts || {};
    var art = bakeAll();
    var best = Math.max(0, Math.floor(+opts.best || 0));
    var onEnd = typeof opts.onEnd === "function" ? opts.onEnd : null;

    var wrap = document.createElement("div");
    wrap.className = "runner";
    var cv = document.createElement("canvas");
    cv.className = "runner-canvas";
    cv.setAttribute("role", "img");
    cv.setAttribute("aria-label", "Juego: Lu en su salchicha. Tocá para saltar.");
    cv.tabIndex = 0;
    wrap.appendChild(cv);
    container.appendChild(wrap);
    var ctx = cv.getContext("2d");

    // mundo en baja resolución
    var low = document.createElement("canvas");
    var g = low.getContext("2d");

    var W = 160, H = 104, K = 2, GY = 90; // GY = línea del suelo
    var TARGET_W = 160, RATIO = 0.65;

    function resize() {
      var cssW = wrap.clientWidth || container.clientWidth || 320;
      var dpr = Math.max(1, window.devicePixelRatio || 1);
      var dev = Math.floor(cssW * dpr);
      K = Math.max(1, Math.floor(dev / TARGET_W));
      W = Math.max(120, Math.floor(dev / K));
      H = Math.round(W * RATIO);
      GY = H - 13;
      low.width = W; low.height = H;
      cv.width = W * K; cv.height = H * K;
      cv.style.width = (W * K / dpr) + "px";
      cv.style.height = (H * K / dpr) + "px";
      ctx.imageSmoothingEnabled = false;
      g.imageSmoothingEnabled = false;
      if (st && (!st.air || st.y > GY)) { st.y = GY; st.vy = 0; st.air = false; }
      draw();
    }

    /* estado */
    var st = null;
    var deco = { clouds: [], hearts: [], pebbles: [] };
    function resetDeco() {
      deco.clouds = []; deco.hearts = []; deco.pebbles = [];
      for (var i = 0; i < 3; i++) deco.clouds.push({ x: rand(0, W * 1.3), y: rand(6, 30) });
      for (i = 0; i < 3; i++) deco.hearts.push({ x: rand(0, W * 1.4), y: rand(18, 46) });
      for (i = 0; i < 14; i++) deco.pebbles.push({ x: rand(0, W), y: GY + 2 + ((Math.random() * 8) | 0), w: Math.random() < 0.25 ? 2 : 1 });
    }

    var PX = 12; // x del jugador
    var JUMP_V = 180, GRAV = 520;

    function newRun() {
      st = {
        mode: st ? st.mode : "start",
        y: GY, vy: 0, air: false,
        speed: 72, score: 0, dist: 0, nextSpawn: 1.1,
        obs: [], t: 0, legT: 0, leg: 0,
        flash: 0, sparks: [], deadAt: 0, lastMark: 0, newBest: false, shake: 0
      };
    }
    newRun();
    resetDeco();

    function hitboxPlayer() {
      // caja un poco más chica que el dibujo (cuerpo del perro + Lu)
      return { x: PX + 8, y: st.y - 19, w: 25, h: 17 };
    }

    function spawn() {
      var s = st.score;
      var pool = ["cone", "puddle", "cat", "bone", "cactus"];
      if (s > 250) pool.push("pigeon", "cone");
      var k = pick(pool);
      var img = art.obst[k][0];
      var o = { k: k, x: W + 4, w: img.width, h: img.height, f: 0, ft: 0 };
      var def = OBST[k];
      o.y = GY - img.height + (def.sink || 0);
      if (k === "pigeon") o.y = GY - img.height - 6 - ((Math.random() * 4) | 0);
      st.obs.push(o);
      // a veces dos conitos juntos
      if (k === "cone" && s > 180 && Math.random() < 0.3) {
        st.obs.push({ k: "cone", x: W + 4 + img.width + 1, y: o.y, w: img.width, h: img.height, f: 0, ft: 0 });
      }
      // próximo: tiempo entre obstáculos (en segundos), se acorta un poco con el puntaje
      var minT = Math.max(0.72, 1.05 - s / 3000);
      st.nextSpawn = rand(minT, minT + 0.95);
    }

    function collide(a, o) {
      var b = OBST[o.k].box; // [x0, y0, x1, y1] dentro del dibujo
      var bx = o.x + b[0], by = o.y + b[1], bw = b[2] - b[0] + 1, bh = b[3] - b[1] + 1;
      return a.x < bx + bw && a.x + a.w > bx && a.y < by + bh && a.y + a.h > by;
    }

    function jump() {
      if (st.air) return;
      st.vy = -JUMP_V; st.air = true;
      try { window.Pixel && window.Pixel.blip && window.Pixel.blip("lu"); } catch (e) { /* nada */ }
    }

    function sfx(n) { try { window.Pixel && window.Pixel.sfx && window.Pixel.sfx(n); } catch (e) { /* nada */ } }

    function startGame() {
      newRun();
      st.mode = "play";
      st.t = 0;
      jump();
    }

    function die() {
      st.mode = "over";
      st.deadAt = now();
      st.shake = 0.25;
      var sc = Math.floor(st.score);
      st.newBest = sc > best;
      if (sc > best) best = sc;
      sfx("error");
      if (onEnd) { try { onEnd(sc, best); } catch (e) { setTimeout(function () { throw e; }); } }
    }

    function now() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

    function press() {
      try { window.Pixel && window.Pixel.unlockAudio && window.Pixel.unlockAudio(); } catch (e) { /* nada */ }
      if (st.mode === "start") startGame();
      else if (st.mode === "play") jump();
      else if (st.mode === "over" && now() - st.deadAt > 500) startGame();
      wake();
    }

    /* ───────── update ───────── */
    function update(dt) {
      st.t += dt;
      var sp = st.mode === "play" ? st.speed : (st.mode === "start" ? 28 : 0);

      // deco (parallax)
      deco.clouds.forEach(function (c) {
        c.x -= (sp * 0.18 + 2) * dt;
        if (c.x < -16) { c.x = W + rand(4, 60); c.y = rand(6, 30); }
      });
      deco.hearts.forEach(function (h) {
        h.x -= (sp * 0.08 + 1) * dt;
        if (h.x < -6) { h.x = W + rand(20, 120); h.y = rand(18, 46); }
      });
      deco.pebbles.forEach(function (p) {
        p.x -= sp * dt;
        if (p.x < -2) { p.x = W + rand(0, 20); p.y = GY + 2 + ((Math.random() * 8) | 0); p.w = Math.random() < 0.25 ? 2 : 1; }
      });

      // patitas
      if (st.mode !== "over") {
        st.legT += dt * (st.mode === "play" ? 6 + st.speed / 14 : 7);
        st.leg = Math.floor(st.legT) % 4;
      }

      if (st.mode !== "play") {
        if (st.shake > 0) st.shake -= dt;
        // en la pantalla de inicio, saltitos ocasionales de ganas
        return;
      }

      // física
      if (st.air) {
        st.vy += GRAV * dt;
        st.y += st.vy * dt;
        if (st.vy > 0 && st.y >= GY) { st.y = GY; st.vy = 0; st.air = false; }
      }

      // velocidad y puntaje
      st.speed = Math.min(150, 72 + st.score * 0.1);
      st.score += st.speed * dt * 0.125;
      var mark = Math.floor(st.score / 100);
      if (mark > st.lastMark) {
        st.lastMark = mark;
        st.flash = 0.9;
        sfx("coin");
        for (var i = 0; i < 4; i++) st.sparks.push({ x: W - 30 + rand(-6, 24), y: rand(2, 14), t: 0.6 + i * 0.08 });
      }
      if (st.flash > 0) st.flash -= dt;
      st.sparks = st.sparks.filter(function (s) { s.t -= dt; return s.t > 0; });

      // obstáculos
      st.nextSpawn -= dt;
      if (st.nextSpawn <= 0) spawn();
      var pb = hitboxPlayer();
      for (var j = st.obs.length - 1; j >= 0; j--) {
        var o = st.obs[j];
        o.x -= st.speed * dt * (o.k === "pigeon" ? 1.12 : 1);
        o.ft += dt;
        if (o.k === "pigeon") o.f = Math.floor(o.ft * 6) % 2;
        if (o.x + o.w < -4) { st.obs.splice(j, 1); continue; }
        if (collide(pb, o)) { die(); return; }
      }
    }

    /* ───────── draw ───────── */
    function drawDogAndLu(x, y) {
      // y = suelo bajo las patas
      var legFrame = st.air ? 2 : [0, 1, 0, 2][st.leg];
      var bob = (!st.air && st.mode !== "over" && (st.leg % 2 === 1)) ? -1 : 0;
      var dogTop = y - 15 + bob;
      // patas: cortitas, 2 px de ancho, con pie oscuro
      var legs = LEGS[legFrame];
      var len = st.air ? 1 : 2 - bob;
      for (var i = 0; i < legs.length; i++) {
        var lx = x + legs[i];
        g.fillStyle = (i === 0 || i === 2) ? DOG_PAL.d : DOG_PAL.D;
        g.fillRect(lx, dogTop + 12, 2, len);
        g.fillStyle = DOG_PAL.o;
        g.fillRect(lx, dogTop + 12 + len, 2, 1);
      }
      g.drawImage(art.dog, x, dogTop);
      // cola que se mueve
      if (Math.floor(st.t * 8) % 2) {
        g.fillStyle = C.paper; g.fillRect(x, dogTop + 3, 2, 2);
        g.fillStyle = DOG_PAL.o; g.fillRect(x + 1, dogTop + 2, 1, 1);
        g.fillStyle = DOG_PAL.D; g.fillRect(x + 1, dogTop + 3, 1, 1); g.fillRect(x + 1, dogTop + 4, 1, 1);
      }
      // orejita que rebota
      if (bob) { g.fillStyle = DOG_PAL.E; g.fillRect(x + 27, dogTop + 9, 2, 1); }

      // Lu sentada sobre el lomo
      var luX = x + 7, luY = dogTop - 8;
      // pelo al viento (mechón detrás, alterna)
      var hw = Math.floor(st.t * 5) % 2;
      g.fillStyle = LU_PAL.H;
      if (st.mode === "play" || st.mode === "start") {
        g.fillRect(luX - 1, luY + 5 + hw, 1, 6);
        if (hw) g.fillRect(luX - 2, luY + 8, 1, 3);
        else g.fillRect(luX - 2, luY + 9, 1, 2);
      }
      g.drawImage(art.lu, luX, luY);
      // parpadeo de Lu
      if (st.mode !== "over" && (st.t % 3.2) > 3.05) {
        g.fillStyle = "#f7d4b8"; g.fillRect(luX + 4, luY + 6, 1, 1); g.fillRect(luX + 9, luY + 6, 1, 1);
        g.fillStyle = "#1a1012"; g.fillRect(luX + 4, luY + 7, 1, 1); g.fillRect(luX + 9, luY + 7, 1, 1);
      }
      if (st.mode === "over") {
        // ojitos en X (Lu) y del perro
        g.fillStyle = "#f7d4b8"; g.fillRect(luX + 3, luY + 5, 3, 3); g.fillRect(luX + 8, luY + 5, 3, 3);
        g.fillStyle = "#1a1012";
        [[3, 5], [5, 5], [4, 6], [3, 7], [5, 7]].forEach(function (p) {
          g.fillRect(luX + p[0], luY + p[1], 1, 1); g.fillRect(luX + p[0] + 5, luY + p[1], 1, 1);
        });
        g.fillStyle = "#f7d4b8"; g.fillRect(luX + 6, luY + 8, 2, 1);
        g.fillStyle = "#c2456b"; g.fillRect(luX + 6, luY + 8, 2, 2);
      }
    }

    function drawWorld() {
      g.fillStyle = C.paper;
      g.fillRect(0, 0, W, H);
      // corazoncitos lejanos
      deco.hearts.forEach(function (h) { g.drawImage(art.heart, Math.round(h.x), Math.round(h.y)); });
      // nubes
      deco.clouds.forEach(function (c) { g.drawImage(art.cloud, Math.round(c.x), Math.round(c.y)); });
      // suelo
      g.fillStyle = C.ink;
      g.fillRect(0, GY, W, 1);
      g.fillStyle = C.faint2;
      g.fillRect(0, GY + 1, W, 1);
      g.fillStyle = "#a89d88";
      deco.pebbles.forEach(function (p) { g.fillRect(Math.round(p.x), p.y, p.w, 1); });
      // obstáculos
      st.obs.forEach(function (o) {
        var img = art.obst[o.k][o.f] || art.obst[o.k][0];
        g.drawImage(img, Math.round(o.x), Math.round(o.y));
        if (o.k === "pigeon") { g.fillStyle = "rgba(36,35,34,0.18)"; g.fillRect(Math.round(o.x) + 2, GY - 1, 6, 1); }
      });
      // sombra del jugador
      var sh = st.air ? Math.max(10, 28 - Math.round((GY - st.y) / 3)) : 30;
      g.fillStyle = "rgba(36,35,34,0.16)";
      g.fillRect(PX + 18 - (sh >> 1), GY - 1, sh, 1);
      drawDogAndLu(PX, Math.round(st.y));
      // destellitos
      st.sparks.forEach(function (s) {
        if (Math.floor(s.t * 12) % 2) g.drawImage(art.spark, Math.round(s.x), Math.round(s.y));
      });
    }

    function text(str, x, y, size, color, align, shadow) {
      ctx.font = "700 " + Math.round(size * K) + "px " + FONT;
      ctx.textAlign = align || "center";
      ctx.textBaseline = "middle";
      if (shadow) {
        ctx.fillStyle = shadow;
        ctx.fillText(str, Math.round(x * K) + K, Math.round(y * K) + K);
      }
      ctx.fillStyle = color;
      ctx.fillText(str, Math.round(x * K), Math.round(y * K));
    }

    function panel(x, y, w, h) {
      // caja pixel con borde duro y sombra
      g.fillStyle = C.ink; g.fillRect(x + 2, y + 2, w, h);
      g.fillStyle = C.ink; g.fillRect(x, y, w, h);
      g.fillStyle = "#f6f1e6"; g.fillRect(x + 1, y + 1, w - 2, h - 2);
    }

    function blinkOn() { return (now() % 1000) < 650; }

    function draw() {
      if (!st) return;
      drawWorld();
      var t = st.t;
      if (st.mode === "start") {
        panel(Math.round(W / 2 - 52), 18, 104, 36);
      } else if (st.mode === "over") {
        panel(Math.round(W / 2 - 54), 12, 108, 50);
      }
      var ox = 0, oy = 0;
      if (st.shake > 0) { ox = (Math.random() < 0.5 ? -1 : 1) * K; oy = (Math.random() < 0.5 ? -1 : 1) * K; }
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = C.paper;
      ctx.fillRect(0, 0, cv.width, cv.height);
      ctx.drawImage(low, 0, 0, W, H, ox, oy, W * K, H * K);

      // textos a resolución completa (nítidos)
      var sc = Math.floor(st.score);
      if (st.mode === "start") {
        text("TOCÁ PARA EMPEZAR", W / 2, 30, 8, blinkOn() ? C.pen : "#e2b3c2");
        text("Tocá para saltar", W / 2, 43, 6.5, C.ink);
        if (best > 0) text("RÉCORD " + best, W - 4, 7, 6, "#7a7262", "right");
      } else {
        var showScore = !(st.flash > 0 && Math.floor(st.flash * 8) % 2 === 0);
        if (showScore) text(String(sc).padStart(5, "0"), W - 4, 7, 7, st.flash > 0 ? C.gold : C.ink, "right");
        if (best > 0) text("RÉCORD " + best, W - 4 - 30, 7, 6, "#7a7262", "right");
        if (st.mode === "over") {
          text("¡PUM!", W / 2, 23, 11, C.red, "center", C.ink);
          text(st.newBest ? "¡Nuevo récord! " + sc : "Llegaste a " + sc, W / 2, 37, 6.5, C.ink);
          if (now() - st.deadAt > 500) text("TOCÁ PARA REINTENTAR", W / 2, 51, 6.5, blinkOn() ? C.pen : "#e2b3c2");
        }
      }
    }

    /* ───────── loop ───────── */
    var raf = 0, last = 0, visible = true, dead = false;
    function frame(ts) {
      raf = 0;
      if (dead) return;
      var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0;
      last = ts;
      update(dt);
      draw();
      schedule();
    }
    function canRun() { return !dead && visible && !document.hidden; }
    function schedule() {
      if (!raf && canRun()) raf = requestAnimationFrame(frame);
    }
    function sleep() { if (raf) { cancelAnimationFrame(raf); raf = 0; } last = 0; }
    function wake() { if (canRun()) { last = 0; schedule(); } }

    /* ───────── eventos ───────── */
    function stop(e) { e.stopPropagation(); }
    function onDown(e) {
      e.stopPropagation();
      if (e.cancelable) e.preventDefault();
      if (e.button != null && e.button > 0) return;
      try { cv.focus({ preventScroll: true }); } catch (er) { /* nada */ }
      press();
    }
    var stopEvs = ["pointerup", "click", "mousedown", "mouseup", "touchstart", "touchend", "touchmove", "pointermove", "dblclick", "contextmenu"];
    cv.addEventListener("pointerdown", onDown);
    stopEvs.forEach(function (ev) { cv.addEventListener(ev, stop, ev.indexOf("touch") === 0 ? { passive: true } : false); });

    function onKey(e) {
      if (e.key !== " " && e.key !== "ArrowUp" && e.code !== "Space") return;
      var tg = e.target;
      if (tg && tg !== cv && tg !== document.body && tg !== document.documentElement) {
        var tn = (tg.tagName || "").toLowerCase();
        if (tn === "input" || tn === "textarea" || tn === "select" || tn === "button" || tg.isContentEditable) return;
      }
      if (!visible || document.hidden) return;
      e.preventDefault();
      if (e.repeat) return;
      press();
    }
    window.addEventListener("keydown", onKey);

    function onVis() { if (document.hidden) sleep(); else wake(); }
    document.addEventListener("visibilitychange", onVis);

    var io = null;
    if ("IntersectionObserver" in window) {
      io = new IntersectionObserver(function (ents) {
        visible = ents[ents.length - 1].isIntersecting;
        if (visible) wake(); else sleep();
      });
      io.observe(cv);
    }
    var ro = null;
    if ("ResizeObserver" in window) {
      var lastW = -1;
      ro = new ResizeObserver(function () {
        var w = wrap.clientWidth;
        if (w !== lastW) { lastW = w; resize(); }
      });
      ro.observe(wrap);
    } else {
      window.addEventListener("resize", resize);
    }

    resize();
    resetDeco();
    if (document.fonts && document.fonts.load) {
      document.fonts.load("700 16px \"Pixelify Sans\"").then(function () { if (!dead) draw(); }, function () {});
    }
    wake();

    return {
      destroy: function () {
        if (dead) return;
        dead = true;
        sleep();
        cv.removeEventListener("pointerdown", onDown);
        stopEvs.forEach(function (ev) { cv.removeEventListener(ev, stop, ev.indexOf("touch") === 0 ? { passive: true } : false); });
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("resize", resize);
        document.removeEventListener("visibilitychange", onVis);
        if (io) io.disconnect();
        if (ro) ro.disconnect();
        if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
      },
      // útiles para pruebas
      _state: function () { return { mode: st.mode, score: Math.floor(st.score), best: best, obs: st.obs.map(function (o) { return [o.k, Math.round(o.x), o.w]; }), speed: st.speed, air: st.air, W: W, H: H, K: K, y: st.y, running: !!raf }; }
    };
  }

  window.Runner = { create: create };
})();
