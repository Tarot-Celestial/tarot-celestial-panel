const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const helpers = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/components/cliente/universe-motion.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: helpers });
const close = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} should equal ${expected}`);

test('all established panel destinations preserve atlas index and colors', () => {
  const scenes = [
    ['dashboard', 'Neptuno', '#507cff'], ['oraculo', 'Urano', '#85e4e0'], ['ruleta', 'Saturno', '#eac17a'],
    ['sorteo', 'Júpiter', '#e5b297'], ['precios-ofertas', 'Venus', '#e6c48a'], ['tarotistas', 'La Luna', '#d9d9f0'],
    ['perfil', 'Marte', '#dc9b84'], ['resenas', 'La Tierra', '#77bedf'], ['notificaciones', 'Mercurio', '#b4b5ca'],
    ['ritual', 'Plutón', '#ceacdf'], ['rangos', 'El Sol', '#f2cc70'],
  ];
  scenes.forEach(([key, name, color], index) => {
    for (const suffix of ['', '/', '/detail/123', '?next=/cliente/ruleta', '/?filter=active#top']) {
      const route = `/cliente/${key}${suffix}`;
      assert.equal(helpers.isUniverseRoute(route), true);
      assert.deepEqual({ ...helpers.universeDestination(route) }, { key, name, color, index });
    }
  });
});

test('login, recovery, unrelated and invalid routes never start the universe', () => {
  for (const route of ['/cliente', '/cliente/', '/cliente?next=dashboard', '/cliente/login', '/cliente/login?next=/cliente/dashboard', '/cliente/recuperar/', '/cliente/chat', '/cliente/chat?conversation=123', '/cliente/toString', '/cliente/__proto__', '/cliente/unknown', '/panel-central/dashboard', '/api/cliente/dashboard', '', null, undefined]) {
    assert.equal(helpers.isUniverseRoute(route), false, String(route));
    assert.equal(helpers.universeDestination(route).index, 11);
  }
  for (const route of ['/cliente/campanas/123?source=panel', '//cliente//dashboard//']) assert.equal(helpers.isUniverseRoute(route), true);
  assert.deepEqual({ ...helpers.universeDestination('/cliente/chat') }, { key: 'nebula', name: 'Nebulosa celestial', index: 11, color: '#bf9de7' });
});

test('scroll retraces the same path and handles rubber-band and short documents', () => {
  const sample = [0, 250, 750, 1000, 750, 250, 0].map(y => helpers.scrollProgress(y, 1800, 800));
  assert.deepEqual(sample, [0, .25, .75, 1, .75, .25, 0]);
  assert.equal(helpers.scrollProgress(-100, 1800, 800), 0);
  assert.equal(helpers.scrollProgress(3000, 1800, 800), 1);
  for (const args of [[20, 500, 800], [20, 800, 800], [NaN, 1800, 800], [10, Infinity, 800], [10, 800, 0], [10, 800, NaN]]) assert.equal(helpers.scrollProgress(...args), 0);
});

test('damping arrives at the same position at 30, 60, and 120 FPS', () => {
  const advance = fps => {
    let position = 0;
    for (let i = 0; i < fps; i++) position += (1 - position) * helpers.dampingFactor(1000 / fps);
    return position;
  };
  close(advance(30), advance(60)); close(advance(60), advance(120));
  close(advance(60), helpers.dampingFactor(1000));
  for (const dt of [0, -12, NaN, Infinity]) assert.equal(helpers.dampingFactor(dt), 0);
  assert.equal(helpers.dampingFactor(100, -2), 0);
  assert.equal(helpers.dampingFactor(100, 0), 0);
  close(helpers.dampingFactor(100, NaN), helpers.dampingFactor(100, 6));
  assert.equal(helpers.dampingFactor(Number.MAX_VALUE), 1);
});

test('pointer parallax stays centered on invalid layout and bounded offscreen', () => {
  assert.deepEqual({ ...helpers.pointerTarget(400, 300, 800, 600) }, { x: 0, y: 0 });
  assert.deepEqual({ ...helpers.pointerTarget(-300, 2000, 800, 600) }, { x: -1, y: 1 });
  assert.deepEqual({ ...helpers.pointerTarget(NaN, Infinity, 800, 600) }, { x: 0, y: 0 });
  assert.deepEqual({ ...helpers.pointerTarget(400, 300, 0, NaN) }, { x: 0, y: 0 });
});

test('frame budget preserves 60 and 30 FPS targets across screen refresh rates', () => {
  const run = (target, source, seconds) => {
    let remainder = 0, frames = 0;
    for (let tick = 0; tick < source * seconds; tick++) {
      const next = helpers.advanceFrameBudget(remainder, 1000 / source, target);
      if (next.render) frames++;
      remainder = next.remainderMs;
      assert.ok(remainder >= 0 && remainder < 1000 / target);
    }
    return frames;
  };
  for (const refresh of [60, 75, 90, 120, 144]) assert.ok(Math.abs(run(60, refresh, 10) - 600) <= 1, `60 FPS on ${refresh} Hz`);
  for (const refresh of [60, 75, 90, 120, 144]) assert.ok(Math.abs(run(30, refresh, 10) - 300) <= 1, `30 FPS on ${refresh} Hz`);
  assert.equal(run(60, 30, 10), 300, 'cannot draw more often than the source display');
});

test('irregular frame budget keeps elapsed remainders without bursts after long gaps', () => {
  const deltas = [5, 7, 4, 8, 9, 11, 6, 12, 8, 3];
  let remainder = 0, elapsed = 0, frames = 0;
  for (let i = 0; i < 1500; i++) {
    const delta = deltas[i % deltas.length];
    elapsed += delta;
    const next = helpers.advanceFrameBudget(remainder, delta, 60);
    remainder = next.remainderMs;
    if (next.render) frames++;
  }
  assert.ok(Math.abs(frames - Math.floor(elapsed / (1000 / 60))) <= 1);
  const delayed = helpers.advanceFrameBudget(remainder, 1050, 30);
  assert.equal(delayed.render, true);
  assert.ok(delayed.remainderMs >= 0 && delayed.remainderMs < 1000 / 30);
  const immediate = helpers.advanceFrameBudget(delayed.remainderMs, 0, 30);
  assert.equal(immediate.render, false, 'missed frames are dropped rather than replayed');
});

test('frame budgets sanitize invalid values and remain finite at numeric extremes', () => {
  for (const invalid of [NaN, Infinity, -Infinity, -5]) {
    assert.deepEqual({ ...helpers.advanceFrameBudget(invalid, invalid, invalid) }, { render: false, remainderMs: 0 });
    assert.deepEqual({ ...helpers.advanceFrameBudget(0, 1000 / 60, invalid) }, { render: true, remainderMs: 0 });
  }
  for (const fps of [Number.MAX_VALUE, Number.MIN_VALUE, 0]) {
    const next = helpers.advanceFrameBudget(Number.MAX_VALUE, Number.MAX_VALUE, fps);
    assert.equal(next.render, true);
    assert.ok(Number.isFinite(next.remainderMs) && next.remainderMs >= 0);
  }
  const almostBoundary = helpers.advanceFrameBudget(0, 1000 / 60 - 1e-10, 60);
  assert.deepEqual({ ...almostBoundary }, { render: true, remainderMs: 0 });
});

test('quality caps dense mobile displays and degrades for constrained or reduced motion', () => {
  const desktop = helpers.qualityProfile({ width: 1440, dpr: 3 });
  assert.deepEqual({ ...desktop }, { pixelRatio: 1.5, starCount: 1400, maxFps: 60 });
  const mobile = helpers.qualityProfile({ width: 390, dpr: 3, deviceMemory: 8, hardwareConcurrency: 8 });
  assert.deepEqual({ ...mobile }, { pixelRatio: 1.25, starCount: 620, maxFps: 30 });
  for (const hint of [{ saveData: true }, { deviceMemory: 2 }, { hardwareConcurrency: 2 }]) {
    const quality = helpers.qualityProfile({ width: 1920, dpr: 3, ...hint });
    assert.deepEqual({ ...quality }, { pixelRatio: 1, starCount: 350, maxFps: 30 });
  }
  const high = helpers.qualityProfile({ width: 1920, dpr: 3, deviceMemory: 8, hardwareConcurrency: 8 });
  assert.deepEqual({ ...high }, { pixelRatio: 2, starCount: 1800, maxFps: 60 });
  const reduced = helpers.qualityProfile({ width: 1920, dpr: 3, reducedMotion: true });
  assert.deepEqual({ ...reduced }, { pixelRatio: 1, starCount: 180, maxFps: 15 });
  for (const invalid of [NaN, Infinity, -1, 0]) {
    const quality = helpers.qualityProfile({ width: invalid, dpr: invalid, deviceMemory: invalid, hardwareConcurrency: invalid });
    assert.equal(quality.pixelRatio, 1); assert.equal(quality.maxFps, 30);
  }
  assert.equal(helpers.qualityProfile({ width: 390, dpr: .75 }).pixelRatio, .75);
});

test('travel begins at the old world and settles exactly on the next world', () => {
  const start = helpers.travelPose(0), end = helpers.travelPose(1);
  close(start.outgoingX, 0); close(start.outgoingZ, 0);
  assert.equal(start.outgoingScale, 1); assert.equal(start.outgoingOpacity, 1); assert.equal(start.incomingOpacity, 0);
  close(end.incomingX, 0); close(end.incomingZ, 0);
  assert.equal(end.incomingScale, 1); assert.equal(end.incomingOpacity, 1); assert.equal(end.outgoingOpacity, 0);
  for (const pose of [start, end]) for (const axis of ['cameraX', 'cameraY', 'cameraZ']) close(pose[axis], 0);
  assert.deepEqual({ ...helpers.travelPose(-2) }, { ...start });
  assert.deepEqual({ ...helpers.travelPose(4) }, { ...end });
  for (const invalid of [NaN, Infinity, undefined]) for (const value of Object.values(helpers.travelPose(invalid))) assert.ok(Number.isFinite(value));
});

test('worlds overlap continuously without a dark gap, spin, or excessive zoom', () => {
  let previous = helpers.travelPose(0);
  for (let step = 1; step <= 1000; step++) {
    const pose = helpers.travelPose(step / 1000);
    assert.ok(pose.incomingOpacity + pose.outgoingOpacity >= 1 - 1e-12);
    assert.ok(Math.max(pose.incomingOpacity, pose.outgoingOpacity) >= .5);
    for (const value of Object.values(pose)) assert.ok(Number.isFinite(value));
    for (const key of Object.keys(pose)) assert.ok(Math.abs(pose[key] - previous[key]) < .016, key);
    assert.ok(pose.incomingScale >= .6 && pose.incomingScale <= 1);
    assert.ok(pose.outgoingScale >= .6 && pose.outgoingScale <= 1);
    assert.ok(Math.abs(pose.cameraX) <= .35 && Math.abs(pose.cameraY) <= .1 && Math.abs(pose.cameraZ) <= .4);
    previous = pose;
  }
});

test('travel direction reverses horizontal motion without changing depth or timing', () => {
  for (const progress of [0, .1, .5, .9, 1]) {
    const forward = helpers.travelPose(progress, 1), reverse = helpers.travelPose(progress, -1);
    for (const axis of ['outgoingX', 'incomingX', 'cameraX']) close(forward[axis], -reverse[axis]);
    for (const axis of ['outgoingZ', 'incomingZ', 'incomingOpacity', 'outgoingOpacity', 'cameraY', 'cameraZ']) close(forward[axis], reverse[axis]);
    for (const invalid of [NaN, Infinity, 0]) assert.deepEqual({ ...helpers.travelPose(progress, invalid) }, { ...forward });
  }
});

test('star generation is repeatable without changing global randomness', () => {
  const left = helpers.seededRandom(934), right = helpers.seededRandom(934), different = helpers.seededRandom(935);
  let changes = 0;
  for (let i = 0; i < 3000; i++) {
    const value = left(); assert.equal(value, right()); assert.ok(value >= 0 && value < 1);
    if (value !== different()) changes++;
  }
  assert.ok(changes > 2990);
  const invalid = helpers.seededRandom(NaN); assert.ok(Number.isFinite(invalid()));
});
