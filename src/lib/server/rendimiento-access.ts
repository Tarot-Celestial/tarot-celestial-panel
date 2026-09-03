import { getAdminClient } from "./auth-worker";

// This boundary verifies the JWT with Auth, not by decoding its claims.
export async function rendimientoActor(req: Request) {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  const admin = getAdminClient();
  if (!token) return { admin, worker: null };
  const auth = await admin.auth.getUser(token);
  if (auth.error || !auth.data.user) return { admin, worker: null };
  const result = await admin.from("workers").select("id,role,is_active").eq("user_id", auth.data.user.id).maybeSingle();
  if (result.error) throw result.error;
  const worker = result.data;
  return { admin, worker: worker && worker.is_active !== false && ["central", "admin"].includes(worker.role) ? worker : null };
}
