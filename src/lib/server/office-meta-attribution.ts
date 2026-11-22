import { createHash, createHmac, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

type Admin = Pick<SupabaseClient, "rpc">;
export const validPanelRef = (value: string) => /^[a-f0-9]{24}$/.test(value);
export const metaPanelCookie = (ref:string) => "tc_meta_panel_v1_"+ref;
export const validPanelToken = (token: string) => /^[A-Za-z0-9_-]{43}$/.test(token);
export const tokenDigest = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
export type MetaPanelDestination = "panel" | "oracle";

export async function getMetaPanelLink(admin: Admin, opportunityId: string, siteOrigin: string, destination: MetaPanelDestination = "panel") {
  const url = new URL(siteOrigin);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(local && url.protocol === "http:")) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("META_PANEL_ORIGIN_INVALID");
  }
  const token = randomBytes(32).toString("base64url");
  const result = await admin.rpc("office_meta_panel_issue", { p_opportunity: opportunityId, p_digest: tokenDigest(token), p_destination: destination });
  if (result.error || result.data !== true) throw new Error("META_PANEL_LINK_UNAVAILABLE");
  return new URL("/cliente/meta/" + token, url).toString();
}

export async function confirmMetaPanelCode(admin: Admin, opportunityId: string, providerMessageId: string, text: string): Promise<"not_code"|"confirmed"|"unmatched"> {
  const code = text.trim().toUpperCase();
  if (!/^TC-[0-9A-F]{12}$/.test(code)) return "not_code";
  const result = await admin.rpc("office_meta_panel_confirm", { p_opportunity: opportunityId, p_source_id: providerMessageId, p_code: code });
  if (result.error) throw new Error("META_PANEL_PROOF_UNAVAILABLE");
  return result.data === true ? "confirmed" : "unmatched";
}

export function makeMetaPanelCode(token: string, user: string, now = Date.now()) {
  const secret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("META_PANEL_PROOF_UNAVAILABLE");
  const epoch = Math.floor(now / (15 * 60 * 1000));
  const hex = createHmac("sha256", secret).update(JSON.stringify(["tc-meta-dm-proof-v1",token,user,epoch])).digest("hex");
  return "TC-" + hex.slice(0,12).toUpperCase();
}
