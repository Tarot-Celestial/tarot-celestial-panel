import { createHash } from "node:crypto";
import { officeAccess, officeDatabaseError, officeError, officeJson, officeUuid } from "@/lib/server/office-access";
import type { OfficeClientCapture, OfficeClientPurchase, OfficeClientReservation, OfficeClientRow } from "@/features/office/office-clients";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const defaultLimit = 25;
const maxLimit = 50;
type Row = Record<string, unknown>;

function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid CRM record");
  return value as Row;
}

function string(value: unknown): string {
  if (typeof value !== "string") throw new Error("Invalid CRM text");
  return value;
}
function optional(value: unknown): string | null {
  return value == null ? null : string(value);
}

function uuid(value: unknown): string {
  if (!officeUuid(value)) throw new Error("Invalid CRM identifier");
  return value;
}
function stamp(value: unknown): string {
  const date = string(value);
  if (!Number.isFinite(Date.parse(date))) throw new Error("Invalid CRM timestamp");
  return date;
}
function clientRow(value: unknown): OfficeClientRow {
  const row = object(value);
  if (typeof row.account_linked !== "boolean" || (row.capture_stage !== "captured" && row.capture_stage !== "pending")) {
    throw new Error("Invalid CRM client");
  }
  return {
    id: uuid(row.id),
    display_name: optional(row.display_name) || "Sin nombre registrado",
    country: optional(row.country),
    created_at: optional(row.created_at),
    account_linked: row.account_linked,
    capture_stage: row.capture_stage,
    first_purchase_at: optional(row.first_purchase_at),
  };
}

function firstPurchase(value: unknown): OfficeClientPurchase | null {
  if (value === null) return null;
  const row = object(value);
  if (row.amount !== null && (typeof row.amount !== "number" || !Number.isFinite(row.amount))) throw new Error("Invalid CRM amount");
  return {
    id: string(row.id),
    source: string(row.source),
    at: stamp(row.at),
    status: string(row.status),
    amount: row.amount,
    currency: optional(row.currency),
  };
}

function reservation(value: unknown): OfficeClientReservation {
  const row = object(value);
  if (row.source !== "reservas" && row.source !== "first_tarotist_reservations") throw new Error("Invalid reservation source");
  return {
    id: uuid(row.id),
    source: row.source,
    at: row.at === null ? null : stamp(row.at),
    status: optional(row.status) || "Sin estado registrado",
    tarotist_name: optional(row.tarotist_name),
  };
}

function capture(value: unknown): OfficeClientCapture | null {
  if (value === null) return null;
  const row = object(value);
  return {
    lead_id: uuid(row.lead_id ?? row.id),
    origin: optional(row.origin),
    status: optional(row.status),
    created_at: optional(row.created_at),
    next_contact_at: optional(row.next_contact_at),
  };
}

type Cursor = { id: string; at: string | null; source?: OfficeClientReservation["source"] };

function scopeFor(parts: string[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("base64url").slice(0, 24);
}

function encode(scope: string, cursor: Cursor) {
  const fields = [1, scope, cursor.id, cursor.at, cursor.source ?? null];
  return Buffer.from(JSON.stringify(fields), "utf8").toString("base64url");
}

function decode(raw: string, scope: string, reservationPage: boolean): Cursor | null {
  if (raw.length > 320 || !/^[\w-]+$/.test(raw)) return null;
  try {
    const fields: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (!Array.isArray(fields) || fields.length !== 5 || fields[0] !== 1 || fields[1] !== scope || !officeUuid(fields[2])) return null;
    const [, , id, at, source] = fields;
    if (reservationPage ? source !== "reservas" && source !== "first_tarotist_reservations" : source !== null) return null;
    if (!(reservationPage && at === null) && (typeof at !== "string" || at.length > 48 ||
        !/^\d{4}-\d\d-\d\d[T ]\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d(?::?\d\d)?)$/i.test(at) || !Number.isFinite(Date.parse(at)))) return null;
    return { id, at, source: source ?? undefined };
  } catch { return null; }
}

export async function GET(req: Request) {
  try {
    const gate = await officeAccess(req);
    if (!gate.ok) return gate.response;
    const params = new URL(req.url).searchParams;
    const rawLimit = params.get("limit") ?? String(defaultLimit);
    const limit = Number(rawLimit);
    if (!/^\d{1,2}$/.test(rawLimit) || limit < 1 || limit > maxLimit) {
      return officeError("El tamaño de página debe estar entre 1 y 50.", 400);
    }
    const id = params.get("id");
    if (id !== null && !officeUuid(id)) return officeError("Selecciona una ficha CRM válida.", 400);
    const search = (params.get("q") || "").trim().normalize("NFC");
    const stage = params.get("stage") ?? "all";
    if (search.length > 120 || /[\u0000-\u001f\u007f]/.test(search) || !["all", "captured", "pending"].includes(stage)) {
      return officeError("Revisa la búsqueda y el filtro de primera compra.", 400);
    }
    const scope = scopeFor(id ? ["reservas", gate.authUserId, id] : ["clientes", gate.authUserId, search, stage]);
    const token = params.get("cursor");
    const cursor = token === null ? null : decode(token, scope, id !== null);
    if (token !== null && !cursor) return officeError("La página no corresponde a esta consulta. Vuelve a la primera página.", 400);

    if (id === null) {
      const asOf = cursor?.at ?? new Date().toISOString();
      if (Date.parse(asOf) > Date.now()) return officeError("La fecha de la página no es válida.", 400);
      const result = await gate.admin.rpc("office_crm_client_page", {
        p_actor: gate.authUserId,
        p_search: search,
        p_stage: stage,
        p_after: cursor?.id ?? null,
        p_limit: limit + 1,
        p_as_of: asOf,
      });
      if (result.error) return officeDatabaseError(result.error);
      if (!Array.isArray(result.data)) throw new Error("Invalid CRM directory");
      const items = result.data.slice(0, limit).map(clientRow);
      const next = result.data.length > limit ? encode(scope, { id: items[items.length - 1].id, at: asOf }) : null;
      return officeJson({ ok: true, items, next_cursor: next });
    }
    const result = await gate.admin.rpc("office_crm_client_detail", {
      p_actor: gate.authUserId,
      p_client_id: id,
      p_after_at: cursor?.at ?? null,
      p_after_id: cursor?.id ?? null,
      p_after_source: cursor?.source ?? null,
      p_limit: limit,
    });
    if (result.error) return officeDatabaseError(result.error);
    if (result.data === null) return officeError("Esta ficha de Tarot Celestial no está disponible.", 404);
    const data = object(result.data);
    const clientData = object(data.client);
    const client = { ...clientRow(clientData), origin: optional(clientData.origin) };
    if (client.id !== id.toLowerCase() || !Array.isArray(data.appointments) || data.appointments.length > limit ||
        typeof data.appointments_has_more !== "boolean") {
      throw new Error("Invalid CRM detail");
    }
    const reservations = data.appointments.map(reservation);
    const last = reservations[reservations.length - 1];
    if (data.appointments_has_more && !last) throw new Error("Invalid reservation page");
    return officeJson({
      ok: true,
      client,
      first_purchase: firstPurchase(data.first_purchase),
      capture: capture(data.capture),
      reservations,
      reservations_has_more: data.appointments_has_more,
      next_reservations_cursor: data.appointments_has_more ? encode(scope, last) : null,
    });
  } catch {
    return officeError("No se pudo consultar el CRM de Tarot Celestial. Actualiza la consulta.", 503);
  }
}
