import { NextResponse } from "next/server";
import { exec } from "child_process";
import { promisify } from "util";
import { createClient } from "@supabase/supabase-js";
import { amiAction, amiCommand, getAsteriskLiveSnapshot, refreshPjsipRealtimeObject } from "@/lib/server/asterisk-ami";
const execAsync = promisify(exec);

export const runtime = "nodejs";

type Role = "admin" | "central" | "tarotista";

type RoutingRow = {
  extension: string;
  type?: "internal" | "external" | string | null;
  destination?: string | null;
  target?: string | null;
  phone?: string | null;
  mobile?: string | null;
};

type MeWorker = {
  id: string;
  user_id: string | null;
  role: Role;
  display_name: string | null;
  email: string | null;
};

type ExtensionRow = {
  extension?: string;
  [key: string]: any;
};

const DEFAULT_SIP_DOMAIN = process.env.NEXT_PUBLIC_SIP_DOMAIN || "sip.clientestarotcelestial.es";
const DEFAULT_SIP_WS_SERVER = normalizeWsServer(process.env.NEXT_PUBLIC_SIP_WS_SERVER || "wss://sip.clientestarotcelestial.es/ws");
const DEFAULT_PJSIP_CONTEXT = process.env.ASTERISK_PJSIP_CONTEXT || "from-internal";
const DEFAULT_PJSIP_TRANSPORT = process.env.ASTERISK_PJSIP_TRANSPORT || "transport-wss";

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function isMissingRelationError(error: any) {
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("could not find the table") || msg.includes("relation") || msg.includes("column");
}

function sanitizeExtension(value: any) {
  return String(value || "").replace(/[^0-9]/g, "").trim();
}

function sanitizePhone(value: any) {
  return String(value || "").replace(/[^0-9+]/g, "").trim();
}

function normalizeWsServer(value: any) {
  const raw = String(value || "").trim();
  if (!raw) return "wss://sip.clientestarotcelestial.es/ws";
  const lower = raw.toLowerCase().replace(/\/$/, "");
  if (
    lower === "wss://sip.clientestarotcelestial.es:8088/ws" ||
    lower === "wss://sip.clientestarotcelestial.es:8089/ws" ||
    lower === "ws://sip.clientestarotcelestial.es:8088/ws"
  ) {
    return "wss://sip.clientestarotcelestial.es/ws";
  }
  return lower.endsWith("/ws") ? raw : raw.replace(/\/$/, "") + "/ws";
}

function getDefaultSecret(extension: string) {
  return extension === "1000" ? "123456" : extension ? "1234" : "";
}

async function getWorkerRole(admin: any, workerId: string | null) {
  if (!workerId) return null;
  const { data, error } = await admin
    .from("workers")
    .select("role")
    .eq("id", workerId)
    .maybeSingle();
  if (error) throw error;
  const role = String(data?.role || "").toLowerCase();
  return role === "admin" ? "central" : role || null;
}

function normalizeExtensionRole(value: any) {
  const role = String(value || "").trim().toLowerCase();
  if (role === "admin") return "central";
  if (role === "central" || role === "tarotista") return role;
  return null;
}

async function syncCentralInAsterisk(extension: string, isActive: boolean) {
  try {
    if (!extension) return;

    if (isActive) {
      console.log("🟢 Registrando central en Asterisk:", extension);
      await execAsync(`asterisk -rx "database put centrales ${extension} online"`);
    } else {
      console.log("🔴 Eliminando central de Asterisk:", extension);
      await execAsync(`asterisk -rx "database del centrales ${extension}"`);
    }
  } catch (e) {
    console.error("Error sync central ASTERISK:", e);
  }
}

async function syncExtensionRoutingInAsterisk(extension: string, routeType: string, targetPhone?: string | null) {
  try {
    const ext = sanitizeExtension(extension);
    const target = sanitizePhone(targetPhone);

    console.log("🔥 ROUTING DEBUG →", { ext, routeType, targetPhone, target });

    if (!ext) return;

    if (String(routeType).trim().toLowerCase() === "external" && target) {
      const res = await amiAction({
        Action: "DBPut",
        Family: "pbx_route_external",
        Key: ext,
        Val: target,
      });

      console.log("✅ DBPut pbx_route_external →", res.ok, res.error || null);
      return;
    }

    const res = await amiAction({
      Action: "DBDel",
      Family: "pbx_route_external",
      Key: ext,
    });

    console.log("🧹 DBDel pbx_route_external →", res.ok, res.error || null);
  } catch (e) {
    console.error("Error sync routing ASTERISK:", e);
  }
}

