import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getSocialConnections } from "@/lib/server/social-connections";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.error === "FORBIDDEN" ? 403 : 401 });

    const rows = await getSocialConnections();
    const byProvider = Object.fromEntries(rows.map((row: any) => [row.provider, row]));

    // Diagnóstico seguro: nunca devuelve tokens ni secretos. Sirve para distinguir
    // "OAuth correcto" de "tabla/permisos/entorno Supabase incorrectos".
    const db = supabaseAdmin();
    const { count, error: countError } = await db
      .from("tc_social_connections")
      .select("provider", { count: "exact", head: true });

    return NextResponse.json({
      ok: true,
      connections: {
        instagram: byProvider.instagram || null,
        tiktok: byProvider.tiktok || null,
      },
      configured: {
        instagram: Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET),
        tiktok: Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET),
      },
      storage: {
        table: "tc_social_connections",
        readable: !countError,
        rows: countError ? null : (count ?? 0),
        error: countError ? countError.message : null,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "SOCIAL_STATUS_ERROR" }, { status: 500 });
  }
}
