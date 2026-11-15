import "server-only";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const ACCOUNTING_SESSION_COOKIE = "tc_accounting_session";
export const ACCOUNTING_SESSION_SECONDS = 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_TOKEN = /^[a-f0-9]{64}$/;
const HASH_FORMAT = /^scrypt\$([a-f0-9]{32})\$([a-f0-9]{128})$/;

type AdminGate = Extract<Awaited<ReturnType<typeof requireAdmin>>, { ok: true }>;
type RejectedGate = { ok: false; response: NextResponse };

export function accountingJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0", Pragma: "no-cache", Vary: "Authorization, Cookie" },
  });
}

/** Cookie-authenticated writes require the initiating origin, not just an admin JWT. */
export function accountingWriteGuard(req: Request): NextResponse | null {
  try {
    const origin = req.headers.get("origin");
    if (!origin || new URL(origin).origin !== new URL(req.url).origin || origin === "null") {
      return accountingJson({ ok: false, code: "INVALID_ORIGIN", error: "La operación debe iniciarse desde este panel." }, 403);
    }
  } catch {
    return accountingJson({ ok: false, code: "INVALID_ORIGIN", error: "No se pudo verificar el origen de la operación." }, 403);
  }
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite && fetchSite !== "same-origin") {
    return accountingJson({ ok: false, code: "INVALID_ORIGIN", error: "La operación debe iniciarse desde este panel." }, 403);
  }
  if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") || "")) {
    return accountingJson({ ok: false, code: "INVALID_CONTENT_TYPE", error: "Formato de solicitud no válido." }, 415);
  }
  return null;
}

export function accountingPasswordConfigured(): boolean {
  return HASH_FORMAT.test(process.env.ACCOUNTING_PASSWORD_HASH || "");
}

export function accountingPasswordVersion(): string {
  return createHash("sha256").update(process.env.ACCOUNTING_PASSWORD_HASH || "").digest("hex");
}

/** Server-only scrypt hash. There is deliberately no fallback/default password. */
export async function verifyAccountingPassword(password: unknown): Promise<boolean> {
  if (typeof password !== "string" || password.length < 1 || password.length > 256) return false;
  const encoded = (process.env.ACCOUNTING_PASSWORD_HASH || "").match(HASH_FORMAT);
  if (!encoded) return false;
  const expected = Buffer.from(encoded[2], "hex");
  const actual = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, Buffer.from(encoded[1], "hex"), 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error); else resolve(key);
    });
  });
  return timingSafeEqual(actual, expected);
}

export function accountingTokenHash(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function newAccountingToken() {
  const token = randomBytes(32).toString("hex");
  return { token, tokenHash: accountingTokenHash(token) };
}

export function accountingCookieToken(req: Request): string | null {
  const raw = (req.headers.get("cookie") || "").split(";").map(part => part.trim())
    .find(part => part.startsWith(`${ACCOUNTING_SESSION_COOKIE}=`))?.slice(ACCOUNTING_SESSION_COOKIE.length + 1);
  return raw && HEX_TOKEN.test(raw) ? raw : null;
}

/** Call only after requireAdmin verified this bearer token with Supabase Auth. */
export function verifiedBearerSessionId(req: Request): string | null {
  const token = req.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return null;
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return typeof payload.session_id === "string" && UUID.test(payload.session_id) ? payload.session_id.toLowerCase() : null;
  } catch { return null; }
}

export function setAccountingCookie(response: NextResponse, token: string, expiresAt: string) {
  response.cookies.set(ACCOUNTING_SESSION_COOKIE, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict",
    path: "/api/admin/contabilidad", maxAge: ACCOUNTING_SESSION_SECONDS, expires: new Date(expiresAt),
  });
  return response;
}

export function clearAccountingCookie(response: NextResponse) {
  response.cookies.set(ACCOUNTING_SESSION_COOKIE, "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict",
    path: "/api/admin/contabilidad", maxAge: 0, expires: new Date(0),
  });
  return response;
}

export async function requireAccountingAdmin(req: Request): Promise<AdminGate | RejectedGate> {
  const gate = await requireAdmin(req);
  if (!gate.ok) {
    const unauthenticated = gate.error === "NO_AUTH";
    return { ok: false, response: accountingJson({ ok: false, code: unauthenticated ? "NO_AUTH" : "FORBIDDEN",
      error: unauthenticated ? "Inicia sesión de nuevo para acceder." : "Acceso reservado a administración activa." }, unauthenticated ? 401 : 403) };
  }
  return gate;
}

export async function readAccountingSession(req: Request, gate: AdminGate): Promise<{ expiresAt: string } | null> {
  const token = accountingCookieToken(req);
  const authSessionId = verifiedBearerSessionId(req);
  if (!token || !authSessionId || !accountingPasswordConfigured()) return null;
  const { data, error } = await gate.admin.rpc("tc_accounting_read_session", {
    p_actor: gate.authUserId, p_auth_session_id: authSessionId,
    p_token_hash: accountingTokenHash(token), p_password_version: accountingPasswordVersion(),
  });
  if (error) throw error;
  if (!data || data.valid !== true || typeof data.expires_at !== "string" ||
      !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now()) return null;
  return { expiresAt: data.expires_at };
}

/** This guard must protect every accounting data endpoint, including GET. */
export async function requireAccountingAccess(req: Request): Promise<AdminGate | RejectedGate> {
  try {
    const gate = await requireAccountingAdmin(req);
    if (!gate.ok) return gate;
    if (!accountingPasswordConfigured()) return { ok: false, response: accountingJson({ ok: false,
      code: "ACCOUNTING_NOT_CONFIGURED", error: "El acceso a contabilidad aún no está configurado en el servidor." }, 503) };
    if (!(await readAccountingSession(req, gate))) return { ok: false, response: accountingJson({ ok: false,
      code: "ACCOUNTING_LOCKED", error: "Desbloquea Contabilidad con su contraseña para continuar." }, 423) };
    return gate;
  } catch {
    return { ok: false, response: accountingJson({ ok: false, code: "ACCOUNTING_ACCESS_UNAVAILABLE",
      error: "No se pudo verificar el acceso a contabilidad. Vuelve a intentarlo." }, 503) };
  }
}
