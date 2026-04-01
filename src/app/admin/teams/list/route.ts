import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });

    const { data: workers, error } = await gate.admin
      .from("workers")
      .select("id, display_name, role, team, is_active")
      .in("team", ["fuego", "agua"])
      .order("display_name", { ascending: true });

    if (error) throw error;

    const teams = ["fuego", "agua"].map((team) => {
      const members = (workers || []).filter((w: any) => String(w.team || "") === team);
      return {
        key: team,
        label: team === "fuego" ? "Fuego" : "Agua",
        total_workers: members.length,
        active_workers: members.filter((m: any) => !!m.is_active).length,
        members,
      };
    });

    return NextResponse.json({ ok: true, teams });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR" }, { status: 500 });
  }
}
