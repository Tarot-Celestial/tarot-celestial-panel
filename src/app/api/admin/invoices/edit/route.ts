import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function uidFromBearer(req: Request) {
  const supabaseUrl = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");

  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { uid: null as string | null };

  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data } = await userClient.auth.getUser();
  return { uid: data.user?.id || null };
}

async function requireAdmin(req: Request) {
  const { uid } = await uidFromBearer(req);
  if (!uid) return { ok: false as const, error: "NO_AUTH" as const };

  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data: me, error } = await admin
    .from("workers")
    .select("id, role")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  if (!me || me.role !== "admin") return { ok: false as const, error: "FORBIDDEN" as const };

  return { ok: true as const, admin };
}

// GET: devuelve factura + líneas para editar (admin)
export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });

    const u = new URL(req.url);
    const invoice_id = u.searchParams.get("invoice_id");
    if (!invoice_id) return NextResponse.json({ ok: false, error: "MISSING_INVOICE_ID" }, { status: 400 });

    const { admin } = gate;

    const { data: inv, error: ei } = await admin
      .from("invoices")
      .select("id, worker_id, month_key, status, total, notes, updated_at")
      .eq("id", invoice_id)
      .maybeSingle();

    if (ei) throw ei;
    if (!inv) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });

    const { data: w, error: ew } = await admin
      .from("workers")
      .select("id, display_name, role")
      .eq("id", inv.worker_id)
      .maybeSingle();
    if (ew) throw ew;

    const { data: lines, error: el } = await admin
      .from("invoice_lines")
      .select("id, kind, label, amount, meta, created_at")
      .eq("invoice_id", invoice_id)
      .order("created_at", { ascending: true });

    if (el) throw el;

    return NextResponse.json({ ok: true, invoice: inv, worker: w, lines: lines || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}

// POST: acciones de edición
// body: { action: 'add_line'|'update_line'|'delete_line'|'set_status'|'set_notes', ... }
export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });

    const { admin } = gate;

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    const invoice_id = String(body?.invoice_id || "");
    if (!invoice_id) return NextResponse.json({ ok: false, error: "MISSING_INVOICE_ID" }, { status: 400 });

    if (action === "add_line") {
      const kind = String(body?.kind || "adjustment");
      const label = String(body?.label || "Ajuste");
      const amount = Number(body?.amount || 0);
      const meta = body?.meta ?? {};

      const { error } = await admin.from("invoice_lines").insert({
        invoice_id,
        kind,
        label,
        amount,
        meta,
      });
      if (error) throw error;

      const { data: total, error: er } = await admin.rpc("recalc_invoice_total", { p_invoice_id: invoice_id });
      if (er) throw er;

      return NextResponse.json({ ok: true, total });
    }

    if (action === "update_line") {
      const line_id = String(body?.line_id || "");
      if (!line_id) return NextResponse.json({ ok: false, error: "MISSING_LINE_ID" }, { status: 400 });

      const patch: any = {};
      if (body?.label !== undefined) patch.label = String(body.label);
      if (body?.amount !== undefined) patch.amount = Number(body.amount);
      if (body?.kind !== undefined) patch.kind = String(body.kind);

      const { error } = await admin.from("invoice_lines").update(patch).eq("id", line_id);
      if (error) throw error;

      const { data: total, error: er } = await admin.rpc("recalc_invoice_total", { p_invoice_id: invoice_id });
      if (er) throw er;

      return NextResponse.json({ ok: true, total });
    }

    if (action === "delete_line") {
      const line_id = String(body?.line_id || "");
      if (!line_id) return NextResponse.json({ ok: false, error: "MISSING_LINE_ID" }, { status: 400 });

      const { error } = await admin.from("invoice_lines").delete().eq("id", line_id);
      if (error) throw error;

      const { data: total, error: er } = await admin.rpc("recalc_invoice_total", { p_invoice_id: invoice_id });
      if (er) throw er;

      return NextResponse.json({ ok: true, total });
    }

    if (action === "set_status") {
      const status = String(body?.status || "draft");
      const { error } = await admin.from("invoices").update({ status }).eq("id", invoice_id);
      if (error) throw error;

      return NextResponse.json({ ok: true });
    }

    if (action === "set_notes") {
      const notes = String(body?.notes || "");
      const { error } = await admin.from("invoices").update({ notes }).eq("id", invoice_id);
      if (error) throw error;

      return NextResponse.json({ ok: true });
    }

    return NextResponse.json({ ok: false, error: "UNKNOWN_ACTION" }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
