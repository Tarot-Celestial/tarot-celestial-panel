import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getAuthUserFromRequest } from "@/lib/server/auth-fast";
import { averageClientFidelity, loadClientFidelityBatch } from "@/lib/server/client-fidelity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function env(name: string) { const value = process.env[name]; if (!value) throw new Error(`Missing env var: ${name}`); return value; }
function adminClient() { return createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } }); }

async function authenticatedCentral(req: Request) {
  const { data, error } = getAuthUserFromRequest(req);
  if (error || !data.user?.id) return null;
  const admin = adminClient();
  const { data: rows, error: workerError } = await admin.from("workers").select("id,role,is_active").eq("user_id", data.user.id);
  if (workerError) throw workerError;
  const identities = (rows || []).filter((row: any) => row.is_active !== false);
  const central = identities.find((row: any) => row.role === "central");
  return central ? { ...central, identityIds: identities.map((row: any) => String(row.id)).filter(Boolean) } : null;
}

async function loadAssignments(admin: ReturnType<typeof adminClient>, workerIds: string[], clientId?: string) {
  const rows: any[] = [];
  for (let from = 0; ; from += 1000) {
    let query = admin.from("crm_client_capture_assignments").select("client_id,business,captured_at,responsible_worker_id").in("responsible_worker_id", workerIds);
    if (clientId) query = query.eq("client_id", clientId);
    const { data, error } = await query.order("updated_at", { ascending: false }).range(from, from + 999);
    if (error) throw error;
    rows.push(...(data || []));
    if ((data || []).length < 1000) break;
  }
  return rows;
}

async function loadClients(admin: ReturnType<typeof adminClient>, ids: string[]) {
  const clients: any[] = [];
  const unique = Array.from(new Set(ids.filter(Boolean)));
  for (let index = 0; index < unique.length; index += 200) {
    const { data, error } = await admin.from("crm_clientes").select("id,nombre,apellido,telefono,email,origen,created_at,captured_at,rango_actual").in("id", unique.slice(index, index + 200));
    if (error) throw error;
    clients.push(...(data || []));
  }
  return clients;
}

export async function GET(req: Request) {
  try {
    const worker = await authenticatedCentral(req);
    if (!worker) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401 });
    const url = new URL(req.url);
    const business = url.searchParams.get("marca") === "orion" ? "orion" : "celestial";
    const clientId = String(url.searchParams.get("client_id") || "").trim();
    const admin = adminClient();
    const identityIds = Array.from(new Set([String(worker.id), ...worker.identityIds].filter(Boolean)));
    const assignments = (await loadAssignments(admin, identityIds, clientId || undefined)).filter((row: any) => String(row.business || "celestial").toLowerCase() === business);
    if (clientId && !assignments.length) return NextResponse.json({ ok: true, owned: false, client_id: clientId, business }, { headers: { "Cache-Control": "no-store" } });
    const clientIds = assignments.map((row: any) => String(row.client_id));
    const clients = await loadClients(admin, clientIds);
    const capturedAtByClient = new Map(assignments.map((row: any) => [String(row.client_id), row.captured_at || null]));
    const fidelityByClient = await loadClientFidelityBatch(admin, clients, { capturedAtByClient });
    if (clientId) return NextResponse.json({ ok: true, owned: true, client_id: clientId, fidelity: fidelityByClient.get(clientId) || null, business }, { headers: { "Cache-Control": "no-store" } });
    const scores = Array.from(fidelityByClient.entries()).map(([id, fidelity]) => ({ client_id: id, score: fidelity.score, maturity: fidelity.maturity, label: fidelity.label }));
    return NextResponse.json({ ok: true, worker_id: worker.id, business, client_count: scores.length, average: averageClientFidelity(fidelityByClient.values()), scores }, { headers: { "Cache-Control": "no-store" } });
  } catch (error: any) {
    console.error("[central/client-fidelity] unavailable", { message: error?.message, code: error?.code });
    return NextResponse.json({ ok: false, error: "No se pudo calcular la fidelización de la cartera." }, { status: 500 });
  }
}
