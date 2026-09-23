import { NextRequest, NextResponse } from "next/server";
import { saveSocialConnection, socialRedirectUri, tiktokScopes } from "@/lib/server/social-connections";

export const runtime = "nodejs";

function adminRedirect(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/admin", req.url);
  url.searchParams.set("tab", "redes-sociales-tiktok");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = NextResponse.redirect(url);
  res.cookies.delete("tc_social_oauth_state");
  res.cookies.delete("tc_social_oauth_provider");
  res.cookies.delete("tc_social_oauth_admin");
  return res;
}

export async function GET(req: NextRequest) {
  const expectedState = req.cookies.get("tc_social_oauth_state")?.value;
  const expectedProvider = req.cookies.get("tc_social_oauth_provider")?.value;
  const connectedBy = req.cookies.get("tc_social_oauth_admin")?.value || null;
  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  const oauthError = req.nextUrl.searchParams.get("error_description") || req.nextUrl.searchParams.get("error");

  if (oauthError) return adminRedirect(req, { social_error: oauthError.slice(0, 180) });
  if (!code || !state || !expectedState || state !== expectedState || expectedProvider !== "tiktok") {
    return adminRedirect(req, { social_error: "OAuth de TikTok no válido. Vuelve a conectar la cuenta." });
  }

  try {
    const clientKey = process.env.TIKTOK_CLIENT_KEY;
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET;
    if (!clientKey || !clientSecret) throw new Error("TikTok no está configurado en Vercel");
    const redirectUri = socialRedirectUri("tiktok", req.url);

    const form = new URLSearchParams();
    form.set("client_key", clientKey);
    form.set("client_secret", clientSecret);
    form.set("code", code);
    form.set("grant_type", "authorization_code");
    form.set("redirect_uri", redirectUri);

    const tokenResponse = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
      cache: "no-store",
    });
    const tokenJson: any = await tokenResponse.json().catch(() => ({}));
    if (!tokenResponse.ok || !tokenJson?.access_token) throw new Error(tokenJson?.error_description || tokenJson?.message || "No se pudo obtener el token de TikTok");

    const accessToken = String(tokenJson.access_token);
    let profile: any = {};
    for (const fields of ["open_id,union_id,avatar_url,display_name,username", "open_id,avatar_url,display_name"]) {
      const userUrl = new URL("https://open.tiktokapis.com/v2/user/info/");
      userUrl.searchParams.set("fields", fields);
      const userResponse = await fetch(userUrl, {
        headers: { Authorization: `Bearer ${accessToken}` },
        cache: "no-store",
      });
      const userJson: any = await userResponse.json().catch(() => ({}));
      if (userResponse.ok && userJson?.data?.user) {
        profile = userJson.data.user;
        break;
      }
    }

    const grantedScopes = String(tokenJson.scope || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    await saveSocialConnection({
      provider: "tiktok",
      accountId: String(profile?.open_id || tokenJson?.open_id || ""),
      username: profile?.username || null,
      displayName: profile?.display_name || profile?.username || "TikTok",
      avatarUrl: profile?.avatar_url || null,
      accessToken,
      refreshToken: tokenJson?.refresh_token || null,
      expiresIn: Number(tokenJson?.expires_in || 0),
      refreshExpiresIn: Number(tokenJson?.refresh_expires_in || 0),
      scopes: grantedScopes.length ? grantedScopes : tiktokScopes(),
      connectedBy,
      metadata: { api: "tiktok_v2", open_id: profile?.open_id || tokenJson?.open_id || null },
    });

    return adminRedirect(req, { social_connected: "tiktok" });
  } catch (error: any) {
    return adminRedirect(req, { social_error: String(error?.message || "Error conectando TikTok").slice(0, 180) });
  }
}
