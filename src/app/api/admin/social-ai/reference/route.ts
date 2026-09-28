import { NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { requireAdmin } from "@/lib/admin/require-admin";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export async function POST(req: Request) {
  const auth = await requireAdmin(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: 401 });
  try {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Selecciona una imagen válida." }, { status: 400 });
    if (!ALLOWED.has(file.type)) return NextResponse.json({ ok: false, error: "Formato no admitido. Usa PNG, JPG o WebP." }, { status: 400 });
    if (file.size <= 0 || file.size > 12 * 1024 * 1024) return NextResponse.json({ ok: false, error: "La referencia debe pesar menos de 12 MB." }, { status: 400 });

    const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
    const bucket = process.env.SOCIAL_MEDIA_BUCKET?.trim() || "tc-social-media";
    const storagePath = `references/${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
    const buffer = Buffer.from(await file.arrayBuffer());
    const db = supabaseAdmin();
    const { error } = await db.storage.from(bucket).upload(storagePath, buffer, {
      contentType: file.type,
      cacheControl: "31536000",
      upsert: false,
    });
    if (error) throw new Error(`No se pudo guardar la referencia: ${error.message}`);
    const { data } = db.storage.from(bucket).getPublicUrl(storagePath);
    if (!data?.publicUrl) throw new Error("Supabase no devolvió la URL pública de la referencia.");
    return NextResponse.json({ ok: true, asset: { url: data.publicUrl, path: storagePath, bucket, name: file.name, size: file.size } });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: String(error?.message || "No se pudo subir la referencia") }, { status: 500 });
  }
}
