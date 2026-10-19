import type { RecoveryMissionSnapshot } from '@/lib/recovery-mission';
import type { AtlasMessage } from '@/lib/atlas';
export type { AtlasCard, AtlasProposal, AtlasMessage } from '@/lib/atlas';
export type AtlasMemory = { id: string; content: string; created_at?: string; updated_at?: string };
export type AtlasJob = { id: string; title: string; description?: string; status: string; worker_id?: string; worker_name?: string; created_at?: string; due_at?: string; result?: string };
export type AtlasSignal = { id: string; title: string; description: string; severity?: string; evidence?: string[]; href?: string; prompt?: string };
export type AtlasAnomaly = { id: string; title: string; description: string; evidence: Record<string, unknown>[] };
export type AtlasMission = RecoveryMissionSnapshot & { worker_name?: string };
export type AtlasOverview = {
  updatedAt?: string; timezone?: string;
  revenue?: { today: number | null; goal?: number | null; met?: boolean | null; source?: string };
  acquisition?: { month?: string; count: number | null; goal?: number | null; source?: string };
  missions?: AtlasMission[] | null; alerts?: AtlasSignal[]; insights?: AtlasSignal[]; pendingJobs?: AtlasJob[] | null;
  unavailable?: string[]; workers?: { id: string; display_name: string }[];
  anomalies?: AtlasAnomaly[];
  history?: { day: string; revenue: number | null; purchases: number | null; captures: number | null; managed: number | null; recovered: number | null }[];
};
export type AtlasData = {
  overview: AtlasOverview | null; messages: AtlasMessage[]; memories: AtlasMemory[]; jobs: AtlasJob[];
  aiConfigured: boolean | null;
};

export function atlasInternalHref(value?: string): string | null {
  // Cards never turn model-supplied URLs into script URLs or external navigation.
  return value && /^\/admin(?:[/?#]|$)/.test(value) && !/[\\\s]/.test(value) ? value : null;
}

export function atlasNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function atlasProgress(value: number | null, goal: number): number {
  return value === null || goal <= 0 ? 0 : Math.max(0, Math.min(100, value / goal * 100));
}

export function atlasStamp(value?: string): string {
  if (!value || !Number.isFinite(Date.parse(value))) return 'Sin fecha disponible';
  return new Intl.DateTimeFormat('es-EC', { timeZone: 'America/Guayaquil', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}