async function insertExtensionRecord(admin: any, payload: any) {
  let res = await admin.from("pbx_extensions").insert(payload).select("*").maybeSingle();
  if (res.error && isMissingRelationError(res.error) && ("role" in payload || "extension_role" in payload)) {
    const fallback = { ...payload };
    delete fallback.role;
    delete fallback.extension_role;
    res = await admin.from("pbx_extensions").insert(fallback).select("*").maybeSingle();
  }
  return res;
}

async function updateExtensionRecord(admin: any, id: string, payload: any) {
  let res = await admin.from("pbx_extensions").update(payload).eq("id", id).select("*").maybeSingle();
  if (res.error && isMissingRelationError(res.error) && ("role" in payload || "extension_role" in payload)) {
    const fallback = { ...payload };
    delete fallback.role;
    delete fallback.extension_role;
    res = await admin.from("pbx_extensions").update(fallback).eq("id", id).select("*").maybeSingle();
  }
  return res;
}

async function upsertExtensionRecord(admin: any, payload: any) {
  let res = await admin.from("pbx_extensions").upsert(payload, { onConflict: "extension" }).select("*").maybeSingle();
  if (res.error && isMissingRelationError(res.error) && ("role" in payload || "extension_role" in payload)) {
    const fallback = { ...payload };
    delete fallback.role;
    delete fallback.extension_role;
    res = await admin.from("pbx_extensions").upsert(fallback, { onConflict: "extension" }).select("*").maybeSingle();
  }
  return res;
}

function missingColumnName(error: any) {
  const msg = String(error?.message || "");
  return msg.match(/column "([^"]+)"/i)?.[1] || null;
}

function stripUndefined(payload: Record<string, any>) {
  const next = { ...payload };
  Object.keys(next).forEach((key) => next[key] === undefined && delete next[key]);
  return next;
}

async function upsertFlexible(admin: any, table: string, payload: Record<string, any>, fallbackPayload?: Record<string, any>) {
  let current = stripUndefined(payload);
  const removedColumns: string[] = [];

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const res = await admin.from(table).upsert(current, { onConflict: "id" }).select("*").maybeSingle();
    if (!res.error) return { ...res, removedColumns };

    const col = missingColumnName(res.error);
    if (col && col in current) {
      removedColumns.push(col);
      const next = { ...current };
      delete next[col];
      current = next;
      continue;
    }

    if (fallbackPayload && isMissingRelationError(res.error)) {
      current = stripUndefined(fallbackPayload);
      fallbackPayload = undefined;
      continue;
    }

    return { ...res, removedColumns };
  }

  return {
    data: null,
    error: { message: `No se pudo sincronizar ${table}: demasiadas columnas incompatibles (${removedColumns.join(", ")})` },
    removedColumns,
  };
}

async function deleteAsteriskRealtimeExtension(admin: any, extension: string) {
  await admin.from("ps_endpoints").delete().eq("id", extension);
  await admin.from("ps_auths").delete().eq("id", extension);
  await admin.from("ps_aors").delete().eq("id", extension);
}

