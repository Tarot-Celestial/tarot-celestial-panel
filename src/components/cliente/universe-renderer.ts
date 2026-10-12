import * as THREE from "three";
import { createPlanetSurface, type PlanetSurface } from "./planet-surface";
import { approachPose, planetTextureSources, shouldLoadPlanetDetail } from "./planet-detail";
import { loadPlanetDetail, loadPlanetTexture, type PlanetDetailTextures, type PlanetTexture } from "./planet-textures";
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
type Actor = {
  visual: PlanetSurface; destination: UniverseDestination; x: number; z: number; scale: number; opacity: number;
  preview: PlanetTexture | null; detail: PlanetDetailTextures | null; clouds: PlanetTexture | null; request: AbortController;
  detailRequest: AbortController | null; detailFailed: boolean; removed: boolean;
};
type Flight = { elapsed: number; direction: number; x: number; z: number; scale: number; opacity: number };
type Options = { host: HTMLDivElement; destination: UniverseDestination; motion: boolean; signal: AbortSignal; onStatus: (ready: boolean) => void };

/** Loaded on demand in the browser. One renderer survives client tab navigation. */
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
  let current: Actor | null = null, incoming: Actor | null = null, flight: Flight | null = null;
  let proximity = 0;
  let destination = options.destination;
  let stars: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;

  function removeActor(item: Actor | null) {
    if (!item) return;
    item.removed = true; item.request.abort(); item.detailRequest?.abort();
    world.remove(item.visual.group); item.visual.dispose();
    item.preview?.dispose(); item.detail?.dispose(); item.clouds?.dispose();
  }
  function downgrade(item: Actor | null) {
    if (!item) return;
    item.detailRequest?.abort(); item.detailRequest = null;
    item.visual.setMap(item.preview?.texture || null);
    item.visual.setDetailMaps(null, null);
    item.detail?.dispose(); item.detail = null;
  }
  function actor(next: UniverseDestination): Actor {
    const visual = createPlanetSurface(next, quality.maxFps <= 30, null);
    world.add(visual.group);
    const item: Actor = { visual, destination: next, x: 0, z: 0, scale: 1, opacity: 1, preview: null, detail: null, clouds: null, request: new AbortController(), detailRequest: null, detailFailed: false, removed: false };
    const path = planetTextureSources(next.index).preview;
    if (path) void loadPlanetTexture(path, item.request.signal, renderer.capabilities.getMaxAnisotropy()).then(texture => {
      if (disposed || item.removed) { texture.dispose(); return; }
      item.preview = texture;
      if (!item.detail || item.detail.textures.length === 2) visual.setMap(texture.texture);
      paint(0);
    }).catch(() => { /* The lit procedural surface remains available offline. */ });
    if (next.index === 7 || next.index === 4) {
      const cloudPath = `/images/universe/surfaces/${next.index === 7 ? "earth" : "venus"}-clouds-2k.jpg`;
      void loadPlanetTexture(cloudPath, item.request.signal, renderer.capabilities.getMaxAnisotropy()).then(texture => {
        if (disposed || item.removed) { texture.dispose(); return; }
        item.clouds = texture; visual.setCloudMap(texture.texture); paint(0);
      }).catch(() => { /* The procedural cloud layer remains visible. */ });
    }
    return item;
  }
  function canLoadDetail(item: Actor) {
    return shouldLoadPlanetDetail({ index: item.destination.index, proximity, viewportWidth: innerWidth, deviceMemory: nav.deviceMemory, saveData: nav.connection?.saveData, maxTextureSize: renderer.capabilities.maxTextureSize, traveling: Boolean(flight) });
  }
  function upgradeActivePlanet() {
    const item = current;
    if (!item || item.removed || item.detail || item.detailRequest || item.detailFailed || lost || !visible) return;
    if (!canLoadDetail(item)) return;
    const source = planetTextureSources(item.destination.index);
    if (!source.detail) return;
    const request = new AbortController(); item.detailRequest = request;
    const paths = source.detailSecondary ? [source.detail, source.detailSecondary] : [source.detail];
    void loadPlanetDetail(paths, request.signal, renderer.capabilities.getMaxAnisotropy()).then(texture => {
      if (disposed || item.removed || current !== item || flight || item.detailRequest !== request || !canLoadDetail(item)) {
        texture.dispose(); if (item.detailRequest === request) item.detailRequest = null; return;
      }
      item.detailRequest = null; item.detail = texture;
      if (texture.textures.length === 2) item.visual.setDetailMaps(texture.textures[0], texture.textures[1]);
      else item.visual.setMap(texture.textures[0]);
      paint(0);
    }).catch(() => { if (item.detailRequest === request) { item.detailRequest = null; item.detailFailed = !request.signal.aborted; } });
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
      // Every star stays behind the complete planet, including its distant limb.
      const z = layer < 2 ? -16 - random() * 9 : layer < 5 ? -32 - random() * 18 : -55 - random() * 35;
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
          gl_PointSize=clamp(size*(42.0/-view.z),0.8,3.5)*pixelRatio;
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
    item.visual.group.position.set(baseX + item.x, baseY, item.z);
    item.visual.group.scale.setScalar(baseScale * item.scale);
    item.visual.setOpacity(item.opacity); item.visual.update(elapsed, motion, flight ? 0 : proximity);
  }
  function keepCameraOutside(item: Actor | null) {
    if (!item || item.opacity < 0.05) return;
    const centerX = baseX + item.x, centerZ = item.z;
    const dx = camera.position.x - centerX, dy = camera.position.y - baseY, dz = camera.position.z - centerZ;
    const distance = Math.hypot(dx, dy, dz), minimum = baseScale * item.scale * 1.045;
    if (distance < minimum) {
      const factor = minimum / Math.max(distance, 0.0001);
      camera.position.set(centerX + dx * factor, baseY + dy * factor, centerZ + (distance > 0.0001 ? dz * factor : minimum));
    }
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
      const approach = approachPose(flight ? Math.min(scroll, 0.12) : scroll, baseX, baseY, baseScale, innerWidth <= 768);
      proximity = approach.proximity;
      const parallax = 1 - proximity * 0.85;
      camera.position.x += (approach.x + pointerX * 0.13 * parallax + (arc?.cameraX || 0) - camera.position.x) * damping;
      camera.position.y += (approach.y - pointerY * 0.1 * parallax + (arc?.cameraY || 0) - camera.position.y) * damping;
      camera.position.z += (approach.z + (arc?.cameraZ || 0) - camera.position.z) * damping;
      if (stars) stars.material.uniforms.time.value = elapsed;
    }
    keepCameraOutside(current); keepCameraOutside(incoming);
    place(current); place(incoming); renderer.render(world, camera);
    upgradeActivePlanet();
    renderer.domElement.dataset.frames = String(++frames);
    renderer.domElement.dataset.scrollProgress = scroll.toFixed(4);
    renderer.domElement.dataset.travel = flight ? "true" : "false";
    renderer.domElement.dataset.proximity = proximity.toFixed(4);
    renderer.domElement.dataset.textureWidth = String(current?.detail?.width || current?.preview?.width || 0);
    renderer.domElement.dataset.highResolutionTextures = current?.detail || incoming?.detail ? "1" : "0";
    renderer.domElement.dataset.cameraDistance = Math.hypot(camera.position.x - baseX, camera.position.y - baseY, camera.position.z).toFixed(4);
    renderer.domElement.dataset.planetRadius = baseScale.toFixed(4);
    host.parentElement?.style.setProperty("--approach", proximity.toFixed(3));
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
    const pose = approachPose(flight ? Math.min(scroll, 0.12) : scroll, baseX, baseY, baseScale, width <= 768);
    camera.position.set(pose.x, pose.y, pose.z); proximity = pose.proximity;
    if (current && (current.detail || current.detailRequest) && !canLoadDetail(current)) downgrade(current);
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
    stars?.geometry.dispose(); stars?.material.dispose();
    renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
  }
  signal.addEventListener("abort", dispose, { once: true });
  renderer.domElement.addEventListener("webglcontextlost", contextLost);
  renderer.domElement.addEventListener("webglcontextrestored", contextRestored);
  resize();
  try { current = actor(destination); ready = true; makeStars(); paint(0); onStatus(!lost); wake(); }
  catch (error) { dispose(); throw error; }
  return {
    setDestination(next) {
      if (disposed || next.key === destination.key) return;
      destination = next;
      downgrade(current); downgrade(incoming);
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
