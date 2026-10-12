/** Shared scene coordinates. Keep planet indices aligned with the existing atlas. */
export type UniverseDestination = { key: string; name: string; index: number; color: string };

const DESTINATIONS: Record<string, UniverseDestination> = {
  dashboard: { key: "dashboard", name: "Neptuno", index: 0, color: "#507cff" },
  oraculo: { key: "oraculo", name: "Urano", index: 1, color: "#85e4e0" },
  ruleta: { key: "ruleta", name: "Saturno", index: 2, color: "#eac17a" },
  sorteo: { key: "sorteo", name: "Júpiter", index: 3, color: "#e5b297" },
  "precios-ofertas": { key: "precios-ofertas", name: "Venus", index: 4, color: "#e6c48a" },
  tarotistas: { key: "tarotistas", name: "La Luna", index: 5, color: "#d9d9f0" },
  perfil: { key: "perfil", name: "Marte", index: 6, color: "#dc9b84" },
  resenas: { key: "resenas", name: "La Tierra", index: 7, color: "#77bedf" },
  notificaciones: { key: "notificaciones", name: "Mercurio", index: 8, color: "#b4b5ca" },
  ritual: { key: "ritual", name: "Plutón", index: 9, color: "#ceacdf" },
  rangos: { key: "rangos", name: "El Sol", index: 10, color: "#f2cc70" },
};
const NEBULA: UniverseDestination = { key: "nebula", name: "Nebulosa celestial", index: 11, color: "#bf9de7" };

function routeTab(pathname: string): string | null {
  if (typeof pathname !== "string") return null;
  const segments = pathname.split(/[?#]/, 1)[0].split("/").filter(Boolean);
  return segments[0] === "cliente" ? segments[1] ?? null : null;
}

function hasDestination(key: string): boolean {
  return Object.prototype.hasOwnProperty.call(DESTINATIONS, key);
}

export function universeDestination(pathname: string): UniverseDestination {
  const tab = routeTab(pathname);
  return tab && hasDestination(tab) ? DESTINATIONS[tab] : NEBULA;
}

/** Authentication, standalone chat, and redirect-only pages must not start WebGL. */
export function isUniverseRoute(pathname: string): boolean {
  const tab = routeTab(pathname);
  return tab !== null && (hasDestination(tab) || tab === "campanas");
}

const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const unit = (value: number): number => clamp(finite(value), 0, 1);
const smoothstep = (value: number): number => { const t = unit(value); return t * t * (3 - 2 * t); };

/** Reversible scroll coordinates; no event accumulation or wheel interception. */
export function scrollProgress(scrollTop: number, scrollHeight: number, viewportHeight: number): number {
  const viewport = Math.max(0, finite(viewportHeight));
  const distance = Math.max(0, finite(scrollHeight) - viewport);
  return viewport > 0 && distance > 0 ? unit(finite(scrollTop) / distance) : 0;
}

/** Apply with value += (target - value) * dampingFactor(deltaMs). */
export function dampingFactor(dtMs: number, speed = 6): number {
  const seconds = Math.max(0, finite(dtMs)) / 1000;
  return 1 - Math.exp(-Math.max(0, finite(speed, 6)) * seconds);
}

/** Keep fractional frame time on high-refresh displays, without catch-up bursts. */
export function advanceFrameBudget(budgetMs: number, deltaMs: number, maxFps: number): { render: boolean; remainderMs: number } {
  const fps = Number.isFinite(maxFps) && maxFps > 0 ? clamp(maxFps, 1, 240) : 60;
  const interval = 1000 / fps;
  const epsilon = interval * 1e-8;
  const elapsed = Math.min(Number.MAX_VALUE, Math.max(0, finite(budgetMs)) + Math.max(0, finite(deltaMs)));
  if (elapsed + epsilon < interval) return { render: false, remainderMs: elapsed };
  let remainderMs = elapsed % interval;
  // Floating point additions can land just below an exact interval boundary.
  if (remainderMs < epsilon || interval - remainderMs < epsilon) remainderMs = 0;
  return { render: true, remainderMs };
}

export function pointerTarget(clientX: number, clientY: number, width: number, height: number): { x: number; y: number } {
  const axis = (position: number, dimension: number) => Number.isFinite(position) && Number.isFinite(dimension) && dimension > 0
    ? clamp(position / dimension * 2 - 1, -1, 1) : 0;
  return { x: axis(clientX, width), y: axis(clientY, height) };
}

export type UniverseQualityInput = {
  width: number;
  dpr: number;
  deviceMemory?: number;
  hardwareConcurrency?: number;
  saveData?: boolean;
  reducedMotion?: boolean;
};
export type UniverseQualityProfile = { pixelRatio: number; starCount: number; maxFps: number };

/** Conservative defaults when a browser does not expose hardware hints. */
export function qualityProfile(input: UniverseQualityInput): UniverseQualityProfile {
  const width = input.width > 0 ? finite(input.width, 768) : 768;
  const dpr = input.dpr > 0 ? finite(input.dpr, 1) : 1;
  const memory = finite(input.deviceMemory ?? 0);
  const cores = finite(input.hardwareConcurrency ?? 0);
  const constrained = input.saveData || (memory > 0 && memory < 4) || (cores > 0 && cores <= 2);
  if (input.reducedMotion) return { pixelRatio: Math.min(dpr, 1), starCount: 180, maxFps: 15 };
  if (constrained) return { pixelRatio: Math.min(dpr, 1), starCount: 350, maxFps: 30 };
  if (width <= 768) return { pixelRatio: Math.min(dpr, 1.25), starCount: 620, maxFps: 30 };
  const powerful = width >= 1600 && memory >= 8 && cores >= 8;
  return { pixelRatio: Math.min(dpr, powerful ? 2 : 1.5), starCount: powerful ? 1800 : 1400, maxFps: 60 };
}

export type UniverseTravelPose = {
  outgoingX: number; outgoingZ: number; outgoingScale: number; outgoingOpacity: number;
  incomingX: number; incomingZ: number; incomingScale: number; incomingOpacity: number;
  cameraX: number; cameraY: number; cameraZ: number;
};

/** Two overlapping worlds follow a gentle 1.25-second flight, measured by the caller. */
export function travelPose(progress: number, direction = 1): UniverseTravelPose {
  const t = unit(progress);
  const eased = smoothstep(t);
  const sign = Number.isFinite(direction) && direction < 0 ? -1 : 1;
  // Fade ranges overlap: there is always at least one world at >= 50% opacity.
  const incomingOpacity = smoothstep(t / 0.75);
  const outgoingOpacity = 1 - smoothstep((t - 0.25) / 0.75);
  // A zero-slope arc settles exactly at both ends, without a camera reset jump.
  const arc = 16 * t * t * (1 - t) * (1 - t);
  return {
    outgoingX: -7 * sign * eased,
    outgoingZ: -6 * eased,
    outgoingScale: 1 - 0.4 * eased,
    outgoingOpacity,
    incomingX: 7 * sign * (1 - eased),
    incomingZ: -10 * (1 - eased),
    incomingScale: 0.6 + 0.4 * eased,
    incomingOpacity,
    cameraX: sign * 0.35 * arc,
    cameraY: 0.1 * arc,
    cameraZ: -0.4 * arc,
  };
}

/** Deterministic stars avoid layout jumps after resize or WebGL restoration. */
export function seededRandom(seed: number): () => number {
  let state = finite(seed) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), state | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}
