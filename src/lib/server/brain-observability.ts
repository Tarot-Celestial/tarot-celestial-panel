import "server-only";
import { createHash } from "crypto";

type BrainSeverity = "warning" | "error" | "critical";

export type BrainIncidentInput = {
  source?: string;
  severity?: BrainSeverity;
  subsystem?: string;
  route?: string | null;
  code?: string | null;
  title?: string;
  message: string;
  affectedNodeIds?: string[];
  metadata?: Record<string, unknown>;
};

function safeText(value: unknown, max = 600) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function safeMetadata(metadata?: Record<string, unknown>) {
  if (!metadata) return {};
  const output: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (/token|secret|password|authorization|cookie|email|phone|clientid|cliente_id|user_id/i.test(key)) continue;
    if (value == null || typeof value === "boolean" || typeof value === "number") output[key] = value;
    else if (typeof value === "string") output[key] = safeText(value, 300);
  }
  return output;
}

function fingerprintFor(input: BrainIncidentInput) {
  const raw = [
    safeText(input.source || "app", 40),
    safeText(input.subsystem || "core", 80),
    safeText(input.route || "", 240),
    safeText(input.code || "", 80),
    safeText(input.title || "", 180),
    safeText(input.message, 500),
  ].join("|");
  return createHash("sha256").update(raw).digest("hex");
}

export function classifyBrainIncident(error: any, fallback: Omit<BrainIncidentInput, "message"> & { message?: string }): BrainIncidentInput {
  const code = safeText(error?.code || error?.name || fallback.code || "", 80) || null;
  const message = safeText(error?.message || fallback.message || "Error de producción", 1000);
  let severity: BrainSeverity = fallback.severity || "error";

  if (/timeout|timed out|ECONNRESET|ECONNREFUSED|ENETUNREACH/i.test(message)) severity = "critical";
  if (["23505", "23P01", "409"].includes(String(code || ""))) severity = "warning";
  if (["23503", "42501", "42P01", "PGRST205"].includes(String(code || ""))) severity = "error";

  return {
    ...fallback,
    severity,
    code,
    message,
  };
}

export async function recordBrainIncident(admin: any, input: BrainIncidentInput) {
  try {
    const payload = {
      p_fingerprint: fingerprintFor(input),
      p_source: safeText(input.source || "app", 40) || "app",
      p_severity: input.severity || "error",
      p_subsystem: safeText(input.subsystem || "core", 80) || "core",
      p_route: input.route ? safeText(input.route, 240) : null,
      p_code: input.code ? safeText(input.code, 80) : null,
      p_title: safeText(input.title || "Incidente de producción", 180) || "Incidente de producción",
      p_message: safeText(input.message, 1200) || "Sin detalle",
      p_affected_node_ids: Array.from(new Set((input.affectedNodeIds || ["core"]).filter(Boolean))).slice(0, 12),
      p_metadata: {
        ...safeMetadata(input.metadata),
        deployment_commit: safeText(process.env.VERCEL_GIT_COMMIT_SHA || "", 80) || null,
        deployment_url: safeText(process.env.VERCEL_URL || "", 240) || null,
        deployment_env: safeText(process.env.VERCEL_ENV || process.env.NODE_ENV || "", 40) || null,
      },
    };

    const { error } = await admin.rpc("brain_record_observability_event", payload);
    if (error) {
      console.warn("[brain-observability][record-failed]", {
        code: error.code,
        message: error.message,
      });
    }
  } catch (error: any) {
    console.warn("[brain-observability][record-exception]", {
      message: safeText(error?.message || error, 300),
    });
  }
}
