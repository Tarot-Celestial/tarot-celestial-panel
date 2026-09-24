import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin/require-admin";
import {
  decodeSocialRecovery,
  saveSocialConnection,
} from "@/lib/server/social-connections";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const CONNECTION_SELECT = "provider,account_id,username,display_name,avatar_url,token_expires_at,refresh_expires_at,scopes,metadata,connected_at,updated_at";

function projectRef() {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
    return url ? new URL(url).hostname.split(".")[0] || null : null;
  } catch {
    return null;
  }
}

async function readProvider(provider: "instagram" | "tiktok") {
  const db = supabaseAdmin();
  const { data, error } = await db
    .from("tc_social_connections")
    .select(CONNECTION_SELECT)
    .eq("provider", provider)
    .maybeSingle();
  if (error) throw new Error(`No se pudo leer ${provider} en Supabase: ${error.message}`);
  return data || null;
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if (!auth.ok) {
      return NextResponse.json(
        { ok: false, error: auth.error },
        { status: auth.error === "FORBIDDEN" ? 403 : 401 },
      );
    }

    // Leemos cada proveedor directamente por PK. Evitamos construir el estado a partir
    // de una lista genérica: tc_social_connections.provider es la PK y ésta es la fuente
    // de verdad exacta para el panel.
    let [instagram, tiktok] = await Promise.all([
      readProvider("instagram"),
      readProvider("tiktok"),
    ]);

    let recovered = false;
    let recoveryError: string | null = null;

    if (!instagram) {
      const recoveryRaw = req.cookies.get("tc_social_oauth_recovery")?.value;
      const recovery = decodeSocialRecovery(recoveryRaw);
      if (recovery?.provider === "instagram") {
        try {
          await saveSocialConnection({
            provider: "instagram",
            accountId: recovery.accountId,
            username: recovery.username || null,
            displayName: recovery.displayName || null,
            avatarUrl: recovery.avatarUrl || null,
            accessToken: recovery.accessToken,
            refreshToken: recovery.refreshToken || null,
            expiresIn: recovery.expiresIn || null,
            refreshExpiresIn: recovery.refreshExpiresIn || null,
            scopes: recovery.scopes || [],
            metadata: {
              ...(recovery.metadata || {}),
              recovered_from_oauth_cookie: true,
            },
            connectedBy: recovery.connectedBy || null,
          });
          instagram = await readProvider("instagram");
          recovered = Boolean(instagram);
        } catch (error: any) {
          recoveryError = error?.message || "No se pudo recuperar la conexión OAuth";
        }
      }
    }

    const db = supabaseAdmin();
    const { data: providerRows, count, error: countError } = await db
      .from("tc_social_connections")
      .select("provider", { count: "exact" })
      .order("provider");

    const response = NextResponse.json({
      ok: true,
      connections: { instagram, tiktok },
      // Alias de diagnóstico/compatibilidad. Los paneles nuevos aceptan ambos formatos.
      instagram,
      tiktok,
      configured: {
        instagram: Boolean(process.env.INSTAGRAM_APP_ID && process.env.INSTAGRAM_APP_SECRET),
        tiktok: Boolean(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET),
      },
      storage: {
        table: "tc_social_connections",
        readable: !countError,
        rows: countError ? null : (count ?? providerRows?.length ?? 0),
        providers: (providerRows || []).map((row: any) => String(row?.provider || "").trim().toLowerCase()),
        instagram_found: Boolean(instagram),
        tiktok_found: Boolean(tiktok),
        error: countError ? countError.message : null,
        project_ref: projectRef(),
      },
      recovery: {
        attempted: Boolean(req.cookies.get("tc_social_oauth_recovery")?.value),
        recovered,
        error: recoveryError,
      },
      build: "social-oauth-v5-direct-provider-read",
    });

    if (instagram || recoveryError) response.cookies.delete("tc_social_oauth_recovery");
    response.headers.set("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0");
    return response;
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "SOCIAL_STATUS_ERROR", build: "social-oauth-v5-direct-provider-read" },
      { status: 500, headers: { "Cache-Control": "no-store" } },
    );
  }
}
