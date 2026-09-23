import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { supabaseAdmin } from "@/lib/supabase-admin";
export const runtime = "nodejs";
export async function GET(req: Request) {
  const auth = await requireAdmin(req); if (!auth.ok) return NextResponse.json({ok:false,error:auth.error},{status:401});
  const provider = new URL(req.url).searchParams.get("provider") || "instagram";
  const {data,error}=await supabaseAdmin().from("tc_social_campaigns").select("*").eq("provider",provider).order("created_at",{ascending:false});
  if(error)return NextResponse.json({ok:false,error:error.message},{status:500}); return NextResponse.json({ok:true,items:data||[]});
}
export async function POST(req: Request) {
  const auth=await requireAdmin(req); if(!auth.ok)return NextResponse.json({ok:false,error:auth.error},{status:401});
  const body=await req.json().catch(()=>({})); const db=supabaseAdmin();
  if(body.action==="delete"){const {error}=await db.from("tc_social_campaigns").delete().eq("id",body.id); if(error)return NextResponse.json({ok:false,error:error.message},{status:500}); return NextResponse.json({ok:true});}
  const row={provider:body.provider,name:String(body.name||"").trim(),objective:String(body.objective||"").trim()||null,status:body.status||"draft",starts_at:body.starts_at?new Date(body.starts_at).toISOString():null,ends_at:body.ends_at?new Date(body.ends_at).toISOString():null,notes:String(body.notes||"").trim()||null,updated_at:new Date().toISOString()};
  const q=body.id?db.from("tc_social_campaigns").update(row).eq("id",body.id).select("*").single():db.from("tc_social_campaigns").insert({...row,created_by:auth.me.id}).select("*").single(); const {data,error}=await q;
  if(error)return NextResponse.json({ok:false,error:error.message},{status:500}); return NextResponse.json({ok:true,item:data});
}
