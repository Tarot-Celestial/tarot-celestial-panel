import { reservaClosed, reservaDate } from "./reservas";

type Reservation = {
  id?: unknown;
  fecha_reserva?: unknown;
  estado?: unknown;
  deleted_at?: unknown;
  tarotista_id?: unknown;
  notify_when_tarotista_idle?: unknown;
};

export function reservationAlertDate(row: Reservation): Date | null {
  const date = reservaDate(String(row.fecha_reserva || ""));
  return Number.isFinite(date.getTime()) ? date : null;
}

export function reservationAlertOpen(row: Reservation) {
  const state = String(row.estado || "").trim().toLowerCase();
  return !!row.id && !row.deleted_at && !reservaClosed(state)
    && ["pendiente", "confirmada"].includes(state) && !!reservationAlertDate(row);
}

export function reservationAlertKey(row: Reservation, kind = "due") {
  return `${kind}:${row.id}:${reservationAlertDate(row)?.toISOString() || "invalid"}`;
}

export function reservationAlertDue(row: Reservation, now: number) {
  const due = reservationAlertDate(row)?.getTime();
  // Never fire before the scheduled time; catch the next five-second clock tick.
  return reservationAlertOpen(row) && due !== undefined && due <= now && now - due <= 30_000;
}

export function sameReservationAlert(a: Reservation, b: Reservation) {
  return a.id === b.id && reservationAlertOpen(b)
    && reservationAlertDate(a)?.getTime() === reservationAlertDate(b)?.getTime()
    && a.tarotista_id === b.tarotista_id
    && a.notify_when_tarotista_idle === b.notify_when_tarotista_idle;
}
