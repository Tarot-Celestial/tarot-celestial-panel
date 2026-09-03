import { createClient } from "@supabase/supabase-js";

export class RouletteAccessError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function verifiedRouletteIdentity(req: Request) {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) throw new RouletteAccessError(401, "Inicia sesión para continuar.");
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new RouletteAccessError(401, "Tu sesión ha caducado. Vuelve a entrar.");
  return { admin, user: data.user };
}
export async function rouletteClient(req: Request) {
  const gate = await verifiedRouletteIdentity(req);
  const { data, error } = await gate.admin.from("crm_clientes")
    .select("id,auth_user_id").eq("auth_user_id", gate.user.id).limit(2);
  if (error) throw error;
  if (data?.length !== 1) throw new RouletteAccessError(403, "Tu acceso necesita revisión. Contacta con tu central.");
  return { ...gate, cliente: data[0] };
}
export async function rouletteStaff(req: Request) {
  const gate = await verifiedRouletteIdentity(req);
  const { data, error } = await gate.admin.from("workers")
    .select("id,user_id,role,is_active,display_name,email").eq("user_id", gate.user.id).maybeSingle();
  if (error) throw error;
  if (!data || data.is_active === false || !["admin", "central"].includes(data.role)) {
    throw new RouletteAccessError(403, "Acceso reservado a centrales y administración.");
  }
  return { ...gate, worker: data };
}
