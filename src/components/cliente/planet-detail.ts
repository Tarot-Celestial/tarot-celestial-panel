export type PlanetTextureSources = {
  slug: string;
  preview: string | null;
  detail: string | null;
  detailSecondary: string | null;
  detailWidth: number;
};

const SURFACES = "/images/universe/surfaces";
const PLANETS = [
  { slug: "neptune", detailWidth: 0 },
  { slug: "uranus", detailWidth: 0 },
  { slug: "saturn", detailWidth: 4096 },
  { slug: "jupiter", detailWidth: 4096 },
  { slug: "venus", detailWidth: 8192 },
  { slug: "moon", detailWidth: 8192 },
  { slug: "mars", detailWidth: 8192 },
  { slug: "earth", detailWidth: 8192 },
  { slug: "mercury", detailWidth: 8192 },
  { slug: "pluto", detailWidth: 8192 },
  { slug: "sun", detailWidth: 4096 },
] as const;

/** Surface maps follow the established panel destinations, not the atlas grid. */
export function planetTextureSources(index: number): PlanetTextureSources {
  const planet = Number.isInteger(index) ? PLANETS[index] : undefined;
  if (!planet) return { slug: "nebula", preview: null, detail: null, detailSecondary: null, detailWidth: 0 };
  return {
    slug: planet.slug,
    preview: `${SURFACES}/${planet.slug}-2k.jpg`,
    detail: planet.slug === "pluto" ? `${SURFACES}/pluto-detail-west-4k.jpg`
      : planet.detailWidth ? `${SURFACES}/${planet.slug}-${planet.detailWidth === 4096 ? "4k" : "8k"}.jpg` : null,
    detailSecondary: planet.slug === "pluto" ? `${SURFACES}/pluto-detail-east-4k.jpg` : null,
    detailWidth: planet.detailWidth,
  };
}

export type PlanetDetailInput = {
  index: number;
  proximity: number;
  viewportWidth: number;
  deviceMemory?: number;
  saveData?: boolean;
  maxTextureSize: number;
  motion?: boolean;
  traveling?: boolean;
};

/** Only the active, settled planet may request its large map; previews stay on mobile. */
export function shouldLoadPlanetDetail(input: PlanetDetailInput): boolean {
  const source = planetTextureSources(input.index);
  return source.detail !== null
    && Number.isFinite(input.proximity) && input.proximity > 0.22
    && Number.isFinite(input.viewportWidth) && input.viewportWidth >= 1024
    && Number.isFinite(input.deviceMemory) && (input.deviceMemory ?? 0) >= (source.detailWidth <= 4096 ? 4 : 8)
    && Number.isFinite(input.maxTextureSize) && input.maxTextureSize >= source.detailWidth
    && input.saveData !== true && input.traveling !== true;
}

export type PlanetApproachPose = { x: number; y: number; z: number; proximity: number };
const finite = (value: number, fallback = 0): number => Number.isFinite(value) ? value : fallback;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value));
const smoothstep = (value: number): number => { const t = clamp(value, 0, 1); return t * t * (3 - 2 * t); };

/**
 * Reversible orbit-to-surface camera path. The final view sits above the front
 * hemisphere rather than zooming a flat image. Call with the planet's world
 * center and scaled radius; x/y are world camera coordinates, looking down -Z.
 */
export function approachPose(progress: number, baseX: number, baseY: number, radius: number, mobile = false): PlanetApproachPose {
  const p = clamp(finite(progress), 0, 1);
  const r = clamp(finite(radius, 4.4) > 0 ? finite(radius, 4.4) : 4.4, 0.1, 1000);
  const centerX = clamp(finite(baseX), -10000, 10000), centerY = clamp(finite(baseY), -10000, 10000);
  const orbitZ = Math.max(9, r * 1.4);
  const orbitZoom = Math.min(0.4, r * 0.1);
  const proximity = smoothstep((p - 0.15) / 0.85);
  const entryZ = orbitZ - orbitZoom;
  let x = (centerX - r * 0.15) * proximity;
  let y = (centerY + r * 0.22) * proximity;
  let z = p <= 0.15
    ? orbitZ - orbitZoom * smoothstep(p / 0.15)
    : entryZ + (r * (mobile ? 1.16 : 1.09) - entryZ) * proximity;

  // A resize can place the center beyond its usual coordinates. Project any
  // intersecting path outward, preserving a near-plane clearance above terrain.
  const dx = x - centerX, dy = y - centerY;
  const distance = Math.hypot(dx, dy, z), clearance = r * 1.105;
  if (distance < clearance) {
    const correction = clearance / Math.max(distance, Number.EPSILON);
    x = centerX + dx * correction;
    y = centerY + dy * correction;
    z *= correction;
  }
  return { x, y, z, proximity };
}
