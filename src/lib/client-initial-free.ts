export function initialFreeReason(reason: unknown) {
  switch (reason) {
    case "ALREADY_USED":
    case "INITIAL_FREE_ALREADY_USED": return "El regalo de primera consulta ya se utilizó.";
    case "HAS_PREVIOUS_CONSULTATION":
    case "PREVIOUS_CONSULTATION": return "Este cliente ya tiene una consulta registrada. El regalo es solo para su primera consulta.";
    case "HISTORY_UNAVAILABLE":
    case "UNAVAILABLE": return "No se pudo comprobar el historial del cliente. Actualiza la ficha antes de continuar.";
    case "CLIENTE_NO_ENCONTRADO": return "No se pudo identificar al cliente. Actualiza la ficha antes de continuar.";
    case "POLICY_NOT_CONFIGURED": return "El regalo de primera consulta todavía no está disponible.";
    default: return "No se pudo confirmar el regalo de primera consulta. Cierra y vuelve a abrir el registro para actualizarlo.";
  }
}

/** A zero balance or any rank never substitutes for a server eligibility check. */
export function initialFreeUsage(value: unknown) {
  const preview = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const policyKey = preview.policy_key === "initial_consultation_once_v1" ? preview.policy_key : null;
  const valid = policyKey != null && preview.minutes === 7;
  const reason = typeof preview.reason === "string" ? preview.reason : null;
  return { eligible: valid && preview.eligible === true && preview.reason === null, minutes: valid ? 7 : 0, policyKey, reason, explanation: initialFreeReason(reason) };
}
