"use client";

import { useEffect, useMemo, useState, type ComponentProps } from "react";
import OfficeMap from "./OfficeMap";
import { officeDepartments } from "./catalog";
import { officeRequest } from "./office-client";
import type { OfficeSnapshot } from "./model";
import type { OfficeMapHandoff, OfficeMapStation } from "./office-map-activity";

type Activity = { checked_at: string | null; handoffs: OfficeMapHandoff[] };

export default function OfficeLiveMap({ data, ...props }: ComponentProps<typeof OfficeMap> & { data: OfficeSnapshot }) {
  const [activity, setActivity] = useState<Activity | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    let reading = false;
    async function read() {
      if (reading || abort.signal.aborted || document.visibilityState === "hidden") return;
      reading = true;
      try {
        const next = await officeRequest<Activity>("/api/admin/office/agents", { signal: abort.signal });
        if (!abort.signal.aborted) { setActivity(next); setError(null); }
      } catch (e) {
        if (!abort.signal.aborted) setError(e instanceof Error ? e.message : "No se pudo actualizar la actividad.");
      } finally { reading = false; }
    }
    void read();
    const timer = window.setInterval(read, 30000);
    document.addEventListener("visibilitychange", read);
    return () => { abort.abort(); window.clearInterval(timer); document.removeEventListener("visibilitychange", read); };
  }, []);
  const handoffs = useMemo(() => {
    const transfers: OfficeMapHandoff[] = [];
    const departments: Set<string> = new Set(officeDepartments.map(item => item.id));
    for (const event of data.events) {
      if (!event.previous_department_id || event.previous_department_id === event.department_id ||
          !departments.has(event.previous_department_id) || !departments.has(event.department_id)) continue;
      const task = data.tasks.find(item => item.id === event.task_id);
      if (task) transfers.push({ id: event.id, taskId: task.id, taskTitle: task.objective,
        from: event.previous_department_id as OfficeMapStation, to: event.department_id as OfficeMapStation,
        what: "Encargo transferido al departamento", at: event.created_at });
    }
    return [...(activity?.handoffs || []), ...transfers].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  }, [data.events, data.tasks, activity]);
  return <><OfficeMap {...props} tasks={data.tasks} handoffs={handoffs} activityError={error} loadingActivity={!activity && !error}/>
    {activity?.checked_at && <p style={{ margin: "0 16px 12px", fontSize: 12, color: "var(--muted)" }}>
      Última ronda automática · {new Intl.DateTimeFormat("es-ES", { timeZone: "Europe/Madrid", dateStyle: "short", timeStyle: "short" }).format(new Date(activity.checked_at))} (Madrid)
    </p>}</>;
}