async function syncAsteriskRealtimeExtension(admin: any, source: ExtensionRow) {
  const extension = sanitizeExtension(source?.extension || source?.id || source?.exten);
  if (!extension) return { ok: false, skipped: true, reason: "NO_EXTENSION" };

  if (source?.is_active === false) {
    await deleteAsteriskRealtimeExtension(admin, extension);
    return { ok: true, deleted: true, extension };
  }

  const password = String(source?.secret || source?.password || "").trim() || getDefaultSecret(extension);
  const context = String(source?.context || DEFAULT_PJSIP_CONTEXT).trim() || DEFAULT_PJSIP_CONTEXT;
  const transport = String(source?.transport || DEFAULT_PJSIP_TRANSPORT).trim() || DEFAULT_PJSIP_TRANSPORT;

  const extensionRole = normalizeExtensionRole(source?.role || source?.extension_role);
  const callerIdVisible = extensionRole === "tarotista" ? false : true;

  const aorPayload = {
    id: extension,
    contact: null,
    max_contacts: 1,
    remove_existing: "yes",
    qualify_frequency: 0,
  };
  const aorFallback = { id: extension, max_contacts: 1 };
  const authPayload = {
    id: extension,
    auth_type: "userpass",
    username: extension,
    password,
    realm: null,
  };
  const endpointPayload = {
    id: extension,
    transport,
    context,
    disallow: "all",
    allow: "opus,ulaw,alaw",
    aors: extension,
    auth: extension,
    direct_media: "no",
    rewrite_contact: "yes",
    force_rport: "yes",
    rtp_symmetric: "yes",
    ice_support: "yes",
    media_use_received_transport: "yes",
    webrtc: "yes",
    use_avpf: "yes",
    media_encryption: "dtls",
    dtls_auto_generate_cert: "yes",
    dtls_verify: "no",
    dtls_setup: "actpass",
    rtcp_mux: "yes",
    allow_transfer: "yes",
    callerid: callerIdVisible ? undefined : "Oculto <anonymous>",
  };
  const endpointFallback = {
    id: extension,
    transport,
    context,
    disallow: "all",
    allow: "opus,ulaw,alaw",
    aors: extension,
    auth: extension,
    direct_media: "no",
  };

  const aor = await upsertFlexible(admin, "ps_aors", aorPayload, aorFallback);
  if (aor.error) return { ok: false, table: "ps_aors", error: aor.error.message };

  const auth = await upsertFlexible(admin, "ps_auths", authPayload, { id: extension, auth_type: "userpass", username: extension, password });
  if (auth.error) return { ok: false, table: "ps_auths", error: auth.error.message };

  const endpoint = await upsertFlexible(admin, "ps_endpoints", endpointPayload, endpointFallback);
  if (endpoint.error) return { ok: false, table: "ps_endpoints", error: endpoint.error.message };

  return {
    ok: true,
    extension,
    removedColumns: {
      ps_aors: aor.removedColumns || [],
      ps_auths: auth.removedColumns || [],
      ps_endpoints: endpoint.removedColumns || [],
    },
  };
}

async function syncAsteriskRealtimeExtensions(admin: any, rows: ExtensionRow[]) {
  const results = [];
  for (const row of rows || []) results.push(await syncAsteriskRealtimeExtension(admin, row));
  return results;
}

