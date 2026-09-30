import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";

const CATEGORIES = new Set([
  "movement",
  "business",
  "origin",
  "destination",
  "payment_method",
  "type",
  "operation_mode",
]);

function cleanCategory(value: unknown) {
  const category = String(value || "").trim();
  if (!CATEGORIES.has(category)) throw new Error("INVALID_CATEGORY");
  return category;
}

function cleanLabel(value: unknown) {
  const label = String(value || "").trim().replace(/\s+/g, " ");
  if (!label) throw new Error("LABEL_REQUIRED");
  if (label.length > 80) throw new Error("LABEL_TOO_LONG");
  return label;
}

function statusFor(error: string) {
  if (["INVALID_CATEGORY", "LABEL_REQUIRED", "LABEL_TOO_LONG", "INVALID_DIRECTION", "ID_REQUIRED", "INVALID_SORT_ORDER"].includes(error)) return 400;
  if (error === "OPTION_NOT_FOUND") return 404;
  if (error === "OPTION_ALREADY_EXISTS") return 409;
  return 500;
}

const SELECT = "id, category, label, metadata, is_active, sort_order, created_at, updated_at";

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
    const includeArchived = new URL(req.url).searchParams.get("include_archived") === "1";
    let query = gate.admin.from("accounting_movement_options").select(SELECT);
    if (!includeArchived) query = query.eq("is_active", true);
    const { data, error } = await query.order("category", { ascending: true }).order("sort_order", { ascending: true }).order("created_at", { ascending: true });
    if (error) throw error;
    return NextResponse.json({ ok: true, options: data || [] });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const category = cleanCategory(body.category);
    const label = cleanLabel(body.label);
    const metadata: Record<string, string> = {};
    if (category === "movement") {
      const direction = String(body.direction || "").trim().toLowerCase();
      if (!["income", "expense", "transfer"].includes(direction)) throw new Error("INVALID_DIRECTION");
      metadata.direction = direction;
    }
    const { data: duplicate, error: duplicateError } = await gate.admin.from("accounting_movement_options").select("id,is_active").eq("category", category).ilike("label", label).maybeSingle();
    if (duplicateError) throw duplicateError;
    if (duplicate?.is_active) throw new Error("OPTION_ALREADY_EXISTS");
    if (duplicate && !duplicate.is_active) {
      const { data, error } = await gate.admin.from("accounting_movement_options").update({ is_active: true, metadata, updated_at: new Date().toISOString() }).eq("id", duplicate.id).select(SELECT).single();
      if (error) throw error;
      return NextResponse.json({ ok: true, option: data, restored: true });
    }
    const { data: last } = await gate.admin.from("accounting_movement_options").select("sort_order").eq("category", category).order("sort_order", { ascending: false }).limit(1).maybeSingle();
    const { data, error } = await gate.admin.from("accounting_movement_options").insert({ category, label, metadata, sort_order: Number(last?.sort_order || 0) + 10 }).select(SELECT).single();
    if (error) throw error;
    return NextResponse.json({ ok: true, option: data });
  } catch (e: any) {
    const message = e?.message || "ERR";
    return NextResponse.json({ ok: false, error: message }, { status: statusFor(message) });
  }
}

export async function PATCH(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    if (!id) throw new Error("ID_REQUIRED");
    const { data: current, error: currentError } = await gate.admin.from("accounting_movement_options").select(SELECT).eq("id", id).maybeSingle();
    if (currentError) throw currentError;
    if (!current) throw new Error("OPTION_NOT_FOUND");
    const update: any = { updated_at: new Date().toISOString() };
    if (body.label !== undefined) {
      const label = cleanLabel(body.label);
      const { data: duplicate, error: duplicateError } = await gate.admin.from("accounting_movement_options").select("id").eq("category", current.category).ilike("label", label).eq("is_active", true).neq("id", id).maybeSingle();
      if (duplicateError) throw duplicateError;
      if (duplicate) throw new Error("OPTION_ALREADY_EXISTS");
      update.label = label;
    }
    if (body.sort_order !== undefined) {
      const sortOrder = Number(body.sort_order);
      if (!Number.isFinite(sortOrder)) throw new Error("INVALID_SORT_ORDER");
      update.sort_order = Math.round(sortOrder);
    }
    if (body.is_active !== undefined) update.is_active = Boolean(body.is_active);
    if (body.direction !== undefined && current.category === "movement") {
      const direction = String(body.direction || "").trim().toLowerCase();
      if (!["income", "expense", "transfer"].includes(direction)) throw new Error("INVALID_DIRECTION");
      update.metadata = { ...(current.metadata || {}), direction };
    }
    const { data, error } = await gate.admin.from("accounting_movement_options").update(update).eq("id", id).select(SELECT).single();
    if (error) throw error;
    return NextResponse.json({ ok: true, option: data });
  } catch (e: any) {
    const message = e?.message || "ERR";
    return NextResponse.json({ ok: false, error: message }, { status: statusFor(message) });
  }
}

export async function DELETE(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || "").trim();
    if (!id) throw new Error("ID_REQUIRED");
    const { data, error } = await gate.admin.from("accounting_movement_options").update({ is_active: false, updated_at: new Date().toISOString() }).eq("id", id).eq("is_active", true).select("id").maybeSingle();
    if (error) throw error;
    if (!data) throw new Error("OPTION_NOT_FOUND");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    const message = e?.message || "ERR";
    return NextResponse.json({ ok: false, error: message }, { status: statusFor(message) });
  }
}
