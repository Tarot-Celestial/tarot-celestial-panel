import { NextRequest, NextResponse } from "next/server";
import { processExpandedMetaLead, type MetaLeadPayload } from "@/lib/server/meta-leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

function authorized(req: NextRequest) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}

async function loadFormLeads(formId: string) {
  const token = String(process.env.META_ACCESS_TOKEN || "").trim();
  if (!token) throw new Error("Missing env META_ACCESS_TOKEN");
  const version = String(process.env.META_GRAPH_API_VERSION || "v22.0").trim();
  const url = new URL(`https://graph.facebook.com/${version}/${formId}/leads`);
  url.searchParams.set("access_token", token);
  url.searchParams.set("limit", "100");
  url.searchParams.set("fields", "id,created_time,field_data,campaign_id,campaign_name,ad_id,ad_name,form_id,form_name,platform");

  const response = await fetch(url, { cache: "no-store" });
  const json = await response.json().catch(() => null);
  if (!response.ok) throw new Error(json?.error?.message || `Meta form fetch failed (${response.status})`);
  return Array.isArray(json?.data) ? json.data as MetaLeadPayload[] : [];
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });

  const formIds = String(process.env.META_FORM_IDS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  if (!formIds.length) {
    return NextResponse.json({ ok: false, error: "Missing env META_FORM_IDS" }, { status: 503 });
  }

  const startedAt = new Date().toISOString();
  const summary = { scanned: 0, processed: 0, duplicates: 0, failed: 0 };
  const errors: Array<{ formId: string; error: string }> = [];

  for (const formId of formIds) {
    try {
      const leads = await loadFormLeads(formId);
      summary.scanned += leads.length;
      for (const lead of leads) {
        try {
          const result = await processExpandedMetaLead(lead, {
            source: "meta_reconciliation",
            formId,
            payload: { reconciliation_started_at: startedAt },
          });
          if (result.duplicate) summary.duplicates += 1;
          else summary.processed += 1;
        } catch {
          summary.failed += 1;
        }
      }
    } catch (error: any) {
      errors.push({ formId, error: String(error?.message || "FORM_RECONCILIATION_FAILED") });
    }
  }

  console.info("META_RECONCILIATION_COMPLETE", { startedAt, ...summary, formErrors: errors.length });
  return NextResponse.json({ ok: errors.length === 0, startedAt, ...summary, errors });
}
