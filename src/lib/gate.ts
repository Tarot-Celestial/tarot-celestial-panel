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

async function fetchMe(req: Request, token: string): Promise<MePayload> {
  const res = await fetch(new URL("/api/me", req.url), {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const j = (await res.json().catch(() => null)) as MePayload | null;
  if (!res.ok || !j?.ok) throw new Error(j?.["error"] || "UNAUTHORIZED");
  return j;
}

/**
 * ✅ Gate compatible con tu código actual:
 * - Se puede llamar como gateCentralOrAdmin(req)
 * - Si por error se llama sin req, compila igual y devuelve ok=false.
 */
export async function gateCentralOrAdmin(
  req?: Request
): Promise<{ ok: boolean; token?: string; me?: MePayload; error?: string }> {
  try {
    if (!req) return { ok: false, error: "MISSING_REQ" };

    const token = bearerFromReq(req);
    if (!token) return { ok: false, error: "NO_AUTH" };

    const me = await fetchMe(req, token);
    const role = String(me.role || "");

    if (role !== "central" && role !== "admin") return { ok: false, error: "FORBIDDEN" };

    return { ok: true, token, me };
  } catch (e: any) {
    return { ok: false, error: e?.message || "GATE_ERR" };
  }
}

export async function gateTarotista(
  req?: Request
): Promise<{ ok: boolean; token?: string; me?: MePayload; error?: string }> {
  try {
    if (!req) return { ok: false, error: "MISSING_REQ" };

    const token = bearerFromReq(req);
    if (!token) return { ok: false, error: "NO_AUTH" };

    const me = await fetchMe(req, token);
    const role = String(me.role || "");

    if (role !== "tarotista") return { ok: false, error: "FORBIDDEN" };

    return { ok: true, token, me };
  } catch (e: any) {
    return { ok: false, error: e?.message || "GATE_ERR" };
  }
}
