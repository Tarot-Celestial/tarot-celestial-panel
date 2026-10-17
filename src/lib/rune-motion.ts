export type RuneMotionState = { running: boolean; paused: boolean; reduced: boolean };
export type RuneParticle = {
  x: number; y: number; vx: number; vy: number; life: number; duration: number; size: number; front: boolean;
};
export const RUNE_PARTICLE_LIMIT = { desktop: 80, mobile: 40 } as const;

export function addRuneBurst(particles: RuneParticle[], x: number, y: number, mobile: boolean, random = Math.random) {
  const count = mobile ? 10 : 20, cap = mobile ? RUNE_PARTICLE_LIMIT.mobile : RUNE_PARTICLE_LIMIT.desktop;
  const added = Array.from({ length: count }, (_, index): RuneParticle => {
    const angle = random() * Math.PI * 2, speed = 25 + random() * 90, duration = .55 + random() * .6;
    return { x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed - 20, life: duration, duration, size: .8 + random() * 1.4, front: index % 3 !== 0 };
  });
  // Every touch gets a complete new response; evict the oldest particles instead of dropping the touch.
  return [...particles.slice(-(cap - count)), ...added].slice(-cap);
}

export function runeFrame(seconds: number) {
  const phase = seconds / 5 * Math.PI * 2, cycle = seconds % 3.5;
  const pulse = Math.exp(-Math.pow((cycle - .35) / .16, 2)) * .65
    + Math.exp(-Math.pow((cycle - .76) / .2, 2)) * .45;
  return { float: Math.sin(phase) * 10, rotate: Math.sin(phase + .5) * 2, pulse,
    shadowScale: .94 - Math.sin(phase) * .07, shadowOpacity: .30 + Math.sin(phase) * .07 };
}

type Options = {
  host: HTMLElement;
  back: HTMLCanvasElement;
  front: HTMLCanvasElement;
  onState: (state: RuneMotionState) => void;
};
export type RuneMotionController = {
  pause: (paused: boolean) => void;
  tilt: (x: number, y: number) => void;
  burst: (x: number, y: number) => void;
  dispose: () => void;
};

