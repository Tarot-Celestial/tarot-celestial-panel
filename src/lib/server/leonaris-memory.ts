import "server-only";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { LEO_SECTIONS } from "@/lib/leo-guide";
import { normalizeLeonarisMemory, validLeonarisAnswer, validLeonarisId, type LeoChatTurn, type LeoCompanionAnswer, type LeoMemory, type LeonarisPreferences, type LeonarisStyle } from "@/lib/leonaris-companion";

export class LeonarisMemoryError extends Error {
  constructor(public readonly code: string) { super(`Leonaris memory: ${code}`); this.name = "LeonarisMemoryError"; }
}
export type LeonarisMemoryState = {
  displayName: string | null; memoryEnabled: boolean; style: LeonarisStyle; memories: LeoMemory[];
  history: LeoChatTurn[]; helpful: number; unhelpful: number;
  profile: { visit_counts: Record<string, number>; interest_scores: Record<string, number>; interaction_counts: Record<string, number>; last_path: string | null; last_seen_at: string | null } | null;
};
export type LeonarisChatClaim =
  | { status: "claimed"; claimToken: string }
  | { status: "completed"; answer: LeoCompanionAnswer | null }
  | { status: "in_progress" | "rate_limited"; retryAfter: number };

// clientId MUST come from the server's verified CRM/auth identity gate, never a request body.
async function memoryOperation(clientId: string, operation: string, payload: Record<string, unknown> = {}): Promise<any> {
  if (!validLeonarisId(clientId)) throw new LeonarisMemoryError("invalid_client");
  const { data, error } = await supabaseAdmin().rpc("tc_leonaris_memory", { p_client_id: clientId, p_operation: operation, p_payload: payload });
  if (error || !data || typeof data !== "object") throw new LeonarisMemoryError("unavailable");
  if (data.status === "error") throw new LeonarisMemoryError(typeof data.code === "string" ? data.code : "unavailable");
  return data;
}

export async function getLeonarisMemory(clientId: string): Promise<LeonarisMemoryState> {
  if (!validLeonarisId(clientId)) throw new LeonarisMemoryError("invalid_client");
  const [state, profile] = await Promise.all([
    memoryOperation(clientId, "read"),
    supabaseAdmin().from("tc_client_leo_profiles").select("visit_counts,interest_scores,interaction_counts,last_path,last_seen_at").eq("client_id", clientId).maybeSingle(),
  ]);
  if (profile.error || state.status !== "ok" || typeof state.memoryEnabled !== "boolean" || !Array.isArray(state.memories) || !Array.isArray(state.history)) throw new LeonarisMemoryError("unavailable");
  return { displayName: state.displayName ?? null, memoryEnabled: state.memoryEnabled, style: state.style === "concise" ? "concise" : "warm", memories: state.memories, history: state.history, helpful: Number(state.helpful) || 0, unhelpful: Number(state.unhelpful) || 0, profile: profile.data };
}

export async function updateLeonarisPreferences(clientId: string, preferences: LeonarisPreferences): Promise<void> {
  const payload: Record<string, unknown> = {};
  if (preferences.memoryEnabled !== undefined) {
    if (typeof preferences.memoryEnabled !== "boolean") throw new LeonarisMemoryError("invalid_preferences");
    payload.memoryEnabled = preferences.memoryEnabled;
  }
  if (preferences.style !== undefined) {
    if (!["warm", "concise"].includes(preferences.style)) throw new LeonarisMemoryError("invalid_preferences");
    payload.style = preferences.style;
  }
  if (preferences.displayName !== undefined) {
    if (preferences.displayName !== null && (typeof preferences.displayName !== "string" || Array.from(preferences.displayName.trim()).length > 80)) throw new LeonarisMemoryError("invalid_preferences");
    payload.displayName = preferences.displayName?.trim() || null;
  }
  await memoryOperation(clientId, "preferences", payload);
}

export async function rememberLeonarisMemory(clientId: string, content: string): Promise<LeoMemory> {
  const normalized = normalizeLeonarisMemory(content);
  if (!normalized) throw new LeonarisMemoryError("invalid_memory");
  const result = await memoryOperation(clientId, "remember", { content: normalized });
  return result.memory;
}
export async function forgetLeonarisMemory(clientId: string, memoryId: string): Promise<void> {
  if (!validLeonarisId(memoryId)) throw new LeonarisMemoryError("invalid_memory");
  await memoryOperation(clientId, "forget", { memoryId });
}
export async function resetLeonarisMemory(clientId: string): Promise<void> { await memoryOperation(clientId, "reset"); }

export async function claimLeonarisChat(clientId: string, requestId: string, question: string): Promise<LeonarisChatClaim> {
  if (!validLeonarisId(requestId) || typeof question !== "string" || !question.trim() || Array.from(question).length > 2000) throw new LeonarisMemoryError("invalid_request");
  const result = await memoryOperation(clientId, "claim", { requestId, question: question.trim() });
  if (result.status === "completed" && result.answer !== null && !validLeonarisAnswer(result.answer)) throw new LeonarisMemoryError("unavailable");
  if (!["claimed", "completed", "in_progress", "rate_limited"].includes(result.status)) throw new LeonarisMemoryError("unavailable");
  return result as LeonarisChatClaim;
}
export async function completeLeonarisChat(clientId: string, requestId: string, claimToken: string, answer: LeoCompanionAnswer): Promise<void> {
  if (!validLeonarisId(requestId) || !validLeonarisId(claimToken) || !validLeonarisAnswer(answer) || answer.id !== requestId) throw new LeonarisMemoryError("invalid_answer");
  await memoryOperation(clientId, "complete", { requestId, claimToken, answer });
}
export async function failLeonarisChat(clientId: string, requestId: string, claimToken: string): Promise<void> {
  if (!validLeonarisId(requestId) || !validLeonarisId(claimToken)) throw new LeonarisMemoryError("invalid_request");
  await memoryOperation(clientId, "fail", { requestId, claimToken });
}
export async function recordLeonarisFeedback(clientId: string, answerId: string, helpful: boolean): Promise<void> {
  if (!validLeonarisId(answerId) || typeof helpful !== "boolean") throw new LeonarisMemoryError("invalid_feedback");
  await memoryOperation(clientId, "feedback", { requestId: answerId, helpful });
}

export async function recordLeonarisSignal(clientId: string, input: { signal: "visit" | "interaction"; context: string; pathname: string }): Promise<{ recorded: boolean }> {
  const section = LEO_SECTIONS.find(candidate => candidate.key === input.context);
  const pathname = typeof input.pathname === "string" ? input.pathname.split(/[?#]/)[0] : "";
  if (!section || section.path !== pathname || !["visit", "interaction"].includes(input.signal)) throw new LeonarisMemoryError("invalid_signal");
  const result = await memoryOperation(clientId, "signal", { signal: input.signal, context: section.key, pathname: section.path });
  return { recorded: result.recorded === true };
}
