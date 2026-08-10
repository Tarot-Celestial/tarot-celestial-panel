export const ORACLE_QUESTION_PACK = {
  id: "oracle_questions_3",
  nombre: "Preguntas al Oráculo",
  descripcion: "3 preguntas adicionales para continuar tus lecturas.",
  priceEur: 2,
  questions: 3,
} as const;

export function getOracleQuestionPack(value: unknown) {
  return String(value || "").trim() === ORACLE_QUESTION_PACK.id ? ORACLE_QUESTION_PACK : null;
}

export async function getOracleQuestionBalance(admin: any, clienteId: string): Promise<number> {
  const { data, error } = await admin.rpc("get_cliente_oracle_question_balance", { p_cliente_id: clienteId });
  if (error) {
    if (error.code === "42883" || /does not exist/i.test(String(error.message || ""))) return 0;
    throw error;
  }
  return Math.max(0, Number(data || 0));
}

export async function grantOracleQuestions(admin: any, params: { clienteId: string; questions: number; reference: string; notes: string; meta?: Record<string, unknown> }) {
  const { data, error } = await admin.rpc("grant_cliente_oracle_questions", {
    p_cliente_id: params.clienteId, p_amount: params.questions, p_reference: params.reference,
    p_notes: params.notes, p_meta: params.meta || {},
  });
  if (error) throw error;
  return Number(data || 0);
}

export async function consumeOracleQuestion(admin: any, params: { clienteId: string; drawId: string }) {
  const { data, error } = await admin.rpc("consume_cliente_oracle_question", { p_cliente_id: params.clienteId, p_draw_id: params.drawId });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  return { source: String(row?.source || ""), extraBalance: Math.max(0, Number(row?.extra_balance || 0)) };
}
