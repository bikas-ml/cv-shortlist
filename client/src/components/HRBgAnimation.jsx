import { useEffect, useRef } from 'react';

export default function HRBgAnimation() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animId;

    function resize() {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    }
    resize();

    const ICONS = ['📄', '⭐', '✅', '◉', '📋'];
    const particles = Array.from({ length: 22 }, (_, i) => ({
      x: Math.random() * canvas.width,
      y: canvas.height + Math.random() * 200,
      icon: ICONS[i % ICONS.length],
      speed: 0.4 + Math.random() * 0.6,
      drift: Math.random() * Math.PI * 2,
      driftSpeed: 0.01 + Math.random() * 0.02,
      rot: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.03,
      size: 14 + Math.random() * 12,
      alpha: 0.15 + Math.random() * 0.25,
    }));

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        p.y -= p.speed;
        p.drift += p.driftSpeed;
        p.x += Math.sin(p.drift) * 0.6;
        p.rot += p.rotSpeed;
        if (p.y < -40) {
          p.y = canvas.height + 20;
          p.x = Math.random() * canvas.width;
        }
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.font = `${p.size}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(p.icon, 0, 0);
        ctx.restore();
      }
      animId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }}
    />
  );
}
