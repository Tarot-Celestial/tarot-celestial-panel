const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm'), ts = require('typescript');
const copy = value => JSON.parse(JSON.stringify(value));
const lead = (id = '101', date = new Date().toISOString()) => ({ id, created_time: date, field_data: [
  { name: 'full_name', values: ['Test Contact'] }, { name: 'phone_number', values: ['600000001'] },
] });
function harness() {
  const tables = Object.fromEntries(['meta_lead_events','crm_clientes','captacion_leads','crm_client_notes','notifications','crm_leads_inbox','workers'].map(x => [x, []]));
  const calls = [], failures = [], requests = [];
  let counter = 0;
  const db = { from: table => {
    let filters = [], mode = 'read', value, one = false, limit;
    const q = {
      select: () => q, eq: (k,v) => { filters.push(r => r[k] === v); return q; },
      ilike: (k,v) => { filters.push(r => String(r[k] || '').toLowerCase() === String(v).toLowerCase()); return q; },
      in: (k,v) => { filters.push(r => v.includes(r[k])); return q; },
      order: () => q, limit: n => { limit = n; return q; },
      insert: v => { mode = 'insert'; value = v; return q; }, update: v => { mode = 'update'; value = v; return q; },
      single: () => { one = true; return q; }, maybeSingle: () => { one = true; return q; },
      then: resolve => {
        calls.push({ table, mode, value: value && copy(value) });
        const failAt = failures.findIndex(f => f.table === table && f.mode === mode);
        const failure = failAt < 0 ? null : failures.splice(failAt, 1)[0];
        if (failure && !failure.afterCommit) return Promise.resolve({ data: null, error: failure.error }).then(resolve);
        let selected = tables[table].filter(r => filters.every(f => f(r)));
        if (limit) selected = selected.slice(0, limit);
        if (mode === 'insert') {
          selected = [];
          for (const row of Array.isArray(value) ? value : [value]) {
            const key = table === 'meta_lead_events' ? 'leadgen_id' : table === 'captacion_leads' ? 'cliente_id' : null;
            if (key && tables[table].some(r => r[key] === row[key])) return Promise.resolve({ data: null, error: { code: '23505' } }).then(resolve);
            const added = { id: `row-${++counter}`, created_at: new Date().toISOString(), ...copy(row) };
            tables[table].push(added); selected.push(added);
          }
        } else if (mode === 'update') selected.forEach(r => Object.assign(r, copy(value)));
        return Promise.resolve({ data: failure ? null : copy(one ? selected[0] || null : selected), error: failure?.error || null }).then(resolve);
      },
    };
    return q;
  }};
  const env = { META_ACCESS_TOKEN: 'test-private-token', META_GRAPH_API_VERSION: 'v25.0', META_FORM_IDS: '900', CRON_SECRET: 'cron', META_INGEST_SECRET: 'internal', META_APP_SECRET: 'signature' };
  const h = { tables, calls, failures, requests, env, fetch: async () => new Response(JSON.stringify(lead())) };
  const logs = [];
  const shared = { URL, Response, Request, Date, AbortSignal, Buffer, process: { env }, console: Object.fromEntries(['info','warn','error','log'].map(k => [k, (...args) => logs.push(args)])), fetch: async (url, options) => {
    requests.push({ url: String(url), options }); return h.fetch(url, options);
  }};
  function load(file, deps) {
    const exports = {};
    vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText,
      { ...shared, exports, require: name => { if (!(name in deps)) throw Error(`Unexpected dependency ${name}`); return deps[name]; } });
    return exports;
  }
  h.api = load('src/lib/server/meta-leads.ts', { '@/lib/supabase-admin': { supabaseAdmin: () => db } });
  const next = { NextResponse: { json: (data, options) => new Response(JSON.stringify(data), options) } };
  h.loadSync = (override = {}) => load('src/app/api/sync/meta-leads/route.ts', { 'next/server': next, '@/lib/server/meta-leads': { ...h.api, ...override } });
  h.loadWebhook = (override = {}, facebook = async () => ({ received: 0 })) => load('src/app/api/webhooks/meta-leads/route.ts', { crypto: require('node:crypto'), 'next/server': next, '@/lib/server/meta-leads': { ...h.api, ...override }, '@/lib/server/facebook-inbox': { processFacebookWebhook: facebook } });
  h.sync = override => h.loadSync(override).GET(new Request('https://test/api/sync/meta-leads', { headers: { authorization: 'Bearer cron' } }));
  h.logs = logs;
  return h;
}

