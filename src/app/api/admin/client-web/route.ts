import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { loadEffectiveRanksBatch, loadRecentRankTotals, type RankAdminClient } from "@/lib/server/client-rank-admin-data";
import { getOracleCreditBalance } from "@/lib/server/oracle-premium";
import { buildClienteAliasEmail, ensureClienteAuthUser, normalizePhoneDigits } from "@/lib/server/cliente-auth-password";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AuthSummary = {
  id: string;
  email: string | null;
  created_at: string | null;
  last_sign_in_at: string | null;
  banned_until: string | null;
  user_metadata?: Record<string, unknown> | null;
};

function cleanSearch(value: string) {
  return value.trim().toLowerCase();
}

function fullName(row: any) {
  return [row?.nombre, row?.apellido].filter(Boolean).join(" ").trim() || "Sin nombre";
}

function businessValue(row: any) {
  return String(row?.origen || row?.negocio || row?.business || "celestial").trim().toLowerCase();
}

function isBlocked(user: AuthSummary | null) {
  if (!user?.banned_until) return false;
  const time = new Date(user.banned_until).getTime();
  return Number.isFinite(time) && time > Date.now();
}

function publicAuthUser(user: any): AuthSummary {
  return {
    id: String(user?.id || ""),
    email: user?.email || null,
    created_at: user?.created_at || null,
    last_sign_in_at: user?.last_sign_in_at || null,
    banned_until: user?.banned_until || null,
    user_metadata: user?.user_metadata || null,
  };
}

async function listAllAuthUsers(admin: any) {
  const users: AuthSummary[] = [];
  let page = 1;
  const perPage = 200;
  while (page <= 50) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const batch = (data?.users || []).map(publicAuthUser);
    users.push(...batch);
    if (batch.length < perPage) break;
    page += 1;
  }
  return users;
}

async function loadClients(admin: any) {
  const rows: any[] = [];
  const chunk = 500;
  let from = 0;

  // No aplicar un máximo fijo: el CRM contiene más de 5.000 registros y
  // los clientes antiguos también deben poder administrarse desde Clientes web.
  while (true) {
    const { data, error } = await admin
      .from("crm_clientes")
      .select("id,nombre,apellido,email,telefono,telefono_normalizado,origen,created_at,updated_at,auth_user_id,puntos,minutos_free_pendientes,minutos_normales_pendientes,ultimo_acceso_at,ultima_actividad_at,total_accesos")
      .order("created_at", { ascending: false })
      .range(from, from + chunk - 1);
    if (error) throw error;
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < chunk) break;
    from += chunk;
  }
  return rows;
}

