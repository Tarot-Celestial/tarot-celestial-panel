import { createHash } from "node:crypto";
import { officeAccess, officeDatabaseError, officeError, officeJson, officeUuid } from "@/lib/server/office-access";
import { dateInZone, parsePilotCsv, periodFor, readPilotSpend, validZone } from "@/lib/server/office-campaign-spend";
import { COUNTRY_OPTIONS } from "@/lib/countries";
import type { PilotBuyer, PilotCampaign, PilotFunnel, PilotFunnelRow, PilotMoney, PilotSpend, PilotTouch } from "@/features/office/office-campaign-pilot";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
const campaignKey = (v: unknown): v is string => typeof v === "string" && /^(?:form-)?\d{1,40}$/.test(v);
const validMonth = (m: string, now: Date) => /^\d{4}-(0[1-9]|1[0-2])$/.test(m) && m >= "2000-01" && m <= dateInZone(now, "Europe/Madrid").slice(0, 7);
const text = (v: unknown, n: number) => typeof v === "string" ? v.trim().slice(0, n) || null : null;
const invalid = () => {
  throw new Error("PILOT_INVALID");
};
const money = (v: unknown): number | null => v === null ? null : typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : invalid();
const count = (v: unknown): number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? v : invalid();
const word = (v: unknown): string => typeof v === "string" && /^[a-z][a-z0-9_]{0,70}$/.test(v) ? v : invalid();
const date = (v: unknown): string => typeof v === "string" && /^\d{4}-\d\d-\d\dT/.test(v) && Number.isFinite(Date.parse(v)) ? v : invalid();
const curr = (v: unknown): string | null => v === null ? null : typeof v === "string" && /^[A-Z]{3}$/.test(v) ? v : invalid();
const id = (v: unknown): string => officeUuid(v) ? v : invalid();
// Only known countries leave the report. Free-text CRM values stay in the database.
const countryLabels: Record<string, string> = Object.create(null);
const englishCountries = new Intl.DisplayNames(["en"], {type: "region"});
const additionalNames: Record<string, string[]> = {US: ["USA", "EEUU", "EE. UU.", "EE UU"], DO: ["Dominicana"]};
for (const country of COUNTRY_OPTIONS) {
  for (const alias of [country.code, country.label, englishCountries.of(country.code), ...(country.aliases || []), ...(additionalNames[country.code] || [])]) {
    if (alias) {
      const key = alias.trim().toLowerCase();
      countryLabels[key] = country.label;
      countryLabels[key.normalize("NFD").replace(/[\u0300-\u036f]/g, "")] = country.label;
    }
  }
}
const knownCountries = new Set(Object.values(countryLabels));
const funnelCounts = ["contacts", "replied", "first_buyers", "buyers_after_reply", "phone_routed", "oracle_routed",
  "without_reply_or_purchase", "matured_contacts", "buyers_within_7d", "recorded_consultations"] as const;
