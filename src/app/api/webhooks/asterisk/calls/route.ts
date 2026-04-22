import { NextResponse } from "next/server";
import { getEnv, handleAsteriskCallWebhook } from "@/lib/server/asterisk-calls";

export const runtime = "nodejs";

async function parseRequestBody(req: Request) {
  const contentType = String(req.headers.get("content-type") || "").toLowerCase();

  if (contentType.includes("application/json")) {
    return (await req.json().catch(() => ({}))) as Record<string, any>;
  }

  if (contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")) {
    const form = await req.formData().catch(() => null);
    const body: Record<string, any> = {};
    if (!form) return body;
    for (const [key, value] of form.entries()) body[key] = typeof value === "string" ? value : String(value);
    return body;
  }

  const raw = await req.text().catch(() => "");
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    const params = new URLSearchParams(raw);
    const body: Record<string, any> = {};
    for (const [key, value] of params.entries()) body[key] = value;
    return body;
  }
}

function isAuthorized(req: Request) {
  const expected = getEnv("ASTERISK_WEBHOOK_SECRET");
  const auth = String(req.headers.get("authorization") || "");
  const bearer = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  const header = String(req.headers.get("x-asterisk-secret") || "").trim();
  const query = new URL(req.url).searchParams.get("secret") || "";
  return [bearer, header, query].some((value) => value && value === expected);
}

export async function POST(req: Request) {
  try {
    if (!isAuthorized(req)) {
      return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    }

    const body = await parseRequestBody(req);
    const result = await handleAsteriskCallWebhook(body);
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || "ERR_ASTERISK_WEBHOOK" }, { status: 500 });
  }
}
