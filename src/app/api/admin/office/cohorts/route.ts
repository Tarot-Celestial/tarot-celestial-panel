import { officeAccess, officeDatabaseError, officeError, officeJson } from "@/lib/server/office-access";
import type { OfficeCohortCurrency, OfficeCohortMoney, OfficeCohortOrigin, OfficeCohortReport } from "@/features/office/office-cohorts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const originKeys = new Set<OfficeCohortOrigin>(["meta_lead","web_registration","referral","instagram","facebook","whatsapp","manual","other_recorded","unknown"]);
function checkCount(v: unknown): number {
  if (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0) throw new Error("Invalid count");
  return v;
}
function checkAmount(v: unknown): number | null {
  if (v === null) return null;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) throw new Error("Invalid amount");
  return v;
}
function money(raw: OfficeCohortMoney): OfficeCohortMoney {
  return { purchases:checkCount(raw.purchases), gross:checkAmount(raw.gross), confirmed:checkAmount(raw.confirmed),
    refund_flagged:checkAmount(raw.refund_flagged), refund_unknown_count:checkCount(raw.refund_unknown_count), unresolved_count:checkCount(raw.unresolved_count) };
}
function currencyRows(raw: OfficeCohortCurrency[]): OfficeCohortCurrency[] {
  if (!Array.isArray(raw)) throw new Error("Invalid currencies");
  return raw.map(row => {
    if (row.currency !== null && (typeof row.currency !== "string" || !/^[A-Z]{3}$/.test(row.currency))) throw new Error("Invalid currency");
    return { currency:row.currency, first:money(row.first), month_to_date:money(row.month_to_date), lifetime_to_cutoff:money(row.lifetime_to_cutoff) };
  });
}
function readReport(row: OfficeCohortReport, month: string): OfficeCohortReport {
  if (row?.month!==month || row.zone!=="Europe/Madrid" || typeof row.as_of!=="string" || !Number.isFinite(Date.parse(row.as_of)) || !Array.isArray(row.origins)) throw new Error("Invalid report");
  const captured = checkCount(row.captured_clients);
  const origins = row.origins.map(o => {
    if (!originKeys.has(o.origin) || !["historical","current_only","unknown"].includes(o.basis)) throw new Error("Invalid origin");
    return { origin:o.origin,basis:o.basis,captured_clients:checkCount(o.captured_clients),amounts:currencyRows(o.amounts) };
  });
  const totals = currencyRows(row.totals);
  if (origins.reduce((n,o)=>n+o.captured_clients,0)!==captured || totals.reduce((n,t)=>n+t.first.purchases,0)!==captured) throw new Error("Invalid reconciliation");
  return {month,zone:row.zone,as_of:row.as_of,captured_clients:captured,origins,totals};
}

export async function GET(req: Request) {
  try {
    const gate = await officeAccess(req);
    if (!gate.ok) return gate.response;
    const now = new Date();
    const parts = new Intl.DateTimeFormat("en-CA",{timeZone:"Europe/Madrid",year:"numeric",month:"2-digit"}).formatToParts(now);
    const current = parts.find(part=>part.type==="year")!.value + "-" + parts.find(part=>part.type==="month")!.value;
    const month = new URL(req.url).searchParams.get("month") ?? current;
    if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month) || month>current) return officeError("Selecciona un mes válido que ya haya comenzado.",400);
    const {data,error} = await gate.admin.rpc("office_crm_cohort_report",{p_month:month+"-01",p_as_of:now.toISOString()});
    if (error) return officeDatabaseError(error);
    return officeJson({ok:true,...readReport(data,month)});
  } catch {
    return officeError("No se pudo verificar el informe de cohortes del CRM.",503);
  }
}
