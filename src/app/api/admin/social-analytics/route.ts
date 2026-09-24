import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { getSocialNativeAnalytics } from "@/lib/server/social-analytics";
import type { SocialProvider } from "@/lib/server/social-connections";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  const url = new URL(req.url);
  const provider = (url.searchParams.get("provider") || "instagram") as SocialProvider;
  if (!(["instagram", "tiktok"] as string[]).includes(provider)) {
    return NextResponse.json({ ok: false, error: "INVALID_PROVIDER" }, { status: 400 });
  }
  const days = Math.max(7, Math.min(90, Number(url.searchParams.get("range") || 30) || 30));
  const db = supabaseAdmin();
  const [{ data: items, error }, { data: campaigns }, { data: connection }] = await Promise.all([
    db.from("tc_social_content").select("status,content_type,published_at,created_at").eq("provider", provider),
    db.from("tc_social_campaigns").select("id,status").eq("provider", provider),
    db.from("tc_social_connections").select("provider,username,display_name,connected_at,token_expires_at").eq("provider", provider).maybeSingle(),
  ]);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  const rows = items || [];
  const byStatus: Record<string, number> = {};
  const byType: Record<string, number> = {};
  for (const row of rows) {
    byStatus[row.status] = (byStatus[row.status] || 0) + 1;
    byType[row.content_type] = (byType[row.content_type] || 0) + 1;
  }
  let native: any = null;
  let nativeError = "";
  try {
    native = await getSocialNativeAnalytics(provider, days);
  } catch (e: any) {
    nativeError = String(e?.message || "No se pudo consultar la analítica nativa");
  }
  return NextResponse.json({
    ok: true,
    range_days: days,
    connection,
    totals: {
      content: rows.length,
      published: rows.filter((r) => r.status === "published").length,
      scheduled: rows.filter((r) => r.status === "scheduled").length,
      failed: rows.filter((r) => r.status === "failed").length,
      campaigns: (campaigns || []).length,
    },
    byStatus,
    byType,
    native,
    native_error: nativeError || null,
  });
}
