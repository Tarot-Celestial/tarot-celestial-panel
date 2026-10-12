const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const helpers = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/cliente/planet-detail.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: helpers });
const close = (actual, expected, tolerance = 1e-9) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should equal ${expected}`);
const eligible = { index: 7, proximity: .6, viewportWidth: 1440, deviceMemory: 8, maxTextureSize: 8192 };

test('surface sources preserve the established destination order and actual resolutions', () => {
  const names = ['neptune', 'uranus', 'saturn', 'jupiter', 'venus', 'moon', 'mars', 'earth', 'mercury', 'pluto', 'sun'];
  names.forEach((slug, index) => {
    const source = helpers.planetTextureSources(index);
    assert.equal(source.slug, slug);
    assert.equal(source.preview, `/images/universe/surfaces/${slug}-2k.jpg`);
    assert.equal(source.detailSecondary, index === 9 ? '/images/universe/surfaces/pluto-detail-east-4k.jpg' : null);
    if (index < 2) { assert.equal(source.detail, null); assert.equal(source.detailWidth, 0); }
    else {
      const width = [2, 3, 10].includes(index) ? 4096 : 8192;
      assert.equal(source.detail, index === 9 ? '/images/universe/surfaces/pluto-detail-west-4k.jpg'
        : `/images/universe/surfaces/${slug}-${width === 4096 ? '4k' : '8k'}.jpg`);
      assert.equal(source.detailWidth, width);
    }
  });
  for (const index of [11, 12, -1, .5, NaN, Infinity, undefined]) {
    assert.deepEqual({ ...helpers.planetTextureSources(index) }, { slug: 'nebula', preview: null, detail: null, detailSecondary: null, detailWidth: 0 });
  }
});

test('large maps wait for an approach on a capable desktop and a settled destination', () => {
  assert.equal(helpers.shouldLoadPlanetDetail(eligible), true);
  assert.equal(helpers.shouldLoadPlanetDetail({ ...eligible, proximity: .221, viewportWidth: 1024 }), true);
  for (const override of [
    { proximity: 0 }, { proximity: .22 }, { proximity: NaN }, { proximity: Infinity },
    { viewportWidth: 390 }, { viewportWidth: 1023 }, { viewportWidth: NaN },
    { deviceMemory: undefined }, { deviceMemory: 4 }, { deviceMemory: NaN }, { deviceMemory: Infinity },
    { maxTextureSize: 4096 }, { maxTextureSize: NaN }, { maxTextureSize: Infinity },
    { saveData: true }, { traveling: true }, { index: 0 }, { index: 1 }, { index: 11 },
  ]) assert.equal(helpers.shouldLoadPlanetDetail({ ...eligible, ...override }), false, JSON.stringify(override));
});

test('Pluto requires 8K capacity for its paired 4K hemispheres and can improve a paused view', () => {
  assert.equal(helpers.shouldLoadPlanetDetail({ ...eligible, index: 9, maxTextureSize: 8192 }), true);
  assert.equal(helpers.shouldLoadPlanetDetail({ ...eligible, index: 9, maxTextureSize: 8191 }), false);
  assert.equal(helpers.shouldLoadPlanetDetail({ ...eligible, index: 9, maxTextureSize: 4096 }), false);
  assert.equal(helpers.shouldLoadPlanetDetail({ ...eligible, index: 9, deviceMemory: 4 }), false);
  assert.equal(helpers.planetTextureSources(9).detailWidth, 8192);
  assert.equal(helpers.shouldLoadPlanetDetail({ ...eligible, motion: false }), true);
});

test('native 4K maps work on a 4GB desktop without permitting larger maps', () => {
  for (const index of [2, 3, 10]) {
    assert.equal(helpers.shouldLoadPlanetDetail({ ...eligible, index, deviceMemory: 4, maxTextureSize: 4096 }), true);
    assert.equal(helpers.shouldLoadPlanetDetail({ ...eligible, index, deviceMemory: 2, maxTextureSize: 4096 }), false);
    assert.equal(helpers.shouldLoadPlanetDetail({ ...eligible, index, deviceMemory: undefined, maxTextureSize: 4096 }), false);
    assert.equal(helpers.shouldLoadPlanetDetail({ ...eligible, index, deviceMemory: 4, maxTextureSize: 2048 }), false);
  }
  for (const index of [4, 5, 6, 7, 8, 9]) {
    assert.equal(helpers.shouldLoadPlanetDetail({ ...eligible, index, deviceMemory: 4 }), false);
  }
});

test('approach starts in orbit, finishes above the hemisphere, and reverses exactly', () => {
  const radius = 4.4, baseX = 3, baseY = -.8;
  assert.deepEqual({ ...helpers.approachPose(0, baseX, baseY, radius) }, { x: 0, y: 0, z: 9, proximity: 0 });
  const end = helpers.approachPose(1, baseX, baseY, radius);
  close(end.x, baseX - radius * .15); close(end.y, baseY + radius * .22); close(end.z, radius * 1.09);
  assert.equal(end.proximity, 1);
  close(helpers.approachPose(1, baseX, baseY, radius, true).z, radius * 1.16);
  const forward = [0, .1, .25, .5, .75, 1].map(p => ({ ...helpers.approachPose(p, baseX, baseY, radius) }));
  const backward = [1, .75, .5, .25, .1, 0].map(p => ({ ...helpers.approachPose(p, baseX, baseY, radius) })).reverse();
  assert.deepEqual(forward, backward);
});

test('the camera stays outside the surface across aspect ratios and mobile radii', () => {
  for (const mobile of [true, false]) for (const radius of [3.35, 4, 4.4, 5, 5.5]) {
    for (const centerX of [-8, 0, 1.5, 3, 6, 12]) for (const centerY of [-3, -.8, 0, 3]) {
      let previousProximity = 0;
      for (let step = 0; step <= 200; step++) {
        const pose = helpers.approachPose(step / 200, centerX, centerY, radius, mobile);
        assert.ok(Math.hypot(pose.x - centerX, pose.y - centerY, pose.z) >= radius * 1.105 - 1e-9);
        assert.ok(pose.proximity >= previousProximity && pose.proximity <= 1);
        assert.ok(pose.z > 0 && Object.values(pose).every(Number.isFinite));
        previousProximity = pose.proximity;
      }
    }
  }
});

test('camera motion is continuous at the orbit/atmosphere join without endpoint jumps', () => {
  let previous = helpers.approachPose(0, 3, -.8, 4.4);
  for (let step = 1; step <= 1000; step++) {
    const next = helpers.approachPose(step / 1000, 3, -.8, 4.4);
    assert.ok(Math.hypot(next.x - previous.x, next.y - previous.y, next.z - previous.z) < .01);
    assert.ok(next.z <= previous.z + 1e-10);
    previous = next;
  }
  const before = helpers.approachPose(.15 - 1e-7, 3, -.8, 4.4), after = helpers.approachPose(.15 + 1e-7, 3, -.8, 4.4);
  for (const key of ['x', 'y', 'z', 'proximity']) close(before[key], after[key]);
  assert.deepEqual({ ...helpers.approachPose(-1, 3, -.8, 4.4) }, { ...helpers.approachPose(0, 3, -.8, 4.4) });
  assert.deepEqual({ ...helpers.approachPose(2, 3, -.8, 4.4) }, { ...helpers.approachPose(1, 3, -.8, 4.4) });
});

test('invalid layout input never sends nonfinite camera coordinates to the renderer', () => {
  for (const value of [NaN, Infinity, -Infinity, undefined, 0, -2, Number.MAX_VALUE]) {
    const pose = helpers.approachPose(value, value, value, value);
    assert.ok(Object.values(pose).every(Number.isFinite));
    assert.ok(pose.proximity >= 0 && pose.proximity <= 1);
    assert.ok(pose.z > 0);
  }
});
