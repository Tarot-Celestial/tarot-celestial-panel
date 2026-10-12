const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const THREE = require('three');
const helpers = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/cliente/planet-surface.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: helpers, require });
const destination = index => ({ index, name: `Planet ${index}`, color: '#507cff' });
const surfaceOf = visual => visual.group.getObjectByName('planet-spherical-surface');

test('every destination has a true unit sphere that can accept a high-resolution map', () => {
  for (let index = 0; index < 12; index++) {
    const visual = helpers.createPlanetSurface(destination(index), false, null);
    const surface = surfaceOf(visual);
    assert.ok(surface.geometry instanceof THREE.SphereGeometry);
    assert.equal(surface.geometry.parameters.radius, 1);
    surface.geometry.computeBoundingSphere();
    assert.ok(Math.abs(surface.geometry.boundingSphere.radius - 1) < 1e-6);
    const texture = new THREE.Texture();
    visual.setMap(texture);
    assert.equal(surface.material.uniforms.planetMap.value, texture);
    assert.equal(surface.material.uniforms.hasMap.value, 1);
    visual.setMap(null);
    assert.equal(surface.material.uniforms.hasMap.value, 0);
    visual.dispose(); texture.dispose();
  }
});

test('Saturn rings occupy a tilted three-dimensional plane around the sphere', () => {
  const visual = helpers.createPlanetSurface(destination(2), false, null);
  const ring = visual.group.getObjectByName('saturn-particle-rings');
  assert.ok(ring.geometry instanceof THREE.RingGeometry);
  assert.ok(ring.geometry.parameters.innerRadius > 1);
  visual.group.updateMatrixWorld(true);
  const position = ring.geometry.getAttribute('position');
  const point = new THREE.Vector3();
  let minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < position.count; i++) {
    point.fromBufferAttribute(position, i).applyMatrix4(ring.matrixWorld);
    minZ = Math.min(minZ, point.z); maxZ = Math.max(maxZ, point.z);
  }
  assert.ok(minZ < -0.5 && maxZ > 0.5, 'rings extend both in front of and behind the planet');
  assert.equal(ring.material.depthTest, true);
  assert.equal(surfaceOf(visual).material.depthWrite, true);
  visual.dispose();
});

test('crossfades release the depth buffer and restore opaque occlusion at arrival', () => {
  const visual = helpers.createPlanetSurface(destination(2), false, null);
  const material = surfaceOf(visual).material;
  visual.setOpacity(0.4);
  assert.equal(material.transparent, true);
  assert.equal(material.depthWrite, false);
  visual.group.traverse(node => { if (node.material) assert.equal(node.material.uniforms.opacity.value, 0.4); });
  visual.setOpacity(1);
  assert.equal(material.transparent, false);
  assert.equal(material.depthWrite, true);
  visual.setOpacity(NaN);
  assert.equal(visual.group.visible, false);
  visual.setOpacity(2);
  assert.equal(material.uniforms.opacity.value, 1);
  visual.dispose();
});

test('paused motion preserves longitude while camera approach can still reveal surface detail', () => {
  const visual = helpers.createPlanetSurface(destination(7), false, null);
  const surface = surfaceOf(visual);
  visual.update(0, true, 0);
  visual.update(0.05, true, 0.2);
  const rotation = surface.rotation.y;
  const time = surface.material.uniforms.time.value;
  visual.update(150, false, 0.9);
  assert.equal(surface.rotation.y, rotation);
  assert.equal(surface.material.uniforms.time.value, time);
  assert.equal(surface.material.uniforms.proximity.value, 0.9);
  assert.equal(visual.group.getObjectByName('earth-cloud-layer').material.uniforms.proximity.value, 0.9);
  visual.update(150.05, true, 1);
  assert.ok(surface.rotation.y - rotation < 0.001, 'resuming must not jump across the elapsed pause');
  visual.dispose();
});

test('local animation never changes the parent camera-placement transforms', () => {
  const visual = helpers.createPlanetSurface(destination(6), false, null);
  visual.group.position.set(3, -2, 7);
  visual.group.scale.setScalar(5);
  visual.group.rotation.z = 0.4;
  visual.update(0, true, 0);
  visual.update(0.02, true, 1);
  visual.setOpacity(0.5);
  assert.deepEqual(visual.group.position.toArray(), [3, -2, 7]);
  assert.deepEqual(visual.group.scale.toArray(), [5, 5, 5]);
  assert.equal(visual.group.rotation.z, 0.4);
  visual.dispose();
});

