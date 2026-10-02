import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";

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

  const { data } = getAuthUserFromRequest(req);
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

  return { ok: true as const, admin, actorId: me.id };
}

function roundMoney(n: any) {
  return Math.round((Number(n) || 0) * 100) / 100;
}

const EDITABLE_STATUSES = new Set(["draft", "pending", "review"]);
const ALLOWED_STATUSES = new Set(["draft", "pending", "review", "final", "paid"]);

function cleanText(value: unknown, fallback = "") {
  return String(value ?? fallback).trim().slice(0, 180);
}

async function getEditableInvoice(admin: any, invoiceId: string) {
  const { data, error } = await admin.from("invoices").select("id,status").eq("id", invoiceId).maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false as const, error: "INVOICE_NOT_FOUND", status: 404 };
  if (!EDITABLE_STATUSES.has(String(data.status || "draft"))) {
    return { ok: false as const, error: "La factura está cerrada. Vuelve a borrador para editar sus conceptos.", status: 409 };
  }
  return { ok: true as const };
}

function normalizeLineInput(body: any, currentMeta: any = {}) {
  const kind = cleanText(body?.kind, "adjustment") || "adjustment";
  const label = cleanText(body?.label);
  const sourceMeta = body?.meta && typeof body.meta === "object" ? body.meta : currentMeta || {};
  const meta = { ...sourceMeta };
  const rawAmount = Number(body?.amount ?? 0);
  if (!Number.isFinite(rawAmount)) throw new Error("Indica un importe válido.");
  if (kind === "incident" && !label) throw new Error("Indica el motivo de la incidencia.");
  let amount = roundMoney(rawAmount);

  if (kind === "bonus") {
    if (!label) throw new Error("El bonus necesita un nombre.");
    const mode = meta.bonus_mode === "units" ? "units" : "fixed";
    meta.bonus_mode = mode;
    meta.description = cleanText(meta.description, "").slice(0, 500);
    if (mode === "units") {
      const quantity = Number(meta.quantity);
      const unitRate = Number(meta.unit_rate);
      if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitRate) || unitRate < 0) {
        throw new Error("Indica una cantidad mayor que cero y un importe por unidad válido.");
      }
      meta.quantity = quantity;
      meta.unit_rate = roundMoney(unitRate);
      amount = roundMoney(quantity * unitRate);
    } else if (amount < 0) {
      throw new Error("Un bonus fijo no puede tener un importe negativo.");
    }
  }

  return { kind, label: label || "Ajuste", amount, meta };
}

// GET: devuelve factura + líneas para editar (admin)
export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });

    const u = new URL(req.url);
    const invoice_id = u.searchParams.get("invoice_id");
    if (!invoice_id) {
      return NextResponse.json({ ok: false, error: "MISSING_INVOICE_ID" }, { status: 400 });
    }

    const { admin } = gate;

    const { data: inv, error: ei } = await admin
      .from("invoices")
      .select(
        "id, worker_id, month_key, status, total, notes, updated_at, worker_ack, worker_ack_at, worker_ack_note"
      )
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

// All mutations lock the invoice and persist its lines, total and notification together.
export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
    const body = await req.json();
    const invoiceId = String(body.invoice_id || "");
    const action = String(body.action || "");
    let lineId = body.line_id || null;
    let data: any = body;
    if (action === "add_line") {
      if (!/^[0-9a-f-]{36}$/i.test(body.request_id || "")) throw new Error("Vuelve a abrir la factura antes de añadir el concepto.");
      lineId = body.request_id;
      data = normalizeLineInput(body);
    } else if (action === "update_line") {
      const { data: current, error } = await gate.admin.from("invoice_lines").select("*").eq("invoice_id", invoiceId).eq("id", lineId).maybeSingle();
      if (error || !current) throw new Error("No se ha encontrado el concepto.");
      data = normalizeLineInput({ ...current, ...body, kind: current.kind, meta: { ...current.meta, ...body.meta } });
      if (data.meta.minutes != null && data.meta.rate != null && current.kind !== "incident") {
        const minutes = Number(data.meta.minutes), rate = Number(data.meta.rate);
        if (!Number.isFinite(minutes) || !Number.isFinite(rate) || minutes < 0 || rate < 0) throw new Error("Minutos o tarifa no válidos.");
        data.amount = roundMoney(minutes * rate);
      }
    }
    const { data: result, error } = await gate.admin.rpc("invoice_edit_atomic", {
      p_invoice_id: invoiceId, p_actor_id: gate.actorId, p_action: action, p_line_id: lineId, p_data: data,
    });
    if (error) throw error;
    return NextResponse.json({ ok: true, ...result });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "No se pudo guardar la factura." }, { status: 400 });
  }
}
