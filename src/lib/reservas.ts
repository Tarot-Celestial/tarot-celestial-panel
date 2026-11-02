export function reservaDate(value: string): Date {
  return new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`);
}
export function reservaClosed(estado: string) {
  return ["completada", "finalizada", "cancelada", "anulada", "eliminada"].includes(String(estado || "").trim().toLowerCase());
}
export function reservaChange(row: any, body: any, worker: string, now = new Date()) {
  if (row.deleted_at) throw new Error("Esta reserva ya está eliminada.");
  if (!["completar", "aplazar", "cancelar", "eliminar", "confirmar", "nota"].includes(body.action)) throw new Error("Acción no válida.");
  if (body.action !== "eliminar" && reservaClosed(row.estado)) throw new Error("Esta reserva ya está cerrada.");
  const motivo = String(body.motivo || "").trim();
  if (motivo.length > 500) throw new Error("El motivo no puede superar 500 caracteres.");
  const patch: Record<string, any> = { updated_at: now.toISOString() };
  let description = body.action === "completar" ? "Reserva cumplida" : "Reserva cancelada";
  if (body.action === "eliminar") {
    if (body.confirmed !== true) throw new Error("Confirma que quieres eliminar esta reserva.");
    patch.deleted_at = now.toISOString();
    patch.estado = "cancelada";
    patch.notify_when_tarotista_idle = false;
    description = `Reserva eliminada de la agenda (registro conservado; estado anterior: ${row.estado || "sin estado"})`;
  } else if (body.action === "aplazar") {
    if (!motivo) throw new Error("Indica el motivo del aplazamiento.");
    const raw = String(body.fecha_reserva || "");
    if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(raw)) throw new Error("Selecciona una fecha y hora válidas.");
    const date = new Date(raw);
    if (!Number.isFinite(date.getTime()) || date <= now) throw new Error("El nuevo horario debe ser futuro.");
    if (date <= reservaDate(row.fecha_reserva)) throw new Error("El nuevo horario debe ser posterior al anterior.");
    patch.fecha_reserva = date.toISOString();
    patch.estado = "pendiente";
    patch.ready_notified_at = null;
    description = `Reserva aplazada: ${reservaDate(row.fecha_reserva).toISOString()} → ${date.toISOString()}`;
  } else if (body.action === "confirmar") {
    patch.estado = "confirmada";
    description = "Asistencia confirmada";
  } else if (body.action === "nota") {
    if (!motivo) throw new Error("Escribe una nota para guardar.");
    description = "Nota operativa";
  } else patch.estado = body.action === "completar" ? "completada" : "cancelada";
  patch.nota = [row.nota, `[${now.toISOString()}] ${worker}: ${description}${motivo ? ` · ${motivo}` : ""}`].filter(Boolean).join("\n");
  return patch;
}

const reservationDayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" });
export function reservaDay(value: string | number | Date) {
  const date = typeof value === "string" ? reservaDate(value) : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const parts = reservationDayFormatter.formatToParts(date);
  return ["year", "month", "day"].map(type => parts.find(part => part.type === type)?.value).join("-");
}
export function reservaInView(row: { fecha_reserva: string; estado: string }, view: string, now: number) {
  const due = reservaDate(row.fecha_reserva).getTime();
  const today = reservaDay(now), day = reservaDay(row.fecha_reserva);
  if (!Number.isFinite(due)) return view === "historial";
  if (view === "agenda") return day >= today;
  if (view === "hoy") return day === today;
  if (view === "proximas") return due > now;
  if (view === "atrasadas") return !reservaClosed(row.estado) && due < now;
  return true;
}
export function reservaTiming(value: string, now: number) {
  const minutes = Math.ceil((reservaDate(value).getTime() - now) / 60_000);
  if (!Number.isFinite(minutes)) return "Horario por revisar";
  if (minutes === 0) return "Es la hora";
  if (minutes < 0) return `Pendiente desde hace ${Math.abs(minutes) < 60 ? `${Math.abs(minutes)} min` : `${Math.floor(Math.abs(minutes) / 60)} h`}`;
  return minutes < 60 ? `En ${minutes} min` : minutes < 1440 ? `En ${Math.floor(minutes / 60)} h ${minutes % 60} min` : `En ${Math.ceil(minutes / 1440)} días`;
}
