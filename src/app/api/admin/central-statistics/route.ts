import { getAdminClient } from '@/lib/server/auth-worker';
import { requireActivePanelSession } from '@/lib/server/panel-attendance';
import { loadCentralStatistics } from '@/lib/server/central-statistics';
import { ecuadorDate, validDate } from '@/lib/central-statistics';

export const runtime='nodejs';
export const dynamic='force-dynamic';
const json=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store'}});
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIME=/^(?:[01]\d|2[0-3]):[0-5]\d$/;

async function access(req:Request) {
 const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'');
 if(!token)return {response:json({ok:false,error:'Inicia sesión de nuevo.'},401)};
 const db=getAdminClient();
 // Validate the bearer with Supabase, not an unverified local JWT decode.
 const auth=await db.auth.getUser(token);
 if(auth.error||!auth.data.user)return {response:json({ok:false,error:'Sesión no válida.'},401)};
 const result=await db.from('workers').select('id,role,is_active,display_name').eq('user_id',auth.data.user.id).maybeSingle();
 if(result.error)throw result.error;
 if(!result.data||result.data.role!=='admin'||result.data.is_active!==true)return {response:json({ok:false,error:'Acceso reservado a administración.'},403)};
 const active=await requireActivePanelSession(db,result.data);
 if(!active.ok)return {response:json({ok:false,error:'Conéctate para desbloquear el panel.',code:active.error},active.status)};
 return {db,worker:result.data};
}
function errorResponse(error:unknown) {
 const message=error instanceof Error?error.message:String((error as {message?:string})?.message||'');
 if(/OPERATION_CONFLICT|ADJUSTMENT_CHANGED/.test(message))return json({ok:false,error:'Los datos cambiaron. Recarga antes de guardar otra vez.'},409);
 if(/ONLY_FUTURE_WEEKEND|ONE_WEEKEND_DAY/.test(message))return json({ok:false,error:'Elige un solo sábado o domingo por semana y únicamente fechas futuras.'},400);
 if(/CONFIG_REQUIRED/.test(message))return json({ok:false,error:'Guarda primero el horario de esta central.'},400);
 if(/OUTSIDE_RECORDED_PERIOD/.test(message))return json({ok:false,error:'La corrección debe estar dentro del periodo del nuevo registro de sesiones.'},400);
 if(/INVALID_|NEGATIVE_RECORDED/.test(message))return json({ok:false,error:'Revisa el periodo, horario o importe indicado.'},400);
 console.error('[central-statistics]',{message,code:(error as {code?:string})?.code});
 return json({ok:false,error:'No se pudieron cargar o guardar las estadísticas. Comprueba que las migraciones estén publicadas.'},500);
}
export async function GET(req:Request) {
 try {
  const gate=await access(req);if(gate.response)return gate.response;
  const month=new URL(req.url).searchParams.get('month')||ecuadorDate().slice(0,7);
  return json(await loadCentralStatistics(gate.db!,month));
 }catch(error){return errorResponse(error);}
}
export async function POST(req:Request) {
 try {
  const gate=await access(req);if(gate.response)return gate.response;
  const raw=await req.text();if(raw.length>12000)return json({ok:false,error:'Solicitud demasiado grande.'},413);
  let body:any;try{body=JSON.parse(raw);}catch{return json({ok:false,error:'Solicitud no válida.'},400);}
  if(!body||typeof body!=='object'||!UUID.test(body.worker_id)||!UUID.test(body.operation_id))return json({ok:false,error:'Selecciona una central y vuelve a intentar guardar.'},400);
  const action=String(body.action||'');let payload:Record<string,unknown>;
  if(action==='settings') {
   const salary=body.monthly_salary_eur,rate=body.overtime_hourly_rate_eur;
   if(typeof salary!=='number'||!Number.isFinite(salary)||salary<0||salary>100000||!(rate===null||(typeof rate==='number'&&Number.isFinite(rate)&&rate>=0&&rate<=10000)))throw new Error('INVALID_RATE');
   const start=body.weekday_start,end=body.weekday_end,ws=body.weekend_start,we=body.weekend_end;
   if(!((start===null&&end===null)||(typeof start==='string'&&typeof end==='string'&&TIME.test(start)&&TIME.test(end)&&start<end))||!TIME.test(ws)||!TIME.test(we)||ws>=we)throw new Error('INVALID_SCHEDULE');
   payload={monthly_salary_eur:salary,overtime_hourly_rate_eur:rate,weekday_start:start,weekday_end:end,weekend_start:ws,weekend_end:we};
  }else if(action==='weekends') {
   if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(body.month)||!Array.isArray(body.days)||body.days.length>10||body.days.some((d:unknown)=>typeof d!=='string'||!validDate(d)))throw new Error('INVALID_WEEKENDS');
   payload={month:body.month,days:[...new Set(body.days)].sort()};
  }else if(action==='adjustment') {
   if(typeof body.date!=='string'||!validDate(body.date)||!Number.isInteger(body.minutes)||!body.minutes||Math.abs(body.minutes)>1440||!['ordinary','outside_schedule'].includes(body.category)||typeof body.reason!=='string'||body.reason.trim().length<5||body.reason.trim().length>2000)throw new Error('INVALID_ADJUSTMENT');
   const retry=await gate.db!.from('central_statistics_operations').select('worker_id,actor_id,action,payload,result').eq('id',body.operation_id).maybeSingle();
   if(retry.error)throw retry.error;
   if(retry.data){
    const p=retry.data.payload;
    if(retry.data.worker_id!==body.worker_id||retry.data.actor_id!==gate.worker!.id||retry.data.action!==action||p.date!==body.date||p.minutes!==body.minutes||p.category!==body.category||p.reason!==body.reason.trim())throw new Error('OPERATION_CONFLICT');
    return json({...retry.data.result,duplicate_prevented:true});
   }
   const report=await loadCentralStatistics(gate.db!,body.date.slice(0,7));
   const worker=report.workers.find(w=>w.id===body.worker_id),day=worker?.day_breakdown.find(d=>d.date===body.date);
   if(!worker||!worker.hours.coverage_start||body.date<ecuadorDate(new Date(worker.hours.coverage_start))||body.date>ecuadorDate())throw new Error('OUTSIDE_RECORDED_PERIOD');
   const recorded=body.category==='ordinary'?(day?.ordinary_minutes||0):(day?.outside_schedule_minutes||0);
   if(recorded+body.minutes<0||(day?.minutes||0)+body.minutes>1440)throw new Error('NEGATIVE_RECORDED_HOURS');
   const previous=await gate.db!.from('central_time_adjustments').select('minutes,category').eq('worker_id',body.worker_id).eq('work_date',body.date);
   if(previous.error)throw previous.error;
   payload={date:body.date,minutes:body.minutes,category:body.category,reason:body.reason.trim(),expected_category_adjustment:(previous.data||[]).filter(r=>r.category===body.category).reduce((n,r)=>n+Number(r.minutes),0),expected_total_adjustment:(previous.data||[]).reduce((n,r)=>n+Number(r.minutes),0),category_recorded_minutes:recorded,total_recorded_minutes:day?.minutes||0};
  }else return json({ok:false,error:'Acción no válida.'},400);
  const result=await gate.db!.rpc('tc_central_statistics_update',{p_actor:gate.worker!.id,p_worker:body.worker_id,p_action:action,p_payload:payload,p_operation:body.operation_id});
  if(result.error)throw result.error;
  return json(result.data);
 }catch(error){return errorResponse(error);}
}
