/** The server owns shifts, counts, assignments and XP. The browser only presents them. */
export type RecoveryMission = {
  enabled: true;
  worker_id: string;
  server_now: string;
  timezone: 'America/Guayaquil';
  day: string;
  is_workday: boolean;
  active: boolean;
  starts_at: string;
  ends_at: string;
  notice_at: string;
  target: number;
  managed: number;
  recovered: number;
  recovery_target: number;
  management_bonus: number;
  recovery_bonus: number;
  management_bonus_awarded: boolean;
  recovery_bonus_awarded: boolean;
  awarded_xp: number;
  assigned_client_ids: string[];
  expected_managed: number;
  next_checkpoint_at: string | null;
};
export type RecoveryMissionSnapshot = RecoveryMission | {
  enabled: false;
  worker_id: string;
  server_now: string;
};
export const RECOVERY_MISSION_REFRESH = 'tc-recovery-mission-refresh';
export type RecoveryMissionPhase = 'unavailable' | 'disabled' | 'rest' | 'before_shift' | 'before_notice' | 'active' | 'behind' | 'complete' | 'ended';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function instant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}
export function parseRecoveryMission(value: unknown, workerId?: string | null): RecoveryMissionSnapshot {
  const invalid = () => new Error('No se ha podido verificar la misión. Actualiza para consultar el progreso real.');
  if (!record(value) || typeof value.worker_id !== 'string' || !value.worker_id || !instant(value.server_now)
    || (workerId && value.worker_id !== workerId)) throw invalid();
  if (value.enabled === false) return { enabled: false, worker_id: value.worker_id, server_now: value.server_now };
  if (value.enabled !== true || value.timezone !== 'America/Guayaquil' || typeof value.day !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(value.day)) throw invalid();
  for (const key of ['is_workday', 'active', 'management_bonus_awarded', 'recovery_bonus_awarded']) {
    if (typeof value[key] !== 'boolean') throw invalid();
  }
  for (const key of ['target', 'managed', 'recovered', 'recovery_target', 'management_bonus', 'recovery_bonus', 'awarded_xp', 'expected_managed']) {
    if (!Number.isSafeInteger(value[key]) || Number(value[key]) < 0) throw invalid();
  }
  if (!value.target || !value.recovery_target || !instant(value.starts_at) || !instant(value.ends_at) || !instant(value.notice_at)
    || Date.parse(value.ends_at) <= Date.parse(value.starts_at)
    || Date.parse(value.notice_at) < Date.parse(value.starts_at) || Date.parse(value.notice_at) >= Date.parse(value.ends_at)
    || !(value.next_checkpoint_at === null || instant(value.next_checkpoint_at))
    || !Array.isArray(value.assigned_client_ids) || value.assigned_client_ids.some(id => typeof id !== 'string')) throw invalid();
  return value as RecoveryMission;
}

export function recoveryMissionPhase(mission: RecoveryMissionSnapshot | null): RecoveryMissionPhase {
  if (!mission) return 'unavailable';
  if (!mission.enabled) return 'disabled';
  if (!mission.is_workday) return 'rest';
  const now = Date.parse(mission.server_now);
  if (now < Date.parse(mission.starts_at)) return 'before_shift';
  if (now >= Date.parse(mission.ends_at) || !mission.active) return 'ended';
  if (mission.managed >= mission.target) return 'complete';
  if (now < Date.parse(mission.notice_at)) return 'before_notice';
  if (now >= Date.parse(mission.notice_at) + 40 * 60_000 && mission.managed < mission.expected_managed) return 'behind';
  return 'active';
}

export function recoveryMissionTime(value: string): string {
  return new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}

export function recoveryMissionMessage(mission: RecoveryMission): string {
  switch (recoveryMissionPhase(mission)) {
    case 'rest': return 'Hoy no hay cuota ni avisos de recuperación. Las gestiones siguen disponibles.';
    case 'before_shift': return `Tu turno empieza a las ${recoveryMissionTime(mission.starts_at)}. El aviso de tu misión será a las ${recoveryMissionTime(mission.notice_at)}.`;
    case 'before_notice': return `Tu misión se anuncia a las ${recoveryMissionTime(mission.notice_at)}. Las gestiones válidas de tu turno ya cuentan.`;
    case 'behind': return `Llevas ${mission.managed} de ${mission.target} gestiones. La referencia a esta hora es ${mission.expected_managed}; vamos paso a paso para recuperar el ritmo.`;
    case 'complete': return mission.management_bonus_awarded ? `Misión completada: ${mission.target} gestiones y ${mission.management_bonus} XP registrados. Cada recuperación sigue sumando.` : 'Has alcanzado la meta de gestiones. La acreditación del bono aún no está confirmada.';
    case 'ended': return 'Tu turno ha terminado. Este es el progreso registrado hoy; los avisos están en pausa.';
    default: return `Es hora de tu misión: gestionar ${mission.target} clientes. Marca «Fue contactada» después de cada contacto real.`;
  }
}

/** Describe the persisted receipt; saving a CRM state alone does not prove mission credit. */
export function recoveryContactReceipt(value: unknown): string {
  if (!record(value)) return 'Contacto guardado. Actualiza la misión para comprobar si esta gestión ha sumado.';
  let progress = '';
  try {
    const mission = parseRecoveryMission(value.mission);
    if (mission.enabled) progress = ` Llevas ${mission.managed}/${mission.target} gestiones.`;
  } catch { /* A missing snapshot must never become an invented count. */ }
  if (value.counted === true) {
    return value.duplicate_prevented === true
      ? `Esta gestión ya estaba guardada; el reintento no la ha duplicado.${progress}`
      : `+1 gestión registrada en tu misión.${progress}`;
  }
  switch (value.count_reason) {
    case 'already_counted': return `Esta clienta ya cuenta en la misión de hoy. No se suma otra vez.${progress}`;
    case 'outside_shift': return 'Contacto guardado. No suma a la misión porque se registró fuera de tu turno de recuperación.';
    case 'not_assigned': return 'Contacto guardado, pero no suma a tu misión: revisa la asignación o si ya corresponde su seguimiento.';
    default: return 'Contacto guardado. No se ha confirmado que sume a la misión; actualiza para comprobar el progreso.';
  }
}

