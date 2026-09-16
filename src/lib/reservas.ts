export function reservaDate(value: string): Date {
  return new Date(/(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`);
}
export function reservaClosed(estado: string) {
  return ["completada", "finalizada", "cancelada"].includes(estado);
}
export function reservaChange(row: any, body: any, worker: string, now = new Date()) {
  if (reservaClosed(row.estado)) throw new Error("Esta reserva ya está cerrada.");
  if (!["completar", "aplazar", "cancelar"].includes(body.action)) throw new Error("Acción no válida.");
  const motivo = String(body.motivo || "").trim();
  if (motivo.length > 500) throw new Error("El motivo no puede superar 500 caracteres.");
  const patch: Record<string, any> = { updated_at: now.toISOString() };
  let description = body.action === "completar" ? "Reserva cumplida" : "Reserva cancelada";
  if (body.action === "aplazar") {
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
  } else patch.estado = body.action === "completar" ? "completada" : "cancelada";
  patch.nota = [row.nota, `[${now.toISOString()}] ${worker}: ${description}${motivo ? ` · ${motivo}` : ""}`].filter(Boolean).join("\n");
  return patch;
}
