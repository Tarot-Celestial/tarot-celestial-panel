import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BrainStatus = "stable" | "attention" | "error" | "realtime" | "automation" | "unknown";

type ProbeResult = {
  name: string;
  ok: boolean;
  count?: number | null;
  latency_ms: number;
  error?: string | null;
};

type NodeSpec = {
  id: string;
  realtime?: boolean;
  tables: string[];
};

const NODE_SPECS: NodeSpec[] = [
  {
    id: "clients",
    tables: [
      "crm_clientes",
      "crm_client_followups",
      "crm_client_capture_assignments",
      "reservas",
      "central_public_profiles",
      "cliente_tarotista_reviews",
    ],
  },
  {
    id: "team",
    tables: ["workers", "worker_schedules", "attendance_state", "attendance_events"],
  },
  {
    id: "realtime",
    realtime: true,
    tables: ["attendance_state", "central_notifications", "captacion_leads", "reservas", "chat_messages"],
  },
  {
    id: "billing",
    tables: ["invoices", "invoice_lines", "manual_invoices", "crm_cliente_pagos", "accounting_entries", "rendimiento_llamadas"],
  },
  {
    id: "xp",
    tables: [
      "worker_xp_events",
      "worker_xp_rules",
      "worker_xp_level_config",
      "worker_xp_missions",
      "worker_xp_reward_claims",
      "worker_coin_wallets",
      "worker_xp_coin_conversions",
    ],
  },
];

function safeError(error: unknown) {
  if (!error) return null;
  const message = error instanceof Error ? error.message : String((error as any)?.message || error);
  return message.slice(0, 180);
}

async function probeTable(admin: any, table: string): Promise<ProbeResult> {
  const started = Date.now();
  try {
    const { count, error } = await admin
      .from(table)
      .select("*", { head: true, count: "estimated" });

    return {
      name: table,
      ok: !error,
      count: typeof count === "number" ? count : null,
      latency_ms: Date.now() - started,
      error: safeError(error),
    };
  } catch (error) {
    return {
      name: table,
      ok: false,
      count: null,
      latency_ms: Date.now() - started,
      error: safeError(error),
    };
  }
}

function statusFrom(probes: ProbeResult[], realtime = false): BrainStatus {
  if (!probes.length) return "unknown";
  const failed = probes.filter((probe) => !probe.ok).length;
  if (failed === probes.length) return "error";
  if (failed > 0) return "attention";
  return realtime ? "realtime" : "stable";
}

function metricsFrom(probes: ProbeResult[]) {
  return probes
    .filter((probe) => probe.ok && typeof probe.count === "number")
    .slice(0, 8)
    .map((probe) => `${probe.name}: ~${probe.count}`);
}

function observationsFrom(probes: ProbeResult[]) {
  const errors = probes
    .filter((probe) => !probe.ok)
    .map((probe) => `${probe.name}: ${probe.error || "sin respuesta"}`);
  return errors.length ? errors : ["Todas las conexiones sondeadas respondieron correctamente."];
}

