import { createHmac, timingSafeEqual } from "node:crypto";

const ttl = 2 * 3600;
function signature(id: string, digest: string, expires: string) {
  const key = process.env.CRON_SECRET;
  if (!key) throw new Error("No se pudo preparar el acceso temporal al archivo.");
  return createHmac("sha256", key).update(["office-instagram-media-v1", id, digest, expires].join("\n")).digest("hex");
}
export function officeMediaUrl(id: string, digest: string) {
  const expires = String(Math.floor(Date.now() / 1000) + ttl);
  const url = new URL("/api/office/instagram-media", "https://nextjs-boilerplate-one-azure-28.vercel.app");
  url.search = new URLSearchParams({ id, sha: digest, exp: expires, sig: signature(id, digest, expires) }).toString();
  return url.href;
}
export function validOfficeMediaUrl(id: string, digest: string, expires: string, sig: string) {
  const now = Math.floor(Date.now() / 1000);
  if (!/^[a-f\d]{64}$/.test(digest) || !/^[a-f\d]{64}$/.test(sig) || !/^\d{10}$/.test(expires) || +expires <= now || +expires > now + ttl + 10) return false;
  return timingSafeEqual(Buffer.from(signature(id, digest, expires), "hex"), Buffer.from(sig, "hex"));
}
