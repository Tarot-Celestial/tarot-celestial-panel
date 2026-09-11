import { NextResponse } from "next/server";
import { clientFromRequest } from "@/lib/server/auth-cliente";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "client-profile-photos";
const MAX_BYTES = 2_500_000;
const MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const headers = { "Cache-Control": "private, no-store" };

async function signedUrl(admin: any, path: string) {
  const { data, error } = await admin.storage.from(BUCKET).createSignedUrl(path, 60 * 60);
  if (error) throw error;
  return data?.signedUrl || null;
}

export async function POST(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401, headers });
    if (!gate.cliente) return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404, headers });

    const form = await req.formData();
    const file = form.get("avatar");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "Selecciona una fotografía." }, { status: 400, headers });
    if (!MIME_TYPES.has(file.type)) return NextResponse.json({ ok: false, error: "Usa una imagen JPG, PNG o WebP." }, { status: 415, headers });
    if (!file.size || file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: "La fotografía debe ocupar menos de 2,5 MB." }, { status: 413, headers });

    const extension = file.type === "image/png" ? "png" : file.type === "image/jpeg" ? "jpg" : "webp";
    const path = `${gate.cliente.id}/avatar.${extension}`;
    const previous = String(gate.cliente.avatar_path || "");
    const { error: uploadError } = await gate.admin.storage.from(BUCKET).upload(path, await file.arrayBuffer(), {
      contentType: file.type,
      cacheControl: "3600",
      upsert: true,
    });
    if (uploadError) throw uploadError;

    const { error: updateError } = await gate.admin.from("crm_clientes").update({ avatar_path: path, updated_at: new Date().toISOString() }).eq("id", gate.cliente.id);
    if (updateError) throw updateError;
    if (previous && previous !== path) await gate.admin.storage.from(BUCKET).remove([previous]);

    return NextResponse.json({ ok: true, avatar_url: await signedUrl(gate.admin, path) }, { headers });
  } catch (error: any) {
    console.error("[cliente-perfil:avatar]", { code: error?.code, message: error?.message });
    return NextResponse.json({ ok: false, error: "No hemos podido guardar la fotografía. Inténtalo de nuevo." }, { status: 500, headers });
  }
}

export async function DELETE(req: Request) {
  try {
    const gate = await clientFromRequest(req);
    if (!gate.uid) return NextResponse.json({ ok: false, error: "NO_AUTH" }, { status: 401, headers });
    if (!gate.cliente) return NextResponse.json({ ok: false, error: "CLIENTE_NO_ENCONTRADO" }, { status: 404, headers });
    const previous = String(gate.cliente.avatar_path || "");
    const { error } = await gate.admin.from("crm_clientes").update({ avatar_path: null, updated_at: new Date().toISOString() }).eq("id", gate.cliente.id);
    if (error) throw error;
    if (previous) await gate.admin.storage.from(BUCKET).remove([previous]);
    return NextResponse.json({ ok: true }, { headers });
  } catch (error: any) {
    console.error("[cliente-perfil:avatar-delete]", { code: error?.code, message: error?.message });
    return NextResponse.json({ ok: false, error: "No hemos podido eliminar la fotografía." }, { status: 500, headers });
  }
}
