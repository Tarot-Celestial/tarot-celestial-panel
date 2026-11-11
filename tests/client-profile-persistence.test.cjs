const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const source = fs.readFileSync(path.join(__dirname, '../src/app/api/cliente/perfil/route.ts'), 'utf8');

function fixture({ persist = true } = {}) {
  const row = {
    id: 'cliente-prueba',
    auth_user_id: 'auth-prueba',
    nombre: 'Ana',
    apellido: 'Prueba',
    email: 'ana@example.invalid',
    pais: 'Puerto Rico',
    fecha_nacimiento: null,
    onboarding_completado: false,
  };
  const writes = [];
  const admin = {
    from(table) {
      assert.equal(table, 'crm_clientes');
      let patch = null;
      const filters = {};
      return {
        update(next) { patch = next; return this; },
        select() { return this; },
        eq(field, value) { filters[field] = value; return this; },
        async maybeSingle() {
          if (filters.id !== row.id || filters.auth_user_id !== row.auth_user_id) return { data: null, error: null };
          if (patch) {
            writes.push(patch);
            const changed = { ...row, ...patch };
            if (persist) Object.assign(row, patch);
            return { data: changed, error: null };
          }
          return { data: { ...row }, error: null };
        },
      };
    },
    auth: { admin: {
      async getUserById() { return { data: { user: { user_metadata: {} } } }; },
      async updateUserById() { return { error: null }; },
    } },
  };
  const module = { exports: {} };
  const nextResponse = {
    json(payload, options = {}) {
      const status = options.status || 200;
      return { status, ok: status >= 200 && status < 300, json: async () => payload };
    },
  };
  const script = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(script, {
    exports: module.exports,
    require(name) {
      if (name === 'next/server') return { NextResponse: nextResponse };
      if (name === '@/lib/server/auth-cliente') return {
        clientFromRequest: async () => ({ uid: row.auth_user_id, cliente: { ...row }, admin }),
      };
      throw new Error(`Unexpected module: ${name}`);
    },
    Request, URL, Date, console: { error() {}, warn() {} },
  });
  const endpoint = 'https://example.invalid/api/cliente/perfil';
  return {
    row, writes,
    save(payload) {
      return module.exports.POST(new Request(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      }));
    },
    verify() { return module.exports.GET(new Request(`${endpoint}?verify=onboarding`)); },
  };
}

const completion = {
  nombre: 'Ana', apellido: 'Prueba', email: 'ana@example.invalid',
  fecha_nacimiento: '1990-05-20', onboarding_completado: true,
};

test('completing the three steps persists after a new authenticated read without erasing country', async () => {
  const h = fixture();
  const saved = await h.save(completion);
  const body = await saved.json();
  assert.equal(saved.status, 200);
  assert.equal(body.persistence_confirmed, true);
  assert.equal(h.row.onboarding_completado, true);
  assert.equal(h.row.fecha_nacimiento, completion.fecha_nacimiento);
  assert.equal(h.row.pais, 'Puerto Rico');
  assert.equal(Object.hasOwn(h.writes[0], 'pais'), false);

  // New request after signing out and back in reads the same durable record.
  const reopened = await h.verify();
  assert.equal(reopened.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(await reopened.json())), {
    ok: true, cliente_id: h.row.id, onboarding_completado: true,
    fecha_nacimiento_confirmada: true,
  });
});

test('a missing birthday cannot silently mark registration as completed', async () => {
  const h = fixture();
  const response = await h.save({ ...completion, fecha_nacimiento: '' });
  assert.equal(response.status, 400);
  assert.equal(h.row.onboarding_completado, false);
  assert.equal(h.writes.length, 0);
});

test('the API refuses to acknowledge an update that was not persisted', async () => {
  const h = fixture({ persist: false });
  const response = await h.save(completion);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).ok, false);
  assert.equal(h.row.onboarding_completado, false);
});

test('explicit country edits still work without resetting a completed profile', async () => {
  const h = fixture();
  await h.save(completion);
  const response = await h.save({ nombre: 'Ana', pais: 'España' });
  assert.equal(response.status, 200);
  assert.equal(h.row.pais, 'España');
  assert.equal(h.row.onboarding_completado, true);
});
