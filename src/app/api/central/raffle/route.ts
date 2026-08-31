import { NextResponse } from "next/server";
import { getServiceClient } from "@/lib/admin/require-admin";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CLIENT_SELECT = "id,nombre,apellido,telefono,telefono_normalizado,email,auth_user_id";

function digitsOnly(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function isUuid(value: unknown) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

async function requireCentral(req: Request) {
  const user = getAuthUserFromRequest(req).data.user;
  if (!user?.id) return { ok: false as const, status: 401, error: "NO_AUTH" };

  const admin = getServiceClient();
  let result = await admin
    .from("workers")
    .select("id,role,display_name,email,is_active")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!result.data && user.email) {
    result = await admin
      .from("workers")
      .select("id,role,display_name,email,is_active")
      .ilike("email", user.email)
      .maybeSingle();
  }
  if (result.error) throw result.error;
  if (!result.data || !["central", "admin"].includes(String(result.data.role || "").toLowerCase())) {
    return { ok: false as const, status: 403, error: "FORBIDDEN" };
  }
  return { ok: true as const, admin, worker: result.data };
}

async function getOrCreateActiveRaffle(admin: ReturnType<typeof getServiceClient>, workerId: string) {
  const current = await admin
    .from("raffles")
    .select("id,title,status,max_number,created_at,updated_at")
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (current.error) throw current.error;
  if (current.data) return current.data;

  const created = await admin
    .from("raffles")
    .insert({ title: "Sorteo actual", status: "active", max_number: 40, created_by_worker_id: workerId })
    .select("id,title,status,max_number,created_at,updated_at")
    .single();
  if (!created.error) return created.data;
  if (created.error.code !== "23505") throw created.error;

  const concurrent = await admin
    .from("raffles")
    .select("id,title,status,max_number,created_at,updated_at")
    .eq("status", "active")
    .limit(1)
    .single();
  if (concurrent.error) throw concurrent.error;
  return concurrent.data;
}

async function loadEntries(admin: ReturnType<typeof getServiceClient>, raffleId: string) {
  const result = await admin
    .from("raffle_entries")
    .select("id,raffle_id,raffle_number,client_id,assigned_at,client:crm_clientes!raffle_entries_client_id_fkey(id,nombre,apellido,telefono,telefono_normalizado,email)")
    .eq("raffle_id", raffleId)
    .order("raffle_number", { ascending: true });
  if (result.error) throw result.error;
  return result.data || [];
}

export async function GET(req: Request) {
  try {
    const gate = await requireCentral(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });

    const url = new URL(req.url);
    const search = digitsOnly(url.searchParams.get("search"));
    if (search) {
      if (search.length < 4) return NextResponse.json({ ok: true, clients: [] });
      const tail = search.slice(-9);
      const result = await gate.admin
        .from("crm_clientes")
        .select(CLIENT_SELECT)
        .or(`telefono.ilike.%${tail}%,telefono_normalizado.ilike.%${tail}%`)
        .order("updated_at", { ascending: false })
        .limit(8);
      if (result.error) throw result.error;
      return NextResponse.json({
        ok: true,
        clients: (result.data || []).map((client: any) => ({
          id: client.id,
          name: [client.nombre, client.apellido].filter(Boolean).join(" ").trim() || "Cliente sin nombre",
          phone: client.telefono || client.telefono_normalizado || "",
          email: client.email || null,
          auth_user_id: client.auth_user_id || null,
        })),
      });
    }

    const raffle = await getOrCreateActiveRaffle(gate.admin, gate.worker.id);
    const entries = await loadEntries(gate.admin, raffle.id);
    return NextResponse.json({ ok: true, raffle, entries });
  } catch (error: any) {
    console.error("[central:raffle:get]", error);
    return NextResponse.json({ ok: false, error: error?.message || "ERR_RAFFLE_LOAD" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireCentral(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: gate.status });
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const raffle = await getOrCreateActiveRaffle(gate.admin, gate.worker.id);

    if (action === "extend") {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const current = await gate.admin.from("raffles").select("max_number").eq("id", raffle.id).single();
        if (current.error) throw current.error;
        const before = Number(current.data.max_number || 40);
        if (before >= 10000) return NextResponse.json({ ok: false, error: "Se alcanzó el máximo de 10.000 números." }, { status: 400 });
        const updated = await gate.admin
          .from("raffles")
          .update({ max_number: before + 40, updated_at: new Date().toISOString() })
          .eq("id", raffle.id)
          .eq("max_number", before)
          .select("max_number")
          .maybeSingle();
        if (updated.error) throw updated.error;
        if (updated.data) return NextResponse.json({ ok: true, max_number: updated.data.max_number });
      }
      return NextResponse.json({ ok: false, error: "Otro usuario amplió el sorteo al mismo tiempo. Actualiza y vuelve a intentarlo." }, { status: 409 });
    }

    if (action === "assign") {
      const raffleNumber = Number(body.raffle_number);
      const clientId = String(body.client_id || "");
      if (!Number.isSafeInteger(raffleNumber) || raffleNumber < 1 || raffleNumber > Number(raffle.max_number)) {
        return NextResponse.json({ ok: false, error: "Número de sorteo inválido." }, { status: 400 });
      }
      if (!isUuid(clientId)) return NextResponse.json({ ok: false, error: "Cliente inválido." }, { status: 400 });

      const client = await gate.admin.from("crm_clientes").select(CLIENT_SELECT).eq("id", clientId).maybeSingle();
      if (client.error) throw client.error;
      if (!client.data) return NextResponse.json({ ok: false, error: "No encontramos la ficha del cliente." }, { status: 404 });

      const inserted = await gate.admin
        .from("raffle_entries")
        .insert({
          raffle_id: raffle.id,
          raffle_number: raffleNumber,
          client_id: clientId,
          client_auth_user_id: client.data.auth_user_id || null,
          assigned_by_worker_id: gate.worker.id,
        })
        .select("id,raffle_id,raffle_number,client_id,assigned_at")
        .single();
      if (inserted.error?.code === "23505") {
        return NextResponse.json({ ok: false, error: `El número ${raffleNumber} ya está utilizado.` }, { status: 409 });
      }
      if (inserted.error) throw inserted.error;

      return NextResponse.json({
        ok: true,
        entry: {
          ...inserted.data,
          client: client.data,
        },
      });
    }

    return NextResponse.json({ ok: false, error: "Acción inválida." }, { status: 400 });
  } catch (error: any) {
    console.error("[central:raffle:post]", error);
    return NextResponse.json({ ok: false, error: error?.message || "ERR_RAFFLE_ACTION" }, { status: 500 });
  }
}
