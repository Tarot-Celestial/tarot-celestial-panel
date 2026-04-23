import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type Role = "admin" | "central" | "tarotista";

type MeWorker = {
  id: string;
  user_id: string | null;
  role: Role;
  display_name: string | null;
  email: string | null;
};

type ExtensionRow = Record<string, any>;

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
      context: "from-internal",
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const result = await insertExtensionRecord(admin, payload);
    if (result.error && !isMissingRelationError(result.error)) {
      throw result.error;
    }
  }
}

function normalizeExtensionRow(row: ExtensionRow) {
  const extension = sanitizeExtension(row?.extension || row?.id || row?.exten);
  const secret = String(row?.secret || row?.password || "").trim() || null;
  const label = String(row?.label || row?.name || "").trim() || null;
  const domain = String(row?.domain || process.env.NEXT_PUBLIC_SIP_DOMAIN || "sip.clientestarotcelestial.es").trim();
  const ws_server = String(row?.ws_server || process.env.NEXT_PUBLIC_SIP_WS_SERVER || "wss://sip.clientestarotcelestial.es:8089/ws").trim();
  return {
    ...row,
    id: String(row?.id || extension || crypto.randomUUID()),
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
  };
}

async function getAuthContext(req: Request) {
  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anon = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { ok: false as const, error: "NO_TOKEN" as const };

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

    await ensureDefaultExtensions(admin);
    const extensionsResult = await readExtensions(admin);
    const routingResult = await readRouting(admin);
    const queuesResult = await readQueues(admin);

    return NextResponse.json({
      ok: true,
      me,
      workers: workers || [],
      extensions: extensionsResult.rows.map(normalizeExtensionRow),
      routing: routingResult.rows,
      queues: queuesResult.queues,
      queueMembers: queuesResult.members,
      setupNeeded: extensionsResult.missingTable,
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
  const ws_server = String(body?.ws_server || "").trim();
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
    ws_server: ws_server || null,
    sip_uri,
    context: "from-internal",
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

  // 🔥 ROUTING
  const routingPayload = {
    extension,
    type: route_type,
    target: target_phone || null,
    queue_id,
    queue_priority,
    notes: routing_notes,
    is_active,
  };

  const routingRes = await admin
    .from("pbx_routing")
    .upsert(routingPayload, { onConflict: "extension" })
    .select("*")
    .maybeSingle();

  if (routingRes.error && !isMissingRelationError(routingRes.error)) {
    console.error("ROUTING ERROR:", routingRes.error);
    return NextResponse.json({ ok: false, error: routingRes.error.message });
  }

  return NextResponse.json({
    ok: true,
    extension: result.data,
    routing: routingRes.data || null,
  });
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

    if (!result.data) {
      const bootstrapPayload = {
        id: extension,
        extension,
        secret: getDefaultSecret(extension),
        password: getDefaultSecret(extension),
        name: `Extensión ${extension}`,
        label: `Extensión ${extension}`,
        context: "from-internal",
        is_active: true,
        ...runtimePatch,
      };

      result = await insertExtensionRecord(admin, bootstrapPayload);

      if (result.error) {
        console.error("RUNTIME INSERT ERROR:", result.error);
        return NextResponse.json({ ok: false, error: result.error.message }, { status: 200 });
      }
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