function hydrateFunnelRow(raw: PilotFunnelRow): PilotFunnelRow {
  if (!raw || (raw.country !== null && !knownCountries.has(raw.country))) return invalid();
  const row = {country: raw.country, median_reply_minutes: money(raw.median_reply_minutes)} as PilotFunnelRow;
  for (const key of funnelCounts) row[key] = count(raw[key]);
  if (funnelCounts.some(k => row[k] > row.contacts) ||
    row.buyers_after_reply > Math.min(row.first_buyers, row.replied) ||
    row.buyers_within_7d > Math.min(row.first_buyers, row.matured_contacts) ||
    row.phone_routed > row.replied || row.oracle_routed > row.replied ||
    row.without_reply_or_purchase > row.contacts - Math.max(row.first_buyers,row.replied) ||
    (row.replied === 0) !== (row.median_reply_minutes === null)) return invalid();
  return row;
}
function hydrateFunnel(raw: PilotFunnel, contacts: number, buyers: number): PilotFunnel {
  if (!raw || !Array.isArray(raw.countries)) return invalid();
  const total = hydrateFunnelRow(raw.total), countries = raw.countries.map(hydrateFunnelRow);
  if (total.country !== null || total.contacts !== contacts || total.first_buyers !== buyers ||
    new Set(countries.map(r => r.country)).size !== countries.length ||
    funnelCounts.some(key => countries.reduce((sum, row) => sum + row[key], 0) !== total[key])) return invalid();
  return {total, countries};
}
function hydrateAmount(a: PilotMoney): PilotMoney {
  return {
    currency: curr(a.currency),
    receipts: count(a.receipts),
    first_count: count(a.first_count),
    first_gross: money(a.first_gross),
    gross: money(a.gross),
    confirmed: money(a.confirmed),
    refund_flagged: count(a.refund_flagged)
  };
}
function hydrateBuyer(b: PilotBuyer): PilotBuyer {
  const handling = b.handling === null ? null : b.handling.map((h: PilotTouch) => ({
    kind: h.kind === "whatsapp" || h.kind === "automated" || h.kind === "commercial" ? h.kind : invalid(),
    at: date(h.at),
    route: word(h.route),
    operator: text(h.operator, 100)
  }));
  return {
    client_id: id(b.client_id),
    lead_id: id(b.lead_id),
    contact_at: date(b.contact_at),
    channel: word(b.channel),
    purchase_at: date(b.purchase_at),
    source: word(b.source),
    amount: money(b.amount),
    currency: curr(b.currency),
    status: word(b.status),
    handling,
    call_operator: text(b.call_operator, 100)
  };
}
export async function GET(req: Request) {
  try {
    const gate = await officeAccess(req);
    if (!gate.ok) return gate.response;
    const query = new URL(req.url).searchParams,
      now = new Date(),
      month = query.get("month") ?? dateInZone(now, "Europe/Madrid").slice(0, 7);
    if (!validMonth(month, now)) return officeError("Selecciona un mes que ya haya comenzado.", 400);
    const selectedId = query.get("campaign");
    if (selectedId !== null && !campaignKey(selectedId)) return officeError("Selecciona una campaña válida.", 400);
    const catalog = await gate.admin.rpc("office_pilot_catalog", {
      p_actor: gate.authUserId,
      p_month: month + "-01"
    });
    if (catalog.error) return officeDatabaseError(catalog.error);
    if (!Array.isArray(catalog.data)) return invalid();
    const campaigns: PilotCampaign[] = catalog.data.map((c: {
      id: string;
      name: unknown;
    }) => ({
      id: campaignKey(c.id) ? c.id : invalid(),
      name: text(c.name, 140)
    }));
    const selected = (selectedId ? campaigns.find(c => c.id === selectedId) : campaigns[0]) ?? null;
    if (!selected && selectedId) return officeError("Esta campaña no tiene contactos comprobados para el mes seleccionado.", 404);
    const fallback = periodFor(month, "Europe/Madrid", now);
    if (!selected) {
      const global = await gate.admin.rpc("office_campaign_pilot", {
        p_actor: gate.authUserId,
        p_campaign: null,
        p_month: month + "-01",
        p_zone: "Europe/Madrid",
        p_as_of: now.toISOString()
      });
      if (global.error) return officeDatabaseError(global.error);
      return officeJson({
        ok: true,
        month,
        campaigns,
        selected: null,
        as_of: now.toISOString(),
        zone: "Europe/Madrid",
        unattributed_first_purchases: count(global.data?.unattributed_first_purchases),
        period_from: fallback.from,
        period_through: fallback.through,
        contacts: 0,
        first_buyers: 0,
        funnel: null,
        cost_first_buyers: 0,
        amounts: [],
        buyers: [],
        next_cursor: null,
        spend: null,
        spend_reason: null,
        cpa: null
      });
    }
    const key = selected.id;
    const [live, csv] = await Promise.all([readPilotSpend(key, month, now), gate.admin.from("office_campaign_cost_evidence").select("account_id,currency,account_zone,from_day,through_day,spend,file_sha256,recorded_at,workers(display_name)").eq("campaign_id", key).eq("from_day", month + "-01").order("through_day", {
      ascending: false
    }).limit(1).maybeSingle()]);
    if (csv.error) return officeDatabaseError(csv.error);
    let spend = live.spend,
      reason = live.reason;
    if (!spend && csv.data) {
      const c = csv.data;
      if (!validZone(c.account_zone) || c.from_day !== month + "-01" || !/^\d{4}-\d\d-\d\d$/.test(c.through_day) || c.through_day < c.from_day || c.through_day > periodFor(month, c.account_zone, now).through || !/^[a-f0-9]{64}$/.test(c.file_sha256)) return invalid();
      if (live.zone && live.zone !== c.account_zone || live.account && live.account !== c.account_id || live.currency && live.currency !== c.currency) reason = "conflicting_account";else {
        const importAmount = money(c.spend),
          currency = curr(c.currency);
        if (importAmount === null || !currency || !/^\d{1,40}$/.test(c.account_id)) return invalid();
        const relation: unknown = c.workers,
          worker = Array.isArray(relation) ? relation[0] : relation;
        spend = ({
          source: "ads_manager_csv",
          account_id: c.account_id,
          currency,
          zone: c.account_zone,
          from: c.from_day,
          through: c.through_day,
          checked_at: date(c.recorded_at),
          amount: importAmount,
          worker: text(worker && typeof worker === "object" && "display_name" in worker ? worker.display_name : null, 100),
          file_sha256: c.file_sha256
        } satisfies PilotSpend);
      }
    }
    const zone = spend?.zone || live.zone || "Europe/Madrid",
      period = periodFor(month, zone, now);
    const scope = createHash("sha256").update(JSON.stringify([gate.authUserId, key, month, zone, spend?.through ?? null])).digest("base64url").slice(0, 24);
    let snapshot = now.toISOString(),
      afterAt: string | null = null,
      afterClient: string | null = null;
    const cursor = query.get("cursor");
    if (cursor !== null) try {
      if (!/^[\w-]{1,320}$/.test(cursor)) throw new Error();
      const data = JSON.parse(Buffer.from(cursor, "base64url").toString());
      if (!Array.isArray(data) || data.length !== 4 || data[0] !== scope) throw new Error();
      snapshot = date(data[1]);
      afterAt = date(data[2]);
      afterClient = id(data[3]);
      if (Date.parse(snapshot) > now.getTime() || Date.parse(afterAt) > Date.parse(snapshot)) throw new Error();
    } catch {
      return officeError("Ha cambiado la consulta. Vuelve a la primera página de compradores.", 400);
    }
    const result = await gate.admin.rpc("office_conversion_funnel", {
      p_actor: gate.authUserId,
      p_campaign: key,
      p_month: month + "-01",
      p_zone: zone,
      p_as_of: snapshot,
      p_country_names: countryLabels,
      p_after_at: afterAt,
      p_after_client: afterClient,
      p_through: spend?.through ?? null
    });
    if (result.error) return officeDatabaseError(result.error);
    const r = result.data;
    if (r?.campaign !== key || r.month !== month || r.zone !== zone || Date.parse(r.as_of) !== Date.parse(snapshot) || !Array.isArray(r.amounts) || !Array.isArray(r.buyers) || typeof r.has_more !== "boolean") return invalid();
    const contacts = count(r.contacts),
      buyers = count(r.first_buyers),
      costBuyers = count(r.cost_first_buyers);
    const amounts: PilotMoney[] = r.amounts.map(hydrateAmount),
      page: PilotBuyer[] = r.buyers.map(hydrateBuyer);
    if (buyers > contacts || costBuyers > buyers || amounts.reduce((n, a) => n + a.first_count, 0) !== buyers || page.length > 25 || r.has_more && page.length !== 25) return invalid();
    const last = page.at(-1),
      next = r.has_more && last ? Buffer.from(JSON.stringify([scope, snapshot, last.purchase_at, last.client_id])).toString("base64url") : null;
    return officeJson({
      ok: true,
      month,
      selected,
      campaigns,
      zone,
      as_of: snapshot,
      period_from: period.from,
      period_through: period.through,
      contacts,
      first_buyers: buyers,
      funnel: hydrateFunnel(r.funnel, contacts, buyers),
      cost_first_buyers: costBuyers,
      unattributed_first_purchases: count(r.unattributed_first_purchases),
      amounts,
      buyers: page,
      next_cursor: next,
      spend,
      spend_reason: reason,
      cpa: spend && costBuyers ? spend.amount / costBuyers : null
    });
  } catch {
    return officeError("No se pudo verificar el piloto de campaña.", 503);
  }
}
export async function POST(req: Request) {
  try {
    const gate = await officeAccess(req);
    if (!gate.ok) return gate.response;
    const cap = 550000,
      tooLarge = () => officeError("El CSV debe ocupar como máximo 512 KiB.", 413);
    if (Number(req.headers.get("content-length") || 0) > cap) return tooLarge();
    const type = req.headers.get("content-type") || "";
    if (!type.startsWith("multipart/form-data;") || !req.body) return officeError("Selecciona un CSV de Ads Manager.", 400);
    const reader = req.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const item = await reader.read();
        if (item.done) break;
        size += item.value.byteLength;
        if (size > cap) {
          await reader.cancel();
          return tooLarge();
        }
        chunks.push(item.value);
      }
    } finally {
      reader.releaseLock();
    }
    const bounded = new Response(Buffer.concat(chunks), {
      headers: {
        "content-type": type
      }
    });
    const form = await bounded.formData().catch(() => null);
    const file = form?.get("file"),
      campaign = String(form?.get("campaign") || ""),
      month = String(form?.get("month") || ""),
      zone = String(form?.get("zone") || "");
    if (!file || typeof file === "string" || file.size > 524288 || !validMonth(month, new Date()) || form?.get("attested") !== "true") return officeError("Revisa el archivo y confirma su procedencia.", 400);
    let evidence;
    try {
      evidence = parsePilotCsv(Buffer.from(await file.arrayBuffer()), campaign, month, zone, new Date());
    } catch (e) {
      return officeError(e instanceof Error ? e.message : "CSV no válido.", 400);
    }
    const data = await gate.admin.rpc("office_pilot_record_csv", {
      p_actor: gate.authUserId,
      p_campaign: evidence.campaign,
      p_account: evidence.account,
      p_currency: evidence.currency,
      p_zone: evidence.zone,
      p_from: evidence.from,
      p_through: evidence.through,
      p_spend: evidence.amount,
      p_sha256: evidence.sha256
    });
    if (data.error) return officeDatabaseError(data.error);
    return officeJson({
      ok: true,
      receipt: id(data.data)
    });
  } catch {
    return officeError("No se pudo registrar el gasto de Ads Manager.", 503);
  }
}
