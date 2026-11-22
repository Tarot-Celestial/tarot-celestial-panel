import { getServiceClient } from "@/lib/admin/require-admin";
import { officeHeaders, officeUuid } from "@/lib/server/office-access";
import { loadInstagramVersion } from "@/lib/server/office-instagram-media";
import { validOfficeMediaUrl } from "@/lib/server/office-instagram-link";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const unavailable = () => new Response(null, { status: 404, headers: officeHeaders });
async function serve(req: Request) {
  try {
    const p = new URL(req.url).searchParams;
    const id = p.get("id"), sha = p.get("sha") || "";
    if (!officeUuid(id) || !validOfficeMediaUrl(id, sha, p.get("exp") || "", p.get("sig") || "")) return unavailable();
    const db = getServiceClient();
    const { data, error } = await db.from("office_instagram_posts").select("version_id,media_sha256,status").eq("id", id).maybeSingle();
    if (error || !data || data.media_sha256 !== sha || !["preparing","container_ready","dispatching","verifying"].includes(data.status)) return unavailable();
    const { media } = await loadInstagramVersion(db, data.version_id);
    if (media.sha !== sha) return unavailable();
    let start = 0, end = media.bytes.length - 1;
    const range = req.headers.get("range");
    const headers = new Headers({ ...officeHeaders, "Content-Type": media.type, "Accept-Ranges": "bytes", "X-Robots-Tag": "noindex, noarchive" });
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) return new Response(null, { status: 416, headers });
      if (!match[1]) start = Math.max(0, media.bytes.length - Number(match[2]));
      else { start = Number(match[1]); end = match[2] ? Math.min(end, Number(match[2])) : end; }
      if (start > end || start >= media.bytes.length) {
        headers.set("Content-Range", "bytes */" + media.bytes.length);
        return new Response(null, { status: 416, headers });
      }
      headers.set("Content-Range", `bytes ${start}-${end}/${media.bytes.length}`);
    }
    headers.set("Content-Length", String(end - start + 1));
    return new Response(req.method === "HEAD" ? null : new Uint8Array(media.bytes.subarray(start,end+1)), { status: range ? 206 : 200, headers });
  } catch { return unavailable(); }
}
export const GET = serve;
export const HEAD = serve;
