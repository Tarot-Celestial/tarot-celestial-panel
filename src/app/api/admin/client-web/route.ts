import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { loadEffectiveRanksBatch, loadRecentRankTotals, type RankAdminClient } from "@/lib/server/client-rank-admin-data";
import { getOracleCreditBalance } from "@/lib/server/oracle-premium";
import { buildClienteAliasEmail, ensureClienteAuthUser, normalizePhoneDigits } from "@/lib/server/cliente-auth-password";
import { getClientPushSubscriptions, sendPushToSubscriptions } from "@/lib/server/web-push";

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

const CLIENT_SELECT = "id,nombre,apellido,email,telefono,telefono_normalizado,origen,created_at,updated_at,auth_user_id,puntos,minutos_free_pendientes,minutos_normales_pendientes,ultimo_acceso_at,ultima_actividad_at,total_accesos";
const AUTH_CACHE_TTL_MS = 30_000;
let authUsersCache: { expiresAt: number; users: AuthSummary[] } | null = null;
let authUsersRequest: Promise<AuthSummary[]> | null = null;

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

async function listAllAuthUsers(admin: any, fresh = false) {
  if (!fresh && authUsersCache && authUsersCache.expiresAt > Date.now()) return authUsersCache.users;
  if (!fresh && authUsersRequest) return authUsersRequest;

  authUsersRequest = (async () => {
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
    authUsersCache = { expiresAt: Date.now() + AUTH_CACHE_TTL_MS, users };
    return users;
  })();

  try {
    return await authUsersRequest;
  } finally {
    authUsersRequest = null;
  }
}

