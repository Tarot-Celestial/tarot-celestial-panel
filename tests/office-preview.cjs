/** Loopback preview of the real Office handlers, with synthetic Auth and disposable PostgreSQL. */
const fs = require('node:fs');
const path = require('node:path');
const { startAccountingQA, SESSION_ID, USER_ID, WORKER_ID } = require('./accounting-qa-server.cjs');

const extraRPC = ['office_snapshot', 'office_apply', 'office_file'];

async function setupDatabase(db) {
  await db.exec('create table public.workers(id uuid primary key,user_id uuid,display_name text,is_active boolean); grant select on public.workers to service_role;');
  await db.query('insert into public.workers values($1,$2,$3,true)', [WORKER_ID, USER_ID, 'Álex de prueba']);
  await db.exec(fs.readFileSync(path.join(__dirname, '../supabase/migrations/20261122185744_office_celestial_workspace.sql'), 'utf8'));
}

function panelFixtureResponse(pathname, { user, worker }) {
  if (pathname === '/api/me') return { ok: true, role: 'admin', can_admin: true, display_name: 'Álex de prueba', user, worker };
  if (pathname.startsWith('/api/attendance/')) {
    const now = new Date().toISOString();
    return { ok: true, online: true, status: 'working', worker, session_id: SESSION_ID, session_started_at: now, last_activity_at: now, expires_at: new Date(Date.now() + 3600000).toISOString(), server_now: now };
  }
  if (pathname === '/api/chat/threads') return { ok: true, me: worker, contacts: [], threads: [], presence_checked_at: new Date().toISOString() };
  if (/^\/api\/(?:central\/attendance|asterisk|notifications|chat|central\/assistant)(?:\/|$)/.test(pathname)) {
    return { ok: true, rows: [], items: [], data: [], messages: [], conversations: [], threads: [], workers: [], calls: [], unread: 0 };
  }
  return null;
}

function handleFixtureRequest(req, res, context) {
  const { appOrigin, dbOrigin, token, user } = context;
  const origin = new URL(appOrigin);
  if (req.headers.host !== origin.host) {
    res.writeHead(403).end();
    return true;
  }
  const { pathname } = new URL(req.url, appOrigin);
  res.setHeader('Content-Security-Policy', `connect-src 'self' ${dbOrigin} ${dbOrigin.replace('http:', 'ws:')} ws://${origin.host}; form-action 'self'; frame-ancestors 'none'`);
  if (pathname === '/vista-previa' || pathname === '/vista-previa/entrar') {
    if (req.method !== 'GET') { res.writeHead(405, { allow: 'GET' }).end(); return true; }
    res.setHeader('cache-control', 'no-store');
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (pathname.endsWith('/entrar')) {
      const session = { access_token: token, refresh_token: 'local-fixture', token_type: 'bearer', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user };
      res.setHeader('set-cookie', 'celestial_office_preview=1; Path=/; SameSite=Strict; HttpOnly');
      res.end(`<!doctype html><html lang="es"><meta charset="utf-8"><title>Acceso a la Oficina de prueba</title><script>localStorage.setItem('sb-127-auth-token', ${JSON.stringify(JSON.stringify(session)).replace(/</g, '\\u003c')});location.replace('/admin/oficina');</script><noscript>Activa JavaScript para abrir la Oficina Celestial.</noscript></html>`);
    } else {
      res.end(`<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Vista previa · Oficina Celestial</title><style>*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0c0f1d;color:#f3eefb;font:16px/1.6 system-ui,sans-serif}main{width:min(100%,560px);padding:30px}img{width:72px;height:72px;object-fit:contain}h1{line-height:1.16;font:normal clamp(36px,7vw,54px) Georgia,serif;margin:8px 0 14px}p{color:#cac5d8}small{color:#e5c78d;font-weight:700}a{display:inline-block;padding:10px 19px;border-radius:8px;background:#efcf96;color:#201822;font-weight:750;text-decoration:none;margin-top:8px}a:focus-visible{outline:3px solid white;outline-offset:3px}</style><main><img src="/tarot-celestial-logo.png" alt="Tarot Celestial"><p><small>Vista previa local</small></p><h1>Oficina Celestial</h1><p>Entrarás con una identidad de administración de prueba. Puedes recorrer los departamentos, crear encargos y revisar entregables. Tus cambios de prueba se conservarán mientras este servidor esté en marcha.</p><a href="/vista-previa/entrar">Entrar en la Oficina</a></main></html>`);
    }
    return true;
  }
  if (pathname === '/admin/oficina' && req.method === 'GET' && !/(?:^|;\s*)celestial_office_preview=1(?:;|$)/.test(req.headers.cookie || '')) {
    res.writeHead(302, { location: '/vista-previa', 'cache-control': 'no-store' }).end();
    return true;
  }
  if (!pathname.startsWith('/api/') || /^\/api\/admin\/(?:oficina|contabilidad)(?:\/|$)/.test(pathname)) return false;
  const body = panelFixtureResponse(pathname, context);
  res.writeHead(body ? 200 : 404, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body || { ok: false, error: 'Fuera del alcance de la vista previa' }));
  return true;
}

if (require.main === module) {
  startAccountingQA({ appPort: 3078, dbPort: 54358, extraRPC, setupDatabase, handleFixtureRequest })
    .then(qa => console.log(`Vista previa de Oficina Celestial: ${qa.appOrigin}/vista-previa`))
    .catch(error => { console.error(error.message); process.exit(1); });
}

module.exports = { extraRPC, setupDatabase, panelFixtureResponse };
