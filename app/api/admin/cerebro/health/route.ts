import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { buildBrainDiagnostics, BRAIN_MONITORED_PATHS_COUNT } from "@/features/brain/celestial-brain-diagnostics";
import { buildBrainForecast } from "@/features/brain/celestial-brain-forecast";

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
    const incidentCutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const historyCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const activeIncidentCutoffMs = Date.now() - 6 * 60 * 60 * 1000;

    const lifecycleResult = await admin.rpc("brain_refresh_incident_lifecycle", {
      p_recovering_after_minutes: 5,
      p_resolve_after_minutes: 20,
    });

    const incidentResult = await admin
      .from("brain_observability_events")
      .select("id,fingerprint,source,severity,subsystem,route,code,title,message,affected_node_ids,metadata,occurrences,first_seen_at,last_seen_at,resolved_at,status,cycle_started_at,reopened_count,resolved_reason,resolved_by")
      .in("status", ["open","recovering"])
      .gte("last_seen_at", incidentCutoff)
      .order("last_seen_at", { ascending: false })
      .limit(30);

    const incidents = incidentResult.error ? [] : (incidentResult.data || []);

    const [resolvedResult, historyResult, snapshotResult] = await Promise.all([
      admin
        .from("brain_observability_events")
        .select("id,fingerprint,source,severity,subsystem,route,code,title,message,affected_node_ids,metadata,occurrences,first_seen_at,last_seen_at,resolved_at,status,cycle_started_at,reopened_count,resolved_reason,resolved_by")
        .eq("status", "resolved")
        .gte("resolved_at", historyCutoff)
        .order("resolved_at", { ascending: false })
        .limit(20),
      admin
        .from("brain_observability_history")
        .select("id,event_id,fingerprint,event_type,status_after,source,severity,subsystem,route,code,title,message,affected_node_ids,occurrences_snapshot,cycle_started_at,deployment_commit,deployment_url,deployment_env,metadata,occurred_at")
        .gte("occurred_at", historyCutoff)
        .order("occurred_at", { ascending: false })
        .limit(80),
      admin
        .from("brain_health_snapshots")
        .select("id,snapshot_key,generated_at,deployment_commit,deployment_url,deployment_env,duration_ms,healthy_nodes,attention_nodes,error_nodes,total_nodes,open_incidents,recovering_incidents,resolved_recent,details")
        .order("generated_at", { ascending: false })
        .limit(24),
    ]);

    const resolvedIncidents = resolvedResult.error ? [] : (resolvedResult.data || []);
    const incidentHistory = historyResult.error ? [] : (historyResult.data || []);
    const previousSnapshots = snapshotResult.error ? [] : (snapshotResult.data || []);

    const incidentProbe: ProbeResult = {
      name: "Observabilidad producción",
      ok: !incidentResult.error,
      count: incidents.length,
      latency_ms: 0,
      error: safeError(incidentResult.error || lifecycleResult.error || resolvedResult.error || historyResult.error || snapshotResult.error),
    };

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
    infraProbes.push(incidentProbe);

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

    for (const incident of incidents) {
      const lastSeenMs = new Date(String(incident.last_seen_at || "")).getTime();
      if (!Number.isFinite(lastSeenMs) || lastSeenMs < activeIncidentCutoffMs) continue;
      const affected = Array.isArray(incident.affected_node_ids) ? incident.affected_node_ids : [];
      for (const nodeId of affected) {
        const node = nodes[nodeId];
        if (!node) continue;
        const incidentStatus: BrainStatus = incident.severity === "critical" ? "error" : "attention";
        if (node.status !== "error") node.status = incidentStatus;
        node.observations = [
          `Producción · ${incident.title} · ${incident.occurrences} ocurrencia(s) · última ${incident.last_seen_at}`,
          ...(node.observations || []),
        ].slice(0, 8);
      }
    }

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

    const diagnostics = buildBrainDiagnostics(nodes);
    const diagnosticsSummary = {
      active: diagnostics.length,
      critical: diagnostics.filter((item) => item.severity === "error").length,
      attention: diagnostics.filter((item) => item.severity === "attention").length,
      monitored_paths: BRAIN_MONITORED_PATHS_COUNT,
    };

    const currentCommit = process.env.VERCEL_GIT_COMMIT_SHA || null;
    const currentDeployment = process.env.VERCEL_URL || null;
    const currentEnv = process.env.VERCEL_ENV || process.env.NODE_ENV || null;
    const recoveringIncidents = incidents.filter((item: any) => item.status === "recovering");
    const openIncidents = incidents.filter((item: any) => item.status !== "recovering");

    const currentDeploymentHistory = currentCommit
      ? incidentHistory.filter((item: any) => item.deployment_commit === currentCommit)
      : [];
    const priorDeploymentSnapshot = currentCommit
      ? previousSnapshots.find((item: any) => item.deployment_commit && item.deployment_commit !== currentCommit)
      : previousSnapshots[0] || null;

    const snapshotKey = `${currentCommit || "local"}:${generatedAt.slice(0, 16)}`;
    const durationMs = Date.now() - started;

    const forecast = buildBrainForecast({
      durationMs,
      nodes,
      incidents,
      history: incidentHistory,
      snapshots: previousSnapshots,
      deploymentComparison: {
        current_commit: currentCommit,
        previous_commit: priorDeploymentSnapshot?.deployment_commit || null,
        delta_open_incidents: priorDeploymentSnapshot
          ? incidents.length - (Number(priorDeploymentSnapshot.open_incidents || 0) + Number(priorDeploymentSnapshot.recovering_incidents || 0))
          : null,
      },
    });

    await admin.from("brain_health_snapshots").upsert({
      snapshot_key: snapshotKey,
      generated_at: generatedAt,
      deployment_commit: currentCommit,
      deployment_url: currentDeployment,
      deployment_env: currentEnv,
      duration_ms: durationMs,
      healthy_nodes: summary.healthy_nodes,
      attention_nodes: summary.attention_nodes,
      error_nodes: summary.error_nodes,
      total_nodes: summary.total_nodes,
      open_incidents: openIncidents.length,
      recovering_incidents: recoveringIncidents.length,
      resolved_recent: resolvedIncidents.length,
      details: {
        diagnostics_active: diagnostics.length,
        incident_occurrences: incidents.reduce((sum: number, item: any) => sum + Number(item.occurrences || 0), 0),
        forecast_score: forecast.score,
        forecast_level: forecast.level,
        node_latencies: Object.fromEntries(Object.entries(nodes).map(([id, node]: [string, any]) => [id, Number(node?.latency_ms || 0)])),
        node_statuses: Object.fromEntries(Object.entries(nodes).map(([id, node]: [string, any]) => [id, String(node?.status || "unknown")])),
        failed_probes: Object.fromEntries(Object.entries(nodes).map(([id, node]: [string, any]) => [id, (node?.probes || []).filter((probe: any) => !probe.ok).map((probe: any) => probe.name)])),
      },
    }, { onConflict: "snapshot_key" });

    return NextResponse.json(
      {
        ok: true,
        generated_at: generatedAt,
        duration_ms: durationMs,
        nodes,
        summary,
        diagnostics,
        diagnostics_summary: diagnosticsSummary,
        prevention: forecast,
        observability: {
          window_hours: 24,
          active_window_hours: 6,
          lifecycle: lifecycleResult.error ? null : lifecycleResult.data,
          incidents,
          resolved_incidents: resolvedIncidents,
          history: incidentHistory,
          summary: {
            open: openIncidents.length,
            recovering: recoveringIncidents.length,
            resolved_recent: resolvedIncidents.length,
            critical: incidents.filter((item: any) => item.severity === "critical").length,
            errors: incidents.filter((item: any) => item.severity === "error").length,
            warnings: incidents.filter((item: any) => item.severity === "warning").length,
            occurrences: incidents.reduce((sum: number, item: any) => sum + Number(item.occurrences || 0), 0),
            reopened: incidents.reduce((sum: number, item: any) => sum + Number(item.reopened_count || 0), 0),
          },
          deployment_comparison: {
            current_commit: currentCommit,
            current_incident_events: currentDeploymentHistory.length,
            current_open_incidents: incidents.filter((item: any) => !currentCommit || item?.metadata?.deployment_commit === currentCommit).length,
            previous_commit: priorDeploymentSnapshot?.deployment_commit || null,
            previous_open_incidents: priorDeploymentSnapshot ? Number(priorDeploymentSnapshot.open_incidents || 0) + Number(priorDeploymentSnapshot.recovering_incidents || 0) : null,
            delta_open_incidents: priorDeploymentSnapshot
              ? incidents.length - (Number(priorDeploymentSnapshot.open_incidents || 0) + Number(priorDeploymentSnapshot.recovering_incidents || 0))
              : null,
          },
        },
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