function authEmailKey(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function authPhoneKey(value: unknown) {
  return normalizePhoneDigits(String(value || ""));
}

async function writeAudit(admin: any, worker: any, clientId: string, authUserId: string, action: string, payload: Record<string, unknown>) {
  const { error } = await admin.from("crm_audit_logs").insert({
    cliente_id: clientId,
    worker_id: worker.id,
    action_type: action,
    entity_type: "auth.users",
    entity_id: authUserId,
    payload,
  });
  if (error) console.error("[client-web:audit]", { code: error.code, message: error.message, details: error.details, hint: error.hint });
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.error === "FORBIDDEN" ? 403 : 401 });

    const url = new URL(req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") || 1));
    const pageSize = Math.min(50, Math.max(10, Number(url.searchParams.get("page_size") || 20)));
    const q = cleanSearch(url.searchParams.get("q") || "");
    const rankFilter = cleanSearch(url.searchParams.get("rank") || "all");
    const accountFilter = cleanSearch(url.searchParams.get("account") || "all");
    const accessFilter = cleanSearch(url.searchParams.get("access") || "web");

    const [clients, authUsers] = await Promise.all([loadClients(gate.admin), listAllAuthUsers(gate.admin)]);
    const authById = new Map(authUsers.map((user) => [user.id, user]));
    const authByClientId = new Map<string, AuthSummary>();
    const authByEmail = new Map<string, AuthSummary>();
    const authByPhone = new Map<string, AuthSummary>();
    for (const user of authUsers) {
      const metadata = (user.user_metadata || {}) as Record<string, unknown>;
      const clientId = String(metadata.crm_cliente_id || "").trim();
      const emailKey = authEmailKey(user.email);
      const phoneKey = authPhoneKey(metadata.telefono_normalizado || metadata.telefono || metadata.phone);
      if (clientId && !authByClientId.has(clientId)) authByClientId.set(clientId, user);
      if (emailKey && !authByEmail.has(emailKey)) authByEmail.set(emailKey, user);
      if (phoneKey && !authByPhone.has(phoneKey)) authByPhone.set(phoneKey, user);
    }

    const linked = clients.map((client: any) => {
      const byId = client.auth_user_id ? authById.get(String(client.auth_user_id)) || null : null;
      const byClientId = authByClientId.get(String(client.id)) || null;
      const realEmail = authByEmail.get(authEmailKey(client.email)) || null;
      const phone = authPhoneKey(client.telefono_normalizado || client.telefono);
      let aliasEmail = "";
      try { aliasEmail = phone ? buildClienteAliasEmail(phone) : ""; } catch { aliasEmail = ""; }
      const byAlias = aliasEmail ? authByEmail.get(authEmailKey(aliasEmail)) || null : null;
      const byPhone = phone ? authByPhone.get(phone) || null : null;
      const auth = byId || byClientId || realEmail || byAlias || byPhone || null;
      return { client, auth };
    });

    const filteredByIdentity = linked.filter(({ client, auth }) => {
      const hasWeb = Boolean(auth);
      const blocked = isBlocked(auth);
      if (accessFilter === "web" && !hasWeb) return false;
      if (accessFilter === "without" && hasWeb) return false;
      if (accountFilter === "active" && (!hasWeb || blocked)) return false;
      if (accountFilter === "blocked" && (!hasWeb || !blocked)) return false;
      if (q) {
        const haystack = [fullName(client), client.email, client.telefono, auth?.email].map((v) => String(v || "").toLowerCase()).join(" ");
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    const rankClients: RankAdminClient[] = filteredByIdentity.map(({ client }) => ({
      id: String(client.id),
      nombre: client.nombre || null,
      apellido: client.apellido || null,
      telefono: client.telefono || null,
      email: client.email || null,
      origen: client.origen || null,
      created_at: client.created_at || null,
    }));
    const now = new Date();
    const since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const totals = await loadRecentRankTotals(gate.admin, rankClients, since.toISOString(), now.toISOString());
    const ranks = await loadEffectiveRanksBatch(gate.admin, rankClients, totals);

    const ranked = filteredByIdentity.filter(({ client }) => {
      if (rankFilter === "all") return true;
      return String(ranks.get(String(client.id))?.effective || "").toLowerCase() === rankFilter;
    });

    const total = ranked.length;
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    const safePage = Math.min(page, totalPages);
    const pageRows = ranked.slice((safePage - 1) * pageSize, safePage * pageSize);

    const todayMadrid = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const pageClientIds = pageRows.map(({ client }) => String(client.id));
    const freeUsed = new Set<string>();
    if (pageClientIds.length) {
      const { data: freeRows, error: freeError } = await gate.admin
        .from("cliente_oraculo_diario")
        .select("cliente_id")
        .in("cliente_id", pageClientIds)
        .eq("fecha", todayMadrid)
        .eq("is_free", true);
      if (freeError && freeError.code !== "42P01") throw freeError;
      for (const row of freeRows || []) freeUsed.add(String(row.cliente_id || ""));
    }

    const rows = await Promise.all(pageRows.map(async ({ client, auth }) => {
      const rankState = ranks.get(String(client.id));
      const creditBalance = auth ? await getOracleCreditBalance(gate.admin, String(client.id)).catch(() => 0) : 0;
      const blocked = isBlocked(auth);
      const freeMinutes = Math.max(0, Number(client.minutos_free_pendientes || 0));
      const normalMinutes = Math.max(0, Number(client.minutos_normales_pendientes || 0));
      return {
        id: String(client.id),
        name: fullName(client),
        email: client.email || null,
        auth_email: auth?.email || null,
        phone: client.telefono || null,
        business: businessValue(client),
        web_access: Boolean(auth),
        auth_user_id: auth?.id || null,
        account_status: !auth ? "no_access" : blocked ? "blocked" : "active",
        blocked_until: blocked ? auth?.banned_until || null : null,
        created_at: auth?.created_at || client.created_at || null,
        crm_created_at: client.created_at || null,
        last_sign_in_at: auth?.last_sign_in_at || client.ultimo_acceso_at || null,
        last_activity_at: client.ultima_actividad_at || null,
        total_accesses: Math.max(0, Number(client.total_accesos || 0)),
        automatic_rank: rankState?.automatic || null,
        effective_rank: rankState?.effective || null,
        rank_override: rankState?.override || null,
        coins: Math.max(0, Number(client.puntos || 0)),
        minutes_free: freeMinutes,
        minutes_normal: normalMinutes,
        minutes_total: freeMinutes + normalMinutes,
        oracle_credits: creditBalance + (freeUsed.has(String(client.id)) ? 0 : 1),
        oracle_premium_credits: creditBalance,
        oracle_free_today: freeUsed.has(String(client.id)) ? 0 : 1,
      };
    }));

    return NextResponse.json({
      ok: true,
      rows,
      pagination: { page: safePage, page_size: pageSize, total, total_pages: totalPages },
      totals: {
        web: linked.filter(({ auth }) => Boolean(auth)).length,
        active: linked.filter(({ auth }) => Boolean(auth) && !isBlocked(auth)).length,
        blocked: linked.filter(({ auth }) => Boolean(auth) && isBlocked(auth)).length,
        without_access: linked.filter(({ auth }) => !auth).length,
      },
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    console.error("[client-web:get]", { code: error?.code, message: error?.message, details: error?.details, hint: error?.hint });
    return NextResponse.json({ ok: false, error: error?.message || "ERR_CLIENT_WEB" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.error === "FORBIDDEN" ? 403 : 401 });

    const body = await req.json();
    const clientId = String(body.client_id || "").trim();
    const action = String(body.action || "").trim().toLowerCase();
    if (!clientId) return NextResponse.json({ ok: false, error: "CLIENT_REQUIRED" }, { status: 400 });

    const { data: client, error: clientError } = await gate.admin
      .from("crm_clientes")
      .select("id,nombre,apellido,email,telefono,auth_user_id")
      .eq("id", clientId)
      .maybeSingle();
    if (clientError) throw clientError;
    if (!client) return NextResponse.json({ ok: false, error: "CLIENT_NOT_FOUND" }, { status: 404 });

    if (action === "create_access") {
      const password = String(body.password || "");
      const confirm = String(body.confirm || "");
      if (password.length < 8) return NextResponse.json({ ok: false, error: "La contraseña debe tener al menos 8 caracteres." }, { status: 400 });
      if (password !== confirm) return NextResponse.json({ ok: false, error: "Las contraseñas no coinciden." }, { status: 400 });
      if (!client.telefono) return NextResponse.json({ ok: false, error: "La clienta necesita un teléfono para crear el acceso web." }, { status: 400 });

      const linked = await ensureClienteAuthUser({ phone: String(client.telefono), password });
      await writeAudit(gate.admin, gate.me, clientId, linked.auth_user_id, "admin_cliente_web_crear_acceso", { created: linked.created });
      return NextResponse.json({ ok: true, auth_user_id: linked.auth_user_id, created: linked.created });
    }

    let authUserId = String(client.auth_user_id || "").trim();
    if (!authUserId) {
      const users = await listAllAuthUsers(gate.admin);
      const normalizedPhone = authPhoneKey(client.telefono);
      let aliasEmail = "";
      try { aliasEmail = normalizedPhone ? buildClienteAliasEmail(normalizedPhone) : ""; } catch { aliasEmail = ""; }
      const match = users.find((user) => {
        const metadata = (user.user_metadata || {}) as Record<string, unknown>;
        return String(metadata.crm_cliente_id || "") === clientId
          || (client.email && authEmailKey(user.email) === authEmailKey(client.email))
          || (aliasEmail && authEmailKey(user.email) === authEmailKey(aliasEmail))
          || (normalizedPhone && authPhoneKey(metadata.telefono_normalizado || metadata.telefono || metadata.phone) === normalizedPhone);
      });
      authUserId = match?.id || "";
      if (authUserId) {
        const { error: linkError } = await gate.admin.from("crm_clientes").update({ auth_user_id: authUserId }).eq("id", clientId);
        if (linkError) throw linkError;
      }
    }
    if (!authUserId) return NextResponse.json({ ok: false, error: "CLIENT_WITHOUT_WEB_ACCESS" }, { status: 400 });

    const { data: authData, error: authError } = await gate.admin.auth.admin.getUserById(authUserId);
    if (authError) throw authError;
    if (!authData.user) return NextResponse.json({ ok: false, error: "AUTH_USER_NOT_FOUND" }, { status: 404 });

    if (action === "password") {
      const password = String(body.password || "");
      const confirm = String(body.confirm || "");
      if (password.length < 8) return NextResponse.json({ ok: false, error: "La contraseña debe tener al menos 8 caracteres." }, { status: 400 });
      if (password !== confirm) return NextResponse.json({ ok: false, error: "Las contraseñas no coinciden." }, { status: 400 });
      const { error } = await gate.admin.auth.admin.updateUserById(authUserId, { password });
      if (error) throw error;
      await writeAudit(gate.admin, gate.me, clientId, authUserId, "admin_cliente_web_password", { changed: true });
      return NextResponse.json({ ok: true });
    }

    if (action === "block") {
      const mode = String(body.mode || "indefinite");
      const reason = String(body.reason || "").trim();
      let banDuration = "876000h";
      let requestedUntil: string | null = null;
      if (mode === "temporary") {
        const until = new Date(String(body.until || ""));
        if (!Number.isFinite(until.getTime()) || until.getTime() <= Date.now()) {
          return NextResponse.json({ ok: false, error: "Selecciona una fecha de desbloqueo futura." }, { status: 400 });
        }
        requestedUntil = until.toISOString();
        const seconds = Math.max(60, Math.ceil((until.getTime() - Date.now()) / 1000));
        banDuration = `${seconds}s`;
      }
      const { error } = await gate.admin.auth.admin.updateUserById(authUserId, { ban_duration: banDuration });
      if (error) throw error;
      await writeAudit(gate.admin, gate.me, clientId, authUserId, "admin_cliente_web_bloqueo", { mode, reason: reason || null, until: requestedUntil });
      return NextResponse.json({ ok: true });
    }

    if (action === "unblock") {
      const { error } = await gate.admin.auth.admin.updateUserById(authUserId, { ban_duration: "none" });
      if (error) throw error;
      await writeAudit(gate.admin, gate.me, clientId, authUserId, "admin_cliente_web_desbloqueo", {});
      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "INVALID_ACTION" }, { status: 400 });
  } catch (error: any) {
    console.error("[client-web:post]", { code: error?.code, message: error?.message, details: error?.details, hint: error?.hint });
    return NextResponse.json({ ok: false, error: error?.message || "ERR_CLIENT_WEB_ACTION" }, { status: 500 });
  }
}
