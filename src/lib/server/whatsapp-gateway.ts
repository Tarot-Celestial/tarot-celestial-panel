// Cliente del gateway de WhatsApp Web (carpeta /whatsapp-gateway).
// El navegador nunca habla con el gateway: pasa por /api/central/whatsapp,
// que comprueba que la persona es central/admin y añade el secreto.

export type WhatsAppSessionMode = "shared" | "per-worker";

export function whatsappGatewayConfig() {
  const url = String(process.env.WHATSAPP_GATEWAY_URL || "").trim().replace(/\/+$/, "");
  const secret = String(process.env.WHATSAPP_GATEWAY_SECRET || "").trim();
  const mode: WhatsAppSessionMode =
    String(process.env.WHATSAPP_SESSION_MODE || "shared").trim().toLowerCase() === "per-worker" ? "per-worker" : "shared";
  const bridge = process.env.WHATSAPP_GATEWAY_MODE === 'bridge';
  return { url, secret, mode, bridge, configured: Boolean(secret && (url || bridge)) };
}

/**
 * "shared": todas las centrales ven el mismo WhatsApp (un número de empresa).
 * "per-worker": cada central vincula su propio WhatsApp.
 */
export function whatsappSessionId(worker: { id: string | number }) {
  const { mode } = whatsappGatewayConfig();
  if (mode === "per-worker") return `w-${String(worker.id).replace(/[^A-Za-z0-9_-]/g, "").slice(0, 60)}`;
  return "central";
}

export async function whatsappGatewayFetch(path: string, init: { method?: "GET" | "POST"; body?: unknown } = {}) {
  const { url, secret, configured, bridge } = whatsappGatewayConfig();
  if (!configured) return { status: 503, json: { ok: false, error: "GATEWAY_NOT_CONFIGURED" } };
  if (bridge) {
    try { return await (await import('./whatsapp-local-bridge')).whatsappBridgeFetch(path,init); }
    catch { return {status:503,json:{ok:false,error:'BRIDGE_UNAVAILABLE'}}; }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(`${url}${path}`, {
      method: init.method || "GET",
      headers: {
        Authorization: `Bearer ${secret}`,
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    const json = await response.json().catch(() => ({ ok: false, error: `HTTP_${response.status}` }));
    return { status: response.status, json };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return { status: 502, json: { ok: false, error: aborted ? "GATEWAY_TIMEOUT" : "GATEWAY_UNREACHABLE" } };
  } finally {
    clearTimeout(timer);
  }
}
