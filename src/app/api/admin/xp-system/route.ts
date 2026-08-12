import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { xpLevelProgress } from "@/lib/xp-levels";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const monthStart = () => { const d=new Date(); return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)).toISOString(); };
const dayStart = () => { const d=new Date(); return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())).toISOString(); };
const num=(v:any)=>Number(v)||0;


export async function GET(req:Request){
 try{
  const gate=await requireAdmin(req); if(!gate.ok) return NextResponse.json({ok:false,error:gate.error},{status:403});
  const {admin}=gate;
  const [rulesR,eventsR,workersR,auditR]=await Promise.all([
   admin.from("worker_xp_rules").select("*").order("created_at"),
   admin.from("worker_xp_events").select("id,worker_id,action_key,xp_amount,reference_id,reference_label,origin,status,created_at").order("created_at",{ascending:false}).limit(250),
   admin.from("workers").select("id,display_name,email,role,team,is_active").eq("role","central").order("display_name"),
   admin.from("worker_xp_audit").select("*").order("created_at",{ascending:false}).limit(100),
  ]);
  for(const r of [rulesR,eventsR,workersR,auditR]) if(r.error) throw r.error;
  const events=eventsR.data||[], workers=workersR.data||[];
  const cards=workers.map((w:any)=>{ const own=events.filter((e:any)=>e.worker_id===w.id&&e.status==="applied"); const total=own.reduce((s:any,e:any)=>s+num(e.xp_amount),0); const month=own.filter((e:any)=>e.created_at>=monthStart()).reduce((s:any,e:any)=>s+num(e.xp_amount),0); const today=own.filter((e:any)=>e.created_at>=dayStart()).reduce((s:any,e:any)=>s+num(e.xp_amount),0); const lvl=xpLevelProgress(total); return {...w,total_xp:total,xp_month:month,xp_today:today,level:lvl.level,level_xp:lvl.current,next_level_xp:lvl.span,next_level_total:lvl.next,clients_captured:own.filter((e:any)=>e.action_key==="client_capture").length,repurchases:own.filter((e:any)=>e.action_key==="repurchase").length,followups:own.filter((e:any)=>e.action_key==="followup").length,consultations:own.filter((e:any)=>e.action_key==="consultation").length,positive_reviews:own.filter((e:any)=>e.action_key==="positive_review").length,missions:own.filter((e:any)=>e.action_key==="daily_mission").length,coins:null,coins_spent:null,rewards_claimed:null,rewards_value:null}; });
  const applied=events.filter((e:any)=>e.status==="applied"); const monthEvents=applied.filter((e:any)=>e.created_at>=monthStart()); const todayEvents=applied.filter((e:any)=>e.created_at>=dayStart());
  const top=[...cards].sort((a:any,b:any)=>b.xp_month-a.xp_month)[0]||null;
  return NextResponse.json({ok:true,rules:rulesR.data||[],workers:cards,events,audit:auditR.data||[],summary:{xp_month:monthEvents.reduce((s:any,e:any)=>s+num(e.xp_amount),0),xp_today:todayEvents.reduce((s:any,e:any)=>s+num(e.xp_amount),0),average_level:cards.length?cards.reduce((s:any,w:any)=>s+w.level,0)/cards.length:0,top_worker:top?{id:top.id,name:top.display_name,xp:top.xp_month}:null,coins_generated:null,rewards_claimed:null,active_rules:(rulesR.data||[]).filter((r:any)=>r.enabled).length}});
 }catch(e:any){ return NextResponse.json({ok:false,error:e?.message||"ERR"},{status:500}); }
}

export async function POST(req:Request){
 try{
  const gate=await requireAdmin(req); if(!gate.ok) return NextResponse.json({ok:false,error:gate.error},{status:403});
  const {admin,me}=gate; const b=await req.json(); const op=String(b?.op||"");
  if(op==="save_rule"){
   const key=String(b.action_key||"").trim().toLowerCase().replace(/[^a-z0-9_]+/g,"_"); if(!key) throw new Error("ACTION_KEY_REQUIRED");
   const old=await admin.from("worker_xp_rules").select("*").eq("action_key",key).maybeSingle();
   const payload={action_key:key,name:String(b.name||"").trim(),description:String(b.description||"").trim(),xp_reward:Math.max(0,Math.round(num(b.xp_reward))),frequency:String(b.frequency||"").trim(),enabled:!!b.enabled,integration_status:String(b.integration_status||"pending")==="connected"?"connected":"pending",updated_at:new Date().toISOString()};
   const saved=await admin.from("worker_xp_rules").upsert(payload,{onConflict:"action_key"}).select("*").single(); if(saved.error) throw saved.error;
   await admin.from("worker_xp_audit").insert({admin_worker_id:me.id,change_type:"rule_update",target_key:key,old_value:old.data||null,new_value:saved.data});
   return NextResponse.json({ok:true,rule:saved.data});
  }
  if(op==="adjust_xp"){
   const workerId=String(b.worker_id||""); const amount=Math.round(num(b.amount)); const reason=String(b.reason||"").trim(); if(!workerId||!amount||!reason) throw new Error("WORKER_AMOUNT_REASON_REQUIRED");
   const ref=`manual:${me.id}:${Date.now()}:${crypto.randomUUID()}`;
   const ins=await admin.from("worker_xp_events").insert({worker_id:workerId,action_key:"manual_adjustment",xp_amount:amount,reference_id:ref,reference_label:reason,origin:"admin",status:"applied",created_by_worker_id:me.id}).select("*").single(); if(ins.error) throw ins.error;
   await admin.from("worker_xp_audit").insert({admin_worker_id:me.id,change_type:"manual_adjustment",target_worker_id:workerId,target_key:"manual_adjustment",new_value:{amount,reason,event_id:ins.data.id}});
   return NextResponse.json({ok:true,event:ins.data});
  }
  throw new Error("INVALID_OPERATION");
 }catch(e:any){ return NextResponse.json({ok:false,error:e?.message||"ERR"},{status:400}); }
}
