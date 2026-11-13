import {
  accountingCookieToken, accountingJson, accountingPasswordConfigured, accountingPasswordVersion,
  accountingTokenHash, accountingWriteGuard, clearAccountingCookie, newAccountingToken,
  readAccountingSession, requireAccountingAdmin, setAccountingCookie,
  verifiedBearerSessionId, verifyAccountingPassword,
} from "@/lib/server/accounting-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unavailable() {
  return accountingJson({ ok: false, code: "ACCOUNTING_ACCESS_UNAVAILABLE",
    error: "No se pudo verificar el acceso a contabilidad. Vuelve a intentarlo." }, 503);
}

/** Bound stream consumption, including when Content-Length is absent or false. */
async function readUnlockPayload(req: Request): Promise<{ password?: unknown } | null> {
  const limit = 2048;
  if (Number(req.headers.get("content-length") || "0") > limit) return null;
  const reader = req.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); return null; }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return null; }
  finally { reader.releaseLock(); }
}

export async function GET(req: Request) {
  try {
    const gate = await requireAccountingAdmin(req);
    if (!gate.ok) return gate.response;
    const configured = accountingPasswordConfigured();
    const session = configured ? await readAccountingSession(req, gate) : null;
    return accountingJson({ ok: true, configured, unlocked: Boolean(session), ...(session || {}) });
  } catch { return unavailable(); }
}

export async function POST(req: Request) {
  const invalid = accountingWriteGuard(req);
  if (invalid) return invalid;
  try {
    const gate = await requireAccountingAdmin(req);
    if (!gate.ok) return gate.response;
    if (!accountingPasswordConfigured()) return accountingJson({ ok: false, code: "ACCOUNTING_NOT_CONFIGURED",
      error: "El acceso a contabilidad aún no está configurado en el servidor." }, 503);
    const authSessionId = verifiedBearerSessionId(req);
    if (!authSessionId) return accountingJson({ ok: false, code: "NO_AUTH", error: "Inicia sesión de nuevo para acceder." }, 401);
    // Never log or echo the request body. Bound the body before JSON parsing.
    const body = await readUnlockPayload(req);
    if (!body || typeof body.password !== "string" || body.password.length < 1 || body.password.length > 256) {
      return accountingJson({ ok: false, code: "INVALID_PASSWORD", error: "Escribe una contraseña válida." }, 400);
    }
    // Reserve before hashing. The database row lock serializes concurrent attempts.
    const attempt = await gate.admin.rpc("tc_accounting_reserve_login_attempt", { p_actor: gate.authUserId });
    if (attempt.error || !attempt.data || typeof attempt.data.allowed !== "boolean") return unavailable();
    if (!attempt.data.allowed) {
      const retryAfter = Math.max(1, Math.min(900, Number(attempt.data.retry_after) || 900));
      const response = accountingJson({ ok: false, code: "ACCOUNTING_RATE_LIMIT", retryAfter,
        error: "Has alcanzado el límite de intentos. Espera unos minutos antes de volver a probar." }, 429);
      response.headers.set("Retry-After", String(retryAfter));
      return response;
    }
    if (!(await verifyAccountingPassword(body.password))) {
      return accountingJson({ ok: false, code: "INVALID_PASSWORD", error: "Contraseña incorrecta." }, 403);
    }
    const { token, tokenHash } = newAccountingToken();
    const opened = await gate.admin.rpc("tc_accounting_open_session", {
      p_actor: gate.authUserId, p_auth_session_id: authSessionId,
      p_token_hash: tokenHash, p_password_version: accountingPasswordVersion(),
    });
    if (opened.error?.message === "AUTH_SESSION_REVOKED") return clearAccountingCookie(accountingJson({
      ok: false, code: "NO_AUTH", error: "Tu sesión ha caducado. Vuelve a iniciar sesión para acceder.",
    }, 401));
    const expiresAt = opened.data?.expires_at;
    if (opened.error || typeof expiresAt !== "string" || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now()) return unavailable();
    return setAccountingCookie(accountingJson({ ok: true, configured: true, unlocked: true, expiresAt }), token, expiresAt);
  } catch { return unavailable(); }
}

export async function DELETE(req: Request) {
  const invalid = accountingWriteGuard(req);
  if (invalid) return invalid;
  try {
    const gate = await requireAccountingAdmin(req);
    if (!gate.ok) return clearAccountingCookie(gate.response);
    const token = accountingCookieToken(req);
    if (token) {
      const closed = await gate.admin.rpc("tc_accounting_close_session", {
        p_actor: gate.authUserId, p_token_hash: accountingTokenHash(token),
      });
      if (closed.error || closed.data !== true) return unavailable();
    }
    return clearAccountingCookie(accountingJson({ ok: true, unlocked: false }));
  } catch { return unavailable(); }
}
