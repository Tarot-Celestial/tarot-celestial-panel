import { getServiceClient, uidAndEmailFromBearer } from "@/lib/admin/require-admin";
import { officeError, officeJson, officeUuid } from "@/lib/server/office-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const filters = ["active","open","mine","resolved","returned","all","reply_window"];
const outcomes = ["answered","appointment","no_interest","no_inquiry","unreachable","other"];
function dbError(error:{message:string}) {
  switch(error.message) {
    case "OFFICE_FORBIDDEN": return officeError("Tu cuenta no tiene permiso para realizar esta operación.",403);
    case "OFFICE_NOT_FOUND": return officeError("No se ha encontrado la derivación.",404);
    case "OFFICE_CONFLICT": return officeError("Otro operador ha actualizado el caso. Revisa su estado actual.",409);
    case "OFFICE_DISPATCH_ACTIVE": return officeError("Hay un envío en curso. Comprueba el recibo antes de tomar el caso.",409);
    case "OFFICE_RETURN_UNAVAILABLE": return officeError("Este contacto tiene una baja, una compra o un envío por comprobar.",409);
    case "OFFICE_INVALID": return officeError("Revisa el estado y el resultado del caso.",400);
    default: return officeError("No se pudo consultar la bandeja de Comercial.",503);
  }
}
export async function GET(req:Request) {
  try {
    const {uid}=await uidAndEmailFromBearer(req);
    if (!uid) return officeError("Inicia sesión para entrar en Comercial.",401);
    const p=new URL(req.url).searchParams, filter=p.get("state") || "active", at=p.get("before"), after=p.get("after"), id=p.get("id");
    if (!filters.includes(filter) || (id!==null && !officeUuid(id)) || (at===null)!==(after===null)
      || (after!==null && (!officeUuid(after) || !at || at.length>40 || !Number.isFinite(Date.parse(at))))) return officeError("Revisa los filtros de Comercial.",400);
    const {data,error}=await getServiceClient().rpc("office_commercial_page",{p_actor:uid,p_filter:filter,p_at:at,p_after:after,p_id:id});
    return error ? dbError(error) : officeJson(data);
  } catch {return officeError("No se pudo consultar la bandeja de Comercial.",503);}
}
export async function POST(req:Request) {
  try {
    const {uid}=await uidAndEmailFromBearer(req);
    if (!uid) return officeError("Inicia sesión para entrar en Comercial.",401);
    if (!req.headers.get("content-type")?.startsWith("application/json")) return officeError("Usa un objeto JSON.",415);
    if (Number(req.headers.get("content-length"))>8192) return officeError("La nota es demasiado larga.",413);
    const raw=await req.text();
    if (raw.length>8192) return officeError("La nota es demasiado larga.",413);
    let v;try {v=JSON.parse(raw);} catch {return officeError("Revisa los datos del caso.",400);}
    if (!v || !officeUuid(v.id) || !officeUuid(v.request_id) || !Number.isSafeInteger(v.version) || v.version<1 ||
      !["claim","release","resolve","return"].includes(v.action) || (v.note!=null && (typeof v.note!=="string" || v.note.length>600)) ||
      (v.action==="resolve" ? !outcomes.includes(v.outcome) || (v.outcome==="other" && !v.note?.trim()) : v.outcome!=null)) return officeError("Revisa la acción y el resultado del caso.",400);
    const {data,error}=await getServiceClient().rpc("office_commercial_change",{p_actor:uid,p_id:v.id,p_request:v.request_id,p_version:v.version,
      p_action:v.action,p_outcome:v.outcome || null,p_note:v.note?.trim() || null});
    return error ? dbError(error) : officeJson(data);
  } catch {return officeError("No se pudo guardar el cambio de Comercial.",503);}
}
