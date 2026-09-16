import { NextResponse } from "next/server";
import { getAdminClient, workerFromRequest } from "@/lib/server/auth-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ROLES = new Set(["central", "admin"]);
const ALLOWED_ACTIONS = new Set(["confirm", "postpone", "complete", "cancel", "no_show"]);

function clean(value: unknown, max = 500) {
  return String(value ?? "").trim().slice(0, max);
}

function cleanBrand(value: unknown) {
  const brand = clean(value || "celestial", 40).toLowerCase().replace(/[^a-z0-9_-]/g, "");
  return brand || "celestial";
}

function normalizePhone(value: unknown) {
  const raw = clean(value, 80);
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 6 ? digits : "";
}

function normalizeName(value: unknown) {
  return clean(value, 160)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function clientKey(name: unknown, phone: unknown) {
  const normalizedPhone = normalizePhone(phone);
  if (normalizedPhone) return `phone:${normalizedPhone}`;
  const normalizedName = normalizeName(name);
  return normalizedName ? `name:${normalizedName}` : "";
}

function validDate(value: unknown) {
  const text = clean(value, 80);
  const time = Date.parse(text);
  return text && Number.isFinite(time) ? new Date(time).toISOString() : null;
}

async function assertStaff(req: Request) {
  const me = await workerFromRequest(req);
  if (!me) return { response: NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 }), me: null };
  if (!ALLOWED_ROLES.has(String(me.role || ""))) {
    return { response: NextResponse.json({ ok: false, error: "FORBIDDEN" }, { status: 403 }), me: null };
  }
  return { response: null, me };
}

