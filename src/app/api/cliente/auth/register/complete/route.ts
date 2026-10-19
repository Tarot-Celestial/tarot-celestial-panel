import { NextResponse } from "next/server";
import { RegistrationError, completeRegistration } from "@/lib/server/cliente-registration";
export const runtime = "nodejs";
export async function POST(req: Request) {
  try {
    if (Number(req.headers.get("content-length") || 0) > 8000) return NextResponse.json({ ok: false, error: "DATOS_INCOMPLETOS" }, { status: 413 });
    return NextResponse.json(await completeRegistration(await req.json()), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof RegistrationError ? error.message : "REGISTRATION_UNAVAILABLE" }, { status: error instanceof RegistrationError ? error.status : 503, headers: { "Cache-Control": "no-store" } });
  }
}
