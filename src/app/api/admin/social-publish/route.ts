import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { publishSocialContentById, refreshTikTokStatusForContent } from "@/lib/server/social-publishing";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return NextResponse.json({ ok:false, error:auth.error }, { status:401 });
    const body = await req.json().catch(() => ({}));
    if (!body.id) return NextResponse.json({ ok:false, error:"MISSING_ID" }, { status:400 });
    if (body.action === "refresh-status") return NextResponse.json({ ok:true, result:await refreshTikTokStatusForContent(body.id) });
    return NextResponse.json({ ok:true, result:await publishSocialContentById(body.id) });
  } catch (e:any) { return NextResponse.json({ ok:false, error:e?.message || "PUBLISH_ERROR" }, { status:500 }); }
}
