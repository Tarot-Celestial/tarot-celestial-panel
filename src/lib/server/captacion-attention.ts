import type { SupabaseClient } from "@supabase/supabase-js";

const DAY_MS = 24 * 60 * 60 * 1000;
const EVENT_PAGE_SIZE = 500;
type Row = Record<string, any>;

/** The same original-date/management rule powers the cards and attention API. */
export function pendingMetaSubmissionAt(lead: Row, submittedAt: string | undefined | null, now: number): number {
  const submitted = submittedAt ? Date.parse(submittedAt) : NaN;
  if (!Number.isFinite(submitted) || submitted <= 0 || submitted > now || now - submitted >= DAY_MS) return 0;
  if ([lead.last_contact_at, lead.contacted_at, lead.closed_at].some(value => {
    const managed = value ? Date.parse(value) : NaN;
    return Number.isFinite(managed) && managed >= submitted;
  })) return 0;
  return submitted;
}

/** Read every page before deduplication: repeat forms must not hide arrivals. */
export async function recentMetaSubmissions(supabase: SupabaseClient, now: number) {
  const latest = new Map<string, string>();
  const from = new Date(now - DAY_MS).toISOString();
  const to = new Date(now).toISOString();
  for (let page = 0; ; page++) {
    const { data, error } = await supabase.from("meta_lead_events")
      .select("captacion_lead_id,meta_created_at")
      .eq("status", "processed")
      .gte("meta_created_at", from).lte("meta_created_at", to)
      .order("meta_created_at", { ascending: false }).order("leadgen_id", { ascending: false })
      .range(page * EVENT_PAGE_SIZE, (page + 1) * EVENT_PAGE_SIZE - 1);
    if (error || !Array.isArray(data)) throw new Error("ATTENTION_UNAVAILABLE");
    for (const event of data) {
      const id = String(event.captacion_lead_id || "");
      const timestamp = Date.parse(event.meta_created_at);
      if (!id || !Number.isFinite(timestamp) || timestamp <= now - DAY_MS || timestamp > now) continue;
      const previous = latest.get(id);
      if (!previous || timestamp > Date.parse(previous)) latest.set(id, new Date(timestamp).toISOString());
    }
    if (data.length < EVENT_PAGE_SIZE) return latest;
  }
}