async function ensureDefaultExtensions(admin: any) {
  const defaults = [
    { extension: "1000", secret: "123456", label: "Central 1000", role: "central" },
    { extension: "1002", secret: "1234", label: "Tarotista 1002", role: "tarotista" },
  ];

  for (const item of defaults) {
    const extension = sanitizeExtension(item.extension);

    const existing = await admin
      .from("pbx_extensions")
      .select("id, extension")
      .eq("extension", extension)
      .maybeSingle();

    if (existing.error && !isMissingRelationError(existing.error)) {
      throw existing.error;
    }

    if (existing.data) {
      await syncAsteriskRealtimeExtension(admin, { ...existing.data, ...item, extension, is_active: true });
      continue;
    }

    const payload = {
      id: extension,
      extension,
      secret: item.secret,
      password: item.secret,
      label: item.label,
      name: item.label,
      role: item.role,
      extension_role: item.role,
      context: DEFAULT_PJSIP_CONTEXT,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const result = await insertExtensionRecord(admin, payload);
    if (result.error && !isMissingRelationError(result.error)) {
      throw result.error;
    }
    await syncAsteriskRealtimeExtension(admin, result.data || payload);
  }
}

function normalizeExtensionRow(row: ExtensionRow) {
  const extension = sanitizeExtension(row?.extension || row?.id || row?.exten);
  const secret = String(row?.secret || row?.password || "").trim() || null;
  const label = String(row?.label || row?.name || "").trim() || null;
  const domain = String(row?.domain || DEFAULT_SIP_DOMAIN).trim();
  const ws_server = normalizeWsServer(row?.ws_server || DEFAULT_SIP_WS_SERVER);
  return {
    ...row,
    id: String(row?.id || extension),
    extension,
    secret,
    password: secret,
    label,
    name: label,
    domain,
    ws_server,
    sip_uri: row?.sip_uri || (extension && domain ? `sip:${extension}@${domain}` : null),
    is_active: row?.is_active !== false,
    registered: !!row?.registered,
    status: String(row?.status || (row?.registered ? "registered" : "offline") || "offline"),
    active_call_count: Number(row?.active_call_count || 0) || 0,
    active_call_started_at: row?.active_call_started_at || null,
    incoming_number: row?.incoming_number || null,
    talking_to: row?.talking_to || null,
    last_seen_at: row?.last_seen_at || null,
    role: normalizeExtensionRole(row?.role || row?.extension_role) || null,
    extension_role: normalizeExtensionRole(row?.extension_role || row?.role) || null,
    caller_id_visible: row?.caller_id_visible !== undefined ? !!row.caller_id_visible : normalizeExtensionRole(row?.role || row?.extension_role) !== "tarotista",
    show_caller_number: row?.show_caller_number !== undefined ? !!row.show_caller_number : normalizeExtensionRole(row?.role || row?.extension_role) !== "tarotista",
  };
}

function runtimeAgeMs(row: any) {
  const ts = row?.last_seen_at ? new Date(row.last_seen_at).getTime() : 0;
  if (!Number.isFinite(ts) || ts <= 0) return Infinity;
  return Date.now() - ts;
}

function isFreshRuntime(row: any) {
  return runtimeAgeMs(row) < 20000;
}

function isStaleRuntime(row: any) {
  return runtimeAgeMs(row) > 90000;
}

function mergeAsteriskLiveState(row: any, liveState: any, opts: { forceClearRuntimeIfAmiIdle?: boolean } = {}) {
  const baseLiveState = liveState || { registered: false, active_call_count: 0, status: "offline", talking_to: null, active_call_started_at: null };

  const runtimeActive = Number(row?.active_call_count || 0) > 0 || ["in_call", "ringing", "calling", "busy"].includes(String(row?.status || "").toLowerCase());
  const runtimeFresh = isFreshRuntime(row);
  const runtimeStale = isStaleRuntime(row);
  const activeCallCount = Number(baseLiveState.active_call_count || 0) || 0;

  if (opts.forceClearRuntimeIfAmiIdle && activeCallCount === 0) {
    const nextStatus = row?.registered || baseLiveState.registered ? "registered" : "offline";
    return normalizeExtensionRow({ ...row, registered: !!row?.registered || !!baseLiveState.registered, status: nextStatus, active_call_count: 0, active_call_started_at: null, incoming_number: null, talking_to: null });
  }

  if (runtimeFresh && runtimeActive && activeCallCount === 0) {
    return normalizeExtensionRow(row);
  }

  if (runtimeStale && runtimeActive && activeCallCount === 0) {
    const nextStatus = row?.registered || baseLiveState.registered ? "registered" : "offline";
    return normalizeExtensionRow({ ...row, registered: !!row?.registered || !!baseLiveState.registered, status: nextStatus, active_call_count: 0, active_call_started_at: null, incoming_number: null, talking_to: null });
  }

  const liveStatus = activeCallCount > 0 ? baseLiveState.status || "in_call" : baseLiveState.registered ? "registered" : (row?.registered ? "registered" : "offline");
  return {
    ...row,
    registered: !!baseLiveState.registered || (runtimeFresh && !!row.registered) || (!!row.registered && activeCallCount === 0),
    status: liveStatus,
    active_call_count: activeCallCount,
    active_call_started_at: activeCallCount > 0 ? baseLiveState.active_call_started_at || row.active_call_started_at || new Date().toISOString() : null,
    incoming_number: liveStatus === "ringing" ? baseLiveState.talking_to || row.incoming_number || null : null,
    talking_to: activeCallCount > 0 ? baseLiveState.talking_to || row.talking_to || null : null,
  };
}

async function getAuthContext(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");

const auth = req.headers.get("authorization") || "";

console.log("AUTH HEADER:", auth); // 👈 AÑADE ESTA LÍNEA

const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";

if (!token) {
  console.log("❌ NO TOKEN DETECTADO"); // 👈 OPCIONAL PERO ÚTIL
  return { ok: false as const, error: "NO_TOKEN" as const };
}

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data: userData } = await userClient.auth.getUser();
  const uid = userData?.user?.id || null;
  const email = userData?.user?.email || null;
  if (!uid) return { ok: false as const, error: "BAD_TOKEN" as const };

  const admin = createClient(url, service, { auth: { persistSession: false } });

  let me: MeWorker | null = null;

  const byUser = await admin
    .from("workers")
    .select("id, user_id, role, display_name, email")
    .eq("user_id", uid)
    .maybeSingle();

  if (byUser.data) {
    me = byUser.data as MeWorker;
  } else if (email) {
    const byEmail = await admin
      .from("workers")
      .select("id, user_id, role, display_name, email")
      .eq("email", email)
      .maybeSingle();
    me = (byEmail.data as MeWorker | null) || null;
  }

  if (!me) return { ok: false as const, error: "NO_WORKER" as const };

  return { ok: true as const, admin, me };
}

