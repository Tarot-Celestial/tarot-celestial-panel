const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const twilio = require('twilio');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AC = 'AC' + 'a'.repeat(32), HX = 'HX' + 'b'.repeat(32), SM = 'SM' + 'c'.repeat(32);
function fixture(options = {}) {
  const calls = [], reads = [], rpcs = [], deliveries = options.deliveries || [];
  const env = { NEXT_PUBLIC_SUPABASE_URL: 'https://fixture.invalid', SUPABASE_SERVICE_ROLE_KEY: 'private-service', TWILIO_ACCOUNT_SID: AC, TWILIO_AUTH_TOKEN: 'private-token', TWILIO_WHATSAPP_FROM: 'whatsapp:+17875551234', TWILIO_WHATSAPP_CAPTACION_CONTENT_SID: HX, CAPTACION_WHATSAPP_ENABLED: 'false', CAPTACION_WHATSAPP_QR_ENABLED: 'true', VERCEL_ENV: 'production', ...options.env };
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
    if (name === 'tc_captacion_whatsapp_qr_claim') {
      const currentSnapshot = Object.fromEntries(['telefono_normalizado', 'telefono', 'pais', 'nombre', 'apellido'].map(key => [key, client[key] ?? null]));
      if (lead.cliente_id !== values.p_expected_cliente_id || JSON.stringify(currentSnapshot) !== JSON.stringify(values.p_client_snapshot)) return { data: null, error: { message: 'CLIENT_CHANGED' } };
      const prior = deliveries.find(row => row.request_id === values.p_request_id || (row.lead_id === values.p_lead_id && row.submission_key === values.p_submission_key));
      if (prior) return { data: { claimed: false, delivery: prior }, error: null };
      const row = { id: values.p_delivery_id, lead_id: values.p_lead_id, request_id: values.p_request_id, submission_key: values.p_submission_key, callback_token: values.p_callback_token, status: 'sending', from_number: values.p_from_number, to_number: values.p_to_number, provider: 'qr', gateway_session_id: values.p_gateway_session_id };
      deliveries.push(row); return { data: { claimed: true, delivery: row }, error: null };
    }
    const row = deliveries.find(row => row.id === values.p_delivery_id);
    if (row) { row.status = values.p_status; row.message_sid = values.p_message_sid || row.message_sid; }
    return { data: row, error: null };
  } };
  let lib, changedDuringPreflight = false;
  const journal = new Map();
  const gateway = {
    whatsappGatewayConfig: () => ({ configured: !options.notConfigured }),
    whatsappSessionId: worker => options.perWorker ? String(worker.id) : 'tarot-celestial',
    async whatsappGatewayFetch(url, init) {
      calls.push({ gateway: true, url, init });
      if (url.endsWith('/status')) {
        if (options.changeDuringPreflight && !changedDuringPreflight) { changedDuringPreflight = true; Object.assign(client, options.changeDuringPreflight.client || {}); Object.assign(lead, options.changeDuringPreflight.lead || {}); }
        return { status: options.statusHttp || 200, json: options.statusJson || { ok: true, state: options.state || 'connected', me: { id: '17875551234@s.whatsapp.net', name: 'Equipo fixture', phone: '17875551234' }, capabilities: { captacion: options.capable !== false } } };
      }
      if (init?.method === 'POST' && url.endsWith('/captacion')) {
        if (options.networkTimeout) throw new Error('private timeout');
        const value = options.sendJson || { ok: true, operationId: init.body.operationId, status: 'accepted', duplicate: false, messageId: '3EB0FIXTURE123', chatId: '17875550205@s.whatsapp.net', sender: '17875551234' };
        if (value.ok) journal.set(init.body.operationId, value);
        return { status: options.sendStatus || 200, json: value };
      }
      if (url.includes('/captacion/')) { const receipt = journal.get(url.split('/').at(-1)); return { status: receipt ? 200 : 404, json: receipt || { ok: false, error: 'OPERATION_NOT_FOUND' } }; }
      return { status: 200, json: { ok: true } };
    },
  };
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
        if (name === '@/lib/server/whatsapp-gateway') return gateway;
        if (name === 'next/server') return { NextResponse: class extends Response { static json(body, init) { return new Response(JSON.stringify(body), init); } } };
        if (name.startsWith('@/')) return load('src/' + name.slice(2) + '.ts');
        if (name.startsWith('.')) return load(path.relative(path.join(__dirname, '..'), path.resolve(path.dirname(full), name + '.ts')));
        return require(name);
      }, process: { env }, fetch: outbound, Buffer, URL, URLSearchParams, Request, Response, AbortSignal, Date, console,
    }); return exports;
  }
  lib = load('src/lib/server/captacion-whatsapp.ts');
  const api = load('src/app/api/captacion/whatsapp/route.ts'), callback = load('src/app/api/webhooks/captacion-whatsapp/route.ts'), central = load('src/app/api/central/whatsapp/route.ts');
  const req = (method, body, token = 'verified') => new Request(`https://fixture.invalid/api/captacion/whatsapp?lead_id=${lead.id}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { lib, db, worker, env, lead, client, deliveries, calls, reads, rpcs, api, callback, central, journal, get: () => api.GET(req('GET')), post: (body = { lead_id: lead.id, request_id: id(100) }, token) => api.POST(req('POST', body, token)), messages: () => calls.filter(call => call.gateway && call.init?.method === 'POST' && call.url?.endsWith('/captacion')) };
}

test('GET exposes the linked QR session and fixed personalized preview without calling Twilio or sending', async () => {
  const f = fixture(), response = await f.get(), body = await response.json();
  assert.equal(body.ready, true); assert.equal(body.provider, 'qr'); assert.equal(body.session.state, 'connected'); assert.match(body.preview_message, /María Fixture/); assert.equal(body.media_url, f.lib.CAPTACION_WHATSAPP_IMAGE);
  assert.equal(body.missing, undefined); assert.equal(body.sender, undefined); assert.equal(f.messages().length, 0); assert.match(response.headers.get('cache-control'), /private.*no-store/);
  assert.doesNotMatch(JSON.stringify(body), /private-token|private-service/);
  assert.ok(f.calls.every(call => !String(call.url).includes('twilio')));
  assert.equal((await (await fixture({ env: { TWILIO_WHATSAPP_CAPTACION_CONTENT_SID: '', TWILIO_AUTH_TOKEN: '' } }).get()).json()).ready, true);
});

test('missing gateway, disconnected QR, unsupported gateway, preview and disabled configuration never sends', async () => {
  for (const options of [{ notConfigured: true }, { state: 'qr' }, { state: 'idle' }, { state: 'connecting' }, { capable: false }, { env: { VERCEL_ENV: 'preview' } }, { env: { CAPTACION_WHATSAPP_QR_ENABLED: 'false' } }, { statusHttp: 503, statusJson: { ok: false, error: 'GATEWAY_UNREACHABLE' } }]) {
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

test('POST sends only CRM target and fixed campaign parameters to the linked session; accepted is not delivered', async () => {
  const f = fixture(), response = await f.post(), body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.status, 'accepted'); assert.equal(body.duplicate, false);
  const params = JSON.parse(JSON.stringify(f.messages()[0].init.body));
  assert.deepEqual(params, { operationId: body.delivery_id, phone: '+17875550205', name: 'María Fixture', expectedSender: '17875551234' });
  assert.equal(f.messages()[0].url, '/sessions/tarot-celestial/captacion');
  assert.equal(f.deliveries[0].gateway_session_id, 'tarot-celestial');
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
  const failed = fixture({ sendStatus: 404, sendJson: { ok: false, error: 'NOT_ON_WHATSAPP', message: 'private details' } }); const body = await (await failed.post()).json(); assert.equal(body.status, 'failed'); assert.doesNotMatch(JSON.stringify(body), /private/);
  assert.equal((await (await failed.post()).json()).duplicate, true); assert.equal(failed.messages().length, 1);
  const saveFailed = fixture({ rpcError: 'tc_captacion_whatsapp_record' }); assert.equal((await (await saveFailed.post()).json()).status, 'unknown'); assert.equal(saveFailed.deliveries[0].status, 'sending'); assert.equal((await (await saveFailed.post()).json()).duplicate, true); assert.equal(saveFailed.messages().length, 1);
  const claimFailed = fixture({ rpcError: 'tc_captacion_whatsapp_qr_claim' }); assert.equal((await claimFailed.post()).status, 503); assert.equal(claimFailed.messages().length, 0);
});

test('recipient needs an explicit international prefix or recognized CRM country; no default country inference', async () => {
  const f = fixture(); assert.equal(f.lib.captacionWhatsAppRecipient({ telefono: '7875550205' }), null);
  assert.equal(f.lib.captacionWhatsAppRecipient({ telefono: '7875550205', pais: 'PR' }), '+17875550205');
  assert.equal(f.lib.captacionWhatsAppRecipient({ telefono: '612345678', pais: 'España' }), '+34612345678');
  assert.equal(f.lib.captacionWhatsAppRecipient({ telefono: '7875550205', pais: 'Unknown' }), null);
});

test('CRM edits or merges during provider preflight cancel the claim before any message is sent', async () => {
  for (const changeDuringPreflight of [
    { client: { telefono: '+17870000000' } }, { client: { telefono_normalizado: '+17870000000' } },
    { client: { pais: 'PR' } }, { client: { nombre: 'Nombre editado' } }, { client: { apellido: 'Apellido editado' } },
    { lead: { cliente_id: id(21) } },
  ]) {
    const f = fixture({ changeDuringPreflight }), response = await f.post();
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

test('QR reconciliation uses the original session and verifies sender, operation and opaque message ID', async () => {
  const f = fixture({ perWorker: true });
  const sent = await (await f.post()).json();
  const stored = f.journal.get(sent.delivery_id);
  stored.status = 'delivered';
  const checked = await (await f.get()).json();
  assert.equal(checked.delivery.status, 'delivered');
  assert.equal(checked.delivery.message_id, '3EB0FIXTURE123');
  assert.ok(f.calls.some(call => call.url === `/sessions/${id(1)}/captacion/${sent.delivery_id}`));
  assert.equal(checked.delivery.callback_token, undefined);
  assert.equal(checked.delivery.to_number, undefined);
  for (const changed of [{ sender: '17870000000' }, { operationId: id(999) }, { messageId: 'invalid/message' }]) {
    const g = fixture(); const result = await (await g.post()).json(); Object.assign(g.journal.get(result.delivery_id), { status: 'read', ...changed });
    assert.equal((await (await g.get()).json()).delivery.status, 'accepted');
    assert.equal(g.messages().length, 1);
  }
});

test('unrecognized errors and conflicting journal operations remain unknown without automatic resend', async () => {
  for (const error of ['OPERATION_CONFLICT', 'GATEWAY_TIMEOUT', 'PRIVATE_UNEXPECTED_ERROR']) {
    const f = fixture({ sendStatus: 409, sendJson: { ok: false, error } });
    assert.equal((await (await f.post()).json()).status, 'unknown');
    assert.equal((await (await f.post()).json()).duplicate, true);
    assert.equal(f.messages().length, 1);
  }
});

test('central WhatsApp rejects unsigned user-shaped JWTs and inactive roles before reading or changing a session', async () => {
  const forged = `e30.${Buffer.from(JSON.stringify({ sub: id(2), email: 'fixture@example.invalid', role: 'authenticated', exp: 9999999999 })).toString('base64url')}.unsigned`;
  for (const method of ['GET', 'POST']) {
    const f = fixture();
    const request = new Request(`https://fixture.invalid/api/central/whatsapp?action=${method === 'GET' ? 'status' : 'start'}`, { method, headers: { authorization: `Bearer ${forged}` } });
    assert.equal((await f.central[method](request)).status, 401);
    assert.equal(f.reads.length, 0); assert.equal(f.calls.filter(call => call.gateway).length, 0);
  }
  const denied = fixture({ worker: { role: 'tarotista' } });
  assert.equal((await denied.central.GET(new Request('https://fixture.invalid/api/central/whatsapp?action=status', { headers: { authorization: 'Bearer verified' } }))).status, 403);
  assert.equal(denied.calls.filter(call => call.gateway).length, 0);
  const allowed = fixture();
  assert.equal((await allowed.central.GET(new Request('https://fixture.invalid/api/central/whatsapp?action=status', { headers: { authorization: 'Bearer verified' } }))).status, 200);
});