test('Expanded lead is ingested once; processed duplicate does not duplicate notes or notifications', async () => {
  const h = harness(); h.tables.workers.push({ user_id: 'worker', role: 'central' });
  await h.api.processExpandedMetaLead(lead());
  const counts = Object.fromEntries(Object.entries(h.tables).map(([k,v]) => [k,v.length]));
  assert.equal((await h.api.processExpandedMetaLead(lead())).duplicate, true);
  assert.deepEqual(Object.fromEntries(Object.entries(h.tables).map(([k,v]) => [k,v.length])), counts);
  assert.equal(h.tables.meta_lead_events[0].status, 'processed');
  assert.equal(h.tables.meta_lead_events[0].attempt_count, 1);
});

for (const state of ['pend_free', 'pend_cap', 'cliente', 'cerrado']) test(`Repeat form preserves CRM data and ${state} acquisition workflow`, async () => {
  const h = harness();
  const client = { id: 'client', nombre: 'Staff Name', telefono_normalizado: '34600000001', origen: 'manual', lead_status: 'contactado', lead_contacted_at: '2026-10-01', minutos_free_pendientes: 10 };
  const captacion = { id: 'cap', cliente_id: 'client', estado: state, intento_actual: 3, next_contact_at: '2026-11-01', closed_at: '2026-10-01', assigned_to: 'worker', origen: 'manual' };
  h.tables.crm_clientes.push(copy(client)); h.tables.captacion_leads.push(copy(captacion));
  await h.api.processExpandedMetaLead({ ...lead(), campaign_name: 'New campaign' });
  assert.deepEqual(h.tables.crm_clientes[0], client);
  assert.equal(h.tables.captacion_leads.length, 1);
  for (const [key,value] of Object.entries(captacion)) assert.equal(h.tables.captacion_leads[0][key], value);
  assert.equal(h.tables.captacion_leads[0].campaign_name, 'New campaign');
});

test('CRM read failure is not treated as a missing contact', async () => {
  const h = harness(); h.failures.push({ table: 'crm_clientes', mode: 'read', error: { code: '57014' } });
  await assert.rejects(h.api.processExpandedMetaLead(lead()), /MANUAL_RECONCILIATION/);
  assert.equal(h.tables.crm_clientes.length, 0);
  assert.equal(h.calls.filter(c => c.table === 'crm_clientes' && c.mode === 'insert').length, 0);
});

test('Captacion read failure does not attempt a blind second acquisition insert', async () => {
  const h = harness(); h.failures.push({ table: 'captacion_leads', mode: 'read', error: { code: '57014' } });
  await assert.rejects(h.api.processExpandedMetaLead(lead()), /MANUAL_RECONCILIATION/);
  assert.equal(h.calls.filter(c => c.table === 'captacion_leads' && c.mode === 'insert').length, 0);
  await assert.rejects(h.api.processExpandedMetaLead(lead()), /MANUAL_RECONCILIATION/);
  assert.equal(h.tables.crm_client_notes.length, 1);
});

test('Ambiguous CRM commit is not retried with a fallback INSERT and requires manual recovery', async () => {
  const h = harness(); h.failures.push({ table: 'crm_clientes', mode: 'insert', afterCommit: true, error: { message: 'network response lost' } });
  await assert.rejects(h.api.processExpandedMetaLead(lead()), /MANUAL_RECONCILIATION/);
  await assert.rejects(h.api.processExpandedMetaLead(lead()), /MANUAL_RECONCILIATION/);
  assert.equal(h.tables.crm_clientes.length, 1);
  assert.equal(h.calls.filter(c => c.table === 'crm_clientes' && c.mode === 'insert').length, 1);
});

