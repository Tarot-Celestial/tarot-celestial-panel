import { NextResponse } from "next/server";
import { processCampaignBatch } from "@/lib/server/client-campaigns";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return NextResponse.json({ ok: false }, { status: 401 });
  try { return NextResponse.json({ ok: true, ...await processCampaignBatch() }); }
  catch (error: any) { console.error("campaign-cron", error?.code || error?.message); return NextResponse.json({ ok: false }, { status: 500 }); }
}
