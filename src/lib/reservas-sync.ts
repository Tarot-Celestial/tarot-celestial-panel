/** Cada lectura tiene una URL única para evitar respuestas antiguas de intermediarios. */
export function reservasFreshUrl(path: string, nonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`) {
  const url = new URL(path, "http://reservas.local");
  url.searchParams.set("reserva_sync", nonce);
  return `${url.pathname}${url.search}`;
}

type ReservaSnapshotRow = {
  id: string;
  estado?: string | null;
  updated_at?: string | null;
  fecha_reserva?: string | null;
  nota?: string | null;
  deleted_at?: string | null;
};

/** Solo consideramos confirmado un cambio si una lectura nueva lo devuelve guardado. */
export function reservaMutationInSnapshot(
  action: string,
  saved: ReservaSnapshotRow,
  rows: ReservaSnapshotRow[]
) {
  if (!saved?.id || !Array.isArray(rows)) return false;
  const visible = rows.find(row => row.id === saved.id);
  if (action === "eliminar") return Boolean(saved.deleted_at) && !visible;
  if (!visible || visible.deleted_at || visible.updated_at !== saved.updated_at) return false;

  if (action === "confirmar") return visible.estado === "confirmada";
  if (action === "completar") return visible.estado === "completada";
  if (action === "cancelar") return visible.estado === "cancelada";
  if (action === "aplazar") return visible.estado === "pendiente" && visible.fecha_reserva === saved.fecha_reserva;
  if (action === "nota") return visible.nota === saved.nota;
  return false;
}
