import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
const providers = new Set(["instagram", "tiktok"]);

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ ok:false, error:auth.error }, { status:401 });
  const provider = new URL(req.url).searchParams.get("provider") || "instagram";
  if (!providers.has(provider)) return NextResponse.json({ ok:false, error:"INVALID_PROVIDER" }, { status:400 });
  const { data, error } = await supabaseAdmin().from("tc_social_content").select("*").eq("provider", provider).order("created_at", { ascending:false }).limit(250);
  if (error) return NextResponse.json({ ok:false, error:error.message }, { status:500 });
  return NextResponse.json({ ok:true, items:data || [] });
}

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ ok:false, error:auth.error }, { status:401 });
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "save");
  const db = supabaseAdmin();
  if (action === "delete") {
    const { error } = await db.from("tc_social_content").delete().eq("id", body.id);
    if (error) return NextResponse.json({ ok:false, error:error.message }, { status:500 });
    return NextResponse.json({ ok:true });
  }
  if (!providers.has(body.provider)) return NextResponse.json({ ok:false, error:"INVALID_PROVIDER" }, { status:400 });
  const scheduledAt = body.scheduled_at ? new Date(body.scheduled_at).toISOString() : null;
  const status = scheduledAt ? "scheduled" : (body.status === "draft" ? "draft" : "draft");
  const row:any = {
    provider: body.provider,
    campaign_id: body.campaign_id || null,
    content_type: body.content_type || (body.provider === "instagram" ? "post" : "video"),
    title: String(body.title || "").trim() || null,
    caption: String(body.caption || "").trim() || null,
    media_urls: Array.isArray(body.media_urls) ? body.media_urls.map(String).map((v:string)=>v.trim()).filter(Boolean) : [],
    scheduled_at: scheduledAt,
    status,
    privacy_level: body.privacy_level || null,
    publish_mode: body.publish_mode || "direct",
    settings: body.settings || {},
    updated_at: new Date().toISOString(),
  };
  let query;
  if (body.id) query = db.from("tc_social_content").update(row).eq("id", body.id).select("*").single();
  else query = db.from("tc_social_content").insert({ ...row, created_by: auth.me.id }).select("*").single();
  const { data, error } = await query;
  if (error) return NextResponse.json({ ok:false, error:error.message }, { status:500 });
  return NextResponse.json({ ok:true, item:data });
}
