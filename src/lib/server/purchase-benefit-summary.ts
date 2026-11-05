import { summarizePurchaseBenefits, type BenefitPayment, type PurchaseBenefitSummary } from "@/lib/purchase-benefit-summary";

export const BENEFIT_PAYMENT_COLUMNS = "id,source_rendimiento_id,benefits_context,benefits_processed_at";

// Bounded pages avoid silently turning PostgREST's row limit into a zero award.
async function readRows(query: (from: number, to: number) => any): Promise<any[] | null> {
  const rows: any[] = [];
  try {
    for (let from = 0; ; from += 500) {
      const result = await query(from, from + 499);
      if (result.error) return null;
      rows.push(...(result.data || []));
      if ((result.data || []).length < 500) return rows;
    }
  } catch { return null; }
}

export async function loadPurchaseBenefitSummaries(admin: any, clienteId: string, payments: BenefitPayment[]): Promise<Map<string, PurchaseBenefitSummary>> {
  const summaries = new Map<string, PurchaseBenefitSummary>();
  const unique = [...new Map(payments.map((payment) => [payment.id, payment])).values()];
  for (let offset = 0; offset < unique.length; offset += 100) {
    const batch = unique.slice(offset, offset + 100);
    const ids = batch.map((payment) => payment.id);
    const [ledger, events, spins] = await Promise.all([
      readRows((from, to) => admin.from("cliente_puntos_historial")
        .select("id,tipo,puntos,saldo_despues,meta,created_at").eq("cliente_id", clienteId)
        .in("meta->>payment_id", ids).order("id").range(from, to)),
      readRows((from, to) => admin.from("tc_client_benefit_events")
        .select("id,payment_id,benefit_key,coins,oracle_credits,snapshot").eq("cliente_id", clienteId)
        .in("payment_id", ids).order("id").range(from, to)),
      readRows((from, to) => admin.from("cliente_ruleta_giros")
        .select("id,purchase_id,nivel,estado").eq("cliente_id", clienteId)
        .in("purchase_id", ids).order("id").range(from, to)),
    ]);
    for (const payment of batch) summaries.set(payment.id, summarizePurchaseBenefits(payment, {
      ledger: ledger?.filter((row) => row.meta?.payment_id === payment.id) ?? null,
      events: events?.filter((row) => row.payment_id === payment.id) ?? null,
      spins: spins?.filter((row) => row.purchase_id === payment.id) ?? null,
    }));
  }
  return summaries;
}

export async function enrichPurchaseNotes(admin: any, clienteId: string, notes: any[]): Promise<any[]> {
  const purchaseNotes = notes.filter((note) => ["purchase_registered", "client_paypal_purchase"].includes(note.event_type));
  const ids = [...new Set<string>(purchaseNotes.map((note) => String(note.event_data?.payment_id || "")))]
    .filter((id) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id));
  if (!ids.length) return notes;
  const summaries = new Map<string, PurchaseBenefitSummary>();
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const payments = await readRows((from, to) => admin.from("crm_cliente_pagos")
      .select(BENEFIT_PAYMENT_COLUMNS).eq("cliente_id", clienteId).in("id", batch).order("id").range(from, to));
    if (!payments) continue;
    const result = await loadPurchaseBenefitSummaries(admin, clienteId, payments);
    for (const [id, summary] of result) summaries.set(id, summary);
  }
  return notes.map((note) => {
    if (!["purchase_registered", "client_paypal_purchase"].includes(note.event_type) || !ids.includes(note.event_data?.payment_id)) return note;
    const summary = summaries.get(note.event_data.payment_id) || summarizePurchaseBenefits({ id: note.event_data.payment_id }, { ledger: null, events: null, spins: null });
    return { ...note, purchase_benefits_summary: summary };
  });
}