export async function GET(req: Request) {
  const started = Date.now();

  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) {
      return NextResponse.json(
        { ok: false, error: gate.error },
        { status: gate.error === "FORBIDDEN" ? 403 : 401, headers: { "Cache-Control": "no-store" } }
      );
    }

    const admin = gate.admin;
    const generatedAt = new Date().toISOString();

    const entries = await Promise.all(
      NODE_SPECS.map(async (spec) => {
        const probes = await Promise.all(spec.tables.map((table) => probeTable(admin, table)));
        const healthy = probes.filter((probe) => probe.ok).length;
        const latency = probes.length ? Math.max(...probes.map((probe) => probe.latency_ms)) : 0;

        return [
          spec.id,
          {
            id: spec.id,
            status: statusFrom(probes, Boolean(spec.realtime)),
            checked_at: generatedAt,
            latency_ms: latency,
            healthy_checks: healthy,
            total_checks: probes.length,
            metrics: metricsFrom(probes),
            observations: observationsFrom(probes),
            probes,
          },
        ] as const;
      })
    );

    const nodes: Record<string, any> = Object.fromEntries(entries);

    const infraProbes: ProbeResult[] = [];
    {
      const startedDb = Date.now();
      try {
        const { error } = await admin.from("workers").select("id", { head: true, count: "estimated" });
        infraProbes.push({
          name: "Supabase PostgREST",
          ok: !error,
          latency_ms: Date.now() - startedDb,
          error: safeError(error),
        });
      } catch (error) {
        infraProbes.push({
          name: "Supabase PostgREST",
          ok: false,
          latency_ms: Date.now() - startedDb,
          error: safeError(error),
        });
      }
    }

    {
      const startedAuth = Date.now();
      try {
        const { error } = await admin.auth.admin.listUsers({ page: 1, perPage: 1 });
        infraProbes.push({
          name: "Supabase Auth",
          ok: !error,
          latency_ms: Date.now() - startedAuth,
          error: safeError(error),
        });
      } catch (error) {
        infraProbes.push({
          name: "Supabase Auth",
          ok: false,
          latency_ms: Date.now() - startedAuth,
          error: safeError(error),
        });
      }
    }

    infraProbes.push({
      name: "Vercel Runtime",
      ok: Boolean(process.env.VERCEL || process.env.VERCEL_ENV || process.env.NODE_ENV),
      latency_ms: 0,
      error: null,
    });

    nodes.infra = {
      id: "infra",
      status: statusFrom(infraProbes),
      checked_at: generatedAt,
      latency_ms: Math.max(...infraProbes.map((probe) => probe.latency_ms)),
      healthy_checks: infraProbes.filter((probe) => probe.ok).length,
      total_checks: infraProbes.length,
      metrics: [
        `entorno: ${process.env.VERCEL_ENV || process.env.NODE_ENV || "desconocido"}`,
        process.env.VERCEL_GIT_COMMIT_SHA ? `commit: ${process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 8)}` : "commit: no expuesto",
      ],
      observations: observationsFrom(infraProbes),
      probes: infraProbes,
    };

    const childNodes = Object.values(nodes) as any[];
    const allProbes = childNodes.flatMap((node) => node.probes || []);
    const coreFailed = childNodes.filter((node) => node.status === "error").length;
    const coreAttention = childNodes.filter((node) => node.status === "attention").length;
    const coreStatus: BrainStatus = coreFailed > 0 ? "error" : coreAttention > 0 ? "attention" : "stable";

    nodes.core = {
      id: "core",
      status: coreStatus,
      checked_at: generatedAt,
      latency_ms: allProbes.length ? Math.max(...allProbes.map((probe) => probe.latency_ms || 0)) : 0,
      healthy_checks: allProbes.filter((probe) => probe.ok).length,
      total_checks: allProbes.length,
      metrics: [
        `${childNodes.filter((node) => node.status === "stable" || node.status === "realtime").length}/${childNodes.length} subsistemas saludables`,
        `${allProbes.filter((probe) => probe.ok).length}/${allProbes.length} conexiones respondieron`,
      ],
      observations: coreStatus === "stable"
        ? ["El pulso transversal responde correctamente en todos los subsistemas sondeados."]
        : ["Existe al menos un subsistema con degradación. Abre los nodos marcados para ver la conexión afectada."],
      probes: childNodes.map((node) => ({
        name: node.id,
        ok: node.status !== "error",
        latency_ms: node.latency_ms,
        error: node.status === "attention" ? "requiere atención" : node.status === "error" ? "fallo detectado" : null,
      })),
    };

    const visibleNodes = Object.values(nodes) as any[];
    const summary = {
      healthy_nodes: visibleNodes.filter((node) => node.status === "stable" || node.status === "realtime").length,
      attention_nodes: visibleNodes.filter((node) => node.status === "attention").length,
      error_nodes: visibleNodes.filter((node) => node.status === "error").length,
      total_nodes: visibleNodes.length,
    };

    return NextResponse.json(
      {
        ok: true,
        generated_at: generatedAt,
        duration_ms: Date.now() - started,
        nodes,
        summary,
        runtime: {
          vercel_env: process.env.VERCEL_ENV || null,
          deployment: process.env.VERCEL_URL || null,
          commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
        },
      },
      { headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  } catch (error) {
    console.error("[cerebro:health]", error);
    return NextResponse.json(
      {
        ok: false,
        error: safeError(error) || "CEREBRO_HEALTH_ERROR",
        generated_at: new Date().toISOString(),
        duration_ms: Date.now() - started,
      },
      { status: 500, headers: { "Cache-Control": "no-store, max-age=0" } }
    );
  }
}
