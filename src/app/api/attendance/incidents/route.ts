import { NextResponse } from "next/server";
import { getAdminClient, normalizeMonthKey, workerFromRequest } from "@/lib/server/auth-worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "private, no-store, max-age=0" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
}

function validTime(value: string) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function minutesBetween(start: string, end: string) {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let mins = eh * 60 + em - (sh * 60 + sm);
  if (mins <= 0) mins += 1440;
  return mins;
}

async function canManage(req: Request) {
  const me = await workerFromRequest(req);
  if (!me) return { ok: false as const, response: json({ ok: false, error: "NO_AUTH" }, 401) };
  if (!["admin", "central", "tarotista"].includes(me.role)) {
    return { ok: false as const, response: json({ ok: false, error: "FORBIDDEN" }, 403) };
  }
  return { ok: true as const, me, admin: getAdminClient() };
}

export async function GET(req: Request) {
  try {
    const gate = await canManage(req);
    if (!gate.ok) return gate.response;
    const url = new URL(req.url);
    const month = normalizeMonthKey(url.searchParams.get("month"));
    const requestedWorker = String(url.searchParams.get("worker_id") || "");
    const workerId = gate.me.role === "tarotista" ? gate.me.id : requestedWorker || null;

    let workersQuery = gate.admin
      .from("workers")
      .select("id,display_name,role,team,is_active,user_id,auth_user_id")
      .eq("role", "tarotista")
      .order("display_name");
    if (workerId) workersQuery = workersQuery.eq("id", workerId);
    else workersQuery = workersQuery.or("is_active.is.null,is_active.eq.true");

    let incidentQuery = gate.admin
      .from("v_attendance_incidents")
      .select("*")
      .eq("invoice_month", month)
      .order("incident_date", { ascending: false })
      .order("created_at", { ascending: false });
    if (workerId) incidentQuery = incidentQuery.eq("worker_id", workerId);

    const [workersResult, incidentResult, settingsResult] = await Promise.all([
      workersQuery,
      incidentQuery,
      gate.admin.from("attendance_incident_settings").select("*").eq("id", 1).maybeSingle(),
    ]);
    if (workersResult.error) throw workersResult.error;
    if (incidentResult.error) throw incidentResult.error;
    if (settingsResult.error) throw settingsResult.error;

    const incidents = incidentResult.data || [];
    const incidentIds = incidents.map((item: any) => String(item.id));
    const workerIds = (workersResult.data || []).map((item: any) => String(item.id));

    const [recoveriesResult, justificationsResult, auditResult, schedulesResult] = await Promise.all([
      incidentIds.length
        ? gate.admin.from("attendance_incident_recoveries").select("*").in("incident_id", incidentIds).order("created_at")
        : Promise.resolve({ data: [], error: null } as any),
      incidentIds.length
        ? gate.admin.from("attendance_incident_justifications").select("*").in("incident_id", incidentIds).order("created_at")
        : Promise.resolve({ data: [], error: null } as any),
      incidentIds.length
        ? gate.admin.from("attendance_incident_audit").select("*").in("incident_id", incidentIds).order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null } as any),
      workerIds.length
        ? gate.admin.from("shift_schedules").select("id,worker_id,day_of_week,start_time,end_time,timezone,active").in("worker_id", workerIds).eq("active", true)
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    for (const result of [recoveriesResult, justificationsResult, auditResult, schedulesResult]) {
      if (result.error) throw result.error;
    }

    const recoveries = recoveriesResult.data || [];
    const justifications = justificationsResult.data || [];
    const audit = auditResult.data || [];
    const hydrated = incidents.map((incident: any) => ({
      ...incident,
      recoveries: recoveries.filter((item: any) => item.incident_id === incident.id),
      justifications: justifications.filter((item: any) => item.incident_id === incident.id),
      audit: audit.filter((item: any) => item.incident_id === incident.id),
    }));

    const summary = hydrated.reduce(
      (acc: any, item: any) => {
        acc.total += 1;
        acc.missed_minutes += Number(item.missed_minutes || 0);
        acc.recovered_minutes += Number(item.recovered_minutes || 0);
        acc.justified_minutes += Number(item.justified_minutes || 0);
        acc.pending_minutes += Number(item.pending_minutes || 0);
        if (["pending", "partial"].includes(String(item.status))) acc.open += 1;
        if (["recovered", "justified", "closed"].includes(String(item.status))) acc.resolved += 1;
        return acc;
      },
      { total: 0, open: 0, resolved: 0, missed_minutes: 0, recovered_minutes: 0, justified_minutes: 0, pending_minutes: 0 }
    );

    return json({
      ok: true,
      month,
      role: gate.me.role,
      workers: workersResult.data || [],
      schedules: schedulesResult.data || [],
      settings: settingsResult.data || null,
      incidents: hydrated,
      summary,
    });
  } catch (error: any) {
    console.error("[attendance:incidents:get]", error);
    return json({ ok: false, error: error?.message || "ATTENDANCE_INCIDENTS_GET_ERROR" }, 500);
  }
}

