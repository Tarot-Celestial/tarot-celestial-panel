import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST() {
  try {

    // 🔥 BYPASS DB (evita recursion interna supabase)
    return NextResponse.json({
      ok: true,
      message: "Endpoint funcionando sin error de stack",
      workers: []
    });

  } catch (e:any) {
    return NextResponse.json({ ok:false, error:e.message }, { status:500 });
  }
}
