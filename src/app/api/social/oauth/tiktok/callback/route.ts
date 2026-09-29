import { NextRequest, NextResponse } from "next/server";
import {
  encodeSocialRecovery,
  getSocialConnections,
  saveSocialConnection,
  socialRedirectUri,
  tiktokScopes,
  verifySocialOAuthState,
} from "@/lib/server/social-connections";

export const runtime = "nodejs";

function adminRedirect(req: NextRequest, params: Record<string, string>, recoveryCookie?: string | null) {
  const url = new URL("/admin", req.url);
  url.searchParams.set("tab", "redes-sociales-tiktok");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const res = NextResponse.redirect(url);
  res.cookies.delete("tc_social_oauth_state");
  res.cookies.delete("tc_social_oauth_provider");
  res.cookies.delete("tc_social_oauth_admin");
  if (recoveryCookie) {
    res.cookies.set("tc_social_oauth_recovery", recoveryCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 15,
    });
  }
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

  if (oauthError) return adminRedirect(req, { social_error: `TikTok: ${oauthError}`.slice(0, 220) });
  if (!code) return adminRedirect(req, { social_error: "TikTok no devolvió el código OAuth. Vuelve a pulsar Conectar TikTok." });

  const signedState = verifySocialOAuthState(state, "tiktok");
  const cookieState = req.cookies.get("tc_social_oauth_state")?.value;
  const cookieProvider = req.cookies.get("tc_social_oauth_provider")?.value;
  const cookieOk = Boolean(state && cookieState && state === cookieState && cookieProvider === "tiktok");
  if (!signedState && !cookieOk) {
    return adminRedirect(req, { social_error: "La sesión OAuth de TikTok no se pudo validar. Pulsa Conectar TikTok de nuevo desde el panel." });
  }

  const connectedBy = uuidOrNull(signedState?.adminId || req.cookies.get("tc_social_oauth_admin")?.value);

  try {
    const clientKey = process.env.TIKTOK_CLIENT_KEY?.trim();
    const clientSecret = process.env.TIKTOK_CLIENT_SECRET?.trim();
    if (!clientKey || !clientSecret) throw new Error("Faltan TIKTOK_CLIENT_KEY o TIKTOK_CLIENT_SECRET en Vercel");
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
    if (!tokenResponse.ok || !tokenJson?.access_token) {
      throw new Error(tokenJson?.error_description || tokenJson?.message || tokenJson?.error || `TikTok OAuth HTTP ${tokenResponse.status}`);
    }

    const accessToken = String(tokenJson.access_token);
    let profile: any = {};
    let profileError = "";
    for (const fields of ["open_id,union_id,avatar_url,display_name,username", "open_id,avatar_url,display_name", "open_id,display_name", "open_id"]) {
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
      profileError = userJson?.error?.message || userJson?.message || `HTTP ${userResponse.status}`;
    }

    const accountId = String(profile?.open_id || tokenJson?.open_id || "").trim();
    if (!accountId) {
      throw new Error(`TikTok autorizó la aplicación, pero no devolvió el open_id de la cuenta${profileError ? `: ${profileError}` : ""}`);
    }

    const grantedScopes = String(tokenJson.scope || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    const connectionInput = {
      provider: "tiktok" as const,
      accountId,
      username: profile?.username || null,
      displayName: profile?.display_name || profile?.username || "TikTok",
      avatarUrl: profile?.avatar_url || null,
      accessToken,
      refreshToken: tokenJson?.refresh_token || null,
      expiresIn: Number(tokenJson?.expires_in || 0),
      refreshExpiresIn: Number(tokenJson?.refresh_expires_in || 0),
      scopes: grantedScopes.length ? grantedScopes : tiktokScopes(),
      connectedBy,
      metadata: {
        api: "tiktok_v2",
        open_id: accountId,
        redirect_uri: redirectUri,
        sandbox_upload_mode: true,
      },
    };

    const savedConnection = await saveSocialConnection(connectionInput);
    if (!savedConnection?.provider || savedConnection.provider !== "tiktok") {
      throw new Error("TikTok autorizó la cuenta pero no se pudo confirmar la persistencia en Supabase.");
    }

    // Segunda lectura independiente antes de declarar éxito OAuth.
    const providersAfterSave = (await getSocialConnections()).map((row: any) => String(row?.provider || "").trim().toLowerCase());
    if (!providersAfterSave.includes("tiktok")) {
      throw new Error(`TikTok se guardó pero no aparece al releer tc_social_connections_v2 (proveedores: ${providersAfterSave.join(", ") || "ninguno"}). Ejecuta SQL_SOCIAL_CONNECTIONS_V2.sql.`);
    }

    const recoveryCookie = encodeSocialRecovery({
      ...connectionInput,
      createdAt: Date.now(),
    });

    return adminRedirect(req, {
      social_connected: "tiktok",
      social_saved: "1",
      social_callback_build: "social-oauth-v8-clean-table",
      social_callback_provider: "tiktok",
    }, recoveryCookie);
  } catch (error: any) {
    return adminRedirect(req, { social_error: String(error?.message || "Error conectando TikTok").slice(0, 220) });
  }
}
