// Mirrors the supported effective ranks in crm_free_pass_status/use. The RPC
// remains authoritative for an individual customer's eligibility and balance.
export const FREE_PASS_RANKS = ["plata", "oro", "diamante"] as const;
export type FreePassPolicy = { passes: number; minutes: number; cycle_days: number };

export function rankHasFreePasses(rank: string | null | undefined) {
  return FREE_PASS_RANKS.some(key => key === String(rank || "").trim().toLowerCase());
}

export function freePassPolicyLabel(policy: FreePassPolicy | null | undefined) {
  if (!policy || [policy.passes, policy.minutes, policy.cycle_days].some(value => !Number.isSafeInteger(value) || value <= 0)) return null;
  return `${policy.passes} pases de ${policy.minutes} minutos FREE cada ${policy.cycle_days} días`;
}
