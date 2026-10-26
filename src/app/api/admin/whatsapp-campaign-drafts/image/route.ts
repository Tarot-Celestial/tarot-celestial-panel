import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import { safeWhatsAppDraftImage, WHATSAPP_DRAFT_IMAGE_BUCKET, WHATSAPP_DRAFT_UUID } from "@/lib/whatsapp-campaign-drafts";
import { readWhatsAppDraftBody } from "@/lib/server/whatsapp-draft-body";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok || !WHATSAPP_DRAFT_UUID.test(gate.authUserId) || gate.me.user_id !== gate.authUserId || gate.me.is_active !== true) return reply({ ok: false, code: "FORBIDDEN", error: "Acceso reservado a administración." }, 403);
    let form: FormData | null = null;
    try {
      const bytes = await readWhatsAppDraftBody(req, 3 * 1024 * 1024 + 64 * 1024);
      form = await new Response(bytes as BodyInit, { headers: { "Content-Type": req.headers.get("content-type") || "" } }).formData();
    } catch (error: any) { return reply({ ok: false, code: "INVALID_IMAGE", error: "Selecciona una imagen JPG, PNG o WebP de hasta 3 MB." }, error?.message === "BODY_TOO_LARGE" ? 413 : 400); }
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 3 * 1024 * 1024) return reply({ ok: false, code: "INVALID_IMAGE", error: "Selecciona una imagen JPG, PNG o WebP de hasta 3 MB." }, 400);
    const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[file.type];
    if (!extension) return reply({ ok: false, code: "INVALID_IMAGE", error: "Usa una imagen JPG, PNG o WebP." }, 400);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const valid = extension === "jpg" ? bytes.length > 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : extension === "png" ? bytes.length > 8 && bytes.slice(0, 8).join() === "137,80,78,71,13,10,26,10" : bytes.length > 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
    if (!valid) return reply({ ok: false, code: "INVALID_IMAGE", error: "El contenido del archivo no corresponde al formato de imagen." }, 400);
    const path = `${gate.authUserId}/${crypto.randomUUID()}.${extension}`;
    const bucket = gate.admin.storage.from(WHATSAPP_DRAFT_IMAGE_BUCKET);
    const result = await bucket.upload(path, bytes, { contentType: file.type, upsert: false });
    if (result.error) throw result.error;
    const imageUrl = safeWhatsAppDraftImage(bucket.getPublicUrl(path).data.publicUrl, process.env.NEXT_PUBLIC_SUPABASE_URL);
    return reply({ ok: true, image_url: imageUrl });
  } catch { return reply({ ok: false, code: "IMAGE_UPLOAD_UNCONFIRMED", error: "No se pudo confirmar la imagen. No se ha enviado ningún mensaje ni modificado el borrador." }, 503); }
}
