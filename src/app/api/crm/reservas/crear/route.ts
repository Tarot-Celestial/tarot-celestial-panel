import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";


export const runtime = "nodejs";

function getEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function uidFromBearer(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return { uid: null as string | null };

  const userClient = createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    }
  );

  const { data, error } = await userClient.auth.getUser(token);
  if (error) return { uid: null as string | null };
  return { uid: data.user?.id || null };
}

function adminDb() {
  return createClient(
    getEnv("NEXT_PUBLIC_SUPABASE_URL"),
    getEnv("SUPABASE_SERVICE_ROLE_KEY"),
    { auth: { persistSession: false } }
  );
}

async function getClienteById(db: ReturnType<typeof adminDb>, clienteId: string) {
  const candidates = ["crm_clientes", "clientes", "crm_clientes_panel"];

  for (const table of candidates) {
    const { data, error } = await db
      .from(table)
      .select("*")
      .eq("id", clienteId)
      .maybeSingle();

    if (!error && data) {
      const row: any = data;
      return {
        id: row.id,
        nombre: row.nombre || row.name || row.cliente_nombre || "",
        apellido: row.apellido || row.apellidos || row.last_name || "",
        telefono: row.telefono_normalizado || row.telefono || row.phone || "",
      };
    }

    const msg = String(error?.message || "").toLowerCase();
    if (
      msg.includes("schema cache") ||
      msg.includes("relation") ||
      msg.includes("does not exist") ||
      msg.includes("could not find the table")
    ) {
      continue;
    }

    if (error) throw error;
  }

  return null;
}

export async function POST(req: Request) {
  try {
    const { uid } = await uidFromBearer(req);
    if (!uid) {
      return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    }

    const db = adminDb();

    const { data: me, error: meErr } = await db
      .from("workers")
      .select("id, role, is_active")
      .eq("user_id", uid)
      .maybeSingle();

    if (meErr) throw meErr;
    if (!me || me.is_active === false || (me.role !== "admin" && me.role !== "central")) {
      return NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));

    const operationId = String(body?.operation_id || "").trim();
    if (operationId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId)) {
      return NextResponse.json({ ok: false, error: "Identificador de reserva no válido." }, { status: 400 });
    }
    const cliente_id = String(body?.cliente_id || "").trim();
    const tarotista_id = String(body?.tarotista_id || body?.tarotista_worker_id || "").trim() || null;
    const tarotista_nombre_manual = String(body?.tarotista_nombre_manual || "").trim() || null;
    const fecha_reserva = String(body?.fecha_reserva || "").trim();
    const nota = String(body?.nota || "").trim() || null;
    const notify_when_tarotista_idle = body?.notify_when_tarotista_idle === true;

    if (!/^[0-9a-f-]{36}$/i.test(cliente_id)) {
      return NextResponse.json({ ok: false, error: "CLIENTE_REQUIRED" }, { status: 400 });
    }
    if (!fecha_reserva) {
      return NextResponse.json({ ok: false, error: "FECHA_REQUIRED" }, { status: 400 });
    }
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(fecha_reserva) || !Number.isFinite(Date.parse(fecha_reserva))) {
      return NextResponse.json({ ok: false, error: "Selecciona una fecha y hora futuras." }, { status: 400 });
    }
    if (!tarotista_id && !tarotista_nombre_manual) {
      return NextResponse.json({ ok: false, error: "TAROTISTA_REQUIRED" }, { status: 400 });
    }

    if ((nota?.length || 0) > 2000 || (tarotista_nombre_manual?.length || 0) > 120) {
      return NextResponse.json({ ok: false, error: "La nota admite hasta 2.000 caracteres y el nombre hasta 120." }, { status: 400 });
    }
    if (tarotista_id && !/^[0-9a-f-]{36}$/i.test(tarotista_id)) {
      return NextResponse.json({ ok: false, error: "Selecciona una tarotista válida." }, { status: 400 });
    }
    const cliente = await getClienteById(db, cliente_id);
    if (!cliente) {
      return NextResponse.json({ ok: false, error: "CLIENTE_NOT_FOUND" }, { status: 404 });
    }

    let tarotista_nombre: string | null = null;
    if (tarotista_id) {
      const { data: tarotista, error: tarotistaErr } = await db
        .from("workers")
        .select("id, display_name, role, is_active")
        .eq("id", tarotista_id)
        .maybeSingle();

      if (tarotistaErr) throw tarotistaErr;
      if (!tarotista || tarotista.role !== "tarotista" || tarotista.is_active === false) {
        return NextResponse.json({ ok: false, error: "La tarotista ya no está activa. Selecciona otra." }, { status: 400 });
      }
      tarotista_nombre = tarotista.display_name || null;
    }

    const creatorId = me.id;
    const payload: Record<string, any> = {
      ...(operationId ? { id: operationId } : {}),
      cliente_id,
      cliente_nombre: [cliente?.nombre, cliente?.apellido].filter(Boolean).join(" ").trim() || null,
      telefono_normalizado: cliente?.telefono || null,
      tarotista_id,
      tarotista_nombre,
      tarotista_nombre_manual,
      fecha_reserva: new Date(fecha_reserva).toISOString(),
      // El aviso inteligente se controla con `notify_when_tarotista_idle`.
      // `esperando_tarotista` no forma parte del CHECK histórico de `reservas.estado`.
      estado: "pendiente",
      notify_when_tarotista_idle,
      ready_notified_at: null,
      nota,
      created_by_worker_id: creatorId,
    };

    async function replayExisting() {
      const { data: existing, error: lookupError } = await db.from("reservas").select("*").eq("id", operationId).maybeSingle();
      if (lookupError) throw lookupError;
      if (!existing) return null;
      const same = !existing.deleted_at && existing.created_by_worker_id === creatorId
        && existing.cliente_id === cliente_id && existing.tarotista_id === tarotista_id
        && existing.tarotista_nombre_manual === tarotista_nombre_manual
        && new Date(existing.fecha_reserva + (/(?:Z|[+-]\d{2}:\d{2})$/i.test(existing.fecha_reserva) ? "" : "Z")).getTime() === Date.parse(fecha_reserva)
        && existing.notify_when_tarotista_idle === notify_when_tarotista_idle && existing.nota === nota;
      if (!same) return NextResponse.json({ ok: false, error: "Esta petición ya corresponde a otra reserva. Actualiza la agenda." }, { status: 409 });
      return NextResponse.json({ ok: true, id: existing.id, reserva: existing, repeated: true }, { headers: { "Cache-Control": "no-store" } });
    }
    if (operationId) {
      const replay = await replayExisting();
      if (replay) return replay;
    }
    if (Date.parse(fecha_reserva) <= Date.now()) return NextResponse.json({ ok: false, error: "Selecciona una fecha y hora futuras." }, { status: 400 });
    const { data: inserted, error } = await db
      .from("reservas")
      .insert(payload)
      .select("*")
      .single();

    if (error?.code === "23505" && operationId) {
      const replay = await replayExisting();
      if (replay) return replay;
    }
    if (error) throw error;
    return NextResponse.json({ ok: true, id: inserted.id, reserva: inserted }, { headers: { "Cache-Control": "no-store" } });
  } catch (err: any) {
    console.error("[reservas/create]", err?.code || "UNKNOWN");
    return NextResponse.json(
      { ok: false, error: "No se pudo confirmar la reserva. Reintenta con los mismos datos o revisa la agenda antes de crear otra." },
      { status: 500 }
    );
  }
}
