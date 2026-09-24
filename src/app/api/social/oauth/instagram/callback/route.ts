import { NextRequest, NextResponse } from "next/server";
import {
  instagramScopes,
  saveSocialConnection,
  socialRedirectUri,
  verifySocialOAuthState,
} from "@/lib/server/social-connections";

export const runtime = "nodejs";

function adminRedirect(req: NextRequest, params: Record<string, string>) {
  const url = new URL("/admin", req.url);
  url.searchParams.set("tab", "redes-sociales-instagram");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = NextResponse.redirect(url);
  res.cookies.delete("tc_social_oauth_state");
  res.cookies.delete("tc_social_oauth_provider");
  res.cookies.delete("tc_social_oauth_admin");
  return res;
}

function uuidOrNull(value: unknown) {
  const text = String(value || "").trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(text) ? text : null;
}

export async function GET(req: NextRequest) {
  const state = req.nextUrl.searchParams.get("state");
  const code = req.nextUrl.searchParams.get("code");
  const oauthError = req.nextUrl.searchParams.get("error_description") || req.nextUrl.searchParams.get("error");

  if (oauthError) return adminRedirect(req, { social_error: `Instagram: ${oauthError}`.slice(0, 220) });
  if (!code) return adminRedirect(req, { social_error: "Instagram no devolvió el código OAuth. Vuelve a pulsar Conectar Instagram." });

  // Verificación principal mediante state firmado. Las cookies quedan solo como compatibilidad/fallback.
  const signedState = verifySocialOAuthState(state, "instagram");
  const cookieState = req.cookies.get("tc_social_oauth_state")?.value;
  const cookieProvider = req.cookies.get("tc_social_oauth_provider")?.value;
  const cookieOk = Boolean(state && cookieState && state === cookieState && cookieProvider === "instagram");
  if (!signedState && !cookieOk) {
    return adminRedirect(req, { social_error: "La sesión OAuth de Instagram no se pudo validar. Pulsa Conectar Instagram de nuevo desde el panel." });
  }

  const connectedBy = uuidOrNull(signedState?.adminId || req.cookies.get("tc_social_oauth_admin")?.value);

  try {
    const clientId = process.env.INSTAGRAM_APP_ID?.trim();
    const clientSecret = process.env.INSTAGRAM_APP_SECRET?.trim();
    if (!clientId || !clientSecret) throw new Error("Faltan INSTAGRAM_APP_ID o INSTAGRAM_APP_SECRET en Vercel");
    const redirectUri = socialRedirectUri("instagram", req.url);

    const tokenForm = new FormData();
    tokenForm.set("client_id", clientId);
    tokenForm.set("client_secret", clientSecret);
    tokenForm.set("grant_type", "authorization_code");
    tokenForm.set("redirect_uri", redirectUri);
    tokenForm.set("code", code);

    const shortResponse = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      body: tokenForm,
      cache: "no-store",
    });
    const shortJson: any = await shortResponse.json().catch(() => ({}));
    if (!shortResponse.ok || !shortJson?.access_token) {
      const detail = shortJson?.error_message || shortJson?.error?.message || shortJson?.message || `HTTP ${shortResponse.status}`;
      throw new Error(`Meta no pudo intercambiar el código OAuth: ${detail}`);
    }

    let accessToken = String(shortJson.access_token);
    let expiresIn = Number(shortJson.expires_in || 3600);

    // Intentamos convertirlo a token de larga duración. Si Meta no lo permite en ese instante,
    // conservamos el token corto y la conexión sigue siendo válida.
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
      // Conservamos el token corto.
    }

    let profile: any = {};
    let profileError = "";
    for (const fields of ["id,username,name,profile_picture_url", "id,username,name", "id,username", "id"]) {
      const profileUrl = new URL("https://graph.instagram.com/me");
      profileUrl.searchParams.set("fields", fields);
      profileUrl.searchParams.set("access_token", accessToken);
      const profileResponse = await fetch(profileUrl, { cache: "no-store" });
      const candidate: any = await profileResponse.json().catch(() => ({}));
      if (profileResponse.ok && candidate?.id) {
        profile = candidate;
        break;
      }
      profileError = candidate?.error?.message || candidate?.message || `HTTP ${profileResponse.status}`;
    }

    const accountId = String(profile?.id || shortJson?.user_id || "").trim();
    if (!accountId) {
      throw new Error(`Instagram autorizó la aplicación, pero no devolvió el ID de la cuenta${profileError ? `: ${profileError}` : ""}`);
    }

    const savedConnection = await saveSocialConnection({
      provider: "instagram",
      accountId,
      username: profile?.username || null,
      displayName: profile?.name || profile?.username || "Instagram",
      avatarUrl: profile?.profile_picture_url || null,
      accessToken,
      expiresIn,
      scopes: instagramScopes(),
      connectedBy,
      metadata: {
        api: "instagram_login",
        oauth_user_id: shortJson?.user_id || null,
        redirect_uri: redirectUri,
      },
    });

    if (!savedConnection?.provider || savedConnection.provider !== "instagram") {
      throw new Error("Instagram autorizó la cuenta pero no se pudo confirmar la persistencia en Supabase.");
    }
    return adminRedirect(req, { social_connected: "instagram" });
  } catch (error: any) {
    return adminRedirect(req, { social_error: String(error?.message || "Error conectando Instagram").slice(0, 220) });
  }
}