async function readExtensions(admin: any) {
  const { data, error } = await admin
    .from("pbx_extensions")
    .select("*")
    .order("extension", { ascending: true });

  if (error) {
    if (isMissingRelationError(error)) return { rows: [], missingTable: true };
    throw error;
  }

  return { rows: (data || []).map(normalizeExtensionRow), missingTable: false };
}

async function readRouting(admin: any) {
  const { data, error } = await admin
    .from("pbx_routing")
    .select("id, extension, type, target, is_active, queue_id, queue_priority, notes, created_at, updated_at")
    .order("extension", { ascending: true });

  if (error) {
    if (isMissingRelationError(error)) return { rows: [], missingTable: true };
    throw error;
  }

  return { rows: data || [], missingTable: false };
}

async function readQueues(admin: any) {
  const queuesRes = await admin
    .from("pbx_queues")
    .select("id, queue_key, label, strategy, ring_timeout, wrapup_seconds, max_wait_seconds, is_active, created_at, updated_at")
    .order("queue_key", { ascending: true });

  const membersRes = await admin
    .from("pbx_queue_members")
    .select("id, queue_id, worker_id, extension, penalty, is_active, created_at, updated_at")
    .order("queue_id", { ascending: true });

  const queuesMissing = queuesRes.error && isMissingRelationError(queuesRes.error);
  const membersMissing = membersRes.error && isMissingRelationError(membersRes.error);

  if (queuesRes.error && !queuesMissing) throw queuesRes.error;
  if (membersRes.error && !membersMissing) throw membersRes.error;

  return {
    queues: queuesRes.data || [],
    members: membersRes.data || [],
    missingTables: queuesMissing || membersMissing,
  };
}

