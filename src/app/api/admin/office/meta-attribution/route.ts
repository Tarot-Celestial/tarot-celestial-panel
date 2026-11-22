import { createHash } from "node:crypto";
import { officeAccess,officeDatabaseError,officeError,officeJson,officeUuid } from "@/lib/server/office-access";
import type { OfficeMetaChannel,OfficeMetaCounts,OfficeMetaOpportunity,OfficeMetaConversion } from "@/features/office/office-meta-attribution";

export const dynamic="force-dynamic";
export const runtime="nodejs";
const channels=new Set(["instagram","facebook","whatsapp","meta_form"]);
const statuses=new Set(["pending","claimed","dispatching","sent","expired","handoff","blocked","failed","uncertain","opted_out","purchased","recorded"]);
const conversions=new Set(["unlinked","awaiting_proof","awaiting_purchase","prior_customer","first_purchase","linked_elsewhere"]);
type Row=Record<string,unknown>;
function row(value:unknown):Row {
  if (!value || typeof value!=="object" || Array.isArray(value)) throw new Error("META_REPORT_INVALID");
  return value as Row;
}
function array(value:unknown):Row[] {
  if (!Array.isArray(value)) throw new Error("META_REPORT_INVALID");
  return value.map(row);
}
function label(value:unknown):string {
  if (typeof value!=="string" || !/^[a-z][a-z0-9_]{0,64}$/i.test(value)) throw new Error("META_REPORT_INVALID");
  return value;
}
function stamp(value:unknown):string {
  if (typeof value!=="string" || !/^\d{4}-\d\d-\d\dT/.test(value) || value.length>40 || !Number.isFinite(Date.parse(value))) throw new Error("META_REPORT_INVALID");
  return value;
}
function id(value:unknown):string { if (!officeUuid(value)) throw new Error("META_REPORT_INVALID"); return value; }
function count(value:unknown):number { if (typeof value!=="number" || !Number.isSafeInteger(value) || value<0) throw new Error("META_REPORT_INVALID");return value; }
function channel(value:unknown):OfficeMetaChannel { const s=label(value); if (!channels.has(s)) throw new Error("META_REPORT_INVALID"); return s as OfficeMetaChannel; }
function counts(v:Row):OfficeMetaCounts {
  const result={opportunities:count(v.opportunities),opened_opportunities:count(v.opened_opportunities),proof_pending:count(v.proof_pending),
    linked_clients:count(v.linked_clients),prior_clients:count(v.prior_clients),first_purchases:count(v.first_purchases),linked_elsewhere:count(v.linked_elsewhere),pending:count(v.pending)};
  if (result.first_purchases+result.prior_clients+result.pending+result.linked_elsewhere!==result.opportunities || result.linked_clients>result.opportunities ||
      result.first_purchases+result.prior_clients>result.linked_clients || result.opened_opportunities>result.opportunities) throw new Error("META_REPORT_INVALID");
  return result;
}
function item(v:Row):OfficeMetaOpportunity {
  const conversion=label(v.conversion), kind=label(v.kind);
  if (!conversions.has(conversion) || !["message","comment","form"].includes(kind) || typeof v.opened!=="boolean" || typeof v.has_receipt!=="boolean") throw new Error("META_REPORT_INVALID");
  const name=typeof v.display_name==="string" && !/[@\u0000-\u001f]|https?:\/\//i.test(v.display_name) && v.display_name.replace(/\D/g,"").length<7 ? v.display_name.trim().slice(0,80) : null;
  return {id:id(v.id),display_name:name||null,channel:channel(v.channel),kind:kind as OfficeMetaOpportunity["kind"],source_at:stamp(v.source_at),
    latest_inbound_at:stamp(v.latest_inbound_at),window_until:v.window_until==null?null:stamp(v.window_until),status:label(v.status),
    provider_error:v.provider_error==null?null:label(v.provider_error),thread_id:v.thread_id==null?null:id(v.thread_id),lead_id:v.lead_id==null?null:id(v.lead_id),
    opened:v.opened,has_receipt:v.has_receipt,conversion:conversion as OfficeMetaConversion,
    first_purchase_at:v.first_purchase_at==null?null:stamp(v.first_purchase_at),first_purchase_source:v.first_purchase_source==null?null:label(v.first_purchase_source),
    first_purchase_status:v.first_purchase_status==null?null:label(v.first_purchase_status)};
}
export async function GET(req:Request) {
  try {
    const gate=await officeAccess(req);if (!gate.ok) return gate.response;
    const params=new URL(req.url).searchParams,now=new Date();
    const parts=new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit",timeZone:"Europe/Madrid"}).formatToParts(now);
    const current=parts.find(p=>p.type==="year")!.value+"-"+parts.find(p=>p.type==="month")!.value;
    const month=params.get("month")??current;
    if (!/^[1-9]\d{3}-(0[1-9]|1[0-2])$/.test(month) || month>current) return officeError("Selecciona un mes válido que ya haya comenzado.",400);
    const status=params.get("status") || null,search=(params.get("q") || "").trim().normalize("NFC") || null;
    if ((status!==null && !statuses.has(status)) || (search!==null && (search.length>100 || /[\u0000-\u001f\u007f]/.test(search)))) {
      return officeError("Revisa el estado y la búsqueda del informe.",400);
    }
    const scope=createHash("sha256").update(JSON.stringify([gate.authUserId,month,status,search])).digest("base64url").slice(0,24);
    const cursor=params.get("cursor");let snapshot=now.toISOString(),afterAt:string|null=null,afterId:string|null=null;
    if (cursor!==null) try {
      if (!/^[\w-]{1,360}$/.test(cursor)) throw new Error();
      const key=JSON.parse(Buffer.from(cursor,"base64url").toString("utf8"));
      if (!Array.isArray(key) || key.length!==4 || key[0]!==scope) throw new Error();
      snapshot=stamp(key[1]);afterAt=stamp(key[2]);afterId=id(key[3]);
      if (Date.parse(snapshot)>now.getTime() || Date.parse(afterAt)>Date.parse(snapshot)) throw new Error();
    } catch { return officeError("La página no corresponde a este informe.",400); }
    const {data,error}=await gate.admin.rpc("office_meta_attribution_report",{p_actor:gate.authUserId,p_month:month+"-01",
      p_as_of:snapshot,p_after_at:afterAt,p_after_id:afterId,p_status:status,p_search:search});
    if (error) return officeDatabaseError(error);
    const r=row(data),asOf=stamp(r.as_of);
    if (r.month!==month || Date.parse(asOf)!==Date.parse(snapshot) || typeof r.has_more!=="boolean") throw new Error("META_REPORT_INVALID");
    const totals=counts(row(r.totals)),platforms=array(r.platforms).map(p=>({...counts(p),platform:channel(p.platform)}));
    const states=array(r.states).map(p=>({state:label(p.state),count:count(p.count)}));
    const purchases=array(r.purchases).map(p=>({source:label(p.source),count:count(p.count)}));
    const items=array(r.items).map(item);
    if (items.length>25 || (r.has_more && items.length!==25) || platforms.reduce((n,p)=>n+p.opportunities,0)!==totals.opportunities ||
      states.reduce((n,p)=>n+p.count,0)!==totals.opportunities || purchases.reduce((n,p)=>n+p.count,0)!==totals.first_purchases) throw new Error("META_REPORT_INVALID");
    const last=items.at(-1);
    const next=r.has_more && last?Buffer.from(JSON.stringify([scope,snapshot,last.source_at,last.id])).toString("base64url"):null;
    return officeJson({ok:true,month,as_of:asOf,totals,platforms,states,purchases,items,next_cursor:next});
  } catch { return officeError("No se pudo verificar la atribución de las oportunidades.",503); }
}