export async function GET(req: Request) {
  try {
    const gate = await assertStaff(req);
    if (gate.response) return gate.response;
    const me = gate.me!;
    const db = getAdminClient();
    const url = new URL(req.url);
    const brand = cleanBrand(url.searchParams.get("brand"));

    const [{ data: rows, error: rowsError }, { data: tarotists, error: tarotistsError }] = await Promise.all([
      db
        .from("first_tarotist_reservations")
        .select("id, reservation_number, brand, client_name, phone, client_key, tarotista_id, tarotista_name, scheduled_at, original_scheduled_at, status, notes, postpone_reason, postponed_count, free_consult_used, free_consult_used_at, completed_at, created_at, updated_at")
        .eq("brand", brand)
        .order("scheduled_at", { ascending: true })
        .order("reservation_number", { ascending: true })
        .limit(1000),
      db
        .from("workers")
        .select("id, display_name, team")
        .eq("role", "tarotista")
        .eq("is_active", true)
        .order("display_name", { ascending: true }),
    ]);

    if (rowsError) throw rowsError;
    if (tarotistsError) throw tarotistsError;

    return NextResponse.json(
      { ok: true, brand, rows: rows || [], tarotists: tarotists || [], worker_id: me.id },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error: any) {
    console.error("[first-tarotist-reservations][GET]", error);
    return NextResponse.json({ ok: false, error: error?.message || "ERR" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await assertStaff(req);
    if (gate.response) return gate.response;
    const me = gate.me!;
    const db = getAdminClient();
    const body = await req.json().catch(() => ({}));
    const action = clean(body?.action, 30).toLowerCase();
    const brand = cleanBrand(body?.brand);

    if (action === "create") {
      const clientName = clean(body?.client_name, 160);
      const phoneRaw = clean(body?.phone, 80);
      const tarotistaId = clean(body?.tarotista_id, 80);
      const scheduledAt = validDate(body?.scheduled_at);
      const notes = clean(body?.notes, 1200) || null;
      const key = clientKey(clientName, phoneRaw);

      if (!key) return NextResponse.json({ ok: false, error: "Escribe el nombre o el teléfono de la clienta." }, { status: 400 });
      if (!tarotistaId) return NextResponse.json({ ok: false, error: "Selecciona una tarotista." }, { status: 400 });
      if (!scheduledAt) return NextResponse.json({ ok: false, error: "Fecha de reserva no válida." }, { status: 400 });

      const { data: tarotist, error: tarotistError } = await db
        .from("workers")
        .select("id, display_name, role, is_active")
        .eq("id", tarotistaId)
        .maybeSingle();
      if (tarotistError) throw tarotistError;
      if (!tarotist || tarotist.role !== "tarotista" || tarotist.is_active === false) {
        return NextResponse.json({ ok: false, error: "La tarotista seleccionada no está disponible." }, { status: 400 });
      }

      const { data: existing, error: existingError } = await db
        .from("first_tarotist_reservations")
        .select("id, reservation_number, tarotista_name, status, free_consult_used, scheduled_at")
        .eq("brand", brand)
        .eq("tarotista_id", tarotistaId)
        .eq("client_key", key)
        .maybeSingle();
      if (existingError) throw existingError;
      if (existing) {
        return NextResponse.json(
          {
            ok: false,
            code: existing.free_consult_used ? "FIRST_CONSULT_ALREADY_USED" : "RESERVATION_ALREADY_EXISTS",
            error: existing.free_consult_used
              ? "Esta clienta ya utilizó su primera consulta gratis con esta tarotista."
              : "Esta clienta ya tiene una reserva/registro con esta tarotista.",
            existing,
          },
          { status: 409 }
        );
      }

      const payload = {
        brand,
        client_name: clientName || phoneRaw || "Clienta",
        phone: phoneRaw || null,
        client_key: key,
        tarotista_id: tarotistaId,
        tarotista_name: tarotist.display_name || "Tarotista",
        scheduled_at: scheduledAt,
        original_scheduled_at: scheduledAt,
        status: "pendiente",
        notes,
        postpone_reason: null,
        postponed_count: 0,
        free_consult_used: false,
        free_consult_used_at: null,
        completed_at: null,
        created_by_worker_id: me.id,
        updated_by_worker_id: me.id,
      };

      const { data: row, error } = await db
        .from("first_tarotist_reservations")
        .insert(payload)
        .select("id, reservation_number, brand, client_name, phone, client_key, tarotista_id, tarotista_name, scheduled_at, original_scheduled_at, status, notes, postpone_reason, postponed_count, free_consult_used, free_consult_used_at, completed_at, created_at, updated_at")
        .single();
      if (error) {
        if (String(error.code || "") === "23505") {
          return NextResponse.json({ ok: false, code: "RESERVATION_ALREADY_EXISTS", error: "Esta clienta ya tiene un registro con esta tarotista." }, { status: 409 });
        }
        throw error;
      }

      return NextResponse.json({ ok: true, row });
    }

    if (!ALLOWED_ACTIONS.has(action)) {
      return NextResponse.json({ ok: false, error: "ACTION_NOT_ALLOWED" }, { status: 400 });
    }

    const id = clean(body?.id, 80);
    if (!id) return NextResponse.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });

    const { data: current, error: currentError } = await db
      .from("first_tarotist_reservations")
      .select("*")
      .eq("id", id)
      .eq("brand", brand)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) return NextResponse.json({ ok: false, error: "RESERVATION_NOT_FOUND" }, { status: 404 });

    if (current.free_consult_used && action !== "complete") {
      return NextResponse.json({ ok: false, error: "La primera consulta gratis ya fue utilizada. Este registro está cerrado." }, { status: 409 });
    }

    const now = new Date().toISOString();
    const note = clean(body?.note, 1200) || null;
    const updates: Record<string, any> = { updated_by_worker_id: me.id, updated_at: now };

    if (action === "confirm") {
      updates.status = "confirmada";
    }

    if (action === "postpone") {
      const newScheduledAt = validDate(body?.new_scheduled_at);
      if (!newScheduledAt) return NextResponse.json({ ok: false, error: "Indica la nueva fecha y hora." }, { status: 400 });
      updates.status = "aplazada";
      updates.scheduled_at = newScheduledAt;
      updates.original_scheduled_at = current.original_scheduled_at || current.scheduled_at;
      updates.postponed_count = Number(current.postponed_count || 0) + 1;
      updates.postpone_reason = note;
      if (note) updates.notes = current.notes ? `${current.notes}\nAplazamiento: ${note}` : `Aplazamiento: ${note}`;
    }

    if (action === "complete") {
      if (current.free_consult_used) {
        return NextResponse.json({ ok: false, code: "FIRST_CONSULT_ALREADY_USED", error: "La primera consulta gratis ya estaba marcada como utilizada." }, { status: 409 });
      }
      updates.status = "cumplida";
      updates.free_consult_used = true;
      updates.free_consult_used_at = now;
      updates.completed_at = now;
      if (note) updates.notes = current.notes ? `${current.notes}\nCierre: ${note}` : `Cierre: ${note}`;
    }

    if (action === "cancel") {
      updates.status = "cancelada";
      if (note) updates.notes = current.notes ? `${current.notes}\nCancelación: ${note}` : `Cancelación: ${note}`;
    }

    if (action === "no_show") {
      updates.status = "no_presentada";
      if (note) updates.notes = current.notes ? `${current.notes}\nNo presentada: ${note}` : `No presentada: ${note}`;
    }

    const { data: row, error } = await db
      .from("first_tarotist_reservations")
      .update(updates)
      .eq("id", id)
      .select("id, reservation_number, brand, client_name, phone, client_key, tarotista_id, tarotista_name, scheduled_at, original_scheduled_at, status, notes, postpone_reason, postponed_count, free_consult_used, free_consult_used_at, completed_at, created_at, updated_at")
      .single();
    if (error) throw error;

    return NextResponse.json({ ok: true, row });
  } catch (error: any) {
    console.error("[first-tarotist-reservations][POST]", error);
    return NextResponse.json({ ok: false, error: error?.message || "ERR" }, { status: 500 });
  }
}