function invalidateAuthUsersCache() {
  authUsersCache = null;
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
      .select(CLIENT_SELECT)
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

async function loadWorkerAuthUserIds(admin: any) {
  const { data, error } = await admin.from("workers").select("user_id").not("user_id", "is", null);
  if (error) throw error;
  return new Set<string>((data || []).map((row: any) => String(row.user_id || "")).filter(Boolean));
}

async function loadWebClients(admin: any, authUsers: AuthSummary[], workerAuthUserIds: Set<string>) {
  const authIds = authUsers.map((user) => user.id).filter(Boolean);
  if (!authIds.length) return [];

  // Las coincidencias indirectas solo son válidas para cuentas de clientes.
  // Una cuenta de trabajador puede compartir email con una ficha CRM, pero no
  // debe convertirse automáticamente en acceso al panel de clientes.
  const clientAuthUsers = authUsers.filter((user) => !workerAuthUserIds.has(user.id));
  const metadataClientIds = clientAuthUsers
    .map((user) => String((user.user_metadata || {}).crm_cliente_id || "").trim())
    .filter(Boolean);
  const emails = clientAuthUsers.map((user) => authEmailKey(user.email)).filter(Boolean);
  const phones = Array.from(new Set(clientAuthUsers.flatMap((user) => {
    const metadata = (user.user_metadata || {}) as Record<string, unknown>;
    const digits = authPhoneKey(metadata.telefono_normalizado || metadata.telefono || metadata.phone);
    return digits ? [digits, `+${digits}`] : [];
  })));

  const queries: PromiseLike<{ data: any[] | null; error: any }>[] = [
    admin.from("crm_clientes").select(CLIENT_SELECT).in("auth_user_id", authIds),
  ];
  if (metadataClientIds.length) queries.push(admin.from("crm_clientes").select(CLIENT_SELECT).in("id", metadataClientIds));
  if (emails.length) queries.push(admin.from("crm_clientes").select(CLIENT_SELECT).in("email", emails));
  if (phones.length) {
    queries.push(admin.from("crm_clientes").select(CLIENT_SELECT).in("telefono_normalizado", phones));
    queries.push(admin.from("crm_clientes").select(CLIENT_SELECT).in("telefono", phones));
  }

  const batches = await Promise.all(queries);
  const unique = new Map<string, any>();
  for (const batch of batches) {
    if (batch.error) throw batch.error;
    for (const row of batch.data || []) unique.set(String(row.id), row);
  }
  return Array.from(unique.values()).sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
}

function authEmailKey(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function authPhoneKey(value: unknown) {
  return normalizePhoneDigits(String(value || ""));
}

function isMissingAuthUserError(error: any) {
  const status = Number(error?.status || error?.statusCode || 0);
  const text = String(error?.message || error?.code || "").toLowerCase();
  return status === 404 || text.includes("user not found") || text.includes("user_not_found");
}

function authUserMatchesClient(user: AuthSummary, client: any) {
  const metadata = (user.user_metadata || {}) as Record<string, unknown>;
  const normalizedPhone = authPhoneKey(client.telefono_normalizado || client.telefono);
  let aliasEmail = "";
  try { aliasEmail = normalizedPhone ? buildClienteAliasEmail(normalizedPhone) : ""; } catch { aliasEmail = ""; }
  return String(metadata.crm_cliente_id || "").trim() === String(client.id)
    || Boolean(client.email && authEmailKey(user.email) === authEmailKey(client.email))
    || Boolean(aliasEmail && authEmailKey(user.email) === authEmailKey(aliasEmail))
    || Boolean(normalizedPhone && authPhoneKey(metadata.telefono_normalizado || metadata.telefono || metadata.phone) === normalizedPhone);
}

async function resolveClientAuthUser(admin: any, client: any) {
  const directId = String(client.auth_user_id || "").trim();
  if (directId) {
    const { data, error } = await admin.auth.admin.getUserById(directId);
    if (!error && data?.user) return publicAuthUser(data.user);
    if (error && !isMissingAuthUserError(error)) throw error;
  }

  const [users, workerAuthUserIds] = await Promise.all([
    listAllAuthUsers(admin, true),
    loadWorkerAuthUserIds(admin),
  ]);
  const match = users.find((user) => !workerAuthUserIds.has(user.id) && authUserMatchesClient(user, client)) || null;
  if (match && match.id !== directId) {
    const { error } = await admin.from("crm_clientes").update({ auth_user_id: match.id }).eq("id", client.id);
    if (error) throw error;
  }
  return match;
}

async function writeAudit(admin: any, worker: any, clientId: string, authUserId: string, action: string, payload: Record<string, unknown>) {
  const { error } = await admin.from("crm_audit_logs").insert({
    client_id: clientId,
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

    const [authUsers, workerAuthUserIds, clientCountResult] = await Promise.all([
      listAllAuthUsers(gate.admin),
      loadWorkerAuthUserIds(gate.admin),
      gate.admin.from("crm_clientes").select("id", { count: "exact", head: true }),
    ]);
    if (clientCountResult.error) throw clientCountResult.error;
    const clients = accessFilter === "web"
      ? await loadWebClients(gate.admin, authUsers, workerAuthUserIds)
      : await loadClients(gate.admin);
    const allClientCount = Math.max(0, Number(clientCountResult.count || clients.length));
    const authById = new Map(authUsers.map((user) => [user.id, user]));
    const authByClientId = new Map<string, AuthSummary>();
    const authByEmail = new Map<string, AuthSummary>();
    const authByPhone = new Map<string, AuthSummary>();
    const clientPhoneCounts = new Map<string, number>();
    for (const client of clients) {
      const key = authPhoneKey(client.telefono_normalizado || client.telefono);
      if (key) clientPhoneCounts.set(key, (clientPhoneCounts.get(key) || 0) + 1);
    }
    for (const user of authUsers) {
      if (workerAuthUserIds.has(user.id)) continue;
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
      const phoneIsUnique = Boolean(phone) && clientPhoneCounts.get(phone) === 1;
      const auth = byId || byClientId || realEmail || (phoneIsUnique ? byAlias || byPhone : null) || null;
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

    const coinMovementsByClient = new Map<string, any[]>();
    if (pageClientIds.length) {
      const { data: movements, error: movementsError } = await gate.admin
        .from("cliente_puntos_historial")
        .select("id,cliente_id,tipo,puntos,descripcion,saldo_despues,created_at")
        .in("cliente_id", pageClientIds)
        .order("created_at", { ascending: false })
        .limit(Math.max(40, pageClientIds.length * 5));
      if (movementsError) throw movementsError;
      for (const movement of movements || []) {
        const key = String(movement.cliente_id || "");
        const current = coinMovementsByClient.get(key) || [];
        if (current.length < 5) current.push(movement);
        coinMovementsByClient.set(key, current);
      }
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
        coin_movements: coinMovementsByClient.get(String(client.id)) || [],
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
        without_access: Math.max(0, allClientCount - linked.filter(({ auth }) => Boolean(auth)).length),
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
      .select("id,nombre,apellido,email,telefono,auth_user_id,puntos,origen")
      .eq("id", clientId)
      .maybeSingle();
    if (clientError) throw clientError;
    if (!client) return NextResponse.json({ ok: false, error: "CLIENT_NOT_FOUND" }, { status: 404 });

    if (action === "gift_coins") {
      const amount = Number(body.amount);
      const reason = String(body.reason || "").trim();
      const operationId = String(body.operation_id || "").trim();
      if (!Number.isSafeInteger(amount) || amount < 1 || amount > 1_000_000) {
        return NextResponse.json({ ok: false, error: "COIN_AMOUNT_INVALID" }, { status: 400 });
      }
      if (!reason || reason.length > 500) {
        return NextResponse.json({ ok: false, error: "COIN_REASON_INVALID" }, { status: 400 });
      }
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(operationId)) {
        return NextResponse.json({ ok: false, error: "OPERATION_ID_INVALID" }, { status: 400 });
      }

      const { data: gift, error: giftError } = await gate.admin.rpc("admin_gift_client_coins", {
        p_client_id: clientId,
        p_admin_worker_id: gate.me.id,
        p_amount: amount,
        p_reason: reason,
        p_operation_id: operationId,
      });
      if (giftError) throw giftError;

      const result = gift && typeof gift === "object" ? gift as Record<string, unknown> : {};
      const balance = Math.max(0, Number(result.balance || 0));
      if (!result.duplicated) {
        try {
          const subscriptions = await getClientPushSubscriptions(clientId);
          if (subscriptions.length) {
            await sendPushToSubscriptions(subscriptions, {
              title: "¡Tienes un obsequio!",
              body: `Has recibido +${amount.toLocaleString("es-ES")} Coins. ${reason}`,
              url: "/cliente/dashboard#notificaciones",
              tag: `coin-gift-${operationId}`,
            });
          }
        } catch (pushError) {
          console.error("[client-web:coin-gift-push]", pushError);
        }
      }
      return NextResponse.json({ ok: true, amount, balance, duplicated: Boolean(result.duplicated), movement_id: result.movement_id || null });
    }

    if (action === "create_access") {
      const password = String(body.password || "");
      const confirm = String(body.confirm || "");
      if (password.length < 8) return NextResponse.json({ ok: false, error: "La contraseña debe tener al menos 8 caracteres." }, { status: 400 });
      if (password !== confirm) return NextResponse.json({ ok: false, error: "Las contraseñas no coinciden." }, { status: 400 });
      if (!client.telefono) return NextResponse.json({ ok: false, error: "La clienta necesita un teléfono para crear el acceso web." }, { status: 400 });

      if (client.auth_user_id) {
        const existing = await resolveClientAuthUser(gate.admin, client);
        if (!existing) {
          const { error: clearError } = await gate.admin.from("crm_clientes").update({ auth_user_id: null }).eq("id", clientId);
          if (clearError) throw clearError;
        }
      }
      const linked = await ensureClienteAuthUser({ phone: String(client.telefono), password });
      invalidateAuthUsersCache();
      await writeAudit(gate.admin, gate.me, clientId, linked.auth_user_id, "admin_cliente_web_crear_acceso", { created: linked.created });
      return NextResponse.json({ ok: true, auth_user_id: linked.auth_user_id, created: linked.created });
    }

    if (action === "delete_access") {
      const authUser = await resolveClientAuthUser(gate.admin, client);

      if (!authUser) return NextResponse.json({ ok: false, error: "Esta ficha no tiene un acceso web propio que se pueda eliminar." }, { status: 404 });

      const { data: otherLinks, error: otherLinksError } = await gate.admin
        .from("crm_clientes")
        .select("id")
        .eq("auth_user_id", authUser.id)
        .neq("id", clientId)
        .limit(1);
      if (otherLinksError) throw otherLinksError;
      if ((otherLinks || []).length) {
        return NextResponse.json({ ok: false, error: "Esta cuenta Auth también está vinculada a otra ficha. Revisa la duplicidad antes de eliminarla." }, { status: 409 });
      }

      const { data: workerIdentity, error: workerIdentityError } = await gate.admin
        .from("workers")
        .select("id")
        .eq("user_id", authUser.id)
        .maybeSingle();
      if (workerIdentityError) throw workerIdentityError;

      if (!workerIdentity) {
        const { error: banError } = await gate.admin.auth.admin.updateUserById(authUser.id, { ban_duration: "876000h" });
        if (banError) throw banError;
      }

      const { error: unlinkError } = await gate.admin
        .from("crm_clientes")
        .update({ auth_user_id: null, updated_at: new Date().toISOString() })
        .eq("id", clientId);
      if (unlinkError) {
        if (!workerIdentity) await gate.admin.auth.admin.updateUserById(authUser.id, { ban_duration: "none" });
        throw unlinkError;
      }

      await writeAudit(gate.admin, gate.me, clientId, authUser.id, "admin_cliente_web_eliminar_acceso", {
        preserved_crm_client: true,
        preserved_auth_identity: Boolean(workerIdentity),
        phone: client.telefono || null,
      });

      // Si la identidad también pertenece a un trabajador, borrar auth.users
      // eliminaría su acceso interno y activaría cascadas sobre su historial.
      // En ese caso basta con retirar el vínculo de cliente web.
      if (workerIdentity) {
        invalidateAuthUsersCache();
        return NextResponse.json({ ok: true, preserved_crm_client: true, preserved_auth_identity: true });
      }

      // Desvincular primero protege la ficha CRM incluso si la FK histórica
      // estuviera configurada con una acción destructiva al borrar auth.users.
      const { error: deleteError } = await gate.admin.auth.admin.deleteUser(authUser.id);
      if (deleteError) {
        await gate.admin.from("crm_clientes").update({ auth_user_id: authUser.id }).eq("id", clientId);
        await gate.admin.auth.admin.updateUserById(authUser.id, { ban_duration: "none" });
        throw deleteError;
      }

      invalidateAuthUsersCache();
      return NextResponse.json({ ok: true, preserved_crm_client: true });
    }

    const authUser = await resolveClientAuthUser(gate.admin, client);
    if (!authUser) return NextResponse.json({ ok: false, error: "CLIENT_WITHOUT_WEB_ACCESS" }, { status: 400 });
    const authUserId = authUser.id;

    if (action === "password") {
      const password = String(body.password || "");
      const confirm = String(body.confirm || "");
      if (password.length < 8) return NextResponse.json({ ok: false, error: "La contraseña debe tener al menos 8 caracteres." }, { status: 400 });
      if (password !== confirm) return NextResponse.json({ ok: false, error: "Las contraseñas no coinciden." }, { status: 400 });
      const { error } = await gate.admin.auth.admin.updateUserById(authUserId, { password });
      if (error) throw error;
      invalidateAuthUsersCache();
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
