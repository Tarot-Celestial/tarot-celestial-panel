import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { MetaLeadError, metaLeadErrorCode, processExpandedMetaLead, processMetaLeadById, type MetaLeadPayload } from "@/lib/server/meta-leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function safeEqual(left: string, right: string) {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

function validMetaSignature(rawBody: string, signature: string | null) {
  const secret = String(process.env.META_APP_SECRET || "").trim();
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  return safeEqual(expected, signature);
}

function validInternalSecret(req: NextRequest) {
  const configured = String(process.env.META_INGEST_SECRET || "").trim();
  if (!configured) return false;
  const bearer = String(req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const header = String(req.headers.get("x-meta-ingest-secret") || "");
  return safeEqual(configured, bearer || header);
}

function leadgenChanges(body: any) {
  const changes: Array<{ leadgenId: string; pageId: string | null; formId: string | null; campaignId: string | null; adId: string | null }> = [];
  for (const entry of Array.isArray(body?.entry) ? body.entry : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      if (String(change?.field || "").toLowerCase() !== "leadgen") continue;
      const value = change?.value || {};
      const leadgenId = String(value?.leadgen_id || value?.leadgenId || "").trim();
      if (!leadgenId) continue;
      changes.push({
        leadgenId,
        pageId: String(value?.page_id || entry?.id || "").trim() || null,
        formId: String(value?.form_id || "").trim() || null,
        campaignId: String(value?.campaign_id || "").trim() || null,
        adId: String(value?.ad_id || "").trim() || null,
      });
    }
  }
  return changes;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token") || "";
  const challenge = url.searchParams.get("hub.challenge") || "";
  const expected = String(process.env.META_VERIFY_TOKEN || "").trim();
  if (mode === "subscribe" && expected && safeEqual(token, expected)) {
    return new NextResponse(challenge, { status: 200, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ ok: false, error: "VERIFY_FAILED" }, { status: 403 });
}

export async function POST(req: NextRequest) {
  const deadlineAt = Date.now() + 45000;
  const receivedAt = new Date().toISOString();
  const rawBody = await req.text();
  let body: any;
  try {
    body = rawBody ? JSON.parse(rawBody) : {};
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_JSON" }, { status: 400 });
  }

  const isMetaWebhook = body?.object === "page" && Array.isArray(body?.entry);
  if (isMetaWebhook && !validMetaSignature(rawBody, req.headers.get("x-hub-signature-256"))) {
    console.warn("META_WEBHOOK_REJECTED", { reason: "invalid_signature", receivedAt });
    return NextResponse.json({ ok: false, error: "INVALID_META_SIGNATURE" }, { status: 401 });
  }
  if (!isMetaWebhook && !validInternalSecret(req)) {
    console.warn("META_WEBHOOK_REJECTED", { reason: "missing_internal_secret", receivedAt });
    return NextResponse.json({ ok: false, error: "UNAUTHORIZED_INGEST" }, { status: 401 });
  }

  try {
    if (isMetaWebhook) {
      const changes = leadgenChanges(body);
      console.info("META_WEBHOOK_RECEIVED", { receivedAt, changes: changes.length });
      const results = [];
      const failures: Record<string, number> = {};
      let unprocessed = 0;
      for (const change of changes) {
        if (Date.now() >= deadlineAt) { unprocessed += 1; continue; }
        try {
          results.push(await processMetaLeadById(change.leadgenId, {
            deadlineAt,
            source: "meta_webhook",
            pageId: change.pageId,
            formId: change.formId,
            campaignId: change.campaignId,
            adId: change.adId,
            payload: body,
          }));
        } catch (error) {
          // A legacy/partial event needs manual recovery, but must not prevent
          // independent leads later in the same delivery from being processed.
          const code = metaLeadErrorCode(error);
          failures[code] = (failures[code] || 0) + 1;
        }
      }
      const failed = Object.values(failures).reduce((total, count) => total + count, 0);
      const ok = failed === 0 && unprocessed === 0;
      return NextResponse.json({
        ok,
        received: changes.length,
        processed: results.filter((item: any) => !item?.duplicate).length,
        duplicates: results.filter((item: any) => item?.duplicate).length,
        failed,
        unprocessed,
        failures,
      }, { status: ok ? 200 : 503 });
    }

    const expanded = body?.lead && typeof body.lead === "object" ? body.lead : body;
    const leadgenId = String(expanded?.id || expanded?.leadgen_id || body?.leadgen_id || "").trim();
    if (!leadgenId) return NextResponse.json({ ok: false, error: "META_LEAD_ID_REQUIRED" }, { status: 400 });

    if (Array.isArray(expanded?.field_data)) {
      const result = await processExpandedMetaLead({ ...expanded, id: leadgenId } as MetaLeadPayload, {
        deadlineAt,
        source: "internal_ingest",
        payload: body,
      });
      return NextResponse.json(result);
    }

    const result = await processMetaLeadById(leadgenId, { source: "internal_ingest", payload: body, deadlineAt });
    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: metaLeadErrorCode(error) }, { status: error instanceof MetaLeadError ? error.status : 503 });
  }
}
