import { NextResponse } from "next/server";
import { getAdminClient, workerFromRequest } from "@/lib/server/auth-worker";
import { configuredXpProgress } from "@/lib/xp-levels";
import { loadXpLevelConfiguration } from "@/lib/server/xp-level-config";
export const runtime="nodejs"; export const dynamic="force-dynamic";
const num=(v:unknown)=>Number(v)||0;

export async function GET(req:Request){
 try{
  const me=await workerFromRequest(req); if(!me)return NextResponse.json({ok:false,error:"NO_AUTH"},{status:401});
  if(me.role!=="central"&&me.role!=="admin")return NextResponse.json({ok:false,error:"FORBIDDEN"},{status:403});
  const admin=getAdminClient();
  const [walletR,rewardsR,claimsR,eventsR,levelConfig]=await Promise.all([
   admin.from("worker_coin_wallets").select("balance,updated_at").eq("worker_id",String(me.id)).maybeSingle(),
   admin.from("worker_store_rewards").select("id,name,description,category,coin_cost,icon_key,image_url,active,display_order,stock,required_level,updated_at").eq("active",true).order("display_order").order("created_at"),
   admin.from("worker_store_claims").select("id,reward_id,reward_name,category,coin_cost,status,status_note,created_at,updated_at").eq("worker_id",String(me.id)).order("created_at",{ascending:false}),
   admin.from("worker_xp_events").select("xp_amount").eq("worker_id",String(me.id)).eq("status","applied"),
   loadXpLevelConfiguration(admin),
  ]);
  for(const result of [walletR,rewardsR,claimsR,eventsR])if(result.error)throw result.error;
  const xp=(eventsR.data||[]).reduce((sum:number,row:any)=>sum+num(row.xp_amount),0);
  const level=configuredXpProgress(xp,levelConfig.levels,levelConfig.tiers).level;
  return NextResponse.json({ok:true,worker:{id:me.id,name:me.display_name},balance:num(walletR.data?.balance),level,rewards:rewardsR.data||[],claims:claimsR.data||[]});
 }catch(e:any){return NextResponse.json({ok:false,error:e?.message||"STORE_NOT_INSTALLED"},{status:500});}
}

export async function POST(req:Request){
 try{
  const me=await workerFromRequest(req); if(!me)return NextResponse.json({ok:false,error:"NO_AUTH"},{status:401});
  if(me.role!=="central"&&me.role!=="admin")return NextResponse.json({ok:false,error:"FORBIDDEN"},{status:403});
  const body=await req.json(); if(body?.op!=="claim_reward")return NextResponse.json({ok:false,error:"INVALID_OPERATION"},{status:400});
  const rewardId=String(body?.reward_id||""),operationId=String(body?.operation_id||"");
  const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if(!uuid.test(rewardId)||!uuid.test(operationId))return NextResponse.json({ok:false,error:"INVALID_CLAIM"},{status:400});
  const result=await getAdminClient().rpc("claim_worker_store_reward",{p_worker_id:String(me.id),p_reward_id:rewardId,p_operation_id:operationId});
  if(result.error){const message=String(result.error.message||"");const known=["INSUFFICIENT_COINS","REWARD_UNAVAILABLE","REWARD_OUT_OF_STOCK","LEVEL_REQUIRED","OPERATION_ID_CONFLICT"].find(x=>message.includes(x));return NextResponse.json({ok:false,error:known||"CLAIM_FAILED"},{status:409});}
  return NextResponse.json({ok:true,claim:result.data});
 }catch(e:any){return NextResponse.json({ok:false,error:e?.message||"CLAIM_FAILED"},{status:500});}
}
