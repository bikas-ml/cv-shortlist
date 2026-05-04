"use strict";

/* Dynamic Neural Network Background — injected into every page */
(function () {
  const canvas = document.createElement("canvas");
  canvas.id = "neuralCanvas";
  Object.assign(canvas.style, {
    position:      "fixed",
    top:           "0",
    left:          "0",
    width:         "100%",
    height:        "100%",
    zIndex:        "0",
    pointerEvents: "none",
  });
  document.body.insertBefore(canvas, document.body.firstChild);

  const ctx = canvas.getContext("2d");

  const CFG = {
    nodeCount:      62,
    connectRadius:  170,
    moveSpeed:      0.32,
    maxPulses:      22,
    pulseStep:      0.0055,
    nodeOpacity:    0.28,
    lineOpacityMax: 0.09,
    pulseOpacity:   0.82,
    pulseRadius:    3.2,
    glowRadius:     7,
  };

  let W = 0, H = 0;
  let nodes  = [];
  let pulses = [];
  let raf;

  /* ── Resize ── */
  function resize() {
    W = canvas.width  = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  /* ── Initialise nodes ── */
  function initNodes() {
    nodes = Array.from({ length: CFG.nodeCount }, () => ({
      x:  Math.random() * W,
      y:  Math.random() * H,
      vx: (Math.random() - 0.5) * CFG.moveSpeed,
      vy: (Math.random() - 0.5) * CFG.moveSpeed,
      r:  Math.random() * 1.8 + 1.4,
    }));
  }

  /* ── Spawn a pulse ── */
  function spawnPulse() {
    if (pulses.length >= CFG.maxPulses || Math.random() > 0.045) return;
    const fi = Math.floor(Math.random() * nodes.length);
    const from = nodes[fi];
    const candidates = nodes.filter((n, i) => {
      if (i === fi) return false;
      return Math.hypot(n.x - from.x, n.y - from.y) < CFG.connectRadius;
    });
    if (!candidates.length) return;
    const to = candidates[Math.floor(Math.random() * candidates.length)];
    pulses.push({ from, to, t: 0 });
  }

  /* ── Draw frame ── */
  function draw() {
    ctx.clearRect(0, 0, W, H);

    /* Edges */
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const dx = nodes[j].x - nodes[i].x;
        const dy = nodes[j].y - nodes[i].y;
        const d  = Math.hypot(dx, dy);
        if (d >= CFG.connectRadius) continue;
        const a = (1 - d / CFG.connectRadius) * CFG.lineOpacityMax;
        ctx.beginPath();
        ctx.moveTo(nodes[i].x, nodes[i].y);
        ctx.lineTo(nodes[j].x, nodes[j].y);
        ctx.strokeStyle = `rgba(226,19,110,${a.toFixed(3)})`;
        ctx.lineWidth   = 0.75;
        ctx.stroke();
      }
    }

    /* Nodes */
    nodes.forEach(n => {
      /* outer glow */
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r + 3, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(226,19,110,0.055)`;
      ctx.fill();
      /* core dot */
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(226,19,110,${CFG.nodeOpacity})`;
      ctx.fill();
    });

    /* Pulses */
    pulses = pulses.filter(p => {
      const x = p.from.x + (p.to.x - p.from.x) * p.t;
      const y = p.from.y + (p.to.y - p.from.y) * p.t;
      const fade = CFG.pulseOpacity * (1 - p.t * 0.55);
      /* glow halo */
      ctx.beginPath();
      ctx.arc(x, y, CFG.glowRadius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(226,19,110,${(fade * 0.28).toFixed(3)})`;
      ctx.fill();
      /* bright core */
      ctx.beginPath();
      ctx.arc(x, y, CFG.pulseRadius, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(226,19,110,${fade.toFixed(3)})`;
      ctx.fill();
      p.t += CFG.pulseStep;
      return p.t <= 1;
    });

    /* Move nodes & bounce */
    nodes.forEach(n => {
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < 0 || n.x > W) n.vx *= -1;
      if (n.y < 0 || n.y > H) n.vy *= -1;
    });

    spawnPulse();
    raf = requestAnimationFrame(draw);
  }

  /* ── Boot ── */
  resize();
  initNodes();
  window.addEventListener("resize", () => { resize(); initNodes(); });
  draw();

  /* Pause when tab hidden (saves CPU) */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
    } else {
      raf = requestAnimationFrame(draw);
    }
  });
})();
