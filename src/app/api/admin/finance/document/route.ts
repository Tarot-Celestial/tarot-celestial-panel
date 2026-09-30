import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";

export const runtime = "nodejs";
const BUCKET = "accounting-documents";
const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export async function POST(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return NextResponse.json({ ok: false, error: "FILE_REQUIRED" }, { status: 400 });
    if (!ALLOWED.has(file.type)) return NextResponse.json({ ok: false, error: "FILE_TYPE_NOT_ALLOWED" }, { status: 400 });
    if (file.size > MAX_BYTES) return NextResponse.json({ ok: false, error: "FILE_TOO_LARGE" }, { status: 400 });
    const extension = file.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "bin";
    const path = `${new Date().getUTCFullYear()}/${String(gate.me.id || "admin")}/${crypto.randomUUID()}.${extension}`;
    const { error } = await gate.admin.storage.from(BUCKET).upload(path, await file.arrayBuffer(), { contentType: file.type, upsert: false });
    if (error) throw error;
    return NextResponse.json({ ok: true, path, name: file.name, size: file.size, type: file.type });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "DOCUMENT_UPLOAD_ERROR" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const gate = await requireAdmin(req);
    if (!gate.ok) return NextResponse.json({ ok: false, error: gate.error }, { status: 403 });
    const path = String(new URL(req.url).searchParams.get("path") || "").trim();
    if (!path || path.includes("..")) return NextResponse.json({ ok: false, error: "INVALID_PATH" }, { status: 400 });
    const { data, error } = await gate.admin.storage.from(BUCKET).createSignedUrl(path, 60 * 10);
    if (error) throw error;
    return NextResponse.json({ ok: true, url: data.signedUrl });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "DOCUMENT_URL_ERROR" }, { status: 500 });
  }
}
