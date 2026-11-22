import { officeAccess,officeDatabaseError,officeError,officeJson } from "@/lib/server/office-access";
import { officeDepartments } from "@/features/office/catalog";
import { autonomyActions,autonomyChannels,autonomyModes } from "@/features/office/office-autonomy";

export const dynamic = "force-dynamic";

export async function GET(req:Request) {
  try {
    const auth = await officeAccess(req);
    if (!auth.ok) return auth.response;
    const {data,error} = await auth.admin.rpc("office_autonomy_snapshot",{p_actor:auth.authUserId});
    if (error) return officeDatabaseError(error);
    return officeJson(data);
  } catch { return officeError("No se pudo leer la autonomía.",503); }
}

function validRule(b:any) {
  if (!b || !["department","action","channel","account","mode"].every(k=>typeof b[k]==="string")) return false;
  const action = Object.hasOwn(autonomyActions,b.action) ? autonomyActions[b.action as keyof typeof autonomyActions] : null;
  if ((b.action && !action) || (b.department && !officeDepartments.some(d=>d.id===b.department)) ||
      (b.channel && !Object.hasOwn(autonomyChannels,b.channel)) || !Object.hasOwn(autonomyModes,b.mode) ||
      (action && b.department && !action.departments.includes(b.department)) || (action && b.channel && !action.channels.includes(b.channel)) ||
      (b.account && !["instagram","facebook","whatsapp","meta_form"].includes(b.channel)) || b.account.length>160 || /[\u0000-\u001F]/u.test(b.account)) return false;
  const hm = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!(b.window_start===null && b.window_end===null) &&
    !(typeof b.window_start==="string" && typeof b.window_end==="string" && hm.test(b.window_start) && hm.test(b.window_end) && b.window_start!==b.window_end)) return false;
  return Number.isSafeInteger(b.revision) && b.revision>=0 && b.revision<=2147483647 &&
    (b.daily_actions===null || Number.isSafeInteger(b.daily_actions) && b.daily_actions>=0 && b.daily_actions<=100000) &&
    (b.daily_usd===null || Number.isFinite(b.daily_usd) && b.daily_usd>=0 && b.daily_usd<=100000 && Math.abs(Math.round(b.daily_usd*100)-b.daily_usd*100)<1e-7);
}

export async function POST(req:Request) {
  try {
    const auth = await officeAccess(req);
    if (!auth.ok) return auth.response;
    const body = await req.json().catch(()=>null);
    if (body?.operation==="hold") {
      if (typeof body.held!=="boolean" || !Number.isSafeInteger(body.revision) || body.revision<0 ||
        (body.department!=="" && !officeDepartments.some(d=>d.id===body.department))) return officeError("Revisa el ámbito de la pausa.",400);
      const {data,error} = await auth.admin.rpc("office_autonomy_hold",{p_actor:auth.authUserId,p_department:body.department,p_held:body.held,p_revision:body.revision});
      return error ? officeDatabaseError(error) : officeJson({ok:true,revision:data});
    }
    if (!validRule(body)) return officeError("Revisa el ámbito, los límites y las dos horas de Madrid.",400);
    const {department,action,channel,account,mode,window_start,window_end,daily_actions,daily_usd,revision} = body;
    const {data,error} = await auth.admin.rpc("office_autonomy_set",{p_actor:auth.authUserId,p_revision:revision,
      p_rule:{department,action,channel,account,mode,window_start,window_end,daily_actions,daily_usd}});
    if (error) return officeDatabaseError(error);
    return officeJson({ok:true,revision:data});
  } catch { return officeError("No se pudo guardar la política de autonomía.",503); }
}
