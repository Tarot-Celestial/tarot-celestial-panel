import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { NextResponse } from "next/server";

export class CampaignError extends Error { constructor(message: string, public status = 400) { super(message); } }
export async function campaignIdentity(req: Request, role: "admin" | "client") {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new CampaignError("Inicia sesión para continuar.", 401);
  const db = supabaseAdmin();
  // Verify the token with Auth; decoded JWT payloads alone are not authorization.
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) throw new CampaignError("La sesión no es válida.", 401);
  const bannedUntil = (data.user as any).banned_until;
  if (bannedUntil && Date.parse(bannedUntil) > Date.now()) throw new CampaignError("La cuenta no está disponible.", 403);
  const uid = data.user.id;
  if (role === "admin") {
    const result = await db.from("workers").select("id,role,is_active").eq("user_id", uid).maybeSingle();
    if (result.error) throw result.error;
    if (result.data?.role !== "admin" || result.data?.is_active === false) throw new CampaignError("Acceso exclusivo para administradores.", 403);
    return { db, uid, clientId: "" };
  }
  const result = await db.from("crm_clientes").select("id").eq("auth_user_id", uid).single();
  if (result.error || !result.data) throw new CampaignError("No hay una ficha de cliente vinculada a esta cuenta.", 403);
  return { db, uid, clientId: String(result.data.id) };
}
export function campaignResponseError(error: any) {
  console.error("campaigns", error?.code || error?.message);
  const setup = ["42P01", "PGRST202", "PGRST205"].includes(error?.code);
  return NextResponse.json({ ok: false, error: error instanceof CampaignError ? error.message : setup ? "Falta aplicar SQL_CAMPANAS_CLIENTES.sql para activar las campañas." : "No se pudo completar la operación. Actualiza e inténtalo de nuevo." }, { status: error instanceof CampaignError ? error.status : setup ? 503 : 500 });
}
