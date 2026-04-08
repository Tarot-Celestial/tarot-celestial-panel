import { NextRequest, NextResponse } from "next/server";
import { fetchMetaLeadById, ingestMetaLead } from "@/lib/server/meta-leads";

export const runtime = "nodejs";

function getVerifyToken() {
  const token = process.env.META_VERIFY_TOKEN;
  if (!token) throw new Error("Missing env META_VERIFY_TOKEN");
  return token;
}

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("hub.mode");
    const token = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge") || "";

    if (mode === "subscribe" && token === getVerifyToken()) {
      return new NextResponse(challenge, { status: 200 });
    }

    return NextResponse.json({ ok: false, error: "VERIFY_FAILED" }, { status: 403 });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "VERIFY_FAILED" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null);
    const entries = Array.isArray(body?.entry) ? body.entry : [];

    const ingested: any[] = [];

    for (const entry of entries) {
      const changes = Array.isArray(entry?.changes) ? entry.changes : [];
      for (const change of changes) {
        if (String(change?.field || "") !== "leadgen") continue;

        const leadgenId = String(change?.value?.leadgen_id || "").trim();
        if (!leadgenId) continue;

        const lead = await fetchMetaLeadById(leadgenId);
        const result = await ingestMetaLead(lead, {
          sourceLabel: "facebook_ads",
          rawWebhookBody: body,
          metaContext: {
            page_id: entry?.id || change?.value?.page_id || null,
            adgroup_id: change?.value?.adgroup_id || null,
            form_id: change?.value?.form_id || null,
          },
        });

        ingested.push({
          leadgen_id: leadgenId,
          cliente_id: result?.cliente?.id || null,
          full_name: result?.fullName || null,
          is_new: !!result?.isNew,
        });
      }
    }

    return NextResponse.json({ ok: true, ingested_count: ingested.length, ingested });
  } catch (error: any) {
    console.error("META LEADS WEBHOOK ERROR", error);
    return NextResponse.json({ ok: false, error: error?.message || "WEBHOOK_ERROR" }, { status: 500 });
  }
}
