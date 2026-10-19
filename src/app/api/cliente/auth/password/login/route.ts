import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { adminSupabase, findClienteByPhoneForAuth, normalizePhoneDigits } from "@/lib/server/cliente-auth-password";
export const runtime = "nodejs";

export async function POST(req: Request) {
  const failure = () => NextResponse.json({ ok: false, error: "INVALID_LOGIN_CREDENTIALS" }, { status: 401, headers: { "Cache-Control": "no-store" } });
  try {
    const body = await req.json();
    const phone = normalizePhoneDigits(body?.phone);
    const password = String(body?.password || "");
    if (!/^[1-9]\d{6,14}$/.test(phone) || !password || password.length > 128) return failure();
    const cliente = await findClienteByPhoneForAuth(phone);
    if (!cliente?.auth_user_id) return failure();
    const admin = adminSupabase();
    const identity = await admin.auth.admin.getUserById(cliente.auth_user_id);
    const user = identity.data.user;
    if (identity.error || !user || (!user.email && !user.phone)) return failure();
    const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
    const signed = await client.auth.signInWithPassword(user.email ? { email: user.email, password } : { phone: user.phone!, password });
    if (signed.error || !signed.data.session || signed.data.user?.id !== cliente.auth_user_id) return failure();
    return NextResponse.json({ ok: true, access_token: signed.data.session.access_token, refresh_token: signed.data.session.refresh_token }, { headers: { "Cache-Control": "no-store" } });
  } catch { return failure(); }
}
