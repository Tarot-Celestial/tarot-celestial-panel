import { NextResponse } from "next/server";
import { GET as baseGet } from "@/app/api/chat/threads/route";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const res = await baseGet(req);
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.ok) return NextResponse.json(body || { ok: false, error: "ERR" }, { status: res.status });

  if (body?.thread) return NextResponse.json(body, { status: res.status });

  const thread = Array.isArray(body?.threads) ? body.threads[0] || null : null;
  return NextResponse.json({ ok: true, thread, mode: body?.mode || "tarotista" }, { status: res.status });
}
