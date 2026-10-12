import { reservaDate } from './reservas';

export const RESERVATION_THRESHOLDS = [10, 5, 1] as const;
export type ReservationThreshold = typeof RESERVATION_THRESHOLDS[number];
export type UpcomingReservation = {
  id: string;
  clientId: string;
  clientName: string;
  tarotistName: string;
  scheduledAt: string;
  actionPath: string;
};
export type ReservationReminder = UpcomingReservation & {
  key: string;
  threshold: ReservationThreshold;
  minutesRemaining: number;
};

// A late arrival receives only the most urgent applicable reminder, never 10 + 5 + 1.
export function reservationThreshold(scheduledAt: string, now: number): ReservationThreshold | null {
  const remaining = reservaDate(scheduledAt).getTime() - now;
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 600_000) return null;
  if (remaining <= 60_000) return 1;
  if (remaining <= 300_000) return 5;
  return 10;
}

export function reservationReminderKey(id: string, scheduledAt: string, threshold: ReservationThreshold) {
  return `reservation:${id}:${reservaDate(scheduledAt).toISOString()}:${threshold}`;
}

export function reservationCandidates(rows: UpcomingReservation[], now: number): ReservationReminder[] {
  return rows.flatMap(row => {
    const threshold = reservationThreshold(row.scheduledAt, now);
    return threshold === null ? [] : [{
      ...row,
      threshold,
      key: reservationReminderKey(row.id, row.scheduledAt, threshold),
      minutesRemaining: Math.max(1, Math.ceil((reservaDate(row.scheduledAt).getTime() - now) / 60_000)),
    }];
  }).sort((a, b) => reservaDate(a.scheduledAt).getTime() - reservaDate(b.scheduledAt).getTime() || a.id.localeCompare(b.id));
}

export function isCurrentReservationReminder(reminder: ReservationReminder, rows: UpcomingReservation[], now: number) {
  return rows.some(row => row.id === reminder.id && row.clientId === reminder.clientId && row.scheduledAt === reminder.scheduledAt)
    && reservationThreshold(reminder.scheduledAt, now) === reminder.threshold;
}
