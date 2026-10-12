import * as THREE from "three";

export type PlanetSurfaceDestination = { index: number; name: string; color: string };
export type PlanetSurface = {
  group: THREE.Group;
  update: (seconds: number, motion: boolean, proximity?: number) => void;
  setOpacity: (opacity: number) => void;
  setMap: (map: THREE.Texture | null) => void;
  setCloudMap: (map: THREE.Texture | null) => void;
  setDetailMaps: (west: THREE.Texture | null, east: THREE.Texture | null) => void;
  dispose: () => void;
};

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vLocalPosition;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  void main() {
    vUv = uv;
    vLocalPosition = position;
    vec4 world = modelMatrix * vec4(position, 1.0);
    vWorldPosition = world.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;

// Three-dimensional noise has no longitude seam. Limit the octave count at
// compilation time; the mobile shader does less work for every visible pixel.
const noiseShader = /* glsl */ `
  float hash31(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.yzx + 33.33);
    return fract((p.x + p.y) * p.z);
  }
  float noise3(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash31(i), hash31(i + vec3(1,0,0)), f.x),
          mix(hash31(i + vec3(0,1,0)), hash31(i + vec3(1,1,0)), f.x), f.y),
      mix(mix(hash31(i + vec3(0,0,1)), hash31(i + vec3(1,0,1)), f.x),
          mix(hash31(i + vec3(0,1,1)), hash31(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) {
    float value = 0.0, amplitude = 0.5;
    for (int i = 0; i < DETAIL_OCTAVES; i++) {
      value += noise3(p) * amplitude;
      p = p * 2.03 + vec3(17.1, 9.2, 13.7);
      amplitude *= 0.5;
    }
    return value;
  }
`;

const surfaceShader = /* glsl */ `
  uniform sampler2D planetMap;
  uniform float hasMap;
  uniform sampler2D plutoDetailWest;
  uniform sampler2D plutoDetailEast;
  uniform float hasDetailMaps;
  uniform float opacity;
  uniform float time;
  uniform float proximity;
  uniform float kind;
  uniform float fillUnmappedPolarRegion;
  uniform float iceGiant;
  uniform vec3 baseColor;
  uniform vec3 bandColor;
  varying vec2 vUv;
  varying vec3 vLocalPosition;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  ${noiseShader}

  void main() {
    vec3 p = normalize(vLocalPosition);
    vec3 light = normalize(vec3(-0.72, 0.58, 0.84));
    vec3 eye = normalize(cameraPosition - vWorldPosition);
    vec3 normal = normalize(vWorldNormal);
    float broad = fbm(p * 6.0 + vec3(0.0, time * 0.0015, 0.0));
    // Suppress subpixel grain at orbit distance instead of allowing shimmer.
    float pixelFootprint = max(length(dFdx(p)), length(dFdy(p)));
    float grainVisibility = 1.0 - smoothstep(0.005, 0.026, pixelFootprint);
    float grain = (noise3(p * 175.0) - 0.5) * grainVisibility;
    float bands = 0.5 + 0.5 * sin(p.y * 45.0 + broad * 6.0);
    vec3 color = mix(baseColor, bandColor, kind < 0.5 ? bands * 0.52 : broad * 0.65);
    vec3 mapped = hasMap > 0.5 ? texture2D(planetMap, vUv).rgb : color;
    // New Horizons did not image Pluto's entire southern hemisphere. Black
    // no-data pixels receive a restrained artistic continuation, not an abyss.
    if (hasMap > 0.5 && fillUnmappedPolarRegion > 0.5) {
      float measured = smoothstep(0.001, 0.012, dot(mapped, vec3(0.2126, 0.7152, 0.0722)));
      mapped = mix(color, mapped, measured);
    }
    if (hasDetailMaps > 0.5 && fillUnmappedPolarRegion > 0.5) {
      // Two native 4096-square USGS tiles cover longitudes 0..180 and 180..360.
      // Retain NASA's color and use the observed mosaic for fine luminance.
      // Missing black pixels preserve the lower-resolution color underneath.
      vec2 detailUv = vec2(vUv.x < 0.5 ? vUv.x * 2.0 : (vUv.x - 0.5) * 2.0, vUv.y);
      vec3 detail = vUv.x < 0.5 ? texture2D(plutoDetailWest, detailUv).rgb
        : texture2D(plutoDetailEast, detailUv).rgb;
      float detailLuminance = dot(detail, vec3(0.2126, 0.7152, 0.0722));
      float colorLuminance = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
      float coverage = smoothstep(0.0005, 0.010, detailLuminance);
      float luminance = mix(colorLuminance, detailLuminance, coverage);
      mapped *= luminance / max(colorLuminance, 0.015);
    }
    color = mapped;
    if (iceGiant > 0.0) {
      // Artistic methane cirrus complements the low-contrast ice-giant maps.
      // Anisotropic noise stretches clouds along latitude while the three-
      // dimensional warp prevents straight, repeated stripes and UV seams.
      float latitude = p.y + (broad - 0.46) * 0.075;
      float ribbons = noise3(vec3(p.x * 10.0, latitude * 84.0, p.z * 10.0) + vec3(0.0, broad * 7.0, 0.0));
      float knots = noise3(p * 32.0 + vec3(time * 0.001, 0.0, 0.0));
      float cloudField = ribbons * 0.73 + knots * 0.27;
      float belts = 0.16 + 0.70 * exp(-pow((latitude + 0.22) / 0.17, 2.0))
        + 0.54 * exp(-pow((latitude - 0.38) / 0.12, 2.0));
      float cirrus = smoothstep(0.48, 0.78, cloudField) * min(belts, 1.0);
      color *= 0.96 + (broad - 0.46) * 0.16 * iceGiant;
      if (iceGiant > 0.8) {
        vec3 stormCenter = normalize(vec3(-0.65, -0.20, 0.73));
        vec3 tangent = normalize(vec3(stormCenter.z, 0.0, -stormCenter.x));
        vec2 stormCoords = vec2(dot(p, tangent) / 0.23, (p.y + 0.20) / 0.078);
        float stormDistance = length(stormCoords) + (broad - 0.46) * 0.6;
        float hemisphere = smoothstep(0.10, 0.80, dot(p, stormCenter));
        float storm = exp(-stormDistance * stormDistance * 1.8) * hemisphere;
        color *= 1.0 - storm * 0.40;
        // Thin bright clouds trace one edge of the storm rather than a ring.
        cirrus += exp(-pow((stormDistance - 1.15) / 0.23, 2.0)) * hemisphere
          * smoothstep(-0.10, 0.65, stormCoords.y) * 0.16;
      }
      vec3 cloudTint = mix(vec3(0.38, 0.63, 0.71), vec3(0.40, 0.60, 0.91), iceGiant);
      color = mix(color, cloudTint, clamp(cirrus * iceGiant * 0.24, 0.0, 0.25));
    }
    float fineAmount = mix(0.015, 0.065, proximity);
    if (kind < 0.5) {
      // Cloud belts retain their photographed structure. Fine turbulence becomes
      // visible on approach without deforming the planet's spherical silhouette.
      color *= 0.99 + (broad - 0.46) * 0.05 + grain * fineAmount;
    } else if (kind < 2.5) {
      float elevation = dot(mapped, vec3(0.2126, 0.7152, 0.0722));
      float relief = fillUnmappedPolarRegion > 0.5 ? mix(0.0015, 0.00045, hasDetailMaps) : kind > 1.5 ? 0.002 : 0.010;
      float height = elevation * relief + grain * mix(0.00015, 0.0015, proximity);
      vec3 dx = dFdx(vWorldPosition), dy = dFdy(vWorldPosition);
      vec3 rx = cross(dy, normal), ry = cross(normal, dx);
      float determinant = dot(dx, rx);
      vec3 gradient = sign(determinant) * (dFdx(height) * rx + dFdy(height) * ry);
      normal = normalize(abs(determinant) * normal - gradient);
      color *= 1.0 + grain * fineAmount;
    }

    if (kind > 2.5 && kind < 3.5) {
      // The Sun emits light; a day/night terminator would be physically wrong.
      float limb = 0.70 + 0.30 * pow(max(dot(normal, eye), 0.0), 0.38);
      color *= limb * (1.04 + grain * 0.18 + (broad - 0.46) * 0.055);
    } else if (kind > 3.5) {
      float vapor = smoothstep(0.21, 0.78, broad);
      color = mix(baseColor * 0.2, bandColor, vapor);
      color *= 0.25 + 0.75 * pow(max(dot(normal, eye), 0.0), 0.6);
    } else {
      float daylight = max(dot(normal, light), 0.0);
      // Keep a dark but legible night side; the broad terminator establishes
      // volume even when the camera is only a little above the surface.
      color *= 0.035 + daylight * 1.08;
      if (kind > 1.5) {
        float water = smoothstep(0.01, 0.10, mapped.b - max(mapped.r, mapped.g * 0.78));
        float specular = pow(max(dot(normal, normalize(light + eye)), 0.0), 85.0);
        color += vec3(0.40, 0.53, 0.64) * specular * water * daylight;
      }
    }
    gl_FragColor = vec4(max(color, vec3(0.0)), opacity);
    #include <colorspace_fragment>
  }
`;

const atmosphereShader = /* glsl */ `
  uniform vec3 glowColor;
  uniform float opacity;
  uniform float strength;
  uniform float proximity;
  uniform float solar;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  void main() {
    vec3 normal = normalize(vWorldNormal);
    vec3 eye = normalize(cameraPosition - vWorldPosition);
    float tangentDepth = clamp(-dot(normal, eye), 0.0, 1.0);
    // Zero alpha at the outer geometry silhouette avoids a hard blue outline.
    // The glow rises inward through a thin atmosphere, then the planet itself
    // occludes it; it never becomes an opaque band around the sphere.
    float rim = smoothstep(0.0, solar > 0.5 ? 0.19 : 0.14, tangentDepth)
      * exp(-tangentDepth * tangentDepth * (solar > 0.5 ? 5.0 : 11.0));
    float daylight = solar > 0.5 ? 1.0 : 0.10 + max(dot(normal, normalize(vec3(-0.72, 0.58, 0.84))), 0.0) * 0.90;
    float descent = mix(1.0, 0.15, smoothstep(0.45, 1.0, proximity));
    gl_FragColor = vec4(glowColor, rim * daylight * strength * opacity * descent);
    #include <colorspace_fragment>
  }
`;

const cloudShader = /* glsl */ `
  uniform float opacity;
  uniform float time;
  uniform float proximity;
  uniform float venus;
  uniform vec3 cloudColor;
  uniform sampler2D cloudMap;
  uniform float hasCloudMap;
  varying vec2 vUv;
  varying vec3 vLocalPosition;
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  ${noiseShader}
  void main() {
    float coverage;
    vec3 tint = cloudColor;
    if (hasCloudMap > 0.5) {
      vec3 photographed = texture2D(cloudMap, vUv).rgb;
      float density = dot(photographed, vec3(0.2126, 0.7152, 0.0722));
      coverage = mix(smoothstep(0.018, 0.58, density) * 0.88, 0.91, venus);
      tint = mix(cloudColor, photographed, venus);
    } else {
      vec3 p = normalize(vLocalPosition);
      float turbulence = fbm(p * 5.2 + vec3(time * 0.001, 0.0, 0.0));
      float cloud = fbm(p * 17.0 + vec3(turbulence * 3.0, 0.0, 0.0));
      coverage = smoothstep(0.47, 0.66, cloud + turbulence * 0.11);
      coverage = mix(coverage * 0.48, 0.71 + coverage * 0.22, venus);
    }
    float daylight = max(dot(normalize(vWorldNormal), normalize(vec3(-0.72, 0.58, 0.84))), 0.0);
    float descent = 1.0 - smoothstep(0.60, 0.94, proximity) * 0.92;
    gl_FragColor = vec4(tint * (0.045 + daylight), coverage * opacity * descent);
    #include <colorspace_fragment>
  }
`;

const ringShader = /* glsl */ `
  uniform float opacity;
  varying vec3 vLocalPosition;
  varying vec3 vWorldPosition;
  void main() {
    float radius = length(vLocalPosition.xy);
    float radial = (radius - 1.19) / 0.66;
    float edge = smoothstep(0.0, 0.018, radial) * (1.0 - smoothstep(0.975, 1.0, radial));
    float fineBands = 0.68 + 0.14 * sin(radial * 295.0) + 0.09 * sin(radial * 711.0);
    float cassini = 1.0 - smoothstep(0.60, 0.608, radial) * (1.0 - smoothstep(0.631, 0.64, radial));
    float density = mix(0.20, 0.73, smoothstep(0.0, 0.20, radial)) * fineBands * cassini;
    vec3 color = mix(vec3(0.29, 0.22, 0.14), vec3(0.62, 0.53, 0.36), smoothstep(0.1, 0.5, radial));
    // Sunward particles brighten gently; depth testing provides the actual
    // sphere occlusion for the near and far halves of this tilted 3D ring.
    color *= 0.83 + 0.17 * max(dot(normalize(vLocalPosition.xy), normalize(vec2(-0.72, 0.58))), 0.0);
    gl_FragColor = vec4(color, edge * density * opacity);
    #include <colorspace_fragment>
  }
`;

const PALETTES = [
  ["#234aac", "#5a8dd8"], ["#66babe", "#b9dfe0"], ["#b79c6a", "#e5d6ad"],
  ["#b38058", "#ddd0b3"], ["#c69a5a", "#eed69d"], ["#777b81", "#c8c8c5"],
  ["#944c34", "#c89568"], ["#163f6e", "#477e64"], ["#716c66", "#b4aa98"],
  ["#846b58", "#dbcbbb"], ["#ee790b", "#ffd24b"], ["#352967", "#8d60bd"],
] as const;

/**
 * True unit-radius spheres with equirectangular surfaces. All geometry and
 * materials are owned here; textures and the parent's placement are not.
 * Proximity is camera approach [0,1], not an animation clock or mesh scale.
 */
export function createPlanetSurface(
  destination: PlanetSurfaceDestination,
  lowPower: boolean,
  map: THREE.Texture | null,
): PlanetSurface {
  const index = Number.isFinite(destination.index) ? THREE.MathUtils.clamp(Math.trunc(destination.index), 0, 11) : 0;
  const kind = index === 10 ? 3 : index === 11 ? 4 : index === 7 ? 2 : [5, 6, 8, 9].includes(index) ? 1 : 0;
  const group = new THREE.Group();
  group.name = `celestial-surface-${destination.name}`;
  const rig = new THREE.Group();
  rig.name = "planet-axis";
  rig.rotation.z = index === 2 ? -0.34 : index === 7 ? -0.14 : -0.07;
  rig.rotation.x = index === 2 ? 0.32 : index === 9 ? 0.23 : 0.05;
  group.add(rig);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.ShaderMaterial[] = [];
  let disposed = false;
  let previousSeconds: number | null = null;
  let elapsedSeconds = 0;
  const unit = (value: number): number => Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, 1) : 0;

  const sphereGeometry = new THREE.SphereGeometry(1, lowPower ? 64 : 128, lowPower ? 32 : 64);
  geometries.push(sphereGeometry);
  const surfaceMaterial = new THREE.ShaderMaterial({
    defines: { DETAIL_OCTAVES: lowPower ? 3 : 4 },
    uniforms: {
      planetMap: { value: map }, hasMap: { value: map ? 1 : 0 }, opacity: { value: 1 },
      plutoDetailWest: { value: null }, plutoDetailEast: { value: null }, hasDetailMaps: { value: 0 },
      time: { value: 0 }, proximity: { value: 0 }, kind: { value: kind },
      fillUnmappedPolarRegion: { value: index === 9 ? 1 : 0 },
      iceGiant: { value: index === 0 ? 1 : index === 1 ? 0.35 : 0 },
      baseColor: { value: new THREE.Color(PALETTES[index][0]) },
      bandColor: { value: new THREE.Color(PALETTES[index][1]) },
    },
    vertexShader, fragmentShader: surfaceShader, transparent: false, depthWrite: true,
    toneMapped: false,
  });
  const sphere = new THREE.Mesh(sphereGeometry, surfaceMaterial);
  sphere.name = "planet-spherical-surface";
  // Longitude is a view choice, not a change to the texture. The initial Earth
  // hemisphere includes Asia; Pluto keeps its contrasting ice plains.
  const initialRotation = index === 7 ? 2.35 : index === 9 ? -1.50 : 0.55;
  sphere.rotation.y = initialRotation;
  rig.add(sphere);
  materials.push(surfaceMaterial);

  const solar = index === 10;
  const atmosphereGeometry = new THREE.SphereGeometry(solar ? 1.075 : 1.035, lowPower ? 48 : 96, lowPower ? 24 : 48);
  const atmosphereMaterial = new THREE.ShaderMaterial({
    uniforms: {
      glowColor: { value: new THREE.Color(solar ? "#ff9d36" : index === 7 ? "#65b6ff" : destination.color) },
      opacity: { value: 1 }, strength: { value: kind === 1 ? 0.015 : solar ? 0.70 : 0.34 },
      proximity: { value: 0 }, solar: { value: solar ? 1 : 0 },
    },
    vertexShader, fragmentShader: atmosphereShader,
    side: THREE.BackSide, transparent: true, depthWrite: false, toneMapped: false,
  });
  const atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
  atmosphere.name = solar ? "solar-corona" : "planet-atmosphere";
  atmosphere.renderOrder = 2;
  rig.add(atmosphere);
  geometries.push(atmosphereGeometry);
  materials.push(atmosphereMaterial);

  let clouds: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial> | null = null;
  if (index === 7 || index === 4) {
    const geometry = new THREE.SphereGeometry(1.007, lowPower ? 48 : 96, lowPower ? 24 : 48);
    const material = new THREE.ShaderMaterial({
      defines: { DETAIL_OCTAVES: lowPower ? 3 : 4 },
      uniforms: {
        opacity: { value: 1 }, time: { value: 0 }, proximity: { value: 0 },
        venus: { value: index === 4 ? 1 : 0 },
        cloudColor: { value: new THREE.Color(index === 4 ? "#efcd91" : "#eef5ff") },
        cloudMap: { value: null }, hasCloudMap: { value: 0 },
      },
      vertexShader, fragmentShader: cloudShader,
      transparent: true, depthWrite: false, toneMapped: false,
    });
    clouds = new THREE.Mesh(geometry, material);
    clouds.name = index === 4 ? "venus-cloud-layer" : "earth-cloud-layer";
    clouds.rotation.y = initialRotation;
    clouds.renderOrder = 1;
    rig.add(clouds);
    geometries.push(geometry);
    materials.push(material);
  }

  if (index === 2) {
    const geometry = new THREE.RingGeometry(1.19, 1.85, lowPower ? 128 : 256, 1);
    const material = new THREE.ShaderMaterial({
      uniforms: { opacity: { value: 1 } }, vertexShader, fragmentShader: ringShader,
      side: THREE.DoubleSide, transparent: true, depthWrite: false, toneMapped: false,
    });
    const ring = new THREE.Mesh(geometry, material);
    ring.name = "saturn-particle-rings";
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 1;
    rig.add(ring);
    geometries.push(geometry);
    materials.push(material);
  }

  return {
    group,
    update(seconds, motion, proximity = 0) {
      if (disposed) return;
      for (const material of materials) {
        if (material.uniforms.proximity) material.uniforms.proximity.value = unit(proximity);
      }
      if (!Number.isFinite(seconds)) return;
      // Track only active time so pausing does not jump to a new longitude when
      // the parent resumes its clock. Long background gaps never cause a spin.
      if (motion && previousSeconds !== null) elapsedSeconds += THREE.MathUtils.clamp(seconds - previousSeconds, 0, 0.10);
      previousSeconds = seconds;
      if (!motion) return;
      surfaceMaterial.uniforms.time.value = elapsedSeconds;
      const speed = kind === 1 ? 0.0025 : solar ? 0.004 : 0.007;
      sphere.rotation.y = initialRotation + elapsedSeconds * speed;
      if (clouds) {
        clouds.rotation.y = initialRotation + elapsedSeconds * 0.009;
        clouds.material.uniforms.time.value = elapsedSeconds;
      }
    },
    setOpacity(opacity) {
      if (disposed) return;
      const value = unit(opacity);
      group.visible = value > 0.001;
      for (const material of materials) material.uniforms.opacity.value = value;
      // Opaque planets must write depth to hide the far half of Saturn's rings.
      // During cross-fades all actors are transparent and must not punch holes
      // in the incoming planet or its atmosphere.
      const transparent = value < 0.999;
      if (surfaceMaterial.transparent !== transparent) {
        surfaceMaterial.transparent = transparent;
        surfaceMaterial.needsUpdate = true;
      }
      surfaceMaterial.depthWrite = !transparent;
    },
    setMap(nextMap) {
      if (disposed) return;
      surfaceMaterial.uniforms.planetMap.value = nextMap;
      surfaceMaterial.uniforms.hasMap.value = nextMap ? 1 : 0;
    },
    setCloudMap(nextMap) {
      if (disposed || !clouds) return;
      clouds.material.uniforms.cloudMap.value = nextMap;
      clouds.material.uniforms.hasCloudMap.value = nextMap ? 1 : 0;
    },
    setDetailMaps(west, east) {
      if (disposed || index !== 9) return;
      surfaceMaterial.uniforms.plutoDetailWest.value = west;
      surfaceMaterial.uniforms.plutoDetailEast.value = east;
      surfaceMaterial.uniforms.hasDetailMaps.value = west && east ? 1 : 0;
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