export async function GET(req: Request) {
  try {
    const gate = await getAuthContext(req);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error }, { status: 401 });
    }

    const { admin, me } = gate;
    if (!["admin", "central"].includes(String(me.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const { data: workers, error: workersErr } = await admin
      .from("workers")
      .select("id, user_id, display_name, role, email, team, is_active, created_at")
      .in("role", ["admin", "central", "tarotista"])
      .order("display_name", { ascending: true });

    if (workersErr) throw workersErr;

   // await ensureDefaultExtensions(admin);
    const extensionsResult = await readExtensions(admin);
    const realtimeSync = extensionsResult.missingTable ? [] : await syncAsteriskRealtimeExtensions(admin, extensionsResult.rows);
    const routingResult = await readRouting(admin);
    const routingByExtension = new Map<string, RoutingRow>();

(routingResult.rows || []).forEach((r: any) => {
  const ext = String(r.extension || "");
  if (!ext) return;

  routingByExtension.set(ext, r as RoutingRow);
});
    const queuesResult = await readQueues(admin);
    const liveSnapshot = await getAsteriskLiveSnapshot();
    const liveExtensions = liveSnapshot.extensions || {};
    const extensions = extensionsResult.rows.map((row: ExtensionRow) => {
      const extension = String(row.extension || "");
      const route = routingByExtension.get(extension);
      const isExternalRoute = String(route?.type || "internal") === "external";
      return normalizeExtensionRow(
        mergeAsteriskLiveState(row, liveExtensions[extension], { forceClearRuntimeIfAmiIdle: isExternalRoute })
      );
    });

    return NextResponse.json({
      ok: true,
      me,
      workers: workers || [],
      extensions,
      asteriskLive: { ok: liveSnapshot.ok, error: liveSnapshot.error || null },
      routing: routingResult.rows,
      queues: queuesResult.queues,
      queueMembers: queuesResult.members,
      setupNeeded: extensionsResult.missingTable,
      realtimeSync,
      routingSetupNeeded: routingResult.missingTable,
      queueSetupNeeded: queuesResult.missingTables,
    });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await getAuthContext(req);
    if (!gate.ok) {
      return NextResponse.json({ ok: false, error: gate.error }, { status: 401 });
    }

    const { admin, me } = gate;
    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "").trim();

    if (action === "save_extension") {
  if (!["admin", "central"].includes(String(me.role || ""))) {
    return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const id = String(body?.id || "").trim() || crypto.randomUUID();
  const worker_id = String(body?.worker_id || "").trim() || null;

  const extension = sanitizeExtension(body?.extension);
  const password = String(body?.secret || body?.password || "").trim() || getDefaultSecret(extension);
  const workerRole = normalizeExtensionRole(await getWorkerRole(admin, worker_id));
  const role = normalizeExtensionRole(body?.role) || workerRole || "tarotista";

  const label = String(body?.label || "").trim() || null;
  const domain = String(body?.domain || "").trim();
  const ws_server = normalizeWsServer(body?.ws_server || DEFAULT_SIP_WS_SERVER);
  const sip_uri = extension && domain ? `sip:${extension}@${domain}` : null;

  const is_active = body?.is_active !== undefined ? !!body.is_active : true;

  const route_type = String(body?.route_type || "internal").trim() || "internal";
  const target_phone = sanitizePhone(body?.target_phone);

  const queue_id = String(body?.queue_id || "").trim() || null;
  const queue_priority = Number(body?.queue_priority || 0) || 0;
  const routing_notes = String(body?.routing_notes || "").trim() || null;

  if (!extension) {
    return NextResponse.json({ ok: false, error: "EXTENSION_REQUIRED" }, { status: 400 });
  }

  if (!password) {
    return NextResponse.json({ ok: false, error: "PASSWORD_REQUIRED" }, { status: 400 });
  }

  // 🔥 INSERT / UPDATE
  const payload = {
    id,
    worker_id,
    extension,
    secret: password,
    password,
    label,
    name: label,
    domain: domain || null,
    ws_server,
    sip_uri,
    context: DEFAULT_PJSIP_CONTEXT,
    is_active,
    role,
    extension_role: role,
    updated_at: new Date().toISOString(),
  };

  let result;

  result = await upsertExtensionRecord(admin, payload);

  if (result.error) {
    console.error("EXTENSION ERROR:", result.error);
    return NextResponse.json({ ok: false, error: result.error.message });
  }

  const realtimeSync = await syncAsteriskRealtimeExtension(admin, result.data || payload);
  if (!realtimeSync.ok && !realtimeSync.skipped) {
    console.error("ASTERISK REALTIME SYNC ERROR:", realtimeSync);
    return NextResponse.json({ ok: false, error: "ASTERISK_REALTIME_SYNC_FAILED: " + (realtimeSync.error || realtimeSync.reason || realtimeSync.table || "unknown") });
  }

  const asteriskRefresh = await refreshPjsipRealtimeObject(extension);

    // 🔥 ROUTING
  const routingPayload = {
    extension,
    type: route_type,
    target: route_type === "external" ? target_phone || null : null,
    queue_id,
    queue_priority,
    notes: routing_notes,
    is_active,
    updated_at: new Date().toISOString(),
  };

  let routingRes = await admin
    .from("pbx_routing")
    .upsert(routingPayload, { onConflict: "extension" })
    .select("*")
    .maybeSingle();

  if (routingRes.error && String(routingRes.error.message || "").includes("there is no unique")) {
    const existing = await admin
      .from("pbx_routing")
      .select("id")
      .eq("extension", extension)
      .maybeSingle();

    routingRes = existing.data?.id
      ? await admin.from("pbx_routing").update(routingPayload).eq("id", existing.data.id).select("*").maybeSingle()
      : await admin.from("pbx_routing").insert(routingPayload).select("*").maybeSingle();
  }

  if (routingRes.error && !isMissingRelationError(routingRes.error)) {
    console.error("ROUTING ERROR:", routingRes.error);
    return NextResponse.json({ ok: false, error: routingRes.error.message });
  }

  async function syncExtensionRoutingInAsterisk(
  extension: string,
  routeType: string,
  targetPhone?: string | null
) {
  try {
    const ext = sanitizeExtension(extension);
    const target = sanitizePhone(targetPhone);

    console.log("🔥 ROUTING SYNC INPUT →", {
      ext,
      routeType,
      targetPhone,
      target,
    });

    if (!ext) return;

    const isExternal =
      String(routeType || "")
        .toLowerCase()
        .includes("external");

    if (isExternal && target) {
      const res = await amiAction({
        Action: "DBPut",
        Family: "pbx_route_external",
        Key: ext,
        Val: target,
      });

      console.log("✅ DBPut RESULT:", res);
      return;
    }

    const res = await amiAction({
      Action: "DBDel",
      Family: "pbx_route_external",
      Key: ext,
    });

    console.log("🧹 DBDel RESULT:", res);
  } catch (e) {
    console.error("❌ ROUTING SYNC ERROR:", e);
  }
}

  return NextResponse.json({
    ok: true,
    extension: result.data,
    routing: routingRes.data || null,
    realtimeSync,
    asteriskRefresh,
  });
}


    if (action === "delete_extension") {
      if (!["admin", "central"].includes(String(me.role || ""))) {
        return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
      }

      const extension = sanitizeExtension(body?.extension);
      const id = String(body?.id || "").trim();

      if (!extension && !id) {
        return NextResponse.json({ ok: false, error: "EXTENSION_REQUIRED" }, { status: 400 });
      }

      let extToDelete = extension;
      if (!extToDelete && id) {
        const existing = await admin.from("pbx_extensions").select("extension").eq("id", id).maybeSingle();
        if (existing.error && !isMissingRelationError(existing.error)) throw existing.error;
        extToDelete = sanitizeExtension(existing.data?.extension);
      }

      if (!extToDelete) {
        return NextResponse.json({ ok: false, error: "EXTENSION_NOT_FOUND" }, { status: 404 });
      }

      await deleteAsteriskRealtimeExtension(admin, extToDelete);
      await syncExtensionRoutingInAsterisk(extToDelete, "internal", null);
      await syncCentralInAsterisk(extToDelete, false);

      const routingDel = await admin.from("pbx_routing").delete().eq("extension", extToDelete);
      if (routingDel.error && !isMissingRelationError(routingDel.error)) throw routingDel.error;

      const queueDel = await admin.from("pbx_queue_members").delete().eq("extension", extToDelete);
      if (queueDel.error && !isMissingRelationError(queueDel.error)) throw queueDel.error;

      const extDel = id
        ? await admin.from("pbx_extensions").delete().eq("id", id)
        : await admin.from("pbx_extensions").delete().eq("extension", extToDelete);
      if (extDel.error && !isMissingRelationError(extDel.error)) throw extDel.error;

      const asteriskRefresh = await refreshPjsipRealtimeObject(extToDelete);

      return NextResponse.json({ ok: true, extension: extToDelete, asteriskRefresh });
    }
    if (action === "save_queue") {
      if (!["admin", "central"].includes(String(me.role || ""))) {
        return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
      }

      const id = String(body?.id || "").trim() || null;
      const queue_key = sanitizeExtension(body?.queue_key);
      const label = String(body?.label || "").trim();
      const strategy = String(body?.strategy || "ringall").trim() || "ringall";
      const ring_timeout = Math.max(5, Number(body?.ring_timeout || 20) || 20);
      const wrapup_seconds = Math.max(0, Number(body?.wrapup_seconds || 10) || 10);
      const max_wait_seconds = Math.max(0, Number(body?.max_wait_seconds || 120) || 120);
      const is_active = body?.is_active !== undefined ? !!body.is_active : true;

      if (!queue_key) return NextResponse.json({ ok: false, error: "QUEUE_KEY_REQUIRED" }, { status: 400 });
      if (!label) return NextResponse.json({ ok: false, error: "QUEUE_LABEL_REQUIRED" }, { status: 400 });

      const payload = {
        queue_key,
        label,
        strategy,
        ring_timeout,
        wrapup_seconds,
        max_wait_seconds,
        is_active,
        updated_at: new Date().toISOString(),
      };

      const result = id
        ? await admin.from("pbx_queues").update(payload).eq("id", id).select("*").maybeSingle()
        : await admin.from("pbx_queues").insert(payload).select("*").maybeSingle();

      if (result.error) throw result.error;

      return NextResponse.json({ ok: true, queue: result.data });
    }

    if (action === "save_queue_members") {
      if (!["admin", "central"].includes(String(me.role || ""))) {
        return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
      }

      const queue_id = String(body?.queue_id || "").trim();
      const members = Array.isArray(body?.members) ? body.members : [];
      if (!queue_id) return NextResponse.json({ ok: false, error: "QUEUE_ID_REQUIRED" }, { status: 400 });

      const deleteRes = await admin.from("pbx_queue_members").delete().eq("queue_id", queue_id);
      if (deleteRes.error && !isMissingRelationError(deleteRes.error)) throw deleteRes.error;

      const cleanMembers = members
        .map((item: any) => ({
          queue_id,
          worker_id: String(item?.worker_id || "").trim() || null,
          extension: sanitizeExtension(item?.extension),
          penalty: Math.max(0, Number(item?.penalty || 0) || 0),
          is_active: item?.is_active !== false,
        }))
        .filter((item: any) => item.worker_id || item.extension);

      if (cleanMembers.length) {
        const ins = await admin.from("pbx_queue_members").insert(cleanMembers).select("*");
        if (ins.error) throw ins.error;
      }

      return NextResponse.json({ ok: true, count: cleanMembers.length });
    }

    if (action === "update_runtime") {
  try {
    const extension = sanitizeExtension(body?.extension);

    if (!extension) {
      return NextResponse.json({ ok: false, error: "EXTENSION_REQUIRED" }, { status: 200 });
    }

    const runtimePatch: any = {
      status: body?.status !== undefined ? String(body.status || "").trim() || "offline" : undefined,
      registered: body?.registered !== undefined ? !!body.registered : undefined,
      active_call_count: body?.active_call_count !== undefined ? Number(body.active_call_count || 0) || 0 : undefined,
      active_call_started_at: body?.active_call_started_at !== undefined ? body.active_call_started_at || null : undefined,
      incoming_number: body?.incoming_number !== undefined ? String(body.incoming_number || "").trim() || null : undefined,
      talking_to: body?.talking_to !== undefined ? String(body.talking_to || "").trim() || null : undefined,
      last_seen_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    Object.keys(runtimePatch).forEach((k) => runtimePatch[k] === undefined && delete runtimePatch[k]);

    console.log("UPDATE RUNTIME → extension:", extension, "patch:", runtimePatch);

    let result = await admin
      .from("pbx_extensions")
      .update(runtimePatch)
      .eq("extension", extension)
      .select("*")
      .maybeSingle();

    if (result.error) {
      console.error("RUNTIME UPDATE ERROR:", result.error);
      return NextResponse.json({ ok: false, error: result.error.message }, { status: 200 });
    }

    // 🔥 SINCRONIZAR CENTRALES CON ASTERISK
    // Importante: usamos result.data.registered, no runtimePatch.registered.
    // update_runtime a veces llega solo con status/active_call_count; si leyéramos
    // runtimePatch.registered en esos casos, borraríamos la central de ASTDB por error.
    try {
      const role = normalizeExtensionRole(result.data?.role || result.data?.extension_role);
      const isRegistered = result.data?.registered === true;

      if (role === "central") {
        await syncCentralInAsterisk(extension, isRegistered);
      }
    } catch (e) {
      console.error("Error sincronizando central:", e);
    }

    return NextResponse.json({
      ok: true,
      extension: result.data ? normalizeExtensionRow(result.data) : null,
    });
  } catch (err) {
    console.error("RUNTIME FATAL:", err);
    return NextResponse.json({ ok: false }, { status: 200 });
  }
}

// ✅ SI NO ES NINGUNA ACCIÓN
return NextResponse.json({ ok: false, error: "UNKNOWN_ACTION" }, { status: 400 });

} catch (e: any) {
  return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
}
}

