import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });

    const { admin } = gate;
    const url = new URL(req.url);
    const role = String(url.searchParams.get("role") || "").trim();
    const team = String(url.searchParams.get("team") || "").trim().toLowerCase();
    const activeParam = String(url.searchParams.get("active") || "").trim().toLowerCase();
    const q = String(url.searchParams.get("q") || "").trim().toLowerCase();

    let query = admin
      .from("workers")
      .select("id, user_id, display_name, role, team, email, is_active, created_at")
      .order("display_name", { ascending: true });

    if (role) query = query.eq("role", role);
    if (team === "fuego" || team === "agua") query = query.eq("team", team);
    if (activeParam === "true") query = query.eq("is_active", true);
    if (activeParam === "false") query = query.eq("is_active", false);

    const { data: workers, error } = await query;
    if (error) throw error;

    const filtered = (workers || []).filter((w: any) => {
      if (!q) return true;
      const text = [w.display_name, w.email, w.role, w.team].filter(Boolean).join(" ").toLowerCase();
      return text.includes(q);
    });

    return NextResponse.json({ ok: true, workers: filtered });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
