import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function adminClient() {
  return createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false },
  });
}

async function uidFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;

  const sb = createClient(getEnv("NEXT_PUBLIC_SUPABASE_URL"), getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false },
  });

  const { data, error } = await sb.auth.getUser();
  if (error) throw error;
  return data.user?.id || null;
}

async function workerFromReq(req: Request) {
  const uid = await uidFromBearer(req);
  if (!uid) return null;
  const admin = adminClient();
  const { data, error } = await admin
    .from("workers")
    .select("id, user_id, display_name, email, role")
    .eq("user_id", uid)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function POST(req: Request) {
  try {
    const worker = await workerFromReq(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    if (!["admin", "central"].includes(String(worker.role || ""))) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const clienteId = String(body?.cliente_id || body?.id || "").trim();
    if (!clienteId) {
      return NextResponse.json({ ok: false, error: "FALTA_CLIENTE_ID" }, { status: 400 });
    }

    const admin = adminClient();
    const nowIso = new Date().toISOString();
    let updated = false;

    try {
      const { error } = await admin
        .from("crm_clientes")
        .update({
          lead_status: "contactado",
          lead_contacted_at: nowIso,
        })
        .eq("id", clienteId);
      if (error) throw error;
      updated = true;
    } catch {
      updated = false;
    }

    const authorName = String(worker.display_name || worker.email || "Equipo").trim() || "Equipo";
    const noteText = `✅ Lead contactado el ${new Date(nowIso).toLocaleString("es-ES")} por ${authorName}.`;

    try {
      await admin.from("crm_client_notes").insert({
        cliente_id: clienteId,
        texto: noteText,
        author_user_id: worker.user_id || null,
        author_name: authorName,
        author_email: worker.email || null,
        is_pinned: false,
      });
    } catch {
      // nota opcional
    }

    return NextResponse.json({ ok: true, updated });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "ERR" }, { status: 500 });
  }
}
