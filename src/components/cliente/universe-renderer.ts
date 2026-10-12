import * as THREE from "three";
import { createPlanetVisual, type PlanetVisual } from "./universe-planets";
import { advanceFrameBudget, dampingFactor, qualityProfile, seededRandom, travelPose, type UniverseDestination } from "./universe-motion";

export type UniverseController = {
  setDestination: (destination: UniverseDestination) => void;
  setScroll: (progress: number) => void;
  setPointer: (x: number, y: number) => void;
  setMotion: (enabled: boolean) => void;
  setVisible: (visible: boolean) => void;
  resize: () => void;
  dispose: () => void;
};
type Actor = { visual: PlanetVisual; destination: UniverseDestination; x: number; z: number; scale: number; opacity: number };
type Flight = { elapsed: number; direction: number; x: number; z: number; scale: number; opacity: number };
type Options = { host: HTMLDivElement; destination: UniverseDestination; motion: boolean; signal: AbortSignal; onStatus: (ready: boolean) => void };

/** Loaded on demand in the browser. One renderer/atlas survives client tab navigation. */
export async function createUniverseRenderer(options: Options): Promise<UniverseController | null> {
  const { host, signal, onStatus } = options;
  if (signal.aborted) return null;
  const nav = navigator as Navigator & { deviceMemory?: number; connection?: { saveData?: boolean } };
  const profile = () => qualityProfile({ width: innerWidth, dpr: devicePixelRatio, deviceMemory: nav.deviceMemory, hardwareConcurrency: nav.hardwareConcurrency, saveData: nav.connection?.saveData });
  let quality = profile();
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false, powerPreference: "low-power" });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.setAttribute("aria-hidden", "true");
  host.appendChild(renderer.domElement);
  const world = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 110);
  camera.position.set(0, 0, 9);
  let disposed = false, lost = false, ready = false, visible = !document.hidden;
  let motion = options.motion, frame = 0, lastTick = 0, lastPaint = 0, frameBudget = 0, elapsed = 0, frames = 0;
  let targetScroll = 0, scroll = 0, pointerX = 0, pointerY = 0, targetX = 0, targetY = 0;
  let baseX = 3, baseY = -0.8, baseScale = 4.4;
  let atlas: THREE.Texture | null = null, current: Actor | null = null, incoming: Actor | null = null, flight: Flight | null = null;
  let destination = options.destination;
  let stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;

  function removeActor(item: Actor | null) {
    if (!item) return;
    world.remove(item.visual.group); item.visual.dispose();
  }
  function actor(next: UniverseDestination): Actor {
    const visual = createPlanetVisual(atlas!, next, quality.maxFps <= 30);
    world.add(visual.group);
    return { visual, destination: next, x: 0, z: 0, scale: 1, opacity: 1 };
  }
  function settle() {
    if (incoming) { removeActor(current); current = incoming; incoming = null; }
    flight = null;
    if (current) { current.x = 0; current.z = 0; current.scale = 1; current.opacity = 1; }
  }
  function makeStars() {
    if (stars) { world.remove(stars); stars.geometry.dispose(); stars.material.dispose(); }
    const random = seededRandom(21941), count = quality.starCount;
    const positions = new Float32Array(count * 3), sizes = new Float32Array(count), phases = new Float32Array(count), colors = new Float32Array(count * 3);
    const aspect = innerWidth / Math.max(1, innerHeight);
    for (let i = 0; i < count; i++) {
      const layer = i % 10;
      const z = layer < 2 ? 1 + random() * 3 : layer < 5 ? -2 - random() * 18 : -22 - random() * 53;
      const halfHeight = Math.tan(THREE.MathUtils.degToRad(24)) * (9 - z) * 1.35;
      positions.set([(random() * 2 - 1) * halfHeight * aspect, (random() * 2 - 1) * halfHeight, z], i * 3);
      sizes[i] = 0.75 + random() * 1.1; phases[i] = random() * Math.PI * 2;
      colors.set(random() > 0.8 ? [1, 0.79, 0.48] : [0.66 + random() * 0.24, 0.8 + random() * 0.15, 1], i * 3);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));
    geometry.setAttribute("phase", new THREE.BufferAttribute(phases, 1));
    geometry.setAttribute("starColor", new THREE.BufferAttribute(colors, 3));
    const material = new THREE.ShaderMaterial({
      uniforms: { time: { value: elapsed }, pixelRatio: { value: renderer.getPixelRatio() } },
      vertexShader: `attribute float size; attribute float phase; attribute vec3 starColor;
        uniform float pixelRatio; uniform float time; varying vec3 vColor; varying float vLight;
        void main(){vec4 view=modelViewMatrix*vec4(position,1.0); gl_Position=projectionMatrix*view;
          gl_PointSize=clamp(size*(15.0/-view.z),0.8,3.5)*pixelRatio;
          vColor=starColor; vLight=0.75+0.08*sin(time*0.65+phase);}`,
      fragmentShader: `varying vec3 vColor; varying float vLight;
        void main(){float d=length(gl_PointCoord-0.5)*2.0; float a=(1.0-smoothstep(0.12,1.0,d))*vLight;
          gl_FragColor=vec4(vColor,a);
          #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false, toneMapped: false,
    });
    stars = new THREE.Points(geometry, material); stars.renderOrder = -5; stars.frustumCulled = false; world.add(stars);
  }
  function place(item: Actor | null) {
    if (!item) return;
    item.visual.group.position.set(baseX + item.x, baseY + scroll * 0.3, item.z);
    item.visual.group.scale.setScalar(baseScale * item.scale);
    item.visual.setOpacity(item.opacity); item.visual.update(elapsed, motion);
  }
  function paint(dt: number) {
    if (!ready || disposed || lost || !visible) return;
    if (motion) {
      elapsed += dt / 1000;
      const damping = dampingFactor(dt, 5);
      scroll += (targetScroll - scroll) * damping;
      pointerX += (targetX - pointerX) * damping; pointerY += (targetY - pointerY) * damping;
      if (flight && current && incoming) {
        flight.elapsed += dt;
        const progress = Math.min(1, flight.elapsed / 1250), pose = travelPose(progress, flight.direction);
        current.x = flight.x + pose.outgoingX; current.z = flight.z + pose.outgoingZ;
        current.scale = flight.scale * pose.outgoingScale; current.opacity = flight.opacity * pose.outgoingOpacity;
        incoming.x = pose.incomingX; incoming.z = pose.incomingZ;
        incoming.scale = pose.incomingScale; incoming.opacity = pose.incomingOpacity;
        if (progress >= 1) settle();
      }
      const arc = flight ? travelPose(flight.elapsed / 1250, flight.direction) : null;
      camera.position.x += (scroll * 0.3 + pointerX * 0.13 + (arc?.cameraX || 0) - camera.position.x) * damping;
      camera.position.y += (-scroll * 0.4 - pointerY * 0.1 + (arc?.cameraY || 0) - camera.position.y) * damping;
      camera.position.z += (9 - scroll * 2.25 + (arc?.cameraZ || 0) - camera.position.z) * damping;
      if (stars) stars.material.uniforms.time.value = elapsed;
    }
    place(current); place(incoming); renderer.render(world, camera);
    renderer.domElement.dataset.frames = String(++frames);
    renderer.domElement.dataset.scrollProgress = scroll.toFixed(4);
    renderer.domElement.dataset.travel = flight ? "true" : "false";
  }
  function tick(time: number) {
    frame = 0;
    if (disposed || lost || !visible || !motion || !ready) return;
    const interval = 1000 / quality.maxFps;
    const budget = advanceFrameBudget(frameBudget, lastTick ? time - lastTick : interval, quality.maxFps);
    frameBudget = budget.remainderMs;
    lastTick = time;
    if (budget.render) {
      const delta = lastPaint ? time - lastPaint : interval;
      lastPaint = time;
      paint(Math.min(delta, 64));
    }
    frame = requestAnimationFrame(tick);
  }
  function wake() { if (ready && motion && visible && !lost && !disposed && !frame) frame = requestAnimationFrame(tick); }
  function stop() { cancelAnimationFrame(frame); frame = 0; lastTick = 0; lastPaint = 0; frameBudget = 0; }
  function resize() {
    if (disposed || lost) return;
    quality = profile();
    const width = Math.max(1, innerWidth), height = Math.max(1, innerHeight);
    renderer.setPixelRatio(Math.min(quality.pixelRatio, Math.sqrt(2_600_000 / (width * height))));
    renderer.setSize(width, height);
    camera.aspect = width / height; camera.updateProjectionMatrix();
    const halfWidth = Math.tan(THREE.MathUtils.degToRad(24)) * 9 * camera.aspect;
    baseX = halfWidth * (width <= 768 ? 0.9 : 0.79); baseY = width <= 768 ? -0.55 : -0.85;
    baseScale = width <= 768 ? 3.35 : Math.min(5.5, Math.max(4.1, halfWidth * 0.7));
    if (ready) { makeStars(); paint(0); wake(); }
  }
  function contextLost(event: Event) { event.preventDefault(); lost = true; stop(); onStatus(false); }
  function contextRestored() { if (disposed) return; lost = false; resize(); paint(0); onStatus(ready); wake(); }
  function dispose() {
    if (disposed) return;
    disposed = true; stop(); signal.removeEventListener("abort", dispose);
    renderer.domElement.removeEventListener("webglcontextlost", contextLost);
    renderer.domElement.removeEventListener("webglcontextrestored", contextRestored);
    removeActor(current); removeActor(incoming);
    stars?.geometry.dispose(); stars?.material.dispose(); atlas?.dispose();
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  }
  signal.addEventListener("abort", dispose, { once: true });
  renderer.domElement.addEventListener("webglcontextlost", contextLost);
  renderer.domElement.addEventListener("webglcontextrestored", contextRestored);
  resize();
  try {
    const loaded = await new THREE.TextureLoader().loadAsync("/images/universe/planets.png");
    if (disposed || signal.aborted) { loaded.dispose(); return null; }
    atlas = loaded; atlas.colorSpace = THREE.SRGBColorSpace; atlas.generateMipmaps = false;
    atlas.minFilter = THREE.LinearFilter; atlas.magFilter = THREE.LinearFilter;
    current = actor(destination); ready = true; makeStars(); paint(0); onStatus(!lost); wake();
  } catch (error) { dispose(); throw error; }
  return {
    setDestination(next) {
      if (disposed || next.key === destination.key) return;
      destination = next;
      if (!motion || !visible || lost) { settle(); removeActor(current); current = actor(next); paint(0); return; }
      // Interrupt from the visible position, retaining at most two worlds.
      if (incoming) {
        if (incoming.opacity >= (current?.opacity || 0)) { removeActor(current); current = incoming; }
        else removeActor(incoming);
        incoming = null;
      }
      if (!current) { current = actor(next); paint(0); return; }
      incoming = actor(next);
      flight = { elapsed: 0, direction: next.index >= current.destination.index ? 1 : -1, x: current.x, z: current.z, scale: current.scale, opacity: current.opacity };
      const pose = travelPose(0, flight.direction);
      incoming.x = pose.incomingX; incoming.z = pose.incomingZ; incoming.scale = pose.incomingScale; incoming.opacity = 0;
      place(incoming); wake();
    },
    setScroll(progress) { targetScroll = Number.isFinite(progress) ? THREE.MathUtils.clamp(progress, 0, 1) : 0; },
    setPointer(x, y) { targetX = x; targetY = y; },
    setMotion(enabled) { motion = enabled; if (!enabled) { stop(); settle(); paint(0); } else wake(); },
    setVisible(next) { visible = next; if (next) { paint(0); wake(); } else stop(); },
    resize, dispose,
  };
}
