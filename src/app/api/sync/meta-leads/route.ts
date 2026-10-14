import { NextRequest, NextResponse } from "next/server";
import { metaGraphRequest, metaLeadErrorCode, processExpandedMetaLead, type MetaLeadPayload } from "@/lib/server/meta-leads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;
export const maxDuration = 60;

// A truncated run needs operator attention/backfill, not a healthy status.
const WINDOW_HOURS = 24;
const MAX_FORMS = 10;
const MAX_PAGES_PER_FORM = 3;
const PAGE_SIZE = 50;
const MAX_SCANNED = 200;
const BUDGET_MS = 45000;

function authorized(req: NextRequest) {
  const secret = String(process.env.CRON_SECRET || "").trim();
  return Boolean(secret) && req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
  const formIds = [...new Set(String(process.env.META_FORM_IDS || "").split(",").map(value => value.trim()).filter(Boolean))];
  const missing = [!formIds.length && "META_FORM_IDS", !String(process.env.META_ACCESS_TOKEN || "").trim() && "META_ACCESS_TOKEN"].filter(Boolean);
  if (missing.length) return NextResponse.json({ ok: false, error: "META_CONFIGURATION_INCOMPLETE", missing }, { status: 503 });
  if (formIds.some(id => !/^\d+$/.test(id))) return NextResponse.json({ ok: false, error: "META_FORM_IDS_INVALID" }, { status: 503 });

  const started = Date.now();
  const startedAt = new Date(started).toISOString();
  const deadlineAt = started + BUDGET_MS;
  const since = started - WINDOW_HOURS * 3600000;
  const summary = { scanned: 0, processed: 0, duplicates: 0, failed: 0, manualReview: 0, outsideWindow: 0, pages: 0 };
  const errors: Array<{ formId: string; error: string }> = [];
  let truncated = formIds.length > MAX_FORMS;
  const exhausted = () => Date.now() >= deadlineAt || summary.scanned >= MAX_SCANNED;

  for (const formId of formIds.slice(0, MAX_FORMS)) {
    if (exhausted()) { truncated = true; break; }
    let after: string | undefined;
    const seenCursors = new Set<string>();
    try {
      for (let page = 0; page < MAX_PAGES_PER_FORM; page += 1) {
        if (exhausted()) { truncated = true; break; }
        // Rebuild the URL. Never follow paging.next or its embedded credentials;
        // only an opaque cursor goes to the fixed Graph host. No assumed order.
        const json = await metaGraphRequest(`${formId}/leads`, {
          limit: String(PAGE_SIZE),
          fields: "id,created_time,field_data,campaign_id,campaign_name,ad_id,ad_name,form_id,form_name,platform",
          ...(after ? { after } : {}),
        }, deadlineAt);
        if (!Array.isArray(json.data)) {
          errors.push({ formId, error: "META_GRAPH_INVALID_LEAD_PAGE" });
          break;
        }
        summary.pages += 1;
        for (const lead of json.data as MetaLeadPayload[]) {
          if (exhausted()) { truncated = true; break; }
          summary.scanned += 1;
          const created = Date.parse(String(lead?.created_time || ""));
          if (!Number.isFinite(created)) { summary.failed += 1; continue; }
          if (created < since || created > started + 300000) { summary.outsideWindow += 1; continue; }
          try {
            const result = await processExpandedMetaLead(lead, {
              source: "meta_reconciliation", formId, deadlineAt,
              payload: { reconciliation_started_at: startedAt },
            });
            if (result.duplicate) summary.duplicates += 1;
            else summary.processed += 1;
          } catch (error) {
            summary.failed += 1;
            if (metaLeadErrorCode(error) === "META_MANUAL_RECONCILIATION_REQUIRED") summary.manualReview += 1;
          }
        }
        if (exhausted() && (json.paging?.next || summary.scanned >= MAX_SCANNED)) { truncated = true; break; }
        if (!json.paging?.next) break;
        const cursor = json.paging?.cursors?.after;
        if (typeof cursor !== "string" || !cursor || cursor.length > 2048 || seenCursors.has(cursor)) {
          errors.push({ formId, error: "META_GRAPH_CURSOR_INVALID" });
          truncated = true;
          break;
        }
        seenCursors.add(cursor);
        after = cursor;
        if (page === MAX_PAGES_PER_FORM - 1) truncated = true;
      }
    } catch (error) {
      errors.push({ formId, error: metaLeadErrorCode(error) });
    }
  }

  const ok = !truncated && summary.failed === 0 && errors.length === 0;
  const backlog = truncated ? "BOUNDED_SCAN_INCOMPLETE" : summary.manualReview ? "MANUAL_RECONCILIATION_REQUIRED" : null;
  console.info("META_RECONCILIATION_COMPLETE", { startedAt, ...summary, ok, truncated, formErrors: errors.length });
  return NextResponse.json({ ok, startedAt, windowHours: WINDOW_HOURS, ...summary, truncated, backlog, errors }, { status: ok ? 200 : 503 });
}
