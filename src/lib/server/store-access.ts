import { rouletteStaff, RouletteAccessError } from "./ruleta-access";
export async function storeAccess(req: Request, adminOnly = false) {
  const gate = await rouletteStaff(req);
  if (adminOnly && gate.worker.role !== "admin") throw new RouletteAccessError(403, "Acceso reservado a Administración.");
  return { admin: gate.admin, me: gate.worker };
}
