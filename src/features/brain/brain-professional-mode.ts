export type BrainProfessionalPlanMode = "auto_execute" | "human_approval";

export type BrainProfessionalPlanItem = {
  id: string;
  action_key: "probe_core_services" | "refresh_incident_lifecycle" | "resolve_recovered_incident";
  title: string;
  mode: BrainProfessionalPlanMode;
  risk: "low" | "medium";
  reason: string;
  target_node_id?: string | null;
  incident_id?: string | null;
  due: boolean;
  blocked_reason?: string | null;
};

export const BRAIN_PROFESSIONAL_MODE = {
  enabled: true,
  tickIntervalMs: 60_000,
  probeCooldownMs: 10 * 60_000,
  lifecycleCooldownMs: 5 * 60_000,
  recoveringProposalCooldownMs: 30 * 60_000,
  snapshotStaleMs: 3 * 60_000,
  recoveringMinAgeMs: 5 * 60_000,
  elevatedRiskScore: 35,
  highRiskScore: 60,
} as const;

export const BRAIN_PROFESSIONAL_SAFETY = {
  autoExecuteRisk: ["low"] as const,
  humanApprovalRisk: ["medium"] as const,
  businessMutationsEnabled: false,
  externalDeploymentsEnabled: false,
  destructiveActionsEnabled: false,
  schemaChangesEnabled: false,
} as const;
