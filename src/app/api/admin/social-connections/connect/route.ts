import crypto from "crypto";
import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import {
  instagramScopes,
  isSocialProvider,
  socialRedirectUri,
  tiktokScopes,
} from "@/lib/server/social-connections";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.error === "FORBIDDEN" ? 403 : 401 });

    const body = await req.json().catch(() => ({}));
    const provider = body?.provider;
    if (!isSocialProvider(provider)) return NextResponse.json({ ok: false, error: "INVALID_PROVIDER" }, { status: 400 });

    const state = crypto.randomBytes(32).toString("hex");
    const redirectUri = socialRedirectUri(provider, req.url);
    let authUrl = "";

    if (provider === "instagram") {
      const clientId = process.env.INSTAGRAM_APP_ID;
      if (!clientId || !process.env.INSTAGRAM_APP_SECRET) {
        return NextResponse.json({ ok: false, error: "INSTAGRAM_NOT_CONFIGURED" }, { status: 409 });
      }
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: instagramScopes().join(","),
        state,
        force_reauth: "true",
      });
      authUrl = `https://www.instagram.com/oauth/authorize?${params.toString()}`;
    } else {
      const clientKey = process.env.TIKTOK_CLIENT_KEY;
      if (!clientKey || !process.env.TIKTOK_CLIENT_SECRET) {
        return NextResponse.json({ ok: false, error: "TIKTOK_NOT_CONFIGURED" }, { status: 409 });
      }
      const params = new URLSearchParams({
        client_key: clientKey,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: tiktokScopes().join(","),
        state,
      });
      authUrl = `https://www.tiktok.com/v2/auth/authorize/?${params.toString()}`;
    }

    const res = NextResponse.json({ ok: true, auth_url: authUrl });
    const cookieBase = {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax" as const,
      path: "/",
      maxAge: 60 * 10,
    };
    res.cookies.set("tc_social_oauth_state", state, cookieBase);
    res.cookies.set("tc_social_oauth_provider", provider, cookieBase);
    res.cookies.set("tc_social_oauth_admin", String(auth.me.id || ""), cookieBase);
    return res;
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "SOCIAL_CONNECT_ERROR" }, { status: 500 });
  }
}
