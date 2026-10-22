export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { originMatchesBrand, type BrandKey } from "@/lib/server/brand-filter";
import { pendingMetaSubmissionAt, recentMetaSubmissions } from "@/lib/server/captacion-attention";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});
const HEADERS = { "Cache-Control": "private, no-store, max-age=0", Vary: "Authorization" };
const LEAD_BATCH_SIZE = 250;
type Row = Record<string, any>;

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

function rowsOrThrow(result: { data: unknown; error: unknown }): Row[] {
  if (result.error || !Array.isArray(result.data)) throw new Error("ATTENTION_UNAVAILABLE");
  return result.data;
}

async function attentionItems(worker: Row, brand: BrandKey, latest: Map<string, string>, now: number) {
  const ids = [...latest.keys()];
  const items: Array<{ id: string; cliente_id: string; nombre: string; latest_meta_lead_at: string }> = [];
  for (let offset = 0; offset < ids.length; offset += LEAD_BATCH_SIZE) {
    let query = supabase.from("captacion_leads")
      .select("id,cliente_id,origen,assigned_worker_id,last_contact_at,contacted_at,closed_at")
      .in("id", ids.slice(offset, offset + LEAD_BATCH_SIZE));
    if (worker.role === "central") {
      query = query.or(`assigned_worker_id.is.null,assigned_worker_id.eq.${worker.id}`);
    }
    const leads = rowsOrThrow(await query);
    // Filter again before fetching names; service-role access must not expose
    // another central's records even when assembling data across several tables.
    const allowed = leads.filter(lead => worker.role === "admin" || !lead.assigned_worker_id || String(lead.assigned_worker_id) === String(worker.id));
    const clientIds = [...new Set(allowed.map(lead => String(lead.cliente_id || "")).filter(Boolean))];
    const clients = clientIds.length
      ? rowsOrThrow(await supabase.from("crm_clientes").select("id,nombre,apellido,origen").in("id", clientIds))
      : [];
    const byClient = new Map(clients.map(client => [String(client.id), client]));
    for (const lead of allowed) {
      const timestamp = latest.get(String(lead.id));
      if (!timestamp) continue;
      const client = byClient.get(String(lead.cliente_id || ""));
      if (!originMatchesBrand(client?.origen || lead.origen, brand)) continue;
      if (!pendingMetaSubmissionAt(lead, timestamp, now)) continue;
      // A previous closed workflow stays untouched. A later form submission is
      // still a new request that needs the central's attention.
      items.push({
        id: String(lead.id),
        cliente_id: String(lead.cliente_id || ""),
        nombre: [client?.nombre, client?.apellido].filter(Boolean).join(" ").trim() || "Nuevo contacto",
        latest_meta_lead_at: timestamp,
      });
    }
  }
  return items.sort((a, b) => b.latest_meta_lead_at.localeCompare(a.latest_meta_lead_at) || a.id.localeCompare(b.id));
}

export async function GET(req: Request) {
  try {
    const authorization = req.headers.get("authorization") || "";
    const token = /^Bearer\s+(.+)$/i.exec(authorization)?.[1]?.trim();
    if (!token) return reply({ ok: false, error: "UNAUTHENTICATED" }, 401);
    const { data: auth, error: authError } = await supabase.auth.getUser(token);
    if (authError || !auth.user?.id) return reply({ ok: false, error: "UNAUTHENTICATED" }, 401);

    const { data: worker, error: workerError } = await supabase.from("workers")
      .select("id,role,is_active")
      .or(`user_id.eq.${auth.user.id},auth_user_id.eq.${auth.user.id}`)
      .eq("is_active", true)
      .in("role", ["admin", "central"])
      .limit(1)
      .maybeSingle();
    if (workerError) throw new Error("ATTENTION_UNAVAILABLE");
    if (!worker || !worker.is_active || !["central", "admin"].includes(worker.role)) {
      return reply({ ok: false, error: "UNAUTHENTICATED" }, 401);
    }
    const brand = new URL(req.url).searchParams.get("brand") || "celestial";
    if (brand !== "celestial" && brand !== "orion") return reply({ ok: false, error: "INVALID_BRAND" }, 400);
    const now = Date.now();
    const items = await attentionItems(worker, brand, await recentMetaSubmissions(supabase, now), now);
    return reply({ ok: true, items, server_time: new Date(now).toISOString(), worker_id: String(worker.id), user_id: auth.user.id, brand });
  } catch {
    // The caller must retain its last good state on a read failure. An empty
    // success would incorrectly dismiss reminders; raw database errors may leak data.
    return reply({ ok: false, error: "ATTENTION_UNAVAILABLE" }, 503);
  }
}