export function createRuneMotion({ host, back, front, onState }: Options): RuneMotionController {
  const backContext = back.getContext("2d"), frontContext = front.getContext("2d");
  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reduced = motionQuery.matches, paused = false, visible = !("IntersectionObserver" in window);
  let disposed = false, running = false, frameId = 0, lastPaint = -1, lastStep = -1, seconds = 0;
  let width = 1, height = 1, mobile = false, particleCount = -1;
  let tiltX = 0, tiltY = 0, targetX = 0, targetY = 0, touchGlow = 0, touches = 0;
  let particles: RuneParticle[] = [];

  const setStyle = (key: string, value: string) => host.style.setProperty(key, value);
  function updateParticleCount() {
    if (particleCount === particles.length) return;
    particleCount = particles.length;
    host.dataset.particleCount = String(particleCount);
  }
  function applyFrame() {
    const frame = runeFrame(seconds);
    setStyle("--rune-float", `${reduced ? 0 : frame.float.toFixed(2)}px`);
    setStyle("--rune-rotate", `${reduced ? 0 : frame.rotate.toFixed(2)}deg`);
    setStyle("--rune-pulse", (reduced ? .25 : frame.pulse + touchGlow * .45).toFixed(3));
    setStyle("--rune-shadow-scale", (reduced ? 1 : frame.shadowScale).toFixed(3));
    setStyle("--rune-shadow-opacity", (reduced ? .3 : frame.shadowOpacity).toFixed(3));
    setStyle("--rune-tilt-x", `${tiltY.toFixed(2)}deg`);
    setStyle("--rune-tilt-y", `${tiltX.toFixed(2)}deg`);
  }
  function orbitPoint(angle: number, ring: number) {
    const x = Math.cos(angle) * width * (.32 + ring * .022);
    const y = Math.sin(angle) * height * (.06 + ring * .016);
    const tilt = ring ? .19 : -.21;
    return { x: width * .5 + x * Math.cos(tilt) - y * Math.sin(tilt),
      y: height * (ring ? .52 : .32) + y * Math.cos(tilt) + x * Math.sin(tilt), front: Math.sin(angle) > 0 };
  }
  function drawLayer(context: CanvasRenderingContext2D, isFront: boolean) {
    context.clearRect(0, 0, width, height);
    context.lineCap = "round";
    // Two thin elliptical ribbons, each split into front/back halves around the stone.
    for (let ring = 0; ring < 2; ring++) {
      context.beginPath();
      let started = false;
      for (let step = 0; step <= 96; step++) {
        const point = orbitPoint(step / 96 * Math.PI * 2, ring);
        if (point.front !== isFront) { started = false; continue; }
        if (started) context.lineTo(point.x, point.y); else context.moveTo(point.x, point.y);
        started = true;
      }
      // A broad translucent stroke plus a fine core reads as light without shadowBlur or canvas filters.
      context.strokeStyle = isFront ? "rgba(226,35,53,.16)" : "rgba(185,29,46,.09)";
      context.lineWidth = 4.4;
      context.stroke();
      context.strokeStyle = isFront ? "rgba(255,91,75,.65)" : "rgba(218,56,63,.40)";
      context.lineWidth = ring ? .9 : 1.1;
      context.stroke();
      const head = seconds * (ring ? -.5 : .65) + ring * 2.4;
      for (let segment = 0; segment < 12; segment++) {
        const a = orbitPoint(head - segment * .033, ring), b = orbitPoint(head - (segment + 1) * .033, ring);
        if (a.front !== isFront) continue;
        context.beginPath(); context.moveTo(a.x, a.y); context.lineTo(b.x, b.y);
        context.lineWidth = 4.8 - segment * .2;
        context.strokeStyle = `rgba(244,36,53,${.22 * (1 - segment / 12)})`;
        context.stroke();
        context.lineWidth = 1.8 - segment * .09;
        context.strokeStyle = `rgba(255,${163 - segment * 8},${112 - segment * 5},${.93 * (1 - segment / 12)})`;
        context.stroke();
      }
      const point = orbitPoint(head, ring);
      if (point.front === isFront) {
        for (const [radius, color] of [[8, "rgba(239,40,55,.13)"], [4, "rgba(255,103,75,.38)"], [1.7, "rgba(255,231,183,.95)"]] as const) {
          context.beginPath(); context.arc(point.x, point.y, radius, 0, Math.PI * 2);
          context.fillStyle = color; context.fill();
        }
        context.beginPath(); context.moveTo(point.x - 6, point.y - 2); context.lineTo(point.x + 6, point.y + 2);
        context.moveTo(point.x - 1, point.y - 4); context.lineTo(point.x + 1, point.y + 4);
        context.lineWidth = .65; context.strokeStyle = "rgba(255,168,111,.7)"; context.stroke();
      }
    }
    // Sparse embers rise around the stone; their positions are analytic, with no growing object pool.
    for (let index = 0; index < (mobile ? 8 : 14); index++) {
      if ((index % 2 === 0) !== isFront) continue;
      const travel = (seconds * (.09 + index % 3 * .012) + index * .137) % 1;
      const x = width * (.23 + ((index * .618) % .54)) + Math.sin(seconds * .6 + index) * 9;
      const y = height * (.76 - travel * .6);
      const alpha = Math.sin(travel * Math.PI) * .5;
      context.beginPath(); context.arc(x, y, index % 3 ? 1 : 1.6, 0, Math.PI * 2);
      context.fillStyle = `rgba(255,103,66,${alpha})`; context.fill();
    }
    for (const particle of particles) {
      if (particle.front !== isFront) continue;
      const alpha = Math.max(0, particle.life / particle.duration);
      context.beginPath(); context.moveTo(particle.x, particle.y);
      context.lineTo(particle.x - particle.vx * .025, particle.y - particle.vy * .025);
      context.strokeStyle = `rgba(255,${Math.round(110 + alpha * 105)},${Math.round(65 + alpha * 85)},${alpha})`;
      context.lineWidth = particle.size; context.stroke();
    }
  }
  function draw() {
    if (backContext) drawLayer(backContext, false);
    if (frontContext) drawLayer(frontContext, true);
    applyFrame();
    updateParticleCount();
  }
  function tick(now: number) {
    frameId = 0;
    if (!running || disposed) return;
    const interval = 1000 / (mobile ? 30 : 45);
    const budget = now - lastPaint;
    if (lastPaint < 0 || budget + .01 >= interval) {
      const delta = lastStep >= 0 ? Math.min((now - lastStep) / 1000, .08) : 0;
      lastStep = now;
      // Preserve leftover time: resetting to 'now' would turn the 45fps cap into 30fps on a 60Hz screen.
      lastPaint = lastPaint < 0 ? now : lastPaint + Math.floor((budget + .01) / interval) * interval;
      seconds += delta;
      tiltX += (targetX - tiltX) * .14; tiltY += (targetY - tiltY) * .14;
      touchGlow = Math.max(0, touchGlow - delta * 2);
      particles = particles.filter(particle => {
        particle.life -= delta;
        particle.x += particle.vx * delta; particle.y += particle.vy * delta;
        particle.vy += 22 * delta;
        return particle.life > 0;
      });
      draw();
    }
    frameId = window.requestAnimationFrame(tick);
  }
  function sync() {
    if (disposed) return;
    const next = !paused && !reduced && visible && !document.hidden && !!backContext && !!frontContext;
    if (next !== running) {
      running = next;
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = 0; lastPaint = lastStep = -1;
      if (running) {
        host.dataset.staticResponse = "false";
        frameId = window.requestAnimationFrame(tick);
      }
    }
    host.dataset.running = String(running);
    host.dataset.paused = String(paused);
    host.dataset.reduced = String(reduced);
    host.dataset.motion = reduced ? "reduced" : running ? "running" : "paused";
    onState({ running, paused, reduced });
  }
  function resize() {
    if (disposed) return;
    const rect = host.getBoundingClientRect();
    width = Math.max(1, rect.width); height = Math.max(1, rect.height);
    mobile = width < 390;
    const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
    for (const canvas of [back, front]) { canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio); }
    backContext?.setTransform(ratio, 0, 0, ratio, 0, 0);
    frontContext?.setTransform(ratio, 0, 0, ratio, 0, 0);
    particles = particles.slice(-(mobile ? RUNE_PARTICLE_LIMIT.mobile : RUNE_PARTICLE_LIMIT.desktop));
    draw();
  }
  const visibility = () => sync();
  const motion = () => {
    reduced = motionQuery.matches;
    if (reduced) { particles = []; tiltX = tiltY = targetX = targetY = touchGlow = 0; draw(); }
    sync();
  };
  const intersection = "IntersectionObserver" in window ? new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.target === host && entry.isIntersecting);
    sync();
  }, { threshold: .01 }) : null;
  const resizeObserver = "ResizeObserver" in window ? new ResizeObserver(resize) : null;
  intersection?.observe(host); resizeObserver?.observe(host);
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", visibility);
  motionQuery.addEventListener("change", motion);
  resize(); sync();

  return {
    pause(value) { paused = value; sync(); },
    tilt(x, y) {
      if (!running) return;
      targetX = Math.max(-1, Math.min(1, x)) * 2;
      targetY = Math.max(-1, Math.min(1, y)) * -2;
    },
    burst(x, y) {
      if (disposed) return;
      const px = Math.max(0, Math.min(width, x)), py = Math.max(0, Math.min(height, y));
      touches++;
      setStyle("--rune-hit-x", `${px}px`); setStyle("--rune-hit-y", `${py}px`);
      setStyle("--rune-hit-turn", `${touches % 2 ? 15 : -15}deg`);
      host.dataset.responded = "true";
      if (!running) {
        host.dataset.staticResponse = "true";
        return;
      }
      host.dataset.staticResponse = "false";
      particles = addRuneBurst(particles, px, py, mobile);
      touchGlow = .7;
      updateParticleCount();
    },
    dispose() {
      disposed = true; running = false;
      if (frameId) window.cancelAnimationFrame(frameId);
      frameId = 0; particles = [];
      intersection?.disconnect(); resizeObserver?.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", visibility);
      motionQuery.removeEventListener("change", motion);
      backContext?.clearRect(0, 0, width, height); frontContext?.clearRect(0, 0, width, height);
      host.dataset.running = "false"; host.dataset.motion = "paused"; host.dataset.particleCount = "0";
    },
  };
}
