import * as THREE from "three";

export type PlanetDestination = { index: number; name: string; color: string };

export type PlanetVisual = {
  group: THREE.Group;
  update: (seconds: number, motion: boolean) => void;
  setOpacity: (opacity: number) => void;
  dispose: () => void;
};

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const surfaceShader = /* glsl */ `
  uniform sampler2D atlas;
  uniform vec4 cell;
  uniform float opacity;
  uniform float time;
  uniform float flow;
  varying vec2 vUv;

  void main() {
    vec2 localUv = vUv;
    vec2 p = localUv * 2.0 - 1.0;
    // A small drift inside the disc gives clouds life without moving its edge,
    // stretching the atlas over a sphere, or bending Saturn's existing rings.
    float interior = 1.0 - smoothstep(0.45, 0.90, length(p));
    localUv.x += sin(time * 0.055 + p.y * 4.0) * 0.0035 * interior * flow;
    localUv.y += sin(time * 0.035 + p.x * 3.0) * 0.0009 * interior * flow;
    vec2 atlasUv = mix(cell.xy, cell.zw, clamp(localUv, 0.0, 1.0));
    vec4 artwork = texture2D(atlas, atlasUv);
    if (artwork.a < 0.003) discard;
    gl_FragColor = vec4(artwork.rgb, artwork.a * opacity);
    #include <colorspace_fragment>
  }
`;

const atmosphereShader = /* glsl */ `
  uniform vec3 glowColor;
  uniform float radius;
  uniform float strength;
  uniform float opacity;
  uniform float time;
  varying vec2 vUv;

  void main() {
    vec2 p = (vUv - 0.5) * 2.7;
    float r = length(p);
    float rim = exp(-pow((r - radius) / 0.055, 2.0));
    float haze = exp(-pow((r - radius) / 0.175, 2.0));
    float exterior = smoothstep(radius - 0.05, radius + 0.02, r);
    // The artwork is lit from its upper left; the atmosphere follows that light.
    float daylight = 0.48 + 0.52 * clamp(dot(normalize(p + vec2(0.0001)), normalize(vec2(-0.8, 0.6))) * 0.5 + 0.5, 0.0, 1.0);
    float breathing = 0.96 + 0.04 * sin(time * 0.18);
    float alpha = (rim * 0.36 + haze * 0.13) * exterior * daylight * strength * breathing * opacity;
    gl_FragColor = vec4(glowColor, alpha);
    #include <colorspace_fragment>
  }
`;

/**
 * A two-unit planet in real scene space, retaining the original photographic art.
 * The caller owns the shared atlas and the group's placement; this helper owns
 * only the geometry/materials below it and never disposes or mutates the atlas.
 */
