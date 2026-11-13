import { supabaseBrowser } from "@/lib/supabase-browser";

export class AccountingRequestError extends Error {
  constructor(message: string, public status: number, public code?: string, public retryAfter?: number) {
    super(message);
    this.name = "AccountingRequestError";
  }
}

/** All financial reads come from the server; no money or passwords are cached locally. */
export async function accountingRequest<T>(path = "", init: RequestInit = {}): Promise<T> {
  const { data, error } = await supabaseBrowser().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new AccountingRequestError(error ? "No se pudo verificar la sesión. Vuelve a intentarlo." : "Inicia sesión de nuevo para continuar.", error ? 503 : 401);
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`/api/admin/contabilidad${path}`, {
      ...init,
      credentials: "same-origin",
      cache: "no-store",
      headers: { ...init.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: init.signal ?? controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok || payload?.ok !== true) {
      const message = payload?.message || payload?.error || "No se pudo completar la operación. Vuelve a intentarlo.";
      throw new AccountingRequestError(String(message), response.status, payload?.code, Number(payload?.retryAfter) || undefined);
    }
    return payload as T;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new AccountingRequestError("La conexión ha tardado demasiado. Si estabas guardando, reintenta sin cambiar el movimiento: no se duplicará.", 504);
    }
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}

export function accountingAccessExpired(error: unknown): boolean {
  return error instanceof AccountingRequestError && (
    error.status === 401 || error.status === 423 ||
    (error.status === 403 && ["FORBIDDEN", "ACCOUNTING_FORBIDDEN"].includes(error.code || ""))
  );
}

/** UI invalidation only. This never grants access; every API checks the bearer on the server. */
export function accountingSessionIdentity(session: { user?: { id?: string }; access_token?: string } | null | undefined): string | null {
  if (!session?.user?.id) return null;
  let sessionId = "";
  try {
    const encoded = session.access_token?.split(".")[1];
    if (encoded) {
      const payload = JSON.parse(atob(encoded.replaceAll("-", "+").replaceAll("_", "/")));
      if (typeof payload.session_id === "string") sessionId = payload.session_id;
    }
  } catch { /* Invalid/missing tokens cannot grant access; the server remains authoritative. */ }
  return `${session.user.id}:${sessionId}`;
}

export function madridDate(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export function dateLabel(value: string): string {
  return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
}

/** Spreadsheet applications must treat user-authored text as text, not formulas. */
export function csvCell(value: unknown): string {
  const text = String(value ?? "");
  const safe = /^[\s]*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
