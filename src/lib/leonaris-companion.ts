import { LEO_SECTIONS, validLeoAction, type LeoAction } from "@/lib/leo-guide";

export type LeonarisStyle = "warm" | "concise";
export type LeoMemory = { id: string; content: string; createdAt: string };
export type LeoChatTurn = { id: string; role: "user" | "assistant"; content: string; createdAt: string };
export type LeoCompanionAnswer = { id: string; title: string; message: string; actions: LeoAction[]; mode: "ai" | "guided" };
export type LeoFavoriteSection = { context: string; label: string; path: string; score: number };
export type LeoCompanion = {
  displayName: string | null;
  memoryEnabled: boolean;
  style: LeonarisStyle;
  memories: LeoMemory[];
  favoriteSections: LeoFavoriteSection[];
  learning: { helpful: number; unhelpful: number; visits: number; summary: string };
  greeting: { id: string; title: string; message: string; actions: LeoAction[] } | null;
};
export type LeonarisPreferences = { displayName?: string | null; memoryEnabled?: boolean; style?: LeonarisStyle };
export const LEONARIS_LIMITS = { memories: 20, memoryLength: 400, questionLength: 2000, historyTurns: 12, retainedChats: 60 } as const;

export function validLeonarisId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

/** Explicit memories are user-authored notes, never inferred facts. */
export function normalizeLeonarisMemory(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const content = value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  return content && Array.from(content).length <= LEONARIS_LIMITS.memoryLength ? content : null;
}

export function validLeonarisAnswer(value: unknown): value is LeoCompanionAnswer {
  if (!value || typeof value !== "object") return false;
  const answer = value as Partial<LeoCompanionAnswer>;
  return validLeonarisId(answer.id) && typeof answer.title === "string" && answer.title.length > 0 && answer.title.length <= 160
    && typeof answer.message === "string" && answer.message.length > 0 && answer.message.length <= 4000
    && (answer.mode === "ai" || answer.mode === "guided") && Array.isArray(answer.actions)
    && answer.actions.length <= 6 && answer.actions.every(validLeoAction);
}

export function leonarisFavoriteSections(profile: { interest_scores?: unknown; visit_counts?: unknown } | null): LeoFavoriteSection[] {
  const interests = profile?.interest_scores && typeof profile.interest_scores === "object" ? profile.interest_scores as Record<string, unknown> : {};
  const visits = profile?.visit_counts && typeof profile.visit_counts === "object" ? profile.visit_counts as Record<string, unknown> : {};
  return LEO_SECTIONS.filter(section => section.key !== "dashboard").map(section => {
    const interest = Number(interests[section.key]);
    const visit = Number(visits[section.key]);
    const score = (Number.isFinite(interest) && interest > 0 ? interest : 0) + (Number.isFinite(visit) && visit > 0 ? visit : 0);
    return { context: section.key, label: section.label, path: section.path, score };
  }).filter(section => section.score > 0).sort((a, b) => b.score - a.score || a.context.localeCompare(b.context)).slice(0, 3);
}

export function leonarisVisitCount(profile: { visit_counts?: unknown } | null): number {
  if (!profile?.visit_counts || typeof profile.visit_counts !== "object") return 0;
  return Object.values(profile.visit_counts).reduce<number>((sum, value) => {
    const amount = Number(value);
    return sum + (Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 0);
  }, 0);
}
