import type { SupabaseClient } from "@supabase/supabase-js";

export type PanelRole = "admin" | "central" | "tarotista";

type PanelIdentity = {
  ok: boolean;
  role?: string | null;
  [key: string]: unknown;
};

function withTimeout<T>(operation: PromiseLike<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error(message)), timeoutMs);
    Promise.resolve(operation).then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export async function loadPanelIdentity(client: SupabaseClient): Promise<PanelIdentity> {
  const sessionResult = await withTimeout(
    client.auth.getSession(),
    8000,
    "La sesión tardó demasiado en responder"
  );
  const token = sessionResult.data.session?.access_token;
  if (!token) throw new Error("NO_AUTH");

  return loadPanelIdentityFromToken(token);
}

export async function loadPanelIdentityFromToken(token: string): Promise<PanelIdentity> {
  const controller = new AbortController();
  const abortTimer = window.setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetch("/api/me", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
      signal: controller.signal,
    });
    const identity = (await response.json().catch(() => null)) as PanelIdentity | null;
    if (!response.ok || !identity?.ok) {
      throw new Error(String(identity?.error || "INVALID_SESSION"));
    }
    return identity;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("La validación del acceso tardó demasiado en responder");
    }
    throw error;
  } finally {
    window.clearTimeout(abortTimer);
  }
}

export function panelPathForRole(role: string | null | undefined): string {
  const normalized = String(role || "").toLowerCase() as PanelRole;
  if (normalized === "admin") return "/admin";
  if (normalized === "tarotista") return "/panel-tarotista";
  return "/panel-central";
}

export function redirectToLogin(reason = "session") {
  window.location.replace(`/login?reason=${encodeURIComponent(reason)}`);
}