test('A proven Graph failure can be retried once with an increased attempt count', async () => {
  const h = harness(); h.fetch = async () => new Response(JSON.stringify({ error: { message: 'private provider detail' } }), { status: 503 });
  await assert.rejects(h.api.processMetaLeadById('101'), /META_GRAPH_HTTP_503/);
  assert.match(h.tables.meta_lead_events[0].last_error, /^RETRYABLE_PRE_INGEST_V1:/);
  assert.equal(h.tables.crm_clientes.length, 0);
  h.fetch = async () => new Response(JSON.stringify(lead()));
  await h.api.processMetaLeadById('101');
  assert.equal(h.tables.meta_lead_events[0].attempt_count, 2);
  assert.equal(h.tables.crm_client_notes.length, 1);
  assert.ok(!JSON.stringify(h.logs).includes('private provider detail'));
});

test('Concurrent retry claims use compare-and-swap; only one caller owns ingestion', async () => {
  const h = harness(); h.tables.meta_lead_events.push({ id: 'event', leadgen_id: '101', status: 'failed', updated_at: '2026-10-10', attempt_count: 1, last_error: 'RETRYABLE_PRE_INGEST_V1:META_GRAPH_TIMEOUT' });
  const results = await Promise.allSettled([h.api.claimMetaLeadEvent('101'), h.api.claimMetaLeadEvent('101')]);
  assert.equal(results.filter(r => r.status === 'fulfilled' && r.value.claimed).length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.equal(h.tables.meta_lead_events[0].attempt_count, 2);
});

for (const state of ['failed', 'fetching', 'received', 'processed']) test(`Legacy or incomplete ${state} event is not falsely acknowledged or automatically ingested`, async () => {
  const h = harness(); h.tables.meta_lead_events.push({ id: 'event', leadgen_id: '101', status: state, updated_at: '2026-10-01', last_error: 'legacy error' });
  await assert.rejects(h.api.processMetaLeadById('101'), /MANUAL_RECONCILIATION/);
  assert.equal(h.requests.length, 0); assert.equal(h.tables.crm_client_notes.length, 0);
});

test('A recent in-flight event asks for retry rather than claiming success', async () => {
  const h = harness(); h.tables.meta_lead_events.push({ id: 'event', leadgen_id: '101', status: 'fetching', updated_at: new Date().toISOString() });
  await assert.rejects(h.api.processExpandedMetaLead(lead()), /META_LEAD_IN_PROGRESS/);
});

test('Graph requests use configured version, fixed host, auth header and timeout signal', async () => {
  const h = harness(); await h.api.fetchMetaLeadById('101');
  const req = h.requests[0];
  assert.ok(req.url.startsWith('https://graph.facebook.com/v25.0/101?'));
  assert.ok(!req.url.includes('test-private-token'));
  assert.equal(req.options.headers.Authorization, 'Bearer test-private-token');
  assert.ok(req.options.signal instanceof AbortSignal);
  await assert.rejects(h.api.fetchMetaLeadById('../evil'), /META_INVALID_RESOURCE/);
  assert.equal(h.requests.length, 1);
});

test('Single-lead and form-lead queries only request supported Lead fields', async () => {
  const h = harness();
  await h.api.fetchMetaLeadById('101');
  h.fetch = async () => new Response(JSON.stringify({ data: [] }));
  assert.equal((await h.sync()).status, 200);
  assert.equal(h.requests.length, 2);
  const supportedLeadFields = new Set([
    'id', 'created_time', 'field_data', 'campaign_id', 'campaign_name',
    'ad_id', 'ad_name', 'form_id', 'is_organic', 'platform',
  ]);
  for (const request of h.requests) {
    const fields = new URL(request.url).searchParams.get('fields').split(',');
    assert.ok(fields.includes('field_data'));
    assert.ok(fields.includes('form_id'));
    assert.ok(fields.includes('campaign_name'));
    assert.ok(!fields.includes('form_name'), 'Form name must be fetched from the form node, not Lead');
    assert.ok(fields.every(field => supportedLeadFields.has(field)));
  }
});

test('Timeouts are sanitized and malformed lead payloads never reach CRM', async () => {
  const h = harness(); h.fetch = async () => { const e = new Error('secret URL'); e.name = 'TimeoutError'; throw e; };
  await assert.rejects(h.api.processMetaLeadById('101'), /META_GRAPH_TIMEOUT/);
  h.fetch = async () => new Response(JSON.stringify({ id: '101', field_data: [] }));
  await assert.rejects(h.api.processMetaLeadById('101'), /META_LEAD_PAYLOAD_INVALID/);
  assert.equal(h.tables.crm_clientes.length, 0);
});

test('Reconciliation is authorized and fails clearly when configuration is missing', async () => {
  const h = harness(); const unauthorized = await h.loadSync().GET(new Request('https://test/api/sync/meta-leads'));
  assert.equal(unauthorized.status, 401);
  delete h.env.META_FORM_IDS; delete h.env.META_ACCESS_TOKEN;
  const response = await h.sync(); assert.equal(response.status, 503);
  assert.deepEqual((await response.json()).missing, ['META_FORM_IDS','META_ACCESS_TOKEN']);
  assert.equal(h.requests.length, 0);
});

test('Reconciliation follows only opaque cursors, never arbitrary next URLs; old records do not stop later pages', async () => {
  const h = harness(); const processed = [];
  h.fetch = async () => new Response(JSON.stringify(h.requests.length === 1
    ? { data: [lead('201','2020-01-01T00:00:00Z')], paging: { next: 'https://evil.test/?token=secret', cursors: { after: 'opaque cursor' } } }
    : { data: [lead('202')] }));
  const response = await h.sync({ processExpandedMetaLead: async value => { processed.push(value.id); return { duplicate: false }; } });
  assert.equal(response.status, 200); assert.deepEqual(processed, ['202']);
  assert.equal(new URL(h.requests[1].url).hostname, 'graph.facebook.com');
  assert.equal(new URL(h.requests[1].url).searchParams.get('after'), 'opaque cursor');
  assert.equal((await response.json()).outsideWindow, 1);
});

test('Page limit is an explicit incomplete backlog, never a healthy reconciliation', async () => {
  const h = harness(); h.fetch = async () => new Response(JSON.stringify({ data: [], paging: { next: 'unused', cursors: { after: `cursor-${h.requests.length}` } } }));
  const response = await h.sync(); const body = await response.json();
  assert.equal(h.requests.length, 3); assert.equal(response.status, 503);
  assert.equal(body.truncated, true); assert.equal(body.backlog, 'BOUNDED_SCAN_INCOMPLETE');
});

test('Lead-level partial failures make the reconciliation fail and report manual review', async () => {
  const h = harness(); h.fetch = async () => new Response(JSON.stringify({ data: [lead()] }));
  const response = await h.sync({ processExpandedMetaLead: async () => { throw new h.api.MetaLeadError('META_MANUAL_RECONCILIATION_REQUIRED'); } });
  const body = await response.json(); assert.equal(response.status, 503); assert.equal(body.ok, false); assert.equal(body.manualReview, 1);
});

test('Missing/repeating cursors fail honestly without looping', async () => {
  const h = harness(); h.fetch = async () => new Response(JSON.stringify({ data: [], paging: { next: 'unused', cursors: { after: 'repeated' } } }));
  const response = await h.sync(); assert.equal(response.status, 503); assert.equal(h.requests.length, 2);
  assert.equal((await response.json()).errors[0].error, 'META_GRAPH_CURSOR_INVALID');
});

test('Webhook authentication remains enforced and partial failures are not success duplicates', async () => {
  const h = harness(); const handler = h.loadWebhook({ processExpandedMetaLead: async () => { throw new h.api.MetaLeadError('META_MANUAL_RECONCILIATION_REQUIRED'); } });
  const request = token => new Request('https://test/api/webhooks/meta-leads', { method: 'POST', headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(lead()) });
  assert.equal((await handler.POST(request('wrong'))).status, 401);
  const response = await handler.POST(request('internal')); assert.equal(response.status, 503);
  assert.equal((await response.json()).error, 'META_MANUAL_RECONCILIATION_REQUIRED');
});

test('A manual-recovery event cannot starve subsequent leads in the same native webhook batch', async () => {
  const h = harness(); const processed = [];
  const handler = h.loadWebhook({ processMetaLeadById: async id => {
    processed.push(id);
    if (id === '101') throw new h.api.MetaLeadError('META_MANUAL_RECONCILIATION_REQUIRED');
    return { duplicate: false };
  }});
  const body = JSON.stringify({ object: 'page', entry: [{ id: '900', changes: ['101','102'].map(id => ({ field: 'leadgen', value: { leadgen_id: id } })) }] });
  const signature = 'sha256=' + require('node:crypto').createHmac('sha256', h.env.META_APP_SECRET).update(body).digest('hex');
  const response = await handler.POST(new Request('https://test/api/webhooks/meta-leads', { method: 'POST', headers: { 'x-hub-signature-256': signature }, body }));
  const result = await response.json();
  assert.deepEqual(processed, ['101','102']);
  assert.equal(response.status, 503); assert.equal(result.ok, false);
  assert.equal(result.failed, 1); assert.equal(result.processed, 1);
  assert.equal(result.failures.META_MANUAL_RECONCILIATION_REQUIRED, 1);
  assert.ok(!JSON.stringify(result).includes('101'));
});

test('Shared Page callback authenticates before Facebook processing and preserves lead delivery', async () => {
  const h = harness(); let facebookCalls = 0, leadCalls = 0;
  const handler = h.loadWebhook({ processMetaLeadById: async () => { leadCalls++; return { duplicate: false }; } }, async () => { facebookCalls++; throw Error('database unavailable'); });
  const body = JSON.stringify({ object: 'page', entry: [{ id: '900', changes: [{ field: 'leadgen', value: { leadgen_id: '101' } }, { field: 'feed', value: { item: 'comment' } }] }] });
  const request = signature => new Request('https://test/api/webhooks/meta-leads', { method: 'POST', headers: { 'x-hub-signature-256': signature }, body });
  assert.equal((await handler.POST(request('sha256=invalid'))).status, 401);
  assert.equal(facebookCalls, 0); assert.equal(leadCalls, 0);
  const signature = 'sha256=' + require('node:crypto').createHmac('sha256', h.env.META_APP_SECRET).update(body).digest('hex');
  const response = await handler.POST(request(signature));
  const result = await response.json();
  assert.equal(leadCalls, 1); assert.equal(facebookCalls, 1);
  assert.equal(response.status, 503); assert.equal(result.processed, 1);
  assert.equal(result.failures.FACEBOOK_INBOX_UNAVAILABLE, 1);
  assert.ok(!JSON.stringify(result).includes('database unavailable'));
});

test('Facebook still ingests a mixed delivery when a lead needs recovery', async () => {
  const h = harness(); let facebookCalls = 0;
  const handler = h.loadWebhook({ processMetaLeadById: async () => { throw new h.api.MetaLeadError('META_MANUAL_RECONCILIATION_REQUIRED'); } }, async () => { facebookCalls++; return { received: 1 }; });
  const body = JSON.stringify({ object: 'page', entry: [{ id: '900', changes: [{ field: 'leadgen', value: { leadgen_id: '101' } }] }] });
  const signature = 'sha256=' + require('node:crypto').createHmac('sha256', h.env.META_APP_SECRET).update(body).digest('hex');
  const response = await handler.POST(new Request('https://test/api/webhooks/meta-leads', { method: 'POST', headers: { 'x-hub-signature-256': signature }, body }));
  assert.equal(facebookCalls, 1); assert.equal((await response.json()).facebookReceived, 1);
  assert.equal(response.status, 503);
});
