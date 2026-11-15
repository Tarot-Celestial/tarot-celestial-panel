/** LOCAL ONLY: real Next handlers and ledger SQL, synthetic Auth/PostgREST transport. */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

const USER_ID = '95000000-0000-4000-8000-000000000001';
const WORKER_ID = '95000000-0000-4000-8000-000000000002';
const SESSION_ID = '95000000-0000-4000-8000-000000000010';
const PASSWORD = 'Local-QA-Only-Do-Not-Deploy!';
const ANON_KEY = 'synthetic-anon-key-local-qa-only';
const SERVICE_KEY = 'synthetic-service-key-local-qa-only';
const user = { id: USER_ID, aud: 'authenticated', role: 'authenticated', email: 'qa-admin@example.invalid', email_confirmed_at: new Date().toISOString(), app_metadata: { provider: 'email' }, user_metadata: {}, created_at: new Date().toISOString() };
const worker = { id: WORKER_ID, user_id: USER_ID, role: 'admin', email: user.email, display_name: 'Alex', team: null, is_active: true };
const token = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'), Buffer.from(JSON.stringify({ sub: USER_ID, aud: 'authenticated', role: 'authenticated', email: user.email, session_id: SESSION_ID, iat: Math.floor(Date.now()/1000), exp: Math.floor(Date.now()/1000)+86400 })).toString('base64url'), 'synthetic-local-signature'].join('.');
const allowedRPC = new Set(['tc_has_admin_access', 'tc_accounting_reserve_login_attempt', 'tc_accounting_open_session', 'tc_accounting_read_session', 'tc_accounting_close_session', 'accounting_snapshot', 'accounting_post_entry', 'accounting_void_entry', 'accounting_upsert_option']);

async function startAccountingQA({ appPort = 3055, dbPort = 54339 } = {}) {
  const repo = path.resolve(__dirname, '..');
  // NextURL normalizes loopback IPs to localhost, so Origin must use that host.
  const appOrigin = `http://localhost:${appPort}`;
  const dbOrigin = `http://127.0.0.1:${dbPort}`;
  const db = new PGlite();
  const calls = [];
  const blocked = [];
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);
    insert into auth.sessions values('${SESSION_ID}','${USER_ID}',null);
    create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
    create table public.test_admins(user_id uuid primary key,active boolean not null);
    insert into public.test_admins values('${USER_ID}',true);
    create function public.tc_has_admin_access(p_user_id uuid) returns boolean language sql stable as $$ select exists(select 1 from public.test_admins where user_id=p_user_id and active) $$;
    grant usage on schema public to service_role,anon,authenticated;
    grant select on public.test_admins to service_role;`);
  await db.exec(fs.readFileSync(path.join(repo, 'scripts/accounting-access-schema.sql'), 'utf8'));
  await db.exec(fs.readFileSync(path.join(repo, 'supabase/accounting-ledger.sql'), 'utf8'));
  await db.exec('set role service_role');
  const send = (res, status, body, extra = {}) => { res.writeHead(status, { 'content-type': 'application/json', 'access-control-allow-origin': appOrigin, 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET, POST, HEAD, OPTIONS', ...extra }); res.end(JSON.stringify(body)); };
  const dbServer = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, dbOrigin);
      if (req.method === 'OPTIONS') return send(res, 200, {});
      if (url.pathname === '/auth/v1/user') return req.headers.authorization === `Bearer ${token}` ? send(res, 200, user) : send(res, 401, { code:'bad_jwt',msg:'Invalid synthetic Auth token' });
      if (url.pathname === '/rest/v1/workers') {
        const singleton = String(req.headers.accept || '').includes('object+json');
        return send(res, 200, singleton ? worker : [worker]);
      }
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const name = url.pathname.split('/').at(-1);
        if (!allowedRPC.has(name) || req.method !== 'POST') return send(res, 400, { code: 'QA_UNEXPECTED_RPC', message: name });
        if (req.headers.apikey !== SERVICE_KEY || req.headers.authorization !== `Bearer ${SERVICE_KEY}`) return send(res, 403, { code: '42501', message: 'Server role required' });
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const args = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        const entries = Object.entries(args);
        if (entries.some(([key]) => !/^p_[a-z_]+$/.test(key))) throw new Error('Unsafe test RPC argument name');
        calls.push({ name, at: new Date().toISOString() });
        const query = `select public.${name}(${entries.map(([key], i) => `${key} => $${i+1}`).join(',')}) value`;
        try {
          const result = await db.query(query, entries.map(([, value]) => value && typeof value === 'object' ? JSON.stringify(value) : value));
          return send(res, 200, result.rows[0].value);
        } catch (error) { return send(res, 400, { code: error.code || 'P0001', message: error.message, details: null, hint: null }); }
      }
      if (url.pathname.startsWith('/rest/v1/')) return send(res, 200, [], { 'content-range': '0-0/0' });
      return send(res, 404, { error: 'Not part of local QA fixture' });
    } catch (error) { send(res, 500, { error: error.message }); }
  });
  await new Promise((resolve, reject) => { dbServer.once('error', reject); dbServer.listen(dbPort, '127.0.0.1', resolve); });
  const salt = crypto.randomBytes(16);
  process.env.NEXT_PUBLIC_SUPABASE_URL = dbOrigin;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = SERVICE_KEY;
  process.env.ACCOUNTING_PASSWORD_HASH = `scrypt$${salt.toString('hex')}$${crypto.scryptSync(PASSWORD, salt, 64, { N:16384,r:8,p:1,maxmem:32*1024*1024 }).toString('hex')}`;
  process.env.NEXT_TELEMETRY_DISABLED = '1';
  process.env.NODE_ENV = 'development';
  // Fail closed on accidental server fetches to an actual external service.
  const realFetch = global.fetch;
  global.fetch = (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname)) { blocked.push(url.origin); throw new Error('LOCAL QA blocks all external fetches'); }
    return realFetch(input, init);
  };
  const next = require('next');
  // Use a disposable source copy: Next14 custom servers ignore `conf` overrides.
  // This avoids build/tsconfig races with production builds in the real worktree,
  // and intentionally never copies .env files or a saved browser profile.
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'tarot-accounting-next-'));
  for (const filename of ['src','public','package.json','next.config.js','tsconfig.json','next-env.d.ts','postcss.config.js','tailwind.config.js','tailwind.config.ts']) {
    const source=path.join(repo,filename);if(fs.existsSync(source))fs.cpSync(source,path.join(stage,filename),{recursive:true});
  }
  fs.symlinkSync(path.join(repo,'node_modules'),path.join(stage,'node_modules'),'dir');
  const nextApp = next({ dev: true, hostname: 'localhost', port: appPort, dir: stage });
  await nextApp.prepare();
  const appServer = http.createServer(nextApp.getRequestHandler());
  await new Promise((resolve, reject) => { appServer.once('error', reject); appServer.listen(appPort, 'localhost', resolve); });
  return { appOrigin, dbOrigin, db, calls, blocked, token, user, worker, password: PASSWORD,
    async close() { appServer.closeAllConnections(); await new Promise(resolve => appServer.close(resolve)); await nextApp.close(); dbServer.closeAllConnections(); await new Promise(resolve => dbServer.close(resolve)); await db.close(); global.fetch = realFetch; },
  };
}
module.exports = { startAccountingQA, USER_ID, WORKER_ID, SESSION_ID };
