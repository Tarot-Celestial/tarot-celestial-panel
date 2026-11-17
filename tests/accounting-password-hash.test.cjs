const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const script = path.join(__dirname, '../scripts/accounting-password-hash.cjs');
function run(input, args = []) {
  return spawnSync(process.execPath, [script, ...args], { input, encoding: 'utf8', timeout: 10_000 });
}
function matches(encoded, password) {
  const [, salt, hash] = encoded.trim().split('$');
  const calculated = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(calculated, Buffer.from(hash, 'hex'));
}

test('stdin generator emits only a salted hash that matches the server verifier format', () => {
  const sample = 'fictitious test-only input';
  const result = run(sample);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /^scrypt\$[a-f0-9]{32}\$[a-f0-9]{128}\n$/);
  assert.ok(!result.stdout.includes(sample));
  assert.equal(matches(result.stdout, sample), true);
  assert.equal(matches(result.stdout, 'incorrect'), false);
  assert.notEqual(run(sample).stdout, result.stdout, 'each output uses a fresh random salt');
});

test('only one trailing newline is removed, preserving spaces and other content', () => {
  for (const suffix of ['', '\n', '\r\n']) {
    const result = run(`  test-only padded password  ${suffix}`);
    assert.equal(result.status, 0);
    assert.equal(matches(result.stdout, '  test-only padded password  '), true);
  }
  const doubleNewline = run('test-only input\n\n');
  assert.equal(matches(doubleNewline.stdout, 'test-only input\n'), true);
});

test('empty, too-long, invalid UTF-8 or argument-based input fails without revealing input', () => {
  const sensitiveLookingSample = 'fictitious-argument-never-print';
  for (const [input, args] of [
    ['', []], ['\n', []], ['x'.repeat(257), []], ['é'.repeat(257), []], [Buffer.from([0xc3, 0x28]), []],
    ['sample-only', [sensitiveLookingSample]],
  ]) {
    const result = run(input, args);
    assert.equal(result.status, 1);
    assert.equal(result.stdout, '');
    assert.ok(result.stderr.length > 0);
    assert.ok(!result.stderr.includes(sensitiveLookingSample));
  }
});

test('a 256-character Unicode password stays within the encoded input bound', () => {
  const sample = 'é'.repeat(256);
  const result = run(`${sample}\r\n`);
  assert.equal(result.status, 0);
  assert.equal(matches(result.stdout, sample), true);
});
