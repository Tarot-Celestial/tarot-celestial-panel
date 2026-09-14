import { NextResponse } from "next/server";
import { storeAccess } from "@/lib/server/store-access";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    const { admin, me } = await storeAccess(req, true);
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size || file.size > 3 * 1024 * 1024) throw new Error("Selecciona una imagen de hasta 3 MB.");
    const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
    const extension = extensions[file.type];
    if (!extension) throw new Error("Usa una imagen JPG, PNG o WebP.");
    const bytes = new Uint8Array(await file.arrayBuffer());
    const valid = extension === "jpg" ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 : extension === "png" ? bytes.slice(0,8).join() === "137,80,78,71,13,10,26,10" : String.fromCharCode(...bytes.slice(0,4)) === "RIFF" && String.fromCharCode(...bytes.slice(8,12)) === "WEBP";
    if (!valid) throw new Error("El archivo no corresponde al formato de imagen.");
    const path = `${me.id}/${crypto.randomUUID()}.${extension}`;
    const bucket = admin.storage.from("worker-store-images");
    const uploaded = await bucket.upload(path, bytes, { contentType: file.type, upsert: false });
    if (uploaded.error) throw uploaded.error;
    return NextResponse.json({ ok: true, image_url: bucket.getPublicUrl(path).data.publicUrl });
  } catch (e: any) { return NextResponse.json({ ok: false, error: e.message }, { status: e.status || 400 }); }
}
