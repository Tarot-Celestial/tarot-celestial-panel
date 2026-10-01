import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import {
  addCurrencyTotal,
  cleanFinanceCurrency,
  cleanFinanceDate,
  matchesFinanceFilters,
  periodIso,
  previousEquivalentPeriod,
  roundFinanceMoney,
  type FinanceCurrencyTotals,
} from "@/lib/server/finance-center";
import { madridTodayKey } from "@/lib/server/madrid-reporting-period";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

const ENTRY_SELECT = "id,kind,concept,amount,month_key,note,created_at,entry_date,movement,business,origin,destination,payment_method,movement_type,operation_mode,entry_type,currency,status,due_date,due_month,reference,counterparty,gross_amount,fee_amount,net_amount,settled_amount,source_system,source_id,is_transfer,document_path,archived_at,created_by,updated_by,updated_at,idempotency_key";
const RECEIVABLE_SELECT = "id,kind,business,concept,description,category,payment_method,provider,counterparty,currency,original_amount,gross_amount,fee_amount,net_amount,settled_amount,status,operation_date,expected_date,expected_month,source_payment_id,source_entry_id,reference,note,created_at,updated_at,created_by,updated_by,archived_at";

function normalizeEntryType(row: any): "income" | "expense" | "transfer" {
  const explicit = String(row?.entry_type || "").toLowerCase();
  if (["income", "expense", "transfer"].includes(explicit)) return explicit as any;
  const movement = String(row?.movement || "").toLowerCase();
  if (movement.includes("traspas") || row?.is_transfer) return "transfer";
  const kind = String(row?.kind || "").toLowerCase();
  if (["ingreso", "ingresos", "income", "bizum", "paypal", "square"].includes(kind)) return "income";
  return "expense";
}

function manualRow(row: any) {
  const entryType = normalizeEntryType(row);
  const amount = roundFinanceMoney(row.amount);
  const status = String(row.status || "settled").toLowerCase();
  const settledAmount = row.settled_amount == null
    ? (status === "settled" ? amount : 0)
    : roundFinanceMoney(row.settled_amount);
  return {
    id: `manual:${row.id}`,
    source_id: String(row.id),
    source_system: String(row.source_system || "manual"),
    entry_type: entryType,
    operation_date: row.entry_date || String(row.created_at || "").slice(0, 10),
    created_at: row.created_at,
    concept: row.concept || row.movement_type || "Movimiento manual",
    description: row.note || "",
    category: row.movement_type || row.concept || "Otros",
    amount,
    gross_amount: roundFinanceMoney(row.gross_amount ?? amount),
    fee_amount: roundFinanceMoney(row.fee_amount || 0),
    net_amount: roundFinanceMoney(row.net_amount ?? amount),
    currency: cleanFinanceCurrency(row.currency),
    business: row.business || "Celestial",
    payment_method: row.payment_method || "Sin especificar",
    provider: row.payment_method || "Sin especificar",
    status,
    settled_amount: settledAmount,
    due_date: row.due_date || null,
    due_month: row.due_month || null,
    reference: row.reference || null,
    counterparty: row.counterparty || null,
    note: row.note || null,
    origin: row.origin || null,
    destination: row.destination || null,
    document_path: row.document_path || null,
    archived_at: row.archived_at || null,
    read_only: false,
  };
}

function receivableRow(row: any) {
  const original = roundFinanceMoney(row.original_amount);
  const settled = roundFinanceMoney(row.settled_amount);
  return {
    ...row,
    original_amount: original,
    settled_amount: settled,
    outstanding_amount: roundFinanceMoney(Math.max(0, original - settled)),
    currency: cleanFinanceCurrency(row.currency),
  };
}

function buildPeriodTotals(official: any[], manual: any[]) {
  const income: FinanceCurrencyTotals = {};
  const expense: FinanceCurrencyTotals = {};
  const confirmedCollections: FinanceCurrencyTotals = {};
  const manualCashReceived: FinanceCurrencyTotals = {};
  const manualCashPaid: FinanceCurrencyTotals = {};

  for (const row of official) {
    addCurrencyTotal(income, row.currency, row.amount);
    addCurrencyTotal(confirmedCollections, row.currency, row.amount);
  }
  for (const row of manual) {
    if (row.archived_at || ["cancelled", "refunded"].includes(String(row.status))) continue;
    if (row.entry_type === "income") {
      addCurrencyTotal(income, row.currency, row.amount);
      addCurrencyTotal(manualCashReceived, row.currency, Math.min(Number(row.settled_amount || 0), Number(row.amount || 0)));
    } else if (row.entry_type === "expense") {
      addCurrencyTotal(expense, row.currency, row.amount);
      addCurrencyTotal(manualCashPaid, row.currency, Math.min(Number(row.settled_amount || 0), Number(row.amount || 0)));
    }
  }
  const result: FinanceCurrencyTotals = { ...income };
  for (const [currency, amount] of Object.entries(expense)) addCurrencyTotal(result, currency, -amount);
  return { income, expense, result, confirmedCollections, manualCashReceived, manualCashPaid };
}

