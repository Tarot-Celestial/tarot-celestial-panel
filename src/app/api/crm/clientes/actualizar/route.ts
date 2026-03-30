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
    auth: { persistSession: false },
  });

  const { data } = await userClient.auth.getUser();
  return { uid: data.user?.id || null };
}

async function requireCentralOrAdmin(req: Request) {
  const { uid } = await uidFromBearer(req);
  if (!uid) return { ok: false as const, error: "NO_AUTH" as const };

  const url = getEnv("NEXT_PUBLIC_SUPABASE_URL");
  const service = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  const admin = createClient(url, service, { auth: { persistSession: false } });

  const { data: me, error } = await admin
    .from("workers")
    .select("id, role, display_name")
    .eq("user_id", uid)
    .maybeSingle();

  if (error) throw error;
  if (!me) return { ok: false as const, error: "NO_WORKER" as const };
  if (me.role !== "admin" && me.role !== "central") {
    return { ok: false as const, error: "FORBIDDEN" as const };
  }

  return { ok: true as const, admin, me };
}

function toNullableText(v: any) {
  const s = String(v ?? "").trim();
  return s || null;
}

function toNumberOrZero(v: any) {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export async function POST(req: Request) {
  try {
    const gate = await requireCentralOrAdmin(req);
    if (!gate.ok) {
      const status =
        gate.error === "NO_AUTH" ? 401 :
        gate.error === "FORBIDDEN" ? 403 :
        404;

      return NextResponse.json({ ok: false, error: gate.error }, { status });
    }

    const body = await req.json().catch(() => ({}));

    const id = String(body?.id || "").trim();
    if (!id) {
      return NextResponse.json({ ok: false, error: "MISSING_ID" }, { status: 400 });
    }

    const patch: any = {
      updated_at: new Date().toISOString(),
    };

    if (body?.nombre !== undefined) patch.nombre = toNullableText(body.nombre);
    if (body?.apellido !== undefined) patch.apellido = toNullableText(body.apellido);
    if (body?.telefono !== undefined) patch.telefono = toNullableText(body.telefono);
    if (body?.pais !== undefined) patch.pais = toNullableText(body.pais);
    if (body?.email !== undefined) patch.email = toNullableText(body.email);
    if (body?.notas !== undefined) patch.notas = toNullableText(body.notas);
    if (body?.origen !== undefined) patch.origen = toNullableText(body.origen);

    if (body?.deuda_pendiente !== undefined) {
      patch.deuda_pendiente = toNumberOrZero(body.deuda_pendiente);
    }
    if (body?.minutos_free_pendientes !== undefined) {
      patch.minutos_free_pendientes = toNumberOrZero(body.minutos_free_pendientes);
    }
    if (body?.minutos_normales_pendientes !== undefined) {
      patch.minutos_normales_pendientes = toNumberOrZero(body.minutos_normales_pendientes);
    }

    const { data: updated, error } = await gate.admin
      .from("crm_clientes")
      .update(patch)
      .eq("id", id)
      .select("*")
      .maybeSingle();

    if (error) throw error;
    if (!updated) {
      return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      cliente: updated,
    });
  } catch (e: any) {
    return NextResponse.json(
      { ok: false, error: e?.message || "ERR" },
      { status: 500 }
    );
  }
}
