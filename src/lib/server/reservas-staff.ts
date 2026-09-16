import { adminClient } from "@/lib/server/auth-cliente";

export async function reservasStaff(req: Request) {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { response: Response.json({ error: "Inicia sesión de nuevo." }, { status: 401 }) };
  const db = adminClient();
  const { data, error } = await db.auth.getUser(token);
  if (error || !data.user) return { response: Response.json({ error: "Sesión no válida." }, { status: 401 }) };
  const { data: worker, error: workerError } = await db.from("workers").select("id, role, display_name, is_active").eq("user_id", data.user.id).maybeSingle();
  if (workerError) throw workerError;
  if (!worker || worker.is_active === false || !["admin", "central"].includes(worker.role)) return { response: Response.json({ error: "No tienes acceso a las reservas." }, { status: 403 }) };
  return { db, worker };
}
