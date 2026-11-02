"use client";
import { useReservationReminders } from "@/features/central/assistant/useReservationReminders";
import styles from "./ReservasGlobalWatcher.module.css";

export default function ReservationAdvanceNotice({ workerId, hidden, onOpen }: { workerId: string; hidden: boolean; onOpen: (row: { id: string }) => void }) {
  const { reminder, dismiss, error, refresh } = useReservationReminders({ enabled: !!workerId && !hidden, workerId });
  if (hidden) return null;
  if (error) return <aside className={styles.advanceNotice} role="status"><strong>Atlas · Avisos de reservas</strong><p>{error}</p><button onClick={refresh}>Reintentar</button></aside>;
  if (!reminder) return null;
  return <aside className={styles.advanceNotice} role="status" aria-live="polite">
    <header><img src="/companions/atlas-celestial-v2.webp" width={44} height={44} alt=""/><strong>Atlas · Reserva en {reminder.minutesRemaining} {reminder.minutesRemaining === 1 ? "minuto" : "minutos"}</strong><button aria-label="Cerrar recordatorio" onClick={dismiss}>×</button></header>
    <p><b>{reminder.clientName}</b><br/>{reminder.tarotistName} · {new Date(reminder.scheduledAt).toLocaleTimeString("es-ES", { timeZone: "Europe/Madrid", hour: "2-digit", minute: "2-digit" })} Madrid</p>
    <button onClick={() => { const id = reminder.id; dismiss(); onOpen({ id }); }}>Ir hacia la reserva</button>
  </aside>;
}
