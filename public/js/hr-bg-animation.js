"use strict";

(function () {
  const canvas = document.getElementById("hrBgCanvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");

  /* ── Resize ────────────────────────────────────────────────────────────── */
  function resize() {
    canvas.width  = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  /* ── Colours ───────────────────────────────────────────────────────────── */
  const PINK   = "#E2136E";
  const PURPLE = "#8B5CF6";

  /* ── Floating particles ─────────────────────────────────────────────────── */
  const PARTICLE_TYPES = ["doc", "star", "check", "circle", "cv"];
  const NUM_PARTICLES  = 22;

  class Particle {
    constructor(i) {
      this._i = i;
      this.reset(true);
    }
    reset(initial) {
      const W = canvas.width;
      const H = canvas.height;
      this.x        = Math.random() * W;
      this.y        = initial ? Math.random() * H : H + 20;
      this.size     = 7 + Math.random() * 10;
      this.speed    = 0.25 + Math.random() * 0.45;
      this.opacity  = 0;
      this.maxOp    = 0.10 + Math.random() * 0.18;
      this.type     = PARTICLE_TYPES[Math.floor(Math.random() * PARTICLE_TYPES.length)];
      this.rot      = Math.random() * Math.PI * 2;
      this.rotSpeed = (Math.random() - 0.5) * 0.018;
      this.drift    = (Math.random() - 0.5) * 0.28;
      this.color    = Math.random() > 0.5 ? PINK : PURPLE;
    }
    update() {
      this.y   -= this.speed;
      this.x   += this.drift;
      this.rot += this.rotSpeed;
      if (this.y < canvas.height * 0.8) this.opacity = Math.min(this.opacity + 0.006, this.maxOp);
      if (this.y < -30) this.reset(false);
    }
    draw() {
      ctx.save();
      ctx.globalAlpha = this.opacity;
      ctx.translate(this.x, this.y);
      ctx.rotate(this.rot);
      ctx.strokeStyle = this.color;
      ctx.fillStyle   = this.color;
      ctx.lineWidth   = 1.6;
      const s = this.size;

      switch (this.type) {
        case "doc":
        case "cv": {
          /* Document / CV shape */
          ctx.beginPath();
          ctx.roundRect(-s * 0.5, -s * 0.65, s, s * 1.3, 2);
          ctx.stroke();
          for (let l = 0; l < 3; l++) {
            ctx.beginPath();
            ctx.moveTo(-s * 0.32, -s * 0.38 + l * s * 0.32);
            ctx.lineTo( s * 0.32, -s * 0.38 + l * s * 0.32);
            ctx.globalAlpha = this.opacity * 0.7;
            ctx.stroke();
            ctx.globalAlpha = this.opacity;
          }
          if (this.type === "cv") {
            /* Small "CV" text hint */
            ctx.font = `bold ${s * 0.28}px Inter,sans-serif`;
            ctx.textAlign = "center";
            ctx.fillText("CV", 0, -s * 0.05);
          }
          break;
        }
        case "star": {
          drawStar(ctx, 0, 0, 5, s * 0.55, s * 0.22);
          ctx.globalAlpha = this.opacity * 0.6;
          ctx.fill();
          break;
        }
        case "check": {
          ctx.lineWidth = 2.2;
          ctx.lineCap   = "round";
          ctx.lineJoin  = "round";
          ctx.beginPath();
          ctx.moveTo(-s * 0.42, 0);
          ctx.lineTo(-s * 0.08, s * 0.38);
          ctx.lineTo( s * 0.42, -s * 0.38);
          ctx.stroke();
          break;
        }
        case "circle": {
          ctx.beginPath();
          ctx.arc(0, 0, s * 0.42, 0, Math.PI * 2);
          ctx.globalAlpha = this.opacity * 0.4;
          ctx.stroke();
          break;
        }
      }
      ctx.restore();
    }
  }

  function drawStar(ctx, cx, cy, spikes, outer, inner) {
    let rot  = -Math.PI / 2;
    const step = Math.PI / spikes;
    ctx.beginPath();
    for (let i = 0; i < spikes * 2; i++) {
      const r = i % 2 === 0 ? outer : inner;
      ctx.lineTo(cx + Math.cos(rot) * r, cy + Math.sin(rot) * r);
      rot += step;
    }
    ctx.closePath();
  }

  const particles = Array.from({ length: NUM_PARTICLES }, (_, i) => new Particle(i));

  /* ── Person silhouette ──────────────────────────────────────────────────── */
  function drawPerson(x, y, sz, color, alpha, flip) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = color;
    ctx.strokeStyle = color;
    ctx.lineCap     = "round";
    ctx.lineJoin    = "round";

    if (flip) ctx.scale(-1, 1), (x = -x);

    /* Head */
    ctx.beginPath();
    ctx.arc(x, y - sz * 0.60, sz * 0.17, 0, Math.PI * 2);
    ctx.fill();

    /* Neck + body */
    ctx.lineWidth = sz * 0.09;
    ctx.beginPath();
    ctx.moveTo(x, y - sz * 0.43);
    ctx.lineTo(x, y);
    ctx.stroke();

    /* Shoulders / arms */
    ctx.lineWidth = sz * 0.07;
    ctx.beginPath();
    ctx.moveTo(x - sz * 0.28, y - sz * 0.22);
    ctx.lineTo(x,              y - sz * 0.35);
    ctx.lineTo(x + sz * 0.28, y - sz * 0.22);
    ctx.stroke();

    /* Forearms */
    ctx.lineWidth = sz * 0.06;
    ctx.beginPath();
    ctx.moveTo(x - sz * 0.28, y - sz * 0.22);
    ctx.lineTo(x - sz * 0.20, y + sz * 0.04);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + sz * 0.28, y - sz * 0.22);
    ctx.lineTo(x + sz * 0.22, y + sz * 0.02);
    ctx.stroke();

    /* Legs */
    ctx.lineWidth = sz * 0.09;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - sz * 0.18, y + sz * 0.38);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + sz * 0.18, y + sz * 0.38);
    ctx.stroke();

    ctx.restore();
  }

  /* ── HR chair + document on desk ────────────────────────────────────────── */
  function drawDesk(x, y, w, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = "rgba(226,19,110,0.35)";
    ctx.fillStyle   = "rgba(226,19,110,0.06)";
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = "round";

    /* Table top */
    ctx.beginPath();
    ctx.roundRect(x - w / 2, y, w, 10, 5);
    ctx.fill();
    ctx.stroke();

    /* Table legs */
    ctx.lineWidth = 2;
    [[x - w * 0.38, y + 10], [x + w * 0.38, y + 10]].forEach(([lx, ly]) => {
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx, ly + 28);
      ctx.stroke();
    });

    /* Document on table */
    ctx.fillStyle   = "rgba(226,19,110,0.12)";
    ctx.strokeStyle = "rgba(226,19,110,0.3)";
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.roundRect(x - 18, y - 28, 36, 26, 3);
    ctx.fill();
    ctx.stroke();
    for (let l = 0; l < 3; l++) {
      ctx.beginPath();
      ctx.moveTo(x - 12, y - 22 + l * 7);
      ctx.lineTo(x + 12, y - 22 + l * 7);
      ctx.globalAlpha = alpha * 0.5;
      ctx.stroke();
      ctx.globalAlpha = alpha;
    }

    ctx.restore();
  }

  /* ── Label under person ─────────────────────────────────────────────────── */
  function drawLabel(text, x, y, color, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha * 0.55;
    ctx.font        = `700 12px Inter,sans-serif`;
    ctx.fillStyle   = color;
    ctx.textAlign   = "center";
    ctx.letterSpacing = "0.08em";
    ctx.fillText(text.toUpperCase(), x, y);
    ctx.restore();
  }

  /* ── Aura pulse ─────────────────────────────────────────────────────────── */
  function drawAura(x, y, r, color, alpha) {
    const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0,   color.replace(")", `, ${alpha})`).replace("rgb", "rgba"));
    grad.addColorStop(0.5, color.replace(")", `, ${alpha * 0.3})`).replace("rgb", "rgba"));
    grad.addColorStop(1,   "transparent");
    ctx.save();
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ── Animated connection dots ────────────────────────────────────────────── */
  let connProgress = 0;

  function drawConnection(x1, y1, x2, y2, alpha) {
    connProgress = (connProgress + 0.004) % 1;
    const N = 7;
    for (let i = 0; i < N; i++) {
      const p   = (connProgress + i / N) % 1;
      const t2  = p * p * (3 - 2 * p); // smooth-step
      const cx  = x1 + (x2 - x1) * t2;
      const cy  = y1 + (y2 - y1) * t2 - Math.sin(p * Math.PI) * 38;
      const op  = Math.sin(p * Math.PI) * alpha;
      const sz  = 2.5 + Math.sin(p * Math.PI) * 2;
      ctx.save();
      ctx.globalAlpha = op;
      ctx.fillStyle   = p < 0.5 ? PURPLE : PINK;
      ctx.beginPath();
      ctx.arc(cx, cy, sz, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  /* ── Main loop ──────────────────────────────────────────────────────────── */
  let raf;
  let t = 0;
  let running = false;

  function stop()  { if (raf) { cancelAnimationFrame(raf); raf = null; running = false; } }
  function start() { if (!running) { running = true; loop(); } }

  function loop() {
    raf = requestAnimationFrame(loop);
    t  += 0.014;
    const W = canvas.width;
    const H = canvas.height;
    if (W < 10 || H < 10) return;

    ctx.clearRect(0, 0, W, H);

    /* Background radial glows */
    const gL = ctx.createRadialGradient(W * 0.18, H * 0.35, 0, W * 0.18, H * 0.35, W * 0.38);
    gL.addColorStop(0, "rgba(226,19,110,0.055)");
    gL.addColorStop(1, "transparent");
    ctx.fillStyle = gL;
    ctx.fillRect(0, 0, W, H);

    const gR = ctx.createRadialGradient(W * 0.82, H * 0.35, 0, W * 0.82, H * 0.35, W * 0.38);
    gR.addColorStop(0, "rgba(139,92,246,0.055)");
    gR.addColorStop(1, "transparent");
    ctx.fillStyle = gR;
    ctx.fillRect(0, 0, W, H);

    /* Sizing — scale relative to panel */
    const SZ   = Math.min(W * 0.075, 78);
    const centY = H * 0.44;
    const hrX   = W * 0.22;
    const appX  = W * 0.78;
    const breathHR  = Math.sin(t)         * 4;
    const breathApp = Math.sin(t + Math.PI) * 4;

    /* Auras */
    drawAura(hrX,  centY + breathHR,  SZ * 2.4, "rgb(226,19,110)",  0.18);
    drawAura(appX, centY + breathApp, SZ * 2.4, "rgb(139,92,246)",  0.18);

    /* Desk */
    drawDesk(W / 2, centY + SZ * 0.15, SZ * 4.2, 0.9);

    /* HR person */
    drawPerson(hrX, centY + breathHR, SZ, "rgba(226,19,110,0.22)", 1, false);
    drawLabel("HR Manager", hrX, centY + SZ * 0.72 + breathHR, PINK, 1);

    /* Applicant person */
    drawPerson(appX, centY + breathApp, SZ, "rgba(139,92,246,0.22)", 1, true);
    drawLabel("Applicant", appX, centY + SZ * 0.72 + breathApp, PURPLE, 1);

    /* Animated connection arc (CV traveling from applicant to HR) */
    const arcY = centY - SZ * 0.30;
    drawConnection(appX, arcY, hrX, arcY, 0.65);

    /* Floating particles */
    particles.forEach(p => { p.update(); p.draw(); });
  }

  /* ── Pause when panel hidden ────────────────────────────────────────────── */
  const panel = canvas.closest(".hr-panel");
  if (panel) {
    new MutationObserver(() => {
      panel.classList.contains("hidden") ? stop() : (resize(), start());
    }).observe(panel, { attributes: true, attributeFilter: ["class"] });
  }

  start();
})();
