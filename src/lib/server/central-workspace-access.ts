import { NextResponse } from "next/server";
import { getAdminClient } from "@/lib/server/auth-worker";

export class CentralWorkspaceAccessError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

/** Verified session and the caller's own worker; never impersonate a Central. */
export async function centralWorkspaceIdentity(req: Request) {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new CentralWorkspaceAccessError("NO_AUTH", 401);
  const db = getAdminClient();
  const { data, error } = await db.auth.getUser(token);
  if (error && (error.name === "AuthRetryableFetchError" || error.status === 429 || (error.status || 0) >= 500)) {
    throw new CentralWorkspaceAccessError("Servicio de acceso temporalmente no disponible. Reintenta.", 503);
  }
  if (error || !data.user) throw new CentralWorkspaceAccessError("NO_AUTH", 401);
  const result = await db.from("workers")
    .select("id,user_id,role,display_name,team,is_active,salary_base")
    .eq("user_id", data.user.id).maybeSingle();
  if (result.error) throw result.error;
  const worker = result.data;
  if (!worker || worker.is_active === false || !["central", "admin"].includes(worker.role)) {
    throw new CentralWorkspaceAccessError("FORBIDDEN", 403);
  }
  return { db, worker };
}

export function centralWorkspaceAccessFailure(error: unknown) {
  return error instanceof CentralWorkspaceAccessError
    ? NextResponse.json({ ok: false, error: error.message }, { status: error.status, headers: { "Cache-Control": "private, no-store" } })
    : null;
}
