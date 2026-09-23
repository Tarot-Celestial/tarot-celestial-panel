import { NextRequest, NextResponse } from "next/server";
import { instagramScopes, saveSocialConnection, socialRedirectUri } from "@/lib/server/social-connections";

export const runtime = "nodejs";

function adminRedirect(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/admin", req.url);
  url.searchParams.set("tab", "redes-sociales");
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
  if (!code || !state || !expectedState || state !== expectedState || expectedProvider !== "instagram") {
    return adminRedirect(req, { social_error: "OAuth de Instagram no válido. Vuelve a conectar la cuenta." });
  }

  try {
    const clientId = process.env.INSTAGRAM_APP_ID;
    const clientSecret = process.env.INSTAGRAM_APP_SECRET;
    if (!clientId || !clientSecret) throw new Error("Instagram no está configurado en Vercel");
    const redirectUri = socialRedirectUri("instagram", req.url);

    const tokenForm = new FormData();
    tokenForm.set("client_id", clientId);
    tokenForm.set("client_secret", clientSecret);
    tokenForm.set("grant_type", "authorization_code");
    tokenForm.set("redirect_uri", redirectUri);
    tokenForm.set("code", code);

    const shortResponse = await fetch("https://api.instagram.com/oauth/access_token", { method: "POST", body: tokenForm, cache: "no-store" });
    const shortJson: any = await shortResponse.json().catch(() => ({}));
    if (!shortResponse.ok || !shortJson?.access_token) throw new Error(shortJson?.error_message || shortJson?.error?.message || "No se pudo obtener el token de Instagram");

    let accessToken = String(shortJson.access_token);
    let expiresIn = Number(shortJson.expires_in || 3600);
    try {
      const longUrl = new URL("https://graph.instagram.com/access_token");
      longUrl.searchParams.set("grant_type", "ig_exchange_token");
      longUrl.searchParams.set("client_secret", clientSecret);
      longUrl.searchParams.set("access_token", accessToken);
      const longResponse = await fetch(longUrl, { cache: "no-store" });
      const longJson: any = await longResponse.json().catch(() => ({}));
      if (longResponse.ok && longJson?.access_token) {
        accessToken = String(longJson.access_token);
        expiresIn = Number(longJson.expires_in || 5184000);
      }
    } catch {
      // Conservamos el token corto si Meta no permite el intercambio en este momento.
    }

    let profile: any = {};
    for (const fields of ["id,user_id,username,name,profile_picture_url", "id,username,name", "id,username"]) {
      const profileUrl = new URL("https://graph.instagram.com/me");
      profileUrl.searchParams.set("fields", fields);
      profileUrl.searchParams.set("access_token", accessToken);
      const profileResponse = await fetch(profileUrl, { cache: "no-store" });
      const candidate: any = await profileResponse.json().catch(() => ({}));
      if (profileResponse.ok && candidate?.id) {
        profile = candidate;
        break;
      }
    }

    await saveSocialConnection({
      provider: "instagram",
      accountId: String(profile?.user_id || profile?.id || shortJson?.user_id || ""),
      username: profile?.username || null,
      displayName: profile?.name || profile?.username || "Instagram",
      avatarUrl: profile?.profile_picture_url || null,
      accessToken,
      expiresIn,
      scopes: instagramScopes(),
      connectedBy,
      metadata: { api: "instagram_login", short_user_id: shortJson?.user_id || null },
    });

    return adminRedirect(req, { social_connected: "instagram" });
  } catch (error: any) {
    return adminRedirect(req, { social_error: String(error?.message || "Error conectando Instagram").slice(0, 180) });
  }
}