export function createPlanetVisual(
  atlas: THREE.Texture,
  destination: PlanetDestination,
  lowPower: boolean,
): PlanetVisual {
  const index = Number.isFinite(destination.index)
    ? THREE.MathUtils.clamp(Math.trunc(destination.index), 0, 11)
    : 0;
  const column = index % 4;
  const row = Math.floor(index / 4);
  const image = atlas.image as { width?: number; height?: number } | undefined;
  const halfPixelX = 0.5 / Math.max(4, image?.width || 4096);
  const halfPixelY = 0.5 / Math.max(3, image?.height || 3072);
  const bottom = 1 - (row + 1) / 3;
  const cell = new THREE.Vector4(
    column / 4 + halfPixelX,
    bottom + halfPixelY,
    (column + 1) / 4 - halfPixelX,
    bottom + 1 / 3 - halfPixelY,
  );
  const group = new THREE.Group();
  group.name = `celestial-planet-${destination.name}`;
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  let disposed = false;

  const surfaceGeometry = new THREE.PlaneGeometry(2, 2);
  const surfaceMaterial = new THREE.ShaderMaterial({
    uniforms: {
      atlas: { value: atlas },
      cell: { value: cell },
      opacity: { value: 1 },
      time: { value: 0 },
      flow: { value: !lowPower && [0, 1, 3, 4, 7, 10, 11].includes(index) ? 1 : 0 },
    },
    vertexShader,
    fragmentShader: surfaceShader,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const surface = new THREE.Mesh(surfaceGeometry, surfaceMaterial);
  surface.name = "original-planet-artwork";
  group.add(surface);
  geometries.push(surfaceGeometry);
  materials.push(surfaceMaterial);

  const atmosphereGeometry = new THREE.PlaneGeometry(2.7, 2.7);
  const atmosphereMaterial = new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(destination.color) },
      radius: { value: index === 2 ? 0.59 : index === 10 ? 0.96 : 0.9 },
      strength: { value: [5, 6, 8, 9].includes(index) ? 0.24 : index === 10 ? 0.85 : 0.6 },
      opacity: { value: 1 },
      time: { value: 0 },
    },
    vertexShader,
    fragmentShader: atmosphereShader,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
  atmosphere.name = "atmospheric-rim";
  atmosphere.position.z = -0.015;
  group.add(atmosphere);
  geometries.push(atmosphereGeometry);
  materials.push(atmosphereMaterial);

  let orbit: THREE.Line | undefined;
  let orbitMaterial: THREE.LineBasicMaterial | undefined;
  let satellite: THREE.Points | undefined;
  let satelliteMaterial: THREE.PointsMaterial | undefined;

  // Saturn already carries detailed rings. Avoid adding an unrelated second set.
  if (index !== 2) {
    const points: THREE.Vector3[] = [];
    const segments = lowPower ? 48 : 96;
    for (let i = 0; i <= segments; i += 1) {
      const angle = 0.24 + (i / segments) * Math.PI * 1.6;
      points.push(new THREE.Vector3(Math.cos(angle) * 1.15, Math.sin(angle) * 0.89, 0));
    }
    const orbitGeometry = new THREE.BufferGeometry().setFromPoints(points);
    orbitMaterial = new THREE.LineBasicMaterial({
      color: "#d9bf89",
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      toneMapped: false,
    });
    orbit = new THREE.Line(orbitGeometry, orbitMaterial);
    orbit.name = "celestial-orbit";
    orbit.rotation.z = -0.38;
    orbit.position.z = -0.025;
    group.add(orbit);
    geometries.push(orbitGeometry);
    materials.push(orbitMaterial);

    if (!lowPower) {
      const satelliteGeometry = new THREE.BufferGeometry();
      satelliteGeometry.setAttribute("position", new THREE.Float32BufferAttribute([1.1, 0.25, 0], 3));
      satelliteMaterial = new THREE.PointsMaterial({
        color: "#f0d9a4",
        size: 0.014,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.48,
        depthWrite: false,
        toneMapped: false,
      });
      satellite = new THREE.Points(satelliteGeometry, satelliteMaterial);
      satellite.name = "orbital-guide-light";
      satellite.frustumCulled = false;
      orbit.add(satellite);
      geometries.push(satelliteGeometry);
      materials.push(satelliteMaterial);
    }
  }

  return {
    group,
    update(seconds, motion) {
      if (disposed || !motion || !Number.isFinite(seconds)) return;
      surfaceMaterial.uniforms.time.value = seconds;
      atmosphereMaterial.uniforms.time.value = seconds;
      // Rocking stays below half a degree: preserve the familiar face of the art.
      surface.rotation.z = Math.sin(seconds * 0.025 + index * 0.7) * 0.007;
      if (orbit) orbit.rotation.z = -0.38 + Math.sin(seconds * 0.018) * 0.045;
      if (satellite) {
        const angle = 0.24 + (0.5 - 0.5 * Math.cos(seconds * 0.016)) * Math.PI * 1.6;
        const position = satellite.geometry.getAttribute("position") as THREE.BufferAttribute;
        position.setXYZ(0, Math.cos(angle) * 1.15, Math.sin(angle) * 0.89, 0);
        position.needsUpdate = true;
      }
    },
    setOpacity(opacity) {
      if (disposed) return;
      const value = Number.isFinite(opacity) ? THREE.MathUtils.clamp(opacity, 0, 1) : 0;
      group.visible = value > 0.001;
      surfaceMaterial.uniforms.opacity.value = value;
      atmosphereMaterial.uniforms.opacity.value = value;
      if (orbitMaterial) orbitMaterial.opacity = value * 0.16;
      if (satelliteMaterial) satelliteMaterial.opacity = value * 0.48;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const geometry of geometries) geometry.dispose();
      for (const material of materials) material.dispose();
      group.clear();
    },
  };
}