test('disposing shared-texture planets frees each owned resource once and preserves the maps', () => {
  const original = new THREE.Texture(), replacement = new THREE.Texture(), cloudMap = new THREE.Texture();
  let textureDisposals = 0;
  original.addEventListener('dispose', () => textureDisposals++);
  replacement.addEventListener('dispose', () => textureDisposals++);
  cloudMap.addEventListener('dispose', () => textureDisposals++);
  const visual = helpers.createPlanetSurface(destination(7), false, original);
  const resources = new Set();
  visual.group.traverse(node => { if (node.geometry) resources.add(node.geometry); if (node.material) resources.add(node.material); });
  const disposalCounts = new Map();
  for (const resource of resources) resource.addEventListener('dispose', () => disposalCounts.set(resource, (disposalCounts.get(resource) || 0) + 1));
  visual.setMap(replacement);
  visual.setCloudMap(cloudMap);
  assert.equal(visual.group.getObjectByName('earth-cloud-layer').material.uniforms.cloudMap.value, cloudMap);
  assert.equal(visual.group.getObjectByName('earth-cloud-layer').material.uniforms.hasCloudMap.value, 1);
  visual.setCloudMap(null);
  assert.equal(visual.group.getObjectByName('earth-cloud-layer').material.uniforms.hasCloudMap.value, 0);
  visual.setCloudMap(cloudMap);
  visual.dispose(); visual.dispose();
  visual.update(1, true, 1); visual.setMap(original); visual.setCloudMap(null); visual.setOpacity(1);
  assert.equal(textureDisposals, 0);
  assert.equal(visual.group.children.length, 0);
  for (const resource of resources) assert.equal(disposalCounts.get(resource), 1);
});

test('mobile quality reduces geometry and fragment detail while retaining spherical silhouettes', () => {
  const desktop = helpers.createPlanetSurface(destination(9), false, null);
  const mobile = helpers.createPlanetSurface(destination(9), true, null);
  assert.ok(surfaceOf(mobile).geometry.getAttribute('position').count < surfaceOf(desktop).geometry.getAttribute('position').count / 2);
  assert.equal(surfaceOf(mobile).material.defines.DETAIL_OCTAVES, 3);
  assert.equal(surfaceOf(desktop).material.defines.DETAIL_OCTAVES, 4);
  desktop.dispose(); mobile.dispose();
});

test('Pluto detail tiles activate as a complete pair without recompilation or taking texture ownership', () => {
  const west = new THREE.Texture(), east = new THREE.Texture(), color = new THREE.Texture();
  let textureDisposals = 0;
  for (const texture of [west, east, color]) texture.addEventListener('dispose', () => textureDisposals++);
  const pluto = helpers.createPlanetSurface(destination(9), false, color);
  const material = surfaceOf(pluto).material;
  const version = material.version;
  pluto.setDetailMaps(west, null);
  assert.equal(material.uniforms.hasDetailMaps.value, 0, 'incomplete hemisphere downloads preserve the complete color map');
  pluto.setDetailMaps(west, east);
  assert.equal(material.uniforms.hasDetailMaps.value, 1);
  assert.equal(material.uniforms.plutoDetailWest.value, west);
  assert.equal(material.uniforms.plutoDetailEast.value, east);
  assert.equal(material.uniforms.planetMap.value, color, 'high-resolution detail keeps the original chroma map');
  pluto.setDetailMaps(null, null);
  assert.equal(material.uniforms.hasDetailMaps.value, 0);
  assert.equal(material.version, version, 'switching resolution must not recompile the material');
  const earth = helpers.createPlanetSurface(destination(7), false, color);
  earth.setDetailMaps(west, east);
  assert.equal(surfaceOf(earth).material.uniforms.hasDetailMaps.value, 0);
  assert.equal(surfaceOf(earth).material.uniforms.plutoDetailWest.value, null);
  pluto.setDetailMaps(west, east);
  pluto.dispose(); pluto.dispose(); earth.dispose();
  assert.equal(textureDisposals, 0, 'only the caller may release textures shared with other actors');
  pluto.setDetailMaps(null, null);
  assert.equal(material.uniforms.plutoDetailWest.value, west, 'disposed visuals do not mutate their state');
});

test('Sun emission, Earth clouds, thick Venus clouds and Pluto no-data fill stay distinct', () => {
  const sun = helpers.createPlanetSurface(destination(10), false, null);
  const earth = helpers.createPlanetSurface(destination(7), false, null);
  const venus = helpers.createPlanetSurface(destination(4), false, null);
  const pluto = helpers.createPlanetSurface(destination(9), false, null);
  assert.equal(surfaceOf(sun).material.uniforms.kind.value, 3);
  assert.ok(sun.group.getObjectByName('solar-corona'));
  assert.ok(earth.group.getObjectByName('earth-cloud-layer'));
  assert.equal(venus.group.getObjectByName('venus-cloud-layer').material.uniforms.venus.value, 1);
  assert.equal(pluto.group.getObjectByName('earth-cloud-layer'), undefined);
  assert.equal(surfaceOf(pluto).material.uniforms.fillUnmappedPolarRegion.value, 1);
  assert.equal(surfaceOf(earth).material.uniforms.fillUnmappedPolarRegion.value, 0);
  sun.dispose(); earth.dispose(); venus.dispose(); pluto.dispose();
});
