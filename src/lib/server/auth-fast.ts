export type FastAuthUser = {
  id: string;
  email?: string;
  role?: string;
  app_metadata?: Record<string, any>;
  user_metadata?: Record<string, any>;
  aud?: string;
  exp?: number;
  [key: string]: any;
};

function base64UrlDecode(input: string): string {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(input.length / 4) * 4, "=");
  return Buffer.from(padded, "base64").toString("utf8");
}

export function getBearerToken(req: Request): string {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization") || "";
  if (auth.toLowerCase().startsWith("bearer ")) return auth.slice(7).trim();
  return "";
}

export function decodeSupabaseUserFromToken(token: string): FastAuthUser | null {
  try {
    const [, payload] = token.split(".");
    if (!payload) return null;
    const claims = JSON.parse(base64UrlDecode(payload));
    const exp = Number(claims.exp || 0);
    if (exp && exp * 1000 < Date.now()) return null;
    const id = String(claims.sub || "");
    if (!id) return null;
    return {
      id,
      email: claims.email,
      role: claims.role,
      app_metadata: claims.app_metadata || {},
      user_metadata: claims.user_metadata || {},
      aud: claims.aud,
      exp: claims.exp,
      ...claims,
    };
  } catch {
    return null;
  }
}

export function getAuthUserFromRequest(req: Request): { data: { user: FastAuthUser | null }; error: Error | null } {
  const token = getBearerToken(req);
  const user = token ? decodeSupabaseUserFromToken(token) : null;
  return {
    data: { user },
    error: user ? null : new Error("UNAUTHENTICATED"),
  };
}

export function getAuthUserIdFromRequest(req: Request): string | null {
  return getAuthUserFromRequest(req).data.user?.id || null;
}
