import { timingSafeEqual } from "node:crypto";
import { getServiceClient } from "@/lib/admin/require-admin";
import { officeJson } from "@/lib/server/office-access";
import { processOfficeInstagram } from "@/lib/server/office-instagram-worker";
import { reviewAtlasPublication } from "@/lib/server/office-atlas-publication";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 300;
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const expected = Buffer.from("Bearer " + (secret || ""));
  const supplied = Buffer.from(req.headers.get("authorization") || "");
  if (!secret || supplied.length !== expected.length || !timingSafeEqual(supplied,expected)) return officeJson({ok:false},401);
  try {
    const db = getServiceClient();
    const results = await Promise.allSettled([reviewAtlasPublication(db,null),processOfficeInstagram(db,null)]);
    return results.every(result => result.status === "fulfilled") ? officeJson({ok:true}) : officeJson({ok:false},503);
  }
  catch { return officeJson({ok:false},503); }
}
