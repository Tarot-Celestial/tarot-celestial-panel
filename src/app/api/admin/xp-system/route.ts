import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { configuredXpProgress } from "@/lib/xp-levels";
import { loadXpLevelConfiguration } from "@/lib/server/xp-level-config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const monthStart = () => { const d=new Date(); return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)).toISOString(); };
const dayStart = () => { const d=new Date(); return new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate())).toISOString(); };
const num=(v:any)=>Number(v)||0;


export async function GET(req:Request){
 try{
  const gate=await requireAdmin(req); if(!gate.ok) return NextResponse.json({ok:false,error:gate.error},{status:403});
  const {admin}=gate;
  const levelConfig = await loadXpLevelConfiguration(admin);
  const [rulesR,eventsR,workersR,auditR,missionsR,levelMissionsR,tierMissionsR]=await Promise.all([
   admin.from("worker_xp_rules").select("*").order("created_at"),
   admin.from("worker_xp_events").select("id,worker_id,action_key,xp_amount,reference_id,reference_label,origin,status,created_at").order("created_at",{ascending:false}).limit(250),
   admin.from("workers").select("id,display_name,email,role,team,is_active").eq("role","central").order("display_name"),
   admin.from("worker_xp_audit").select("*").order("created_at",{ascending:false}).limit(100),
   admin.from("worker_xp_missions").select("*").order("display_order"),
   admin.from("worker_xp_level_missions").select("level,mission_id,availability,display_order,active"),
   admin.from("worker_xp_tier_missions").select("tier_key,mission_id,availability,display_order,active"),
  ]);
  for(const r of [rulesR,eventsR,workersR,auditR]) if(r.error) throw r.error;
  const missionInstalled=!missionsR.error&&!levelMissionsR.error&&!tierMissionsR.error;
  const [coinConfigR,walletsR,conversionsR]=await Promise.all([
   admin.from("worker_xp_coin_config").select("xp_units,coin_units,min_xp,enabled,updated_at").eq("id",true).maybeSingle(),
   admin.from("worker_coin_wallets").select("worker_id,balance"),
   admin.from("worker_xp_coin_conversions").select("worker_id,xp_spent,coins_granted,status"),
  ]);
  const coinInstalled=![coinConfigR,walletsR,conversionsR].some((r:any)=>r.error);
  const walletByWorker=new Map<string,number>((walletsR.data||[]).map((row:any)=>[String(row.worker_id),num(row.balance)] as [string,number]));
  const conversionsByWorker=new Map<string,{spent:number;coins:number}>();
  for(const row of conversionsR.data||[]){if(row.status!=="completed")continue;const key=String(row.worker_id);const old=conversionsByWorker.get(key)||{spent:0,coins:0};conversionsByWorker.set(key,{spent:old.spent+num(row.xp_spent),coins:old.coins+num(row.coins_granted)});}
  const events=eventsR.data||[], workers=workersR.data||[];
  const cards=workers.map((w:any)=>{ const own=events.filter((e:any)=>e.worker_id===w.id&&e.status==="applied"); const total=own.reduce((s:any,e:any)=>s+num(e.xp_amount),0); const month=own.filter((e:any)=>e.created_at>=monthStart()).reduce((s:any,e:any)=>s+num(e.xp_amount),0); const today=own.filter((e:any)=>e.created_at>=dayStart()).reduce((s:any,e:any)=>s+num(e.xp_amount),0); const lvl=configuredXpProgress(total, levelConfig.levels, levelConfig.tiers); const conversion=conversionsByWorker.get(String(w.id)); return {...w,total_xp:total,xp_month:month,xp_today:today,level:lvl.level,level_xp:lvl.current,next_level_xp:lvl.span,next_level_total:lvl.next,clients_captured:own.filter((e:any)=>e.action_key==="client_capture").length,repurchases:own.filter((e:any)=>e.action_key==="repurchase").length,followups:own.filter((e:any)=>e.action_key==="followup").length,consultations:own.filter((e:any)=>e.action_key==="consultation").length,positive_reviews:own.filter((e:any)=>e.action_key==="positive_review").length,missions:own.filter((e:any)=>e.action_key==="daily_mission").length,coins:coinInstalled?(walletByWorker.get(String(w.id))||0):null,coins_spent:coinInstalled?(conversion?.spent||0):null,rewards_claimed:null,rewards_value:null}; });
  const applied=events.filter((e:any)=>e.status==="applied"); const monthEvents=applied.filter((e:any)=>e.created_at>=monthStart()); const todayEvents=applied.filter((e:any)=>e.created_at>=dayStart());
  const top=[...cards].sort((a:any,b:any)=>b.xp_month-a.xp_month)[0]||null;
  return NextResponse.json({ok:true,rules:rulesR.data||[],workers:cards,events,audit:auditR.data||[],level_config:levelConfig.levels,tier_config:levelConfig.tiers,level_config_persisted:levelConfig.persisted,missions:{installed:missionInstalled,catalog:missionInstalled?missionsR.data||[]:[],levels:missionInstalled?levelMissionsR.data||[]:[],tiers:missionInstalled?tierMissionsR.data||[]:[]},coin_exchange:{installed:coinInstalled,config:coinConfigR.data||null},summary:{xp_month:monthEvents.reduce((s:any,e:any)=>s+num(e.xp_amount),0),xp_today:todayEvents.reduce((s:any,e:any)=>s+num(e.xp_amount),0),average_level:cards.length?cards.reduce((s:any,w:any)=>s+w.level,0)/cards.length:0,top_worker:top?{id:top.id,name:top.display_name,xp:top.xp_month}:null,coins_generated:coinInstalled?(conversionsR.data||[]).filter((r:any)=>r.status==="completed").reduce((s:number,r:any)=>s+num(r.coins_granted),0):null,rewards_claimed:null,active_rules:(rulesR.data||[]).filter((r:any)=>r.enabled).length}});
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
  if(op==="delete_rule"){
   const key=String(b.action_key||"").trim().toLowerCase().replace(/[^a-z0-9_]+/g,"_"); if(!key) throw new Error("ACTION_KEY_REQUIRED");
   const old=await admin.from("worker_xp_rules").select("*").eq("action_key",key).maybeSingle(); if(old.error) throw old.error; if(!old.data) return NextResponse.json({ok:false,error:"RULE_NOT_FOUND"},{status:404});
   const removed=await admin.from("worker_xp_rules").delete().eq("action_key",key).select("action_key").maybeSingle(); if(removed.error) throw removed.error;
   const audit=await admin.from("worker_xp_audit").insert({admin_worker_id:me.id,change_type:"rule_delete",target_key:key,old_value:old.data,new_value:null});
   return NextResponse.json({ok:true,action_key:key,historical_events_preserved:true,audit_recorded:!audit.error});
  }
  if(op==="adjust_xp"){
   const workerId=String(b.worker_id||""); const amount=Math.round(num(b.amount)); const reason=String(b.reason||"").trim(); if(!workerId||!amount||!reason) throw new Error("WORKER_AMOUNT_REASON_REQUIRED");
   const ref=`manual:${me.id}:${Date.now()}:${crypto.randomUUID()}`;
   const ins=await admin.from("worker_xp_events").insert({worker_id:workerId,action_key:"manual_adjustment",xp_amount:amount,reference_id:ref,reference_label:reason,origin:"admin",status:"applied",created_by_worker_id:me.id}).select("*").single(); if(ins.error) throw ins.error;
   await admin.from("worker_xp_audit").insert({admin_worker_id:me.id,change_type:"manual_adjustment",target_worker_id:workerId,target_key:"manual_adjustment",new_value:{amount,reason,event_id:ins.data.id}});
   return NextResponse.json({ok:true,event:ins.data});
  }
  if(op==="save_exchange_config"){
   const xpUnits=Math.round(num(b.xp_units)), coinUnits=Math.round(num(b.coin_units)), minXp=Math.round(num(b.min_xp));
   if(xpUnits<=0||coinUnits<=0||minXp<=0||minXp%xpUnits!==0) throw new Error("INVALID_EXCHANGE_CONFIG");
   const old=await admin.from("worker_xp_coin_config").select("*").eq("id",true).maybeSingle(); if(old.error) throw old.error;
   const payload={id:true,xp_units:xpUnits,coin_units:coinUnits,min_xp:minXp,enabled:b.enabled!==false,updated_at:new Date().toISOString(),updated_by_worker_id:me.id};
   const saved=await admin.from("worker_xp_coin_config").upsert(payload,{onConflict:"id"}).select("*").single(); if(saved.error) throw saved.error;
   await admin.from("worker_xp_audit").insert({admin_worker_id:me.id,change_type:"rule_update",target_key:"xp_coin_exchange",old_value:old.data||null,new_value:saved.data});
   return NextResponse.json({ok:true,config:saved.data});
  }

  if(op==="save_level_config"){
   const level=Math.trunc(num(b.level)); if(level<1||level>999) throw new Error("LEVEL_OUT_OF_RANGE");
   const tierKey=String(b.tier_key||"").trim(); if(!tierKey) throw new Error("TIER_REQUIRED");
   const xpToNext=b.xp_to_next==null||String(b.xp_to_next)===""?null:Math.max(1,Math.round(num(b.xp_to_next)));
   const old=await admin.from("worker_xp_level_config").select("*").eq("level",level).maybeSingle(); if(old.error) throw old.error;
   const payload={
    level,
    xp_to_next:xpToNext,
    tier_key:tierKey,
    reward_type:b.reward_type?String(b.reward_type):null,
    reward_amount:b.reward_amount==null||String(b.reward_amount)===""?null:Number(b.reward_amount),
    reward_label:b.reward_label?String(b.reward_label).trim():null,
    active:b.active!==false,
    display_order:Math.max(1,Math.round(num(b.display_order)||level)),
    updated_at:new Date().toISOString(),
   };
   const saved=await admin.from("worker_xp_level_config").upsert(payload,{onConflict:"level"}).select("*").single(); if(saved.error) throw saved.error;
   await admin.from("worker_xp_audit").insert({admin_worker_id:me.id,change_type:"rule_update",target_key:`level_config:${level}`,old_value:old.data||null,new_value:saved.data});
   return NextResponse.json({ok:true,level:saved.data});
  }
  if(op==="save_tier_config"){
   const key=String(b.key||"").trim().toLowerCase().replace(/[^a-z0-9_-]+/g,"_"); if(!key) throw new Error("TIER_KEY_REQUIRED");
   const name=String(b.name||"").trim(); if(!name) throw new Error("TIER_NAME_REQUIRED");
   const old=await admin.from("worker_xp_tier_config").select("*").eq("key",key).maybeSingle(); if(old.error) throw old.error;
   const payload={
    key,
    name,
    display_order:Math.max(1,Math.round(num(b.display_order)||1)),
    active:b.active!==false,
    reward_type:b.reward_type?String(b.reward_type):null,
    reward_amount:b.reward_amount==null||String(b.reward_amount)===""?null:Number(b.reward_amount),
    reward_label:b.reward_label?String(b.reward_label).trim():null,
    updated_at:new Date().toISOString(),
   };
   const saved=await admin.from("worker_xp_tier_config").upsert(payload,{onConflict:"key"}).select("*").single(); if(saved.error) throw saved.error;
   await admin.from("worker_xp_audit").insert({admin_worker_id:me.id,change_type:"rule_update",target_key:`tier_config:${key}`,old_value:old.data||null,new_value:saved.data});
   return NextResponse.json({ok:true,tier:saved.data});
  }
  if(op==="save_mission"){
   const id=b.id?String(b.id):undefined; const key=String(b.mission_key||b.name||"").normalize("NFD").replace(/[\u0300-\u036f]/g,"").trim().toLowerCase().replace(/[^a-z0-9]+/g,"_").replace(/^_+|_+$/g,"");
   const actionKey=String(b.source_action_key||"").trim();
   const rule=await admin.from("worker_xp_rules").select("action_key").eq("action_key",actionKey).eq("enabled",true).maybeSingle(); if(rule.error)throw rule.error; if(!rule.data)throw new Error("MISSION_ACTION_NOT_AVAILABLE");
   const old=id?await admin.from("worker_xp_missions").select("*").eq("id",id).maybeSingle():{data:null,error:null}; if(old.error)throw old.error;
   const periods=["daily","weekly","monthly","lifetime","per_client","once"];
   const payload={...(id?{id}:{}),mission_key:key,name:String(b.name||"").trim(),description:String(b.description||"").trim(),source_action_key:actionKey,target_count:Math.max(1,Math.round(num(b.target_count))),xp_reward:Math.max(0,Math.round(num(b.xp_reward))),period:periods.includes(String(b.period))?String(b.period):"lifetime",max_claims:b.max_claims==null?null:Math.max(1,Math.round(num(b.max_claims))),unique_clients:!!b.unique_clients,delivery_mode:String(b.delivery_mode)==="automatic"?"automatic":"manual",unit_label:String(b.unit_label||"").trim()||null,active:b.active!==false,archived_at:null,display_order:Math.max(1,Math.round(num(b.display_order)||1)),updated_at:new Date().toISOString()};
   if(!payload.mission_key||!payload.name||!payload.source_action_key) throw new Error("MISSION_FIELDS_REQUIRED");
   const saved=await admin.from("worker_xp_missions").upsert(payload,{onConflict:"mission_key"}).select("*").single(); if(saved.error) throw saved.error;
   await admin.from("worker_xp_audit").insert({admin_worker_id:me.id,change_type:id?"mission_update":"mission_create",target_key:`mission:${key}`,old_value:old.data||null,new_value:saved.data});
   return NextResponse.json({ok:true,mission:saved.data});
  }
  if(op==="archive_mission"){
   const id=String(b.id||""); if(!id) throw new Error("MISSION_REQUIRED");
   const old=await admin.from("worker_xp_missions").select("*").eq("id",id).single(); if(old.error)throw old.error;
   const archived=await admin.from("worker_xp_missions").update({active:false,archived_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq("id",id).select("*").single(); if(archived.error)throw archived.error;
   await admin.from("worker_xp_audit").insert({admin_worker_id:me.id,change_type:"mission_archive",target_key:`mission:${old.data.mission_key}`,old_value:old.data,new_value:archived.data});
   return NextResponse.json({ok:true,mission:archived.data,historical_claims_preserved:true});
  }
  if(op==="toggle_mission"){
   const id=String(b.id||""); if(!id)throw new Error("MISSION_REQUIRED");
   const old=await admin.from("worker_xp_missions").select("*").eq("id",id).single(); if(old.error)throw old.error;
   const saved=await admin.from("worker_xp_missions").update({active:!!b.active,updated_at:new Date().toISOString()}).eq("id",id).select("*").single(); if(saved.error)throw saved.error;
   await admin.from("worker_xp_audit").insert({admin_worker_id:me.id,change_type:"mission_status",target_key:`mission:${old.data.mission_key}`,old_value:old.data,new_value:saved.data});
   return NextResponse.json({ok:true,mission:saved.data});
  }
  if(op==="set_mission_links"){
   const scope=String(b.scope||""); const missionId=String(b.mission_id||""); const keys=Array.isArray(b.keys)?b.keys:[]; if(!missionId||!["level","tier"].includes(scope)) throw new Error("INVALID_MISSION_LINK");
   const table=scope==="level"?"worker_xp_level_missions":"worker_xp_tier_missions"; const column=scope==="level"?"level":"tier_key";
   const cleared=await admin.from(table).delete().eq("mission_id",missionId); if(cleared.error) throw cleared.error;
   if(keys.length){const rows=keys.map((key:any,index:number)=>({[column]:scope==="level"?Math.trunc(num(key)):String(key),mission_id:missionId,availability:"permanent",display_order:index+1,active:true})); const inserted=await admin.from(table).insert(rows); if(inserted.error) throw inserted.error;}
   return NextResponse.json({ok:true});
  }
  throw new Error("INVALID_OPERATION");
 }catch(e:any){ return NextResponse.json({ok:false,error:e?.message||"ERR"},{status:400}); }
}