function readFilter(url: URL, key: string) {
  return String(url.searchParams.get(key) || "all").trim() || "all";
}

async function audit(admin: any, actor: any, entityType: string, entityId: string, action: string, before: any, after: any) {
  const { error } = await admin.from("accounting_audit_log").insert({
    entity_type: entityType,
    entity_id: entityId,
    action,
    before_data: before || null,
    after_data: after || null,
    actor_worker_id: String(actor?.id || "") || null,
    actor_user_id: String(actor?.user_id || "") || null,
  });
  if (error) console.error("[finance/audit]", error);
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
    const url = new URL(req.url);
    const today = madridTodayKey();
    const defaultFrom = `${today.slice(0, 7)}-01`;
    const from = cleanFinanceDate(url.searchParams.get("from"), defaultFrom);
    const to = cleanFinanceDate(url.searchParams.get("to"), today);
    if (from > to) return NextResponse.json({ ok: false, error: "INVALID_PERIOD" }, { status: 400 });
    const filters = {
      business: readFilter(url, "business"),
      category: readFilter(url, "category"),
      method: readFilter(url, "method"),
      status: readFilter(url, "status"),
      currency: readFilter(url, "currency"),
    };
    const previous = previousEquivalentPeriod(from, to);
    const currentRange = periodIso(from, to);
    const previousRange = periodIso(previous.from, previous.to);

    const [manualCurrentRes, manualPreviousRes, receivablesRes, settlementsRes] = await Promise.all([
      gate.admin.from("accounting_entries").select(ENTRY_SELECT).gte("entry_date", from).lte("entry_date", to).is("archived_at", null).order("entry_date", { ascending: false }),
      gate.admin.from("accounting_entries").select(ENTRY_SELECT).gte("entry_date", previous.from).lte("entry_date", previous.to).is("archived_at", null).order("entry_date", { ascending: false }),
      gate.admin.from("accounting_receivables").select(RECEIVABLE_SELECT).is("archived_at", null).order("created_at", { ascending: false }),
      gate.admin.from("accounting_settlements").select("id,receivable_id,amount,currency,settled_on,destination_account,note,created_at").order("settled_on", { ascending: false }).limit(5000),
    ]);
    for (const result of [manualCurrentRes, manualPreviousRes, receivablesRes, settlementsRes]) if (result.error) throw result.error;

    // Este centro económico es deliberadamente independiente: solo consume sus propias
    // tablas financieras (accounting_*). No lee Diario, CRM, pagos web ni otras fuentes.
    const manualCurrent = (manualCurrentRes.data || []).map(manualRow);
    const manualPrevious = (manualPreviousRes.data || []).map(manualRow);
    const allCurrentRows = manualCurrent.filter((row) => matchesFinanceFilters(row, filters));
    const currentManualFiltered = manualCurrent.filter((row) => matchesFinanceFilters(row, filters));
    const previousManualFiltered = manualPrevious.filter((row) => matchesFinanceFilters(row, filters));

    const currentTotals = buildPeriodTotals([], currentManualFiltered);
    const previousTotals = buildPeriodTotals([], previousManualFiltered);

    const receivables = (receivablesRes.data || []).map(receivableRow).filter((row) => {
      if (filters.business !== "all" && String(row.business || "").toLowerCase() !== filters.business.toLowerCase()) return false;
      if (filters.category !== "all" && String(row.category || "").toLowerCase() !== filters.category.toLowerCase()) return false;
      if (filters.method !== "all" && String(row.payment_method || row.provider || "").toLowerCase() !== filters.method.toLowerCase()) return false;
      if (filters.currency !== "all" && String(row.currency || "").toLowerCase() !== filters.currency.toLowerCase()) return false;
      if (filters.status !== "all" && String(row.status || "").toLowerCase() !== filters.status.toLowerCase()) return false;
      return true;
    });

    const retained: FinanceCurrencyTotals = {};
    const pendingCollections: FinanceCurrencyTotals = {};
    const pendingExpenses: FinanceCurrencyTotals = {};
    for (const item of receivables) {
      if (["settled", "cancelled"].includes(String(item.status))) continue;
      if (item.kind === "platform_hold") addCurrencyTotal(retained, item.currency, item.outstanding_amount);
      if (item.kind === "client_receivable") addCurrencyTotal(pendingCollections, item.currency, item.outstanding_amount);
      if (item.kind === "payable") addCurrencyTotal(pendingExpenses, item.currency, item.outstanding_amount);
    }

    const settlements = settlementsRes.data || [];
    const receivableById = new Map(receivables.map((item) => [String(item.id), item]));
    const registeredReceipts: FinanceCurrencyTotals = {};
    const registeredPayments: FinanceCurrencyTotals = {};
    for (const settlement of settlements) {
      if (String(settlement.settled_on || "") < from || String(settlement.settled_on || "") > to) continue;
      const parent = receivableById.get(String(settlement.receivable_id));
      if (!parent) continue;
      if (parent.kind === "payable") addCurrencyTotal(registeredPayments, settlement.currency, settlement.amount);
      else addCurrencyTotal(registeredReceipts, settlement.currency, settlement.amount);
    }
    for (const [currency, amount] of Object.entries(currentTotals.manualCashReceived)) addCurrencyTotal(registeredReceipts, currency, amount);
    for (const [currency, amount] of Object.entries(currentTotals.manualCashPaid)) addCurrencyTotal(registeredPayments, currency, amount);

    const unique = (values: unknown[]) => Array.from(new Set(values.map((value) => String(value || "").trim()).filter(Boolean))).sort((a, b) => a.localeCompare(b, "es"));
    const response = NextResponse.json({
      ok: true,
      period: { from, to, previous_from: previous.from, previous_to: previous.to, current_start_iso: currentRange.start, current_end_exclusive_iso: currentRange.endExclusive, previous_start_iso: previousRange.start, previous_end_exclusive_iso: previousRange.endExclusive },
      totals: { ...currentTotals, retained, pendingCollections, pendingExpenses, registeredReceipts, registeredPayments },
      previous_totals: previousTotals,
      movements: allCurrentRows.sort((a, b) => String(b.operation_date || "").localeCompare(String(a.operation_date || ""))),
      receivables,
      settlements,
      filter_options: {
        businesses: unique([...allCurrentRows.map((row) => row.business), ...receivables.map((row) => row.business)]),
        categories: unique([...allCurrentRows.map((row) => row.category), ...receivables.map((row) => row.category)]),
        methods: unique([...allCurrentRows.map((row) => row.payment_method), ...receivables.map((row) => row.payment_method || row.provider)]),
        statuses: unique([...allCurrentRows.map((row) => row.status), ...receivables.map((row) => row.status)]),
        currencies: unique([...allCurrentRows.map((row) => row.currency), ...receivables.map((row) => row.currency)]),
      },
      notes: {
        source_of_truth: "Centro económico independiente: solo utiliza accounting_entries, accounting_receivables y accounting_settlements.",
        availability: "El saldo bancario disponible no se calcula sin conciliación. Las recepciones y retenciones se muestran por separado.",
      },
    });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error: any) {
    console.error("[admin/finance GET]", error);
    return NextResponse.json({ ok: false, error: error?.message || "FINANCE_LOAD_ERROR" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "movement");

    if (action === "receivable") {
      const kind = String(body.kind || "").trim();
      if (!["platform_hold", "client_receivable", "payable"].includes(kind)) throw new Error("INVALID_RECEIVABLE_KIND");
      const amount = roundFinanceMoney(body.original_amount);
      if (!(amount > 0)) throw new Error("AMOUNT_REQUIRED");
      const currency = cleanFinanceCurrency(body.currency);
      const expectedDate = /^\d{4}-\d{2}-\d{2}$/.test(String(body.expected_date || "")) ? String(body.expected_date) : null;
      const expectedMonth = /^\d{4}-\d{2}$/.test(String(body.expected_month || "")) ? String(body.expected_month) : null;
      const idempotencyKey = String(body.idempotency_key || "").trim() || null;
      const sourcePaymentId = null; // apartado independiente: no se vincula con pagos del Diario/CRM
      const feeAmount = Math.max(0, roundFinanceMoney(body.fee_amount || 0));
      const grossAmount = body.gross_amount === undefined || body.gross_amount === null || body.gross_amount === "" ? null : Math.max(0, roundFinanceMoney(body.gross_amount));
      const netAmount = body.net_amount === undefined || body.net_amount === null || body.net_amount === "" ? null : Math.max(0, roundFinanceMoney(body.net_amount));
      const payload = {
        kind,
        business: String(body.business || "Celestial").trim() || "Celestial",
        concept: String(body.concept || "").trim() || (kind === "platform_hold" ? "Fondos retenidos" : kind === "payable" ? "Gasto pendiente" : "Cobro pendiente"),
        description: String(body.description || "").trim() || null,
        category: String(body.category || "Otros").trim() || "Otros",
        payment_method: String(body.payment_method || "").trim() || null,
        provider: String(body.provider || body.payment_method || "").trim() || null,
        counterparty: String(body.counterparty || "").trim() || null,
        currency,
        original_amount: amount,
        gross_amount: grossAmount,
        fee_amount: feeAmount,
        net_amount: netAmount,
        settled_amount: 0,
        status: "pending",
        operation_date: cleanFinanceDate(body.operation_date, madridTodayKey()),
        expected_date: expectedDate,
        expected_month: expectedDate ? expectedDate.slice(0, 7) : expectedMonth,
        source_payment_id: sourcePaymentId,
        source_entry_id: String(body.source_entry_id || "").trim() || null,
        reference: String(body.reference || "").trim() || null,
        note: String(body.note || "").trim() || null,
        created_by: String(gate.me.id || "") || null,
        updated_by: String(gate.me.id || "") || null,
        idempotency_key: idempotencyKey,
      };
      const { data, error } = await gate.admin.from("accounting_receivables").insert(payload).select(RECEIVABLE_SELECT).single();
      if (error) {
        if (String(error.code) === "23505" && idempotencyKey) return NextResponse.json({ ok: true, duplicated: true });
        throw error;
      }
      await audit(gate.admin, gate.me, "receivable", String(data.id), "create", null, data);
      return NextResponse.json({ ok: true, receivable: receivableRow(data) });
    }

    const entryType = String(body.entry_type || "").trim().toLowerCase();
    if (!["income", "expense", "transfer"].includes(entryType)) throw new Error("INVALID_ENTRY_TYPE");
    const amount = roundFinanceMoney(body.amount);
    if (!(amount > 0)) throw new Error("AMOUNT_REQUIRED");
    const status = String(body.status || "settled").trim().toLowerCase();
    if (!["settled", "pending", "partial", "cancelled", "refunded"].includes(status)) throw new Error("INVALID_STATUS");
    const settledAmount = status === "settled" ? amount : Math.min(amount, Math.max(0, roundFinanceMoney(body.settled_amount || 0)));
    const date = cleanFinanceDate(body.entry_date, madridTodayKey());
    const idempotencyKey = String(body.idempotency_key || "").trim() || null;
    const concept = String(body.category || body.concept || "Otros").trim() || "Otros";
    const reference = String(body.reference || "").trim() || null;
    if (reference) {
      const { data: manualDuplicate, error: manualDuplicateError } = await gate.admin
        .from("accounting_entries")
        .select("id")
        .eq("reference", reference)
        .is("archived_at", null)
        .limit(1)
        .maybeSingle();
      if (manualDuplicateError) throw manualDuplicateError;
      if (manualDuplicate) return NextResponse.json({ ok: false, error: "REFERENCE_ALREADY_REGISTERED" }, { status: 409 });
    }
    const payload = {
      month_key: date.slice(0, 7),
      // Mantener kind compatible con la contabilidad histórica; entry_type/is_transfer deciden la semántica real.
      kind: entryType === "income" ? "ingresos" : "gastos",
      concept,
      amount,
      amount_eur: amount,
      note: String(body.description || body.note || "").trim() || null,
      entry_date: date,
      movement: entryType === "income" ? "Ingreso" : entryType === "expense" ? "Gasto" : "Traspaso",
      business: String(body.business || "Celestial").trim() || "Celestial",
      origin: String(body.origin || "").trim() || null,
      destination: String(body.destination || "").trim() || null,
      payment_method: String(body.payment_method || "").trim() || null,
      movement_type: concept,
      operation_mode: "finance_center",
      entry_type: entryType,
      currency: cleanFinanceCurrency(body.currency),
      status,
      due_date: /^\d{4}-\d{2}-\d{2}$/.test(String(body.due_date || "")) ? String(body.due_date) : null,
      due_month: /^\d{4}-\d{2}$/.test(String(body.due_month || "")) ? String(body.due_month) : null,
      reference,
      counterparty: String(body.counterparty || "").trim() || null,
      gross_amount: roundFinanceMoney(body.gross_amount ?? amount),
      fee_amount: roundFinanceMoney(body.fee_amount || 0),
      net_amount: roundFinanceMoney(body.net_amount ?? (amount - Number(body.fee_amount || 0))),
      settled_amount: settledAmount,
      source_system: "manual",
      source_id: null,
      is_transfer: entryType === "transfer",
      document_path: String(body.document_path || "").trim() || null,
      created_by: String(gate.me.id || "") || null,
      updated_by: String(gate.me.id || "") || null,
      idempotency_key: idempotencyKey,
    };
    const { data, error } = await gate.admin.from("accounting_entries").insert(payload).select(ENTRY_SELECT).single();
    if (error) {
      if (String(error.code) === "23505" && idempotencyKey) return NextResponse.json({ ok: true, duplicated: true });
      throw error;
    }
    await audit(gate.admin, gate.me, "movement", String(data.id), "create", null, data);
    return NextResponse.json({ ok: true, movement: manualRow(data) });
  } catch (error: any) {
    const message = String(error?.message || "FINANCE_CREATE_ERROR");
    const status = ["INVALID_RECEIVABLE_KIND", "AMOUNT_REQUIRED", "INVALID_ENTRY_TYPE", "INVALID_STATUS"].includes(message) ? 400 : message === "SOURCE_PAYMENT_NOT_FOUND" ? 404 : ["SOURCE_PAYMENT_ALREADY_LINKED"].includes(message) ? 409 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}

export async function PATCH(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
    const body = await req.json().catch(() => ({}));
    const entity = String(body.entity || "movement");
    const id = String(body.id || "").trim();
    if (!id) return NextResponse.json({ ok: false, error: "ID_REQUIRED" }, { status: 400 });

    if (entity === "receivable") {
      const { data: before, error: beforeError } = await gate.admin.from("accounting_receivables").select(RECEIVABLE_SELECT).eq("id", id).maybeSingle();
      if (beforeError) throw beforeError;
      if (!before) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
      const update: any = { updated_at: new Date().toISOString(), updated_by: String(gate.me.id || "") || null };
      for (const key of ["business", "concept", "description", "category", "payment_method", "provider", "counterparty", "reference", "note"] as const) {
        if (body[key] !== undefined) update[key] = String(body[key] || "").trim() || null;
      }
      if (body.expected_date !== undefined) update.expected_date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.expected_date || "")) ? String(body.expected_date) : null;
      if (body.expected_month !== undefined) update.expected_month = /^\d{4}-\d{2}$/.test(String(body.expected_month || "")) ? String(body.expected_month) : null;
      if (body.operation_date !== undefined) update.operation_date = cleanFinanceDate(body.operation_date, String(before.operation_date || madridTodayKey()));
      if (body.currency !== undefined) update.currency = cleanFinanceCurrency(body.currency);
      if (body.original_amount !== undefined) {
        const originalAmount = roundFinanceMoney(body.original_amount);
        if (!(originalAmount > 0)) throw new Error("AMOUNT_REQUIRED");
        if (originalAmount + 0.0001 < Number(before.settled_amount || 0)) throw new Error("AMOUNT_BELOW_SETTLED");
        update.original_amount = originalAmount;
        update.status = Number(before.settled_amount || 0) >= originalAmount ? "settled" : Number(before.settled_amount || 0) > 0 ? "partial" : "pending";
      }
      if (body.gross_amount !== undefined) update.gross_amount = body.gross_amount === null || body.gross_amount === "" ? null : Math.max(0, roundFinanceMoney(body.gross_amount));
      if (body.fee_amount !== undefined) update.fee_amount = body.fee_amount === null || body.fee_amount === "" ? 0 : Math.max(0, roundFinanceMoney(body.fee_amount));
      if (body.net_amount !== undefined) update.net_amount = body.net_amount === null || body.net_amount === "" ? null : Math.max(0, roundFinanceMoney(body.net_amount));
      if (body.archive === true) update.archived_at = new Date().toISOString();
      if (body.status && ["pending", "partial", "settled", "cancelled"].includes(String(body.status))) update.status = String(body.status);
      const { data, error } = await gate.admin.from("accounting_receivables").update(update).eq("id", id).select(RECEIVABLE_SELECT).single();
      if (error) throw error;
      await audit(gate.admin, gate.me, "receivable", id, body.archive ? "archive" : "update", before, data);
      return NextResponse.json({ ok: true, receivable: receivableRow(data) });
    }

    const { data: before, error: beforeError } = await gate.admin.from("accounting_entries").select(ENTRY_SELECT).eq("id", id).maybeSingle();
    if (beforeError) throw beforeError;
    if (!before) return NextResponse.json({ ok: false, error: "NOT_FOUND" }, { status: 404 });
    if (!["manual", "legacy_manual"].includes(String(before.source_system || "manual"))) return NextResponse.json({ ok: false, error: "READ_ONLY_SOURCE" }, { status: 409 });
    const update: any = { updated_at: new Date().toISOString(), updated_by: String(gate.me.id || "") || null };
    if (body.archive === true) update.archived_at = new Date().toISOString();
    const requestedStatus = body.status && ["settled", "pending", "partial", "cancelled", "refunded"].includes(String(body.status)) ? String(body.status) : null;
    if (requestedStatus) update.status = requestedStatus;
    for (const key of ["business", "origin", "destination", "payment_method", "reference", "counterparty", "note", "document_path"] as const) {
      if (body[key] !== undefined) update[key] = String(body[key] || "").trim() || null;
    }
    if (body.category !== undefined) { update.concept = String(body.category || "Otros").trim() || "Otros"; update.movement_type = update.concept; }
    const nextAmount = body.amount !== undefined ? roundFinanceMoney(body.amount) : roundFinanceMoney(before.amount);
    if (!(nextAmount > 0)) throw new Error("AMOUNT_REQUIRED");
    if (body.amount !== undefined) {
      update.amount = nextAmount;
      update.amount_eur = nextAmount;
    }
    if (body.entry_date !== undefined) { const date = cleanFinanceDate(body.entry_date, String(before.entry_date || madridTodayKey())); update.entry_date = date; update.month_key = date.slice(0, 7); }
    if (body.currency !== undefined) update.currency = cleanFinanceCurrency(body.currency);
    if (body.due_date !== undefined) update.due_date = /^\d{4}-\d{2}-\d{2}$/.test(String(body.due_date || "")) ? String(body.due_date) : null;
    if (body.due_month !== undefined) update.due_month = /^\d{4}-\d{2}$/.test(String(body.due_month || "")) ? String(body.due_month) : null;
    if (body.gross_amount !== undefined) update.gross_amount = body.gross_amount === null || body.gross_amount === "" ? nextAmount : Math.max(0, roundFinanceMoney(body.gross_amount));
    if (body.fee_amount !== undefined) update.fee_amount = body.fee_amount === null || body.fee_amount === "" ? 0 : Math.max(0, roundFinanceMoney(body.fee_amount));
    if (body.net_amount !== undefined) update.net_amount = body.net_amount === null || body.net_amount === "" ? nextAmount : Math.max(0, roundFinanceMoney(body.net_amount));
    let nextSettled = body.settled_amount !== undefined ? Math.max(0, roundFinanceMoney(body.settled_amount)) : roundFinanceMoney(before.settled_amount || 0);
    if (requestedStatus === "settled") nextSettled = nextAmount;
    if (requestedStatus === "pending") nextSettled = 0;
    if (nextSettled > nextAmount + 0.005) throw new Error("SETTLED_EXCEEDS_AMOUNT");
    update.settled_amount = nextSettled;
    if (!requestedStatus && nextSettled > 0 && nextSettled < nextAmount) update.status = "partial";
    const { data, error } = await gate.admin.from("accounting_entries").update(update).eq("id", id).select(ENTRY_SELECT).single();
    if (error) throw error;
    await audit(gate.admin, gate.me, "movement", id, body.archive ? "archive" : "update", before, data);
    return NextResponse.json({ ok: true, movement: manualRow(data) });
  } catch (error: any) {
    const message = String(error?.message || "FINANCE_UPDATE_ERROR");
    const status = ["AMOUNT_REQUIRED"].includes(message) ? 400 : ["AMOUNT_BELOW_SETTLED", "SETTLED_EXCEEDS_AMOUNT"].includes(message) ? 409 : 500;
    return NextResponse.json({ ok: false, error: message }, { status });
  }
}
