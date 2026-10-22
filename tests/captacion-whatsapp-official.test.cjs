const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const twilio = require('twilio');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AC = 'AC' + 'a'.repeat(32), HX = 'HX' + 'b'.repeat(32), SM = 'SM' + 'c'.repeat(32);
function fixture(options = {}) {
  const calls = [], reads = [], rpcs = [], deliveries = options.deliveries || [];
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'private-service', TWILIO_ACCOUNT_SID: AC, TWILIO_AUTH_TOKEN: 'private-token', TWILIO_WHATSAPP_FROM: 'whatsapp:+17875551234', TWILIO_WHATSAPP_CAPTACION_CONTENT_SID: HX, CAPTACION_WHATSAPP_ENABLED: 'true', VERCEL_ENV: 'production', ...options.env };
  const worker = { id: id(1), user_id: id(2), is_active: true, role: 'central', ...options.worker };
  const lead = { id: id(10), cliente_id: id(20), assigned_worker_id: null, closed_at: null, origen: 'facebook_ads', ...options.lead };
  const client = { id: id(20), nombre: 'María', apellido: 'Fixture', telefono: '+1 (787) 555-0205', origen: 'Facebook', ...options.client };
  const tables = { workers: [worker], captacion_leads: [lead], crm_clientes: [client], meta_lead_events: [{ leadgen_id: '111', meta_created_at: '2026-10-21T12:00:00Z', captacion_lead_id: lead.id, status: 'processed' }], captacion_whatsapp_deliveries: deliveries };
  const db = { auth: { async getUser(token) { calls.push({ auth: token }); return { data: { user: token === 'verified' ? { id: id(2) } : null }, error: null }; } }, from(table) {
    let fields = '', single = false, limit = Infinity; const predicates = [];
    const query = {
      select(value) { fields = value; return query; }, eq(key, value) { predicates.push(row => row[key] === value); return query; },
      in(key, values) { predicates.push(row => values.includes(row[key])); return query; }, lte(key, value) { predicates.push(row => row[key] <= value); return query; },
      or(value) { predicates.push(row => value.split(',').some(part => { const [key, , match] = part.split('.'); return String(row[key]) === match; })); return query; },
      order() { return query; }, limit(value) { limit = value; return query; }, maybeSingle() { single = true; return query; },
      then(resolve, reject) { reads.push({ table, fields }); if (options.failTable === table) return Promise.resolve({ error: { message: 'private database details' }, data: null }).then(resolve, reject);
        const rows = tables[table].filter(row => predicates.every(p => p(row))).slice(0, limit).map(row => Object.fromEntries(fields.split(',').filter(k => k in row).map(k => [k, row[k]])));
        return Promise.resolve({ error: null, data: single ? rows[0] || null : rows }).then(resolve, reject);
      },
    }; return query;
  }, async rpc(name, values) {
    rpcs.push({ name, values });
    if (options.rpcError === name) return { data: null, error: { message: 'private rpc' } };
    if (name === 'tc_captacion_whatsapp_claim') {
      const currentSnapshot = Object.fromEntries(['telefono_normalizado', 'telefono', 'pais', 'nombre', 'apellido'].map(key => [key, client[key] ?? null]));
      if (lead.cliente_id !== values.p_expected_cliente_id || JSON.stringify(currentSnapshot) !== JSON.stringify(values.p_client_snapshot)) return { data: null, error: { message: 'CLIENT_CHANGED' } };
      const prior = deliveries.find(row => row.request_id === values.p_request_id || (row.lead_id === values.p_lead_id && row.submission_key === values.p_submission_key));
      if (prior) return { data: { claimed: false, delivery: prior }, error: null };
      const row = { id: values.p_delivery_id, lead_id: values.p_lead_id, request_id: values.p_request_id, submission_key: values.p_submission_key, callback_token: values.p_callback_token, status: 'sending', from_number: values.p_from_number, to_number: values.p_to_number };
      deliveries.push(row); return { data: { claimed: true, delivery: row }, error: null };
    }
    const row = deliveries.find(row => row.id === values.p_delivery_id);
    if (row) { row.status = values.p_status; row.message_sid = values.p_message_sid || row.message_sid; }
    return { data: row, error: null };
  } };
  let lib, changedDuringPreflight = false;
  const outbound = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/Messages.json')) {
      if (options.networkTimeout) throw new Error('private timeout');
      return new Response(JSON.stringify(options.sendJson || { sid: SM, status: 'queued' }), { status: options.sendStatus || 201 });
    }
    if (options.changeDuringTemplateRead && !changedDuringPreflight) {
      changedDuringPreflight = true;
      Object.assign(client, options.changeDuringTemplateRead.client || {});
      Object.assign(lead, options.changeDuringTemplateRead.lead || {});
    }
    if (options.templateUnavailable) return new Response('private upstream', { status: 503 });
    if (String(url).endsWith('/ApprovalRequests')) return new Response(JSON.stringify({ sid: HX, account_sid: AC, whatsapp: { status: options.approval || 'approved', category: options.category || 'MARKETING', content_type: 'twilio/media', name: 'tarot_celestial_captacion_v1' } }));
    return new Response(JSON.stringify({ sid: HX, account_sid: AC, types: { 'twilio/media': { body: options.templateBody || lib.CAPTACION_WHATSAPP_BODY, media: [options.image || lib.CAPTACION_WHATSAPP_IMAGE] } } }));
  };
  const cache = {};
  function load(relative) {
    const full = path.join(__dirname, '..', relative);
    if (cache[full]) return cache[full];
    const exports = {}; cache[full] = exports;
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
      exports, require(name) {
        if (name === '@supabase/supabase-js') return { createClient: () => db };
        if (name === 'next/server') return { NextResponse: class extends Response { static json(body, init) { return new Response(JSON.stringify(body), init); } } };
        if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts');
        if (name.startsWith('.')) return load(path.relative(path.join(__dirname, '..'), path.resolve(path.dirname(full), name + '.ts')));
        return require(name);
      }, process: { env }, fetch: outbound, Buffer, URL, URLSearchParams, Request, Response, AbortSignal, Date, console,
    }); return exports;
  }
  lib = load('src/lib/server/captacion-whatsapp.ts');
  const api = load('src/app/api/captacion/whatsapp/route.ts'), callback = load('src/app/api/webhooks/captacion-whatsapp/route.ts');
  const req = (method, body, token = 'verified') => new Request(`https://fixture.invalid/api/captacion/whatsapp?lead_id=${lead.id}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { lib, db, worker, env, lead, client, deliveries, calls, reads, rpcs, api, callback, get: () => api.GET(req('GET')), post: (body = { lead_id: lead.id, request_id: id(100) }, token) => api.POST(req('POST', body, token)), messages: () => calls.filter(call => call.url?.endsWith('/Messages.json')) };
}

test('GET exposes approved fixed template and personalized preview without sending; admin-only diagnostics', async () => {
  const f = fixture(), response = await f.get(), body = await response.json();
  assert.equal(body.ready, true); assert.equal(body.template.status, 'approved'); assert.match(body.preview_message, /María Fixture/); assert.equal(body.template.media_url, f.lib.CAPTACION_WHATSAPP_IMAGE);
  assert.equal(body.missing, undefined); assert.equal(body.sender, undefined); assert.equal(f.messages().length, 0); assert.match(response.headers.get('cache-control'), /private.*no-store/);
  assert.doesNotMatch(JSON.stringify(body), /private-token|private-service/);
  const admin = await (await fixture({ worker: { role: 'admin' }, env: { TWILIO_WHATSAPP_CAPTACION_CONTENT_SID: '' } }).get()).json();
  assert.equal(admin.ready, false); assert.ok(admin.missing.includes('TWILIO_WHATSAPP_CAPTACION_CONTENT_SID')); assert.equal(admin.sender, 'whatsapp:+17875551234');
});

test('missing, unapproved, mismatched, sandbox, preview and disabled configuration never sends', async () => {
  for (const options of [{ env: { TWILIO_WHATSAPP_CAPTACION_CONTENT_SID: '' } }, { approval: 'pending' }, { approval: 'rejected' }, { category: 'UTILITY' }, { image: 'https://evil.invalid/image.png' }, { templateBody: 'Freeform {{1}}' }, { env: { TWILIO_WHATSAPP_FROM: 'whatsapp:+14155238886' } }, { env: { VERCEL_ENV: 'preview' } }, { env: { CAPTACION_WHATSAPP_ENABLED: 'false' } }, { templateUnavailable: true }]) {
    const f = fixture(options); assert.equal((await (await f.get()).json()).ready, false); assert.equal((await f.post()).status, 409); assert.equal(f.messages().length, 0); assert.equal(f.rpcs.length, 0);
  }
});

test('real auth, assignment and brand are checked; arbitrary recipient, body and media are rejected', async () => {
  for (const options of [{ worker: { is_active: false } }, { worker: { role: 'tarotista' } }, { worker: { user_id: id(90) } }, { lead: { assigned_worker_id: id(90) } }, { client: { origen: 'Orion Facebook' } }]) {
    const f = fixture(options); assert.ok([403, 404].includes((await f.post()).status)); assert.equal(f.messages().length, 0);
  }
  const forged = fixture(); assert.equal((await forged.post(undefined, 'forged-jwt')).status, 401); assert.equal(forged.reads.length, 0);
  for (const key of ['text', 'phone', 'media_url', 'ContentSid']) { const f = fixture(); assert.equal((await f.post({ lead_id: id(10), request_id: id(100), [key]: 'arbitrary' })).status, 400); assert.equal(f.messages().length, 0); }
});

test('POST sends the approved name variable and fixed template from CRM only; accepted is not delivered', async () => {
  const f = fixture(), response = await f.post(), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.status, 'accepted'); assert.equal(body.duplicate, false);
  const params = f.messages()[0].init.body;
  assert.equal(params.get('To'), 'whatsapp:+17875550205'); assert.equal(params.get('ContentSid'), HX); assert.deepEqual(JSON.parse(params.get('ContentVariables')), { '1': 'María Fixture' });
  assert.equal(params.has('Body'), false); assert.equal(params.has('MediaUrl'), false);
  assert.match(params.get('StatusCallback'), /^https:\/\/clientestarotcelestial.es\/api\/webhooks\/captacion-whatsapp\?delivery_id=/);
  assert.equal(f.rpcs[0].values.p_auth_user_id, id(2)); assert.equal(f.rpcs[0].values.p_submission_key, 'meta:111');
  assert.equal(f.rpcs[0].values.p_expected_cliente_id, id(20));
  assert.deepEqual(JSON.parse(JSON.stringify(f.rpcs[0].values.p_client_snapshot)), { telefono_normalizado: null, telefono: '+1 (787) 555-0205', pais: null, nombre: 'María', apellido: 'Fixture' });
  assert.equal((await (await f.get()).json()).reason, 'ALREADY_SENT');
});

test('concurrent clicks and different request UUIDs share one delivery, including ambiguous timeouts', async () => {
  const f = fixture(); const responses = await Promise.all([f.post(), f.post({ lead_id: id(10), request_id: id(101) })]);
  const bodies = await Promise.all(responses.map(response => response.json())); assert.equal(f.messages().length, 1); assert.equal(f.deliveries.length, 1); assert.equal(bodies.filter(body => body.duplicate).length, 1);
  const timeout = fixture({ networkTimeout: true }); assert.equal((await (await timeout.post()).json()).status, 'unknown');
  assert.equal((await (await timeout.post({ lead_id: id(10), request_id: id(102) })).json()).duplicate, true); assert.equal(timeout.messages().length, 1); assert.equal((await (await timeout.get()).json()).reason, 'PENDING_CONFIRMATION');
});

test('provider failures and receipt-save failures remain recorded or pending, never silently resending', async () => {
  const failed = fixture({ sendStatus: 400, sendJson: { code: 63016, message: 'private details' } }); const body = await (await failed.post()).json(); assert.equal(body.status, 'failed'); assert.doesNotMatch(JSON.stringify(body), /private/);
  assert.equal((await (await failed.post()).json()).duplicate, true); assert.equal(failed.messages().length, 1);
  const saveFailed = fixture({ rpcError: 'tc_captacion_whatsapp_record' }); assert.equal((await (await saveFailed.post()).json()).status, 'unknown'); assert.equal(saveFailed.deliveries[0].status, 'sending'); assert.equal((await (await saveFailed.post()).json()).duplicate, true); assert.equal(saveFailed.messages().length, 1);
  const claimFailed = fixture({ rpcError: 'tc_captacion_whatsapp_claim' }); assert.equal((await claimFailed.post()).status, 503); assert.equal(claimFailed.messages().length, 0);
});

test('recipient needs an explicit international prefix or recognized CRM country; no default country inference', async () => {
  const f = fixture(); assert.equal(f.lib.captacionWhatsAppRecipient({ telefono: '7875550205' }), null);
  assert.equal(f.lib.captacionWhatsAppRecipient({ telefono: '7875550205', pais: 'PR' }), '+17875550205');
  assert.equal(f.lib.captacionWhatsAppRecipient({ telefono: '612345678', pais: 'España' }), '+34612345678');
  assert.equal(f.lib.captacionWhatsAppRecipient({ telefono: '7875550205', pais: 'Unknown' }), null);
});

test('CRM edits or merges during provider preflight cancel the claim before any message is sent', async () => {
  for (const changeDuringTemplateRead of [
    { client: { telefono: '+17870000000' } }, { client: { telefono_normalizado: '+17870000000' } },
    { client: { pais: 'PR' } }, { client: { nombre: 'Nombre editado' } }, { client: { apellido: 'Apellido editado' } },
    { lead: { cliente_id: id(21) } },
  ]) {
    const f = fixture({ changeDuringTemplateRead }), response = await f.post();
    assert.equal(response.status, 409); assert.deepEqual(await response.json(), { ok: false, error: 'LEAD_CHANGED' });
    assert.equal(f.deliveries.length, 0); assert.equal(f.messages().length, 0);
  }
});

test('callbacks verify signature over canonical exact URL and parameters before writing any data', async () => {
  const delivery = { id: id(200), lead_id: id(10), submission_key: 'meta:111', status: 'accepted', callback_token: id(201), message_sid: SM, from_number: 'whatsapp:+17875551234', to_number: 'whatsapp:+17875550205' };
  const f = fixture({ deliveries: [delivery] });
  const external = `https://clientestarotcelestial.es/api/webhooks/captacion-whatsapp?delivery_id=${delivery.id}&token=${delivery.callback_token}`;
  const params = { AccountSid: AC, MessageSid: SM, MessageStatus: 'delivered', From: delivery.from_number, To: delivery.to_number };
  const request = (overrides = {}, signatureUrl = external, extra = '') => { const values = { ...params, ...overrides }; return new Request(external.replace('clientestarotcelestial.es', 'internal.invalid'), { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'x-twilio-signature': twilio.getExpectedTwilioSignature(f.env.TWILIO_AUTH_TOKEN, signatureUrl, values) }, body: new URLSearchParams(values).toString() + extra }); };
  assert.equal((await f.callback.POST(request({}, 'https://evil.invalid/path'))).status, 403); assert.equal(f.reads.length, 0);
  assert.equal((await f.callback.POST(request({ AccountSid: 'AC' + 'f'.repeat(32) }))).status, 409);
  assert.equal((await f.callback.POST(request({ To: 'whatsapp:+17870000000' }))).status, 409);
  assert.equal((await f.callback.POST(request({}, external, '&MessageStatus=read'))).status, 400);
  assert.equal((await f.callback.POST(request())).status, 200); assert.equal(delivery.status, 'delivered'); assert.equal(f.rpcs.length, 1);
});
