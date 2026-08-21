import { useEffect, useRef } from "react";

// Ambient background for Glass (classic) theme in dark mode — a slowly
// undulating field of particles rising from blue into violet, plus a
// twinkling starfield, sitting behind the frosted-glass sidebar/header
// (see [data-design="classic"] .admin-sidebar's backdrop-filter: blur, which
// is exactly what reveals this). Self-gates on both design + dark mode via
// MutationObserver since AdminLayout stores those as plain DOM attributes
// (localStorage-backed), not React state this component can subscribe to.
// Neo Brutal / light Glass render nothing — cheap early-out, no canvas work.
export function GlassDarkBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const activeRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, DPR = 1;
    let raf = 0;
    const t0 = performance.now();

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
    const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

    const C_BLUE: [number, number, number] = [77, 105, 255];
    const C_PURPLE: [number, number, number] = [178, 59, 255];
    const C_HILITE: [number, number, number] = [239, 230, 255];
    function rampColor(t: number, bright: number): [number, number, number] {
      t = clamp01(t);
      let r = lerp(C_BLUE[0], C_PURPLE[0], t);
      let g = lerp(C_BLUE[1], C_PURPLE[1], t);
      let b = lerp(C_BLUE[2], C_PURPLE[2], t);
      const hb = clamp01(bright);
      r = lerp(r, C_HILITE[0], hb * 0.6);
      g = lerp(g, C_HILITE[1], hb * 0.6);
      b = lerp(b, C_HILITE[2], hb * 0.6);
      return [r | 0, g | 0, b | 0];
    }

    const cols = 70, rows = 28;
    let meshPts: { u: number; v: number }[][] = [];
    let ambient: { x: number; y: number; r: number; phase: number; speed: number; tint: number }[] = [];
    let spires: { u: number; v: number; baseXOff: number; h: number; phase: number; speed: number; r: number }[] = [];
    let stars: { x: number; y: number; r: number; phase: number; speed: number; flare: boolean }[] = [];

    function project(u: number, v: number, t: number) {
      const baseX = lerp(-0.08, 1.05, u) * W;
      const depthLift = Math.pow(v, 1.6);
      const baseY = H * (0.56 + 0.4 * (1 - depthLift)) - v * H * 0.02;
      const diag = u * 0.7 + (1 - v) * 0.3;
      const swell = Math.sin(diag * 9.5 - t * 0.55 + v * 3.0) * (10 + 22 * v);
      const swell2 = Math.sin(diag * 3.1 + t * 0.22) * (6 + 10 * v);
      let y = baseY - swell - swell2 - v * H * 0.3 * u;
      const rise = clamp01((u - 0.12) * 1.35) * clamp01(v * 1.2 + 0.15);
      y -= rise * H * 0.2;
      return { x: baseX, y, rise, u, v };
    }

    function buildField() {
      meshPts = [];
      for (let j = 0; j < rows; j++) {
        const row = [];
        for (let i = 0; i < cols; i++) row.push({ u: i / (cols - 1), v: j / (rows - 1) });
        meshPts.push(row);
      }
      ambient = Array.from({ length: Math.floor((W * H) / 12000) }, () => ({
        x: Math.random() * W, y: Math.random() * H * 0.62, r: Math.random() * 1.3 + 0.3,
        phase: Math.random() * Math.PI * 2, speed: 0.4 + Math.random() * 0.8, tint: Math.random(),
      }));
      spires = Array.from({ length: 18 }, () => {
        const u = Math.pow(Math.random(), 0.6);
        return {
          u, v: Math.random() * 0.9 + 0.05, baseXOff: (Math.random() - 0.5) * 40,
          h: lerp(H * 0.1, H * 0.4, Math.random()) * (0.4 + u * 0.8),
          phase: Math.random() * Math.PI * 2, speed: 0.6 + Math.random() * 0.6, r: lerp(1.4, 2.8, u),
        };
      });
      stars = Array.from({ length: Math.floor((W * H) / 4200) }, () => {
        const big = Math.random() < 0.12;
        return {
          x: Math.random() * W, y: Math.pow(Math.random(), 1.4) * H * 0.78,
          r: big ? lerp(1.2, 2.0, Math.random()) : lerp(0.35, 0.9, Math.random()),
          phase: Math.random() * Math.PI * 2, speed: 0.5 + Math.random() * 1.8, flare: big,
        };
      });
    }

    function resize() {
      const rect = canvas!.getBoundingClientRect();
      DPR = Math.min(window.devicePixelRatio || 1, 2);
      W = rect.width;
      H = rect.height;
      canvas!.width = W * DPR;
      canvas!.height = H * DPR;
      ctx!.setTransform(DPR, 0, 0, DPR, 0, 0);
      buildField();
    }

    function drawStars(t: number) {
      for (const s of stars) {
        const wave = Math.sin(t * s.speed + s.phase);
        const tw = clamp01(0.15 + 0.85 * Math.pow(0.5 + 0.5 * wave, 3));
        const alpha = 0.25 + tw * 0.75;
        ctx!.fillStyle = `rgba(235,232,255,${alpha})`;
        ctx!.beginPath();
        ctx!.arc(s.x, s.y, s.r, 0, Math.PI * 2);
        ctx!.fill();
        if (s.flare && tw > 0.7) {
          const flareLen = s.r * (5 + 6 * tw);
          const fa = ((tw - 0.7) / 0.3) * 0.5;
          ctx!.strokeStyle = `rgba(235,232,255,${fa})`;
          ctx!.lineWidth = 0.6;
          ctx!.beginPath();
          ctx!.moveTo(s.x - flareLen, s.y);
          ctx!.lineTo(s.x + flareLen, s.y);
          ctx!.moveTo(s.x, s.y - flareLen);
          ctx!.lineTo(s.x, s.y + flareLen);
          ctx!.stroke();
        }
      }
    }

    function drawAmbient(t: number) {
      for (const p of ambient) {
        const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * p.speed + p.phase));
        const col = rampColor(p.tint, tw * 0.5);
        ctx!.beginPath();
        ctx!.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${tw * 0.85})`;
        ctx!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function drawSpires(t: number) {
      for (const s of spires) {
        const base = project(s.u, s.v, t);
        const bx = base.x + s.baseXOff, by = base.y;
        const pulse = 0.5 + 0.5 * Math.sin(t * s.speed + s.phase);
        const topY = by - s.h * (0.75 + 0.25 * pulse);
        const col = rampColor(s.u, 0.35 + 0.4 * pulse);
        const rgba = `rgba(${col[0]},${col[1]},${col[2]},`;
        const lg = ctx!.createLinearGradient(bx, by, bx, topY);
        lg.addColorStop(0, rgba + "0.0)");
        lg.addColorStop(0.7, rgba + (0.25 + 0.2 * pulse) + ")");
        lg.addColorStop(1, rgba + (0.55 + 0.3 * pulse) + ")");
        ctx!.strokeStyle = lg;
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.moveTo(bx, by);
        ctx!.lineTo(bx, topY);
        ctx!.stroke();
        const glowR = s.r * (1.4 + 1.6 * pulse);
        const glow = ctx!.createRadialGradient(bx, topY, 0, bx, topY, glowR);
        glow.addColorStop(0, rgba + "0.9)");
        glow.addColorStop(1, rgba + "0)");
        ctx!.fillStyle = glow;
        ctx!.beginPath();
        ctx!.arc(bx, topY, glowR, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},0.95)`;
        ctx!.beginPath();
        ctx!.arc(bx, topY, s.r * 0.6, 0, Math.PI * 2);
        ctx!.fill();
      }
    }

    function drawMesh(t: number) {
      for (let j = rows - 1; j >= 0; j--) {
        for (let i = 0; i < cols; i++) {
          const m = meshPts[j][i];
          const p = project(m.u, m.v, t);
          if (p.rise < 0.015) continue;
          const bright = clamp01(p.rise * 1.15 + (p.v - 0.5) * 0.15);
          const col = rampColor(p.u, bright);
          const alpha = clamp01(0.1 + p.rise * 0.95);
          const size = lerp(0.5, 2.0, clamp01(p.rise * 1.1));
          ctx!.fillStyle = `rgba(${col[0]},${col[1]},${col[2]},${alpha})`;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, size, 0, Math.PI * 2);
          ctx!.fill();
          if (bright > 0.62 && (i + j) % 5 === 0) {
            const glowR = size * 5;
            const g = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, glowR);
            g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${alpha * 0.5})`);
            g.addColorStop(1, `rgba(${col[0]},${col[1]},${col[2]},0)`);
            ctx!.fillStyle = g;
            ctx!.beginPath();
            ctx!.arc(p.x, p.y, glowR, 0, Math.PI * 2);
            ctx!.fill();
          }
        }
      }
    }

    function frame(now: number) {
      if (!activeRef.current) return;
      const t = (now - t0) / 1000;
      ctx!.clearRect(0, 0, W, H);
      drawStars(t);
      drawAmbient(t);
      drawMesh(t);
      drawSpires(t);
      if (!reduceMotion) raf = requestAnimationFrame(frame);
    }

    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();

    const html = document.documentElement;
    const syncActive = () => {
      const shouldRun = html.getAttribute("data-design") === "classic" && html.classList.contains("dark");
      if (shouldRun && !activeRef.current) {
        activeRef.current = true;
        raf = requestAnimationFrame(frame);
      } else if (!shouldRun && activeRef.current) {
        activeRef.current = false;
        cancelAnimationFrame(raf);
        ctx!.clearRect(0, 0, W, H);
      }
    };
    syncActive();
    const mo = new MutationObserver(syncActive);
    mo.observe(html, { attributes: true, attributeFilter: ["class", "data-design"] });
    if (reduceMotion && activeRef.current) frame(t0 + 1);

    return () => {
      mo.disconnect();
      ro.disconnect();
      activeRef.current = false;
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
    />
  );
}
