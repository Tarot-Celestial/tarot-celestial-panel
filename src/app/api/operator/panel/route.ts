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

function getEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function isMissingRelationError(error: any) {
  const msg = String(error?.message || "").toLowerCase();
  return msg.includes("does not exist") || msg.includes("could not find the table") || msg.includes("relation");
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
    .select("id, worker_id, label, extension, secret, domain, ws_server, sip_uri, is_active, registered, status, active_call_count, active_call_started_at, incoming_number, talking_to, last_seen_at, created_at, updated_at")
    .order("extension", { ascending: true });

  if (error) {
    if (isMissingRelationError(error)) return { rows: [], missingTable: true };
    throw error;
  }

  return { rows: data || [], missingTable: false };
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

    const extensionsResult = await readExtensions(admin);

    return NextResponse.json({
      ok: true,
      me,
      workers: workers || [],
      extensions: extensionsResult.rows,
      setupNeeded: extensionsResult.missingTable,
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

      const id = String(body?.id || "").trim() || null;
      const worker_id = String(body?.worker_id || "").trim() || null;
      const extension = String(body?.extension || "").trim();
      const secret = String(body?.secret || "").trim();
      const label = String(body?.label || "").trim() || null;
      const domain = String(body?.domain || "").trim();
      const ws_server = String(body?.ws_server || "").trim();
      const sip_uri = extension && domain ? `sip:${extension}@${domain}` : null;
      const is_active = body?.is_active !== undefined ? !!body.is_active : true;

      if (!extension) {
        return NextResponse.json({ ok: false, error: "EXTENSION_REQUIRED" }, { status: 400 });
      }
      if (!secret) {
        return NextResponse.json({ ok: false, error: "SECRET_REQUIRED" }, { status: 400 });
      }
      if (!domain) {
        return NextResponse.json({ ok: false, error: "DOMAIN_REQUIRED" }, { status: 400 });
      }
      if (!ws_server) {
        return NextResponse.json({ ok: false, error: "WS_SERVER_REQUIRED" }, { status: 400 });
      }

      const duplicate = await admin
        .from("pbx_extensions")
        .select("id, extension")
        .eq("extension", extension)
        .neq("id", id || "00000000-0000-0000-0000-000000000000")
        .maybeSingle();

      if (duplicate.error && !isMissingRelationError(duplicate.error)) throw duplicate.error;
      if (duplicate.data?.id) {
        return NextResponse.json({ ok: false, error: "Ya existe una extensión con ese número." }, { status: 409 });
      }

      const payload: any = {
        worker_id,
        extension,
        secret,
        label,
        domain,
        ws_server,
        sip_uri,
        is_active,
        updated_at: new Date().toISOString(),
      };

      let data: any = null;
      let error: any = null;

      if (id) {
        const result = await admin.from("pbx_extensions").update(payload).eq("id", id).select("*").maybeSingle();
        data = result.data;
        error = result.error;
      } else {
        const result = await admin.from("pbx_extensions").insert(payload).select("*").maybeSingle();
        data = result.data;
        error = result.error;
      }

      if (error) throw error;

      return NextResponse.json({ ok: true, extension: data });
    }

    if (action === "update_runtime") {
      const extension = String(body?.extension || "").trim();
      if (!extension) {
        return NextResponse.json({ ok: false, error: "EXTENSION_REQUIRED" }, { status: 400 });
      }

      const runtimePatch: any = {
        registered: body?.registered !== undefined ? !!body.registered : undefined,
        status: body?.status !== undefined ? String(body.status || "").trim() : undefined,
        active_call_count: body?.active_call_count !== undefined ? Number(body.active_call_count || 0) : undefined,
        active_call_started_at: body?.active_call_started_at !== undefined ? body.active_call_started_at || null : undefined,
        incoming_number: body?.incoming_number !== undefined ? String(body.incoming_number || "").trim() || null : undefined,
        talking_to: body?.talking_to !== undefined ? String(body.talking_to || "").trim() || null : undefined,
        last_seen_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      Object.keys(runtimePatch).forEach((key) => runtimePatch[key] === undefined && delete runtimePatch[key]);

      const { data, error } = await admin
        .from("pbx_extensions")
        .update(runtimePatch)
        .eq("extension", extension)
        .select("id, extension, status, registered, active_call_count, active_call_started_at, incoming_number, talking_to, last_seen_at")
        .maybeSingle();

      if (error) throw error;

      return NextResponse.json({ ok: true, extension: data || null });
    }

    return NextResponse.json({ ok: false, error: "UNKNOWN_ACTION" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}

