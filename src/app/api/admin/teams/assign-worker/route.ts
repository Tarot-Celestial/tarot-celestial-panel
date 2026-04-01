import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabaseClient";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const { worker_id, team } = body;

    if (!worker_id || !team) {
      return NextResponse.json(
        { error: "Missing worker_id or team" },
        { status: 400 }
      );
    }

    if (!["fuego", "agua"].includes(team)) {
      return NextResponse.json(
        { error: "Invalid team" },
        { status: 400 }
      );
    }

    const { error } = await supabase
      .from("workers")
      .update({ team })
      .eq("id", worker_id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (err: any) {
    console.error("assign-worker error:", err);
    return NextResponse.json(
      { error: err.message || "Internal error" },
      { status: 500 }
    );
  }
}