export async function POST(req: Request) {
  try {
    const gate = await canManage(req);
    if (!gate.ok) return gate.response;
    if (!["admin", "central"].includes(gate.me.role)) return json({ ok: false, error: "FORBIDDEN" }, 403);

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");

    if (action === "settings") {
      if (gate.me.role !== "admin") return json({ ok: false, error: "ADMIN_ONLY" }, 403);
      const patch = {
        allow_central_justify: Boolean(body.allow_central_justify),
        require_notes: Boolean(body.require_notes),
        notify_worker: Boolean(body.notify_worker),
        show_in_invoice: Boolean(body.show_in_invoice),
        allow_partial_recovery: Boolean(body.allow_partial_recovery),
        reasons: Array.isArray(body.reasons) ? body.reasons.map((x: any) => String(x).trim()).filter(Boolean).slice(0, 30) : undefined,
        updated_by: gate.me.id,
        updated_at: new Date().toISOString(),
      } as any;
      if (!patch.reasons) delete patch.reasons;
      const result = await gate.admin.from("attendance_incident_settings").update(patch).eq("id", 1).select("*").single();
      if (result.error) throw result.error;
      return json({ ok: true, settings: result.data });
    }

    if (action === "create") {
      const workerId = String(body.worker_id || "");
      const date = String(body.incident_date || "");
      const start = String(body.missed_start || "");
      const end = String(body.missed_end || "");
      const reason = String(body.reason_code || "").trim();
      const detail = String(body.reason_detail || "").trim();
      const notes = String(body.notes || "").trim();
      if (!workerId || !validDate(date) || !validTime(start) || !validTime(end) || !reason) {
        return json({ ok: false, error: "Completa trabajador, fecha, horario y motivo." }, 400);
      }
      if (start === end || minutesBetween(start, end) <= 0) return json({ ok: false, error: "El horario afectado no es válido." }, 400);
      const target = await gate.admin.from("workers").select("id,role").eq("id", workerId).eq("role", "tarotista").maybeSingle();
      if (target.error) throw target.error;
      if (!target.data) return json({ ok: false, error: "Tarotista no encontrada." }, 404);

      const dow = new Date(date + "T12:00:00Z").getUTCDay();
      const schedule = await gate.admin
        .from("shift_schedules")
        .select("start_time,end_time")
        .eq("worker_id", workerId)
        .eq("day_of_week", dow)
        .eq("active", true)
        .order("start_time")
        .limit(1)
        .maybeSingle();

      const result = await gate.admin.rpc("attendance_create_incident", {
        p_worker_id: workerId,
        p_incident_date: date,
        p_missed_start: start,
        p_missed_end: end,
        p_reason_code: reason,
        p_reason_detail: reason === "Otro" ? detail : detail || null,
        p_notes: notes || null,
        p_created_by: gate.me.id,
        p_scheduled_start: body.scheduled_start || schedule.data?.start_time || null,
        p_scheduled_end: body.scheduled_end || schedule.data?.end_time || null,
      });
      if (result.error) throw result.error;
      return json({ ok: true, id: result.data });
    }

    if (action === "recovery") {
      const incidentId = String(body.incident_id || "");
      const date = String(body.recovery_date || "");
      const start = String(body.start_time || "");
      const end = String(body.end_time || "");
      if (!incidentId || !validDate(date) || !validTime(start) || !validTime(end) || start === end) {
        return json({ ok: false, error: "Completa fecha y horario de recuperación." }, 400);
      }
      const result = await gate.admin.rpc("attendance_add_recovery", {
        p_incident_id: incidentId,
        p_recovery_date: date,
        p_start_time: start,
        p_end_time: end,
        p_notes: String(body.notes || "").trim() || null,
        p_created_by: gate.me.id,
      });
      if (result.error) throw result.error;
      return json({ ok: true, result: result.data });
    }

    if (action === "justify") {
      const incidentId = String(body.incident_id || "");
      const minutes = Number(body.minutes || 0);
      const reason = String(body.reason || "").trim();
      const settings = await gate.admin.from("attendance_incident_settings").select("allow_central_justify").eq("id", 1).maybeSingle();
      if (settings.error) throw settings.error;
      if (gate.me.role === "central" && settings.data?.allow_central_justify === false) {
        return json({ ok: false, error: "Solo Administración puede justificar horas." }, 403);
      }
      if (!incidentId || !Number.isInteger(minutes) || minutes <= 0 || !reason) {
        return json({ ok: false, error: "Indica minutos y motivo de justificación." }, 400);
      }
      const result = await gate.admin.rpc("attendance_add_justification", {
        p_incident_id: incidentId,
        p_minutes: minutes,
        p_reason: reason,
        p_created_by: gate.me.id,
      });
      if (result.error) throw result.error;
      return json({ ok: true, result: result.data });
    }

    if (action === "close") {
      const incidentId = String(body.incident_id || "");
      if (!incidentId) return json({ ok: false, error: "Incidencia no válida." }, 400);
      const result = await gate.admin.rpc("attendance_close_incident", {
        p_incident_id: incidentId,
        p_created_by: gate.me.id,
      });
      if (result.error) throw result.error;
      return json({ ok: true, result: result.data });
    }

    if (action === "edit") {
      const incidentId = String(body.incident_id || "");
      const current = await gate.admin.from("v_attendance_incidents").select("*").eq("id", incidentId).maybeSingle();
      if (current.error) throw current.error;
      if (!current.data) return json({ ok: false, error: "Incidencia no encontrada." }, 404);

      const start = String(body.missed_start || current.data.missed_start).slice(0, 5);
      const end = String(body.missed_end || current.data.missed_end).slice(0, 5);
      const reasonCode = String(body.reason_code || current.data.reason_code).trim();
      const notes = String(body.notes ?? current.data.notes ?? "").trim();
      if (!validTime(start) || !validTime(end) || start === end || !reasonCode) {
        return json({ ok: false, error: "Datos de edición no válidos." }, 400);
      }
      const missedMinutes = minutesBetween(start, end);
      const alreadyAccounted = Number(current.data.recovered_minutes || 0) + Number(current.data.justified_minutes || 0);
      if (missedMinutes < alreadyAccounted) {
        return json({ ok: false, error: "No puedes reducir las horas por debajo de lo ya recuperado/justificado." }, 409);
      }

      const patch = {
        missed_start: start,
        missed_end: end,
        missed_minutes: missedMinutes,
        reason_code: reasonCode,
        reason_detail: String(body.reason_detail || "").trim() || null,
        notes: notes || null,
        updated_at: new Date().toISOString(),
      };
      const updated = await gate.admin.from("attendance_incidents").update(patch).eq("id", incidentId).select("*").single();
      if (updated.error) throw updated.error;
      await gate.admin.from("attendance_incident_audit").insert({
        incident_id: incidentId,
        action: "edited",
        actor_id: gate.me.id,
        actor_role: gate.me.role,
        before_data: current.data,
        after_data: updated.data,
      });
      return json({ ok: true });
    }

    return json({ ok: false, error: "Acción no válida." }, 400);
  } catch (error: any) {
    console.error("[attendance:incidents:post]", error);
    return json({ ok: false, error: error?.message || "ATTENDANCE_INCIDENTS_POST_ERROR" }, 500);
  }
}
