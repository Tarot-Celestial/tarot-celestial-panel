import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { publishSocialContentById, refreshTikTokStatusForContent } from "@/lib/server/social-publishing";
export const runtime="nodejs";
async function run(req:Request){
  const secret=process.env.CRON_SECRET;const auth=req.headers.get("authorization");
  if(!secret||auth!==`Bearer ${secret}`)return NextResponse.json({ok:false,error:"UNAUTHORIZED"},{status:401});
  const db=supabaseAdmin();
  const [{data:due,error},{data:processing}]=await Promise.all([
    db.from("tc_social_content").select("id").eq("status","scheduled").lte("scheduled_at",new Date().toISOString()).order("scheduled_at",{ascending:true}).limit(10),
    db.from("tc_social_content").select("id").eq("provider","tiktok").in("status",["processing","sent_to_inbox"]).not("external_publish_id","is",null).order("updated_at",{ascending:true}).limit(10),
  ]);
  if(error)return NextResponse.json({ok:false,error:error.message},{status:500});
  const results:any[]=[];
  for(const item of due||[]){try{await publishSocialContentById(item.id);results.push({id:item.id,action:"publish",ok:true});}catch(e:any){results.push({id:item.id,action:"publish",ok:false,error:e?.message||"error"});}}
  for(const item of processing||[]){try{await refreshTikTokStatusForContent(item.id);results.push({id:item.id,action:"status",ok:true});}catch(e:any){results.push({id:item.id,action:"status",ok:false,error:e?.message||"error"});}}
  return NextResponse.json({ok:true,processed:results.length,results});
}
export const GET=run;export const POST=run;
