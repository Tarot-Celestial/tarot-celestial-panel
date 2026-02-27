// src/lib/gate.ts
import "server-only";

export type MePayload = {
  ok: boolean;
  role?: string;
  worker?: { id?: string; role?: string };
  user?: { id?: string; email?: string } | null;
  [k: string]: any;
};

export function bearerFromReq(req: Request): string | null {
  const h = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1] : null;
}

export async function requireMe(req: Request): Promise<MePayload> {
  const token = bearerFromReq(req);
  if (!token) throw new Error("NO_AUTH");

  const res = await fetch(new URL("/api/me", req.url), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const j = (await res.json().catch(() => null)) as MePayload | null;
  if (!res.ok || !j?.ok) throw new Error("UNAUTHORIZED");
  return j;
}

export async function requireRole(req: Request, roles: string[]) {
  const me = await requireMe(req);
  const role = String(me.role || "");
  if (!roles.includes(role)) throw new Error("FORBIDDEN");
  return me;
}

/**
 * ✅ Backward-compatible:
 * tus routes importan gateCentralOrAdmin desde "@/lib/gate"
 * Esto devuelve { token, me } para que puedas usar token si lo necesitas.
 */
export async function gateCentralOrAdmin(req: Request): Promise<{ token: string; me: MePayload }> {
  const token = bearerFromReq(req);
  if (!token) throw new Error("NO_AUTH");
  const me = await requireRole(req, ["central", "admin"]);
  return { token, me };
}

/**
 * (Opcional) por si luego lo necesitas
 */
export async function gateTarotista(req: Request): Promise<{ token: string; me: MePayload }> {
  const token = bearerFromReq(req);
  if (!token) throw new Error("NO_AUTH");
  const me = await requireRole(req, ["tarotista"]);
  return { token, me };
}
